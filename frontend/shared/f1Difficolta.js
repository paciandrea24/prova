// frontend/shared/f1Difficolta.js
//
// I tre livelli di difficolta' dei bot: cosa vuol dire, in numeri, che una
// gara e' facile o difficile.
//
// ⚠️ LA DIFFICOLTA' ESISTEVA GIA', MA GIRAVA A CASO. Prima del 2026-09-05
// ogni bot pescava da solo il proprio ritmo (0.93-1.00) e il proprio rumore
// di sterzo (0-0.25) alla creazione della griglia: il giocatore incontrava
// avversari fra +1.9 e +5.6 secondi al giro senza che nessuno lo decidesse.
// Qui quei due intervalli diventano tre coppie, scelte dal giocatore.
//
// I numeri sono tarati su misure col banco prova (`prova`, giro umano di
// riferimento 47.30 s, tre giri per casella). Rif.
// docs/superpowers/specs/2026-09-05-f1-livelli-difficolta-design.md.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Difficolta = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const PREDEFINITO = 'medio';
    const LIVELLI = ['facile', 'medio', 'difficile'];

    // ⚠️ RITMO E RUMORE SI MUOVONO INSIEME, mai in direzioni opposte: un bot
    // veloce e impreciso esce di pista. Misurato su `prova`: ritmo 1.00 con
    // rumore 0.25 fa 13 tick fuori dal cordolo, lo stesso rumore a ritmo 0.97
    // ne fa 3.
    //
    // Restano INTERVALLI e non valori fissi perche' la varianza fra i bot e'
    // cio' che rompe l'ordine statico della griglia: senza, chi parte davanti
    // resta davanti per tutta la gara.
    //
    // ⚠️ E sono STRETTI. La prima taratura di questa tabella li faceva larghi
    // (0.90-0.94, 0.95-0.98, 0.98-1.00) e i tre livelli si SOVRAPPONEVANO: il
    // bot piu' lento di `difficile` girava in +3.50 s dall'utente contro il
    // +3.17 del piu' veloce di `medio`, cioe' il livello alto era piu' lento
    // di quello medio. L'escursione dentro un livello non puo' superare la
    // distanza fra un livello e l'altro.
    const TABELLA = {
        // dove cade su `prova`, rispetto al giro umano di 47.30 s:
        facile:    { ritmoMin: 0.905, ritmoMax: 0.925, rumoreMin: 0.16, rumoreMax: 0.22,  // +5.02 / +5.80 s
                     margineSorpasso: 1.04, frazioneMinimaInScia: 0.75 },
        medio:     { ritmoMin: 0.945, ritmoMax: 0.965, rumoreMin: 0.08, rumoreMax: 0.14,  // +3.67 / +4.38 s
                     margineSorpasso: 1.01, frazioneMinimaInScia: 0.85 },
        difficile: { ritmoMin: 0.985, ritmoMax: 1.000, rumoreMin: 0.00, rumoreMax: 0.06,  // +1.85 / +3.23 s
                     margineSorpasso: 1.00, frazioneMinimaInScia: 0.92 },
    };

    // ⚠️ Tutto cio' che non e' esattamente uno dei tre livelli vale `medio`:
    // una lobby aperta prima di questa modifica non manda niente, e un client
    // vecchio puo' mandare qualunque cosa. Nessuno dei due deve ritrovarsi
    // bot senza ritmo — un `botSpeedFactor` undefined moltiplica la velocita'
    // obiettivo per NaN e l'auto sparisce dal tracciato.
    function normalizza(valore) {
        return LIVELLI.indexOf(valore) >= 0 ? valore : PREDEFINITO;
    }

    function intervalliDi(livello) {
        const t = TABELLA[normalizza(livello)];
        return { ritmoMin: t.ritmoMin, ritmoMax: t.ritmoMax,
                 rumoreMin: t.rumoreMin, rumoreMax: t.rumoreMax };
    }

    // Le due soglie che governano l'aggressivita', gia' esistenti in f1Bot.js
    // come costanti: quanto margine di velocita' serve per tentare un sorpasso
    // e quanto ci si accoda a chi precede. I valori di `medio` sono quelli
    // storici (1.01 e 0.85), cosi' chi non sceglie niente ritrova la gara di
    // prima.
    function soglieDi(livello) {
        const t = TABELLA[normalizza(livello)];
        return { margineSorpasso: t.margineSorpasso,
                 frazioneMinimaInScia: t.frazioneMinimaInScia };
    }

    return { LIVELLI, PREDEFINITO, normalizza, intervalliDi, soglieDi };
});
