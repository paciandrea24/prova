// backend/sockets/games/physics/SteeringModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { applySteering, TURN_SPEED_LOW, TURN_SPEED_HIGH } = require('./SteeringModel');

test('TURN_SPEED_LOW/HIGH: valori storici invariati', () => {
    assert.equal(TURN_SPEED_LOW, 0.075);
    assert.equal(TURN_SPEED_HIGH, 0.052);
});

test('applySteering: auto sana, sterzo pieno, angle aumenta della turnRate esatta', () => {
    const p = { speed: 3, vx: 0, vz: 0, angle: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 }, inputs: { steer: 1 } };
    applySteering(p, false, 6.2);
    assert.ok(Math.abs(p.angle - 0.06387096774193549) < 1e-12);
});

test('applySteering: ala anteriore danneggiata riduce la turnRate (sottosterzo)', () => {
    const p = { speed: 3, vx: 0, vz: 0, angle: 0, damageParts: { frontWing: 60, floor: 0, engine: 0, suspension: 0 }, inputs: { steer: 1 } };
    applySteering(p, false, 6.2);
    assert.ok(Math.abs(p.angle - 0.04854193548387097) < 1e-12);
});

test('applySteering: in qualifica il danno viene ignorato (steerFactor sempre 1)', () => {
    const p = { speed: 3, vx: 0, vz: 0, angle: 0, damageParts: { frontWing: 100, floor: 0, engine: 0, suspension: 0 }, inputs: { steer: -1 } };
    applySteering(p, true, 6.2);
    assert.ok(Math.abs(p.angle - (-0.06387096774193549)) < 1e-12);
});

test('applySteering: sotto la soglia di velocità/moto minima, nessun effetto', () => {
    const p = { speed: 0, vx: 0, vz: 0, angle: 1.23, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 }, inputs: { steer: 1 } };
    applySteering(p, false, 6.2);
    assert.equal(p.angle, 1.23);
});
