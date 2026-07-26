// backend/sockets/games/physics/TyreModel.js
//
// Tyre Model: mescole (Soft/Medium/Hard), usura, suggerimento strategia.
// Estratto da f1GameSocket.js (Rif. SDD Capitolo 10.6) senza modificarne la
// logica — stesse formule, stessi valori, stesso comportamento.

// ====================================================
// MESCOLE E USURA GOMME
// Soft/Medium/Hard differiscono sia in prestazioni (velocità massima e
// aderenza) sia in velocità di usura — come nella F1 vera: la Soft è più
// veloce ma dura meno, la Hard il contrario. L'usura cresce SOLO con la
// distanza percorsa (fermo = zero usura, richiesta esplicita), con un piccolo
// extra fuoripista; a gomme esaurite si perde fino a WEAR_SPEED_PENALTY di
// velocità massima e WEAR_GRIP_PENALTY di aderenza (più derapate).
// ====================================================
const TYRE_COMPOUNDS = {
    soft:   { label: 'Soft',   color: '#e74c3c', speedMult: 1.05, gripMult: 1.00, wearRate: 1.5 },
    medium: { label: 'Medium', color: '#f1c40f', speedMult: 1.00, gripMult: 0.95, wearRate: 1.0 },
    hard:   { label: 'Hard',   color: '#ecf0f1', speedMult: 0.95, gripMult: 0.90, wearRate: 0.6 },
};
const DEFAULT_COMPOUND = 'medium';

const WEAR_LAPS_AT_MEDIUM = 5;   // quanti giri dura una Medium (wearRate=1) prima del 100% di usura
const WEAR_OFFTRACK_EXTRA = 0.02; // piccolo extra per tick fuori pista (oltre a quello da distanza)
const WEAR_SPEED_PENALTY  = 0.25; // fino a -25% velocità massima a gomme esaurite
const WEAR_GRIP_PENALTY   = 0.35; // fino a -35% aderenza a gomme esaurite (più derapate)
const WEAR_BRAKE_PENALTY  = 0.30; // fino a -30% di efficienza frenante a gomma esaurita
const WEAR_ACCEL_PENALTY  = 0.20; // fino a -20% di trazione in accelerazione a gomma esaurita

// In qualifica TUTTI usano lo spec della Soft (gomma da qualifica, come in F1
// vera), gomme fresche, a prescindere dalla mescola scelta per la gara — la
// scelta conta solo una volta iniziata la gara vera.
function tyreOf(p, isQuali) {
    if (isQuali) return TYRE_COMPOUNDS.soft;
    return TYRE_COMPOUNDS[p.compound] || TYRE_COMPOUNDS[DEFAULT_COMPOUND];
}

// ====================================================
// CURVA DI DEGRADO "CLIFF" — sostituisce il vecchio calcolo lineare
// (tyreWear/100) con una curva a due tratti, come il comportamento reale
// delle gomme F1 moderne: prestazioni quasi piene fino a una soglia, poi un
// calo marcato e accelerato oltre quella soglia (il "cliff"). Il fattore
// risultante (0..1) va moltiplicato per le penalità (WEAR_SPEED_PENALTY,
// WEAR_GRIP_PENALTY, WEAR_ACCEL_PENALTY, WEAR_BRAKE_PENALTY) esattamente
// come faceva prima (tyreWear/100) — stesso ruolo, curva diversa.
// ====================================================
const WEAR_CLIFF_THRESHOLD = 0.60;       // frazione di usura (0-1) oltre cui inizia il "cliff"
const WEAR_CLIFF_GENTLE_FRACTION = 0.25; // quota del fattore massimo (1.0) raggiunta ESATTAMENTE alla soglia

// Tratto dolce (w <= soglia): lineare da 0 a WEAR_CLIFF_GENTLE_FRACTION.
// Tratto cliff (w > soglia): quadratico da WEAR_CLIFF_GENTLE_FRACTION a 1.0 —
// continuo nel valore al punto di raccordo (stesso fattore su entrambi i
// lati della soglia), non nella derivata: il cambio di pendenza è voluto,
// è il "cliff" — una perdita di prestazione percepibile, non
// un'estrapolazione morbida del tratto precedente.
function getWearPenaltyFactor(tyreWear) {
    const w = Math.max(0, Math.min(100, tyreWear)) / 100;
    if (w <= WEAR_CLIFF_THRESHOLD) {
        return (w / WEAR_CLIFF_THRESHOLD) * WEAR_CLIFF_GENTLE_FRACTION;
    }
    const t = (w - WEAR_CLIFF_THRESHOLD) / (1 - WEAR_CLIFF_THRESHOLD);
    return WEAR_CLIFF_GENTLE_FRACTION + (1 - WEAR_CLIFF_GENTLE_FRACTION) * t * t;
}

// Usura gomme: SOLO dalla distanza percorsa nel tick (fermo = zero usura,
// nessun caso speciale necessario) + un piccolo extra fisso se fuori pista.
function applyTyreWear(p, offTrack, track) {
    const dist = Math.hypot(p.vx, p.vz);   // distanza percorsa in questo tick
    const wearPerUnitDist = 100 / (WEAR_LAPS_AT_MEDIUM * track.lapLength);
    p.tyreWear = Math.min(100, p.tyreWear + dist * wearPerUnitDist * tyreOf(p).wearRate);
    if (offTrack) p.tyreWear = Math.min(100, p.tyreWear + WEAR_OFFTRACK_EXTRA);
}

// Suggerimento di strategia (solo indicativo, mostrato in selezione mescola):
// parte da una mescola durevole per il primo stint, poi via via più
// prestazionali per i restanti — quante ne servono dipende dai giri totali.
function suggestStrategy(totalLaps) {
    const life = {
        hard:   Math.max(1, Math.round(WEAR_LAPS_AT_MEDIUM / TYRE_COMPOUNDS.hard.wearRate)),
        medium: WEAR_LAPS_AT_MEDIUM,
        soft:   Math.max(1, Math.round(WEAR_LAPS_AT_MEDIUM / TYRE_COMPOUNDS.soft.wearRate)),
    };
    const order  = ['hard', 'medium', 'soft'];
    const stints = [];
    let remaining = totalLaps;
    let i = 0;
    while (remaining > 0 && stints.length < 6) {
        const compound = order[Math.min(i, order.length - 1)];
        stints.push(compound);
        remaining -= life[compound];
        i++;
    }
    return stints;
}

module.exports = {
    TYRE_COMPOUNDS, DEFAULT_COMPOUND,
    WEAR_LAPS_AT_MEDIUM, WEAR_OFFTRACK_EXTRA, WEAR_SPEED_PENALTY, WEAR_GRIP_PENALTY,
    WEAR_BRAKE_PENALTY, WEAR_ACCEL_PENALTY,
    WEAR_CLIFF_THRESHOLD, WEAR_CLIFF_GENTLE_FRACTION,
    tyreOf, applyTyreWear, suggestStrategy, getWearPenaltyFactor
};
