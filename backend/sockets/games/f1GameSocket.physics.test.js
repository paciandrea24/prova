// backend/sockets/games/f1GameSocket.physics.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const f1GameSocket = require('./f1GameSocket.js');

test('f1GameSocket espone .physics con le costanti attese', () => {
    const { physics } = f1GameSocket;
    assert.ok(physics, 'atteso f1GameSocket.physics definito');
    assert.equal(physics.PHYSICS_TICK_MS, 50);
    assert.equal(physics.ACCEL, 0.186);
    assert.equal(physics.BRAKE_MULT, 2.17);
    assert.equal(physics.TURN_SPEED_HIGH, 0.052);
    assert.equal(typeof physics.COLLISION_SUBSTEPS, 'number');
    assert.equal(typeof physics.HALF_LAP_IDX, 'number');
});

test('f1GameSocket.physics espone le funzioni pure attese', () => {
    const { physics } = f1GameSocket;
    for (const name of [
        'effectiveMaxSpeed', 'updateVelocity', 'integratePosition',
        'applyOffTrackDrag', 'applyBridgeBarrier', 'updateTrackIndex',
        'circularWithin', 'checkpointWindowFor', 'finishWindowFor'
    ]) {
        assert.equal(typeof physics[name], 'function', `atteso physics.${name} funzione`);
    }
});

test('effectiveMaxSpeed: in qualifica usa sempre la Soft (speedMult 1.05), a prescindere dalla mescola scelta', () => {
    const { physics } = f1GameSocket;
    const p = { tyreWear: 0, compound: 'hard' };
    const max = physics.effectiveMaxSpeed(p, true);
    assert.ok(Math.abs(max - 6.2 * 1.05) < 1e-9, `atteso ${6.2 * 1.05}, ottenuto ${max}`);
});

test('updateVelocity: da fermo con throttle=1 accelera esattamente di ACCEL in un tick', () => {
    const { physics } = f1GameSocket;
    const p = { inputs: { throttle: 1, brake: 0, steer: 0 }, speed: 0, vx: 0, vz: 0, angle: 0, tyreWear: 0, compound: 'medium' };
    physics.updateVelocity(p, true, 1);
    assert.ok(Math.abs(p.speed - physics.ACCEL) < 1e-9, `atteso ${physics.ACCEL}, ottenuto ${p.speed}`);
});

test('integratePosition: sposta x/z in base a vx/vz e dt', () => {
    const { physics } = f1GameSocket;
    const p = { x: 10, z: 20, vx: 2, vz: -3 };
    physics.integratePosition(p, 0.5);
    assert.ok(Math.abs(p.x - 11) < 1e-9 && Math.abs(p.z - 18.5) < 1e-9, `atteso (11,18.5), ottenuto (${p.x},${p.z})`);
});
