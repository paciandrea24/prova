const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('./TyreModel');

test('mescole: ce ne sono cinque, e le tre da asciutto sono rimaste identiche', () => {
    assert.deepEqual(Object.keys(T.TYRE_COMPOUNDS).sort(),
        ['hard', 'intermedie', 'medium', 'pioggia', 'soft']);
    assert.deepEqual(T.MESCOLE_ASCIUTTO, ['soft', 'medium', 'hard']);
    // Niente regressioni sulla taratura approvata dell'asciutto.
    assert.equal(T.TYRE_COMPOUNDS.soft.speedMult, 1.05);
    assert.equal(T.TYRE_COMPOUNDS.medium.vita, 0.50);
    assert.equal(T.TYRE_COMPOUNDS.hard.gripMult, 0.90);
});

test('aderenza: ogni mescola vince nella sua finestra', () => {
    const migliore = (bagnato) => Object.keys(T.TYRE_COMPOUNDS)
        .map(c => [c, T.aderenzaBagnato(c, bagnato)])
        .sort((a, b) => b[1] - a[1])[0][0];
    assert.ok(['soft', 'medium', 'hard'].includes(migliore(0)), 'sull\'asciutto deve vincere una slick');
    assert.equal(migliore(0.45), 'intermedie', 'sull\'umido deve vincere l\'intermedia');
    assert.equal(migliore(0.95), 'pioggia', 'nel diluvio deve vincere la full wet');
});

test('aderenza: anche con la gomma giusta il bagnato costa', () => {
    const asciutto = T.aderenzaBagnato('soft', 0);
    const giusta = T.aderenzaBagnato('pioggia', 1);
    assert.ok(giusta < asciutto * 0.9,
        `con la gomma giusta il diluvio costa troppo poco: ${giusta} contro ${asciutto}`);
    const sbagliata = T.aderenzaBagnato('soft', 1);
    assert.ok(sbagliata < giusta * 0.8, 'le slick nel diluvio non sono abbastanza punite');
    for (const c of Object.keys(T.TYRE_COMPOUNDS)) {
        for (let b = 0; b <= 1.0001; b += 0.05) {
            const v = T.aderenzaBagnato(c, b);
            assert.ok(v > 0 && v <= 1, `${c} a ${b.toFixed(2)}: aderenza ${v} fuori da (0,1]`);
        }
    }
});

test('vita: la gomma si brucia quando la pista e piu ASCIUTTA della sua finestra, non il contrario', () => {
    assert.ok(T.fattoreVitaBagnato('pioggia', 0) > 2.5, 'la full wet sull\'asciutto deve distruggersi');
    assert.ok(T.fattoreVitaBagnato('intermedie', 0) > 1.8, 'l\'intermedia sull\'asciutto deve consumarsi');
    assert.equal(T.fattoreVitaBagnato('pioggia', 1), 1, 'la full wet nel diluvio deve durare normalmente');
    assert.equal(T.fattoreVitaBagnato('soft', 1), 1,
        'una slick sul bagnato non si BRUCIA: non aderisce, che e\' un\'altra cosa');
});

test('qualifica: la gomma la scegle il cielo, non una costante', () => {
    assert.equal(T.mescolaPerCielo(0), 'soft');
    assert.equal(T.mescolaPerCielo(0.4), 'intermedie');
    assert.equal(T.mescolaPerCielo(0.9), 'pioggia');
    // tyreOf in qualifica deve seguire il cielo scritto sull'auto.
    assert.equal(T.tyreOf({ compound: 'hard', bagnato: 0.9 }, true).label, 'Pioggia');
    assert.equal(T.tyreOf({ compound: 'hard', bagnato: 0 }, true).label, 'Soft');
    // In gara invece comanda la scelta del giocatore, bagnato o no.
    assert.equal(T.tyreOf({ compound: 'hard', bagnato: 0.9 }, false).label, 'Hard');
});
