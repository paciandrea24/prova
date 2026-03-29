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

// Join Game
socket.emit('joinGame', { lobbyId, gameId: 'deduction', playerColor: myColor });

// Setup Iniziale e Overlay
socket.on('initData', (data) => {
    isImpostor = data.isImpostor;
    currentRoom = data.room;
    myX = data.x;
    myY = data.y;
    phase = data.phase; // <-- Legge la fase dal server

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
// Quando qualcuno vince
socket.on('gameOver', (data) => {
    phase = 'gameOver';
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

    // Mostra il pulsante SOLO se io sono l'Host
    if (myColor === data.hostColor) {
        subtitle.innerText = "Sei l'Host. Puoi terminare la partita.";
        btn.classList.remove('hidden');
        btn.onclick = () => {
            socket.emit('forceReturnToLobby', lobbyId);
        };
    } else {
        subtitle.innerText = "In attesa che l'Host torni alla lobby...";
    }
});

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
});
window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;
});

// Loop Locale (60 FPS reali)
function gameLoop() {
    if (!isDead && phase === 'exploration') {
        let moved = false;
        const speed = 5;
        if (keys.w) { myY -= speed; myFacing = 'up'; moved = true; }
        if (keys.s) { myY += speed; myFacing = 'down'; moved = true; }
        if (keys.a) { myX -= speed; myFacing = 'left'; moved = true; }
        if (keys.d) { myX += speed; myFacing = 'right'; moved = true; }

        if (moved) {
            // Invia al server, ma senza aspettare la risposta per muoversi a schermo
            socket.emit('playerMove', { lobbyId, playerColor: myColor, x: myX, y: myY, facing: myFacing });
        }
    }

    render();
    requestAnimationFrame(gameLoop);
}

function drawCharacter(pX, pY, color, facing, isCorpse) {
    ctx.fillStyle = isCorpse ? '#7f8c8d' : color;

    if (isCorpse) {
        ctx.fillRect(pX - 25, pY - 10, 50, 20); // Cadavere
    } else {
        ctx.fillRect(pX - 15, pY - 20, 30, 40); // In piedi

        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        if (facing === 'up') ctx.fillRect(pX - 10, pY - 20, 20, 10);
        if (facing === 'down') ctx.fillRect(pX - 10, pY - 10, 20, 10);
        if (facing === 'left') ctx.fillRect(pX - 15, pY - 15, 10, 15);
        if (facing === 'right') ctx.fillRect(pX + 5, pY - 15, 10, 15);
    }
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Disegna porte fittizie
    ctx.fillStyle = '#2C3E50';
    ctx.fillRect(canvas.width / 2 - 40, 0, 80, 20);
    ctx.fillRect(canvas.width / 2 - 40, canvas.height - 20, 80, 20);
    ctx.fillRect(0, canvas.height / 2 - 40, 20, 80);
    ctx.fillRect(canvas.width - 20, canvas.height / 2 - 40, 20, 80);

    // 1. DISEGNA GLI ALTRI (Dai dati del Server)
    Object.values(players).forEach(p => {
        // Ignoro me stesso dalla lista del server per evitare lo "sdoppiamento/tremolio"
        if (p.color !== myColor) {
            drawCharacter(p.x, p.y, p.color, p.facing, p.isDead);
        }
    });

    // 2. DISEGNA ME STESSO (In tempo reale e fluido)
    if (isDead) {
        drawCharacter(myX, myY, myColor, myFacing, true);

        ctx.fillStyle = 'rgba(231, 76, 60, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 60px Fredoka';
        ctx.textAlign = 'center';
        ctx.fillText('SEI MORTO', canvas.width / 2, canvas.height / 2);
    } else {
        drawCharacter(myX, myY, myColor, myFacing, false);
    }
}