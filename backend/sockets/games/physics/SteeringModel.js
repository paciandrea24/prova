// backend/sockets/games/physics/SteeringModel.js
//
// Steering Model: sterzo dipendente dalla velocità (pieno sterzo a bassa
// velocità, più contenuto al massimo) + sottosterzo da ala anteriore rotta +
// rumore da sospensioni danneggiate. Estratto da VehiclePhysics.js —
// refactoring architetturale (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const { getFrontWingSteerPenalty, getSuspensionNoise } = require('./DamageModel');

const TURN_SPEED_LOW  = 0.075;   // rad/tick a velocità quasi nulla
const TURN_SPEED_HIGH = 0.052;   // rad/tick alla velocità massima

// Aggiorna p.angle in base a input.steer, velocità corrente (interpolazione
// TURN_SPEED_LOW..TURN_SPEED_HIGH) e danno (sottosterzo ala + rumore
// sospensioni). Nessun effetto sotto la soglia di velocità/moto minima.
function applySteering(p, isQuali, maxSpeed) {
    const { inputs } = p;
    if (Math.abs(p.speed) > 0.01 || (p.vx * p.vx + p.vz * p.vz) > 0.0001) {
        const dir = p.speed >= 0 ? 1 : -1;
        const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
        const steerFactor = isQuali ? 1 : 1 - getFrontWingSteerPenalty(p.damageParts);
        const turnRate = (TURN_SPEED_LOW + (TURN_SPEED_HIGH - TURN_SPEED_LOW) * speedFrac) * steerFactor;
        const suspensionNoise = isQuali ? 0 : getSuspensionNoise(p.damageParts);
        const steer = inputs.steer + suspensionNoise;
        p.angle += turnRate * dir * steer;
    }
}

module.exports = { TURN_SPEED_LOW, TURN_SPEED_HIGH, applySteering };
