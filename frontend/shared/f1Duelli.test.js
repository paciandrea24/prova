// frontend/shared/f1Duelli.test.js
//
// Le regole della difesa, provate senza costruire una gara: entrano la
// posizione dell'attaccante e il livello, esce di quanto ci si sposta.
const test = require('node:test');
const assert = require('node:assert/strict');
const F1Duelli = require('./f1Duelli.js');

// Uno stato di partenza sensato: la mia linea passa a +6 dall'asse,
// l'attaccante arriva dal lato largo (-6), dentro la finestra.
function stato(over) {
    return Object.assign({
        latLinea: 6, latAttaccante: -6, gapM: 10, finestraM: 30, copertura: 1,
        scostamentoAttuale: 0, affiancato: false,
        ultimoCambioMs: 0, adessoMs: 100000,
    }, over);
}

test('ci si sposta dal lato da cui arriva l\'attaccante', () => {
    const sinistra = F1Duelli.scostamentoDifensivo(stato({ latAttaccante: -6 }));
    const destra = F1Duelli.scostamentoDifensivo(stato({ latLinea: -6, latAttaccante: 6 }));
    assert.ok(sinistra.scostamento < 0, 'chi arriva da sinistra va coperto a sinistra');
    assert.ok(destra.scostamento > 0, 'chi arriva da destra va coperto a destra');
});

// ⚠️ IL TEST CHE DESCRIVE IL MODELLO, e la ragione per cui e' cambiato.
//
// Playtest del 2026-09-06: «ad hard non noto ancora che si spostano per
// difendere». Il meccanismo si attivava (74% dei tick col bersaglio dietro) e
// spostava quasi una larghezza d'auto, ma la difesa era uno spostamento
// RELATIVO alla propria linea: su `prova` la linea dei bot passa a 6 unita'
// dall'asse e lascia 16.3 unita' libere dall'altra parte. Spostarsi di 6 non
// chiudeva niente — la porta passava da 4.88 a 4.02 auto affiancate, e si
// continuava a passare senza toccare il volante.
//
// Nessun aumento della manopola vecchia ci arrivava: al 100% della mezza
// carreggiata restavano 2.9 auto di porta, e per stringerla a una ne sarebbe
// servito il 112%.
test('quanto ci si sposta dipende da DOVE passa la propria linea', () => {
    // Stesso attaccante, stessa copertura, due linee diverse: chi corre
    // spostato deve attraversare di piu' per coprirlo.
    const lineaLaterale = F1Duelli.scostamentoDifensivo(stato({ latLinea: 6, latAttaccante: -6 }));
    const lineaCentrale = F1Duelli.scostamentoDifensivo(stato({ latLinea: 0, latAttaccante: -6 }));
    assert.ok(Math.abs(lineaLaterale.scostamento) > Math.abs(lineaCentrale.scostamento) * 1.8,
        `linea a 6 si sposta ${lineaLaterale.scostamento.toFixed(2)}, linea in asse ` +
        `${lineaCentrale.scostamento.toFixed(2)}: la difesa non tiene conto di dove parte`);
    // E il punto d'arrivo e' lo STESSO, da qualunque linea si parta: quello
    // di lui. ⚠️ Solo da incollati: piu' lontano ci si copre in proporzione
    // alla vicinanza, ed e' la seconda meta' del modello.
    const daLato = F1Duelli.scostamentoDifensivo(stato({ latLinea: 6, latAttaccante: -6, gapM: 0 }));
    const daCentro = F1Duelli.scostamentoDifensivo(stato({ latLinea: 0, latAttaccante: -6, gapM: 0 }));
    assert.ok(Math.abs((6 + daLato.scostamento) - (-6)) < 1e-9,
        'a copertura piena e attaccante incollato si arriva sulla sua linea');
    assert.ok(Math.abs((0 + daCentro.scostamento) - (-6)) < 1e-9);
});

test('chi insegue sulla mia stessa linea non apre nessuna porta', () => {
    // Se e' incolonnato dietro di me non c'e' niente da coprire: sono gia'
    // davanti a lui. Il modello vecchio si spostava lo stesso, a caso.
    const r = F1Duelli.scostamentoDifensivo(stato({ latLinea: 6, latAttaccante: 6 }));
    assert.equal(r.scostamento, 0);
});

test('quanto ci si sposta lo dice la copertura del livello', () => {
    const debole = F1Duelli.scostamentoDifensivo(stato({ copertura: 0.25 }));
    const forte = F1Duelli.scostamentoDifensivo(stato({ copertura: 1 }));
    assert.ok(Math.abs(forte.scostamento) > Math.abs(debole.scostamento));
    assert.ok(Math.abs(forte.scostamento) <= 12 + 1e-9,
        'non si va oltre la linea dell\'attaccante');
});

test('piu\' e\' vicino, piu\' si copre', () => {
    const lontano = F1Duelli.scostamentoDifensivo(stato({ gapM: 28 }));
    const addosso = F1Duelli.scostamentoDifensivo(stato({ gapM: 3 }));
    assert.ok(Math.abs(addosso.scostamento) > Math.abs(lontano.scostamento));
});

test('fuori dalla finestra non ci si difende', () => {
    const r = F1Duelli.scostamentoDifensivo(stato({ gapM: 45 }));
    assert.equal(r.scostamento, 0);
    assert.equal(r.motivo, 'lontano');
});

test('non si stringe chi e\' gia\' affiancato', () => {
    // ⚠️ Regola vera della F1, ed e' anche la differenza fra difendersi e
    // buttare fuori qualcuno: se l'attaccante ha il muso a fianco, la porta
    // resta dov'e'.
    const r = F1Duelli.scostamentoDifensivo(stato({ affiancato: true, scostamentoAttuale: -2 }));
    assert.equal(r.scostamento, -2, 'con l\'attaccante affiancato lo scostamento non cambia');
    assert.equal(r.motivo, 'affiancato');
});

test('non si cambia direzione due volte di fila', () => {
    // Un cambio di traiettoria in difesa, non due: un bot che oscilla per
    // bloccare si vede subito ed e' antipatico. Qui l'attaccante ONDEGGIA —
    // si e' spostato di meno di una larghezza d'auto poco dopo il primo
    // movimento del difensore, che quindi non lo insegue.
    //
    // ⚠️ Un attaccante passato DAVVERO dall'altra parte e' un altro caso, e
    // va coperto subito: vedi «si copre chi e' passato davvero dall'altra
    // parte». La differenza la fa `sogliaCambioM`.
    const r = F1Duelli.scostamentoDifensivo(stato({
        latLinea: -6, latAttaccante: -4, scostamentoAttuale: -3, sogliaCambioM: 3.48,
        ultimoCambioMs: 99000, adessoMs: 100000,   // un secondo fa
    }));
    assert.equal(r.scostamento, -3, 'si resta dove si e\', non si insegue l\'attaccante');
    assert.equal(r.motivo, 'gia-mosso');
    // Passato l'intervallo, si puo' coprire di nuovo.
    const dopo = F1Duelli.scostamentoDifensivo(stato({
        latLinea: -6, latAttaccante: -4, scostamentoAttuale: -3, sogliaCambioM: 3.48,
        ultimoCambioMs: 100000 - F1Duelli.INTERVALLO_CAMBIO_MS - 1, adessoMs: 100000,
    }));
    assert.ok(dopo.scostamento > -3, 'passato l\'intervallo si copre il lato nuovo');
});

test('senza attaccante si torna sulla propria linea', () => {
    const r = F1Duelli.scostamentoDifensivo(stato({ latAttaccante: null, gapM: Infinity }));
    assert.equal(r.scostamento, 0);
});

// ⚠️ IL BLOCCO ANTI-ZIGZAG NON DEVE COPRIRE IL LATO SBAGLIATO.
//
// Playtest 2026-09-06: «avevo una macchina davanti a sinistra, io ho
// sorpassato a destra e lui ha tipo coperto a sinistra, ma io stavo passando a
// destra». Riprodotto: il difensore restava sul lato vecchio per l'INTERO
// intervallo di 2 s, mentre la finestra del duello e' 1 s di distacco. Faceva
// una scelta e non poteva piu' correggerla per tutto il sorpasso.
//
// La regola vera della F1 vieta lo ZIG-ZAG — inseguire chi ondeggia — non
// vieta di chiudere la porta a chi e' passato davvero dall'altra parte. Le due
// cose si distinguono da QUANTO si e' spostato l'attaccante: sotto una
// larghezza d'auto e' un finto, sopra e' un attacco.
test('si copre chi e\' passato davvero dall\'altra parte, anche subito', () => {
    const base = { latLinea: 0, gapM: 20, finestraM: 120, copertura: 1,
                   affiancato: false, sogliaCambioM: 3.48 };
    // Il bot si e' coperto a sinistra un istante fa; l'attaccante e' ora
    // nettamente a destra.
    const attaccoVero = F1Duelli.scostamentoDifensivo(Object.assign({}, base, {
        latAttaccante: 6, scostamentoAttuale: -5,
        ultimoCambioMs: 900, adessoMs: 1000,   // un decimo di secondo fa
    }));
    assert.ok(attaccoVero.scostamento > 0,
        `l'attaccante e' a destra di 6 e il bot copre ancora a ` +
        `${attaccoVero.scostamento.toFixed(2)}: sta coprendo il vuoto`);

    // Ma un'oscillazione dentro la larghezza di un'auto NON va inseguita.
    const finta = F1Duelli.scostamentoDifensivo(Object.assign({}, base, {
        latAttaccante: 1.2, scostamentoAttuale: -5,
        ultimoCambioMs: 900, adessoMs: 1000,
    }));
    assert.equal(finta.scostamento, -5, 'il bot insegue un\'oscillazione da mezzo metro');
    assert.equal(finta.motivo, 'gia-mosso');
});
