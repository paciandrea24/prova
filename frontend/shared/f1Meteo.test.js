const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./f1Meteo.js');

const DURATA = 5 * 60 * 1000;   // una gara da cinque minuti

test('profilo: lo stesso seme da lo stesso profilo, semi diversi danno archetipi diversi', () => {
    const a = M.generaProfilo(12345, DURATA);
    const b = M.generaProfilo(12345, DURATA);
    assert.deepEqual(a, b, 'stesso seme, profilo diverso: non e\' riproducibile');
    const archetipi = new Set();
    for (let s = 0; s < 200; s++) archetipi.add(M.generaProfilo(s, DURATA).archetipo);
    assert.ok(archetipi.size >= 4, `su 200 semi sono usciti solo ${archetipi.size} archetipi`);
});

test('profilo: ogni archetipo ha la forma che promette', () => {
    const di = (nome) => M.generaProfilo(1, DURATA, { archetipo: nome });
    const p = (prof, frazione) => M.pioggiaA(prof, DURATA * frazione);

    assert.equal(p(di('asciutto'), 0.5), 0, 'asciutto non deve piovere mai');

    const scampa = di('bagnatoCheScampa');
    assert.ok(p(scampa, 0) > 0.5, 'bagnatoCheScampa deve partire bagnato');
    assert.ok(p(scampa, 0.9) < 0.1, 'bagnatoCheScampa deve finire asciutto');

    const arriva = di('temporaleCheArriva');
    assert.equal(p(arriva, 0), 0, 'temporaleCheArriva deve partire asciutto');
    assert.ok(p(arriva, 1) > 0.5, 'temporaleCheArriva deve finire sotto la pioggia');
    assert.ok(p(arriva, 0.9) > p(arriva, 0.5), 'temporaleCheArriva deve crescere');

    // ⚠️ Il picco NON si cerca a meta' esatta: `quando` e' pescato fra 0.35 e
    // 0.65, quindi a 0.5 il rovescio puo' essere gia' finito. Si cerca dove
    // cade davvero — e' la forma che conta, non l'istante.
    const rovescio = di('rovescioBreve');
    let picco = 0, dove = 0;
    for (let f = 0; f <= 1; f += 0.01) {
        const v = p(rovescio, f);
        if (v > picco) { picco = v; dove = f; }
    }
    assert.ok(picco > 0.4, `rovescioBreve non ha un picco: ${picco}`);
    assert.ok(dove > 0.2 && dove < 0.85, `il picco del rovescio cade a ${dove}, non in mezzo alla gara`);
    assert.ok(p(rovescio, 0) < 0.1 && p(rovescio, 1) < 0.2, 'rovescioBreve deve cominciare e finire asciutto');
});

test('profilo: fuori dai punti non estrapola, e ogni valore sta fra 0 e 1', () => {
    for (let s = 0; s < 50; s++) {
        const prof = M.generaProfilo(s, DURATA);
        for (let t = -10000; t <= DURATA + 10000; t += DURATA / 40) {
            const v = M.pioggiaA(prof, t);
            assert.ok(v >= 0 && v <= 1, `pioggia fuori scala: ${v} a t=${t} (seme ${s})`);
        }
    }
});

test('previsione: dice che cambiera senza dire quando', () => {
    const asciutto = M.generaProfilo(1, DURATA, { archetipo: 'asciutto' });
    assert.equal(M.previsione(asciutto, 0), 'stabile');

    const arriva = M.generaProfilo(1, DURATA, { archetipo: 'temporaleCheArriva' });
    assert.equal(M.previsione(arriva, 0), 'arrivo', 'con un temporale in arrivo deve avvisare');

    // A gara quasi finita non c'e' piu' niente da prevedere.
    assert.equal(M.previsione(arriva, DURATA * 0.99), 'stabile');
});
