// sockets/socketManager.js
const drawingGameSocket = require('./games/drawingGameSocket');
const triviaGameSocket = require('./games/triviaGameSocket');
const chatSocket = require('./chatSocket');
const racingGameSocket = require('./games/racingGameSocket');
const bombGameSocket = require('./games/bombGameSocket');
const footballGameSocket = require('./games/footballGameSocket');
const footballMultiGameSocket = require('./games/footballMultiGameSocket');
const deductionGameSocket = require('./games/deductionGameSocket');
const kartGameSocket = require('./games/kartGameSocket');
const spleefGameSocket = require('./games/spleefGameSocket')
const fpsGameSocket = require('./games/fpsGameSocket');

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

                io.to(lobbyId).emit('lobbyUpdated', { players: lobby.players, host: lobby.host });
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

                io.to(lobbyId).emit('lobbyUpdated', { players: lobby.players, host: lobby.host });
            }
        });

        // --- 5. TRASFERIMENTO HOST ---
        socket.on('transferHost', (data) => {
            const { lobbyId, currentHost, newHost } = data;
            const lobby = lobbies.get(lobbyId);

            // Verifica che la lobby esista e che a richiedere il cambio sia l'host attuale
            if (lobby && lobby.host === currentHost) {
                // Verifica che il nuovo host sia effettivamente nella stanza
                if (lobby.players.includes(newHost)) {
                    lobby.host = newHost;
                    console.log(`👑 Host cambiato nella lobby ${lobbyId}: il nuovo host è ${newHost}`);

                    io.to(lobbyId).emit('message', {
                        message: `👑 ${newHost} è il nuovo Host della stanza!`,
                        type: 'system'
                    });

                    // Aggiorna istantaneamente la UI di tutti
                    io.to(lobbyId).emit('lobbyUpdated', { players: lobby.players, host: lobby.host });
                }
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

                    if (lobby.players.length > 0) {
                        io.to(socket.lobbyId).emit('lobbyUpdated', { players: lobby.players, host: lobby.host });
                    }

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

        // --- 4. RITORNO FORZATO IN LOBBY (Solo Host) ---
        socket.on('forceReturnToLobby', (lobbyId) => {
            const lobby = lobbies.get(lobbyId);

            if (lobby && lobby.host === socket.color) {
                console.log(`🔙 L'host ${socket.color} ha chiuso la partita. Rientro in lobby per ${lobbyId}`);

                const { activeGames } = require('../store/activeGames');
                if (activeGames.has(lobbyId)) {
                    const game = activeGames.get(lobbyId);
                    if (game.timerInterval) clearInterval(game.timerInterval);
                    if (game.loopInterval) clearInterval(game.loopInterval); // FIX: Stoppa il loop di Racing!
                    activeGames.delete(lobbyId);
                }

                io.to(lobbyId).emit('redirectAllToLobby');
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
        deductionGameSocket(io, socket);
        kartGameSocket(io, socket);
        spleefGameSocket(io, socket);
        fpsGameSocket(io, socket);
    });
};