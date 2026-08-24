// backend/routes/giriPerMescola.test.js
//
// L'editor sceglie l'abrasivita' dell'asfalto e mostra quanti giri dura ogni
// mescola. Quel numero deve venire dalla FUNZIONE VERA del gioco: riscrivere
// la formula in una pagina statica darebbe due valori per la stessa cosa, e
// prima o poi divergerebbero senza che nessun test se ne accorga.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const router = require('./lobbyRoutes.js');
const { giriPerMescola } = require('../sockets/games/physics/TyreModel.js');

// Stesso schema di impostazioniLobby.test.js: il router su una porta effimera.
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
                try { dati = JSON.parse(corpo); } catch (e) { /* corpo non JSON */ }
                risolvi({ stato: res.statusCode, dati });
            });
        }).on('error', rifiuta);
    });
}

test('la previsione e quella di TyreModel, non una copia', async () => {
    const server = await avviaServer();
    try {
        const r = await chiedi(server, '/api/f1/giri-per-mescola?laps=20&abrasivita=1.5');
        assert.equal(r.stato, 200);
        assert.deepEqual(r.dati, giriPerMescola(20, 1.5));
    } finally { server.close(); }
});

test('un asfalto piu abrasivo consuma prima le gomme', async () => {
    const server = await avviaServer();
    try {
        const dolce = (await chiedi(server, '/api/f1/giri-per-mescola?laps=30&abrasivita=0.5')).dati;
        const duro = (await chiedi(server, '/api/f1/giri-per-mescola?laps=30&abrasivita=2')).dati;
        assert.ok(duro.soft < dolce.soft, `soft: ${duro.soft} contro ${dolce.soft}`);
        assert.ok(duro.hard < dolce.hard, `hard: ${duro.hard} contro ${dolce.hard}`);
    } finally { server.close(); }
});

test('parametri assurdi danno 400, non 500', async () => {
    const server = await avviaServer();
    try {
        assert.equal((await chiedi(server, '/api/f1/giri-per-mescola?laps=zzz')).stato, 400);
        assert.equal((await chiedi(server, '/api/f1/giri-per-mescola?laps=20&abrasivita=-1')).stato, 400);
        assert.equal((await chiedi(server, '/api/f1/giri-per-mescola')).stato, 400);
    } finally { server.close(); }
});
