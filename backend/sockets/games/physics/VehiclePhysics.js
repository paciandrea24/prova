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
const CorneringGripModel = require('./CorneringGripModel');
const { integratePosition, applyOffTrackDrag } = require('./VehicleMotionModel');
const { isCorneringGripModelActive, CORNERING_EXCESS_PENALTY_MAX } = require('./TyreSlipModel');

const { MAX_SPEED, ACCEL, FRICTION, effectiveMaxSpeed, effectiveAccel } = PowertrainModel;
const { BRAKE_MULT, effectiveBrakeMult } = BrakingModel;
const { TURN_SPEED_LOW, TURN_SPEED_HIGH } = SteeringModel;
const { GRIP, effectiveGrip } = AerodynamicsModel;
const { corneringCapacity } = CorneringGripModel;

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
    // maxSpeed passato a effectiveGrip (Fase 2, F1_AERO_DOWNFORCE_MODEL=1):
    // consente il contributo downforce dietro flag, vedi AerodynamicsModel.js.
    let grip = effectiveGrip(p, isQuali, maxSpeed);

    if (inputs.throttle > 0) PowertrainModel.applyThrottle(p, isQuali, maxSpeed);
    else if (inputs.brake > 0) BrakingModel.applyBrake(p, isQuali, maxSpeed, effectiveAccel(p, isQuali));
    else PowertrainModel.applyCoast(p);

    // Il tetto di velocità può essersi abbassato (usura aumentata da fermo non
    // succede, ma cambiando mescola in futuro pit stop sì): non lasciare mai
    // p.speed sopra il nuovo massimo.
    if (p.speed > maxSpeed) p.speed = maxSpeed;

    SteeringModel.applySteering(p, isQuali, maxSpeed);

    // Fase 4 (percorso di confronto, F1_CORNERING_GRIP_MODEL=1): modello di
    // perdita di CAPACITÀ laterale (non slip angle fisico, vedi
    // docs/superpowers/specs/2026-07-28-f1-cornering-grip-limit-design.md).
    //
    // ATTENZIONE al significato di `grip` in applyGripBlend: NON è "quanto
    // l'auto insegue il muso", è l'opposto — pesa quanto p.vx/p.vz
    // RESTANO ancorati alla vecchia direzione invece di convergere verso
    // il muso (p.vx = p.vx*grip + fx*(1-grip): grip ALTO = più ancoraggio
    // alla vecchia direzione = PIÙ divergenza muso/velocità reale nel
    // tempo, cioè PIÙ sottosterzo; grip BASSO = l'auto insegue il muso
    // quasi perfettamente, zero scivolata). Verificato empiricamente
    // simulando uno sterzo sostenuto: a grip=0.9 la divergenza cresce
    // continuamente, a grip=0.4 si stabilizza subito su un valore piccolo.
    // Per questo, quando la domanda eccede la capacità, l'eccesso deve
    // SPINGERE grip VERSO 1 (non ridurlo): NON tocca p.speed né p.angle,
    // l'effetto emerge solo nel blend vx/vz sotto, come scarto crescente
    // tra dove punta il muso e dove va davvero l'auto (sottosterzo/
    // scivolata progressiva verso l'esterno). A flag spento (default),
    // comportamento bit-per-bit identico a prima.
    if (isCorneringGripModelActive()) {
        const excess = CorneringGripModel.lateralExcess(p, isQuali, maxSpeed);
        grip += (1 - grip) * excess * CORNERING_EXCESS_PENALTY_MAX;
    }

    AerodynamicsModel.applyGripBlend(p, grip);
}

module.exports = {
    MAX_SPEED, ACCEL, FRICTION, TURN_SPEED_LOW, TURN_SPEED_HIGH, GRIP, BRAKE_MULT,
    effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult, corneringCapacity,
    updateVelocity, integratePosition, applyOffTrackDrag
};
