// backend/sockets/games/f1Testbench.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTestbenchScenario } = require('./f1Testbench.js');
const { listTracks } = require('./trackLoader.js');

test('validateTestbenchScenario: scenario valido passa', () => {
    const trackId = listTracks()[0].id;
    const result = validateTestbenchScenario({ trackId, botCount: 4, tyreWear: 30, compound: 'medium' });
    assert.deepEqual(result, { valid: true });
});

test('validateTestbenchScenario: trackId inesistente viene rifiutato', () => {
    const result = validateTestbenchScenario({ trackId: 'pista-che-non-esiste', botCount: 4, tyreWear: 0, compound: 'medium' });
    assert.equal(result.valid, false);
    assert.match(result.error, /pista/i);
});

test('validateTestbenchScenario: botCount fuori range [2,6] viene rifiutato', () => {
    const trackId = listTracks()[0].id;
    assert.equal(validateTestbenchScenario({ trackId, botCount: 1, tyreWear: 0, compound: 'medium' }).valid, false);
    assert.equal(validateTestbenchScenario({ trackId, botCount: 7, tyreWear: 0, compound: 'medium' }).valid, false);
});

test('validateTestbenchScenario: tyreWear fuori range [0,100] viene rifiutato', () => {
    const trackId = listTracks()[0].id;
    assert.equal(validateTestbenchScenario({ trackId, botCount: 4, tyreWear: -1, compound: 'medium' }).valid, false);
    assert.equal(validateTestbenchScenario({ trackId, botCount: 4, tyreWear: 101, compound: 'medium' }).valid, false);
});

test('validateTestbenchScenario: mescola sconosciuta viene rifiutata', () => {
    const trackId = listTracks()[0].id;
    const result = validateTestbenchScenario({ trackId, botCount: 4, tyreWear: 0, compound: 'ultrasoft' });
    assert.equal(result.valid, false);
    assert.match(result.error, /mescola/i);
});

const { createTestbenchSession } = require('./f1Testbench.js');
const { physics } = require('./f1GameSocket.js');

test('createTestbenchSession: crea esattamente botCount bot con usura/mescola richieste', () => {
    const trackId = listTracks()[0].id;
    const game = createTestbenchSession({ trackId, botCount: 4, tyreWear: 45, compound: 'hard' });

    const players = Object.values(game.players);
    assert.equal(players.length, 4);
    for (const p of players) {
        assert.equal(p.isBot, true);
        assert.equal(p.tyreWear, 45);
        assert.equal(p.compound, 'hard');
    }
    assert.equal(game.phase, 'race');
    assert.equal(game.raceStarted, true);
});

test('createTestbenchSession: il game risultante funziona con la vera tickGame (le auto si muovono)', () => {
    const { tickGame } = require('./f1GameSocket.js');
    const trackId = listTracks()[0].id;
    const game = createTestbenchSession({ trackId, botCount: 2, tyreWear: 0, compound: 'medium' });
    const fakeIo = { to: () => ({ emit: () => {} }) };

    const before = Object.values(game.players).map(p => ({ x: p.x, z: p.z }));
    for (let i = 0; i < 50; i++) tickGame(fakeIo, 'TESTBENCH', game);
    const after = Object.values(game.players).map(p => ({ x: p.x, z: p.z }));

    const anyMoved = before.some((b, i) => Math.abs(b.x - after[i].x) > 0.001 || Math.abs(b.z - after[i].z) > 0.001);
    assert.ok(anyMoved, 'atteso che almeno un bot si sia mosso dopo 50 tick della vera tickGame');
});

const { EventEmitter } = require('node:events');
const registerTestbench = require('./f1Testbench.js');

// Fake socket/io minimi: solo quello che f1Testbench.js usa davvero
// (socket.on/emit/join, io.to().emit) — stesso pattern già usato nei test
// di f1Bot.js per deps.io/deps.handlePitReactionPress.
function makeFakeSocket() {
    const s = new EventEmitter();
    s.join = () => {};
    s.emit = () => {};
    return s;
}

test('f1tbStart con scenario non valido emette f1tbError e non crea sessione', (t, done) => {
    const socket = makeFakeSocket();
    const io = { to: () => ({ emit: () => {} }) };
    registerTestbench(io, socket);

    let errorMsg = null;
    socket.emit = (event, payload) => { if (event === 'f1tbError') errorMsg = payload; };

    socket.emit('___trigger___');   // no-op, solo per chiarezza del test
    socket.listeners('f1tbStart')[0]({ trackId: 'non-esiste', botCount: 4, tyreWear: 0, compound: 'medium' });

    assert.ok(errorMsg && errorMsg.error, 'atteso un f1tbError con messaggio');
    done();
});

test('f1tbStart valido avvia il timer, f1tbStop lo ferma (nessuna eccezione)', (t, done) => {
    const { listTracks } = require('./trackLoader.js');
    const trackId = listTracks()[0].id;
    const socket = makeFakeSocket();
    const io = { to: () => ({ emit: () => {} }) };
    registerTestbench(io, socket);

    socket.listeners('f1tbStart')[0]({ trackId, botCount: 2, tyreWear: 0, compound: 'medium' });
    socket.listeners('f1tbPause')[0]();
    socket.listeners('f1tbStep')[0]();
    socket.listeners('f1tbSetSpeed')[0]({ multiplier: 2 });
    socket.listeners('f1tbResume')[0]();
    socket.listeners('f1tbStop')[0]();

    done();   // il vero obiettivo del test è che nessuna delle chiamate sopra lanci un'eccezione
});
