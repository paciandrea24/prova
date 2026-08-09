const test = require('node:test');
const assert = require('node:assert/strict');
const SceneryHills = require('./sceneryHills.js');

const EMBANK_OUTER = 60;

test('dentro il terrapieno il terreno resta piatto', () => {
    // Se le colline partissero prima, spingerebbero in alto il prato dove si
    // corre davvero e taglierebbero la pista.
    assert.equal(SceneryHills.hillHeightAt(0, 0, 10, EMBANK_OUTER), 0);
    assert.equal(SceneryHills.hillHeightAt(0, 0, EMBANK_OUTER, EMBANK_OUTER), 0);
    assert.equal(SceneryHills.hillHeightAt(0, 0, EMBANK_OUTER + SceneryHills.HILL_START_MARGIN, EMBANK_OUTER), 0);
});

test('la quota cresce allontanandosi dal tracciato', () => {
    const start = EMBANK_OUTER + SceneryHills.HILL_START_MARGIN;
    const near = SceneryHills.hillHeightAt(500, 500, start + 40, EMBANK_OUTER);
    const far = SceneryHills.hillHeightAt(500, 500, start + SceneryHills.HILL_RAMP, EMBANK_OUTER);
    assert.ok(far > near, `lontano ${far.toFixed(1)} non supera vicino ${near.toFixed(1)}`);
});

test('la quota non supera mai il massimo dichiarato', () => {
    for (let i = 0; i < 500; i++) {
        const h = SceneryHills.hillHeightAt(i * 37, i * -53, EMBANK_OUTER + 400, EMBANK_OUTER);
        assert.ok(h <= SceneryHills.HILL_MAX_HEIGHT, `quota ${h} oltre il massimo`);
        assert.ok(h >= 0, `quota negativa ${h}`);
    }
});

// Deterministico: la stessa pista deve dare le stesse colline ad ogni
// caricamento, altrimenti mesh del terreno e alberi (generati da due moduli
// diversi) finirebbero su rilievi diversi.
test('hillHeightAt è deterministica', () => {
    const a = SceneryHills.hillHeightAt(123.5, -876.25, 300, EMBANK_OUTER);
    const b = SceneryHills.hillHeightAt(123.5, -876.25, 300, EMBANK_OUTER);
    assert.equal(a, b);
});

// Il rilievo deve variare da un punto all'altro: una rampa liscia si legge
// come una ciotola, non come colline.
test('la quota varia fra punti diversi alla stessa distanza', () => {
    const d = EMBANK_OUTER + SceneryHills.HILL_START_MARGIN + 150;
    const values = [];
    for (let i = 0; i < 40; i++) values.push(SceneryHills.hillHeightAt(i * 80, i * 45, d, EMBANK_OUTER));
    const min = Math.min(...values), max = Math.max(...values);
    assert.ok(max - min > 5, `variazione di sole ${(max - min).toFixed(1)} unità: rilievo troppo uniforme`);
});

// Il terreno deve essere continuo: due punti vicini non possono avere quote
// molto diverse, o le colline si spezzano in scalini verticali giganti.
test('la quota è continua fra punti vicini', () => {
    const d = EMBANK_OUTER + SceneryHills.HILL_START_MARGIN + 200;
    for (let i = 0; i < 200; i++) {
        const x = i * 13.7, z = i * -9.1;
        const a = SceneryHills.hillHeightAt(x, z, d, EMBANK_OUTER);
        const b = SceneryHills.hillHeightAt(x + 20, z, d, EMBANK_OUTER);
        assert.ok(Math.abs(a - b) < SceneryHills.HILL_MAX_HEIGHT * 0.5,
            `salto di ${Math.abs(a - b).toFixed(1)} unità in 20 di distanza`);
    }
});
