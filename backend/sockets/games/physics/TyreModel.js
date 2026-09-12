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
// ⚠️ `sigla` STA QUI e non nel client. La classifica in gara mostra una
// lettera accanto al pilota, e la prendeva da una tabella scritta a mano nel
// suo file: `{ soft: 'S', medium: 'M', hard: 'H' }`. Con cinque mescole quella
// tabella restituiva `undefined` per le due da bagnato, e in classifica chi
// aveva montato intermedie o full wet non mostrava NIENTE — segnalato
// dall'utente, che dai box vedeva i bot rientrare e poi leggeva una lettera che
// non cambiava. Una cosa, una misura: la sigla viaggia con label e colore.
// I e W sono le lettere della F1 vera, e vanno coi colori verde e blu.
const TYRE_COMPOUNDS = {
// ⚠️ `breve` e' il nome per gli spazi STRETTI (il pannello dello stato
// vettura, largo quanto una colonna): «Intermedie» per esteso spingeva la
// percentuale di usura FUORI dal pannello — segnalato dall'utente. INTER e WET
// non sono abbreviazioni inventate: sono come le chiamano i piloti.
    soft:   { label: 'Soft',   breve: 'Soft',   sigla: 'S', color: '#e74c3c', speedMult: 1.05, gripMult: 1.00, vita: 0.35 },
    medium: { label: 'Medium', breve: 'Medium', sigla: 'M', color: '#f1c40f', speedMult: 1.00, gripMult: 0.95, vita: 0.50 },
    hard:   { label: 'Hard',   breve: 'Hard',   sigla: 'H', color: '#ecf0f1', speedMult: 0.95, gripMult: 0.90, vita: 0.70 },
// ── LE DUE DA BAGNATO ───────────────────────────────────────────────────
    // `speedMult` e' COSTANTE anche per queste, non funzione del bagnato: la
    // velocita' di punta passa da PowertrainModel, che e' un terzo consumatore
    // e non guadagnerebbe niente in sensazione. Il cielo entra nell'ADERENZA e
    // nella VITA, e li' entra da un posto solo (vedi aderenzaBagnato).
    // `gripMult` segue la convenzione (rovesciata) di questa tabella, dove piu'
    // alto = piu' scivolata: vedi il FIX SEGNO in AerodynamicsModel.
    intermedie: { label: 'Intermedie', breve: 'Inter', sigla: 'I', color: '#2ecc71', speedMult: 0.95, gripMult: 0.95, vita: 0.45 },
    pioggia:    { label: 'Pioggia',    breve: 'Wet',   sigla: 'W', color: '#3498db', speedMult: 0.90, gripMult: 0.97, vita: 0.55 },
};
const DEFAULT_COMPOUND = 'medium';

// Le tre da asciutto, in ordine di durata. Esiste perche' mezzo gioco deve
// parlare solo di quelle — il suggerimento di strategia, la previsione dei giri
// in pagina mescole, la tabella dell'editor — e `Object.keys(TYRE_COMPOUNDS)`
// da oggi ne restituisce cinque.
const MESCOLE_ASCIUTTO = ['soft', 'medium', 'hard'];

// ── IL BAGNATO DENTRO LA MESCOLA ────────────────────────────────────────────
//
// Ogni mescola ha una FINESTRA di bagnato dove da' il meglio, e una larghezza
// oltre la quale non lavora piu'. Il fattore che ne esce e' l'ADERENZA
// DISPONIBILE (1 = piena), e viene consultato da DUE consumatori indipendenti:
// AerodynamicsModel.effectiveGrip (come l'auto scivola) e
// CorneringGripModel.corneringCapacity (quanto il bot frena).
//
// ⚠️ DEVONO AVERLO ENTRAMBI. corneringCapacity non legge la mescola: se il
// bagnato entrasse solo nella prima, il bot entrerebbe in curva alla velocita'
// dell'asciutto convinto di avere aderenza che la fisica non gli da'. E' scritto
// nero su bianco in CorneringGripModel per il banking: col fattore da un lato
// solo si e' misurato un giro piu' LENTO del 12%.
const FINESTRE_BAGNATO = {
    soft:       { centro: 0.00, larghezza: 0.20 },
    medium:     { centro: 0.00, larghezza: 0.22 },
    hard:       { centro: 0.00, larghezza: 0.24 },
    intermedie: { centro: 0.45, larghezza: 0.38 },
    pioggia:    { centro: 0.90, larghezza: 0.45 },
};
// Quanto resta con la gomma COMPLETAMENTE sbagliata. Non zero: e' un simcade,
// si deve poter rientrare ai box guidando, non scivolando.
const ADERENZA_FUORI_FINESTRA = 0.55;
// Quanto costa il bagnato ANCHE con la gomma giusta. E' il numero che porta il
// giro al +10%: e' qui che si tara, non nelle finestre.
// Tarato al banco il 2026-09-12 (node backend/tools/f1MeteoBanco.js), tre semi
// appaiati su `prova`: 0.04 dava +9.2%, 0.08 +9.7%, 0.12 +10.3%, 0.16 +13.9%.
// Il valore di partenza era 0.22, che dava +15.4%: la pioggia costava mezzo
// secondo e mezzo di troppo al giro.
const ADERENZA_PERSA_SUL_BAGNATO = 0.12;

function aderenzaBagnato(compound, bagnato) {
    const f = FINESTRE_BAGNATO[compound] || FINESTRE_BAGNATO[DEFAULT_COMPOUND];
    const b = Math.max(0, Math.min(1, bagnato || 0));
    const d = Math.abs(b - f.centro) / f.larghezza;
    const perdita = Math.min(1, d * d);       // dentro la finestra si perde poco, fuori crolla
    const finestra = 1 - (1 - ADERENZA_FUORI_FINESTRA) * perdita;
    const assoluto = 1 - ADERENZA_PERSA_SUL_BAGNATO * b;
    return finestra * assoluto;
}

// Quanto piu' in fretta si consuma la gomma sbagliata. ⚠️ Solo in UN verso:
// una gomma da bagnato su una pista asciutta si distrugge (non ha acqua da
// raffreddarla), una slick sul bagnato non si brucia — semplicemente non
// aderisce, che e' gia' punito da aderenzaBagnato.
const VITA_PENALITA_SU_ASCIUTTO = 3;

function fattoreVitaBagnato(compound, bagnato) {
    const f = FINESTRE_BAGNATO[compound] || FINESTRE_BAGNATO[DEFAULT_COMPOUND];
    const b = Math.max(0, Math.min(1, bagnato || 0));
    const troppoAsciutto = Math.max(0, f.centro - b) / f.larghezza;
    return 1 + VITA_PENALITA_SU_ASCIUTTO * Math.min(1, troppoAsciutto);
}

// In qualifica la mescola non la scegle il giocatore: la scegle il gioco, e
// deve scegliere quella giusta per il cielo di ADESSO. Prima era la Soft fissa,
// e sul bagnato voleva dire qualificarsi con le slick.
function mescolaPerCielo(bagnato) {
    const b = bagnato || 0;
    if (b >= 0.65) return 'pioggia';
    if (b >= 0.25) return 'intermedie';
    return 'soft';
}

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
// Il NOME della mescola che sta davvero sull'auto adesso. Esiste perche'
// `tyreOf` restituisce lo spec (tre numeri) e chi deve chiedere la finestra di
// bagnato ha bisogno della chiave. ⚠️ Senza questa funzione, in qualifica la
// fisica userebbe la finestra della mescola scelta PER LA GARA mentre le gomme
// montate sono quelle del cielo: due misure per la stessa cosa.
function nomeMescola(p, isQuali) {
    if (isQuali) return mescolaPerCielo(p && p.bagnato);
    return TYRE_COMPOUNDS[p && p.compound] ? p.compound : DEFAULT_COMPOUND;
}

function tyreOf(p, isQuali) {
    return TYRE_COMPOUNDS[nomeMescola(p, isQuali)];
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
    // La gomma sbagliata per il cielo si consuma piu' in fretta: una da
    // bagnato su una pista asciutta si distrugge. ⚠️ Qui `p.compound` va bene
    // senza `nomeMescola`: questa funzione la chiama solo la gara (in
    // qualifica l'usura non si applica affatto), quindi la mescola scelta e
    // quella montata sono la stessa cosa.
    const wear = dist * wearPerUnitDist * fuelFactorOf(p) * fattoreVitaBagnato(p.compound, p.bagnato);
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
        // ⚠️ Anche le due da bagnato, da quando la pagina delle gomme ne mostra
        // cinque: senza, la scheda dell'intermedia diceva «Durata —» e sembrava
        // un dato mancante. Questo e' il numero IN FINESTRA, cioe' con la gomma
        // giusta per il cielo che c'e'; fuori finestra si brucia, e quello lo
        // dice il fattore di vita alla fisica. Una cosa, una misura: qui si
        // mostra la stessa vita che la fisica usa quando il cielo e' quello
        // giusto.
        intermedie: giri('intermedie'),
        pioggia:    giri('pioggia'),
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
    vitaFrazione, VITA_MASSIMA_GARA,
    MESCOLE_ASCIUTTO, FINESTRE_BAGNATO, aderenzaBagnato, fattoreVitaBagnato,
    mescolaPerCielo, nomeMescola, ADERENZA_PERSA_SUL_BAGNATO
};
