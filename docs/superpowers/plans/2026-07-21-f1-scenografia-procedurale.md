# F1 — scenografia procedurale intorno al circuito Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generare automaticamente, alla costruzione di ogni mappa F1, scenografia intorno al circuito — natura sparsa, tribune distribuite col relativo pubblico, e una zona paddock (tende/banner/pylon) vicino a partenza e corsia box — senza posizionare nulla a mano nei JSON dei tracciati.

**Architecture:** Un nuovo modulo puro `frontend/shared/trackScenery.js` (stesso pattern IIFE/dual-export di `trackGeometry.js`) calcola un layout deterministico (seedato dall'id del tracciato) di oggetti scenici usando gli stessi punti campionati (`trackPts`/`pitPts`) già usati da `TrackMeshBuilder`. `frontend/f1.js` consuma quel layout e istanzia i modelli `.glb` (via `THREE.InstancedMesh` per gli asset ripetuti) o una mesh procedurale per il laghetto.

**Tech Stack:** Vanilla JS, Three.js r128 (`GLTFLoader`, `InstancedMesh`), `node:test` per i test del modulo puro, asset Kenney CC0 (Racing Kit, Nature Kit, Mini Characters).

## Global Constraints

- Italiano nei commenti e nei messaggi di log.
- Nessuna modifica al backend/fisica: la scenografia è puramente visiva.
- Nessuna modifica a `track-editor.js`.
- Nessuna modifica ai JSON dei tracciati esistenti (`monte-rosso.json`, `monza.json`, `interlagos.json`).
- **Nessun commit automatico, di nessun tipo** (vedi CLAUDE.md del progetto: "non committare/pushare senza richiesta"). Tutti i task lavorano solo sulla working tree; l'utente decide quando e come committare/pushare.
- CC0 per tutti gli asset nuovi: nessuna attribuzione richiesta.

---

## Riferimenti utili

- Spec: `docs/superpowers/specs/2026-07-21-f1-scenografia-procedurale-design.md`
- `frontend/shared/trackGeometry.js` — espone `sampleLoop`, `sampleOpenPath`, `lapLength`, `normalAt`, `nearestPoint` (usati pesantemente in questo piano).
- `frontend/shared/trackMeshBuilder.js` — pattern di riferimento per un modulo IIFE che consuma `TrackGeometry`.
- `frontend/f1.js` righe 77-107 — caricamento tracciato e costruzione mesh esistente, punto di innesto.
- `frontend/f1.html` righe 113-118 — ordine di caricamento script.
- L'algoritmo di questo piano (funzioni, costanti, soglie) è stato **prototipato e verificato** con `node` contro i tre tracciati reali prima di scrivere questo documento: nessuna violazione di distanza, layout deterministico, conteggio tribune nel range [6,10] su tutti e tre (Monte Rosso 6, Monza 8, Interlagos 10).

---

### Task 1: Scaricare i nuovi asset Kenney (Nature Kit + Mini Characters)

**Files:**
- Create: `frontend/assets/kenney/plant_bush.glb`
- Create: `frontend/assets/kenney/plant_bushLarge.glb`
- Create: `frontend/assets/kenney/rock_largeA.glb`
- Create: `frontend/assets/kenney/rock_smallA.glb`
- Create: `frontend/assets/kenney/tent_smallClosed.glb`
- Create: `frontend/assets/kenney/character-male-a.glb`

**Interfaces:**
- Produces: 6 nuovi file `.glb` in `frontend/assets/kenney/`, serviti staticamente da Express esattamente come i 23 già presenti (nessuna modifica al backend necessaria: la cartella `frontend/assets/` è già servita staticamente, come dimostra l'uso esistente di `/assets/kenney/raceCarWhite.glb`).

- [ ] **Step 1: Scaricare gli zip ufficiali Kenney (CC0) ed estrarre solo i file necessari**

Run (dalla root del repository):

```bash
mkdir -p tmp-kenney-download
curl -sL -A "Mozilla/5.0" -o tmp-kenney-download/nature-kit.zip "https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip"
curl -sL -A "Mozilla/5.0" -o tmp-kenney-download/mini-characters.zip "https://kenney.nl/media/pages/assets/mini-characters/bfc7e272b4-1774770718/kenney_mini-characters.zip"
unzip -j -o tmp-kenney-download/nature-kit.zip \
  "Models/GLTF format/plant_bush.glb" \
  "Models/GLTF format/plant_bushLarge.glb" \
  "Models/GLTF format/rock_largeA.glb" \
  "Models/GLTF format/rock_smallA.glb" \
  "Models/GLTF format/tent_smallClosed.glb" \
  -d frontend/assets/kenney/
unzip -j -o tmp-kenney-download/mini-characters.zip \
  "Models/GLB format/character-male-a.glb" \
  -d frontend/assets/kenney/
rm -rf tmp-kenney-download
```

Expected: nessun errore da `curl`/`unzip`. Entrambi gli zip sono CC0 (Kenney), licenza pubblica, nessuna attribuzione richiesta.

- [ ] **Step 2: Verificare che i 6 file siano presenti e non vuoti**

Run: `ls -la frontend/assets/kenney/ | grep -E "plant_bush|rock_(large|small)A|tent_smallClosed|character-male-a"`

Expected: 6 righe, tutte con dimensione in byte maggiore di zero (indicativamente qualche KB ciascuna).

- [ ] **Step 3: Nessun commit**

Regola di progetto (vedi CLAUDE.md): nessun commit automatico. I 6 file restano nella working tree/untracked; sarà l'utente a decidere quando e come committarli.

---

### Task 2: Modulo puro `trackScenery.js` — generazione layout deterministica

**Files:**
- Create: `frontend/shared/trackScenery.js`
- Create: `frontend/shared/trackScenery.test.js`
- Test: `frontend/shared/trackScenery.test.js` (stesso file, eseguito con `node --test`)

**Interfaces:**
- Consumes: `TrackGeometry` da `frontend/shared/trackGeometry.js` — `sampleLoop`, `sampleOpenPath`, `lapLength(points)`, `normalAt(points, i, closed)` → `{nx, nz}`, `nearestPoint(points, x, z)` → `{x, y, z, index, dist}`.
- Produces: `TrackScenery.generateLayout(trackData, trackPts, pitPts, barrierDist)` → array di oggetti `{ asset, category, x, y, z, rotY, scale }` (le voci `category: 'pond'` hanno `radius` invece di `asset`/`rotY`/`scale`). `TrackScenery.hashString(str)` → uint32. `TrackScenery.mulberry32(seed)` → funzione `() => number` in `[0,1)`. Usato da Task 3 (`f1.js`).

- [ ] **Step 1: Scrivere i test (falliranno: il modulo non esiste ancora)**

Crea `frontend/shared/trackScenery.test.js`:

```js
// frontend/shared/trackScenery.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const TrackGeometry = require('./trackGeometry.js');
const TrackScenery = require('./trackScenery.js');
const monteRosso = require('../tracks/monte-rosso.json');

const ROAD_HALF = monteRosso.roadHalfWidth;
const BARRIER_D = ROAD_HALF + 2.8 + 1.2; // stessa formula di frontend/f1.js (CURB_W=2.8)

function buildReal() {
    const trackPts = TrackGeometry.sampleLoop(monteRosso.controlPoints, 1000);
    const pitPts   = TrackGeometry.sampleOpenPath(monteRosso.pit.path, 300);
    return { trackPts, pitPts };
}

test('generateLayout è deterministico: stesso trackData → stesso layout', () => {
    const { trackPts, pitPts } = buildReal();
    const a = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const b = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    assert.deepEqual(a, b);
});

test('generateLayout produce layout diverso per un id tracciato diverso', () => {
    const { trackPts, pitPts } = buildReal();
    const a = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const other = { ...monteRosso, id: 'altro-tracciato' };
    const b = TrackScenery.generateLayout(other, trackPts, pitPts, BARRIER_D);
    assert.notDeepEqual(a, b);
});

test('ogni oggetto natura resta fuori dal corridoio pista e corsia box', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const pitRoadHalf = monteRosso.pit.roadHalfWidth;
    const nature = layout.filter(i => i.category === 'nature');
    assert.ok(nature.length > 0);
    for (const item of nature) {
        const dTrack = TrackGeometry.nearestPoint(trackPts, item.x, item.z).dist;
        const dPit   = TrackGeometry.nearestPoint(pitPts, item.x, item.z).dist;
        assert.ok(dTrack >= BARRIER_D + 4 - 1e-6, `oggetto natura troppo vicino alla pista: ${dTrack}`);
        assert.ok(dPit >= pitRoadHalf + 5 - 1e-6, `oggetto natura troppo vicino alla corsia box: ${dPit}`);
    }
});

test('gli oggetti natura rispettano la distanza minima reciproca', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const nature = layout.filter(i => i.category === 'nature');
    for (let i = 0; i < nature.length; i++) {
        for (let j = i + 1; j < nature.length; j++) {
            const d = Math.hypot(nature[i].x - nature[j].x, nature[i].z - nature[j].z);
            assert.ok(d >= 7 - 1e-6, `due oggetti natura troppo vicini: ${d}`);
        }
    }
});

test('le tribune sono tra 6 e 10 e ognuna ha 10 personaggi associati', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const grandstands = layout.filter(i => i.category === 'grandstand');
    const crowd = layout.filter(i => i.category === 'crowd');
    assert.ok(grandstands.length >= 6 && grandstands.length <= 10, `numero tribune fuori range: ${grandstands.length}`);
    assert.equal(crowd.length, grandstands.length * 10);
});

test('se presente, il laghetto rispetta la distanza minima dagli altri oggetti', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const pond = layout.find(i => i.category === 'pond');
    if (!pond) return; // non garantito per design, vedi spec
    for (const item of layout) {
        if (item === pond) continue;
        const d = Math.hypot(pond.x - item.x, pond.z - item.z);
        assert.ok(d >= 16 - 1e-6, `laghetto troppo vicino a un altro oggetto: ${d}`);
    }
});

test('hashString è deterministico e mulberry32 produce valori in [0,1)', () => {
    const h1 = TrackScenery.hashString('monte-rosso');
    const h2 = TrackScenery.hashString('monte-rosso');
    assert.equal(h1, h2);
    const rng = TrackScenery.mulberry32(h1);
    for (let i = 0; i < 100; i++) {
        const v = rng();
        assert.ok(v >= 0 && v < 1, `valore fuori range: ${v}`);
    }
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: FAIL — `Cannot find module './trackScenery.js'`

- [ ] **Step 3: Implementare `frontend/shared/trackScenery.js`**

```js
// frontend/shared/trackScenery.js
//
// Genera un layout deterministico di oggetti scenici (natura, tribune con
// pubblico, zona paddock) intorno a un tracciato F1, usando gli stessi
// punti campionati (trackPts/pitPts) di TrackMeshBuilder. Modulo puro,
// nessuna dipendenza da Three.js: chi lo consuma (frontend/f1.js) decide
// come renderizzare ogni voce del layout.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./trackGeometry.js'));
    else root.TrackScenery = factory(root.TrackGeometry);
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry) {

    // Hash FNV-1a 32 bit di una stringa: seed deterministico dall'id del
    // tracciato, così lo stesso tracciato genera sempre lo stesso layout
    // (tracciati diversi → layout diversi ma stabili nel tempo).
    function hashString(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return h >>> 0;
    }

    // PRNG mulberry32: veloce, seedabile, sufficiente per uno scatter
    // visivo (non serve crittografico).
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function weightedPick(rng, weighted) {
        const total = weighted.reduce((s, w) => s + w.weight, 0);
        let r = rng() * total;
        for (const w of weighted) {
            r -= w.weight;
            if (r <= 0) return w.asset;
        }
        return weighted[weighted.length - 1].asset;
    }

    // Ruota un offset locale (lx, lz) di theta radianti attorno a Y, con la
    // stessa convenzione di rotation.y usata altrove nel progetto (vedi
    // buildStartLine in trackMeshBuilder.js: forward locale (0,0,1) ruotato
    // di theta punta a (sin(theta), cos(theta)) in mondo).
    function rotateY(lx, lz, theta) {
        const s = Math.sin(theta), c = Math.cos(theta);
        return { x: lx * c + lz * s, z: -lx * s + lz * c };
    }

    // Scala degli asset Racing Kit (tribune/pylon/bandiere): stessa usata
    // per raceCarWhite in loadCarModel (frontend/f1.js) — stesso pack
    // Kenney, stessa unità di partenza, preserva le proporzioni relative
    // auto/tribuna/pylon. Gli asset di Nature Kit/Mini Characters sono pack
    // diversi: partono da scala 1, da tarare a occhio in localhost.
    const RACING_KIT_SCALE = 3.5;

    const NATURE_ASSETS = [
        { asset: 'treeLarge',       weight: 4, scale: 1 },
        { asset: 'treeSmall',       weight: 4, scale: 1 },
        { asset: 'rock_largeA',     weight: 2, scale: 1 },
        { asset: 'rock_smallA',     weight: 2, scale: 1 },
        { asset: 'plant_bush',      weight: 3, scale: 1 },
        { asset: 'plant_bushLarge', weight: 2, scale: 1 },
    ];
    const NATURE_SCALE = Object.fromEntries(NATURE_ASSETS.map(a => [a.asset, a.scale]));

    const NATURE_ATTEMPTS     = 500;  // candidati casuali provati per lo scatter natura
    const NATURE_MIN_MARGIN   = 4;    // oltre barrierDist: distanza minima dalla pista
    const NATURE_MAX_MARGIN   = 70;   // oltre barrierDist: distanza massima dalla pista
    const NATURE_MIN_SPACING  = 7;    // tra due oggetti natura
    const STRUCTURE_CLEARANCE = 18;   // natura vs tribune/paddock
    const PIT_NATURE_MARGIN   = 5;    // oltre pitRoadHalf

    const GRANDSTAND_OFFSET_MARGIN = 6;  // oltre barrierDist
    const GRANDSTAND_PIT_MARGIN    = 20; // oltre pitRoadHalf: evita di piazzare tribune sopra la corsia box
    const CROWD_ROWS = 2, CROWD_COLS = 5, CROWD_COL_SPACING = 2.2, CROWD_ROW_DEPTH = 1.5, CROWD_FRONT_OFFSET = 2.0;

    const START_WINDOW_LEN       = 60;  // lunghezza d'arco totale intorno alla partenza
    const START_SPACING          = 12;
    const PADDOCK_MARGIN         = 5;   // oltre barrierDist, per pylon/bandiere partenza
    const PIT_TENT_OFFSET_MARGIN = 6;   // oltre pitRoadHalf
    const PIT_TENT_STEP_SAMPLES  = 25;

    const POND_RADIUS    = 9;
    const POND_ATTEMPTS  = 60;
    const POND_CLEARANCE = 16;

    function isTooCloseToAny(accepted, x, z, ownSpacing) {
        for (const p of accepted) {
            const spacing = p.category === 'nature' ? Math.max(ownSpacing, NATURE_MIN_SPACING) : STRUCTURE_CLEARANCE;
            const dx = x - p.x, dz = z - p.z;
            if (dx * dx + dz * dz < spacing * spacing) return true;
        }
        return false;
    }

    // Zona paddock: banner/pylon lungo il rettilineo di partenza (finestra
    // fissa intorno a trackPts[0], stesso punto usato da buildStartLine) +
    // tende lungo la corsia box. Nessun PRNG: posizioni deterministiche a
    // intervalli fissi, area "propria" non condivisa con lo scatter natura.
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
                layout.push({ asset, category: 'paddock', x, y: p.y || 0, z, rotY, scale: RACING_KIT_SCALE });
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
            layout.push({ asset: 'tent_smallClosed', category: 'paddock', x, y: p.y || 0, z, rotY, scale: 1 });
        }

        return layout;
    }

    // Tribune distribuite a intervalli regolari lungo il giro, alternando
    // lato sinistro/destro. Se lo slot calcolato cade troppo vicino alla
    // corsia box (o a una tribuna già piazzata), si cerca il punto valido
    // più vicino scorrendo avanti/indietro lungo il tracciato invece di
    // scartare subito la tribuna — un circuito con una corsia box lunga
    // (es. Monte Rosso) altrimenti perderebbe troppe tribune invece di
    // limitarsi a spostarle di qualche metro.
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
            const stand = { asset: 'grandStandCovered', category: 'grandstand', x, y: p.y || 0, z, rotY, scale: RACING_KIT_SCALE };
            layout.push(stand);
            accepted.push(stand);

            for (let row = 0; row < CROWD_ROWS; row++) {
                for (let col = 0; col < CROWD_COLS; col++) {
                    const lx = (col - (CROWD_COLS - 1) / 2) * CROWD_COL_SPACING;
                    const lz = CROWD_FRONT_OFFSET + row * CROWD_ROW_DEPTH;
                    const off = rotateY(lx, lz, rotY);
                    layout.push({
                        asset: 'character-male-a', category: 'crowd',
                        x: x + off.x, y: p.y || 0, z: z + off.z, rotY, scale: 1
                    });
                }
            }
        }
        return layout;
    }

    function trackBounds(trackPts, barrierDist) {
        const minXZ = { x: Infinity, z: Infinity };
        const maxXZ = { x: -Infinity, z: -Infinity };
        for (const p of trackPts) {
            minXZ.x = Math.min(minXZ.x, p.x); maxXZ.x = Math.max(maxXZ.x, p.x);
            minXZ.z = Math.min(minXZ.z, p.z); maxXZ.z = Math.max(maxXZ.z, p.z);
        }
        const pad = barrierDist + NATURE_MAX_MARGIN;
        return { xMin: minXZ.x - pad, xMax: maxXZ.x + pad, zMin: minXZ.z - pad, zMax: maxXZ.z + pad };
    }

    // Scatter tipo Poisson-disc (rejection sampling): candidati casuali
    // uniformi nel riquadro attorno al tracciato, filtrati per restare in
    // una fascia libera fuori dal corridoio pista/box e a distanza minima
    // dagli altri oggetti già accettati (di qualunque categoria).
    function buildNatureLayout(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted) {
        const layout = [];
        const { xMin, xMax, zMin, zMax } = trackBounds(trackPts, barrierDist);

        for (let i = 0; i < NATURE_ATTEMPTS; i++) {
            const x = xMin + rng() * (xMax - xMin);
            const z = zMin + rng() * (zMax - zMin);

            const dTrack = TrackGeometry.nearestPoint(trackPts, x, z);
            if (dTrack.dist < barrierDist + NATURE_MIN_MARGIN) continue;
            if (dTrack.dist > barrierDist + NATURE_MAX_MARGIN) continue;
            if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitRoadHalf + PIT_NATURE_MARGIN) continue;
            if (isTooCloseToAny(accepted, x, z, NATURE_MIN_SPACING)) continue;

            const asset = weightedPick(rng, NATURE_ASSETS);
            const point = { asset, category: 'nature', x, y: dTrack.y, z, rotY: rng() * Math.PI * 2, scale: NATURE_SCALE[asset] };
            layout.push(point);
            accepted.push(point);
        }
        return layout;
    }

    // Tentativo singolo (non garantito) di piazzare un laghetto: cerca un
    // punto con un raggio libero sufficiente attorno; se non lo trova entro
    // il budget di tentativi, nessun laghetto su questo tracciato.
    function findPondSpot(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted) {
        const { xMin, xMax, zMin, zMax } = trackBounds(trackPts, barrierDist);

        for (let i = 0; i < POND_ATTEMPTS; i++) {
            const x = xMin + rng() * (xMax - xMin);
            const z = zMin + rng() * (zMax - zMin);

            const dTrack = TrackGeometry.nearestPoint(trackPts, x, z);
            if (dTrack.dist < barrierDist + NATURE_MIN_MARGIN + POND_RADIUS) continue;
            if (dTrack.dist > barrierDist + NATURE_MAX_MARGIN) continue;
            if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitRoadHalf + PIT_NATURE_MARGIN + POND_RADIUS) continue;
            if (isTooCloseToAny(accepted, x, z, POND_CLEARANCE)) continue;

            return { category: 'pond', x, y: dTrack.y, z, radius: POND_RADIUS };
        }
        return null;
    }

    // trackData: JSON del tracciato (serve trackData.id per il seed e
    // trackData.pit.roadHalfWidth). trackPts/pitPts: punti già campionati
    // (TrackGeometry.sampleLoop/sampleOpenPath), stessi usati da
    // TrackMeshBuilder. barrierDist: distanza barriera dal centro pista
    // (BARRIER_D in f1.js).
    function generateLayout(trackData, trackPts, pitPts, barrierDist) {
        const rng = mulberry32(hashString(trackData.id));
        const pitRoadHalf = trackData.pit.roadHalfWidth;

        const paddock  = buildPaddockLayout(trackPts, pitPts, barrierDist, pitRoadHalf);
        const accepted = [...paddock];
        const grandstand = buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted);

        const nature = buildNatureLayout(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted);
        const pond   = findPondSpot(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted);

        const layout = [...paddock, ...grandstand, ...nature];
        if (pond) layout.push(pond);
        return layout;
    }

    return { generateLayout, hashString, mulberry32 };
});
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: `# pass 7`, `# fail 0`

- [ ] **Step 5: Nessun commit**

Regola di progetto (vedi CLAUDE.md): nessun commit automatico. I file restano nella working tree/untracked; sarà l'utente a decidere quando e come committarli.

---

### Task 3: Integrazione in `f1.js` — caricamento e rendering della scenografia

**Files:**
- Modify: `frontend/f1.html:113-118` (aggiungere script tag)
- Modify: `frontend/f1.js:77-107` (calcolo pitPts + chiamata generateLayout + rendering)

**Interfaces:**
- Consumes: `TrackScenery.generateLayout(trackData, trackPts, pitPts, barrierDist)` da Task 2. `THREE.GLTFLoader`, `THREE.InstancedMesh`, `THREE.CircleGeometry` (già disponibili globalmente in `f1.js`, r128).
- Produces: nessuna nuova interfaccia pubblica — effetto visivo diretto sulla `scene` esistente.

- [ ] **Step 1: Aggiungere lo script tag in `f1.html`**

In `frontend/f1.html`, modifica le righe 116-118 da:

```html
    <script src="shared/trackGeometry.js"></script>
    <script src="shared/trackMeshBuilder.js"></script>
    <script src="f1.js"></script>
```

a:

```html
    <script src="shared/trackGeometry.js"></script>
    <script src="shared/trackMeshBuilder.js"></script>
    <script src="shared/trackScenery.js"></script>
    <script src="f1.js"></script>
```

- [ ] **Step 2: Campionare `pitPts` e generare il layout in `f1.js`**

In `frontend/f1.js`, subito dopo la riga (attuale numerazione):

```js
    const N_SAMPLES = 1000;
    const trackPts  = TrackGeometry.sampleLoop(trackData.controlPoints, N_SAMPLES);
```

aggiungi:

```js
    // Stessi punti campionati usati internamente da TrackMeshBuilder.buildPitLane
    // (che li ricalcola per conto suo): un secondo ricalcolo qui è economico
    // (300 campioni, una tantum al caricamento) e serve per generare la
    // scenografia senza toccare la firma di buildPitLane.
    const PIT_PTS = TrackGeometry.sampleOpenPath(trackData.pit.path, 300);
```

Poi, subito dopo la riga esistente:

```js
    TrackMeshBuilder.buildPitLane(scene, PIT_PATH, trackData.pit.roadHalfWidth, trackData.pit.boxIndex);
```

aggiungi la chiamata alla generazione e al caricamento:

```js
    // ====================================================
    // SCENOGRAFIA PROCEDURALE — natura, tribune con pubblico, zona paddock.
    // Layout deterministico (seed = trackData.id, vedi trackScenery.js):
    // stesso tracciato → stessa disposizione ad ogni caricamento.
    // ====================================================
    const sceneryLayout = TrackScenery.generateLayout(trackData, trackPts, PIT_PTS, BARRIER_D);
    loadScenery(scene, sceneryLayout);
```

- [ ] **Step 3: Implementare `loadScenery` in `f1.js`**

Subito prima della dichiarazione `const loader = new THREE.GLTFLoader();` (sezione "LOADER GLB"), aggiungi:

```js
    // ====================================================
    // SCENOGRAFIA — caricamento asset e istanziazione dal layout generato
    // da TrackScenery.generateLayout. Ogni asset ripetuto (natura, folla)
    // usa un unico THREE.InstancedMesh per tenere basse le draw call anche
    // con centinaia di istanze; il laghetto (categoria 'pond', nessun asset
    // scaricato: il Nature Kit non ne include uno) è una mesh procedurale,
    // stesso approccio già usato per il prato di sfondo qui sopra.
    // ====================================================
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

    function loadScenery(container, layout) {
        const sceneryLoader = new THREE.GLTFLoader();
        const byAsset = new Map();
        for (const item of layout) {
            if (item.category === 'pond') continue;
            if (!byAsset.has(item.asset)) byAsset.set(item.asset, []);
            byAsset.get(item.asset).push(item);
        }

        const dummy = new THREE.Object3D();
        for (const [asset, items] of byAsset) {
            const url = SCENERY_ASSET_PATHS[asset];
            sceneryLoader.load(url, (gltf) => {
                gltf.scene.updateMatrixWorld(true);
                const meshes = [];
                gltf.scene.traverse((child) => { if (child.isMesh) meshes.push(child); });

                for (const mesh of meshes) {
                    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material.clone(), items.length);
                    im.castShadow    = true;
                    im.receiveShadow = true;
                    const localMatrix = mesh.matrixWorld;

                    items.forEach((it, i) => {
                        dummy.position.set(it.x, it.y || 0, it.z);
                        dummy.rotation.set(0, it.rotY || 0, 0);
                        dummy.scale.setScalar(it.scale || 1);
                        dummy.updateMatrix();
                        const finalMatrix = new THREE.Matrix4().multiplyMatrices(dummy.matrix, localMatrix);
                        im.setMatrixAt(i, finalMatrix);
                    });
                    im.instanceMatrix.needsUpdate = true;
                    container.add(im);
                }
            }, undefined, (err) => console.error(`[F1] Errore caricando asset scenografia "${asset}":`, err));
        }

        for (const item of layout) {
            if (item.category !== 'pond') continue;
            const pond = new THREE.Mesh(
                new THREE.CircleGeometry(item.radius, 24),
                new THREE.MeshStandardMaterial({ color: 0x2f6fa8, roughness: 0.35, metalness: 0.05 })
            );
            pond.rotation.x = -Math.PI / 2;
            pond.position.set(item.x, (item.y || 0) + 0.03, item.z);
            pond.receiveShadow = true;
            container.add(pond);
        }
    }
```

- [ ] **Step 4: Verifica manuale in localhost (nessun test automatico: codice di rendering Three.js, stessa convenzione di `loadCarModel` che non ha test unitari)**

Avvia il server (`node server.js` dalla cartella `backend/`), apri `localhost:3000`, entra in una lobby ed avvia una partita F1 su ciascuno dei tre tracciati (`monte-rosso`, `monza`, `interlagos`, selezionabili in lobby). Per ognuno:

1. Verificare in console del browser (F12) che non ci siano errori di caricamento asset (nessun log `[F1] Errore caricando asset scenografia`).
2. Percorrere un giro e osservare: alberi/rocce/cespugli sparsi nel terreno esterno alla pista, nessuno sovrapposto a pista/cordoli/barriere/corsia box.
3. Verificare che le tribune (con pubblico) siano distribuite su entrambi i lati del circuito, non concentrate in un solo punto.
4. Verificare che la zona di partenza e la corsia box abbiano un aspetto "paddock" (pylon/bandiere/tende) distinto dal resto del perimetro.
5. Se presente, verificare che il laghetto non si sovrapponga a nessun altro oggetto.
6. Ricaricare la stessa pista (refresh) e confermare che la disposizione resta identica; cambiare pista e confermare che cambia.
7. Controllo prestazioni a occhio: nessun calo di framerate percepibile, anche con 2+ tab aperte in multiplayer.
8. Se qualche asset appare visibilmente troppo piccolo/grande o mal posizionato in verticale (floating/affondato), annotare quale (`ASSET_SCALE`/offset `y` in `trackScenery.js` sono pensati come punto di partenza da tarare, esattamente come altri valori "da tarare a orecchio" già presenti nel codebase, es. `ENGINE_VOLUME_MULT`).

- [ ] **Step 5: Nessun commit**

Regola di progetto (vedi CLAUDE.md): nessun commit automatico. I file restano modificati nella working tree; sarà l'utente a decidere quando e come committarli.

---

## Note per l'esecutore

- I tre task sono sequenziali: Task 3 usa sia gli asset di Task 1 sia il modulo di Task 2, quindi vanno eseguiti in ordine.
- Se durante la verifica manuale (Task 3, Step 4) un asset risultasse fuori scala o posizionato in modo innaturale, il fix è un aggiustamento dei valori in `ASSET_SCALE`/`NATURE_SCALE`/offset `y` dentro `trackScenery.js` — non richiede di toccare l'algoritmo di piazzamento.
- Nessun push automatico: al termine dei tre task, i commit restano locali finché l'utente non decide di pushare.
