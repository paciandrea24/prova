
// sockets/games/drawingGameSocket.js

// NOTA: Ho aggiornato i percorsi con ../../ perché siamo in una sottocartella
const { lobbies } = require('../../store/lobbies');
const { activeGames } = require('../../store/activeGames');
const {
    getDefaultGameSettings,
    initializeGame,
    startNewTurn,
    endTurn,
    generateInitialHint,
    checkAndUpdateHint,
    calculateGuessPoints,
    createHintRevealPlan
} = require('../../game/drawingGame');

// Costante per identificare questo gioco (deve coincidere con quello che mandi dal frontend)
const GAME_ID = 'drawing';

module.exports = function (io, socket) {

    // --- Gestione Avvio e Join ---

    socket.on('joinGame', (data) => {
        const { lobbyId, gameId, playerColor } = data;

        // Se il join non è per questo gioco, ignoriamo (o gestiamo diversamente)
        // Nota: Se gameId non è passato, potresti dover controllare activeGames.get(lobbyId).gameType
        if (gameId && gameId !== GAME_ID) {
            return;
        }

        console.log(`👤 Player ${playerColor} joined DRAWING game in lobby ${lobbyId}`);

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        if (activeGames.has(lobbyId)) {
            const game = activeGames.get(lobbyId);
            // Sicurezza: controlliamo che sia una partita di disegno
            if (game.gameId !== GAME_ID && game.type !== GAME_ID) return;

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
                wordOptions: game.wordOptions
            });
        }
    });

    socket.on('startGame', (data) => {
        const { lobbyId, gameId, settings } = data;

        // IMPORTANTE: Questo handler risponde solo se il gameId è 'drawing'
        if (gameId && gameId !== GAME_ID) {
            return;
        }

        console.log(`🎨 Avvio Drawing Game per lobby ${lobbyId}`);

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        lobby.gameSettings = settings;

        const gameSettings = settings || getDefaultGameSettings(GAME_ID);
        // Assicurati che initializeGame salvi anche il tipo di gioco ('drawing') nell'oggetto game
        initializeGame(lobbyId, lobby.players, GAME_ID, gameSettings);

        io.to(lobbyId).emit('gameSelected', { gameId, settings });
        io.to(lobbyId).emit('message', { message: 'Il gioco sta per iniziare!', type: 'system' });

        setTimeout(() => {
            startNewTurn(io, lobbyId);
        }, 3000);
    });

    socket.on('requestGameState', (data) => {
        const { lobbyId } = data;
        const game = activeGames.get(lobbyId);
        // Controlla se il gioco attivo è di tipo 'drawing' prima di rispondere
        // (Assumendo che tu abbia salvato un campo .type o .gameId nell'oggetto game)
        if (!game) return;

        socket.emit('gameState', {
            players: game.players,
            scores: game.scores,
            currentTurn: game.currentTurn,
            timer: game.timer,
            hint: game.hint,
            correctGuesses: game.correctGuesses,
            round: game.currentRound,
            totalRounds: game.totalRounds,
            currentWord: game.currentWord
        });
    });

    // --- Eventi specifici del gioco di disegno ---

    socket.on('wordSelected', (data) => {
        const { lobbyId, word } = data;
        const game = activeGames.get(lobbyId);
        if (!game || game.currentWord) return;

        game.currentWord = word;
        game.usedWords = game.usedWords || [];
        game.usedWords.push(word);
        game.hint = generateInitialHint(word);
        game.isActive = true;
        game.revealedIndices = new Set();
        game.hintRevealPlan = createHintRevealPlan(word, game.turnDuration);

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

        io.to(lobbyId).emit('clearCanvas');

        // Gestione Timer
        if (game.timerInterval) clearInterval(game.timerInterval);

        game.timerInterval = setInterval(() => {
            game.timer--;
            checkAndUpdateHint(io, lobbyId);

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

            if (game.timer <= 0 || (game.correctGuesses.length === game.players.length - 1)) {
                endTurn(io, lobbyId);
            }
        }, 1000);
    });

    socket.on('draw', (data) => {
        const { lobbyId, from, to, color, lineWidth } = data;
        socket.to(lobbyId).emit('drawLine', { from, to, color, lineWidth });
    });

    socket.on('clearCanvas', (data) => {
        const { lobbyId } = data;
        socket.to(lobbyId).emit('clearCanvas');
    });

    socket.on('fillArea', (data) => {
        const { lobbyId, startX, startY, color } = data;
        socket.to(lobbyId).emit('fillArea', { startX, startY, color });
    });

    socket.on('guess', (data) => {
        const { lobbyId, playerColor, guess } = data;
        const game = activeGames.get(lobbyId);

        // Verifica che il gioco esista e sia attivo
        if (!game || !game.isActive) return;

        if (playerColor === game.currentTurn) {
            socket.emit('message', { message: 'Sei tu l\'artista! Non puoi indovinare.', type: 'error' });
            return;
        }

        if (game.correctGuesses.includes(playerColor)) {
            socket.emit('message', { message: 'Hai già indovinato la parola!', type: 'info' });
            return;
        }

        const isCorrectGuess = guess.toLowerCase() === game.currentWord.toLowerCase();

        if (isCorrectGuess) {
            game.correctGuesses.push(playerColor);
            const position = game.correctGuesses.length - 1;
            const guessPoints = calculateGuessPoints(position);
            const artistBonus = 20;

            game.scores[playerColor] += guessPoints;
            game.scores[game.currentTurn] += artistBonus;

            const positionMessages = ['🥇 Primo posto!', '🥈 Secondo posto!', '🥉 Terzo posto!', '4° posto!', '5° posto!'];
            const positionMessage = positionMessages[Math.min(position, positionMessages.length - 1)];

            io.to(lobbyId).emit('message', {
                message: `${playerColor} ha indovinato! ${positionMessage} (+${guessPoints} punti)`,
                type: 'success'
            });
            io.to(lobbyId).emit('playCorrectSound');

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

            if (game.correctGuesses.length === game.players.length - 1) {
                endTurn(io, lobbyId);
            }
        } else {
            io.to(lobbyId).emit('message', {
                message: `${playerColor}: ${guess}`,
                type: 'chat'
            });
        }
    });
};