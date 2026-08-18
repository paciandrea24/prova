// frontend/shared/sessioneGiocatore.js
//
// Chi sono io in questa stanza: il colore con cui mi presento, il gioco che
// sto per aprire e il gettone che dimostra al server che quel colore è
// davvero mio.
//
// Prima tutto questo stava nell'indirizzo della pagina:
// `/lobby.html?lobby=K3QC48&color=%23E74C3C&game=f1`. Tre problemi, in ordine
// di gravità crescente:
//
//   1. Ingombra. Dopo aver tolto le impostazioni dall'URL (vedi
//      shared/impostazioniGara.js) restava comunque una barra dell'indirizzo
//      illeggibile, ed è la prima cosa che si copia per invitare qualcuno.
//   2. Copiando quell'indirizzo si regala anche il proprio colore: chi lo
//      apriva entrava in lobby *come te*, non accanto a te.
//   3. Il colore ERA l'identità, e stava dove chiunque poteva riscriverlo.
//      Il server si fidava del colore che gli arrivava nei messaggi, quindi
//      bastava rispedirgli quello dell'host per espellere gli altri o
//      prendersi la stanza.
//
// Ora nell'indirizzo resta `?lobby=K3QC48`, che è l'unica cosa che descriva
// una risorsa condivisibile: *quale* stanza. Il resto vive in sessionStorage,
// che è per SCHEDA: due schede sullo stesso computer restano due giocatori
// diversi, che è esattamente come si prova il multigiocatore in locale.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SessioneGiocatore = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const CHIAVE = 'sessioneGiocatore';

    function magazzino() {
        try {
            return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
        } catch (e) {
            // Safari in navigazione privata e alcune configurazioni aziendali
            // fanno lanciare il solo ACCESSO a sessionStorage. Meglio nessuna
            // sessione che una pagina bianca.
            return null;
        }
    }

    /**
     * Registra chi sono, appena il server me lo ha detto.
     * @param {{lobbyId: string, color: string, token: string, gameId?: string}} dati
     */
    function salva(dati) {
        const m = magazzino();
        if (!m || !dati || !dati.lobbyId || !dati.color) return;
        try {
            m.setItem(CHIAVE, JSON.stringify({
                lobbyId: dati.lobbyId,
                color: dati.color,
                token: dati.token || null,
                gameId: dati.gameId || null
            }));
        } catch (e) { /* quota piena: si ricadrà sul rientro dalla home */ }
    }

    /**
     * La sessione di QUESTA lobby, o null.
     *
     * Il confronto con `lobbyId` non è un dettaglio: senza, chi apre il link
     * di una stanza nuova nella stessa scheda si porterebbe dietro il colore
     * della stanza vecchia — dove magari quel colore è di qualcun altro.
     *
     * @param {string} lobbyId
     */
    function leggi(lobbyId) {
        const m = magazzino();
        if (!m) return null;
        let dati;
        try {
            dati = JSON.parse(m.getItem(CHIAVE) || 'null');
        } catch (e) {
            return null;
        }
        if (!dati || !dati.color) return null;
        if (lobbyId && dati.lobbyId !== lobbyId) return null;
        return dati;
    }

    /** Cambia un pezzo della sessione lasciando il resto com'è. */
    function aggiorna(patch) {
        const attuale = leggi(null);
        if (!attuale) return;
        salva(Object.assign({}, attuale, patch));
    }

    function dimentica() {
        const m = magazzino();
        if (m) { try { m.removeItem(CHIAVE); } catch (e) { /* niente da fare */ } }
    }

    /**
     * Sessione della lobby scritta nell'indirizzo, oppure rimando alla home.
     *
     * È il primo gesto di ogni pagina che presuppone un giocatore: la lobby e
     * tutti i giochi. Chi arriva senza sessione (il link condiviso aperto da
     * un amico, una scheda nuova) non viene lasciato su una pagina rotta ma
     * mandato a scegliersi un colore per QUELLA stanza.
     *
     * @returns {{lobbyId: string, color: string, token: string|null, gameId: string|null}|null}
     */
    function richiedi() {
        const lobbyId = new URLSearchParams(window.location.search).get('lobby');
        if (!lobbyId) {
            window.location.href = '/';
            return null;
        }
        const sessione = leggi(lobbyId);
        if (!sessione) {
            window.location.href = '/index.html?join=' + encodeURIComponent(lobbyId);
            return null;
        }
        return sessione;
    }

    return { salva, leggi, aggiorna, dimentica, richiedi, CHIAVE };
});
