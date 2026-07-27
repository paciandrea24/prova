// backend/sockets/games/physics/AerodynamicsModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { GRIP, effectiveGrip, applyGripBlend } = require('./AerodynamicsModel');

test('GRIP: valore storico invariato', () => {
    assert.equal(GRIP, 0.78);
});

test('effectiveGrip: gomma fresca, nessun danno -> GRIP pieno per la mescola medium', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    assert.ok(Math.abs(effectiveGrip(p, false) - 0.741) < 1e-9);
});

test('effectiveGrip: fondo danneggiato 50% -> aderenza ridotta', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 50, engine: 0, suspension: 0 } };
    assert.ok(Math.abs(effectiveGrip(p, false) - 0.611325) < 1e-9);
});

test('applyGripBlend: vx/vz convergono verso la direzione del muso pesati da grip', () => {
    const p = { angle: 0, speed: 3, vx: 1, vz: 1 };
    applyGripBlend(p, 0.741);
    assert.ok(Math.abs(p.vx - 0.741) < 1e-9);
    assert.ok(Math.abs(p.vz - 1.518) < 1e-9);
});
