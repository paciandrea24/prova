# F1 — IA bot: sterzo feedforward da curvatura + reattivo ridotto — Design (proposta, non implementata)

## Contesto

Audit del pace-gap bot-umano su `prova` (2026-08-08): dopo aver allargato i
limiti di ricerca dell'ottimizzatore offline (`f1RaceLineOptimizer.js`,
`steerGain` 7.0→15.0, `adaptiveLookaheadK` 0.4→0.8) e aggiunto un vincolo duro
anti-fuori-pista, la ricerca (basin-hopping + simulated annealing, 100 hop)
ha trovato un miglioramento reale (48650→48250ms, verificato 0 tick
fuori-asfalto) ma `steerGain` è arrivato a **14.78, quasi al nuovo tetto di
15** — stesso pattern già visto al vecchio tetto (7.0). Un parametro che
spinge sempre verso l'estremo della gabbia di ricerca, invece di stabilizzarsi
sotto, è un indizio che il controller sta compensando con la forza bruta un
limite strutturale, non che serve ancora tuning.

**Questa è nuova evidenza quantitativa per un punto già aperto in
[[project_f1_ia_grip_awareness_testbench]]** (via
`docs/superpowers/specs/2026-07-29-f1-bot-adaptive-pursuit-controller-design.md`,
di seguito "spec Fase 2"): quella spec proponeva di sostituire
`diff·steerGain` (pure-pursuit puramente reattivo) con una formula geometrica
di curvatura, con un **fallback esplicito** già previsto se l'eliminazione
totale del gain non regge: "mantenere un gain residuo come correzione
moltiplicativa sopra la formula geometrica" (H5, riga 122-127 di quella
spec). La Fase 1 di quella spec (lookahead adattivo) è stata implementata ed
è oggi permanente; **la Fase 2 (sterzo geometrico) non è mai stata
eseguita/verificata**. Questo documento propone una variante più semplice di
quella Fase 2 — feedforward **additivo** invece di sostitutivo — e riporta un
primo prototipo/misura, non ancora portato in `f1Bot.js`.

## Perché il pure-pursuit puro tende ad alto gain

`steerToward` (f1Bot.js) è un controllore **reattivo puro**: calcola l'errore
angolare verso un punto sulla linea più avanti e lo corregge con
`diff · steerGain`. Non ha alcuna nozione della curvatura reale della pista
finché un errore non si è già accumulato — per inseguire una curva stretta
con precisione, l'unico modo che ha è un gain alto (reagisce con più forza
allo stesso errore). Un termine di **feedforward** — quanto sterzare per
seguire la curvatura nota della linea, indipendentemente da qualunque errore
— lascerebbe alla parte reattiva solo il compito di correggere il residuo,
potenzialmente riducendo il bisogno di un gain estremo.

## Formula proposta (derivata dalla fisica reale, non un numero indovinato)

Da `SteeringModel.applySteering` (invariata): `p.angle += turnRate * dir *
steer` per tick, con `turnRate` interpolato tra `TURN_SPEED_LOW` (0.075
rad/tick) e `TURN_SPEED_HIGH` (0.052 rad/tick) in base alla frazione di
velocità.

Lo `steer` che manterrebbe l'auto esattamente sulla curvatura locale della
linea (raggio `R`, da `windowRadius` — già esistente, riusata as-is) a
velocità `v` (m/s):

```
Δheading_per_tick = (v · dtS) / R        // dtS = PHYSICS_TICK_MS / 1000
steer_ff           = Δheading_per_tick / turnRate(v)
steer_finale        = clamp(steer_ff + steerToward(...), -1, 1)
```

`turnRate(v)` usa la stessa interpolazione di `SteeringModel` (senza fattore
danno ala, i bot in quali/simulazione non ne hanno). Il segno di `steer_ff`
segue `Math.sign(turnSigned)` dalla stessa finestra locale già usata da
`cornerTargetSpeed`/`apexOffset` — nessuna nuova misura di curvatura
introdotta.

## Prototipo e misura (script isolato, NON in f1Bot.js)

Testato con uno script standalone (riusa `steerToward`, `windowRadius`,
`adaptiveLookaheadMeters`, `cornerTargetSpeed` già esportati da `f1Bot.js`,
nessuna reimplementazione della logica di velocità) su `prova`, giro di
qualifica pulito (nessun rumore di sterzo):

| Configurazione | Tempo | Distanza media dalla linea | Tick fuori-asfalto |
|---|---|---|---|
| Attuale (solo reattivo, gain=14.78) | 48250ms | 3.504m | **0** |
| Feedforward + stesso gain (14.78) | 48150ms (−100ms) | 3.142m (più fedele) | **3** |
| Feedforward + gain=9.0 | 48150ms (=) | 3.403m | 3 |
| Feedforward + gain=6.92 (vecchio, pre-SA) | 48450ms | 3.382m | 6 |
| Feedforward + gain=6.0 | 48750ms | 3.640m | 26 |
| Feedforward + gain=4.5 | 49050ms | 4.110m | 29 |
| Feedforward + gain=3.0 | 50250ms | 4.646m | 62 |

**Il feedforward funziona come atteso** (tracking più fedele, tempo pari o
leggermente migliore a gain uguale) **ma introduce escursioni fuori-pista che
oggi non esistono**, anche a gain alto e senza alcun rumore. Nessuna delle
varianti testate raggiunge 0 tick fuori-asfalto come il controllore attuale.

## Interpretazione — perché non è un miglioramento pulito

La linea SA attuale (`prova-raceline.json`) non è "la traiettoria ideale in
astratto": è stata trovata e rifinita dall'ottimizzatore usando ESATTAMENTE
il controllore reattivo puro esistente durante la propria simulazione interna
(`simulateWithRacingLine`) — corre già molto vicino al bordo in alcuni punti
(misurato in questa stessa sessione: offset laterale fino a 10.92m su un
limite pista di 11m). Un controllore diverso e più preciso (feedforward) che
segue quella STESSA linea più fedelmente finisce per stare più vicino al
bordo esattamente dove la linea corre già al limite — più precisione lì
significa meno margine, non più sicurezza. Coerente con l'avvertenza già in
memoria ([[feedback_f1_raceline_optimizer_ab_testing]]): la fedeltà alla
linea da sola non basta a giudicare un cambiamento di controllore, va sempre
verificato con un test diretto di fitness (qui: tempo + fuori-pista vero).

## Cosa servirebbe per una valutazione vera (non ancora fatto)

1. Implementare il feedforward per davvero in `f1Bot.js`
   (`computeSoloRacingLineInputs`), dietro flag (stesso pattern
   `F1_XXX`/`isTyreSlipModelActive` già in uso nel progetto).
2. Aggiornare `f1RaceLineOptimizer.js` (`simulateWithRacingLine`) per usare
   lo STESSO controllore feedforward+reattivo nella sua simulazione interna —
   altrimenti la linea resta co-adattata al vecchio controllore, come appena
   osservato.
3. Rilanciare l'ottimizzazione **da zero** (non `--resume`: cambia la legge
   di sterzo, non solo i parametri) su `prova`, con il vincolo
   anti-fuori-pista già presente in `fitness()` (aggiunto in questa stessa
   sessione) a garantire che la linea ri-trovata sia genuinamente sicura col
   nuovo controllore, non solo veloce.
4. Confrontare: tempo sul giro, tick fuori-asfalto veri, e le stesse metriche
   di "nervosismo" sotto rumore di sterzo già usate per validare il tuning SA
   (inversioni di sterzo, jerk medio) — playtest utente in localhost prima di
   promuovere qualunque cosa a produzione (convenzione CLAUDE.md).

## Cosa NON fa questo documento

- Non implementa il feedforward in `f1Bot.js` o `f1RaceLineOptimizer.js` —
  solo un prototipo isolato in uno script temporaneo, non salvato nel
  progetto.
- Non tocca nessun file `*-raceline.json` di produzione.
- Non decide se procedere — la sessione si è fermata qui per dare priorità a
  un'altra ottimizzazione già in corso; questo documento serve a riprendere
  senza dover rifare la misura da capo.
- Non sostituisce la spec Fase 2 del 2026-07-29 (formula geometrica pura,
  `κ_cmd/κ_max`) — è un'alternativa più semplice (additiva, non sostitutiva)
  allo stesso problema, da confrontare con quella se/quando si riprende
  questo fronte.
