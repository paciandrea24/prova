document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM Caricato. Script avviato.");

    // =========================================================
    // 1. GESTIONE TEMA (Light / Dark)
    // =========================================================
    const themeBtn = document.getElementById('theme-toggle-btn');
    const body = document.body;
    const savedTheme = localStorage.getItem('quiz-theme');

    // Applica tema salvato
    if (savedTheme === 'dark') {
        body.classList.add('theme-dark');
        if (themeBtn) themeBtn.textContent = '☀️ Stile Light';
    } else {
        if (themeBtn) themeBtn.textContent = '🌘 Stile Dark';
    }

    // Toggle al click
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
    // 2. ELEMENTI DOM E STATO
    // =========================================================
    // Elementi Avatar
    const avatarBox = document.querySelector('.avatar-box');
    const avatarCircleMain = document.querySelector('.avatar-box .avatar-circle'); // Cerchio principale
    const selectedAvatarColor = document.querySelector('.avatar-color'); // Colore dentro il cerchio
    const helperText = document.querySelector('.helper-text');
    const hiddenInput = document.querySelector('#hiddenInputForColorSelection');

    // Pulsanti e Input
    const defaultActions = document.getElementById('default-actions');
    const linkJoinActions = document.getElementById('link-join-actions');

    const createBtn = document.getElementById('create-btn');
    const joinBtn = document.getElementById('join-btn');
    const linkJoinBtn = document.getElementById('link-join-btn');
    const lobbyInput = document.getElementById('lobby-id-input');
    const joinLinkMsg = document.getElementById('join-link-msg');

    // Variabili di stato
    let urlJoinId = new URLSearchParams(window.location.search).get('join');
    let takenColors = [];

    // =========================================================
    // 3. INIZIALIZZAZIONE UI
    // =========================================================
    selectedAvatarColor.style.backgroundColor = 'transparent';
    selectedAvatarColor.style.border = '2px dashed #ccc';
    hiddenInput.value = '';

    // Disabilita tutto all'inizio (finché non si sceglie colore)
    if (createBtn) createBtn.disabled = true;
    if (joinBtn) joinBtn.disabled = true;
    if (linkJoinBtn) linkJoinBtn.disabled = true;

    // --- HELPER: Aggiorna colori occupati dal server ---
    async function fetchTakenColors(targetId) {
        if (!targetId) return;
        try {
            const response = await fetch(`/api/lobby-colors/${targetId}`);
            if (response.ok) {
                const data = await response.json();
                // Normalizziamo in maiuscolo
                takenColors = (data.takenColors || []).map(c => c.toUpperCase());
                console.log(`Colori già presi in ${targetId}:`, takenColors);
            }
        } catch (e) {
            console.error("Errore fetch colori:", e);
        }
    }

    // --- SETUP INIZIALE (Join vs Create) ---
    if (urlJoinId) {
        // MODALITÀ "INVITO" (Arrivato da link)
        if (defaultActions) defaultActions.style.display = 'none';
        if (linkJoinActions) linkJoinActions.style.display = 'flex';

        if (joinLinkMsg) joinLinkMsg.textContent = `Joining Lobby: ${urlJoinId}`;

        // Carica i colori presi per questa lobby
        await fetchTakenColors(urlJoinId);
    } else {
        // MODALITÀ "NORMALE" (Home)
        if (defaultActions) defaultActions.style.display = 'flex';
        if (linkJoinActions) linkJoinActions.style.display = 'none';
    }

    // Listener sull'input manuale per aggiornare i colori quando scrivi un codice
    if (lobbyInput) {
        lobbyInput.addEventListener('blur', async () => {
            const val = lobbyInput.value.trim();
            if (val.length > 0) {
                await fetchTakenColors(val);
            }
        });
    }

    // =========================================================
    // 4. GESTIONE SELEZIONE COLORE (INTERAZIONE INLINE)
    // =========================================================
    const availableColors = ['#DC143C', '#4169E1', '#50C878', '#FFD700', '#9966CC', '#36454F'];

    // Clicco sul cerchio principale -> Nascondo cerchio, mostro lista
    avatarCircleMain.addEventListener("click", async (e) => {
        e.preventDefault();

        // Se c'è un ID manuale o URL, aggiorna i colori prima di mostrare la lista
        const manualId = lobbyInput ? lobbyInput.value.trim() : "";
        const targetId = urlJoinId || manualId;

        if (targetId) {
            document.body.style.cursor = 'wait';
            await fetchTakenColors(targetId);
            document.body.style.cursor = 'default';
        }

        // 1. Nascondi interfaccia attuale
        avatarCircleMain.classList.add('hidden');
        if (helperText) helperText.classList.add('hidden');

        // 2. Crea e mostra la lista colori al suo posto
        const changeColorBox = showChangeColorBox();
        showColorOptions(changeColorBox);
    });

    // Crea il contenitore della lista
    function showChangeColorBox() {
        // Rimuovi se esiste già per sicurezza
        const existing = document.querySelector('.change-color-box');
        if (existing) existing.remove();

        const changeColorBox = document.createElement('div');
        changeColorBox.className = 'change-color-box'; // Stile definito nel CSS (statico)
        avatarBox.appendChild(changeColorBox);
        return changeColorBox;
    }

    // Genera i pallini colorati
    function showColorOptions(changeColorBox) {
        const colorList = document.createElement('ul');
        colorList.className = 'color-list';
        changeColorBox.appendChild(colorList);

        availableColors.forEach((colorHex) => {
            const color = colorHex.toUpperCase();

            const item = document.createElement('li');
            const circle = document.createElement('div');
            circle.className = 'avatar-circle';
            // Nota: dimensioni gestite dal CSS (.color-list .avatar-circle)

            const colorDiv = document.createElement('div');
            colorDiv.className = 'avatar-color';
            colorDiv.style.backgroundColor = color;

            // Logica disabilitazione
            if (takenColors.includes(color)) {
                colorDiv.classList.add('disabled');
                colorDiv.title = "Colore già preso!";
            } else {
                // Click su un colore disponibile
                colorDiv.addEventListener('click', ev => {
                    ev.stopPropagation();

                    // A. Aggiorna stato
                    selectedAvatarColor.style.backgroundColor = color;
                    selectedAvatarColor.style.border = 'none';
                    hiddenInput.value = color;

                    // B. RIPRISTINA INTERFACCIA
                    // Rimuovi la lista
                    changeColorBox.remove();
                    // Mostra di nuovo il cerchio principale (ora colorato)
                    avatarCircleMain.classList.remove('hidden');

                    if (helperText) {
                        helperText.classList.remove('hidden');
                        helperText.textContent = "Click to change"; // Feedback
                    }

                    // C. Abilita pulsanti
                    if (createBtn) createBtn.disabled = false;
                    if (joinBtn) joinBtn.disabled = false;
                    if (linkJoinBtn) linkJoinBtn.disabled = false;
                });
            }
            circle.appendChild(colorDiv);
            item.appendChild(circle);
            colorList.appendChild(item);
        });
    }


    // =========================================================
    // 5. GESTIONE AZIONI (CREATE / JOIN)
    // =========================================================

    // Funzione Unica per gestire la chiamata al server e il redirect
    async function handleAction(endpoint, bodyData, targetLobbyId = null) {
        const color = bodyData.color;
        if (!color) { alert("Select a color first!"); return; }

        // Blocca UI durante il caricamento
        if (createBtn) createBtn.disabled = true;
        if (joinBtn) joinBtn.disabled = true;
        if (linkJoinBtn) {
            linkJoinBtn.disabled = true;
            linkJoinBtn.textContent = "Processing...";
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyData)
            });

            if (response.ok) {
                const data = await response.json();

                // --- GESTIONE REDIRECT SICURO ---
                let redirectUrl = "";

                if (data.redirect) {
                    // Create Lobby: estrai ID pulito
                    const match = data.redirect.match(/lobby=([^&]+)/);
                    if (match && match[1]) {
                        const newId = match[1];
                        redirectUrl = `/lobby.html?lobby=${newId}`;
                    } else {
                        redirectUrl = data.redirect.split('&')[0];
                    }
                } else if (targetLobbyId) {
                    // Join Manuale
                    redirectUrl = `/lobby.html?lobby=${targetLobbyId}`;
                }

                // Aggiungi colore codificato (Fix hash #)
                if (redirectUrl) {
                    const sep = redirectUrl.includes('?') ? '&' : '?';
                    redirectUrl += `${sep}color=${encodeURIComponent(color)}`;
                    window.location.href = redirectUrl;
                }

            } else {
                // Gestione Errori (es. Colore Preso)
                const err = await response.json();
                if (err.error && err.error.includes('taken')) {
                    alert("Colore occupato! La lista verrà aggiornata.");
                    if (targetLobbyId) await fetchTakenColors(targetLobbyId);

                    // Resetta la selezione
                    selectedAvatarColor.style.backgroundColor = 'transparent';
                    selectedAvatarColor.style.border = '2px dashed #ccc';
                    hiddenInput.value = '';
                    if (helperText) helperText.textContent = "Click to select";
                } else {
                    alert(err.error || "Errore sconosciuto");
                }

                // Ripristina bottoni
                if (createBtn) createBtn.disabled = false;
                if (joinBtn) joinBtn.disabled = false;
                if (linkJoinBtn) {
                    linkJoinBtn.disabled = false;
                    linkJoinBtn.textContent = "Join Lobby";
                }
            }
        } catch (error) {
            console.error(error);
            alert("Errore di connessione");
            if (createBtn) createBtn.disabled = false;
            if (joinBtn) joinBtn.disabled = false;
            if (linkJoinBtn) linkJoinBtn.disabled = false;
        }
    }

    // --- LISTENER SUI PULSANTI ---

    // 1. Tasto CREA
    if (createBtn) {
        createBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleAction('/create-lobby', { color: hiddenInput.value });
        });
    }

    // 2. Tasto JOIN (Manuale da Input)
    if (joinBtn) {
        joinBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const id = lobbyInput.value.trim();
            if (!id) { alert("Please enter a Lobby Code!"); return; }
            handleAction('/join-lobby', { color: hiddenInput.value, lobbyId: id }, id);
        });
    }

    // 3. Tasto JOIN (Da Link)
    if (linkJoinBtn) {
        linkJoinBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleAction('/join-lobby', { color: hiddenInput.value, lobbyId: urlJoinId }, urlJoinId);
        });
    }
});