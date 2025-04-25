const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io')

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const lobbies = new Map();
const users = new Map();

app.get('/', (req, res) => {
    res.json({ messaggio: 'Tutto ok da index!' });
});

app.post('/create-lobby', (req, res) => {
    const { color } = req.body;
    const lobbyId = generateLobbyId();
    const lobby = {
        id: lobbyId,
        host: color,
        players: [color],
        createdAt: new Date()
    };

    lobbies.set(lobbyId, lobby);
    users.set(color, lobbyId);

    // Invece di reindirizzare, restituiamo un JSON con il redirect URL
    res.status(200).json({
        success: true,
        redirect: `/lobby.html?lobby=${lobbyId}&color=${color}`
    });
});

// API per ottenere info lobby
app.get('/api/lobby/:id', (req, res) => {
    const lobby = lobbies.get(req.params.id);
    if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
    res.json(lobby);
});

app.post('/join-lobby', (req, res) => {
    const { color, lobbyId } = req.body;

    if (!lobbies.has(lobbyId)) {
        return res.status(404).json({ error: 'Lobby not found' });
    }

    const lobby = lobbies.get(lobbyId);

    // Controlla se il colore è già utilizzato nella lobby
    if (lobby.players.includes(color)) {
        return res.status(400).json({ error: 'Color already taken in this lobby' });
    }

    lobby.players.push(color);
    users.set(color, lobbyId);

    res.json({ success: true, lobby });
});

// Aggiungi un endpoint per ottenere un link di invito
app.get('/api/invite/:lobbyId', (req, res) => {
    const lobbyId = req.params.lobbyId;

    if (!lobbies.has(lobbyId)) {
        return res.status(404).json({ error: 'Lobby not found' });
    }

    const inviteLink = `${req.protocol}://${req.get('host')}/index.html?join=${lobbyId}`;
    res.json({ inviteLink });
});


// ######################### GESTIONE WEBSOCKET ##########################################
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
        console.log(`Player ${playerColor} joined game ${gameId} in lobby ${lobbyId}`);

        // Verifica se la lobby esiste
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        // Se il gioco non è ancora iniziato, inizializzalo
        if (!activeGames.has(lobbyId)) {
            initializeGame(lobbyId, lobby.players);

            // Invia un messaggio che il gioco sta per iniziare
            io.to(lobbyId).emit('message', {
                message: 'Il gioco sta per iniziare!',
                type: 'system'
            });

            // Inizia il primo turno dopo 3 secondi
            setTimeout(() => {
                startNewTurn(lobbyId);
            }, 3000);
        }
    });

    // Quando l'artista seleziona una parola
    socket.on('wordSelected', (data) => {
        const { lobbyId, word } = data;
        const game = activeGames.get(lobbyId);

        if (!game || game.currentWord) return; // Ignora se il gioco non esiste o la parola è già stata selezionata

        game.currentWord = word;
        game.hint = generateInitialHint(word); // Inizialmente mostra solo underscore
        game.isActive = true;
        game.revealedIndices = new Set(); // Resetta le lettere rivelate

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
            currentWord: word  // Aggiungi la parola corrente qui
        });

        // Pulisci la lavagna
        io.to(lobbyId).emit('clearCanvas');

        // Imposta un intervallo per rivelare gradualmente le lettere (ogni 7 secondi)
        if (game.hintInterval) {
            clearInterval(game.hintInterval);
        }

        // Rivela una nuova lettera ogni 7 secondi
        game.hintInterval = setInterval(() => {
            updateHint(lobbyId);
        }, 7000);

        // Inizia il timer del gioco
        game.timerInterval = setInterval(() => {
            game.timer--;

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
                currentWord: word  // Aggiungi la parola corrente anche qui
            });

            // Se il timer arriva a 0 o tutti hanno indovinato, termina il turno
            if (game.timer <= 0 || (game.correctGuesses.length === game.players.length - 1)) {
                endTurn(lobbyId);
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
        const game = activeGames.get(lobbyId);

        if (!game || !game.isActive) return;

        // Ignora tentativi dell'artista
        if (playerColor === game.currentTurn) {
            socket.emit('message', {
                message: 'Sei tu l\'artista! Non puoi indovinare.',
                type: 'error'
            });
            return;
        }

        // Ignora i giocatori che hanno già indovinato
        if (game.correctGuesses.includes(playerColor)) {
            socket.emit('message', {
                message: 'Hai già indovinato la parola!',
                type: 'info'
            });
            return;
        }

        // Controlla se il tentativo è corretto (ignorando maiuscole/minuscole)
        const isCorrectGuess = guess.toLowerCase() === game.currentWord.toLowerCase();

        // Se la risposta è corretta
        if (isCorrectGuess) {
            // Aggiungi giocatore alla lista di chi ha indovinato
            game.correctGuesses.push(playerColor);

            // Aggiorna i punteggi
            game.scores[playerColor] += 100; // 100 punti per chi indovina
            game.scores[game.currentTurn] += 20; // 20 punti per l'artista

            // Invia un messaggio privato solo al giocatore che ha indovinato
            socket.emit('message', {
                message: `${playerColor}: ${guess}`,
                type: 'chat'
            });

            // Invia un messaggio a tutti che un giocatore ha indovinato, senza mostrare la parola
            io.to(lobbyId).emit('message', {
                message: `${playerColor} ha indovinato la parola!`,
                type: 'success'
            });

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
                endTurn(lobbyId);
            }
        } else {
            // Se la risposta è sbagliata, invia il messaggio a tutti
            io.to(lobbyId).emit('message', {
                message: `${playerColor}: ${guess}`,
                type: 'chat'
            });
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

    // Quando l'host seleziona un gioco
    socket.on('startGame', (data) => {
        const { lobbyId, gameId } = data;
        // Invia a tutti i client nella lobby (tranne il mittente)
        socket.to(lobbyId).emit('gameSelected', { gameId });
        console.log(`Gioco ${gameId} selezionato nella lobby ${lobbyId}`);
    });

    socket.on('disconnect', () => {
        console.log(`Il client con id: ${socket.id} si è disconnesso`);
    })

})

// ##################### GESTIONE DEL GIOCO DI DISEGNO #####################

// Database delle parole divise per difficoltà
const words = [
    // Parole che erano in "easy"
    'casa', 'cane', 'gatto', 'sole', 'luna', 'mare', 'libro', 'porta', 'albero', 'fiore',
    'palla', 'telefono', 'tavolo', 'cielo', 'scuola',
    'lampada', 'biscotto', 'rana', 'sedia', 'nuvola',
    'piuma', 'arancia', 'maglione', 'chiave', 'zaino',
    'cuscino', 'matita', 'forchetta', 'occhiali', 'scarpa',

    // Parole che erano in "medium"
    'computer', 'montagna', 'castello', 'finestra', 'elefante',
    'aereo', 'treno', 'pianoforte', 'chitarra', 'fragola',
    'spiaggia', 'ombrello', 'bottiglia',
    'bicicletta', 'pallone', 'specchio', 'tappeto', 'caramella',
    'naso', 'muro', 'caffè', 'dente', 'serpente',

    // Parole che erano in "hard"
    'astronauta', 'termometro', 'piramide', 'vulcano', 'dinosauro',
    'aquilone', 'mongolfiera', 'sottomarino', 'satellite', 'arcobaleno',
    'labirinto', 'paracadute',
    'drago', 'robot', 'pirata', 'scoiattolo', 'orologio',
    'barattolo', 'ponte', 'quaderno', 'stivale', 'fiume', 'cornice',

    // Puoi aggiungere altre parole qui
    'farfalla', 'ristorante', 'orchestra', 'cappello', 'spazzolino',
    'autobus', 'giraffa', 'coccodrillo', 'ambulanza', 'galleria',
    'castello', 'temporale', 'cipolla', 'guanto', 'bandiera',
    'passaporto', 'cavallo', 'mappa', 'chitarra', 'uovo',
    'semaforo', 'lampadina', 'lente', 'yogurt', 'cornetto'
];


// Gestione dei giochi in corso
const activeGames = new Map();

// Funzione per generare 3 parole casuali
function getRandomWords() {
    const result = [];
    const usedIndices = new Set();

    while (result.length < 3) {
        const index = Math.floor(Math.random() * words.length);
        if (!usedIndices.has(index)) {
            usedIndices.add(index);
            result.push(words[index]);
        }
    }

    return result;
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

// Funzione per inizializzare un nuovo gioco
function initializeGame(lobbyId, players, numRounds = 3) {
    const game = {
        lobbyId,
        players: [...players],
        scores: Object.fromEntries(players.map(player => [player, 0])),
        currentTurn: null,
        currentPlayer: 0,
        currentRound: 1,
        totalRounds: numRounds,
        currentWord: null,
        wordOptions: [],
        hint: null,
        timer: 60,
        isActive: false,
        correctGuesses: [],
        timerInterval: null,
        hintInterval: null,       // Nuovo: intervallo per aggiornare l'indizio
        revealedIndices: new Set() // Nuovo: tiene traccia delle lettere rivelate
    };

    activeGames.set(lobbyId, game);
    return game;
}

// Funzione per generare un hint iniziale (solo underscore)
function generateInitialHint(word) {
    return Array(word.length).fill('_').join(' ');
}

// Funzione per aggiornare l'indizio rivelando una nuova lettera casuale
function updateHint(lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game || !game.currentWord || !game.isActive) return;

    // Converti la parola in array di caratteri
    const chars = game.currentWord.split('');

    // Se abbiamo già rivelato tutte le lettere, ferma l'intervallo
    if (game.revealedIndices.size >= chars.length) {
        if (game.hintInterval) {
            clearInterval(game.hintInterval);
            game.hintInterval = null;
        }
        return;
    }

    // Scegli una posizione casuale da rivelare (che non è già stata rivelata)
    let randomIndex;
    do {
        randomIndex = Math.floor(Math.random() * chars.length);
    } while (game.revealedIndices.has(randomIndex));

    // Aggiungi l'indice all'insieme delle lettere rivelate
    game.revealedIndices.add(randomIndex);

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
    io.to(lobbyId).emit('gameState', {
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
}



// Funzione per iniziare un nuovo turno
function startNewTurn(lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;

    // Reimposta i valori per il nuovo turno
    game.currentWord = null;
    game.wordOptions = getRandomWords();
    game.timer = 60;
    game.correctGuesses = [];
    game.hint = null;

    // Seleziona il giocatore corrente
    game.currentTurn = game.players[game.currentPlayer];

    // Notifica a tutti lo stato del gioco
    io.to(lobbyId).emit('gameState', {
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

    // Invia le opzioni di parole solo all'artista
    io.to(lobbyId).emit('gameState', {
        players: game.players,
        scores: game.scores,
        currentTurn: game.currentTurn,
        timer: game.timer,
        wordOptions: game.wordOptions,
        hint: game.hint,
        correctGuesses: game.correctGuesses,
        round: game.currentRound,
        totalRounds: game.totalRounds,
        currentWord: game.currentWord  // Aggiungi la parola corrente qui
    });

    // Invia un messaggio a tutti
    io.to(lobbyId).emit('message', {
        message: `${game.currentTurn} è l'artista di questo turno!`,
        type: 'system'
    });
}

// Funzione per terminare un turno
function endTurn(lobbyId) {
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
            endGame(lobbyId);
            return;
        }
    }

    // Attendi 5 secondi prima di iniziare il prossimo turno
    setTimeout(() => {
        startNewTurn(lobbyId);
    }, 5000);
}

// Funzione per terminare il gioco
function endGame(lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;

    // Notifica a tutti che il gioco è finito
    io.to(lobbyId).emit('gameEnd', {
        players: game.players,
        finalScores: game.scores
    });

    // Rimuovi il gioco dalla lista dei giochi attivi
    activeGames.delete(lobbyId);
}

server.listen(3000, () => {
    console.log('Server listening on port 3000');
});

function generateLobbyId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}