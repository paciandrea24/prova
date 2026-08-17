// backend/sockets/games/physics/TyreSlipModel.test.js
//
// Test di caratterizzazione del modulo isolato TyreSlipModel — Fase
// 3.0/3A/3.1. Il modulo resta puro/stateless: anche `updateTractionSlipDebt`
// (Fase 3.1) è una funzione pura di transizione — lo stato vive su
// `p._tractionSlipDebt`, gestito dal chiamante (PowertrainModel).
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    TRACTION_LAUNCH_THRESHOLD, TRACTION_DEMAND_BOOST,
    TRACTION_SLIP_RISE_RATE, TRACTION_SLIP_DECAY_RATE, TRACTION_SLIP_PENALTY_MAX,
    BRAKING_ZONE_THRESHOLD, BRAKING_DEMAND_BOOST, BRAKING_EXCESS_PENALTY_MAX,
    STEER_LOCKUP_PENALTY_MAX,
    tractionExcess, brakingExcess, updateTractionSlipDebt, isTyreSlipModelActive
} = require('./TyreSlipModel.js');

function assertClose(actual, expected, label) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: atteso ${expected}, ottenuto ${actual}`);
}

test('costanti Fase 3.0/3A confermate (soglia trazione allargata da 0.30 a 0.50: il debito era corretto ma la finestra troppo stretta per uscite di curva normali)', () => {
    assert.equal(TRACTION_LAUNCH_THRESHOLD, 0.50);
    assert.equal(TRACTION_DEMAND_BOOST, 0.30);
    assert.equal(BRAKING_ZONE_THRESHOLD, 0.55);
    assert.equal(BRAKING_DEMAND_BOOST, 0.30);
    assert.equal(BRAKING_EXCESS_PENALTY_MAX, 0.40);
});

test('costanti Fase 3.1 confermate (debito di slittamento + sterzo in bloccaggio)', () => {
    assert.equal(TRACTION_SLIP_RISE_RATE, 0.6);
    assert.equal(TRACTION_SLIP_DECAY_RATE, 0.85);
    assert.equal(TRACTION_SLIP_PENALTY_MAX, 0.35);
    assert.equal(STEER_LOCKUP_PENALTY_MAX, 0.35);
});

// ---- tractionExcess (wheelspin) ----

test('tractionExcess: throttle=0 -> 0 sempre, qualunque velocità/capacità', () => {
    assertClose(tractionExcess(0, 0, 1), 0, 'throttle 0, fresh, fermo');
    assertClose(tractionExcess(0, 0, 0.75), 0, 'throttle 0, usurata, fermo');
    assertClose(tractionExcess(0, 1, 1), 0, 'throttle 0, fresh, veloce');
});

test('tractionExcess: pieno gas fuori dalla zona di lancio (speedFrac >= soglia), gomma nuova -> 0 (mai wheelspin qui)', () => {
    assertClose(tractionExcess(1, TRACTION_LAUNCH_THRESHOLD, 1), 0, 'esattamente alla soglia');
    assertClose(tractionExcess(1, 0.60, 1), 0, 'oltre la soglia');
    assertClose(tractionExcess(1, 1, 1), 0, 'velocità massima');
});

test('tractionExcess: pieno gas da fermo, gomma NUOVA -> eccesso > 0 (wheelspin possibile anche a gomma nuova, condizione estrema)', () => {
    const excess = tractionExcess(1, 0, 1);
    assert.ok(excess > 0, `atteso > 0, ottenuto ${excess}`);
    assertClose(excess, 0.30, 'eccesso a velocità nulla, gomma nuova = TRACTION_DEMAND_BOOST esatto');
});

test('tractionExcess: a parità di richiesta/velocità, cresce (o resta uguale) al diminuire della capacità (usura maggiore -> eccesso maggiore)', () => {
    const fresh = tractionExcess(1, 0, 1);
    const worn  = tractionExcess(1, 0, 0.75);
    assert.ok(worn > fresh, `atteso eccesso su gomma usurata (${worn}) > gomma nuova (${fresh})`);
    assertClose(worn, 0.55, 'eccesso a velocità nulla, gomma a fine vita (tractionFactor=0.75)');
});

test('tractionExcess: a parità di richiesta/capacità, decresce (o resta uguale) al crescere della velocità dentro la zona di lancio', () => {
    const nearStandstill = tractionExcess(1, 0.05, 1);
    const nearThreshold   = tractionExcess(1, 0.10, 1);
    assert.ok(nearStandstill > nearThreshold, `atteso decrescente in velocità: ${nearStandstill} vs ${nearThreshold}`);
});

test('tractionExcess: continuità alla soglia (nessun salto tra appena sotto e appena sopra)', () => {
    const justBelow = tractionExcess(1, TRACTION_LAUNCH_THRESHOLD - 0.001, 1);
    const atThreshold = tractionExcess(1, TRACTION_LAUNCH_THRESHOLD, 1);
    assert.ok(Math.abs(justBelow - atThreshold) < 0.01, `atteso valori vicini: ${justBelow} vs ${atThreshold}`);
    assertClose(atThreshold, 0, 'esattamente alla soglia = 0');
});

test('tractionExcess: resta in [0,1] anche a valori estremi (throttle=1, speedFrac=0, capacità minima storica 0.75)', () => {
    const excess = tractionExcess(1, 0, 0.75);
    assert.ok(excess >= 0 && excess <= 1, `atteso in [0,1], ottenuto ${excess}`);
    assert.ok(!Number.isNaN(excess), 'atteso non-NaN');
});

// ---- brakingExcess (bloccaggio) ----

test('brakingExcess: brake=0 -> 0 sempre, qualunque velocità/capacità', () => {
    assertClose(brakingExcess(0, 1, 1), 0, 'brake 0, fresh, veloce');
    assertClose(brakingExcess(0, 1, 0.65), 0, 'brake 0, usurata, veloce');
    assertClose(brakingExcess(0, 0, 1), 0, 'brake 0, fresh, fermo');
});

test('brakingExcess: frenata piena sotto la zona ad alta velocità (speedFrac <= soglia), gomma nuova -> 0 (mai bloccaggio qui)', () => {
    assertClose(brakingExcess(1, BRAKING_ZONE_THRESHOLD, 1), 0, 'esattamente alla soglia');
    assertClose(brakingExcess(1, 0.5, 1), 0, 'sotto la soglia');
    assertClose(brakingExcess(1, 0, 1), 0, 'fermo');
});

test('brakingExcess: frenata piena a velocità massima, gomma NUOVA -> eccesso > 0 (bloccaggio possibile anche a gomma nuova, condizione estrema)', () => {
    const excess = brakingExcess(1, 1, 1);
    assert.ok(excess > 0, `atteso > 0, ottenuto ${excess}`);
    assertClose(excess, 0.30, 'eccesso a velocità massima, gomma nuova = BRAKING_DEMAND_BOOST esatto');
});

test('brakingExcess: a parità di richiesta/velocità, cresce (o resta uguale) al diminuire della capacità (usura maggiore -> eccesso maggiore)', () => {
    const fresh = brakingExcess(1, 1, 1);
    const worn  = brakingExcess(1, 1, 0.65);
    assert.ok(worn > fresh, `atteso eccesso su gomma usurata (${worn}) > gomma nuova (${fresh})`);
    assertClose(worn, 0.65, 'eccesso a velocità massima, gomma a fine vita (brakingFactor=0.65)');
});

test('brakingExcess: a parità di richiesta/capacità, cresce (o resta uguale) al crescere della velocità dentro la zona ad alto rischio', () => {
    const nearThreshold = brakingExcess(1, 0.80, 1);
    const nearMax        = brakingExcess(1, 0.95, 1);
    assert.ok(nearMax > nearThreshold, `atteso crescente in velocità: ${nearThreshold} vs ${nearMax}`);
});

test('brakingExcess: continuità alla soglia (nessun salto tra appena sotto e appena sopra)', () => {
    const atThreshold = brakingExcess(1, BRAKING_ZONE_THRESHOLD, 1);
    const justAbove = brakingExcess(1, BRAKING_ZONE_THRESHOLD + 0.001, 1);
    assert.ok(Math.abs(justAbove - atThreshold) < 0.01, `atteso valori vicini: ${atThreshold} vs ${justAbove}`);
    assertClose(atThreshold, 0, 'esattamente alla soglia = 0');
});

test('brakingExcess: resta in [0,1] anche a valori estremi (brake=1, speedFrac=1, capacità minima storica 0.65)', () => {
    const excess = brakingExcess(1, 1, 0.65);
    assert.ok(excess >= 0 && excess <= 1, `atteso in [0,1], ottenuto ${excess}`);
    assert.ok(!Number.isNaN(excess), 'atteso non-NaN');
});

// ---- updateTractionSlipDebt (Fase 3.1: stato persistente del wheelspin) ----

test('updateTractionSlipDebt: debito assente (undefined, primo tick) + eccesso 0 -> resta 0', () => {
    assertClose(updateTractionSlipDebt(undefined, 0), 0, 'primo tick, nessun eccesso');
});

test('updateTractionSlipDebt: accumulo — con eccesso costante, il debito sale rispetto al tick precedente', () => {
    const debt1 = updateTractionSlipDebt(0, 0.3);
    assertClose(debt1, 0.3 * TRACTION_SLIP_RISE_RATE, 'tick 1: decayed(0) + eccesso*RISE_RATE');
    const debt2 = updateTractionSlipDebt(debt1, 0.3);
    assert.ok(debt2 > debt1, `atteso debito crescente con eccesso sostenuto: ${debt1} -> ${debt2}`);
});

test('updateTractionSlipDebt: decadimento — con eccesso a 0, il debito scende gradualmente (non a zero istantaneo)', () => {
    const debtWithSlip = updateTractionSlipDebt(0, 1); // costruisce un debito iniziale
    const afterOneTick = updateTractionSlipDebt(debtWithSlip, 0);
    assert.ok(afterOneTick > 0, `atteso debito ancora positivo dopo un solo tick senza eccesso (recupero graduale), ottenuto ${afterOneTick}`);
    assert.ok(afterOneTick < debtWithSlip, `atteso debito in calo: ${debtWithSlip} -> ${afterOneTick}`);
    assertClose(afterOneTick, debtWithSlip * TRACTION_SLIP_DECAY_RATE, 'decadimento = debito precedente * DECAY_RATE');
});

test('updateTractionSlipDebt: decadimento ripetuto converge a 0 (nessun debito residuo permanente)', () => {
    let debt = updateTractionSlipDebt(0, 1);
    for (let i = 0; i < 100; i++) debt = updateTractionSlipDebt(debt, 0);
    // Decadimento esponenziale (moltiplicatore <1 ogni tick): non tocca mai
    // esattamente 0, ma dopo 100 tick è trascurabile (0.85^100 ≈ 5e-8).
    assert.ok(debt < 1e-6, `atteso trascurabile dopo molti tick senza eccesso, ottenuto ${debt}`);
});

test('updateTractionSlipDebt: clamp — resta in [0,1] anche a input estremi ripetuti', () => {
    let debt = 0;
    for (let i = 0; i < 50; i++) debt = updateTractionSlipDebt(debt, 1);
    assert.ok(debt >= 0 && debt <= 1, `atteso in [0,1], ottenuto ${debt}`);
    assert.ok(!Number.isNaN(debt), 'atteso non-NaN');
});

// ---- isTyreSlipModelActive ----

// Promosso a default ON il 2026-08-11, RIPORTATO A OFF il 2026-08-17 dopo il
// playtest: la semantica torna quella originale, "acceso solo con '1'". Il
// perché sta nel commento della funzione — in breve, il costo non era il
// +0.80s sul giro con cui era stato approvato, ma il 12-14% di velocità nelle
// curve lente, e al volante l'utente non riusciva a completare un giro.
// I tre casi sotto fissano il default: se un giorno lo si ripromuove, sono
// questi a dover cambiare per primi, di proposito e non per sbaglio.

test('isTyreSlipModelActive: di default (env var non impostata) è false', () => {
    assert.equal(process.env.F1_TYRE_SLIP_MODEL, undefined);
    assert.equal(isTyreSlipModelActive(), false);
});

test("isTyreSlipModelActive: true solo quando F1_TYRE_SLIP_MODEL === '1' esattamente", () => {
    for (const [valore, atteso] of [['1', true], ['0', false], ['true', false], ['', false]]) {
        process.env.F1_TYRE_SLIP_MODEL = valore;
        try {
            assert.equal(isTyreSlipModelActive(), atteso,
                `con F1_TYRE_SLIP_MODEL='${valore}' atteso ${atteso}`);
        } finally {
            delete process.env.F1_TYRE_SLIP_MODEL;
        }
    }
});

test('isTyreSlipModelActive: indipendente da F1_TYRE_FORCE_MODEL (flag separato, Fase 2A/2B rimossa)', () => {
    // F1_TYRE_FORCE_MODEL non deve poter ACCENDERE questo modello: sono due
    // sistemi distinti, e l'unico modo di accenderlo resta il suo flag
    // dedicato a '1'.
    process.env.F1_TYRE_FORCE_MODEL = '1';
    try {
        assert.equal(isTyreSlipModelActive(), false, 'F1_TYRE_FORCE_MODEL non deve accendere TyreSlipModel');
    } finally {
        delete process.env.F1_TYRE_FORCE_MODEL;
    }
});

const {
    corneringDemand, corneringExcess, CORNERING_EXCESS_PENALTY_MAX,
    isCorneringGripModelActive
} = require('./TyreSlipModel.js');

// ---- corneringDemand / corneringExcess (Fase 4: capacità laterale, non slip angle fisico) ----

test('corneringDemand: sterzo 0 -> 0 sempre, qualunque velocità', () => {
    assertClose(corneringDemand(0, 0), 0, 'sterzo 0, fermo');
    assertClose(corneringDemand(0, 1), 0, 'sterzo 0, velocità massima');
});

test('corneringDemand: fermo (speedFrac=0) -> 0 sempre, qualunque sterzo', () => {
    assertClose(corneringDemand(1, 0), 0, 'sterzo pieno, fermo');
    assertClose(corneringDemand(-1, 0), 0, 'sterzo pieno opposto, fermo');
});

test('corneringDemand: sterzo pieno a velocità massima -> esattamente 1 (nessun boost, a differenza di trazione/frenata: qui la domanda non deve mai superare la capacità piena=1, vedi criterio 0 della spec)', () => {
    assertClose(corneringDemand(1, 1), 1, 'sterzo pieno, velocità massima');
});

test('corneringDemand: simmetrico nel segno dello sterzo (stessa entità, verso opposto)', () => {
    assertClose(corneringDemand(1, 0.6), corneringDemand(-1, 0.6), 'stesso valore assoluto');
});

test('corneringDemand: monotono crescente sia in |steer| che in speedFrac', () => {
    assert.ok(corneringDemand(0.5, 0.5) < corneringDemand(1, 0.5), 'cresce con |steer|');
    assert.ok(corneringDemand(0.5, 0.5) < corneringDemand(0.5, 1), 'cresce con speedFrac');
});

test('corneringExcess: domanda entro capacità piena (capacità=1) -> eccesso 0, anche a sterzo/velocità massimi (criterio 0: gomma fresca/qualifica mai penalizzata)', () => {
    assertClose(corneringExcess(1, 1, 1), 0, 'sterzo pieno, velocità massima, capacità piena');
    assertClose(corneringExcess(1, 0.5, 1), 0, 'sterzo pieno, velocità media, capacità piena');
});

test('corneringExcess: capacità ridotta (gomma usurata) -> eccesso positivo nelle stesse condizioni che a capacità piena davano 0', () => {
    const excess = corneringExcess(1, 1, 0.6);
    assert.ok(excess > 0, `atteso > 0, ottenuto ${excess}`);
    assertClose(excess, 0.4, 'eccesso = domanda(1) - capacità(0.6)');
});

test('corneringExcess: a parità di domanda, cresce (o resta uguale) al diminuire della capacità', () => {
    const highCap = corneringExcess(1, 1, 0.9);
    const lowCap  = corneringExcess(1, 1, 0.6);
    assert.ok(lowCap > highCap, `atteso eccesso maggiore a capacità minore: ${lowCap} vs ${highCap}`);
});

test('corneringExcess: continuità — nessun salto attorno al punto in cui la domanda supera la capacità', () => {
    const capacity = 0.7;
    // speedFrac tale per cui domanda(steer=1, speedFrac) è appena sotto/sopra 0.7
    const justBelow = corneringExcess(1, 0.699, capacity);
    const justAbove = corneringExcess(1, 0.701, capacity);
    assert.ok(Math.abs(justAbove - justBelow) < 0.01, `atteso valori vicini: ${justBelow} vs ${justAbove}`);
});

test('corneringExcess: resta in [0,1] anche a valori estremi', () => {
    const excess = corneringExcess(1, 1, 0);
    assert.ok(excess >= 0 && excess <= 1, `atteso in [0,1], ottenuto ${excess}`);
    assert.ok(!Number.isNaN(excess), 'atteso non-NaN');
});

test('CORNERING_EXCESS_PENALTY_MAX: valore di partenza conservativo confermato (stesso ordine di grandezza di BRAKING_EXCESS_PENALTY_MAX/STEER_LOCKUP_PENALTY_MAX)', () => {
    assert.equal(CORNERING_EXCESS_PENALTY_MAX, 0.40);
});

// ---- isCorneringGripModelActive ----

test('isCorneringGripModelActive: di default (env var non impostata) è false', () => {
    assert.equal(process.env.F1_CORNERING_GRIP_MODEL, undefined);
    assert.equal(isCorneringGripModelActive(), false);
});

test("isCorneringGripModelActive: true solo quando F1_CORNERING_GRIP_MODEL === '1' esattamente", () => {
    process.env.F1_CORNERING_GRIP_MODEL = '1';
    try {
        assert.equal(isCorneringGripModelActive(), true);
    } finally {
        delete process.env.F1_CORNERING_GRIP_MODEL;
    }
    process.env.F1_CORNERING_GRIP_MODEL = 'true';
    try {
        assert.equal(isCorneringGripModelActive(), false);
    } finally {
        delete process.env.F1_CORNERING_GRIP_MODEL;
    }
});

test('isCorneringGripModelActive: indipendente da F1_TYRE_SLIP_MODEL/F1_TYRE_FORCE_MODEL (flag dedicato)', () => {
    process.env.F1_TYRE_SLIP_MODEL = '1';
    process.env.F1_TYRE_FORCE_MODEL = '1';
    try {
        assert.equal(isCorneringGripModelActive(), false, 'gli altri due flag non devono attivare questo');
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
        delete process.env.F1_TYRE_FORCE_MODEL;
    }
});
