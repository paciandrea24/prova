# F1 Livery Studio — fix buchi ruote + voxel neri — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fixare due bug nel tool esterno `voxel_livery_studio.html`: buchi
nelle ruote esportate (dovuti a mis-classificazione dei voxel di
confine tra ruota e `Plank`) e voxel neri "corrotti" su nose/chassis
quando il colore secondario scelto è scuro (blend colore che clippa a
nero).

**Architecture:** Due fix isolati, indipendenti tra loro, nello stesso
file. Fix 1 (ruote): al posto di ricostruire la geometria ruota dai
voxel in fase di export, si usa la geometria originale del file
caricato (le ruote non vengono comunque ricolorate dalla livrea, quindi
è equivalente a un export "corretto"). Fix 2 (voxel neri): si sostituisce
il blend additivo in HSL con uno moltiplicativo con floor minimo, che
non può mai azzerare la luminosità.

**Tech Stack:** JavaScript vanilla (ES module), Three.js r160 (import
da CDN unpkg), nessun bundler/framework di test. Verifica con Blender
5.1 headless (`"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe"`)
per ispezionare i `.glb` prodotti.

## Global Constraints

- File target: `C:\Users\pacia\Desktop\livery\voxel_livery_studio.html`
  — **non è dentro un repo git** (verificato: `git rev-parse
  --is-inside-work-tree` fallisce in quella cartella). Nessun commit git
  per questo file: prima di modificarlo, farne una copia di backup
  timestamp in locale.
- Non toccare la logica di voxelizzazione/classificazione
  (`voxelize()`, `buildModel()`, `bestName`) — il fix ruote passa
  esclusivamente dall'export, non dalla classificazione dei voxel.
- Non toccare `frontend/shared/carLoader.js` — quel file risolve un
  problema diverso (ricolora una fascia di tonalità su una texture-palette
  esistente), non riusarne la logica, solo il principio "moltiplicativo +
  floor batte additivo".
- Regex di riconoscimento ruota: riusare esattamente
  `/wheel|tire|tyre|rubber|gomm|ruota/i` (stessa già usata per `isRubber`
  in `collectTriangles()`, riga 608), per coerenza con la classificazione
  già esistente nel file.
- `SHADE_FLOOR = 0.22` è un valore indicativo di partenza — verificare a
  occhio nel browser con colore secondario scuro (`#461616`) e vivido
  (`#FF0000`) e regolare se necessario, non è un numero sacro.
- Nessun framework di test presente per questo tool (nessun jest/build
  pipeline, file HTML singolo con `<script type="module">` inline). La
  verifica del fix 2 (matematica pura, niente DOM/WebGL) si fa con un
  calcolo numerico rapido via `node -e`. La verifica del fix 1 (dipende da
  GLTFLoader/Exporter, DOM, canvas) si fa ispezionando il `.glb` esportato
  con lo script Blender headless di Task 3, più verifica visiva in
  browser/gioco — coerente con come il resto del progetto tratta il
  codice frontend/visuale (verifica manuale in localhost, non unit test).

---

### Task 1: Fix voxel neri — blend colore moltiplicativo con floor

**Files:**
- Modify: `C:\Users\pacia\Desktop\livery\voxel_livery_studio.html:1273-1291`

**Interfaces:**
- Consumes: `M.domHSL` (righe 919-930, già calcolato in
  `computeBodyColors()`), `origHSL`/`targetHSL` (calcolati localmente nel
  loop di `applyLivery()`).
- Produces: nessuna nuova funzione esposta — modifica locale al blocco
  "TRASFERIMENTO OMBRE" dentro `applyLivery()`.

- [ ] **Step 1: Backup del file prima di modificarlo**

```bash
cp "C:\Users\pacia\Desktop\livery\voxel_livery_studio.html" "C:\Users\pacia\Desktop\livery\voxel_livery_studio.backup-pre-fix.html"
```

- [ ] **Step 2: Riprodurre numericamente il bug (dimostra il clipping additivo)**

Esegui questo calcolo con Node — replica esattamente la formula attuale
(riga 1282-1283) con numeri realistici dello scenario segnalato: colore
secondario scuro (`#461616`, L≈0.18) e un voxel che nell'originale era
un'ombra/AO molto scura (L origine ≈0.05) su una carrozzeria dominante
media (domL≈0.45):

```bash
node -e "
const targetL = 0.18;   // luminosita' HSL di #461616
const origL = 0.05;     // voxel ombra molto scura nell'originale
const domL = 0.45;      // luminosita' dominante body (M.domHSL.l)
const deltaL = origL - domL;
const finalL = Math.max(0, Math.min(1, targetL + deltaL));
console.log('additivo (bug):', finalL);
"
```

Expected output: `additivo (bug): 0` — conferma che il voxel clippa a
luminosità zero (nero puro), riproducendo il difetto segnalato.

- [ ] **Step 3: Sostituire il blend additivo con quello moltiplicativo**

Nel file, il blocco attuale (righe 1273-1291):

```js
                    // 2. TRASFERIMENTO OMBRE (HSL BLENDING)
                    const origColor = new THREE.Color(M.orig[q * 3], M.orig[q * 3 + 1], M.orig[q * 3 + 2]);
                    const origHSL = { h: 0, s: 0, l: 0 };
                    origColor.getHSL(origHSL);

                    const targetColor = new THREE.Color(r, g, b);
                    const targetHSL = { h: 0, s: 0, l: 0 };
                    targetColor.getHSL(targetHSL);

                    const deltaL = origHSL.l - M.domHSL.l;
                    let finalL = Math.max(0, Math.min(1, targetHSL.l + deltaL));

                    let finalS = targetHSL.s;
                    if (origHSL.s < 0.25) {
                        finalS = targetHSL.s * (origHSL.s / 0.25);
                    }

                    targetColor.setHSL(targetHSL.h, finalS, finalL);
                    r = targetColor.r; g = targetColor.g; b = targetColor.b;
```

va sostituito con:

```js
                    // 2. TRASFERIMENTO OMBRE (HSL BLENDING, moltiplicativo)
                    // Additivo (finalL = targetL + deltaL) puo' andare sotto
                    // zero e clippare a nero puro quando il target e' scuro
                    // e il voxel originale era un'ombra/AO molto scura —
                    // moltiplicativo con floor minimo non tocca mai lo zero.
                    const origColor = new THREE.Color(M.orig[q * 3], M.orig[q * 3 + 1], M.orig[q * 3 + 2]);
                    const origHSL = { h: 0, s: 0, l: 0 };
                    origColor.getHSL(origHSL);

                    const targetColor = new THREE.Color(r, g, b);
                    const targetHSL = { h: 0, s: 0, l: 0 };
                    targetColor.getHSL(targetHSL);

                    const relShade = origHSL.l / Math.max(M.domHSL.l, 0.02);
                    const shadeMult = Math.max(SHADE_FLOOR, relShade);
                    let finalL = Math.max(0, Math.min(1, targetHSL.l * shadeMult));

                    let finalS = targetHSL.s;
                    if (origHSL.s < 0.25) {
                        finalS = targetHSL.s * (origHSL.s / 0.25);
                    }

                    targetColor.setHSL(targetHSL.h, finalS, finalL);
                    r = targetColor.r; g = targetColor.g; b = targetColor.b;
```

- [ ] **Step 4: Aggiungere la costante `SHADE_FLOOR`**

Subito sopra `function applyLivery() {` (poco prima della riga che oggi
recita `function applyLivery() {`), aggiungere:

```js
        // Luminosita' minima (come frazione della luminosita' del colore
        // scelto) che un voxel puo' assumere per via dell'ombra/AO
        // originale — evita che il blend moltiplicativo scenda mai a
        // luminosita' zero (nero puro) su colori target scuri.
        const SHADE_FLOOR = 0.22;
```

- [ ] **Step 5: Verificare numericamente che il fix risolve il caso di Step 2**

```bash
node -e "
const targetL = 0.18;
const origL = 0.05;
const domL = 0.45;
const SHADE_FLOOR = 0.22;
const relShade = origL / Math.max(domL, 0.02);
const shadeMult = Math.max(SHADE_FLOOR, relShade);
const finalL = Math.max(0, Math.min(1, targetL * shadeMult));
console.log('moltiplicativo (fix):', finalL);
"
```

Expected output: `moltiplicativo (fix): 0.0396...` — un valore basso ma
diverso da zero (non più nero puro), conferma che il floor ha effetto.

- [ ] **Step 6: Verifica visiva in browser**

Apri `voxel_livery_studio.html` in un browser, carica
`frontend/assets/custom/f1Car.glb`, imposta pattern "Strisce centrali",
colore secondario `#461616` (lo scenario segnalato) — conferma a occhio
che nose/chassis non hanno più chiazze nere ma una gradazione continua
di rosso scuro. Ripeti con `#FF0000` per confermare che il caso già
accettabile non è peggiorato.

---

### Task 2: Salvare la geometria/materiale originali delle mesh ruota al caricamento

**Files:**
- Modify: `C:\Users\pacia\Desktop\livery\voxel_livery_studio.html:1341-1349`

**Interfaces:**
- Consumes: `src` (la `gltf.scene` caricata, disponibile nel callback di
  `loader.load` in `loadFile()`), regex ruota da Global Constraints.
- Produces: `M.originalWheelMeshes` — oggetto `{ [meshName]: { geometry:
  THREE.BufferGeometry, material: THREE.Material } }`, usato da Task 3.

- [ ] **Step 1: Estendere il traverse esistente per catturare le mesh ruota**

Il blocco attuale (righe 1341-1349):

```js
                    // --- INIZIO NUOVO CODICE: SALVATAGGIO PIVOT ORIGINALI ---
                    M.pivots = {};
                    src.traverse(o => {
                        if (o.isMesh) {
                            // Salva l'esatta coordinata 3D dell'origine di ogni pezzo originale
                            M.pivots[o.name] = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
                        }
                    });
                    // --- FINE NUOVO CODICE ---
```

va sostituito con:

```js
                    // --- INIZIO NUOVO CODICE: SALVATAGGIO PIVOT ORIGINALI ---
                    M.pivots = {};
                    // Geometria/materiale originali delle mesh ruota, per
                    // bypassare la ricostruzione voxel (con bug di buchi ai
                    // bordi Wheel/Plank) in fase di export — vedi Task 3.
                    M.originalWheelMeshes = {};
                    const wheelNameRe = /wheel|tire|tyre|rubber|gomm|ruota/i;
                    src.traverse(o => {
                        if (o.isMesh) {
                            // Salva l'esatta coordinata 3D dell'origine di ogni pezzo originale
                            M.pivots[o.name] = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
                            if (wheelNameRe.test(o.name || '')) {
                                M.originalWheelMeshes[o.name] = {
                                    geometry: o.geometry.clone(),
                                    material: Array.isArray(o.material) ? o.material[0].clone() : o.material.clone()
                                };
                            }
                        }
                    });
                    // --- FINE NUOVO CODICE ---
```

- [ ] **Step 2: Verifica in browser che la cattura avvenga**

Apri la devtools console del browser, carica `f1Car.glb` nell'editor, e
subito dopo il caricamento esegui nella console:

```js
Object.keys(M.originalWheelMeshes)
```

Expected: `["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"]` (i 4 nomi
mesh ruota confermati nell'ispezione Blender fatta in fase di design).

---

### Task 3: Usare le mesh ruota originali in `exportGLB()`

**Files:**
- Modify: `C:\Users\pacia\Desktop\livery\voxel_livery_studio.html:1453-1485`
- Test (script diagnostico, non nel repo): `C:\Users\pacia\Desktop\livery\verify_export_wheels.py`

**Interfaces:**
- Consumes: `M.originalWheelMeshes` (prodotto da Task 2), `M.pivots`
  (esistente), `parts` (mappa nome→dati voxel ricostruiti, esistente in
  `exportGLB()`).
- Produces: nessuna nuova funzione esposta — modifica locale al loop "2.
  Ricostruiamo le mesh con i Pivot corretti" dentro `exportGLB()`.

- [ ] **Step 1: Modificare il loop di ricostruzione per bypassare le parti ruota**

Il blocco attuale (righe 1453-1485):

```js
            // 2. Ricostruiamo le mesh con i Pivot corretti
            for (const name in parts) {
                const part = parts[name];

                // Recuperiamo il pivot originale (se non c'è, usiamo il centro del mondo)
                const pivot = (M.pivots && M.pivots[name]) ? M.pivots[name] : new THREE.Vector3(0, 0, 0);

                // Spostiamo i vertici: invece di dipendere dalla griglia, 
                // dipenderanno dall'origine del proprio pezzo originale!
                for (let i = 0; i < part.p.length; i += 3) {
                    const worldX = (part.p[i] * scale) + offset.x;
                    const worldY = (part.p[i + 1] * scale) + offset.y;
                    const worldZ = (part.p[i + 2] * scale) + offset.z;

                    part.p[i] = worldX - pivot.x;
                    part.p[i + 1] = worldY - pivot.y;
                    part.p[i + 2] = worldZ - pivot.z;
                }

                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(part.p), 3));
                geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(part.n), 3));
                geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(part.c), 3));
                geo.setIndex(new THREE.BufferAttribute(new Uint32Array(part.i), 1));

                const m = new THREE.Mesh(geo, matLit);
                m.name = name;

                // Piazziamo l'oggetto esattamente dove si trovava l'originale
                m.position.copy(pivot);

                exportScene.add(m);
            }
```

va sostituito con:

```js
            // 2. Ricostruiamo le mesh con i Pivot corretti
            for (const name in parts) {
                // Le mesh ruota non vengono ricolorate dalla livrea (sono
                // sempre "locked" in computeBase/applyLivery) e la loro
                // ricostruzione voxel soffre di un bug di classificazione
                // ai bordi con "Plank" (voxel di confine assegnati alla
                // parte sbagliata → buchi quando la ruota gira in gioco).
                // Bypassiamo la ricostruzione e usiamo la geometria
                // originale intatta, allo stesso pivot delle altre parti.
                if (M.originalWheelMeshes && M.originalWheelMeshes[name]) {
                    const orig = M.originalWheelMeshes[name];
                    const pivot = (M.pivots && M.pivots[name]) ? M.pivots[name] : new THREE.Vector3(0, 0, 0);
                    const m = new THREE.Mesh(orig.geometry.clone(), orig.material);
                    m.name = name;
                    m.position.copy(pivot);
                    exportScene.add(m);
                    continue;
                }

                const part = parts[name];

                // Recuperiamo il pivot originale (se non c'è, usiamo il centro del mondo)
                const pivot = (M.pivots && M.pivots[name]) ? M.pivots[name] : new THREE.Vector3(0, 0, 0);

                // Spostiamo i vertici: invece di dipendere dalla griglia, 
                // dipenderanno dall'origine del proprio pezzo originale!
                for (let i = 0; i < part.p.length; i += 3) {
                    const worldX = (part.p[i] * scale) + offset.x;
                    const worldY = (part.p[i + 1] * scale) + offset.y;
                    const worldZ = (part.p[i + 2] * scale) + offset.z;

                    part.p[i] = worldX - pivot.x;
                    part.p[i + 1] = worldY - pivot.y;
                    part.p[i + 2] = worldZ - pivot.z;
                }

                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(part.p), 3));
                geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(part.n), 3));
                geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(part.c), 3));
                geo.setIndex(new THREE.BufferAttribute(new Uint32Array(part.i), 1));

                const m = new THREE.Mesh(geo, matLit);
                m.name = name;

                // Piazziamo l'oggetto esattamente dove si trovava l'originale
                m.position.copy(pivot);

                exportScene.add(m);
            }
```

- [ ] **Step 2: Verifica in browser che l'export non generi errori**

Nel browser, carica `f1Car.glb`, applica una livrea qualsiasi, premi
"Esporta .glb" — conferma che il download parte senza errori in
console.

- [ ] **Step 3: Scrivere lo script diagnostico di confronto vertici**

Crea `C:\Users\pacia\Desktop\livery\verify_export_wheels.py`:

```python
import bpy
import json
import sys

# Uso: blender --background --python verify_export_wheels.py -- <path_al_glb_esportato>
argv = sys.argv[sys.argv.index("--") + 1:]
EXPORTED_PATH = argv[0]

EXPECTED = {
    "Wheel_FL": 816,
    "Wheel_FR": 930,
    "Wheel_RL": 876,
    "Wheel_RR": 882,
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=EXPORTED_PATH)

found = {}
for obj in bpy.data.objects:
    if obj.type == 'MESH' and obj.name in EXPECTED:
        found[obj.name] = len(obj.data.vertices)

ok = True
for name, expected_n in EXPECTED.items():
    actual_n = found.get(name)
    status = "OK" if actual_n == expected_n else "MISMATCH"
    if actual_n != expected_n:
        ok = False
    print(f"{name}: atteso={expected_n} trovato={actual_n} [{status}]")

print("RISULTATO:", "PASS" if ok else "FAIL")
```

- [ ] **Step 4: Eseguire lo script sul file esportato allo Step 2**

```bash
"/c/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --python "C:\Users\pacia\Desktop\livery\verify_export_wheels.py" -- "<percorso del file .glb scaricato allo Step 2>"
```

Expected: tutte e 4 le righe `[OK]` e `RISULTATO: PASS` — conferma che
il numero di vertici delle 4 ruote nel file esportato coincide
esattamente con quello del modello originale (816/930/876/882), cioè
sono la geometria originale intatta e non una ricostruzione voxel
parziale.

- [ ] **Step 5: Verifica finale in gioco**

Copia il file esportato al posto di
`frontend/assets/custom/f1Car.glb` (fai prima un backup del file
attuale), avvia il gioco in locale (`node server.js` da `backend/`),
ed osserva le 4 ruote durante accelerazione/sterzo/frenata — conferma
che non si aprono buchi mentre girano, su nessuna delle 4 ruote.

---

## Note di chiusura

- Bug voxel neri (fix 2) e bug ruote (fix 1) sono indipendenti: si può
  fare merge/uso in produzione dell'uno senza l'altro se serve isolare
  la verifica.
- Fuori scope di questo piano (vedi spec
  `docs/superpowers/specs/2026-07-29-f1-livery-studio-wheel-color-fix-design.md`):
  colorazione front/rear wing, integrazione editor in gioco + account.
- Nessun commit/push automatico: il file modificato non è in un repo
  git; `frontend/assets/custom/f1Car.glb` nel repo "prova" va sostituito
  solo dopo la verifica dell'utente in localhost, e il commit/push
  restano manuali per convenzione di progetto.
