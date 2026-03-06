/* // sockets/games/triviaGameSocket.js
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

    // --- 1. GESTIONE JOIN ---
    socket.on('joinGame', (data) => {
        const { lobbyId, gameId, playerColor } = data;

        if (gameId && gameId !== GAME_ID) return;

        console.log(`🧠 Player ${playerColor} sta entrando nel TRIVIA in lobby ${lobbyId}`);

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        socket.join(lobbyId);

        const game = activeGames.get(lobbyId);
        if (game && game.type === GAME_ID) {
            if (game.currentQuestion) {
                socket.emit('newQuestion', {
                    question: game.currentQuestion,
                    options: getNextQuestion(game).options,
                    round: game.currentRound,
                    totalRounds: game.totalRounds,
                    time: game.timer,
                    scores: game.scores,
                    imageUrl: game.currentImageUrl // [FIX] Usa l'URL salvato nel gioco
                });
            } else {
                socket.emit('statusMessage', { message: "Il round sta per iniziare..." });
            }
        }
    });

    // --- 2. AVVIO DEL GIOCO ---
    socket.on('startGame', async (data) => {
        const { lobbyId, gameId, settings } = data;

        if (gameId !== GAME_ID) return;

        console.log(`🧠 Avvio TRIVIA Game per lobby ${lobbyId}`);

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        lobby.lastGameSettings = settings;

        // Recupera le domande
        const rounds = (settings && settings.questions) || 5;
        let questions = await fetchTriviaQuestions(rounds);

        // [NUOVO] Cerca immagini su Wikipedia se mancano
        if (questions && questions.length > 0) {
            questions = await enrichQuestionsWithMedia(questions);
        }

        const game = initializeTriviaGame(gameId, settings || {}, questions);

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

    // --- 3. RICEZIONE RISPOSTA ---
    socket.on('triviaAnswer', (data) => {
        const { lobbyId, playerColor, answerIndex } = data;
        const game = activeGames.get(lobbyId);

        if (!game || game.type !== GAME_ID || !game.isActive) return;
        if (game.playerAnswers[playerColor] !== undefined) return;

        game.playerAnswers[playerColor] = answerIndex;
        game.answeredCount++;

        console.log(`📝 ${playerColor} ha risposto: ${answerIndex}`);

        // FEEDBACK LIVE: Avvisa tutti che questo giocatore ha risposto
        io.to(lobbyId).emit('playerAnswered', { playerColor });

        const isCorrect = answerIndex === game.correctAnswerIndex;
        let pointsEarned = 0;

        if (isCorrect) {
            pointsEarned = calculateTriviaPoints(game.timer, game.roundDuration);
            game.scores[playerColor] += pointsEarned;
        }

        if (game.answeredCount === Object.keys(game.scores).length) {
            endTriviaRound(io, lobbyId);
        }
    });

    // --- 4. RICHIESTA STATO (Reload) ---
    socket.on('requestGameState', (data) => {
        const { lobbyId } = data;
        const game = activeGames.get(lobbyId);
        if (game && game.type === GAME_ID && game.currentQuestion) {
            socket.emit('newQuestion', {
                question: game.currentQuestion,
                options: getNextQuestion(game).options,
                round: game.currentRound,
                totalRounds: game.totalRounds,
                time: game.timer,
                scores: game.scores,
                imageUrl: game.currentImageUrl // [FIX] Usa l'URL salvato
            });
        }
    });

    // --- 5. FINE PARTITA ---
    socket.on('backToLobby', (data) => {
        const { lobbyId } = data;
        io.to(lobbyId).emit('returnToLobbySignal');
        activeGames.delete(lobbyId);
    });

    socket.on('playAgain', async (data) => {
        const { lobbyId } = data;
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        console.log(`🔄 Riavvio gioco per lobby ${lobbyId}`);

        const settings = lobby.lastGameSettings || {};
        const rounds = (settings && settings.questions) || 5;

        let questions = await fetchTriviaQuestions(rounds);

        // [NUOVO] Cerca immagini anche al riavvio
        if (questions && questions.length > 0) {
            questions = await enrichQuestionsWithMedia(questions);
        }

        const game = initializeTriviaGame('trivia', settings, questions);

        lobby.players.forEach(p => {
            const color = typeof p === 'object' ? p.color : p;
            game.scores[color] = 0;
        });

        activeGames.set(lobbyId, game);

        io.to(lobbyId).emit('gameRestarted');
        setTimeout(() => { startTriviaRound(io, lobbyId); }, 3000);
    });
};

// --- FUNZIONI INTERNE DEL GIOCO ---

function startTriviaRound(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;

    if (game.currentRound >= game.totalRounds) {
        const lobby = lobbies.get(lobbyId);
        const hostColor = lobby ? lobby.host : null;

        io.to(lobbyId).emit('gameOver', {
            scores: game.scores,
            hostColor: hostColor
        });

        game.isActive = false;
        return;
    }

    const questionData = getNextQuestion(game);

    if (!questionData) {
        console.error("Errore: Domanda non trovata!");
        return;
    }

    game.currentRound++;
    game.currentQuestion = questionData.text;
    game.correctAnswerIndex = questionData.correctIndex;

    // [FIX] Salviamo l'URL nel game state per chi entra dopo o ricarica
    game.currentImageUrl = questionData.imageUrl;

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

    io.to(lobbyId).emit('roundResult', {
        correctIndex: game.correctAnswerIndex,
        scores: game.scores,
        playerAnswers: game.playerAnswers
    });

    setTimeout(() => {
        startTriviaRound(io, lobbyId);
    }, 5000);
}

// --- NUOVE FUNZIONI HELPER (FONDO FILE) ---

// 1. Cerca l'URL di un'immagine su Wikipedia
async function fetchWikiImage(searchTerm) {
    if (!searchTerm) return null;
    try {
        const endpoint = `https://it.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(searchTerm)}&prop=pageimages&format=json&pithumbsize=1000&origin=*`;

        const response = await fetch(endpoint);
        const data = await response.json();

        const pages = data.query.pages;
        const firstPageId = Object.keys(pages)[0];

        if (firstPageId && pages[firstPageId].thumbnail) {
            return pages[firstPageId].thumbnail.source;
        }
    } catch (error) {
        console.error(`❌ Errore Wiki per '${searchTerm}':`, error.message);
    }
    return null;
}

// 2. Arricchisce le domande cercando le immagini mancanti
async function enrichQuestionsWithMedia(questions) {
    console.log("🎨 Cerco immagini su Wikipedia...");

    // Esegue le richieste in parallelo
    return Promise.all(questions.map(async (q) => {
        // Se è tipo 'image', manca l'URL ma c'è un termine di ricerca
        if (q.type === 'image' && !q.imageUrl && q.imageSearch) {
            const foundUrl = await fetchWikiImage(q.imageSearch);
            if (foundUrl) {
                q.imageUrl = foundUrl;
                console.log(`✅ Immagine trovata: ${q.imageSearch}`);
            } else {
                // Fallback
                q.imageUrl = "https://via.placeholder.com/600x400?text=Immagine+non+disponibile";
            }
        }
        return q;
    }));
} */

// backend/sockets/games/triviaGameSocket.js
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

    socket.on('joinGame', (data) => {
        const { lobbyId, gameId, playerColor } = data;

        if (gameId && gameId !== GAME_ID) return;

        console.log(`🧠 Player ${playerColor} joined TRIVIA in lobby ${lobbyId}`);

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        socket.join(lobbyId);

        const game = activeGames.get(lobbyId);
        if (game && game.type === GAME_ID) {
            if (game.currentQuestion) {
                socket.emit('newQuestion', {
                    question: game.currentQuestion,
                    options: getNextQuestion(game).options,
                    round: game.currentRound,
                    totalRounds: game.totalRounds,
                    time: game.timer,
                    scores: game.scores,
                    imageUrl: game.currentImageUrl
                });
            } else {
                socket.emit('statusMessage', { message: "Round is about to start..." });
            }
        }
    });

    socket.on('startGame', async (data) => {
        const { lobbyId, gameId, settings } = data;

        if (gameId !== GAME_ID) return;

        console.log(`🧠 Starting TRIVIA Game for lobby ${lobbyId}`);

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        lobby.lastGameSettings = settings;

        const rounds = (settings && settings.questions) || 5;
        let questions = await fetchTriviaQuestions(rounds);

        if (questions && questions.length > 0) {
            questions = await enrichQuestionsWithMedia(questions);
        }

        const game = initializeTriviaGame(gameId, settings || {}, questions);

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

    socket.on('triviaAnswer', (data) => {
        const { lobbyId, playerColor, answerIndex } = data;
        const game = activeGames.get(lobbyId);

        if (!game || game.type !== GAME_ID || !game.isActive) return;
        if (game.playerAnswers[playerColor] !== undefined) return;

        game.playerAnswers[playerColor] = answerIndex;
        game.answeredCount++;

        console.log(`📝 ${playerColor} answered: ${answerIndex}`);

        io.to(lobbyId).emit('playerAnswered', { playerColor });

        const isCorrect = answerIndex === game.correctAnswerIndex;
        let pointsEarned = 0;

        if (isCorrect) {
            pointsEarned = calculateTriviaPoints(game.timer, game.roundDuration);
            game.scores[playerColor] += pointsEarned;
        }

        if (game.answeredCount === Object.keys(game.scores).length) {
            endTriviaRound(io, lobbyId);
        }
    });

    socket.on('requestGameState', (data) => {
        const { lobbyId } = data;
        const game = activeGames.get(lobbyId);
        if (game && game.type === GAME_ID && game.currentQuestion) {
            socket.emit('newQuestion', {
                question: game.currentQuestion,
                options: getNextQuestion(game).options,
                round: game.currentRound,
                totalRounds: game.totalRounds,
                time: game.timer,
                scores: game.scores,
                imageUrl: game.currentImageUrl
            });
        }
    });

    socket.on('backToLobby', (data) => {
        const { lobbyId } = data;
        io.to(lobbyId).emit('returnToLobbySignal');
        activeGames.delete(lobbyId);
    });

    socket.on('playAgain', async (data) => {
        const { lobbyId } = data;
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        console.log(`🔄 Restarting game for lobby ${lobbyId}`);

        const settings = lobby.lastGameSettings || {};
        const rounds = (settings && settings.questions) || 5;

        let questions = await fetchTriviaQuestions(rounds);

        if (questions && questions.length > 0) {
            questions = await enrichQuestionsWithMedia(questions);
        }

        const game = initializeTriviaGame('trivia', settings, questions);

        lobby.players.forEach(p => {
            const color = typeof p === 'object' ? p.color : p;
            game.scores[color] = 0;
        });

        activeGames.set(lobbyId, game);

        io.to(lobbyId).emit('gameRestarted');
        setTimeout(() => { startTriviaRound(io, lobbyId); }, 3000);
    });
};

function startTriviaRound(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;

    if (game.currentRound >= game.totalRounds) {
        const lobby = lobbies.get(lobbyId);
        const hostColor = lobby ? lobby.host : null;

        io.to(lobbyId).emit('gameOver', {
            scores: game.scores,
            hostColor: hostColor
        });

        game.isActive = false;
        return;
    }

    const questionData = getNextQuestion(game);

    if (!questionData) {
        console.error("Error: Question not found!");
        return;
    }

    game.currentRound++;
    game.currentQuestion = questionData.text;
    game.correctAnswerIndex = questionData.correctIndex;
    game.currentImageUrl = questionData.imageUrl;

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

    // EMETTE IL TIMER AL FRONTEND
    game.timerInterval = setInterval(() => {
        game.timer--;
        io.to(lobbyId).emit('timerUpdate', { time: game.timer });
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

    io.to(lobbyId).emit('roundResult', {
        correctIndex: game.correctAnswerIndex,
        scores: game.scores,
        playerAnswers: game.playerAnswers
    });

    setTimeout(() => {
        startTriviaRound(io, lobbyId);
    }, 5000);
}

async function fetchWikiImage(searchTerm) {
    if (!searchTerm) return null;
    try {
        const endpoint = `https://it.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(searchTerm)}&prop=pageimages&format=json&pithumbsize=1000&origin=*`;
        const response = await fetch(endpoint);
        const data = await response.json();
        const pages = data.query.pages;
        const firstPageId = Object.keys(pages)[0];

        if (firstPageId && pages[firstPageId].thumbnail) {
            return pages[firstPageId].thumbnail.source;
        }
    } catch (error) {
        console.error(`❌ Wiki error for '${searchTerm}':`, error.message);
    }
    return null;
}

async function enrichQuestionsWithMedia(questions) {
    return Promise.all(questions.map(async (q) => {
        if (q.type === 'image' && !q.imageUrl && q.imageSearch) {
            const foundUrl = await fetchWikiImage(q.imageSearch);
            if (foundUrl) {
                q.imageUrl = foundUrl;
            } else {
                q.imageUrl = "https://via.placeholder.com/600x400?text=Image+not+available";
            }
        }
        return q;
    }));
}