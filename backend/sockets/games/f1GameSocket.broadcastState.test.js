// backend/sockets/games/f1GameSocket.broadcastState.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const f1GameSocket = require('./f1GameSocket.js');

function makeFakePlayer(steer) {
    return {
        x: 10, z: -5, angle: 0.3, trackIndex: 7, speed: 4.2,
        finished: false, time: null, lap: 1,
        compound: 'medium', tyreWear: 0, damage: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        pitAutoState: null, falseStart: false, falseStartServed: false,
        gapToLeaderMs: null, isBot: false, inSlipstream: false,
        collisionPenaltyMs: 0,
        inputs: { throttle: 0, brake: 0, steer }
    };
}

test('buildPublicState include steerInput preso da p.inputs.steer', () => {
    const out = f1GameSocket.physics.buildPublicState({ red: makeFakePlayer(0.42) }, false, null, { raceTick: 0 });
    assert.equal(out.red.steerInput, 0.42);
});

test('buildPublicState: steerInput negativo (sterzo a destra) passa invariato', () => {
    const out = f1GameSocket.physics.buildPublicState({ blue: makeFakePlayer(-1) }, false, null, { raceTick: 0 });
    assert.equal(out.blue.steerInput, -1);
});

test('buildPublicState include uid del giocatore, cosi gli avversari possono recuperare la sua livrea vera', () => {
    const p = makeFakePlayer(0);
    p.uid = 'firebase-uid-123';
    const out = f1GameSocket.physics.buildPublicState({ red: p }, false, null, { raceTick: 0 });
    assert.equal(out.red.uid, 'firebase-uid-123');
});

test('buildPublicState: uid null per bot/ospiti senza account', () => {
    const out = f1GameSocket.physics.buildPublicState({ red: makeFakePlayer(0) }, false, null, { raceTick: 0 });
    assert.equal(out.red.uid, null);
});
