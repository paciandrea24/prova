# F1 — simulatore headless di giro per misurare il gap bot vs umano

## Contesto

Sulla pista Monza, l'utente gira in ~20s in qualifica, i bot in ~27-30s
(rapporto ~1.4x, coerente con l'ultimo dato registrato in
[[project_f1_bot_ai]]). Il confronto è isolato: giro secco di qualifica,
nessun traffico/scia/sorpasso (quella logica in `f1Bot.js` è comunque
disattivata in qualifica — vedi `!isQuali` in `updateBotInputs`), quindi il
tempo del bot dipende solo da `cornerTargetSpeed`, `apexOffset`,
`steerToward` e dai moltiplicatori `botSpeedFactor`/`botLapPaceMult`.

Il problema di fondo, già segnato in [[feedback_bot_ai_physics_over_heuristics]]:
non esiste oggi un modo di misurare ESATTAMENTE dove il bot perde tempo
(quale curva, quanto) senza un giro in browser. La sessione precedente ha già
pagato il costo di 4 round di tuning "a sensazione" prima di passare a un
modello fisico esatto; qualunque ulteriore stretta ai margini rischia di
ripetere lo stesso pattern se non è verificabile in numeri.

Requisito esplicito dell'utente: qualunque modifica successiva ai bot deve
restare coerente su **tutte** le piste esistenti e future (non solo Monza) —
i bot devono dare sfida, non essere "un'aggiunta inutile perché lentissimi"
su una pista con geometria diversa da quella su cui si è tarato.

Questo documento copre **solo la fase di misura**: uno strumento headless
(nessun browser, nessuna modifica al comportamento reale dei bot in
partita) che fa girare un bot con la fisica esatta del server e riporta
tempo sul giro + telemetria, su qualunque pista. Le modifiche vere e proprie
ai bot (fase 2) si decidono sui numeri che questo strumento produce, non
prima.

Architettura di riferimento esplorata prima del design:

- `backend/sockets/games/f1GameSocket.js` — `tickGame()` è la sequenza di
  riferimento per un tick fisico: `updateBotInputs()` → `updateVelocity()`
  (throttle/brake/friction, poi sterzo dipendente da velocità, poi blend
  vx/vz via `GRIP`) → 13 sottostep di `integratePosition()` +
  `applyBridgeBarrier()` → `applyOffTrackDrag()` → `updateTrackIndex()` →
  `checkLap()` (checkpoint a metà giro + zona traguardo, via
  `circularWithin`/`checkpointWindowFor`/`finishWindowFor`/`HALF_LAP_IDX`).
  `p.time` a fine giro è `Date.now() - game.raceStartTime`, cioè
  tick trascorsi × `PHYSICS_TICK_MS` (50ms) — riproducibile esattamente
  contando i tick in una simulazione offline.
- `backend/sockets/games/f1Bot.js` — `updateBotInputs(game, deps)` scrive
  solo `p.inputs`; i valori di taratura (`BOT_CORNER_SPEED_MARGIN`,
  `BOT_APEX_MAX_FRACTION`, `BOT_BRAKING_DISTANCE_MARGIN`, ecc.) sono oggi
  `const` di modulo, non passabili dall'esterno.
- `backend/sockets/games/trackLoader.js` — `loadTrack(id)`/`listTracks()`
  funzionano già in isolamento (solo `fs` + `TrackGeometry`), nessuna
  dipendenza da socket/lobby: riusabili as-is da uno script standalone.
- `backend/sockets/games/f1Bot.test.js` — convenzione esistente per test
  puri (`node:test`, nessun harness aggiuntivo).

## Approccio scelto e alternative scartate

**Riuso diretto della fisica server via export additivi (scelto).** Le
costanti/funzioni pure di `f1GameSocket.js` necessarie a un giro in solitaria
(`ACCEL`, `BRAKE_MULT`, `TURN_SPEED_HIGH`, `PHYSICS_TICK_MS`,
`COLLISION_SUBSTEPS`, `effectiveMaxSpeed`, `updateVelocity`,
`integratePosition`, `applyOffTrackDrag`, `applyBridgeBarrier`,
`updateTrackIndex`, `circularWithin`, `checkpointWindowFor`,
`finishWindowFor`, `HALF_LAP_IDX`) vengono esposte come proprietà aggiuntive
sulla funzione già esportata (`module.exports.physics = {...}`), senza
toccare la firma chiamata da `socketManager.js`. Alternativa scartata:
duplicare le formule fisiche nello script — stesso errore di principio già
corretto una volta nella sessione bot (modello a parte che può divergere
silenziosamente da quello reale).

**Tuning dei bot parametrizzabile invece che hardcoded (scelto).** Le
costanti di taratura in `f1Bot.js` diventano un oggetto `DEFAULT_TUNING`;
`updateBotInputs(game, deps)` accetta un `deps.tuning` opzionale che
sovrascrive i default (merge shallow). Il call site esistente in
`f1GameSocket.js` non passa `tuning` → comportamento identico ad oggi,
zero rischio di regressione. Necessario per poter confrontare, dallo
strumento, "margini di oggi" vs "margini rilassati" sulla stessa pista senza
editare il file.

**Nessun secondo modello fisico "tempo ideale assoluto" (scartato per
questa fase).** Un limite teorico calcolato in modo indipendente
dall'algoritmo del bot (traiettoria ottimale astratta, fuori-dentro-fuori)
darebbe un soffitto assoluto, ma è un secondo modello fisico da scrivere e
mantenere sincronizzato con `ACCEL`/`BRAKE_MULT`/`TURN_SPEED_*` ogni volta
che cambiano altrove. Scartato su decisione esplicita dell'utente: il
confronto default-vs-margini-rilassati (vedi sotto) basta a separare
"quanto costa la prudenza" da "quanto costa l'algoritmo stesso", che è
l'informazione che serve per decidere la fase 2. Se anche a margini
rilassati il gap restasse ampio, sapremo già che il problema è la
traiettoria (es. il bot oggi taglia solo verso l'apice, non allarga mai sul
lato esterno in entrata/uscita curva come farebbe un pilota vero) senza
bisogno di un soffitto assoluto per scoprirlo.

## Design

### Export fisica da `f1GameSocket.js`

Aggiunta additiva in fondo al file:

```js
module.exports.physics = {
    PHYSICS_TICK_MS, COLLISION_SUBSTEPS,
    ACCEL, BRAKE_MULT, TURN_SPEED_HIGH,
    effectiveMaxSpeed, updateVelocity, integratePosition,
    applyOffTrackDrag, applyBridgeBarrier, updateTrackIndex,
    circularWithin, checkpointWindowFor, finishWindowFor, HALF_LAP_IDX
};
```

Nessuna modifica alle funzioni stesse, solo visibilità esterna.

### Tuning parametrizzabile in `f1Bot.js`

```js
const DEFAULT_TUNING = {
    cornerSpeedMargin: BOT_CORNER_SPEED_MARGIN,
    apexMaxFraction:   BOT_APEX_MAX_FRACTION,
    brakingDistanceMargin: BOT_BRAKING_DISTANCE_MARGIN,
    // ... resto delle costanti già esistenti usate in updateBotInputs
};
```

`updateBotInputs(game, deps)` legge `const tuning = { ...DEFAULT_TUNING,
...(deps.tuning || {}) }` e usa `tuning.*` al posto delle costanti dirette
nei punti in cui oggi le usa. Le costanti di modulo restano come default,
solo la lettura diventa indiretta.

### `backend/tools/f1LapSimulator.js`

Script CLI, nessuna dipendenza da socket.io/Express — solo `trackLoader`,
`f1Bot`, e `physics` esportata da `f1GameSocket.js`.

**Loop di simulazione** (per un giro di qualifica, un solo bot):

1. Costruisce un player nello stesso shape di `createBots` (isolato:
   `isBot:true`, spawn a `track.qualiSpawn`), con `botSpeedFactor`,
   `botLapPaceMult`, `botPrecisionNoise` fissi (default: `1, 1, 0` — bot
   deterministico, "il miglior caso possibile", nessuna casualità), tutti
   sovrascrivibili da CLI.
2. Ad ogni tick: `updateBotInputs({track, phase:'qualifying', players:{X:p}},
   deps)` con `deps.tuning` opzionale → `physics.updateVelocity(p, true, 1)`
   → 13× (`physics.integratePosition(p, 1/13)` +
   `physics.applyBridgeBarrier(p, track)`) → `physics.applyOffTrackDrag(p,
   track)` → `physics.updateTrackIndex(p, track)` → replica minimale della
   logica di `checkLap` (stesso `circularWithin`/`checkpointWindowFor`/
   `finishWindowFor`/`HALF_LAP_IDX` importati, non reinventati) per rilevare
   checkpoint a metà giro e chiusura sul traguardo.
3. Registra per ogni tick: velocità (km/h, stessa conversione `speed*55`
   usata altrove), `trackIndex`, x/z.
4. Si ferma al giro completato o a un tetto di sicurezza (60s simulati) —
   oltre quel tetto riporta "non finito" invece di girare all'infinito (pista
   nuova mal disegnata, bot incastrato contro una barriera, ecc.).

**Output**:

- Tempo totale del giro (ms, da conteggio tick × `PHYSICS_TICK_MS`).
- Telemetria completa scritta su file (JSON) per ispezione puntuale.
- Riepilogo a schermo: le N curve con la velocità minima più bassa lungo il
  giro (posizione % giro + km/h), per individuare a colpo d'occhio dove si
  perde di più senza aprire il file.

**Modalità CLI**:

- `node backend/tools/f1LapSimulator.js <trackId>` — singola pista, tuning
  di default (quella davvero in uso in partita oggi).
- `--all-tracks` — gira sullo stesso bot deterministico su ogni pista
  presente in `frontend/tracks/` (via `listTracks()`), stampa una tabella
  riassuntiva (pista, tempo, curva peggiore) — verifica esplicita che i
  numeri non siano un caso isolato di Monza.
- `--preset=zero-margin` — stessa pista, con `cornerSpeedMargin:1.0`,
  `brakingDistanceMargin:1.0`, `apexMaxFraction:1.0` passati come `tuning`:
  quanto tempo si guadagna solo togliendo la prudenza, a parità di
  algoritmo/traiettoria.
- Flag opzionali per sovrascrivere `botSpeedFactor`/`botLapPaceMult`/
  `botPrecisionNoise` da riga di comando, per isolare l'effetto di ciascuno.

## Testing

- **Smoke test automatico** (`backend/tools/f1LapSimulator.test.js`,
  `node:test`, stesso stile di `f1Bot.test.js`): con tuning di default, il
  simulatore completa il giro entro il tetto di sicurezza su ogni pista
  presente in `frontend/tracks/` — regressione a costo quasi zero: se una
  modifica futura o una pista nuova manda un bot in loop/fuori pista
  permanente, si scopre qui, non in un playtest browser.
- **Verifica manuale della fase 1** (l'utente esegue lo script, non serve
  browser):
  1. `node backend/tools/f1LapSimulator.js monza` → il tempo riportato è
     nell'intorno del 27-30s osservato in browser (conferma che la
     simulazione riproduce fedelmente il comportamento reale, altrimenti lo
     strumento stesso è da correggere prima di fidarsene).
  2. `--all-tracks` → nessuna pista risulta "non finita"; tempi coerenti con
     la lunghezza/difficoltà relativa di ciascuna pista.
  3. `--preset=zero-margin` su Monza → quantifica quanto della differenza
     attuale è dovuto ai margini di sicurezza.
- **Fuori scope** (fase 2, dopo aver visto i numeri): qualunque modifica al
  comportamento reale dei bot in partita, riscrittura della traiettoria
  fuori-dentro-fuori, tempo-limite teorico indipendente, interfaccia grafica.
