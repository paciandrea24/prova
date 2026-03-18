// sockets/socketManager.js
const drawingGameSocket = require('./games/drawingGameSocket');
const triviaGameSocket = require('./games/triviaGameSocket');
const chatSocket = require('./chatSocket');
const racingGameSocket = require('./games/racingGameSocket');
const bombGameSocket = require('./games/bombGameSocket');
const footballGameSocket = require('./games/footballGameSocket');
const footballMultiGameSocket = require('./games/footballMultiGameSocket');

// IMPORTANTE: Importiamo lo store delle lobby per poterle modificare
const { lobbies, users } = require('../store/lobbies');

// [NUOVO] Mappa globale per tracciare i timer di distruzione delle lobby
const destroyTimers = new Map();

module.exports = function (io) {
    io.on('connection', (socket) => {
        console.log(`🔌 Utente connesso: ${socket.id}`);

        // --- 1. ENTRATA NELLA LOBBY ---
        socket.on('joinLobby', (data) => {
            // Estrapoliamo in modo sicuro i dati (supporta il vecchio formato stringa o il nuovo oggetto)
            const lobbyId = typeof data === 'string' ? data : data.lobbyId;
            const color = typeof data === 'string' ? null : data.color;

            socket.join(lobbyId);

            // Salviamo i dati direttamente nell'oggetto socket per ricordarceli alla disconnessione
            socket.lobbyId = lobbyId;
            if (color) socket.color = color;

            console.log(`🏠 Utente ${socket.id} (${color || 'Sconosciuto'}) è entrato nella lobby: ${lobbyId}`);

            const lobby = lobbies.get(lobbyId);
            if (lobby) {
                // Se c'era un timer di distruzione in corso, annulliamolo (l'utente ha solo ricaricato la pagina)
                if (destroyTimers.has(lobbyId)) {
                    clearTimeout(destroyTimers.get(lobbyId));
                    destroyTimers.delete(lobbyId);
                    console.log(`♻️ Distruzione annullata per la lobby ${lobbyId} (Utente rientrato)`);
                }

                // Se l'utente non è nell'array (es. ha ricaricato F5), lo riaggiungiamo
                if (color && !lobby.players.includes(color)) {
                    lobby.players.push(color);
                    users.set(color, lobbyId);
                }
            }
        });

        // --- 2. ESPULSIONE GIOCATORE ---
        socket.on('kickPlayer', (data) => {
            const { lobbyId, hostColor, targetColor } = data;
            const lobby = lobbies.get(lobbyId);

            // Verifica di sicurezza
            if (lobby && lobby.host === hostColor) {
                lobby.players = lobby.players.filter(color => color !== targetColor);
                users.delete(targetColor);

                io.to(lobbyId).emit('playerKicked', targetColor);
                io.to(lobbyId).emit('message', {
                    message: `Un giocatore è stato espulso dall'Host.`,
                    type: 'system'
                });
            }
        });

        // --- 3. DISCONNESSIONE E DISTRUZIONE LOBBY ---
        socket.on('disconnect', () => {
            console.log(`❌ Client disconnesso: ${socket.id}`);

            // Se questo socket era associato a una lobby e a un colore
            if (socket.lobbyId && socket.color) {
                const lobby = lobbies.get(socket.lobbyId);

                if (lobby) {
                    // Rimuoviamo il giocatore dalla lobby
                    lobby.players = lobby.players.filter(c => c !== socket.color);
                    users.delete(socket.color);

                    // Notifichiamo la chat (opzionale)
                    io.to(socket.lobbyId).emit('message', {
                        message: `Un giocatore ha abbandonato la stanza.`,
                        type: 'system'
                    });

                    // SE LA LOBBY È VUOTA, avviamo il timer di distruzione
                    if (lobby.players.length === 0) {
                        console.log(`⏳ Lobby ${socket.lobbyId} vuota. Distruzione tra 5 secondi...`);

                        const timer = setTimeout(() => {
                            lobbies.delete(socket.lobbyId);
                            destroyTimers.delete(socket.lobbyId);
                            console.log(`🗑️ Lobby ${socket.lobbyId} distrutta definitivamente.`);
                        }, 5000);

                        destroyTimers.set(socket.lobbyId, timer);
                    }
                }
            }
        });

        // Inizializza i moduli dei giochi
        drawingGameSocket(io, socket);
        triviaGameSocket(io, socket);
        chatSocket(io, socket);
        racingGameSocket(io, socket);
        bombGameSocket(io, socket);
        footballGameSocket(io, socket);
        footballMultiGameSocket(io, socket);
    });
};