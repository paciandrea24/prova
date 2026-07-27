// backend/sockets/games/physics/TyreForceModel.js
//
// TyreForceModel: modulo isolato — Fase 0 (Rif.
// docs/superpowers/specs/2026-07-27-f1-tyre-force-model-migration-design.md).
// Calcola 3 fattori di influenza gomme (trazione/frenata/aderenza in curva)
// da un'unica curva di usura condivisa (TyreModel.getWearPenaltyFactor)
// invece delle 3 WEAR_*_PENALTY oggi consumate separatamente e in modo
// scollegato da PowertrainModel/BrakingModel/AerodynamicsModel.
//
// NON è collegato a nessun modulo esistente: zero wiring, zero cambio di
// gameplay. Il collegamento (Fase 2A/2B della spec) è deliberatamente fuori
// da questo file.
//
// Questa Fase 0 NON introduce un nuovo modello di comportamento gomme: è
// solo il punto di consolidamento del calcolo, che prima viveva come 3
// WEAR_*_PENALTY scollegate. Il comportamento numerico è intenzionalmente
// equivalente al modello precedente (stesse sensibilità, stessa curva
// "cliff") — il cambiamento di feeling percepito arriverà solo nelle fasi
// successive (Fase 2B), dopo validazione esplicita.
const { getWearPenaltyFactor } = require('./TyreModel');

// Sensibilità per asse: quota massima persa a gomma esaurita (wear=100).
// Partono numericamente identiche alle WEAR_ACCEL_PENALTY/WEAR_BRAKE_PENALTY/
// WEAR_GRIP_PENALTY esistenti — punto di partenza uguale al comportamento
// attuale, così un futuro confronto (Fase 2A) parte da zero differenze; la
// taratura vera avviene solo dopo, in una fase successiva.
const TRACTION_SENSITIVITY  = 0.20;
const BRAKING_SENSITIVITY   = 0.30;
const CORNERING_SENSITIVITY = 0.35;

// Budget di aderenza residua (1 = gomma nuova, 0 = gomma esaurita) — unica
// grandezza condivisa da cui derivano tutti e 3 i fattori sotto, per non
// ricreare 3-4 curve scollegate sotto un altro nome: riusa la stessa curva
// "cliff" di TyreModel, non la duplica.
function tyreGripBudget(tyreWear) {
    return 1 - getWearPenaltyFactor(tyreWear);
}

// In qualifica l'usura viene ignorata (stessa regola già applicata oggi in
// Powertrain/Braking/AerodynamicsModel): fattore sempre pieno.
function influenceFactor(tyreWear, isQuali, sensitivity) {
    if (isQuali) return 1;
    return 1 - (1 - tyreGripBudget(tyreWear)) * sensitivity;
}

function tractionFactor(tyreWear, isQuali) {
    return influenceFactor(tyreWear, isQuali, TRACTION_SENSITIVITY);
}

function brakingFactor(tyreWear, isQuali) {
    return influenceFactor(tyreWear, isQuali, BRAKING_SENSITIVITY);
}

function corneringGripFactor(tyreWear, isQuali) {
    return influenceFactor(tyreWear, isQuali, CORNERING_SENSITIVITY);
}

// Punto di ingresso pubblico: accetta anche `compound` (mescola), come da
// contratto della spec ("a partire da mescola e usura") — in questa prima
// versione il parametro non altera il risultato: la differenza di mescola è
// già coperta altrove (tyreOf().speedMult/gripMult, invariato). Resta qui
// solo per tenere la firma stabile in vista di un'eventuale futura
// differenziazione del carattere di degrado per mescola.
function computeTyreFactors(compound, tyreWear, isQuali) {
    return {
        traction: tractionFactor(tyreWear, isQuali),
        braking: brakingFactor(tyreWear, isQuali),
        corneringGrip: corneringGripFactor(tyreWear, isQuali),
    };
}

module.exports = {
    TRACTION_SENSITIVITY, BRAKING_SENSITIVITY, CORNERING_SENSITIVITY,
    tyreGripBudget, tractionFactor, brakingFactor, corneringGripFactor, computeTyreFactors
};
