// backend/sockets/games/playgroundGameSocket.js
// Relay puro delle posizioni delle sfere nel playground della lobby.
// Nessuna fisica lato server: ogni client simula la propria sfera.

const playgroundRooms = {}; // { [lobbyId]: { players: { [socketId]: {id, color, x, z} } } }

function removePlayer(socketId, lobbyId, io) {
    const room = playgroundRooms[lobbyId];
    if (!room) return;
    delete room.players[socketId];
    io.to(lobbyId).emit('playgroundPlayerLeft', socketId);
    // Pulizia room vuota
    if (Object.keys(room.players).length === 0) {
        delete playgroundRooms[lobbyId];
    }
}

module.exports = function (io, socket) {

    // Un giocatore entra nel playground
    socket.on('playgroundJoin', ({ lobbyId }) => {
        if (!playgroundRooms[lobbyId]) {
            playgroundRooms[lobbyId] = { players: {} };
        }
        const room = playgroundRooms[lobbyId];

        // Spawn casuale nell'arena (half-size 24)
        const x = (Math.random() * 2 - 1) * 18;
        const z = (Math.random() * 2 - 1) * 18;

        const player = {
            id: socket.id,
            color: socket.color || '#3498DB',
            x,
            z
        };
        room.players[socket.id] = player;

        // Manda lo stato completo al nuovo arrivato
        socket.emit('playgroundState', { players: room.players, myId: socket.id });

        // Avvisa gli altri del nuovo arrivato
        socket.to(lobbyId).emit('playgroundPlayerJoined', player);
    });

    // Aggiornamento posizione (relay puro)
    socket.on('playgroundMove', ({ lobbyId, x, z }) => {
        const room = playgroundRooms[lobbyId];
        if (!room || !room.players[socket.id]) return;
        room.players[socket.id].x = x;
        room.players[socket.id].z = z;
        socket.to(lobbyId).emit('playgroundPlayerMoved', { id: socket.id, x, z });
    });

    // Relay collisione: il client che ha colpito notifica il client colpito
    // così anche lui può applicare l'impulso alla propria sfera
    socket.on('playgroundCollision', ({ lobbyId, targetId, nx, nz }) => {
        socket.to(lobbyId).emit('playgroundCollisionHit', { targetId, nx, nz });
    });

    // Il giocatore esce volontariamente dal playground
    socket.on('leavePlayground', ({ lobbyId }) => {
        removePlayer(socket.id, lobbyId, io);
    });

    // Disconnessione: rimuovi da tutte le room in cui questo socket era presente
    socket.on('disconnect', () => {
        for (const lobbyId in playgroundRooms) {
            if (playgroundRooms[lobbyId].players[socket.id]) {
                removePlayer(socket.id, lobbyId, io);
            }
        }
    });
};
