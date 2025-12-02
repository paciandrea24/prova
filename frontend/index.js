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

    // Input manuale Lobby ID
    const toggleJoinLink = document.getElementById('toggle-join-mode'); // Se hai aggiunto l'HTML del link
    const lobbyInputContainer = document.getElementById('lobby-input-container'); // Se hai aggiunto l'HTML dell'input
    const lobbyIdInput = document.getElementById('lobby-id-input');

    // Inizializza UI
    selectedAvatarColor.style.backgroundColor = 'transparent';
    selectedAvatarColor.style.border = '2px dashed #ccc';
    hiddenInput.value = '';
    submitButton.textContent = 'Choose a color first';
    submitButton.disabled = true;
    submitButton.style.opacity = '0.6';
    submitButton.style.cursor = 'not-allowed';

    // Variabili di stato
    let isJoinMode = false;
    let urlJoinId = new URLSearchParams(window.location.search).get('join');
    let takenColors = [];

    // Funzione aggiornamento colori (dal server)
    async function updateTakenColors(targetLobbyId) {
        if (!targetLobbyId) return;
        try {
            const response = await fetch(`/api/lobby-colors/${targetLobbyId}`);
            if (response.ok) {
                const data = await response.json();
                takenColors = (data.takenColors || []).map(c => c.toUpperCase());
                console.log(`Colori occupati in ${targetLobbyId}:`, takenColors);
            }
        } catch (error) {
            console.error("Errore fetch colori:", error);
        }
    }

    // Se arriviamo da un link di invito
    if (urlJoinId) {
        // Nascondi input manuale se presente
        if (lobbyInputContainer) lobbyInputContainer.style.display = 'none';
        if (toggleJoinLink) toggleJoinLink.style.display = 'none';

        const firstBox = document.querySelector('.first-box');
        const joinMessage = document.createElement('p');
        joinMessage.textContent = `Joining lobby: ${urlJoinId}`;
        joinMessage.className = 'label';
        joinMessage.style.fontSize = '1rem';
        joinMessage.style.marginBottom = '10px';
        firstBox.insertBefore(joinMessage, firstBox.firstChild);

        submitButton.textContent = 'Choose a color to join';

        await updateTakenColors(urlJoinId);
    }

    // --- GESTIONE TOGGLE "ENTER CODE" (Opzionale, se hai messo l'HTML) ---
    if (toggleJoinLink && lobbyInputContainer) {
        toggleJoinLink.addEventListener('click', () => {
            isJoinMode = !isJoinMode;
            if (isJoinMode) {
                lobbyInputContainer.style.display = 'flex'; // o block
                toggleJoinLink.textContent = "Back to create lobby";
                if (hiddenInput.value) submitButton.textContent = 'Join Lobby';
                else submitButton.textContent = 'Choose a color first';

                // Listener per aggiornare colori quando si scrive l'ID
                if (lobbyIdInput) {
                    lobbyIdInput.addEventListener('blur', async () => {
                        if (lobbyIdInput.value.trim()) await updateTakenColors(lobbyIdInput.value.trim());
                    });
                }
            } else {
                lobbyInputContainer.style.display = 'none';
                toggleJoinLink.textContent = "Have a lobby code? Join here";
                takenColors = []; // Reset
                if (hiddenInput.value) submitButton.textContent = 'Create Lobby';
                else submitButton.textContent = 'Choose a color first';
            }
        });
    }

    // LISTA COLORI UFFICIALE
    const availableColors = ['#DC143C', '#4169E1', '#50C878', '#FFD700', '#9966CC', '#36454F'];

    // CLICK SUL BOX AVATAR
    avatarBox.addEventListener("click", async (e) => {
        e.preventDefault();
        if (e.target.closest('.change-color-box')) return;

        const existingBox = document.querySelector('.change-color-box');
        if (existingBox) { existingBox.remove(); return; }

        // Se siamo in join (URL o Manuale), aggiorniamo i colori
        let currentTargetLobby = urlJoinId;
        if (isJoinMode && lobbyIdInput && lobbyIdInput.value.trim()) {
            currentTargetLobby = lobbyIdInput.value.trim();
        }

        if (currentTargetLobby) {
            document.body.style.cursor = 'wait';
            await updateTakenColors(currentTargetLobby);
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
            // Stili inline per il menu
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
                    hiddenInput.value = color;

                    console.log('Colore scelto:', color);
                    changeColorBox.remove();

                    // Aggiorna testo bottone
                    if (urlJoinId || (isJoinMode && lobbyIdInput && lobbyIdInput.value.trim())) {
                        submitButton.textContent = 'Join Lobby';
                    } else if (isJoinMode) {
                        submitButton.textContent = 'Enter Lobby ID';
                    } else {
                        submitButton.textContent = 'Create Lobby';
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

        const color = hiddenInput.value;
        if (!color) { alert('Please select a color first!'); return; }

        // Determina ID Lobby (da URL o Manuale)
        let targetLobbyId = urlJoinId;
        if (isJoinMode && lobbyIdInput) {
            targetLobbyId = lobbyIdInput.value.trim();
            if (!targetLobbyId) {
                alert("Please enter a Lobby ID.");
                return;
            }
        }

        submitButton.disabled = true;
        submitButton.textContent = "Processing...";

        if (targetLobbyId) {
            // --- JOIN ---
            try {
                const response = await fetch('/join-lobby', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ color: color, lobbyId: targetLobbyId })
                });

                if (response.ok) {
                    // Fix URL per Join
                    window.location.href = `/lobby.html?lobby=${targetLobbyId}&color=${encodeURIComponent(color)}`;
                } else {
                    const errData = await response.json();
                    if (errData.error && errData.error.includes('taken')) {
                        alert("Colore già preso! La lista verrà aggiornata.");
                        await updateTakenColors(targetLobbyId);

                        // Reset UI
                        submitButton.textContent = 'Choose color again';
                        selectedAvatarColor.style.backgroundColor = 'transparent';
                        selectedAvatarColor.style.border = '2px dashed #ccc';
                        hiddenInput.value = '';
                    } else {
                        alert('Errore: ' + errData.error);
                        submitButton.disabled = false;
                        submitButton.textContent = 'Join Lobby';
                    }
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Connection error');
                submitButton.disabled = false;
            }
        } else {
            // --- CREATE ---
            try {
                const response = await fetch('/create-lobby', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ color: color })
                });

                if (response.ok) {
                    const data = await response.json();

                    // --- FIX DEL RIMBALZO (HASH IN URL) ---
                    // Il server manda un URL "sporco" col # (es. ...color=#DC143C)
                    // Dobbiamo estrarre l'ID e ricostruire l'URL "pulito" (es. ...color=%23DC143C)

                    let finalLobbyId = "";

                    // Tentativo 1: prendi da redirect string
                    const match = data.redirect.match(/lobby=([^&]+)/);
                    if (match && match[1]) {
                        finalLobbyId = match[1];
                    }

                    if (finalLobbyId) {
                        const cleanUrl = `/lobby.html?lobby=${finalLobbyId}&color=${encodeURIComponent(color)}`;
                        console.log("Redirecting to clean URL:", cleanUrl);
                        window.location.href = cleanUrl;
                    } else {
                        // Fallback se l'estrazione fallisce
                        window.location.href = data.redirect;
                    }

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

    document.addEventListener('click', (e) => {
        if (!avatarBox.contains(e.target)) {
            const existingBox = document.querySelector('.change-color-box');
            if (existingBox) existingBox.remove();
        }
    });
});