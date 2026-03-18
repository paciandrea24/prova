// frontend/quiz.js

document.addEventListener('DOMContentLoaded', () => {
    console.log("🧠 Quiz Game Script (Gartic Style & English)");

    // 1. SETUP INIZIALE
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
    const timerText = document.getElementById('timer-text');
    const categoryText = document.getElementById('category-text');
    const currentRoundText = document.getElementById('current-round');
    const totalRoundsText = document.getElementById('total-rounds');

    const questionText = document.getElementById('question-text');
    const questionImage = document.getElementById('question-image');
    const optionsContainer = document.getElementById('options-container');

    const messagesBox = document.getElementById('messages-box');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');

    const standingBox = document.getElementById('players-ul');

    const gameEndModal = document.getElementById('game-end-modal');
    const backToLobbyBtn = document.getElementById('back-to-lobby');
    const correctSound = document.getElementById('correctSound');

    let hasAnswered = false;
    let previousScores = {};

    // 2. SOCKET IO
    const socket = io();
    socket.emit('joinLobby', { lobbyId: lobbyId, color: playerColor });
    socket.emit('joinGame', { lobbyId, gameId, playerColor, settings: gameSettings });
    socket.emit('requestGameState', { lobbyId });

    // 3. CHAT LOGIC (Per comunicare durante il quiz)
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;
        socket.emit('sendChatMessage', { lobbyId, playerColor, message: text });
        chatInput.value = '';
    });

    function addMessage(msg, type) {
        const div = document.createElement('div');
        div.className = `msg ${type}`;

        // Trasforma codice HEX in pallino visivo
        let formattedMsg = msg.replace(/#([0-9A-Fa-f]{6})/gi, (match) => {
            return `<span style="display:inline-block; width:16px; height:16px; min-width:16px; min-height:16px; flex-shrink:0; border-radius:50%; background-color:${match}; border:2px solid #2C3E50; vertical-align:-3px; margin:0 3px;"></span>`;
        });

        if (type === 'chat' && msg.includes(':')) {
            const idx = msg.indexOf(':');
            const color = msg.substring(0, idx).trim();
            const text = msg.substring(idx + 1).trim();

            div.innerHTML = `
                <div style="width:16px; height:16px; min-width:16px; min-height:16px; border-radius:50%; background:${color}; border:2px solid #2C3E50; flex-shrink:0; margin-top:2px;"></div> 
                <span style="word-break: break-word;">${text}</span>
            `;
        } else {
            if (type === 'success' || type === 'correct') {
                formattedMsg = `⭐ ${formattedMsg}`;
                if (correctSound) correctSound.play().catch(e => console.log(e));
            }
            div.innerHTML = formattedMsg;
        }

        messagesBox.appendChild(div);
        messagesBox.scrollTop = messagesBox.scrollHeight;
    }

    socket.on('message', (d) => addMessage(d.message, d.type));

    socket.on('receiveChatMessage', (data) => {
        const { playerColor, message } = data;
        addMessage(`${playerColor}: ${message}`, 'chat');
    });

    // 4. GAME LOGIC MAPPATA SUL BACKEND REALE

    socket.on('statusMessage', (data) => {
        questionText.textContent = data.message;
        optionsContainer.innerHTML = '';
        if (questionImage) questionImage.style.display = 'none';
    });

    socket.on('timerUpdate', (data) => {
        timerText.textContent = data.time;
    });

    socket.on('newQuestion', (data) => {
        timerText.textContent = data.time || 0;
        currentRoundText.textContent = data.round || 1;
        totalRoundsText.textContent = data.totalRounds || 10;

        categoryText.textContent = "GENERAL KNOWLEDGE";

        questionText.textContent = data.question;

        if (data.imageUrl && questionImage) {
            questionImage.src = data.imageUrl;
            questionImage.style.display = 'block';
        } else if (questionImage) {
            questionImage.style.display = 'none';
            questionImage.src = '';
        }

        renderOptions(data.options);
        hasAnswered = false;

        if (data.scores) {
            updateStandings(data.scores);
        }
    });

    socket.on('roundResult', (data) => {
        const buttons = document.querySelectorAll('.option-btn');
        buttons.forEach((btn, index) => {
            if (index === data.correctIndex) {
                btn.classList.add('correct');
            } else if (btn.classList.contains('selected')) {
                btn.classList.add('wrong');
            } else {
                btn.disabled = true;
                btn.style.opacity = '0.5';
            }
        });
        hasAnswered = true;
        if (data.scores) updateStandings(data.scores);
    });

    // Aggiungi questo in un punto globale del file (es. sotto le altre socket.on)
    socket.on('redirectAllToLobby', () => {
        window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(playerColor)}`;
    });

    socket.on('gameOver', (data) => {
        showGameEnd(data.scores, data.hostColor);
    });

    function renderOptions(options) {
        optionsContainer.innerHTML = '';
        if (!options) return;

        options.forEach((opt, index) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.textContent = opt;

            btn.onclick = () => {
                if (hasAnswered) return;
                hasAnswered = true;

                document.querySelectorAll('.option-btn').forEach(b => {
                    b.disabled = true;
                    if (b !== btn) b.style.opacity = '0.6';
                });
                btn.classList.add('selected');

                // Il backend si aspetta answerIndex e non la stringa
                socket.emit('triviaAnswer', { lobbyId, playerColor, answerIndex: index });
            };
            optionsContainer.appendChild(btn);
        });
    }

    // 5. CLASSIFICA LATERALE (SOLO COLORI)
    // 5. CLASSIFICA LATERALE (CON ANIMAZIONE PUNTI)
    function updateStandings(scores) {
        standingBox.innerHTML = '';
        if (!scores) return;

        const players = Object.keys(scores);
        const sortedPlayers = players.sort((a, b) => scores[b] - scores[a]);

        sortedPlayers.forEach((p, index) => {
            const li = document.createElement('li');
            li.className = `player-entry ${p === playerColor ? 'current-player' : ''}`;

            // Calcolo punti guadagnati per l'animazione
            const currentScore = scores[p] || 0;
            const oldScore = previousScores[p] || 0;
            const diff = currentScore - oldScore;
            let gainHtml = '';

            if (diff > 0) {
                gainHtml = `<span class="score-gain">+${diff}</span>`;
            }

            li.innerHTML = `
                <span style="font-size: 14px; width: 15px; color: #7f8c8d;">#${index + 1}</span>
                <div class="avatar-circle">
                    <div class="avatar-color" style="background-color:${p}"></div>
                </div>
                <div class="player-info">${p === playerColor ? 'You' : ''}</div>
                <div class="score-box" style="position:relative; display:flex; align-items:center;">
                    ${currentScore}
                    ${gainHtml}
                </div>
            `;
            standingBox.appendChild(li);
        });

        // Aggiorna lo stato precedente con i nuovi punteggi
        previousScores = { ...scores };
    }

    // 6. CLASSIFICA FINALE (SOLO COLORI)
    function showGameEnd(scores, hostColor) {
        const finalStandingsDiv = document.getElementById('final-standings');
        if (!scores) scores = {};

        const sortedPlayers = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);

        let html = '<ul style="list-style:none; padding:0; margin: 20px 0;">';
        if (sortedPlayers.length === 0) {
            html += '<li style="text-align:center; font-weight:bold; color:#7f8c8d;">No scores.</li>';
        } else {
            sortedPlayers.forEach((p, index) => {
                let medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👏';
                html += `
                    <li style="display:flex; align-items:center; justify-content:space-between; background:#ecf0f1; padding:10px 15px; border-radius:12px; margin-bottom:10px; border:3px solid #2C3E50; font-size: 20px; font-weight:bold;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span>${medal}</span>
                            <div style="width:25px; height:25px; min-width:25px; min-height:25px; border-radius:50%; background-color:${p}; border:2px solid #2C3E50; flex-shrink:0;"></div>
                            ${p === playerColor ? '<span>You</span>' : ''}
                        </div>
                        <span>${scores[p]} pt</span>
                    </li>
                `;
            });
        }
        html += '</ul>';
        finalStandingsDiv.innerHTML = html;
        // GESTIONE PULSANTE HOST
        if (backToLobbyBtn) {
            if (playerColor === hostColor) {
                backToLobbyBtn.style.display = 'block';
                backToLobbyBtn.textContent = 'Ritorna alla Lobby (Tutti)';
                backToLobbyBtn.onclick = () => {
                    socket.emit('forceReturnToLobby', lobbyId);
                };
            } else {
                backToLobbyBtn.style.display = 'none';

                // Opzionale: mostra un testo di attesa
                const waitMsg = document.createElement('p');
                waitMsg.style.color = '#7f8c8d';
                waitMsg.style.fontWeight = 'bold';
                waitMsg.textContent = 'In attesa che l\'host ritorni alla lobby...';
                finalStandingsDiv.appendChild(waitMsg);
            }
        }

        gameEndModal.style.display = 'flex';
    }

    if (backToLobbyBtn) {
        backToLobbyBtn.onclick = () => {
            window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(playerColor)}`;
        };
    }
});