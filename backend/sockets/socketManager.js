// sockets/socketManager.js
const drawingGameSocket = require('./games/drawingGameSocket');
const triviaGameSocket = require('./games/triviaGameSocket');
const chatSocket = require('./chatSocket');
const racingGameSocket = require('./games/racingGameSocket');

module.exports = function (io) {
    io.on('connection', (socket) => {
        console.log(`🔌 Utente connesso: ${socket.id}`);

        socket.on('joinLobby', (lobbyId) => {
            socket.join(lobbyId);
            console.log(`🏠 Utente ${socket.id} è entrato nella lobby: ${lobbyId}`);
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