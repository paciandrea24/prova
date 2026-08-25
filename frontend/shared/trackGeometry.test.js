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

// La spaziatura si legge dalla costante invece di essere ricopiata: quando e'
// passata da 24 a 15 (per far stare piu' box in una corsia corta) questo test
// diceva "atteso x=76" senza spiegare da dove venisse quel 76.
test('pitBoxAnchors centra le posizioni su boxIndex, spaziate di PIT_BOX_SPACING', () => {
    const passo = TrackGeometry.PIT_BOX_SPACING;
    const path = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 0 }];
    const anchors = TrackGeometry.pitBoxAnchors(path, 2, 3);
    assert.ok(Math.abs(anchors[0].x - (100 - passo)) < 1e-6, `atteso x=${100 - passo}, trovato ${anchors[0].x}`);
    assert.ok(Math.abs(anchors[1].x - 100) < 1e-6, `atteso x=100 (boxIndex), trovato ${anchors[1].x}`);
    assert.ok(Math.abs(anchors[2].x - (100 + passo)) < 1e-6, `atteso x=${100 + passo}, trovato ${anchors[2].x}`);
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

test('findCorners: un cerchio è tutto curva, un rettilineo non ha curve', () => {
    // Cerchio di raggio 60: sotto CORNER_RADIUS_MAX, quindi tutto in curva.
    // findCorners richiede almeno un punto NON in curva per partire (evita
    // run spezzati a cavallo dell'indice 0), quindi su un cerchio perfetto
    // ritorna vuoto: è il comportamento documentato, non un difetto.
    const cerchio = [];
    for (let i = 0; i < 200; i++) {
        const a = i / 200 * Math.PI * 2;
        cerchio.push({ x: Math.cos(a) * 60, z: Math.sin(a) * 60 });
    }
    assert.equal(TrackGeometry.findCorners(cerchio).length, 0);

    // Ovale: due semicerchi di raggio 60 uniti da due rettilinei da 400.
    // Deve trovare due curve.
    const ovale = [];
    for (let i = 0; i < 100; i++) ovale.push({ x: -200 + i * 4, z: -60 });
    for (let i = 0; i < 60; i++) {
        const a = -Math.PI / 2 + (i / 60) * Math.PI;
        ovale.push({ x: 200 + Math.cos(a) * 60, z: Math.sin(a) * 60 });
    }
    for (let i = 0; i < 100; i++) ovale.push({ x: 200 - i * 4, z: 60 });
    for (let i = 0; i < 60; i++) {
        const a = Math.PI / 2 + (i / 60) * Math.PI;
        ovale.push({ x: -200 + Math.cos(a) * 60, z: Math.sin(a) * 60 });
    }
    const curve = TrackGeometry.findCorners(ovale);
    assert.equal(curve.length, 2, 'un ovale ha due curve');
    for (const c of curve) {
        assert.ok(c.side === 1 || c.side === -1, 'side deve essere ±1');
        assert.ok(c.radius < TrackGeometry.CORNER_RADIUS_MAX);
    }
});

test('findCorners: minRadius è il raggio più stretto dell\'arco, non quello di metà curva', () => {
    // Caso che distingue le due misure: una curva che si CHIUDE, cioè un
    // arco largo (raggio 110) seguito senza soluzione di continuità da uno
    // stretto (raggio 30). Sono un'unica curva — entrambi sotto
    // CORNER_RADIUS_MAX — e il punto medio cade nell'arco largo, dove il
    // raggio non dice niente di quanto si dovrà rallentare.
    //
    // Il tracciato si costruisce integrando la DIREZIONE, non accostando
    // archi già pronti: due archi accostati per coordinate non sono tangenti
    // fra loro, e il gomito falsa la curvatura misurata proprio nel punto che
    // interessa. Un mezzo giro (arco largo, arco stretto, rettilineo) ripetuto
    // due volte gira di 360° in tutto e si richiude per simmetria.
    const PASSO = 2;
    const pts = [];
    let x = 0, z = 0, dir = 0;
    const avanza = (lunghezza, raggio) => {
        for (let d = 0; d < lunghezza; d += PASSO) {
            pts.push({ x, z, y: 0 });
            x += Math.cos(dir) * PASSO;
            z += Math.sin(dir) * PASSO;
            if (raggio) dir += PASSO / raggio;
        }
    };
    for (let meta = 0; meta < 2; meta++) {
        avanza(110 * Math.PI / 2, 110);   // arco largo, 90°
        avanza(30 * Math.PI / 2, 30);     // arco stretto, 90°
        avanza(200, 0);                   // rettilineo
    }

    const curve = TrackGeometry.findCorners(pts);
    assert.equal(curve.length, 2, 'due mezzi giri, due curve');
    for (const c of curve) {
        assert.ok(c.radius > 80,
            `a metà curva si è ancora nell'arco largo: atteso raggio > 80, ottenuto ${c.radius.toFixed(0)}`);
        assert.ok(c.minRadius < 45,
            `minRadius deve trovare l'arco stretto (~30), ottenuto ${c.minRadius.toFixed(1)}`);
    }
});

// ---- ribbonFacingAt: guardare il nastro, non la pista ----
//
// Un oggetto posato accanto alla pista deve guardare perpendicolarmente al
// NASTRO su cui sta, che coincide con la pista solo se la distanza è
// costante. Dove il muro sale o scende il nastro è inclinato, e un oggetto
// orientato sulla normale della pista risulta storto: misurati 30° sulla
// tribuna del campione 615 di `prova` (2026-08-13).

function rettilineo(n = 200, passo = 5) {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push({ x: i * passo, z: 0, y: 0 });
    return pts;
}

test('ribbonFacingAt: a distanza costante coincide con la normale della pista', () => {
    const pts = rettilineo();
    for (const side of [-1, 1]) {
        const atteso = Math.atan2(0, -side);   // guarda verso la pista
        const avuto = TrackGeometry.ribbonFacingAt(pts, 50, side, () => 20);
        const d = Math.abs(Math.atan2(Math.sin(avuto - atteso), Math.cos(avuto - atteso)));
        assert.ok(d < 1e-9, `lato ${side}: atteso ${atteso}, avuto ${avuto}`);
    }
});

test('ribbonFacingAt: su una rampa ruota quanto il nastro è inclinato', () => {
    // Il nastro si allontana di 5 unità ogni campione, e il campione è lungo
    // 5: il nastro sta a 45° rispetto alla pista, quindi anche la
    // perpendicolare al nastro sta a 45° dalla normale della pista.
    const pts = rettilineo();
    const dritto = TrackGeometry.ribbonFacingAt(pts, 50, 1, () => 20);
    const inRampa = TrackGeometry.ribbonFacingAt(pts, 50, 1, (i) => 20 + i * 5);
    let delta = inRampa - dritto;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    assert.ok(Math.abs(Math.abs(delta) - Math.PI / 4) < 1e-6,
        `attesi 45°, avuti ${(delta * 180 / Math.PI).toFixed(2)}°`);
});

test('ribbonFacingAt: guarda sempre verso la pista, su entrambi i lati', () => {
    const pts = rettilineo();
    for (const side of [-1, 1]) {
        const rot = TrackGeometry.ribbonFacingAt(pts, 50, side, (i) => 20 + i * 2);
        const { nx, nz } = TrackGeometry.normalAt(pts, 50, true);
        const d = 20 + 50 * 2;
        const qui = { x: pts[50].x + nx * d * side, z: pts[50].z + nz * d * side };
        // il verso indicato da rotY deve avvicinarsi al punto pista
        const vx = Math.sin(rot), vz = Math.cos(rot);
        assert.ok((pts[50].x - qui.x) * vx + (pts[50].z - qui.z) * vz > 0,
            `lato ${side}: l'oggetto dà le spalle alla pista`);
    }
});

test('ribbonFacingAt: riceve il lato e lo passa alla funzione di distanza', () => {
    const pts = rettilineo();
    const visti = [];
    TrackGeometry.ribbonFacingAt(pts, 50, -1, (i, side) => { visti.push(side); return 20; });
    assert.ok(visti.length > 0 && visti.every(s => s === -1),
        `atteso lato -1 a ogni chiamata, visti ${[...new Set(visti)].join(',')}`);
});

test('ribbonFacingAt: si allinea alla corda che l\'oggetto sottende', () => {
    // Nastro che si allontana solo per un tratto breve: al centro della rampa
    // la tangente puntuale e la corda sottesa da un oggetto largo divergono.
    // Un oggetto è un segmento rigido: deve stare parallelo alla corda, o le
    // sue estremità restano staccate dal muro.
    const pts = rettilineo();
    const dist = (i) => 20 + (i >= 48 && i <= 52 ? (i - 48) * 5 : (i > 52 ? 20 : 0));
    const stretto = TrackGeometry.ribbonFacingAt(pts, 50, 1, dist, 1);
    const largo = TrackGeometry.ribbonFacingAt(pts, 50, 1, dist, 4);

    // La corda su ±4 campioni comprende anche i tratti piatti prima e dopo la
    // rampa, quindi è meno inclinata della tangente al centro.
    const inclinazione = (rot) => {
        const dritto = TrackGeometry.ribbonFacingAt(pts, 50, 1, () => 20, 1);
        let d = rot - dritto;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return Math.abs(d);
    };
    assert.ok(inclinazione(largo) < inclinazione(stretto),
        `la corda larga dovrebbe essere meno inclinata: ${(inclinazione(largo) * 180 / Math.PI).toFixed(1)}° `
        + `contro ${(inclinazione(stretto) * 180 / Math.PI).toFixed(1)}°`);
});

test('guardaVersoLaPista: passa chi guarda la pista, boccia chi le dà il fianco', () => {
    // Anello di raggio 100 centrato nell'origine, campionato fitto.
    const pts = [];
    for (let i = 0; i < 400; i++) {
        const a = (i / 400) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * 100, z: Math.sin(a) * 100 });
    }
    // Oggetto a 130 dal centro, sul raggio a 0°: la pista gli sta verso
    // l'origine, quindi deve guardare in quella direzione.
    const buono = { x: 130, z: 0, rotY: Math.atan2(0 - 130, 0 - 0) };
    assert.ok(TrackGeometry.guardaVersoLaPista(pts, buono),
        'un oggetto che guarda verso l\'asse deve passare');

    // Stesso posto, girato di 90°: dà il fianco alla pista.
    const storto = { x: 130, z: 0, rotY: buono.rotY + Math.PI / 2 };
    assert.ok(!TrackGeometry.guardaVersoLaPista(pts, storto),
        'un oggetto girato di 90° deve essere bocciato');

    // 20° di scarto: sotto la soglia di 30°, passa.
    const quasi = { x: 130, z: 0, rotY: buono.rotY + Math.PI / 9 };
    assert.ok(TrackGeometry.guardaVersoLaPista(pts, quasi),
        '20° di scarto stanno sotto la soglia di 30° e devono passare');
});

// ═══════════ LA GRIGLIA DI POSIZIONI DELLA CORSIA BOX ═══════════
//
// Box dei piloti ed edifici decorativi stanno sulla STESSA fila. Finché
// avevano due passi diversi (24 i box, ~22.65 la catena degli edifici) e due
// fasi diverse, fra un elemento e l'altro restavano vuoti: su monte-rosso i
// box occupavano tutti i campioni utili e gli edifici scendevano a zero.
// pitLaneSlots è la griglia unica su cui si posano gli uni e gli altri.
test('pitLaneSlots: posizioni regolari su tutta la corsia, a passo PIT_BOX_SPACING', () => {
    const corsia = [];
    for (let i = 0; i <= 150; i++) corsia.push({ x: i * 2, y: 0, z: 0 });
    const pista = [];
    for (let i = 0; i <= 150; i++) pista.push({ x: i * 2, y: 0, z: 40 });

    const slot = TrackGeometry.pitLaneSlots(corsia, 75, pista, 5);

    assert.ok(slot.length >= 12, `attese almeno 12 posizioni su 300 unità, trovate ${slot.length}`);
    for (let i = 1; i < slot.length; i++) {
        const d = Math.hypot(slot[i].x - slot[i - 1].x, slot[i].z - slot[i - 1].z);
        assert.ok(Math.abs(d - TrackGeometry.PIT_BOX_SPACING) < 0.6,
            `posizioni ${i - 1} e ${i} distanti ${d.toFixed(2)}, atteso ${TrackGeometry.PIT_BOX_SPACING}`);
    }
    slot.forEach((s, i) => assert.equal(s.indice, i, 'indice progressivo'));
});

test('pitBoxAnchors resta le posizioni CENTRALI della stessa griglia', () => {
    const corsia = [];
    for (let i = 0; i <= 150; i++) corsia.push({ x: i * 2, y: 0, z: 0 });
    const pista = [];
    for (let i = 0; i <= 150; i++) pista.push({ x: i * 2, y: 0, z: 40 });

    const slot = TrackGeometry.pitLaneSlots(corsia, 75, pista, 5);
    const box = TrackGeometry.pitBoxAnchors(corsia, 75, 4, pista, 5);

    for (const b of box) {
        const trovato = slot.some(s => Math.hypot(s.x - b.x, s.z - b.z) < 0.01);
        assert.ok(trovato,
            `box a (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) non cade su nessuna posizione della griglia`);
    }
});

// La griglia NON toglie margine agli estremi: e' geometria pura. Il primo
// tentativo ne toglieva 40 per capo e su monte-rosso restavano 8 posizioni su
// 13, cioe' meta' del guadagno del passo stretto buttata via. I controlli di
// distanza dalla pista li fa chi posa gli edifici.
test('pitLaneSlots copre la corsia per intero', () => {
    const corsia = [];
    for (let i = 0; i <= 150; i++) corsia.push({ x: i * 2, y: 0, z: 0 });
    const pista = [];
    for (let i = 0; i <= 150; i++) pista.push({ x: i * 2, y: 0, z: 40 });

    const slot = TrackGeometry.pitLaneSlots(corsia, 75, pista, 5);
    const attese = Math.floor(150 / TrackGeometry.PIT_BOX_SPACING) + Math.floor(150 / TrackGeometry.PIT_BOX_SPACING) + 1;
    assert.equal(slot.length, attese,
        `su 300 unita' a passo ${TrackGeometry.PIT_BOX_SPACING} attese ${attese} posizioni`);
});

// ---- la larghezza si interpola come la quota ----
//
// Fra un tratto largo e uno stretto deve nascere un RACCORDO, non uno
// scalino: i circuiti veri non cambiano larghezza di colpo.
// Rif. «larghezza variabile», blocco D, 2026-08-25.
test('il ricampionamento porta e interpola la mezza carreggiata', () => {
    const controlPoints = [];
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        controlPoints.push({
            x: Math.sin(a) * 200, y: 0, z: Math.cos(a) * 200,
            halfWidth: i < 6 ? 11 : 20,
        });
    }
    const pts = TrackGeometry.sampleLoop(controlPoints, 400);
    assert.ok(pts.every(p => typeof p.halfWidth === 'number'), 'un punto ha perso la larghezza');
    const min = Math.min(...pts.map(p => p.halfWidth));
    const max = Math.max(...pts.map(p => p.halfWidth));
    assert.ok(min >= 10.9 && max <= 20.1, `larghezze fuori dai due valori: ${min}..${max}`);
    // Il raccordo: devono esistere valori INTERMEDI, altrimenti e' uno scalino.
    assert.ok(pts.some(p => p.halfWidth > 12 && p.halfWidth < 19),
        'nessun valore intermedio: il cambio di larghezza e\' a scalino');
});

test('senza larghezza sui punti di controllo il campo non compare', () => {
    // Le piste vecchie non devono guadagnare un campo dal nulla: a riempirlo
    // e' un posto solo, il caricatore di pista.
    const controlPoints = [];
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        controlPoints.push({ x: Math.sin(a) * 200, y: 0, z: Math.cos(a) * 200 });
    }
    for (const p of TrackGeometry.sampleLoop(controlPoints, 100)) {
        assert.equal(p.halfWidth, undefined);
    }
});

// --- pendenzaAt (fase 1a: gravita' lungo il nastro) ---

// Una rampa dritta lungo z, che sale di 1 ogni 10 unita' = 10% = atan(0.1).
function rampa(pendenzaPct, n) {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push({ x: 0, z: i * 10, y: i * 10 * pendenzaPct / 100 });
    return pts;
}

test('pendenzaAt e\' positiva in salita e vale atan della pendenza', () => {
    const pts = rampa(10, 20);
    const attesa = Math.atan2(1, 10);   // +10%
    for (let i = 1; i < pts.length - 1; i++) {
        assert.ok(Math.abs(TrackGeometry.pendenzaAt(pts, i, false) - attesa) < 1e-9,
            `campione ${i}: ${TrackGeometry.pendenzaAt(pts, i, false)} invece di ${attesa}`);
    }
});

test('pendenzaAt e\' negativa in discesa, simmetrica alla salita', () => {
    const su = rampa(10, 20), giu = rampa(-10, 20);
    assert.ok(Math.abs(TrackGeometry.pendenzaAt(su, 5, false) + TrackGeometry.pendenzaAt(giu, 5, false)) < 1e-12);
});

test('pendenzaAt e\' zero su un tracciato piatto, anche senza il campo y', () => {
    const piatto = [{ x: 0, z: 0 }, { x: 0, z: 10 }, { x: 0, z: 20 }, { x: 0, z: 30 }];
    assert.equal(TrackGeometry.pendenzaAt(piatto, 1, false), 0);
    assert.equal(TrackGeometry.pendenzaAt(piatto, 2, true), 0);
});

// Su un giro chiuso il campione 0 guarda l'ultimo campione, non se stesso:
// senza il wrap la pendenza al traguardo sarebbe sempre meta' di quella vera.
test('pendenzaAt chiude il giro: il campione 0 usa l\'ultimo campione', () => {
    const anello = [
        { x: 0, z: 0, y: 0 }, { x: 10, z: 0, y: 1 },
        { x: 10, z: 10, y: 2 }, { x: 0, z: 10, y: 1 }
    ];
    const p0 = TrackGeometry.pendenzaAt(anello, 0, true);
    // Fra il campione 3 (y=1) e il campione 1 (y=1) il dislivello e' nullo.
    assert.ok(Math.abs(p0) < 1e-12, `pendenza al traguardo: ${p0}`);
});

// --- rialzoBordi (fase 1b-1: banking) ---

// Un cerchio percorso ad angolo crescente, con rollio costante su ogni punto.
function cerchioConRollio(raggio, n, rollio) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * raggio, z: Math.sin(a) * raggio, y: 0, rollio });
    }
    return pts;
}

test('senza sopraelevazione nessun bordo si alza', () => {
    const pts = cerchioConRollio(200, 120, 0);
    const r = TrackGeometry.rialzoBordi(pts, 30, 11);
    assert.equal(r.dyAlto, 0);
    assert.equal(r.latoAlto, 0);
});

test('con la sopraelevazione un bordo sale di sin(rollio) per la carreggiata', () => {
    const rollio = 18 * Math.PI / 180;
    const pts = cerchioConRollio(200, 120, rollio);
    const r = TrackGeometry.rialzoBordi(pts, 30, 11);
    assert.ok(Math.abs(r.dyAlto - Math.sin(rollio) * 22) < 1e-9,
        `alzata ${r.dyAlto} invece di ${Math.sin(rollio) * 22}`);
    assert.notEqual(r.latoAlto, 0);
});

// Il cuore della decisione D6: si alza sempre l'ESTERNO. Verificato contro la
// geometria vera (il bordo piu' lontano dal centro del cerchio), non dedotto
// dalla convenzione di segno di normalAt.
test('si alza il bordo esterno, quello lontano dal centro della curva', () => {
    const rollio = 18 * Math.PI / 180;
    const pts = cerchioConRollio(200, 120, rollio);
    const i = 30, mezza = 11;
    const { latoAlto } = TrackGeometry.rialzoBordi(pts, i, mezza);
    const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
    const p = pts[i];
    // Il centro del cerchio e' l'origine: il bordo alto deve esserne piu' lontano.
    const distAlto  = Math.hypot(p.x + nx * mezza * latoAlto, p.z + nz * mezza * latoAlto);
    const distBasso = Math.hypot(p.x - nx * mezza * latoAlto, p.z - nz * mezza * latoAlto);
    assert.ok(distAlto > distBasso,
        `il bordo alto dista ${distAlto.toFixed(1)} dal centro, quello basso ${distBasso.toFixed(1)}`);
});

test('curve di verso opposto alzano bordi opposti', () => {
    const rollio = 18 * Math.PI / 180;
    const orario = cerchioConRollio(200, 120, rollio);
    const antiorario = [...orario].reverse();
    const a = TrackGeometry.rialzoBordi(orario, 30, 11);
    const b = TrackGeometry.rialzoBordi(antiorario, 30, 11);
    assert.equal(a.latoAlto, -b.latoAlto, 'le due curve alzano lo stesso lato');
});

test('alzataLaterale: zero sul bordo basso, tutta l\'alzata su quello alto', () => {
    const rollio = 18 * Math.PI / 180;
    const pts = cerchioConRollio(200, 120, rollio);
    const i = 30, mezza = 11;
    const { dyAlto, latoAlto } = TrackGeometry.rialzoBordi(pts, i, mezza);
    assert.ok(Math.abs(TrackGeometry.alzataLaterale(pts, i, mezza, -latoAlto * mezza)) < 1e-12);
    assert.ok(Math.abs(TrackGeometry.alzataLaterale(pts, i, mezza, latoAlto * mezza) - dyAlto) < 1e-12);
    assert.ok(Math.abs(TrackGeometry.alzataLaterale(pts, i, mezza, 0) - dyAlto / 2) < 1e-12,
        'in mezzeria deve valere meta\' dell\'alzata');
});

test('alzataLaterale prosegue oltre il bordo con la stessa pendenza', () => {
    // È ciò che serve al cordolo, che sta FUORI dalla carreggiata: su una
    // parabolica prosegue il piano inclinato, non torna piatto.
    const rollio = 18 * Math.PI / 180;
    const pts = cerchioConRollio(200, 120, rollio);
    const i = 30, mezza = 11, curbW = 2.8;
    const { latoAlto } = TrackGeometry.rialzoBordi(pts, i, mezza);
    const alBordo = TrackGeometry.alzataLaterale(pts, i, mezza, latoAlto * mezza);
    const oltre = TrackGeometry.alzataLaterale(pts, i, mezza, latoAlto * (mezza + curbW));
    assert.ok(Math.abs((oltre - alBordo) - Math.sin(rollio) * curbW) < 1e-12,
        `il cordolo sale di ${(oltre - alBordo).toFixed(4)} invece di ${(Math.sin(rollio) * curbW).toFixed(4)}`);
});

test('alzataLaterale non scende MAI sotto zero, oltre il bordo basso', () => {
    // La sopraelevazione si costruisce alzando l'esterno, non scavando
    // l'interno: prolungare il piano da quella parte seppellirebbe il cordolo
    // interno e vorrebbe una trincea nel terreno.
    const rollio = 30 * Math.PI / 180;
    const pts = cerchioConRollio(200, 120, rollio);
    const i = 30, mezza = 11;
    const { latoAlto } = TrackGeometry.rialzoBordi(pts, i, mezza);
    for (const oltre of [mezza, mezza + 2.8, mezza + 20, mezza + 100]) {
        assert.equal(TrackGeometry.alzataLaterale(pts, i, mezza, -latoAlto * oltre), 0,
            `a ${oltre} unita' oltre il bordo basso l'alzata deve restare zero`);
    }
});

test('alzataLaterale e\' zero ovunque su una pista piana', () => {
    const pts = cerchioConRollio(200, 120, 0);
    for (const off of [-20, -11, 0, 11, 20]) {
        assert.equal(TrackGeometry.alzataLaterale(pts, 30, 11, off), 0);
    }
});

// --- il cuneo di terra sotto una curva sopraelevata ---

test('terrainHeightAt: sul lato alto il terreno parte dalla quota del bordo alzato', () => {
    // Senza, fra l'asfalto inclinato e la terra resta una fessura aperta — ed è
    // lo stesso difetto del prato che galleggiava sopra le discese: la quota
    // del terreno deve conoscere il rilievo, o gli oggetti ci restano appesi.
    const rollio = 18 * Math.PI / 180;
    const pts = cerchioConRollio(200, 120, rollio);
    const i = 30, mezza = 11, PLATEAU = 14, OUTER = 60;
    for (const p of pts) p.halfWidth = mezza;
    const { latoAlto } = TrackGeometry.rialzoBordi(pts, i, mezza);
    const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
    // Un punto appena fuori dal cordolo, sul lato alto.
    const x = pts[i].x + nx * latoAlto * PLATEAU;
    const z = pts[i].z + nz * latoAlto * PLATEAU;
    const y = TrackGeometry.terrainHeightAt(pts, x, z, PLATEAU, OUTER);
    const atteso = TrackGeometry.alzataLaterale(pts, i, mezza, latoAlto * PLATEAU);
    assert.ok(Math.abs(y - atteso) < 0.3, `terreno a ${y.toFixed(2)} invece di ${atteso.toFixed(2)}`);
    assert.ok(y > 2, 'il cuneo deve alzarsi davvero, non restare a filo del prato');
});

test('terrainHeightAt: sul lato basso il terreno resta dov\'era', () => {
    const rollio = 18 * Math.PI / 180;
    const pts = cerchioConRollio(200, 120, rollio);
    const i = 30, mezza = 11, PLATEAU = 14, OUTER = 60;
    for (const p of pts) p.halfWidth = mezza;
    const { latoAlto } = TrackGeometry.rialzoBordi(pts, i, mezza);
    const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
    const x = pts[i].x - nx * latoAlto * PLATEAU;
    const z = pts[i].z - nz * latoAlto * PLATEAU;
    assert.ok(Math.abs(TrackGeometry.terrainHeightAt(pts, x, z, PLATEAU, OUTER)) < 1e-9,
        'il lato interno di una curva sopraelevata resta alla quota che aveva');
});

test('terrainHeightAt: lontano dalla pista il cuneo e\' finito', () => {
    const pts = cerchioConRollio(200, 120, 18 * Math.PI / 180);
    for (const p of pts) p.halfWidth = 11;
    const { nx, nz } = TrackGeometry.normalAt(pts, 30, true);
    const x = pts[30].x + nx * 200, z = pts[30].z + nz * 200;
    assert.equal(TrackGeometry.terrainHeightAt(pts, x, z, 14, 60), 0);
});

test('terrainHeightAt: senza sopraelevazione i valori sono quelli di prima', () => {
    // Regressione: le piste piane non devono cambiare di un millimetro.
    const piano = cerchioConRollio(200, 120, 0);
    for (const p of piano) { p.halfWidth = 11; p.y = 3; }
    const { nx, nz } = TrackGeometry.normalAt(piano, 30, true);
    for (const off of [5, 14, 30, 60, 120]) {
        const x = piano[30].x + nx * off, z = piano[30].z + nz * off;
        const atteso = off <= 14 ? 3 : (off >= 60 ? 0 : null);
        const y = TrackGeometry.terrainHeightAt(piano, x, z, 14, 60);
        if (atteso !== null) assert.ok(Math.abs(y - atteso) < 0.3, `a ${off}: ${y} invece di ${atteso}`);
        else assert.ok(y > 0 && y < 3, `a ${off}: ${y} fuori dalla rampa`);
    }
});

test('su un tratto dritto la sopraelevazione non ha effetto', () => {
    // Un rettilineo non ha un esterno: senza una curva, "si alza l'esterno" non
    // vuol dire niente. Il validatore lo segnalera' invece di lasciare una
    // sopraelevazione che non si vede.
    const dritto = [];
    for (let i = 0; i < 60; i++) dritto.push({ x: 0, z: i * 10, y: 0, rollio: 0.3 });
    const r = TrackGeometry.rialzoBordi(dritto, 30, 11);
    assert.equal(r.latoAlto, 0, 'un rettilineo non ha un lato esterno');
    assert.equal(r.dyAlto, 0);
});

// Il beccheggio visivo dell'auto e' la pendenza NEGATA (in Three una rotazione
// X positiva abbassa il muso). Questo test blocca il segno: se pendenzaAt
// cambiasse verso, l'auto si inclinerebbe al contrario sulle salite e nessun
// altro test se ne accorgerebbe.
test('il beccheggio visivo e\' la pendenza negata (formula storica di f1.js)', () => {
    const anello = [
        { x: 0, z: 0, y: 0 }, { x: 10, z: 0, y: 1 }, { x: 20, z: 0, y: 3 },
        { x: 30, z: 0, y: 3 }, { x: 40, z: 0, y: 1 }, { x: 50, z: 0, y: 0 }
    ];
    for (let i = 0; i < anello.length; i++) {
        const n = anello.length;
        const prev = anello[(i - 1 + n) % n], next = anello[(i + 1) % n];
        const dy = (next.y || 0) - (prev.y || 0);
        const horiz = Math.hypot(next.x - prev.x, next.z - prev.z) || 1e-6;
        const storica = -Math.atan2(dy, horiz);     // trackPitchAt di f1.js
        assert.equal(-TrackGeometry.pendenzaAt(anello, i, true), storica);
    }
});

// --- rollioEfficaceAt: il rollio che si vede e' quello che si sente ---------
//
// Un tratto quasi dritto puo' avere una sopraelevazione dichiarata (l'editor
// avverte solo sui tratti tipizzati 'retta', non su una curva dolcissima). La
// mesh li' non inclina niente, perche' non c'e' un bordo esterno. Se la fisica
// leggesse comunque il valore dichiarato, l'auto terrebbe di piu' in un punto
// dove la pista si vede piatta: aderenza invisibile, la cosa peggiore da
// spiegare a chi gioca.

function anelloConRollio(raggio, n, rollio) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * raggio, z: Math.sin(a) * raggio, y: 0, rollio });
    }
    return pts;
}

test('rollioEfficaceAt: in curva vale il rollio dichiarato', () => {
    const rollio = 18 * Math.PI / 180;
    const pts = anelloConRollio(200, 60, rollio);
    assert.equal(TrackGeometry.rollioEfficaceAt(pts, 10), rollio);
});

test('rollioEfficaceAt: su un tratto dritto vale zero, per quanto sia dichiarato', () => {
    // ⚠️ La pista dev'essere un ANELLO CHIUSO, come lo sono tutte in gioco:
    // curvatureAt guarda un campione prima e uno dopo con l'indice che gira
    // (`% n`), e su una polilinea aperta il campione «prima» del decimo e' in
    // fondo alla retta — l'angolo risulta di 180° e un rettilineo sembra un
    // tornante. Costato un test rosso che accusava il codice giusto.
    const ovale = [];
    const RETT = 400, R = 100;
    for (let i = 0; i < 200; i++) {
        const t = i / 200;
        let x, z;
        if (t < 0.25) { x = R; z = -RETT / 2 + RETT * (t / 0.25); }
        else if (t < 0.5) { const a = (t - 0.25) / 0.25 * Math.PI; x = R * Math.cos(a); z = RETT / 2 + R * Math.sin(a); }
        else if (t < 0.75) { x = -R; z = RETT / 2 - RETT * ((t - 0.5) / 0.25); }
        else { const a = (t - 0.75) / 0.25 * Math.PI; x = -R * Math.cos(a); z = -RETT / 2 - R * Math.sin(a); }
        ovale.push({ x, z, y: 0, rollio: 0.3 });
    }
    const suRettilineo = 25;    // meta' del primo rettilineo
    assert.ok(TrackGeometry.curvatureAt(ovale, suRettilineo).radius > 1000,
        "il campione scelto non sta su un rettilineo");
    assert.equal(TrackGeometry.rollioEfficaceAt(ovale, suRettilineo), 0);
    // ...e in curva invece vale, sulla stessa pista.
    assert.equal(TrackGeometry.rollioEfficaceAt(ovale, 75), 0.3);
});

test('rollioEfficaceAt: e\' la stessa condizione con cui si alza il bordo', () => {
    // Il legame che conta: dove il bordo non si alza, il rollio non ha effetto.
    // Se un giorno le due condizioni divergessero, l'auto guadagnerebbe
    // aderenza su un pezzo di pista disegnato piatto.
    const rollio = 25 * Math.PI / 180;
    for (const raggio of [60, 90, 150, 300, 380, 420, 800, 5000]) {
        const pts = anelloConRollio(raggio, 200, rollio);
        const efficace = TrackGeometry.rollioEfficaceAt(pts, 20);
        const { latoAlto } = TrackGeometry.rialzoBordi(pts, 20, 11);
        assert.equal(efficace > 0, latoAlto !== 0,
            `raggio ${raggio}: efficace ${efficace}, latoAlto ${latoAlto}`);
    }
});

// --- il cuneo sotto la sopraelevata e' un cuneo, non una collina -----------
//
// ⚠️ VISTO IN GIOCO il 2026-08-25: accanto alla curva a 35 gradi era cresciuta
// una montagna verde piu' alta della pista, e l'asfalto ci spariva dentro.
// Il terreno continuava a salire con la pendenza del nastro fino al PIANORO del
// terrapieno (49 unita' dall'asse), arrivando a 37 di quota dove il bordo alto
// dell'asfalto ne aveva 13.7. Il cuneo deve fermarsi dove finisce il nastro.

function cerchioSopraelevato(raggio, n, gradi) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * raggio, z: Math.sin(a) * raggio, y: 0,
                   rollio: gradi * Math.PI / 180, halfWidth: 12 });
    }
    return pts;
}

test('il terreno accanto a una sopraelevata non sale sopra il bordo del nastro', () => {
    const R = 200, MEZZA = 12, GRADI = 35;
    const pts = cerchioSopraelevato(R, 200, GRADI);
    const PLATEAU = 49, OUTER = 94;
    const { dyAlto, latoAlto } = TrackGeometry.rialzoBordi(pts, 10, MEZZA);
    const { nx, nz } = TrackGeometry.normalAt(pts, 10, true);
    const p = pts[10];
    // Il tetto: la quota del bordo alto (dyAlto), piu' il poco che il cordolo
    // prosegue oltre il bordo con la stessa pendenza — dyAlto/(2*mezza) per
    // unita'.
    const tetto = dyAlto * (1 + TrackGeometry.CUNEO_OLTRE_IL_BORDO / (2 * MEZZA)) + 1e-9;
    for (const dist of [MEZZA, 15, 20, 30, 40, 48, 49]) {
        const x = p.x + nx * latoAlto * dist, z = p.z + nz * latoAlto * dist;
        const y = TrackGeometry.terrainHeightAt(pts, x, z, PLATEAU, OUTER);
        assert.ok(y <= tetto,
            `a ${dist} unita' dall'asse il terreno sta a ${y.toFixed(2)}, sopra il tetto di ${tetto.toFixed(2)}`);
    }
});

test('il terreno sotto il bordo alto lo regge davvero: nessuna fessura', () => {
    // L'altra meta' della stessa regola: fermare il cuneo non deve farlo
    // sprofondare sotto l'asfalto, o fra nastro e terra resta un buco aperto.
    const R = 200, MEZZA = 12, GRADI = 35;
    const pts = cerchioSopraelevato(R, 200, GRADI);
    const { dyAlto, latoAlto } = TrackGeometry.rialzoBordi(pts, 10, MEZZA);
    const { nx, nz } = TrackGeometry.normalAt(pts, 10, true);
    const p = pts[10];
    const x = p.x + nx * latoAlto * MEZZA, z = p.z + nz * latoAlto * MEZZA;
    const y = TrackGeometry.terrainHeightAt(pts, x, z, 49, 94);
    assert.ok(Math.abs(y - dyAlto) < 1e-6,
        `sotto il bordo alto (${dyAlto.toFixed(2)}) il terreno sta a ${y.toFixed(2)}`);
});

test('su una pista piana il terreno non cambia di un millimetro', () => {
    const pts = cerchioSopraelevato(200, 200, 0);
    for (const p of pts) p.y = 7;      // pista in quota, ma piana
    const { nx, nz } = TrackGeometry.normalAt(pts, 10, true);
    for (const dist of [12, 20, 40, 49]) {
        const x = pts[10].x + nx * dist, z = pts[10].z + nz * dist;
        assert.equal(TrackGeometry.terrainHeightAt(pts, x, z, 49, 94), 7);
    }
});
