// backend/sockets/games/physics/FuelModel.js
//
// Fuel Model: quanto pesa l'auto adesso. Rif.
// docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md.
//
// Una F1 vera parte con ~110 kg di benzina su ~798 kg di peso minimo: il 14%
// di massa in piu', che vale piu' di 3 secondi al giro — piu' del degrado
// gomme. Qui il valore e' ridotto perche' la fisica e' arcade.
//
// TARATO AL PLAYTEST del 2026-08-23: partito dall'8%, l'utente ha riferito
// "nei primi giri faccio un po' di difficolta' a sterzare, e' un po' troppo
// pesante". Sceso al 5%.
//
// La leva giusta era QUESTA e non FUEL_CORNERING_SHARE, anche se la
// sensazione riferita era di sterzo: a serbatoio pieno lo sterzo perdeva il
// 3.85% mentre la FRENATA ne perdeva il 7.41: e' arrivare in curva troppo
// forte che si sente come "non riesco a girare". Abbassare la quota in curva
// avrebbe agito sul contributo piu' piccolo, e la correzione successiva
// sarebbe stata di nuovo "ancora un po'".
//
// PROPRIETA' EMERGENTE, da NON programmare: l'auto si alleggerisce mentre la
// gomma si consuma, e le due cose in buona parte si annullano. E' il motivo
// per cui in F1 i tempi sul giro restano piatti nonostante tutto peggiori. Se
// emerge, e' giusto.
//
// Questo modulo non sa se si sta correndo una gara veloce o una tappa di
// campionato, e non deve saperlo: legge `p.fuelFactor` e basta. Chi lo riempie
// e' il tick, in un punto solo (f1GameSocket.js::aggiornaCarburante).
const FUEL_MASS_AT_START = 1.05;

// Quanta parte del peso si sente in CURVA. A forza piena il primo giro
// diventa ingiocabile: togliere in curva tanto quanto si toglie in rettilineo
// e' molto piu' di quanto sembri leggendo il numero. Vedi la nota della spec
// su come si misura un flag di guida — in curva, mai sul tempo sul giro.
//
// Questa e' la SECONDA leva, non la prima: se il peso desse ancora fastidio
// specificamente in curva mentre accelerazione e frenata vanno bene, si tocca
// qui. Se da' fastidio in generale, si tocca FUEL_MASS_AT_START sopra.
const FUEL_CORNERING_SHARE = 0.5;

// Dal pieno (al via) al vuoto (alla bandiera), lineare sui giri percorsi.
// L'avanzamento e' quello DI QUEL PILOTA, non della gara: la benzina la
// consuma chi guida, e un doppiato non puo' essere leggero come chi lo ha
// doppiato.
//
// `lap` puo' superare `totalLaps` nel giro di rientro dopo la bandiera, e
// `totalLaps` puo' arrivare a 0 o assente da un game costruito a mano: in
// entrambi i casi si limita invece di produrre NaN, che da qui arriverebbe
// fino a p.angle e farebbe sparire l'auto dal tracciato (stessa trappola gia'
// documentata in TyreModel.getWearPenaltyFactor).
function fuelFactorFor(lap, totalLaps) {
    const giri = Math.max(1, totalLaps || 1);
    const percorso = Math.max(0, Math.min(1, (lap || 0) / giri));
    return 1 + (FUEL_MASS_AT_START - 1) * (1 - percorso);
}

// INVARIANTE "niente NaN senza il campo", lo stesso di p.damageParts e
// p.tyreWear: un giocatore senza `fuelFactor` e' un giocatore a serbatoio
// vuoto. E' cio' che tiene in piedi gli strumenti offline (f1LapSimulator,
// f1RaceLineOptimizer), che costruiscono i loro giocatori a mano, ed e' anche
// cio' che rende il carburante invisibile alla qualifica senza nessun ramo su
// isQuali dentro i modelli.
function fuelFactorOf(p) {
    const f = p && p.fuelFactor;
    if (typeof f !== 'number' || !Number.isFinite(f) || f < 1) return 1;
    return Math.min(f, FUEL_MASS_AT_START);
}

function fuelCorneringFactor(p) {
    return 1 + (fuelFactorOf(p) - 1) * FUEL_CORNERING_SHARE;
}

module.exports = {
    FUEL_MASS_AT_START, FUEL_CORNERING_SHARE,
    fuelFactorFor, fuelFactorOf, fuelCorneringFactor
};
