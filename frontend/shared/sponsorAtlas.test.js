// frontend/shared/sponsorAtlas.test.js
//
// I venti sponsor inventati dei cartelloni a bordo pista (spec 2026-09-04).
const test = require('node:test');
const assert = require('node:assert/strict');
const SponsorAtlas = require('./sponsorAtlas.js');

test('venti pannelli, tutti con nome e due tinte', () => {
    assert.equal(SponsorAtlas.PANNELLI.length, 20);
    for (const p of SponsorAtlas.PANNELLI) {
        assert.match(p.nome, /^[A-Z]{4,9}$/, `nome strano: ${p.nome}`);
        assert.equal(typeof p.fondo, 'number');
        assert.equal(typeof p.banda, 'number');
    }
});

test('i nomi sono tutti diversi', () => {
    const nomi = SponsorAtlas.PANNELLI.map(p => p.nome);
    assert.equal(new Set(nomi).size, nomi.length);
});

test('la stessa pista mostra sempre gli stessi cartelloni', () => {
    const a = SponsorAtlas.sequenza('melbourne', 50);
    const b = SponsorAtlas.sequenza('melbourne', 50);
    assert.deepEqual(a, b);
    // E piste diverse non mostrano la stessa fila.
    assert.notDeepEqual(a, SponsorAtlas.sequenza('suzuka', 50));
});

test('due cartelloni uguali non stanno mai attaccati', () => {
    // Il difetto da cui nasce tutto questo lavoro e' «sembra tutto uguale»:
    // due pannelli identici di fila lo riproducono in piccolo.
    for (const id of ['melbourne', 'suzuka', 'prova', 'citta-prova']) {
        const seq = SponsorAtlas.sequenza(id, 200);
        for (let k = 1; k < seq.length; k++) {
            assert.notEqual(seq[k], seq[k - 1], `${id}: due uguali in fila alla posizione ${k}`);
        }
    }
});

test('due cartelloni vicini non hanno quasi mai la stessa tinta', () => {
    // ⚠️ NON BASTA CHE SIANO SPONSOR DIVERSI. I nomi sono venti e le coppie
    // fondo/banda sei: pescando senza guardare il colore, un vicino su sei
    // avrebbe lo stesso schema, e due cartelloni con lo stesso fondo uno
    // accanto all'altro si leggono come un unico pannello lungo con due
    // scritte sopra. Visto in un render dell'atlante: ALTAVIA e KILOVOLT,
    // arancio su antracite tutti e due, senza piu' un confine.
    //
    // «Quasi mai» e non «mai»: verso la fine di un sacchetto puo' non restare
    // nessun pannello di tinta diversa, e li' si accetta la ripetizione invece
    // di rompere il giro completo dei venti. A caso puro sarebbero 33 su 199.
    const Palette = require('./toonPalette.js');
    const tinte = Palette.CITTA_SPONSOR.length;
    for (const id of ['melbourne', 'suzuka', 'prova', 'citta-prova', 'monte-rosso']) {
        const seq = SponsorAtlas.sequenza(id, 200);
        let vicini = 0;
        for (let k = 1; k < seq.length; k++) {
            if (seq[k] % tinte === seq[k - 1] % tinte) vicini++;
        }
        assert.ok(vicini <= 5, `${id}: ${vicini} coppie di vicini con la stessa tinta`);
    }
});

test('la sequenza usa tutti e venti i pannelli su un giro lungo', () => {
    // ⚠️ Su OGNI pista, non solo su una fortunata: e' la differenza fra una
    // distribuzione sana e un seme che e' andato bene per caso.
    for (const id of ['melbourne', 'suzuka', 'prova', 'citta-prova', 'monte-rosso', 'shanghai']) {
        const seq = SponsorAtlas.sequenza(id, 200);
        assert.equal(new Set(seq).size, SponsorAtlas.PANNELLI.length,
            `${id}: usati solo ${new Set(seq).size} pannelli su ${SponsorAtlas.PANNELLI.length}`);
    }
});

test('un giro corto non ripete un pannello prima di averli visti tutti', () => {
    // Con venti cartelloni e venti posti, si vedono venti sponsor diversi.
    // E' cio' che rende il sacchetto diverso dal caso puro: quaranta pannelli
    // pescati a caso ne mostrerebbero tredici o quattordici.
    const seq = SponsorAtlas.sequenza('prova', SponsorAtlas.PANNELLI.length);
    assert.equal(new Set(seq).size, SponsorAtlas.PANNELLI.length);
});

test('la lunghezza di un pannello e\' una misura di gioco sensata', () => {
    // La pista e' larga 22: un cartellone da 12 e' poco piu' di mezza
    // carreggiata, la proporzione dei pannelli veri a bordo pista.
    assert.ok(SponsorAtlas.LUNGHEZZA_PANNELLO > 6 && SponsorAtlas.LUNGHEZZA_PANNELLO < 20,
        `LUNGHEZZA_PANNELLO e' ${SponsorAtlas.LUNGHEZZA_PANNELLO}`);
});
