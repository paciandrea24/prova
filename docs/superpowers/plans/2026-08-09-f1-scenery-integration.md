# Integrazione scenografia voxel F1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare in partita i 25 asset voxel custom: sostituire i 7 Kenney ancora usati, ritarare le costanti di piazzamento sulle dimensioni reali, e distribuire sul tracciato le 12 categorie nuove più gli spettatori.

**Architettura:** `trackScenery.js` resta il punto d'ingresso (`generateLayout`) e conserva le categorie attuali; le nuove vanno in tre moduli separati per criterio di piazzamento — `sceneryLandmarks.js` (elementi unici su punti notevoli), `sceneryTrackside.js` (distribuiti per curvatura), `sceneryCrowd.js` (spettatori, posizionati relativamente alle tribune). Tutti emettono voci nello stesso formato di layout già consumato da `loadScenery`, che non cambia.

**Tech Stack:** JS vanilla in stile UMD (stesso pattern degli altri moduli in `frontend/shared/`), test con `node --test` nativo (nessuna dipendenza npm: il repo non ha `node_modules`).

## Global Constraints

- **Spec di riferimento:** `docs/superpowers/specs/2026-08-09-f1-scenery-integration-design.md`. Misure degli asset e convenzioni: `docs/f1-notes.md`, sezione "Asset voxel del circuito".
- **Gli asset NON si toccano.** Sono approvati dall'utente. Se una misura non torna, si adegua la costante di piazzamento, mai il modello.
- **Scala:** gli asset custom si istanziano con `scale: 1` (sono modellati in unità di gioco). `KENNEY_MODEL_SCALE = 6` resta, ma serve solo a `treeLarge`/`treeSmall`, che restano Kenney per scelta dell'utente.
- **Formato delle voci di layout**, invariato: `{ asset, category, x, y, z, rotY, scale }`. La quota `y` viene sempre da `TrackGeometry.terrainHeightAt(groundPts, x, z, barrierDist, embankOuter)` tranne per gli oggetti lungo la corsia box, che usano `p.y || 0` (il terrapieno non copre la corsia).
- **Orientamento:** `rotY = Math.atan2(p.x - x, p.z - z)` fa guardare l'oggetto verso il punto `p` della pista. Tutti gli asset custom hanno il fronte su +Z locale.
- **Vincoli di esclusione** già esistenti, da rispettare per ogni nuova categoria: fuori dalla corsia box (`TrackGeometry.nearestPoint(pitPts, x, z).dist`), fuori dagli ingombri dei box giocatore (`insidePlayerBoxFootprint`), a distanza dalle altre strutture (`isTooCloseToAny`).
- **Moduli UMD:** ogni file in `frontend/shared/` segue il wrapper `(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(require(...)); else root.X = factory(root.Y); })(...)`.
- **Cache-busting obbligatorio:** ogni modifica a un `.js` richiede il bump di `?v=` in `frontend/f1.html`, altrimenti il browser serve il file vecchio e sembra che il lavoro non abbia avuto effetto.
- **Commenti in italiano.**
- **Niente commit**: li fa l'utente a mano (`CLAUDE.md`).
- **Gate utente in localhost dopo ogni fase**, prima di passare alla successiva.

---

## File Structure

**Creati:**
- `frontend/shared/sceneryLandmarks.js` — `buildLandmarks()`: torre di direzione, ponte semafori, podio, passerella. Un solo esemplare per tracciato, ancorati a `trackPts[0]`.
- `frontend/shared/sceneryTrackside.js` — `buildTrackside()`: rilevamento curve + gomme, cartelli di frenata, commissari, reti, barriere di cemento, pylon/bandiere/tende del paddock.
- `frontend/shared/sceneryCrowd.js` — `buildCrowd()`: spettatori sulle tribune già piazzate.
- `frontend/shared/sceneryLandmarks.test.js`, `sceneryTrackside.test.js`, `sceneryCrowd.test.js`.

**Modificati:**
- `frontend/shared/trackGeometry.js` — nuova `curvatureAt()`, esportata.
- `frontend/shared/trackScenery.js` — costanti ritarate, `scale: 1`, chiamata ai tre moduli nuovi.
- `frontend/shared/trackGeometry.test.js`, `trackScenery.test.js` — test nuovi.
- `frontend/f1.js` — `SCENERY_ASSET_PATHS`, fetch di `grandStandSeats.json`.
- `frontend/f1.html` — cache-busting.

---

### Task 1 (FASE 1): Sostituzione dei 7 Kenney e ritaratura delle costanti

Nessun elemento nuovo: cambiano solo i modelli e i numeri. È la fase che isola il rischio della ritaratura, e va verificata in localhost prima di aggiungere qualsiasi cosa.

**Files:**
- Modify: `frontend/f1.js` (`SCENERY_ASSET_PATHS`, ~riga 314)
- Modify: `frontend/shared/trackScenery.js` (costanti + `scale` nelle voci di layout)
- Modify: `frontend/shared/trackScenery.test.js`
- Modify: `frontend/f1.html`

**Interfaces:**
- Produces: nessuna nuova funzione pubblica. `generateLayout` mantiene la firma attuale `(trackData, trackPts, pitPts, barrierDist, embankmentWidth = 45)`.

- [ ] **Step 1: Scrivere i test di non-sovrapposizione, che devono fallire con le costanti attuali**

In `frontend/shared/trackScenery.test.js`. Il primo test è quello che dimostra il problema: con `MAIN_STAND_COL_SPACING = 6` e moduli larghi 19.2, i moduli della tribuna principale si compenetrano.

```js
const CUSTOM_SIZES = {
    grandStand: { w: 19.2, d: 12.8 },
    billboard: { w: 16.4, d: 1.6 },
    billboardLow: { w: 16.4, d: 1.4 },
    pitsGarageClosed: { w: 20.6, d: 14.7 },
    pitsOffice: { w: 20.7, d: 14.9 },
};

// Distanza minima ammessa fra i centri di due oggetti affiancati: se sono
// più vicini della semisomma delle larghezze, i modelli si compenetrano.
function minCenterDistance(a, b) {
    return (CUSTOM_SIZES[a].w + CUSTOM_SIZES[b].w) / 2;
}

test('i moduli della tribuna principale non si compenetrano fra loro', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const main = layout.filter(i => i.category === 'grandstand-main');
    assert.ok(main.length > 0, 'nessuna tribuna principale generata');

    // Confronta solo i moduli dello stesso livello: quelli impilati
    // condividono x/z per costruzione e differiscono solo in altezza.
    const byTier = new Map();
    for (const m of main) {
        const tier = Math.round(m.y * 100);
        if (!byTier.has(tier)) byTier.set(tier, []);
        byTier.get(tier).push(m);
    }
    for (const [, mods] of byTier) {
        for (let i = 0; i < mods.length; i++) {
            for (let j = i + 1; j < mods.length; j++) {
                const d = Math.hypot(mods[i].x - mods[j].x, mods[i].z - mods[j].z);
                assert.ok(d >= minCenterDistance('grandStand', 'grandStand') - 0.5,
                    `moduli a ${d.toFixed(2)}, minimo ${minCenterDistance('grandStand', 'grandStand')}`);
            }
        }
    }
});

test('i cartelloni sponsor consecutivi non si compenetrano', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const boards = layout.filter(i => i.asset === 'billboard' || i.asset === 'billboardLow');
    for (let i = 0; i < boards.length; i++) {
        for (let j = i + 1; j < boards.length; j++) {
            const d = Math.hypot(boards[i].x - boards[j].x, boards[i].z - boards[j].z);
            assert.ok(d >= minCenterDistance(boards[i].asset, boards[j].asset) - 0.5,
                `cartelloni a ${d.toFixed(2)}`);
        }
    }
});

test('gli asset custom sono istanziati a scala 1, gli alberi Kenney a 6', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    for (const item of layout) {
        if (item.category === 'pond') continue;
        if (item.asset === 'treeLarge' || item.asset === 'treeSmall') {
            assert.equal(item.scale, 6, `${item.asset} deve restare a scala Kenney`);
        } else {
            assert.equal(item.scale, 1, `${item.asset} è custom, deve stare a scala 1`);
        }
    }
});
```

- [ ] **Step 2: Eseguire i test — devono fallire**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: FAIL su "i moduli della tribuna principale non si compenetrano" (distanza 6 contro un minimo di 19.2) e su "gli asset custom sono istanziati a scala 1" (oggi tutti a 6).

- [ ] **Step 3: Ritarare le costanti in `trackScenery.js`**

Sostituire i valori esistenti. Ogni cambio va commentato con la misura reale che lo giustifica, nello stile del file (che documenta sempre il perché di un numero).

```js
const GRANDSTAND_OFFSET_MARGIN = 10; // era 6: la tribuna nuova è profonda 12.8, mezza profondità 6.4
const GRANDSTAND_PIT_MARGIN    = 24; // era 20: mezza diagonale della tribuna nuova
const STAND_VARIANTS = ['grandStand', 'grandStandAwning', 'grandStandCovered'];

const MAIN_STAND_ASSET         = 'grandStand';
const MAIN_STAND_COLS          = 3;    // era 6: a 6 la tribuna sarebbe lunga 115 unità
const MAIN_STAND_TIERS         = 2;
const MAIN_STAND_COL_SPACING   = 19.4; // era 6.0: larghezza reale 19.2 + gap
const MAIN_STAND_TIER_HEIGHT   = 12.3; // era 5.4: altezza reale del modulo
const MAIN_STAND_OFFSET_MARGIN = 14;   // era 10: mezza profondità 6.4 + ingombro cartelloni

const START_WINDOW_LEN           = 60;
const START_SPACING              = 20; // era 12: i cartelloni sono larghi 16.4
const PADDOCK_MARGIN             = 5;
const PIT_BUILDING_OFFSET_MARGIN = 10; // era 6: il garage è profondo 14.7
const PIT_BUILDING_STEP_LEN      = 24; // era PIT_BUILDING_STEP_SAMPLES=25 (in campioni)
const PADDOCK_PIT_CLEARANCE      = 5;  // era 4
const STRUCTURE_CLEARANCE        = 22; // era 18: strutture più grandi
```

- [ ] **Step 4: Convertire il passo degli edifici box da campioni a unità**

`PIT_BUILDING_STEP_SAMPLES` era un passo in indici di campionamento: dipende da quanto è lunga la corsia box e non garantisce alcuna distanza reale fra edifici larghi 20.6. In `buildPaddockLayout`, sostituire il ciclo:

```js
        // Passo in UNITÀ, non in campioni: la corsia box ha lunghezze molto
        // diverse da un tracciato all'altro, quindi un passo in indici non
        // garantisce distanza reale fra edifici larghi 20.6.
        const pitStepLen = TrackGeometry.lapLength(pitPts) / pitPts.length;
        const buildingStep = Math.max(1, Math.round(PIT_BUILDING_STEP_LEN / pitStepLen));
        let altBuilding = 0;
        for (let idx = 10; idx < pitPts.length - 10; idx += buildingStep) {
```

Nota: `lapLength` su un percorso aperto come `pitPts` chiude il giro fra ultimo e primo punto, quindi sovrastima la lunghezza. Va bene come stima del passo medio fra campioni consecutivi, che è ciò che serve qui.

- [ ] **Step 5: Emettere `scale: 1` per gli asset custom**

In `buildPaddockLayout`, `buildGrandstandLayout` e `buildMainGrandstandLayout` sostituire `scale: KENNEY_MODEL_SCALE` con `scale: 1`. In `buildNatureLayout` **non cambiare nulla**: usa `NATURE_SCALE[asset]`, che resta 6 per gli alberi.

Aggiornare il commento in testa a `KENNEY_MODEL_SCALE`, che oggi dice che vale per tutti gli asset del file:

```js
    // Scala degli asset Kenney ANCORA in uso in questo file: dal 2026-08-09
    // solo gli alberi (treeLarge/treeSmall), che l'utente ha scelto di
    // tenere. Tutto il resto è passato ai modelli voxel custom di
    // frontend/assets/custom/circuit/, modellati 1:1 in unità di gioco e
    // quindi istanziati con scale 1.
    const KENNEY_MODEL_SCALE = 6;
```

- [ ] **Step 6: Aggiornare i path in `frontend/f1.js`**

```js
    const SCENERY_ASSET_PATHS = {
        // Alberi: unici Kenney rimasti, per scelta esplicita dell'utente.
        treeLarge: '/assets/kenney/treeLarge.glb',
        treeSmall: '/assets/kenney/treeSmall.glb',
        // Catalogo voxel custom (vedi docs/f1-notes.md): scala 1:1, niente
        // moltiplicatore all'istanza.
        grandStand: '/assets/custom/circuit/grandStand.glb',
        grandStandAwning: '/assets/custom/circuit/grandStandAwning.glb',
        grandStandCovered: '/assets/custom/circuit/grandStandCovered.glb',
        billboard: '/assets/custom/circuit/billboard.glb',
        billboardLow: '/assets/custom/circuit/billboardLow.glb',
        pitsGarageClosed: '/assets/custom/circuit/pitsGarageClosed.glb',
        pitsOffice: '/assets/custom/circuit/pitsOffice.glb',
    };
```

- [ ] **Step 7: Eseguire i test — devono passare**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: PASS su tutti i test, inclusi i tre nuovi e quelli preesistenti di determinismo.

- [ ] **Step 8: Bump del cache-busting**

In `frontend/f1.html`: `trackScenery.js?v=20260809b` e `f1.js?v=20260809a`.

- [ ] **Step 9: Gate utente in localhost**

Chiedere all'utente di avviare `node server.js` da `backend/` e guardare un tracciato. Da verificare: tribune e cartelloni non si compenetrano, la tribuna principale è a 3 moduli su 2 livelli, gli edifici lungo la corsia box sono distanziati, gli alberi non sono cambiati di dimensione. Non proseguire senza approvazione.

---

### Task 2 (FASE 2): Landmark — torre, ponte semafori, podio, passerella

**Files:**
- Create: `frontend/shared/sceneryLandmarks.js`
- Create: `frontend/shared/sceneryLandmarks.test.js`
- Modify: `frontend/shared/trackScenery.js` (chiamata + export del lato principale)
- Modify: `frontend/f1.js` (`SCENERY_ASSET_PATHS`), `frontend/f1.html`

**Interfaces:**
- Consumes: `TrackGeometry.normalAt(points, i, closed) -> {nx, nz}`, `TrackGeometry.terrainHeightAt(groundPts, x, z, embankStart, embankOuter) -> number`, `TrackGeometry.lapLength(points) -> number`, `TrackGeometry.nearestPoint(points, x, z) -> {x, z, y, dist, idx}`.
- Produces: `SceneryLandmarks.buildLandmarks(trackPts, pitPts, barrierDist, mainSide, embankOuter, playerBoxFootprints, insidePlayerBoxFootprint) -> Array<layoutItem>` e le costanti `GANTRY_NATIVE_HALF_SPAN = 13.5`, `FOOTBRIDGE_NATIVE_HALF_SPAN = 14`.

- [ ] **Step 1: Scrivere il test della scala di scavalcamento — è il vincolo che è facile sbagliare**

In `frontend/shared/sceneryLandmarks.test.js`.

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const TrackGeometry = require('./trackGeometry.js');
const SceneryLandmarks = require('./sceneryLandmarks.js');
const monteRosso = require('../tracks/monte-rosso.json');

const ROAD_HALF = monteRosso.roadHalfWidth;
const BARRIER_D = ROAD_HALF + 2.8 + 1.2;

function build() {
    const trackPts = TrackGeometry.sampleLoop(monteRosso.controlPoints, 1000);
    const pitPts = TrackGeometry.sampleOpenPath(monteRosso.pit.path, 300);
    return SceneryLandmarks.buildLandmarks(trackPts, pitPts, BARRIER_D, 1,
        BARRIER_D + 45, [], () => false);
}

// Il vincolo vero non è "scavalcare la pista" ma "scavalcare la BARRIERA":
// dimensionando sulla sola larghezza pista i piloni finiscono dentro le
// barriere su tutti i tracciati esistenti.
test('il ponte semafori scavalca la barriera, non solo la pista', () => {
    const gantry = build().find(i => i.asset === 'startGantry');
    assert.ok(gantry, 'nessun startGantry nel layout');
    const halfSpan = SceneryLandmarks.GANTRY_NATIVE_HALF_SPAN * gantry.scale;
    assert.ok(halfSpan > BARRIER_D, `luce ${halfSpan.toFixed(1)} contro barriera a ${BARRIER_D}`);
});

test('la passerella scavalca la barriera', () => {
    const fb = build().find(i => i.asset === 'footbridge');
    assert.ok(fb, 'nessuna footbridge nel layout');
    const halfSpan = SceneryLandmarks.FOOTBRIDGE_NATIVE_HALF_SPAN * fb.scale;
    assert.ok(halfSpan > BARRIER_D, `luce ${halfSpan.toFixed(1)} contro barriera a ${BARRIER_D}`);
});

test('ponte semafori e passerella non sono nello stesso punto del giro', () => {
    const items = build();
    const g = items.find(i => i.asset === 'startGantry');
    const f = items.find(i => i.asset === 'footbridge');
    assert.ok(Math.hypot(g.x - f.x, g.z - f.z) > 100, 'gantry e passerella troppo vicini');
});

test('si genera esattamente un esemplare di ogni landmark', () => {
    const items = build();
    for (const asset of ['raceControlTower', 'startGantry', 'podium', 'footbridge']) {
        assert.equal(items.filter(i => i.asset === asset).length, 1, `${asset} non unico`);
    }
});
```

- [ ] **Step 2: Eseguire il test — deve fallire**

Run: `node --test frontend/shared/sceneryLandmarks.test.js`
Expected: FAIL con `Cannot find module './sceneryLandmarks.js'`.

- [ ] **Step 3: Implementare `sceneryLandmarks.js`**

```js
// frontend/shared/sceneryLandmarks.js
//
// Elementi scenici UNICI per tracciato, ancorati a punti notevoli: torre di
// direzione gara, ponte semafori, podio, passerella pedonale. A differenza
// di sceneryTrackside.js (che distribuisce oggetti lungo tutto il giro),
// qui ogni asset compare una volta sola e la sua posizione è quasi
// obbligata dal ruolo che ha.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./trackGeometry.js'));
    else root.SceneryLandmarks = factory(root.TrackGeometry);
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry) {

    // Semiluce interna dei due asset che scavalcano la pista, misurata sui
    // .glb: il gantry ha i piloni a ±15 larghi 3 (filo interno 13.5), la
    // passerella le torri a ±16 larghe 4 (filo interno 14).
    const GANTRY_NATIVE_HALF_SPAN = 13.5;
    const FOOTBRIDGE_NATIVE_HALF_SPAN = 14;
    // Margine fra il filo interno del pilone e la barriera. Il vincolo è
    // scavalcare la BARRIERA, non la pista: dimensionando sulla sola
    // larghezza della carreggiata i piloni finirebbero dentro le barriere su
    // tutti i tracciati esistenti.
    const SPAN_CLEARANCE = 1.5;

    const TOWER_OFFSET_MARGIN = 20;   // oltre barrierDist
    const PODIUM_OFFSET_MARGIN = 30;  // oltre barrierDist, dietro la fila dei box

    function spanScale(barrierDist, nativeHalfSpan) {
        return Math.max(1, (barrierDist + SPAN_CLEARANCE) / nativeHalfSpan);
    }

    // Punto a distanza `offset` dal centro pista sul lato `side`, con la
    // rotazione che fa guardare l'oggetto verso la pista.
    function placeBeside(trackPts, idx, offset, side, groundPts, barrierDist, embankOuter) {
        const p = trackPts[idx];
        const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
        const x = p.x + nx * offset * side;
        const z = p.z + nz * offset * side;
        return {
            x, z,
            rotY: Math.atan2(p.x - x, p.z - z),
            y: TrackGeometry.terrainHeightAt(groundPts, x, z, barrierDist, embankOuter),
        };
    }

    function buildLandmarks(trackPts, pitPts, barrierDist, mainSide, embankOuter,
                            playerBoxFootprints, insidePlayerBoxFootprint) {
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const n = trackPts.length;

        // Torre di direzione: sul lato OPPOSTO alla tribuna principale, così
        // le due strutture alte non si accavallano viste dal rettilineo.
        const tower = placeBeside(trackPts, 0, barrierDist + TOWER_OFFSET_MARGIN,
                                  -mainSide, groundPts, barrierDist, embankOuter);
        layout.push({ asset: 'raceControlTower', category: 'landmark', ...tower, scale: 1 });

        // Ponte semafori: a cavallo della pista sulla griglia. Centrato sul
        // centro pista, non spostato di lato.
        const p0 = trackPts[0];
        const t0 = TrackGeometry.tangentAt(trackPts, 0, true);
        layout.push({
            asset: 'startGantry', category: 'landmark',
            x: p0.x, z: p0.z,
            y: TrackGeometry.terrainHeightAt(groundPts, p0.x, p0.z, barrierDist, embankOuter),
            // Il ponte è modellato con la campata lungo X e il fronte su +Z:
            // per attraversare la pista deve essere perpendicolare alla
            // tangente, quindi si allinea alla tangente stessa.
            rotY: Math.atan2(t0.tx, t0.tz),
            scale: spanScale(barrierDist, GANTRY_NATIVE_HALF_SPAN),
        });

        // Passerella: a mezzo giro dal gantry, per non duplicare la stessa
        // silhouette nello stesso tratto.
        const fbIdx = Math.floor(n / 2);
        const pf = trackPts[fbIdx];
        const tf = TrackGeometry.tangentAt(trackPts, fbIdx, true);
        layout.push({
            asset: 'footbridge', category: 'landmark',
            x: pf.x, z: pf.z,
            y: TrackGeometry.terrainHeightAt(groundPts, pf.x, pf.z, barrierDist, embankOuter),
            rotY: Math.atan2(tf.tx, tf.tz),
            scale: spanScale(barrierDist, FOOTBRIDGE_NATIVE_HALF_SPAN),
        });

        // Podio: nel paddock, lato corsia box, arretrato oltre la fila dei
        // box giocatore. Si cerca il primo indice utile scorrendo il giro,
        // per non finire dentro l'ingombro di un box.
        for (let d = 0; d < n; d += 5) {
            const cand = placeBeside(trackPts, d % n, barrierDist + PODIUM_OFFSET_MARGIN,
                                     -mainSide, groundPts, barrierDist, embankOuter);
            if (insidePlayerBoxFootprint(cand.x, cand.z, playerBoxFootprints)) continue;
            if (TrackGeometry.nearestPoint(pitPts, cand.x, cand.z).dist < 12) continue;
            layout.push({ asset: 'podium', category: 'landmark', ...cand, scale: 1 });
            break;
        }

        return layout;
    }

    return { buildLandmarks, GANTRY_NATIVE_HALF_SPAN, FOOTBRIDGE_NATIVE_HALF_SPAN };
});
```

- [ ] **Step 4: Eseguire il test — deve passare**

Run: `node --test frontend/shared/sceneryLandmarks.test.js`
Expected: PASS su tutti e 4 i test.

- [ ] **Step 5: Agganciare i landmark in `trackScenery.js`**

Dentro `generateLayout`, dopo il calcolo di `playerBoxFootprints` e prima del `return`:

```js
        const landmarks = SceneryLandmarks.buildLandmarks(
            trackPts, pitPts, barrierDist, side, embankOuter,
            playerBoxFootprints, insidePlayerBoxFootprint);
```

e aggiungere `...landmarks` all'array `layout` finale. Aggiungere la dipendenza nel wrapper UMD in testa al file:

```js
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'), require('./sceneryLandmarks.js'));
    } else {
        root.TrackScenery = factory(root.TrackGeometry, root.SceneryLandmarks);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, SceneryLandmarks) {
```

- [ ] **Step 6: Aggiungere i path dei 4 landmark in `f1.js`**

```js
        raceControlTower: '/assets/custom/circuit/raceControlTower.glb',
        startGantry: '/assets/custom/circuit/startGantry.glb',
        podium: '/assets/custom/circuit/podium.glb',
        footbridge: '/assets/custom/circuit/footbridge.glb',
```

- [ ] **Step 7: Eseguire tutti i test di scenografia**

Run: `node --test frontend/shared/trackScenery.test.js frontend/shared/sceneryLandmarks.test.js`
Expected: PASS. In particolare i test di determinismo preesistenti devono restare verdi: i landmark sono deterministici (nessun PRNG).

- [ ] **Step 8: Bump cache-busting e gate utente**

`f1.html`: aggiungere `<script src="shared/sceneryLandmarks.js?v=20260809a"></script>` **prima** di `trackScenery.js` (che ora ne dipende), e bumpare `trackScenery.js` e `f1.js`. Poi far verificare in localhost: il ponte semafori scavalca davvero la pista con i piloni fuori dalle barriere, la torre non compenetra la tribuna principale, il podio non è dentro i box.

---

### Task 3 (FASE 3a): `curvatureAt` in TrackGeometry

Il rilevamento delle curve è il prerequisito di tutta la Fase 3 e vive nel modulo condiviso, non nei moduli di scenografia: è geometria del tracciato, come `tangentAt` e `normalAt`.

**Files:**
- Modify: `frontend/shared/trackGeometry.js`
- Modify: `frontend/shared/trackGeometry.test.js`

**Interfaces:**
- Produces: `TrackGeometry.curvatureAt(points, i, sampleSpan = 12) -> { radius, turnSigned }`. `radius` in unità (`Infinity` sui rettilinei), `turnSigned` è l'angolo con segno fra le tangenti (positivo = curva in un verso, negativo = nell'altro).

- [ ] **Step 1: Scrivere i test con geometrie note**

In `frontend/shared/trackGeometry.test.js`. Un cerchio di raggio noto è il caso in cui la risposta giusta si conosce in anticipo.

```js
test('curvatureAt su un cerchio di raggio 100 misura raggio ≈ 100', () => {
    const pts = [];
    const R = 100;
    for (let i = 0; i < 400; i++) {
        const a = (i / 400) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, y: 0 });
    }
    const { radius } = TrackGeometry.curvatureAt(pts, 0);
    assert.ok(Math.abs(radius - R) < R * 0.1, `raggio ${radius}, atteso ~${R}`);
});

test('curvatureAt su una retta ritorna raggio Infinity', () => {
    const pts = [];
    for (let i = 0; i < 200; i++) pts.push({ x: i * 2, z: 0, y: 0 });
    const { radius } = TrackGeometry.curvatureAt(pts, 100);
    assert.equal(radius, Infinity);
});

test('curvatureAt distingue il verso della curva col segno di turnSigned', () => {
    const R = 80;
    const cw = [], ccw = [];
    for (let i = 0; i < 400; i++) {
        const a = (i / 400) * Math.PI * 2;
        ccw.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, y: 0 });
        cw.push({ x: Math.cos(-a) * R, z: Math.sin(-a) * R, y: 0 });
    }
    const s1 = TrackGeometry.curvatureAt(ccw, 10).turnSigned;
    const s2 = TrackGeometry.curvatureAt(cw, 10).turnSigned;
    assert.ok(s1 * s2 < 0, `segni non opposti: ${s1} e ${s2}`);
});

test('curvatureAt riconosce le curve di un tracciato reale', () => {
    const pts = TrackGeometry.sampleLoop(monteRosso.controlPoints, 1000);
    const radii = pts.map((_, i) => TrackGeometry.curvatureAt(pts, i).radius);
    const curve = radii.filter(r => r < 120).length;
    assert.ok(curve > 50, `solo ${curve} punti in curva su ${pts.length}`);
    assert.ok(curve < pts.length * 0.9, 'quasi tutto il tracciato risulta in curva');
});
```

- [ ] **Step 2: Eseguire i test — devono fallire**

Run: `node --test frontend/shared/trackGeometry.test.js`
Expected: FAIL con `TrackGeometry.curvatureAt is not a function`.

- [ ] **Step 3: Implementare `curvatureAt`**

Da inserire in `trackGeometry.js` subito dopo `normalAt`, e aggiungere `curvatureAt` all'oggetto esportato in fondo al file.

```js
    // Raggio di curvatura del tracciato al punto i, in unità, e verso della
    // curva. Si confrontano le tangenti a `sampleSpan` campioni prima e dopo:
    // l'angolo fra le due diviso per la lunghezza d'arco percorsa dà la
    // curvatura, il cui reciproco è il raggio. Su un rettilineo l'angolo è
    // zero e il raggio Infinity.
    //
    // Un campione singolo sarebbe dominato dal rumore del campionamento
    // Catmull-Rom, per questo si guarda una finestra: 12 campioni su 1000
    // per giro sono ~1% del tracciato, abbastanza da mediare il rumore senza
    // spalmare una curva stretta su tutto il suo intorno.
    function curvatureAt(points, i, sampleSpan = 12) {
        const n = points.length;
        const a = points[((i - sampleSpan) % n + n) % n];
        const b = points[i];
        const c = points[(i + sampleSpan) % n];

        const h1 = Math.atan2(b.z - a.z, b.x - a.x);
        const h2 = Math.atan2(c.z - b.z, c.x - b.x);
        let turnSigned = h2 - h1;
        while (turnSigned > Math.PI) turnSigned -= Math.PI * 2;
        while (turnSigned < -Math.PI) turnSigned += Math.PI * 2;

        const arc = Math.hypot(b.x - a.x, b.z - a.z) + Math.hypot(c.x - b.x, c.z - b.z);
        if (Math.abs(turnSigned) < 1e-6 || arc === 0) return { radius: Infinity, turnSigned: 0 };
        return { radius: arc / Math.abs(turnSigned), turnSigned };
    }
```

- [ ] **Step 4: Eseguire i test — devono passare**

Run: `node --test frontend/shared/trackGeometry.test.js`
Expected: PASS su tutti, inclusi i preesistenti.

---

### Task 4 (FASE 3b): `sceneryTrackside.js` — elementi distribuiti

**Files:**
- Create: `frontend/shared/sceneryTrackside.js`
- Create: `frontend/shared/sceneryTrackside.test.js`
- Modify: `frontend/shared/trackScenery.js`, `frontend/f1.js`, `frontend/f1.html`

**Interfaces:**
- Consumes: `TrackGeometry.curvatureAt(points, i, sampleSpan) -> {radius, turnSigned}` (Task 3), `TrackGeometry.walkClosedLoop(points, startIndex, distance) -> {x, z, fromIdx, toIdx}`, `TrackGeometry.normalAt`, `TrackGeometry.terrainHeightAt`, `TrackGeometry.lapLength`, `TrackGeometry.nearestPoint`.
- Produces: `SceneryTrackside.buildTrackside(ctx) -> Array<layoutItem>` dove `ctx = { trackPts, pitPts, barrierDist, pitRoadHalf, embankOuter, mainSide, rng, playerBoxFootprints, insidePlayerBoxFootprint, grandstands }`; e `SceneryTrackside.findCorners(trackPts) -> Array<{ startIdx, endIdx, midIdx, side, radius }>` (esportata per poterla testare da sola).

**Attenzione a due dettagli dell'API esistente**, entrambi facili da sbagliare:
`TrackGeometry.nearestPoint` ritorna `{ x, y, z, index, dist }` — il campo è
**`index`**, non `idx`. E `pitRoadHalf` (semilarghezza della corsia box) va
passato dal chiamante, che lo legge da `trackData.pit.roadHalfWidth`: NON si
può ricavare misurando la distanza fra un punto della pista e la corsia, che
è tutt'altra cosa.

- [ ] **Step 1: Scrivere i test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const TrackGeometry = require('./trackGeometry.js');
const SceneryTrackside = require('./sceneryTrackside.js');
const monteRosso = require('../tracks/monte-rosso.json');

const BARRIER_D = monteRosso.roadHalfWidth + 2.8 + 1.2;

function ctx() {
    const trackPts = TrackGeometry.sampleLoop(monteRosso.controlPoints, 1000);
    const pitPts = TrackGeometry.sampleOpenPath(monteRosso.pit.path, 300);
    let a = 12345;
    const rng = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    return {
        trackPts, pitPts, barrierDist: BARRIER_D, embankOuter: BARRIER_D + 45,
        pitRoadHalf: monteRosso.pit.roadHalfWidth,
        mainSide: 1, rng, playerBoxFootprints: [],
        insidePlayerBoxFootprint: () => false, grandstands: [],
    };
}

test('findCorners trova curve separate e non tutto il tracciato', () => {
    const c = ctx();
    const corners = SceneryTrackside.findCorners(c.trackPts);
    assert.ok(corners.length >= 2, `trovate solo ${corners.length} curve`);
    assert.ok(corners.length < 20, `${corners.length} curve: soglia troppo permissiva`);
    for (const k of corners) {
        assert.ok(k.side === 1 || k.side === -1, 'lato esterno non determinato');
    }
});

test('le barriere di pneumatici stanno fuori dalla barriera e mai in corsia box', () => {
    const c = ctx();
    const items = SceneryTrackside.buildTrackside(c);
    const tyres = items.filter(i => i.asset === 'tyreStack');
    assert.ok(tyres.length > 0, 'nessuna barriera di gomme generata');
    for (const t of tyres) {
        const dTrack = TrackGeometry.nearestPoint(c.trackPts, t.x, t.z).dist;
        assert.ok(dTrack >= BARRIER_D, `gomme a ${dTrack.toFixed(1)} dal centro pista`);
        const dPit = TrackGeometry.nearestPoint(c.pitPts, t.x, t.z).dist;
        assert.ok(dPit > monteRosso.pit.roadHalfWidth, 'gomme dentro la corsia box');
    }
});

test('ogni curva riceve al massimo due cartelli di frenata', () => {
    const c = ctx();
    const corners = SceneryTrackside.findCorners(c.trackPts);
    const boards = SceneryTrackside.buildTrackside(c).filter(i => i.asset === 'brakingBoard');
    assert.ok(boards.length <= corners.length * 2, `${boards.length} cartelli per ${corners.length} curve`);
    assert.ok(boards.length > 0, 'nessun cartello generato');
});

test('buildTrackside è deterministico a parità di rng', () => {
    const a = JSON.stringify(SceneryTrackside.buildTrackside(ctx()));
    const b = JSON.stringify(SceneryTrackside.buildTrackside(ctx()));
    assert.equal(a, b);
});

test('tutte le voci hanno scala 1 e una categoria', () => {
    for (const item of SceneryTrackside.buildTrackside(ctx())) {
        assert.equal(item.scale, 1);
        assert.ok(typeof item.category === 'string' && item.category.length > 0);
    }
});
```

- [ ] **Step 2: Eseguire — deve fallire**

Run: `node --test frontend/shared/sceneryTrackside.test.js`
Expected: FAIL con `Cannot find module './sceneryTrackside.js'`.

- [ ] **Step 3: Implementare `findCorners`**

Prima parte di `sceneryTrackside.js`: il rilevamento curve, che è la base di tutto il resto.

```js
// frontend/shared/sceneryTrackside.js
//
// Elementi scenici DISTRIBUITI lungo il giro in funzione della forma del
// tracciato: barriere di pneumatici e cartelli di frenata nelle curve,
// commissari, reti davanti alle tribune, barriere di cemento all'uscita box,
// decoro del paddock. A differenza di sceneryLandmarks.js, qui il numero di
// istanze dipende da quante curve ha il tracciato.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./trackGeometry.js'));
    else root.SceneryTrackside = factory(root.TrackGeometry);
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry) {

    // Soglia sotto la quale un punto è considerato "in curva". 120 unità
    // (~94 m) su una pista larga 22: i rettilinei di raccordo restano fuori,
    // i tornanti e le curve medie entrano.
    const CORNER_RADIUS_MAX = 120;
    // Due curve separate da meno di questo si fondono: senza, una parabolica
    // leggermente irregolare si spezza in tre curve e riceve tre volte gli
    // stessi oggetti.
    const CORNER_MERGE_GAP = 40;
    // Sotto questa lunghezza d'arco è un'increspatura del campionamento, non
    // una curva.
    const CORNER_MIN_LEN = 25;

    function findCorners(trackPts) {
        const n = trackPts.length;
        const stepLen = TrackGeometry.lapLength(trackPts) / n;
        const inCorner = [];
        const turns = [];
        for (let i = 0; i < n; i++) {
            const { radius, turnSigned } = TrackGeometry.curvatureAt(trackPts, i);
            inCorner.push(radius < CORNER_RADIUS_MAX);
            turns.push(turnSigned);
        }

        // Runs di punti consecutivi in curva, sul giro chiuso.
        let start = -1;
        for (let i = 0; i < n; i++) {
            if (!inCorner[i] && inCorner[(i + 1) % n]) { start = (i + 1) % n; break; }
        }
        if (start < 0) return [];   // tracciato interamente curvo o interamente dritto

        const runs = [];
        let cur = null;
        for (let s = 0; s < n; s++) {
            const i = (start + s) % n;
            if (inCorner[i]) {
                if (!cur) cur = { startIdx: i, endIdx: i, turnSum: 0 };
                cur.endIdx = i;
                cur.turnSum += turns[i];
            } else if (cur) {
                runs.push(cur);
                cur = null;
            }
        }
        if (cur) runs.push(cur);

        // Fusione dei run vicini.
        const gapSamples = Math.round(CORNER_MERGE_GAP / stepLen);
        const merged = [];
        for (const r of runs) {
            const last = merged[merged.length - 1];
            if (last && ((r.startIdx - last.endIdx + n) % n) <= gapSamples) {
                last.endIdx = r.endIdx;
                last.turnSum += r.turnSum;
            } else {
                merged.push({ ...r });
            }
        }

        const minSamples = Math.round(CORNER_MIN_LEN / stepLen);
        return merged
            .filter(r => ((r.endIdx - r.startIdx + n) % n) >= minSamples)
            .map(r => {
                const len = (r.endIdx - r.startIdx + n) % n;
                const midIdx = (r.startIdx + Math.floor(len / 2)) % n;
                const { radius } = TrackGeometry.curvatureAt(trackPts, midIdx);
                // Il lato ESTERNO della curva è opposto al verso di sterzata.
                // normalAt ritorna (-tz, tx): con turnSum positivo la pista
                // gira verso quella normale, quindi l'esterno è dall'altra parte.
                return { startIdx: r.startIdx, endIdx: r.endIdx, midIdx, radius,
                         side: r.turnSum > 0 ? -1 : 1 };
            });
    }
```

- [ ] **Step 4: Implementare `buildTrackside`**

Seconda parte dello stesso file, prima del `return`.

```js
    const TYRE_STEP = 7;            // passo di affiancamento del modello
    const TYRE_MARGIN = 2.5;        // oltre barrierDist
    const BOARD_DISTANCES = [100, 50];
    const BOARD_MARGIN = 4;
    const MARSHAL_MARGIN = 8;
    const FENCE_STEP = 12;
    const FENCE_MARGIN = 3;
    const PADDOCK_DECOR_MARGIN = 14;

    function place(trackPts, groundPts, idx, offset, side, barrierDist, embankOuter) {
        const p = trackPts[idx];
        const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
        const x = p.x + nx * offset * side;
        const z = p.z + nz * offset * side;
        return {
            x, z,
            rotY: Math.atan2(p.x - x, p.z - z),
            y: TrackGeometry.terrainHeightAt(groundPts, x, z, barrierDist, embankOuter),
        };
    }

    function buildTrackside(ctx) {
        const { trackPts, pitPts, barrierDist, pitRoadHalf, embankOuter,
                playerBoxFootprints, insidePlayerBoxFootprint, grandstands } = ctx;
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const n = trackPts.length;
        const stepLen = TrackGeometry.lapLength(trackPts) / n;

        // Scarta un punto se cade nella corsia box o sopra un box giocatore.
        function usable(x, z, pitClearance) {
            if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitClearance) return false;
            return !insidePlayerBoxFootprint(x, z, playerBoxFootprints);
        }

        const corners = findCorners(trackPts);

        for (const corner of corners) {
            // Barriera di pneumatici lungo tutto l'arco esterno della curva.
            const arcSamples = (corner.endIdx - corner.startIdx + n) % n;
            const stepSamples = Math.max(1, Math.round(TYRE_STEP / stepLen));
            for (let s = 0; s <= arcSamples; s += stepSamples) {
                const idx = (corner.startIdx + s) % n;
                const pos = place(trackPts, groundPts, idx, barrierDist + TYRE_MARGIN,
                                  corner.side, barrierDist, embankOuter);
                if (!usable(pos.x, pos.z, pitRoadHalf + 6)) continue;
                layout.push({ asset: 'tyreStack', category: 'safety', ...pos, scale: 1 });
            }

            // Commissario all'ingresso curva.
            const marshal = place(trackPts, groundPts, corner.startIdx,
                                  barrierDist + MARSHAL_MARGIN, corner.side, barrierDist, embankOuter);
            if (usable(marshal.x, marshal.z, pitRoadHalf + 8)) {
                layout.push({ asset: 'marshalPost', category: 'safety', ...marshal, scale: 1 });
            }

            // Cartelli di frenata a 100 e 50 unità PRIMA dell'ingresso curva.
            for (const dist of BOARD_DISTANCES) {
                const w = TrackGeometry.walkClosedLoop(trackPts, corner.startIdx, -dist);
                const idx = w.fromIdx;
                const pos = place(trackPts, groundPts, idx, barrierDist + BOARD_MARGIN,
                                  corner.side, barrierDist, embankOuter);
                if (!usable(pos.x, pos.z, pitRoadHalf + 5)) continue;
                layout.push({ asset: 'brakingBoard', category: 'safety', ...pos, scale: 1 });
            }
        }

        // Reti di protezione davanti a ogni tribuna già piazzata: si copre un
        // tratto largo quanto la tribuna, centrato su di essa.
        const fenceStepSamples = Math.max(1, Math.round(FENCE_STEP / stepLen));
        for (const stand of grandstands) {
            const near = TrackGeometry.nearestPoint(trackPts, stand.x, stand.z);
            const side = Math.sign(
                (stand.x - trackPts[near.index].x) * TrackGeometry.normalAt(trackPts, near.index, true).nx +
                (stand.z - trackPts[near.index].z) * TrackGeometry.normalAt(trackPts, near.index, true).nz
            ) || 1;
            for (let s = -fenceStepSamples; s <= fenceStepSamples; s += fenceStepSamples) {
                const idx = ((near.index + s) % n + n) % n;
                const pos = place(trackPts, groundPts, idx, barrierDist + FENCE_MARGIN,
                                  side, barrierDist, embankOuter);
                if (!usable(pos.x, pos.z, pitRoadHalf + 5)) continue;
                layout.push({ asset: 'catchFence', category: 'safety', ...pos, scale: 1 });
            }
        }

        // Decoro del paddock vicino al traguardo, sul lato corsia box.
        const decorPlan = [
            { asset: 'pylon', at: 40 },
            { asset: 'paddockTent', at: 80 },
            { asset: 'paddockTent', at: 110 },
            { asset: 'flagPole', at: 20 },
            { asset: 'flagPole', at: 28 },
            { asset: 'flagPole', at: 36 },
        ];
        for (const d of decorPlan) {
            const w = TrackGeometry.walkClosedLoop(trackPts, 0, d.at);
            const pos = place(trackPts, groundPts, w.fromIdx,
                              barrierDist + PADDOCK_DECOR_MARGIN, -ctx.mainSide,
                              barrierDist, embankOuter);
            if (!usable(pos.x, pos.z, pitRoadHalf + 8)) continue;
            layout.push({ asset: d.asset, category: 'paddock-decor', ...pos, scale: 1 });
        }

        // Barriere di cemento lungo il primo tratto della corsia box, a
        // separarla dalla pista.
        for (let i = 6; i < Math.min(pitPts.length - 6, 60); i += 8) {
            const p = pitPts[i];
            const { nx, nz } = TrackGeometry.normalAt(pitPts, i, false);
            const distPlus = TrackGeometry.nearestPoint(trackPts, p.x + nx, p.z + nz).dist;
            const side = distPlus >= TrackGeometry.nearestPoint(trackPts, p.x - nx, p.z - nz).dist ? -1 : 1;
            const x = p.x + nx * 4 * side, z = p.z + nz * 4 * side;
            if (insidePlayerBoxFootprint(x, z, playerBoxFootprints)) continue;
            layout.push({
                asset: 'concreteBarrier', category: 'safety',
                x, y: p.y || 0, z,
                rotY: Math.atan2(p.x - x, p.z - z), scale: 1,
            });
        }

        return layout;
    }

    return { buildTrackside, findCorners, CORNER_RADIUS_MAX };
```

- [ ] **Step 5: Eseguire i test — devono passare**

Run: `node --test frontend/shared/sceneryTrackside.test.js`
Expected: PASS su tutti e 5.

- [ ] **Step 6: Agganciare in `trackScenery.js`**

In `generateLayout`, dopo `grandstand`, passando le tribune già piazzate (servono per le reti):

```js
        const trackside = SceneryTrackside.buildTrackside({
            trackPts, pitPts, barrierDist, embankOuter, mainSide: side, rng,
            accepted, playerBoxFootprints, insidePlayerBoxFootprint,
            grandstands: [...mainStand, ...grandstand],
        });
```

e aggiungere `...trackside` al layout finale, più la dipendenza nel wrapper UMD.

- [ ] **Step 7: Aggiungere i path dei 7 asset in `f1.js`**

`tyreStack`, `catchFence`, `marshalPost`, `brakingBoard`, `concreteBarrier`, `pylon`, `flagPole`, `paddockTent` — tutti sotto `/assets/custom/circuit/`.

- [ ] **Step 8: Bump cache-busting e gate utente**

Aggiungere lo script `sceneryTrackside.js` in `f1.html` prima di `trackScenery.js`. Verificare in localhost: le gomme sono nelle curve e non sui rettilinei, i cartelli di frenata precedono le staccate, niente compenetra le barriere.

---

### Task 5 (FASE 3c): `sceneryCrowd.js` — spettatori sulle tribune

**Files:**
- Create: `frontend/shared/sceneryCrowd.js`
- Create: `frontend/shared/sceneryCrowd.test.js`
- Modify: `frontend/shared/trackScenery.js`, `frontend/f1.js`, `frontend/f1.html`

**Interfaces:**
- Consumes: le voci di layout di categoria `grandstand`/`grandstand-main` prodotte da `trackScenery.js`, e il JSON `frontend/assets/custom/circuit/grandStandSeats.json` (formato `{ seatCount, seats: [{x, y, z}] }`, coordinate locali alla tribuna).
- Produces: `SceneryCrowd.buildCrowd(grandstands, seatAnchors, rng) -> Array<layoutItem>`.

- [ ] **Step 1: Scrivere i test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const SceneryCrowd = require('./sceneryCrowd.js');
const seatData = require('../assets/custom/circuit/grandStandSeats.json');

function rngFactory() {
    let a = 987654321;
    return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

const STANDS = [
    { asset: 'grandStand', category: 'grandstand-main', x: 100, y: 0, z: 200, rotY: 0, scale: 1 },
    { asset: 'grandStandAwning', category: 'grandstand', x: -50, y: 3, z: 40, rotY: Math.PI / 2, scale: 1 },
];

test('genera spettatori solo per le tribune, in numero inferiore ai posti', () => {
    const crowd = SceneryCrowd.buildCrowd(STANDS, seatData.seats, rngFactory());
    assert.ok(crowd.length > 0, 'nessuno spettatore generato');
    assert.ok(crowd.length <= STANDS.length * seatData.seatCount);
    for (const s of crowd) {
        assert.ok(['spectatorA', 'spectatorB', 'spectatorC'].includes(s.asset));
        assert.equal(s.scale, 1);
        assert.equal(s.category, 'crowd');
    }
});

// Il posto è espresso in coordinate LOCALI alla tribuna: se la rotazione non
// viene applicata, gli spettatori di una tribuna ruotata finiscono in aria
// da un'altra parte. Con rotY=0 la trasformazione è l'identità più la
// traslazione, quindi il controllo è esatto.
test('con rotY=0 il posto locale si somma alla posizione della tribuna', () => {
    const stand = { ...STANDS[0], rotY: 0 };
    const crowd = SceneryCrowd.buildCrowd([stand], seatData.seats, rngFactory());
    for (const s of crowd) {
        const dx = s.x - stand.x, dz = s.z - stand.z;
        const match = seatData.seats.some(p =>
            Math.abs(p.x - dx) < 1e-6 && Math.abs(p.z - dz) < 1e-6);
        assert.ok(match, `spettatore a (${dx}, ${dz}) non corrisponde ad alcun posto`);
    }
});

test('la rotazione della tribuna è applicata ai posti', () => {
    const stand = { ...STANDS[0], rotY: Math.PI / 2 };
    const crowd = SceneryCrowd.buildCrowd([stand], seatData.seats, rngFactory());
    const anyRotated = crowd.some(s => Math.abs(s.x - stand.x) > 1);
    assert.ok(anyRotated, 'nessuno spettatore spostato: rotazione non applicata');
    for (const s of crowd) {
        const d = Math.hypot(s.x - stand.x, s.z - stand.z);
        assert.ok(d < 20, `spettatore a ${d.toFixed(1)} dal centro tribuna: fuori sagoma`);
    }
});

test('gli spettatori ereditano la quota della tribuna', () => {
    const stand = { ...STANDS[1] };
    const crowd = SceneryCrowd.buildCrowd([stand], seatData.seats, rngFactory());
    for (const s of crowd) assert.ok(s.y >= stand.y, 'spettatore sotto la base della tribuna');
});
```

- [ ] **Step 2: Eseguire — deve fallire**

Run: `node --test frontend/shared/sceneryCrowd.test.js`
Expected: FAIL con `Cannot find module './sceneryCrowd.js'`.

- [ ] **Step 3: Implementare `sceneryCrowd.js`**

```js
// frontend/shared/sceneryCrowd.js
//
// Spettatori sulle tribune. È l'unica categoria di scenografia posizionata
// RELATIVAMENTE a un altro oggetto invece che al tracciato: ogni posto è
// espresso in coordinate locali alla tribuna (grandStandSeats.json, generato
// dalla stessa funzione che genera i sedili del modello) e va portato in
// coordinate mondo applicando la rotazione e la posizione della tribuna.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SceneryCrowd = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Riempimento: mai una tribuna deserta, mai tutte identiche al 100%.
    const FILL_MIN = 0.65;
    const FILL_MAX = 1.0;
    // La tribuna principale è quella inquadrata a ogni partenza e arrivo:
    // resta più piena delle altre.
    const MAIN_FILL_MIN = 0.85;
    const VARIANTS = ['spectatorA', 'spectatorB', 'spectatorC'];

    function buildCrowd(grandstands, seatAnchors, rng) {
        if (!seatAnchors || !seatAnchors.length) return [];
        const layout = [];

        for (const stand of grandstands) {
            const isMain = stand.category === 'grandstand-main';
            const min = isMain ? MAIN_FILL_MIN : FILL_MIN;
            const fill = min + rng() * (FILL_MAX - min);

            const cos = Math.cos(stand.rotY || 0);
            const sin = Math.sin(stand.rotY || 0);

            for (const seat of seatAnchors) {
                if (rng() > fill) continue;
                // Rotazione attorno a Y: stessa convenzione di THREE.Object3D
                // usata da loadScenery quando applica rotation.y all'istanza.
                const x = stand.x + seat.x * cos + seat.z * sin;
                const z = stand.z - seat.x * sin + seat.z * cos;
                layout.push({
                    asset: VARIANTS[Math.floor(rng() * VARIANTS.length)],
                    category: 'crowd',
                    x, y: (stand.y || 0) + seat.y, z,
                    rotY: stand.rotY || 0,
                    scale: 1,
                });
            }
        }
        return layout;
    }

    return { buildCrowd, FILL_MIN, FILL_MAX, MAIN_FILL_MIN };
});
```

- [ ] **Step 4: Eseguire i test — devono passare**

Run: `node --test frontend/shared/sceneryCrowd.test.js`
Expected: PASS su tutti e 4.

- [ ] **Step 5: Passare i posti a `generateLayout`**

In `trackScenery.js`, aggiungere il parametro opzionale e la chiamata:

```js
    function generateLayout(trackData, trackPts, pitPts, barrierDist, embankmentWidth = 45, seatAnchors = null) {
```

e prima del `return`:

```js
        // seatAnchors arriva da f1.js (fetch di grandStandSeats.json): questo
        // modulo è puro e non accede alla rete. Se manca, il layout viene
        // generato senza spettatori invece di fallire.
        const crowd = SceneryCrowd.buildCrowd([...mainStand, ...grandstand], seatAnchors, rng);
```

aggiungendo `...crowd` al layout finale e `SceneryCrowd` al wrapper UMD.

- [ ] **Step 6: Caricare il JSON in `f1.js`**

Prima della chiamata a `generateLayout`, sostituendo la riga esistente:

```js
    // I posti a sedere delle tribune stanno in un JSON generato dal builder
    // degli asset: TrackScenery è un modulo puro e non può fare fetch, quindi
    // glieli passiamo noi. Se il file manca, la scenografia viene comunque
    // generata (senza spettatori) invece di far fallire il caricamento pista.
    let seatAnchors = null;
    try {
        const res = await fetch('/assets/custom/circuit/grandStandSeats.json');
        if (res.ok) seatAnchors = (await res.json()).seats;
    } catch (err) {
        console.warn('[F1] posti tribuna non caricati, tribune vuote:', err);
    }
    const sceneryLayout = TrackScenery.generateLayout(trackData, trackPts, PIT_PTS, BARRIER_D, EMBANKMENT_WIDTH, seatAnchors);
    loadScenery(scene, sceneryLayout);
```

Verificare che il codice circostante sia dentro una funzione `async` (lo è: il blocco `DOMContentLoaded` di `f1.js` è asincrono e già usa `await`).

- [ ] **Step 7: Aggiungere i path dei 3 spettatori in `f1.js`**

`spectatorA`, `spectatorB`, `spectatorC` sotto `/assets/custom/circuit/`.

- [ ] **Step 8: Eseguire l'intera suite**

Run: `node --test frontend/shared/*.test.js backend/tools/*.test.js`
Expected: PASS su tutti. Il numero di test deve essere cresciuto rispetto ai 167 di partenza.

- [ ] **Step 9: Bump cache-busting e gate utente finale**

Aggiungere `sceneryCrowd.js` in `f1.html` prima di `trackScenery.js`, bumpare tutti i moduli toccati. Far verificare in localhost: tribune popolate con riempimento variabile, nessuno spettatore fuori sagoma o sospeso in aria, frame rate invariato.

- [ ] **Step 10: Aggiornare `docs/f1-notes.md`**

Aggiungere alla sezione "Asset voxel del circuito" un paragrafo sull'integrazione: quali moduli generano cosa, che `curvatureAt` è il prerequisito degli elementi in curva, e che i Kenney residui sono solo gli alberi. Senza, chi tornerà su questo codice dovrà ricostruire la mappa da zero.
