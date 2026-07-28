// backend/sockets/games/physics/CorneringGripModel.test.js
//
// Test del modulo Fase 4 (Rif.
// docs/superpowers/specs/2026-07-28-f1-cornering-grip-limit-design.md).
// Responsabilità unica: tradurre lo stato del player nell'eccesso
// laterale (0..1) — sola lettura/calcolo, nessuna mutazione di `p`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { lateralExcess } = require('./CorneringGripModel');
const { corneringGripFactor } = require('./TyreForceModel');
const { corneringExcess } = require('./TyreSlipModel');

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

test('lateralExcess: gomma usurata (tyreWear=80), sterzo pieno a velocità massima -> eccesso > 0, coerente col calcolo diretto (criterio 3: differenza fresca vs usurata)', () => {
    const p = makePlayer(1, 6.2, 80);
    const excess = lateralExcess(p, false, 6.2);
    const expectedCapacity = corneringGripFactor(80, false);
    const expected = corneringExcess(1, 1, expectedCapacity);
    assert.ok(excess > 0, `atteso > 0, ottenuto ${excess}`);
    assertClose(excess, expected, 'coerente con corneringGripFactor + corneringExcess calcolati a mano');
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
