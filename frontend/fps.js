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
const INTERP_DELAY = 100; // ms di ritardo buffer per interpolazione giocatori remoti

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
    subphase: null,      // 'melee' | 'suddendeath' durante il round
    mutator: null,       // mutatore attivo nel round corrente
    currentRound: 1,
    totalRounds: 8,
    scores: {},    // vittorie sudden death per round
    points: {},    // punti totali (teste) — metrica principale
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

// ── Moltiplicatori runtime pilotati dai mutatori (resettati ogni round) ──
let gravityMul = 1;
let speedMul = 1;
let headScale = 1;   // mutatore "Teste Giganti"
let ammoCap = Infinity;   // mutatore "Un Colpo in Canna" (cap munizioni)
let sizeMul = 1;          // mutatore "Mini Giocatori" (scala corpo/collisioni/camera)
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
    function respawn() {
        tone(520, 0.08, { type: 'triangle', gain: 0.2, freqEnd: 880 });
    }
    // Stinger "reveal mutatore": whoosh + accordo ascendente
    function revealStinger() {
        ensure(); if (!ctx) return;
        noise(0.4, { type: 'bandpass', freq: 1200, q: 0.6, gain: 0.3, attack: 0.15 });
        tone(330, 0.5, { type: 'sawtooth', gain: 0.18, freqEnd: 660 });
        tone(660, 0.35, { type: 'square', gain: 0.16, delay: 0.18 });
        tone(990, 0.3, { type: 'square', gain: 0.14, delay: 0.32 });
    }
    // Sudden death: rintocco cupo e teso
    function suddenDeath() {
        ensure(); if (!ctx) return;
        tone(160, 0.6, { type: 'sawtooth', gain: 0.32, freqEnd: 70 });
        tone(240, 0.5, { type: 'square', gain: 0.16, delay: 0.05 });
        noise(0.5, { type: 'lowpass', freq: 400, gain: 0.2 });
    }

    return { resume, shoot, hitConfirm, killConfirm, reload, footstep, slide, empty, hurt, death, roundStart, respawn, revealStinger, suddenDeath };
})();

// ══════════════════════════════════════════════════════
//  THREE.JS SETUP
// ══════════════════════════════════════════════════════
const canvas = document.getElementById('fps-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const DEFAULT_SKY = 0x87ceeb;         // cielo/nebbia di default (ripristinati dai mutatori)
const DEFAULT_FOG_DENSITY = 0.008;
renderer.setClearColor(DEFAULT_SKY);  // cielo

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(DEFAULT_SKY, DEFAULT_FOG_DENSITY);

// Teste-trofeo persistenti (fuori da gameState.players → il cleanup dei round non le tocca)
const trophyGroup = new THREE.Group();
scene.add(trophyGroup);
let trophyMeshes = [];

// Podio finale (game over): staged in alto sopra l'arena, con camera dedicata.
const PODIUM_Y = 60;
const podiumGroup = new THREE.Group();
scene.add(podiumGroup);
let podiumHeads = [];
let podiumModels = [];
let podiumAnim = null;

const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 300);
camera.position.set(0, PLAYER_HEIGHT, 0);

// Camera dedicata al podio finale (game over): vive nella scena, coordinate mondo libere.
const podiumCamera = new THREE.PerspectiveCamera(55, 1, 0.05, 500);
scene.add(podiumCamera);
let activeCamera = camera;   // swap sul podio in game_over

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
    podiumCamera.aspect = w / h;
    podiumCamera.updateProjectionMatrix();
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

// Intensità di default (ripristinate dal mutatore "Blackout")
const DEFAULT_LIGHTS = { ambient: ambient.intensity, sun: sun.intensity, hemi: hemi.intensity };

// Torcia per il mutatore "Blackout": SpotLight agganciata alla camera (come muzzleLight),
// spenta di default. Punta in avanti grazie a un target figlio della camera.
const flashlight = new THREE.SpotLight(0xfff2cc, 0, 55, Math.PI / 5, 0.45, 1);
flashlight.position.set(0, 0, 0.1);
const flashlightTarget = new THREE.Object3D();
flashlightTarget.position.set(0, -0.05, -1);
camera.add(flashlightTarget);
camera.add(flashlight);
flashlight.target = flashlightTarget;

// ══════════════════════════════════════════════════════
//  TEXTURE PROCEDURALI (stile low-poly stilizzato)
//  Generate via CanvasTexture — nessun file da scaricare,
//  coerente con l'audio procedurale del progetto.
//  Sostituibili con PNG Kenney reali cambiando la sorgente.
// ══════════════════════════════════════════════════════

// Helper: crea una CanvasTexture da una funzione di disegno
function makeTex(drawFn, rx, ry, size) {
    rx = rx || 1; ry = ry || 1; size = size || 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    drawFn(ctx, size);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rx, ry);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
}

// Prato: base verde con ciuffi stilizzati
function drawGrass(ctx, s) {
    ctx.fillStyle = '#5d7a36';
    ctx.fillRect(0, 0, s, s);
    for (var i = 0; i < 55; i++) {
        var x = Math.random() * s, y = Math.random() * s;
        ctx.fillStyle = Math.random() > 0.5 ? '#6d9040' : '#4a6828';
        ctx.beginPath();
        ctx.moveTo(x, y + 6);
        ctx.lineTo(x - 2, y + 13);
        ctx.lineTo(x + 2, y + 13);
        ctx.closePath();
        ctx.fill();
    }
}

// Asfalto: base scura con granulato chiaro
function drawAsphalt(ctx, s) {
    ctx.fillStyle = '#2c2c32';
    ctx.fillRect(0, 0, s, s);
    for (var i = 0; i < 130; i++) {
        var b = Math.floor(Math.random() * 22 + 48);
        ctx.fillStyle = 'rgb(' + b + ',' + b + ',' + b + ')';
        ctx.beginPath();
        ctx.arc(Math.random() * s, Math.random() * s, Math.random() * 1.4 + 0.4, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.strokeStyle = 'rgba(70,70,80,0.35)';
    ctx.lineWidth = 1;
    for (var j = 0; j < 5; j++) {
        var y = Math.random() * s;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(s, y + (Math.random() * 8 - 4));
        ctx.stroke();
    }
}

// Cemento / marciapiede: overlay neutro con giunti — lascia passare il color del materiale
function drawConcrete(ctx, s) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    for (var i = 0; i < 18; i++) {
        ctx.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.045) + ')';
        ctx.fillRect(Math.random() * s, Math.random() * s, Math.random() * 35 + 8, Math.random() * 35 + 8);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, s / 2); ctx.lineTo(s, s / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s / 2, 0); ctx.lineTo(s / 2, s); ctx.stroke();
}

// Pavimento in legno: doghe orizzontali con venatura
function drawWoodFloor(ctx, s) {
    var colors = ['#8a6a40', '#7a5e38', '#956f45', '#7e6035'];
    var plankH = s / 6;
    for (var row = 0; row < 7; row++) {
        ctx.fillStyle = colors[row % colors.length];
        ctx.fillRect(0, row * plankH, s, plankH - 1);
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 1;
        for (var v = 0; v < 3; v++) {
            var x = Math.random() * s;
            ctx.beginPath();
            ctx.moveTo(x, row * plankH);
            ctx.bezierCurveTo(x + 18, row * plankH + plankH * 0.35,
                               x - 10, row * plankH + plankH * 0.65,
                               x + 4,  row * plankH + plankH);
            ctx.stroke();
        }
    }
    ctx.strokeStyle = 'rgba(50,35,20,0.28)';
    ctx.lineWidth = 1;
    for (var r = 1; r < 7; r++) {
        ctx.beginPath(); ctx.moveTo(0, r * plankH); ctx.lineTo(s, r * plankH); ctx.stroke();
    }
}

// Cassa di legno: assi + cornice — stile Kenney classico
function drawCrate(ctx, s, darkCol, lightCol) {
    darkCol = darkCol || '#6c4a14'; lightCol = lightCol || '#9c7424';
    ctx.fillStyle = lightCol;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(60,35,10,0.3)';
    ctx.lineWidth = 2;
    var bW = s / 4;
    for (var i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(i * bW, 0); ctx.lineTo(i * bW, s); ctx.stroke();
    }
    ctx.strokeStyle = darkCol;
    ctx.lineWidth = 7;
    ctx.strokeRect(7, 7, s - 14, s - 14);
    ctx.strokeStyle = 'rgba(60,35,10,0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(7, 7); ctx.lineTo(s - 7, s - 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s - 7, 7); ctx.lineTo(7, s - 7); ctx.stroke();
}

// Tetto a tegole
function drawRoof(ctx, s) {
    ctx.fillStyle = '#5a3825';
    ctx.fillRect(0, 0, s, s);
    var tH = s / 6, tW = s / 5;
    ctx.fillStyle = '#4e2e1a';
    ctx.strokeStyle = 'rgba(30,15,5,0.55)';
    ctx.lineWidth = 1.5;
    for (var row = 0; row < 7; row++) {
        var offX = (row % 2) * (tW / 2);
        for (var col = -1; col < 6; col++) {
            var rx = col * tW + offX, ry = row * tH;
            ctx.fillRect(rx + 2, ry + 1, tW - 4, tH - 2);
            ctx.strokeRect(rx + 2, ry + 1, tW - 4, tH - 2);
        }
    }
}

// Siding (listelli orizzontali) in scala di grigi — si tinta col color del materiale
function drawSiding(ctx, s) {
    var bandH = s / 8;
    for (var i = 0; i < 9; i++) {
        var v = (i % 2 === 0) ? 230 : 200;
        ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
        ctx.fillRect(0, i * bandH, s, bandH);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(0, (i + 1) * bandH - 2, s, 2);
    }
}

// Muro / mattoni stilizzati
function drawBrick(ctx, s) {
    ctx.fillStyle = '#5c5040';
    ctx.fillRect(0, 0, s, s);
    var bH = s / 8, bW = s / 4;
    ctx.fillStyle = '#4e4236';
    ctx.strokeStyle = 'rgba(80,70,55,0.45)';
    ctx.lineWidth = 1.5;
    for (var row = 0; row < 8; row++) {
        var offX = (row % 2) * (bW / 2);
        for (var col = -1; col < 5; col++) {
            var bx = col * bW + offX, by = row * bH;
            ctx.fillRect(bx + 2, by + 2, bW - 4, bH - 4);
            ctx.strokeRect(bx + 2, by + 2, bW - 4, bH - 4);
        }
    }
}

// ══════════════════════════════════════════════════════
//  MATERIALI RIUTILIZZABILI
//  Superfici di mappa: texture procedurale (stile Kenney)
//  Veicoli/giocatori/armi: colore piatto (invariati)
// ══════════════════════════════════════════════════════
const MAT = {
    // ── Superfici terreno/mappa ──────────────────────────
    ground:      new THREE.MeshLambertMaterial({ map: makeTex(drawGrass, 26, 26) }),        // prato
    asphalt:     new THREE.MeshLambertMaterial({ map: makeTex(drawAsphalt, 24, 4) }),       // strada
    concrete:    new THREE.MeshLambertMaterial({ color: 0x8a8a82, map: makeTex(drawConcrete, 4, 4) }),   // cemento
    sidewalk:    new THREE.MeshLambertMaterial({ color: 0x9a9a90, map: makeTex(drawConcrete, 24, 1) }),  // marciapiede
    wall:        new THREE.MeshLambertMaterial({ map: makeTex(drawBrick, 4, 4) }),          // muro perimetro
    crate:       new THREE.MeshLambertMaterial({ map: makeTex(function(c,s){ drawCrate(c,s,'#6c4a14','#9c7424'); }) }),
    crateDark:   new THREE.MeshLambertMaterial({ map: makeTex(function(c,s){ drawCrate(c,s,'#3d2208','#6c4a14'); }) }),
    woodFloor:   new THREE.MeshLambertMaterial({ map: makeTex(drawWoodFloor, 2, 2) }),      // pavimento interno
    // ── Case (Nuketown style) ────────────────────────────
    houseYellow: new THREE.MeshLambertMaterial({ color: 0xd9b44a, map: makeTex(drawSiding, 4, 4) }),  // casa gialla
    houseTeal:   new THREE.MeshLambertMaterial({ color: 0x3a8f7e, map: makeTex(drawSiding, 4, 4) }),  // casa verde-acqua
    roof:        new THREE.MeshLambertMaterial({ map: makeTex(drawRoof, 6, 4) }),           // tetto
    trim:        new THREE.MeshLambertMaterial({ color: 0xe8e4d8 }),   // cornici bianche (invariato)
    fence:       new THREE.MeshLambertMaterial({ color: 0xe8e4d8 }),   // staccionata bianca (invariato)
    // ── Veicoli / props (colori piatti, prossimo step) ──
    metal:       new THREE.MeshLambertMaterial({ color: 0x4a5568 }),
    busYellow:   new THREE.MeshLambertMaterial({ color: 0xf2c41d }),
    vanRed:      new THREE.MeshLambertMaterial({ color: 0xb0432f }),
    tire:        new THREE.MeshLambertMaterial({ color: 0x141414 }),
    glass:       new THREE.MeshLambertMaterial({ color: 0x9ec7d6, transparent: true, opacity: 0.45 }),
    mannequin:   new THREE.MeshLambertMaterial({ color: 0xc9a98a }),
    // Cielo: MeshBasic (non illuminato) → colore uniforme su tutte le facce del cubo-cielo.
    // Con Lambert le facce interne prendevano luci diverse mostrando "strisce" alle giunzioni
    // (evidenti sul podio finale, dove non c'è nebbia a mascherarle).
    sky:         new THREE.MeshBasicMaterial({ color: 0x87ceeb, side: THREE.BackSide }),
};
// Materiali di dettaglio (props mappa — invariati)
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

// Modello d'arma in TERZA PERSONA: silhouette compatta per-tipo, così gli
// avversari vedono che arma impugni (montata nelle mani del modello, canna -z).
function buildTPWeapon(weaponKey) {
    const cached = _glbSceneCache[weaponKey];
    if (cached) {
        // GLB disponibile: clona, scala per TP, pivot al grip (1/3 dal calcio).
        // Il grip è alle mani del giocatore; il barrel si estende in avanti (-Z);
        // il calcio è nascosto dentro il busto (non visibile = pulito).
        const g = new THREE.Group();
        g.rotation.set(0, Math.PI / 2, 0);   // barrel +X → -Z (forward del giocatore)
        const model = cached.clone(true);
        const tpLen = { assault: 0.50, smg: 0.35, shotgun: 0.48, sniper: 0.60 }[weaponKey] || 0.45;
        _glbScaleAndPivot(model, tpLen);
        model.position.x -= tpLen / 3;  // sposta al grip: calcio nascosto, barrel in avanti
        _glbApplyMaterials(model);
        g.add(model);
        return g;
    }

    // Fallback a geometria box (solo se il GLB non è ancora caricato)
    const g = new THREE.Group();
    const add = (mesh) => { mesh.castShadow = true; g.add(mesh); return mesh; };

    if (weaponKey === 'smg') {
        add(makeViewBox(0.06, 0.09, 0.24, 0, 0, -0.10, 0x2b2b2b, 'polymer'));
        add(makeViewCyl(0.02, 0.12, 0, 0, -0.28, 0x222222, 'metal'));
        const mag = add(makeViewBox(0.045, 0.17, 0.05, 0, -0.13, -0.04, 0x1c1c1c, 'polymer')); mag.rotation.x = 0.12;
        add(makeViewBox(0.05, 0.06, 0.10, 0, 0, 0.08, 0x232323, 'metal'));
    } else if (weaponKey === 'shotgun') {
        add(makeViewBox(0.07, 0.10, 0.22, 0, 0, -0.08, 0x2a2a2a, 'metal'));
        add(makeViewCyl(0.026, 0.42, 0, 0.01, -0.34, 0x1a1a1a, 'metal'));
        add(makeViewCyl(0.016, 0.38, 0, -0.03, -0.32, 0x222222, 'metal'));
        add(makeViewBox(0.06, 0.09, 0.16, 0, -0.01, 0.10, 0x5c3a1e, 'wood'));
        add(makeViewBox(0.06, 0.055, 0.08, 0, -0.035, -0.24, 0x6b4524, 'wood'));
    } else if (weaponKey === 'sniper') {
        add(makeViewBox(0.07, 0.10, 0.44, 0, 0, -0.16, 0x222222, 'metal'));
        add(makeViewCyl(0.018, 0.34, 0, 0, -0.52, 0x111111, 'metal'));
        add(makeViewBox(0.07, 0.10, 0.16, 0, 0, 0.10, 0x1c1c1c, 'metal'));
        add(makeViewCyl(0.03, 0.22, 0, 0.10, -0.18, 0x2a2a2a, 'metal'));
        add(makeViewBox(0.02, 0.06, 0.02, 0, 0.06, -0.10, 0x111111, 'metal'));
        add(makeViewBox(0.02, 0.06, 0.02, 0, 0.06, -0.26, 0x111111, 'metal'));
    } else {
        add(makeViewBox(0.07, 0.10, 0.34, 0, 0, -0.12, 0x2c2c2c, 'metal'));
        add(makeViewCyl(0.02, 0.20, 0, 0, -0.36, 0x111111, 'metal'));
        const mag = add(makeViewBox(0.05, 0.16, 0.06, 0, -0.12, -0.06, 0x1c1c1c, 'polymer')); mag.rotation.x = 0.25;
        add(makeViewBox(0.06, 0.085, 0.12, 0, 0, 0.10, 0x232323, 'polymer'));
    }
    return g;
}

// Sostituisce l'arma in terza persona di un giocatore remoto (se cambia tipo)
function setRemoteWeapon(rp, weaponKey) {
    if (!rp.weaponMount || !weaponKey || rp.weaponKey === weaponKey) return;
    while (rp.weaponMount.children.length) rp.weaponMount.remove(rp.weaponMount.children[0]);
    rp.weaponMount.add(buildTPWeapon(weaponKey));
    rp.weaponKey = weaponKey;
}

function createPlayerMesh(color, weaponKey) {
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
    head.scale.setScalar(headScale);   // mutatore "Teste Giganti"

    // ── Arma in terza persona (silhouette per-tipo, sostituibile a runtime) ──
    const weaponMount = new THREE.Group();
    weaponMount.position.set(0.34, 0.83 - HIP_Y, -0.02);
    upper.add(weaponMount);
    weaponMount.add(buildTPWeapon(weaponKey || 'assault'));

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

    return { group, head, upper, legL, legR, hpBar, hpFill, weaponMount, weaponKey: weaponKey || 'assault' };
}

// ── TROFEI-TESTE (Cimitero dei Trofei) ──────────────
// Testa del caduto impalata su un'astina, nel colore-team per riconoscere chi è.
function makeTrophyHead(color, x, y, z) {
    const teamCol = new THREE.Color(color);
    const darkCol = teamCol.clone().multiplyScalar(0.55);
    const matSkin = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
    const matTeam = new THREE.MeshLambertMaterial({ color: darkCol });
    const matGun  = new THREE.MeshLambertMaterial({ color: 0x1c1c1c });

    const g = new THREE.Group();
    const mk = (w, h, d, px, py, pz, mat) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.set(px, py, pz);
        m.castShadow = true;
        g.add(m);
    };
    const spikeH = 0.34;
    mk(0.05, spikeH, 0.05, 0, spikeH / 2, 0, matGun);                 // astina (0 → 0.34)
    mk(0.32, 0.34, 0.32, 0, spikeH + 0.17, 0, matSkin);              // testa
    mk(0.38, 0.20, 0.38, 0, spikeH + 0.36, 0, matTeam);              // casco (colore team)
    mk(0.36, 0.08, 0.10, 0, spikeH + 0.15, -0.19, matGun);          // visiera

    g.position.set(x, y || 0, z);
    g.rotation.y = Math.random() * Math.PI * 2;   // orientamento casuale per varietà
    return g;
}

// Aggiunge un singolo trofeo (feedback immediato alla morte in sudden death)
function dropTrophyLive(color, x, y, z) {
    const head = makeTrophyHead(color, x, y, z);
    trophyGroup.add(head);
    trophyMeshes.push(head);
}

// Ricostruisce TUTTI i trofei dalla lista autoritativa del server (a inizio round)
function renderTrophies(list) {
    for (const m of trophyMeshes) trophyGroup.remove(m);
    trophyMeshes = [];
    if (!Array.isArray(list)) return;
    for (const t of list) {
        dropTrophyLive(t.color, t.x, t.y, t.z);
    }
}

// ── PODIO FINALE ────────────────────────────────────
function _clamp01(x) { return Math.max(0, Math.min(1, x)); }
function _easeOutBack(x) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

// Testa "da impilare" nel colore-team (più leggibile della testa-trofeo a terra)
function makePodiumHead(color) {
    const g = new THREE.Group();
    const teamCol = new THREE.Color(color);
    const matSkin = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
    const matTeam = new THREE.MeshLambertMaterial({ color: teamCol.clone().multiplyScalar(0.7) });
    const matGun  = new THREE.MeshLambertMaterial({ color: 0x1c1c1c });
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), matSkin);
    face.castShadow = true; g.add(face);
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), matTeam);
    helm.position.y = 0.28; g.add(helm);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.10, 0.04), matGun);
    visor.position.set(0, 0.03, 0.24); g.add(visor);
    return g;
}

// Etichetta punteggio (sprite canvas) sopra ogni colonna
function makePointsLabel(pts, color) {
    const cvs = document.createElement('canvas');
    cvs.width = 256; cvs.height = 128;
    const c = cvs.getContext('2d');
    c.font = 'bold 76px Fredoka, Arial, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 8; c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.strokeText('💀 ' + pts, 128, 66);
    c.fillStyle = color;
    c.fillText('💀 ' + pts, 128, 64);
    const tex = new THREE.CanvasTexture(cvs);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(2.4, 1.2, 1);
    return sp;
}

// Costruisce il podio: ogni giocatore su una TORRE di teste alta quanto i suoi punti.
// Più teste = più in alto = vince (visualizza "chi ha la torre più alta").
function buildPodium(pointsMap) {
    while (podiumGroup.children.length) podiumGroup.remove(podiumGroup.children[0]);
    podiumHeads = [];
    podiumModels = [];

    const entries = Object.entries(pointsMap || {}).sort((a, b) => b[1] - a[1]);
    const n = entries.length;
    if (n === 0) { podiumAnim = null; return; }

    const SPACING = 3.2;
    const HEAD_H = 0.5;
    const HEAD_CAP = 14;            // teste max mostrate per torre (il numero esatto è nell'etichetta)
    const rowW = (n - 1) * SPACING;

    let maxTop = 0;
    let headOrder = 0;
    entries.forEach(([color, pts], i) => {
        const x = i * SPACING - rowW / 2;

        // Base/pedistallo
        const base = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 0.4, 1.5),
            new THREE.MeshLambertMaterial({ color: 0x161a20 })
        );
        base.position.set(x, PODIUM_Y + 0.2, 0);
        base.castShadow = true;
        podiumGroup.add(base);

        // Torre di teste (pop-in animato)
        const shown = Math.max(0, Math.min(pts, HEAD_CAP));
        for (let k = 0; k < shown; k++) {
            const head = makePodiumHead(color);
            head.position.set(x, PODIUM_Y + 0.4 + k * HEAD_H + HEAD_H / 2, 0);
            head.scale.setScalar(0.0001);
            head.userData.delay = 0.35 + headOrder * 0.05;
            podiumGroup.add(head);
            podiumHeads.push(head);
            headOrder++;
        }
        const towerTop = PODIUM_Y + 0.4 + shown * HEAD_H;

        // Modello del giocatore in cima alla torre
        const parts = createPlayerMesh(color, 'assault');
        parts.group.position.set(x, towerTop, 0);
        parts.group.rotation.y = Math.PI;   // fronte verso la camera (che è a +Z)
        parts.group.scale.setScalar(0.0001);
        parts.group.userData.delay = 0.35 + shown * 0.05 + 0.15;
        podiumGroup.add(parts.group);
        podiumModels.push(parts.group);

        // Etichetta punti
        const label = makePointsLabel(pts, color);
        label.position.set(x, towerTop + 2.5, 0);
        podiumGroup.add(label);

        maxTop = Math.max(maxTop, towerTop + 1.9);
    });

    // Inquadratura
    const span = maxTop - PODIUM_Y;
    const dist = Math.max(rowW * 0.8, span) + 7.5;
    podiumAnim = {
        start: performance.now(),
        dist,
        camY: PODIUM_Y + span * 0.55,
        lookY: PODIUM_Y + span * 0.4
    };
    podiumCamera.position.set(0, podiumAnim.camY, dist);
    podiumCamera.lookAt(0, podiumAnim.lookY, 0);
}

// Animazione del podio (chiamata dal loop in fase game_over)
function updatePodium(now) {
    const t = (now - podiumAnim.start) / 1000;
    for (const h of podiumHeads) {
        const p = _clamp01((t - h.userData.delay) / 0.28);
        h.scale.setScalar(Math.max(0.0001, _easeOutBack(p)));
    }
    for (const m of podiumModels) {
        const p = _clamp01((t - m.userData.delay) / 0.3);
        m.scale.setScalar(Math.max(0.0001, _easeOutBack(p)));
    }
    // Leggera oscillazione della camera per dare vita alla scena
    const ang = Math.sin(t * 0.28) * 0.5;
    podiumCamera.position.set(Math.sin(ang) * podiumAnim.dist, podiumAnim.camY, Math.cos(ang) * podiumAnim.dist);
    podiumCamera.lookAt(0, podiumAnim.lookY, 0);
}

// Healthbar: visibile solo se ferito, riempimento ancorato a sinistra, billboard verso la camera
const _camQuat = new THREE.Quaternion();
const _grpQuat = new THREE.Quaternion();
function updateHealthbar(rp) {
    if (!rp.hpBar) return;
    // "Alla Cieca": nessuna barra vita nemica (non sai quanto è ferito)
    if (gameState.mutator === 'blind_mode') { rp.hpBar.visible = false; return; }
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

// Anima un giocatore remoto: interpolazione posizione + ciclo gambe + postura
function updateRemoteAnim(rp, dt) {
    // ── Interpolazione posizione/rotazione dal buffer di snapshot ──
    const snaps = rp.snapshots;
    if (snaps && snaps.length > 0) {
        if (snaps.length === 1) {
            // Primo snapshot: applica subito in attesa del secondo
            const s = snaps[0];
            rp.group.position.set(s.x, s.y, s.z);
            rp.group.rotation.y = s.ry;
            if (rp.anim) {
                rp.anim.moving = s.mv; rp.anim.sprint = s.sp;
                rp.anim.crouch = s.cr; rp.anim.slide  = s.sl;
            }
        } else {
            const renderTime = performance.now() - INTERP_DELAY;
            // Mantieni il più recente snapshot ≤ renderTime + tutti i successivi
            while (snaps.length > 2 && snaps[1].t <= renderTime) snaps.shift();

            const s0 = snaps[0], s1 = snaps[1];
            if (s0.t !== s1.t) {
                const t = Math.max(0, Math.min(1, (renderTime - s0.t) / (s1.t - s0.t)));
                rp.group.position.set(
                    s0.x + (s1.x - s0.x) * t,
                    s0.y + (s1.y - s0.y) * t,
                    s0.z + (s1.z - s0.z) * t
                );
                // Rotazione: percorso angolare più breve (evita spin di 360°)
                const da = (s1.ry - s0.ry + Math.PI * 3) % (Math.PI * 2) - Math.PI;
                rp.group.rotation.y = s0.ry + da * t;
                // Stato animazione dall'ultimo snapshot "raggiunto"
                const sAnim = t >= 1 ? s1 : s0;
                if (rp.anim) {
                    rp.anim.moving = sAnim.mv; rp.anim.sprint = sAnim.sp;
                    rp.anim.crouch = sAnim.cr; rp.anim.slide  = sAnim.sl;
                }
            }
        }
    }

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

// Riceve uno stato remoto e lo accoda nel buffer di interpolazione
function applyRemoteState(rp, d) {
    if (!rp.snapshots) rp.snapshots = [];
    rp.snapshots.push({
        t: performance.now(),
        x: d.x, y: d.y, z: d.z, ry: d.ry,
        mv: !!d.mv, sp: !!d.sp, cr: !!d.cr, sl: !!d.sl
    });
    // Limita la coda (robustezza se la tab è in background a lungo)
    if (rp.snapshots.length > 60) rp.snapshots.splice(0, rp.snapshots.length - 30);
    // Arma: aggiorna subito (valore discreto, non interpolabile)
    if (d.wk) setRemoteWeapon(rp, d.wk);
}

// ══════════════════════════════════════════════════════
//  ARMA IN PRIMA PERSONA (viewport model)
// ══════════════════════════════════════════════════════
const weaponGroup = new THREE.Group();
camera.add(weaponGroup);

const weaponModels = {};

// Tutte le armi sono ancorate a destra (x≈0.08) e in basso (y≈-0.11),
// con la canna che punta in avanti (-z). Stile voxel ma con forma riconoscibile.
// Offset X destro arma FP. In ADS (non-sniper) il weaponGroup viene lerpato verso il
// centro (iron sights): offset 0.06-GX sul gruppo porta il totale a 0.06.
const GX = 0.24;

// Cache dei gltf.scene originali: riutilizzati (clonati) per le armi in terza persona
const _glbSceneCache = {};

// Barrel lungo +X nel modello Quaternius. ry=π/2 porta +X → -Z (forward in camera space).
// pos = [X, Y, Z_calcio_da_camera]. rz=-0.08: roll CW mostra più superficie superiore.
// Sniper: rz/rx ridotti (arma lunga già ben visibile con meno inclinazione).
const _WEAPON_GLB_CFG = {
    assault: { path: '/assets/guns/Assault Rifle.glb',  targetLen: 0.62, pos: [GX, -0.20, -0.18], rot: [0.08, Math.PI / 2, -0.08] },
    smg:     { path: '/assets/guns/Submachine Gun.glb', targetLen: 0.48, pos: [GX, -0.18, -0.16], rot: [0.08, Math.PI / 2, -0.08] },
    shotgun: { path: '/assets/guns/Shotgun.glb',        targetLen: 0.56, pos: [GX, -0.20, -0.18], rot: [0.08, Math.PI / 2, -0.08] },
    sniper:  { path: '/assets/guns/Sniper Rifle.glb',   targetLen: 0.82, pos: [GX, -0.22, -0.18], rot: [0.06, Math.PI / 2, -0.06] },
};

// Scala il modello e sposta il pivot al CALCIO (min.x) così il barrel si estende
// tutto in avanti (dalla posizione del gruppo verso -Z dopo la rotazione ry=π/2).
function _glbScaleAndPivot(obj, targetLen) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) obj.scale.setScalar(targetLen / maxDim);
    // Centra
    box.setFromObject(obj);
    const center = new THREE.Vector3();
    box.getCenter(center);
    obj.position.sub(center);
    // Sposta il pivot al calcio (min X = lato opposto alla canna che è a max X)
    box.setFromObject(obj);
    obj.position.x -= box.min.x;
}

// Converte i materiali GLB.
// Il GLTF loader converte baseColor sRGB→linear; con outputEncoding=Linear il colore
// appare scuro (manca la gamma correction in output). Invertiamo con pow(c, 1/2.2).
// useBasic=true → MeshBasicMaterial (FP, no luce necessaria);
// false → MeshLambertMaterial + emissive per TP.
function _glbApplyMaterials(obj, useBasic = false) {
    obj.traverse(child => {
        if (!child.isMesh) return;
        const mats = [].concat(child.material);
        child.material = mats.map(m => {
            const raw = m.color || new THREE.Color(0.5, 0.5, 0.5);
            const col = new THREE.Color(
                Math.pow(Math.max(0, raw.r), 1 / 2.2),
                Math.pow(Math.max(0, raw.g), 1 / 2.2),
                Math.pow(Math.max(0, raw.b), 1 / 2.2)
            );
            const params = {
                color: col,
                map: m.map || null,
                vertexColors: m.vertexColors || false,
                transparent: !!m.transparent,
                opacity: m.opacity ?? 1,
            };
            if (useBasic) return new THREE.MeshBasicMaterial(params);
            return new THREE.MeshLambertMaterial({
                ...params,
                emissive: col.clone().multiplyScalar(0.2),
            });
        });
        if (child.material.length === 1) child.material = child.material[0];
        if (!useBasic) child.castShadow = true;
    });
}

function buildWeaponModels() {
    const loader = new THREE.GLTFLoader();

    Object.entries(_WEAPON_GLB_CFG).forEach(([key, cfg]) => {
        const group = new THREE.Group();
        group.visible = false;
        weaponGroup.add(group);
        weaponModels[key] = group;

        loader.load(cfg.path, (gltf) => {
            _glbSceneCache[key] = gltf.scene;        // cache per le armi TP avversari

            const model = gltf.scene.clone(true);     // clone dedicato alla prima persona
            _glbScaleAndPivot(model, cfg.targetLen);
            _glbApplyMaterials(model, true);          // Basic: colori diretti senza luce
            group.position.set(...cfg.pos);
            group.rotation.set(...cfg.rot);
            group.add(model);
        }, undefined, err => {
            console.warn('[FPS] Caricamento GLB fallito:', cfg.path, err);
        });
    });
}

// ── Texture procedurali a 3 layer ──────────────────────────
// Layer 1 = colore base, Layer 2 = grana del materiale,
// Layer 3 = usura/graffi + bordi scuri (profondità).
// Niente file esterni: tutto generato su <canvas> e usato come map.
const _layeredTexCache = {};
function makeLayeredTexture(baseColor, kind) {
    const cacheKey = baseColor + '|' + kind;
    if (_layeredTexCache[cacheKey]) return _layeredTexCache[cacheKey];

    const S = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');

    const r = (baseColor >> 16) & 255, g = (baseColor >> 8) & 255, b = baseColor & 255;
    const shade = (f) => `rgb(${Math.max(0, Math.min(255, r * f | 0))},${Math.max(0, Math.min(255, g * f | 0))},${Math.max(0, Math.min(255, b * f | 0))})`;

    // ── Layer 1: base ──
    ctx.fillStyle = shade(1);
    ctx.fillRect(0, 0, S, S);

    // ── Layer 2: grana del materiale ──
    if (kind === 'wood') {
        // venature verticali
        for (let x = 0; x < S; x += 3) {
            ctx.fillStyle = shade(0.8 + Math.random() * 0.35);
            ctx.fillRect(x, 0, 2 + Math.random() * 2, S);
        }
    } else if (kind === 'metal') {
        // spazzolatura orizzontale
        for (let y = 0; y < S; y += 2) {
            ctx.fillStyle = shade(0.85 + Math.random() * 0.3);
            ctx.fillRect(0, y, S, 1);
        }
    } else { // polymer: grana fine puntinata
        for (let i = 0; i < 1400; i++) {
            ctx.fillStyle = shade(0.82 + Math.random() * 0.32);
            ctx.fillRect(Math.random() * S, Math.random() * S, 1, 1);
        }
    }

    // ── Layer 3: usura (graffi) + vignettatura bordi ──
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
        ctx.strokeStyle = shade(1.4 + Math.random() * 0.4);
        ctx.globalAlpha = 0.25 + Math.random() * 0.3;
        ctx.beginPath();
        const x0 = Math.random() * S, y0 = Math.random() * S;
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + (Math.random() - 0.5) * S * 0.6, y0 + (Math.random() - 0.5) * S * 0.6);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // bordi scuri per dare volume ai box
    const grad = ctx.createRadialGradient(S / 2, S / 2, S * 0.25, S / 2, S / 2, S * 0.7);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);

    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    _layeredTexCache[cacheKey] = tex;
    return tex;
}

function makeViewBox(w, h, d, x, y, z, color, kind) {
    const matOpts = { color: 0xffffff };
    if (kind) matOpts.map = makeLayeredTexture(color, kind);
    else matOpts.color = color;
    const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshLambertMaterial(matOpts)
    );
    m.position.set(x, y, z);
    return m;
}

// Parte cilindrica orientata lungo l'asse Z (canne, ottica). r128: solo CylinderGeometry.
function makeViewCyl(radius, len, x, y, z, color, kind) {
    const matOpts = { color: 0xffffff };
    if (kind) matOpts.map = makeLayeredTexture(color, kind);
    else matOpts.color = color;
    const m = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, len, 12),
        new THREE.MeshLambertMaterial(matOpts)
    );
    m.rotation.x = Math.PI / 2; // asse Y → Z
    m.position.set(x, y, z);
    return m;
}

buildWeaponModels();

// ── Braccio destro FP ──────────────────────────────────────────────────────────
// Figlio di weaponGroup → si muove automaticamente col bob e col lerp ADS iron sights.
// Posizioni relative all'origine di weaponGroup (= camera); stock arma è a [GX, y, z].
(function buildFPArm() {
    // guanto tattico scuro (lo stesso stile del modello giocatore)
    const matGlv  = new THREE.MeshBasicMaterial({ color: 0x1a1816 });
    const matSkin = new THREE.MeshBasicMaterial({ color: 0xd9a066 });

    // Mano destra all'impugnatura: centrata sul grip medio di tutte le armi
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.12), matGlv);
    hand.position.set(GX, -0.22, -0.40);
    hand.rotation.set(0.08, 0, -0.08);
    weaponGroup.add(hand);

    // Nocche/dorso mano leggermente a vista (striscia skin sopra il guanto)
    const knuckles = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.025, 0.06), matSkin);
    knuckles.position.set(GX, -0.185, -0.39);
    knuckles.rotation.set(0.08, 0, -0.08);
    weaponGroup.add(knuckles);

    // Avambraccio destro: emerge da fuori schermo (basso-destra) verso l'impugnatura.
    // rx=-0.40 → estremità -Z punta verso il grip (z≈-0.37), estremità +Z verso il basso
    // (z≈+0.07 = fuori schermo in basso).
    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.095, 0.50), matGlv);
    forearm.position.set(GX + 0.03, -0.46, -0.15);
    forearm.rotation.set(-0.40, 0, 0.08);
    weaponGroup.add(forearm);
})();

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

// Nessun prompt: la visuale resta libera. Un click sulla scena cattura il mouse.
canvas.addEventListener('click', () => {
    Sfx.resume();
    if (!pointerLocked && gameState.phase === 'playing' && !gameState.isDead) {
        canvas.requestPointerLock();
    }
});

document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
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
    'ShiftLeft', 'ShiftRight', 'Tab'
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
    if (e.code === 'Tab') {
        GamepadInput.togglePanel();
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

    // bestKey = criterio di scelta (con bias verso la testa nei casi di parità);
    // bestDist = distanza reale del colpo scelto (serve al check muro).
    const HEAD_BIAS = 0.2;      // la testa vince se entro 0.2m dal corpo lungo il raggio
    let bestKey = Infinity;
    let bestDist = Infinity;
    let bestColor = null;
    let bestHead = false;       // il colpo migliore ha centrato la testa?

    for (const [color, rp] of Object.entries(gameState.players)) {
        if (rp.dead) continue;

        // Hitbox = CAPSULA VERTICALE (piedi→testa), campionata a sfere lungo il corpo:
        // così mirando a testa/gambe/torso da vicino si colpisce sempre.
        // L'altezza si abbassa in base alla postura (crouch/slide).
        const a = rp.anim;
        let y0 = 0.30, y1 = 1.75, r = 0.42;
        if (a && a.slide) { y0 = 0.20; y1 = 0.95; r = 0.42; }
        else if (a && a.crouch) { y0 = 0.30; y1 = 1.20; r = 0.44; }
        // Mini Giocatori: il modello remoto è scalato, quindi scala anche la hitbox
        if (sizeMul !== 1) { y0 *= sizeMul; y1 *= sizeMul; r *= sizeMul; }

        const px = rp.group.position.x, py = rp.group.position.y, pz = rp.group.position.z;

        // ── Corpo: capsula a sfere (NON conta come headshot) ──
        const steps = Math.max(1, Math.ceil((y1 - y0) / r));
        for (let i = 0; i <= steps; i++) {
            const cy = py + y0 + (y1 - y0) * (i / steps);
            const tx = px - origin.x, ty = cy - origin.y, tz = pz - origin.z;
            const proj = tx * dir.x + ty * dir.y + tz * dir.z;
            if (proj <= 0 || proj > w.range) continue;     // dietro di noi o fuori range
            const perp2 = Math.max(0, (tx * tx + ty * ty + tz * tz) - proj * proj);
            if (perp2 < r * r && proj < bestKey) {
                bestKey = proj;
                bestDist = proj;
                bestColor = color;
                bestHead = false;
            }
        }

        // ── Testa: sfera dedicata → headshot (più danno). Ingrandita col mutatore
        // "Teste Giganti" così le headshot diventano facilissime. Con HEAD_BIAS la
        // testa ha la priorità sulla sfera-corpo in cima, quasi sovrapposta.
        const headBase = (gameState.mutator === 'giant_heads') ? 0.6
                       : (gameState.mutator === 'headshot_only') ? 0.34   // un filo più permissiva
                       : 0.28;
        const headR = headBase * sizeMul;
        const headCy = py + y1 - 0.10 * sizeMul;   // centro testa, segue postura e taglia
        {
            const tx = px - origin.x, ty = headCy - origin.y, tz = pz - origin.z;
            const proj = tx * dir.x + ty * dir.y + tz * dir.z;
            if (proj > 0 && proj <= w.range) {
                const perp2 = Math.max(0, (tx * tx + ty * ty + tz * tz) - proj * proj);
                if (perp2 < headR * headR && (proj - HEAD_BIAS) < bestKey) {
                    bestKey = proj - HEAD_BIAS;
                    bestDist = proj;
                    bestColor = color;
                    bestHead = true;
                }
            }
        }
    }

    // Colpo valido solo se il nemico è davanti al muro (niente colpi attraverso i muri)
    if (bestColor && bestDist <= tracerDist) {
        tracerDist = bestDist;
        // Niente feedback di colpo quando: "Solo Headshot" e colpo al corpo (0 danno),
        // oppure "Alla Cieca" (non devi sapere se hai colpito)
        const noConfirm = (gameState.mutator === 'headshot_only' && !bestHead)
                       || gameState.mutator === 'blind_mode';
        if (!noConfirm) {
            showHitmarker(false, bestHead);
            Sfx.hitConfirm();
            // Schizzo di sangue sul punto colpito (più abbondante sulle headshot)
            spawnParticles(origin.clone().addScaledVector(dir, bestDist), 0xcc1111, bestHead ? 14 : 9,
                { speed: 3.5, gravity: 11, size: 0.06, life: 380 });
        }
        socket.emit('reportHit', {
            lobbyId: LOBBY_ID,
            shooterColor: MY_COLOR,
            targetColor: bestColor,
            weaponKey: gameState.myWeapon,
            headshot: bestHead
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
function showHitmarker(isKill, isHead) {
    const hm = document.getElementById('hitmarker');
    hm.classList.remove('show', 'kill', 'head');
    void hm.offsetWidth; // reflow per riavviare l'animazione
    if (isKill) hm.classList.add('kill');
    else if (isHead) hm.classList.add('head');   // headshot: marker distinto
    hm.classList.add('show');
    clearTimeout(hitmarkerTimeout);
    hitmarkerTimeout = setTimeout(() => hm.classList.remove('show', 'kill', 'head'), 260);
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
    const head = footY + PLAYER_HEIGHT * sizeMul;   // sizeMul: mutatore "Mini Giocatori"
    const rad = PLAYER_RADIUS * sizeMul;
    for (const b of solidBoxes) {
        if (b === ignoreBox) continue;
        if (x + rad <= b.min.x || x - rad >= b.max.x) continue;
        if (z + rad <= b.min.z || z - rad >= b.max.z) continue;
        if (b.min.y < head - 0.05 && b.max.y > bodyBottom + 0.05) return false;
    }
    return true;
}

function resolveCollisions(pos) {
    const H = PLAYER_HEIGHT * sizeMul;   // sizeMul: mutatore "Mini Giocatori"
    const rad = PLAYER_RADIUS * sizeMul;
    for (const box of solidBoxes) {
        // Scarta box che non si sovrappongono verticalmente al player
        if (pos.y >= box.max.y || pos.y + H <= box.min.y) continue;

        const overlapXL = (pos.x + rad) - box.min.x;
        const overlapXR = box.max.x - (pos.x - rad);
        const overlapZF = (pos.z + rad) - box.min.z;
        const overlapZB = box.max.z - (pos.z - rad);

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
let _wadsX = 0, _wadsY = 0, _wadsZ = 0;  // lerp ADS iron-sights offset

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

    // Gamepad: leggi stato movimento (additivato con tastiera, non esclusivo)
    const gp = GamepadInput.getState();
    const gpFwd = gp.moveY < -0.1;
    const gpBck = gp.moveY >  0.1;
    const gpRgt = gp.moveX >  0.1;
    const gpLft = gp.moveX < -0.1;

    _moveDir.set(0, 0, 0);
    if (keys['KeyW'] || gpFwd) _moveDir.addScaledVector(_fwd,   1);
    if (keys['KeyS'] || gpBck) _moveDir.addScaledVector(_fwd,  -1);
    if (keys['KeyD'] || gpRgt) _moveDir.addScaledVector(_right,  1);
    if (keys['KeyA'] || gpLft) _moveDir.addScaledVector(_right, -1);

    if (_moveDir.lengthSq() > 0) _moveDir.normalize();

    const pos = playerRoot.position;

    // ── Determinazione stati: crouch, sprint, avvio slide ──
    const moving = _moveDir.lengthSq() > 0;
    const movingFwd = !!(keys['KeyW'] || gpFwd);
    const wantCrouch = !!(keys['KeyC'] || gp.crouch);
    const wantSprintKey = !!(keys['ShiftLeft'] || keys['ShiftRight'] || gp.sprint);
    isSprinting = wantSprintKey && movingFwd && moving && onGround && !wantCrouch && !isADS && !isSliding;

    // Avvio slide: stavo sprintando e premo crouch (fronte di salita del tasto)
    const crouchPressed = wantCrouch && !_prevCrouch;
    if (crouchPressed && wantSprintKey && movingFwd && moving && onGround && !isSliding) {
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
        speed *= speedMul;   // mutatore "Velocità x2"
        pos.x += _moveDir.x * speed * dt;
        pos.z += _moveDir.z * speed * dt;
    }
    isCrouching = wantCrouch && !isSliding;
    isMoving = moving;

    // Gravità (gravityMul: mutatore "Gravità lunare")
    const prevY = pos.y;
    velocityY -= GRAVITY * gravityMul * dt;
    velocityY = Math.max(velocityY, -20 * gravityMul); // terminal velocity (più lenta se gravità bassa)
    pos.y += velocityY * dt;

    onGround = false;

    if (pos.y <= 0) {
        pos.y = 0;
        velocityY = 0;
        onGround = true;
    } else if (velocityY <= 0) {
        // Atterraggio sulla superficie superiore dei box
        const rad = PLAYER_RADIUS * sizeMul;   // sizeMul: mutatore "Mini Giocatori"
        for (const box of solidBoxes) {
            if (pos.x + rad <= box.min.x || pos.x - rad >= box.max.x) continue;
            if (pos.z + rad <= box.min.z || pos.z - rad >= box.max.z) continue;
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
    const targetEye = (isSliding ? SLIDE_EYE : isCrouching ? CROUCH_EYE : STAND_EYE) * sizeMul;
    currentEyeH += (targetEye - currentEyeH) * Math.min(1, dt * 12);
    camera.position.y = currentEyeH;

    // Roll della camera durante la slide (feeling di scivolata)
    const targetRoll = isSliding ? 0.13 : 0;
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 10);

    // Rotazione camera (mira + rinculo + shake). yaw/pitch "puri" restano per il netcode.
    playerRoot.rotation.y = yaw + recoilYaw + shX;
    camera.rotation.x = pitch + recoilPitch + shY;
    camera.rotation.z = shZ + cameraRoll;

    // Weapon bob (più ampio/rapido in corsa) + kick del rinculo + lerp ADS iron sights
    const bobAmp = isSprinting ? 1.8 : 1;
    const bobRate = isSprinting ? 11 : 8;
    const speed = isMoving ? 1 : 0;
    const t = Date.now() / 1000;
    const bobFactor = isADS ? 0.1 : 1;   // quasi zero bob mentre si mira

    // Iron sights: porta il viewmodel quasi al centro (non sniper → scope CSS)
    const adsActive = isADS && gameState.myWeapon !== 'sniper';
    _wadsX += ((adsActive ? 0.06 - GX : 0) - _wadsX) * 0.15;
    _wadsY += ((adsActive ? 0.10    : 0) - _wadsY) * 0.15;
    _wadsZ += ((adsActive ? -0.18   : 0) - _wadsZ) * 0.15;

    weaponGroup.position.x = Math.sin(t * bobRate) * 0.008 * bobAmp * speed * bobFactor + _wadsX;
    weaponGroup.position.y = Math.abs(Math.sin(t * bobRate)) * 0.006 * bobAmp * speed * bobFactor + weaponKick * 0.01 + _wadsY;
    weaponGroup.position.z = weaponKick * 0.06 + _wadsZ;
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

    // Giocatori remoti — nascosti dal radar durante Nebbia Fitta e Blackout
    // (altrimenti la minimappa vanificherebbe la ridotta visibilità del mutatore)
    const mut = gameState.mutator;
    const hideEnemyDots = mut === 'fog' || mut === 'blackout';
    for (const [color, rp] of Object.entries(gameState.players)) {
        if (rp.dead || hideEnemyDots) continue;
        // "Radar Sonar": appari sul radar SOLO se in movimento e NON accovacciato
        // (fermo o in crouch = invisibile al radar)
        if (mut === 'sonar' && !(rp.anim && rp.anim.moving && !rp.anim.crouch)) continue;
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
    // Ordina per punti (teste) decrescenti: la classifica live della partita
    const rows = Object.entries(gameState.points);
    rows.sort((a, b) => b[1] - a[1]);
    for (const [color, pts] of rows) {
        const row = document.createElement('div');
        row.className = 'hud-score-row' + (color === MY_COLOR ? ' me' : '');
        row.innerHTML = `
            <div class="hud-score-dot" style="background:${color}"></div>
            <span style="color:${color}">${color === MY_COLOR ? 'YOU' : ''}</span>
            <span class="hud-score-wins">💀 ${pts}</span>`;
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
        mv: isMoving, sp: isSprinting, cr: isCrouching, sl: isSliding,
        wk: gameState.myWeapon
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
        const parts = createPlayerMesh(data.color, data.wk);
        parts.group.scale.setScalar(sizeMul);   // mutatore "Mini Giocatori"
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
    gameState.points = data.points || {};
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
    gameState.points = data.points || gameState.points;
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

socket.on('playerHit', ({ targetColor, hp, shooterColor, damage, heal }) => {
    if (targetColor === MY_COLOR) {
        gameState.myHp = hp;
        updateHpHUD(hp);
        if (heal) {
            // Cura (es. Vampirismo): niente vignetta/suono di ferita
            Sfx.respawn ? Sfx.respawn() : null;
        } else {
            showDamageVignette();
            showDamageDirection(shooterColor);
            addShake(0.45);
            Sfx.hurt();
        }
    }
    if (gameState.players[targetColor]) {
        // Aggiorna HP del giocatore remoto (per eventuale healthbar sopra la testa)
        gameState.players[targetColor].hp = hp;
    }
});

socket.on('playerKilled', ({ killedColor, killerColor, aliveCount, subphase, points }) => {
    addKillfeed(killerColor, killedColor);

    // Aggiorna i punti live (il +1 per kill compare subito in HUD)
    if (points) { gameState.points = points; updateScoreHUD(); }

    // Hitmarker rosso "kill" se l'uccisione è mia
    if (killerColor === MY_COLOR && killedColor !== MY_COLOR) {
        showHitmarker(true);
        Sfx.killConfirm();
    }

    // In SUDDEN DEATH ogni caduto lascia la testa sul punto di morte (feedback immediato;
    // sarà comunque ricostruita dalla lista autoritativa del server a inizio round).
    if (subphase === 'suddendeath') {
        if (killedColor === MY_COLOR) {
            const p = playerRoot.position;
            dropTrophyLive(MY_COLOR, p.x, p.y, p.z);
        } else if (gameState.players[killedColor]) {
            const p = gameState.players[killedColor].group.position;
            dropTrophyLive(killedColor, p.x, p.y, p.z);
        }
    }

    if (killedColor === MY_COLOR) {
        gameState.isDead = true;
        Sfx.death();
        exitADS();
        const ds = document.getElementById('dead-screen');
        const sub = ds.querySelector('p');
        if (sub) sub.textContent = (subphase === 'melee') ? 'Respawning…' : 'Waiting for round to end…';
        ds.classList.add('active');
        // In mischia si rinasce subito: si TIENE il pointer lock (niente click per rientrare).
        // In sudden death la morte è definitiva: si rilascia il mouse.
        if (subphase !== 'melee') document.exitPointerLock();
        if (weaponGroup) weaponGroup.visible = false;
    }

    if (gameState.players[killedColor]) {
        gameState.players[killedColor].dead = true;
        gameState.players[killedColor].group.visible = false;
    }
});

// Rinascita in mischia: rientro istantaneo su uno spawn point
socket.on('playerRespawn', ({ color, x, y, z, angle, hp, weaponKey, ammo }) => {
    if (color === MY_COLOR) {
        gameState.isDead = false;
        gameState.myHp = hp;
        playerRoot.position.set(x, y, z);
        playerRoot.rotation.y = angle || 0;
        yaw = angle || 0;
        pitch = 0;
        velocityY = 0;
        onGround = true;

        // Reset postura/stati movimento (come allo spawn di round)
        isSliding = isCrouching = isSprinting = isMoving = airSprint = false;
        slideTimer = 0;
        currentEyeH = STAND_EYE * sizeMul;
        camera.position.y = STAND_EYE * sizeMul;
        cameraRoll = 0;
        camera.rotation.z = 0;

        isReloading = false;
        if (ammo != null) { gameState.myAmmo = ammo; applyAmmoCap(); }
        updateHpHUD(hp);
        document.getElementById('dead-screen').classList.remove('active');
        if (weaponGroup) weaponGroup.visible = true;
        Sfx.respawn ? Sfx.respawn() : Sfx.roundStart();
    } else {
        const rp = gameState.players[color];
        if (rp) {
            rp.dead = false;
            rp.hp = hp;
            rp.group.visible = true;
            rp.group.position.set(x, y, z);
            rp.snapshots = [];   // scarta i frame di posizione pre-morte
        }
    }
});

// Passaggio a SUDDEN DEATH: respawn OFF, tutti vivi e a piena vita
socket.on('suddenDeathStart', (data) => {
    gameState.subphase = 'suddendeath';

    const me = data.players[MY_COLOR];
    if (me) {
        gameState.myHp = me.hp;
        updateHpHUD(me.hp);
        if (gameState.isDead) {
            // Ero in respawn allo scoccare del sudden death → rientro un'ultima volta
            gameState.isDead = false;
            playerRoot.position.set(me.x, me.y, me.z);
            playerRoot.rotation.y = me.angle || 0;
            yaw = me.angle || 0;
            pitch = 0;
            velocityY = 0;
            onGround = true;
            isSliding = isCrouching = isSprinting = isMoving = airSprint = false;
            slideTimer = 0;
            currentEyeH = STAND_EYE * sizeMul;
            camera.position.y = STAND_EYE * sizeMul;
            cameraRoll = 0;
            camera.rotation.z = 0;
            document.getElementById('dead-screen').classList.remove('active');
            if (weaponGroup) weaponGroup.visible = true;
        }
    }

    // Riporta visibili gli avversari e cura tutti a piena vita
    for (const [color, ps] of Object.entries(data.players)) {
        if (color === MY_COLOR) continue;
        const rp = gameState.players[color];
        if (!rp) continue;
        const wasDead = rp.dead;
        rp.dead = false;
        rp.hp = ps.hp;
        rp.group.visible = true;
        if (wasDead) {
            // Era in respawn: riposiziona sullo spawn dato dal server
            rp.group.position.set(ps.x, ps.y, ps.z);
            rp.snapshots = [];
        }
    }

    showSuddenDeathBanner();
    Sfx.suddenDeath ? Sfx.suddenDeath() : Sfx.roundStart();
});

socket.on('playerLeft', ({ color }) => {
    const rp = gameState.players[color];
    if (rp) {
        scene.remove(rp.group);   // la healthbar è figlia del group → rimossa con esso
        delete gameState.players[color];
    }
    if (gameState.scores[color] !== undefined) {
        delete gameState.scores[color];
        if (gameState.points) delete gameState.points[color];
        updateScoreHUD();
    }
});

socket.on('roundEnd', (data) => {
    gameState.scores = data.scores;
    if (data.points) gameState.points = data.points;
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

// ── Indicatore di fase del round (MISCHIA con countdown / SUDDEN DEATH) ──
let meleeCountdownInterval = null;

function showPhaseIndicator(kind, durationMs) {
    const el = document.getElementById('phase-indicator');
    if (!el) return;
    clearInterval(meleeCountdownInterval);
    if (kind === 'melee') {
        let remaining = Math.ceil((durationMs || 60000) / 1000);
        el.className = 'melee';
        el.textContent = `⚔ MISCHIA · ${remaining}s`;
        el.style.display = 'block';
        meleeCountdownInterval = setInterval(() => {
            remaining--;
            el.textContent = `⚔ MISCHIA · ${Math.max(0, remaining)}s`;
            if (remaining <= 0) clearInterval(meleeCountdownInterval);
        }, 1000);
    }
}

function hidePhaseIndicator() {
    clearInterval(meleeCountdownInterval);
    const el = document.getElementById('phase-indicator');
    if (el) el.style.display = 'none';
}

function showSuddenDeathBanner() {
    // Aggiorna la pill in alto
    clearInterval(meleeCountdownInterval);
    const el = document.getElementById('phase-indicator');
    if (el) {
        el.className = 'suddendeath';
        el.textContent = '☠ SUDDEN DEATH';
        el.style.display = 'block';
    }
    // Flash a schermo intero
    const banner = document.getElementById('sudden-death-banner');
    if (banner) {
        banner.classList.remove('show');
        void banner.offsetWidth; // forza il restart dell'animazione
        banner.classList.add('show');
        setTimeout(() => banner.classList.remove('show'), 2200);
    }
}

// ── MUTATORI ────────────────────────────────────────
// Metadati per il reveal a schermo (nome/icona/descrizione)
const MUTATOR_INFO = {
    moon_gravity: { name: 'Gravità Lunare', icon: '🌙', desc: 'Salti altissimi!',    col: '#8fb7ff' },
    speed_x2:     { name: 'Velocità x2',    icon: '⚡', desc: 'Tutti velocissimi!',  col: '#ffd84b' },
    fog:          { name: 'Nebbia Fitta',   icon: '🌫️', desc: 'Visibilità ridotta',  col: '#c3ccd6' },
    giant_heads:  { name: 'Teste Giganti',  icon: '💀', desc: 'Mira alla testa!',    col: '#ff7bd0' },
    blackout:     { name: 'Blackout',       icon: '🕶️', desc: 'Buio pesto, luce sull\'arma', col: '#3a3f52' },
    double_damage:{ name: 'TTK Dimezzato',  icon: '🎯', desc: 'Danno raddoppiato!',  col: '#ff5a3c' },
    one_in_chamber:{ name: 'Un Colpo in Canna', icon: '🔫', desc: '1 pallottola, uccide subito', col: '#e0c46a' },
    mini_players: { name: 'Mini Giocatori', icon: '🐜', desc: 'Bersagli minuscoli',  col: '#7bd0ff' },
    vampirism:    { name: 'Vampirismo',     icon: '🩸', desc: 'Uccidi per curarti',  col: '#a11d2e' },
    headshot_only:{ name: 'Solo Headshot',  icon: '🎯', desc: 'Conta solo la testa', col: '#ff5a3c' },
    flicker_invis:{ name: 'Fantasmi',       icon: '👻', desc: 'Nemici che lampeggiano', col: '#b9c6ff' },
    blind_mode:   { name: 'Alla Cieca',     icon: '🕶️', desc: 'Nessun segnale di colpo', col: '#6b7280' },
    sonar:        { name: 'Radar Sonar',    icon: '🛰️', desc: 'Fermo = invisibile al radar', col: '#54e0a0' }
};

// Applica l'effetto del mutatore. Chiamata a ogni inizio round: resetta SEMPRE
// prima ai valori di default, poi applica quello attivo (null = round normale).
function applyMutator(id) {
    // Reset di tutti gli effetti
    gravityMul = 1;
    speedMul = 1;
    headScale = 1;
    ammoCap = Infinity;
    sizeMul = 1;
    scene.fog.color.setHex(DEFAULT_SKY);
    scene.fog.density = DEFAULT_FOG_DENSITY;
    renderer.setClearColor(DEFAULT_SKY);
    // Ripristina luci e spegni la torcia (usate da "Blackout")
    ambient.intensity = DEFAULT_LIGHTS.ambient;
    sun.intensity = DEFAULT_LIGHTS.sun;
    hemi.intensity = DEFAULT_LIGHTS.hemi;
    flashlight.intensity = 0;

    switch (id) {
        case 'moon_gravity':
            gravityMul = 0.3;   // salti alti e cadute lente
            break;
        case 'speed_x2':
            speedMul = 1.8;     // corsa frenetica (taratura in localhost)
            break;
        case 'fog':
            scene.fog.color.setHex(0x9aa3ad);
            scene.fog.density = 0.05;
            renderer.setClearColor(0x9aa3ad);
            break;
        case 'giant_heads':
            headScale = 2.5;    // teste enormi (taratura in localhost)
            break;
        case 'blackout':
            ambient.intensity = 0.08;
            hemi.intensity = 0.05;
            sun.intensity = 0.15;
            scene.fog.color.setHex(0x05070d);
            scene.fog.density = 0.06;
            renderer.setClearColor(0x05070d);
            flashlight.intensity = 3.0;   // cono di luce dall'arma
            break;
        case 'one_in_chamber':
            ammoCap = 1;   // 1 sola pallottola in canna → ricarica dopo ogni colpo
            break;
        case 'mini_players':
            sizeMul = 0.5;   // tutti a metà taglia (taratura in localhost)
            break;
        // 'double_damage' non ha effetti client oltre al reveal (danno gestito dal server)
    }
}

// Applica il cap munizioni del mutatore (chiamata DOPO che lo spawn imposta myMaxAmmo)
function applyAmmoCap() {
    if (ammoCap < gameState.myMaxAmmo) gameState.myMaxAmmo = ammoCap;
    if (gameState.myAmmo > gameState.myMaxAmmo) gameState.myAmmo = gameState.myMaxAmmo;
    updateAmmoHUD();
}

let mutatorRevealTimer = null;

// Reveal a schermo ~2s (non bloccante) + stinger audio
function showMutatorReveal(id) {
    const info = MUTATOR_INFO[id];
    const el = document.getElementById('mutator-reveal');
    if (!info || !el) return;
    el.style.setProperty('--mr-col', info.col);
    el.innerHTML = `
        <div class="mr-label">MUTATORE</div>
        <div class="mr-icon">${info.icon}</div>
        <div class="mr-name">${info.name}</div>
        <div class="mr-desc">${info.desc}</div>`;
    el.classList.remove('show');
    void el.offsetWidth; // restart animazione
    el.classList.add('show');
    Sfx.revealStinger ? Sfx.revealStinger() : Sfx.roundStart();
    clearTimeout(mutatorRevealTimer);
    mutatorRevealTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function handleRoundStart(data) {
    gameState.phase = 'playing';
    gameState.currentRound = data.round || data.currentRound || gameState.currentRound;
    gameState.isDead = false;
    gameState.subphase = data.subphase || 'melee';
    gameState.mutator = data.mutator || null;
    if (data.points) gameState.points = data.points;
    applyMutator(gameState.mutator);   // resetta e applica l'effetto del round

    // Trofei-teste: ricostruisce dal server la lista persistente (accumulata nei round)
    renderTrophies(data.trophyHeads);

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
            currentEyeH = STAND_EYE * sizeMul;
            camera.position.y = STAND_EYE * sizeMul;
            cameraRoll = 0;
            camera.rotation.z = 0;

            const w = (data.weapons || gameState.weapons)[pState.weaponKey];
            gameState.myWeapon = pState.weaponKey;
            gameState.myAmmo = pState.ammo;
            gameState.myMaxAmmo = pState.maxAmmo || (w ? w.ammo : 30);
            applyAmmoCap();   // mutatore "Un Colpo in Canna"
            gameState.myHp = 100;

            switchWeaponModel(pState.weaponKey);
            document.getElementById('hud-weapon-name').textContent =
                w ? w.name : pState.weaponKey;
            updateAmmoHUD();
            updateHpHUD(100);

        } else {
            const parts = createPlayerMesh(color, pState.weaponKey);
            parts.group.position.set(pState.x, pState.y, pState.z);
            parts.group.scale.setScalar(sizeMul);   // mutatore "Mini Giocatori"
            scene.add(parts.group);
            gameState.players[color] = { ...parts, hp: 100, dead: false, anim: makeAnim() };
        }
    }

    updateRoundHUD();
    updateScoreHUD();
    Sfx.roundStart();

    // Indicatore fase: la MISCHIA mostra un countdown, poi scatta il sudden death
    if (gameState.subphase === 'melee') {
        showPhaseIndicator('melee', data.meleeDuration || 60000);
    } else {
        hidePhaseIndicator();
    }

    // Reveal del mutatore del round
    if (gameState.mutator) showMutatorReveal(gameState.mutator);

    document.getElementById('overlay').classList.remove('active');
    document.getElementById('dead-screen').classList.remove('active');
    if (weaponGroup) weaponGroup.visible = true;
}

let overlayCountdownInterval = null;

function showRoundEndOverlay(data) {
    gameState.phase = 'round_end';
    gameState.subphase = null;
    gameState.mutator = null;
    applyMutator(null);   // rimuove gli effetti (nebbia, gravità, velocità) tra un round e l'altro
    hidePhaseIndicator();
    document.exitPointerLock();

    const box = document.getElementById('overlay-box');
    const title = document.getElementById('overlay-title');
    const main = document.getElementById('overlay-main');
    const scoresEl = document.getElementById('overlay-scores');
    const btn = document.getElementById('overlay-btn');
    const cd = document.getElementById('overlay-cd-val');

    title.textContent = `Round ${data.round} of ${data.totalRounds} — Over`;

    if (data.winnerColor) {
        const bonusTxt = data.sdBonus ? ` (+${data.sdBonus} 💀)` : '';
        main.textContent = data.winnerColor === MY_COLOR ? `🏆 You Win!${bonusTxt}` : 'Round Lost';
        main.style.color = data.winnerColor === MY_COLOR ? 'var(--col-accent)' : 'var(--col-danger)';
    } else {
        main.textContent = 'Draw';
        main.style.color = 'var(--col-muted)';
    }

    scoresEl.innerHTML = '';
    const ptsList = Object.entries(data.points || data.scores).sort((a, b) => b[1] - a[1]);
    for (const [color, pts] of ptsList) {
        const row = document.createElement('div');
        row.className = 'overlay-score-row' + (color === data.winnerColor ? ' winner' : '');
        row.innerHTML = `
            <div class="overlay-score-color" style="background:${color}"></div>
            <span style="color:${color}">${color === MY_COLOR ? 'YOU' : color.slice(0, 7)}</span>
            <span class="overlay-score-wins">💀 ${pts}</span>`;
        scoresEl.appendChild(row);
    }

    btn.style.display = 'none';
    document.getElementById('overlay-countdown').style.display = 'block';

    let sec = Math.max(1, Math.ceil((data.nextInMs || 2500) / 1000));
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
    gameState.subphase = null;
    hidePhaseIndicator();
    document.exitPointerLock();

    // ── Podio finale 3D: torri di teste + modelli, camera dedicata ──
    buildPodium(data.points || {});
    activeCamera = podiumCamera;
    scene.fog.density = 0;                 // niente nebbia sul podio (la pagina si ricarica al ritorno lobby)
    document.body.classList.add('podium-mode');
    document.getElementById('overlay').classList.add('podium');
    if (weaponGroup) weaponGroup.visible = false;

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
    const sorted = Object.entries(data.points || data.scores).sort((a, b) => b[1] - a[1]);
    for (const [color, pts] of sorted) {
        const row = document.createElement('div');
        row.className = 'overlay-score-row' + (color === data.champion ? ' winner' : '');
        row.innerHTML = `
            <div class="overlay-score-color" style="background:${color}"></div>
            <span style="color:${color}">${color === MY_COLOR ? 'YOU' : color.slice(0, 7)}</span>
            <span class="overlay-score-wins">💀 ${pts}</span>`;
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
    if (gameState.phase !== 'playing' || gameState.isDead) return;
    broadcastState();
    socket.emit('playerState', {
        lobbyId: LOBBY_ID,
        color: MY_COLOR,
        x: playerRoot.position.x,
        y: playerRoot.position.y,
        z: playerRoot.position.z,
        ry: yaw,
        mv: isMoving, sp: isSprinting, cr: isCrouching, sl: isSliding,
        wk: gameState.myWeapon
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

// ── Registra le callbacks del gamepad (funzioni già hoistate) ──
GamepadInput.setCallbacks({
    onFire:       tryShoot,
    onADS:        enterADS,
    onADSRelease: exitADS,
    onReload:     () => { if (!isReloading && gameState.myAmmo < gameState.myMaxAmmo) startReload(); },
    getWeapon:    () => gameState.weapons[gameState.myWeapon]
});

// Mutatore "Fantasmi": i modelli remoti diventano semitrasparenti con opacità
// pulsante, sfasata per colore (così non "respirano" all'unisono). Restano sempre
// un filo visibili ma difficili da mirare. Fuori dal mutatore ripristina l'opacità.
function _flickerPhase(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return (h % 1000) / 1000 * Math.PI * 2;   // [0, 2π)
}
function setGroupOpacity(group, op) {
    group.traverse(o => {
        if (!o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { m.transparent = op < 1; m.opacity = op; }
    });
}
function applyFlicker() {
    const flick = (gameState.mutator === 'flicker_invis');
    const t = Date.now();
    for (const [color, rp] of Object.entries(gameState.players)) {
        if (rp.dead) continue;
        if (flick) {
            const op = 0.36 + 0.24 * Math.sin(t / 260 + _flickerPhase(color)); // ~0.12–0.60
            setGroupOpacity(rp.group, op);
            rp._ghosted = true;
        } else if (rp._ghosted) {
            setGroupOpacity(rp.group, 1);   // ripristino opacità quando non è attivo
            rp._ghosted = false;
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // ── Gamepad: poll e applicazione look + jump ──
    const { lookX, lookY, jumpPressed } = GamepadInput.poll(dt);
    if (gameState.phase === 'playing' && !gameState.isDead) {
        if (lookX !== 0 || lookY !== 0) {
            const adsFactor = isADS ? (camera.fov / 75) : 1;
            yaw   -= lookX * adsFactor;
            pitch -= lookY * adsFactor;
            pitch  = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, pitch));
        }
        if (jumpPressed && onGround) {
            velocityY = JUMP_FORCE;
            onGround  = false;
        }
    }

    updateMovement(dt);
    for (const rp of Object.values(gameState.players)) {
        if (!rp.dead) updateRemoteAnim(rp, dt);
    }
    applyFlicker();   // mutatore "Fantasmi" (invisibilità intermittente)
    drawMinimap();

    // Broadcast stato (throttled a 20fps) quando la scheda è in primo piano
    stateThrottle += dt;
    if (stateThrottle >= 0.05) {
        stateThrottle = 0;
        sendStateHeartbeat();
    }

    if (gameState.phase === 'game_over' && podiumAnim) updatePodium(now);

    renderer.render(scene, activeCamera);
}

animate();