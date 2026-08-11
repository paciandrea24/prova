// backend/sockets/games/physics/BrakingModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { BRAKE_MULT, effectiveBrakeMult, applyBrake } = require('./BrakingModel');
const { brakingFactor } = require('./TyreForceModel');
const { brakingExcess, BRAKING_EXCESS_PENALTY_MAX } = require('./TyreSlipModel');

test('BRAKE_MULT: valore storico invariato', () => {
    assert.equal(BRAKE_MULT, 2.17);
});

test('effectiveBrakeMult: gomma fresca -> BRAKE_MULT pieno', () => {
    const p = { compound: 'medium', tyreWear: 0 };
    assert.equal(effectiveBrakeMult(p, false), 2.17);
});

test('effectiveBrakeMult: gomma usurata 80% -> penalità frenata applicata (Fase 2B: da TyreForceModel.brakingFactor, tarato in 2A.5, non più WEAR_BRAKE_PENALTY legacy 1.8851875)', () => {
    const p = { compound: 'medium', tyreWear: 80 };
    assert.ok(Math.abs(effectiveBrakeMult(p, false) - 1.8377187499999998) < 1e-9);
});

test("effectiveBrakeMult: in qualifica ignora sempre l'usura", () => {
    const p = { compound: 'medium', tyreWear: 80 };
    assert.equal(effectiveBrakeMult(p, true), 2.17);
});

test('effectiveBrakeMult: Fase 2B, il fattore usura proviene sempre da TyreForceModel.brakingFactor (nessun ramo legacy residuo)', () => {
    const p = { compound: 'medium', tyreWear: 80 };
    const expected = BRAKE_MULT * brakingFactor(80, false);
    assert.ok(Math.abs(effectiveBrakeMult(p, false) - expected) < 1e-9);
});

test('applyBrake: frenata piena da velocità 4, gomma fresca, senza bloccaggio -> decelerazione + smorzamento laterale', () => {
    // Ancorato a modello spento: misura la formula del freno in isolamento.
    // Velocità 4 su 6.2 è speedFrac 0.645, sopra BRAKING_ZONE_THRESHOLD, quindi
    // col bloccaggio (ON di default dal 2026-08-11) la decelerazione sarebbe
    // minore. Il caso acceso ha i suoi test più sotto.
    process.env.F1_TYRE_SLIP_MODEL = '0';
    try {
        const p = { speed: 4, vx: 1, vz: 1, inputs: { brake: 1 }, compound: 'medium', tyreWear: 0 };
        applyBrake(p, false, 6.2, 0.186);
        assert.ok(Math.abs(p.speed - 3.59638) < 1e-9);
        assert.ok(Math.abs(p.vx - 0.94) < 1e-12);
        assert.ok(Math.abs(p.vz - 0.94) < 1e-12);
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});

test('applyBrake: non scende mai sotto -maxSpeed/2 (tetto retromarcia)', () => {
    const p = { speed: -3, vx: 0, vz: 0, inputs: { brake: 1 }, compound: 'medium', tyreWear: 0 };
    applyBrake(p, false, 6.2, 0.186);
    assert.equal(p.speed, -3.1);
});

test("applyBrake: Fase 3.0/3A, F1_TYRE_SLIP_MODEL='0' -> comportamento identico a prima anche a frenata piena da velocità quasi massima su gomma nuova (baseline invariata)", () => {
    // Vedi la nota gemella in PowertrainModel.test.js: dal 2026-08-11 il
    // modello è ON di default, quindi lo spegnimento va dichiarato.
    process.env.F1_TYRE_SLIP_MODEL = '0';
    try {
        const p = { speed: 6.0, vx: 0, vz: 0, inputs: { brake: 1 }, compound: 'medium', tyreWear: 0 };
        applyBrake(p, false, 6.2, 0.186);
        assert.ok(Math.abs(p.speed - 5.59638) < 1e-9);
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});

test("applyBrake: Fase 3.0/3A, F1_TYRE_SLIP_MODEL='1' -> frenata piena da velocità quasi massima anche su gomma NUOVA frena meno del baseline (bloccaggio, non più un no-op come il vecchio TyreForceModel-only)", () => {
    process.env.F1_TYRE_SLIP_MODEL = '1';
    try {
        const p = { speed: 6.0, vx: 0, vz: 0, inputs: { brake: 1 }, compound: 'medium', tyreWear: 0 };
        applyBrake(p, false, 6.2, 0.186);
        assert.ok(p.speed > 5.59638, `atteso speed maggiore del baseline (meno frenata), ottenuto ${p.speed}`);
        assert.ok(Math.abs(p.speed - 5.6413424) < 1e-6, `atteso ~5.6413424, ottenuto ${p.speed}`);
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});

test("applyBrake: Fase 3.0/3A, F1_TYRE_SLIP_MODEL='1' -> sotto la zona ad alta velocità (speed=3, speedFrac=0.48 < soglia 0.55), gomma DAVVERO fresca -> nessun bloccaggio (garanzia matematica: demand=brake non supera mai capacità=1 fuori zona)", () => {
    process.env.F1_TYRE_SLIP_MODEL = '1';
    try {
        const p = { speed: 3, vx: 1, vz: 1, inputs: { brake: 1 }, compound: 'medium', tyreWear: 0 };
        applyBrake(p, false, 6.2, 0.186);
        const expected = 3 - 0.186 * effectiveBrakeMult(p, false);
        assert.ok(Math.abs(p.speed - expected) < 1e-9, `atteso nessuna riduzione fuori zona ad alta velocità: ${expected}, ottenuto ${p.speed}`);
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});

test("applyBrake: Fase 3.0/3A, F1_TYRE_SLIP_MODEL='1' -> su gomma USURATA la finestra di bloccaggio si allarga oltre la zona storica (piccolo residuo anche a velocità moderata, comportamento documentato, non un bug)", () => {
    process.env.F1_TYRE_SLIP_MODEL = '1';
    try {
        const p = { speed: 3, vx: 1, vz: 1, inputs: { brake: 1 }, compound: 'medium', tyreWear: 80 };
        applyBrake(p, false, 6.2, 0.186);
        const noSlipExpected = 3 - 0.186 * effectiveBrakeMult(p, false);
        assert.ok(p.speed > noSlipExpected, `atteso una riduzione residua (meno frenata) rispetto a ${noSlipExpected} (finestra allargata dall'usura), ottenuto ${p.speed}`);
        assert.ok(Math.abs(p.speed - 2.679120523359375) < 1e-9, `atteso 2.679120523359375, ottenuto ${p.speed}`);
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});
