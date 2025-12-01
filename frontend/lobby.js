document.addEventListener('DOMContentLoaded', () => {
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

    // Imposta il colore dell'utente
    const userColor = document.querySelector('.avatar-color');
    if (userColor) {
        userColor.style.backgroundColor = selectedColor;
    }

    // Mostra l'ID della lobby
    const lobbyIdElement = document.querySelector('#lobby-id');
    if (lobbyIdElement) {
        lobbyIdElement.textContent = `Lobby ID: ${lobbyId}`;
    }

    // Carica i dati della lobby
    loadLobby();

    // ######################### GESTIONE WEBSOCKET ##########################################
    const socket = io();

    // Unisciti alla stanza della lobby
    socket.emit('joinLobby', lobbyId);

    // Ascolta l'evento di selezione del gioco
    // frontend/lobby.js

    socket.on('gameSelected', (data) => {
        const { gameId, settings } = data;

        // Costruiamo la stringa dei settings come facevi prima
        const settingsParam = settings ? `&settings=${encodeURIComponent(JSON.stringify(settings))}` : '';

        // LOGICA DI SMISTAMENTO:
        let targetPage = '/game.html'; // Default (Disegno)

        if (gameId === 'trivia') {
            targetPage = '/quiz.html'; // Nuovo gioco
        }
        // Puoi aggiungere altri else if in futuro per altri giochi

        console.log(`Reindirizzamento a ${targetPage} per il gioco: ${gameId}`);

        // Reindirizza alla pagina corretta portandosi dietro tutti i parametri
        window.location.href = `${targetPage}?lobby=${lobbyId}&color=${selectedColor}&game=${gameId}${settingsParam}`;
    });

    // Funzione per caricare i dati della lobby
    async function loadLobby() {
        try {
            const response = await fetch(`/api/lobby/${lobbyId}`);

            if (!response.ok) {
                throw new Error('Lobby not found');
            }

            const lobby = await response.json();

            // Aggiorna la lista dei giocatori
            updatePlayerList(lobby.players, selectedColor, lobby.host);

            // Aggiunge il pulsante per invitare altri giocatori solo se sei l'host
            if (selectedColor === lobby.host && !document.querySelector('#invite-btn')) {
                const hostTitle = document.querySelector('#host-title');
                if (hostTitle) {
                    hostTitle.textContent = '(Host)';
                }
                addInviteButton();
            }

            // Setup dei selettori di gioco dopo aver caricato la lobby
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

        // Manteniamo solo il primo elemento (l'utente corrente)
        while (playersList.children.length > 1) {
            playersList.removeChild(playersList.lastChild);
        }

        // Teniamo traccia della classe da applicare manualmente
        let usedClass = 'player-entry-1'; // Iniziamo con player-entry-1

        // Aggiungiamo gli altri giocatori
        players.forEach(playerColor => {
            if (playerColor !== currentPlayerColor) {
                const li = document.createElement('li');

                const playerEntry = document.createElement('div');
                playerEntry.className = usedClass;

                // Alterna la classe per il prossimo elemento
                usedClass = usedClass === 'player-entry-1' ? 'player-entry-2' : 'player-entry-1';

                console.log(`Player color ${playerColor}: usando ${playerEntry.className}`);

                const avatarCircle = document.createElement('div');
                avatarCircle.className = 'avatar-circle';

                const avatarColor = document.createElement('div');
                avatarColor.className = 'avatar-color';
                avatarColor.style.backgroundColor = playerColor;

                avatarCircle.appendChild(avatarColor);
                playerEntry.appendChild(avatarCircle);

                // Aggiungiamo l'indicatore di host se questo giocatore è l'host
                if (playerColor === hostColor) {
                    const hostIndicator = document.createElement('span');
                    hostIndicator.textContent = '(Host)';
                    hostIndicator.className = 'host-indicator';
                    playerEntry.appendChild(hostIndicator);
                }

                li.appendChild(playerEntry);
                playersList.appendChild(li);
            }
        });
    }

    // Funzione per aggiungere il pulsante di invito
    function addInviteButton() {
        const headerBox = document.querySelector('.header');
        if (!headerBox) return;

        if (document.querySelector('#invite-btn')) {
            return; // Evita duplicazione del pulsante
        }

        const inviteBtn = document.createElement('button');
        inviteBtn.id = 'invite-btn';
        inviteBtn.textContent = 'Invite Players';
        inviteBtn.className = 'invite-button';

        inviteBtn.addEventListener('click', invitePlayers);

        headerBox.appendChild(inviteBtn);
    }

    // Funzione per invitare altri giocatori
    async function invitePlayers() {
        try {
            const response = await fetch(`/api/invite/${lobbyId}`);
            const data = await response.json();

            // Utilizziamo il prompt per mostrare il link di invito
            navigator.clipboard.writeText(data.inviteLink);
            const linkCopiedBox = document.createElement('div');
            const headerBox = document.querySelector('.header')
            linkCopiedBox.setAttribute('class', 'link-copied-box');
            linkCopiedBox.textContent = 'Link copied!';
            headerBox.appendChild(linkCopiedBox);
            setTimeout(function () { linkCopiedBox.style.display = "none" }, 3000);
        } catch (error) {
            console.error('Error generating invite link:', error);
            alert('Error generating invite link');
        }
    }

    // Funzione per impostare i selettori di gioco
    function setupGameSelectors(hostColor) {
        const gameElements = document.querySelectorAll('.game-selector');

        console.log(`Setting up game selectors. Host color: ${hostColor}, Selected color: ${selectedColor}`);
        console.log(`Number of game elements found: ${gameElements.length}`);

        gameElements.forEach(gameElement => {
            // Solo l'host può avviare i giochi
            if (selectedColor === hostColor) {
                console.log(`Enabling game selector for host: ${gameElement.dataset.gameId}`);

                // Rimuoviamo eventuali listener precedenti
                const newElement = gameElement.cloneNode(true);
                gameElement.parentNode.replaceChild(newElement, gameElement);

                newElement.addEventListener('click', (event) => {
                    console.log(`Game selected: ${event.currentTarget.dataset.gameId}`);
                    const gameId = event.currentTarget.dataset.gameId;

                    // Mostra il pannello delle impostazioni invece di iniziare subito il gioco
                    showGameSettings(gameId);
                });

                // Assicuriamoci che non abbia la classe disabled
                newElement.classList.remove('disabled');
            } else {
                // Disabilita i selettori per i non-host
                console.log(`Disabling game selector for non-host`);
                gameElement.classList.add('disabled');
            }
        });

        // Setup dei pulsanti del pannello impostazioni
        setupSettingsPanel();
    }

    // Funzione per mostrare il pannello delle impostazioni
    function showGameSettings(gameId) {
        currentSelectedGame = gameId;

        // Nascondi la lista dei giochi
        const gameList = document.getElementById('game-list');
        const settingsPanel = document.getElementById('game-settings-panel');
        const sectionTitle = document.getElementById('section-title');

        gameList.style.display = 'none';
        settingsPanel.style.display = 'flex';

        // Cambia il titolo
        const gameNames = {
            'drawing': 'Drawing Game',
            'trivia': 'Quiz Game'
        };
        sectionTitle.textContent = gameNames[gameId] || 'Game Settings';

        // Mostra le impostazioni del gioco selezionato
        showGameSpecificSettings(gameId);

        // Carica le impostazioni salvate
        loadGameSettings(gameId);
    }

    // Funzione per mostrare le impostazioni specifiche del gioco
    function showGameSpecificSettings(gameId) {
        // Nascondi tutte le sezioni delle impostazioni
        const settingSections = document.querySelectorAll('.settings-section');
        settingSections.forEach(section => {
            section.style.display = 'none';
        });

        // Mostra la sezione appropriata
        const targetSection = document.getElementById(`${gameId}-settings`);
        if (targetSection) {
            targetSection.style.display = 'flex';
        }
    }

    // Funzione per caricare le impostazioni del gioco nei controlli
    function loadGameSettings(gameId) {
        const settings = gameSettings[gameId];
        if (!settings) return;

        Object.keys(settings).forEach(key => {
            const element = document.getElementById(`${gameId}-${key}`);
            if (element) {
                element.value = settings[key];
            }
        });
    }

    // Funzione per salvare le impostazioni del gioco
    function saveGameSettings(gameId) {
        const settings = {};

        // Trova tutti i controlli delle impostazioni per questo gioco
        const settingsSection = document.getElementById(`${gameId}-settings`);
        if (!settingsSection) return settings;

        const selects = settingsSection.querySelectorAll('select');
        selects.forEach(select => {
            const key = select.id.replace(`${gameId}-`, '');
            settings[key] = select.value;
        });

        // Salva nelle impostazioni globali
        gameSettings[gameId] = { ...gameSettings[gameId], ...settings };

        return settings;
    }

    // Funzione per tornare alla lista dei giochi
    function backToGameList() {
        const gameList = document.getElementById('game-list');
        const settingsPanel = document.getElementById('game-settings-panel');
        const sectionTitle = document.getElementById('section-title');

        gameList.style.display = 'flex';
        settingsPanel.style.display = 'none';
        sectionTitle.textContent = 'Minigames';

        currentSelectedGame = null;
    }

    // Funzione per iniziare il gioco con le impostazioni
    function startGameWithSettings() {
        if (!currentSelectedGame) return;

        // Salva le impostazioni correnti
        const settings = saveGameSettings(currentSelectedGame);

        console.log(`Starting game ${currentSelectedGame} with settings:`, settings);

        // Notifica a tutti che un gioco è stato selezionato
        socket.emit('startGame', {
            lobbyId,
            gameId: currentSelectedGame,
            settings: settings
        });

        // --- CORREZIONE QUI SOTTO ---

        // Invece di reindirizzare manualmente subito, è MEGLIO aspettare
        // l'evento 'gameSelected' dal socket (come fanno gli altri giocatori).
        // Questo assicura che server e host siano sincronizzati.

        // Rimuoviamo il reindirizzamento manuale:
        // window.location.href = ... (RIMOSSO)

        // Se proprio vuoi reindirizzare subito per evitare lag, usa questa logica dinamica:
        /*
        let targetPage = '/game.html';
        if (currentSelectedGame === 'trivia') targetPage = '/quiz.html';
        
        const settingsParam = `&settings=${encodeURIComponent(JSON.stringify(settings))}`;
        window.location.href = `${targetPage}?lobby=${lobbyId}&color=${selectedColor}&game=${currentSelectedGame}${settingsParam}`;
        */
    }

    // Funzione per configurare i pulsanti del pannello impostazioni
    function setupSettingsPanel() {
        const backBtn = document.getElementById('back-btn');
        const startGameBtn = document.getElementById('start-game-btn');

        if (backBtn) {
            backBtn.addEventListener('click', backToGameList);
        }

        if (startGameBtn) {
            startGameBtn.addEventListener('click', startGameWithSettings);
        }

        // Setup dei listener per salvare automaticamente le impostazioni
        const allSelects = document.querySelectorAll('.settings-section select');
        allSelects.forEach(select => {
            select.addEventListener('change', () => {
                if (currentSelectedGame) {
                    saveGameSettings(currentSelectedGame);
                }
            });
        });
    }

    // Aggiorna periodicamente la lobby
    setInterval(loadLobby, 3000);
});