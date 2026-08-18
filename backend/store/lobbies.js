const crypto = require('crypto');

const lobbies = new Map();
const users = new Map();
const destroyTimers = new Map(); // timer di distruzione lobby condivisi tra socketManager e game sockets

// Gettoni di sessione: lobbyId -> Map(colore -> gettone).
//
// Prima di questa mappa l'identità di un giocatore ERA il suo colore, e il
// colore viaggiava in chiaro nell'indirizzo della pagina. Chiunque poteva
// quindi dichiararsi chiunque: bastava leggere l'host da GET /api/lobby/:id
// (o dall'evento lobbyUpdated, che lo manda a tutti) e rispedirlo dentro
// `kickPlayer` o `transferHost` per espellere qualcuno o prendersi la stanza.
//
// Ora il colore resta il nome pubblico del giocatore — continua a comparire
// nella lista, nella chat e sulle auto — ma per DIMOSTRARE di essere quel
// colore serve il gettone, che il server consegna una volta sola a chi crea o
// entra nella lobby e non compare da nessuna parte se non nella scheda di chi
// l'ha ricevuto.
//
// Vive in memoria come tutto il resto dello stato (nessun DB, vedi CLAUDE.md)
// e muore con la lobby.
const gettoni = new Map();

function generateLobbyId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Consegna (e sostituisce) il gettone di un colore in una lobby.
function creaGettone(lobbyId, color) {
    if (!gettoni.has(lobbyId)) gettoni.set(lobbyId, new Map());
    const gettone = crypto.randomBytes(24).toString('hex');
    gettoni.get(lobbyId).set(color, gettone);
    return gettone;
}

// Il confronto è a tempo costante: `crypto.timingSafeEqual` invece di `===`.
// Su una stringa di 48 caratteri esadecimali la differenza è teorica, ma è la
// stessa riga di codice e toglie di mezzo la domanda.
function verificaGettone(lobbyId, color, gettone) {
    if (typeof color !== 'string' || typeof gettone !== 'string') return false;
    const perLobby = gettoni.get(lobbyId);
    if (!perLobby) return false;
    const atteso = perLobby.get(color);
    if (typeof atteso !== 'string' || atteso.length !== gettone.length) return false;
    return crypto.timingSafeEqual(Buffer.from(atteso), Buffer.from(gettone));
}

function dimenticaGiocatore(lobbyId, color) {
    const perLobby = gettoni.get(lobbyId);
    if (perLobby) perLobby.delete(color);
}

function dimenticaLobby(lobbyId) {
    gettoni.delete(lobbyId);
}

module.exports = {
    lobbies, users, generateLobbyId, destroyTimers,
    creaGettone, verificaGettone, dimenticaGiocatore, dimenticaLobby
};
