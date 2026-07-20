document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const myColor = urlParams.get('color') ? decodeURIComponent(urlParams.get('color')) : null;
    const rawSettings = urlParams.get('settings');
    const clientSettings = rawSettings ? JSON.parse(decodeURIComponent(rawSettings)) : {};
    const trackId = clientSettings.trackId || 'monte-rosso';

    if (!lobbyId || !myColor) {
        window.location.href = '/';
        return;
    }

    const socket = io({ transports: ['websocket'], upgrade: false });

    // Riconnessione (rete instabile, scheda in background riattivata): ri-emette
    // il join così il server annulla il timer di grazia e reintegra l'auto.
    socket.io.on('reconnect', () => {
        socket.emit('joinLobby', { lobbyId, color: myColor });
        socket.emit('joinF1Game', { lobbyId, playerColor: myColor });
    });

    // ====================================================
    // THREE.JS SETUP
    // ====================================================
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.FogExp2(0xadd8e6, 0.0022);

    const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1200);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    document.body.appendChild(renderer.domElement);

    // ====================================================
    // LUCI
    // ====================================================
    scene.add(new THREE.HemisphereLight(0xb0d8f5, 0x2d7a2d, 0.7));

    const sun = new THREE.DirectionalLight(0xfff4e0, 1.3);
    sun.position.set(150, 200, 50);
    sun.target.position.set(50, 0, 100);  // punta al centro del circuito
    scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.near  =  1;
    sun.shadow.camera.far   = 600;
    sun.shadow.camera.left  = -300;
    sun.shadow.camera.right =  300;
    sun.shadow.camera.top   =  300;
    sun.shadow.camera.bottom= -300;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    // ====================================================
    // TERRENO ERBOSO (sfondo)
    // ====================================================
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(3000, 3000),
        new THREE.MeshStandardMaterial({ color: 0x3d8b3d, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ====================================================
    // COSTRUZIONE PISTA 3D — dati caricati dal JSON della pista scelta
    // (vedi frontend/tracks/), stessa geometria usata dal server tramite
    // backend/sockets/games/trackLoader.js.
    // ====================================================
    const trackRes  = await fetch(`/tracks/${trackId}.json`);
    const trackData = await trackRes.json();

    const ROAD_HALF    = trackData.roadHalfWidth;
    const CURB_W       = 2.8;
    const BARRIER_D    = ROAD_HALF + CURB_W + 1.2;
    const PIT_PATH     = trackData.pit.path;

    const N_SAMPLES = 1000;
    const trackPts  = TrackGeometry.sampleLoop(trackData.controlPoints, N_SAMPLES);

    // Beccheggio (pitch) visivo dell'auto sui dislivelli: pendenza locale tra
    // il campione precedente e successivo lungo il giro, applicata come
    // rotazione attorno all'asse locale dell'auto DOPO l'imbardata (vedi
    // rotation.order = 'YXZ' in animate()) — così il muso si alza in salita e
    // si abbassa in discesa indipendentemente dalla direzione di marcia.
    function trackPitchAt(idx) {
        const n = trackPts.length;
        const prev = trackPts[(idx - 1 + n) % n];
        const next = trackPts[(idx + 1) % n];
        const dy = (next.y || 0) - (prev.y || 0);
        const horiz = Math.hypot(next.x - prev.x, next.z - prev.z) || 1e-6;
        return -Math.atan2(dy, horiz);
    }

    // DoubleSide evita artefatti di culling nelle zone ad alta curvatura
    TrackMeshBuilder.buildRibbon(scene, trackPts, ROAD_HALF, new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.95, side: THREE.DoubleSide }));
    TrackMeshBuilder.buildCurbs(scene, trackPts, ROAD_HALF, CURB_W);
    TrackMeshBuilder.buildBarriers(scene, trackPts, BARRIER_D);
    TrackMeshBuilder.buildStartLine(scene, trackPts, ROAD_HALF);
    TrackMeshBuilder.buildPitLane(scene, PIT_PATH, trackData.pit.roadHalfWidth, trackData.pit.boxIndex);

    // ====================================================
    // LOADER GLB (macchina Kenney colorata)
    // ====================================================
    const loader = new THREE.GLTFLoader();

    function loadCarModel(playerColor, onReady) {
        loader.load('/assets/kenney/raceCarWhite.glb', (gltf) => {
            const group = new THREE.Group();
            const model = gltf.scene;
            model.scale.set(3.5, 3.5, 3.5);

            // Il nodo radice del GLB ha un pivot non centrato sull'asset (translation
            // locale non nulla): senza compensarlo la mesh visibile risulta spostata
            // rispetto al centro logico (group), che è quello usato da fisica, hitbox
            // e camera — causa del disallineamento "auto qui, hitbox là" osservato in
            // gioco. Ricentriamo sul bounding box reale (x/z al centro, y a terra).
            model.updateMatrixWorld(true);
            const carBBox0 = new THREE.Box3().setFromObject(model);
            const carCenter0 = carBBox0.getCenter(new THREE.Vector3());
            model.position.x -= carCenter0.x;
            model.position.z -= carCenter0.z;
            model.position.y -= carBBox0.min.y;

            const hex        = parseInt(playerColor.replace('#', ''), 16);
            const namedWheels = [];
            const allMeshes   = [];

            model.traverse((child) => {
                if (!child.isMesh) return;
                child.castShadow    = true;
                child.receiveShadow = true;
                child.material      = child.material.clone();
                const c = child.material.color;
                if (c.r > 0.85 && c.g > 0.85 && c.b > 0.85) {
                    child.material.color.setHex(hex);
                    child.material.metalness = 0.4;
                    child.material.roughness = 0.35;
                }
                allMeshes.push(child);
                const nm = (child.name + ' ' + (child.parent?.name || '')).toLowerCase();
                if (nm.includes('wheel') || nm.includes('tyre') || nm.includes('tire')) {
                    namedWheels.push(child);
                }
            });

            console.log('[F1] Mesh nel modello:', allMeshes.map(m => `"${m.name}"`).join(', '));

            group.add(model);

            // Raccogli i nodi PARENT delle ruote (rotazione più corretta del sub-mesh)
            const wheelParentSet = new Set();
            for (const wm of namedWheels) {
                const p = wm.parent;
                if (p && p.isObject3D && !(p.isMesh) && p !== model && p !== gltf.scene) {
                    wheelParentSet.add(p);
                } else {
                    wheelParentSet.add(wm);
                }
            }

            // Fallback bounding-box se non trovate per nome
            let wheels = [...wheelParentSet];
            if (wheels.length < 2 && allMeshes.length > 1) {
                const carBB = new THREE.Box3().setFromObject(group);
                const thresh = carBB.min.y + (carBB.max.y - carBB.min.y) * 0.38;
                wheels = allMeshes.filter(m => {
                    const bb = new THREE.Box3().setFromObject(m);
                    return bb.getCenter(new THREE.Vector3()).y < thresh;
                });
                console.log('[F1] Ruote per BB:', wheels.length);
            }

            // Fallback finale: ruote cilindriche sintetiche
            if (wheels.length < 2) {
                console.log('[F1] Nessuna ruota separata trovata → aggiungo ruote fake');
                const wGeo = new THREE.CylinderGeometry(0.88, 0.88, 0.65, 16);
                const wMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95, metalness: 0.1 });
                const wPos = [
                    [-2.7, 0.88,  3.6],   // anteriore sinistra
                    [ 2.7, 0.88,  3.6],   // anteriore destra
                    [-2.7, 0.88, -3.4],   // posteriore sinistra
                    [ 2.7, 0.88, -3.4],   // posteriore destra
                ];
                wheels = [];
                for (const [wx, wy, wz] of wPos) {
                    const w = new THREE.Mesh(wGeo, wMat.clone());
                    w.rotation.z = Math.PI / 2;
                    w.position.set(wx, wy, wz);
                    w.castShadow = true;
                    group.add(w);
                    wheels.push(w);
                }
            }

            group.userData.wheels   = wheels;
            group.userData.wheelRot = 0;
            scene.add(group);
            onReady(group);
        }, undefined, (err) => console.error('Errore car model:', err));
    }

    // ====================================================
    // STATO DI GIOCO
    // ====================================================
    let myCarGroup    = null;
    let cameraMode    = 'third';
    let isRacing      = false;
    let localStart    = null;
    let myFinalTime   = null;
    let hostColor     = null;
    let currentPhase  = null;   // tyre_select | qualifying | grid_display | race

    const serverState = {};
    const visualState = {};
    const otherCars   = {};

    // ====================================================
    // DEBUG: hitbox visibili (tasto H) — stessi valori di CAR_HALF_LENGTH/
    // CAR_HALF_WIDTH lato server. Posizionate sulla posizione REALE del
    // server (serverState), non su quella interpolata (visualState), per
    // poter verificare a occhio eventuali disallineamenti tra fisica e resa.
    // ====================================================
    const HITBOX_HALF_LEN = 2.4, HITBOX_HALF_WID = 1.3, HITBOX_HEIGHT = 1.5;
    let showHitboxes = true;   // ON di default durante il tuning delle collisioni
    const hitboxMeshes = {};

    function getHitboxMesh(color) {
        if (hitboxMeshes[color]) return hitboxMeshes[color];
        const geo   = new THREE.BoxGeometry(HITBOX_HALF_WID * 2, HITBOX_HEIGHT, HITBOX_HALF_LEN * 2);
        const edges = new THREE.EdgesGeometry(geo);
        const mat   = new THREE.LineBasicMaterial({ color: color === myColor ? 0x00ff00 : 0xff0000 });
        const mesh  = new THREE.LineSegments(edges, mat);
        mesh.position.y = HITBOX_HEIGHT / 2;
        scene.add(mesh);
        hitboxMeshes[color] = mesh;
        return mesh;
    }

    // ====================================================
    // SELEZIONE MESCOLA
    // ====================================================
    let tyreSelectActive = false;   // true mentre siamo in fase tyre_select: la camera orbita sul tracciato
    let tyreOrbitAngle   = 0;
    let myCompoundChoice = null;
    let tyreCompoundsInfo = null;   // { hard:{...}, medium:{...}, soft:{...} }, ricevuto una volta in f1Setup

    function updateTyreSelectCamera() {
        tyreOrbitAngle += 0.0022;
        const radius = 150, height = 115;
        camera.position.set(50 + Math.cos(tyreOrbitAngle) * radius, height, 100 + Math.sin(tyreOrbitAngle) * radius);
        camera.lookAt(50, 0, 100);
    }

    // Riparenta il canvas dentro la cornice della selezione mescola e lo
    // ridimensiona a quella: un vero modellino contenuto, non la scena a
    // schermo intero vista in trasparenza dietro l'overlay.
    function enterTyrePreview() {
        const frame = document.getElementById('tyre-preview-frame');
        if (renderer.domElement.parentElement !== frame) frame.appendChild(renderer.domElement);
        renderer.domElement.classList.add('tyre-preview-canvas');
        const w = frame.clientWidth, h = frame.clientHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }

    function exitTyrePreview() {
        if (renderer.domElement.parentElement !== document.body) document.body.appendChild(renderer.domElement);
        renderer.domElement.classList.remove('tyre-preview-canvas');
        renderer.setSize(window.innerWidth, window.innerHeight);
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
    }

    // Riusata sia per la selezione mescola pre-qualifica sia per il cambio
    // gomme ai box (containerId/eventName diversi, stessa presentazione).
    function renderTyreCards(compounds, myCompound, containerId, eventName) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        for (const key of ['hard', 'medium', 'soft']) {
            const c = compounds[key];
            if (!c) continue;
            const card = document.createElement('div');
            card.className = 'tyre-card' + (myCompound === key ? ' selected' : '');
            card.innerHTML = `
                <div class="tyre-card-dot" style="background:${c.color};"></div>
                <div class="tyre-card-label">${c.label.toUpperCase()}</div>
                <div class="tyre-card-stats">
                    Velocità ${c.speedMult >= 1 ? '+' : ''}${Math.round((c.speedMult - 1) * 100)}%<br>
                    Aderenza ${c.gripMult >= 1 ? '+' : ''}${Math.round((c.gripMult - 1) * 100)}%<br>
                    Usura ${c.wearRate}×
                </div>`;
            card.onclick = () => {
                if (eventName === 'f1TyreChoice') myCompoundChoice = key;
                socket.emit(eventName, { lobbyId, playerColor: myColor, compound: key });
                container.querySelectorAll('.tyre-card').forEach(el => el.classList.remove('selected'));
                card.classList.add('selected');
            };
            container.appendChild(card);
        }
    }

    // ====================================================
    // PIT STOP — autopilota ingresso/uscita + minigioco di reazione
    // (pannello visibile SOLO al pilota in visita ai box: gli eventi sotto
    // arrivano solo al SUO socket, il server non fa broadcast alla lobby).
    // Il pannello resta aperto per TUTTA la visita — dall'ingresso (mentre
    // l'auto guida da sola verso il box: qui si sceglie la mescola) fino
    // all'uscita — non solo durante il minigioco.
    // ====================================================
    let pitting = false;   // true SOLO durante la sosta vera e propria (minigioco attivo)

    socket.on('f1PitLaneEntered', () => {
        const panel = document.getElementById('pitstop-panel');
        panel.style.display = 'flex';
        document.getElementById('pitstop-status').textContent = 'INGRESSO AI BOX...';
        document.getElementById('pitstop-instructions').textContent =
            'Scegli la mescola mentre arrivi al box.';
        document.getElementById('pitstop-react-prompt').style.display = 'none';
        document.getElementById('pitstop-result').textContent = '';
        if (tyreCompoundsInfo) renderTyreCards(tyreCompoundsInfo, null, 'pitstop-cards', 'f1PitCompoundChoice');
    });

    socket.on('f1PitStopStarted', () => {
        pitting = true;
        document.getElementById('pitstop-status').textContent = 'AI BOX...';
        document.getElementById('pitstop-instructions').textContent =
            'Aspetta il segnale verde, poi premi SPAZIO più veloce che puoi! (premere prima non conta, puoi aspettare tranquillo)';
    });

    socket.on('f1PitReactionGo', () => {
        document.getElementById('pitstop-status').textContent = '';
        document.getElementById('pitstop-instructions').textContent = '';
        document.getElementById('pitstop-react-prompt').style.display = 'block';
    });

    socket.on('f1PitStopTiming', ({ durationMs }) => {
        document.getElementById('pitstop-react-prompt').style.display = 'none';
        const secs = (durationMs / 1000).toFixed(1);
        document.getElementById('pitstop-result').textContent = `Sosta: ${secs}s`;
    });

    socket.on('f1PitStopFinished', () => {
        pitting = false;
        document.getElementById('pitstop-status').textContent = 'USCITA DAI BOX...';
        document.getElementById('pitstop-instructions').textContent = '';
    });

    socket.on('f1PitLaneExited', () => {
        document.getElementById('pitstop-panel').style.display = 'none';
    });

    // Il client inoltra la pressione ogni volta che viene premuto spazio
    // durante la sosta: è il server a decidere se conta (solo se arrivata
    // DOPO il segnale) o va ignorata (prematura) — nessun rischio di
    // "bruciarsi" l'unico tentativo premendo troppo presto per curiosità.
    document.addEventListener('keydown', (e) => {
        if (pitting && e.code === 'Space') {
            socket.emit('f1PitReactionPress', { lobbyId, playerColor: myColor });
        }
    });

    // ====================================================
    // SOCKET EVENTS
    // ====================================================
    let myTotalLaps = 3;

    socket.on('f1Setup', ({ players, trackName, hostColor: hc, totalLaps, phase, raceStarted, elapsed,
                            compounds, strategy, myCompound, tyreConfirmed, tyreTotal }) => {
        if (compounds) tyreCompoundsInfo = compounds;
        if (phase) currentPhase = phase;
        if (hc) hostColor = hc;
        if (trackName) document.getElementById('track-name-display').textContent = trackName;
        if (totalLaps) {
            // In qualifica il giro totale è sempre 1, non quello impostato per
            // la gara vera (totalLaps qui si riferisce alla gara, non alla
            // sessione corrente) — altrimenti il box mostrerebbe "0/3" durante
            // un giro secco.
            const displayTotalLaps = phase === 'qualifying' ? 1 : totalLaps;
            myTotalLaps = displayTotalLaps;
            const myLap = players[myColor] ? players[myColor].lap : 0;
            const box = document.getElementById('lap-box');
            box.style.display = 'flex';
            document.getElementById('lap-display').textContent = `${Math.min(myLap, displayTotalLaps)}/${displayTotalLaps}`;
        }

        // Idempotente: su un rientro (reconnect senza reload) i modelli esistono
        // già in scena, ricrearli darebbe auto duplicate.
        if (!myCarGroup) loadCarModel(myColor, (g) => { myCarGroup = g; });

        for (const [color, state] of Object.entries(players)) {
            serverState[color] = { x: state.x, z: state.z, angle: state.angle, speed: 0 };
            if (!visualState[color]) visualState[color] = { ...serverState[color] };
            if (color !== myColor && !otherCars[color]) {
                loadCarModel(color, (g) => {
                    otherCars[color] = g;
                    g.position.set(state.x, 0, state.z);
                    g.rotation.y = state.angle;
                });
            }
        }

        // Rientro a gara già in corso: riprende il cronometro dal punto giusto
        // senza rivedere il countdown (che è già passato per tutti gli altri).
        if (raceStarted) {
            isRacing    = true;
            localStart  = Date.now() - (elapsed || 0);
            document.getElementById('countdown-overlay').style.display = 'none';
            document.getElementById('timer-box').style.visibility = 'visible';
        }

        if (phase === 'tyre_select') {
            tyreSelectActive = true;
            myCompoundChoice = myCompound || null;
            document.getElementById('tyre-select-overlay').style.display = 'flex';
            enterTyrePreview();
            document.getElementById('tyre-strategy-hint').textContent =
                'Strategia consigliata: ' + (strategy || []).map(c => (compounds[c]?.label || c).toUpperCase()).join(' → ');
            renderTyreCards(compounds, myCompoundChoice, 'tyre-cards', 'f1TyreChoice');
            document.getElementById('tyre-confirm-status').textContent = `${tyreConfirmed || 0}/${tyreTotal || 1} pronti`;
        }
    });

    socket.on('f1StateUpdate', (state) => {
        for (const [color, data] of Object.entries(state)) {
            serverState[color] = data;
            if (color !== myColor && !otherCars[color] && !visualState[color]) {
                visualState[color] = { x: data.x, z: data.z, angle: data.angle };
                loadCarModel(color, (g) => { otherCars[color] = g; });
            } else if (!visualState[color]) {
                visualState[color] = { x: data.x, z: data.z, angle: data.angle };
            }

            if (showHitboxes) {
                const hb = getHitboxMesh(color);
                hb.position.x = data.x;
                hb.position.z = data.z;
                hb.rotation.y = data.angle;
                hb.visible = true;
            } else if (hitboxMeshes[color]) {
                hitboxMeshes[color].visible = false;
            }

            // Solo in GARA: in qualifica tutti guidano sullo spec Soft a
            // prescindere dalla mescola scelta (quella conta solo in gara),
            // mostrarla lì sarebbe fuorviante.
            if (color === myColor && currentPhase === 'race' && data.compound && tyreCompoundsInfo) {
                const info = tyreCompoundsInfo[data.compound];
                if (info) {
                    const box = document.getElementById('tyre-box');
                    box.style.display = 'flex';
                    document.getElementById('tyre-dot').style.background = info.color;
                    document.getElementById('tyre-label').textContent = info.label.toUpperCase();
                    document.getElementById('tyre-wear-value').textContent = Math.round(data.tyreWear || 0);
                }
            } else if (color === myColor && currentPhase !== 'race') {
                document.getElementById('tyre-box').style.display = 'none';
            }
        }
        updateStandings(state);
    });

    // Classifica live: pallino colore + posizione, ordinata per rank. Nulla da
    // mostrare prima che la gara sia partita (position è null lato server).
    function updateStandings(state) {
        const box = document.getElementById('standings-box');
        const entries = Object.entries(state)
            .filter(([, d]) => d.position)
            .sort((a, b) => a[1].position - b[1].position);

        if (entries.length === 0) { box.innerHTML = ''; return; }

        box.innerHTML = entries.map(([color, d]) => `
            <div class="standing-entry${color === myColor ? ' me' : ''}">
                <span class="standing-pos">${d.position}°</span>
                <span class="standing-dot" style="background:${color};"></span>
            </div>
        `).join('');
    }

    socket.on('f1PlayerLeft', (color) => {
        if (otherCars[color]) { scene.remove(otherCars[color]); delete otherCars[color]; }
        if (hitboxMeshes[color]) { scene.remove(hitboxMeshes[color]); delete hitboxMeshes[color]; }
        delete serverState[color]; delete visualState[color];
    });

    socket.on('f1TyreConfirmed', ({ count, total }) => {
        const status = document.getElementById('tyre-confirm-status');
        if (status) status.textContent = `${count}/${total} pronti`;
    });

    socket.on('f1Countdown', (data) => {
        isRacing    = false;
        myFinalTime = null;
        if (tyreSelectActive) exitTyrePreview();   // la qualifica sta per partire: fine anteprima tracciato
        tyreSelectActive = false;
        document.getElementById('timer-box').style.visibility = 'hidden';
        // Nasconde in automatico un'eventuale griglia/animazione/selezione ancora
        // a schermo: evita di dover sincronizzare a mano un timeout lato client
        // con GRID_DISPLAY_MS/TYRE_SELECT_MS del server.
        document.getElementById('podium-modal').style.display = 'none';
        document.getElementById('pole-overlay').style.display = 'none';
        document.getElementById('tyre-select-overlay').style.display = 'none';
        const overlay  = document.getElementById('countdown-overlay');
        const num      = document.getElementById('countdown-number');
        const trackEl  = document.getElementById('countdown-track');
        const labelEl  = document.getElementById('countdown-label');
        if (data?.trackName) trackEl.textContent = data.trackName;
        labelEl.textContent = data?.label || '';
        overlay.style.background = 'rgba(0,0,0,0.65)';
        overlay.style.display    = 'flex';
        num.textContent = '3'; num.style.color = '#e74c3c';
        setTimeout(() => { num.textContent = '2'; num.style.color = '#f39c12'; }, 1000);
        setTimeout(() => { num.textContent = '1'; num.style.color = '#f1c40f'; }, 2000);
    });

    socket.on('f1RaceStarted', (data) => {
        isRacing    = true;
        myFinalTime = null;
        if (data?.phase) currentPhase = data.phase;
        localStart  = Date.now() - (data?.syncTime || 0);
        const overlay = document.getElementById('countdown-overlay');
        const num     = document.getElementById('countdown-number');
        num.textContent = 'GO!'; num.style.color = '#2ecc71';
        overlay.style.background = 'transparent';
        document.getElementById('timer-box').style.visibility = 'visible';
        setTimeout(() => { overlay.style.display = 'none'; }, 800);
        sendInputs();
    });

    socket.on('f1LapUpdate', ({ color, lap, totalLaps }) => {
        if (color !== myColor) return;
        document.getElementById('lap-box').style.display = 'flex';
        document.getElementById('lap-display').textContent = `${Math.min(lap, totalLaps)}/${totalLaps}`;
    });

    // Animazione di rivelazione: rivela il TESTO passato lettera per lettera,
    // con un leggero scorrimento verso il centro ad ogni carattere aggiunto.
    // Personale: chi fa pole vede "POOOOOOOOOOLE" (tutto MAIUSCOLO), tutti gli
    // altri vedono solo la PROPRIA posizione (es. "P4") — vedi f1QualiEnded.
    function playRevealAnimation(fullText) {
        const CHAR_DELAY = 85;
        const overlay = document.getElementById('pole-overlay');
        const textEl  = document.getElementById('pole-text');
        overlay.style.display = 'flex';
        textEl.textContent = '';
        textEl.style.transition = 'none';
        textEl.style.transform  = 'translateX(55vw)';
        // forza il reflow prima di riattivare la transition, altrimenti il primo step non scorre
        void textEl.offsetWidth;
        textEl.style.transition = 'transform 0.08s linear';

        let i = 0;
        const timer = setInterval(() => {
            i++;
            textEl.textContent = fullText.slice(0, i);
            textEl.style.transform = `translateX(${(fullText.length - i) * 42}px)`;
            if (i >= fullText.length) {
                clearInterval(timer);
                setTimeout(() => { overlay.style.display = 'none'; }, 1800);
            }
        }, CHAR_DELAY);
    }

    // Fine qualifica: rivelazione personale (POLE per il 1°, "P<n>" per tutti
    // gli altri, ognuno vede solo la propria — ricavata dalla propria posizione
    // nella griglia condivisa, nessun evento dedicato per-utente necessario),
    // poi la griglia di partenza completa (riusa il modal del podio) per il
    // resto della finestra prima del countdown di gara (si chiude da sé al
    // prossimo f1Countdown, vedi handler sopra).
    socket.on('f1QualiEnded', ({ grid }) => {
        const myPos = (grid || []).findIndex(e => e.color === myColor) + 1;
        if (myPos === 1)      playRevealAnimation('POOOOOOOOOOLE');
        else if (myPos > 1)   playRevealAnimation(`P${myPos}`);

        const modal = document.getElementById('podium-modal');
        const title = document.getElementById('podium-title');
        const list  = document.getElementById('podium-list');
        title.textContent = '🏁 GRIGLIA DI PARTENZA 🏁';
        list.innerHTML = (grid || []).map((entry, i) => {
            const t = entry.time;
            const timeStr = t === null
                ? 'Nessun tempo'
                : `${Math.floor(t / 60000)}:${String(Math.floor((t % 60000) / 1000)).padStart(2, '0')}.${String(t % 1000).padStart(3, '0')}`;
            return `
                <li style="display:flex;justify-content:space-between;align-items:center;padding:10px 5px;border-bottom:1px solid #bdc3c7;font-size:18px;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <span style="font-weight:900;width:26px;color:#2C3E50;">${i + 1}°</span>
                        <span style="display:inline-block;width:20px;height:20px;background:${entry.color};border-radius:50%;border:2px solid #2C3E50;"></span>
                        <span style="font-size:13px;font-weight:bold;">${entry.color === myColor ? '(TU)' : ''}</span>
                    </div>
                    <span style="font-family:monospace;font-weight:bold;">${timeStr}</span>
                </li>`;
        }).join('');
        document.getElementById('single-mode-controls').style.display = 'none';
        document.getElementById('auto-return-text').style.display = 'none';
        modal.style.display = 'flex';
    });

    socket.on('f1BoostUpdate', ({ boostTime }) => {
        const mBox = document.getElementById('multiplier-box');
        const mVal = document.getElementById('multiplier-display');
        mBox.style.display = 'flex';
        const bonus = (boostTime / 4.0) * 0.20;
        mVal.textContent = (1.0 + bonus).toFixed(2);
        if      (bonus >= 0.20) { mBox.style.color = '#f1c40f'; mBox.style.borderColor = '#f1c40f'; }
        else if (bonus >  0   ) { mBox.style.color = '#e67e22'; mBox.style.borderColor = '#e67e22'; }
        else                    { mBox.style.color = '#95a5a6'; mBox.style.borderColor = '#95a5a6'; }
    });

    socket.on('f1RaceEnded', (data) => {
        isRacing = false;
        const modal = document.getElementById('podium-modal');
        const list  = document.getElementById('podium-list');
        // Ripristina il titolo statico (f1QualiEnded lo sovrascrive con "GRIGLIA
        // DI PARTENZA" per la schermata di qualifica).
        document.getElementById('podium-title').textContent = '🏁 RACE FINISHED 🏁';
        list.innerHTML = '';

        const title = document.createElement('h2');
        title.style.color = data.isFinal ? '#2ecc71' : '#f1c40f';
        title.style.marginTop = '-10px';
        title.textContent = data.isFinal
            ? '🏆 CHAMPIONSHIP CONCLUDED 🏆'
            : `Finished ${data.trackName} — Next race starting soon…`;
        list.appendChild(title);

        (data.podium || []).forEach((entry, i) => {
            const t  = entry.totalTime;
            const m  = Math.floor(t / 60000);
            const s  = Math.floor((t % 60000) / 1000);
            const ms = t % 1000;
            const li = document.createElement('li');
            li.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:10px 5px;border-bottom:1px solid #bdc3c7;font-size:18px;';
            li.innerHTML = `
                <div style="display:flex;align-items:center;gap:12px;">
                    <span style="font-weight:900;width:26px;color:${i===0?'#f1c40f':i===1?'#95a5a6':i===2?'#d35400':'#2C3E50'}">${i+1}°</span>
                    <span style="display:inline-block;width:20px;height:20px;background:${entry.color};border-radius:50%;border:2px solid #2C3E50;"></span>
                    <span style="font-size:13px;font-weight:bold;">${entry.color===myColor?'(YOU)':''}</span>
                    ${entry.pitPenalty ? '<span style="font-size:11px;font-weight:bold;color:#e74c3c;border:1px solid #e74c3c;border-radius:6px;padding:1px 6px;">+30s NO PIT</span>' : ''}
                </div>
                <span style="font-family:monospace;font-weight:bold;">${m}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}</span>`;
            list.appendChild(li);
        });

        modal.style.display = 'flex';
        const single   = document.getElementById('single-mode-controls');
        const autoText = document.getElementById('auto-return-text');
        if (data.isSingleMode) {
            autoText.style.display = 'none';
            single.style.display = 'flex';
            document.getElementById('restart-race-btn').onclick  = () => socket.emit('f1RestartRace', lobbyId);
            document.getElementById('back-to-lobby-btn').onclick = () => socket.emit('f1ReturnToLobby', lobbyId);
            if (myColor !== hostColor) {
                document.getElementById('restart-race-btn').style.display = 'none';
                document.getElementById('back-to-lobby-btn').textContent  = 'Torna alla Lobby';
            }
        } else {
            single.style.display   = 'none';
            autoText.style.display = 'block';
            if (data.isFinal) {
                let secs = 8;
                autoText.textContent = `Ritorno alla lobby tra ${secs}s…`;
                const t = setInterval(() => {
                    secs--;
                    if (secs <= 0) {
                        clearInterval(t);
                        window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(myColor)}`;
                    } else {
                        autoText.textContent = `Ritorno alla lobby tra ${secs}s…`;
                    }
                }, 1000);
            } else {
                autoText.textContent = 'Caricamento prossima pista…';
            }
        }
    });

    socket.on('f1RedirectToLobby', () => {
        window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(myColor)}`;
    });

    // ====================================================
    // INPUT TASTIERA
    // ====================================================
    const inputs = { w: false, a: false, s: false, d: false };

    document.addEventListener('keydown', (e) => {
        let ch = false;
        const k = e.key.toLowerCase();
        if (k === 'w' && !inputs.w) { inputs.w = true;  ch = true; }
        if (k === 'a' && !inputs.a) { inputs.a = true;  ch = true; }
        if (k === 's' && !inputs.s) { inputs.s = true;  ch = true; }
        if (k === 'd' && !inputs.d) { inputs.d = true;  ch = true; }
        if (k === 'c') cameraMode = cameraMode === 'third' ? 'first' : 'third';
        if (k === 'h') {   // DEBUG: mostra/nascondi le hitbox di collisione
            showHitboxes = !showHitboxes;
            for (const mesh of Object.values(hitboxMeshes)) mesh.visible = showHitboxes;
        }
        if (ch && isRacing) sendInputs();
    });

    document.addEventListener('keyup', (e) => {
        let ch = false;
        const k = e.key.toLowerCase();
        if (k === 'w') { inputs.w = false; ch = true; }
        if (k === 'a') { inputs.a = false; ch = true; }
        if (k === 's') { inputs.s = false; ch = true; }
        if (k === 'd') { inputs.d = false; ch = true; }
        if (ch && isRacing) sendInputs();
    });

    window.addEventListener('blur', () => {
        inputs.w = inputs.a = inputs.s = inputs.d = false;
        if (isRacing) sendInputs();
    });

    document.addEventListener('contextmenu', e => e.preventDefault());

    function sendInputs() {
        socket.emit('f1Input', { lobbyId, playerColor: myColor, inputs });
    }

    // Tutti i socket.on(...) sono registrati sopra: SOLO ora è sicuro chiedere
    // al server lo stato (f1Setup arriva in risposta sincrona a joinF1Game).
    // Emesso prima — subito dopo io(), come prima del refactor track-editor —
    // apriva una finestra di race: il fetch del JSON pista qui sopra è
    // asincrono, quindi f1Setup poteva arrivare dal server prima che il
    // listener fosse registrato ed essere perso (schermata bloccata sul cielo
    // blu, "certe volte" — bug segnalato dall'utente).
    socket.emit('joinLobby', { lobbyId, color: myColor });
    socket.emit('joinF1Game', { lobbyId, playerColor: myColor });

    // ====================================================
    // RENDER LOOP — LERP + CAMERA
    // ====================================================
    const LERP = 0.22;

    function lerpAngle(a, b, t) {
        let d = b - a;
        while (d >  Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return a + d * t;
    }

    const _camOff  = new THREE.Vector3();
    const _lookTgt = new THREE.Vector3();

    function updateCamera() {
        if (!myCarGroup) return;
        const pos = myCarGroup.position;
        const q   = myCarGroup.quaternion;

        if (cameraMode === 'third') {
            _camOff.set(0, 5.5, -13);
            _camOff.applyQuaternion(q);
            camera.position.copy(pos).add(_camOff);
            _lookTgt.copy(pos).add(new THREE.Vector3(0, 1.2, 0));
            camera.lookAt(_lookTgt);
        } else {
            _camOff.set(0, 1.0, 1.3);
            _camOff.applyQuaternion(q);
            camera.position.copy(pos).add(_camOff);
            _lookTgt.set(0, 1.0, 30);
            _lookTgt.applyQuaternion(q);
            _lookTgt.add(pos);
            camera.lookAt(_lookTgt);
        }
    }

    const timerEl = document.getElementById('hud-timer');
    const speedEl = document.getElementById('speed-value');

    function animate() {
        requestAnimationFrame(animate);

        for (const [color, target] of Object.entries(serverState)) {
            const v = visualState[color];
            if (!v) continue;

            v.x     += (target.x     - v.x)     * LERP;
            v.z     += (target.z     - v.z)     * LERP;
            v.angle  = lerpAngle(v.angle || 0, target.angle || 0, LERP);

            const carGroup = color === myColor ? myCarGroup : otherCars[color];
            if (carGroup) {
                // Quota e inclinazione solo visive, agganciate all'indice pista
                // che tiene già il server (trackIndex): niente ricerca "punto più
                // vicino nello spazio", che su tracciati che si riavvicinano a se
                // stessi può agganciarsi a un tratto sbagliato del giro. La
                // fisica server resta interamente 2D (x/z), qui si aggiusta solo
                // dove/come appare l'auto quando la pista ha dislivelli.
                const idx = (target.trackIndex != null)
                    ? target.trackIndex
                    : TrackGeometry.nearestPoint(trackPts, v.x, v.z).index;
                // Il server aggiorna trackIndex solo al proprio tick (20/s): senza
                // ammorbidire quota e beccheggio come già succede per x/z/angle,
                // ogni salto di campione si vede come uno scatto, evidente sui
                // dislivelli e invisibile in piano (dove restano sempre a 0).
                v.y     = (v.y     || 0) + ((trackPts[idx].y || 0) - (v.y || 0))     * LERP;
                v.pitch = (v.pitch || 0) + (trackPitchAt(idx)      - (v.pitch || 0)) * LERP;
                carGroup.position.set(v.x, v.y, v.z);
                carGroup.rotation.order = 'YXZ';
                carGroup.rotation.x = v.pitch;
                carGroup.rotation.y = v.angle;
                // Rotazione ruote basata sulla velocità
                if (carGroup.userData.wheels && carGroup.userData.wheels.length > 0) {
                    carGroup.userData.wheelRot = (carGroup.userData.wheelRot || 0) + Math.abs(target.speed || 0) * 1.4;
                    const wr = -carGroup.userData.wheelRot;
                    for (const w of carGroup.userData.wheels) w.rotation.x = wr;
                }
            }

            if (color === myColor) {
                speedEl.textContent = Math.round(Math.abs(target.speed || 0) * 55);
                if (target.finished && target.time) myFinalTime = target.time;
            }
        }

        if (isRacing && localStart) {
            const t  = myFinalTime !== null ? myFinalTime : (Date.now() - localStart);
            const m  = Math.floor(t / 60000);
            const s  = Math.floor((t % 60000) / 1000);
            const ms = t % 1000;
            timerEl.textContent = `${m}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
            timerEl.style.color = myFinalTime !== null ? '#2ecc71' : '#2C3E50';
        }

        if (tyreSelectActive) updateTyreSelectCamera();
        else                  updateCamera();
        renderer.render(scene, camera);
    }

    animate();

    window.addEventListener('resize', () => {
        if (tyreSelectActive) {
            const frame = document.getElementById('tyre-preview-frame');
            camera.aspect = frame.clientWidth / frame.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(frame.clientWidth, frame.clientHeight);
        } else {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
    });
});
