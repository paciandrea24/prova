// backend/sockets/games/physics/VehiclePhysics.js
//
// Vehicle Controller / Physics Model: grip (aderenza). Motore in
// PowertrainModel.js, freno in BrakingModel.js, sterzo in SteeringModel.js,
// integrazione posizione/drag fuoripista in VehicleMotionModel.js —
// refactoring architetturale (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const { tyreOf, WEAR_GRIP_PENALTY, getWearPenaltyFactor } = require('./TyreModel');
const { getFloorGripPenalty } = require('./DamageModel');
const { integratePosition, applyOffTrackDrag } = require('./VehicleMotionModel');
const SteeringModel = require('./SteeringModel');
const { TURN_SPEED_LOW, TURN_SPEED_HIGH } = SteeringModel;
const BrakingModel = require('./BrakingModel');
const { BRAKE_MULT, effectiveBrakeMult } = BrakingModel;
const PowertrainModel = require('./PowertrainModel');
const { MAX_SPEED, ACCEL, FRICTION, effectiveMaxSpeed, effectiveAccel } = PowertrainModel;

const GRIP = 0.78;

function effectiveGrip(p, isQuali) {
    const wearFactor  = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_GRIP_PENALTY;
    const floorFactor = isQuali ? 1 : 1 - getFloorGripPenalty(p.damageParts);
    return GRIP * tyreOf(p, isQuali).gripMult * wearFactor * floorFactor;
}

function updateVelocity(p, isQuali, slipstreamMult) {
    const { inputs } = p;
    const maxSpeed = effectiveMaxSpeed(p, isQuali) * (slipstreamMult || 1);
    const grip     = effectiveGrip(p, isQuali);

    if (inputs.throttle > 0) PowertrainModel.applyThrottle(p, isQuali, maxSpeed);
    else if (inputs.brake > 0) BrakingModel.applyBrake(p, isQuali, maxSpeed, effectiveAccel(p, isQuali));
    else PowertrainModel.applyCoast(p);

    if (p.speed > maxSpeed) p.speed = maxSpeed;

    SteeringModel.applySteering(p, isQuali, maxSpeed);

    const fx = Math.sin(p.angle) * p.speed;
    const fz = Math.cos(p.angle) * p.speed;
    p.vx = p.vx * grip + fx * (1 - grip);
    p.vz = p.vz * grip + fz * (1 - grip);
}

module.exports = {
    MAX_SPEED, ACCEL, FRICTION, TURN_SPEED_LOW, TURN_SPEED_HIGH, GRIP, BRAKE_MULT,
    effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult, updateVelocity, integratePosition, applyOffTrackDrag
};
