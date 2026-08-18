// backend/config/ambiente.js
//
// Un solo posto che risponde alla domanda "sto girando sul portatile o davanti
// al pubblico?", perché da quella risposta dipende se restano aperte rotte che
// scrivono file sul disco del server (editor piste, minimappa, segnalazioni).
//
// La regola è invertita rispetto a com'era: prima gli strumenti erano ACCESI e
// si spegnevano se `NODE_ENV === 'production'`. Basta dimenticare quella
// variabile — e su Render non c'è a meno di metterla a mano — perché un
// server pubblico si ritrovi l'editor piste aperto a chiunque. Ora sono SPENTI
// e si accendono solo quando è evidente che siamo in locale.
//
// `RENDER` la mette Render stessa in ogni servizio: è la prova più solida che
// abbiamo di non essere sul portatile.

function inProduzione() {
    return process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
}

// L'interruttore esplicito serve a chi vuole usare l'editor piste su una copia
// di prova ospitata online: si accende mettendo STRUMENTI_SVILUPPO=on fra le
// variabili d'ambiente, e la scelta è di chi amministra quel server.
function strumentiDiSviluppoAttivi() {
    if (process.env.STRUMENTI_SVILUPPO === 'on') return true;
    return !inProduzione();
}

module.exports = { inProduzione, strumentiDiSviluppoAttivi };
