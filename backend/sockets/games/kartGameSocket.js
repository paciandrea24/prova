// backend/sockets/games/kartGameSocket.js
const { lobbies } = require('../../store/lobbies');
// Importiamo i tracciati dal tuo gioco racing!
const { monzaLevel1_Top, monzaLevel1_Bottom } = require('../../game/racingGame'); // Assicurati che il percorso sia corretto.

const players = {};

// Per semplicità, creiamo un array di piste come hai fatto nel racing.
const kartTracks = [
    {
        name: 'Monza',
        map: monzaLevel1_Top,
        tileSize: 40,
        spawnX: 420,
        spawnY: 100,
        angle: 0
    }
    // Puoi aggiungere le altre piste in seguito
];

module.exports = function (io, socket) {

    // --- 1. GESTIONE AVVIO DALLA LOBBY ---
    socket.on('startGame', (data) => {
        const { lobbyId, gameId, settings } = data;

        if (gameId === 'kart') {
            console.log(`🏎️ StartGame ricevuto per Kart 3D in lobby ${lobbyId}`);

            const lobby = lobbies.get(lobbyId);
            if (lobby) {
                lobby.gameSettings = settings;
            }

            // Inviamo i dati del primo tracciato al client.
            const trackData = kartTracks[0];

            io.to(lobbyId).emit('gameSelected', {
                gameId,
                settings,
                trackData: trackData // Aggiungiamo i dati della pista
            });
        }
    });

    // --- INIZIO LOGICA DEL MOVIMENTO E SETUP 3D ---
    socket.on('joinKartGame', (lobbyId) => {
        socket.join(lobbyId);

        // Debug: controlliamo se la mappa esiste davvero qui
        console.log("Stato di monzaLevel1_Top:", typeof monzaLevel1_Top);

        players[socket.id] = {
            id: socket.id,
            x: 0,
            y: 0.5,
            z: 0,
            rotationY: 0,
            color: Math.random() * 0xffffff
        };

        const setupData = {
            trackMap: monzaLevel1_Top, // Assicurati che l'import in alto sia corretto
            players: players,
            spawn: { x: 0, z: 0 }
        };

        console.log("Invio dati setup. Mappa ha righe:", setupData.trackMap ? setupData.trackMap.length : "ERRORE - NULLA");

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