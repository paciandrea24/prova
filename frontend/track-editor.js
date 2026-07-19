// frontend/track-editor.js
document.addEventListener('DOMContentLoaded', () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a22);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(100, 200, 100);
    scene.add(sun);

    const VIEW = 220;
    const aspect = window.innerWidth / window.innerHeight;
    const camera = new THREE.OrthographicCamera(-VIEW * aspect, VIEW * aspect, VIEW, -VIEW, 0.1, 2000);
    camera.position.set(0, 500, 0.001);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    scene.add(new THREE.GridHelper(2000, 100, 0x444455, 0x2a2a33));

    window.addEventListener('resize', () => {
        const a = window.innerWidth / window.innerHeight;
        camera.left = -VIEW * a; camera.right = VIEW * a;
        camera.top = VIEW; camera.bottom = -VIEW;
        camera.updateProjectionMatrix();
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
        const mainMat = new THREE.MeshBasicMaterial({ color: 0xf1c40f });
        const pitMat  = new THREE.MeshBasicMaterial({ color: 0x3498db });
        const geo = new THREE.SphereGeometry(2, 12, 12);
        mainPoints.forEach((p, i) => {
            const m = new THREE.Mesh(geo, mainMat);
            m.position.set(p.x, (p.y || 0) + 1, p.z);
            m.userData = { list: 'main', index: i };
            markerGroup.add(m);
        });
        pitPoints.forEach((p, i) => {
            const m = new THREE.Mesh(geo, pitMat);
            m.position.set(p.x, 1, p.z);
            m.userData = { list: 'pit', index: i };
            markerGroup.add(m);
        });
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

    renderer.domElement.addEventListener('mousedown', (ev) => {
        if (ev.button === 2) return;
        const marker = pickMarker(ev);
        if (marker) { dragging = marker.userData; return; }
        const hit = worldFromEvent(ev);
        activeList().push({ x: +hit.x.toFixed(2), z: +hit.z.toFixed(2) });
        rebuild();
    });

    renderer.domElement.addEventListener('mousemove', (ev) => {
        if (!dragging) return;
        const hit = worldFromEvent(ev);
        const list = dragging.list === 'main' ? mainPoints : pitPoints;
        const p = list[dragging.index];
        p.x = +hit.x.toFixed(2);
        p.z = +hit.z.toFixed(2);
        rebuild();
    });

    window.addEventListener('mouseup', () => { dragging = null; });

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
    renderer.domElement.addEventListener('wheel', (ev) => {
        const marker = pickMarker(ev);
        if (!marker || marker.userData.list !== 'main') return;
        ev.preventDefault();
        const p = mainPoints[marker.userData.index];
        p.y = +(((p.y || 0) - Math.sign(ev.deltaY) * 0.5).toFixed(2));
        rebuild();
    }, { passive: false });

    document.getElementById('undoBtn').addEventListener('click', () => { activeList().pop(); rebuild(); });
    document.getElementById('clearBtn').addEventListener('click', () => {
        if (document.getElementById('pitMode').checked) pitPoints = []; else mainPoints = [];
        rebuild();
    });
    ['roadHalfWidth', 'pitRoadHalfWidth', 'pitBoxIndex'].forEach(id => {
        document.getElementById(id).addEventListener('change', rebuild);
    });
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'u' || ev.key === 'U') { activeList().pop(); rebuild(); }
    });

    // ====================================================
    // EXPORT
    // ====================================================
    document.getElementById('exportBtn').addEventListener('click', () => {
        if (mainPoints.length < 3) { alert('Servono almeno 3 punti per il tracciato principale'); return; }
        if (pitPoints.length < 3) { alert('Servono almeno 3 punti per la corsia box (obbligatoria)'); return; }
        const data = {
            id: document.getElementById('trackId').value.trim(),
            name: document.getElementById('trackName').value.trim(),
            targetKm: parseFloat(document.getElementById('targetKm').value) || 1,
            roadHalfWidth: parseFloat(document.getElementById('roadHalfWidth').value) || 11,
            controlPoints: mainPoints,
            pit: {
                roadHalfWidth: parseFloat(document.getElementById('pitRoadHalfWidth').value) || 5,
                boxIndex: parseInt(document.getElementById('pitBoxIndex').value, 10) || 0,
                entryTrigger: {
                    xMax: parseFloat(document.getElementById('entryXMax').value),
                    zMin: parseFloat(document.getElementById('entryZMin').value),
                    zMax: parseFloat(document.getElementById('entryZMax').value)
                },
                path: pitPoints
            }
        };
        const blob = new Blob([JSON.stringify(data, null, 4)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${data.id || 'pista'}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    function animate() {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
    }
    animate();
});
