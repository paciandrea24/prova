document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const myColor = urlParams.get('color') ? decodeURIComponent(urlParams.get('color')) : null;

    if (!lobbyId || !myColor) {
        window.location.href = '/';
        return;
    }

    const socket = io({ transports: ['websocket'], upgrade: false });
    socket.emit('joinLobby', { lobbyId, color: myColor });
    socket.emit('joinF1Game', { lobbyId, playerColor: myColor });

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
    // COSTRUZIONE PISTA 3D
    // ====================================================
    // Piano XZ: X = destra, Z = avanti.
    // I punti del circuito sono definiti come (x, z) — Y sempre 0.
    // Il circuito è percorso in senso counter-clockwise visto dall'alto.
    // La linea di partenza/arrivo si trova sul rettilineo sinistro (x≈-30, z=0→200).
    // La macchina parte col muso rivolto verso +Z (angle=0).

    const ROAD_HALF   = 11;          // metà larghezza carreggiata
    const CURB_W      = 2.8;         // larghezza cordolo
    const BARRIER_D   = ROAD_HALF + CURB_W + 1.2;  // distanza barriera dal centro

    // Corsia box: STESSI waypoint del server (backend/sockets/games/f1GameSocket.js,
    // PIT_PATH) — una vera strada che si stacca dal tracciato principale, corre
    // ben distante da qualunque chicane, tocca la casella box, poi rientra sul
    // tracciato molto più avanti. Le barriere non sono collidabili lato server,
    // quindi non serve un varco nel muro per renderla percorribile.
    const PIT_PATH = [
        { x: -30, z:   0 }, { x: -42, z:  10 }, { x: -55, z:  25 }, { x: -58, z:  50 },
        { x: -58, z:  80 }, { x: -58, z: 110 }, { x: -55, z: 135 }, { x: -42, z: 148 }, { x: -30, z: 155 },
    ];
    const PIT_BOX_INDEX = 4;
    const PIT_ROAD_HALF = 5;   // metà larghezza della corsia box

    // --- Punti di controllo del circuito ---
    function circuitCtrlPoints() {
        const v = (x, z) => new THREE.Vector3(x, 0, z);
        const pts = [];

        // RETTILINEO PRINCIPALE con chicane (x≈-30, z: 0→200)
        pts.push(v(-30,   0));
        pts.push(v(-30,  60));
        pts.push(v(-16,  82));   // chicane dx
        pts.push(v( -8, 100));
        pts.push(v(-16, 118));   // chicane sx
        pts.push(v(-30, 145));
        pts.push(v(-30, 200));

        // PARABOLICA ALTA — arco orario, centro (50,200) r=80
        for (let d = 165; d >= 15; d -= 15) {
            const r = THREE.MathUtils.degToRad(d);
            pts.push(v(50 + 80 * Math.cos(r), 200 + 80 * Math.sin(r)));
        }
        pts.push(v(130, 200));

        // RETTILINEO DX con chicane (x≈130, z: 200→0)
        pts.push(v(130, 145));
        pts.push(v(146, 118));   // chicane sx
        pts.push(v(138, 100));
        pts.push(v(146,  82));   // chicane dx
        pts.push(v(130,  60));
        pts.push(v(130,   0));

        // PARABOLICA BASSA — arco orario, centro (50,0) r=80
        for (let d = -15; d >= -165; d -= 15) {
            const r = THREE.MathUtils.degToRad(d);
            pts.push(v(50 + 80 * Math.cos(r), 80 * Math.sin(r)));
        }
        // La curva CatmullRom chiude il loop automaticamente

        return pts;
    }

    // 'centripetal' previene loop e auto-intersezioni nelle chicane strette
    const circuitCurve = new THREE.CatmullRomCurve3(circuitCtrlPoints(), true, 'centripetal', 0.5);
    const N_SAMPLES    = 1000;
    // getSpacedPoints dà punti equi-distanti sull'arco
    const rawPts       = circuitCurve.getSpacedPoints(N_SAMPLES);
    // Escludi l'ultimo punto (== primo, curva chiusa)
    const trackPts     = rawPts.slice(0, N_SAMPLES);

    // Helper: dato un indice i, restituisce (normale perpendicolare al tangente in XZ)
    function normalAt(pts, i) {
        const n = pts.length;
        const next = pts[(i + 1) % n];
        const prev = pts[(i - 1 + n) % n];
        const tx = next.x - prev.x;
        const tz = next.z - prev.z;
        const len = Math.sqrt(tx * tx + tz * tz) || 1;
        return { nx: -tz / len, nz: tx / len };   // normale a sinistra del tangente
    }

    // --- Ribbon mesh generico ---
    function buildRibbon(pts, halfW, material) {
        const n = pts.length;
        const pos = new Float32Array(n * 2 * 3);
        const uv  = new Float32Array(n * 2 * 2);
        const idx = [];

        for (let i = 0; i < n; i++) {
            const { nx, nz } = normalAt(pts, i);
            const p = pts[i];
            const b = i * 6;
            // vertice sinistro
            pos[b    ] = p.x + nx * halfW;  pos[b + 1] = 0.02;  pos[b + 2] = p.z + nz * halfW;
            // vertice destro
            pos[b + 3] = p.x - nx * halfW;  pos[b + 4] = 0.02;  pos[b + 5] = p.z - nz * halfW;

            const u = i / (n - 1);
            const ub = i * 4;
            uv[ub] = 0; uv[ub + 1] = u; uv[ub + 2] = 1; uv[ub + 3] = u;

            // quad con il punto successivo (chiusura del loop inclusa)
            const base = i * 2;
            const next = ((i + 1) % n) * 2;
            idx.push(base, base + 1, next, next, base + 1, next + 1);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uv,  2));
        geo.setIndex(idx);
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        scene.add(mesh);
        return mesh;
    }

    // --- Cordoli alternati rosso/bianco ---
    function buildCurbs(pts, roadHalf, curbW) {
        const n         = pts.length;
        const arcLen    = circuitCurve.getLength();
        const stepLen   = arcLen / n;      // lunghezza arco per campione
        const STRIPE    = 10;              // unità di pista per stripe

        for (const side of [-1, 1]) {
            const pos  = new Float32Array(n * 2 * 3);
            const col  = new Float32Array(n * 2 * 3);
            const idx  = [];
            let   dist = 0;
            let   flip = false;

            for (let i = 0; i < n; i++) {
                const { nx, nz } = normalAt(pts, i);
                const p      = pts[i];
                const inner  = roadHalf * side;
                const outer  = (roadHalf + curbW) * side;

                const b = i * 6;
                pos[b    ] = p.x + nx * inner; pos[b + 1] = 0.04; pos[b + 2] = p.z + nz * inner;
                pos[b + 3] = p.x + nx * outer; pos[b + 4] = 0.04; pos[b + 5] = p.z + nz * outer;

                if (i > 0) { dist += stepLen; if (dist >= STRIPE) { dist = 0; flip = !flip; } }
                const r = flip ? 1 : 1,   g = flip ? 0 : 1,   bv = flip ? 0 : 1;
                const cb = i * 6;
                col[cb    ]=r; col[cb+1]=g; col[cb+2]=bv;
                col[cb + 3]=r; col[cb+4]=g; col[cb+5]=bv;

                const base = i * 2, nxt = ((i + 1) % n) * 2;
                idx.push(base, base + 1, nxt, nxt, base + 1, nxt + 1);
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
            geo.setIndex(idx);
            geo.computeVertexNormals();
            const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
            mesh.receiveShadow = true;
            scene.add(mesh);
        }
    }

    // --- Barriere Armco come ribbon continuo (no rotazione, no gap) ---
    function buildBarriers(pts, distFromCenter) {
        const n       = pts.length;
        const HEIGHT  = 1.1;
        const arcLen  = circuitCurve.getLength();
        const stepLen = arcLen / n;
        const STRIPE  = 14;   // unità di arco per ogni stripe bianco/rosso

        for (const side of [-1, 1]) {
            const pos = new Float32Array(n * 2 * 3);
            const col = new Float32Array(n * 2 * 3);
            const idx = [];
            let stripeAcc = 0;
            let isRed     = false;

            for (let i = 0; i < n; i++) {
                const { nx, nz } = normalAt(pts, i);
                const p  = pts[i];
                const bx = p.x + nx * distFromCenter * side;
                const bz = p.z + nz * distFromCenter * side;

                // vertice basso e alto
                pos[i * 6    ] = bx;  pos[i * 6 + 1] = 0.05;    pos[i * 6 + 2] = bz;
                pos[i * 6 + 3] = bx;  pos[i * 6 + 4] = HEIGHT;  pos[i * 6 + 5] = bz;

                if (i > 0) { stripeAcc += stepLen; if (stripeAcc >= STRIPE) { stripeAcc = 0; isRed = !isRed; } }
                const r  = isRed ? 0.85 : 0.93;
                const g  = isRed ? 0.10 : 0.93;
                const bv = isRed ? 0.10 : 0.96;
                col[i * 6    ] = r; col[i * 6 + 1] = g; col[i * 6 + 2] = bv;
                col[i * 6 + 3] = r; col[i * 6 + 4] = g; col[i * 6 + 5] = bv;

                const base = i * 2;
                const next = ((i + 1) % n) * 2;
                // winding diverso per i due lati così i fronti puntano verso la pista
                if (side < 0) idx.push(base, base + 1, next, next, base + 1, next + 1);
                else          idx.push(base, next, base + 1, next, next + 1, base + 1);
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
            geo.setIndex(idx);
            geo.computeVertexNormals();
            const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
                vertexColors: true,
                roughness:    0.6,
                metalness:    0.15,
                side:         THREE.DoubleSide
            }));
            mesh.castShadow    = true;
            mesh.receiveShadow = true;
            scene.add(mesh);
        }
    }

    // --- Linea di Partenza/Arrivo (scacchi bianchi/neri) ---
    function buildStartLine(pts, roadHalf) {
        const p0 = pts[0];
        const p1 = pts[1];
        const { nx, nz } = normalAt(pts, 0);

        const STRIPES  = 10;
        const stripeW  = (roadHalf * 2) / STRIPES;
        const dummy    = new THREE.Object3D();
        const geoS     = new THREE.BoxGeometry(stripeW - 0.1, 0.02, 2.5);
        const matB     = new THREE.MeshStandardMaterial({ color: 0xffffff });
        const matK     = new THREE.MeshStandardMaterial({ color: 0x111111 });
        const imB      = new THREE.InstancedMesh(geoS, matB, STRIPES);
        const imK      = new THREE.InstancedMesh(geoS, matK, STRIPES);
        const angle    = Math.atan2(p1.x - p0.x, p1.z - p0.z);
        let   iB = 0, iK = 0;

        for (let s = 0; s < STRIPES; s++) {
            const off = -roadHalf + stripeW * s + stripeW / 2;
            dummy.position.set(p0.x + nx * off, 0.06, p0.z + nz * off);
            dummy.rotation.y = angle;
            dummy.updateMatrix();
            if (s % 2 === 0) imB.setMatrixAt(iB++, dummy.matrix);
            else              imK.setMatrixAt(iK++, dummy.matrix);
        }
        imB.count = iB; imK.count = iK;
        imB.instanceMatrix.needsUpdate = imK.instanceMatrix.needsUpdate = true;
        scene.add(imB, imK);
    }

    // --- Corsia box: striscia d'asfalto grigio parallela al rettilineo sx,
    // con linee bianche di limite velocità a ingresso/uscita e la casella
    // box marcata al centro. ---
    // Normale per una curva APERTA (non chiusa a loop, a differenza di
    // normalAt usato dal tracciato principale): agli estremi usa la sola
    // differenza in avanti/indietro invece di avvolgere sull'altro capo.
    function normalAtOpen(pts, i) {
        const n = pts.length;
        const next = pts[Math.min(i + 1, n - 1)];
        const prev = pts[Math.max(i - 1, 0)];
        const tx = next.x - prev.x;
        const tz = next.z - prev.z;
        const len = Math.sqrt(tx * tx + tz * tz) || 1;
        return { nx: -tz / len, nz: tx / len };
    }

    // Ribbon per una curva APERTA: stessa tecnica di buildRibbon ma senza
    // richiudere l'ultimo segmento sul primo punto (qui serve una strada con
    // un inizio e una fine, non un anello).
    function buildOpenRibbon(pts, halfW, material) {
        const n = pts.length;
        const pos = new Float32Array(n * 2 * 3);
        const uv  = new Float32Array(n * 2 * 2);
        const idx = [];

        for (let i = 0; i < n; i++) {
            const { nx, nz } = normalAtOpen(pts, i);
            const p = pts[i];
            const b = i * 6;
            pos[b    ] = p.x + nx * halfW;  pos[b + 1] = 0.03;  pos[b + 2] = p.z + nz * halfW;
            pos[b + 3] = p.x - nx * halfW;  pos[b + 4] = 0.03;  pos[b + 5] = p.z - nz * halfW;

            const u = i / (n - 1);
            const ub = i * 4;
            uv[ub] = 0; uv[ub + 1] = u; uv[ub + 2] = 1; uv[ub + 3] = u;

            if (i < n - 1) {
                const base = i * 2;
                const next = (i + 1) * 2;
                idx.push(base, base + 1, next, next, base + 1, next + 1);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uv,  2));
        geo.setIndex(idx);
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        scene.add(mesh);
        return mesh;
    }

    // --- Corsia box: vera strada curva che si stacca dal tracciato
    // principale (stessi waypoint PIT_PATH del server), corre ben distante
    // dalla chicane, tocca la casella box, poi rientra sul tracciato. ---
    function buildPitLane() {
        const ctrlPts  = PIT_PATH.map(p => new THREE.Vector3(p.x, 0, p.z));
        const pitCurve = new THREE.CatmullRomCurve3(ctrlPts, false, 'centripetal', 0.5);
        const pitPts   = pitCurve.getSpacedPoints(300);

        buildOpenRibbon(pitPts, PIT_ROAD_HALF, new THREE.MeshStandardMaterial({
            color: 0x3a3a3a, roughness: 0.95, side: THREE.DoubleSide
        }));

        // Casella box: sul tratto rettilineo centrale del percorso (direzione pura +Z)
        const boxPos = PIT_PATH[PIT_BOX_INDEX];
        const boxMesh = new THREE.Mesh(
            new THREE.BoxGeometry(PIT_ROAD_HALF * 1.7, 0.03, 15),
            new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.9, transparent: true, opacity: 0.55 })
        );
        boxMesh.position.set(boxPos.x, 0.04, boxPos.z);
        scene.add(boxMesh);

        // Linee bianche vicino a distacco/rientro, orientate come il primo/ultimo
        // tratto del percorso (angolo noto analiticamente dai waypoint).
        const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        function addLine(x, z, dx, dz) {
            const line = new THREE.Mesh(new THREE.BoxGeometry(PIT_ROAD_HALF * 2, 0.03, 1), lineMat);
            line.position.set(x, 0.045, z);
            line.rotation.y = Math.atan2(dx, dz);
            scene.add(line);
        }
        addLine(-40, 8,   PIT_PATH[1].x - PIT_PATH[0].x, PIT_PATH[1].z - PIT_PATH[0].z);
        addLine(-40, 147, PIT_PATH[8].x - PIT_PATH[7].x, PIT_PATH[8].z - PIT_PATH[7].z);
    }

    // --- Assembla tutto ---
    // DoubleSide evita artefatti di culling nelle zone ad alta curvatura
    buildRibbon(trackPts, ROAD_HALF, new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.95, side: THREE.DoubleSide }));
    buildCurbs(trackPts, ROAD_HALF, CURB_W);
    buildBarriers(trackPts, BARRIER_D);
    buildStartLine(trackPts, ROAD_HALF);
    buildPitLane();

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
                carGroup.position.set(v.x, 0, v.z);
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
