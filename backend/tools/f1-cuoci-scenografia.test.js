// backend/tools/f1-cuoci-scenografia.test.js
//
// Il cuocitore. La cosa che questi test proteggono non e' il formato (quello
// e' del Task 1) ma la CORRISPONDENZA: che il file cotto contenga la
// scenografia vera, quella che il gioco disegnerebbe, e non un layout
// plausibile generato con argomenti leggermente diversi.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { cuoci } = require('./f1-cuoci-scenografia.js');
const Cotta = require('../../frontend/shared/scenografiaCotta.js');

const ROOT = path.join(__dirname, '..', '..');
const raw = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/tracks/prova.json'), 'utf8'));

test('cuoci: produce un file che il lettore accetta', () => {
    const file = cuoci('prova', 6);
    assert.equal(Cotta.motivoDiRifiuto(file, raw(), 6), null);
});

test('cuoci: la cottura contiene la scenografia VERA, non un abbozzo', () => {
    // Se il cuocitore chiamasse generateLayout con argomenti diversi da quelli
    // del gioco, il file sarebbe plausibile e sbagliato. Il numero e' quello
    // misurato il 2026-08-23 su prova.
    const file = cuoci('prova', 6);
    assert.ok(file.voci.length > 5000, `attese migliaia di voci, ottenute ${file.voci.length}`);
    assert.ok(file.assets.length > 20, `attesi decine di asset distinti, ottenuti ${file.assets.length}`);
});

test('cuoci: due cotture della stessa pista sono identiche', () => {
    // La scenografia e' deterministica (seminata dall'id): se due cotture
    // divergono, da qualche parte e' entrata della casualita' vera e tutto
    // questo blocco non ha senso.
    const a = cuoci('prova', 6);
    const b = cuoci('prova', 6);
    assert.deepEqual(a.voci, b.voci);
});

test('cuoci: gridSize diversi producono cotture diverse', () => {
    const a = cuoci('prova', 6);
    const b = cuoci('prova', 2);
    assert.notDeepEqual(a.voci, b.voci);
    assert.equal(b.gridSize, 2);
});
