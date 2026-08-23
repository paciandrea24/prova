// backend/sockets/games/physics/DamageModel.js
//
// Damage Model: soglie/effetti del danno generico (rumore sterzo, retro-
// compat) + danno LOCALIZZATO per componente (ala anteriore, fondo, motore,
// sospensioni — Rif. SDD Capitolo 3.8) + danno e penalità da collisione
// auto-auto/auto-barriera. Il danno si accumula SOLO in gara: i chiamanti
// (resolveCollisions/applyBridgeBarrier in CollisionResolver.js) sono già
// ristretti alla gara vera, vedi
// docs/superpowers/specs/2026-07-25-f1-danno-collisioni-design.md.

// ====================================================
// DANNO GENERICO (storico) — rumore sterzo scalare, mantenuto per
// retrocompatibilità (nessun consumer interno lo chiama più: updateVelocity
// in VehiclePhysics.js ora usa getSuspensionNoise, che si attiva in modo
// progressivo sul danno alle sospensioni invece che con una soglia sul
// danno generico). DAMAGE_GRIP_THRESHOLD/DAMAGE_STEER_THRESHOLD non sono
// più usate da nessuna formula attiva, mantenute solo come costanti
// storiche.
// ====================================================
const DAMAGE_GRIP_THRESHOLD    = 33;    // % danno oltre cui iniziava la perdita di aderenza (storico, non più usata)
const DAMAGE_STEER_THRESHOLD   = 66;    // % danno oltre cui iniziava il rumore sullo sterzo (storico, non più usata)
const DAMAGE_SPEED_PENALTY_MAX = 0.30;  // fino a -30% velocità massima a motore distrutto — vedi getEnginePowerPenalty
const DAMAGE_GRIP_PENALTY_MAX  = 0.35;  // fino a -35% aderenza a fondo distrutto — vedi getFloorGripPenalty
const DAMAGE_STEER_NOISE_MAX   = 0.15;  // rumore massimo sterzo a sospensioni distrutte — vedi getSuspensionNoise

// Rumore sullo sterzo da danno generico grave (storico, sostituita da
// getSuspensionNoise sotto): mantenuta ed esportata per retrocompatibilità
// di eventuali chiamanti esterni, ma non più invocata da updateVelocity.
function applyDamageSteerNoise(p, isQuali, rng = Math.random) {
    const damage = p.damage || 0;
    if (isQuali || damage <= DAMAGE_STEER_THRESHOLD) return 0;
    const frac = (damage - DAMAGE_STEER_THRESHOLD) / (100 - DAMAGE_STEER_THRESHOLD);
    return (rng() * 2 - 1) * frac * DAMAGE_STEER_NOISE_MAX;
}

// ====================================================
// DANNO LOCALIZZATO PER COMPONENTE (Rif. SDD Capitolo 3.8)
// 4 componenti indipendenti (0-100% ciascuno), effetti fisici differenziati:
// - frontWing (ala anteriore): sottosterzo — vedi getFrontWingSteerPenalty
// - floor (fondo vettura): perdita di aderenza — vedi getFloorGripPenalty
// - engine (motore): perdita di accelerazione/velocità — vedi getEnginePowerPenalty
// - suspension (sospensioni): instabilità/rumore sterzo — vedi getSuspensionNoise
// NESSUNA di queste penalità è esente in qualifica (dal 2026-08-23): chi
// decide se c'è danno è chi riempie damageParts, non la formula. Rif.
// docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md.
// p.damage (scalare 0-100, storico) resta SEMPRE disponibile per HUD/tool
// offline: è DERIVATO come il massimo dei 4 componenti (non più un contatore
// indipendente) — un singolo componente gravemente danneggiato deve
// riflettersi subito sul valore generale, senza essere annacquato da una
// media con componenti sani.
// ====================================================
const FRONT_WING_STEER_PENALTY_MAX = 0.40; // fino a -40% di turnRate (sottosterzo) ad ala distrutta

// Oggetto fresco ad ogni chiamata: mai condividere un singolo oggetto
// letterale fra più giocatori (assegnarlo per riferimento causerebbe
// mutazioni incrociate — un urto di un'auto "danneggerebbe" tutte).
function createDamageParts() {
    return { frontWing: 0, floor: 0, engine: 0, suspension: 0 };
}

// Tamponare un'altra auto (colpevole, urto col MUSO): danno soprattutto
// all'ala anteriore, un po' alle sospensioni per il colpo secco.
const REAR_END_CULPRIT_SPLIT = { frontWing: 0.8, suspension: 0.2 };
// Essere tamponati da dietro (vittima): il colpo arriva sul retro,
// dove in F1 vera stanno motore e fondo posteriore.
const REAR_END_VICTIM_SPLIT  = { engine: 0.6, floor: 0.4 };
// Impatto contro barriera/muro: danno distribuito su ala, sospensioni e fondo.
const BARRIER_IMPACT_SPLIT   = { frontWing: 0.4, suspension: 0.3, floor: 0.3 };

// Applica `amount` di danno a `p` distribuendolo secondo `split` (frazioni
// che sommano a 1, una per componente) e RIDERIVA p.damage come massimo dei
// 4 componenti — unico punto che scrive p.damage dopo un urto, per non
// lasciare che scalare e componenti divergano.
function addComponentDamage(p, amount, split) {
    if (!p.damageParts) p.damageParts = createDamageParts();
    for (const part in split) {
        p.damageParts[part] = Math.min(100, p.damageParts[part] + amount * split[part]);
    }
    p.damage = Math.max(
        p.damageParts.frontWing, p.damageParts.floor,
        p.damageParts.engine, p.damageParts.suspension
    );
}

// Penalità pure (0..MAX), funzioni del solo stato dei componenti — l'eventuale
// esclusione in qualifica (dove il danno non ha mai effetto) resta a carico
// del chiamante in VehiclePhysics.js, come già per usura/mescola. Fallback
// `parts?.x || 0` per i player creati dagli strumenti offline
// (f1LapSimulator.js, f1RaceLineOptimizer.js), che non hanno damageParts.
function getEnginePowerPenalty(parts) {
    return ((parts?.engine || 0) / 100) * DAMAGE_SPEED_PENALTY_MAX;
}

function getFloorGripPenalty(parts) {
    return ((parts?.floor || 0) / 100) * DAMAGE_GRIP_PENALTY_MAX;
}

function getFrontWingSteerPenalty(parts) {
    return ((parts?.frontWing || 0) / 100) * FRONT_WING_STEER_PENALTY_MAX;
}

// Fase 3 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// penalità aero da danno — RIUSANO frontWing/floor esistenti, nessun
// quinto componente. Stesso pattern lineare 0-100% dei getter sopra.
// Consultate da AerodynamicsModel.js (dragFactor/downforceFactor), MAI da
// SteeringModel.js (che continua a usare solo getFrontWingSteerPenalty,
// fenomeno meccanico separato).
const FRONT_WING_DRAG_PENALTY_MAX = 0.10; // fino a +10% di drag (ala anteriore rotta disturba il flusso d'aria)
const FLOOR_DOWNFORCE_PENALTY_MAX = 0.10; // fino a -10% di deportanza (fondo rotto perde carico aerodinamico)

function getFrontWingDragPenalty(parts) {
    return ((parts?.frontWing || 0) / 100) * FRONT_WING_DRAG_PENALTY_MAX;
}

function getFloorDownforcePenalty(parts) {
    return ((parts?.floor || 0) / 100) * FLOOR_DOWNFORCE_PENALTY_MAX;
}

// Rumore sullo sterzo: a differenza della vecchia applyDamageSteerNoise (che
// scattava solo oltre una soglia sul danno generico), qui è progressivo fin
// da subito sul danno alle sospensioni — niente più soglia netta.
function getSuspensionNoise(parts, rng = Math.random) {
    const frac = (parts?.suspension || 0) / 100;
    return (rng() * 2 - 1) * frac * DAMAGE_STEER_NOISE_MAX;
}

// ====================================================
// DANNO DA COLLISIONE — applica amount via addComponentDamage sopra
// (sostituisce il vecchio accumulo diretto su p.damage).
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
    const ms = Math.round(Math.min(COLLISION_PENALTY_CAP_MS, Math.abs(severity) * COLLISION_PENALTY_PER_SEVERITY));
    culprit.collisionPenaltyMs += ms;
    culprit.pendingCollisionPenaltyEvents.push(ms);
}

// avn/bvn: componenti di velocità di a/b lungo la normale d'urto (orientata
// da a verso b, vedi resolveCollisions in CollisionResolver.js) — avn>0: a si
// avvicina a b; -bvn>0: b si avvicina ad a. Chi si avvicina di più è il
// colpevole (tampona col muso: REAR_END_CULPRIT_SPLIT); l'altro è la vittima
// (colpita da dietro: REAR_END_VICTIM_SPLIT).
function applyCarCollisionDamage(a, b, avn, bvn, closingRate) {
    const closingA = avn, closingB = -bvn;
    const faultIsA = closingA >= closingB;
    const culprit = faultIsA ? a : b;
    const victim  = faultIsA ? b : a;

    const dmg = collisionDamageAmount(closingRate);
    addComponentDamage(culprit, dmg, REAR_END_CULPRIT_SPLIT);
    addComponentDamage(victim, dmg * VICTIM_DAMAGE_FRACTION, REAR_END_VICTIM_SPLIT);

    applyCollisionPenalty(culprit, closingRate);
}

function applyBarrierDamage(p, vn) {
    const dmg = collisionDamageAmount(vn);
    addComponentDamage(p, dmg, BARRIER_IMPACT_SPLIT);
    // nessuna penalità: contro il muro ci si fa male da soli.
}

module.exports = {
    DAMAGE_GRIP_THRESHOLD, DAMAGE_STEER_THRESHOLD, DAMAGE_SPEED_PENALTY_MAX, DAMAGE_GRIP_PENALTY_MAX, DAMAGE_STEER_NOISE_MAX,
    applyDamageSteerNoise,
    FRONT_WING_STEER_PENALTY_MAX,
    FRONT_WING_DRAG_PENALTY_MAX, FLOOR_DOWNFORCE_PENALTY_MAX,
    createDamageParts, addComponentDamage,
    getEnginePowerPenalty, getFloorGripPenalty, getFrontWingSteerPenalty, getSuspensionNoise,
    getFrontWingDragPenalty, getFloorDownforcePenalty,
    MIN_COLLISION_SEVERITY, DAMAGE_PER_SEVERITY, DAMAGE_CAP_PER_HIT, VICTIM_DAMAGE_FRACTION,
    COLLISION_PENALTY_PER_SEVERITY, COLLISION_PENALTY_CAP_MS,
    collisionDamageAmount, applyCollisionPenalty, applyCarCollisionDamage, applyBarrierDamage
};
