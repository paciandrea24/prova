# F1 Track Editor — traguardo posizionabile a mano

## Contesto

Il primo di una serie di migliorie al track editor (`frontend/track-editor.html`
+ `track-editor.js`), individuate durante un brainstorming più ampio (altre:
salite più alte, feedback live giri/lunghezza, vista di profilo laterale,
inserimento punto in mezzo al tracciato, undo più completo, snap a
griglia/angolo — trattate come sotto-progetti separati, non in questo giro).

Oggi la linea del traguardo (e tutto ciò che ne dipende) **non è un dato
esplicito**: viene sempre dedotta dal primo control point del tracciato
(`controlPoints[0]`) e dalla tangente della curva in quel punto. Questo è
anche la causa diretta del bug di deriva osservato oggi su Monte Rosso
(`qualiSpawn`/`gridSpawnPoint` che si scostano dai valori storici oltre la
tolleranza del test): la tangente reale nel punto di saldatura del giro
(Catmull-Rom) non è mai perfettamente quella assunta, e l'errore si
amplifica con la distanza dal punto 0.

## Obiettivo

L'utente piazza e orienta il traguardo a mano nell'editor, con un marker
dedicato trascinabile + maniglia di rotazione (stesso meccanismo già usato
per l'overlay immagine di riferimento). La posizione/direzione esplicita
sostituisce l'assunzione "punto 0 = traguardo" ovunque nel codice, con piena
compatibilità all'indietro per le piste che non hanno ancora questo dato.

## Vincoli/verifiche dal codice esistente

Punti del codice che oggi assumono "indice campione 0 = traguardo",
individuati leggendo il codice (non per sentito dire):

- `backend/sockets/games/trackLoader.js:70-83` (`buildTrack`): `p0 = points[0]`,
  `tangent`/`normal` calcolati con `TrackGeometry.tangentAt(points, 0, true)` /
  `normalAt(points, 0, true)`; `alongTrack()` usa questi per `qualiSpawn`
  (riga 119) e `gridSpawnPoint` (riga 85-88).
- `backend/sockets/games/f1GameSocket.js:1027` — `HALF_LAP_IDX =
  Math.floor(N_SAMPLES / 2)`, costante di **modulo** (non per-pista), sempre
  500 dato `N_SAMPLES` fisso.
- `backend/sockets/games/f1GameSocket.js:1084` — checkpoint anti-taglio:
  `circularWithin(idx, HALF_LAP_IDX, n, checkpointWindowFor(game.track))`,
  target fisso a 500.
- `backend/sockets/games/f1GameSocket.js:1088` — zona traguardo:
  `circularWithin(idx, 0, n, finishWindowFor(game.track))`, target fisso a 0.
- `frontend/shared/trackMeshBuilder.js:173-175` (`buildStartLine`):
  `p0 = pts[0], p1 = pts[1]`, angolo dedotto da questi due punti — usata sia
  dall'editor (`track-editor.js:233`) sia (verificare in Task 1 del piano)
  dal rendering del gioco vero.
- Pattern già esistente da riusare: `pitEntryIndex` (`trackLoader.js:90-105`)
  già calcola "indice campione più vicino a un punto esplicito" via
  `TrackGeometry.nearestPoint` — stessa tecnica per `startFinishIndex`.
- Interazione drag+rotazione già implementata per l'overlay immagine
  (`track-editor.js:59-113`, in particolare `updateImageHandles` e il
  calcolo angolo in `mousemove`, riga 439-441: `Math.atan2(-dx, -dz)`) —
  stesso pattern da riusare per la maniglia di rotazione del traguardo.

## Modifiche

### 1. Schema pista (JSON)

Nuovo campo opzionale a livello radice:

```json
"startFinish": { "x": 0, "z": 0, "angle": 0 }
```

Assente in tutte le piste esistenti (monte-rosso, new-monza, prova,
interlagos) finché l'utente non le riapre e risalva nell'editor — comportamento
identico a oggi finché il campo non c'è.

### 2. `backend/sockets/games/trackLoader.js`

In `buildTrack`:
- Se `raw.startFinish` esiste: `startFinishIndex =
  TrackGeometry.nearestPoint(points, raw.startFinish.x, raw.startFinish.z).index`.
  Altrimenti `startFinishIndex = 0` (comportamento odierno).
- `tangent`/`normal` per `alongTrack()` calcolati su `points[startFinishIndex]`
  invece che sempre su `points[0]`.
- Se `raw.startFinish.angle` è presente, usato come `angle` restituito da
  `alongTrack()` invece di quello dedotto dalla tangente (l'utente può aver
  orientato il traguardo diversamente dalla tangente pura, es. per una
  linea leggermente obliqua).
- Esportare `startFinishIndex` sull'oggetto track (stesso trattamento di
  `pitEntryIndex`).

### 3. `backend/sockets/games/f1GameSocket.js`

In `checkLap` (e dovunque referenzi la zona traguardo/checkpoint):
- Zona traguardo: `circularWithin(idx, track.startFinishIndex || 0, n,
  finishWindowFor(game.track))` invece del fisso `0`.
- Checkpoint a metà giro: target `(  (track.startFinishIndex || 0) +
  HALF_LAP_IDX) % n` invece del fisso `HALF_LAP_IDX`. `HALF_LAP_IDX` resta
  la costante di modulo (metà campioni), ma il bersaglio effettivo diventa
  relativo alla pista.

### 4. `frontend/shared/trackMeshBuilder.js`

`buildStartLine(container, pts, roadHalf, startIndex = 0)`: usa
`pts[startIndex]`/`pts[(startIndex + 1) % pts.length]` invece dei fissi
`pts[0]`/`pts[1]`. Parametro con default `0` → tutte le chiamate esistenti
(gioco vero, editor su piste senza `startFinish`) restano invariate senza
modifiche al call site, finché non si passa esplicitamente l'indice.

### 5. Editor (`track-editor.js` + `track-editor.html`)

- Nuovo marker indipendente da `mainPoints`/`pitPoints` (colore distinto,
  es. bianco/nero a scacchi o una freccia), trascinabile con lo stesso
  meccanismo di `dragging`/`pickMarker` già esistente per i punti pista
  (aggiunta di un terzo "tipo" oltre a `main`/`pit`).
- Maniglia di rotazione riusando il pattern già scritto per
  `imageOverlay`/`rotateHandleMesh` (righe 90-107, 439-441): un handle
  offset dal marker, trascinato per impostare l'angolo via `atan2`.
- Stato iniziale: se la pista caricata non ha `startFinish`
  (`applyTrackData`, righe 548-575), il marker si posiziona di default a
  `mainPoints[0]` con angolo dedotto allo stesso modo di oggi (nessuna
  differenza visibile finché l'utente non lo trascina).
- `buildTrackData()` (righe 665-684): aggiunge `startFinish: {x, z, angle}`
  all'oggetto esportato/salvato.
- `rebuild()` (riga 220): passa l'indice campione più vicino al marker a
  `TrackMeshBuilder.buildStartLine` per l'anteprima nell'editor stesso.

## Testing

- `trackLoader.test.js`: nuovo test con una pista fittizia che include
  `startFinish` esplicito (diverso dal control point 0) — verifica che
  `qualiSpawn`/`gridSpawnPoint` seguano il punto esplicito, non più il
  punto 0. Test di regressione: una pista SENZA `startFinish` produce
  `qualiSpawn`/`startFinishIndex` identici a quelli di oggi (nessuna
  rottura per le piste esistenti).
- `f1GameSocket.js`: `backend/sockets/games/f1GameSocket.physics.test.js`
  copre già `checkLap`/`HALF_LAP_IDX`/`finishWindowFor` — aggiungere un
  caso con `startFinishIndex` non-zero per confermare che zona traguardo e
  checkpoint si spostano di conseguenza.
- Editor: nessuna infrastruttura di test automatico esistente (browser-only,
  stesso limite già documentato per gli altri lavori su questo file) —
  verifica manuale in localhost.

## Fuori scope

- Le altre migliorie identificate nel brainstorming (salite più alte,
  feedback live giri/lunghezza, vista di profilo laterale, inserimento
  punto in mezzo, undo più completo, snap a griglia/angolo) — sotto-progetti
  separati, un giro di spec/piano ciascuno.
- Ri-tarare la tolleranza del test di regressione Monte Rosso già fallito
  oggi (`trackLoader.test.js:33`) — quel test resta scoperto finché
  qualcuno non riapre Monte Rosso nell'editor e non piazza esplicitamente il
  traguardo (a quel punto il problema si risolve alla radice, non serve più
  allargare la tolleranza).
