// backend/sockets/games/physics/AerodynamicsModel.js
//
// Aerodynamics Model: aderenza (grip) da mescola/usura/danno al fondo +
// blend finale vx/vz verso la direzione del muso. Estratto da
// VehiclePhysics.js — refactoring architetturale (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const { tyreOf } = require('./TyreModel');
const { getFloorGripPenalty, getFrontWingDragPenalty, getFloorDownforcePenalty } = require('./DamageModel');
const { corneringGripFactor } = require('./TyreForceModel');

const GRIP = 0.78;

// Stesso invariante "niente NaN senza damageParts" di
// PowertrainModel.effectiveMaxSpeed (vedi lì per i dettagli): getFloorGripPenalty
// gestisce l'assenza del campo internamente.
// Fase 2B (Rif. docs/superpowers/specs/2026-07-27-f1-tyre-force-model-migration-design.md):
// TyreForceModel.corneringGripFactor è ora l'UNICA fonte del fattore usura
// per l'aderenza in curva — la vecchia WEAR_GRIP_PENALTY è stata rimossa.
//
// `maxSpeed` (Fase 2, Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// terzo parametro OPZIONALE. VehiclePhysics.js (unico chiamante interno)
// lo passa già calcolato per consultare downforceFactor. f1GameSocket.js
// (HUD gripPct) e f1GameSocket.physics.test.js chiamano ancora con 2
// argomenti: se assente, speedFrac=0 -> downforceFactor neutro (1) ->
// comportamento identico a prima, nessuna modifica necessaria a quei
// chiamanti.
//
// FIX SEGNO (playtest 2026-07-28, Rif. docs/superpowers/plans/2026-07-28-f1-aerodynamics-playtest-plan.md):
// `grip` qui NON è "quanto aderisce l'auto" in senso diretto — è il
// coefficiente di applyGripBlend sotto, dove grip PIÙ ALTO = PIÙ
// ancoraggio alla vecchia direzione = convergenza PIÙ LENTA verso il
// muso = PIÙ scivolata percepita (stesso tranello già documentato per
// CorneringGripModel, qui ricaduto anche nella combinazione base). Più
// downforce deve quindi abbassare grip (risposta più immediata), non
// alzarlo: si DIVIDE per downforceFactor (che cresce sopra 1 con la
// velocità), non si moltiplica. Verificato con simulazione a freddo
// (sterzo pieno sostenuto ad alta velocità): con la moltiplicazione la
// divergenza muso/velocità reale raddoppiava rispetto al flag spento
// (l'opposto dell'intento); con la divisione si riduce, come atteso.
function effectiveGrip(p, isQuali, maxSpeed) {
    const wearFactor  = corneringGripFactor(p.tyreWear, isQuali);
    const floorFactor = 1 - getFloorGripPenalty(p.damageParts);
    let grip = GRIP * tyreOf(p, isQuali).gripMult * wearFactor * floorFactor;
    if (isAeroDownforceModelActive()) {
        const speedFrac = maxSpeed ? Math.min(1, Math.abs(p.speed || 0) / maxSpeed) : 0;
        grip /= downforceFactor(speedFrac, isQuali, p.damageParts);
    }
    return grip;
}

// Blend tra la velocità vettoriale corrente e la direzione del muso
// (sin/cos(angle)*speed), pesato da grip: più aderenza = più velocemente
// vx/vz convergono verso dove punta l'auto.
function applyGripBlend(p, grip) {
    const fx = Math.sin(p.angle) * p.speed;
    const fz = Math.cos(p.angle) * p.speed;
    p.vx = p.vx * grip + fx * (1 - grip);
    p.vz = p.vz * grip + fz * (1 - grip);
}

// Fase 2 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// prima formula reale del contributo downforce alla capacità laterale —
// valore di partenza conservativo, tarabile in playtest. Cresce con
// speedFrac^2 (stessa ispirazione fisica di dragFactor, direzione
// opposta: più velocità = più deportanza = più capacità disponibile, non
// meno). NON dipende da isQuali, stesso motivo di dragFactor: fenomeno
// fisico sempre presente. Da quando anche il danno vale in qualifica
// (2026-08-23), `isQuali` qui non è più letto affatto: resta nella firma
// per non toccare i tre chiamanti, e va tolto nel prossimo passo.
// Consultato da `effectiveGrip` (sopra) e da
// `CorneringGripModel.lateralExcess` in modo indipendente: i due consumer
// non si moltiplicano fra loro né uno legge l'output dell'altro (vedi
// spec, nota sul doppio conteggio).
const DOWNFORCE_CAPACITY_BONUS_MAX = 0.15;
const DOWNFORCE_EXPONENT = 2;

function downforceFactor(speedFrac, isQuali, damageParts) {
    const frac = Math.max(0, Math.min(1, speedFrac));
    let factor = 1 + Math.pow(frac, DOWNFORCE_EXPONENT) * DOWNFORCE_CAPACITY_BONUS_MAX;
    // Fase 3: danno al fondo -> meno downforce. NON è più esente in
    // qualifica (2026-08-23): il danno vale sempre, perché in stagione al
    // giro secco si arriva con la macchina che si ha. Rif.
    // docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md.
    if (isAeroDamageModelActive()) {
        factor *= 1 - getFloorDownforcePenalty(damageParts);
    }
    return factor;
}

// Promosso a default ON dopo playtest positivo (Rif.
// docs/superpowers/plans/2026-07-28-f1-aerodynamics-playtest-plan.md).
// Rollback possibile impostando esplicitamente F1_AERO_DOWNFORCE_MODEL=0
// — qualunque altro valore (incluso non impostato) mantiene il modello
// attivo. Flag dedicato e separato da F1_AERO_DRAG_MODEL.
function isAeroDownforceModelActive() {
    return process.env.F1_AERO_DOWNFORCE_MODEL !== '0';
}

// Fase 4 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// prima formula reale della scia — stessa formula storica già in uso in
// f1GameSocket.js (SLIPSTREAM_RANGE_M/SLIPSTREAM_MAX_BOOST), qui
// riprodotta come funzione PURA (nessun isQuali: l'esclusione qualifica è
// contesto di gara, resta esclusivamente in f1GameSocket.js). Le due
// costanti sono duplicate deliberatamente — AerodynamicsModel.js è foglia
// in physics/, non può importare da f1GameSocket.js (invertirebbe la
// direzione delle dipendenze) — vanno mantenute in sync con le omonime
// in f1GameSocket.js per la durata del percorso di confronto.
const SLIPSTREAM_RANGE_M = 25;
const SLIPSTREAM_MAX_BOOST = 0.08;

function slipstreamFactor(gapM) {
    if (gapM >= SLIPSTREAM_RANGE_M) return 1;
    const closeness = 1 - gapM / SLIPSTREAM_RANGE_M;
    return 1 + closeness * SLIPSTREAM_MAX_BOOST;
}

// Promosso a default ON dopo playtest positivo (Rif.
// docs/superpowers/plans/2026-07-28-f1-aerodynamics-playtest-plan.md).
// Rollback possibile impostando esplicitamente F1_AERO_SLIPSTREAM_MODEL=0
// — qualunque altro valore (incluso non impostato) mantiene il modello
// attivo. Flag dedicato e separato dagli altri.
function isAeroSlipstreamModelActive() {
    return process.env.F1_AERO_SLIPSTREAM_MODEL !== '0';
}

// Fase 1 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// prima formula reale di drag longitudinale — valore di partenza
// conservativo, tarabile in playtest. Cresce con speedFrac^2 (ispirazione
// fisica: la resistenza aerodinamica cresce col quadrato della velocità,
// non un vincolo rigoroso). NON dipende da isQuali: a differenza delle
// penalità da usura/danno, il drag è un fenomeno fisico sempre presente,
// non un degrado che la qualifica ignora — isQuali resta nella firma solo
// in vista della Fase 3 (danno aero), che quella sì seguirà la stessa
// esenzione qualifica di ogni altro danno.
const DRAG_TOP_SPEED_PENALTY_MAX = 0.05;
const DRAG_EXPONENT = 2;

function dragFactor(speedFrac, isQuali, damageParts) {
    const frac = Math.max(0, Math.min(1, speedFrac));
    let factor = 1 - Math.pow(frac, DRAG_EXPONENT) * DRAG_TOP_SPEED_PENALTY_MAX;
    // Fase 3: danno ala anteriore -> più drag. NON è più esente in
    // qualifica (2026-08-23), vedi downforceFactor sopra.
    if (isAeroDamageModelActive()) {
        factor *= 1 - getFrontWingDragPenalty(damageParts);
    }
    return factor;
}

// Promosso a default ON dopo playtest positivo (Rif.
// docs/superpowers/plans/2026-07-28-f1-aerodynamics-playtest-plan.md).
// Rollback possibile impostando esplicitamente F1_AERO_DRAG_MODEL=0 —
// qualunque altro valore (incluso non impostato) mantiene il modello
// attivo. Flag dedicato e separato dagli altri.
function isAeroDragModelActive() {
    return process.env.F1_AERO_DRAG_MODEL !== '0';
}

// Promosso a default ON dopo playtest positivo (Rif.
// docs/superpowers/plans/2026-07-28-f1-aerodynamics-playtest-plan.md).
// Rollback possibile impostando esplicitamente F1_AERO_DAMAGE_MODEL=0 —
// qualunque altro valore (incluso non impostato) mantiene il modello
// attivo. Flag dedicato e separato da F1_AERO_DRAG_MODEL/
// F1_AERO_DOWNFORCE_MODEL. Ha effetto solo se ANCHE il flag della fase
// corrispondente (drag/downforce) è attivo: conseguenza naturale della
// fasatura, dragFactor/downforceFactor non vengono consultati altrimenti.
function isAeroDamageModelActive() {
    return process.env.F1_AERO_DAMAGE_MODEL !== '0';
}

module.exports = {
    GRIP, effectiveGrip, applyGripBlend,
    downforceFactor, dragFactor, slipstreamFactor,
    isAeroDragModelActive, isAeroDownforceModelActive, isAeroDamageModelActive, isAeroSlipstreamModelActive,
    DRAG_TOP_SPEED_PENALTY_MAX, DRAG_EXPONENT,
    DOWNFORCE_CAPACITY_BONUS_MAX, DOWNFORCE_EXPONENT
};
