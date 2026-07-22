// frontend/shared/trackScenery.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const TrackGeometry = require('./trackGeometry.js');
const TrackScenery = require('./trackScenery.js');
const monteRosso = require('../tracks/monte-rosso.json');

const ROAD_HALF = monteRosso.roadHalfWidth;
const BARRIER_D = ROAD_HALF + 2.8 + 1.2; // stessa formula di frontend/f1.js (CURB_W=2.8)

function buildReal() {
    const trackPts = TrackGeometry.sampleLoop(monteRosso.controlPoints, 1000);
    const pitPts   = TrackGeometry.sampleOpenPath(monteRosso.pit.path, 300);
    return { trackPts, pitPts };
}

test('generateLayout è deterministico: stesso trackData → stesso layout', () => {
    const { trackPts, pitPts } = buildReal();
    const a = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const b = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    assert.deepEqual(a, b);
});

test('generateLayout produce layout diverso per un id tracciato diverso', () => {
    const { trackPts, pitPts } = buildReal();
    const a = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const other = { ...monteRosso, id: 'altro-tracciato' };
    const b = TrackScenery.generateLayout(other, trackPts, pitPts, BARRIER_D);
    assert.notDeepEqual(a, b);
});

test('ogni oggetto natura resta fuori dal corridoio pista e corsia box', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const pitRoadHalf = monteRosso.pit.roadHalfWidth;
    const nature = layout.filter(i => i.category === 'nature');
    assert.ok(nature.length > 0);
    for (const item of nature) {
        const dTrack = TrackGeometry.nearestPoint(trackPts, item.x, item.z).dist;
        const dPit   = TrackGeometry.nearestPoint(pitPts, item.x, item.z).dist;
        assert.ok(dTrack >= BARRIER_D + 4 - 1e-6, `oggetto natura troppo vicino alla pista: ${dTrack}`);
        assert.ok(dPit >= pitRoadHalf + 5 - 1e-6, `oggetto natura troppo vicino alla corsia box: ${dPit}`);
    }
});

test('gli oggetti natura rispettano la distanza minima reciproca', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const nature = layout.filter(i => i.category === 'nature');
    for (let i = 0; i < nature.length; i++) {
        for (let j = i + 1; j < nature.length; j++) {
            const d = Math.hypot(nature[i].x - nature[j].x, nature[i].z - nature[j].z);
            assert.ok(d >= 7 - 1e-6, `due oggetti natura troppo vicini: ${d}`);
        }
    }
});

test('le tribune sono tra 6 e 10, senza folla, con asset tra le 3 varianti a 1 piano', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const grandstands = layout.filter(i => i.category === 'grandstand');
    const crowd = layout.filter(i => i.category === 'crowd');
    assert.ok(grandstands.length >= 6 && grandstands.length <= 10, `numero tribune fuori range: ${grandstands.length}`);
    assert.equal(crowd.length, 0, 'non deve piu\' esserci folla');
    const validAssets = new Set(['grandStand', 'grandStandAwning', 'grandStandCovered']);
    for (const g of grandstands) {
        assert.ok(validAssets.has(g.asset), `asset tribuna non valido: ${g.asset}`);
    }
});

test('la natura usa solo alberi, mai rocce o cespugli', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const nature = layout.filter(i => i.category === 'nature');
    const validAssets = new Set(['treeLarge', 'treeSmall']);
    for (const n of nature) {
        assert.ok(validAssets.has(n.asset), `asset natura non valido (dovrebbe essere solo albero): ${n.asset}`);
    }
});

test('se presente, il laghetto rispetta la distanza minima dagli altri oggetti', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const pond = layout.find(i => i.category === 'pond');
    if (!pond) return; // non garantito per design, vedi spec
    for (const item of layout) {
        if (item === pond) continue;
        const d = Math.hypot(pond.x - item.x, pond.z - item.z);
        assert.ok(d >= 16 - 1e-6, `laghetto troppo vicino a un altro oggetto: ${d}`);
    }
});

test('hashString è deterministico e mulberry32 produce valori in [0,1)', () => {
    const h1 = TrackScenery.hashString('monte-rosso');
    const h2 = TrackScenery.hashString('monte-rosso');
    assert.equal(h1, h2);
    const rng = TrackScenery.mulberry32(h1);
    for (let i = 0; i < 100; i++) {
        const v = rng();
        assert.ok(v >= 0 && v < 1, `valore fuori range: ${v}`);
    }
});

test('il paddock usa cartelloni sponsor e box, mai pylon/bandiere/tenda', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const paddock = layout.filter(i => i.category === 'paddock');
    assert.ok(paddock.length > 0);
    const validAssets = new Set(['billboard', 'billboardLow', 'pitsGarageClosed', 'pitsOffice']);
    for (const p of paddock) {
        assert.ok(validAssets.has(p.asset), `asset paddock non valido: ${p.asset}`);
    }
});

test('la tribuna principale è unica, 12 moduli (6x2), vicino alla partenza', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const main = layout.filter(i => i.category === 'grandstand-main');
    assert.equal(main.length, 12, `attesi 12 moduli tribuna principale, trovati ${main.length}`);
    for (const m of main) {
        assert.equal(m.asset, 'grandStand');
        const d = TrackGeometry.nearestPoint(trackPts, m.x, m.z).dist;
        assert.ok(d >= BARRIER_D, `modulo tribuna principale dentro il corridoio pista: ${d}`);
    }
    // Due quote y distinte (2 livelli), stessa quota all'interno di ogni livello
    const levels = new Set(main.map(m => m.y.toFixed(3)));
    assert.equal(levels.size, 2, `attesi 2 livelli distinti di quota, trovati ${levels.size}`);
});

test('la tribuna principale non si sovrappone alle tribune normali', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const main = layout.filter(i => i.category === 'grandstand-main');
    const normal = layout.filter(i => i.category === 'grandstand');
    for (const m of main) {
        for (const g of normal) {
            const d = Math.hypot(m.x - g.x, m.z - g.z);
            assert.ok(d >= 10, `tribuna principale troppo vicina a una tribuna normale: ${d}`);
        }
    }
});

test('la tribuna principale non si sovrappone ai cartelloni sponsor del paddock', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const main = layout.filter(i => i.category === 'grandstand-main');
    const billboards = layout.filter(i => i.category === 'paddock' && (i.asset === 'billboard' || i.asset === 'billboardLow'));
    assert.ok(billboards.length > 0);
    for (const m of main) {
        for (const b of billboards) {
            const d = Math.hypot(m.x - b.x, m.z - b.z);
            assert.ok(d >= 6, `tribuna principale troppo vicina a un cartellone sponsor: ${d}`);
        }
    }
});

test('nessun cartellone sponsor del rettilineo di partenza finisce dentro la corsia box', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const pitRoadHalf = monteRosso.pit.roadHalfWidth;
    const billboards = layout.filter(i => i.category === 'paddock' && (i.asset === 'billboard' || i.asset === 'billboardLow'));
    assert.ok(billboards.length > 0);
    for (const b of billboards) {
        const dPit = TrackGeometry.nearestPoint(pitPts, b.x, b.z).dist;
        assert.ok(dPit >= pitRoadHalf + 4 - 1e-6, `cartellone troppo vicino alla corsia box: distanza ${dPit}, pitRoadHalf ${pitRoadHalf}`);
    }
});
