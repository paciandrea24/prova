# F1 Track Editor — traguardo posizionabile a mano — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'utente piazza e orienta il traguardo a mano nell'editor (marker trascinabile + maniglia di rotazione), sostituendo l'assunzione "indice campione 0 = traguardo" usata oggi per spawn, conteggio giri e linea visiva — con piena compatibilità all'indietro per le piste che non hanno ancora questo dato.

**Architecture:** Nuovo campo opzionale `startFinish: {x, z, angle}` nello schema pista. `trackLoader.js` calcola `startFinishIndex` (indice campionato più vicino, stessa tecnica già usata per `pitEntryIndex`) e lo usa per `qualiSpawn`/`gridSpawnPoint`; `f1GameSocket.js` lo usa per la zona traguardo e il checkpoint anti-taglio del conteggio giri; `trackMeshBuilder.js` lo usa per disegnare la linea nel punto giusto. Se il campo è assente, tutto ricade sul comportamento odierno (indice 0).

**Tech Stack:** Node.js (`node:test` per backend), Three.js r128 lato client (nessun test automatico per `frontend/track-editor.js`/`trackMeshBuilder.js`, browser-only senza infrastruttura di test esistente per questi file).

## Global Constraints

- **Italiano** in commenti/comunicazioni (da CLAUDE.md di progetto).
- **Niente commit automatici**: l'utente fa commit/push manualmente quando vuole. Ogni task termina con la verifica, MAI con un comando `git commit`.
- **Compatibilità all'indietro obbligatoria**: nessuna pista esistente (monte-rosso, new-monza, prova, interlagos) deve cambiare comportamento finché non viene riaperta e risalvata nell'editor con un `startFinish` esplicito.
- Nessuna modifica alla fisica di gioco (velocità, aderenza, danno) — solo posizione/orientamento di spawn, zona traguardo/checkpoint, e rendering della linea.

---

### Task 1: `trackLoader.js` — `startFinishIndex` e `startFinish` opzionale

**Files:**
- Modify: `backend/sockets/games/trackLoader.js:54-124` (`buildTrack`), `:161-190` (`validateTrackData`)
- Test: Modify `backend/sockets/games/trackLoader.test.js`

**Interfaces:**
- Consumes: nessuna da altri task.
- Produces: `track.startFinishIndex` (number, indice campionato 0..999), `track.qualiSpawn`/`track.gridSpawnPoint(i)` che seguono il punto esplicito quando presente. Consumato da Task 2 (`f1GameSocket.js`) e Task 3 (editor, per il rendering della linea).

- [ ] **Step 1: Scrivere i test che falliscono**

In `backend/sockets/games/trackLoader.test.js`, aggiungere in fondo al file (dopo l'ultimo test esistente):

```js
test('buildTrack: senza startFinish, startFinishIndex è 0 (comportamento odierno invariato)', () => {
    const track = loadTrack('monte-rosso');
    assert.equal(track.startFinishIndex, 0);
});

test('saveTrack + loadTrack: con startFinish esplicito, qualiSpawn/gridSpawnPoint seguono quel punto (non più il control point 0)', () => {
    // Quadrato semplice: startFinish sul lato opposto al control point 0,
    // così un eventuale bug "ignora startFinish e usa comunque indice 0"
    // produce uno scarto enorme (non un piccolo errore di arrotondamento).
    const data = Object.assign({}, minimalValidTrackData(), {
        id: 'test-scratch-startfinish',
        startFinish: { x: 10, z: 10, angle: 0 }
    });
    saveTrack(data);
    try {
        const track = loadTrack('test-scratch-startfinish');
        // Il control point più vicino a (10,10) tra quelli del quadrato di
        // test (0,0)-(10,0)-(10,10)-(0,10) è l'indice campionato vicino a
        // (10,10): qualiSpawn deve stare vicino lì, non vicino a (0,0).
        assert.ok(Math.hypot(track.qualiSpawn.x - 10, track.qualiSpawn.z - 10) < 5,
            `qualiSpawn troppo lontano da (10,10): ${JSON.stringify(track.qualiSpawn)}`);
        assert.notEqual(track.startFinishIndex, 0);
    } finally {
        deleteTrack('test-scratch-startfinish');
    }
});

test('saveTrack: con startFinish.angle esplicito, qualiSpawn.angle usa quel valore invece della tangente dedotta', () => {
    const data = Object.assign({}, minimalValidTrackData(), {
        id: 'test-scratch-startfinish-angle',
        startFinish: { x: 0, z: 0, angle: 1.2345 }
    });
    saveTrack(data);
    try {
        const track = loadTrack('test-scratch-startfinish-angle');
        assert.ok(Math.abs(track.qualiSpawn.angle - 1.2345) < 1e-9);
    } finally {
        deleteTrack('test-scratch-startfinish-angle');
    }
});

test('validateTrackData: startFinish malformato (manca x o z) viene rifiutato', () => {
    const data = Object.assign({}, minimalValidTrackData(), {
        id: 'test-scratch-startfinish-bad',
        startFinish: { z: 0, angle: 0 }
    });
    assert.throws(() => saveTrack(data), /startFinish non valido/);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/trackLoader.test.js`
Expected: FAIL — `track.startFinishIndex` è `undefined` (non ancora prodotto), `startFinish` non validato/non usato.

- [ ] **Step 3: Implementare in `buildTrack`**

In `backend/sockets/games/trackLoader.js`, sostituire il blocco righe 70-83:

```js
    const p0 = points[0];
    const tangent = TrackGeometry.tangentAt(points, 0, true);
    const normal  = TrackGeometry.normalAt(points, 0, true);
    const angle   = Math.atan2(tangent.tx, tangent.tz);

    // Punto lungo la tangente di partenza, con un offset laterale lungo la
    // normale — usato sia per lo spawn di qualifica sia per la griglia.
    function alongTrack(distForward, lateralOffset) {
        return {
            x: p0.x + tangent.tx * distForward + normal.nx * lateralOffset,
            z: p0.z + tangent.tz * distForward + normal.nz * lateralOffset,
            angle
        };
    }
```

con:

```js
    // startFinishIndex: indice campionato più vicino al traguardo esplicito
    // (piazzato nell'editor), stessa tecnica già usata per pitEntryIndex più
    // sotto. Se la pista non ha ancora `startFinish` (piste esistenti non
    // ancora riaperte nell'editor), resta 0 — comportamento identico a
    // prima di questa modifica, nessuna rottura.
    const startFinishIndex = raw.startFinish
        ? TrackGeometry.nearestPoint(points, raw.startFinish.x, raw.startFinish.z).index
        : 0;
    const p0 = points[startFinishIndex];
    const tangent = TrackGeometry.tangentAt(points, startFinishIndex, true);
    const normal  = TrackGeometry.normalAt(points, startFinishIndex, true);
    // Se l'utente ha orientato il traguardo diversamente dalla tangente pura
    // (linea leggermente obliqua rispetto alla pista) l'angolo esplicito
    // vince; altrimenti si deduce dalla tangente come sempre.
    const angle = (raw.startFinish && typeof raw.startFinish.angle === 'number')
        ? raw.startFinish.angle
        : Math.atan2(tangent.tx, tangent.tz);

    // Punto lungo la tangente di partenza, con un offset laterale lungo la
    // normale — usato sia per lo spawn di qualifica sia per la griglia.
    function alongTrack(distForward, lateralOffset) {
        return {
            x: p0.x + tangent.tx * distForward + normal.nx * lateralOffset,
            z: p0.z + tangent.tz * distForward + normal.nz * lateralOffset,
            angle
        };
    }
```

Poi, nel `return` di `buildTrack` (righe 107-123), aggiungere `startFinishIndex` accanto a `pitEntryIndex`:

```js
    return {
        id,
        name: raw.name,
        points,
        roadHalf: raw.roadHalfWidth,
        lapLength,
        totalLaps,
        pitPath: raw.pit.path,
        pitEntryIndex,
        startFinishIndex,
        pitBoxIndex: raw.pit.boxIndex,
        pitRoadHalf: raw.pit.roadHalfWidth,
        pitEntryTrigger: raw.pit.entryTrigger,
        qualiSpawn: alongTrack(QUALI_LEAD, 0),
        gridSpawnPoint,
        racingLine,
        racingLineTuning
    };
```

- [ ] **Step 4: Implementare la validazione in `validateTrackData`**

In `backend/sockets/games/trackLoader.js`, subito prima di `return null;` (riga 189):

```js
    // startFinish è opzionale (compatibilità con piste esistenti senza
    // questo campo), ma se presente deve avere almeno x/z numerici — un
    // oggetto parziale (es. dimenticato angle, che invece resta opzionale)
    // andrebbe silenziosamente ignorato più avanti senza questo controllo.
    if (data.startFinish && (typeof data.startFinish.x !== 'number' || typeof data.startFinish.z !== 'number')) {
        return 'startFinish non valido (servono almeno x e z numerici)';
    }
    return null;
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/trackLoader.test.js`
Expected: PASS (tutti i test del file, inclusi quelli preesistenti — in particolare il test storico `qualiSpawn e gridSpawnPoint(0)/(1)` continua a passare/fallire esattamente come prima, dato che `monte-rosso.json` non ha ancora `startFinish`: questa modifica non lo cambia).

- [ ] **Step 6: Eseguire l'intera suite del gioco F1 per assicurarsi di non aver rotto nulla**

Run: `node --test backend/sockets/games backend/sockets/games/physics backend/tools frontend/shared`
Expected: PASS su tutto tranne i 2-3 fallimenti pre-esistenti e non collegati già noti (drift Monte Rosso non ancora risolto in questo task, tuning incompleto pista Spa se presente) — nessuna NUOVA regressione.

---

### Task 2: `f1GameSocket.js` — zona traguardo e checkpoint relativi a `startFinishIndex`

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js:1080-1134` (`checkLap`), `:1246-1260` (blocco export `physics`)
- Test: Modify `backend/sockets/games/f1GameSocket.physics.test.js`

**Interfaces:**
- Consumes: `track.startFinishIndex` (da Task 1).
- Produces: `f1GameSocket.physics.checkLap(p, totalLaps, io, lobbyId, game)` esportato per test diretti (non lo era prima).

- [ ] **Step 1: Scrivere il test che fallisce**

In `backend/sockets/games/f1GameSocket.physics.test.js`, aggiungere in fondo al file:

```js
function makeMockIo() {
    return { to: () => ({ emit: () => {} }) };
}

test('checkLap: con startFinishIndex non-zero, la zona traguardo e il checkpoint si spostano di conseguenza (non restano fissi a 0/500)', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
    const startFinishIndex = 300;
    const track = {
        points,
        lapLength: n, // 1 unità per campione, così checkpointWindowFor/finishWindowFor restano piccoli e prevedibili
        startFinishIndex
    };
    const game = { track };
    const io = makeMockIo();

    // Il giocatore parte esattamente al traguardo esplicito (300), tocca il
    // checkpoint a metà giro RELATIVO (300+500=800, non il fisso 500) e poi
    // rientra nella zona traguardo (300): un giro deve contare.
    const p = { color: 'red', lap: 0, trackIndex: startFinishIndex, checkpointA: false, inFinishZone: false };
    physics.checkLap(p, 10, io, 'lobby1', game);
    assert.equal(p.lap, 0, 'non deve contare un giro solo stando fermi al traguardo (nessun checkpoint toccato)');

    p.trackIndex = (startFinishIndex + physics.HALF_LAP_IDX) % n; // 800
    physics.checkLap(p, 10, io, 'lobby1', game);
    assert.equal(p.checkpointA, true, 'checkpoint a metà giro relativo deve scattare');

    p.trackIndex = startFinishIndex; // torna a 300
    p.inFinishZone = false; // simula "appena entrato" nella zona
    physics.checkLap(p, 10, io, 'lobby1', game);
    assert.equal(p.lap, 1, 'giro completato tornando al traguardo esplicito (300), non a 0');
});

test('checkLap: senza startFinishIndex (pista senza startFinish, comportamento odierno), traguardo resta indice 0', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
    const track = { points, lapLength: n }; // startFinishIndex assente, come le piste esistenti
    const game = { track };
    const io = makeMockIo();

    const p = { color: 'red', lap: 0, trackIndex: 0, checkpointA: false, inFinishZone: false };
    p.trackIndex = physics.HALF_LAP_IDX;
    physics.checkLap(p, 10, io, 'lobby1', game);
    assert.equal(p.checkpointA, true);

    p.trackIndex = 0;
    p.inFinishZone = false;
    physics.checkLap(p, 10, io, 'lobby1', game);
    assert.equal(p.lap, 1);
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test backend/sockets/games/f1GameSocket.physics.test.js`
Expected: FAIL — `physics.checkLap is not a function` (non ancora esportata).

- [ ] **Step 3: Implementare**

In `backend/sockets/games/f1GameSocket.js`, sostituire dentro `checkLap` (righe 1084 e 1088):

```js
    if (!p.checkpointA && circularWithin(idx, HALF_LAP_IDX, n, checkpointWindowFor(game.track))) {
```

con:

```js
    const startFinishIndex = game.track.startFinishIndex || 0;
    if (!p.checkpointA && circularWithin(idx, (startFinishIndex + HALF_LAP_IDX) % n, n, checkpointWindowFor(game.track))) {
```

e:

```js
    const inFinishZone = circularWithin(idx, 0, n, finishWindowFor(game.track));
```

con:

```js
    const inFinishZone = circularWithin(idx, startFinishIndex, n, finishWindowFor(game.track));
```

Poi, nel blocco `module.exports.physics = { ... }` (righe 1246-1260), aggiungere `checkLap` (dopo `buildPublicState`, riga 1259):

```js
    buildPublicState, checkLap
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `node --test backend/sockets/games/f1GameSocket.physics.test.js`
Expected: PASS (tutti i test del file, inclusi quelli preesistenti)

- [ ] **Step 5: Eseguire l'intera suite del gioco F1 per assicurarsi di non aver rotto nulla**

Run: `node --test backend/sockets/games backend/sockets/games/physics backend/tools frontend/shared`
Expected: PASS su tutto tranne i fallimenti pre-esistenti e non collegati già noti — nessuna NUOVA regressione (in particolare: nessuna pista esistente ha `startFinishIndex` diverso da 0, quindi `checkLap` si comporta esattamente come prima per tutte).

---

### Task 3: Editor — marker traguardo trascinabile + maniglia rotazione + linea nel punto giusto

**Files:**
- Modify: `frontend/shared/trackMeshBuilder.js:173-200` (`buildStartLine`)
- Modify: `frontend/track-editor.js` (stato, `rebuild()`, gestori mouse, `applyTrackData`, `buildTrackData`)
- Modify: `frontend/track-editor.html` (riga 69, testo hint)

**Interfaces:**
- Consumes: nessuna da altri task lato editor (il salvataggio produce il campo `startFinish` che Task 1 consuma lato server).
- Produces: nessuna (ultimo task della catena — solo editor/rendering).

Nessun test automatico: entrambi i file sono browser-only (nessun
`module.exports`, nessuna infrastruttura di test esistente per
`track-editor.js`/`trackMeshBuilder.js`). Verifica manuale in localhost.

- [ ] **Step 1: `buildStartLine` prende un indice opzionale**

In `frontend/shared/trackMeshBuilder.js`, sostituire la firma e le prime righe (righe 173-175):

```js
    function buildStartLine(container, pts, roadHalf) {
        const p0 = pts[0], p1 = pts[1];
        const { nx, nz } = TrackGeometry.normalAt(pts, 0, true);
```

con:

```js
    function buildStartLine(container, pts, roadHalf, startIndex = 0) {
        const p0 = pts[startIndex], p1 = pts[(startIndex + 1) % pts.length];
        const { nx, nz } = TrackGeometry.normalAt(pts, startIndex, true);
```

Il resto della funzione (righe 176-200 circa) resta invariato: usa già `p0`/`p1`/`nx`/`nz` come variabili locali, non l'indice 0 esplicito.

- [ ] **Step 2: Verificare che le chiamate esistenti non si rompano**

`grep -rn "buildStartLine" frontend/` per trovare tutti i call site (editor + gioco vero). Ogni chiamata che NON passa il 4° argomento continua a usare `startIndex = 0` — comportamento identico a prima. Non serve modificare questi call site esistenti in questo step (Task 3 Step 5 aggiorna quello dell'editor per passare l'indice reale).

- [ ] **Step 3: Stato e marker del traguardo in `track-editor.js`**

Subito dopo la dichiarazione di `let pitPoints = [];` (riga 45), aggiungere:

```js
    // Traguardo esplicito: indipendente da mainPoints/pitPoints (un solo
    // punto, non una lista). null finché non caricato/impostato — in quel
    // caso si comporta come oggi (indice 0, angolo dedotto dalla tangente),
    // vedi rebuild().
    let startFinish = null; // { x, z, angle }
    let startFinishMarker = null;
    let startFinishRotateHandle = null;
    const startFinishGroup = new THREE.Group();
    scene.add(startFinishGroup);

    function ensureStartFinishMeshes() {
        if (startFinishMarker) return;
        const markerGeo = new THREE.ConeGeometry(3, 8, 4);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        startFinishMarker = new THREE.Mesh(markerGeo, markerMat);
        startFinishMarker.userData = { role: 'startFinishMarker' };
        const handleGeo = new THREE.SphereGeometry(2.5, 12, 12);
        const handleMat = new THREE.MeshBasicMaterial({ color: 0xe67e22 });
        startFinishRotateHandle = new THREE.Mesh(handleGeo, handleMat);
        startFinishRotateHandle.userData = { role: 'startFinishRotateHandle' };
        startFinishGroup.add(startFinishMarker, startFinishRotateHandle);
    }

    // Il cono (marker) punta lungo +Z locale di default (ConeGeometry si
    // sviluppa lungo Y, ruotato qui una volta di 90° su X per sdraiarlo sul
    // piano orizzontale) — rotation.y = angle lo orienta nel verso di marcia.
    function updateStartFinishMeshes() {
        if (!startFinish) { startFinishGroup.visible = false; return; }
        startFinishGroup.visible = true;
        ensureStartFinishMeshes();
        startFinishMarker.position.set(startFinish.x, 1, startFinish.z);
        startFinishMarker.rotation.set(Math.PI / 2, 0, startFinish.angle);
        const handleDist = 12;
        startFinishRotateHandle.position.set(
            startFinish.x + Math.sin(startFinish.angle) * handleDist,
            1,
            startFinish.z + Math.cos(startFinish.angle) * handleDist
        );
    }
```

- [ ] **Step 4: Interazione mouse — trascina il marker, trascina la maniglia per ruotare**

In `renderer.domElement.addEventListener('mousedown', ...)` (riga 376), subito dopo il blocco `if (imagePositioning) { ... return; }` (righe 385-396) e PRIMA di `const marker = pickMarker(ev);` (riga 397), aggiungere:

```js
        if (startFinish) {
            mouseNDC.x = (ev.clientX / window.innerWidth) * 2 - 1;
            mouseNDC.y = -(ev.clientY / window.innerHeight) * 2 + 1;
            raycaster.setFromCamera(mouseNDC, camera);
            const hits = raycaster.intersectObjects([startFinishMarker, startFinishRotateHandle]);
            if (hits.length > 0) {
                startFinishDrag = { mode: hits[0].object === startFinishRotateHandle ? 'rotate' : 'move' };
                return;
            }
        }
```

Dichiarare `startFinishDrag` accanto a `triggerDrag` (riga 370): `let startFinishDrag = null;`

In `mousemove` (riga 415), subito dopo il blocco `if (triggerDrag) { ... return; }` (righe 447-456) e PRIMA di `if (!dragging) return;` (riga 458), aggiungere:

```js
        if (startFinishDrag) {
            const hit = worldFromEvent(ev);
            if (startFinishDrag.mode === 'move') {
                startFinish.x = +hit.x.toFixed(2);
                startFinish.z = +hit.z.toFixed(2);
            } else {
                // Stesso calcolo già usato per la maniglia di rotazione
                // dell'overlay immagine (riga 441): atan2(-dx,-dz) dà
                // l'angolo nel verso di marcia (Z locale) coerente con
                // TrackGeometry.tangentAt (tx,tz) usato altrove.
                const dx = hit.x - startFinish.x, dz = hit.z - startFinish.z;
                startFinish.angle = Math.atan2(-dx, -dz) + Math.PI;
            }
            updateStartFinishMeshes();
            return;
        }
```

In `window.addEventListener('mouseup', ...)` (riga 467), aggiungere `startFinishDrag = null;` all'elenco già esistente.

- [ ] **Step 5: Collegare `rebuild()`, `applyTrackData()`, `buildTrackData()`**

In `rebuild()` (funzione a riga 220), sostituire la riga:

```js
            TrackMeshBuilder.buildStartLine(trackMeshGroup, pts, roadHalf);
```

con:

```js
            const startIdx = startFinish
                ? TrackGeometry.nearestPoint(pts, startFinish.x, startFinish.z).index
                : 0;
            TrackMeshBuilder.buildStartLine(trackMeshGroup, pts, roadHalf, startIdx);
```

In `applyTrackData(data)` (funzione a riga 548), subito dopo la riga che imposta `pitPoints` (riga 571), aggiungere:

```js
        // Default: se la pista caricata non ha ancora startFinish (piste
        // esistenti pre-questa modifica), il marker appare alla posizione
        // del primo control point con angolo dedotto come oggi — nessuna
        // differenza visibile finché l'utente non lo trascina altrove.
        if (data.startFinish) {
            startFinish = { x: data.startFinish.x, z: data.startFinish.z, angle: data.startFinish.angle ?? 0 };
        } else if (mainPoints.length > 0) {
            const pts = TrackGeometry.sampleLoop(mainPoints, 500);
            const { tx, tz } = TrackGeometry.tangentAt(pts, 0, true);
            startFinish = { x: mainPoints[0].x, z: mainPoints[0].z, angle: Math.atan2(tx, tz) };
        } else {
            startFinish = null;
        }
        updateStartFinishMeshes();
```

In `buildTrackData()` (funzione a riga 665), aggiungere `startFinish` all'oggetto restituito (dopo `roadHalfWidth`):

```js
            startFinish: startFinish ? { x: startFinish.x, z: startFinish.z, angle: startFinish.angle } : undefined,
```

- [ ] **Step 6: Aggiornare il testo di aiuto**

In `frontend/track-editor.html`, riga 69 (`<div id="hint">...`), aggiungere in coda, prima della chiusura del tag:

```
 · Marker bianco (cono): traguardo — trascina per spostare, trascina la sfera arancione per ruotare
```

- [ ] **Step 7: Verifica manuale in localhost**

1. Avviare il server: `node server.js` dalla cartella `backend/`.
2. Aprire `localhost:3000/track-editor.html`.
3. Caricare una pista esistente (es. "Monte Rosso") dal menu — il marker bianco a cono deve comparire alla posizione del primo punto tracciato, con la maniglia arancione vicina, senza dover fare nulla.
4. Trascinare il marker in un punto diverso della pista: la linea del traguardo nella scena (bande bianche/nere) deve seguirlo.
5. Trascinare la maniglia arancione attorno al marker: l'orientamento della linea deve ruotare di conseguenza.
6. Salvare ("Salva nel gioco"), poi entrare in una partita vera su quella pista: la griglia di partenza/qualifica deve comparire nel nuovo punto, non più a quello storico.
7. Fare un giro completo in gara: il conteggio giri deve incrementare passando sul nuovo traguardo, non al vecchio punto 0.

- [ ] **Step 8: Nessun commit automatico**

Come da Global Constraints — segnalare all'utente che l'implementazione è pronta per la verifica e attendere che sia lui a decidere se/quando committare.

---

## Self-Review

**Copertura spec:**
- Campo opzionale `startFinish` nello schema, compatibilità all'indietro → Task 1. ✓
- `startFinishIndex` calcolato e usato per `qualiSpawn`/`gridSpawnPoint` → Task 1. ✓
- Zona traguardo/checkpoint relativi a `startFinishIndex` nel conteggio giri → Task 2. ✓
- Linea visiva disegnata nel punto giusto → Task 3 Step 1-2, 5. ✓
- Marker trascinabile + maniglia di rotazione nell'editor → Task 3 Step 3-4. ✓
- Default sensato per piste senza `startFinish` (nessuna piazzamento forzato) → Task 3 Step 5 (`applyTrackData`). ✓
- Validazione server-side di `startFinish` malformato → Task 1 Step 4. ✓

**Scansione placeholder:** nessun TBD/TODO; ogni step ha codice completo, non descrizioni generiche.

**Coerenza tipi/nomi:** `track.startFinishIndex` (Task 1, prodotto) → letto come `game.track.startFinishIndex` (Task 2) e `startFinish`/`startIdx` (Task 3, calcolato localmente nell'editor con la stessa tecnica `nearestPoint`, non lo stesso valore prodotto da Task 1 lato server ma stessa formula — coerente); `buildStartLine(container, pts, roadHalf, startIndex = 0)` (Task 3 Step 1) → chiamata con 4 argomenti in Task 3 Step 5; `checkLap` (Task 2, esportato) → firma `(p, totalLaps, io, lobbyId, game)` invariata, stessa usata internamente da `tickGame` (non toccato). Nessuna discrepanza trovata.

**Nota di design non bloccante:** `startFinishIndex` (Task 1, lato server, calcolato una volta su `raw.startFinish`) e l'indice ricalcolato nell'editor (Task 3 Step 5, `nearestPoint` su un campionamento locale a 500 punti invece di 1000) possono differire di una manciata di indici per via della risoluzione di campionamento diversa — ininfluente: l'editor lo usa solo per l'anteprima visiva della linea, il valore autoritativo resta quello calcolato server-side al caricamento della partita vera.
