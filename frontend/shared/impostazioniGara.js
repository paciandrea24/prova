// frontend/shared/impostazioniGara.js
//
// Le impostazioni di una partita si chiedono al SERVER, non si leggono
// dall'indirizzo.
//
// Prima viaggiavano dentro l'URL come JSON: la lobby costruiva
// `?lobby=…&color=…&game=…&settings=%7B%22trackId%22%3A…`. Tre problemi, in
// ordine di gravità crescente:
//
//   1. Lunghezza. Un indirizzo ha un tetto (~2000 caratteri sui browser più
//      stretti) e le impostazioni crescono ad ogni opzione aggiunta. Con le
//      stagioni — un calendario di piste dentro le impostazioni — ci si
//      arrivava davvero.
//   2. Sono in chiaro e ingombrano la barra dell'indirizzo, che è la prima
//      cosa che si copia e si incolla per invitare qualcuno.
//   3. Chiunque può riscriverle. E il server NON le rilegge da lì: usa la
//      propria copia in `lobby.gameSettings`. Cioè client e server potevano
//      credere a due configurazioni diverse — ed è esattamente la famiglia di
//      difetti che è costata tre giri di playtest il 2026-08-18, con il
//      client che caricava una pista e il server che ne simulava un'altra.
//
// Con una sola fonte quel disallineamento non è più esprimibile.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ImpostazioniGara = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    /**
     * Impostazioni della partita in corso in quella lobby.
     *
     * Non fallisce mai: se la lobby non c'è o la rete va storta restituisce
     * un oggetto vuoto, e ogni gioco applica i propri valori di riferimento.
     * Un errore qui bloccherebbe l'avvio della partita per un dato che serve
     * solo a disegnare.
     *
     * @param {string} lobbyId
     * @returns {Promise<object>}
     */
    function carica(lobbyId) {
        if (!lobbyId) return Promise.resolve({});
        return fetch(`/api/lobby/${encodeURIComponent(lobbyId)}/settings`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => (d && d.settings) || {})
            .catch(() => ({}));
    }

    return { carica };
});
