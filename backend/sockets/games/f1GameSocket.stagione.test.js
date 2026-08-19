// backend/sockets/games/f1GameSocket.stagione.test.js
//
// In formato stagione il weekend NON deve partire da solo: prima si sceglie
// (o si crea) il campionato, e solo dopo si va alla scelta mescole.
//
// Il rischio vero non e' la fase sbagliata in se': e' che la scelta mescole
// parta comunque e la sua SCADENZA porti tutti in qualifica mentre chi ospita
// sta ancora scrivendo il nome del campionato. Per questo il test lascia
// passare dieci minuti di orologio finto e controlla che non si sia mosso
// niente.
const test = require('node:test');
const assert = require('node:assert/strict');
const { lobbies, creaGettone } = require('../../store/lobbies.js');
const { activeGames } = require('../../store/activeGames.js');
const registraHandlerF1 = require('./f1GameSocket.js');

const LOBBY = 'TESTFORMATO';

function ioFinto() {
    const inviati = [];
    return { inviati, to: (dest) => ({ emit: (evento, dati) => inviati.push({ dest, evento, dati }) }) };
}

function collega(io) {
    const handlers = {};
    const socket = {
        id: 'sock-' + Math.random().toString(36).slice(2),
        data: {}, emessi: [], handlers,
        on(e, cb) { handlers[e] = cb; },
        emit(e, d) { this.emessi.push({ evento: e, dati: d }); },
        join() { },
    };
    registraHandlerF1(io, socket);
    return socket;
}

function pulisci() {
    const g = activeGames.get(LOBBY);
    if (g) {
        if (g.tick) clearInterval(g.tick);
        ['tyreSelectTimeout', 'qualiEndTimeout', 'endTimeout', 'chiusuraTimeout']
            .forEach(k => { if (g[k]) clearTimeout(g[k]); });
        Object.values(g.rejoinTimers || {}).forEach(clearTimeout);
    }
    activeGames.delete(LOBBY);
    lobbies.delete(LOBBY);
}

function entra(io, formato) {
    lobbies.set(LOBBY, {
        host: 'red', players: ['red'], lockedPlayers: ['red'],
        gameSettings: { trackId: 'prova', botsEnabled: 'false', gridSize: '4', formato },
    });
    const a = collega(io);
    a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', uid: 'uid-andrea', token: creaGettone(LOBBY, 'red') });
    return a;
}

test('in formato stagione la partita nasce in fase "stagione", non alla scelta mescole', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    const a = entra(io, 'stagione');

    const g = activeGames.get(LOBBY);
    assert.equal(g.phase, 'stagione');
    assert.equal(g.formato, 'stagione');

    const setup = a.emessi.find(m => m.evento === 'f1Setup');
    assert.equal(setup.dati.formato, 'stagione', 'il client deve sapere in che formato e\' entrato');

    // Il tempo passa: nessuna scadenza deve spingere avanti la sessione.
    t.mock.timers.tick(10 * 60 * 1000);
    assert.equal(g.phase, 'stagione', 'niente puo\' portare avanti la sessione finche\' non lo chiede chi ospita');
});

test('in gara veloce non cambia niente: si parte dalla scelta mescole come sempre', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    entra(io, 'veloce');
    assert.equal(activeGames.get(LOBBY).phase, 'tyre_select');
});

test('senza formato dichiarato si corre come si e\' sempre corso', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    entra(io, undefined);
    assert.equal(activeGames.get(LOBBY).phase, 'tyre_select');
});

test('la stagione scelta da chi ospita arriva a tutti, e solo lui puo\' sceglierla', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    const a = entra(io, 'stagione');

    // Un secondo pilota, che non ospita.
    lobbies.get(LOBBY).players.push('blue');
    lobbies.get(LOBBY).lockedPlayers.push('blue');
    const b = collega(io);
    b.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'blue', uid: 'uid-amico', token: creaGettone(LOBBY, 'blue') });

    io.inviati.length = 0;
    b.handlers.f1StagioneScelta({ lobbyId: LOBBY, stagioneId: 'abusiva' });
    assert.equal(io.inviati.filter(m => m.evento === 'f1StagioneScelta').length, 0,
        'chi non ospita non decide quale campionato si corre');
    assert.equal(activeGames.get(LOBBY).stagioneId, null);

    a.handlers.f1StagioneScelta({ lobbyId: LOBBY, stagioneId: 'stag-1' });
    const annunci = io.inviati.filter(m => m.evento === 'f1StagioneScelta');
    assert.equal(annunci.length, 1);
    assert.equal(annunci[0].dest, LOBBY, 'l\'annuncio va a tutta la lobby');
    assert.equal(annunci[0].dati.stagioneId, 'stag-1');
    assert.equal(activeGames.get(LOBBY).stagioneId, 'stag-1');
});

test('in fase stagione nessuna auto va in scena: non si e ancora in pista', (t) => {
    // Segnalato al playtest: "alla fine del caricamento si sente rumore di
    // motori". Il client fa suonare il motore di ogni auto che riceve, e in
    // fase 'stagione' le riceveva tutte — per giunta impilate sullo stesso
    // punto, perche' nessuno le ha ancora schierate. La scelta mescole aveva
    // gia' questa regola (non si e' in pista, non si vede nessuno); la fase
    // nuova non la conosceva.
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    lobbies.set(LOBBY, {
        host: 'red', players: ['red'], lockedPlayers: ['red'],
        gameSettings: { trackId: 'prova', botsEnabled: 'true', gridSize: '6', formato: 'stagione' },
    });
    const a = collega(io);
    a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', uid: 'uid-andrea', token: creaGettone(LOBBY, 'red') });

    const g = activeGames.get(LOBBY);
    assert.ok(Object.keys(g.players).length > 1, 'la partita ha davvero dei bot, se no il test non prova niente');

    const setup = a.emessi.find(m => m.evento === 'f1Setup');
    assert.deepEqual(Object.keys(setup.dati.players), [], 'f1Setup non deve portare nessuna auto');

    io.inviati.length = 0;
    t.mock.timers.tick(500);
    for (const m of io.inviati.filter(m => m.evento === 'f1StateUpdate')) {
        const colori = Object.keys(m.dati).filter(k => !k.startsWith('__'));
        assert.deepEqual(colori, [], `lo stato porta ${colori.join(', ')}: in campionato non si e ancora in pista`);
    }
});
