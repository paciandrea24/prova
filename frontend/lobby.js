// frontend/lobby.js

document.addEventListener('DOMContentLoaded', () => {
    // 1. Inizializzazione Base
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const selectedColor = urlParams.get('color');

    if (!lobbyId || !selectedColor) {
        window.location.href = '/';
        return;
    }

    let currentSelectedGame = null;
    let isSetup = false; // <--- FLAG PER EVITARE CHE IL MENU SI RESETTI OGNI 3 SECONDI

    let gameSettings = {
        drawing: { rounds: 3, time: 60, difficulty: 'medium' },
        trivia: { questions: 10, time: 30, category: 'general' },
        racing: { mode: 'championship', numTracks: 3, trackName: 'Monza' },
        football: { maxGoals: 3 }
    };

    // 2. Interfaccia Header (ID e Copia)
    const lobbyIdValue = document.getElementById('lobby-id-value');
    const lobbyIdLabel = document.getElementById('lobby-id-label');
    const lobbyIdContainer = document.getElementById('lobby-id-container');

    if (lobbyIdValue) lobbyIdValue.textContent = lobbyId;

    if (lobbyIdContainer) {
        lobbyIdContainer.addEventListener('click', () => {
            navigator.clipboard.writeText(lobbyId).then(() => {
                const originalLabel = lobbyIdLabel.textContent;
                lobbyIdLabel.textContent = "Copied! ✅";
                setTimeout(() => { lobbyIdLabel.textContent = originalLabel; }, 1500);
            });
        });
    }

    // 3. Setup Socket.io
    const socket = io();
    socket.emit('joinLobby', lobbyId);

    socket.on('gameSelected', (data) => {
        const { gameId, settings } = data;
        const settingsParam = settings ? `&settings=${encodeURIComponent(JSON.stringify(settings))}` : '';

        let targetPage = '/game.html';
        if (gameId === 'trivia') targetPage = '/quiz.html';
        else if (gameId === 'racing') targetPage = '/racing.html';
        else if (gameId === 'bomb') targetPage = '/bomb.html';
        else if (gameId === 'football') targetPage = '/football.html';

        window.location.href = `${targetPage}?lobby=${lobbyId}&color=${encodeURIComponent(selectedColor)}&game=${gameId}${settingsParam}`;
    });

    // 4. Caricamento Dati Lobby
    loadLobby();
    setInterval(loadLobby, 3000); // Aggiorna solo i giocatori, non la UI dei giochi

    async function loadLobby() {
        try {
            const response = await fetch(`/api/lobby/${lobbyId}`);
            if (!response.ok) throw new Error('Lobby not found');
            const lobby = await response.json();

            updatePlayerList(lobby.players, selectedColor, lobby.host);

            // ESEGUE IL SETUP DEI GIOCHI SOLO AL PRIMO CARICAMENTO
            if (!isSetup) {
                if (selectedColor === lobby.host && !document.querySelector('#invite-btn')) {
                    addInviteButton();
                }
                setupGameSelectors(lobby.host);
                isSetup = true;
            }

        } catch (error) {
            console.error('Error loading lobby:', error);
            showToast('Error loading lobby. Redirecting home...', 'error');
            setTimeout(() => window.location.href = '/', 2000);
        }
    }

    // 5. Generazione Interfaccia Giocatori
    function updatePlayerList(players, currentPlayerColor, hostColor) {
        const playersList = document.getElementById('players-list');
        if (!playersList) return;

        playersList.innerHTML = '';

        const createPlayerRow = (pColor, isMe) => {
            const row = document.createElement('div');
            row.className = 'player-row';

            if (isMe) row.style.background = '#fff8b0';

            const avatar = document.createElement('div');
            avatar.className = 'avatar';
            avatar.style.backgroundColor = pColor;

            const name = document.createElement('span');
            name.className = 'p-name';
            name.textContent = isMe ? 'You' : '';

            row.appendChild(avatar);
            row.appendChild(name);

            if (pColor === hostColor) {
                const hostTag = document.createElement('span');
                hostTag.className = 'p-host';
                hostTag.textContent = 'HOST';
                row.appendChild(hostTag);
            }

            if (currentPlayerColor === hostColor && !isMe) {
                const kickBtn = document.createElement('button');
                kickBtn.className = 'btn small';
                kickBtn.textContent = 'Kick';
                kickBtn.style.position = 'absolute';
                kickBtn.style.right = '10px';

                kickBtn.addEventListener('click', () => {
                    if (confirm('Are you sure you want to kick this player?')) {
                        socket.emit('kickPlayer', { lobbyId, hostColor: currentPlayerColor, targetColor: pColor });
                    }
                });
                row.appendChild(kickBtn);
            }

            return row;
        };

        playersList.appendChild(createPlayerRow(currentPlayerColor, true));
        players.forEach(playerColor => {
            if (playerColor !== currentPlayerColor) {
                playersList.appendChild(createPlayerRow(playerColor, false));
            }
        });
    }

    function addInviteButton() {
        const leftBox = document.querySelector('.column-left');
        if (document.querySelector('#invite-btn')) return;

        const inviteBtn = document.createElement('button');
        inviteBtn.id = 'invite-btn';
        inviteBtn.className = 'btn';
        inviteBtn.textContent = 'Invite Players';
        inviteBtn.style.marginTop = 'auto';

        inviteBtn.addEventListener('click', async () => {
            try {
                const response = await fetch(`/api/invite/${lobbyId}`);
                const data = await response.json();
                navigator.clipboard.writeText(data.inviteLink);
                inviteBtn.textContent = "Link Copied!";
                setTimeout(() => inviteBtn.textContent = 'Invite Players', 2000);
            } catch (error) {
                showToast('Error generating link', 'error');
            }
        });
        leftBox.appendChild(inviteBtn);
    }

    // 6. Selezione Minigiochi e Settings
    function setupGameSelectors(hostColor) {
        const gameCards = document.querySelectorAll('.game-card');
        const startGameBtn = document.getElementById('start-game-btn');
        const waitingMsg = document.getElementById('waiting-host-msg');

        // SE NON SEI L'HOST
        if (selectedColor !== hostColor) {
            gameCards.forEach(card => card.classList.add('disabled'));
            if (waitingMsg) waitingMsg.style.display = 'block'; // Mostra scritta attesa
            return;
        }

        // SE SEI L'HOST
        if (waitingMsg) waitingMsg.style.display = 'none';

        gameCards.forEach(card => {
            card.classList.remove('disabled');

            card.addEventListener('click', (e) => {
                if (e.target.closest('#leaderboard-mini-btn')) return;

                const gameId = card.dataset.gameId;
                showGameSettings(gameId); // Apre semplicemente il modale
            });
        });

        // Evento chiusura Modale Settings
        const closeSettingsBtn = document.getElementById('close-settings-btn');
        if (closeSettingsBtn) {
            closeSettingsBtn.addEventListener('click', () => {
                document.getElementById('settings-modal').style.display = 'none';
                currentSelectedGame = null;
            });
        }

        document.querySelectorAll('.settings-section select').forEach(select => {
            select.addEventListener('change', () => {
                if (currentSelectedGame) saveGameSettings(currentSelectedGame);
            });
        });

        if (startGameBtn) {
            startGameBtn.addEventListener('click', () => {
                if (!currentSelectedGame) return;
                const settings = saveGameSettings(currentSelectedGame);
                document.getElementById('settings-modal').style.display = 'none'; // Chiude il modale all'avvio
                socket.emit('startGame', { lobbyId, gameId: currentSelectedGame, settings });
            });
        }
    }

    function showGameSettings(gameId) {
        currentSelectedGame = gameId;
        const modal = document.getElementById('settings-modal');
        const modalTitle = document.getElementById('settings-modal-title');

        // Aggiorna il titolo del modale in base al gioco
        const titles = {
            drawing: '✏️ Drawing Settings',
            trivia: '🧠 Quiz Settings',
            racing: '🏎️ Racing Settings',
            bomb: '💣 Bomb Settings',
            football: '⚽ Football Settings'
        };
        if (modalTitle) modalTitle.textContent = titles[gameId] || '⚙️ Settings';

        // Mostra il modale
        if (modal) modal.style.display = 'flex';

        // Mostra solo le impostazioni del gioco scelto
        document.querySelectorAll('.settings-section').forEach(s => s.style.display = 'none');
        const targetSection = document.getElementById(`${gameId}-settings`);
        if (targetSection) targetSection.style.display = 'block';

        loadGameSettings(gameId);
    }

    function loadGameSettings(gameId) {
        const settings = gameSettings[gameId];
        if (!settings) return;
        Object.keys(settings).forEach(key => {
            const element = document.getElementById(`${gameId}-${key}`);
            if (element) element.value = settings[key];
        });
    }

    function saveGameSettings(gameId) {
        const settings = {};
        const section = document.getElementById(`${gameId}-settings`);
        if (!section) return settings;

        section.querySelectorAll('select').forEach(select => {
            const key = select.id.replace(`${gameId}-`, '');
            settings[key] = select.value;
        });
        gameSettings[gameId] = { ...gameSettings[gameId], ...settings };
        return settings;
    }

    const racingModeSelect = document.getElementById('racing-mode');
    if (racingModeSelect) {
        racingModeSelect.addEventListener('change', (e) => {
            document.getElementById('group-numTracks').style.display = e.target.value === 'single' ? 'none' : 'flex';
            document.getElementById('group-trackSelect').style.display = e.target.value === 'single' ? 'flex' : 'none';
        });
    }

    // 7. Chat System
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    const chatMessages = document.getElementById('chat-messages');

    function sendChat() {
        const text = chatInput.value.trim();
        if (text && lobbyId && selectedColor) {
            socket.emit('sendChatMessage', { lobbyId, playerColor: selectedColor, message: text });
            chatInput.value = '';
            chatInput.focus();
        }
    }

    if (sendChatBtn) sendChatBtn.addEventListener('click', sendChat);
    if (chatInput) chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });

    socket.on('receiveChatMessage', (data) => {
        const { playerColor, message, timestamp } = data;
        const isMe = (playerColor === selectedColor);

        const msgDiv = document.createElement('div');
        msgDiv.className = isMe ? 'msg-wrap me' : 'msg-wrap';

        let avatarHtml = isMe ? '' : `<div class="avatar" style="background: ${playerColor}; width: 28px; height: 28px; flex-shrink:0;"></div>`;

        msgDiv.innerHTML = `
            ${avatarHtml}
            <div style="display:flex; flex-direction:column; max-width:100%;">
                <div class="msg-bubble">${message}</div>
                <div class="chat-time" style="text-align:${isMe ? 'right' : 'left'};">${timestamp}</div>
            </div>
        `;

        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    socket.on('playerKicked', (kickedColor) => {
        if (selectedColor === kickedColor) {
            alert('You have been kicked from the lobby.');
            window.location.href = '/';
        } else {
            loadLobby();
        }
    });

    // 8. Toast Helper
    function showToast(message, type = 'info') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        let icon = type === 'error' ? '⚠️' : (type === 'success' ? '✅' : 'ℹ️');
        toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s forwards';
            toast.addEventListener('animationend', () => toast.remove());
        }, 3000);
    }
});

// --- LEADERBOARD GLOBALE ---
document.addEventListener('click', async (e) => {
    if (e.target && e.target.closest('#leaderboard-mini-btn')) {
        e.preventDefault();
        e.stopPropagation();

        const modal = document.getElementById('global-leaderboard-modal');
        const content = document.getElementById('leaderboard-content');
        if (!modal) return;

        modal.style.display = 'flex';
        content.innerHTML = '<p style="text-align:center;">Fetching records...</p>';

        try {
            const res = await fetch('/api/leaderboard');
            const data = await res.json();
            content.innerHTML = '';

            if (Object.keys(data).length === 0) {
                content.innerHTML = '<p style="text-align:center; color:#7f8c8d; font-weight:bold;">No records yet. Hit the track!</p>';
                return;
            }

            for (const [trackName, records] of Object.entries(data)) {
                let html = `<div style="margin-bottom: 20px; background: #ecf0f1; border: 3px solid #2C3E50; padding: 15px; border-radius: 12px; box-shadow: 2px 2px 0px #2C3E50;">`;
                html += `<h3 style="color: #3498DB; margin-top: 0; border-bottom: 3px dashed #bdc3c7; padding-bottom: 10px; margin-bottom: 10px;">📍 ${trackName}</h3>`;

                if (records.length === 0) {
                    html += `<p style="color: #7f8c8d; font-weight: bold;">No times recorded.</p>`;
                } else {
                    html += `<ul style="list-style: none; padding: 0; margin: 0;">`;
                    records.forEach((rec, index) => {
                        const mins = Math.floor(rec.time / 60000);
                        const secs = Math.floor((rec.time % 60000) / 1000);
                        const ms = rec.time % 1000;
                        const timeStr = `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;

                        let color = '#2C3E50';
                        if (index === 0) color = '#f1c40f'; // Gold
                        if (index === 1) color = '#95a5a6'; // Silver
                        if (index === 2) color = '#cd6133'; // Bronze

                        html += `
                                <li style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 2px solid #bdc3c7; font-size: 18px;">
                                    <span style="display: flex; align-items: center;">
                                        <strong style="color: ${color}; width: 30px; font-size: 20px; text-shadow: 1px 1px 0px rgba(0,0,0,0.1);">${index + 1}°</strong> 
                                        <div style="width:20px; height:20px; border-radius:50%; background-color:${rec.color}; margin-right:10px; border:2px solid #2C3E50;"></div>
                                        <strong style="color: #2C3E50;">${rec.name || 'Racer'}</strong>
                                    </span>
                                    <span style="font-family: monospace; font-weight: bold; background: #2C3E50; color: white; padding: 4px 8px; border-radius: 8px;">${timeStr}</span>
                                </li>`;
                    });
                    html += `</ul>`;
                }
                html += `</div>`;
                content.innerHTML += html;
            }
        } catch (err) {
            content.innerHTML = '<p style="color: #E74C3C; text-align:center; font-weight: bold;">Server connection error.</p>';
        }
    }
});

const closeBtn = document.getElementById('close-leaderboard-btn');
if (closeBtn) {
    closeBtn.addEventListener('click', () => {
        document.getElementById('global-leaderboard-modal').style.display = 'none';
    });
}