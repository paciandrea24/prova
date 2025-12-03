document.addEventListener('DOMContentLoaded', () => {
    console.log("🎨 Drawing Game Script Caricato");

    // =========================================================
    // 1. SETUP INIZIALE
    // =========================================================
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const playerColor = urlParams.get('color');
    const gameId = urlParams.get('game');

    let gameSettings = null;
    try {
        const settingsParam = urlParams.get('settings');
        if (settingsParam) gameSettings = JSON.parse(decodeURIComponent(settingsParam));
    } catch (e) { console.error(e); }

    if (!lobbyId || !playerColor) {
        console.error("Dati mancanti, ritorno alla home");
        window.location.href = '/';
        return;
    }

    // Gestione Tema (Opzionale)
    const themeBtn = document.getElementById('theme-toggle-btn');
    const body = document.body;
    const savedTheme = localStorage.getItem('quiz-theme');
    if (savedTheme === 'dark' && body) body.classList.add('theme-dark');

    if (themeBtn) {
        themeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            body.classList.toggle('theme-dark');
            localStorage.setItem('quiz-theme', body.classList.contains('theme-dark') ? 'dark' : 'light');
        });
    }

    // Elementi DOM
    const canvasBox = document.querySelector('.canvas-box');
    const timerText = document.querySelector('.timer-text');
    const hintText = document.querySelector('.hint');
    const currentRoundText = document.getElementById('current-round');
    const totalRoundsText = document.getElementById('total-rounds');
    const messagesBox = document.querySelector('.messages-box');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const standingBox = document.querySelector('.players-ul');
    const artistNotification = document.getElementById('artist-notification');
    const gameEndModal = document.getElementById('game-end-modal');
    const roundEndModal = document.getElementById('round-end-modal');
    const revealedWordElement = document.getElementById('revealed-word');
    const backToLobbyBtn = document.getElementById('back-to-lobby');

    // --- SETUP CANVAS (CORRETTO) ---
    // Cerchiamo il canvas esistente, altrimenti lo creiamo
    let canvas = document.getElementById('drawing-canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'drawing-canvas'; // Importante dare un ID
        canvasBox.appendChild(canvas);
    }

    // Impostiamo la risoluzione interna fissa
    canvas.width = 800;
    canvas.height = 600;

    const ctx = canvas.getContext('2d');

    // Sfondo Bianco Iniziale
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Variabili Stato Disegno
    let isDrawing = false;
    let lastX = 0, lastY = 0;
    let currentColor = '#000000';
    let currentLineWidth = 5;
    let currentTool = 'pen';
    let amIArtist = false;
    let fillMode = false;
    let drawingHistory = [];
    let redoHistory = [];
    const MAX_HISTORY = 30;


    // =========================================================
    // 2. SOCKET IO
    // =========================================================
    const socket = io();

    // Unisciti alla stanza (FONDAMENTALE per vedere gli altri)
    console.log(`🔌 Mi unisco alla lobby: ${lobbyId}`);
    socket.emit('joinLobby', lobbyId);

    socket.emit('joinGame', {
        lobbyId,
        gameId,
        playerColor,
        settings: gameSettings
    });

    socket.emit('requestGameState', { lobbyId });


    // =========================================================
    // 3. LOGICA DISEGNO
    // =========================================================

    // Calcola coordinate precise mouse/touch relative al canvas
    function getMousePos(evt) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return [
            (evt.clientX - rect.left) * scaleX,
            (evt.clientY - rect.top) * scaleY
        ];
    }

    function startDrawing(e) {
        if (!amIArtist) return;

        const event = e.touches ? e.touches[0] : e;
        const [x, y] = getMousePos(event);

        if (fillMode || currentTool === 'fill') {
            floodFill(x, y, currentColor);
            return;
        }

        isDrawing = true;
        [lastX, lastY] = [x, y];
        draw(e); // Disegna punto singolo
    }

    function draw(e) {
        // Stop se mouse non premuto (fix cursore appiccicato)
        if (e.type === 'mousemove' && e.buttons === 0) {
            isDrawing = false;
            return;
        }

        if (!isDrawing || !amIArtist) return;
        if (e.type !== 'mousedown' && e.type !== 'touchstart') e.preventDefault();

        const event = e.touches ? e.touches[0] : e;
        const [x, y] = getMousePos(event);

        const colorToUse = (currentTool === 'eraser') ? '#FFFFFF' : currentColor;

        // 1. Disegna locale
        drawLine(ctx, lastX, lastY, x, y, colorToUse, currentLineWidth);

        // 2. Invia agli altri
        socket.emit('draw', {
            lobbyId,
            from: { x: lastX, y: lastY },
            to: { x, y },
            color: colorToUse,
            lineWidth: currentLineWidth
        });

        [lastX, lastY] = [x, y];
    }

    function stopDrawing() {
        if (isDrawing && amIArtist) saveCanvasState();
        isDrawing = false;
    }

    // Funzione che disegna effettivamente
    function drawLine(context, x1, y1, x2, y2, color, width) {
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.strokeStyle = color;
        context.lineWidth = width;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.stroke();
        context.closePath();
    }

    // Listeners Canvas
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing);


    // =========================================================
    // 4. SOCKET LISTENERS (Ricezione)
    // =========================================================

    // Ricevi disegno dagli altri
    socket.on('drawLine', (data) => {
        // Disegna usando le coordinate ricevute
        drawLine(ctx, data.from.x, data.from.y, data.to.x, data.to.y, data.color, data.lineWidth);
    });

    socket.on('fillArea', (data) => {
        ctx.fillStyle = data.color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    });

    socket.on('clearCanvas', () => {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    });

    // Ricevi stato completo (es. per chi entra dopo)
    socket.on('canvasState', (data) => {
        if (!amIArtist) {
            const img = new Image();
            img.src = data.dataURL;
            img.onload = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
            };
        }
    });


    // =========================================================
    // 5. LOGICA DI GIOCO (Chat, GameState, UI)
    // =========================================================

    // Chat
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;

        if (amIArtist) {
            addMessage("Non puoi suggerire mentre disegni!", "error");
        } else {
            socket.emit('guess', { lobbyId, playerColor, guess: text });
        }
        chatInput.value = '';
    });

    function addMessage(msg, type) {
        const div = document.createElement('div');
        div.className = `message ${type}`;
        if (type === 'chat' && msg.includes(':')) {
            const [name, txt] = msg.split(':');
            div.innerHTML = `<span style="font-weight:bold">${name}:</span> ${txt}`;
        } else {
            div.textContent = msg;
        }
        messagesBox.appendChild(div);
        messagesBox.scrollTop = messagesBox.scrollHeight;
    }

    socket.on('message', (data) => addMessage(data.message, data.type));

    // Aggiornamento Stato Gioco
    socket.on('gameState', (state) => {
        if (timerText) timerText.textContent = state.timer + 's';
        if (currentRoundText) currentRoundText.textContent = state.round;
        if (totalRoundsText) totalRoundsText.textContent = state.totalRounds;

        const wasArtist = amIArtist;
        amIArtist = (state.currentTurn === playerColor);

        // Gestione Vista (Artista vs Indovinatore)
        if (amIArtist) {
            hintText.textContent = state.currentWord || "Scegli una parola...";
            hintText.parentElement.classList.add('artist-view');

            // Mostra controlli artista
            if (!document.querySelector('.artist-controls')) addArtistControls();
            const controls = document.querySelector('.artist-controls');
            if (controls) controls.style.display = 'flex';

            chatInput.disabled = true;
            chatInput.placeholder = "Tu disegni!";
            canvas.style.cursor = "url('../imgs/pencil.png'), crosshair";

            if (!wasArtist) {
                artistNotification.innerHTML = "È il tuo turno!<br>Disegna!";
                artistNotification.style.display = 'block';
                setTimeout(() => artistNotification.style.display = 'none', 2000);
                saveCanvasState(); // Salva stato bianco iniziale
            }

        } else {
            hintText.textContent = state.hint;
            hintText.parentElement.classList.remove('artist-view');

            const controls = document.querySelector('.artist-controls');
            if (controls) controls.style.display = 'none';

            chatInput.disabled = false;
            chatInput.placeholder = "Indovina la parola...";
            canvas.style.cursor = "default";
        }

        updateStandings(state.players, state.scores, state.currentTurn);

        if (amIArtist && state.wordOptions && state.wordOptions.length > 0) {
            showWordSelection(state.wordOptions);
        }
    });

    socket.on('roundEnd', (data) => {
        if (revealedWordElement) revealedWordElement.textContent = data.word;
        roundEndModal.style.display = 'flex';
        setTimeout(() => { roundEndModal.style.display = 'none'; }, 4500);
    });

    socket.on('gameEnd', (data) => {
        gameEndModal.style.display = 'flex';
    });

    if (backToLobbyBtn) {
        backToLobbyBtn.addEventListener('click', () => {
            window.location.href = `/lobby.html?lobby=${lobbyId}&color=${playerColor}`;
        });
    }

    // UI Helpers
    function updateStandings(players, scores, currentArtist) {
        standingBox.innerHTML = '';
        players.forEach(p => {
            const li = document.createElement('li');
            const div = document.createElement('div');
            div.className = 'player-entry-1';
            if (p === playerColor) div.classList.add('current-player');

            div.innerHTML = `
                <div class="avatar-circle">
                    <div class="avatar-color" style="background-color:${p}"></div>
                </div>
                <div class="player-info">
                    <div class="player-name">${p === playerColor ? 'You' : ''}</div>
                </div>
                <div class="score-box">
                    ${scores[p] || 0} pt ${p === currentArtist ? '✏️' : ''}
                </div>
            `;
            li.appendChild(div);
            standingBox.appendChild(li);
        });
    }

    function addArtistControls() {
        if (document.querySelector('.artist-controls')) return;
        const controls = document.createElement('div');
        controls.className = 'artist-controls';
        controls.innerHTML = `
            <div class="controls-row">
                <div class="tools-container">
                     <button class="tool-button active" onclick="window.setTool('pen')">✏️</button>
                     <button class="tool-button" onclick="window.setTool('eraser')">🧼</button>
                     <button class="tool-button" onclick="window.clearCanvas()">❌</button>
                </div>
                <div class="color-container">
                    <div class="color-palette">
                        <div class="color-button" style="background:black" onclick="window.setColor('black')"></div>
                        <div class="color-button" style="background:red" onclick="window.setColor('red')"></div>
                        <div class="color-button" style="background:blue" onclick="window.setColor('blue')"></div>
                        <div class="color-button" style="background:green" onclick="window.setColor('green')"></div>
                        <div class="color-button" style="background:yellow" onclick="window.setColor('yellow')"></div>
                        <div class="color-button" style="background:orange" onclick="window.setColor('orange')"></div>
                        <div class="color-button" style="background:purple" onclick="window.setColor('purple')"></div>
                    </div>
                </div>
            </div>
        `;
        canvasBox.appendChild(controls);
    }

    // Espongo funzioni globali per l'onclick nell'HTML generato
    window.setColor = (c) => { currentColor = c; currentTool = 'pen'; };
    window.setTool = (t) => { currentTool = t; };
    window.clearCanvas = () => {
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        socket.emit('clearCanvas', { lobbyId });
        saveCanvasState();
    };

    function showWordSelection(words) {
        // Evita duplicati
        if (document.querySelector('.word-selection-modal')) return;

        const modal = document.createElement('div');
        modal.className = 'word-selection-modal';
        const content = document.createElement('div');
        content.className = 'word-selection-content';
        content.innerHTML = '<h3>Scegli una parola:</h3>';
        const list = document.createElement('div');
        list.className = 'word-list';

        words.forEach(w => {
            const btn = document.createElement('button');
            btn.className = 'word-option';
            btn.textContent = w;
            btn.onclick = () => {
                socket.emit('wordSelected', { lobbyId, word: w });
                modal.remove();
            };
            list.appendChild(btn);
        });
        content.appendChild(list);
        modal.appendChild(content);
        document.body.appendChild(modal);
    }

    function saveCanvasState() {
        if (drawingHistory.length > MAX_HISTORY) drawingHistory.shift();
        drawingHistory.push(canvas.toDataURL());
    }

    function floodFill(startX, startY, fillColor) {
        ctx.fillStyle = fillColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        socket.emit('fillArea', { lobbyId, color: fillColor });
        if (amIArtist) saveCanvasState();
    }

    // Aggiornamento cursore
    function updateCursorStyle() {
        // Implementazione opzionale se vuoi cambiare il cursore CSS
    }

    socket.on('fillArea', (data) => {
        ctx.fillStyle = data.color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    });

    socket.on('clearCanvas', () => {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    });

    socket.on('canvasState', (data) => {
        if (!amIArtist) {
            const img = new Image();
            img.src = data.dataURL;
            img.onload = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            };
        }
    });


    // =========================================================
    // 6. LOGICA GIOCO (CHAT, UI, STATI)
    // =========================================================

    // Chat
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;

        if (amIArtist) {
            addMessage("Non puoi suggerire!", "error");
        } else {
            socket.emit('guess', { lobbyId, playerColor, guess: text });
        }
        chatInput.value = '';
    });

    function addMessage(msg, type) {
        const div = document.createElement('div');
        div.className = `message ${type}`;
        if (type === 'chat' && msg.includes(':')) {
            const [name, txt] = msg.split(':');
            div.innerHTML = `<span style="font-weight:bold">${name}:</span> ${txt}`;
        } else {
            div.textContent = msg;
        }
        messagesBox.appendChild(div);
        messagesBox.scrollTop = messagesBox.scrollHeight;
    }

    socket.on('message', (data) => addMessage(data.message, data.type));

    // Game State
    socket.on('gameState', (state) => {
        timerText.textContent = state.timer + 's';
        currentRoundText.textContent = state.round;
        totalRoundsText.textContent = state.totalRounds;

        amIArtist = (state.currentTurn === playerColor);

        if (amIArtist) {
            hintText.textContent = state.currentWord || "Scegli una parola...";
            hintText.parentElement.classList.add('artist-view');

            if (!document.querySelector('.artist-controls')) addArtistControls();
            else document.querySelector('.artist-controls').style.display = 'flex';

            chatInput.disabled = true;
            chatInput.placeholder = "Tu disegni!";
            canvas.style.cursor = "url('../imgs/pencil.png'), crosshair"; // Cursore custom se vuoi

        } else {
            hintText.textContent = state.hint;
            hintText.parentElement.classList.remove('artist-view');

            const controls = document.querySelector('.artist-controls');
            if (controls) controls.style.display = 'none';

            chatInput.disabled = false;
            chatInput.placeholder = "Indovina la parola...";
            canvas.style.cursor = "default";
        }

        updateStandings(state.players, state.scores, state.currentTurn);

        if (amIArtist && state.wordOptions && state.wordOptions.length > 0) {
            showWordSelection(state.wordOptions);
        }
    });

    socket.on('roundEnd', (data) => {
        revealedWordElement.textContent = data.word;
        roundEndModal.style.display = 'flex';
        setTimeout(() => { roundEndModal.style.display = 'none'; }, 4500);
    });

    socket.on('gameEnd', (data) => {
        const box = document.getElementById('final-standings');
        box.innerHTML = '';
        // (Logica classifica finale qui...)
        gameEndModal.style.display = 'flex';
    });

    // UI Helpers
    function updateStandings(players, scores, currentArtist) {
        standingBox.innerHTML = '';
        players.forEach(p => {
            const li = document.createElement('li');
            const div = document.createElement('div');
            div.className = 'player-entry-1';
            if (p === playerColor) div.classList.add('current-player');

            div.innerHTML = `
                <div class="avatar-circle">
                    <div class="avatar-color" style="background-color:${p}"></div>
                </div>
                <div class="player-info">
                    <div class="player-name">${p === playerColor ? 'You' : ''}</div>
                </div>
                <div class="score-box">
                    ${scores[p] || 0} pt ${p === currentArtist ? '✏️' : ''}
                </div>
            `;
            li.appendChild(div);
            standingBox.appendChild(li);
        });
    }

    // CONTROLLI ARTISTA (Generati dinamicamente)
    function addArtistControls() {
        if (document.querySelector('.artist-controls')) return;

        const controls = document.createElement('div');
        controls.className = 'artist-controls';

        // Layout strumenti e colori
        // (Uso una stringa template per brevità, ma puoi usare createElement)
        controls.innerHTML = `
            <div class="controls-row">
                <div class="tools-container">
                     <button class="tool-button active" onclick="window.setTool('pen')">✏️</button>
                     <button class="tool-button" onclick="window.setTool('eraser')">🧼</button>
                     <button class="tool-button" onclick="window.clearCanvas()">❌</button>
                </div>
                <div class="color-container">
                    <div class="color-palette">
                        <div class="color-button" style="background:black" onclick="window.setColor('black')"></div>
                        <div class="color-button" style="background:red" onclick="window.setColor('red')"></div>
                        <div class="color-button" style="background:blue" onclick="window.setColor('blue')"></div>
                        <div class="color-button" style="background:green" onclick="window.setColor('green')"></div>
                        <div class="color-button" style="background:yellow" onclick="window.setColor('yellow')"></div>
                        <div class="color-button" style="background:orange" onclick="window.setColor('orange')"></div>
                        <div class="color-button" style="background:purple" onclick="window.setColor('purple')"></div>
                        <div class="color-button" style="background:brown" onclick="window.setColor('brown')"></div>
                    </div>
                </div>
            </div>
        `;

        // Appendiamo DOPO il canvas ma DENTRO canvas-box
        canvasBox.appendChild(controls);
    }

    // Espongo le funzioni globali per i bottoni
    window.setColor = (c) => { currentColor = c; currentTool = 'pen'; };
    window.setTool = (t) => { currentTool = t; };
    window.clearCanvas = () => {
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        socket.emit('clearCanvas', { lobbyId });
        saveCanvasState();
    };

    function showWordSelection(words) {
        const modal = document.createElement('div');
        modal.className = 'word-selection-modal';
        const content = document.createElement('div');
        content.className = 'word-selection-content';
        content.innerHTML = '<h3>Scegli una parola:</h3>';
        const list = document.createElement('div');
        list.className = 'word-list';

        words.forEach(w => {
            const btn = document.createElement('button');
            btn.className = 'word-option';
            btn.textContent = w;
            btn.onclick = () => {
                socket.emit('wordSelected', { lobbyId, word: w });
                modal.remove();
            };
            list.appendChild(btn);
        });
        content.appendChild(list);
        modal.appendChild(content);
        document.body.appendChild(modal);
    }

    function saveCanvasState() {
        drawingHistory.push(canvas.toDataURL());
    }
    function updateUndoRedoButtons() { } // Placeholder


    // Funzione per eseguire l'undo
    function undoDrawing() {
        if (drawingHistory.length <= 1) return; // Mantieni almeno uno stato

        // Sposta lo stato attuale nella cronologia redo
        redoHistory.push(drawingHistory.pop());

        // Carica lo stato precedente
        const img = new Image();
        img.src = drawingHistory[drawingHistory.length - 1];
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);

            // Invia l'aggiornamento agli altri giocatori
            socket.emit('canvasState', {
                lobbyId,
                dataURL: img.src
            });

            // Aggiorna la UI dei pulsanti
            updateUndoRedoButtons();
        };
    }

    // Funzione per eseguire il redo
    function redoDrawing() {
        if (redoHistory.length === 0) return;

        // Ottieni lo stato più recente dalla cronologia redo
        const redoState = redoHistory.pop();

        // Aggiungilo alla cronologia principale
        drawingHistory.push(redoState);

        // Carica lo stato
        const img = new Image();
        img.src = redoState;
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);

            // Invia l'aggiornamento agli altri giocatori
            socket.emit('canvasState', {
                lobbyId,
                dataURL: img.src
            });

            // Aggiorna la UI dei pulsanti
            updateUndoRedoButtons();
        };
    }

    // Funzione per aggiornare lo stato dei pulsanti undo/redo
    function updateUndoRedoButtons() {
        const undoButton = document.querySelector('.undo-button');
        const redoButton = document.querySelector('.redo-button');

        if (undoButton && redoButton) {
            undoButton.disabled = drawingHistory.length <= 1;
            redoButton.disabled = redoHistory.length === 0;

            // Aggiorna anche l'aspetto visivo
            undoButton.style.opacity = drawingHistory.length <= 1 ? "0.5" : "1";
            redoButton.style.opacity = redoHistory.length === 0 ? "0.5" : "1";
        }
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
    // Aggiungi pulsanti e controlli per l'artista
    function addArtistControls() {
        // Crea un box per i controlli dell'artista
        const controlsBox = document.createElement('div');
        controlsBox.className = 'artist-controls';

        // Layout principale dei controlli - usiamo flex per disporre strumenti e colori
        const controlsLayout = document.createElement('div');
        controlsLayout.className = 'controls-layout';

        // Prima riga
        const firstRow = document.createElement('div');
        firstRow.className = 'controls-row';

        // 1. SEZIONE STRUMENTI PRIMA RIGA a sinistra
        const toolsContainerFirstRow = document.createElement('div');
        toolsContainerFirstRow.className = 'tools-container first-row';

        // 2. SEZIONE COLORI PRIMA RIGA a destra
        const colorContainerFirstRow = document.createElement('div');
        colorContainerFirstRow.className = 'color-container first-row';

        // Seconda riga
        const secondRow = document.createElement('div');
        secondRow.className = 'controls-row';

        // 3. SEZIONE STRUMENTI SECONDA RIGA a sinistra
        const toolsContainerSecondRow = document.createElement('div');
        toolsContainerSecondRow.className = 'tools-container second-row';

        // 4. SEZIONE COLORI SECONDA RIGA a destra
        const colorContainerSecondRow = document.createElement('div');
        colorContainerSecondRow.className = 'color-container second-row';

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

        // Pulsante Undo
        const undoButton = document.createElement('button');
        undoButton.className = 'tool-button undo-button';
        undoButton.title = 'Annulla ultima azione';
        undoButton.disabled = true;
        undoButton.style.opacity = "0.5";

        // Icona per Undo
        const undoIcon = document.createElement('span');
        undoIcon.innerHTML = '↩️';
        undoIcon.className = 'undo-icon';

        undoButton.appendChild(undoIcon);

        undoButton.addEventListener('click', () => {
            if (amIArtist) {
                undoDrawing();
            }
        });

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

            if (amIArtist) {
                saveCanvasState();
            }
        });

        // Pulsante Redo
        const redoButton = document.createElement('button');
        redoButton.className = 'tool-button redo-button';
        redoButton.title = 'Ripeti azione';
        redoButton.disabled = true;
        redoButton.style.opacity = "0.5";

        // Icona per Redo
        const redoIcon = document.createElement('span');
        redoIcon.innerHTML = '↪️';
        redoIcon.className = 'redo-icon';

        redoButton.appendChild(redoIcon);

        redoButton.addEventListener('click', () => {
            if (amIArtist) {
                redoDrawing();
            }
        });

        // Crea la palette di colori divisa su due righe
        const colors = [
            // Prima riga (colori brillanti e saturi)
            '#222831', '#EEEEEE', '#E63946', '#8AC926', '#1982C4', '#FFCA3A', '#8B4513', '#00F5D4',

            // Seconda riga (colori più pastello/freschi)
            '#FF924C', '#C850C0', '#4CAF50', '#FF6F91', '#95A5A6', '#B22222', '#FAB1A0', '#FFD6A5'
        ];

        // Crea la prima fila di colori (8)
        const colorPaletteFirst = document.createElement('div');
        colorPaletteFirst.className = 'color-palette first-row';

        for (let i = 0; i < 8; i++) {
            const color = colors[i];
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

            colorPaletteFirst.appendChild(colorButton);
        }

        // Crea la seconda fila di colori (8)
        const colorPaletteSecond = document.createElement('div');
        colorPaletteSecond.className = 'color-palette second-row';

        for (let i = 8; i < 16; i++) {
            const color = colors[i];
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

            colorPaletteSecond.appendChild(colorButton);
        }

        // Assembla gli elementi per la prima riga
        toolsContainerFirstRow.appendChild(lineWidthButtons);
        toolsContainerFirstRow.appendChild(fillButton);
        toolsContainerFirstRow.appendChild(undoButton);
        colorContainerFirstRow.appendChild(colorPaletteFirst);
        firstRow.appendChild(toolsContainerFirstRow);
        firstRow.appendChild(colorContainerFirstRow);

        // Assembla gli elementi per la seconda riga
        toolsContainerSecondRow.appendChild(eraserButtons);
        toolsContainerSecondRow.appendChild(clearButton);
        toolsContainerSecondRow.appendChild(redoButton);
        colorContainerSecondRow.appendChild(colorPaletteSecond);
        secondRow.appendChild(toolsContainerSecondRow);
        secondRow.appendChild(colorContainerSecondRow);

        // Assembla le righe nel layout principale
        controlsLayout.appendChild(firstRow);
        controlsLayout.appendChild(secondRow);
        controlsBox.appendChild(controlsLayout);

        // Aggiungi i controlli sotto il canvas
        canvasBox.appendChild(controlsBox);

        // Salva lo stato iniziale del canvas una volta che l'artista inizia il turno
        if (amIArtist) {
            // Salva lo stato iniziale (canvas bianco)
            saveCanvasState();
        }

        // Aggiorna lo stato dei pulsanti undo/redo
        updateUndoRedoButtons();
    }

    // NUOVO: Mostra le impostazioni del gioco all'inizio se disponibili
    if (gameSettings) {
        displayGameSettings(gameSettings);
    }

    // NUOVO: Funzione per mostrare le impostazioni del gioco
    function displayGameSettings(settings) {
        const settingsDiv = document.createElement('div');
        settingsDiv.className = 'game-settings-display';
        settingsDiv.innerHTML = `
            <div style="background: rgba(0,0,0,0.8); color: white; padding: 15px; border-radius: 10px; margin: 10px 0; text-align: center;">
                <h4 style="margin: 0 0 10px 0;">Impostazioni di Gioco</h4>
                <div style="display: flex; justify-content: space-around; flex-wrap: wrap;">
                    ${settings.rounds ? `<span><strong>Round:</strong> ${settings.rounds}</span>` : ''}
                    ${settings.time ? `<span><strong>Tempo:</strong> ${settings.time}s</span>` : ''}
                    ${settings.difficulty ? `<span><strong>Difficoltà:</strong> ${getDifficultyLabel(settings.difficulty)}</span>` : ''}
                    ${settings.questions ? `<span><strong>Domande:</strong> ${settings.questions}</span>` : ''}
                    ${settings.category ? `<span><strong>Categoria:</strong> ${getCategoryLabel(settings.category)}</span>` : ''}
                </div>
            </div>
        `;

        // Inserisci dopo l'header principale
        const header = document.querySelector('.header');
        if (header && header.nextSibling) {
            header.parentNode.insertBefore(settingsDiv, header.nextSibling);
        }

        // Rimuovi dopo 8 secondi
        setTimeout(() => {
            if (settingsDiv.parentNode) {
                settingsDiv.parentNode.removeChild(settingsDiv);
            }
        }, 2500);
    }

    // Helper functions per le label
    function getDifficultyLabel(difficulty) {
        const labels = {
            'easy': 'Facile',
            'medium': 'Medio',
            'hard': 'Difficile',
            'mixed': 'Misto'
        };
        return labels[difficulty] || difficulty;
    }

    function getCategoryLabel(category) {
        const labels = {
            'general': 'Generale',
            'history': 'Storia',
            'science': 'Scienza',
            'sports': 'Sport'
        };
        return labels[category] || category;
    }

    // Funzione Helper per Notifiche
    function showToast(message, type = 'info') {
        // Crea container se non esiste
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        // Crea il toast
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        // Icona in base al tipo
        let icon = '';
        if (type === 'error') icon = '⚠️';
        if (type === 'success') icon = '✅';
        if (type === 'info') icon = 'ℹ️';

        toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

        container.appendChild(toast);

        // Rimuovi dopo 3 secondi
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s forwards';
            toast.addEventListener('animationend', () => {
                toast.remove();
            });
        }, 3000);
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