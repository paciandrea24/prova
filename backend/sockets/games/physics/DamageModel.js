// backend/sockets/games/physics/DamageModel.js
//
// Damage Model: soglie/effetti del danno (rumore sterzo) + danno e penalità
// da collisione auto-auto/auto-barriera. Estratto da f1GameSocket.js (Rif.
// SDD Capitolo 10.6) senza modificarne la logica — stesse formule, stessi
// valori, stesso comportamento. Il danno si accumula SOLO in gara: i
// chiamanti (resolveCollisions/applyBridgeBarrier in CollisionResolver.js)
// sono già ristretti alla gara vera, vedi
// docs/superpowers/specs/2026-07-25-f1-danno-collisioni-design.md.

const DAMAGE_GRIP_THRESHOLD    = 33;    // % danno oltre cui inizia la perdita di aderenza
const DAMAGE_STEER_THRESHOLD   = 66;    // % danno oltre cui inizia il rumore sullo sterzo
const DAMAGE_SPEED_PENALTY_MAX = 0.30;  // fino a -30% velocità massima a danno 100%
const DAMAGE_GRIP_PENALTY_MAX  = 0.35;  // fino a -35% aderenza, attivo solo oltre DAMAGE_GRIP_THRESHOLD
const DAMAGE_STEER_NOISE_MAX   = 0.15;  // rumore massimo sterzo (frazione, sommata a inputs.steer), oltre DAMAGE_STEER_THRESHOLD

// Rumore sullo sterzo da danno grave (>DAMAGE_STEER_THRESHOLD), solo in
// gara. rng iniettabile per test deterministici (stesso pattern di
// randRange in f1Bot.js). Fallback (p.damage || 0): i player creati dagli
// strumenti offline (f1LapSimulator.js, f1RaceLineOptimizer.js) non hanno il
// campo damage.
function applyDamageSteerNoise(p, isQuali, rng = Math.random) {
    const damage = p.damage || 0;
    if (isQuali || damage <= DAMAGE_STEER_THRESHOLD) return 0;
    const frac = (damage - DAMAGE_STEER_THRESHOLD) / (100 - DAMAGE_STEER_THRESHOLD);
    return (rng() * 2 - 1) * frac * DAMAGE_STEER_NOISE_MAX;
}

// ====================================================
// DANNO DA COLLISIONE — modello unico 0-100%, come tyreWear.
// ====================================================
const MIN_COLLISION_SEVERITY         = 1.0;   // sotto questa velocità di avvicinamento, nessun danno/penalità
const DAMAGE_PER_SEVERITY            = 6;     // % danno per unità di severità oltre soglia
const DAMAGE_CAP_PER_HIT             = 25;    // % danno massimo da un singolo urto
const VICTIM_DAMAGE_FRACTION         = 0.18;  // quota di danno che prende la vittima di un tamponamento
const COLLISION_PENALTY_PER_SEVERITY = 400;   // ms di penalità per unità di severità oltre soglia
const COLLISION_PENALTY_CAP_MS       = 5000;  // penalità massima da un singolo urto

function collisionDamageAmount(severity) {
    return Math.min(DAMAGE_CAP_PER_HIT, Math.abs(severity) * DAMAGE_PER_SEVERITY);
}

function applyCollisionPenalty(culprit, severity) {
    // Arrotondato a ms interi: severity è un float di fisica, e senza questo
    // collisionPenaltyMs (sommato a p.time in checkLap) diventa un numero
    // non intero — il tempo finale mostrato a schermo finiva con una sfilza
    // di decimali (es. "3:16.10.848209412244614", il resto del float dentro
    // ms % 1000 nel client).
    const ms = Math.round(Math.min(COLLISION_PENALTY_CAP_MS, Math.abs(severity) * COLLISION_PENALTY_PER_SEVERITY));
    culprit.collisionPenaltyMs += ms;
    culprit.pendingCollisionPenaltyEvents.push(ms);   // drenata da tickGame per l'emit f1CollisionPenalty
}

// avn/bvn: componenti di velocità di a/b lungo la normale d'urto (orientata
// da a verso b, vedi resolveCollisions in CollisionResolver.js) — avn>0: a si
// avvicina a b; -bvn>0: b si avvicina ad a. Chi si avvicina di più è il
// colpevole. closingRate è la violenza totale dell'urto (somma dei due
// avvicinamenti), già filtrata da MIN_COLLISION_SEVERITY dal chiamante.
function applyCarCollisionDamage(a, b, avn, bvn, closingRate) {
    const closingA = avn, closingB = -bvn;
    const faultIsA = closingA >= closingB;
    const culprit = faultIsA ? a : b;
    const victim  = faultIsA ? b : a;

    const dmg = collisionDamageAmount(closingRate);
    culprit.damage = Math.min(100, culprit.damage + dmg);
    victim.damage  = Math.min(100, victim.damage + dmg * VICTIM_DAMAGE_FRACTION);

    applyCollisionPenalty(culprit, closingRate);
}

function applyBarrierDamage(p, vn) {
    p.damage = Math.min(100, p.damage + collisionDamageAmount(vn));
    // nessuna penalità: contro il muro ci si fa male da soli.
}

module.exports = {
    DAMAGE_GRIP_THRESHOLD, DAMAGE_STEER_THRESHOLD, DAMAGE_SPEED_PENALTY_MAX, DAMAGE_GRIP_PENALTY_MAX, DAMAGE_STEER_NOISE_MAX,
    applyDamageSteerNoise,
    MIN_COLLISION_SEVERITY, DAMAGE_PER_SEVERITY, DAMAGE_CAP_PER_HIT, VICTIM_DAMAGE_FRACTION,
    COLLISION_PENALTY_PER_SEVERITY, COLLISION_PENALTY_CAP_MS,
    collisionDamageAmount, applyCollisionPenalty, applyCarCollisionDamage, applyBarrierDamage
};
