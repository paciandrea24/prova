// backend/sockets/games/physics/TyreModel.js
//
// Tyre Model: mescole (Soft/Medium/Hard), usura, suggerimento strategia.
// Estratto da f1GameSocket.js (Rif. SDD Capitolo 10.6) senza modificarne la
// logica — stesse formule, stessi valori, stesso comportamento.

const { fuelFactorOf } = require('./FuelModel');

// ====================================================
// MESCOLE E USURA GOMME
// Soft/Medium/Hard differiscono sia in prestazioni (velocità massima e
// aderenza) sia in velocità di usura — come nella F1 vera: la Soft è più
// veloce ma dura meno, la Hard il contrario. L'usura cresce SOLO con la
// distanza percorsa (fermo = zero usura, richiesta esplicita), con un piccolo
// extra fuoripista; a gomme esaurite si perde fino a WEAR_SPEED_PENALTY di
// velocità massima. Trazione/frenata/aderenza in curva sono governate da
// TyreForceModel (Fase 2B, Rif.
// docs/superpowers/specs/2026-07-27-f1-tyre-force-model-migration-design.md),
// non più da penalità dirette qui.
// ====================================================
// ⚠️ `vita` E' UNA FRAZIONE DELLA GARA, non un numero di giri. Fino al
// 2026-09-11 una Medium durava 5 giri e basta: identici su una gara da 4 e su
// una da 13. Su gare cosi' corte voleva dire che la Hard (8 giri) arrivava in
// fondo da sola e la Soft quasi, quindi la mescola non era una scelta —
// segnalato dall'utente: «la rossa non puo' durare 4 giri su una gara da 5,
// devono poter essere utilizzabili tutte e 3».
//
// Legandola alla distanza di gara, la taratura vale identica sulle gare corte
// di prova e su quelle lunghe del gioco finito: non va fatta due volte.
//
// ⚠️ E NESSUNA ARRIVA IN FONDO, nemmeno la Hard: se una ci arrivasse, la
// sosta la faresti solo perche' e' obbligatoria. «Comunque ci deve essere il
// cambio mescola.»
//
// Chi vince dipende poi dall'abrasivita' della pista, che divide questi
// numeri: misurato sul modello, 0.7 premia la Soft, 0.9 la Medium, da 1.1 in
// su la Hard, e da 1.8 la gara diventa a due soste.
const TYRE_COMPOUNDS = {
    soft:   { label: 'Soft',   color: '#e74c3c', speedMult: 1.05, gripMult: 1.00, vita: 0.35 },
    medium: { label: 'Medium', color: '#f1c40f', speedMult: 1.00, gripMult: 0.95, vita: 0.50 },
    hard:   { label: 'Hard',   color: '#ecf0f1', speedMult: 0.95, gripMult: 0.90, vita: 0.70 },
};
const DEFAULT_COMPOUND = 'medium';

// ⚠️ IL TETTO CHE TIENE IN PIEDI LA REGOLA. L'abrasivita' divide la vita, e
// su una pista dolce (0.5-0.7, valori che lo slider dell'editor permette) la
// Hard tornerebbe ad arrivare in fondo da sola: 0.70/0.6 = 117% della gara. Si
// riavrebbe la sosta fatta solo perche' obbligatoria, cioe' il difetto da cui
// nasce tutto questo lavoro, scelto per sbaglio da chi disegna una pista.
//
// Il vincolo sta QUI e non nei limiti dello slider: legato all'interfaccia
// sarebbe un numero da tenere d'accordo con le frazioni qui sopra, e al primo
// ritocco divergerebbero in silenzio.
const VITA_MASSIMA_GARA = 0.85;

// Quanta parte della gara sopravvive un treno di questa mescola su questa
// pista. ⚠️ UNA SOLA FUNZIONE per la fisica e per il numero mostrato al
// giocatore: se la schermata dicesse «dura 3 giri» e la pista ne concedesse
// cinque, il gioco sarebbe ingiusto in silenzio.
function vitaFrazione(spec, abrasivita) {
    const s = (typeof spec === 'string' ? TYRE_COMPOUNDS[spec] : spec) || TYRE_COMPOUNDS[DEFAULT_COMPOUND];
    return Math.min(VITA_MASSIMA_GARA, s.vita / (abrasivita || 1));
}

// Serve solo alle piste costruite a mano negli strumenti offline e nei test,
// che non hanno `totalLaps`. ⚠️ Non e' un ripiego silenzioso: su una pista
// vera totalLaps c'e' sempre (lo calcola trackLoader), e un test lo pretende.
const GIRI_DI_RIFERIMENTO = 5;
const WEAR_OFFTRACK_EXTRA = 0.02; // piccolo extra per tick fuori pista (oltre a quello da distanza)
const WEAR_SPEED_PENALTY  = 0.25; // fino a -25% velocità massima a gomme esaurite

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
// risultante (0..1) va moltiplicato per WEAR_SPEED_PENALTY (qui) o dato in
// pasto a TyreForceModel (trazione/frenata/aderenza in curva, Fase 2B) —
// stesso ruolo di prima (tyreWear/100), curva diversa.
// ====================================================
const WEAR_CLIFF_THRESHOLD = 0.60;       // frazione di usura (0-1) oltre cui inizia il "cliff"
const WEAR_CLIFF_GENTLE_FRACTION = 0.25; // quota del fattore massimo (1.0) raggiunta ESATTAMENTE alla soglia

// Tratto dolce (w <= soglia): lineare da 0 a WEAR_CLIFF_GENTLE_FRACTION.
// Tratto cliff (w > soglia): quadratico da WEAR_CLIFF_GENTLE_FRACTION a 1.0 —
// continuo nel valore al punto di raccordo (stesso fattore su entrambi i
// lati della soglia), non nella derivata: il cambio di pendenza è voluto,
// è il "cliff" — una perdita di prestazione percepibile, non
// un'estrapolazione morbida del tratto precedente.
// `tyreWear || 0`: stesso invariante "niente NaN senza il campo" già in uso
// in PowertrainModel.effectiveMaxSpeed per damageParts. Senza, un player
// costruito senza tyreWear produce NaN qui, e da TyreSlipModel il NaN arriva
// fino a p.angle in SteeringModel: l'auto sparirebbe dal tracciato. Il
// percorso è diventato vivo con la promozione di F1_TYRE_SLIP_MODEL a
// default ON (2026-08-11). Gomma assente = gomma nuova, l'unica lettura
// sensata.
function getWearPenaltyFactor(tyreWear) {
    const w = Math.max(0, Math.min(100, tyreWear || 0)) / 100;
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
    // Quanti giri dura questo treno su QUESTA gara, prima dell'abrasivita'.
    const giriGara = track.totalLaps || GIRI_DI_RIFERIMENTO;
    // L'abrasivita' entra QUI dentro, nella vita, non piu' come fattore a
    // parte: e' li' che vive il tetto.
    const vita = vitaFrazione(tyreOf(p), track.abrasivita);
    const wearPerUnitDist = 100 / (vita * giriGara * track.lapLength);
    // Peso del carburante: l'auto piena carica di piu' le gomme e le consuma
    // di piu'. E' la ragione fisica per cui il primo stint e' il piu' duro.
    // Abrasivita' del circuito: quanto quell'asfalto mangia le gomme. Il
    // valore lo normalizza e lo limita trackLoader; qui `|| 1` copre solo i
    // game costruiti a mano nei test e negli strumenti offline.
    const wear = dist * wearPerUnitDist * fuelFactorOf(p);
    p.tyreWear = Math.min(100, p.tyreWear + wear);
    if (offTrack) p.tyreWear = Math.min(100, p.tyreWear + WEAR_OFFTRACK_EXTRA);
}

// Suggerimento di strategia (solo indicativo, mostrato in selezione mescola):
// parte da una mescola durevole per il primo stint, poi via via più
// prestazionali per i restanti — quante ne servono dipende dai giri totali.
// Quanti giri dura ogni mescola SU QUESTA PISTA. E' il numero che il giocatore
// usa per decidere se fermarsi una volta o due — cioe' lo strumento con cui si
// calcola un under-cut. `totalLaps` non entra nel conto: e' qui solo perche'
// chi chiama ha gia' quel dato sottomano e non deve andarlo a cercare due
// volte. Rif. docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md.
function giriPerMescola(totalLaps, abrasivita) {
    const abr = abrasivita || 1;
    const giriGara = totalLaps || GIRI_DI_RIFERIMENTO;
    // Arrotondato SOLO qui: e' il numero che si mostra al giocatore. La fisica
    // usa la frazione esatta, altrimenti due piste vicine di lunghezza
    // darebbero la stessa durata a scatti.
    const giri = (compound) => Math.max(1, Math.round(vitaFrazione(compound, abr) * giriGara));
    return {
        hard:   giri('hard'),
        medium: giri('medium'),
        soft:   giri('soft'),
    };
}

function suggestStrategy(totalLaps, abrasivita) {
    const life = giriPerMescola(totalLaps, abrasivita);
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
    GIRI_DI_RIFERIMENTO, WEAR_OFFTRACK_EXTRA, WEAR_SPEED_PENALTY,
    WEAR_CLIFF_THRESHOLD, WEAR_CLIFF_GENTLE_FRACTION,
    tyreOf, applyTyreWear, suggestStrategy, giriPerMescola, getWearPenaltyFactor,
    vitaFrazione, VITA_MASSIMA_GARA
};
