// frontend/fps.js
'use strict';

// ══════════════════════════════════════════════════════
//  PARAMETRI URL
// ══════════════════════════════════════════════════════
const urlParams = new URLSearchParams(window.location.search);
const LOBBY_ID = urlParams.get('lobby');
const MY_COLOR = decodeURIComponent(urlParams.get('color') || '#ffffff');

if (!LOBBY_ID || !MY_COLOR) { window.location.href = '/'; }

// ══════════════════════════════════════════════════════
//  COSTANTI GIOCO
// ══════════════════════════════════════════════════════
const PLAYER_HEIGHT = 1.7;
const PLAYER_SPEED = 8;
const PLAYER_RADIUS = 0.4;
const GRAVITY = 20;
const JUMP_FORCE = 7;
const MOUSE_SENS = 0.0015;
const MAP_HALF = 60;      // mezza dimensione mappa

// Hitbox sfera per detection: raggio per ogni player remoto
const HITBOX_RADIUS = 0.55;

// ══════════════════════════════════════════════════════
//  STATO GIOCO
// ══════════════════════════════════════════════════════
let gameState = {
    phase: 'weapon_select',
    myHp: 100,
    myAmmo: 30,
    myMaxAmmo: 30,
    myWeapon: 'assault',
    isDead: false,
    currentRound: 1,
    totalRounds: 5,
    scores: {},
    players: {},   // color -> { mesh, hp, dead, ... }
    weapons: {},
    hostColor: null
};

let keys = {};
let yaw = 0;   // rotazione orizzontale
let pitch = 0;   // rotazione verticale
let velocityY = 0;
let onGround = true;
let isReloading = false;
let lastFireTime = 0;
let confirmed = false;

// ══════════════════════════════════════════════════════
//  THREE.JS SETUP
// ══════════════════════════════════════════════════════
const canvas = document.getElementById('fps-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x87ceeb);  // cielo

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x87ceeb, 0.018);

const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 300);
camera.position.set(0, PLAYER_HEIGHT, 0);

// Root del player (usato per movimento)
const playerRoot = new THREE.Object3D();
scene.add(playerRoot);
playerRoot.add(camera);

// ── Resize ──────────────────────────────────────────
function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

// ══════════════════════════════════════════════════════
//  ILLUMINAZIONE
// ══════════════════════════════════════════════════════
const ambient = new THREE.AmbientLight(0xffeedd, 0.5);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff5e0, 1.2);
sun.position.set(30, 60, 20);
sun.castShadow = true;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 200;
sun.shadow.camera.left = -80;
sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80;
sun.shadow.camera.bottom = -80;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.bias = -0.001;
scene.add(sun);

const hemi = new THREE.HemisphereLight(0x87ceeb, 0x6b7c3a, 0.4);
scene.add(hemi);

// ══════════════════════════════════════════════════════
//  MATERIALI RIUTILIZZABILI
// ══════════════════════════════════════════════════════
const MAT = {
    ground: new THREE.MeshLambertMaterial({ color: 0x5a6b30 }),   // erba scura
    concrete: new THREE.MeshLambertMaterial({ color: 0x7a7a7a }),   // cemento
    wall: new THREE.MeshLambertMaterial({ color: 0x5c5040 }),   // muro
    crate: new THREE.MeshLambertMaterial({ color: 0x8b6914 }),   // cassa legno
    crateDark: new THREE.MeshLambertMaterial({ color: 0x5c4010 }),
    metal: new THREE.MeshLambertMaterial({ color: 0x4a5568 }),
    brick: new THREE.MeshLambertMaterial({ color: 0x8b4513 }),
    sand: new THREE.MeshLambertMaterial({ color: 0xc2a464 }),
    water: new THREE.MeshLambertMaterial({ color: 0x2980b9, transparent: true, opacity: 0.7 }),
    sky: new THREE.MeshLambertMaterial({ color: 0x87ceeb, side: THREE.BackSide }),
};

// ══════════════════════════════════════════════════════
//  HELPER: box con ombra
// ══════════════════════════════════════════════════════
function makeBox(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
}

// Lista AABB degli oggetti solidi per collision detection
const solidBoxes = []; // Array di {min: Vector3, max: Vector3}

function addSolid(w, h, d, x, y, z, mat) {
    const mesh = makeBox(w, h, d, mat, x, y + h / 2, z);
    solidBoxes.push({
        min: new THREE.Vector3(x - w / 2, y, z - d / 2),
        max: new THREE.Vector3(x + w / 2, y + h, z + d / 2)
    });
    return mesh;
}

// ══════════════════════════════════════════════════════
//  MAPPA ARTIGIANALE
//  Urban Warfare — piazza centrale con edifici, casse,
//  corridoi laterali, bunker e zona acqua
// ══════════════════════════════════════════════════════
function buildMap() {

    // ── Terreno base ──
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2),
        MAT.ground
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ── Pavimento cemento (piazza centrale 30x30) ──
    const plaza = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        MAT.concrete
    );
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.01;
    plaza.receiveShadow = true;
    scene.add(plaza);

    // ── Confini mappa (muri invisibili) ──
    // North/South
    addSolid(MAP_HALF * 2, 10, 1, 0, 0, -MAP_HALF, MAT.wall);
    addSolid(MAP_HALF * 2, 10, 1, 0, 0, MAP_HALF, MAT.wall);
    // East/West
    addSolid(1, 10, MAP_HALF * 2, MAP_HALF, 0, 0, MAT.wall);
    addSolid(1, 10, MAP_HALF * 2, -MAP_HALF, 0, 0, MAT.wall);

    // ── Edificio Nord-Ovest (grande) ──
    // Corpo
    addSolid(18, 8, 14, -32, 0, -28, MAT.brick);
    // Tetto praticabile
    makeBox(18, 0.4, 14, MAT.concrete, -32, 8.2, -28);
    // Finestre (fori simulati con box scuri più piccoli sovrapposti)
    makeBox(2, 2, 0.3, MAT.metal, -38, 4, -22);
    makeBox(2, 2, 0.3, MAT.metal, -34, 4, -22);
    makeBox(2, 2, 0.3, MAT.metal, -30, 4, -22);
    // Accesso tetto: rampa
    addSolid(3, 0.2, 6, -25, 0, -28, MAT.concrete).rotation; // scala
    const ramp1 = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 8.5), MAT.concrete);
    ramp1.position.set(-24.5, 4, -28);
    ramp1.rotation.x = -Math.atan2(8, 8.5);
    ramp1.castShadow = ramp1.receiveShadow = true;
    scene.add(ramp1);

    // ── Edificio Nord-Est ──
    addSolid(14, 6, 16, 30, 0, -30, MAT.brick);
    makeBox(14, 0.4, 16, MAT.concrete, 30, 6.2, -30);
    // Scale esterne
    addSolid(3, 3, 1, 24, 0, -26, MAT.concrete);
    addSolid(3, 6, 1, 23, 0, -26, MAT.concrete);

    // ── Torre / bunker al centro ──
    // Struttura
    addSolid(6, 5, 6, 0, 0, 0, MAT.concrete);
    // Apertura (corridoio passante): simulata lasciando gap nei solid
    // Visivamente aggiungiamo un arco
    makeBox(6, 0.5, 6, MAT.metal, 0, 5.25, 0);  // tetto bunker

    // ── Edificio Sud-Ovest ──
    addSolid(16, 7, 12, -30, 0, 30, MAT.brick);
    makeBox(16, 0.4, 12, MAT.concrete, -30, 7.2, 30);

    // ── Edificio Sud-Est (basso, largo) ──
    addSolid(20, 4, 10, 32, 0, 35, MAT.concrete);
    makeBox(20, 0.4, 10, MAT.concrete, 32, 4.2, 35);

    // ── Muri di cinta / corridoi ──
    // Corridoio ovest (muri su entrambi i lati)
    addSolid(1, 3, 30, -16, 0, 5, MAT.wall);
    addSolid(1, 3, 30, -22, 0, 5, MAT.wall);
    // Corridoio est
    addSolid(1, 3, 28, 18, 0, 5, MAT.wall);
    addSolid(1, 3, 28, 24, 0, 5, MAT.wall);

    // ── Casse di copertura (cluster) ──
    // Cluster centro-Nord
    addSolid(2, 1.5, 2, -4, 0, -12, MAT.crate);
    addSolid(2, 1.5, 2, -4, 0, -9, MAT.crate);
    addSolid(2, 3, 2, 0, 0, -12, MAT.crateDark);
    addSolid(2, 1.5, 2, 4, 0, -12, MAT.crate);
    addSolid(2, 1.5, 2, 4, 0, -9, MAT.crate);

    // Cluster centro-Sud
    addSolid(2, 1.5, 2, -4, 0, 12, MAT.crate);
    addSolid(2, 3, 2, 0, 0, 12, MAT.crateDark);
    addSolid(2, 1.5, 2, 4, 0, 12, MAT.crate);
    addSolid(2, 1.5, 2, -4, 0, 15, MAT.crate);
    addSolid(2, 1.5, 2, 4, 0, 15, MAT.crate);

    // Casse angoli corridoio ovest
    addSolid(2, 1.5, 2, -18, 0, -5, MAT.crate);
    addSolid(2, 1.5, 2, -20, 0, 0, MAT.crate);
    addSolid(2, 1.5, 2, -18, 0, 15, MAT.crate);

    // Casse est
    addSolid(2, 1.5, 2, 20, 0, -8, MAT.crate);
    addSolid(2, 1.5, 2, 22, 0, 10, MAT.crate);
    addSolid(2, 1.5, 2, 20, 0, 18, MAT.crate);
    addSolid(2, 3, 2, 20, 0, 20, MAT.crateDark);

    // ── Zona sabbia / fossa Sud ──
    const sandPit = new THREE.Mesh(new THREE.PlaneGeometry(20, 15), MAT.sand);
    sandPit.rotation.x = -Math.PI / 2;
    sandPit.position.set(0, 0.01, 45);
    sandPit.receiveShadow = true;
    scene.add(sandPit);
    // Piccole berme
    addSolid(8, 1, 1, -6, 0, 42, MAT.sand);
    addSolid(6, 0.8, 1, 5, 0, 48, MAT.sand);

    // ── Vasca d'acqua Nord-Est ──
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), MAT.water);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(44, 0.05, -45);
    scene.add(pool);
    // Bordi piscina
    addSolid(12, 0.5, 1, 44, 0, -41, MAT.concrete);
    addSolid(12, 0.5, 1, 44, 0, -49, MAT.concrete);
    addSolid(1, 0.5, 8, 38, 0, -45, MAT.concrete);
    addSolid(1, 0.5, 8, 50, 0, -45, MAT.concrete);

    // ── Skybox semplice ──
    const skyGeo = new THREE.BoxGeometry(500, 500, 500);
    const sky = new THREE.Mesh(skyGeo, MAT.sky);
    scene.add(sky);

    // ── Vegetazione decorativa (alberi stilizzati) ──
    addTree(-48, 0, -48);
    addTree(48, 0, -48);
    addTree(-48, 0, 48);
    addTree(48, 0, 48);
    addTree(-10, 0, -50);
    addTree(8, 0, 50);
    addTree(-50, 0, 10);
    addTree(50, 0, -15);
}

function addTree(x, y, z) {
    // Tronco
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.4, 3, 6),
        new THREE.MeshLambertMaterial({ color: 0x5c3a1e })
    );
    trunk.position.set(x, y + 1.5, z);
    trunk.castShadow = true;
    scene.add(trunk);
    // Chioma
    const foliage = new THREE.Mesh(
        new THREE.SphereGeometry(2.5, 6, 5),
        new THREE.MeshLambertMaterial({ color: 0x2d5a27 })
    );
    foliage.position.set(x, y + 4.5, z);
    foliage.castShadow = true;
    scene.add(foliage);
    // Collisione tronco
    solidBoxes.push({
        min: new THREE.Vector3(x - 0.4, y, z - 0.4),
        max: new THREE.Vector3(x + 0.4, y + 3, z + 0.4)
    });
}

buildMap();

// ══════════════════════════════════════════════════════
//  MODELLO GIOCATORE REMOTO
// ══════════════════════════════════════════════════════
function createPlayerMesh(color) {
    const group = new THREE.Group();

    // Corpo
    const body = new THREE.Mesh(
        new THREE.CapsuleGeometry ? new THREE.CylinderGeometry(0.35, 0.35, 1.2, 8)
            : new THREE.CylinderGeometry(0.35, 0.35, 1.2, 8),
        new THREE.MeshLambertMaterial({ color })
    );
    body.position.y = 0.6;
    body.castShadow = true;
    group.add(body);

    // Testa
    const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 8, 6),
        new THREE.MeshLambertMaterial({ color })
    );
    head.position.y = 1.5;
    head.castShadow = true;
    group.add(head);

    // Arma visiva (semplice box)
    const gun = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.1, 0.7),
        new THREE.MeshLambertMaterial({ color: 0x222222 })
    );
    gun.position.set(0.3, 1.2, -0.4);
    group.add(gun);

    return { group, head };
}

// ══════════════════════════════════════════════════════
//  ARMA IN PRIMA PERSONA (viewport model)
// ══════════════════════════════════════════════════════
const weaponGroup = new THREE.Group();
camera.add(weaponGroup);

const weaponModels = {};

function buildWeaponModels() {
    // Assault Rifle
    const ar = new THREE.Group();
    ar.add(makeViewBox(0.06, 0.08, 0.55, 0.08, -0.12, -0.35, 0x2c2c2c));
    ar.add(makeViewBox(0.04, 0.04, 0.15, 0.08, -0.17, -0.18, 0x1a1a1a)); // mag
    ar.add(makeViewBox(0.02, 0.02, 0.12, 0.08, -0.1, -0.6, 0x111111));  // barrel
    weaponModels.assault = ar;

    // SMG
    const smg = new THREE.Group();
    smg.add(makeViewBox(0.055, 0.07, 0.38, 0.08, -0.12, -0.28, 0x333333));
    smg.add(makeViewBox(0.04, 0.1, 0.04, 0.08, -0.17, -0.16, 0x222222));
    weaponModels.smg = smg;

    // Shotgun
    const sg = new THREE.Group();
    sg.add(makeViewBox(0.07, 0.09, 0.65, 0.08, -0.12, -0.4, 0x5c3a1e));
    sg.add(makeViewBox(0.04, 0.04, 0.65, 0.08, -0.18, -0.4, 0x1a1a1a));
    weaponModels.shotgun = sg;

    // Sniper
    const sn = new THREE.Group();
    sn.add(makeViewBox(0.055, 0.07, 0.8, 0.08, -0.12, -0.5, 0x1a1a1a));
    sn.add(makeViewBox(0.04, 0.06, 0.18, 0.08, -0.07, -0.38, 0x333333)); // scope
    sn.add(makeViewBox(0.015, 0.015, 0.2, 0.08, -0.12, -0.9, 0x111111));
    weaponModels.sniper = sn;

    Object.values(weaponModels).forEach(g => {
        g.visible = false;
        weaponGroup.add(g);
    });
}

function makeViewBox(w, h, d, x, y, z, color) {
    const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshLambertMaterial({ color })
    );
    m.position.set(x, y, z);
    return m;
}

buildWeaponModels();

function switchWeaponModel(key) {
    Object.values(weaponModels).forEach(g => g.visible = false);
    if (weaponModels[key]) weaponModels[key].visible = true;
}
switchWeaponModel('assault');

// ══════════════════════════════════════════════════════
//  POINTER LOCK
// ══════════════════════════════════════════════════════
let pointerLocked = false;

document.getElementById('ptr-btn').addEventListener('click', () => {
    canvas.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
    document.getElementById('pointer-prompt').classList.toggle('active', !pointerLocked);
});

document.addEventListener('mousemove', (e) => {
    if (!pointerLocked || gameState.isDead || gameState.phase !== 'playing') return;
    yaw -= e.movementX * MOUSE_SENS;
    pitch -= e.movementY * MOUSE_SENS;
    pitch = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, pitch));
});

// ══════════════════════════════════════════════════════
//  INPUT TASTIERA
// ══════════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
    keys[e.code] = true;

    if (e.code === 'KeyR' && !isReloading && gameState.myAmmo < gameState.myMaxAmmo) {
        startReload();
    }
    if (e.code === 'Space' && onGround && gameState.phase === 'playing' && !gameState.isDead) {
        velocityY = JUMP_FORCE;
        onGround = false;
    }
    // ESC: rilascia pointer lock (browser gestisce)
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

// ══════════════════════════════════════════════════════
//  SPARO
// ══════════════════════════════════════════════════════
document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (!pointerLocked || gameState.isDead || gameState.phase !== 'playing') return;
    tryShoot();
});

// Auto-fire
let autoFireInterval = null;
document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const w = gameState.weapons[gameState.myWeapon];
    if (w && w.auto) {
        autoFireInterval = setInterval(tryShoot, w.fireRate);
    }
});
document.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    clearInterval(autoFireInterval);
});

function tryShoot() {
    if (!pointerLocked || gameState.isDead || gameState.phase !== 'playing') return;
    if (isReloading) return;

    const w = gameState.weapons[gameState.myWeapon];
    if (!w) return;

    const now = Date.now();
    if (now - lastFireTime < w.fireRate) return;
    lastFireTime = now;

    if (gameState.myAmmo <= 0) {
        startReload();
        return;
    }

    gameState.myAmmo--;
    updateAmmoHUD();
    playMuzzleFlash();

    // Raycast su hitbox sferiche dei giocatori remoti
    const dir = getShootDir(w.spread);

    for (const [color, rp] of Object.entries(gameState.players)) {
        if (rp.dead) continue;

        const targetPos = rp.group.position.clone().add(new THREE.Vector3(0, PLAYER_HEIGHT * 0.6, 0));
        const toTarget = targetPos.clone().sub(playerRoot.position);
        const dist = toTarget.length();

        if (dist > w.range) continue;

        // Proiezione sul raggio di tiro
        const dot = dir.dot(toTarget.clone().normalize());
        if (dot < 0.95) continue; // angolo troppo ampio

        // Distanza perpendicolare al raggio
        const perpDist = Math.sqrt(dist * dist - (dot * dist) * (dot * dist));
        if (perpDist < HITBOX_RADIUS) {
            // HIT
            socket.emit('reportHit', {
                lobbyId: LOBBY_ID,
                shooterColor: MY_COLOR,
                targetColor: color,
                weaponKey: gameState.myWeapon
            });
            break; // un colpo = un bersaglio max
        }
    }

    if (gameState.myAmmo <= 0) {
        setTimeout(startReload, 300);
    }
}

function getShootDir(spread) {
    const euler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(euler);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    return dir.normalize();
}

// Muzzle flash
let muzzleLight = null;
function playMuzzleFlash() {
    if (!muzzleLight) {
        muzzleLight = new THREE.PointLight(0xffa030, 0, 3);
        camera.add(muzzleLight);
        muzzleLight.position.set(0.08, -0.1, -0.7);
    }
    muzzleLight.intensity = 3;
    setTimeout(() => { if (muzzleLight) muzzleLight.intensity = 0; }, 60);
}

// ══════════════════════════════════════════════════════
//  RELOAD
// ══════════════════════════════════════════════════════
function startReload() {
    if (isReloading || gameState.isDead) return;
    const w = gameState.weapons[gameState.myWeapon];
    if (!w) return;

    isReloading = true;
    const bar = document.getElementById('reload-bar-fill');
    const wrap = document.getElementById('reload-bar-wrap');
    wrap.classList.add('active');
    bar.style.transition = `width ${w.reload}ms linear`;
    bar.style.width = '100%';

    setTimeout(() => {
        gameState.myAmmo = gameState.myMaxAmmo;
        isReloading = false;
        wrap.classList.remove('active');
        bar.style.transition = 'none';
        bar.style.width = '0%';
        updateAmmoHUD();
    }, w.reload);
}

// ══════════════════════════════════════════════════════
//  COLLISION DETECTION (AABB vs capsule giocatore)
// ══════════════════════════════════════════════════════
function resolveCollisions(pos) {
    for (const box of solidBoxes) {
        const closestX = Math.max(box.min.x, Math.min(pos.x, box.max.x));
        const closestY = Math.max(box.min.y, Math.min(pos.y + PLAYER_HEIGHT / 2, box.max.y));
        const closestZ = Math.max(box.min.z, Math.min(pos.z, box.max.z));

        const dx = pos.x - closestX;
        const dy = (pos.y + PLAYER_HEIGHT / 2) - closestY;
        const dz = pos.z - closestZ;
        const dist2 = dx * dx + dy * dy + dz * dz;

        if (dist2 < PLAYER_RADIUS * PLAYER_RADIUS) {
            const dist = Math.sqrt(dist2) || 0.0001;
            const pen = PLAYER_RADIUS - dist;
            pos.x += (dx / dist) * pen;
            pos.z += (dz / dist) * pen;
        }
    }
}

// ══════════════════════════════════════════════════════
//  MOVIMENTO GIOCATORE
// ══════════════════════════════════════════════════════
const _moveDir = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

function updateMovement(dt) {
    if (gameState.isDead || gameState.phase !== 'playing') return;

    // Calcola direzione camera (solo yaw)
    _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    _moveDir.set(0, 0, 0);
    if (keys['KeyW']) _moveDir.addScaledVector(_fwd, 1);
    if (keys['KeyS']) _moveDir.addScaledVector(_fwd, -1);
    if (keys['KeyD']) _moveDir.addScaledVector(_right, 1);
    if (keys['KeyA']) _moveDir.addScaledVector(_right, -1);

    if (_moveDir.lengthSq() > 0) _moveDir.normalize();

    const pos = playerRoot.position;
    pos.x += _moveDir.x * PLAYER_SPEED * dt;
    pos.z += _moveDir.z * PLAYER_SPEED * dt;

    // Gravità
    velocityY -= GRAVITY * dt;
    pos.y += velocityY * dt;

    if (pos.y <= 0) {
        pos.y = 0;
        velocityY = 0;
        onGround = true;
    }

    // Clamp mappa
    pos.x = Math.max(-MAP_HALF + 1, Math.min(MAP_HALF - 1, pos.x));
    pos.z = Math.max(-MAP_HALF + 1, Math.min(MAP_HALF - 1, pos.z));

    resolveCollisions(pos);

    // Rotazione camera
    playerRoot.rotation.y = yaw;
    camera.rotation.x = pitch;

    // Weapon bob
    const speed = _moveDir.lengthSq() > 0 ? 1 : 0;
    const t = Date.now() / 1000;
    weaponGroup.position.x = Math.sin(t * 8) * 0.008 * speed;
    weaponGroup.position.y = Math.abs(Math.sin(t * 8)) * 0.006 * speed;
}

// ══════════════════════════════════════════════════════
//  MINIMAP
// ══════════════════════════════════════════════════════
const minimapCtx = document.getElementById('minimap-canvas').getContext('2d');

function drawMinimap() {
    const ctx = minimapCtx;
    const size = 100;
    const half = MAP_HALF;
    const toMM = (v) => ((v + half) / (half * 2)) * size;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, size, size);

    // Me stesso
    const mx = toMM(playerRoot.position.x);
    const mz = toMM(playerRoot.position.z);
    ctx.fillStyle = '#f1c40f';
    ctx.beginPath();
    ctx.arc(mx, mz, 4, 0, Math.PI * 2);
    ctx.fill();

    // Player direzione
    ctx.strokeStyle = '#f1c40f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx, mz);
    ctx.lineTo(mx + Math.sin(-yaw) * 10, mz + Math.cos(-yaw) * 10);
    ctx.stroke();

    // Giocatori remoti
    for (const [color, rp] of Object.entries(gameState.players)) {
        if (rp.dead) continue;
        const rx = toMM(rp.group.position.x);
        const rz = toMM(rp.group.position.z);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(rx, rz, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ══════════════════════════════════════════════════════
//  HUD HELPERS
// ══════════════════════════════════════════════════════
function updateHpHUD(hp) {
    document.getElementById('hud-hp-val').textContent = Math.max(0, hp);
    const pct = Math.max(0, hp) / 100;
    const bar = document.getElementById('hud-hp-bar');
    bar.style.width = (pct * 100) + '%';
    bar.style.background = pct > 0.5 ? 'var(--col-safe)' : pct > 0.25 ? '#f39c12' : 'var(--col-danger)';
}

function updateAmmoHUD() {
    const el = document.getElementById('hud-ammo-count');
    el.innerHTML = `${gameState.myAmmo}<span> / ${gameState.myMaxAmmo}</span>`;
}

function updateRoundHUD() {
    document.getElementById('hud-round-num').textContent = `${gameState.currentRound} / ${gameState.totalRounds}`;
}

function updateScoreHUD() {
    const el = document.getElementById('hud-scores');
    el.innerHTML = '';
    for (const [color, wins] of Object.entries(gameState.scores)) {
        const row = document.createElement('div');
        row.className = 'hud-score-row';
        row.innerHTML = `
            <div class="hud-score-dot" style="background:${color}"></div>
            <span style="color:${color}">${color === MY_COLOR ? 'YOU' : color.slice(0, 6)}</span>
            <span class="hud-score-wins">${wins}</span>`;
        el.appendChild(row);
    }
}

function addKillfeed(killer, killed) {
    const el = document.getElementById('hud-killfeed');
    const entry = document.createElement('div');
    entry.className = 'killfeed-entry';
    entry.innerHTML = `<span style="color:${killer}">${killer === MY_COLOR ? 'YOU' : '●'}</span> ☠ <span style="color:${killed}">${killed === MY_COLOR ? 'YOU' : '●'}</span>`;
    el.appendChild(entry);
    setTimeout(() => entry.remove(), 4000);
}

function showDamageVignette() {
    const v = document.getElementById('dmg-vignette');
    v.classList.remove('hit');
    void v.offsetWidth; // reflow
    v.classList.add('hit');
}

// ══════════════════════════════════════════════════════
//  SOCKET.IO — connessione + WebRTC signaling
// ══════════════════════════════════════════════════════
const socket = io();
socket.emit('joinFPS', { lobbyId: LOBBY_ID, playerColor: MY_COLOR });

// ── WebRTC peer connections ──────────────────────────
const peers = {};   // socketId -> RTCPeerConnection
const channels = {};   // socketId -> RTCDataChannel

const RTC_CONFIG = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

async function createPeer(targetSocketId, polite) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peers[targetSocketId] = pc;

    if (!polite) {
        const dc = pc.createDataChannel('state');
        setupDataChannel(dc, targetSocketId);
    }

    pc.ondatachannel = (e) => setupDataChannel(e.channel, targetSocketId);

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('rtcIceCandidate', { targetSocketId, candidate: e.candidate });
        }
    };

    pc.onnegotiationneeded = async () => {
        if (!polite) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('rtcOffer', { targetSocketId, sdp: pc.localDescription });
        }
    };

    return pc;
}

function setupDataChannel(dc, fromId) {
    channels[fromId] = dc;
    dc.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            handlePeerData(data);
        } catch { }
    };
}

function handlePeerData(data) {
    if (data.type === 'state' && gameState.players[data.color]) {
        const rp = gameState.players[data.color];
        rp.group.position.set(data.x, data.y, data.z);
        rp.group.rotation.y = data.ry;
    }
}

function broadcastState() {
    const msg = JSON.stringify({
        type: 'state',
        color: MY_COLOR,
        x: playerRoot.position.x,
        y: playerRoot.position.y,
        z: playerRoot.position.z,
        ry: yaw
    });
    for (const dc of Object.values(channels)) {
        if (dc.readyState === 'open') dc.send(msg);
    }
}

// Signaling
socket.on('peerJoined', async ({ color, socketId }) => {
    if (socketId === socket.id) return;
    const pc = await createPeer(socketId, false);
    // Crea offerta
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('rtcOffer', { targetSocketId: socketId, sdp: pc.localDescription });
});

socket.on('existingPeers', async (peerList) => {
    for (const { color, socketId } of peerList) {
        if (socketId === socket.id) continue;
        await createPeer(socketId, true);
    }
});

socket.on('rtcOffer', async ({ fromSocketId, sdp }) => {
    if (!peers[fromSocketId]) await createPeer(fromSocketId, true);
    const pc = peers[fromSocketId];
    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('rtcAnswer', { targetSocketId: fromSocketId, sdp: pc.localDescription });
});

socket.on('rtcAnswer', async ({ fromSocketId, sdp }) => {
    const pc = peers[fromSocketId];
    if (pc) await pc.setRemoteDescription(sdp);
});

socket.on('rtcIceCandidate', async ({ fromSocketId, candidate }) => {
    const pc = peers[fromSocketId];
    if (pc) await pc.addIceCandidate(candidate);
});

// Fallback stato via socket per player remoti
socket.on('playerState', (data) => {
    if (data.color === MY_COLOR) return;
    if (gameState.players[data.color]) {
        const rp = gameState.players[data.color];
        rp.group.position.set(data.x, data.y, data.z);
        rp.group.rotation.y = data.ry;
    }
});

// ── EVENTI DI GIOCO ─────────────────────────────────

socket.on('fpsInit', (data) => {
    gameState.totalRounds = data.totalRounds;
    gameState.currentRound = data.currentRound;
    gameState.scores = data.scores;
    gameState.weapons = data.weapons;
    gameState.hostColor = data.hostColor;
    updateScoreHUD();
    updateRoundHUD();

    if (data.phase === 'weapon_select') showWeaponSelect();
    else if (data.phase === 'playing') handleRoundStart(data);
});

socket.on('phaseWeaponSelect', (data) => {
    gameState.currentRound = data.currentRound;
    gameState.totalRounds = data.totalRounds;
    gameState.scores = data.scores;
    gameState.weapons = data.weapons || gameState.weapons;
    updateScoreHUD();
    updateRoundHUD();
    showWeaponSelect(data.duration);
});

socket.on('weaponChosen', ({ playerColor, weaponKey }) => {
    // Aggiorna dot
});

socket.on('playerConfirmed', ({ playerColor, count, total }) => {
    const dots = document.querySelectorAll('.ws-ready-dot');
    dots.forEach((d, i) => d.classList.toggle('on', i < count));
    document.getElementById('ws-players-ready').querySelector('span') &&
        (document.getElementById('ws-players-ready').querySelector('span').textContent = `${count} / ${total} ready`);
});

socket.on('roundStart', (data) => {
    hideWeaponSelect();
    handleRoundStart(data);
});

socket.on('playerHit', ({ targetColor, hp, shooterColor, damage }) => {
    if (targetColor === MY_COLOR) {
        gameState.myHp = hp;
        updateHpHUD(hp);
        showDamageVignette();
    }
    if (gameState.players[targetColor]) {
        // Aggiorna HP del giocatore remoto (per eventuale healthbar sopra la testa)
        gameState.players[targetColor].hp = hp;
    }
});

socket.on('playerKilled', ({ killedColor, killerColor, aliveCount }) => {
    addKillfeed(killerColor, killedColor);

    if (killedColor === MY_COLOR) {
        gameState.isDead = true;
        document.getElementById('dead-screen').classList.add('active');
        document.exitPointerLock();
        if (weaponGroup) weaponGroup.visible = false;
    }

    if (gameState.players[killedColor]) {
        gameState.players[killedColor].dead = true;
        gameState.players[killedColor].group.visible = false;
    }
});

socket.on('roundEnd', (data) => {
    gameState.scores = data.scores;
    updateScoreHUD();
    showRoundEndOverlay(data);
});

socket.on('gameOver', (data) => {
    showGameOverOverlay(data);
});

socket.on('redirectAllToLobby', () => {
    window.location.href = `/lobby.html?lobby=${LOBBY_ID}&color=${encodeURIComponent(MY_COLOR)}`;
});

socket.on('fpsChat', ({ playerColor, message }) => {
    const wrap = document.getElementById('fps-chat-wrap');
    const div = document.createElement('div');
    div.className = 'fps-chat-msg';
    div.style.borderLeft = `3px solid ${playerColor}`;
    div.style.paddingLeft = '8px';
    div.textContent = message;
    wrap.appendChild(div);
    setTimeout(() => div.remove(), 8000);
});

// ══════════════════════════════════════════════════════
//  GESTIONE FASI UI
// ══════════════════════════════════════════════════════
let wsTimerInterval = null;

function showWeaponSelect(duration = 20000) {
    document.getElementById('weapon-select-screen').classList.add('active');
    document.getElementById('overlay').classList.remove('active');
    document.getElementById('dead-screen').classList.remove('active');
    document.exitPointerLock();

    confirmed = false;
    document.getElementById('ws-confirm-btn').disabled = false;
    document.getElementById('ws-round').textContent =
        `Round ${gameState.currentRound} of ${gameState.totalRounds}`;

    // Timer countdown
    let remaining = Math.ceil(duration / 1000);
    document.getElementById('ws-timer').textContent = `⏱ ${remaining}s`;
    clearInterval(wsTimerInterval);
    wsTimerInterval = setInterval(() => {
        remaining--;
        document.getElementById('ws-timer').textContent = `⏱ ${remaining}s`;
        if (remaining <= 0) clearInterval(wsTimerInterval);
    }, 1000);

    // Rebuild ready dots
    const readyEl = document.getElementById('ws-players-ready');
    const n = Object.keys(gameState.scores).length;
    readyEl.innerHTML = `<span>0 / ${n} ready</span><br>`;
    for (let i = 0; i < n; i++) {
        const dot = document.createElement('div');
        dot.className = 'ws-ready-dot';
        readyEl.appendChild(dot);
    }
}

function hideWeaponSelect() {
    clearInterval(wsTimerInterval);
    document.getElementById('weapon-select-screen').classList.remove('active');
}

function handleRoundStart(data) {
    gameState.phase = 'playing';
    gameState.currentRound = data.round || data.currentRound || gameState.currentRound;
    gameState.isDead = false;

    // Pulisci mesh remote vecchie
    for (const rp of Object.values(gameState.players)) {
        scene.remove(rp.group);
    }
    gameState.players = {};

    // Crea mesh per ogni giocatore remoto
    for (const [color, pState] of Object.entries(data.players)) {
        if (color === MY_COLOR) {
            // Spawn me stesso
            playerRoot.position.set(pState.x, pState.y, pState.z);
            playerRoot.rotation.y = pState.angle || 0;
            yaw = pState.angle || 0;
            pitch = 0;

            const w = (data.weapons || gameState.weapons)[pState.weaponKey];
            gameState.myWeapon = pState.weaponKey;
            gameState.myAmmo = pState.ammo;
            gameState.myMaxAmmo = pState.maxAmmo || (w ? w.ammo : 30);
            gameState.myHp = 100;

            switchWeaponModel(pState.weaponKey);
            document.getElementById('hud-weapon-name').textContent =
                w ? w.name : pState.weaponKey;
            updateAmmoHUD();
            updateHpHUD(100);

        } else {
            const { group } = createPlayerMesh(color);
            group.position.set(pState.x, pState.y, pState.z);
            scene.add(group);
            gameState.players[color] = { group, hp: 100, dead: false };
        }
    }

    updateRoundHUD();
    updateScoreHUD();

    document.getElementById('overlay').classList.remove('active');
    document.getElementById('dead-screen').classList.remove('active');
    if (weaponGroup) weaponGroup.visible = true;

    // Chiedi pointer lock dopo 0.5s
    setTimeout(() => canvas.requestPointerLock(), 500);
}

let overlayCountdownInterval = null;

function showRoundEndOverlay(data) {
    gameState.phase = 'round_end';
    document.exitPointerLock();

    const box = document.getElementById('overlay-box');
    const title = document.getElementById('overlay-title');
    const main = document.getElementById('overlay-main');
    const scoresEl = document.getElementById('overlay-scores');
    const btn = document.getElementById('overlay-btn');
    const cd = document.getElementById('overlay-cd-val');

    title.textContent = `Round ${data.round} of ${data.totalRounds} — Over`;

    if (data.winnerColor) {
        main.textContent = data.winnerColor === MY_COLOR ? '🏆 You Win!' : 'Round Lost';
        main.style.color = data.winnerColor === MY_COLOR ? 'var(--col-accent)' : 'var(--col-danger)';
    } else {
        main.textContent = 'Draw';
        main.style.color = 'var(--col-muted)';
    }

    scoresEl.innerHTML = '';
    for (const [color, wins] of Object.entries(data.scores)) {
        const row = document.createElement('div');
        row.className = 'overlay-score-row' + (color === data.winnerColor ? ' winner' : '');
        row.innerHTML = `
            <div class="overlay-score-color" style="background:${color}"></div>
            <span style="color:${color}">${color === MY_COLOR ? 'YOU' : color.slice(0, 7)}</span>
            <span class="overlay-score-wins">${wins} wins</span>`;
        scoresEl.appendChild(row);
    }

    btn.style.display = 'none';
    document.getElementById('overlay-countdown').style.display = 'block';

    let sec = 5;
    cd.textContent = sec;
    clearInterval(overlayCountdownInterval);
    overlayCountdownInterval = setInterval(() => {
        sec--;
        cd.textContent = sec;
        if (sec <= 0) clearInterval(overlayCountdownInterval);
    }, 1000);

    document.getElementById('overlay').classList.add('active');
}

function showGameOverOverlay(data) {
    gameState.phase = 'game_over';
    document.exitPointerLock();

    document.getElementById('overlay-title').textContent = 'Game Over';
    const main = document.getElementById('overlay-main');

    if (data.champion === MY_COLOR) {
        main.textContent = '🏆 VICTORY!';
        main.style.color = 'var(--col-accent)';
    } else {
        main.textContent = 'Defeated';
        main.style.color = 'var(--col-danger)';
    }

    const scoresEl = document.getElementById('overlay-scores');
    scoresEl.innerHTML = '';
    const sorted = Object.entries(data.scores).sort((a, b) => b[1] - a[1]);
    for (const [color, wins] of sorted) {
        const row = document.createElement('div');
        row.className = 'overlay-score-row' + (color === data.champion ? ' winner' : '');
        row.innerHTML = `
            <div class="overlay-score-color" style="background:${color}"></div>
            <span style="color:${color}">${color === MY_COLOR ? 'YOU' : color.slice(0, 7)}</span>
            <span class="overlay-score-wins">${wins} wins</span>`;
        scoresEl.appendChild(row);
    }

    document.getElementById('overlay-countdown').style.display = 'none';
    clearInterval(overlayCountdownInterval);

    const btn = document.getElementById('overlay-btn');
    if (MY_COLOR === data.hostColor || MY_COLOR === gameState.hostColor) {
        btn.style.display = 'inline-block';
        btn.onclick = () => socket.emit('fpsReturnToLobby', LOBBY_ID);
    } else {
        btn.style.display = 'none';
    }

    document.getElementById('overlay').classList.add('active');
}

// ══════════════════════════════════════════════════════
//  UI — SELEZIONE ARMA
// ══════════════════════════════════════════════════════
document.querySelectorAll('.ws-card').forEach(card => {
    card.addEventListener('click', () => {
        document.querySelectorAll('.ws-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        const wk = card.dataset.weapon;
        gameState.myWeapon = wk;
        socket.emit('chooseWeapon', { lobbyId: LOBBY_ID, playerColor: MY_COLOR, weaponKey: wk });
    });
});

document.getElementById('ws-confirm-btn').addEventListener('click', () => {
    if (confirmed) return;
    confirmed = true;
    document.getElementById('ws-confirm-btn').disabled = true;
    socket.emit('confirmWeapon', { lobbyId: LOBBY_ID, playerColor: MY_COLOR });
});

// ══════════════════════════════════════════════════════
//  RENDER LOOP
// ══════════════════════════════════════════════════════
let lastTime = performance.now();
let stateThrottle = 0;

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    updateMovement(dt);
    drawMinimap();

    // Broadcast stato (throttled a 20fps via WebRTC, fallback socket)
    stateThrottle += dt;
    if (stateThrottle >= 0.05) {
        stateThrottle = 0;
        broadcastState();
        // Fallback socket per chi non ha WebRTC attivo
        socket.emit('playerState', {
            lobbyId: LOBBY_ID,
            color: MY_COLOR,
            x: playerRoot.position.x,
            y: playerRoot.position.y,
            z: playerRoot.position.z,
            ry: yaw
        });
    }

    renderer.render(scene, camera);
}

animate();