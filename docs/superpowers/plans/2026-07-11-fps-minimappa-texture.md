# FPS — Minimappa con texture generata: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire lo sfondo nero della minimappa FPS con una texture top-down del mondo, generata in sviluppo da una pagina tool dedicata e salvata in `assets/minimap/`.

**Architecture:** Config del mondo (elenco zone) estratta in `frontend/world-config.js` condiviso; `minimap-gen.html` carica le zone con un loader semplificato, renderizza con camera ortografica top-down e salva PNG+JSON via route dev `POST /dev/minimap`; `fps.js` carica la texture all'avvio e la disegna in `drawMinimap()` con gli stessi sin/cos/scala di `toMM`.

**Tech Stack:** Three.js r128 + GLTFLoader r128 (CDN), canvas 2D, Express (route dev), JS vanilla senza moduli ES (`<script>` classici).

**Spec:** `docs/superpowers/specs/2026-07-10-fps-minimappa-texture-design.md`

## Global Constraints

- **NON committare mai**: i commit/push li fa SOLO l'utente (convenzione del repo). I task terminano con una verifica, non con un commit.
- **Il server lo avvia l'utente** (`node server.js` da `backend/`): per i passi che richiedono il server acceso, chiederglielo.
- Commenti e testi in **italiano**; **niente emoji** nell'UI (solo glyph unicode monocromatici).
- Three.js **r128**: `THREE.CapsuleGeometry` NON esiste; GLTFLoader r128 da CDN (stessi URL di `fps.html`).
- Route dev attiva solo con `NODE_ENV !== 'production'`.
- Cache-buster `?v=Date.now()` su tutti i fetch di asset di zona e minimappa (fase -wip, come già fa `loadZone`).
- Skip-list varchi: match su coordinate **LOCALI** del layout con `Math.hypot(dx,dz) < 1.0`, applicato a `edifici` **e** `props` (semantica identica a `loadZone`, fps.js:1075-1085).

---

### Task 1: `world-config.js` condiviso (nessun cambio di comportamento)

**Files:**
- Create: `frontend/world-config.js`
- Modify: `frontend/fps.js:27` (const GALLERIA_OFF) e `frontend/fps.js:3426-3435` (blocco `_boot`)
- Modify: `frontend/fps.html:267` (aggiunta tag script)

**Interfaces:**
- Produces: globale `WORLD_CONFIG = { GALLERIA_OFF: {x,z}, VARCHI_URL: string, ZONES: [{ dir, json, varchi?, pav?, offset? }] }` — usato da fps.js (Task 1) e minimap-gen.html (Task 3).

- [ ] **Step 1: Crea `frontend/world-config.js`**

```js
// ══════════════════════════════════════════════════════
//  WORLD-CONFIG — elenco zone del mondo FPS
//  UNICA FONTE DI VERITÀ condivisa tra fps.js (gioco) e
//  minimap-gen.html (tool dev che genera la texture della minimappa).
//  Se aggiungi/sposti una zona: modifica QUI, poi rigenera la minimappa
//  aprendo localhost:3000/minimap-gen.html.
// ══════════════════════════════════════════════════════
const _GALLERIA_OFF = { x: 97, z: 0 };   // offset mondo della Galleria (combacia con collegamenti-layout.py)

const WORLD_CONFIG = {
    GALLERIA_OFF: _GALLERIA_OFF,
    // skip/passthrough dei varchi Jazz (coord LOCALI del layout)
    VARCHI_URL: 'assets/models/jazz/varchi-skip.json',
    // varchi:true → alla zona vanno passati skip/passthrough letti da VARCHI_URL
    // pav:false   → la zona non ha 'pavimentazione.glb' separata
    ZONES: [
        { dir: 'assets/models/jazz/',             json: 'zona-layout.json',         varchi: true },
        { dir: 'assets/models/collegamenti-wip/', json: 'collegamenti-layout.json', pav: false },
        { dir: 'assets/models/galleria-wip/',     json: 'galleria-layout.json',     offset: _GALLERIA_OFF },
        { dir: 'assets/models/piazza/',           json: 'piazza-layout.json',       pav: false },
        { dir: 'assets/models/funland/',          json: 'funland-layout.json',      pav: false },
    ],
};
```

- [ ] **Step 2: Includi lo script in `fps.html` prima di `fps.js`**

In `frontend/fps.html`, il blocco script (righe ~262-269) diventa (aggiunta la sola riga `world-config.js`, PRIMA di `fps.js` — i `defer` eseguono in ordine di documento):

```html
    <script src="gamepad.js" defer></script>
    <script src="world-config.js" defer></script>
    <script src="fps.js" defer></script>
```

- [ ] **Step 3: `fps.js` usa la config — riga 27**

Sostituire:

```js
const GALLERIA_OFF = { x: 97, z: 0 };   // offset mondo della Galleria (combacia con collegamenti-layout.py)
```

con:

```js
const GALLERIA_OFF = WORLD_CONFIG.GALLERIA_OFF;   // definito in world-config.js (condiviso con minimap-gen.html)
```

- [ ] **Step 4: `fps.js` usa la config — blocco `_boot` (righe ~3426-3435)**

Sostituire:

```js
const _boot = EXTENDED
    ? fetch('assets/models/jazz/varchi-skip.json').then(r => r.json()).then(v =>
        Promise.all([
            loadZone('assets/models/jazz/', 'zona-layout.json', { skip: v.skip, passthrough: v.passthrough || [] }),
            loadZone('assets/models/collegamenti-wip/', 'collegamenti-layout.json', { pav: false }),
            loadZone('assets/models/galleria-wip/', 'galleria-layout.json', { offset: GALLERIA_OFF }),
            loadZone('assets/models/piazza/', 'piazza-layout.json', { pav: false }),
            loadZone('assets/models/funland/', 'funland-layout.json', { pav: false }),
        ]))
    : loadZone('assets/models/jazz/', 'zona-layout.json', {});
```

con (l'elenco zone ora arriva da `WORLD_CONFIG`; le opzioni `undefined` sono già gestite dai default di `loadZone`):

```js
const _boot = EXTENDED
    ? fetch(WORLD_CONFIG.VARCHI_URL).then(r => r.json()).then(v =>
        Promise.all(WORLD_CONFIG.ZONES.map(zn => loadZone(zn.dir, zn.json, {
            offset: zn.offset,
            pav: zn.pav,
            skip: zn.varchi ? v.skip : undefined,
            passthrough: zn.varchi ? (v.passthrough || []) : undefined,
        }))))
    : loadZone('assets/models/jazz/', 'zona-layout.json', {});
```

- [ ] **Step 5: Verifica di non-regressione (utente, server avviato dall'utente)**

Aprire `localhost:3000/fps.html?...` da una lobby (o ricaricare una partita in corso in due tab):
- il mondo esteso carica identico a prima (Jazz + collegamenti + Galleria + Piazza + Funland, varchi aperti);
- `?map=jazz` carica la sola Zona Jazz;
- console senza errori (`WORLD_CONFIG is not defined` = script non incluso o dopo `fps.js`).

---

### Task 2: route dev `POST /dev/minimap` in `backend/server.js`

**Files:**
- Modify: `backend/server.js` (require `fs` + registrazione route PRIMA dei body-parser globali)

**Interfaces:**
- Consumes: nulla dai task precedenti.
- Produces: `POST /dev/minimap` con body JSON `{ png: dataURL 'data:image/png;base64,…', meta: { minX, minZ, maxX, maxZ, width, height } }` → scrive `frontend/assets/minimap/world.png` + `world.json`, risponde `{ ok: true }`. Usata dal Task 3.

- [ ] **Step 1: Aggiungi `fs` ai require**

In testa a `backend/server.js` (dove ora c'è il commento `/* const fs = require('fs'); */`, riga ~10):

```js
const fs = require('fs');
```

- [ ] **Step 2: Registra la route PRIMA di `app.use(express.json())`**

Subito dopo `const io = require('socket.io')(server);` (riga ~18) e PRIMA di `app.use(express.urlencoded(...))` (riga ~21). **L'ordine è obbligatorio**: il parser JSON globale ha limite 100kb e, se girasse per primo, respingerebbe il PNG (~1-4 MB) con 413 prima che la route lo veda. Registrando la route prima, usa il SUO parser da 25 MB.

```js
// ── Route DEV: salvataggio texture minimappa generata da minimap-gen.html ──
// Registrata PRIMA dei body-parser globali: il parser di default (100kb)
// respingerebbe il PNG. Solo in locale: mai attiva in produzione.
if (process.env.NODE_ENV !== 'production') {
    const MM_PREFIX = 'data:image/png;base64,';
    app.post('/dev/minimap', express.json({ limit: '25mb' }), (req, res) => {
        const { png, meta } = req.body || {};
        if (typeof png !== 'string' || png.indexOf(MM_PREFIX) !== 0 ||
            !meta || !(meta.width > 0) || !(meta.maxX > meta.minX)) {
            return res.status(400).json({ error: 'payload non valido' });
        }
        const dir = path.join(__dirname, '..', 'frontend', 'assets', 'minimap');
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'world.png'),
                Buffer.from(png.slice(MM_PREFIX.length), 'base64'));
            fs.writeFileSync(path.join(dir, 'world.json'),
                JSON.stringify(meta, null, 2));
            console.log('🗺  Minimappa salvata in frontend/assets/minimap/');
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
}
```

- [ ] **Step 3: Test della route (server riavviato dall'utente)**

Con il server su, da Git Bash (PNG 1×1 valido):

```bash
curl -s -X POST localhost:3000/dev/minimap -H "Content-Type: application/json" \
  -d '{"png":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==","meta":{"minX":0,"minZ":0,"maxX":1,"maxZ":1,"width":1,"height":1}}'
```

Atteso: `{"ok":true}` e i file `frontend/assets/minimap/world.png` (68 byte) e `world.json` esistono.
Poi test negativo:

```bash
curl -s -X POST localhost:3000/dev/minimap -H "Content-Type: application/json" -d '{"png":"ciao"}'
```

Atteso: `{"error":"payload non valido"}` (HTTP 400). I file di prova verranno sovrascritti dal Task 3 (non serve cancellarli).

---

### Task 3: generatore `frontend/minimap-gen.html`

**Files:**
- Create: `frontend/minimap-gen.html` (pagina self-contained, non linkata dal gioco)

**Interfaces:**
- Consumes: globale `WORLD_CONFIG` (Task 1); `POST /dev/minimap` (Task 2).
- Produces: `frontend/assets/minimap/world.png` (lato max 2048px, +X mondo → destra, +Z mondo → basso, scala px/unità uniforme) e `world.json = { minX, minZ, maxX, maxZ, width, height }` con margine 3 unità già incluso nei bounds. Consumati dal Task 4.

- [ ] **Step 1: Crea la pagina completa**

```html
<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<title>FPS — Generatore minimappa (tool dev)</title>
<style>
body{background:#111;color:#eee;font-family:monospace;margin:0;padding:16px}
h1{font-size:16px;margin:0 0 12px}
#status{margin-bottom:12px;white-space:pre-line}
#links a{color:#6cf;margin-right:12px}
#out{max-width:100%;border:1px solid #444}
</style>
</head>
<body>
<h1>Generatore texture minimappa — apri questa pagina dopo OGNI modifica alla mappa</h1>
<div id="status">Caricamento zone…</div>
<div id="links"></div>
<canvas id="out"></canvas>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
<script src="world-config.js"></script>
<script>
// ══════════════════════════════════════════════════════
//  TOOL DEV — genera la texture top-down della minimappa
//  Carica le stesse zone del gioco (WORLD_CONFIG) con un loader
//  SEMPLIFICATO (solo posa istanze: niente toon/collisioni/merge),
//  renderizza con camera ORTOGRAFICA verticale e salva PNG+JSON
//  via POST /dev/minimap. In caso di errore: NESSUN salvataggio.
// ══════════════════════════════════════════════════════
(async () => {
const statusEl = document.getElementById('status');
const log = m => { statusEl.textContent += '\n' + m; };

const MAX_TEX = 2048;   // lato massimo texture (px)
const MARGIN  = 3;      // margine attorno all'area giocabile (unità mondo)

const loader = new THREE.GLTFLoader();
const _CB = '?v=' + Date.now();   // anti-cache, come loadZone in fps.js
const gltfLoad = url => new Promise((res, rej) => loader.load(url + _CB, res, undefined, rej));

// ── 1. Zone → gruppo mondo (loader semplificato) ──
const world = new THREE.Group();
try {
    const varchi = await fetch(WORLD_CONFIG.VARCHI_URL + _CB).then(r => r.json());
    for (const zn of WORLD_CONFIG.ZONES) {
        const off  = zn.offset || { x: 0, z: 0 };
        const skip = zn.varchi ? varchi.skip : [];
        const layout = await fetch(zn.dir + zn.json + _CB).then(r => r.json());
        const modelNames = [...new Set([
            ...layout.edifici.map(e => e.modello),
            ...layout.props.map(p => p.modello)
        ])];
        const models = {};
        for (const n of modelNames) models[n] = (await gltfLoad(zn.dir + n + '.glb')).scene;
        if (zn.pav !== false) {
            const pav = (await gltfLoad(zn.dir + 'pavimentazione.glb')).scene;
            pav.position.set(off.x, 0, off.z);
            world.add(pav);
        }
        // Stessa semantica di loadZone: skip su coord LOCALI, raggio 1.0,
        // vale per edifici E props; i passthrough sono visibili → inclusi.
        const nearSkip = inst => skip.some(s => Math.hypot(inst.x - s.x, inst.z - s.z) < 1.0);
        const place = inst => {
            const g = models[inst.modello].clone(true);
            g.position.set(inst.x + off.x, inst.y || 0, inst.z + off.z);
            g.rotation.y = (inst.rotY || 0) * Math.PI / 180;
            const s = inst.s || 1.0;
            g.scale.set(s, s, s);
            world.add(g);
        };
        layout.edifici.forEach(e => { if (!nearSkip(e)) place(e); });
        layout.props.forEach(p =>   { if (!nearSkip(p)) place(p); });
        log('OK  ' + zn.dir);
    }
} catch (e) {
    statusEl.textContent = 'ERRORE caricamento zone: ' + e.message +
        '\nNessuna texture salvata (mai salvare un render parziale).';
    throw e;
}
// Mesh COL_ = collisioni invisibili in gioco → invisibili anche qui
world.traverse(o => { if (o.isMesh && o.name.indexOf('COL_') === 0) o.visible = false; });

// ── 2. Scena, luci, camera ortografica top-down ──
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14141c);   // fuori-mappa scuro
scene.add(world);
scene.add(new THREE.AmbientLight(0xffffff, 0.85));
const sun = new THREE.DirectionalLight(0xffffff, 0.55);
sun.position.set(30, 100, 20);   // leggermente inclinato: dà modellato ai tetti
scene.add(sun);

const bb = new THREE.Box3().setFromObject(world);
const minX = bb.min.x - MARGIN, maxX = bb.max.x + MARGIN;
const minZ = bb.min.z - MARGIN, maxZ = bb.max.z + MARGIN;
const w = maxX - minX, h = maxZ - minZ;
const pxPerUnit = MAX_TEX / Math.max(w, h);          // scala UNIFORME sui 2 assi
const W = Math.round(w * pxPerUnit), H = Math.round(h * pxPerUnit);

const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 500);
cam.position.set((minX + maxX) / 2, 200, (minZ + maxZ) / 2);
cam.up.set(0, 0, -1);                    // mondo +X → destra immagine, +Z → basso
cam.lookAt(cam.position.x, 0, cam.position.z);

// ── 3. Render ──
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputEncoding = THREE.sRGBEncoding;   // colori GLB corretti (come da GLTFLoader)
renderer.setSize(W, H);
renderer.render(scene, cam);
const dataURL = renderer.domElement.toDataURL('image/png');

// anteprima a schermo
const out = document.getElementById('out');
out.width = W; out.height = H;
out.getContext('2d').drawImage(renderer.domElement, 0, 0);

const meta = { minX, minZ, maxX, maxZ, width: W, height: H };
log('Render ' + W + 'x' + H + ' px — bounds X[' + minX.toFixed(1) + ',' + maxX.toFixed(1) +
    '] Z[' + minZ.toFixed(1) + ',' + maxZ.toFixed(1) + ']');

// ── 4. Salvataggio automatico (route dev); ripiego: download manuale ──
try {
    const r = await fetch('/dev/minimap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ png: dataURL, meta })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    log('SALVATO in frontend/assets/minimap/ (world.png + world.json)');
} catch (e) {
    log('Salvataggio automatico FALLITO (' + e.message + ') — scarica a mano e copia in frontend/assets/minimap/:');
    const links = document.getElementById('links');
    const a1 = document.createElement('a');
    a1.href = dataURL; a1.download = 'world.png'; a1.textContent = '[scarica world.png]';
    const a2 = document.createElement('a');
    a2.href = 'data:application/json,' + encodeURIComponent(JSON.stringify(meta, null, 2));
    a2.download = 'world.json'; a2.textContent = '[scarica world.json]';
    links.append(a1, a2);
}
})();
</script>
</body>
</html>
```

- [ ] **Step 2: Verifica (utente, server avviato dall'utente)**

Aprire `localhost:3000/minimap-gen.html`:
- l'anteprima mostra il mondo intero dall'alto (disco Jazz a sinistra, Galleria a destra, Piazza e Funland in mezzo/sud), varchi Jazz APERTI (skip applicata), nessuna lastra parassita da mesh `COL_`;
- status: `OK` per le 5 zone + `SALVATO in frontend/assets/minimap/`;
- `frontend/assets/minimap/world.png` aperto nel viewer = stessa immagine; `world.json` ha bounds plausibili (X da ≈−48 a ≈130, Z da ≈−50 a ≈48) e `width/height` coerenti col PNG.

Test del ripiego: spegnere il server ovviamente non si può (serve per la pagina) → per simulare il fallimento POST, temporaneamente avviare con `NODE_ENV=production node server.js` e ricaricare la pagina: devono comparire i due link di download. Poi tornare all'avvio normale.

---

### Task 4: sfondo texture in `drawMinimap()` + docs

**Files:**
- Modify: `frontend/fps.js:3225-3297` (sezione MINIMAP)
- Modify: `docs/fps-notes.md` (sezione "Minimap")

**Interfaces:**
- Consumes: `assets/minimap/world.png` + `world.json` (Task 3). Formato meta: `{ minX, minZ, maxX, maxZ, width, height }`, scala px/unità uniforme, +X→destra, +Z→basso.
- Produces: nulla per altri task.

- [ ] **Step 1: Caricamento non bloccante della texture**

In `fps.js`, nella sezione MINIMAP subito dopo `const minimapCtx = ...` (riga ~3228), aggiungere:

```js
// Sfondo minimappa: texture pre-generata dal tool dev minimap-gen.html
// (assets/minimap/world.png + world.json di calibrazione).
// Caricamento NON bloccante: finché — o se — manca, resta lo sfondo nero.
let _mmTex = null, _mmMeta = null;
(function loadMinimapTexture() {
    const _cb = '?v=' + Date.now();   // anti-cache come i GLB -wip
    fetch('assets/minimap/world.json' + _cb)
        .then(r => { if (!r.ok) throw new Error(); return r.json(); })
        .then(meta => {
            if (!meta || !(meta.width > 0) || !(meta.maxX > meta.minX)) return;
            const img = new Image();
            img.onload = () => { _mmTex = img; _mmMeta = meta; };
            img.src = 'assets/minimap/world.png' + _cb;
        })
        .catch(() => { /* texture assente: fallback sfondo nero */ });
})();
```

- [ ] **Step 2: Disegno dello sfondo in `drawMinimap()`**

Sostituire il blocco sfondo attuale (righe ~3252-3258):

```js
    // Sfondo + clip circolare
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, size, size);
```

con:

```js
    // Sfondo + clip circolare
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.clip();
    if (_mmTex) {
        // Texture del mondo con GLI STESSI sin/cos e scala di toMM.
        // Pixel texture (u,v) → mondo (minX+u·k, minZ+v·k) → proiezione
        // forward/right del player; in forma di matrice canvas:
        //   sx = e + u·a + v·cc      sy = f + u·b + v·d
        const k  = (_mmMeta.maxX - _mmMeta.minX) / _mmMeta.width;  // unità mondo per px texture
        const a  =  s * k * cosY, b =  s * k * sinY;               // colonna u (asse X mondo)
        const cc = -s * k * sinY, d =  s * k * cosY;               // colonna v (asse Z mondo)
        const rx0 = _mmMeta.minX - px, rz0 = _mmMeta.minZ - pz;    // angolo texture, relativo al player
        const e = c + s * (rx0 * cosY - rz0 * sinY);
        const f = c + s * (rx0 * sinY + rz0 * cosY);
        ctx.fillStyle = '#0b0b10';               // fuori-texture: scuro pieno
        ctx.fillRect(0, 0, size, size);
        ctx.setTransform(a, b, cc, d, e, f);
        ctx.filter = 'saturate(0.65)';           // desatura: i pallini devono spiccare
        ctx.drawImage(_mmTex, 0, 0);
        ctx.filter = 'none';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = 'rgba(10,10,14,0.45)';   // velo scuro ("render reale scurito")
        ctx.fillRect(0, 0, size, size);
    } else {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';      // fallback: sfondo nero attuale
        ctx.fillRect(0, 0, size, size);
    }
```

Nota: croce di riferimento, pallini giocatori (con logiche fog/blackout/sonar), `ctx.restore()` e triangolo player NON si toccano — vengono disegnati sopra come oggi.

- [ ] **Step 3: Aggiorna `docs/fps-notes.md`**

Sostituire la sezione (riga ~189):

```markdown
### Minimap (client `drawMinimap()`)
Rotante, player-centric: il giocatore è sempre al centro come triangolo che punta in alto. Proietta le coord-mondo sui vettori forward/right del player. Canvas 130px, in alto a destra.
```

con:

```markdown
### Minimap (client `drawMinimap()`)
Rotante, player-centric: il giocatore è sempre al centro come triangolo che punta in alto. Proietta le coord-mondo sui vettori forward/right del player. Canvas 130px, in alto a destra.
**Sfondo**: texture top-down del mondo (`assets/minimap/world.png` + `world.json` di calibrazione `{minX,minZ,maxX,maxZ,width,height}`, +X→destra, +Z→basso, scala px/unità uniforme), disegnata con la stessa rotazione/scala di `toMM` + velo scuro; fallback sfondo nero se assente.
**Rigenerazione (SOLO in dev, mai in partita)**: dopo ogni modifica alla mappa aprire `localhost:3000/minimap-gen.html` — carica le zone da `world-config.js` (config condivisa con fps.js), renderizza in ortografica top-down e salva via `POST /dev/minimap` (route attiva solo fuori produzione).
```

- [ ] **Step 4: Verifica finale (utente, in localhost, due tab)**

1. La minimappa mostra edifici/strade attorno al player al posto del nero; ruotando la visuale, il disegno ruota coerente (ciò che hai davanti sta in alto).
2. Camminare lungo un riferimento riconoscibile (es. imbocco della Galleria): la posizione sul disegno corrisponde al mondo.
3. I pallini degli altri giocatori stanno dove sono davvero (verifica incrociata tra due tab) e restano ben leggibili sul nuovo sfondo.
4. Mutatori: Nebbia/Blackout nascondono i pallini come prima; Sonar mostra solo chi corre.
5. Nessun calo di FPS percepibile; cancellando (temporaneamente) `assets/minimap/world.json` e ricaricando → sfondo nero, nessun errore in console.

---

## Self-review (eseguita in scrittura)

- **Copertura spec**: camera ortografica+margine (T3), solo statici/COL_ nascoste/porte escluse (T3, loader semplificato non carica nulla di dinamico), salvataggio su file+caricamento all'avvio (T2+T4), toMM invariato (T4 tocca solo lo sfondo), zero generazione in partita (generazione solo in minimap-gen.html), stile scurito+desaturato (T4 step 2), config condivisa (T1), fallback (T3 step "catch" + T4), verifica (step finali di ogni task). ✓
- **Placeholder**: nessuno. ✓
- **Coerenza nomi/tipi**: `WORLD_CONFIG.{GALLERIA_OFF,VARCHI_URL,ZONES}` identici in T1/T3; meta `{minX,minZ,maxX,maxZ,width,height}` identica in T2/T3/T4; route `/dev/minimap` identica in T2/T3. ✓
