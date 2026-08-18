// sockets/chatSocket.js
const { creaLimite } = require('../middleware/limiteRichieste');

const LUNGHEZZA_MAX = 500;

// Dieci messaggi ogni cinque secondi per socket: sopra quella soglia non si
// sta chiacchierando. Senza limite un ciclo di `emit` riempie la chat di tutti
// quelli nella stanza alla velocità della rete, e il server rimbalza ogni
// messaggio a ognuno.
const limiteChat = creaLimite({ maxRichieste: 10, finestraMs: 5000 });

module.exports = function (io, socket) {
    console.log('💬 Modulo Chat inizializzato per socket:', socket.id);

    socket.on('sendChatMessage', (data) => {
        const { lobbyId, message } = data || {};

        // Chi parla lo sa il server (vedi joinLobby in socketManager): il
        // colore non arriva più dal messaggio. Prima bastava cambiarlo per
        // far dire quel che si voleva a chiunque altro nella stanza.
        const playerColor = socket.color;
        if (!playerColor || !lobbyId || socket.lobbyId !== lobbyId) return;

        if (typeof message !== 'string') return;
        const testo = message.trim().slice(0, LUNGHEZZA_MAX);
        if (!testo) return;

        if (!limiteChat.consenti(socket.id)) return;

        console.log(`📩 Chat in lobby ${lobbyId} da ${playerColor}: ${testo}`);

        // Invia a TUTTI nella stanza
        io.to(lobbyId).emit('receiveChatMessage', {
            playerColor: playerColor,
            message: testo,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
    });
};
