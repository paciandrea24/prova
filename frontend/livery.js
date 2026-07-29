// frontend/livery.js
let scene, camera, renderer, controls;
let carGroup = null;

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
        });
    });
});
