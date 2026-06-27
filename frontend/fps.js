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
const STEP_HEIGHT = 0.6;  // altezza max di un gradino salibile automaticamente
const MOUSE_SENS = 0.0015;
const MAP_HALF = 40;      // mezza dimensione mappa (compatta, fedele a Nuketown)

// Hitbox sfera per detection: raggio per ogni player remoto
const HITBOX_RADIUS = 0.55;

// ── Velocità e parametri di sprint / crouch / slide ──
const WALK_SPEED = PLAYER_SPEED;   // 8
const SPRINT_SPEED = 12;
const CROUCH_SPEED = 4;
const STAND_EYE = PLAYER_HEIGHT;   // 1.7 — altezza occhi in piedi
const CROUCH_EYE = 1.0;            // altezza occhi accovacciato
const SLIDE_EYE = 0.8;             // altezza occhi in scivolata
const SLIDE_BOOST = 15;            // velocità iniziale della slide
const SLIDE_FRICTION = 20;         // decelerazione della slide
const SLIDE_MIN_SPEED = 6;         // sotto questa la slide termina
const SLIDE_MAX_TIME = 0.85;       // durata massima slide (s)

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
//  AUDIO PROCEDURALE (Web Audio API — nessun file esterno)
//  Tutti i suoni sono sintetizzati a runtime: spari (diversi
//  per arma), hit-confirm, kill, ricarica, passi, danno, morte.
// ══════════════════════════════════════════════════════
const Sfx = (() => {
    let ctx = null;
    let master = null;
    let noiseBuffer = null;

    function ensure() {
        if (ctx) return;
        try {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch { return; }
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
        // Buffer di rumore bianco riutilizzabile (1s)
        const len = ctx.sampleRate;
        noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }

    // Sblocca/riprende il contesto: va chiamato su un gesto utente
    function resume() {
        ensure();
        if (ctx && ctx.state === 'suspended') ctx.resume();
    }

    // Burst di rumore filtrato (corpo dello sparo, click meccanici, passi)
    function noise(dur, { type = 'lowpass', freq = 1000, q = 1, gain = 1, attack = 0.001 } = {}) {
        if (!ctx) return;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        const filt = ctx.createBiquadFilter();
        filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
        const g = ctx.createGain();
        const t = ctx.currentTime;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(filt); filt.connect(g); g.connect(master);
        src.start(t); src.stop(t + dur + 0.02);
    }

    // Tono con inviluppo (thump basso, crack, bip UI)
    function tone(freq, dur, { type = 'sine', gain = 0.3, attack = 0.002, freqEnd = null, delay = 0 } = {}) {
        if (!ctx) return;
        const osc = ctx.createOscillator();
        osc.type = type;
        const g = ctx.createGain();
        const t = ctx.currentTime + delay;
        osc.frequency.setValueAtTime(freq, t);
        if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g); g.connect(master);
        osc.start(t); osc.stop(t + dur + 0.02);
    }

    function click(gain = 0.4) { noise(0.04, { type: 'highpass', freq: 2200, gain }); }

    // ── Spari (timbro diverso per arma) ──
    function shoot(weaponKey) {
        ensure(); if (!ctx) return;
        switch (weaponKey) {
            case 'smg':
                noise(0.09, { type: 'bandpass', freq: 1900, q: 0.7, gain: 0.45 });
                tone(180, 0.07, { type: 'triangle', gain: 0.32, freqEnd: 60 });
                break;
            case 'shotgun':
                noise(0.34, { type: 'lowpass', freq: 900, gain: 0.85 });
                tone(110, 0.26, { type: 'sawtooth', gain: 0.45, freqEnd: 40 });
                break;
            case 'sniper':
                noise(0.42, { type: 'lowpass', freq: 1700, gain: 0.85 });
                tone(140, 0.38, { type: 'sawtooth', gain: 0.5, freqEnd: 45 });
                tone(900, 0.05, { type: 'square', gain: 0.22, freqEnd: 200 }); // crack
                break;
            default: // assault
                noise(0.15, { type: 'bandpass', freq: 1500, q: 0.6, gain: 0.55 });
                tone(160, 0.11, { type: 'triangle', gain: 0.38, freqEnd: 50 });
        }
    }

    function hitConfirm() {
        tone(1200, 0.05, { type: 'square', gain: 0.16 });
        tone(1600, 0.04, { type: 'square', gain: 0.12, delay: 0.03 });
    }

    function killConfirm() {
        tone(800, 0.07, { type: 'square', gain: 0.18 });
        tone(1200, 0.09, { type: 'square', gain: 0.18, delay: 0.06 });
        tone(1700, 0.12, { type: 'square', gain: 0.16, delay: 0.13 });
    }

    // Ricarica: click "magazine out" subito + "magazine in"/carrello verso la fine
    function reload(duration) {
        ensure(); if (!ctx) return;
        const ms = Math.max(200, duration || 1500);
        click(0.32);
        setTimeout(() => click(0.4), ms * 0.55);
        setTimeout(() => click(0.5), ms * 0.92);
    }

    function footstep() { noise(0.07, { type: 'lowpass', freq: 320, gain: 0.16 }); }
    function slide() { noise(0.45, { type: 'lowpass', freq: 600, gain: 0.22, attack: 0.05 }); }
    function empty() { click(0.22); }
    function hurt() {
        tone(220, 0.18, { type: 'sawtooth', gain: 0.22, freqEnd: 90 });
        noise(0.12, { type: 'lowpass', freq: 600, gain: 0.18 });
    }
    function death() {
        tone(300, 0.7, { type: 'sawtooth', gain: 0.32, freqEnd: 60 });
        noise(0.5, { type: 'lowpass', freq: 500, gain: 0.22 });
    }
    function roundStart() {
        tone(440, 0.12, { type: 'square', gain: 0.18 });
        tone(660, 0.16, { type: 'square', gain: 0.2, delay: 0.13 });
    }

    return { resume, shoot, hitConfirm, killConfirm, reload, footstep, slide, empty, hurt, death, roundStart };
})();

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
scene.fog = new THREE.FogExp2(0x87ceeb, 0.008);

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
    ground: new THREE.MeshLambertMaterial({ color: 0x6b7c3a }),   // prato
    concrete: new THREE.MeshLambertMaterial({ color: 0x8a8a82 }),   // cemento
    asphalt: new THREE.MeshLambertMaterial({ color: 0x2c2c32 }),   // strada
    sidewalk: new THREE.MeshLambertMaterial({ color: 0x9a9a90 }),   // marciapiede
    wall: new THREE.MeshLambertMaterial({ color: 0x5c5040 }),   // muro perimetro
    crate: new THREE.MeshLambertMaterial({ color: 0x9c7424 }),   // cassa legno
    crateDark: new THREE.MeshLambertMaterial({ color: 0x6c4a14 }),
    metal: new THREE.MeshLambertMaterial({ color: 0x4a5568 }),
    // Case (Nuketown style)
    houseYellow: new THREE.MeshLambertMaterial({ color: 0xd9b44a }),   // casa gialla
    houseTeal: new THREE.MeshLambertMaterial({ color: 0x3a8f7e }),   // casa verde-acqua
    roof: new THREE.MeshLambertMaterial({ color: 0x5a3825 }),   // tetto
    trim: new THREE.MeshLambertMaterial({ color: 0xe8e4d8 }),   // cornici bianche
    woodFloor: new THREE.MeshLambertMaterial({ color: 0x8a6a40 }),   // pavimento interno
    fence: new THREE.MeshLambertMaterial({ color: 0xe8e4d8 }),   // staccionata bianca
    // Veicoli
    busYellow: new THREE.MeshLambertMaterial({ color: 0xf2c41d }),
    vanRed: new THREE.MeshLambertMaterial({ color: 0xb0432f }),
    tire: new THREE.MeshLambertMaterial({ color: 0x141414 }),
    glass: new THREE.MeshLambertMaterial({ color: 0x9ec7d6, transparent: true, opacity: 0.45 }),
    mannequin: new THREE.MeshLambertMaterial({ color: 0xc9a98a }),
    sky: new THREE.MeshLambertMaterial({ color: 0x87ceeb, side: THREE.BackSide }),
};
// Materiali di dettaglio (props mappa)
MAT.chrome    = new THREE.MeshLambertMaterial({ color: 0xb9c0c8 });
MAT.hubcap    = new THREE.MeshLambertMaterial({ color: 0x70757c });
MAT.headlight = new THREE.MeshLambertMaterial({ color: 0xfff2b0 });
MAT.taillight = new THREE.MeshLambertMaterial({ color: 0xaa2a1e });
MAT.bark      = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
MAT.leaf      = new THREE.MeshLambertMaterial({ color: 0x2d5a27 });
MAT.leafDark  = new THREE.MeshLambertMaterial({ color: 0x244a1f });
MAT.couch     = new THREE.MeshLambertMaterial({ color: 0x5a6e88 });  // tessuto divano

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

// Cilindro visivo (ruote, tronchi, arti). axis: 'y' (default), 'x' o 'z'.
function makeCyl(rTop, rBot, h, mat, x, y, z, axis = 'y', radial = 16) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, radial), mat);
    m.position.set(x, y, z);
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    else if (axis === 'z') m.rotation.x = Math.PI / 2;
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

// ── Cassa di legno dettagliata (assi/battute) — collisione identica ad addSolid ──
function crate(w, h, d, x, y, z, dark = false) {
    const base = dark ? MAT.crateDark : MAT.crate;
    const edge = dark ? MAT.crate : MAT.crateDark;
    const mesh = addSolid(w, h, d, x, y, z, base);
    const t = 0.07;
    // Montanti agli angoli
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            makeBox(t * 2, h, t * 2, edge, x + sx * (w / 2 - t), y + h / 2, z + sz * (d / 2 - t));
        }
    }
    // Bande orizzontali alta/bassa
    makeBox(w + 0.02, t * 2, d + 0.02, edge, x, y + h - t, z);
    makeBox(w + 0.02, t * 2, d + 0.02, edge, x, y + t, z);
    return mesh;
}

// ── Barriera New Jersey in cemento (riparo basso, da accovacciati) ──
function buildBarrier(x, z, rotY = 0) {
    const L = 2.2, H = 1.0, W = 0.7;
    const g = new THREE.Group();
    // Profilo trapezoidale approssimato con due box sovrapposti
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(L, 0.45, W), MAT.concrete);
    b1.position.set(0, 0.225, 0);
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(L, 0.55, W * 0.5), MAT.concrete);
    b2.position.set(0, 0.45 + 0.275, 0);
    [b1, b2].forEach(m => { m.castShadow = true; m.receiveShadow = true; g.add(m); });
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    scene.add(g);
    // AABB di collisione orientata sugli assi (approssima l'ingombro ruotato)
    const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
    const hx = (L * c + W * s) / 2, hz = (L * s + W * c) / 2;
    solidBoxes.push({
        min: new THREE.Vector3(x - hx, 0, z - hz),
        max: new THREE.Vector3(x + hx, H, z + hz)
    });
}

// ── Pila di sacchi di sabbia (riparo basso) ──
function buildSandbags(x, z, len = 2.4, rotY = 0) {
    const H = 0.95, W = 0.7;
    const g = new THREE.Group();
    const matA = new THREE.MeshLambertMaterial({ color: 0x9a8a5c });
    const matB = new THREE.MeshLambertMaterial({ color: 0x847552 });
    const rows = 3, perRow = Math.max(2, Math.round(len / 0.6));
    for (let r = 0; r < rows; r++) {
        const off = (r % 2) * 0.28;
        for (let i = 0; i < perRow; i++) {
            const bx = -len / 2 + 0.3 + i * (len / perRow) + off * 0;
            const bag = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), (i + r) % 2 ? matA : matB);
            bag.scale.set(1.0, 0.6, 0.85);
            bag.position.set(bx, 0.18 + r * 0.3, (r % 2 ? 0.08 : -0.08));
            bag.castShadow = true;
            g.add(bag);
        }
    }
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    scene.add(g);
    const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
    const hx = (len * c + W * s) / 2, hz = (len * s + W * c) / 2;
    solidBoxes.push({
        min: new THREE.Vector3(x - hx, 0, z - hz),
        max: new THREE.Vector3(x + hx, H, z + hz)
    });
}

// ── Barile metallico (riparo stretto e alto) ──
function buildBarrel(x, z, color = 0x3a6b3a) {
    const r = 0.36, H = 1.1;
    const mat = new THREE.MeshLambertMaterial({ color });
    makeCyl(r, r, H, mat, x, H / 2, z, 'y', 14);
    // Cerchiature
    makeCyl(r + 0.02, r + 0.02, 0.06, MAT.crateDark, x, H * 0.28, z, 'y', 14);
    makeCyl(r + 0.02, r + 0.02, 0.06, MAT.crateDark, x, H * 0.72, z, 'y', 14);
    solidBoxes.push({
        min: new THREE.Vector3(x - r, 0, z - r),
        max: new THREE.Vector3(x + r, H, z + r)
    });
}

// ══════════════════════════════════════════════════════
//  MAPPA — "NUKETOWN" HOMAGE
//  Due case suburbane simmetriche separate da una strada
//  centrale con veicoli di copertura, cortili recintati e
//  manichini da test nucleare.
// ══════════════════════════════════════════════════════
function buildMap() {

    // ── Terreno (prato) ──
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2), MAT.ground
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ── Strada centrale (asfalto, est-ovest) ──
    const road = new THREE.Mesh(new THREE.PlaneGeometry(MAP_HALF * 2, 12), MAT.asphalt);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.02;
    road.receiveShadow = true;
    scene.add(road);
    // Linea di mezzeria tratteggiata
    for (let x = -36; x <= 36; x += 8) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.4), MAT.trim);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(x, 0.03, 0);
        scene.add(dash);
    }
    // Marciapiedi
    [-7, 7].forEach(z => {
        const sw = new THREE.Mesh(new THREE.PlaneGeometry(MAP_HALF * 2, 2), MAT.sidewalk);
        sw.rotation.x = -Math.PI / 2;
        sw.position.set(0, 0.025, z);
        scene.add(sw);
    });

    // ── Vialetti di accesso (cemento) ──
    [-32, 32].forEach(hz => {
        const sign = hz < 0 ? 1 : -1;
        const drive = new THREE.Mesh(new THREE.PlaneGeometry(6, 20), MAT.concrete);
        drive.rotation.x = -Math.PI / 2;
        drive.position.set(0, 0.015, hz + sign * 13);
        drive.receiveShadow = true;
        scene.add(drive);
    });

    // ── Due case che si fronteggiano ──
    buildHouse(0, -32, +1, MAT.houseYellow);   // casa gialla (nord, porta verso +Z)
    buildHouse(0, 32, -1, MAT.houseTeal);      // casa verde-acqua (sud, porta verso -Z)

    // ── Veicoli sulla strada (copertura centrale) ──
    buildBus(-16, -1);
    buildVan(17, 2);

    // ── Staccionate dei cortili (apertura per il vialetto) ──
    fenceX(-24, -3, -7); fenceX(3, 24, -7);   // fronte nord
    fenceZ(-7, -25, -24); fenceZ(-7, -25, 24); // lati nord
    fenceX(-24, -3, 7); fenceX(3, 24, 7);      // fronte sud
    fenceZ(7, 25, -24); fenceZ(7, 25, 24);     // lati sud

    // ── Copertura nei cortili (casse basse, scalabili in un passo) ──
    crate(1.8, 0.6, 1.8, -14, 0, -16);
    crate(1.8, 0.6, 1.8, 15, 0, 16);
    crate(2.6, 0.6, 1.2, 14, 0, -18);
    crate(2.6, 0.6, 1.2, -14, 0, 18);
    // Casse impilate (gradini per salire più in alto)
    crate(1.6, 0.6, 1.6, -18.6, 0, -12);
    crate(1.6, 1.2, 1.6, -20.0, 0, -12, true);
    crate(1.6, 0.6, 1.6, 18.6, 0, 12);
    crate(1.6, 1.2, 1.6, 20.0, 0, 12, true);

    // ── Tettoie/garage aperti accanto alle case (riparo) ──
    buildCarport(-26, -32);
    buildCarport(26, 32);

    // ── Cabine/outhouse (copertura alta e stretta) ──
    addSolid(1.4, 2.2, 1.4, 26, 0, -10, MAT.metal);
    addSolid(1.4, 2.2, 1.4, -26, 0, 10, MAT.metal);

    // ── Barriere/fioriere basse sulla strada ──
    addSolid(3.0, 0.6, 1.0, 2, 0, -3, MAT.concrete);
    addSolid(3.0, 0.6, 1.0, -3, 0, 3, MAT.concrete);
    addSolid(1.0, 0.6, 3.0, 8, 0, 0, MAT.concrete);

    // ── Manichini da test (atmosfera Nuketown) ──
    buildMannequin(-8, -9, 0.4);
    buildMannequin(9, 9, 3.4);
    buildMannequin(-20, 4, 1.2);
    buildMannequin(21, -5, -1.0);

    // ── Ripari aggiuntivi nello spazio centrale (poca copertura prima) ──
    buildBarrier(-6, -3.5, 0.25);
    buildBarrier(6, 4, -0.25);
    buildSandbags(-5, 6, 2.2, 0.15);
    buildSandbags(5, -6, 2.2, -0.15);
    buildBarrel(-9, 4);
    buildBarrel(10, -4);
    buildBarrel(-1, -6);
    buildBarrel(1, 6);
    // Ripari nei cortili
    buildBarrier(-12, -19, Math.PI / 2);
    buildBarrier(12, 19, Math.PI / 2);
    buildBarrel(22, -20, 0xb0432f);
    buildBarrel(-22, 20, 0xb0432f);

    // ── Cespugli / alberi agli angoli (dentro il perimetro compatto) ──
    addTree(-37, 0, -37); addTree(37, 0, 37);
    addTree(-37, 0, 37); addTree(37, 0, -37);

    // ── Confini mappa (muri perimetrali) ──
    addSolid(MAP_HALF * 2, 8, 1, 0, 0, -MAP_HALF, MAT.wall);
    addSolid(MAP_HALF * 2, 8, 1, 0, 0, MAP_HALF, MAT.wall);
    addSolid(1, 8, MAP_HALF * 2, MAP_HALF, 0, 0, MAT.wall);
    addSolid(1, 8, MAP_HALF * 2, -MAP_HALF, 0, 0, MAT.wall);

    // ── Skybox ──
    const sky = new THREE.Mesh(new THREE.BoxGeometry(500, 500, 500), MAT.sky);
    scene.add(sky);
}

// ── Casa Nuketown a DUE PIANI (enterable, scala interna, finestre) ──
function buildHouse(cx, cz, doorDir, wallMat) {
    const W = 14, D = 12, t = 0.3;
    const hw = W / 2, hd = D / 2;
    const F2 = 2.8;          // quota calpestabile del secondo piano
    const ROOF = 5.6;
    const wallH1 = F2;       // altezza muri piano terra
    const wallH2 = ROOF - F2; // altezza muri secondo piano
    const doorW = 2.4, doorH = 2.2;
    const fz = cz + doorDir * hd;   // parete frontale (verso il centro)
    const bz = cz - doorDir * hd;   // parete posteriore
    const floorMat = MAT.woodFloor;

    // ── Fondamenta + pavimento piano terra ──
    makeBox(W + 0.6, 0.4, D + 0.6, MAT.concrete, cx, -0.1, cz);
    makeBox(W, 0.2, D, floorMat, cx, 0.1, cz);

    // Parete laterale con finestra (base y0, altezza h)
    function sideWall(wx, y0, h) {
        const winLen = 2.6, winH = 1.4, sill = y0 + (h - winH) / 2;
        const segLen = (D - winLen) / 2;
        addSolid(t, h, segLen, wx, y0, cz - (winLen / 2 + segLen / 2), wallMat);
        addSolid(t, h, segLen, wx, y0, cz + (winLen / 2 + segLen / 2), wallMat);
        addSolid(t, sill - y0, winLen, wx, y0, cz, wallMat);
        addSolid(t, (y0 + h) - (sill + winH), winLen, wx, sill + winH, cz, wallMat);
        makeBox(t * 0.6, winH, winLen, MAT.glass, wx, sill + winH / 2, cz);
    }

    // Parete frontale con apertura (porta o finestra) centrata.
    // openBottom..openTop = estensione verticale del buco.
    function frontWall(y0, h, openW, openBottom, openTop) {
        const seg = (W - openW) / 2;
        addSolid(seg, h, t, cx - (openW / 2 + seg / 2), y0, fz, wallMat);
        addSolid(seg, h, t, cx + (openW / 2 + seg / 2), y0, fz, wallMat);
        if (openBottom > y0 + 0.01) addSolid(openW, openBottom - y0, t, cx, y0, fz, wallMat);
        if (openTop < y0 + h - 0.01) addSolid(openW, (y0 + h) - openTop, t, cx, openTop, fz, wallMat);
    }

    // ── PIANO TERRA ──
    addSolid(W, wallH1, t, cx, 0, bz, wallMat);     // posteriore
    sideWall(cx - hw, 0, wallH1);
    sideWall(cx + hw, 0, wallH1);
    frontWall(0, wallH1, doorW, 0, doorH);          // porta (buco dal pavimento)
    // Stipiti porta
    makeBox(0.25, doorH + 0.2, 0.36, MAT.trim, cx - doorW / 2, doorH / 2, fz);
    makeBox(0.25, doorH + 0.2, 0.36, MAT.trim, cx + doorW / 2, doorH / 2, fz);
    makeBox(doorW + 0.5, 0.3, 0.36, MAT.trim, cx, doorH + 0.15, fz);
    // Gradino d'ingresso
    addSolid(doorW + 1, 0.3, 1.0, cx, 0, fz + doorDir * 0.8, MAT.concrete);

    // ── SOLAIO 2° piano con vano scala nell'angolo (minX, minZ) ──
    const holeW = 3.4, holeD = 4.4;
    const slabBase = F2 - 0.2;
    // Rettangolo A (a destra del vano)
    const aw = W - holeW;
    addSolid(aw, 0.2, D, cx - hw + holeW + aw / 2, slabBase, cz, floorMat);
    // Rettangolo B (colonna sinistra, davanti al vano)
    const bd = D - holeD;
    addSolid(holeW, 0.2, bd, cx - hw + holeW / 2, slabBase, cz - hd + holeD + bd / 2, floorMat);

    // ── SCALA interna nel vano (gradini bassi → step-up automatico) ──
    const nSteps = 7;
    const stepH = F2 / nSteps;          // ~0.4 (< STEP_HEIGHT)
    const stepDepth = holeD / nSteps;
    const stairX = cx - hw + holeW / 2;
    for (let i = 0; i < nSteps; i++) {
        const top = (i + 1) * stepH;
        const zc = (cz - hd) + (i + 0.5) * stepDepth;
        addSolid(holeW - 0.6, top, stepDepth + 0.02, stairX, 0, zc, MAT.concrete);
    }

    // ── SECONDO PIANO ──
    addSolid(W, wallH2, t, cx, F2, bz, wallMat);    // posteriore
    sideWall(cx - hw, F2, wallH2);
    sideWall(cx + hw, F2, wallH2);
    // Grande finestra/balcone frontale verso la strada
    frontWall(F2, wallH2, 5.0, F2 + 0.4, F2 + 2.0);
    makeBox(5.2, 0.25, 0.4, MAT.trim, cx, F2 + 0.4, fz + doorDir * 0.08); // parapetto

    // ── TETTO + colmo ──
    addSolid(W + 1, 0.3, D + 1, cx, ROOF, cz, MAT.roof);
    makeBox(W + 1, 0.6, 2.6, MAT.roof, cx, ROOF + 0.45, cz);

    // ── Copertura interna piano terra (bassa, scalabile) ──
    addSolid(1.6, 0.6, 1.6, cx + (hw - 2.6), 0, cz + doorDir * 1.5, MAT.crate);

    // ── Arredamento minimal (solo visivo, nessuna collisione) ──
    buildHouseFurniture(cx, cz, doorDir, F2);
}

// Arredamento minimal: divano, tavolino+TV, tavolo da pranzo (piano terra);
// letto + comodino (secondo piano). Tutto visivo, evita il vano scala.
function buildHouseFurniture(cx, cz, doorDir, F2) {
    const wood = MAT.woodFloor, dark = MAT.crateDark, fab = MAT.couch, white = MAT.trim;
    const back = cz - doorDir * 6;     // parete posteriore
    const dd = doorDir;

    // ── PIANO TERRA ──
    // Divano contro la parete posteriore (lato destro, lontano dalle scale)
    makeBox(2.4, 0.45, 0.95, fab, cx + 3, 0.33, back + dd * 0.7);
    makeBox(2.4, 0.55, 0.25, fab, cx + 3, 0.62, back + dd * 0.25);   // schienale
    makeBox(0.25, 0.5, 0.95, fab, cx + 3 - 1.2, 0.45, back + dd * 0.7); // bracciolo
    makeBox(0.25, 0.5, 0.95, fab, cx + 3 + 1.2, 0.45, back + dd * 0.7);
    // Tavolino basso davanti al divano
    makeBox(1.3, 0.45, 0.7, wood, cx + 3, 0.22, back + dd * 2.4);
    // Mobile TV + televisore (di fronte al divano)
    makeBox(1.7, 0.5, 0.4, dark, cx + 3, 0.25, back + dd * 4.4);
    makeBox(1.3, 0.8, 0.08, dark, cx + 3, 1.15, back + dd * 4.6);
    // Tavolo da pranzo (lato sinistro-fronte, libero dal vano scala)
    makeBox(1.6, 0.08, 1.0, wood, cx - 3.2, 0.85, cz + dd * 2.6);
    makeBox(0.3, 0.85, 0.3, dark, cx - 3.2, 0.42, cz + dd * 2.6);    // gamba centrale
    makeBox(0.45, 0.5, 0.45, wood, cx - 3.2, 0.25, cz + dd * 1.6);   // sedia
    makeBox(0.45, 0.5, 0.45, wood, cx - 3.2, 0.25, cz + dd * 3.6);   // sedia

    // ── SECONDO PIANO (slab a F2) ──
    const f = F2;
    makeBox(2.0, 0.3, 1.5, wood, cx + 3.5, f + 0.15, cz + 1.8);      // struttura letto
    makeBox(1.9, 0.25, 1.4, white, cx + 3.5, f + 0.42, cz + 1.8);    // materasso
    makeBox(0.8, 0.18, 1.2, white, cx + 2.9, f + 0.6, cz + 1.8);     // cuscino
    makeBox(0.2, 0.7, 1.5, dark, cx + 2.45, f + 0.35, cz + 1.8);     // testiera
    makeBox(0.5, 0.5, 0.5, wood, cx + 2.2, f + 0.25, cz + 0.7);      // comodino
}

// ── Ruota a cilindro con cerchione (asse lungo Z, asse di rotolamento X) ──
function addWheel(x, z, cz, radius = 0.55, width = 0.34) {
    const off = Math.sign(z - cz) * (width / 2 - 0.02);
    const wz = z + off;
    makeCyl(radius, radius, width, MAT.tire, x, radius, wz, 'z', 18);
    makeCyl(radius * 0.42, radius * 0.42, width + 0.03, MAT.hubcap, x, radius, wz, 'z', 12);
}

// ── Bus = mini-rifugio percorribile (pareti solide + porta verso la strada) ──
function buildBus(cx, cz) {
    const L = 11, Wd = 3.4, H = 2.4, t = 0.22;
    const hl = L / 2, hw = Wd / 2, doorW = 2.6;
    const M = MAT.busYellow;

    // Musi (pareti corte, +X e -X)
    addSolid(t, H, Wd, cx + hl - t / 2, 0, cz, M);
    addSolid(t, H, Wd, cx - hl + t / 2, 0, cz, M);
    // Lato pieno (-Z)
    addSolid(L, H, t, cx, 0, cz - hw + t / 2, M);
    // Lato con PORTA (+Z, verso la strada): due segmenti con varco centrale percorribile
    const seg = (L - doorW) / 2;
    addSolid(seg, H, t, cx - (doorW / 2 + seg / 2), 0, cz + hw - t / 2, M);
    addSolid(seg, H, t, cx + (doorW / 2 + seg / 2), 0, cz + hw - t / 2, M);
    makeBox(doorW, 0.4, t, M, cx, H - 0.2, cz + hw - t / 2);   // architrave (sopra la testa)
    // Tetto solido → struttura chiusa (ripara anche dall'alto)
    addSolid(L + 0.2, 0.16, Wd + 0.2, cx, H, cz, M);
    makeBox(L - 0.2, 0.1, Wd + 0.1, MAT.crateDark, cx, H + 0.2, cz);   // bordo tetto

    // Dettagli (decorativi)
    makeBox(L + 0.04, 0.12, Wd + 0.04, MAT.crateDark, cx, 0.55, cz);              // modanatura
    makeBox(L - 1.0, 0.7, 0.03, MAT.glass, cx, 1.6, cz - hw - 0.02);              // finestrini -Z
    makeBox(seg - 0.4, 0.7, 0.03, MAT.glass, cx - (doorW / 2 + seg / 2), 1.6, cz + hw + 0.02);
    makeBox(seg - 0.4, 0.7, 0.03, MAT.glass, cx + (doorW / 2 + seg / 2), 1.6, cz + hw + 0.02);
    makeBox(0.22, 0.42, Wd + 0.16, MAT.chrome, cx + hl + 0.06, 0.4, cz);          // paraurti ant
    makeBox(0.22, 0.42, Wd + 0.16, MAT.chrome, cx - hl - 0.06, 0.4, cz);          // paraurti post
    makeBox(0.1, 0.22, 0.22, MAT.headlight, cx + hl + 0.04, 0.75, cz - Wd / 3);
    makeBox(0.1, 0.22, 0.22, MAT.headlight, cx + hl + 0.04, 0.75, cz + Wd / 3);
    makeBox(0.08, 0.18, 0.18, MAT.taillight, cx - hl - 0.03, 0.75, cz - Wd / 3);
    makeBox(0.08, 0.18, 0.18, MAT.taillight, cx - hl - 0.03, 0.75, cz + Wd / 3);
    // Ruote
    for (const wx of [cx - hl + 1.9, cx + hl - 1.9]) {
        addWheel(wx, cz - hw, cz, 0.6);
        addWheel(wx, cz + hw, cz, 0.6);
    }
}

// ── Furgone (copertura centrale) ──
function buildVan(cx, cz) {
    const L = 6, Wd = 2.4, H = 2.2, lift = 0.5;
    addSolid(L, H, Wd, cx, lift, cz, MAT.vanRed);                            // cassone (collisione)
    makeBox(L + 0.06, 0.18, Wd + 0.04, MAT.vanRed, cx, lift + H, cz);        // tetto cassone
    makeBox(2.2, 1.5, Wd - 0.05, MAT.vanRed, cx + L / 2 - 0.5, lift, cz);    // cabina
    makeBox(1.6, 0.7, Wd + 0.05, MAT.glass, cx + L / 2 - 0.4, lift + 1.05, cz); // parabrezza
    makeBox(0.05, 0.7, Wd - 0.1, MAT.glass, cx + L / 2 + 0.02, lift + 1.0, cz); // finestrino frontale
    makeBox(L - 1.4, 0.55, Wd + 0.06, MAT.glass, cx - 0.6, lift + H - 0.45, cz); // finestrini laterali
    makeBox(L + 0.06, 0.12, Wd + 0.08, MAT.crateDark, cx, lift + 0.5, cz);   // modanatura
    // Paraurti + sottoscocca
    makeBox(L + 0.06, 0.35, Wd + 0.04, MAT.crateDark, cx, lift - 0.12, cz);
    makeBox(0.22, 0.4, Wd + 0.16, MAT.chrome, cx + L / 2 + 0.06, lift - 0.05, cz);  // ant
    makeBox(0.22, 0.4, Wd + 0.16, MAT.chrome, cx - L / 2 - 0.06, lift - 0.05, cz);  // post
    // Fari / stop
    makeBox(0.1, 0.2, 0.2, MAT.headlight, cx + L / 2 + 0.04, lift + 0.45, cz - Wd / 3);
    makeBox(0.1, 0.2, 0.2, MAT.headlight, cx + L / 2 + 0.04, lift + 0.45, cz + Wd / 3);
    makeBox(0.07, 0.3, 0.18, MAT.taillight, cx - L / 2 - 0.03, lift + 0.7, cz - Wd / 2 + 0.2);
    makeBox(0.07, 0.3, 0.18, MAT.taillight, cx - L / 2 - 0.03, lift + 0.7, cz + Wd / 2 - 0.2);
    // Specchietti
    makeBox(0.08, 0.18, 0.1, MAT.crateDark, cx + L / 2 - 0.2, lift + 1.35, cz - Wd / 2 - 0.14);
    makeBox(0.08, 0.18, 0.1, MAT.crateDark, cx + L / 2 - 0.2, lift + 1.35, cz + Wd / 2 + 0.14);
    // Ruote
    for (const wx of [cx - L / 2 + 1.3, cx + L / 2 - 1.3]) {
        addWheel(wx, cz - Wd / 2, cz, 0.52);
        addWheel(wx, cz + Wd / 2, cz, 0.52);
    }
}

// ── Tettoia/garage aperto (4 pali + tetto, riparo dall'alto) ──
function buildCarport(cx, cz) {
    const W = 6.5, D = 5.5, H = 2.6, t = 0.25;
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            addSolid(t, H, t, cx + sx * (W / 2 - 0.2), 0, cz + sz * (D / 2 - 0.2), MAT.metal);
        }
    }
    addSolid(W, 0.2, D, cx, H, cz, MAT.roof);   // tetto piano
}

// ── Staccionata bianca lungo X ──
function fenceX(xStart, xEnd, z) {
    const H = 1.0;
    const lo = Math.min(xStart, xEnd), hi = Math.max(xStart, xEnd);
    const len = hi - lo, cx = (lo + hi) / 2;
    solidBoxes.push({
        min: new THREE.Vector3(lo, 0, z - 0.1),
        max: new THREE.Vector3(hi, H, z + 0.1)
    });
    makeBox(len, 0.07, 0.05, MAT.fence, cx, 0.35, z);
    makeBox(len, 0.07, 0.05, MAT.fence, cx, 0.8, z);
    const n = Math.max(1, Math.round(len / 0.5));
    for (let i = 0; i <= n; i++) {
        makeBox(0.09, H, 0.05, MAT.fence, lo + len * (i / n), H / 2, z);
    }
}

// ── Staccionata bianca lungo Z ──
function fenceZ(zStart, zEnd, x) {
    const H = 1.0;
    const lo = Math.min(zStart, zEnd), hi = Math.max(zStart, zEnd);
    const len = hi - lo, cz = (lo + hi) / 2;
    solidBoxes.push({
        min: new THREE.Vector3(x - 0.1, 0, lo),
        max: new THREE.Vector3(x + 0.1, H, hi)
    });
    makeBox(0.05, 0.07, len, MAT.fence, x, 0.35, cz);
    makeBox(0.05, 0.07, len, MAT.fence, x, 0.8, cz);
    const n = Math.max(1, Math.round(len / 0.5));
    for (let i = 0; i <= n; i++) {
        makeBox(0.05, H, 0.09, MAT.fence, x, H / 2, lo + len * (i / n));
    }
}

// ── Manichino da test (decorativo, senza collisione) ──
function buildMannequin(x, z, ry) {
    const g = new THREE.Group();
    const cyl = (rt, rb, h, bx, by, bz, rot) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 10), MAT.mannequin);
        m.position.set(bx, by, bz);
        if (rot) m.rotation.z = rot;
        m.castShadow = true;
        g.add(m);
    };
    const sph = (r, bx, by, bz) => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), MAT.mannequin);
        m.position.set(bx, by, bz);
        m.castShadow = true;
        g.add(m);
    };
    cyl(0.1, 0.09, 0.75, -0.11, 0.4, 0); cyl(0.1, 0.09, 0.75, 0.11, 0.4, 0); // gambe
    cyl(0.22, 0.15, 0.7, 0, 1.05, 0);                                          // busto conico
    cyl(0.06, 0.06, 0.52, 0, 1.4, 0, Math.PI / 2);                            // spalle
    cyl(0.07, 0.06, 0.55, -0.28, 1.12, 0); cyl(0.07, 0.06, 0.55, 0.28, 1.12, 0); // braccia
    cyl(0.05, 0.05, 0.12, 0, 1.49, 0);                                        // collo
    sph(0.16, 0, 1.63, 0);                                                     // testa
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    scene.add(g);
}

function addTree(x, y, z) {
    // Tronco (conico, più segmenti)
    makeCyl(0.26, 0.42, 3.2, MAT.bark, x, y + 1.6, z, 'y', 10);
    // Chioma: più sfere sovrapposte di tonalità diverse → più piena e tonda
    const blobs = [
        { r: 2.3, dx: 0, dy: 4.2, dz: 0, m: MAT.leaf },
        { r: 1.7, dx: 1.4, dy: 3.7, dz: 0.5, m: MAT.leafDark },
        { r: 1.7, dx: -1.3, dy: 3.9, dz: -0.6, m: MAT.leafDark },
        { r: 1.6, dx: 0.2, dy: 5.3, dz: -0.3, m: MAT.leaf },
    ];
    for (const b of blobs) {
        const f = new THREE.Mesh(new THREE.SphereGeometry(b.r, 8, 7), b.m);
        f.position.set(x + b.dx, y + b.dy, z + b.dz);
        f.castShadow = true;
        scene.add(f);
    }
    // Collisione tronco (invariata)
    solidBoxes.push({
        min: new THREE.Vector3(x - 0.4, y, z - 0.4),
        max: new THREE.Vector3(x + 0.4, y + 3, z + 0.4)
    });
}

buildMap();

// ══════════════════════════════════════════════════════
//  MODELLO GIOCATORE REMOTO
// ══════════════════════════════════════════════════════
const HIP_Y = 0.75;   // quota dei fianchi: pivot di gambe e busto

function createPlayerMesh(color) {
    const group = new THREE.Group();
    // Il modello guarda verso -Z (forward del gioco quando yaw = 0)

    const teamCol = new THREE.Color(color);
    const darkCol = teamCol.clone().multiplyScalar(0.55);
    const matSuit = new THREE.MeshLambertMaterial({ color: teamCol });
    const matDark = new THREE.MeshLambertMaterial({ color: darkCol });
    const matSkin = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
    const matGun = new THREE.MeshLambertMaterial({ color: 0x1c1c1c });
    const matBoot = new THREE.MeshLambertMaterial({ color: 0x111111 });

    // box() aggiunge una mesh a un parent con coordinate locali al parent
    function box(w, h, d, x, y, z, mat, parent) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        (parent || group).add(m);
        return m;
    }

    // ── Busto + braccia + testa + arma in un gruppo pivotato ai fianchi ──
    // (così crouch/slide possono abbassarlo e inclinarlo). y locale = y_mondo - HIP_Y
    const upper = new THREE.Group();
    upper.position.y = HIP_Y;
    group.add(upper);

    box(0.50, 0.62, 0.30, 0, 1.08 - HIP_Y, 0, matSuit, upper);          // busto
    box(0.36, 0.42, 0.06, 0, 1.10 - HIP_Y, -0.16, matDark, upper);      // pettorina
    box(0.15, 0.50, 0.18, -0.34, 1.12 - HIP_Y, 0, matSuit, upper);      // braccia
    box(0.15, 0.50, 0.18, 0.34, 1.12 - HIP_Y, 0, matSuit, upper);
    box(0.15, 0.16, 0.18, -0.34, 0.83 - HIP_Y, 0.04, matSkin, upper);   // mani
    box(0.15, 0.16, 0.18, 0.34, 0.83 - HIP_Y, 0.04, matSkin, upper);
    box(0.16, 0.10, 0.16, 0, 1.46 - HIP_Y, 0, matSkin, upper);          // collo
    const head = box(0.30, 0.32, 0.30, 0, 1.66 - HIP_Y, 0, matSkin, upper);
    box(0.36, 0.18, 0.36, 0, 1.82 - HIP_Y, 0, matDark, upper);          // casco
    box(0.34, 0.07, 0.10, 0, 1.74 - HIP_Y, -0.18, matGun, upper);       // visiera
    box(0.09, 0.11, 0.65, 0.20, 1.02 - HIP_Y, -0.30, matGun, upper);    // arma
    box(0.04, 0.10, 0.12, 0.20, 0.93 - HIP_Y, -0.18, matGun, upper);    // caricatore

    // ── Gambe: ogni gamba è un gruppo pivotato all'anca (per oscillare) ──
    const legL = new THREE.Group(); legL.position.set(-0.12, HIP_Y, 0); group.add(legL);
    const legR = new THREE.Group(); legR.position.set(0.12, HIP_Y, 0); group.add(legR);
    box(0.20, 0.70, 0.24, 0, 0.40 - HIP_Y, 0, matDark, legL);           // coscia/gamba
    box(0.22, 0.14, 0.30, 0, 0.07 - HIP_Y, -0.03, matBoot, legL);       // stivale
    box(0.20, 0.70, 0.24, 0, 0.40 - HIP_Y, 0, matDark, legR);
    box(0.22, 0.14, 0.30, 0, 0.07 - HIP_Y, -0.03, matBoot, legR);

    // ── Healthbar sopra la testa (nascosta finché il nemico è a vita piena) ──
    const hpBar = new THREE.Group();
    hpBar.position.set(0, 2.15, 0);
    const hpBg = new THREE.Mesh(
        new THREE.PlaneGeometry(0.86, 0.16),
        new THREE.MeshBasicMaterial({ color: 0x101010 })
    );
    const hpFill = new THREE.Mesh(
        new THREE.PlaneGeometry(0.80, 0.10),
        new THREE.MeshBasicMaterial({ color: 0x46d35a })
    );
    hpFill.position.z = 0.002;
    hpBar.add(hpBg, hpFill);
    hpBar.visible = false;
    group.add(hpBar);

    return { group, head, upper, legL, legR, hpBar, hpFill };
}

// Healthbar: visibile solo se ferito, riempimento ancorato a sinistra, billboard verso la camera
const _camQuat = new THREE.Quaternion();
const _grpQuat = new THREE.Quaternion();
function updateHealthbar(rp) {
    if (!rp.hpBar) return;
    const hp = Math.max(0, Math.min(100, rp.hp ?? 100));
    const show = hp < 100 && !rp.dead;
    rp.hpBar.visible = show;
    if (!show) return;
    const frac = hp / 100;
    rp.hpFill.scale.x = Math.max(0.001, frac);
    rp.hpFill.position.x = -0.4 * (1 - frac);
    rp.hpFill.material.color.setHex(frac > 0.5 ? 0x46d35a : frac > 0.25 ? 0xe0a82a : 0xd23b2b);
    camera.getWorldQuaternion(_camQuat);
    rp.group.getWorldQuaternion(_grpQuat);
    rp.hpBar.quaternion.copy(_grpQuat.invert().multiply(_camQuat));
}

// Posture: quota e inclinazione del busto per ogni stato
const POSTURE = {
    stand: { upperY: HIP_Y, tilt: 0 },
    crouch: { upperY: HIP_Y - 0.28, tilt: 0.22 },
    slide: { upperY: HIP_Y - 0.45, tilt: -0.35 },
};

// Anima un giocatore remoto: ciclo di corsa delle gambe + postura
function updateRemoteAnim(rp, dt) {
    const a = rp.anim;
    if (!a) return;

    // ── Ciclo gambe ──
    if (a.moving && !a.slide) {
        const rate = a.sprint ? 13 : 9;
        const swing = a.sprint ? 0.95 : 0.6;
        a.phase += dt * rate;
        rp.legL.rotation.x = Math.sin(a.phase) * swing;
        rp.legR.rotation.x = -Math.sin(a.phase) * swing;
    } else {
        const k = Math.min(1, dt * 10);
        rp.legL.rotation.x += (0 - rp.legL.rotation.x) * k;
        rp.legR.rotation.x += (0 - rp.legR.rotation.x) * k;
        if (a.slide) { rp.legL.rotation.x = 0.5; rp.legR.rotation.x = -0.2; } // posa di scivolata
        a.phase = 0;
    }

    // ── Postura (busto su/giù + inclinazione) ──
    const p = a.slide ? POSTURE.slide : a.crouch ? POSTURE.crouch : POSTURE.stand;
    const k = Math.min(1, dt * 10);
    rp.upper.position.y += (p.upperY - rp.upper.position.y) * k;
    rp.upper.rotation.x += (p.tilt - rp.upper.rotation.x) * k;

    updateHealthbar(rp);
}

function makeAnim() {
    return { phase: 0, moving: false, sprint: false, crouch: false, slide: false };
}

// Applica posizione/rotazione + stato d'animazione ricevuti da un client remoto
function applyRemoteState(rp, d) {
    rp.group.position.set(d.x, d.y, d.z);
    rp.group.rotation.y = d.ry;
    if (rp.anim) {
        rp.anim.moving = !!d.mv;
        rp.anim.sprint = !!d.sp;
        rp.anim.crouch = !!d.cr;
        rp.anim.slide = !!d.sl;
    }
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
    document.getElementById('crosshair').className = key === 'assault' ? '' : key;
}
switchWeaponModel('assault');

// ══════════════════════════════════════════════════════
//  POINTER LOCK
// ══════════════════════════════════════════════════════
let pointerLocked = false;
let isADS = false;
const ADS_FOV = { assault: 50, smg: 55, shotgun: 62, sniper: 15 };

document.getElementById('ptr-btn').addEventListener('click', () => {
    Sfx.resume();
    canvas.requestPointerLock();
});

// Anche click diretto sul canvas lancia il pointer lock
canvas.addEventListener('click', () => {
    Sfx.resume();
    if (!pointerLocked && gameState.phase === 'playing' && !gameState.isDead) {
        canvas.requestPointerLock();
    }
});

document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
    const shouldShow = !pointerLocked && gameState.phase === 'playing' && !gameState.isDead;
    document.getElementById('pointer-prompt').classList.toggle('active', shouldShow);
    if (!pointerLocked) exitADS();
});

document.addEventListener('mousemove', (e) => {
    if (!pointerLocked || gameState.isDead || gameState.phase !== 'playing') return;
    // Sensibilità ridotta in ADS proporzionalmente allo zoom
    const sens = isADS ? MOUSE_SENS * (camera.fov / 75) : MOUSE_SENS;
    yaw -= e.movementX * sens;
    pitch -= e.movementY * sens;
    pitch = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, pitch));
});

// ── ADS (tasto destro) ──────────────────────────────
function enterADS() {
    if (isADS || !pointerLocked || gameState.isDead || gameState.phase !== 'playing') return;
    isADS = true;
    const w = gameState.myWeapon;
    camera.fov = ADS_FOV[w] ?? 50;
    camera.updateProjectionMatrix();
    document.body.classList.add('ads', 'ads-' + w);
}

function exitADS() {
    if (!isADS) return;
    isADS = false;
    camera.fov = 75;
    camera.updateProjectionMatrix();
    document.body.classList.remove('ads', 'ads-assault', 'ads-smg', 'ads-shotgun', 'ads-sniper');
}

document.addEventListener('mousedown', (e) => { if (e.button === 2) enterADS(); });
document.addEventListener('mouseup', (e) => { if (e.button === 2) exitADS(); });
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ══════════════════════════════════════════════════════
//  INPUT TASTIERA
// ══════════════════════════════════════════════════════
// Tasti usati dal gioco: ne blocchiamo il comportamento di default del browser
// (Ctrl+S/D/A, scroll con Space, ecc.) per non perdere il focus né i keyup.
const GAME_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyC', 'KeyT', 'Space',
    'ShiftLeft', 'ShiftRight'
]);

// Reset di tutti i tasti: evita movimenti "incollati" quando la finestra
// perde il focus (es. un popup del browser ruba l'evento keyup).
function clearKeys() {
    keys = {};
    clearInterval(autoFireInterval);
}
window.addEventListener('blur', clearKeys);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearKeys(); });

document.addEventListener('keydown', (e) => {
    // Blocca gli shortcut del browser mentre giochi
    if (GAME_KEYS.has(e.code) || ((e.ctrlKey || e.metaKey) && pointerLocked)) {
        e.preventDefault();
    }
    keys[e.code] = true;

    if (e.code === 'KeyR' && !isReloading && gameState.myAmmo < gameState.myMaxAmmo) {
        startReload();
    }
    if (e.code === 'Space' && onGround && gameState.phase === 'playing' && !gameState.isDead) {
        velocityY = JUMP_FORCE;
        onGround = false;
    }
    // DEBUG (test da soli): T simula un colpo subìto da direzione casuale
    if (e.code === 'KeyT' && gameState.phase === 'playing' && !gameState.isDead) {
        showDamageVignette();
        showDamageDirectionAngle(Math.random() * Math.PI * 2);
        addShake(0.5);
        Sfx.hurt();
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
        Sfx.empty();
        startReload();
        return;
    }

    gameState.myAmmo--;
    updateAmmoHUD();
    playMuzzleFlash();
    Sfx.shoot(gameState.myWeapon);

    // ── Rinculo: kick della vista + shake + scossone del viewmodel ──
    const rc = RECOIL[gameState.myWeapon] || RECOIL.assault;
    const adsMul = isADS ? 0.5 : 1;
    recoilPitch += rc.pitch * adsMul;
    recoilYaw += (Math.random() - 0.5) * 2 * rc.yaw * adsMul;
    addShake(rc.shake * (isADS ? 0.6 : 1));
    weaponKick = 1;

    // Raycast su hitbox sferiche dei giocatori remoti
    const dir = getShootDir(w.spread);
    const maxDist = Math.min(w.range, 80);

    // Origine del raggio = posizione reale dell'occhio (camera), non i piedi
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);

    // Il colpo si ferma sul primo muro/ostacolo lungo la traiettoria
    const wall = raycastSolids(origin, dir, maxDist);
    let tracerDist = wall ? wall.dist : maxDist;

    let bestDist = Infinity;
    let bestColor = null;

    for (const [color, rp] of Object.entries(gameState.players)) {
        if (rp.dead) continue;

        // Hitbox = CAPSULA VERTICALE (piedi→testa), campionata a sfere lungo il corpo:
        // così mirando a testa/gambe/torso da vicino si colpisce sempre.
        // L'altezza si abbassa in base alla postura (crouch/slide).
        const a = rp.anim;
        let y0 = 0.30, y1 = 1.75, r = 0.42;
        if (a && a.slide) { y0 = 0.20; y1 = 0.95; r = 0.42; }
        else if (a && a.crouch) { y0 = 0.30; y1 = 1.20; r = 0.44; }

        const px = rp.group.position.x, py = rp.group.position.y, pz = rp.group.position.z;
        const steps = Math.max(1, Math.ceil((y1 - y0) / r));
        for (let i = 0; i <= steps; i++) {
            const cy = py + y0 + (y1 - y0) * (i / steps);
            const tx = px - origin.x, ty = cy - origin.y, tz = pz - origin.z;
            const proj = tx * dir.x + ty * dir.y + tz * dir.z;
            if (proj <= 0 || proj > w.range) continue;     // dietro di noi o fuori range
            const perp2 = Math.max(0, (tx * tx + ty * ty + tz * tz) - proj * proj);
            if (perp2 < r * r && proj < bestDist) {
                bestDist = proj;
                bestColor = color;
            }
        }
    }

    // Colpo valido solo se il nemico è davanti al muro (niente colpi attraverso i muri)
    if (bestColor && bestDist <= tracerDist) {
        tracerDist = bestDist;
        showHitmarker(false);
        Sfx.hitConfirm();
        // Schizzo di sangue sul punto colpito
        spawnParticles(origin.clone().addScaledVector(dir, bestDist), 0xcc1111, 9,
            { speed: 3.5, gravity: 11, size: 0.06, life: 380 });
        socket.emit('reportHit', {
            lobbyId: LOBBY_ID,
            shooterColor: MY_COLOR,
            targetColor: bestColor,
            weaponKey: gameState.myWeapon
        });
    } else if (wall) {
        // Polvere/detriti sull'impatto col muro
        spawnParticles(wall.point, 0xbcb6a4, 6,
            { speed: 2.2, gravity: 5, size: 0.05, life: 320 });
    }

    spawnTracer(dir, tracerDist);

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

// ── Bullet tracer ──────────────────────────────────
const _tracerOrigin = new THREE.Vector3();
const _tracerUp = new THREE.Vector3(0, 1, 0);

function spawnTracer(dir, dist) {
    camera.getWorldPosition(_tracerOrigin);
    // Parte 0.4 m davanti alla camera per evitare il near-plane clipping
    _tracerOrigin.addScaledVector(dir, 0.4);
    const len = Math.max(dist - 0.4, 0.5);
    const mid = _tracerOrigin.clone().addScaledVector(dir, len * 0.5);

    // Cylinder (webgl line è 1px, invisible): raggio 12mm
    const geo = new THREE.CylinderGeometry(0.012, 0.012, len, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.85 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(mid);
    // CylinderGeometry è orientato sull'asse Y; ruotiamo verso la direzione di sparo
    const d = dir.clone().normalize();
    if (Math.abs(d.y) < 0.999) {
        mesh.quaternion.setFromUnitVectors(_tracerUp, d);
    }
    scene.add(mesh);

    const t0 = performance.now();
    (function fade() {
        const el = performance.now() - t0;
        if (el >= 200) { scene.remove(mesh); geo.dispose(); mat.dispose(); return; }
        mat.opacity = 0.85 * (1 - el / 200);
        requestAnimationFrame(fade);
    })();
}

// ── Raycast contro gli AABB solidi (slab method) ──
// Ritorna { dist, point } del primo impatto entro maxDist, o null.
function raycastSolids(origin, dir, maxDist) {
    let best = maxDist, point = null;
    for (const b of solidBoxes) {
        let tmin = -Infinity, tmax = Infinity, miss = false;
        for (const ax of ['x', 'y', 'z']) {
            const o = origin[ax], d = dir[ax];
            const mn = b.min[ax], mx = b.max[ax];
            if (Math.abs(d) < 1e-8) {
                if (o < mn || o > mx) { miss = true; break; }
            } else {
                let t1 = (mn - o) / d, t2 = (mx - o) / d;
                if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
                if (t1 > tmin) tmin = t1;
                if (t2 < tmax) tmax = t2;
            }
        }
        if (!miss && tmin <= tmax && tmin > 0 && tmin < best) {
            best = tmin;
            point = origin.clone().addScaledVector(dir, tmin);
        }
    }
    return point ? { dist: best, point } : null;
}

// ── Particelle d'impatto (sangue, polvere) ──
const _particleGeo = new THREE.BoxGeometry(1, 1, 1);
function spawnParticles(point, color, count, opts = {}) {
    const { speed = 4, size = 0.06, life = 350, gravity = 8 } = opts;
    for (let i = 0; i < count; i++) {
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
        const m = new THREE.Mesh(_particleGeo, mat);
        m.scale.setScalar(size);
        m.position.copy(point);
        const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
            .normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
        scene.add(m);
        const t0 = performance.now();
        (function step() {
            const el = performance.now() - t0;
            if (el >= life) { scene.remove(m); mat.dispose(); return; }
            const d = 0.016;
            v.y -= gravity * d;
            m.position.addScaledVector(v, d);
            mat.opacity = 1 - el / life;
            requestAnimationFrame(step);
        })();
    }
}

// Hitmarker — feedback visivo quando colpisci un avversario
let hitmarkerTimeout = null;
function showHitmarker(isKill) {
    const hm = document.getElementById('hitmarker');
    hm.classList.remove('show', 'kill');
    void hm.offsetWidth; // reflow per riavviare l'animazione
    if (isKill) hm.classList.add('kill');
    hm.classList.add('show');
    clearTimeout(hitmarkerTimeout);
    hitmarkerTimeout = setTimeout(() => hm.classList.remove('show', 'kill'), 260);
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
    Sfx.reload(w.reload);
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
// Verifica che il player possa stare in piedi con i piedi a footY in (x,z)
// senza che il corpo intersechi altri box solidi (controllo testa/headroom)
function canStandAt(x, z, footY, ignoreBox) {
    // Ignora ostacoli bassi (entro STEP_HEIGHT dai piedi): sono i gradini stessi.
    // Blocca solo se qualcosa occupa lo spazio di testa/busto sopra il gradino.
    const bodyBottom = footY + STEP_HEIGHT;
    const head = footY + PLAYER_HEIGHT;
    for (const b of solidBoxes) {
        if (b === ignoreBox) continue;
        if (x + PLAYER_RADIUS <= b.min.x || x - PLAYER_RADIUS >= b.max.x) continue;
        if (z + PLAYER_RADIUS <= b.min.z || z - PLAYER_RADIUS >= b.max.z) continue;
        if (b.min.y < head - 0.05 && b.max.y > bodyBottom + 0.05) return false;
    }
    return true;
}

function resolveCollisions(pos) {
    for (const box of solidBoxes) {
        // Scarta box che non si sovrappongono verticalmente al player
        if (pos.y >= box.max.y || pos.y + PLAYER_HEIGHT <= box.min.y) continue;

        const overlapXL = (pos.x + PLAYER_RADIUS) - box.min.x;
        const overlapXR = box.max.x - (pos.x - PLAYER_RADIUS);
        const overlapZF = (pos.z + PLAYER_RADIUS) - box.min.z;
        const overlapZB = box.max.z - (pos.z - PLAYER_RADIUS);

        if (overlapXL <= 0 || overlapXR <= 0 || overlapZF <= 0 || overlapZB <= 0) continue;

        // ── STEP-UP: se il gradino è basso e c'è spazio sopra, salgo invece di bloccare ──
        const stepUp = box.max.y - pos.y;
        if (stepUp > 0 && stepUp <= STEP_HEIGHT && canStandAt(pos.x, pos.z, box.max.y, box)) {
            pos.y = box.max.y;
            velocityY = 0;
            onGround = true;
            continue;
        }

        // Altrimenti risolvi sull'asse con penetrazione minima (sliding sui muri)
        const minX = Math.min(overlapXL, overlapXR);
        const minZ = Math.min(overlapZF, overlapZB);
        if (minX <= minZ) {
            pos.x += overlapXL < overlapXR ? -overlapXL : overlapXR;
        } else {
            pos.z += overlapZF < overlapZB ? -overlapZF : overlapZB;
        }
    }
}

// ══════════════════════════════════════════════════════
//  MOVIMENTO GIOCATORE
// ══════════════════════════════════════════════════════
const _moveDir = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
let _stepTimer = 0;

// ── Stato sprint / crouch / slide ──
let isCrouching = false;
let isSprinting = false;
let isSliding = false;
let isMoving = false;              // in movimento orizzontale (per animazioni remote)
let airSprint = false;            // ho lasciato il suolo mentre sprintavo (sprint-jump)
let slideTimer = 0;
let slideVX = 0, slideVZ = 0;
let currentEyeH = PLAYER_HEIGHT;   // altezza occhi animata (smoothing)
let cameraRoll = 0;                // inclinazione camera (roll) durante la slide
let _prevCrouch = false;
const AIR_SPRINT_BOOST = 1.18;     // Minecraft-style: sprint-jump copre più terreno

// ── Game feel: recoil + screen shake + viewmodel kick ──
let recoilPitch = 0;   // offset verticale del rinculo (decade a 0)
let recoilYaw = 0;     // offset orizzontale del rinculo
let shakeTrauma = 0;   // 0..1, intensità screen shake
let weaponKick = 0;    // 0..1, rinculo visivo dell'arma

const RECOIL = {
    assault: { pitch: 0.013, yaw: 0.006, shake: 0.10 },
    smg: { pitch: 0.008, yaw: 0.007, shake: 0.07 },
    shotgun: { pitch: 0.038, yaw: 0.012, shake: 0.32 },
    sniper: { pitch: 0.050, yaw: 0.008, shake: 0.45 },
};

function addShake(amount) { shakeTrauma = Math.min(1, shakeTrauma + amount); }

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

    // ── Determinazione stati: crouch, sprint, avvio slide ──
    const moving = _moveDir.lengthSq() > 0;
    const wantCrouch = !!keys['KeyC'];   // crouch/slide solo con C (Ctrl liberato per il browser)
    const wantSprintKey = !!(keys['ShiftLeft'] || keys['ShiftRight']);
    isSprinting = wantSprintKey && keys['KeyW'] && moving && onGround && !wantCrouch && !isADS && !isSliding;

    // Avvio slide: stavo sprintando e premo crouch (fronte di salita del tasto)
    const crouchPressed = wantCrouch && !_prevCrouch;
    if (crouchPressed && wantSprintKey && keys['KeyW'] && moving && onGround && !isSliding) {
        isSliding = true;
        slideTimer = 0;
        slideVX = _moveDir.x * SLIDE_BOOST;
        slideVZ = _moveDir.z * SLIDE_BOOST;
        Sfx.slide();
    }
    _prevCrouch = wantCrouch;

    if (isSliding) {
        slideTimer += dt;
        const sp = Math.hypot(slideVX, slideVZ);
        const newSp = Math.max(0, sp - SLIDE_FRICTION * dt);
        if (sp > 1e-4) { slideVX *= newSp / sp; slideVZ *= newSp / sp; }
        pos.x += slideVX * dt;
        pos.z += slideVZ * dt;
        if (newSp < SLIDE_MIN_SPEED || slideTimer > SLIDE_MAX_TIME || !wantCrouch || !onGround) {
            isSliding = false;
        }
    } else {
        let speed;
        if (!onGround) {
            // In aria: mantieni la velocità di sprint (con boost) se hai saltato sprintando
            speed = airSprint ? SPRINT_SPEED * AIR_SPRINT_BOOST : WALK_SPEED;
        } else {
            speed = wantCrouch ? CROUCH_SPEED : isSprinting ? SPRINT_SPEED : WALK_SPEED;
        }
        pos.x += _moveDir.x * speed * dt;
        pos.z += _moveDir.z * speed * dt;
    }
    isCrouching = wantCrouch && !isSliding;
    isMoving = moving;

    // Gravità
    const prevY = pos.y;
    velocityY -= GRAVITY * dt;
    velocityY = Math.max(velocityY, -20); // terminal velocity
    pos.y += velocityY * dt;

    onGround = false;

    if (pos.y <= 0) {
        pos.y = 0;
        velocityY = 0;
        onGround = true;
    } else if (velocityY <= 0) {
        // Atterraggio sulla superficie superiore dei box
        for (const box of solidBoxes) {
            if (pos.x + PLAYER_RADIUS <= box.min.x || pos.x - PLAYER_RADIUS >= box.max.x) continue;
            if (pos.z + PLAYER_RADIUS <= box.min.z || pos.z - PLAYER_RADIUS >= box.max.z) continue;
            if (prevY >= box.max.y && pos.y <= box.max.y) {
                pos.y = box.max.y;
                velocityY = 0;
                onGround = true;
                break;
            }
        }
    }

    // Mentre sei a terra, memorizza lo stato di sprint da portare nel prossimo salto
    if (onGround) airSprint = isSprinting;

    // Clamp mappa
    pos.x = Math.max(-MAP_HALF + 1, Math.min(MAP_HALF - 1, pos.x));
    pos.z = Math.max(-MAP_HALF + 1, Math.min(MAP_HALF - 1, pos.z));

    resolveCollisions(pos);

    // Passi: cadenza in base allo stato (muti durante la scivolata)
    if (onGround && moving && !isSliding) {
        _stepTimer += dt;
        const interval = isSprinting ? 0.30 : isCrouching ? 0.6 : 0.45;
        if (_stepTimer >= interval) { _stepTimer = 0; Sfx.footstep(); }
    } else {
        _stepTimer = 0.45; // così il primo passo riparte subito
    }

    // ── Decadimento rinculo + screen shake ──
    const recover = Math.min(1, dt * 11);
    recoilPitch += (0 - recoilPitch) * recover;
    recoilYaw += (0 - recoilYaw) * recover;
    shakeTrauma = Math.max(0, shakeTrauma - dt * 1.6);
    weaponKick = Math.max(0, weaponKick - dt * 6);

    const shake = shakeTrauma * shakeTrauma;   // curva quadratica più "punchy"
    const shX = (Math.random() - 0.5) * 2 * 0.05 * shake;
    const shY = (Math.random() - 0.5) * 2 * 0.05 * shake;
    const shZ = (Math.random() - 0.5) * 2 * 0.04 * shake;

    // Altezza occhi (crouch/slide) con smoothing
    const targetEye = isSliding ? SLIDE_EYE : isCrouching ? CROUCH_EYE : STAND_EYE;
    currentEyeH += (targetEye - currentEyeH) * Math.min(1, dt * 12);
    camera.position.y = currentEyeH;

    // Roll della camera durante la slide (feeling di scivolata)
    const targetRoll = isSliding ? 0.13 : 0;
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 10);

    // Rotazione camera (mira + rinculo + shake). yaw/pitch "puri" restano per il netcode.
    playerRoot.rotation.y = yaw + recoilYaw + shX;
    camera.rotation.x = pitch + recoilPitch + shY;
    camera.rotation.z = shZ + cameraRoll;

    // Weapon bob (più ampio/rapido in corsa) + kick del rinculo
    const bobAmp = isSprinting ? 1.8 : 1;
    const bobRate = isSprinting ? 11 : 8;
    const speed = isMoving ? 1 : 0;
    const t = Date.now() / 1000;
    weaponGroup.position.x = Math.sin(t * bobRate) * 0.008 * bobAmp * speed;
    weaponGroup.position.y = Math.abs(Math.sin(t * bobRate)) * 0.006 * bobAmp * speed + weaponKick * 0.01;
    weaponGroup.position.z = weaponKick * 0.06;
    weaponGroup.rotation.x = weaponKick * 0.12;
}

// ══════════════════════════════════════════════════════
//  MINIMAP
// ══════════════════════════════════════════════════════
const minimapCtx = document.getElementById('minimap-canvas').getContext('2d');

function drawMinimap() {
    const ctx = minimapCtx;
    const size = 130;
    const c = size / 2;                 // centro
    const viewRadius = MAP_HALF;        // unità di mondo dal centro al bordo
    const s = c / viewRadius;           // scala mondo → pixel

    const px = playerRoot.position.x;
    const pz = playerRoot.position.z;
    const sinY = Math.sin(yaw), cosY = Math.cos(yaw);

    // Trasforma coord-mondo in coord-minimappa ruotate sul player:
    // forward del player (-sinY, -cosY) punta sempre verso l'alto.
    const toMM = (wx, wz) => {
        const rx = wx - px, rz = wz - pz;
        const fwd = rx * (-sinY) + rz * (-cosY);   // componente "avanti"
        const right = rx * cosY + rz * (-sinY);    // componente "destra"
        return { x: c + right * s, y: c - fwd * s };
    };

    ctx.clearRect(0, 0, size, size);

    // Sfondo + clip circolare
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, size, size);

    // Croce di riferimento (assi N/S, E/O ruotati con il player)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, c); ctx.lineTo(size, c);
    ctx.moveTo(c, 0); ctx.lineTo(c, size);
    ctx.stroke();

    // Giocatori remoti
    for (const [color, rp] of Object.entries(gameState.players)) {
        if (rp.dead) continue;
        const p = toMM(rp.group.position.x, rp.group.position.z);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    ctx.restore();

    // Player al centro: triangolo che punta verso l'alto (= avanti)
    ctx.fillStyle = '#f1c40f';
    ctx.beginPath();
    ctx.moveTo(c, c - 7);
    ctx.lineTo(c - 5, c + 5);
    ctx.lineTo(c + 5, c + 5);
    ctx.closePath();
    ctx.fill();
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
            <span style="color:${color}">${color === MY_COLOR ? 'YOU' : ''}</span>
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

// Indicatore direzione danno: ruota una freccia attorno al mirino
// verso la sorgente del colpo, relativa a dove stai guardando.
let dmgDirTimeout = null;
function showDamageDirectionAngle(ang) {
    const el = document.getElementById('dmg-dir');
    el.style.transform = `rotate(${ang}rad)`;
    el.classList.remove('show');
    void el.offsetWidth; // reflow per riavviare l'animazione
    el.classList.add('show');
    clearTimeout(dmgDirTimeout);
    dmgDirTimeout = setTimeout(() => el.classList.remove('show'), 900);
}
function showDamageDirection(shooterColor) {
    const rp = gameState.players[shooterColor];
    if (!rp) return;
    const dx = rp.group.position.x - playerRoot.position.x;
    const dz = rp.group.position.z - playerRoot.position.z;
    // Proietta sul sistema di riferimento del player (avanti/destra)
    const f = dx * (-Math.sin(yaw)) + dz * (-Math.cos(yaw)); // componente avanti
    const r = dx * Math.cos(yaw) + dz * (-Math.sin(yaw));    // componente destra
    showDamageDirectionAngle(Math.atan2(r, f)); // 0 = davanti, +orario = destra
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
        applyRemoteState(gameState.players[data.color], data);
    }
}

function broadcastState() {
    const msg = JSON.stringify({
        type: 'state',
        color: MY_COLOR,
        x: playerRoot.position.x,
        y: playerRoot.position.y,
        z: playerRoot.position.z,
        ry: yaw,
        mv: isMoving, sp: isSprinting, cr: isCrouching, sl: isSliding
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
    if (gameState.phase !== 'playing') return;
    if (!gameState.players[data.color]) {
        // Crea mesh al volo se roundStart è arrivato tardi
        const parts = createPlayerMesh(data.color);
        scene.add(parts.group);
        gameState.players[data.color] = { ...parts, hp: 100, dead: false, anim: makeAnim() };
    }
    applyRemoteState(gameState.players[data.color], data);
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
    const readyEl = document.getElementById('ws-players-ready');
    const dots = readyEl.querySelectorAll('.ws-ready-dot');
    if (dots.length !== total) {
        // Riquicostruisce i dot se il totale è cambiato (es. secondo giocatore si è connesso)
        readyEl.innerHTML = `<span>${count} / ${total} ready</span><br>`;
        for (let i = 0; i < total; i++) {
            const dot = document.createElement('div');
            dot.className = 'ws-ready-dot' + (i < count ? ' on' : '');
            readyEl.appendChild(dot);
        }
    } else {
        dots.forEach((d, i) => d.classList.toggle('on', i < count));
        const span = readyEl.querySelector('span');
        if (span) span.textContent = `${count} / ${total} ready`;
    }
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
        showDamageDirection(shooterColor);
        addShake(0.45);
        Sfx.hurt();
    }
    if (gameState.players[targetColor]) {
        // Aggiorna HP del giocatore remoto (per eventuale healthbar sopra la testa)
        gameState.players[targetColor].hp = hp;
    }
});

socket.on('playerKilled', ({ killedColor, killerColor, aliveCount }) => {
    addKillfeed(killerColor, killedColor);

    // Hitmarker rosso "kill" se l'uccisione è mia
    if (killerColor === MY_COLOR && killedColor !== MY_COLOR) {
        showHitmarker(true);
        Sfx.killConfirm();
    }

    if (killedColor === MY_COLOR) {
        gameState.isDead = true;
        Sfx.death();
        exitADS();
        document.getElementById('dead-screen').classList.add('active');
        document.exitPointerLock();
        if (weaponGroup) weaponGroup.visible = false;
    }

    if (gameState.players[killedColor]) {
        gameState.players[killedColor].dead = true;
        gameState.players[killedColor].group.visible = false;
    }
});

socket.on('playerLeft', ({ color }) => {
    const rp = gameState.players[color];
    if (rp) {
        scene.remove(rp.group);   // la healthbar è figlia del group → rimossa con esso
        delete gameState.players[color];
    }
    if (gameState.scores[color] !== undefined) {
        delete gameState.scores[color];
        updateScoreHUD();
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
    document.getElementById('pointer-prompt').classList.remove('active');
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

            // Reset stati movimento (postura in piedi)
            isSliding = isCrouching = isSprinting = isMoving = airSprint = false;
            slideTimer = 0;
            currentEyeH = STAND_EYE;
            camera.position.y = STAND_EYE;
            cameraRoll = 0;
            camera.rotation.z = 0;

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
            const parts = createPlayerMesh(color);
            parts.group.position.set(pState.x, pState.y, pState.z);
            scene.add(parts.group);
            gameState.players[color] = { ...parts, hp: 100, dead: false, anim: makeAnim() };
        }
    }

    updateRoundHUD();
    updateScoreHUD();
    Sfx.roundStart();

    document.getElementById('overlay').classList.remove('active');
    document.getElementById('dead-screen').classList.remove('active');
    if (weaponGroup) weaponGroup.visible = true;

    // Mostra il prompt solo se il pointer non è già catturato
    if (!pointerLocked) {
        document.getElementById('pointer-prompt').classList.add('active');
    }
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
        switchWeaponModel(wk);
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

// Invio posizione agli altri client (WebRTC + fallback socket)
function sendStateHeartbeat() {
    if (gameState.phase !== 'playing') return;
    broadcastState();
    socket.emit('playerState', {
        lobbyId: LOBBY_ID,
        color: MY_COLOR,
        x: playerRoot.position.x,
        y: playerRoot.position.y,
        z: playerRoot.position.z,
        ry: yaw,
        mv: isMoving, sp: isSprinting, cr: isCrouching, sl: isSliding
    });
}

// ── Heartbeat resiliente al throttling delle tab in background ──
// Le schede non attive congelano requestAnimationFrame: un Web Worker
// (che NON viene throttlato) continua a inviare la posizione, così l'altro
// client ti vede sempre anche quando la tua scheda è in secondo piano.
// Serve soprattutto per testare il multiplayer con due schede.
let bgHeartbeat = null;
try {
    const workerSrc = `let h=null;onmessage=e=>{if(e.data==='start'){h=setInterval(()=>postMessage(0),50);}else{clearInterval(h);}};`;
    const blob = new Blob([workerSrc], { type: 'application/javascript' });
    bgHeartbeat = new Worker(URL.createObjectURL(blob));
    bgHeartbeat.onmessage = () => { if (document.hidden) sendStateHeartbeat(); };
    bgHeartbeat.postMessage('start');
} catch { /* Worker non disponibile: si resta col solo rAF */ }

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    updateMovement(dt);
    for (const rp of Object.values(gameState.players)) {
        if (!rp.dead) updateRemoteAnim(rp, dt);
    }
    drawMinimap();

    // Broadcast stato (throttled a 20fps) quando la scheda è in primo piano
    stateThrottle += dt;
    if (stateThrottle >= 0.05) {
        stateThrottle = 0;
        sendStateHeartbeat();
    }

    renderer.render(scene, camera);
}

animate();