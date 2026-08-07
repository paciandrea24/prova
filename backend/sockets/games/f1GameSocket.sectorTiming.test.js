// backend/sockets/games/f1GameSocket.sectorTiming.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const f1GameSocket = require('./f1GameSocket.js');

test('fillGaps: array senza buchi resta identico', () => {
    const { physics } = f1GameSocket;
    const curve = new Float32Array([0, 5, 10, 15]);
    const filled = physics.fillGaps(curve);
    assert.deepEqual(Array.from(filled), [0, 5, 10, 15]);
});

test('fillGaps: buco isolato tra due valori noti viene interpolato linearmente', () => {
    const { physics } = f1GameSocket;
    const curve = new Float32Array([0, -1, -1, 30]);
    const filled = physics.fillGaps(curve);
    assert.deepEqual(Array.from(filled), [0, 10, 20, 30]);
});

test('fillGaps: run iniziale di buchi (prima del primo valore noto) riempito a 0', () => {
    const { physics } = f1GameSocket;
    const curve = new Float32Array([-1, -1, 20]);
    const filled = physics.fillGaps(curve);
    assert.deepEqual(Array.from(filled), [0, 0, 20]);
});

test('fillGaps: run finale di buchi (dopo l\'ultimo valore noto) riempito a valore costante', () => {
    const { physics } = f1GameSocket;
    const curve = new Float32Array([0, 10, -1, -1]);
    const filled = physics.fillGaps(curve);
    assert.deepEqual(Array.from(filled), [0, 10, 10, 10]);
});

test('SECTOR1_REL_IDX/SECTOR2_REL_IDX: dividono N_SAMPLES=1000 in terzi', () => {
    const { physics } = f1GameSocket;
    assert.equal(physics.SECTOR1_REL_IDX, 333);
    assert.equal(physics.SECTOR2_REL_IDX, 667);
});

function makeResettablePlayer(color) {
    return {
        color, damage: 0, collisionPenaltyMs: 0, pendingRepair: false,
        carContacts: new Set(), wallContact: false, pendingCollisionPenaltyEvents: [],
        finished: false, time: null, lap: 0, checkpointA: false, inFinishZone: false,
        trackIndex: 0, tyreWear: 0, pitGoTimer: null, pitting: false, pitPhase: null,
        pitGoTime: null, pendingCompound: null, hasPitted: false, pitPenalty: false,
        falseStart: false, falseStartServed: false, gapToLeaderMs: null,
        pitAutoState: null, pitPathIndex: 0, inputs: { throttle: 0, brake: 0, steer: 0 },
        // stato "sporco" di una gara precedente, da azzerare
        curLapCurve: new Float32Array(1000), prevLapCurve: new Float32Array(1000),
        curLapSectorTimes: [111, 222, 333], prevLapSectorTimes: [111, 222, 333],
        deltaToPreviousLapMs: 42
    };
}

test('assignGridSpawns: azzera lo stato settori/delta di una gara precedente', () => {
    const { physics } = f1GameSocket;
    const fakeTrack = {
        gridSpawnPoint: (i) => ({ x: i, z: 0, angle: 0 }),
        pitPath: [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 0 }],
        pitBoxIndex: 2
    };
    const p = makeResettablePlayer('red');
    const game = { grid: ['red'], players: { red: p }, track: fakeTrack };

    physics.assignGridSpawns(game);

    assert.equal(p.curLapCurve, null);
    assert.equal(p.prevLapCurve, null);
    assert.deepEqual(p.curLapSectorTimes, [null, null, null]);
    assert.equal(p.prevLapSectorTimes, null);
    assert.equal(p.deltaToPreviousLapMs, null);
    assert.deepEqual(game.bestSectorTimes, [Infinity, Infinity, Infinity]);
});

test('resetPlayers: azzera lo stesso stato settori/delta', () => {
    const { physics } = f1GameSocket;
    const fakeTrack = { gridSpawnPoint: (i) => ({ x: i, z: 0, angle: 0 }) };
    const p = makeResettablePlayer('red');
    const game = { players: { red: p }, track: fakeTrack };

    physics.resetPlayers(game);

    assert.equal(p.curLapCurve, null);
    assert.equal(p.prevLapCurve, null);
    assert.deepEqual(p.curLapSectorTimes, [null, null, null]);
    assert.equal(p.prevLapSectorTimes, null);
    assert.equal(p.deltaToPreviousLapMs, null);
    assert.deepEqual(game.bestSectorTimes, [Infinity, Infinity, Infinity]);
});

function makeSectorTrack(n = 1000) {
    return {
        points: Array.from({ length: n }, (_, i) => ({ x: i, z: 0 })),
        startFinishIndex: 0
    };
}

test('updateSectorTiming: fuori gara (fase qualifica) non tocca nulla', () => {
    const { physics } = f1GameSocket;
    const p = { trackIndex: 500, curLapCurve: null };
    const game = { phase: 'qualifying', track: makeSectorTrack(), raceTick: 10, bestSectorTimes: [Infinity, Infinity, Infinity] };
    physics.updateSectorTiming(p, game);
    assert.equal(p.curLapCurve, null, 'in qualifica non alloca mai la curva');
});

test('updateSectorTiming: primo tick in gara alloca la curva e ancora lapStartMs a ORA', () => {
    const { physics } = f1GameSocket;
    const p = { trackIndex: 0, curLapCurve: null, prevLapCurve: null };
    const game = { phase: 'race', track: makeSectorTrack(), raceTick: 40, bestSectorTimes: [Infinity, Infinity, Infinity] };
    physics.updateSectorTiming(p, game);
    assert.ok(p.curLapCurve instanceof Float32Array);
    assert.equal(p.lapStartMs, 40 * physics.PHYSICS_TICK_MS);
    assert.equal(p.deltaToPreviousLapMs, null, 'nessun giro precedente ancora');
});

test('updateSectorTiming: attraversare SECTOR1_REL_IDX chiude il settore 1 e aggiorna il record globale', () => {
    const { physics } = f1GameSocket;
    const p = { trackIndex: 0, curLapCurve: null, prevLapCurve: null };
    const game = { phase: 'race', track: makeSectorTrack(), raceTick: 0, bestSectorTimes: [Infinity, Infinity, Infinity] };
    physics.updateSectorTiming(p, game); // giro parte a tick 0

    game.raceTick = 10; // 500ms dopo (10 * 50ms)
    p.trackIndex = physics.SECTOR1_REL_IDX;
    physics.updateSectorTiming(p, game);

    assert.equal(p.curLapSectorTimes[0], 500);
    assert.equal(game.bestSectorTimes[0], 500);
    assert.equal(p.curLapSectorTimes[1], null, 'settore 2 non ancora raggiunto');
});

test('updateSectorTiming: attraversare SECTOR2_REL_IDX chiude il settore 2 come DIFFERENZA dal settore 1, non il cumulato', () => {
    const { physics } = f1GameSocket;
    const p = { trackIndex: 0, curLapCurve: null, prevLapCurve: null };
    const game = { phase: 'race', track: makeSectorTrack(), raceTick: 0, bestSectorTimes: [Infinity, Infinity, Infinity] };
    physics.updateSectorTiming(p, game);

    game.raceTick = 10; p.trackIndex = physics.SECTOR1_REL_IDX;
    physics.updateSectorTiming(p, game); // settore1 = 500ms

    game.raceTick = 30; p.trackIndex = physics.SECTOR2_REL_IDX;
    physics.updateSectorTiming(p, game); // cumulato 1500ms -> settore2 = 1500-500 = 1000ms

    assert.equal(p.curLapSectorTimes[1], 1000);
    assert.equal(game.bestSectorTimes[1], 1000);
});

test('updateSectorTiming: un record globale già basso NON viene peggiorato da un tempo più lento', () => {
    const { physics } = f1GameSocket;
    const p = { trackIndex: 0, curLapCurve: null, prevLapCurve: null };
    const game = { phase: 'race', track: makeSectorTrack(), raceTick: 0, bestSectorTimes: [200, Infinity, Infinity] };
    physics.updateSectorTiming(p, game); // priming: ancora lapStartMs a raceTick=0 (come negli altri test sopra)

    game.raceTick = 10; p.trackIndex = physics.SECTOR1_REL_IDX; // 500ms dopo, più lento del record 200
    physics.updateSectorTiming(p, game);
    assert.equal(game.bestSectorTimes[0], 200, 'il record esistente resta il più basso');
});

test('updateSectorTiming: con un giro precedente disponibile, calcola il delta continuo alla stessa posizione', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const prevCurve = new Float32Array(n).fill(0);
    prevCurve[100] = 5000;
    const p = {
        trackIndex: 100,
        curLapCurve: new Float32Array(n).fill(-1),   // giro già in corso, niente lazy-init
        prevLapCurve: prevCurve,
        curLapSectorTimes: [null, null, null],
        lapStartMs: 0
    };
    const game = { phase: 'race', track: makeSectorTrack(n), raceTick: 90, bestSectorTimes: [Infinity, Infinity, Infinity] };

    physics.updateSectorTiming(p, game);

    assert.equal(p.deltaToPreviousLapMs, 4500 - 5000);
});

function makeMockIo() {
    return { to: () => ({ emit: () => {} }) };
}

test('checkLap: a fine giro in gara, azzera i settori per il nuovo giro e prepara uno "scatto" a tempo del giro chiuso', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
    const startFinishIndex = 300;
    const track = { points, lapLength: n, startFinishIndex };
    const curLapCurve = new Float32Array(n).fill(-1);
    const game = { track, raceTick: 20, phase: 'race', bestSectorTimes: [Infinity, Infinity, Infinity] };
    const io = makeMockIo();

    const p = {
        color: 'red', lap: 0, checkpointA: true, inFinishZone: false,
        trackIndex: startFinishIndex,
        lapStartMs: 0,
        curLapCurve, curLapSectorTimes: [300, 400, null],   // settore1=300ms, settore2=400ms
        prevLapCurve: null, prevLapSectorTimes: null,
        lapTrulyStarted: true
    };
    physics.checkLap(p, 10, io, 'lobby1', game);

    assert.equal(p.lap, 1);
    // raceTick=20, nessun prevX/prevZ -> crossingElapsedMs = 20*50 = 1000ms (stesso fallback dei test esistenti)
    const s3 = 1000 - 0 - 300 - 400; // 300
    assert.deepEqual(p.prevLapSectorTimes, [300, 400, s3], 'settori del giro appena chiuso, come 0/1');
    assert.equal(game.bestSectorTimes[2], s3);
    assert.ok(p.prevLapCurve instanceof Float32Array, 'la curva del giro chiuso diventa il riferimento');
    assert.notEqual(p.prevLapCurve, curLapCurve, 'prevLapCurve è passata da fillGaps, non lo stesso oggetto');
    // Azzerati TUTTI e 3 per il nuovo giro (Rif. richiesta utente
    // 2026-08-07 dopo playtest: le barre non devono restare fisse sul giro
    // vecchio — lo "scatto" a tempo sotto è la sola cosa che le mantiene
    // visibili, non curLapSectorTimes).
    assert.deepEqual(p.curLapSectorTimes, [null, null, null]);
    // Lo "scatto" (recap) del giro appena chiuso, con scadenza — è quello
    // che buildPublicState trasmette al posto di curLapSectorTimes finché
    // non scade (Rif. SECTOR_RECAP_DURATION_MS).
    assert.deepEqual(p.lapRecapSectorTimes, [300, 400, s3]);
    assert.equal(p.lapRecapExpiresAtMs, 1000 + physics.SECTOR_RECAP_DURATION_MS);
    assert.equal(p.lapTrulyStarted, false,
        'updateSectorTiming deve restare in quarantena finché trackIndex non riflette davvero la posizione del nuovo giro');
    assert.equal(p.lapStartMs, 1000, 'lapStartMs riparte dal punto di attraversamento appena calcolato');
});

test('checkLap: in qualifica (game.phase assente/diverso da race) NON tocca lo stato settori', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
    const startFinishIndex = 300;
    const track = { points, lapLength: n, startFinishIndex };
    const game = { track, raceTick: 20 };   // niente game.phase, come i test esistenti di checkLap
    const io = makeMockIo();

    const p = { color: 'red', lap: 0, checkpointA: true, inFinishZone: false, trackIndex: startFinishIndex };
    physics.checkLap(p, 10, io, 'lobby1', game);

    assert.equal(p.lap, 1, 'il conteggio giri esistente resta invariato');
    assert.equal(p.curLapCurve, undefined, 'nessun campo settore scritto se non in game.phase === "race"');
});

// ---- Regressione integrazione multi-giro (Rif. bug reale 2026-08-07,
// segnalato in playtest: "il secondo settore resta fisso sul fucsia") ----
// I test sopra chiamano checkLap/updateSectorTiming con fixture costruite a
// mano, una chiamata alla volta — non riproducevano il bug reale, che
// nasce SOLO dall'interazione tra le due funzioni attraverso più tick
// consecutivi (trackIndex non ancora ricalcolato al tick del cambio giro).
// Qui si simula una gara vera, tick per tick, con la stessa sequenza
// checkLap→updateSectorTiming usata da tickGame.
test('Integrazione multi-giro: i settori 1/2 NON restano contaminati a ~0 dopo il primo cambio giro', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
    const startFinishIndex = 0;
    const track = { points, lapLength: n, startFinishIndex };
    const game = { track, raceTick: 0, phase: 'race', bestSectorTimes: [Infinity, Infinity, Infinity] };
    const io = makeMockIo();

    const p = {
        color: 'red', lap: 0, checkpointA: false, inFinishZone: false, finished: false, time: null,
        trackIndex: 0, hasPitted: true, falseStart: false, falseStartServed: false, collisionPenaltyMs: 0,
        curLapCurve: null, prevLapCurve: null, curLapSectorTimes: undefined, prevLapSectorTimes: null,
        deltaToPreviousLapMs: null, lapTrulyStarted: false
    };

    const totalLaps = 4;
    const step = 3;   // indici avanzati per tick, costante: ogni giro dovrebbe impiegare lo STESSO tempo
    const bestAfterLap = [];

    for (let tick = 0; tick < 3000 && p.lap < totalLaps; tick++) {
        game.raceTick++;
        p.trackIndex = (p.trackIndex + step) % n;
        const lapBefore = p.lap;
        physics.checkLap(p, totalLaps, io, 'lobby1', game);
        physics.updateSectorTiming(p, game);
        if (p.lap !== lapBefore) bestAfterLap.push([...game.bestSectorTimes]);
    }
    // La gara arriva a completamento (p.lap===totalLaps): checkLap arma un
    // vero setTimeout di sicurezza (endRace dopo 60s) — va ripulito subito,
    // non deve restare pendente dopo la fine del test (stesso pattern già
    // in uso per pitGoTimer negli altri test di questo file).
    if (game.endTimeout) { clearTimeout(game.endTimeout); game.endTimeout = null; }

    assert.ok(bestAfterLap.length >= 3, 'la simulazione deve aver chiuso almeno 3 giri');
    // Passo costante ad ogni tick -> ogni giro dovrebbe impiegare lo stesso
    // tempo per ciascun settore: se bestSectorTimes[0]/[1] restano
    // contaminati a un valore vicino a 0 dal primo giro in poi, il bug è
    // ancora presente. Con passo costante il tempo di settore reale è
    // ordini di grandezza più alto di qualche ms.
    for (const best of bestAfterLap) {
        assert.ok(best[0] > 1000, `bestSectorTimes[0]=${best[0]} è sospettosamente vicino a 0 (bug contaminazione)`);
        assert.ok(best[1] > 1000, `bestSectorTimes[1]=${best[1]} è sospettosamente vicino a 0 (bug contaminazione)`);
    }
    // A passo costante, il tempo di settore 1 dovrebbe essere IDENTICO ad
    // ogni giro (stessa distanza, stessa velocità) — se il bug fosse
    // presente solo al primo giro (poi "guarito"), i valori dei giri
    // successivi differirebbero dal primo in modo incoerente con un
    // passo costante.
    for (let i = 1; i < bestAfterLap.length; i++) {
        assert.equal(bestAfterLap[i][0], bestAfterLap[0][0], 'bestSectorTimes[0] deve restare coerente giro dopo giro a passo costante');
    }
});

test('Integrazione multi-giro: il settore 3 diventa visibile (non resta null) dal primo giro completato in poi', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
    const startFinishIndex = 0;
    const track = { points, lapLength: n, startFinishIndex };
    const game = { track, raceTick: 0, phase: 'race', bestSectorTimes: [Infinity, Infinity, Infinity] };
    const io = makeMockIo();

    const p = {
        color: 'red', lap: 0, checkpointA: false, inFinishZone: false, finished: false, time: null,
        trackIndex: 0, hasPitted: true, falseStart: false, falseStartServed: false, collisionPenaltyMs: 0,
        curLapCurve: null, prevLapCurve: null, curLapSectorTimes: undefined, prevLapSectorTimes: null,
        deltaToPreviousLapMs: null, lapTrulyStarted: false
    };

    const totalLaps = 3;
    const step = 3;

    for (let tick = 0; tick < 2000 && p.lap < totalLaps; tick++) {
        game.raceTick++;
        p.trackIndex = (p.trackIndex + step) % n;
        physics.checkLap(p, totalLaps, io, 'lobby1', game);
        physics.updateSectorTiming(p, game);
        if (p.lap === 1) break;   // appena chiuso il primo giro, basta per questo test
    }
    if (game.endTimeout) { clearTimeout(game.endTimeout); game.endTimeout = null; }

    assert.equal(p.lap, 1, 'precondizione: almeno un giro completato');
    // curLapSectorTimes è azzerato (comportamento uniforme 0/1/2 dopo la
    // richiesta utente 2026-08-07 di NON tenerlo fisso) — la visibilità del
    // settore 3 appena chiuso passa dal recap a tempo, non da qui.
    assert.deepEqual(p.curLapSectorTimes, [null, null, null]);
    assert.ok(p.lapRecapSectorTimes && p.lapRecapSectorTimes[2] != null,
        'lapRecapSectorTimes deve contenere il settore3 del giro appena chiuso — prima del fix il settore3 non era mai scritto da nessuna parte');
});

test('buildPublicState: trasmette il recap del giro chiuso finché la finestra è attiva, poi torna ai dati live del nuovo giro', () => {
    const { physics } = f1GameSocket;
    const p = {
        curLapSectorTimes: [null, null, null],   // nuovo giro appena iniziato, ancora nulla
        lapRecapSectorTimes: [1200, 1300, 1100], // scatto del giro appena chiuso
        lapRecapExpiresAtMs: 5000,
        prevLapSectorTimes: [1250, 1350, 1150], gapToLeaderMs: null, isBot: false,
        x: 0, z: 0, angle: 0, trackIndex: 0, speed: 0, finished: false, time: null, lap: 1,
        compound: 'medium', tyreWear: 0, damage: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        pitAutoState: null, falseStart: false, falseStartServed: false, inSlipstream: false,
        collisionPenaltyMs: 0, inputs: { throttle: 0, brake: 0, steer: 0 }
    };

    // Dentro la finestra (raceTick*50 = 4900ms < 5000ms di scadenza).
    let game = { raceTick: 98, phase: 'race', bestSectorTimes: [Infinity, Infinity, Infinity] };
    let out = physics.buildPublicState({ red: p }, false, null, game);
    assert.deepEqual(out.red.sectorTimes, [1200, 1300, 1100], 'entro la finestra mostra il recap, non i dati (ancora nulli) del nuovo giro');

    // Dopo la scadenza (raceTick*50 = 5100ms >= 5000ms).
    game = { raceTick: 102, phase: 'race', bestSectorTimes: [Infinity, Infinity, Infinity] };
    out = physics.buildPublicState({ red: p }, false, null, game);
    assert.deepEqual(out.red.sectorTimes, [null, null, null], 'dopo la scadenza torna ai dati live del nuovo giro (ancora nulli finché non li attraversa)');
});

function makeBroadcastPlayer(overrides = {}) {
    return {
        x: 0, z: 0, angle: 0, trackIndex: 0, speed: 0, finished: false, time: null, lap: 0,
        compound: 'medium', tyreWear: 0, damage: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        pitAutoState: null, falseStart: false, falseStartServed: false,
        gapToLeaderMs: null, isBot: false, inSlipstream: false,
        collisionPenaltyMs: 0,
        inputs: { throttle: 0, brake: 0, steer: 0 },
        ...overrides
    };
}

test('buildPublicState: fuori gara (phase assente), i campi settore/delta sono neutri', () => {
    const { physics } = f1GameSocket;
    const out = physics.buildPublicState({ red: makeBroadcastPlayer() }, false, null, { raceTick: 0 });
    assert.deepEqual(out.red.sectorTimes, [null, null, null]);
    assert.equal(out.red.prevSectorTimes, null);
    assert.deepEqual(out.red.bestSectorTimes, [null, null, null]);
    assert.equal(out.red.deltaToPreviousLapMs, null);
});

test('buildPublicState: in gara, espone i campi settore/delta reali del giocatore', () => {
    const { physics } = f1GameSocket;
    const p = makeBroadcastPlayer({
        curLapSectorTimes: [1200, null, null],
        prevLapSectorTimes: [1300, 2500, 3900],
        deltaToPreviousLapMs: -150
    });
    const game = { raceTick: 0, phase: 'race', bestSectorTimes: [1100, 2400, Infinity] };
    const out = physics.buildPublicState({ red: p }, false, null, game);

    assert.deepEqual(out.red.sectorTimes, [1200, null, null]);
    assert.deepEqual(out.red.prevSectorTimes, [1300, 2500, 3900]);
    assert.deepEqual(out.red.bestSectorTimes, [1100, 2400, null], 'Infinity convertito esplicitamente in null');
    assert.equal(out.red.deltaToPreviousLapMs, -150);
});
