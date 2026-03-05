// sockets/socketManager.js
const drawingGameSocket = require('./games/drawingGameSocket');
const triviaGameSocket = require('./games/triviaGameSocket');
const chatSocket = require('./chatSocket');
const racingGameSocket = require('./games/racingGameSocket');

// IMPORTANTE: Importiamo lo store delle lobby per poterle modificare
const { lobbies, users } = require('../store/lobbies');

module.exports = function (io) {
    io.on('connection', (socket) => {
        console.log(`🔌 Utente connesso: ${socket.id}`);

        socket.on('joinLobby', (lobbyId) => {
            socket.join(lobbyId);
            console.log(`🏠 Utente ${socket.id} è entrato nella lobby: ${lobbyId}`);
        });

        // NUOVO EVENTO: Gestione espulsione giocatore
        socket.on('kickPlayer', (data) => {
            const { lobbyId, hostColor, targetColor } = data;
            const lobby = lobbies.get(lobbyId);

            // Verifica di sicurezza: la lobby esiste e chi richiede il kick è davvero l'host?
            if (lobby && lobby.host === hostColor) {
                // Rimuove il giocatore dall'array della lobby
                lobby.players = lobby.players.filter(color => color !== targetColor);
                users.delete(targetColor); // Rimuove il colore dalla mappa globale degli utenti

                // Avvisa TUTTI i client nella lobby di chi è stato cacciato
                io.to(lobbyId).emit('playerKicked', targetColor);

                // Manda un messaggio in chat
                io.to(lobbyId).emit('message', {
                    message: `Un giocatore è stato espulso dall'Host.`,
                    type: 'system'
                });
            }
        });

        socket.on('disconnect', () => {
            console.log(`❌ Client disconnesso: ${socket.id}`);
        });

        // Inizializza i moduli dei giochi
        drawingGameSocket(io, socket);
        triviaGameSocket(io, socket);
        chatSocket(io, socket);
        racingGameSocket(io, socket);
    });
};