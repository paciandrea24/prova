// backend/sockets/games/physics/TyreSlipModel.js
//
// TyreSlipModel: modulo isolato — Fase 3.0/3A (Rif. analisi Fase 3 concordata
// in chat, non ancora un documento di spec dedicato).
//
// Separazione dei ruoli: TyreForceModel.js risponde a "quanto grip è
// DISPONIBILE in base all'usura" (statico, invariato da questa fase).
// TyreSlipModel.js risponde a "quanto di quel grip il pilota sta CHIEDENDO in
// questo tick, e di quanto lo eccede" (dinamico) — non lo sostituisce, lo
// consuma come uno dei suoi input.
//
// Punto cardine di questa revisione: l'eccesso NON è un moltiplicatore
// dell'usura (se lo fosse, sarebbe sempre 0 a gomma nuova, e non un vero
// confronto domanda/disponibilità). La domanda (`demand`) può superare 1
// indipendentemente dallo stato della gomma, in una finestra di velocità
// stretta ("zona di lancio" per la trazione, "zona alta velocità" per la
// frenata) — per questo il wheelspin/bloccaggio possono avvenire anche a
// gomma nuova in condizioni estreme, e diventano più frequenti/severi con
// l'usura (la capacità da superare si abbassa, allargando la finestra).
//
// Coerente con l'invariante isQuali già in uso in TyreForceModel: in
// qualifica tractionFactor/brakingFactor restano sempre 1 (capacità piena,
// "gomma nuova virtuale") — questo modulo NON riceve isQuali e non lo
// gestisce: il fenomeno estremo di richiesta eccessiva resta possibile anche
// in qualifica, per scelta esplicita (confermata), perché non è un effetto
// di usura ma di rapporto domanda/capacità istantanea.
//
// Stessa struttura a due tratti già usata per la curva "cliff" dell'usura in
// TyreModel.js (tratto piatto + rampa oltre soglia): coerenza stilistica con
// quanto già esiste nel progetto, non una tecnica nuova.
function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}

function clampFrac(speedFrac) {
    return Math.max(0, Math.min(1, speedFrac));
}

// Soglia/boost trazione: sotto TRACTION_LAUNCH_THRESHOLD (frazione di
// velocità massima) la domanda di trazione viene amplificata fino a
// TRACTION_DEMAND_BOOST in più — a velocità nulla e pieno gas, la domanda
// arriva a (1 + TRACTION_DEMAND_BOOST), superando anche una capacità piena
// (gomma nuova, tractionFactor=1). Oltre la soglia, nessun boost: guida
// normale, mai wheelspin qui a prescindere dall'usura.
//
// Ritarato dopo il primo playtest (Fase 3.0/3A, effetto impercettibile a
// TRACTION_LAUNCH_THRESHOLD=0.15 + TRACTION_EXCESS_PENALTY_MAX=0.15): soglia
// alzata da 0.15 a 0.30 per coprire anche uscite di curva lente, non solo la
// partenza da fermo — TRACTION_DEMAND_BOOST resta invariato (0.30), governa
// quanto è estrema la condizione limite, non la durata/ampiezza della
// finestra.
//
// Fase 3.1, misurazione debito persistente: a 0.30 la finestra reale in cui
// il debito supera la soglia percepibile (0.05) si esauriva molto prima del
// bordo della zona (a speedFrac=1.5/6.2≈0.24 il debito era già sotto soglia,
// vedi misurazione in chat) — il meccanismo del debito è corretto, ma la
// finestra di attivazione era troppo stretta per le uscite di curva normali.
// Soglia alzata da 0.30 a 0.50: solo la finestra si allarga,
// rise/decay/penalty e la formula di demand/excess restano invariati.
const TRACTION_LAUNCH_THRESHOLD = 0.50;
const TRACTION_DEMAND_BOOST = 0.30;

// Fase 3.1: il secondo playtest (soglie/penalità alzate in 3.0/3A) ha
// confermato che il rilevatore funziona (log con eccesso ~0.3 in partenza e
// frenata) ma l'effetto restava percepito come "motore debole", non come
// wheelspin — perché una riduzione istantanea (excess*penalty, ricalcolata
// da zero ogni tick) non ha memoria: appena l'eccesso scende, l'effetto
// sparisce di colpo, senza la sensazione di "la gomma sta ancora
// recuperando aderenza". Da qui il debito di slittamento sotto: un piccolo
// stato persistente per giocatore che sale in fretta quando c'è eccesso e
// scende gradualmente quando l'eccesso sparisce — dà all'evento una forma
// nel tempo (stutter + recupero) che una funzione puramente istantanea non
// può produrre, qualunque sia la sua curva.
//
// TRACTION_SLIP_RISE_RATE: quota di `excess` aggiunta al debito ad ogni
// tick — alto apposta, il debito deve salire in fretta (pochi tick) appena
// si entra in eccesso.
// TRACTION_SLIP_DECAY_RATE: quota di debito che sopravvive da un tick al
// successivo (moltiplicatore <1) — applicato SEMPRE, anche quando
// l'eccesso corrente è 0: è questo che produce il recupero graduale invece
// che istantaneo.
// TRACTION_SLIP_PENALTY_MAX: riduzione massima di accelerazione quando il
// debito è al suo massimo (1). Valore di partenza conservativo — tarabile
// in playtest.
const TRACTION_SLIP_RISE_RATE = 0.6;
const TRACTION_SLIP_DECAY_RATE = 0.85;
const TRACTION_SLIP_PENALTY_MAX = 0.35;

// Soglia/boost frenata: speculare alla trazione, ma sopra
// BRAKING_ZONE_THRESHOLD (vicino alla velocità massima) invece che sotto una
// soglia bassa — il bloccaggio è un rischio da frenata forte ad alta
// velocità, non a bassa.
//
// Ritarato dopo il primo playtest, stesso motivo della trazione: soglia
// abbassata da 0.75 a 0.55 (copre anche staccate forti dopo un rettilineo
// normale, non solo a ridosso del top speed) e penalità massima alzata da
// 0.15 a 0.40. BRAKING_DEMAND_BOOST resta invariato (0.30).
const BRAKING_ZONE_THRESHOLD = 0.55;
const BRAKING_DEMAND_BOOST = 0.30;
const BRAKING_EXCESS_PENALTY_MAX = 0.40;

// Fase 3.1: conseguenza diretta del bloccaggio sulla capacità di sterzo —
// NON è sottosterzo/sovrasterzo da richiesta laterale eccessiva (sistema a
// parte, non implementato qui): una gomma bloccata (brakingExcess alto)
// genera meno aderenza laterale a prescindere da quanto sterzo chiedi,
// quindi riduce la turnRate in SteeringModel. Riusa brakingExcess già
// esistente, nessuna formula/modello nuovo. Valore conservativo: anche al
// massimo teorico (excess=1) resta oltre metà della turnRate originale.
const STEER_LOCKUP_PENALTY_MAX = 0.35;

// 1 a velocità nulla, scende linearmente a 0 esattamente alla soglia, 0 oltre
// — continua nel valore al punto di raccordo (stesso principio della curva
// cliff di TyreModel: niente salti, il cambio di comportamento è nella
// pendenza, non nel valore).
function launchZoneFraction(speedFrac) {
    const s = clampFrac(speedFrac);
    if (s >= TRACTION_LAUNCH_THRESHOLD) return 0;
    return (TRACTION_LAUNCH_THRESHOLD - s) / TRACTION_LAUNCH_THRESHOLD;
}

// 0 sotto soglia, sale linearmente a 1 alla velocità massima.
function brakingZoneFraction(speedFrac) {
    const s = clampFrac(speedFrac);
    if (s <= BRAKING_ZONE_THRESHOLD) return 0;
    return (s - BRAKING_ZONE_THRESHOLD) / (1 - BRAKING_ZONE_THRESHOLD);
}

// Domanda di trazione: il pedale (throttle, 0..1) amplificato dalla zona di
// lancio. NON dipende dalla capacità della gomma — può superare 1 a
// prescindere dall'usura, è proprio questo che rende possibile il wheelspin
// anche a gomma nuova.
function tractionDemand(throttle, speedFrac) {
    return throttle * (1 + TRACTION_DEMAND_BOOST * launchZoneFraction(speedFrac));
}

// Eccesso di trazione: quanto la domanda supera la capacità disponibile
// (tractionFactor, da TyreForceModel — capacità, non moltiplicatore).
// 0 se la domanda è entro la capacità disponibile.
function tractionExcess(throttle, speedFrac, tractionFactor) {
    return clamp01(tractionDemand(throttle, speedFrac) - tractionFactor);
}

// Transizione pura del debito di slittamento: riceve il debito del tick
// precedente (0..1, `undefined`/assente trattato come 0 — primo tick di
// vita del giocatore) e l'eccesso del tick corrente, ritorna il nuovo
// debito. Pura e stateless (nessun riferimento a `p`): lo STATO vive sul
// player (`p._tractionSlipDebt`), gestito dal chiamante (PowertrainModel);
// questa funzione è solo la regola di transizione, testabile in isolamento
// senza costruire un player o simulare più tick di un game loop.
function updateTractionSlipDebt(prevDebt, excess) {
    const decayed = (prevDebt || 0) * TRACTION_SLIP_DECAY_RATE;
    return clamp01(decayed + excess * TRACTION_SLIP_RISE_RATE);
}

// Domanda di frenata: speculare, con brake (0..1) amplificato dalla zona ad
// alta velocità.
function brakingDemand(brake, speedFrac) {
    return brake * (1 + BRAKING_DEMAND_BOOST * brakingZoneFraction(speedFrac));
}

// Eccesso di frenata: quanto la domanda supera brakingFactor (capacità,
// da TyreForceModel).
function brakingExcess(brake, speedFrac, brakingFactor) {
    return clamp01(brakingDemand(brake, speedFrac) - brakingFactor);
}

// Percorso di confronto Fase 3.0/3A: stesso pattern già usato in Fase 2A per
// TyreForceModel — letto ad ogni chiamata (non cachato a require-time), così
// da essere attivabile/disattivabile senza riavviare il processo nei test.
// Flag DEDICATO e separato da F1_TYRE_FORCE_MODEL (rimosso in Fase 2B): i due
// sistemi sono concettualmente distinti (usura statica vs eccesso dinamico
// di richiesta) e vanno playtestati/attivati indipendentemente.
function isTyreSlipModelActive() {
    return process.env.F1_TYRE_SLIP_MODEL === '1';
}

module.exports = {
    TRACTION_LAUNCH_THRESHOLD, TRACTION_DEMAND_BOOST,
    TRACTION_SLIP_RISE_RATE, TRACTION_SLIP_DECAY_RATE, TRACTION_SLIP_PENALTY_MAX,
    BRAKING_ZONE_THRESHOLD, BRAKING_DEMAND_BOOST, BRAKING_EXCESS_PENALTY_MAX,
    STEER_LOCKUP_PENALTY_MAX,
    tractionExcess, brakingExcess, updateTractionSlipDebt,
    isTyreSlipModelActive
};
