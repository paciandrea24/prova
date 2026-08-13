// frontend/shared/sceneryLandmarks.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const TrackGeometry = require('./trackGeometry.js');
const SceneryLandmarks = require('./sceneryLandmarks.js');
const monteRosso = require('../tracks/monte-rosso.json');

const ROAD_HALF = monteRosso.roadHalfWidth;
const BARRIER_D = ROAD_HALF + 2.8 + 1.2; // stessa formula di frontend/f1.js (CURB_W=2.8)

function build() {
    const trackPts = TrackGeometry.sampleLoop(monteRosso.controlPoints, 1000);
    const pitPts = TrackGeometry.sampleOpenPath(monteRosso.pit.path, 300);
    // embankStart e embankOuter sono due parametri distinti: il pianoro del
    // terrapieno non finisce più alla barriera fissa (vedi generateLayout).
    return SceneryLandmarks.buildLandmarks(trackPts, pitPts, BARRIER_D, 1,
        BARRIER_D, BARRIER_D + 45, [], () => false);
}

// Il vincolo vero non è "scavalcare la pista" ma "scavalcare la BARRIERA":
// dimensionando sulla sola larghezza pista i piloni finiscono dentro le
// barriere su tutti i tracciati esistenti.
test('il ponte semafori scavalca la barriera, non solo la pista', () => {
    const gantry = build().find(i => i.asset === 'startGantry');
    assert.ok(gantry, 'nessun startGantry nel layout');
    const halfSpan = SceneryLandmarks.GANTRY_NATIVE_HALF_SPAN * gantry.scale;
    assert.ok(halfSpan > BARRIER_D, `luce ${halfSpan.toFixed(1)} contro barriera a ${BARRIER_D}`);
});

test('la passerella scavalca la barriera', () => {
    const fb = build().find(i => i.asset === 'footbridge');
    assert.ok(fb, 'nessuna footbridge nel layout');
    const halfSpan = SceneryLandmarks.FOOTBRIDGE_NATIVE_HALF_SPAN * fb.scale;
    assert.ok(halfSpan > BARRIER_D, `luce ${halfSpan.toFixed(1)} contro barriera a ${BARRIER_D}`);
});

test('ponte semafori e passerella non sono nello stesso punto del giro', () => {
    const items = build();
    const g = items.find(i => i.asset === 'startGantry');
    const f = items.find(i => i.asset === 'footbridge');
    assert.ok(Math.hypot(g.x - f.x, g.z - f.z) > 100, 'gantry e passerella troppo vicini');
});

test('si genera esattamente un esemplare di ogni landmark', () => {
    const items = build();
    for (const asset of ['raceControlTower', 'startGantry', 'podium', 'footbridge']) {
        assert.equal(items.filter(i => i.asset === asset).length, 1, `${asset} non unico`);
    }
});

test('i landmark laterali stanno fuori dal corridoio pista', () => {
    const trackPts = TrackGeometry.sampleLoop(monteRosso.controlPoints, 1000);
    for (const item of build()) {
        // Gantry e passerella sono a cavallo della pista per definizione.
        if (item.asset === 'startGantry' || item.asset === 'footbridge') continue;
        const d = TrackGeometry.nearestPoint(trackPts, item.x, item.z).dist;
        assert.ok(d >= BARRIER_D, `${item.asset} a ${d.toFixed(1)} dal centro pista`);
    }
});

test('buildLandmarks è deterministico (nessun PRNG)', () => {
    assert.equal(JSON.stringify(build()), JSON.stringify(build()));
});

