require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');

const { Server } = require('socket.io')

const fs = require('fs');

const lobbyRoutes = require('./routes/lobbyRoutes');
const liveryRoutes = require('./routes/livery');
const { creaRouter: creaRotteStagioni } = require('./routes/f1Stagioni');
const socketManager = require('./sockets/socketManager');
const { strumentiDiSviluppoAttivi } = require('./config/ambiente');
const { intestazioniDiSicurezza, corsRistretto } = require('./middleware/sicurezzaHttp');


const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);


// ── Route DEV: salvataggio texture minimappa generata da minimap-gen.html ──
// Registrata PRIMA dei body-parser globali: il parser JSON di default (100kb)
// respingerebbe il PNG (~1-4 MB). Solo in locale: mai attiva in produzione.
if (strumentiDiSviluppoAttivi()) {
    const MM_PREFIX = 'data:image/png;base64,';
    app.post('/dev/minimap', express.json({ limit: '25mb' }), (req, res) => {
        const { png, meta } = req.body || {};
        if (typeof png !== 'string' || png.indexOf(MM_PREFIX) !== 0 ||
            !meta || !(meta.width > 0) || !(meta.maxX > meta.minX)) {
            return res.status(400).json({ error: 'payload non valido' });
        }
        const dir = path.join(__dirname, '..', 'frontend', 'assets', 'minimap');
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'world.png'),
                Buffer.from(png.slice(MM_PREFIX.length), 'base64'));
            fs.writeFileSync(path.join(dir, 'world.json'),
                JSON.stringify(meta, null, 2));
            console.log('🗺  Minimappa salvata in frontend/assets/minimap/');
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Segnalazioni in gioco (tasto M): stesso spirito di /dev/minimap, un
    // canale di sviluppo che scrive un file di lavoro. Mai in produzione.
    require('./dev/segnalazioniRoutes').registra(app);
}

// PRIMA dei parser globali: una livrea reale (~550 KB) sfonda il limite
// default di express.json() (100kb) — stesso motivo già documentato sopra
// per /dev/minimap.
app.use('/api/livery', express.json({ limit: '5mb' }));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(corsRistretto(cors));
app.use(intestazioniDiSicurezza);
app.use(express.static(path.join(__dirname, '..', 'frontend')));
// Usa le route modulari
app.use('/', lobbyRoutes);
app.use('/', liveryRoutes);
app.use('/', creaRotteStagioni());

// Socket.IO
socketManager(io);

// Errori del body-parser (payload troppo grande o JSON malformato) non
// passano dagli handler try/catch delle rotte — normalizziamo qui la
// risposta allo stesso formato JSON {"error": "..."} usato ovunque,
// invece della pagina HTML di default di Express.
app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.type === 'entity.parse.failed')) {
        return res.status(err.status || 400).json({ error: 'Corpo della richiesta non valido o troppo grande' });
    }
    next(err);
});

server.listen(3000, () => {
    console.log('✅ Server listening on port 3000');
});

/* const lobbies = new Map();
const users = new Map(); */

/* app.get('/', (req, res) => {
    res.json({ messaggio: 'Tutto ok da index!' });
});

app.post('/create-lobby', (req, res) => {
    const { color } = req.body;
    const lobbyId = generateLobbyId();
    const lobby = {
        id: lobbyId,
        host: color,
        players: [color],
        createdAt: new Date(),
        gameSettings: null // Aggiungi campo per le impostazioni del gioco
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
}); */


// ######################### GESTIONE WEBSOCKET ##########################################
/* io.on('connection', (socket) => {
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
            checkAndUpdateHint(lobbyId);

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

            // Calcola i punti in base alla posizione (0-based, quindi la posizione reale è +1)
            const position = game.correctGuesses.length - 1;
            const guessPoints = calculateGuessPoints(position);
            const artistBonus = 20; // Punti fissi per l'artista

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

            // Invia un messaggio privato solo al giocatore che ha indovinato
            socket.emit('message', {
                message: `${playerColor}: ${guess}`,
                type: 'chat'
            });

            // Invia un messaggio a tutti con posizione e punti
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
                endTurn(lobbyId);
            }
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
            startNewTurn(lobbyId);
        }, 3000);
    });

    socket.on('disconnect', () => {
        console.log(`Il client con id: ${socket.id} si è disconnesso`);
    })

}) */

// ##################### GESTIONE DEL GIOCO DI DISEGNO #####################

// Database delle parole divise per difficoltà
/* const wordsByDifficulty = JSON.parse(fs.readFileSync('./words.json', 'utf8'));
const endGame = [...wordsByDifficulty.easy, ...wordsByDifficulty.medium, ...wordsByDifficulty.hard]; */

// Gestione dei giochi in corso
/* const activeGames = new Map(); */

/* // Funzione per ottenere le impostazioni di default
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
} */

/* // Funzione per generare parole casuali in base alle impostazioni
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
function checkAndUpdateHint(lobbyId) {
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
        updateHintDisplay(game);

        console.log(`Lettera rivelata al secondo ${elapsedTime}: indice ${letterToReveal.index}`);
    }
}

// Funzione per aggiornare la visualizzazione dell'indizio
function updateHintDisplay(game) {
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
function startNewTurn(lobbyId) {
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

    console.log(`🏁 Gioco terminato per lobby ${lobbyId}. Punteggi finali:`, game.scores);

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
}); */

/* function generateLobbyId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
} */