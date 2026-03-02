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
    let isRacing = false;

    // Stato locale degli input per non spammare il server inutilmente
    const inputs = { w: false, a: false, s: false, d: false };

    // Costruisce l'arena
    // Costruisce l'arena
    // Trova l'evento 'racingSetup' e cambialo così:
    socket.on('racingSetup', (data) => {
        const { trackMap, tileSize, playersState } = data;

        const trackWidth = trackMap[0].length * tileSize;
        const trackHeight = trackMap.length * tileSize;

        arena.style.width = trackWidth + 'px';
        arena.style.height = trackHeight + 'px';

        // Pulizia sicura immagine
        arena.style.backgroundImage = 'none';
        arena.style.transform = 'none'; // Via lo scale

        // Ripristino del Canvas!
        let canvas = document.getElementById('track-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'track-canvas';
            arena.appendChild(canvas);
        }
        canvas.width = trackWidth;
        canvas.height = trackHeight;

        const ctx = canvas.getContext('2d');
        for (let row = 0; row < trackMap.length; row++) {
            for (let col = 0; col < trackMap[row].length; col++) {
                const tile = trackMap[row][col];
                if (tile === 0) ctx.fillStyle = '#27ae60'; // Erba
                else if (tile === 1) ctx.fillStyle = '#7f8c8d'; // Asfalto
                else if (tile === 2) ctx.fillStyle = '#ecf0f1'; // Traguardo
                else if (tile === 3) ctx.fillStyle = '#f1c40f'; // Checkpoint
                ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
            }
        }

        // Crea le macchinine
        for (const [color, state] of Object.entries(playersState)) {
            let car = document.getElementById(`car-${color.replace('#', '')}`);
            if (!car) {
                car = document.createElement('div');
                car.className = 'car';
                car.id = `car-${color.replace('#', '')}`;

                if (color === myColor) car.classList.add('my-car');

                car.innerHTML = `
                    <div class="player-label">${color === myColor ? 'TU' : ''}</div>
                    <div class="f1-spoiler-rear" style="background-color: ${color}"></div>
                    <div class="f1-tire tire-rl"></div><div class="f1-tire tire-fl"></div>
                    <div class="f1-tire tire-rr"></div><div class="f1-tire tire-fr"></div>
                    <div class="f1-body" style="background-color: ${color}">
                        <div class="f1-cockpit"></div>
                    </div>
                    <div class="f1-spoiler-front" style="background-color: ${color}"></div>
                `;
                arena.appendChild(car);
            }
        }
    });

    socket.on('racingStateUpdate', (playersState) => {
        for (const [color, state] of Object.entries(playersState)) {
            const carEl = document.getElementById(`car-${color.replace('#', '')}`);
            if (carEl) {
                carEl.style.left = state.x + 'px';
                carEl.style.top = state.y + 'px';
                carEl.style.transform = `rotate(${state.angle}deg)`;

                const label = carEl.querySelector('.player-label');
                if (label) label.style.transform = `rotate(${-state.angle}deg)`;

                if (state.finished) carEl.style.opacity = '0.5';

                // LA VECCHIA TELECAMERA CENTRATA!
                if (color === myColor) {
                    const viewport = document.getElementById('camera-viewport');
                    if (viewport) {
                        const vWidth = viewport.clientWidth;
                        const vHeight = viewport.clientHeight;
                        const cameraX = -(state.x + 30 - vWidth / 2);
                        const cameraY = -(state.y + 15 - vHeight / 2);
                        arena.style.transform = `translate(${cameraX}px, ${cameraY}px)`;
                    }
                }
            }
        }
    });

    socket.on('raceStarted', () => {
        isRacing = true;
    });

    // Aggiornamento continuo delle posizioni 30 volte al sec
    socket.on('racingStateUpdate', (playersState) => {
        for (const [color, state] of Object.entries(playersState)) {
            const carEl = document.getElementById(`car-${color.replace('#', '')}`);
            if (carEl) {
                carEl.style.left = state.x + 'px';
                carEl.style.top = state.y + 'px';
                carEl.style.transform = `rotate(${state.angle}deg)`;

                const label = carEl.querySelector('.player-label');
                if (label) {
                    label.style.transform = `rotate(${-state.angle}deg)`;
                }

                if (state.finished) {
                    carEl.style.opacity = '0.5';
                }

                // HO RIMOSSO TUTTO IL BLOCCO "if (color === myColor) { ... }" DELLA TELECAMERA!
            }
        }
    });

    socket.on('raceEnded', (data) => {
        isRacing = false;

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