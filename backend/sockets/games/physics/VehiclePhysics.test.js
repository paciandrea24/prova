// backend/sockets/games/physics/VehiclePhysics.test.js
//
// Test di caratterizzazione end-to-end di updateVelocity: i valori attesi
// sono stati calcolati dal codice ancora monolitico (pre-estrazione Task
// 3-7, vedi docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md)
// e devono restare identici bit per bit dopo ogni estrazione — sono la rete
// di sicurezza primaria per questo refactor.
const test = require('node:test');
const assert = require('node:assert/strict');
const { updateVelocity } = require('./VehiclePhysics');

function run(p, isQuali, slip) {
    updateVelocity(p, isQuali, slip);
    return { speed: p.speed, vx: p.vx, vz: p.vz, angle: p.angle };
}

function assertClose(actual, expected, label) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: atteso ${expected}, ottenuto ${actual}`);
}

test('updateVelocity: acceleratore + sterzo, gomma fresca, nessun danno', () => {
    const p = {
        speed: 0, vx: 0, vz: 0, angle: 0, compound: 'medium', tyreWear: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        inputs: { throttle: 1, brake: 0, steer: 1 }
    };
    const r = run(p, false, 1);
    assertClose(r.speed, 0.186, 'speed');
    assertClose(r.vx, 0.0035765162453614803, 'vx');
    assertClose(r.vz, 0.04804105335592326, 'vz');
    assertClose(r.angle, 0.07431, 'angle');
});

test('updateVelocity: frenata, gomma usurata 80%, danni combinati (ala/fondo/motore) — Fase 2B: valori ricalcolati con TyreForceModel come unica fonte del fattore usura (tarato in 2A.5), non più le WEAR_*_PENALTY legacy rimosse. Anche `angle` cambia leggermente (0.3264038921007012 -> 0.3263983809960395): effetto a catena atteso, non un bug — SteeringModel.applySteering usa `p.speed` DOPO applyBrake, e applyBrake ora usa un effectiveAccel/effectiveBrakeMult diversi.', () => {
    const p = {
        speed: 4, vx: 2, vz: 2, angle: 0.3, compound: 'medium', tyreWear: 80,
        damageParts: { frontWing: 20, floor: 30, engine: 40, suspension: 0 },
        inputs: { throttle: 0, brake: 1, steer: 0.5 }
    };
    const r = run(p, false, 1);
    assertClose(r.speed, 3.720963340736753, 'speed');
    assertClose(r.vx, 1.5506093011257587, 'vx');
    assertClose(r.vz, 2.6685559817765974, 'vz');
    assertClose(r.angle, 0.3263983809960395, 'angle');
});

test('updateVelocity: coast (nessun input), moto residua, sterzo in coast — Fase 2B: vx/vz ricalcolati (grip da TyreForceModel.corneringGripFactor a wear=10); speed/angle invariati (coast e sterzo non dipendono dal fattore usura gomme)', () => {
    const p = {
        speed: 2, vx: 1.5, vz: 0.5, angle: -0.2, compound: 'hard', tyreWear: 10,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        inputs: { throttle: 0, brake: 0, steer: -1 }
    };
    const r = run(p, false, 1);
    assertClose(r.speed, 1.88, 'speed');
    assertClose(r.vx, 0.8531558085119839, 'vx');
    assertClose(r.vz, 0.9253072602268824, 'vz');
    assertClose(r.angle, -0.26758146725046916, 'angle');
});

test('updateVelocity: qualifica ignora usura/danno, con boost scia', () => {
    const p = {
        speed: 1, vx: 1, vz: 0, angle: 0, compound: 'hard', tyreWear: 90,
        damageParts: { frontWing: 80, floor: 80, engine: 80, suspension: 0 },
        inputs: { throttle: 1, brake: 0, steer: 0.2 }
    };
    const r = run(p, true, 1.05);
    assertClose(r.speed, 1.186, 'speed');
    assertClose(r.vx, 0.7837054280299266, 'vx');
    assertClose(r.vz, 0.26089368754938286, 'vz');
    assertClose(r.angle, 0.014201872576987785, 'angle');
});
