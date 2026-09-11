// backend/sockets/games/f1GameSocket.indicatori.test.js
//
// Blocco I della carrellata — la colonna di indicatori accanto alla classifica
// (P ai box, cronometro del giro veloce, "!" delle penalita'). Qui si prova
// quello che DEVE arrivare dal server, perche' oggi non esiste:
//
//   - `inPit`: il client sa solo di `pitLimiter`, che copre l'autopilota ma
//     non la sosta da fermo;
//   - il **giro veloce**: nessuno misurava il tempo sul giro in gara;
//   - le penalita' da collisione **scontate ai box** (scelta dell'utente del
//     2026-09-11): prima si sommavano solo al tempo finale, quindi il "!" non
//     si sarebbe mai spento in gara.
const test = require('node:test');
const assert = require('node:assert/strict');
const f1 = require('./f1GameSocket.js');
const { loadTrack } = require('./trackLoader.js');
const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');
const BoxIngresso = require('../../../frontend/shared/f1BoxIngresso.js');

const P = f1.physics;

function ioFinto(raccolti = []) {
    return {
        to: () => ({ emit: (nome, dati) => raccolti.push({ nome, dati }) }),
        raccolti,
    };
}

// Un pilota arrivato allo stallo, pronto per startPitStop.
function pilotaAlBox() {
    const track = loadTrack('prova');
    const anchors = TrackGeometry.pitBoxAnchors(track.pitPath, track.pitBoxIndex, 8, track.points, track.pitRoadHalf);
    P.addLaneIndices(track, anchors);
    const p = {
        color: '#E74C3C', isBot: false, x: 0, z: 0, angle: 0, speed: 0,
        pitAutoState: 'entering', pitBoxAnchor: anchors[2], pitPathIndex: 0,
        pitEsito: BoxIngresso.PERFETTA,
        falseStart: false, falseStartServed: false,
        collisionPenaltyMs: 0, collisionPenaltyTotalMs: 0,
    };
    const game = { track, socketByColor: { '#E74C3C': 'sock' }, raceTick: 1000, players: { '#E74C3C': p } };
    return { p, game };
}

function durataAnnunciata(io) {
    const avvio = io.raccolti.find(m => m.nome === 'f1PitStopStarted');
    assert.ok(avvio, 'nessun annuncio di inizio sosta');
    return avvio.dati.durationMs;
}

// ═══════════ LE PENALITA' SI SCONTANO AI BOX ═══════════

test('la penalita\' da collisione si sconta alla sosta, e il pendente si azzera', (t) => {
    t.after(() => { if (p.pitGoTimer) clearTimeout(p.pitGoTimer); });
    const { p, game } = pilotaAlBox();
    p.collisionPenaltyMs = 5000;
    p.collisionPenaltyTotalMs = 5000;
    const io = ioFinto();
    P.startPitStop(io, 'L', game, p);

    assert.equal(durataAnnunciata(io), P.PIT_DURATA_PERFETTA + 5000,
        'i secondi di penalita\' devono allungare la sosta');
    assert.equal(p.collisionPenaltyMs, 0,
        'scontata la penalita\', il pendente va a zero: e\' cio\' che spegne il "!"');
});

test('scontarla ai box non cancella la penalita\' dal riepilogo di fine gara', (t) => {
    t.after(() => { if (p.pitGoTimer) clearTimeout(p.pitGoTimer); });
    // ⚠️ Il pannello finale mostra «Collisioni causate» leggendo il totale.
    // Con un contatore solo, azzerarlo alla sosta farebbe sparire dal
    // riepilogo una penalita' che il giocatore ha preso e pagato davvero.
    const { p, game } = pilotaAlBox();
    p.collisionPenaltyMs = 5000;
    p.collisionPenaltyTotalMs = 5000;
    P.startPitStop(ioFinto(), 'L', game, p);

    assert.equal(p.collisionPenaltyTotalMs, 5000,
        'il totale di gara non si tocca: e\' la memoria, non il debito');
});

test('falsa partenza e collisione si scontano nella STESSA sosta', (t) => {
    t.after(() => { if (p.pitGoTimer) clearTimeout(p.pitGoTimer); });
    const { p, game } = pilotaAlBox();
    p.falseStart = true;
    p.collisionPenaltyMs = 3000;
    p.collisionPenaltyTotalMs = 3000;
    const io = ioFinto();
    P.startPitStop(io, 'L', game, p);

    assert.equal(durataAnnunciata(io), P.PIT_DURATA_PERFETTA + 5000 + 3000,
        'la sosta paga entrambe le penalita\'');
    assert.equal(p.falseStartServed, true);
    assert.equal(p.collisionPenaltyMs, 0);
});

test('una penalita\' presa DOPO l\'ultima sosta si paga comunque alla bandiera', (t) => {
    t.after(() => { if (p.pitGoTimer) clearTimeout(p.pitGoTimer); });
    // La rete di sicurezza che gia' esiste per la falsa partenza deve valere
    // anche qui: chi tampona all'ultimo giro non la scampa perche' non si
    // ferma piu'.
    const { p, game } = pilotaAlBox();
    p.collisionPenaltyMs = 5000;
    p.collisionPenaltyTotalMs = 5000;
    P.startPitStop(ioFinto(), 'L', game, p);
    assert.equal(p.collisionPenaltyMs, 0, 'presupposto: la sosta ha ripulito il debito');

    // Giro dopo, nuovo contatto.
    p.collisionPenaltyMs = 2000;
    p.collisionPenaltyTotalMs = 7000;
    p.hasPitted = true;
    p.pitAutoState = null; p.pitting = false;
    game.phase = 'race';
    game.raceEnded = false;
    const io2 = ioFinto();
    P.finalizeSessionFinish(p, 100000, game, io2, 'L');

    assert.equal(p.time, 102000,
        `il tempo finale deve includere i 2 s non scontati, invece e' ${p.time}`);
});

// ═══════════ inPit ═══════════

test('inPit copre TUTTA la sosta: manovra, fermo nello stallo e uscita', () => {
    const base = {
        x: 0, z: 0, angle: 0, trackIndex: 0, speed: 0, inputs: { throttle: 0, brake: 0, steer: 0 },
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        compound: 'medium', tyreWear: 0, damage: 0, collisionPenaltyMs: 0,
    };
    const casi = [
        ['in pista',              { ...base },                                false],
        ['autopilota d\'ingresso', { ...base, pitAutoState: 'entering' },      true],
        ['fermo nello stallo',    { ...base, pitting: true },                 true],
        ['autopilota d\'uscita',  { ...base, pitAutoState: 'exiting' },       true],
    ];
    for (const [che, p, atteso] of casi) {
        const out = P.buildPublicState({ red: p }, false, null, { raceTick: 0 });
        assert.equal(out.red.inPit, atteso, `${che}: inPit dovrebbe essere ${atteso}`);
    }
});

// ═══════════ QUANTA PENALITA' RESTA DA SCONTARE ═══════════

test('penaltyPendingMs somma TUTTO quel che resta da scontare', () => {
    // Un numero solo per un avviso solo: il client mostra «+8.0» e poi lo
    // compatta in «!», e non deve rimettere insieme i pezzi da tre campi
    // diversi indovinando quanto vale una falsa partenza.
    const base = {
        x: 0, z: 0, angle: 0, trackIndex: 0, speed: 0, inputs: { throttle: 0, brake: 0, steer: 0 },
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        compound: 'medium', tyreWear: 0, damage: 0, collisionPenaltyMs: 0,
    };
    const casi = [
        ['pulito',                        { ...base },                                                        0],
        ['falsa partenza da scontare',    { ...base, falseStart: true },                                   5000],
        ["falsa partenza gia' scontata", { ...base, falseStart: true, falseStartServed: true },              0],
        ['solo collisioni',               { ...base, collisionPenaltyMs: 3000 },                           3000],
        ["tutt'e due",                  { ...base, falseStart: true, collisionPenaltyMs: 3000 },          8000],
    ];
    for (const [che, p, atteso] of casi) {
        const out = P.buildPublicState({ red: p }, false, null, { raceTick: 0 });
        assert.equal(out.red.penaltyPendingMs, atteso, `${che}`);
    }
});

// ═══════════ IL GIRO VELOCE ═══════════

function garaConTraguardo() {
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
    return {
        track: { points, lapLength: n, startFinishIndex: 0 },
        phase: 'race', raceTick: 0, bestSectorTimes: [Infinity, Infinity, Infinity],
    };
}

// Fa chiudere UN giro a `p`, attraversando il traguardo all'istante `finiscoA`.
function chiudiGiro(p, game, partitoA, finiscoA) {
    p.lapStartMs = partitoA;
    p.checkpointA = true;
    p.inFinishZone = false;
    p.trackIndex = 0;
    game.raceTick = Math.round(finiscoA / P.PHYSICS_TICK_MS) + 1;
    P.checkLap(p, 50, ioFinto(), 'L', game);
}

test('chiudere un giro registra il tempo sul giro, e il record della gara', () => {
    const game = garaConTraguardo();
    const p = { color: 'red', lap: 0, checkpointA: false, inFinishZone: false, trackIndex: 0 };

    chiudiGiro(p, game, 0, 48000);
    assert.equal(p.lap, 1, 'presupposto: il giro deve contare');
    // ⚠️ Una tolleranza di un tick, e non e' lassismo: l'istante di
    // attraversamento e' interpolato DENTRO il tick da 50 ms
    // (computeFinishCrossingFraction), quindi il fixture non puo' produrre un
    // tempo al millesimo. Pretenderlo esatto misura il fixture, non il codice.
    assert.ok(Math.abs(p.bestLapMs - 48000) <= P.PHYSICS_TICK_MS,
        `miglior giro personale: ${p.bestLapMs}, atteso 48000 +- un tick`);
    assert.equal(game.fastestLap.color, 'red');
    assert.equal(game.fastestLap.ms, p.bestLapMs,
        'il record di gara e il personale devono essere lo STESSO giro');
});

test('il giro veloce passa di mano solo a chi lo batte davvero', () => {
    const game = garaConTraguardo();
    const rosso = { color: 'red', lap: 0, checkpointA: false, inFinishZone: false, trackIndex: 0 };
    const blu = { color: 'blue', lap: 0, checkpointA: false, inFinishZone: false, trackIndex: 0 };

    chiudiGiro(rosso, game, 0, 48000);
    chiudiGiro(blu, game, 0, 49500);
    assert.equal(game.fastestLap.color, 'red', 'un giro piu\' lento non toglie niente a nessuno');

    chiudiGiro(blu, game, 49500, 96900);   // ~47400: piu' veloce
    assert.equal(game.fastestLap.color, 'blue');
    assert.equal(game.fastestLap.ms, blu.bestLapMs);
    assert.ok(blu.bestLapMs < rosso.bestLapMs,
        `il giro del blu (${blu.bestLapMs}) doveva battere quello del rosso (${rosso.bestLapMs})`);

    // E il personale del rosso resta il suo, non diventa quello della gara.
    assert.ok(Math.abs(rosso.bestLapMs - 48000) <= P.PHYSICS_TICK_MS);
});

test('il giro veloce non si misura in qualifica', () => {
    // In qualifica si corre un giro secco e il tempo e' gia' il risultato:
    // un «giro veloce» li' sarebbe l'unico giro di tutti.
    const game = garaConTraguardo();
    game.phase = 'quali';
    const p = { color: 'red', lap: 0, checkpointA: false, inFinishZone: false, trackIndex: 0 };
    chiudiGiro(p, game, 0, 48000);
    assert.equal(p.bestLapMs, undefined);
    assert.equal(game.fastestLap, undefined);
});

test('buildPublicState segna il giro veloce SOLO a chi lo detiene', () => {
    const base = {
        x: 0, z: 0, angle: 0, trackIndex: 0, speed: 0, inputs: { throttle: 0, brake: 0, steer: 0 },
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        compound: 'medium', tyreWear: 0, damage: 0, collisionPenaltyMs: 0,
    };
    const game = { raceTick: 0, fastestLap: { color: 'blue', ms: 47400 } };
    const out = P.buildPublicState({ red: { ...base }, blue: { ...base } }, false, null, game);
    assert.equal(out.blue.fastestLap, true);
    assert.equal(out.red.fastestLap, false);
});

test('senza nessun giro chiuso, nessuno ha il giro veloce', () => {
    const base = {
        x: 0, z: 0, angle: 0, trackIndex: 0, speed: 0, inputs: { throttle: 0, brake: 0, steer: 0 },
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        compound: 'medium', tyreWear: 0, damage: 0, collisionPenaltyMs: 0,
    };
    const out = P.buildPublicState({ red: base }, false, null, { raceTick: 0 });
    assert.equal(out.red.fastestLap, false);
});
