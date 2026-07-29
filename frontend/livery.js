// frontend/livery.js
let scene, camera, renderer, controls;
let carGroup = null;
let currentParams = { pattern: 'racing_stripes', primary: '#d40000', secondary: '#ffffff', accent: '#101010' };

// Debounce per i color picker: l'evento 'input' scatta continuamente
// mentre si trascina il selettore colore (anche centinaia di volte per un
// singolo trascinamento) e applyCurrentLivery() clona la geometria delle
// mesh dipinte ad ogni chiamata (frontend/shared/liveryPattern.js, fuori
// scope qui) senza disporre la vecchia — senza debounce è un leak di
// memoria/CPU. Usato SOLO dai listener 'input' dei 3 color picker, non dai
// pulsanti pattern/preload/AI (quelli scattano una volta sola).
let applyLiveryDebounceTimer = null;
function applyCurrentLiveryDebounced() {
    clearTimeout(applyLiveryDebounceTimer);
    applyLiveryDebounceTimer = setTimeout(applyCurrentLivery, 80);
}

function hexStringToInt(hex) {
    return parseInt(hex.replace('#', ''), 16);
}

// Ricalcola l'anteprima dai valori CORRENTI di currentParams — stessa
// funzione richiamata sia dai controlli manuali (Step 3) sia dal risultato
// della generazione AI (Task 5), nessuna logica duplicata.
function applyCurrentLivery() {
    if (!carGroup) return;
    LiveryPattern.applyVoxelLiveryPattern(carGroup, {
        pattern: currentParams.pattern,
        primary: hexStringToInt(currentParams.primary),
        secondary: hexStringToInt(currentParams.secondary),
        accent: hexStringToInt(currentParams.accent)
    });
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

function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14141a);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(10, 20, 10);
    scene.add(sun);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(8, 5, 8);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('livery-canvas-wrap').appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.8, 0);
    controls.enableDamping = true;

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

// Loader dedicato e leggero — a differenza di carLoader.js::loadCarModel
// NON gestisce audio motore posizionale, rotazione ruote o colore mescola
// gomme (tutta roba di gara non pertinente a una pagina di sola
// personalizzazione). Fa solo ciò che liveryPattern.js richiede: centrare
// il modello e salvare pristineTex per ogni mesh con texture.
function loadCarForPreview(onReady) {
    const loader = new THREE.GLTFLoader();
    loader.load('/assets/custom/f1Car.glb', (gltf) => {
        const group = new THREE.Group();
        const model = gltf.scene;
        model.scale.set(3.5, 3.5, 3.5);

        model.updateMatrixWorld(true);
        const bbox0 = new THREE.Box3().setFromObject(model);
        const center0 = bbox0.getCenter(new THREE.Vector3());
        model.position.x -= center0.x;
        model.position.z -= center0.z;
        model.position.y -= bbox0.min.y;

        model.traverse((child) => {
            if (!child.isMesh) return;
            child.castShadow = true;
            child.receiveShadow = true;
            child.material = child.material.clone();
            if (child.material.map) {
                child.userData.pristineTex = child.material.map;
            }
        });

        group.add(model);
        scene.add(group);
        onReady(group);
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
        loadCarForPreview((group) => {
            carGroup = group;
            // Pre-carica una livrea già salvata, se esiste — 404 (prima
            // volta) è normale, si resta sui default di currentParams.
            fetch('/api/livery/' + user.uid)
                .then((res) => (res.ok ? res.json() : null))
                .then((doc) => {
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
                })
                .catch(() => { setActivePatternButton(); applyCurrentLivery(); });
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
            if (!carGroup) return;
            const liveryColors = {};
            carGroup.traverse((child) => {
                if (child.isMesh && child.geometry.attributes.color) {
                    liveryColors[child.name] = Array.from(child.geometry.attributes.color.array);
                }
            });
            if (!Object.keys(liveryColors).length) {
                showToast('Nothing to save yet.', 'error');
                return;
            }
            try {
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
            }
        });

        document.getElementById('btn-generate').addEventListener('click', async () => {
            const prompt = document.getElementById('ai-prompt').value.trim();
            if (!prompt) {
                showToast('Write a theme description first.', 'error');
                return;
            }
            const btn = document.getElementById('btn-generate');
            btn.disabled = true;
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
                btn.disabled = false;
            }
        });
        document.getElementById('ai-prompt').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('btn-generate').click();
        });
    });
});
