# F1 — traiettoria fuori-dentro-fuori + taglio proporzionale (fase 2, sotto-progetto B)

## Contesto

Fase 1 ([[project_f1_bot_ai]], spec `2026-07-24-f1-bot-lap-simulator-design.md`) ha
prodotto uno strumento di misura (`backend/tools/f1LapSimulator.js`) che riproduce
la fisica esatta del server per un giro di qualifica in solitaria, senza browser.
Con quello strumento abbiamo scoperto due cose:

1. Il bot "migliore possibile" (nessuna casualità, `botSpeedFactor=1.0`) fa Monza
   in **24.2s**. L'utente arriva a **18-20s**. Il vero divario dall'algoritmo di
   guida (non dalla griglia di bot con ritmo casuale) è quindi ~4-6s, non i
   7-10s che sembravano dal solo confronto in gara.
2. Togliere semplicemente i margini di sicurezza (`--preset=zero-margin`) NON
   funziona in generale: su Monte Rosso il bot resta bloccato per sempre
   (mai un bug del simulatore — verificato che la sequenza fisica è identica a
   `tickGame()`), su un'altra pista peggiora. Causa isolata con test diretti:
   `BOT_APEX_MAX_FRACTION=1.0` da solo, su una curva abbastanza stretta, sposta
   il punto mirato dallo sterzo oltre la geometria reale della curva, producendo
   un'oscillazione di sterzo che non si risolve mai. Il tetto di 0.85 in uso
   oggi non è pura prudenza: prevendi anche questo overshoot geometrico.

L'utente vuole ora scoprire quanto in basso si può **davvero** portare il tetto
di 24.2s restando "realistici" — stessa fisica di un giocatore umano (stessa
`ACCEL`/`BRAKE_MULT`/`TURN_SPEED`/`GRIP`), nessuna scorciatoia, solo un modo più
intelligente di usare quella fisica, come farebbe un pilota vero. L'obiettivo
esplicito: una griglia di bot che sia una sfida vera, non un avversario facile
da battere — ma anche non un bot che bara.

Un secondo sotto-progetto (A: alzare il range di `botSpeedFactor`, oggi
0.8-1.0) tarerà i bot REALI (non solo il caso ideale) sul nuovo tetto scoperto
qui — deliberatamente rimandato a dopo, una volta noto il tetto vero (decisione
esplicita dell'utente: niente tuning a doppio giro).

Questo documento copre **solo** il sotto-progetto B: la riprogettazione della
traiettoria/velocità in curva. Nessuna modifica al range `botSpeedFactor`,
nessuna modifica a scia/sorpasso/pit-stop.

Codice di riferimento attuale (`backend/sockets/games/f1Bot.js`):

- `apexOffset(points, idx, halfWindowSamples, maxOffsetM)` (righe 88-103): misura
  la curvatura in UNA finestra fissa (12m) attorno a un solo punto, sposta il
  punto mirato SOLO verso l'interno, con un'unica frazione fissa
  (`BOT_APEX_MAX_FRACTION=0.85`) uguale per ogni curva, stretta o larga.
- `cornerTargetSpeed(...)` (righe 121-143): scansiona in avanti a finestre
  sovrapposte, indipendentemente da `apexOffset`, per trovare la curva più
  vincolante e calcolare la velocità/frenata — una stima di curvatura SEPARATA
  da quella usata per la traiettoria, potenzialmente disallineata.
- `DEFAULT_TUNING`/`deps.tuning` (righe 375-392, aggiunti in fase 1): i tre
  margini attuali restano tunable per lo strumento di misura — questa
  riprogettazione li rispetta come interfaccia, ma introduce nuove costanti per
  la forma fuori-dentro-fuori (vedi sotto).
- `backend/tools/f1LapSimulator.js`/`backend/tools/f1LapSimulator.test.js` (fase
  1): riusati as-is per validare ogni versione candidata su tutte le piste,
  nessuna modifica prevista qui.

## Approccio scelto e alternative scartate

**Raggio-per-finestra come helper condiviso, non fusione delle due funzioni
(scelto).** `cornerTargetSpeed` oggi scansiona PIÙ finestre nel raggio di
scansione e decide, per ciascuna, se serve già frenare per quella curva
specifica (gestisce correttamente il caso di più curve in sequenza: una meno
stretta ma più vicina può richiedere frenata prima di una più stretta ma più
lontana). Questa logica multi-curva va preservata invariata — non è il
problema che stiamo risolvendo. Si estrae quindi SOLO il calcolo del raggio in
una singola finestra (oggi inline in entrambe le funzioni con la stessa
formula arco/angolo) in un helper puro condiviso, usato sia dal nuovo
`cornerApexNear` (che trova la curva più VICINA a un punto dato e il suo
apice, per la traiettoria) sia dal loop esistente di `cornerTargetSpeed` (che
continua a scansionare e decidere finestra per finestra, invariato nella
logica, solo senza duplicare la formula del raggio). Così sterzo e freno
misurano la curvatura con la stessa identica funzione, senza dover fondere
due algoritmi che risolvono problemi diversi (la curva più vicina per la
traiettoria, una decisione di frenata per ciascuna curva nel raggio di
scansione). Scartata l'alternativa "cornerTargetSpeed chiama direttamente
cornerApexNear e usa solo l'apice trovato": perderebbe la capacità di
frenare in tempo per una curva più vicina ma meno stretta quando ce n'è
un'altra più vincolante più avanti nello stesso raggio di scansione.

**Offset laterale come funzione a S della fase (scelto), non uno scalino
fisso.** Oggi l'offset è "zero in rettilineo, salta a `severity * maxOffsetM`
appena c'è curvatura" (uno scalino, sempre verso l'interno). La nuova funzione
restituisce un valore che parte negativo (verso l'ESTERNO) ben prima
dell'apice, cresce a positivo (verso l'INTERNO) esattamente all'apice, poi
torna negativo (esterno) in uscita — il classico fuori-dentro-fuori. L'ampiezza
di entrambi gli estremi è proporzionale a quanto è stretta la curva (raggio
piccolo = swing grande), non più una frazione fissa uguale ovunque. Scartata
l'alternativa "solo taglio proporzionale, niente allargamento in
entrata/uscita" (opzione 1 discussa col utente): più sicura ma con guadagno
atteso più piccolo, l'utente ha scelto esplicitamente la combinazione completa.

## Design

### Nuovo helper condiviso: raggio in una finestra

```
windowRadius(points, i1, i2, localArcM)
  → { radius, turnSigned } | null
```

Estrae la formula già inline in entrambe le funzioni oggi (tangente in `i1`,
tangente in `i2`, `turnSigned = normalizeAngle(angle2-angle1)`,
`radius = localArcM / |turnSigned|`), ritorna `null` se `|turnSigned| < 1e-4`
(praticamente dritto, stesso caso base di oggi in entrambe le funzioni).
Nessuna logica di decisione qui — solo la misura pura.

### Nuova funzione: individuazione dell'apice

```
cornerApexNear(points, idx, searchSamples, localSamples, metersPerSample)
  → { apexIdx, apexRadius, distanceToApexM } | null
```

**Attenzione al caso di curve multiple ravvicinate (es. chicane):** l'uso è
"trova la curva che sto affrontando ADESSO nel punto mirato", non "trova la
curva più stretta comunque presente qui vicino" — una versione che scansiona
avanti su un orizzonte lungo e tiene il raggio minimo assoluto rischierebbe di
agganciarsi a un tornante più lontano ma più stretto invece della curva
attualmente rilevante, mandando la traiettoria a "puntare" verso l'apice
sbagliato. Algoritmo corretto: scansiona da `idx` SIA in avanti che indietro
(finestre sovrapposte, passo = metà di `localSamples`, come oggi), fino a
`searchSamples` per lato; trovata la prima finestra con curvatura
significativa (la curva più VICINA a `idx`, non la più stretta in assoluto),
continua a scansionare in quella stessa direzione finché il raggio calcolato
smette di diminuire (trovato il minimo locale = l'apice di QUELLA curva), poi
si ferma. Ritorna `null` se nessuna finestra entro `searchSamples` per lato ha
curvatura significativa (rettilineo).

`searchSamples` va dimensionato per coprire la lunghezza tipica di una
singola curva (non l'intera distanza di frenata, che può essere molto più
lunga ad alta velocità) — validare con il test della chicane (due curve
ravvicinate) che l'apice trovato per un punto mirato dentro la prima curva sia
quello della prima, non della seconda.

### `cornerTargetSpeed`: invariata nella logica, usa `windowRadius`

Il loop esistente (scansiona finestre, per ciascuna valuta se serve già
frenare per QUELLA curva, tiene la più vincolante tra quelle che richiedono
frenata ora) resta identico — cambia solo la riga che calcola
`radius`/`turnSigned` per ciascuna finestra, che ora chiama `windowRadius`
invece di ripetere la formula inline. Comportamento numerico invariato
(stessa formula, stessi input), zero rischio di regressione sulla gestione
di più curve in sequenza.

### Traiettoria: `apexOffset` ristrutturata

Per il punto mirato `targetIdx` (stesso lookahead di oggi), calcola
`distanceToApexM` con `cornerApexNear` ancorata a `targetIdx`.

Formula di partenza (da validare/tarare con i test geometrici, non un valore
finale scolpito nella pietra):

- `halfSpanM = apexRadius * BOT_APEX_REF_ANGLE` (raggio più ampio → zona di
  influenza fuori-dentro-fuori più ampia, coerente col concetto già esistente
  di "severity" riferito a `BOT_APEX_REF_ANGLE`).
- `x = clamp(distanceToApexM / halfSpanM, -1, 1)`.
- `shape(x) = cos(x * π)` → **+1 esattamente all'apice** (`x=0`, massimo
  taglio verso l'interno), **-1 ai bordi della zona di influenza** (`|x|=1`,
  massimo allargamento verso l'esterno). Oltre `|x|=1` (ben prima o ben dopo
  la curva), l'offset torna a decrescere verso 0 con una rampa lineare su una
  seconda finestra (es. un altro `halfSpanM` di transizione) — mai restare
  "allargato" all'infinito su un rettilineo lungo dopo l'uscita di curva.
- `severity = min(1, roadHalf / apexRadius)` — curve più strette del previsto
  rispetto alla larghezza pista pesano di più.
- `mag = shape(x) * severity * tuning.apexMaxFraction * roadHalf` (mai oltre
  il tetto esistente in valore assoluto, per costruzione: `|shape|≤1`,
  `severity≤1`).
- Verso: come oggi, `insideSign` dal segno della curvatura all'apice; l'unica
  differenza è che ora `mag` può essere negativo (verso l'esterno, lato
  OPPOSTO a `insideSign`) invece di essere sempre `≥0`.

### Interfaccia con `deps.tuning` (fase 1)

I tre margini esistenti (`cornerSpeedMargin`, `apexMaxFraction`,
`brakingDistanceMargin`) restano con lo stesso significato e la stessa
interfaccia — il preset `zero-margin` dello strumento di fase 1 continua a
funzionare invariato. Eventuali nuove costanti per la forma a S (es. quanto
allargarsi in entrata/uscita relativo al taglio massimo) vanno aggiunte allo
stesso `DEFAULT_TUNING`, così restano misurabili con lo strumento esistente
senza modificarlo.

## Testing

Stessa disciplina già richiesta esplicitamente dall'utente e già in uso nel
progetto ([[feedback_bot_ai_physics_over_heuristics]]): per funzioni "verso
critico" (sbagliare produce un bot fuori pista), test geometrico diretto prima
di qualunque playtest o corsa sul simulatore.

1. **Test geometrici su piste sintetiche** (`buildConstantCurveTrack`, già in
   `f1Bot.test.js`): un tornante stretto isolato, una curva dolce isolata, una
   chicane (due curve ravvicinate di segno opposto). Verificano direttamente:
   offset negativo (esterno) ben prima dell'apice, positivo (interno)
   esattamente all'apice, negativo (esterno) dopo; ampiezza maggiore sul
   tornante che sulla curva dolce; mai oltre `tuning.apexMaxFraction *
   roadHalf` in valore assoluto, su nessuna delle due.
2. **Regressione con `f1LapSimulator.js` su tutte e 6 le piste reali** (fase
   1, riusato invariato) per ogni versione candidata: nessun "non completato",
   nessuna pista con tempo peggiore del baseline attuale (24.2s su Monza è la
   baseline; le altre 5 piste hanno i loro tempi già misurati in fase 1 come
   riferimento). Una versione che rompe anche una sola pista non si considera
   pronta, indipendentemente da quanto guadagna su Monza.
3. **Metrica di successo**: tempo su Monza con tuning di default (non
   zero-margin) confrontato al 24.2s attuale — l'obiettivo è abbassarlo,
   restando a zero "non completato" su tutte le piste.

## Fuori scope (esplicito)

- Range `botSpeedFactor` (sotto-progetto A, dopo questo).
- Scia, sorpasso, pit-stop, strategia gomme: invariati.
- Tempo-limite teorico assoluto indipendente dall'algoritmo (scartato in fase
  1, non richiesto qui).
