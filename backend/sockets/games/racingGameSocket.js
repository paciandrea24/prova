const { activeGames } = require('../../store/activeGames');
const { lobbies } = require('../../store/lobbies');
const { initializeRacingGame, startRace, updatePlayerInput, restartRace } = require('../../game/racingGame');
const leaderboard = require('../../store/leaderboard');

module.exports = function (io, socket) {

    // --- NUOVO: Ascolta quando l'host clicca "Start Game" ---
    socket.on('startGame', (data) => {
        const { lobbyId, gameId, settings } = data;

        // Se il gioco selezionato è 'racing', procediamo!
        if (gameId === 'racing') {
            console.log(`🎮 StartGame ricevuto per Racing in lobby ${lobbyId}`);

            const lobby = lobbies.get(lobbyId);
            if (lobby) {
                lobby.gameSettings = settings; // Salva le impostazioni (es. difficoltà)
            }

            // Invia l'evento a tutti per farli reindirizzare alla pagina corretta
            io.to(lobbyId).emit('gameSelected', { gameId, settings });
        }
    });
    // --------------------------------------------------------

    socket.on('joinRacing', (data) => {
        const { lobbyId, playerColor } = data;
        const lobby = lobbies.get(lobbyId);

        if (!lobby) return;

        if (!activeGames.has(lobbyId)) {
            initializeRacingGame(lobbyId, lobby.players, lobby.gameSettings || {});
        }

        const game = activeGames.get(lobbyId);

        // --- NUOVO: Prendiamo la mappa attuale dal Campionato ---
        const currentTrack = game.tracks[game.currentTrackIndex];

        // Invia setup iniziale dell'arena con i dati della matrice!
        socket.emit('racingSetup', {
            playersState: game.playersState,
            trackMap: currentTrack.map,
            tileSize: game.tileSize,
            trackName: currentTrack.name,
            hostColor: lobby.host
        });

        // Se sei l'host, fai partire il countdown
        if (playerColor === lobby.host) {
            io.to(lobbyId).emit('message', { message: 'La gara inizierà tra 3 secondi...', type: 'system' });
            setTimeout(() => {
                startRace(io, lobbyId);
            }, 3000);
        }
    });

    // --- RICEZIONE NUOVO RECORD DAL FRONTEND ---
    socket.on('saveNewRecord', (data) => {
        const { lobbyId, trackName, playerName, playerColor, time } = data;

        // Passa i dati al nostro "cervello" che li salva nel file JSON!
        leaderboard.addRecord(trackName, playerName, playerColor, time);

        // Annuncia a tutta la lobby l'avvenuta archiviazione
        io.to(lobbyId).emit('message', {
            message: `🌟 La leggenda [${playerName}] ha scritto il suo nome nella storia di ${trackName}!`,
            type: 'success'
        });
    });

    socket.on('racingInput', (data) => {
        const { lobbyId, playerColor, inputs } = data;
        updatePlayerInput(lobbyId, playerColor, inputs);
    });

    // NUOVI EVENTI PER LA MODALITÀ SINGOLA
    socket.on('restartRace', (lobbyId) => {
        restartRace(io, lobbyId);
    });

    socket.on('forceReturnToLobby', (lobbyId) => {
        activeGames.delete(lobbyId);
        io.to(lobbyId).emit('returnToLobby');
    });
};