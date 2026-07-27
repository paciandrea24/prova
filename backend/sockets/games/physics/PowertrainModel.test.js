// backend/sockets/games/physics/PowertrainModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_SPEED, ACCEL, FRICTION, effectiveMaxSpeed, effectiveAccel, applyThrottle, applyCoast } = require('./PowertrainModel');

test('costanti storiche invariate', () => {
    assert.equal(MAX_SPEED, 6.2);
    assert.equal(ACCEL, 0.186);
    assert.equal(FRICTION, 0.120);
});

test('effectiveMaxSpeed/effectiveAccel: gomma fresca, nessun danno -> valori pieni', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    assert.equal(effectiveMaxSpeed(p, false), 6.2);
    assert.equal(effectiveAccel(p, false), 0.186);
});

test('effectiveMaxSpeed/effectiveAccel: gomma usurata 80% + motore danneggiato 40% -> penalità combinate', () => {
    const p = { compound: 'medium', tyreWear: 80, damageParts: { frontWing: 0, floor: 0, engine: 40, suspension: 0 } };
    assert.ok(Math.abs(effectiveMaxSpeed(p, false) - 4.85925) < 1e-9);
    assert.ok(Math.abs(effectiveAccel(p, false) - 0.149358) < 1e-9);
});

test('applyThrottle: da fermo, gomma fresca -> speed = ACCEL esatto', () => {
    const p = { speed: 0, inputs: { throttle: 1 }, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    applyThrottle(p, false, 6.2);
    assert.equal(p.speed, 0.186);
});

test('applyThrottle: clampa al tetto di velocità', () => {
    const p = { speed: 6.15, inputs: { throttle: 1 }, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    applyThrottle(p, false, 6.2);
    assert.equal(p.speed, 6.2);
});

test('applyCoast: decelera verso zero senza mai superarlo, avanti e in retromarcia', () => {
    const p1 = { speed: 2 };
    applyCoast(p1);
    assert.equal(p1.speed, 1.88);
    const p2 = { speed: -2 };
    applyCoast(p2);
    assert.equal(p2.speed, -1.88);
    const p3 = { speed: 0.05 };
    applyCoast(p3);
    assert.equal(p3.speed, 0);
});
