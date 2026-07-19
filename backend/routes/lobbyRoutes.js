const express = require('express');
const router = express.Router();
const { lobbies, users, generateLobbyId } = require('../store/lobbies');
const leaderboard = require('../store/leaderboard');
const { listTracks } = require('../sockets/games/trackLoader');

// GET root
router.get('/', (req, res) => {
    res.json({ messaggio: 'Tutto ok da index!' });
});

// POST /create-lobby
router.post('/create-lobby', (req, res) => {
    const { color } = req.body;
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

    res.status(200).json({
        success: true,
        redirect: `/lobby.html?lobby=${lobbyId}&color=${color}`
    });
});

// GET /api/lobby/:id
router.get('/api/lobby/:id', (req, res) => {
    const lobby = lobbies.get(req.params.id);
    if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
    res.json(lobby);
});

// POST /join-lobby
router.post('/join-lobby', (req, res) => {
    const { color, lobbyId } = req.body;

    if (!lobbies.has(lobbyId)) {
        return res.status(404).json({ error: 'Lobby not found' });
    }

    const lobby = lobbies.get(lobbyId);

    if (lobby.players.includes(color)) {
        return res.status(400).json({ error: 'Color already taken in this lobby' });
    }

    lobby.players.push(color);
    users.set(color, lobbyId);

    res.json({ success: true, lobby });
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

module.exports = router;