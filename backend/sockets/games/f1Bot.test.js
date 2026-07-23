// backend/sockets/games/f1Bot.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    PALETTE, normalizeAngle, steerToward, lookaheadIndex, apexOffset,
    cornerTargetSpeed, overtakeOffset, pickPostPitCompound, pickBotColors, estimateFinishTime
} = require('./f1Bot.js');

// Costruisce un tracciato sintetico con curvatura costante e controllata:
// dritto per `straightSamples` campioni, poi curva con `deltaAnglePerSample`
// radianti di svolta ad ogni campione successivo. Ogni campione dista
// esattamente 1 unità dal precedente (passo unitario), quindi
// metersPerSample=1 nei test che lo usano — nessuna ambiguità sul raggio
// reale della curva prodotta (raggio ≈ 1/deltaAnglePerSample).
function buildConstantCurveTrack(totalSamples, straightSamples, deltaAnglePerSample) {
    const pts = [];
    let x = 0, z = 0, heading = 0;
    for (let i = 0; i < totalSamples; i++) {
        pts.push({ x, z });
        const delta = i < straightSamples ? 0 : deltaAnglePerSample;
        heading += delta;
        x += Math.sin(heading);
        z += Math.cos(heading);
    }
    return pts;
}

test('normalizeAngle riporta angoli fuori range in [-π, π]', () => {
    assert.ok(Math.abs(normalizeAngle(Math.PI * 3) - Math.PI) < 1e-9);
    assert.ok(Math.abs(normalizeAngle(-Math.PI * 3) - (-Math.PI)) < 1e-9);
    assert.ok(Math.abs(normalizeAngle(0.5) - 0.5) < 1e-9);
});

test('steerToward: target esattamente davanti (angle=0, target su +z) => sterzo ~0', () => {
    const steer = steerToward(0, 0, 0, 0, 10);
    assert.ok(Math.abs(steer) < 1e-6);
});

test('steerToward: target molto a destra satura a +1', () => {
    const steer = steerToward(0, 0, 0, 10, 0);
    assert.equal(steer, 1);
});

test('steerToward: target molto a sinistra satura a -1', () => {
    const steer = steerToward(0, 0, 0, -10, 0);
    assert.equal(steer, -1);
});

test('steerToward: piccolo scarto angolare non satura, segue il guadagno proporzionale', () => {
    // dx=0.3, dz=10 => desired = atan2(0.3,10) ~= 0.03 rad, gain=3.0 => steer ~0.09 (non satura)
    const steer = steerToward(0, 0, 0, 0.3, 10);
    const expected = Math.atan2(0.3, 10) * 3.0;
    assert.ok(Math.abs(steer - expected) < 1e-6);
    assert.ok(Math.abs(steer) < 1, `atteso non saturo, ottenuto ${steer}`);
});

test('lookaheadIndex avanza con wrap sul loop', () => {
    assert.equal(lookaheadIndex(1000, 995, 10), 5);
    assert.equal(lookaheadIndex(1000, 10, 5), 15);
    assert.equal(lookaheadIndex(1000, 0, 0), 0);
});

test('apexOffset: rettilineo => nessun offset', () => {
    const points = buildConstantCurveTrack(40, 40, 0);   // niente curvatura da nessuna parte
    const offset = apexOffset(points, 20, 10, 3);
    assert.equal(offset.dx, 0);
    assert.equal(offset.dz, 0);
});

test('apexOffset: sposta il punto mirato verso il centro geometrico della curva (interno, mai esterno)', () => {
    // Verifica geometrica diretta (non solo il segno "a occhio"): una curva
    // che parte da (0,0) puntando +z e gira sempre a destra (delta>0) ha il
    // proprio centro di curvatura a (raggio, 0) — un taglio verso l'interno
    // deve avvicinare il punto mirato a QUEL centro, mai allontanarlo (che
    // sarebbe tagliare verso l'esterno, cioè uscire di pista).
    const delta = 0.05;                 // raggio ≈ 1/delta = 20
    const points = buildConstantCurveTrack(40, 0, delta);
    const idx = 20;
    const center = { x: 1 / delta, z: 0 };
    const before = points[idx];
    const distBefore = Math.hypot(before.x - center.x, before.z - center.z);
    const offset = apexOffset(points, idx, 10, 3);
    const after = { x: before.x + offset.dx, z: before.z + offset.dz };
    const distAfter = Math.hypot(after.x - center.x, after.z - center.z);
    assert.ok(
        distAfter < distBefore,
        `atteso spostamento verso il centro della curva: prima ${distBefore.toFixed(2)}, dopo ${distAfter.toFixed(2)}`
    );
});

test('apexOffset: rispetta il limite massimo (maxOffsetM) anche su una curva strettissima', () => {
    const delta = 0.3;   // tornante molto stretto
    const points = buildConstantCurveTrack(40, 0, delta);
    const offset = apexOffset(points, 20, 10, 3);
    const mag = Math.hypot(offset.dx, offset.dz);
    assert.ok(mag <= 3 + 1e-9, `atteso <= 3 (maxOffsetM), ottenuto ${mag}`);
});

// Su un rettilineo lungo +z (buildConstantCurveTrack senza curvatura), la
// normale è costante = (-1,0): utile per assertion esatte sul verso.
test('overtakeOffset: auto da superare esattamente al centro pista => usa la preferenza di lato (sideFallback)', () => {
    const track = buildConstantCurveTrack(30, 30, 0);
    const centerPt = track[15];
    const o1 = overtakeOffset(track, 15, centerPt.x, centerPt.z, 10, 0.55, 1);
    assert.ok(Math.abs(o1.dx - -5.5) < 1e-9 && Math.abs(o1.dz) < 1e-9, `atteso (-5.5,0), ottenuto (${o1.dx},${o1.dz})`);

    const o2 = overtakeOffset(track, 15, centerPt.x, centerPt.z, 10, 0.55, -1);
    assert.ok(Math.abs(o2.dx - 5.5) < 1e-9 && Math.abs(o2.dz) < 1e-9, `atteso (5.5,0), ottenuto (${o2.dx},${o2.dz})`);
});

test('overtakeOffset: auto da superare spostata su un lato => si passa dal lato OPPOSTO', () => {
    const track = buildConstantCurveTrack(30, 30, 0);
    const centerPt = track[15];

    // Auto da superare 3 unità verso -x rispetto al centro pista: il bot
    // deve passare verso +x (mai dallo stesso lato, sarebbe una collisione).
    const oLeft = overtakeOffset(track, 15, centerPt.x - 3, centerPt.z, 10, 0.55, 1);
    assert.ok(oLeft.dx > 0, `auto a -x, atteso bot verso +x, ottenuto dx=${oLeft.dx}`);

    // Auto da superare 3 unità verso +x: il bot deve passare verso -x.
    const oRight = overtakeOffset(track, 15, centerPt.x + 3, centerPt.z, 10, 0.55, 1);
    assert.ok(oRight.dx < 0, `auto a +x, atteso bot verso -x, ottenuto dx=${oRight.dx}`);
});

test('cornerTargetSpeed: rettilineo puro => resta alla velocità massima', () => {
    const track = buildConstantCurveTrack(60, 60, 0);   // niente curvatura da nessuna parte
    const target = cornerTargetSpeed(track, 5, 40, 4, 1, 6, 6, 1, 0.05, 1);
    assert.equal(target, 6);
});

test('cornerTargetSpeed: tornante lontano con margine sufficiente => non frena troppo presto', () => {
    // Curva di raggio ~20 che inizia 100m avanti: alla velocità/decelerazione
    // di questo test la distanza di frenata necessaria è ~17.5m — con 95m
    // di margine non c'è ancora motivo di rallentare.
    const track = buildConstantCurveTrack(160, 100, 1 / 20);
    const target = cornerTargetSpeed(track, 5, 140, 4, 1, 6, 6, 1, 0.05, 1);
    assert.equal(target, 6, `atteso 6 (nessuna frenata ancora necessaria), ottenuto ${target}`);
});

test('cornerTargetSpeed: stesso tornante ma vicino => scende sotto la velocità massima per frenare in tempo', () => {
    const track = buildConstantCurveTrack(60, 10, 1 / 20);   // stessa curva, ma a ~5m invece di ~95m
    const target = cornerTargetSpeed(track, 5, 40, 4, 1, 6, 6, 1, 0.05, 1);
    assert.ok(target < 6, `atteso <6 (deve già frenare), ottenuto ${target}`);
    assert.ok(target < 3, `atteso vicino alla velocità del tornante (~1), ottenuto ${target}`);
});

test('cornerTargetSpeed: già più lenti del necessario => la curva non è più vincolante (niente doppia frenata)', () => {
    const track = buildConstantCurveTrack(60, 10, 1 / 20);
    const target = cornerTargetSpeed(track, 5, 40, 4, 1, 0.5, 6, 1, 0.05, 1);
    assert.equal(target, 6, `atteso 6 (già più lenti del richiesto dalla curva), ottenuto ${target}`);
});

test('pickPostPitCompound: pochi giri restanti => soft', () => {
    assert.equal(pickPostPitCompound(1, 5), 'soft');
    assert.equal(pickPostPitCompound(2, 5), 'soft');
});

test('pickPostPitCompound: giri restanti nel range di una medium => medium', () => {
    assert.equal(pickPostPitCompound(3, 5), 'medium');
    assert.equal(pickPostPitCompound(5, 5), 'medium');
});

test('pickPostPitCompound: molti giri restanti => hard', () => {
    assert.equal(pickPostPitCompound(6, 5), 'hard');
    assert.equal(pickPostPitCompound(20, 5), 'hard');
});

test('pickBotColors: esclude i colori umani, ne restituisce esattamente `count` (rng deterministico)', () => {
    const humanColors = ['#E74C3C', '#3498DB'];
    const rng = () => 0;   // sceglie sempre il primo libero rimasto => ordine di PALETTE
    const picked = pickBotColors(humanColors, 3, rng);
    assert.deepEqual(picked, ['#2ECC71', '#F1C40F', '#9B59B6']);
    picked.forEach(c => assert.ok(!humanColors.includes(c)));
});

test('pickBotColors: clampa a colori liberi disponibili', () => {
    const humanColors = PALETTE.slice(0, 10);   // solo 2 colori liberi
    const picked = pickBotColors(humanColors, 5, () => 0);
    assert.equal(picked.length, 2);
});

test('pickBotColors: nessuna collisione di colore tra chiamate ripetute (mai duplicati nel risultato)', () => {
    const picked = pickBotColors([], 5, () => 0.999999);
    assert.equal(new Set(picked).size, picked.length);
});

test('estimateFinishTime: a metà strada raddoppia il tempo trascorso', () => {
    assert.equal(estimateFinishTime(60000, 0.5), 120000);
});

test('estimateFinishTime: progresso completo => stesso tempo trascorso', () => {
    assert.equal(estimateFinishTime(60000, 1), 60000);
});

test('estimateFinishTime: progresso quasi nullo => pavimento SIMULATED_MIN_PROGRESS (0.05)', () => {
    assert.equal(estimateFinishTime(60000, 0), Math.round(60000 / 0.05));
    assert.equal(estimateFinishTime(60000, 0.01), Math.round(60000 / 0.05));
});
