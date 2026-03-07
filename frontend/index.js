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
        // 1. CREIAMO I CERCHI SOLO SE NON ESISTONO ANCORA
        if (colorPickerContainer.children.length === 0) {
            availableColors.forEach(colorHex => {
                const color = colorHex.toUpperCase();
                const circle = document.createElement('div');
                circle.className = 'color-circle';
                circle.style.backgroundColor = color;
                circle.dataset.color = color; // Salviamo il colore nel nodo

                circle.addEventListener('click', () => {
                    // Ignora il click se il colore è occupato
                    if (circle.classList.contains('disabled')) return;

                    // Rimuovi 'active' da tutti e mettilo su quello cliccato
                    document.querySelectorAll('.color-circle').forEach(el => el.classList.remove('active'));
                    circle.classList.add('active');
                    hiddenInput.value = color;

                    // Accendi subito i bottoni!
                    if (createBtn) createBtn.disabled = false;
                    if (joinBtn) joinBtn.disabled = false;
                    if (linkJoinBtn) linkJoinBtn.disabled = false;
                });

                colorPickerContainer.appendChild(circle);
            });
        }

        // 2. AGGIORNIAMO LO STATO DEI COLORI (Senza distruggere l'HTML!)
        const circles = colorPickerContainer.querySelectorAll('.color-circle');
        circles.forEach(circle => {
            const color = circle.dataset.color;

            if (takenColors.includes(color)) {
                circle.classList.add('disabled');
                circle.title = "Already taken";
                circle.classList.remove('active');

                // Se l'utente aveva questo colore, resettiamo tutto
                if (hiddenInput.value === color) {
                    hiddenInput.value = '';
                    if (createBtn) createBtn.disabled = true;
                    if (joinBtn) joinBtn.disabled = true;
                }
            } else {
                circle.classList.remove('disabled');
                circle.title = "";

                // Mantieni acceso il colore se l'utente lo aveva già selezionato
                if (hiddenInput.value === color) {
                    circle.classList.add('active');
                    if (createBtn) createBtn.disabled = false;
                    if (joinBtn) joinBtn.disabled = false;
                    if (linkJoinBtn) linkJoinBtn.disabled = false;
                }
            }
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
            // FORZA IN MAIUSCOLO IL TESTO INSERITO
            lobbyInput.value = lobbyInput.value.toUpperCase();
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
            // FORZA IL MAIUSCOLO QUI PRIMA DELL'INVIO
            const id = lobbyInput.value.trim().toUpperCase();
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