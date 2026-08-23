// backend/sockets/games/physics/SteeringModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { applySteering, TURN_SPEED_LOW, TURN_SPEED_HIGH } = require('./SteeringModel');
const { STEER_LOCKUP_PENALTY_MAX } = require('./TyreSlipModel');
const { FRONT_WING_STEER_PENALTY_MAX } = require('./DamageModel');

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

// ASSERZIONE CAPOVOLTA il 2026-08-23: prima diceva «in qualifica il danno
// viene ignorato, steerFactor sempre 1». Ora il danno vale sempre — in
// stagione al giro secco si arriva con la macchina che si ha. Rif.
// docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md.
//
// Il valore atteso è derivato dalla costante invece che scritto a mano: così
// una ritaratura di FRONT_WING_STEER_PENALTY_MAX non fa fallire questo test,
// che è qui per l'esenzione mancante, non per il numero.
test('applySteering: in qualifica il danno vale come in gara (steerFactor non è più 1)', () => {
    const p = { speed: 3, vx: 0, vz: 0, angle: 0, damageParts: { frontWing: 100, floor: 0, engine: 0, suspension: 0 }, inputs: { steer: -1 } };
    applySteering(p, true, 6.2);
    const senzaDanno = -0.06387096774193549;
    assert.ok(Math.abs(p.angle - senzaDanno * (1 - FRONT_WING_STEER_PENALTY_MAX)) < 1e-12,
        `atteso ${senzaDanno * (1 - FRONT_WING_STEER_PENALTY_MAX)}, ottenuto ${p.angle}`);
});

test('applySteering: sotto la soglia di velocità/moto minima, nessun effetto', () => {
    const p = { speed: 0, vx: 0, vz: 0, angle: 1.23, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 }, inputs: { steer: 1 } };
    applySteering(p, false, 6.2);
    assert.equal(p.angle, 1.23);
});

// ---- Fase 3.1: bloccaggio in frenata riduce la capacità di sterzo ----
// NON è sottosterzo/sovrasterzo da richiesta laterale eccessiva (sistema a
// parte, non implementato) — solo la conseguenza diretta di brakingExcess
// (già esistente, da TyreSlipModel/BrakingModel) sulla turnRate.

test("applySteering: F1_TYRE_SLIP_MODEL='0' -> comportamento identico a prima anche in frenata forte da alta velocità (baseline invariata)", () => {
    // Vedi la nota gemella in PowertrainModel.test.js: dal 2026-08-11 il
    // modello è ON di default, quindi lo spegnimento va dichiarato.
    process.env.F1_TYRE_SLIP_MODEL = '0';
    try {
        const p = { speed: 6.0, vx: 0, vz: 0, angle: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 }, inputs: { steer: 1, brake: 1 }, tyreWear: 0 };
        applySteering(p, false, 6.2);
        assert.ok(Math.abs(p.angle - 0.05274193548387097) < 1e-9);
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});

test("applySteering: F1_TYRE_SLIP_MODEL='1', bloccaggio (brake alto, velocità alta) -> capacità di sterzo ridotta rispetto al baseline", () => {
    process.env.F1_TYRE_SLIP_MODEL = '1';
    try {
        const p = { speed: 6.0, vx: 0, vz: 0, angle: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 }, inputs: { steer: 1, brake: 1 }, tyreWear: 0 };
        applySteering(p, false, 6.2);
        assert.ok(p.angle < 0.05274193548387097, `atteso angle ridotto rispetto al baseline (0.0527...), ottenuto ${p.angle}`);
        assert.ok(Math.abs(p.angle - 0.04760101456815817) < 1e-9, `atteso 0.04760101456815817, ottenuto ${p.angle}`);
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});

test("applySteering: F1_TYRE_SLIP_MODEL='1', senza frenata (brake=0) -> nessun bloccaggio, comportamento identico al baseline", () => {
    process.env.F1_TYRE_SLIP_MODEL = '1';
    try {
        const p = { speed: 6.0, vx: 0, vz: 0, angle: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 }, inputs: { steer: 1, brake: 0 }, tyreWear: 0 };
        applySteering(p, false, 6.2);
        assert.ok(Math.abs(p.angle - 0.05274193548387097) < 1e-9, `atteso identico al baseline senza frenata: ottenuto ${p.angle}`);
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});

test("applySteering: F1_TYRE_SLIP_MODEL='1' -> la penalità è limitata, non annulla mai lo sterzo (anche al massimo eccesso teorico resta almeno 1-STEER_LOCKUP_PENALTY_MAX della turnRate base)", () => {
    process.env.F1_TYRE_SLIP_MODEL = '1';
    try {
        // Condizione estrema: frenata piena, velocità massima, gomma molto usurata (brakingFactor minimo storico ~0.65) -> eccesso vicino al suo massimo.
        const p = { speed: 6.2, vx: 0, vz: 0, angle: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 }, inputs: { steer: 1, brake: 1 }, tyreWear: 80 };
        applySteering(p, false, 6.2);
        const baselineAngle = TURN_SPEED_HIGH; // a speedFrac=1, steerFactor=1, steer=1: turnRate base = TURN_SPEED_HIGH esatto
        assert.ok(p.angle > 0, 'la capacità di sterzo non deve mai azzerarsi');
        assert.ok(p.angle >= baselineAngle * (1 - STEER_LOCKUP_PENALTY_MAX) - 1e-9,
            `atteso angle >= ${baselineAngle * (1 - STEER_LOCKUP_PENALTY_MAX)} (limite della penalità massima), ottenuto ${p.angle}`);
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});
