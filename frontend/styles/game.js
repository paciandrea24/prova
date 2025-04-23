document.addEventListener('DOMContentLoaded', () => {
    // Recupero parametri dall'URL
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const playerColor = urlParams.get('color');
    const gameId = urlParams.get('game');

    if (!lobbyId || !playerColor || !gameId) {
        window.location.href = '/';
        return;
    }

    // Inizializzazione socket
    const socket = io();
    socket.emit('joinLobby', lobbyId);
    socket.emit('joinGame', { lobbyId, gameId, playerColor });

    // Setup elementi DOM
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const canvasBox = document.querySelector('.canvas-box');
    const timerText = document.querySelector('.timer-text');
    const hintText = document.querySelector('.hint');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const messagesBox = document.querySelector('.messages-box');
    const playersList = document.querySelector('.players-ul');

    // Setup canvas
    canvas.width = 780;
    canvas.height = 530;
    canvas.style.backgroundColor = 'white';
    canvasBox.appendChild(canvas);

    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let currentColor = 'black';
    let currentLineWidth = 5;
    let canDraw = false; // Permesso di disegnare (solo per l'artista)
    let gameState = {
        currentTurn: null,
        currentWord: null,
        wordOptions: [],
        timer: 60,
        players: [],
        scores: {},
        correctGuesses: []
    };

    // ==================== CANVAS DRAWING FUNCTIONS ====================
    function startDrawing(e) {
        if (!canDraw) return;
        isDrawing = true;
        [lastX, lastY] = [e.offsetX, e.offsetY];
    }

    function draw(e) {
        if (!isDrawing || !canDraw) return;
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(e.offsetX, e.offsetY);
        ctx.stroke();

        // Emettere l'evento di disegno al server
        socket.emit('draw', {
            lobbyId,
            from: { x: lastX, y: lastY },
            to: { x: e.offsetX, y: e.offsetY },
            color: currentColor,
            lineWidth: currentLineWidth
        });

        [lastX, lastY] = [e.offsetX, e.offsetY];
    }

    function stopDrawing() {
        isDrawing = false;
    }

    function setupCanvas() {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = currentLineWidth;
        ctx.strokeStyle = currentColor;

        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseout', stopDrawing);
    }

    // ==================== CHAT FUNCTIONS ====================
    function addMessage(message, type = 'normal') {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${type}`;
        messageElement.textContent = message;
        messagesBox.appendChild(messageElement);
        messagesBox.scrollTop = messagesBox.scrollHeight;
    }

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const guess = chatInput.value.trim();
        if (guess) {
            socket.emit('guess', { lobbyId, playerColor, guess });
            chatInput.value = '';
        }
    });

    // ==================== WORD SELECTION FUNCTIONS ====================
    function createWordSelectionUI(words) {
        // Pulisci canvas e crea UI per la selezione della parola
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#FFFFF0';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const wordBoxHeight = 100;
        const spacing = 30;
        const y = canvas.height / 2 - wordBoxHeight / 2;

        words.forEach((word, index) => {
            const boxWidth = 200;
            const x = canvas.width / 2 - ((words.length * boxWidth) + ((words.length - 1) * spacing)) / 2 + index * (boxWidth + spacing);

            // Disegna il box
            ctx.fillStyle = '#FFFFDF';
            ctx.strokeStyle = '#B8B8B8';
            ctx.lineWidth = 2;
            ctx.fillRect(x, y, boxWidth, wordBoxHeight);
            ctx.strokeRect(x, y, boxWidth, wordBoxHeight);

            // Disegna il testo
            ctx.fillStyle = 'black';
            ctx.font = '24px Inter';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(word, x + boxWidth / 2, y + wordBoxHeight / 2);

            // Aggiungi event listener per il click
            canvas.addEventListener('click', function wordSelectHandler(e) {
                const clickX = e.offsetX;
                const clickY = e.offsetY;

                if (clickX >= x && clickX <= x + boxWidth && clickY >= y && clickY <= y + wordBoxHeight) {
                    socket.emit('wordSelected', { lobbyId, word });
                    canvas.removeEventListener('click', wordSelectHandler);
                }
            });
        });
    }

    // ==================== UPDATE FUNCTIONS ====================
    function updatePlayerList(players, scores) {
        playersList.innerHTML = '';

        players.forEach((player, index) => {
            const playerScore = scores[player] || 0;
            const li = document.createElement('li');

            const playerEntry = document.createElement('div');
            playerEntry.className = index % 2 === 0 ? 'player-entry-1' : 'player-entry-2';

            // Posizione
            const position = document.createElement('p');
            position.className = 'player-entry-text';
            position.textContent = `${index + 1}.`;

            // Avatar
            const avatarCircle = document.createElement('div');
            avatarCircle.className = 'avatar-circle';

            const avatarColor = document.createElement('div');
            avatarColor.className = 'avatar-color';
            avatarColor.style.backgroundColor = player;

            // Se è l'artista corrente, aggiungi un indicatore
            if (player === gameState.currentTurn) {
                avatarCircle.style.border = '2px solid gold';
            }

            // Se ha indovinato correttamente, aggiungi un indicatore
            if (gameState.correctGuesses.includes(player)) {
                const checkmark = document.createElement('span');
                checkmark.textContent = '✓';
                checkmark.style.color = 'green';
                checkmark.style.fontSize = '16px';
                checkmark.style.marginLeft = '5px';
                playerEntry.appendChild(checkmark);
            }

            // Score
            const scoreBox = document.createElement('div');
            scoreBox.className = 'score-box';
            const scoreText = document.createElement('p');
            scoreText.textContent = `${playerScore} pts.`;

            // Assembla tutto
            avatarCircle.appendChild(avatarColor);
            scoreBox.appendChild(scoreText);

            playerEntry.appendChild(position);
            playerEntry.appendChild(avatarCircle);
            playerEntry.appendChild(scoreBox);

            li.appendChild(playerEntry);
            playersList.appendChild(li);
        });
    }

    function updateTimer(time) {
        timerText.textContent = `${time}s`;
        if (time <= 10) {
            timerText.style.color = 'red';
        } else {
            timerText.style.color = 'black';
        }
    }

    function updateHint(hint) {
        hintText.textContent = hint;
    }

    // ==================== SOCKET EVENT HANDLERS ====================
    socket.on('gameState', (state) => {
        gameState = state;

        // Aggiorna UI in base allo stato del gioco
        updatePlayerList(state.players, state.scores);
        updateTimer(state.timer);

        // Se sei l'artista corrente, permetti di disegnare
        canDraw = playerColor === state.currentTurn;

        // Aggiorna UI per l'artista
        if (canDraw && state.wordOptions && state.wordOptions.length > 0) {
            createWordSelectionUI(state.wordOptions);
        }

        // Aggiorna hint
        if (state.hint) {
            updateHint(state.hint);
        }
    });

    socket.on('drawLine', (data) => {
        // Se non sei l'artista, disegna ciò che ricevi
        if (playerColor !== gameState.currentTurn) {
            ctx.beginPath();
            ctx.moveTo(data.from.x, data.from.y);
            ctx.lineTo(data.to.x, data.to.y);
            ctx.strokeStyle = data.color;
            ctx.lineWidth = data.lineWidth;
            ctx.stroke();
        }
    });

    socket.on('clearCanvas', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    socket.on('message', (data) => {
        addMessage(data.message, data.type);
    });

    socket.on('roundEnd', (data) => {
        // Mostra la parola corretta e informazioni sul round
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#FFFFF0';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'black';
        ctx.font = '36px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`La parola era: ${data.word}`, canvas.width / 2, canvas.height / 2 - 50);

        // Aggiorna i punteggi
        updatePlayerList(gameState.players, data.newScores);

        addMessage(`Round terminato! La parola era: ${data.word}`, 'system');
    });

    socket.on('gameEnd', (data) => {
        // Mostra classifica finale
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#FFFFF0';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'black';
        ctx.font = '36px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('Game Over!', canvas.width / 2, 50);

        // Mostra la classifica
        ctx.font = '24px Inter';
        const sortedPlayers = [...data.players].sort((a, b) => data.finalScores[b] - data.finalScores[a]);

        sortedPlayers.forEach((player, index) => {
            const y = 120 + index * 40;
            ctx.textAlign = 'left';
            ctx.fillText(`${index + 1}. ${player}`, canvas.width / 4, y);
            ctx.textAlign = 'right';
            ctx.fillText(`${data.finalScores[player]} pts`, canvas.width * 3 / 4, y);
        });

        // Aggiungi un messaggio per tornare alla lobby
        ctx.font = '20px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('Returning to lobby in 10 seconds...', canvas.width / 2, canvas.height - 50);

        // Ritorna alla lobby dopo 10 secondi
        setTimeout(() => {
            window.location.href = `/lobby.html?lobby=${lobbyId}&color=${playerColor}`;
        }, 10000);
    });

    // ==================== PALETTE AND TOOLS ====================
    function createDrawingTools() {
        if (!canDraw) return; // Solo l'artista ha gli strumenti di disegno

        const toolbox = document.createElement('div');
        toolbox.className = 'drawing-tools';
        toolbox.style.position = 'absolute';
        toolbox.style.top = '10px';
        toolbox.style.left = '10px';
        toolbox.style.display = 'flex';
        toolbox.style.flexDirection = 'column';
        toolbox.style.gap = '10px';

        // Colori
        const colors = ['black', 'red', 'blue', 'green', 'yellow', 'purple', 'brown'];
        const palette = document.createElement('div');
        palette.style.display = 'flex';
        palette.style.gap = '5px';

        colors.forEach(color => {
            const colorBtn = document.createElement('div');
            colorBtn.style.width = '20px';
            colorBtn.style.height = '20px';
            colorBtn.style.backgroundColor = color;
            colorBtn.style.border = '1px solid #333';
            colorBtn.style.cursor = 'pointer';

            colorBtn.addEventListener('click', () => {
                currentColor = color;
                ctx.strokeStyle = color;
            });

            palette.appendChild(colorBtn);
        });

        // Spessore linea
        const lineWidths = [2, 5, 10, 15];
        const lineWidthTools = document.createElement('div');
        lineWidthTools.style.display = 'flex';
        lineWidthTools.style.gap = '5px';

        lineWidths.forEach(width => {
            const lineBtn = document.createElement('div');
            lineBtn.style.width = `${width * 2}px`;
            lineBtn.style.height = '20px';
            lineBtn.style.backgroundColor = 'black';
            lineBtn.style.border = '1px solid #333';
            lineBtn.style.cursor = 'pointer';

            lineBtn.addEventListener('click', () => {
                currentLineWidth = width;
                ctx.lineWidth = width;
            });

            lineWidthTools.appendChild(lineBtn);
        });

        // Cancella tutto
        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear';
        clearBtn.style.padding = '5px';
        clearBtn.style.cursor = 'pointer';

        clearBtn.addEventListener('click', () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            socket.emit('clearCanvas', { lobbyId });
        });

        toolbox.appendChild(palette);
        toolbox.appendChild(lineWidthTools);
        toolbox.appendChild(clearBtn);
        canvasBox.appendChild(toolbox);
    }

    // Inizializza il canvas
    setupCanvas();

    // Aggiorna lo stato iniziale
    socket.emit('requestGameState', { lobbyId });
}); document.addEventListener('DOMContentLoaded', () => {
    // Recupero parametri dall'URL
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const playerColor = urlParams.get('color');
    const gameId = urlParams.get('game');

    if (!lobbyId || !playerColor || !gameId) {
        window.location.href = '/';
        return;
    }

    // Inizializzazione socket
    const socket = io();
    socket.emit('joinLobby', lobbyId);
    socket.emit('joinGame', { lobbyId, gameId, playerColor });

    // Setup elementi DOM
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const canvasBox = document.querySelector('.canvas-box');
    const timerText = document.querySelector('.timer-text');
    const hintText = document.querySelector('.hint');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const messagesBox = document.querySelector('.messages-box');
    const playersList = document.querySelector('.players-ul');

    // Setup canvas
    canvas.width = 780;
    canvas.height = 530;
    canvas.style.backgroundColor = 'white';
    canvasBox.appendChild(canvas);

    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let currentColor = 'black';
    let currentLineWidth = 5;
    let canDraw = false; // Permesso di disegnare (solo per l'artista)
    let gameState = {
        currentTurn: null,
        currentWord: null,
        wordOptions: [],
        timer: 60,
        players: [],
        scores: {},
        correctGuesses: []
    };

    // ==================== CANVAS DRAWING FUNCTIONS ====================
    function startDrawing(e) {
        if (!canDraw) return;
        isDrawing = true;
        [lastX, lastY] = [e.offsetX, e.offsetY];
    }

    function draw(e) {
        if (!isDrawing || !canDraw) return;
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(e.offsetX, e.offsetY);
        ctx.stroke();

        // Emettere l'evento di disegno al server
        socket.emit('draw', {
            lobbyId,
            from: { x: lastX, y: lastY },
            to: { x: e.offsetX, y: e.offsetY },
            color: currentColor,
            lineWidth: currentLineWidth
        });

        [lastX, lastY] = [e.offsetX, e.offsetY];
    }

    function stopDrawing() {
        isDrawing = false;
    }

    function setupCanvas() {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = currentLineWidth;
        ctx.strokeStyle = currentColor;

        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseout', stopDrawing);
    }

    // ==================== CHAT FUNCTIONS ====================
    function addMessage(message, type = 'normal') {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${type}`;
        messageElement.textContent = message;
        messagesBox.appendChild(messageElement);
        messagesBox.scrollTop = messagesBox.scrollHeight;
    }

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const guess = chatInput.value.trim();
        if (guess) {
            socket.emit('guess', { lobbyId, playerColor, guess });
            chatInput.value = '';
        }
    });

    // ==================== WORD SELECTION FUNCTIONS ====================
    function createWordSelectionUI(words) {
        // Pulisci canvas e crea UI per la selezione della parola
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#FFFFF0';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const wordBoxHeight = 100;
        const spacing = 30;
        const y = canvas.height / 2 - wordBoxHeight / 2;

        words.forEach((word, index) => {
            const boxWidth = 200;
            const x = canvas.width / 2 - ((words.length * boxWidth) + ((words.length - 1) * spacing)) / 2 + index * (boxWidth + spacing);

            // Disegna il box
            ctx.fillStyle = '#FFFFDF';
            ctx.strokeStyle = '#B8B8B8';
            ctx.lineWidth = 2;
            ctx.fillRect(x, y, boxWidth, wordBoxHeight);
            ctx.strokeRect(x, y, boxWidth, wordBoxHeight);

            // Disegna il testo
            ctx.fillStyle = 'black';
            ctx.font = '24px Inter';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(word, x + boxWidth / 2, y + wordBoxHeight / 2);

            // Aggiungi event listener per il click
            canvas.addEventListener('click', function wordSelectHandler(e) {
                const clickX = e.offsetX;
                const clickY = e.offsetY;

                if (clickX >= x && clickX <= x + boxWidth && clickY >= y && clickY <= y + wordBoxHeight) {
                    socket.emit('wordSelected', { lobbyId, word });
                    canvas.removeEventListener('click', wordSelectHandler);
                }
            });
        });
    }

    // ==================== UPDATE FUNCTIONS ====================
    function updatePlayerList(players, scores) {
        playersList.innerHTML = '';

        players.forEach((player, index) => {
            const playerScore = scores[player] || 0;
            const li = document.createElement('li');

            const playerEntry = document.createElement('div');
            playerEntry.className = index % 2 === 0 ? 'player-entry-1' : 'player-entry-2';

            // Posizione
            const position = document.createElement('p');
            position.className = 'player-entry-text';
            position.textContent = `${index + 1}.`;

            // Avatar
            const avatarCircle = document.createElement('div');
            avatarCircle.className = 'avatar-circle';

            const avatarColor = document.createElement('div');
            avatarColor.className = 'avatar-color';
            avatarColor.style.backgroundColor = player;

            // Se è l'artista corrente, aggiungi un indicatore
            if (player === gameState.currentTurn) {
                avatarCircle.style.border = '2px solid gold';
            }

            // Se ha indovinato correttamente, aggiungi un indicatore
            if (gameState.correctGuesses.includes(player)) {
                const checkmark = document.createElement('span');
                checkmark.textContent = '✓';
                checkmark.style.color = 'green';
                checkmark.style.fontSize = '16px';
                checkmark.style.marginLeft = '5px';
                playerEntry.appendChild(checkmark);
            }

            // Score
            const scoreBox = document.createElement('div');
            scoreBox.className = 'score-box';
            const scoreText = document.createElement('p');
            scoreText.textContent = `${playerScore} pts.`;

            // Assembla tutto
            avatarCircle.appendChild(avatarColor);
            scoreBox.appendChild(scoreText);

            playerEntry.appendChild(position);
            playerEntry.appendChild(avatarCircle);
            playerEntry.appendChild(scoreBox);

            li.appendChild(playerEntry);
            playersList.appendChild(li);
        });
    }

    function updateTimer(time) {
        timerText.textContent = `${time}s`;
        if (time <= 10) {
            timerText.style.color = 'red';
        } else {
            timerText.style.color = 'black';
        }
    }

    function updateHint(hint) {
        hintText.textContent = hint;
    }

    // ==================== SOCKET EVENT HANDLERS ====================
    socket.on('gameState', (state) => {
        gameState = state;

        // Aggiorna UI in base allo stato del gioco
        updatePlayerList(state.players, state.scores);
        updateTimer(state.timer);

        // Se sei l'artista corrente, permetti di disegnare
        canDraw = playerColor === state.currentTurn;

        // Aggiorna UI per l'artista
        if (canDraw && state.wordOptions && state.wordOptions.length > 0) {
            createWordSelectionUI(state.wordOptions);
        }

        // Aggiorna hint
        if (state.hint) {
            updateHint(state.hint);
        }
    });

    socket.on('drawLine', (data) => {
        // Se non sei l'artista, disegna ciò che ricevi
        if (playerColor !== gameState.currentTurn) {
            ctx.beginPath();
            ctx.moveTo(data.from.x, data.from.y);
            ctx.lineTo(data.to.x, data.to.y);
            ctx.strokeStyle = data.color;
            ctx.lineWidth = data.lineWidth;
            ctx.stroke();
        }
    });

    socket.on('clearCanvas', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    socket.on('message', (data) => {
        addMessage(data.message, data.type);
    });

    socket.on('roundEnd', (data) => {
        // Mostra la parola corretta e informazioni sul round
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#FFFFF0';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'black';
        ctx.font = '36px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`La parola era: ${data.word}`, canvas.width / 2, canvas.height / 2 - 50);

        // Aggiorna i punteggi
        updatePlayerList(gameState.players, data.newScores);

        addMessage(`Round terminato! La parola era: ${data.word}`, 'system');
    });

    socket.on('gameEnd', (data) => {
        // Mostra classifica finale
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#FFFFF0';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'black';
        ctx.font = '36px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('Game Over!', canvas.width / 2, 50);

        // Mostra la classifica
        ctx.font = '24px Inter';
        const sortedPlayers = [...data.players].sort((a, b) => data.finalScores[b] - data.finalScores[a]);

        sortedPlayers.forEach((player, index) => {
            const y = 120 + index * 40;
            ctx.textAlign = 'left';
            ctx.fillText(`${index + 1}. ${player}`, canvas.width / 4, y);
            ctx.textAlign = 'right';
            ctx.fillText(`${data.finalScores[player]} pts`, canvas.width * 3 / 4, y);
        });

        // Aggiungi un messaggio per tornare alla lobby
        ctx.font = '20px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('Returning to lobby in 10 seconds...', canvas.width / 2, canvas.height - 50);

        // Ritorna alla lobby dopo 10 secondi
        setTimeout(() => {
            window.location.href = `/lobby.html?lobby=${lobbyId}&color=${playerColor}`;
        }, 10000);
    });

    // ==================== PALETTE AND TOOLS ====================
    function createDrawingTools() {
        if (!canDraw) return; // Solo l'artista ha gli strumenti di disegno

        const toolbox = document.createElement('div');
        toolbox.className = 'drawing-tools';
        toolbox.style.position = 'absolute';
        toolbox.style.top = '10px';
        toolbox.style.left = '10px';
        toolbox.style.display = 'flex';
        toolbox.style.flexDirection = 'column';
        toolbox.style.gap = '10px';

        // Colori
        const colors = ['black', 'red', 'blue', 'green', 'yellow', 'purple', 'brown'];
        const palette = document.createElement('div');
        palette.style.display = 'flex';
        palette.style.gap = '5px';

        colors.forEach(color => {
            const colorBtn = document.createElement('div');
            colorBtn.style.width = '20px';
            colorBtn.style.height = '20px';
            colorBtn.style.backgroundColor = color;
            colorBtn.style.border = '1px solid #333';
            colorBtn.style.cursor = 'pointer';

            colorBtn.addEventListener('click', () => {
                currentColor = color;
                ctx.strokeStyle = color;
            });

            palette.appendChild(colorBtn);
        });

        // Spessore linea
        const lineWidths = [2, 5, 10, 15];
        const lineWidthTools = document.createElement('div');
        lineWidthTools.style.display = 'flex';
        lineWidthTools.style.gap = '5px';

        lineWidths.forEach(width => {
            const lineBtn = document.createElement('div');
            lineBtn.style.width = `${width * 2}px`;
            lineBtn.style.height = '20px';
            lineBtn.style.backgroundColor = 'black';
            lineBtn.style.border = '1px solid #333';
            lineBtn.style.cursor = 'pointer';

            lineBtn.addEventListener('click', () => {
                currentLineWidth = width;
                ctx.lineWidth = width;
            });

            lineWidthTools.appendChild(lineBtn);
        });

        // Cancella tutto
        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear';
        clearBtn.style.padding = '5px';
        clearBtn.style.cursor = 'pointer';

        clearBtn.addEventListener('click', () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            socket.emit('clearCanvas', { lobbyId });
        });

        toolbox.appendChild(palette);
        toolbox.appendChild(lineWidthTools);
        toolbox.appendChild(clearBtn);
        canvasBox.appendChild(toolbox);
    }

    // Inizializza il canvas
    setupCanvas();

    // Aggiorna lo stato iniziale
    socket.emit('requestGameState', { lobbyId });
});