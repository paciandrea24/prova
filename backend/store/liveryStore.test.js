const test = require('node:test');
const assert = require('node:assert/strict');

test('saveLivery: senza MONGODB_URI -> rifiuta con errore esplicito, nessuna scrittura tentata', async () => {
    delete process.env.MONGODB_URI;
    delete require.cache[require.resolve('./liveryStore')];
    const { saveLivery } = require('./liveryStore');

    await assert.rejects(
        () => saveLivery('uid-test', { liveryColors: { Chassis: [1, 0, 0] }, liveryParams: null }),
        /MONGODB_URI/
    );
});

test('getLivery: senza MONGODB_URI -> risolve null (nessun crash)', async () => {
    delete process.env.MONGODB_URI;
    delete require.cache[require.resolve('./liveryStore')];
    const { getLivery } = require('./liveryStore');

    const result = await getLivery('uid-test');
    assert.equal(result, null);
});
