const { lobbies } = require('../../store/lobbies');
const { activeGames } = require('../../store/activeGames');
const {
    getDefaultGameSettings,
    initializeGame,
    startNewTurn,
    processGuess
} = require('../../game/bombGame');

const GAME_ID = 'bomb';

module.exports = function (io, socket) {

    socket.on('joinGame', (data) => {
        const { lobbyId, gameId, playerColor } = data;
        if (gameId && gameId !== GAME_ID) return;

        console.log(`💣 Player ${playerColor} joined BOMB game in lobby ${lobbyId}`);
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        if (activeGames.has(lobbyId)) {
            const game = activeGames.get(lobbyId);
            if (game.gameId !== GAME_ID && game.type !== GAME_ID) return;

            // Invia lo stato attuale a chi si ricollega
            socket.emit('gameState', {
                players: game.players,
                activePlayers: game.activePlayers,
                lives: game.lives,
                currentTurn: game.currentTurn,
                syllable: game.currentSyllable,
                timer: game.timer,
                isActive: game.isActive
            });
        }
    });

    socket.on('startGame', (data) => {
        const { lobbyId, gameId, settings } = data;
        if (gameId && gameId !== GAME_ID) return;

        console.log(`💣 Avvio Passa la Bomba per lobby ${lobbyId}`);
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        const gameSettings = settings || getDefaultGameSettings(GAME_ID);
        initializeGame(lobbyId, lobby.players, GAME_ID, gameSettings);

        io.to(lobbyId).emit('gameSelected', { gameId, settings: gameSettings });
        io.to(lobbyId).emit('message', { message: 'Il gioco Passa la Bomba sta per iniziare!', type: 'system' });

        setTimeout(() => {
            startNewTurn(io, lobbyId);
        }, 3000);
    });

    socket.on('guessWord', (data) => {
        const { lobbyId, playerColor, word } = data;
        const result = processGuess(io, lobbyId, playerColor, word);

        if (!result.success) {
            // Se la parola è sbagliata, manda un feedback visivo solo a chi l'ha scritta
            socket.emit('wrongWord', { message: result.message });
        }
    });
};