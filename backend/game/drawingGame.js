const { activeGames } = require('../store/activeGames');
const { allWords, wordsByDifficulty } = require('../config/words');
const { lobbies } = require('../store/lobbies');


// Funzione per ottenere le impostazioni di default
function getDefaultGameSettings(gameId) {
    switch (gameId) {
        case 'drawing':
            return {
                rounds: '3',
                time: '60',
                difficulty: 'medium'
            };
        case 'quiz':
            return {
                questions: '10',
                time: '30',
                category: 'general'
            };
        default:
            return {};
    }
}

// Funzione per generare parole casuali in base alle impostazioni
function getRandomWords(difficulty = 'medium', count = 3, exclude = []) {
    let wordPool;

    switch (difficulty) {
        case 'easy': wordPool = wordsByDifficulty.easy; break;
        case 'medium': wordPool = wordsByDifficulty.medium; break;
        case 'hard': wordPool = wordsByDifficulty.hard; break;
        case 'mixed': wordPool = allWords; break;
        default: wordPool = wordsByDifficulty.medium;
    }

    // Filtra le parole già usate
    const filtered = wordPool.filter(word => !exclude.includes(word));

    const result = [];
    const usedIndices = new Set();

    while (result.length < count && result.length < filtered.length) {
        const index = Math.floor(Math.random() * filtered.length);
        if (!usedIndices.has(index)) {
            usedIndices.add(index);
            result.push(filtered[index]);
        }
    }

    return result;
}

function calculateGuessPoints(position) {
    const pointsTable = [100, 80, 60, 40, 20]; // 1°, 2°, 3°, 4°, 5°+
    return pointsTable[Math.min(position, pointsTable.length - 1)];
}

// Funzione per generare un hint (parola con lettere nascoste)
function generateHint(word, percentRevealed = 0.3) {
    // Converti la parola in array di caratteri per manipolarla facilmente
    const chars = word.split('');

    // Calcola quante lettere rivelare (minimo 1)
    const numToReveal = Math.max(1, Math.floor(chars.length * percentRevealed));

    // Scegli posizioni casuali da rivelare
    const positions = new Set();
    while (positions.size < numToReveal) {
        const pos = Math.floor(Math.random() * chars.length);
        positions.add(pos);
    }

    // Crea l'hint sostituendo le lettere non rivelate con "_"
    const hint = chars.map((char, index) => {
        if (positions.has(index)) {
            return char;
        }
        return '_';
    }).join(' ');

    return hint;
}

// AGGIORNATA: Funzione per inizializzare un nuovo gioco con controllo migliore delle impostazioni
function initializeGame(lobbyId, players, gameId, settings) {
    console.log(`🎮 Inizializzando gioco nella lobby ${lobbyId}:`);
    console.log(`- GameID: ${gameId}`);
    console.log(`- Players: ${players.join(', ')}`);
    console.log(`- Impostazioni ricevute:`, settings);

    // Parsing delle impostazioni in base al tipo di gioco con validazione
    let gameConfig = {};

    if (gameId === 'drawing') {
        // Validazione e parsing delle impostazioni del gioco di disegno
        const rounds = parseInt(settings.rounds);
        const time = parseInt(settings.time);
        const difficulty = settings.difficulty;

        gameConfig = {
            totalRounds: isNaN(rounds) ? 3 : Math.max(1, Math.min(10, rounds)), // Tra 1 e 10
            turnDuration: isNaN(time) ? 60 : Math.max(30, Math.min(180, time)), // Tra 30 e 180 secondi
            difficulty: ['easy', 'medium', 'hard', 'mixed'].includes(difficulty) ? difficulty : 'medium'
        };

        console.log(`✅ Configurazione gioco di disegno:`, {
            rounds: `${settings.rounds} -> ${gameConfig.totalRounds}`,
            time: `${settings.time} -> ${gameConfig.turnDuration}`,
            difficulty: `${settings.difficulty} -> ${gameConfig.difficulty}`
        });
    } else if (gameId === 'quiz') {
        const questions = parseInt(settings.questions);
        const time = parseInt(settings.time);
        const category = settings.category;

        gameConfig = {
            totalQuestions: isNaN(questions) ? 10 : Math.max(5, Math.min(50, questions)),
            questionTime: isNaN(time) ? 30 : Math.max(10, Math.min(120, time)),
            category: category || 'general'
        };

        console.log(`✅ Configurazione quiz:`, gameConfig);
    }

    const game = {
        lobbyId,
        gameId,
        players: [...players],
        scores: Object.fromEntries(players.map(player => [player, 0])),
        currentTurn: null,
        currentPlayer: 0,
        currentRound: 1,
        totalRounds: gameConfig.totalRounds || 3,
        turnDuration: gameConfig.turnDuration || 60,
        difficulty: gameConfig.difficulty || 'medium',
        currentWord: null,
        wordOptions: [],
        hint: null,
        timer: gameConfig.turnDuration || 60,
        isActive: false,
        correctGuesses: [],
        timerInterval: null,
        hintInterval: null,
        revealedIndices: new Set(),
        nextRevealTime: null,
        hintRevealPlan: [],
        settings: settings // Salva le impostazioni originali per riferimento futuro
    };

    activeGames.set(lobbyId, game);

    console.log(`🚀 Gioco inizializzato con successo:`, {
        lobbyId,
        gameId,
        totalRounds: game.totalRounds,
        turnDuration: game.turnDuration,
        difficulty: game.difficulty,
        playersCount: game.players.length
    });

    return game;
}

// Funzione per generare un hint iniziale (solo underscore)
function generateInitialHint(word) {
    return Array(word.length).fill('_').join(' ');
}

// AGGIORNATA: Funzione per creare un piano di rivelazione delle lettere con debug
function createHintRevealPlan(word, totalTimeInSeconds) {
    console.log(`Creando piano di rivelazione per parola "${word}" con timer di ${totalTimeInSeconds} secondi`);

    const letterCount = word.length;

    // Manteniamo almeno l'ultima lettera nascosta fino alla fine o quasi
    // Per parole molto corte (2-3 lettere), riveleremo massimo 1 lettera
    // Per parole più lunghe, riveleremo progressivamente fino a lasciare ~20% nascosto

    let lettersToReveal;
    if (letterCount <= 3) {
        lettersToReveal = 1; // Per parole molto corte, rivela solo 1 lettera
    } else if (letterCount <= 5) {
        lettersToReveal = letterCount - 2; // Per parole corte, lascia 2 lettere nascoste
    } else {
        lettersToReveal = Math.ceil(letterCount * 0.8); // Rivela l'80% delle lettere
    }

    // Non rivelare mai tutto
    lettersToReveal = Math.min(lettersToReveal, letterCount - 1);

    // Crea una lista di indici casuali da rivelare
    const indices = Array.from({ length: letterCount }, (_, i) => i);
    shuffleArray(indices); // Mescola gli indici

    const revealPlan = [];
    const indicesForHint = indices.slice(0, lettersToReveal);

    // Determina quando rivelare ogni lettera
    if (lettersToReveal > 0) {
        // Distribuisce le rivelazioni in modo più uniforme
        // Lasciando più tempo all'inizio per permettere ai giocatori di indovinare

        // Il primo 30% del tempo non rivela nulla
        const noRevealTime = totalTimeInSeconds * 0.3;

        // Tempo rimanente per rivelare le lettere
        const revealTime = totalTimeInSeconds - noRevealTime;

        // Intervallo tra le rivelazioni
        const interval = revealTime / lettersToReveal;

        for (let i = 0; i < lettersToReveal; i++) {
            const revealAt = Math.floor(noRevealTime + interval * i);
            revealPlan.push({
                index: indicesForHint[i],
                revealAt: revealAt
            });
        }
    }

    console.log(`Piano di rivelazione creato:`, revealPlan);
    return revealPlan;
}

// Utility per mescolare un array
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Funzione per aggiornare l'indizio in base al timer
function checkAndUpdateHint(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game || !game.currentWord || !game.isActive || !game.hintRevealPlan) return;

    // Tempo rimanente in questo turno (usa il timer personalizzato)
    const elapsedTime = game.turnDuration - game.timer;

    // Controlla se è il momento di rivelare una nuova lettera
    const letterToReveal = game.hintRevealPlan.find(item => item.revealAt === elapsedTime);

    if (letterToReveal) {
        // Aggiungi l'indice all'insieme delle lettere rivelate
        game.revealedIndices.add(letterToReveal.index);

        // Crea l'indizio aggiornato
        updateHintDisplay(io, game);

        console.log(`Lettera rivelata al secondo ${elapsedTime}: indice ${letterToReveal.index}`);
    }
}

// Funzione per aggiornare la visualizzazione dell'indizio
function updateHintDisplay(io, game) {
    const chars = game.currentWord.split('');

    // Crea l'indizio aggiornato
    const updatedHint = chars.map((char, index) => {
        if (game.revealedIndices.has(index)) {
            return char;
        }
        return '_';
    }).join(' ');

    // Aggiorna l'indizio nel gioco
    game.hint = updatedHint;

    // Invia l'indizio aggiornato a tutti i giocatori
    io.to(game.lobbyId).emit('gameState', {
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
}

// AGGIORNATA: Funzione per iniziare un nuovo turno con debug delle impostazioni
function startNewTurn(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) {
        console.log(`❌ Impossibile iniziare turno: gioco non trovato per lobby ${lobbyId}`);
        return;
    }

    console.log(`🎯 Iniziando nuovo turno per lobby ${lobbyId}:`);
    console.log(`- Round: ${game.currentRound}/${game.totalRounds}`);
    console.log(`- Timer: ${game.turnDuration}s`);
    console.log(`- Difficoltà: ${game.difficulty}`);
    console.log(`- Giocatore corrente: ${game.currentPlayer}`);
    console.log(`- Players: ${game.players.join(', ')}`);

    // Reimposta i valori per il nuovo turno usando le impostazioni personalizzate
    game.currentWord = null;
    console.log(`🧪 Generazione parole (turno): difficoltà = ${game.difficulty}`);
    game.wordOptions = getRandomWords(game.difficulty, 3, game.usedWords || []);

    game.timer = game.turnDuration; // Usa il timer personalizzato
    game.correctGuesses = [];
    game.hint = null;

    // Seleziona il giocatore corrente
    game.currentTurn = game.players[game.currentPlayer];

    console.log(`✅ Turno configurato:`);
    console.log(`- Artista: ${game.currentTurn}`);
    console.log(`- Parole generate (${game.difficulty}):`, game.wordOptions);

    // Notifica a tutti lo stato del gioco
    const gameStateForAll = {
        players: game.players,
        scores: game.scores,
        currentTurn: game.currentTurn,
        timer: game.timer,
        hint: game.hint,
        correctGuesses: game.correctGuesses,
        round: game.currentRound,
        totalRounds: game.totalRounds,
        currentWord: game.currentWord
    };

    console.log(`📤 Inviando gameState a tutti i giocatori:`, gameStateForAll);
    io.to(lobbyId).emit('gameState', gameStateForAll);

    // Invia le opzioni di parole a tutti (il frontend filtrerà per l'artista)
    const gameStateWithWords = {
        ...gameStateForAll,
        wordOptions: game.wordOptions
    };

    console.log(`📤 Inviando gameState con parole:`, gameStateWithWords);
    io.to(lobbyId).emit('gameState', gameStateWithWords);

    // Invia un messaggio a tutti
    io.to(lobbyId).emit('message', {
        message: `${game.currentTurn} è l'artista di questo turno!`,
        type: 'system'
    });

    console.log(`✅ Turno avviato con successo per lobby ${lobbyId}`);
}

// Funzione per terminare un turno
function endTurn(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;

    // Ferma il timer
    if (game.timerInterval) {
        clearInterval(game.timerInterval);
        game.timerInterval = null;
    }

    // Ferma l'intervallo degli indizi
    if (game.hintInterval) {
        clearInterval(game.hintInterval);
        game.hintInterval = null;
    }

    // Notifica a tutti che il turno è finito
    io.to(lobbyId).emit('roundEnd', {
        word: game.currentWord,
        newScores: game.scores
    });

    // Passa al giocatore successivo
    game.currentPlayer = (game.currentPlayer + 1) % game.players.length;

    // Se tutti i giocatori hanno avuto il loro turno, passa al round successivo
    if (game.currentPlayer === 0) {
        game.currentRound++;

        // Se abbiamo raggiunto il numero massimo di round, termina il gioco
        if (game.currentRound > game.totalRounds) {
            endGame(io, lobbyId);
            return;
        }
    }

    // Attendi 5 secondi prima di iniziare il prossimo turno
    setTimeout(() => {
        startNewTurn(io, lobbyId);
    }, 5000);
}

// Funzione per terminare il gioco
function endGame(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;

    // 1. Recuperiamo la lobby per sapere chi è l'host
    const lobby = lobbies.get(lobbyId);
    const hostColor = lobby ? lobby.host : null;

    console.log(`🏁 Gioco terminato per lobby ${lobbyId}. Punteggi finali:`, game.scores);

    // 2. Invia i punteggi E il colore dell'host a tutti
    io.to(lobbyId).emit('gameEnd', {
        players: game.players,
        finalScores: game.scores,
        hostColor: hostColor // <-- Ora il frontend saprà chi è l'host!
    });

    // Rimuovi il gioco dalla lista dei giochi attivi
    activeGames.delete(lobbyId);
}

module.exports = {
    initializeGame,
    startNewTurn,
    endTurn,
    endGame,
    generateHint,
    calculateGuessPoints,
    generateInitialHint,
    createHintRevealPlan,
    checkAndUpdateHint,
    updateHintDisplay,
    getDefaultGameSettings,
    getRandomWords,
    shuffleArray
};
