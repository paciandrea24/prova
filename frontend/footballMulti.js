document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const playerColor = urlParams.get('color');

    if (!lobbyId || !playerColor) return window.location.href = '/';

    const socket = io();
    socket.emit('joinLobby', { lobbyId, color: playerColor });
    socket.emit('joinGame', { lobbyId, gameId: 'footballMulti', playerColor });

    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    const livesBoard = document.getElementById('lives-board');
    let isGameOver = false;
    const keys = { up: false, down: false, left: false, right: false, kick: false };

    window.addEventListener('keydown', (e) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.code)) e.preventDefault();
        if (!isGameOver) updateKeys(e.code, true);
    });
    window.addEventListener('keyup', (e) => { if (!isGameOver) updateKeys(e.code, false); });

    function updateKeys(code, isPressed) {
        let changed = false;
        if (code === 'KeyW' || code === 'ArrowUp') { keys.up = isPressed; changed = true; }
        if (code === 'KeyS' || code === 'ArrowDown') { keys.down = isPressed; changed = true; }
        if (code === 'KeyA' || code === 'ArrowLeft') { keys.left = isPressed; changed = true; }
        if (code === 'KeyD' || code === 'ArrowRight') { keys.right = isPressed; changed = true; }
        if (code === 'Space') { keys.kick = isPressed; changed = true; }
        if (changed) socket.emit('playerInput', keys);
    }

    socket.on('gameState', (state) => {
        updateLives(state.players);
        drawGame(state);
    });

    function updateLives(players) {
        livesBoard.innerHTML = '';
        for (let color in players) {
            const p = players[color];
            const pill = document.createElement('div');
            pill.className = `life-pill ${p.eliminated ? 'eliminated-text' : ''}`;
            pill.innerHTML = `<span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:${color}; margin-right:5px; border:1px solid #fff"></span> ${p.eliminated ? 'ELIMINATO' : p.lives}`;
            livesBoard.appendChild(pill);
        }
    }

    function drawGame(state) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (state.arena && state.arena.length >= 3) {
            // 1. Disegna il prato verde
            ctx.beginPath();
            ctx.moveTo(state.arena[0].x, state.arena[0].y);
            for (let i = 1; i < state.arena.length; i++) ctx.lineTo(state.arena[i].x, state.arena[i].y);
            ctx.closePath();
            ctx.fillStyle = '#1e5f33';
            ctx.fill();

            const wallRatio = 0.30; // Coerente col backend (30% muro, 40% porta, 30% muro)

            // 2. Disegna i Muri e le Porte
            for (let i = 0; i < state.arena.length; i++) {
                const p1 = state.arena[i];
                const p2 = state.arena[(i + 1) % state.arena.length];

                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;

                // Calcola dove inizia e finisce la porta
                const g1x = p1.x + dx * wallRatio;
                const g1y = p1.y + dy * wallRatio;
                const g2x = p1.x + dx * (1 - wallRatio);
                const g2y = p1.y + dy * (1 - wallRatio);

                // Muri Laterali (Grigio Cemento)
                ctx.lineWidth = 14;
                ctx.lineCap = 'square';
                ctx.strokeStyle = '#7f8c8d';

                ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(g1x, g1y); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(g2x, g2y); ctx.lineTo(p2.x, p2.y); ctx.stroke();

                // Porta Centrale
                ctx.beginPath();
                ctx.moveTo(g1x, g1y); ctx.lineTo(g2x, g2y);

                if (p1.eliminated) {
                    // Se il giocatore è morto, la porta diventa un muro
                    ctx.strokeStyle = '#7f8c8d';
                    ctx.stroke();
                } else {
                    // Sfondo nero porta
                    ctx.lineWidth = 14;
                    ctx.strokeStyle = '#000';
                    ctx.stroke();

                    // Linea colore del giocatore
                    ctx.lineWidth = 6;
                    ctx.strokeStyle = p1.ownerColor;
                    ctx.shadowBlur = 15;
                    ctx.shadowColor = p1.ownerColor;
                    ctx.stroke();
                    ctx.shadowBlur = 0; // reset ombre
                }

                // Pali della porta (Cerchi bianchi)
                if (!p1.eliminated) {
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = '#000';
                    ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.arc(g1x, g1y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                    ctx.beginPath(); ctx.arc(g2x, g2y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                }
            }
        }

        // 3. Giocatori
        for (let id in state.players) {
            const p = state.players[id];
            if (p.eliminated) continue;

            if (p.isKicking) {
                ctx.beginPath(); ctx.arc(p.x, p.y, p.radius + 6, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'; ctx.fill();
            }
            ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = p.color; ctx.fill();
            ctx.lineWidth = 3; ctx.strokeStyle = '#111'; ctx.stroke();
        }

        // 4. Palla
        const b = state.ball;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = '#111'; ctx.stroke();
    }

    socket.on('gameOver', (data) => {
        isGameOver = true;

        document.getElementById('btn-leave').style.display = 'none';

        const victoryPanel = document.getElementById('victory-panel');
        const winnerDot = document.getElementById('winner-color-dot');
        const winnerText = document.getElementById('winner-text');
        const btnVictoryLeave = document.getElementById('btn-victory-leave'); // <-- Prendiamo il bottone

        if (data.winner === 'Nessuno') {
            winnerDot.style.display = 'none';
            winnerText.innerText = 'Pareggio! Siete tutti eliminati.';
        } else {
            winnerDot.style.display = 'inline-block';
            winnerDot.style.backgroundColor = data.winner;
            winnerText.innerText = 'HA VINTO LA PARTITA!';
        }

        // GESTIONE PULSANTE HOST
        if (playerColor === data.hostColor) {
            btnVictoryLeave.style.display = 'inline-block';
            btnVictoryLeave.textContent = 'Ritorna alla Lobby (Tutti)';
            btnVictoryLeave.onclick = () => {
                socket.emit('forceReturnToLobby', lobbyId);
            };
        } else {
            btnVictoryLeave.style.display = 'none';
            if (!document.getElementById('waiting-host-text-multi')) {
                const waitMsg = document.createElement('p');
                waitMsg.id = 'waiting-host-text-multi';
                waitMsg.style.color = '#fff';
                waitMsg.style.fontWeight = 'bold';
                waitMsg.textContent = 'In attesa che l\'host ritorni alla lobby...';
                victoryPanel.appendChild(waitMsg);
            }
        }

        victoryPanel.style.display = 'flex';
    });

    socket.on('redirectAllToLobby', () => {
        window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(playerColor)}`;
    });

    // Funzione per tornare alla lobby (collegata a entrambi i bottoni)
    const goBackToLobby = () => {
        window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(playerColor)}`;
    };

    document.getElementById('btn-leave').onclick = goBackToLobby;
    document.getElementById('btn-victory-leave').onclick = goBackToLobby;
});