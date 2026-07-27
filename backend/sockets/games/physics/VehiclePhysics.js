// backend/sockets/games/physics/VehiclePhysics.js
//
// Vehicle Controller / Physics Model: velocità (accelerazione/freno/sterzo/
// grip). L'integrazione della posizione e il drag fuoripista sono ora in
// VehicleMotionModel.js — refactoring architetturale (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const { tyreOf, WEAR_SPEED_PENALTY, WEAR_GRIP_PENALTY, WEAR_BRAKE_PENALTY, WEAR_ACCEL_PENALTY, getWearPenaltyFactor } = require('./TyreModel');
const {
    getEnginePowerPenalty, getFloorGripPenalty, getFrontWingSteerPenalty, getSuspensionNoise
} = require('./DamageModel');
const { integratePosition, applyOffTrackDrag } = require('./VehicleMotionModel');

// Velocità realistica F1: fattore di scala R=1.55 (+55%) applicato a
// MAX_SPEED/ACCEL/FRICTION rispetto ai valori storici (4.0/0.12/0.050).
// Vedi docs/superpowers/specs/2026-07-21-f1-velocita-frenata-mescole-design.md.
const MAX_SPEED    = 6.2;
const ACCEL        = 0.186;
const FRICTION     = 0.120;
const TURN_SPEED_LOW  = 0.075;   // rad/tick a velocità quasi nulla
const TURN_SPEED_HIGH = 0.052;   // rad/tick alla velocità massima
const GRIP         = 0.78;
const BRAKE_MULT   = 2.17;   // moltiplicatore di ACCEL in frenata

function effectiveMaxSpeed(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_SPEED_PENALTY;
    const engineFactor = isQuali ? 1 : 1 - getEnginePowerPenalty(p.damageParts);
    return MAX_SPEED * tyreOf(p, isQuali).speedMult * wearFactor * engineFactor;
}

function effectiveGrip(p, isQuali) {
    const wearFactor  = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_GRIP_PENALTY;
    const floorFactor = isQuali ? 1 : 1 - getFloorGripPenalty(p.damageParts);
    return GRIP * tyreOf(p, isQuali).gripMult * wearFactor * floorFactor;
}

function effectiveAccel(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_ACCEL_PENALTY;
    const engineFactor = isQuali ? 1 : 1 - getEnginePowerPenalty(p.damageParts);
    return ACCEL * wearFactor * engineFactor;
}

function effectiveBrakeMult(p, isQuali) {
    const wearFactor = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_BRAKE_PENALTY;
    return BRAKE_MULT * wearFactor;
}

function updateVelocity(p, isQuali, slipstreamMult) {
    const { inputs } = p;
    const maxSpeed = effectiveMaxSpeed(p, isQuali) * (slipstreamMult || 1);
    const grip     = effectiveGrip(p, isQuali);

    if (inputs.throttle > 0) p.speed = Math.min(p.speed + effectiveAccel(p, isQuali) * inputs.throttle, maxSpeed);
    else if (inputs.brake > 0) {
        p.speed = Math.max(p.speed - effectiveAccel(p, isQuali) * effectiveBrakeMult(p, isQuali) * inputs.brake, -maxSpeed / 2);
        p.vx *= 0.94;
        p.vz *= 0.94;
    } else {
        if (p.speed > 0) p.speed = Math.max(p.speed - FRICTION, 0);
        if (p.speed < 0) p.speed = Math.min(p.speed + FRICTION, 0);
    }
    if (p.speed > maxSpeed) p.speed = maxSpeed;

    if (Math.abs(p.speed) > 0.01 || (p.vx * p.vx + p.vz * p.vz) > 0.0001) {
        const dir = p.speed >= 0 ? 1 : -1;
        const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
        const steerFactor = isQuali ? 1 : 1 - getFrontWingSteerPenalty(p.damageParts);
        const turnRate = (TURN_SPEED_LOW + (TURN_SPEED_HIGH - TURN_SPEED_LOW) * speedFrac) * steerFactor;
        const suspensionNoise = isQuali ? 0 : getSuspensionNoise(p.damageParts);
        const steer = inputs.steer + suspensionNoise;
        p.angle += turnRate * dir * steer;
    }

    const fx = Math.sin(p.angle) * p.speed;
    const fz = Math.cos(p.angle) * p.speed;
    p.vx = p.vx * grip + fx * (1 - grip);
    p.vz = p.vz * grip + fz * (1 - grip);
}

module.exports = {
    MAX_SPEED, ACCEL, FRICTION, TURN_SPEED_LOW, TURN_SPEED_HIGH, GRIP, BRAKE_MULT,
    effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult, updateVelocity, integratePosition, applyOffTrackDrag
};
