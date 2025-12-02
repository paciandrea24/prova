document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM Caricato. Script avviato.");

    // --- 1. GESTIONE TEMA ---
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

    // --- 2. LOGICA FORM E COLORI ---
    const avatarBox = document.querySelector('.avatar-box');
    const selectedAvatarColor = document.querySelector('.avatar-color');
    const form = document.querySelector('#colorForm');
    const hiddenInput = document.querySelector('#hiddenInputForColorSelection');
    const submitButton = document.querySelector('.submit-button');

    // Inizializza UI
    selectedAvatarColor.style.backgroundColor = 'transparent';
    selectedAvatarColor.style.border = '2px dashed #ccc';
    hiddenInput.value = '';
    submitButton.textContent = 'Choose a color first';
    submitButton.disabled = true;
    submitButton.style.opacity = '0.6';
    submitButton.style.cursor = 'not-allowed';

    // Controlla Join Lobby
    const urlParams = new URLSearchParams(window.location.search);
    const joinLobbyId = urlParams.get('join');

    // Lista colori occupati
    let takenColors = [];

    // Funzione aggiornamento colori (dal server)
    async function updateTakenColors() {
        if (!joinLobbyId) return;
        try {
            const response = await fetch(`/api/lobby-colors/${joinLobbyId}`);
            if (response.ok) {
                const data = await response.json();
                // Normalizza in maiuscolo
                takenColors = (data.takenColors || []).map(c => c.toUpperCase());
                console.log("Colori occupati (Server):", takenColors);
            }
        } catch (error) {
            console.error("Errore fetch colori:", error);
        }
    }

    if (joinLobbyId) {
        const firstBox = document.querySelector('.first-box');
        const joinMessage = document.createElement('p');
        joinMessage.textContent = `Joining lobby: ${joinLobbyId}`;
        joinMessage.className = 'label';
        joinMessage.style.fontSize = '1rem';
        joinMessage.style.marginBottom = '10px';
        firstBox.insertBefore(joinMessage, firstBox.firstChild);

        submitButton.textContent = 'Choose a color to join';

        await updateTakenColors();
    }

    // LISTA COLORI UFFICIALE
    const availableColors = ['#DC143C', '#4169E1', '#50C878', '#FFD700', '#9966CC', '#36454F'];

    // CLICK SUL BOX AVATAR
    avatarBox.addEventListener("click", async (e) => {
        e.preventDefault();
        if (e.target.closest('.change-color-box')) return;

        const existingBox = document.querySelector('.change-color-box');
        if (existingBox) { existingBox.remove(); return; }

        if (joinLobbyId) {
            document.body.style.cursor = 'wait';
            await updateTakenColors();
            document.body.style.cursor = 'default';
        }

        const changeColorBox = showChangeColorBox();
        showColorOptions(changeColorBox);
    });

    function showChangeColorBox() {
        const changeColorBox = document.createElement('div');
        changeColorBox.setAttribute('class', 'change-color-box');
        avatarBox.appendChild(changeColorBox);
        return changeColorBox;
    }

    function showColorOptions(changeColorBox) {
        const colorList = document.createElement('ul');
        colorList.setAttribute('class', 'color-list');
        changeColorBox.appendChild(colorList);

        availableColors.forEach((colorHex) => {
            const color = colorHex.toUpperCase();

            const item = document.createElement('li');
            const availableCircle = document.createElement('div');
            availableCircle.setAttribute('class', 'avatar-circle');
            availableCircle.style.width = '60px';
            availableCircle.style.height = '60px';

            const availableColor = document.createElement('div');
            availableColor.setAttribute('class', 'avatar-color');
            availableColor.style.backgroundColor = color;
            availableColor.style.width = '40px';
            availableColor.style.height = '40px';

            // CONTROLLO DISPONIBILITÀ
            if (takenColors.includes(color)) {
                availableColor.classList.add('disabled');
                availableColor.title = "Già occupato";
                availableColor.style.opacity = '0.2';
                availableColor.style.cursor = 'not-allowed';
                availableColor.style.border = '2px solid #555';
            } else {
                availableColor.addEventListener('mouseenter', e => {
                    e.target.style.borderColor = color;
                });

                availableColor.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();

                    selectedAvatarColor.style.backgroundColor = color;
                    selectedAvatarColor.style.border = 'none';
                    hiddenInputForColorSelection.value = color;

                    console.log('Colore scelto:', color);
                    changeColorBox.remove();

                    if (joinLobbyId) {
                        submitButton.textContent = 'Join lobby';
                    } else {
                        submitButton.textContent = 'Create lobby';
                    }
                    submitButton.disabled = false;
                    submitButton.style.opacity = '1';
                    submitButton.style.cursor = 'pointer';
                });
            }

            availableCircle.appendChild(availableColor);
            item.appendChild(availableCircle);
            colorList.appendChild(item);
        });
    }

    // INVIO FORM
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const color = hiddenInputForColorSelection.value;
        if (!color) { alert('Please select a color first!'); return; }

        submitButton.disabled = true;
        submitButton.textContent = "Processing...";

        const joinLobbyId = urlParams.get('join');

        if (joinLobbyId) {
            // JOIN
            try {
                const response = await fetch('/join-lobby', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ color: color, lobbyId: joinLobbyId })
                });

                if (response.ok) {
                    const data = await response.json();
                    // Usiamo encodeURIComponent per gestire il # nel colore
                    window.location.href = `/lobby.html?lobby=${joinLobbyId}&color=${encodeURIComponent(color)}`;
                } else {
                    const errData = await response.json();
                    if (errData.error && errData.error.includes('taken')) {
                        alert("Colore già preso! Scegline un altro.");
                        await updateTakenColors();
                        submitButton.textContent = 'Choose a color to join';
                        selectedAvatarColor.style.backgroundColor = 'transparent';
                        selectedAvatarColor.style.border = '2px dashed #ccc';
                        hiddenInputForColorSelection.value = '';
                    } else {
                        alert('Errore: ' + errData.error);
                        submitButton.disabled = false;
                    }
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Failed to join lobby');
                submitButton.disabled = false;
            }
        } else {
            // CREATE LOBBY
            try {
                const response = await fetch('/create-lobby', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ color: color })
                });

                if (response.ok) {
                    const data = await response.json();

                    // --- FIX DEL RIMBALZO (HASH IN URL) ---
                    let finalUrl = data.redirect;

                    // Estrarre l'ID della lobby dalla stringa "brutta" del server
                    // Es: "/lobby.html?lobby=xyz123&color=#FF0000"
                    const match = data.redirect.match(/lobby=([^&]+)/);

                    if (match && match[1]) {
                        const newLobbyId = match[1];
                        // Ricostruiamo l'URL pulito codificando il colore
                        finalUrl = `/lobby.html?lobby=${newLobbyId}&color=${encodeURIComponent(color)}`;
                    }

                    console.log("Reindirizzamento a:", finalUrl);
                    window.location.href = finalUrl;

                } else {
                    throw new Error('Server error');
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Failed to create lobby');
                submitButton.disabled = false;
                submitButton.textContent = 'Create Lobby';
            }
        }
    });

    // Chiudi popup cliccando fuori
    document.addEventListener('click', (e) => {
        if (!avatarBox.contains(e.target)) {
            const existingBox = document.querySelector('.change-color-box');
            if (existingBox) existingBox.remove();
        }
    });
});