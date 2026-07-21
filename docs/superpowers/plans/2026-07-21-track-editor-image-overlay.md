# Track Editor — overlay immagine di riferimento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere di incollare (Ctrl+V) un'immagine di un tracciato reale nel track-editor come overlay semi-trasparente, posizionabile/scalabile/ruotabile a mano, per ricalcarlo con i punti pista esistenti.

**Architecture:** Un piano Three.js texturato (`imageOverlay`) vive nella stessa scena del track-editor, sotto la griglia (y=-0.05). Due maniglie (`imageHandleGroup`) compaiono solo in modalità posizionamento e intercettano i drag prima della logica esistente di aggiunta/trascinamento punti.

**Tech Stack:** Three.js r128 (già caricato via CDN in `track-editor.html`), vanilla JS, nessun bundler/build step.

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-07-21-track-editor-image-overlay-design.md`
- Nessuna modifica al formato dati delle piste (`buildTrackData`/`applyTrackData` invariati), nessuna persistenza dell'immagine.
- Nessuna modifica a `f1.js`/`f1GameSocket.js`: solo `track-editor.html` e `track-editor.js`.
- Il progetto NON ha test automatici per il track-editor (strumento dev-only, nessun file `track-editor.test.js`): verifica manuale in localhost, come da convenzione di progetto.
- Italiano nei commenti, coerente con lo stile esistente del file.
- Non fare commit se non richiesto esplicitamente dall'utente.

---

### Task 1: Overlay immagine nel track-editor

**Files:**
- Modify: `frontend/track-editor.html:24-58` (pannello + hint)
- Modify: `frontend/track-editor.js` (stato, funzioni overlay, gestori mousedown/mousemove/mouseup)

**Interfaces:**
- Nessuna interfaccia esterna: tutto lo stato (`imageOverlay`, `imagePositioning`, `imageDrag`) è locale al modulo `track-editor.js`, non attraversa `buildTrackData()`/`applyTrackData()`.

- [ ] **Step 1: Aggiungere la sezione pannello nell'HTML**

In `frontend/track-editor.html`, subito prima di `</div>` che chiude `#panel` (dopo il bottone `exportBtn`, riga 56), aggiungere:

```html
        <div id="imgOverlaySection" style="display:none;">
            <hr style="border-color: #4b5b6b; margin: 10px 0;">
            <h1>Immagine di riferimento</h1>
            <label>Opacità
                <input type="range" id="imgOpacity" min="0" max="100" value="35">
            </label>
            <button id="imgConfirmBtn">Conferma posizione</button>
            <button id="imgEditBtn">Modifica posizione</button>
            <button id="imgRemoveBtn">Rimuovi immagine</button>
        </div>
```

E sostituire la riga 58 (`<div id="hint">...</div>`) con:

```html
    <div id="hint">Click: aggiungi punto · Trascina un punto: sposta · Tasto destro: elimina · Rotellina su un punto: alza/abbassa (solo pista) · Tasto centrale + trascina: pan · Rotellina altrove: zoom · Ctrl+V: incolla immagine di riferimento da ricalcare (poi trascina corpo/maniglie, Conferma per bloccarla)</div>
```

- [ ] **Step 2: Aggiungere stato e gruppo maniglie in track-editor.js**

Subito dopo la riga `const markerGroup = new THREE.Group(); scene.add(markerGroup);` (circa riga 47-48), aggiungere:

```js
    // ====================================================
    // OVERLAY IMMAGINE DI RIFERIMENTO — incollata con Ctrl+V, serve solo a
    // ricalcare un tracciato reale con i punti esistenti. Non persiste (né
    // in buildTrackData() né sul server): sparisce a reload/cambio pista.
    // ====================================================
    let imageOverlay = null;      // { mesh, texture, x, z, rotation, width, height, opacity }
    let imagePositioning = false; // true = maniglie attive, click normali sospesi
    let imageDrag = null;         // { mode: 'move'|'scale'|'rotate', ...dati iniziali }
    let scaleHandleMesh = null;
    let rotateHandleMesh = null;
    const imageHandleGroup = new THREE.Group();
    scene.add(imageHandleGroup);
```

- [ ] **Step 3: Aggiungere le funzioni di gestione dell'overlay**

Subito dopo il blocco appena aggiunto (prima della sezione `// FEEDBACK VISIVO QUOTA`), aggiungere:

```js
    function updateImageOverlayTransform() {
        if (!imageOverlay) return;
        imageOverlay.mesh.position.set(imageOverlay.x, -0.05, imageOverlay.z);
        imageOverlay.mesh.rotation.y = imageOverlay.rotation;
        imageOverlay.mesh.scale.set(imageOverlay.width, 1, imageOverlay.height);
    }

    // Le maniglie sono posizionate ricalcolando a mano la trasformazione
    // (centro + rotazione Y) invece di essere figlie del mesh dell'immagine:
    // così restano oggetti di primo livello, facili da raycastare separati
    // dal piano stesso (vedi pickImageHandle).
    function updateImageHandles() {
        if (!imageOverlay || !imagePositioning) return;
        const { x, z, rotation, width, height } = imageOverlay;
        const cos = Math.cos(rotation), sin = Math.sin(rotation);

        const cornerLocalX = width / 2, cornerLocalZ = height / 2;
        scaleHandleMesh.position.set(
            x + cornerLocalX * cos + cornerLocalZ * sin,
            0.2,
            z - cornerLocalX * sin + cornerLocalZ * cos
        );

        const gap = Math.max(6, height * 0.15);
        const topLocalZ = -(height / 2 + gap);
        rotateHandleMesh.position.set(x + topLocalZ * sin, 0.2, z + topLocalZ * cos);
    }

    function enterImagePositioning() {
        if (!imageOverlay) return;
        imagePositioning = true;
        if (!scaleHandleMesh) {
            const handleGeo = new THREE.SphereGeometry(3, 12, 12);
            scaleHandleMesh = new THREE.Mesh(handleGeo, new THREE.MeshBasicMaterial({ color: 0x2ecc71 }));
            scaleHandleMesh.userData = { mode: 'scale' };
            rotateHandleMesh = new THREE.Mesh(handleGeo, new THREE.MeshBasicMaterial({ color: 0xe67e22 }));
            rotateHandleMesh.userData = { mode: 'rotate' };
        }
        imageHandleGroup.add(scaleHandleMesh, rotateHandleMesh);
        updateImageHandles();
    }

    function exitImagePositioning() {
        imagePositioning = false;
        imageDrag = null;
        imageHandleGroup.clear();
    }

    function setOverlayImage(img) {
        if (imageOverlay) removeImageOverlay();
        const texture = new THREE.Texture(img);
        texture.needsUpdate = true;
        const aspect = img.width / img.height;
        const width  = aspect >= 1 ? 150 : 150 * aspect;
        const height = aspect >= 1 ? 150 / aspect : 150;
        // Piano unitario "sdraiato" una volta sola in fase di creazione: da
        // qui in poi basta scale.set(width,1,height) per dimensionarlo,
        // niente da ricalcolare sulla geometria ad ogni resize.
        const geo = new THREE.PlaneGeometry(1, 1);
        geo.rotateX(-Math.PI / 2);
        const material = new THREE.MeshBasicMaterial({
            map: texture, transparent: true, opacity: 0.35,
            depthWrite: false, side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geo, material);
        scene.add(mesh);

        imageOverlay = { mesh, texture, x: camTarget.x, z: camTarget.z, rotation: 0, width, height, opacity: 0.35 };
        updateImageOverlayTransform();

        document.getElementById('imgOverlaySection').style.display = 'block';
        document.getElementById('imgOpacity').value = 35;
        enterImagePositioning();
    }

    function removeImageOverlay() {
        if (!imageOverlay) return;
        scene.remove(imageOverlay.mesh);
        imageOverlay.mesh.geometry.dispose();
        imageOverlay.mesh.material.dispose();
        imageOverlay.texture.dispose();
        imageOverlay = null;
        exitImagePositioning();
        document.getElementById('imgOverlaySection').style.display = 'none';
    }

    function pickImageHandle(ev) {
        mouseNDC.x = (ev.clientX / window.innerWidth) * 2 - 1;
        mouseNDC.y = -(ev.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouseNDC, camera);
        const hits = raycaster.intersectObjects(imageHandleGroup.children);
        return hits.length > 0 ? hits[0].object : null;
    }

    function pickImageBody(ev) {
        mouseNDC.x = (ev.clientX / window.innerWidth) * 2 - 1;
        mouseNDC.y = -(ev.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouseNDC, camera);
        return raycaster.intersectObject(imageOverlay.mesh).length > 0;
    }

    document.addEventListener('paste', (ev) => {
        const items = ev.clipboardData && ev.clipboardData.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                ev.preventDefault();
                const blob = item.getAsFile();
                const url = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => { setOverlayImage(img); URL.revokeObjectURL(url); };
                img.src = url;
                break;
            }
        }
    });

    document.getElementById('imgOpacity').addEventListener('input', (ev) => {
        if (!imageOverlay) return;
        imageOverlay.opacity = ev.target.value / 100;
        imageOverlay.mesh.material.opacity = imageOverlay.opacity;
    });
    document.getElementById('imgConfirmBtn').addEventListener('click', exitImagePositioning);
    document.getElementById('imgEditBtn').addEventListener('click', enterImagePositioning);
    document.getElementById('imgRemoveBtn').addEventListener('click', removeImageOverlay);
```

- [ ] **Step 4: Intercettare mousedown in modalità posizionamento**

Nel gestore `renderer.domElement.addEventListener('mousedown', ...)` esistente (circa riga 180-194), sostituire:

```js
        if (ev.button === 2) return;
        const marker = pickMarker(ev);
        if (marker) { dragging = marker.userData; return; }
        const hit = worldFromEvent(ev);
        activeList().push({ x: +hit.x.toFixed(2), z: +hit.z.toFixed(2) });
        rebuild();
    });
```

con:

```js
        if (ev.button === 2) return;
        if (imagePositioning) {
            const handle = pickImageHandle(ev);
            if (handle) {
                imageDrag = handle.userData.mode === 'scale'
                    ? { mode: 'scale', startWidth: imageOverlay.width, startHeight: imageOverlay.height,
                        startCornerDist: 0.5 * Math.hypot(imageOverlay.width, imageOverlay.height) }
                    : { mode: 'rotate' };
                return;
            }
            if (pickImageBody(ev)) imageDrag = { mode: 'move' };
            return;
        }
        const marker = pickMarker(ev);
        if (marker) { dragging = marker.userData; return; }
        const hit = worldFromEvent(ev);
        activeList().push({ x: +hit.x.toFixed(2), z: +hit.z.toFixed(2) });
        rebuild();
    });
```

- [ ] **Step 5: Gestire il drag delle maniglie/corpo in mousemove**

Nel gestore `renderer.domElement.addEventListener('mousemove', ...)` esistente (circa riga 196-216), subito dopo il blocco `if (panning) { ... return; }` e prima di `if (!dragging) return;`, inserire:

```js
        if (imageDrag) {
            const hit = worldFromEvent(ev);
            if (imageDrag.mode === 'move') {
                imageOverlay.x = hit.x;
                imageOverlay.z = hit.z;
            } else if (imageDrag.mode === 'scale') {
                const dist = Math.hypot(hit.x - imageOverlay.x, hit.z - imageOverlay.z);
                const ratio = Math.max(0.05, dist / imageDrag.startCornerDist);
                imageOverlay.width = imageDrag.startWidth * ratio;
                imageOverlay.height = imageDrag.startHeight * ratio;
            } else if (imageDrag.mode === 'rotate') {
                const dx = hit.x - imageOverlay.x, dz = hit.z - imageOverlay.z;
                imageOverlay.rotation = Math.atan2(-dx, -dz);
            }
            updateImageOverlayTransform();
            updateImageHandles();
            return;
        }
```

- [ ] **Step 6: Ripulire lo stato di drag in mouseup**

Sostituire la riga (circa 218):

```js
    window.addEventListener('mouseup', () => { dragging = null; panning = false; });
```

con:

```js
    window.addEventListener('mouseup', () => { dragging = null; panning = false; imageDrag = null; });
```

- [ ] **Step 7: Verificare che il file non abbia errori di sintassi**

Run: `node -c frontend/track-editor.js`
Expected: nessun output (exit code 0)

- [ ] **Step 8: Verifica manuale in localhost (utente)**

Avviare il server (`node server.js` dalla cartella `backend/`), aprire
`localhost:3000/track-editor.html`. Controllare:
- Copiare uno screenshot/immagine (es. da un sito mappe) e premere Ctrl+V
  nella pagina dell'editor: l'immagine compare semi-trasparente, centrata
  sulla vista corrente, con le due maniglie (verde = scala, arancione =
  ruota) visibili.
- Trascinare il corpo dell'immagine: si sposta seguendo il mouse.
- Trascinare la maniglia verde (angolo): l'immagine si ingrandisce/rimpicciolisce
  mantenendo le proporzioni originali.
- Trascinare la maniglia arancione (sopra): l'immagine ruota seguendo il
  mouse attorno al proprio centro.
- Muovere lo slider "Opacità": il livello di trasparenza cambia in tempo
  reale.
- Premere "Conferma posizione": le maniglie spariscono, i click ora
  aggiungono normalmente punti pista (comportamento identico a prima
  dell'incolla); l'immagine resta ferma e visibile sotto.
- Tracciare qualche punto sopra l'immagine: la mesh della pista deve
  ricoprire progressivamente l'immagine sottostante dove passa.
- Premere "Modifica posizione": le maniglie devono ricomparire e permettere
  ulteriori aggiustamenti.
- Premere "Rimuovi immagine": overlay e sezione pannello spariscono,
  l'editor torna come prima del paste.
- Ricaricare la pagina: l'immagine non deve ricomparire.

Questo step è manuale e non ha un comando da eseguire: è il gate di
approvazione dell'utente prima di considerare il task chiuso.

- [ ] **Step 9: Commit (solo su richiesta esplicita dell'utente)**

```bash
git add frontend/track-editor.html frontend/track-editor.js
git commit -m "$(cat <<'EOF'
F1 track-editor: overlay immagine di riferimento per ricalco tracciati (Ctrl+V, drag/scala/ruota)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Non eseguire questo step finché l'utente non lo chiede esplicitamente.
