// frontend/shared/f1Duelli.js
//
// Di quanto un bot si sposta dalla sua linea, e perche'.
//
// ⚠️ NASCE DA UNA MISURA. Su `prova` la traiettoria dei bot sta a 5.42 unita'
// da un lato dell'asse, con una mezza carreggiata di 11: lascia 16.4 unita'
// libere dall'altra parte. L'utente, al playtest del 2026-09-05: «non c'e'
// duello perche' i bot sono costantemente all'interno quindi di lato in pista,
// io passo sempre dal lato opposto e li supero facilmente». Non e' un problema
// estetico: e' che il sorpasso e' regalato.
//
// Qui dentro NON si tocca la velocita'. Un bot che rallenta per restare
// davanti e' cio' che i giocatori riconoscono come «AI che bara»: la difesa
// sposta la traiettoria, non il piede.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Duelli = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // ⚠️ UN SOLO CAMBIO DI TRAIETTORIA IN DIFESA, come impone il regolamento
    // vero. Fra un cambio e il successivo devono passare almeno due secondi:
    // senza, un bot inseguito da qualcuno che ondeggia si mette a ondeggiare
    // con lui, e si vede.
    const INTERVALLO_CAMBIO_MS = 2000;

    // Di quanto spostarsi per coprire chi arriva da dietro.
    //
    // ⚠️ SI MIRA ALLA SUA LINEA, NON A UNO SPOSTAMENTO DALLA PROPRIA. E' il
    // modello riscritto dopo il playtest del 2026-09-06 («ad hard non noto
    // ancora che si spostano per difendere»), e la differenza non e'
    // accademica: la difesa vecchia diceva «spostati di X», con X in frazione
    // di mezza carreggiata. Ma quanto valga X in pista dipende da DOVE passa
    // la linea di chi difende, e su `prova` passa a 6 unita' dall'asse
    // lasciandone 16.3 dall'altra parte. Il bot si spostava — quasi una
    // larghezza d'auto, misurata — e la porta restava larga 4 auto affiancate:
    // chi attaccava passava senza toccare il volante, quindi non vedeva
    // nessuna difesa. Nessun aumento di X ci arrivava: al 100% della mezza
    // carreggiata restavano 2.9 auto di porta.
    //
    // Mirare alla linea dell'attaccante e' anche cio' che fa un pilota vero:
    // non «mi sposto un po'», ma «gli prendo la traiettoria».
    //
    // Restituisce anche il MOTIVO, che non serve al bot ma a chi guarda: in
    // una gara di sei bot, sapere perche' uno NON si e' difeso e' l'unica
    // differenza fra «funziona» e «sembra rotto».
    function scostamentoDifensivo(stato) {
        const s = stato || {};
        const attuale = s.scostamentoAttuale || 0;
        const haAttaccante = s.latAttaccante !== null && s.latAttaccante !== undefined;

        // Nessuno dietro, o troppo lontano: si torna sulla propria linea.
        if (!haAttaccante || !(s.gapM < (s.finestraM || 30))) {
            return { scostamento: 0, motivo: 'lontano' };
        }
        // Quanta pista mi separa da lui, di traverso. E' la porta che gli sto
        // lasciando: se e' incolonnato sulla mia stessa linea non c'e' niente
        // da chiudere, sono gia' davanti a lui.
        const daCoprire = s.latAttaccante - (s.latLinea || 0);
        if (daCoprire === 0) return { scostamento: 0, motivo: 'in-linea' };

        // Affiancato: chiudergli la porta non e' difendersi, e' un contatto.
        if (s.affiancato) return { scostamento: attuale, motivo: 'affiancato' };

        // Gia' spostato da poco dall'altra parte: si resta dove si e'.
        const dallUltimo = (s.adessoMs || 0) - (s.ultimoCambioMs || 0);
        const cambierebbeLato = attuale !== 0 && Math.sign(attuale) !== Math.sign(daCoprire);
        if (cambierebbeLato && dallUltimo < INTERVALLO_CAMBIO_MS) {
            return { scostamento: attuale, motivo: 'gia-mosso' };
        }

        // Piu' e' vicino, piu' si copre: a meta' finestra si copre a meta'.
        const vicinanza = Math.max(0, Math.min(1, 1 - s.gapM / (s.finestraM || 30)));
        // `copertura` e' QUANTA PARTE della sua linea si prende, non un
        // numero di unita': 1 = gli si va esattamente davanti, 0.4 = ci si
        // sposta di due quinti verso di lui. E' la manopola del livello, e
        // vale su qualunque pista e qualunque racing line senza ritararla.
        const copertura = s.copertura || 0;
        return { scostamento: daCoprire * copertura * vicinanza, motivo: 'copre' };
    }

    return { scostamentoDifensivo, INTERVALLO_CAMBIO_MS };
});
