// backend/sockets/games/physics/CorneringGripModel.test.js
//
// Test del modulo Fase 4 (Rif.
// docs/superpowers/specs/2026-07-28-f1-cornering-grip-limit-design.md).
// Responsabilità unica: tradurre lo stato del player nell'eccesso
// laterale (0..1) — sola lettura/calcolo, nessuna mutazione di `p`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { lateralExcess, corneringCapacity } = require('./CorneringGripModel');
const { corneringGripFactor } = require('./TyreForceModel');
const { corneringExcess } = require('./TyreSlipModel');
const AerodynamicsModel = require('./AerodynamicsModel');

function assertClose(actual, expected, label) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: atteso ${expected}, ottenuto ${actual}`);
}

function makePlayer(steer, speed, tyreWear) {
    return { speed, tyreWear, inputs: { throttle: 0, brake: 0, steer } };
}

test('lateralExcess: sterzo 0 -> 0 sempre, qualunque velocità/usura', () => {
    assertClose(lateralExcess(makePlayer(0, 6.2, 0), false, 6.2), 0, 'sterzo 0, gomma fresca');
    assertClose(lateralExcess(makePlayer(0, 6.2, 80), false, 6.2), 0, 'sterzo 0, gomma usurata');
});

test('lateralExcess: gomma fresca (tyreWear=0), sterzo pieno a velocità massima -> 0 (criterio 0: mai penalizzata)', () => {
    const p = makePlayer(1, 6.2, 0);
    assertClose(lateralExcess(p, false, 6.2), 0, 'capacità piena = domanda piena, eccesso 0');
});

test('lateralExcess: gomma usurata (tyreWear=80), sterzo pieno a velocità massima -> eccesso > 0, coerente col calcolo diretto (criterio 3: differenza fresca vs usurata; capacità aggiornata dopo la promozione a default ON di F1_AERO_DOWNFORCE_MODEL, Rif. docs/superpowers/plans/2026-07-28-f1-aerodynamics-playtest-plan.md — include ora il contributo downforceFactor)', () => {
    const p = makePlayer(1, 6.2, 80);
    const excess = lateralExcess(p, false, 6.2);
    const expectedCapacity = corneringGripFactor(80, false) * AerodynamicsModel.downforceFactor(1);
    const expected = corneringExcess(1, 1, expectedCapacity);
    assert.ok(excess > 0, `atteso > 0, ottenuto ${excess}`);
    assertClose(excess, expected, 'coerente con corneringGripFactor * downforceFactor + corneringExcess calcolati a mano');
});

test('lateralExcess: a parità di sterzo/velocità, gomma usurata produce eccesso maggiore o uguale a gomma fresca (criterio 3)', () => {
    const fresh = lateralExcess(makePlayer(1, 6.2, 0), false, 6.2);
    const worn  = lateralExcess(makePlayer(1, 6.2, 80), false, 6.2);
    assert.ok(worn > fresh, `atteso eccesso maggiore su gomma usurata: fresca=${fresh}, usurata=${worn}`);
});

test('lateralExcess: isQuali=true -> sempre 0 a prescindere dall\'usura (stesso invariante di TyreForceModel: in qualifica la capacità è sempre piena) — è questo il motivo per cui f1LapSimulator.js non può verificare il criterio 3, vedi spec', () => {
    const wornInQuali = lateralExcess(makePlayer(1, 6.2, 80), true, 6.2);
    const freshInQuali = lateralExcess(makePlayer(1, 6.2, 0), true, 6.2);
    assertClose(wornInQuali, 0, 'usura ignorata in qualifica, come per ogni altro fattore TyreForceModel');
    assertClose(freshInQuali, wornInQuali, 'stesso risultato di una gomma fresca: la capacità è sempre 1 in qualifica');
});

test('lateralExcess: fermo (speed=0) -> 0 sempre, qualunque sterzo/usura', () => {
    assertClose(lateralExcess(makePlayer(1, 0, 80), false, 6.2), 0, 'fermo, sterzo pieno, gomma usurata');
});

test('lateralExcess: velocità in retromarcia (speed negativo) -> stesso comportamento del valore assoluto', () => {
    const forward = lateralExcess(makePlayer(1, 6.2, 80), false, 6.2);
    const reverse = lateralExcess(makePlayer(1, -6.2, 80), false, 6.2);
    assertClose(forward, reverse, 'speedFrac usa Math.abs(p.speed), simmetrico avanti/indietro');
});

test('lateralExcess: non muta il player (sola lettura)', () => {
    const p = makePlayer(1, 6.2, 80);
    const snapshot = JSON.stringify(p);
    lateralExcess(p, false, 6.2);
    assert.equal(JSON.stringify(p), snapshot, 'nessuna mutazione di p');
});

// ---- Fase 2 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// contributo downforce alla capacità, consultato direttamente da AerodynamicsModel.
// Promosso a default ON dopo playtest (Rif.
// docs/superpowers/plans/2026-07-28-f1-aerodynamics-playtest-plan.md):
// "non impostato" ora significa ATTIVO; il rollback storico si ottiene con
// F1_AERO_DOWNFORCE_MODEL='0' esplicito. ----

test('lateralExcess: F1_AERO_DOWNFORCE_MODEL="0" (rollback esplicito) -> comportamento storico', () => {
    process.env.F1_AERO_DOWNFORCE_MODEL = '0';
    try {
        const p = makePlayer(1, 6.2, 80);
        const expectedCapacity = corneringGripFactor(80, false);
        const expected = corneringExcess(1, 1, expectedCapacity);
        assertClose(lateralExcess(p, false, 6.2), expected, 'rollback -> capacità solo da corneringGripFactor');
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
    }
});

test('lateralExcess: default ON, velocità zero -> downforceFactor neutro (1), nessuna differenza rispetto al rollback', () => {
    const p = makePlayer(1, 0, 80);
    const onByDefault = lateralExcess(p, false, 6.2);
    process.env.F1_AERO_DOWNFORCE_MODEL = '0';
    try {
        const rollback = lateralExcess(p, false, 6.2);
        assertClose(onByDefault, rollback, 'a velocità zero il downforceFactor è 1: nessun effetto in entrambi i casi');
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
    }
});

test('lateralExcess: default ON, velocità alta -> capacità aumentata, eccesso ridotto in modo misurabile rispetto al rollback', () => {
    const p = makePlayer(1, 6.2, 80); // gomma usurata: capacità < 1, eccesso > 0 col rollback
    process.env.F1_AERO_DOWNFORCE_MODEL = '0';
    const off = lateralExcess(p, false, 6.2);
    delete process.env.F1_AERO_DOWNFORCE_MODEL; // torna al default ON
    const on = lateralExcess(p, false, 6.2);
    assert.ok(on < off, `atteso eccesso ridotto dalla downforce: off=${off}, on=${on}`);
    const expectedCapacity = corneringGripFactor(80, false) * AerodynamicsModel.downforceFactor(1);
    const expected = corneringExcess(1, 1, expectedCapacity);
    assertClose(on, expected, 'capacità = corneringGripFactor * downforceFactor, combinazione diretta');
});

test('lateralExcess: consulta downforceFactor direttamente, MAI effectiveGrip (nessuna dipendenza incrociata)', () => {
    let effectiveGripCalls = 0;
    let downforceFactorCalls = 0;
    const origEffectiveGrip = AerodynamicsModel.effectiveGrip;
    const origDownforceFactor = AerodynamicsModel.downforceFactor;
    AerodynamicsModel.effectiveGrip = (...args) => { effectiveGripCalls++; return origEffectiveGrip(...args); };
    AerodynamicsModel.downforceFactor = (...args) => { downforceFactorCalls++; return origDownforceFactor(...args); };
    process.env.F1_AERO_DOWNFORCE_MODEL = '1';
    try {
        lateralExcess(makePlayer(1, 6.2, 80), false, 6.2);
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
        AerodynamicsModel.effectiveGrip = origEffectiveGrip;
        AerodynamicsModel.downforceFactor = origDownforceFactor;
    }
    assert.equal(effectiveGripCalls, 0, 'lateralExcess non deve mai chiamare effectiveGrip');
    assert.ok(downforceFactorCalls > 0, 'lateralExcess deve consultare downforceFactor');
});

test('nessun doppio conteggio: chiamare effectiveGrip prima o dopo lateralExcess non cambia i risultati di nessuno dei due (nessuno stato condiviso)', () => {
    process.env.F1_AERO_DOWNFORCE_MODEL = '1';
    try {
        const p = makePlayer(1, 6.2, 0);
        const gripBefore = AerodynamicsModel.effectiveGrip(p, false, 6.2);
        const excess = lateralExcess(p, false, 6.2);
        const gripAfter = AerodynamicsModel.effectiveGrip(p, false, 6.2);
        assertClose(gripAfter, gripBefore, 'effectiveGrip non deve cambiare per effetto di una chiamata a lateralExcess');
        const expectedCapacity = corneringGripFactor(0, false) * AerodynamicsModel.downforceFactor(1);
        assertClose(excess, corneringExcess(1, 1, expectedCapacity), 'capacity di lateralExcess non coinvolge il valore di effectiveGrip');
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
    }
});

// ---- Fase 3 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// danno aero (fondo -> meno downforce), passato a downforceFactor già esistente ----

test('lateralExcess: default ON (downforce+danno), fondo distrutto -> eccesso maggiore rispetto al solo downforce da velocità (danno disattivato con "0")', () => {
    // gomma usurata (tyreWear=80): capacità già < 1 senza downforce, così la
    // riduzione da danno al fondo produce un eccesso misurabile (con gomma
    // fresca il bonus downforce da solo basta a portare la capacità sopra 1,
    // mascherando l'effetto del danno in questo scenario di domanda massima).
    const p = makePlayer(1, 6.2, 80);
    p.damageParts = { frontWing: 0, floor: 100, engine: 0, suspension: 0 };
    process.env.F1_AERO_DAMAGE_MODEL = '0';
    const withoutDamageModel = lateralExcess(p, false, 6.2);
    delete process.env.F1_AERO_DAMAGE_MODEL; // torna al default ON
    const withDamageModel = lateralExcess(p, false, 6.2);
    assert.ok(withDamageModel > withoutDamageModel, `atteso più eccesso con fondo rotto: senza=${withoutDamageModel}, con=${withDamageModel}`);
});

// ---- Estrazione corneringCapacity (Rif.
// docs/superpowers/specs/2026-07-28-f1-bot-grip-awareness-design.md):
// stessa formula già usata inline da lateralExcess, ora esposta come
// funzione a sé per essere consultata anche dal bot IA. Zero cambio di
// comportamento: lateralExcess deve produrre risultati identici a prima
// dell'estrazione. ----

test('corneringCapacity: coincide con la capacità calcolata a mano (usura + downforce)', () => {
    const p = makePlayer(1, 6.2, 80);
    const expected = corneringGripFactor(80, false) * AerodynamicsModel.downforceFactor(1);
    assertClose(corneringCapacity(p, false, 6.2), expected, 'corneringCapacity = corneringGripFactor * downforceFactor');
});

test('corneringCapacity: isQuali=true -> usura ignorata (corneringGripFactor=1), ma il contributo downforce resta attivo (non dipende da isQuali, fenomeno fisico sempre presente)', () => {
    const p = makePlayer(1, 6.2, 80);
    // NON ci si aspetti 1 secco: solo la componente usura è neutralizzata in
    // qualifica (stesso invariante di TyreForceModel). downforceFactor non
    // legge affatto isQuali per il termine legato alla velocità (vedi
    // AerodynamicsModel.js) — a velocità piena resta ~1.15 anche in un giro
    // secco, esattamente come per un'auto vera.
    const expected = AerodynamicsModel.downforceFactor(1, undefined);
    assertClose(corneringCapacity(p, true, 6.2), expected, 'capacità in quali = 1 (usura neutra) * downforceFactor(1) — non un flat 1');
});

test('corneringCapacity: F1_AERO_DOWNFORCE_MODEL="0" -> solo corneringGripFactor, nessun contributo downforce', () => {
    process.env.F1_AERO_DOWNFORCE_MODEL = '0';
    try {
        const p = makePlayer(1, 6.2, 80);
        assertClose(corneringCapacity(p, false, 6.2), corneringGripFactor(80, false), 'rollback -> solo usura');
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
    }
});

test('lateralExcess: dopo l\'estrazione, produce ancora lo stesso risultato di corneringExcess(steer, speedFrac, corneringCapacity(...))', () => {
    const scenarios = [
        makePlayer(1, 6.2, 0), makePlayer(1, 6.2, 80), makePlayer(0.5, 3.1, 50),
        makePlayer(1, 0, 80), makePlayer(1, -6.2, 80)
    ];
    for (const p of scenarios) {
        const speedFrac = Math.min(1, Math.abs(p.speed) / 6.2);
        const expected = corneringExcess(p.inputs.steer, speedFrac, corneringCapacity(p, false, 6.2));
        assertClose(lateralExcess(p, false, 6.2), expected, `lateralExcess deve derivare da corneringCapacity per speed=${p.speed}, wear=${p.tyreWear}`);
    }
});
