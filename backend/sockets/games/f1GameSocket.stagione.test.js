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

test('Corri prepara la pista del calendario e manda tutti in pista', async (t) => {
    t.after(pulisci);
    const seasonStore = require('../../store/seasonStore.js');
    t.after(() => seasonStore._svuota());
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    const a = entra(io, 'stagione');

    const F1Stagione = require('../../../frontend/shared/f1Stagione.js');
    const stagione = await seasonStore.salva(F1Stagione.creaStagione({
        nome: 'Corsa', creataDa: 'uid-andrea',
        piloti: [
            { uid: 'uid-andrea', colore: 'red', bot: false },
            { uid: null, colore: '#111111', bot: true, nome: 'Bot 1' },
        ],
        calendario: ['new-monza', 'prova'],
        impostazioni: { botsEnabled: true, gridSize: 2 },
    }));

    a.handlers.f1StagioneScelta({ lobbyId: LOBBY, stagioneId: stagione._id });
    io.inviati.length = 0;
    await a.handlers.f1StagioneCorri({ lobbyId: LOBBY });

    const lobby = lobbies.get(LOBBY);
    assert.equal(lobby.gameSettings.trackId, 'new-monza', 'la pista e quella del calendario');
    assert.equal(lobby.gameSettings.stagioneInCorso, true);
    assert.equal(lobby.gameSettings.stagioneId, stagione._id);
    assert.ok((lobby.sessioneF1 || 0) > 0, 'la sessione va timbrata, o il rientro sembrera un F5');

    const annuncio = io.inviati.find(m => m.evento === 'f1StagioneInPista');
    assert.ok(annuncio, 'i client devono sapere che si va in pista');
    assert.equal(annuncio.dest, LOBBY);
});

test('la partita di una gara di campionato parte dal weekend, non dal calendario', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    lobbies.set(LOBBY, {
        host: 'red', players: ['red'], lockedPlayers: ['red'],
        gameSettings: {
            trackId: 'prova', botsEnabled: 'true', gridSize: '3',
            formato: 'stagione', stagioneId: 'stag-1', stagioneInCorso: true,
            botStagione: [{ colore: '#111111', nome: 'Bot 1' }, { colore: '#222222', nome: 'Bot 2' }],
        },
    });
    const a = collega(io);
    a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', uid: 'uid-andrea', token: creaGettone(LOBBY, 'red') });

    const g = activeGames.get(LOBBY);
    assert.equal(g.phase, 'tyre_select', 'si sta correndo una gara: il weekend parte come sempre');
    assert.equal(g.stagioneId, 'stag-1', 'ma la partita sa a quale campionato appartiene');
    const coloriBot = Object.values(g.players).filter(p => p.isBot).map(p => p.color).sort();
    assert.deepEqual(coloriBot, ['#111111', '#222222'], 'e i bot sono quelli della stagione');
});

test('solo chi ospita puo lanciare la gara', async (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    entra(io, 'stagione');
    lobbies.get(LOBBY).players.push('blue');
    lobbies.get(LOBBY).lockedPlayers.push('blue');
    const b = collega(io);
    b.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'blue', uid: 'uid-amico', token: creaGettone(LOBBY, 'blue') });

    io.inviati.length = 0;
    await b.handlers.f1StagioneCorri({ lobbyId: LOBBY });
    assert.equal(io.inviati.filter(m => m.evento === 'f1StagioneInPista').length, 0);
});
