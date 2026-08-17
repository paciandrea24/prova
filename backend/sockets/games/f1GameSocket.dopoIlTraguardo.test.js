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

// ═══════════ LA GUARDIA SUGLI INPUT GUARDA LA SESSIONE CORRENTE ═══════════
//
// Regressione trovata al playtest: in gara l'auto non partiva ai semafori
// spenti. Il rifiuto degli input era legato a `qualiEnded || raceEnded`, ma
// `qualiEnded` resta vero per TUTTA la gara — la qualifica è finita davvero —
// quindi ogni comando veniva buttato via.
test('in gara i comandi valgono anche se la qualifica e finita', (t) => {
    t.after(pulisci);
    const { g, handlers } = partita();
    g.qualiEnded = true;     // la qualifica è alle spalle, com'è normale in gara
    g.raceEnded = false;
    g.phase = 'race';

    handlers.f1Input({ lobbyId: LOBBY, playerColor: 'red', inputs: { throttle: 1, brake: 0, steer: 0 } });
    assert.equal(g.players.red.inputs.throttle, 1,
        'il comando è stato ignorato: ai semafori spenti l\'auto non partirebbe');
});

test('a gara CHIUSA i comandi tornano ignorati', (t) => {
    t.after(pulisci);
    const { g, handlers } = partita();
    g.phase = 'race';
    g.raceEnded = true;
    g.players.red.inputs = { throttle: 0, brake: 0, steer: 0 };

    handlers.f1Input({ lobbyId: LOBBY, playerColor: 'red', inputs: { throttle: 1, brake: 0, steer: 0 } });
    // È la protezione storica: un acceleratore tenuto premuto durante
    // l'attesa veniva letto come falsa partenza al via successivo.
    assert.equal(g.players.red.inputs.throttle, 0);
});

// ═══════════ FINESTRA DI CORTESIA DI FINE GARA ═══════════
//
// Quando gli umani hanno finito la gara non chiude subito: resta aperta 30
// secondi in cui tutti continuano a girare e i bot ancora in pista possono
// tagliare il traguardo per davvero, prendendo il tempo VERO invece di quello
// proiettato. Misurato con una gara di soli bot, fra il primo e l'ultimo
// arrivato passano 76 s su "prova" e 6 su monte-rosso: aspettare tutti non è
// ragionevole, aspettare un po' sì.
test('la gara non chiude nell istante in cui l umano taglia il traguardo', (t) => {
    t.after(pulisci);
    const { g } = partita();
    g.players.red.finished = true;
    g.players.red.time = 60000;
    // Un bot ancora in pista.
    g.players.bot1 = { ...g.players.red, color: 'bot1', isBot: true, finished: false, time: null,
                       carContacts: new Set(), pendingCollisionPenaltyEvents: [],
                       inputs: { throttle: 0, brake: 0, steer: 0 } };

    f1.tickGame(ioFinto, LOBBY, g);
    assert.equal(g.raceEnded, false, 'ha chiuso subito: niente giro di rientro');
    assert.ok(g.raceGraceEndTick > g.raceTick, 'la finestra di cortesia deve essere aperta');
});

test('la finestra si chiude da sola alla scadenza', (t) => {
    t.after(pulisci);
    const { g } = partita();
    g.players.red.finished = true;
    g.players.red.time = 60000;
    g.players.bot1 = { ...g.players.red, color: 'bot1', isBot: true, finished: false, time: null,
                       carContacts: new Set(), pendingCollisionPenaltyEvents: [],
                       inputs: { throttle: 0, brake: 0, steer: 0 } };

    f1.tickGame(ioFinto, LOBBY, g);
    g.raceGraceEndTick = g.raceTick;   // scadenza raggiunta
    f1.tickGame(ioFinto, LOBBY, g);
    assert.equal(g.raceEnded, true);
});

test('chi non ha finito riceve un tempo proiettato, mai un vuoto', (t) => {
    t.after(pulisci);
    const emessi = [];
    const ioSpia = { to: () => ({ emit: (evento, dati) => emessi.push({ evento, dati }) }) };
    const { g } = partita();
    g.raceTick = 1200;   // 60 secondi di gara
    g.players.red.finished = true;
    g.players.red.time = 60000;
    g.players.bot1 = { ...g.players.red, color: 'bot1', isBot: true, finished: false, time: null,
                       lap: 1, trackIndex: 200,
                       carContacts: new Set(), pendingCollisionPenaltyEvents: [],
                       inputs: { throttle: 0, brake: 0, steer: 0 } };

    f1.physics.endRace ? f1.physics.endRace(ioSpia, LOBBY, g) : null;
    // endRace non è esportata: si passa dal gate, chiudendo la finestra.
    if (!g.raceEnded) {
        g.raceGraceEndTick = 1;
        f1.tickGame(ioSpia, LOBBY, g);
    }

    const fine = emessi.find(e => e.evento === 'f1RaceEnded');
    assert.ok(fine, 'la gara deve chiudersi');
    const voce = fine.dati.podium.find(v => v.color === 'bot1');
    assert.ok(voce, 'chi non ha finito deve comparire in classifica');
    assert.ok(Number.isFinite(voce.totalTime) && voce.totalTime > 0,
        `tempo non utilizzabile in un campionato: ${voce.totalTime}`);
    assert.equal(voce.stimato, true, 'va marcato come proiezione, non spacciato per cronometrato');
});

// ═══════════ LE PENALITÀ VALGONO ANCHE PER CHI NON HA FINITO ═══════════
//
// Segnalazione dell'utente (2026-08-17): primo sotto la bandiera a scacchi con
// 43 secondi, classificato dietro a bot dati per ~50. I suoi 43 diventavano 73
// per i 30 secondi del pit stop mai fatto; i bot, ancora in pista alla
// chiusura, prendevano un tempo PROIETTATO su cui quella stessa penalità non
// veniva mai applicata. Due strade diverse per la stessa regola.
test('chi non ha finito e non si e fermato ai box porta comunque i suoi 30 secondi', (t) => {
    t.after(pulisci);
    const emessi = [];
    const ioSpia = { to: () => ({ emit: (evento, dati) => emessi.push({ evento, dati }) }) };
    const { g } = partita();
    g.raceTick = 1200;   // 60 secondi di gara
    g.players.red.finished = true;
    g.players.red.time = 60000;
    const base = {
        ...g.players.red, isBot: true, finished: false, time: null, lap: 1, trackIndex: 200,
        carContacts: new Set(), pendingCollisionPenaltyEvents: [],
        inputs: { throttle: 0, brake: 0, steer: 0 },
    };
    g.players.fermato = { ...base, color: 'fermato', hasPitted: true };
    g.players.dritto = { ...base, color: 'dritto', hasPitted: false };

    g.raceGraceEndTick = 1;
    f1.tickGame(ioSpia, LOBBY, g);

    const podio = emessi.find(e => e.evento === 'f1RaceEnded').dati.podium;
    const conSosta = podio.find(v => v.color === 'fermato');
    const senzaSosta = podio.find(v => v.color === 'dritto');
    assert.equal(senzaSosta.pitPenalty, true, 'la penalità deve comparire anche in classifica');
    assert.equal(senzaSosta.totalTime - conSosta.totalTime, 30000,
        `a pari progresso lo scarto deve essere esattamente la penalità: ` +
        `${senzaSosta.totalTime} contro ${conSosta.totalTime}`);
});
