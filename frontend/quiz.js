// frontend/quiz.js
const socket = io();

// 1. RECUPERA DATI DALL'URL
const urlParams = new URLSearchParams(window.location.search);
const lobbyId = urlParams.get('lobby');
const playerColor = urlParams.get('color');
const gameId = urlParams.get('game') || 'trivia';
const questionImage = document.getElementById('question-image');

console.log("Variabili URL:", { lobbyId, playerColor, gameId });

// 2. ELEMENTI DOM
const questionText = document.getElementById('question-text');
const answerBtns = document.querySelectorAll('.answer-btn');
const timerFill = document.getElementById('timer-fill');
const scoreList = document.getElementById('score-list');
const roundInfo = document.getElementById('round-info');
const statusMsg = document.getElementById('status-message');
const answersContainer = document.getElementById('answers-container');

// Riferimenti ai nuovi elementi
const gameOverScreen = document.getElementById('game-over-screen');
const finalPodium = document.getElementById('final-podium');
const hostControls = document.getElementById('host-controls');
const waitingHostMsg = document.getElementById('waiting-host-msg');
const btnPlayAgain = document.getElementById('btn-play-again');
const btnBackLobby = document.getElementById('btn-back-lobby');

// 3. CONNESSIONE SOCKET
socket.on('connect', () => {
    console.log('✅ Connesso al Server Socket:', socket.id);

    if (!lobbyId || !playerColor) {
        alert("Errore: Parametri mancanti nell'URL");
        return;
    }

    // FONDAMENTALE: Diciamo al server "Ehi, sono arrivato nella pagina del gioco!"
    console.log('📤 Invio richiesta joinGame...');
    socket.emit('joinGame', {
        lobbyId,
        gameId,
        playerColor
    });
});

// 4. GESTIONE EVENTI DAL SERVER

// Messaggio di attesa (es. "Il round sta per iniziare")
socket.on('statusMessage', (data) => {
    console.log('📩 Messaggio di stato:', data.message);
    statusMsg.textContent = data.message;
});

// Arriva una domanda
socket.on('newQuestion', (data) => {
    console.log('📩 Nuova domanda ricevuta:', data);

    // 1. Estrai anche 'imageUrl'
    const { question, options, round, totalRounds, time, scores, imageUrl } = data;

    resetButtons();
    statusMsg.textContent = 'Scegli la risposta!';
    questionText.textContent = question;
    roundInfo.textContent = `Round ${round}/${totalRounds}`;

    // --- GESTIONE IMMAGINE ---
    if (imageUrl) {
        questionImage.src = imageUrl;
        questionImage.style.display = 'block'; // Mostra immagine
    } else {
        questionImage.style.display = 'none'; // Nascondi se non c'è
        questionImage.src = '';
    }
    // -------------------------

    if (scores) {
        updateScoreboard(scores);
    }

    // Aggiorna Bottoni
    answerBtns.forEach((btn, index) => {
        btn.textContent = options[index];
        btn.disabled = false;
        btn.onclick = () => sendAnswer(index);
    });

    // Barra del timer
    timerFill.style.transition = 'none'; // Reset istantaneo
    timerFill.style.width = '100%';
    // Forza un reflow per riavviare l'animazione
    void timerFill.offsetWidth;
    timerFill.style.transition = `width ${time}s linear`;
    timerFill.style.width = '0%';
});

// Risultati del Round
socket.on('roundResult', (data) => {
    console.log('📩 Risultati round:', data);
    const { correctIndex, scores, playerAnswers } = data;
    const myAnswer = playerAnswers[playerColor];

    answerBtns.forEach((btn, index) => {
        btn.disabled = true;
        if (index === correctIndex) btn.classList.add('correct');
        else if (index === myAnswer) btn.classList.add('selected-wrong');
        else btn.classList.add('wrong');
    });

    updateScoreboard(scores);
});

// Fine Gioco
socket.on('gameOver', (data) => {
    console.log('🏁 Game Over', data);
    const { scores, hostColor } = data; // Riceviamo anche l'hostColor

    // Nascondi interfaccia gioco
    document.querySelector('.game-container').classList.add('blur-background'); // Opzionale: sfoca sfondo

    // Mostra Overlay
    gameOverScreen.style.display = 'flex';

    // Genera Classifica Finale
    finalPodium.innerHTML = '';
    const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);

    sorted.forEach(([pColor, score], index) => {
        const div = document.createElement('div');
        div.className = `final-rank-item ${index === 0 ? 'winner' : ''}`;

        let medal = '';
        if (index === 0) medal = '🥇';
        if (index === 1) medal = '🥈';
        if (index === 2) medal = '🥉';

        // --- MODIFICA QUI SOTTO: Usiamo i pallini invece del testo ---
        div.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <span class="rank-position">${index + 1}° ${medal}</span>
                
                <div class="score-avatar-circle">
                    <div class="score-avatar-color" style="background-color: ${pColor}"></div>
                </div>
                
                ${pColor === playerColor ? '<span style="font-size:0.8em; opacity:0.8;">(Tu)</span>' : ''}
            </div>
            <div style="font-weight: bold;">${score} pt</div>
        `;
        // -------------------------------------------------------------

        finalPodium.appendChild(div);
    });

    // Controlla se sono l'host
    if (playerColor === hostColor) {
        hostControls.style.display = 'flex';
        waitingHostMsg.style.display = 'none';
    } else {
        hostControls.style.display = 'none';
        waitingHostMsg.style.display = 'block';
    }
});

// Evento: Redirect (per tornare alla lobby)
socket.on('returnToLobbySignal', () => {
    console.log("Ricevuto segnale ritorno alla lobby...");

    // Costruiamo l'URL completo per evitare che il controllo di sicurezza ci cacci
    const targetUrl = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(playerColor)}`;

    window.location.href = targetUrl;
});

// Evento: Gioco Riavviato (pulisci schermo e ricomincia)
socket.on('gameRestarted', () => {
    gameOverScreen.style.display = 'none';
    statusMsg.textContent = "Nuova partita in arrivo...";
    updateScoreboard({});

    // --- AGGIUNGI QUESTO: Resetta il bottone dell'Host ---
    btnPlayAgain.textContent = "🔄 Gioca di Nuovo";
    btnPlayAgain.disabled = false;
    // -----------------------------------------------------
});

// --- GESTIONE CLICK BOTTONI (Solo Host) ---

btnPlayAgain.addEventListener('click', () => {
    btnPlayAgain.textContent = "Caricamento...";
    btnPlayAgain.disabled = true;

    // Recupera settings dall'URL se possibile, o usa default
    // Nota: per fare una cosa fatta bene dovremmo aver salvato i settings iniziali.
    // Per ora passiamo un oggetto vuoto, userà i default del server o aggiungi logica per salvarli.
    socket.emit('playAgain', { lobbyId, settings: {} });
});

btnBackLobby.addEventListener('click', () => {
    socket.emit('backToLobby', { lobbyId });
});

// --- FUNZIONI UTILI ---
function sendAnswer(index) {
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

// frontend/quiz.js

function updateScoreboard(scores) {
    scoreList.innerHTML = '';

    // Ordina i giocatori per punteggio decrescente
    Object.entries(scores)
        .sort(([, a], [, b]) => b - a)
        .forEach(([pColor, score]) => {
            const li = document.createElement('li');

            // 1. Creiamo la struttura del pallino colorato
            const avatarCircle = document.createElement('div');
            avatarCircle.className = 'score-avatar-circle';

            const avatarColorDiv = document.createElement('div');
            avatarColorDiv.className = 'score-avatar-color';
            avatarColorDiv.style.backgroundColor = pColor; // Applichiamo il colore RGB qui

            // Assembliamo il pallino
            avatarCircle.appendChild(avatarColorDiv);

            // 2. Creiamo il testo del punteggio
            const scoreText = document.createElement('span');
            scoreText.textContent = `${score} pt`;

            // 3. Verifica se sono io
            if (pColor === playerColor) {
                li.classList.add('current-player'); // Aggiunge bordo e stile
                scoreText.textContent += " (Tu)";
            }

            // 4. Inseriamo tutto nella riga
            li.appendChild(avatarCircle);
            li.appendChild(scoreText);

            scoreList.appendChild(li);
        });
}


// --- GESTIONE CAMBIO TEMA ---

const themeBtn = document.getElementById('theme-toggle-btn');
const body = document.body;

// 1. Controlla se l'utente aveva già scelto un tema in passato
const savedTheme = localStorage.getItem('quiz-theme');
if (savedTheme === 'dark') {
    body.classList.add('theme-dark');
    themeBtn.innerHTML = '☀️ Stile Light'; // Cambia testo bottone
} else {
    themeBtn.innerHTML = '🌘 Stile Dark';
}

// 2. Aggiungi il listener al click del bottone
themeBtn.addEventListener('click', () => {
    // Toggle della classe 'theme-dark' sul body
    body.classList.toggle('theme-dark');

    // Aggiorna il testo del bottone e salva la preferenza
    if (body.classList.contains('theme-dark')) {
        themeBtn.innerHTML = '☀️ Stile Light';
        localStorage.setItem('quiz-theme', 'dark'); // Salva 'dark' in memoria
    } else {
        themeBtn.innerHTML = '🌘 Stile Dark';
        localStorage.setItem('quiz-theme', 'light'); // Salva 'light' in memoria
    }
});