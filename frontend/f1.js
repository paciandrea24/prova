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

    // --- INIZIO GESTIONE FIREBASE E LIVREA ---
    let loadedLivery = null;

    // 1. Aspettiamo (in modo asincrono) che Firebase inizializzi l'auth e ci dica se siamo loggati
    const user = await new Promise((resolve) => {
        const unsubscribe = firebase.auth().onAuthStateChanged((u) => {
            unsubscribe(); // Ci basta saperlo una volta all'avvio
            resolve(u);
        });
    });

    // 2. Se siamo loggati, proviamo a prendere la nostra livrea dal database
    if (user) {
        console.log("[F1] Utente loggato in gara:", user.uid);
        try {
            const res = await fetch(`/api/livery/${user.uid}`);
            if (res.ok) {
                loadedLivery = await res.json();
                console.log("[F1] Livrea personale caricata con successo!");
            } else {
                console.warn("[F1] Livrea non trovata nel database.");
            }
        } catch (e) {
            console.error("[F1] Errore durante il fetch della livrea:", e);
        }
    } else {
        console.log("[F1] Giocatore ospite, nessuna livrea da caricare.");
    }

    // 3. NESSUN fallback a una fixture JSON condivisa: se non c'è una livrea
    // salvata (ospite, o account senza livrea) loadedLivery resta null e
    // CarLoader.loadCarModel colora la carrozzeria col colore scelto in
    // lobby (myColor) — stesso comportamento di bot e altri ospiti, e stesso
    // comportamento del gioco prima delle livree custom. Usare una fixture
    // fissa qui produceva la stessa identica livrea rossa per chiunque non
    // avesse un account con livrea salvata (bug reale osservato in
    // localhost: bot e guest tutti con la stessa livrea).
    const TEST_LIVERY_COLORS = loadedLivery;
    // --- FINE GESTIONE LIVREA ---

    const socket = io({ transports: ['websocket'], upgrade: false });

    // Riconnessione
    socket.io.on('reconnect', () => {
        socket.emit('joinLobby', { lobbyId, color: myColor });
        socket.emit('joinF1Game', { lobbyId, playerColor: myColor, uid: user ? user.uid : null });
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
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping;
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
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 600;
    sun.shadow.camera.left = -300;
    sun.shadow.camera.right = 300;
    sun.shadow.camera.top = 300;
    sun.shadow.camera.bottom = -300;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    // ====================================================
    // COSTRUZIONE PISTA 3D — dati caricati dal JSON della pista scelta
    // (vedi frontend/tracks/), stessa geometria usata dal server tramite
    // backend/sockets/games/trackLoader.js.
    // ====================================================
    const trackRes = await fetch(`/tracks/${trackId}.json`);
    const trackData = await trackRes.json();

    const ROAD_HALF = trackData.roadHalfWidth;
    const CURB_W = 2.8;
    const BARRIER_D = ROAD_HALF + CURB_W + 1.2;
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

    const N_SAMPLES = 1000;
    const trackPts = TrackGeometry.sampleLoop(trackData.controlPoints, N_SAMPLES);
    // Aggancia il primo/ultimo punto della corsia box al bordo pista vero
    // (Rif. richiesta utente 2026-08-08) — stessa funzione usata dal
    // server (trackLoader.js::buildTrack) sugli stessi punti di controllo
    // grezzi, quindi il disegno qui corrisponde ESATTAMENTE alla posizione
    // fisica reale dell'auto in uscita dai box.
    const PIT_PATH = TrackGeometry.snapPitPathEnds(trackData.pit.path, trackPts, ROAD_HALF);

    // ====================================================
    // MINIMAPPA — contorno pista + corsia box in SVG, generati una tantum
    // proiettando trackPts/PIT_PTS (x,z) sul piano. Nessuna finezza di
    // parametrizzazione per arco: i vertici campionati sono già lisci a
    // queste dimensioni. Trasformazione (scala/offset) calcolata UNA VOLTA
    // sull'ingombro di entrambi i tracciati insieme, non solo della pista
    // principale: altrimenti la corsia box, se sporge anche di poco dal
    // riquadro della pista, finirebbe tagliata fuori dai margini.
    // ====================================================
    function minimapTransform(allPts) {
        const xs = allPts.map(p => p.x), zs = allPts.map(p => p.z);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minZ = Math.min(...zs), maxZ = Math.max(...zs);
        const w = maxX - minX, h = maxZ - minZ;
        const VB_W = 200, VB_H = 140, MARGIN = 16;
        const scale = Math.min((VB_W - MARGIN * 2) / w, (VB_H - MARGIN * 2) / h);
        const offX = MARGIN + (VB_W - MARGIN * 2 - w * scale) / 2 - minX * scale;
        const offZ = MARGIN + (VB_H - MARGIN * 2 - h * scale) / 2 - minZ * scale;
        return { scale, offX, offZ };
    }

    // `closed`: true per un anello (pista, si richiude su se stessa con Z),
    // false per un percorso aperto (corsia box, che non è un loop).
    function minimapPathString(pts, transform, closed) {
        const toSvg = (p) => `${(p.x * transform.scale + transform.offX).toFixed(1)},${(p.z * transform.scale + transform.offZ).toFixed(1)}`;
        return `M ${toSvg(pts[0])} ` + pts.slice(1).map(p => `L ${toSvg(p)}`).join(' ') + (closed ? ' Z' : '');
    }

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

    // Stessi punti campionati (e "abbracciati" alla curva pista vicino agli
    // estremi, TrackGeometry.tuckPitEndsToTrack) usati internamente da
    // TrackMeshBuilder.buildPitLane (che li ricalcola per conto suo): un
    // secondo ricalcolo qui è economico (300 campioni, una tantum al
    // caricamento) e serve per generare la scenografia/il varco barriera
    // senza toccare la firma di buildPitLane. Stessa funzione pura con gli
    // stessi input di buildPitLane → stesso risultato, nessun rischio di
    // divergenza tra corsia box disegnata e varco/scenografia.
    const PIT_PTS = TrackGeometry.tuckPitEndsToTrack(TrackGeometry.sampleOpenPath(PIT_PATH, 300), trackPts);

    // Solo i campioni vicino ai due estremi (entro PIT_MERGE_WINDOW unità
    // d'arco da ciascuno, un margine oltre i 35 di
    // TrackGeometry.tuckPitEndsToTrack di default) — non l'intero PIT_PTS:
    // il varco barriera deve aprirsi SOLO al vero ingresso/uscita, non
    // ovunque il tracciato passi vicino a un punto qualunque della corsia
    // box (bug reale misurato in playtest: 139m di varco spurio su "prova"
    // dove la pista passava vicino alla zona box/stalli, con l'intero
    // PIT_PTS). Usare i campioni "abbracciati" alla curva (non solo i due
    // punti estremi) fa sì che anche la FORMA del varco segua la vera
    // curvatura della pista, non un semplice cerchio attorno a un punto.
    const PIT_MERGE_WINDOW = 75;
    function pitMergeSamples(pts) {
        const n = pts.length;
        const cum = [0];
        for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
        const total = cum[n - 1];
        return pts.filter((_, i) => cum[i] < PIT_MERGE_WINDOW || total - cum[i] < PIT_MERGE_WINDOW);
    }

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
    TrackMeshBuilder.buildBarriers(scene, trackPts, BARRIER_D, pitMergeSamples(PIT_PTS));
    TrackMeshBuilder.buildStartLine(scene, trackPts, ROAD_HALF);
    // drawBoxMarker=false: il riquadro giallo unico su boxIndex era il solo
    // indicatore visivo quando il box era un punto condiviso da tutti; ora
    // ogni pilota ha il proprio box 3D colorato (vedi loadPlayerPitBox,
    // caricato pigramente per gara), che ne prende il posto in gara —
    // resta true di default per l'editor tracciato (track-editor.js).
    TrackMeshBuilder.buildPitLane(scene, PIT_PATH, trackData.pit.roadHalfWidth, trackData.pit.boxIndex, false, trackPts, 0x1e1e1e);

    // Griglia di partenza vera, permanente sulla pista (Rif. richiesta
    // utente 2026-08-07: "visibile sia in qualifica che in gara") — stessa
    // tecnica di startFinishIndex già usata server-side
    // (backend/sockets/games/trackLoader.js): indice campionato più vicino
    // al traguardo esplicito se la pista ne ha uno, altrimenti 0 (piste
    // non ancora riaperte nell'editor). MAX_GRID_SIZE=6 non è geometrico
    // (è una regola di gioco, f1Bot.js::MAX_GRID_SIZE) — tenerlo in sync a
    // mano se mai cambiasse.
    const START_FINISH_INDEX = trackData.startFinish
        ? TrackGeometry.nearestPoint(trackPts, trackData.startFinish.x, trackData.startFinish.z).index
        : 0;
    const MAX_GRID_SIZE = 6;
    TrackMeshBuilder.buildStartingGrid(scene, trackPts, START_FINISH_INDEX, MAX_GRID_SIZE);

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
        treeLarge: '/assets/kenney/treeLarge.glb',
        treeSmall: '/assets/kenney/treeSmall.glb',
        grandStand: '/assets/kenney/grandStand.glb',
        grandStandAwning: '/assets/kenney/grandStandAwning.glb',
        grandStandCovered: '/assets/kenney/grandStandCovered.glb',
        billboard: '/assets/kenney/billboard.glb',
        billboardLow: '/assets/kenney/billboardLow.glb',
        pitsGarageClosed: '/assets/kenney/pitsGarageClosed.glb',
        pitsOffice: '/assets/kenney/pitsOffice.glb',
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
                    im.castShadow = true;
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
    // LOADER GLB (macchina colorata per team)
    // ====================================================
    // recolorLiveryTexture/loadCarModel estratti in frontend/shared/carLoader.js
    // (condiviso col banco prova bot in frontend/f1-testbench.js) — questo è
    // solo un thin wrapper che passa le dipendenze locali.
    function loadCarModel(playerColor, onReady, liveryColors) {
        CarLoader.loadCarModel(playerColor, onReady, { scene, listener, engineBuffer }, liveryColors);
    }

    // ====================================================
    // EFFETTO SCIA — piccoli voxel che simulano il vento dietro l'auto
    // (prima erano linee tratteggiate, sostituite su richiesta esplicita
    // dell'utente con qualcosa in stile "boxy" coerente col resto degli
    // asset). Visibile solo quando il server segnala il bonus di velocità
    // in scia (f1StateUpdate → slipstream), SOLO sulla propria auto (come
    // l'effetto precedente). Pool fisso di cubetti riciclati: ognuno nasce
    // appena dietro al paraurti, deriva all'indietro con un po' di
    // turbolenza laterale/verticale, si rimpicciolisce fino a sparire, poi
    // rinasce — nessuna vera trasparenza per-istanza (non supportata dai
    // materiali base di InstancedMesh in questa versione di Three.js), la
    // dissolvenza è resa restringendo la scala. Un'unica InstancedMesh =
    // una sola draw call per tutti i cubetti, economico. Coordinate nello
    // stesso spazio locale non scalato del group esterno (vedi wheels
    // sintetiche sopra, z negativo = retro auto).
    // ====================================================
    const SLIPSTREAM_VOXEL_COUNT = 22;
    const SLIPSTREAM_VOXEL_SIZE = 0.16;
    const SLIPSTREAM_SPAWN_Z = -3.9;          // appena dietro il paraurti posteriore
    const SLIPSTREAM_SPAWN_SPREAD_X = 1.1;    // mezza larghezza di spawn
    const SLIPSTREAM_SPAWN_SPREAD_Y = 0.5;
    const SLIPSTREAM_SPAWN_CENTER_Y = 0.7;
    const SLIPSTREAM_DRIFT_Z = 0.09;          // velocità all'indietro, per frame
    const SLIPSTREAM_TURBULENCE = 0.012;      // scarto laterale/verticale casuale, per frame
    const SLIPSTREAM_LIFE_FRAMES = 55;        // durata di un cubetto prima di rinascere

    const slipstreamVoxelMaterial = new THREE.MeshBasicMaterial({
        color: 0xdfe3e6, transparent: true, opacity: 0.55
    });
    const slipstreamVoxelGeometry = new THREE.BoxGeometry(1, 1, 1);
    const _slipstreamDummy = new THREE.Object3D();

    function spawnSlipstreamVoxel(state, i) {
        state.x[i] = (Math.random() - 0.5) * SLIPSTREAM_SPAWN_SPREAD_X * 2;
        state.y[i] = SLIPSTREAM_SPAWN_CENTER_Y + (Math.random() - 0.5) * SLIPSTREAM_SPAWN_SPREAD_Y * 2;
        state.z[i] = SLIPSTREAM_SPAWN_Z - Math.random() * 1.5;   // sfalsati lungo la scia, non tutti insieme
        state.age[i] = Math.random() * SLIPSTREAM_LIFE_FRAMES;   // sfalsati anche nel tempo di vita
        state.baseScale[i] = 0.6 + Math.random() * 0.7;
    }

    function buildSlipstreamEffect() {
        const mesh = new THREE.InstancedMesh(slipstreamVoxelGeometry, slipstreamVoxelMaterial, SLIPSTREAM_VOXEL_COUNT);
        mesh.visible = false;
        const state = { x: [], y: [], z: [], age: [], baseScale: [] };
        for (let i = 0; i < SLIPSTREAM_VOXEL_COUNT; i++) spawnSlipstreamVoxel(state, i);
        mesh.userData.slipstreamState = state;
        return mesh;
    }

    function updateSlipstreamVoxels(mesh) {
        const state = mesh.userData.slipstreamState;
        for (let i = 0; i < SLIPSTREAM_VOXEL_COUNT; i++) {
            state.age[i]++;
            if (state.age[i] >= SLIPSTREAM_LIFE_FRAMES) {
                spawnSlipstreamVoxel(state, i);
            } else {
                state.z[i] -= SLIPSTREAM_DRIFT_Z;
                state.x[i] += (Math.random() - 0.5) * SLIPSTREAM_TURBULENCE;
                state.y[i] += (Math.random() - 0.5) * SLIPSTREAM_TURBULENCE;
            }
            const lifeT = state.age[i] / SLIPSTREAM_LIFE_FRAMES;   // 0 appena nato -> 1 a fine vita
            // Cresce appena nato, si restringe verso la fine (dissolvenza via scala,
            // vedi commento sopra sul perché niente vera trasparenza per-istanza).
            const fade = lifeT < 0.15 ? (lifeT / 0.15) : (1 - (lifeT - 0.15) / 0.85);
            const scale = SLIPSTREAM_VOXEL_SIZE * state.baseScale[i] * Math.max(0, fade);
            _slipstreamDummy.position.set(state.x[i], state.y[i], state.z[i]);
            _slipstreamDummy.scale.setScalar(scale);
            _slipstreamDummy.updateMatrix();
            mesh.setMatrixAt(i, _slipstreamDummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
    }

    // ====================================================
    // STATO DI GIOCO
    // ====================================================
    let myCarGroup = null;
    let slipstreamGroup = null;
    let slipstreamActive = false;
    let cameraMode = 'third';
    let isRacing = false;
    let myFinalTime = null;
    // Tempo trascorso "vero" per il timer HUD live (Rif. 2026-08-07):
    // ANCORATO a state[myColor].elapsedMs (conteggio di tick fisici lato
    // server, la STESSA fonte usata per il tempo finale — vedi checkLap),
    // ma tra un f1StateUpdate e il prossimo (~50ms, a volte di più per il
    // jitter del tick loop — vedi nota su PHYSICS_TICK_MS) il rendering
    // (~60fps) estrapola in avanti con Date.now() dall'ultimo aggancio:
    // altrimenti il numero "scatta" a salti di 50/150ms invece di scorrere
    // liscio (segnalato dall'utente). Ri-agganciato ad ogni tick reale, non
    // può quindi derivare come il vecchio Date.now()-localStart.
    let myLiveElapsedMs = null;
    let myLiveElapsedSyncedAt = null;
    // Delta continuo rispetto al giro precedente (Rif.
    // docs/superpowers/specs/2026-08-07-f1-sector-timing-design.md): letto
    // una volta per f1StateUpdate (~50ms), usato solo per colorare
    // #hud-timer — non serve estrapolazione locale come myLiveElapsedMs.
    let myDeltaToPreviousLapMs = null;
    // Sessione di qualifica "ancora aperta" agli occhi del client — driven
    // SOLO dagli eventi di ciclo vita (mai da target.finished, vedi sotto),
    // per il pannello "in attesa degli altri piloti". Rif. 2026-08-07,
    // terzo giro: durante 'grid_display' (il pannello coi tempi di tutti)
    // playersVisibleTo() lato server ritorna ESPLICITAMENTE {} per quella
    // fase (f1GameSocket.js) — nessun f1StateUpdate arriva più finché non
    // si passa a 'race', quindi target.finished per il proprio colore resta
    // congelato a true per TUTTA la durata della griglia (non ~1 tick come
    // creduto al giro precedente): un mostra/nascondi basato sullo stato
    // "vivo" del giocatore non può funzionare in questa fase, serve sapere
    // se la sessione è chiusa indipendentemente da quel dato.
    let qualiSessionOpen = false;
    let hostColor = null;
    let currentPhase = null;   // tyre_select | qualifying | grid_display | race
    let raceTotalLaps = 3;      // giri della gara vera (fisso, indipendente dalla fase corrente)

    let tyrePanelOpen = false;   // stato locale, mai sincronizzato col server — resettato a chiuso ad ogni f1Countdown
    let debugPanelOpen = false;   // pannello debug usura/guasti (tasto G), stato locale, mai sincronizzato col server
    let lightsSequenceActive = false;   // true durante la plancia luci del via gara (non in qualifica)

    // Interpola verde -> giallo -> rosso in base all'usura (0-100): stessa
    // scala già usata nel mockup approvato dall'utente.
    function wearColor(pct) {
        const stops = [
            [0, [79, 191, 130]],
            [55, [217, 178, 60]],
            [100, [198, 91, 82]],
        ];
        for (let i = 0; i < stops.length - 1; i++) {
            const [p0, c0] = stops[i], [p1, c1] = stops[i + 1];
            if (pct >= p0 && pct <= p1) {
                const f = (pct - p0) / (p1 - p0);
                const c = c0.map((v, idx) => Math.round(v + (c1[idx] - v) * f));
                return `rgb(${c[0]},${c[1]},${c[2]})`;
            }
        }
        return `rgb(${stops[stops.length - 1][1].join(',')})`;
    }

    // Il pannello gomme ha senso SOLO in gara (in qualifica/tyre_select/
    // grid_display l'usura non è mai rilevante — stessa logica del vecchio
    // tyre-box). Dentro la gara, mostra o l'icona chiusa o il pannello
    // esteso a seconda di tyrePanelOpen, mai entrambi.
    function renderTyreVisibility() {
        const closedEl = document.getElementById('tyre-closed');
        const openEl = document.getElementById('tyre-open');
        if (currentPhase !== 'race') {
            closedEl.style.display = 'none';
            openEl.style.display = 'none';
            return;
        }
        closedEl.style.display = tyrePanelOpen ? 'none' : 'flex';
        openEl.style.display = tyrePanelOpen ? 'block' : 'none';
    }

    // Mostra il giro CORRENTE che si sta guidando (convenzione vera F1: durante
    // l'ultimo giro di una gara a 3 giri si legge "3/3" per tutto il giro, non
    // "2/3" — altrimenti il traguardo finale sembra arrivare "un giro prima").
    // `completedLaps` è il conteggio di giri già completati (0 all'inizio);
    // in qualifica il totale è sempre 1 giro secco, mai quello della gara vera.
    function setLapDisplay(completedLaps, phaseName) {
        const el = document.getElementById('lap-chip-value');
        // In qualifica non ha senso mostrare "1/1" (un solo giro secco non è
        // un rapporto giri/totale) — l'utente lo trovava fuorviante. Nota:
        // il pannello che contiene questo chip è visibile SOLO in gara
        // (vedi updateStandings), quindi questa scrittura in qualifica non
        // si vede mai — innocua, non serve un controllo in più per evitarla.
        if (phaseName === 'qualifying') {
            el.textContent = 'GIRO SECCO';
            return;
        }
        const current = Math.min(completedLaps + 1, raceTotalLaps);
        el.textContent = `${current}/${raceTotalLaps}`;
    }

    const serverState = {};
    const visualState = {};
    const otherCars = {};

    // Un box colorato per pilota lungo la corsia box (vedi
    // docs/superpowers/specs/2026-08-03-f1-pit-boxes-design.md). Caricato
    // pigramente al primo f1StateUpdate che porta un pitBoxSlot per quel
    // colore — non sincrono con la scenografia statica (sceneryLayout più
    // sopra), perché lo stato dei giocatori non è ancora noto in quel punto
    // del caricamento pagina.
    const pitBoxes = {};
    const pendingPitBoxLoads = new Set();
    // Guardia SEPARATA da pitBoxes/pendingPitBoxLoads (quelle riguardano
    // solo il modello 3D del garage, caricato in modo asincrono e con
    // retry su errore): la segnaletica a terra è sincrona e non fallisce
    // mai, ma non deve comunque essere aggiunta più volte alla scena ad
    // ogni f1StateUpdate.
    const stallMarkersAdded = new Set();

    // Il server manda già l'anchor calcolato (assignGridSpawns →
    // TrackGeometry.pitBoxAnchors), il client si limita a posizionare/
    // ruotare il modello: niente più bisogno di ricalcolare/duplicare la
    // stessa geometria lato client, niente più rischio di disallineamento
    // se il conteggio giocatori cambia a gara in corso (prima si
    // ricalcolava da pitBoxSlot + Object.keys(state).length, che poteva
    // divergere dall'N usato lato server in assignGridSpawns dopo una
    // rimozione mid-race — game.grid non viene mai potato — causando un
    // box disallineato o, peggio, un accesso fuori indice che mandava in
    // eccezione l'handler f1StateUpdate — bug trovato dalla review finale).
    function loadPlayerPitBox(color, anchor) {
        if (pitBoxes[color] || pendingPitBoxLoads.has(color)) return;
        pendingPitBoxLoads.add(color);

        const nx = -anchor.tz, nz = anchor.tx;   // normale, perpendicolare alla tangente della corsia

        // Stessa tecnica di trackScenery.js::buildPaddockLayout: tra le due
        // direzioni normali, si sceglie quella che allontana di più dal
        // centro del circuito (lato "verso l'esterno").
        const distPlus = TrackGeometry.nearestPoint(trackPts, anchor.x + nx, anchor.z + nz).dist;
        const distMinus = TrackGeometry.nearestPoint(trackPts, anchor.x - nx, anchor.z - nz).dist;
        const side = distPlus >= distMinus ? 1 : -1;

        // PitBoxLoader.PIT_BOX_OFFSET_MARGIN (non TrackScenery.PIT_BUILDING_OFFSET_MARGIN,
        // tarato sui piccoli edifici decorativi Kenney): il box giocatore
        // reale è molto più grande, serve un margine che tenga conto del
        // suo ingombro misurato — vedi commento in pitBoxLoader.js.
        const offset = trackData.pit.roadHalfWidth + PitBoxLoader.PIT_BOX_OFFSET_MARGIN;
        const bx = anchor.x + nx * offset * side, bz = anchor.z + nz * offset * side;
        const rotY = Math.atan2(anchor.x - bx, anchor.z - bz);   // guarda verso la corsia

        // Segnaletica a terra dello stallo (Rif. richiesta utente
        // 2026-08-07: "stalli veri" come in F1 reale, non solo il modello
        // del garage) — rettangolo colorato del pilota, piazzato sullo
        // stesso stallo dove si ferma davvero l'auto (anchor.stallX/stallZ,
        // già calcolato server-side da TrackGeometry.pitBoxAnchors),
        // orientato con l'asse lungo parallelo alla corsia (stessa
        // convenzione rotY di un'auto: atan2(tangente.x, tangente.z)) — la
        // macchina si ferma parallela al senso di marcia, non più diagonale
        // verso il garage. Guardia SEPARATA dal modello 3D (sincrona, non
        // fallisce mai): un retry del modello dopo un errore di rete non
        // deve ri-aggiungere una segnaletica duplicata.
        if (!stallMarkersAdded.has(color) && anchor.stallX != null && anchor.stallZ != null) {
            const marker = new THREE.Mesh(
                new THREE.BoxGeometry(PitBoxLoader.STALL_WIDTH, 0.03, PitBoxLoader.STALL_LENGTH),
                new THREE.MeshStandardMaterial({ color: parseInt(color.replace('#', ''), 16), roughness: 0.9, transparent: true, opacity: 0.55 })
            );
            marker.position.set(anchor.stallX, 0.04, anchor.stallZ);
            marker.rotation.y = Math.atan2(anchor.tx, anchor.tz);
            scene.add(marker);
            stallMarkersAdded.add(color);
        }

        PitBoxLoader.loadPitBoxModel(color, { x: bx, y: 0, z: bz, rotY }, (model) => {
            scene.add(model);
            pitBoxes[color] = model;
            pendingPitBoxLoads.delete(color);
        }, () => {
            pendingPitBoxLoads.delete(color);   // permette un nuovo tentativo al prossimo state update (vedi pitBoxLoader.js)
        });
    }

    // Livrea VERA di ogni avversario (bug reale: prima si applicava sempre
    // TEST_LIVERY_COLORS, cioè la propria, a tutte le auto altrui). Cache per
    // uid: più colori/rejoin possono condividere lo stesso uid nel tempo, un
    // solo fetch basta. pendingCarLoads evita doppio loadCarModel per lo
    // stesso colore mentre il fetch è ancora in volo (il player object arriva
    // ad ogni tick, ~20Hz, ben prima che GLTF+livrea siano pronti).
    const liveryCacheByUid = new Map();   // uid -> Promise<livery|null>
    const pendingCarLoads = new Set();    // color attualmente in caricamento

    function fetchLiveryForUid(uid) {
        if (!uid) return Promise.resolve(null);
        if (!liveryCacheByUid.has(uid)) {
            liveryCacheByUid.set(uid, fetch(`/api/livery/${uid}`)
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null));
        }
        return liveryCacheByUid.get(uid);
    }

    // Carica l'auto di un avversario con la SUA livrea vera. Se uid è null
    // (bot/ospite) o non ha nulla di salvato, livery resta null: CarLoader
    // colora la carrozzeria col colore scelto in lobby (color), MAI con una
    // fixture condivisa (produceva la stessa livrea per tutti i bot/ospiti)
    // e MAI con TEST_LIVERY_COLORS (che è la livrea di chi guarda, non un default).
    async function loadOtherCar(color, uid, onReady) {
        if (otherCars[color] || pendingCarLoads.has(color)) return;
        pendingCarLoads.add(color);
        const livery = await fetchLiveryForUid(uid);
        if (otherCars[color]) { pendingCarLoads.delete(color); return; }   // creata nel frattempo
        loadCarModel(color, (g) => {
            pendingCarLoads.delete(color);
            onReady(g);
        }, livery);
    }

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
    const engineActiveSince = {};
    const engineLastCheckedSpeed = {};
    const engineAccelerating = {};
    const ENGINE_ACTIVE_HOLD_MS = 400;
    const ENGINE_SPEED_DELTA_EPS = 0.02;

    // ====================================================
    // DEBUG: hitbox visibili (tasto H) — stessi valori di CAR_HALF_LENGTH/
    // CAR_HALF_WIDTH lato server. Posizionate sulla posizione REALE del
    // server (serverState), non su quella interpolata (visualState), per
    // poter verificare a occhio eventuali disallineamenti tra fisica e resa.
    // ====================================================
    const HITBOX_HALF_LEN = 3.58, HITBOX_HALF_WID = 1.74, HITBOX_HEIGHT = 1.5;
    let showHitboxes = false;  // toggle con H, debug only
    const hitboxMeshes = {};

    function getHitboxMesh(color) {
        if (hitboxMeshes[color]) return hitboxMeshes[color];
        const geo = new THREE.BoxGeometry(HITBOX_HALF_WID * 2, HITBOX_HEIGHT, HITBOX_HALF_LEN * 2);
        const edges = new THREE.EdgesGeometry(geo);
        const mat = new THREE.LineBasicMaterial({ color: color === myColor ? 0x00ff00 : 0xff0000 });
        const mesh = new THREE.LineSegments(edges, mat);
        mesh.position.y = HITBOX_HEIGHT / 2;
        scene.add(mesh);
        hitboxMeshes[color] = mesh;
        return mesh;
    }

    // ====================================================
    // SELEZIONE MESCOLA
    // ====================================================
    let tyreSelectActive = false;   // true mentre siamo in fase tyre_select: la camera orbita sul tracciato
    let tyreOrbitAngle = 0;
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
                anime({
                    targets: card,
                    scale: [1, 1.12, 1],
                    duration: 320,
                    easing: 'easeOutElastic(1, 0.6)',
                });
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

        // Ingresso a cascata: le card compaiono una dopo l'altra invece di
        // tutte insieme, ogni volta che questa funzione viene chiamata
        // (apertura schermo scelta iniziale o pannello ai box).
        anime({
            targets: container.querySelectorAll('.tyre-card'),
            translateY: [16, 0],
            opacity: [0, 1],
            delay: anime.stagger(90),
            duration: 320,
            easing: 'easeOutQuad',
        });
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
        // L'anello di focus ha senso solo con un gamepad davvero collegato:
        // senza questo controllo, tyreFocusIndex parte comunque da 0 (prima
        // card, "hard") e finiva applicato SEMPRE, anche da tastiera/mouse —
        // bordo giallo fisso sulla prima mescola segnalato dall'utente.
        const gpActive = typeof F1GamepadInput !== 'undefined' && F1GamepadInput.isConnected();
        const cards = _tyreCards();
        cards.forEach((el, idx) => el.classList.toggle('gp-focused', gpActive && idx === tyreFocusIndex));
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

    // Pulsante "Ripara danni" (stile tyre-card: bagliore verde = selezionato),
    // niente più checkbox — un checkbox col focus si deseleziona da solo alla
    // pressione di Spazio (usato per la reazione pit), inoltre l'utente
    // voleva uno stile coerente con gli altri pulsanti del pannello.
    // Funzione condivisa: la richiama sia il click sia il tasto R1 da
    // controller (vedi F1GamepadInput.setCallbacks/onRepairToggle sotto).
    function toggleRepairChoice() {
        const repairToggle = document.getElementById('pitstop-repair-toggle');
        const repairBtn = document.getElementById('pitstop-repair-btn');
        if (!repairToggle || !repairBtn || repairToggle.style.display === 'none') return;
        const nowSelected = !repairBtn.classList.contains('selected');
        repairBtn.classList.toggle('selected', nowSelected);
        socket.emit('f1PitRepairChoice', { lobbyId, playerColor: myColor, repair: nowSelected });
    }

    socket.on('f1PitLaneEntered', () => {
        const panel = document.getElementById('pitstop-panel');
        panel.style.display = 'flex';
        document.getElementById('pitstop-status').textContent = 'INGRESSO AI BOX...';
        document.getElementById('pitstop-instructions').textContent =
            'Scegli la mescola mentre arrivi al box.';
        document.getElementById('pitstop-react-prompt').style.display = 'none';
        document.getElementById('pitstop-result').textContent = '';
        if (tyreCompoundsInfo) renderTyreCards(tyreCompoundsInfo, null, 'pitstop-cards', 'f1PitCompoundChoice');

        const myDamage = (serverState[myColor] && serverState[myColor].damage) || 0;
        const repairToggle = document.getElementById('pitstop-repair-toggle');
        const repairBtn = document.getElementById('pitstop-repair-btn');
        if (myDamage > 0) {
            const estSecs = ((myDamage * 150) / 1000).toFixed(1);   // 150 = REPAIR_MS_PER_DAMAGE_PCT lato server
            repairBtn.textContent = `Ripara danni (+${estSecs}s)`;
            repairBtn.classList.remove('selected');
            repairToggle.style.display = 'flex';
            repairBtn.onclick = toggleRepairChoice;
        } else {
            repairToggle.style.display = 'none';
        }
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
        const promptEl = document.getElementById('pitstop-react-prompt');
        promptEl.style.display = 'block';
        anime({
            targets: promptEl,
            scale: [0, 1],
            opacity: [0, 1],
            duration: 380,
            easing: 'easeOutElastic(1, 0.5)',
        });
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
            // Senza preventDefault, se la checkbox riparazione ha il focus
            // (ce l'ha appena la clicchi) il browser la de-seleziona da solo
            // alla pressione di Spazio — comportamento nativo dell'elemento,
            // in aggiunta a (non al posto di) l'emit qui sotto. Segnalato
            // dall'utente: "premo spazio per la reazione e mi si deseleziona
            // la riparazione danni".
            e.preventDefault();
            socket.emit('f1PitReactionPress', { lobbyId, playerColor: myColor });
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 't') {
            tyrePanelOpen = !tyrePanelOpen;
            renderTyreVisibility();
        }
    });

    // Tasto R = riparazione danni ai box da tastiera (stessa funzione del
    // click sul pulsante e di R1 da controller) — segnalato dall'utente,
    // prima esisteva solo il tasto controller. toggleRepairChoice ignora la
    // pressione da sola se il pannello riparazione non è visibile.
    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'r') toggleRepairChoice();
    });

    // DEBUG: pannello usura/guasti (tasto G) — mostra/nasconde soltanto,
    // il contenuto è già aggiornato ad ogni f1StateUpdate indipendentemente
    // da questo stato (vedi updateDebugPanel), come per showHitboxes.
    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'g') {
            debugPanelOpen = !debugPanelOpen;
            document.getElementById('debug-panel').style.display = debugPanelOpen ? 'block' : 'none';
        }
    });

    // Popola il pannello debug dai dati già calcolati server-side
    // (state.debug, vedi buildPublicState in f1GameSocket.js) — nessuna
    // formula duplicata qui, solo lettura/formattazione.
    function updateDebugPanel(data) {
        if (!debugPanelOpen) return;
        const d = data.debug || {};
        document.getElementById('debug-maxspeed').textContent = `${d.maxSpeedPct ?? 100}%`;
        document.getElementById('debug-grip').textContent = `${d.gripPct ?? 100}%`;
        document.getElementById('debug-accel').textContent = `${d.accelPct ?? 100}%`;
        document.getElementById('debug-brake').textContent = `${d.brakePct ?? 100}%`;
        document.getElementById('debug-steer').textContent = `${d.steerPct ?? 100}%`;
        document.getElementById('debug-tyrewear').textContent = `${Math.round(data.tyreWear || 0)}%`;
        const parts = data.damageParts || {};
        document.getElementById('debug-frontwing').textContent = `${Math.round(parts.frontWing || 0)}%`;
        document.getElementById('debug-floor').textContent = `${Math.round(parts.floor || 0)}%`;
        document.getElementById('debug-engine').textContent = `${Math.round(parts.engine || 0)}%`;
        document.getElementById('debug-suspension').textContent = `${Math.round(parts.suspension || 0)}%`;
    }

    // ====================================================
    // SOCKET EVENTS
    // ====================================================
    socket.on('f1Setup', ({ players, trackName, hostColor: hc, totalLaps, phase, raceStarted, elapsed,
        compounds, strategy, myCompound, tyreConfirmed, tyreTotal }) => {
        if (compounds) tyreCompoundsInfo = compounds;
        if (phase) currentPhase = phase;
        // Rientro a metà qualifica (reconnect): senza questo qualiSessionOpen
        // resterebbe false (valore iniziale), e l'overlay "in attesa" non
        // comparirebbe mai anche se la sessione è davvero aperta — l'unico
        // altro punto che lo apre è f1Countdown, che non rifira per chi si
        // ricollega a sessione già in corso.
        if (phase) qualiSessionOpen = (phase === 'qualifying');
        if (hc) hostColor = hc;
        if (totalLaps) {
            // totalLaps qui è SEMPRE quello della gara vera (il server lo manda
            // così a prescindere dalla fase corrente): setLapDisplay lo riduce
            // già a 1 se si è in qualifica.
            raceTotalLaps = totalLaps;
            const myLap = players[myColor] ? players[myColor].lap : 0;
            setLapDisplay(myLap, phase);
        }

        // Idempotente: su un rientro (reconnect senza reload) i modelli esistono
        // già in scena, ricrearli darebbe auto duplicate.
        if (!myCarGroup) loadCarModel(myColor, (g) => {
            myCarGroup = g;
            slipstreamGroup = buildSlipstreamEffect();
            myCarGroup.add(slipstreamGroup);
        }, TEST_LIVERY_COLORS);

        for (const [color, state] of Object.entries(players)) {
            serverState[color] = { x: state.x, z: state.z, angle: state.angle, speed: 0 };
            if (!visualState[color]) visualState[color] = { ...serverState[color] };
            if (color !== myColor && !otherCars[color]) {
                loadOtherCar(color, state.uid, (g) => {
                    otherCars[color] = g;
                    g.position.set(state.x, 0, state.z);
                    g.rotation.y = state.angle;
                });
            }
        }

        // Rientro a gara già in corso: riprende il cronometro dal punto giusto
        // senza rivedere il countdown (che è già passato per tutti gli altri)
        // — myLiveElapsedMs si popola da solo al prossimo f1StateUpdate,
        // nessun calcolo locale da seminare qui.
        if (raceStarted) {
            isRacing = true;
            document.getElementById('countdown-overlay').style.display = 'none';
            document.getElementById('timer-speed-panel').style.display = (phase === 'qualifying' || phase === 'race') ? 'flex' : 'none';
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
        // Layout box in qualifica (Rif. richiesta utente 2026-08-07):
        // chiave speciale FUORI dallo stato per-colore isolato — vedi
        // broadcastState in f1GameSocket.js. Renderizza i box di TUTTI i
        // piloti anche quando lo stato "vivo" (posizione/tempi) resta
        // isolato al solo proprio colore.
        if (state.__boxLayout) {
            for (const [color, anchor] of Object.entries(state.__boxLayout)) {
                loadPlayerPitBox(color, anchor);
            }
        }
        for (const [color, data] of Object.entries(state)) {
            if (color === '__boxLayout') continue;
            serverState[color] = data;
            updateMinimapDot(color, data.x, data.z);
            if (data.pitBoxAnchor) loadPlayerPitBox(color, data.pitBoxAnchor);
            if (color !== myColor && !otherCars[color] && !visualState[color]) {
                visualState[color] = { x: data.x, z: data.z, angle: data.angle };
                loadOtherCar(color, data.uid, (g) => { otherCars[color] = g; });
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
            // mostrarla lì sarebbe fuorviante. Aggiorna SEMPRE sia l'icona
            // chiusa che il pannello esteso: quale dei due sia visibile è
            // deciso solo da renderTyreVisibility()/tyrePanelOpen.
            if (color === myColor && currentPhase === 'race' && data.compound && tyreCompoundsInfo) {
                const info = tyreCompoundsInfo[data.compound];
                if (info) {
                    const wear = Math.round(data.tyreWear || 0);
                    const col = wearColor(wear);
                    document.getElementById('tyre-icon-closed').style.background = col;
                    document.getElementById('tyre-compound-dot').style.background = info.color;
                    document.getElementById('tyre-compound-label').textContent = info.label.toUpperCase();
                    document.getElementById('tyre-wear-value').textContent = wear;
                    ['wFL', 'wFR', 'wRL', 'wRR'].forEach(id =>
                        document.getElementById(id).style.setProperty('--wear', col));
                    const dmg = Math.round(data.damage || 0);
                    document.getElementById('damage-value').textContent = dmg;
                    document.getElementById('tyre-open').style.setProperty('--damage', wearColor(dmg));
                }
            }
            if (color === myColor) {
                renderTyreVisibility();
                slipstreamActive = !!data.slipstream;
                if (slipstreamGroup) slipstreamGroup.visible = slipstreamActive;
                updateDebugPanel(data);
            }
        }
        updateStandings(state);
    });

    // Colora le 3 barre settore in base ai dati del proprio giocatore
    // (mai per gli avversari — Rif. design). Priorità: fucsia (record di
    // sessione) > verde/giallo (confronto col proprio giro precedente) >
    // neutro (settore non ancora raggiunto in questo giro, o nessun
    // riferimento — primo giro in gara).
    function updateSectorBars(sectorTimes, prevSectorTimes, bestSectorTimes) {
        for (let i = 0; i < 3; i++) {
            const bar = document.getElementById(`sector-bar-${i + 1}`);
            if (!bar) continue;
            bar.classList.remove('yellow', 'green', 'best');
            const t = sectorTimes ? sectorTimes[i] : null;
            if (t == null) continue;
            const best = bestSectorTimes ? bestSectorTimes[i] : null;
            if (best != null && t <= best) {
                bar.classList.add('best');
            } else if (prevSectorTimes && prevSectorTimes[i] != null) {
                bar.classList.add(t < prevSectorTimes[i] ? 'green' : 'yellow');
            }
        }
    }

    // Formatta gapToLeaderMs (ms) in "+S.m" (sotto il minuto) o "+M:SS.m"
    // (oltre) — un solo decimale, dato che il calcolo è già una stima
    // (mostrare 3 cifre sarebbe fuorviante). null/leader => stringa vuota.
    function formatGap(ms) {
        if (ms == null) return '';
        const totalDeci = Math.round(ms / 100);
        const s10 = totalDeci % 600;
        const m = Math.floor(totalDeci / 600);
        const secStr = (s10 / 10).toFixed(1);
        return m > 0 ? `+${m}:${secStr.padStart(4, '0')}` : `+${secStr}`;
    }

    // Formatta il delta continuo (ms, con segno) rispetto al giro
    // precedente in "±S.mmm" (sotto il minuto) o "±M:SS.mmm" (oltre) — 3
    // decimali per coerenza col timer principale (che mostra i millisecondi
    // pieni, non arrotondati a un decimale come formatGap sopra, che è
    // invece già una stima di distacco). null => stringa vuota.
    function formatDelta(ms) {
        if (ms == null) return '';
        const sign = ms < 0 ? '-' : '+';
        const abs = Math.round(Math.abs(ms));
        const m = Math.floor(abs / 60000);
        const s = Math.floor((abs % 60000) / 1000);
        const msRem = abs % 1000;
        const secStr = `${s}.${String(msRem).padStart(3, '0')}`;
        return m > 0 ? `${sign}${m}:${String(s).padStart(2, '0')}.${String(msRem).padStart(3, '0')}` : `${sign}${secStr}`;
    }

    let lastStandingsOrder = [];   // colori nell'ordine dell'ultimo render, per rilevare i sorpassi
    const standingRowEls = {};     // color -> riga DOM persistente (mai ricreata finché il pilota resta in gara)

    const STANDING_ROW_HEIGHT = 24;   // deve corrispondere all'altezza reale di .f1-standing-row (padding incluso)
    const STANDING_LIFT_PX = 16;   // quanto la riga di chi sorpassa si "alza" oltre lo slot di arrivo, a metà animazione

    function renderStandingRowContent(rowEl, color, d) {
        const compoundLetter = { soft: 'S', medium: 'M', hard: 'H' }[d.compound] || '';
        const compoundColor = (tyreCompoundsInfo && tyreCompoundsInfo[d.compound] && tyreCompoundsInfo[d.compound].color) || '#888';
        rowEl.innerHTML = `
            <span class="pos">${d.position}</span>
            <span class="dot" style="background:${color};"></span>
            ${color === myColor ? 'TU' : ''}${d.isBot ? '<span class="bot-badge">CPU</span>' : ''}
            ${compoundLetter ? `<span class="compound-badge" style="color:${compoundColor};">${compoundLetter}</span>` : ''}
            ${(d.falseStart && !d.falseStartServed) ? '<span class="false-start-badge">!</span>' : ''}${d.collisionPenalty ? '<span class="false-start-badge collision-badge">!</span>' : ''}
            <span class="gap">${d.position === 1 ? 'Leader' : formatGap(d.gapToLeaderMs)}</span>
        `;
    }

    // Classifica live: pallino colore + posizione + distacco dal leader,
    // ordinata per rank. Mai in qualifica: lì ogni giocatore vede solo se
    // stesso (playersVisibleTo la isola), quindi avrebbe comunque
    // "position" (raceStarted è true anche in qualifica) e mostrerebbe una
    // classifica assurda con un solo "1°" — non basta controllare le
    // entries, va escluso esplicitamente per fase.
    //
    // Le righe sono elementi DOM persistenti, uno per colore, mai ricreati
    // da un innerHTML sull'intera lista: il server manda f1StateUpdate ogni
    // 50ms (PHYSICS_TICK_MS), un rebuild completo ad ogni chiamata
    // distruggerebbe qualsiasi animazione di sorpasso dopo un solo frame,
    // prima ancora che potesse essere visibile.
    function updateStandings(state) {
        const box = document.getElementById('standings-panel');
        const rowsEl = document.getElementById('standings-rows');

        const entries = (currentPhase !== 'race') ? [] : Object.entries(state)
            .filter(([, d]) => d.position)
            .sort((a, b) => a[1].position - b[1].position);

        if (entries.length === 0) {
            rowsEl.innerHTML = '';
            box.style.display = 'none';
            lastStandingsOrder = [];
            for (const color in standingRowEls) delete standingRowEls[color];
            return;
        }

        box.style.display = 'flex';
        const newOrder = entries.map(([color]) => color);

        // posizione di ogni pilota nell'ordine PRIMA di questo aggiornamento —
        // serve per animare solo chi ha davvero cambiato posizione.
        const prevIndex = {};
        lastStandingsOrder.forEach((color, i) => { prevIndex[color] = i; });

        // righe di chi non è più in classifica (disconnesso) — via
        for (const color in standingRowEls) {
            if (!newOrder.includes(color)) {
                standingRowEls[color].remove();
                delete standingRowEls[color];
            }
        }

        // crea (solo se manca) o aggiorna il contenuto di ogni riga — mai un
        // innerHTML sull'intera lista, solo sulla singola riga toccata.
        for (const [color, d] of entries) {
            let rowEl = standingRowEls[color];
            if (!rowEl) {
                rowEl = document.createElement('div');
                rowEl.className = 'f1-standing-row';
                rowEl.dataset.color = color;
                standingRowEls[color] = rowEl;
                rowsEl.appendChild(rowEl);
            }
            rowEl.classList.toggle('me', color === myColor);
            renderStandingRowContent(rowEl, color, d);
        }

        // riordina il DOM secondo la classifica attuale — solo se l'ordine è
        // davvero cambiato, per non forzare un reflow ad ogni tick.
        const orderChanged = newOrder.some((color, i) => lastStandingsOrder[i] !== color);
        if (orderChanged) {
            newOrder.forEach(color => rowsEl.appendChild(standingRowEls[color]));

            newOrder.forEach((color, newIdx) => {
                const oldIdx = prevIndex[color];
                if (oldIdx === undefined || oldIdx === newIdx) return;   // riga nuova o posizione invariata: nessuna animazione

                const rowEl = standingRowEls[color];
                const deltaPx = (oldIdx - newIdx) * STANDING_ROW_HEIGHT;

                // Sorpassi ravvicinati possono far scattare due animazioni sulla
                // stessa riga prima che la prima finisca (es. sorpassa e viene
                // subito ri-sorpassato): senza cancellare la tween precedente,
                // anime.js lascia "scale" congelato a un valore intermedio
                // (l'unico ramo che lo anima è quello sotto, l'altro anima solo
                // translateY) — badge/lettera restano leggermente deformati e
                // fuori centro finché non arriva un altro sorpasso a "sbloccarli".
                anime.remove(rowEl);

                if (newIdx < oldIdx) {
                    // Ha sorpassato: la riga viene "estratta" dalla classifica
                    // (sollevata oltre lo slot di arrivo, come una fascia tolta
                    // dal cartellone) e poi riposizionata nel posto giusto —
                    // richiesta esplicita dell'utente, ispirata ai vecchi
                    // cartelloni a fasce non digitali.
                    rowEl.style.transform = `translateY(${deltaPx}px)`;
                    rowEl.classList.add('is-lifting');
                    anime({
                        targets: rowEl,
                        keyframes: [
                            { translateY: -STANDING_LIFT_PX, scale: 1.08, duration: 180, easing: 'easeOutQuad' },
                            { translateY: 0, scale: 1, duration: 300, easing: 'easeInOutQuad' },
                        ],
                        complete: () => rowEl.classList.remove('is-lifting'),
                    });
                } else {
                    // È stato sorpassato: scorre semplicemente giù di uno slot
                    // per fare spazio, nessun sollevamento. Scale esplicito a 1
                    // per riportare a riposo eventuale scale lasciato a metà da
                    // un'animazione di sorpasso interrotta (vedi anime.remove sopra).
                    anime({
                        targets: rowEl,
                        translateY: [deltaPx, 0],
                        scale: 1,
                        duration: 420,
                        easing: 'easeOutQuad',
                    });
                }
            });
        }

        lastStandingsOrder = newOrder;
    }

    socket.on('f1PlayerLeft', (color) => {
        if (otherCars[color]) { scene.remove(otherCars[color]); delete otherCars[color]; }
        if (hitboxMeshes[color]) { scene.remove(hitboxMeshes[color]); delete hitboxMeshes[color]; }
        if (minimapDots[color]) { minimapDots[color].remove(); delete minimapDots[color]; }
        delete serverState[color]; delete visualState[color];
    });

    socket.on('f1TyreConfirmed', ({ count, total }) => {
        const status = document.getElementById('tyre-confirm-status');
        if (status) status.textContent = `${count}/${total} pronti`;
    });

    socket.on('f1Countdown', (data) => {
        isRacing = false;
        myFinalTime = null;
        myLiveElapsedMs = null;
        myLiveElapsedSyncedAt = null;
        myDeltaToPreviousLapMs = null;
        if (tyreSelectActive) exitTyrePreview();   // la qualifica sta per partire: fine anteprima tracciato
        tyreSelectActive = false;
        clearTyreNav();
        document.getElementById('timer-speed-panel').style.display = 'none';
        tyrePanelOpen = false;
        renderTyreVisibility();
        // Nasconde in automatico un'eventuale griglia/animazione/selezione ancora
        // a schermo: evita di dover sincronizzare a mano un timeout lato client
        // con GRID_DISPLAY_MS/TYRE_SELECT_MS del server.
        document.getElementById('podium-modal').style.display = 'none';
        document.getElementById('pole-overlay').style.display = 'none';
        // true solo per il countdown che apre una qualifica; il countdown di
        // gara (data.phase==='race') la chiude anche come rete di sicurezza,
        // ridondante con f1QualiEnded qui sotto ma innocuo.
        qualiSessionOpen = (data?.phase === 'qualifying');
        document.getElementById('quali-waiting-overlay').style.display = 'none';
        document.getElementById('tyre-select-overlay').style.display = 'none';
        const overlay = document.getElementById('countdown-overlay');
        const num = document.getElementById('countdown-number');
        const trackEl = document.getElementById('countdown-track');
        const labelEl = document.getElementById('countdown-label');
        const lightsBoard = document.getElementById('lights-board');
        if (data?.trackName) trackEl.textContent = data.trackName;
        labelEl.textContent = data?.label || '';
        overlay.style.background = 'rgba(0,0,0,0.65)';
        overlay.style.display = 'flex';

        if (data?.phase === 'race') {
            // Plancia luci: 5 bulbi spenti, si accendono uno alla volta ogni
            // LIGHT_INTERVAL_MS (stesso valore lato server, 1000ms), poi
            // restano tutte accese finché non arriva davvero f1RaceStarted
            // (l'attesa casuale la decide solo il server, qui non c'è nessun
            // timer locale che la replica — lo spegnimento è una reazione
            // all'evento, mai un timeout indipendente).
            lightsSequenceActive = true;
            num.style.display = 'none';
            lightsBoard.style.display = 'flex';
            const bulbs = [0, 1, 2, 3, 4].map(i => document.getElementById(`light-${i}`));
            bulbs.forEach(b => b.classList.remove('on'));
            const LIGHT_INTERVAL_MS = 1000;
            bulbs.forEach((bulb, i) => {
                setTimeout(() => {
                    bulb.classList.add('on');
                    anime({ targets: bulb, scale: [1, 1.18, 1], duration: 260, easing: 'easeOutQuad' });
                }, i * LIGHT_INTERVAL_MS);
            });
        } else {
            num.style.display = '';
            lightsBoard.style.display = 'none';
            num.textContent = '3'; num.style.color = '#e74c3c';
            setTimeout(() => { num.textContent = '2'; num.style.color = '#f39c12'; }, 1000);
            setTimeout(() => { num.textContent = '1'; num.style.color = '#f1c40f'; }, 2000);
        }
    });

    socket.on('f1RaceStarted', (data) => {
        // SOLO se questo è il via della GARA: questo evento scatta anche al
        // via della qualifica stessa (data.phase==='qualifying', il momento
        // esatto in cui il pannello deve poter comparire) — un reset
        // incondizionato qui la chiudeva nell'istante stesso in cui si
        // apriva, quindi non compariva mai (bug reale introdotto nel giro
        // precedente, segnalato dall'utente: "non esce più").
        if (data?.phase === 'race') qualiSessionOpen = false;
        isRacing = true;
        lightsSequenceActive = false;
        myFinalTime = null;
        myLiveElapsedMs = null;
        myLiveElapsedSyncedAt = null;
        myDeltaToPreviousLapMs = null;
        if (data?.phase) currentPhase = data.phase;
        const overlay = document.getElementById('countdown-overlay');
        const num = document.getElementById('countdown-number');
        const lightsBoard = document.getElementById('lights-board');
        if (data?.phase === 'race') {
            // Le 5 luci si spengono tutte insieme, sincronizzate con l'arrivo
            // di questo stesso evento (niente testo "GO!" per la gara, lo
            // spegnimento simultaneo è già il segnale di partenza).
            document.querySelectorAll('.light-bulb').forEach(b => b.classList.remove('on'));
        } else {
            num.textContent = 'GO!'; num.style.color = '#2ecc71';
        }
        overlay.style.background = 'transparent';
        document.getElementById('timer-speed-panel').style.display = (data?.phase === 'qualifying' || data?.phase === 'race') ? 'flex' : 'none';
        setTimeout(() => {
            overlay.style.display = 'none';
            lightsBoard.style.display = 'none';
        }, 800);
        // Rinfresca il box giri appena la sessione (qualifica o gara) parte
        // davvero: senza questo restava il valore lasciato dalla fase
        // precedente (es. "1/1" della qualifica per tutto il 1° giro di gara).
        setLapDisplay(0, data?.phase);
        sendInputs();
    });

    socket.on('f1LapUpdate', ({ color, lap, phase }) => {
        if (color !== myColor) return;
        setLapDisplay(lap, phase);
    });

    // Penalità collisione: il badge "!" (già presente in classifica per chi
    // ha una collisionPenaltyMs > 0, vedi renderStandingRowContent) si
    // espande temporaneamente per mostrare i secondi appena aggiunti, poi
    // si richiude tornando al solo "!" — che resta per tutta la gara.
    socket.on('f1CollisionPenalty', ({ color, penaltyMs }) => {
        const rowEl = standingRowEls[color];
        if (!rowEl) return;
        const el = rowEl.querySelector('.collision-badge');
        if (!el) return;
        const secs = (penaltyMs / 1000).toFixed(1);
        anime.timeline({ easing: 'easeOutQuad' })
            .add({
                targets: el, scale: [1, 1.3], width: [14, 46], duration: 200,
                complete: () => { el.textContent = `+${secs}s`; }
            })
            .add({ targets: el, duration: 1200 })
            .add({
                targets: el, scale: 1, width: 14, duration: 200,
                complete: () => { el.textContent = '!'; }
            });
    });

    // Animazione di rivelazione: rivela il TESTO lettera per lettera via
    // anime.stagger (ogni lettera è un <span> che entra con dissolvenza +
    // scorrimento, in sequenza). Personale: chi fa pole vede
    // "POOOOOOOOOOLE" in oro, tutti gli altri vedono solo la PROPRIA
    // posizione (es. "P4") in un colore neutro — vedi f1QualiEnded.
    function playRevealAnimation(fullText, isPole) {
        const overlay = document.getElementById('pole-overlay');
        const textEl = document.getElementById('pole-text');
        overlay.style.display = 'flex';
        textEl.style.color = isPole ? '#f1c40f' : 'var(--hud-text)';
        textEl.innerHTML = fullText.split('').map(ch =>
            `<span style="display:inline-block; opacity:0;">${ch}</span>`
        ).join('');
        anime({
            targets: textEl.querySelectorAll('span'),
            opacity: [0, 1],
            translateX: [42, 0],
            delay: anime.stagger(85),
            duration: 220,
            easing: 'easeOutQuad',
            complete: () => setTimeout(() => { overlay.style.display = 'none'; }, 1800),
        });
    }

    // Fine qualifica: rivelazione personale (POLE per il 1°, "P<n>" per tutti
    // gli altri, ognuno vede solo la propria — ricavata dalla propria posizione
    // nella griglia condivisa, nessun evento dedicato per-utente necessario),
    // poi la griglia di partenza completa (riusa il modal del podio) per il
    // resto della finestra prima del countdown di gara (si chiude da sé al
    // prossimo f1Countdown, vedi handler sopra).
    // Finestra di grazia di fine qualifica (Rif. design 2026-08-07): NON
    // mostra il conteggio (anche "X su N" anonimo può far intuire il proprio
    // piazzamento prima della rivelazione — segnalato dall'utente) — l'unico
    // uso di questo evento è nascondere l'overlay appena TUTTI (bot compresi)
    // hanno tagliato il traguardo, senza aspettare f1QualiEnded (che arriva
    // comunque un istante dopo, stesso tick server): senza questo l'overlay
    // poteva restare a schermo un frame in più, sovrapposto alla griglia finale.
    socket.on('f1QualiWaiting', ({ finished, total }) => {
        if (finished >= total) {
            qualiSessionOpen = false;
            document.getElementById('quali-waiting-overlay').style.display = 'none';
        }
    });

    socket.on('f1QualiEnded', ({ grid }) => {
        // Chiusura DEFINITIVA (non lo stato del giocatore, vedi dichiarazione
        // di qualiSessionOpen sopra): da qui in poi, per tutta 'grid_display'
        // (il pannello coi tempi che sta per aprirsi qui sotto), il server
        // non manda più nessun f1StateUpdate — senza questo flag il pannello
        // "in attesa" resterebbe sovrapposto alla griglia per l'intera durata.
        qualiSessionOpen = false;
        document.getElementById('quali-waiting-overlay').style.display = 'none';
        const myPos = (grid || []).findIndex(e => e.color === myColor) + 1;
        if (myPos === 1) playRevealAnimation('POOOOOOOOOOLE', true);
        else if (myPos > 1) playRevealAnimation(`P${myPos}`, false);

        const modal = document.getElementById('podium-modal');
        const title = document.getElementById('podium-title');
        const list = document.getElementById('podium-list');
        title.textContent = '🏁 GRIGLIA DI PARTENZA 🏁';
        list.innerHTML = (grid || []).map((entry, i) => {
            const t = entry.time;
            const timeStr = t === null
                ? 'Nessun tempo'
                : `${Math.floor(t / 60000)}:${String(Math.floor((t % 60000) / 1000)).padStart(2, '0')}.${String(t % 1000).padStart(3, '0')}`;
            return `
                <li style="display:flex;justify-content:space-between;align-items:center;padding:10px 5px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:18px;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <span style="font-weight:900;width:26px;color:var(--hud-text);">${i + 1}°</span>
                        <span style="display:inline-block;width:20px;height:20px;background:${entry.color};border-radius:50%;border:2px solid var(--hud-surface);"></span>
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
        const list = document.getElementById('podium-list');
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
            const t = entry.totalTime;
            // null = ancora in pista quando la gara ha chiuso (un bot non
            // ancora arrivato): mantiene la sua posizione attuale invece di
            // un tempo — vedi endRace in f1GameSocket.js.
            const timeStr = t === null
                ? 'IN CORSA'
                : `${Math.floor(t / 60000)}:${String(Math.floor((t % 60000) / 1000)).padStart(2, '0')}.${String(t % 1000).padStart(3, '0')}`;
            const li = document.createElement('li');
            li.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:10px 5px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:18px;';
            li.innerHTML = `
                <div style="display:flex;align-items:center;gap:12px;">
                    <span style="font-weight:900;width:26px;color:${i === 0 ? '#f1c40f' : i === 1 ? '#95a5a6' : i === 2 ? '#d35400' : 'var(--hud-text)'}">${i + 1}°</span>
                    <span style="display:inline-block;width:20px;height:20px;background:${entry.color};border-radius:50%;border:2px solid var(--hud-surface);"></span>
                    <span style="font-size:13px;font-weight:bold;">${entry.color === myColor ? '(YOU)' : ''}</span>
                    ${entry.pitPenalty ? '<span style="font-size:11px;font-weight:bold;color:#e74c3c;border:1px solid #e74c3c;border-radius:6px;padding:1px 6px;">+30s NO PIT</span>' : ''}
                    ${entry.falseStart ? '<span style="font-size:11px;font-weight:bold;color:#e74c3c;border:1px solid #e74c3c;border-radius:6px;padding:1px 6px;">+5s FALSE START</span>' : ''}
                    ${entry.collisionPenaltyMs > 0 ? `<span style="font-size:11px;font-weight:bold;color:#e74c3c;border:1px solid #e74c3c;border-radius:6px;padding:1px 6px;">+${(entry.collisionPenaltyMs / 1000).toFixed(1)}s COLLISIONI</span>` : ''}
                </div>
                <span style="font-family:monospace;font-weight:bold;">${timeStr}</span>`;
            list.appendChild(li);
        });

        modal.style.display = 'flex';
        const single = document.getElementById('single-mode-controls');
        const autoText = document.getElementById('auto-return-text');
        if (data.isSingleMode) {
            autoText.style.display = 'none';
            single.style.display = 'flex';
            document.getElementById('restart-race-btn').onclick = () => socket.emit('f1RestartRace', lobbyId);
            document.getElementById('back-to-lobby-btn').onclick = () => socket.emit('f1ReturnToLobby', lobbyId);
            if (myColor !== hostColor) {
                document.getElementById('restart-race-btn').style.display = 'none';
                document.getElementById('back-to-lobby-btn').textContent = 'Torna alla Lobby';
            }
        } else {
            single.style.display = 'none';
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

    // Dissolvenza a nero durante la pausa "Riprova" (RESTART_GRACE_MS lato
    // server, vedi backend): copre il riposizionamento dell'auto alla
    // griglia, che altrimenti si vedrebbe "teletrasportata" appena il
    // podio si chiude. Il fade-out finisce all'incirca quando arriva
    // f1Countdown (che nasconde comunque podium-modal per conto suo, in
    // modo idempotente — nessun conflitto se questo handler lo ha già
    // fatto sparire prima).
    socket.on('f1RestartTransition', ({ graceMs }) => {
        const el = document.getElementById('restart-transition');
        document.getElementById('podium-modal').style.display = 'none';
        el.style.display = 'flex';
        anime({ targets: el, opacity: [0, 1], duration: 250, easing: 'easeOutQuad' });
        setTimeout(() => {
            anime({
                targets: el, opacity: [1, 0], duration: 400, easing: 'easeInQuad',
                complete: () => { el.style.display = 'none'; }
            });
        }, Math.max(0, graceMs - 400));
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
    const keys = { w: false, a: false, s: false, d: false };
    const inputs = { throttle: 0, brake: 0, steer: 0 };

    function applyKeys() {
        inputs.throttle = keys.w ? 1 : 0;
        inputs.brake = keys.s ? 1 : 0;
        inputs.steer = (keys.a ? 1 : 0) + (keys.d ? -1 : 0);
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
        // In gara (mai in qualifica) l'input parte già durante la sequenza
        // luci: serve al server SOLO per il rilevamento falsa partenza — la
        // fisica resta congelata lato server finché la gara non parte
        // davvero, quindi non c'è rischio che l'auto si muova prima del via.
        if (!isRacing && !lightsSequenceActive) return;
        const now = performance.now();
        const changed = Math.abs(inputs.throttle - lastSent.throttle) > SEND_EPS ||
            Math.abs(inputs.brake - lastSent.brake) > SEND_EPS ||
            Math.abs(inputs.steer - lastSent.steer) > SEND_EPS;
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
            onNavLeft: () => tyreNav(-1),
            onNavRight: () => tyreNav(1),
            onTyreToggle: () => { tyrePanelOpen = !tyrePanelOpen; renderTyreVisibility(); },
            // Nessun tasto controller per la scelta riparazione danni ai
            // box prima d'ora — segnalato dall'utente. Stessa funzione
            // richiamata dal click sul pulsante (vedi toggleRepairChoice
            // sopra, dichiarata prima di f1PitLaneEntered).
            onRepairToggle: toggleRepairChoice,
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
    socket.emit('joinF1Game', { lobbyId, playerColor: myColor, uid: user ? user.uid : null });

    // ====================================================
    // RENDER LOOP — LERP + CAMERA
    // ====================================================
    const LERP = 0.22;
    // Angolo massimo di rotazione visiva delle ruote anteriori in sterzata
    // (solo estetico — la fisica reale usa l'input grezzo lato server,
    // SteeringModel.js — non questo valore). Stesso ordine di grandezza
    // del clamp ±0.4 rad usato nell'editor di riferimento navigato per
    // progettare questo effetto. Da tarare a vista in localhost.
    const MAX_WHEEL_STEER_RAD = 0.35;

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
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return a + d * t;
    }

    const _camOff = new THREE.Vector3();
    const _lookTgt = new THREE.Vector3();

    function updateCamera() {
        if (!myCarGroup) return;
        const pos = myCarGroup.position;
        const q = myCarGroup.quaternion;

        if (cameraMode === 'third') {
            _camOff.set(0, 5.5, -13);
            _camOff.applyQuaternion(q);
            camera.position.copy(pos).add(_camOff);
            _lookTgt.copy(pos).add(new THREE.Vector3(0, 1.2, 0));
            camera.lookAt(_lookTgt);
        } else {
            // Halo-cam broadcast (F1 TV pod): misurato sulla mesh reale (non
            // dedotto) analizzando il profilo di altezza lungo la lunghezza
            // dell'auto — il punto più alto del modello (apice halo/roll-hoop)
            // sta a z locale ≈ -0.14, y locale = 0.256 (il max assoluto della
            // mesh). Scalato ×3.5 e nel frame world del group (centrato in
            // x/z, y=0 a terra): apice halo ≈ (0, 1.79, -0.49). La camera sta
            // poco sopra e poco dietro quel punto, inclinata verso il basso
            // così l'halo compare in basso nell'inquadratura invece di
            // riempirla (era troppo vicino/dentro la mesh a y=1.85, z=0.3).
            const COCKPIT_HEIGHT = 1.95;  // ~0.16m sopra l'apice halo misurato (1.79)
            const COCKPIT_Z = -0.5;  // appena dietro l'apice halo misurato (-0.49)
            const COCKPIT_PITCH_DEG = 10;    // inclinazione verso il basso
            const COCKPIT_LOOK_DIST = 30;

            _camOff.set(0, COCKPIT_HEIGHT, COCKPIT_Z);
            _camOff.applyQuaternion(q);
            camera.position.copy(pos).add(_camOff);

            const pitchRad = COCKPIT_PITCH_DEG * Math.PI / 180;
            const lookDropY = Math.tan(pitchRad) * (COCKPIT_LOOK_DIST - COCKPIT_Z);
            _lookTgt.set(0, COCKPIT_HEIGHT - lookDropY, COCKPIT_LOOK_DIST);
            _lookTgt.applyQuaternion(q);
            _lookTgt.add(pos);
            camera.lookAt(_lookTgt);
        }
    }

    // Contorno pista/corsia box: generato una tantum come prima. I marker
    // (uno per giocatore, non più solo il proprio) sono <circle> SVG creati
    // e distrutti dinamicamente — stesso pattern già usato per
    // otherCars/hitboxMeshes altrove in questo file — non anime.js: con un
    // insieme dinamico di piloti che si uniscono/lasciano la partita,
    // gestire N istanze anime.js parallele è inutilmente complesso, e
    // getPointAtLength nativo basta da solo per posizionare un punto.
    const minimapTrackEl = document.getElementById('minimap-track');
    const minimapPitEl = document.getElementById('minimap-pit');
    const minimapT = minimapTransform([...trackPts, ...PIT_PTS]);
    minimapTrackEl.setAttribute('d', minimapPathString(trackPts, minimapT, true));
    minimapPitEl.setAttribute('d', minimapPathString(PIT_PTS, minimapT, false));

    const minimapDots = {};   // color -> <circle> element

    function ensureMinimapDot(color) {
        if (minimapDots[color]) return minimapDots[color];
        const svg = document.getElementById('minimap-svg');
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('r', color === myColor ? '4' : '3');
        c.setAttribute('fill', color);
        c.setAttribute('stroke', 'rgba(0,0,0,0.55)');
        c.setAttribute('stroke-width', '1');
        svg.appendChild(c);
        minimapDots[color] = c;
        return c;
    }

    // Sceglie il tracciato (pista o corsia box) da cui prendere la posizione
    // in base a quale dei due passa più vicino alla posizione REALE (x,z)
    // del giocatore, invece di affidarsi solo a trackIndex (che è un indice
    // sulla sola pista principale: durante la sosta ai box restava agganciato
    // al punto più vicino della pista, quindi il pallino restava fermo
    // sull'ingresso box invece di seguire l'auto lungo la corsia).
    function updateMinimapDot(color, x, z) {
        const dot = ensureMinimapDot(color);
        const nearTrack = TrackGeometry.nearestPoint(trackPts, x, z);
        const nearPit = TrackGeometry.nearestPoint(PIT_PTS, x, z);

        let pt;
        if (nearPit.dist < nearTrack.dist) {
            const progress = nearPit.index / (PIT_PTS.length - 1);
            const len = minimapPitEl.getTotalLength();
            pt = minimapPitEl.getPointAtLength(progress * len);
        } else {
            const progress = (nearTrack.index / trackPts.length) % 1;
            const len = minimapTrackEl.getTotalLength();
            pt = minimapTrackEl.getPointAtLength(progress * len);
        }
        dot.setAttribute('cx', pt.x);
        dot.setAttribute('cy', pt.y);
    }

    const timerEl = document.getElementById('hud-timer');
    const speedEl = document.getElementById('speed-value');
    const timerDeltaEl = document.getElementById('hud-timer-delta');

    function animate() {
        requestAnimationFrame(animate);

        if (typeof F1GamepadInput !== 'undefined') {
            const gp = F1GamepadInput.poll();
            if (gp && gp.connected) {
                inputs.throttle = gp.throttle;
                inputs.brake = gp.brake;
                inputs.steer = gp.steer;
            }
        }
        maybeSendInputs();

        // Effetto scia: aggiorna il pool di voxel (vedi updateSlipstreamVoxels)
        // solo quando l'effetto è attivo — nessun lavoro quando non serve.
        if (slipstreamActive && slipstreamGroup) updateSlipstreamVoxels(slipstreamGroup);

        for (const [color, target] of Object.entries(serverState)) {
            const v = visualState[color];
            if (!v) continue;

            v.x += (target.x - v.x) * LERP;
            v.z += (target.z - v.z) * LERP;
            v.angle = lerpAngle(v.angle || 0, target.angle || 0, LERP);
            v.steerAngle = (v.steerAngle || 0) + ((target.steerInput || 0) * MAX_WHEEL_STEER_RAD - (v.steerAngle || 0)) * LERP;

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

                v.y = (v.y || 0) + (targetY - (v.y || 0)) * LERP;
                v.pitch = (v.pitch || 0) + (trackPitchAt(idx) - (v.pitch || 0)) * LERP;
                carGroup.position.set(v.x, v.y, v.z);
                carGroup.rotation.order = 'YXZ';
                carGroup.rotation.x = v.pitch;
                carGroup.rotation.y = v.angle;
                // Rotazione ruote basata sulla velocità
                if (carGroup.userData.wheels && carGroup.userData.wheels.length > 0) {
                    carGroup.userData.wheelRot = (carGroup.userData.wheelRot || 0) + Math.abs(target.speed || 0) * 1.4;
                    const wr = carGroup.userData.wheelRot;
                    for (const w of carGroup.userData.wheels) w.rotation.x = wr;
                }
                // Sterzo visivo: solo le ruote anteriori ruotano sull'asse
                // verticale (Y) in base a v.steerAngle (smussato sopra) —
                // effetto puramente cosmetico, la traiettoria reale resta
                // quella calcolata dal server su x/z/angle.
                if (carGroup.userData.frontWheels && carGroup.userData.frontWheels.length > 0) {
                    for (const w of carGroup.userData.frontWheels) w.rotation.y = v.steerAngle;
                }
                // Colore cerchio in base alla mescola montata: si rigenera la
                // texture ruota una sola volta per ogni cambio effettivo (non
                // ad ogni frame), confrontando col valore già applicato
                // memorizzato su carGroup.userData.appliedCompound. Prima che
                // il server sappia la mescola (tyre_select, compound=null) il
                // controllo non scatta e il cerchio resta al colore originale.
                if (target.compound && tyreCompoundsInfo && carGroup.userData.setCompoundColor
                    && carGroup.userData.appliedCompound !== target.compound) {
                    const info = tyreCompoundsInfo[target.compound];
                    if (info) {
                        const compoundHex = parseInt(info.color.replace('#', ''), 16);
                        carGroup.userData.setCompoundColor(compoundHex);
                        carGroup.userData.appliedCompound = target.compound;
                    }
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
                    const spd = target.speed || 0;
                    const actxNow = listener.context.currentTime;
                    const RAMP = 0.08;   // costante di tempo rampa volume (setTargetAtTime), evita click
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
                        targetRate = 0.9;
                        targetVolume = 0.15;
                        frac = 0.25;   // regime fisso e basso, coerente col limitatore
                    } else {
                        const now = performance.now();
                        const prevChecked = engineLastCheckedSpeed[color];
                        const magPrev = Math.abs(prevChecked ?? spd);
                        const magNow = Math.abs(spd);
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
                            targetRate = 0.8 + frac * 0.9;                    // 0.8x fermo → 1.7x a tutta velocità
                            targetVolume = active ? (0.09 + frac * 0.30) : 0;
                        } else {
                            targetRate = 0.6 + frac * 0.5;                    // 0.6x fermo → 1.1x a tutta velocità, più cupo
                            targetVolume = active ? (0.05 + frac * 0.14) : 0;
                        }
                    }

                    carGroup.userData.engineSound.source.playbackRate.setTargetAtTime(targetRate, actxNow, RATE_RAMP);
                    carGroup.userData.engineSound.gain.gain.setTargetAtTime(targetVolume * ENGINE_VOLUME_MULT, actxNow, RAMP);
                }
            }

            if (color === myColor) {
                speedEl.textContent = Math.round(Math.abs(target.speed || 0) * 55);
                // Questo è animate(), girato a ~60fps: target è la stessa
                // istanza di serverState[color] finché non arriva un NUOVO
                // f1StateUpdate (~ogni 50ms) — riagganciare qui SOLO quando
                // il valore è davvero cambiato, altrimenti Date.now() si
                // resetta ad ogni frame e l'estrapolazione sotto non ha mai
                // il tempo di accumularsi (bug reale, causa dei salti di
                // 50/150ms segnalati dall'utente).
                if (typeof target.elapsedMs === 'number' && target.elapsedMs !== myLiveElapsedMs) {
                    myLiveElapsedMs = target.elapsedMs;
                    myLiveElapsedSyncedAt = Date.now();
                }
                if (target.finished && target.time) {
                    myFinalTime = target.time;
                }
                myDeltaToPreviousLapMs = (typeof target.deltaToPreviousLapMs === 'number') ? target.deltaToPreviousLapMs : null;
                const sectorBarsEl = document.getElementById('sector-bars');
                if (sectorBarsEl) sectorBarsEl.style.display = (currentPhase === 'race') ? 'flex' : 'none';
                if (currentPhase === 'race') {
                    updateSectorBars(target.sectorTimes, target.prevSectorTimes, target.bestSectorTimes);
                }
                // Overlay "in attesa degli altri piloti": mostrato solo se la
                // sessione è ancora aperta (qualiSessionOpen, chiuso SOLO da
                // eventi di ciclo vita — mai da target.finished, vedi
                // dichiarazione della variabile). Rif. 2026-08-07, terzo
                // giro: durante 'grid_display' (il pannello coi tempi che
                // segue f1QualiEnded) il server smette di mandare
                // f1StateUpdate del tutto (playersVisibleTo ritorna {} per
                // quella fase) — quindi target.finished per il proprio
                // colore resta congelato true per l'INTERA durata della
                // griglia, non pochi tick: un mostra/nascondi basato solo su
                // target.finished (tentativo precedente) restava sovrapposto
                // al pannello dei tempi per tutti gli 8 secondi. qualiSessionOpen
                // si autocorregge SEMPRE su eventi certi (mai su un dato che
                // può congelarsi), quindi qui basta leggerlo.
                document.getElementById('quali-waiting-overlay').style.display =
                    (qualiSessionOpen && target.finished && target.time) ? 'flex' : 'none';
            }
        }

        if (isRacing && myLiveElapsedMs !== null) {
            // Estrapolazione locale dall'ultimo aggancio reale (vedi sopra):
            // scorre liscio ad ogni frame invece di restare fermo fino al
            // prossimo tick del server, ma resta ancorato al tempo VERO
            // (mai driftare come il vecchio Date.now()-localStart, perché si
            // ri-sincronizza ad ogni tick reale, non solo all'inizio).
            const t = myFinalTime !== null ? myFinalTime : (myLiveElapsedMs + (Date.now() - myLiveElapsedSyncedAt));
            const m = Math.floor(t / 60000);
            const s = Math.floor((t % 60000) / 1000);
            const ms = t % 1000;
            timerEl.textContent = `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
            // Colore: verde a tempo fissato (comportamento invariato, ha
            // sempre priorità — mai sovrascritto dal delta sotto), altrimenti
            // nessun override così resta il colore chiaro di .hud-mono — il
            // vecchio #2C3E50 (blu navy, pensato per il pannello chiaro
            // pre-redesign) era quasi invisibile sullo schermo scuro
            // incassato (segnalato dall'utente come "blu su blu"). Mentre il
            // giro è in corso, verde/rosso in base al delta continuo rispetto
            // al giro precedente (Rif.
            // docs/superpowers/specs/2026-08-07-f1-sector-timing-design.md).
            if (myFinalTime !== null) {
                timerEl.style.color = '#2ecc71';
            } else if (myDeltaToPreviousLapMs == null || myDeltaToPreviousLapMs === 0) {
                timerEl.style.color = '';
            } else {
                timerEl.style.color = myDeltaToPreviousLapMs < 0 ? 'var(--green)' : 'var(--red)';
            }
            // Testo del delta ("di quanto"): visibile solo mentre il giro è
            // in corso e c'è un giro precedente con cui confrontare — sparisce
            // a giro concluso (myFinalTime) insieme al resto del "live".
            if (timerDeltaEl) {
                if (myFinalTime !== null || myDeltaToPreviousLapMs == null) {
                    timerDeltaEl.style.display = 'none';
                } else {
                    timerDeltaEl.style.display = 'block';
                    timerDeltaEl.textContent = formatDelta(myDeltaToPreviousLapMs);
                    timerDeltaEl.style.color = myDeltaToPreviousLapMs < 0 ? 'var(--green)' : (myDeltaToPreviousLapMs > 0 ? 'var(--red)' : '');
                }
            }
        }

        if (tyreSelectActive) updateTyreSelectCamera();
        else updateCamera();
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
