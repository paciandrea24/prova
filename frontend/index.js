/* document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM Caricato.");

    // =========================================================
    // 1. GESTIONE TEMA
    // =========================================================
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

    // =========================================================
    // 2. ELEMENTI DOM
    // =========================================================
    const avatarBox = document.querySelector('.avatar-box');
    const avatarCircleMain = document.querySelector('.avatar-box .avatar-circle');
    const selectedAvatarColor = document.querySelector('.avatar-color');
    const helperText = document.querySelector('.helper-text');
    const hiddenInput = document.querySelector('#hiddenInputForColorSelection');

    // Pulsanti e Input
    const createBtn = document.getElementById('create-btn');
    const joinBtn = document.getElementById('join-btn');
    const linkJoinBtn = document.getElementById('link-join-btn');
    const lobbyInput = document.getElementById('lobby-id-input');

    // Blocchi UI
    const defaultActions = document.getElementById('default-actions');
    const linkJoinActions = document.getElementById('link-join-actions');
    const joinLinkMsg = document.getElementById('join-link-msg');

    // Aggiungi questo listener in index.js

    if (lobbyInput && joinBtn) {
        lobbyInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // Evita submit del form standard
                joinBtn.click(); // Simula il click sul tasto Join
            }
        });
    }

    // =========================================================
    // 3. STATO INIZIALE
    // =========================================================

    // Reset UI
    selectedAvatarColor.style.backgroundColor = 'transparent';
    selectedAvatarColor.style.border = '2px dashed #ccc';
    hiddenInput.value = '';

    // Disabilita tasti
    if (createBtn) createBtn.disabled = true;
    if (joinBtn) joinBtn.disabled = true;
    if (linkJoinBtn) linkJoinBtn.disabled = true;

    // Recupera parametri URL
    let urlJoinId = new URLSearchParams(window.location.search).get('join');
    let takenColors = [];

    // Helper: Aggiorna colori occupati
    async function fetchTakenColors(targetId) {
        if (!targetId) return;
        try {
            const response = await fetch(`/api/lobby-colors/${targetId}`);
            if (response.ok) {
                const data = await response.json();
                takenColors = (data.takenColors || []).map(c => c.toUpperCase());
            }
        } catch (e) { console.error(e); }
    }

    // Gestione Vista
    if (urlJoinId) {
        if (defaultActions) defaultActions.style.display = 'none';
        if (linkJoinActions) linkJoinActions.style.display = 'flex';
        if (joinLinkMsg) joinLinkMsg.textContent = `Joining Lobby: ${urlJoinId}`;
        await fetchTakenColors(urlJoinId);
    } else {
        if (defaultActions) defaultActions.style.display = 'flex';
        if (linkJoinActions) linkJoinActions.style.display = 'none';
    }

    // Listener Input Manuale
    if (lobbyInput) {
        lobbyInput.addEventListener('blur', async () => {
            const val = lobbyInput.value.trim();
            if (val.length > 0) await fetchTakenColors(val);
        });
    }

    // =========================================================
    // 4. LOGICA SWAP (Selezione Colore)
    // =========================================================
    const availableColors = [
        '#DC143C',
        '#4169E1',
        '#50C878',
        '#FFD700',
        '#9966CC',
        '#36454F',
        '#FF8C00',
        '#00CED1',
        '#FF1493',
        '#8B4513',
        '#7FFF00',
        '#4B0082'
    ];

    avatarCircleMain.addEventListener("click", async (e) => {
        e.preventDefault();

        const manualId = lobbyInput ? lobbyInput.value.trim() : "";
        const targetId = urlJoinId || manualId;
        if (targetId) {
            document.body.style.cursor = 'wait';
            await fetchTakenColors(targetId);
            document.body.style.cursor = 'default';
        }

        // SWAP: Nascondi cerchio, mostra lista
        avatarCircleMain.style.display = 'none';
        if (helperText) helperText.style.display = 'none';

        const changeColorBox = showChangeColorBox();
        showColorOptions(changeColorBox);
    });

    function showChangeColorBox() {
        const existing = document.querySelector('.change-color-box');
        if (existing) existing.remove();

        const changeColorBox = document.createElement('div');
        changeColorBox.className = 'change-color-box';
        avatarBox.appendChild(changeColorBox);
        return changeColorBox;
    }

    function showColorOptions(changeColorBox) {
        const colorList = document.createElement('ul');
        colorList.className = 'color-list';
        changeColorBox.appendChild(colorList);

        availableColors.forEach((colorHex) => {
            const color = colorHex.toUpperCase();
            const item = document.createElement('li');
            const circle = document.createElement('div');
            circle.className = 'avatar-circle';

            const colorDiv = document.createElement('div');
            colorDiv.className = 'avatar-color';
            colorDiv.style.backgroundColor = color;

            if (takenColors.includes(color)) {
                colorDiv.classList.add('disabled');
                colorDiv.title = "Già occupato";
            } else {
                colorDiv.addEventListener('click', ev => {
                    ev.stopPropagation();

                    selectedAvatarColor.style.backgroundColor = color;
                    selectedAvatarColor.style.border = 'none';
                    hiddenInput.value = color;

                    // SWAP BACK: Torna al cerchio grande
                    changeColorBox.remove();
                    avatarCircleMain.style.display = 'flex';
                    if (helperText) {
                        helperText.style.display = 'block';
                        helperText.textContent = "Click to change";
                    }

                    // Abilita pulsanti
                    if (createBtn) { createBtn.disabled = false; createBtn.style.opacity = '1'; createBtn.style.cursor = 'pointer'; }
                    if (joinBtn) { joinBtn.disabled = false; joinBtn.style.opacity = '1'; joinBtn.style.cursor = 'pointer'; }
                    if (linkJoinBtn) { linkJoinBtn.disabled = false; linkJoinBtn.style.opacity = '1'; linkJoinBtn.style.cursor = 'pointer'; }
                });
            }
            circle.appendChild(colorDiv);
            item.appendChild(circle);
            colorList.appendChild(item);
        });
    }

    // =========================================================
    // 5. GESTIONE AZIONI (FIX REDIRECT)
    // =========================================================

    async function handleAction(endpoint, bodyData, targetLobbyId = null) {
        const color = bodyData.color;
        if (!color) { showToast("Select a color first!"); return; }

        if (createBtn) createBtn.disabled = true;
        if (joinBtn) joinBtn.disabled = true;
        if (linkJoinBtn) { linkJoinBtn.disabled = true; linkJoinBtn.textContent = "Processing..."; }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyData)
            });

            if (response.ok) {
                const data = await response.json();

                // --- FIX CRITICO PER IL RIMBALZO ---
                let finalLobbyId = targetLobbyId;

                // Se è una creazione, estraiamo l'ID dal redirect del server
                if (!finalLobbyId && data.redirect) {
                    const match = data.redirect.match(/lobby=([^&]+)/);
                    if (match && match[1]) {
                        finalLobbyId = match[1];
                    }
                }

                if (finalLobbyId) {
                    // Costruiamo l'URL pulito codificando il colore
                    const cleanUrl = `/lobby.html?lobby=${finalLobbyId}&color=${encodeURIComponent(color)}`;
                    console.log("Redirect sicuro:", cleanUrl);
                    window.location.href = cleanUrl;
                } else {
                    // Fallback estremo (potrebbe fallire se il colore ha #)
                    window.location.href = data.redirect;
                }

            } else {
                const err = await response.json();
                if (err.error && err.error.includes('taken')) {
                    showToast("Colore già preso! Aggiorno la lista.");
                    if (targetLobbyId) await fetchTakenColors(targetLobbyId);

                    // Reset
                    selectedAvatarColor.style.backgroundColor = 'transparent';
                    selectedAvatarColor.style.border = '2px dashed #ccc';
                    hiddenInput.value = '';
                    if (helperText) helperText.textContent = "Click to select";
                } else {
                    showToast(err.error || "Errore sconosciuto");
                }

                // Ripristina tasti
                if (createBtn) createBtn.disabled = false;
                if (joinBtn) joinBtn.disabled = false;
                if (linkJoinBtn) { linkJoinBtn.disabled = false; linkJoinBtn.textContent = "JOIN LOBBY"; }
            }
        } catch (error) {
            console.error(error);
            showToast("Errore di connessione");
            if (createBtn) createBtn.disabled = false;
            if (joinBtn) joinBtn.disabled = false;
            if (linkJoinBtn) linkJoinBtn.disabled = false;
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

    // --- LISTENER CLICK ---

    if (createBtn) {
        createBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleAction('/create-lobby', { color: hiddenInput.value });
        });
    }

    if (joinBtn) {
        joinBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const id = lobbyInput.value.trim();
            if (!id) { showToast("Inserisci il codice!"); return; }
            handleAction('/join-lobby', { color: hiddenInput.value, lobbyId: id }, id);
        });
    }

    if (linkJoinBtn) {
        linkJoinBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleAction('/join-lobby', { color: hiddenInput.value, lobbyId: urlJoinId }, urlJoinId);
        });
    }

    // Chiudi lista se clicco fuori
    document.addEventListener('click', (e) => {
        if (!avatarBox.contains(e.target)) {
            const existingBox = document.querySelector('.change-color-box');
            if (existingBox) {
                existingBox.remove();
                avatarCircleMain.style.display = 'flex';
                if (helperText) helperText.style.display = 'block';
            }
        }
    });
}); */



// frontend/index.js

// frontend/index.js

// frontend/index.js

document.addEventListener('DOMContentLoaded', async () => {
    // =========================================================
    // 1. ELEMENTI DOM
    // =========================================================
    const colorPickerContainer = document.getElementById('color-picker');
    const hiddenInput = document.getElementById('hiddenInputForColorSelection');

    const createBtn = document.getElementById('create-btn');
    const joinBtn = document.getElementById('join-btn');
    const linkJoinBtn = document.getElementById('link-join-btn');
    const lobbyInput = document.getElementById('lobby-id-input');

    const defaultActions = document.getElementById('default-actions');
    const linkJoinActions = document.getElementById('link-join-actions');
    const joinLinkMsg = document.getElementById('join-link-msg');

    // Palette: Primi 6 Gartic Style + i 6 colori scelti da te, armonizzati
    const availableColors = [
        '#E74C3C', // Rosso
        '#3498DB', // Blu
        '#2ECC71', // Verde
        '#F1C40F', // Giallo
        '#9B59B6', // Viola
        '#E67E22', // Arancione
        '#00BCD4', // Ciano (Sostituisce #00CED1)
        '#FF4081', // Fucsia/Rosa acceso (Sostituisce #FF1493)
        '#795548', // Marrone Flat (Sostituisce #8B4513)
        '#CDDC39', // Lime/Verde Acido (Sostituisce #7FFF00)
        '#4B0082', // Indaco Intenso (Sostituisce #4B0082)
        '#455A64'  // Grigio Antracite (Sostituisce #36454F)
    ];

    let takenColors = [];
    let urlJoinId = new URLSearchParams(window.location.search).get('join');

    // =========================================================
    // 2. LOGICA COLORI E FETCH DATI
    // =========================================================

    async function fetchTakenColors(targetId) {
        if (!targetId) return;
        try {
            const response = await fetch(`/api/lobby-colors/${targetId}`);
            if (response.ok) {
                const data = await response.json();
                takenColors = (data.takenColors || []).map(c => c.toUpperCase());
            }
        } catch (e) {
            console.error("Error fetching colors:", e);
        }
    }

    function renderColors() {
        colorPickerContainer.innerHTML = '';

        availableColors.forEach(colorHex => {
            const color = colorHex.toUpperCase();
            const circle = document.createElement('div');
            circle.className = 'color-circle';
            circle.style.backgroundColor = color;

            if (takenColors.includes(color)) {
                circle.classList.add('disabled');
                circle.title = "Already taken";
            } else {
                circle.addEventListener('click', () => {
                    document.querySelectorAll('.color-circle').forEach(el => el.classList.remove('active'));

                    circle.classList.add('active');
                    hiddenInput.value = color;

                    if (createBtn) createBtn.disabled = false;
                    if (joinBtn) joinBtn.disabled = false;
                    if (linkJoinBtn) linkJoinBtn.disabled = false;
                });
            }
            colorPickerContainer.appendChild(circle);
        });
    }

    // =========================================================
    // 3. STATO INIZIALE E EVENT LISTENERS
    // =========================================================

    if (urlJoinId) {
        if (defaultActions) defaultActions.style.display = 'none';
        if (linkJoinActions) linkJoinActions.style.display = 'flex';
        if (joinLinkMsg) joinLinkMsg.textContent = `Room: ${urlJoinId.toUpperCase()}`;

        document.body.style.cursor = 'wait';
        await fetchTakenColors(urlJoinId);
        document.body.style.cursor = 'default';
    } else {
        if (defaultActions) defaultActions.style.display = 'block';
        if (linkJoinActions) linkJoinActions.style.display = 'none';
    }

    renderColors();

    if (lobbyInput) {
        lobbyInput.addEventListener('blur', async () => {
            const val = lobbyInput.value.trim();
            if (val.length > 0) {
                await fetchTakenColors(val);
                renderColors();

                if (takenColors.includes(hiddenInput.value)) {
                    hiddenInput.value = '';
                    if (createBtn) createBtn.disabled = true;
                    if (joinBtn) joinBtn.disabled = true;
                }
            }
        });

        lobbyInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (!joinBtn.disabled) joinBtn.click();
            }
        });
    }

    // =========================================================
    // 4. GESTIONE INVIO (CREATE / JOIN)
    // =========================================================

    async function handleAction(endpoint, bodyData, targetLobbyId = null) {
        const color = bodyData.color;
        if (!color) { showToast("Select a color first!", "error"); return; }

        if (createBtn) createBtn.disabled = true;
        if (joinBtn) joinBtn.disabled = true;
        if (linkJoinBtn) { linkJoinBtn.disabled = true; linkJoinBtn.textContent = "PROCESSING..."; }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyData)
            });

            if (response.ok) {
                const data = await response.json();
                let finalLobbyId = targetLobbyId;

                if (!finalLobbyId && data.redirect) {
                    const match = data.redirect.match(/lobby=([^&]+)/);
                    if (match && match[1]) {
                        finalLobbyId = match[1];
                    }
                }

                if (finalLobbyId) {
                    const cleanUrl = `/lobby.html?lobby=${finalLobbyId}&color=${encodeURIComponent(color)}`;
                    window.location.href = cleanUrl;
                } else {
                    window.location.href = data.redirect;
                }

            } else {
                const err = await response.json();
                if (err.error && err.error.includes('taken')) {
                    showToast("Color already taken! Updating list.", "error");
                    if (targetLobbyId) {
                        await fetchTakenColors(targetLobbyId);
                        renderColors();
                    }
                    hiddenInput.value = '';
                } else {
                    showToast(err.error || "Unknown error", "error");
                }

                if (createBtn && hiddenInput.value) createBtn.disabled = false;
                if (joinBtn && hiddenInput.value) joinBtn.disabled = false;
                if (linkJoinBtn && hiddenInput.value) { linkJoinBtn.disabled = false; linkJoinBtn.textContent = "JOIN LOBBY"; }
            }
        } catch (error) {
            console.error(error);
            showToast("Server connection error", "error");
            if (createBtn && hiddenInput.value) createBtn.disabled = false;
            if (joinBtn && hiddenInput.value) joinBtn.disabled = false;
            if (linkJoinBtn && hiddenInput.value) linkJoinBtn.disabled = false;
        }
    }

    if (createBtn) {
        createBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleAction('/create-lobby', { color: hiddenInput.value });
        });
    }

    if (joinBtn) {
        joinBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const id = lobbyInput.value.trim();
            if (!id) { showToast("Enter the room code!", "error"); return; }
            handleAction('/join-lobby', { color: hiddenInput.value, lobbyId: id }, id);
        });
    }

    if (linkJoinBtn) {
        linkJoinBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleAction('/join-lobby', { color: hiddenInput.value, lobbyId: urlJoinId }, urlJoinId);
        });
    }

    // =========================================================
    // 5. HELPER NOTIFICHE TOAST
    // =========================================================
    function showToast(message, type = 'info') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = '';
        if (type === 'error') icon = '⚠️';
        if (type === 'success') icon = '✅';
        if (type === 'info') icon = 'ℹ️';

        toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s forwards';
            toast.addEventListener('animationend', () => {
                toast.remove();
            });
        }, 3000);
    }
});