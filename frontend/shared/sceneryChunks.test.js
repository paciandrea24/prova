const test = require('node:test');
const assert = require('node:assert/strict');
const SceneryChunks = require('./sceneryChunks.js');

test('oggetti vicini finiscono nella stessa cella', () => {
    const items = [{ x: 10, z: 10 }, { x: 40, z: 60 }, { x: 349, z: 349 }];
    const g = SceneryChunks.groupByCell(items, 350);
    assert.equal(g.size, 1);
    assert.equal([...g.values()][0].length, 3);
});

test('oggetti lontani finiscono in celle diverse', () => {
    const items = [{ x: 10, z: 10 }, { x: 800, z: 10 }, { x: 10, z: -900 }];
    const g = SceneryChunks.groupByCell(items, 350);
    assert.equal(g.size, 3);
});

test('le coordinate negative non collassano sulla cella zero', () => {
    // Math.floor(-10/350) vale -1, non 0: un troncamento verso lo zero
    // metterebbe insieme oggetti a cavallo dell'origine, e su un circuito
    // che si sviluppa attorno all'origine sarebbe metà mappa in un gruppo.
    const g = SceneryChunks.groupByCell([{ x: -10, z: -10 }, { x: 10, z: 10 }], 350);
    assert.equal(g.size, 2);
});

test('nessuna voce viene persa o duplicata', () => {
    const items = [];
    for (let i = 0; i < 500; i++) items.push({ x: (i * 37) % 2000 - 1000, z: (i * 53) % 2000 - 1000 });
    const g = SceneryChunks.groupByCell(items, 350);
    let totale = 0;
    for (const v of g.values()) totale += v.length;
    assert.equal(totale, items.length);
});

test('la sfera contiene tutti i punti con il loro ingombro', () => {
    // È l'invariante che conta: se la sfera è troppo piccola, il culling fa
    // sparire oggetti veri.
    const punti = [
        { x: 0, y: 0, z: 0 }, { x: 100, y: 12, z: -80 },
        { x: -60, y: 0, z: 40 }, { x: 30, y: 5, z: 120 },
    ];
    const RAGGIO = 9;
    const b = SceneryChunks.boundsOf(punti, RAGGIO);
    for (const p of punti) {
        const d = Math.sqrt((p.x - b.x) ** 2 + ((p.y || 0) - b.y) ** 2 + (p.z - b.z) ** 2);
        assert.ok(d + RAGGIO <= b.radius + 1e-9,
            `il punto (${p.x},${p.z}) sporge dalla sfera: ${(d + RAGGIO).toFixed(2)} > ${b.radius.toFixed(2)}`);
    }
});

test('la sfera tiene conto della quota', () => {
    // Gli alberi dei boschi stanno sulle colline: ignorando y la sfera
    // sarebbe troppo bassa e i boschi in quota sparirebbero.
    const piatti = SceneryChunks.boundsOf([{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }], 0);
    const inQuota = SceneryChunks.boundsOf([{ x: 0, y: 0, z: 0 }, { x: 100, y: 90, z: 0 }], 0);
    assert.ok(inQuota.radius > piatti.radius, 'la quota non incide sul raggio');
});

test('un solo oggetto dà una sfera grande quanto il suo ingombro', () => {
    const b = SceneryChunks.boundsOf([{ x: 5, y: 2, z: -3 }], 7);
    assert.equal(b.x, 5);
    assert.equal(b.y, 2);
    assert.equal(b.z, -3);
    assert.equal(b.radius, 7);
});

test('nessun punto produce una sfera nulla invece di NaN', () => {
    const b = SceneryChunks.boundsOf([], 5);
    assert.equal(b.radius, 0);
    for (const k of ['x', 'y', 'z']) assert.ok(Number.isFinite(b[k]), `${k} non è finito`);
});

test('la voce senza quota vale come quota zero', () => {
    const b = SceneryChunks.boundsOf([{ x: 0, z: 0 }, { x: 0, z: 10 }], 0);
    assert.ok(Number.isFinite(b.y), 'y non è finito con voci prive di y');
    assert.equal(b.y, 0);
});

// ── quando conviene dividere ─────────────────────────────────────────────
// Misurato in gioco il 2026-08-16 (pannello F9, circuito `prova`): il tempo
// di disegno segue le DRAW CALL — ~5 ms fissi più ~0.013 ms l'una — e non i
// triangoli. Spegnendo i 449k triangoli degli spettatori gli fps non
// salivano; togliendo 104 draw call di alberi scendeva di 1 ms.

test('un asset leggero e sparso non va diviso: le celle costano più del culling', () => {
    // treeBroad su prova: 131 alberi, 44k triangoli in tutto, sparsi su 26
    // celle. Dividerlo costa 78 draw call (26 celle x 3 materiali) per
    // risparmiarne al massimo 44k di triangoli, che non pesano.
    assert.equal(SceneryChunks.vaDivisoInCelle(131, 44000), false);
});

test('un asset pesante va diviso anche se le istanze sono poche', () => {
    // grandStandCovered: 44 tribune ma 165k triangoli. Qui il culling ripaga.
    assert.equal(SceneryChunks.vaDivisoInCelle(44, 165000), true);
});

test('pochi oggetti non si dividono comunque, per quanto pesanti', () => {
    // La soglia storica sulle istanze resta: un gruppo di 10 oggetti diviso
    // in celle produce gruppi da 2-3, e ogni gruppo è una draw call.
    assert.equal(SceneryChunks.vaDivisoInCelle(10, 900000), false);
});

test('la folla resta divisa: è il caso che il culling serve davvero', () => {
    // spectatorC: 2035 figure, 244k triangoli. Senza celle sarebbero sempre
    // tutte in coda alla GPU, anche quelle alle spalle della camera.
    assert.equal(SceneryChunks.vaDivisoInCelle(2035, 244000), true);
});
