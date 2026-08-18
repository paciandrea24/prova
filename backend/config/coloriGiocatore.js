// backend/config/coloriGiocatore.js
//
// I dodici colori con cui ci si può presentare in una lobby. Il colore non è
// un dettaglio estetico: è il nome pubblico del giocatore (compare nella
// lista, nella chat, sulle auto e nei record della classifica), quindi è un
// dato che entra ovunque e va deciso QUI, non da chi lo manda.
//
// Prima questa lista esisteva solo dentro frontend/index.js e il server
// accettava qualunque stringa arrivasse come `color`. Bastava saltare la
// pagina e chiamare /create-lobby a mano per farsi un colore fatto di codice
// HTML, che finiva dritto nel riquadro della classifica globale — quella sì
// scritta su MongoDB e vista da tutti.
const COLORI = [
    '#E74C3C', '#3498DB', '#2ECC71', '#F1C40F',
    '#9B59B6', '#E67E22', '#00BCD4', '#FF4081',
    '#795548', '#CDDC39', '#4B0082', '#455A64'
];

const INSIEME = new Set(COLORI);

// Accetta il colore solo se è uno dei dodici, e lo restituisce sempre nella
// stessa forma (maiuscola): `#e74c3c` e `#E74C3C` sono lo stesso giocatore, e
// due grafie diverse dello stesso colore vorrebbero dire due posti in lobby.
function normalizzaColore(valore) {
    if (typeof valore !== 'string') return null;
    const c = valore.trim().toUpperCase();
    return INSIEME.has(c) ? c : null;
}

module.exports = { COLORI, normalizzaColore };
