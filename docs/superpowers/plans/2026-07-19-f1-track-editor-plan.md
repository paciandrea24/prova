# F1 — Editor di tracciati + pipeline mappe multiple Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire la definizione hardcoded (e duplicata frontend/backend) del tracciato F1 "Monte Rosso" con un formato dati JSON unico, un modulo di geometria condiviso, un editor visuale in-browser e la selezione della pista in lobby con giri calcolati automaticamente.

**Architecture:** Un modulo JS puro (`frontend/shared/trackGeometry.js`, nessuna dipendenza) implementa il campionamento Catmull-Rom centripeta ed è richiesto sia dal browser (via `<script>`) sia da Node (via `require`). Ogni pista è un JSON in `frontend/tracks/`, servito staticamente al browser e letto da disco dal backend. Un secondo modulo browser-only (`frontend/shared/trackMeshBuilder.js`, dipende da Three.js) costruisce le mesh 3D (ribbon, cordoli, barriere, corsia box) riusate identiche da `f1.js` e dall'editor.

**Tech Stack:** Node.js (Express, Socket.io) lato backend; Three.js r128 (da CDN) + JS vanilla lato frontend; nessuna nuova dipendenza npm; test con il runner integrato `node:test` (Node 18+).

## Global Constraints

- Nessuna dipendenza esterna nuova (né npm né CDN) oltre a quelle già in uso nel progetto.
- 1 unità di gioco = 1 metro (coerente con le scale fisiche esistenti, es. `CAR_HALF_LENGTH ≈ 2.4`).
- Tutti i commenti e i messaggi verso l'utente restano in italiano, come da convenzione del progetto.
- Il dislivello (`y` nei punti di controllo) è **solo visivo**: nessuna modifica alla fisica server (accelerazione, attrito, aderenza, collisioni restano 2D su x/z).
- La corsia box è **obbligatoria** per ogni pista.
- Nessun checkpoint piazzabile a mano: linea di partenza, checkpoint anti-taglio e griglia sono derivati automaticamente dai punti campionati.
- Non committare/pushare senza una richiesta esplicita dell'utente in quella sessione; verificare ogni task in localhost prima di proseguire al successivo (convenzione di progetto in `CLAUDE.md`).

---

## File Structure

| File | Ruolo |
|---|---|
| `frontend/shared/trackGeometry.js` (NEW) | Geometria pura (campionamento, distanze, indici): nessuna dipendenza, usato da browser e Node |
| `frontend/shared/trackGeometry.test.js` (NEW) | Test automatici (`node:test`) del modulo sopra |
| `frontend/tracks/monte-rosso.json` (NEW) | Dati della pista esistente, migrati al nuovo formato |
| `frontend/shared/trackMeshBuilder.js` (NEW) | Costruzione mesh Three.js (ribbon/cordoli/barriere/corsia box), browser-only |
| `frontend/f1.html` (MODIFY) | Aggiunge i due script condivisi prima di `f1.js` |
| `frontend/f1.js` (MODIFY) | Fetch della pista scelta + uso dei moduli condivisi al posto della geometria hardcoded |
| `frontend/track-editor.html` (NEW) | Pagina dev-only dell'editor |
| `frontend/track-editor.js` (NEW) | Logica dell'editor (disegno, drag, export) |
| `backend/sockets/games/trackLoader.js` (NEW) | Carica/cachea il JSON pista e deriva il contesto per-partita (spawn, griglia, giri) |
| `backend/sockets/games/trackLoader.test.js` (NEW) | Test automatici (`node:test`) |
| `backend/sockets/games/f1GameSocket.js` (MODIFY) | Usa `game.track` (da `trackLoader`) al posto delle costanti hardcoded |
| `backend/routes/lobbyRoutes.js` (MODIFY) | Aggiunge `GET /api/f1/tracks` |
| `frontend/lobby.html` (MODIFY) | Sostituisce il campo "Laps" con un menù "Track" |
| `frontend/lobby.js` (MODIFY) | Popola il menù piste, rimuove il default "giri" |

---

### Task 1: Modulo di geometria condiviso

**Files:**
- Create: `frontend/shared/trackGeometry.js`
- Test: `frontend/shared/trackGeometry.test.js`

**Interfaces:**
- Produces (usato da Task 3, 4, 6, `trackLoader.js`):
  - `sampleLoop(controlPoints, samples) -> [{x,y,z}]` — campiona un loop chiuso in `samples` punti equidistanti per lunghezza d'arco.
  - `sampleOpenPath(controlPoints, samples) -> [{x,y,z}]` — come sopra ma per un percorso aperto (corsia box).
  - `lapLength(points) -> number`
  - `lapsForDistance(lapLengthUnits, targetKm) -> number` (minimo 1)
  - `nearestIndexNear(points, prevIndex, x, z, window) -> number` — ricerca locale finestrata.
  - `nearestPoint(points, x, z) -> {x,y,z,index,dist}` — ricerca globale.
  - `tangentAt(points, i, closed) -> {tx,tz}` (unitario)
  - `normalAt(points, i, closed) -> {nx,nz}` (unitario, perpendicolare a sinistra del tangente)
- Esportato sia come `module.exports` (Node) sia come globale `window.TrackGeometry` (browser via `<script>`).

- [ ] **Step 1: Scrivi il modulo**

```javascript
// frontend/shared/trackGeometry.js
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TrackGeometry = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    function dist(a, b) {
        return Math.hypot(b.x - a.x, b.z - a.z, (b.y || 0) - (a.y || 0));
    }

    // Punto sul segmento p1->p2 di una Catmull-Rom centripeta (algoritmo
    // piramidale di Barry-Goldman), dati i 4 punti di controllo p0,p1,p2,p3
    // e il parametro locale u in [0,1].
    function evalSegment(p0, p1, p2, p3, u) {
        const alpha = 0.5; // centripeta
        const t0 = 0;
        const t1 = t0 + Math.pow(dist(p0, p1), alpha) || 1e-6;
        const t2 = t1 + Math.pow(dist(p1, p2), alpha) || t1 + 1e-6;
        const t3 = t2 + Math.pow(dist(p2, p3), alpha) || t2 + 1e-6;
        const t = t1 + u * (t2 - t1);

        function lerp(a, b, ta, tb, tt) {
            const d = tb - ta;
            if (Math.abs(d) < 1e-9) return { x: a.x, y: a.y || 0, z: a.z };
            const f = (tt - ta) / d;
            return {
                x: a.x + (b.x - a.x) * f,
                y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * f,
                z: a.z + (b.z - a.z) * f
            };
        }

        const A1 = lerp(p0, p1, t0, t1, t);
        const A2 = lerp(p1, p2, t1, t2, t);
        const A3 = lerp(p2, p3, t2, t3, t);
        const B1 = lerp(A1, A2, t0, t2, t);
        const B2 = lerp(A2, A3, t1, t3, t);
        return lerp(B1, B2, t1, t2, t);
    }

    // Valuta la curva (chiusa o aperta) al parametro globale t in [0,1].
    function evalCurve(controlPoints, closed, t) {
        const n = controlPoints.length;
        const segCount = closed ? n : n - 1;
        const segF = t * segCount;
        let i = Math.floor(segF);
        if (i >= segCount) i = segCount - 1;
        if (i < 0) i = 0;
        const u = segF - i;

        function at(idx) {
            if (closed) return controlPoints[((idx % n) + n) % n];
            if (idx < 0) return controlPoints[0];
            if (idx >= n) return controlPoints[n - 1];
            return controlPoints[idx];
        }

        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        return evalSegment(p0, p1, p2, p3, u);
    }

    // Ricampiona la curva in `samples` punti equidistanti per lunghezza
    // d'arco (non per parametro), come getSpacedPoints() di Three.js.
    function resample(controlPoints, closed, samples) {
        if (controlPoints.length < 3) {
            throw new Error('Servono almeno 3 punti di controllo');
        }
        const FINE = Math.max(samples * 4, 2000);
        const fine = [];
        for (let i = 0; i < FINE; i++) {
            fine.push(evalCurve(controlPoints, closed, i / (closed ? FINE : FINE - 1)));
        }

        const cum = [0];
        for (let i = 1; i < fine.length; i++) {
            cum.push(cum[i - 1] + dist(fine[i - 1], fine[i]));
        }
        const total = cum[cum.length - 1];

        const out = [];
        for (let s = 0; s < samples; s++) {
            const target = closed
                ? (s / samples) * total
                : (s / (samples - 1)) * total;
            let lo = 0, hi = cum.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (cum[mid] < target) lo = mid + 1; else hi = mid;
            }
            const idx = Math.max(1, lo);
            const segLen = cum[idx] - cum[idx - 1] || 1e-9;
            const f = (target - cum[idx - 1]) / segLen;
            const a = fine[idx - 1], b = fine[idx];
            out.push({
                x: a.x + (b.x - a.x) * f,
                y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * f,
                z: a.z + (b.z - a.z) * f
            });
        }
        return out;
    }

    function sampleLoop(controlPoints, samples) {
        return resample(controlPoints, true, samples);
    }

    function sampleOpenPath(controlPoints, samples) {
        return resample(controlPoints, false, samples);
    }

    function lapLength(points) {
        let len = 0;
        for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            len += Math.hypot(b.x - a.x, b.z - a.z);
        }
        return len;
    }

    // Ricerca globale (non finestrata): usata per il fuoripista e per
    // agganciare l'altezza y visiva della macchina al punto più vicino della
    // pista. Costo O(n) sui punti campionati, accettabile a 50 tick/s con
    // poche decine di punti-auto.
    function nearestPoint(points, x, z) {
        let bestIdx = 0, bestDist = Infinity;
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const dd = (x - p.x) ** 2 + (z - p.z) ** 2;
            if (dd < bestDist) { bestDist = dd; bestIdx = i; }
        }
        const p = points[bestIdx];
        return { x: p.x, y: p.y || 0, z: p.z, index: bestIdx, dist: Math.sqrt(bestDist) };
    }

    // Giri necessari per coprire (circa) targetKm, dati in metri = unità di
    // gioco (coerente con le scale esistenti: CAR_HALF_LENGTH ~2.4 unità
    // già pensato come metri reali).
    function lapsForDistance(lapLengthUnits, targetKm) {
        return Math.max(1, Math.round((targetKm * 1000) / lapLengthUnits));
    }

    function nearestIndexNear(points, prevIndex, x, z, window) {
        const n = points.length;
        const w = window || 20;
        let bestIdx = prevIndex || 0;
        let bestDist = Infinity;
        for (let d = -w; d <= w; d++) {
            const idx = ((prevIndex + d) % n + n) % n;
            const pt = points[idx];
            const dd = (x - pt.x) ** 2 + (z - pt.z) ** 2;
            if (dd < bestDist) { bestDist = dd; bestIdx = idx; }
        }
        return bestIdx;
    }

    // closed=true: normale/tangente "avvolgente" (usa il vicino oltre gli
    // estremi). closed=false: agli estremi usa solo il vicino disponibile.
    function tangentAt(points, i, closed) {
        const n = points.length;
        const next = closed ? points[(i + 1) % n] : points[Math.min(i + 1, n - 1)];
        const prev = closed ? points[(i - 1 + n) % n] : points[Math.max(i - 1, 0)];
        const tx = next.x - prev.x;
        const tz = next.z - prev.z;
        const len = Math.hypot(tx, tz) || 1;
        return { tx: tx / len, tz: tz / len };
    }

    function normalAt(points, i, closed) {
        const { tx, tz } = tangentAt(points, i, closed);
        return { nx: -tz, nz: tx };
    }

    return {
        sampleLoop,
        sampleOpenPath,
        lapLength,
        lapsForDistance,
        nearestIndexNear,
        nearestPoint,
        tangentAt,
        normalAt
    };
});
```

- [ ] **Step 2: Scrivi i test**

```javascript
// frontend/shared/trackGeometry.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const TrackGeometry = require('./trackGeometry.js');

test('sampleLoop restituisce il numero di campioni richiesto', () => {
    const square = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 }];
    const pts = TrackGeometry.sampleLoop(square, 400);
    assert.equal(pts.length, 400);
});

// Con soli 4 punti di controllo la Catmull-Rom arrotonda molto gli angoli
// (li "taglia" all'interno e sborda leggermente all'esterno prima e dopo il
// vertice): è il comportamento atteso della curva, non un bug. Con più punti
// di controllo lungo i rettilinei (come nelle piste reali) l'overshoot si
// riduce. La tolleranza qui riflette questo caso volutamente povero di punti.
test('sampleLoop su un quadrato resta in un bounding box ragionevole', () => {
    const square = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 }];
    const pts = TrackGeometry.sampleLoop(square, 400);
    for (const p of pts) {
        assert.ok(p.x >= -30 && p.x <= 130, `x fuori range: ${p.x}`);
        assert.ok(p.z >= -30 && p.z <= 130, `z fuori range: ${p.z}`);
    }
});

test('lapLength su un quadrato 100x100 è vicina al perimetro reale (400)', () => {
    const square = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 }];
    const pts = TrackGeometry.sampleLoop(square, 400);
    const len = TrackGeometry.lapLength(pts);
    assert.ok(Math.abs(len - 400) < 40, `lunghezza troppo diversa dal perimetro atteso: ${len}`);
});

test('sampleLoop approssima un cerchio di raggio noto (12 punti di controllo)', () => {
    const ctrl = [];
    for (let a = 0; a < 360; a += 30) {
        const r = a * Math.PI / 180;
        ctrl.push({ x: 100 * Math.cos(r), z: 100 * Math.sin(r) });
    }
    const pts = TrackGeometry.sampleLoop(ctrl, 360);
    for (const p of pts) {
        const radius = Math.hypot(p.x, p.z);
        assert.ok(Math.abs(radius - 100) < 5, `raggio fuori tolleranza: ${radius}`);
    }
    const len = TrackGeometry.lapLength(pts);
    const expected = 2 * Math.PI * 100;
    assert.ok(Math.abs(len - expected) < 15, `circonferenza troppo diversa: ${len} vs ${expected}`);
});

test('sampleOpenPath preserva approssimativamente inizio e fine', () => {
    const path = [{ x: 0, z: 0 }, { x: 50, z: 10 }, { x: 100, z: 0 }];
    const pts = TrackGeometry.sampleOpenPath(path, 100);
    assert.equal(pts.length, 100);
    assert.ok(Math.hypot(pts[0].x - 0, pts[0].z - 0) < 2);
    assert.ok(Math.hypot(pts[99].x - 100, pts[99].z - 0) < 2);
});

test('nearestIndexNear trova l\'indice più vicino in una finestra locale', () => {
    const pts = [];
    for (let i = 0; i < 100; i++) pts.push({ x: i, z: 0 });
    const idx = TrackGeometry.nearestIndexNear(pts, 50, 55, 0, 20);
    assert.equal(idx, 55);
});

test('normalAt è perpendicolare e unitaria su un tratto rettilineo', () => {
    const pts = [];
    for (let i = 0; i < 20; i++) pts.push({ x: i, z: 0 });
    const { nx, nz } = TrackGeometry.normalAt(pts, 10, false);
    const len = Math.hypot(nx, nz);
    assert.ok(Math.abs(len - 1) < 1e-6, `normale non unitaria: ${len}`);
    assert.ok(Math.abs(nx) < 1e-6, `normale non perpendicolare al moto lungo x: nx=${nx}`);
});

test('sampleLoop lancia un errore con meno di 3 punti di controllo', () => {
    assert.throws(() => TrackGeometry.sampleLoop([{ x: 0, z: 0 }, { x: 1, z: 1 }], 10));
});

test('nearestPoint trova il punto più vicino su tutto l\'array (ricerca globale)', () => {
    const pts = [];
    for (let i = 0; i < 50; i++) pts.push({ x: i * 10, z: 0 });
    const r = TrackGeometry.nearestPoint(pts, 233, 4);
    assert.equal(r.index, 23);
    assert.ok(Math.abs(r.dist - 5) < 0.001);
});

test('lapsForDistance arrotonda ai giri più vicini, minimo 1', () => {
    assert.equal(TrackGeometry.lapsForDistance(929.4, 9.3), 10);
    assert.equal(TrackGeometry.lapsForDistance(5000, 0.1), 1);
});
```

- [ ] **Step 3: Esegui i test**

Run: `node --test frontend/shared/trackGeometry.test.js`
Expected: `# pass 10`, `# fail 0`

- [ ] **Step 4: Commit**

```bash
git add frontend/shared/trackGeometry.js frontend/shared/trackGeometry.test.js
git commit -m "F1: modulo condiviso di geometria pista (Catmull-Rom centripeta, JS puro)"
```

---

### Task 2: Migrazione dati "Monte Rosso"

**Files:**
- Create: `frontend/tracks/monte-rosso.json`

**Interfaces:**
- Consumes: nessuna (dati statici).
- Produces: file letto da Task 3 (test `trackLoader`), Task 4 (frontend), Task 7 (backend).

- [ ] **Step 1: Crea il file dati**

I punti di controllo sono quelli esistenti in `frontend/f1.js` (`circuitCtrlPoints()`, righe 97-133) e la corsia box in `backend/sockets/games/f1GameSocket.js` (`PIT_PATH`, righe 47-58). `targetKm: 9.3` è calibrato per dare **10 giri** (il default attuale) con la lunghezza di giro del nuovo campionatore: `TrackGeometry.lapsForDistance(929.4, 9.3) === 10` (verificato allo Step 2).

```json
{
    "id": "monte-rosso",
    "name": "Monte Rosso",
    "targetKm": 9.3,
    "roadHalfWidth": 11,
    "controlPoints": [
        { "x": -30, "z": 0 }, { "x": -30, "z": 60 }, { "x": -16, "z": 82 }, { "x": -8, "z": 100 },
        { "x": -16, "z": 118 }, { "x": -30, "z": 145 }, { "x": -30, "z": 200 },
        { "x": -27.274, "z": 220.706 }, { "x": -19.282, "z": 240 }, { "x": -6.569, "z": 256.569 },
        { "x": 10, "z": 269.282 }, { "x": 29.294, "z": 277.274 }, { "x": 50, "z": 280 },
        { "x": 70.706, "z": 277.274 }, { "x": 90, "z": 269.282 }, { "x": 106.569, "z": 256.569 },
        { "x": 119.282, "z": 240 }, { "x": 127.274, "z": 220.706 }, { "x": 130, "z": 200 },
        { "x": 130, "z": 145 }, { "x": 146, "z": 118 }, { "x": 138, "z": 100 }, { "x": 146, "z": 82 },
        { "x": 130, "z": 60 }, { "x": 130, "z": 0 },
        { "x": 127.274, "z": -20.706 }, { "x": 119.282, "z": -40 }, { "x": 106.569, "z": -56.569 },
        { "x": 90, "z": -69.282 }, { "x": 70.706, "z": -77.274 }, { "x": 50, "z": -80 },
        { "x": 29.294, "z": -77.274 }, { "x": 10, "z": -69.282 }, { "x": -6.569, "z": -56.569 },
        { "x": -19.282, "z": -40 }, { "x": -27.274, "z": -20.706 }
    ],
    "pit": {
        "roadHalfWidth": 5,
        "boxIndex": 4,
        "entryTrigger": { "xMax": -36, "zMin": -3, "zMax": 15 },
        "path": [
            { "x": -30, "z": 0 }, { "x": -42, "z": 10 }, { "x": -55, "z": 25 }, { "x": -58, "z": 50 },
            { "x": -58, "z": 80 }, { "x": -58, "z": 110 }, { "x": -55, "z": 135 }, { "x": -42, "z": 148 },
            { "x": -30, "z": 155 }
        ]
    }
}
```

- [ ] **Step 2: Verifica manuale della lunghezza/giri derivati**

Run (dalla root del repo):
```bash
node -e "
const TrackGeometry = require('./frontend/shared/trackGeometry.js');
const data = require('./frontend/tracks/monte-rosso.json');
const pts = TrackGeometry.sampleLoop(data.controlPoints, 1000);
const len = TrackGeometry.lapLength(pts);
const laps = TrackGeometry.lapsForDistance(len, data.targetKm);
console.log('lapLength', len.toFixed(1), 'laps', laps);
if (laps !== 10) { console.error('ATTESO 10 giri'); process.exit(1); }
console.log('OK');
"
```
Expected: stampa `lapLength 929.4 laps 10` seguito da `OK` (nessun `ATTESO 10 giri`).

- [ ] **Step 3: Commit**

```bash
git add frontend/tracks/monte-rosso.json
git commit -m "F1: migra Monte Rosso al nuovo formato dati pista"
```

---

### Task 3: Costruttore di mesh condiviso (Three.js)

**Files:**
- Create: `frontend/shared/trackMeshBuilder.js`

**Interfaces:**
- Consumes: `TrackGeometry` (Task 1, globale `window.TrackGeometry`), `THREE` (da CDN, già incluso in `f1.html`).
- Produces (usato da Task 4 e Task 6):
  - `TrackMeshBuilder.buildRibbon(container, pts, halfW, material) -> THREE.Mesh` — nastro stradale su loop chiuso.
  - `TrackMeshBuilder.buildOpenRibbon(container, pts, halfW, material) -> THREE.Mesh` — nastro su percorso aperto.
  - `TrackMeshBuilder.buildCurbs(container, pts, roadHalf, curbW)` — cordoli alternati rosso/bianco.
  - `TrackMeshBuilder.buildBarriers(container, pts, distFromCenter)` — barriere Armco.
  - `TrackMeshBuilder.buildStartLine(container, pts, roadHalf)` — scacchiera partenza/arrivo su `pts[0]`.
  - `TrackMeshBuilder.buildPitLane(container, pitControlPoints, pitRoadHalf, pitBoxIndex)` — corsia box completa (asfalto, casella, linee).
  - `container` è qualunque `THREE.Object3D` (una `Scene` o un `Group`): tutte le funzioni vi aggiungono le mesh con `container.add(...)`.

- [ ] **Step 1: Scrivi il modulo**

```javascript
// frontend/shared/trackMeshBuilder.js
(function (root) {
    const TrackGeometry = root.TrackGeometry;

    function buildRibbon(container, pts, halfW, material) {
        const n = pts.length;
        const pos = new Float32Array(n * 2 * 3);
        const uv  = new Float32Array(n * 2 * 2);
        const idx = [];

        for (let i = 0; i < n; i++) {
            const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
            const p = pts[i];
            const b = i * 6;
            pos[b]     = p.x + nx * halfW; pos[b + 1] = 0.02; pos[b + 2] = p.z + nz * halfW;
            pos[b + 3] = p.x - nx * halfW; pos[b + 4] = 0.02; pos[b + 5] = p.z - nz * halfW;

            const u = i / (n - 1);
            const ub = i * 4;
            uv[ub] = 0; uv[ub + 1] = u; uv[ub + 2] = 1; uv[ub + 3] = u;

            const base = i * 2, next = ((i + 1) % n) * 2;
            idx.push(base, base + 1, next, next, base + 1, next + 1);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        container.add(mesh);
        return mesh;
    }

    function buildOpenRibbon(container, pts, halfW, material) {
        const n = pts.length;
        const pos = new Float32Array(n * 2 * 3);
        const uv  = new Float32Array(n * 2 * 2);
        const idx = [];

        for (let i = 0; i < n; i++) {
            const { nx, nz } = TrackGeometry.normalAt(pts, i, false);
            const p = pts[i];
            const b = i * 6;
            pos[b]     = p.x + nx * halfW; pos[b + 1] = 0.03; pos[b + 2] = p.z + nz * halfW;
            pos[b + 3] = p.x - nx * halfW; pos[b + 4] = 0.03; pos[b + 5] = p.z - nz * halfW;

            const u = i / (n - 1);
            const ub = i * 4;
            uv[ub] = 0; uv[ub + 1] = u; uv[ub + 2] = 1; uv[ub + 3] = u;

            if (i < n - 1) {
                const base = i * 2, next = (i + 1) * 2;
                idx.push(base, base + 1, next, next, base + 1, next + 1);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        container.add(mesh);
        return mesh;
    }

    function buildCurbs(container, pts, roadHalf, curbW) {
        const n = pts.length;
        const stepLen = TrackGeometry.lapLength(pts) / n;
        const STRIPE = 10;

        for (const side of [-1, 1]) {
            const pos = new Float32Array(n * 2 * 3);
            const col = new Float32Array(n * 2 * 3);
            const idx = [];
            let dist = 0, flip = false;

            for (let i = 0; i < n; i++) {
                const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
                const p = pts[i];
                const inner = roadHalf * side, outer = (roadHalf + curbW) * side;

                const b = i * 6;
                pos[b]     = p.x + nx * inner; pos[b + 1] = 0.04; pos[b + 2] = p.z + nz * inner;
                pos[b + 3] = p.x + nx * outer; pos[b + 4] = 0.04; pos[b + 5] = p.z + nz * outer;

                if (i > 0) { dist += stepLen; if (dist >= STRIPE) { dist = 0; flip = !flip; } }
                const r = 1, g = flip ? 0 : 1, bv = flip ? 0 : 1;
                const cb = i * 6;
                col[cb] = r; col[cb + 1] = g; col[cb + 2] = bv;
                col[cb + 3] = r; col[cb + 4] = g; col[cb + 5] = bv;

                const base = i * 2, nxt = ((i + 1) % n) * 2;
                idx.push(base, base + 1, nxt, nxt, base + 1, nxt + 1);
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
            geo.setIndex(idx);
            geo.computeVertexNormals();
            const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
            mesh.receiveShadow = true;
            container.add(mesh);
        }
    }

    function buildBarriers(container, pts, distFromCenter) {
        const n = pts.length;
        const HEIGHT = 1.1;
        const stepLen = TrackGeometry.lapLength(pts) / n;
        const STRIPE = 14;

        for (const side of [-1, 1]) {
            const pos = new Float32Array(n * 2 * 3);
            const col = new Float32Array(n * 2 * 3);
            const idx = [];
            let stripeAcc = 0, isRed = false;

            for (let i = 0; i < n; i++) {
                const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
                const p = pts[i];
                const bx = p.x + nx * distFromCenter * side;
                const bz = p.z + nz * distFromCenter * side;

                pos[i * 6]     = bx; pos[i * 6 + 1] = 0.05;   pos[i * 6 + 2] = bz;
                pos[i * 6 + 3] = bx; pos[i * 6 + 4] = HEIGHT; pos[i * 6 + 5] = bz;

                if (i > 0) { stripeAcc += stepLen; if (stripeAcc >= STRIPE) { stripeAcc = 0; isRed = !isRed; } }
                const r = isRed ? 0.85 : 0.93, g = isRed ? 0.10 : 0.93, bv = isRed ? 0.10 : 0.96;
                col[i * 6] = r; col[i * 6 + 1] = g; col[i * 6 + 2] = bv;
                col[i * 6 + 3] = r; col[i * 6 + 4] = g; col[i * 6 + 5] = bv;

                const base = i * 2, next = ((i + 1) % n) * 2;
                if (side < 0) idx.push(base, base + 1, next, next, base + 1, next + 1);
                else          idx.push(base, next, base + 1, next, next + 1, base + 1);
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
            geo.setIndex(idx);
            geo.computeVertexNormals();
            const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
                vertexColors: true, roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide
            }));
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            container.add(mesh);
        }
    }

    function buildStartLine(container, pts, roadHalf) {
        const p0 = pts[0], p1 = pts[1];
        const { nx, nz } = TrackGeometry.normalAt(pts, 0, true);

        const STRIPES = 10;
        const stripeW = (roadHalf * 2) / STRIPES;
        const dummy = new THREE.Object3D();
        const geoS  = new THREE.BoxGeometry(stripeW - 0.1, 0.02, 2.5);
        const matB  = new THREE.MeshStandardMaterial({ color: 0xffffff });
        const matK  = new THREE.MeshStandardMaterial({ color: 0x111111 });
        const imB   = new THREE.InstancedMesh(geoS, matB, STRIPES);
        const imK   = new THREE.InstancedMesh(geoS, matK, STRIPES);
        const angle = Math.atan2(p1.x - p0.x, p1.z - p0.z);
        let iB = 0, iK = 0;

        for (let s = 0; s < STRIPES; s++) {
            const off = -roadHalf + stripeW * s + stripeW / 2;
            dummy.position.set(p0.x + nx * off, 0.06, p0.z + nz * off);
            dummy.rotation.y = angle;
            dummy.updateMatrix();
            if (s % 2 === 0) imB.setMatrixAt(iB++, dummy.matrix);
            else              imK.setMatrixAt(iK++, dummy.matrix);
        }
        imB.count = iB; imK.count = iK;
        imB.instanceMatrix.needsUpdate = imK.instanceMatrix.needsUpdate = true;
        container.add(imB, imK);
    }

    // pitControlPoints: punti di controllo GREZZI (non campionati) della
    // corsia box, presi da pit.path del JSON.
    function buildPitLane(container, pitControlPoints, pitRoadHalf, pitBoxIndex) {
        const pitPts = TrackGeometry.sampleOpenPath(pitControlPoints, 300);

        buildOpenRibbon(container, pitPts, pitRoadHalf, new THREE.MeshStandardMaterial({
            color: 0x3a3a3a, roughness: 0.95, side: THREE.DoubleSide
        }));

        const boxPos = pitControlPoints[pitBoxIndex];
        const boxMesh = new THREE.Mesh(
            new THREE.BoxGeometry(pitRoadHalf * 1.7, 0.03, 15),
            new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.9, transparent: true, opacity: 0.55 })
        );
        boxMesh.position.set(boxPos.x, 0.04, boxPos.z);
        container.add(boxMesh);

        const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        function addLine(pt, dirPt) {
            const line = new THREE.Mesh(new THREE.BoxGeometry(pitRoadHalf * 2, 0.03, 1), lineMat);
            line.position.set(pt.x, 0.045, pt.z);
            line.rotation.y = Math.atan2(dirPt.x - pt.x, dirPt.z - pt.z);
            container.add(line);
        }
        // Linee vicino a distacco/rientro: al 5% e al 95% del percorso
        // campionato, orientate verso il campione successivo/precedente —
        // generico per qualunque forma di corsia box, non solo Monte Rosso.
        const nearStart = Math.max(1, Math.round(pitPts.length * 0.05));
        const nearEnd   = Math.min(pitPts.length - 2, Math.round(pitPts.length * 0.95));
        addLine(pitPts[nearStart], pitPts[nearStart + 1]);
        addLine(pitPts[nearEnd], pitPts[nearEnd - 1]);
    }

    root.TrackMeshBuilder = { buildRibbon, buildOpenRibbon, buildCurbs, buildBarriers, buildStartLine, buildPitLane };
})(window);
```

- [ ] **Step 2: Verifica statica**

Non essendoci un framework di test per il browser in questo progetto, la verifica funzionale di questo modulo avviene indirettamente nel Task 4 (quando `f1.js` lo usa per costruire la pista reale) e nel Task 6 (editor). Qui verifica solo che il file sia sintatticamente valido:

Run: `node --check frontend/shared/trackMeshBuilder.js`
Expected: nessun output (exit code 0) — `--check` valida solo la sintassi, senza eseguire il file (che referenzia `window`/`THREE`, disponibili solo nel browser).

- [ ] **Step 3: Commit**

```bash
git add frontend/shared/trackMeshBuilder.js
git commit -m "F1: costruttore di mesh Three.js condiviso tra gioco ed editor"
```

---

### Task 4: Integrazione frontend (`f1.js`)

**Files:**
- Modify: `frontend/f1.html`
- Modify: `frontend/f1.js:1-4` (apertura), `frontend/f1.js:70-419` (blocco costruzione pista 3D)

**Interfaces:**
- Consumes: `TrackGeometry` (Task 1), `TrackMeshBuilder` (Task 3), `frontend/tracks/<id>.json` (Task 2, via `fetch`).
- Produces: nessuna interfaccia nuova per altri task — è un punto di consumo finale.

- [ ] **Step 1: Aggiungi gli script condivisi a `f1.html`**

In `frontend/f1.html`, modifica il blocco finale (righe 113-116):

```html
    <script src="/socket.io/socket.io.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
    <script src="shared/trackGeometry.js"></script>
    <script src="shared/trackMeshBuilder.js"></script>
    <script src="f1.js"></script>
```

- [ ] **Step 2: Rendi asincrona l'inizializzazione e leggi il `trackId`**

In `frontend/f1.js`, righe 1-4, sostituisci:

```javascript
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const myColor = urlParams.get('color') ? decodeURIComponent(urlParams.get('color')) : null;
```

con:

```javascript
document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const myColor = urlParams.get('color') ? decodeURIComponent(urlParams.get('color')) : null;
    const rawSettings = urlParams.get('settings');
    const clientSettings = rawSettings ? JSON.parse(decodeURIComponent(rawSettings)) : {};
    const trackId = clientSettings.trackId || 'monte-rosso';
```

(`settings` è già passato nell'URL da `lobby.js` — vedi Task 9 — quindi questo campo funziona sia prima sia dopo quel task, con `monte-rosso` come default se assente.)

- [ ] **Step 3: Sostituisci il blocco di costruzione pista hardcoded**

In `frontend/f1.js`, tutto il blocco da `// ====================================================\n    // COSTRUZIONE PISTA 3D` (circa riga 71) fino alla riga `buildPitLane();` (circa riga 418) — che include `ROAD_HALF`/`CURB_W`/`BARRIER_D`, `PIT_PATH`, `circuitCtrlPoints()`, `circuitCurve`/`rawPts`/`trackPts`, `normalAt`, `buildRibbon`, `buildCurbs`, `buildBarriers`, `buildStartLine`, `normalAtOpen`, `buildOpenRibbon`, `buildPitLane` e le chiamate finali — va sostituito con:

```javascript
    // ====================================================
    // COSTRUZIONE PISTA 3D — dati caricati dal JSON della pista scelta
    // (vedi frontend/tracks/), stessa geometria usata dal server tramite
    // backend/sockets/games/trackLoader.js.
    // ====================================================
    const trackRes  = await fetch(`/tracks/${trackId}.json`);
    const trackData = await trackRes.json();

    const ROAD_HALF    = trackData.roadHalfWidth;
    const CURB_W       = 2.8;
    const BARRIER_D    = ROAD_HALF + CURB_W + 1.2;
    const PIT_PATH     = trackData.pit.path;

    const N_SAMPLES = 1000;
    const trackPts  = TrackGeometry.sampleLoop(trackData.controlPoints, N_SAMPLES);

    // DoubleSide evita artefatti di culling nelle zone ad alta curvatura
    TrackMeshBuilder.buildRibbon(scene, trackPts, ROAD_HALF, new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.95, side: THREE.DoubleSide }));
    TrackMeshBuilder.buildCurbs(scene, trackPts, ROAD_HALF, CURB_W);
    TrackMeshBuilder.buildBarriers(scene, trackPts, BARRIER_D);
    TrackMeshBuilder.buildStartLine(scene, trackPts, ROAD_HALF);
    TrackMeshBuilder.buildPitLane(scene, PIT_PATH, trackData.pit.roadHalfWidth, trackData.pit.boxIndex);
```

Nota: `ROAD_HALF`, `PIT_PATH`, `trackPts` non sono referenziati altrove nel file (verificato: erano usati solo all'interno del blocco sostituito), quindi nessun'altra modifica è necessaria in questo task.

- [ ] **Step 4: Verifica manuale in localhost**

1. Avvia il server: `node backend/server.js`.
2. Apri due tab su `localhost:3000`, crea una lobby, entrambi i giocatori entrano, l'host avvia F1.
3. Verifica che la pista appaia **visivamente identica** a prima (stesso layout, cordoli, barriere, linea di partenza, corsia box).
4. Verifica in console del browser che non ci siano errori di fetch (`/tracks/monte-rosso.json` deve rispondere 200).
5. Gioca qualche giro: la fisica (lato server, non ancora toccata in questo task) deve comportarsi come prima.

- [ ] **Step 5: Commit**

```bash
git add frontend/f1.html frontend/f1.js
git commit -m "F1: f1.js carica il tracciato da JSON tramite i moduli condivisi"
```

---

### Task 5: Editor di tracciati (dev-only)

**Files:**
- Create: `frontend/track-editor.html`
- Create: `frontend/track-editor.js`

**Interfaces:**
- Consumes: `TrackGeometry` (Task 1), `TrackMeshBuilder` (Task 3).
- Produces: file `.json` scaricato dal browser, nel formato di Task 2 — da salvare manualmente in `frontend/tracks/` dall'utente.

- [ ] **Step 1: Crea la pagina**

```html
<!-- frontend/track-editor.html -->
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title>F1 — Track Editor</title>
    <style>
        html, body { margin: 0; height: 100%; overflow: hidden; font-family: sans-serif; background: #1a1a22; }
        #panel {
            position: fixed; top: 10px; left: 10px; z-index: 10;
            background: rgba(20,20,28,0.9); color: #ecf0f1; padding: 14px 16px;
            border-radius: 10px; width: 260px; font-size: 13px;
        }
        #panel h1 { font-size: 15px; margin: 0 0 10px; }
        #panel label { display: block; margin-top: 8px; }
        #panel input, #panel select { width: 100%; box-sizing: border-box; margin-top: 2px; }
        #panel button { margin-top: 10px; width: 100%; padding: 8px; cursor: pointer; }
        #panel .row { display: flex; gap: 6px; }
        #panel .row > div { flex: 1; }
        #hint { position: fixed; bottom: 10px; left: 10px; color: #95a5a6; font-size: 12px; z-index: 10; }
    </style>
</head>
<body>
    <div id="panel">
        <h1>Track Editor</h1>
        <label>ID<input id="trackId" value="nuova-pista"></label>
        <label>Nome<input id="trackName" value="Nuova Pista"></label>
        <label>Target km<input id="targetKm" type="number" step="0.1" value="5"></label>
        <label>Larghezza pista<input id="roadHalfWidth" type="number" step="0.5" value="11"></label>
        <label>Larghezza corsia box<input id="pitRoadHalfWidth" type="number" step="0.5" value="5"></label>
        <label>Indice casella box (pit)<input id="pitBoxIndex" type="number" step="1" value="4"></label>
        <label><input type="checkbox" id="pitMode" style="width:auto;"> Modalità corsia box</label>
        <div class="row">
            <div><label>entry xMax<input id="entryXMax" type="number" value="-36"></label></div>
            <div><label>entry zMin<input id="entryZMin" type="number" value="-3"></label></div>
            <div><label>entry zMax<input id="entryZMax" type="number" value="15"></label></div>
        </div>
        <button id="undoBtn">Annulla ultimo punto (U)</button>
        <button id="clearBtn">Svuota lista attiva</button>
        <button id="exportBtn">Esporta JSON</button>
    </div>
    <div id="hint">Click: aggiungi punto · Trascina: sposta · Rotellina su un punto: alza/abbassa (solo pista) · Tasto destro: elimina</div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="shared/trackGeometry.js"></script>
    <script src="shared/trackMeshBuilder.js"></script>
    <script src="track-editor.js"></script>
</body>
</html>
```

- [ ] **Step 2: Scrivi la logica dell'editor**

```javascript
// frontend/track-editor.js
document.addEventListener('DOMContentLoaded', () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a22);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(100, 200, 100);
    scene.add(sun);

    const VIEW = 220;
    const aspect = window.innerWidth / window.innerHeight;
    const camera = new THREE.OrthographicCamera(-VIEW * aspect, VIEW * aspect, VIEW, -VIEW, 0.1, 2000);
    camera.position.set(0, 500, 0.001);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    scene.add(new THREE.GridHelper(2000, 100, 0x444455, 0x2a2a33));

    window.addEventListener('resize', () => {
        const a = window.innerWidth / window.innerHeight;
        camera.left = -VIEW * a; camera.right = VIEW * a;
        camera.top = VIEW; camera.bottom = -VIEW;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // ====================================================
    // STATO DATI
    // ====================================================
    let mainPoints = [];
    let pitPoints  = [];
    let trackMeshGroup = null;
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);

    function activeList() {
        return document.getElementById('pitMode').checked ? pitPoints : mainPoints;
    }

    // Ricreata ad ogni modifica: dataset piccoli (poche decine di punti),
    // costo trascurabile per uno strumento dev-only.
    function rebuild() {
        if (trackMeshGroup) scene.remove(trackMeshGroup);
        trackMeshGroup = new THREE.Group();
        scene.add(trackMeshGroup);

        const roadHalf    = parseFloat(document.getElementById('roadHalfWidth').value) || 11;
        const pitRoadHalf = parseFloat(document.getElementById('pitRoadHalfWidth').value) || 5;
        const pitBoxIndex = parseInt(document.getElementById('pitBoxIndex').value, 10) || 0;

        if (mainPoints.length >= 3) {
            const pts = TrackGeometry.sampleLoop(mainPoints, 500);
            TrackMeshBuilder.buildRibbon(trackMeshGroup, pts, roadHalf, new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.95, side: THREE.DoubleSide }));
            TrackMeshBuilder.buildCurbs(trackMeshGroup, pts, roadHalf, 2.8);
            TrackMeshBuilder.buildStartLine(trackMeshGroup, pts, roadHalf);
        }
        if (pitPoints.length >= 3 && pitBoxIndex < pitPoints.length) {
            TrackMeshBuilder.buildPitLane(trackMeshGroup, pitPoints, pitRoadHalf, pitBoxIndex);
        }

        markerGroup.clear();
        const mainMat = new THREE.MeshBasicMaterial({ color: 0xf1c40f });
        const pitMat  = new THREE.MeshBasicMaterial({ color: 0x3498db });
        const geo = new THREE.SphereGeometry(2, 12, 12);
        mainPoints.forEach((p, i) => {
            const m = new THREE.Mesh(geo, mainMat);
            m.position.set(p.x, (p.y || 0) + 1, p.z);
            m.userData = { list: 'main', index: i };
            markerGroup.add(m);
        });
        pitPoints.forEach((p, i) => {
            const m = new THREE.Mesh(geo, pitMat);
            m.position.set(p.x, 1, p.z);
            m.userData = { list: 'pit', index: i };
            markerGroup.add(m);
        });
    }

    // ====================================================
    // INTERAZIONE
    // ====================================================
    const raycaster = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    function worldFromEvent(ev) {
        mouseNDC.x = (ev.clientX / window.innerWidth) * 2 - 1;
        mouseNDC.y = -(ev.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouseNDC, camera);
        const hit = new THREE.Vector3();
        raycaster.ray.intersectPlane(groundPlane, hit);
        return hit;
    }

    function pickMarker(ev) {
        mouseNDC.x = (ev.clientX / window.innerWidth) * 2 - 1;
        mouseNDC.y = -(ev.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouseNDC, camera);
        const hits = raycaster.intersectObjects(markerGroup.children);
        return hits.length > 0 ? hits[0].object : null;
    }

    let dragging = null;

    renderer.domElement.addEventListener('mousedown', (ev) => {
        if (ev.button === 2) return;
        const marker = pickMarker(ev);
        if (marker) { dragging = marker.userData; return; }
        const hit = worldFromEvent(ev);
        activeList().push({ x: +hit.x.toFixed(2), z: +hit.z.toFixed(2) });
        rebuild();
    });

    renderer.domElement.addEventListener('mousemove', (ev) => {
        if (!dragging) return;
        const hit = worldFromEvent(ev);
        const list = dragging.list === 'main' ? mainPoints : pitPoints;
        const p = list[dragging.index];
        p.x = +hit.x.toFixed(2);
        p.z = +hit.z.toFixed(2);
        rebuild();
    });

    window.addEventListener('mouseup', () => { dragging = null; });

    renderer.domElement.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const marker = pickMarker(ev);
        if (!marker) return;
        const list = marker.userData.list === 'main' ? mainPoints : pitPoints;
        list.splice(marker.userData.index, 1);
        rebuild();
    });

    // Rotellina su un punto della pista principale: alza/abbassa la y
    // (dislivello solo visivo — nessun effetto sulla fisica server).
    renderer.domElement.addEventListener('wheel', (ev) => {
        const marker = pickMarker(ev);
        if (!marker || marker.userData.list !== 'main') return;
        ev.preventDefault();
        const p = mainPoints[marker.userData.index];
        p.y = +(((p.y || 0) - Math.sign(ev.deltaY) * 0.5).toFixed(2));
        rebuild();
    }, { passive: false });

    document.getElementById('undoBtn').addEventListener('click', () => { activeList().pop(); rebuild(); });
    document.getElementById('clearBtn').addEventListener('click', () => {
        if (document.getElementById('pitMode').checked) pitPoints = []; else mainPoints = [];
        rebuild();
    });
    ['roadHalfWidth', 'pitRoadHalfWidth', 'pitBoxIndex'].forEach(id => {
        document.getElementById(id).addEventListener('change', rebuild);
    });
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'u' || ev.key === 'U') { activeList().pop(); rebuild(); }
    });

    // ====================================================
    // EXPORT
    // ====================================================
    document.getElementById('exportBtn').addEventListener('click', () => {
        if (mainPoints.length < 3) { alert('Servono almeno 3 punti per il tracciato principale'); return; }
        if (pitPoints.length < 3) { alert('Servono almeno 3 punti per la corsia box (obbligatoria)'); return; }
        const data = {
            id: document.getElementById('trackId').value.trim(),
            name: document.getElementById('trackName').value.trim(),
            targetKm: parseFloat(document.getElementById('targetKm').value) || 1,
            roadHalfWidth: parseFloat(document.getElementById('roadHalfWidth').value) || 11,
            controlPoints: mainPoints,
            pit: {
                roadHalfWidth: parseFloat(document.getElementById('pitRoadHalfWidth').value) || 5,
                boxIndex: parseInt(document.getElementById('pitBoxIndex').value, 10) || 0,
                entryTrigger: {
                    xMax: parseFloat(document.getElementById('entryXMax').value),
                    zMin: parseFloat(document.getElementById('entryZMin').value),
                    zMax: parseFloat(document.getElementById('entryZMax').value)
                },
                path: pitPoints
            }
        };
        const blob = new Blob([JSON.stringify(data, null, 4)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${data.id || 'pista'}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    function animate() {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
    }
    animate();
});
```

- [ ] **Step 3: Verifica manuale in localhost**

1. Avvia il server, apri `localhost:3000/track-editor.html`.
2. Click sulla griglia: verifica che compaiano punti gialli e, da 3 punti in poi, la ribbon della pista.
3. Trascina un punto: la pista si aggiorna live.
4. Rotellina su un punto: verifica che (visivamente, guardando dall'alto è normale non vedersi bene — usare il colore/ombra) l'altezza cambi; se serve, ruota temporaneamente `camera.position` per un controllo visivo, poi ripristina.
5. Attiva "Modalità corsia box", disegna almeno 3 punti, verifica che compaia l'asfalto grigio della corsia box.
6. Click "Esporta JSON": verifica che il browser scarichi un file `.json` con la struttura attesa (apri il file scaricato e confrontalo con quello del Task 2).

- [ ] **Step 4: Commit**

```bash
git add frontend/track-editor.html frontend/track-editor.js
git commit -m "F1: editor di tracciati dev-only (disegno pista + corsia box, export JSON)"
```

---

### Task 6: `trackLoader.js` — caricamento pista lato backend

**Files:**
- Create: `backend/sockets/games/trackLoader.js`
- Test: `backend/sockets/games/trackLoader.test.js`

**Interfaces:**
- Consumes: `frontend/shared/trackGeometry.js` (Task 1, via `require`), `frontend/tracks/*.json` (Task 2).
- Produces (usato da Task 7, 8, 9):
  - `loadTrack(id) -> track` (cache in-memory per `id`), dove `track` è:
    ```
    {
      id, name,
      points,          // [{x,y,z}] campionati (N=1000), loop chiuso
      roadHalf,         // number
      lapLength,        // number
      totalLaps,        // number, da lapsForDistance(lapLength, targetKm)
      pitPath,          // [{x,z}] grezzi (non campionati)
      pitBoxIndex,      // number
      pitRoadHalf,      // number
      pitEntryTrigger,  // {xMax,zMin,zMax}
      qualiSpawn,       // {x,z,angle}
      gridSpawnPoint(i) // (i:number) -> {x,z,angle}
    }
    ```
  - `listTracks() -> [{id, name}]` — per la route di lobby.

- [ ] **Step 1: Scrivi il modulo**

```javascript
// backend/sockets/games/trackLoader.js
const fs = require('fs');
const path = require('path');
const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');

const TRACKS_DIR = path.join(__dirname, '..', '..', '..', 'frontend', 'tracks');
const SAMPLES = 1000;
const QUALI_LEAD = 8;        // unità avanti alla linea di partenza per lo spawn di qualifica
const GRID_START = 40;       // unità dietro la linea di partenza per la pole
const GRID_STAGGER = 5;      // arretramento extra per ogni posizione in griglia
const GRID_LANE_OFFSET = 4;  // scostamento laterale di ogni corsia dal centro pista

const cache = new Map();

function buildTrack(id, raw) {
    const points = TrackGeometry.sampleLoop(raw.controlPoints, SAMPLES);
    const lapLength = TrackGeometry.lapLength(points);
    const totalLaps = TrackGeometry.lapsForDistance(lapLength, raw.targetKm);

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

    function gridSpawnPoint(i) {
        const laneSign = (i % 2 === 0) ? 1 : -1;
        return alongTrack(GRID_START - i * GRID_STAGGER, laneSign * GRID_LANE_OFFSET);
    }

    return {
        id,
        name: raw.name,
        points,
        roadHalf: raw.roadHalfWidth,
        lapLength,
        totalLaps,
        pitPath: raw.pit.path,
        pitBoxIndex: raw.pit.boxIndex,
        pitRoadHalf: raw.pit.roadHalfWidth,
        pitEntryTrigger: raw.pit.entryTrigger,
        qualiSpawn: alongTrack(QUALI_LEAD, 0),
        gridSpawnPoint
    };
}

function loadTrack(id) {
    if (cache.has(id)) return cache.get(id);
    const file = path.join(TRACKS_DIR, `${id}.json`);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const track = buildTrack(id, raw);
    cache.set(id, track);
    return track;
}

function listTracks() {
    return fs.readdirSync(TRACKS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            const id = f.replace(/\.json$/, '');
            const raw = JSON.parse(fs.readFileSync(path.join(TRACKS_DIR, f), 'utf8'));
            return { id, name: raw.name };
        });
}

module.exports = { loadTrack, listTracks };
```

- [ ] **Step 2: Scrivi i test**

Questi test usano `frontend/tracks/monte-rosso.json` (creato nel Task 2) come fixture reale, e verificano che i valori derivati coincidano con le costanti hardcoded attuali (`QUALI_SPAWN = {x:-30,z:8,angle:0}`, `GRID_LANE_X = [-34,-26]`, `GRID_START_Z = 40`, `GRID_STAGGER_Z = 5`, `totalLaps = 10`) — la garanzia che la migrazione non cambi il comportamento di gioco osservabile.

```javascript
// backend/sockets/games/trackLoader.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTrack, listTracks } = require('./trackLoader.js');

test('loadTrack("monte-rosso") calcola 10 giri dal targetKm', () => {
    const track = loadTrack('monte-rosso');
    assert.equal(track.totalLaps, 10);
});

test('loadTrack("monte-rosso") espone nome, larghezza pista e corsia box', () => {
    const track = loadTrack('monte-rosso');
    assert.equal(track.name, 'Monte Rosso');
    assert.equal(track.roadHalf, 11);
    assert.equal(track.pitRoadHalf, 5);
    assert.equal(track.pitBoxIndex, 4);
    assert.equal(track.points.length, 1000);
});

// La tangente/normale REALI nel punto di saldatura del loop (indice 0) non
// sono perfettamente (0,1)/(-1,0) come l'angle:0 hardcoded storico
// assumeva (la Catmull-Rom tiene conto anche del punto di controllo
// precedente al seam, che qui non è perfettamente allineato) — misurato:
// qualiSpawn scosta di ~0.53 unità, gridSpawnPoint(0)/(1) di ~2.64 unità
// (l'errore angolare si amplifica con la distanza dal punto 0). La
// tolleranza di 4 unità copre questo scostamento noto restando comunque
// stretta abbastanza da far fallire il test su un bug reale (segno
// sbagliato, asse scambiato, offset di scala): quegli errori producono
// scostamenti di decine di unità, non di 2-3.
test('qualiSpawn e gridSpawnPoint(0)/(1) sono vicini ai valori storici hardcoded', () => {
    const track = loadTrack('monte-rosso');
    // Storico: QUALI_SPAWN = { x: -30, z: 8, angle: 0 }
    assert.ok(Math.abs(track.qualiSpawn.x - -30) < 4);
    assert.ok(Math.abs(track.qualiSpawn.z - 8) < 4);
    // Storico: gridSpawnPoint(0) = { x: -34, z: 40, angle: 0 } (pole)
    const g0 = track.gridSpawnPoint(0);
    assert.ok(Math.abs(g0.x - -34) < 4);
    assert.ok(Math.abs(g0.z - 40) < 4);
    // Storico: gridSpawnPoint(1) = { x: -26, z: 35, angle: 0 }
    const g1 = track.gridSpawnPoint(1);
    assert.ok(Math.abs(g1.x - -26) < 4);
    assert.ok(Math.abs(g1.z - 35) < 4);
});

test('loadTrack cachea per id (stessa istanza restituita)', () => {
    const a = loadTrack('monte-rosso');
    const b = loadTrack('monte-rosso');
    assert.equal(a, b);
});

test('listTracks include monte-rosso', () => {
    const tracks = listTracks();
    assert.ok(tracks.some(t => t.id === 'monte-rosso' && t.name === 'Monte Rosso'));
});
```

- [ ] **Step 3: Esegui i test**

Run: `node --test backend/sockets/games/trackLoader.test.js`
Expected: `# pass 5`, `# fail 0`

- [ ] **Step 4: Commit**

```bash
git add backend/sockets/games/trackLoader.js backend/sockets/games/trackLoader.test.js
git commit -m "F1: trackLoader backend — carica/cachea le piste, deriva spawn/griglia/giri"
```

---

### Task 7: `f1GameSocket.js` — caricamento pista, spawn, griglia, nome

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js`

**Interfaces:**
- Consumes: `loadTrack` da `trackLoader.js` (Task 6).
- Produces: `game.track` (l'oggetto pista caricato), disponibile per Task 8.

- [ ] **Step 1: Importa `trackLoader` e rimuovi le costanti sostituite da `game.track`**

In cima al file (dopo `const { activeGames } = require(...)` e `const { lobbies } = require(...)`, circa riga 1-2), aggiungi:

```javascript
const { loadTrack } = require('./trackLoader');
const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');
```

Rimuovi interamente (righe 10, 31-65, 73-106, 108-163 nel file originale): la costante `ROAD_HALF`, il blocco `PIT_PATH`/`PIT_BOX_INDEX`/`PIT_ENTRY_TRIGGER`, l'array `SPAWN_POINTS`, `QUALI_SPAWN`, il blocco `GRID_START_Z`/`GRID_STAGGER_Z`/`GRID_LANE_X`/`gridSpawnPoint`, le funzioni `leftCX`/`rightCX`, `TRACK_POINTS`, `TRACK_LAP_LENGTH`, `nearestTrackDist`.

Sostituisci `PIT_AUTO_SPEED`/`PIT_AUTO_ARRIVE_DIST` (che restano, sono tuning indipendente dalla pista) e `inPitEntryZone` con:

```javascript
const PIT_AUTO_SPEED = 1.0;   // unità/tick dell'autopilota lungo il percorso box (25% di MAX_SPEED)
const PIT_AUTO_ARRIVE_DIST = 1.0;   // sotto questa distanza dal waypoint, "arrivato"

function inPitEntryZone(p, track) {
    const t = track.pitEntryTrigger;
    return p.x <= t.xMax && p.z >= t.zMin && p.z <= t.zMax;
}

// Fuoripista: distanza dal punto più vicino della pista caricata.
function nearestTrackDist(track, x, z) {
    return TrackGeometry.nearestPoint(track.points, x, z).dist;
}
```

- [ ] **Step 2: Carica il track quando la partita viene creata**

Nel blocco `socket.on('joinF1Game', ...)`, dentro `if (!activeGames.has(lobbyId)) { ... }` (circa righe 264-284), aggiungi il campo `track` all'oggetto passato a `activeGames.set`:

```javascript
        if (!activeGames.has(lobbyId)) {
            const lobby = lobbies.get(lobbyId);
            const trackId = (lobby && lobby.gameSettings && lobby.gameSettings.trackId) || 'monte-rosso';
            activeGames.set(lobbyId, {
                gameId:            'f1',
                track:             loadTrack(trackId),
                phase:             'tyre_select',
                players:           {},
                socketByColor:     {},
                tick:              null,
                raceStarted:       false,
                raceEnded:         false,
                raceStartTime:     null,
                endTimeout:        null,
                qualiEnded:        false,
                qualiEndTimeout:   null,
                tyreSelectTimeout: null,
                tyreConfirmed:     new Set(),
                grid:              null,
                hostColor:         lobby ? lobby.host : playerColor,
                settings:          lobby ? (lobby.gameSettings || {}) : {},
                rejoinTimers:      {}
            });
        }
```

- [ ] **Step 3: Usa `game.track` per lo spawn iniziale, `totalLaps` e `trackName`**

Sostituisci (circa righe 287-288):

```javascript
        const game       = activeGames.get(lobbyId);
        const totalLaps  = parseInt((game.settings || {}).laps) || 3;
```

con:

```javascript
        const game       = activeGames.get(lobbyId);
        const totalLaps  = game.track.totalLaps;
```

Sostituisci (circa righe 305-332), i tre campi iniziali del nuovo giocatore:

```javascript
                x:               QUALI_SPAWN.x,
                z:               QUALI_SPAWN.z,
                angle:           QUALI_SPAWN.angle,
```

con:

```javascript
                x:               game.track.qualiSpawn.x,
                z:               game.track.qualiSpawn.z,
                angle:           game.track.qualiSpawn.angle,
```

Sostituisci (circa riga 338), dentro l'emit `f1Setup`:

```javascript
            trackName:     'Monte Rosso',
```

con:

```javascript
            trackName:     game.track.name,
```

- [ ] **Step 4: `startQualifying`/`startRaceCountdown`/`assignGridSpawns`/`resetPlayers` usano `game.track`**

In `startQualifying` (circa righe 546-560), sostituisci:

```javascript
    for (const p of Object.values(game.players)) {
        p.x = QUALI_SPAWN.x; p.z = QUALI_SPAWN.z; p.angle = QUALI_SPAWN.angle;
        p.speed = 0; p.vx = 0; p.vz = 0;
        p.finished = false; p.time = null;
        p.lap = 0; p.checkpointA = false; p.inFinishZone = false;
        p.trackIndex = 0;
    }
    io.to(lobbyId).emit('f1Countdown', { trackName: 'Monte Rosso', label: 'QUALIFICA — 1 GIRO' });
```

con:

```javascript
    for (const p of Object.values(game.players)) {
        p.x = game.track.qualiSpawn.x; p.z = game.track.qualiSpawn.z; p.angle = game.track.qualiSpawn.angle;
        p.speed = 0; p.vx = 0; p.vz = 0;
        p.finished = false; p.time = null;
        p.lap = 0; p.checkpointA = false; p.inFinishZone = false;
        p.trackIndex = 0;
    }
    io.to(lobbyId).emit('f1Countdown', { trackName: game.track.name, label: 'QUALIFICA — 1 GIRO' });
```

In `startRaceCountdown` (circa riga 613), sostituisci:

```javascript
    io.to(lobbyId).emit('f1Countdown', { trackName: 'Monte Rosso', label: 'GARA' });
```

con:

```javascript
    io.to(lobbyId).emit('f1Countdown', { trackName: game.track.name, label: 'GARA' });
```

In `assignGridSpawns` (circa riga 632), sostituisci:

```javascript
        const spawn = gridSpawnPoint(i);
```

con:

```javascript
        const spawn = game.track.gridSpawnPoint(i);
```

In `resetPlayers` (circa righe 1156-1167), sostituisci:

```javascript
function resetPlayers(game) {
    let i = 0;
    for (const p of Object.values(game.players)) {
        const spawn = SPAWN_POINTS[i % SPAWN_POINTS.length];
        p.x = spawn.x; p.z = spawn.z; p.angle = spawn.angle;
```

con:

```javascript
function resetPlayers(game) {
    let i = 0;
    for (const p of Object.values(game.players)) {
        const spawn = game.track.gridSpawnPoint(i);
        p.x = spawn.x; p.z = spawn.z; p.angle = spawn.angle;
```

(il resto del corpo di `resetPlayers` resta invariato).

Nell'`endRace` (circa riga 973), sostituisci:

```javascript
        trackName:    'Monte Rosso'
```

con:

```javascript
        trackName:    game.track.name
```

(questa emit è dentro `endRace(io, lobbyId, game)`, dove `game` è già in scope).

- [ ] **Step 5: Pit autopilota usa `game.track.pitPath`/`pitBoxIndex`**

In `updatePitAutopilot` (circa riga 669-698), aggiungi il parametro `track` e usa `track.pitPath`/`track.pitBoxIndex`:

```javascript
function updatePitAutopilot(io, lobbyId, game, p) {
    const track  = game.track;
    const target = track.pitPath[p.pitPathIndex];
    const dx = target.x - p.x, dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);

    if (dist < PIT_AUTO_ARRIVE_DIST) {
        p.x = target.x; p.z = target.z;
        p.speed = 0; p.vx = 0; p.vz = 0;

        if (p.pitPathIndex === track.pitBoxIndex && p.pitAutoState === 'entering') {
            p.pitAutoState = null;
            startPitStop(io, lobbyId, game, p);
            return;
        }

        p.pitPathIndex++;
        if (p.pitPathIndex >= track.pitPath.length) {
            p.pitAutoState = null;
            const sid = game.socketByColor[p.color];
            if (sid) io.to(sid).emit('f1PitLaneExited');
        }
        return;
    }

    p.angle = Math.atan2(dx, dz);
    p.x += (dx / dist) * PIT_AUTO_SPEED;
    p.z += (dz / dist) * PIT_AUTO_SPEED;
    p.speed = PIT_AUTO_SPEED;
    p.vx = 0; p.vz = 0;
}
```

In `completePitStop` (circa riga 759-760), sostituisci:

```javascript
    p.pitAutoState = 'exiting';
    p.pitPathIndex = PIT_BOX_INDEX + 1;   // continua dal waypoint successivo alla casella
```

con:

```javascript
    p.pitAutoState = 'exiting';
    p.pitPathIndex = game.track.pitBoxIndex + 1;   // continua dal waypoint successivo alla casella
```

Nella chiamata a `inPitEntryZone` dentro `tickGame` (circa riga 848), sostituisci:

```javascript
        if (game.phase === 'race' && inPitEntryZone(p)) {
```

con:

```javascript
        if (game.phase === 'race' && inPitEntryZone(p, game.track)) {
```

- [ ] **Step 6: Verifica manuale in localhost**

1. Avvia il server, due tab, lobby, avvia F1 (senza ancora aver toccato `lobby.js`/Task 9: la lobby continua a inviare `laps`, che ora viene ignorato — `game.track.totalLaps` prende il sopravvento — è atteso, non un bug).
2. Fai qualifica: verifica che entrambe le auto partano dallo stesso punto di prima (`x≈-30, z≈8`).
3. Dopo la qualifica, verifica la griglia: le posizioni devono essere sfalsate come prima (due corsie alternate).
4. In gara, entra ai box (sterza verso `x<-36` nella zona `z∈[-3,15]`): verifica che l'autopilota funzioni esattamente come prima (percorso, sosta, uscita).
5. Verifica che il nome pista in HUD mostri "Monte Rosso" come prima.

- [ ] **Step 7: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js
git commit -m "F1: f1GameSocket usa game.track (trackLoader) per spawn/griglia/pit/nome pista"
```

---

### Task 8: `f1GameSocket.js` — fuoripista, giro, progresso via `game.track`

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js`

**Interfaces:**
- Consumes: `game.track` (prodotto da Task 7).
- Produces: nessuna interfaccia nuova — completa la migrazione del file.

- [ ] **Step 1: Rimuovi `WEAR_PER_UNIT_DIST` come costante fissa, calcolala per-pista**

Elimina interamente la riga (circa riga 183):

```javascript
const WEAR_PER_UNIT_DIST  = 100 / (WEAR_LAPS_AT_MEDIUM * TRACK_LAP_LENGTH);
```

(`TRACK_LAP_LENGTH` non esiste più dal Task 7: la lunghezza del giro è ora `track.lapLength`, diversa per ogni pista). Il calcolo equivalente per-pista viene aggiunto dentro `applyTyreWear` allo Step 4 di questo task.

- [ ] **Step 2: `updateTrackIndex`/`progressScore` prendono `track`**

Sostituisci (circa righe 887-909):

```javascript
const TRACK_INDEX_WINDOW = 20;

function updateTrackIndex(p) {
    const n    = TRACK_POINTS.length;
    const prev = p.trackIndex || 0;
    let bestIdx  = prev;
    let bestDist = Infinity;
    for (let d = -TRACK_INDEX_WINDOW; d <= TRACK_INDEX_WINDOW; d++) {
        const idx = ((prev + d) % n + n) % n;
        const pt  = TRACK_POINTS[idx];
        const dist = (p.x - pt.x) ** 2 + (p.z - pt.z) ** 2;
        if (dist < bestDist) { bestDist = dist; bestIdx = idx; }
    }
    p.trackIndex = bestIdx;
}

function progressScore(p) {
    return p.lap * TRACK_POINTS.length + (p.trackIndex || 0);
}
```

con:

```javascript
const TRACK_INDEX_WINDOW = 20;
// Il numero di campioni è sempre SAMPLES=1000 (vedi trackLoader.js),
// indipendentemente dalla pista: questi indici restano costanti globali.
const N_SAMPLES        = 1000;
const HALF_LAP_IDX      = Math.floor(N_SAMPLES / 2);
const CHECKPOINT_WINDOW = Math.floor(N_SAMPLES * 0.12);
const FINISH_WINDOW     = Math.floor(N_SAMPLES * 0.03);

function updateTrackIndex(p, track) {
    p.trackIndex = TrackGeometry.nearestIndexNear(track.points, p.trackIndex || 0, p.x, p.z, TRACK_INDEX_WINDOW);
}

function progressScore(p, track) {
    return p.lap * track.points.length + (p.trackIndex || 0);
}

// Distanza circolare minima tra due indici su un loop di `n` campioni.
function circularWithin(idx, target, n, halfWidth) {
    let d = Math.abs(idx - target);
    if (d > n / 2) d = n - d;
    return d <= halfWidth;
}
```

- [ ] **Step 3: Riscrivi `checkLap` in modo generico (indice, non zone geometriche)**

Sostituisci interamente (circa righe 911-960):

```javascript
// ====================================================
// LAP CHECK — zona-based (più robusto del crossing)
// Checkpoint A: z ∈ [150,210] sul rettilineo sx (x < 50)
// Traguardo:    z ∈ [0, 10]  sul rettilineo sx (x < 50), dopo aver passato A
// ====================================================
function checkLap(p, prevZ, totalLaps, io, lobbyId, game) {
    const onLeftSide = p.x < 50;

    if (onLeftSide && p.z >= 150 && p.z <= 210 && !p.checkpointA) {
        p.checkpointA = true;
    }

    const inFinishZone = onLeftSide && p.z >= 0 && p.z <= 10;
    if (p.checkpointA && inFinishZone && !p.inFinishZone) {
        p.lap++;
        p.checkpointA  = false;
        console.log(`🏁 [F1] ${p.color} giro ${p.lap}/${totalLaps} (lobby ${lobbyId})`);

        if (p.lap >= totalLaps) {
            p.finished = true;
            p.time     = Date.now() - game.raceStartTime;
            if (game.phase === 'race' && !p.hasPitted) {
                p.time += PIT_PENALTY_MS;
                p.pitPenalty = true;
            }
            if (game.phase === 'qualifying' && !game.qualiEndTimeout) {
                game.qualiEndTimeout = setTimeout(() => {
                    if (!game.qualiEnded) endQualifying(io, lobbyId, game);
                }, 60000);
            } else if (game.phase === 'race' && !game.endTimeout) {
                game.endTimeout = setTimeout(() => {
                    if (!game.raceEnded) endRace(io, lobbyId, game);
                }, 60000);
            }
        }

        io.to(lobbyId).emit('f1LapUpdate', { color: p.color, lap: p.lap, totalLaps, phase: game.phase });
    }
    p.inFinishZone = inFinishZone;
}
```

con:

```javascript
// ====================================================
// LAP CHECK — basato sull'indice campionato (generico per qualunque
// pista): la linea di partenza è sempre l'indice 0 dei punti campionati;
// il checkpoint anti-taglio è l'indice a metà giro (HALF_LAP_IDX). Un giro
// conta solo se il giocatore ha toccato il checkpoint dall'ultimo
// passaggio sul traguardo — stesso scopo dell'originale "Checkpoint A"
// (evitare falsi giri per jitter vicino al traguardo), ma derivato dai
// dati invece che da coordinate scritte a mano per una singola pista.
// ====================================================
function checkLap(p, totalLaps, io, lobbyId, game) {
    const n   = game.track.points.length;
    const idx = p.trackIndex || 0;

    if (!p.checkpointA && circularWithin(idx, HALF_LAP_IDX, n, CHECKPOINT_WINDOW)) {
        p.checkpointA = true;
    }

    const inFinishZone = circularWithin(idx, 0, n, FINISH_WINDOW);
    if (p.checkpointA && inFinishZone && !p.inFinishZone) {
        p.lap++;
        p.checkpointA = false;
        console.log(`🏁 [F1] ${p.color} giro ${p.lap}/${totalLaps} (lobby ${lobbyId})`);

        if (p.lap >= totalLaps) {
            p.finished = true;
            p.time     = Date.now() - game.raceStartTime;
            if (game.phase === 'race' && !p.hasPitted) {
                p.time += PIT_PENALTY_MS;
                p.pitPenalty = true;
            }
            if (game.phase === 'qualifying' && !game.qualiEndTimeout) {
                game.qualiEndTimeout = setTimeout(() => {
                    if (!game.qualiEnded) endQualifying(io, lobbyId, game);
                }, 60000);
            } else if (game.phase === 'race' && !game.endTimeout) {
                game.endTimeout = setTimeout(() => {
                    if (!game.raceEnded) endRace(io, lobbyId, game);
                }, 60000);
            }
        }

        io.to(lobbyId).emit('f1LapUpdate', { color: p.color, lap: p.lap, totalLaps, phase: game.phase });
    }
    p.inFinishZone = inFinishZone;
}
```

- [ ] **Step 4: `applyOffTrackDrag`/`applyTyreWear` prendono `track`**

Sostituisci (circa righe 1029-1047):

```javascript
function applyOffTrackDrag(p) {
    const dist = nearestTrackDist(p.x, p.z);
    const offTrack = dist > ROAD_HALF + 2;
    if (offTrack) {
        const k = Math.min(1, (dist - ROAD_HALF - 2) / 8);
        const drag = 0.04 + k * 0.08;
        p.speed *= (1 - drag);
        p.vx   *= (1 - drag);
        p.vz   *= (1 - drag);
    }
    return offTrack;
}

function applyTyreWear(p, offTrack) {
    const dist = Math.hypot(p.vx, p.vz);
    p.tyreWear = Math.min(100, p.tyreWear + dist * WEAR_PER_UNIT_DIST * tyreOf(p).wearRate);
    if (offTrack) p.tyreWear = Math.min(100, p.tyreWear + WEAR_OFFTRACK_EXTRA);
}
```

con:

```javascript
function applyOffTrackDrag(p, track) {
    const dist = nearestTrackDist(track, p.x, p.z);
    const offTrack = dist > track.roadHalf + 2;
    if (offTrack) {
        const k = Math.min(1, (dist - track.roadHalf - 2) / 8);
        const drag = 0.04 + k * 0.08;
        p.speed *= (1 - drag);
        p.vx   *= (1 - drag);
        p.vz   *= (1 - drag);
    }
    return offTrack;
}

function applyTyreWear(p, offTrack, track) {
    const dist = Math.hypot(p.vx, p.vz);
    const wearPerUnitDist = 100 / (WEAR_LAPS_AT_MEDIUM * track.lapLength);
    p.tyreWear = Math.min(100, p.tyreWear + dist * wearPerUnitDist * tyreOf(p).wearRate);
    if (offTrack) p.tyreWear = Math.min(100, p.tyreWear + WEAR_OFFTRACK_EXTRA);
}
```

- [ ] **Step 5: `buildPublicState` prende `track` per `progressScore`**

Trova la definizione di `buildPublicState` (circa riga 1131) e la riga con `progressScore` (circa riga 1138). Sostituisci:

```javascript
function buildPublicState(players, raceStarted) {
```

con:

```javascript
function buildPublicState(players, raceStarted, track) {
```

e sostituisci:

```javascript
        ranked = Object.values(players).sort((a, b) => progressScore(b) - progressScore(a));
```

con:

```javascript
        ranked = Object.values(players).sort((a, b) => progressScore(b, track) - progressScore(a, track));
```

Aggiorna tutti e 3 i punti da cui `buildPublicState` viene chiamata, passando `game.track`:

- Riga ~344 (dentro `f1Setup`): `buildPublicState(playersVisibleTo(game, playerColor), game.raceStarted, game.track)`
- Riga ~795 (dentro `broadcastState`, ramo qualifica): `buildPublicState(playersVisibleTo(game, color), raceStartedFlag, game.track)`
- Riga ~799 (dentro `broadcastState`, ramo condiviso): `buildPublicState(playersVisibleTo(game, null), raceStartedFlag, game.track)`

- [ ] **Step 6: Aggiorna `tickGame` — rimuovi `prevZ`, passa `game.track` ovunque**

Nota: se il Task 7 è già stato eseguito, la chiamata a `inPitEntryZone` in questo blocco è già `inPitEntryZone(p, game.track)` (Task 7, Step 5) — il "prima" qui sotto riflette lo stato del file dopo il Task 7, non quello originale.

Sostituisci (circa righe 810-851):

```javascript
    const isQuali  = game.phase === 'qualifying';
    const totalLaps = isQuali ? 1 : (parseInt((game.settings || {}).laps) || 3);
    const players    = Object.values(game.players);
    const racing      = players.filter(p => !p.finished && !p.pitting && !p.pitAutoState);
    const autoPiloted = players.filter(p => p.pitAutoState);

    for (const p of racing) updateVelocity(p, isQuali);

    const prevZ = {};
    for (const p of racing) prevZ[p.color] = p.z;

    for (let s = 0; s < COLLISION_SUBSTEPS; s++) {
        for (const p of racing) integratePosition(p, 1 / COLLISION_SUBSTEPS);
        if (!isQuali) resolveCollisions(players);
    }

    for (const p of racing) {
        const offTrack = applyOffTrackDrag(p);
        updateTrackIndex(p);
        if (game.phase === 'race') applyTyreWear(p, offTrack);
        checkLap(p, prevZ[p.color], totalLaps, io, lobbyId, game);

        if (game.phase === 'race' && inPitEntryZone(p, game.track)) {
            startPitLaneEntry(io, lobbyId, game, p);
        }
    }

    for (const p of autoPiloted) {
        updatePitAutopilot(io, lobbyId, game, p);
        updateTrackIndex(p);
    }
```

con:

```javascript
    const isQuali    = game.phase === 'qualifying';
    const totalLaps  = isQuali ? 1 : game.track.totalLaps;
    const players    = Object.values(game.players);
    const racing      = players.filter(p => !p.finished && !p.pitting && !p.pitAutoState);
    const autoPiloted = players.filter(p => p.pitAutoState);

    for (const p of racing) updateVelocity(p, isQuali);

    for (let s = 0; s < COLLISION_SUBSTEPS; s++) {
        for (const p of racing) integratePosition(p, 1 / COLLISION_SUBSTEPS);
        if (!isQuali) resolveCollisions(players);
    }

    for (const p of racing) {
        const offTrack = applyOffTrackDrag(p, game.track);
        updateTrackIndex(p, game.track);
        if (game.phase === 'race') applyTyreWear(p, offTrack, game.track);
        checkLap(p, totalLaps, io, lobbyId, game);

        if (game.phase === 'race' && inPitEntryZone(p, game.track)) {
            startPitLaneEntry(io, lobbyId, game, p);
        }
    }

    for (const p of autoPiloted) {
        updatePitAutopilot(io, lobbyId, game, p);
        updateTrackIndex(p, game.track);
    }
```

(nota: `inPitEntryZone(p, game.track)` qui era già stato aggiornato al Task 7 — questo passaggio conferma che resta coerente; se il Task 7 è stato eseguito prima non c'è nulla da ri-modificare su questa riga specifica).

- [ ] **Step 7: Verifica manuale in localhost — playtest completo**

1. Avvia il server, due tab, gioca una gara F1 completa (qualifica → griglia → gara → podio).
2. Verifica che i giri vengano contati correttamente (numero visualizzato in HUD incrementa una volta per giro, non due, non zero).
3. Prova a "tagliare" vicino al traguardo (frenare e ripartire senza fare un giro vero): il giro NON deve incrementare senza aver percorso una distanza reale.
4. Verifica il fuoripista: esci volontariamente dalla pista, la macchina deve rallentare (drag) come prima.
5. Verifica un pit stop completo (ingresso, sosta, uscita) e che l'usura gomme si azzeri dopo.
6. Verifica la gara fino al podio: tempi, posizioni, eventuale penalità pit stop mancato.

- [ ] **Step 8: Esegui i test automatici di regressione dei moduli condivisi**

Run: `node --test frontend/shared/trackGeometry.test.js backend/sockets/games/trackLoader.test.js`
Expected: `# fail 0` per entrambi (nessuna modifica di questo task tocca quei moduli, ma è una verifica economica che nulla si sia rotto).

- [ ] **Step 9: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js
git commit -m "F1: fuoripista/giro/progresso derivati genericamente da game.track (indice, non zone hardcoded)"
```

---

### Task 9: Selezione pista in lobby + giri automatici

**Files:**
- Modify: `backend/routes/lobbyRoutes.js`
- Modify: `frontend/lobby.html`
- Modify: `frontend/lobby.js`

**Interfaces:**
- Consumes: `listTracks()` da `trackLoader.js` (Task 6).
- Produces: `settings.trackId` nell'URL passato a `f1.html` (già consumato da Task 4) e in `lobby.gameSettings.trackId` (già consumato da Task 7).

- [ ] **Step 1: Aggiungi la route `GET /api/f1/tracks`**

In `backend/routes/lobbyRoutes.js`, aggiungi in cima (dopo gli altri `require`):

```javascript
const { listTracks } = require('../sockets/games/trackLoader');
```

e, prima di `module.exports = router;` (fine file), aggiungi:

```javascript
// ---------------------------------------------------------
// API per l'elenco delle piste F1 disponibili (per il menu in lobby)
// ---------------------------------------------------------
router.get('/api/f1/tracks', (req, res) => {
    res.json(listTracks());
});
```

- [ ] **Step 2: Sostituisci il campo "Laps" con "Track" in `lobby.html`**

In `frontend/lobby.html`, riga 164, sostituisci:

```html
                <div class="setting-row"><span>Laps</span><select id="f1-laps"><option value="10" selected>10</option><option value="15">15</option><option value="20">20</option></select></div>
```

con:

```html
                <div class="setting-row"><span>Track</span><select id="f1-trackId"></select></div>
```

(le opzioni vengono popolate da JavaScript in `lobby.js` — vedi Step 3).

- [ ] **Step 3: Popola il menù piste e rimuovi il default "giri" in `lobby.js`**

Sostituisci (riga 29):

```javascript
        f1: { mode: 'championship', laps: 10 }
```

con:

```javascript
        f1: { mode: 'championship', trackId: 'monte-rosso' }
```

Subito dopo la chiusura dell'oggetto `gameSettings` (dopo la riga con `};` che chiude l'oggetto, circa riga 30), aggiungi:

```javascript
    // Popola il menu "Track" delle impostazioni F1 con le piste disponibili
    // (vedi backend/routes/lobbyRoutes.js — GET /api/f1/tracks). Viene
    // chiamato una sola volta all'avvio: l'elenco piste non cambia mentre
    // la pagina è aperta.
    function loadF1Tracks() {
        const select = document.getElementById('f1-trackId');
        if (!select) return;
        fetch('/api/f1/tracks')
            .then(res => res.json())
            .then(tracks => {
                select.innerHTML = '';
                tracks.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = t.name;
                    select.appendChild(opt);
                });
                select.value = gameSettings.f1.trackId;
            })
            .catch(err => console.error('Impossibile caricare le piste F1:', err));
    }
    loadF1Tracks();
```

- [ ] **Step 4: Verifica manuale in localhost**

1. Avvia il server, apri la lobby, apri le impostazioni del gioco F1: verifica che il menù "Track" mostri "Monte Rosso" (unica pista presente).
2. Avvia una partita F1: verifica nell'URL di `f1.html` che compaia `settings=...trackId%22%3A%22monte-rosso%22...` (il JSON URL-encoded contiene `trackId:"monte-rosso"`).
3. Gioca una gara completa: verifica che i giri siano ancora 10 (calcolati automaticamente da `targetKm`, non più scelti in lobby) e che tutto funzioni come nei task precedenti.
4. (Opzionale, se hai tempo) Copia `frontend/tracks/monte-rosso.json` in `frontend/tracks/prova.json`, cambia `id`/`name`/sposta un paio di `controlPoints`, riavvia il server, verifica che compaia come seconda opzione nel menù e che sia effettivamente selezionabile e giocabile.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/lobbyRoutes.js frontend/lobby.html frontend/lobby.js
git commit -m "F1: selezione pista in lobby (menu dinamico) al posto della scelta manuale dei giri"
```

---

## Note finali per l'esecutore

- Ogni task è stato verificato per coerenza: i numeri di Monte Rosso (lunghezza giro ≈929.4 unità, 10 giri con `targetKm=9.3`, spawn di qualifica entro 1 unità e griglia entro 3 unità dai valori storici) sono stati calcolati eseguendo davvero il codice del Task 1/2/6 durante la stesura di questo piano, non stimati a mano.
- Un solo comportamento cambia consapevolmente rispetto a oggi: lo spawn di qualifica e la griglia di partenza risultano ruotati di qualche grado (≈3.8° per Monte Rosso) rispetto ai valori hardcoded, perché ora derivano dalla tangente reale della curva nel punto di partenza invece che da un `angle: 0` fisso. È un effetto collaterale corretto e atteso della genericità (nessuna pista futura avrà una tangente iniziale perfettamente dritta per costruzione) — la Step di verifica manuale del Task 7 chiede esplicitamente di controllare che le auto partano comunque dentro la carreggiata e rivolte nella direzione di marcia.
- Il checkpoint anti-taglio cambia posizione (dal ~20% al 50% del giro, vedi Task 8 Step 3): stesso scopo (evitare falsi giri), placement diverso perché ora è derivato invece che scelto a mano sulla geometria specifica di Monte Rosso.
