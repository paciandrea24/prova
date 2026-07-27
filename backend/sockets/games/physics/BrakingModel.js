// backend/sockets/games/physics/BrakingModel.js
//
// Braking Model: frenata/retromarcia (decremento costante per tick, tetto a
// -maxSpeed/2) + smorzamento laterale in frenata. Estratto da
// VehiclePhysics.js — refactoring architetturale (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const { WEAR_BRAKE_PENALTY, getWearPenaltyFactor } = require('./TyreModel');

const BRAKE_MULT = 2.17;   // moltiplicatore di ACCEL in frenata

function effectiveBrakeMult(p, isQuali) {
    const wearFactor = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_BRAKE_PENALTY;
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
