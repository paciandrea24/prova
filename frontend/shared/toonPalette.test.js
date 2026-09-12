const test = require('node:test');
const assert = require('node:assert/strict');
const ToonPalette = require('./toonPalette.js');

// La regola di sicurezza dell'intero cielo: la nebbia NON è un colore
// scelto a parte, è il gradiente del cielo alla quota dell'orizzonte. Con
// due colori indipendenti resta visibile la linea di stacco fra prato e
// cielo — è già successo il 2026-08-09 e l'utente l'ha segnalata.
test('la nebbia coincide col cielo all orizzonte', () => {
    assert.equal(ToonPalette.fogColor(), ToonPalette.skyColorAt(0));
});

test('il gradiente del cielo rispetta gli estremi dichiarati', () => {
    const stops = ToonPalette.SKY_STOPS;
    assert.equal(ToonPalette.skyColorAt(0), stops[0].color);
    assert.equal(ToonPalette.skyColorAt(1), stops[stops.length - 1].color);
});

test('il gradiente del cielo non ha salti bruschi', () => {
    // Campionandolo fitto, due campioni vicini non devono differire di più
    // di 12 livelli per canale: un salto più grande si vedrebbe come banda
    // netta in cielo.
    let prev = ToonPalette.hexToRgb(ToonPalette.skyColorAt(0));
    for (let i = 1; i <= 200; i++) {
        const cur = ToonPalette.hexToRgb(ToonPalette.skyColorAt(i / 200));
        for (const ch of ['r', 'g', 'b']) {
            const delta = Math.abs(cur[ch] - prev[ch]) * 255;
            assert.ok(delta <= 12, `salto di ${delta.toFixed(1)} sul canale ${ch} a t=${i / 200}`);
        }
        prev = cur;
    }
});

test('t fuori intervallo viene bloccato agli estremi', () => {
    assert.equal(ToonPalette.skyColorAt(-3), ToonPalette.skyColorAt(0));
    assert.equal(ToonPalette.skyColorAt(9), ToonPalette.skyColorAt(1));
});

test('saturare di zero lascia il colore identico', () => {
    for (const hex of [0x3d8b3d, 0xffffff, 0x000000, 0x1e63c8]) {
        assert.equal(ToonPalette.saturate(hex, 0), hex);
    }
});

test('saturare aumenta la distanza dal grigio senza spostare la tinta', () => {
    // Il colore del pilota deve restare riconoscibile: la correzione alza la
    // saturazione ma non ruota la tinta, altrimenti due livree diverse
    // potrebbero avvicinarsi e il pallino della classifica non
    // corrisponderebbe più all'auto in pista.
    const before = ToonPalette.hexToRgb(0x8b3d3d);
    const after = ToonPalette.hexToRgb(ToonPalette.saturate(0x8b3d3d, 0.3));
    const lumaBefore = 0.299 * before.r + 0.587 * before.g + 0.114 * before.b;
    const lumaAfter = 0.299 * after.r + 0.587 * after.g + 0.114 * after.b;
    const spreadBefore = Math.max(before.r, before.g, before.b) - Math.min(before.r, before.g, before.b);
    const spreadAfter = Math.max(after.r, after.g, after.b) - Math.min(after.r, after.g, after.b);
    assert.ok(spreadAfter > spreadBefore, 'la saturazione non è aumentata');
    assert.ok(Math.abs(lumaAfter - lumaBefore) < 0.02, 'la luminosità è cambiata troppo');
    // canale dominante invariato = tinta invariata
    assert.ok(after.r > after.g && after.r > after.b, 'il canale dominante è cambiato');
});

test('saturare non produce mai canali fuori scala', () => {
    for (const hex of [0xff0000, 0x00ff00, 0x0000ff, 0xfefefe, 0x010101]) {
        const out = ToonPalette.saturate(hex, 0.9);
        assert.ok(out >= 0 && out <= 0xffffff, `colore fuori scala: ${out}`);
        const rgb = ToonPalette.hexToRgb(out);
        for (const ch of ['r', 'g', 'b']) {
            assert.ok(rgb[ch] >= 0 && rgb[ch] <= 1, `canale ${ch} fuori da [0,1]`);
        }
    }
});

test('le fasce di luce sono crescenti e arrivano a 1', () => {
    const b = ToonPalette.BANDS;
    assert.ok(b.length >= 2, 'servono almeno due fasce');
    for (let i = 1; i < b.length; i++) assert.ok(b[i] > b[i - 1], 'fasce non crescenti');
    assert.equal(b[b.length - 1], 1);
    assert.ok(b[0] > 0, 'la fascia più scura non può essere nera piena');
});

test('i colori delle superfici sono interi validi', () => {
    for (const [nome, hex] of Object.entries(ToonPalette.SURFACES)) {
        if (Array.isArray(hex)) {
            assert.equal(hex.length, 3, `${nome}: servono tre canali`);
            for (const c of hex) assert.ok(c >= 0 && c <= 1, `${nome}: canale fuori da [0,1]`);
        } else {
            assert.ok(Number.isInteger(hex) && hex >= 0 && hex <= 0xffffff, `${nome} non è un colore valido`);
        }
    }
});

test('andata e ritorno fra hex e rgb', () => {
    for (const hex of [0x000000, 0xffffff, 0x3fa86b, 0x5e6b75]) {
        assert.equal(ToonPalette.rgbToHex(ToonPalette.hexToRgb(hex)), hex);
    }
});


// I test del temporale sono scritti con `P`, come nel piano.
const P = ToonPalette;

test('temporale: la luce non cala, cambiano cielo e nebbia', () => {
    P.impostaOrario('giorno');
    P.applicaMeteo(0);
    const soleAsciutto = P.orario().sole.intensita;
    const hemiAsciutto = P.orario().hemi.intensita;
    const cieloAsciutto = P.skyColorAt(0.5);
    const nebbiaAsciutto = P.fogDensity();

    P.applicaMeteo(1);
    assert.equal(P.orario().sole.intensita, soleAsciutto,
        'la pioggia ha abbassato il sole: il cel shading si spegne, le fasce si schiacciano');
    assert.equal(P.orario().hemi.intensita, hemiAsciutto, 'la pioggia ha toccato la luce d\'ambiente');
    assert.notEqual(P.skyColorAt(0.5), cieloAsciutto, 'il cielo non e\' cambiato');
    assert.ok(P.fogDensity() > nebbiaAsciutto * 1.5, 'la nebbia non si e\' avvicinata');

    // Il cielo del temporale deve essere GRIGIO, non azzurro sporco: le tre
    // componenti stanno vicine fra loro.
    const c = P.hexToRgb(P.skyColorAt(0.5));
    assert.ok(Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 0.12,
        `il cielo del temporale ha una dominante: ${JSON.stringify(c)}`);
});

test('temporale: di notte resta NOTTE, di giorno diventa grigio', () => {
    // ⚠️ Due difetti opposti, presi uno dopo l'altro.
    //
    // Il primo: il temporale aveva quattro tinte fisse di grigio, e di notte
    // portava il cielo dal nero-blu (luminanza 0.009) al piombo del giorno
    // (0.355) — quaranta volte piu' chiaro. Su una pista notturna la pioggia
    // faceva l'alba.
    //
    // Il secondo, correggendo il primo: il cielo coperto scendeva a 0.004, cioe'
    // piu' scuro della notte serena, e il temporale spariva. Ma un cielo coperto
    // non e' mai nero — le nuvole basse rimandano giu' la luce che trovano, e in
    // un circuito illuminato ce n'e' parecchia. L'utente l'ha detto guardandolo:
    // «un po' piu' scuro rispetto alle gare di giorno, che fa diventare il cielo
    // semplicemente grigio».
    //
    // Quindi il criterio non e' «la notte non cambia», e' «la notte resta
    // notte»: piu' chiara di com'era serena, molto piu' scura del giorno.
    const luminanza = (hex) => { const c = P.hexToRgb(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
    const cielo = (orario, pioggia) => { P.impostaOrario(orario); P.applicaMeteo(pioggia); return luminanza(P.skyColorAt(1)); };

    const giornoSereno = cielo('giorno', 0);
    const giornoPiovoso = cielo('giorno', 1);
    const notteSerena = cielo('notte', 0);
    const nottePiovosa = cielo('notte', 1);

    assert.ok(giornoPiovoso < giornoSereno * 0.8,
        `di giorno il temporale non scurisce abbastanza: da ${giornoSereno.toFixed(3)} a ${giornoPiovoso.toFixed(3)}`);
    assert.ok(nottePiovosa < giornoPiovoso / 3,
        `la notte piovosa (${nottePiovosa.toFixed(3)}) non e' molto piu' scura del giorno piovoso (${giornoPiovoso.toFixed(3)}): sembrerebbe l'alba`);
    assert.ok(nottePiovosa > notteSerena,
        `la notte piovosa (${nottePiovosa.toFixed(3)}) e' scura quanto quella serena (${notteSerena.toFixed(3)}): il temporale non si vede`);
    // E il grigio deve essere grigio a ogni ora: nessuna dominante, perche'
    // l'orizzonte e' anche il colore della nebbia.
    for (const orario of ['giorno', 'notte']) {
        P.impostaOrario(orario); P.applicaMeteo(1);
        const c = P.hexToRgb(P.skyColorAt(0.5));
        assert.ok(Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 0.12,
            `il cielo del temporale ha una dominante a ${orario}: ${JSON.stringify(c)}`);
    }
});

test('temporale: quattro tappe di cielo, sempre — la cupola compila su quel numero', () => {
    P.impostaOrario('notte');
    P.applicaMeteo(0.7);
    assert.equal(P.SKY_STOPS.length, 4);
    P.impostaOrario('giorno');
    assert.equal(P.SKY_STOPS.length, 4);
});

test('temporale: cambiare orario non dimentica la pioggia', () => {
    P.impostaOrario('giorno');
    P.applicaMeteo(1);
    const sottoLaPioggia = P.skyColorAt(0.5);
    P.impostaOrario('giorno');   // riapplicare l'orario non deve asciugare il cielo
    assert.equal(P.skyColorAt(0.5), sottoLaPioggia);
});
