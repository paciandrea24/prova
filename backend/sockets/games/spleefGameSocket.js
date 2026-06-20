// backend/sockets/games/spleefGameSocket.js
const { lobbies } = require('../../store/lobbies');

const BLOCK_SIZE = 3;

function generateSpleefMap(size = 20) {
    return Array(size).fill().map(() => Array(size).fill(1));
}

const activeSpleefGames = {};

module.exports = function (io, socket) {
    socket.on('startGame', (data) => {
        const { lobbyId, gameId, settings } = data;
        if (gameId === 'spleef') {
            const mapSize = settings && settings.mapSize ? parseInt(settings.mapSize) : 20;

            activeSpleefGames[lobbyId] = {
                mapSize: mapSize,
                map: generateSpleefMap(mapSize),
                players: {},
                isGameOver: false // Tracciamo lo stato della partita
            };
            io.to(lobbyId).emit('gameSelected', { gameId, settings });
        }
    });

    socket.on('joinSpleefGame', (lobbyId) => {
        socket.join(lobbyId);
        const game = activeSpleefGames[lobbyId];
        if (!game) return;

        const lobby = lobbies.get(lobbyId);
        let playerColor = socket.color || '#3498DB';
        const isHost = lobby && lobby.host === playerColor;

        const mapLength = game.map.length;
        const centerSpawn = Math.floor(mapLength / 2) * BLOCK_SIZE;

        game.players[socket.id] = {
            id: socket.id,
            x: centerSpawn + (Math.random() * 4 - 2),
            y: 2,
            z: centerSpawn + (Math.random() * 4 - 2),
            color: playerColor,
            isAlive: true // <-- Segniamo il giocatore come VIVO alla partenza
        };

        socket.emit('spleefSetup', {
            mapData: game.map,
            players: game.players,
            myId: socket.id,
            isHost: isHost // Passiamo l'info se è l'Host
        });

        socket.to(lobbyId).emit('newPlayer', game.players[socket.id]);
    });

    socket.on('spleefMovement', (data) => {
        const game = activeSpleefGames[data.lobbyId];
        if (game && game.players[socket.id] && game.players[socket.id].isAlive) {
            game.players[socket.id].x = data.x;
            game.players[socket.id].y = data.y;
            game.players[socket.id].z = data.z;
            socket.to(data.lobbyId).emit('playerMoved', game.players[socket.id]);
        }
    });

    socket.on('breakBlock', (data) => {
        const { lobbyId, row, col } = data;
        const game = activeSpleefGames[lobbyId];
        const player = game?.players[socket.id];

        if (game && !game.isGameOver && player && game.map[row] && game.map[row][col] === 1) {
            const playerCol = Math.round(player.x / BLOCK_SIZE);
            const playerRow = Math.round(player.z / BLOCK_SIZE);
            if (Math.abs(playerCol - col) <= 2 && Math.abs(playerRow - row) <= 2) {
                game.map[row][col] = 0;
                io.to(lobbyId).emit('blockBroken', { row, col });
            }
        }
    });

    // Quando un giocatore cade...
    socket.on('playerDied', (lobbyId) => {
        const game = activeSpleefGames[lobbyId];
        if (!game || game.isGameOver) return;

        if (game.players[socket.id]) {
            game.players[socket.id].isAlive = false; // È MORTO!
        }

        io.to(lobbyId).emit('playerDisconnected', socket.id); // Lo fa sparire dagli schermi
        io.to(lobbyId).emit('message', { message: 'Un giocatore è caduto nel vuoto!', type: 'system' });

        // CONTROLLO VITTORIA
        const alivePlayers = Object.values(game.players).filter(p => p.isAlive);
        const totalPlayers = Object.keys(game.players).length;

        // Se giocano in più persone e ne resta vivo solo 1 -> VITTORIA
        if (totalPlayers > 1 && alivePlayers.length === 1) {
            game.isGameOver = true;
            io.to(lobbyId).emit('gameOver', { winner: alivePlayers[0] });
        }
        // Se gioca 1 sola persona da sola (test), oppure per lag cadono gli ultimi 2 assieme -> GAME OVER
        else if (alivePlayers.length === 0) {
            game.isGameOver = true;
            io.to(lobbyId).emit('gameOver', { winner: null });
        }
    });

    // Riavvio della partita!
    socket.on('restartSpleef', (lobbyId) => {
        const game = activeSpleefGames[lobbyId];
        if (!game) return;

        game.isGameOver = false;
        game.map = generateSpleefMap(game.mapSize || 20); // Rigenera neve nuova

        const mapLength = game.map.length;
        const centerSpawn = Math.floor(mapLength / 2) * BLOCK_SIZE;

        // Riporta tutti in vita e al centro
        for (let id in game.players) {
            game.players[id].isAlive = true;
            game.players[id].x = centerSpawn + (Math.random() * 4 - 2);
            game.players[id].y = 2;
            game.players[id].z = centerSpawn + (Math.random() * 4 - 2);
        }

        // Avvisa tutti di ricostruire la mappa
        io.to(lobbyId).emit('spleefRestarted', {
            mapData: game.map,
            players: game.players
        });
    });

    socket.on('disconnect', () => {
        for (const lobbyId in activeSpleefGames) {
            if (activeSpleefGames[lobbyId].players[socket.id]) {
                delete activeSpleefGames[lobbyId].players[socket.id];
                io.to(lobbyId).emit('playerDisconnected', socket.id);
            }
        }
    });
};