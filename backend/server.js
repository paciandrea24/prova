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

        // Crea un piano per rivelare le lettere durante il turno
        game.hintRevealPlan = createHintRevealPlan(word, 60);

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
    'casa', 'astronauta', 'pizza', 'bicicletta', 'computer', 'sole', 'gatto', 'barca', 'drago', 'foresta',
    'telefono', 'fiume', 'cane', 'castello', 'lampada', 'gelato', 'treno', 'montagna', 'cactus', 'elefante',
    'robot', 'pianeta', 'sirena', 'vulcano', 'nuvola', 'tigre', 'pirata', 'magia', 'caramella', 'dinosauro',
    'aereo', 'mela', 'clown', 'nave', 'cielo', 'bruco', 'spada', 'scuola', 'trenino', 'vampiro',
    'zaino', 'panda', 'fata', 'circo', 'orologio', 'cappello', 'giungla', 'medusa', 'arco', 'bosco',
    'palla', 'matita', 'squalo', 'fantasma', 'luna', 'macchina', 'cervo', 'principessa', 'occhiali', 'balena',
    'deserto', 'ponte', 'gufo', 'libreria', 'trampolino', 'chitarra', 'aquilone', 'panino', 'zebra', 'fiore',
    'scimmia', 'castoro', 'bicchiere', 'sedia', 'scivolo', 'tenda', 'orco', 'zucchero', 'mongolfiera', 'penna',
    'barboncino', 'crociera', 'carrozza', 'microfono', 'scudo', 'occhio', 'satellite', 'piramide', 'serpente', 'scoiattolo',
    'nave spaziale', 'campanello', 'sottacqua', 'braccialetto', 'tempesta', 'ferrovia', 'maratoneta', 'televisore', 'flauto', 'pompiere',
    'scacchi', 'tempio', 'camaleonte', 'bancomat', 'muratore', 'giocoliere', 'batteria', 'tartaruga', 'vento', 'sottomarino',
    'giardino', 'muro', 'vaso', 'specchio', 'neve', 'castagna', 'nuotatore', 'albero', 'stella', 'vestito',
    'tavolo', 'banco', 'elicottero', 'pianoforte', 'scheletro', 'farfalla', 'ambulanza', 'camion', 'ombra', 'frigorifero',
    'trampoliere', 'zanzara', 'cuscino', 'pennello', 'pozzo', 'candela', 'porta', 'scarpa', 'barile', 'magnete',
    'bagnino', 'ragno', 'sabbia', 'tavolozza', 'vichingo', 'capra', 'leone', 'sedia a rotelle', 'barca a vela', 'cameriere',
    'treno merci', 'sedia da regista', 'cappuccetto rosso', 'pastore', 'balestra', 'cavalluccio marino', 'anatra', 'pipistrello', 'torre', 'ferro da stiro',
    'teatro', 'scarafaggio', 'scarabeo', 'piramide', 'pantera', 'fungo', 'pallone', 'bastone', 'bruco', 'giraffa',
    'scooter', 'sottomarino', 'spazzola', 'mummia', 'stregone', 'campione', 'miniera', 'orchestra', 'bagnoschiuma', 'vasca',
    'cigno', 'camaleonte', 'carota', 'lettino', 'passeggino', 'fiocco', 'torcia', 'orologio da tasca', 'razzo', 'lampione',
    'semaforo', 'spaventapasseri', 'cestino', 'ombrello', 'ventaglio', 'pappagallo', 'scacchiera', 'lanterna', 'prato', 'carro',
    'autobus', 'pianista', 'mozzarella', 'bicchiere di vino', 'scatola', 'serratura', 'portaombrelli', 'coperta', 'cappotto', 'ghepardo',
    'calzino', 'maglietta', 'zattera', 'dama', 'tridente', 'grattacielo', 'benzinaio', 'binocolo', 'collana', 'palestra',
    'valigia', 'pittura', 'pavone', 'giostra', 'pattini', 'secchio', 'carta', 'fiammifero', 'fumo', 'grano',
    'aratro', 'fattoria', 'serra', 'cintura', 'busto', 'pipa', 'foca', 'cerbiatto', 'pinguino', 'iguana',
    'strega', 'scheletro', 'cowboy', 'sergente', 're', 'regina', 'mago', 'giullare', 'samurai', 'ninja',
    'poeta', 'cantante', 'scrittore', 'regista', 'pilota', 'cavaliere', 'pescatore', 'contadino', 'panettiere', 'macellaio',
    'giardiniere', 'cuoco', 'insegnante', 'meccanico', 'fabbro', 'falegname', 'pittore', 'architetto', 'avvocato', 'dottore',
    'infermiere', 'pompiere', 'carabiniere', 'poliziotto', 'guardia', 'esploratore', 'scienziato', 'astronomo', 'biologo', 'geologo',
    'antropologo', 'archeologo', 'storico', 'matematico', 'programmatore', 'gamer', 'tuffatore', 'giocatore di basket', 'surfista', 'sciatore',
    'pattinatore', 'tennista', 'calciatore', 'cestista', 'corridore', 'nuotatore', 'pugile', 'arciere', 'cacciatore', 'paziente',
    'fantino', 'contorsionista', 'illusionista', 'puparo', 'burattinaio', 'pastore', 'pellegrino', 'cercatore d’oro', 'cosmonauta', 'monaco',
    'pirata', 'corsaro', 'mercante', 'narratore', 'viaggiatore', 'turista', 'esploratore polare', 'speleologo', 'paracadutista', 'vigile urbano',
    'cassiere', 'commesso', 'bibliotecario', 'barista', 'rappresentante', 'venditore ambulante', 'ambulante', 'mendicante', 'spazzino', 'operatore ecologico',
    'cucciolo', 'gattino', 'cagnolino', 'pulcino', 'anatroccolo', 'colibrì', 'struzzo', 'orso', 'cervo volante', 'falco',
    'aquila', 'pipistrello', 'lucertola', 'rana', 'rospo', 'serpente', 'vipera', 'anguria', 'fragola', 'mirtillo',
    'cocco', 'banana', 'ciliegia', 'pera', 'pesca', 'melone', 'susina', 'uva', 'lampone', 'mango',
    'kiwi', 'ananas', 'mandarino', 'pomodoro', 'carciofo', 'sedano', 'zucchina', 'peperone', 'melanzana', 'patata',
    'cipolla', 'aglio', 'carota', 'rapa', 'zucca', 'spinacio', 'broccolo', 'cavolfiore', 'lattuga', 'ravanello',
    'barbabietola', 'asparago', 'funghetto', 'basilico', 'rosmarino', 'origano', 'menta', 'salvia', 'timo', 'alloro',
    'cetriolo', 'finocchio', 'prezzemolo', 'cocomero', 'nocciola', 'mandorla', 'noce', 'pistacchio', 'arachide', 'castagna',
    'scopa', 'martello', 'cacciavite', 'sega', 'trapano', 'pialla', 'scalpello', 'pinza', 'chiave inglese', 'livella',
    'metro', 'calibro', 'tenaglia', 'taglierino', 'forbici', 'coltello', 'rastrello', 'zappa', 'pala', 'vanga'
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
        hintInterval: null,       // Intervallo per aggiornare l'indizio
        revealedIndices: new Set(), // Tiene traccia delle lettere rivelate
        nextRevealTime: null,     // Prossimo momento in cui rivelare una lettera
        hintRevealPlan: []        // Piano di rivelazione delle lettere
    };

    activeGames.set(lobbyId, game);
    return game;
}

// Funzione per generare un hint iniziale (solo underscore)
function generateInitialHint(word) {
    return Array(word.length).fill('_').join(' ');
}

// Funzione per creare un piano di rivelazione delle lettere
function createHintRevealPlan(word, totalTimeInSeconds) {
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

    // Tempo rimanente in questo turno
    const elapsedTime = 60 - game.timer;

    // Controlla se è il momento di rivelare una nuova lettera
    const letterToReveal = game.hintRevealPlan.find(item => item.revealAt === elapsedTime);

    if (letterToReveal) {
        // Aggiungi l'indice all'insieme delle lettere rivelate
        game.revealedIndices.add(letterToReveal.index);

        // Crea l'indizio aggiornato
        updateHintDisplay(game);
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