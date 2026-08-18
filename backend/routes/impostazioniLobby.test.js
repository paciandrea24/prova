// backend/routes/impostazioniLobby.test.js
//
// Le impostazioni di una partita non viaggiano più dentro l'indirizzo della
// pagina: le pagine di gioco le chiedono a questa rotta (vedi
// frontend/shared/impostazioniGara.js per il perché).
//
// Il contratto da proteggere è doppio. Primo: la rotta risponde davvero, e
// risponde con le impostazioni giuste — se smettesse, ogni gioco ripiegherebbe
// silenziosamente sui propri valori di riferimento e si correrebbe sulla pista
// sbagliata senza un errore da nessuna parte. Secondo: risponde SOLO con le
// impostazioni, perché a chi deve disegnare una pista non serve sapere chi
// ospita la lobby né chi c'è dentro.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

const { lobbies } = require('../store/lobbies.js');
const router = require('./lobbyRoutes.js');
const f1 = require('../sockets/games/f1GameSocket.js');
const { activeGames } = require('../store/activeGames.js');

const LOBBY = 'TESTIMP';

function avviaServer() {
    const app = express();
    app.use(express.json());
    app.use('/', router);
    const server = http.createServer(app);
    return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

function chiedi(server, percorso) {
    const { port } = server.address();
    return new Promise((risolvi, rifiuta) => {
        http.get({ host: '127.0.0.1', port, path: percorso }, (res) => {
            let corpo = '';
            res.on('data', (c) => { corpo += c; });
            res.on('end', () => {
                let dati = null;
                try { dati = JSON.parse(corpo); } catch (e) { /* non JSON */ }
                risolvi({ stato: res.statusCode, dati });
            });
        }).on('error', rifiuta);
    });
}

function pulisci() {
    const g = activeGames.get(LOBBY);
    if (g && g.tick) clearInterval(g.tick);
    for (const k of ['tyreSelectTimeout', 'qualiEndTimeout', 'endTimeout', 'chiusuraTimeout']) {
        if (g && g[k]) clearTimeout(g[k]);
    }
    activeGames.delete(LOBBY);
    lobbies.delete(LOBBY);
}

test('la rotta restituisce le impostazioni salvate dall avvio partita', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());

    lobbies.set(LOBBY, { host: 'red', players: ['red'] });

    // L'avvio vero dalla lobby, non un oggetto messo a mano nello store.
    const handlers = {};
    f1({ to: () => ({ emit: () => { } }) },
        { id: 's1', data: {}, on: (ev, cb) => { handlers[ev] = cb; }, emit: () => { }, join: () => { } });
    handlers.startGame({
        lobbyId: LOBBY, gameId: 'f1',
        settings: { trackId: 'prova', gridSize: '8', botsEnabled: 'true' },
    });

    const r = await chiedi(server, `/api/lobby/${LOBBY}/settings`);
    assert.equal(r.stato, 200);
    assert.equal(r.dati.settings.trackId, 'prova',
        'senza questo il gioco ripiega sulla pista di riferimento e si corre su quella sbagliata, in silenzio');
    assert.equal(r.dati.settings.gridSize, '8');
});

test('la rotta non racconta nulla della lobby oltre alle impostazioni', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());

    lobbies.set(LOBBY, {
        host: 'red', players: ['red', 'blue'], lockedPlayers: ['red', 'blue'],
        gameSettings: { trackId: 'prova' },
    });

    const r = await chiedi(server, `/api/lobby/${LOBBY}/settings`);
    assert.deepEqual(Object.keys(r.dati), ['settings'],
        `la risposta contiene anche ${Object.keys(r.dati).join(', ')}`);
    assert.equal(r.dati.settings.host, undefined);
    assert.equal(r.dati.settings.players, undefined);
});

test('lobby inesistente: 404, non un oggetto vuoto spacciato per buono', async (t) => {
    const server = await avviaServer();
    t.after(() => server.close());
    const r = await chiedi(server, '/api/lobby/NONESISTE/settings');
    assert.equal(r.stato, 404);
});

test('partita senza impostazioni: oggetto vuoto, non null', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());

    // gameSettings nasce a null (vedi la creazione della lobby): il client fa
    // `d.settings || {}`, ma la rotta non deve costringerlo a difendersi.
    lobbies.set(LOBBY, { host: 'red', players: ['red'], gameSettings: null });
    const r = await chiedi(server, `/api/lobby/${LOBBY}/settings`);
    assert.equal(r.stato, 200);
    assert.deepEqual(r.dati.settings, {});
});
