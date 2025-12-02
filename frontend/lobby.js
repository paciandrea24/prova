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
        }
    };

    // Mostra l'ID della lobby (formattato nel nuovo header)
    const lobbyIdValue = document.getElementById('lobby-id-value');
    if (lobbyIdValue) lobbyIdValue.textContent = lobbyId;

    // Carica i dati della lobby
    loadLobby();

    // SOCKET
    const socket = io();
    socket.emit('joinLobby', lobbyId);

    socket.on('gameSelected', (data) => {
        const { gameId, settings } = data;
        const settingsParam = settings ? `&settings=${encodeURIComponent(JSON.stringify(settings))}` : '';

        let targetPage = '/game.html';
        if (gameId === 'trivia') targetPage = '/quiz.html';

        console.log(`Reindirizzamento a ${targetPage}`);
        window.location.href = `${targetPage}?lobby=${lobbyId}&color=${selectedColor}&game=${gameId}${settingsParam}`;
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
            alert('Error loading lobby. Redirecting to home page.');
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
        if (!leftBox || document.querySelector('#invite-btn')) return;

        const inviteBtn = document.createElement('button');
        inviteBtn.id = 'invite-btn';
        inviteBtn.textContent = 'Invite Players';
        inviteBtn.addEventListener('click', invitePlayers);
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
            alert('Error generating invite link');
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
});