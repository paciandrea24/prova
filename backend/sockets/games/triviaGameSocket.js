// sockets/games/triviaGameSocket.js
const { lobbies } = require('../../store/lobbies');
const { activeGames } = require('../../store/activeGames');
const {
    initializeTriviaGame,
    getNextQuestion,
    calculateTriviaPoints
} = require('../../game/triviaGame');

const GAME_ID = 'trivia';

module.exports = function (io, socket) {

    // --- 1. GESTIONE JOIN  ---
    socket.on('joinGame', (data) => {
        const { lobbyId, gameId, playerColor } = data;

        // Ignora se non è trivia
        if (gameId && gameId !== GAME_ID) return;

        console.log(`🧠 Player ${playerColor} sta entrando nel TRIVIA in lobby ${lobbyId}`);

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        // Unisci il socket alla stanza della lobby
        socket.join(lobbyId);

        // Se il gioco è già attivo, manda subito lo stato a questo giocatore!
        const game = activeGames.get(lobbyId);
        if (game && game.type === GAME_ID) {

            // Se c'è una domanda attiva, mandala subito al giocatore che è appena entrato
            if (game.currentQuestion) {
                socket.emit('newQuestion', {
                    question: game.currentQuestion,
                    options: getNextQuestion(game.currentRound - 1).options, // Recupera le opzioni
                    round: game.currentRound,
                    totalRounds: game.totalRounds,
                    time: game.timer, // Il tempo rimasto attuale!
                    scores: game.scores
                });
            } else {
                // Se siamo nella pausa tra un round e l'altro o all'inizio
                socket.emit('statusMessage', { message: "Il round sta per iniziare..." });
            }
        }
    });

    // --- AVVIO DEL GIOCO ---
    socket.on('startGame', (data) => {
        const { lobbyId, gameId, settings } = data;

        // Rispondi solo se il gioco è Trivia
        if (gameId !== GAME_ID) return;

        console.log(`🧠 Avvio TRIVIA Game per lobby ${lobbyId}`);

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        // Inizializza stato del gioco
        const game = initializeTriviaGame(gameId, settings || {});

        // Inizializza i punteggi a 0 per tutti i giocatori
        lobby.players.forEach(playerColor => {
            // Usiamo direttamente la stringa, oppure p.color se fosse un oggetto (per sicurezza)
            const color = typeof playerColor === 'object' ? playerColor.color : playerColor;
            game.scores[color] = 0;
        });

        activeGames.set(lobbyId, game);

        // 1. Diciamo al frontend di cambiare pagina (Routing)
        io.to(lobbyId).emit('gameSelected', { gameId: GAME_ID, settings });

        // 2. Facciamo partire il primo round dopo breve attesa
        setTimeout(() => {
            startTriviaRound(io, lobbyId);
        }, 3000);
    });

    // --- RICEZIONE RISPOSTA ---
    socket.on('triviaAnswer', (data) => {
        const { lobbyId, playerColor, answerIndex } = data;
        const game = activeGames.get(lobbyId);

        // Controlli di sicurezza
        if (!game || game.type !== GAME_ID || !game.isActive) return;
        if (game.playerAnswers[playerColor] !== undefined) return; // Ha già risposto

        // Registra la risposta
        game.playerAnswers[playerColor] = answerIndex;
        game.answeredCount++;

        console.log(`📝 ${playerColor} ha risposto: ${answerIndex}`);

        // Calcola punti SE la risposta è corretta
        const isCorrect = answerIndex === game.correctAnswerIndex;
        let pointsEarned = 0;

        if (isCorrect) {
            // Punti basati sul tempo rimasto (chi risponde prima prende di più)
            pointsEarned = calculateTriviaPoints(game.timer, game.roundDuration);
            game.scores[playerColor] += pointsEarned;
        }

        // Notifica al singolo giocatore se ha indovinato (opzionale, per feedback immediato)
        socket.emit('answerFeedback', { correct: isCorrect, points: pointsEarned });

        // Se hanno risposto TUTTI, finiamo il round subito
        if (game.answeredCount === Object.keys(game.scores).length) {
            endTriviaRound(io, lobbyId);
        }
    });

    // --- 4. RICHIESTA STATO (In caso di reload pagina) ---
    socket.on('requestGameState', (data) => {
        const { lobbyId } = data;
        const game = activeGames.get(lobbyId);
        if (game && game.type === GAME_ID && game.currentQuestion) {
            socket.emit('newQuestion', {
                question: game.currentQuestion,
                options: getNextQuestion(game.currentRound - 1).options,
                round: game.currentRound,
                totalRounds: game.totalRounds,
                time: game.timer
            });
        }
    });
};

// --- FUNZIONI DI SUPPORTO (interne al socket) ---

function startTriviaRound(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;

    // Controllo Fine Gioco
    if (game.currentRound >= game.totalRounds) {
        io.to(lobbyId).emit('gameOver', { scores: game.scores });
        activeGames.delete(lobbyId);
        return;
    }

    // Prepara nuova domanda
    game.currentRound++;
    const questionData = getNextQuestion(game.currentRound - 1); // -1 perché array parte da 0

    game.currentQuestion = questionData.text;
    game.correctAnswerIndex = questionData.correctIndex;
    game.playerAnswers = {}; // Resetta risposte
    game.answeredCount = 0;
    game.timer = game.roundDuration;

    // Invia ai client (SENZA dire qual è la risposta giusta!)
    io.to(lobbyId).emit('newQuestion', {
        question: questionData.text,
        options: questionData.options,
        round: game.currentRound,
        totalRounds: game.totalRounds,
        time: game.roundDuration,
        scores: game.scores
    });

    // Gestione Timer
    if (game.timerInterval) clearInterval(game.timerInterval);

    game.timerInterval = setInterval(() => {
        game.timer--;

        // Opzionale: invia tick del timer ogni secondo se vuoi sincronizzare
        // io.to(lobbyId).emit('timerTick', game.timer);

        if (game.timer <= 0) {
            endTriviaRound(io, lobbyId);
        }
    }, 1000);
}

function endTriviaRound(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;

    clearInterval(game.timerInterval);
    game.timerInterval = null;

    console.log("⏰ Fine round, invio risultati...");

    // Invia risultati del round (svela la risposta corretta e aggiorna classifica)
    io.to(lobbyId).emit('roundResult', {
        correctIndex: game.correctAnswerIndex,
        scores: game.scores, // Classifica aggiornata
        playerAnswers: game.playerAnswers // Per mostrare chi ha scelto cosa
    });

    // Attendi 5 secondi per far vedere i risultati, poi prossima domanda
    setTimeout(() => {
        startTriviaRound(io, lobbyId);
    }, 5000);
}