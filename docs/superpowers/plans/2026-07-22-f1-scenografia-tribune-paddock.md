# F1 — revisione scenografia (tribune, paddock, sponsor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire rocce/cespugli/tenda/folla/pylon/bandiere-a-caso della
scenografia procedurale F1 con: sole natura ad alberi, tribune piccole
variate (senza folla), una tribuna principale a 2 piani × 6 moduli vicino
al rettilineo di partenza, cartelloni sponsor e box paddock veri — tutto
riusando lo stesso Kenney Racing Kit già in parte scaricato nel progetto.

**Architecture:** Nessun nuovo modulo. Si modificano solo
`frontend/shared/trackScenery.js` (generazione layout, pura logica dati) e
`frontend/f1.js` (mappa asset→URL già esistente, `SCENERY_ASSET_PATHS`). Il
meccanismo di rendering (`loadScenery`/`THREE.InstancedMesh` per asset) in
`f1.js` **non cambia**: la tribuna principale a più moduli/livelli è
semplicemente più voci nello stesso array di layout piatto, non un nuovo
concetto per il renderer.

**Tech Stack:** Vanilla JS (IIFE/CommonJS ibrido, nessun bundler),
`node:test` per `trackScenery.test.js`, asset `.glb` Kenney Racing Kit
(CC0, stesso zip di cui il progetto ha già estratto 23 file).

## Global Constraints

- Niente asset esterni al Kenney Racing Kit già usato dal progetto (CC0,
  nessuna nuova licenza da valutare) — vedi spec
  `docs/superpowers/specs/2026-07-22-f1-scenografia-tribune-paddock-design.md`.
- Nessuna modifica al backend/fisica: la scenografia resta puramente
  visiva.
- Nessun editor a zone in questa fase: generazione interamente automatica
  e deterministica dal JSON del tracciato (invariato).
- Non committare/pushare senza richiesta esplicita dell'utente (regola di
  progetto in `CLAUDE.md`) — ogni task sotto include comunque un passo
  "Commit" per lo storico locale del branch di lavoro; se l'esecutore
  lavora direttamente sul checkout dell'utente, chiedere conferma prima
  del primo commit.

---

### Task 1: Sostituire gli asset Kenney sul disco

**Files:**
- Modify (aggiunte/rimozioni file binari): `frontend/assets/kenney/`
- Nessun file di test automatico (operazione sul filesystem) — verifica
  tramite comandi shell.

**Interfaces:**
- Produce: i file `.glb` che il Task 2 referenzierà da
  `SCENERY_ASSET_PATHS` — nomi esatti: `grandStand.glb`,
  `grandStandAwning.glb`, `billboard.glb`, `billboardLow.glb`,
  `pitsGarageClosed.glb`, `pitsOffice.glb` (aggiunti);
  `rock_largeA.glb`, `rock_smallA.glb`, `plant_bush.glb`,
  `plant_bushLarge.glb`, `tent_smallClosed.glb`, `pylon.glb`,
  `flagCheckers.glb`, `character-male-a.glb` (rimossi), più la cartella
  `Textures/` (rimossa, era usata solo da `character-male-a.glb`).

- [ ] **Step 1: Scaricare lo zip ufficiale Kenney Racing Kit**

```bash
curl -sL -o /tmp/kenney_racing-kit.zip "https://kenney.nl/media/pages/assets/racing-kit/933b8fd9fd-1677580949/kenney_racing-kit.zip"
```

Expected: file scaricato, ~6MB. Verifica:

```bash
ls -la /tmp/kenney_racing-kit.zip
```
Expected: dimensione intorno a 6082755 bytes (non deve essere 0 o un errore HTML).

- [ ] **Step 2: Estrarre solo i 6 file nuovi, senza sottocartelle, in `frontend/assets/kenney/`**

```bash
unzip -o -j /tmp/kenney_racing-kit.zip \
  "Models/GLTF format/grandStand.glb" \
  "Models/GLTF format/grandStandAwning.glb" \
  "Models/GLTF format/billboard.glb" \
  "Models/GLTF format/billboardLow.glb" \
  "Models/GLTF format/pitsGarageClosed.glb" \
  "Models/GLTF format/pitsOffice.glb" \
  -d frontend/assets/kenney/
```

Expected output: 6 righe `inflating: frontend/assets/kenney/....glb`.

- [ ] **Step 3: Verificare che i nuovi file non richiedano texture esterne**

```bash
node -e "
const fs = require('fs');
for (const f of ['grandStand','grandStandAwning','billboard','billboardLow','pitsGarageClosed','pitsOffice']) {
  const buf = fs.readFileSync('frontend/assets/kenney/'+f+'.glb');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20+jsonLen).toString('utf8'));
  const externalImages = (json.images||[]).filter(i => i.uri);
  console.log(f, 'immagini esterne:', externalImages.length);
}
"
```

Expected: `immagini esterne: 0` per tutti e 6 (nessuna riga con un numero
diverso da 0 — se compare un `.uri`, il file richiede una texture esterna
da estrarre anche quella e va rivisto prima di proseguire).

- [ ] **Step 4: Rimuovere i file obsoleti**

```bash
rm frontend/assets/kenney/rock_largeA.glb \
   frontend/assets/kenney/rock_smallA.glb \
   frontend/assets/kenney/plant_bush.glb \
   frontend/assets/kenney/plant_bushLarge.glb \
   frontend/assets/kenney/tent_smallClosed.glb \
   frontend/assets/kenney/pylon.glb \
   frontend/assets/kenney/flagCheckers.glb \
   frontend/assets/kenney/character-male-a.glb
rm -rf frontend/assets/kenney/Textures/
```

- [ ] **Step 5: Verificare lo stato finale della cartella**

```bash
ls frontend/assets/kenney/
```

Expected: presenti `grandStand.glb`, `grandStandAwning.glb`,
`grandStandCovered.glb`, `billboard.glb`, `billboardLow.glb`,
`pitsGarageClosed.glb`, `pitsOffice.glb`, `treeLarge.glb`,
`treeSmall.glb`, `grass.glb`, `barrierRed.glb`, `barrierWhite.glb`,
`barrierWall.glb`, `raceCar*.glb`, `road*.glb`. **Assenti**:
`rock_largeA.glb`, `rock_smallA.glb`, `plant_bush.glb`,
`plant_bushLarge.glb`, `tent_smallClosed.glb`, `pylon.glb`,
`flagCheckers.glb`, `character-male-a.glb`, cartella `Textures/`.

- [ ] **Step 6: Commit (solo se l'utente ha confermato di voler committare in questa sessione)**

```bash
git add frontend/assets/kenney/
git commit -m "F1: sostituisci asset scenografia (tribune/sponsor/paddock) nel Racing Kit"
```

---

### Task 2: Aggiornare `SCENERY_ASSET_PATHS` in `frontend/f1.js`

**Files:**
- Modify: `frontend/f1.js:177-189`

**Interfaces:**
- Consumes: i file del Task 1 (deve girare dopo).
- Produces: le chiavi asset che `trackScenery.js` (Task 3-5) userà nel
  layout generato — `treeLarge`, `treeSmall`, `grandStand`,
  `grandStandAwning`, `grandStandCovered`, `billboard`, `billboardLow`,
  `pitsGarageClosed`, `pitsOffice`. Ogni voce del layout con un `asset`
  non presente in questa mappa causerebbe un `url` `undefined` passato a
  `GLTFLoader.load` in `loadScenery` (riga 203) — errore silenzioso in
  console, nessun oggetto visibile. Le chiavi devono combaciare
  esattamente (case-sensitive) con quelle usate in `trackScenery.js`.

- [ ] **Step 1: Sostituire il blocco `SCENERY_ASSET_PATHS`**

Trova in `frontend/f1.js` (righe 177-189):

```javascript
    const SCENERY_ASSET_PATHS = {
        treeLarge:            '/assets/kenney/treeLarge.glb',
        treeSmall:             '/assets/kenney/treeSmall.glb',
        rock_largeA:           '/assets/kenney/rock_largeA.glb',
        rock_smallA:           '/assets/kenney/rock_smallA.glb',
        plant_bush:            '/assets/kenney/plant_bush.glb',
        plant_bushLarge:       '/assets/kenney/plant_bushLarge.glb',
        grandStandCovered:     '/assets/kenney/grandStandCovered.glb',
        'character-male-a':    '/assets/kenney/character-male-a.glb',
        tent_smallClosed:      '/assets/kenney/tent_smallClosed.glb',
        pylon:                 '/assets/kenney/pylon.glb',
        flagCheckers:          '/assets/kenney/flagCheckers.glb',
    };
```

Sostituiscilo con:

```javascript
    const SCENERY_ASSET_PATHS = {
        treeLarge:            '/assets/kenney/treeLarge.glb',
        treeSmall:             '/assets/kenney/treeSmall.glb',
        grandStand:            '/assets/kenney/grandStand.glb',
        grandStandAwning:      '/assets/kenney/grandStandAwning.glb',
        grandStandCovered:     '/assets/kenney/grandStandCovered.glb',
        billboard:             '/assets/kenney/billboard.glb',
        billboardLow:          '/assets/kenney/billboardLow.glb',
        pitsGarageClosed:      '/assets/kenney/pitsGarageClosed.glb',
        pitsOffice:            '/assets/kenney/pitsOffice.glb',
    };
```

- [ ] **Step 2: Controllo sintattico**

```bash
node --check frontend/f1.js
```

Expected: nessun output (exit code 0). `f1.js` non è un modulo
`require`-abile (usa `document.addEventListener` a livello globale), quindi
`node --check` è la sola verifica automatica possibile qui — il resto si
verifica in localhost dopo il Task 5.

- [ ] **Step 3: Verificare che nessun riferimento ai vecchi asset sia rimasto**

```bash
grep -n "rock_largeA\|rock_smallA\|plant_bush\|character-male-a\|tent_smallClosed\|pylon\|flagCheckers" frontend/f1.js
```

Expected: nessun output (nessuna corrispondenza).

- [ ] **Step 4: Commit**

```bash
git add frontend/f1.js
git commit -m "F1: aggiorna mappa asset scenografia per nuove tribune/sponsor/paddock"
```

---

### Task 3: Natura solo alberi + rimozione folla in `trackScenery.js`

**Files:**
- Modify: `frontend/shared/trackScenery.js:69-77` (NATURE_ASSETS),
  `frontend/shared/trackScenery.js:86-92` (costanti tribuna/folla),
  `frontend/shared/trackScenery.js:164-216` (buildGrandstandLayout)
- Test: `frontend/shared/trackScenery.test.js`

**Interfaces:**
- Consumes: nessuna dipendenza da altri task per questa parte pura-dati
  (indipendente da Task 1/2, ma va comunque eseguito prima del Task 5 che
  modifica `generateLayout` nello stesso file).
- Produces: `buildGrandstandLayout(trackPts, pitPts, barrierDist,
  pitRoadHalf, accepted, rng)` — **firma cambiata**: aggiunto il
  parametro `rng` in coda (il Task 5 deve passare `rng` alla chiamata in
  `generateLayout`). Non produce più voci `category: 'crowd'`. Ogni voce
  `category: 'grandstand'` ha `asset` uno tra `'grandStand'`,
  `'grandStandAwning'`, `'grandStandCovered'`.

- [ ] **Step 1: Scrivere il test che deve fallire (nessuna folla, tribune con asset variato, nessuna roccia/cespuglio)**

Sostituisci in `frontend/shared/trackScenery.test.js` il test esistente
`'le tribune sono tra 6 e 10 e ognuna ha 10 personaggi associati'` (righe
58-65) con:

```javascript
test('le tribune sono tra 6 e 10, senza folla, con asset tra le 3 varianti a 1 piano', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const grandstands = layout.filter(i => i.category === 'grandstand');
    const crowd = layout.filter(i => i.category === 'crowd');
    assert.ok(grandstands.length >= 6 && grandstands.length <= 10, `numero tribune fuori range: ${grandstands.length}`);
    assert.equal(crowd.length, 0, 'non deve piu\' esserci folla');
    const validAssets = new Set(['grandStand', 'grandStandAwning', 'grandStandCovered']);
    for (const g of grandstands) {
        assert.ok(validAssets.has(g.asset), `asset tribuna non valido: ${g.asset}`);
    }
});

test('la natura usa solo alberi, mai rocce o cespugli', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const nature = layout.filter(i => i.category === 'nature');
    const validAssets = new Set(['treeLarge', 'treeSmall']);
    for (const n of nature) {
        assert.ok(validAssets.has(n.asset), `asset natura non valido (dovrebbe essere solo albero): ${n.asset}`);
    }
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

```bash
node --test frontend/shared/trackScenery.test.js 2>&1 | grep -A3 "tribune sono tra\|natura usa solo"
```

Expected: entrambi i nuovi test falliscono (`not ok`) — il primo perché
oggi la folla c'è ancora (`crowd.length` sarà `grandstands.length * 10`,
non `0`) e/o l'asset è sempre `grandStandCovered` (che passerebbe comunque
il check `validAssets.has`, quindi il fallimento atteso è sul conteggio
folla); il secondo perché oggi la natura include `rock_largeA` ecc.

- [ ] **Step 3: Aggiornare `NATURE_ASSETS` (righe 69-77)**

Trova:

```javascript
    const NATURE_ASSETS = [
        { asset: 'treeLarge',       weight: 4, scale: KENNEY_MODEL_SCALE },
        { asset: 'treeSmall',       weight: 4, scale: KENNEY_MODEL_SCALE },
        { asset: 'rock_largeA',     weight: 2, scale: KENNEY_MODEL_SCALE },
        { asset: 'rock_smallA',     weight: 2, scale: KENNEY_MODEL_SCALE },
        { asset: 'plant_bush',      weight: 3, scale: KENNEY_MODEL_SCALE },
        { asset: 'plant_bushLarge', weight: 2, scale: KENNEY_MODEL_SCALE },
    ];
```

Sostituisci con:

```javascript
    const NATURE_ASSETS = [
        { asset: 'treeLarge', weight: 1, scale: KENNEY_MODEL_SCALE },
        { asset: 'treeSmall', weight: 1, scale: KENNEY_MODEL_SCALE },
    ];
```

- [ ] **Step 4: Rimuovere le costanti folla e aggiungere le varianti tribuna (righe 86-92)**

Trova:

```javascript
    const GRANDSTAND_OFFSET_MARGIN = 6;  // oltre barrierDist
    const GRANDSTAND_PIT_MARGIN    = 20; // oltre pitRoadHalf: evita di piazzare tribune sopra la corsia box
    // CROWD_COL_SPACING deve superare la larghezza reale del personaggio a
    // scala KENNEY_MODEL_SCALE (raw x≈0.767 × 6 ≈ 4.6 unità), altrimenti le
    // figure si compenetrano fianco a fianco — ricalcolata ad ogni cambio
    // di KENNEY_MODEL_SCALE (3.2 andava bene solo a scala 3.5).
    const CROWD_ROWS = 2, CROWD_COLS = 5, CROWD_COL_SPACING = 5.5, CROWD_ROW_DEPTH = 1.5, CROWD_FRONT_OFFSET = 2.0;
```

Sostituisci con:

```javascript
    const GRANDSTAND_OFFSET_MARGIN = 6;  // oltre barrierDist
    const GRANDSTAND_PIT_MARGIN    = 20; // oltre pitRoadHalf: evita di piazzare tribune sopra la corsia box
    // Le 3 varianti a 1 piano: grandStandCoveredRound/grandStandRound sono
    // escluse a priori (footprint circolare 1.64x1.64 contro 1.00x1.00 delle
    // altre — non affiancabili a un bordo dritto, verificato con un render di
    // confronto durante il brainstorming).
    const STAND_VARIANTS = ['grandStand', 'grandStandAwning', 'grandStandCovered'];
```

- [ ] **Step 5: Aggiornare `buildGrandstandLayout` (righe 164-216) — firma + rimozione folla**

Trova l'intera funzione:

```javascript
    function buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted) {
        const layout = [];
        const lapLen = TrackGeometry.lapLength(trackPts);
        const count = Math.max(6, Math.min(10, Math.round(lapLen / 220)));
        const n = trackPts.length;
        const step = n / count;
        const searchWindow = Math.max(10, Math.floor(n / (count * 2)));

        function slotXZ(idx, side) {
            const p = trackPts[idx];
            const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
            const offset = barrierDist + GRANDSTAND_OFFSET_MARGIN;
            return { x: p.x + nx * offset * side, z: p.z + nz * offset * side, p };
        }

        function slotValid(idx, side) {
            const { x, z } = slotXZ(idx, side);
            if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitRoadHalf + GRANDSTAND_PIT_MARGIN) return false;
            if (isTooCloseToAny(accepted, x, z, STRUCTURE_CLEARANCE)) return false;
            return true;
        }

        for (let k = 0; k < count; k++) {
            const baseIdx = Math.floor(k * step) % n;
            const side = (k % 2 === 0) ? 1 : -1;
            let idx = -1;
            if (slotValid(baseIdx, side)) idx = baseIdx;
            for (let d = 1; idx < 0 && d <= searchWindow; d++) {
                if (slotValid((baseIdx + d) % n, side)) idx = (baseIdx + d) % n;
                else if (slotValid((baseIdx - d + n) % n, side)) idx = (baseIdx - d + n) % n;
            }
            if (idx < 0) continue;

            const { x, z, p } = slotXZ(idx, side);
            const rotY = Math.atan2(p.x - x, p.z - z);
            const stand = { asset: 'grandStandCovered', category: 'grandstand', x, y: p.y || 0, z, rotY, scale: KENNEY_MODEL_SCALE };
            layout.push(stand);
            accepted.push(stand);

            for (let row = 0; row < CROWD_ROWS; row++) {
                for (let col = 0; col < CROWD_COLS; col++) {
                    const lx = (col - (CROWD_COLS - 1) / 2) * CROWD_COL_SPACING;
                    const lz = CROWD_FRONT_OFFSET + row * CROWD_ROW_DEPTH;
                    const off = rotateY(lx, lz, rotY);
                    layout.push({
                        asset: 'character-male-a', category: 'crowd',
                        x: x + off.x, y: p.y || 0, z: z + off.z, rotY, scale: KENNEY_MODEL_SCALE
                    });
                }
            }
        }
        return layout;
    }
```

Sostituiscila con:

```javascript
    function buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted, rng) {
        const layout = [];
        const lapLen = TrackGeometry.lapLength(trackPts);
        const count = Math.max(6, Math.min(10, Math.round(lapLen / 220)));
        const n = trackPts.length;
        const step = n / count;
        const searchWindow = Math.max(10, Math.floor(n / (count * 2)));

        function slotXZ(idx, side) {
            const p = trackPts[idx];
            const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
            const offset = barrierDist + GRANDSTAND_OFFSET_MARGIN;
            return { x: p.x + nx * offset * side, z: p.z + nz * offset * side, p };
        }

        function slotValid(idx, side) {
            const { x, z } = slotXZ(idx, side);
            if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitRoadHalf + GRANDSTAND_PIT_MARGIN) return false;
            if (isTooCloseToAny(accepted, x, z, STRUCTURE_CLEARANCE)) return false;
            return true;
        }

        for (let k = 0; k < count; k++) {
            const baseIdx = Math.floor(k * step) % n;
            const side = (k % 2 === 0) ? 1 : -1;
            let idx = -1;
            if (slotValid(baseIdx, side)) idx = baseIdx;
            for (let d = 1; idx < 0 && d <= searchWindow; d++) {
                if (slotValid((baseIdx + d) % n, side)) idx = (baseIdx + d) % n;
                else if (slotValid((baseIdx - d + n) % n, side)) idx = (baseIdx - d + n) % n;
            }
            if (idx < 0) continue;

            const { x, z, p } = slotXZ(idx, side);
            const rotY = Math.atan2(p.x - x, p.z - z);
            const asset = STAND_VARIANTS[Math.floor(rng() * STAND_VARIANTS.length)];
            const stand = { asset, category: 'grandstand', x, y: p.y || 0, z, rotY, scale: KENNEY_MODEL_SCALE };
            layout.push(stand);
            accepted.push(stand);
        }
        return layout;
    }
```

- [ ] **Step 6: Aggiornare la chiamata a `buildGrandstandLayout` in `generateLayout` per passare `rng`**

Nella stessa funzione `generateLayout` (verrà toccata di nuovo nel Task 5,
ma questo passaggio serve già ora perché la nuova firma lo richiede),
trova:

```javascript
        const grandstand = buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted);
```

Sostituisci con:

```javascript
        const grandstand = buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted, rng);
```

- [ ] **Step 7: Eseguire i test e verificare che passino tutti**

```bash
node --test frontend/shared/trackScenery.test.js
```

Expected: `# fail 0`, `# tests 8` (7 test originali, con quello sulla
folla/tribune sostituito da una versione aggiornata, + 1 nuovo test sulla
natura-solo-alberi = 8 totali).

- [ ] **Step 8: Commit**

```bash
git add frontend/shared/trackScenery.js frontend/shared/trackScenery.test.js
git commit -m "F1: natura solo alberi, tribune senza folla con 3 varianti a 1 piano"
```

---

### Task 4: Cartelloni sponsor e box paddock in `buildPaddockLayout`

**Files:**
- Modify: `frontend/shared/trackScenery.js:94-98` (costanti paddock),
  `frontend/shared/trackScenery.js:113-155` (buildPaddockLayout)
- Test: `frontend/shared/trackScenery.test.js`

**Interfaces:**
- Consumes: nessuna dipendenza da Task 3 (stesso file ma sezioni diverse;
  eseguibile anche prima, l'ordine 3→4→5 è solo per chiarezza narrativa).
- Produces: `buildPaddockLayout` non cambia firma. Le voci
  `category: 'paddock'` hanno ora `asset` uno tra `'billboard'`,
  `'billboardLow'` (rettilineo di partenza) o `'pitsGarageClosed'`,
  `'pitsOffice'` (corsia box) — mai più `'pylon'`, `'flagCheckers'`,
  `'tent_smallClosed'`.

- [ ] **Step 1: Scrivere il test che deve fallire**

Aggiungi a `frontend/shared/trackScenery.test.js`:

```javascript
test('il paddock usa cartelloni sponsor e box, mai pylon/bandiere/tenda', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const paddock = layout.filter(i => i.category === 'paddock');
    assert.ok(paddock.length > 0);
    const validAssets = new Set(['billboard', 'billboardLow', 'pitsGarageClosed', 'pitsOffice']);
    for (const p of paddock) {
        assert.ok(validAssets.has(p.asset), `asset paddock non valido: ${p.asset}`);
    }
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

```bash
node --test frontend/shared/trackScenery.test.js 2>&1 | grep -A5 "paddock usa cartelloni"
```

Expected: `not ok` — oggi il paddock produce `pylon`/`flagCheckers`/`tent_smallClosed`.

- [ ] **Step 3: Aggiornare le costanti (righe 94-98)**

Trova:

```javascript
    const START_WINDOW_LEN       = 60;  // lunghezza d'arco totale intorno alla partenza
    const START_SPACING          = 12;
    const PADDOCK_MARGIN         = 5;   // oltre barrierDist, per pylon/bandiere partenza
    const PIT_TENT_OFFSET_MARGIN = 6;   // oltre pitRoadHalf
    const PIT_TENT_STEP_SAMPLES  = 25;
```

Sostituisci con:

```javascript
    const START_WINDOW_LEN           = 60;  // lunghezza d'arco totale intorno alla partenza
    const START_SPACING              = 12;
    const PADDOCK_MARGIN             = 5;   // oltre barrierDist, per i cartelloni sponsor partenza
    const PIT_BUILDING_OFFSET_MARGIN = 6;   // oltre pitRoadHalf
    const PIT_BUILDING_STEP_SAMPLES  = 25;
```

- [ ] **Step 4: Aggiornare `buildPaddockLayout` (righe 113-155)**

Trova:

```javascript
    function buildPaddockLayout(trackPts, pitPts, barrierDist, pitRoadHalf) {
        const layout = [];
        const n = trackPts.length;
        const stepLen = TrackGeometry.lapLength(trackPts) / n;
        const halfWindowSamples = Math.max(1, Math.round((START_WINDOW_LEN / 2) / stepLen));
        const spacingSamples    = Math.max(1, Math.round(START_SPACING / stepLen));

        let alt = 0;
        for (let d = -halfWindowSamples; d <= halfWindowSamples; d += spacingSamples) {
            const idx = ((d % n) + n) % n;
            const p = trackPts[idx];
            const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
            const asset = (alt % 2 === 0) ? 'pylon' : 'flagCheckers';
            alt++;
            for (const side of [-1, 1]) {
                const offset = barrierDist + PADDOCK_MARGIN;
                const x = p.x + nx * offset * side, z = p.z + nz * offset * side;
                const rotY = Math.atan2(p.x - x, p.z - z);
                layout.push({ asset, category: 'paddock', x, y: p.y || 0, z, rotY, scale: KENNEY_MODEL_SCALE });
            }
        }

        for (let idx = 10; idx < pitPts.length - 10; idx += PIT_TENT_STEP_SAMPLES) {
            const p = pitPts[idx];
            const { nx, nz } = TrackGeometry.normalAt(pitPts, idx, false);
            // Lato "verso l'esterno" del tracciato principale: tra le due
            // direzioni normali, si sceglie quella che allontana di più dal
            // centro del circuito, generico per qualunque forma di corsia box.
            const distPlus  = TrackGeometry.nearestPoint(trackPts, p.x + nx, p.z + nz).dist;
            const distMinus = TrackGeometry.nearestPoint(trackPts, p.x - nx, p.z - nz).dist;
            const side = distPlus >= distMinus ? 1 : -1;
            const offset = pitRoadHalf + PIT_TENT_OFFSET_MARGIN;
            const x = p.x + nx * offset * side, z = p.z + nz * offset * side;
            const rotY = Math.atan2(p.x - x, p.z - z);
            layout.push({ asset: 'tent_smallClosed', category: 'paddock', x, y: p.y || 0, z, rotY, scale: KENNEY_MODEL_SCALE });
        }

        return layout;
    }
```

Sostituiscila con:

```javascript
    function buildPaddockLayout(trackPts, pitPts, barrierDist, pitRoadHalf) {
        const layout = [];
        const n = trackPts.length;
        const stepLen = TrackGeometry.lapLength(trackPts) / n;
        const halfWindowSamples = Math.max(1, Math.round((START_WINDOW_LEN / 2) / stepLen));
        const spacingSamples    = Math.max(1, Math.round(START_SPACING / stepLen));

        let alt = 0;
        for (let d = -halfWindowSamples; d <= halfWindowSamples; d += spacingSamples) {
            const idx = ((d % n) + n) % n;
            const p = trackPts[idx];
            const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
            const asset = (alt % 2 === 0) ? 'billboard' : 'billboardLow';
            alt++;
            for (const side of [-1, 1]) {
                const offset = barrierDist + PADDOCK_MARGIN;
                const x = p.x + nx * offset * side, z = p.z + nz * offset * side;
                const rotY = Math.atan2(p.x - x, p.z - z);
                layout.push({ asset, category: 'paddock', x, y: p.y || 0, z, rotY, scale: KENNEY_MODEL_SCALE });
            }
        }

        let altBuilding = 0;
        for (let idx = 10; idx < pitPts.length - 10; idx += PIT_BUILDING_STEP_SAMPLES) {
            const p = pitPts[idx];
            const { nx, nz } = TrackGeometry.normalAt(pitPts, idx, false);
            // Lato "verso l'esterno" del tracciato principale: tra le due
            // direzioni normali, si sceglie quella che allontana di più dal
            // centro del circuito, generico per qualunque forma di corsia box.
            const distPlus  = TrackGeometry.nearestPoint(trackPts, p.x + nx, p.z + nz).dist;
            const distMinus = TrackGeometry.nearestPoint(trackPts, p.x - nx, p.z - nz).dist;
            const side = distPlus >= distMinus ? 1 : -1;
            const offset = pitRoadHalf + PIT_BUILDING_OFFSET_MARGIN;
            const x = p.x + nx * offset * side, z = p.z + nz * offset * side;
            const rotY = Math.atan2(p.x - x, p.z - z);
            const asset = (altBuilding % 2 === 0) ? 'pitsGarageClosed' : 'pitsOffice';
            altBuilding++;
            layout.push({ asset, category: 'paddock', x, y: p.y || 0, z, rotY, scale: KENNEY_MODEL_SCALE });
        }

        return layout;
    }
```

- [ ] **Step 5: Eseguire i test e verificare che passino tutti**

```bash
node --test frontend/shared/trackScenery.test.js
```

Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/trackScenery.js frontend/shared/trackScenery.test.js
git commit -m "F1: cartelloni sponsor e box paddock veri al posto di pylon/bandiere/tenda"
```

---

### Task 5: Tribuna principale (2 piani × 6 moduli) al rettilineo di partenza

**Files:**
- Modify: `frontend/shared/trackScenery.js` — aggiungere costanti e
  funzione `buildMainGrandstandLayout` (nuovo blocco, subito dopo
  `buildGrandstandLayout`), aggiornare `generateLayout` (righe 281-295 nel
  file originale, spostate dai task precedenti — cercare per nome
  funzione, non per numero di riga).
- Test: `frontend/shared/trackScenery.test.js`

**Interfaces:**
- Consumes: `rotateY(lx, lz, theta)` (helper già esistente nel file, usata
  in precedenza per il posizionamento della folla — stesso pattern
  riusato qui per allineare i moduli lungo la tangente del tracciato).
  `TrackGeometry.normalAt`, `TrackGeometry.nearestPoint` (già importati).
- Produces: `buildMainGrandstandLayout(trackPts, pitPts, barrierDist,
  pitRoadHalf)` → array di 12 voci (`MAIN_STAND_COLS × MAIN_STAND_TIERS`)
  con `category: 'grandstand-main'`, `asset: 'grandStand'`. Il Task 5
  stesso la collega a `generateLayout` (nessun altro task dipende da
  questa funzione).

- [ ] **Step 1: Scrivere il test che deve fallire**

Aggiungi a `frontend/shared/trackScenery.test.js`:

```javascript
test('la tribuna principale è unica, 12 moduli (6x2), vicino alla partenza', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const main = layout.filter(i => i.category === 'grandstand-main');
    assert.equal(main.length, 12, `attesi 12 moduli tribuna principale, trovati ${main.length}`);
    for (const m of main) {
        assert.equal(m.asset, 'grandStand');
        const d = TrackGeometry.nearestPoint(trackPts, m.x, m.z).dist;
        assert.ok(d >= BARRIER_D, `modulo tribuna principale dentro il corridoio pista: ${d}`);
    }
    // Due quote y distinte (2 livelli), stessa quota all'interno di ogni livello
    const levels = new Set(main.map(m => m.y.toFixed(3)));
    assert.equal(levels.size, 2, `attesi 2 livelli distinti di quota, trovati ${levels.size}`);
});

test('la tribuna principale non si sovrappone alle tribune normali', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const main = layout.filter(i => i.category === 'grandstand-main');
    const normal = layout.filter(i => i.category === 'grandstand');
    for (const m of main) {
        for (const g of normal) {
            const d = Math.hypot(m.x - g.x, m.z - g.z);
            assert.ok(d >= 10, `tribuna principale troppo vicina a una tribuna normale: ${d}`);
        }
    }
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

```bash
node --test frontend/shared/trackScenery.test.js 2>&1 | grep -A5 "tribuna principale"
```

Expected: entrambi `not ok` (categoria `'grandstand-main'` non esiste
ancora, `main.length` sarebbe `0`).

- [ ] **Step 3: Aggiungere le costanti della tribuna principale**

Subito dopo la riga con `const STAND_VARIANTS = [...]` (aggiunta nel Task
3), aggiungi:

```javascript
    // Tribuna principale: unica per tracciato, vicino al rettilineo di
    // partenza. 'grandStand' (base, senza tettoia sporgente) impilata su 2
    // livelli: verificato con un render di confronto a scala reale che
    // 'grandStandAwning' impilata romperebbe la tribuna sopra (il telo della
    // tettoia sporge oltre il modulo), mentre 'grandStand'/'grandStandCovered'
    // (tetto piatto o assente) si impilano senza artefatti — qui si usa la
    // variante senza tetto per restare leggera.
    const MAIN_STAND_ASSET         = 'grandStand';
    const MAIN_STAND_COLS          = 6;
    const MAIN_STAND_TIERS         = 2;
    // Dimensioni reali del modulo a KENNEY_MODEL_SCALE, misurate dal
    // bounding box del file .glb (il modulo trackScenery non ha accesso alla
    // mesh, solo f1.js la carica): raw x=1.00 y=0.90 z=1.00 → a scala 6,
    // 6 unità di passo tra moduli affiancati, 5.4 unità per livello.
    const MAIN_STAND_COL_SPACING   = 6.0;
    const MAIN_STAND_TIER_HEIGHT   = 5.4;
    const MAIN_STAND_OFFSET_MARGIN = 6; // stesso margine della tribuna normale
```

- [ ] **Step 4: Aggiungere la funzione `buildMainGrandstandLayout`**

Subito dopo la chiusura di `buildGrandstandLayout` (aggiornata nel Task
3), aggiungi:

```javascript
    // Tribuna principale: 6 moduli affiancati x 2 livelli impilati, una
    // sola volta vicino a trackPts[0] (stesso punto di riferimento di
    // buildStartLine/buildPaddockLayout), sul lato più lontano dalla corsia
    // box (stesso criterio già usato per le tende/box in buildPaddockLayout).
    function buildMainGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf) {
        const layout = [];
        const p = trackPts[0];
        const { nx, nz } = TrackGeometry.normalAt(trackPts, 0, true);
        const distPlus  = TrackGeometry.nearestPoint(pitPts, p.x + nx, p.z + nz).dist;
        const distMinus = TrackGeometry.nearestPoint(pitPts, p.x - nx, p.z - nz).dist;
        const side = distPlus >= distMinus ? 1 : -1;

        const offset = barrierDist + MAIN_STAND_OFFSET_MARGIN;
        const baseX = p.x + nx * offset * side;
        const baseZ = p.z + nz * offset * side;
        const rotY = Math.atan2(p.x - baseX, p.z - baseZ);

        for (let tier = 0; tier < MAIN_STAND_TIERS; tier++) {
            for (let col = 0; col < MAIN_STAND_COLS; col++) {
                const lx = (col - (MAIN_STAND_COLS - 1) / 2) * MAIN_STAND_COL_SPACING;
                const off = rotateY(lx, 0, rotY);
                layout.push({
                    asset: MAIN_STAND_ASSET, category: 'grandstand-main',
                    x: baseX + off.x, y: (p.y || 0) + tier * MAIN_STAND_TIER_HEIGHT,
                    z: baseZ + off.z, rotY, scale: KENNEY_MODEL_SCALE
                });
            }
        }
        return layout;
    }
```

- [ ] **Step 5: Collegare `buildMainGrandstandLayout` in `generateLayout`**

Trova (già con la modifica del Task 3 al passaggio di `rng`):

```javascript
    function generateLayout(trackData, trackPts, pitPts, barrierDist) {
        const rng = mulberry32(hashString(trackData.id));
        const pitRoadHalf = trackData.pit.roadHalfWidth;

        const paddock  = buildPaddockLayout(trackPts, pitPts, barrierDist, pitRoadHalf);
        const accepted = [...paddock];
        const grandstand = buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted, rng);

        const nature = buildNatureLayout(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted);
        const pond   = findPondSpot(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted);

        const layout = [...paddock, ...grandstand, ...nature];
        if (pond) layout.push(pond);
        return layout;
    }
```

Sostituisci con:

```javascript
    function generateLayout(trackData, trackPts, pitPts, barrierDist) {
        const rng = mulberry32(hashString(trackData.id));
        const pitRoadHalf = trackData.pit.roadHalfWidth;

        const paddock   = buildPaddockLayout(trackPts, pitPts, barrierDist, pitRoadHalf);
        const mainStand = buildMainGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf);
        const accepted  = [...paddock, ...mainStand];
        const grandstand = buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted, rng);

        const nature = buildNatureLayout(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted);
        const pond   = findPondSpot(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted);

        const layout = [...paddock, ...mainStand, ...grandstand, ...nature];
        if (pond) layout.push(pond);
        return layout;
    }
```

- [ ] **Step 6: Eseguire l'intera suite e verificare che tutti i test passino**

```bash
node --test frontend/shared/trackScenery.test.js
```

Expected: `# fail 0`, `# tests 11` (8 dopo il Task 3 + 1 aggiunto nel
Task 4 + 2 aggiunti qui = 11 totali).

- [ ] **Step 7: Commit**

```bash
git add frontend/shared/trackScenery.js frontend/shared/trackScenery.test.js
git commit -m "F1: tribuna principale 2 piani x 6 moduli al rettilineo di partenza"
```

---

### Task 6: Verifica manuale in localhost su tutti i tracciati

**Files:** nessuno (verifica, non implementazione).

**Interfaces:**
- Consumes: tutti i task precedenti (1-5) devono essere completi.

- [ ] **Step 1: Avviare il server**

```bash
cd backend && node server.js
```

Expected: log di avvio senza errori, server in ascolto su `localhost:3000`.
(Questo comando lo esegue l'utente in una sessione separata, per policy
di progetto — non lanciarlo autonomamente se non richiesto esplicitamente.)

- [ ] **Step 2: Aprire una lobby F1 con due tab, per ciascuno dei tre tracciati (`monte-rosso`, `monza`, `interlagos`)**

Checklist visiva da confermare con l'utente per ciascun tracciato:
- Solo alberi come natura (nessuna roccia, nessun cespuglio).
- Tribune piccole visibilmente variate (non tutte identiche) lungo il
  giro, nessuna forma circolare/rotonda.
- Una tribuna principale ben visibile vicino al rettilineo di partenza, 6
  moduli in fila su 2 livelli, nessun modulo fluttuante o compenetrato.
- Cartelloni pubblicitari al posto di pylon/bandiere a scacchi.
- Edifici box/ufficio (non tende) lungo la corsia box.
- Nessuna figura umana (folla) da nessuna parte.
- Il laghetto, se presente, resta invariato rispetto a prima.
- Ricaricando la pagina sullo stesso tracciato, la disposizione resta
  identica (determinismo).

- [ ] **Step 3: Riportare eventuali problemi visivi prima di considerare la feature completa**

Nessun passo automatico oltre questo: la verifica finale è dell'utente in
localhost, come da convenzione di progetto.

---

## Riepilogo copertura spec

- Natura solo alberi → Task 3.
- Laghetto invariato → nessun task (nessuna modifica).
- Folla rimossa → Task 3.
- Tribune piccole variate (3 asset, no circolari) → Task 3.
- Tribuna principale 2 piani × 6 moduli → Task 5.
- Cartelloni sponsor → Task 4.
- Box paddock veri → Task 4.
- Asset rimossi da disco/codice → Task 1, Task 2.
- Verifica manuale localhost → Task 6.
