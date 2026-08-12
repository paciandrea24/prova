const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registra } = require('./segnalazioniRoutes.js');

const REC = {
    sessione: 's1', t: '2026-08-12T14:12:41.310Z', trackId: 'prova',
    pos: { x: 1, y: 2, z: 3 }, headingDeg: 90,
    camera: 'third', guardaDietro: false, velocita: 144, giro: 2
};

// Server usa e getta su porta effimera: la route va provata come la userà il
// browser, non chiamando a mano il gestore.
function avvia() {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'segn-')), 'segnalazioni.json');
    const app = express();
    registra(app, file);
    return new Promise(resolve => {
        const srv = app.listen(0, '127.0.0.1', () => {
            resolve({ srv, file, url: `http://127.0.0.1:${srv.address().port}` });
        });
    });
}

function posta(url, corpo) {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo)
    });
}

test('una segnalazione valida viene salvata e risponde col numero', async () => {
    const { srv, url, file } = await avvia();
    try {
        const r = await posta(`${url}/dev/f1-marker`, REC);
        assert.equal(r.status, 200);
        assert.deepEqual(await r.json(), { ok: true, n: 1 });
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 1);
    } finally { srv.close(); }
});

test('un payload malformato risponde 400 e non scrive', async () => {
    const { srv, url, file } = await avvia();
    try {
        const r = await posta(`${url}/dev/f1-marker`, { ...REC, pos: null });
        assert.equal(r.status, 400);
        assert.equal((await r.json()).ok, false);
        assert.equal(fs.existsSync(file), false);
    } finally { srv.close(); }
});

test('annulla toglie l ultima della sessione', async () => {
    const { srv, url, file } = await avvia();
    try {
        await posta(`${url}/dev/f1-marker`, REC);
        await posta(`${url}/dev/f1-marker`, REC);
        const r = await posta(`${url}/dev/f1-marker/annulla`, { sessione: 's1' });
        assert.deepEqual(await r.json(), { ok: true, n: 2 });
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 1);
    } finally { srv.close(); }
});

test('annulla senza sessione risponde 400', async () => {
    const { srv, url } = await avvia();
    try {
        const r = await posta(`${url}/dev/f1-marker/annulla`, {});
        assert.equal(r.status, 400);
    } finally { srv.close(); }
});
