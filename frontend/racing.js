document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const myColor = urlParams.get('color');

    if (!lobbyId || !myColor) {
        window.location.href = '/';
        return;
    }

    const socket = io();
    socket.emit('joinLobby', lobbyId);
    socket.emit('joinRacing', { lobbyId, playerColor: decodeURIComponent(myColor) });

    const arena = document.getElementById('arena');
    const statusText = document.getElementById('status-text');
    let isRacing = false;

    // Stato locale degli input per non spammare il server inutilmente
    const inputs = { w: false, a: false, s: false, d: false };

    // Costruisce l'arena
    // Costruisce l'arena
    socket.on('racingSetup', (data) => {
        arena.style.width = data.trackWidth + 'px';
        arena.style.height = data.trackHeight + 'px';

        const finishLine = document.getElementById('finish-line');
        finishLine.style.left = data.finishLineX + 'px';

        // Crea i DOM elements per le macchine
        for (const [color, state] of Object.entries(data.playersState)) {
            const car = document.createElement('div');
            car.className = 'car';
            car.id = `car-${color.replace('#', '')}`;
            car.style.left = state.x + 'px';
            car.style.top = state.y + 'px';
            car.style.transform = `rotate(${state.angle || 0}deg)`;

            if (color === myColor) {
                car.classList.add('my-car');
            }

            // --- COSTRUZIONE DELLA FORMULA 1 IN CSS ---
            car.innerHTML = `
                <div class="player-label">${color === myColor ? 'TU' : ''}</div>
                
                <div class="f1-spoiler-rear" style="background-color: ${color}"></div>
                
                <div class="f1-tire tire-rl"></div>
                <div class="f1-tire tire-fl"></div>
                <div class="f1-tire tire-rr"></div>
                <div class="f1-tire tire-fr"></div>
                
                <div class="f1-body" style="background-color: ${color}">
                    <div class="f1-cockpit"></div>
                </div>
                
                <div class="f1-spoiler-front" style="background-color: ${color}"></div>
            `;

            arena.appendChild(car);
        }
    });

    socket.on('raceStarted', () => {
        isRacing = true;
        statusText.textContent = "GARA INIZIATA! MUOVITI!";
        statusText.style.color = "#2ecc71";
    });

    // Aggiornamento continuo delle posizioni 30 volte al sec
    socket.on('racingStateUpdate', (playersState) => {
        for (const [color, state] of Object.entries(playersState)) {
            const carEl = document.getElementById(`car-${color.replace('#', '')}`);
            if (carEl) {
                carEl.style.left = state.x + 'px';
                carEl.style.top = state.y + 'px';

                // --- NUOVO: ROTAZIONE DELLA MACCHINA ---
                carEl.style.transform = `rotate(${state.angle}deg)`;

                // Contro-rotazione per mantenere il testo "TU" dritto
                const label = carEl.querySelector('.player-label');
                if (label) {
                    label.style.transform = `rotate(${-state.angle}deg)`;
                }
                // ----------------------------------------

                if (state.finished) {
                    carEl.style.opacity = '0.5';
                }
            }
        }
    });

    socket.on('raceEnded', (data) => {
        isRacing = false;
        statusText.textContent = "GARA TERMINATA!";

        const modal = document.getElementById('podium-modal');
        const list = document.getElementById('podium-list');
        list.innerHTML = '';

        data.podium.forEach((color, index) => {
            const li = document.createElement('li');
            li.innerHTML = `<span style="display:inline-block; width:20px; height:20px; background-color:${color}; border-radius:50%;"></span> Posto ${index + 1}`;
            list.appendChild(li);
        });

        modal.style.display = 'block';
    });

    socket.on('returnToLobby', () => {
        window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(myColor)}`;
    });

    // --- GESTIONE INPUT (W A S D) ---
    function sendInputs() {
        if (isRacing) {
            socket.emit('racingInput', { lobbyId, playerColor: myColor, inputs });
        }
    }

    document.addEventListener('keydown', (e) => {
        if (!isRacing) return;
        let changed = false;
        const key = e.key.toLowerCase();

        if (key === 'w' && !inputs.w) { inputs.w = true; changed = true; }
        if (key === 'a' && !inputs.a) { inputs.a = true; changed = true; }
        if (key === 's' && !inputs.s) { inputs.s = true; changed = true; }
        if (key === 'd' && !inputs.d) { inputs.d = true; changed = true; }

        if (changed) sendInputs();
    });

    document.addEventListener('keyup', (e) => {
        if (!isRacing) return;
        let changed = false;
        const key = e.key.toLowerCase();

        if (key === 'w') { inputs.w = false; changed = true; }
        if (key === 'a') { inputs.a = false; changed = true; }
        if (key === 's') { inputs.s = false; changed = true; }
        if (key === 'd') { inputs.d = false; changed = true; }

        if (changed) sendInputs();
    });
});