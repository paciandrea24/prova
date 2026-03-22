// frontend/bomb.js

document.addEventListener('DOMContentLoaded', () => {
    console.log("💣 Bomb Game Script Caricato");

    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const playerColor = urlParams.get('color');
    const gameId = urlParams.get('game');

    if (!lobbyId || !playerColor) {
        window.location.href = '/';
        return;
    }

    // Elementi DOM
    const playersUl = document.getElementById('players-ul');
    const timerText = document.getElementById('timer-text');
    const syllableDisplay = document.getElementById('syllable-display');
    const bombContainer = document.getElementById('bomb-container');
    const turnIndicator = document.getElementById('turn-indicator');
    const wordsHistory = document.getElementById('words-history');
    const wordInput = document.getElementById('word-input');
    const gameEndModal = document.getElementById('game-end-modal');
    const finalWinnerDiv = document.getElementById('final-winner');
    const backToLobbyBtn = document.getElementById('back-to-lobby');
    const bombArea = document.querySelector('.bomb-area');

    // Suoni (Opzionali, puoi aggiungerli nella cartella sounds)
    // const correctSound = new Audio('./sounds/correct.mp3');
    // const explodeSound = new Audio('./sounds/explode.mp3');

    let amIActive = false;
    let currentSyllable = '';
    let localTimerValue = 0;
    let timerInterval = null;

    // Socket Setup
    const socket = io();
    socket.emit('joinLobby', { lobbyId: lobbyId, color: playerColor });
    socket.emit('joinGame', { lobbyId, gameId, playerColor });

    // --- RICEZIONE STATO DI GIOCO ---
    socket.on('gameState', (state) => {
        updatePlayersList(state.players, state.activePlayers, state.lives, state.currentTurn, state.maxLives);

        currentSyllable = state.syllable || '?';
        syllableDisplay.textContent = currentSyllable;

        bombContainer.classList.remove('exploded');

        if (state.isActive) {
            bombContainer.classList.add('active');
            startLocalTimer(state.timer);
        } else {
            bombContainer.classList.remove('active');
            clearInterval(timerInterval);
        }

        // Gestione Turno
        amIActive = (state.currentTurn === playerColor && state.isActive);
        if (amIActive) {
            turnIndicator.style.display = 'block';
            wordInput.disabled = false;
            wordInput.focus();
            bombArea.classList.add('my-turn');
        } else {
            turnIndicator.style.display = 'none';
            wordInput.disabled = true;
            wordInput.value = '';
            wordInput.placeholder = "Aspetta il tuo turno...";
            bombArea.classList.remove('my-turn');
        }
    });

    // --- GESTIONE INPUT ---
    wordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const word = wordInput.value.trim().toUpperCase();
            if (word && amIActive) {
                socket.emit('guessWord', { lobbyId, playerColor, word });
                wordInput.value = '';
            }
        }
    });

    // --- EVENTI GIOCO ---
    socket.on('wordAccepted', (data) => {
        // correctSound.play().catch(e => {}); // Suono opzionale

        // Crea la tag per la parola indovinata
        const tag = document.createElement('div');
        tag.className = 'word-tag';

        // Evidenzia la sillaba nella parola
        const regex = new RegExp(`(${currentSyllable})`, 'i');
        const highlightedWord = data.word.replace(regex, '<span class="match">$1</span>');

        tag.innerHTML = `
            <div class="avatar-circle" style="width: 15px; height: 15px; min-width: 15px; background-color: ${data.playerColor};"></div>
            <span>${highlightedWord}</span>
        `;

        wordsHistory.appendChild(tag);
        wordsHistory.scrollTop = wordsHistory.scrollHeight; // Auto-scroll
    });

    socket.on('wrongWord', (data) => {
        wordInput.classList.add('shake');
        wordInput.value = '';
        wordInput.placeholder = data.message;
        setTimeout(() => {
            wordInput.classList.remove('shake');
            wordInput.placeholder = "Scrivi in fretta!";
        }, 500);
    });

    socket.on('bombExploded', (data) => {
        // explodeSound.play().catch(e => {}); // Suono opzionale
        clearInterval(timerInterval);

        timerText.textContent = "BOOM! 💥"; // Modificato da "00.0s"
        bombContainer.style.removeProperty('--shake-speed'); // Pulisce la variabile

        bombContainer.classList.remove('active');
        bombContainer.classList.add('exploded');
        wordInput.disabled = true;
        turnIndicator.style.display = 'none';
    });

    // ASCOLTATORE RIENTRO FORZATO
    socket.on('redirectAllToLobby', () => {
        window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(playerColor)}`;
    });

    // Cerca socket.on('gameEnd', ...) e sostituiscilo TUTTO con questo:
    socket.on('gameEnd', (data) => {
        const ranking = data.ranking;
        const hostColor = data.hostColor; // <-- Riceviamo l'host
        const podiumContainer = document.getElementById('podium-container');
        podiumContainer.innerHTML = '';

        const createSpot = (pColor, position) => {
            if (!pColor) return '';

            let className = `podium-${position}`;
            let isMe = pColor === playerColor ? '<div class="podium-me-badge">TU</div>' : '';

            return `
                <div class="podium-spot ${className}">
                    ${isMe}
                    <div class="avatar-circle" style="background-color: ${pColor};"></div>
                    <div class="podium-rank">${position}</div>
                </div>
            `;
        };

        let html = '';
        if (ranking[1]) html += createSpot(ranking[1], 2);
        if (ranking[0]) html += createSpot(ranking[0], 1);
        if (ranking[2]) html += createSpot(ranking[2], 3);

        podiumContainer.innerHTML = html;

        // --- GESTIONE PULSANTE HOST ---
        if (backToLobbyBtn) {
            if (playerColor === hostColor) {
                backToLobbyBtn.style.display = 'block';
                backToLobbyBtn.textContent = 'Ritorna alla Lobby (Tutti)';
                backToLobbyBtn.onclick = () => {
                    socket.emit('forceReturnToLobby', lobbyId);
                };
            } else {
                backToLobbyBtn.style.display = 'none';
                if (!document.getElementById('waiting-host-text')) {
                    const waitMsg = document.createElement('p');
                    waitMsg.id = 'waiting-host-text';
                    waitMsg.style.color = '#7f8c8d';
                    waitMsg.style.fontWeight = 'bold';
                    waitMsg.style.textAlign = 'center';
                    waitMsg.textContent = 'In attesa che l\'host ritorni alla lobby...';
                    podiumContainer.parentElement.appendChild(waitMsg);
                }
            }
        }

        gameEndModal.style.display = 'flex';
    });

    // --- FUNZIONI DI SUPPORTO ---

    function startLocalTimer(seconds) {
        clearInterval(timerInterval);
        localTimerValue = seconds;
        const turnMaxTime = seconds > 0 ? seconds : 1; // Evita divisioni per zero

        // Imposta il testo fisso
        timerText.textContent = "Tic Tac...";
        bombContainer.style.setProperty('--shake-speed', '0.5s');

        timerInterval = setInterval(() => {
            localTimerValue -= 0.1;
            if (localTimerValue <= 0) {
                localTimerValue = 0;
                clearInterval(timerInterval);
            }

            // Calcola il rapporto di tempo rimanente (da 1 a 0)
            let ratio = localTimerValue / turnMaxTime;
            if (ratio < 0) ratio = 0;

            // Il tremolio va da 0.5s (inizio) a 0.05s (iper-veloce prima dello scoppio)
            let currentSpeed = 0.05 + (ratio * 0.45);
            bombContainer.style.setProperty('--shake-speed', `${currentSpeed.toFixed(3)}s`);

        }, 100);
    }

    // Aggiunto maxLives ai parametri con valore di default a 3
    function updatePlayersList(players, activePlayers, lives, currentTurn, maxLives = 3) {
        playersUl.innerHTML = '';

        const sortedPlayers = [...players].sort((a, b) => {
            const aAlive = activePlayers.includes(a);
            const bAlive = activePlayers.includes(b);
            if (aAlive && !bAlive) return -1;
            if (!aAlive && bAlive) return 1;
            return 0;
        });

        sortedPlayers.forEach(p => {
            const isDead = lives[p] <= 0;
            const hasBomb = (p === currentTurn && !isDead);
            const isMe = (p === playerColor);

            let heartsHtml = '';
            // La riga 'const maxLives = 3;' È STATA ELIMINATA QUI, userà il parametro!
            for (let i = 0; i < maxLives; i++) {
                if (i < lives[p]) heartsHtml += '❤️';
                else heartsHtml += '<span class="lost-life">❤️</span>';
            }
            if (isDead) heartsHtml = '💀';

            const li = document.createElement('li');
            li.className = `player-entry ${hasBomb ? 'has-bomb' : ''} ${isDead ? 'dead' : ''}`;

            li.innerHTML = `
                <div class="avatar-circle" style="background-color: ${p};"></div>
                <div class="player-info">${isMe ? 'Tu' : ''} ${isDead ? '<strike>Eliminato</strike>' : ''}</div>
                <div class="lives">${heartsHtml}</div>
            `;

            playersUl.appendChild(li);
        });
    }
});