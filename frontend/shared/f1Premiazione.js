// frontend/shared/f1Premiazione.js
//
// La coreografia della premiazione di fine mondiale: quanto dura ogni pezzo,
// chi entra quando, a che punto della sua entrata si è.
//
// Qui non c'è una riga di Three.js e nemmeno di DOM. Chi disegna chiede
// `stato(copione, tMs)` e sa cosa mettere a schermo in quel millisecondo; così
// i tempi si verificano senza browser, che di un'animazione sono la sola parte
// verificabile a tavolino — a occhio si vede se è troppo lunga, non se il
// secondo entra prima del terzo.
//
// LA DIFFERENZA CON LA CERIMONIA DI FINE GARA sta tutta qui dentro: là le tre
// auto sono già sul podio quando la scena si apre, qui SALGONO una alla volta,
// dal terzo al primo, e ognuna ha il suo momento. È la richiesta dell'utente
// («il mondiale è una cosa molto più grossa della vittoria di una singola
// gara»), tradotta in numeri.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Premiazione = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Le fasi di ogni entrata, in millisecondi.
    //   arrivo   — l'auto risale il rettilineo e si ferma davanti al podio
    //   salita   — sale sul gradino con un arco (è un gioco arcade: si alza)
    //   sosta    — resta ferma il tempo di essere guardata
    //   apoteosi — non entra più nessuno: la camera si alza, partono i coriandoli
    // L'apoteosi dura piu' delle altre fasi perche' e' quella in cui succede la
    // festa: fuochi d'artificio se il circuito e' notturno, frecce tricolori se
    // e' diurno. Con 5.2 s i razzi non facevano in tempo a salire e scoppiare.
    const DURATE = { arrivo: 2600, salita: 900, sosta: 700, apoteosi: 8000 };
    const DURATA_ENTRATA = DURATE.arrivo + DURATE.salita + DURATE.sosta;

    // Quanti posti ha un podio. Non è un numero arbitrario: è quanti gradini ha
    // il modello (podium_step_p1/p2/p3).
    const POSTI = 3;

    // Le battute, dall'ultimo dei premiati al primo. `posto: 0` è l'apoteosi:
    // non entra nessuno, e per questo non ha un posto.
    //
    // `quanti` può essere meno di tre: una stagione si può correre in due, o da
    // soli con un bot, e un podio a tre posti fissi si romperebbe proprio nel
    // caso più comune del gioco in singolo.
    function copione(quanti) {
        const premiati = Math.max(1, Math.min(POSTI, quanti | 0));
        const battute = [];
        let t = 0;
        for (let posto = premiati; posto >= 1; posto--) {
            battute.push({ posto, da: t, a: t + DURATA_ENTRATA });
            t += DURATA_ENTRATA;
        }
        battute.push({ posto: 0, da: t, a: t + DURATE.apoteosi });
        return battute;
    }

    function durataTotale(quanti) {
        const battute = copione(quanti);
        return battute[battute.length - 1].a;
    }

    // Dove siamo, al millisecondo `tMs` dall'inizio.
    //
    // Fuori dai due estremi non si ricomincia da capo: prima dell'inizio si sta
    // all'inizio, dopo la fine si è finita. Un orologio che scarta all'indietro
    // non deve far entrare due volte lo stesso pilota.
    function stato(copione, tMs) {
        const t = Math.max(0, tMs);
        const ultima = copione[copione.length - 1];
        if (t >= ultima.a) return { posto: 0, fase: 'finita', avanzamento: 1 };

        const battuta = copione.find(b => t < b.a) || ultima;
        const dentro = t - battuta.da;
        if (battuta.posto === 0) {
            return { posto: 0, fase: 'apoteosi', avanzamento: dentro / DURATE.apoteosi };
        }
        if (dentro < DURATE.arrivo) {
            return { posto: battuta.posto, fase: 'arrivo', avanzamento: dentro / DURATE.arrivo };
        }
        if (dentro < DURATE.arrivo + DURATE.salita) {
            return {
                posto: battuta.posto, fase: 'salita',
                avanzamento: (dentro - DURATE.arrivo) / DURATE.salita,
            };
        }
        return {
            posto: battuta.posto, fase: 'sosta',
            avanzamento: (dentro - DURATE.arrivo - DURATE.salita) / DURATE.sosta,
        };
    }

    return { DURATE, POSTI, copione, durataTotale, stato };
});
