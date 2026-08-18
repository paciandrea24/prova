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
        // Anche nel campo che legge la rotta /api/lobby/:id/settings: da li'
        // le prende la pagina del quiz, che prima se le trovava nell'indirizzo.
        lobby.gameSettings = settings;

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

// =========================================================================
// SISTEMA DI CACHE PER LE IMMAGINI DI WIKIPEDIA
// =========================================================================
// Questa mappa manterrà in memoria gli URL delle immagini già cercate
// finché il server Node.js rimane acceso.
const wikiImageCache = new Map();

async function fetchWikiImage(searchTerm) {
    if (!searchTerm) return null;

    // 1. Normalizziamo il termine (es. "Roma" e "roma" saranno la stessa chiave)
    const normalizedTerm = searchTerm.toLowerCase().trim();

    // 2. Controlliamo se l'immagine è già presente in Cache
    if (wikiImageCache.has(normalizedTerm)) {
        console.log(`⚡ Cache HIT! Immagine di '${searchTerm}' recuperata dalla memoria.`);
        return wikiImageCache.get(normalizedTerm);
    }

    // 3. Se non c'è, facciamo la chiamata all'API di Wikipedia
    try {
        console.log(`🌐 Chiamata API Wikipedia in corso per: '${searchTerm}'...`);
        const endpoint = `https://it.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(searchTerm)}&prop=pageimages&format=json&pithumbsize=1000&origin=*`;
        const response = await fetch(endpoint);
        const data = await response.json();
        const pages = data.query.pages;
        const firstPageId = Object.keys(pages)[0];

        if (firstPageId && pages[firstPageId].thumbnail) {
            const imageUrl = pages[firstPageId].thumbnail.source;

            // 4. Salviamo l'URL trovato nella cache per le partite future!
            wikiImageCache.set(normalizedTerm, imageUrl);

            return imageUrl;
        } else {
            // Ottimizzazione Extra: Salviamo in cache anche i risultati "vuoti" (null).
            // Così, se un'immagine non esiste, il server non proverà a cercarla 
            // su Wikipedia ad ogni singola partita!
            wikiImageCache.set(normalizedTerm, null);
        }
    } catch (error) {
        console.error(`❌ Wiki error for '${searchTerm}':`, error.message);
    }
    return null;
}

// La funzione enrichQuestionsWithMedia rimane esattamente come la tua
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