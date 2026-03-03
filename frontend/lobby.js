document.addEventListener('DOMContentLoaded', () => {

    // --- 1. GESTIONE TEMA (Copiata da index.js/quiz.js) ---
    const themeBtn = document.getElementById('theme-toggle-btn');
    const body = document.body;
    const savedTheme = localStorage.getItem('quiz-theme');

    if (savedTheme === 'dark') {
        body.classList.add('theme-dark');
        if (themeBtn) themeBtn.textContent = '☀️ Stile Light';
    } else {
        if (themeBtn) themeBtn.textContent = '🌘 Stile Dark';
    }

    if (themeBtn) {
        themeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            body.classList.toggle('theme-dark');
            if (body.classList.contains('theme-dark')) {
                themeBtn.textContent = '☀️ Stile Light';
                localStorage.setItem('quiz-theme', 'dark');
            } else {
                themeBtn.textContent = '🌘 Stile Dark';
                localStorage.setItem('quiz-theme', 'light');
            }
        });
    }
    // ------------------------------------------------------

    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const selectedColor = urlParams.get('color');

    if (!lobbyId || !selectedColor) {
        window.location.href = '/';
        return;
    }

    // Variabili globali per la gestione del pannello impostazioni
    let currentSelectedGame = null;
    let gameSettings = {
        drawing: {
            rounds: 3,
            time: 60,
            difficulty: 'medium'
        },
        trivia: {
            questions: 10,
            time: 30,
            category: 'general'
        },
        racing: {
            difficulty: 'easy',
            numTracks: 3
        }
    };

    // Mostra l'ID della lobby (formattato nel nuovo header)
    const lobbyIdValue = document.getElementById('lobby-id-value');
    const lobbyIdLabel = document.getElementById('lobby-id-label'); // Assicurati di avere questo ID nell'HTML (lo hai già)
    const lobbyIdContainer = document.getElementById('lobby-id-container');

    if (lobbyIdValue) lobbyIdValue.textContent = lobbyId;

    // --- NUOVA LOGICA: COPIA ID AL CLICK ---
    if (lobbyIdContainer) {
        lobbyIdContainer.addEventListener('click', () => {
            // 1. Copia nella clipboard
            navigator.clipboard.writeText(lobbyId).then(() => {

                // 2. Feedback visivo: Cambia "Lobby ID:" in "Copiato!"
                const originalLabel = lobbyIdLabel.textContent;
                lobbyIdLabel.textContent = "Copiato! ✅";
                lobbyIdContainer.style.backgroundColor = "#dff9fb"; // Opzionale: flash colore (funziona meglio su tema light)

                // 3. Ripristina dopo 1.5 secondi
                setTimeout(() => {
                    lobbyIdLabel.textContent = originalLabel;
                    lobbyIdContainer.style.backgroundColor = ""; // Rimuovi colore inline per tornare al CSS
                }, 1500);

            }).catch(err => {
                console.error('Errore nella copia: ', err);
            });
        });
    }
    // ---------------------------------------



    // Carica i dati della lobby
    loadLobby();

    // SOCKET
    const socket = io();
    socket.emit('joinLobby', lobbyId);

    socket.on('gameSelected', (data) => {
        const { gameId, settings } = data;

        // Costruiamo la stringa dei settings
        const settingsParam = settings ? `&settings=${encodeURIComponent(JSON.stringify(settings))}` : '';

        // LOGICA DI SMISTAMENTO:
        let targetPage = '/game.html'; // Default (Disegno)

        if (gameId === 'trivia') {
            targetPage = '/quiz.html'; // Quiz Game
        } else if (gameId === 'racing') {
            targetPage = '/racing.html'; // <-- Racing Game
        }

        console.log(`Reindirizzamento a ${targetPage} per il gioco: ${gameId}`);

        // --- FIX CRUCIALE QUI SOTTO ---
        // Dobbiamo usare encodeURIComponent anche qui per il colore!
        // Altrimenti il '#' del colore rompe l'URL e i parametri successivi vengono persi.

        window.location.href = `${targetPage}?lobby=${lobbyId}&color=${encodeURIComponent(selectedColor)}&game=${gameId}${settingsParam}`;
    });

    async function loadLobby() {
        try {
            const response = await fetch(`/api/lobby/${lobbyId}`);
            if (!response.ok) throw new Error('Lobby not found');
            const lobby = await response.json();

            updatePlayerList(lobby.players, selectedColor, lobby.host);

            if (selectedColor === lobby.host && !document.querySelector('#invite-btn')) {
                const hostTitle = document.querySelector('#host-title');
                if (hostTitle) hostTitle.textContent = '(Host)';
                addInviteButton();
            }
            setupGameSelectors(lobby.host);
        } catch (error) {
            console.error('Error loading lobby:', error);
            showToast('Error loading lobby. Redirecting to home page.');
            window.location.href = '/';
        }
    }

    // Funzione per aggiornare la lista dei giocatori
    function updatePlayerList(players, currentPlayerColor, hostColor) {
        const playersList = document.querySelector('.players-ul');
        if (!playersList) return;

        playersList.innerHTML = '';

        // Funzione helper per creare l'HTML di un giocatore
        const createPlayerItem = (pColor, isMe) => {
            const li = document.createElement('li');

            const entryDiv = document.createElement('div');
            // Usiamo le classi entry-1 / entry-2 per alternare i colori di sfondo se vuoi, 
            // oppure fisso 'player-entry-1' per semplicità (come nel tuo CSS)
            entryDiv.className = 'player-entry-1';

            // 1. Il Pallino (Avatar)
            const circle = document.createElement('div');
            circle.className = 'avatar-circle';

            const colorDiv = document.createElement('div');
            colorDiv.className = 'avatar-color';
            colorDiv.style.backgroundColor = pColor;

            circle.appendChild(colorDiv);

            // 2. Info Giocatore (Nome e Host)
            const infoDiv = document.createElement('div');
            infoDiv.className = 'player-info';

            const nameP = document.createElement('p');
            nameP.className = 'player-name';

            // --- MODIFICA QUI ---
            if (isMe) {
                nameP.textContent = 'You'; // Mostra "You" se sei tu
                nameP.style.fontWeight = 'bold';
            } else {
                nameP.textContent = ''; // Lascia VUOTO per gli altri (niente codice RGB!)
                // Se volessi scrivere "Player" invece di niente, scrivi: nameP.textContent = 'Player';
            }
            // --------------------

            infoDiv.appendChild(nameP);

            // Etichetta Host
            if (pColor === hostColor) {
                const hostSpan = document.createElement('span');
                hostSpan.className = 'host-indicator';
                hostSpan.textContent = '(Host)';
                infoDiv.appendChild(hostSpan);
            }

            // Assemblaggio
            entryDiv.appendChild(circle);
            entryDiv.appendChild(infoDiv);
            li.appendChild(entryDiv);
            return li;
        };

        // Prima aggiungiamo noi stessi in cima alla lista
        playersList.appendChild(createPlayerItem(currentPlayerColor, true));

        // Poi aggiungiamo tutti gli altri giocatori
        players.forEach(playerColor => {
            if (playerColor !== currentPlayerColor) {
                playersList.appendChild(createPlayerItem(playerColor, false));
            }
        });
    }

    function addInviteButton() {
        const leftBox = document.querySelector('.left-side-box');

        // Se il bottone esiste già, non fare nulla
        if (document.querySelector('#invite-btn')) return;

        const inviteBtn = document.createElement('button');
        inviteBtn.id = 'invite-btn';
        inviteBtn.textContent = 'Invite Players';
        inviteBtn.addEventListener('click', invitePlayers);

        // Semplicemente aggiungilo in fondo alla colonna sinistra
        leftBox.appendChild(inviteBtn);
    }

    async function invitePlayers() {
        try {
            const response = await fetch(`/api/invite/${lobbyId}`);
            const data = await response.json();
            navigator.clipboard.writeText(data.inviteLink);

            // Crea un piccolo feedback visivo temporaneo
            const btn = document.getElementById('invite-btn');
            const originalText = btn.textContent;
            btn.textContent = "Link Copied!";
            setTimeout(() => btn.textContent = originalText, 2000);

        } catch (error) {
            console.error('Error generating invite link:', error);
            showToast('Error generating invite link');
        }
    }

    function setupGameSelectors(hostColor) {
        const gameElements = document.querySelectorAll('.game-selector');

        gameElements.forEach(gameElement => {
            if (selectedColor === hostColor) {
                const newElement = gameElement.cloneNode(true);
                gameElement.parentNode.replaceChild(newElement, gameElement);

                newElement.addEventListener('click', (event) => {
                    // Cerca il data attribute risalendo l'albero se clicco sull'icona
                    const target = event.target.closest('.game-selector');
                    const gameId = target.dataset.gameId;
                    showGameSettings(gameId);
                });
                newElement.classList.remove('disabled');
            } else {
                gameElement.classList.add('disabled');
            }
        });

        setupSettingsPanel();
    }

    function showGameSettings(gameId) {
        currentSelectedGame = gameId;
        document.getElementById('game-list').style.display = 'none';
        document.getElementById('game-settings-panel').style.display = 'flex'; // Flex per layout corretto

        const gameNames = { 'drawing': 'Drawing Game', 'trivia': 'Quiz Game' };
        document.getElementById('section-title').textContent = gameNames[gameId] || 'Game Settings';

        document.querySelectorAll('.settings-section').forEach(s => s.style.display = 'none');
        const targetSection = document.getElementById(`${gameId}-settings`);
        if (targetSection) targetSection.style.display = 'flex'; // Flex colonna

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
        const settingsSection = document.getElementById(`${gameId}-settings`);
        if (!settingsSection) return settings;

        const selects = settingsSection.querySelectorAll('select');
        selects.forEach(select => {
            const key = select.id.replace(`${gameId}-`, '');
            settings[key] = select.value;
        });
        gameSettings[gameId] = { ...gameSettings[gameId], ...settings };
        return settings;
    }

    function backToGameList() {
        document.getElementById('game-list').style.display = 'flex'; // Flex per layout riga
        document.getElementById('game-settings-panel').style.display = 'none';
        document.getElementById('section-title').textContent = 'Minigames';
        currentSelectedGame = null;
    }

    function startGameWithSettings() {
        if (!currentSelectedGame) return;
        const settings = saveGameSettings(currentSelectedGame);
        socket.emit('startGame', {
            lobbyId,
            gameId: currentSelectedGame,
            settings: settings
        });
    }

    function setupSettingsPanel() {
        const backBtn = document.getElementById('back-btn');
        const startGameBtn = document.getElementById('start-game-btn');

        if (backBtn) backBtn.addEventListener('click', backToGameList);
        if (startGameBtn) startGameBtn.addEventListener('click', startGameWithSettings);

        const allSelects = document.querySelectorAll('.settings-section select');
        allSelects.forEach(select => {
            select.addEventListener('change', () => {
                if (currentSelectedGame) saveGameSettings(currentSelectedGame);
            });
        });
    }

    setInterval(loadLobby, 3000);

    // --- GESTIONE CHAT (Aggiungi in fondo a lobby.js) ---
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    const chatMessages = document.getElementById('chat-messages');

    function sendChat() {
        const text = chatInput.value.trim();
        console.log("Tentativo invio chat:", text); // DEBUG

        if (text) {
            // Assicurati che lobbyId e selectedColor siano definiti
            if (!lobbyId || !selectedColor) {
                console.error("Errore: lobbyId o selectedColor mancanti");
                return;
            }

            socket.emit('sendChatMessage', {
                lobbyId: lobbyId,
                playerColor: selectedColor,
                message: text
            });
            chatInput.value = '';
            chatInput.focus();
        }
    }
    // Funzione Helper per Notifiche
    function showToast(message, type = 'info') {
        // Crea container se non esiste
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        // Crea il toast
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        // Icona in base al tipo
        let icon = '';
        if (type === 'error') icon = '⚠️';
        if (type === 'success') icon = '✅';
        if (type === 'info') icon = 'ℹ️';

        toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

        container.appendChild(toast);

        // Rimuovi dopo 3 secondi
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s forwards';
            toast.addEventListener('animationend', () => {
                toast.remove();
            });
        }, 3000);
    }

    if (sendChatBtn) {
        sendChatBtn.addEventListener('click', sendChat);
    }

    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChat();
        });
    }

    // RICEZIONE MESSAGGI
    socket.on('receiveChatMessage', (data) => {
        const { playerColor, message, timestamp } = data;

        const msgDiv = document.createElement('div');
        const isMe = (playerColor === selectedColor);

        // Classe per allineamento
        msgDiv.className = isMe ? 'chat-msg sent' : 'chat-msg received';

        // Bordo colorato SOLO per i messaggi ricevuti (per capire chi è)
        // Se è mio, niente bordo (è ovvio che sono io)
        const bubbleStyle = isMe ? '' : `border-left: 4px solid ${playerColor}`;

        msgDiv.innerHTML = `
            <div class="chat-bubble" style="${bubbleStyle}">
                ${message}
            </div>
            <div class="chat-time">
                ${timestamp}
            </div>
        `;

        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
});

// --- GESTIONE LEADERBOARD GLOBALE LOBBY ---
const leaderboardBtn = document.getElementById('leaderboard-btn');
const leaderboardModal = document.getElementById('global-leaderboard-modal');
const closeLeaderboardBtn = document.getElementById('close-leaderboard-btn');
const leaderboardContent = document.getElementById('leaderboard-content');

if (leaderboardBtn && leaderboardModal) {
    leaderboardBtn.addEventListener('click', async () => {
        leaderboardModal.style.display = 'flex';
        leaderboardContent.innerHTML = '<p style="text-align:center;">Recupero tempi record...</p>';

        try {
            const res = await fetch('/api/leaderboard');
            const data = await res.json();

            leaderboardContent.innerHTML = '';

            if (Object.keys(data).length === 0) {
                leaderboardContent.innerHTML = '<p style="text-align:center; color:#ccc;">Nessun record ancora registrato. Scendi in pista!</p>';
                return;
            }

            // Crea una sezione per ogni pista!
            for (const [trackName, records] of Object.entries(data)) {
                let html = `<div style="margin-bottom: 20px; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px;">`;
                html += `<h3 style="color: #3498db; margin-top: 0; border-bottom: 1px dashed #555; padding-bottom: 5px;">📍 ${trackName}</h3>`;

                if (records.length === 0) {
                    html += `<p style="color: #888;">Nessun tempo registrato.</p>`;
                } else {
                    html += `<ul style="list-style: none; padding: 0; margin: 0;">`;
                    records.forEach((rec, index) => {
                        // Formatta il tempo
                        const mins = Math.floor(rec.time / 60000);
                        const secs = Math.floor((rec.time % 60000) / 1000);
                        const ms = rec.time % 1000;
                        const timeStr = `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;

                        // Colore medaglia
                        let color = 'white';
                        if (index === 0) color = 'gold';
                        if (index === 1) color = 'silver';
                        if (index === 2) color = '#cd7f32';

                        html += `
                                <li style="display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #444; font-size: 18px;">
                                    <span>
                                        <strong style="color: ${color}; display: inline-block; width: 30px;">${index + 1}°</strong> 
                                        <span style="display:inline-block; width:15px; height:15px; border-radius:50%; background-color:${rec.color}; vertical-align:middle; margin-right:5px; border:1px solid #fff;"></span>
                                        <strong>${rec.name}</strong>
                                    </span>
                                    <span style="font-family: monospace; color: #ecf0f1;">${timeStr}</span>
                                </li>`;
                    });
                    html += `</ul>`;
                }
                html += `</div>`;
                leaderboardContent.innerHTML += html;
            }
        } catch (err) {
            console.error(err);
            leaderboardContent.innerHTML = '<p style="color: red; text-align:center;">Errore di connessione al server.</p>';
        }
    });

    closeLeaderboardBtn.addEventListener('click', () => {
        leaderboardModal.style.display = 'none';
    });
}