# Track editor — box trigger pit trascinabile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere trascinabile col mouse il riquadro trigger di ingresso ai box (xMin/xMax/zMin/zMax) nel track editor, sostituendo il wireframe sottile con una cornice spessa cliccabile che sposta il riquadro senza ridimensionarlo.

**Architecture:** Il riquadro trigger, oggi un `THREE.LineSegments` puramente visivo (`entryTriggerMesh`), diventa un `THREE.Group` di 4 mesh piatte (cornice, spessore fisso) sia visive che raycastabili. Un nuovo stato di drag (`triggerDrag`), sullo stesso modello di `imageDrag`/`dragging` già esistenti, intercetta il click sulla cornice in `mousedown` e trasla i 4 campi numerici in `mousemove`.

**Tech Stack:** Three.js r128 (già caricato via CDN in `track-editor.html`), vanilla JS, nessun bundler/build step.

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-07-22-track-editor-pit-trigger-drag-design.md`
- Nessuna modifica al formato dati/export delle piste (`buildTrackData`): i campi numerici restano l'unica fonte di verità, il drag li scrive e basta.
- Nessun ridimensionamento via drag: solo spostamento, dimensioni invariate.
- Nessuna modifica a `f1.js`/`f1GameSocket.js`/`trackMeshBuilder.js`: solo `frontend/track-editor.js`.
- Il progetto NON ha test automatici per il track-editor (strumento dev-only): verifica manuale in localhost, come da convenzione di progetto.
- Italiano nei commenti, coerente con lo stile esistente del file.
- Non fare commit se non richiesto esplicitamente dall'utente.

---

### Task 1: Cornice cliccabile e drag del box trigger

**Files:**
- Modify: `frontend/track-editor.js:266-304` (sezione "RIQUADRO TRIGGER INGRESSO PIT")
- Modify: `frontend/track-editor.js:330-402` (stato di drag + gestori mousedown/mousemove/mouseup)

**Interfaces:**
- Nessuna interfaccia esterna: `entryTriggerFrame` e `triggerDrag` sono stato locale del modulo, non attraversano `buildTrackData()`.
- Consuma: `visualClampExtent()`, `worldFromEvent(ev)`, `raycaster`, `mouseNDC`, `camera` (tutti già esistenti nel file, invariati).

- [ ] **Step 1: Sostituire `entryTriggerMesh` con una cornice a 4 barre**

In `frontend/track-editor.js`, sostituire (righe 266, 286-304):

```js
    let entryTriggerMesh = null;
```

con:

```js
    let entryTriggerFrame = null; // THREE.Group di 4 barre piatte: cornice visiva E bersaglio del drag
    // Spessore fisso della cornice, stessa scala d'ingombro dei marker/maniglie
    // già cliccabili in questo editor (sfere raggio 2-3): un wireframe sottile
    // (1px) era troppo difficile da centrare col mouse per trascinarlo.
    const ENTRY_TRIGGER_FRAME_THICKNESS = 5;
```

E sostituire (il corpo di `updateEntryTriggerVisual`, righe 286-304):

```js
    function updateEntryTriggerVisual() {
        if (entryTriggerMesh) { scene.remove(entryTriggerMesh); entryTriggerMesh = null; }
        const xMin = parseFloat(document.getElementById('entryXMin').value);
        const xMax = parseFloat(document.getElementById('entryXMax').value);
        const zMin = parseFloat(document.getElementById('entryZMin').value);
        const zMax = parseFloat(document.getElementById('entryZMax').value);
        if (![xMin, xMax, zMin, zMax].every(Number.isFinite) || xMin >= xMax || zMin >= zMax) return;

        const clamp = visualClampExtent();
        const cx0 = Math.max(xMin, -clamp), cx1 = Math.min(xMax, clamp);
        const cz0 = Math.max(zMin, -clamp), cz1 = Math.min(zMax, clamp);
        if (cx0 >= cx1 || cz0 >= cz1) return;

        const geo = new THREE.BoxGeometry(cx1 - cx0, 3, cz1 - cz0);
        const edges = new THREE.EdgesGeometry(geo);
        entryTriggerMesh = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xff00ff }));
        entryTriggerMesh.position.set((cx0 + cx1) / 2, 1.5, (cz0 + cz1) / 2);
        scene.add(entryTriggerMesh);
    }
```

con:

```js
    function updateEntryTriggerVisual() {
        if (entryTriggerFrame) { scene.remove(entryTriggerFrame); entryTriggerFrame = null; }
        const xMin = parseFloat(document.getElementById('entryXMin').value);
        const xMax = parseFloat(document.getElementById('entryXMax').value);
        const zMin = parseFloat(document.getElementById('entryZMin').value);
        const zMax = parseFloat(document.getElementById('entryZMax').value);
        if (![xMin, xMax, zMin, zMax].every(Number.isFinite) || xMin >= xMax || zMin >= zMax) return;

        const clamp = visualClampExtent();
        const cx0 = Math.max(xMin, -clamp), cx1 = Math.min(xMax, clamp);
        const cz0 = Math.max(zMin, -clamp), cz1 = Math.min(zMax, clamp);
        if (cx0 >= cx1 || cz0 >= cz1) return;

        // Cornice = 4 barre piatte (non un box pieno): l'interno resta senza
        // mesh, così un click al centro del riquadro continua ad aggiungere
        // punti pista/box come oggi. Solo le barre sono il bersaglio del drag
        // (vedi pickEntryTriggerFrame).
        const w = cx1 - cx0, d = cz1 - cz0, t = ENTRY_TRIGGER_FRAME_THICKNESS;
        const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
        entryTriggerFrame = new THREE.Group();

        const barTB = new THREE.PlaneGeometry(w, t);
        const top = new THREE.Mesh(barTB, mat);
        top.rotation.x = -Math.PI / 2;
        top.position.set((cx0 + cx1) / 2, 1.5, cz0 + t / 2);
        const bottom = new THREE.Mesh(barTB, mat);
        bottom.rotation.x = -Math.PI / 2;
        bottom.position.set((cx0 + cx1) / 2, 1.5, cz1 - t / 2);

        // Barre verticali accorciate di 2*t: gli angoli sono già coperti da
        // top/bottom, evita di sovrapporre due mesh trasparenti nello stesso
        // punto (si vedrebbe più scuro/opaco agli angoli).
        const barLR = new THREE.PlaneGeometry(t, Math.max(0.01, d - 2 * t));
        const left = new THREE.Mesh(barLR, mat);
        left.rotation.x = -Math.PI / 2;
        left.position.set(cx0 + t / 2, 1.5, (cz0 + cz1) / 2);
        const right = new THREE.Mesh(barLR, mat);
        right.rotation.x = -Math.PI / 2;
        right.position.set(cx1 - t / 2, 1.5, (cz0 + cz1) / 2);

        entryTriggerFrame.add(top, bottom, left, right);
        scene.add(entryTriggerFrame);
    }

    function pickEntryTriggerFrame(ev) {
        if (!entryTriggerFrame) return false;
        mouseNDC.x = (ev.clientX / window.innerWidth) * 2 - 1;
        mouseNDC.y = -(ev.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouseNDC, camera);
        return raycaster.intersectObjects(entryTriggerFrame.children).length > 0;
    }
```

- [ ] **Step 2: Verificare che il file non abbia errori di sintassi**

Run: `node -c frontend/track-editor.js`
Expected: nessun output (exit code 0)

- [ ] **Step 3: Aggiungere lo stato `triggerDrag`**

In `frontend/track-editor.js`, sostituire (circa riga 330-332):

```js
    let dragging = null;
    let panning = false;
    let panLast = { x: 0, y: 0 };
```

con:

```js
    let dragging = null;
    let panning = false;
    let panLast = { x: 0, y: 0 };
    let triggerDrag = null; // { startHitX, startHitZ, startXMin, startXMax, startZMin, startZMax }
```

- [ ] **Step 4: Intercettare il click sulla cornice in mousedown**

Sostituire, nel gestore `mousedown` esistente (circa riga 355-360):

```js
        const marker = pickMarker(ev);
        if (marker) { dragging = marker.userData; return; }
        const hit = worldFromEvent(ev);
        activeList().push({ x: +hit.x.toFixed(2), z: +hit.z.toFixed(2) });
        rebuild();
    });
```

con:

```js
        const marker = pickMarker(ev);
        if (marker) { dragging = marker.userData; return; }
        if (pickEntryTriggerFrame(ev)) {
            const hit = worldFromEvent(ev);
            triggerDrag = {
                startHitX: hit.x, startHitZ: hit.z,
                startXMin: parseFloat(document.getElementById('entryXMin').value),
                startXMax: parseFloat(document.getElementById('entryXMax').value),
                startZMin: parseFloat(document.getElementById('entryZMin').value),
                startZMax: parseFloat(document.getElementById('entryZMax').value),
            };
            return;
        }
        const hit = worldFromEvent(ev);
        activeList().push({ x: +hit.x.toFixed(2), z: +hit.z.toFixed(2) });
        rebuild();
    });
```

- [ ] **Step 5: Applicare lo spostamento in mousemove**

Sostituire, nel gestore `mousemove` esistente, subito dopo il blocco `if (imageDrag) { ... return; }` e prima di `if (!dragging) return;` (circa riga 392-393):

```js
        if (!dragging) return;
```

con:

```js
        if (triggerDrag) {
            const hit = worldFromEvent(ev);
            const dx = hit.x - triggerDrag.startHitX;
            const dz = hit.z - triggerDrag.startHitZ;
            document.getElementById('entryXMin').value = (triggerDrag.startXMin + dx).toFixed(2);
            document.getElementById('entryXMax').value = (triggerDrag.startXMax + dx).toFixed(2);
            document.getElementById('entryZMin').value = (triggerDrag.startZMin + dz).toFixed(2);
            document.getElementById('entryZMax').value = (triggerDrag.startZMax + dz).toFixed(2);
            updateEntryTriggerVisual();
            return;
        }
        if (!dragging) return;
```

- [ ] **Step 6: Ripulire `triggerDrag` in mouseup**

Sostituire (circa riga 402):

```js
    window.addEventListener('mouseup', () => { dragging = null; panning = false; imageDrag = null; });
```

con:

```js
    window.addEventListener('mouseup', () => { dragging = null; panning = false; imageDrag = null; triggerDrag = null; });
```

- [ ] **Step 7: Verificare che il file non abbia errori di sintassi**

Run: `node -c frontend/track-editor.js`
Expected: nessun output (exit code 0)

- [ ] **Step 8: Verifica manuale in localhost (utente)**

Avviare il server (`node server.js` dalla cartella `backend/`), aprire
`localhost:3000/track-editor.html` con un tracciato che ha una corsia box
(es. quello attualmente in editing). Controllare:
- Il riquadro trigger appare come cornice spessa magenta (4 barre), non più
  come sottile wireframe.
- Cliccare e trascinare una delle 4 barre della cornice: il riquadro si
  sposta seguendo il mouse; i campi `entryXMin/entryXMax/entryZMin/entryZMax`
  si aggiornano live durante il trascinamento.
- Dopo il drag, la larghezza (xMax-xMin) e la profondità (zMax-zMin) del
  riquadro sono identiche a prima del drag (solo spostato, non ridimensionato).
- Cliccare al centro del riquadro (non sulla cornice): si aggiunge ancora un
  punto alla lista attiva (pista o corsia box, a seconda del checkbox
  "pitMode"), esattamente come prima di questa modifica.
- Se un marker esistente (punto pista/box) si trova sopra/vicino alla
  cornice, cliccarlo e trascinarlo deve muovere il marker, non il box.
- Esportare il tracciato (bottone export) e verificare che il JSON contenga
  i valori del riquadro dopo il drag.

Questo step è manuale e non ha un comando da eseguire: è il gate di
approvazione dell'utente prima di considerare il task chiuso.

- [ ] **Step 9: Commit (solo su richiesta esplicita dell'utente)**

```bash
git add frontend/track-editor.js
git commit -m "$(cat <<'EOF'
Track editor: box trigger pit trascinabile (cornice spessa cliccabile)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Non eseguire questo step finché l'utente non lo chiede esplicitamente.
