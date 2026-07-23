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
    // COSTRUZIONE PISTA 3D — dati caricati dal JSON della pista scelta
    // (vedi frontend/tracks/), stessa geometria usata dal server tramite
    // backend/sockets/games/trackLoader.js.
    // ====================================================
    const trackRes  = await fetch(`/tracks/${trackId}.json`);
    const trackData = await trackRes.json();

    const ROAD_HALF    = trackData.roadHalfWidth;
    const CURB_W       = 2.8;
    const BARRIER_D    = ROAD_HALF + CURB_W + 1.2;
    // Il terrapieno deve iniziare esattamente dal bordo esterno del cordolo
    // (non da BARRIER_D, che è 1.2 unità più in là, dove sta la barriera):
    // altrimenti resta scoperta una fascia sottile tra cordolo e barriera —
    // prima invisibile perché il prato piatto infinito copriva tutto, ora
    // che il prato parte dal terrapieno si vedrebbe il cielo di sfondo.
    const EMBANKMENT_START = ROAD_HALF + CURB_W;
    // Ampiezza del terrapieno oltre EMBANKMENT_START, entro cui la quota del
    // terreno sfuma dalla quota pista a 0 (prato in piano) — valore di
    // partenza, da tarare a vista (pendenza troppo ripida/dolce si aggiusta
    // solo qui, non in TrackGeometry.terrainHeightAt/TrackMeshBuilder).
    const EMBANKMENT_WIDTH = 45;
    const PIT_PATH     = trackData.pit.path;

    const N_SAMPLES = 1000;
    const trackPts  = TrackGeometry.sampleLoop(trackData.controlPoints, N_SAMPLES);

    // ====================================================
    // TERRENO ERBOSO — prato con un "buco" a forma di tracciato (esterno) +
    // pezzo pieno per l'infield, riempiti dal terrapieno che sfuma dalla
    // quota pista a 0 man mano che ci si allontana: niente più piano piatto
    // fisso che potesse tagliare la pista nelle discese sotto quota 0 (vedi
    // design 2026-07-22-f1-terrapieno-e-ponti).
    // ====================================================
    TrackMeshBuilder.buildGround(scene, trackPts, BARRIER_D + EMBANKMENT_WIDTH, 3000);
    TrackMeshBuilder.buildEmbankment(scene, trackPts, EMBANKMENT_START, BARRIER_D + EMBANKMENT_WIDTH);
    // Punti "a terra" (non-ponte): usati sia per i piloni (quota reale sotto
    // un ponte) sia per la quota visiva dell'auto fuori pista più sotto —
    // calcolato una sola volta qui, non ad ogni frame.
    const groundPts = trackPts.filter(p => !p.bridge);
    TrackMeshBuilder.buildBridgeDecks(scene, trackPts, groundPts, ROAD_HALF + CURB_W, EMBANKMENT_START, BARRIER_D + EMBANKMENT_WIDTH);

    // Stessi punti campionati usati internamente da TrackMeshBuilder.buildPitLane
    // (che li ricalcola per conto suo): un secondo ricalcolo qui è economico
    // (300 campioni, una tantum al caricamento) e serve per generare la
    // scenografia senza toccare la firma di buildPitLane.
    const PIT_PTS = TrackGeometry.sampleOpenPath(trackData.pit.path, 300);

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
    // AUDIO MOTORE — un solo loop di 4s di un vero motore d'auto,
    // registrato e tarato apposta per un gioco di corse (progetto
    // "Trigger" di qubodup): CC-BY 3.0, va mantenuta l'attribuzione —
    // https://opengameart.org/content/car-engine-loop-96khz-4s. I
    // tentativi precedenti (crossfade a 8 bande da una registrazione F1
    // reale, poi un loop generico di macchinario CC0) sono stati bocciati
    // all'ascolto dall'utente. Pitch/volume seguono la velocità in
    // continuo (vedi animate()), con range diversi se l'auto sta
    // accelerando o decelerando/rilasciando — stesso file per entrambe le
    // fasi, nessun secondo asset.
    // ====================================================
    const listener = new THREE.AudioListener();
    camera.add(listener);
    // Politica autoplay dei browser: il contesto audio nasce sospeso finché
    // non c'è un gesto dell'utente sulla pagina.
    function resumeAudioContext() {
        if (listener.context.state === 'suspended') listener.context.resume();
    }
    window.addEventListener('pointerdown', resumeAudioContext, { once: true });
    window.addEventListener('keydown', resumeAudioContext, { once: true });

    const engineBuffer = await new Promise((resolve, reject) => {
        new THREE.AudioLoader().load('/assets/audio/engine.wav', resolve, undefined, reject);
    });
    // Il file (4s, non tagliato da noi) non è stato editato per essere
    // seamless in loop: misurato sui campioni grezzi, tra l'ultimo e il
    // primo campione c'è un salto di ampiezza di ~0.28 (su scala -1..1) —
    // un "colpo" udibile a ogni giro di loop. Dissolvenza lineare di 15ms
    // su inizio e fine di ogni canale, verso lo zero, per eliminarlo.
    (function declickLoopEdges(buffer, fadeMs = 15) {
        const fadeSamples = Math.floor(buffer.sampleRate * fadeMs / 1000);
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < fadeSamples; i++) {
                const g = i / fadeSamples;
                data[i] *= g;                          // fade-in iniziale
                data[data.length - 1 - i] *= g;         // fade-out finale
            }
        }
    })(engineBuffer);

    // Deve restare in sync a mano con MAX_SPEED in
    // backend/sockets/games/f1GameSocket.js (oggi 6.2): nessun endpoint
    // espone questa costante al client.
    const ENGINE_REF_MAX_SPEED = 6.2;
    // Manopola unica di volume: le tre formule sotto (accelerando,
    // decelerando, corsia box) restano invariate come "forma" relativa,
    // questo moltiplicatore le scala tutte insieme — il volume si
    // percepisce su scala logaritmica, quindi per un taglio netto serve
    // un moltiplicatore basso (0.4 ≈ dimezzato all'orecchio, non 0.5
    // lineare), non un piccolo aggiustamento.
    const ENGINE_VOLUME_MULT = 0.4;

    // ====================================================
    // SCENOGRAFIA — caricamento asset e istanziazione dal layout generato
    // da TrackScenery.generateLayout. Ogni asset ripetuto (natura, folla)
    // usa un unico THREE.InstancedMesh per tenere basse le draw call anche
    // con centinaia di istanze; il laghetto (categoria 'pond', nessun asset
    // scaricato: il Nature Kit non ne include uno) è una mesh procedurale,
    // stesso approccio già usato per il prato di sfondo qui sopra.
    // ====================================================
    const SCENERY_ASSET_PATHS = {
        treeLarge:            '/assets/kenney/treeLarge.glb',
        treeSmall:             '/assets/kenney/treeSmall.glb',
        grandStand:            '/assets/kenney/grandStand.glb',
        grandStandAwning:      '/assets/kenney/grandStandAwning.glb',
        grandStandCovered:     '/assets/kenney/grandStandCovered.glb',
        billboard:             '/assets/kenney/billboard.glb',
        billboardLow:          '/assets/kenney/billboardLow.glb',
        pitsGarageClosed:      '/assets/kenney/pitsGarageClosed.glb',
        pitsOffice:            '/assets/kenney/pitsOffice.glb',
    };

    function loadScenery(container, layout) {
        const sceneryLoader = new THREE.GLTFLoader();
        const byAsset = new Map();
        for (const item of layout) {
            if (item.category === 'pond') continue;
            if (!byAsset.has(item.asset)) byAsset.set(item.asset, []);
            byAsset.get(item.asset).push(item);
        }

        const dummy = new THREE.Object3D();
        for (const [asset, items] of byAsset) {
            const url = SCENERY_ASSET_PATHS[asset];
            sceneryLoader.load(url, (gltf) => {
                gltf.scene.updateMatrixWorld(true);
                const meshes = [];
                gltf.scene.traverse((child) => { if (child.isMesh) meshes.push(child); });

                for (const mesh of meshes) {
                    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material.clone(), items.length);
                    im.frustumCulled = false;
                    im.castShadow    = true;
                    im.receiveShadow = true;
                    const localMatrix = mesh.matrixWorld;

                    items.forEach((it, i) => {
                        dummy.position.set(it.x, it.y || 0, it.z);
                        dummy.rotation.set(0, it.rotY || 0, 0);
                        dummy.scale.setScalar(it.scale || 1);
                        dummy.updateMatrix();
                        const finalMatrix = new THREE.Matrix4().multiplyMatrices(dummy.matrix, localMatrix);
                        im.setMatrixAt(i, finalMatrix);
                    });
                    im.instanceMatrix.needsUpdate = true;
                    container.add(im);
                }
            }, undefined, (err) => console.error(`[F1] Errore caricando asset scenografia "${asset}":`, err));
        }

        for (const item of layout) {
            if (item.category !== 'pond') continue;
            const pond = new THREE.Mesh(
                new THREE.CircleGeometry(item.radius, 24),
                new THREE.MeshStandardMaterial({ color: 0x2f6fa8, roughness: 0.35, metalness: 0.05 })
            );
            pond.rotation.x = -Math.PI / 2;
            pond.position.set(item.x, (item.y || 0) + 0.03, item.z);
            pond.receiveShadow = true;
            container.add(pond);
        }
    }

    // Chiamata qui (dopo la dichiarazione di loadScenery/SCENERY_ASSET_PATHS,
    // non subito dopo buildPitLane più sopra): SCENERY_ASSET_PATHS è un
    // const nello stesso scope della funzione asincrona di DOMContentLoaded,
    // quindi resta nella temporal dead zone finché l'esecuzione non arriva
    // alla sua riga — chiamare loadScenery prima, pur essendo la funzione
    // stessa hoistata, faceva scattare un ReferenceError a runtime.
    const sceneryLayout = TrackScenery.generateLayout(trackData, trackPts, PIT_PTS, BARRIER_D, EMBANKMENT_WIDTH);
    loadScenery(scene, sceneryLayout);

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

            // Loop motore: un solo buffer, mai fermato — pitch e volume
            // vengono regolati ogni frame in animate() in base a velocità
            // e stato accelerando/decelerando.
            const engineSound = new THREE.PositionalAudio(listener);
            engineSound.setBuffer(engineBuffer);
            engineSound.setLoop(true);
            engineSound.setRefDistance(15);
            engineSound.setRolloffFactor(1.5);
            engineSound.setVolume(0);
            engineSound.play();
            group.add(engineSound);
            group.userData.engineSound = engineSound;

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

    // Motore: per ogni auto (mia e altrui) approssimo "sta
    // accelerando/decelerando" da una variazione di velocità rispetto
    // all'ultimo valore osservato — vale anche per me: se rilascio
    // l'acceleratore e la velocità scende per attrito, senza frenare, è
    // comunque una decelerazione udibile. Finestra di "tenuta"
    // (ENGINE_ACTIVE_HOLD_MS) più lunga del tick server (50ms) per non far
    // sfarfallare il suono tra un aggiornamento e l'altro dello stato di
    // rete. Niente più cambio marcia sonoro: il clunk sintetizzato (onda
    // quadra) stonava col nuovo motore reale e veniva percepito come un
    // "colpo" indesiderato — rimosso su richiesta dell'utente.
    const engineActiveSince      = {};
    const engineLastCheckedSpeed = {};
    const engineAccelerating    = {};
    const ENGINE_ACTIVE_HOLD_MS     = 400;
    const ENGINE_SPEED_DELTA_EPS    = 0.02;

    // ====================================================
    // DEBUG: hitbox visibili (tasto H) — stessi valori di CAR_HALF_LENGTH/
    // CAR_HALF_WIDTH lato server. Posizionate sulla posizione REALE del
    // server (serverState), non su quella interpolata (visualState), per
    // poter verificare a occhio eventuali disallineamenti tra fisica e resa.
    // ====================================================
    const HITBOX_HALF_LEN = 2.4, HITBOX_HALF_WID = 1.3, HITBOX_HEIGHT = 1.5;
    let showHitboxes = false;  // toggle con H, debug only
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
        let myIndex = 0, i = 0;
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
            if (myCompound === key) myIndex = i;
            i++;
        }
        // Abilita la navigazione da gamepad (D-pad sx/dx + X) su questo
        // container: diventa quello "attivo" finché non se ne apre un altro
        // o viene esplicitamente disattivato (vedi clearTyreNav()).
        activeTyreContainerId = containerId;
        tyreFocusIndex = myIndex;
        _applyTyreFocus();
    }

    // ── Navigazione mescola da gamepad ──────────────────────────────────
    let activeTyreContainerId = null;
    let tyreFocusIndex = 0;

    function _tyreCards() {
        if (!activeTyreContainerId) return [];
        const container = document.getElementById(activeTyreContainerId);
        return container ? Array.from(container.querySelectorAll('.tyre-card')) : [];
    }

    function _applyTyreFocus() {
        const cards = _tyreCards();
        cards.forEach((el, idx) => el.classList.toggle('gp-focused', idx === tyreFocusIndex));
    }

    function tyreNav(delta) {
        const cards = _tyreCards();
        if (cards.length === 0) return;
        tyreFocusIndex = (tyreFocusIndex + delta + cards.length) % cards.length;
        _applyTyreFocus();
    }

    function tyreConfirm() {
        const cards = _tyreCards();
        if (cards[tyreFocusIndex]) cards[tyreFocusIndex].click();
    }

    function clearTyreNav() {
        activeTyreContainerId = null;
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
        clearTyreNav();   // la mescola è ormai fissata: X torna a significare "reazione pit"
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
        clearTyreNav();
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
    // INPUT TASTIERA + GAMEPAD
    // ====================================================
    // Protocollo unificato: la tastiera manda sempre valori estremi
    // (0/1/-1), il gamepad manda valori analogici continui — la fisica
    // server tratta i due casi con la stessa formula. Un solo invio
    // "throttled" per frame (vedi maybeSendInputs in animate()) copre sia
    // i cambi da tastiera che il flusso continuo del gamepad.
    const keys   = { w: false, a: false, s: false, d: false };
    const inputs = { throttle: 0, brake: 0, steer: 0 };

    function applyKeys() {
        inputs.throttle = keys.w ? 1 : 0;
        inputs.brake    = keys.s ? 1 : 0;
        inputs.steer    = (keys.a ? 1 : 0) + (keys.d ? -1 : 0);
    }

    document.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (k === 'w') keys.w = true;
        if (k === 'a') keys.a = true;
        if (k === 's') keys.s = true;
        if (k === 'd') keys.d = true;
        if (k === 'c') cameraMode = cameraMode === 'third' ? 'first' : 'third';
        if (k === 'h') {   // DEBUG: mostra/nascondi le hitbox di collisione
            showHitboxes = !showHitboxes;
            for (const mesh of Object.values(hitboxMeshes)) mesh.visible = showHitboxes;
        }
        applyKeys();
    });

    document.addEventListener('keyup', (e) => {
        const k = e.key.toLowerCase();
        if (k === 'w') keys.w = false;
        if (k === 'a') keys.a = false;
        if (k === 's') keys.s = false;
        if (k === 'd') keys.d = false;
        applyKeys();
    });

    window.addEventListener('blur', () => {
        keys.w = keys.a = keys.s = keys.d = false;
        applyKeys();
    });

    document.addEventListener('contextmenu', e => e.preventDefault());

    function sendInputs() {
        socket.emit('f1Input', { lobbyId, playerColor: myColor, inputs });
    }

    // Invio continuo throttled: chiamato ogni frame da animate(). Manda solo
    // se qualcosa è cambiato di più di un epsilon, e non più spesso del tick
    // fisico server (50ms) — evita di floodare il socket coi valori analogici
    // del gamepad, che cambiano quasi ogni frame anche per il minimo tremore.
    const SEND_EPS = 0.02, SEND_MIN_MS = 50;
    let lastSent = { throttle: 0, brake: 0, steer: 0 };
    let lastSendTime = 0;

    function maybeSendInputs() {
        if (!isRacing) return;
        const now = performance.now();
        const changed = Math.abs(inputs.throttle - lastSent.throttle) > SEND_EPS ||
                        Math.abs(inputs.brake    - lastSent.brake)    > SEND_EPS ||
                        Math.abs(inputs.steer    - lastSent.steer)    > SEND_EPS;
        if (changed && now - lastSendTime >= SEND_MIN_MS) {
            sendInputs();
            lastSent = { ...inputs };
            lastSendTime = now;
        }
    }

    // ── Gamepad ──────────────────────────────────────────────────────────
    // Azioni a tasto (edge-triggered), sterzo/gas/freno analogici li legge
    // animate() via F1GamepadInput.poll() ad ogni frame. X (onConfirm) è
    // contestuale: conferma la mescola se una schermata di scelta è attiva,
    // altrimenti conta come reazione pit stop durante il minigioco.
    if (typeof F1GamepadInput !== 'undefined') {
        F1GamepadInput.setCallbacks({
            onConfirm: () => {
                if (activeTyreContainerId) tyreConfirm();
                else if (pitting) socket.emit('f1PitReactionPress', { lobbyId, playerColor: myColor });
            },
            onCameraToggle: () => { cameraMode = cameraMode === 'third' ? 'first' : 'third'; },
            onNavLeft:      () => tyreNav(-1),
            onNavRight:     () => tyreNav(1),
        });
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

    // Isteresi sulla soglia "fuori pista" usata per scegliere la sorgente
    // della quota visiva (trackY del punto pista vs terrainHeightAt): senza
    // margine, distFromCenter che oscilla anche di pochi centimetri attorno
    // a ROAD_HALF+2 (confermato via log: si assesta esattamente lì quando
    // l'auto tocca il muro rigido del ponte) fa flippare il ramo ogni frame
    // tra due quote radicalmente diverse (quota ponte vs ~0 del terreno
    // sotto), il vero scatto segnalato dall'utente — non un problema di
    // v.x/z vs target.x/z (già escluso in un tentativo precedente). Stato
    // "appiccicoso" per colore: entra nel ramo fuori-pista solo oltre
    // soglia+margine, ne esce solo sotto soglia-margine.
    const OFF_BRIDGE_EDGE_HYSTERESIS = 1.5;
    const _offBridgeEdgeState = {};

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

        if (typeof F1GamepadInput !== 'undefined') {
            const gp = F1GamepadInput.poll();
            if (gp && gp.connected) {
                inputs.throttle = gp.throttle;
                inputs.brake    = gp.brake;
                inputs.steer    = gp.steer;
            }
        }
        maybeSendInputs();

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
                // Fuori pista (stessa soglia di applyOffTrackDrag lato server,
                // roadHalf+2) la quota visiva segue il terrapieno alla
                // posizione REALE dell'auto invece di restare agganciata alla
                // quota dell'indice pista — sui tratti sopraelevati altrimenti
                // l'auto resterebbe a "volare" alla quota pista anche ben
                // oltre il bordo.
                // Decisione e query sulla posizione AUTORITATIVA del server
                // (target.x/z), non su v.x/v.z (smussata via LERP verso quella):
                // su una curva, v.x/v.z può restare per qualche frame dietro/di
                // lato rispetto alla posizione vera già corretta dal muro
                // rigido dei ponti, facendo scattare qui il fallback "fuori
                // pista" anche quando il server non l'ha mai considerata tale —
                // su un vero incrocio (dove terrainHeightAt scende quasi a 0,
                // vedi sopra) questo si vedeva come un crollo/risalita di quota
                // a scatti (segnalato dall'utente).
                const distFromCenter = Math.hypot(target.x - trackPts[idx].x, target.z - trackPts[idx].z);
                // groundPts (non trackPts): se l'auto esce di pista proprio
                // sotto/accanto a un ponte, la quota deve seguire il terreno
                // vero, non agganciarsi al punto-ponte più vicino.
                const wasOffBridgeEdge = _offBridgeEdgeState[color] || false;
                const offBridgeEdge = wasOffBridgeEdge
                    ? distFromCenter > (ROAD_HALF + 2 - OFF_BRIDGE_EDGE_HYSTERESIS)
                    : distFromCenter > (ROAD_HALF + 2 + OFF_BRIDGE_EDGE_HYSTERESIS);
                _offBridgeEdgeState[color] = offBridgeEdge;
                const targetY = offBridgeEdge
                    ? TrackGeometry.terrainHeightAt(groundPts, target.x, target.z, EMBANKMENT_START, BARRIER_D + EMBANKMENT_WIDTH)
                    : (trackPts[idx].y || 0);

                v.y     = (v.y     || 0) + (targetY - (v.y || 0)) * LERP;
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
                // Motore: pitch/volume seguono la velocità REALE in
                // continuo, con range diversi se l'auto sta accelerando o
                // decelerando/rilasciando (anche solo per attrito, senza
                // frenare, è comunque una decelerazione udibile) — stesso
                // loop per entrambe le fasi, nessun file diverso.
                // Eccezione: in corsia box con autopilota (limitatore
                // inserito) il regime è fisso, perché la velocità è
                // costante ma il motore gira comunque, anche se non stai
                // guidando tu in quella fase.
                if (carGroup.userData.engineSound) {
                    const spd     = target.speed || 0;
                    const actxNow = listener.context.currentTime;
                    const RAMP      = 0.08;   // costante di tempo rampa volume (setTargetAtTime), evita click
                    // Il playbackRate salta tra due formule diverse
                    // (accelerando/decelerando) nello stesso istante in cui
                    // lo stato cambia — un salto anche di 0.6 a frac≈1. La
                    // rampa interna di THREE.Audio.setPlaybackRate (fissa a
                    // 10ms) è troppo breve per un salto così ampio e si
                    // sente come un "colpo": qui bypassiamo setPlaybackRate
                    // e rampiamo noi il parametro sottostante, più lento.
                    const RATE_RAMP = 0.15;
                    let targetRate, targetVolume, frac;

                    if (target.pitLimiter) {
                        targetRate   = 0.9;
                        targetVolume = 0.15;
                        frac         = 0.25;   // regime fisso e basso, coerente col limitatore
                    } else {
                        const now = performance.now();
                        const prevChecked = engineLastCheckedSpeed[color];
                        const magPrev = Math.abs(prevChecked ?? spd);
                        const magNow  = Math.abs(spd);
                        if (prevChecked === undefined || Math.abs(magNow - magPrev) > ENGINE_SPEED_DELTA_EPS) {
                            engineActiveSince[color] = now;
                            engineLastCheckedSpeed[color] = spd;
                        }
                        let active = (now - (engineActiveSince[color] || 0)) < ENGINE_ACTIVE_HOLD_MS;
                        // La mia auto: niente silenzio finché tengo premuto
                        // accelera/freno, anche se la velocità ha smesso di
                        // cambiare perché ha toccato il tetto massimo (avanti
                        // o in retromarcia) — lì la variazione di velocità da
                        // sola non basta più a tenere acceso il motore.
                        if (color === myColor && (inputs.throttle > 0 || inputs.brake > 0)) active = true;

                        // Accelerando o decelerando: per la mia auto uso
                        // direttamente i tasti premuti (diretto, niente
                        // ritardo di rete); per le altre auto, di cui non
                        // conosco gli input, lo deduco dalla variazione di
                        // velocità osservata — se non cambia in modo
                        // significativo, tengo l'ultimo stato noto invece di
                        // far sfarfallare il suono.
                        let accelerating;
                        if (color === myColor && (inputs.throttle > 0 || inputs.brake > 0)) {
                            accelerating = inputs.throttle > 0;
                        } else if (magNow > magPrev + ENGINE_SPEED_DELTA_EPS) {
                            accelerating = true;
                        } else if (magNow < magPrev - ENGINE_SPEED_DELTA_EPS) {
                            accelerating = false;
                        } else {
                            accelerating = engineAccelerating[color] ?? true;
                        }
                        engineAccelerating[color] = accelerating;

                        frac = Math.min(1, magNow / ENGINE_REF_MAX_SPEED);
                        if (accelerating) {
                            targetRate   = 0.8 + frac * 0.9;                    // 0.8x fermo → 1.7x a tutta velocità
                            targetVolume = active ? (0.09 + frac * 0.30) : 0;
                        } else {
                            targetRate   = 0.6 + frac * 0.5;                    // 0.6x fermo → 1.1x a tutta velocità, più cupo
                            targetVolume = active ? (0.05 + frac * 0.14) : 0;
                        }
                    }

                    carGroup.userData.engineSound.source.playbackRate.setTargetAtTime(targetRate, actxNow, RATE_RAMP);
                    carGroup.userData.engineSound.gain.gain.setTargetAtTime(targetVolume * ENGINE_VOLUME_MULT, actxNow, RAMP);
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
