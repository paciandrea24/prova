document.addEventListener('DOMContentLoaded', () => {

    // Aggiungi questo all'inizio del file dopo document.addEventListener('DOMContentLoaded', ...)
    // per impostare lo stile del cursore in base allo strumento
    function updateCursorStyle() {
        if (!amIArtist) {
            canvas.classList.remove('artist-cursor', 'eraser-cursor', 'fill-cursor');
            return;
        }

        canvas.classList.remove('artist-cursor', 'eraser-cursor', 'fill-cursor');

        if (fillMode) {
            canvas.classList.add('fill-cursor');
        } else if (currentTool === 'eraser') {
            canvas.classList.add('eraser-cursor');
        } else {
            canvas.classList.add('artist-cursor');
        }
    }
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

    // Inizializza le variabili per il disegno (aggiorna nella sezione iniziale del file game.js)
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let currentColor = '#000000';
    let lastUsedColor = null; // Per memorizzare l'ultimo colore usato prima di passare alla gomma
    let currentLineWidth = 5;
    let currentTool = 'pen'; // Nuovo: 'pen', 'eraser', o 'fill'
    let amIArtist = false;
    let fillMode = false; // Flag per indicare se siamo in modalità riempimento


    // Connessione Socket.io
    const socket = io();

    // Unisciti alla lobby
    socket.emit('joinLobby', lobbyId);

    // Unisciti al gioco
    socket.emit('joinGame', { lobbyId, gameId, playerColor });

    // Richiedi lo stato attuale del gioco
    socket.emit('requestGameState', { lobbyId });

    // Aggiorna la funzione startDrawing per gestire i diversi strumenti
    function startDrawing(e) {
        if (!amIArtist) return;  // Solo l'artista può disegnare

        // Se siamo in modalità riempimento, esegui il riempimento invece di disegnare
        if (fillMode) {
            const [x, y] = getMousePos(canvas, e);
            floodFill(x, y, currentColor);
            return;
        }

        isDrawing = true;
        [lastX, lastY] = getMousePos(canvas, e);
    }



    // Aggiorna la funzione draw per gestire la gomma
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

    function floodFill(startX, startY, fillColor) {
        // Arrotondiamo le coordinate per lavorare con i pixel
        startX = Math.floor(startX);
        startY = Math.floor(startY);

        // Otteniamo i dati dell'immagine dal canvas
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Otteniamo il colore del pixel di partenza
        const targetColor = getPixelColor(imageData, startX, startY);

        // Convertiamo fillColor (formato hex) in un array RGBA
        const fillColorRgb = hexToRgb(fillColor);
        const fillColorArray = [fillColorRgb.r, fillColorRgb.g, fillColorRgb.b, 255]; // Alpha sempre a 255

        // Se il colore di riempimento è uguale al colore target, non fare nulla
        if (colorMatch(targetColor, fillColorArray)) {
            return;
        }

        // Utilizziamo un algoritmo di riempimento con pila (simile a BFS)
        const stack = [[startX, startY]];
        const visited = new Set(); // Per tracciare i pixel già visitati
        const key = (x, y) => `${x},${y}`;

        while (stack.length) {
            const [x, y] = stack.pop();

            // Se questo pixel è già stato visitato, salta
            if (visited.has(key(x, y))) continue;

            // Segna questo pixel come visitato
            visited.add(key(x, y));

            // Ottieni il colore di questo pixel
            const pixelColor = getPixelColor(imageData, x, y);

            // Se questo pixel non corrisponde al colore target, salta
            if (!colorMatch(pixelColor, targetColor)) continue;

            // Colora questo pixel
            setPixelColor(imageData, x, y, fillColorArray);

            // Aggiungi i pixel adiacenti allo stack (4-connessi: alto, basso, sinistra, destra)
            if (x > 0) stack.push([x - 1, y]);                 // sinistra
            if (x < canvas.width - 1) stack.push([x + 1, y]);  // destra
            if (y > 0) stack.push([x, y - 1]);                 // alto
            if (y < canvas.height - 1) stack.push([x, y + 1]); // basso
        }

        // Aggiorna il canvas con i nuovi dati dell'immagine
        ctx.putImageData(imageData, 0, 0);

        // Invia l'evento di riempimento a tutti gli altri giocatori
        socket.emit('fillArea', {
            lobbyId,
            startX,
            startY,
            color: fillColor
        });
    }

    // Funzione helper per ottenere il colore di un pixel
    function getPixelColor(imageData, x, y) {
        const index = (y * imageData.width + x) * 4;
        return [
            imageData.data[index],     // R
            imageData.data[index + 1], // G
            imageData.data[index + 2], // B
            imageData.data[index + 3]  // A
        ];
    }

    // Funzione helper per impostare il colore di un pixel
    function setPixelColor(imageData, x, y, color) {
        const index = (y * imageData.width + x) * 4;
        imageData.data[index] = color[0];     // R
        imageData.data[index + 1] = color[1]; // G
        imageData.data[index + 2] = color[2]; // B
        imageData.data[index + 3] = color[3]; // A
    }

    // Funzione helper per verificare se due colori sono uguali (con una tolleranza)
    function colorMatch(color1, color2, tolerance = 10) {
        return Math.abs(color1[0] - color2[0]) <= tolerance &&
            Math.abs(color1[1] - color2[1]) <= tolerance &&
            Math.abs(color1[2] - color2[2]) <= tolerance &&
            Math.abs(color1[3] - color2[3]) <= tolerance;
    }

    // Funzione per convertire un colore hex in RGB
    function hexToRgb(hex) {
        // Rimuovi il prefisso # se presente
        hex = hex.replace(/^#/, '');

        // Analizza il valore hex
        let bigint = parseInt(hex, 16);
        return {
            r: (bigint >> 16) & 255,
            g: (bigint >> 8) & 255,
            b: bigint & 255
        };
    }

    // Aggiungiamo la gestione dell'evento fillArea da socket.io
    socket.on('fillArea', (data) => {
        if (!amIArtist) {  // Solo i non-artisti ricevono l'evento
            floodFill(data.startX, data.startY, data.color);
        }
    });

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

        // Aggiorna l'indizio e verifica se sono l'artista di questo turno
        const wasArtist = amIArtist; // Salva lo stato precedente
        amIArtist = state.currentTurn === playerColor;

        // Gestisci l'indizio in base al ruolo (artista o indovinatore)
        if (amIArtist) {
            // Se sono l'artista, mostra la parola completa
            // Usa state.currentWord se disponibile, altrimenti controlla se ci sono wordOptions
            if (state.currentWord) {
                hintText.textContent = state.currentWord;
                hintText.classList.add('artist-view');
                document.querySelector('.hint-word').classList.add('artist-view');
            } else {
                hintText.textContent = "In attesa di scegliere una parola...";
                hintText.classList.add('artist-view');
                document.querySelector('.hint-word').classList.add('artist-view');
            }
        } else if (state.hint) {
            // Altrimenti mostra l'indizio parziale che si aggiorna progressivamente
            hintText.textContent = state.hint;
            hintText.classList.remove('artist-view');
            document.querySelector('.hint-word').classList.remove('artist-view');
        }

        // Aggiorna le informazioni sul round
        if (state.round) {
            currentRoundText.textContent = state.round;
        }

        if (state.totalRounds) {
            totalRoundsText.textContent = state.totalRounds;
        }

        // Se sono appena diventato l'artista
        if (!wasArtist && amIArtist) {
            // Mostra notifica
            artistNotification.innerHTML = '<h3>È il tuo turno di disegnare!</h3>';
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

        if (isArtist) {
            // Se l'utente è l'artista, imposta il cursore a pennello
            canvas.classList.add('artist-cursor');
        } else {
            // Altrimenti, rimuovi la classe del cursore
            canvas.classList.remove('artist-cursor');
        }

        // Verifica che questi event listener siano stati aggiunti dopo la creazione del canvas
        canvas.addEventListener('mouseenter', () => {
            if (amIArtist) {
                canvas.classList.add('artist-active');
            }
        });

        canvas.addEventListener('mouseleave', () => {
            canvas.classList.remove('artist-active');
        });
    }

    // Funzione per mostrare la selezione della parola
    function showWordSelection(words) {
        // Rimuovi eventuali selezioni di parole precedenti
        const existingWordSelection = document.querySelector('.word-selection-modal');
        if (existingWordSelection) {
            existingWordSelection.remove();
        }

        // Crea il modal per la selezione delle parole
        const wordSelectionModal = document.createElement('div');
        wordSelectionModal.className = 'word-selection-modal';

        const modalContent = document.createElement('div');
        modalContent.className = 'word-selection-content';

        const wordTitle = document.createElement('h3');
        wordTitle.textContent = 'Scegli una parola da disegnare:';
        modalContent.appendChild(wordTitle);

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

                // Rimuovi il modal
                wordSelectionModal.remove();

                // Pulisci il canvas
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Aggiorna l'indizio per mostrare la parola all'artista
                hintText.textContent = word;
                hintText.classList.add('artist-view');
                document.querySelector('.hint-word').classList.add('artist-view');

                // NON aggiungere più il messaggio in chat
                // addMessage(`Stai disegnando: ${word}`, 'system');
            });

            wordList.appendChild(wordButton);
        });

        modalContent.appendChild(wordList);
        wordSelectionModal.appendChild(modalContent);

        // Aggiungi il modal al body
        document.body.appendChild(wordSelectionModal);
    }

    // Funzione per aggiungere messaggi alla chat
    function addMessage(message, type) {
        // Ignora i messaggi di benvenuto predefiniti
        if (message.includes('Welcome to the Drawing Game!') ||
            message.includes('Wait for your turn to draw') ||
            message.includes('è l\'artista di questo turno')) {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type || 'chat'}`;

        // Se è un messaggio di chat con formato "colore: testo"
        if (type === 'chat' && message.includes(':')) {
            const parts = message.split(':');
            const colorName = parts[0].trim();
            const messageText = parts.slice(1).join(':').trim();

            // Crea un elemento per il colore
            const colorBlock = document.createElement('span');
            colorBlock.className = 'message-color-block';
            colorBlock.style.backgroundColor = colorName;

            // Crea un elemento per il testo
            const textSpan = document.createElement('span');
            textSpan.textContent = `: ${messageText}`;

            // Aggiungi entrambi al messaggio
            messageDiv.appendChild(colorBlock);
            messageDiv.appendChild(textSpan);
        } else {
            // Per altri tipi di messaggi, mostra il testo normale
            messageDiv.textContent = message;
        }

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

            // Manteniamo solo il cerchio colorato (avatar) e rimuoviamo il color-block rettangolare
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

            // Assembla gli elementi - SENZA il color-block rettangolare
            avatarCircle.appendChild(avatarColor);
            scoreBox.appendChild(scoreText);

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

        // Layout principale dei controlli - usiamo flex per disporre strumenti e colori
        const controlsLayout = document.createElement('div');
        controlsLayout.className = 'controls-layout';

        // 1. SEZIONE STRUMENTI a sinistra
        const toolsContainer = document.createElement('div');
        toolsContainer.className = 'tools-container';

        // 2. SEZIONE COLORI a destra
        const colorContainer = document.createElement('div');
        colorContainer.className = 'color-container';

        // Prima riga: pulsanti penna e fill
        const topRow = document.createElement('div');
        topRow.className = 'tools-row top-row';

        // Aggiungi i 3 pulsanti per lo spessore della penna
        const lineWidthButtons = document.createElement('div');
        lineWidthButtons.className = 'line-width-buttons';

        const lineWidths = [2, 5, 10];
        lineWidths.forEach(width => {
            const button = document.createElement('button');
            button.className = 'tool-button';
            if (width === currentLineWidth && currentTool === 'pen') {
                button.classList.add('active');
            }
            button.dataset.width = width;
            button.dataset.tool = 'pen';

            // Creare un cerchio per rappresentare lo spessore
            const circle = document.createElement('div');
            circle.className = 'line-width-circle';
            circle.style.width = `${width * 2}px`;
            circle.style.height = `${width * 2}px`;

            button.appendChild(circle);

            button.addEventListener('click', () => {
                fillMode = false;
                currentLineWidth = width;
                currentTool = 'pen';
                if (lastUsedColor) {
                    currentColor = lastUsedColor;
                }
                document.querySelectorAll('.tool-button').forEach(btn => {
                    btn.classList.remove('active');
                });
                button.classList.add('active');
                updateCursorStyle();
            });

            lineWidthButtons.appendChild(button);
        });

        // Pulsante per lo strumento riempi (secchiello)
        const fillButton = document.createElement('button');
        fillButton.className = 'tool-button fill-button';
        fillButton.title = 'Strumento Riempi';
        if (fillMode) {
            fillButton.classList.add('active');
        }

        // Icona per il secchiello di vernice
        const fillIcon = document.createElement('span');
        fillIcon.innerHTML = '🪣';
        fillIcon.className = 'fill-icon';

        fillButton.appendChild(fillIcon);

        fillButton.addEventListener('click', () => {
            fillMode = true;
            currentTool = 'fill';
            if (lastUsedColor && currentColor === 'white') {
                currentColor = lastUsedColor;
            }
            document.querySelectorAll('.tool-button').forEach(btn => {
                btn.classList.remove('active');
            });
            fillButton.classList.add('active');
            updateCursorStyle();
        });

        // Aggiungi pulsanti penna e fill alla prima riga
        topRow.appendChild(lineWidthButtons);
        topRow.appendChild(fillButton);

        // Seconda riga: pulsanti gomma e cancella tutto
        const bottomRow = document.createElement('div');
        bottomRow.className = 'tools-row bottom-row';

        // Aggiungi i 3 pulsanti per la gomma
        const eraserButtons = document.createElement('div');
        eraserButtons.className = 'eraser-width-buttons';

        const eraserWidths = [2, 5, 10];
        eraserWidths.forEach(width => {
            const button = document.createElement('button');
            button.className = 'tool-button eraser-button';
            if (width === currentLineWidth && currentTool === 'eraser') {
                button.classList.add('active');
            }
            button.dataset.width = width;
            button.dataset.tool = 'eraser';

            // Immagine della gomma
            const eraserImg = document.createElement('img');
            eraserImg.src = `../imgs/eraser-${width}.png`; // Assicurati che queste immagini esistano
            eraserImg.className = 'eraser-img';
            eraserImg.alt = `Gomma ${width}px`;
            eraserImg.style.width = `${width * 2.6 + 2}px`; // Dimensiona in base alla larghezza
            eraserImg.style.height = 'auto';

            button.appendChild(eraserImg);

            button.addEventListener('click', () => {
                fillMode = false;
                currentLineWidth = width;
                currentTool = 'eraser';
                lastUsedColor = currentColor;
                currentColor = 'white';
                document.querySelectorAll('.tool-button').forEach(btn => {
                    btn.classList.remove('active');
                });
                button.classList.add('active');
                updateCursorStyle();
            });

            eraserButtons.appendChild(button);
        });

        // Pulsante per pulire la lavagna
        const clearButton = document.createElement('button');
        clearButton.className = 'tool-button clear-button';
        clearButton.title = 'Pulisci Lavagna';

        // Icona "X" per la cancellazione
        const clearIcon = document.createElement('span');
        clearIcon.textContent = '×';
        clearIcon.className = 'clear-icon';

        clearButton.appendChild(clearIcon);

        clearButton.addEventListener('click', () => {
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            socket.emit('clearCanvas', { lobbyId });
        });

        // Aggiungi pulsanti gomma e cancella alla seconda riga
        bottomRow.appendChild(eraserButtons);
        bottomRow.appendChild(clearButton);

        // Aggiungi entrambe le righe al container degli strumenti
        toolsContainer.appendChild(topRow);
        toolsContainer.appendChild(bottomRow);

        // Crea la palette di colori 8x2
        const colorPalette = document.createElement('div');
        colorPalette.className = 'color-palette';

        // Lista di 16 colori predefiniti
        const colors = [
            // Prima riga (8 colori)
            '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
            // Seconda riga (8 colori)
            '#FFA500', '#800080', '#008000', '#800000', '#808080', '#A52A2A', '#FFC0CB', '#FFD700'
        ];

        colors.forEach(color => {
            const colorButton = document.createElement('button');
            colorButton.className = 'color-button';
            colorButton.style.backgroundColor = color;

            if (color === currentColor && currentTool !== 'eraser') {
                colorButton.classList.add('active');
            }

            colorButton.addEventListener('click', () => {
                currentColor = color;
                lastUsedColor = color;

                if (currentTool === 'eraser') {
                    currentTool = 'pen';
                    document.querySelectorAll('.eraser-button').forEach(btn => {
                        btn.classList.remove('active');
                    });
                    const penButtons = document.querySelectorAll('.tool-button:not(.eraser-button):not(.fill-button):not(.clear-button)');
                    if (penButtons.length > 0) {
                        penButtons[1].classList.add('active');
                    }
                }

                document.querySelectorAll('.color-button').forEach(btn => {
                    btn.classList.remove('active');
                });
                colorButton.classList.add('active');
                updateCursorStyle();
            });

            colorPalette.appendChild(colorButton);
        });

        colorContainer.appendChild(colorPalette);

        // Assembla i controlli nel layout
        controlsLayout.appendChild(toolsContainer);
        controlsLayout.appendChild(colorContainer);
        controlsBox.appendChild(controlsLayout);

        // Aggiungi i controlli sotto il canvas
        canvasBox.appendChild(controlsBox);
    }

    // Mostra un messaggio di benvenuto
    const welcomeMessage = document.createElement('div');
    welcomeMessage.className = 'message system';
    welcomeMessage.innerHTML = `
        <div style="text-align: center; padding: 10px;">
            <h3 style="margin: 0 0 5px 0;">Benvenuto nel Gioco del Disegno</h3>
            <div style="margin-top: 8px;">
                <span class="message-color-block" style="background-color: ${playerColor}"></span>
                <span>Sei pronto a disegnare e indovinare?</span>
            </div>
        </div>
    `;
    messagesBox.appendChild(welcomeMessage);
});