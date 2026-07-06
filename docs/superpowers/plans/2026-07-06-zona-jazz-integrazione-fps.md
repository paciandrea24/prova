# Zona Jazz → fps.js — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire la mappa procedurale dell'FPS con la Zona Jazz (20 GLB Blender +
`pavimentazione.glb` + `zona-layout.json`) resa col cel-shading esistente, collisioni
OBB, spawn nuovi e toggle bordi neri — fluida (vincolo primario dell'utente).

**Architecture:** Merge globale per materiale (~40 mesh statiche per l'intera zona),
toon-swap dei materiali GLB sulla pipeline `worldToon` esistente, collisioni dai box
`COL_*` dei GLB come OBB verticali (estensione locale-frame di
`resolveCollisions`/`canStandAt`/`raycastSolids`), clamp radiale, 10 spawn server
nuovi. Spec: `docs/superpowers/specs/2026-07-06-zona-jazz-integrazione-fps-design.md`.

**Tech Stack:** Three.js r128 (CDN, GIÀ in fps.html insieme a GLTFLoader r128),
vanilla JS, socket.io lato server (solo SPAWN_POINTS).

## Global Constraints

- **NIENTE COMMIT, mai** — committa SOLO l'utente (vale anche nel worktree).
- Si lavora nel **worktree jazz**: `C:\Users\pacia\Desktop\Claude Workspace\prova\.claude\worktrees\fps-mappa-blender-jazz`
  (gli asset `frontend/assets/models/jazz/*` esistono solo lì). Test:
  `node server.js` dalla cartella `backend/` DEL WORKTREE, poi `localhost:3000`, due tab.
- Pipeline colore LINEARE: **niente** `renderer.outputEncoding`/`toneMapping` (vincolo storico).
- Three.js r128: NIENTE `CapsuleGeometry`, NIENTE API più nuove (es. `mergeBufferGeometries`
  di versioni recenti); il merge indicizzato si scrive a mano (Task 3).
- La zona intera è spostata a **y = −0.10** (`JAZZ_Y_OFF`): il top delle pietre (~0.082–0.098)
  finisce a ~y 0 → il codice di movimento/terra NON si tocca.
- Convenzioni JSON (`zona-layout.json`): coordinate di gioco (x est, z sud), `rotY` in GRADI,
  modello non ruotato = fronte +Z, campi `y` (quota base) e `s` (scala istanza) sugli edifici.
  In three.js: `rotation.y = rotY*π/180`, matrice istanza `T(x, y−0.10, z)·R_y·S(s)`.
- Ogni task si verifica in localhost (console pulita + controllo visivo) PRIMA di passare oltre.

---

### Task 1: Porta il restyle uncommitted nel worktree

Il worktree è fermo al commit `f7bf7db`; in MAIN ci sono modifiche uncommitted a
`frontend/fps.html` (+GLTFLoader tag, +overlay `#model-loading`) e
`frontend/styles/fps.css` (+stili overlay). L'integrazione costruisce su quei file.

**Files:**
- Modify (copia da main): `<worktree>/frontend/fps.html`, `<worktree>/frontend/styles/fps.css`

- [ ] **Step 1: Copia i due file**

```powershell
Copy-Item "C:\Users\pacia\Desktop\Claude Workspace\prova\frontend\fps.html" "C:\Users\pacia\Desktop\Claude Workspace\prova\.claude\worktrees\fps-mappa-blender-jazz\frontend\fps.html" -Force
Copy-Item "C:\Users\pacia\Desktop\Claude Workspace\prova\frontend\styles\fps.css" "C:\Users\pacia\Desktop\Claude Workspace\prova\.claude\worktrees\fps-mappa-blender-jazz\frontend\styles\fps.css" -Force
```

- [ ] **Step 2: Verifica**

`git -C <worktree> diff --stat` deve mostrare i 2 file (~10 e ~20 righe aggiunte);
in `fps.html` devono esserci il tag `GLTFLoader.js` e il div `#model-loading`.

---

### Task 2: Collisioni OBB (estensione solidBoxes)

**Files:**
- Modify: `<worktree>/frontend/fps.js` — `addSolid` (riga ~713), `raycastSolids` (~2979),
  `canStandAt` (~3260), `resolveCollisions` (~3275)

**Interfaces:**
- Produces: `addSolidOBB(cx, cz, hw, hd, y0, y1, rotYdeg)` — registra un box RUOTATO
  attorno all'asse Y in `solidBoxes`. Le entry ruotate hanno: `min/max` = INVILUPPO
  AABB mondo (per consumer generici tipo minimap), più `rot, cos, sin, cx, cz, hw, hd`.
  Le entry classiche restano `{min, max}` e seguono il percorso attuale invariato.

- [ ] **Step 1: Aggiungi `addSolidOBB` subito dopo `addSolid`**

```javascript
// ── Solido RUOTATO attorno a Y (edifici GLB della Zona Jazz) ──
// min/max = inviluppo AABB in coordinate mondo (per minimap/consumer generici);
// il test di collisione vero usa il frame LOCALE (cx,cz,hw,hd,rot).
function addSolidOBB(cx, cz, hw, hd, y0, y1, rotYdeg) {
    const rot = rotYdeg * Math.PI / 180;
    const c = Math.cos(rot), s = Math.sin(rot);
    const ex = Math.abs(c) * hw + Math.abs(s) * hd;   // inviluppo
    const ez = Math.abs(s) * hw + Math.abs(c) * hd;
    solidBoxes.push({
        min: new THREE.Vector3(cx - ex, y0, cz - ez),
        max: new THREE.Vector3(cx + ex, y1, cz + ez),
        rot, cos: c, sin: s, cx, cz, hw, hd
    });
}
```

- [ ] **Step 2: `resolveCollisions` — ramo ruotato**

Nel `for (const box of solidBoxes)`, dopo lo scarto verticale, sostituisci il calcolo
degli overlap con:

```javascript
        let px = pos.x, pz = pos.z;
        if (box.rot) {
            // Frame locale del box: ruota il punto di -rot attorno al centro
            const dx = pos.x - box.cx, dz = pos.z - box.cz;
            px = box.cos * dx + box.sin * dz;
            pz = -box.sin * dx + box.cos * dz;
        }
        const bMinX = box.rot ? -box.hw : box.min.x, bMaxX = box.rot ? box.hw : box.max.x;
        const bMinZ = box.rot ? -box.hd : box.min.z, bMaxZ = box.rot ? box.hd : box.max.z;

        const overlapXL = (px + rad) - bMinX;
        const overlapXR = bMaxX - (px - rad);
        const overlapZF = (pz + rad) - bMinZ;
        const overlapZB = bMaxZ - (pz - rad);
```

e nella risoluzione finale (dopo lo step-up, che resta IDENTICO — usa solo quote Y):

```javascript
        const minX = Math.min(overlapXL, overlapXR);
        const minZ = Math.min(overlapZF, overlapZB);
        let pushX = 0, pushZ = 0;
        if (minX <= minZ) pushX = overlapXL < overlapXR ? -overlapXL : overlapXR;
        else              pushZ = overlapZF < overlapZB ? -overlapZF : overlapZB;
        if (box.rot) {   // riporta la spinta nel frame mondo
            const wx = box.cos * pushX - box.sin * pushZ;
            const wz = box.sin * pushX + box.cos * pushZ;
            pos.x += wx; pos.z += wz;
        } else {
            pos.x += pushX; pos.z += pushZ;
        }
```

- [ ] **Step 3: `canStandAt` — stesso pattern**

Dentro il loop, prima dei confronti su x/z:

```javascript
        let qx = x, qz = z;
        let bMinX = b.min.x, bMaxX = b.max.x, bMinZ = b.min.z, bMaxZ = b.max.z;
        if (b.rot) {
            const dx = x - b.cx, dz = z - b.cz;
            qx = b.cos * dx + b.sin * dz;
            qz = -b.sin * dx + b.cos * dz;
            bMinX = -b.hw; bMaxX = b.hw; bMinZ = -b.hd; bMaxZ = b.hd;
        }
        if (qx + rad <= bMinX || qx - rad >= bMaxX) continue;
        if (qz + rad <= bMinZ || qz - rad >= bMaxZ) continue;
```

(il check verticale `b.min.y < head - 0.05 && b.max.y > bodyBottom + 0.05` resta invariato)

- [ ] **Step 4: `raycastSolids` — slab test nel frame locale**

All'inizio del loop su `solidBoxes`:

```javascript
        let ox = origin.x, oz = origin.z, dx = dir.x, dz = dir.z;
        let mnx = b.min.x, mxx = b.max.x, mnz = b.min.z, mxz = b.max.z;
        if (b.rot) {
            const rx = origin.x - b.cx, rz = origin.z - b.cz;
            ox = b.cos * rx + b.sin * rz;
            oz = -b.sin * rx + b.cos * rz;
            dx = b.cos * dir.x + b.sin * dir.z;
            dz = -b.sin * dir.x + b.cos * dir.z;
            mnx = -b.hw; mxx = b.hw; mnz = -b.hd; mxz = b.hd;
        }
```

e il ciclo sugli assi usa (ox,dx,mnx,mxx), (origin.y,dir.y,b.min.y,b.max.y), (oz,dz,mnz,mxz)
al posto dell'accesso generico `origin[ax]`. Il punto di impatto resta
`origin.clone().addScaledVector(dir, tmin)` (t è invariante per rotazione).

- [ ] **Step 5: Verifica sintassi + smoke test**

`node --check <worktree>/frontend/fps.js` → nessun errore. Avvia il gioco (mappa
vecchia ancora attiva): tutto funziona come prima (le entry ruotate non esistono ancora).

---

### Task 3: `loadJazzZone()` — loader, toon-swap, merge, collisioni istanze

**Files:**
- Modify: `<worktree>/frontend/fps.js` — nuova sezione dopo `MAT` (~riga 685)

**Interfaces:**
- Consumes: `worldToon(opts)`, `_toonGradMap`, `addSolidOBB` (Task 2), `scene`, overlay
  `#model-loading` in fps.html.
- Produces: `loadJazzZone()` → Promise; `jazzZoneGroup` (THREE.Group con tutte le mesh
  merged, figlio di `scene`); `jazzMergedMeshes[]` (per il toggle outline, Task 5).
  Costanti `JAZZ_DIR='assets/models/jazz/'`, `JAZZ_Y_OFF=-0.10`.

- [ ] **Step 1: Scrivi la sezione loader**

```javascript
// ══════════════════════════════════════════════════════
//  ZONA JAZZ — caricamento GLB + merge per materiale
//  (mappa modellata in Blender; layout in zona-layout.json)
// ══════════════════════════════════════════════════════
const JAZZ_DIR = 'assets/models/jazz/';
const JAZZ_Y_OFF = -0.10;   // top pietre (~0.09) → y≈0: il movimento resta com'è
const jazzZoneGroup = new THREE.Group();
const jazzMergedMeshes = [];   // per il toggle bordi (tasto B)

// Toon-swap: un materiale toon per NOME materiale Blender (condiviso tra modelli).
// I materiali Emission (neon del club, vetri lampade) diventano Basic "sempre accesi".
const _jazzMatCache = {};
function _jazzToonMat(srcMat) {
    const name = srcMat.name || 'mat';
    if (_jazzMatCache[name]) return _jazzMatCache[name];
    let m;
    const e = srcMat.emissive;
    if (e && (e.r + e.g + e.b) > 0.3) {
        m = new THREE.MeshBasicMaterial({ color: e.clone() });
    } else {
        m = worldToon({ color: srcMat.color ? srcMat.color.clone() : new THREE.Color(0xcccccc) });
    }
    _jazzMatCache[name] = m;
    return m;
}

// Merge indicizzato di una lista di BufferGeometry (solo position+normal).
// r128 non ha un merge affidabile per questo caso: 25 righe a mano.
function _mergeGeos(geos) {
    let nv = 0, ni = 0;
    for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const g of geos) {
        pos.set(g.attributes.position.array, vo * 3);
        nor.set(g.attributes.normal.array, vo * 3);
        const c = g.attributes.position.count;
        if (g.index) {
            const a = g.index.array;
            for (let i = 0; i < a.length; i++) idx[io + i] = a[i] + vo;
            io += a.length;
        } else {
            for (let i = 0; i < c; i++) idx[io + i] = vo + i;
            io += c;
        }
        vo += c;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
}

function _gltfLoad(loader, url) {
    return new Promise((res, rej) => loader.load(url, res, undefined, rej));
}

function loadJazzZone() {
    const loader = new THREE.GLTFLoader();
    return fetch(JAZZ_DIR + 'zona-layout.json').then(r => r.json()).then(layout => {
        const modelNames = [...new Set([
            ...layout.edifici.map(e => e.modello),
            ...layout.props.map(p => p.modello)
        ])];
        const urls = ['pavimentazione', ...modelNames];
        return Promise.all(urls.map(n => _gltfLoad(loader, JAZZ_DIR + n + '.glb')))
            .then(gltfs => ({ layout, modelNames, gltfs }));
    }).then(({ layout, modelNames, gltfs }) => {
        // ── Pavimentazione: già poche mesh, entra diretta (toon-swap e basta) ──
        const pav = gltfs[0].scene;
        pav.updateMatrixWorld(true);
        pav.traverse(o => { if (o.isMesh) o.material = _jazzToonMat(o.material); });
        pav.position.y = JAZZ_Y_OFF;
        jazzZoneGroup.add(pav);

        // ── Stage 1: per MODELLO, geometrie fuse per materiale + lista COL ──
        // models[nome] = { byMat: {matName: geoModelSpace}, cols: [{min,max}] }
        const models = {};
        modelNames.forEach((name, i) => {
            const sceneRoot = gltfs[i + 1].scene;
            sceneRoot.updateMatrixWorld(true);
            const byMat = {}, cols = [];
            sceneRoot.traverse(o => {
                if (!o.isMesh) return;
                if (o.name.indexOf('COL_') === 0) {
                    const bb = new THREE.Box3().setFromObject(o);
                    cols.push(bb);
                    return;
                }
                const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
                const mn = (o.material && o.material.name) || 'mat';
                (byMat[mn] = byMat[mn] || []).push(g);
                if (!_jazzMatCache[mn]) _jazzToonMat(o.material);
            });
            const merged = {};
            for (const mn in byMat) merged[mn] = _mergeGeos(byMat[mn]);
            models[name] = { byMat: merged, cols };
        });

        // ── Stage 2: istanze → accumulo globale per materiale + collisioni ──
        const globalByMat = {};
        const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
        const place = (inst, isProp) => {
            const mdl = models[inst.modello];
            const s = inst.s || 1.0;
            const y = (inst.y || 0) + JAZZ_Y_OFF;
            const rot = (inst.rotY || 0) * Math.PI / 180;
            Q.setFromAxisAngle(UP, rot);
            M.compose(new THREE.Vector3(inst.x, y, inst.z), Q, new THREE.Vector3(s, s, s));
            for (const mn in mdl.byMat) {
                const g = mdl.byMat[mn].clone().applyMatrix4(M);
                (globalByMat[mn] = globalByMat[mn] || []).push(g);
            }
            if (!isProp) {
                for (const bb of mdl.cols) {
                    const cxL = (bb.min.x + bb.max.x) / 2, czL = (bb.min.z + bb.max.z) / 2;
                    // centro locale ruotato+scalato+traslato nel mondo
                    const wx = inst.x + s * (cxL * Math.cos(rot) + czL * Math.sin(rot));
                    const wz = inst.z + s * (-cxL * Math.sin(rot) + czL * Math.cos(rot));
                    addSolidOBB(wx, wz,
                        s * (bb.max.x - bb.min.x) / 2, s * (bb.max.z - bb.min.z) / 2,
                        y + s * bb.min.y, y + s * bb.max.y, inst.rotY || 0);
                }
            }
        };
        layout.edifici.forEach(e => place(e, false));
        layout.props.forEach(p => place(p, true));

        // ── Mesh finali: una per materiale ──
        for (const mn in globalByMat) {
            const mesh = new THREE.Mesh(_mergeGeos(globalByMat[mn]), _jazzMatCache[mn]);
            mesh.matrixAutoUpdate = false;
            jazzMergedMeshes.push(mesh);
            jazzZoneGroup.add(mesh);
        }
        scene.add(jazzZoneGroup);
        console.log(`🏙 Zona Jazz: ${jazzMergedMeshes.length} mesh merged, ${solidBoxes.length} solidi`);
    });
}
```

**NOTA rotazione COL**: la rotazione del centro usa la STESSA convenzione del
piazzamento three.js (`rotation.y = rot`, che manda il punto locale (x,z) in
`(x·cos + z·sin, −x·sin + z·cos)`). Se in verifica gli edifici ruotati hanno
collisioni "sfalsate" rispetto ai muri, i segni di `sin` qui e in Task 2 vanno
ricontrollati INSIEME (devono essere coerenti: stessa matrice).

**NOTA props**: i props (lampioni, festoni, insegna) per ora NON generano collisioni
(`isProp=true`): i lampioni della zona hanno basi sottili — da valutare in gioco;
i festoni stanno a 4.2 m (il campo `y` del JSON li piazza in quota).

- [ ] **Step 2: Verifica sintassi**

`node --check <worktree>/frontend/fps.js` → ok. (La funzione non è ancora chiamata.)

---

### Task 4: buildMap() → Zona Jazz, clamp radiale, avvio gated

**Files:**
- Modify: `<worktree>/frontend/fps.js` — costanti (~23-25), `buildMap()` (~1228),
  chiamata `buildMap()` (~1783), clamp in `updateMovement` (~3444), `drawMinimap` (~3513),
  emit `joinFPS` (~3663)

**Interfaces:**
- Consumes: `loadJazzZone()` (Task 3).
- Produces: mappa = Zona Jazz; `MAP_RADIUS=49`; overlay visibile durante il load.

- [ ] **Step 1: Costanti**

```javascript
const MAP_HALF = 52;      // raggio del disco della Zona Jazz (estensione terreno)
const MAP_RADIUS = 49;    // clamp radiale: rete di sicurezza dietro il perimetro
const MAP_CEIL = 13;      // soffitto invisibile (cresta club 14 m solo visiva)
```

Elimina `MAP_X1` (le occorrenze residue spariscono con la pulizia del Task 6 —
fino ad allora il file può non passare `node --check`: esegui i Task 4-6 in sequenza
e verifica alla fine del Task 6).

- [ ] **Step 2: Riscrivi `buildMap()` (corpo minimo)**

```javascript
function buildMap() {
    // ── Fondo di sicurezza sotto/oltre il disco della pavimentazione ──
    const under = new THREE.Mesh(new THREE.CircleGeometry(80, 48),
                                 worldToon({ color: 0x4a4640 }));
    under.rotation.x = -Math.PI / 2;
    under.position.y = -0.14;
    scene.add(under);
    buildClouds();
    // La geometria vera (edifici/pavimento/props GLB) arriva da loadJazzZone().
}
```

(la chiamata `buildMap();` a riga ~1783 resta)

- [ ] **Step 3: Clamp radiale in `updateMovement`**

Sostituisci le due righe di clamp x/z con:

```javascript
    // Clamp RADIALE (mappa a disco) + soffitto invisibile per la Gravità Lunare
    const rr = Math.hypot(pos.x, pos.z);
    if (rr > MAP_RADIUS) { const k = MAP_RADIUS / rr; pos.x *= k; pos.z *= k; }
    if (pos.y > MAP_CEIL) { pos.y = MAP_CEIL; velocityY = Math.min(velocityY, 0); }
```

- [ ] **Step 4: Minimap — zoom invariato**

In `drawMinimap`: `const viewRadius = 32;` (non più `MAP_HALF`, che ora è 52).

- [ ] **Step 5: joinFPS dopo il caricamento**

Sostituisci la riga `socket.emit('joinFPS', ...)` (~3663) con:

```javascript
// Il join parte SOLO a zona caricata: lo spawn dentro la geometria richiede i solidi.
const _loadingEl = document.getElementById('model-loading');
if (_loadingEl) _loadingEl.style.display = 'flex';
loadJazzZone().then(() => {
    if (_loadingEl) _loadingEl.style.display = 'none';
    socket.emit('joinFPS', { lobbyId: LOBBY_ID, playerColor: MY_COLOR });
}).catch(err => {
    console.error('Zona Jazz: caricamento fallito', err);
    if (_loadingEl) _loadingEl.textContent = 'Errore caricamento scenario';
});
```

(l'handler `socket.io.on('reconnect', ...)` resta invariato: alla riconnessione la
zona è già in memoria)

- [ ] **Step 6: Verifica in localhost (2 tab)**

- La zona si carica (console: riga `🏙 Zona Jazz: ...`), overlay che appare e sparisce.
- Edifici integri e toon (confronta con `preview/zona_sw.png`), neon del club accesi.
- Non si attraversano gli edifici (prova anche il club a 45° e un isolotto ruotato);
  si sale sul sagrato con lo step-up; il clamp ferma al perimetro; spari sui muri
  lasciano l'impatto sul punto giusto (raycast OBB).
- FPS fluidi con due tab (Performance monitor del browser o contatore veloce:
  `let f=0; setInterval(()=>{console.log('fps',f);f=0},1000)` + `f++` in animate —
  temporaneo, da togliere).

---

### Task 5: Toggle bordi neri (tasto B)

**Files:**
- Modify: `<worktree>/frontend/fps.js` — dopo `loadJazzZone` (sezione Task 3) e
  nel keydown handler esistente

**Interfaces:**
- Consumes: `jazzMergedMeshes`, `_toonDisplacedGeo`, `MAT.ink`, `TOON_OUTLINE_T`.
- Produces: `toggleJazzOutlines()` — costruisce i gusci alla PRIMA attivazione (lazy),
  poi toggla `visible`.

- [ ] **Step 1: Implementa**

```javascript
// ── Bordi neri sugli edifici: toggle di valutazione (tasto B) ──
// Default SPENTO (stile Cuphead: fondali senza china). Gusci costruiti lazy.
let _jazzOutlines = null;
function toggleJazzOutlines() {
    if (!_jazzOutlines) {
        _jazzOutlines = jazzMergedMeshes.map(m => {
            const o = new THREE.Mesh(_toonDisplacedGeo(m.geometry, TOON_OUTLINE_T * 1.2), MAT.ink);
            o.matrixAutoUpdate = false;
            jazzZoneGroup.add(o);
            return o;
        });
        console.log('🖋 Contorni zona: costruiti', _jazzOutlines.length);
        return;   // prima pressione = accendi
    }
    const on = !_jazzOutlines[0].visible;
    _jazzOutlines.forEach(o => { o.visible = on; });
}
```

Nel keydown handler esistente (dove sono gestiti gli altri tasti):

```javascript
    if (e.code === 'KeyB') toggleJazzOutlines();
```

- [ ] **Step 2: Verifica**

In gioco: B accende/spegne i bordi senza scatti una volta costruiti (la prima
pressione può impiegare ~1s); da spenti gli fps tornano identici a prima.

---

### Task 6: Pulizia mappa vecchia + spawn server

**Files:**
- Modify: `<worktree>/frontend/fps.js` — rimozione builder Cittadina/Porto
- Modify: `<worktree>/backend/sockets/games/fpsGameSocket.js` — `SPAWN_POINTS` (~19)

- [ ] **Step 1: Nuovi SPAWN_POINTS (server)**

```javascript
// Zona Jazz (disco r=52): 8 in corsia esterna (r≈38.5) + 2 in corsia interna (r≈20),
// tutti rivolti verso il centro (convenzione: angle = Math.atan2(x, z)).
const SPAWN_POINTS = [
    { x:     0, y: 0, z: -38.5, angle: Math.atan2(0, -38.5) },     // corsia 2, nord
    { x:  27.2, y: 0, z: -27.2, angle: Math.atan2(27.2, -27.2) },  // corsia 2, NE
    { x:  38.5, y: 0, z:     0, angle: Math.atan2(38.5, 0) },      // corsia 2, est
    { x:  27.2, y: 0, z:  27.2, angle: Math.atan2(27.2, 27.2) },   // corsia 2, SE
    { x:     0, y: 0, z:  38.5, angle: Math.atan2(0, 38.5) },      // corsia 2, sud
    { x: -27.2, y: 0, z:  27.2, angle: Math.atan2(-27.2, 27.2) },  // corsia 2, SO
    { x: -38.5, y: 0, z:     0, angle: Math.atan2(-38.5, 0) },     // corsia 2, ovest
    { x: -27.2, y: 0, z: -27.2, angle: Math.atan2(-27.2, -27.2) }, // corsia 2, NO
    { x:     0, y: 0, z: -20,   angle: Math.atan2(0, -20) },       // corsia 1, nord
    { x:     0, y: 0, z:  20,   angle: Math.atan2(0, 20) }         // corsia 1, sud
];
```

- [ ] **Step 2: Rimuovi i builder della mappa vecchia (fps.js)**

Elimina le FUNZIONI (e i loro commenti-sezione): `buildCentral`, `buildShop`,
`buildStall`, `buildGazebo`, `buildSpeakeasy`, `buildPort`, `buildKiosk`, `buildVan`,
`buildCarport`, `buildBackdrop`, `buildFountain`, `buildLamppost`, `buildStairs`,
`punchWallX`, `punchWallZ`, `fenceX`, `fenceZ`, `crate`, `buildBarrier`,
`buildSandbags`, `buildBarrel`, `addTree`, `addSign`, `addBottle`, `addLooseCrate`,
`buildDoor` SOLO se non referenziata da sistemi vivi (il sistema porte
`updateDoors/_doorSetSolid/doors[]` RESTA, con lista vuota).
Metodo: per ogni nome, `grep -n "<nome>" fps.js` → rimuovi definizione e chiamate
(le chiamate stanno solo nel vecchio corpo di `buildMap`, già sostituito, o l'una
nell'altra). NON toccare: `makeBox`, `makeCyl`, `addSolid`, `addSolidOBB`,
`buildClouds`, il sistema breakables (`registerBreakable`/`checkBreakables`/
`resetBreakables`, restano con liste vuote), `MAT`, texture helpers (anche se
qualche `draw*` resta orfano: si tolgono solo quelli NON più referenziati da `MAT`).
Elimina anche le occorrenze residue di `MAP_X1`.

- [ ] **Step 3: Verifica finale completa**

- `node --check` su fps.js e fpsGameSocket.js.
- Partita 1v1 completa (5 round, due tab) dal worktree: spawn nelle corsie rivolti
  al centro, mai dentro un edificio; round/mutatori/killfeed ok; console pulita.
- FPS fluidi per tutta la partita (vincolo primario).

---

### Task 7: Documentazione

**Files:**
- Modify: `<worktree>/docs/fps-notes.md` — sezione "Mappa" riscritta per la Zona Jazz
  (layout a disco, file GLB+JSON, merge per materiale, OBB, clamp radiale, toggle B,
  trade-off niente interni), nota su SPAWN_POINTS nuovi; sezione vecchia
  Cittadina/Porto sostituita da un capoverso "storico" di 3 righe.
- Il piano stesso: aggiorna la sezione "Stato esecuzione" con scostamenti e risultati.

- [ ] **Step 1: Aggiorna fps-notes.md** (contenuto derivato da ciò che è stato
  effettivamente implementato nei task 2-6, incluse eventuali deviazioni)

- [ ] **Step 2: Gate utente**: partita di prova dell'utente in localhost dal worktree.
  Decisione bordi neri (tasto B) → se definitiva, fissarla e rimuovere il toggle in
  un mini-follow-up.

---

## Stato esecuzione (2026-07-06, inline)

- **Task 1-7 ESEGUITI** (inline, stessa sessione). NIENTE commit (committa l'utente).
- Scostamenti dal piano:
  1. **FIX SEGNO ROTAZIONE** (previsto dalla NOTA del Task 3): three.js
     `rotation.y=rot` manda (x,z) locale in `(x·cos+z·sin, −x·sin+z·cos)` → il
     mondo→locale delle collisioni è R(−rot). Fix a punto singolo: `addSolidOBB`
     memorizza il SENO NEGATO; i tre consumer restano come da piano. Verificato
     con test numerico standalone (scratchpad/test_obb.js: angoli esatti + punto
     esterno, PASS).
  2. `buildMap` minima TIENE anche skybox e nuvole (nel piano erano impliciti).
  3. `MAP_HALF` eliminato del tutto (restava solo la definizione); minimap a
     `viewRadius=32` fisso come da piano.
  4. MAT e le texture procedurali `draw*` NON rimossi (condivisi con sistemi vivi;
     costo trascurabile) — solo `makeSignTex`/`addSign` eliminati coi builder.
  5. Worktree: creato junction `backend/node_modules` → node_modules di main
     (i worktree non lo condividono; serviva per `node server.js`).
- Pulizia: 27 funzioni rimosse, fps.js 4707→3995 righe; nessun riferimento orfano
  (grep su tutti i nomi + MAP_X1 pulito).
- Verifiche fatte: `node --check` su fps.js e fpsGameSocket.js OK; test numerico
  OBB OK; server del worktree avviato e smoke test HTTP 200 su fps.html/fps.js/
  zona-layout.json/pavimentazione.glb/club.glb/props/lampione.glb (asset 16.6 MB).
- DA FARE (gate utente): partita vera in localhost (due tab) dal worktree —
  verifica visiva toon/neon, collisioni sugli edifici ruotati, spawn, fluidità,
  tasto B per i bordi.

## Self-review (fatta in scrittura)

- **Copertura spec**: merge per materiale ✓ (T3), toon-swap+neon ✓ (T3), COL→OBB ✓
  (T2+T3), terreno piatto via `JAZZ_Y_OFF` ✓ (T3/T4), clamp radiale+MAP_HALF ✓ (T4),
  overlay+join gated ✓ (T4), toggle B ✓ (T5), spawn ✓ (T6), pulizia secca ✓ (T6),
  fps-notes ✓ (T7), performance: budget in T4/T6 con contatore, fallback nella spec.
- **Coerenza segni rotazione**: le tre trasformazioni locali (T2 Step 2/3/4) e il
  piazzamento COL (T3) usano la stessa matrice R(−θ) per andare nel frame locale —
  nota esplicita nel T3 per il caso di segni sbagliati.
- **Niente placeholder**: ogni step ha codice o procedura concreta (la pulizia T6 è
  guidata da lista nomi + metodo grep).
- **Tipi coerenti**: `addSolidOBB(cx, cz, hw, hd, y0, y1, rotYdeg)` identico in T2
  (definizione) e T3 (uso); `jazzMergedMeshes`/`jazzZoneGroup` tra T3 e T5.
