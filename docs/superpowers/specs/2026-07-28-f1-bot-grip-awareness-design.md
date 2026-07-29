# F1 — IA bot: grip-awareness in guida (cornering + frenata) — Design

## Contesto

Ricognizione preliminare (questa conversazione, verificata leggendo il codice
riga per riga, non solo la memoria di sessioni precedenti): tutta l'IA vive in
un unico modulo, `backend/sockets/games/f1Bot.js`, che produce solo
`p.inputs.{throttle,brake,steer}` — mai una via privilegiata alla fisica.
Oggi il bot decide velocità in curva e punto di frenata in modo **puramente
cinematico**, senza consultare nessuno dei modelli fisici introdotti dalle
milestone Gomme/Danno/Aero:

- **Velocità in curva** (`cornerTargetSpeed`, `f1Bot.js:225-242`):
  `cornerSpeed = radius × turnRateAtMax × marginFactor`. Il raggio di
  curvatura diviso per il tasso massimo di sterzata dell'auto — zero
  riferimento a usura gomme, downforce o danno. Una gomma al 90% di usura e
  una gomma nuova producono oggi la stessa velocità di curva per il bot.
- **Punto di frenata**: `brakeDecel = accel × brakeMult` (`f1Bot.js:606`),
  calcolato **una sola volta per tick** da costanti grezze passate da
  `f1GameSocket.js:880` (`ACCEL`, `BRAKE_MULT`) — non dalla funzione fisica
  reale. La fisica vera usa invece `BrakingModel.effectiveBrakeMult(p,
  isQuali)` (`BrakingModel.js:21-24`), che scala già la decelerazione per
  l'usura reale (`TyreForceModel.brakingFactor`); il bot non la chiama mai.
- **Capacità laterale reale** (introdotta dalla milestone Aero +
  `CorneringGripModel`, appena chiusa): vive oggi **inline, non esportata**,
  dentro `CorneringGripModel.lateralExcess` (`CorneringGripModel.js:29-32`):
  `capacity = corneringGripFactor(tyreWear, isQuali) ×
  downforceFactor(speedFrac, isQuali, damageParts)`. Nessun consumer la usa
  isolata da un confronto domanda/eccesso.
- **Il drag è già coperto**: il bot consulta già `effectiveMaxSpeed` come
  dependency (`f1Bot.js:738`, `803`), che internamente applica già
  `dragFactor` — nessuna nuova leva necessaria per il rettilineo.
- **Dettaglio strutturale verificato**: `corneringGripFactor`,
  `brakingFactor` e `downforceFactor` restituiscono tutti esattamente `1`
  (neutro) quando `isQuali=true` (`TyreForceModel.js:71-74`,
  `influenceFactor`) — qualunque grip-awareness aggiunta converge da sola al
  comportamento di oggi in qualifica (giro secco, gomma sempre "fresca" per
  convenzione di gioco) e diverge solo in gara con l'usura reale accumulata.
  Nessun caso speciale da scrivere per questo nel codice del bot.

Rif. milestone precedenti: `docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md`
(Aero, appena chiusa), `docs/superpowers/specs/2026-07-27-f1-tyre-force-model-migration-design.md`,
`docs/superpowers/specs/2026-07-28-f1-cornering-grip-limit-design.md`.

## Scope di questa fase

**Dentro**: il veicolo controllato dal bot diventa consapevole di
usura/downforce/danno nella scelta di velocità in curva e punto di frenata.

**Esplicitamente fuori scope** (decisione utente in fase di brainstorming):
- Aggressività, logica di sorpasso, strategia di gara di alto livello.
- `otherCarTargetSpeed` (`f1Bot.js:297-306`, usata per stimare il ritmo
  dell'auto avanti nei sorpassi): **resta invariata**. Riusa la stessa
  `cornerTargetSpeed` ma senza il nuovo parametro → equivalente a fattore 1,
  identico a oggi. Motivazione esplicita dell'utente: isolare lo scope e
  poter misurare chiaramente il miglioramento della guida propria senza
  mescolare due problemi diversi. L'incoerenza residua (il bot valuta se
  stesso in modo più preciso dell'avversario) è nota e rimandata a una fase
  futura dedicata a sorpassi/strategia.
- Strategia gomme/pit e riparazione danno per componente (soglia unica
  20% sul danno aggregato, invariata).

## Decisione architetturale

Estensione del pattern di dependency-injection già in uso: `f1GameSocket.js`
passa funzioni fisiche già pronte a `f1Bot.js` tramite l'oggetto `deps` di
`updateBotInputs` (esattamente come avviene oggi per `effectiveMaxSpeed`,
`ACCEL`, `BRAKE_MULT`, `TURN_SPEED_HIGH`). **`f1Bot.js` continua a non fare
mai `require` di `backend/sockets/games/physics/*`** — confine architetturale
invariato.

Due leve, una nuova (estratta, non inventata) e una già esistente:

```
CorneringGripModel.corneringCapacity(p, isQuali)   ← NUOVA: estratta da lateralExcess, stessa formula
BrakingModel.effectiveBrakeMult(p, isQuali)        ← ESISTENTE: solo da consultare, mai duplicata
        ↓ (passate come deps, stesso pattern di effectiveMaxSpeed oggi)
f1GameSocket.js → updateBotInputs(game, deps)
        ↓
f1Bot.js: cornerTargetSpeed(..., gripCapacityFactor)   ← nuovo parametro opzionale, default 1
          brakeDecel per-bot (non più una costante unica per tutta la chiamata)
```

### Quattro precisazioni vincolanti (dall'approvazione utente)

1. **`corneringCapacity` è un contributo relativo alla capacità laterale
   (moltiplicatore adimensionale), non un valore di grip assoluto.** Non
   rappresenta "quanta aderenza ha l'auto" in senso fisico diretto, ma un
   fattore ~1 = capacità nominale, <1 = capacità ridotta (usura), fino a
   +15% = capacità aumentata (downforce ad alta velocità), eventualmente
   scontato da danno al fondo — la stessa scala già usata internamente da
   `lateralExcess`, ora solo esposta come funzione a sé. Va documentato come
   tale nel codice (commento sulla funzione estratta) per evitare che un
   futuro lettore lo scambi per un coefficiente di attrito assoluto.
2. **La scala con cui `gripCapacityFactor` entra in `cornerTargetSpeed` NON
   va assunta 1:1.** `corneringCapacity` è tarato come termine di un
   confronto domanda/eccesso in `corneringExcess` (con un proprio
   `CORNERING_EXCESS_PENALTY_MAX=0.40` che smorza l'effetto finale su
   grip-blend) — non è mai stato validato come moltiplicatore diretto di una
   velocità. `cornerSpeed = radius × turnRateAtMax × marginFactor` è a sua
   volta un limite cinematico (tasso di cambio di direzione), non un limite
   di accelerazione laterale: assumere che un fattore di capacità scali la
   velocità linearmente (anziché, es., con una radice quadrata come farebbe
   un vero limite `v = √(a_lat × r)`) è una scelta di design, non un fatto
   derivato. Per questo l'implementazione introduce un **esponente dedicato
   e tunabile** (`BOT_GRIP_CAPACITY_EXPONENT`, valore di partenza `1`,
   commentato esplicitamente come "valore di partenza, verificato via
   simulazione headless prima del playtest" — stesso stile di
   `DOWNFORCE_EXPONENT`/`CORNERING_EXPONENT`), applicato come
   `Math.pow(gripCapacityFactor, BOT_GRIP_CAPACITY_EXPONENT)`, invece di
   moltiplicare direttamente per `gripCapacityFactor`. La scala va
   confermata/aggiustata con la verifica headless del piano di test (vedi
   sotto), non lasciata come assunzione implicita.
3. **`BrakingModel.effectiveBrakeMult` è la fonte UNICA della fisica di
   frenata consultata dal bot.** Il bot non introduce una propria formula di
   decelerazione-da-usura: si limita a leggere `deps.effectiveBrakeMult(p,
   isQuali)` e a comporlo con `accel` esattamente come fa già
   `BrakingModel.effectiveBrakeMult` stesso (`BRAKE_MULT × wearFactor`) —
   zero duplicazione, zero deriva futura tra "quanto frena davvero l'auto" e
   "quanto pensa il bot che freni". Il bot deriva solo `brakeDecel = accel ×
   deps.effectiveBrakeMult(p, isQuali)`: nessuna nuova costante di
   decelerazione, nessun reshape locale del risultato.
4. **`F1_BOT_GRIP_AWARENESS` influenza solo la decisione del bot
   (`f1Bot.js`), mai la fisica reale del veicolo.** Il flag va letto
   **esclusivamente** dentro `f1Bot.js`, e solo nel punto in cui vengono
   generati gli input del bot (`updateBotInputs`) — non altrove nello stesso
   file, non nel tick loop generico. `CorneringGripModel.corneringCapacity`
   e `BrakingModel.effectiveBrakeMult` restano funzioni pure sempre
   disponibili e sempre chiamate incondizionatamente dalla fisica reale
   (`VehiclePhysics`/`CorneringGripModel.lateralExcess`/`BrakingModel.applyBrake`)
   indipendentemente da questo flag — che riguarda *solo* se il bot le
   consulta per calcolare i propri input, esattamente come un giocatore
   umano non ha mai bisogno di un flag per "sapere" quanto frena la propria
   auto. Nessun nuovo `process.env.F1_BOT_GRIP_AWARENESS` va introdotto
   dentro `backend/sockets/games/physics/`.

## Interfaccia proposta

| Funzione | Modulo proprietario | Stato | Consultata da |
|---|---|---|---|
| `corneringCapacity(p, isQuali)` | `CorneringGripModel` | **Nuova** (estratta da `lateralExcess`, stessa formula) | `lateralExcess` (uso esistente, invariato) **e** `f1Bot.js` via `deps` (nuovo, dietro `F1_BOT_GRIP_AWARENESS`) |
| `effectiveBrakeMult(p, isQuali)` | `BrakingModel` | Esistente, invariata | `BrakingModel.applyBrake` (uso esistente, invariato) **e** `f1Bot.js` via `deps` (nuovo, dietro `F1_BOT_GRIP_AWARENESS`) |
| `cornerTargetSpeed(..., gripCapacityFactor=1)` | `f1Bot.js` | Modificata: +1 parametro opzionale, applicato via `Math.pow(gripCapacityFactor, BOT_GRIP_CAPACITY_EXPONENT)` | `updateBotInputs` (entrambi i rami: racing-line e fallback geometrico) |
| `BOT_GRIP_CAPACITY_EXPONENT` | `f1Bot.js` | Nuova costante tunabile (partenza `1`) | Solo dentro `cornerTargetSpeed`/il punto di chiamata in `updateBotInputs` |
| `isBotGripAwarenessActive()` | `f1Bot.js` | Nuova, locale al modulo bot | `updateBotInputs` (mai da `physics/*`) |

## Flusso dati per tick

`tickGame` → `updateBotInputs(game, deps)` → per ogni bot, `isQuali` già noto
(`game.phase === 'qualifying'`):

- **Flag ON** (`F1_BOT_GRIP_AWARENESS=1`): `gripCapacityFactor =
  deps.corneringCapacity(p, isQuali)`; `brakeDecel = accel ×
  deps.effectiveBrakeMult(p, isQuali)`.
- **Flag OFF** (default): `gripCapacityFactor = 1`; `brakeDecel = accel ×
  brakeMult` — identico al comportamento attuale.
- Entrambi i valori passati a `cornerTargetSpeed` in **entrambi** i rami
  (racing-line `f1Bot.js:750`, fallback geometrico `f1Bot.js:841`) — devono
  restare sincronizzati, un ramo dimenticato produrrebbe un bot
  incoerente tra le piste con racing line precalcolata e quelle senza.
- `otherCarTargetSpeed` (`f1Bot.js:297-306`): **non modificata**, continua a
  chiamare `cornerTargetSpeed` senza il nuovo parametro → default 1.

## Edge case / invarianti garantiti

- **Flag OFF → comportamento bit-per-bit identico a oggi**, stessa
  disciplina di ogni fase precedente (Aero, TyreSlip, CorneringGripModel):
  `gripCapacityFactor=1` non altera
  `Math.min(maxSpeed, radius × turnRateAtMax × marginFactor × 1)`, e
  `brakeDecel` resta la stessa costante di oggi.
- **Qualifica**: `corneringGripFactor`/`brakingFactor`/`downforceFactor`
  tornano già 1 quando `isQuali=true` — grip-awareness converge da sola al
  comportamento attuale in quali, nessuna condizione `if (isQuali)` da
  scrivere in `f1Bot.js` per questo.
- **`damageParts` assente**: `getFloorDownforcePenalty` gestisce già
  l'assenza internamente (stesso invariante documentato in
  `AerodynamicsModel.js:14-16`) — nessuna nuova guardia necessaria in
  `f1Bot.js`.
- **Flag letto solo in `f1Bot.js`**: nessuna modifica a
  `backend/sockets/games/physics/*` cambia comportamento in base a
  `F1_BOT_GRIP_AWARENESS` — verificabile a colpo d'occhio con un grep sul
  flag dopo l'implementazione (deve comparire solo in `f1Bot.js`).

## Test plan

- `CorneringGripModel.test.js`: `corneringCapacity(p, isQuali)` produce
  esattamente lo stesso valore che oggi calcola inline `lateralExcess`
  (matrice usura × isQuali × velocità × danno) — regressione
  dell'estrazione, zero cambio di formula.
- `f1Bot.test.js`: `cornerTargetSpeed` senza `gripCapacityFactor` (o con
  valore 1) → invariato rispetto a oggi; con fattore <1 → velocità di curva
  e punto di frenata più cauti; con fattore >1 (downforce ad alta velocità)
  → velocità più alta, sempre limitata da `Math.min(maxSpeed, ...)`.
- Test di parità flag OFF: bot con `F1_BOT_GRIP_AWARENESS` non impostato
  produce input identici a prima della modifica (stesso pattern "flag
  spento = identico" già usato per le fasi Aero/TyreSlip).
- Test di parità qualifica: flag ON in qualifica → identico a flag OFF
  (regressione diretta sulla neutralità di `isQuali` già garantita da
  `TyreForceModel`).
- Verifica headless in stile `f1LapSimulator`/`f1Testbench` (fuori
  dall'esecuzione della suite `node:test`, come da convenzione già in uso
  per le fasi precedenti): con gomma molto usurata e flag attivo, il bot
  deve frenare prima e prendere le curve più piano rispetto a gomma nuova —
  confronto diretto, non solo unit test isolati.
- **Verifica di non-eccessiva-prudenza** (stessa sessione headless sopra):
  con gomma nuova (`tyreWear=0`) e in condizioni di alta downforce (alta
  velocità, `speedFrac` vicino a 1), il tempo sul giro/la velocità in curva
  del bot a flag attivo **non deve peggiorare** rispetto al flag spento —
  `gripCapacityFactor` in queste condizioni è ≥1 (capacità nominale o
  aumentata da downforce, mai <1), quindi un peggioramento misurato
  indicherebbe un bug nella direzione del fattore o nell'esponente di scala
  (punto 2 sopra), non un effetto voluto. Verificare esplicitamente che il
  bot non diventi "inutilmente conservativo" proprio nel caso in cui la
  fisica reale gli darebbe più margine, non meno.
- Grep di verifica architetturale: `F1_BOT_GRIP_AWARENESS` deve comparire
  solo in `f1Bot.js`, mai in `backend/sockets/games/physics/`.

## Rollout

Stessa disciplina di ogni fase precedente: flag **spento di default**,
nessuna promozione a default-on senza playtest esplicito dell'utente in
localhost. Verifica headless (sopra) prima ancora di chiedere il playtest,
per non far scoprire regressioni grossolane direttamente in browser.

## Cosa NON fa questo documento

- Non tocca aggressività, logica di sorpasso o `otherCarTargetSpeed`
  (esplicitamente fuori scope, vedi sopra).
- Non introduce strategia gomme/pit o riparazione danno per componente.
- Non modifica `BrakingModel`, `CorneringGripModel.lateralExcess`,
  `AerodynamicsModel` o qualunque altro consumer esistente di
  `corneringCapacity`/`effectiveBrakeMult` — sono estratte/riusate, non
  riscritte.
- Non decide se/quando `F1_BOT_GRIP_AWARENESS` verrà promosso a default-on —
  materia di playtest, non di questo documento.
- Non contiene codice.
