# F1 — L'anteprima esplorabile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** entrare nella pista che si sta disegnando e volarci dentro, vedendo esattamente gli oggetti che ci saranno in gara.

**Architecture:** la sequenza che costruisce la scena di gioco esce da `f1.js` e diventa `frontend/shared/f1Scena.js`, usata da entrambi. L'anteprima è una pagina propria con camera libera, senza auto né luci né stile toon.

**Tech Stack:** JS vanilla UMD, Three.js r128 (già in uso), `node --test` nativo.

**Spec:** `docs/superpowers/specs/2026-08-24-f1-anteprima-esplorabile-design.md`

## Global Constraints

- **La scena non si duplica**: chi vuole costruirla chiama `F1Scena.costruisciCircuito`. Una seconda sequenza di chiamate a `TrackMeshBuilder` da qualche altra parte è il difetto che questo progetto esiste per impedire.
- **Il confine dell'estrazione** è `buildStartingGrid`: da lì in poi comincia lo stile cel-shaded, che resta in `f1.js`.
- **Italiano** in commenti, nomi e messaggi.
- I moduli in `frontend/shared/` sono UMD; questo può usare `THREE` (lo prende dal global come `trackMeshBuilder.js`), ma **non** il DOM.
- Test: `node --test frontend/shared/` — baseline **5 rossi** (4 preesistenti + `nuova-pista`); `node --test backend/` — baseline **8 rossi**.
- Bump del `?v=` in ogni pagina che carica un `.js` toccato.
- Commit per task, file aggiunti per nome.

---

## File Structure

| File | Responsabilità |
|---|---|
| `frontend/shared/f1Scena.js` (nuovo) | Parametri derivati + sequenza di costruzione del circuito. Restituisce ciò che serve a chi chiama. |
| `frontend/shared/f1Scena.test.js` (nuovo) | Caratterizzazione: la sequenza di chiamate e i parametri, su ogni pista. |
| `frontend/shared/sceneryAssetPaths.js` (nuovo) | La tabella asset → file `.glb`, unica. |
| `frontend/f1.js` (modifica) | Usa il modulo al posto delle righe 490-710; lo stile resta suo. |
| `frontend/track-preview.html` (nuovo) | La vista esplorabile: scena, asset, camera libera. |
| `frontend/track-preview.js` (nuovo) | Costruzione + volo + ponte con l'editor. |
| `frontend/track-editor.js` (modifica) | Il tasto «Esplora». |

---

### Task 1: Il modulo che costruisce il circuito

**Files:**
- Create: `frontend/shared/f1Scena.js`
- Test: `frontend/shared/f1Scena.test.js`

**Interfaces:**
- Produces: `F1Scena.costruisciCircuito(scene, trackData, opzioni)` → Promise di
  `{ trackPts, groundPts, pitPath, pitPts, barrierProfile, embankPlateau, embankOuter, startFinishIndex, mesheTerreno, mesheSuperfici, roadHalf, curbW, barrierDist, embankmentStart, pitMergeSamples }`
- `opzioni`: `{ gridSize = 6, builder, passo, respira }` — `builder` serve ai test (di default `TrackMeshBuilder`), `passo(testo, frazione)` e `respira()` sono la barra di caricamento del gioco e sono facoltativi.

- [ ] **Step 1: Scrivere il test di caratterizzazione**

```javascript
// frontend/shared/f1Scena.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Il modulo crea materiali: in Node THREE non c'è, e non serve — la sequenza
// e i parametri sono ciò che va protetto, non il colore dell'asfalto.
global.THREE = {
    MeshStandardMaterial: function (p) { Object.assign(this, p || {}); },
    DoubleSide: 2,
};
const F1Scena = require('./f1Scena.js');
const ROOT = path.join(__dirname, '..', '..');
const PISTE = require('fs').readdirSync(path.join(ROOT, 'frontend/tracks'))
    .filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));

// Un TrackMeshBuilder finto che scrive quello che gli chiedono invece di
// costruirlo: è così che si verifica una SEQUENZA.
//
// ⚠️ Non è solo comodo, è NECESSARIO: il TrackMeshBuilder vero usa `window` e
// in Node non si carica nemmeno (verificato). Il modulo lo prende dal global
// nel browser e dal chiamante nei test.
function builderChePrendeNota(registro) {
    const nomi = ['buildGround', 'buildEmbankment', 'buildBridgeDecks', 'buildRibbon',
                  'buildCurbs', 'buildGravel', 'buildBarriers', 'buildStartLine',
                  'buildPitLane', 'buildStartingGrid'];
    const finto = {};
    for (const nome of nomi) {
        finto[nome] = (...args) => {
            // Gli argomenti che contano sono i numeri: le funzioni e gli array
            // di punti si riassumono, altrimenti il test diventa illeggibile.
            registro.push(nome + '(' + args.slice(1).map(a =>
                typeof a === 'number' ? a.toFixed(2)
                : typeof a === 'function' ? 'fn'
                : Array.isArray(a) ? 'punti[' + a.length + ']'
                : a && typeof a === 'object' ? 'oggetto'
                : String(a)).join(', ') + ')');
        };
    }
    return finto;
}

const scenaFinta = () => ({ children: [], add() { this.children.push({}); } });

test('la sequenza di costruzione è quella del gioco, nell ordine del gioco', async () => {
    const trackData = require(path.join(ROOT, 'frontend/tracks/prova.json'));
    const registro = [];
    await F1Scena.costruisciCircuito(scenaFinta(), trackData,
        { builder: builderChePrendeNota(registro), gridSize: 6 });

    // L'ordine RIFLETTE LA SEZIONE REALE della pista: terreno, poi asfalto,
    // poi cordolo, poi ghiaia, poi barriera. Cambiarlo cambia cosa si vede.
    assert.deepEqual(registro.map(r => r.split('(')[0]), [
        'buildGround', 'buildEmbankment', 'buildBridgeDecks',
        'buildRibbon', 'buildCurbs', 'buildGravel', 'buildBarriers',
        'buildStartLine', 'buildPitLane', 'buildStartingGrid',
    ]);
});

test('i parametri derivati valgono quelli di oggi', async () => {
    const trackData = require(path.join(ROOT, 'frontend/tracks/prova.json'));
    const c = await F1Scena.costruisciCircuito(scenaFinta(), trackData,
        { builder: builderChePrendeNota([]), gridSize: 6 });
    assert.equal(c.roadHalf, trackData.roadHalfWidth);
    assert.equal(c.curbW, 2.8);
    assert.equal(c.embankmentStart, trackData.roadHalfWidth + 2.8);
    assert.equal(c.barrierDist, trackData.roadHalfWidth + 2.8 + 1.2);
    assert.equal(c.trackPts.length, 1000, 'il gioco campiona a 1000');
    assert.ok(c.embankOuter > c.embankPlateau, 'la rampa sta oltre il pianoro');
    assert.ok(c.groundPts.length <= c.trackPts.length, 'i punti a terra escludono i ponti');
});

test('ogni pista si costruisce senza esplodere', async () => {
    for (const id of PISTE) {
        const trackData = require(path.join(ROOT, 'frontend/tracks', id + '.json'));
        const registro = [];
        await F1Scena.costruisciCircuito(scenaFinta(), trackData,
            { builder: builderChePrendeNota(registro), gridSize: 6 });
        assert.equal(registro.length, 10, `${id}: attese 10 chiamate, fatte ${registro.length}`);
    }
});

test('la barra di caricamento è facoltativa, e viene chiamata se c è', async () => {
    const trackData = require(path.join(ROOT, 'frontend/tracks/prova.json'));
    const passi = [];
    let respiri = 0;
    await F1Scena.costruisciCircuito(scenaFinta(), trackData, {
        builder: builderChePrendeNota([]), gridSize: 6,
        passo: (testo, frazione) => passi.push(frazione),
        respira: async () => { respiri++; },
    });
    assert.ok(passi.length >= 2, 'il gioco vuole sapere a che punto è');
    assert.ok(respiri >= 2, 'e vuole poter respirare fra un blocco e l altro');
});
```

- [ ] **Step 2: Eseguirli e vederli fallire**

Run: `node --test frontend/shared/f1Scena.test.js`
Expected: FAIL — `Cannot find module './f1Scena.js'`

- [ ] **Step 3: Scrivere il modulo**

Il corpo è il **trasporto letterale** delle righe 490-710 di `frontend/f1.js`: stessi calcoli, stesso ordine, stessi commenti (che spiegano decisioni pagate in playtest e non vanno persi). Le uniche differenze:

- i parametri non sono `const` del modulo ma proprietà dell'oggetto restituito;
- `TrackMeshBuilder` arriva da `opzioni.builder` (default: il globale);
- `caricamento.passo(...)` / `await caricamento.respira()` diventano `passo(...)` / `await respira()`, entrambi facoltativi;
- il blocco `for (const m of scene.children.slice(_primaDellAsfalto)) applicaStile(...)` **non entra**: al suo posto le mesh delle superfici finiscono in `mesheSuperfici`, e chi vuole stilizzarle lo fa fuori.

```javascript
// frontend/shared/f1Scena.js
//
// LA SCENA DEL CIRCUITO, costruita una volta sola per chiunque la voglia.
//
// Prima queste righe stavano dentro f1.js, in mezzo alla partita: quindici
// chiamate a TrackMeshBuilder e quattordici parametri calcolati fra una e
// l'altra. Chiunque altro volesse la stessa scena — l'anteprima esplorabile,
// domani un generatore di immagini — doveva ricopiarle, e una copia diverge.
// Rif. docs/superpowers/specs/2026-08-24-f1-anteprima-esplorabile-design.md
//
// ⚠️ IL CONFINE È `buildStartingGrid`: da lì in poi comincia lo stile
// cel-shaded, che è del gioco e non di questa funzione. Le mesh che vanno
// stilizzate a parte (prato e superfici) vengono restituite, non convertite.
//
// Usa THREE per i materiali, come trackMeshBuilder.js; niente DOM.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'), require('./trackGravel.js'),
                                 require('./trackScenery.js'), require('./toonPalette.js'));
    } else {
        root.F1Scena = factory(root.TrackGeometry, root.TrackGravel, root.TrackScenery, root.ToonPalette);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, TrackGravel, TrackScenery, ToonPalette) {

    // Il global, per arrivare a TrackMeshBuilder senza richiederlo (vedi sotto).
    const glob = typeof self !== 'undefined' ? self
        : (typeof globalThis !== 'undefined' ? globalThis : {});

    const CURB_W = 2.8;
    const EMBANKMENT_WIDTH = 45;
    const N_SAMPLES = 1000;

    async function costruisciCircuito(scene, trackData, opzioni) {
        const o = opzioni || {};
        // ⚠️ TrackMeshBuilder NON si può richiedere qui: usa `window` e in Node
        // esplode all'import (verificato: «window is not defined»). Quindi si
        // prende dal global quando si è nel browser, e nei test lo passa il
        // chiamante — che è anche ciò che rende verificabile la sequenza.
        const builder = o.builder || glob.TrackMeshBuilder;
        if (!builder) throw new Error('TrackMeshBuilder non disponibile: caricalo prima di f1Scena');
        const passo = o.passo || function () {};
        const respira = o.respira || (async function () {});
        const gridSize = o.gridSize || 6;

        const roadHalf = trackData.roadHalfWidth;
        const barrierDist = roadHalf + CURB_W + 1.2;
        // Il terrapieno parte dal bordo ESTERNO del cordolo, non dalla
        // barriera: fra i due c'è una fascia di 1.2 unità che altrimenti
        // resterebbe scoperta e mostrerebbe il cielo di sfondo.
        const embankmentStart = roadHalf + CURB_W;

        const trackPts = TrackGeometry.sampleLoop(trackData.controlPoints, N_SAMPLES);
        // Aggancia il primo/ultimo punto della corsia al bordo pista vero, con
        // la stessa funzione che usa il server: il disegno corrisponde alla
        // posizione fisica reale dell'auto in uscita dai box.
        const pitPath = TrackGeometry.snapPitPathEnds(trackData.pit.path, trackPts, roadHalf);
        const pitPts = TrackGeometry.tuckPitEndsToTrack(
            TrackGeometry.sampleOpenPath(pitPath, 300), trackPts);

        // ⚠️ PRIMA del terreno: il pianoro deve arrivare fino alla barriera, e
        // dov'è la barriera lo decide questo profilo.
        const barrierProfile = TrackGravel.barrierProfile(trackPts, {
            roadHalf, curbW: CURB_W,
            pitLanePts: pitPts,
            pitRoadHalf: trackData.pit.roadHalfWidth,
        });
        const embankPlateau = TrackScenery.embankmentStart(barrierProfile, embankmentStart);
        const embankOuter = embankPlateau + EMBANKMENT_WIDTH;

        passo('Terreno e dislivelli…', 0.20);
        await respira();

        const primaDelPrato = scene.children.length;
        builder.buildGround(scene, trackPts, embankOuter, 3000);
        const mesheTerreno = scene.children.slice(primaDelPrato);
        builder.buildEmbankment(scene, trackPts, embankmentStart, embankPlateau, embankOuter);
        // Punti "a terra": servono ai piloni dei cavalcavia e alla quota
        // visiva fuori pista. Calcolati una volta sola.
        const groundPts = trackPts.filter(p => !p.bridge);
        builder.buildBridgeDecks(scene, trackPts, groundPts, roadHalf + CURB_W,
            embankmentStart, embankPlateau, embankOuter,
            (i, lato) => TrackGravel.barrierAt(barrierProfile, i, lato));

        // Il varco del cordolo e della barriera si apre dove passa la corsia
        // box, e solo lì: la regola sta in TrackGravel, così il varco disegnato
        // e quello fisico del server non possono divergere.
        const pitMergeSamples = TrackGravel.pitGapSamples(pitPts);

        passo('Asfalto, cordoli e barriere…', 0.30);
        await respira();

        const primaDelleSuperfici = scene.children.length;
        // DoubleSide: evita artefatti di culling nelle zone ad alta curvatura.
        builder.buildRibbon(scene, trackPts, roadHalf, new THREE.MeshStandardMaterial({
            color: ToonPalette.SURFACES.asphalt, roughness: 0.95, side: THREE.DoubleSide }));
        builder.buildCurbs(scene, trackPts, roadHalf, CURB_W, pitMergeSamples);
        // La ghiaia dopo il cordolo e prima della barriera: l'ordine riflette
        // la sezione reale della pista.
        builder.buildGravel(scene, trackPts, roadHalf, CURB_W, barrierProfile.gravel);
        const mesheSuperfici = scene.children.slice(primaDelleSuperfici);

        // Il piede della barriera va posato sul TERRENO, non sulla quota della
        // pista: in curva mentre si sale i settori del terrapieno si
        // accavallano, e quello più avanti seppellirebbe la barriera.
        builder.buildBarriers(scene, trackPts,
            (i, side) => TrackGravel.barrierAt(barrierProfile, i, side),
            pitMergeSamples,
            (i, bx, bz) => TrackGeometry.terrainTopAt(trackPts, i, bx, bz, embankPlateau));
        builder.buildStartLine(scene, trackPts, roadHalf);
        builder.buildPitLane(scene, pitPath, trackData.pit.roadHalfWidth, trackData.pit.boxIndex,
            false, trackPts, ToonPalette.SURFACES.asphalt, roadHalf, CURB_W);

        const startFinishIndex = trackData.startFinish
            ? TrackGeometry.nearestPoint(trackPts, trackData.startFinish.x, trackData.startFinish.z).index
            : 0;
        builder.buildStartingGrid(scene, trackPts, startFinishIndex, gridSize);

        return {
            trackPts, groundPts, pitPath, pitPts, barrierProfile,
            embankPlateau, embankOuter, startFinishIndex,
            mesheTerreno, mesheSuperfici,
            roadHalf, curbW: CURB_W, barrierDist, embankmentStart, pitMergeSamples,
        };
    }

    return { costruisciCircuito, CURB_W, EMBANKMENT_WIDTH, N_SAMPLES };
});
```

- [ ] **Step 4: Eseguire i test**

Run: `node --test frontend/shared/f1Scena.test.js`
Expected: PASS, 4 test.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/f1Scena.js frontend/shared/f1Scena.test.js
git commit -m "La scena del circuito esce da f1.js e diventa una funzione sola"
```

---

### Task 2: Il gioco usa il modulo

**Files:**
- Modify: `frontend/f1.js:490-710`, `frontend/f1.html` (bump `?v=` e caricamento del modulo)

⚠️ Questo task tocca il gioco. La rete di sicurezza è il test del Task 1 (la sequenza) più una verifica a occhio in localhost: la pista deve essere identica.

- [ ] **Step 1: Caricare il modulo in `f1.html`**, dopo `trackScenery.js` (ne dipende):

```html
<script src="shared/f1Scena.js?v=20260824a"></script>
```

- [ ] **Step 2: Sostituire il blocco in `f1.js`.** Al posto delle righe che vanno da `const ROAD_HALF = trackData.roadHalfWidth;` fino a `TrackMeshBuilder.buildStartingGrid(...)`:

```javascript
    const circuito = await F1Scena.costruisciCircuito(scene, trackData, {
        gridSize,
        passo: (testo, frazione) => caricamento.passo(testo, frazione),
        respira: () => caricamento.respira(),
    });
    const {
        trackPts, groundPts, pitPath: PIT_PATH, pitPts: PIT_PTS,
        barrierProfile: BARRIER_PROFILE, embankPlateau: EMBANK_PLATEAU,
        embankOuter: EMBANK_OUTER, startFinishIndex: START_FINISH_INDEX,
        roadHalf: ROAD_HALF, curbW: CURB_W, barrierDist: BARRIER_D,
        embankmentStart: EMBANKMENT_START, pitMergeSamples: PIT_MERGE_SAMPLES,
    } = circuito;
    const mesheTerreno = circuito.mesheTerreno;

    // Le superfici che di notte stanno SOTTO le torri faro — asfalto, cordoli,
    // ghiaia — prendono la tinta dei tratti illuminati invece di quella del
    // buio: è il nastro chiaro che taglia la notte. La conversione generale
    // più sotto le salta, perché convert() tocca solo i MeshStandardMaterial.
    for (const m of circuito.mesheSuperfici) {
        applicaStile(m, {
            saturation: ToonPalette.SATURATION.world,
            tintaNotte: ToonPalette.orario().tintaPista,
            guadagnoNotte: ToonPalette.orario().guadagnoPista,
        });
    }
```

⚠️ `trackPitchAt`, `minimapTransform` e tutto ciò che sta in mezzo a quelle righe **resta in `f1.js`**: non fa parte della costruzione della scena. Spostare la dichiarazione di `trackPitchAt` sotto il blocco se serve `trackPts`.

- [ ] **Step 3: Verificare che il gioco non sia cambiato**

Run: `node --test frontend/shared/` e `node --test backend/` — non oltre le baseline (5 e 8).
Poi in localhost: avviare una gara su `prova` e confrontare con uno screenshot precedente. La pista, i cordoli, le barriere, la corsia box e la griglia devono essere identici, di giorno e di notte.

- [ ] **Step 4: Commit**

```bash
git add frontend/f1.js frontend/f1.html
git commit -m "Il gioco costruisce la sua scena dal modulo condiviso"
```

---

### Task 3: La tabella degli asset, una sola

**Files:**
- Create: `frontend/shared/sceneryAssetPaths.js`
- Modify: `frontend/f1.js` (usa il modulo), `frontend/f1.html`

- [ ] **Step 1: Il modulo** — la tabella `SCENERY_ASSET_PATHS` di `f1.js:832-895`, spostata così com'è:

```javascript
// frontend/shared/sceneryAssetPaths.js
//
// Dove sta il modello di ogni asset scenico. Una tabella sola: se ne
// esistessero due, un asset nuovo comparirebbe in gara e non nell'anteprima —
// o peggio, con un modello diverso.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SceneryAssetPaths = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    const PERCORSI = { /* … le 55 voci, invariate … */ };
    return { PERCORSI };
});
```

- [ ] **Step 2:** in `f1.js`, `const SCENERY_ASSET_PATHS = SceneryAssetPaths.PERCORSI;` e togliere la tabella.

- [ ] **Step 3: Un test che lega la tabella ai file veri**

```javascript
// in frontend/shared/sceneryAssetPaths.test.js
test('ogni asset dichiarato ha il suo file', () => {
    const fs = require('fs'), path = require('path');
    const ROOT = path.join(__dirname, '..', '..');
    const mancanti = Object.entries(require('./sceneryAssetPaths.js').PERCORSI)
        .filter(([, url]) => !fs.existsSync(path.join(ROOT, 'frontend', url)))
        .map(([nome]) => nome);
    assert.deepEqual(mancanti, []);
});
```

- [ ] **Step 4: Commit**

```bash
git add frontend/shared/sceneryAssetPaths.js frontend/shared/sceneryAssetPaths.test.js frontend/f1.js frontend/f1.html
git commit -m "La tabella degli asset esiste una volta sola"
```

---

### Task 4: La vista esplorabile

**Files:**
- Create: `frontend/track-preview.html`, `frontend/track-preview.js`

- [ ] **Step 1: La pagina** — canvas a schermo intero, una riga di aiuto in basso, un tasto «Torna all'editor» in alto a sinistra, e i moduli condivisi (`trackGeometry`, `trackGravel`, `toonPalette`, `trackMeshBuilder`, `sceneryHills`, `trackScenery`, `sceneryAssetPaths`, `f1Scena`) più `GLTFLoader`.

- [ ] **Step 2: La scena e il volo**

```javascript
// frontend/track-preview.js
//
// Guardare la pista che si sta disegnando, con gli oggetti che ci saranno
// davvero, senza avviare una gara. Non renderizza auto, luci, ombre né
// contorni: solo la geometria e gli asset — è ciò che l'utente ha chiesto, ed
// è anche ciò che la rende leggera.
document.addEventListener('DOMContentLoaded', async () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8fbcd4);
    // Una luce piatta: senza direzionale non ci sono ombre da calcolare, e i
    // colori restano quelli dei .glb.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9a9a, 1.5));

    const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.5, 6000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(innerWidth, innerHeight);
    document.body.appendChild(renderer.domElement);
    addEventListener('resize', () => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
    });

    // La pista arriva dall'editor senza passare dal disco: si guarda anche una
    // pista non ancora salvata, che è il caso normale mentre la si disegna.
    let trackData = null;
    try {
        const grezzo = sessionStorage.getItem('f1AnteprimaPista');
        if (grezzo) trackData = JSON.parse(grezzo);
    } catch (e) { /* si ripiega sul parametro qui sotto */ }
    if (!trackData) {
        const id = new URLSearchParams(location.search).get('track') || 'prova';
        trackData = await (await fetch(`/tracks/${id}.json`)).json();
    }

    const circuito = await F1Scena.costruisciCircuito(scene, trackData, { gridSize: 6 });

    // Si parte SUL TRAGUARDO, a quota d'uomo, guardando nel verso di marcia:
    // è il punto da cui si giudica una pista.
    const p0 = circuito.trackPts[circuito.startFinishIndex];
    const t0 = TrackGeometry.tangentAt(circuito.trackPts, circuito.startFinishIndex, true);
    camera.position.set(p0.x, (p0.y || 0) + 2.5, p0.z);
    camera.lookAt(p0.x + t0.tx * 10, (p0.y || 0) + 2.5, p0.z + t0.tz * 10);

    // --- Volo -------------------------------------------------------------
    const tasti = new Set();
    addEventListener('keydown', (e) => tasti.add(e.code));
    addEventListener('keyup', (e) => tasti.delete(e.code));
    renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());
    let imbardata = Math.atan2(t0.tx, t0.tz), beccheggio = 0;
    addEventListener('mousemove', (e) => {
        if (document.pointerLockElement !== renderer.domElement) return;
        imbardata -= e.movementX * 0.0022;
        beccheggio = Math.max(-1.4, Math.min(1.4, beccheggio - e.movementY * 0.0022));
    });

    const VELOCITA = 40;           // unità al secondo, un passo di corsa veloce
    const MOLTIPLICATORE_CORSA = 4;
    let ultimo = performance.now();
    function anima() {
        requestAnimationFrame(anima);
        const ora = performance.now();
        const dt = Math.min(0.05, (ora - ultimo) / 1000);
        ultimo = ora;

        const passo = VELOCITA * dt * (tasti.has('ShiftLeft') ? MOLTIPLICATORE_CORSA : 1);
        const avanti = new THREE.Vector3(Math.sin(imbardata) * Math.cos(beccheggio),
                                         Math.sin(beccheggio),
                                         Math.cos(imbardata) * Math.cos(beccheggio));
        const destra = new THREE.Vector3(Math.sin(imbardata + Math.PI / 2), 0,
                                         Math.cos(imbardata + Math.PI / 2));
        if (tasti.has('KeyW')) camera.position.addScaledVector(avanti, passo);
        if (tasti.has('KeyS')) camera.position.addScaledVector(avanti, -passo);
        if (tasti.has('KeyD')) camera.position.addScaledVector(destra, passo);
        if (tasti.has('KeyA')) camera.position.addScaledVector(destra, -passo);
        if (tasti.has('KeyE')) camera.position.y += passo;
        if (tasti.has('KeyQ')) camera.position.y -= passo;

        camera.lookAt(camera.position.clone().add(avanti));
        renderer.render(scene, camera);
    }
    anima();
});
```

- [ ] **Step 3: Provare a mano** — aprire `localhost:3000/track-preview.html?track=prova`: si parte sul traguardo, WASD muove, il mouse gira dopo un click, Shift accelera.

- [ ] **Step 4: Commit**

```bash
git add frontend/track-preview.html frontend/track-preview.js
git commit -m "Si vola dentro la pista, senza avviare una gara"
```

---

### Task 5: Gli asset veri

**Files:**
- Modify: `frontend/track-preview.js`

Il layout è **lo stesso identico** della gara: `TrackScenery.generateLayout` con gli stessi argomenti. Cambia solo come si disegna — niente stile, niente ombre, niente divisione in celle.

- [ ] **Step 1: Il layout e il caricamento**

```javascript
    // LO STESSO layout della gara: stessa funzione, stessi argomenti. Se
    // divergesse, l'anteprima mostrerebbe una scenografia che in gara non
    // esiste — che è esattamente il difetto che questo progetto evita.
    const seatAnchors = await (await fetch('/assets/custom/circuit/grandStandSeats.json')).json();
    const terraceAnchors = await (await fetch('/assets/custom/circuit/terraceAnchors.json')).json();
    let layout = null;
    try {
        const risposta = await fetch(`/tracks/scenografie/${trackData.id}.json`);
        if (risposta.ok) layout = ScenografiaCotta.espandi(await risposta.json());
    } catch (e) { /* pista non congelata: si genera */ }
    if (!layout) {
        layout = TrackScenery.generateLayout(trackData, circuito.trackPts, circuito.pitPts,
            circuito.barrierDist, F1Scena.EMBANKMENT_WIDTH, seatAnchors.seats,
            circuito.barrierProfile, terraceAnchors.anchors, { gridSize: 6 });
    }

    // Un InstancedMesh per asset: nessuna divisione in celle e nessun culling
    // fine: qui non c'è un budget di frame da rispettare, c'è da guardarsi
    // intorno.
    const perAsset = new Map();
    for (const voce of layout) {
        if (!voce.asset || voce.category === 'pond' || voce.category === 'parkingLot') continue;
        if (!perAsset.has(voce.asset)) perAsset.set(voce.asset, []);
        perAsset.get(voce.asset).push(voce);
    }
    const loader = new THREE.GLTFLoader();
    const dummy = new THREE.Object3D();
    for (const [asset, voci] of perAsset) {
        const url = SceneryAssetPaths.PERCORSI[asset];
        if (!url) { console.warn(`[anteprima] asset senza modello: ${asset}`); continue; }
        loader.load(url, (gltf) => {
            gltf.scene.updateMatrixWorld(true);
            gltf.scene.traverse((child) => {
                if (!child.isMesh) return;
                const im = new THREE.InstancedMesh(child.geometry, child.material, voci.length);
                voci.forEach((v, i) => {
                    dummy.position.set(v.x, v.y || 0, v.z);
                    dummy.rotation.set(0, v.rotY || 0, 0);
                    dummy.scale.setScalar(v.scale || 1);
                    dummy.updateMatrix();
                    im.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(dummy.matrix, child.matrixWorld));
                });
                im.instanceMatrix.needsUpdate = true;
                scene.add(im);
            });
        });
    }
```

- [ ] **Step 2:** caricare anche `scenografiaCotta.js` nella pagina (serve alle piste congelate, `prova` in primis). ⚠️ Va caricato PRIMA di `track-preview.js`, e la pagina deve caricare anche `sceneryHills.js`, `sceneryChunks.js`, `sceneryAssetSizes.js`, `sceneryRegistro.js`, `sceneryCrowd.js`, `sceneryPaddock.js`, `sceneryLandmarks.js`, `sceneryTrackside.js`, `sceneryInfrastructure.js`, `sceneryGaps.js`: `trackScenery.js` li pretende tutti, e nell'ordine in cui li carica `f1.html` — copiare quell'ordine, non inventarne uno.

- [ ] **Step 3: Provare a mano** — su `prova` (congelata) e su `monte-rosso` (generata): gli oggetti devono essere gli stessi che si vedono in gara, nelle stesse posizioni.

- [ ] **Step 4: Commit**

```bash
git add frontend/track-preview.js frontend/track-preview.html
git commit -m "Nell'anteprima ci sono gli asset veri, dallo stesso layout della gara"
```

---

### Task 6: Il ponte con l'editor

**Files:**
- Modify: `frontend/track-editor.js`, `frontend/track-editor.html`, `frontend/track-preview.js`

- [ ] **Step 1: Il tasto nell'editor**, accanto a «Salva nel gioco»:

```html
<button id="esploraBtn">Esplora in 3D</button>
```

```javascript
    // Si esplora anche una pista NON salvata: è il caso normale mentre la si
    // disegna. I dati passano da sessionStorage, non dal disco.
    document.getElementById('esploraBtn').addEventListener('click', () => {
        if (mainPoints.length < 3) { alert('Disegna almeno tre nodi prima di esplorare.'); return; }
        try {
            sessionStorage.setItem('f1AnteprimaPista', JSON.stringify(buildTrackData()));
        } catch (e) {
            alert('Non riesco a passare la pista all\'anteprima: salvala e riprova.');
            return;
        }
        location.href = 'track-preview.html';
    });
```

⚠️ `buildTrackData()` pretende una corsia box valida. Nell'anteprima non serve: se `pitPoints.length < 3`, passare una corsia finta di tre punti sul tracciato, e dirlo nella riga di aiuto dell'anteprima.

- [ ] **Step 2: Il ritorno**, in `track-preview.js`:

```javascript
    document.getElementById('tornaBtn').addEventListener('click', () => {
        location.href = 'track-editor.html';
    });
    addEventListener('keydown', (e) => { if (e.code === 'Escape') location.href = 'track-editor.html'; });
```

- [ ] **Step 3: Provare a mano** — disegnare una pista NUOVA senza salvarla, premere «Esplora in 3D», volare, tornare indietro: l'editor deve ritrovare la pista dov'era (la ricarica da `sessionStorage` all'avvio).

⚠️ Perché l'editor la ritrovi, serve il giro completo: l'editor **scrive** in `sessionStorage` quando si va a esplorare, e all'avvio **rilegge** quella chiave prima di ogni altra cosa (se c'è, `applyTrackData` la usa al posto dei valori di partenza). Senza il secondo pezzo, tornare indietro perde il lavoro — ed è il difetto peggiore che questo task possa introdurre, perché si scopre solo dopo aver disegnato mezza pista.

- [ ] **Step 4: Commit**

```bash
git add frontend/track-editor.js frontend/track-editor.html frontend/track-preview.js
git commit -m "Dall'editor alla pista e ritorno, anche senza salvare"
```

---

## Verifica finale

- [ ] `node --test frontend/shared/` — non oltre 5 rossi; `node --test backend/` — non oltre 8.
- [ ] Una gara su `prova` è identica a prima (il test del Task 1 protegge la sequenza, l'occhio protegge il resto).
- [ ] L'anteprima di `prova` mostra gli stessi oggetti della gara.
- [ ] Si esplora una pista mai salvata, e tornando all'editor è ancora lì.
