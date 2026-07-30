// frontend/livery.js
let scene, camera, renderer, controls;
let M = null;          // modello voxel (da Voxelizer.voxelizeModel) — vedi shared/voxelizer.js
let voxelMesh = null;   // THREE.Mesh costruita su M.geometry
let displayRoot = null; // gruppo di sola inquadratura (scala/centra per la preview)
let currentParams = { pattern: 'racing_stripes', primary: '#d40000', secondary: '#ffffff', accent: '#101010' };

// Debounce per i color picker: l'evento 'input' scatta continuamente
// mentre si trascina il selettore colore (anche centinaia di volte per un
// singolo trascinamento) e applyCurrentLivery() ricalcola colore per ogni
// faccia del modello voxel — poco costoso ma comunque non gratis, niente
// debounce = decine di ricalcoli inutili per trascinamento.
let applyLiveryDebounceTimer = null;
function applyCurrentLiveryDebounced() {
    clearTimeout(applyLiveryDebounceTimer);
    applyLiveryDebounceTimer = setTimeout(applyCurrentLivery, 80);
}

// Ricalcola la livrea dai valori CORRENTI di currentParams — stessa
// funzione richiamata sia dai controlli manuali sia dal risultato della
// generazione AI, nessuna logica duplicata. LiveryPattern.applyLivery
// opera sul modello voxel M (non sulla mesh originale scolpita a mano):
// stesso principio dell'editor esterno di riferimento, un solo colore per
// faccia, zero sbavature tra voxel adiacenti.
function applyCurrentLivery() {
    if (!M) return;
    LiveryPattern.applyLivery(M, currentParams);
}

function setActivePatternButton() {
    document.querySelectorAll('.pattern-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.pattern === currentParams.pattern);
    });
}

function applyThemeToControls(theme) {
    currentParams.pattern = theme.patternStyle;
    currentParams.primary = theme.primaryPaint;
    currentParams.secondary = theme.secondaryPaint;
    currentParams.accent = theme.accentPaint;
    document.getElementById('col-primary').value = theme.primaryPaint;
    document.getElementById('col-secondary').value = theme.secondaryPaint;
    document.getElementById('col-accent').value = theme.accentPaint;
    setActivePatternButton();
    applyCurrentLivery();
}

// Disabilita il pulsante e mostra una rotella al posto del testo (vedi
// .btn-wide.is-loading in styles/livery.css) mentre una richiesta è in
// volo — Save e Generate possono impiegare un attimo (il primo serializza
// e spedisce l'intero array voxel, il secondo aspetta Gemini), senza
// feedback l'utente pensa che il click non sia andato a buon fine.
function setButtonLoading(btn, isLoading) {
    btn.disabled = isLoading;
    btn.classList.toggle('is-loading', isLoading);
}

function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// Scena/luci/renderer: stessa identica configurazione dell'editor esterno
// di riferimento (voxel_livery_studio.html) — è quello il "look" a cui
// puntiamo, non un'estetica nostra. Uniche differenze: API r128 (questo
// progetto è fermo a three@0.128, l'editor di riferimento usa 0.160 con
// outputColorSpace/SRGBColorSpace — qui l'equivalente r128 è
// outputEncoding/sRGBEncoding) e OrbitControls/GLTFLoader globali invece
// che import ESM.
function initScene() {
    scene = new THREE.Scene();

    // Fix: Converte il colore di sfondo in Lineare
    scene.background = new THREE.Color('#14151a').convertSRGBToLinear();

    scene.add(new THREE.AmbientLight(0xffffff, 1.2)); // Il bianco non ha bisogno di conversione

    // Fix: Converte i colori della HemisphereLight
    const hemiLight = new THREE.HemisphereLight(0xbed2ff, 0x2b2722, 1.0);
    hemiLight.color.convertSRGBToLinear();
    hemiLight.groundColor.convertSRGBToLinear();
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(65, 115, 75);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 400;
    keyLight.shadow.camera.left = -110;
    keyLight.shadow.camera.right = 110;
    keyLight.shadow.camera.top = 110;
    keyLight.shadow.camera.bottom = -110;
    keyLight.shadow.bias = -0.0009;
    scene.add(keyLight);

    // Fix: Converte il colore della FillLight
    const fillLight = new THREE.DirectionalLight(0x9ab8ff, 0.6);
    fillLight.color.convertSRGBToLinear();
    fillLight.position.set(-75, 45, -65);
    scene.add(fillLight);

    // Fix: Converte il colore del materiale del pavimento
    const floorColor = new THREE.Color('#0c0d10').convertSRGBToLinear();
    const floor = new THREE.Mesh(
        new THREE.CircleGeometry(420, 64),
        new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.85, metalness: 0.0 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    displayRoot = new THREE.Group();
    scene.add(displayRoot);

    camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.5, 4000);
    camera.position.set(-78, 48, 92);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding; // r128: equivalente di outputColorSpace=SRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping;
    // Forza la r128 a usare lo stesso calcolo fotometrico della r160
    renderer.physicallyCorrectLights = true;
    document.getElementById('livery-canvas-wrap').appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.set(0, 12, 0);
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 15;
    controls.maxDistance = 400;

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    (function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    })();
}

// Materiale della mesh voxel — stesso dell'editor di riferimento
// (matLit): vertexColors true (i colori vengono dalla geometria, non da
// una texture), roughness/metalness fissi per un look "verniciato" pulito.
const voxelMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.35 });

// Carica il .glb, lo VOXELIZZA (frontend/shared/voxelizer.js — stessa
// pipeline dell'editor esterno di riferimento: niente più tentativi di
// dipingere la mesh scolpita a mano direttamente, che sbava sempre sulle
// superfici curve) e inquadra il risultato in scena, esattamente come fa
// rebuild() nell'editor di riferimento (scala/centra sul bounding box,
// indipendente dalle unità del file sorgente).
function loadCarForPreview(onReady) {
    const loader = new THREE.GLTFLoader();
    loader.load('/assets/custom/f1Car.glb', (gltf) => {
        let model;
        try {
            model = Voxelizer.voxelizeModel(gltf.scene);
        } catch (err) {
            console.error('[livery] voxelizzazione fallita:', err);
            showToast('Could not process the car model.', 'error');
            return;
        }

        const mesh = new THREE.Mesh(model.geometry, voxelMaterial);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.scale.setScalar(model.voxelSize);
        mesh.position.copy(model.gridOrigin);

        displayRoot.clear();
        displayRoot.add(mesh);
        displayRoot.scale.setScalar(1);
        displayRoot.position.set(0, 0, 0);
        const box = new THREE.Box3().setFromObject(mesh);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const s = 70 / Math.max(size.x, size.y, size.z);
        displayRoot.scale.setScalar(s);
        displayRoot.position.set(-center.x * s, -box.min.y * s, -center.z * s);
        controls.target.set(0, size.y * s * 0.45, 0);

        onReady(model, mesh);
    }, undefined, (err) => console.error('Errore caricamento modello livery:', err));
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof firebaseAuth === 'undefined' || !firebaseAuth) {
        showToast('Firebase is not configured yet.', 'error');
        return;
    }
    firebaseAuth.onAuthStateChanged((user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }
        initScene();

        // Modello (.glb + voxelizzazione) e livrea salvata caricati IN
        // PARALLELO, non più uno dopo l'altro: prima l'auto compariva
        // subito con i colori di default (per non mostrarla nera, col
        // buffer colore a zero) e veniva ridipinta con quelli veri solo
        // dopo che la fetch della livrea finiva — un lampo di colore
        // sbagliato per un paio di secondi, notato dall'utente. Ora la
        // mesh resta invisibile finché non sappiamo davvero quali colori
        // applicare, poi appare già colorata correttamente al primo
        // frame; aspettare le due cose insieme invece che in sequenza è
        // anche più veloce nel caso comune (tempo totale = il più lento
        // dei due, non la somma).
        const modelReady = new Promise((resolve) => {
            loadCarForPreview((model, mesh) => {
                mesh.visible = false;
                resolve({ model, mesh });
            });
        });
        // Pre-carica una livrea già salvata, se esiste — 404 (prima volta)
        // è normale, si resta sui default di currentParams.
        const liveryReady = fetch('/api/livery/' + user.uid)
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null);

        Promise.all([modelReady, liveryReady]).then(([{ model, mesh }, doc]) => {
            M = model;
            voxelMesh = mesh;
            if (doc && doc.liveryParams) {
                currentParams.pattern = doc.liveryParams.pattern || currentParams.pattern;
                currentParams.primary = doc.liveryParams.primary || currentParams.primary;
                currentParams.secondary = doc.liveryParams.secondary || currentParams.secondary;
                currentParams.accent = doc.liveryParams.accent || currentParams.accent;
                document.getElementById('col-primary').value = currentParams.primary;
                document.getElementById('col-secondary').value = currentParams.secondary;
                document.getElementById('col-accent').value = currentParams.accent;
            }
            setActivePatternButton();
            applyCurrentLivery();
            mesh.visible = true;
        });

        document.querySelectorAll('.pattern-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                currentParams.pattern = btn.dataset.pattern;
                setActivePatternButton();
                applyCurrentLivery();
            });
        });
        document.getElementById('col-primary').addEventListener('input', (e) => {
            currentParams.primary = e.target.value; applyCurrentLiveryDebounced();
        });
        document.getElementById('col-secondary').addEventListener('input', (e) => {
            currentParams.secondary = e.target.value; applyCurrentLiveryDebounced();
        });
        document.getElementById('col-accent').addEventListener('input', (e) => {
            currentParams.accent = e.target.value; applyCurrentLiveryDebounced();
        });

        document.getElementById('btn-save').addEventListener('click', async () => {
            if (!M) return;
            const btn = document.getElementById('btn-save');
            setButtonLoading(btn, true);
            try {
                // Un solo array piatto (l'intera geometria voxel è ormai una
                // mesh unica, non più una mesh separata per parte come nello
                // schema pre-voxelizzazione) — vedi
                // docs/superpowers/specs/2026-07-29-f1-livery-precomputed-colors-design.md
                // per il perché si salva il colore già calcolato invece dei
                // soli parametri: rifare la voxelizzazione ad ogni caricamento
                // in gara, per ogni auto, sarebbe troppo costoso lato client.
                // È anche il motivo per cui il salvataggio richiede un attimo
                // (array enorme da serializzare e spedire): setButtonLoading
                // mostra una rotella per farlo capire, non basta disabilitare
                // silenziosamente il pulsante (bug segnalato dall'utente:
                // senza feedback pensava che il click non fosse andato a
                // buon fine e ricliccava più volte).
                const liveryColors = Array.from(M.geometry.attributes.color.array);
                const idToken = await user.getIdToken();
                const res = await fetch('/api/livery', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
                    body: JSON.stringify({ liveryColors, liveryParams: currentParams })
                });
                if (!res.ok) throw new Error('save failed: ' + res.status);
                showToast('Livery saved!', 'success');
            } catch (err) {
                console.error('[livery] save error', err);
                showToast('Could not save livery. Try again.', 'error');
            } finally {
                setButtonLoading(btn, false);
            }
        });

        document.getElementById('btn-generate').addEventListener('click', async () => {
            const prompt = document.getElementById('ai-prompt').value.trim();
            if (!prompt) {
                showToast('Write a theme description first.', 'error');
                return;
            }
            const btn = document.getElementById('btn-generate');
            setButtonLoading(btn, true);
            try {
                const idToken = await user.getIdToken();
                const res = await fetch('/api/livery/generate-theme', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
                    body: JSON.stringify({ prompt })
                });
                if (!res.ok) throw new Error('generate failed: ' + res.status);
                const theme = await res.json();
                applyThemeToControls(theme);
                showToast(`Theme "${theme.themeName}" applied.`, 'success');
            } catch (err) {
                console.error('[livery] generate-theme error', err);
                showToast('Could not generate a theme. Try again.', 'error');
            } finally {
                setButtonLoading(btn, false);
            }
        });
        document.getElementById('ai-prompt').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('btn-generate').click();
        });
    });
});
