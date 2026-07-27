// backend/sockets/games/physics/VehiclePhysics.js
//
// Vehicle Physics: orchestratore del calcolo velocità per tick. Le formule
// vivono nei sotto-moduli (PowertrainModel/BrakingModel/SteeringModel/
// AerodynamicsModel/VehicleMotionModel) — questo file li chiama nello STESSO
// ordine di sempre (refactoring architetturale, Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md) e
// ri-esporta i nomi pubblici storici per compatibilità con f1GameSocket.js,
// f1Bot.js e gli strumenti offline (f1LapSimulator.js, f1RaceLineOptimizer.js).
const PowertrainModel   = require('./PowertrainModel');
const BrakingModel      = require('./BrakingModel');
const SteeringModel     = require('./SteeringModel');
const AerodynamicsModel = require('./AerodynamicsModel');
const { integratePosition, applyOffTrackDrag } = require('./VehicleMotionModel');

const { MAX_SPEED, ACCEL, FRICTION, effectiveMaxSpeed, effectiveAccel } = PowertrainModel;
const { BRAKE_MULT, effectiveBrakeMult } = BrakingModel;
const { TURN_SPEED_LOW, TURN_SPEED_HIGH } = SteeringModel;
const { GRIP, effectiveGrip } = AerodynamicsModel;

// ====================================================
// FISICA
// Velocità (accelerazione/freno/sterzo/grip) e integrazione della posizione
// sono separate apposta: la velocità si calcola una volta per tick, la
// posizione viene integrata in sottostep da tickGame (vedi
// CollisionResolver.COLLISION_SUBSTEPS) per dare alla risoluzione collisioni
// più occasioni di vedere un contatto.
// ====================================================
function updateVelocity(p, isQuali, slipstreamMult) {
    const { inputs } = p;
    const maxSpeed = effectiveMaxSpeed(p, isQuali) * (slipstreamMult || 1);   // dipende da mescola + usura (Soft fissa in qualifica) + scia
    const grip     = effectiveGrip(p, isQuali);

    if (inputs.throttle > 0) PowertrainModel.applyThrottle(p, isQuali, maxSpeed);
    else if (inputs.brake > 0) BrakingModel.applyBrake(p, isQuali, maxSpeed, effectiveAccel(p, isQuali));
    else PowertrainModel.applyCoast(p);

    // Il tetto di velocità può essersi abbassato (usura aumentata da fermo non
    // succede, ma cambiando mescola in futuro pit stop sì): non lasciare mai
    // p.speed sopra il nuovo massimo.
    if (p.speed > maxSpeed) p.speed = maxSpeed;

    SteeringModel.applySteering(p, isQuali, maxSpeed);

    AerodynamicsModel.applyGripBlend(p, grip);
}

module.exports = {
    MAX_SPEED, ACCEL, FRICTION, TURN_SPEED_LOW, TURN_SPEED_HIGH, GRIP, BRAKE_MULT,
    effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult, updateVelocity, integratePosition, applyOffTrackDrag
};
