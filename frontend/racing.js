document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const myColor = urlParams.get('color');

    if (!lobbyId || !myColor) {
        window.location.href = '/';
        return;
    }

    const socket = io({
        transports: ['websocket'],
        upgrade: false
    });

    socket.emit('joinLobby', { lobbyId: lobbyId, color: myColor });
    socket.emit('joinRacing', { lobbyId, playerColor: decodeURIComponent(myColor) });

    const arena = document.getElementById('arena');
    let isRacing = false;
    let hostColor = null;
    let localStartTime = null;
    let myFinalTime = null;

    // Stato locale degli input per non spammare il server inutilmente
    const inputs = { w: false, a: false, s: false, d: false };


    // --- NUOVO: CARICAMENTO TILESET UNICO ---
    const tilesetImg = new Image();
    tilesetImg.src = 'assets/tileset.png';

    // ⚠️ ATTENZIONE: INSERISCI QUI I DATI DEL TUO TILESET PNG ⚠️
    const TILESET_COLUMNS = 18;   // Quanti tile ci sono in orizzontale nel file tileset.png?
    const SOURCE_TILE_SIZE = 128;  // Quanti pixel è grande ogni tile nel file PNG originario

    // Costruisce l'arena
    socket.on('racingSetup', (data) => {
        const { trackMap, tileSize, playersState, trackName, hostColor: serverHostColor } = data;

        if (serverHostColor) hostColor = serverHostColor;

        const podiumModal = document.getElementById('podium-modal');
        if (podiumModal) podiumModal.style.display = 'none';

        const trackNameDisplay = document.getElementById('track-name-display');
        if (trackNameDisplay) trackNameDisplay.textContent = trackName || "CIRCUIT";

        serverState = playersState;
        myFinalTime = null;

        visualState = {};
        for (const color in playersState) {
            visualState[color] = { x: playersState[color].x, y: playersState[color].y, angle: playersState[color].angle };
        }

        const lapBox = document.getElementById('lap-box');
        const isSingle = data.isSingleMode || (data.settings && data.settings.mode === 'single') || data.totalLaps === 1;

        if (isSingle) {
            if (lapBox) lapBox.style.display = 'none';
        } else {
            if (lapBox) lapBox.style.display = 'flex';
            document.getElementById('lap-display').textContent = `1/${data.totalLaps || 3}`;
        }

        const countdownOverlay = document.getElementById('countdown-overlay');
        const countdownTrack = document.getElementById('countdown-track');
        const countdownNumber = document.getElementById('countdown-number');

        document.getElementById('timer-box').style.visibility = 'hidden';

        countdownOverlay.style.display = 'flex';
        countdownOverlay.style.background = 'rgba(0, 0, 0, 0.7)';
        countdownTrack.textContent = trackName;
        countdownNumber.textContent = '3';
        countdownNumber.style.color = '#e74c3c';

        setTimeout(() => { countdownNumber.textContent = '2'; countdownNumber.style.color = '#f39c12'; }, 1000);
        setTimeout(() => { countdownNumber.textContent = '1'; countdownNumber.style.color = '#f1c40f'; }, 2000);

        // ATTENZIONE: La grandezza della pista è decisa dal layer "bottom"
        const trackWidth = trackMap.bottom[0].length * tileSize;
        const trackHeight = trackMap.bottom.length * tileSize;

        arena.style.width = trackWidth + 'px';
        arena.style.height = trackHeight + 'px';
        arena.style.backgroundImage = 'none';
        arena.style.transform = 'none';

        let canvas = document.getElementById('track-canvas');
        if (canvas) canvas.remove();

        canvas = document.createElement('canvas');
        canvas.id = 'track-canvas';
        arena.appendChild(canvas);
        canvas.width = trackWidth;
        canvas.height = trackHeight;
        const ctx = canvas.getContext('2d');

        // FUNZIONE PER DISEGNARE UN LIVELLO TILED
        const drawLayer = (layerData) => {
            if (!layerData) return;

            for (let row = 0; row < layerData.length; row++) {
                for (let col = 0; col < layerData[row].length; col++) {
                    const tileId = layerData[row][col];
                    if (tileId === 0 || tileId === -1) continue; // Lo 0 in Tiled significa "spazio vuoto"

                    const x = col * tileSize;
                    const y = row * tileSize;

                    // Calcolo le coordinate X e Y del tile all'interno di tileset.png
                    // (Gli ID esportati in CSV da Tiled partono sempre da 1)
                    const sourceCol = (tileId) % TILESET_COLUMNS;
                    const sourceRow = Math.floor((tileId) / TILESET_COLUMNS);

                    const sx = sourceCol * SOURCE_TILE_SIZE;
                    const sy = sourceRow * SOURCE_TILE_SIZE;

                    // Disegna solo quel pezzettino di PNG
                    ctx.drawImage(
                        tilesetImg,
                        sx, sy, SOURCE_TILE_SIZE, SOURCE_TILE_SIZE,  // Ritaglio
                        x, y, tileSize, tileSize                     // Posizione nella Canvas
                    );
                }
            }
        };

        // Disegna prima il fondo (layer 2) e poi le decorazioni sopra (layer 1)
        const renderMap = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height); // Pulisce
            drawLayer(trackMap.bottom);
            drawLayer(trackMap.top);
        };

        if (tilesetImg.complete) {
            renderMap();
        } else {
            tilesetImg.addEventListener('load', renderMap);
        }

        document.querySelectorAll('.car').forEach(e => e.remove());

        for (const [color, state] of Object.entries(playersState)) {
            let car = document.createElement('div');
            car.className = 'car';

            // FIX MACCHINE INVISIBILI: Forza l'uppercase sul codice esadecimale (es: 00CED1 invece di 00ced1)
            const colorCode = color.replace('#', '').toUpperCase();
            car.id = `car-${colorCode}`;

            if (color === myColor) car.classList.add('my-car');

            car.innerHTML = `
                <div class="player-label">${color === myColor ? 'YOU' : ''}</div>
                <img src="assets/${colorCode}.png" class="car-sprite" alt="Car">
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

    // Variabile globale per calcolare il tempo tra un frame visivo e l'altro
    let lastRenderTime = Date.now();

    // 2. Il Render Loop super fluido
    function renderLoop() {
        // --- CALCOLO DEL DELTA TIME FRONTEND ---
        let now = Date.now();
        let dt = (now - lastRenderTime) / 1000;
        if (dt > 0.1) dt = 0.016; // Failsafe se cambi scheda del browser
        lastRenderTime = now;

        // La velocità esatta che ha il Server (24 di baseSpeed * 60 frame ideali = 1440 pixel al secondo)
        const SPEED_PER_SECOND = 1440;
        const ROTATION_PER_SECOND = 240;

        for (const [color, target] of Object.entries(serverState)) {
            if (!visualState[color]) continue;

            const visual = visualState[color];

            // ==================================================
            // 🔥 CLIENT-SIDE PREDICTION & SMART RECONCILIATION
            // ==================================================
            if (color === myColor && isRacing) {
                // 1. PREDIZIONE
                let moveX = 0;
                let moveY = 0;

                if (inputs.w) moveY -= 1;
                if (inputs.s) moveY += 1;
                if (inputs.a) moveX -= 1;
                if (inputs.d) moveX += 1;

                if (moveX !== 0 || moveY !== 0) {
                    const magnitude = Math.sqrt(moveX * moveX + moveY * moveY);
                    const normalizedX = moveX / magnitude;
                    const normalizedY = moveY / magnitude;

                    // Movimento esatto slegato dagli Hz del monitor
                    let step = SPEED_PER_SECOND * dt;
                    visual.x += normalizedX * step;
                    visual.y += normalizedY * step;

                    // Predici anche l'angolo di rotazione istantaneo
                    let targetAngle = Math.atan2(normalizedY, normalizedX) * (180 / Math.PI);
                    let diff = targetAngle - visual.angle;
                    while (diff <= -180) diff += 360;
                    while (diff > 180) diff -= 360;
                    visual.angle += diff * (ROTATION_PER_SECOND * dt * 0.05);
                }

                // 2. RICONCILIAZIONE INTELLIGENTE (SMART ELASTIC)
                let dx = target.x - visual.x;
                let dy = target.y - visual.y;
                let distance = Math.sqrt(dx * dx + dy * dy);

                // Siccome il server è sempre un po' "indietro" per colpa del ping,
                // la distanza non sarà mai 0. Creiamo delle fasce di tolleranza:

                if (distance > 100) {
                    // DESINCRONIZZAZIONE GRAVE (es. hai sbattuto a un muro sul server, ma il client non lo sapeva)
                    // Elastico forte per riportarti subito in carreggiata
                    visual.x += dx * 0.3;
                    visual.y += dy * 0.3;
                } else if (distance > 40) {
                    // LEGGERA DERIVA (es. sei andato sulla ghiaia e il server ti ha rallentato)
                    // Elastico morbidissimo, quasi impercettibile all'occhio
                    visual.x += dx * 0.05;
                    visual.y += dy * 0.05;
                }
                // Se la distance è < 40... NON FACCIAMO NULLA! 
                // Lasciamo comandare il tuo schermo (Zero microscatti)

            } else {
                // ==================================================
                // 👻 AUTO DEGLI AVVERSARI (Solo LERP classico)
                // ==================================================
                visual.x += (target.x - visual.x) * 0.3;
                visual.y += (target.y - visual.y) * 0.3;

                let angleDiff = target.angle - visual.angle;
                while (angleDiff < -180) angleDiff += 360;
                while (angleDiff > 180) angleDiff -= 360;
                visual.angle += angleDiff * 0.3;
            }

            // --- AGGIORNAMENTO GRAFICO NEL DOM ---
            const carEl = document.getElementById(`car-${color.replace('#', '').toUpperCase()}`);
            if (carEl) {
                carEl.style.transform = `translate(${visual.x}px, ${visual.y}px) rotate(${visual.angle}deg)`;

                // 1. Contro-rotazione del nome 
                const label = carEl.querySelector('.player-label');
                if (label) label.style.transform = `rotate(${-visual.angle}deg)`;

                // 2. Ribalta l'immagine se va verso sinistra
                const sprite = carEl.querySelector('.car-sprite');
                if (sprite) {
                    let normAngle = ((visual.angle % 360) + 360) % 360;
                    if (normAngle > 90 && normAngle < 270) {
                        sprite.style.transform = 'scaleY(-1)';
                    } else {
                        sprite.style.transform = 'scaleY(1)';
                    }
                }

                if (target.finished) carEl.style.opacity = '0.5';

                // TELECAMERA & GIRI (Solo per la tua auto)
                if (color === myColor) {
                    const viewport = document.getElementById('camera-viewport');
                    if (viewport) {
                        const vWidth = viewport.clientWidth;
                        const vHeight = viewport.clientHeight;
                        const cameraX = -(visual.x + 49 - vWidth / 2);
                        const cameraY = -(visual.y + 20 - vHeight / 2);
                        arena.style.transform = `translate(${cameraX}px, ${cameraY}px)`;
                    }

                    const lapBox = document.getElementById('lap-box');
                    if (lapBox && lapBox.style.display !== 'none' && target.lap && target.totalLaps) {
                        const displayLap = Math.min(target.lap, target.totalLaps);
                        document.getElementById('lap-display').textContent = `${displayLap}/${target.totalLaps}`;
                    }
                }
            }
        }

        // AGGIORNAMENTO DEL CRONOMETRO
        if (isRacing && localStartTime) {
            const myServerState = serverState[myColor];

            if (myServerState && myServerState.finished && myServerState.time) {
                myFinalTime = myServerState.time;
            }

            const timeToDisplay = myFinalTime !== null ? myFinalTime : (Date.now() - localStartTime);

            const m = Math.floor(timeToDisplay / 60000);
            const s = Math.floor((timeToDisplay % 60000) / 1000);
            const ms = timeToDisplay % 1000;

            const timerEl = document.getElementById('hud-timer');
            if (timerEl) {
                timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
                if (myFinalTime !== null) {
                    timerEl.style.color = '#2ecc71';
                } else {
                    timerEl.style.color = '#2C3E50';
                }
            }
        }

        requestAnimationFrame(renderLoop);
    }

    // Fai partire il motore grafico del frontend
    requestAnimationFrame(renderLoop);

    socket.on('raceStarted', (data) => {
        isRacing = true;
        sendInputs();

        // [FIX TIMING]: Se il server ci manda un tempo trascorso (syncTime), lo scaliamo dalla partenza locale
        const elapsed = (data && data.syncTime) ? data.syncTime : 0;
        localStartTime = Date.now() - elapsed;

        const countdownOverlay = document.getElementById('countdown-overlay');
        const countdownNumber = document.getElementById('countdown-number');

        countdownNumber.textContent = 'GO!';
        countdownNumber.style.color = '#2ecc71';
        countdownOverlay.style.background = 'transparent';

        // Riabilita la visibilità del timer
        document.getElementById('timer-box').style.visibility = 'visible';

        setTimeout(() => {
            countdownOverlay.style.display = 'none';
        }, 800);
    });

    // --- GESTIONE ESPULSIONE / AFK DURANTE LA GARA ---
    socket.on('playerKicked', (kickedColor) => {
        if (kickedColor === myColor) {
            // Se il colore kickato è il mio, vengo mandato subito alla homepage!
            alert("Sei stato rimosso dalla partita per inattività.");
            window.location.href = '/';
        } else {
            // Se è stato kickato un altro giocatore, facciamo sparire la sua auto visivamente
            const carElement = document.getElementById(`car-${kickedColor.replace('#', '')}`);
            if (carElement) {
                // Effetto "fantasma" prima di scomparire
                carElement.style.opacity = '0.2';
                setTimeout(() => {
                    if (carElement) carElement.remove();
                }, 2000);
            }
        }
    });


    socket.on('raceEnded', (data) => {
        isRacing = false;

        const modal = document.getElementById('podium-modal');
        const list = document.getElementById('podium-list');
        list.innerHTML = '';

        // Titolo (in Inglese)
        if (!data.isFinal) {
            const title = document.createElement('h2');
            title.style.color = '#f1c40f';
            title.style.marginTop = '-10px';
            title.textContent = `Finished ${data.trackName} - Next race starting soon...`;
            list.appendChild(title);
        } else {
            const title = document.createElement('h2');
            title.style.color = '#2ecc71';
            title.style.marginTop = '-10px';
            title.textContent = `🏆 CHAMPIONSHIP CONCLUDED 🏆`;
            list.appendChild(title);
        }

        // Costruiamo la classifica cumulativa!
        data.podium.forEach((entry, index) => {
            const color = entry.color;
            const totalTimeMs = entry.totalTime;
            const lastRaceTimeMs = entry.lastRaceTime;

            const raceData = data.singleRacePodium.find(p => p.color === color);
            const isDnf = raceData && raceData.dnf;

            // 1. Formatta il tempo TOTALE (Campionato)
            let formattedTotal = "";
            if (totalTimeMs >= 9999999) {
                formattedTotal = "<span style='color: #e74c3c;'>Disqualified</span>";
            } else {
                const tMins = Math.floor(totalTimeMs / 60000);
                const tSecs = Math.floor((totalTimeMs % 60000) / 1000);
                const tMs = totalTimeMs % 1000;
                formattedTotal = `${tMins}:${tSecs.toString().padStart(2, '0')}.${tMs.toString().padStart(3, '0')}`;
            }

            // 2. Formatta il tempo della SINGOLA GARA
            let formattedRace = "";
            if (isDnf) {
                formattedRace = "<span style='color: #e74c3c; font-weight: bold;'>DNF (Retired)</span>";
            } else {
                const rMins = Math.floor(lastRaceTimeMs / 60000);
                const rSecs = Math.floor((lastRaceTimeMs % 60000) / 1000);
                const rMs = lastRaceTimeMs % 1000;
                formattedRace = `${rMins}:${rSecs.toString().padStart(2, '0')}.${rMs.toString().padStart(3, '0')}`;
            }

            const isRecord = raceData && raceData.isRecord;
            const recordTag = isRecord ? `<span style="color: gold; font-size: 12px; font-weight: bold; margin-right: 8px; text-shadow: 0 0 5px gold;">🌟 RECORD</span>` : '';

            // Calcola il distacco TOTALE
            let gapText = '';
            if (index === 0) {
                gapText = 'LEADER';
            } else if (totalTimeMs >= 9999999) {
                gapText = 'OUT';
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
            li.style.borderBottom = '1px solid #bdc3c7'; // Bordo grigio chiaro
            li.style.fontSize = '20px';
            li.style.color = '#2C3E50'; // Colore testo base

            li.innerHTML = `
                <div style="display: flex; align-items: center; gap: 15px;">
                    <span style="font-weight: 900; width: 30px; text-shadow: 1px 1px 0px rgba(0,0,0,0.1); color: ${index === 0 ? '#f1c40f' : index === 1 ? '#95a5a6' : index === 2 ? '#d35400' : '#2C3E50'};">${index + 1}°</span>
                    <span style="display: inline-block; width: 24px; height: 24px; background-color: ${color}; border-radius: 50%; border: 3px solid #2C3E50; box-shadow: 2px 2px 0 rgba(0,0,0,0.2);"></span>
                    <span style="font-size: 14px; font-weight: bold;">${color === myColor ? '(YOU)' : ''}</span>
                </div>
                
                <div style="font-family: monospace; text-align: right; display: flex; flex-direction: column; align-items: flex-end;">
                    <div style="font-size: 15px; color: #3498DB; margin-bottom: 3px;">
                        ${recordTag} Track: <strong>${formattedRace}</strong>
                    </div>
                    <div style="margin-bottom: 2px;">
                        <span style="font-size: 12px; color: #7f8c8d; margin-right: 5px; font-family: 'Fredoka', sans-serif;">Total:</span>
                        <span style="font-weight: bold; font-size: 16px;">${formattedTotal}</span>
                    </div>
                    <div style="font-size: 12px; color: #E74C3C; font-weight: bold;">${gapText}</div>
                </div>
            `;
            list.appendChild(li);
        });

        // Mostra il modale usando FLEX per centrarlo
        modal.style.display = 'flex';

        // --- GESTIONE MODALITÀ E TESTO INFERIORE ---
        const singleControls = document.getElementById('single-mode-controls');
        const autoReturnText = document.getElementById('auto-return-text');

        if (data.isSingleMode) {
            autoReturnText.style.display = 'none';
            if (myColor === hostColor) {
                singleControls.style.display = 'flex';
                document.getElementById('restart-race-btn').onclick = () => {
                    socket.emit('restartRace', lobbyId);
                };
                document.getElementById('back-to-lobby-btn').onclick = () => {
                    socket.emit('forceReturnToLobby', lobbyId);
                };
            } else {
                singleControls.style.display = 'none';
                autoReturnText.style.display = 'block';
                autoReturnText.textContent = "Waiting for Host...";
            }
        } else {
            // MODALITÀ CAMPIONATO
            singleControls.style.display = 'none';
            autoReturnText.style.display = 'block';

            // Controlla se è l'ultima gara del campionato
            if (data.isFinal) {
                autoReturnText.textContent = "Returning to lobby in 8 seconds...";
            } else {
                autoReturnText.textContent = "Loading next track...";
            }
        }

        // --- GESTIONE RECORD MONDIALE ---
        const myRaceData = data.singleRacePodium.find(p => p.color === myColor);
        const recordModal = document.getElementById('record-modal');

        if (myRaceData && myRaceData.isRecord && recordModal) {
            const recordInput = document.getElementById('record-name-input');
            const recordBtn = document.getElementById('submit-record-btn');

            recordModal.style.display = 'flex';
            recordInput.value = '';
            recordInput.focus();

            recordBtn.onclick = () => {
                let initials = recordInput.value.trim().toUpperCase() || 'AAA';
                initials = initials.substring(0, 3);
                socket.emit('saveNewRecord', {
                    lobbyId: lobbyId,
                    trackName: data.trackName,
                    playerName: initials,
                    playerColor: myColor,
                    time: myRaceData.time
                });
                recordModal.style.display = 'none';

                const title = document.createElement('h3');
                title.style.color = '#f1c40f';
                title.style.textAlign = 'center';
                title.textContent = `Record saved as ${initials}!`;
                list.appendChild(title);
            };
        }

        // STILE GARTIC PER I RECORD ALL-TIME
        if (data.mapTop3 && data.mapTop3.length > 0) {
            const top3Container = document.createElement('div');
            top3Container.style.marginTop = '25px';
            top3Container.style.padding = '15px';
            top3Container.style.backgroundColor = '#ecf0f1';
            top3Container.style.borderRadius = '16px';
            top3Container.style.border = '4px solid #2C3E50';
            top3Container.style.boxShadow = '4px 4px 0 #2C3E50';

            let top3Html = `<h4 style="color: #3498DB; font-family:'Fredoka', sans-serif; font-size: 20px; margin: 0 0 15px 0; text-align: center; text-transform: uppercase;">🏆 Hall of Fame</h4>`;

            data.mapTop3.forEach((rec, i) => {
                const m = Math.floor(rec.time / 60000);
                const s = Math.floor((rec.time % 60000) / 1000);
                const ms = rec.time % 1000;
                const timeStr = `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;

                let medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';

                top3Html += `
                    <div style="display: flex; justify-content: space-between; align-items:center; font-size: 18px; margin-bottom: 8px; border-bottom: 2px dashed #bdc3c7; padding-bottom: 5px;">
                        <span style="display:flex; align-items:center; color:#2C3E50; font-weight:bold;">
                            <span style="margin-right:10px; text-shadow: 1px 1px 0px rgba(0,0,0,0.1);">${medal}</span> 
                            <span style="display:inline-block; width:16px; height:16px; background-color:${rec.color}; border-radius:50%; border: 2px solid #2C3E50; margin-right:10px;"></span> 
                            ${rec.name}
                        </span>
                        <span style="font-family: monospace; background:var(--yellow); color:var(--border-color); padding: 2px 8px; border-radius:8px; border:2px solid var(--border-color); font-weight:bold;">${timeStr}</span>
                    </div>
                `;
            });
            top3Container.innerHTML = top3Html;
            list.appendChild(top3Container);
        }
    });

    socket.on('redirectAllToLobby', () => {
        window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(myColor)}`;
    });

    // --- GESTIONE INPUT (W A S D) ---
    function sendInputs() {
        if (isRacing) {
            socket.emit('racingInput', { lobbyId, playerColor: myColor, inputs });
        }
    }

    document.addEventListener('keydown', (e) => {
        let changed = false;
        const key = e.key.toLowerCase();

        if (key === 'w' && !inputs.w) { inputs.w = true; changed = true; }
        if (key === 'a' && !inputs.a) { inputs.a = true; changed = true; }
        if (key === 's' && !inputs.s) { inputs.s = true; changed = true; }
        if (key === 'd' && !inputs.d) { inputs.d = true; changed = true; }

        // Se i tasti cambiano E la gara è partita, manda al server.
        // Se la gara non è ancora partita, abbiamo comunque salvato "w: true" localmente.
        if (changed && isRacing) sendInputs();
    });

    document.addEventListener('keyup', (e) => {
        let changed = false;
        const key = e.key.toLowerCase();

        if (key === 'w') { inputs.w = false; changed = true; }
        if (key === 'a') { inputs.a = false; changed = true; }
        if (key === 's') { inputs.s = false; changed = true; }
        if (key === 'd') { inputs.d = false; changed = true; }

        if (changed && isRacing) sendInputs();
    });

    // =========================================================
    // FIX TASTI FANTASMA E PERDITA DI FOCUS
    // =========================================================

    // 1. Blocca il menu a tendina (tasto destro) per non interrompere il gameplay
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    // 2. Funzione intelligente che simula il rilascio di tutti i tasti di movimento
    function resetStuckKeys() {
        const keysToRelease = [
            { key: 'w', code: 'KeyW' }, { key: 'W', code: 'KeyW' },
            { key: 'a', code: 'KeyA' }, { key: 'A', code: 'KeyA' },
            { key: 's', code: 'KeyS' }, { key: 'S', code: 'KeyS' },
            { key: 'd', code: 'KeyD' }, { key: 'D', code: 'KeyD' },
            { key: 'ArrowUp', code: 'ArrowUp' },
            { key: 'ArrowDown', code: 'ArrowDown' },
            { key: 'ArrowLeft', code: 'ArrowLeft' },
            { key: 'ArrowRight', code: 'ArrowRight' }
        ];

        keysToRelease.forEach(k => {
            // Creiamo un finto evento 'keyup' e lo inviamo al tuo script originale!
            const event = new KeyboardEvent('keyup', { key: k.key, code: k.code });
            document.dispatchEvent(event);
        });
    }

    // 3. Rilascia i tasti se clicchi fuori dalla finestra del gioco (o premi Alt-Tab)
    window.addEventListener('blur', resetStuckKeys);

    // 4. Rilascia i tasti se cambi scheda nel browser
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            resetStuckKeys();
        }
    });
});

