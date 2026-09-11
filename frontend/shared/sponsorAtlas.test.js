// frontend/shared/sponsorAtlas.test.js
//
// I venti sponsor inventati dei cartelloni a bordo pista (spec 2026-09-04,
// rifatti il 2026-09-11: tinte da insegna stampata e cartelloni A RUN).
const test = require('node:test');
const assert = require('node:assert/strict');
const SponsorAtlas = require('./sponsorAtlas.js');

// Rapporto di contrasto WCAG fra due tinte. Serve per chiedere la sola cosa
// che conta di una coppia fondo/testo: si legge, passandoci davanti?
function contrasto(a, b) {
    const canale = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const luma = (v) => 0.2126 * canale((v >> 16) & 255)
                      + 0.7152 * canale((v >> 8) & 255)
                      + 0.0722 * canale(v & 255);
    const la = luma(a), lb = luma(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// I confini fra un cartellone e il successivo NON sono piu' tutti confini di
// sponsor: dentro un run lo sponsor resta lo stesso. Questa funzione riduce
// una sequenza di pannelli alla lista dei run che la compongono.
function runDi(seq) {
    const out = [];
    for (const k of seq) {
        if (out.length && out[out.length - 1].pannello === k) out[out.length - 1].lungo++;
        else out.push({ pannello: k, lungo: 1 });
    }
    return out;
}

const PISTE = ['new-monza', 'banking-prova', 'prova', 'citta-prova', 'monte-rosso', 'loop-prova'];

test('venti pannelli, ognuno con nome, due tinte e una famiglia di colore', () => {
    assert.equal(SponsorAtlas.PANNELLI.length, 20);
    for (const p of SponsorAtlas.PANNELLI) {
        assert.match(p.nome, /^[A-Z]{4,9}$/, `nome strano: ${p.nome}`);
        assert.equal(typeof p.fondo, 'number');
        assert.equal(typeof p.testo, 'number');
        assert.match(p.famiglia, /^[a-z]+$/, `famiglia strana su ${p.nome}: ${p.famiglia}`);
    }
});

test('i nomi sono tutti diversi', () => {
    const nomi = SponsorAtlas.PANNELLI.map(p => p.nome);
    assert.equal(new Set(nomi).size, nomi.length);
});

test('ogni sponsor ha la SUA coppia di colori, non una presa a rotazione', () => {
    // Prima le coppie erano sei e ruotavano sui venti nomi: un marchio su sei
    // portava il vestito di un altro, e nel giro capitavano due cartelloni
    // identici di colore con sopra due nomi diversi. Un marchio vero ha i
    // suoi colori e sempre quelli.
    const fondi = SponsorAtlas.PANNELLI.map(p => p.fondo);
    assert.equal(new Set(fondi).size, fondi.length, 'due sponsor con lo stesso fondo');
});

test('tutte e venti le coppie si leggono a velocita\' di gara', () => {
    // ⚠️ La soglia e' quella del testo grande (3.5): sotto, la scritta si
    // impasta col fondo e il cartellone diventa una macchia di colore. E'
    // l'unico controllo che impedisce a una tinta nuova, scelta perche'
    // «bella», di entrare illeggibile.
    for (const p of SponsorAtlas.PANNELLI) {
        const r = contrasto(p.fondo, p.testo);
        assert.ok(r >= 3.5, `${p.nome}: contrasto ${r.toFixed(2)}, sotto 3.5`);
    }
});

test('la stessa pista mostra sempre gli stessi cartelloni', () => {
    const a = SponsorAtlas.sequenza('new-monza', 50);
    const b = SponsorAtlas.sequenza('new-monza', 50);
    assert.deepEqual(a, b);
    // E piste diverse non mostrano la stessa fila.
    assert.notDeepEqual(a, SponsorAtlas.sequenza('banking-prova', 50));
});

test('lo stesso sponsor tiene una fila di cartelloni, non uno solo', () => {
    // E' la richiesta dell'utente (2026-09-11): «nella realta' abbiamo diversi
    // cartelloni contigui tutti dello stesso sponsor e non un cambio
    // frequente». Un run lungo RUN_MIN..RUN_MAX pannelli da 12 unita' fa
    // un'insegna continua lunga come due-quattro larghezze di pista.
    for (const id of PISTE) {
        const run = runDi(SponsorAtlas.sequenza(id, 200));
        // L'ULTIMO no: la sequenza si tronca a `quanti`, e il run finale
        // arriva tagliato. Tutti gli altri devono essere interi.
        run.slice(0, -1).forEach((r, i) => {
            assert.ok(r.lungo >= SponsorAtlas.RUN_MIN && r.lungo <= SponsorAtlas.RUN_MAX,
                `${id}: il run ${i} e' lungo ${r.lungo}, fuori da ${SponsorAtlas.RUN_MIN}-${SponsorAtlas.RUN_MAX}`);
        });
        assert.ok(run.length > 20, `${id}: solo ${run.length} run su 200 pannelli`);
    }
});

test('due run vicini non hanno mai lo stesso sponsor', () => {
    // Dentro il run l'uniformita' e' voluta; al confine serve lo stacco,
    // altrimenti due run attaccati dello stesso marchio diventano un run solo
    // lungo il doppio e la regola sulla lunghezza non vuol dire piu' niente.
    for (const id of PISTE) {
        const run = runDi(SponsorAtlas.sequenza(id, 200));
        for (let k = 1; k < run.length; k++) {
            assert.notEqual(run[k].pannello, run[k - 1].pannello,
                `${id}: due run uguali attaccati alla posizione ${k}`);
        }
    }
});

test('due run vicini non sono quasi mai della stessa famiglia di colore', () => {
    // ⚠️ NON BASTA CHE SIANO SPONSOR DIVERSI. Il confine fra due run si vede
    // solo se cambia la tinta: due insegne rosse attaccate si leggono come
    // un'unica insegna lunghissima con due nomi sopra, che e' il «sembra tutto
    // uguale» da cui nasce questo lavoro.
    //
    // «Quasi mai» e non «mai»: in fondo a un sacchetto puo' non restare nessuno
    // sponsor di famiglia diversa, e li' si accetta la ripetizione invece di
    // rompere il giro completo dei venti.
    const fam = (k) => SponsorAtlas.PANNELLI[k].famiglia;
    for (const id of PISTE) {
        const run = runDi(SponsorAtlas.sequenza(id, 200));
        let vicini = 0;
        for (let k = 1; k < run.length; k++) {
            if (fam(run[k].pannello) === fam(run[k - 1].pannello)) vicini++;
        }
        assert.ok(vicini <= 2, `${id}: ${vicini} confini di run con la stessa famiglia su ${run.length}`);
    }
});

test('la sequenza usa tutti e venti gli sponsor su un giro lungo', () => {
    // ⚠️ Su OGNI pista, non solo su una fortunata: e' la differenza fra una
    // distribuzione sana e un seme che e' andato bene per caso.
    for (const id of PISTE) {
        const seq = SponsorAtlas.sequenza(id, 200);
        assert.equal(new Set(seq).size, SponsorAtlas.PANNELLI.length,
            `${id}: usati solo ${new Set(seq).size} sponsor su ${SponsorAtlas.PANNELLI.length}`);
    }
});

test('i primi venti run non ripetono uno sponsor prima di averli visti tutti', () => {
    // E' cio' che rende il sacchetto diverso dal caso puro: pescando a caso,
    // quaranta run mostrerebbero tredici o quattordici marchi, e il giocatore
    // vedrebbe gli stessi due o tre tornare a ogni curva.
    for (const id of PISTE) {
        const run = runDi(SponsorAtlas.sequenza(id, 20 * SponsorAtlas.RUN_MAX));
        const primi = run.slice(0, 20).map(r => r.pannello);
        assert.equal(new Set(primi).size, 20, `${id}: i primi venti run usano ${new Set(primi).size} sponsor`);
    }
});

test('un run copre piu\' di una larghezza di pista, ma non un settore intero', () => {
    // La pista e' larga 22 e un pannello e' lungo 12: il run piu' corto fa
    // un'insegna da 48 unita', il piu' lungo 84. Sotto le due larghezze di
    // pista non si legge come una fila; sopra le quattro, su monte-rosso
    // (95 pannelli sul giro) un marchio solo prenderebbe un settore.
    const L = SponsorAtlas.LUNGHEZZA_PANNELLO;
    assert.ok(L > 6 && L < 20, `LUNGHEZZA_PANNELLO e' ${L}`);
    assert.ok(SponsorAtlas.RUN_MIN * L >= 44, `il run minimo e' lungo ${SponsorAtlas.RUN_MIN * L}`);
    assert.ok(SponsorAtlas.RUN_MAX * L <= 88, `il run massimo e' lungo ${SponsorAtlas.RUN_MAX * L}`);
});
