const { activeGames } = require('../../store/activeGames');
const { lobbies } = require('../../store/lobbies');
const { initializeRacingGame, startRace, updatePlayerInput } = require('../../game/racingGame');

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

        // Invia setup iniziale dell'arena
        socket.emit('racingSetup', {
            playersState: game.playersState,
            trackWidth: game.trackWidth,
            trackHeight: game.trackHeight,
            finishLineX: game.finishLineX
        });

        // Se sei l'host, fai partire il countdown
        if (playerColor === lobby.host) {
            io.to(lobbyId).emit('message', { message: 'La gara inizierà tra 3 secondi...', type: 'system' });
            setTimeout(() => {
                startRace(io, lobbyId);
            }, 3000);
        }
    });

    socket.on('racingInput', (data) => {
        const { lobbyId, playerColor, inputs } = data;
        updatePlayerInput(lobbyId, playerColor, inputs);
    });
};