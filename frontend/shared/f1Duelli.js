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
    // Restituisce anche il MOTIVO, che non serve al bot ma a chi guarda: in
    // una gara di sei bot, sapere perche' uno NON si e' difeso e' l'unica
    // differenza fra «funziona» e «sembra rotto».
    function scostamentoDifensivo(stato) {
        const s = stato || {};
        const attuale = s.scostamentoAttuale || 0;

        // Nessuno dietro, o troppo lontano: si torna sulla propria linea.
        if (!s.latoAttaccante || !(s.gapM < (s.finestraM || 30))) {
            return { scostamento: 0, motivo: 'lontano' };
        }
        // Affiancato: chiudergli la porta non e' difendersi, e' un contatto.
        if (s.affiancato) return { scostamento: attuale, motivo: 'affiancato' };

        // Gia' spostato da poco dall'altra parte: si resta dove si e'.
        const dallUltimo = (s.adessoMs || 0) - (s.ultimoCambioMs || 0);
        const cambierebbeLato = attuale !== 0 && Math.sign(attuale) !== Math.sign(s.latoAttaccante);
        if (cambierebbeLato && dallUltimo < INTERVALLO_CAMBIO_MS) {
            return { scostamento: attuale, motivo: 'gia-mosso' };
        }

        // Piu' e' vicino, piu' si copre: a meta' finestra si copre a meta'.
        const vicinanza = Math.max(0, Math.min(1, 1 - s.gapM / (s.finestraM || 30)));
        const forza = s.forza || 0;
        return { scostamento: Math.sign(s.latoAttaccante) * forza * vicinanza, motivo: 'copre' };
    }

    return { scostamentoDifensivo, INTERVALLO_CAMBIO_MS };
});
