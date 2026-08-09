# F1 "circuito vivo" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correggere i sette difetti di scenografia emersi al playtest del 2026-08-09 e chiudere l'orizzonte con colline e boschi, così che il circuito sembri un impianto vero e finito.

**Architettura:** Nessun modulo nuovo salvo `sceneryHills.js` (quota del terreno collinare, condivisa fra chi disegna la mesh e chi ci piazza gli alberi: senza una fonte unica gli alberi finirebbero sepolti o sospesi). Il resto sono correzioni dove il codice già vive. Il mattone riusato è **`TrackGeometry.advanceToDistance`**: cammina lungo un percorso finché il punto *già offsettato lateralmente* raggiunge una distanza euclidea data — è ciò che rende continue sia la tribuna principale sia la fila di edifici box, su qualunque curvatura.

**Tech Stack:** JS vanilla in stile UMD (stesso pattern degli altri moduli in `frontend/shared/`), test con `node --test` nativo (il repo non ha `node_modules`), Python + Blender 5.1 headless per il solo asset da riparare.

## Global Constraints

- **Spec di riferimento:** `docs/superpowers/specs/2026-08-09-f1-circuito-vivo-design.md`. Misure degli asset: `frontend/shared/sceneryAssetSizes.js` e `docs/f1-notes.md`.
- **Test sui tracciati reali**, non su fixture sintetiche: tutti i difetti di questo piano sono emersi su `prova`, `monte-rosso`, `new-monza`. Una fixture inventata li nasconderebbe.
- **Formato delle voci di layout**, invariato: `{ asset, category, x, y, z, rotY, scale }`. Gli asset custom hanno `scale: 1`; solo `treeLarge`/`treeSmall` restano a 6.
- **Orientamento:** `rotY = Math.atan2(p.x - x, p.z - z)` fa guardare l'oggetto verso il punto `p`. Tutti gli asset custom hanno il fronte su +Z locale.
- **Moduli UMD:** ogni file in `frontend/shared/` segue il wrapper `(function (root, factory) { ... })(typeof self !== 'undefined' ? self : this, function (Dep) { ... })`. Se un modulo acquisisce una dipendenza, va aggiunta **sia** al ramo `require` **sia** al ramo `root.`, e lo `<script>` della dipendenza deve venire **prima** in `frontend/f1.html`.
- **Cache-busting obbligatorio:** ogni modifica a un `.js` del frontend richiede il bump di `?v=` in `frontend/f1.html`. Senza, il browser serve il file vecchio e sembra che il lavoro non abbia avuto effetto — è già costato una sessione.
- **Commenti in italiano**, e ogni costante numerica va commentata con la misura che la giustifica: è la convenzione del progetto, i file esistenti la seguono ovunque.
- **NIENTE COMMIT.** `CLAUDE.md`: committa e pusha solo l'utente, a mano. Ogni task finisce con un gate utente in localhost, mai con un `git commit`.
- **Gli asset approvati non si toccano**, con l'unica eccezione di `grandStandAwning` (Task 1), che l'utente ha esplicitamente chiesto di riparare.

---

## File Structure

**Creati:**
- `frontend/shared/sceneryHills.js` — `hillHeightAt(x, z, ctx)`: quota del terreno collinare oltre il terrapieno. Fonte unica per la mesh (`trackMeshBuilder`) e per gli alberi dei boschi (`trackScenery`).
- `frontend/shared/sceneryHills.test.js`

**Modificati:**
- `backend/tools/circuitAssets/grandstands.py` — falda della variante con tettoia.
- `frontend/shared/sceneryAssetSizes.js` — misura aggiornata di `grandStandAwning`; nuova `overlaps()` (SAT).
- `frontend/shared/trackGeometry.js` — nuova `advanceToDistance()`.
- `frontend/shared/trackScenery.js` — tribuna principale a catena, esclusione delle tribune sparse, SAT per le strutture, fronte continuo degli edifici box, boschi.
- `frontend/shared/sceneryLandmarks.js` — SAT contro le strutture accettate.
- `frontend/shared/sceneryTrackside.js` — offset di ripiego del decoro paddock.
- `frontend/shared/trackMeshBuilder.js` — colline nella griglia del prato lontano.
- `frontend/shared/pitBoxLoader.js` — meccanici davanti al box.
- `frontend/f1.js` — nebbia/cielo, path dei meccanici.
- `frontend/f1.html` — cache-busting e nuovo script.
- `backend/sockets/games/trackLoader.js` — `track.pitLanePts`.
- `backend/sockets/games/f1GameSocket.js` — autopilota sui punti campionati.
- I rispettivi `*.test.js`.

**Ordine dei task:** 1 (asset, indipendente) → 2 (SAT, prerequisito di 4 e 5) → 3 (tribuna) → 4 (conflitti) → 5 (box) → 6 (autopilota, backend, indipendente) → 7 (orizzonte) → 8 (asset inutilizzati).

---

### Task 1 (FASE A): riparare la tettoia di `grandStandAwning`

La falda si ferma a `y = 2.0` su un corpo profondo fino a `y = 6.0`: restano scoperte le ultime tre file e i montanti posteriori (a 5.6) reggono il vuoto. Va portata a filo della parete di fondo.

**Files:**
- Modify: `backend/tools/circuitAssets/grandstands.py:220`
- Modify: `frontend/shared/sceneryAssetSizes.js` (riga `grandStandAwning`)
- Modify: `backend/tools/circuitAssets.test.js` (tolleranza dimensionale)

**Interfaces:**
- Produces: `frontend/assets/custom/circuit/grandStandAwning.glb` rigenerato; la sua profondità reale, da propagare a `sceneryAssetSizes.js`.

- [ ] **Step 1: Estendere la falda**

In `backend/tools/circuitAssets/grandstands.py`, sostituire la costante:

```python
# 5.9 e non 2.0: la falda si fermava quattro unità PRIMA della parete di
# fondo (spessa 0.8, centrata a D/2 - 0.4 = 5.6, quindi fascia 5.2-6.0).
# Restavano scoperte le ultime tre file di gradoni e — più visibile — i
# montanti posteriori, che nascono a 5.6, non toccavano nulla: a render si
# leggevano come una seconda trave sospesa nel vuoto (segnalato dall'utente
# in gioco). A 5.9 la falda ci appoggia sopra affondandovi, senza facce
# complanari: la stessa regola anti z-fighting seguita da tutto il file.
AWNING_BACK = 5.9
```

- [ ] **Step 2: Rigenerare il modello e il render**

Run:
```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/f1CircuitAssetsBuilder.py -- --asset grandStandAwning
```
Expected: `[circuitAssets] grandStandAwning: N mesh -> .../grandStandAwning.glb` e il render in `backend/tools/renders/circuit/grandStandAwning.png`.

- [ ] **Step 3: Misurare la profondità reale del `.glb` riesportato**

Run: `node backend/tools/glbInspect.js frontend/assets/custom/circuit/grandStandAwning.glb`

Expected: profondità **invariata a 13.3**. La ragione: il bordo posteriore dell'asset non lo determina la falda ma i costoloni della parete di fondo, che stanno a `D/2 + 0.3 = 6.3`; la falda arriva a 5.9, quindi resta dentro l'ingombro esistente (da −7.0 del fronte a +6.3 → 13.3). Se il valore misurato **differisce** da 13.3, procedere con lo Step 4; se coincide, saltarlo.

- [ ] **Step 4: Propagare la misura solo se è cambiata**

Se e solo se lo Step 3 ha dato un valore diverso da 13.3, aggiornare in `frontend/shared/sceneryAssetSizes.js` **la sola** riga di `grandStandAwning` (`w` e `h` non cambiano, la falda si estende in profondità):

```js
        grandStandAwning:  { w: 19.2, h: 16.0, d: <valore misurato allo Step 3> },
```

Un valore sbagliato qui non rompe nulla in modo evidente: produce compenetrazioni che si notano solo guardando il circuito. Per questo si misura invece di stimare.

- [ ] **Step 5: Eseguire i test dell'asset**

Run: `node --test backend/tools/circuitAssets.test.js`
Expected: PASS. Se il test dimensionale fallisce per la nuova profondità, aggiornare l'atteso in `backend/tools/circuitAssets.test.js:28` (`grandStandAwning: { w: 18, h: 16, d: ..., centerTol: 1.2 }`) — è il valore atteso del modello, non un vincolo di progetto.

- [ ] **Step 6: Gate utente — approvazione del render**

Mostrare all'utente `backend/tools/renders/circuit/grandStandAwning.png`. La tettoia deve coprire tutta la gradinata e poggiare sui montanti posteriori. **Non proseguire senza approvazione**: è la convenzione di progetto per ogni asset generato.

---

### Task 2 (FASE C, prerequisito): test di sovrapposizione fra ingombri

Serve a Task 4 (landmark dentro edifici) e Task 5 (edifici box). Va scritto una volta sola in `sceneryAssetSizes.js`, che è già il posto dove vivono gli ingombri e che già espone `footprintCorners`.

**Files:**
- Modify: `frontend/shared/sceneryAssetSizes.js`
- Create: `frontend/shared/sceneryAssetSizes.test.js`

**Interfaces:**
- Consumes: `SceneryAssetSizes.footprintCorners(item) -> [{x, z} × 4]` (già esistente), dove `item = { asset, x, z, rotY, scale }`.
- Produces: `SceneryAssetSizes.overlaps(itemA, itemB) -> boolean` — true se i due footprint orientati si intersecano.

- [ ] **Step 1: Scrivere i test**

Creare `frontend/shared/sceneryAssetSizes.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const SceneryAssetSizes = require('./sceneryAssetSizes.js');

function item(asset, x, z, rotY) {
    return { asset, x, z, rotY: rotY || 0, scale: 1 };
}

test('due oggetti nello stesso punto si sovrappongono', () => {
    assert.equal(SceneryAssetSizes.overlaps(item('podium', 0, 0), item('pitsGarageClosed', 0, 0)), true);
});

test('due oggetti lontani non si sovrappongono', () => {
    assert.equal(SceneryAssetSizes.overlaps(item('podium', 0, 0), item('pitsGarageClosed', 500, 500)), false);
});

// Il caso reale trovato in gioco: podio (12 x 7.1) dentro un garage box
// (20.6 x 14.7), compenetrazione misurata 7.1 unità sul tracciato "prova".
test('riconosce il podio dentro il garage box', () => {
    assert.equal(SceneryAssetSizes.overlaps(item('podium', 0, 0), item('pitsGarageClosed', 8, 0)), true);
});

// Affiancati a distanza pari alla semisomma delle larghezze: si toccano
// senza compenetrarsi, ed è la condizione che deve valere fra due edifici
// box contigui (Task 5).
test('affiancati esattamente a contatto non risultano sovrapposti', () => {
    const d = (SceneryAssetSizes.sizeOf('pitsGarageClosed').w + SceneryAssetSizes.sizeOf('pitsOffice').w) / 2 + 0.1;
    assert.equal(SceneryAssetSizes.overlaps(item('pitsGarageClosed', 0, 0), item('pitsOffice', d, 0)), false);
});

// La rotazione deve contare davvero: due rettangoli lunghi e stretti a 90
// gradi l'uno dall'altro si intersecano dove, paralleli, non si toccherebbero.
test('la rotazione degli oggetti viene applicata', () => {
    const a = item('billboard', 0, 0, 0);              // 16.4 x 1.6
    const b = item('billboard', 6, 0, Math.PI / 2);
    assert.equal(SceneryAssetSizes.overlaps(a, b), true);
    const c = item('billboard', 6, 0, 0);
    assert.equal(SceneryAssetSizes.overlaps(a, c), false);
});
```

- [ ] **Step 2: Eseguire i test — devono fallire**

Run: `node --test frontend/shared/sceneryAssetSizes.test.js`
Expected: FAIL con `SceneryAssetSizes.overlaps is not a function`.

- [ ] **Step 3: Implementare `overlaps`**

In `frontend/shared/sceneryAssetSizes.js`, dopo `footprintCorners`, e aggiungere `overlaps` all'oggetto ritornato in fondo al file:

```js
    // Separating Axis Theorem su due rettangoli orientati. Il test di
    // distanza fra centri (isTooCloseToAny in trackScenery.js) non basta per
    // le strutture: usa un raggio unico e non conosce l'orientamento, quindi
    // o rifiuta collocazioni valide o accetta compenetrazioni reali — è così
    // che il podio è finito dentro un garage box.
    //
    // Due convessi NON si intersecano se esiste un asse su cui le loro
    // proiezioni sono disgiunte; per due rettangoli basta provare le quattro
    // normali ai lati (due per rettangolo, le altre due sono parallele).
    function projectOnAxis(corners, ax, az) {
        let min = Infinity, max = -Infinity;
        for (const c of corners) {
            const d = c.x * ax + c.z * az;
            if (d < min) min = d;
            if (d > max) max = d;
        }
        return { min, max };
    }

    function overlaps(itemA, itemB) {
        const a = footprintCorners(itemA);
        const b = footprintCorners(itemB);
        for (const poly of [a, b]) {
            for (let i = 0; i < 4; i++) {
                const p = poly[i], q = poly[(i + 1) % 4];
                // Normale al lato p->q.
                const ax = -(q.z - p.z), az = q.x - p.x;
                const len = Math.hypot(ax, az);
                if (len < 1e-9) continue;
                const pa = projectOnAxis(a, ax / len, az / len);
                const pb = projectOnAxis(b, ax / len, az / len);
                if (pa.max <= pb.min || pb.max <= pa.min) return false;   // asse separatore trovato
            }
        }
        return true;
    }
```

- [ ] **Step 4: Eseguire i test — devono passare**

Run: `node --test frontend/shared/sceneryAssetSizes.test.js`
Expected: PASS su tutti e 5.

- [ ] **Step 5: Bump del cache-busting**

In `frontend/f1.html`, bumpare `shared/sceneryAssetSizes.js?v=` (da `20260809b` a `20260809c`).

Nessun gate utente: questo task non cambia nulla di visibile, è solo il mattone dei due successivi.

---

### Task 3 (FASE B): tribuna principale continua

**Files:**
- Modify: `frontend/shared/trackGeometry.js` (nuova `advanceToDistance`)
- Modify: `frontend/shared/trackGeometry.test.js`
- Modify: `frontend/shared/trackScenery.js` (`buildMainGrandstandLayout`, `buildGrandstandLayout`, costanti)
- Modify: `frontend/shared/trackScenery.test.js`
- Modify: `frontend/f1.html`

**Interfaces:**
- Produces: `TrackGeometry.advanceToDistance(points, startIndex, dir, closed, from, spacing, project) -> number` — indice del primo campione, camminando da `startIndex` nella direzione `dir` (+1 o −1), il cui punto proiettato dista almeno `spacing` da `from`. Ritorna `-1` se il percorso finisce prima (solo per `closed === false`) o se si compie un giro intero senza raggiungere la distanza. `from` è `{x, z}`; `project(idx) -> {x, z}` mappa un indice nel punto da misurare (per la scenografia: il punto già spostato lateralmente).

- [ ] **Step 1: Scrivere i test di `advanceToDistance`**

In `frontend/shared/trackGeometry.test.js`. Un cerchio è il caso in cui la risposta giusta si conosce in anticipo:

```js
test('advanceToDistance trova il punto alla distanza richiesta su un cerchio', () => {
    const R = 100, N = 400;
    const pts = [];
    for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, y: 0 });
    }
    const project = (i) => pts[i];
    const idx = TrackGeometry.advanceToDistance(pts, 0, 1, true, pts[0], 20, project);
    const d = Math.hypot(pts[idx].x - pts[0].x, pts[idx].z - pts[0].z);
    // La tolleranza è un passo di campionamento: si cerca il PRIMO campione
    // oltre la soglia, non un punto interpolato.
    const step = (2 * Math.PI * R) / N;
    assert.ok(d >= 20 && d < 20 + step * 1.5, `distanza ${d.toFixed(2)}, attesa ~20`);
});

test('advanceToDistance rispetta il verso di marcia', () => {
    const pts = [];
    for (let i = 0; i < 200; i++) pts.push({ x: i * 2, z: 0, y: 0 });
    const project = (i) => pts[i];
    const fwd = TrackGeometry.advanceToDistance(pts, 100, 1, false, pts[100], 20, project);
    const back = TrackGeometry.advanceToDistance(pts, 100, -1, false, pts[100], 20, project);
    assert.ok(fwd > 100, `avanti dovrebbe crescere, ha dato ${fwd}`);
    assert.ok(back < 100, `indietro dovrebbe calare, ha dato ${back}`);
});

test('advanceToDistance ritorna -1 se il percorso aperto finisce prima', () => {
    const pts = [];
    for (let i = 0; i < 20; i++) pts.push({ x: i * 2, z: 0, y: 0 });   // lungo 38 in tutto
    const project = (i) => pts[i];
    assert.equal(TrackGeometry.advanceToDistance(pts, 0, 1, false, pts[0], 500, project), -1);
});

// Il motivo per cui `project` esiste: sulla scenografia la spaziatura va
// misurata fra i punti OFFSETTATI di lato, non sulla linea centrale. Su una
// curva i due valori differiscono in proporzione al raggio.
test('advanceToDistance misura sui punti proiettati, non sui campioni grezzi', () => {
    const R = 100, N = 400;
    const pts = [];
    for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, y: 0 });
    }
    // Proiezione su un cerchio di raggio doppio: stessa distanza angolare,
    // distanza lineare doppia -> serve la metà dei campioni.
    const outer = (i) => ({ x: pts[i].x * 2, z: pts[i].z * 2 });
    const iCenter = TrackGeometry.advanceToDistance(pts, 0, 1, true, pts[0], 20, (i) => pts[i]);
    const iOuter = TrackGeometry.advanceToDistance(pts, 0, 1, true, outer(0), 20, outer);
    assert.ok(iOuter < iCenter, `proiettato ${iOuter} dovrebbe precedere il grezzo ${iCenter}`);
});
```

- [ ] **Step 2: Eseguire — devono fallire**

Run: `node --test frontend/shared/trackGeometry.test.js`
Expected: FAIL con `TrackGeometry.advanceToDistance is not a function`.

- [ ] **Step 3: Implementare `advanceToDistance`**

In `frontend/shared/trackGeometry.js`, subito dopo `walkClosedLoop`, e aggiungere `advanceToDistance` all'oggetto esportato in fondo al file:

```js
    // Primo campione, camminando da startIndex nel verso dir (+1/-1), il cui
    // punto PROIETTATO dista almeno `spacing` da `from`. -1 se non esiste.
    //
    // Serve a comporre file di oggetti contigui (tribune, edifici box). Il
    // modo ovvio — convertire la spaziatura in un numero di campioni,
    // `Math.round(spacing / stepLen)` — sbaglia due volte: l'arrotondamento
    // introduce da solo un errore (18.4/5.17 -> 4 campioni = 20.7, +12%), e
    // soprattutto ignora che gli oggetti stanno SPOSTATI DI LATO rispetto
    // alla linea centrale: su una curva di raggio 158 con offset 29, l'arco
    // percorso dagli oggetti non è quello dei campioni. Misurando la
    // distanza reale fra i punti proiettati, entrambi gli errori spariscono
    // e la fila resta continua su qualunque geometria.
    function advanceToDistance(points, startIndex, dir, closed, from, spacing, project) {
        const n = points.length;
        const step = dir >= 0 ? 1 : -1;
        let idx = startIndex;
        for (let k = 0; k < n; k++) {
            idx += step;
            if (closed) {
                idx = ((idx % n) + n) % n;
            } else if (idx < 0 || idx >= n) {
                return -1;
            }
            const q = project(idx);
            if (Math.hypot(q.x - from.x, q.z - from.z) >= spacing) return idx;
        }
        return -1;
    }
```

- [ ] **Step 4: Eseguire — devono passare**

Run: `node --test frontend/shared/trackGeometry.test.js`
Expected: PASS su tutti, inclusi i preesistenti.

- [ ] **Step 5: Scrivere il test della fila continua — deve fallire con il codice attuale**

In `frontend/shared/trackScenery.test.js`. Questo è il test che dimostra il difetto: su `prova` i tre moduli distano oggi 14.3 e 17.2 invece di 18.4.

```js
const prova = require('../tracks/prova.json');
const SceneryAssetSizes = require('./sceneryAssetSizes.js');

function layoutFor(track) {
    const trackPts = TrackGeometry.sampleLoop(track.controlPoints, 1000);
    const pitPts = TrackGeometry.sampleOpenPath(track.pit.path, 300);
    const barrierD = track.roadHalfWidth + 2.8 + 1.2;
    return { layout: TrackScenery.generateLayout(track, trackPts, pitPts, barrierD), trackPts, pitPts };
}

// La tribuna principale deve leggersi come UNA struttura continua: ogni
// modulo a contatto col successivo, nessun varco. Il difetto segnalato
// dall'utente ("un buco al traguardo") nasce da distanze reali diverse fra
// loro, 14.3 e 17.2 su prova contro un passo nominale di 18.4.
for (const track of [prova, monteRosso]) {
    test(`${track.id}: i moduli della tribuna principale formano una fila continua`, () => {
        const { layout } = layoutFor(track);
        const main = layout.filter(i => i.category === 'grandstand-main');
        assert.ok(main.length >= 5, `solo ${main.length} moduli: la fila deve essere lunga`);

        // Ordinati per posizione lungo la fila: si confrontano i vicini.
        const sorted = [...main].sort((a, b) => (a.x - b.x) || (a.z - b.z));
        const w = SceneryAssetSizes.sizeOf('grandStand').w;
        for (let i = 1; i < sorted.length; i++) {
            const d = Math.hypot(sorted[i].x - sorted[i - 1].x, sorted[i].z - sorted[i - 1].z);
            assert.ok(d <= w, `varco fra moduli: ${d.toFixed(1)} contro larghezza ${w}`);
            assert.ok(d > w * 0.7, `moduli troppo compenetrati: ${d.toFixed(1)}`);
        }
    });

    test(`${track.id}: nessuna tribuna sparsa a ridosso della fila principale`, () => {
        const { layout } = layoutFor(track);
        const main = layout.filter(i => i.category === 'grandstand-main');
        const loose = layout.filter(i => i.category === 'grandstand');
        for (const l of loose) {
            for (const m of main) {
                const d = Math.hypot(l.x - m.x, l.z - m.z);
                assert.ok(d >= 45,
                    `tribuna sparsa a ${d.toFixed(1)} dalla fila principale: ne' continua ne' separata`);
            }
        }
    });
}
```

- [ ] **Step 6: Eseguire — devono fallire**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: FAIL su "fila continua" (oggi i moduli sono 3, non ≥5, e le distanze sono 14.3/17.2) e su "nessuna tribuna sparsa a ridosso" (su prova ce n'è una a 32.4).

- [ ] **Step 7: Ritarare le costanti della tribuna principale**

In `frontend/shared/trackScenery.js`, sostituire il blocco di `MAIN_STAND_COLS` e aggiungere la costante di isolamento:

```js
    // 7 e non 3: l'utente vuole una tribuna unica lunga, che segua la pista
    // senza interruzioni (playtest 2026-08-09). A 18.4 di passo la fila è
    // lunga ~129 unità.
    const MAIN_STAND_COLS          = 7;
    // Distanza minima di una tribuna SPARSA dalla fila principale. Con la
    // sola STRUCTURE_CLEARANCE (22) una tribuna finiva a 32.4 dal modulo
    // esterno: troppo lontana per leggersi come continuazione della fila,
    // troppo vicina per leggersi come struttura a sé — cioè esattamente il
    // "buco" fotografato dall'utente. Meglio nessuna tribuna lì che una
    // tribuna a meta' strada.
    const MAIN_STAND_ISOLATION     = 45;
```

- [ ] **Step 8: Riscrivere `buildMainGrandstandLayout` come catena**

Sostituire integralmente il corpo della funzione in `frontend/shared/trackScenery.js`:

```js
    // Tribuna principale: una fila unica di MAIN_STAND_COLS moduli contigui
    // centrata sul traguardo, che segue la curvatura della pista. `side`
    // (1 o -1) arriva da generateLayout via mainStandSide().
    //
    // I moduli si incatenano per DISTANZA REALE fra i centri offsettati
    // (TrackGeometry.advanceToDistance), non per passo in campioni: il
    // traguardo di "prova" è in curva (raggio 158) e i moduli stanno 29
    // unità di lato, quindi un passo misurato sulla linea centrale dava
    // distanze reali di 14.3 e 17.2 invece dei 18.4 nominali — un modulo
    // compenetrato e un varco visibile.
    function buildMainGrandstandLayout(trackPts, barrierDist, side, embankOuter, fitsUnderBridge) {
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const offset = barrierDist + MAIN_STAND_OFFSET_MARGIN;

        // Il punto dove sorgerebbe il modulo al campione idx: già spostato di
        // lato, perché è fra i centri offsettati che deve valere il passo.
        function moduleAt(idx) {
            const p = trackPts[idx];
            const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
            const x = p.x + nx * offset * side;
            const z = p.z + nz * offset * side;
            return { x, z, idx, rotY: Math.atan2(p.x - x, p.z - z) };
        }

        // Catena simmetrica attorno al traguardo: il modulo centrale, poi
        // meta' fila in avanti e meta' all'indietro.
        const center = moduleAt(0);
        const modules = [center];
        const back = Math.floor((MAIN_STAND_COLS - 1) / 2);
        const forward = MAIN_STAND_COLS - 1 - back;
        for (const [dir, wanted] of [[1, forward], [-1, back]]) {
            let prev = center;
            for (let k = 0; k < wanted; k++) {
                const idx = TrackGeometry.advanceToDistance(
                    trackPts, prev.idx, dir, true, prev, MAIN_STAND_COL_SPACING,
                    (i) => moduleAt(i));
                if (idx < 0) break;
                prev = moduleAt(idx);
                modules.push(prev);
            }
        }

        for (const m of modules) {
            const baseY = TrackGeometry.terrainHeightAt(groundPts, m.x, m.z, barrierDist, embankOuter);
            const stackHeight = MAIN_STAND_TIER_HEIGHT * MAIN_STAND_TIERS;
            if (!fitsUnderBridge('__stack__', m.x, m.z, baseY, stackHeight)) continue;
            for (let tier = 0; tier < MAIN_STAND_TIERS; tier++) {
                layout.push({
                    asset: MAIN_STAND_ASSET, category: 'grandstand-main',
                    x: m.x, y: baseY + tier * MAIN_STAND_TIER_HEIGHT,
                    z: m.z, rotY: m.rotY, scale: CUSTOM_MODEL_SCALE
                });
            }
        }
        return layout;
    }
```

- [ ] **Step 9: Isolare le tribune sparse dalla fila principale**

In `buildGrandstandLayout`, aggiungere il parametro `mainStand` (le voci già prodotte) e il controllo dentro `slotValid`:

```js
    function buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted, rng, embankOuter, fitsUnderBridge, mainStand) {
```

e dentro `slotValid`, dopo il controllo su `pitPts`:

```js
            // Mai a ridosso della fila principale: o la tribuna continua la
            // fila (e allora la genera buildMainGrandstandLayout), o sta
            // altrove. La via di mezzo è il varco segnalato dall'utente.
            for (const m of mainStand) {
                if (Math.hypot(x - m.x, z - m.z) < MAIN_STAND_ISOLATION) return false;
            }
```

In `generateLayout`, passare `mainStand` alla chiamata:

```js
        const grandstand = buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted, rng, embankOuter, fitsUnderBridge, mainStand);
```

- [ ] **Step 10: Eseguire i test — devono passare**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: PASS, inclusi i test preesistenti di determinismo e di non-sovrapposizione.

**Se fallisce il test dei cartelloni sponsor:** `MAIN_STAND_HALF_SPAN` è derivata (`MAIN_STAND_COLS * MAIN_STAND_COL_SPACING / 2`) e passa da 27.6 a 64.4, quindi sopprime **tutti** i cartelloni del lato tribuna nella finestra di 60 unità. È previsto dalla spec e corretto (davanti alla tribuna non ci vanno): se un test preesistente pretende cartelloni su entrambi i lati, va aggiornato l'atteso, non la costante.

- [ ] **Step 11: Bump del cache-busting e gate utente**

In `frontend/f1.html`: bumpare `shared/trackGeometry.js?v=` e `shared/trackScenery.js?v=`.

Chiedere all'utente di avviare `node server.js` da `backend/` e guardare il traguardo. Da verificare: la tribuna principale è una fila lunga e continua senza varchi, segue la curva della pista, e non c'è più una tribuna isolata a mezza distanza. Non proseguire senza approvazione.

---

### Task 4 (FASE C): niente più strutture dentro altre strutture

**Files:**
- Modify: `frontend/shared/sceneryLandmarks.js`
- Modify: `frontend/shared/sceneryLandmarks.test.js`
- Modify: `frontend/shared/trackScenery.js` (passaggio di `accepted` ai landmark)
- Modify: `frontend/shared/trackScenery.test.js`
- Modify: `frontend/f1.html`

**Interfaces:**
- Consumes: `SceneryAssetSizes.overlaps(itemA, itemB) -> boolean` (Task 2).
- Produces: `SceneryLandmarks.buildLandmarks(trackPts, pitPts, barrierDist, mainSide, embankOuter, playerBoxFootprints, insidePlayerBoxFootprint, fitsUnderBridge, pitRoadHalf, accepted)` — un parametro in più, `accepted`, l'array delle voci di layout già piazzate.

- [ ] **Step 1: Scrivere il test — deve fallire**

In `frontend/shared/trackScenery.test.js`. Cinque sovrapposizioni reali oggi esistono sui tre tracciati; la peggiore è il podio dentro un garage box, 7.1 unità su `prova`:

```js
const newMonza = require('../tracks/new-monza.json');

for (const track of [prova, monteRosso, newMonza]) {
    test(`${track.id}: nessuna struttura si sovrappone a un'altra`, () => {
        const { layout } = layoutFor(track);
        // Solo le strutture: natura e folla usano un criterio di distanza
        // (molto più economico) e possono legittimamente stare vicine.
        const structures = layout.filter(i =>
            ['paddock', 'grandstand', 'grandstand-main', 'landmark'].includes(i.category));
        for (let i = 0; i < structures.length; i++) {
            for (let j = i + 1; j < structures.length; j++) {
                const a = structures[i], b = structures[j];
                // I moduli impilati della tribuna principale condividono x/z
                // per costruzione: si sovrappongono in pianta ma non nello
                // spazio, perché stanno a quote diverse.
                if (Math.abs((a.y || 0) - (b.y || 0)) > 1) continue;
                assert.equal(SceneryAssetSizes.overlaps(a, b), false,
                    `${a.asset} e ${b.asset} si sovrappongono a (${a.x.toFixed(0)}, ${a.z.toFixed(0)})`);
            }
        }
    });
}
```

Nota: i moduli **contigui** della fila principale si toccano ma non si compenetrano (Task 3 garantisce distanza ≥ 0.7 × larghezza e ≤ larghezza). Se questo test segnalasse coppie `grandStand × grandStand` della fila, alzare `MAIN_STAND_COL_SPACING` da 18.4 a 19.3 (larghezza reale 19.2 + margine) invece di indebolire il test.

- [ ] **Step 2: Eseguire — deve fallire**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: FAIL con almeno `podium e pitsGarageClosed si sovrappongono` su `prova` e `new-monza`, più `raceControlTower × grandStandAwning` e `footbridge × grandStandAwning` su `new-monza`.

- [ ] **Step 3: Far controllare le strutture accettate ai landmark**

In `frontend/shared/sceneryLandmarks.js`, aggiungere la dipendenza nel wrapper UMD:

```js
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'), require('./sceneryAssetSizes.js'));
    } else {
        root.SceneryLandmarks = factory(root.TrackGeometry, root.SceneryAssetSizes);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, SceneryAssetSizes) {
```

Aggiungere `accepted` alla firma di `buildLandmarks` e, in testa al corpo, l'helper condiviso dai quattro landmark:

```js
    function buildLandmarks(trackPts, pitPts, barrierDist, mainSide, embankOuter,
                            playerBoxFootprints, insidePlayerBoxFootprint,
                            fitsUnderBridge, pitRoadHalf, accepted) {
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const n = trackPts.length;
        const fits = fitsUnderBridge || (() => true);
        const pitHalf = pitRoadHalf || 0;
        const placed = accepted || [];

        // I landmark controllavano corsia box, box giocatore e cavalcavia, ma
        // NON le strutture già piazzate: il podio (12 x 7.1) finiva dentro un
        // garage box, compenetrandolo di 7.1 unità su "prova" — l'"edificio
        // dentro l'edificio" segnalato dall'utente. Test sui footprint reali
        // orientati, non sulla distanza fra centri: la torre è 14.6 x 12.6 e
        // il gantry scavalca la pista, un raggio unico non li descrive.
        function freeOf(asset, cand, scale) {
            const item = { asset, x: cand.x, z: cand.z, rotY: cand.rotY, scale: scale || 1 };
            return !placed.some(p => SceneryAssetSizes.overlaps(item, p));
        }
```

- [ ] **Step 4: Applicare il controllo ai quattro landmark**

Sempre in `sceneryLandmarks.js`:

- **Torre**: dentro il ciclo di ricerca, dopo `if (!fits(...)) continue;` aggiungere
  `if (!freeOf('raceControlTower', cand)) continue;`
- **Podio**: idem, `if (!freeOf('podium', cand)) continue;`
- **Ponte semafori**: oggi non cerca, piazza e basta. Va trasformato in una ricerca a partire dalla posizione ideale, così può scansare una struttura:

```js
        // Ponte semafori: NON sul traguardo ma davanti alla griglia (le auto
        // si schierano DOPO la linea: a indice 0 resterebbe alle spalle di
        // tutti e al via non si vedrebbero i semafori). Si parte dalla
        // posizione ideale e si avanza finché non è libera da altre
        // strutture: su new-monza il gantry cadeva addosso a una tribuna.
        const gantryWalk = TrackGeometry.walkClosedLoop(trackPts, 0, GANTRY_AHEAD_OF_GRID);
        for (let d = 0; d < 200; d += 4) {
            const idx = (gantryWalk.fromIdx + d) % n;
            if (trackPts[idx].bridge) continue;
            const cand = placeAcross(trackPts, idx, groundPts, barrierDist,
                                     embankOuter, GANTRY_NATIVE_HALF_SPAN);
            if (!freeOf('startGantry', cand, cand.scale)) continue;
            layout.push({ asset: 'startGantry', category: 'landmark', ...cand });
            break;
        }
```

- **Passerella**: dentro il doppio ciclo esistente, dopo `if (!fits(...)) continue;` aggiungere
  `if (!freeOf('footbridge', cand, cand.scale)) continue;`

- [ ] **Step 5: Passare `accepted` ai landmark**

In `frontend/shared/trackScenery.js`, nella chiamata dentro `generateLayout`:

```js
        const landmarks = SceneryLandmarks.buildLandmarks(
            trackPts, pitPts, barrierDist, side, embankOuter,
            playerBoxFootprints, insidePlayerBoxFootprint, fitsUnderBridge, pitRoadHalf,
            accepted);
```

`accepted` a quel punto contiene già paddock, tribuna principale e tribune sparse — cioè tutte le strutture con cui un landmark può collidere.

- [ ] **Step 6: Aggiornare i test dei landmark**

In `frontend/shared/sceneryLandmarks.test.js`, la funzione `build()` chiama `buildLandmarks` con la vecchia firma: aggiungere `[]` come ultimo argomento (nessuna struttura accettata). I quattro test esistenti devono continuare a passare.

- [ ] **Step 7: Eseguire tutti i test di scenografia**

Run: `node --test frontend/shared/trackScenery.test.js frontend/shared/sceneryLandmarks.test.js frontend/shared/sceneryTrackside.test.js frontend/shared/sceneryCrowd.test.js`
Expected: PASS su tutti, incluso il nuovo test di non-sovrapposizione sui tre tracciati.

- [ ] **Step 8: Bump del cache-busting e gate utente**

In `frontend/f1.html`: bumpare `shared/sceneryLandmarks.js?v=` e `shared/trackScenery.js?v=`.

Far verificare in localhost: nella corsia box non c'è più un edificio dentro l'altro; podio, torre, ponte semafori e passerella sono tutti visibili e liberi.

---

### Task 5 (FASE D): fronte continuo degli edifici della corsia box

**Files:**
- Modify: `frontend/shared/trackScenery.js` (`buildPaddockLayout`, costanti)
- Modify: `frontend/shared/trackScenery.test.js`
- Modify: `frontend/f1.html`

**Interfaces:**
- Consumes: `TrackGeometry.advanceToDistance` (Task 3), `SceneryAssetSizes.sizeOf(asset) -> {w, h, d}` e `SceneryAssetSizes.overlaps` (Task 2).

- [ ] **Step 1: Scrivere il test — deve fallire**

In `frontend/shared/trackScenery.test.js`:

```js
for (const track of [prova, monteRosso, newMonza]) {
    test(`${track.id}: gli edifici della corsia box formano un fronte continuo`, () => {
        const { layout } = layoutFor(track);
        const buildings = layout.filter(i =>
            i.asset === 'pitsGarageClosed' || i.asset === 'pitsOffice');
        assert.ok(buildings.length >= 4,
            `solo ${buildings.length} edifici: la corsia box sembra vuota`);

        // Ogni edificio deve avere un vicino a contatto: la distanza fra i
        // centri non deve superare la semisomma delle larghezze piu' un gap
        // ragionevole. Oggi il passo fisso di 24 unità, quando un candidato
        // viene scartato, apre vuoti di 48 (su monte-rosso sopravvive un solo
        // edificio in tutto).
        for (let i = 1; i < buildings.length; i++) {
            const a = buildings[i - 1], b = buildings[i];
            const need = (SceneryAssetSizes.sizeOf(a.asset).w + SceneryAssetSizes.sizeOf(b.asset).w) / 2;
            const d = Math.hypot(a.x - b.x, a.z - b.z);
            assert.ok(d <= need + 6, `varco di ${d.toFixed(1)} fra due edifici box (contatto a ${need.toFixed(1)})`);
            assert.ok(!SceneryAssetSizes.overlaps(a, b), `edifici box compenetrati: ${a.asset} e ${b.asset}`);
        }
    });
}
```

- [ ] **Step 2: Eseguire — deve fallire**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: FAIL su `monte-rosso` (1 solo edificio) e `new-monza` (3, con varchi).

- [ ] **Step 3: Sostituire la costante di passo**

In `frontend/shared/trackScenery.js`, al posto di `PIT_BUILDING_STEP_LEN`:

```js
    // Gap fra il fianco di un edificio box e quello del successivo. Il passo
    // non è più una costante di distanza (PIT_BUILDING_STEP_LEN = 24, che
    // contro edifici larghi 20.6 lasciava 3.4 unità di stacco e, quando un
    // candidato veniva scartato dai filtri, apriva un vuoto di 27): la
    // distanza fra due centri consecutivi si calcola dalle larghezze REALI
    // dei due modelli, così garage (20.6) e uffici (20.7) alternati formano
    // un fronte regolare.
    const PIT_BUILDING_GAP = 2;
```

- [ ] **Step 4: Riscrivere il ciclo degli edifici box come catena**

In `buildPaddockLayout`, sostituire il blocco che oggi va da `const pitStepLen = ...` fino alla fine del ciclo `for (let idx = firstIdx; ...)`:

```js
        // Edifici box: quota invariata (p.y || 0, dalla corsia box stessa) —
        // il terrapieno non copre la corsia box, fuori scope (vedi design).
        const pitStepLen = TrackGeometry.lapLength(pitPts) / pitPts.length;
        // Primo edificio ben oltre l'IMBOCCO della corsia: partendo da un
        // indice basso il primo cadeva a ~16 unità dall'ingresso e, essendo
        // largo 20.6, lo occupava di fatto rendendolo illeggibile.
        const firstIdx = Math.max(10, Math.round(PIT_BUILDING_ENTRY_CLEARANCE / pitStepLen));
        const lastIdx = pitPts.length - 10;

        // Punto dove sorgerebbe un edificio al campione idx, già spostato sul
        // lato esterno della corsia.
        function buildingAt(idx) {
            const p = pitPts[idx];
            const { nx, nz } = TrackGeometry.normalAt(pitPts, idx, false);
            // Lato "verso l'esterno" del tracciato principale: fra le due
            // direzioni normali si sceglie quella che allontana di più dal
            // centro del circuito, generico per qualunque forma di corsia.
            const distPlus  = TrackGeometry.nearestPoint(trackPts, p.x + nx, p.z + nz).dist;
            const distMinus = TrackGeometry.nearestPoint(trackPts, p.x - nx, p.z - nz).dist;
            const side = distPlus >= distMinus ? 1 : -1;
            const offset = pitRoadHalf + PIT_BUILDING_OFFSET_MARGIN;
            const x = p.x + nx * offset * side, z = p.z + nz * offset * side;
            return { x, z, idx, y: p.y || 0, rotY: Math.atan2(p.x - x, p.z - z) };
        }

        // Catena: ogni edificio si affianca al precedente alla distanza
        // dettata dalle LARGHEZZE REALI dei due modelli. Un candidato
        // scartato da un filtro fa avanzare di UN campione, non di un intero
        // passo: così il fronte si richiude subito dopo l'ostacolo invece di
        // lasciare un vuoto doppio (con il passo fisso, su monte-rosso
        // sopravviveva un solo edificio in tutta la corsia).
        let altBuilding = 0;
        let lastBuilding = null;
        let idx = firstIdx;
        while (idx < lastIdx) {
            const asset = (altBuilding % 2 === 0) ? 'pitsGarageClosed' : 'pitsOffice';
            const b = buildingAt(idx);

            const blocked = insidePlayerBoxFootprint(b.x, b.z, playerBoxFootprints)
                // Niente edifici dove corsia e pista corrono ancora
                // affiancate: lì un edificio profondo 14.7 si sovrappone
                // all'ingresso e lo rende illeggibile.
                || TrackGeometry.nearestPoint(trackPts, b.x, b.z).dist < barrierDist + PIT_BUILDING_TRACK_CLEARANCE
                || !fitsUnderBridge(asset, b.x, b.z, b.y);

            if (!blocked) {
                layout.push({ asset, category: 'paddock', x: b.x, y: b.y, z: b.z,
                              rotY: b.rotY, scale: CUSTOM_MODEL_SCALE });
                altBuilding++;
                lastBuilding = { asset, x: b.x, z: b.z };
                const nextAsset = (altBuilding % 2 === 0) ? 'pitsGarageClosed' : 'pitsOffice';
                const need = (SceneryAssetSizes.sizeOf(asset).w
                            + SceneryAssetSizes.sizeOf(nextAsset).w) / 2 + PIT_BUILDING_GAP;
                const nextIdx = TrackGeometry.advanceToDistance(
                    pitPts, idx, 1, false, lastBuilding, need, (i) => buildingAt(i));
                if (nextIdx < 0) break;   // corsia finita
                idx = nextIdx;
            } else {
                idx++;
            }
        }
```

- [ ] **Step 5: Eseguire i test — devono passare**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: PASS, incluso il test di non-sovrapposizione del Task 4 (il fronte continuo non deve creare compenetrazioni) e i test di determinismo preesistenti.

- [ ] **Step 6: Contare gli edifici generati**

Run:
```bash
node -e "
const TG=require('./frontend/shared/trackGeometry.js');
const TS=require('./frontend/shared/trackScenery.js');
for (const id of ['prova','monte-rosso','new-monza']) {
  const t=require('./frontend/tracks/'+id+'.json');
  const trackPts=TG.sampleLoop(t.controlPoints,1000);
  const pitPts=TG.sampleOpenPath(t.pit.path,300);
  const L=TS.generateLayout(t,trackPts,pitPts,t.roadHalfWidth+4);
  const n=L.filter(i=>i.asset==='pitsGarageClosed'||i.asset==='pitsOffice').length;
  console.log(id, 'edifici box:', n);
}"
```
Expected: nettamente più di oggi (prova 10, monte-rosso 1, new-monza 3). Se `monte-rosso` resta sotto 4, il collo di bottiglia non è il passo ma `PIT_BUILDING_ENTRY_CLEARANCE` o `PIT_BUILDING_TRACK_CLEARANCE` su quella corsia: verificarlo stampando quanti campioni vengono scartati e da quale filtro, **prima** di cambiare una costante.

- [ ] **Step 7: Bump del cache-busting e gate utente**

In `frontend/f1.html`: bumpare `shared/trackScenery.js?v=`.

Far verificare in localhost percorrendo la corsia box: gli edifici formano un fronte continuo e ordinato, non un ammasso e non oggetti sparsi a caso.

---

### Task 6 (FASE E): autopilota della corsia box sulla linea vera

Indipendente da tutti gli altri task: tocca solo il backend.

**Files:**
- Modify: `backend/sockets/games/trackLoader.js`
- Modify: `backend/sockets/games/f1GameSocket.js` (`updatePitAutopilot`, `startPitLaneEntry`, `completePitStop`, `assignGridSpawns`)
- Modify: `backend/sockets/games/f1GameSocket.physics.test.js`

**Interfaces:**
- Produces: `track.pitLanePts` — array di ~300 punti campionati della corsia box, **identico** a quello che il frontend usa per disegnarla.
- Produces: `anchor.laneIdx` — indice del punto di `pitLanePts` più vicino all'anchor del box, aggiunto in `assignGridSpawns`. `anchor.fromIdx` (indice sui punti di controllo) **resta** e continua a servire al balzo finale.

- [ ] **Step 1: Scrivere il test — deve fallire**

In `backend/sockets/games/f1GameSocket.physics.test.js`. Il test simula l'ingresso completo e misura lo scarto dalla linea centrale della corsia. Con il codice attuale lo scarto arriva a 3.35 su una semilarghezza di 5:

```js
const trackLoader = require('./trackLoader.js');

test('l\'autopilota d\'ingresso resta dentro la corsia box su tutte le piste', () => {
    for (const id of ['prova', 'monte-rosso', 'new-monza']) {
        const track = trackLoader.loadTrack(id);
        const lanePts = TrackGeometry.sampleOpenPath(track.pitPath, 300);
        const anchors = TrackGeometry.pitBoxAnchors(
            track.pitPath, track.pitBoxIndex, 3, track.points, track.pitRoadHalf);

        const io = { to: () => ({ emit: () => {} }) };
        const game = { track, socketByColor: {} };
        // Stato iniziale dell'ingresso impostato a mano, come fanno già gli
        // altri test dell'autopilota in questo file: startPitLaneEntry non è
        // esportata (module.exports.physics espone updatePitAutopilot, non
        // lei) e non ha bisogno di esserlo — si limita a queste due righe più
        // una emit al socket.
        const p = {
            color: '#ff0000', x: track.pitPath[0].x, z: track.pitPath[0].z,
            angle: 0, speed: 0, vx: 0, vz: 0,
            pitBoxAnchor: anchors[2], pitting: false, inputs: {},
            pitAutoState: 'entering', pitPathIndex: 1,
        };

        let worst = 0;
        for (let tick = 0; tick < 4000 && p.pitAutoState === 'entering'; tick++) {
            physics.updatePitAutopilot(io, 'lobby', game, p);
            // Il balzo finale verso lo stallo esce di proposito dalla corsia
            // (lo stallo è spostato di lato): si misura solo il tragitto.
            if (p.pitBoxFinalApproach) break;
            worst = Math.max(worst, TrackGeometry.nearestPoint(lanePts, p.x, p.z).dist);
        }
        assert.ok(worst < track.pitRoadHalf,
            `${id}: l'auto si è allontanata di ${worst.toFixed(2)} dalla linea della corsia (semilarghezza ${track.pitRoadHalf})`);
    }
});
```

`physics` è già l'oggetto che i test di questo file usano (`require('./f1GameSocket.js').physics`): `updatePitAutopilot` è esportata lì, riga 1954.

- [ ] **Step 2: Eseguire — deve fallire**

Run: `node --test backend/sockets/games/f1GameSocket.physics.test.js`
Expected: FAIL con uno scarto di ~3.35 su `prova` (semilarghezza 5).

- [ ] **Step 3: Esporre i punti campionati della corsia**

In `backend/sockets/games/trackLoader.js`, dopo il calcolo di `pitPath`:

```js
    // Punti CAMPIONATI della corsia box: la stessa espressione usata da
    // frontend/f1.js per disegnarla (sampleOpenPath + tuckPitEndsToTrack),
    // così la linea che l'autopilota percorre e quella che il giocatore vede
    // non possono divergere. L'autopilota camminava sui punti di CONTROLLO
    // grezzi (7 su "prova"): muovendosi in retta fra un controllo e l'altro
    // tagliava le curve, allontanandosi fino a 3.35 unità dalla linea della
    // corsia, su una semilarghezza di 5 (misurato).
    const pitLanePts = TrackGeometry.tuckPitEndsToTrack(
        TrackGeometry.sampleOpenPath(pitPath, PIT_LANE_SAMPLES), points);
```

con la costante in testa al file, accanto a `SAMPLES`:

```js
const PIT_LANE_SAMPLES = 300;   // stesso valore di frontend/f1.js: la corsia disegnata e quella percorsa devono coincidere
```

e aggiungere `pitLanePts` all'oggetto ritornato da `buildTrack`, accanto a `pitPath`.

- [ ] **Step 4: Calcolare `laneIdx` per ogni box**

In `backend/sockets/games/f1GameSocket.js`, dentro `assignGridSpawns`, subito dopo la chiamata a `pitBoxAnchors`:

```js
    // Indice del box sul percorso CAMPIONATO: l'autopilota cammina lì
    // (track.pitLanePts), mentre anchor.fromIdx è un indice sui punti di
    // CONTROLLO e resta valido solo per il balzo finale verso lo stallo.
    // La posizione fisica degli anchor NON cambia: è già stata verificata e
    // approvata, qui si aggiunge solo il modo di raggiungerla.
    for (const a of boxAnchors) {
        a.laneIdx = TrackGeometry.nearestPoint(game.track.pitLanePts, a.x, a.z).index;
    }
```

Stessa aggiunta nel blocco di qualifica (`qualiBoxAnchors`, ~riga 609).

- [ ] **Step 5: Far camminare l'autopilota sulla polilinea campionata**

In `f1GameSocket.js`, sostituire il tratto finale di `updatePitAutopilot` (dal `const target = track.pitPath[p.pitPathIndex];` fino alla fine della funzione) con un avanzamento **a distanza costante lungo la polilinea**. Con 300 waypoint distanti ~1 unità e `PIT_AUTO_SPEED = 1.55`, il vecchio schema "punta al waypoint, fermati quando arrivi, azzera la velocità" produrrebbe un movimento a scatti: ora si consuma la distanza percorsa nel tick attraversando quanti waypoint servono.

```js
    // Avanzamento lungo la polilinea della corsia: si consuma PIT_AUTO_SPEED
    // unità per tick attraversando quanti waypoint servono. Non si "punta al
    // waypoint e ci si ferma": con 300 campioni a ~1 unità l'uno dall'altro
    // (contro i 7 punti di controllo di prima) l'auto arriverebbe a
    // destinazione più volte per tick e il vecchio azzeramento di
    // speed/vx/vz la farebbe procedere a scatti.
    let budget = PIT_AUTO_SPEED;
    const lane = track.pitLanePts;
    while (budget > 0 && p.pitPathIndex < lane.length) {
        const wp = lane[p.pitPathIndex];
        const dx = wp.x - p.x, dz = wp.z - p.z;
        const dist = Math.hypot(dx, dz);

        if (dist > budget) {
            p.x += (dx / dist) * budget;
            p.z += (dz / dist) * budget;
            p.angle = Math.atan2(dx, dz);   // stessa convenzione della fisica normale (sin=x, cos=z)
            budget = 0;
            break;
        }

        p.x = wp.x; p.z = wp.z;
        budget -= dist;
        if (dist > 1e-6) p.angle = Math.atan2(dx, dz);

        // Arrivato al proprio box: il prossimo tick fa il balzo verso lo
        // stallo personale, spostato di lato rispetto alla corsia.
        if (p.pitAutoState === 'entering' && p.pitBoxAnchor
            && p.pitPathIndex >= p.pitBoxAnchor.laneIdx) {
            p.speed = PIT_AUTO_SPEED; p.vx = 0; p.vz = 0;
            p.pitBoxFinalApproach = true;
            return;
        }

        p.pitPathIndex++;
    }

    p.speed = PIT_AUTO_SPEED;
    p.vx = 0; p.vz = 0;

    if (p.pitPathIndex >= lane.length) {
        p.pitAutoState = null;   // fine autopilota: comandi restituiti al giocatore
        // Il controllo torna al giocatore con la velocità EFFETTIVA
        // dell'autopilota invece che da fermo: senza questo la fisica del
        // tick successivo ripartirebbe da p.speed = 0 nonostante l'auto
        // stesse viaggiando un istante prima (Rif. richiesta utente
        // 2026-08-08). p.angle punta già nel verso di marcia.
        p.speed = PIT_AUTO_SPEED;
        p.vx = Math.sin(p.angle) * PIT_AUTO_SPEED;
        p.vz = Math.cos(p.angle) * PIT_AUTO_SPEED;
        const sid = game.socketByColor[p.color];
        if (sid) io.to(sid).emit('f1PitLaneExited');
    }
```

- [ ] **Step 6: Aggiornare il balzo finale e la ripartenza in uscita**

Nel blocco `if (p.pitBoxFinalApproach && p.pitBoxAnchor)` in testa a `updatePitAutopilot`, il target di uscita passa dai punti di controllo alla lane:

```js
        // 'exiting': balzo inverso, dallo stallo verso un punto della corsia
        // POCO PIU' AVANTI del proprio box — non il waypoint di controllo
        // successivo, che sulla lane campionata non esiste più. Un box con
        // laneIdx prima del vertice condiviso deve comunque rientrare in
        // avanti, mai indietro.
        const rejoinIdx = Math.min(track.pitLanePts.length - 1,
                                   p.pitBoxAnchor.laneIdx + PIT_REJOIN_LEAD_SAMPLES);
        const target = (p.pitAutoState === 'entering')
            ? {
                x: p.pitBoxAnchor.stallX != null ? p.pitBoxAnchor.stallX : p.pitBoxAnchor.x,
                z: p.pitBoxAnchor.stallZ != null ? p.pitBoxAnchor.stallZ : p.pitBoxAnchor.z
            }
            : track.pitLanePts[rejoinIdx];
```

con la costante accanto a `PIT_AUTO_SPEED`:

```js
// Quanti campioni della corsia avanti al proprio box far rientrare l'auto in
// uscita: ~10 unità con 300 campioni sulle corsie esistenti. Rientrare sul
// campione del box stesso farebbe ripartire il walk da fermo, di traverso.
const PIT_REJOIN_LEAD_SAMPLES = 10;
```

E in `completePitStop`, la riga che riarma il walk:

```js
    p.pitBoxFinalApproach = true;
    // Waypoint della lane campionata da cui riprende il walk normale dopo il
    // rientro dallo stallo (vedi PIT_REJOIN_LEAD_SAMPLES in updatePitAutopilot).
    p.pitPathIndex = Math.min(game.track.pitLanePts.length - 1,
                              p.pitBoxAnchor.laneIdx + PIT_REJOIN_LEAD_SAMPLES);
```

Infine, in `startPitLaneEntry`, il commento "Riparte dal waypoint 1" va aggiornato: `p.pitPathIndex = 1` resta valido (il campione 1 della lane è a ~1 unità dal punto di distacco), ma il commento deve dire che l'indice è ora sui campioni, non sui punti di controllo.

- [ ] **Step 7: Eseguire i test — devono passare**

Run: `node --test backend/sockets/games/f1GameSocket.physics.test.js`
Expected: PASS, incluso il nuovo test. **I test preesistenti dell'autopilota usano fixture con `pitPath` sintetico e senza `pitLanePts`**: vanno aggiornati costruendo la fixture con `pitLanePts: TrackGeometry.sampleOpenPath(pitPath, 300)` e aggiungendo `laneIdx` agli anchor. Non indebolire le loro asserzioni: verificano comportamenti reali già corretti (niente "avanti e poi indietro", niente sfioramento fra auto).

- [ ] **Step 8: Eseguire l'intera suite backend**

Run: `node --test backend/sockets/games/*.test.js`
Expected: PASS su tutti.

- [ ] **Step 9: Gate utente**

Far verificare in localhost una sosta completa: entrando ai box l'auto deve restare al centro della corsia per tutto il tragitto, senza tagliare le curve né avvicinarsi ai muretti, e senza procedere a scatti. Verificare anche l'uscita.

---

### Task 7 (FASE F): orizzonte chiuso da colline e boschi

**Files:**
- Create: `frontend/shared/sceneryHills.js`
- Create: `frontend/shared/sceneryHills.test.js`
- Modify: `frontend/shared/trackMeshBuilder.js` (`buildGround`)
- Modify: `frontend/shared/trackScenery.js` (boschi)
- Modify: `frontend/shared/trackScenery.test.js`
- Modify: `frontend/f1.js` (nebbia), `frontend/f1.html`

**Interfaces:**
- Produces: `SceneryHills.hillHeightAt(x, z, distFromTrack, embankOuter) -> number` — quota del terreno collinare in quel punto (0 dentro o subito fuori dal terrapieno). `distFromTrack` è la distanza dal tracciato, che il chiamante ha già calcolato (`TrackGeometry.nearestPoint(groundPts, x, z).dist`): non si ricalcola qui, sarebbe la parte costosa ripetuta due volte.
- Produces: `SceneryHills.HILL_START_MARGIN`, `SceneryHills.HILL_RAMP`, `SceneryHills.HILL_MAX_HEIGHT`.

- [ ] **Step 1: Scrivere i test**

Creare `frontend/shared/sceneryHills.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const SceneryHills = require('./sceneryHills.js');

const EMBANK_OUTER = 60;

test('dentro il terrapieno il terreno resta piatto', () => {
    // Se le colline partissero prima, spingerebbero in alto il prato dove si
    // corre davvero e taglierebbero la pista.
    assert.equal(SceneryHills.hillHeightAt(0, 0, 10, EMBANK_OUTER), 0);
    assert.equal(SceneryHills.hillHeightAt(0, 0, EMBANK_OUTER, EMBANK_OUTER), 0);
});

test('la quota cresce allontanandosi dal tracciato', () => {
    const start = EMBANK_OUTER + SceneryHills.HILL_START_MARGIN;
    const near = SceneryHills.hillHeightAt(500, 500, start + 40, EMBANK_OUTER);
    const far = SceneryHills.hillHeightAt(500, 500, start + SceneryHills.HILL_RAMP, EMBANK_OUTER);
    assert.ok(far > near, `lontano ${far.toFixed(1)} non supera vicino ${near.toFixed(1)}`);
});

test('la quota non supera mai il massimo dichiarato', () => {
    for (let i = 0; i < 500; i++) {
        const h = SceneryHills.hillHeightAt(i * 37, i * -53, EMBANK_OUTER + 400, EMBANK_OUTER);
        assert.ok(h <= SceneryHills.HILL_MAX_HEIGHT, `quota ${h} oltre il massimo`);
        assert.ok(h >= 0, `quota negativa ${h}`);
    }
});

// Deterministico: la stessa pista deve dare le stesse colline ad ogni
// caricamento, altrimenti mesh del terreno e alberi (generati da due moduli
// diversi) finirebbero su rilievi diversi.
test('hillHeightAt è deterministica', () => {
    const a = SceneryHills.hillHeightAt(123.5, -876.25, 300, EMBANK_OUTER);
    const b = SceneryHills.hillHeightAt(123.5, -876.25, 300, EMBANK_OUTER);
    assert.equal(a, b);
});

// Il rilievo deve variare da un punto all'altro: una rampa liscia si legge
// come una ciotola, non come colline.
test('la quota varia fra punti diversi alla stessa distanza', () => {
    const d = EMBANK_OUTER + SceneryHills.HILL_START_MARGIN + 150;
    const values = [];
    for (let i = 0; i < 40; i++) values.push(SceneryHills.hillHeightAt(i * 80, i * 45, d, EMBANK_OUTER));
    const min = Math.min(...values), max = Math.max(...values);
    assert.ok(max - min > 5, `variazione di sole ${(max - min).toFixed(1)} unità: rilievo troppo uniforme`);
});
```

- [ ] **Step 2: Eseguire — devono fallire**

Run: `node --test frontend/shared/sceneryHills.test.js`
Expected: FAIL con `Cannot find module './sceneryHills.js'`.

- [ ] **Step 3: Implementare `sceneryHills.js`**

```js
// frontend/shared/sceneryHills.js
//
// Quota del terreno collinare che chiude l'orizzonte oltre il terrapieno.
//
// Vive in un modulo a sé perché serve a DUE consumatori che devono essere
// d'accordo al centimetro: trackMeshBuilder.buildGround, che disegna la
// mesh, e trackScenery, che ci pianta sopra gli alberi dei boschi. Se le due
// quote divergessero, gli alberi risulterebbero sepolti o sospesi in aria.
// Modulo puro, nessuna dipendenza da Three.js.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SceneryHills = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Le colline iniziano BEN oltre il bordo del terrapieno: la fascia in
    // mezzo è quella dove si finisce davvero uscendo di pista, e deve
    // restare piana e leggibile.
    const HILL_START_MARGIN = 120;
    // Distanza su cui la quota sale dal piano al massimo. Ripida abbastanza
    // da chiudere la vista, non tanto da sembrare un muro.
    const HILL_RAMP = 300;
    // Altezza massima. La tribuna principale è alta 12.3 e la torre di
    // direzione 33.7: le colline devono superarle per chiudere l'orizzonte
    // dietro di esse.
    const HILL_MAX_HEIGHT = 55;

    // Rumore deterministico da coordinate: hash intero delle celle + bilineare
    // fra i quattro angoli, sommato su due frequenze. Non serve un Perlin
    // vero — a queste dimensioni la differenza non si vede, e questo non ha
    // dipendenze né tabelle da inizializzare.
    function hash2(ix, iz) {
        let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1);
        h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
        h ^= h >>> 12;
        return (h >>> 0) / 4294967296;
    }

    function valueNoise(x, z, cell) {
        const fx = x / cell, fz = z / cell;
        const ix = Math.floor(fx), iz = Math.floor(fz);
        const tx = fx - ix, tz = fz - iz;
        // Smoothstep sui pesi: senza, le celle si leggono come losanghe.
        const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
        const a = hash2(ix, iz), b = hash2(ix + 1, iz);
        const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
        return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
    }

    // distFromTrack lo passa il chiamante: è la parte costosa (nearestPoint su
    // 1000 punti) e chi chiama questa funzione l'ha già calcolata per altri
    // motivi. Ricalcolarla qui la pagherebbe due volte per ogni cella.
    function hillHeightAt(x, z, distFromTrack, embankOuter) {
        const start = embankOuter + HILL_START_MARGIN;
        if (distFromTrack <= start) return 0;
        const t = Math.min(1, (distFromTrack - start) / HILL_RAMP);
        const ramp = t * t * (3 - 2 * t);   // parte dolce dal piano, non a scalino
        // Due frequenze: crinali larghi + irregolarità minute.
        const n = valueNoise(x, z, 260) * 0.7 + valueNoise(x, z, 90) * 0.3;
        return ramp * HILL_MAX_HEIGHT * (0.35 + 0.65 * n);
    }

    return { hillHeightAt, HILL_START_MARGIN, HILL_RAMP, HILL_MAX_HEIGHT };
});
```

- [ ] **Step 4: Eseguire — devono passare**

Run: `node --test frontend/shared/sceneryHills.test.js`
Expected: PASS su tutti e 5.

- [ ] **Step 5: Alzare le celle del prato lontano**

In `frontend/shared/trackMeshBuilder.js`, dentro `buildGround`, sostituire il doppio ciclo che emette i quad. Le celle diventano gradoni con le pareti laterali: senza le pareti, due celle a quote diverse lasciano una fessura verticale da cui si vede attraverso il terreno.

```js
        // Prima passata: quota di ogni cella tenuta. Serve completa PRIMA di
        // emettere la geometria, perché le pareti verticali di una cella si
        // dimensionano sulla quota delle vicine.
        const cellY = new Map();
        const key = (cx, cz) => cx + ',' + cz;
        for (let cx = 0; cx < cols; cx++) {
            for (let cz = 0; cz < rows; cz++) {
                const x0 = minX + cx * GROUND_GRID_CELL, z0 = minZ + cz * GROUND_GRID_CELL;
                const cxCenter = x0 + GROUND_GRID_CELL / 2, czCenter = z0 + GROUND_GRID_CELL / 2;
                // Leggermente aggressivo (embankOuter - metà cella): meglio
                // una cella che sovrappone un po' il terrapieno (stesso
                // colore, invisibile) che una fessura scoperta al bordo.
                const d = TrackGeometry.nearestPoint(groundPts, cxCenter, czCenter).dist;
                if (d < embankOuter - GROUND_GRID_CELL / 2) continue;
                cellY.set(key(cx, cz), SceneryHills.hillHeightAt(cxCenter, czCenter, d, embankOuter));
            }
        }

        // Seconda passata: piano superiore della cella + pareti verticali
        // verso le vicine più basse. Il risultato è un rilievo a gradoni —
        // coerente con l'estetica voxel del progetto, e una sola mesh come
        // prima: nessuna draw call in più rispetto al prato piatto.
        for (const [k, y] of cellY) {
            const [cx, cz] = k.split(',').map(Number);
            const x0 = minX + cx * GROUND_GRID_CELL, x1 = x0 + GROUND_GRID_CELL;
            const z0 = minZ + cz * GROUND_GRID_CELL, z1 = z0 + GROUND_GRID_CELL;

            let base = pos.length / 3;
            pos.push(x0, y, z0,  x1, y, z0,  x1, y, z1,  x0, y, z1);
            idx.push(base, base + 1, base + 2,  base, base + 2, base + 3);

            // Una parete per lato, alta fino alla quota della vicina (0 se la
            // vicina non esiste: è il bordo verso il terrapieno o verso il
            // prato lontano, e la parete va comunque chiusa fino a terra).
            const neighbours = [
                { dx: 0, dz: -1, a: [x0, z0], b: [x1, z0] },
                { dx: 1, dz: 0,  a: [x1, z0], b: [x1, z1] },
                { dx: 0, dz: 1,  a: [x1, z1], b: [x0, z1] },
                { dx: -1, dz: 0, a: [x0, z1], b: [x0, z0] },
            ];
            for (const nb of neighbours) {
                const ny = cellY.has(key(cx + nb.dx, cz + nb.dz)) ? cellY.get(key(cx + nb.dx, cz + nb.dz)) : 0;
                if (ny >= y - 0.01) continue;   // la vicina è più alta o pari: nessuna fessura da chiudere
                base = pos.length / 3;
                pos.push(nb.a[0], y, nb.a[1],  nb.b[0], y, nb.b[1],
                         nb.b[0], ny, nb.b[1], nb.a[0], ny, nb.a[1]);
                idx.push(base, base + 1, base + 2,  base, base + 2, base + 3);
            }
        }
```

Il materiale ha già `side: THREE.DoubleSide`, quindi l'orientamento delle pareti non è critico.

Aggiungere `SceneryHills` alle dipendenze UMD di `trackMeshBuilder.js` (entrambi i rami, `require` e `root.`).

- [ ] **Step 6: Piantare i boschi sulle colline**

In `frontend/shared/trackScenery.js`, aggiungere le costanti accanto a quelle della natura:

```js
    // Boschi che chiudono la vista oltre il terrapieno. Distinti dallo
    // scatter di NATURE_*, che riempie la fascia vicino alla pista: qui gli
    // alberi stanno in MACCHIE (un centro, alberi fitti attorno), perché uno
    // scatter uniforme su un'area così grande dà un prato spennacchiato, non
    // un bosco — è il tentativo che era già stato bocciato.
    const WOOD_CLUSTERS      = 26;   // macchie per tracciato
    const WOOD_PER_CLUSTER   = 11;   // alberi tentati per macchia
    const WOOD_CLUSTER_RADIUS = 34;
    const WOOD_MIN_SPACING   = 6;
    // Tetto complessivo, sopra i ~240 alberi di NATURE_*: a 700 totali il
    // gioco scattava anche in localhost (vedi il commento di NATURE_ATTEMPTS).
    // Da allora gli alberi sono esclusi dalle ombre, che di quel calo erano
    // la causa vera, ma il tetto resta esplicito.
    const WOOD_MAX_TREES     = 300;
```

e la funzione, chiamata da `generateLayout` **dopo** `buildNatureLayout` (così le macchie vedono gli alberi vicini alla pista fra gli oggetti già accettati):

```js
    // Alberi fitti sulle colline e sulla fascia che le precede: è ciò che
    // chiude l'orizzonte, insieme al rilievo del terreno. La quota viene da
    // SceneryHills, LO STESSO modulo che genera la mesh del terreno in
    // trackMeshBuilder: se le due quote divergessero, gli alberi
    // risulterebbero sepolti o sospesi in aria.
    function buildWoodsLayout(rng, trackPts, embankOuter, accepted) {
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const hillStart = embankOuter + SceneryHills.HILL_START_MARGIN;
        const outer = hillStart + SceneryHills.HILL_RAMP;
        const { xMin, xMax, zMin, zMax } = trackBounds(trackPts, outer);

        for (let c = 0; c < WOOD_CLUSTERS && layout.length < WOOD_MAX_TREES; c++) {
            const cxp = xMin + rng() * (xMax - xMin);
            const czp = zMin + rng() * (zMax - zMin);
            // Il centro della macchia deve cadere nella fascia collinare: le
            // macchie estratte più vicine alla pista si scartano invece di
            // spostarle, così la distribuzione resta uniforme.
            const dCenter = TrackGeometry.nearestPoint(groundPts, cxp, czp).dist;
            if (dCenter < embankOuter + 20) continue;

            for (let k = 0; k < WOOD_PER_CLUSTER && layout.length < WOOD_MAX_TREES; k++) {
                const a = rng() * Math.PI * 2;
                const r = Math.sqrt(rng()) * WOOD_CLUSTER_RADIUS;   // sqrt: distribuzione uniforme sul disco
                const x = cxp + Math.cos(a) * r, z = czp + Math.sin(a) * r;
                const d = TrackGeometry.nearestPoint(groundPts, x, z).dist;
                if (d < embankOuter + 20) continue;
                if (isTooCloseToAny(accepted, x, z, WOOD_MIN_SPACING)) continue;

                const asset = weightedPick(rng, NATURE_ASSETS);
                const y = SceneryHills.hillHeightAt(x, z, d, embankOuter);
                const tree = { asset, category: 'nature', x, y, z,
                               rotY: rng() * Math.PI * 2, scale: NATURE_SCALE[asset] };
                layout.push(tree);
                accepted.push(tree);
            }
        }
        return layout;
    }
```

In `generateLayout`, dopo `const nature = ...`:

```js
        const woods = buildWoodsLayout(rng, trackPts, embankOuter, accepted);
```

e aggiungere `...woods` all'array `layout` finale. Aggiungere `SceneryHills` alle dipendenze UMD di `trackScenery.js` (entrambi i rami).

- [ ] **Step 7: Scrivere il test dei boschi**

In `frontend/shared/trackScenery.test.js`:

```js
const SceneryHills = require('./sceneryHills.js');

test('i boschi restano sotto il tetto di istanze e stanno lontani dalla pista', () => {
    const { layout, trackPts } = layoutFor(prova);
    const trees = layout.filter(i => i.category === 'nature');
    assert.ok(trees.length > 260, `solo ${trees.length} alberi: i boschi non sono stati generati`);
    assert.ok(trees.length <= 560, `${trees.length} alberi: oltre il tetto, rischio frame rate`);

    const barrierD = prova.roadHalfWidth + 2.8 + 1.2;
    const groundPts = trackPts.filter(p => !p.bridge);
    for (const t of trees) {
        const d = TrackGeometry.nearestPoint(groundPts, t.x, t.z).dist;
        assert.ok(d >= barrierD, `albero a ${d.toFixed(1)} dal centro pista: dentro le barriere`);
        // La quota deve essere quella del rilievo, non 0 piatto: un albero
        // sulla collina con y = 0 resta sepolto.
        if (d > barrierD + 45 + SceneryHills.HILL_START_MARGIN + 60) {
            assert.ok(t.y > 0, `albero sulla collina a quota 0 (distanza ${d.toFixed(0)}): finirebbe sepolto`);
        }
    }
});
```

- [ ] **Step 8: Allineare nebbia e cielo**

In `frontend/f1.js`, sostituire le due righe:

```js
    // Il colore della nebbia DEVE essere quello del cielo: con due tinte
    // diverse (nebbia 0xadd8e6 contro cielo 0x87CEEB) la linea di stacco fra
    // prato e cielo resta leggibile e la mappa sembra infinita — è
    // esattamente ciò che l'utente ha segnalato. Densità abbassata da 0.0022
    // a 0.0016: a 0.0022 la nebbia era già al 99% a 1000 unità, cioè le
    // colline sarebbero sparite prima di vedersi (camera.far è 1200).
    const SKY_COLOR = 0x87CEEB;
    scene.background = new THREE.Color(SKY_COLOR);
    scene.fog = new THREE.FogExp2(SKY_COLOR, 0.0016);
```

- [ ] **Step 9: Eseguire tutti i test**

Run: `node --test frontend/shared/*.test.js`
Expected: PASS su tutti.

- [ ] **Step 10: Registrare il nuovo script e bumpare**

In `frontend/f1.html`, aggiungere `<script src="shared/sceneryHills.js?v=20260809a"></script>` **prima** di `trackMeshBuilder.js` e `trackScenery.js` (entrambi ne dipendono), e bumpare `trackMeshBuilder.js`, `trackScenery.js`, `f1.js`.

- [ ] **Step 11: Gate utente**

Far verificare in localhost: la vista è chiusa da colline boscose in ogni direzione, non c'è più il taglio netto prato/cielo, gli alberi poggiano sul rilievo (nessuno sepolto o sospeso), e il frame rate regge. `HILL_MAX_HEIGHT`, `HILL_START_MARGIN` e `WOOD_MAX_TREES` sono le tre manopole da ritarare qui, in base a quello che l'utente vede.

---

### Task 8 (FASE G): asset modellati e mai usati

**Files:**
- Modify: `frontend/shared/sceneryTrackside.js`
- Modify: `frontend/shared/sceneryTrackside.test.js`
- Modify: `frontend/shared/pitBoxLoader.js`
- Modify: `frontend/f1.js` (path dei meccanici)
- Modify: `frontend/f1.html`

**Interfaces:**
- Produces: `PitBoxLoader.crewPlacements(placement) -> [{ asset, x, y, z, rotY }]` — posizioni dei meccanici davanti a un box, in coordinate mondo. `placement` è lo stesso oggetto `{ x, y, z, rotY }` già passato a `loadPitBoxModel`.

- [ ] **Step 1: Scrivere il test del decoro paddock — deve fallire**

In `frontend/shared/sceneryTrackside.test.js`. Oggi `pylon` e `flagPole` hanno **zero** istanze su tutti e tre i tracciati:

```js
const prova = require('../tracks/prova.json');
const newMonza = require('../tracks/new-monza.json');

function ctxFor(track) {
    const trackPts = TrackGeometry.sampleLoop(track.controlPoints, 1000);
    const pitPts = TrackGeometry.sampleOpenPath(track.pit.path, 300);
    const barrierD = track.roadHalfWidth + 2.8 + 1.2;
    let a = 12345;
    const rng = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    return {
        trackPts, pitPts, barrierDist: barrierD, embankOuter: barrierD + 45,
        pitRoadHalf: track.pit.roadHalfWidth, mainSide: 1, rng,
        playerBoxFootprints: [], insidePlayerBoxFootprint: () => false, grandstands: [],
    };
}

for (const track of [prova, monteRosso, newMonza]) {
    test(`${track.id}: il decoro del paddock viene davvero generato`, () => {
        const items = SceneryTrackside.buildTrackside(ctxFor(track));
        for (const asset of ['pylon', 'flagPole', 'paddockTent']) {
            const n = items.filter(i => i.asset === asset).length;
            assert.ok(n > 0, `nessun ${asset}: l'asset è modellato ma non compare in gioco`);
        }
    });
}
```

- [ ] **Step 2: Eseguire — deve fallire**

Run: `node --test frontend/shared/sceneryTrackside.test.js`
Expected: FAIL con `nessun pylon` e `nessun flagPole` su tutti e tre i tracciati.

- [ ] **Step 3: Usare gli offset di ripiego già dichiarati**

In `frontend/shared/sceneryTrackside.js`, sostituire il ciclo del `decorPlan`:

```js
        // Decoro del paddock vicino al traguardo, sul lato corsia box.
        //
        // Tre offset in cascata invece di uno solo: alla collocazione
        // nominale (barrierDist + 14) questi oggetti cadono sistematicamente
        // dentro la corsia box o dentro un box giocatore e venivano scartati
        // tutti — pylon e flagPole avevano ZERO istanze su tutti e tre i
        // tracciati, cioè erano modellati e mai visti in gioco. Le due
        // costanti di ripiego erano già dichiarate qui sotto ma non le usava
        // nessuna riga di codice.
        const decorOffsets = [PADDOCK_DECOR_MARGIN, MAIN_STAND_CLEAR_OFFSET, PADDOCK_FAR_OFFSET];
        for (const d of decorPlan) {
            const w = TrackGeometry.walkClosedLoop(trackPts, 0, d.at);
            for (const off of decorOffsets) {
                const pos = place(trackPts, groundPts, w.fromIdx, barrierDist + off,
                                  -mainSide, barrierDist, embankOuter);
                if (!usable(d.asset, pos.x, pos.z, pos.y, pitRoadHalf + 8)) continue;
                layout.push(Object.assign({ asset: d.asset, category: 'paddock-decor', scale: 1 }, pos));
                break;   // piazzato: non si prova il ripiego successivo
            }
        }
```

- [ ] **Step 4: Eseguire — deve passare**

Run: `node --test frontend/shared/sceneryTrackside.test.js`
Expected: PASS su tutti e tre i tracciati.

Se un asset resta a zero su una pista, il problema non è l'offset ma il punto del giro (`d.at`): stampare quale filtro lo scarta per tutti e tre gli offset **prima** di aggiungere un quarto offset.

- [ ] **Step 5: Scrivere il test dei meccanici**

In `frontend/shared/pitBoxLoader.test.js`:

```js
test('i meccanici stanno davanti al box, verso lo stallo', () => {
    // Box a (0,0) col fronte verso +Z: i meccanici devono stare fra il box e
    // la corsia, cioè a z positivo, non dentro il garage né dietro.
    const crew = PitBoxLoader.crewPlacements({ x: 0, y: 0, z: 0, rotY: 0 });
    assert.ok(crew.length >= 2, `solo ${crew.length} meccanici`);
    for (const c of crew) {
        assert.ok(['pitCrew', 'pitCrewKneel'].includes(c.asset), `asset inatteso ${c.asset}`);
        assert.ok(c.z > 0, `meccanico dentro o dietro al box (z = ${c.z})`);
        assert.ok(Math.hypot(c.x, c.z) < 20, `meccanico troppo lontano dal box`);
    }
});
```

- [ ] **Step 6: Eseguire — deve fallire**

Run: `node --test frontend/shared/pitBoxLoader.test.js`
Expected: FAIL con `PitBoxLoader.crewPlacements is not a function`.

- [ ] **Step 7: Implementare `crewPlacements`**

In `frontend/shared/pitBoxLoader.js`, prima del `return`, e aggiungere `crewPlacements` all'oggetto esportato:

```js
    // Meccanici davanti al box. Sono modellati (pitCrew, pitCrewKneel) ma non
    // erano cablati da nessuna parte: senza di loro il box è un garage vuoto.
    // Posizioni in coordinate MONDO, ricavate dalla posizione del box e dalla
    // sua rotazione (il fronte guarda +Z locale, convenzione di tutto il
    // catalogo custom).
    //
    // Restano statici: l'animazione è fuori scope, i modelli non sono
    // animabili così come sono (vedi la nota in testa a
    // backend/tools/circuitAssets/people.py).
    const CREW_LAYOUT = [
        { asset: 'pitCrewKneel', lx: -2.6, lz: 5.5 },   // al muso, lato sinistro
        { asset: 'pitCrewKneel', lx: 2.6,  lz: 5.5 },
        { asset: 'pitCrew',      lx: -3.4, lz: 8.5 },   // ai lati dello stallo
        { asset: 'pitCrew',      lx: 3.4,  lz: 8.5 },
        { asset: 'pitCrew',      lx: 0,    lz: 3.0 },   // sotto il portale del box
    ];

    function crewPlacements(placement) {
        const cos = Math.cos(placement.rotY || 0), sin = Math.sin(placement.rotY || 0);
        return CREW_LAYOUT.map((c) => ({
            asset: c.asset,
            // Stessa trasformazione applicata da THREE.Object3D.rotation.y,
            // identica a quella di sceneryCrowd.js per i posti in tribuna.
            x: placement.x + c.lx * cos + c.lz * sin,
            z: placement.z - c.lx * sin + c.lz * cos,
            y: placement.y || 0,
            // Guardano nella stessa direzione del box, cioè verso la corsia.
            rotY: placement.rotY || 0,
        }));
    }
```

La firma prende solo `placement`: l'anchor non serve, perché la rotazione del box porta già l'informazione su dove sia la corsia.

- [ ] **Step 8: Caricare i meccanici in scena**

In `frontend/f1.js`, dentro `loadPlayerPitBox`, dopo la creazione della segnaletica dello stallo:

```js
        // Meccanici davanti al box: caricati una volta per box, come modelli
        // indipendenti (non InstancedMesh: sono pochi, cinque per box, e
        // seguono il caricamento asincrono del box stesso).
        for (const crew of PitBoxLoader.crewPlacements({ x: bx, y: 0, z: bz, rotY })) {
            const loader = new THREE.GLTFLoader();
            loader.load(`/assets/custom/circuit/${crew.asset}.glb`, (gltf) => {
                gltf.scene.position.set(crew.x, crew.y, crew.z);
                gltf.scene.rotation.y = crew.rotY;
                gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
                scene.add(gltf.scene);
            }, undefined, (err) => console.error(`[F1] Errore caricando ${crew.asset}.glb:`, err));
        }
```

Questo blocco va **dentro** la guardia `stallMarkersAdded` esistente (o accanto a una guardia analoga): senza, ogni `f1StateUpdate` aggiungerebbe cinque meccanici nuovi allo stesso box.

- [ ] **Step 9: Eseguire tutti i test**

Run: `node --test frontend/shared/*.test.js backend/sockets/games/*.test.js backend/tools/*.test.js`
Expected: PASS su tutti. Il numero totale di test deve essere cresciuto rispetto all'inizio del piano.

- [ ] **Step 10: Bump del cache-busting e gate utente finale**

In `frontend/f1.html`: bumpare `shared/sceneryTrackside.js?v=`, `shared/pitBoxLoader.js?v=`, `f1.js?v=`.

Far verificare in localhost una partita completa: bandiere, pylon e tende sono visibili nel paddock; i meccanici sono davanti ai box, orientati verso la corsia, non dentro il garage né sopra l'auto ferma.

- [ ] **Step 11: Aggiornare `docs/f1-notes.md`**

Nella sezione "Asset voxel del circuito", aggiungere un paragrafo su: la catena `advanceToDistance` come criterio di composizione delle file (tribuna e box), il test SAT `SceneryAssetSizes.overlaps` come regola per le strutture, `sceneryHills.js` come fonte unica della quota collinare per mesh e alberi, e il fatto che l'autopilota box cammina su `track.pitLanePts` (campionati) e non più sui punti di controllo. Senza questa nota, chi tornerà su questo codice dovrà ricostruire la mappa da zero — è già successo.

---

## Note per chi esegue

- **Se un test "sistemato" continua a fallire su una sola pista**, non allentare l'asserzione: quella pista ha una geometria che le altre non hanno (il traguardo in curva di `prova`, la corsia box lunga di `monte-rosso`, il rettilineo da 400 unità di `new-monza`). È esattamente il caso che il test deve proteggere.
- **Nessun task può dichiararsi finito senza aver eseguito i comandi di test** e letto l'output. Il progetto ha una storia documentata di fix dichiarati risolti sulla base di un unit test scritto su misura dopo il fix, che non riproduceva la condizione reale.
- **Il gate utente in localhost è vincolante**: il server lo avvia l'utente, e nessuna fase prosegue senza la sua approvazione.
