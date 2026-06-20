// backend/sockets/games/kartGameSocket.js
const { lobbies } = require('../../store/lobbies');

const players = {};

// LEGENDA MAPPA INDIPENDENTE KART 3D:
// 0 = Asfalto (Strada percorribile)
// 1 = Erba (Percorribile, ma fuori pista)
// 2 = Muri / Ostacoli (Collisione attiva)
const customKartTrack = [
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
    [2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2],
    [2, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 2],
    [2, 1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 0, 1, 1, 2],
    [2, 1, 0, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 0, 1, 1, 2],
    [2, 1, 0, 1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 1, 0, 1, 1, 2],
    [2, 1, 0, 1, 2, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 2, 1, 0, 1, 1, 2],
    [2, 1, 0, 1, 2, 1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 0, 1, 2, 1, 0, 1, 1, 2],
    [2, 1, 0, 1, 1, 1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 0, 1, 1, 1, 0, 1, 1, 2],
    [2, 1, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 0, 0, 0, 0, 0, 1, 1, 2],
    [2, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 2],
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]
];

module.exports = function (io, socket) {

    socket.on('startGame', (data) => {
        const { lobbyId, gameId, settings } = data;

        if (gameId === 'kart') {
            console.log(`🏎️ StartGame ricevuto per Kart 3D in lobby ${lobbyId}`);
            const lobby = lobbies.get(lobbyId);
            if (lobby) {
                lobby.gameSettings = settings;
            }
            io.to(lobbyId).emit('gameSelected', { gameId, settings });
        }
    });

    socket.on('joinKartGame', (lobbyId) => {
        socket.join(lobbyId);

        players[socket.id] = {
            id: socket.id,
            x: 0,
            y: 0.5,
            z: 0,
            rotationY: 0,
            color: Math.random() * 0xffffff
        };

        const setupData = {
            trackMap: customKartTrack,
            players: players,
            // Facciamo spawnare il giocatore nella strada in alto a sinistra!
            spawn: { x: -80, z: -40 }
        };

        socket.emit('kartSetup', setupData);
        socket.to(lobbyId).emit('newPlayer', players[socket.id]);
    });

    socket.on('kartMovement', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].z = data.z;
            players[socket.id].rotationY = data.rotationY;

            socket.to(data.lobbyId).emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            delete players[socket.id];
            io.emit('playerDisconnected', socket.id);
        }
    });
};