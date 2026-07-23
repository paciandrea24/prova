# F1 — prato a griglia (fix macchia sotto un ponte) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminare la macchia/fessura azzurra (cielo visibile attraverso il prato) che compare vicino a un vero sovrappasso, sostituendo il "buco" del prato — oggi un poligono vettoriale che può autointersecarsi quando la pista passa vicino a se stessa — con una griglia di celle, immune per costruzione a questo problema.

**Architecture:** `TrackMeshBuilder.buildGround` smette di costruire `THREE.Shape` + `holes` (rimossi `offsetLoop`/`isPointInPolygon`/`toVector2Path`, non più necessari). Al loro posto, una griglia di quad copre il bounding box della pista + margine: una cella diventa prato solo se il suo centro è oltre `embankOuter` dal punto a terra (non-ponte) più vicino — un test locale per cella, mai autointersecante. Oltre la griglia, un unico piano piatto senza fori copre il resto del mondo.

**Tech Stack:** Three.js r128 (CDN), vanilla JS.

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-07-22-f1-terrapieno-e-ponti-design.md`, sezione "Fix post-playtest: prato a griglia".
- `buildGround(container, trackPts, embankOuter, worldSize)` mantiene la stessa firma di prima — nessuna modifica al call site in `frontend/f1.js`.
- `frontend/shared/trackMeshBuilder.js` non ha test automatici: verifica tramite `node -c` (sintassi) + verifica manuale in localhost (ultimo task).
- Italiano nei commenti, coerente con lo stile esistente del file.
- Non fare commit se non richiesto esplicitamente dall'utente.

---

### Task 1: Riscrivere `buildGround` a griglia

**Files:**
- Modify: `frontend/shared/trackMeshBuilder.js`

**Interfaces:**
- `buildGround(container, trackPts, embankOuter, worldSize)` — firma invariata.
- Rimuove `offsetLoop`, `isPointInPolygon`, `toVector2Path`, `GROUND_HOLE_STRIDE` (non più usati da nessuno in questo file).

- [ ] **Step 1: Sostituire il blocco poligono-con-foro con la griglia**

In `frontend/shared/trackMeshBuilder.js`, sostituire l'intero blocco (dal commento sopra `GROUND_HOLE_STRIDE` fino alla chiusura di `buildGround`):

```js
    // 1000 campioni pista sono inutilmente tanti per il contorno del "buco"
    // nel prato (che deve solo essere abbastanza morbido da sembrare
    // naturale, non preciso al centimetro): uno ogni 5 campioni (200 punti)
    // è più sicuro per la triangolazione di ShapeGeometry ed è comunque
    // scorrevole a vista.
    const GROUND_HOLE_STRIDE = 5;

    function offsetLoop(trackPts, radius, side) {
        const out = [];
        for (let i = 0; i < trackPts.length; i += GROUND_HOLE_STRIDE) {
            // Un punto-ponte non contribuisce al contorno: il punto
            // campionato precedente/successivo (a terra) restano comunque
            // nell'array, quindi il poligono li collega con un segmento
            // dritto — esattamente il "taglio dritto" voluto sotto un ponte,
            // senza bisogno di altra logica qui.
            if (trackPts[i].bridge) continue;
            const { nx, nz } = TrackGeometry.normalAt(trackPts, i, true);
            const p = trackPts[i];
            out.push({ x: p.x + nx * radius * side, z: p.z + nz * radius * side });
        }
        return out;
    }

    // Test "punto dentro il poligono" (ray casting): usato una sola volta per
    // scoprire quale lato (-1/+1) dell'offset è l'interno (infield, area
    // finita) e quale l'esterno (area praticamente infinita) — non si può
    // assumere a priori il verso con cui un tracciato è stato disegnato
    // nell'editor, va scoperto a runtime.
    function isPointInPolygon(poly, x, z) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, zi = poly[i].z;
            const xj = poly[j].x, zj = poly[j].z;
            const intersect = ((zi > z) !== (zj > z)) &&
                (x < (xj - xi) * (z - zi) / (zj - zi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function toVector2Path(points) {
        return points.map(p => new THREE.Vector2(p.x, p.z));
    }

    // Prato: due pezzi distinti perché il giro è chiuso e ha un "dentro"
    // (infield, area finita) e un "fuori" (area enorme) — un singolo foro in
    // un'unica shape non può rappresentare un anello. DoubleSide su
    // entrambi: evita di dover determinare a priori il verso di
    // triangolazione/rotazione giusto per far puntare la normale verso
    // l'alto (stessa scelta già fatta per pista/cordoli/barriere in questo
    // file, per lo stesso motivo).
    function buildGround(container, trackPts, embankOuter, worldSize) {
        const loopA = offsetLoop(trackPts, embankOuter, 1);
        const loopB = offsetLoop(trackPts, embankOuter, -1);
        const aIsInside = isPointInPolygon(loopB, loopA[0].x, loopA[0].z);
        const insideLoop  = aIsInside ? loopA : loopB;
        const outsideLoop = aIsInside ? loopB : loopA;

        const material = new THREE.MeshStandardMaterial({
            color: GRASS_COLOR, roughness: 1, metalness: 0, side: THREE.DoubleSide
        });

        const half = worldSize / 2;
        const outerShape = new THREE.Shape([
            new THREE.Vector2(-half, -half), new THREE.Vector2(half, -half),
            new THREE.Vector2(half, half), new THREE.Vector2(-half, half),
        ]);
        outerShape.holes.push(new THREE.Path(toVector2Path(outsideLoop)));
        const exteriorGeo = new THREE.ShapeGeometry(outerShape);
        exteriorGeo.rotateX(Math.PI / 2);
        const exterior = new THREE.Mesh(exteriorGeo, material);
        exterior.receiveShadow = true;
        container.add(exterior);

        const infieldShape = new THREE.Shape(toVector2Path(insideLoop));
        const infieldGeo = new THREE.ShapeGeometry(infieldShape);
        infieldGeo.rotateX(Math.PI / 2);
        const infield = new THREE.Mesh(infieldGeo, material);
        infield.receiveShadow = true;
        container.add(infield);
    }
```

con:

```js
    // Dimensione lato di una cella della griglia prato: abbastanza piccola
    // da seguire bene il contorno del terrapieno, abbastanza grande da
    // restare economica su un tracciato grande.
    const GROUND_GRID_CELL = 20;

    // Prato "vicino": una griglia di quad, tenuti solo se il centro è oltre
    // embankOuter dal punto a terra (non-ponte) più vicino. A differenza del
    // precedente poligono con foro (rimosso), un test per cella non può mai
    // autointersecarsi — anche quando la pista passa vicino a se stessa (un
    // vero ponte/sovrappasso), che invece rompeva la triangolazione del
    // poligono (macchia/fessura segnalata dall'utente subito dopo la fine
    // del tratto ponte su "prova"). Nessuna classificazione "dentro/fuori"
    // necessaria: infield ed esterno sono trattati allo stesso modo, un
    // semplice test di distanza.
    // Prato "lontano": un unico piano piatto senza fori, abbastanza lontano
    // dalla griglia da non potersi mai sovrapporre al terrapieno o tagliare
    // una discesa.
    function buildGround(container, trackPts, embankOuter, worldSize) {
        const groundPts = trackPts.filter(p => !p.bridge);
        const material = new THREE.MeshStandardMaterial({
            color: GRASS_COLOR, roughness: 1, metalness: 0, side: THREE.DoubleSide
        });

        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const p of trackPts) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        }
        const pad = embankOuter + GROUND_GRID_CELL;
        minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;

        const cols = Math.ceil((maxX - minX) / GROUND_GRID_CELL);
        const rows = Math.ceil((maxZ - minZ) / GROUND_GRID_CELL);
        const pos = [];
        const idx = [];

        for (let cx = 0; cx < cols; cx++) {
            for (let cz = 0; cz < rows; cz++) {
                const x0 = minX + cx * GROUND_GRID_CELL, x1 = x0 + GROUND_GRID_CELL;
                const z0 = minZ + cz * GROUND_GRID_CELL, z1 = z0 + GROUND_GRID_CELL;
                const cxCenter = (x0 + x1) / 2, czCenter = (z0 + z1) / 2;
                // Leggermente aggressivo (embankOuter - metà cella): meglio
                // una cella che sovrappone un po' il terrapieno (stesso
                // colore, invisibile) che una fessura scoperta al bordo per
                // colpa della risoluzione della griglia.
                const d = TrackGeometry.nearestPoint(groundPts, cxCenter, czCenter).dist;
                if (d < embankOuter - GROUND_GRID_CELL / 2) continue;

                const base = pos.length / 3;
                pos.push(x0, 0, z0,  x1, 0, z0,  x1, 0, z1,  x0, 0, z1);
                idx.push(base, base + 1, base + 2,  base, base + 2, base + 3);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(pos), 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const grid = new THREE.Mesh(geo, material);
        grid.receiveShadow = true;
        container.add(grid);

        const farGeo = new THREE.PlaneGeometry(worldSize, worldSize);
        const far = new THREE.Mesh(farGeo, material);
        far.rotation.x = -Math.PI / 2;
        // Leggermente sotto la griglia (a y=0): la griglia resta sempre
        // sopra al bordo della propria estensione, niente z-fighting.
        far.position.y = -0.01;
        far.receiveShadow = true;
        container.add(far);
    }
```

- [ ] **Step 2: Verificare che il file non abbia errori di sintassi**

Run: `node -c frontend/shared/trackMeshBuilder.js`
Expected: nessun output (exit code 0).

- [ ] **Step 3: Verifica manuale in localhost (utente)**

Avviare il server (`node server.js` da `backend/`), caricare "prova" (con il tratto già marcato ponte). Controllare:
- La macchia/fessura azzurra subito dopo la fine del tratto ponte non c'è più: solo prato continuo.
- Il prato intorno al resto della pista (tratti senza ponte) appare come prima: continuo, senza gradini né buchi, fino al terrapieno.
- Girare un giro intero su "prova" e su una pista senza ponti (es. "monte-rosso"): nessuna regressione, prato piatto ovunque su quest'ultima.
- Controllare a distanza (vicino all'orizzonte, lontano dalla pista): il prato "lontano" deve apparire continuo, nessun bordo visibile della griglia.

Questo step è manuale e non ha un comando da eseguire: è il gate di
approvazione dell'utente prima di considerare il task chiuso.

- [ ] **Step 4: Commit (solo su richiesta esplicita dell'utente)**

```bash
git add frontend/shared/trackMeshBuilder.js
git commit -m "$(cat <<'EOF'
F1: prato a griglia invece di poligono con foro (fix macchia sotto un ponte)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Non eseguire questo step finché l'utente non lo chiede esplicitamente.
