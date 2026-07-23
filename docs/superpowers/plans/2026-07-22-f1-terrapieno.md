# F1 — terrapieno (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Far sì che il terreno intorno alla pista segua il dislivello (terrapieno che sfuma dalla quota pista a 0 entro una distanza di transizione), così alberi/tribune e l'auto fuori pista smettono di fluttuare sui tratti sopraelevati e le discese non mostrano più un "buco verde".

**Architecture:** Una funzione pura `TrackGeometry.terrainHeightAt(groundPts, x, z, embankStart, embankOuter)` diventa l'unica fonte di verità per "che quota ha il terreno in questo punto", riusata da tre consumatori: la mesh del terrapieno (`TrackMeshBuilder.buildEmbankment` + `buildGround`, che sostituiscono il prato piatto infinito), il posizionamento scenografia (`trackScenery.js`), e la quota visiva dell'auto fuori pista (`f1.js`). Il modello dati resta quello di oggi (nessun campo nuovo nel JSON): la Fase 2 (ponti, design già scritto in `docs/superpowers/specs/2026-07-22-f1-terrapieno-e-ponti-design.md`) aggiungerà un flag `bridge` sui punti di controllo in un piano separato, senza dover rifare questa Fase 1.

**Tech Stack:** Three.js r128 (CDN), vanilla JS, `node:test` per i moduli puri già testati (`trackGeometry.js`, `trackScenery.js`).

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-07-22-f1-terrapieno-e-ponti-design.md` (solo la sezione "Fase 1").
- Nessuna modifica al formato JSON delle piste, né al backend (`f1GameSocket.js` resta interamente 2D/x-z, invariato).
- `frontend/shared/trackMeshBuilder.js` non ha test automatici (nessun `trackMeshBuilder.test.js`): verifica tramite `node -c` (sintassi) + verifica manuale in localhost.
- `frontend/shared/trackGeometry.js` e `frontend/shared/trackScenery.js` hanno test automatici (`node --test <file>`): ogni funzione nuova/modificata in questi due file va accompagnata da test.
- Non rompere i test esistenti in `trackGeometry.test.js`/`trackScenery.test.js` — se una modifica cambia un valore atteso, aggiornare il test con motivazione, non disabilitarlo.
- Italiano nei commenti, coerente con lo stile esistente dei file.
- Non fare commit se non richiesto esplicitamente dall'utente.

---

### Task 1: `TrackGeometry.terrainHeightAt`

**Files:**
- Modify: `frontend/shared/trackGeometry.js`
- Test: `frontend/shared/trackGeometry.test.js`

**Interfaces:**
- Produce: `TrackGeometry.terrainHeightAt(groundPts, x, z, embankStart, embankOuter) -> number`. `groundPts`: array di punti `{x, y?, z}` (in Fase 1 è semplicemente `trackPts`, nessun filtro). Usata da Task 2 (mesh terrapieno), Task 3 (scenografia), Task 4 (quota auto fuori pista).

- [ ] **Step 1: Scrivere i test (falliranno finché la funzione non esiste)**

In `frontend/shared/trackGeometry.test.js`, aggiungere in fondo al file (dopo l'ultimo test esistente):

```js

test('terrainHeightAt restituisce la quota pista entro embankStart', () => {
    const pts = [];
    for (let i = 0; i < 50; i++) pts.push({ x: i * 10, z: 0, y: 12 });
    const y = TrackGeometry.terrainHeightAt(pts, 230, 3, 5, 45);
    assert.equal(y, 12);
});

test('terrainHeightAt restituisce 0 oltre embankOuter', () => {
    const pts = [];
    for (let i = 0; i < 50; i++) pts.push({ x: i * 10, z: 0, y: 12 });
    const y = TrackGeometry.terrainHeightAt(pts, 230, 50, 5, 45);
    assert.equal(y, 0);
});

test('terrainHeightAt sfuma con uno smoothstep tra embankStart e embankOuter', () => {
    const pts = [];
    for (let i = 0; i < 50; i++) pts.push({ x: i * 10, z: 0, y: 12 });
    // A metà tragitto (dist=25, embankStart=5, embankOuter=45) lo smoothstep
    // vale esattamente 0.5 (simmetrico): quota attesa = 12 + (0-12)*0.5 = 6.
    const yHalfway = TrackGeometry.terrainHeightAt(pts, 230, 25, 5, 45);
    assert.ok(Math.abs(yHalfway - 6) < 0.01, `atteso ~6 a metà smoothstep, trovato ${yHalfway}`);
});

test('terrainHeightAt resta a 0 se la pista è già a quota 0 ovunque', () => {
    const pts = [];
    for (let i = 0; i < 50; i++) pts.push({ x: i * 10, z: 0 });
    assert.equal(TrackGeometry.terrainHeightAt(pts, 230, 3, 5, 45), 0);
    assert.equal(TrackGeometry.terrainHeightAt(pts, 230, 25, 5, 45), 0);
});
```

- [ ] **Step 2: Verificare che i nuovi test falliscano**

Run: `node --test frontend/shared/trackGeometry.test.js`
Expected: i 4 nuovi test falliscono con `TrackGeometry.terrainHeightAt is not a function` (i 10 test preesistenti continuano a passare).

- [ ] **Step 3: Implementare `terrainHeightAt`**

In `frontend/shared/trackGeometry.js`, subito dopo la funzione `nearestPoint` (prima del commento `// Giri necessari per coprire...`), aggiungere:

```js

    // Quota "del terreno" in un punto qualunque del mondo: pari alla quota
    // pista se si è entro embankStart dal punto pista più vicino, sfuma a 0
    // (prato in piano) oltre embankOuter con uno smoothstep nel mezzo (stessa
    // curva già usata in evalSegment per la quota lungo il tracciato:
    // pendenza nulla ai due estremi, nessuno spigolo visibile). Fonte di
    // verità unica per "che quota ha il terreno qui", riusata sia per
    // posizionare oggetti scenici sia per la quota visiva dell'auto fuori
    // pista sia per costruire la mesh del terrapieno.
    function terrainHeightAt(groundPts, x, z, embankStart, embankOuter) {
        const { y, dist } = nearestPoint(groundPts, x, z);
        if (dist <= embankStart) return y;
        if (dist >= embankOuter) return 0;
        const t = (dist - embankStart) / (embankOuter - embankStart);
        const te = t * t * (3 - 2 * t);
        return y + (0 - y) * te;
    }
```

Poi, nell'oggetto esportato in fondo al file, aggiungere `terrainHeightAt,`:

```js
    return {
        sampleLoop,
        sampleOpenPath,
        lapLength,
        lapsForDistance,
        nearestIndexNear,
        nearestPoint,
        terrainHeightAt,
        tangentAt,
        normalAt
    };
```

- [ ] **Step 4: Verificare che i test passino**

Run: `node --test frontend/shared/trackGeometry.test.js`
Expected: `# pass 14`, `# fail 0`.

- [ ] **Step 5: Commit (solo su richiesta esplicita dell'utente)**

```bash
git add frontend/shared/trackGeometry.js frontend/shared/trackGeometry.test.js
git commit -m "$(cat <<'EOF'
F1: TrackGeometry.terrainHeightAt — quota del terreno che sfuma verso il prato

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Non eseguire questo step finché l'utente non lo chiede esplicitamente.

---

### Task 2: `TrackMeshBuilder.buildEmbankment` + `buildGround`

**Files:**
- Modify: `frontend/shared/trackMeshBuilder.js`

**Interfaces:**
- Consuma: `TrackGeometry.normalAt` (esistente).
- Produce: `TrackMeshBuilder.buildEmbankment(container, trackPts, embankStart, embankOuter)` — aggiunge alla scena gli anelli concentrici del terrapieno (entrambi i lati della pista). `TrackMeshBuilder.buildGround(container, trackPts, embankOuter, worldSize)` — prato con foro (esterno) + infield. Entrambe usate da Task 4 (`f1.js`).

Le due funzioni si toccano nello stesso task (stesso file, stessa riga di export, nessun test automatico su questo file): separarle lascerebbe uno stato intermedio con un riferimento rotto (`buildGround` nell'export prima di esistere).

- [ ] **Step 1: Aggiungere la costante colore prato condivisa**

In `frontend/shared/trackMeshBuilder.js`, subito dopo la riga `const TrackGeometry = root.TrackGeometry;` (riga 3), aggiungere:

```js

    // Stesso verde del prato esistente (f1.js): usato sia dal terrapieno sia
    // dal prato con foro (buildGround), per continuità visiva senza cuciture
    // di colore tra i due.
    const GRASS_COLOR = 0x3d8b3d;
```

- [ ] **Step 2: Aggiungere `buildEmbankment`**

Subito dopo la funzione `buildPitLane` (prima della riga `root.TrackMeshBuilder = { ... }`), aggiungere:

```js

    // Terrapieno: alcuni anelli concentrici tra embankStart ed embankOuter,
    // quota di ogni anello sfumata dalla quota pista (anello più interno) a 0
    // (anello più esterno) con lo stesso smoothstep di
    // TrackGeometry.terrainHeightAt — qui calcolato direttamente sull'indice
    // e l'anello (non con una ricerca nearestPoint) perché in fase di
    // costruzione si conosce già esattamente la distanza dal centro pista
    // (il raggio dell'anello stesso): più economico, stesso risultato.
    const EMBANKMENT_RING_COUNT = 4;

    function buildEmbankment(container, trackPts, embankStart, embankOuter) {
        const n = trackPts.length;
        const ringCount = EMBANKMENT_RING_COUNT;
        const material = new THREE.MeshStandardMaterial({ color: GRASS_COLOR, roughness: 1, metalness: 0 });

        for (const side of [-1, 1]) {
            const pos = new Float32Array(n * ringCount * 3);

            for (let i = 0; i < n; i++) {
                const { nx, nz } = TrackGeometry.normalAt(trackPts, i, true);
                const p = trackPts[i];
                const baseY = p.y || 0;

                for (let j = 0; j < ringCount; j++) {
                    const t = j / (ringCount - 1);
                    const te = t * t * (3 - 2 * t);
                    const r = embankStart + (embankOuter - embankStart) * t;
                    const y = baseY + (0 - baseY) * te;
                    const vb = (i * ringCount + j) * 3;
                    pos[vb]     = p.x + nx * r * side;
                    pos[vb + 1] = y;
                    pos[vb + 2] = p.z + nz * r * side;
                }
            }

            const idx = [];
            for (let i = 0; i < n; i++) {
                const iNext = (i + 1) % n;
                for (let j = 0; j < ringCount - 1; j++) {
                    const a = i * ringCount + j;
                    const b = i * ringCount + j + 1;
                    const c = iNext * ringCount + j;
                    const d = iNext * ringCount + j + 1;
                    // Stesso winding per lato già usato in buildBarriers (side
                    // specchia x/z tramite la normale, va specchiato anche
                    // l'ordine dei vertici per non invertire le normali).
                    if (side > 0) idx.push(a, c, b, c, d, b);
                    else          idx.push(a, b, c, c, b, d);
                }
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setIndex(idx);
            geo.computeVertexNormals();
            const mesh = new THREE.Mesh(geo, material);
            mesh.receiveShadow = true;
            container.add(mesh);
        }
    }
```

- [ ] **Step 3: Aggiungere le funzioni di supporto e `buildGround`**

Subito dopo la funzione `buildEmbankment` aggiunta al Task 2 (prima della riga `root.TrackMeshBuilder = { ... }`), aggiungere:

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

- [ ] **Step 4: Esportare `buildEmbankment` e `buildGround`**

Sostituire la riga finale del file:

```js
    root.TrackMeshBuilder = { buildRibbon, buildOpenRibbon, buildCurbs, buildBarriers, buildStartLine, buildPitLane };
```

con:

```js
    root.TrackMeshBuilder = { buildRibbon, buildOpenRibbon, buildCurbs, buildBarriers, buildStartLine, buildPitLane, buildEmbankment, buildGround };
```

- [ ] **Step 5: Verificare che il file non abbia errori di sintassi**

Run: `node -c frontend/shared/trackMeshBuilder.js`
Expected: nessun output (exit code 0).

- [ ] **Step 6: Commit (solo su richiesta esplicita dell'utente)**

```bash
git add frontend/shared/trackMeshBuilder.js
git commit -m "$(cat <<'EOF'
F1: mesh del terrapieno (anelli) + prato con foro (esterno+infield)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Non eseguire questo step finché l'utente non lo chiede esplicitamente.

---

### Task 3: Scenografia sul terrapieno (`trackScenery.js`)

**Files:**
- Modify: `frontend/shared/trackScenery.js`
- Test: `frontend/shared/trackScenery.test.js`

**Interfaces:**
- Consuma: `TrackGeometry.terrainHeightAt` (Task 1).
- Modifica la firma pubblica: `generateLayout(trackData, trackPts, pitPts, barrierDist, embankmentWidth = 45)` — il quinto parametro è opzionale con default, le chiamate esistenti (test compresi) restano valide senza modifiche.

- [ ] **Step 1: Scrivere il test che verifica lo sfumato (fallirà finché non implementato)**

In `frontend/shared/trackScenery.test.js`, aggiungere in fondo al file:

```js

test('gli oggetti natura usano la quota del terrapieno (sfuma con la distanza), non la quota pista pura', () => {
    const E = 20;
    const ctrl = [];
    for (let a = 0; a < 360; a += 15) {
        const r = a * Math.PI / 180;
        ctrl.push({ x: 300 * Math.cos(r), z: 300 * Math.sin(r), y: E });
    }
    const hillTrack = { ...monteRosso, id: 'collina-test', controlPoints: ctrl };
    const trackPts = TrackGeometry.sampleLoop(ctrl, 1000);
    const pitPts   = TrackGeometry.sampleOpenPath(monteRosso.pit.path, 300);
    const layout = TrackScenery.generateLayout(hillTrack, trackPts, pitPts, BARRIER_D);
    const nature = layout.filter(i => i.category === 'nature');
    assert.ok(nature.length > 0);
    for (const n of nature) {
        assert.ok(n.y >= -1e-6 && n.y <= E + 1e-6, `quota fuori range atteso [0, ${E}]: ${n.y}`);
    }
    assert.ok(nature.some(n => n.y < E - 0.5), 'atteso che alcuni oggetti abbiano quota sfumata sotto quella pista (terrapieno)');
});
```

- [ ] **Step 2: Verificare che il nuovo test fallisca**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: il nuovo test fallisce (oggi tutti gli oggetti natura hanno `y === E` esatto, senza sfumatura) — i test preesistenti continuano a passare.

- [ ] **Step 3: `generateLayout` — aggiungere `embankmentWidth` e calcolare `embankOuter`**

In `frontend/shared/trackScenery.js`, sostituire:

```js
    function generateLayout(trackData, trackPts, pitPts, barrierDist) {
        const rng = mulberry32(hashString(trackData.id));
        const pitRoadHalf = trackData.pit.roadHalfWidth;
        const side = mainStandSide(trackPts, pitPts);

        const paddock   = buildPaddockLayout(trackPts, pitPts, barrierDist, pitRoadHalf, side);
        const mainStand = buildMainGrandstandLayout(trackPts, barrierDist, side);
        const accepted  = [...paddock, ...mainStand];
        const grandstand = buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted, rng);

        const nature = buildNatureLayout(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted);
        const pond   = findPondSpot(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted);

        const layout = [...paddock, ...mainStand, ...grandstand, ...nature];
        if (pond) layout.push(pond);
        return layout;
    }
```

con:

```js
    // embankmentWidth: ampiezza del terrapieno oltre barrierDist entro cui la
    // quota sfuma a 0 (vedi TrackGeometry.terrainHeightAt) — default 45,
    // stesso valore usato in frontend/f1.js per la mesh del terrapieno
    // stesso: se in futuro si tara diversamente in f1.js, va passato qui
    // esplicitamente per restare coerenti.
    function generateLayout(trackData, trackPts, pitPts, barrierDist, embankmentWidth = 45) {
        const rng = mulberry32(hashString(trackData.id));
        const pitRoadHalf = trackData.pit.roadHalfWidth;
        const side = mainStandSide(trackPts, pitPts);
        const embankOuter = barrierDist + embankmentWidth;

        const paddock   = buildPaddockLayout(trackPts, pitPts, barrierDist, pitRoadHalf, side, embankOuter);
        const mainStand = buildMainGrandstandLayout(trackPts, barrierDist, side, embankOuter);
        const accepted  = [...paddock, ...mainStand];
        const grandstand = buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted, rng, embankOuter);

        const nature = buildNatureLayout(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted, embankOuter);
        const pond   = findPondSpot(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted, embankOuter);

        const layout = [...paddock, ...mainStand, ...grandstand, ...nature];
        if (pond) layout.push(pond);
        return layout;
    }
```

- [ ] **Step 4: `buildPaddockLayout` — quota terrapieno solo per i cartelloni (non per gli edifici box)**

Sostituire:

```js
    function buildPaddockLayout(trackPts, pitPts, barrierDist, pitRoadHalf, mainSide) {
```

con:

```js
    function buildPaddockLayout(trackPts, pitPts, barrierDist, pitRoadHalf, mainSide, embankOuter) {
```

Sostituire:

```js
                const rotY = Math.atan2(p.x - x, p.z - z);
                layout.push({ asset, category: 'paddock', x, y: p.y || 0, z, rotY, scale: KENNEY_MODEL_SCALE });
            }
        }

        let altBuilding = 0;
```

con:

```js
                const rotY = Math.atan2(p.x - x, p.z - z);
                const y = TrackGeometry.terrainHeightAt(trackPts, x, z, barrierDist, embankOuter);
                layout.push({ asset, category: 'paddock', x, y, z, rotY, scale: KENNEY_MODEL_SCALE });
            }
        }

        // Edifici box: quota invariata (p.y || 0, dalla corsia box stessa) —
        // il terrapieno non copre la corsia box, fuori scope (vedi design).
        let altBuilding = 0;
```

- [ ] **Step 5: `buildGrandstandLayout` — quota terrapieno**

Sostituire:

```js
    function buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted, rng) {
```

con:

```js
    function buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted, rng, embankOuter) {
```

Sostituire:

```js
            const { x, z, p } = slotXZ(idx, side);
            const rotY = Math.atan2(p.x - x, p.z - z);
            const asset = STAND_VARIANTS[Math.floor(rng() * STAND_VARIANTS.length)];
            const stand = { asset, category: 'grandstand', x, y: p.y || 0, z, rotY, scale: KENNEY_MODEL_SCALE };
            layout.push(stand);
            accepted.push(stand);
```

con:

```js
            const { x, z, p } = slotXZ(idx, side);
            const rotY = Math.atan2(p.x - x, p.z - z);
            const asset = STAND_VARIANTS[Math.floor(rng() * STAND_VARIANTS.length)];
            const y = TrackGeometry.terrainHeightAt(trackPts, x, z, barrierDist, embankOuter);
            const stand = { asset, category: 'grandstand', x, y, z, rotY, scale: KENNEY_MODEL_SCALE };
            layout.push(stand);
            accepted.push(stand);
```

- [ ] **Step 6: `buildMainGrandstandLayout` — quota terrapieno come base dei livelli**

Sostituire:

```js
    function buildMainGrandstandLayout(trackPts, barrierDist, side) {
```

con:

```js
    function buildMainGrandstandLayout(trackPts, barrierDist, side, embankOuter) {
```

Sostituire:

```js
                const x = p.x + nx * offset * side;
                const z = p.z + nz * offset * side;
                const rotY = Math.atan2(p.x - x, p.z - z);
                layout.push({
                    asset: MAIN_STAND_ASSET, category: 'grandstand-main',
                    x, y: (p.y || 0) + tier * MAIN_STAND_TIER_HEIGHT,
                    z, rotY, scale: KENNEY_MODEL_SCALE
                });
```

con:

```js
                const x = p.x + nx * offset * side;
                const z = p.z + nz * offset * side;
                const rotY = Math.atan2(p.x - x, p.z - z);
                const baseY = TrackGeometry.terrainHeightAt(trackPts, x, z, barrierDist, embankOuter);
                layout.push({
                    asset: MAIN_STAND_ASSET, category: 'grandstand-main',
                    x, y: baseY + tier * MAIN_STAND_TIER_HEIGHT,
                    z, rotY, scale: KENNEY_MODEL_SCALE
                });
```

- [ ] **Step 7: `buildNatureLayout` — quota terrapieno**

Sostituire:

```js
    function buildNatureLayout(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted) {
```

con:

```js
    function buildNatureLayout(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted, embankOuter) {
```

Sostituire:

```js
            const asset = weightedPick(rng, NATURE_ASSETS);
            const point = { asset, category: 'nature', x, y: dTrack.y, z, rotY: rng() * Math.PI * 2, scale: NATURE_SCALE[asset] };
            layout.push(point);
            accepted.push(point);
```

con:

```js
            const asset = weightedPick(rng, NATURE_ASSETS);
            const y = TrackGeometry.terrainHeightAt(trackPts, x, z, barrierDist, embankOuter);
            const point = { asset, category: 'nature', x, y, z, rotY: rng() * Math.PI * 2, scale: NATURE_SCALE[asset] };
            layout.push(point);
            accepted.push(point);
```

- [ ] **Step 8: `findPondSpot` — quota terrapieno**

Sostituire:

```js
    function findPondSpot(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted) {
```

con:

```js
    function findPondSpot(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted, embankOuter) {
```

Sostituire:

```js
            return { category: 'pond', x, y: dTrack.y, z, radius: POND_RADIUS };
```

con:

```js
            const y = TrackGeometry.terrainHeightAt(trackPts, x, z, barrierDist, embankOuter);
            return { category: 'pond', x, y, z, radius: POND_RADIUS };
```

- [ ] **Step 9: Verificare che tutti i test passino**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: tutti i test passano, incluso quello nuovo dello Step 1 (`# fail 0`).

- [ ] **Step 10: Verificare anche `trackGeometry.test.js` (nessuna regressione)**

Run: `node --test frontend/shared/trackGeometry.test.js`
Expected: `# fail 0` (invariato dal Task 1).

- [ ] **Step 11: Commit (solo su richiesta esplicita dell'utente)**

```bash
git add frontend/shared/trackScenery.js frontend/shared/trackScenery.test.js
git commit -m "$(cat <<'EOF'
F1: la scenografia poggia sul terrapieno invece che sulla quota pista pura

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Non eseguire questo step finché l'utente non lo chiede esplicitamente.

---

### Task 4: Integrazione in `f1.js`

**Files:**
- Modify: `frontend/f1.js`

**Interfaces:**
- Consuma: `TrackGeometry.terrainHeightAt` (Task 1), `TrackMeshBuilder.buildEmbankment`/`buildGround` (Task 2), `TrackScenery.generateLayout` invariata nella chiamata esistente (il quinto parametro è opzionale, non serve passarlo qui a meno di voler tarare `EMBANKMENT_WIDTH` diversamente — in questo task si passa esplicitamente per restare coerenti con la mesh).

- [ ] **Step 1: Rimuovere il prato piatto attuale**

In `frontend/f1.js`, rimuovere il blocco (righe 61-70):

```js
    // ====================================================
    // TERRENO ERBOSO (sfondo)
    // ====================================================
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(3000, 3000),
        new THREE.MeshStandardMaterial({ color: 0x3d8b3d, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ====================================================
```

lasciando solo il commento della sezione successiva:

```js
    // ====================================================
```

(cioè: il blocco del prato sparisce, resta un solo `// ===...` seguito da "COSTRUZIONE PISTA 3D...").

- [ ] **Step 2: Aggiungere `EMBANKMENT_WIDTH` e costruire il nuovo terreno dopo aver calcolato `trackPts`**

Sostituire:

```js
    const ROAD_HALF    = trackData.roadHalfWidth;
    const CURB_W       = 2.8;
    const BARRIER_D    = ROAD_HALF + CURB_W + 1.2;
    const PIT_PATH     = trackData.pit.path;

    const N_SAMPLES = 1000;
    const trackPts  = TrackGeometry.sampleLoop(trackData.controlPoints, N_SAMPLES);
```

con:

```js
    const ROAD_HALF    = trackData.roadHalfWidth;
    const CURB_W       = 2.8;
    const BARRIER_D    = ROAD_HALF + CURB_W + 1.2;
    // Ampiezza del terrapieno oltre la barriera, entro cui la quota del
    // terreno sfuma dalla quota pista a 0 (prato in piano) — valore di
    // partenza, da tarare a vista (pendenza troppo ripida/dolce si aggiusta
    // solo qui, non in TrackGeometry.terrainHeightAt/TrackMeshBuilder).
    const EMBANKMENT_WIDTH = 45;
    const PIT_PATH     = trackData.pit.path;

    const N_SAMPLES = 1000;
    const trackPts  = TrackGeometry.sampleLoop(trackData.controlPoints, N_SAMPLES);

    // ====================================================
    // TERRENO ERBOSO — prato con un "buco" a forma di tracciato (esterno) +
    // pezzo pieno per l'infield, riempiti dal terrapieno che sfuma dalla
    // quota pista a 0 man mano che ci si allontana: niente più piano piatto
    // fisso che potesse tagliare la pista nelle discese sotto quota 0 (vedi
    // design 2026-07-22-f1-terrapieno-e-ponti).
    // ====================================================
    TrackMeshBuilder.buildGround(scene, trackPts, BARRIER_D + EMBANKMENT_WIDTH, 3000);
    TrackMeshBuilder.buildEmbankment(scene, trackPts, BARRIER_D, BARRIER_D + EMBANKMENT_WIDTH);
```

- [ ] **Step 3: Passare `EMBANKMENT_WIDTH` a `TrackScenery.generateLayout`**

Sostituire:

```js
    const sceneryLayout = TrackScenery.generateLayout(trackData, trackPts, PIT_PTS, BARRIER_D);
```

con:

```js
    const sceneryLayout = TrackScenery.generateLayout(trackData, trackPts, PIT_PTS, BARRIER_D, EMBANKMENT_WIDTH);
```

- [ ] **Step 4: Quota visiva dell'auto fuori pista segue il terrapieno**

Sostituire, in `animate()`:

```js
                const idx = (target.trackIndex != null)
                    ? target.trackIndex
                    : TrackGeometry.nearestPoint(trackPts, v.x, v.z).index;
                // Il server aggiorna trackIndex solo al proprio tick (20/s): senza
                // ammorbidire quota e beccheggio come già succede per x/z/angle,
                // ogni salto di campione si vede come uno scatto, evidente sui
                // dislivelli e invisibile in piano (dove restano sempre a 0).
                v.y     = (v.y     || 0) + ((trackPts[idx].y || 0) - (v.y || 0))     * LERP;
                v.pitch = (v.pitch || 0) + (trackPitchAt(idx)      - (v.pitch || 0)) * LERP;
```

con:

```js
                const idx = (target.trackIndex != null)
                    ? target.trackIndex
                    : TrackGeometry.nearestPoint(trackPts, v.x, v.z).index;
                // Il server aggiorna trackIndex solo al proprio tick (20/s): senza
                // ammorbidire quota e beccheggio come già succede per x/z/angle,
                // ogni salto di campione si vede come uno scatto, evidente sui
                // dislivelli e invisibile in piano (dove restano sempre a 0).
                // Fuori pista (stessa soglia di applyOffTrackDrag lato server,
                // roadHalf+2) la quota visiva segue il terrapieno alla
                // posizione REALE dell'auto invece di restare agganciata alla
                // quota dell'indice pista — sui tratti sopraelevati altrimenti
                // l'auto resterebbe a "volare" alla quota pista anche ben
                // oltre il bordo.
                const distFromCenter = Math.hypot(v.x - trackPts[idx].x, v.z - trackPts[idx].z);
                const targetY = (distFromCenter > ROAD_HALF + 2)
                    ? TrackGeometry.terrainHeightAt(trackPts, v.x, v.z, BARRIER_D, BARRIER_D + EMBANKMENT_WIDTH)
                    : (trackPts[idx].y || 0);
                v.y     = (v.y     || 0) + (targetY - (v.y || 0)) * LERP;
                v.pitch = (v.pitch || 0) + (trackPitchAt(idx)      - (v.pitch || 0)) * LERP;
```

- [ ] **Step 5: Verificare che il file non abbia errori di sintassi**

Run: `node -c frontend/f1.js`
Expected: nessun output (exit code 0).

- [ ] **Step 6: Verifica manuale in localhost (utente)**

Avviare il server (`node server.js` dalla cartella `backend/`), aprire una lobby con la pista "prova" (che ha già un tratto sopraelevato) e controllare:
- Il prato intorno al tratto sopraelevato sale/scende visibilmente insieme alla pista, senza gradini né tagli, fino a raccordarsi col prato piatto più lontano.
- Alberi/tribune vicino al tratto sopraelevato poggiano sul pendio, non fluttuano più a mezz'aria.
- Uscendo di pista nel tratto sopraelevato, la quota visiva dell'auto segue il pendio invece di restare fissa alla quota pista.
- Nel track editor, modificare un punto di "prova" per farlo scendere sotto quota 0 (una discesa): in gioco, il prato scende con la pista, nessun buco verde.
- Girare un giro intero su "prova" e su almeno un'altra pista piatta (es. "monte-rosso" o "interlagos"): nessun z-fighting/taglio visibile al bordo tra terrapieno e prato piatto esterno, e nessuna regressione sulle piste senza dislivelli (devono apparire come oggi, prato piatto ovunque).
- Controllare anche l'infield (l'interno del giro): deve essere prato pieno, non un buco/vuoto.

Questo step è manuale e non ha un comando da eseguire: è il gate di
approvazione dell'utente prima di considerare il task chiuso.

- [ ] **Step 7: Commit (solo su richiesta esplicita dell'utente)**

```bash
git add frontend/f1.js
git commit -m "$(cat <<'EOF'
F1: il terreno segue il dislivello della pista (terrapieno) invece di un prato piatto fisso

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Non eseguire questo step finché l'utente non lo chiede esplicitamente.
