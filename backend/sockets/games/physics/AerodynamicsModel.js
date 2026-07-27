// backend/sockets/games/physics/AerodynamicsModel.js
//
// Aerodynamics Model: aderenza (grip) da mescola/usura/danno al fondo +
// blend finale vx/vz verso la direzione del muso. Estratto da
// VehiclePhysics.js — refactoring architetturale (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const { tyreOf } = require('./TyreModel');
const { getFloorGripPenalty } = require('./DamageModel');
const { corneringGripFactor } = require('./TyreForceModel');

const GRIP = 0.78;

// Stesso invariante "niente NaN senza damageParts" di
// PowertrainModel.effectiveMaxSpeed (vedi lì per i dettagli): getFloorGripPenalty
// gestisce l'assenza del campo internamente.
// Fase 2B (Rif. docs/superpowers/specs/2026-07-27-f1-tyre-force-model-migration-design.md):
// TyreForceModel.corneringGripFactor è ora l'UNICA fonte del fattore usura
// per l'aderenza in curva — la vecchia WEAR_GRIP_PENALTY è stata rimossa.
function effectiveGrip(p, isQuali) {
    const wearFactor  = corneringGripFactor(p.tyreWear, isQuali);
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
