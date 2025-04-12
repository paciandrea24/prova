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
                hostTitle.textContent = '(Host)';
                addInviteButton();
            }
        } catch (error) {
            console.error('Error loading lobby:', error);
            alert('Error loading lobby. Redirecting to home page.');
            window.location.href = '/';
        }
    }

    // Funzione per aggiornare la lista dei giocatori
    function updatePlayerList(players, currentPlayerColor, hostColor) {
        const playersList = document.querySelector('.players-ul');

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
            navigator.clipboard.writeText(data.inviteLink)
            alert("Link copiato");
        } catch (error) {
            console.error('Error generating invite link:', error);
            alert('Error generating invite link');
        }
    }

    // Aggiorna periodicamente la lobby
    setInterval(loadLobby, 3000);
});