// frontend/shared/toonOrari.test.js
//
// Giorno e notte nel look cel-shaded.
//
// L'invariante da proteggere è controintuitiva, ed è la ragione per cui
// questo file esiste: **la notte non si fa abbassando le luci**.
//
// Il cel shading aggancia l'irradianza a tre fasce fisse (`BANDS`), e quelle
// fasce hanno senso solo se la somma delle intensità delle luci resta intorno
// a 1. Sopra, le fasce finiscono tutte oltre il tetto della scala e si
// schiacciano — misurato al playtest del 2026-08-10 con 0.95+1.15: su un
// colore chiaro davano 0.972/0.979/0.982 a schermo, cioè un punto percentuale
// di stacco, e la livrea appariva piatta. Sotto succede la stessa cosa dal
// lato opposto.
//
// Quindi il primo test qui sotto è il più importante di tutti: se un giorno
// qualcuno "farà notte" abbassando `intensita`, questo diventa rosso e spiega
// perché.
const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('./toonPalette.js');

test.afterEach(() => P.impostaOrario('giorno'));

test('la notte NON abbassa le luci: la somma delle intensità resta quella del giorno', () => {
    const giorno = P.ORARI.giorno;
    const notte = P.ORARI.notte;

    const sommaGiorno = giorno.hemi.intensita + giorno.sole.intensita;
    const sommaNotte = notte.hemi.intensita + notte.sole.intensita;

    assert.equal(sommaNotte, sommaGiorno,
        'cambiare le intensità sposta le fasce del cel shading: la notte si fa sul colore');
    assert.ok(sommaNotte > 0.9 && sommaNotte < 1.1,
        `la somma deve restare intorno a 1, è ${sommaNotte}`);
});

test('a scurire è la tinta delle superfici, e di giorno non tinge niente', () => {
    assert.equal(P.ORARI.giorno.tinta, 0xffffff, 'di giorno il moltiplicatore è neutro');

    const notte = P.hexToRgb(P.ORARI.notte.tinta);
    const luma = 0.299 * notte.r + 0.587 * notte.g + 0.114 * notte.b;
    assert.ok(luma > 0.2 && luma < 0.55,
        `la tinta notturna deve scurire ma non spegnere, luma = ${luma.toFixed(2)}`);
    assert.ok(notte.b > notte.r,
        'di notte quel che resta a illuminare è il cielo: la tinta vira al freddo');
});

test('il cielo notturno è scuro, e l\'orizzonte resta più chiaro dello zenit', () => {
    P.impostaOrario('notte');

    const orizzonte = P.hexToRgb(P.skyColorAt(0));
    const zenit = P.hexToRgb(P.skyColorAt(1));
    const lumaOrizzonte = 0.299 * orizzonte.r + 0.587 * orizzonte.g + 0.114 * orizzonte.b;
    const lumaZenit = 0.299 * zenit.r + 0.587 * zenit.g + 0.114 * zenit.b;

    assert.ok(lumaZenit < 0.12, `lo zenit deve essere quasi nero, è ${lumaZenit.toFixed(3)}`);
    assert.ok(lumaOrizzonte > lumaZenit,
        'l\'orizzonte è il cielo sopra uno stadio acceso: più chiaro dello zenit');
    // Non nero: la nebbia PRENDE il colore dell'orizzonte, e su un orizzonte
    // nero il circuito lontano finirebbe contro un muro invece di sfumare.
    assert.ok(lumaOrizzonte > 0.05,
        'un orizzonte nero renderebbe la nebbia un muro, non una foschia');
});

test('la nebbia è il cielo all\'orizzonte, di notte come di giorno', () => {
    for (const orario of ['giorno', 'notte']) {
        P.impostaOrario(orario);
        assert.equal(P.fogColor(), P.skyColorAt(0),
            `${orario}: definirla così rende impossibile la riga di stacco fra terreno e cielo`);
    }
});

test('il nastro d\'asfalto resta chiaro anche di notte: è quello a fare la gara in notturno', () => {
    // Senza questa differenza il risultato è «una scena scura», non «una gara
    // in notturno». Bocciato al playtest del 2026-08-18 esattamente così.
    const buio = P.hexToRgb(P.ORARI.notte.tinta);
    const pista = P.hexToRgb(P.ORARI.notte.tintaPista);
    const luma = (c) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;

    assert.ok(luma(pista) > luma(buio) * 1.8,
        `l'asfalto illuminato deve staccare nettamente dal buio: ${luma(pista).toFixed(2)} contro ${luma(buio).toFixed(2)}`);
    assert.ok(luma(pista) < 0.95, 'ma non essere bianco: è asfalto illuminato, non una lampadina');
    assert.equal(P.ORARI.giorno.tintaPista, 0xffffff, 'di giorno nessuna delle due tinte tinge niente');
});

test('di notte si vede meno lontano', () => {
    P.impostaOrario('giorno');
    const giorno = P.fogDensity();
    P.impostaOrario('notte');
    assert.ok(P.fogDensity() > giorno, 'la nebbia notturna deve chiudere prima');
});

test('cambiare orario e tornare indietro non lascia tracce', () => {
    const primaStops = P.SKY_STOPS.map((s) => `${s.t}:${s.color}`).join('|');
    const primaNebbia = P.fogColor();

    P.impostaOrario('notte');
    assert.notEqual(P.fogColor(), primaNebbia);

    P.impostaOrario('giorno');
    assert.equal(P.SKY_STOPS.map((s) => `${s.t}:${s.color}`).join('|'), primaStops,
        'SKY_STOPS viene riscritto in posto: se lo si condivide per riferimento, si svuota');
    assert.equal(P.fogColor(), primaNebbia);
});

test('le due tavolozze hanno lo stesso numero di tappe', () => {
    // La cupola del cielo compila il proprio shader sul NUMERO di tappe
    // (toonSky.js: `uColors[' + stops.length + ']`). Cambiarlo fra giorno e
    // notte non aggiornerebbe le uniform: richiederebbe di ricompilare, cioè
    // uno scatto visibile in mezzo alla partita.
    assert.equal(P.ORARI.notte.skyStops.length, P.ORARI.giorno.skyStops.length);
});

test('un orario che non esiste è un errore, non un ripiego silenzioso', () => {
    assert.throws(() => P.impostaOrario('pomeriggio'), /Orario sconosciuto/);
});
