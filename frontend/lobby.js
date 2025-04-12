document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const selectedColor = urlParams.get('color');

    if (!lobbyId || !selectedColor) {
        window.location.href = '/';
        return;
    }

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
    socket.on('gameSelected', (data) => {
        const { gameId } = data;
        // Reindirizza alla pagina del gioco
        window.location.href = `/game.html?lobby=${lobbyId}&color=${selectedColor}&game=${gameId}`;
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
            alert("Link copiato");
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

                    // Notifica a tutti che un gioco è stato selezionato
                    socket.emit('startGame', { lobbyId, gameId });

                    // Anche l'host si reindirizza
                    window.location.href = `/game.html?lobby=${lobbyId}&color=${selectedColor}&game=${gameId}`;
                });

                // Assicuriamoci che non abbia la classe disabled
                newElement.classList.remove('disabled');
            } else {
                // Disabilita i selettori per i non-host
                console.log(`Disabling game selector for non-host`);
                gameElement.classList.add('disabled');
            }
        });
    }

    // Aggiorna periodicamente la lobby
    setInterval(loadLobby, 3000);
});