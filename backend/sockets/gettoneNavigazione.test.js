// backend/sockets/gettoneNavigazione.test.js
//
// Il gettone di sessione deve sopravvivere a una DISCONNESSIONE.
//
// Segnalato in playtest, dopo una gara di campionato: si torna in lobby dal
// podio, si riparte, e il terminale stampa "joinF1Game senza sessione valida".
// La pagina restava in caricamento per sempre e la scena si fermava a meta',
// con la camera dentro il terreno.
//
// I log del server, che l'hanno chiusa:
//
//   Utente qUtp3i8 (#E74C3C) e' entrato nella lobby: D48OPO   <- socket NUOVO
//   Client disconnesso: KpKQpuwaMK4aolXX                      <- muore il VECCHIO
//   Lobby D48OPO vuota. Distruzione tra 5 secondi...
//   Lobby D48OPO distrutta definitivamente.
//   joinLobby rifiutato: gettone non valido per #E74C3C
//
// Due difetti, uno dentro l'altro.
//
// 1. IDENTITA', NON ESISTENZA. Il socket che muore agiva sul proprio COLORE
//    senza chiedersi se quel colore fosse ancora suo. Navigando, il socket
//    della pagina nuova si registra PRIMA che muoia quello della pagina
//    vecchia: il morto si portava via il posto del vivo, la lista restava
//    vuota e la lobby veniva distrutta con dentro un giocatore collegato.
//
// 2. IL GETTONE. Anche senza la corsa sopra, il disconnect cancellava il
//    gettone — l'unica cosa che permette di rientrare. joinLobby ha da sempre
//    un ramo che riaggiunge chi torna dopo un F5, ramo che senza gettone non
//    e' raggiungibile: si contraddicevano a vicenda. Un gettone e' un segreto
//    della SCHEDA di quel giocatore: finche' la stanza esiste, chi lo presenta
//    e' lui. Si dimentica quando la lobby muore e quando qualcuno viene
//    espulso, non quando una pagina si chiude.
const test = require('node:test');
const assert = require('node:assert/strict');

const { lobbies, creaGettone, verificaGettone, dimenticaLobby } = require('../store/lobbies.js');
const { activeGames } = require('../store/activeGames.js');
const socketManager = require('./socketManager.js');

const LOBBY = 'TESTGETT';
const HOST = '#E74C3C';
const OSPITE = '#3498DB';

function ioFinto() {
    const inviati = [];
    return {
        inviati,
        connessione: null,
        on(evento, cb) { if (evento === 'connection') this.connessione = cb; },
        to(stanza) { return { emit: (evento, dati) => inviati.push({ stanza, evento, dati }) }; },
    };
}

function collega(io) {
    const gestori = {};
    const filtri = [];
    const socket = {
        id: 'sock-' + Math.random().toString(36).slice(2),
        data: {},
        emessi: [],
        // Gli handler si ACCUMULANO: socketManager registra il suo disconnect
        // e poi ogni modulo di gioco registra il proprio. Tenendo solo
        // l'ultimo, un test crederebbe di aver disconnesso un giocatore
        // mentre in realta' ha chiamato tutt'altro — ci sono cascato.
        on(evento, cb) { (gestori[evento] = gestori[evento] || []).push(cb); },
        use(fn) { filtri.push(fn); },
        emit(evento, dati) { this.emessi.push({ evento, dati }); },
        join() { },
        manda(evento, dati) {
            let i = 0;
            const avanti = () => {
                if (i < filtri.length) return filtri[i++]([evento, dati], avanti);
                if (gestori[evento]) gestori[evento].forEach(fn => fn(dati));
            };
            avanti();
        },
    };
    io.connessione(socket);
    return socket;
}

function pulisci() {
    lobbies.delete(LOBBY);
    dimenticaLobby(LOBBY);
    activeGames.delete(LOBBY);
}

test('il socket vecchio che muore non porta via il posto di quello nuovo', (t) => {
    // La corsa dei log: navigando da una pagina all'altra della stessa lobby,
    // il socket della pagina nuova si registra PRIMA che muoia quello della
    // vecchia. Chi muore non e' piu' il proprietario di quel colore.
    t.after(pulisci);
    lobbies.set(LOBBY, { id: LOBBY, host: HOST, players: [HOST], gameSettings: null });
    const gettone = creaGettone(LOBBY, HOST);
    const io = ioFinto();
    socketManager(io);

    const vecchio = collega(io);
    vecchio.manda('joinLobby', { lobbyId: LOBBY, color: HOST, token: gettone });

    const nuovo = collega(io);
    nuovo.manda('joinLobby', { lobbyId: LOBBY, color: HOST, token: gettone });

    // Solo ORA muore quello vecchio.
    vecchio.manda('disconnect');

    assert.deepEqual(lobbies.get(LOBBY).players, [HOST],
        'il giocatore e collegato: la lobby non puo risultare vuota');
    assert.equal(verificaGettone(LOBBY, HOST, gettone), true,
        'e il suo gettone deve valere ancora');
});

test('chi naviga fra le pagine della stessa lobby non perde il gettone', (t) => {
    t.after(pulisci);
    lobbies.set(LOBBY, { id: LOBBY, host: HOST, players: [HOST], gameSettings: null });
    const gettone = creaGettone(LOBBY, HOST);
    const io = ioFinto();
    socketManager(io);

    // Si e' nella pagina di gioco, la partita e' finita e il pulsante del podio
    // l'ha gia' chiusa (activeGames vuota). Poi il browser naviga verso la
    // lobby e il socket della pagina di gioco muore.
    const inGioco = collega(io);
    inGioco.manda('joinLobby', { lobbyId: LOBBY, color: HOST, token: gettone });
    inGioco.manda('disconnect');

    assert.equal(verificaGettone(LOBBY, HOST, gettone), true,
        'il gettone deve valere ancora: e la sola cosa che permette di rientrare');
});

test('rientrando dopo la disconnessione si torna nella lista dei giocatori', (t) => {
    t.after(pulisci);
    lobbies.set(LOBBY, { id: LOBBY, host: HOST, players: [HOST], gameSettings: null });
    const gettone = creaGettone(LOBBY, HOST);
    const io = ioFinto();
    socketManager(io);

    const primo = collega(io);
    primo.manda('joinLobby', { lobbyId: LOBBY, color: HOST, token: gettone });
    primo.manda('disconnect');

    // La pagina nuova si collega e si ripresenta con lo stesso gettone.
    const secondo = collega(io);
    secondo.manda('joinLobby', { lobbyId: LOBBY, color: HOST, token: gettone });

    assert.equal(secondo.emessi.filter(m => m.evento === 'sessioneNonValida').length, 0,
        'nessun rifiuto: e lo stesso giocatore di prima');
    assert.ok(lobbies.get(LOBBY).players.includes(HOST),
        'e torna nella lista, che e proprio quello che quel ramo di joinLobby serve a fare');
});

test('chi viene espulso perde il gettone, e non puo rientrare', (t) => {
    t.after(pulisci);
    lobbies.set(LOBBY, { id: LOBBY, host: HOST, players: [HOST, OSPITE], gameSettings: null });
    const gettoneHost = creaGettone(LOBBY, HOST);
    const gettoneOspite = creaGettone(LOBBY, OSPITE);
    const io = ioFinto();
    socketManager(io);

    const host = collega(io);
    host.manda('joinLobby', { lobbyId: LOBBY, color: HOST, token: gettoneHost });
    host.manda('kickPlayer', { lobbyId: LOBBY, targetColor: OSPITE });

    assert.equal(verificaGettone(LOBBY, OSPITE, gettoneOspite), false,
        'l espulsione e proprio il caso in cui un gettone va dimenticato');
});
