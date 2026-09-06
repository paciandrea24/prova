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
    // bloccare si vede subito ed e' antipatico. Qui l'attaccante e' passato
    // dall'altro lato poco dopo il primo spostamento.
    const r = F1Duelli.scostamentoDifensivo(stato({
        latLinea: -6, latAttaccante: 6, scostamentoAttuale: -3,
        ultimoCambioMs: 99000, adessoMs: 100000,   // un secondo fa
    }));
    assert.equal(r.scostamento, -3, 'si resta dove si e\', non si insegue l\'attaccante');
    assert.equal(r.motivo, 'gia-mosso');
    // Passato l'intervallo, si puo' coprire di nuovo.
    const dopo = F1Duelli.scostamentoDifensivo(stato({
        latLinea: -6, latAttaccante: 6, scostamentoAttuale: -3,
        ultimoCambioMs: 100000 - F1Duelli.INTERVALLO_CAMBIO_MS - 1, adessoMs: 100000,
    }));
    assert.ok(dopo.scostamento > -3, 'passato l\'intervallo si copre il lato nuovo');
});

test('senza attaccante si torna sulla propria linea', () => {
    const r = F1Duelli.scostamentoDifensivo(stato({ latAttaccante: null, gapM: Infinity }));
    assert.equal(r.scostamento, 0);
});
