// backend/sockets/games/physics/PowertrainModel.js
//
// Powertrain Model: accelerazione da acceleratore + coast-down ad
// acceleratore rilasciato (attrito costante per tick). Estrazione 1:1 della
// logica esistente da VehiclePhysics.js — nessun nuovo modello motore
// introdotto (refactoring architetturale, Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md).
const { tyreOf, WEAR_SPEED_PENALTY, WEAR_ACCEL_PENALTY, getWearPenaltyFactor } = require('./TyreModel');
const { getEnginePowerPenalty } = require('./DamageModel');

// Velocità realistica F1: fattore di scala R=1.55 (+55%) applicato a
// MAX_SPEED/ACCEL/FRICTION rispetto ai valori storici (4.0/0.12/0.050). Vedi
// docs/superpowers/specs/2026-07-21-f1-velocita-frenata-mescole-design.md.
const MAX_SPEED = 6.2;
const ACCEL     = 0.186;
const FRICTION  = 0.120;   // decremento costante per tick del coast-down

function effectiveMaxSpeed(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_SPEED_PENALTY;
    const engineFactor = isQuali ? 1 : 1 - getEnginePowerPenalty(p.damageParts);
    return MAX_SPEED * tyreOf(p, isQuali).speedMult * wearFactor * engineFactor;
}

function effectiveAccel(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_ACCEL_PENALTY;
    const engineFactor = isQuali ? 1 : 1 - getEnginePowerPenalty(p.damageParts);
    return ACCEL * wearFactor * engineFactor;
}

// Acceleratore premuto: applica effectiveAccel*throttle, clampato al tetto
// di velocità del tick (già scalato da mescola/usura/danno motore/scia).
function applyThrottle(p, isQuali, maxSpeed) {
    p.speed = Math.min(p.speed + effectiveAccel(p, isQuali) * p.inputs.throttle, maxSpeed);
}

// Nessun pedale premuto: decelerazione costante (FRICTION) verso lo zero,
// mai oltre.
function applyCoast(p) {
    if (p.speed > 0) p.speed = Math.max(p.speed - FRICTION, 0);
    if (p.speed < 0) p.speed = Math.min(p.speed + FRICTION, 0);
}

module.exports = { MAX_SPEED, ACCEL, FRICTION, effectiveMaxSpeed, effectiveAccel, applyThrottle, applyCoast };
