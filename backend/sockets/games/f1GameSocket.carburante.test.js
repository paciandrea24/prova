// backend/sockets/games/f1GameSocket.carburante.test.js
//
// Chi riempie il serbatoio. C'e' UN SOLO punto che decide quanta benzina ha
// a bordo un'auto, ed e' il tick: i modelli fisici leggono p.fuelFactor e
// non sanno ne' che formato di gara si sta correndo ne' che esistono le
// stagioni. Questi test proteggono quell'unicita'.
// Rif. docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md
const test = require('node:test');
const assert = require('node:assert/strict');
// f1GameSocket esporta sotto `physics`, non piatto: vedi `module.exports.physics`
// in fondo al file, dove stanno gia' assignGridSpawns, checkLap e compagnia.
const { aggiornaCarburante } = require('./f1GameSocket.js').physics;
const { FUEL_MASS_AT_START } = require('./physics/FuelModel.js');

const vicino = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: atteso ${b}, ottenuto ${a}`);

test('in gara, al via il serbatoio e\' pieno', () => {
    const p = { lap: 0 };
    aggiornaCarburante(p, false, 10);
    vicino(p.fuelFactor, FUEL_MASS_AT_START, 'giro 0');
});

test('in gara, all\'ultimo giro il serbatoio e\' vuoto', () => {
    const p = { lap: 10 };
    aggiornaCarburante(p, false, 10);
    vicino(p.fuelFactor, 1, 'giro 10');
});

test('in qualifica il serbatoio e\' sempre vuoto', () => {
    // In qualifica totalLaps vale 1: usarlo darebbe un'auto PIENA sul giro
    // secco, l'esatto contrario di come si corre una qualifica.
    const p = { lap: 0 };
    aggiornaCarburante(p, true, 1);
    vicino(p.fuelFactor, 1, 'qualifica');
});

test('ogni pilota ha il SUO carburante, non quello della gara', () => {
    // Un doppiato non puo' essere leggero come chi lo ha doppiato.
    const avanti   = { lap: 8 };
    const doppiato = { lap: 4 };
    aggiornaCarburante(avanti, false, 10);
    aggiornaCarburante(doppiato, false, 10);
    assert.ok(doppiato.fuelFactor > avanti.fuelFactor,
        `il doppiato deve essere piu' pesante, ottenuto ${doppiato.fuelFactor} vs ${avanti.fuelFactor}`);
});
