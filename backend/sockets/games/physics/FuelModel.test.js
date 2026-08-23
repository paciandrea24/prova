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
