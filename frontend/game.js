/* document.addEventListener('DOMContentLoaded', () => {
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
    const themeBtn = document.getElementById('theme-toggle-btn');

    // Gestione Tema
    const body = document.body;
    if (localStorage.getItem('quiz-theme') === 'dark') body.classList.add('theme-dark');
    if (themeBtn) {
        themeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            body.classList.toggle('theme-dark');
            localStorage.setItem('quiz-theme', body.classList.contains('theme-dark') ? 'dark' : 'light');
        });
    }

    // --- SETUP CANVAS ---
    let canvas = document.getElementById('drawing-canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'drawing-canvas';
        canvasBox.appendChild(canvas);
    }

    // Risoluzione interna fissa
    canvas.width = 800;
    canvas.height = 600;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Variabili Stato Disegno
    let isDrawing = false;
    let lastX = 0, lastY = 0;
    let currentColor = '#000000';
    let lastUsedColor = '#000000';
    let currentLineWidth = 5;
    let currentTool = 'pen';
    let amIArtist = false;
    let fillMode = false;

    // Cronologia Disegno
    let drawingHistory = [];
    let redoHistory = [];
    const MAX_HISTORY = 30;

    // =========================================================
    // 2. SOCKET IO
    // =========================================================
    const socket = io();

    console.log(`🔌 Mi unisco alla lobby: ${lobbyId}`);
    socket.emit('joinLobby', lobbyId);
    socket.emit('joinGame', { lobbyId, gameId, playerColor, settings: gameSettings });
    socket.emit('requestGameState', { lobbyId });

    // =========================================================
    // 3. LOGICA DISEGNO
    // =========================================================

    function getMousePos(evt) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return [
            (evt.clientX - rect.left) * scaleX,
            (evt.clientY - rect.top) * scaleY
        ];
    }

    // Funzione per salvare lo stato nella cronologia
    function saveState() {
        if (drawingHistory.length >= MAX_HISTORY) drawingHistory.shift();
        drawingHistory.push(canvas.toDataURL());
        redoHistory = []; // Quando disegni qualcosa di nuovo, il "Redo" si resetta
    }

    function startDrawing(e) {
        if (!amIArtist) return;
        const event = e.touches ? e.touches[0] : e;
        const [x, y] = getMousePos(event);

        if (currentTool === 'fill') {
            fillCanvas(currentColor);
            saveState();
            return;
        }

        isDrawing = true;
        [lastX, lastY] = [x, y];
        draw(e);
    }

    function draw(e) {
        if (e.type === 'mousemove' && e.buttons === 0) { isDrawing = false; return; }
        if (!isDrawing || !amIArtist) return;
        if (e.type !== 'mousedown') e.preventDefault();

        const event = e.touches ? e.touches[0] : e;
        const [x, y] = getMousePos(event);
        const color = (currentTool === 'eraser') ? '#FFFFFF' : currentColor;

        drawLine(ctx, lastX, lastY, x, y, color, currentLineWidth);

        socket.emit('draw', {
            lobbyId,
            from: { x: lastX, y: lastY },
            to: { x, y },
            color: color,
            lineWidth: currentLineWidth
        });

        [lastX, lastY] = [x, y];
    }

    function stopDrawing() {
        if (isDrawing && amIArtist) saveState();
        isDrawing = false;
    }

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

    function fillCanvas(color) {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        socket.emit('fillArea', { lobbyId, color });
    }

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);
    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing);

    // =========================================================
    // 4. FUNZIONI GLOBALI (Undo, Redo, Tools)
    // =========================================================

    // Undo: Torna allo stato precedente
    window.undo = () => {
        // Serve almeno 1 stato (quello iniziale bianco) + 1 azione per fare undo
        if (drawingHistory.length <= 1) return;

        // 1. Prendi lo stato attuale e mettilo nel Redo
        const currentState = drawingHistory.pop();
        redoHistory.push(currentState);

        // 2. Prendi lo stato precedente (ora è l'ultimo della lista)
        const previousState = drawingHistory[drawingHistory.length - 1];

        // 3. Ripristinalo
        restoreState(previousState);
    };

    // Redo: Ripristina l'azione annullata
    window.redo = () => {
        if (redoHistory.length === 0) return;

        // 1. Prendi dal Redo
        const nextState = redoHistory.pop();

        // 2. Rimettilo nella History
        drawingHistory.push(nextState);

        // 3. Disegnalo
        restoreState(nextState);
    };

    function restoreState(dataURL) {
        const img = new Image();
        img.src = dataURL;
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);

            // FONDAMENTALE: Diciamo al server di aggiornare tutti gli altri!
            socket.emit('canvasState', { lobbyId, dataURL });
        };
    }

    // Tools Helpers
    window.setTool = (tool) => {
        currentTool = tool;
        canvas.style.cursor = tool === 'eraser' ? 'cell' : (tool === 'fill' ? 'alias' : 'crosshair');
        updateActiveBtn('.tool-btn', `[data-tool="${tool}"]`);
    };
    window.setSize = (size) => {
        currentLineWidth = size;
        updateActiveBtn('.size-btn', `[data-size="${size}"]`);
    };
    window.setColor = (color) => {
        currentColor = color;
        currentTool = 'pen';
        updateActiveBtn('.color-btn', `[data-color="${color}"]`);
        updateActiveBtn('.tool-btn', `[data-tool="pen"]`);
    };
    window.clearCanvas = () => {
        if (!confirm("Cancellare tutto?")) return;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        socket.emit('clearCanvas', { lobbyId });
        saveState();
    };

    function updateActiveBtn(selector, activeSelector) {
        document.querySelectorAll(selector).forEach(b => b.classList.remove('active'));
        const active = document.querySelector(`${selector}${activeSelector}`);
        if (active) active.classList.add('active');
    }

    // =========================================================
    // 5. SOCKET LISTENERS
    // =========================================================

    socket.on('drawLine', (data) => drawLine(ctx, data.from.x, data.from.y, data.to.x, data.to.y, data.color, data.lineWidth));
    socket.on('fillArea', (data) => { ctx.fillStyle = data.color; ctx.fillRect(0, 0, canvas.width, canvas.height); });

    // GESTIONE PULIZIA E RESET CRONOLOGIA
    socket.on('clearCanvas', () => {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Se sono l'artista, questo è il momento in cui resetto la storia!
        // Perché il server manda clearCanvas all'inizio di ogni turno.
        if (amIArtist) {
            drawingHistory = [];
            redoHistory = [];
            saveState(); // Salva lo stato bianco pulito come "Punto Zero"
        }
    });

    socket.on('canvasState', (data) => {
        // Se qualcun altro fa Undo/Redo, ricevo l'immagine intera
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
    // 6. GAME LOGIC
    // =========================================================

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;
        if (amIArtist) addMessage("Non puoi suggerire mentre disegni!", "error");
        else socket.emit('guess', { lobbyId, playerColor, guess: text });
        chatInput.value = '';
    });

    function addMessage(msg, type) {
        const div = document.createElement('div');
        div.className = `message ${type}`;
        if (type === 'chat' && msg.includes(':')) {
            const idx = msg.indexOf(':');
            const color = msg.substring(0, idx).trim();
            const text = msg.substring(idx + 1).trim();
            div.style.display = 'flex'; div.style.alignItems = 'center'; div.style.gap = '8px';
            div.innerHTML = `
                <div class="avatar-circle" style="width:20px;height:20px;min-width:20px;">
                    <div class="avatar-color" style="background:${color};width:100%;height:100%;border-radius:50%;border:1px solid #ccc;"></div>
                </div>
                <span>${text}</span>`;
        } else {
            div.textContent = msg;
        }
        messagesBox.appendChild(div);
        messagesBox.scrollTop = messagesBox.scrollHeight;
    }
    socket.on('message', (d) => addMessage(d.message, d.type));

    socket.on('gameState', (state) => {
        timerText.textContent = state.timer + 's';
        currentRoundText.textContent = state.round;
        totalRoundsText.textContent = state.totalRounds;

        const prevArtist = amIArtist;
        amIArtist = (state.currentTurn === playerColor);

        if (amIArtist) {
            hintText.textContent = state.currentWord || "Scegli...";
            hintText.parentElement.classList.add('artist-view');
            canvas.style.cursor = "crosshair";
            chatInput.disabled = true;
            chatInput.placeholder = "Tu disegni!";

            if (!document.querySelector('.artist-controls')) addArtistControls();
            else document.querySelector('.artist-controls').style.display = 'flex';

            // NOTA: Ho rimosso saveState() da qui perché lo facciamo in clearCanvas
            // Questo evita il problema del "Ghost Drawing"

            if (!prevArtist) {
                artistNotification.innerHTML = "È il tuo turno!<br>Disegna!";
                artistNotification.style.display = 'block';
                setTimeout(() => artistNotification.style.display = 'none', 2000);
            }
        } else {
            hintText.textContent = state.hint;
            hintText.parentElement.classList.remove('artist-view');
            canvas.style.cursor = "default";
            chatInput.disabled = false;
            chatInput.placeholder = "Indovina...";

            const controls = document.querySelector('.artist-controls');
            if (controls) controls.style.display = 'none';
        }

        updateStandings(state.players, state.scores, state.currentTurn);
        if (amIArtist && state.wordOptions && state.wordOptions.length > 0) showWordSelection(state.wordOptions);
    });

    socket.on('roundEnd', (data) => {
        revealedWordElement.textContent = data.word;
        roundEndModal.style.display = 'flex';
        setTimeout(() => roundEndModal.style.display = 'none', 4500);
    });

    socket.on('gameEnd', () => gameEndModal.style.display = 'flex');
    if (backToLobbyBtn) backToLobbyBtn.onclick = () => window.location.href = `/lobby.html?lobby=${lobbyId}&color=${playerColor}`;

    function updateStandings(players, scores, artist) {
        standingBox.innerHTML = '';
        players.forEach(p => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div class="player-entry-1 ${p === playerColor ? 'current-player' : ''}">
                    <div class="avatar-circle"><div class="avatar-color" style="background:${p}"></div></div>
                    <div class="player-info">${p === playerColor ? 'Tu' : ''}</div>
                    <div class="score-box">${scores[p] || 0} pt ${p === artist ? '✏️' : ''}</div>
                </div>`;
            standingBox.appendChild(li);
        });
    }

    function showWordSelection(words) {
        const exist = document.querySelector('.word-selection-modal'); if (exist) exist.remove();
        const modal = document.createElement('div');
        modal.className = 'word-selection-modal';
        modal.style.zIndex = "2000";
        modal.innerHTML = `<div class="word-selection-content"><h3>Scegli parola:</h3><div class="word-list"></div></div>`;
        const list = modal.querySelector('.word-list');
        words.forEach(w => {
            const btn = document.createElement('button');
            btn.className = 'word-option';
            btn.textContent = w;
            btn.onmousedown = (e) => {
                e.preventDefault();
                socket.emit('wordSelected', { lobbyId, word: w });
                modal.remove();
            };
            list.appendChild(btn);
        });
        document.body.appendChild(modal);
    }

    function addArtistControls() {
        const controls = document.createElement('div');
        controls.className = 'artist-controls';
        controls.innerHTML = `
            <div class="tools-row">
                <button class="tool-btn" onclick="window.undo()" title="Undo">↩️</button>
                <button class="tool-btn" onclick="window.redo()" title="Redo">↪️</button>
                <div style="width:1px; background:#ddd; margin:0 5px;"></div>
                <button class="tool-btn size-btn" data-size="2" onclick="window.setSize(2)" title="Sottile">•</button>
                <button class="tool-btn size-btn active" data-size="5" onclick="window.setSize(5)" title="Medio">●</button>
                <button class="tool-btn size-btn" data-size="10" onclick="window.setSize(10)" title="Spesso">⬤</button>
                <div style="width:1px; background:#ddd; margin:0 5px;"></div>
                <button class="tool-btn active" data-tool="pen" onclick="window.setTool('pen')" title="Penna">✏️</button>
                <button class="tool-btn" data-tool="fill" onclick="window.setTool('fill')" title="Riempi">🪣</button>
                <button class="tool-btn" data-tool="eraser" onclick="window.setTool('eraser')" title="Gomma">🧼</button>
                <button class="tool-btn" onclick="window.clearCanvas()" title="Pulisci" style="color:red">✖</button>
            </div>
            <div class="colors-row">
                ${['#000000', '#7f8c8d', '#c0392b', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#27ae60', '#3498db', '#2980b9', '#9b59b6', '#8e44ad', '#34495e', '#ffffff'].map(c =>
            `<div class="color-btn" data-color="${c}" style="background-color:${c}" onclick="window.setColor('${c}')"></div>`
        ).join('')}
            </div>`;
        canvasBox.appendChild(controls);
    }
}); */

// frontend/game.js

// frontend/game.js

document.addEventListener('DOMContentLoaded', () => {
    console.log("🎨 Drawing Game Script Caricato (Stile Gartic - Advanced)");

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
        window.location.href = '/';
        return;
    }

    // Elementi DOM
    const canvasBox = document.querySelector('.canvas-area');
    const timerText = document.querySelector('.timer-text');
    const hintText = document.querySelector('.hint');
    const currentRoundText = document.getElementById('current-round');
    const totalRoundsText = document.getElementById('total-rounds');
    const messagesBox = document.querySelector('.messages-box');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const standingBox = document.getElementById('players-ul');
    const artistNotification = document.getElementById('artist-notification');
    const gameEndModal = document.getElementById('game-end-modal');
    const roundEndModal = document.getElementById('round-end-modal');
    const revealedWordElement = document.getElementById('revealed-word');
    const backToLobbyBtn = document.getElementById('back-to-lobby');
    const artistControls = document.getElementById('artist-controls');
    const colorsContainer = document.getElementById('colors-container');
    const correctSound = document.getElementById('correctSound');

    // --- SETUP CANVAS ---
    let canvas = document.getElementById('drawing-canvas');
    canvas.width = 800;
    canvas.height = 600;

    const ctx = canvas.getContext('2d', { willReadFrequently: true }); // Ottimizzato per il Flood Fill
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Variabili Stato Disegno
    let isDrawing = false;
    let lastX = 0, lastY = 0;
    let currentColor = '#000000';
    let currentLineWidth = 5;
    let currentTool = 'pen';
    let amIArtist = false;

    // Cronologia Disegno (Undo/Redo)
    let drawingHistory = [];
    let redoHistory = [];
    const MAX_HISTORY = 30;

    // Genera Palette Colori
    const palette = ['#000000', '#7f8c8d', '#c0392b', '#E74C3C', '#E67E22', '#F1C40F', '#2ECC71', '#27ae60', '#3498DB', '#2980b9', '#9b59b6', '#8e44ad', '#34495e', '#ffffff'];
    palette.forEach(c => {
        const btn = document.createElement('div');
        btn.className = `color-btn ${c === '#000000' ? 'active' : ''}`;
        btn.style.backgroundColor = c;
        btn.dataset.color = c;
        btn.onclick = () => window.setColor(c);
        colorsContainer.appendChild(btn);
    });

    // =========================================================
    // 2. SOCKET IO
    // =========================================================
    const socket = io();

    socket.emit('joinLobby', lobbyId);
    socket.emit('joinGame', { lobbyId, gameId, playerColor, settings: gameSettings });
    socket.emit('requestGameState', { lobbyId });

    // =========================================================
    // 3. LOGICA DISEGNO E FLOOD FILL (Secchiello Vero)
    // =========================================================

    function getMousePos(evt) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        let clientX = evt.clientX;
        let clientY = evt.clientY;

        if (evt.touches && evt.touches.length > 0) {
            clientX = evt.touches[0].clientX;
            clientY = evt.touches[0].clientY;
        }

        return [
            (clientX - rect.left) * scaleX,
            (clientY - rect.top) * scaleY
        ];
    }

    function saveState() {
        if (drawingHistory.length >= MAX_HISTORY) drawingHistory.shift();
        drawingHistory.push(canvas.toDataURL());
        redoHistory = [];
    }

    // --- ALGORITMO FLOOD FILL (Secchiello) ---
    function floodFill(startX, startY, fillColorHex) {
        startX = Math.floor(startX);
        startY = Math.floor(startY);

        if (startX < 0 || startX >= canvas.width || startY < 0 || startY >= canvas.height) return;

        const hex = fillColorHex.replace('#', '');
        const fillR = parseInt(hex.substring(0, 2), 16);
        const fillG = parseInt(hex.substring(2, 4), 16);
        const fillB = parseInt(hex.substring(4, 6), 16);
        const fillA = 255;

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const startPos = (startY * canvas.width + startX) * 4;

        const startR = data[startPos];
        const startG = data[startPos + 1];
        const startB = data[startPos + 2];
        const startA = data[startPos + 3];

        // Se clicchi su un colore che è già quello del pennello, ignora
        if (startR === fillR && startG === fillG && startB === fillB) return;

        const matchColor = (pos) => {
            const rDiff = Math.abs(data[pos] - startR);
            const gDiff = Math.abs(data[pos + 1] - startG);
            const bDiff = Math.abs(data[pos + 2] - startB);
            const aDiff = Math.abs(data[pos + 3] - startA);
            return (rDiff + gDiff + bDiff + aDiff) < 60; // Tolleranza per l'anti-aliasing del pennello
        };

        const colorPixel = (pos) => {
            data[pos] = fillR;
            data[pos + 1] = fillG;
            data[pos + 2] = fillB;
            data[pos + 3] = fillA;
        };

        const stack = [[startX, startY]];

        while (stack.length > 0) {
            const [x, y] = stack.pop();
            const pos = (y * canvas.width + x) * 4;

            if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) continue;
            if (!matchColor(pos)) continue;

            colorPixel(pos);

            stack.push([x + 1, y]);
            stack.push([x - 1, y]);
            stack.push([x, y + 1]);
            stack.push([x, y - 1]);
        }

        ctx.putImageData(imageData, 0, 0);
    }

    function startDrawing(e) {
        if (!amIArtist) return;
        const [x, y] = getMousePos(e);

        if (currentTool === 'fill') {
            floodFill(x, y, currentColor);
            saveState();
            socket.emit('fillArea', { lobbyId, x, y, color: currentColor }); // Invia x e y
            return;
        }

        isDrawing = true;
        [lastX, lastY] = [x, y];
        draw(e);
    }

    function draw(e) {
        if (e.type === 'mousemove' && e.buttons === 0) { isDrawing = false; return; }
        if (!isDrawing || !amIArtist) return;
        if (e.type !== 'mousedown' && e.type !== 'touchstart') e.preventDefault();

        const [x, y] = getMousePos(e);
        const color = (currentTool === 'eraser') ? '#FFFFFF' : currentColor;

        drawLine(ctx, lastX, lastY, x, y, color, currentLineWidth);

        socket.emit('draw', { lobbyId, from: { x: lastX, y: lastY }, to: { x, y }, color: color, lineWidth: currentLineWidth });

        [lastX, lastY] = [x, y];
    }

    function stopDrawing() {
        if (isDrawing && amIArtist) saveState();
        isDrawing = false;
    }

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

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing);

    // =========================================================
    // 4. FUNZIONI GLOBALI (Undo, Redo, Tools)
    // =========================================================

    window.undo = () => {
        if (drawingHistory.length <= 1) return;
        const currentState = drawingHistory.pop();
        redoHistory.push(currentState);
        const previousState = drawingHistory[drawingHistory.length - 1];
        restoreState(previousState);
    };

    window.redo = () => {
        if (redoHistory.length === 0) return;
        const nextState = redoHistory.pop();
        drawingHistory.push(nextState);
        restoreState(nextState);
    };

    function restoreState(dataURL) {
        const img = new Image();
        img.src = dataURL;
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            socket.emit('canvasState', { lobbyId, dataURL });
        };
    }

    window.setTool = (tool) => {
        currentTool = tool;
        canvas.style.cursor = tool === 'eraser' ? 'cell' : (tool === 'fill' ? 'alias' : 'crosshair');
        updateActiveBtn('.tool-btn', `[data-tool="${tool}"]`);
    };

    window.setSize = (size) => {
        currentLineWidth = size;
        updateActiveBtn('.size-btn', `[data-size="${size}"]`);
    };

    window.setColor = (color) => {
        currentColor = color;
        currentTool = 'pen';
        updateActiveBtn('.color-btn', `[data-color="${color}"]`);
        updateActiveBtn('.tool-btn', `[data-tool="pen"]`);
    };

    window.clearCanvas = () => {
        if (!confirm("Sei sicuro di voler cancellare tutto?")) return;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        socket.emit('clearCanvas', { lobbyId });
        saveState();
    };

    function updateActiveBtn(selector, activeSelector) {
        document.querySelectorAll(selector).forEach(b => b.classList.remove('active'));
        const active = document.querySelector(`${selector}${activeSelector}`);
        if (active) active.classList.add('active');
    }

    // =========================================================
    // 5. SOCKET LISTENERS (Disegno Inbound)
    // =========================================================

    socket.on('drawLine', (data) => drawLine(ctx, data.from.x, data.from.y, data.to.x, data.to.y, data.color, data.lineWidth));

    socket.on('fillArea', (data) => {
        if (data.x !== undefined && data.y !== undefined) {
            floodFill(data.x, data.y, data.color);
        } else { // Fallback di sicurezza
            ctx.fillStyle = data.color;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    });

    socket.on('clearCanvas', () => {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (amIArtist) {
            drawingHistory = [];
            redoHistory = [];
            saveState();
        }
    });

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
    // 6. GAME LOGIC, UI UPDATES & FINE PARTITA
    // =========================================================

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

    // Costruzione Grafica Messaggi Chat
    // --- FUNZIONE ROBUSTA PER LA CLASSIFICA FINALE ---
    // --- FUNZIONE ROBUSTA PER LA CLASSIFICA FINALE ---
    function showGameEnd(payload) {
        const finalStandingsDiv = document.getElementById('final-standings');

        // Cerca in modo ricorsivo l'oggetto dei punteggi (ignora strutture sporche del server)
        function findScores(obj) {
            if (!obj) return null;
            if (typeof obj === 'object' && !Array.isArray(obj)) {
                // Se ha chiavi HEX, è la classifica!
                if (Object.keys(obj).some(k => k.startsWith('#'))) return obj;
                if (obj.scores) return findScores(obj.scores);
                if (obj.finalScores) return findScores(obj.finalScores);
            }
            if (Array.isArray(obj)) {
                for (let item of obj) {
                    let res = findScores(item);
                    if (res) return res;
                }
            }
            return null;
        }

        const actualScores = findScores(payload) || {};

        // Filtra SOLO le chiavi che sono colori
        const sortedPlayers = Object.keys(actualScores)
            .filter(k => k.startsWith('#'))
            .sort((a, b) => actualScores[b] - actualScores[a]);

        let html = '<ul style="list-style:none; padding:0; margin: 20px 0;">';

        if (sortedPlayers.length === 0) {
            html += '<li style="text-align:center; font-weight:bold; color:#7f8c8d;">Nessun punteggio.</li>';
        } else {
            sortedPlayers.forEach((p, index) => {
                let medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👏';
                html += `
                    <li style="display:flex; align-items:center; justify-content:space-between; background:#ecf0f1; padding:10px 15px; border-radius:12px; margin-bottom:10px; border:3px solid #2C3E50; font-size: 20px; font-weight:bold;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span>${medal}</span>
                            <div style="width:25px; height:25px; min-width:25px; min-height:25px; border-radius:50%; background-color:${p}; border:2px solid #2C3E50; flex-shrink:0;"></div>
                            ${p === playerColor ? '<span>Tu</span>' : ''}
                        </div>
                        <span>${actualScores[p]} pt</span>
                    </li>
                `;
            });
        }

        html += '</ul>';
        finalStandingsDiv.innerHTML = html;
        gameEndModal.style.display = 'flex';
    }

    socket.on('gameState', (state) => {
        // Controllo se il gioco è finito
        if (state.status === 'finished' || state.state === 'finished' || state.isFinished) {
            showGameEnd(state);
            return;
        }

        timerText.textContent = state.timer;
        currentRoundText.textContent = state.round;
        totalRoundsText.textContent = state.totalRounds;

        const prevArtist = amIArtist;
        amIArtist = (state.currentTurn === playerColor);

        if (amIArtist) {
            hintText.textContent = state.currentWord || "Scegli...";
            hintText.classList.add('artist-view');
            canvas.style.cursor = "crosshair";
            chatInput.disabled = true;
            chatInput.placeholder = "Tu disegni!";
            artistControls.style.display = 'flex';

            if (!prevArtist) {
                artistNotification.innerHTML = "È il tuo turno!<br>Disegna!";
                artistNotification.style.display = 'block';
                setTimeout(() => artistNotification.style.display = 'none', 2500);
            }
        } else {
            hintText.textContent = state.hint;
            hintText.classList.remove('artist-view');
            canvas.style.cursor = "default";
            chatInput.disabled = false;
            chatInput.placeholder = "Indovina la parola...";
            artistControls.style.display = 'none';
        }

        updateStandings(state.players, state.scores, state.currentTurn);
        if (amIArtist && state.wordOptions && state.wordOptions.length > 0) showWordSelection(state.wordOptions);
    });

    socket.on('roundEnd', (data) => {
        revealedWordElement.textContent = data.word;
        roundEndModal.style.display = 'flex';
        setTimeout(() => roundEndModal.style.display = 'none', 4500);
    });

    socket.on('gameEnd', (data) => {
        showGameEnd(data);
    });

    if (backToLobbyBtn) {
        backToLobbyBtn.onclick = () => {
            window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(playerColor)}`;
        };
    }

    // --- AGGIORNAMENTO CLASSIFICA LATERALE (Durante la partita) ---
    function updateStandings(players, scores, artist) {
        standingBox.innerHTML = '';

        // Ordina i giocatori per punteggio e li disegna nella classifica live
        const sortedPlayers = [...players].sort((a, b) => (scores[b] || 0) - (scores[a] || 0));

        sortedPlayers.forEach((p, index) => {
            const li = document.createElement('li');
            li.className = `player-entry ${p === playerColor ? 'current-player' : ''}`;

            li.innerHTML = `
                <span style="font-size: 14px; width: 15px; color: #7f8c8d;">#${index + 1}</span>
                <div class="avatar-circle">
                    <div class="avatar-color" style="background-color:${p}"></div>
                </div>
                <div class="player-info">${p === playerColor ? 'Tu' : ''}</div>
                <div class="score-box">${scores[p] || 0}</div>
                ${p === artist ? '<div class="artist-icon" title="Sta disegnando">🖍️</div>' : ''}
            `;
            standingBox.appendChild(li);
        });
    }

    function showWordSelection(words) {
        const exist = document.querySelector('.word-selection-modal');
        if (exist) exist.remove();

        const modal = document.createElement('div');
        modal.className = 'word-selection-modal';
        modal.innerHTML = `
            <div class="word-selection-content">
                <h2 style="margin-top:0; font-size:28px; color:#2C3E50;">Scegli una parola</h2>
                <div class="word-list"></div>
            </div>`;

        const list = modal.querySelector('.word-list');
        words.forEach(w => {
            const btn = document.createElement('button');
            btn.className = 'word-option';
            btn.textContent = w;
            btn.onmousedown = (e) => {
                e.preventDefault();
                socket.emit('wordSelected', { lobbyId, word: w });
                modal.remove();
            };
            list.appendChild(btn);
        });
        document.body.appendChild(modal);
    }
});