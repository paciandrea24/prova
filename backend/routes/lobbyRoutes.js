const express = require('express');
const router = express.Router();
const { lobbies, users, generateLobbyId, creaGettone } = require('../store/lobbies');
const leaderboard = require('../store/leaderboard');
const { listTracks, saveTrack, deleteTrack } = require('../sockets/games/trackLoader');
const { COLORI, normalizzaColore } = require('../config/coloriGiocatore');
const { strumentiDiSviluppoAttivi } = require('../config/ambiente');
const { creaLimite } = require('../middleware/limiteRichieste');

// Gli identificativi di lobby li genera generateLobbyId(): sei caratteri fra
// cifre e lettere maiuscole. Chi ne manda uno di forma diversa non sta
// cercando una stanza esistente, e non ha senso farlo arrivare fino alla Map.
const ID_LOBBY = /^[A-Z0-9]{6}$/;

// Aprire stanze è l'unica operazione che fa CRESCERE lo stato in memoria senza
// che nessuno debba prima entrare da qualche parte: è il primo posto da cui il
// server si spegne da solo. Venti al minuto sono molte più di quante ne apra
// una persona vera.
const limiteCreazione = creaLimite({
    maxRichieste: 20,
    finestraMs: 60 * 1000,
    messaggio: 'Hai aperto troppe stanze di fila, aspetta un minuto'
});

// Le rotte che scrivono su disco (editor piste) restano chiuse quando il
// server è pubblico: rispondono 403 invece di 404, così se un giorno l'editor
// smette di funzionare online il motivo si legge nella risposta.
function soloStrumentiDiSviluppo(req, res, next) {
    if (strumentiDiSviluppoAttivi()) return next();
    res.status(403).json({ error: 'Editor piste disponibile solo in locale' });
}

// GET root
router.get('/', (req, res) => {
    res.json({ messaggio: 'Tutto ok da index!' });
});

// GET /api/colors — la tavolozza con cui ci si presenta in lobby.
// La pagina la chiede qui invece di tenerne una copia propria: il server
// rifiuta i colori che non sono in elenco, e due elenchi diversi vorrebbero
// dire un cerchietto che si può cliccare e che poi non funziona.
router.get('/api/colors', (req, res) => {
    res.json({ colors: COLORI });
});

// POST /create-lobby
router.post('/create-lobby', limiteCreazione, (req, res) => {
    const color = normalizzaColore((req.body || {}).color);
    if (!color) return res.status(400).json({ error: 'Colore non valido' });

    const lobbyId = generateLobbyId();
    const lobby = {
        id: lobbyId,
        host: color,
        players: [color],
        createdAt: new Date(),
        gameSettings: null
    };

    lobbies.set(lobbyId, lobby);
    users.set(color, lobbyId);

    // L'indirizzo porta solo il numero della stanza. Chi sei lo sa la scheda
    // del browser (sessionStorage, vedi frontend/shared/sessioneGiocatore.js)
    // e lo dimostra al server col gettone qui sotto.
    res.status(200).json({
        success: true,
        lobbyId,
        color,
        token: creaGettone(lobbyId, color),
        redirect: `/lobby.html?lobby=${lobbyId}`
    });
});

// GET /api/lobby/:id
router.get('/api/lobby/:id', (req, res) => {
    const lobby = lobbies.get(req.params.id);
    if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
    res.json(lobby);
});

// GET /api/lobby/:id/settings
// Le impostazioni della partita in corso, e SOLO quelle. Le pagine di gioco
// le chiedono qui invece di leggerle dall'indirizzo (vedi
// frontend/shared/impostazioniGara.js). Rotta dedicata e non /api/lobby/:id,
// che restituisce l'intero oggetto lobby: a chi deve disegnare una pista non
// serve sapere chi ospita, chi c'e' dentro o a che sessione siamo.
router.get('/api/lobby/:id/settings', (req, res) => {
    const lobby = lobbies.get(req.params.id);
    if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
    res.json({ settings: lobby.gameSettings || {} });
});

// POST /join-lobby
router.post('/join-lobby', (req, res) => {
    const { lobbyId } = req.body || {};
    const color = normalizzaColore((req.body || {}).color);

    if (!color) return res.status(400).json({ error: 'Colore non valido' });
    if (typeof lobbyId !== 'string' || !ID_LOBBY.test(lobbyId)) {
        return res.status(404).json({ error: 'Lobby not found' });
    }
    if (!lobbies.has(lobbyId)) {
        return res.status(404).json({ error: 'Lobby not found' });
    }

    const lobby = lobbies.get(lobbyId);

    if (lobby.players.includes(color)) {
        return res.status(400).json({ error: 'Color already taken in this lobby' });
    }

    lobby.players.push(color);
    users.set(color, lobbyId);

    res.json({ success: true, lobby, lobbyId, color, token: creaGettone(lobbyId, color) });
});

// GET /api/invite/:lobbyId
router.get('/api/invite/:lobbyId', (req, res) => {
    const lobbyId = req.params.lobbyId;

    if (!lobbies.has(lobbyId)) {
        return res.status(404).json({ error: 'Lobby not found' });
    }

    const inviteLink = `${req.protocol}://${req.get('host')}/index.html?join=${lobbyId}`;
    res.json({ inviteLink });
});

// ---------------------------------------------------------
// [NUOVO] API per ottenere i colori occupati in una lobby
// ---------------------------------------------------------
router.get('/api/lobby-colors/:lobbyId', (req, res) => {
    const { lobbyId } = req.params;
    const lobby = lobbies.get(lobbyId);

    if (!lobby) {
        // Se la lobby non esiste, restituiamo array vuoto o errore
        return res.status(404).json({ takenColors: [] });
    }

    // lobby.players è un array di stringhe colore es: ['#DC143C', '#4169E1']
    res.json({ takenColors: lobby.players });
});

// ---------------------------------------------------------
// [NUOVO] API per ottenere tutte le lobby pubbliche
// ---------------------------------------------------------
router.get('/api/lobbies', (req, res) => {
    const publicLobbies = [];

    // Iteriamo sulla Map delle lobby
    for (const [id, lobby] of lobbies.entries()) {
        publicLobbies.push({
            id: lobby.id,
            playersCount: lobby.players.length,
            // Puoi nascondere lobby piene se vuoi, per ora le mandiamo tutte
        });
    }

    res.json(publicLobbies);
});

// ---------------------------------------------------------
// API per ottenere tutta la Leaderboard Globale
// ---------------------------------------------------------
router.get('/api/leaderboard', (req, res) => {
    res.json(leaderboard.getAllRecords());
});

// ---------------------------------------------------------
// API per l'elenco delle piste F1 disponibili (per il menu in lobby)
// ---------------------------------------------------------
router.get('/api/f1/tracks', (req, res) => {
    res.json(listTracks());
});

// ---------------------------------------------------------
// API per salvare una pista disegnata nell'editor direttamente in
// frontend/tracks/, senza passare per il download manuale del file.
//
// Scrive un file sul disco del server: è uno strumento di sviluppo, e resta
// chiusa quando il server è pubblico. Senza quel controllo bastava una
// richiesta per riscrivere una pista esistente con qualunque contenuto, e una
// DELETE dentro un ciclo per cancellarle quasi tutte.
// ---------------------------------------------------------
router.post('/api/f1/tracks', soloStrumentiDiSviluppo, (req, res) => {
    try {
        const id = saveTrack(req.body);
        res.json({ success: true, id });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ---------------------------------------------------------
// API per eliminare una pista salvata (dall'editor, dev-only)
// ---------------------------------------------------------
router.delete('/api/f1/tracks/:id', soloStrumentiDiSviluppo, (req, res) => {
    try {
        deleteTrack(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
