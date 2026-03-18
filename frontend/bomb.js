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
        timerText.textContent = "00.0s";
        bombContainer.classList.remove('active');
        bombContainer.classList.add('exploded');
        wordInput.disabled = true;
        turnIndicator.style.display = 'none';
    });

    // Cerca socket.on('gameEnd', ...) e sostituiscilo TUTTO con questo:
    socket.on('gameEnd', (data) => {
        const ranking = data.ranking; // [1° classificato, 2°, 3°, ecc.]
        const podiumContainer = document.getElementById('podium-container');
        podiumContainer.innerHTML = '';

        // Funzione per creare il gradino
        const createSpot = (pColor, position) => {
            if (!pColor) return ''; // Se c'erano meno di 3 giocatori, ignora

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

        // Costruiamo l'HTML nell'ordine visivo classico dei podi: 2, 1, 3
        let html = '';
        if (ranking[1]) html += createSpot(ranking[1], 2); // Secondo posto (Sinistra)
        if (ranking[0]) html += createSpot(ranking[0], 1); // Primo posto (Centro)
        if (ranking[2]) html += createSpot(ranking[2], 3); // Terzo posto (Destra)

        podiumContainer.innerHTML = html;
        gameEndModal.style.display = 'flex';
    });

    backToLobbyBtn.onclick = () => {
        window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(playerColor)}`;
    };

    // --- FUNZIONI DI SUPPORTO ---

    function startLocalTimer(seconds) {
        clearInterval(timerInterval);
        localTimerValue = seconds;

        timerInterval = setInterval(() => {
            localTimerValue -= 0.1;
            if (localTimerValue <= 0) {
                localTimerValue = 0;
                clearInterval(timerInterval);
            }
            timerText.textContent = localTimerValue.toFixed(1) + "s";
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