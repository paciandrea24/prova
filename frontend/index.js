document.addEventListener('DOMContentLoaded', () => {
    const avatarBox = document.querySelector('.avatar-box');
    const selectedAvatarColor = document.querySelector('.avatar-color');
    const form = document.querySelector('#colorForm');
    const hiddenInputForColorSelection = document.querySelector('#hiddenInputForColorSelection');

    // Imposta un colore predefinito all'inizio
    selectedAvatarColor.style.backgroundColor = '#DC143C';
    hiddenInputForColorSelection.value = 'DC143C';

    // Controlla se stiamo entrando in una lobby esistente
    const urlParams = new URLSearchParams(window.location.search);
    const joinLobbyId = urlParams.get('join');
    if (joinLobbyId) {
        // Se abbiamo un ID di lobby da unirsi, mostriamo un messaggio
        const firstBox = document.querySelector('.first-box');
        const joinMessage = document.createElement('p');
        joinMessage.textContent = `Joining lobby: ${joinLobbyId}`;
        joinMessage.style.color = '#333';
        joinMessage.style.marginBottom = '10px';
        firstBox.insertBefore(joinMessage, firstBox.firstChild);

        // Modifica il testo del pulsante
        const submitButton = document.querySelector('.submit-button');
        submitButton.textContent = 'Join lobby';
    }

    const availableColors = ['#DC143C', '#4169E1', '#50C878', '#FFD700', '#9966CC', '#36454F'];

    selectedAvatarColor.addEventListener("click", e => {
        e.preventDefault();
        // Rimuovi il box di selezione colore se esiste già
        const existingBox = document.querySelector('.change-color-box');
        if (existingBox) {
            existingBox.remove();
            return;
        }

        const changeColorBox = showChangeColorBox();
        showColorOptions(changeColorBox);
    });

    // CREA SOLO IL BOX
    function showChangeColorBox() {
        const changeColorBox = document.createElement('div');
        changeColorBox.setAttribute('class', 'change-color-box');
        avatarBox.appendChild(changeColorBox);
        return changeColorBox;
    }

    // MOSTRA I COLORI DISPONIBILI NELLA LISTA availableColors
    function showColorOptions(changeColorBox) {
        const colorList = document.createElement('ul');
        colorList.setAttribute('class', 'color-list');
        changeColorBox.appendChild(colorList);

        availableColors.forEach((color) => {
            const availableCircle = document.createElement('div');
            availableCircle.setAttribute('class', 'avatar-circle');
            availableCircle.style.width = '80px';
            availableCircle.style.height = '80px';
            colorList.appendChild(availableCircle);

            const availableColor = document.createElement('div');
            availableColor.setAttribute('class', 'avatar-color');
            availableColor.style.backgroundColor = color;
            availableColor.style.width = '50px';
            availableColor.style.height = '50px';
            availableCircle.appendChild(availableColor);

            // riempie i colori disponibili all'hover
            availableColor.addEventListener('mouseenter', e => {
                const currentColor = e.target.style.backgroundColor;
                e.target.style.borderColor = currentColor;
            });

            // seleziona il colore cliccato
            availableColor.addEventListener('click', e => {
                e.preventDefault();

                selectedAvatarColor.style.backgroundColor = e.target.style.backgroundColor;
                hiddenInputForColorSelection.value = e.target.style.backgroundColor;
                console.log('Ho selezionato il colore: ' + hiddenInputForColorSelection.value);
                changeColorBox.remove();

                // aggiorna il colore dell'hover del colore selezionato
                selectedAvatarColor.addEventListener('mouseenter', e => {
                    const currentColor = e.target.style.backgroundColor;
                    e.target.style.borderColor = currentColor;
                });
            });
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const color = hiddenInputForColorSelection.value;
        if (!color) {
            alert('Please select a color first!');
            return;
        }

        const joinLobbyId = urlParams.get('join');

        if (joinLobbyId) {
            // Se stiamo entrando in una lobby esistente
            try {
                const response = await fetch('/join-lobby', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ color: color, lobbyId: joinLobbyId })
                });

                if (response.ok) {
                    const data = await response.json();
                    window.location.href = `/lobby.html?lobby=${joinLobbyId}&color=${color}`;
                } else {
                    throw new Error('Server error');
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Failed to join lobby');
            }
        } else {
            // Se stiamo creando una nuova lobby
            try {
                const response = await fetch('/create-lobby', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ color: color })
                });

                if (response.ok) {
                    const data = await response.json();
                    window.location.href = data.redirect;
                } else {
                    throw new Error('Server error');
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Failed to create lobby');
            }
        }
    });
});