document.addEventListener('DOMContentLoaded', () => {
    // Recupera i parametri dalla URL
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const playerColor = urlParams.get('color');
    const gameId = urlParams.get('game');

    if (!lobbyId || !playerColor || !gameId) {
        window.location.href = '/';
        return;
    }

    // Riferimenti agli elementi del DOM
    const timerText = document.querySelector('.timer-text');
    const hintText = document.querySelector('.hint');
    const currentRoundText = document.getElementById('current-round');
    const totalRoundsText = document.getElementById('total-rounds');
    const messagesBox = document.querySelector('.messages-box');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const canvasBox = document.querySelector('.canvas-box');
    const standingBox = document.querySelector('.players-ul');
    const artistNotification = document.getElementById('artist-notification');
    const gameEndModal = document.getElementById('game-end-modal');
    const roundEndModal = document.getElementById('round-end-modal');
    const revealedWordElement = document.getElementById('revealed-word');
    const backToLobbyBtn = document.getElementById('back-to-lobby');

    // Crea il canvas per il disegno
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    canvasBox.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    // Inizializza il canvas con sfondo bianco
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Inizializza le variabili per il disegno
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let currentColor = playerColor;
    let currentLineWidth = 5;
    let amIArtist = false;

    // Connessione Socket.io
    const socket = io();

    // Unisciti alla lobby
    socket.emit('joinLobby', lobbyId);

    // Unisciti al gioco
    socket.emit('joinGame', { lobbyId, gameId, playerColor });

    // Richiedi lo stato attuale del gioco
    socket.emit('requestGameState', { lobbyId });

    // Gestione degli eventi di disegno
    function startDrawing(e) {
        if (!amIArtist) return;  // Solo l'artista può disegnare

        isDrawing = true;
        [lastX, lastY] = getMousePos(canvas, e);
    }

    function draw(e) {
        if (!isDrawing || !amIArtist) return;  // Solo l'artista può disegnare

        const [x, y] = getMousePos(canvas, e);

        // Disegna localmente
        drawLine(ctx, lastX, lastY, x, y, currentColor, currentLineWidth);

        // Invia il disegno agli altri giocatori
        socket.emit('draw', {
            lobbyId,
            from: { x: lastX, y: lastY },
            to: { x, y },
            color: currentColor,
            lineWidth: currentLineWidth
        });

        [lastX, lastY] = [x, y];
    }

    function stopDrawing() {
        isDrawing = false;
    }

    // Funzione helper per ottenere la posizione del mouse rispetto al canvas
    function getMousePos(canvas, evt) {
        const rect = canvas.getBoundingClientRect();
        return [
            (evt.clientX - rect.left) / (rect.right - rect.left) * canvas.width,
            (evt.clientY - rect.top) / (rect.bottom - rect.top) * canvas.height
        ];
    }

    // Funzione per disegnare una linea
    function drawLine(context, x1, y1, x2, y2, color, width) {
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.strokeStyle = color;
        context.lineWidth = width;
        context.lineCap = 'round';
        context.stroke();
    }

    // Aggiunta di eventi al canvas
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    // Touch events for mobile
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startDrawing(e.touches[0]);
    });
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        draw(e.touches[0]);
    });
    canvas.addEventListener('touchend', stopDrawing);

    // Gestione degli eventi socket
    socket.on('gameState', (state) => {
        // Aggiorna lo stato del gioco nella UI
        updateGameState(state);
    });

    socket.on('drawLine', (data) => {
        // Disegna le linee ricevute dagli altri giocatori
        drawLine(
            ctx,
            data.from.x,
            data.from.y,
            data.to.x,
            data.to.y,
            data.color,
            data.lineWidth
        );
    });

    socket.on('clearCanvas', () => {
        // Pulisci il canvas
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    });

    socket.on('message', (data) => {
        // Aggiungi messaggi alla chat
        addMessage(data.message, data.type);
    });

    socket.on('roundEnd', (data) => {
        // Mostra la parola e i punteggi alla fine del round
        revealedWordElement.textContent = data.word;

        // Mostra il modal di fine round
        roundEndModal.style.display = 'flex';

        // Nasconde il modal dopo 5 secondi (come nella logica del server)
        setTimeout(() => {
            roundEndModal.style.display = 'none';
        }, 4500);

        // Pulisci il canvas
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    });

    socket.on('gameEnd', (data) => {
        // Mostra i punteggi finali del gioco
        const finalStandings = document.getElementById('final-standings');
        finalStandings.innerHTML = '';

        // Crea un array di [color, score] e ordinalo per punteggio decrescente
        const sortedPlayers = Object.entries(data.finalScores)
            .sort((a, b) => b[1] - a[1]);

        // Crea la classifica finale
        sortedPlayers.forEach((player, index) => {
            const playerEntry = document.createElement('div');
            playerEntry.className = 'final-player-entry';

            const colorDiv = document.createElement('div');
            colorDiv.className = 'avatar-color';
            colorDiv.style.backgroundColor = player[0];
            colorDiv.style.width = '20px';
            colorDiv.style.height = '20px';
            colorDiv.style.display = 'inline-block';
            colorDiv.style.marginRight = '10px';
            colorDiv.style.borderRadius = '50%';

            const position = document.createElement('span');
            position.textContent = `${index + 1}. `;

            const score = document.createElement('span');
            score.textContent = ` - ${player[1]} points`;

            // Evidenzia il giocatore corrente
            if (player[0] === playerColor) {
                playerEntry.style.fontWeight = 'bold';
            }

            playerEntry.appendChild(position);
            playerEntry.appendChild(colorDiv);
            playerEntry.appendChild(score);
            finalStandings.appendChild(playerEntry);
        });

        // Mostra il modal di fine gioco
        gameEndModal.style.display = 'flex';
    });

    // Evento per tornare alla lobby
    backToLobbyBtn.addEventListener('click', () => {
        window.location.href = `/lobby.html?lobby=${lobbyId}&color=${playerColor}`;
    });

    // Gestione del form di chat per indovinare
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const guess = chatInput.value.trim();
        if (!guess) return;

        // Invia il tentativo di indovinello
        socket.emit('guess', {
            lobbyId,
            playerColor,
            guess
        });

        // Pulisci l'input
        chatInput.value = '';
    });

    // Funzione per aggiornare lo stato del gioco nella UI
    function updateGameState(state) {
        // Aggiorna il timer
        timerText.textContent = `${state.timer}s`;

        // Aggiorna l'indizio
        if (state.hint) {
            hintText.textContent = state.hint;
        }

        // Aggiorna le informazioni sul round
        if (state.round) {
            currentRoundText.textContent = state.round;
        }

        if (state.totalRounds) {
            totalRoundsText.textContent = state.totalRounds;
        }

        // Verifica se sono l'artista di questo turno
        const wasArtist = amIArtist; // Salva lo stato precedente
        amIArtist = state.currentTurn === playerColor;

        // Se sono appena diventato l'artista
        if (!wasArtist && amIArtist) {
            // Mostra notifica
            artistNotification.innerHTML = '<h3>Sei l\'artista di questo turno!</h3>';
            artistNotification.style.display = 'block';

            setTimeout(() => {
                artistNotification.style.display = 'none';
            }, 3000);
        }

        // Aggiorna la UI per l'artista o per chi deve indovinare
        updateUIForRole(amIArtist);

        // Se sono l'artista e ci sono opzioni di parole disponibili, mostrare la selezione
        if (amIArtist && state.wordOptions && state.wordOptions.length > 0) {
            showWordSelection(state.wordOptions);
        }

        // Aggiorna la classifica
        updateStandings(state.players, state.scores, state.currentTurn);
    }

    // Aggiorna UI in base al ruolo (artista o indovinatore)
    function updateUIForRole(isArtist) {
        // Aggiorna placeholder dell'input di chat
        chatInput.placeholder = isArtist ? "Non puoi indovinare mentre disegni..." : "Indovina la parola...";

        // Disabilita l'input se sei l'artista
        chatInput.disabled = isArtist;

        // Mostra/nascondi controlli artista
        const artistControls = document.querySelector('.artist-controls');
        if (artistControls) {
            artistControls.style.display = isArtist ? 'flex' : 'none';
        } else if (isArtist) {
            // Se non esistono ancora i controlli dell'artista, creali
            addArtistControls();
        }
    }

    // Funzione per mostrare la selezione della parola
    function showWordSelection(words) {
        // Rimuovi eventuali selezioni di parole precedenti
        const existingWordSelection = document.querySelector('.word-selection');
        if (existingWordSelection) {
            existingWordSelection.remove();
        }

        // Crea il box per la selezione delle parole
        const wordSelectionBox = document.createElement('div');
        wordSelectionBox.className = 'word-selection';

        const wordTitle = document.createElement('h3');
        wordTitle.textContent = 'Scegli una parola da disegnare:';
        wordSelectionBox.appendChild(wordTitle);

        const wordList = document.createElement('div');
        wordList.className = 'word-list';

        // Per ogni parola, crea un bottone
        words.forEach(word => {
            const wordButton = document.createElement('button');
            wordButton.textContent = word;
            wordButton.className = 'word-option';

            wordButton.addEventListener('click', () => {
                // Invia la parola selezionata
                socket.emit('wordSelected', {
                    lobbyId,
                    word
                });

                // Rimuovi il box di selezione
                wordSelectionBox.remove();

                // Pulisci il canvas
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Aggiungi un messaggio
                addMessage(`Stai disegnando: ${word}`, 'system');
            });

            wordList.appendChild(wordButton);
        });

        wordSelectionBox.appendChild(wordList);

        // Aggiungi il box alla canvas box
        canvasBox.appendChild(wordSelectionBox);
    }

    // Funzione per aggiungere messaggi alla chat
    function addMessage(message, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type || 'chat'}`;
        messageDiv.textContent = message;
        messagesBox.appendChild(messageDiv);

        // Scorri in basso per vedere gli ultimi messaggi
        messagesBox.scrollTop = messagesBox.scrollHeight;
    }

    // Funzione per aggiornare la classifica
    function updateStandings(players, scores, currentArtist) {
        if (!players || !scores) return;

        // Pulisci la lista della classifica
        standingBox.innerHTML = '';

        // Crea un array di [color, score] e ordinalo per punteggio decrescente
        const sortedPlayers = players
            .map(color => [color, scores[color] || 0])
            .sort((a, b) => b[1] - a[1]);

        // Aggiungi i giocatori alla classifica
        sortedPlayers.forEach((player, index) => {
            const color = player[0];
            const score = player[1];

            const li = document.createElement('li');

            const playerEntry = document.createElement('div');
            playerEntry.className = index % 2 === 0 ? 'player-entry-1' : 'player-entry-2';

            const positionText = document.createElement('p');
            positionText.className = 'player-entry-text';
            positionText.textContent = `${index + 1}.`;

            const avatarCircle = document.createElement('div');
            avatarCircle.className = 'avatar-circle';

            const avatarColor = document.createElement('div');
            avatarColor.className = 'avatar-color';
            avatarColor.style.backgroundColor = color;

            const scoreBox = document.createElement('div');
            scoreBox.className = 'score-box';

            const scoreText = document.createElement('p');
            scoreText.textContent = `${score} pts.`;

            // Evidenzia il giocatore corrente
            if (color === playerColor) {
                playerEntry.classList.add('current-player');
            }

            // Evidenzia l'artista corrente
            if (color === currentArtist) {
                const artistIcon = document.createElement('span');
                artistIcon.textContent = ' ✏️';
                artistIcon.className = 'artist-icon';
                scoreText.appendChild(artistIcon);
            }

            // Assembla gli elementi
            avatarCircle.appendChild(avatarColor);
            scoreBox.appendChild(scoreText);

            playerEntry.appendChild(positionText);
            playerEntry.appendChild(avatarCircle);
            playerEntry.appendChild(scoreBox);

            li.appendChild(playerEntry);
            standingBox.appendChild(li);
        });
    }

    // Aggiungi pulsanti e controlli per l'artista
    function addArtistControls() {
        // Crea un box per i controlli dell'artista
        const controlsBox = document.createElement('div');
        controlsBox.className = 'artist-controls';

        // Pulsante per pulire la lavagna
        const clearButton = document.createElement('button');
        clearButton.textContent = 'Pulisci Lavagna';
        clearButton.className = 'control-button';
        clearButton.addEventListener('click', () => {
            // Pulisci localmente
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Invia l'evento a tutti
            socket.emit('clearCanvas', { lobbyId });
        });

        // Selettore di spessore linea
        const lineWidthLabel = document.createElement('label');
        lineWidthLabel.textContent = 'Spessore:';

        const lineWidthSelect = document.createElement('select');
        [1, 3, 5, 8, 12].forEach(width => {
            const option = document.createElement('option');
            option.value = width;
            option.textContent = width;
            lineWidthSelect.appendChild(option);
        });

        // Imposta il valore predefinito
        lineWidthSelect.value = currentLineWidth;

        lineWidthSelect.addEventListener('change', (e) => {
            currentLineWidth = parseInt(e.target.value);
        });

        // Selettore di colore
        const colorLabel = document.createElement('label');
        colorLabel.textContent = 'Colore:';

        const colorPicker = document.createElement('input');
        colorPicker.type = 'color';
        colorPicker.value = currentColor;
        colorPicker.addEventListener('change', (e) => {
            currentColor = e.target.value;
        });

        // Aggiungi tutti i controlli al box
        controlsBox.appendChild(colorLabel);
        controlsBox.appendChild(colorPicker);
        controlsBox.appendChild(lineWidthLabel);
        controlsBox.appendChild(lineWidthSelect);
        controlsBox.appendChild(clearButton);

        // Aggiungi i controlli sopra il canvas
        canvasBox.insertBefore(controlsBox, canvas);
    }

    // Mostra un messaggio di benvenuto
    addMessage(`Welcome to the Drawing Game! You are playing as: ${playerColor}`, 'system');
    addMessage('Wait for your turn to draw or guess the words!', 'system');
});