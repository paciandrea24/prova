// frontend/shared/f1SuoniCerimonia.test.js
//
// Di un suono si può verificare a tavolino una cosa sola: QUANDO parte. Ed è
// anche l'unica che si sbaglia in silenzio — un botto prima del suo fischio, o
// due razzi nello stesso istante, si sentono come un difetto senza che niente
// segnali un errore.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./f1SuoniCerimonia');

test('ogni botto ha il suo fischio, e viene dopo', () => {
    const eventi = S.programmaFuochi(8000, 4);
    const fischi = eventi.filter(e => e.tipo === 'fischio');
    const botti = eventi.filter(e => e.tipo === 'botto');
    assert.equal(fischi.length, 4);
    assert.equal(botti.length, 4);
    for (const botto of botti) {
        const suo = fischi.find(f => f.indice === botto.indice);
        assert.ok(suo, `il razzo ${botto.indice} scoppia senza essere partito`);
        assert.ok(suo.istanteMs < botto.istanteMs, 'il botto arriva prima del fischio');
        assert.equal(botto.istanteMs - suo.istanteMs, S.SALITA_MS);
    }
});

test('i razzi non partono tutti insieme ne a intervalli uguali', () => {
    const botti = S.programmaFuochi(8000, 5).filter(e => e.tipo === 'botto');
    const istanti = botti.map(e => e.istanteMs);
    assert.equal(new Set(istanti).size, istanti.length, 'due botti nello stesso istante');
    // Una cadenza perfettamente regolare suona come un metronomo: gli
    // intervalli devono essere diversi fra loro.
    const passi = istanti.slice(1).map((t, i) => t - istanti[i]);
    assert.ok(new Set(passi).size > 1, 'i razzi partono a metronomo');
});

test('il programma sta dentro la durata della festa', () => {
    const durata = 8000;
    for (const e of S.programmaFuochi(durata, 4)) {
        assert.ok(e.istanteMs <= durata, `un evento a ${e.istanteMs} oltre i ${durata}`);
    }
    for (const e of S.programmaJet(durata, 2)) {
        assert.ok(e.istanteMs <= durata, `un passaggio a ${e.istanteMs} oltre i ${durata}`);
    }
});

test('gli aerei passano in formazione: un rombo per passaggio, non per aereo', () => {
    assert.equal(S.programmaJet(8000, 1).length, 1);
    assert.equal(S.programmaJet(8000, 2).length, 2);
    // Il primo passaggio non e' all'istante zero: gli aerei arrivano da
    // lontano, e il rombo comincia mentre sono ancora fuori campo.
    assert.ok(S.programmaJet(8000, 1)[0].istanteMs > 0);
});

test('una festa cortissima non produce eventi impossibili', () => {
    // Se la durata fosse minore della salita di un razzo, il botto cadrebbe
    // oltre la fine: il programma deve restare coerente comunque.
    const eventi = S.programmaFuochi(600, 2);
    for (const e of eventi) assert.ok(Number.isFinite(e.istanteMs) && e.istanteMs >= 0);
    const botti = eventi.filter(e => e.tipo === 'botto');
    assert.equal(botti.length, 2);
});
