// backend/sockets/games/physics/FuelModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    FUEL_MASS_AT_START, FUEL_CORNERING_SHARE,
    fuelFactorFor, fuelFactorOf, fuelCorneringFactor
} = require('./FuelModel.js');

const vicino = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: atteso ${b}, ottenuto ${a}`);

test('fuelFactorFor: al via il serbatoio e\' pieno', () => {
    vicino(fuelFactorFor(0, 10), FUEL_MASS_AT_START, 'giro 0 su 10');
});

test('fuelFactorFor: all\'ultimo giro il serbatoio e\' vuoto', () => {
    vicino(fuelFactorFor(10, 10), 1, 'giro 10 su 10');
});

test('fuelFactorFor: a meta\' gara pesa meta\' del pieno', () => {
    vicino(fuelFactorFor(5, 10), 1 + (FUEL_MASS_AT_START - 1) / 2, 'giro 5 su 10');
});

test('fuelFactorFor: oltre l\'ultimo giro resta vuoto, non va sotto 1', () => {
    // Il giro di rientro dopo la bandiera: p.lap puo' superare totalLaps.
    vicino(fuelFactorFor(20, 10), 1, 'giro 20 su 10');
});

test('fuelFactorFor: giro negativo o totalLaps assurdo non produce NaN', () => {
    vicino(fuelFactorFor(-3, 10), FUEL_MASS_AT_START, 'giro negativo');
    vicino(fuelFactorFor(0, 0), FUEL_MASS_AT_START, 'zero giri totali');
    vicino(fuelFactorFor(undefined, undefined), FUEL_MASS_AT_START, 'tutto assente');
});

test('fuelFactorOf: senza il campo l\'auto e\' scarica', () => {
    // INVARIANTE: gli strumenti offline costruiscono giocatori a mano e non
    // popolano fuelFactor. Serbatoio vuoto e' l'unica lettura sensata, ed e'
    // anche quella che tiene il comportamento identico a prima del carburante.
    vicino(fuelFactorOf({}), 1, 'oggetto vuoto');
    vicino(fuelFactorOf(undefined), 1, 'player assente');
    vicino(fuelFactorOf({ fuelFactor: null }), 1, 'campo nullo');
    vicino(fuelFactorOf({ fuelFactor: NaN }), 1, 'campo NaN');
});

test('fuelFactorOf: col campo restituisce il campo', () => {
    vicino(fuelFactorOf({ fuelFactor: 1.05 }), 1.05, 'campo valido');
});

test('fuelFactorOf: un valore sotto 1 non alleggerisce l\'auto oltre il vuoto', () => {
    vicino(fuelFactorOf({ fuelFactor: 0.5 }), 1, 'campo assurdo');
});

test('fuelCorneringFactor: in curva il peso conta la meta\'', () => {
    const pieno = { fuelFactor: FUEL_MASS_AT_START };
    const atteso = 1 + (FUEL_MASS_AT_START - 1) * FUEL_CORNERING_SHARE;
    vicino(fuelCorneringFactor(pieno), atteso, 'auto piena');
    vicino(fuelCorneringFactor({}), 1, 'auto scarica');
});

// ---- Gli agganci: dove il peso si sente davvero ----------------------------
const PowertrainModel    = require('./PowertrainModel');
const BrakingModel       = require('./BrakingModel');
const SteeringModel      = require('./SteeringModel');
const CorneringGripModel = require('./CorneringGripModel');

function auto(fuelFactor) {
    const p = {
        speed: 3, angle: 0, vx: 0, vz: 3,
        inputs: { throttle: 1, brake: 0, steer: 1 },
        compound: 'medium', tyreWear: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
    };
    if (fuelFactor !== undefined) p.fuelFactor = fuelFactor;
    return p;
}

test('aggancio: l\'auto piena accelera meno', () => {
    const scarica = PowertrainModel.effectiveAccel(auto(), false);
    const piena   = PowertrainModel.effectiveAccel(auto(FUEL_MASS_AT_START), false);
    assert.ok(piena < scarica, `atteso piena < scarica, ottenuto ${piena} vs ${scarica}`);
});

test('aggancio: l\'auto piena frena meno', () => {
    const scarica = BrakingModel.effectiveBrakeMult(auto(), false);
    const piena   = BrakingModel.effectiveBrakeMult(auto(FUEL_MASS_AT_START), false);
    assert.ok(piena < scarica, `atteso piena < scarica, ottenuto ${piena} vs ${scarica}`);
});

test('aggancio: l\'auto piena gira meno', () => {
    const scarica = auto();
    const piena   = auto(FUEL_MASS_AT_START);
    SteeringModel.applySteering(scarica, false, 6.2);
    SteeringModel.applySteering(piena, false, 6.2);
    assert.ok(Math.abs(piena.angle) < Math.abs(scarica.angle),
        `atteso meno sterzata da piena, ottenuto ${piena.angle} vs ${scarica.angle}`);
});

test('aggancio: l\'auto piena ha meno capacita\' laterale (e il bot lo sa)', () => {
    const scarica = CorneringGripModel.corneringCapacity(auto(), false, 6.2);
    const piena   = CorneringGripModel.corneringCapacity(auto(FUEL_MASS_AT_START), false, 6.2);
    assert.ok(piena < scarica, `atteso piena < scarica, ottenuto ${piena} vs ${scarica}`);
});

test('aggancio: in curva il peso pesa META\' di quanto pesa in rettilineo', () => {
    // Non e' un dettaglio di taratura, e' la scelta che rende giocabile il
    // primo giro: se un giorno i due effetti coincidono, qualcuno ha tolto
    // FUEL_CORNERING_SHARE senza accorgersene.
    const pieno = { fuelFactor: FUEL_MASS_AT_START };
    const rettilineo = fuelFactorOf(pieno) - 1;
    const curva      = fuelCorneringFactor(pieno) - 1;
    vicino(curva, rettilineo * FUEL_CORNERING_SHARE, 'quota in curva');
    assert.ok(curva < rettilineo, 'in curva il peso deve pesare meno che in rettilineo');
});

test('aggancio: senza fuelFactor il comportamento e\' identico a prima', () => {
    // La garanzia di non-regressione per gare veloci, qualifica e strumenti
    // offline: un giocatore che non ha il campo non deve vedere NULLA di
    // diverso da prima del carburante.
    const senza = auto();
    const uno   = auto(1);
    assert.equal(PowertrainModel.effectiveAccel(senza, false), PowertrainModel.effectiveAccel(uno, false));
    assert.equal(BrakingModel.effectiveBrakeMult(senza, false), BrakingModel.effectiveBrakeMult(uno, false));
    assert.equal(
        CorneringGripModel.corneringCapacity(senza, false, 6.2),
        CorneringGripModel.corneringCapacity(uno, false, 6.2)
    );
});
