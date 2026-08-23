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
const { isTyreSlipModelActive, tractionExcess, updateTractionSlipDebt, TRACTION_SLIP_PENALTY_MAX } = require('./TyreSlipModel');
const AerodynamicsModel = require('./AerodynamicsModel');
const { fuelFactorOf } = require('./FuelModel');

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
    const engineFactor = 1 - getEnginePowerPenalty(p.damageParts);
    let maxSpeed = MAX_SPEED * tyreOf(p, isQuali).speedMult * wearFactor * engineFactor;

    // Fase 1 (percorso di confronto, F1_AERO_DRAG_MODEL=1): drag
    // longitudinale, formula e flag posseduti da AerodynamicsModel (unico
    // proprietario del dominio aero) — PowertrainModel consulta soltanto.
    // speedFrac calcolato sulla costante MAX_SPEED, non su maxSpeed
    // stesso: effectiveMaxSpeed non può usare il proprio output — ancora
    // da calcolare in questa riga — come denominatore (dipendenza
    // circolare), vedi docs/superpowers/plans/2026-07-28-f1-aerodynamics-fase1-drag.md
    // per il dettaglio. A flag spento, comportamento bit-per-bit identico
    // a prima.
    if (AerodynamicsModel.isAeroDragModelActive()) {
        const speedFrac = Math.min(1, Math.abs(p.speed || 0) / MAX_SPEED);
        maxSpeed *= AerodynamicsModel.dragFactor(speedFrac, p.damageParts);
    }

    return maxSpeed;
}

// Fase 2B (Rif. docs/superpowers/specs/2026-07-27-f1-tyre-force-model-migration-design.md):
// TyreForceModel.tractionFactor è ora l'UNICA fonte del fattore usura per la
// trazione — la vecchia WEAR_ACCEL_PENALTY è stata rimossa (Fase 2A/2A.5
// l'avevano affiancata/tarata dietro un flag, ora superfluo).
function effectiveAccel(p, isQuali) {
    const wearFactor   = tractionFactor(p.tyreWear, isQuali);
    const engineFactor = 1 - getEnginePowerPenalty(p.damageParts);
    // Peso del carburante: piu' massa, meno accelerazione. Si DIVIDE perche'
    // fuelFactorOf cresce sopra 1 col serbatoio pieno.
    return ACCEL * wearFactor * engineFactor / fuelFactorOf(p);
}

// Acceleratore premuto: applica effectiveAccel*throttle, clampato al tetto
// di velocità del tick (già scalato da mescola/usura/danno motore/scia).
//
// Fase 3.1 (percorso di confronto, F1_TYRE_SLIP_MODEL=1): quando attivo, non
// riduce l'accelerazione direttamente dall'eccesso istantaneo (Fase 3.0/3A,
// superata: sembrava solo "motore debole", nessuna persistenza tra un tick e
// l'altro) — accumula invece un debito di slittamento persistente su
// `p._tractionSlipDebt` (0..1, gestito qui: TyreSlipModel resta puro e
// stateless, fornisce solo la regola di transizione), che sale in fretta con
// l'eccesso e scende gradualmente quando l'eccesso sparisce. È questo
// ritardo nel recupero a dare la sensazione di "la gomma non riesce a
// trasferire tutta la potenza" invece di un semplice calo istantaneo.
// effectiveAccel resta invariata (riusata da BrakingModel come accelValue:
// contaminarla contaminerebbe anche la frenata). A flag spento (default),
// `p._tractionSlipDebt` non viene mai toccato — comportamento bit-per-bit
// identico a prima.
function applyThrottle(p, isQuali, maxSpeed) {
    let accel = effectiveAccel(p, isQuali);
    if (isTyreSlipModelActive()) {
        const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
        const excess = tractionExcess(p.inputs.throttle, speedFrac, tractionFactor(p.tyreWear, isQuali));
        p._tractionSlipDebt = updateTractionSlipDebt(p._tractionSlipDebt, excess);
        // DEBUG TEMPORANEO (verifica playtest) — rimuovere a effetto validato.
        // Solo umano (!p.isBot), dietro un secondo flag (F1_TYRE_SLIP_DEBUG)
        // così i test esistenti (solo F1_TYRE_SLIP_MODEL) restano silenziosi.
        if (process.env.F1_TYRE_SLIP_DEBUG === '1' && p._tractionSlipDebt > 0.05 && !p.isBot) {
            console.log(`[TyreSlip] wheelspin debt=${p._tractionSlipDebt.toFixed(3)} excess=${excess.toFixed(3)} speed=${p.speed.toFixed(3)} throttle=${p.inputs.throttle} tyreWear=${p.tyreWear.toFixed(1)}`);
        }
        accel *= 1 - p._tractionSlipDebt * TRACTION_SLIP_PENALTY_MAX;
    }
    p.speed = Math.min(p.speed + accel * p.inputs.throttle, maxSpeed);
}

// Nessun pedale premuto: decelerazione costante (FRICTION) verso lo zero,
// mai oltre.
function applyCoast(p) {
    if (p.speed > 0) p.speed = Math.max(p.speed - FRICTION, 0);
    if (p.speed < 0) p.speed = Math.min(p.speed + FRICTION, 0);
}

module.exports = { MAX_SPEED, ACCEL, FRICTION, effectiveMaxSpeed, effectiveAccel, applyThrottle, applyCoast };
