// backend/sockets/games/f1GameSocket.exports.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const f1GameSocket = require('./f1GameSocket.js');

test('f1GameSocket esporta tickGame come funzione', () => {
    assert.equal(typeof f1GameSocket.tickGame, 'function');
});

test('f1GameSocket esporta TYRE_COMPOUNDS con le cinque mescole note', () => {
    // Erano tre fino al 2026-09-12: con la pioggia sono cinque. Le tre da
    // asciutto restano, e chi deve parlare solo di quelle usa MESCOLE_ASCIUTTO.
    assert.deepEqual(Object.keys(f1GameSocket.TYRE_COMPOUNDS).sort(),
        ['hard', 'intermedie', 'medium', 'pioggia', 'soft']);
});
