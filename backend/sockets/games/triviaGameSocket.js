// sockets/games/triviaGameSocket.js
const { lobbies } = require('../../store/lobbies');
const { activeGames } = require('../../store/activeGames');
const {
    initializeTriviaGame,
    getNextQuestion,
    calculateTriviaPoints,
    fetchTriviaQuestions
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
                    options: getNextQuestion(game).options, // Recupera le opzioni
                    round: game.currentRound,
                    totalRounds: game.totalRounds,
                    time: game.timer, // Il tempo rimasto attuale!
                    scores: game.scores,
                    imageUrl: questionData.imageUrl
                });
            } else {
                // Se siamo nella pausa tra un round e l'altro o all'inizio
                socket.emit('statusMessage', { message: "Il round sta per iniziare..." });
            }
        }
    });

    // --- AVVIO DEL GIOCO ---
    socket.on('startGame', async (data) => {
        const { lobbyId, gameId, settings } = data;

        if (gameId !== GAME_ID) return;

        console.log(`🧠 Avvio TRIVIA Game per lobby ${lobbyId}`);

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        // 3. RECUPERA LE DOMANDE (DAL FILE LOCALE ORA)
        console.log("📥 Caricando domande...");
        const rounds = (settings && settings.questions) || 5;

        // Aspettiamo che la funzione ci dia le domande mescolate
        const questions = await fetchTriviaQuestions(rounds);

        if (!questions || questions.length === 0) {
            console.error("❌ Errore: Nessuna domanda trovata!");
            return;
        }

        // 4. PASSA LE DOMANDE ALLA FUNZIONE DI INIZIALIZZAZIONE
        // Questo è il punto che dava errore: mancava il terzo parametro!
        const game = initializeTriviaGame(gameId, settings || {}, questions);

        // Inizializza i punteggi
        lobby.players.forEach(playerColor => {
            const color = typeof playerColor === 'object' ? playerColor.color : playerColor;
            game.scores[color] = 0;
        });

        activeGames.set(lobbyId, game);

        io.to(lobbyId).emit('gameSelected', { gameId: GAME_ID, settings });

        setTimeout(() => {
            startTriviaRound(io, lobbyId);
        }, 3000);
    });

    // --- RICEZIONE RISPOSTA ---
    socket.on('triviaAnswer', (data) => {
        const { lobbyId, playerColor, answerIndex } = data;
        const game = activeGames.get(lobbyId);

        if (!game || game.type !== GAME_ID || !game.isActive) return;
        if (game.playerAnswers[playerColor] !== undefined) return;

        game.playerAnswers[playerColor] = answerIndex;
        game.answeredCount++;

        console.log(`📝 ${playerColor} ha risposto: ${answerIndex}`);

        const isCorrect = answerIndex === game.correctAnswerIndex;
        let pointsEarned = 0;

        if (isCorrect) {
            pointsEarned = calculateTriviaPoints(game.timer, game.roundDuration);
            game.scores[playerColor] += pointsEarned;
        }

        // Se hanno risposto TUTTI
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
                options: getNextQuestion(game).options, // Nota: passiamo 'game'
                round: game.currentRound,
                totalRounds: game.totalRounds,
                time: game.timer,
                scores: game.scores,
                imageUrl: questionData.imageUrl
            });
        }
    });

    // --- GESTIONE FINE PARTITA ---

    // 1. Torna alla Lobby
    socket.on('backToLobby', (data) => {
        const { lobbyId } = data;
        // Manda un segnale a TUTTI i client di quella lobby per reindirizzarli
        io.to(lobbyId).emit('redirect', { url: `/index.html?lobby=${lobbyId}` }); // O lobby.html a seconda delle tue rotte

        // Ora possiamo cancellare il gioco dalla memoria
        activeGames.delete(lobbyId);
    });

    // 2. Gioca di Nuovo
    socket.on('playAgain', async (data) => {
        const { lobbyId, settings } = data;

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        console.log(`🔄 Riavvio gioco per lobby ${lobbyId}`);

        // Ri-scarica le domande
        const rounds = (settings && settings.questions) || 5;
        const questions = await fetchTriviaQuestions(rounds);

        // Resetta il gioco (riutilizziamo la funzione di init)
        const game = initializeTriviaGame('trivia', settings || {}, questions);

        // Resetta i punteggi
        lobby.players.forEach(playerColor => {
            const color = typeof playerColor === 'object' ? playerColor.color : playerColor;
            game.scores[color] = 0;
        });

        activeGames.set(lobbyId, game);

        // Avvisa tutti che si ricomincia!
        io.to(lobbyId).emit('gameRestarted');

        // Avvia il primo round dopo breve attesa
        setTimeout(() => {
            startTriviaRound(io, lobbyId);
        }, 3000);
    });
};

// --- FUNZIONI DI SUPPORTO (interne al socket) ---

function startTriviaRound(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;

    if (game.currentRound >= game.totalRounds) {
        // Recupera l'host per inviarlo nel payload del Game Over
        const lobby = lobbies.get(lobbyId);
        const hostColor = lobby ? lobby.host : null;

        io.to(lobbyId).emit('gameOver', {
            scores: game.scores,
            hostColor: hostColor // <--- AGGIUNTO: Passiamo chi è l'host
        });

        // NON cancellare il gioco subito (activeGames.delete), altrimenti non possiamo fare "Gioca di nuovo"
        // activeGames.delete(lobbyId); <--- COMMENTA O RIMUOVI QUESTA RIGA
        game.isActive = false; // Segniamolo come finito
        return;
    }

    // Nota: getNextQuestion ora prende l'intero oggetto game per leggere dalla lista
    const questionData = getNextQuestion(game);

    if (!questionData) {
        console.error("Errore: Domanda non trovata!");
        return;
    }

    game.currentRound++;

    game.currentQuestion = questionData.text;
    game.correctAnswerIndex = questionData.correctIndex;
    game.playerAnswers = {};
    game.answeredCount = 0;
    game.timer = game.roundDuration;

    io.to(lobbyId).emit('newQuestion', {
        question: questionData.text,
        options: questionData.options,
        round: game.currentRound,
        totalRounds: game.totalRounds,
        time: game.roundDuration,
        scores: game.scores,
        imageUrl: questionData.imageUrl
    });

    if (game.timerInterval) clearInterval(game.timerInterval);

    game.timerInterval = setInterval(() => {
        game.timer--;
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

    // Recupera l'host dalla lobby per dirlo al frontend
    const lobby = lobbies.get(lobbyId);
    const hostColor = lobby ? lobby.host : null;

    io.to(lobbyId).emit('roundResult', {
        correctIndex: game.correctAnswerIndex,
        scores: game.scores,
        playerAnswers: game.playerAnswers
    });

    setTimeout(() => {
        startTriviaRound(io, lobbyId);
    }, 5000);
}