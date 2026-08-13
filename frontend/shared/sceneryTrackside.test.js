// frontend/shared/sceneryTrackside.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const TrackGeometry = require('./trackGeometry.js');
const SceneryTrackside = require('./sceneryTrackside.js');
const monteRosso = require('../tracks/monte-rosso.json');

const BARRIER_D = monteRosso.roadHalfWidth + 2.8 + 1.2;

function ctx(overrides) {
    const trackPts = TrackGeometry.sampleLoop(monteRosso.controlPoints, 1000);
    const pitPts = TrackGeometry.sampleOpenPath(monteRosso.pit.path, 300);
    let a = 12345;
    const rng = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    return Object.assign({
        trackPts, pitPts, barrierDist: BARRIER_D, embankOuter: BARRIER_D + 45,
        pitRoadHalf: monteRosso.pit.roadHalfWidth,
        mainSide: 1, rng, playerBoxFootprints: [],
        insidePlayerBoxFootprint: () => false, grandstands: [],
    }, overrides);
}

test('findCorners trova curve separate e non tutto il tracciato', () => {
    const c = ctx();
    const corners = SceneryTrackside.findCorners(c.trackPts);
    assert.ok(corners.length >= 2, `trovate solo ${corners.length} curve`);
    assert.ok(corners.length < 20, `${corners.length} curve: soglia troppo permissiva`);
    for (const k of corners) {
        assert.ok(k.side === 1 || k.side === -1, 'lato esterno non determinato');
        assert.ok(k.radius < SceneryTrackside.CORNER_RADIUS_MAX, 'curva sopra soglia');
    }
});

test('le barriere di pneumatici stanno fuori dalla barriera e mai in corsia box', () => {
    const c = ctx();
    const items = SceneryTrackside.buildTrackside(c);
    const tyres = items.filter(i => i.asset === 'tyreStack');
    assert.ok(tyres.length > 0, 'nessuna barriera di gomme generata');
    for (const t of tyres) {
        const dTrack = TrackGeometry.nearestPoint(c.trackPts, t.x, t.z).dist;
        assert.ok(dTrack >= BARRIER_D, `gomme a ${dTrack.toFixed(1)} dal centro pista`);
        const dPit = TrackGeometry.nearestPoint(c.pitPts, t.x, t.z).dist;
        assert.ok(dPit > monteRosso.pit.roadHalfWidth, 'gomme dentro la corsia box');
    }
});

test('ogni curva riceve al massimo due cartelli di frenata', () => {
    const c = ctx();
    const corners = SceneryTrackside.findCorners(c.trackPts);
    const boards = SceneryTrackside.buildTrackside(c).filter(i => i.asset === 'brakingBoard');
    assert.ok(boards.length <= corners.length * 2, `${boards.length} cartelli per ${corners.length} curve`);
    assert.ok(boards.length > 0, 'nessun cartello generato');
});

test('i commissari sono al massimo uno per curva', () => {
    const c = ctx();
    const corners = SceneryTrackside.findCorners(c.trackPts);
    const posts = SceneryTrackside.buildTrackside(c).filter(i => i.asset === 'marshalPost');
    assert.ok(posts.length <= corners.length, `${posts.length} commissari per ${corners.length} curve`);
});

test('buildTrackside è deterministico a parità di seed', () => {
    const a = JSON.stringify(SceneryTrackside.buildTrackside(ctx()));
    const b = JSON.stringify(SceneryTrackside.buildTrackside(ctx()));
    assert.equal(a, b);
});

test('tutte le voci hanno scala 1, una categoria e coordinate finite', () => {
    for (const item of SceneryTrackside.buildTrackside(ctx())) {
        assert.equal(item.scale, 1);
        assert.ok(typeof item.category === 'string' && item.category.length > 0);
        assert.ok(Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.z),
            `coordinate non finite per ${item.asset}`);
        assert.ok(Number.isFinite(item.rotY), `rotY non finita per ${item.asset}`);
    }
});

// Il footprint dei box giocatore è la zona dove stanno i modelli veri dei
// box: se un oggetto scenico ci finisce dentro, lo compenetra.
test('niente viene piazzato dentro l\'ingombro dei box giocatore', () => {
    const fake = [[{ x: 0, z: 0 }]];
    let asked = 0;
    const items = SceneryTrackside.buildTrackside(ctx({
        playerBoxFootprints: fake,
        insidePlayerBoxFootprint: () => { asked++; return true; },
    }));
    assert.ok(asked > 0, 'il filtro sui box giocatore non è stato interrogato');
    // Con il filtro che rifiuta tutto, restano solo le voci che per
    // costruzione non possono cadere sui box.
    assert.ok(items.length < 10, `${items.length} voci nonostante il filtro rifiuti tutto`);
});

// Il decoro del paddock va solo dove c'è davvero spazio fra pista e corsia
// box. Una versione precedente provava collocazioni di ripiego per piazzarne
// di più, ma finivano DIETRO le tribune, dove l'utente non li vuole
// (playtest 2026-08-09): meglio pochi elementi al posto giusto che molti
// sparsi dove capita.
test('il decoro del paddock finisce solo dove c\'è spazio, senza ripieghi', () => {
    const c = ctx();
    const decor = SceneryTrackside.buildTrackside(c).filter(i => i.category === 'paddock-decor');
    for (const d of decor) {
        const dPit = TrackGeometry.nearestPoint(c.pitPts, d.x, d.z).dist;
        assert.ok(dPit >= c.pitRoadHalf + 8, `decoro dentro la corsia box: ${dPit.toFixed(1)}`);
    }
});

// --- Decoro del paddock ----------------------------------------------------
// NOTA: il test che verifica che pylon/flagPole/paddockTent compaiano davvero
// NON sta qui ma in trackScenery.test.js, sul layout completo. Motivo: qui
// ctx() passa playerBoxFootprints vuoto, e con quello il decoro trova posto
// sempre — un test verde che non dimostrava nulla, mentre nel gioco vero gli
// ingombri dei box giocatore coprono tutte le collocazioni candidate e gli
// asset sparivano lo stesso.

test('catchFence: guarda il muro, ma resta dove sta', () => {
    // Rettilineo con il muro che si allontana: il nastro è inclinato di 45°
    // rispetto alla pista, quindi la rete deve ruotare di 45° — ma la sua
    // POSIZIONE non deve muoversi di un millimetro, perché la distanza dei
    // moduli è quella che li tiene attaccati alla tribuna che proteggono.
    const trackPts = [];
    for (let i = 0; i < 200; i++) trackPts.push({ x: i * 5, z: 0, y: 0 });

    const dritto = SceneryTrackside.place(trackPts, trackPts, 50, 30, 1, 15, 15, 60);
    const inclinato = SceneryTrackside.place(trackPts, trackPts, 50, 30, 1, 15, 15, 60,
        (i) => 20 + i * 5);

    assert.ok(Math.abs(dritto.x - inclinato.x) < 1e-9 && Math.abs(dritto.z - inclinato.z) < 1e-9,
        `la rete si è spostata: (${dritto.x}, ${dritto.z}) -> (${inclinato.x}, ${inclinato.z})`);
    let delta = inclinato.rotY - dritto.rotY;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    assert.ok(Math.abs(Math.abs(delta) - Math.PI / 4) < 1e-6,
        `attesi 45° di rotazione, avuti ${(delta * 180 / Math.PI).toFixed(2)}°`);
});
