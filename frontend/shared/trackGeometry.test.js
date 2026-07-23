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

test('terrainHeightAt restituisce la quota pista entro embankStart', () => {
    const pts = [];
    for (let i = 0; i < 50; i++) pts.push({ x: i * 10, z: 0, y: 12 });
    const y = TrackGeometry.terrainHeightAt(pts, 230, 3, 5, 45);
    assert.equal(y, 12);
});

test('terrainHeightAt restituisce 0 oltre embankOuter', () => {
    const pts = [];
    for (let i = 0; i < 50; i++) pts.push({ x: i * 10, z: 0, y: 12 });
    const y = TrackGeometry.terrainHeightAt(pts, 230, 50, 5, 45);
    assert.equal(y, 0);
});

test('terrainHeightAt sfuma con uno smoothstep tra embankStart e embankOuter', () => {
    const pts = [];
    for (let i = 0; i < 50; i++) pts.push({ x: i * 10, z: 0, y: 12 });
    // A metà tragitto (dist=25, embankStart=5, embankOuter=45) lo smoothstep
    // vale esattamente 0.5 (simmetrico): quota attesa = 12 + (0-12)*0.5 = 6.
    const yHalfway = TrackGeometry.terrainHeightAt(pts, 230, 25, 5, 45);
    assert.ok(Math.abs(yHalfway - 6) < 0.01, `atteso ~6 a metà smoothstep, trovato ${yHalfway}`);
});

test('terrainHeightAt resta a 0 se la pista è già a quota 0 ovunque', () => {
    const pts = [];
    for (let i = 0; i < 50; i++) pts.push({ x: i * 10, z: 0 });
    assert.equal(TrackGeometry.terrainHeightAt(pts, 230, 3, 5, 45), 0);
    assert.equal(TrackGeometry.terrainHeightAt(pts, 230, 25, 5, 45), 0);
});

test('sampleLoop propaga bridge=true solo ai campioni del tratto tra due punti di controllo entrambi bridge:true', () => {
    const square = [
        { x: 0, z: 0 },
        { x: 100, z: 0, bridge: true },
        { x: 100, z: 100, bridge: true },
        { x: 0, z: 100 }
    ];
    const pts = TrackGeometry.sampleLoop(square, 400);
    // Il segmento indice 1->2 è l'unico con entrambi gli estremi bridge:true:
    // su un quadrato a lati uguali corrisponde a ~1/4 dei 400 campioni.
    const bridgeCount = pts.filter(p => p.bridge).length;
    assert.ok(bridgeCount > 90 && bridgeCount < 110, `campioni bridge fuori range atteso: ${bridgeCount}`);
    assert.equal(pts[0].bridge, false);
});

test('splitByBridge: nessun punto ponte -> un solo spezzone chiuso con tutti gli indici', () => {
    const pts = [];
    for (let i = 0; i < 10; i++) pts.push({ x: i, z: 0, bridge: false });
    const { groundRuns, bridgeRuns } = TrackGeometry.splitByBridge(pts);
    assert.equal(groundRuns.length, 1);
    assert.equal(groundRuns[0].closed, true);
    assert.deepEqual(groundRuns[0].indices, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(bridgeRuns.length, 0);
});

test('splitByBridge: un arco ponte non al bordo dell\'array -> uno spezzone a terra aperto (concatenato) + uno ponte', () => {
    const pts = [];
    for (let i = 0; i < 10; i++) pts.push({ x: i, z: 0, bridge: i >= 4 && i <= 6 });
    const { groundRuns, bridgeRuns } = TrackGeometry.splitByBridge(pts);
    assert.equal(bridgeRuns.length, 1);
    assert.deepEqual(bridgeRuns[0], [4, 5, 6]);
    assert.equal(groundRuns.length, 1);
    assert.equal(groundRuns[0].closed, false);
    assert.deepEqual(groundRuns[0].indices, [7, 8, 9, 0, 1, 2, 3]);
});

test('splitByBridge: arco ponte a cavallo del bordo dell\'array -> uno spezzone a terra aperto contiguo', () => {
    const pts = [];
    for (let i = 0; i < 10; i++) pts.push({ x: i, z: 0, bridge: i >= 8 || i <= 1 });
    const { groundRuns, bridgeRuns } = TrackGeometry.splitByBridge(pts);
    assert.equal(bridgeRuns.length, 1);
    assert.deepEqual(bridgeRuns[0], [8, 9, 0, 1]);
    assert.equal(groundRuns.length, 1);
    assert.equal(groundRuns[0].closed, false);
    assert.deepEqual(groundRuns[0].indices, [2, 3, 4, 5, 6, 7]);
});
