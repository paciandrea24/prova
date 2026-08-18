// sockets/socketManager.js
const drawingGameSocket = require('./games/drawingGameSocket');
const triviaGameSocket = require('./games/triviaGameSocket');
const chatSocket = require('./chatSocket');
const racingGameSocket = require('./games/racingGameSocket');
const bombGameSocket = require('./games/bombGameSocket');
const footballGameSocket = require('./games/footballGameSocket');
const footballMultiGameSocket = require('./games/footballMultiGameSocket');
const fpsGameSocket = require('./games/fpsGameSocket');
const f1GameSocket = require('./games/f1GameSocket');
const f1Testbench = require('./games/f1Testbench');

// IMPORTANTE: Importiamo lo store delle lobby per poterle modificare
const {
    lobbies, users, destroyTimers,
    verificaGettone, dimenticaGiocatore, dimenticaLobby
} = require('../store/lobbies');
const { activeGames } = require('../store/activeGames');
const { strumentiDiSviluppoAttivi } = require('../config/ambiente');

// Un messaggio malformato non deve poter spegnere il server.
//
// Socket.io non racchiude in nulla i gestori che registriamo: se uno lancia,
// l'eccezione arriva fino a `uncaughtException` e il processo muore, portandosi
// dietro OGNI partita in corso di OGNI stanza. E lanciare era facilissimo —
// `addRecord` faceva `playerName.toUpperCase()` su quello che arrivava dalla
// rete, quindi bastava mandare un numero al posto di un nome.
//
// Qui avvolgiamo una volta sola tutti i gestori di questo socket, compresi
// quelli registrati dai moduli di gioco più sotto: l'errore viene scritto nel
// log con il nome dell'evento e la connessione va avanti.
function proteggiGestori(socket) {
    const originale = socket.on.bind(socket);
    socket.on = function (evento, gestore) {
        if (typeof gestore !== 'function') return originale(evento, gestore);
        return originale(evento, function (...args) {
            try {
                return gestore.apply(this, args);
            } catch (err) {
                console.error(`⚠️  Errore nel gestore "${evento}" (socket ${socket.id}):`, err && err.message);
            }
        });
    };
}

module.exports = function (io) {
    io.on('connection', (socket) => {
        console.log(`🔌 Utente connesso: ${socket.id}`);
        proteggiGestori(socket);

        // Avviare una partita è un potere dell'host, e finora lo era solo
        // nell'interfaccia: il pulsante compariva a lui, ma l'evento
        // `startGame` lo ascoltavano sette moduli di gioco senza che nessuno
        // controllasse chi lo avesse mandato. Chiunque poteva quindi
        // trascinare tutta la stanza dentro una partita con le impostazioni
        // che voleva, anche restando fermo in lobby.
        //
        // Il controllo sta qui e non in ognuno dei sette: un gioco nuovo lo
        // eredita senza doversene ricordare.
        const EVENTI_SOLO_HOST = new Set(['startGame']);
        socket.use((pacchetto, next) => {
            const [evento, dati] = pacchetto;
            if (!EVENTI_SOLO_HOST.has(evento)) return next();
            const lobbyId = dati && dati.lobbyId;
            const lobby = lobbies.get(lobbyId);
            if (lobby && socket.color && lobby.host === socket.color && socket.lobbyId === lobbyId) {
                return next();
            }
            // Il pacchetto viene lasciato cadere senza rispondere: chi non è
            // host non ha nemmeno il pulsante, quindi non c'è una schermata da
            // avvisare — e un errore rimandato indietro direbbe a chi sta
            // provando esattamente quanto è arrivato vicino.
            console.warn(`🚫 "${evento}" ignorato: ${socket.color || 'socket senza sessione'} non è host di ${lobbyId}`);
        });

        // --- 1. ENTRATA NELLA LOBBY ---
        //
        // È il punto in cui il server decide CHI è questo socket, e da qui in
        // avanti non lo chiede più a nessuno: `socket.color` è l'unica fonte
        // di identità per espulsioni, passaggi di host e chiusura partita.
        //
        // Prima bastava dichiarare un colore per esserlo. Il colore però è
        // pubblico — sta nella lista giocatori che il server manda a tutti —
        // quindi chiunque fosse in una stanza poteva rispedire quello
        // dell'host e comandare al posto suo. Ora serve il gettone consegnato
        // da /create-lobby o /join-lobby, che vive solo nella scheda di chi
        // l'ha ricevuto.
        socket.on('joinLobby', (data) => {
            const lobbyId = typeof data === 'string' ? data : (data && data.lobbyId);
            const color = typeof data === 'string' ? null : (data && data.color);
            const token = typeof data === 'string' ? null : (data && data.token);

            if (typeof lobbyId !== 'string' || !lobbyId) return;

            if (color && !verificaGettone(lobbyId, color, token)) {
                console.warn(`🚫 joinLobby rifiutato: gettone non valido per ${color} in ${lobbyId}`);
                socket.emit('sessioneNonValida', {
                    motivo: 'La tua sessione in questa stanza non è più valida. Rientra dalla home.'
                });
                return;
            }

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

                // Se l'utente non è nell'array (es. ha ricaricato F5), lo riaggiungiamo.
                // Ci arriva solo chi ha già superato il controllo del gettone.
                if (color && !lobby.players.includes(color)) {
                    lobby.players.push(color);
                    users.set(color, lobbyId);
                }

                io.to(lobbyId).emit('lobbyUpdated', { players: lobby.players, host: lobby.host });
            }
        });

        // --- 2. ESPULSIONE GIOCATORE ---
        socket.on('kickPlayer', (data) => {
            const { lobbyId, targetColor } = data || {};
            const lobby = lobbies.get(lobbyId);

            // Chi chiede l'espulsione è il socket, non il colore scritto nel
            // messaggio: `hostColor` arrivava dal client e il controllo era
            // "il colore che mi hai mandato è l'host?" — vero per chiunque
            // sapesse chi fosse l'host, cioè per tutti.
            if (lobby && lobby.host === socket.color && socket.lobbyId === lobbyId) {
                lobby.players = lobby.players.filter(color => color !== targetColor);
                users.delete(targetColor);
                dimenticaGiocatore(lobbyId, targetColor);

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
            const { lobbyId, newHost } = data || {};
            const lobby = lobbies.get(lobbyId);

            // Stessa correzione di kickPlayer: `currentHost` non lo dichiara
            // più il messaggio. Senza, bastava mandare
            // {currentHost: <host vero>, newHost: <io>} per prendersi la stanza.
            if (lobby && lobby.host === socket.color && socket.lobbyId === lobbyId) {
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
                    // Se c'è una partita attiva non modificare lobby.players:
                    // il giocatore si è spostato in-game, non ha lasciato la sessione.
                    if (activeGames.has(socket.lobbyId)) return;

                    // Rimuoviamo il giocatore dalla lobby
                    lobby.players = lobby.players.filter(c => c !== socket.color);
                    users.delete(socket.color);
                    dimenticaGiocatore(socket.lobbyId, socket.color);

                    // Se a uscire era l'HOST, passiamo il ruolo al primo giocatore rimasto
                    // (altrimenti la lobby resterebbe senza host e nessuno potrebbe avviare giochi)
                    if (lobby.host === socket.color && lobby.players.length > 0) {
                        lobby.host = lobby.players[0];
                        console.log(`👑 Host disconnesso. Nuovo host della lobby ${socket.lobbyId}: ${lobby.host}`);
                        io.to(socket.lobbyId).emit('message', {
                            message: `👑 ${lobby.host} è il nuovo Host della stanza!`,
                            type: 'system'
                        });
                    }

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

                        const lobbyId = socket.lobbyId;
                        const timer = setTimeout(() => {
                            lobbies.delete(lobbyId);
                            destroyTimers.delete(lobbyId);
                            dimenticaLobby(lobbyId);
                            console.log(`🗑️ Lobby ${lobbyId} distrutta definitivamente.`);
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
        fpsGameSocket(io, socket);
        f1GameSocket(io, socket);

        // Banco prova bot: fa girare gare intere di soli bot su richiesta di
        // chiunque sia connesso. È uno strumento di sviluppo e costa CPU come
        // una partita vera — su un server pubblico è un modo gratuito per
        // metterlo in ginocchio, quindi si registra solo in locale.
        if (strumentiDiSviluppoAttivi()) f1Testbench(io, socket);
    });
};
