document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const playerColor = urlParams.get('color');
    const gameId = urlParams.get('game');

    if (!lobbyId || !playerColor) {
        window.location.href = '/';
        return;
    }

    const socket = io();
    socket.emit('joinLobby', lobbyId);
    socket.emit('joinGame', { lobbyId, gameId, playerColor });

    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    const scoreboardEl = document.getElementById('scoreboard');
    const gameWrapper = document.querySelector('.panel');

    const setupPanel = document.getElementById('setup-panel');
    const gameUI = document.getElementById('game-ui');
    const btnConfirmSetup = document.getElementById('btn-confirm-setup');
    const spectatorBadge = document.getElementById('spectator-badge');
    const btnLeave = document.getElementById('btn-leave');

    const keys = { up: false, down: false, left: false, right: false, kick: false };
    let isGameOver = false;

    // GESTIONE SETUP PRE-PARTITA
    socket.on('setupState', (data) => {
        setupPanel.style.display = 'flex';
        gameUI.style.display = 'none';
        btnLeave.style.display = 'block';

        const { players, host } = data;

        document.getElementById('slot-left').className = 'slot empty';
        document.getElementById('slot-left').innerHTML = 'Click to join'; // TRADOTTO
        document.getElementById('slot-left').style.backgroundColor = '#fff';

        document.getElementById('slot-right').className = 'slot empty';
        document.getElementById('slot-right').innerHTML = 'Click to join'; // TRADOTTO
        document.getElementById('slot-right').style.backgroundColor = '#fff';

        document.getElementById('slot-spectators').innerHTML = '';

        let hasLeft = false; let hasRight = false;

        for (let color in players) {
            const team = players[color].team;
            if (team === 'left') {
                document.getElementById('slot-left').className = 'slot filled';
                document.getElementById('slot-left').style.backgroundColor = color;
                hasLeft = true;
            } else if (team === 'right') {
                document.getElementById('slot-right').className = 'slot filled';
                document.getElementById('slot-right').style.backgroundColor = color;
                hasRight = true;
            } else {
                const dot = document.createElement('div');
                dot.className = 'spectator-dot';
                dot.style.backgroundColor = color;
                document.getElementById('slot-spectators').appendChild(dot);
            }
        }

        if (playerColor === host) {
            btnConfirmSetup.style.display = 'block';
            btnConfirmSetup.disabled = !(hasLeft && hasRight);
            btnConfirmSetup.style.opacity = (hasLeft && hasRight) ? '1' : '0.5';
        }
    });

    socket.on('matchStarted', () => {
        setupPanel.style.display = 'none';
        gameUI.style.display = 'flex';
        btnLeave.style.display = 'none';
    });

    document.getElementById('slot-left').onclick = () => socket.emit('switchTeam', 'left');
    document.getElementById('slot-right').onclick = () => socket.emit('switchTeam', 'right');
    document.getElementById('btn-join-spectators').onclick = () => socket.emit('switchTeam', 'spectator');
    btnConfirmSetup.onclick = () => socket.emit('confirmSetup');

    // INPUT TASTIERA
    window.addEventListener('keydown', (e) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.code)) e.preventDefault();
        if (!isGameOver) updateKeys(e.code, true);
    });

    window.addEventListener('keyup', (e) => {
        if (!isGameOver) updateKeys(e.code, false);
    });

    function updateKeys(code, isPressed) {
        let changed = false;
        if (code === 'KeyW' || code === 'ArrowUp') { keys.up = isPressed; changed = true; }
        if (code === 'KeyS' || code === 'ArrowDown') { keys.down = isPressed; changed = true; }
        if (code === 'KeyA' || code === 'ArrowLeft') { keys.left = isPressed; changed = true; }
        if (code === 'KeyD' || code === 'ArrowRight') { keys.right = isPressed; changed = true; }
        if (code === 'Space') { keys.kick = isPressed; changed = true; }

        if (changed) {
            socket.emit('playerInput', keys);
        }
    }

    // AGGIORNAMENTO STATO
    socket.on('gameState', (state) => {
        setupPanel.style.display = 'none';
        gameUI.style.display = 'flex';
        btnLeave.style.display = 'none';

        updateScoreboard(state.score, state.players);
        drawGame(state);

        if (state.players[playerColor] && state.players[playerColor].team === 'spectator') {
            spectatorBadge.style.display = 'inline-block';
        } else {
            spectatorBadge.style.display = 'none';
        }
    });

    socket.on('gameOver', (data) => {
        isGameOver = true;
        for (let key in keys) keys[key] = false;
        showGameOverPanel(data.winner, data.finalScore);
    });

    socket.on('gameRestarted', () => {
        isGameOver = false;
        hideGameOverPanel();
    });

    let lastScoreState = "";
    function updateScoreboard(scores, players) {
        const scoreStr = JSON.stringify(scores);
        if (scoreStr === lastScoreState) return;
        lastScoreState = scoreStr;

        scoreboardEl.innerHTML = '';
        for (let color in scores) {
            if (players && players[color] && players[color].team !== 'spectator') {
                const pill = document.createElement('div');
                pill.className = 'score-pill';
                pill.innerHTML = `<div class="score-color" style="background-color: ${color};"></div> <span>${scores[color]}</span>`;
                scoreboardEl.appendChild(pill);
            }
        }
    }

    function drawGame(state) {
        ctx.fillStyle = '#2ecc71';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = 'white';
        ctx.lineWidth = 4;

        ctx.beginPath(); ctx.moveTo(400, 0); ctx.lineTo(400, 400); ctx.stroke();
        ctx.beginPath(); ctx.arc(400, 200, 60, 0, Math.PI * 2); ctx.stroke();

        ctx.fillStyle = 'rgba(44, 62, 80, 0.3)';
        ctx.fillRect(0, 130, 40, 140);
        ctx.fillRect(760, 130, 40, 140);

        for (let id in state.players) {
            const p = state.players[id];
            if (p.team === 'spectator') continue;

            if (p.isKicking) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius + 6, 0, Math.PI * 2);
                ctx.fillStyle = 'white';
                ctx.fill();
            }

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#2C3E50';
            ctx.stroke();
        }

        const b = state.ball;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'white';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#2C3E50';
        ctx.stroke();
    }

    // TRADUZIONE DEL PANNELLO DI FINE PARTITA
    function showGameOverPanel(winnerColor, finalScores) {
        const panel = document.createElement('div');
        panel.id = 'game-over-panel';
        panel.className = 'game-over-panel';

        let scoreHtml = '<div class="final-score">';
        for (let color in finalScores) {
            scoreHtml += `<div class="score-pill"><div class="score-color" style="background-color: ${color};"></div> <span>${finalScores[color]}</span></div>`;
        }
        scoreHtml += '</div>';

        panel.innerHTML = `
            <div class="go-content">
                <span class="go-icon">🏆</span>
                <h2 class="go-title">MATCH OVER!</h2>
                <p style="font-size: 18px; font-weight: bold; margin: 5px 0;">The winner is:</p>
                <div class="winner-display">
                    <div class="winner-color" style="background-color: ${winnerColor};"></div>
                </div>
                ${scoreHtml}
                <div class="go-buttons">
                    <button id="btn-restart" class="btn-primary">Play Again</button>
                    <button id="btn-lobby" class="btn-secondary">Back to Lobby</button>
                </div>
            </div>
        `;

        gameWrapper.appendChild(panel);

        document.getElementById('btn-restart').onclick = () => {
            socket.emit('restartGameRequest', { lobbyId });
        };
        document.getElementById('btn-lobby').onclick = () => {
            window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(playerColor)}`;
        };
    }

    function hideGameOverPanel() {
        const panel = document.getElementById('game-over-panel');
        if (panel) panel.remove();
    }

    document.getElementById('btn-leave').onclick = () => {
        window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(playerColor)}`;
    };
});