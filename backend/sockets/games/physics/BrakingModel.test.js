// backend/sockets/games/physics/BrakingModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { BRAKE_MULT, effectiveBrakeMult, applyBrake } = require('./BrakingModel');

test('BRAKE_MULT: valore storico invariato', () => {
    assert.equal(BRAKE_MULT, 2.17);
});

test('effectiveBrakeMult: gomma fresca -> BRAKE_MULT pieno', () => {
    const p = { compound: 'medium', tyreWear: 0 };
    assert.equal(effectiveBrakeMult(p, false), 2.17);
});

test('effectiveBrakeMult: gomma usurata 80% -> penalità frenata applicata', () => {
    const p = { compound: 'medium', tyreWear: 80 };
    assert.ok(Math.abs(effectiveBrakeMult(p, false) - 1.8851874999999998) < 1e-9);
});

test("effectiveBrakeMult: in qualifica ignora sempre l'usura", () => {
    const p = { compound: 'medium', tyreWear: 80 };
    assert.equal(effectiveBrakeMult(p, true), 2.17);
});

test('applyBrake: frenata piena da velocità 4, gomma fresca -> decelerazione + smorzamento laterale', () => {
    const p = { speed: 4, vx: 1, vz: 1, inputs: { brake: 1 }, compound: 'medium', tyreWear: 0 };
    applyBrake(p, false, 6.2, 0.186);
    assert.ok(Math.abs(p.speed - 3.59638) < 1e-9);
    assert.ok(Math.abs(p.vx - 0.94) < 1e-12);
    assert.ok(Math.abs(p.vz - 0.94) < 1e-12);
});

test('applyBrake: non scende mai sotto -maxSpeed/2 (tetto retromarcia)', () => {
    const p = { speed: -3, vx: 0, vz: 0, inputs: { brake: 1 }, compound: 'medium', tyreWear: 0 };
    applyBrake(p, false, 6.2, 0.186);
    assert.equal(p.speed, -3.1);
});
