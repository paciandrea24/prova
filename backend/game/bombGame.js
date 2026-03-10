const fs = require('fs');
const path = require('path');
const { activeGames } = require('../store/activeGames');

// Variabili per contenere il dizionario
let dictionarySet = new Set();
let dictionaryArray = [];

// Caricamento del dizionario all'avvio del server
try {
    const dictPath = path.join(__dirname, '../data/dizionario.txt');
    const fileContent = fs.readFileSync(dictPath, 'utf-8');

    // Pulisci le righe, metti tutto in maiuscolo e scarta le parole troppo corte (meno di 3 lettere)
    dictionaryArray = fileContent.split('\n')
        .map(w => w.trim().toUpperCase())
        .filter(w => w.length > 2);

    // Il Set serve per la ricerca ultra-veloce (Validazione della parola)
    // L'Array serve per pescare parole a caso (Generazione sillabe)
    dictionarySet = new Set(dictionaryArray);

    console.log(`💣 Dizionario Bomba caricato: ${dictionarySet.size} parole.`);
} catch (error) {
    console.error("⚠️ ERRORE: File dizionario.txt non trovato in backend/data/. Uso dizionario di fallback.");
    dictionaryArray = ["CANE", "CASA", "CARTA", "PECAN", "SCATOLA", "SBARRA", "SBAGLIO", "MENTE", "TORMENTO"];
    dictionarySet = new Set(dictionaryArray);
}

// --- FUNZIONE GENERATRICE DI SILLABE REALI ---
// --- FUNZIONE GENERATRICE DI SILLABE (MIGLIORATA) ---
function generateValidSyllable(usedWords = []) {
    if (dictionaryArray.length === 0) return "CA";

    let validSyllable = "";
    let possibleAnswers = 0;

    // Riprova finché non trova una sillaba che ha ALMENO 15 parole possibili nel dizionario
    while (possibleAnswers < 15) {
        let randomWord = "";
        while (randomWord.length < 5) {
            randomWord = dictionaryArray[Math.floor(Math.random() * dictionaryArray.length)];
        }

        // Estrai 2 o 3 lettere
        const pieceLength = Math.random() > 0.3 ? 2 : 3;
        const startIndex = Math.floor(Math.random() * (randomWord.length - pieceLength + 1));
        validSyllable = randomWord.substring(startIndex, startIndex + pieceLength);

        // Conta velocemente quante parole contengono questa sillaba
        possibleAnswers = 0;
        for (let i = 0; i < dictionaryArray.length; i++) {
            if (dictionaryArray[i].includes(validSyllable) && !usedWords.includes(dictionaryArray[i])) {
                possibleAnswers++;
                if (possibleAnswers >= 15) break; // Ottimizzazione: appena arriva a 15 si ferma
            }
        }
    }

    return validSyllable;
}

function getDefaultGameSettings(gameId) {
    return {
        maxLives: 3,
        initialTimer: 10,
        minTimer: 3,
        timerDecrease: 0.5 // Quanti secondi togliere ad ogni passaggio
    };
}

function initializeGame(lobbyId, players, gameId, settings) {
    const defaultSettings = getDefaultGameSettings(gameId);
    // Unisce le impostazioni inviate dalla lobby con i parametri vitali di default
    const mergedSettings = { ...defaultSettings, ...settings };

    // Si assicura che i valori siano formattati come numeri
    mergedSettings.maxLives = parseInt(mergedSettings.maxLives, 10) || 3;
    mergedSettings.initialTimer = parseInt(mergedSettings.initialTimer, 10) || 10;

    // Inizializza le vite per ogni giocatore
    const lives = {};
    players.forEach(p => lives[p] = mergedSettings.maxLives);

    const game = {
        gameId: gameId,
        type: gameId,
        players: [...players],
        activePlayers: [...players], // Chi è ancora vivo
        lives: lives,
        currentTurnIndex: 0,
        currentTurn: players[0], // Colore del giocatore corrente
        currentSyllable: '',
        usedWords: [],
        explosionCount: 0,
        timer: mergedSettings.initialTimer,
        settings: mergedSettings,
        isActive: false,
        timeoutId: null // Per far esplodere la bomba
    };

    activeGames.set(lobbyId, game);
    return game;
}

function startNewTurn(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;

    // Genera una sillaba estratta da una parola vera!
    game.currentSyllable = generateValidSyllable();
    game.usedWords = [];
    game.timer = game.settings.initialTimer;
    game.isActive = true;

    emitGameState(io, lobbyId, game);
    startBombTimer(io, lobbyId, game);
}

function startBombTimer(io, lobbyId, game) {
    if (game.timeoutId) clearTimeout(game.timeoutId);

    // Impostiamo il timer per l'esplosione
    game.timeoutId = setTimeout(() => {
        explodeBomb(io, lobbyId, game);
    }, game.timer * 1000);
}

function processGuess(io, lobbyId, playerColor, word) {
    const game = activeGames.get(lobbyId);
    if (!game || !game.isActive) return { success: false, message: 'Gioco non attivo' };
    if (game.currentTurn !== playerColor) return { success: false, message: 'Non è il tuo turno!' };

    const upperWord = word.trim().toUpperCase();

    // 1. Contiene la sillaba?
    if (!upperWord.includes(game.currentSyllable)) {
        return { success: false, message: `Deve contenere: ${game.currentSyllable}` };
    }

    // 2. È già stata usata?
    if (game.usedWords.includes(upperWord)) {
        return { success: false, message: 'Parola già usata!' };
    }

    // 3. Esiste nel dizionario?
    if (!dictionarySet.has(upperWord)) {
        return { success: false, message: 'Parola non valida!' };
    }

    // PAROLA CORRETTA!
    clearTimeout(game.timeoutId);
    game.usedWords.push(upperWord);

    // Riduci il timer per mettere ansia
    game.timer = Math.max(game.settings.minTimer, game.timer - game.settings.timerDecrease);

    // Passa al prossimo giocatore VIVO
    game.currentTurnIndex = (game.currentTurnIndex + 1) % game.activePlayers.length;
    game.currentTurn = game.activePlayers[game.currentTurnIndex];

    // Invia il successo
    io.to(lobbyId).emit('wordAccepted', { word: upperWord, playerColor });

    // CAMBIA LA SILLABA PER IL PROSSIMO GIOCATORE (Passando le parole usate)
    game.currentSyllable = generateValidSyllable(game.usedWords);
    game.explosionCount = 0; // <--- AZZERA IL CONTATORE DELLE ESPLOSIONI

    emitGameState(io, lobbyId, game);
    startBombTimer(io, lobbyId, game);

    return { success: true };
}

function explodeBomb(io, lobbyId, game) {
    game.isActive = false;
    const loser = game.currentTurn;

    game.lives[loser] -= 1;

    let isGameOver = false;

    // Se il giocatore muore
    if (game.lives[loser] <= 0) {
        game.activePlayers = game.activePlayers.filter(p => p !== loser);

        // Se rimane solo uno, vince!
        if (game.activePlayers.length <= 1) {
            isGameOver = true;
        } else {
            // Aggiusta l'indice del turno se qualcuno muore
            game.currentTurnIndex = game.currentTurnIndex % game.activePlayers.length;
        }
    } else {
        // SE SOPRAVVIVE: Il turno passa comunque al giocatore successivo!
        game.currentTurnIndex = (game.currentTurnIndex + 1) % game.activePlayers.length;
    }

    // Aumenta il contatore delle esplosioni per questa sillaba
    game.explosionCount += 1;

    io.to(lobbyId).emit('bombExploded', { loser: loser, livesLeft: game.lives[loser] });

    if (isGameOver) {
        setTimeout(() => {
            io.to(lobbyId).emit('gameEnd', { winner: game.activePlayers[0], lives: game.lives });
        }, 3000);
    } else {
        // Pausa drammatica, poi si riparte per il prossimo giocatore
        setTimeout(() => {
            game.currentTurn = game.activePlayers[game.currentTurnIndex];

            // CONTROLLO LOOP DELLA MORTE: È scoppiata a tutti?
            if (game.explosionCount >= game.activePlayers.length) {
                game.currentSyllable = generateValidSyllable(game.usedWords);
                game.explosionCount = 0; // Resetta il contatore
                game.usedWords = []; // Svuota lo storico dato che la sillaba è nuova
            } else {
                // Se non cambiamo sillaba, svuotiamo comunque le parole usate per dare più chance?
                // (Opzionale: puoi lasciare game.usedWords intatto per rendere il gioco punitivo)
                game.usedWords = [];
            }

            game.timer = game.settings.initialTimer;
            game.isActive = true;

            emitGameState(io, lobbyId, game);
            startBombTimer(io, lobbyId, game);
        }, 4000);
    }
}

function emitGameState(io, lobbyId, game) {
    io.to(lobbyId).emit('gameState', {
        players: game.players,
        activePlayers: game.activePlayers,
        lives: game.lives,
        maxLives: game.settings.maxLives, // <--- AGGIUNTO per calcolare i cuori
        currentTurn: game.currentTurn,
        syllable: game.currentSyllable,
        timer: game.timer,
        isActive: game.isActive
    });
}

module.exports = {
    getDefaultGameSettings,
    initializeGame,
    startNewTurn,
    processGuess
};