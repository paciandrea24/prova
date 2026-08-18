// backend/sockets/games/f1GameSocket.rientroInLobby.test.js
//
// Chiusura della partita al rientro in lobby.
//
// Il difetto che questi test proteggono (segnalato in playtest: "se ritorno
// in lobby e poi provo ad avviare di nuovo una gara si bugga"). In
// multiplayer il podio finale riporta in lobby da solo, con un
// `window.location.href` a fine conto alla rovescia — e basta: nessun evento
// diceva al server che la sessione era finita. `f1ReturnToLobby`, che è
// l'unico punto in cui la partita viene davvero smontata, lo emette solo il
// pulsante della modalità singolo.
//
// Riprodotto headless: la partita conclusa restava in `activeGames`, quindi
// il `joinF1Game` della gara successiva trovava `activeGames.has(lobbyId)`
// vero e NON ne creava una nuova. Tutti rientravano nella gara finita —
// fase `race_end`, piloti ancora `finished`, tempi e griglia della gara
// precedente, e persino la pista vecchia (cambiarla in lobby non aveva
// effetto). In più i timer di riconnessione di quella partita restavano
// armati: 60 secondi dopo il rientro `hardRemoveF1Player` toglieva i
// giocatori da `lobby.players` mentre erano seduti in lobby, svuotando la
// lista e riassegnando l'host.
const test = require('node:test');
const assert = require('node:assert/strict');
const { lobbies } = require('../../store/lobbies.js');
const { activeGames } = require('../../store/activeGames.js');
const registraHandlerF1 = require('./f1GameSocket.js');

const LOBBY = 'TESTRIENTRO';

function ioFinto() {
    return { to: () => ({ emit: () => { } }) };
}

function collega(io) {
    const handlers = {};
    const socket = {
        id: 'sock-' + Math.random().toString(36).slice(2),
        data: {},
        emessi: [],
        handlers,
        on(evento, cb) { handlers[evento] = cb; },
        emit(evento, dati) { this.emessi.push({ evento, dati }); },
        join() { },
    };
    registraHandlerF1(io, socket);
    return socket;
}

function preparaLobby(colori, extra = {}) {
    lobbies.set(LOBBY, {
        host: colori[0],
        players: [...colori],
        lockedPlayers: [...colori],
        gameSettings: { trackId: 'prova', botsEnabled: 'false', ...extra },
    });
}

function pulisci() {
    const g = activeGames.get(LOBBY);
    if (g) {
        if (g.tick) clearInterval(g.tick);
        if (g.tyreSelectTimeout) clearTimeout(g.tyreSelectTimeout);
        if (g.qualiEndTimeout) clearTimeout(g.qualiEndTimeout);
        if (g.endTimeout) clearTimeout(g.endTimeout);
        if (g.chiusuraTimeout) clearTimeout(g.chiusuraTimeout);
        Object.values(g.rejoinTimers || {}).forEach(clearTimeout);
    }
    activeGames.delete(LOBBY);
    lobbies.delete(LOBBY);
}

// Porta una partita appena creata fino alla bandiera a scacchi, senza
// simulare la gara: i test qui riguardano ciò che succede DOPO.
function faiFinireLaGara(io, colori) {
    const g = activeGames.get(LOBBY);
    g.phase = 'race';
    g.grid = [...colori];
    for (const p of Object.values(g.players)) {
        p.finished = true;
        p.time = 60000;
        p.lap = g.track.totalLaps;
    }
    registraHandlerF1.endRace(io, LOBBY, g);
    return g;
}

test('finita una gara multiplayer il server chiude la partita da solo', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    preparaLobby(['red', 'blue']);
    const io = ioFinto();

    const a = collega(io); a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red' });
    const b = collega(io); b.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'blue' });
    faiFinireLaGara(io, ['red', 'blue']);

    // Il client naviga verso la lobby a fine conto alla rovescia: il socket
    // muore senza emettere nulla.
    a.handlers.disconnect();
    b.handlers.disconnect();

    t.mock.timers.tick(60000);
    assert.equal(activeGames.has(LOBBY), false,
        'la partita conclusa deve sparire da activeGames senza aspettare che il client lo chieda');
});

test('riavviare una gara dopo il rientro in lobby parte da zero, sulla pista scelta', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    preparaLobby(['red', 'blue']);
    const io = ioFinto();

    const a = collega(io); a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red' });
    const b = collega(io); b.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'blue' });
    faiFinireLaGara(io, ['red', 'blue']);
    a.handlers.disconnect();
    b.handlers.disconnect();
    t.mock.timers.tick(60000);

    // In lobby l'host cambia pista e riavvia.
    lobbies.get(LOBBY).gameSettings.trackId = 'monte-rosso';
    const a2 = collega(io); a2.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red' });
    const b2 = collega(io); b2.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'blue' });

    const g = activeGames.get(LOBBY);
    assert.equal(g.phase, 'tyre_select', 'la nuova gara deve ripartire dalla scelta mescola');
    assert.equal(g.raceEnded, false, 'la nuova gara non puo nascere gia finita');
    assert.equal(g.track.id, 'monte-rosso', 'deve caricare la pista scelta in lobby, non quella della gara precedente');
    assert.equal(g.grid, null, 'la griglia della gara precedente non deve sopravvivere');
    assert.equal(g.players.red.finished, false, 'il pilota non puo ripartire gia arrivato');
    assert.equal(g.players.red.time, null, 'il tempo della gara precedente non deve sopravvivere');
    assert.equal(g.players.red.lap, 0, 'il conteggio giri deve ripartire da zero');
});

test('la partita chiusa non svuota la lobby un minuto dopo', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    preparaLobby(['red', 'blue']);
    const io = ioFinto();

    const a = collega(io); a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red' });
    const b = collega(io); b.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'blue' });
    faiFinireLaGara(io, ['red', 'blue']);
    a.handlers.disconnect();
    b.handlers.disconnect();

    // Oltre la grazia di riconnessione (60s): e li che scattava la rimozione.
    t.mock.timers.tick(120000);

    const lobby = lobbies.get(LOBBY);
    assert.deepEqual(lobby.players, ['red', 'blue'],
        'chi e rientrato in lobby non deve essere rimosso dai timer della partita finita');
    assert.equal(lobby.host, 'red', 'e l host non deve cambiare da solo');
});

test('chi abbandona DURANTE la gara viene comunque tolto dalla lobby', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    preparaLobby(['red', 'blue', 'green']);
    const io = ioFinto();

    const a = collega(io); a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red' });
    const b = collega(io); b.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'blue' });
    const c = collega(io); c.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'green' });

    // "green" chiude il browser a meta gara: non tornera in lobby.
    c.handlers.disconnect();
    faiFinireLaGara(io, ['red', 'blue', 'green']);
    a.handlers.disconnect();
    b.handlers.disconnect();
    t.mock.timers.tick(120000);

    const lobby = lobbies.get(LOBBY);
    assert.deepEqual(lobby.players, ['red', 'blue'],
        'chi se ne e andato prima della fine non deve restare come fantasma nella lista');
});

test('in modalita singolo la partita resta viva dopo il podio (serve a "Riprova")', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    preparaLobby(['red'], { mode: 'single' });
    const io = ioFinto();

    const a = collega(io); a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red' });
    faiFinireLaGara(io, ['red']);

    t.mock.timers.tick(60000);
    assert.equal(activeGames.has(LOBBY), true,
        'in singolo il podio resta a schermo e "Riprova" deve poter riusare la partita');
});
