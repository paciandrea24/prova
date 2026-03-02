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
                const x = col * tileSize;
                const y = row * tileSize;

                if (tile === 0) {
                    // Sfondo Erba
                    ctx.fillStyle = '#27ae60';
                    ctx.fillRect(x, y, tileSize, tileSize);

                    // --- GENERATORE DI NATURA PROCEDURALE ---
                    // Creiamo un numero "casuale ma fisso" basato sulle coordinate
                    const rand = (row * 37 + col * 13) % 100;

                    ctx.font = `${tileSize * 0.65}px Arial`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    const centerX = x + tileSize / 2;
                    const centerY = y + tileSize / 2 + 2;

                    // Decidiamo cosa piantare in base al numero generato!
                    if (rand < 10) {
                        ctx.fillText('🌲', centerX, centerY); // 10% di probabilità
                    } else if (rand < 18) {
                        ctx.fillText('🌳', centerX, centerY); // 8% di probabilità
                    } else if (rand < 25) {
                        ctx.fillText('🌿', centerX, centerY); // 7% di cespugli
                    } else if (rand === 50) {
                        ctx.fillText('🌼', centerX, centerY); // Qualche fiorellino raro
                    }

                } else if (tile === 1) {
                    // Asfalto liscio
                    ctx.fillStyle = '#7f8c8d';
                    ctx.fillRect(x, y, tileSize, tileSize);

                } else if (tile === 2) {
                    // Traguardo a scacchi!
                    ctx.fillStyle = (col + row) % 2 === 0 ? '#ffffff' : '#000000';
                    ctx.fillRect(x, y, tileSize, tileSize);

                } else if (tile === 3 || tile === 6) {
                    // AGGIUNTO || tile === 6
                    // Checkpoint stile cordolo (Giallo e Nero)
                    ctx.fillStyle = (col + row) % 2 === 0 ? '#f1c40f' : '#2c3e50';
                    ctx.fillRect(x, y, tileSize, tileSize);
                }
            }
        }

        // Crea le macchinine (Senza impostare left, top o transform!)
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

    // --- MOTORE GRAFICO FRONTEND (LERP) ---
    let serverState = {};       // Qui salviamo i dati grezzi che arrivano dal server
    let visualState = {};       // Qui salviamo le posizioni morbide per lo schermo

    // 1. Quando il server manda un aggiornamento, NON muoviamo il DOM, 
    // aggiorniamo solo i nostri "bersagli" (target)
    socket.on('racingStateUpdate', (playersState) => {
        serverState = playersState;

        // Inizializza gli stati visivi se è la prima volta che vediamo l'auto
        for (const color in playersState) {
            if (!visualState[color]) {
                visualState[color] = {
                    x: playersState[color].x,
                    y: playersState[color].y,
                    angle: playersState[color].angle
                };
            }
        }
    });

    // 2. Il Render Loop super fluido a 60/144Hz (dipende dal monitor)
    function renderLoop() {
        for (const [color, target] of Object.entries(serverState)) {
            if (!visualState[color]) continue;

            const visual = visualState[color];

            // FORMULA LERP: Avvicina la posizione attuale al bersaglio del 30% ad ogni frame.
            // Questo crea un movimento fluido come il burro e nasconde il lag!
            visual.x += (target.x - visual.x) * 0.3;
            visual.y += (target.y - visual.y) * 0.3;

            // Calcolo intelligente per la rotazione (evita che l'auto giri su se stessa al contrario)
            let angleDiff = target.angle - visual.angle;
            while (angleDiff < -180) angleDiff += 360;
            while (angleDiff > 180) angleDiff -= 360;
            visual.angle += angleDiff * 0.3;

            // Ora applichiamo la posizione fluida al DOM
            const carEl = document.getElementById(`car-${color.replace('#', '')}`);
            if (carEl) {
                carEl.style.transform = `translate(${visual.x}px, ${visual.y}px) rotate(${visual.angle}deg)`;

                const label = carEl.querySelector('.player-label');
                if (label) label.style.transform = `rotate(${-visual.angle}deg)`;

                if (target.finished) carEl.style.opacity = '0.5';

                // LA TELECAMERA SCORREVOLE
                if (color === myColor) {
                    const viewport = document.getElementById('camera-viewport');
                    if (viewport) {
                        const vWidth = viewport.clientWidth;
                        const vHeight = viewport.clientHeight;
                        // Usa la posizione "visual" per la telecamera, non il target!
                        const cameraX = -(visual.x + 30 - vWidth / 2);
                        const cameraY = -(visual.y + 15 - vHeight / 2);
                        arena.style.transform = `translate(${cameraX}px, ${cameraY}px)`;
                    }
                }
            }
        }

        // Richiama se stesso al prossimo frame del monitor
        requestAnimationFrame(renderLoop);
    }

    // Fai partire il motore grafico del frontend
    requestAnimationFrame(renderLoop);

    socket.on('raceStarted', () => {
        isRacing = true;
    });


    socket.on('raceEnded', (data) => {
        isRacing = false;

        const modal = document.getElementById('podium-modal');
        const list = document.getElementById('podium-list');
        list.innerHTML = '';

        // Costruiamo la classifica F1
        data.podium.forEach((entry, index) => {
            const color = entry.color;
            const timeMs = entry.time;

            // Formatta il tempo in M:SS.mmm
            const mins = Math.floor(timeMs / 60000);
            const secs = Math.floor((timeMs % 60000) / 1000);
            const ms = timeMs % 1000;
            const formattedTime = `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;

            // Calcola il distacco dal PRIMO classificato (Gap)
            let gapText = '';
            if (index === 0) {
                gapText = 'VINCITORE';
            } else {
                const gapMs = timeMs - data.podium[0].time;
                const gapSecs = Math.floor(gapMs / 1000);
                const gapMillis = gapMs % 1000;
                gapText = `+${gapSecs}.${gapMillis.toString().padStart(3, '0')}`;
            }

            // Crea la riga della classifica
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.padding = '10px 5px';
            li.style.borderBottom = '1px solid #555';
            li.style.fontSize = '20px';

            li.innerHTML = `
                <div style="display: flex; align-items: center; gap: 15px;">
                    <span style="font-weight: 900; width: 30px; color: ${index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? '#cd7f32' : 'white'};">${index + 1}°</span>
                    <span style="display: inline-block; width: 24px; height: 24px; background-color: ${color}; border-radius: 50%; border: 2px solid white;"></span>
                    <span style="font-size: 14px; font-weight: bold;">${color === myColor ? '(TU)' : ''}</span>
                </div>
                <div style="font-family: monospace; text-align: right;">
                    <div style="font-weight: bold;">${formattedTime}</div>
                    <div style="font-size: 14px; color: #e74c3c;">${gapText}</div>
                </div>
            `;
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