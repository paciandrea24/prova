// backend/sockets/games/physics/VehicleMotionModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { integratePosition, applyOffTrackDrag } = require('./VehicleMotionModel');

test('integratePosition: integra x/z da vx/vz*dt', () => {
    const p = { x: 1, z: 2, vx: 3, vz: -4 };
    integratePosition(p, 1 / 13);
    assert.ok(Math.abs(p.x - 1.2307692307692308) < 1e-12);
    assert.ok(Math.abs(p.z - 1.6923076923076923) < 1e-12);
});

test('applyOffTrackDrag: entro roadHalf+2, nessun drag, ritorna false', () => {
    const track = { points: [{ x: 0, z: 0 }], roadHalf: 10 };
    const p = { x: 5, z: 0, speed: 5, vx: 5, vz: 0 };
    const offTrack = applyOffTrackDrag(p, track);
    assert.equal(offTrack, false);
    assert.equal(p.speed, 5);
});

test('applyOffTrackDrag: appena oltre il limite, drag proporzionale alla profondità', () => {
    const track = { points: [{ x: 0, z: 0 }], roadHalf: 10 };
    const p = { x: 14, z: 0, speed: 5, vx: 5, vz: 0 };   // dist=14, limite=12, k=0.25
    const offTrack = applyOffTrackDrag(p, track);
    assert.equal(offTrack, true);
    assert.ok(Math.abs(p.speed - 4.699999999999999) < 1e-9);
});

test('applyOffTrackDrag: molto oltre il limite, drag saturato al massimo (k=1)', () => {
    const track = { points: [{ x: 0, z: 0 }], roadHalf: 10 };
    const p = { x: 25, z: 0, speed: 5, vx: 5, vz: 0 };   // dist=25, ben oltre limite+8
    const offTrack = applyOffTrackDrag(p, track);
    assert.equal(offTrack, true);
    assert.ok(Math.abs(p.speed - 4.4) < 1e-9);
});
