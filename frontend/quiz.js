/* // frontend/quiz.js
const socket = io();

// Avvolgiamo tutto in questo evento per assicurarci che l'HTML sia caricato
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Caricato. Inizializzazione Quiz...");

    // =========================================================
    // 1. RECUPERA DATI DALL'URL & ELEMENTI DOM
    // =========================================================
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const playerColor = urlParams.get('color');
    const gameId = urlParams.get('game') || 'trivia';

    // Riferimenti DOM (Ora siamo sicuri che esistano!)
    const questionImage = document.getElementById('question-image');
    const questionText = document.getElementById('question-text');
    const answerBtns = document.querySelectorAll('.answer-btn');
    const timerFill = document.getElementById('timer-fill');
    const scoreList = document.getElementById('score-list');
    const roundInfo = document.getElementById('round-info');
    const statusMsg = document.getElementById('status-message');

    // Elementi Game Over e Host
    const gameOverScreen = document.getElementById('game-over-screen');
    const finalPodium = document.getElementById('final-podium');
    const hostControls = document.getElementById('host-controls');
    const waitingHostMsg = document.getElementById('waiting-host-msg');
    const btnPlayAgain = document.getElementById('btn-play-again');
    const btnBackLobby = document.getElementById('btn-back-lobby');

    // Audio
    const soundCorrect = document.getElementById('sound-correct');
    const soundWrong = document.getElementById('sound-wrong');

    // =========================================================
    // 2. LOGICA SOCKET.IO
    // =========================================================

    socket.on('connect', () => {
        console.log('✅ Connesso al Server Socket:', socket.id);

        if (!lobbyId || !playerColor) {
            alert("Errore: Parametri mancanti nell'URL");
            return;
        }

        socket.emit('joinGame', {
            lobbyId,
            gameId,
            playerColor
        });
    });

    // Messaggio di stato
    socket.on('statusMessage', (data) => {
        statusMsg.textContent = data.message;
    });

    // --- ARRIVO NUOVA DOMANDA ---
    socket.on('newQuestion', (data) => {
        console.log('📩 Nuova domanda:', data);
        const { question, options, round, totalRounds, time, scores, imageUrl } = data;

        resetButtons();
        statusMsg.textContent = 'Scegli la risposta!';
        statusMsg.style.color = ""; // Reset colore
        questionText.textContent = question;
        roundInfo.textContent = `Round ${round}/${totalRounds}`;

        // GESTIONE IMMAGINE (Safe check)
        if (questionImage) {
            if (imageUrl) {
                questionImage.src = imageUrl;
                questionImage.style.display = 'block';
            } else {
                questionImage.style.display = 'none';
                questionImage.src = '';
            }
        }

        if (scores) updateScoreboard(scores);

        // Aggiorna Testo Bottoni
        answerBtns.forEach((btn, index) => {
            btn.textContent = options[index];
            btn.disabled = false;
            // Rimuovi vecchie classi risultato
            btn.classList.remove('correct', 'wrong', 'selected-wrong');

            // Imposta click listener (usiamo una funzione anonima per passare l'indice)
            btn.onclick = () => sendAnswer(index);
        });

        // ANIMAZIONE TIMER (Safe check)
        if (timerFill) {
            timerFill.style.transition = 'none';
            timerFill.style.width = '100%';
            void timerFill.offsetWidth; // Force reflow
            timerFill.style.transition = `width ${time}s linear`;
            timerFill.style.width = '0%';
        }
    });

    // --- RISULTATO ROUND ---
    socket.on('roundResult', (data) => {
        console.log('📩 Risultati:', data);
        const { correctIndex, scores, playerAnswers } = data;
        const myAnswer = playerAnswers[playerColor];

        // Disabilita e colora i bottoni
        answerBtns.forEach((btn, index) => {
            btn.disabled = true;
            btn.onclick = null; // Rimuovi listener per sicurezza

            if (index === correctIndex) {
                btn.classList.add('correct');
            } else if (index === myAnswer && index !== correctIndex) {
                btn.classList.add('selected-wrong');
            } else {
                btn.classList.add('wrong');
            }
        });

        // Feedback Utente & Audio
        if (myAnswer === correctIndex) {
            statusMsg.textContent = "Risposta Corretta!";
            statusMsg.style.color = "#2ecc71";
            if (soundCorrect) { soundCorrect.currentTime = 0; soundCorrect.play().catch(() => { }); }
        } else {
            statusMsg.textContent = (myAnswer !== undefined) ? "Sbagliato..." : "Tempo scaduto! ⏰";
            statusMsg.style.color = "#e74c3c";
            if (soundWrong) { soundWrong.currentTime = 0; soundWrong.play().catch(() => { }); }
        }

        updateScoreboard(scores);

        // Ferma timer
        if (timerFill) {
            timerFill.style.transition = 'none';
            timerFill.style.width = '100%'; // O 0%, a scelta
        }
    });

    // --- GAME OVER ---
    socket.on('gameOver', (data) => {
        const { scores, hostColor } = data;

        // Blur sfondo
        const container = document.querySelector('.game-container');
        if (container) container.classList.add('blur-background');

        gameOverScreen.style.display = 'flex';
        finalPodium.innerHTML = '';

        const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);

        sorted.forEach(([pColor, score], index) => {
            const div = document.createElement('div');
            div.className = `final-rank-item ${index === 0 ? 'winner' : ''}`;

            let medal = '';
            if (index === 0) medal = '🥇';
            if (index === 1) medal = '🥈';
            if (index === 2) medal = '🥉';

            div.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="rank-position">${index + 1}° ${medal}</span>
                    <div class="score-avatar-circle">
                        <div class="score-avatar-color" style="background-color: ${pColor}"></div>
                    </div>
                    ${pColor === playerColor ? '<span style="opacity:0.8;">(Tu)</span>' : ''}
                </div>
                <div style="font-weight: bold;">${score} pt</div>
            `;
            finalPodium.appendChild(div);
        });

        if (playerColor === hostColor) {
            hostControls.style.display = 'flex';
            waitingHostMsg.style.display = 'none';
        } else {
            hostControls.style.display = 'none';
            waitingHostMsg.style.display = 'block';
        }
    });

    socket.on('returnToLobbySignal', () => {
        window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(playerColor)}`;
    });

    socket.on('gameRestarted', () => {
        gameOverScreen.style.display = 'none';
        statusMsg.textContent = "Nuova partita in arrivo...";

        const container = document.querySelector('.game-container');
        if (container) container.classList.remove('blur-background');

        updateScoreboard({});

        // Reset bottoni host
        btnPlayAgain.textContent = "🔄 Gioca di Nuovo";
        btnPlayAgain.disabled = false;
    });

    // =========================================================
    // 3. FUNZIONI HELPER
    // =========================================================

    function sendAnswer(index) {
        // Disabilita subito per evitare doppi click
        answerBtns.forEach(btn => btn.disabled = true);
        statusMsg.textContent = "Risposta inviata...";
        socket.emit('triviaAnswer', { lobbyId, playerColor, answerIndex: index });
    }

    function resetButtons() {
        answerBtns.forEach(btn => {
            btn.className = 'answer-btn';
            btn.disabled = true;
        });
    }

    let previousScores = {};

    function updateScoreboard(scores) {
        if (!scoreList) return;
        scoreList.innerHTML = '';

        Object.entries(scores)
            .sort(([, a], [, b]) => b - a)
            .forEach(([pColor, score]) => {
                const li = document.createElement('li');
                li.setAttribute('data-color', pColor);

                // Logica Punti Fluttuanti
                const oldScore = previousScores[pColor] || 0;
                const diff = score - oldScore;

                if (diff > 0) {
                    const floatSpan = document.createElement('span');
                    floatSpan.className = 'score-float';
                    floatSpan.textContent = `+${diff}`;
                    li.appendChild(floatSpan);
                }

                // Avatar
                const avatarCircle = document.createElement('div');
                avatarCircle.className = 'score-avatar-circle';
                const avatarColorDiv = document.createElement('div');
                avatarColorDiv.className = 'score-avatar-color';
                avatarColorDiv.style.backgroundColor = pColor;
                avatarCircle.appendChild(avatarColorDiv);

                // Testo Punteggio
                const scoreText = document.createElement('span');
                scoreText.textContent = `${score} pt`;

                if (pColor === playerColor) {
                    li.classList.add('current-player');
                    scoreText.textContent += " (Tu)";
                }

                li.appendChild(avatarCircle);
                li.appendChild(scoreText);
                scoreList.appendChild(li);
            });

        previousScores = { ...scores };
    }

    // LISTENER BOTTONI HOST
    if (btnPlayAgain) {
        btnPlayAgain.addEventListener('click', () => {
            btnPlayAgain.textContent = "Caricamento...";
            btnPlayAgain.disabled = true;
            socket.emit('playAgain', { lobbyId, settings: {} });
        });
    }

    if (btnBackLobby) {
        btnBackLobby.addEventListener('click', () => {
            socket.emit('backToLobby', { lobbyId });
        });
    }

    // FEEDBACK LIVE (Pallini avversari)
    socket.on('playerAnswered', (data) => {
        const { playerColor: colorWhoAnswered } = data;
        const playerItem = document.querySelector(`li[data-color="${colorWhoAnswered}"]`);
        if (playerItem) {
            playerItem.classList.add('has-answered');
        }
    });

    // GESTIONE TEMA
    const themeBtn = document.getElementById('theme-toggle-btn');
    const body = document.body;
    const savedTheme = localStorage.getItem('quiz-theme');

    if (savedTheme === 'dark') {
        body.classList.add('theme-dark');
        if (themeBtn) themeBtn.innerHTML = '☀️ Stile Light';
    } else {
        if (themeBtn) themeBtn.innerHTML = '🌘 Stile Dark';
    }

    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            body.classList.toggle('theme-dark');
            if (body.classList.contains('theme-dark')) {
                themeBtn.innerHTML = '☀️ Stile Light';
                localStorage.setItem('quiz-theme', 'dark');
            } else {
                themeBtn.innerHTML = '🌘 Stile Dark';
                localStorage.setItem('quiz-theme', 'light');
            }
        });
    }
}); */


// frontend/quiz.js

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
    socket.emit('joinLobby', lobbyId);
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

    socket.on('gameOver', (data) => {
        showGameEnd(data.scores);
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
    function showGameEnd(scores) {
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
        gameEndModal.style.display = 'flex';
    }

    if (backToLobbyBtn) {
        backToLobbyBtn.onclick = () => {
            window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(playerColor)}`;
        };
    }
});