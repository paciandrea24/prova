// frontend/playground.js
// Playground "ammazza-attesa" — sfere colorate che rotolano e si scontrano in 3D.
// Three.js r128 viene caricato in modo lazy (solo al primo click).
// Riusa window.lobbySocket impostato da lobby.js (stessa connessione, nessun doppio socket).

document.addEventListener('DOMContentLoaded', () => {
    const urlParams  = new URLSearchParams(window.location.search);
    const lobbyId    = urlParams.get('lobby');
    const myColorRaw = urlParams.get('color');
    const myColor    = myColorRaw ? decodeURIComponent(myColorRaw) : '#3498DB';

    if (!lobbyId) return;

    // ─── DOM ELEMENTS ─────────────────────────────────────────────
    const overlay     = document.getElementById('playground-overlay');
    const canvas      = document.getElementById('playground-canvas');
    const openBtn     = document.getElementById('playground-btn');
    const exitBtn     = document.getElementById('playground-exit-btn');

    // ─── STATO INTERNO ────────────────────────────────────────────
    let threeLoaded        = false;
    let sceneInitialized   = false;
    let listenersRegistered = false;
    let animId             = null;
    let socket             = null;

    // Three.js objects
    let scene, camera, renderer;
    let myBall = null;
    const otherBalls = {}; // { [socketId]: THREE.Mesh }

    // Fisica
    const ARENA_HALF  = 24;   // metà lato arena in unità Three.js
    const BALL_RADIUS = 1.5;
    let velX = 0, velZ = 0;

    // Camera orbitale
    let yaw   = 0;
    let pitch = 0.55; // radianti — angolo verticale iniziale

    // Input tastiera
    const keys = { w: false, s: false, a: false, d: false };

    // Throttle emit posizione
    let lastEmitTime = 0;
    // Cooldown per evento collisione (evita spam durante l'overlap multi-frame)
    const collisionCooldown = {};

    // ─── APERTURA PLAYGROUND ──────────────────────────────────────
    openBtn.addEventListener('click', () => {
        if (!threeLoaded) {
            // Lazy-load Three.js r128 (stesso CDN degli altri giochi 3D)
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
            s.onload = () => { threeLoaded = true; openPlayground(); };
            document.head.appendChild(s);
        } else {
            openPlayground();
        }
    });

    function openPlayground() {
        overlay.style.display = 'block';

        // Riprende il socket già creato da lobby.js
        socket = window.lobbySocket;
        if (!socket) { console.error('[Playground] lobbySocket non disponibile'); return; }

        if (!sceneInitialized) {
            initScene();
            sceneInitialized = true;
        } else {
            handleResize();
        }

        if (!listenersRegistered) {
            registerSocketListeners();
            listenersRegistered = true;
        }

        socket.emit('playgroundJoin', { lobbyId });
        startLoop();
    }

    // ─── CHIUSURA PLAYGROUND ──────────────────────────────────────
    exitBtn.addEventListener('click', closePlayground);

    function closePlayground() {
        if (document.pointerLockElement) document.exitPointerLock();
        stopLoop();
        overlay.style.display = 'none';
        if (socket) socket.emit('leavePlayground', { lobbyId });

        // Rimuovi dalla scena le sfere degli altri (si ripopolano al prossimo open)
        for (const id in otherBalls) {
            if (scene) scene.remove(otherBalls[id]);
            delete otherBalls[id];
        }
        // Riporta la mia sfera al centro (riposizionamento al prossimo open)
        velX = 0; velZ = 0;
    }

    // ─── INIZIALIZZAZIONE SCENA THREE.JS ──────────────────────────
    function initScene() {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0f0e1a);
        scene.fog = new THREE.Fog(0x0f0e1a, 45, 80);

        camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);

        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;

        // ── Luci ──
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
        scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
        dirLight.position.set(15, 30, 15);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.set(1024, 1024);
        scene.add(dirLight);

        // Luce puntuale viola dal basso per atmosfera
        const pointLight = new THREE.PointLight(0x7c3aed, 0.8, 60);
        pointLight.position.set(0, 2, 0);
        scene.add(pointLight);

        // ── Piano dell'arena ──
        const floorGeo = new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2);
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x1e1b4b, roughness: 0.95 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        // Griglia decorativa sopra il piano
        const grid = new THREE.GridHelper(ARENA_HALF * 2, 24, 0x3730a3, 0x3730a3);
        grid.position.y = 0.02;
        scene.add(grid);

        // ── Muri perimetrali (4 lati) ──
        const wallMat = new THREE.MeshStandardMaterial({
            color: 0x4c1d95,
            roughness: 0.8,
            transparent: true,
            opacity: 0.65
        });
        const wallH = 5;
        const wallLen = ARENA_HALF * 2;
        const wallThick = 1;
        const wallOffset = ARENA_HALF + wallThick / 2;

        [
            // [x, y, z, w, h, d]
            [0,           wallH / 2,  wallOffset,  wallLen + wallThick * 2, wallH, wallThick],
            [0,           wallH / 2, -wallOffset,  wallLen + wallThick * 2, wallH, wallThick],
            [ wallOffset, wallH / 2,  0,           wallThick, wallH, wallLen + wallThick * 2],
            [-wallOffset, wallH / 2,  0,           wallThick, wallH, wallLen + wallThick * 2],
        ].forEach(([x, y, z, w, h, d]) => {
            const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
            wall.position.set(x, y, z);
            wall.receiveShadow = true;
            scene.add(wall);
        });

        // ── La mia sfera ──
        const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
        const ballMat = new THREE.MeshStandardMaterial({
            color: myColor,
            roughness: 0.35,
            metalness: 0.15
        });
        myBall = new THREE.Mesh(ballGeo, ballMat);
        myBall.position.set(
            (Math.random() * 2 - 1) * 10,
            BALL_RADIUS,
            (Math.random() * 2 - 1) * 10
        );
        myBall.castShadow = true;
        scene.add(myBall);

        // ── Pointer lock: click sul canvas blocca il mouse ──
        canvas.addEventListener('click', () => {
            // Non bloccare se l'utente ha cliccato il pulsante Esci
            canvas.requestPointerLock();
        });

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup',   onKeyUp);

        handleResize();
    }

    // ─── INPUT ────────────────────────────────────────────────────
    function onMouseMove(e) {
        if (document.pointerLockElement !== canvas) return;
        yaw   -= e.movementX * 0.003;
        pitch -= e.movementY * 0.003;
        // Limita il pitch: non troppo in su (cielo) né troppo in giù (sotto il pavimento)
        pitch = Math.max(0.15, Math.min(1.35, pitch));
    }

    function onKeyDown(e) {
        switch (e.key.toLowerCase()) {
            case 'w': case 'arrowup':    keys.w = true; break;
            case 's': case 'arrowdown':  keys.s = true; break;
            case 'a': case 'arrowleft':  keys.a = true; break;
            case 'd': case 'arrowright': keys.d = true; break;
        }
    }

    function onKeyUp(e) {
        switch (e.key.toLowerCase()) {
            case 'w': case 'arrowup':    keys.w = false; break;
            case 's': case 'arrowdown':  keys.s = false; break;
            case 'a': case 'arrowleft':  keys.a = false; break;
            case 'd': case 'arrowright': keys.d = false; break;
        }
    }

    // ─── LOOP DI GIOCO ────────────────────────────────────────────
    function startLoop() {
        if (animId !== null) return; // già in esecuzione
        animId = requestAnimationFrame(loop);
    }

    function stopLoop() {
        if (animId !== null) {
            cancelAnimationFrame(animId);
            animId = null;
        }
    }

    function loop(ts) {
        animId = requestAnimationFrame(loop);
        if (!myBall || !renderer) return;

        // ── Direzioni di movimento relative allo yaw della camera ──
        // fwd = direzione in cui la camera guarda, proiettata sul piano XZ
        const fwdX   = -Math.sin(yaw);
        const fwdZ   = -Math.cos(yaw);
        // right = fwd × up (prodotto vettoriale): risulta (cos(yaw), 0, -sin(yaw))
        const rightX =  Math.cos(yaw);
        const rightZ = -Math.sin(yaw);

        // ── Accelerazione ──
        const acc = 0.028;
        let ax = 0, az = 0;
        if (keys.w) { ax += fwdX * acc;   az += fwdZ * acc; }
        if (keys.s) { ax -= fwdX * acc;   az -= fwdZ * acc; }
        if (keys.a) { ax -= rightX * acc;  az -= rightZ * acc; }
        if (keys.d) { ax += rightX * acc;  az += rightZ * acc; }

        velX += ax;
        velZ += az;

        // Attrito — rallentamento naturale sul pavimento
        velX *= 0.90;
        velZ *= 0.90;

        // Velocità massima
        const maxSpd = 0.28;
        const spd = Math.sqrt(velX * velX + velZ * velZ);
        if (spd > maxSpd) {
            velX = (velX / spd) * maxSpd;
            velZ = (velZ / spd) * maxSpd;
        }

        const dx = velX;
        const dz = velZ;
        myBall.position.x += dx;
        myBall.position.z += dz;

        // ── Rimbalzo sui muri ──
        const bound = ARENA_HALF - BALL_RADIUS;
        if (myBall.position.x >  bound) { myBall.position.x =  bound; velX *= -0.55; }
        if (myBall.position.x < -bound) { myBall.position.x = -bound; velX *= -0.55; }
        if (myBall.position.z >  bound) { myBall.position.z =  bound; velZ *= -0.55; }
        if (myBall.position.z < -bound) { myBall.position.z = -bound; velZ *= -0.55; }

        // ── Collisioni soft con le sfere remote ──
        // Ogni client risolve solo la propria sfera: separazione + rimbalzo elastico.
        // Essendo simmetrico su entrambi i client, entrambe rimbalzano indietro.
        const minDist = BALL_RADIUS * 2;
        for (const id in otherBalls) {
            const ob = otherBalls[id];
            const ddx = myBall.position.x - ob.position.x;
            const ddz = myBall.position.z - ob.position.z;
            const d   = Math.sqrt(ddx * ddx + ddz * ddz);

            if (d < minDist && d > 0.001) {
                const nx = ddx / d;
                const nz = ddz / d;

                // Separazione completa: sposta la mia sfera fuori dall'overlap totale
                myBall.position.x += nx * (minDist - d);
                myBall.position.z += nz * (minDist - d);

                // Riflessione elastica lungo la normale
                const dot = velX * nx + velZ * nz;
                if (dot < 0) {
                    velX -= dot * nx * 2.0;
                    velZ -= dot * nz * 2.0;
                }

                // Impulso minimo garantito: anche se la velocità era quasi zero,
                // la sfera rimbalza sempre in modo visibile
                const minBounce = 0.18;
                const bounceSpd = Math.sqrt(velX * velX + velZ * velZ);
                if (bounceSpd < minBounce) {
                    velX = nx * minBounce;
                    velZ = nz * minBounce;
                }

                // Notifica il client colpito così anche la sua sfera rimbalza.
                // Cooldown 300ms per non spammare durante l'overlap multi-frame.
                const now = performance.now();
                if (socket && (!collisionCooldown[id] || now - collisionCooldown[id] > 300)) {
                    collisionCooldown[id] = now;
                    socket.emit('playgroundCollision', { lobbyId, targetId: id, nx, nz });
                }
            }
        }

        // ── Rotazione visiva della sfera (effetto "rotola") ──
        const moveDist = Math.sqrt(dx * dx + dz * dz);
        if (moveDist > 0.0005) {
            // Asse di rotazione = perpendicolare alla direzione di movimento nel piano XZ
            const rotAxis = new THREE.Vector3(-dz / moveDist, 0, dx / moveDist);
            myBall.rotateOnWorldAxis(rotAxis, moveDist / BALL_RADIUS);
        }

        // ── Camera inseguitrice (orbita attorno alla sfera) ──
        const camDist = 12;
        const cp = pitch; // già clampato in onMouseMove
        camera.position.x = myBall.position.x + Math.sin(yaw)  * camDist * Math.cos(cp);
        camera.position.y = BALL_RADIUS        +                  camDist * Math.sin(cp);
        camera.position.z = myBall.position.z + Math.cos(yaw)  * camDist * Math.cos(cp);
        camera.lookAt(myBall.position);

        // ── Emit posizione con throttle (≈20 msg/sec) ──
        if (ts - lastEmitTime > 50) {
            lastEmitTime = ts;
            if (socket) {
                socket.emit('playgroundMove', {
                    lobbyId,
                    x: myBall.position.x,
                    z: myBall.position.z
                });
            }
        }

        renderer.render(scene, camera);
    }

    // ─── EVENTI SOCKET ────────────────────────────────────────────
    function registerSocketListeners() {
        // Stato iniziale: altri giocatori già presenti
        socket.on('playgroundState', ({ players, myId }) => {
            for (const id in players) {
                if (id !== myId && !otherBalls[id]) {
                    spawnRemoteBall(players[id]);
                }
            }
        });

        // Nuovo giocatore entrato nel playground
        socket.on('playgroundPlayerJoined', (player) => {
            if (!otherBalls[player.id]) {
                spawnRemoteBall(player);
            }
        });

        // Aggiornamento posizione di un giocatore remoto
        socket.on('playgroundPlayerMoved', ({ id, x, z }) => {
            if (otherBalls[id]) {
                otherBalls[id].position.x = x;
                otherBalls[id].position.z = z;
            }
        });

        // Un giocatore ha lasciato il playground
        socket.on('playgroundPlayerLeft', (id) => {
            if (otherBalls[id]) {
                if (scene) scene.remove(otherBalls[id]);
                delete otherBalls[id];
            }
        });

        // Il client che ha colpito ci notifica: applichiamo l'impulso alla nostra sfera
        socket.on('playgroundCollisionHit', ({ targetId, nx, nz }) => {
            if (!myBall || targetId !== socket.id) return;
            const impulse = 0.28;
            velX += nx * impulse;
            velZ += nz * impulse;
            // Garantisci rimbalzo visibile anche se si era fermi
            const spd = Math.sqrt(velX * velX + velZ * velZ);
            if (spd < 0.18) {
                velX = nx * 0.18;
                velZ = nz * 0.18;
            }
        });
    }

    function spawnRemoteBall(player) {
        if (!scene) return;
        const geo = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
        const mat = new THREE.MeshStandardMaterial({
            color: player.color || '#e74c3c',
            roughness: 0.35,
            metalness: 0.15
        });
        const ball = new THREE.Mesh(geo, mat);
        ball.position.set(player.x, BALL_RADIUS, player.z);
        ball.castShadow = true;
        scene.add(ball);
        otherBalls[player.id] = ball;
    }

    // ─── RESIZE ───────────────────────────────────────────────────
    function handleResize() {
        if (!renderer || !camera) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    window.addEventListener('resize', handleResize);
});
