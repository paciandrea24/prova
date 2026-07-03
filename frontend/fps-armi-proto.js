// ══════════════════════════════════════════════════════════════════
//  PROTOTIPO G4.1 — Armi cartoon CURVE (Lathe + Tube + ellissoidi)
//  Viewer di approvazione: il nuovo buildToonWeaponModel si sviluppa
//  QUI e, una volta approvato, si trapianta identico in fps.js.
//  Contratto invariato: origine al grip, canna -Z, calcio +Z,
//  materiali e contorni per-istanza.
// ══════════════════════════════════════════════════════════════════

// ── Renderer / scena / camera ──
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// NB: niente outputEncoding/toneMapping (pipeline lineare, come fps.js)

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3ee);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 100);

scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8a72, 0.95));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(3, 6, 2);
scene.add(sun);

// ══════════════════════════════════════════════════════════════════
//  HELPER TOON — copiati IDENTICI da fps.js (gradMap, grana, contorni)
// ══════════════════════════════════════════════════════════════════
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

const TOON_OUTLINE_T = 0.008;

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

function _addToonOutline(src, outMat, tMul = 1) {
    let o;
    if (src.geometry.type.indexOf('Box') === 0) {
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

// ══════════════════════════════════════════════════════════════════
//  NUOVO BUILDER ARMI — linguaggio di forme CURVO (anni '30)
//  Calci a pera, canne affusolate, impugnature a banana, anelli ottone.
//  Solo Lathe/Tube/Sfere: normali smooth → contorni senza fessure.
// ══════════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════════
//  SCENA DEL VIEWER: pavimento, piedistalli, 4 armi su giradischi
// ══════════════════════════════════════════════════════════════════
const floorMat = new THREE.MeshToonMaterial({ color: 0xd8d2c0, gradientMap: _toonGradMap });
const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 40), floorMat);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const WEAPONS = [
    { key: 'assault', label: 'Assalto' },
    { key: 'smg',     label: 'Thompson' },
    { key: 'shotgun', label: 'Doppietta' },
    { key: 'sniper',  label: 'Cecchino' },
];
const PED_H = 1.15, SPACING = 0.85;
const turntables = {};   // key → group rotante

WEAPONS.forEach((w, i) => {
    const x = (i - (WEAPONS.length - 1) / 2) * SPACING;
    // Piedistallo tondo
    const ped = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.22, PED_H, 16),
        new THREE.MeshToonMaterial({ color: 0xb9b3a2, gradientMap: _toonGradMap }));
    ped.position.set(x, PED_H / 2, 0);
    scene.add(ped);
    _addToonOutline(ped, new THREE.MeshBasicMaterial({ color: 0x1a1a1a, side: THREE.BackSide }), 1);
    // Giradischi con l'arma (origine al grip → la centro a occhio sul piedistallo)
    const tt = new THREE.Group();
    tt.position.set(x, PED_H + 0.22, 0);
    const model = buildToonWeaponModel(w.key);
    model.position.z = 0.06;   // compensa il baricentro (grip non è il centro)
    tt.add(model);
    scene.add(tt);
    turntables[w.key] = tt;
});

// ══════════════════════════════════════════════════════════════════
//  MINI-ORBIT custom (cdnjs r128 non ha OrbitControls): drag + rotella
// ══════════════════════════════════════════════════════════════════
const orbit = { target: new THREE.Vector3(0, 1.3, 0), yaw: 0, pitch: 0.25, dist: 2.4 };
function applyOrbit() {
    const cp = Math.cos(orbit.pitch), sp = Math.sin(orbit.pitch);
    camera.position.set(
        orbit.target.x + orbit.dist * cp * Math.sin(orbit.yaw),
        orbit.target.y + orbit.dist * sp,
        orbit.target.z + orbit.dist * cp * Math.cos(orbit.yaw));
    camera.lookAt(orbit.target);
}
let dragging = false, px = 0, py = 0;
canvas.addEventListener('pointerdown', e => { dragging = true; px = e.clientX; py = e.clientY; });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', e => {
    if (!dragging) return;
    orbit.yaw -= (e.clientX - px) * 0.005;
    orbit.pitch = Math.min(1.35, Math.max(-0.4, orbit.pitch + (e.clientY - py) * 0.005));
    px = e.clientX; py = e.clientY;
});
canvas.addEventListener('wheel', e => {
    e.preventDefault();
    orbit.dist = Math.min(5, Math.max(0.18, orbit.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
}, { passive: false });

// Bottoni di messa a fuoco
document.querySelectorAll('#bar button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#bar button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const f = btn.dataset.focus;
        if (f === 'all') {
            orbit.target.set(0, 1.3, 0); orbit.dist = 2.4; orbit.yaw = 0; orbit.pitch = 0.25;
        } else {
            const tt = turntables[f];
            orbit.target.copy(tt.position); orbit.dist = 0.8; orbit.pitch = 0.12;
        }
    });
});

const spinBox = document.getElementById('spin');

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Loop ──
let last = performance.now();
function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (spinBox.checked) {
        Object.values(turntables).forEach(tt => { tt.rotation.y += dt * 0.6; });
    }
    applyOrbit();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
