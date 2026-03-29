const { lobbies } = require('../../store/lobbies');
const { activeGames } = require('../../store/activeGames');
const { initializeGame, processMovement, processKill } = require('../../game/deductionGame');

const GAME_ID = 'deduction';

module.exports = function (io, socket) {

    socket.on('joinGame', (data) => {
        const { lobbyId, gameId, playerColor } = data;
        if (gameId !== GAME_ID) return;

        console.log(`🔪 Player ${playerColor} joined DEDUCTION in lobby ${lobbyId}`);
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        const game = activeGames.get(lobbyId);
        if (game && (game.gameId === GAME_ID || game.type === GAME_ID)) {
            const player = game.playersState[playerColor];
            if (player) {
                // 1. Unisciti alla lobby globale per ricevere gli eventi di fine timer e fine partita
                socket.join(lobbyId);
                // 2. Unisciti alla sub-room per ricevere solo i movimenti di chi è nella tua stanza
                socket.join(`${lobbyId}_${player.room}`);

                // 3. Invia i dati iniziali, includendo la fase attuale!
                socket.emit('initData', {
                    isImpostor: player.isImpostor,
                    myColor: playerColor,
                    room: player.room,
                    x: player.x,
                    y: player.y,
                    phase: game.phase // <-- AGGIUNTA FONDAMENTALE
                });
            }
        }
    });

    socket.on('startGame', (data) => {
        const { lobbyId, gameId, settings } = data;
        if (gameId !== GAME_ID) return;

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        // Inizializza la logica autoritativa
        initializeGame(io, lobbyId, lobby.players, settings);

        io.to(lobbyId).emit('gameSelected', { gameId, settings });
    });

    socket.on('playerMove', (data) => {
        const { lobbyId, playerColor, x, y, facing } = data;
        processMovement(io, socket, lobbyId, playerColor, x, y, facing);
    });

    socket.on('attemptKill', (data) => {
        const { lobbyId, playerColor } = data;
        processKill(io, lobbyId, playerColor);
    });
};