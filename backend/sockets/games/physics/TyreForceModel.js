// backend/sockets/games/physics/TyreForceModel.js
//
// TyreForceModel: modulo isolato — Fase 0 (Rif.
// docs/superpowers/specs/2026-07-27-f1-tyre-force-model-migration-design.md).
// Calcola 3 fattori di influenza gomme (trazione/frenata/aderenza in curva)
// da un'unica curva di usura condivisa (TyreModel.getWearPenaltyFactor)
// invece delle 3 WEAR_*_PENALTY oggi consumate separatamente e in modo
// scollegato da PowertrainModel/BrakingModel/AerodynamicsModel.
//
// Fase 0 NON introduceva un nuovo modello di comportamento gomme: era solo
// il punto di consolidamento del calcolo, che prima viveva come 3
// WEAR_*_PENALTY scollegate.
//
// Fase 2A: il modulo è diventato RAGGIUNGIBILE da PowertrainModel/
// BrakingModel/AerodynamicsModel come percorso di CONFRONTO attivabile via
// una env var, in affiancamento alle 4 WEAR_*_PENALTY (rimaste la fonte di
// default).
//
// Fase 2A.5: ritarata la logica INTERNA dei 3 fattori (sensitivity + reshape
// per esponente) per dare a ciascun asse un carattere diverso — validata con
// playtest utente ("differenza percepibile ma contenuta, sensazione
// positiva").
//
// Fase 2B (attuale): TyreForceModel è ora l'UNICA fonte dei 3 fattori per
// tutti i giocatori — le WEAR_ACCEL_PENALTY/WEAR_BRAKE_PENALTY/
// WEAR_GRIP_PENALTY legacy sono state rimosse da TyreModel.js, e con esse il
// flag di confronto (non c'era più un ramo alternativo da selezionare).
// Sensitivity/esponenti restano quelli tarati in 2A.5, invariati qui.
const { getWearPenaltyFactor } = require('./TyreModel');

// Sensibilità per asse: quota massima persa a gomma esaurita (wear=100,
// deficit^exponent=1 qualunque sia l'esponente — il cliff numerico a fine
// vita gomma resta esattamente `sensitivity`, invariante rispetto al reshape
// sotto). Tarate in Fase 2A.5 per dare a ciascun asse un carattere diverso,
// deliberatamente diverse dalle WEAR_*_PENALTY legacy (Rif.
// docs/superpowers/specs/2026-07-27-f1-tyre-force-model-migration-design.md).
const TRACTION_SENSITIVITY  = 0.25;
const BRAKING_SENSITIVITY   = 0.35;
const CORNERING_SENSITIVITY = 0.40;

// Esponente di reshape per asse, applicato al deficit condiviso (vedi
// influenceFactor sotto) prima di scalarlo per la sensitivity:
// - <1 (cornering): l'asse sente il deficit PRIMA nel ciclo di usura (curva
//   concava — sale rapido anche a bassa usura) — è il primo segnale di gomma
//   che cala (scivolata/sottosterzo in curva).
// - =1 (braking): forma lineare nel deficit, invariata — la frenata peggiora
//   in proporzione diretta all'usura reale.
// - >1 (traction): l'asse resta quasi pieno a lungo, poi crolla vicino a
//   deficit=1 (curva convessa) — il grip meccanico in accelerazione si perde
//   per ultimo, wheelspin concentrato a fine stint.
const TRACTION_EXPONENT  = 1.5;
const BRAKING_EXPONENT   = 1.0;
const CORNERING_EXPONENT = 0.75;

// Budget di aderenza residua (1 = gomma nuova, 0 = gomma esaurita) — esposto
// per compatibilità e per chi vuole ragionare in termini di "quanto resta"
// invece che "quanto è stato consumato". Non usato internamente da
// influenceFactor (che lavora sul deficit, 1 - budget) per evitare un
// doppio giro di sottrazioni prima del reshape.
function tyreGripBudget(tyreWear) {
    return 1 - getWearPenaltyFactor(tyreWear);
}

// In qualifica l'usura viene ignorata (stessa regola già applicata oggi in
// Powertrain/Braking/AerodynamicsModel): fattore sempre pieno.
//
// `deficit` (0..1, 0 = gomma nuova) è l'UNICA grandezza condivisa da cui
// derivano tutti e 3 i fattori — stessa curva "cliff" di TyreModel, non
// duplicata; il reshape per esponente non crea 3-4 curve scollegate, è una
// funzione deterministica dello stesso deficit condiviso.
function influenceFactor(tyreWear, isQuali, sensitivity, exponent) {
    if (isQuali) return 1;
    const deficit = getWearPenaltyFactor(tyreWear);
    return 1 - Math.pow(deficit, exponent) * sensitivity;
}

function tractionFactor(tyreWear, isQuali) {
    return influenceFactor(tyreWear, isQuali, TRACTION_SENSITIVITY, TRACTION_EXPONENT);
}

function brakingFactor(tyreWear, isQuali) {
    return influenceFactor(tyreWear, isQuali, BRAKING_SENSITIVITY, BRAKING_EXPONENT);
}

function corneringGripFactor(tyreWear, isQuali) {
    return influenceFactor(tyreWear, isQuali, CORNERING_SENSITIVITY, CORNERING_EXPONENT);
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
    TRACTION_EXPONENT, BRAKING_EXPONENT, CORNERING_EXPONENT,
    tyreGripBudget, tractionFactor, brakingFactor, corneringGripFactor, computeTyreFactors
};
