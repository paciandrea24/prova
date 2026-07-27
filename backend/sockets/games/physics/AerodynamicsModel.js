// backend/sockets/games/physics/AerodynamicsModel.js
//
// Aerodynamics Model: aderenza (grip) da mescola/usura/danno al fondo +
// blend finale vx/vz verso la direzione del muso. Estratto da
// VehiclePhysics.js — refactoring architetturale (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const { tyreOf, WEAR_GRIP_PENALTY, getWearPenaltyFactor } = require('./TyreModel');
const { getFloorGripPenalty } = require('./DamageModel');

const GRIP = 0.78;

// Stesso invariante "niente NaN senza damageParts" di
// PowertrainModel.effectiveMaxSpeed (vedi lì per i dettagli): getFloorGripPenalty
// gestisce l'assenza del campo internamente.
function effectiveGrip(p, isQuali) {
    const wearFactor  = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_GRIP_PENALTY;
    const floorFactor = isQuali ? 1 : 1 - getFloorGripPenalty(p.damageParts);
    return GRIP * tyreOf(p, isQuali).gripMult * wearFactor * floorFactor;
}

// Blend tra la velocità vettoriale corrente e la direzione del muso
// (sin/cos(angle)*speed), pesato da grip: più aderenza = più velocemente
// vx/vz convergono verso dove punta l'auto.
function applyGripBlend(p, grip) {
    const fx = Math.sin(p.angle) * p.speed;
    const fz = Math.cos(p.angle) * p.speed;
    p.vx = p.vx * grip + fx * (1 - grip);
    p.vz = p.vz * grip + fz * (1 - grip);
}

module.exports = { GRIP, effectiveGrip, applyGripBlend };
