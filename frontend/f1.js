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

    // --- Assembla tutto ---
    // DoubleSide evita artefatti di culling nelle zone ad alta curvatura
    buildRibbon(trackPts, ROAD_HALF, new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.95, side: THREE.DoubleSide }));
    buildCurbs(trackPts, ROAD_HALF, CURB_W);
    buildBarriers(trackPts, BARRIER_D);
    buildStartLine(trackPts, ROAD_HALF);

    // ====================================================
    // LOADER GLB (macchina Kenney colorata)
    // ====================================================
    const loader = new THREE.GLTFLoader();

    function loadCarModel(playerColor, onReady) {
        loader.load('/assets/kenney/raceCarWhite.glb', (gltf) => {
            const group = new THREE.Group();
            const model = gltf.scene;
            model.scale.set(3.5, 3.5, 3.5);

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

    const serverState = {};
    const visualState = {};
    const otherCars   = {};

    // ====================================================
    // SOCKET EVENTS
    // ====================================================
    let myTotalLaps = 3;

    socket.on('f1Setup', ({ players, trackName, hostColor: hc, totalLaps }) => {
        if (hc) hostColor = hc;
        if (trackName) document.getElementById('track-name-display').textContent = trackName;
        if (totalLaps) {
            myTotalLaps = totalLaps;
            const box = document.getElementById('lap-box');
            box.style.display = 'flex';
            document.getElementById('lap-display').textContent = `0/${totalLaps}`;
        }

        loadCarModel(myColor, (g) => { myCarGroup = g; });

        for (const [color, state] of Object.entries(players)) {
            serverState[color] = { x: state.x, z: state.z, angle: state.angle, speed: 0 };
            visualState[color] = { ...serverState[color] };
            if (color !== myColor) {
                loadCarModel(color, (g) => {
                    otherCars[color] = g;
                    g.position.set(state.x, 0, state.z);
                    g.rotation.y = state.angle;
                });
            }
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
        }
    });

    socket.on('f1PlayerLeft', (color) => {
        if (otherCars[color]) { scene.remove(otherCars[color]); delete otherCars[color]; }
        delete serverState[color]; delete visualState[color];
    });

    socket.on('f1Countdown', (data) => {
        isRacing    = false;
        myFinalTime = null;
        document.getElementById('timer-box').style.visibility = 'hidden';
        const overlay  = document.getElementById('countdown-overlay');
        const num      = document.getElementById('countdown-number');
        const trackEl  = document.getElementById('countdown-track');
        if (data?.trackName) trackEl.textContent = data.trackName;
        overlay.style.background = 'rgba(0,0,0,0.65)';
        overlay.style.display    = 'flex';
        num.textContent = '3'; num.style.color = '#e74c3c';
        setTimeout(() => { num.textContent = '2'; num.style.color = '#f39c12'; }, 1000);
        setTimeout(() => { num.textContent = '1'; num.style.color = '#f1c40f'; }, 2000);
    });

    socket.on('f1RaceStarted', (data) => {
        isRacing    = true;
        myFinalTime = null;
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

        updateCamera();
        renderer.render(scene, camera);
    }

    animate();

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
});
