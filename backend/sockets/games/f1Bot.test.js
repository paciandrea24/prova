// backend/sockets/games/f1Bot.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    PALETTE, normalizeAngle, steerToward, lookaheadIndex,
    curvatureSpeedFraction, pickPostPitCompound, pickBotColors, estimateFinishTime
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

test('curvatureSpeedFraction: rettilineo => frazione vicina a 1', () => {
    const straight = [];
    for (let i = 0; i < 30; i++) straight.push({ x: 0, z: i });
    const frac = curvatureSpeedFraction(straight, 5, 15, 4);
    assert.ok(frac > 0.98, `atteso ~1, ottenuto ${frac}`);
});

test('curvatureSpeedFraction: tornante stretto scoperto dalla scansione lunga anche se non subito => frazione al minimo (0.18)', () => {
    const bent = [];
    for (let i = 0; i < 30; i++) bent.push({ x: 0, z: i });           // rettilineo lungo +z, idx 0..29
    for (let i = 0; i < 30; i++) bent.push({ x: i, z: 29 });          // tornante di 90° a idx~30, poi lungo +x
    // idx=5, scansiona 40 campioni avanti (fino a idx=45, ben oltre il
    // tornante): la finestra locale corta (4) lo trova comunque.
    const frac = curvatureSpeedFraction(bent, 5, 40, 4);
    assert.ok(Math.abs(frac - 0.18) < 0.01, `atteso ~0.18, ottenuto ${frac}`);
});

test('curvatureSpeedFraction: stesso angolo totale (90°) ma su una curva DOLCE (raggio ampio) => non scende al minimo', () => {
    // Bug reale (playtest): confrontare solo inizio/fine di una scansione
    // lunga confondeva "curva dolce spalmata su tanta distanza" con
    // "tornante stretto" — qui l'angolo totale è lo stesso 90° del test
    // sopra, ma spalmato su un raggio di 500 unità: misurata con finestre
    // LOCALI corte deve restare dolce ovunque, non toccare il minimo.
    const n = 200;
    const wide = [];
    for (let i = 0; i <= n; i++) {
        const a = (Math.PI / 2) * (i / n);
        wide.push({ x: Math.sin(a) * 500, z: Math.cos(a) * 500 });
    }
    const frac = curvatureSpeedFraction(wide, 5, 50, 4);
    assert.ok(frac > 0.9, `atteso vicino a 1 (curva dolce vista localmente), ottenuto ${frac}`);
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
