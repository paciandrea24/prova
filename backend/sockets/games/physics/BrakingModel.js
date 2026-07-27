// backend/sockets/games/physics/BrakingModel.js
//
// Braking Model: frenata/retromarcia (decremento costante per tick, tetto a
// -maxSpeed/2) + smorzamento laterale in frenata. Estratto da
// VehiclePhysics.js — refactoring architetturale (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const { brakingFactor } = require('./TyreForceModel');

// Moltiplicatore di ACCEL in frenata (era 1.4 a MAX_SPEED=4.0), scalato ×R²
// (non ×R) come FRICTION: la decelerazione è un decremento costante per
// tick, quindi lo spazio d'arresto va con v²/decel — per tenerlo vicino a
// quello di prima dell'aumento di velocità (R=1.55) serve lo stesso ×R² di
// FRICTION. Vedi docs/superpowers/specs/2026-07-21-f1-velocita-frenata-mescole-design.md.
const BRAKE_MULT = 2.17;

// Fase 2B (Rif. docs/superpowers/specs/2026-07-27-f1-tyre-force-model-migration-design.md):
// TyreForceModel.brakingFactor è ora l'UNICA fonte del fattore usura per la
// frenata — la vecchia WEAR_BRAKE_PENALTY è stata rimossa.
function effectiveBrakeMult(p, isQuali) {
    const wearFactor = brakingFactor(p.tyreWear, isQuali);
    return BRAKE_MULT * wearFactor;
}

// `accelValue` = effectiveAccel(p, isQuali) del chiamante (PowertrainModel):
// BrakingModel non dipende da PowertrainModel, riceve il valore già pronto.
function applyBrake(p, isQuali, maxSpeed, accelValue) {
    p.speed = Math.max(p.speed - accelValue * effectiveBrakeMult(p, isQuali) * p.inputs.brake, -maxSpeed / 2);
    p.vx *= 0.94;
    p.vz *= 0.94;
}

module.exports = { BRAKE_MULT, effectiveBrakeMult, applyBrake };
