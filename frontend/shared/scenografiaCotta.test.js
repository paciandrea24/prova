// frontend/shared/scenografiaCotta.test.js
//
// Il formato di una scenografia congelata. Le due cose da proteggere: che
// comprimere e rileggere restituisca ESATTAMENTE il layout di partenza, e che
// l'impronta MORDA — una cottura stantia disporrebbe tribune attorno a una
// pista che non c'e' piu', cioe' proprio il difetto che questo blocco esiste
// per eliminare.
const test = require('node:test');
const assert = require('node:assert/strict');
const Cotta = require('./scenografiaCotta.js');

const PISTA = {
    id: 'prova', roadHalfWidth: 11,
    startFinish: { x: 1, z: 2, angle: 0.5 },
    controlPoints: [{ x: 0, z: 0 }, { x: 10, z: 5 }],
    pit: { roadHalfWidth: 6, boxIndex: 3, entryTrigger: {} },
    name: 'prova', targetKm: 24,
};
const LAYOUT = [
    { asset: 'tree_a', category: 'natura', x: 1.234567, y: 0, z: -8.9, rotY: 1.5708, scale: 1 },
    { asset: 'grandstand', category: 'tribune', x: -40.5, y: 2.25, z: 12.125, rotY: 0, scale: 1.5 },
    { asset: 'tree_a', category: 'natura', x: 3, y: 0, z: 4, rotY: 3.14, scale: 0.8 },
];

// Mezzo centesimo, piu' un margine per il virgola mobile: e' il massimo errore
// possibile arrotondando a due decimali, e 12.125 nel layout qui sopra cade
// ESATTAMENTE su quella soglia — in binario la differenza esce 0.0050000000004.
const TOLLERANZA = 0.005 + 1e-9;

function cuoci(layout = LAYOUT, pista = PISTA, gridSize = 6) {
    return Cotta.comprimi(layout, {
        pista: pista.id, gridSize,
        impronta: Cotta.improntaDi(pista),
        cottaIl: '2026-08-23T00:00:00.000Z',
    });
}

test('comprimi/espandi: si torna al layout di partenza', () => {
    const espanso = Cotta.espandi(cuoci());
    assert.equal(espanso.length, LAYOUT.length);
    for (let i = 0; i < LAYOUT.length; i++) {
        assert.equal(espanso[i].asset, LAYOUT[i].asset);
        assert.equal(espanso[i].category, LAYOUT[i].category);
        for (const c of ['x', 'y', 'z', 'rotY', 'scale']) {
            assert.ok(Math.abs(espanso[i][c] - LAYOUT[i][c]) <= TOLLERANZA,
                `${c} della voce ${i}: ${espanso[i][c]} vs ${LAYOUT[i][c]}`);
        }
    }
});

test('comprimi: gli asset ripetuti stanno in tabella, non ripetuti per voce', () => {
    // E' cio' che porta prova da 1037 KB a 264: 7667 voci e 46 asset distinti.
    const f = cuoci();
    assert.deepEqual(f.assets.slice().sort(), ['grandstand', 'tree_a']);
    assert.equal(f.voci.length, 3);
    assert.equal(typeof f.voci[0][0], 'number', "l'asset e' un indice, non una stringa");
});

test("improntaDi: la stessa pista da' la stessa impronta", () => {
    assert.equal(Cotta.improntaDi(PISTA), Cotta.improntaDi(JSON.parse(JSON.stringify(PISTA))));
});

test("improntaDi: spostare un punto di controllo cambia l'impronta", () => {
    // E' il rischio VERO di questo blocco: una cottura stantia disporrebbe
    // tribune attorno a una pista che non c'e' piu'.
    const altra = JSON.parse(JSON.stringify(PISTA));
    altra.controlPoints[1].x = 10.5;
    assert.notEqual(Cotta.improntaDi(PISTA), Cotta.improntaDi(altra));
});

test("improntaDi: cambiare la larghezza o la corsia box cambia l'impronta", () => {
    for (const muta of [(p) => { p.roadHalfWidth = 12; }, (p) => { p.pit.roadHalfWidth = 7; },
                        (p) => { p.pit.boxIndex = 9; }, (p) => { p.startFinish.angle = 1.1; }]) {
        const altra = JSON.parse(JSON.stringify(PISTA));
        muta(altra);
        assert.notEqual(Cotta.improntaDi(PISTA), Cotta.improntaDi(altra));
    }
});

test("improntaDi: cambiare il NOME non cambia l'impronta", () => {
    // Il nome non sposta un solo oggetto: se lo contasse, rinominare una pista
    // butterebbe via una cottura ancora buona.
    const altra = JSON.parse(JSON.stringify(PISTA));
    altra.name = 'Circuito di Prova';
    assert.equal(Cotta.improntaDi(PISTA), Cotta.improntaDi(altra));
});

test('motivoDiRifiuto: una cottura buona non viene rifiutata', () => {
    assert.equal(Cotta.motivoDiRifiuto(cuoci(), PISTA, 6), null);
});

test('motivoDiRifiuto: pista sbagliata', () => {
    const f = cuoci(LAYOUT, PISTA, 6);
    f.pista = 'monte-rosso';
    assert.match(Cotta.motivoDiRifiuto(f, PISTA, 6), /pista/i);
});

test('motivoDiRifiuto: gridSize diverso', () => {
    // generateLayout dipende anche da gridSize: fra 1 e 10 cambiano da 3 a 7
    // voci su 7667. Poche, ma il layout non e' identico.
    assert.match(Cotta.motivoDiRifiuto(cuoci(), PISTA, 4), /grid/i);
});

test('motivoDiRifiuto: tracciato cambiato dopo la cottura', () => {
    const f = cuoci();
    const altra = JSON.parse(JSON.stringify(PISTA));
    altra.controlPoints[1].z = 99;
    assert.match(Cotta.motivoDiRifiuto(f, altra, 6), /tracciato|impronta/i);
});

test('motivoDiRifiuto: formato di una versione futura', () => {
    const f = cuoci();
    f.versione = 999;
    assert.match(Cotta.motivoDiRifiuto(f, PISTA, 6), /versione|formato/i);
});

test('motivoDiRifiuto: file assente o spazzatura non fa esplodere niente', () => {
    for (const f of [null, undefined, {}, { voci: 'no' }, 42]) {
        assert.equal(typeof Cotta.motivoDiRifiuto(f, PISTA, 6), 'string');
    }
});
