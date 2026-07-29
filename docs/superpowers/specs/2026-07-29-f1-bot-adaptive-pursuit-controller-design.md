# F1 — IA bot: controller pure-pursuit adattivo (lookahead + sterzo geometrico) — Design

## Contesto

Punto di partenza: audit del 2026-07-29 (memory `project_f1_ia_grip_awareness_testbench`)
aveva lasciato un punto decisionale aperto tra A) migliorare la racing line
offline e B) migliorare il controller pure-pursuit, senza dato quantitativo
per scegliere. Questa sessione ha costruito un esperimento diagnostico
(`backend/tools/f1RacingLineAblation.js`, nuovo) per isolare il contributo dei
due fattori PRIMA di progettare qualunque soluzione. Questo documento separa
esplicitamente:

- **Risultati sperimentali già verificati** (misurati, riproducibili con lo
  strumento sopra).
- **Ipotesi matematiche non ancora validate** (motivate dalla teoria del
  pure-pursuit, ma non confermate su questo codebase).
- **Criteri quantitativi** che decidono se procedere da una fase alla
  successiva del piano di migrazione, o fermarsi/correggere l'ipotesi.

Nessun codice di produzione cambia comportamento per effetto di questo
documento: la Fase 1 (prima implementazione reale) è successiva
all'approvazione di questa spec.

## Risultati sperimentali già verificati

Tutti riprodotti da `node backend/tools/f1RacingLineAblation.js <trackId>`
(nuovo strumento, headless, stessa fisica esatta del gioco via
`f1LapSimulator.simulateLap`). Il file lavora sempre su una copia shallow
dell'oggetto track cacheato, mai lo modifica.

1. **Il controller pesa più della geometria della linea, su New Monza.**
   Tenendo la racing line ufficiale invariata e variando solo
   `racingLineTuning` (lookahead ÷2 + steerGain ×1.75 combinati): distanza
   media dalla linea −46% (3.16→1.73m), picco −30/40% (11.6→7-8m), errore di
   prua medio −51%, a un costo di +650/1300ms (+1.9/3.9%) sul giro
   (33.6-33.7s baseline). Le varianti singole (solo lookahead, solo gain)
   NON sono coerentemente positive.
2. **Sostituire la linea con una "vera" fuori-dentro-fuori (non ottimizzata)
   non aiuta, a controller invariato.** 4 densità di controllo testate
   (15/35/70/140 punti, stessa formula `apexOffset` già in produzione per il
   ramo fallback): nessuna riduce in modo apprezzabile distanza/errore di
   prua, tutte costano tempo reale (+1.5s a +7s sul giro). Una versione a
   piena risoluzione (un controllo per campione, senza interpolazione da un
   set ridotto) causa un **lockup da oscillazione sterzo** (giro non
   completato) — stesso tipo di guasto già documentato per
   `apexMaxFraction=1.0` in `f1LapSimulator.js`.
3. **La direzione si conferma su una pista strutturalmente diversa
   (monte-rosso, nessuna racing line precalcolata — ramo geometrico
   `apexOffset`/`cornerApexNear`, non pure-pursuit su linea offline).**
   Stessa combinazione (lookahead÷2 + gain×1.75): distanza media −21%,
   picco −39%, errore di prua medio −24%, **senza costo in tempo** (−0.6%,
   leggermente più veloce). Le varianti singole restano incoerenti tra loro
   e tra piste (es. steerGain da solo qui migliora e velocizza, su New Monza
   peggiorava e rallentava).
4. **`distanceFromRacingLine` deve usare una ricerca del punto più vicino**
   (finestra ±50 campioni), mai lo stesso indice del centro pista — fatto
   metodologico già noto dall'audit precedente, riconfermato qui.

Questi quattro punti sono fatti misurati, non interpretazioni: **il
controller ha una leva reale e a basso costo sull'errore di traiettoria,
indipendente dalla pista e dal ramo di codice (racing-line o fallback
geometrico); la geometria della linea da sola, senza rioottimizzazione, no.**

## Ipotesi da validare (NON ancora dimostrate)

Quanto segue è **teoria motivata**, presa dalla letteratura standard sul
pure-pursuit, non ancora verificata sui dati di questo gioco. Ogni ipotesi
elenca il test che la confermerebbe o falsificherebbe.

**H1 — Il bias di taglio scala come `L²/(2R)`.**
Proprietà nota del pure-pursuit: su un raggio di curvatura costante `R`, la
curvatura comandata è esatta per qualunque lookahead `L` (nessun errore
strutturale). L'errore nasce quando `R` cambia lungo il percorso (rettilineo
→ curva, o dentro la clotoide della curva) — l'approssimazione standard è che
il bias scali come la freccia della corda `L` su un cerchio di raggio `R`,
cioè `L²/(2R)`. **Non abbiamo ancora misurato questa relazione sui nostri
dati** (i risultati sopra confrontano configurazioni discrete, non una curva
continua bias-vs-`L`/`R`). Falsificabile: campionare `distanceFromRacingLine`
in funzione di `L` su corner di raggio noto e diverso, verificare se il
rapporto `bias/(L²/R)` è approssimativamente costante.

**H2 — `L(s) = √(2·R_locale(s)·e_target)` è una legge di lookahead
adattivo efficace.**
Inversione diretta di H1. Anche se H1 fosse confermata in media, non è detto
che seguire esattamente questa legge (con un singolo `e_target` fisso) dia
il miglior compromesso errore/tempo — è un **punto di partenza da testare
in Fase 1**, non la formula definitiva. Alternative plausibili se H2 non
regge: un esponente diverso da 2, un termine additivo per il floor a bassa
curvatura, o una dipendenza esplicita anche dalla velocità oltre che da `R`.

**H3 — `k` (frazione di `roadHalf` usata per `e_target = k·roadHalf`) è un
candidato costante globale, non ancora una proprietà acquisita.**
Verificato solo indirettamente: i risultati (2) sopra mostrano che la STESSA
direzione di intervento funziona su 2 piste diverse, ma non abbiamo ancora
testato se un singolo valore di `k` produce buoni risultati su ENTRAMBE senza
aggiustamento — è esattamente il criterio di uscita della Fase 1 (vedi
sotto). Se `k` richiede valori diversi per pista per restare nell'intervallo
accettabile, l'ipotesi "costante globale" è falsificata e va sostituita da
una dipendenza esplicita (es. da larghezza media dei corner, non solo
`roadHalf`).

**H4 — `κ_max(v)` è una costante del veicolo calibrabile una volta, funzione
solo della velocità.**
Non dimostrata. È altrettanto plausibile che la curvatura massima ottenibile
dipenda anche da grip/usura/downforce (il gioco ha già `CorneringGripModel.
corneringCapacity`, che modella esattamente una capacità laterale
variabile) — in tal caso `κ_max` andrebbe espresso come `κ_max(v, grip)`,
probabilmente riusando la stessa `corneringCapacity` già esistente invece di
introdurre una calibrazione indipendente. Falsificabile in Fase 2: misurare
se una singola `κ_max(v)` (gomma nuova) produce lockup/degrado di tracking
sistematico a gomma molto usurata; se sì, H4 nella forma "solo velocità" è
falsa.

**H5 — Il gain proporzionale (`steerGain`) può essere COMPLETAMENTE
sostituito dalla formula geometrica pure-pursuit, senza perdita.**
**Non dimostrata dai dati attuali.** I risultati (1)/(3) mostrano che
lookahead+gain **insieme** funzionano meglio di ciascuno da solo — questo è
un fatto misurato. Non dimostra che la formula geometrica (`κ_comandata =
2·sin(α)/L`, priva di un gain libero) raggiunga lo stesso beneficio della
combinazione empirica testata. È esattamente l'oggetto della Fase 2: un
confronto diretto, non un'assunzione. Se la formula geometrica pura
sottoperforma la combinazione empirica, il piano prevede un **fallback
esplicito**: mantenere un gain residuo come correzione moltiplicativa sopra
la formula geometrica (`steer = clamp(gain_residuo · κ_comandata/κ_max, -1,
1)`), invece di eliminarlo del tutto — riduzione parziale ma reale del
numero di parametri (da 2 liberi per pista a 1 gain eventualmente ancora
libero, ma non più il lookahead).

## Architettura target (provvisoria — dipende dalla conferma di H1-H5)

Se tutte le ipotesi si confermano nella forma più semplice:

```
L(s)     = clamp(√(2·R_locale(s)·e_target), L_min(v), L_max)      [H1, H2]
e_target = k · roadHalf                                            [H3]
κ_cmd    = 2·sin(α)/L                                               [formula pure-pursuit standard, non in discussione]
steer    = clamp(κ_cmd / κ_max(v), -1, 1)                          [H4, H5]
```

`R_locale` da `windowRadius` (già esistente, riusata as-is). `α` è lo stesso
errore di prua verso il lookahead già calcolato oggi in `steerToward`.

Se H4 o H5 non si confermano nella forma semplice, l'architettura si
allarga (non si abbandona il principio): `κ_max(v, grip)` riusando
`corneringCapacity`, o un gain residuo esplicito sopra la formula
geometrica. Questo documento non decide ora quale ramo verrà preso — lo
decidono i criteri quantitativi delle Fasi 1-2.

## Parametri: stato attuale vs candidato

| Parametro | Oggi | Stato dopo la migrazione |
|---|---|---|
| `lookaheadTimeS` | per pista (ottimizzatore) | **candidato all'eliminazione**, condizionato a H1/H2/H3 confermate in Fase 1 |
| `steerGain` | per pista (ottimizzatore) | **candidato all'eliminazione**, condizionato a H4/H5 confermate in Fase 2 — fallback: gain residuo globale se non confermate |
| `k` | non esiste | **candidato** costante globale — da verificare (H3), non acquisito |
| `κ_max(v)` (o `κ_max(v, grip)`) | non esiste esplicitamente | **candidato** costante veicolo — forma esatta da verificare (H4) |
| `L_min`/`L_max` | costanti fisse (`BOT_LOOKAHEAD_MIN_M` ecc.) | restano costanti globali, ruolo invariato |
| `roadHalf` | per pista (geometria) | resta per pista — geometria, non tuning |
| `cornerSpeedMargin`, `brakingDistanceMargin`, `deadband`, `ramp` | per pista (ottimizzatore) | **fuori scope**, invariati |

## Piano di migrazione a fasi, con criteri quantitativi

Ogni fase è dietro flag indipendente (stesso pattern di
`F1_BOT_GRIP_AWARENESS`), verificabile headless con
`f1RacingLineAblation.js`/`f1LapSimulator.js` prima di qualunque playtest,
reversibile spegnendo il flag. Nessuna fase promuove il proprio flag a
default-on senza playtest esplicito dell'utente in localhost (convenzione
CLAUDE.md).

### Fase 1 — Lookahead adattivo (H1/H2/H3), sterzo INVARIATO

Implementa `L(s)` con `steerGain` lasciato esattamente come oggi (per pista
se esiste, costante altrimenti) — isola l'effetto del solo lookahead
adattivo, senza confonderlo con H4/H5.

**Criterio quantitativo per procedere alla Fase 2** (su ENTRAMBE New Monza e
monte-rosso, headless):
- Riduzione della distanza media dalla linea ≥ **1/3** di quella osservata
  con la combinazione empirica lookahead+gain (riferimento: −46% New Monza,
  −21% monte-rosso → soglia ≥ −15%/−7% rispettivamente), a lookahead
  adattivo da solo.
- Nessun DNF/lockup su nessuna delle 4 piste attuali (new-monza,
  monte-rosso, prova, test2).
- Costo in tempo sul giro ≤ +3% su ogni pista testata.

**Se il criterio non è soddisfatto**: H2 (la legge `√(2Re)` specifica) è
insufficiente da sola — non si passa alla Fase 2, si torna a raffinare la
legge di `L(s)` (es. esponente diverso, termine di velocità esplicito) prima
di ripetere il test. Non si salta a modificare lo sterzo per compensare: la
Fase 1 resta isolata per costruzione.

### Fase 2 — Sterzo su formula geometrica (H4/H5), lookahead di Fase 1 attivo

Implementa `κ_cmd/κ_max(v)` al posto di `diff·steerGain`. Richiede prima una
misura (non una calibrazione assunta) di `κ_max` a diverse velocità **e**
diversi livelli di usura gomma (`tyreWear` basso e alto, con
`F1_BOT_GRIP_AWARENESS` sia ON che OFF) per testare H4.

**Criterio quantitativo per procedere alla Fase 3**:
- Con `κ_max(v)` (sola velocità): le metriche di tracking a gomma usurata
  non degradano più del 20% relativo rispetto a gomma nuova, e nessun nuovo
  DNF appare a usura alta su nessuna pista. Se degradano di più → H4 nella
  forma "solo velocità" è falsificata, si passa a `κ_max(v, grip)` riusando
  `corneringCapacity` prima di ripetere il test.
- Confronto diretto sterzo-geometrico vs sterzo-a-gain (entrambi con lo
  stesso lookahead di Fase 1): il geometrico deve eguagliare o migliorare
  distanza media/picco ed errore di prua su tutte e 4 le piste, tempo sul
  giro entro +3% aggiuntivo rispetto a Fase 1 da sola. Se non eguaglia →
  H5 è falsificata nella forma "eliminazione totale": si adotta il fallback
  (gain residuo sopra la formula geometrica) e si documenta come tale,
  invece di forzare l'eliminazione.

### Fase 3 — Rimozione di `lookaheadTimeS`/`steerGain` come parametri per pista

Solo dopo Fase 1 e Fase 2 confermate (non solo headless: playtest utente in
localhost su almeno 2 piste, per convenzione CLAUDE.md). Ritira i campi da
`racingLineTuning`/l'ottimizzatore smette di cercarli.

**Criterio quantitativo**: le stesse costanti globali (`k`, forma finale di
`κ_max`) funzionano entro le soglie sopra su **tutte** le piste attuali
senza alcun aggiustamento per pista. Se anche una sola pista richiede un
valore diverso, questa fase non procede finché non si capisce perché (la
"globalità" di `k`/`κ_max` non è ancora acquisita, si torna a H3/H4).

### Fase 4 — Rigenerazione delle racing line ufficiali

Ri-esecuzione di `f1RaceLineOptimizer.js` (spazio di ricerca ridotto: niente
più `lookaheadTimeS`/`steerGain`) su New Monza e Prova (mai rigenerata con
budget equivalente, nota aperta dall'audit precedente). Qui si ririprova
anche lo shape-prior (opzione A originale), stavolta con una fitness
coerente col controller finale — cosa che l'esperimento (2) di questa spec
non ha potuto valutare, perché usava ancora il vecchio controller.

**Criterio quantitativo**: nessuna regressione di tempo sul giro rispetto
alle linee attuali; se la forma della linea rigenerata mostra un vero
attraversamento di segno dell'offset laterale (fuori→dentro→fuori, assente
oggi — vedi audit precedente), è una conferma indipendente che il nuovo
controller permette anche una geometria di linea migliore, non solo un
inseguimento più preciso di una linea imperfetta.

## Strumenti di verifica disponibili

- `backend/tools/f1RacingLineAblation.js` (nuovo, questa sessione): Braccio
  1 (varianti controller) su piste con e senza racing line, Braccio 2
  (varianti linea). Riusabile as-is per i test di Fase 1/2 sopra.
- `backend/tools/f1LapSimulator.js`: esteso in questa sessione con
  `distanceFromRacingLine`/`headingVsTangentDeg` in telemetria (campi
  additivi, letti da `_botDebug` già esistente — nessun ricalcolo).
- Banco prova/Bot Inspector/TrajectoryViz (`f1Testbench.js` +
  `frontend/f1tb-*.js`, sessione precedente): per la verifica visiva in
  localhost richiesta da CLAUDE.md prima di promuovere qualunque flag a
  default-on.

## Cosa NON fa questo documento

- Non implementa nessuna delle 4 fasi — questa è la spec, l'implementazione
  segue con un piano separato (`writing-plans`).
- Non decide se H4/H5 si risolveranno nella forma semplice o nel fallback —
  lo decidono i criteri quantitativi di Fase 1/2, non questo documento.
- Non tocca `cornerSpeedMargin`, `brakingDistanceMargin`, `deadband`,
  `ramp` — restano parametri per pista come oggi, gestiscono velocità/
  frenata non sterzo/lookahead.
- Non promuove nessun flag a default-on senza playtest esplicito
  dell'utente in localhost.
- Non modifica alcun file di racing line ufficiale (`*-raceline.json`) —
  la Fase 4 è l'unica che li tocca, e solo dopo le Fasi 1-3.
