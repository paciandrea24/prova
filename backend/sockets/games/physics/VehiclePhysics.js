// backend/sockets/games/physics/VehiclePhysics.js
//
// Vehicle Controller / Physics Model: velocità (accelerazione/freno/sterzo/
// grip), integrazione della posizione e drag fuoripista. Estratto da
// f1GameSocket.js (Rif. SDD Capitolo 10.6) senza modificarne la logica —
// stesse formule, stessi valori, stesso comportamento.
const TrackGeometry = require('../../../../frontend/shared/trackGeometry.js');
const { tyreOf, WEAR_SPEED_PENALTY, WEAR_GRIP_PENALTY } = require('./TyreModel');
const {
    DAMAGE_SPEED_PENALTY_MAX, DAMAGE_GRIP_PENALTY_MAX, DAMAGE_GRIP_THRESHOLD,
    applyDamageSteerNoise
} = require('./DamageModel');

// Velocità realistica F1: fattore di scala R=1.55 (+55%) applicato a
// MAX_SPEED/ACCEL/FRICTION rispetto ai valori storici (4.0/0.12/0.050).
// Km/h a schermo = speed * 55 (frontend/f1.js): 6.2 → 341 km/h base Medium,
// 358 Soft, 324 Hard. Vedi docs/superpowers/specs/2026-07-21-f1-velocita-frenata-mescole-design.md.
const MAX_SPEED    = 6.2;
const ACCEL        = 0.186;
// FRICTION scalato ×R² (non ×R) come la frenata sotto: è un decremento
// costante per tick, quindi lo spazio di "coast-down" va con v²/decel — a
// parità di R, senza lo ×R² il rilascio del gas sembrerebbe non rallentare
// quasi per niente rispetto a oggi.
const FRICTION     = 0.120;
// Velocità di sterzata dipendente dalla velocità dell'auto (non più un
// unico valore fisso): pieno sterzo a bassa velocità per manovre strette
// (tornanti, uscita curva), più contenuto al massimo — come un'auto vera.
// Richiesto esplicitamente dall'utente, che trovava lo sterzo "rigido" sia
// in generale (valore assoluto basso) sia perché identico a ogni velocità
// (nessuna differenza basso/alto regime). Vedi interpolazione in
// updateVelocity in base a |p.speed|/maxSpeed.
const TURN_SPEED_LOW  = 0.075;   // rad/tick a velocità quasi nulla (era 0.048 fisso, +56%)
const TURN_SPEED_HIGH = 0.052;   // rad/tick alla velocità massima (era 0.048 fisso, +8%)
const GRIP         = 0.78;
const BRAKE_MULT   = 2.17;   // moltiplicatore di ACCEL in frenata (era 1.4 a MAX_SPEED=4.0)

// p.damage va letto come (p.damage || 0): gli strumenti offline
// (f1LapSimulator.js, f1RaceLineOptimizer.js) costruiscono i loro player di
// simulazione senza campo damage — con una lettura diretta p.damage/100
// darebbe NaN e romperebbe la simulazione. Per i giocatori reali damage è
// sempre un numero (mai undefined, vedi init in joinF1Game/createBots).
function effectiveMaxSpeed(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - (p.tyreWear / 100) * WEAR_SPEED_PENALTY;
    const damageFactor = isQuali ? 1 : 1 - ((p.damage || 0) / 100) * DAMAGE_SPEED_PENALTY_MAX;
    return MAX_SPEED * tyreOf(p, isQuali).speedMult * wearFactor * damageFactor;
}

function effectiveGrip(p, isQuali) {
    const wearFactor = isQuali ? 1 : 1 - (p.tyreWear / 100) * WEAR_GRIP_PENALTY;
    const gripDamageFrac = isQuali ? 0
        : Math.max(0, (p.damage || 0) - DAMAGE_GRIP_THRESHOLD) / (100 - DAMAGE_GRIP_THRESHOLD);
    const damageFactor = 1 - gripDamageFrac * DAMAGE_GRIP_PENALTY_MAX;
    return GRIP * tyreOf(p, isQuali).gripMult * wearFactor * damageFactor;
}

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

    if (inputs.throttle > 0) p.speed = Math.min(p.speed + ACCEL * inputs.throttle, maxSpeed);
    else if (inputs.brake > 0) {
        // Frenata/retromarcia. La decelerazione in frenata è un decremento
        // costante per tick, quindi lo spazio d'arresto va con v²/decel: per
        // tenerlo vicino a quello di prima dell'aumento di velocità (R=1.55),
        // BRAKE_MULT scala di R² rispetto al vecchio 1.4 (non solo ×R) — vedi
        // docs/superpowers/specs/2026-07-21-f1-velocita-frenata-mescole-design.md.
        p.speed = Math.max(p.speed - ACCEL * BRAKE_MULT * inputs.brake, -maxSpeed / 2);
        p.vx *= 0.94;
        p.vz *= 0.94;
    } else {
        if (p.speed > 0) p.speed = Math.max(p.speed - FRICTION, 0);
        if (p.speed < 0) p.speed = Math.min(p.speed + FRICTION, 0);
    }
    // Il tetto di velocità può essersi abbassato (usura aumentata da fermo non
    // succede, ma cambiando mescola in futuro pit stop sì): non lasciare mai
    // p.speed sopra il nuovo massimo.
    if (p.speed > maxSpeed) p.speed = maxSpeed;

    if (Math.abs(p.speed) > 0.01 || (p.vx * p.vx + p.vz * p.vz) > 0.0001) {
        const dir = p.speed >= 0 ? 1 : -1;
        const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
        const turnRate  = TURN_SPEED_LOW + (TURN_SPEED_HIGH - TURN_SPEED_LOW) * speedFrac;
        const steer = inputs.steer + applyDamageSteerNoise(p, isQuali);
        p.angle += turnRate * dir * steer;
    }

    const fx = Math.sin(p.angle) * p.speed;
    const fz = Math.cos(p.angle) * p.speed;
    p.vx = p.vx * grip + fx * (1 - grip);
    p.vz = p.vz * grip + fz * (1 - grip);
}

function integratePosition(p, dt) {
    p.x += p.vx * dt;
    p.z += p.vz * dt;
}

// Fuoripista: distanza dal punto più vicino della pista caricata.
function nearestTrackDist(track, x, z) {
    return TrackGeometry.nearestPoint(track.points, x, z).dist;
}

// Ghiaia: rallentamento fuori pista. Ritorna se il giocatore è fuori pista in
// questo tick, riusato da applyTyreWear per il piccolo extra di usura.
// (Chi è nella corsia box vera e propria è guidato dall'autopilota, escluso
// da questa funzione — vedi il filtro "racing" in tickGame — quindi non
// serve più un'esenzione qui: la zona di trigger d'ingresso è comunque
// abbastanza vicina al bordo pista normale da non scattare mai.)
function applyOffTrackDrag(p, track) {
    const dist = nearestTrackDist(track, p.x, p.z);
    const offTrack = dist > track.roadHalf + 2;
    if (offTrack) {
        const k = Math.min(1, (dist - track.roadHalf - 2) / 8);  // 0..1 in funzione della profondità
        const drag = 0.04 + k * 0.08;
        p.speed *= (1 - drag);
        p.vx   *= (1 - drag);
        p.vz   *= (1 - drag);
    }
    return offTrack;
}

module.exports = {
    MAX_SPEED, ACCEL, FRICTION, TURN_SPEED_LOW, TURN_SPEED_HIGH, GRIP, BRAKE_MULT,
    effectiveMaxSpeed, effectiveGrip, updateVelocity, integratePosition, applyOffTrackDrag
};
