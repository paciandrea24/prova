const urlParams = new URLSearchParams(window.location.search);
const lobbyId = urlParams.get('lobby');
const myColor = urlParams.get('color');

const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let players = {};
let isImpostor = false;
let currentRoom = 'Centro';
let myX = 400, myY = 300, myFacing = 'down';
let isDead = false;
let gameStarted = false; // Ferma il rendering finché non siamo posizionati
let phase = 'starting';

let myTasks = [];
let activeTaskInRange = null;
let globalTotalTasks = 1;
let globalCompletedTasks = 0;

let corpseInRange = false;
let meetingInterval = null;
let iHaveVoted = false;

// --- GESTIONE SPRITESHEET E ANIMAZIONI ---
const baseSprite = new Image();
baseSprite.onload = () => console.log("✅ baseSprite caricato correttamente! (Larghezza:", baseSprite.naturalWidth, ")");
baseSprite.onerror = () => console.error("❌ ERRORE: Impossibile trovare spritesheet_base.png");
baseSprite.src = 'assets/spritesheet_base.png';

const detailsSprite = new Image();
detailsSprite.onload = () => console.log("✅ detailsSprite caricato correttamente! (Larghezza:", detailsSprite.naturalWidth, ")");
detailsSprite.onerror = () => console.error("❌ ERRORE: Impossibile trovare spritesheet_details.png");
detailsSprite.src = 'assets/spritesheet_details.png';

const tintedSprites = {};

function getTintedSprite(color) {
    if (tintedSprites[color]) return tintedSprites[color];

    // Aspettiamo che ENTRAMBE le immagini siano caricate
    if (!baseSprite.complete || baseSprite.naturalWidth === 0 ||
        !detailsSprite.complete || detailsSprite.naturalWidth === 0) {
        return null;
    }

    const offCanvas = document.createElement('canvas');
    offCanvas.width = baseSprite.naturalWidth;
    offCanvas.height = baseSprite.naturalHeight;
    const offCtx = offCanvas.getContext('2d');

    // 1. Riempiamo il canvas con il colore scelto
    offCtx.fillStyle = color;
    offCtx.fillRect(0, 0, offCanvas.width, offCanvas.height);

    // 2. Moltiplichiamo il colore per la base (per dare le ombre)
    offCtx.globalCompositeOperation = 'multiply';
    offCtx.drawImage(baseSprite, 0, 0);

    // 3. Ritagliamo il colore in eccesso usando la forma della base
    offCtx.globalCompositeOperation = 'destination-in';
    offCtx.drawImage(baseSprite, 0, 0);

    // 4. MAGIA: Disegniamo i dettagli (linee nere, occhi bianchi) SOPRA il corpo colorato!
    offCtx.globalCompositeOperation = 'source-over';
    offCtx.drawImage(detailsSprite, 0, 0);

    // Salviamo in memoria
    tintedSprites[color] = offCanvas;
    return offCanvas;
}

// Dimensioni
const spriteWidth = 16;
const spriteHeight = 32;
const spriteScale = 3.5;

const directionRows = { 'down': 0, 'up': 3, 'left': 2, 'right': 1 };

let currentFrame = 0;
let animationTimer = 0;
const animationSpeed = 8;
const totalFrames = 4;
const lastPositions = {};

// Join Game
socket.emit('joinLobby', { lobbyId: lobbyId, color: myColor });
socket.emit('joinGame', { lobbyId, gameId: 'deduction', playerColor: myColor });

// Setup Iniziale e Overlay
socket.on('initData', (data) => {
    isImpostor = data.isImpostor;
    currentRoom = data.room;
    myX = data.x;
    myY = data.y;
    phase = data.phase; // <-- Legge la fase dal server
    myTasks = data.tasks || []; // <-- Prendi le task

    updateTasksUI();

    document.getElementById('room-display').innerText = currentRoom;
    const roleDisp = document.getElementById('role-display');

    // GESTIONE OVERLAY SPLASH SCREEN
    const overlay = document.getElementById('role-reveal-overlay');
    const title = document.getElementById('reveal-title');
    const subtitle = document.getElementById('reveal-subtitle');

    if (isImpostor) {
        roleDisp.innerText = 'IMPOSTORE (Premi Q per uccidere)';
        roleDisp.className = 'impostor-text';
        title.innerText = 'IMPOSTORE';
        title.className = 'role-title impostor-red';
        subtitle.innerText = 'Uccidi l\'equipaggio senza farti scoprire';
    } else {
        roleDisp.innerText = 'CREWMATE';
        roleDisp.className = 'crewmate-text';
        title.innerText = 'MEMBRO DELL\'EQUIPAGGIO';
        title.className = 'role-title crewmate-blue';
        subtitle.innerText = 'Completa le task e scopri chi è l\'impostore';
    }

    // CONTROLLO ANTI-LAG: Se mi sono connesso in ritardo e la partita è già in 'exploration',
    // nascondo subito l'overlay. Altrimenti lo mostro e aspetto l'evento dal server.
    if (phase === 'exploration') {
        overlay.classList.add('hidden');
    } else {
        overlay.classList.remove('hidden');
    }

    if (!gameStarted) {
        gameStarted = true;
        requestAnimationFrame(gameLoop);
    }
});

// Quando il server dice che i 5 secondi di splash screen sono finiti
socket.on('explorationStarted', () => {
    document.getElementById('role-reveal-overlay').classList.add('hidden');
    phase = 'exploration';
});


// Quando qualcuno vince
socket.on('gameOver', (data) => {
    phase = 'gameOver';

    // FIX: Nascondiamo forzatamente le schermate del meeting/espulsione
    // altrimenti coprono il bottone di fine partita!
    document.getElementById('meeting-overlay').classList.add('hidden');
    document.getElementById('ejection-overlay').classList.add('hidden');

    const overlay = document.getElementById('game-over-overlay');
    const title = document.getElementById('winner-title');
    const subtitle = document.getElementById('game-over-subtitle');
    const btn = document.getElementById('return-lobby-btn');

    overlay.classList.remove('hidden');

    if (data.winner === 'impostors') {
        title.innerText = 'VITTORIA IMPOSTORI';
        title.className = 'role-title impostor-red';
    } else {
        title.innerText = 'VITTORIA EQUIPAGGIO';
        title.className = 'role-title crewmate-blue';
    }

    const cleanMyColor = decodeURIComponent(String(myColor)).trim();
    const cleanHostColor = data.hostColor ? String(data.hostColor).trim() : 'SCONOSCIUTO';

    // Controlliamo l'uguaglianza
    if (cleanMyColor === cleanHostColor) {
        subtitle.innerText = "Sei l'Host. Puoi terminare la partita.";
        btn.classList.remove('hidden');
        btn.style.display = 'block'; // Forza la visibilità

        btn.onclick = () => {
            socket.emit('forceReturnToLobby', lobbyId);
        };
    } else {
        subtitle.innerText = "In attesa che l'Host torni alla lobby...";
        btn.classList.add('hidden');
        btn.style.display = 'none';
    }
});

socket.on('explorationStarted', (data) => {
    document.getElementById('role-reveal-overlay').classList.add('hidden');
    phase = 'exploration';

    // Mostra e setta la barra del progresso
    document.getElementById('progress-container').style.display = 'block';
    if (data) updateProgressBar(data.completedTasks, data.totalTasks);
});

socket.on('globalTaskProgress', (data) => {
    updateProgressBar(data.completedTasks, data.totalTasks);
});

socket.on('taskCompleted', (taskId) => {
    const t = myTasks.find(t => t.id === taskId);
    if (t) t.completed = true;
    updateTasksUI();
});

function updateProgressBar(completed, total) {
    const bar = document.getElementById('progress-bar');
    const percentage = total > 0 ? (completed / total) * 100 : 0;
    bar.style.width = `${percentage}%`;
}

function updateTasksUI() {
    if (isImpostor) return;
    const list = document.getElementById('tasks-list');
    list.innerHTML = '<strong>Le tue Task:</strong><br>';
    myTasks.forEach(t => {
        if (t.completed) {
            list.innerHTML += `<span style="color: #2ecc71; text-decoration: line-through;">- ${t.name} (${t.room})</span><br>`;
        } else {
            list.innerHTML += `<span style="color: white;">- ${t.name} (${t.room})</span><br>`;
        }
    });
}

// Aggiungi questo in fondo al file per ascoltare il segnale di chiusura del server
socket.on('redirectAllToLobby', () => {
    window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(myColor)}`;
});

// Aggiornamento Mappa (RICEVE GLI ALTRI, NON SE STESSO)
socket.on('gameState', (serverPlayers) => {
    players = serverPlayers;

    // Aggiorna solo lo stato di morte locale
    if (players[myColor] && players[myColor].isDead) {
        isDead = true;
    }
});

// Cambio Stanza (Porte)
socket.on('roomTransition', (data) => {
    currentRoom = data.newRoom;
    myX = data.x;
    myY = data.y;
    document.getElementById('room-display').innerText = currentRoom;
});

// Controlli
const keys = { w: false, a: false, s: false, d: false };
window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = true;

    if (key === 'q' && isImpostor && !isDead) {
        socket.emit('attemptKill', { lobbyId, playerColor: myColor });
    }

    if (key === 'e' && !isImpostor && !isDead && activeTaskInRange) {
        socket.emit('attemptTask', { lobbyId, playerColor: myColor, taskId: activeTaskInRange });
    }

    if (key === 'r' && !isDead && corpseInRange && phase === 'exploration') {
        socket.emit('reportCorpse', { lobbyId, playerColor: myColor });
    }
});
window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;
});

// Loop Locale (60 FPS reali)
// Loop Locale (60 FPS reali)
function gameLoop() {
    let amIMoving = false; // Controlla se mi sto muovendo
    const speed = 5;

    if (!isDead && phase === 'exploration') {
        if (keys.w) { myY -= speed; myFacing = 'up'; amIMoving = true; }
        if (keys.s) { myY += speed; myFacing = 'down'; amIMoving = true; }
        if (keys.a) { myX -= speed; myFacing = 'left'; amIMoving = true; }
        if (keys.d) { myX += speed; myFacing = 'right'; amIMoving = true; }

        if (amIMoving) {
            socket.emit('playerMove', { lobbyId, playerColor: myColor, x: myX, y: myY, facing: myFacing });
        }
    }

    // Gestione del timer dell'animazione (Gira sempre in background per tutti)
    animationTimer++;
    if (animationTimer >= animationSpeed) {
        currentFrame = (currentFrame + 1) % totalFrames;
        animationTimer = 0;
    }

    // Passiamo la variabile al render!
    render(amIMoving);
    requestAnimationFrame(gameLoop);
}

function drawCharacter(pX, pY, color, facing, isCorpse, isMoving = false) {
    // Ottieni lo spritesheet ricolorato per questo specifico giocatore
    const activeSprite = getTintedSprite(color);

    // FALLBACK SICURO: Se l'immagine non c'è ancora o ha fallito il ricoloramento
    if (!activeSprite) {
        ctx.fillStyle = isCorpse ? '#7f8c8d' : color;
        if (isCorpse) {
            ctx.fillRect(pX - 25, pY - 10, 50, 20);
        } else {
            ctx.fillRect(pX - 15, pY - 20, 30, 40);
        }
        ctx.fillStyle = 'white';
        ctx.font = 'bold 14px Fredoka';
        ctx.textAlign = 'center';
        ctx.fillText(color.toUpperCase(), pX, pY - 25);
        return;
    }

    const drawWidth = spriteWidth * spriteScale;
    const drawHeight = spriteHeight * spriteScale;

    try {
        if (isCorpse) {
            ctx.save();
            ctx.translate(pX, pY);
            ctx.rotate(Math.PI / 2);
            ctx.drawImage(
                activeSprite, // <-- Usiamo lo sprite ricolorato
                0, 0, spriteWidth, spriteHeight,
                -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight
            );
            ctx.restore();

            // Macchia di sangue
            ctx.fillStyle = '#c0392b'; // Rosso sangue fisso
            ctx.beginPath();
            ctx.arc(pX, pY - (drawHeight / 2) + 5, 8, 0, Math.PI * 2);
            ctx.fill();
        } else {
            let frameX = 0;
            let frameY = (directionRows[facing] || 0) * spriteHeight;

            if (isMoving) {
                frameX = currentFrame * spriteWidth;
            }

            // ANTI-CRASH
            if (frameX + spriteWidth > activeSprite.width) frameX = 0;
            if (frameY + spriteHeight > activeSprite.height) frameY = 0;

            ctx.drawImage(
                activeSprite, // <-- Usiamo lo sprite ricolorato
                frameX, frameY, spriteWidth, spriteHeight,
                pX - drawWidth / 2, pY - drawHeight / 2, drawWidth, drawHeight
            );

            // Disegna il nome sopra la testa
            ctx.fillStyle = color;
            ctx.font = 'bold 14px Fredoka';
            ctx.textAlign = 'center';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 3;
            ctx.strokeText(color.toUpperCase(), pX, pY - (drawHeight / 2) - 5);
            ctx.fillText(color.toUpperCase(), pX, pY - (drawHeight / 2) - 5);
        }
    } catch (e) {
        console.error("Errore nel disegno dello sprite:", e);
        ctx.fillStyle = color;
        ctx.fillRect(pX - 15, pY - 20, 30, 40);
    }
}

function render(isMoving = false) { // ECCO IL PARAMETRO MANCANTE!
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Disegna porte fittizie
    ctx.fillStyle = '#2C3E50';
    ctx.fillRect(canvas.width / 2 - 40, 0, 80, 20);
    ctx.fillRect(canvas.width / 2 - 40, canvas.height - 20, 80, 20);
    ctx.fillRect(0, canvas.height / 2 - 40, 20, 80);
    ctx.fillRect(canvas.width - 20, canvas.height / 2 - 40, 20, 80);

    // DISEGNA LE TASK DELLA STANZA E CALCOLA DISTANZA
    activeTaskInRange = null;
    corpseInRange = false;
    let hintText = "";
    let hintVisible = false;

    if (!isImpostor && !isDead) {
        myTasks.forEach(t => {
            if (t.room === currentRoom && !t.completed) {
                // Disegna il punto di interazione
                ctx.beginPath();
                ctx.arc(t.x, t.y, 25, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(241, 196, 15, 0.4)';
                ctx.fill();
                ctx.lineWidth = 3;
                ctx.strokeStyle = '#f1c40f';
                ctx.stroke();

                // Disegna icona generica (Punto esclamativo)
                ctx.fillStyle = 'white';
                ctx.font = 'bold 20px Fredoka';
                ctx.textAlign = 'center';
                ctx.fillText('!', t.x, t.y + 7);

                const dx = myX - t.x;
                const dy = myY - t.y;
                if (Math.sqrt(dx * dx + dy * dy) < 60) {
                    activeTaskInRange = t.id;
                    hintText = "Premi E per fare la Task";
                    hintVisible = true;
                }
            }
        });
    }

    // Rilevamento Cadaveri
    if (!isDead) {
        Object.values(players).forEach(p => {
            if (p.isDead && p.color !== myColor) {
                const dx = myX - p.x;
                const dy = myY - p.y;
                if (Math.sqrt(dx * dx + dy * dy) < 80) {
                    corpseInRange = true;
                    hintText = "Premi R per Reportare il corpo";
                    hintVisible = true;
                }
            }
        });
    }

    const hintEl = document.getElementById('interaction-hint');
    if (hintVisible) {
        hintEl.innerText = hintText;
        hintEl.classList.remove('hidden');
    } else {
        hintEl.classList.add('hidden');
    }

    // 1. DISEGNA GLI ALTRI (Dai dati del Server)
    Object.values(players).forEach(p => {
        if (p.color !== myColor) {
            let remoteMoving = false;

            // Logica per fluidificare l'animazione di chi lagga
            if (!lastPositions[p.color]) {
                lastPositions[p.color] = { x: p.x, y: p.y, movingTimer: 0 };
            } else {
                if (lastPositions[p.color].x !== p.x || lastPositions[p.color].y !== p.y) {
                    lastPositions[p.color].movingTimer = 10;
                }
            }

            if (lastPositions[p.color].movingTimer > 0) {
                remoteMoving = true;
                lastPositions[p.color].movingTimer--;
            }

            lastPositions[p.color].x = p.x;
            lastPositions[p.color].y = p.y;

            drawCharacter(p.x, p.y, p.color, p.facing, p.isDead, remoteMoving);
        }
    });

    // 2. DISEGNA ME STESSO (In tempo reale e fluido)
    if (isDead) {
        drawCharacter(myX, myY, myColor, myFacing, true, false);

        ctx.fillStyle = 'rgba(231, 76, 60, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 60px Fredoka';
        ctx.textAlign = 'center';
        ctx.fillText('SEI MORTO', canvas.width / 2, canvas.height / 2);
    } else {
        // Qui isMoving funziona perché l'abbiamo ricevuto dal gameLoop!
        drawCharacter(myX, myY, myColor, myFacing, false, isMoving);
    }
}

// --- LOGICA CHAT MEETING ---
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatMessages = document.getElementById('chat-messages');

function sendChatMessage() {
    const msg = chatInput.value.trim();
    if (msg !== '' && !isDead) {
        socket.emit('sendMeetingChat', { lobbyId, playerColor: myColor, message: msg });
        chatInput.value = '';
    }
}

chatSendBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

socket.on('receiveMeetingChat', (data) => {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg';
    msgDiv.innerHTML = `<strong style="color: ${data.playerColor};">${data.playerColor}:</strong> <span style="color: white;">${data.message}</span>`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-scroll in basso
});

// --- LOGICA MEETING E VOTAZIONE ---

socket.on('meetingStarted', (data) => {
    phase = 'meeting';
    iHaveVoted = false;
    document.getElementById('meeting-overlay').classList.remove('hidden');
    document.getElementById('interaction-hint').classList.add('hidden');
    document.getElementById('my-vote-status').innerText = "";

    // Pulisci la chat del meeting precedente
    chatMessages.innerHTML = '';
    if (isDead) {
        chatInput.disabled = true;
        chatInput.placeholder = "I morti non parlano...";
        chatSendBtn.disabled = true;
    } else {
        chatInput.disabled = false;
        chatInput.placeholder = "Discuti con l'equipaggio...";
        chatSendBtn.disabled = false;
    }

    // Timer
    let timeLeft = data.duration;
    document.getElementById('meeting-timer').innerText = `Tempo rimasto: ${timeLeft}s`;
    if (meetingInterval) clearInterval(meetingInterval);
    meetingInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft >= 0) {
            document.getElementById('meeting-timer').innerText = `Tempo rimasto: ${timeLeft}s`;
        }
    }, 1000);

    // Popola i bottoni (Identico a prima)
    const grid = document.getElementById('voting-grid');
    grid.innerHTML = '';

    data.players.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'vote-btn';
        btn.id = `vote-btn-${p.color}`;

        const colorBox = `<div class="player-color-box" style="background-color: ${p.color}"></div>`;
        const nameText = `<span>${p.color} ${p.color === myColor ? '(Tu)' : ''}</span>`;
        const statusBadge = `<span class="voted-badge hidden" id="badge-${p.color}">Ha Votato</span>`;

        btn.innerHTML = `${colorBox} ${nameText} ${statusBadge}`;

        if (p.isDead) {
            btn.disabled = true;
            btn.style.opacity = '0.3';
            btn.innerHTML += ' 💀';
        } else {
            btn.onclick = () => castVote(p.color);
        }

        grid.appendChild(btn);
    });

    const skipBtn = document.getElementById('skip-vote-btn');
    skipBtn.disabled = isDead;
    skipBtn.onclick = () => castVote('skip');
});

function castVote(targetColor) {
    if (isDead || iHaveVoted) return;
    iHaveVoted = true;

    socket.emit('submitVote', { lobbyId, voterColor: myColor, targetColor });
    document.getElementById('my-vote-status').innerText = `Hai votato per: ${targetColor}`;

    // Disabilita tutti i bottoni per me
    document.querySelectorAll('.vote-btn').forEach(b => b.disabled = true);
}

socket.on('playerVoted', (voterColor) => {
    // Mostra il badge "Ha votato" su chi ha espresso il voto
    const badge = document.getElementById(`badge-${voterColor}`);
    if (badge) badge.classList.remove('hidden');
});

// IL FIX DELLA MORTE È QUI
socket.on('meetingEnded', (data) => {
    if (meetingInterval) clearInterval(meetingInterval);
    document.getElementById('meeting-overlay').classList.add('hidden');

    const ejectionOverlay = document.getElementById('ejection-overlay');
    const ejectionText = document.getElementById('ejection-text');

    ejectionText.innerText = data.message;
    ejectionOverlay.classList.remove('hidden');

    // FIX: Se il server mi dice che il colore espulso è il mio, io muoio sul client ORA.
    if (data.ejectedColor === myColor) {
        isDead = true;
    }
});

socket.on('resumeExploration', () => {
    phase = 'exploration';
    document.getElementById('ejection-overlay').classList.add('hidden');
});