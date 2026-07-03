/* ============================================================
   FPS — Prototipo personaggio "rubber-hose" (stile Cuphead)
   Pagina ISOLATA: non tocca il gioco. Three.js r128 globale.

   Vincoli rispettati (vedi docs/fps-notes.md):
   - Pipeline LINEARE come nel gioco: NIENTE outputEncoding/toneMapping.
   - Niente CapsuleGeometry (non esiste in r128): solo Sphere/Cylinder/Box/Torus.
   - Handle personaggio compatibile col gioco:
     { group, head, upper, legL, legR, weaponMount }
   ============================================================ */
'use strict';

// ── Stato dei controlli UI ──
const state = {
    rotate: true,        // turntable dei personaggi
    toon: true,          // cel-shading ON / Lambert (stile attuale) OFF
    outlines: true,      // contorni inchiostro
    thickness: 0.008,    // spessore contorni in metri (~0.8 cm, tratto leggero)
    weapon: true,        // arma in mano
    bigHead: false,      // mutatore Teste Giganti (head.scale 2.5)
    mini: false,         // mutatore Mini Giocatori (group.scale 0.5)
    far: false,          // vista a distanza (~25 m)
    colorPair: 0         // coppia colori-squadra attiva
};

const COLOR_PAIRS = [
    [0x2e6df6, 0xe23b3b],   // blu / rosso
    [0x2fa84f, 0xf08a24],   // verde / arancio
    [0x8a4fd8, 0xf2c14e]    // viola / giallo
];

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = new THREE.Vector3(0, 1, 0);

// ════════════════════════════════════════════════════════════
// RENDERER / SCENA / CAMERA — replica l'illuminazione di fps.js
// ════════════════════════════════════════════════════════════
const canvas = document.getElementById('proto-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x87ceeb);
// NB: outputEncoding e toneMapping restano ai DEFAULT (lineare), come nel gioco.

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x87ceeb, 0.008);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 300);

// Luci identiche a fps.js (ambient/sun/hemi)
scene.add(new THREE.AmbientLight(0xffeedd, 0.5));
const sun = new THREE.DirectionalLight(0xfff5e0, 1.2);
sun.position.set(12, 20, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -10; sun.shadow.camera.right = 10;
sun.shadow.camera.top = 10; sun.shadow.camera.bottom = -10;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 60;
sun.shadow.bias = -0.0005;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x87ceeb, 0x6b7c3a, 0.4));

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.0;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI * 0.49;

function applyCameraView() {
    if (state.far) {
        camera.position.set(0, 4.2, 26);
        controls.target.set(0, 1.0, 0);
    } else {
        camera.position.set(2.0, 1.7, 3.4);
        controls.target.set(0, 0.95, 0);
    }
}
applyCameraView();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ════════════════════════════════════════════════════════════
// HELPER STILISTICI (riutilizzabili poi nel gioco)
// ════════════════════════════════════════════════════════════

// Gradient map a fasce nette per il cel-shading (NearestFilter = bande dure)
function makeBandedGradientMap(steps) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 1;
    const ctx = c.getContext('2d');
    const vals = (steps === 4) ? [0.35, 0.58, 0.82, 1.0] : [0.42, 0.73, 1.0];
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
}
const gradMap = makeBandedGradientMap(3);

// Grana vintage: base bianca con puntinatura e graffi leggeri,
// moltiplicata dal colore del materiale (map). Molto sottile.
function makeGrainTexture() {
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
    for (let i = 0; i < 26; i++) {   // graffi verticali da pellicola
        ctx.strokeStyle = 'rgba(40,35,30,0.05)';
        const x = Math.random() * s;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (Math.random() - 0.5) * 8, s);
        ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
}
const grainTex = makeGrainTexture();

// Texture del prato (verde mottled, tiling)
function makeGroundTexture() {
    const s = 256;
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#83c766';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 700; i++) {
        ctx.fillStyle = Math.random() < 0.5 ? 'rgba(50,110,45,0.18)' : 'rgba(180,225,140,0.14)';
        ctx.beginPath();
        ctx.arc(Math.random() * s, Math.random() * s, 1 + Math.random() * 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(18, 18);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
}

// Coppia di materiali {toon, lambert} per il confronto cel-shading vs stile attuale
function toonPair(color, opts = {}) {
    const map = (opts.grain === false) ? null : grainTex;
    return {
        toon: new THREE.MeshToonMaterial({ color, gradientMap: gradMap, map }),
        lambert: new THREE.MeshLambertMaterial({ color, map })
    };
}

// Materiale contorno inchiostro (inverted hull), condiviso
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, side: THREE.BackSide });

// Registri: statici (props/terreno) e per-personaggio (svuotato a ogni rebuild)
const REG = { swap: [], outline: [] };
let CREG = { swap: [], outline: [] };

// Geometria clonata con vertici spostati lungo le normali di t (hull "gonfiato")
function displacedGeo(geo, t) {
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

// Per i BOX l'offset lungo le normali apre fessure agli spigoli (normali per-faccia):
// si usa invece una scala per-asse calcolata sulle dimensioni reali → spessore uniforme.
function applyBoxOutlineScale(o) {
    const bb = o.userData.baseGeo.boundingBox;
    const t = state.thickness * o.userData.tMul;
    o.scale.set(
        1 + 2 * t / Math.max(bb.max.x - bb.min.x, 1e-3),
        1 + 2 * t / Math.max(bb.max.y - bb.min.y, 1e-3),
        1 + 2 * t / Math.max(bb.max.z - bb.min.z, 1e-3));
}

// Aggiunge il contorno inchiostro come FIGLIO della mesh (eredita ogni trasformazione,
// inclusi head.scale del mutatore e le pose): linee anche tra i segmenti del corpo.
function addInkOutline(src, reg, opt = {}) {
    const isBox = src.geometry.type.indexOf('Box') === 0;
    let o;
    if (isBox) {
        src.geometry.computeBoundingBox();
        o = new THREE.Mesh(src.geometry, outlineMat);
    } else {
        o = new THREE.Mesh(displacedGeo(src.geometry, state.thickness * (opt.tMul || 1)), outlineMat);
    }
    o.userData = { isBox, tMul: opt.tMul || 1, baseGeo: src.geometry };
    o.castShadow = false;
    o.visible = state.outlines;
    src.add(o);
    reg.outline.push(o);
    if (isBox) applyBoxOutlineScale(o);
    return o;
}

// Ricalcola tutti i contorni (slider spessore)
function updateOutlines() {
    for (const o of [...REG.outline, ...CREG.outline]) {
        if (o.userData.isBox) {
            applyBoxOutlineScale(o);
        } else {
            o.geometry.dispose();
            o.geometry = displacedGeo(o.userData.baseGeo, state.thickness * o.userData.tMul);
        }
    }
}

function setOutlineVisibility() {
    for (const o of [...REG.outline, ...CREG.outline]) o.visible = state.outlines;
}

// Applica toon o lambert a tutte le mesh registrate (toggle confronto)
function applyShadingMode() {
    for (const e of [...REG.swap, ...CREG.swap]) {
        e.mesh.material = state.toon ? e.pair.toon : e.pair.lambert;
    }
}

// Crea una mesh registrata (materiale swappabile + contorno automatico)
function part(geo, pair, parent, reg, opt = {}) {
    const m = new THREE.Mesh(geo, state.toon ? pair.toon : pair.lambert);
    m.castShadow = true;
    reg.swap.push({ mesh: m, pair });
    parent.add(m);
    if (!opt.noOutline) addInkOutline(m, reg, opt);
    return m;
}

// Cilindro "rubber-hose" tra due punti (arti a tubo)
function tube(a, b, r, pair, parent, reg, opt = {}) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(r, r, len, 12, 1);
    const m = part(geo, pair, parent, reg, opt);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    return m;
}

// ════════════════════════════════════════════════════════════
// PERSONAGGIO — mascotte rubber-hose ORIGINALE (non Cuphead)
// Handle compatibile col gioco: { group, head, upper, legL, legR, weaponMount }
// ════════════════════════════════════════════════════════════
const HIP_Y = 0.62;   // altezza fianchi (pivot gambe e gruppo upper)

function createToonCharacter(teamColor, reg) {
    const team = new THREE.Color(teamColor);
    const dark = team.clone().multiplyScalar(0.55);
    const P = {
        team: toonPair(team),
        dark: toonPair(dark),
        skin: toonPair(0xf7ecd7),    // faccia crema
        limb: toonPair(0x23201d),    // arti "a tubo" neri (rubber-hose)
        glove: toonPair(0xf4f0e6),   // guantoni bianchi
        boot: toonPair(0x6b4020),    // stivaloni marroni
        pink: toonPair(0xe98a6f),    // naso
        white: toonPair(0xffffff, { grain: false }),
        black: toonPair(0x141414, { grain: false })
    };

    const group = new THREE.Group();

    // ── UPPER: busto + braccia + testa (pivot ai fianchi, come nel gioco) ──
    const upper = new THREE.Group();
    upper.position.y = HIP_Y;
    group.add(upper);

    // Busto tondeggiante (salopette in colore-squadra)
    const torsoGeo = new THREE.SphereGeometry(0.25, 24, 18);
    torsoGeo.scale(1.0, 1.16, 0.82);
    part(torsoGeo, P.team, upper, reg).position.set(0, 0.24, 0);

    // Fascia in vita (accento scuro)
    part(new THREE.CylinderGeometry(0.21, 0.22, 0.08, 20), P.dark, upper, reg)
        .position.set(0, 0.02, 0);

    // Bottoni della salopette (davanti = -Z)
    for (const [by, bz] of [[0.31, -0.195], [0.19, -0.222]]) {
        part(new THREE.SphereGeometry(0.028, 10, 8), P.dark, upper, reg, { noOutline: true })
            .position.set(0, by, bz);
    }

    // Collo
    part(new THREE.CylinderGeometry(0.06, 0.06, 0.10, 12), P.skin, upper, reg, { noOutline: true })
        .position.set(0, 0.52, 0);

    // ── TESTA (gruppo separato → mutatore Teste Giganti via head.scale) ──
    const head = new THREE.Group();
    head.position.set(0, 0.76, 0);
    upper.add(head);

    part(new THREE.SphereGeometry(0.28, 28, 20), P.skin, head, reg);   // cranio

    // Occhi grandi ed espressivi: ovali bianchi, pupilloni "a pillola" con
    // luccichio in alto, e sopracciglia ad arco (stile cartoon anni '30)
    const eyeGeo = new THREE.SphereGeometry(0.075, 16, 12);
    eyeGeo.scale(1, 1.55, 0.5);
    const pupilGeo = new THREE.SphereGeometry(0.045, 14, 10);
    pupilGeo.scale(1, 1.35, 0.6);
    const browArc = Math.PI * 0.55;
    for (const sx of [-1, 1]) {
        part(eyeGeo, P.white, head, reg, { noOutline: true })
            .position.set(sx * 0.095, 0.035, -0.235);
        part(pupilGeo, P.black, head, reg, { noOutline: true })
            .position.set(sx * 0.088, 0.012, -0.262);
        part(new THREE.SphereGeometry(0.015, 8, 6), P.white, head, reg, { noOutline: true })
            .position.set(sx * 0.088 - 0.015, 0.042, -0.279);     // luccichio incastonato nella pupilla
        // Sopracciglio: arco sottile appoggiato alla fronte, leggermente
        // "rastrellato" (interno più alto) per un'aria vispa e determinata
        const brow = part(new THREE.TorusGeometry(0.055, 0.012, 6, 14, browArc),
            P.black, head, reg, { noOutline: true });
        brow.position.set(sx * 0.10, 0.105, -0.246);
        brow.rotation.set(0.42, 0, Math.PI / 2 - browArc / 2 + sx * 0.16);
    }

    // Naso a palla
    const noseGeo = new THREE.SphereGeometry(0.05, 14, 10);
    noseGeo.scale(1, 0.8, 0.8);
    part(noseGeo, P.pink, head, reg, { tMul: 0.5 }).position.set(0, -0.07, -0.275);

    // Sorriso: "grin" ampio che risale verso le guance, col piano INCLINATO
    // per seguire la curvatura della faccia. Puntini agli angoli della bocca
    // (il tocco espressivo classico dei cartoon anni '30).
    const smileArc = Math.PI * 0.85;
    const smile = part(new THREE.TorusGeometry(0.082, 0.015, 8, 24, smileArc),
        P.black, head, reg, { noOutline: true });
    smile.position.set(0, -0.132, -0.238);
    smile.rotation.set(-0.50, 0, -Math.PI / 2 - smileArc / 2);
    for (const a of [0, smileArc]) {   // estremi dell'arco (coord. locali del toro)
        part(new THREE.SphereGeometry(0.018, 10, 8), P.black, smile, reg, { noOutline: true })
            .position.set(0.082 * Math.cos(a), 0.082 * Math.sin(a), 0);
    }

    // Elmetto "indossato": calotta schiacciata inclinata all'indietro + bordino
    // arrotolato. Niente tesa a 360°: gli occhi restano completamente scoperti.
    const helmet = new THREE.Group();
    helmet.position.set(0, 0.115, 0.015);
    helmet.rotation.x = 0.16;             // fronte alzata, nuca abbassata (portamento sbarazzino)
    head.add(helmet);
    const domeGeo = new THREE.SphereGeometry(0.30, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5);
    domeGeo.scale(1, 0.8, 1);
    part(domeGeo, P.team, helmet, reg);
    const rim = part(new THREE.TorusGeometry(0.30, 0.022, 8, 26), P.dark, helmet, reg, { tMul: 0.5 });
    rim.rotation.x = Math.PI / 2;

    // ── BRACCIA rubber-hose: spalla → gomito → guantone ──
    const shR = V(0.23, 0.40, 0), elR = V(0.31, 0.17, -0.09), haR = V(0.27, 0.23, -0.27);
    const shL = V(-0.23, 0.40, 0), elL = V(-0.31, 0.15, 0.02), haL = V(-0.31, -0.04, -0.05);

    for (const [sh, el, ha, thumbOff] of [
        [shR, elR, haR, V(-0.07, 0.03, 0.01)],
        [shL, elL, haL, V(0.06, 0.03, -0.02)]
    ]) {
        part(new THREE.SphereGeometry(0.06, 12, 10), P.limb, upper, reg, { noOutline: true })
            .position.copy(sh);                                        // spalla
        tube(sh, el, 0.045, P.limb, upper, reg);                       // omero
        part(new THREE.SphereGeometry(0.05, 12, 10), P.limb, upper, reg, { noOutline: true })
            .position.copy(el);                                        // gomito
        tube(el, ha, 0.045, P.limb, upper, reg);                       // avambraccio
        // Polsino colore-squadra all'attacco del guanto
        const dirBack = el.clone().sub(ha).normalize();
        tube(ha.clone().addScaledVector(dirBack, 0.05),
             ha.clone().addScaledVector(dirBack, 0.12), 0.065, P.dark, upper, reg);
        // Guantone bianco (mitten, senza dita) + pollice
        part(new THREE.SphereGeometry(0.085, 16, 12), P.glove, upper, reg).position.copy(ha);
        part(new THREE.SphereGeometry(0.038, 10, 8), P.glove, upper, reg, { noOutline: true })
            .position.copy(ha.clone().add(thumbOff));
    }

    // Mount dell'arma: alla mano destra, canna verso -Z (forward del personaggio)
    const weaponMount = new THREE.Group();
    weaponMount.position.copy(haR);
    upper.add(weaponMount);

    // ── GAMBE: tubi neri + ghette + stivaloni cartoon (pivot all'anca) ──
    function makeLeg(sx) {
        const leg = new THREE.Group();
        leg.position.set(sx * 0.10, HIP_Y, 0);
        group.add(leg);
        part(new THREE.SphereGeometry(0.052, 12, 10), P.limb, leg, reg, { noOutline: true });
        tube(V(0, 0, 0), V(0, -0.44, 0), 0.047, P.limb, leg, reg);
        part(new THREE.CylinderGeometry(0.062, 0.075, 0.055, 14), P.glove, leg, reg)
            .position.set(0, -0.435, 0);                               // ghetta bianca
        const boot = new THREE.Group();
        boot.position.set(0, -0.52, -0.02);
        leg.add(boot);
        // Scarpone "a fagiolo" tutto tondo (stile rubber-hose): ellissoide
        // principale + punta bombata + tallone che raccorda con la ghetta
        const bootGeo = new THREE.SphereGeometry(0.09, 18, 14);
        bootGeo.scale(0.95, 0.72, 1.55);
        part(bootGeo, P.boot, boot, reg).position.set(0, -0.025, -0.045);
        const toeGeo = new THREE.SphereGeometry(0.085, 16, 12);
        toeGeo.scale(1, 0.8, 1.1);
        part(toeGeo, P.boot, boot, reg).position.set(0, -0.03, -0.13);  // punta bombata
        part(new THREE.SphereGeometry(0.075, 14, 10), P.boot, boot, reg, { noOutline: true })
            .position.set(0, 0.03, 0.03);                               // tallone/caviglia
        return leg;
    }
    const legL = makeLeg(-1);
    const legR = makeLeg(1);

    return { group, head, upper, legL, legR, weaponMount };
}

// ════════════════════════════════════════════════════════════
// ARMA — GLB del gioco convertito in toon + contorni
// ════════════════════════════════════════════════════════════
let weaponGLB = null;   // gltf.scene originale (template, mai in scena)

function makeToonWeapon(reg) {
    const model = weaponGLB.clone(true);

    // Scala alla lunghezza target e centra sul baricentro (bbox)
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const targetLen = 0.60;
    model.scale.setScalar(targetLen / Math.max(size.x, size.y, size.z));
    box.setFromObject(model);
    model.position.sub(box.getCenter(new THREE.Vector3()));
    // Grip leggermente dietro il centro: più canna davanti alla mano
    model.position.x += targetLen * 0.16;
    model.position.y += 0.03;

    // Materiali toon con gamma-fix (il loader converte sRGB→lineare ma la
    // pipeline è lineare: senza pow(1/2.2) i colori appaiono scuri — vedi G3)
    const meshes = [];
    model.traverse(o => { if (o.isMesh) meshes.push(o); });
    for (const m of meshes) {
        const col = (m.material && m.material.color) ? m.material.color.clone() : new THREE.Color(0x888888);
        col.r = Math.pow(col.r, 1 / 2.2);
        col.g = Math.pow(col.g, 1 / 2.2);
        col.b = Math.pow(col.b, 1 / 2.2);
        const pair = {
            toon: new THREE.MeshToonMaterial({ color: col, gradientMap: gradMap }),
            lambert: new THREE.MeshLambertMaterial({ color: col })
        };
        m.material = state.toon ? pair.toon : pair.lambert;
        m.castShadow = true;
        reg.swap.push({ mesh: m, pair });
        addInkOutline(m, reg, { tMul: 0.4 });
    }

    // Canna del GLB lungo +X locale → ruota su -Z (forward)
    const holder = new THREE.Group();
    holder.rotation.y = Math.PI / 2;
    holder.add(model);
    return holder;
}

if (typeof THREE.GLTFLoader === 'function') {
    new THREE.GLTFLoader().load('assets/guns/Assault Rifle.glb',
        (gltf) => { weaponGLB = gltf.scene; attachWeapons(); },
        undefined,
        (err) => console.warn('GLB arma non caricato (prototipo continua senza):', err));
}

function attachWeapons() {
    if (!weaponGLB) return;
    for (const c of chars) {
        if (c.weaponMount.children.length === 0) c.weaponMount.add(makeToonWeapon(CREG));
        c.weaponMount.visible = state.weapon;
    }
}

// ════════════════════════════════════════════════════════════
// AMBIENTE DI PROVA — terreno + qualche prop per contesto/scala
// ════════════════════════════════════════════════════════════
(function buildProps() {
    // Prato
    const groundPair = {
        toon: new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradMap, map: makeGroundTexture() }),
        lambert: new THREE.MeshLambertMaterial({ color: 0xffffff, map: makeGroundTexture() })
    };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), groundPair.toon);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    REG.swap.push({ mesh: ground, pair: groundPair });
    scene.add(ground);

    // Due casse di legno
    const wood = toonPair(0xcf9a4a);
    const c1 = part(new THREE.BoxGeometry(0.55, 0.55, 0.55), wood, scene, REG);
    c1.position.set(-1.9, 0.275, -0.9);
    const c2 = part(new THREE.BoxGeometry(0.42, 0.42, 0.42), wood, scene, REG);
    c2.position.set(-1.5, 0.21, -0.35);
    c2.rotation.y = 0.5;

    // Lampione da cittadina
    const green = toonPair(0x33604a);
    const pole = part(new THREE.CylinderGeometry(0.045, 0.06, 2.6, 10), green, scene, REG);
    pole.position.set(1.9, 1.3, -1.1);
    const collar = part(new THREE.CylinderGeometry(0.10, 0.10, 0.05, 10), green, scene, REG, { noOutline: true });
    collar.position.set(1.9, 2.58, -1.1);
    const lamp = part(new THREE.SphereGeometry(0.15, 14, 10), toonPair(0xffe9a8, { grain: false }), scene, REG);
    lamp.position.set(1.9, 2.72, -1.1);
})();

// ════════════════════════════════════════════════════════════
// COSTRUZIONE / RICOSTRUZIONE PERSONAGGI
// ════════════════════════════════════════════════════════════
let chars = [];

function rebuildCharacters() {
    for (const c of chars) scene.remove(c.group);
    CREG = { swap: [], outline: [] };
    chars = [];

    const [colA, colB] = COLOR_PAIRS[state.colorPair];
    const a = createToonCharacter(colA, CREG);
    const b = createToonCharacter(colB, CREG);
    a.group.position.x = -0.7;
    b.group.position.x = 0.7;
    for (const h of [a, b]) {
        h.group.rotation.y = Math.PI;   // il modello guarda -Z → girato verso la camera
        scene.add(h.group);
    }
    chars = [a, b];

    attachWeapons();
    if (state.bigHead) for (const c of chars) c.head.scale.setScalar(2.0);
    if (state.mini) for (const c of chars) c.group.scale.setScalar(0.5);
    setOutlineVisibility();
}
rebuildCharacters();

// ════════════════════════════════════════════════════════════
// UI
// ════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

$('chkRotate').addEventListener('change', e => { state.rotate = e.target.checked; });
$('chkToon').addEventListener('change', e => { state.toon = e.target.checked; applyShadingMode(); });
$('chkOutline').addEventListener('change', e => { state.outlines = e.target.checked; setOutlineVisibility(); });
$('rngThick').addEventListener('input', e => { state.thickness = e.target.value / 1000; updateOutlines(); });
$('chkWeapon').addEventListener('change', e => {
    state.weapon = e.target.checked;
    for (const c of chars) c.weaponMount.visible = state.weapon;
});
$('chkBigHead').addEventListener('change', e => {
    state.bigHead = e.target.checked;
    for (const c of chars) c.head.scale.setScalar(state.bigHead ? 2.0 : 1);
});
$('chkMini').addEventListener('change', e => {
    state.mini = e.target.checked;
    for (const c of chars) c.group.scale.setScalar(state.mini ? 0.5 : 1);
});
$('chkFar').addEventListener('change', e => { state.far = e.target.checked; applyCameraView(); });

for (const btn of document.querySelectorAll('#panel .colors button')) {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#panel .colors button').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        state.colorPair = parseInt(btn.dataset.pair, 10);
        rebuildCharacters();
    });
}

// ════════════════════════════════════════════════════════════
// LOOP
// ════════════════════════════════════════════════════════════
const clock = new THREE.Clock();
(function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (state.rotate) for (const c of chars) c.group.rotation.y += dt * 0.6;
    controls.update();
    renderer.render(scene, camera);
})();
