// frontend/shared/pitBoxLoader.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const PitBoxLoader = require('./pitBoxLoader.js');

test('PitBoxLoader espone loadPitBoxModel e recolorPitBoxTexture come funzioni', () => {
    assert.equal(typeof PitBoxLoader.loadPitBoxModel, 'function');
    assert.equal(typeof PitBoxLoader.recolorPitBoxTexture, 'function');
});

test('isRedTexel riconosce SOLO il rosso tetto/righe, misurato sulla palette reale del box', () => {
    assert.equal(PitBoxLoader.isRedTexel(221, 53, 53), true, 'rosso tetto/righe');
    assert.equal(PitBoxLoader.isRedTexel(238, 238, 238), false, 'pareti bianche');
    assert.equal(PitBoxLoader.isRedTexel(64, 64, 64), false, 'base scura');
    assert.equal(PitBoxLoader.isRedTexel(85, 85, 85), false, 'grigio ombra');
    assert.equal(PitBoxLoader.isRedTexel(119, 119, 119), false, 'grigio ombra');
    assert.equal(PitBoxLoader.isRedTexel(136, 136, 136), false, 'grigio intermedio');
    assert.equal(PitBoxLoader.isRedTexel(255, 204, 51), false, 'insegna gialla');
});

test('isRedTexel riconosce anche varianti del rosso vicine alla soglia (h e s poco diversi dal misurato)', () => {
    assert.equal(PitBoxLoader.isRedTexel(200, 60, 60), true);
    assert.equal(PitBoxLoader.isRedTexel(200, 150, 150), false, 'saturazione troppo bassa, non deve ricolorare');
});
