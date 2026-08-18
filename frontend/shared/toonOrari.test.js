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

test('il notturno NON spegne il mondo: le superfici restano illuminate', () => {
    // È l'errore che è costato due stesure e tre playtest. Facevo «notte =
    // tutto scuro» — la tinta stava a luma 0.28 — e ogni volta la correzione
    // era «schiarisci un po' di più»: cercare la risposta dentro un
    // intervallo che non la conteneva.
    //
    // Una gara in notturno vera è tutto ILLUMINATO sotto un cielo NERO. A
    // dire «è notte» sono il cielo, le sorgenti accese e il fondo che
    // sparisce nel nero — non la luminosità delle superfici. E c'è una
    // conseguenza che spiega il difetto peggiore: un'ombra ha bisogno di luce
    // per esistere, quindi scurendo tutto si spengono anche le ombre.
    assert.equal(P.ORARI.giorno.tinta, 0xffffff, 'di giorno il moltiplicatore è neutro');

    const notte = P.hexToRgb(P.ORARI.notte.tinta);
    const luma = 0.299 * notte.r + 0.587 * notte.g + 0.114 * notte.b;
    const forza = luma * P.ORARI.notte.guadagno;

    assert.ok(forza > 0.7,
        `di notte il mondo resta illuminato: le superfici devono restare almeno al 70% del giorno, sono al ${(forza * 100).toFixed(0)}%`);
    assert.ok(forza < 1,
        'ma qualcosa deve pur distinguere la notte dal giorno');
    assert.ok(notte.b > notte.r,
        'a raffreddare la tinta è la luce artificiale: vira al freddo, non al grigio');
});

test('il notturno è uno STADIO acceso, non un chiaro di luna', () => {
    // Quarta bocciatura di fila, e stavolta per il colore: «sembra che c'è la
    // luce della luna ad illuminare, niente di più».
    //
    // Il codice visivo del chiaro di luna è una dominante AZZURRA. Un
    // proiettore da stadio è bianco — metallo-alogenuri o LED intorno ai
    // 5000 K — che a schermo si legge neutro, appena freddo. La differenza
    // fra le due cose non è quanta luce c'è: è di che colore è.
    const dominante = (hex) => {
        const c = P.hexToRgb(hex);
        return (c.b - c.r) * 255;
    };

    // Soglia: sopra i ~20 punti su 255 l'occhio legge «azzurro», e siamo di
    // nuovo sulla luna. I valori bocciati erano 36 (tinta), 34 (luce) e 23
    // (nebbia).
    const LIMITE = 20;

    assert.ok(dominante(P.ORARI.notte.tinta) < LIMITE,
        `la tinta delle superfici non deve essere azzurra: ${dominante(P.ORARI.notte.tinta).toFixed(0)} punti`);
    assert.ok(dominante(P.ORARI.notte.sole.colore) < LIMITE,
        `la luce non deve essere azzurra: ${dominante(P.ORARI.notte.sole.colore).toFixed(0)} punti`);

    // La nebbia è il colore in cui sprofonda tutto ciò che è lontano: se è
    // azzurra, è azzurro metà di quel che si vede.
    P.impostaOrario('notte');
    assert.ok(dominante(P.fogColor()) < LIMITE,
        `la nebbia non deve essere azzurra: ${dominante(P.fogColor()).toFixed(0)} punti`);
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

test('di notte l\'asfalto è più chiaro che di giorno, e le fasce restano separate', () => {
    const luma = (hex) => {
        const c = P.hexToRgb(hex);
        return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    };

    // Il numero che conta non è la tinta ma la tinta PER IL GUADAGNO: un
    // esadecimale si ferma a 1.0 e può solo scurire. Il guadagno rompe quel
    // tetto, ed è l'unico modo perché una superficie diventi più chiara del
    // proprio colore invece di limitarsi a non scurire.
    const forzaPista = luma(P.ORARI.notte.tintaPista) * P.ORARI.notte.guadagnoPista;
    const asfaltoGiorno = luma(P.SURFACES.asphalt);
    const asfaltoNotte = asfaltoGiorno * forzaPista;

    // L'asfalto è la superficie su cui le torri faro sono puntate: di notte è
    // il punto più illuminato del circuito, più di quanto lo sia di giorno.
    assert.ok(asfaltoNotte > asfaltoGiorno,
        `l'asfalto illuminato deve battere quello diurno: ${asfaltoNotte.toFixed(2)} contro ${asfaltoGiorno.toFixed(2)}`);

    // Ma non deve sfondare: oltre il bianco pieno le tre fasce del cel
    // shading si schiacciano lassù, ed è lo stesso difetto delle luci troppo
    // forti misurato il 2026-08-10, preso dall'altro lato.
    const fasce = P.BANDS.map((b) => asfaltoNotte * b);
    assert.ok(fasce[2] < 1, `la fascia più chiara non deve bruciare: ${fasce[2].toFixed(2)}`);
    assert.ok(fasce[1] - fasce[0] > 0.05 && fasce[2] - fasce[1] > 0.05,
        `le tre fasce devono restare distinguibili: ${fasce.map((f) => f.toFixed(2)).join(' / ')}`);

    // L'illuminazione è UNIFORME (richiesta dell'utente: la luce non arriva
    // davvero dai fari): fra pista e dintorni ci deve essere una differenza,
    // ma piccola. Un rapporto grande vorrebbe dire il nastro dentro il buio
    // della stesura precedente, che è stata bocciata.
    const forzaBuio = luma(P.ORARI.notte.tinta) * P.ORARI.notte.guadagno;
    const rapporto = forzaPista / forzaBuio;
    assert.ok(rapporto > 1.2 && rapporto < 2.5,
        `pista e dintorni devono essere illuminati in modo simile, rapporto = ${rapporto.toFixed(2)}`);

    assert.equal(P.ORARI.giorno.tintaPista, 0xffffff, 'di giorno nessuna tinta tinge niente');
    assert.equal(P.ORARI.giorno.guadagnoPista, 1, 'e nessun guadagno schiarisce niente');
});

test('di notte la luce viene dall\'alto: l\'ombra è corta, non allungata', () => {
    // Una torre faro illumina da trenta metri sopra la pista, non di taglio
    // come un sole di pomeriggio. È una delle cose che si riconoscono subito
    // in una gara notturna, e si misura sulla lunghezza dell'ombra di un
    // oggetto alto 1: 1 / tan(elevazione).
    const notte = P.ORARI.notte.sole.elevazione;
    assert.ok(notte > 70, `la luce notturna deve venire quasi da sopra, è a ${notte} gradi`);

    const ombra = 1 / Math.tan(notte * Math.PI / 180);
    assert.ok(ombra < 0.35, `l'ombra deve essere corta, è lunga ${ombra.toFixed(2)}`);

    assert.equal(P.ORARI.giorno.sole.elevazione, null,
        'di giorno l\'inclinazione resta quella scritta nella posizione della luce, invariata');
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
