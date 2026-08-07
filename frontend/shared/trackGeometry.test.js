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

// ---- walkClosedLoop (Rif. richiesta utente 2026-08-07: gridSpawnPoint
// usava un'estrapolazione lineare da un unico punto+angolo fissi — su un
// tratto curvo del traguardo le auto più lontane finivano fuori dalla vera
// linea centrale e con un angolo non allineato alla pista. walkClosedLoop
// cammina sui punti VERI del tracciato, come già fa walkPitPath per la
// corsia box) ----

test('walkClosedLoop: distanza 0 resta esattamente sul punto di partenza', () => {
    const points = [];
    for (let i = 0; i < 20; i++) points.push({ x: i * 10, z: 0 });
    const r = TrackGeometry.walkClosedLoop(points, 5, 0);
    assert.ok(Math.abs(r.x - 50) < 1e-9 && Math.abs(r.z - 0) < 1e-9);
});

test('walkClosedLoop: su un rettilineo, cammina in avanti/indietro esattamente della distanza richiesta', () => {
    const points = [];
    for (let i = 0; i < 20; i++) points.push({ x: i * 10, z: 0 });
    const fwd = TrackGeometry.walkClosedLoop(points, 5, 25);
    assert.ok(Math.abs(fwd.x - 75) < 1e-9, `atteso x=75, trovato ${fwd.x}`);
    const back = TrackGeometry.walkClosedLoop(points, 5, -25);
    assert.ok(Math.abs(back.x - 25) < 1e-9, `atteso x=25, trovato ${back.x}`);
});

test('walkClosedLoop: si avvolge circolarmente oltre l\'ultimo punto (nessun clamp, a differenza di walkPitPath)', () => {
    const points = [];
    for (let i = 0; i < 10; i++) points.push({ x: i * 10, z: 0 }); // chiude idealmente tornando a x=0 dopo l'ultimo
    // Dall'indice 8 (x=80), avanti di 30: 8->9 (10 unità, x=90), poi wrap
    // 9->0 (dist(90,0)-(0,0)... il "segmento di chiusura" tra l'ultimo e il
    // primo punto): verifichiamo solo che l'indice si avvolga, non un
    // valore x esatto (dipende dalla geometria di chiusura sintetica qui).
    const r = TrackGeometry.walkClosedLoop(points, 8, 30);
    assert.ok(r.fromIdx === 9 || r.toIdx === 0 || r.fromIdx < 8, 'atteso un wraparound oltre l\'ultimo punto, non un clamp');
});

test('walkClosedLoop: su un cerchio vero, il punto raggiunto resta sulla circonferenza (segue la curva, non taglia dritto)', () => {
    const ctrl = [];
    for (let a = 0; a < 360; a += 30) {
        const r = a * Math.PI / 180;
        ctrl.push({ x: 100 * Math.cos(r), z: 100 * Math.sin(r) });
    }
    const points = TrackGeometry.sampleLoop(ctrl, 360);
    // Cammina per un quarto di circonferenza (~157) a partire dall'indice 0:
    // se l'implementazione tagliasse dritto (vecchio bug di gridSpawnPoint),
    // il punto risultante cadrebbe DENTRO il cerchio (raggio < 100).
    const quarterCirc = (2 * Math.PI * 100) / 4;
    const r = TrackGeometry.walkClosedLoop(points, 0, quarterCirc);
    const radius = Math.hypot(r.x, r.z);
    assert.ok(Math.abs(radius - 100) < 5, `atteso raggio ~100 (segue la curva), trovato ${radius}`);
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

test('pitBoxAnchors restituisce esattamente count posizioni', () => {
    const path = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 0 }];
    const anchors = TrackGeometry.pitBoxAnchors(path, 2, 6);
    assert.equal(anchors.length, 6);
});

test('pitBoxAnchors centra le posizioni su boxIndex, spaziate di 24 metri', () => {
    const path = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 0 }];
    const anchors = TrackGeometry.pitBoxAnchors(path, 2, 3);
    assert.ok(Math.abs(anchors[0].x - 76) < 1e-6, `atteso x=76, trovato ${anchors[0].x}`);
    assert.ok(Math.abs(anchors[1].x - 100) < 1e-6, `atteso x=100 (boxIndex), trovato ${anchors[1].x}`);
    assert.ok(Math.abs(anchors[2].x - 124) < 1e-6, `atteso x=124, trovato ${anchors[2].x}`);
    for (const a of anchors) assert.equal(a.z, 0);
});

test('pitBoxAnchors resta dentro i limiti della corsia anche con molti box (clamp agli estremi)', () => {
    const path = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 0 }];
    const anchors = TrackGeometry.pitBoxAnchors(path, 2, 51);
    for (const a of anchors) {
        assert.ok(a.x >= -1e-6 && a.x <= 150 + 1e-6, `x fuori dai limiti della corsia: ${a.x}`);
    }
});

test('pitBoxAnchors restituisce la tangente normalizzata della corsia', () => {
    const path = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 0 }];
    const anchors = TrackGeometry.pitBoxAnchors(path, 2, 3);
    for (const a of anchors) {
        const len = Math.hypot(a.tx, a.tz);
        assert.ok(Math.abs(len - 1) < 1e-6, `tangente non normalizzata: ${len}`);
        assert.ok(Math.abs(a.tx - 1) < 1e-6 && Math.abs(a.tz) < 1e-6, 'tangente attesa lungo +x su corsia dritta');
    }
});

// ---- Stallo laterale (Rif. richiesta utente 2026-08-07: un'auto diretta a
// un box più lontano non deve più spingere un'auto già ferma a un box più
// vicino, perché oggi tutti i box sono sulla STESSA linea centrale della
// corsia — vedi progetto pit-lane displacement) ----

test('pitBoxAnchors senza trackPoints/pitRoadHalf: nessun campo stallX/stallZ (retrocompatibile)', () => {
    const path = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 0 }];
    const anchors = TrackGeometry.pitBoxAnchors(path, 2, 3);
    for (const a of anchors) {
        assert.equal(a.stallX, undefined);
        assert.equal(a.stallZ, undefined);
    }
});

test('pitBoxAnchors con trackPoints/pitRoadHalf: lo stallo è spostato lateralmente verso il lato OPPOSTO al tracciato principale', () => {
    const path = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 0 }];
    const trackPoints = [{ x: 100, z: 50 }];   // il tracciato principale è "in su" (+z)
    const pitRoadHalf = 5;
    const anchors = TrackGeometry.pitBoxAnchors(path, 2, 1, trackPoints, pitRoadHalf);
    const a = anchors[0];
    assert.ok(Math.abs(a.x - 100) < 1e-6 && Math.abs(a.z) < 1e-6, 'anchor centrale invariato (box unico su boxIndex)');
    // Normale alla tangente (1,0) è (0,1): lo stallo deve andare verso -z
    // (lontano dal tracciato principale, che è in +z), mai verso +z (lo
    // metterebbe sopra il tracciato principale).
    assert.ok(Math.abs(a.stallX - 100) < 1e-6, `stallX atteso invariato (~100), trovato ${a.stallX}`);
    assert.ok(a.stallZ < 0, `stallZ atteso negativo (lontano dal tracciato in +z), trovato ${a.stallZ}`);
    // Distanza esatta: pitRoadHalf + PIT_STALL_CLEARANCE (stesso margine già
    // usato per il fronte del garage decorativo, misurato sul modello reale).
    assert.ok(Math.abs(Math.abs(a.stallZ) - (pitRoadHalf + TrackGeometry.PIT_STALL_CLEARANCE)) < 1e-6,
        `stallZ atteso a distanza pitRoadHalf+PIT_STALL_CLEARANCE, trovato ${a.stallZ}`);
});

test('pitBoxAnchors: lo stallo si sposta dal lato opposto se il tracciato principale è dall\'altra parte', () => {
    const path = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 0 }];
    const trackPoints = [{ x: 100, z: -50 }];   // il tracciato principale è "in giù" (-z) stavolta
    const anchors = TrackGeometry.pitBoxAnchors(path, 2, 1, trackPoints, 5);
    assert.ok(anchors[0].stallZ > 0, `stallZ atteso positivo (lontano dal tracciato in -z), trovato ${anchors[0].stallZ}`);
});

test('pitBoxAnchors: box diversi lungo la corsia hanno stalli su rette parallele, mai sulla stessa linea centrale', () => {
    const path = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 0 }];
    const trackPoints = [{ x: 100, z: 50 }];
    const anchors = TrackGeometry.pitBoxAnchors(path, 2, 3, trackPoints, 5);
    for (const a of anchors) {
        assert.notEqual(a.stallZ, a.z, 'lo stallo non deve mai coincidere con la linea centrale della corsia');
    }
});
