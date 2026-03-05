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
    let hostColor = null;

    // Stato locale degli input per non spammare il server inutilmente
    const inputs = { w: false, a: false, s: false, d: false };

    // Costruisce l'arena
    socket.on('racingSetup', (data) => {
        const { trackMap, tileSize, playersState, trackName, hostColor: serverHostColor } = data;

        if (serverHostColor) hostColor = serverHostColor;

        // Chiudi il modal del podio se era aperto dalla gara precedente!
        document.getElementById('podium-modal').style.display = 'none';

        // Svuota il motore grafico altrimenti le auto "volano" dalla vecchia pista alla nuova
        visualState = {};

        const trackWidth = trackMap[0].length * tileSize;
        const trackHeight = trackMap.length * tileSize;

        arena.style.width = trackWidth + 'px';
        arena.style.height = trackHeight + 'px';
        arena.style.backgroundImage = 'none';
        arena.style.transform = 'none';

        // Elimina e ricrea il canvas per disegnare la nuova mappa
        let canvas = document.getElementById('track-canvas');
        if (canvas) canvas.remove();

        canvas = document.createElement('canvas');
        canvas.id = 'track-canvas';
        arena.appendChild(canvas);

        canvas.width = trackWidth;
        canvas.height = trackHeight;

        const ctx = canvas.getContext('2d');

        for (let row = 0; row < trackMap.length; row++) {
            for (let col = 0; col < trackMap[row].length; col++) {
                const tile = trackMap[row][col];
                const x = col * tileSize;
                const y = row * tileSize;

                if (tile === 0) {
                    ctx.fillStyle = '#27ae60';
                    ctx.fillRect(x, y, tileSize, tileSize);

                    const rand = (row * 37 + col * 13) % 100;
                    ctx.font = `${tileSize * 0.65}px Arial`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    const centerX = x + tileSize / 2;
                    const centerY = y + tileSize / 2 + 2;

                    if (rand < 10) ctx.fillText('🌲', centerX, centerY);
                    else if (rand < 18) ctx.fillText('🌳', centerX, centerY);
                    else if (rand < 25) ctx.fillText('🌿', centerX, centerY);
                    else if (rand === 50) ctx.fillText('🌼', centerX, centerY);

                } else if (tile === 1) {
                    ctx.fillStyle = '#7f8c8d';
                    ctx.fillRect(x, y, tileSize, tileSize);
                } else if (tile === 2) {
                    ctx.fillStyle = (col + row) % 2 === 0 ? '#ffffff' : '#000000';
                    ctx.fillRect(x, y, tileSize, tileSize);
                } else if (tile === 3 || tile === 6) {
                    ctx.fillStyle = (col + row) % 2 === 0 ? '#f1c40f' : '#2c3e50';
                    ctx.fillRect(x, y, tileSize, tileSize);
                }
            }
        }

        // Pulisci le macchine vecchie dal DOM prima di ricrearle
        document.querySelectorAll('.car').forEach(e => e.remove());

        // Creiamo le auto per la nuova mappa!
        for (const [color, state] of Object.entries(playersState)) {
            let car = document.createElement('div');
            car.className = 'car';
            car.id = `car-${color.replace('#', '')}`;
            if (color === myColor) car.classList.add('my-car');

            // Togliamo il '#' dal colore per usarlo come nome del file!
            const colorCode = color.replace('#', '');

            // Inseriamo l'etichetta del giocatore e l'immagine PNG
            car.innerHTML = `
                <div class="player-label">${color === myColor ? 'TU' : ''}</div>
                <img src="assets/${colorCode}.png" class="car-sprite" alt="F1 Car">
            `;
            arena.appendChild(car);
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
                        const cameraX = -(visual.x + 43 - vWidth / 2); // 43 è la metà di 86
                        const cameraY = -(visual.y + 20 - vHeight / 2); // 20 è la metà di 40
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

        // Se non è l'ultima gara, aggiungi un titolo per far capire che il gioco continua
        if (!data.isFinal) {
            const title = document.createElement('h2');
            title.style.color = '#f1c40f';
            title.style.marginTop = '-10px';
            title.textContent = `Fine ${data.trackName} - Prossima gara a breve...`;
            list.appendChild(title);
        } else {
            const title = document.createElement('h2');
            title.style.color = '#2ecc71';
            title.style.marginTop = '-10px';
            title.textContent = `🏆 CAMPIONATO CONCLUSO 🏆`;
            list.appendChild(title);
        }

        // Costruiamo la classifica cumulativa!
        // Costruiamo la classifica cumulativa!
        data.podium.forEach((entry, index) => {
            const color = entry.color;
            const totalTimeMs = entry.totalTime;
            const lastRaceTimeMs = entry.lastRaceTime; // <-- IL TEMPO DI QUESTA SPECIFICA PISTA!

            // 1. Formatta il tempo TOTALE (Campionato)
            const tMins = Math.floor(totalTimeMs / 60000);
            const tSecs = Math.floor((totalTimeMs % 60000) / 1000);
            const tMs = totalTimeMs % 1000;
            const formattedTotal = `${tMins}:${tSecs.toString().padStart(2, '0')}.${tMs.toString().padStart(3, '0')}`;

            // 2. Formatta il tempo della SINGOLA GARA
            const rMins = Math.floor(lastRaceTimeMs / 60000);
            const rSecs = Math.floor((lastRaceTimeMs % 60000) / 1000);
            const rMs = lastRaceTimeMs % 1000;
            const formattedRace = `${rMins}:${rSecs.toString().padStart(2, '0')}.${rMs.toString().padStart(3, '0')}`;

            // 3. Controlla se questo giocatore ha fatto il record in questa specifica gara
            const raceData = data.singleRacePodium.find(p => p.color === color);
            const isRecord = raceData && raceData.isRecord;
            const recordTag = isRecord ? `<span style="color: gold; font-size: 12px; font-weight: bold; margin-right: 8px; text-shadow: 0 0 5px gold;">🌟 RECORD</span>` : '';

            // Calcola il distacco TOTALE dal primo classificato
            let gapText = '';
            if (index === 0) {
                gapText = 'LEADER';
            } else {
                const gapMs = totalTimeMs - data.podium[0].totalTime;
                const gapSecs = Math.floor(gapMs / 1000);
                const gapMillis = gapMs % 1000;
                gapText = `+${gapSecs}.${gapMillis.toString().padStart(3, '0')}`;
            }

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
                
                <div style="font-family: monospace; text-align: right; display: flex; flex-direction: column; align-items: flex-end;">
                    
                    <div style="font-size: 15px; color: #34dbeb; margin-bottom: 3px;">
                        ${recordTag} Pista: <strong>${formattedRace}</strong>
                    </div>
                    
                    <div style="margin-bottom: 2px;">
                        <span style="font-size: 12px; color: #aaa; margin-right: 5px; font-family: sans-serif;">Totale Campionato:</span>
                        <span style="font-weight: bold;">${formattedTotal}</span>
                    </div>
                    
                    <div style="font-size: 12px; color: #e74c3c;">${gapText}</div>
                </div>
            `;
            list.appendChild(li);
        });

        modal.style.display = 'block';

        // --- GESTIONE MODALITÀ SINGOLA (BOTTONI RIAVVIO) ---
        const singleControls = document.getElementById('single-mode-controls');
        const autoReturnText = document.getElementById('auto-return-text');

        if (data.isSingleMode) {
            autoReturnText.style.display = 'none'; // Nascondi testo "Ritorno in corso"

            // Mostra i bottoni SOLO all'host
            if (myColor === hostColor) {
                singleControls.style.display = 'flex';

                document.getElementById('restart-race-btn').onclick = () => {
                    socket.emit('restartRace', lobbyId);
                };

                document.getElementById('back-to-lobby-btn').onclick = () => {
                    socket.emit('forceReturnToLobby', lobbyId);
                };
            } else {
                // Ai giocatori normali diciamo solo di attendere
                singleControls.style.display = 'none';
                autoReturnText.style.display = 'block';
                autoReturnText.textContent = "In attesa che l'Host decida cosa fare...";
            }
        } else {
            // Modalità Campionato Classica
            singleControls.style.display = 'none';
            autoReturnText.style.display = 'block';
            autoReturnText.textContent = "Ritorno alla lobby in corso...";
        }

        // --- NUOVO: GESTIONE RECORD MONDIALE ---
        // Controlliamo se IO (myColor) ho fatto un record in questa gara specifica
        const myRaceData = data.singleRacePodium.find(p => p.color === myColor);

        if (myRaceData && myRaceData.isRecord) {
            const recordModal = document.getElementById('record-modal');
            const recordInput = document.getElementById('record-name-input');
            const recordBtn = document.getElementById('submit-record-btn');

            if (recordModal) {
                // Mostra il pop-up e metti il focus sull'input
                recordModal.style.display = 'block';
                recordInput.value = '';
                recordInput.focus();

                // Funzione per inviare il record al server
                recordBtn.onclick = () => {
                    // Prende le 3 lettere, se è vuoto usa "AAA" di default
                    let initials = recordInput.value.trim().toUpperCase() || 'AAA';
                    initials = initials.substring(0, 3); // Sicurezza extra: massimo 3 caratteri

                    // Invia i dati al Socket!
                    socket.emit('saveNewRecord', {
                        lobbyId: lobbyId,
                        trackName: data.trackName,
                        playerName: initials,
                        playerColor: myColor,
                        time: myRaceData.time
                    });

                    // Chiudi il pop-up
                    recordModal.style.display = 'none';

                    // Mostra un feedback visivo al giocatore
                    const title = document.createElement('h3');
                    title.style.color = '#f1c40f';
                    title.style.textAlign = 'center';
                    title.textContent = `Record salvato come ${initials}!`;
                    list.appendChild(title);
                };
            }
        }

        if (data.mapTop3 && data.mapTop3.length > 0) {
            const top3Container = document.createElement('div');
            top3Container.style.marginTop = '20px';
            top3Container.style.padding = '10px';
            top3Container.style.backgroundColor = 'rgba(0,0,0,0.5)';
            top3Container.style.borderRadius = '8px';
            top3Container.style.border = '1px dashed #7f8c8d';

            let top3Html = `<h4 style="color: #bdc3c7; margin: 0 0 10px 0; text-align: center; text-transform: uppercase;">⏱️ Record All-Time (${data.trackName})</h4>`;

            data.mapTop3.forEach((rec, i) => {
                const m = Math.floor(rec.time / 60000);
                const s = Math.floor((rec.time % 60000) / 1000);
                const ms = rec.time % 1000;
                const timeStr = `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;

                let medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';

                top3Html += `
                    <div style="display: flex; justify-content: space-between; font-size: 16px; margin-bottom: 5px;">
                        <span>${medal} <span style="display:inline-block; width:12px; height:12px; background-color:${rec.color}; border-radius:50%; margin-right:5px;"></span> <strong>${rec.name}</strong></span>
                        <span style="font-family: monospace;">${timeStr}</span>
                    </div>
                `;
            });
            top3Container.innerHTML = top3Html;
            list.appendChild(top3Container);
        }
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