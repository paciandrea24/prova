document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const myColor = urlParams.get('color');

    if (!lobbyId || !myColor) {
        window.location.href = '/';
        return;
    }

    const socket = io();
    socket.emit('joinLobby', { lobbyId: lobbyId, color: myColor });
    socket.emit('joinRacing', { lobbyId, playerColor: decodeURIComponent(myColor) });

    const arena = document.getElementById('arena');
    let isRacing = false;
    let hostColor = null;
    let localStartTime = null;
    let myFinalTime = null;

    // Stato locale degli input per non spammare il server inutilmente
    const inputs = { w: false, a: false, s: false, d: false };

    // --- NUOVO: PRECARICAMENTO IMMAGINI MAPPA ---
    // Definisci gli ID che userai nelle matrici (es. 11, 12 per i rettilinei, 21, 22 per le curve)
    const trackImages = {
        4: new Image(),
        11: new Image(),
        12: new Image(),
        13: new Image(),
        14: new Image(),
        21: new Image(),
        22: new Image(),
        23: new Image(),
        24: new Image(),
        31: new Image(),
        32: new Image(),
        33: new Image(),
        34: new Image()
    };

    // Inserisci qui il nome esatto dei tuoi file PNG
    trackImages[4].src = 'assets/gravel.png';
    trackImages[11].src = 'assets/rettilineo_top.png';
    trackImages[12].src = 'assets/rettilineo_right.png';
    trackImages[13].src = 'assets/rettilineo_bottom.png';
    trackImages[14].src = 'assets/rettilineo_left.png';
    trackImages[21].src = 'assets/curva_1.png';
    trackImages[22].src = 'assets/curva_2.png';
    trackImages[23].src = 'assets/curva_3.png';
    trackImages[24].src = 'assets/curva_4.png';
    trackImages[31].src = 'assets/curva_interna_1.png';
    trackImages[32].src = 'assets/curva_interna_2.png';
    trackImages[33].src = 'assets/curva_interna_3.png';
    trackImages[34].src = 'assets/curva_interna_4.png';


    // Costruisce l'arena
    socket.on('racingSetup', (data) => {
        const { trackMap, tileSize, playersState, trackName, hostColor: serverHostColor } = data;

        if (serverHostColor) hostColor = serverHostColor;

        const podiumModal = document.getElementById('podium-modal');
        if (podiumModal) podiumModal.style.display = 'none';

        // FIX NOME PISTA: Aggiorna l'HUD
        const trackNameDisplay = document.getElementById('track-name-display');
        if (trackNameDisplay) trackNameDisplay.textContent = trackName || "CIRCUIT";

        serverState = playersState;
        myFinalTime = null;

        visualState = {};
        for (const color in playersState) {
            visualState[color] = { x: playersState[color].x, y: playersState[color].y, angle: playersState[color].angle };
        }

        // FIX GIRI: Nascondi il box se la gara è singola
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

        const trackWidth = trackMap[0].length * tileSize;
        const trackHeight = trackMap.length * tileSize;

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

        for (let row = 0; row < trackMap.length; row++) {
            for (let col = 0; col < trackMap[row].length; col++) {
                const tile = trackMap[row][col];
                const x = col * tileSize;
                const y = row * tileSize;

                if (tile === 0) {
                    ctx.fillStyle = '#2ECC71';
                    ctx.fillRect(x, y, tileSize, tileSize);
                    ctx.strokeStyle = 'rgba(39, 174, 96, 0.5)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x, y, tileSize, tileSize);

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
                    ctx.fillStyle = '#405158';
                    ctx.fillRect(x, y, tileSize, tileSize);
                } else if (tile === 2) {
                    ctx.fillStyle = '#bdc3c7';
                    ctx.fillRect(x, y, tileSize, tileSize);
                    ctx.fillStyle = 'white';
                    ctx.fillRect(x, y, tileSize / 2, tileSize / 2);
                    ctx.fillRect(x + tileSize / 2, y + tileSize / 2, tileSize / 2, tileSize / 2);
                    ctx.fillStyle = '#2C3E50';
                    ctx.fillRect(x + tileSize / 2, y, tileSize / 2, tileSize / 2);
                    ctx.fillRect(x, y + tileSize / 2, tileSize / 2, tileSize / 2);
                } else if (tile === 3 || tile === 6) {
                    ctx.fillStyle = (col + row) % 2 === 0 ? '#F1C40F' : '#2C3E50';
                    ctx.fillRect(x, y, tileSize, tileSize);
                } else if (tile === 5) {
                    ctx.fillStyle = '#2c3e50';
                    ctx.fillRect(x, y, tileSize, tileSize);

                } else if (trackImages[tile]) {
                    // Se l'immagine è associata a questo numero, disegnala!
                    if (trackImages[tile].complete) {
                        ctx.drawImage(trackImages[tile], x, y, tileSize, tileSize);
                    } else {
                        // Se l'immagine sta ancora caricando, accodiamo il disegno.
                        // Usiamo addEventListener per non sovrascrivere i tile precedenti dello stesso tipo!
                        trackImages[tile].addEventListener('load', () => {
                            ctx.drawImage(trackImages[tile], x, y, tileSize, tileSize);
                        });
                    }
                }
            }
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

    // 2. Il Render Loop super fluido a 60/144Hz (dipende dal monitor)
    function renderLoop() {
        for (const [color, target] of Object.entries(serverState)) {
            if (!visualState[color]) continue;

            const visual = visualState[color];

            // LERP per movimento fluido
            visual.x += (target.x - visual.x) * 0.3;
            visual.y += (target.y - visual.y) * 0.3;

            let angleDiff = target.angle - visual.angle;
            while (angleDiff < -180) angleDiff += 360;
            while (angleDiff > 180) angleDiff -= 360;
            visual.angle += angleDiff * 0.3;

            // FIX: Cerca la macchina con l'id formattato in maiuscolo
            const carEl = document.getElementById(`car-${color.replace('#', '').toUpperCase()}`);
            if (carEl) {
                carEl.style.transform = `translate(${visual.x}px, ${visual.y}px) rotate(${visual.angle}deg)`;

                // 1. Contro-rotazione del nome (già presente)
                const label = carEl.querySelector('.player-label');
                if (label) label.style.transform = `rotate(${-visual.angle}deg)`;

                // 2. NUOVO CODICE: Ribalta l'immagine se va verso sinistra!
                const sprite = carEl.querySelector('.car-sprite');
                if (sprite) {
                    // Normalizza l'angolo per averlo sempre tra 0 e 360
                    let normAngle = ((visual.angle % 360) + 360) % 360;

                    // Se l'angolo va verso il quadrante sinistro, specchia la grafica
                    if (normAngle > 90 && normAngle < 270) {
                        sprite.style.transform = 'scaleY(-1)';
                    } else {
                        sprite.style.transform = 'scaleY(1)'; // Grafica normale
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

                    // AGGIORNA GIRI LIVE
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

                // FIX COLORE TIMER (Scuro durante la gara, Verde quando tagli il traguardo)
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

    socket.on('raceStarted', () => {
        isRacing = true;
        sendInputs();
        localStartTime = Date.now();

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
                autoReturnText.textContent = "Returning to lobby in 15 seconds...";
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

