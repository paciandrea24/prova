// backend/sockets/games/physics/VehicleDynamics.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const VehicleDynamics = require('./VehicleDynamics');
const TyreModel = require('./TyreModel');
const VehiclePhysics = require('./VehiclePhysics');
const CollisionResolver = require('./CollisionResolver');

test('VehicleDynamics: updateVelocity/integratePosition/applyOffTrackDrag sono lo STESSO riferimento esportato da VehiclePhysics', () => {
    assert.equal(VehicleDynamics.updateVelocity, VehiclePhysics.updateVelocity);
    assert.equal(VehicleDynamics.integratePosition, VehiclePhysics.integratePosition);
    assert.equal(VehicleDynamics.applyOffTrackDrag, VehiclePhysics.applyOffTrackDrag);
});

test('VehicleDynamics: applyBridgeBarrier/resolveCollisions/COLLISION_SUBSTEPS sono lo STESSO riferimento esportato da CollisionResolver', () => {
    assert.equal(VehicleDynamics.applyBridgeBarrier, CollisionResolver.applyBridgeBarrier);
    assert.equal(VehicleDynamics.resolveCollisions, CollisionResolver.resolveCollisions);
    assert.equal(VehicleDynamics.COLLISION_SUBSTEPS, CollisionResolver.COLLISION_SUBSTEPS);
});

test('VehicleDynamics: applyTyreWear è lo STESSO riferimento esportato da TyreModel', () => {
    assert.equal(VehicleDynamics.applyTyreWear, TyreModel.applyTyreWear);
});

test('VehicleDynamics: updateVelocity funziona end-to-end attraverso la facade (fumo)', () => {
    const p = {
        x: 0, z: 0, angle: 0, speed: 0, vx: 0, vz: 0,
        compound: 'medium', tyreWear: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        inputs: { throttle: 1, brake: 0, steer: 0 }
    };
    VehicleDynamics.updateVelocity(p, false, 1);
    assert.equal(p.speed, 0.186);
});
