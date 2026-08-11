// frontend/f1-testbench.js
//
// Banco prova bot: pagina di sola osservazione, nessun controllo di guida.
// Costruisce la stessa scena 3D di f1.js (pista/scenografia/auto, blocchi
// copiati verbatim — vedi commenti "copiato da f1.js:N-M" sotto) e la anima
// interpolando gli f1StateUpdate ricevuti dalla sessione bot-only del server
// (backend/sockets/games/f1Testbench.js). Nessuna auto "mia": ogni colore
// ricevuto è un bot, gestito allo stesso modo.
(async function () {   // async: il Blocco 2 usa await per caricare engineBuffer, come in f1.js
    const socket = io();
    let otherCars = {};       // color -> THREE.Group
    let visualState = {};     // color -> {x,z,angle} interpolato
    let serverState = {};     // color -> ultimo stato ricevuto dal server
    let currentTrackPts = null;
    let currentRacingLine = null;   // array {x,z} dal server (f1tbRacingLine), null se la pista non ne ha una
    window.followedColor = null;   // usato dal Task 9 per la telecamera

    // Tutti i socket.on(...) sono registrati QUI, prima di qualunque altra
    // cosa (scena Three.js, audio) che richieda tempo — stesso motivo del
    // commento in f1.js intorno alla riga 1302 ("SOLO ora è sicuro
    // chiedere..."): il server emette f1tbTrackList non appena l'handshake
    // si completa, senza aspettare nessuna richiesta del client. Se questi
    // listener venissero registrati dopo l'await di engineBuffer più sotto,
    // ci sarebbe una finestra di race in cui f1tbTrackList arriva prima che
    // il listener esista e va perso silenziosamente (Socket.IO non bufferizza
    // eventi passati per i listener aggiunti in ritardo).
    document.getElementById('f1tb-error').textContent = '';
    socket.on('f1tbError', ({ error }) => {
        document.getElementById('f1tb-error').textContent = error;
    });

    socket.on('f1tbTrackList', (tracks) => {
        const sel = document.getElementById('f1tb-track');
        sel.innerHTML = tracks.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    });

    // Debug visuale traiettoria (Rif. docs/superpowers/specs/2026-07-28-f1-bot-testbench-debug-design.md):
    // arriva una volta per sessione (subito dopo f1tbStart), null se la
    // pista non ha una racing line precalcolata — TrajectoryViz.setRacingLine
    // gestisce già entrambi i casi (rimuove il disegno precedente se presente).
    socket.on('f1tbRacingLine', (line) => {
        currentRacingLine = line;
        TrajectoryViz.setRacingLine(line);
    });

    socket.on('f1StateUpdate', (state) => {
        for (const [color, data] of Object.entries(state)) {
            serverState[color] = data;
            // Guardia combinata: !otherCars[color] da solo resterebbe falsy
            // per TUTTA la durata del caricamento GLB asincrono (otherCars[color]
            // viene assegnato solo dentro onReady) — con un tick server ogni
            // 50ms (PHYSICS_TICK_MS), molto più veloce di un fetch+parse GLB,
            // questo farebbe ripartire loadCarModel ad ogni tick, accumulando
            // Group/PositionalAudio duplicati mai rimossi. visualState[color]
            // viene impostato QUI, in modo sincrono, nello stesso ramo che
            // avvia il caricamento, così da segnare "caricamento già avviato"
            // prima che il prossimo f1StateUpdate arrivi — stesso schema di
            // f1.js:736 (`!otherCars[color] && !visualState[color]`).
            if (!otherCars[color] && !visualState[color]) {
                CarLoader.loadCarModel(color, (g) => { otherCars[color] = g; }, { scene, listener, engineBuffer });
            }
            if (!visualState[color]) visualState[color] = { x: data.x, z: data.z, angle: data.angle };
            if (window.followedColor === null) window.followedColor = color;   // segue la prima auto ricevuta di default
        }
        // Bot Inspector: sempre l'ultimo stato ricevuto per l'auto SEGUITA in
        // questo istante (non quella di quando è arrivato l'evento) — se N
        // cambia auto tra un tick e l'altro, il pannello si aggiorna subito
        // al prossimo f1StateUpdate senza logica separata.
        const followed = state[window.followedColor];
        BotInspector.update(window.followedColor, followed ? followed.botDebug : null);
    });

    // ====================================================
    // THREE.JS SETUP — copiato verbatim da frontend/f1.js:26-59
    // ====================================================
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.FogExp2(0xadd8e6, 0.0022);
    TrajectoryViz.init(scene);

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
    // AUDIO MOTORE — copiato verbatim da frontend/f1.js:170-182 (listener +
    // engineBuffer, incluso resumeAudioContext/AudioListener/AudioLoader):
    // CarLoader.loadCarModel (Task 7) richiede listener/engineBuffer come
    // dipendenze, quindi vanno creati anche qui esattamente come in f1.js.
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

    document.getElementById('f1tb-start').addEventListener('click', async () => {
        const trackId = document.getElementById('f1tb-track').value;

        // Adattato da f1.js righe 66-67,86 (fetch dati pista + campionamento,
        // dalla pista SCELTA nel pannello invece che fissa).
        const trackRes  = await fetch(`/tracks/${trackId}.json`);
        const trackData = await trackRes.json();
        currentTrackPts = TrackGeometry.sampleLoop(trackData.controlPoints, 1000);
        // Alias locale "trackPts": i blocchi copiati verbatim da f1.js più
        // sotto usano questo nome; currentTrackPts resta la variabile di
        // modulo esposta per il Task 9 (telecamera).
        const trackPts  = currentTrackPts;
        const PIT_PTS   = TrackGeometry.sampleOpenPath(trackData.pit.path, 300);

        // ====================================================
        // COSTANTI GEOMETRIA PISTA — copiate verbatim da frontend/f1.js:69-82
        // ====================================================
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

        // ====================================================
        // TERRENO ERBOSO — copiato verbatim da frontend/f1.js:123-129
        // ====================================================
        TrackMeshBuilder.buildGround(scene, trackPts, BARRIER_D + EMBANKMENT_WIDTH, 3000);
        // Pianoro di larghezza zero (secondo e terzo argomento uguali all'attacco):
    // il banco prova non disegna le vie di fuga, quindi il terrapieno resta
    // quello storico che comincia a scendere subito dopo il cordolo.
    TrackMeshBuilder.buildEmbankment(scene, trackPts, EMBANKMENT_START, EMBANKMENT_START, BARRIER_D + EMBANKMENT_WIDTH);
        // Punti "a terra" (non-ponte): usati per la quota reale sotto un ponte.
        const groundPts = trackPts.filter(p => !p.bridge);
        TrackMeshBuilder.buildBridgeDecks(scene, trackPts, groundPts, ROAD_HALF + CURB_W, EMBANKMENT_START, EMBANKMENT_START, BARRIER_D + EMBANKMENT_WIDTH);

        // ====================================================
        // PISTA / CORDOLI / BARRIERE — copiato verbatim da frontend/f1.js:152-154
        // (buildStartLine/buildPitLane esclusi: fuori scope per questo strumento)
        // ====================================================
        // DoubleSide evita artefatti di culling nelle zone ad alta curvatura
        TrackMeshBuilder.buildRibbon(scene, trackPts, ROAD_HALF, new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.95, side: THREE.DoubleSide }));
        TrackMeshBuilder.buildCurbs(scene, trackPts, ROAD_HALF, CURB_W);
        TrackMeshBuilder.buildBarriers(scene, trackPts, BARRIER_D);

        // ====================================================
        // SCENOGRAFIA — copiato verbatim da frontend/f1.js:220-290
        // (SCENERY_ASSET_PATHS + loadScenery + TrackScenery.generateLayout;
        // non serve la minimappa, fuori scope per questo strumento).
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

        const sceneryLayout = TrackScenery.generateLayout(trackData, trackPts, PIT_PTS, BARRIER_D, EMBANKMENT_WIDTH);
        loadScenery(scene, sceneryLayout);

        // Variante racing line sperimentale (verifica C): stringa vuota =
        // "Ufficiale" = nessun override, il campo non va nemmeno incluso nel
        // payload (il server tratta racelineVariant assente come "percorso
        // normale", vedi f1Testbench.js).
        const racelineVariant = document.getElementById('f1tb-raceline-variant').value;

        socket.emit('f1tbStart', {
            trackId,
            botCount: Number(document.getElementById('f1tb-botcount').value),
            tyreWear: Number(document.getElementById('f1tb-tyrewear').value),
            compound: document.getElementById('f1tb-compound').value,
            damageParts: {
                frontWing:  Number(document.getElementById('f1tb-dmg-frontwing').value),
                floor:      Number(document.getElementById('f1tb-dmg-floor').value),
                engine:     Number(document.getElementById('f1tb-dmg-engine').value),
                suspension: Number(document.getElementById('f1tb-dmg-suspension').value)
            },
            ...(racelineVariant ? { racelineVariant } : {})
        });
    });
    document.getElementById('f1tb-stop').addEventListener('click', () => socket.emit('f1tbStop'));
    document.getElementById('f1tb-step').addEventListener('click', () => socket.emit('f1tbStep'));

    let paused = false;
    document.getElementById('f1tb-pauseresume').addEventListener('click', (e) => {
        paused = !paused;
        socket.emit(paused ? 'f1tbPause' : 'f1tbResume');
        e.target.textContent = paused ? 'Riprendi' : 'Pausa';
    });
    document.getElementById('f1tb-speed').addEventListener('change', (e) => {
        socket.emit('f1tbSetSpeed', { multiplier: Number(e.target.value) });
    });

    // Slider danno di partenza: solo aggiornamento dell'etichetta percentuale,
    // il valore viene letto direttamente dagli input al momento di Avvia
    // (vedi f1tbStart sopra) — nessuno stato JS duplicato qui.
    for (const part of ['frontwing', 'floor', 'engine', 'suspension']) {
        const input = document.getElementById(`f1tb-dmg-${part}`);
        const label = document.getElementById(`f1tb-dmg-${part}-val`);
        input.addEventListener('input', () => { label.textContent = input.value; });
    }

    // Telecamera a ciclo tra le auto — tasto N (adattato da f1.js:1337-1350,
    // solo il ramo 'third', questo strumento non ha bisogno della cockpit-cam).
    const _camOff  = new THREE.Vector3();
    const _lookTgt = new THREE.Vector3();

    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() !== 'n') return;
        const colors = Object.keys(otherCars);
        if (colors.length === 0) return;
        const currentIdx = colors.indexOf(window.followedColor);
        window.followedColor = colors[(currentIdx + 1) % colors.length];
    });

    function updateSpectatorCamera() {
        const color = window.followedColor;
        const carGroup = color && otherCars[color];
        if (!carGroup) return;
        const pos = carGroup.position;
        const q   = carGroup.quaternion;

        _camOff.set(0, 5.5, -13);
        _camOff.applyQuaternion(q);
        camera.position.copy(pos).add(_camOff);
        _lookTgt.copy(pos).add(new THREE.Vector3(0, 1.2, 0));
        camera.lookAt(_lookTgt);
    }

    // Interpolazione posizione/auto, adattata da f1.js (render loop LERP):
    // stessa logica, ma senza il ramo "mia auto" — qui non esiste myColor,
    // ogni colore ricevuto è un'auto "degli altri".
    function updateCarVisuals() {
        for (const [color, target] of Object.entries(serverState)) {
            const v = visualState[color];
            if (!v) continue;
            const LERP = 0.18;   // valore scelto per questo strumento (in f1.js oggi è 0.22)
            v.x     += (target.x - v.x) * LERP;
            v.z     += (target.z - v.z) * LERP;
            v.angle  = target.angle;   // niente lerp angolare: sufficiente per uno strumento di osservazione, evita di copiare lerpAngle da f1.js
            const carGroup = otherCars[color];
            if (carGroup) {
                carGroup.position.set(v.x, 0, v.z);
                carGroup.rotation.y = v.angle;
            }
        }
    }

    // Marker target/lookahead + racing line (Rif.
    // docs/superpowers/specs/2026-07-28-f1-bot-testbench-debug-design.md):
    // SOLA lettura di dati già calcolati (_botDebug.target, trackIndex) —
    // nessuna influenza sulla guida, il bot continua a decidere tramite la
    // vera tickGame esattamente come senza questo strumento.
    function updateTrajectoryViz() {
        const color = window.followedColor;
        const data = color && serverState[color];
        const carPos = color && visualState[color];
        if (!data || !carPos) { TrajectoryViz.hide(); return; }

        const target = data.botDebug ? data.botDebug.target : null;
        // Stessa linea che il bot sta davvero seguendo in quel ramo (racing
        // line se la pista ne ha una precalcolata, altrimenti il centro
        // pista campionato — vedi f1Bot.js): il waypoint mostrato è il punto
        // sulla linea alla posizione REALE del bot (trackIndex), non al
        // lookahead già rappresentato dal marker target.
        const laneSource = currentRacingLine || currentTrackPts;
        const waypoint = (laneSource && data.trackIndex != null) ? laneSource[data.trackIndex] : null;

        TrajectoryViz.update(carPos, target, waypoint);
    }

    function animate() {
        requestAnimationFrame(animate);
        updateCarVisuals();
        updateSpectatorCamera();
        updateTrajectoryViz();
        renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
})();
