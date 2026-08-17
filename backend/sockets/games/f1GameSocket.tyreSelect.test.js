// backend/sockets/games/f1GameSocket.tyreSelect.test.js
//
// Attesa dei piloti ancora in caricamento durante la fase di scelta mescola.
//
// Il difetto che questi test proteggono (segnalato in playtest con due
// schede): il server faceva partire la qualifica quando avevano confermato
// "tutti", ma "tutti" erano solo i piloti GIÀ collegati. Se la prima scheda
// sceglieva mentre la seconda stava ancora caricando la pista, la seconda
// arrivava a qualifica già iniziata e non sceglieva mai la mescola.
//
// La lista di chi è atteso è `lobby.lockedPlayers`, la fotografia della lobby
// scattata da `startGame` — la stessa che f1Bot.js usa già per sapere quanti
// bot servono, non una fonte nuova.
const test = require('node:test');
const assert = require('node:assert/strict');
const { lobbies } = require('../../store/lobbies.js');
const { activeGames } = require('../../store/activeGames.js');
const registraHandlerF1 = require('./f1GameSocket.js');

const LOBBY = 'TESTTYRE';

function ioFinto() {
    return { to: () => ({ emit: () => { } }) };
}

// Un client: registra gli handler del gioco su un socket finto che tiene
// traccia di ciò che gli viene inviato (serve a leggere la fase in f1Setup).
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

function preparaLobby(colori) {
    lobbies.set(LOBBY, {
        host: colori[0],
        players: [...colori],
        lockedPlayers: [...colori],
        // Niente bot: la partenza anticipata va misurata sui soli umani.
        gameSettings: { trackId: 'prova', botsEnabled: 'false' },
    });
}

// I timer veri (tick di gioco, scadenza scelta mescola) vanno spenti a mano,
// altrimenti il processo di test resta appeso fino alla loro scadenza.
function pulisci() {
    const g = activeGames.get(LOBBY);
    if (g) {
        if (g.tick) clearInterval(g.tick);
        if (g.tyreSelectTimeout) clearTimeout(g.tyreSelectTimeout);
        if (g.qualiEndTimeout) clearTimeout(g.qualiEndTimeout);
        if (g.endTimeout) clearTimeout(g.endTimeout);
        Object.values(g.rejoinTimers || {}).forEach(clearTimeout);
    }
    activeGames.delete(LOBBY);
    lobbies.delete(LOBBY);
}

test('la qualifica NON parte finché un pilota della lobby sta ancora caricando', (t) => {
    t.after(pulisci);
    preparaLobby(['red', 'blue']);
    const io = ioFinto();

    const primo = collega(io);
    primo.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red' });
    primo.handlers.f1TyreChoice({ lobbyId: LOBBY, playerColor: 'red', compound: 'soft' });

    assert.equal(activeGames.get(LOBBY).phase, 'tyre_select',
        'con "blue" ancora in caricamento la scelta mescola deve restare aperta');
});

test('la qualifica parte quando il pilota in ritardo arriva e sceglie', (t) => {
    t.after(pulisci);
    preparaLobby(['red', 'blue']);
    const io = ioFinto();

    const primo = collega(io);
    primo.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red' });
    primo.handlers.f1TyreChoice({ lobbyId: LOBBY, playerColor: 'red', compound: 'soft' });

    const secondo = collega(io);
    secondo.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'blue' });
    assert.equal(activeGames.get(LOBBY).phase, 'tyre_select',
        'appena arrivato deve poter ancora scegliere');

    secondo.handlers.f1TyreChoice({ lobbyId: LOBBY, playerColor: 'blue', compound: 'hard' });
    assert.equal(activeGames.get(LOBBY).phase, 'qualifying',
        'scelto da entrambi, si parte');
});

test('il pilota in ritardo riceve la fase di scelta mescola, non la qualifica', (t) => {
    t.after(pulisci);
    preparaLobby(['red', 'blue']);
    const io = ioFinto();

    const primo = collega(io);
    primo.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red' });
    primo.handlers.f1TyreChoice({ lobbyId: LOBBY, playerColor: 'red', compound: 'soft' });

    const secondo = collega(io);
    secondo.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'blue' });

    const setup = secondo.emessi.find(e => e.evento === 'f1Setup');
    assert.ok(setup, 'il secondo client deve ricevere f1Setup');
    assert.equal(setup.dati.phase, 'tyre_select');
});

test('f1Setup elenca chi è atteso e chi è già arrivato, per mostrare gli assenti', (t) => {
    t.after(pulisci);
    preparaLobby(['red', 'blue']);
    const io = ioFinto();

    const primo = collega(io);
    primo.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red' });

    const setup = primo.emessi.find(e => e.evento === 'f1Setup');
    assert.deepEqual(setup.dati.tyreAttesi, ['red', 'blue']);
    assert.deepEqual(setup.dati.tyreArrivati, ['red']);
});

test('rete di sicurezza: chi non arriva mai non blocca la gara per sempre', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    preparaLobby(['red', 'blue']);
    const io = ioFinto();

    const primo = collega(io);
    primo.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red' });
    primo.handlers.f1TyreChoice({ lobbyId: LOBBY, playerColor: 'red', compound: 'soft' });
    assert.equal(activeGames.get(LOBBY).phase, 'tyre_select');

    // "blue" non arriva mai: alla scadenza si parte comunque.
    t.mock.timers.tick(60000);
    assert.equal(activeGames.get(LOBBY).phase, 'qualifying');
});
