# Mappa Blender — Fase 1 "Piazza della Fontana" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Costruire la zona "Piazza della Fontana" del gioco FPS con asset modellati in Blender
(script Python `bpy` copia-incolla + Run Script, export GLB automatico), validando l'intera
pipeline Blender→GLB→Three.js con lo shading toon e le collisioni già esistenti nel gioco.

**Architecture:** Ogni prop riutilizzabile ha un proprio script Blender standalone che genera
la geometria con materiali a colore piatto per parte e la esporta da solo in `.glb`. Un nuovo
sistema di caricamento in `frontend/fps.js` (`loadGLBProp`/`placeProp`) carica questi GLB,
applica lo stesso `worldToon()` + `_addToonOutline()` già usati su armi/mappa attuale, ed
estrae automaticamente le collisioni dalle mesh con prefisso `COL_` nel `solidBoxes` esistente
— zero modifiche al motore di collisione (`resolveCollisions`, step-up, `canStandAt`).
La Fontana viene inserita nel punto già esistente della "piazza sud" (coordinate 0,16), in
sostituzione della vecchia `buildFountain()` procedurale — il resto della mappa attuale
("Cittadina Cartoon") resta invariato e giocabile durante questa fase pilota.

**Tech Stack:** Blender (script Python `bpy`, nessuna UI interattiva richiesta), Three.js r128
(`GLTFLoader` da `cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js`,
stessa versione già usata nel progetto per `three.min.js`), Node/Express/Socket.io lato server
(nessuna modifica server in questa fase).

## Global Constraints

- **Stile materiali**: in Blender si assegna SOLO colore piatto per parte (Principled BSDF
  Base Color). Nessuna texture dipinta, nessuna luce/ombra "cotta" — lo shading toon (gradient
  map a 3 fasce + contorno a inchiostro) si applica dopo, in Three.js, identico a quello già
  usato su armi/personaggio/mappa attuale.
- **Convenzione collisioni**: mesh con nome che inizia per `COL_` → invisibili in game,
  usate SOLO per calcolare l'AABB da inserire in `solidBoxes`. Tutte le altre mesh sono solo
  visive (coerente con la distinzione esistente `makeBox` visivo-solo vs `addSolid`
  visivo+collisione).
- **Scala/origine**: 1 unità Blender = 1 metro (coerente con `PLAYER_HEIGHT=1.7` ecc.). Ogni
  modello va costruito con la BASE a Z=0 in Blender (non centrato sull'origine), così che
  `placeProp(tpl, x, 0, z)` posizioni correttamente la base a terra — stessa convenzione di
  `addSolid` (che prende `y` come base, non come centro).
- **Shading edges**: prima dell'export, ogni mesh deve avere **Shade Smooth** applicato
  (`bpy.ops.object.shade_smooth()`), altrimenti il contorno a inchiostro (spostamento vertici
  lungo le normali) crea "gusci neri" glitchati sugli spigoli — bug storico già annotato in
  `docs/fps-notes.md` per i vecchi GLB Quaternius.
- **Idempotenza script**: ogni script Blender inizia cancellando TUTTI gli oggetti della
  scena corrente (`clear_scene()`). Usare un file Blender dedicato/vuoto per gli asset del
  gioco, non un progetto Blender personale con altro lavoro dentro.
- **Niente commit automatici**: per convenzione di progetto (CLAUDE.md: "l'utente fa il push
  manuale... non committare/pushare senza richiesta"), NESSUN task di questo piano termina con
  un commit. Ogni task termina con una verifica manuale in localhost; l'utente deciderà quando
  chiedere il commit.
- **Nessun framework di test automatico**: il progetto non ha una test suite (verificato:
  `backend/package.json` non ha script di test configurato, il frontend è vanilla JS senza
  build/test tooling). La verifica di ogni task è **manuale in localhost**, secondo la
  convenzione già in uso nel progetto (CLAUDE.md: "far verificare all'utente in localhost
  prima di proseguire").
- **Ripetizione helper Blender tra script**: ogni script Blender è auto-contenuto (copia-incolla
  singolo, nessun modulo condiviso), quindi le funzioni helper (`clear_scene`, `flat_material`,
  ecc.) sono ripetute identiche in ogni script. È intenzionale: il workflow scelto con l'utente
  richiede un file indipendente da incollare ogni volta, non un pacchetto Blender da installare.

---

## Task 1: Script Blender — Fontana con statua-pesce

**Files:**
- Create (dall'utente, eseguendo lo script in Blender): `frontend/assets/models/piazza/fontana.glb`
- Create (Claude, consegna testuale): script Python da incollare in Blender (nessun file nel
  repo — lo script vive solo nella chat/conversazione, l'utente lo incolla in Blender)

**Interfaces:**
- Consumes: nessuna (primo task)
- Produces: `frontend/assets/models/piazza/fontana.glb` con mesh nominate:
  `COL_vasca` (collisione, cilindro raggio ~2.4m altezza 0.85m, base Z=0),
  `pedestal`, `coppa`, `pesce_corpo`, `pesce_coda`, `pesce_pinna_L`, `pesce_pinna_R`,
  `pesce_occhio_L`, `pesce_occhio_R` (tutte visive, nessuna collisione)

- [ ] **Step 1: Consegna script Blender all'utente**

Incolla questo script in Blender (tab **Scripting** → nuovo file di testo → incolla → **Run
Script**, o Alt+P). Genera la fontana con vasca circolare, piedistallo, coppa superiore e una
statua-pesce stilizzata (rif. immagine roadmap "Piazza della Fontana"), poi esporta da solo in
`frontend/assets/models/piazza/fontana.glb`.

```python
import bpy
import os

# ── Percorso di output: assoluto, aggiorna se sposti il progetto ──
OUTPUT_PATH = "C:/Users/pacia/Desktop/Claude Workspace/prova/frontend/assets/models/piazza/fontana.glb"


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)


def flat_material(name, rgba):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    for spec_key in ('Specular', 'Specular IOR Level'):
        if spec_key in bsdf.inputs:
            bsdf.inputs[spec_key].default_value = 0.1
            break
    return mat


def add_cylinder(name, r1, r2, depth, x, y, z, material, vertices=24):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices, radius1=r1, radius2=r2, depth=depth,
        location=(x, y, z + depth / 2))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return obj


def add_sphere(name, radius, x, y, z, material, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=(x, y, z))
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def add_cone(name, radius, depth, x, y, z, material, rot_x=0.0, rot_z=0.0):
    bpy.ops.mesh.primitive_cone_add(
        vertices=3, radius1=radius, radius2=0.0, depth=depth,
        location=(x, y, z), rotation=(rot_x, 0.0, rot_z))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return obj


clear_scene()

mat_pietra = flat_material("pietra_basalto", (0.55, 0.52, 0.47, 1.0))
mat_acqua_pietra = flat_material("pietra_chiara", (0.68, 0.65, 0.58, 1.0))
mat_pesce = flat_material("pesce_ottone", (0.75, 0.58, 0.22, 1.0))
mat_occhio = flat_material("occhio_nero", (0.03, 0.03, 0.03, 1.0))

# Vasca esterna (collisione) — raggio 2.4-2.5, altezza 0.85, base a Z=0
vasca = add_cylinder("COL_vasca", 2.5, 2.4, 0.85, 0, 0, 0.0, mat_pietra, vertices=28)

# Piedistallo centrale (visivo, sopra la vasca)
add_cylinder("pedestal", 0.35, 0.42, 1.5, 0, 0, 0.85, mat_pietra, vertices=16)

# Coppa superiore (svasata verso l'alto)
add_cylinder("coppa", 0.9, 0.6, 0.3, 0, 0, 2.35, mat_acqua_pietra, vertices=20)

# ── Statua-pesce stilizzata, in piedi sulla coppa, muso verso l'alto ──
fish_z = 2.65
add_sphere("pesce_corpo", 0.42, 0, 0, fish_z + 0.5, mat_pesce, scale=(0.75, 0.75, 1.6))
add_cone("pesce_coda", 0.32, 0.5, 0, 0, fish_z - 0.05, mat_pesce, rot_x=3.14159)
add_cone("pesce_pinna_L", 0.16, 0.35, -0.32, 0, fish_z + 0.35, mat_pesce, rot_z=1.15)
add_cone("pesce_pinna_R", 0.16, 0.35, 0.32, 0, fish_z + 0.35, mat_pesce, rot_z=-1.15)
add_sphere("pesce_occhio_L", 0.06, -0.14, 0.32, fish_z + 0.85, mat_occhio)
add_sphere("pesce_occhio_R", 0.06, 0.14, 0.32, fish_z + 0.85, mat_occhio)

os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUTPUT_PATH, export_format='GLB')
print("Esportato:", OUTPUT_PATH)
```

- [ ] **Step 2: Verifica manuale (Blender)**

Dopo Run Script: controlla nel viewport Blender che sia comparsa una fontana (vasca larga,
piedistallo sottile, coppa, pesce in cima). Controlla nella console di Blender (finestra
in basso, "Info"/system console) che sia stampato `Esportato: C:/.../fontana.glb` senza errori.

- [ ] **Step 3: Verifica file GLB creato**

L'utente conferma che il file esiste in `frontend/assets/models/piazza/fontana.glb`
(dimensione file > 0, tipicamente qualche decina di KB per questa geometria).

---

## Task 2: GLTFLoader + loading overlay (fps.html + fps.css)

**Files:**
- Modify: `frontend/fps.html:253-254` (script tag), aggiunta overlay markup dopo la riga 100
  (dopo il blocco `#overlay`)
- Modify: `frontend/styles/fps.css` (nuove regole per `#model-loading`)

**Interfaces:**
- Consumes: nessuna
- Produces: elemento DOM `#model-loading` (nascosto di default) e `#model-loading-text`,
  usati da `loadPiazzaProps()` nel Task 3. Global `THREE.GLTFLoader` disponibile dopo il
  caricamento CDN.

- [ ] **Step 1: Aggiungi lo script GLTFLoader in `frontend/fps.html`**

Modifica le righe 253-254 (subito prima del tag `<script src="/socket.io/socket.io.js">`):

```html
    <!-- Three.js CDN (GLTFLoader per i prop mappa modellati in Blender) -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
```

- [ ] **Step 2: Aggiungi il markup dell'overlay di caricamento**

Subito dopo la chiusura del blocco `#overlay` (dopo la riga con `</div>` che chiude
`overlay-box`/`overlay`, la stessa zona del blocco letto in precedenza attorno alla riga 100),
aggiungi:

```html
    <!-- ═══════════ LOADING PROP GLB ═══════════ -->
    <div id="model-loading" style="display:none;">
        <div id="model-loading-box">
            <div id="model-loading-text">Caricamento scenario…</div>
        </div>
    </div>
```

- [ ] **Step 3: Aggiungi lo stile in `frontend/styles/fps.css`**

Aggiungi in fondo al file:

```css
/* ═══════════ LOADING PROP GLB (Blender assets) ═══════════ */
#model-loading {
    position: fixed;
    inset: 0;
    background: rgba(10, 8, 6, 0.88);
    z-index: 500;
    display: flex;
    align-items: center;
    justify-content: center;
}
#model-loading-box {
    color: #f4efe2;
    font-family: Georgia, serif;
    font-size: 1.3rem;
    letter-spacing: 0.04em;
    padding: 1.2rem 2rem;
    border: 2px solid #f4efe2;
    border-radius: 6px;
}
```

- [ ] **Step 4: Verifica manuale**

Apri `localhost:3000` fino alla pagina FPS in due tab (join lobby → FPS come da
`CLAUDE.md`). Apri la console del browser (F12): nessun errore relativo a `GLTFLoader` o al
caricamento di `three@0.128.0/examples/js/loaders/GLTFLoader.js` (deve risultare 200, non 404).
L'overlay `#model-loading` non deve essere visibile (resta `display:none` finché il Task 3 non
lo attiva via codice).

---

## Task 3: Loader GLB + integrazione fontana in `fps.js`

**Files:**
- Modify: `frontend/fps.js` — nuova sezione subito dopo `addSolid()` (dopo la riga 720, prima
  del blocco "Cassa di legno dettagliata" a riga 722)
- Modify: `frontend/fps.js:1298` — rimuovi `buildFountain(0, 16);`
- Modify: `frontend/fps.js:1783` — dopo `buildMap();`, aggiungi `loadPiazzaProps();`

**Interfaces:**
- Consumes: `worldToon(opts)` (fps.js:632), `_addToonOutline(src, outMat, tMul)` (fps.js:608),
  `solidBoxes` (fps.js:711), `scene` (Three.js scene globale già esistente), `MAT.ink`,
  `MAT.water` (fps.js:635-672), `makeCyl(rTop, rBot, h, mat, x, y, z, axis, radial)` (fps.js:699)
- Produces: `loadGLBProp(name): Promise<THREE.Group>` (template, mai aggiunto a `scene`),
  `placeProp(template, x, y, z, rotY=0): THREE.Group` (istanza clonata, aggiunta a `scene`,
  con `COL_*` registrate in `solidBoxes`), `loadPiazzaProps(): Promise<void>` (carica e
  posiziona tutti i prop GLB della Piazza definiti finora)

- [ ] **Step 1: Aggiungi il sistema di caricamento prop GLB in `frontend/fps.js`**

Subito dopo la funzione `addSolid` (dopo la riga 720, prima del commento
`// ── Cassa di legno dettagliata...`), inserisci:

```javascript
// ══════════════════════════════════════════════════════
//  PROP GLB (asset modellati in Blender, stile "Piazza Rubber-Hollow")
//  Ogni GLB ha materiali a colore piatto per parte: qui li convertiamo
//  allo stesso shading toon (worldToon + contorno inchiostro) già usato
//  su armi/personaggio/resto della mappa. Le mesh con nome che inizia
//  per "COL_" sono invisibili e servono solo a calcolare l'AABB di
//  collisione (stessa convenzione makeBox visivo-solo / addSolid solido).
// ══════════════════════════════════════════════════════
const _gltfLoader = new THREE.GLTFLoader();
const _propTemplateCache = {}; // name -> Promise<THREE.Group>

const PROP_PATHS = {
    fontana: 'assets/models/piazza/fontana.glb'
};

function loadGLBProp(name) {
    if (_propTemplateCache[name]) return _propTemplateCache[name];
    const path = PROP_PATHS[name];
    _propTemplateCache[name] = new Promise((resolve, reject) => {
        _gltfLoader.load(path, (gltf) => {
            const root = gltf.scene;
            root.traverse((child) => {
                if (!child.isMesh) return;
                const isCollision = child.name.startsWith('COL_');
                const srcColor = (child.material && child.material.color)
                    ? child.material.color.clone() : new THREE.Color(0xffffff);
                child.material = worldToon({ color: srcColor });
                child.castShadow = true;
                child.receiveShadow = true;
                if (isCollision) {
                    child.visible = false;
                } else {
                    _addToonOutline(child, MAT.ink);
                }
            });
            resolve(root);
        }, undefined, reject);
    });
    return _propTemplateCache[name];
}

function placeProp(template, x, y, z, rotY = 0) {
    const inst = template.clone(true);
    inst.position.set(x, y, z);
    inst.rotation.y = rotY;
    scene.add(inst);
    inst.updateMatrixWorld(true);
    inst.traverse((child) => {
        if (!child.isMesh || !child.name.startsWith('COL_')) return;
        const box = new THREE.Box3().setFromObject(child);
        solidBoxes.push({ min: box.min.clone(), max: box.max.clone() });
    });
    return inst;
}

async function loadPiazzaProps() {
    const overlay = document.getElementById('model-loading');
    if (overlay) overlay.style.display = 'flex';
    try {
        const fontanaTpl = await loadGLBProp('fontana');
        placeProp(fontanaTpl, 0, 0, 16, 0);
        // Effetti acqua (restano primitive Three.js, non fanno parte del GLB)
        makeCyl(2.1, 2.1, 0.1, MAT.water, 0, 0.72, 16, 'y', 22);   // specchio d'acqua
        makeCyl(0.06, 0.1, 0.4, MAT.water, 0, 3.35, 16, 'y', 10);  // zampillo dal muso del pesce
    } catch (err) {
        console.error('Errore caricamento prop Piazza:', err);
    } finally {
        if (overlay) overlay.style.display = 'none';
    }
}
```

- [ ] **Step 2: Rimuovi la vecchia fontana procedurale**

In `frontend/fps.js`, trova la riga (circa 1298):

```javascript
    buildFountain(0, 16);
```

dentro `buildMap()`, e rimuovila (la nuova fontana GLB la sostituisce). Lascia intatte le righe
circostanti (`buildStall`, giardinetto, ecc.).

- [ ] **Step 3: Avvia il caricamento dei prop dopo `buildMap()`**

Trova la riga `buildMap();` (circa 1783) e aggiungi subito dopo:

```javascript
buildMap();
loadPiazzaProps();
```

- [ ] **Step 4: Verifica manuale in localhost**

Avvia `node server.js` da `backend/`, apri due tab su `localhost:3000`, crea/joina una lobby,
avvia il gioco FPS. Checklist:
- Compare brevemente l'overlay "Caricamento scenario…" all'ingresso in mappa, poi sparisce
- Nella "piazza sud" (dove prima c'era la vecchia fontana rotonda) ora c'è la fontana Blender:
  vasca, piedistallo, coppa, statua-pesce, specchio d'acqua e zampillo
- Lo shading del pesce/vasca è coerente con armi/personaggio (fasce di colore + contorno nero)
  — nessuna geometria "piatta senza ombre" né gusci neri glitchati sugli spigoli
- Camminando verso la vasca il giocatore si ferma sul bordo (collisione attiva, non ci si
  cammina dentro) — verifica anche saltando sopra il bordo (comportamento coerente con la
  vecchia fontana, "riparo basso")
- Nessun errore in console durante il caricamento o il gioco

Segnala eventuali problemi (scala sbagliata, colori scuri/sbagliati, collisione mancante)
prima di procedere al Task 4.

---

## Task 4: Script Blender — Lampione con faccia + posizionamento

**Files:**
- Create (dall'utente): `frontend/assets/models/piazza/lampione.glb`
- Modify: `frontend/fps.js` — aggiungi voce in `PROP_PATHS`, aggiungi posizionamenti in
  `loadPiazzaProps()`

**Interfaces:**
- Consumes: `loadGLBProp`, `placeProp` (Task 3)
- Produces: 4 istanze del lampione posizionate intorno alla fontana

- [ ] **Step 1: Consegna script Blender**

```python
import bpy
import os

OUTPUT_PATH = "C:/Users/pacia/Desktop/Claude Workspace/prova/frontend/assets/models/piazza/lampione.glb"


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)


def flat_material(name, rgba):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    for spec_key in ('Specular', 'Specular IOR Level'):
        if spec_key in bsdf.inputs:
            bsdf.inputs[spec_key].default_value = 0.1
            break
    return mat


def add_cylinder(name, r1, r2, depth, x, y, z, material, vertices=16):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices, radius1=r1, radius2=r2, depth=depth,
        location=(x, y, z + depth / 2))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return obj


def add_sphere(name, radius, x, y, z, material, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=(x, y, z))
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


clear_scene()

mat_ferro = flat_material("ferro_battuto", (0.15, 0.14, 0.16, 1.0))
mat_globo = flat_material("globo_crema", (0.96, 0.90, 0.72, 1.0))
mat_occhio = flat_material("occhio_nero", (0.03, 0.03, 0.03, 1.0))

# Base + palo (collisione unica per tutto il fusto, sottile)
add_cylinder("COL_palo", 0.12, 0.16, 3.0, 0, 0, 0.0, mat_ferro, vertices=10)

# Globo con faccia
add_sphere("globo", 0.32, 0, 0, 3.15, mat_globo)
add_sphere("occhio_L", 0.045, -0.14, 0.27, 3.18, mat_occhio)
add_sphere("occhio_R", 0.045, 0.14, 0.27, 3.18, mat_occhio)
add_sphere("sorriso", 0.05, 0, 0.30, 3.02, mat_occhio, scale=(1.8, 0.8, 0.5))

os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUTPUT_PATH, export_format='GLB')
print("Esportato:", OUTPUT_PATH)
```

- [ ] **Step 2: Verifica file GLB creato**

L'utente esegue lo script in Blender (Scripting → incolla → Run Script) e conferma che
`frontend/assets/models/piazza/lampione.glb` esiste.

- [ ] **Step 3: Registra il prop e posizionalo in `frontend/fps.js`**

Aggiungi la voce in `PROP_PATHS` (dentro l'oggetto già creato al Task 3):

```javascript
const PROP_PATHS = {
    fontana: 'assets/models/piazza/fontana.glb',
    lampione: 'assets/models/piazza/lampione.glb'
};
```

Nel corpo di `loadPiazzaProps()`, dopo il blocco della fontana (dopo la riga dello zampillo),
aggiungi:

```javascript
        const lampioneTpl = await loadGLBProp('lampione');
        placeProp(lampioneTpl, 5, 0, 16, 0);
        placeProp(lampioneTpl, -5, 0, 16, 0);
        placeProp(lampioneTpl, 0, 0, 11, 0);
        placeProp(lampioneTpl, 0, 0, 21, 0);
```

- [ ] **Step 4: Verifica manuale in localhost**

Ricarica il gioco. Checklist:
- 4 lampioni compaiono intorno alla fontana (est/ovest/nord/sud), ciascuno con globo e
  accenno di faccia (occhi + sorriso)
- Shading coerente col resto (fasce + contorno)
- Collisione sul palo attiva (non si attraversa), ma il globo in alto non blocca la vista
- Nessuna sovrapposizione strana con bancarelle/giardinetto già presenti nella vecchia piazza

---

## Task 5: Script Blender — Panchina + posizionamento

**Files:**
- Create (dall'utente): `frontend/assets/models/piazza/panchina.glb`
- Modify: `frontend/fps.js` — voce in `PROP_PATHS`, posizionamenti in `loadPiazzaProps()`

**Interfaces:**
- Consumes: `loadGLBProp`, `placeProp` (Task 3)
- Produces: 2 istanze di panchina posizionate vicino alla fontana

- [ ] **Step 1: Consegna script Blender**

```python
import bpy
import os

OUTPUT_PATH = "C:/Users/pacia/Desktop/Claude Workspace/prova/frontend/assets/models/piazza/panchina.glb"


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)


def flat_material(name, rgba):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    for spec_key in ('Specular', 'Specular IOR Level'):
        if spec_key in bsdf.inputs:
            bsdf.inputs[spec_key].default_value = 0.1
            break
    return mat


def add_box(name, w, d, h, x, y, z, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + h / 2))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (w / 2, d / 2, h / 2)
    obj.data.materials.append(material)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    return obj


clear_scene()

mat_legno = flat_material("legno_panchina", (0.45, 0.28, 0.14, 1.0))
mat_ferro = flat_material("ferro_gambe", (0.18, 0.17, 0.19, 1.0))

# Seduta (collisione, blocca il passaggio ma calpestabile come piccolo gradino step-up)
add_box("COL_seduta", 1.6, 0.5, 0.45, 0, 0, 0.0, mat_legno)
# Schienale
add_box("schienale", 1.6, 0.08, 0.45, 0, -0.21, 0.45, mat_legno)
# Gambe laterali in ferro
for sx in (-0.72, 0.72):
    add_box(f"gamba_{sx}", 0.08, 0.5, 0.45, sx, 0, 0.0, mat_ferro)

os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUTPUT_PATH, export_format='GLB')
print("Esportato:", OUTPUT_PATH)
```

- [ ] **Step 2: Verifica file GLB creato**

L'utente esegue lo script e conferma la presenza di `frontend/assets/models/piazza/panchina.glb`.

- [ ] **Step 3: Registra il prop e posizionalo in `frontend/fps.js`**

```javascript
const PROP_PATHS = {
    fontana: 'assets/models/piazza/fontana.glb',
    lampione: 'assets/models/piazza/lampione.glb',
    panchina: 'assets/models/piazza/panchina.glb'
};
```

In `loadPiazzaProps()`, dopo il blocco lampioni:

```javascript
        const panchinaTpl = await loadGLBProp('panchina');
        placeProp(panchinaTpl, 3.5, 0, 13, Math.PI * 0.25);
        placeProp(panchinaTpl, -3.5, 0, 19, Math.PI * 1.25);
```

- [ ] **Step 4: Verifica manuale in localhost**

Ricarica il gioco. Checklist:
- 2 panchine compaiono vicino alla fontana, orientate diagonalmente
- Step-up funziona: il giocatore può salire sulla seduta camminandoci contro (come gli altri
  ostacoli bassi della mappa, es. i box delle cassette) invece di restarne bloccato
- Shading coerente

---

## Task 6: Script Blender — Pavimentazione Piazza con varchi

**Files:**
- Create (dall'utente): `frontend/assets/models/piazza/pavimentazione_piazza.glb`
- Modify: `frontend/fps.js` — voce in `PROP_PATHS`, posizionamento in `loadPiazzaProps()`

**Interfaces:**
- Consumes: `loadGLBProp`, `placeProp` (Task 3)
- Produces: 1 istanza di pavimentazione (disco basolato + 4 corsie di collegamento N/E/S/O)
  posata leggermente sopra il terreno esistente

- [ ] **Step 1: Consegna script Blender**

```python
import bpy
import os
import math

OUTPUT_PATH = "C:/Users/pacia/Desktop/Claude Workspace/prova/frontend/assets/models/piazza/pavimentazione_piazza.glb"


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)


def flat_material(name, rgba):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    for spec_key in ('Specular', 'Specular IOR Level'):
        if spec_key in bsdf.inputs:
            bsdf.inputs[spec_key].default_value = 0.1
            break
    return mat


def add_ring(name, r_in, r_out, z, material, vertices=48):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=r_out, depth=0.06, location=(0, 0, z))
    outer = bpy.context.object
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=r_in, depth=0.2, location=(0, 0, z))
    inner = bpy.context.object
    mod = outer.modifiers.new(name="cut", type='BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = inner
    bpy.context.view_layer.objects.active = outer
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(inner, do_unlink=True)
    outer.name = name
    outer.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return outer


def add_box(name, w, d, h, x, y, z, material, rot_z=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + h / 2), rotation=(0, 0, rot_z))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (w / 2, d / 2, h / 2)
    obj.data.materials.append(material)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    return obj


clear_scene()

mat_chiaro = flat_material("basolato_chiaro", (0.72, 0.68, 0.60, 1.0))
mat_scuro = flat_material("basolato_scuro", (0.58, 0.54, 0.46, 1.0))

# Anelli concentrici alternati attorno alla fontana (raggio vasca ~2.5, quindi si parte da 2.6)
add_ring("anello_1", 2.6, 4.6, 0.02, mat_chiaro)
add_ring("anello_2", 4.6, 6.6, 0.02, mat_scuro)
add_ring("anello_3", 6.6, 8.6, 0.02, mat_chiaro)

# 4 corsie verso le future zone (Nord=Funland, Est=Galleria, Ovest=Jazz, Sud=Porto/varco)
# Nota: direzioni simboliche per questa fase pilota — l'allineamento definitivo arriva quando
# le altre 4 zone verranno costruite attorno a questo hub nelle fasi successive.
corsie = [
    ("corsia_N", 0, -1, 0),
    ("corsia_S", 0, 1, math.pi),
    ("corsia_E", 1, 0, -math.pi / 2),
    ("corsia_O", -1, 0, math.pi / 2),
]
for cname, dx, dz, rot in corsie:
    add_box(cname, 3.0, 5.0, 0.03, dx * 10.5, dz * 10.5, 0.02, mat_chiaro, rot_z=rot)

os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUTPUT_PATH, export_format='GLB')
print("Esportato:", OUTPUT_PATH)
```

- [ ] **Step 2: Verifica file GLB creato**

L'utente esegue lo script e conferma la presenza di
`frontend/assets/models/piazza/pavimentazione_piazza.glb`.

- [ ] **Step 3: Registra il prop e posizionalo in `frontend/fps.js`**

```javascript
const PROP_PATHS = {
    fontana: 'assets/models/piazza/fontana.glb',
    lampione: 'assets/models/piazza/lampione.glb',
    panchina: 'assets/models/piazza/panchina.glb',
    pavimentazione_piazza: 'assets/models/piazza/pavimentazione_piazza.glb'
};
```

In `loadPiazzaProps()`, **prima** del blocco della fontana (così la pavimentazione sta sotto,
senza z-fighting grazie ai suoi 0.02m di rialzo rispetto al terreno):

```javascript
        const pavimentazioneTpl = await loadGLBProp('pavimentazione_piazza');
        placeProp(pavimentazioneTpl, 0, 0, 16, 0);
```

(nessuna mesh `COL_` in questo prop: è solo decorazione del pavimento, cammina liberamente)

- [ ] **Step 4: Verifica manuale in localhost**

Ricarica il gioco. Checklist:
- Attorno alla fontana appare un disco di basolato ad anelli concentrici chiari/scuri, con
  4 corsie che si allontanano verso i 4 lati
- Nessuno sfarfallio/z-fighting con il terreno sottostante (`MAT.ground`)
- Nessuna collisione indesiderata: si cammina liberamente su tutta la pavimentazione

---

## Task 7: Script Blender — Bandierine/festoni + cartello testuale

**Files:**
- Create (dall'utente): `frontend/assets/models/piazza/bandierine.glb`
- Modify: `frontend/fps.js` — voce in `PROP_PATHS`, posizionamento in `loadPiazzaProps()`,
  chiamata a `addSign()` esistente per il cartello testuale

**Interfaces:**
- Consumes: `loadGLBProp`, `placeProp` (Task 3), `addSign(text, w, h, x, y, z, ry, bg, fg)`
  (fps.js:529, funzione già esistente, riusata invariata per il cartello — NON serve Blender
  per il testo, `addSign` genera già una texture canvas con cornice e scritta)
- Produces: 1 istanza festoni sopra la fontana, 1 cartello testuale "FOUNTAIN SQUARE EST. 1930"

- [ ] **Step 1: Consegna script Blender**

```python
import bpy
import os
import math

OUTPUT_PATH = "C:/Users/pacia/Desktop/Claude Workspace/prova/frontend/assets/models/piazza/bandierine.glb"


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)


def flat_material(name, rgba):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    for spec_key in ('Specular', 'Specular IOR Level'):
        if spec_key in bsdf.inputs:
            bsdf.inputs[spec_key].default_value = 0.1
            break
    return mat


def add_flag(name, x, y, z, material, rot_z=0.0):
    bpy.ops.mesh.primitive_cone_add(
        vertices=3, radius1=0.22, radius2=0.0, depth=0.3,
        location=(x, y, z), rotation=(math.pi / 2, 0, rot_z))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return obj


clear_scene()

colori = [
    flat_material("bandiera_rossa", (0.75, 0.22, 0.18, 1.0)),
    flat_material("bandiera_crema", (0.92, 0.86, 0.68, 1.0)),
    flat_material("bandiera_blu", (0.24, 0.38, 0.55, 1.0)),
]

# Festone: 9 bandierine triangolari lungo una linea da (-5,16) a (5,16) a Z=3.0,
# con un leggero abbassamento a catenaria verso il centro (effetto "corda che pende")
n = 9
for i in range(n):
    t = i / (n - 1)
    x = -5.0 + t * 10.0
    sag = math.sin(t * math.pi) * 0.35  # abbassamento max al centro
    z = 3.0 - sag
    mat = colori[i % len(colori)]
    add_flag(f"bandiera_{i}", x, 0, z, mat)

os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUTPUT_PATH, export_format='GLB')
print("Esportato:", OUTPUT_PATH)
```

- [ ] **Step 2: Verifica file GLB creato**

L'utente esegue lo script e conferma la presenza di `frontend/assets/models/piazza/bandierine.glb`.

- [ ] **Step 3: Registra il prop, posizionalo, aggiungi il cartello testuale**

```javascript
const PROP_PATHS = {
    fontana: 'assets/models/piazza/fontana.glb',
    lampione: 'assets/models/piazza/lampione.glb',
    panchina: 'assets/models/piazza/panchina.glb',
    pavimentazione_piazza: 'assets/models/piazza/pavimentazione_piazza.glb',
    bandierine: 'assets/models/piazza/bandierine.glb'
};
```

In `loadPiazzaProps()`, dopo il blocco panchine:

```javascript
        const bandierineTpl = await loadGLBProp('bandierine');
        placeProp(bandierineTpl, 0, 0, 16, 0);
```

Il cartello testuale riusa `addSign()` (già definita in `fps.js:529`, nessuna modifica alla
funzione): aggiungi questa riga **fuori** da `loadPiazzaProps()` (non serve aspettare un GLB,
è sincrona), subito dopo la chiamata `loadPiazzaProps();` di riga 1784:

```javascript
buildMap();
loadPiazzaProps();
addSign('FOUNTAIN SQUARE - EST. 1930', 3.2, 0.9, 0, 1.6, 8.5, 0);
```

- [ ] **Step 4: Verifica manuale in localhost**

Ricarica il gioco. Checklist finale di tutta la Piazza:
- Festoni triangolari colorati appesi sopra la fontana, con leggero effetto "corda che pende"
- Cartello "FOUNTAIN SQUARE - EST. 1930" leggibile vicino all'ingresso della piazza
- L'insieme (fontana + lampioni + panchine + pavimentazione + festoni + cartello) si legge
  come un'unica zona coerente, shading uniforme, nessun elemento "fuori stile"
- Partita giocabile normalmente: nessun calo di framerate percepibile, nessun errore console

---

## Task 8: Aggiornamento documentazione (`docs/fps-notes.md`)

**Files:**
- Modify: `docs/fps-notes.md`

**Interfaces:**
- Consumes: nessuna (solo documentazione)
- Produces: nessuna (nessun codice)

- [ ] **Step 1: Aggiungi una sezione sul nuovo sistema prop GLB**

Aggiungi in `docs/fps-notes.md`, dopo la sezione "### Mappa (...)" esistente, una nuova
sottosezione:

```markdown
### Prop GLB da Blender ("Piazza della Fontana", Fase 1 rifacimento mappa)
Sistema parallelo alla mappa procedurale `buildMap()`, per asset modellati in Blender
(script Python `bpy` copia-incolla + Run Script, export GLB automatico nello script).
- `PROP_PATHS` (nome→percorso), `loadGLBProp(name)` carica+cachea un template (mai in
  scene), converte ogni mesh a `worldToon()` + `_addToonOutline()` (stesso shading toon del
  resto del gioco). Mesh col prefisso `COL_` nel nome → invisibili, usate solo per calcolare
  l'AABB di collisione registrata in `solidBoxes` (stessa convenzione visivo-solo/solido di
  `makeBox`/`addSolid`).
- `placeProp(template, x, y, z, rotY)` clona il template e lo posiziona (base a Z=0 in
  Blender = base a terra in game, coerente con `addSolid`).
- `loadPiazzaProps()` (async, chiamata dopo `buildMap()`) carica e posiziona tutti i prop
  della Piazza: fontana (sostituisce la vecchia `buildFountain(0,16)` procedurale — RIMOSSA),
  lampioni, panchine, pavimentazione ad anelli, festoni. Overlay `#model-loading` durante il
  caricamento (una tantum per sessione browser, poi cache).
- Asset in `frontend/assets/models/piazza/*.glb`, script Blender sorgenti NON versionati nel
  repo (vivono nelle conversazioni/piano di implementazione: vedi
  `docs/superpowers/plans/2026-07-04-mappa-blender-piazza.md`).
- Prossime fasi (non ancora fatte): Funland, Galleria, Jazz, Porto (una zona alla volta, stesso
  pattern), poi armi e personaggio anch'essi da rifare in Blender.
```

- [ ] **Step 2: Verifica manuale**

Rileggi il file aggiornato e conferma che la sezione sia coerente con lo stile del resto del
documento (elenco puntato, riferimenti a nomi di funzione esatti).
