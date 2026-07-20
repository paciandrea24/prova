// frontend/track-editor.js
document.addEventListener('DOMContentLoaded', () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a22);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(100, 200, 100);
    scene.add(sun);

    const VIEW = 220;
    // Centro inquadrato (pan) e fattore di zoom: la camera ortografica
    // top-down non ruota mai, quindi pan/zoom sono solo traslazione del
    // target e riduzione/allargamento della frustum attorno ad esso.
    let camTarget = { x: 0, z: 0 };
    let zoom = 1;
    const camera = new THREE.OrthographicCamera(-VIEW, VIEW, VIEW, -VIEW, 0.1, 2000);

    function updateCameraTransform() {
        const a = window.innerWidth / window.innerHeight;
        const v = VIEW / zoom;
        camera.left = -v * a; camera.right = v * a;
        camera.top = v; camera.bottom = -v;
        camera.updateProjectionMatrix();
        camera.position.set(camTarget.x, 500, camTarget.z + 0.001);
        camera.lookAt(camTarget.x, 0, camTarget.z);
        camera.updateMatrixWorld();
    }
    updateCameraTransform();

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    scene.add(new THREE.GridHelper(2000, 100, 0x444455, 0x2a2a33));

    window.addEventListener('resize', () => {
        updateCameraTransform();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // ====================================================
    // STATO DATI
    // ====================================================
    let mainPoints = [];
    let pitPoints  = [];
    let trackMeshGroup = null;
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);

    function activeList() {
        return document.getElementById('pitMode').checked ? pitPoints : mainPoints;
    }

    // ====================================================
    // FEEDBACK VISIVO QUOTA (y) — vista dall'alto: la posizione verticale
    // non si vede, quindi la quota va resa con colore (giallo=0, rosso=su,
    // blu=giù) e dimensione del marker. Materiali precalcolati a bucket
    // fissi per evitare di allocarne di nuovi ad ogni rebuild (chiamato
    // anche durante il drag, quindi molte volte al secondo).
    const Y_RANGE = 5; // |y| oltre questo valore satura colore/scala
    const Y_BUCKETS = 21;
    const yMarkerMaterials = [];
    for (let i = 0; i < Y_BUCKETS; i++) {
        const y = -Y_RANGE + (i / (Y_BUCKETS - 1)) * (2 * Y_RANGE);
        const base = new THREE.Color(0xf1c40f);
        const col = y >= 0
            ? base.clone().lerp(new THREE.Color(0xe74c3c), Math.min(1, y / Y_RANGE))
            : base.clone().lerp(new THREE.Color(0x3498db), Math.min(1, -y / Y_RANGE));
        yMarkerMaterials.push(new THREE.MeshBasicMaterial({ color: col }));
    }
    function materialForY(y) {
        const t = Math.min(1, Math.max(0, (y + Y_RANGE) / (2 * Y_RANGE)));
        return yMarkerMaterials[Math.round(t * (Y_BUCKETS - 1))];
    }
    function scaleForY(y) {
        return 1 + Math.max(-0.5, Math.min(1.5, y / (Y_RANGE * 0.8)));
    }

    // Ricreata ad ogni modifica: dataset piccoli (poche decine di punti),
    // costo trascurabile per uno strumento dev-only.
    function rebuild() {
        if (trackMeshGroup) scene.remove(trackMeshGroup);
        trackMeshGroup = new THREE.Group();
        scene.add(trackMeshGroup);

        const roadHalf    = parseFloat(document.getElementById('roadHalfWidth').value) || 11;
        const pitRoadHalf = parseFloat(document.getElementById('pitRoadHalfWidth').value) || 5;
        const pitBoxIndex = parseInt(document.getElementById('pitBoxIndex').value, 10) || 0;

        if (mainPoints.length >= 3) {
            const pts = TrackGeometry.sampleLoop(mainPoints, 500);
            TrackMeshBuilder.buildRibbon(trackMeshGroup, pts, roadHalf, new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.95, side: THREE.DoubleSide }));
            TrackMeshBuilder.buildCurbs(trackMeshGroup, pts, roadHalf, 2.8);
            TrackMeshBuilder.buildStartLine(trackMeshGroup, pts, roadHalf);
        }
        if (pitPoints.length >= 3 && pitBoxIndex < pitPoints.length) {
            TrackMeshBuilder.buildPitLane(trackMeshGroup, pitPoints, pitRoadHalf, pitBoxIndex);
        }

        markerGroup.clear();
        const pitMat = new THREE.MeshBasicMaterial({ color: 0x3498db });
        const geo = new THREE.SphereGeometry(2, 12, 12);
        mainPoints.forEach((p, i) => {
            const y = p.y || 0;
            const m = new THREE.Mesh(geo, materialForY(y));
            m.scale.setScalar(scaleForY(y));
            m.position.set(p.x, y + 1, p.z);
            m.userData = { list: 'main', index: i };
            markerGroup.add(m);
        });
        pitPoints.forEach((p, i) => {
            const m = new THREE.Mesh(geo, pitMat);
            m.position.set(p.x, 1, p.z);
            m.userData = { list: 'pit', index: i };
            markerGroup.add(m);
        });

        updateEntryTriggerVisual();
    }

    // ====================================================
    // RIQUADRO TRIGGER INGRESSO PIT — wireframe live sopra la pista, per
    // vedere a occhio se corrisponde davvero alla corsia box prima di
    // salvare (bug reale: un riquadro lasciato ai valori di un'altra pista
    // intercettava un tratto qualunque del tracciato principale).
    // ====================================================
    let entryTriggerMesh = null;
    // Valori "senza limite" (es. -999, convenzione ereditata da Monte Rosso
    // per il lato del riquadro che non deve restringere nulla) renderebbero
    // il wireframe enorme e inutile da vedere: la visualizzazione clampa,
    // il valore salvato nel JSON resta quello scritto nel campo.
    const VISUAL_CLAMP = 600;
    function updateEntryTriggerVisual() {
        if (entryTriggerMesh) { scene.remove(entryTriggerMesh); entryTriggerMesh = null; }
        const xMin = parseFloat(document.getElementById('entryXMin').value);
        const xMax = parseFloat(document.getElementById('entryXMax').value);
        const zMin = parseFloat(document.getElementById('entryZMin').value);
        const zMax = parseFloat(document.getElementById('entryZMax').value);
        if (![xMin, xMax, zMin, zMax].every(Number.isFinite) || xMin >= xMax || zMin >= zMax) return;

        const cx0 = Math.max(xMin, -VISUAL_CLAMP), cx1 = Math.min(xMax, VISUAL_CLAMP);
        const cz0 = Math.max(zMin, -VISUAL_CLAMP), cz1 = Math.min(zMax, VISUAL_CLAMP);
        if (cx0 >= cx1 || cz0 >= cz1) return;

        const geo = new THREE.BoxGeometry(cx1 - cx0, 3, cz1 - cz0);
        const edges = new THREE.EdgesGeometry(geo);
        entryTriggerMesh = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xff00ff }));
        entryTriggerMesh.position.set((cx0 + cx1) / 2, 1.5, (cz0 + cz1) / 2);
        scene.add(entryTriggerMesh);
    }

    // ====================================================
    // INTERAZIONE
    // ====================================================
    const raycaster = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    function worldFromEvent(ev) {
        mouseNDC.x = (ev.clientX / window.innerWidth) * 2 - 1;
        mouseNDC.y = -(ev.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouseNDC, camera);
        const hit = new THREE.Vector3();
        raycaster.ray.intersectPlane(groundPlane, hit);
        return hit;
    }

    function pickMarker(ev) {
        mouseNDC.x = (ev.clientX / window.innerWidth) * 2 - 1;
        mouseNDC.y = -(ev.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouseNDC, camera);
        const hits = raycaster.intersectObjects(markerGroup.children);
        return hits.length > 0 ? hits[0].object : null;
    }

    let dragging = null;
    let panning = false;
    let panLast = { x: 0, y: 0 };

    renderer.domElement.addEventListener('mousedown', (ev) => {
        if (ev.button === 1) {
            // Tasto centrale: pan, mai aggiunta/selezione punti.
            ev.preventDefault();
            panning = true;
            panLast = { x: ev.clientX, y: ev.clientY };
            return;
        }
        if (ev.button === 2) return;
        const marker = pickMarker(ev);
        if (marker) { dragging = marker.userData; return; }
        const hit = worldFromEvent(ev);
        activeList().push({ x: +hit.x.toFixed(2), z: +hit.z.toFixed(2) });
        rebuild();
    });

    renderer.domElement.addEventListener('mousemove', (ev) => {
        if (panning) {
            const dx = ev.clientX - panLast.x;
            const dy = ev.clientY - panLast.y;
            panLast = { x: ev.clientX, y: ev.clientY };
            // Pixel -> unità mondo, alla scala di zoom corrente.
            const worldPerPixelX = (camera.right - camera.left) / window.innerWidth;
            const worldPerPixelY = (camera.top - camera.bottom) / window.innerHeight;
            camTarget.x -= dx * worldPerPixelX;
            camTarget.z -= dy * worldPerPixelY;
            updateCameraTransform();
            return;
        }
        if (!dragging) return;
        const hit = worldFromEvent(ev);
        const list = dragging.list === 'main' ? mainPoints : pitPoints;
        const p = list[dragging.index];
        p.x = +hit.x.toFixed(2);
        p.z = +hit.z.toFixed(2);
        rebuild();
    });

    window.addEventListener('mouseup', () => { dragging = null; panning = false; });

    renderer.domElement.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const marker = pickMarker(ev);
        if (!marker) return;
        const list = marker.userData.list === 'main' ? mainPoints : pitPoints;
        list.splice(marker.userData.index, 1);
        rebuild();
    });

    // Rotellina su un punto della pista principale: alza/abbassa la y
    // (dislivello solo visivo — nessun effetto sulla fisica server).
    // Rotellina altrove: zoom della visuale, centrato sul cursore.
    renderer.domElement.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        const marker = pickMarker(ev);
        if (marker && marker.userData.list === 'main') {
            const p = mainPoints[marker.userData.index];
            p.y = +(((p.y || 0) - Math.sign(ev.deltaY) * 0.5).toFixed(2));
            rebuild();
            return;
        }
        const before = worldFromEvent(ev);
        zoom = Math.min(Math.max(zoom * (ev.deltaY > 0 ? 0.9 : 1.1), 0.2), 6);
        updateCameraTransform();
        // Ricentra così il punto sotto il cursore resta fermo durante lo zoom.
        const after = worldFromEvent(ev);
        camTarget.x -= (after.x - before.x);
        camTarget.z -= (after.z - before.z);
        updateCameraTransform();
    }, { passive: false });

    document.getElementById('undoBtn').addEventListener('click', () => { activeList().pop(); rebuild(); });
    document.getElementById('clearBtn').addEventListener('click', () => {
        if (document.getElementById('pitMode').checked) pitPoints = []; else mainPoints = [];
        rebuild();
    });
    ['roadHalfWidth', 'pitRoadHalfWidth', 'pitBoxIndex'].forEach(id => {
        document.getElementById(id).addEventListener('change', rebuild);
    });
    // 'input' (non 'change'): il riquadro si aggiorna mentre si digita, non
    // solo al blur — serve a vedere subito se copre la corsia box giusta.
    ['entryXMin', 'entryXMax', 'entryZMin', 'entryZMax'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateEntryTriggerVisual);
    });
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'u' || ev.key === 'U') { activeList().pop(); rebuild(); }
    });

    // ====================================================
    // CARICAMENTO (pista esistente nel gioco, o file .json locale)
    // ====================================================

    // Inquadra tutti i punti del tracciato caricato, altrimenti dopo
    // l'import ci si può ritrovare con la pista fuori dalla visuale fissa.
    function fitView() {
        if (mainPoints.length === 0) return;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        mainPoints.forEach(p => {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        });
        camTarget.x = (minX + maxX) / 2;
        camTarget.z = (minZ + maxZ) / 2;
        const halfSpanX = (maxX - minX) / 2 || 10;
        const halfSpanZ = (maxZ - minZ) / 2 || 10;
        const a = window.innerWidth / window.innerHeight;
        const neededHalfHeight = Math.max(halfSpanZ, halfSpanX / a) * 1.25;
        zoom = Math.min(Math.max(VIEW / neededHalfHeight, 0.2), 6);
        updateCameraTransform();
    }

    function applyTrackData(data) {
        if (!data || !Array.isArray(data.controlPoints) || data.controlPoints.length < 3) {
            alert('File pista non valido: mancano i punti di controllo (controlPoints)');
            return;
        }
        document.getElementById('trackId').value = data.id || '';
        document.getElementById('trackName').value = data.name || '';
        document.getElementById('targetKm').value = data.targetKm ?? 5;
        document.getElementById('roadHalfWidth').value = data.roadHalfWidth ?? 11;
        const pit = data.pit || {};
        document.getElementById('pitRoadHalfWidth').value = pit.roadHalfWidth ?? 5;
        document.getElementById('pitBoxIndex').value = pit.boxIndex ?? 0;
        const et = pit.entryTrigger || {};
        document.getElementById('entryXMin').value = et.xMin ?? -999;
        document.getElementById('entryXMax').value = et.xMax ?? -36;
        document.getElementById('entryZMin').value = et.zMin ?? -3;
        document.getElementById('entryZMax').value = et.zMax ?? 15;

        mainPoints = data.controlPoints.map(p => (
            typeof p.y === 'number' ? { x: p.x, z: p.z, y: p.y } : { x: p.x, z: p.z }
        ));
        pitPoints = Array.isArray(pit.path) ? pit.path.map(p => ({ x: p.x, z: p.z })) : [];

        rebuild();
        fitView();
    }

    async function refreshTrackList() {
        try {
            const res = await fetch('/api/f1/tracks');
            const tracks = await res.json();
            const select = document.getElementById('loadTrackSelect');
            select.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '-- seleziona --';
            select.appendChild(placeholder);
            tracks.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = `${t.name} (${t.id})`;
                select.appendChild(opt);
            });
        } catch (err) {
            console.warn('Impossibile caricare elenco piste:', err.message);
        }
    }
    refreshTrackList();

    document.getElementById('loadTrackBtn').addEventListener('click', async () => {
        const id = document.getElementById('loadTrackSelect').value;
        if (!id) { alert('Seleziona una pista dal menu'); return; }
        try {
            const res = await fetch(`/tracks/${id}.json`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            applyTrackData(await res.json());
        } catch (err) {
            alert(`Errore caricamento pista: ${err.message}`);
        }
    });

    document.getElementById('deleteTrackBtn').addEventListener('click', async () => {
        const id = document.getElementById('loadTrackSelect').value;
        if (!id) { alert('Seleziona una pista dal menu'); return; }
        if (!confirm(`Eliminare definitivamente la pista "${id}"? L'operazione non è reversibile.`)) return;
        try {
            const res = await fetch(`/api/f1/tracks/${id}`, { method: 'DELETE' });
            const body = await res.json();
            if (!res.ok) { alert(`Errore eliminazione: ${body.error || res.status}`); return; }
            alert(`Pista "${id}" eliminata.`);
            refreshTrackList();
        } catch (err) {
            alert(`Errore di rete durante l'eliminazione: ${err.message}`);
        }
    });

    document.getElementById('importFile').addEventListener('change', (ev) => {
        const file = ev.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                applyTrackData(JSON.parse(reader.result));
            } catch (err) {
                alert(`Errore lettura file: ${err.message}`);
            }
        };
        reader.readAsText(file);
        ev.target.value = ''; // permette di reimportare lo stesso file più volte
    });

    // ====================================================
    // EXPORT / SALVATAGGIO
    // ====================================================
    function validateBeforeSave() {
        if (mainPoints.length < 3) { alert('Servono almeno 3 punti per il tracciato principale'); return false; }
        if (pitPoints.length < 3) { alert('Servono almeno 3 punti per la corsia box (obbligatoria)'); return false; }
        if (!document.getElementById('trackId').value.trim()) { alert('Inserisci un id pista'); return false; }
        const pitBoxIndex = parseInt(document.getElementById('pitBoxIndex').value, 10) || 0;
        if (pitBoxIndex < 0 || pitBoxIndex >= pitPoints.length) { alert('pitBoxIndex non valido: deve essere un indice valido della corsia box'); return false; }

        const xMin = parseFloat(document.getElementById('entryXMin').value);
        const xMax = parseFloat(document.getElementById('entryXMax').value);
        const zMin = parseFloat(document.getElementById('entryZMin').value);
        const zMax = parseFloat(document.getElementById('entryZMax').value);
        if (!(xMin < xMax) || !(zMin < zMax)) { alert('Riquadro trigger ingresso pit non valido: min deve essere minore di max su entrambi gli assi'); return false; }
        // Stesso controllo del server (vedi trackLoader.validateTrackData):
        // il riquadro deve intercettare la corsia box vera, non un tratto
        // qualunque del tracciato principale (bug reale: valori di default
        // lasciati da un'altra pista).
        const hitsPath = pitPoints.some(p => p.x >= xMin && p.x <= xMax && p.z >= zMin && p.z <= zMax);
        if (!hitsPath) { alert('Il riquadro trigger (viola) non tocca nessun punto della corsia box: spostalo o allargalo prima di salvare'); return false; }
        return true;
    }

    function buildTrackData() {
        return {
            id: document.getElementById('trackId').value.trim(),
            name: document.getElementById('trackName').value.trim(),
            targetKm: parseFloat(document.getElementById('targetKm').value) || 1,
            roadHalfWidth: parseFloat(document.getElementById('roadHalfWidth').value) || 11,
            controlPoints: mainPoints,
            pit: {
                roadHalfWidth: parseFloat(document.getElementById('pitRoadHalfWidth').value) || 5,
                boxIndex: parseInt(document.getElementById('pitBoxIndex').value, 10) || 0,
                entryTrigger: {
                    xMin: parseFloat(document.getElementById('entryXMin').value),
                    xMax: parseFloat(document.getElementById('entryXMax').value),
                    zMin: parseFloat(document.getElementById('entryZMin').value),
                    zMax: parseFloat(document.getElementById('entryZMax').value)
                },
                path: pitPoints
            }
        };
    }

    document.getElementById('exportBtn').addEventListener('click', () => {
        if (!validateBeforeSave()) return;
        const data = buildTrackData();
        const blob = new Blob([JSON.stringify(data, null, 4)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${data.id || 'pista'}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // Salva direttamente in frontend/tracks/<id>.json lato server: la pista
    // compare subito nel menu della lobby, senza scaricare e spostare il
    // file a mano.
    document.getElementById('saveGameBtn').addEventListener('click', async () => {
        if (!validateBeforeSave()) return;
        const data = buildTrackData();
        try {
            const res = await fetch('/api/f1/tracks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const body = await res.json();
            if (!res.ok) { alert(`Errore salvataggio: ${body.error || res.status}`); return; }
            alert(`Pista "${data.id}" salvata: ora compare nel menu piste della lobby.`);
            refreshTrackList();
        } catch (err) {
            alert(`Errore di rete durante il salvataggio: ${err.message}`);
        }
    });

    function animate() {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
    }
    animate();
});
