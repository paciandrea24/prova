// sockets/chatSocket.js

module.exports = function (io, socket) {
    console.log('💬 Modulo Chat inizializzato per socket:', socket.id);

    socket.on('sendChatMessage', (data) => {
        const { lobbyId, playerColor, message } = data;

        console.log(`📩 Chat in lobby ${lobbyId} da ${playerColor}: ${message}`);

        // Invia a TUTTI nella stanza
        io.to(lobbyId).emit('receiveChatMessage', {
            playerColor: playerColor,
            message: message,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
    });
};