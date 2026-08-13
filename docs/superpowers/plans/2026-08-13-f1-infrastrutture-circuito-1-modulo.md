# Infrastrutture di circuito — Piano 1: il modulo di piazzamento

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un modulo che cammina il giro e posa infrastrutture dove c'è posto, riducendo di almeno la metà i tratti di circuito senza nulla — funzionante e visibile in gioco già con i soli asset esistenti, prima ancora di modellarne di nuovi.

**Architecture:** un modulo puro `sceneryInfrastructure.js` innestato in `generateLayout` fra il trackside e la natura. Cammina il giro a passo fisso in unità di pista, legge il contesto (curva / rettilineo / viadotto / larghezza del muro), sceglie da una lista di preferenza e posa il primo asset che supera sette vincoli. La misura dei vuoti sta nei TEST, non nell'algoritmo.

**Tech Stack:** JavaScript vanilla in stile UMD (`frontend/shared/*.js`), test con `node --test`. Nessuna dipendenza da Three: i moduli di scenografia sono puri per essere verificabili headless.

**Spec:** `docs/superpowers/specs/2026-08-13-f1-infrastrutture-circuito-design.md`

## Cosa questo piano NON copre

La spec è coperta da **due** piani. Qui c'è il modulo; nel piano 2 ci sono i
modelli. Queste parti della spec sono deliberatamente rimandate, non
dimenticate:

- **Gli otto asset nuovi** (`giantScreen`, `floodlightTower`, `serviceBuilding`,
  `hospitalityDeck`, `vipSuite`, `tvTower`, `recoveryCrane`, `trackGate`) e la
  loro pipeline Blender.
- **Gli spettatori sulle terrazze** e il loro budget separato da
  `SceneryCrowd.MAX_TOTAL`: senza `hospitalityDeck` non c'è dove metterli.
- **I vincoli di modellazione** (tre-quattro materiali per asset,
  `floodlightTower` in `NO_SHADOW_ASSETS`, `sceneryAssetSizes.js`,
  `SCENERY_ASSET_PATHS` in `f1.js`).

Il piano 2 si scrive **dopo** il gate del Task 7: se la distribuzione non
convince, correggerla qui costa infinitamente meno che scoprirlo dopo aver
modellato otto asset.

## Global Constraints

Valgono per **ogni** task, sono costati playtest e non si negoziano:

- **Italiano** nei commenti del codice e nei messaggi di commit.
- **Ogni soglia geometrica in unità di pista, mai in campioni.** Un campione vale 5.17 unità su `prova`, 3.21 su `new-monza`, 1.18 su `monte-rosso`, 2.71 su `baku`: una soglia "in campioni" ha quattro comportamenti diversi in silenzio.
- **Ingombro reale orientato, mai distanza fra centri**: `SceneryAssetSizes.itemsOverlap`. Le distanze fra centri servono solo a esprimere intenzioni di composizione ("non ammucchiare"), mai come vincolo anti-compenetrazione.
- **`findCorners(...).side` è il lato ESTERNO** della curva. Chi vuole l'interno usa `-corner.side`.
- **`rotY` è la direzione in cui l'oggetto GUARDA**, perpendicolare al nastro: un oggetto messo bene ha 90° di scarto dalla tangente, non 0.
- **RNG proprio e seedato** (`mulberry32(hashString(id + ':infra'))`), mai pescare dalla sequenza condivisa: la fittezza dei boschi ne dipendeva e un test è fallito senza che un albero avesse cambiato posto.
- **Misurare sempre su tutti e quattro i tracciati**: `prova`, `new-monza`, `monte-rosso`, `baku`.
- **Bump del cache-busting** in `frontend/f1.html` a ogni modifica di un file `frontend/shared/*.js`, altrimenti il browser serve JS vecchio e sembra che il lavoro non abbia effetto.
- **Riavviare il server** dopo ogni modifica ai moduli di `frontend/shared/`, che il backend carica all'avvio. **Senza pipe**: `node server.js | head -20` lo uccide via SIGPIPE.
- **Commit a ogni task**, mai `push` (lo fa l'utente a mano).
- I **4 test rossi preesistenti** del repo non sono regressioni: isolamento componenti Simcade, due `loadTrack("monte-rosso")`, una taratura di `simulateLap`. Verificare che restino esattamente quattro.

---

### Task 1: `guardaVersoLaPista` diventa un helper condiviso

Il vincolo «un oggetto deve stare perpendicolare al campione che gli è più vicino» oggi vive come funzione privata dentro `trackScenery.js`. Il modulo nuovo ne ha bisogno, quindi va spostato in `trackGeometry.js`, che è geometria pura e che `trackScenery.js` già importa. Nessun cambio di comportamento: è un trasloco.

**Files:**
- Modify: `frontend/shared/trackGeometry.js` (aggiungere la funzione e l'export)
- Modify: `frontend/shared/trackScenery.js` (togliere la funzione locale, chiamare quella di TrackGeometry)
- Test: `frontend/shared/trackGeometry.test.js`

**Interfaces:**
- Consumes: `TrackGeometry.nearestPoint(trackPts, x, z) -> {index, dist}`, `TrackGeometry.normalAt(trackPts, idx, true) -> {nx, nz}`
- Produces: `TrackGeometry.guardaVersoLaPista(trackPts, item, scartoMax) -> boolean`, dove `item` ha `{x, z, rotY}` e `scartoMax` è in radianti (default `Math.PI / 6`)

- [ ] **Step 1: Scrivere il test che fallisce**

In `frontend/shared/trackGeometry.test.js`, in fondo:

```javascript
test('guardaVersoLaPista: passa chi guarda la pista, boccia chi le dà il fianco', () => {
    // Anello di raggio 100 centrato nell'origine, campionato fitto.
    const pts = [];
    for (let i = 0; i < 400; i++) {
        const a = (i / 400) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * 100, z: Math.sin(a) * 100 });
    }
    // Oggetto a 130 dal centro, sul raggio a 0°: la pista gli sta verso
    // l'origine, quindi deve guardare in quella direzione.
    const buono = { x: 130, z: 0, rotY: Math.atan2(0 - 130, 0 - 0) };
    assert.ok(TrackGeometry.guardaVersoLaPista(pts, buono),
        'un oggetto che guarda verso l\'asse deve passare');

    // Stesso posto, girato di 90°: dà il fianco alla pista.
    const storto = { x: 130, z: 0, rotY: buono.rotY + Math.PI / 2 };
    assert.ok(!TrackGeometry.guardaVersoLaPista(pts, storto),
        'un oggetto girato di 90° deve essere bocciato');

    // 20° di scarto: sotto la soglia di 30°, passa.
    const quasi = { x: 130, z: 0, rotY: buono.rotY + Math.PI / 9 };
    assert.ok(TrackGeometry.guardaVersoLaPista(pts, quasi),
        '20° di scarto stanno sotto la soglia di 30° e devono passare');
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test frontend/shared/trackGeometry.test.js`
Expected: FAIL con `TypeError: TrackGeometry.guardaVersoLaPista is not a function`

- [ ] **Step 3: Spostare la funzione in `trackGeometry.js`**

Aggiungere prima del `return {...}` finale del modulo:

```javascript
    // Un oggetto scenico deve GUARDARE la pista che ha davvero davanti, cioè
    // stare perpendicolare al campione che gli è più vicino. Non è la stessa
    // cosa di essere perpendicolare al campione da cui è stato costruito:
    // dove la pista fa un tornante le due branche si avvicinano e un oggetto
    // posato per la prima si ritrova più vicino alla seconda.
    //
    // 30° di default: gli oggetti sani deviano meno di 1°, e il caso limite
    // noto e accettato — il muro che gira più di quanto l'oggetto sia largo,
    // prova @412 — arriva a 18.5°.
    const SCARTO_DALLA_PISTA_MAX = Math.PI / 6;

    function guardaVersoLaPista(trackPts, item, scartoMax) {
        const limite = scartoMax === undefined ? SCARTO_DALLA_PISTA_MAX : scartoMax;
        const q = nearestPoint(trackPts, item.x, item.z);
        const nrm = normalAt(trackPts, q.index, true);
        const lato = Math.sign((item.x - trackPts[q.index].x) * nrm.nx +
                               (item.z - trackPts[q.index].z) * nrm.nz) || 1;
        // Direzione che va dall'oggetto verso l'asse: è dove deve guardare.
        const verso = Math.atan2(-nrm.nx * lato, -nrm.nz * lato);
        let d = (item.rotY || 0) - verso;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return Math.abs(d) <= limite;
    }
```

Aggiungere `guardaVersoLaPista` e `SCARTO_DALLA_PISTA_MAX` all'oggetto restituito dal modulo.

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `node --test frontend/shared/trackGeometry.test.js`
Expected: PASS

- [ ] **Step 5: Far usare a `trackScenery.js` la versione condivisa**

In `frontend/shared/trackScenery.js` cancellare la funzione locale `guardaLaSuaPista` e la costante `SCARTO_DALLA_PISTA_MAX` (con il loro blocco di commento, che va spostato in `trackGeometry.js` al passo 3), e sostituire le tre chiamate:

- in `buildStandRow`, `if (!accept(center) || !guardaLaSuaPista(trackPts, center)) return [];` diventa `if (!accept(center) || !TrackGeometry.guardaVersoLaPista(trackPts, center)) return [];`
- sempre in `buildStandRow`, `if (!guardaLaSuaPista(trackPts, next)) break;` diventa `if (!TrackGeometry.guardaVersoLaPista(trackPts, next)) break;`
- in `slotValid`, `if (!guardaLaSuaPista(trackPts, {...})) return false;` diventa `if (!TrackGeometry.guardaVersoLaPista(trackPts, {...})) return false;`

- [ ] **Step 6: Verificare che nulla sia cambiato**

Run: `node --test frontend/shared/trackScenery.test.js frontend/shared/trackGeometry.test.js`
Expected: PASS, zero falliti. È un trasloco: se un test di scenografia si accende, la funzione spostata non è identica all'originale.

- [ ] **Step 7: Commit**

```bash
git add frontend/shared/trackGeometry.js frontend/shared/trackGeometry.test.js frontend/shared/trackScenery.js
git commit -m "F1: guardaVersoLaPista diventa un helper condiviso di TrackGeometry

Il vincolo \"un oggetto deve stare perpendicolare al campione che gli e
piu vicino\" serviva anche al modulo delle infrastrutture. Trasloco puro,
nessun cambio di comportamento."
```

---

### Task 2: il misuratore dei vuoti, e la fotografia dello stato attuale

Il criterio con cui si giudicherà tutto il lavoro diventa codice, PRIMA di scrivere il modulo. Ora fotografa lo stato di partenza; a fine piano la soglia si stringe.

**Files:**
- Create: `frontend/shared/sceneryGaps.js`
- Test: `frontend/shared/sceneryGaps.test.js`

**Interfaces:**
- Consumes: `TrackGeometry.nearestPoint`, `TrackGeometry.normalAt`, `TrackGeometry.lapLength`
- Produces: `SceneryGaps.trattiVuoti(trackPts, layout, opzioni) -> [{ lato, da, a, lunghezza, suViadotto }]`, ordinati per lunghezza decrescente. `opzioni` = `{ fascia = 90, lungoPista = 60, categorie }`.

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `frontend/shared/sceneryGaps.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const SceneryGaps = require('./sceneryGaps.js');

// Anello di raggio 200, campionato ogni ~3 unità.
function anello(n = 400, r = 200) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    }
    return pts;
}

test('un giro senza niente è tutto vuoto, su entrambi i lati', () => {
    const pts = anello();
    const tratti = SceneryGaps.trattiVuoti(pts, []);
    const perLato = { 1: 0, '-1': 0 };
    for (const t of tratti) perLato[t.lato] += t.lunghezza;
    const giro = 2 * Math.PI * 200;
    assert.ok(Math.abs(perLato[1] - giro) < giro * 0.02, 'lato destro tutto vuoto');
    assert.ok(Math.abs(perLato['-1'] - giro) < giro * 0.02, 'lato sinistro tutto vuoto');
});

test('una struttura svuota il tratto attorno a sé, solo sul suo lato', () => {
    const pts = anello();
    // A 230 dal centro sul raggio a 0°: lato esterno (positivo), campione 0.
    const layout = [{ asset: 'grandStand', category: 'grandstand', x: 230, y: 0, z: 0, rotY: 0 }];
    const tratti = SceneryGaps.trattiVuoti(pts, layout);
    const destro = tratti.filter(t => t.lato === 1);
    const sinistro = tratti.filter(t => t.lato === -1);
    // Il lato con la struttura ha un buco in meno (o comunque meno vuoto).
    const vuotoDx = destro.reduce((s, t) => s + t.lunghezza, 0);
    const vuotoSx = sinistro.reduce((s, t) => s + t.lunghezza, 0);
    assert.ok(vuotoDx < vuotoSx - 100,
        `la struttura deve togliere almeno 100 unità di vuoto al suo lato: ${vuotoDx} vs ${vuotoSx}`);
});

test('la vegetazione NON conta come struttura', () => {
    const pts = anello();
    const alberi = [{ asset: 'treeBroad', category: 'nature', x: 230, y: 0, z: 0, rotY: 0 }];
    const conAlberi = SceneryGaps.trattiVuoti(pts, alberi);
    const senzaNiente = SceneryGaps.trattiVuoti(pts, []);
    assert.equal(conAlberi.length, senzaNiente.length,
        'gli alberi non riempiono: il circuito resta spoglio uguale');
});

test('un tratto su viadotto è marcato, così i test possono escluderlo', () => {
    const pts = anello();
    for (let i = 100; i < 160; i++) pts[i].bridge = true;
    const tratti = SceneryGaps.trattiVuoti(pts, []);
    assert.ok(tratti.some(t => t.suViadotto),
        'almeno un tratto deve risultare su viadotto');
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test frontend/shared/sceneryGaps.test.js`
Expected: FAIL con `Cannot find module './sceneryGaps.js'`

- [ ] **Step 3: Scrivere il modulo**

Creare `frontend/shared/sceneryGaps.js`:

```javascript
// frontend/shared/sceneryGaps.js
//
// Dove il circuito è VUOTO: tratti di pista che non hanno nessuna struttura
// costruita di fianco. Serve ai TEST, non all'algoritmo di piazzamento —
// è una scelta di progetto (vedi la spec 2026-08-13-f1-infrastrutture-
// circuito-design.md): il codice posa dove c'è posto, ed è il test a
// pretendere che alla fine nessun tratto lungo resti spoglio. Un'euristica
// che si adatta da sola nasconde il problema; un test lo dichiara.
//
// Modulo puro, nessuna dipendenza da Three.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'));
    } else {
        root.SceneryGaps = factory(root.TrackGeometry);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry) {

    // Che cosa conta come "struttura": roba costruita dall'uomo. Alberi,
    // rocce e laghetti NON contano — un tratto pieno di alberi è comunque
    // un tratto in cui non c'è niente da guardare, ed è esattamente ciò che
    // l'utente ha segnalato nei dodici punti M 24-35.
    const CATEGORIE_COSTRUITE = ['grandstand', 'grandstand-main', 'paddock',
                                 'landmark', 'paddock-decor', 'paddock-life',
                                 'safety', 'infrastructure'];
    // Quanto lontano dall'asse guardare, e quanto avanti/indietro lungo la
    // pista. Entrambi in unità di gioco, mai in campioni.
    const FASCIA = 90;
    const LUNGO_PISTA = 60;

    function trattiVuoti(trackPts, layout, opzioni) {
        const o = opzioni || {};
        const fascia = o.fascia === undefined ? FASCIA : o.fascia;
        const lungoPista = o.lungoPista === undefined ? LUNGO_PISTA : o.lungoPista;
        const categorie = new Set(o.categorie || CATEGORIE_COSTRUITE);

        const n = trackPts.length;
        const passo = TrackGeometry.lapLength(trackPts) / n;
        const finestra = Math.round(lungoPista / passo);

        // Ogni struttura, ridotta a (campione, lato).
        const strutture = [];
        for (const v of layout) {
            if (!categorie.has(v.category)) continue;
            const q = TrackGeometry.nearestPoint(trackPts, v.x, v.z);
            if (q.dist > fascia) continue;
            const nrm = TrackGeometry.normalAt(trackPts, q.index, true);
            const lato = Math.sign((v.x - trackPts[q.index].x) * nrm.nx +
                                   (v.z - trackPts[q.index].z) * nrm.nz) || 1;
            strutture.push({ idx: q.index, lato });
        }

        const fuori = [];
        for (const lato of [1, -1]) {
            // Marcatura campione per campione: occupato se una struttura del
            // suo lato cade entro la finestra, con wrap sul giro chiuso.
            const occupato = new Array(n).fill(false);
            for (const s of strutture) {
                if (s.lato !== lato) continue;
                for (let d = -finestra; d <= finestra; d++) {
                    occupato[((s.idx + d) % n + n) % n] = true;
                }
            }
            // Tratti contigui di NON occupato.
            let i = 0;
            while (i < n) {
                if (occupato[i]) { i++; continue; }
                let j = i;
                while (j < n && !occupato[j]) j++;
                let suViadotto = false;
                for (let k = i; k < j; k++) if (trackPts[k].bridge) { suViadotto = true; break; }
                fuori.push({ lato, da: i, a: j - 1, lunghezza: (j - i) * passo, suViadotto });
                i = j;
            }
        }
        return fuori.sort((a, b) => b.lunghezza - a.lunghezza);
    }

    return { trattiVuoti, CATEGORIE_COSTRUITE, FASCIA, LUNGO_PISTA };
});
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `node --test frontend/shared/sceneryGaps.test.js`
Expected: PASS, 4 test

- [ ] **Step 5: Fotografare lo stato attuale dei quattro tracciati**

Aggiungere in fondo a `frontend/shared/trackScenery.test.js`:

```javascript
// Lo stato di partenza del 2026-08-13, prima delle infrastrutture. Le soglie
// vanno STRETTE quando il modulo sarà in piedi (Task 5), mai allargate: se il
// riempimento non arriva, è il piano a essere sbagliato.
const VUOTI_ATTESI = {
    'prova':       { peggiore: 330, quota: 0.45 },
    'new-monza':   { peggiore: 330, quota: 0.45 },
    'monte-rosso': { peggiore: 330, quota: 0.45 },
    'baku':        { peggiore: 999, quota: 1.00 },   // quasi tutto viadotto
};

for (const id of ['prova', 'new-monza', 'monte-rosso', 'baku']) {
    test(`scenografia: quanto circuito resta senza niente di fianco (${id})`, () => {
        const { trackPts, layout } = circuitoVero(id);
        const tratti = SceneryGaps.trattiVuoti(trackPts, layout);
        const giro = TrackGeometry.lapLength(trackPts);
        const aTerra = tratti.filter(t => !t.suViadotto);
        const peggiore = aTerra.length ? aTerra[0].lunghezza : 0;
        const atteso = VUOTI_ATTESI[id];
        assert.ok(peggiore <= atteso.peggiore,
            `${id}: il tratto vuoto più lungo a terra è ${peggiore.toFixed(0)} unità, `
            + `sopra il tetto di ${atteso.peggiore}`);
        for (const lato of [1, -1]) {
            const quota = tratti.filter(t => t.lato === lato)
                .reduce((s, t) => s + t.lunghezza, 0) / giro;
            assert.ok(quota <= atteso.quota,
                `${id}: il lato ${lato > 0 ? 'destro' : 'sinistro'} è vuoto per il `
                + `${(quota * 100).toFixed(0)}%, sopra il tetto del ${(atteso.quota * 100).toFixed(0)}%`);
        }
    });
}
```

In testa al file aggiungere `const SceneryGaps = require('./sceneryGaps.js');` accanto agli altri require.

- [ ] **Step 6: Eseguire e annotare i numeri veri**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: PASS. Se un tracciato sfora, **non alzare la soglia**: annotare il numero vero nel commento sopra `VUOTI_ATTESI` e portarlo al Task 5, dove va stretto.

- [ ] **Step 7: Commit**

```bash
git add frontend/shared/sceneryGaps.js frontend/shared/sceneryGaps.test.js frontend/shared/trackScenery.test.js
git commit -m "F1: misuratore dei tratti di circuito senza strutture di fianco

Il criterio con cui si giudica il riempimento diventa codice PRIMA del
modulo che riempie. Sta nei test e non nell'algoritmo per scelta: il
codice posa dove c'e posto, il test pretende che alla fine non resti
spoglio niente di lungo. La vegetazione non conta come struttura."
```

---

### Task 3: lo scheletro del modulo — contesto e vincoli, palette vuota

Il modulo nasce con tutta la macchina (camminata, contesto, sette vincoli) ma **senza asset**: posa zero cose. Serve a far passare i vincoli sotto test in isolamento, prima che ci sia qualcosa da guardare.

**Files:**
- Create: `frontend/shared/sceneryInfrastructure.js`
- Test: `frontend/shared/sceneryInfrastructure.test.js`

**Interfaces:**
- Consumes: `TrackGeometry.{nearestPoint, normalAt, lapLength, terrainHeightAt, guardaVersoLaPista}`, `TrackGravel.barrierAt`, `SceneryAssetSizes.{sizeOf, itemsOverlap, footprintCorners}`, `SceneryTrackside.findCorners`
- Produces: `SceneryInfrastructure.buildInfrastructure(ctx) -> [voce]` con `ctx = { trackPts, pitPts, barrierDist, pitRoadHalf, embankStart, embankOuter, barrierProfile, accepted, grandstands, spanning, insidePlayerBoxFootprint, playerBoxFootprints, fitsUnderBridge, rng, palette }`. Ogni voce: `{ asset, category: 'infrastructure', suMisuraSulMuro: true, x, y, z, rotY, scale: 1 }`.
- Produces: `SceneryInfrastructure.contestoAl(ctx, idx, lato) -> { curva, esterno, viadotto, dislivello, muro, visuale }`

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `frontend/shared/sceneryInfrastructure.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const TrackGeometry = require('./trackGeometry.js');
const TrackGravel = require('./trackGravel.js');
const SceneryAssetSizes = require('./sceneryAssetSizes.js');
const SceneryInfrastructure = require('./sceneryInfrastructure.js');

// Lo stesso circuito vero usato dagli altri test di scenografia.
function circuitoVero(id) {
    const raw = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'tracks', `${id}.json`), 'utf8'));
    const trackPts = TrackGeometry.sampleLoop(raw.controlPoints, 1000);
    const pitPath = TrackGeometry.snapPitPathEnds(raw.pit.path, trackPts, raw.roadHalfWidth);
    const pitLanePts = TrackGeometry.sampleOpenPath(pitPath, 300);
    const barrierProfile = TrackGravel.barrierProfile(trackPts, {
        roadHalf: raw.roadHalfWidth, pitLanePts, pitRoadHalf: raw.pit.roadHalfWidth });
    return { raw, trackPts, pitLanePts, barrierProfile,
             barrierDist: raw.roadHalfWidth + 2.8 + 1.2 };
}

function contesto(id, extra) {
    const c = circuitoVero(id);
    return Object.assign({
        trackPts: c.trackPts, pitPts: c.pitLanePts, barrierDist: c.barrierDist,
        pitRoadHalf: c.raw.pit.roadHalfWidth, embankStart: c.barrierDist, embankOuter: 45,
        barrierProfile: c.barrierProfile, accepted: [], grandstands: [], spanning: [],
        insidePlayerBoxFootprint: () => false, playerBoxFootprints: [],
        fitsUnderBridge: () => true, rng: () => 0.5, palette: [],
    }, extra || {});
}

test('con la palette vuota non posa niente', () => {
    const out = SceneryInfrastructure.buildInfrastructure(contesto('prova'));
    assert.equal(out.length, 0, 'palette vuota deve produrre zero voci');
});

test('il contesto riconosce il viadotto e ne misura il dislivello', () => {
    const ctx = contesto('prova');
    // I campioni 417-614 di prova sono sopraelevati (misurato: fino a 11.5).
    const sopra = SceneryInfrastructure.contestoAl(ctx, 480, 1);
    assert.ok(sopra.viadotto, 'il campione 480 di prova è su viadotto');
    assert.ok(sopra.dislivello > 5,
        `dislivello atteso sopra 5, misurato ${sopra.dislivello.toFixed(1)}`);

    const terra = SceneryInfrastructure.contestoAl(ctx, 0, 1);
    assert.ok(!terra.viadotto, 'il traguardo di prova non è su viadotto');
    assert.ok(terra.dislivello < 1, 'a terra il dislivello è ~0');
});

test('il contesto riconosce l\'esterno di una curva', () => {
    const ctx = contesto('prova');
    // La curva che comincia al campione 126 di prova ha side -1 (= ESTERNO).
    const fuori = SceneryInfrastructure.contestoAl(ctx, 135, -1);
    assert.ok(fuori.curva && fuori.esterno, 'lato -1 al campione 135 è l\'esterno');
    const dentro = SceneryInfrastructure.contestoAl(ctx, 135, 1);
    assert.ok(dentro.curva && !dentro.esterno, 'lato +1 al campione 135 è l\'interno');
});

test('il muro del contesto è quello del lato giusto', () => {
    const ctx = contesto('prova');
    for (const idx of [0, 300, 700]) {
        for (const lato of [1, -1]) {
            const c = SceneryInfrastructure.contestoAl(ctx, idx, lato);
            assert.equal(c.muro, TrackGravel.barrierAt(ctx.barrierProfile, idx, lato),
                `il muro al campione ${idx} lato ${lato} deve venire da barrierAt con quel lato`);
        }
    }
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test frontend/shared/sceneryInfrastructure.test.js`
Expected: FAIL con `Cannot find module './sceneryInfrastructure.js'`

- [ ] **Step 3: Scrivere il modulo**

Creare `frontend/shared/sceneryInfrastructure.js`:

```javascript
// frontend/shared/sceneryInfrastructure.js
//
// Infrastrutture di circuito distribuite lungo il giro: maxischermi, torri
// faro, terrazze, gru, torrette TV. Spec:
// docs/superpowers/specs/2026-08-13-f1-infrastrutture-circuito-design.md
//
// A differenza delle tribune, che sono SCHIERE rigide e per questo non
// entrano in curva, questi sono oggetti SINGOLI: entrano dove le schiere non
// entrano, ed è per questo che riempiono i vuoti senza che serva un algoritmo
// che i vuoti li cerchi. Il codice cammina il giro e posa dove c'è posto; la
// misura dei vuoti sta nei test (sceneryGaps.js).
//
// Modulo puro, nessuna dipendenza da Three.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'), require('./trackGravel.js'),
                                 require('./sceneryAssetSizes.js'),
                                 require('./sceneryTrackside.js'));
    } else {
        root.SceneryInfrastructure = factory(root.TrackGeometry, root.TrackGravel,
                                             root.SceneryAssetSizes, root.SceneryTrackside);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, TrackGravel,
                                                       SceneryAssetSizes, SceneryTrackside) {

    // Passo della camminata, in UNITÀ DI PISTA. Mai in campioni: il campione
    // vale 5.17 unità su `prova` e 1.18 su `monte-rosso`, quindi una soglia
    // per campione ha quattro comportamenti diversi in silenzio.
    const PASSO = 25;
    // Margine dell'oggetto oltre il muro, come le tribune (GRANDSTAND_OFFSET_
    // MARGIN vale 10): qui basta meno perché sono oggetti più piccoli, ma non
    // meno della loro mezza profondità.
    const MARGINE_DAL_MURO = 8;
    // Fascia davanti a una tribuna in cui non ci va altro che la sua rete:
    // stesso valore usato da trackScenery.js dopo la traslazione.
    const FASCIA_DAVANTI_TRIBUNA = 22;
    // Quanti campioni guardare avanti per dire se la visuale è lunga.
    const VISUALE = 120;   // unità di pista

    // Curvatura: una curva è "stretta" sotto questo raggio. Sopra, il tratto
    // si comporta come un rettilineo per chi ci mette oggetti di fianco.
    const RAGGIO_RETTILINEO = 200;

    function contestoAl(ctx, idx, lato) {
        const { trackPts, barrierProfile, barrierDist } = ctx;
        const n = trackPts.length;
        const passo = TrackGeometry.lapLength(trackPts) / n;
        const groundPts = ctx.groundPts || trackPts.filter(p => !p.bridge);

        const p = trackPts[idx];
        const viadotto = !!p.bridge;
        const quotaTerreno = TrackGeometry.terrainHeightAt(
            groundPts, p.x, p.z, ctx.embankStart, ctx.embankOuter);
        const dislivello = Math.max(0, (p.y || 0) - quotaTerreno);

        // ⚠️ findCorners restituisce in `side` il lato ESTERNO della curva.
        const curve = ctx.curve || SceneryTrackside.findCorners(trackPts);
        let curva = null;
        for (const c of curve) {
            const dentro = (idx - c.startIdx + n) % n <= (c.endIdx - c.startIdx + n) % n;
            if (dentro) { curva = c; break; }
        }

        const muro = barrierProfile
            ? TrackGravel.barrierAt(barrierProfile, idx, lato)
            : barrierDist;

        // Visuale: quanto è dritta la pista nei prossimi VISUALE unità.
        const avanti = Math.max(1, Math.round(VISUALE / passo));
        const t0 = TrackGeometry.tangentAt(trackPts, idx, true);
        const t1 = TrackGeometry.tangentAt(trackPts, (idx + avanti) % n, true);
        let giro = Math.atan2(t1.tx, t1.tz) - Math.atan2(t0.tx, t0.tz);
        while (giro > Math.PI) giro -= Math.PI * 2;
        while (giro < -Math.PI) giro += Math.PI * 2;

        return {
            idx, lato, viadotto, dislivello, muro,
            curva: !!curva && curva.radius < RAGGIO_RETTILINEO,
            esterno: !!curva && curva.side === lato,
            visuale: Math.abs(giro) < Math.PI / 6,
        };
    }

    function buildInfrastructure(ctx) {
        const { trackPts, palette } = ctx;
        if (!palette || !palette.length) return [];
        return [];   // Task 4 riempie questa funzione.
    }

    return { buildInfrastructure, contestoAl,
             PASSO, MARGINE_DAL_MURO, FASCIA_DAVANTI_TRIBUNA, RAGGIO_RETTILINEO };
});
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `node --test frontend/shared/sceneryInfrastructure.test.js`
Expected: PASS, 4 test. Se il test sull'esterno curva fallisce, stampare le curve di `prova` con `node -e "..."` e correggere il campione citato nel test — **non** il segno di `esterno`, che è documentato.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/sceneryInfrastructure.js frontend/shared/sceneryInfrastructure.test.js
git commit -m "F1: scheletro del modulo infrastrutture, con la lettura del contesto

Riconosce viadotto e dislivello, esterno curva, muro del lato giusto e
visuale lunga. Palette ancora vuota: posa zero cose, cosi i vincoli si
verificano in isolamento prima che ci sia qualcosa da guardare."
```

---

### Task 4: la camminata, i sette vincoli e la palette di asset esistenti

Qui il modulo comincia a posare. La palette è fatta **solo di asset che esistono già** — nessuna modellazione: `pylon` (26 alto), `flagPole` (15), `billboardLow` (4.5), `banner`. Bastano a far vedere in gioco che la macchina funziona.

**Files:**
- Modify: `frontend/shared/sceneryInfrastructure.js`
- Test: `frontend/shared/sceneryInfrastructure.test.js`

**Interfaces:**
- Consumes: tutto il `ctx` del Task 3
- Produces: `palette` come array di `{ asset, contesti: [...], passoMinimo }`, dove `contesti` è un sottoinsieme di `'curvaEsterno' | 'rettilineo' | 'viadotto' | 'stretto'` e `passoMinimo` è la distanza minima in unità fra due esemplari dello stesso asset.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in `frontend/shared/sceneryInfrastructure.test.js`:

```javascript
// Palette di prova fatta di asset che esistono già: nessuna modellazione.
const PALETTE_ESISTENTI = [
    { asset: 'pylon',        contesti: ['rettilineo', 'viadotto'], passoMinimo: 400 },
    { asset: 'flagPole',     contesti: ['curvaEsterno', 'stretto'], passoMinimo: 200 },
    { asset: 'billboardLow', contesti: ['rettilineo', 'stretto'],  passoMinimo: 150 },
];

test('con una palette vera posa qualcosa su tutti i tracciati', () => {
    for (const id of ['prova', 'new-monza', 'monte-rosso', 'baku']) {
        const out = SceneryInfrastructure.buildInfrastructure(
            contesto(id, { palette: PALETTE_ESISTENTI }));
        assert.ok(out.length >= 5, `${id}: solo ${out.length} infrastrutture posate`);
        for (const v of out) {
            assert.equal(v.category, 'infrastructure');
            assert.equal(v.suMisuraSulMuro, true,
                'senza il flag, traslaOltreLaGhiaia le sposterebbe una seconda volta');
        }
    }
});

test('niente si compenetra: né fra loro né con quello che c\'era già', () => {
    for (const id of ['prova', 'new-monza', 'monte-rosso', 'baku']) {
        const out = SceneryInfrastructure.buildInfrastructure(
            contesto(id, { palette: PALETTE_ESISTENTI }));
        for (let i = 0; i < out.length; i++) {
            for (let j = i + 1; j < out.length; j++) {
                assert.ok(!SceneryAssetSizes.itemsOverlap(out[i], out[j]),
                    `${id}: ${out[i].asset} e ${out[j].asset} si compenetrano`);
            }
        }
    }
});

test('ogni infrastruttura guarda la pista che ha davanti', () => {
    for (const id of ['prova', 'new-monza', 'monte-rosso', 'baku']) {
        const ctx = contesto(id, { palette: PALETTE_ESISTENTI });
        for (const v of SceneryInfrastructure.buildInfrastructure(ctx)) {
            assert.ok(TrackGeometry.guardaVersoLaPista(ctx.trackPts, v),
                `${id}: ${v.asset} non guarda la pista`);
        }
    }
});

test('nessun angolo finisce dentro la via di fuga', () => {
    for (const id of ['prova', 'new-monza', 'monte-rosso', 'baku']) {
        const ctx = contesto(id, { palette: PALETTE_ESISTENTI });
        for (const v of SceneryInfrastructure.buildInfrastructure(ctx)) {
            for (const c of SceneryAssetSizes.footprintCorners(v)) {
                const q = TrackGeometry.nearestPoint(ctx.trackPts, c.x, c.z);
                const nrm = TrackGeometry.normalAt(ctx.trackPts, q.index, true);
                const lato = Math.sign((c.x - ctx.trackPts[q.index].x) * nrm.nx +
                                       (c.z - ctx.trackPts[q.index].z) * nrm.nz) || 1;
                const dentro = TrackGravel.barrierAt(ctx.barrierProfile, q.index, lato) - q.dist;
                assert.ok(dentro <= 0,
                    `${id}: un angolo di ${v.asset} è dentro la ghiaia di ${dentro.toFixed(2)}`);
            }
        }
    }
});

test('accanto a un tratto sopraelevato solo ciò che è più alto del dislivello', () => {
    const ctx = contesto('prova', { palette: PALETTE_ESISTENTI });
    for (const v of SceneryInfrastructure.buildInfrastructure(ctx)) {
        const q = TrackGeometry.nearestPoint(ctx.trackPts, v.x, v.z);
        const c = SceneryInfrastructure.contestoAl(ctx, q.index, 1);
        if (!c.viadotto) continue;
        const alto = SceneryAssetSizes.sizeOf(v.asset).h;
        assert.ok(alto > c.dislivello,
            `${v.asset} è alto ${alto} accanto a un viadotto di ${c.dislivello.toFixed(1)}`);
    }
});

test('lo stesso tracciato dà sempre lo stesso layout', () => {
    const a = SceneryInfrastructure.buildInfrastructure(
        contesto('prova', { palette: PALETTE_ESISTENTI }));
    const b = SceneryInfrastructure.buildInfrastructure(
        contesto('prova', { palette: PALETTE_ESISTENTI }));
    assert.deepEqual(a, b, 'il layout deve essere deterministico');
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test frontend/shared/sceneryInfrastructure.test.js`
Expected: FAIL sul primo (`solo 0 infrastrutture posate`); gli altri passano a vuoto perché l'array è vuoto.

- [ ] **Step 3: Scrivere la camminata e i vincoli**

In `frontend/shared/sceneryInfrastructure.js` sostituire il corpo di `buildInfrastructure`:

```javascript
    // Quale gruppo di contesti descrive questo punto, in ordine di
    // specificità: il viadotto vince su tutto (è un vincolo, non una
    // preferenza), poi l'esterno curva, poi la visuale lunga.
    function etichette(c) {
        if (c.viadotto) return ['viadotto'];
        const out = [];
        if (c.curva && c.esterno) out.push('curvaEsterno');
        if (c.visuale) out.push('rettilineo');
        out.push('stretto');
        return out;
    }

    function buildInfrastructure(ctx) {
        const { trackPts, pitPts, barrierDist, pitRoadHalf, barrierProfile,
                accepted = [], grandstands = [], spanning = [], palette } = ctx;
        if (!palette || !palette.length) return [];

        const n = trackPts.length;
        const giro = TrackGeometry.lapLength(trackPts);
        const passoCampioni = Math.max(1, Math.round(PASSO / (giro / n)));
        const groundPts = trackPts.filter(p => !p.bridge);
        const curve = SceneryTrackside.findCorners(trackPts);
        const fitsUnderBridge = ctx.fitsUnderBridge || (() => true);
        const insideBox = ctx.insidePlayerBoxFootprint || (() => false);

        const posate = [];

        for (let i = 0; i < n; i += passoCampioni) {
            for (const lato of [1, -1]) {
                const c = contestoAl({ ...ctx, groundPts, curve }, i, lato);
                const gruppi = etichette(c);

                // Lista di preferenza: il primo asset il cui contesto combacia,
                // nell'ordine in cui la palette li elenca. Non una scelta sola:
                // se il primo non entra si prova il successivo.
                const candidati = [];
                for (const g of gruppi) {
                    for (const voce of palette) {
                        if (voce.contesti.indexOf(g) >= 0 && candidati.indexOf(voce) < 0) {
                            candidati.push(voce);
                        }
                    }
                }

                for (const voce of candidati) {
                    const dim = SceneryAssetSizes.sizeOf(voce.asset);
                    if (!dim) continue;

                    // VINCOLO 7 — accanto a un tratto sopraelevato solo ciò che
                    // è più alto del dislivello: sotto quella soglia l'oggetto
                    // sprofonda fuori dalla vista di chi guida.
                    if (c.viadotto && dim.h <= c.dislivello) continue;

                    // Spaziatura per famiglia: le gru non si ammucchiano e due
                    // maxischermi non si vedono insieme.
                    const troppoVicino = posate.some(v => v.asset === voce.asset
                        && Math.hypot(v.x - trackPts[i].x, v.z - trackPts[i].z) < voce.passoMinimo);
                    if (troppoVicino) continue;

                    // Posa: oltre il muro del PROPRIO lato, guardando la pista.
                    const d = c.muro + MARGINE_DAL_MURO + dim.d / 2;
                    const nrm = TrackGeometry.normalAt(trackPts, i, true);
                    const x = trackPts[i].x + nrm.nx * d * lato;
                    const z = trackPts[i].z + nrm.nz * d * lato;
                    const y = TrackGeometry.terrainHeightAt(
                        groundPts, x, z, ctx.embankStart, ctx.embankOuter);
                    const cand = {
                        asset: voce.asset, category: 'infrastructure',
                        suMisuraSulMuro: !!barrierProfile,
                        x, y, z,
                        rotY: Math.atan2(trackPts[i].x - x, trackPts[i].z - z),
                        scale: 1,
                    };

                    // VINCOLO 6 — deve guardare la pista che ha davvero davanti.
                    if (!TrackGeometry.guardaVersoLaPista(trackPts, cand)) continue;
                    // VINCOLO 3 — corsia box e box giocatore.
                    if (TrackGeometry.nearestPoint(pitPts, x, z).dist
                        < pitRoadHalf + dim.d / 2 + 6) continue;
                    if (insideBox(x, z, ctx.playerBoxFootprints)) continue;
                    // VINCOLO 4 — cavalcavia e campate.
                    if (!fitsUnderBridge(voce.asset, x, z, y)) continue;
                    if (spanning.some(p => SceneryAssetSizes.itemsOverlap(cand, p))) continue;
                    // VINCOLO 2 — mai dentro un'altra struttura.
                    if (accepted.some(p => SceneryAssetSizes.itemsOverlap(cand, p))) continue;
                    if (posate.some(p => SceneryAssetSizes.itemsOverlap(cand, p))) continue;
                    // VINCOLO 5 — mai nella fascia davanti a una tribuna.
                    if (davantiAUnaTribuna(cand, grandstands)) continue;
                    // VINCOLO 1 — mai nella via di fuga, sui QUATTRO angoli.
                    if (barrierProfile && SceneryAssetSizes.footprintCorners(cand).some(k => {
                        const q = TrackGeometry.nearestPoint(trackPts, k.x, k.z);
                        const nq = TrackGeometry.normalAt(trackPts, q.index, true);
                        const l = Math.sign((k.x - trackPts[q.index].x) * nq.nx +
                                            (k.z - trackPts[q.index].z) * nq.nz) || 1;
                        return TrackGravel.barrierAt(barrierProfile, q.index, l) - q.dist > 0;
                    })) continue;

                    posate.push(cand);
                    break;   // uno per punto e per lato
                }
            }
        }
        return posate;
    }

    // La stessa fascia usata da trackScenery.js: larga quanto la tribuna,
    // profonda FASCIA_DAVANTI_TRIBUNA verso la pista.
    function davantiAUnaTribuna(v, grandstands) {
        return grandstands.some(g => {
            const co = Math.cos(g.rotY || 0), si = Math.sin(g.rotY || 0);
            const dx = v.x - g.x, dz = v.z - g.z;
            const du = dx * co - dz * si;
            const df = dx * si + dz * co;
            const meta = (SceneryAssetSizes.sizeOf(g.asset).w * (g.scale || 1)
                        + SceneryAssetSizes.sizeOf(v.asset).w * (v.scale || 1)) / 2;
            return Math.abs(du) <= meta && df > 0 && df <= FASCIA_DAVANTI_TRIBUNA;
        });
    }
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test frontend/shared/sceneryInfrastructure.test.js`
Expected: PASS, 10 test. Il test della ghiaia è quello che più probabilmente si accende: se succede, **non allargare la tolleranza** — aumentare `MARGINE_DAL_MURO`, che è il parametro giusto da girare.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/sceneryInfrastructure.js frontend/shared/sceneryInfrastructure.test.js
git commit -m "F1: la camminata delle infrastrutture, con i sette vincoli

Cammina il giro a passo fisso in unita di pista, legge il contesto e
posa il primo asset di una lista di preferenza che superi tutti i
vincoli. Palette di soli asset esistenti: nessuna modellazione, ma la
macchina e completa e sotto test su tutti e quattro i tracciati."
```

---

### Task 5: innesto in `generateLayout` e stretta delle soglie

Il modulo entra in gioco. Da qui il circuito è visibilmente più pieno, ed è il momento di stringere le soglie del Task 2.

**Files:**
- Modify: `frontend/shared/trackScenery.js` (innesto e palette di produzione)
- Modify: `frontend/shared/trackScenery.test.js` (soglie strette)
- Modify: `frontend/f1.html` (cache-busting + il nuovo `<script>`)

**Interfaces:**
- Consumes: `SceneryInfrastructure.buildInfrastructure(ctx)`
- Produces: voci di categoria `infrastructure` nel layout restituito da `generateLayout`

- [ ] **Step 1: Aggiungere lo script alla pagina**

In `frontend/f1.html`, accanto agli altri moduli di scenografia e **prima** di `trackScenery.js` (che lo consuma):

```html
    <script src="shared/sceneryInfrastructure.js?v=20260813a"></script>
```

e bumpare `trackScenery.js?v=` alla lettera successiva.

⚠️ **`sceneryGaps.js` NON va nella pagina**: lo usano solo i test, il gioco non lo carica. Aggiungerlo sarebbe una richiesta HTTP in più a ogni partita per niente.

- [ ] **Step 2: Dichiarare la dipendenza nel modulo**

In testa a `frontend/shared/trackScenery.js`, nel wrapper UMD, aggiungere `require('./sceneryInfrastructure.js')` all'elenco dei moduli e `root.SceneryInfrastructure` al ramo browser, con il parametro corrispondente nella factory.

- [ ] **Step 3: Dichiarare la palette di produzione**

In `frontend/shared/trackScenery.js`, accanto alle altre costanti di scenografia (vicino a `STAND_VARIANTS`):

```javascript
    // Palette delle infrastrutture distribuite. Per ora solo asset che
    // esistono già: gli otto modelli nuovi della spec entrano qui, uno per
    // volta, man mano che il piano 2 li produce e l'utente ne approva il
    // render.
    //
    // L'ordine dentro ogni contesto è l'ordine di PREFERENZA: se il primo non
    // entra si prova il successivo, invece di lasciare un buco.
    const PALETTE_INFRASTRUTTURE = [
        { asset: 'pylon',        contesti: ['rettilineo', 'viadotto'], passoMinimo: 400 },
        { asset: 'flagPole',     contesti: ['curvaEsterno', 'stretto'], passoMinimo: 220 },
        { asset: 'billboardLow', contesti: ['rettilineo', 'stretto'],  passoMinimo: 160 },
    ];
```

- [ ] **Step 4: Innestare la chiamata**

In `generateLayout`, **dopo** `const trackside = SceneryTrackside.buildTrackside({...})` e **prima** di `accepted.push(...trackside.filter(...))`:

```javascript
        // Infrastrutture: dopo il trackside, così vedono tribune, reti, gomme
        // e landmark già posati; prima della natura, così sono gli alberi a
        // scansarsi da loro e non viceversa.
        //
        // RNG proprio, come folla e boschi: pescare dalla sequenza condivisa
        // legherebbe la scenografia a quante tribune ci sono a monte.
        const infrastrutture = SceneryInfrastructure.buildInfrastructure({
            trackPts, pitPts, barrierDist, pitRoadHalf, embankStart, embankOuter,
            barrierProfile, playerBoxFootprints, insidePlayerBoxFootprint,
            fitsUnderBridge,
            accepted: [...accepted, ...trackside],
            grandstands: [...mainStand, ...grandstand],
            spanning: landmarks.filter(v => v.asset === 'footbridge' || v.asset === 'startGantry'),
            rng: mulberry32(hashString(trackData.id + ':infra')),
            palette: PALETTE_INFRASTRUTTURE,
        });
        accepted.push(...infrastrutture);
```

e aggiungere `...infrastrutture` all'array `layout` fra `...trackside` e `...nature`.

- [ ] **Step 5: Misurare quanto si è riempito**

Run:
```bash
node -e "
const fs=require('fs');
const TG=require('./frontend/shared/trackGeometry.js');
const GAPS=require('./frontend/shared/sceneryGaps.js');
const TS=require('./frontend/shared/trackScenery.js');
const {loadTrack}=require('./backend/sockets/games/trackLoader.js');
for(const id of ['prova','new-monza','monte-rosso','baku']){
  const raw=JSON.parse(fs.readFileSync('./frontend/tracks/'+id+'.json','utf8'));
  const t=loadTrack(id);
  const L=TS.generateLayout(raw,t.points,t.pitLanePts,raw.roadHalfWidth+4,45,null,t.barrierProfile);
  const tratti=GAPS.trattiVuoti(t.points,L);
  const giro=TG.lapLength(t.points);
  const aTerra=tratti.filter(x=>!x.suViadotto);
  const dx=tratti.filter(x=>x.lato===1).reduce((s,x)=>s+x.lunghezza,0)/giro;
  const sx=tratti.filter(x=>x.lato===-1).reduce((s,x)=>s+x.lunghezza,0)/giro;
  console.log(id.padEnd(12),
    L.filter(v=>v.category==='infrastructure').length+' infrastrutture,',
    'peggior vuoto a terra '+(aTerra[0]?aTerra[0].lunghezza.toFixed(0):0),
    'dx '+(dx*100).toFixed(0)+'% sx '+(sx*100).toFixed(0)+'%');
}"
```

Annotare i quattro risultati: sono i numeri con cui si stringono le soglie.

- [ ] **Step 6: Stringere le soglie del Task 2**

In `frontend/shared/trackScenery.test.js`, aggiornare `VUOTI_ATTESI` con i numeri misurati **arrotondati per eccesso del 10%**, e aggiornare il commento sopra spiegando da dove vengono.

⚠️ **L'obiettivo della spec è dimezzare i numeri di partenza (peggior vuoto 315, quote 33% e 42% su `prova`).** Se la misura del passo 5 non ci arriva, **non** scrivere soglie compiacenti: fermarsi, dirlo all'utente, e proporre di girare `PASSO` (25) o `MARGINE_DAL_MURO` (8), o di anticipare un asset del piano 2.

- [ ] **Step 7: Eseguire tutta la suite**

Run: `node --test --test-concurrency=1`
Expected: esattamente **4 falliti**, quelli preesistenti elencati nei Global Constraints. Qualunque quinto rosso è una regressione da risolvere prima di committare.

- [ ] **Step 8: Riavviare il server e guardare in gioco**

```bash
node backend/server.js
```
(senza pipe). Poi `localhost:3000`, **Ctrl+F5**, e un giro di `prova` guardando i punti M 24-35.

- [ ] **Step 9: Commit**

```bash
git add frontend/shared/trackScenery.js frontend/shared/trackScenery.test.js frontend/f1.html
git commit -m "F1: le infrastrutture entrano nel layout

Innestate fra trackside e natura, con RNG proprio e palette dei soli
asset esistenti. Le soglie dei tratti vuoti sono state strette sui
numeri misurati."
```

---

### Task 6: lo strumento del costo

Un comando che dice quanto costa la scenografia, per categoria e per asset, leggendo i `.glb` veri. Serve a tenere il budget prima che il piano 2 aggiunga otto modelli.

**Files:**
- Create: `backend/tools/f1-costo-scenografia.js`
- Test: nessuno — è uno strumento diagnostico, come `backend/tools/f1-segnalazioni.js`

**Interfaces:**
- Consumes: `TrackScenery.generateLayout`, i `.glb` in `frontend/assets/custom/circuit/`
- Produces: un rapporto su stdout

- [ ] **Step 1: Scrivere lo strumento**

Creare `backend/tools/f1-costo-scenografia.js`:

```javascript
// Quanto costa la scenografia di un circuito: istanze, InstancedMesh e
// triangoli, per categoria e per asset, letti dai .glb veri.
//
// Uso:  node backend/tools/f1-costo-scenografia.js [tracciato ...]
//
// Il numero che conta NON è il triangolo — questi asset sono leggeri — ma
// l'InstancedMesh: f1.js::loadScenery ne crea uno per ogni mesh di ogni asset
// in ogni cella di sceneryChunks che quell'asset occupa, e ogni InstancedMesh
// è una draw call. Un asset con sei materiali ne costa il doppio di uno con
// tre, a parità di istanze.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const TrackScenery = require(path.join(ROOT, 'frontend/shared/trackScenery.js'));
const SceneryChunks = require(path.join(ROOT, 'frontend/shared/sceneryChunks.js'));
const { loadTrack } = require(path.join(ROOT, 'backend/sockets/games/trackLoader.js'));
const seats = require(path.join(ROOT, 'frontend/assets/custom/circuit/grandStandSeats.json')).seats;

const CARTELLE = [path.join(ROOT, 'frontend/assets/custom/circuit'),
                  path.join(ROOT, 'frontend/assets/kenney')];

function leggiGlb(file) {
    const buf = fs.readFileSync(file);
    const lunghezza = buf.readUInt32LE(12);
    const json = JSON.parse(buf.slice(20, 20 + lunghezza).toString('utf8'));
    let tri = 0, mesh = 0;
    for (const m of json.meshes || []) {
        for (const p of m.primitives) {
            mesh++;
            tri += (p.indices !== undefined ? json.accessors[p.indices].count
                                            : json.accessors[p.attributes.POSITION].count) / 3;
        }
    }
    return { tri, mesh };
}

const cache = new Map();
function costoDi(asset) {
    if (!cache.has(asset)) {
        let out = null;
        for (const c of CARTELLE) {
            const f = path.join(c, asset + '.glb');
            if (fs.existsSync(f)) { out = leggiGlb(f); break; }
        }
        cache.set(asset, out);
    }
    return cache.get(asset);
}

const tracciati = process.argv.slice(2).length ? process.argv.slice(2)
                : ['prova', 'new-monza', 'monte-rosso', 'baku'];

for (const id of tracciati) {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/tracks', id + '.json'), 'utf8'));
    const t = loadTrack(id);
    const layout = TrackScenery.generateLayout(raw, t.points, t.pitLanePts,
        raw.roadHalfWidth + 4, 45, seats, t.barrierProfile);

    const perAsset = new Map();
    for (const v of layout) {
        if (v.category === 'pond' || v.category === 'parkingLot') continue;
        if (!perAsset.has(v.asset)) perAsset.set(v.asset, []);
        perAsset.get(v.asset).push(v);
    }

    let istanze = 0, gruppi = 0, triangoli = 0;
    const perCategoria = new Map();
    const righe = [];
    for (const [asset, items] of perAsset) {
        const c = costoDi(asset);
        const celle = items.length >= SceneryChunks.MIN_FOR_SPLIT
            ? SceneryChunks.groupByCell(items, SceneryChunks.CELL).size : 1;
        const mesh = celle * (c ? c.mesh : 1);
        const tri = (c ? c.tri : 0) * items.length;
        istanze += items.length; gruppi += mesh; triangoli += tri;
        righe.push({ asset, n: items.length, mesh, tri, cat: items[0].category });
        const acc = perCategoria.get(items[0].category) || { n: 0, mesh: 0, tri: 0 };
        acc.n += items.length; acc.mesh += mesh; acc.tri += tri;
        perCategoria.set(items[0].category, acc);
    }

    console.log(`\n=== ${id} ===  ${istanze} istanze, ${gruppi} InstancedMesh, `
        + `${(triangoli / 1000).toFixed(0)}k triangoli`);
    console.log('  per categoria:');
    for (const [cat, v] of [...perCategoria].sort((a, b) => b[1].mesh - a[1].mesh)) {
        console.log(`    ${cat.padEnd(18)} ${String(v.n).padStart(5)} istanze  `
            + `${String(v.mesh).padStart(4)} mesh  ${(v.tri / 1000).toFixed(0).padStart(5)}k tri`);
    }
    console.log('  i 10 asset che costano più draw call:');
    for (const r of righe.sort((a, b) => b.mesh - a.mesh).slice(0, 10)) {
        console.log(`    ${r.asset.padEnd(20)} ${String(r.n).padStart(4)} istanze  `
            + `${String(r.mesh).padStart(4)} mesh  ${(r.tri / 1000).toFixed(0).padStart(5)}k tri`);
    }
}
```

- [ ] **Step 2: Eseguirlo e annotare il bilancio di partenza**

Run: `node backend/tools/f1-costo-scenografia.js`
Expected: quattro rapporti. Annotare i totali di `prova` — sono il riferimento contro cui il piano 2 misurerà gli otto asset nuovi.

- [ ] **Step 3: Documentarlo**

In `docs/f1-notes.md`, nella sezione "Asset voxel del circuito", aggiungere sotto "Verifiche":

```markdown
### Budget di rendering

```
node backend/tools/f1-costo-scenografia.js [tracciato ...]
```

Stampa istanze, `InstancedMesh` e triangoli per categoria e per asset. Il
numero che conta non è il triangolo — gli asset del circuito sono leggeri —
ma l'`InstancedMesh`: `f1.js::loadScenery` ne crea uno per ogni mesh di ogni
asset in ogni cella di `sceneryChunks`, e ognuno è una draw call. Un asset con
sei materiali costa il doppio di uno con tre a parità di istanze — ed è la
ragione per cui i nuovi asset vanno tenuti sotto quattro materiali.
```

- [ ] **Step 4: Commit**

```bash
git add backend/tools/f1-costo-scenografia.js docs/f1-notes.md
git commit -m "F1: strumento per il budget di rendering della scenografia

Istanze, InstancedMesh e triangoli per categoria e per asset, dai .glb
veri. Serve a tenere il conto delle draw call prima che il piano 2
aggiunga otto asset."
```

---

### Task 7: gate utente

Non è un task di codice: è il punto in cui il piano si ferma e chiede.

- [ ] **Step 1: Riassumere all'utente**

Presentare, con i numeri veri misurati:
- quante infrastrutture sono comparse su ciascun tracciato;
- di quanto sono scesi il peggior vuoto a terra e le quote per lato, contro i 315 / 33% / 42% di partenza;
- il bilancio di rendering prima e dopo, da `f1-costo-scenografia.js`;
- che la palette è per ora fatta di `pylon`, `flagPole` e `billboardLow`, cioè di asset che esistevano già.

- [ ] **Step 2: Chiedere il giudizio sul colpo d'occhio**

Le domande da fare esplicitamente:
1. Il circuito si legge come più pieno, o come più disordinato?
2. Il passo di 25 unità e i passi minimi per famiglia danno una distribuzione credibile, o si vedono ammassamenti e vuoti?
3. Le prestazioni tengono? (pannello **F9**, che spegne per categoria senza ricaricare)

- [ ] **Step 3: Decidere il piano 2**

Solo dopo la risposta si scrive il piano 2 (gli otto modelli Blender). Se il colpo d'occhio non convince, si corregge qui la distribuzione — è molto più economico che scoprirlo dopo aver modellato otto asset.

---

## Note per chi esegue

**Se un test di ghiaia si accende**, il parametro da girare è `MARGINE_DAL_MURO`, non la tolleranza del test. Il vincolo «niente dentro la via di fuga» è costato due round di playtest e non si negozia.

**Se le infrastrutture risultano poche**, nell'ordine: abbassare `PASSO` (25 → 15), abbassare i `passoMinimo` della palette, allargare i contesti di un asset. **Non** togliere vincoli.

**Se un test di scenografia preesistente si accende**, è una regressione vera: le infrastrutture entrano in `accepted` e tolgono posto a natura, boschi e rocce. Il caso già visto è `nessuna direzione verso la campagna resta senza vegetazione`, che misura le direzioni spoglie sull'orizzonte. Se succede, la risposta giusta è restringere che cosa entra in `accepted` per il verde, non alzare la soglia del test.

**Il pannello F9** in gioco spegne e riaccende per asset senza ricaricare la pagina: è il modo più rapido per capire da dove viene un calo di prestazioni.
