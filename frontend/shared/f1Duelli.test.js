// frontend/shared/f1Duelli.test.js
//
// Le regole della difesa, provate senza costruire una gara: entrano la
// posizione dell'attaccante e il livello, esce di quanto ci si sposta.
const test = require('node:test');
const assert = require('node:assert/strict');
const F1Duelli = require('./f1Duelli.js');

// Uno stato di partenza sensato: attaccante a sinistra, dentro la finestra.
function stato(over) {
    return Object.assign({
        latoAttaccante: -1, gapM: 10, finestraM: 30, forza: 4,
        scostamentoAttuale: 0, affiancato: false,
        ultimoCambioMs: 0, adessoMs: 100000,
    }, over);
}

test('ci si sposta dal lato da cui arriva l\'attaccante', () => {
    const sinistra = F1Duelli.scostamentoDifensivo(stato({ latoAttaccante: -1 }));
    const destra = F1Duelli.scostamentoDifensivo(stato({ latoAttaccante: 1 }));
    assert.ok(sinistra.scostamento < 0, 'chi arriva da sinistra va coperto a sinistra');
    assert.ok(destra.scostamento > 0, 'chi arriva da destra va coperto a destra');
});

test('quanto ci si sposta lo dice la forza del livello', () => {
    const debole = F1Duelli.scostamentoDifensivo(stato({ forza: 1 }));
    const forte = F1Duelli.scostamentoDifensivo(stato({ forza: 5 }));
    assert.ok(Math.abs(forte.scostamento) > Math.abs(debole.scostamento));
    assert.ok(Math.abs(forte.scostamento) <= 5 + 1e-9, 'non si supera la forza dichiarata');
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
        latoAttaccante: 1, scostamentoAttuale: -3,
        ultimoCambioMs: 99000, adessoMs: 100000,   // un secondo fa
    }));
    assert.equal(r.scostamento, -3, 'si resta dove si e\', non si insegue l\'attaccante');
    assert.equal(r.motivo, 'gia-mosso');
    // Passato l'intervallo, si puo' coprire di nuovo.
    const dopo = F1Duelli.scostamentoDifensivo(stato({
        latoAttaccante: 1, scostamentoAttuale: -3,
        ultimoCambioMs: 100000 - F1Duelli.INTERVALLO_CAMBIO_MS - 1, adessoMs: 100000,
    }));
    assert.ok(dopo.scostamento > -3, 'passato l\'intervallo si copre il lato nuovo');
});

test('senza attaccante si torna sulla propria linea', () => {
    const r = F1Duelli.scostamentoDifensivo(stato({ latoAttaccante: 0, gapM: Infinity }));
    assert.equal(r.scostamento, 0);
});
