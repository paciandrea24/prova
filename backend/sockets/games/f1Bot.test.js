// backend/sockets/games/f1Bot.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    PALETTE, normalizeAngle, steerToward, lookaheadIndex,
    curvatureSpeedFraction, pickPostPitCompound, pickBotColors
} = require('./f1Bot.js');

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
    // dx=1, dz=10 => desired = atan2(1,10) ~= 0.0997 rad, gain=1.6
    const steer = steerToward(0, 0, 0, 1, 10);
    const expected = Math.atan2(1, 10) * 1.6;
    assert.ok(Math.abs(steer - expected) < 1e-6);
});

test('lookaheadIndex avanza con wrap sul loop', () => {
    assert.equal(lookaheadIndex(1000, 995, 10), 5);
    assert.equal(lookaheadIndex(1000, 10, 5), 15);
    assert.equal(lookaheadIndex(1000, 0, 0), 0);
});

test('curvatureSpeedFraction: rettilineo => frazione vicina a 1', () => {
    const straight = [];
    for (let i = 0; i < 20; i++) straight.push({ x: 0, z: i });
    const frac = curvatureSpeedFraction(straight, 5, 5);
    assert.ok(frac > 0.98, `atteso ~1, ottenuto ${frac}`);
});

test('curvatureSpeedFraction: curva a 90° oltre MAX_CURVATURE_ANGLE => frazione al minimo (0.35)', () => {
    const bent = [];
    for (let i = 0; i < 10; i++) bent.push({ x: 0, z: i });           // rettilineo lungo +z
    for (let i = 0; i < 10; i++) bent.push({ x: i, z: 9 });           // poi piega lungo +x
    const frac = curvatureSpeedFraction(bent, 8, 6);   // idx=8 (dritto), +6 => idx=14 (piegato)
    assert.ok(Math.abs(frac - 0.35) < 0.01, `atteso ~0.35, ottenuto ${frac}`);
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
