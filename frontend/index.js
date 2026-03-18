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

    // Elementi Modal
    const browseBtn = document.getElementById('browse-btn');
    const modal = document.getElementById('lobbies-modal');
    const closeModal = document.getElementById('close-modal');
    const lobbiesList = document.getElementById('lobbies-list');

    // Palette Colori
    const availableColors = [
        '#E74C3C', '#3498DB', '#2ECC71', '#F1C40F',
        '#9B59B6', '#E67E22', '#00BCD4', '#FF4081',
        '#795548', '#CDDC39', '#4B0082', '#455A64'
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
        if (colorPickerContainer.children.length === 0) {
            availableColors.forEach(colorHex => {
                const color = colorHex.toUpperCase();
                const circle = document.createElement('div');
                circle.className = 'color-circle';
                circle.style.backgroundColor = color;
                circle.dataset.color = color;

                circle.addEventListener('click', () => {
                    if (circle.classList.contains('disabled')) return;

                    document.querySelectorAll('.color-circle').forEach(el => el.classList.remove('active'));
                    circle.classList.add('active');
                    hiddenInput.value = color;

                    if (createBtn) createBtn.disabled = false;
                    if (joinBtn) joinBtn.disabled = false;
                    if (linkJoinBtn) linkJoinBtn.disabled = false;
                });

                colorPickerContainer.appendChild(circle);
            });
        }

        const circles = colorPickerContainer.querySelectorAll('.color-circle');
        circles.forEach(circle => {
            const color = circle.dataset.color;

            if (takenColors.includes(color)) {
                circle.classList.add('disabled');
                circle.title = "Already taken";
                circle.classList.remove('active');

                if (hiddenInput.value === color) {
                    hiddenInput.value = '';
                    if (createBtn) createBtn.disabled = true;
                    if (joinBtn) joinBtn.disabled = true;
                }
            } else {
                circle.classList.remove('disabled');
                circle.title = "";

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
    // 4. GESTIONE MODAL BROWSE LOBBIES
    // =========================================================
    if (browseBtn && modal) {
        browseBtn.addEventListener('click', async () => {
            modal.style.display = 'flex';
            lobbiesList.innerHTML = '<p style="font-weight:bold; color:var(--blue);">Loading lobbies...</p>';

            try {
                const res = await fetch('/api/lobbies');
                const data = await res.json();

                lobbiesList.innerHTML = ''; // Pulisci il caricamento

                if (data.length === 0) {
                    lobbiesList.innerHTML = '<p style="font-weight:bold; color:var(--red);">No active lobbies found.<br>Create one!</p>';
                    return;
                }

                // Genera la lista
                data.forEach(lobby => {
                    const div = document.createElement('div');
                    div.className = 'lobby-item';
                    div.innerHTML = `<span>Room: ${lobby.id}</span> <span>👥 ${lobby.playersCount}</span>`;

                    div.addEventListener('click', async () => {
                        lobbyInput.value = lobby.id; // Compila l'input in automatico
                        modal.style.display = 'none'; // Chiudi il modal

                        await fetchTakenColors(lobby.id);
                        renderColors();

                        if (takenColors.includes(hiddenInput.value)) {
                            hiddenInput.value = '';
                            if (joinBtn) joinBtn.disabled = true;
                            showToast("Your color is taken in this room! Pick another.", "info");
                        } else {
                            showToast(`Room ${lobby.id} selected!`, "success");
                            if (hiddenInput.value && joinBtn) joinBtn.disabled = false;
                        }
                    });

                    lobbiesList.appendChild(div);
                });
            } catch (e) {
                console.error("Error fetching lobbies:", e);
                lobbiesList.innerHTML = '<p style="color:var(--red);">Error loading lobbies.</p>';
            }
        });

        closeModal.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }

    // =========================================================
    // 5. GESTIONE INVIO (CREATE / JOIN)
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
    // 6. HELPER NOTIFICHE TOAST
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