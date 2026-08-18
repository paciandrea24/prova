// backend/sockets/identitaLobby.test.js
//
// L'invariante che questi test proteggono: **in una lobby si è chi si è
// dimostrato di essere, non chi si dichiara**.
//
// Prima l'identità di un giocatore era il suo colore, e il colore è pubblico:
// sta nella lista che il server manda a tutti quelli nella stanza
// (`lobbyUpdated`) e in GET /api/lobby/:id. I controlli però erano scritti
// così:
//
//     socket.on('kickPlayer', ({ lobbyId, hostColor, targetColor }) => {
//         if (lobby && lobby.host === hostColor) { ...espelle... }
//
// cioè "il colore che mi hai mandato è quello dell'host?" — vero per chiunque
// sapesse chi fosse l'host, cioè per tutti. Bastava un messaggio per
// espellere gli altri, e uno per prendersi la stanza.
//
// Ora il server consegna un gettone a chi crea o entra in una lobby, e da
// quel momento chi sei lo sa lui.
const test = require('node:test');
const assert = require('node:assert/strict');

const { lobbies, creaGettone, verificaGettone, dimenticaLobby } = require('../store/lobbies.js');
const socketManager = require('./socketManager.js');

const LOBBY = 'TESTID';
const HOST = '#E74C3C';
const OSPITE = '#3498DB';

function ioFinto() {
    const inviati = [];
    return {
        inviati,
        connessione: null,
        on(evento, cb) { if (evento === 'connection') this.connessione = cb; },
        to(stanza) {
            return { emit: (evento, dati) => inviati.push({ stanza, evento, dati }) };
        }
    };
}

// Un socket finto con la stessa superficie che usa socketManager: `use` per i
// filtri, `on` per i gestori, `emit` per quello che torna indietro al singolo
// client.
function collega(io) {
    const gestori = {};
    const filtri = [];
    const socket = {
        id: 'sock-' + Math.random().toString(36).slice(2),
        data: {},
        emessi: [],
        on(evento, cb) { gestori[evento] = cb; },
        use(fn) { filtri.push(fn); },
        emit(evento, dati) { this.emessi.push({ evento, dati }); },
        join() { },
        // Manda un evento come farebbe la rete: prima i filtri, poi il
        // gestore. Se un filtro non chiama next(), il pacchetto cade — ed è
        // esattamente il comportamento che protegge `startGame`.
        manda(evento, dati) {
            let i = 0;
            const avanti = () => {
                if (i < filtri.length) return filtri[i++]([evento, dati], avanti);
                if (gestori[evento]) gestori[evento](dati);
            };
            avanti();
        }
    };
    io.connessione(socket);
    return socket;
}

function preparaLobby() {
    lobbies.set(LOBBY, { id: LOBBY, host: HOST, players: [HOST, OSPITE], gameSettings: null });
    return { gettoneHost: creaGettone(LOBBY, HOST), gettoneOspite: creaGettone(LOBBY, OSPITE) };
}

function pulisci() {
    lobbies.delete(LOBBY);
    dimenticaLobby(LOBBY);
}

test('il gettone vale per un colore solo, e solo nella sua lobby', () => {
    const g = creaGettone(LOBBY, HOST);
    assert.equal(verificaGettone(LOBBY, HOST, g), true);
    assert.equal(verificaGettone(LOBBY, OSPITE, g), false, 'non deve valere per un altro colore');
    assert.equal(verificaGettone('ALTRAL', HOST, g), false, 'non deve valere in un\'altra stanza');
    assert.equal(verificaGettone(LOBBY, HOST, 'x'.repeat(48)), false);
    assert.equal(verificaGettone(LOBBY, HOST, undefined), false);
    dimenticaLobby(LOBBY);
});

test('senza gettone non si entra in lobby, e il socket resta senza identità', (t) => {
    t.after(pulisci);
    const io = ioFinto();
    socketManager(io);
    preparaLobby();

    const intruso = collega(io);
    intruso.manda('joinLobby', { lobbyId: LOBBY, color: HOST });

    assert.equal(intruso.color, undefined, 'il socket non deve prendere il colore che ha dichiarato');
    assert.equal(intruso.emessi.some((e) => e.evento === 'sessioneNonValida'), true);
});

test('con il gettone giusto si entra, e il colore diventa quello del socket', (t) => {
    t.after(pulisci);
    const io = ioFinto();
    socketManager(io);
    const { gettoneHost } = preparaLobby();

    const s = collega(io);
    s.manda('joinLobby', { lobbyId: LOBBY, color: HOST, token: gettoneHost });

    assert.equal(s.color, HOST);
    assert.equal(s.lobbyId, LOBBY);
});

test('chi non è host non può espellere nessuno, nemmeno dichiarandosi host', (t) => {
    t.after(pulisci);
    const io = ioFinto();
    socketManager(io);
    const { gettoneOspite } = preparaLobby();

    const ospite = collega(io);
    ospite.manda('joinLobby', { lobbyId: LOBBY, color: OSPITE, token: gettoneOspite });

    // L'attacco di prima: mando io il colore dell'host, che è pubblico.
    ospite.manda('kickPlayer', { lobbyId: LOBBY, hostColor: HOST, targetColor: HOST });

    assert.deepEqual(lobbies.get(LOBBY).players, [HOST, OSPITE], 'nessuno deve essere uscito');
});

test('l\'host invece espelle davvero', (t) => {
    t.after(pulisci);
    const io = ioFinto();
    socketManager(io);
    const { gettoneHost } = preparaLobby();

    const host = collega(io);
    host.manda('joinLobby', { lobbyId: LOBBY, color: HOST, token: gettoneHost });
    host.manda('kickPlayer', { lobbyId: LOBBY, targetColor: OSPITE });

    assert.deepEqual(lobbies.get(LOBBY).players, [HOST]);
});

test('chi non è host non può prendersi la stanza', (t) => {
    t.after(pulisci);
    const io = ioFinto();
    socketManager(io);
    const { gettoneOspite } = preparaLobby();

    const ospite = collega(io);
    ospite.manda('joinLobby', { lobbyId: LOBBY, color: OSPITE, token: gettoneOspite });
    ospite.manda('transferHost', { lobbyId: LOBBY, currentHost: HOST, newHost: OSPITE });

    assert.equal(lobbies.get(LOBBY).host, HOST, 'l\'host non deve essere cambiato');
});

test('avviare una partita è un potere dell\'host, non solo un pulsante nascosto', (t) => {
    t.after(pulisci);
    const io = ioFinto();
    socketManager(io);
    const { gettoneHost, gettoneOspite } = preparaLobby();

    const ospite = collega(io);
    ospite.manda('joinLobby', { lobbyId: LOBBY, color: OSPITE, token: gettoneOspite });
    ospite.manda('startGame', { lobbyId: LOBBY, gameId: 'f1', settings: { trackId: 'prova' } });

    assert.equal(io.inviati.some((e) => e.evento === 'gameSelected'), false,
        'la partita non deve partire per chi non ospita');

    const host = collega(io);
    host.manda('joinLobby', { lobbyId: LOBBY, color: HOST, token: gettoneHost });
    host.manda('startGame', { lobbyId: LOBBY, gameId: 'f1', settings: { trackId: 'prova' } });

    assert.equal(io.inviati.some((e) => e.evento === 'gameSelected'), true);
});

test('la chat non parla per conto di un altro colore', (t) => {
    t.after(pulisci);
    const io = ioFinto();
    socketManager(io);
    const { gettoneOspite } = preparaLobby();

    const ospite = collega(io);
    ospite.manda('joinLobby', { lobbyId: LOBBY, color: OSPITE, token: gettoneOspite });
    ospite.manda('sendChatMessage', { lobbyId: LOBBY, playerColor: HOST, message: 'ciao' });

    const messaggio = io.inviati.find((e) => e.evento === 'receiveChatMessage');
    assert.ok(messaggio, 'il messaggio deve comunque partire');
    assert.equal(messaggio.dati.playerColor, OSPITE, 'ma a nome di chi lo ha scritto');
});

test('un messaggio malformato non spegne il server', (t) => {
    t.after(pulisci);
    const io = ioFinto();
    socketManager(io);
    preparaLobby();

    const s = collega(io);
    // `joinLobby` con un numero al posto dell'oggetto: prima o poi qualcosa
    // dentro un gestore lancia, e senza la protezione l'eccezione arriva a
    // uncaughtException e porta giù ogni partita di ogni stanza.
    assert.doesNotThrow(() => s.manda('joinLobby', 42));
    assert.doesNotThrow(() => s.manda('kickPlayer', null));
    assert.doesNotThrow(() => s.manda('transferHost', undefined));
});
