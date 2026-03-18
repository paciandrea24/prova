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

    socket.emit('joinLobby', { lobbyId: lobbyId, color: playerColor });
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

    // 1. Funzione per stampare i messaggi nel box
    function addMessage(text, type = 'chat') {
        const msgDiv = document.createElement('div');
        msgDiv.style.padding = "8px 10px";
        msgDiv.style.borderBottom = "1px solid #ecf0f1";
        msgDiv.style.wordBreak = "break-word";
        // Usiamo Flexbox per allineare perfettamente il pallino e il testo
        msgDiv.style.display = "flex";
        msgDiv.style.alignItems = "center";
        msgDiv.style.gap = "8px";
        msgDiv.style.fontSize = "15px";

        let colorStyle = '#2C3E50';
        let fontWeight = '500';

        // Imposta i colori in base al tipo di messaggio
        if (type === 'success') {
            colorStyle = '#27ae60';
            fontWeight = 'bold';
        } else if (type === 'error') {
            colorStyle = '#e74c3c';
            fontWeight = 'bold';
        } else if (type === 'system') {
            colorStyle = '#2980b9';
            msgDiv.style.fontStyle = 'italic';
        } else if (type === 'info') {
            colorStyle = '#f39c12';
        }

        // Cerca un colore HEX all'inizio del messaggio (es. "#E74C3C")
        const hexRegex = /^(#[0-9A-Fa-f]{6})/i;
        const match = text.match(hexRegex);

        if (match) {
            const colorHex = match[1];
            let remainingText = text.replace(colorHex, '').replace(/^:\s*/, '').trim();

            // Crea il pallino con l'ombra cartoon netta
            msgDiv.innerHTML = `
                <div style="
                    width: 20px; 
                    height: 20px; 
                    min-width: 20px;
                    border-radius: 50%; 
                    background-color: ${colorHex}; 
                    border: 2px solid #2C3E50; 
                    box-shadow: 2px 2px 0px #2C3E50; /* <--- MODIFICATO QUI */
                    flex-shrink: 0;
                "></div>
                <span style="color: ${colorStyle}; font-weight: ${fontWeight};">${remainingText}</span>
            `;
        } else {
            // Messaggio normale senza utente (es. messaggi di sistema puri)
            const span = document.createElement('span');
            span.style.color = colorStyle;
            span.style.fontWeight = fontWeight;
            span.textContent = text;
            msgDiv.appendChild(span);
        }

        messagesBox.appendChild(msgDiv);

        // Auto-scroll verso il basso
        messagesBox.scrollTop = messagesBox.scrollHeight;
    }

    // 2. Ascolto dell'evento 'message' dal backend
    socket.on('message', (data) => {
        addMessage(data.message, data.type);
    });


    // --- FUNZIONE ROBUSTA PER LA CLASSIFICA FINALE ---
    function showGameEnd(payload, hostColor) {
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
                            <div style="width:25px; height:25px; min-width:25px; min-height:25px; border-radius:50%; background-color:${p}; border:3px solid #2C3E50; box-shadow: 3px 3px 0px #2C3E50; flex-shrink:0;"></div> ${p === playerColor ? '<span>Tu</span>' : ''}
                        </div>
                        <span>${actualScores[p]} pt</span>
                    </li>
                `;
            });
        }

        html += '</ul>';
        finalStandingsDiv.innerHTML = html;
        if (backToLobbyBtn) {
            // Se sei l'host, vedi il pulsante
            if (playerColor === hostColor) {
                backToLobbyBtn.style.display = 'block';
                backToLobbyBtn.textContent = 'Ritorna alla Lobby (Tutti)';
                backToLobbyBtn.onclick = () => {
                    socket.emit('forceReturnToLobby', lobbyId);
                };
            } else {
                // Se NON sei l'host, il pulsante sparisce e vedi un messaggio
                backToLobbyBtn.style.display = 'none';

                // Crea il testo di attesa solo se non esiste già
                if (!document.getElementById('waiting-host-text')) {
                    const waitMsg = document.createElement('p');
                    waitMsg.id = 'waiting-host-text';
                    waitMsg.style.color = '#7f8c8d';
                    waitMsg.style.fontWeight = 'bold';
                    waitMsg.style.textAlign = 'center';
                    waitMsg.textContent = 'In attesa che l\'host ritorni alla lobby...';
                    finalStandingsDiv.appendChild(waitMsg);
                }
            }
        }

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
        showGameEnd(data, data.hostColor); // Passiamo l'hostColor
    });

    // Aggiungi questo listener in game.js
    socket.on('redirectAllToLobby', () => {
        window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(playerColor)}`;
    });

    if (backToLobbyBtn) {
        backToLobbyBtn.onclick = () => {
            // Ora emettiamo l'evento al server invece di reindirizzare solo noi stessi
            socket.emit('forceReturnToLobby', lobbyId);
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