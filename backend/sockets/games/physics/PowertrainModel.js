// backend/sockets/games/physics/PowertrainModel.js
//
// Powertrain Model: accelerazione da acceleratore + coast-down ad
// acceleratore rilasciato (attrito costante per tick). Estrazione 1:1 della
// logica esistente da VehiclePhysics.js — nessun nuovo modello motore
// introdotto (refactoring architetturale, Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md).
const { tyreOf, WEAR_SPEED_PENALTY, getWearPenaltyFactor } = require('./TyreModel');
const { getEnginePowerPenalty } = require('./DamageModel');
const { tractionFactor } = require('./TyreForceModel');

// Velocità realistica F1: fattore di scala R=1.55 (+55%) applicato a
// MAX_SPEED/ACCEL/FRICTION rispetto ai valori storici (4.0/0.12/0.050). Vedi
// docs/superpowers/specs/2026-07-21-f1-velocita-frenata-mescole-design.md.
// Km/h a schermo = speed * 55 (frontend/f1.js): 6.2 → 341 km/h base Medium,
// 358 Soft, 324 Hard.
const MAX_SPEED = 6.2;
const ACCEL     = 0.186;
const FRICTION  = 0.120;   // decremento costante per tick del coast-down

// Le penalità da danno leggono p.damageParts tramite le funzioni pure di
// DamageModel.js (getEnginePowerPenalty/...), che gestiscono internamente
// l'assenza del campo (parts?.x || 0): gli strumenti offline
// (f1LapSimulator.js, f1RaceLineOptimizer.js) costruiscono i loro player di
// simulazione senza damageParts e ottengono correttamente penalità 0, senza
// NaN. Per i giocatori reali damageParts è sempre popolato (vedi init in
// joinF1Game/createBots).
function effectiveMaxSpeed(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_SPEED_PENALTY;
    const engineFactor = isQuali ? 1 : 1 - getEnginePowerPenalty(p.damageParts);
    return MAX_SPEED * tyreOf(p, isQuali).speedMult * wearFactor * engineFactor;
}

// Fase 2B (Rif. docs/superpowers/specs/2026-07-27-f1-tyre-force-model-migration-design.md):
// TyreForceModel.tractionFactor è ora l'UNICA fonte del fattore usura per la
// trazione — la vecchia WEAR_ACCEL_PENALTY è stata rimossa (Fase 2A/2A.5
// l'avevano affiancata/tarata dietro un flag, ora superfluo).
function effectiveAccel(p, isQuali) {
    const wearFactor   = tractionFactor(p.tyreWear, isQuali);
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
