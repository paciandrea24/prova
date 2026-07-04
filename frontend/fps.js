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
const MAP_HALF = 32;      // mezza dimensione della cittadina (nord/sud/ovest)
const MAP_X1 = 48;        // bordo EST: la mappa si estende oltre la cittadina col distretto del PORTO
const MAP_CEIL = 13;      // soffitto invisibile: anti-fuga con Gravità Lunare (tetto Emporio 5.6 + salto lunare ~4 → mai raggiunto in gioco normale)
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
    totalRounds: 5,
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

// Asfalto: grigio caldo cartoon con granulato chiaro
function drawAsphalt(ctx, s) {
    ctx.fillStyle = '#6e675e';
    ctx.fillRect(0, 0, s, s);
    for (var i = 0; i < 130; i++) {
        var b = Math.floor(Math.random() * 26 + 118);
        ctx.fillStyle = 'rgb(' + b + ',' + (b - 6) + ',' + (b - 14) + ')';
        ctx.beginPath();
        ctx.arc(Math.random() * s, Math.random() * s, Math.random() * 1.4 + 0.4, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.strokeStyle = 'rgba(150,140,125,0.35)';
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

// Tetto a tegole (rosso mattone luminoso)
function drawRoof(ctx, s) {
    ctx.fillStyle = '#a04a30';
    ctx.fillRect(0, 0, s, s);
    var tH = s / 6, tW = s / 5;
    ctx.fillStyle = '#8e3d26';
    ctx.strokeStyle = 'rgba(70,25,10,0.55)';
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

// Muro / mattoni caldi (terracotta cartoon)
function drawBrick(ctx, s) {
    ctx.fillStyle = '#c99873';
    ctx.fillRect(0, 0, s, s);
    var bH = s / 8, bW = s / 4;
    ctx.fillStyle = '#b3714c';
    ctx.strokeStyle = 'rgba(140,85,55,0.45)';
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

// Acciottolato da piazza: sanpietrini tondeggianti su fondo sabbia
function drawCobble(ctx, s) {
    ctx.fillStyle = '#b3a284';
    ctx.fillRect(0, 0, s, s);
    const n = 6, cw = s / n;
    const shades = ['#d3c2a0', '#c6b491', '#ddccaa', '#cbb997'];
    for (let row = 0; row < n; row++) {
        const off = (row % 2) * (cw / 2);
        for (let col = -1; col < n; col++) {
            ctx.fillStyle = shades[((row * 3 + col) % shades.length + shades.length) % shades.length];
            ctx.beginPath();
            ctx.ellipse(col * cw + off + cw / 2, row * cw + cw / 2,
                        cw * 0.44, cw * 0.40, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

// Tenda a strisce (rosso/crema di default) per i negozi
function drawStripes(ctx, s, colA = '#c94f42', colB = '#f6efe0') {
    const n = 8, w = s / n;
    for (let i = 0; i < n; i++) {
        ctx.fillStyle = i % 2 ? colB : colA;
        ctx.fillRect(i * w, 0, w, s);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(0, s - 6, s, 6);
}

// Insegna retrò con testo (canvas → texture, sempre leggibile: MeshBasic)
function makeSignTex(text, bg, fg) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, 500, 116);
    ctx.fillStyle = fg;
    ctx.font = 'bold 64px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 68);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
}
function addSign(text, w, h, x, y, z, ry, bg = '#f6efe0', fg = '#8a3c2e') {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: makeSignTex(text, bg, fg) }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    scene.add(m);
    return m;
}

// ══ STILE TOON (rubber-hose, validato nel prototipo fps-toon-proto) ══
// Gradient map a fasce nette per il cel-shading (NearestFilter = bande dure)
const _toonGradMap = (() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 1;
    const ctx = c.getContext('2d');
    const vals = [0.42, 0.73, 1.0];
    const w = 256 / vals.length;
    vals.forEach((v, i) => {
        const g = Math.round(v * 255);
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.fillRect(Math.floor(i * w), 0, Math.ceil(w), 1);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
})();

// Grana vintage: base bianca puntinata, moltiplicata dal colore del materiale
const _toonGrainTex = (() => {
    const s = 256;
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(60,50,40,${0.03 + Math.random() * 0.04})`;
        ctx.beginPath();
        ctx.arc(Math.random() * s, Math.random() * s, 0.6 + Math.random() * 1.6, 0, Math.PI * 2);
        ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
})();

function makeToonMat(color, useGrain = true) {
    return new THREE.MeshToonMaterial({
        color, gradientMap: _toonGradMap,
        map: useGrain ? _toonGrainTex : null
    });
}

// Contorni "inchiostro" (inverted hull), spessore fisso in metri
const TOON_OUTLINE_T = 0.008;
const UP_VEC = new THREE.Vector3(0, 1, 0);

// Geometria clonata coi vertici spostati lungo le normali (hull gonfiato)
function _toonDisplacedGeo(geo, t) {
    const g = geo.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
        p.setXYZ(i,
            p.getX(i) + n.getX(i) * t,
            p.getY(i) + n.getY(i) * t,
            p.getZ(i) + n.getZ(i) * t);
    }
    p.needsUpdate = true;
    return g;
}

// Aggiunge il contorno come FIGLIO della mesh: eredita pose e scale (incluso
// head.scale del mutatore Teste Giganti). outMat è un'istanza per-personaggio
// per i player (così "Fantasmi"/setGroupOpacity non tocca i contorni degli
// altri); per i prop del mondo si usa il condiviso MAT.ink.
function _addToonOutline(src, outMat, tMul = 1) {
    let o;
    if (src.geometry.type.indexOf('Box') === 0) {
        // Sui box l'offset via normali apre fessure agli spigoli → scala per-asse
        src.geometry.computeBoundingBox();
        const bb = src.geometry.boundingBox;
        const t = TOON_OUTLINE_T * tMul;
        o = new THREE.Mesh(src.geometry, outMat);
        o.scale.set(
            1 + 2 * t / Math.max(bb.max.x - bb.min.x, 1e-3),
            1 + 2 * t / Math.max(bb.max.y - bb.min.y, 1e-3),
            1 + 2 * t / Math.max(bb.max.z - bb.min.z, 1e-3));
    } else {
        o = new THREE.Mesh(_toonDisplacedGeo(src.geometry, TOON_OUTLINE_T * tMul), outMat);
    }
    o.castShadow = false;
    src.add(o);
    return o;
}

// ══════════════════════════════════════════════════════
//  MATERIALI RIUTILIZZABILI — mondo in stile TOON
//  (cel-shading a fasce; superfici con texture procedurali)
// ══════════════════════════════════════════════════════
function worldToon(opts) {
    return new THREE.MeshToonMaterial(Object.assign({ gradientMap: _toonGradMap }, opts));
}
const MAT = {
    // ── Superfici terreno/mappa ──────────────────────────
    ground:      worldToon({ map: makeTex(drawCobble, 22, 22) }),                        // piazza acciottolata
    grass:       worldToon({ map: makeTex(drawGrass, 6, 6) }),                           // aiuole/parco
    asphalt:     worldToon({ map: makeTex(drawAsphalt, 20, 4) }),                        // strade
    concrete:    worldToon({ color: 0xb9b3a2, map: makeTex(drawConcrete, 4, 4) }),       // cemento chiaro
    sidewalk:    worldToon({ color: 0xd8d2c0, map: makeTex(drawConcrete, 24, 1) }),      // marciapiede crema
    wall:        worldToon({ map: makeTex(drawBrick, 8, 3) }),                           // perimetro (mattoni caldi)
    crate:       worldToon({ map: makeTex(function(c,s){ drawCrate(c,s,'#8a5a1e','#c8963c'); }) }),
    crateDark:   worldToon({ map: makeTex(function(c,s){ drawCrate(c,s,'#5a3510','#8a5a1e'); }) }),
    woodFloor:   worldToon({ map: makeTex(drawWoodFloor, 2, 2) }),                       // pavimento interno
    roof:        worldToon({ map: makeTex(drawRoof, 6, 4) }),                            // tetto a tegole
    // ── Facciate della cittadina (siding grigio tinto) ──
    facadeCream:   worldToon({ color: 0xf2e3c2, map: makeTex(drawSiding, 4, 4) }),
    facadeCoral:   worldToon({ color: 0xe8836f, map: makeTex(drawSiding, 4, 4) }),
    facadeMint:    worldToon({ color: 0x7fc8a9, map: makeTex(drawSiding, 4, 4) }),
    facadeMustard: worldToon({ color: 0xe9b64f, map: makeTex(drawSiding, 4, 4) }),
    facadeBlue:    worldToon({ color: 0x86b8d6, map: makeTex(drawSiding, 4, 4) }),
    awningRed:     worldToon({ map: makeTex(drawStripes, 2, 1) }),
    awningBlue:    worldToon({ map: makeTex(function(c,s){ drawStripes(c,s,'#3f6fae','#f6efe0'); }, 2, 1) }),
    trim:        worldToon({ color: 0xf4efe2 }),   // cornici bianche
    fence:       worldToon({ color: 0xf4efe2 }),   // staccionata bianca
    // ── Veicoli / props ──────────────────────────────────
    metal:       worldToon({ color: 0x6a7686 }),
    vanRed:      worldToon({ color: 0xd8574a }),
    tire:        worldToon({ color: 0x23201d }),
    glass:       worldToon({ color: 0xaed6e4, transparent: true, opacity: 0.45 }),
    water:       worldToon({ color: 0x6fc3e8, transparent: true, opacity: 0.85 }),
    stallWood:   worldToon({ color: 0xb07a3c }),
    lamp:        new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),   // globo lampione (sempre "acceso")
    cloud:       new THREE.MeshBasicMaterial({ color: 0xffffff }),   // nuvolette cartoon
    // Contorno "inchiostro" CONDIVISO dei prop del mondo (i personaggi
    // usano un'istanza dedicata: vedi createPlayerMesh/outMat)
    ink:         new THREE.MeshBasicMaterial({ color: 0x1a1a1a, side: THREE.BackSide }),
    // Cielo: MeshBasic (non illuminato) → colore uniforme su tutte le facce del cubo-cielo.
    // Con Lambert le facce interne prendevano luci diverse mostrando "strisce" alle giunzioni
    // (evidenti sul podio finale, dove non c'è nebbia a mascherarle).
    sky:         new THREE.MeshBasicMaterial({ color: 0x8fd3f0, side: THREE.BackSide }),
};
// Materiali di dettaglio (props mappa)
MAT.chrome    = worldToon({ color: 0xc9d0d8 });
MAT.hubcap    = worldToon({ color: 0x8a8f96 });
MAT.headlight = worldToon({ color: 0xfff2b0 });
MAT.taillight = worldToon({ color: 0xd84a3a });
MAT.bark      = worldToon({ color: 0x7a5028 });
MAT.leaf      = worldToon({ color: 0x58a83c });
MAT.leafDark  = worldToon({ color: 0x3f8a30 });
MAT.couch     = worldToon({ color: 0x5a6e88 });  // tessuto
MAT.doorWood  = worldToon({ color: 0x6e4a26 });  // pannelli delle porte
MAT.brass     = worldToon({ color: 0xd9a441 });  // maniglie/ottone

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
    const matA = worldToon({ color: 0xbfa96c });
    const matB = worldToon({ color: 0xa38e5e });
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
function buildBarrel(x, z, color = 0x4a8a4a) {
    const r = 0.36, H = 1.1;
    const mat = worldToon({ color });
    const body = makeCyl(r, r, H, mat, x, H / 2, z, 'y', 14);
    _addToonOutline(body, MAT.ink, 0.8);
    // Cerchiature
    makeCyl(r + 0.02, r + 0.02, 0.06, MAT.crateDark, x, H * 0.28, z, 'y', 14);
    makeCyl(r + 0.02, r + 0.02, 0.06, MAT.crateDark, x, H * 0.72, z, 'y', 14);
    solidBoxes.push({
        min: new THREE.Vector3(x - r, 0, z - r),
        max: new THREE.Vector3(x + r, H, z + r)
    });
}

// ══════════════════════════════════════════════════════
//  PORTE INTERATTIVE — pannello incernierato + AABB commutabile
// ══════════════════════════════════════════════════════
// Apertura per prossimità (giocatore locale + remoti, con isteresi) o a colpo
// d'arma (forceUntil). Tutto client-side e deterministico: ogni client risolve
// solo le PROPRIE collisioni, quindi stati leggermente diversi non desyncano.
const doors = [];

// Porta in un'apertura fatta con punchWallX/Z. (cx,cz) = centro apertura,
// w/h = misure del pannello, axis = asse del muro ('x'|'z'),
// openDir = verso della rotazione (+1/-1 per aprire "in dentro").
function buildDoor(cx, cz, w, h, axis, openDir, mat) {
    const g = new THREE.Group();
    const baseYaw = (axis === 'x') ? 0 : Math.PI / 2;
    // Cerniera sul bordo dell'apertura; il pannello si estende sul +X locale
    if (axis === 'x') g.position.set(cx - w / 2, 0, cz);
    else g.position.set(cx, 0, cz + w / 2);
    g.rotation.y = baseYaw;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w - 0.06, h - 0.05, 0.08), mat || MAT.doorWood);
    panel.position.set(w / 2, (h - 0.05) / 2 + 0.02, 0);
    panel.castShadow = true;
    panel.receiveShadow = true;
    _addToonOutline(panel, MAT.ink, 0.7);
    g.add(panel);
    // Traverse decorative + maniglia d'ottone su entrambe le facce
    for (const ty of [h * 0.3, h * 0.72]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.12, 0.1), MAT.crateDark);
        bar.position.set(w / 2, ty, 0);
        g.add(bar);
    }
    for (const s of [-1, 1]) {
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), MAT.brass);
        knob.position.set(w - 0.16, h * 0.48, s * 0.09);
        g.add(knob);
    }
    scene.add(g);
    const box = {
        min: new THREE.Vector3(cx - w / 2, 0, cz - w / 2),
        max: new THREE.Vector3(cx + w / 2, h, cz + w / 2)
    };
    // AABB sottile nello spessore del muro (l'asse trasversale si restringe)
    if (axis === 'x') { box.min.z = cz - 0.12; box.max.z = cz + 0.12; }
    else { box.min.x = cx - 0.12; box.max.x = cx + 0.12; }
    solidBoxes.push(box);
    doors.push({ group: g, baseYaw, openDir, cx, cz, box, angle: 0, open: false, forceUntil: 0 });
}

function _doorSetSolid(d, on) {
    const i = solidBoxes.indexOf(d.box);
    if (on && i === -1) solidBoxes.push(d.box);
    else if (!on && i !== -1) solidBoxes.splice(i, 1);
}

// Chiamata dal loop animate(): apre/chiude con isteresi (apre < 2.0 m,
// richiude solo > 2.8 m così non si richiude addosso a chi la attraversa).
function updateDoors(dt) {
    const now = performance.now();
    for (const d of doors) {
        let minD2 = Infinity;
        if (!gameState.isDead) {
            const dx = playerRoot.position.x - d.cx, dz = playerRoot.position.z - d.cz;
            minD2 = dx * dx + dz * dz;
        }
        for (const rp of Object.values(gameState.players)) {
            if (rp.dead) continue;
            const dx = rp.group.position.x - d.cx, dz = rp.group.position.z - d.cz;
            minD2 = Math.min(minD2, dx * dx + dz * dz);
        }
        const soglia = d.open ? 2.8 : 2.0;
        d.open = minD2 < soglia * soglia || now < d.forceUntil;
        if (d.open) _doorSetSolid(d, false);   // via la collisione appena parte l'apertura
        d.angle += ((d.open ? 1 : 0) - d.angle) * Math.min(1, dt * 7);
        if (!d.open && d.angle < 0.04) { d.angle = 0; _doorSetSolid(d, true); }
        d.group.rotation.y = d.baseYaw + d.openDir * d.angle * 1.85;   // ~106° a fine corsa
    }
}

// ══════════════════════════════════════════════════════
//  PROP DISTRUTTIBILI — solo estetica (non fermano il colpo,
//  non fanno da riparo: mai registrati in solidBoxes)
// ══════════════════════════════════════════════════════
const breakables = [];

function registerBreakable(meshes, min, max) {
    breakables.push({ meshes, min, max, broken: false });
}

// Slab-test del raggio di sparo contro i breakable ancora interi:
// tutto ciò che sta lungo la traiettoria (fino all'impatto) si rompe.
function checkBreakables(origin, dir, maxDist) {
    for (const b of breakables) {
        if (b.broken) continue;
        let tmin = -Infinity, tmax = Infinity, miss = false;
        for (const ax of ['x', 'y', 'z']) {
            const o = origin[ax], dd = dir[ax];
            if (Math.abs(dd) < 1e-8) {
                if (o < b.min[ax] || o > b.max[ax]) { miss = true; break; }
            } else {
                let t1 = (b.min[ax] - o) / dd, t2 = (b.max[ax] - o) / dd;
                if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
                if (t1 > tmin) tmin = t1;
                if (t2 < tmax) tmax = t2;
            }
        }
        if (!miss && tmin <= tmax && tmin > 0 && tmin < maxDist + 0.2) {
            b.broken = true;
            for (const m of b.meshes) m.visible = false;
            _fxSpawnPos.set(origin.x + dir.x * tmin, origin.y + dir.y * tmin, origin.z + dir.z * tmin);
            spawnFxSprite(getFxTexture('puff'), _fxSpawnPos, { size: 0.22, life: 300, rise: 0.3, drift: 0.1 });
            spawnFxSprite(getFxTexture('twinkle'), _fxSpawnPos, { size: 0.1, life: 260, rise: 0.4, spin: 3 });
        }
    }
}

// A inizio round i prop rotti tornano interi (la mappa non viene ricostruita)
function resetBreakables() {
    for (const b of breakables) {
        b.broken = false;
        for (const m of b.meshes) m.visible = true;
    }
}

// Bottiglia di vetro colorato (breakable): corpo + collo
function addBottle(x, y, z, color) {
    const mat = worldToon({ color, transparent: true, opacity: 0.85 });
    const body = makeCyl(0.07, 0.08, 0.3, mat, x, y + 0.15, z, 'y', 8);
    const neck = makeCyl(0.028, 0.045, 0.16, mat, x, y + 0.37, z, 'y', 8);
    registerBreakable([body, neck],
        new THREE.Vector3(x - 0.09, y, z - 0.09),
        new THREE.Vector3(x + 0.09, y + 0.46, z + 0.09));
}

// Cassetta leggera (breakable, NON solida — troppo piccola per far da riparo)
function addLooseCrate(size, x, y, z, dark = false) {
    const m = makeBox(size, size, size, dark ? MAT.crateDark : MAT.crate, x, y + size / 2, z);
    registerBreakable([m],
        new THREE.Vector3(x - size / 2, y, z - size / 2),
        new THREE.Vector3(x + size / 2, y + size, z + size / 2));
}

// ══════════════════════════════════════════════════════
//  SPEAKEASY (angolo SW) — volume chiuso su più stanze:
//  sala bar (bancone + palco + tavolini) e retro/cantina.
//  Ingressi SOLO da porte interattive → ideale per i
//  mutatori blackout/fog e il combattimento ravvicinato.
// ══════════════════════════════════════════════════════
function buildSpeakeasy() {
    const x0 = -30.5, x1 = -18.5, z0 = 21.5, z1 = 31.5, H = 3.2;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;   // il retro sfrutta il muro perimetrale (z1)

    // Pavimento in legno (piano visivo, come i marciapiedi)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), MAT.woodFloor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0.06, cz);
    floor.receiveShadow = true;
    scene.add(floor);

    // Guscio in mattoni (facciata "clandestina"): porta+finestrella alta a nord,
    // porta a est, cieco a ovest; il lato sud è il muro perimetrale stesso.
    const doorOpen = { w: 1.8, b: 0, t: 2.25 };
    const winHigh = { w: 2.4, b: 1.9, t: 2.6 };
    punchWallX(z0, x0, x1, 0, H, [{ c: -27.5, ...doorOpen }, { c: -22.5, ...winHigh }], MAT.wall);
    punchWallZ(x1, z0, z1, 0, H, [{ c: 24.5, ...doorOpen }], MAT.wall);
    punchWallZ(x0, z0, z1, 0, H, [], MAT.wall);
    // Vetro della finestrella (breakable) + tende scure dietro
    const wg = makeBox(2.3, 0.65, 0.08, MAT.glass, -22.5, 2.25, z0);
    registerBreakable([wg],
        new THREE.Vector3(-23.65, 1.9, z0 - 0.12),
        new THREE.Vector3(-21.35, 2.6, z0 + 0.12));

    // Tramezzo interno: sala (z 21.5→28) / retro-cantina (z 28→31.5)
    punchWallX(28, x0, x1, 0, H, [{ c: -20.5, w: 1.6, b: 0, t: 2.2 }], MAT.facadeCream, 0.3);

    // Tetto piano + cornicione (raggiungibile con un salto dal tetto del portico)
    addSolid(x1 - x0 + 0.6, 0.25, z1 - z0 + 0.6, cx, H, cz, MAT.roof);
    for (const zz of [z0 - 0.15, z1]) makeBox(x1 - x0 + 0.8, 0.3, 0.25, MAT.trim, cx, H - 0.05, zz);

    // Le tre porte (aprono verso l'interno): ingresso nord, porta est, retro
    buildDoor(-27.5, z0, 1.8, 2.25, 'x', -1);
    buildDoor(x1, 24.5, 1.8, 2.25, 'z', 1);
    buildDoor(-20.5, 28, 1.6, 2.2, 'x', -1, MAT.facadeCream);

    // Insegna discreta + lampadina sopra l'ingresso (sul lato strada, -Z)
    addSign('JAZZ CLUB', 3.2, 0.75, -27.5, 2.75, z0 - 0.21, Math.PI, '#2a2320', '#e8b64f');
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), MAT.lamp);
    bulb.position.set(-27.5, 2.45, z0 - 0.35);
    scene.add(bulb);

    // ── Sala bar ──
    // Bancone (riparo alto) + sgabelli
    const bar = addSolid(4.6, 1.05, 0.9, -23, 0, 26.4, MAT.stallWood);
    _addToonOutline(bar, MAT.ink);
    for (const sx of [-24.4, -23, -21.6]) {
        makeCyl(0.24, 0.24, 0.06, MAT.couch, sx, 0.62, 25.5, 'y', 10);
        makeCyl(0.05, 0.07, 0.6, MAT.crateDark, sx, 0.3, 25.5, 'y', 8);
    }
    // Scaffale a muro dietro il bancone, con bottiglie (breakable)
    for (const sy of [1.45, 2.0]) makeBox(4.4, 0.06, 0.32, MAT.crateDark, -23, sy, 27.6);
    const bottleCols = [0x3f7a4e, 0x7a4a28, 0x4a6a8a, 0x8a3c2e];
    let bi = 0;
    for (const sy of [1.48, 2.03]) {
        for (let bx = -24.7; bx <= -21.3; bx += 0.55) {
            addBottle(bx + (bi % 2) * 0.12, sy, 27.6, bottleCols[bi % bottleCols.length]);
            bi++;
        }
    }
    // Bottiglie anche sul bancone
    addBottle(-24.3, 1.05, 26.3, 0x3f7a4e);
    addBottle(-21.8, 1.05, 26.5, 0x7a4a28);

    // Palco con microfono lungo la parete ovest (arretrato: fuori dal
    // raggio di apertura della porta d'ingresso)
    const stage = addSolid(2.6, 0.45, 3.4, -29, 0, 25.2, MAT.woodFloor);
    _addToonOutline(stage, MAT.ink, 1.2);
    makeCyl(0.035, 0.05, 1.15, MAT.metal, -29, 1.02, 25.2, 'y', 8);
    const mic = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), MAT.crateDark);
    mic.position.set(-29, 1.68, 25.2);
    scene.add(mic);
    // Tenda scura di fondo palco
    makeBox(0.1, 2.2, 3.6, worldToon({ color: 0x6e2a33 }), -30.25, 1.45, 25.2);

    // Tavolini tondi (riparo basso) — AABB manuale sull'ingombro del piano
    for (const [tx, tz] of [[-25.6, 23.3], [-20.6, 25.8]]) {
        const top = makeCyl(0.55, 0.55, 0.07, MAT.stallWood, tx, 0.8, tz, 'y', 14);
        _addToonOutline(top, MAT.ink, 0.7);
        makeCyl(0.07, 0.11, 0.8, MAT.crateDark, tx, 0.4, tz, 'y', 8);
        solidBoxes.push({
            min: new THREE.Vector3(tx - 0.55, 0, tz - 0.55),
            max: new THREE.Vector3(tx + 0.55, 0.84, tz + 0.55)
        });
    }

    // ── Retro / cantina: casse e botti (ripari veri) ──
    crate(1.5, 1.2, 1.5, -29.3, 0, 30.3, true);
    crate(1.3, 0.6, 1.3, -27.6, 0, 29.6);
    buildBarrel(-25.4, 30.4, 0x7a4a28);
    buildBarrel(-24.2, 29.6, 0x7a4a28);
    addLooseCrate(0.7, -22.5, 0, 30.6);
}

// ══════════════════════════════════════════════════════
//  IL PORTO — distretto EST (x 31.5..MAP_X1, tutta la
//  profondità della mappa): bacino d'acqua lungo il muro
//  est, nave cargo col ponte calpestabile, magazzino
//  enterable (porte interattive), gru, container, pontile.
//  Si raggiunge da nord (dietro la FERRAMENTA), dal vicolo
//  tra SARTORIA e FARMACIA, da sud (oltre il TEATRO) e
//  attraverso le retro-porte di RADIO e FARMACIA.
// ══════════════════════════════════════════════════════
function buildPort() {
    const x0 = 31.5;
    MAT.crane = worldToon({ color: 0xe0a83a });
    MAT.hull  = worldToon({ color: 0x4a5c6e });

    // ── Pavimentazione della banchina (copre l'acciottolato) ──
    const pav = (w, d, x, z) => {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), MAT.concrete);
        p.rotation.x = -Math.PI / 2;
        p.position.set(x, 0.03, z);
        p.receiveShadow = true;
        scene.add(p);
    };
    pav(10, 64, 36.5, 0);            // banchina principale (x 31.5..41.5)
    pav(6.5, 12, 44.75, -26);        // piazzale container a NE

    // ── Bacino d'acqua lungo il muro est (x 41.5..48, z -20..32) ──
    // Il bordo è 0.45: in acqua si entra e si esce camminando (step-up).
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 52), worldToon({ color: 0x2e5f70 }));
    bed.rotation.x = -Math.PI / 2;
    bed.position.set(44.75, 0.04, 6);
    scene.add(bed);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 52), MAT.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set(44.75, 0.3, 6);
    scene.add(water);
    // Bordo banchina a L (lato ovest del bacino + lato nord)
    addSolid(0.8, 0.45, 52.4, 41.1, 0, 6.2, MAT.concrete);
    addSolid(7.3, 0.45, 0.8, 44.85, 0, -20.4, MAT.concrete);
    // Bitte d'ormeggio lungo il bordo
    for (const bz of [-16, -8, 0, 8, 16, 24]) {
        const bitta = makeCyl(0.09, 0.13, 0.42, MAT.iron, 41.1, 0.66, bz, 'y', 8);
        _addToonOutline(bitta, MAT.ink, 0.6);
    }

    // ── NAVE CARGO ormeggiata: ponte calpestabile a 1.85, si sale
    //    dalla passerella in legno; cabina solida = riparo in quota ──
    addSolid(3.6, 1.7, 16, 45.3, 0.15, 4, MAT.hull);                 // scafo → ponte a 1.85
    makeBox(3.7, 0.22, 16.2, MAT.trim, 45.3, 0.5, 4);                // linea di galleggiamento
    for (const sx of [43.62, 46.98]) makeBox(0.1, 0.42, 15.6, MAT.vanRed, sx, 2.06, 4);  // murate (visive)
    addSolid(3.0, 1.9, 2.8, 45.3, 1.85, 9.8, MAT.facadeCream);       // cabina di comando
    makeBox(3.2, 0.18, 3.0, MAT.vanRed, 45.3, 3.85, 9.8);            // tetto cabina
    makeBox(2.4, 0.55, 0.1, MAT.glass, 45.3, 3.2, 8.38);             // vetrata verso prua
    const funnel = makeCyl(0.5, 0.62, 1.9, MAT.hull, 45.3, 2.9, 7.0, 'y', 12);
    _addToonOutline(funnel, MAT.ink, 0.8);
    makeCyl(0.53, 0.53, 0.4, MAT.vanRed, 45.3, 3.6, 7.0, 'y', 12);   // fascia rossa fumaiolo
    const mast = makeCyl(0.06, 0.1, 3.6, MAT.bark, 45.3, 3.6, -1.5, 'y', 8);
    _addToonOutline(mast, MAT.ink, 0.6);
    // Prua a cuneo (visiva) + casse sul ponte (riparo)
    const bow = makeBox(2.55, 1.7, 2.55, MAT.hull, 45.3, 1.0, -4.6);
    bow.rotation.y = Math.PI / 4;
    crate(1.4, 0.9, 1.4, 44.6, 1.85, 2);
    crate(1.1, 0.6, 1.1, 46.1, 1.85, 0.6, true);
    addSign('S.S. GAMBERETTO', 3.4, 0.55, 43.55, 1.15, 4, -Math.PI / 2, '#4a5c6e', '#f6efe0');
    // Passerella d'imbarco: gradini dalla banchina fin sul ponte
    buildStairs(40.9, 2.0, 1.6, 1.85, 1, 0, MAT.woodFloor);

    // ── MAGAZZINO enterable (porte interattive, tetto-postazione) ──
    const mx0 = 33, mx1 = 40, mz0 = -28, mz1 = -19.5, MH = 3.6;
    const mcx = (mx0 + mx1) / 2, mcz = (mz0 + mz1) / 2;
    const mfloor = new THREE.Mesh(new THREE.PlaneGeometry(mx1 - mx0, mz1 - mz0), MAT.woodFloor);
    mfloor.rotation.x = -Math.PI / 2;
    mfloor.position.set(mcx, 0.06, mcz);
    scene.add(mfloor);
    punchWallX(mz1, mx0, mx1, 0, MH, [{ c: 36.5, w: 2.6, b: 0, t: 2.6 }], MAT.facadeMustard);  // fronte sud
    punchWallX(mz0, mx0, mx1, 0, MH, [], MAT.facadeMustard);
    punchWallZ(mx0, mz0, mz1, 0, MH, [{ c: -23.5, w: 1.8, b: 0, t: 2.25 }], MAT.facadeMustard);
    punchWallZ(mx1, mz0, mz1, 0, MH, [{ c: -26, w: 2.2, b: 2.2, t: 3.0 }], MAT.facadeMustard); // finestrone alto
    addSolid(mx1 - mx0 + 0.6, 0.25, mz1 - mz0 + 0.6, mcx, MH, mcz, MAT.roof);
    addSolid(mx1 - mx0 + 0.4, 0.6, 0.25, mcx, MH + 0.25, mz1, MAT.trim);   // parapetto sul fronte
    buildDoor(36.5, mz1, 2.6, 2.6, 'x', -1);
    buildDoor(mx0, -23.5, 1.8, 2.25, 'z', -1);
    addSign('MAGAZZINO', 4.2, 0.85, 36.5, MH + 0.75, mz1 + 0.21, 0, '#8a5a1e', '#f6efe0');
    // Interno: scaffalatura, casse, cassette rompibili
    addSolid(4.5, 2.0, 0.5, 35.6, 0, mz0 + 0.6, MAT.crateDark);
    crate(1.6, 1.2, 1.6, 38.8, 0, -26.5, true);
    crate(1.4, 0.6, 1.4, 33.9, 0, -21.2);
    addLooseCrate(0.7, 36.8, 0, -24.5);
    addLooseCrate(0.6, 34.6, 0, -26.8, true);
    // Scala esterna sul retro → tetto = postazione sul porto
    buildStairs(41.1, -28.6, 2.0, 3.85, 0, 1);

    // ── Piazzale container a NE (pile scalabili a gradoni) ──
    const cont = (w, h, d, x, y, z, mat) => {
        const c = addSolid(w, h, d, x, y, z, mat);
        _addToonOutline(c, MAT.ink);
        return c;
    };
    cont(2.2, 2.3, 5.5, 44, 0, -29, MAT.vanRed);
    cont(2.2, 2.3, 5.5, 46.6, 0, -28.2, worldToon({ color: 0x4a8a4a }));
    cont(2.2, 2.3, 5.5, 44, 2.3, -28.6, MAT.crane);   // container impilato
    crate(1.5, 0.6, 1.5, 42.6, 0, -24.6);
    crate(1.4, 1.2, 1.4, 43.9, 0, -25.2, true);
    crate(1.3, 1.8, 1.3, 45.2, 0, -25.8);             // gradoni 0.6→1.2→1.8→2.3 (sul container)
    buildBarrel(41.9, -21.8, 0x4a6a8a);
    buildBarrel(42.9, -21.4, 0xd8574a);

    // ── Gru portuale sulla banchina, braccio sopra la nave ──
    addSolid(1.8, 0.5, 1.8, 39.8, 0, 13.5, MAT.metal);
    const tower = addSolid(0.8, 6.8, 0.8, 39.8, 0.5, 13.5, MAT.crane);
    _addToonOutline(tower, MAT.ink);
    makeBox(1.3, 1.05, 1.15, MAT.crane, 39.8, 7.85, 13.5);            // cabina
    makeBox(0.95, 0.55, 0.95, MAT.metal, 39.8, 7.35, 14.45);          // contrappeso
    makeBox(7.2, 0.34, 0.55, MAT.crane, 43.2, 7.45, 13.5);            // braccio sul bacino
    const tir = makeBox(6.4, 0.07, 0.07, MAT.metal, 43.1, 8.05, 13.5);
    tir.rotation.z = -0.17;
    makeCyl(0.03, 0.03, 3.4, MAT.tire, 46.2, 5.6, 13.5, 'y', 6);      // fune
    const hangCrate = makeBox(1.15, 1.15, 1.15, MAT.crate, 46.2, 3.3, 13.5);
    _addToonOutline(hangCrate, MAT.ink);

    // ── Pontile basso nel bacino sud + barca a remi ──
    addSolid(5.5, 0.55, 1.5, 44.2, 0, 24, MAT.woodFloor);
    for (const [px, pz] of [[42.3, 23.3], [42.3, 24.7], [45.4, 23.3], [45.4, 24.7]]) {
        const palo = makeCyl(0.09, 0.1, 0.95, MAT.bark, px, 0.48, pz, 'y', 8);
        _addToonOutline(palo, MAT.ink, 0.6);
    }
    addSolid(1.7, 0.75, 3.2, 45, 0.1, 27.6, worldToon({ color: 0x8a3c2e }));   // scafo (riparo)
    makeBox(1.75, 0.14, 3.3, MAT.trim, 45, 0.9, 27.6);
    makeBox(1.3, 0.12, 0.4, MAT.woodFloor, 45, 0.62, 27.0);
    makeBox(1.3, 0.12, 0.4, MAT.woodFloor, 45, 0.62, 28.3);
    addLooseCrate(0.7, 43.2, 0.55, 24.2);
    addLooseCrate(0.6, 45.9, 0.55, 23.8, true);

    // ── Ripari sparsi sulla banchina principale + lampioni ──
    buildSandbags(35, 8, 2.4, Math.PI / 2);
    buildBarrier(34, -6, 0.15);
    crate(1.7, 0.6, 1.7, 38.5, 0, 26.5);
    crate(1.5, 1.2, 1.5, 38.5, 0, 28.1, true);
    buildBarrel(33.5, 29.5, 0x4a8a4a);
    buildLamppost(34, -16);
    buildLamppost(34, 14);
    buildLamppost(39, 22);
    // Reti/salvagenti cartoon sul muro: anelli bianco-rossi (visivi)
    for (const rz of [-2, 12]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.13, 8, 18), MAT.vanRed);
        ring.position.set(MAP_X1 - 0.55, 1.6, rz);
        ring.rotation.y = Math.PI / 2;
        scene.add(ring);
    }

    // Insegna del distretto sul muro perimetrale nord del piazzale
    addSign('PORTO', 3.6, 1.0, 44.75, 4.5, -MAP_HALF + 0.56, 0, '#3f6fae', '#f6efe0');
}

// ── Chiosco dei giornali tondo (al posto del vecchio furgone dei gelati) ──
function buildKiosk(x, z) {
    const body = makeCyl(1.25, 1.25, 2.3, MAT.facadeMint, x, 1.15, z, 'y', 12);
    _addToonOutline(body, MAT.ink);
    solidBoxes.push({
        min: new THREE.Vector3(x - 1.25, 0, z - 1.25),
        max: new THREE.Vector3(x + 1.25, 2.3, z + 1.25)
    });
    // Sportello con mensola + giornali (breakable)
    makeBox(1.3, 0.7, 0.12, worldToon({ color: 0x2a2320 }), x, 1.55, z - 1.22);
    makeBox(1.5, 0.09, 0.5, MAT.trim, x, 1.12, z - 1.35);
    addLooseCrate(0.4, x - 0.35, 1.17, z - 1.35);
    // Tetto conico a strisce + pomello
    const roof = makeCyl(0.12, 1.7, 0.95, MAT.awningRed, x, 2.78, z, 'y', 12);
    _addToonOutline(roof, MAT.ink, 1.0);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), MAT.brass);
    knob.position.set(x, 3.35, z);
    scene.add(knob);
    addSign('EDICOLA', 2.2, 0.6, x, 2.15, z - 1.28, Math.PI);
}

// ══════════════════════════════════════════════════════
//  MAPPA — "CITTADINA CARTOON" (anni '30, luminosa)
//  Grande Emporio centrale a 2 piani + tetto calpestabile;
//  anello esterno: strada nord, Via Lunga a ovest (linea
//  sniper), piazza a sud con fontana e mercatino, botteghe
//  enterable sul perimetro con tetti raggiungibili.
//  Confini blindati (muro 12 m + soffitto invisibile).
// ══════════════════════════════════════════════════════
function buildMap() {

    MAT.iron = worldToon({ color: 0x33604a });   // ghisa verde dei lampioni

    // ── Terreno: acciottolato su tutta la mappa (estesa a est fino al porto) ──
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(MAP_X1 + MAP_HALF, MAP_HALF * 2), MAT.ground
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.x = (MAP_X1 - MAP_HALF) / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ── Strade in asfalto attorno all'Emporio (nessuna sovrapposizione) ──
    const mkRoad = (w, d, x, z) => {
        const r = new THREE.Mesh(new THREE.PlaneGeometry(w, d), MAT.asphalt);
        r.rotation.x = -Math.PI / 2;
        r.position.set(x, 0.02, z);
        r.receiveShadow = true;
        scene.add(r);
    };
    mkRoad(42, 18, 11, -16);      // strada nord (est-ovest)
    mkRoad(17, 64, -18.5, 0);     // Via Lunga (ovest, nord-sud: linea sniper)
    mkRoad(15, 32, 17.5, 9);      // strada est
    // Mezzeria tratteggiata della Via Lunga
    for (let z = -28; z <= 28; z += 8) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 3), MAT.trim);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(-18, 0.035, z);
        scene.add(dash);
    }

    // ── Marciapiedi davanti alle botteghe ──
    const mkSide = (w, d, x, z) => {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(w, d), MAT.sidewalk);
        s.rotation.x = -Math.PI / 2;
        s.position.set(x, 0.05, z);
        s.receiveShadow = true;
        scene.add(s);
    };
    mkSide(40, 2, 8, -24);      // fronte botteghe nord
    mkSide(2, 36, 24, -1);      // fronte botteghe est
    mkSide(36, 2, 0, 24);       // fronte botteghe sud

    // ── EDIFICIO CENTRALE: il Grande Emporio ──
    buildCentral();

    // ── BOTTEGHE dell'anello (enterable, tetto piano calpestabile) ──
    // Nord (fronte a sud, verso la strada)
    buildShop(-2, -28, 9, 6, 'S', MAT.facadeCoral, 'PANETTERIA', MAT.awningRed);
    buildShop(10, -28, 8, 6, 'S', MAT.facadeMint, 'BARBIERE', MAT.awningBlue);
    buildShop(22.5, -28, 9, 6, 'S', MAT.facadeCream, 'FERRAMENTA', MAT.awningRed);
    // Est (fronte a ovest, verso la strada; RADIO e FARMACIA hanno la
    // retro-porta che sfonda sul PORTO)
    buildShop(28, -14, 8, 6, 'W', MAT.facadeBlue, 'RADIO', MAT.awningRed, true);
    buildShop(28, -1, 8, 6, 'W', MAT.facadeCream, 'SARTORIA', MAT.awningBlue);
    buildShop(28, 12, 8, 6, 'W', MAT.facadeCoral, 'FARMACIA', MAT.awningBlue, true);
    // Sud (fronte a nord, sulla piazza)
    buildShop(-11, 28, 9, 6, 'N', MAT.facadeMint, 'GELATERIA', MAT.awningRed);
    buildShop(2, 28, 9, 6, 'N', MAT.facadeMustard, 'CAFFÈ', MAT.awningBlue);
    buildShop(15, 28, 9, 6, 'N', MAT.facadeBlue, 'TEATRO', MAT.awningRed);

    // ── Scale di servizio nei vicoli (accesso ai tetti delle botteghe) ──
    buildStairs(4.25, -24.6, 2.8, 3.15, 0, -1);    // vicolo nord (PANETTERIA/BARBIERE)
    buildStairs(24.6, -7.5, 4.2, 3.15, 1, 0);      // vicolo est (RADIO/SARTORIA)
    buildStairs(-4.5, 24.6, 3.2, 3.15, 0, 1);      // vicolo sud (GELATERIA/CAFFÈ)
    // Passerella in legno tra i tetti di BARBIERE e FERRAMENTA
    addSolid(4.4, 0.15, 2.0, 16, 3.1, -28, MAT.woodFloor);

    // ── PIAZZA sud: fontana, mercatino, giardinetto ──
    buildFountain(0, 16);
    buildStall(7, 11, true, MAT.awningRed);
    buildStall(-5, 12, true, MAT.awningBlue);
    buildStall(9, 19, false, MAT.awningBlue);
    // Giardinetto recintato con albero
    const g1 = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), MAT.grass);
    g1.rotation.x = -Math.PI / 2;
    g1.position.set(-14, 0.04, 12);
    g1.receiveShadow = true;
    scene.add(g1);
    fenceX(-17, -11, 10);
    fenceX(-17, -11, 14);
    fenceZ(10, 14, -17);
    addTree(-14, 0, 12);
    // Panchine (riparo bassissimo)
    addSolid(2.2, 0.55, 0.6, -4, 0, 20, MAT.woodFloor);
    addSolid(0.6, 0.55, 2.2, 4.5, 0, 16, MAT.woodFloor);

    // ── Strada nord: chiosco dei giornali + coperture ──
    buildKiosk(8, -16);
    buildBarrier(-4, -13, 0.2);
    buildBarrier(20, -19, -0.3);
    buildSandbags(-2, -20, 2.4, 0.1);
    buildBarrel(15, -12);
    buildBarrel(16.2, -12.6, 0xd8574a);

    // ── Via Lunga: coperture RADE ai bordi (la linea di tiro resta libera) ──
    buildSandbags(-12.5, -5, 2.2, Math.PI / 2);
    buildBarrier(-12.5, 8, Math.PI / 2);
    buildBarrel(-24.5, 6);

    // ── Portico ovest: colonnato coperto lungo il muro, tetto calpestabile ──
    for (let z = -18; z <= 18; z += 6) {
        const col = makeCyl(0.28, 0.34, 3.0, MAT.trim, -27, 1.5, z, 'y', 12);
        _addToonOutline(col, MAT.ink, 0.8);
        solidBoxes.push({
            min: new THREE.Vector3(-27.35, 0, z - 0.35),
            max: new THREE.Vector3(-26.65, 3.0, z + 0.35)
        });
    }
    addSolid(5, 0.25, 40, -29.2, 3.0, 0, MAT.roof);       // tetto del portico
    addSolid(0.25, 0.55, 40, -26.8, 3.25, 0, MAT.trim);   // parapetto basso sul bordo
    buildStairs(-29.2, -24.4, 3.6, 3.25, 0, 1);           // scala all'estremità nord

    // ── Angolo NW: palco della banda (gazebo) ──
    buildGazebo(-14, -27);
    addTree(-25, 0, -27);

    // ── Angolo SW: lo SPEAKEASY (interno chiuso, porte interattive) ──
    buildSpeakeasy();

    // ── Distretto EST: il PORTO (bacino, nave, magazzino, gru, container) ──
    buildPort();
    // Raccordo piazza→porto (angolo SE): qualche riparo sul varco
    crate(1.7, 0.6, 1.7, 24, 0, 26);
    crate(1.5, 1.2, 1.5, 24, 0, 24.4, true);
    buildBarrel(28.5, 20.5);

    // ── Angolo NE: pocket con casse impilate ──
    addTree(29, 0, -22);
    crate(1.7, 0.6, 1.7, 28, 0, -27);
    crate(1.5, 1.2, 1.5, 29.3, 0, -28.6, true);

    // ── Lampioni ──
    buildLamppost(-13, -9);
    buildLamppost(13, -9);
    buildLamppost(13, 9);
    buildLamppost(-13, 9);
    buildLamppost(-6, 20.5);
    buildLamppost(18, -22);

    // ── Confini: muro perimetrale ALTO (niente fughe con Gravità Lunare).
    // Il lato est è arretrato a MAP_X1: dietro le botteghe est c'è il PORTO. ──
    const wallCX = (MAP_X1 - MAP_HALF) / 2, wallLen = MAP_X1 + MAP_HALF + 2;
    addSolid(wallLen, 12, 1, wallCX, 0, -MAP_HALF, MAT.wall);
    addSolid(wallLen, 12, 1, wallCX, 0, MAP_HALF, MAT.wall);
    addSolid(1, 12, MAP_HALF * 2 + 2, MAP_X1, 0, 0, MAT.wall);
    addSolid(1, 12, MAP_HALF * 2 + 2, -MAP_HALF, 0, 0, MAT.wall);
    // Cornice bianca in cima al muro
    for (const [w, d, x, z] of [[wallLen + 0.4, 1.4, wallCX, -MAP_HALF], [wallLen + 0.4, 1.4, wallCX, MAP_HALF],
                                [1.4, 66, MAP_X1, 0], [1.4, 66, -MAP_HALF, 0]]) {
        makeBox(w, 0.5, d, MAT.trim, x, 12.15, z);
    }

    // ── Fondale, nuvole e skybox ──
    buildBackdrop();
    buildClouds();
    const sky = new THREE.Mesh(new THREE.BoxGeometry(500, 500, 500), MAT.sky);
    scene.add(sky);
}

// ══ HELPER MURI CON APERTURE (porte/finestre) ══
// Muro lungo X con aperture. openings: [{c, w, b, t}] ordinati per centro —
// c = centro-x, w = larghezza, b/t = quote assolute inferiore/superiore del buco.
function punchWallX(zc, x0, x1, y0, h, openings, mat, t = 0.35) {
    let cur = x0;
    const top = y0 + h;
    for (const o of openings) {
        const oL = o.c - o.w / 2, oR = o.c + o.w / 2;
        if (oL > cur + 0.01) addSolid(oL - cur, h, t, (cur + oL) / 2, y0, zc, mat);
        if (o.b > y0 + 0.01) addSolid(o.w, o.b - y0, t, o.c, y0, zc, mat);
        if (o.t < top - 0.01) addSolid(o.w, top - o.t, t, o.c, o.t, zc, mat);
        cur = oR;
    }
    if (cur < x1 - 0.01) addSolid(x1 - cur, h, t, (cur + x1) / 2, y0, zc, mat);
}
// Come sopra, lungo Z (c = centro-z delle aperture)
function punchWallZ(xc, z0, z1, y0, h, openings, mat, t = 0.35) {
    let cur = z0;
    const top = y0 + h;
    for (const o of openings) {
        const oL = o.c - o.w / 2, oR = o.c + o.w / 2;
        if (oL > cur + 0.01) addSolid(t, h, oL - cur, xc, y0, (cur + oL) / 2, mat);
        if (o.b > y0 + 0.01) addSolid(t, o.b - y0, o.w, xc, y0, o.c, mat);
        if (o.t < top - 0.01) addSolid(t, top - o.t, o.w, xc, o.t, o.c, mat);
        cur = oR;
    }
    if (cur < z1 - 0.01) addSolid(t, h, z1 - cur, xc, y0, (cur + z1) / 2, mat);
}

// Scala esterna dritta: parte da (x0,z0), sale verso (dirX,dirZ) fino a hTop.
// Gradini < STEP_HEIGHT → si sale camminando. w = larghezza della rampa.
function buildStairs(x0, z0, w, hTop, dirX, dirZ, mat = MAT.concrete) {
    const n = Math.max(2, Math.ceil(hTop / 0.5));
    const stepH = hTop / n, depth = 0.62;
    for (let i = 0; i < n; i++) {
        addSolid(dirX ? depth + 0.04 : w, (i + 1) * stepH,
                 dirZ ? depth + 0.04 : w,
                 x0 + dirX * (i + 0.5) * depth, 0,
                 z0 + dirZ * (i + 0.5) * depth, mat);
    }
}

// ── GRANDE EMPORIO centrale: 2 piani + tetto-terrazza calpestabile ──
// Interni stretti (smg/shotgun/blackout), finestroni al 2° piano, scala A
// (terra→2°, angolo NW) e scala B (2°→tetto, angolo SE), parapetto sul tetto.
function buildCentral() {
    const W = 20, D = 14, hw = W / 2, hd = D / 2;
    const F2 = 2.8, ROOF = 5.6;
    const FAC = MAT.facadeMustard;
    const holeW = 3.4, holeD = 4.4;   // vani scala nei solai

    // Fondamenta + pavimento in legno
    makeBox(W + 0.8, 0.3, D + 0.8, MAT.concrete, 0, -0.05, 0);
    makeBox(W, 0.2, D, MAT.woodFloor, 0, 0.1, 0);

    // ── PIANO TERRA: porte su tutti e 4 i lati + vetrine ──
    const door = { w: 3.0, b: 0, t: 2.3 };
    const win = { w: 2.6, b: 1.0, t: 2.4 };
    for (const sz of [-1, 1]) {
        punchWallX(sz * hd, -hw, hw, 0, F2,
            [{ c: -6, ...win }, { c: 0, ...door }, { c: 6, ...win }], FAC);
    }
    punchWallZ(-hw, -hd, hd, 0, F2, [{ c: 3, w: 2.4, b: 0, t: 2.3 }], FAC);
    punchWallZ(hw, -hd, hd, 0, F2, [{ c: -3, w: 2.4, b: 0, t: 2.3 }], FAC);
    // Vetrine + cornici + gradini d'ingresso
    for (const sz of [-1, 1]) {
        for (const wx of [-6, 6]) makeBox(2.5, 1.4, 0.1, MAT.glass, wx, 1.7, sz * hd);
        makeBox(3.4, 0.3, 0.55, MAT.trim, 0, 2.45, sz * hd);
        addSolid(4.0, 0.28, 1.2, 0, 0, sz * (hd + 0.7), MAT.concrete);
    }

    // ── SOLAIO del 2° piano (vano scala A nell'angolo NW: x -10..-6.6, z -7..-2.6) ──
    addSolid(W - holeW, 0.2, D, holeW / 2, F2 - 0.2, 0, MAT.woodFloor);   // lastra grande (x -6.6..10)
    addSolid(holeW, 0.2, D - holeD, -hw + holeW / 2, F2 - 0.2, -hd + holeD + (D - holeD) / 2, MAT.woodFloor);

    // ── SCALA A: terra → 2° piano (gradini bassi, step-up automatico) ──
    const nA = 7, stepHA = F2 / nA, stepDA = holeD / nA;
    for (let i = 0; i < nA; i++) {
        addSolid(holeW - 0.6, (i + 1) * stepHA, stepDA + 0.02,
                 -hw + holeW / 2, 0, -hd + (i + 0.5) * stepDA, MAT.concrete);
    }

    // ── SECONDO PIANO: finestroni bassi = postazioni di tiro su strada/piazza ──
    const win2 = { w: 3.0, b: F2 + 0.5, t: F2 + 2.0 };
    for (const sz of [-1, 1]) {
        punchWallX(sz * hd, -hw, hw, F2, ROOF - F2,
            [{ c: -6, ...win2 }, { c: 0, ...win2 }, { c: 6, ...win2 }], FAC);
    }
    const win2z = { w: 2.6, b: F2 + 0.5, t: F2 + 2.0 };
    for (const sx of [-1, 1]) {
        punchWallZ(sx * hw, -hd, hd, F2, ROOF - F2,
            [{ c: -3.5, ...win2z }, { c: 3.5, ...win2z }], FAC);
    }
    // Copertura interna al 2° piano
    crate(1.6, 0.6, 1.6, 5, F2, 3);
    crate(1.4, 0.6, 1.4, -4, F2, -4);

    // ── SCALA B: 2° piano → tetto (angolo SE; vano nel tetto x 6.6..10, z 2.6..7) ──
    const nB = 7, stepHB = (ROOF - F2) / nB, stepDB = holeD / nB;
    for (let i = 0; i < nB; i++) {
        addSolid(holeW - 0.6, (i + 1) * stepHB, stepDB + 0.02,
                 hw - holeW / 2, F2, hd - holeD + (i + 0.5) * stepDB, MAT.concrete);
    }

    // ── TETTO-TERRAZZA con vano scala B e parapetto (riparo basso in quota) ──
    addSolid(W - holeW, 0.25, D, -holeW / 2, ROOF - 0.2, 0, MAT.concrete);
    addSolid(holeW, 0.25, D - holeD, hw - holeW / 2, ROOF - 0.2, -holeD / 2, MAT.concrete);
    const py = ROOF + 0.05;   // base parapetto = quota calpestio del tetto
    addSolid(W + 0.3, 0.9, 0.3, 0, py, -hd, MAT.wall);
    addSolid(W + 0.3, 0.9, 0.3, 0, py, hd, MAT.wall);
    addSolid(0.3, 0.9, D + 0.3, -hw, py, 0, MAT.wall);
    addSolid(0.3, 0.9, D + 0.3, hw, py, 0, MAT.wall);
    // Cornicione bianco sotto la linea del tetto
    for (const sz of [-1, 1]) makeBox(W + 0.7, 0.35, 0.25, MAT.trim, 0, ROOF - 0.1, sz * (hd + 0.25));
    for (const sx of [-1, 1]) makeBox(0.25, 0.35, D + 0.7, MAT.trim, sx * (hw + 0.25), ROOF - 0.1, 0);
    // Prop sul tetto (comignoli/casse = ripari)
    addSolid(1.8, 1.1, 1.4, -5, py, -2, MAT.wall);
    addSolid(1.2, 0.8, 1.2, 3, py, 4, MAT.wall);
    crate(1.5, 0.9, 1.5, 2, py, -4);

    // ── Insegne + tende sulle vetrine ──
    // Insegna nella fascia cieca tra i due piani (non copre i finestroni)
    addSign('EMPORIO', 6, 0.9, 0, 2.85, hd + 0.24, 0);
    addSign('EMPORIO', 6, 0.9, 0, 2.85, -(hd + 0.24), Math.PI);
    for (const sz of [-1, 1]) {
        for (const wx of [-6, 6]) {
            const aw = makeBox(2.9, 0.07, 1.1, sz > 0 ? MAT.awningRed : MAT.awningBlue,
                               wx, 2.55, sz * (hd + 0.55));
            aw.rotation.x = sz * 0.35;
        }
    }

    // ── Interni piano terra: bancone a L + scaffalatura (corridoi stretti) ──
    addSolid(5.0, 1.0, 0.8, 3.0, 0, 2.0, MAT.stallWood);
    addSolid(0.8, 1.0, 3.0, 6.0, 0, 0.4, MAT.stallWood);
    addSolid(6.0, 2.1, 0.5, -2.5, 0, -2.0, MAT.crateDark);
    crate(1.4, 0.65, 1.4, -6, 0, 4);
    crate(1.2, 0.6, 1.2, 7.5, 0, -4.5);
}

// ── Bottega dell'anello: guscio enterable, tetto piano calpestabile ──
// face = direzione della vetrina ('N'|'S'|'E'|'W'), w = fronte, d = profondità.
// backDoor (solo facce E/W): retro-porta interattiva che sfonda verso il porto.
function buildShop(cx, cz, w, d, face, mat, name, awningMat, backDoor = false) {
    const H = 2.9, t = 0.3;
    const door = { w: 1.7, b: 0, t: 2.2 };
    const win = { w: Math.min(2.6, w - 4), b: 0.9, t: 2.3 };

    if (face === 'S' || face === 'N') {
        const s = (face === 'S') ? 1 : -1;
        const zf = cz + s * d / 2, zb = cz - s * d / 2;
        punchWallX(zf, cx - w / 2, cx + w / 2, 0, H,
            [{ c: cx - w / 4, ...door }, { c: cx + w / 4, ...win }], mat, t);
        punchWallX(zb, cx - w / 2, cx + w / 2, 0, H, [], mat, t);
        punchWallZ(cx - w / 2, cz - d / 2, cz + d / 2, 0, H, [], mat, t);
        punchWallZ(cx + w / 2, cz - d / 2, cz + d / 2, 0, H, [], mat, t);
        makeBox(win.w, 1.35, 0.08, MAT.glass, cx + w / 4, 1.6, zf);   // vetrina
        const aw = makeBox(win.w + 0.5, 0.06, 1.0, awningMat, cx + w / 4, 2.45, zf + s * 0.55);
        aw.rotation.x = s * 0.4;
        addSign(name, Math.min(w - 1.5, 5), 1.0, cx, H + 0.55, zf + s * 0.21,
                (face === 'S') ? 0 : Math.PI);
        addSolid(w - 2.4, 1.0, 0.9, cx, 0, cz - s * (d / 2 - 1.1), MAT.stallWood);  // banco
    } else {
        const s = (face === 'E') ? 1 : -1;
        const xf = cx + s * d / 2, xb = cx - s * d / 2;
        punchWallZ(xf, cz - w / 2, cz + w / 2, 0, H,
            [{ c: cz - w / 4, ...door }, { c: cz + w / 4, ...win }], mat, t);
        if (backDoor) {
            // Retro-porta interattiva; il banco si accorcia sull'altra metà
            punchWallZ(xb, cz - w / 2, cz + w / 2, 0, H,
                [{ c: cz + w / 4, w: 1.5, b: 0, t: 2.2 }], mat, t);
            buildDoor(xb, cz + w / 4, 1.5, 2.2, 'z', -s);
            addSolid(0.9, 1.0, w / 2 - 1.6, cx - s * (d / 2 - 1.1), 0, cz - w / 4, MAT.stallWood);
        } else {
            punchWallZ(xb, cz - w / 2, cz + w / 2, 0, H, [], mat, t);
            addSolid(0.9, 1.0, w - 2.4, cx - s * (d / 2 - 1.1), 0, cz, MAT.stallWood);
        }
        punchWallX(cz - w / 2, cx - d / 2, cx + d / 2, 0, H, [], mat, t);
        punchWallX(cz + w / 2, cx - d / 2, cx + d / 2, 0, H, [], mat, t);
        makeBox(0.08, 1.35, win.w, MAT.glass, xf, 1.6, cz + w / 4);
        const aw = makeBox(1.0, 0.06, win.w + 0.5, awningMat, xf + s * 0.55, 2.45, cz + w / 4);
        aw.rotation.z = -s * 0.4;
        addSign(name, Math.min(w - 1.5, 5), 1.0, xf + s * 0.21, H + 0.55, cz,
                (face === 'E') ? Math.PI / 2 : -Math.PI / 2);
    }
    // Tetto piano calpestabile
    addSolid(w + 0.3, 0.25, d + 0.3, cx, H, cz, MAT.roof);
}

// ── Bancarella del mercato: banco solido + montanti + tenda a strisce ──
function buildStall(x, z, alongX, awningMat) {
    const w = alongX ? 2.6 : 1.2, d = alongX ? 1.2 : 2.6;
    const counter = addSolid(w, 1.0, d, x, 0, z, MAT.stallWood);
    _addToonOutline(counter, MAT.ink);
    // Merce sul banco (visiva)
    makeBox(0.5, 0.28, 0.4, MAT.crate, x - (alongX ? 0.6 : 0), 1.14, z - (alongX ? 0 : 0.6));
    makeBox(0.4, 0.22, 0.35, MAT.crateDark, x + (alongX ? 0.5 : 0.1), 1.11, z + (alongX ? 0.1 : 0.5));
    // Montanti + tenda inclinata
    for (const s1 of [-1, 1]) {
        for (const s2 of [-1, 1]) {
            makeBox(0.08, 2.1, 0.08, MAT.stallWood,
                x + s1 * (w / 2 - 0.06), 1.05, z + s2 * (d / 2 - 0.06));
        }
    }
    const aw = makeBox(alongX ? w + 0.5 : 1.8, 0.06, alongX ? 1.8 : d + 0.5, awningMat, x, 2.2, z);
    aw.rotation[alongX ? 'x' : 'z'] = alongX ? 0.18 : -0.18;
    _addToonOutline(aw, MAT.ink, 0.6);
}

// ── Fontana della piazza (riparo basso: le teste ci spuntano sopra) ──
function buildFountain(x, z) {
    const rim = makeCyl(2.4, 2.5, 0.85, MAT.concrete, x, 0.425, z, 'y', 22);
    _addToonOutline(rim, MAT.ink, 0.8);
    makeCyl(2.1, 2.1, 0.1, MAT.water, x, 0.72, z, 'y', 22);            // specchio d'acqua
    const col = makeCyl(0.3, 0.42, 1.5, MAT.concrete, x, 1.6, z, 'y', 14);
    _addToonOutline(col, MAT.ink, 0.7);
    const bowl = makeCyl(0.85, 0.6, 0.28, MAT.concrete, x, 2.45, z, 'y', 18);
    _addToonOutline(bowl, MAT.ink, 0.7);
    makeCyl(0.1, 0.16, 0.5, MAT.water, x, 2.8, z, 'y', 10);            // zampillo
    solidBoxes.push({
        min: new THREE.Vector3(x - 2.4, 0, z - 2.4),
        max: new THREE.Vector3(x + 2.4, 0.85, z + 2.4)
    });
}

// ── Gazebo/palco della banda: pedana salibile + tetto conico ──
function buildGazebo(x, z) {
    const base = addSolid(5.2, 0.55, 5.2, x, 0, z, MAT.concrete);
    _addToonOutline(base, MAT.ink, 1.4);
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            addSolid(0.22, 2.6, 0.22, x + sx * 2.2, 0.55, z + sz * 2.2, MAT.trim);
        }
    }
    const cone = makeCyl(0.15, 3.6, 1.5, MAT.roof, x, 3.9, z, 'y', 8);
    _addToonOutline(cone, MAT.ink, 1.2);
    makeCyl(0.1, 0.1, 0.7, MAT.trim, x, 4.95, z, 'y', 8);   // pennone
}

// ── Lampione in ghisa (palo solido sottile + globo sempre acceso) ──
function buildLamppost(x, z) {
    const pole = makeCyl(0.045, 0.07, 3.0, MAT.iron, x, 1.5, z, 'y', 10);
    _addToonOutline(pole, MAT.ink, 0.7);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), MAT.lamp);
    globe.position.set(x, 3.15, z);
    scene.add(globe);
    solidBoxes.push({
        min: new THREE.Vector3(x - 0.1, 0, z - 0.1),
        max: new THREE.Vector3(x + 0.1, 3.0, z + 0.1)
    });
}

// ── Fondale: sagome di palazzi colorati oltre il muro (solo visivi) ──
function buildBackdrop() {
    const cols = [MAT.facadeCoral, MAT.facadeCream, MAT.facadeBlue, MAT.facadeMint, MAT.facadeMustard];
    const off = MAP_HALF + 2.4;
    const cxMap = (MAP_X1 - MAP_HALF) / 2;   // i lati nord/sud sono centrati sulla mappa estesa
    let k = 0;
    for (let i = -3; i <= 3; i++) {
        const p = i * 8.8;
        // [x, z, ruotato?] — est arretrato a MAP_X1 (oltre il porto)
        for (const [x, z, side] of [[cxMap + p, -off, false], [cxMap + p, off, false],
                                    [-off, p, true], [MAP_X1 + 2.4, p, true]]) {
            const hgt = 13 + ((k * 3) % 5);   // 13..17: spuntano oltre il muro (12)
            const m = cols[k % cols.length];
            makeBox(side ? 1.4 : 7.6, hgt, side ? 7.6 : 1.4, m, x, hgt / 2, z);
            makeBox(side ? 1.8 : 8.0, 0.5, side ? 8.0 : 1.8, MAT.trim, x, hgt + 0.2, z);
            k++;
        }
    }
}

// ── Nuvolette cartoon (MeshBasic: bianche piatte, da vignetta) ──
function buildClouds() {
    const spots = [[-30, 26, -50], [20, 32, -55], [45, 28, -10],
                   [40, 30, 35], [-15, 34, 48], [-45, 27, 15]];
    for (const [x, y, z] of spots) {
        const g = new THREE.Group();
        for (const [dx, dy, r] of [[-1.6, 0, 1.5], [0, 0.7, 2.1], [1.8, 0.1, 1.4], [0.4, -0.4, 1.6]]) {
            const b = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), MAT.cloud);
            b.scale.y = 0.62;
            b.position.set(dx, dy, 0);
            g.add(b);
        }
        g.position.set(x, y, z);
        scene.add(g);
    }
}

// ── Ruota a cilindro con cerchione (asse lungo Z, asse di rotolamento X) ──
function addWheel(x, z, cz, radius = 0.55, width = 0.34) {
    const off = Math.sign(z - cz) * (width / 2 - 0.02);
    const wz = z + off;
    makeCyl(radius, radius, width, MAT.tire, x, radius, wz, 'z', 18);
    makeCyl(radius * 0.42, radius * 0.42, width + 0.03, MAT.hubcap, x, radius, wz, 'z', 12);
}

// ── Furgone (copertura centrale — nella cittadina è il furgone dei gelati) ──
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
const HIP_Y = 0.62;   // quota dei fianchi: pivot di gambe e busto (mascotte toon)
// NB: gli helper toon (_toonGradMap, makeToonMat, _addToonOutline, ...) sono
// definiti prima della sezione MATERIALI, perché usati anche dal mondo (MAT).

// ══ ARMI CARTOON PROCEDURALI (stile rubber-hose anni '30) ══
// Un solo builder per FP e TP: canna verso -Z, ORIGINE AL GRIP, calcio a +Z.
// Materiali e contorni per-istanza (il mutatore "Fantasmi" fa setGroupOpacity
// sul group del giocatore: nulla dev'essere condiviso col mondo o con altri).
// Legno + canna blu-metallo + anelli d'ottone: palette da cartoon d'epoca.
function buildToonWeaponModel(key) {
    const g = new THREE.Group();
    const M = {
        wood:  makeToonMat(0x9a6230),
        wood2: makeToonMat(0x6e421c),
        metal: makeToonMat(0x4d5560),
        dark:  makeToonMat(0x2e3238),
        brass: makeToonMat(0xe0a83c),
    };
    const ink = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, side: THREE.BackSide });
    // Pezzo con contorno inchiostro
    const P = (geo, mat, x, y, z, opt = {}) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        g.add(m);
        if (!opt.noInk) _addToonOutline(m, ink, opt.tMul || 0.5);
        return m;
    };
    // Solido di rivoluzione con asse lungo Z: profilo = [[raggio, t], ...]
    // con t=0 sul retro del pezzo e t crescente verso la volata (-Z).
    // Posizionato con z = coordinata del RETRO del pezzo.
    const latheZ = (pts, mat, x, y, z, opt = {}) => {
        const v = pts.map(p => new THREE.Vector2(Math.max(p[0], 1e-4), p[1]));
        const geo = new THREE.LatheGeometry(v, opt.seg || 14);
        // opt.sx restringe lateralmente (baked in geometria + normali ricalcolate
        // così il contorno inchiostro resta di spessore uniforme)
        if (opt.sx) { geo.scale(opt.sx, 1, 1); geo.computeVertexNormals(); }
        const m = P(geo, mat, x, y, z, opt);
        m.rotation.x = -Math.PI / 2;   // +Y del lathe → -Z (verso la volata)
        return m;
    };
    // Tubo curvo (impugnature a banana, caricatori, leve). Punti assoluti
    // nello spazio dell'arma; opt.sx appiattisce lateralmente (x baked in
    // geometria, così lo spessore del contorno resta in unità mondo).
    const tube = (pts, r, mat, opt = {}) => {
        const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])));
        const geo = new THREE.TubeGeometry(curve, 10, r, 10, false);
        if (opt.sx) geo.scale(opt.sx, 1, 1);
        return P(geo, mat, 0, 0, 0, opt);
    };
    // Ellissoide (raggi baked in geometria: contorno con spessore corretto)
    const ell = (rx, ry, rz, mat, x, y, z, opt = {}) => {
        const geo = new THREE.SphereGeometry(1, 14, 12);
        geo.scale(rx, ry, rz);
        return P(geo, mat, x, y, z, opt);
    };
    const sph = (r, mat, x, y, z, opt = {}) =>
        P(new THREE.SphereGeometry(r, 12, 10), mat, x, y, z, opt);

    if (key === 'smg') {
        // ── THOMPSON M1928 toon ─────────────────────────────────────
        // Ricevitore a capsula, più stretto (radialmente e sui fianchi)
        latheZ([[0.001, 0], [0.026, 0.008], [0.037, 0.045], [0.038, 0.09],
                [0.035, 0.14], [0.028, 0.172], [0.001, 0.18]], M.metal, 0, 0.03, 0.07,
               { sx: 0.8 });
        // Pomello d'armamento in ottone, smussato e incassato nel dorso
        ell(0.010, 0.008, 0.014, M.brass, 0, 0.07, 0.01, { noInk: true });
        // Canna liscia affusolata (niente anelli di raffreddamento)
        latheZ([[0.014, 0], [0.015, 0.02], [0.012, 0.10], [0.011, 0.17]],
               M.dark, 0, 0.035, -0.11);
        // Bocca a cilindretto d'ottone, dritta (non si apre)
        latheZ([[0.011, 0], [0.0145, 0.004], [0.0145, 0.040], [0.011, 0.044],
                [0.001, 0.046]], M.brass, 0, 0.035, -0.28);
        // TAMBURO a DISCO PIATTO: asse lungo la canna, faccia circolare
        // rivolta in avanti (da davanti si vede il disco, non il profilo)
        latheZ([[0.001, 0], [0.052, 0.005], [0.061, 0.014], [0.061, 0.026],
                [0.052, 0.035], [0.001, 0.040]], M.dark, 0, -0.045, -0.025, { seg: 18 });
        // Perno d'ottone passante (spunta dalle due facce del disco)
        const hub = P(new THREE.CylinderGeometry(0.012, 0.012, 0.052, 12),
                      M.brass, 0, -0.045, -0.045, { noInk: true });
        hub.rotation.x = Math.PI / 2;
        // Pistol grip a banana con tallone piatto svasato
        tube([[0, 0.015, 0.04], [0, -0.05, 0.062], [0, -0.095, 0.082]], 0.021, M.wood2);
        const smgCap = ell(0.026, 0.012, 0.029, M.wood2, 0, -0.095, 0.082);
        smgCap.rotation.x = -0.42;
        // Ponticello e grilletto in ottone davanti al pistol grip
        tube([[0, -0.002, 0.005], [0, -0.03, 0.012], [0, -0.032, 0.035],
              [0, -0.008, 0.045]], 0.0045, M.brass, { noInk: true });
        tube([[0, -0.008, 0.02], [0, -0.022, 0.025]], 0.0035, M.brass, { noInk: true });
        // Foregrip verticale a banana con tallone piatto
        tube([[0, 0.028, -0.155], [0, -0.045, -0.150], [0, -0.09, -0.135]], 0.019, M.wood);
        const smgCap2 = ell(0.024, 0.011, 0.027, M.wood, 0, -0.09, -0.135);
        smgCap2.rotation.x = -0.32;
        // Calcio col DROP: pancia più contenuta
        tube([[0, 0.03, 0.02], [0, 0.015, 0.13], [0, -0.012, 0.185]], 0.020, M.wood);
        ell(0.023, 0.044, 0.043, M.wood, 0, -0.016, 0.198);
        ell(0.018, 0.040, 0.011, M.brass, 0, -0.018, 0.235, { noInk: true });
    } else if (key === 'shotgun') {
        // ── DOPPIETTA ───────────────────────────────────────────────
        // Castello tondo, COASSIALE con la canna (stesso asse y=0.03)
        latheZ([[0.001, 0], [0.036, 0.01], [0.046, 0.05], [0.042, 0.10],
                [0.032, 0.125], [0.028, 0.13]], M.metal, 0, 0.03, 0.075);
        // Canna affusolata: parte da DENTRO il naso del castello
        latheZ([[0.024, 0], [0.021, 0.12], [0.019, 0.25]], M.metal, 0, 0.03, -0.035);
        // Anello d'ottone di raccordo castello→canna (copre lo snodo)
        latheZ([[0.024, 0], [0.031, 0.005], [0.031, 0.028], [0.024, 0.033]],
               M.brass, 0, 0.03, -0.045);
        // Bocca: fascetta d'ottone dritta (niente tromba)
        latheZ([[0.019, 0], [0.026, 0.006], [0.026, 0.055], [0.021, 0.062],
                [0.001, 0.064]], M.brass, 0, 0.03, -0.285);
        // Astina panciuta sotto la canna
        ell(0.028, 0.030, 0.085, M.wood, 0, -0.002, -0.16);
        // Impugnatura a banana con tallone piatto + ponticello e grilletto
        tube([[0, 0.02, 0.055], [0, -0.03, 0.07], [0, -0.06, 0.085]], 0.018, M.wood2);
        const sgCap = ell(0.023, 0.011, 0.026, M.wood2, 0, -0.06, 0.085);
        sgCap.rotation.x = -0.46;
        tube([[0, -0.005, 0.012], [0, -0.032, 0.02], [0, -0.034, 0.042],
              [0, -0.008, 0.052]], 0.0045, M.brass, { noInk: true });   // ponticello
        tube([[0, -0.010, 0.026], [0, -0.024, 0.031]], 0.0035, M.brass,
             { noInk: true });                                          // grilletto
        // Calcio a pera: pancia più contenuta
        tube([[0, 0.025, 0.02], [0, 0.005, 0.14], [0, -0.012, 0.19]], 0.022, M.wood);
        ell(0.026, 0.043, 0.064, M.wood, 0, -0.010, 0.20);
        ell(0.021, 0.042, 0.013, M.wood2, 0, -0.012, 0.256);
        // Cane a virgola in ottone
        tube([[0, 0.055, 0.055], [0, 0.082, 0.045], [0, 0.09, 0.028]], 0.008, M.brass);
        sph(0.011, M.brass, 0, 0.091, 0.026);
    } else if (key === 'sniper') {
        // ── FUCILE DI PRECISIONE ────────────────────────────────────
        // Corpo in legno fluido: pancia-calcio, vita, avancorpo
        latheZ([[0.001, 0], [0.034, 0.012], [0.046, 0.05], [0.036, 0.12],
                [0.040, 0.20], [0.030, 0.26], [0.001, 0.29]], M.wood, 0, 0.01, 0.24);
        // Calciolo: appoggiato contro la pancia del calcio (come le altre armi),
        // copre anche la punta del lathe
        ell(0.026, 0.040, 0.012, M.wood2, 0, 0.01, 0.232, { noInk: true });
        // AZIONE in metallo coassiale con la canna: raccorda corpo→canna
        latheZ([[0.001, 0], [0.024, 0.008], [0.030, 0.04], [0.030, 0.09],
                [0.022, 0.125], [0.016, 0.14]], M.metal, 0, 0.028, 0.055);
        // Ghiera d'ottone allo snodo azione→canna
        latheZ([[0.015, 0], [0.019, 0.004], [0.019, 0.02], [0.015, 0.024]],
               M.brass, 0, 0.028, -0.078);
        // Canna quasi A SPILLO (continua il profilo dell'azione)
        latheZ([[0.016, 0], [0.012, 0.22], [0.008, 0.49]], M.metal, 0, 0.028, -0.08);
        // Bocca a cilindretto d'ottone, dritta (non si apre)
        latheZ([[0.008, 0], [0.011, 0.003], [0.011, 0.030], [0.008, 0.033],
                [0.001, 0.035]], M.brass, 0, 0.028, -0.57);
        // Impugnatura a banana con tallone piatto svasato
        tube([[0, 0.0, 0.13], [0, -0.045, 0.145], [0, -0.075, 0.16]], 0.019, M.wood2);
        const snCap = ell(0.024, 0.011, 0.027, M.wood2, 0, -0.075, 0.16);
        snCap.rotation.x = -0.46;
        // Ponticello e grilletto in ottone davanti all'impugnatura
        tube([[0, -0.012, 0.095], [0, -0.04, 0.102], [0, -0.042, 0.125],
              [0, -0.018, 0.135]], 0.0045, M.brass, { noInk: true });
        tube([[0, -0.018, 0.108], [0, -0.032, 0.113]], 0.0035, M.brass, { noInk: true });
        // Supporti scopone
        P(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 10), M.metal, 0, 0.062, 0.04);
        P(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 10), M.metal, 0, 0.062, -0.04);
        // SCOPONE a botte
        latheZ([[0.001, 0], [0.034, 0.006], [0.040, 0.03], [0.047, 0.08],
                [0.040, 0.13], [0.034, 0.154], [0.001, 0.16]], M.dark, 0, 0.095, 0.08);
        // Ghiere in ottone
        latheZ([[0.036, 0], [0.043, 0.004], [0.043, 0.016], [0.036, 0.02]],
               M.brass, 0, 0.095, 0.075);
        latheZ([[0.036, 0], [0.043, 0.004], [0.043, 0.016], [0.036, 0.02]],
               M.brass, 0, 0.095, -0.055);
        // Lente celeste
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.030, 0.006, 14),
            new THREE.MeshBasicMaterial({ color: 0xbfe8ff }));
        lens.rotation.x = Math.PI / 2;
        lens.position.set(0, 0.095, -0.082);
        g.add(lens);
        // Otturatore a sferetta con levetta curva (incassato nel corpo)
        sph(0.020, M.brass, 0.04, 0.04, 0.08, { noInk: true });
        tube([[0.04, 0.04, 0.08], [0.07, 0.03, 0.085], [0.078, 0.008, 0.09]], 0.007, M.brass);
        sph(0.010, M.brass, 0.078, 0.006, 0.09, { noInk: true });
    } else {
        // ── FUCILE D'ASSALTO ────────────────────────────────────────
        // Castello a capsula bombata
        latheZ([[0.001, 0], [0.034, 0.01], [0.048, 0.06], [0.050, 0.12],
                [0.044, 0.18], [0.030, 0.22], [0.001, 0.23]], M.metal, 0, 0.035, 0.07);
        // Maniglia/dorso tondo
        tube([[0, 0.088, 0.03], [0, 0.096, -0.03], [0, 0.088, -0.09]], 0.016, M.dark);
        sph(0.018, M.dark, 0, 0.088, 0.03);
        sph(0.018, M.dark, 0, 0.088, -0.09);
        // Canna affusolata
        latheZ([[0.018, 0], [0.015, 0.12], [0.013, 0.22]], M.metal, 0, 0.045, -0.16);
        // Bocca a cilindro d'ottone, dritta (non si apre)
        latheZ([[0.013, 0], [0.017, 0.004], [0.017, 0.042], [0.013, 0.046],
                [0.001, 0.048]], M.brass, 0, 0.045, -0.38);
        // Mirino dettagliato: base conica, gambo, collarino, perlina e puntina
        P(new THREE.CylinderGeometry(0.006, 0.010, 0.018, 10),
          M.dark, 0, 0.058, -0.36, { noInk: true });
        P(new THREE.CylinderGeometry(0.004, 0.004, 0.020, 8),
          M.brass, 0, 0.076, -0.36, { noInk: true });
        ell(0.0075, 0.003, 0.0075, M.dark, 0, 0.0805, -0.36, { noInk: true });
        sph(0.010, M.brass, 0, 0.091, -0.36);
        sph(0.0045, M.dark, 0, 0.10, -0.36, { noInk: true });
        // Paramano in legno gonfio attorno alla canna
        ell(0.030, 0.034, 0.075, M.wood, 0, 0.038, -0.21);
        // Caricatore a BANANA (appiattito in x, parte da DENTRO il castello)
        tube([[0, 0.01, -0.06], [0, -0.075, -0.085], [0, -0.125, -0.13]],
             0.030, M.dark, { sx: 0.55 });
        ell(0.0165, 0.030, 0.030, M.dark, 0, -0.125, -0.13);
        // Impugnatura a banana con tallone piatto svasato
        tube([[0, 0.015, 0.03], [0, -0.055, 0.045], [0, -0.09, 0.062]], 0.021, M.wood2);
        const arCap = ell(0.026, 0.012, 0.029, M.wood2, 0, -0.09, 0.062);
        arCap.rotation.x = -0.45;
        // Ponticello e grilletto in ottone davanti all'impugnatura
        tube([[0, -0.005, -0.005], [0, -0.035, 0.003], [0, -0.037, 0.028],
              [0, -0.012, 0.038]], 0.0045, M.brass, { noInk: true });
        tube([[0, -0.012, 0.012], [0, -0.027, 0.017]], 0.0035, M.brass, { noInk: true });
        // Calcio a pera: pancia più contenuta
        tube([[0, 0.035, 0.02], [0, 0.01, 0.13], [0, -0.008, 0.19]], 0.021, M.wood);
        ell(0.026, 0.046, 0.06, M.wood, 0, -0.008, 0.205);
        ell(0.021, 0.043, 0.013, M.wood2, 0, -0.010, 0.252);
    }
    return g;
}

// Modello d'arma in TERZA PERSONA: stesso builder cartoon, leggermente ridotto
// (montato nelle mani del modello remoto, canna -z, grip nel guantone).
function buildTPWeapon(weaponKey) {
    const g = buildToonWeaponModel(weaponKey || 'assault');
    g.scale.setScalar(0.95);   // le forme curve rendono meno del vecchio 0.8: quasi 1:1
    return g;
}

// Sostituisce l'arma in terza persona di un giocatore remoto (se cambia tipo)
function setRemoteWeapon(rp, weaponKey) {
    if (!rp.weaponMount || !weaponKey || rp.weaponKey === weaponKey) return;
    while (rp.weaponMount.children.length) rp.weaponMount.remove(rp.weaponMount.children[0]);
    rp.weaponMount.add(buildTPWeapon(weaponKey));
    rp.weaponKey = weaponKey;
}

// ── TESTA-MASCOTTE riutilizzabile ──────────────────────────────────────────
// Un'unica fonte per la testa toon (cranio crema, occhioni, naso, grin, elmetto
// team): usata dal modello giocatore, dai trofei a terra e dal podio finale.
// La faccia guarda verso -Z. Materiali e contorni per-istanza (Fantasmi ok).
function buildMascotHead(color, s = 1) {
    const teamCol = new THREE.Color(color);
    const M = {
        team: makeToonMat(teamCol),
        dark: makeToonMat(teamCol.clone().multiplyScalar(0.55)),
        skin: makeToonMat(0xf7ecd7),
        pink: makeToonMat(0xe98a6f),
        white: makeToonMat(0xffffff, false),
        black: makeToonMat(0x141414, false),
    };
    const outMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, side: THREE.BackSide });
    const g = new THREE.Group();
    const part = (geo, mat, parent, opt = {}) => {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        (parent || g).add(m);
        if (!opt.noOutline) _addToonOutline(m, outMat, opt.tMul || 1);
        return m;
    };

    part(new THREE.SphereGeometry(0.28, 28, 20), M.skin);              // cranio

    // Occhi espressivi: ovali bianchi, pupilloni con luccichio, sopracciglia
    const eyeGeo = new THREE.SphereGeometry(0.075, 16, 12);
    eyeGeo.scale(1, 1.55, 0.5);
    const pupilGeo = new THREE.SphereGeometry(0.045, 14, 10);
    pupilGeo.scale(1, 1.35, 0.6);
    const browArc = Math.PI * 0.55;
    for (const sx of [-1, 1]) {
        part(eyeGeo, M.white, g, { noOutline: true })
            .position.set(sx * 0.095, 0.035, -0.235);
        part(pupilGeo, M.black, g, { noOutline: true })
            .position.set(sx * 0.088, 0.012, -0.262);
        part(new THREE.SphereGeometry(0.015, 8, 6), M.white, g, { noOutline: true })
            .position.set(sx * 0.088 - 0.015, 0.042, -0.279);          // luccichio
        const brow = part(new THREE.TorusGeometry(0.055, 0.012, 6, 14, browArc),
            M.black, g, { noOutline: true });
        brow.position.set(sx * 0.10, 0.105, -0.246);
        brow.rotation.set(0.42, 0, Math.PI / 2 - browArc / 2 + sx * 0.16);
    }
    const noseGeo = new THREE.SphereGeometry(0.05, 14, 10);
    noseGeo.scale(1, 0.8, 0.8);
    part(noseGeo, M.pink, g, { tMul: 0.5 }).position.set(0, -0.07, -0.275);

    // Sorriso "grin" con puntini agli angoli, inclinato sulla curvatura della faccia
    const smileArc = Math.PI * 0.85;
    const smile = part(new THREE.TorusGeometry(0.082, 0.015, 8, 24, smileArc),
        M.black, g, { noOutline: true });
    smile.position.set(0, -0.132, -0.238);
    smile.rotation.set(-0.50, 0, -Math.PI / 2 - smileArc / 2);
    for (const a of [0, smileArc]) {
        part(new THREE.SphereGeometry(0.018, 10, 8), M.black, smile, { noOutline: true })
            .position.set(0.082 * Math.cos(a), 0.082 * Math.sin(a), 0);
    }

    // Elmetto "indossato": calotta schiacciata inclinata all'indietro + bordino
    const helmet = new THREE.Group();
    helmet.position.set(0, 0.115, 0.015);
    helmet.rotation.x = 0.16;
    g.add(helmet);
    const domeGeo = new THREE.SphereGeometry(0.30, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5);
    domeGeo.scale(1, 0.8, 1);
    part(domeGeo, M.team, helmet);
    const rim = part(new THREE.TorusGeometry(0.30, 0.022, 8, 26), M.dark, helmet, { tMul: 0.5 });
    rim.rotation.x = Math.PI / 2;

    g.scale.setScalar(s);
    return g;
}

function createPlayerMesh(color, weaponKey) {
    const group = new THREE.Group();
    // Il modello guarda verso -Z (forward del gioco quando yaw = 0).
    // Mascotte "rubber-hose" (stile validato nel prototipo fps-toon-proto):
    // testa tonda crema, elmetto colore-squadra, arti a tubo neri, guantoni.

    const teamCol = new THREE.Color(color);
    const darkCol = teamCol.clone().multiplyScalar(0.55);
    const M = {
        team: makeToonMat(teamCol),
        dark: makeToonMat(darkCol),
        skin: makeToonMat(0xf7ecd7),      // faccia crema
        limb: makeToonMat(0x23201d),      // arti "a tubo" neri
        glove: makeToonMat(0xf4f0e6),     // guantoni/ghette bianchi
        boot: makeToonMat(0x6b4020),      // scarponi marroni
        pink: makeToonMat(0xe98a6f),      // naso
        white: makeToonMat(0xffffff, false),
        black: makeToonMat(0x141414, false)
    };
    // Contorno per-personaggio: istanza dedicata per il mutatore "Fantasmi"
    const outMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, side: THREE.BackSide });

    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

    // part() aggiunge una mesh (+ contorno inchiostro) a un parent
    function part(geo, mat, parent, opt = {}) {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        (parent || group).add(m);
        if (!opt.noOutline) _addToonOutline(m, outMat, opt.tMul || 1);
        return m;
    }
    // Cilindro "rubber-hose" tra due punti (arti a tubo)
    function tube(a, b, r, mat, parent, opt = {}) {
        const dir = new THREE.Vector3().subVectors(b, a);
        const len = dir.length();
        const m = part(new THREE.CylinderGeometry(r, r, len, 12, 1), mat, parent, opt);
        m.position.copy(a).addScaledVector(dir, 0.5);
        m.quaternion.setFromUnitVectors(UP_VEC, dir.normalize());
        return m;
    }

    // ── UPPER: busto + testa + braccia (pivot ai fianchi per crouch/slide) ──
    const upper = new THREE.Group();
    upper.position.y = HIP_Y;
    group.add(upper);

    // Busto tondeggiante (salopette colore-squadra) + fascia in vita + bottoni
    const torsoGeo = new THREE.SphereGeometry(0.25, 24, 18);
    torsoGeo.scale(1.0, 1.16, 0.82);
    part(torsoGeo, M.team, upper).position.set(0, 0.24, 0);
    part(new THREE.CylinderGeometry(0.21, 0.22, 0.08, 20), M.dark, upper)
        .position.set(0, 0.02, 0);
    for (const [by, bz] of [[0.31, -0.195], [0.19, -0.222]]) {
        part(new THREE.SphereGeometry(0.028, 10, 8), M.dark, upper, { noOutline: true })
            .position.set(0, by, bz);
    }
    part(new THREE.CylinderGeometry(0.06, 0.06, 0.10, 12), M.skin, upper, { noOutline: true })
        .position.set(0, 0.52, 0);                                     // collo

    // ── TESTA (gruppo separato → mutatore Teste Giganti via head.scale) ──
    // Contenuto costruito da buildMascotHead: FONTE UNICA condivisa con
    // trofei a terra e podio finale (niente più teste "vecchie" in giro).
    const head = new THREE.Group();
    head.position.set(0, 0.76, 0);
    upper.add(head);
    head.add(buildMascotHead(color));

    // ── BRACCIA rubber-hose: spalla → gomito → guantone ──
    const shR = V3(0.23, 0.40, 0), elR = V3(0.31, 0.17, -0.09), haR = V3(0.27, 0.23, -0.27);
    const shL = V3(-0.23, 0.40, 0), elL = V3(-0.31, 0.15, 0.02), haL = V3(-0.31, -0.04, -0.05);
    for (const [sh, el, ha, thumbOff] of [
        [shR, elR, haR, V3(-0.07, 0.03, 0.01)],
        [shL, elL, haL, V3(0.06, 0.03, -0.02)]
    ]) {
        part(new THREE.SphereGeometry(0.06, 12, 10), M.limb, upper, { noOutline: true })
            .position.copy(sh);
        tube(sh, el, 0.045, M.limb, upper);
        part(new THREE.SphereGeometry(0.05, 12, 10), M.limb, upper, { noOutline: true })
            .position.copy(el);
        tube(el, ha, 0.045, M.limb, upper);
        const dirBack = el.clone().sub(ha).normalize();
        tube(ha.clone().addScaledVector(dirBack, 0.05),
             ha.clone().addScaledVector(dirBack, 0.12), 0.065, M.dark, upper);  // polsino
        part(new THREE.SphereGeometry(0.085, 16, 12), M.glove, upper).position.copy(ha);
        part(new THREE.SphereGeometry(0.038, 10, 8), M.glove, upper, { noOutline: true })
            .position.copy(ha.clone().add(thumbOff));                  // pollice
    }

    // ── Arma in terza persona (grip alla mano destra, canna verso -Z) ──
    const weaponMount = new THREE.Group();
    weaponMount.position.copy(haR);
    upper.add(weaponMount);
    weaponMount.add(buildTPWeapon(weaponKey || 'assault'));

    // ── Gambe: tubi neri + ghette + scarponi tondi (pivot all'anca) ──
    function makeLeg(sx) {
        const leg = new THREE.Group();
        leg.position.set(sx * 0.10, HIP_Y, 0);
        group.add(leg);
        part(new THREE.SphereGeometry(0.052, 12, 10), M.limb, leg, { noOutline: true });
        tube(V3(0, 0, 0), V3(0, -0.44, 0), 0.047, M.limb, leg);
        part(new THREE.CylinderGeometry(0.062, 0.075, 0.055, 14), M.glove, leg)
            .position.set(0, -0.435, 0);                               // ghetta
        const boot = new THREE.Group();
        boot.position.set(0, -0.52, -0.02);
        leg.add(boot);
        const bootGeo = new THREE.SphereGeometry(0.09, 18, 14);
        bootGeo.scale(0.95, 0.72, 1.55);
        part(bootGeo, M.boot, boot).position.set(0, -0.025, -0.045);
        const toeGeo = new THREE.SphereGeometry(0.085, 16, 12);
        toeGeo.scale(1, 0.8, 1.1);
        part(toeGeo, M.boot, boot).position.set(0, -0.03, -0.13);      // punta bombata
        part(new THREE.SphereGeometry(0.075, 14, 10), M.boot, boot, { noOutline: true })
            .position.set(0, 0.03, 0.03);                              // tallone/caviglia
        return leg;
    }
    const legL = makeLeg(-1);
    const legR = makeLeg(1);

    head.scale.setScalar(headScale);   // mutatore "Teste Giganti"

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
// Usa la testa-mascotte vera (buildMascotHead), non più il vecchio box squadrato.
function makeTrophyHead(color, x, y, z) {
    const g = new THREE.Group();
    const spikeH = 0.34;
    const spike = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.03, spikeH, 10), makeToonMat(0x2e3238));
    spike.position.y = spikeH / 2;
    spike.castShadow = true;
    g.add(spike);
    _addToonOutline(spike,
        new THREE.MeshBasicMaterial({ color: 0x1a1a1a, side: THREE.BackSide }), 1);

    const HEAD_S = 0.8;   // un filo ridotta rispetto al vivo: è un trofeo
    const head = buildMascotHead(color, HEAD_S);
    head.position.y = spikeH + 0.28 * HEAD_S;   // cranio appoggiato sull'astina
    g.add(head);

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

// Testa "da impilare" nel colore-team: la stessa testa-mascotte dei giocatori.
// A scala 0.8 l'ingombro verticale (~0.51) combacia con HEAD_H=0.5 della torre.
function makePodiumHead(color) {
    const head = buildMascotHead(color, 0.8);
    head.rotation.y = Math.PI;   // la faccia guarda -Z → girata verso la camera (+Z)
    return head;
}

// Etichetta punteggio (sprite canvas) sopra ogni colonna
function makePointsLabel(pts, color) {
    const cvs = document.createElement('canvas');
    cvs.width = 256; cvs.height = 128;
    const c = cvs.getContext('2d');
    c.font = 'bold 76px Fredoka, Arial, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 8; c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.strokeText('☠︎ ' + pts, 128, 66);
    c.fillStyle = color;
    c.fillText('☠︎ ' + pts, 128, 64);
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
    // Camera fissa e frontale (impostata in buildPodium): nessuna oscillazione.
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

// Tutte le armi sono ancorate a destra e in basso, canna in avanti (-z).
// Offset X destro arma FP. In ADS (non-sniper) il weaponGroup viene lerpato verso il
// centro (iron sights): offset 0.06-GX sul gruppo porta il totale a 0.06.
const GX = 0.24;

// Posa FP per-arma: l'origine del modello è al GRIP → lo mettiamo nel guantone.
// rz negativo = roll CW che mostra più superficie superiore.
const _FP_CFG = {
    assault: { pos: [GX, -0.215, -0.40], rot: [0.05, 0, -0.06] },
    smg:     { pos: [GX, -0.215, -0.40], rot: [0.05, 0, -0.06] },
    shotgun: { pos: [GX, -0.215, -0.40], rot: [0.05, 0, -0.06] },
    sniper:  { pos: [GX, -0.225, -0.38], rot: [0.04, 0, -0.05] },
};

// Viewmodel FP: armi cartoon procedurali (nessun caricamento asincrono).
// I contorni inchiostro sui primitivi (sfere/cilindri/box) sono puliti anche
// da vicino — il glitch nero riguardava solo gli hull dei vecchi GLB.
function buildWeaponModels() {
    Object.entries(_FP_CFG).forEach(([key, cfg]) => {
        const group = new THREE.Group();
        group.visible = false;
        weaponGroup.add(group);
        weaponModels[key] = group;

        const model = buildToonWeaponModel(key);
        model.traverse(o => { if (o.isMesh) o.castShadow = false; });
        group.position.set(...cfg.pos);
        group.rotation.set(...cfg.rot);
        group.add(model);
    });
}

buildWeaponModels();

// ── Braccio destro FP (stile mascotte rubber-hose) ────────────────────────────
// Figlio di weaponGroup → si muove automaticamente col bob e col lerp ADS iron sights.
// Tubo nero + polsino + guantone bianco, coerente col modello giocatore toon.
// Le impugnature curve scendono sotto/dietro l'origine del modello (e quella del
// cecchino è molto più arretrata): la mano vive in un gruppo riposizionato
// per-arma sul CENTRO del grip, così il guantone avvolge l'impugnatura e non
// ingloba più il corpo dell'arma.
const FP_HAND_ANCHOR = {                    // pos del gruppo-mano in weaponGroup
    assault: [GX, -0.255, -0.355],
    smg:     [GX, -0.255, -0.345],
    shotgun: [GX, -0.24,  -0.33],
    // Il grip vero del cecchino (z -0.235) cade fuori schermo: mano avanzata
    // sul legno, appena dentro il bordo inferiore → se ne vede solo un accenno
    sniper:  [GX, -0.245, -0.31],
};
let fpHand = null;
(function buildFPArm() {
    const matLimb  = makeToonMat(0x23201d);   // braccio "a tubo" nero
    const matGlove = makeToonMat(0xf4f0e6);   // guantone bianco (mitten)
    fpHand = new THREE.Group();
    fpHand.position.set(...FP_HAND_ANCHOR.assault);
    weaponGroup.add(fpHand);

    // Guantone (mitten): palmo ovale che avvolge il grip + massa dita + pollice
    // (contenuto: deve stringere l'impugnatura, non coprire l'arma)
    const gloveGeo = new THREE.SphereGeometry(0.052, 16, 12);
    gloveGeo.scale(1, 0.82, 1.22);
    const glove = new THREE.Mesh(gloveGeo, matGlove);
    glove.rotation.x = -0.25;
    fpHand.add(glove);
    const fingersGeo = new THREE.SphereGeometry(0.038, 12, 10);
    fingersGeo.scale(1, 0.85, 1.1);
    const fingers = new THREE.Mesh(fingersGeo, matGlove);
    fingers.position.set(0, -0.025, -0.04);   // dita chiuse sul davanti del grip
    fpHand.add(fingers);
    const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), matGlove);
    thumb.position.set(-0.04, 0.012, 0.012);  // pollice sul lato interno
    fpHand.add(thumb);

    // Avambraccio a tubo: emerge da fuori schermo (basso-destra) verso il guanto.
    // rx=-0.40 → estremità -Z verso il grip, estremità +Z fuori schermo in basso.
    const arm = new THREE.Group();
    arm.position.set(0.03, -0.245, 0.25);     // relativo al gruppo-mano
    arm.rotation.set(-0.40, 0, 0.08);
    fpHand.add(arm);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.048, 0.55, 12), matLimb);
    tube.rotation.x = Math.PI / 2;
    arm.add(tube);
    // Polsino BIANCO svasato (il classico bordo del guanto cartoon)
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.055, 12), matGlove);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, 0, -0.25);
    arm.add(cuff);
})();

function switchWeaponModel(key) {
    Object.values(weaponModels).forEach(g => g.visible = false);
    if (weaponModels[key]) weaponModels[key].visible = true;
    // La mano segue il grip dell'arma corrente
    if (fpHand && FP_HAND_ANCHOR[key]) fpHand.position.set(...FP_HAND_ANCHOR[key]);
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
    // Consenti l'aggancio anche durante l'intro (fallback se l'arma è stata
    // auto-confermata allo scadere del timer, senza click su "Confirm").
    const canLock = gameState.phase === 'playing' || gameState.phase === 'round_intro';
    if (!pointerLocked && canLock && !gameState.isDead) {
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

// ── DIAGNOSTICA (console F12): stato completo quando lo sparo è bloccato o parte.
// Rate-limited a 1/s per non inondare la console con le armi automatiche.
let _dbgLastLog = 0;
function dbgShoot(msg) {
    const now = Date.now();
    if (now - _dbgLastLog < 1000) return;
    _dbgLastLog = now;
    const vivi = Object.entries(gameState.players).filter(([, rp]) => !rp.dead).map(([c]) => c);
    console.log(`[FPS] ${msg} | phase=${gameState.phase} isDead=${gameState.isDead} lock=${pointerLocked}` +
        ` reload=${isReloading} ammo=${gameState.myAmmo} arma=${gameState.myWeapon} mut=${gameState.mutator}` +
        ` | remoti vivi: [${vivi.join(', ')}] su ${Object.keys(gameState.players).length}`);
}

function tryShoot() {
    if (!pointerLocked || gameState.isDead || gameState.phase !== 'playing') { dbgShoot('sparo BLOCCATO'); return; }
    if (isReloading) { dbgShoot('sparo BLOCCATO (ricarica)'); return; }

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
        // Quote tarate sulla mascotte toon: testa sferica r 0.28 con centro a
        // 1.38 (in piedi); headOff = distanza del centro-testa dal top capsula.
        const a = rp.anim;
        let y0 = 0.25, y1 = 1.70, r = 0.42, headOff = 0.32;
        if (a && a.slide) { y0 = 0.20; y1 = 1.05; r = 0.42; headOff = 0.20; }
        else if (a && a.crouch) { y0 = 0.30; y1 = 1.42; r = 0.44; headOff = 0.32; }
        // Mini Giocatori: il modello remoto è scalato, quindi scala anche la hitbox
        if (sizeMul !== 1) { y0 *= sizeMul; y1 *= sizeMul; r *= sizeMul; headOff *= sizeMul; }

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
        const headBase = (gameState.mutator === 'giant_heads') ? 0.56   // r 0.28 × scala 2.0
                       : (gameState.mutator === 'headshot_only') ? 0.34   // un filo più permissiva
                       : 0.28;                                            // = raggio visivo del cranio
        const headR = headBase * sizeMul;
        const headCy = py + y1 - headOff;   // centro testa, segue postura e taglia
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
            // Sbuffetto + stelline comiche sul punto colpito (niente sangue),
            // un filo più marcato sulle headshot
            const hitP = origin.clone().addScaledVector(dir, Math.max(bestDist - 0.15, 0.3));
            spawnFxSprite(getFxTexture('puff'), hitP, {
                size: bestHead ? 0.34 : 0.26, life: 300, rise: 0.25, drift: 0.08, spin: 0.7
            });
            const nTw = bestHead ? 3 : 2;
            for (let i = 0; i < nTw; i++) {
                _fxSpawnPos.set(hitP.x + (Math.random() - 0.5) * 0.35,
                                hitP.y + (Math.random() - 0.5) * 0.35,
                                hitP.z + (Math.random() - 0.5) * 0.35);
                spawnFxSprite(getFxTexture(bestHead && i === 0 ? 'star' : 'twinkle'), _fxSpawnPos, {
                    size: 0.10 + Math.random() * 0.07, life: 260 + Math.random() * 120,
                    rise: 0.35, drift: 0.15, spin: 2.5
                });
            }
        }
        socket.emit('reportHit', {
            lobbyId: LOBBY_ID,
            shooterColor: MY_COLOR,
            targetColor: bestColor,
            weaponKey: gameState.myWeapon,
            headshot: bestHead
        });
        dbgShoot(`sparo → COLPITO ${bestColor}${bestHead ? ' (testa)' : ''}`);
    } else if (wall) {
        // Sbuffi di fumo tondi grigio-panna sull'impatto, arretrati lungo il
        // raggio per non compenetrare la superficie, più una scintilla
        const puffs = 2 + (Math.random() < 0.5 ? 1 : 0);
        for (let i = 0; i < puffs; i++) {
            _fxSpawnPos.copy(wall.point).addScaledVector(dir, -0.08);
            _fxSpawnPos.x += (Math.random() - 0.5) * 0.16;
            _fxSpawnPos.y += (Math.random() - 0.5) * 0.16;
            _fxSpawnPos.z += (Math.random() - 0.5) * 0.16;
            spawnFxSprite(getFxTexture('puff'), _fxSpawnPos, {
                size: 0.20 + Math.random() * 0.12, life: 340 + Math.random() * 140,
                rise: 0.28, drift: 0.12, spin: 0.9, tint: 0xd8d2c4
            });
        }
        _fxSpawnPos.copy(wall.point).addScaledVector(dir, -0.08);
        spawnFxSprite(getFxTexture('twinkle'), _fxSpawnPos, { size: 0.09, life: 240, rise: 0.4, spin: 3 });
        // Colpire una porta chiusa la spalanca per un attimo
        const hitDoor = doors.find(dd => dd.box === wall.box);
        if (hitDoor) hitDoor.forceUntil = performance.now() + 1600;
    }

    if (!bestColor) dbgShoot('sparo → nessun bersaglio nel raggio');

    // Prop distruttibili cosmetici lungo la traiettoria (non fermano il colpo)
    checkBreakables(origin, dir, tracerDist);

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
const _tracerEnd = new THREE.Vector3();
const _tracerUp = new THREE.Vector3(0, 1, 0);

function spawnTracer(dir, dist) {
    // Punto d'arrivo reale del colpo (il raggio parte dall'occhio/camera)
    camera.getWorldPosition(_tracerEnd).addScaledVector(dir, dist);
    // La scia parte dalla BOCCA dell'arma (stesso offset di muzzle light/stella):
    // partendo dal centro-camera il cilindro si vedeva di punta e il suo tappo
    // appariva come un quadratino giallo fisso al centro dello schermo.
    _tracerOrigin.set(0.08, -0.1, -0.7);
    camera.localToWorld(_tracerOrigin);
    const axis = _tracerEnd.clone().sub(_tracerOrigin);
    const full = axis.length();
    if (full < 0.3) return;                     // bersaglio a bruciapelo: niente scia
    axis.normalize();
    const len = Math.max(full - 0.15, 0.2);     // si ferma un soffio prima dell'impatto
    const mid = _tracerOrigin.clone().addScaledVector(axis, 0.15 + len * 0.5);

    // Cilindro rastremato verso il bersaglio (webgl line è 1px, invisibile)
    const geo = new THREE.CylinderGeometry(0.006, 0.016, len, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.85 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(mid);
    // CylinderGeometry è orientato sull'asse Y; ruotiamo verso la direzione di volo
    if (Math.abs(axis.y) < 0.999) {
        mesh.quaternion.setFromUnitVectors(_tracerUp, axis);
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
// Ritorna { dist, point, box } del primo impatto entro maxDist, o null.
// (box = riferimento all'AABB colpito: serve a riconoscere le porte)
function raycastSolids(origin, dir, maxDist) {
    let best = maxDist, point = null, hitBox = null;
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
            hitBox = b;
        }
    }
    return point ? { dist: best, point, box: hitBox } : null;
}

// ══════════════════════════════════════════════════════
//  FX TOON — sprite procedurali (sbuffi, stelle, onomatopee)
// ══════════════════════════════════════════════════════
// Texture generate una volta su canvas e tenute in cache: ogni sprite
// crea/distrugge solo il proprio materiale, mai la texture condivisa.
const _fxTex = {};
const FX_INK = '#221a12';
const KILL_WORDS = ['POW!', 'BAM!', 'ZAP!', 'WHAM!'];

function _fxCanvas(w, h) {
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    return cvs;
}

// Nuvoletta a lobi color panna con bordo d'inchiostro (impatti/fumo)
function _makePuffTexture() {
    const cvs = _fxCanvas(128, 128);
    const c = cvs.getContext('2d');
    // Lobi della nuvoletta: [x, y, raggio]
    const lobes = [
        [64, 68, 30], [40, 58, 21], [88, 57, 20],
        [49, 86, 18], [81, 86, 17], [64, 42, 19]
    ];
    // Passata 1: unione dei lobi ingranditi in inchiostro = contorno chiuso
    c.fillStyle = FX_INK;
    for (const [x, y, r] of lobes) {
        c.beginPath(); c.arc(x, y, r + 6, 0, Math.PI * 2); c.fill();
    }
    // Passata 2: riempimento panna (copre i bordi interni tra i lobi)
    c.fillStyle = '#f2e7d3';
    for (const [x, y, r] of lobes) {
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    // Ombra morbida sulla metà bassa, confinata dentro la sagoma
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = 'rgba(160,140,105,0.32)';
    c.beginPath(); c.ellipse(64, 98, 52, 26, 0, 0, Math.PI * 2); c.fill();
    return new THREE.CanvasTexture(cvs);
}

// Stella comica a punte (bocca di fuoco / impatto marcato)
function _makeStarTexture() {
    const cvs = _fxCanvas(128, 128);
    const c = cvs.getContext('2d');
    const cx = 64, cy = 64, points = 6, R = 58, r = 22;
    c.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const rad = (i % 2 === 0) ? R : r;
        const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath();
    const g = c.createRadialGradient(cx, cy, 4, cx, cy, R);
    g.addColorStop(0, '#fffbe8');
    g.addColorStop(0.45, '#ffd84a');
    g.addColorStop(1, '#ff9a2e');
    c.fillStyle = g;
    c.lineJoin = 'round';
    c.lineWidth = 5; c.strokeStyle = FX_INK;
    c.fill(); c.stroke();
    return new THREE.CanvasTexture(cvs);
}

// Stellina-scintilla a 4 punte (lati concavi)
function _makeTwinkleTexture() {
    const cvs = _fxCanvas(64, 64);
    const c = cvs.getContext('2d');
    const cx = 32, cy = 32, R = 27, w = 7;
    c.beginPath();
    c.moveTo(cx, cy - R);
    c.quadraticCurveTo(cx + w, cy - w, cx + R, cy);
    c.quadraticCurveTo(cx + w, cy + w, cx, cy + R);
    c.quadraticCurveTo(cx - w, cy + w, cx - R, cy);
    c.quadraticCurveTo(cx - w, cy - w, cx, cy - R);
    c.closePath();
    c.fillStyle = '#fff6da';
    c.lineJoin = 'round';
    c.lineWidth = 3.5; c.strokeStyle = FX_INK;
    c.fill(); c.stroke();
    return new THREE.CanvasTexture(cvs);
}

// Onomatopea comica (Fredoka + tratto d'inchiostro), tilt fisso cotto in texture
function _makeWordTexture(word) {
    const cvs = _fxCanvas(512, 256);
    const c = cvs.getContext('2d');
    c.translate(256, 128);
    c.rotate(-0.07);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    let px = 150;
    c.font = `700 ${px}px Fredoka, Arial, sans-serif`;
    const tw = c.measureText(word).width;
    if (tw > 420) { px = Math.floor(px * 420 / tw); c.font = `700 ${px}px Fredoka, Arial, sans-serif`; }
    c.lineJoin = 'round';
    c.lineWidth = 26; c.strokeStyle = FX_INK;
    c.strokeText(word, 0, 8);
    const g = c.createLinearGradient(0, -px * 0.5, 0, px * 0.5);
    g.addColorStop(0, '#ffe98a');
    g.addColorStop(1, '#ffab30');
    c.fillStyle = g;
    c.fillText(word, 0, 8);
    return new THREE.CanvasTexture(cvs);
}

function getFxTexture(key) {
    if (!_fxTex[key]) {
        _fxTex[key] = key === 'puff' ? _makePuffTexture()
                    : key === 'star' ? _makeStarTexture()
                    : key === 'twinkle' ? _makeTwinkleTexture()
                    : _makeWordTexture(key);
    }
    return _fxTex[key];
}

// Pre-genera le texture per evitare micro-scatti al primo sparo.
// Le onomatopee aspettano il caricamento di Fredoka (altrimenti la cache
// congelerebbe il fallback Arial).
['puff', 'star', 'twinkle'].forEach(getFxTexture);
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => KILL_WORDS.forEach(getFxTexture));
}

// Spawna uno sprite FX billboardato: pop-in con easeOutBack, poi salita/
// deriva + spin + fade. Stesso lifecycle rAF+dispose del tracer; la texture
// (in cache) NON va mai distrutta. Le coordinate sono copiate subito, quindi
// worldPos può essere un vettore riusato dal chiamante.
const _fxSpawnPos = new THREE.Vector3();
function spawnFxSprite(tex, worldPos, opts = {}) {
    const {
        size = 0.3,        // altezza finale (m)
        aspect = 1,        // larghezza/altezza (onomatopee 2:1)
        life = 380,        // durata totale (ms)
        rise = 0.3,        // salita complessiva (m)
        drift = 0.12,      // deriva orizzontale casuale max (m)
        spin = 1.2,        // rotazione screen-space complessiva (rad)
        popIn = 0.35,      // frazione di vita dedicata al pop-in
        tint = 0xffffff,   // moltiplicatore colore (es. grigio per la polvere)
        depthTest = true,  // false = sempre leggibile (onomatopee)
    } = opts;
    const mat = new THREE.SpriteMaterial({
        map: tex, color: tint, transparent: true, depthTest, depthWrite: false,
        rotation: spin > 0 ? Math.random() * Math.PI * 2 : 0
    });
    const sp = new THREE.Sprite(mat);
    if (!depthTest) sp.renderOrder = 5;
    const ox = worldPos.x, oy = worldPos.y, oz = worldPos.z;
    sp.position.set(ox, oy, oz);
    sp.scale.set(0.0001 * aspect, 0.0001, 1);
    scene.add(sp);
    const dx = (Math.random() - 0.5) * 2 * drift;
    const dz = (Math.random() - 0.5) * 2 * drift;
    const spinDir = Math.random() < 0.5 ? -1 : 1;
    const rot0 = mat.rotation;
    const t0 = performance.now();
    (function step() {
        const el = performance.now() - t0;
        if (el >= life) { scene.remove(sp); mat.dispose(); return; }
        const t = el / life;
        const s = size * Math.max(0.0003, _easeOutBack(_clamp01(t / popIn)));
        sp.scale.set(s * aspect, s, 1);
        sp.position.set(ox + dx * t, oy + rise * t, oz + dz * t);
        mat.rotation = rot0 + spinDir * spin * t;
        mat.opacity = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
        requestAnimationFrame(step);
    })();
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

// Muzzle flash: lampo di luce + stella comica alla bocca, scalata per arma
let muzzleLight = null;
let muzzleStar = null;
let _muzzleStarGen = 0;
const MUZZLE_STAR_SIZE = { assault: 0.15, smg: 0.10, shotgun: 0.24, sniper: 0.19 };
function playMuzzleFlash() {
    if (!muzzleLight) {
        muzzleLight = new THREE.PointLight(0xffa030, 0, 3);
        camera.add(muzzleLight);
        muzzleLight.position.set(0.08, -0.1, -0.7);
    }
    if (!muzzleStar) {
        muzzleStar = new THREE.Sprite(new THREE.SpriteMaterial({
            map: getFxTexture('star'), transparent: true,
            depthTest: false, depthWrite: false
        }));
        muzzleStar.position.set(0.08, -0.1, -0.7);   // stesso offset-bocca della luce
        muzzleStar.renderOrder = 6;
        muzzleStar.visible = false;
        camera.add(muzzleStar);
    }
    muzzleLight.intensity = 3;
    setTimeout(() => { if (muzzleLight) muzzleLight.intensity = 0; }, 60);

    // Pop della stella (~70ms). Il contatore annulla il loop precedente quando
    // le armi automatiche sparano più in fretta della durata del pop.
    const size = MUZZLE_STAR_SIZE[gameState.myWeapon] || MUZZLE_STAR_SIZE.assault;
    muzzleStar.material.rotation = Math.random() * Math.PI * 2;
    muzzleStar.visible = true;
    const gen = ++_muzzleStarGen;
    const t0 = performance.now();
    (function pop() {
        if (gen !== _muzzleStarGen) return;
        const el = performance.now() - t0;
        if (el >= 70) { muzzleStar.visible = false; return; }
        const p = el / 70;
        const s = size * (0.55 + 0.45 * _easeOutBack(_clamp01(p * 2.2)));
        muzzleStar.scale.set(s, s, 1);
        muzzleStar.material.opacity = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
        requestAnimationFrame(pop);
    })();
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

    // Clamp mappa (+ soffitto invisibile per la Gravità Lunare)
    pos.x = Math.max(-MAP_HALF + 1, Math.min(MAP_X1 - 1, pos.x));
    pos.z = Math.max(-MAP_HALF + 1, Math.min(MAP_HALF - 1, pos.z));
    if (pos.y > MAP_CEIL) { pos.y = MAP_CEIL; velocityY = Math.min(velocityY, 0); }

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
    bar.style.background = pct > 0.5 ? 'var(--col-safe)' : pct > 0.25 ? 'var(--col-ammo)' : 'var(--col-danger)';
}

function updateAmmoHUD() {
    const el = document.getElementById('hud-ammo-count');
    el.innerHTML = `${gameState.myAmmo}<span> / ${gameState.myMaxAmmo}</span>`;
}

function updateRoundHUD() {
    document.getElementById('hud-round-num').textContent = `${gameState.currentRound} / ${gameState.totalRounds}`;
    // Etichetta del box: "Round" nei round normali, il nome del mutatore in quelli speciali
    const label = document.getElementById('hud-round-text');
    if (!label) return;
    const info = gameState.mutator ? MUTATOR_INFO[gameState.mutator] : null;
    if (info) {
        label.textContent = info.name;
        label.classList.add('mutator');
        label.title = info.desc;
    } else {
        label.textContent = 'Round';
        label.classList.remove('mutator');
        label.removeAttribute('title');
    }
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
            <span class="hud-score-wins">☠︎ ${pts}</span>`;
        el.appendChild(row);
    }
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

// ── Riconnessione silenziosa ──
// Una scheda lasciata in background può essere congelata dal browser: il server
// smette di ricevere i pong e disconnette il socket. Al ritorno socket.io si
// riconnette DA SOLO, ma il nuovo socket non è più né nella room né in partita:
// senza re-join il giocatore resta un "fantasma" immortale (il server rifiuta
// ogni reportHit su di lui) e la partita si corrompe per tutti.
// Il re-join fa rispondere il server con fpsInit, che risincronizza fase/round.
socket.io.on('reconnect', () => {
    socket.emit('joinFPS', { lobbyId: LOBBY_ID, playerColor: MY_COLOR });
});

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
    console.log(`[FPS] evento roundStart: round=${data.round} mutatore=${data.mutator} players=[${Object.keys(data.players).join(', ')}]`);
    hideWeaponSelect();
    resetBreakables();   // i prop rotti (bottiglie/cassette) tornano interi
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
    console.log(`[FPS] evento playerKilled: ${killerColor} → ${killedColor} (sub=${subphase})`);
    // Aggiorna i punti live (il +1 per kill compare subito in HUD)
    if (points) { gameState.points = points; updateScoreHUD(); }

    // Hitmarker rosso "kill" se l'uccisione è mia
    if (killerColor === MY_COLOR && killedColor !== MY_COLOR) {
        showHitmarker(true);
        Sfx.killConfirm();
        // Onomatopea comica sul punto di morte del nemico (solo mie uccisioni).
        // Posizione catturata QUI, prima che il mesh venga nascosto più sotto;
        // se il mesh non esiste, semplicemente nessun testo.
        const victim = gameState.players[killedColor];
        if (victim && victim.group) {
            const p = victim.group.position;
            _fxSpawnPos.set(p.x, p.y + 1.6, p.z);
            spawnFxSprite(getFxTexture(KILL_WORDS[Math.floor(Math.random() * KILL_WORDS.length)]),
                _fxSpawnPos, {
                    size: 0.8, aspect: 2, life: 950, rise: 0.9, drift: 0, spin: 0,
                    popIn: 0.22, depthTest: false
                });
        }
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
    console.log(`[FPS] evento playerRespawn: ${color}`);
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

// Gun Game: dopo un kill il server fa avanzare l'arma del killer.
socket.on('weaponSwitch', ({ color, weaponKey, ammo, maxAmmo }) => {
    if (color === MY_COLOR) {
        const w = gameState.weapons[weaponKey];
        gameState.myWeapon = weaponKey;
        gameState.myAmmo = ammo;
        gameState.myMaxAmmo = maxAmmo != null ? maxAmmo : (w ? w.ammo : 30);
        isReloading = false;
        if (isADS) exitADS();          // il FOV/ADS dipende dall'arma → esci per coerenza
        applyAmmoCap();                // rispetta eventuale "Un Colpo in Canna"
        switchWeaponModel(weaponKey);
        document.getElementById('hud-weapon-name').textContent = w ? w.name : weaponKey;
        updateAmmoHUD();
        Sfx.reload && Sfx.reload();     // feedback "cambio arma"
    } else {
        // Avversario: aggiorna subito il modello arma TP (comunque si allinea anche via stato)
        const rp = gameState.players[color];
        if (rp) setRemoteWeapon(rp, weaponKey);
    }
});

// Passaggio a SUDDEN DEATH: respawn OFF, tutti vivi e a piena vita
socket.on('suddenDeathStart', (data) => {
    console.log('[FPS] evento suddenDeathStart');
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
    console.log(`[FPS] evento playerLeft: ${color}`);
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
    console.log(`[FPS] evento roundEnd: round=${data.round} vincitore=${data.winnerColor}`);
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
    document.getElementById('ws-timer').textContent = `${remaining}s`;
    clearInterval(wsTimerInterval);
    wsTimerInterval = setInterval(() => {
        remaining--;
        document.getElementById('ws-timer').textContent = `${remaining}s`;
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

// Piccolo indicatore accanto a "Round": spade incrociate (mischia) con countdown,
// teschio (sudden death). Glyph unicode text-presentation, niente emoji.
function showPhaseIndicator(kind, durationMs) {
    const el = document.getElementById('hud-phase-icon');
    if (!el) return;
    clearInterval(meleeCountdownInterval);
    if (kind === 'melee') {
        let remaining = Math.ceil((durationMs || 60000) / 1000);
        el.className = 'melee';
        el.textContent = `⚔︎ ${remaining}`;
        el.title = `Mischia · ${remaining}s`;
        meleeCountdownInterval = setInterval(() => {
            remaining--;
            const s = Math.max(0, remaining);
            el.textContent = `⚔︎ ${s}`;
            el.title = `Mischia · ${s}s`;
            if (remaining <= 0) clearInterval(meleeCountdownInterval);
        }, 1000);
    }
}

function hidePhaseIndicator() {
    clearInterval(meleeCountdownInterval);
    const el = document.getElementById('hud-phase-icon');
    if (el) { el.className = ''; el.textContent = ''; el.removeAttribute('title'); }
}

function showSuddenDeathBanner() {
    clearInterval(meleeCountdownInterval);
    const el = document.getElementById('hud-phase-icon');
    if (el) {
        el.className = 'suddendeath';
        el.textContent = '☠︎';
        el.title = 'Sudden Death';
    }
}

// ── MUTATORI ────────────────────────────────────────
// Metadati mostrati nel box Round: nome (sostituisce "Round") + descrizione (title)
const MUTATOR_INFO = {
    moon_gravity:  { name: 'Gravità Lunare',   desc: 'Salti altissimi!' },
    speed_x2:      { name: 'Velocità x2',      desc: 'Tutti velocissimi!' },
    fog:           { name: 'Nebbia Fitta',     desc: 'Visibilità ridotta' },
    giant_heads:   { name: 'Teste Giganti',    desc: 'Mira alla testa!' },
    blackout:      { name: 'Blackout',         desc: 'Buio pesto, luce sull\'arma' },
    double_damage: { name: 'TTK Dimezzato',    desc: 'Danno raddoppiato!' },
    one_in_chamber:{ name: 'Un Colpo in Canna', desc: '1 pallottola, uccide subito' },
    mini_players:  { name: 'Mini Giocatori',   desc: 'Bersagli minuscoli' },
    vampirism:     { name: 'Vampirismo',       desc: 'Uccidi per curarti' },
    headshot_only: { name: 'Solo Headshot',    desc: 'Conta solo la testa' },
    flicker_invis: { name: 'Fantasmi',         desc: 'Nemici che lampeggiano' },
    blind_mode:    { name: 'Alla Cieca',       desc: 'Nessun segnale di colpo' },
    sonar:         { name: 'Radar Sonar',      desc: 'Fermo = invisibile al radar' },
    gun_game:      { name: 'Gun Game',         desc: 'Ogni kill cambia arma' }
};

// Pannello di INTRO round: mostrato mentre il gioco è congelato (fase 'round_intro').
// Round + eventuale mutatore + countdown. Il nome resta poi fisso nel box (updateRoundHUD).
let roundIntroCdInterval = null;
let roundIntroTimer = null;
function showRoundIntro(introMs) {
    const el = document.getElementById('round-intro');
    if (!el) return;
    const info = gameState.mutator ? MUTATOR_INFO[gameState.mutator] : null;
    let remaining = Math.ceil(introMs / 1000);
    el.innerHTML = `
        <div class="ri-cell">
            <span class="ri-label">Round</span>
            <span class="ri-round-val">${gameState.currentRound} / ${gameState.totalRounds}</span>
        </div>
        ${info ? `<div class="ri-sep"></div>
                  <div class="ri-cell">
                      <span class="ri-label">Mutatore</span>
                      <span class="ri-mut-name">${info.name}</span>
                      <span class="ri-mut-desc">${info.desc}</span>
                  </div>` : ''}
        <div class="ri-sep"></div>
        <div class="ri-cell">
            <span class="ri-label">Preparati</span>
            <span id="ri-cd" class="ri-cd-num">${remaining}</span>
        </div>`;
    el.classList.remove('show');
    void el.offsetWidth; // restart animazione
    el.classList.add('show');
    const cdEl = el.querySelector('#ri-cd');
    clearInterval(roundIntroCdInterval);
    roundIntroCdInterval = setInterval(() => {
        remaining--;
        if (cdEl) cdEl.textContent = Math.max(0, remaining);
        if (remaining <= 0) clearInterval(roundIntroCdInterval);
    }, 1000);
}
function hideRoundIntro() {
    clearInterval(roundIntroCdInterval);
    const el = document.getElementById('round-intro');
    if (el) el.classList.remove('show');
}

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
            headScale = 2.0;    // teste enormi (2.5 era troppo con la testa tonda della mascotte)
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

function handleRoundStart(data) {
    clearTimeout(roundIntroTimer);
    gameState.phase = 'round_intro';   // gioco congelato: input/movimento/sparo bloccati fino a fine intro
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
            // hp/dead dal server: a inizio round sono 100/vivo, ma su un RE-JOIN
            // a round in corso (fpsInit → handleRoundStart) riflettono lo stato reale
            gameState.players[color] = {
                ...parts,
                hp: pState.hp != null ? pState.hp : 100,
                dead: !!pState.dead,
                anim: makeAnim()
            };
            if (pState.dead) parts.group.visible = false;
        }
    }

    updateRoundHUD();
    updateScoreHUD();

    document.getElementById('overlay').classList.remove('active');
    document.getElementById('dead-screen').classList.remove('active');
    if (weaponGroup) weaponGroup.visible = true;

    // ── Fase INTRO: pannello di preparazione, gioco congelato per introDuration ──
    // Tutti i giocatori vedono la scena/lo spawn ma non possono agire finché non scade.
    hidePhaseIndicator();
    const introMs = data.introDuration || 3500;
    if (gameState.mutator) { Sfx.revealStinger ? Sfx.revealStinger() : Sfx.roundStart(); }
    showRoundIntro(introMs);

    roundIntroTimer = setTimeout(() => {
        hideRoundIntro();
        if (gameState.phase !== 'round_intro') return;   // round già cambiato/finito: non sbloccare
        gameState.phase = 'playing';                     // via! input/movimento/sparo abilitati
        Sfx.roundStart();
        // La MISCHIA mostra il countdown; poi (server sincronizzato) scatta il sudden death
        if (gameState.subphase === 'melee') {
            showPhaseIndicator('melee', data.meleeDuration || 60000);
        }
    }, introMs);
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
        const bonusTxt = data.sdBonus ? ` (+${data.sdBonus} ☠︎)` : '';
        main.textContent = data.winnerColor === MY_COLOR ? `You Win!${bonusTxt}` : 'Round Lost';
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
            <span class="overlay-score-wins">☠︎ ${pts}</span>`;
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

let podiumPanelTimer = null;
function showGameOverOverlay(data) {
    gameState.phase = 'game_over';
    gameState.subphase = null;
    hidePhaseIndicator();
    document.exitPointerLock();

    // Nascondi subito il pannello di fine round: prima si vede l'animazione del podio,
    // poi (col ritardo sotto) compare la card di vittoria.
    document.getElementById('overlay').classList.remove('active');

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
        main.textContent = 'VICTORY!';
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
            <span class="overlay-score-wins">☠︎ ${pts}</span>`;
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

    // Prima si gode l'animazione delle teste sul podio; poi si apre il pannello vittoria.
    clearTimeout(podiumPanelTimer);
    podiumPanelTimer = setTimeout(() => {
        document.getElementById('overlay').classList.add('active');
    }, 3500);
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
    // Aggancia subito il mouse su questo click (gesto utente): così resta catturato
    // per tutta la fase intro e il round parte senza dover ri-cliccare.
    Sfx.resume();
    canvas.requestPointerLock();
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
    updateDoors(dt);
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