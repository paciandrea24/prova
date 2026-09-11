// backend/store/preferenzeStore.test.js
//
// Le preferenze legate all'account (blocco I). Il filtro dei campi ammessi si
// prova da solo, senza database dietro: e' la regola che impedisce alla rotta
// di diventare spazio disco gratis per chiunque abbia un account.
const test = require('node:test');
const assert = require('node:assert/strict');

function store() {
    delete require.cache[require.resolve('./preferenzeStore')];
    return require('./preferenzeStore');
}

test('filtraPreferenze: il volume passa, arrotondato al decimo', () => {
    const { filtraPreferenze } = store();
    assert.deepEqual(filtraPreferenze({ volume: 0.7 }), { volume: 0.7 });
    // Un client che mandasse 0.37 creerebbe uno stato che i tasti, che vanno a
    // passi di 0.1, non saprebbero piu' ne' rappresentare ne' raggiungere.
    assert.deepEqual(filtraPreferenze({ volume: 0.37 }), { volume: 0.4 });
    assert.deepEqual(filtraPreferenze({ volume: 0 }), { volume: 0 });
    assert.deepEqual(filtraPreferenze({ volume: 1 }), { volume: 1 });
});

test('filtraPreferenze: il volume fuori scala viene riportato dentro', () => {
    const { filtraPreferenze } = store();
    assert.deepEqual(filtraPreferenze({ volume: 5 }), { volume: 1 });
    assert.deepEqual(filtraPreferenze({ volume: -3 }), { volume: 0 });
});

test('filtraPreferenze: quel che non e\' un numero non entra', () => {
    const { filtraPreferenze } = store();
    for (const brutto of ['tanto', null, {}, [], NaN, Infinity]) {
        assert.deepEqual(filtraPreferenze({ volume: brutto }), {},
            `volume=${JSON.stringify(brutto)} non doveva passare`);
    }
});

test('filtraPreferenze: i campi non previsti si buttano via', () => {
    // ⚠️ E' il punto di tutto il filtro: senza, un account basta a scriversi
    // quello che si vuole nel database.
    const { filtraPreferenze } = store();
    const out = filtraPreferenze({ volume: 0.5, deposito: 'x'.repeat(10000), _id: 'altro-uid' });
    assert.deepEqual(out, { volume: 0.5 });
});

test('filtraPreferenze: un campo assente non diventa un valore', () => {
    // Serve a `salvaPreferenze`, che UNISCE invece di sostituire: mandare solo
    // il volume non deve azzerare le preferenze che non sono in questo
    // messaggio.
    const { filtraPreferenze } = store();
    assert.deepEqual(filtraPreferenze({}), {});
    assert.deepEqual(filtraPreferenze(null), {});
    assert.deepEqual(filtraPreferenze('ciao'), {});
});

test('salvaPreferenze: senza MONGODB_URI rifiuta con un errore esplicito', async () => {
    delete process.env.MONGODB_URI;
    const { salvaPreferenze } = store();
    await assert.rejects(() => salvaPreferenze('uid-test', { volume: 0.5 }), /MONGODB_URI/);
});

test('leggiPreferenze: senza MONGODB_URI risolve null, nessun crash', async () => {
    delete process.env.MONGODB_URI;
    const { leggiPreferenze } = store();
    assert.equal(await leggiPreferenze('uid-test'), null);
});
