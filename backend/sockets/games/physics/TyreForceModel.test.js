// backend/sockets/games/physics/TyreForceModel.test.js
//
// Test di caratterizzazione del modulo isolato TyreForceModel — Fase
// 0/2A/2A.5/2B (Rif. docs/superpowers/specs/2026-07-27-f1-tyre-force-model-migration-design.md).
// Dalla Fase 2B è l'unica fonte dei 3 fattori usura per i consumer: non
// esiste più un "legacy" da confrontare (le WEAR_*_PENALTY sono state
// rimosse da TyreModel.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    TRACTION_SENSITIVITY, BRAKING_SENSITIVITY, CORNERING_SENSITIVITY,
    TRACTION_EXPONENT, BRAKING_EXPONENT, CORNERING_EXPONENT,
    tyreGripBudget, tractionFactor, brakingFactor, corneringGripFactor, computeTyreFactors
} = require('./TyreForceModel.js');

function assertClose(actual, expected, label) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: atteso ${expected}, ottenuto ${actual}`);
}

test('TRACTION_SENSITIVITY/BRAKING_SENSITIVITY/CORNERING_SENSITIVITY: valori tarati in Fase 2A.5 (deliberatamente diversi dalle WEAR_*_PENALTY legacy)', () => {
    assert.equal(TRACTION_SENSITIVITY, 0.25);
    assert.equal(BRAKING_SENSITIVITY, 0.35);
    assert.equal(CORNERING_SENSITIVITY, 0.40);
});

test('TRACTION_EXPONENT/BRAKING_EXPONENT/CORNERING_EXPONENT: reshape per asse tarato in Fase 2A.5', () => {
    assert.equal(TRACTION_EXPONENT, 1.5);
    assert.equal(BRAKING_EXPONENT, 1.0);
    assert.equal(CORNERING_EXPONENT, 0.75);
});

test('tyreGripBudget: gomma nuova (wear=0) ha budget 1', () => {
    assertClose(tyreGripBudget(0), 1, 'budget a wear=0');
});

test('tyreGripBudget: gomma esaurita (wear=100) ha budget 0', () => {
    assertClose(tyreGripBudget(100), 0, 'budget a wear=100');
});

test('tyreGripBudget: usura 80% produce budget 0.5625 (coerente con la curva cliff di TyreModel)', () => {
    assertClose(tyreGripBudget(80), 0.5625, 'budget a wear=80');
});

test('tractionFactor: gomma nuova, non quali -> fattore 1', () => {
    assertClose(tractionFactor(0, false), 1, 'traction a wear=0');
});

test('tractionFactor: usura 80%, non quali -> 0.9276552375880776 (Fase 2A.5: reshape esponente 1.5, resta più pieno del legacy 0.9125 a metà-fine vita gomma)', () => {
    assertClose(tractionFactor(80, false), 0.9276552375880776, 'traction a wear=80');
});

test('tractionFactor: gomma esaurita (wear=100), non quali -> 1 - TRACTION_SENSITIVITY', () => {
    assertClose(tractionFactor(100, false), 1 - TRACTION_SENSITIVITY, 'traction a wear=100');
});

test('brakingFactor: usura 80%, non quali -> 0.846875 (Fase 2A.5: reshape esponente 1.0, lineare nel deficit, diverso dal legacy 0.86875)', () => {
    assertClose(brakingFactor(80, false), 0.846875, 'braking a wear=80');
});

test('brakingFactor: gomma esaurita (wear=100), non quali -> 1 - BRAKING_SENSITIVITY', () => {
    assertClose(brakingFactor(100, false), 1 - BRAKING_SENSITIVITY, 'braking a wear=100');
});

test('corneringGripFactor: usura 80%, non quali -> 0.7848241464670574 (Fase 2A.5: reshape esponente 0.75, già più penalizzato del legacy 0.846875)', () => {
    assertClose(corneringGripFactor(80, false), 0.7848241464670574, 'corneringGrip a wear=80');
});

test('corneringGripFactor: gomma esaurita (wear=100), non quali -> 1 - CORNERING_SENSITIVITY', () => {
    assertClose(corneringGripFactor(100, false), 1 - CORNERING_SENSITIVITY, 'corneringGrip a wear=100');
});

test('in qualifica: usura ignorata, tutti i fattori restano 1 anche a gomma esaurita', () => {
    assertClose(tractionFactor(100, true), 1, 'traction in quali');
    assertClose(brakingFactor(100, true), 1, 'braking in quali');
    assertClose(corneringGripFactor(100, true), 1, 'corneringGrip in quali');
});

test('i 3 fattori sono monotonamente non-crescenti al crescere dell\'usura', () => {
    const samples = [0, 20, 40, 60, 80, 100];
    for (let i = 1; i < samples.length; i++) {
        assert.ok(tractionFactor(samples[i], false) <= tractionFactor(samples[i - 1], false) + 1e-9,
            'traction deve essere non-crescente');
        assert.ok(brakingFactor(samples[i], false) <= brakingFactor(samples[i - 1], false) + 1e-9,
            'braking deve essere non-crescente');
        assert.ok(corneringGripFactor(samples[i], false) <= corneringGripFactor(samples[i - 1], false) + 1e-9,
            'corneringGrip deve essere non-crescente');
    }
});

test('computeTyreFactors: aggrega i 3 fattori individuali per una data usura', () => {
    const result = computeTyreFactors('medium', 80, false);
    assertClose(result.traction, tractionFactor(80, false), 'traction aggregato');
    assertClose(result.braking, brakingFactor(80, false), 'braking aggregato');
    assertClose(result.corneringGrip, corneringGripFactor(80, false), 'corneringGrip aggregato');
});

test('computeTyreFactors: la mescola non altera il risultato in questa prima versione (comportamento documentato, non un bug)', () => {
    const soft = computeTyreFactors('soft', 80, false);
    const hard = computeTyreFactors('hard', 80, false);
    assertClose(soft.traction, hard.traction, 'traction soft vs hard');
    assertClose(soft.braking, hard.braking, 'braking soft vs hard');
    assertClose(soft.corneringGrip, hard.corneringGrip, 'corneringGrip soft vs hard');
});

test('computeTyreFactors: gomma nuova -> tutti i fattori a 1, indipendentemente dalla mescola', () => {
    const result = computeTyreFactors('soft', 0, false);
    assertClose(result.traction, 1, 'traction a wear=0');
    assertClose(result.braking, 1, 'braking a wear=0');
    assertClose(result.corneringGrip, 1, 'corneringGrip a wear=0');
});
