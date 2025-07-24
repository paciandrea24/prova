const { lobbies, users } = require('../store/lobbies');
const { activeGames } = require('../store/activeGames');
const {
    getDefaultGameSettings,
    initializeGame,
    startNewTurn,
    endTurn,
    endGame,
    generateInitialHint,
    checkAndUpdateHint,
    updateHintDisplay,
    calculateGuessPoints,
    createHintRevealPlan
} = require('../game/drawingGame');

module.exports = function (io) {
    io.on('connection', (socket) => {
        console.log(`L'utente con id: ${socket.id} si è connesso`);

        // Quando un utente entra in una lobby
        socket.on('joinLobby', (lobbyId) => {
            socket.join(lobbyId);
            console.log(`L'utente con id: ${socket.id} si è unito alla lobby: ${lobbyId}`);
        });

        // Quando un giocatore si unisce a un gioco
        socket.on('joinGame', (data) => {
            const { lobbyId, gameId, playerColor } = data;
            console.log(`👤 Player ${playerColor} joined game ${gameId} in lobby ${lobbyId}`);

            // Verifica se la lobby esiste
            const lobby = lobbies.get(lobbyId);
            if (!lobby) {
                console.log(`❌ Lobby ${lobbyId} non trovata`);
                return;
            }

            // Se il gioco è già iniziato, invia solo lo stato attuale
            if (activeGames.has(lobbyId)) {
                console.log(`ℹ️ Gioco già iniziato per lobby ${lobbyId}, inviando stato attuale a ${playerColor}`);
                const game = activeGames.get(lobbyId);

                // Invia lo stato completo del gioco al giocatore che si è appena unito
                socket.emit('gameState', {
                    players: game.players,
                    scores: game.scores,
                    currentTurn: game.currentTurn,
                    timer: game.timer,
                    hint: game.hint,
                    correctGuesses: game.correctGuesses,
                    round: game.currentRound,
                    totalRounds: game.totalRounds,
                    currentWord: game.currentWord,
                    wordOptions: game.wordOptions // Importante per i giocatori che si riconnettono
                });
            } else {
                console.log(`⏳ Gioco non ancora iniziato per lobby ${lobbyId}, in attesa...`);
                // Il gioco non è ancora iniziato, probabilmente l'host deve ancora fare startGame
                // Non fare nulla, aspetta che l'host avvii il gioco
            }
        });

        // Quando l'artista seleziona una parola
        socket.on('wordSelected', (data) => {
            const { lobbyId, word } = data;
            const game = activeGames.get(lobbyId);

            if (!game || game.currentWord) return; // Ignora se il gioco non esiste o la parola è già stata selezionata

            game.currentWord = word;
            game.usedWords = game.usedWords || [];
            game.usedWords.push(word);

            game.hint = generateInitialHint(word); // Inizialmente mostra solo underscore
            game.isActive = true;
            game.revealedIndices = new Set(); // Resetta le lettere rivelate

            // Crea un piano per rivelare le lettere durante il turno usando il timer personalizzato
            game.hintRevealPlan = createHintRevealPlan(word, game.turnDuration);

            // Invia l'hint a tutti i giocatori
            io.to(lobbyId).emit('gameState', {
                players: game.players,
                scores: game.scores,
                currentTurn: game.currentTurn,
                timer: game.timer,
                hint: game.hint,
                correctGuesses: game.correctGuesses,
                round: game.currentRound,
                totalRounds: game.totalRounds,
                currentWord: word
            });

            // Pulisci la lavagna
            io.to(lobbyId).emit('clearCanvas');

            // Inizia il timer del gioco
            game.timerInterval = setInterval(() => {
                game.timer--;

                // Controlla se è il momento di rivelare una nuova lettera
                checkAndUpdateHint(io, lobbyId);

                // Aggiorna il timer per tutti
                io.to(lobbyId).emit('gameState', {
                    players: game.players,
                    scores: game.scores,
                    currentTurn: game.currentTurn,
                    timer: game.timer,
                    hint: game.hint,
                    correctGuesses: game.correctGuesses,
                    round: game.currentRound,
                    totalRounds: game.totalRounds,
                    currentWord: word
                });

                // Se il timer arriva a 0 o tutti hanno indovinato, termina il turno
                if (game.timer <= 0 || (game.correctGuesses.length === game.players.length - 1)) {
                    endTurn(io, lobbyId);
                }
            }, 1000);
        });

        // Quando un giocatore disegna
        socket.on('draw', (data) => {
            const { lobbyId, from, to, color, lineWidth } = data;

            // Inoltra il disegno a tutti gli altri nella stanza
            socket.to(lobbyId).emit('drawLine', { from, to, color, lineWidth });
        });

        // Quando un giocatore pulisce la lavagna
        socket.on('clearCanvas', (data) => {
            const { lobbyId } = data;
            socket.to(lobbyId).emit('clearCanvas');
        });

        // Quando un giocatore fa un tentativo  
        socket.on('guess', (data) => {
            const { lobbyId, playerColor, guess } = data;
            console.log(`🎯 GUESS ricevuto: ${playerColor} -> "${guess}" in lobby ${lobbyId}`);

            const game = activeGames.get(lobbyId);

            if (!game || !game.isActive) {
                console.log(`❌ GUESS ignorato: gioco non trovato o non attivo`);
                return;
            }

            // Ignora tentativi dell'artista
            if (playerColor === game.currentTurn) {
                console.log(`🎨 GUESS ignorato: ${playerColor} è l'artista`);
                socket.emit('message', {
                    message: 'Sei tu l\'artista! Non puoi indovinare.',
                    type: 'error'
                });
                return;
            }

            // Ignora i giocatori che hanno già indovinato
            if (game.correctGuesses.includes(playerColor)) {
                console.log(`✅ GUESS ignorato: ${playerColor} ha già indovinato`);
                socket.emit('message', {
                    message: 'Hai già indovinato la parola!',
                    type: 'info'
                });
                return;
            }

            // Controlla se il tentativo è corretto (ignorando maiuscole/minuscole)
            const isCorrectGuess = guess.toLowerCase() === game.currentWord.toLowerCase();
            console.log(`🔍 Controllo: "${guess.toLowerCase()}" vs "${game.currentWord.toLowerCase()}" = ${isCorrectGuess}`);

            // Se la risposta è corretta
            if (isCorrectGuess) {
                console.log(`🎉 RISPOSTA CORRETTA! NON mostro il tentativo in chat`);

                // Aggiungi giocatore alla lista di chi ha indovinato
                game.correctGuesses.push(playerColor);

                // Calcola i punti in base alla posizione
                const position = game.correctGuesses.length - 1;
                const guessPoints = calculateGuessPoints(position);
                const artistBonus = 20;

                // Aggiorna i punteggi
                game.scores[playerColor] += guessPoints;
                game.scores[game.currentTurn] += artistBonus;

                // Messaggio personalizzato in base alla posizione
                const positionMessages = [
                    '🥇 Primo posto!',
                    '🥈 Secondo posto!',
                    '🥉 Terzo posto!',
                    '4° posto!',
                    '5° posto!'
                ];

                const positionMessage = positionMessages[Math.min(position, positionMessages.length - 1)];

                // Invia solo il messaggio di successo (NON mostrare la parola indovinata)
                console.log(`📢 Inviando messaggio successo: "${playerColor} ha indovinato! ${positionMessage} (+${guessPoints} punti)"`);
                io.to(lobbyId).emit('message', {
                    message: `${playerColor} ha indovinato! ${positionMessage} (+${guessPoints} punti)`,
                    type: 'success'
                });

                // 🔊 Fai partire il suono su tutti i client
                io.to(lobbyId).emit('playCorrectSound');

                // Aggiorna lo stato del gioco
                io.to(lobbyId).emit('gameState', {
                    players: game.players,
                    scores: game.scores,
                    currentTurn: game.currentTurn,
                    timer: game.timer,
                    hint: game.hint,
                    correctGuesses: game.correctGuesses,
                    round: game.currentRound,
                    totalRounds: game.totalRounds
                });

                // Se tutti i giocatori eccetto l'artista hanno indovinato, termina il turno
                if (game.correctGuesses.length === game.players.length - 1) {
                    endTurn(io, lobbyId);
                }
            } else {
                // Solo se la risposta è SBAGLIATA, mostrarla in chat
                console.log(`❌ RISPOSTA SBAGLIATA: "${guess}" - mostro in chat`);
                io.to(lobbyId).emit('message', {
                    message: `${playerColor}: ${guess}`,
                    type: 'chat'
                });
                console.log(`📢 Messaggio chat inviato: "${playerColor}: ${guess}"`);
            }
        });

        // Quando un client richiede lo stato attuale del gioco
        socket.on('requestGameState', (data) => {
            const { lobbyId } = data;
            const game = activeGames.get(lobbyId);

            if (!game) return;

            // Invia lo stato attuale del gioco
            socket.emit('gameState', {
                players: game.players,
                scores: game.scores,
                currentTurn: game.currentTurn,
                timer: game.timer,
                hint: game.hint,
                correctGuesses: game.correctGuesses,
                round: game.currentRound,
                totalRounds: game.totalRounds,
                currentWord: game.currentWord  // Aggiungi la parola corrente qui
            });
        });

        // Quando un giocatore usa lo strumento riempi
        socket.on('fillArea', (data) => {
            const { lobbyId, startX, startY, color } = data;

            // Inoltra l'evento di riempimento a tutti gli altri nella stanza
            socket.to(lobbyId).emit('fillArea', { startX, startY, color });
        });

        // AGGIORNATO: Quando l'host seleziona un gioco e salva le impostazioni
        socket.on('startGame', (data) => {
            const { lobbyId, gameId, settings } = data;

            console.log(`🎮 Ricevuto startGame per lobby ${lobbyId}:`);
            console.log(`- GameID: ${gameId}`);
            console.log(`- Settings:`, settings);

            // Verifica se la lobby esiste
            const lobby = lobbies.get(lobbyId);
            if (!lobby) {
                console.log(`❌ Lobby ${lobbyId} non trovata`);
                return;
            }

            // Salva le impostazioni nella lobby
            lobby.gameSettings = settings;
            console.log(`✅ Impostazioni salvate nella lobby ${lobbyId}`);

            // NUOVO: Inizializza immediatamente il gioco invece di aspettare joinGame
            console.log(`🚀 Inizializzando gioco immediatamente...`);

            // Usa le impostazioni per inizializzare il gioco
            const gameSettings = settings || getDefaultGameSettings(gameId);
            initializeGame(lobbyId, lobby.players, gameId, gameSettings);

            // Invia a tutti i client nella lobby che il gioco è stato selezionato
            io.to(lobbyId).emit('gameSelected', { gameId, settings });

            // Invia un messaggio che il gioco sta per iniziare
            io.to(lobbyId).emit('message', {
                message: 'Il gioco sta per iniziare!',
                type: 'system'
            });

            // Avvia il primo turno dopo 3 secondi
            setTimeout(() => {
                console.log(`🎯 Avviando primo turno per lobby ${lobbyId}`);
                startNewTurn(io, lobbyId);
            }, 3000);
        });

        socket.on('disconnect', () => {
            console.log(`Il client con id: ${socket.id} si è disconnesso`);
        })

    })
}