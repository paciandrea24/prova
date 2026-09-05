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
                     margineSorpasso: 1.04, frazioneMinimaInScia: 0.75, forzaDifesa: 1.5,
                     erroriPerGiro: 1.2 },
        medio:     { ritmoMin: 0.945, ritmoMax: 0.965, rumoreMin: 0.08, rumoreMax: 0.14,  // +3.67 / +4.38 s
                     margineSorpasso: 1.01, frazioneMinimaInScia: 0.85, forzaDifesa: 3.0,
                     erroriPerGiro: 0.4 },
        difficile: { ritmoMin: 0.985, ritmoMax: 1.000, rumoreMin: 0.00, rumoreMax: 0.06,  // +1.85 / +3.23 s
                     margineSorpasso: 1.00, frazioneMinimaInScia: 0.92, forzaDifesa: 4.5,
                     erroriPerGiro: 0.05 },
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

    // Le due soglie che governano l'aggressivita', prima costanti in f1Bot.js:
    //
    // `margineSorpasso` — quanta velocita' libera in piu' serve per tentare un
    //   sorpasso. Il valore di `medio`, 1.01, e' il risultato di tre tarature
    //   successive: era il 5%, poi il 2%, poi giu' ancora su richiesta
    //   esplicita dell'utente, perche' in un playtest su Monza (3 giri) si era
    //   visto UN solo sorpasso. A `difficile` scende a 1.00: basta un margine
    //   qualsiasi. A `facile` sale al 4%, cosi' ti lasciano passare.
    //
    // `frazioneMinimaInScia` — a quanto scende la velocita' obiettivo quando si
    //   e' praticamente addosso a chi precede. Alta apposta: il bot talloona
    //   invece di staccarsi, per restare a ridosso e cercare l'occasione (spec
    //   2026-07-24-f1-bot-aggressivita-sorpassi-design.md). A `difficile` sale
    //   ancora, a `facile` scende: si stacca e ti lascia lavorare.
    function soglieDi(livello) {
        const t = TABELLA[normalizza(livello)];
        return { margineSorpasso: t.margineSorpasso,
                 frazioneMinimaInScia: t.frazioneMinimaInScia,
                 // Di quanto ci si sposta per coprire chi arriva da dietro,
                 // in unita' di pista. ⚠️ Da leggere contro la misura: la
                 // mezza carreggiata e' 11 e i bot lasciano 16.4 unita'
                 // libere da un lato. 4.5 ne copre poco piu' di un quarto:
                 // e' una difesa, non un muro.
                 forzaDifesa: t.forzaDifesa,
                 // Quanti errori attendersi in un giro. Non e' zero
                 // nemmeno a difficile: un pilota che non sbaglia MAI non
                 // e' credibile. Uno ogni venti giri e' abbastanza raro
                 // da non dare fastidio a chi sceglie il livello alto.
                 erroriPerGiro: t.erroriPerGiro };
    }

    return { LIVELLI, PREDEFINITO, normalizza, intervalliDi, soglieDi };
});
