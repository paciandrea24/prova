// backend/sockets/games/physics/DamageModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const DamageModel = require('./DamageModel.js');

test('createDamageParts: restituisce un oggetto fresco e indipendente ad ogni chiamata', () => {
    const p1 = DamageModel.createDamageParts();
    const p2 = DamageModel.createDamageParts();
    assert.deepEqual(p1, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
    assert.notEqual(p1, p2, 'devono essere due oggetti distinti, non lo stesso riferimento condiviso');
    p1.frontWing = 50;
    assert.equal(p2.frontWing, 0, 'mutare uno non deve toccare l\'altro');
});

test('addComponentDamage: distribuisce secondo lo split e deriva p.damage come massimo dei componenti', () => {
    const p = { damage: 0 };
    DamageModel.addComponentDamage(p, 100, { frontWing: 0.8, suspension: 0.2 });
    assert.ok(Math.abs(p.damageParts.frontWing - 80) < 1e-9);
    assert.ok(Math.abs(p.damageParts.suspension - 20) < 1e-9);
    assert.equal(p.damageParts.floor, 0);
    assert.equal(p.damageParts.engine, 0);
    assert.ok(Math.abs(p.damage - 80) < 1e-9, 'p.damage = massimo dei 4 componenti');
});

test('addComponentDamage: crea damageParts al volo se assente, e clampa ogni componente a 100', () => {
    const p = {};
    DamageModel.addComponentDamage(p, 200, { frontWing: 1.0 });
    assert.equal(p.damageParts.frontWing, 100, 'clampato a 100 anche con danno grezzo oltre soglia');
    assert.equal(p.damage, 100);
});

test('getEnginePowerPenalty/getFloorGripPenalty/getFrontWingSteerPenalty: 0 a componente sano, MAX a componente distrutto, fallback sicuro senza damageParts', () => {
    const { getEnginePowerPenalty, getFloorGripPenalty, getFrontWingSteerPenalty,
        DAMAGE_SPEED_PENALTY_MAX, DAMAGE_GRIP_PENALTY_MAX, FRONT_WING_STEER_PENALTY_MAX } = DamageModel;

    assert.equal(getEnginePowerPenalty(undefined), 0, 'fallback sicuro senza damageParts (tool offline)');
    assert.equal(getEnginePowerPenalty({ engine: 0 }), 0);
    assert.ok(Math.abs(getEnginePowerPenalty({ engine: 100 }) - DAMAGE_SPEED_PENALTY_MAX) < 1e-9);

    assert.equal(getFloorGripPenalty(undefined), 0);
    assert.ok(Math.abs(getFloorGripPenalty({ floor: 100 }) - DAMAGE_GRIP_PENALTY_MAX) < 1e-9);

    assert.equal(getFrontWingSteerPenalty(undefined), 0);
    assert.ok(Math.abs(getFrontWingSteerPenalty({ frontWing: 100 }) - FRONT_WING_STEER_PENALTY_MAX) < 1e-9);
});

test('getEnginePowerPenalty: scala linearmente col danno motore, ignora gli altri componenti', () => {
    const { getEnginePowerPenalty, DAMAGE_SPEED_PENALTY_MAX } = DamageModel;
    const half = getEnginePowerPenalty({ engine: 50, frontWing: 100, floor: 100, suspension: 100 });
    assert.ok(Math.abs(half - DAMAGE_SPEED_PENALTY_MAX / 2) < 1e-9, 'legge solo engine, non gli altri componenti');
});

test('getSuspensionNoise: zero a sospensioni sane, progressivo (nessuna soglia) fino al massimo a sospensioni distrutte', () => {
    const { getSuspensionNoise, DAMAGE_STEER_NOISE_MAX } = DamageModel;
    const rngAlways1 = () => 1;   // deterministico, sempre al massimo dell'intervallo

    assert.equal(getSuspensionNoise(undefined, rngAlways1), 0, 'fallback sicuro senza damageParts');
    assert.equal(getSuspensionNoise({ suspension: 0 }, rngAlways1), 0);
    const low = getSuspensionNoise({ suspension: 10 }, rngAlways1);
    assert.ok(low > 0, 'già non-zero a bassissimo danno, niente soglia');
    const high = getSuspensionNoise({ suspension: 100 }, rngAlways1);
    assert.ok(Math.abs(high - DAMAGE_STEER_NOISE_MAX) < 1e-9, 'massimo raggiunto a sospensioni distrutte');
    assert.ok(high > low, 'monotono crescente col danno');
});

// ---- Fase 3 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// penalità aero da danno — riusano frontWing/floor, nessun quinto componente ----

test('getFrontWingDragPenalty: 0 a componente sano, MAX a componente distrutto, fallback sicuro', () => {
    const { getFrontWingDragPenalty, FRONT_WING_DRAG_PENALTY_MAX } = DamageModel;
    assert.equal(getFrontWingDragPenalty(undefined), 0, 'fallback sicuro senza damageParts (tool offline)');
    assert.equal(getFrontWingDragPenalty({ frontWing: 0 }), 0);
    assert.ok(Math.abs(getFrontWingDragPenalty({ frontWing: 100 }) - FRONT_WING_DRAG_PENALTY_MAX) < 1e-9);
});

test('getFrontWingDragPenalty: lineare nel danno (50% -> metà penalità massima), ignora gli altri componenti', () => {
    const { getFrontWingDragPenalty, FRONT_WING_DRAG_PENALTY_MAX } = DamageModel;
    const half = getFrontWingDragPenalty({ frontWing: 50, floor: 100, engine: 100, suspension: 100 });
    assert.ok(Math.abs(half - FRONT_WING_DRAG_PENALTY_MAX / 2) < 1e-9, 'legge solo frontWing, non gli altri componenti');
});

test('getFloorDownforcePenalty: 0 a componente sano, MAX a componente distrutto, fallback sicuro', () => {
    const { getFloorDownforcePenalty, FLOOR_DOWNFORCE_PENALTY_MAX } = DamageModel;
    assert.equal(getFloorDownforcePenalty(undefined), 0, 'fallback sicuro senza damageParts (tool offline)');
    assert.equal(getFloorDownforcePenalty({ floor: 0 }), 0);
    assert.ok(Math.abs(getFloorDownforcePenalty({ floor: 100 }) - FLOOR_DOWNFORCE_PENALTY_MAX) < 1e-9);
});

test('getFloorDownforcePenalty: ignora frontWing/engine/suspension (isolato al proprio componente)', () => {
    const { getFloorDownforcePenalty } = DamageModel;
    assert.equal(getFloorDownforcePenalty({ floor: 0, frontWing: 100, engine: 100, suspension: 100 }), 0);
});

test('getFloorDownforcePenalty è indipendente da getFloorGripPenalty (costanti diverse, nessuna derivazione incrociata)', () => {
    const { getFloorDownforcePenalty, getFloorGripPenalty, FLOOR_DOWNFORCE_PENALTY_MAX, DAMAGE_GRIP_PENALTY_MAX } = DamageModel;
    assert.notEqual(FLOOR_DOWNFORCE_PENALTY_MAX, DAMAGE_GRIP_PENALTY_MAX);
    assert.notEqual(getFloorDownforcePenalty({ floor: 50 }), getFloorGripPenalty({ floor: 50 }));
});

test('createDamageParts: resta a 4 componenti, nessun quinto campo aero introdotto', () => {
    const parts = DamageModel.createDamageParts();
    assert.deepEqual(Object.keys(parts).sort(), ['engine', 'floor', 'frontWing', 'suspension']);
});

test('applyCarCollisionDamage/applyBarrierDamage: continuano a mantenere p.damage come numero valido (retrocompatibilità HUD/tool offline)', () => {
    const { applyCarCollisionDamage, applyBarrierDamage } = DamageModel;
    const a = { damage: 0, collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    const b = { damage: 0, collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    applyCarCollisionDamage(a, b, 0, -5, 5);
    assert.equal(typeof a.damage, 'number');
    assert.equal(typeof b.damage, 'number');

    const p = { damage: 0, collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    applyBarrierDamage(p, 3);
    assert.equal(typeof p.damage, 'number');
});
