// backend/middleware/limiteRichieste.js
//
// Un limitatore di frequenza minimo, in memoria, senza dipendenze nuove
// (vincolo del progetto: niente pacchetti che richiedano build native, deve
// girare su Render così com'è).
//
// A cosa serve: le lobby vivono in una Map che nessuno svuota finché qualcuno
// non ci entra e ne esce. Un ciclo di poche righe che chiama /create-lobby
// riempie quella Map fino a far cadere il processo, e non serve essere
// esperti di niente per scriverlo. Stessa storia per la chat, che rimbalza
// ogni messaggio a tutti quelli nella stanza.
//
// Non è un firewall e non pretende di esserlo: è la differenza fra "chiunque
// passi di qui può spegnere il server per noia" e "bisogna volerlo davvero".

// Finestra scorrevole per chiave: ricordiamo i tempi delle richieste recenti e
// buttiamo via quelle uscite dalla finestra. Con soglie da poche decine di
// eventi la lista resta corta e il costo è trascurabile.
function creaLimite({ maxRichieste, finestraMs, messaggio }) {
    const storico = new Map();

    // Pulizia periodica: senza, la Map si riempirebbe di indirizzi visti una
    // volta sola e mai più. unref() perché un timer non deve tenere in vita
    // il processo (altrimenti i test con node:test non terminano mai).
    const pulizia = setInterval(() => {
        const limite = Date.now() - finestraMs;
        for (const [chiave, tempi] of storico) {
            const vivi = tempi.filter((t) => t > limite);
            if (vivi.length === 0) storico.delete(chiave);
            else storico.set(chiave, vivi);
        }
    }, finestraMs);
    if (typeof pulizia.unref === 'function') pulizia.unref();

    function consenti(chiave) {
        const ora = Date.now();
        const limite = ora - finestraMs;
        const tempi = (storico.get(chiave) || []).filter((t) => t > limite);
        if (tempi.length >= maxRichieste) {
            storico.set(chiave, tempi);
            return false;
        }
        tempi.push(ora);
        storico.set(chiave, tempi);
        return true;
    }

    // Uso come middleware Express.
    function middleware(req, res, next) {
        if (consenti(req.ip || 'sconosciuto')) return next();
        res.status(429).json({ error: messaggio || 'Troppe richieste, riprova fra poco' });
    }

    middleware.consenti = consenti;
    return middleware;
}

module.exports = { creaLimite };
