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

test('previsione: al via ogni archetipo dice la verita, e non e una finestra corta', () => {
    // ⚠️ Questo test esiste per un errore vero: la previsione guardava avanti
    // di 90 secondi fissi, gli orologi della F1 vera, e al via di una gara da
    // cinque minuti diceva «stabile» davanti a un temporale che arrivava a
    // meta'. La domanda «che gomme metto» riguarda TUTTA la gara.
    const atteso = {
        asciutto: 'stabile',
        bagnatoCheScampa: 'variabile',   // parte bagnato e schiarisce: cambia
        temporaleCheArriva: 'arrivo',
        rovescioBreve: 'arrivo',         // adesso e' asciutto e sta per piovere
        intermittente: 'arrivo',
    };
    for (const archetipo of M.ARCHETIPI) {
        for (let s = 0; s < 40; s++) {
            const prof = M.generaProfilo(s, DURATA, { archetipo });
            assert.equal(M.previsione(prof, 0), atteso[archetipo],
                `${archetipo} col seme ${s} annuncia il cielo sbagliato`);
        }
    }
});

test('previsione: un rovescio in mezzo non si nasconde dietro gli estremi', () => {
    // Un profilo costruito a mano: comincia e finisce asciutto, diluvia in
    // mezzo. Guardando solo il valore finale si direbbe «stabile» proprio a chi
    // sta per prenderselo in faccia.
    const prof = { archetipo: 'aMano', punti: [
        { t: 0, pioggia: 0 },
        { t: DURATA * 0.5, pioggia: 1 },
        { t: DURATA, pioggia: 0 },
    ] };
    assert.equal(M.previsione(prof, 0), 'arrivo', 'la pioggia in mezzo alla gara e\' passata inosservata');
    assert.equal(M.previsione(prof, DURATA * 0.5), 'variabile', 'sotto il diluvio deve annunciare che schiarisce');
    assert.equal(M.previsione(prof, DURATA), 'stabile');
});

// Un anello di raggio R campionato N volte: l'unica pista di cui si conosce a
// mano la lunghezza, quindi l'unica su cui si possono verificare le celle.
function pistaFinta(raggio, campioni, mezza) {
    const pts = [];
    for (let i = 0; i < campioni; i++) {
        const a = (i / campioni) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * raggio, z: Math.sin(a) * raggio, y: 0, halfWidth: mezza });
    }
    return pts;
}

test('celle: il passo si misura sull\'arco, non in campioni', () => {
    const raggio = 200;
    const pts = pistaFinta(raggio, 1000, 11);
    const { nCelle, perCampione } = M.celleDeiCampioni(pts);
    const lunghezza = 2 * Math.PI * raggio;
    const attese = Math.round(lunghezza / M.PASSO_CELLA);
    assert.ok(Math.abs(nCelle - attese) <= 1, `celle ${nCelle}, attese ~${attese}`);
    assert.equal(perCampione.length, pts.length);
    assert.equal(perCampione[0], 0);
    // Due piste con la stessa lunghezza ma un numero di campioni diverso
    // devono avere lo STESSO numero di celle: e' il senso di misurare sull'arco.
    const rade = M.celleDeiCampioni(pistaFinta(raggio, 300, 11));
    assert.ok(Math.abs(rade.nCelle - nCelle) <= 1, 'il numero di celle dipende dai campioni, non dalla lunghezza');
});

test('griglia: la pioggia bagna tutto, il passaggio asciuga solo la sua corsia', () => {
    const pts = pistaFinta(200, 1000, 11);
    const g = M.nuovaGriglia(pts, 0);
    assert.equal(M.bagnatoIn(g, 0, 0), 0, 'una pista nuova deve nascere asciutta');

    // Venti secondi di diluvio: satura.
    for (let i = 0; i < 20; i++) M.avanza(g, 1000, 1, []);
    assert.ok(M.bagnatoIn(g, 0, 0) > 0.95, 'venti secondi di diluvio devono saturare la pista');

    // Smette di piovere e un'auto passa in mezzo, cinquanta volte, mentre al
    // bordo non passa nessuno.
    const prima = M.bagnatoIn(g, 500, 0);
    for (let i = 0; i < 50; i++) {
        M.avanza(g, 20, 0, [{ campione: 500, scostamentoNorm: 0, distanza: M.PASSO_CELLA }]);
    }
    assert.ok(M.bagnatoIn(g, 500, 0) < prima - 0.3, 'i passaggi non asciugano');
    assert.ok(M.bagnatoIn(g, 500, 1) > M.bagnatoIn(g, 500, 0) + 0.2,
        'il bordo si e\' asciugato come la traiettoria: la linea asciutta non si forma');
    assert.ok(M.bagnatoIn(g, 200, 0) > M.bagnatoIn(g, 500, 0) + 0.2,
        'si e\' asciugata anche una cella dove non e\' passato nessuno');
});

test('griglia: la lettura e interpolata, senza scalini fra corsie', () => {
    const pts = pistaFinta(200, 1000, 11);
    const g = M.nuovaGriglia(pts, 1);
    for (let i = 0; i < 40; i++) {
        M.avanza(g, 20, 0, [{ campione: 500, scostamentoNorm: -1, distanza: M.PASSO_CELLA }]);
    }
    // Camminando da un bordo all'altro il valore non deve saltare.
    let precedente = M.bagnatoIn(g, 500, -1);
    for (let t = -1; t <= 1; t += 0.05) {
        const v = M.bagnatoIn(g, 500, t);
        assert.ok(Math.abs(v - precedente) < 0.2, `scalino fra corsie a t=${t.toFixed(2)}`);
        precedente = v;
    }
});

test('griglia: niente valori fuori scala, nemmeno insistendo', () => {
    const pts = pistaFinta(200, 1000, 11);
    const g = M.nuovaGriglia(pts, 0.5);
    for (let i = 0; i < 500; i++) {
        M.avanza(g, 50, 1, [{ campione: 10, scostamentoNorm: 0, distanza: 50 }]);
    }
    for (let i = 0; i < g.valori.length; i++) {
        assert.ok(g.valori[i] >= 0 && g.valori[i] <= 1, `valore fuori scala in cella ${i}: ${g.valori[i]}`);
    }
});
