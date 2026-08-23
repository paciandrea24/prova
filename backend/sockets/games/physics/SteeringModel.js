// backend/sockets/games/physics/SteeringModel.js
//
// Steering Model: sterzo dipendente dalla velocità (pieno sterzo a bassa
// velocità, più contenuto al massimo) + sottosterzo da ala anteriore rotta +
// rumore da sospensioni danneggiate. Estratto da VehiclePhysics.js —
// refactoring architetturale (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const { getFrontWingSteerPenalty, getSuspensionNoise } = require('./DamageModel');
const { fuelCorneringFactor } = require('./FuelModel');
const { brakingFactor } = require('./TyreForceModel');
const { isTyreSlipModelActive, brakingExcess, STEER_LOCKUP_PENALTY_MAX } = require('./TyreSlipModel');

// Velocità di sterzata dipendente dalla velocità dell'auto (non un unico
// valore fisso): pieno sterzo a bassa velocità per manovre strette
// (tornanti, uscita curva), più contenuto al massimo — come un'auto vera.
// Richiesto esplicitamente dall'utente, che trovava lo sterzo "rigido" sia
// in generale (valore assoluto basso) sia perché identico a ogni velocità
// (nessuna differenza basso/alto regime).
const TURN_SPEED_LOW  = 0.075;   // rad/tick a velocità quasi nulla (era 0.048 fisso, +56%)
const TURN_SPEED_HIGH = 0.052;   // rad/tick alla velocità massima (era 0.048 fisso, +8%)

// Aggiorna p.angle in base a input.steer, velocità corrente (interpolazione
// TURN_SPEED_LOW..TURN_SPEED_HIGH) e danno (sottosterzo ala + rumore
// sospensioni). Nessun effetto sotto la soglia di velocità/moto minima.
//
// Fase 3.1 (percorso di confronto, F1_TYRE_SLIP_MODEL=1, estensione di scope
// esplicitamente autorizzata per questo caso): una gomma bloccata in frenata
// (brakingExcess alto, da TyreSlipModel — stessa grandezza già usata da
// BrakingModel, nessun modello laterale nuovo) genera meno aderenza
// laterale, quindi riduce turnRate — NON è sottosterzo/sovrasterzo da
// richiesta di sterzo eccessiva (sistema a parte, non implementato). A flag
// spento (default), comportamento bit-per-bit identico a prima.
function applySteering(p, isQuali, maxSpeed) {
    const { inputs } = p;
    if (Math.abs(p.speed) > 0.01 || (p.vx * p.vx + p.vz * p.vz) > 0.0001) {
        const dir = p.speed >= 0 ? 1 : -1;
        const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
        // Sottosterzo da ala anteriore rotta: riduce la capacità di sterzata
        // (turnRate), non la annulla mai — un'ala completamente distrutta
        // lascia comunque il complemento di FRONT_WING_STEER_PENALTY_MAX di
        // capacità residua, mai zero.
        // Dal 2026-08-23 vale anche in qualifica: in stagione al giro secco
        // si arriva con la macchina che si ha.
        const steerFactor = 1 - getFrontWingSteerPenalty(p.damageParts);
        let turnRate = (TURN_SPEED_LOW + (TURN_SPEED_HIGH - TURN_SPEED_LOW) * speedFrac) * steerFactor;
        // Peso del carburante: l'auto piena sottosterza. Sta QUI e non in
        // effectiveGrip perche' questo e' il posto dove "l'auto gira di meno"
        // ha un significato non ambiguo — e' lo stesso meccanismo del
        // sottosterzo da ala rotta, tre righe sopra. In curva il peso conta
        // la meta' (FUEL_CORNERING_SHARE): vedi FuelModel.js.
        turnRate /= fuelCorneringFactor(p);
        if (isTyreSlipModelActive()) {
            const lockupExcess = brakingExcess(inputs.brake, speedFrac, brakingFactor(p.tyreWear, isQuali));
            turnRate *= 1 - lockupExcess * STEER_LOCKUP_PENALTY_MAX;
        }
        const suspensionNoise = getSuspensionNoise(p.damageParts);
        const steer = inputs.steer + suspensionNoise;
        p.angle += turnRate * dir * steer;
    }
}

module.exports = { TURN_SPEED_LOW, TURN_SPEED_HIGH, applySteering };
