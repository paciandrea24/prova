# F1 — Editor di tracciati + pipeline mappe multiple

Data: 2026-07-19
Stato: approvato (design), in attesa di piano di implementazione

## Problema

Oggi il tracciato F1 ("Monte Rosso") è definito due volte, a mano, in due file diversi:

- `frontend/f1.js` — punti di controllo di una curva Catmull-Rom, usati per costruire la mesh 3D (ribbon, cordoli, barriere).
- `backend/sockets/games/f1GameSocket.js` — funzioni piecewise `leftCX`/`rightCX` che approssimano a mano la stessa forma, usate per il fuoripista, più `PIT_PATH`, `SPAWN_POINTS`, griglia di partenza e checkpoint anti-taglio, tutti hardcoded.

Le due definizioni possono disallinearsi silenziosamente. Creare o modificare una pista oggi significa editare array di coordinate a mano in entrambi i file. L'utente vuole disegnare il layout dei tracciati lui stesso (le tribune/ambientazioni le cura Claude separatamente, fuori da questo lavoro) e serve uno strumento in-repo, senza tool esterni o asset da cercare online per questa parte.

## Obiettivo

1. Un formato dati unico per pista (JSON) che sia l'unica fonte di verità.
2. Un modulo di geometria condiviso (JS puro, no dipendenze) usato identicamente da frontend e backend per campionare quel JSON.
3. Un editor visuale in-browser (dev-only) per disegnare/modificare tracciate senza toccare codice.
4. Backend e frontend che leggono le piste dal JSON invece che da codice hardcoded.
5. Selezione della pista in lobby, con numero di giri calcolato automaticamente dalla lunghezza.

## Formato dati pista

File `frontend/tracks/<id>.json`, uno per pista:

```json
{
  "id": "monte-rosso",
  "name": "Monte Rosso",
  "targetKm": 4.5,
  "roadHalfWidth": 11,
  "controlPoints": [
    { "x": -30, "z": 0 },
    { "x": -30, "z": 60 },
    { "x": -16, "z": 82, "y": 0 }
  ],
  "pit": {
    "roadHalfWidth": 5,
    "boxIndex": 4,
    "entryTrigger": { "xMax": -36, "zMin": -3, "zMax": 15 },
    "path": [
      { "x": -30, "z": 0 },
      { "x": -42, "z": 10 }
    ]
  }
}
```

Regole:

- `controlPoints`: punti di controllo del loop chiuso principale, interpolati con Catmull-Rom centripeta (stessa tecnica già in uso in `f1.js`). `y` opzionale, default 0 — dislivello **solo visivo** (vedi sotto).
- `pit.path`: corsia box, **obbligatoria** per ogni pista. Diverge dal tracciato principale e vi rientra più avanti. `boxIndex` è l'indice in `pit.path` dove l'auto si ferma.
- `pit.entryTrigger`: riquadro allineato agli assi (come oggi) che, se attraversato, avvia l'autopilota verso il box. Va posizionato su un tratto rettilineo del tracciato principale (stesso vincolo implicito già presente oggi).
- `roadHalfWidth` / `pit.roadHalfWidth`: larghezza costante per pista (non variabile punto per punto).
- `targetKm`: distanza di gara target in km. Sostituisce il campo "giri" nelle impostazioni lobby.
- Nessun campo per checkpoint, griglia di partenza o linea del traguardo: sono tutti derivati automaticamente (vedi sotto).

## Derivazioni automatiche

Con `controlPoints` campionati in N punti equidistanti ordinati nel verso di marcia:

- **Linea di partenza/traguardo**: punto campionato `0`.
- **Checkpoint anti-taglio** (equivalente all'attuale "checkpoint A"): punto campionato a metà del giro (indice `N/2`). Un giro conta solo se il giocatore ha toccato quell'indice dall'ultimo passaggio sul traguardo.
- **Griglia di partenza**: due corsie sfalsate lungo la normale al punto `0` (stessa geometria delle attuali `GRID_LANE_X`/`GRID_STAGGER_Z`, ma calcolata dalla tangente/normale locale invece che da coordinate assolute — così funziona per qualunque orientamento del rettilineo di partenza).
- **Numero di giri**: `round(targetKm × 1000 / lunghezza_giro)`, minimo 1. Nessuna scelta manuale in lobby.

## Modulo di geometria condiviso

Nuovo file `frontend/shared/trackGeometry.js`. Nessuna dipendenza esterna (niente Three.js lato backend). Esporta, sia come globale browser (`window.TrackGeometry`, caricato con `<script>`) sia come `module.exports` (Node `require`):

- `sampleLoop(controlPoints, samples)` → array di `{x, y, z}` campionati equidistanti sul loop chiuso (stessa curva centripeta oggi hardcoded in `f1.js`).
- `lapLength(points)` → lunghezza totale del giro.
- `nearestIndexNear(points, prevIndex, x, z, window)` → ricerca locale finestrata (stessa tecnica dell'attuale `updateTrackIndex`), evita ambiguità nel punto di saldatura.
- `tangentAt(points, i)`, `normalAt(points, i)` → per derivare griglia e larghezza carreggiata.

Sia `f1.js` (rendering mesh) sia `f1GameSocket.js` (fisica/fuoripista/progresso) chiamano `sampleLoop` sugli stessi `controlPoints` presi dallo stesso file JSON: la forma della pista è definita in un solo posto.

## Editor

Pagina dev-only `frontend/track-editor.html` + `frontend/track-editor.js` (stesso spirito di `frontend/minimap-gen.html`), non collegata dalla lobby, aperta manualmente in locale.

- Scena Three.js in vista top-down ortografica con griglia di riferimento.
- Click per aggiungere un punto di controllo al tracciato principale; drag per spostarlo in x/z; maniglia dedicata per regolare `y` (dislivello visivo).
- La ribbon (cordoli/barriere) si aggiorna live riusando `buildRibbon`/`buildCurbs`/`buildBarriers` di `f1.js` sui punti campionati da `TrackGeometry.sampleLoop`.
- Toggle "modalità pit lane": disegna `pit.path` separatamente, un click marca `boxIndex`, un riquadro trascinabile definisce `entryTrigger`.
- Campi numerici per `id`, `name`, `targetKm`, `roadHalfWidth`, `pit.roadHalfWidth`.
- Pulsante "Esporta" → scarica il JSON pronto da salvare in `frontend/tracks/`.

## Integrazione backend

`backend/sockets/games/f1GameSocket.js`:

- Rimuove `leftCX`, `rightCX`, gli array hardcoded `TRACK_POINTS`/`PIT_PATH`/`SPAWN_POINTS`/`GRID_LANE_X` e le costanti di griglia assolute.
- Legge il JSON della pista attiva (`fs.readFileSync` da `frontend/tracks/<trackId>.json`), chiama `TrackGeometry.sampleLoop` per ottenere `TRACK_POINTS`, deriva `PIT_PATH` da `pit.path` (invariato, non ricampionato), griglia/checkpoint/traguardo come da sezione "Derivazioni automatiche".
- `nearestTrackDist`, `updateTrackIndex`, `progressScore`, la logica di pit-stop autopilota: restano quasi identiche, già scritte in modo generico rispetto a `TRACK_POINTS`.
- Il numero di giri (`totalLaps`) è calcolato da `targetKm` e `lapLength` invece di essere letto da `gameSettings`.

## Integrazione frontend

`frontend/f1.js`:

- `circuitCtrlPoints()` hardcoded viene sostituita da un `fetch('/tracks/<trackId>.json')` seguito da `TrackGeometry.sampleLoop(controlPoints, N_SAMPLES)`.
- Costruzione ribbon/cordoli/barriere/pit lane invariata, ma sui punti risultanti dal fetch invece che da coordinate scritte nel file.
- Se `y` è presente nei punti campionati, viene applicato alla mesh della pista e, solo visivamente, all'altezza della mesh dell'auto (interpolata dal punto più vicino sul tracciato). La fisica lato server resta interamente 2D (x/z): nessun cambiamento ad accelerazione, attrito, aderenza o collisioni.

## Selezione pista in lobby

`frontend/lobby.js` + relativa UI:

- Il campo "giri" nelle impostazioni F1 viene rimosso.
- Nuovo menù a tendina "Pista", popolato da una route `GET /api/f1/tracks` che fa `fs.readdir` su `frontend/tracks/` e restituisce `{id, name}` per ogni file.
- Il valore scelto viaggia nei settings di lobby come `trackId`, passato al server alla creazione della partita.

## Migrazione

"Monte Rosso" diventa `frontend/tracks/monte-rosso.json`, generato a partire dagli attuali punti di `circuitCtrlPoints()` in `f1.js` (non dalle funzioni `leftCX`/`rightCX`, che erano solo un'approssimazione lato server) — la pista visibile oggi deve restare geometricamente identica dopo la migrazione. `targetKm` per Monte Rosso va calibrato sulla lunghezza di giro esistente in modo che il numero di giri calcolato automaticamente corrisponda a quello attuale (10 giri, valore di default odierno in lobby).

## Fuori scope

- Fisica in pendenza (accelerazione/aderenza in salita o discesa, salti, sovrapposizioni ponte/sottopasso): il dislivello resta puramente visivo.
- Tribune, ambientazione naturale e non (verranno aggiunte separatamente da Claude, dopo che una pista è stata disegnata e approvata).
- Editor "a pezzi ad incastro" o parametrico: solo disegno libero di punti di controllo.
- Modifiche al sistema di collisione auto-auto (SAT) o alla fisica di guida generale.
- Checkpoint multipli o piazzabili a mano: resta un solo checkpoint anti-taglio, derivato automaticamente a metà giro.
