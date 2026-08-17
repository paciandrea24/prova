// backend/sockets/games/f1GameSocket.dopoIlTraguardo.test.js
//
// Chi ha tagliato il traguardo continua a girare fino a fine sessione.
//
// Prima si inchiodava sulla linea: il filtro `racing` in tickGame lo
// escludeva dalla fisica. Con i bot, che seguono tutti la stessa traiettoria,
// si formava una fila ferma in mezzo alla pista — segnalato in playtest. E da
// lì veniva anche il difetto delle ruote che continuavano a girare da ferme:
// senza fisica, `speed` restava congelata all'ultimo valore, che è proprio il
// numero con cui il client fa ruotare le ruote e sale il tono del motore.
//
// Chi ha finito è però un FANTASMA: si vede e gira, ma non urta più nessuno.
// A gara conclusa non rischia niente, quindi un suo contatto costerebbe la
// posizione solo all'altro (scelta dell'utente).
const test = require('node:test');
const assert = require('node:assert/strict');
const { lobbies } = require('../../store/lobbies.js');
const { activeGames } = require('../../store/activeGames.js');
const f1 = require('./f1GameSocket.js');

const LOBBY = 'TESTFINE';
const ioFinto = { to: () => ({ emit: () => { } }) };

function partita(trackId = 'prova') {
    lobbies.set(LOBBY, {
        host: 'red', players: ['red'], lockedPlayers: ['red'],
        gameSettings: { trackId, botsEnabled: 'false' },
    });
    const handlers = {};
    f1(ioFinto, { id: 's', data: {}, on: (e, cb) => handlers[e] = cb, emit() { }, join() { } });
    handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red' });
    const g = activeGames.get(LOBBY);
    clearInterval(g.tick);
    clearTimeout(g.tyreSelectTimeout);
    g.grid = Object.keys(g.players);
    f1.physics.assignGridSpawns(g);
    g.phase = 'race';
    g.raceStarted = true;
    g.raceStartTime = Date.now();
    g.raceTick = 0;
    return { g, handlers };
}

function pulisci() {
    const g = activeGames.get(LOBBY);
    if (g) {
        if (g.tick) clearInterval(g.tick);
        for (const k of ['tyreSelectTimeout', 'qualiEndTimeout', 'endTimeout']) {
            if (g[k]) clearTimeout(g[k]);
        }
        Object.values(g.rejoinTimers || {}).forEach(clearTimeout);
    }
    activeGames.delete(LOBBY);
    lobbies.delete(LOBBY);
}

test('chi ha finito continua a muoversi, non si inchioda sul traguardo', (t) => {
    t.after(pulisci);
    const { g } = partita();
    const p = g.players.red;
    p.finished = true;
    p.time = 60000;
    p.inputs = { throttle: 1, brake: 0, steer: 0 };

    const prima = { x: p.x, z: p.z };
    for (let i = 0; i < 10; i++) f1.tickGame(ioFinto, LOBBY, g);

    const percorso = Math.hypot(p.x - prima.x, p.z - prima.z);
    assert.ok(percorso > 1,
        `dopo dieci tick a tutto gas si è mosso di ${percorso.toFixed(2)} unità`);
    assert.ok(p.speed > 0, `velocità ${p.speed}: da ferma le ruote girerebbero a vuoto`);
});

test('chi NON ha finito e sta fermo ai box resta fermo (comportamento invariato)', (t) => {
    t.after(pulisci);
    const { g } = partita();
    const p = g.players.red;
    p.pitting = true;
    p.inputs = { throttle: 1, brake: 0, steer: 0 };

    const prima = { x: p.x, z: p.z };
    for (let i = 0; i < 10; i++) f1.tickGame(ioFinto, LOBBY, g);

    assert.ok(Math.hypot(p.x - prima.x, p.z - prima.z) < 0.01, 'ai box non ci si muove');
});

test('ripassare sul traguardo non conta un altro giro a chi ha finito', () => {
    const game = { track: { points: new Array(1000).fill(null).map((_, i) => ({ x: i, z: 0 })), startFinishIndex: 0, lapLength: 1000 }, phase: 'race', raceTick: 0 };
    const p = { finished: true, lap: 3, checkpointA: true, inFinishZone: false, trackIndex: 0 };
    f1.physics.checkLap(p, 3, ioFinto, LOBBY, game);
    assert.equal(p.lap, 3, 'il giro non deve cambiare');
});

test('chi ha finito non urta piu nessuno: e un fantasma', (t) => {
    t.after(pulisci);
    const { g } = partita();
    const arrivato = g.players.red;
    // Un secondo pilota sovrapposto: senza il filtro, resolveCollisions li
    // spingerebbe via l'uno dall'altro.
    g.players.blue = JSON.parse(JSON.stringify({ ...arrivato, carContacts: [], pendingCollisionPenaltyEvents: [] }));
    g.players.blue.color = 'blue';
    g.players.blue.carContacts = new Set();
    g.players.blue.pendingCollisionPenaltyEvents = [];
    g.players.blue.finished = false;
    g.players.blue.x = arrivato.x + 0.5;
    g.players.blue.z = arrivato.z;
    arrivato.finished = true;
    arrivato.inputs = { throttle: 0, brake: 0, steer: 0 };
    g.players.blue.inputs = { throttle: 0, brake: 0, steer: 0 };

    const prima = { x: g.players.blue.x, z: g.players.blue.z };
    f1.tickGame(ioFinto, LOBBY, g);

    const spinto = Math.hypot(g.players.blue.x - prima.x, g.players.blue.z - prima.z);
    assert.ok(spinto < 0.05,
        `chi corre è stato spostato di ${spinto.toFixed(2)} da un'auto già arrivata`);
});
