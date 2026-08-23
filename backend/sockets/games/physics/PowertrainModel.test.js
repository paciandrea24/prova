// backend/sockets/games/physics/PowertrainModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_SPEED, ACCEL, FRICTION, effectiveMaxSpeed, effectiveAccel, applyThrottle, applyCoast } = require('./PowertrainModel');
const { tractionFactor } = require('./TyreForceModel');
const { tractionExcess, updateTractionSlipDebt, TRACTION_SLIP_PENALTY_MAX } = require('./TyreSlipModel');
const AerodynamicsModel = require('./AerodynamicsModel');

test('costanti storiche invariate', () => {
    assert.equal(MAX_SPEED, 6.2);
    assert.equal(ACCEL, 0.186);
    assert.equal(FRICTION, 0.120);
});

test('effectiveMaxSpeed/effectiveAccel: gomma fresca, nessun danno -> valori pieni', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    assert.equal(effectiveMaxSpeed(p, false), 6.2);
    assert.equal(effectiveAccel(p, false), 0.186);
});

test('effectiveMaxSpeed/effectiveAccel: gomma usurata 80% + motore danneggiato 40% -> penalità combinate', () => {
    const p = { compound: 'medium', tyreWear: 80, damageParts: { frontWing: 0, floor: 0, engine: 40, suspension: 0 } };
    // effectiveMaxSpeed: invariato, WEAR_SPEED_PENALTY non tocca da nessuna fase di questa migrazione.
    assert.ok(Math.abs(effectiveMaxSpeed(p, false) - 4.85925) < 1e-9);
    // effectiveAccel: Fase 2B, TyreForceModel.tractionFactor è l'unica fonte del fattore usura
    // (0.9276552375880776 a wear=80, tarato in 2A.5) — valore diverso dal legacy 0.149358
    // rimosso insieme a WEAR_ACCEL_PENALTY.
    assert.ok(Math.abs(effectiveAccel(p, false) - 0.15183860928841653) < 1e-9);
});

test("applyThrottle: da fermo, gomma fresca, senza slittamento -> speed = ACCEL esatto", () => {
    // Ancorato a modello spento: da fermo a pieno gas è esattamente la
    // condizione in cui il wheelspin (ON di default dal 2026-08-11) morde di
    // più, e qui si vuole misurare la formula del motore in isolamento. Il
    // caso acceso è il test gemello più sotto.
    process.env.F1_TYRE_SLIP_MODEL = '0';
    try {
        const p = { speed: 0, inputs: { throttle: 1 }, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
        applyThrottle(p, false, 6.2);
        assert.equal(p.speed, 0.186);
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});

test('applyThrottle: clampa al tetto di velocità', () => {
    const p = { speed: 6.15, inputs: { throttle: 1 }, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    applyThrottle(p, false, 6.2);
    assert.equal(p.speed, 6.2);
});

test('effectiveAccel: Fase 2B, il fattore usura proviene sempre da TyreForceModel.tractionFactor (nessun ramo legacy residuo)', () => {
    const p = { compound: 'medium', tyreWear: 80, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    const expected = ACCEL * tractionFactor(80, false);
    assert.ok(Math.abs(effectiveAccel(p, false) - expected) < 1e-9);
});

test("applyThrottle: Fase 3.1, F1_TYRE_SLIP_MODEL='0' -> comportamento identico a prima anche da fermo a pieno gas su gomma nuova (baseline invariata), _tractionSlipDebt mai toccato", () => {
    // Lo spegnimento ora va DICHIARATO: dal 2026-08-11 il modello è ON di
    // default, quindi "env var non impostata" non è più la baseline. Il
    // percorso spento resta però bit-per-bit quello di prima, ed è proprio
    // quello che questo caso continua a proteggere: è la via di fuga se il
    // wheelspin dovesse dare problemi in gara.
    process.env.F1_TYRE_SLIP_MODEL = '0';
    try {
        const p = { speed: 0, inputs: { throttle: 1 }, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
        applyThrottle(p, false, 6.2);
        assert.equal(p.speed, 0.186);
        assert.equal(p._tractionSlipDebt, undefined, 'a flag spento il debito non deve nemmeno essere creato');
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});

test("applyThrottle: Fase 3.1, F1_TYRE_SLIP_MODEL='1' -> da fermo a pieno gas anche su gomma NUOVA l'accelerazione ottenuta è ridotta (wheelspin, primo tick: debito = eccesso*RISE_RATE)", () => {
    process.env.F1_TYRE_SLIP_MODEL = '1';
    try {
        const p = { speed: 0, inputs: { throttle: 1 }, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
        applyThrottle(p, false, 6.2);
        const excess = tractionExcess(1, 0, tractionFactor(0, false));
        const expectedDebt = updateTractionSlipDebt(undefined, excess);
        const expected = ACCEL * (1 - expectedDebt * TRACTION_SLIP_PENALTY_MAX);
        assert.ok(p.speed < 0.186, `atteso speed ridotta rispetto a 0.186 (baseline), ottenuto ${p.speed}`);
        assert.ok(Math.abs(p.speed - expected) < 1e-9, `atteso ${expected}, ottenuto ${p.speed}`);
        assert.ok(Math.abs(p._tractionSlipDebt - expectedDebt) < 1e-9, `atteso debito ${expectedDebt}, ottenuto ${p._tractionSlipDebt}`);
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});

test("applyThrottle: Fase 3.1, F1_TYRE_SLIP_MODEL='1' -> accumulo: tick consecutivi di pieno gas in zona di lancio fanno crescere il debito (non un semplice ricalcolo istantaneo)", () => {
    process.env.F1_TYRE_SLIP_MODEL = '1';
    try {
        const p = { speed: 0, inputs: { throttle: 1 }, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
        applyThrottle(p, false, 6.2);
        const debtAfterTick1 = p._tractionSlipDebt;
        p.speed = 0; // resimula un tick successivo nelle stesse condizioni (isola l'accumulo dall'avanzamento di velocità)
        applyThrottle(p, false, 6.2);
        const debtAfterTick2 = p._tractionSlipDebt;
        assert.ok(debtAfterTick2 > debtAfterTick1, `atteso debito crescente con eccesso sostenuto: ${debtAfterTick1} -> ${debtAfterTick2}`);
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});

test("applyThrottle: Fase 3.1, F1_TYRE_SLIP_MODEL='1' -> decadimento: uscendo dalla zona di lancio il debito scende gradualmente nei tick successivi, non a zero istantaneo", () => {
    process.env.F1_TYRE_SLIP_MODEL = '1';
    try {
        const p = { speed: 0, inputs: { throttle: 1 }, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
        applyThrottle(p, false, 6.2); // costruisce un debito
        const debtInZone = p._tractionSlipDebt;
        assert.ok(debtInZone > 0, 'precondizione: deve esserci un debito da cui recuperare');

        p.speed = 5; // fuori dalla zona di lancio (speedFrac=5/6.2≈0.81 > 0.50): eccesso torna a 0
        applyThrottle(p, false, 6.2);
        const debtAfterOneTick = p._tractionSlipDebt;
        assert.ok(debtAfterOneTick > 0, `atteso debito ancora positivo dopo un solo tick fuori zona (recupero graduale), ottenuto ${debtAfterOneTick}`);
        assert.ok(debtAfterOneTick < debtInZone, `atteso debito in calo: ${debtInZone} -> ${debtAfterOneTick}`);
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});

test("applyThrottle: Fase 3.1, F1_TYRE_SLIP_MODEL='1' -> fuori dalla zona di lancio (speed=4, speedFrac=0.645 > soglia 0.50), gomma DAVVERO fresca, primo tick -> nessun wheelspin (garanzia matematica: demand=throttle non supera mai capacità=1 fuori zona, debito parte da 0)", () => {
    process.env.F1_TYRE_SLIP_MODEL = '1';
    try {
        const p = { speed: 4, inputs: { throttle: 1 }, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
        applyThrottle(p, false, 6.2);
        const expected = 4 + effectiveAccel(p, false);
        assert.ok(Math.abs(p.speed - expected) < 1e-9, `atteso nessuna riduzione fuori zona di lancio: ${expected}, ottenuto ${p.speed}`);
        assert.equal(p._tractionSlipDebt, 0, 'nessun debito accumulato se non c\'è mai stato eccesso');
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});

test("applyThrottle: Fase 3.1, F1_TYRE_SLIP_MODEL='1' -> su gomma USURATA la finestra di wheelspin si allarga oltre la zona di lancio storica (piccolo residuo anche a velocità moderata, comportamento documentato, non un bug)", () => {
    process.env.F1_TYRE_SLIP_MODEL = '1';
    try {
        const p = { speed: 4, inputs: { throttle: 1 }, compound: 'medium', tyreWear: 80, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
        applyThrottle(p, false, 6.2);
        const noSlipExpected = 4 + effectiveAccel(p, false);
        assert.ok(p.speed < noSlipExpected, `atteso una riduzione residua rispetto a ${noSlipExpected} (finestra allargata dall'usura), ottenuto ${p.speed}`);
        assert.ok(Math.abs(p.speed - 4.1699225186187405) < 1e-9, `atteso 4.1699225186187405, ottenuto ${p.speed}`);
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});

// ---- Fase 1 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// drag longitudinale consultato da AerodynamicsModel dentro effectiveMaxSpeed.
// Promosso a default ON dopo playtest (Rif.
// docs/superpowers/plans/2026-07-28-f1-aerodynamics-playtest-plan.md):
// "non impostato" ora significa ATTIVO; il rollback storico si ottiene con
// F1_AERO_DRAG_MODEL='0' esplicito. ----

test('effectiveMaxSpeed: default ON -> tetto di velocità ridotto rispetto al rollback esplicito "0"', () => {
    assert.equal(process.env.F1_AERO_DRAG_MODEL, undefined);
    const p = { speed: 6.2, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    const onByDefault = effectiveMaxSpeed(p, false);
    process.env.F1_AERO_DRAG_MODEL = '0';
    try {
        const rollback = effectiveMaxSpeed(p, false);
        assert.equal(rollback, 6.2, 'rollback esplicito -> comportamento storico');
        assert.ok(onByDefault < rollback, `atteso tetto ridotto di default: default=${onByDefault}, rollback=${rollback}`);
    } finally {
        delete process.env.F1_AERO_DRAG_MODEL;
    }
});

test('effectiveMaxSpeed: velocità zero -> drag factor neutro (1), nessuna differenza tra default ON e rollback', () => {
    const p = { speed: 0, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    const onByDefault = effectiveMaxSpeed(p, false);
    process.env.F1_AERO_DRAG_MODEL = '0';
    try {
        const rollback = effectiveMaxSpeed(p, false);
        assert.equal(onByDefault, rollback, 'a velocità zero il drag factor è 1: nessun effetto in entrambi i casi');
    } finally {
        delete process.env.F1_AERO_DRAG_MODEL;
    }
});

test('effectiveMaxSpeed: default ON, velocità massima -> tetto di velocità ridotto in modo misurabile rispetto al rollback', () => {
    const p = { speed: 6.2, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    process.env.F1_AERO_DRAG_MODEL = '0';
    const off = effectiveMaxSpeed(p, false);
    delete process.env.F1_AERO_DRAG_MODEL; // torna al default ON
    const on = effectiveMaxSpeed(p, false);
    assert.ok(on < off, `atteso tetto ridotto: off=${off}, on=${on}`);
    const expected = off * AerodynamicsModel.dragFactor(1);
    assert.ok(Math.abs(on - expected) < 1e-9, `atteso ${expected}, ottenuto ${on}`);
});

test('effectiveMaxSpeed: default ON, p.speed assente -> nessun NaN (fallback a 0, stesso invariante già usato per damageParts)', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    const on = effectiveMaxSpeed(p, false);
    assert.ok(!Number.isNaN(on), 'atteso non-NaN anche senza p.speed');
    assert.equal(on, 6.2, 'p.speed assente -> trattato come 0 -> drag factor neutro');
});

// ---- Fase 3 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// danno aero (ala anteriore -> più drag), passato a dragFactor già esistente.
// Promosso a default ON insieme al drag — vedi nota sopra. ----

test('effectiveMaxSpeed: default ON (drag+danno), ala anteriore distrutta -> tetto di velocità ridotto ulteriormente rispetto al solo drag da velocità (danno disattivato con "0")', () => {
    const p = { speed: 6.2, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 100, floor: 0, engine: 0, suspension: 0 } };
    process.env.F1_AERO_DAMAGE_MODEL = '0';
    const withoutDamageModel = effectiveMaxSpeed(p, false);
    delete process.env.F1_AERO_DAMAGE_MODEL; // torna al default ON
    const withDamageModel = effectiveMaxSpeed(p, false);
    assert.ok(withDamageModel < withoutDamageModel, `atteso tetto ulteriormente ridotto: senza=${withoutDamageModel}, con=${withDamageModel}`);
});

test('applyCoast: decelera verso zero senza mai superarlo, avanti e in retromarcia', () => {
    const p1 = { speed: 2 };
    applyCoast(p1);
    assert.equal(p1.speed, 1.88);
    const p2 = { speed: -2 };
    applyCoast(p2);
    assert.equal(p2.speed, -1.88);
    const p3 = { speed: 0.05 };
    applyCoast(p3);
    assert.equal(p3.speed, 0);
});
