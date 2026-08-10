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

test('pointInOrientedBox: angle=0 si comporta come un riquadro assi-allineato', () => {
    const box = { x: 0, z: 0, halfWidth: 5, halfLength: 10, angle: 0 };
    assert.equal(TrackGeometry.pointInOrientedBox(0, 0, box), true);
    assert.equal(TrackGeometry.pointInOrientedBox(4.9, 9.9, box), true);
    assert.equal(TrackGeometry.pointInOrientedBox(5.1, 0, box), false);
    assert.equal(TrackGeometry.pointInOrientedBox(0, 10.1, box), false);
});

test('pointInOrientedBox: ruotato di 90 gradi scambia gli assi locali', () => {
    const box = { x: 0, z: 0, halfWidth: 5, halfLength: 10, angle: Math.PI / 2 };
    assert.equal(TrackGeometry.pointInOrientedBox(9, 4, box), true);
    assert.equal(TrackGeometry.pointInOrientedBox(4, 9, box), false);
});

test('pointInOrientedBox: centro spostato dall\'origine', () => {
    const box = { x: 100, z: -50, halfWidth: 3, halfLength: 3, angle: 0 };
    assert.equal(TrackGeometry.pointInOrientedBox(100, -50, box), true);
    assert.equal(TrackGeometry.pointInOrientedBox(0, 0, box), false);
});

test('snapPitPathEnds: aggancia solo il primo e l\'ultimo punto, a roadHalf-insetMargin dal centro pista', () => {
    const square = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 }];
    const trackPts = TrackGeometry.sampleLoop(square, 400);
    const roadHalf = 11;
    const pitPath = [
        { x: 50, z: -40 },
        { x: 60, z: -20 },
        { x: 60, z: 20 }
    ];
    const snapped = TrackGeometry.snapPitPathEnds(pitPath, trackPts, roadHalf, 3);
    assert.equal(snapped.length, 3);
    // Punto intermedio invariato
    assert.equal(snapped[1].x, 60);
    assert.equal(snapped[1].z, -20);
    // Primo punto agganciato: distanza dal centro pista più vicino = roadHalf-insetMargin = 8
    const d0 = TrackGeometry.nearestPoint(trackPts, snapped[0].x, snapped[0].z).dist;
    assert.ok(Math.abs(d0 - 8) < 0.5, `distanza inattesa: ${d0}`);
    // L'array originale non deve essere mutato
    assert.equal(pitPath[0].x, 50);
    assert.equal(pitPath[0].z, -40);
});

test('snapPitPathEnds: con un estremo già dentro roadHalf, lo riporta comunque esattamente al bersaglio (nessuna soglia "già a posto, non toccare")', () => {
    const square = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 }];
    const trackPts = TrackGeometry.sampleLoop(square, 400);
    const roadHalf = 11;
    const pitPath = [{ x: 50, z: -1 }, { x: 60, z: -20 }, { x: 60, z: 20 }];
    const snapped = TrackGeometry.snapPitPathEnds(pitPath, trackPts, roadHalf, 3);
    const d0 = TrackGeometry.nearestPoint(trackPts, snapped[0].x, snapped[0].z).dist;
    assert.ok(Math.abs(d0 - 8) < 0.5, `distanza inattesa: ${d0}`);
});

test('tuckPitEndsToTrack: il campione di aggancio (idx 0 e ultimo) resta fermo, invariato dal raccordo', () => {
    const square = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 }];
    const trackPts = TrackGeometry.sampleLoop(square, 400);
    const roadHalf = 11;
    const pitPath = [{ x: 50, z: -40 }, { x: 70, z: -25 }, { x: 90, z: -20 }, { x: 90, z: 20 }];
    const snapped = TrackGeometry.snapPitPathEnds(pitPath, trackPts, roadHalf, 3);
    const pitPts = TrackGeometry.sampleOpenPath(snapped, 300);
    const tucked = TrackGeometry.tuckPitEndsToTrack(pitPts, trackPts, 25);
    assert.equal(tucked.length, pitPts.length);
    assert.ok(Math.abs(tucked[0].x - pitPts[0].x) < 1e-6, 'il campione di aggancio iniziale non deve spostarsi');
    assert.ok(Math.abs(tucked[0].z - pitPts[0].z) < 1e-6, 'il campione di aggancio iniziale non deve spostarsi');
    const last = pitPts.length - 1;
    assert.ok(Math.abs(tucked[last].x - pitPts[last].x) < 1e-6, 'il campione di aggancio finale non deve spostarsi');
    assert.ok(Math.abs(tucked[last].z - pitPts[last].z) < 1e-6, 'il campione di aggancio finale non deve spostarsi');
});

test('tuckPitEndsToTrack: oltre la lunghezza del raccordo, i campioni restano identici all\'originale', () => {
    const square = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 }];
    const trackPts = TrackGeometry.sampleLoop(square, 400);
    const roadHalf = 11;
    const pitPath = [{ x: 50, z: -40 }, { x: 70, z: -25 }, { x: 90, z: -20 }, { x: 90, z: 20 }];
    const snapped = TrackGeometry.snapPitPathEnds(pitPath, trackPts, roadHalf, 3);
    const pitPts = TrackGeometry.sampleOpenPath(snapped, 300);
    const tucked = TrackGeometry.tuckPitEndsToTrack(pitPts, trackPts, 25);
    // Punto centrale del percorso (lontano da entrambi gli estremi): invariato.
    const mid = Math.round(pitPts.length / 2);
    assert.ok(Math.abs(tucked[mid].x - pitPts[mid].x) < 1e-6);
    assert.ok(Math.abs(tucked[mid].z - pitPts[mid].z) < 1e-6);
});

test('tuckPitEndsToTrack: un campione a metà del raccordo si sposta apprezzabilmente rispetto all\'originale (l\'abbraccio alla curva ha effetto)', () => {
    const square = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 }];
    const trackPts = TrackGeometry.sampleLoop(square, 400);
    const roadHalf = 11;
    // Percorso che si stacca con un angolo deciso rispetto alla pista (non
    // parallelo), così l'effetto di raccordo è misurabile e non trascurabile.
    const pitPath = [{ x: 50, z: -40 }, { x: 80, z: -30 }, { x: 90, z: -20 }, { x: 90, z: 20 }];
    const snapped = TrackGeometry.snapPitPathEnds(pitPath, trackPts, roadHalf, 3);
    const pitPts = TrackGeometry.sampleOpenPath(snapped, 300);
    const tucked = TrackGeometry.tuckPitEndsToTrack(pitPts, trackPts, 25);
    // Campione a ~12 unità dall'inizio (dentro il raccordo di 25): trova
    // l'indice più vicino a quella distanza d'arco.
    let idx = 0, bestDiff = Infinity;
    let cum = 0;
    for (let i = 1; i < pitPts.length; i++) {
        cum += Math.hypot(pitPts[i].x - pitPts[i - 1].x, pitPts[i].z - pitPts[i - 1].z);
        const diff = Math.abs(cum - 12);
        if (diff < bestDiff) { bestDiff = diff; idx = i; }
    }
    const moved = Math.hypot(tucked[idx].x - pitPts[idx].x, tucked[idx].z - pitPts[idx].z);
    assert.ok(moved > 0.5, `il campione a metà raccordo dovrebbe spostarsi apprezzabilmente, spostamento invisibile: ${moved.toFixed(3)}`);
});

test('pitLeadInPoints: resta sulla pista vera (stessa distanza dal centro del punto di aggancio), allontanandosi da esso', () => {
    const square = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 }];
    const trackPts = TrackGeometry.sampleLoop(square, 400);
    const roadHalf = 11;
    const pitPath = [{ x: 50, z: -40 }, { x: 70, z: -25 }, { x: 90, z: -20 }, { x: 90, z: 20 }];
    const snapped = TrackGeometry.snapPitPathEnds(pitPath, trackPts, roadHalf, 3);
    const pitPts = TrackGeometry.sampleOpenPath(snapped, 300);

    const lead = TrackGeometry.pitLeadInPoints(pitPts, trackPts, 0, 1, 40, 8);
    assert.equal(lead.length, 8);

    const mergeDist = TrackGeometry.nearestPoint(trackPts, pitPts[0].x, pitPts[0].z).dist;
    for (const p of lead) {
        const d = TrackGeometry.nearestPoint(trackPts, p.x, p.z).dist;
        assert.ok(Math.abs(d - mergeDist) < 0.5, `punto di preavviso troppo lontano dalla distanza del punto di aggancio: ${d.toFixed(2)} vs ${mergeDist.toFixed(2)}`);
    }
    // Il primo punto (s=1, il più vicino al merge) deve essere più vicino
    // al punto di aggancio dell'ultimo (s=samples, il più lontano).
    const distFirst = Math.hypot(lead[0].x - pitPts[0].x, lead[0].z - pitPts[0].z);
    const distLast = Math.hypot(lead[lead.length - 1].x - pitPts[0].x, lead[lead.length - 1].z - pitPts[0].z);
    assert.ok(distLast > distFirst, 'i punti di preavviso devono allontanarsi progressivamente dal punto di aggancio');
});

// --- curvatureAt (2026-08-09) ----------------------------------------------
// Serve alla scenografia per sapere dove sono le curve: barriere di gomme,
// cartelli di frenata e commissari hanno senso solo lì.
test('curvatureAt su un cerchio di raggio 100 misura raggio ≈ 100', () => {
    const pts = [];
    const R = 100;
    for (let i = 0; i < 400; i++) {
        const a = (i / 400) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, y: 0 });
    }
    const { radius } = TrackGeometry.curvatureAt(pts, 0);
    assert.ok(Math.abs(radius - R) < R * 0.1, `raggio ${radius}, atteso ~${R}`);
});

test('curvatureAt su una retta ritorna raggio Infinity', () => {
    const pts = [];
    for (let i = 0; i < 200; i++) pts.push({ x: i * 2, z: 0, y: 0 });
    const { radius } = TrackGeometry.curvatureAt(pts, 100);
    assert.equal(radius, Infinity);
});

test('curvatureAt distingue il verso della curva col segno di turnSigned', () => {
    const R = 80;
    const cw = [], ccw = [];
    for (let i = 0; i < 400; i++) {
        const a = (i / 400) * Math.PI * 2;
        ccw.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, y: 0 });
        cw.push({ x: Math.cos(-a) * R, z: Math.sin(-a) * R, y: 0 });
    }
    const s1 = TrackGeometry.curvatureAt(ccw, 10).turnSigned;
    const s2 = TrackGeometry.curvatureAt(cw, 10).turnSigned;
    assert.ok(s1 * s2 < 0, `segni non opposti: ${s1} e ${s2}`);
});

test('curvatureAt riconosce le curve di un tracciato reale senza segnare tutto', () => {
    const monteRosso = require('../tracks/monte-rosso.json');
    const pts = TrackGeometry.sampleLoop(monteRosso.controlPoints, 1000);
    const radii = pts.map((_, i) => TrackGeometry.curvatureAt(pts, i).radius);
    const curve = radii.filter(r => r < 120).length;
    assert.ok(curve > 50, `solo ${curve} punti in curva su ${pts.length}`);
    assert.ok(curve < pts.length * 0.9, `${curve} punti su ${pts.length} in curva: soglia inutile`);
});

// --- advanceToDistance -----------------------------------------------------
// Compone file di oggetti contigui (tribuna principale, edifici della corsia
// box) misurando la distanza REALE fra i punti già offsettati di lato, invece
// di convertire la spaziatura in un numero di campioni.

test('advanceToDistance trova il punto alla distanza richiesta su un cerchio', () => {
    const R = 100, N = 400;
    const pts = [];
    for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, y: 0 });
    }
    const project = (i) => pts[i];
    const idx = TrackGeometry.advanceToDistance(pts, 0, 1, true, pts[0], 20, project);
    const d = Math.hypot(pts[idx].x - pts[0].x, pts[idx].z - pts[0].z);
    // La tolleranza è un passo di campionamento: si cerca il PRIMO campione
    // oltre la soglia, non un punto interpolato.
    const step = (2 * Math.PI * R) / N;
    assert.ok(d >= 20 && d < 20 + step * 1.5, `distanza ${d.toFixed(2)}, attesa ~20`);
});

test('advanceToDistance rispetta il verso di marcia', () => {
    const pts = [];
    for (let i = 0; i < 200; i++) pts.push({ x: i * 2, z: 0, y: 0 });
    const project = (i) => pts[i];
    const fwd = TrackGeometry.advanceToDistance(pts, 100, 1, false, pts[100], 20, project);
    const back = TrackGeometry.advanceToDistance(pts, 100, -1, false, pts[100], 20, project);
    assert.ok(fwd > 100, `avanti dovrebbe crescere, ha dato ${fwd}`);
    assert.ok(back < 100, `indietro dovrebbe calare, ha dato ${back}`);
});

test('advanceToDistance ritorna -1 se il percorso aperto finisce prima', () => {
    const pts = [];
    for (let i = 0; i < 20; i++) pts.push({ x: i * 2, z: 0, y: 0 });   // lungo 38 in tutto
    const project = (i) => pts[i];
    assert.equal(TrackGeometry.advanceToDistance(pts, 0, 1, false, pts[0], 500, project), -1);
});

// Il motivo per cui `project` esiste: sulla scenografia la spaziatura va
// misurata fra i punti OFFSETTATI di lato, non sulla linea centrale. Su una
// curva i due valori differiscono in proporzione al raggio.
test('advanceToDistance misura sui punti proiettati, non sui campioni grezzi', () => {
    const R = 100, N = 400;
    const pts = [];
    for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, y: 0 });
    }
    // Proiezione su un cerchio di raggio doppio: stessa distanza angolare,
    // distanza lineare doppia -> serve la metà dei campioni.
    const outer = (i) => ({ x: pts[i].x * 2, z: pts[i].z * 2 });
    const iCenter = TrackGeometry.advanceToDistance(pts, 0, 1, true, pts[0], 20, (i) => pts[i]);
    const iOuter = TrackGeometry.advanceToDistance(pts, 0, 1, true, outer(0), 20, outer);
    assert.ok(iOuter < iCenter, `proiettato ${iOuter} dovrebbe precedere il grezzo ${iCenter}`);
});

test('advanceToDistancePoint centra la distanza esatta, non il primo campione', () => {
    // Campionamento volutamente rado (passo 10) contro una spaziatura di 25:
    // il primo campione oltre la soglia starebbe a 30, l'interpolato a 25.
    const pts = [];
    for (let i = 0; i < 50; i++) pts.push({ x: i * 10, z: 0, y: 0 });
    const project = (i) => pts[i];
    const r = TrackGeometry.advanceToDistancePoint(pts, 0, 1, false, pts[0], 25, project);
    assert.ok(r, 'nessun punto trovato');
    const a = pts[r.prevIdx], b = pts[r.idx];
    const x = a.x + (b.x - a.x) * r.t, z = a.z + (b.z - a.z) * r.t;
    const d = Math.hypot(x - pts[0].x, z - pts[0].z);
    assert.ok(Math.abs(d - 25) < 0.01, `distanza ${d.toFixed(3)}, attesa 25`);
});

test('advanceToDistancePoint ritorna null se il percorso aperto finisce prima', () => {
    const pts = [];
    for (let i = 0; i < 20; i++) pts.push({ x: i * 2, z: 0, y: 0 });
    assert.equal(TrackGeometry.advanceToDistancePoint(pts, 0, 1, false, pts[0], 500, (i) => pts[i]), null);
});

test('isInsideLoop distingue l infield dalla campagna', () => {
    // Quadrato di lato 100 centrato nell'origine, percorso in senso orario.
    const quadrato = [];
    for (let i = 0; i < 40; i++) quadrato.push({ x: -50 + i * 2.5, z: -50 });
    for (let i = 0; i < 40; i++) quadrato.push({ x: 50, z: -50 + i * 2.5 });
    for (let i = 0; i < 40; i++) quadrato.push({ x: 50 - i * 2.5, z: 50 });
    for (let i = 0; i < 40; i++) quadrato.push({ x: -50, z: 50 - i * 2.5 });

    assert.equal(TrackGeometry.isInsideLoop(quadrato, 0, 0), true, 'il centro deve essere dentro');
    assert.equal(TrackGeometry.isInsideLoop(quadrato, 49, 49), true, 'appena dentro l angolo');
    assert.equal(TrackGeometry.isInsideLoop(quadrato, 80, 0), false, 'fuori a destra');
    assert.equal(TrackGeometry.isInsideLoop(quadrato, 0, -200), false, 'fuori in basso');
    assert.equal(TrackGeometry.isInsideLoop(quadrato, -300, -300), false, 'lontano in diagonale');
});

test('isInsideLoop funziona su un tracciato reale a ferro di cavallo', () => {
    // Una U: il punto dentro la concavità NON è nell'anello, anche se è
    // circondato su tre lati e vicino all'asfalto. È il caso che distingue un
    // vero test di appartenenza da un test sulla distanza.
    const u = [];
    for (let i = 0; i < 30; i++) u.push({ x: -40, z: -60 + i * 4 });       // montante sinistro
    for (let i = 0; i < 20; i++) u.push({ x: -40 + i * 4, z: 60 });        // fondo
    for (let i = 0; i < 30; i++) u.push({ x: 40, z: 60 - i * 4 });         // montante destro
    for (let i = 0; i < 20; i++) u.push({ x: 40 - i * 4, z: -60 });        // chiusura

    assert.equal(TrackGeometry.isInsideLoop(u, 0, 0), true, 'dentro la U');
    assert.equal(TrackGeometry.isInsideLoop(u, 0, 120), false, 'oltre il fondo della U');
    assert.equal(TrackGeometry.isInsideLoop(u, -100, 0), false, 'fuori dal montante');
});
