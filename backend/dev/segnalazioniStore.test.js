const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./segnalazioniStore.js');

// File temporaneo per ogni test: lo store scrive davvero su disco, e i test
// non devono toccare il file di lavoro dell'utente.
function fileTemp() {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'segn-')), 'f1-segnalazioni.json');
}

const REC = {
    sessione: 's1', t: '2026-08-12T14:12:41.310Z', trackId: 'prova',
    pos: { x: 1, y: 2, z: 3 }, headingDeg: 90,
    camera: 'third', guardaDietro: false, velocita: 144, giro: 2
};

test('la prima segnalazione crea il file e prende il numero 1', () => {
    const f = fileTemp();
    assert.deepEqual(store.aggiungi(REC, f), { ok: true, n: 1 });
    assert.equal(store.leggi(f).length, 1);
    assert.equal(store.leggi(f)[0].n, 1);
});

test('il progressivo cresce', () => {
    const f = fileTemp();
    store.aggiungi(REC, f);
    assert.deepEqual(store.aggiungi(REC, f), { ok: true, n: 2 });
});

test('un numero mandato dal client non vince su quello del server', () => {
    // Il client non ha titolo per numerare: se lo facesse, due schede aperte
    // scriverebbero due "segnalazione 1" diverse nello stesso file.
    const f = fileTemp();
    store.aggiungi({ ...REC, n: 99 }, f);
    assert.equal(store.leggi(f)[0].n, 1);
});

test('un record senza posizione viene rifiutato e non scrive niente', () => {
    const f = fileTemp();
    const esito = store.aggiungi({ ...REC, pos: { x: 1, y: NaN, z: 3 } }, f);
    assert.equal(esito.ok, false);
    assert.match(esito.errore, /pos/);
    assert.equal(fs.existsSync(f), false);
});

test('un record senza trackId viene rifiutato', () => {
    const f = fileTemp();
    assert.equal(store.aggiungi({ ...REC, trackId: '' }, f).ok, false);
});

test('leggere un file inesistente dà una lista vuota, non un errore', () => {
    assert.deepEqual(store.leggi(path.join(os.tmpdir(), 'non-esiste-mai.json')), []);
});

test('annulla toglie l ultima della sessione indicata e lascia le altre', () => {
    const f = fileTemp();
    store.aggiungi({ ...REC, sessione: 's1' }, f);
    store.aggiungi({ ...REC, sessione: 's2' }, f);
    store.aggiungi({ ...REC, sessione: 's1' }, f);
    assert.deepEqual(store.annullaUltima('s1', f), { ok: true, n: 3 });
    const rimasti = store.leggi(f);
    assert.deepEqual(rimasti.map(r => r.n), [1, 2]);
});

test('annulla su una sessione senza segnalazioni non fa danni', () => {
    const f = fileTemp();
    store.aggiungi(REC, f);
    assert.equal(store.annullaUltima('sconosciuta', f).ok, false);
    assert.equal(store.leggi(f).length, 1);
});

test('oltre il tetto massimo lo store rifiuta invece di gonfiare il file', () => {
    const f = fileTemp();
    const pieni = Array.from({ length: store.MAX_RECORD }, (_, i) => ({ ...REC, n: i + 1 }));
    fs.writeFileSync(f, JSON.stringify(pieni));
    assert.equal(store.aggiungi(REC, f).ok, false);
});
