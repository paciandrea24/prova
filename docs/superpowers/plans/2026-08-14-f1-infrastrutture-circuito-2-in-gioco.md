# Infrastrutture di circuito — Piano 2: gli otto asset entrano in gioco

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** portare in pista gli otto modelli già approvati, riempiendo i tratti
vuoti con VOLUMI e non con segnaletica, e stringere sui numeri veri le soglie
dei tratti spogli.

**Architecture:** la macchina esiste già ed è ferma per mancanza di
carburante. `SceneryInfrastructure.buildInfrastructure` è innestato in
`generateLayout` da `281ac4d`, ma la sua palette è un array vuoto. Questo piano
(a) dichiara l'ingombro degli asset, (b) li fa caricare al gioco, (c) rifà la
tassonomia dei contesti, che oggi ha un ripiego buono-per-tutto, (d) riempie la
palette, (e) mette gli spettatori sulle terrazze, (f) misura e stringe.

**Tech Stack:** JavaScript vanilla in stile UMD (`frontend/shared/*.js`), test
con `node --test`. Gli asset sono già modellati: Python + Blender si toccano
solo nel Task 5, per le ancore degli spettatori.

**Spec:** `docs/superpowers/specs/2026-08-13-f1-infrastrutture-circuito-design.md`

**Piano 1 (il modulo):** `docs/superpowers/plans/2026-08-13-f1-infrastrutture-circuito-1-modulo.md` — eseguito per intero.

## Da dove si riparte

Gli otto `.glb` sono fatti, approvati dall'utente e committati (`7576341`,
`27b2cd0`). **In gioco non si vede ancora niente**, e non per un bug: la
palette è vuota di proposito dal `7b3fab4`.

⚠️ **Il 2026-08-13 un playtest ha bocciato il primo tentativo di riempimento.**
Avevo usato asset che esistevano già — `pylon`, `flagPole`, `billboardLow` — per
giudicare la distribuzione prima di modellare. Verdetto: *«non hai riempito
niente, hai solo inserito cartelloni in posti sbagliati»*. **Riempire un
circuito vuole volumi, non segnaletica sparsa.** Da qui una regola che vale per
tutto questo piano:

> Nella palette entrano **solo gli otto modelli nuovi**. Niente `banner`,
> `billboardLow`, `flagPole`, `pylon`, nemmeno come riempimento «dove non entra
> altro» — anche se la spec li elencava. Se restano vuoti, si affronta il vuoto,
> non lo si maschera.

## Cosa questo piano NON copre

- **Nuovi modelli**: gli otto sono chiusi. Se un contesto resta scoperto, la
  risposta sta nei parametri di distribuzione, non in un nono asset.
- **Il tratto 143-197 di `prova`**: non è riempibile e non va riempito. Lì la
  pista fa un tornante e le due branche si sfiorano; un oggetto alla distanza
  normale dal muro cadrebbe a 3 unità dal campione 513, cioè in mezzo alla
  carreggiata dell'altro ramo. È `guardaVersoLaPista` a rifiutarlo, e fa bene.
- **`baku`**: 909 campioni su 1000 sono viadotto. Non ha vuoti a terra da
  riempire; le sue soglie servono solo a non farlo peggiorare.

## Global Constraints

Valgono per **ogni** task, sono costati playtest e non si negoziano:

- **Italiano** nei commenti del codice e nei messaggi di commit. ⚠️ Niente
  lettere accentate nei messaggi di commit (il resto del branch non ne ha).
- **Ogni soglia geometrica in unità di pista, mai in campioni.** Un campione
  vale 5.17 unità su `prova`, 3.21 su `new-monza`, 1.18 su `monte-rosso`, 2.71
  su `baku`: una soglia "in campioni" ha quattro comportamenti diversi in
  silenzio.
- **Ingombro reale orientato, mai distanza fra centri**, per l'anti-compenetrazione:
  `SceneryAssetSizes.itemsOverlap`. Le distanze fra centri esprimono solo
  intenzioni di composizione («non ammucchiare»).
- **`findCorners(...).side` è il lato ESTERNO** della curva. Chi vuole l'interno
  usa `-corner.side`.
- **RNG proprio e seedato** (`mulberry32(hashString(id + ':infra'))`), mai
  pescare dalla sequenza condivisa: la fittezza dei boschi ne dipende.
- **Misurare sempre su tutti e quattro i tracciati**: `prova`, `new-monza`,
  `monte-rosso`, `baku`.
- **Bump del cache-busting** in `frontend/f1.html` a ogni modifica di un file
  `frontend/shared/*.js`, altrimenti il browser serve JS vecchio e sembra che il
  lavoro non abbia effetto.
- **Riavviare il server** dopo ogni modifica ai moduli di `frontend/shared/`.
  **Senza pipe**: `node server.js | head -20` lo uccide via SIGPIPE.
- **Commit a ogni task**, mai `push` (lo fa l'utente a mano).
- I **4 test rossi preesistenti** del repo non sono regressioni: isolamento
  componenti Simcade, due `loadTrack("monte-rosso")`, una taratura di
  `simulateLap`. Verificare che restino esattamente quattro.

## I numeri di partenza

Misurati il 2026-08-13/14 e citati dai task. **Le soglie si stringono, mai si
allargano.**

Tratti senza niente di fianco (`sceneryGaps.trattiVuoti`), prima → col
tentativo di segnaposto bocciato:

```
                 peggiore a terra        lato dx          lato sx
    prova           315 →  284          33% → 27%        42% → 23%
    new-monza       215 →  157          17% →  5%        18% →  7%
    monte-rosso     116 →   24           5% →  0%        18% →  4%
    baku              0 →    0          78% → 65%        83% → 83%
```

Ingombro reale dei `.glb` (`w × h × d`, unità di gioco):

| asset | w | h | d | mat |
|---|---|---|---|---|
| `giantScreen` | 15.0 | 17.9 | 2.5 | 5 |
| `floodlightTower` | 7.6 | 32.5 | 4.0 | 4 |
| `hospitalityDeck` | 16.0 | 9.7 | 11.0 | 4 |
| `vipSuite` | 16.3 | 12.1 | 12.5 | 5 |
| `serviceBuilding` | 13.6 | 16.1 | 12.1 | 5 |
| `tvTower` | 4.8 | 15.2 | 5.4 | 5 |
| `recoveryCrane` | 10.3 | 15.0 | 12.4 | 4 |
| `trackGate` | 9.3 | 5.2 | 1.5 | 5 |
| `spectatorStandA`/`B` | 0.9 | 2.3 | 0.4 | 4 |

Peso dei contesti con la tassonomia del Task 3 (passo 25, due lati):

| tracciato | punti | viadotto | stretto | curvaEsterno | rettilineo | aperto |
|---|---|---|---|---|---|---|
| `prova` | 400 | 20% | 18% | 8% | 31% | 24% |
| `new-monza` | 250 | 0% | 19% | 10% | 49% | 22% |
| `monte-rosso` | 96 | 0% | 31% | 6% | 21% | 42% |
| `baku` | 224 | 90% | 10% | 0% | 0% | 0% |

---

### Task 1: l'ingombro degli otto asset, e un test che lo tiene onesto

Senza una voce in `sceneryAssetSizes.js` ogni asset vale `FALLBACK`, cioè
6 × 6 × 6: l'anti-compenetrazione lavorerebbe su un cubetto invece che su un
edificio, e il vincolo del viadotto vedrebbe alto 6 anche ciò che è alto 32.

**Files:**
- Modify: `frontend/shared/sceneryAssetSizes.js`
- Test: `frontend/shared/sceneryAssetSizes.test.js`
- Modify: `docs/f1-notes.md` (tabella degli asset voxel)

**Interfaces:**
- Consumes: i `.glb` in `frontend/assets/custom/circuit/`
- Produces: `SceneryAssetSizes.sizeOf(asset) -> {w, h, d}` per gli otto asset
  nuovi e per `spectatorStandA`/`spectatorStandB`

- [ ] **Step 1: Scrivere il test che fallisce**

In fondo a `frontend/shared/sceneryAssetSizes.test.js`:

```javascript
// ---- le misure dichiarate devono essere quelle dei .glb ----
//
// Una misura sbagliata non rompe niente in modo evidente: produce solo
// compenetrazioni che si vedono guardando il circuito, cioè al playtest. Qui
// si legge la bounding box vera dal file e si confronta.
const fs = require('fs');
const path = require('path');

// glTF ha Y in alto, e l'export Blender mappa (x,y,z)_blender -> (x,z,-y)_gltf:
// quindi w = X, h = Y, d = Z, le stesse tre lettere di SIZES.
function ingombroGlb(asset) {
    const file = path.join(__dirname, '..', 'assets', 'custom', 'circuit', asset + '.glb');
    if (!fs.existsSync(file)) return null;
    const buf = fs.readFileSync(file);
    const json = JSON.parse(buf.slice(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const m of json.meshes || []) {
        for (const p of m.primitives) {
            const acc = json.accessors[p.attributes.POSITION];
            for (let i = 0; i < 3; i++) {
                lo[i] = Math.min(lo[i], acc.min[i]);
                hi[i] = Math.max(hi[i], acc.max[i]);
            }
        }
    }
    return { w: hi[0] - lo[0], h: hi[1] - lo[1], d: hi[2] - lo[2], base: lo[1] };
}

const INFRASTRUTTURE = ['giantScreen', 'floodlightTower', 'hospitalityDeck',
                        'vipSuite', 'serviceBuilding', 'tvTower',
                        'recoveryCrane', 'trackGate',
                        'spectatorStandA', 'spectatorStandB'];

for (const asset of INFRASTRUTTURE) {
    test(`${asset}: le misure dichiarate sono quelle del .glb`, () => {
        const vero = ingombroGlb(asset);
        assert.ok(vero, `manca frontend/assets/custom/circuit/${asset}.glb`);
        const detto = SceneryAssetSizes.sizeOf(asset);
        for (const k of ['w', 'h', 'd']) {
            assert.ok(Math.abs(detto[k] - vero[k]) <= 0.15,
                `${asset}.${k}: dichiarato ${detto[k]}, misurato ${vero[k].toFixed(2)}`);
        }
        // Pivot alla base: il layout piazza gli oggetti a terrainHeightAt, e un
        // modello che parte sotto lo zero affonda nel terreno.
        assert.ok(Math.abs(vero.base) <= 0.05,
            `${asset}: la base del modello è a y=${vero.base.toFixed(2)}, non a 0`);
    });
}
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test frontend/shared/sceneryAssetSizes.test.js`
Expected: FAIL dieci volte, con `giantScreen.w: dichiarato 6, misurato 15.00` —
è il `FALLBACK` che risponde al posto della voce mancante.

- [ ] **Step 3: Dichiarare le misure**

In `frontend/shared/sceneryAssetSizes.js`, dentro `SIZES`, dopo `footbridge`:

```javascript
        // Infrastrutture di circuito (spec 2026-08-13), misurate sui .glb dal
        // test qui accanto: se qualcuno rigenera un modello con dimensioni
        // diverse e si dimentica di aggiornare questa riga, il test lo dice.
        giantScreen:       { w: 15.0, h: 17.9, d: 2.5 },
        floodlightTower:   { w: 7.6,  h: 32.5, d: 4.0 },
        hospitalityDeck:   { w: 16.0, h: 9.7,  d: 11.0 },
        vipSuite:          { w: 16.3, h: 12.1, d: 12.5 },
        serviceBuilding:   { w: 13.6, h: 16.1, d: 12.1 },
        tvTower:           { w: 4.8,  h: 15.2, d: 5.4 },
        recoveryCrane:     { w: 10.3, h: 15.0, d: 12.4 },
        trackGate:         { w: 9.3,  h: 5.2,  d: 1.5 },
        // Spettatori in piedi: i modelli e il caricamento esistevano già dal
        // 2026-08-09, ma non li piazzava nessuno. Li usa il Task 5.
        spectatorStandA:   { w: 0.9,  h: 2.3,  d: 0.4 },
        spectatorStandB:   { w: 0.9,  h: 2.3,  d: 0.4 },
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `node --test frontend/shared/sceneryAssetSizes.test.js`
Expected: PASS. Se una misura sfora di poco, **scrivere il valore misurato**,
non allargare la tolleranza.

- [ ] **Step 5: Aggiornare la tabella della documentazione**

In `docs/f1-notes.md`, nella tabella `| asset | largh (X) | alt (Y) | prof (Z) | mesh |`,
aggiungere in fondo:

```markdown
| `giantScreen` | 15.0 | 17.9 | 2.5 | 5 |
| `floodlightTower` | 7.6 | 32.5 | 4.0 | 4 |
| `hospitalityDeck` | 16.0 | 9.7 | 11.0 | 4 |
| `vipSuite` | 16.3 | 12.1 | 12.5 | 5 |
| `serviceBuilding` | 13.6 | 16.1 | 12.1 | 5 |
| `tvTower` | 4.8 | 15.2 | 5.4 | 5 |
| `recoveryCrane` | 10.3 | 15.0 | 12.4 | 4 |
| `trackGate` | 9.3 | 5.2 | 1.5 | 5 |
```

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/sceneryAssetSizes.js frontend/shared/sceneryAssetSizes.test.js docs/f1-notes.md
git commit -m "F1: l'ingombro degli otto asset delle infrastrutture

Senza una voce qui ogni asset valeva FALLBACK 6x6x6: l'anti-compenetrazione
avrebbe lavorato su un cubetto invece che su un edificio, e il vincolo del
viadotto avrebbe visto alto 6 anche cio' che e' alto 32.

Il test legge la bounding box dai .glb veri e la confronta con la tabella,
cosi' una rigenerazione con misure diverse non puo' passare inosservata.
Verifica anche il pivot alla base, che il layout da' per scontato."
```

---

### Task 2: il gioco carica gli otto modelli

Finché `SCENERY_ASSET_PATHS` non li conosce, `loadScenery` non ha un file da
chiedere e le voci di layout non producono nessuna mesh.

**Files:**
- Modify: `frontend/f1.js` (`SCENERY_ASSET_PATHS`, `NO_SHADOW_ASSETS`)
- Modify: `frontend/f1.html` (cache-busting)

**Interfaces:**
- Consumes: i `.glb` in `frontend/assets/custom/circuit/`
- Produces: nulla di programmatico — abilita il rendering delle voci
  `category: 'infrastructure'`

- [ ] **Step 1: Aggiungere i percorsi**

In `frontend/f1.js`, dentro `SCENERY_ASSET_PATHS`, accanto agli altri custom:

```javascript
        // Infrastrutture di circuito (spec 2026-08-13): modellate 1:1 in unità
        // di gioco come gli altri custom, quindi istanziate con scale 1.
        giantScreen: '/assets/custom/circuit/giantScreen.glb',
        floodlightTower: '/assets/custom/circuit/floodlightTower.glb',
        hospitalityDeck: '/assets/custom/circuit/hospitalityDeck.glb',
        vipSuite: '/assets/custom/circuit/vipSuite.glb',
        serviceBuilding: '/assets/custom/circuit/serviceBuilding.glb',
        tvTower: '/assets/custom/circuit/tvTower.glb',
        recoveryCrane: '/assets/custom/circuit/recoveryCrane.glb',
        trackGate: '/assets/custom/circuit/trackGate.glb',
```

- [ ] **Step 2: Togliere l'ombra a ciò che non deve proiettarla**

In `frontend/f1.js`, in `NO_SHADOW_ASSETS`, aggiungere una riga:

```javascript
        // La torre faro è alta 32.5: la sua ombra attraversa la pista da parte
        // a parte e si muove col sole, ed è l'oggetto sbagliato su cui spendere
        // la risoluzione della shadow map. Gli spettatori in piedi seguono la
        // stessa regola dei loro fratelli seduti.
        'floodlightTower', 'spectatorStandA', 'spectatorStandB',
```

- [ ] **Step 3: Bumpare il cache-busting**

In `frontend/f1.html`, alzare alla lettera successiva il `?v=` di `f1.js`.
Nessun modulo `frontend/shared/*.js` è stato toccato in questo task, quindi
basta quello.

- [ ] **Step 4: Verificare che i file esistano davvero**

Run:
```bash
node -e "
const fs=require('fs');
for (const a of ['giantScreen','floodlightTower','hospitalityDeck','vipSuite',
                 'serviceBuilding','tvTower','recoveryCrane','trackGate']) {
  const p='./frontend/assets/custom/circuit/'+a+'.glb';
  console.log(a.padEnd(18), fs.existsSync(p) ? 'ok' : 'MANCA');
}"
```
Expected: otto `ok`. Un `MANCA` qui diventerebbe un 404 a ogni partita.

- [ ] **Step 5: Commit**

```bash
git add frontend/f1.js frontend/f1.html
git commit -m "F1: il gioco carica gli otto modelli delle infrastrutture

Senza il percorso in SCENERY_ASSET_PATHS le voci di layout non producono
nessuna mesh. La torre faro non proietta ombra: alta 32.5, la sua ombra
attraversa la pista da parte a parte ed e' l'oggetto sbagliato su cui
spendere la shadow map."
```

---

### Task 3: i contesti — «stretto» diventa una misura, e nasce «aperto»

Qui si corregge il difetto emerso dal playtest. Oggi `etichette()` mette
`'stretto'` in fondo a **ogni** lista: è un ripiego buono-per-tutto, e un asset
che lo dichiara viene provato quasi ovunque. Sui tracciati veri quel ripiego
copre il **34% di `prova` e il 55% di `monte-rosso`**.

La correzione ha due parti. `stretto` diventa quello che la spec intendeva —
**muro della via di fuga sottile** — e i tratti larghi che non sono né curva
esterna né visuale lunga prendono un contesto proprio, `aperto`, invece di
finire nel ripiego.

Il numero non è inventato: il muro è **bimodale**. Sui quattro tracciati sta a
13-15 oppure a 29.8-32.8, e in mezzo non c'è quasi niente. **20 cade dentro il
salto.**

**Files:**
- Modify: `frontend/shared/sceneryInfrastructure.js`
- Test: `frontend/shared/sceneryInfrastructure.test.js`

**Interfaces:**
- Consumes: `contestoAl(ctx, idx, lato) -> {curva, esterno, viadotto, dislivello, muro, visuale}`
- Produces: `SceneryInfrastructure.etichette(c) -> string[]`, esportata (oggi è
  privata); `SceneryInfrastructure.MURO_STRETTO = 20`. I gruppi possibili
  diventano `'viadotto' | 'stretto' | 'curvaEsterno' | 'rettilineo' | 'aperto'`.

- [ ] **Step 1: Scrivere i test che falliscono**

In `frontend/shared/sceneryInfrastructure.test.js`, in fondo:

```javascript
// ---- la tassonomia dei contesti ----
//
// Il playtest del 2026-08-13 ha bocciato la distribuzione, e la causa non era
// solo la palette di segnaposto: 'stretto' era il ripiego di ogni punto che
// non fosse viadotto, curva esterna o visuale lunga — il 34% di prova e il 55%
// di monte-rosso. Un asset che lo dichiarava finiva ovunque.

test('stretto vuol dire muro sottile, non "tutto il resto"', () => {
    const ctx = contesto('prova');
    let stretti = 0, larghi = 0;
    for (let i = 0; i < ctx.trackPts.length; i += 5) {
        for (const lato of [1, -1]) {
            const c = SceneryInfrastructure.contestoAl(ctx, i, lato);
            if (c.viadotto) continue;
            const et = SceneryInfrastructure.etichette(c);
            if (et.indexOf('stretto') >= 0) {
                stretti++;
                assert.ok(c.muro <= SceneryInfrastructure.MURO_STRETTO,
                    `stretto con muro ${c.muro.toFixed(1)}, sopra la soglia`);
            } else {
                larghi++;
                assert.ok(c.muro > SceneryInfrastructure.MURO_STRETTO,
                    `non stretto con muro ${c.muro.toFixed(1)}, sotto la soglia`);
            }
        }
    }
    assert.ok(stretti > 0 && larghi > 0, 'servono entrambi i casi per dire qualcosa');
});

test('nessun contesto è il ripiego di mezzo circuito', () => {
    // La soglia è al 45%: 'aperto' arriva al 42% su monte-rosso ed è il
    // massimo legittimo misurato. Il vecchio 'stretto' stava al 55%.
    for (const id of ['prova', 'new-monza', 'monte-rosso']) {
        const ctx = contesto(id);
        const conta = new Map();
        let punti = 0;
        for (let i = 0; i < ctx.trackPts.length; i += 5) {
            for (const lato of [1, -1]) {
                const et = SceneryInfrastructure.etichette(
                    SceneryInfrastructure.contestoAl(ctx, i, lato));
                conta.set(et[0], (conta.get(et[0]) || 0) + 1);
                punti++;
            }
        }
        for (const [gruppo, n] of conta) {
            // Il viadotto è esente: su baku è il 90% del giro per costruzione,
            // ed è un fatto del tracciato, non una scelta di tassonomia.
            if (gruppo === 'viadotto') continue;
            assert.ok(n / punti <= 0.45,
                `${id}: il contesto ${gruppo} copre il ${(n / punti * 100).toFixed(0)}% del giro`);
        }
    }
});

test('il viadotto e il muro sottile non hanno ripieghi, i tratti larghi sì', () => {
    const ctx = contesto('prova');
    const viadotto = { viadotto: true, muro: 30, curva: false, esterno: false, visuale: true };
    assert.deepEqual(SceneryInfrastructure.etichette(viadotto), ['viadotto'],
        'accanto al viadotto vale il vincolo di altezza e nient\'altro');
    const stretto = { viadotto: false, muro: 14, curva: true, esterno: true, visuale: true };
    assert.deepEqual(SceneryInfrastructure.etichette(stretto), ['stretto'],
        'col muro sottile non c\'è spazio per gli asset dei tratti larghi');
    const curva = { viadotto: false, muro: 30, curva: true, esterno: true, visuale: false };
    assert.deepEqual(SceneryInfrastructure.etichette(curva), ['curvaEsterno', 'aperto'],
        'sui tratti larghi "aperto" fa da rete se lo specifico non entra');
    const dritto = { viadotto: false, muro: 30, curva: false, esterno: false, visuale: true };
    assert.deepEqual(SceneryInfrastructure.etichette(dritto), ['rettilineo', 'aperto']);
    const altro = { viadotto: false, muro: 30, curva: false, esterno: false, visuale: false };
    assert.deepEqual(SceneryInfrastructure.etichette(altro), ['aperto']);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test frontend/shared/sceneryInfrastructure.test.js`
Expected: FAIL con `SceneryInfrastructure.etichette is not a function`.

- [ ] **Step 3: Rifare la tassonomia**

In `frontend/shared/sceneryInfrastructure.js`, accanto alle altre costanti:

```javascript
    // Sotto questo muro il tratto è STRETTO. Non è un numero a sentimento: il
    // muro della via di fuga è bimodale sui quattro tracciati — sta a 13-15
    // dove la barriera è addosso alla pista, a 29.8-32.8 dove c'è la ghiaia, e
    // in mezzo non c'è quasi niente. 20 cade dentro il salto.
    const MURO_STRETTO = 20;
```

Sostituire `etichette` con:

```javascript
    // Quali gruppi di contesto descrivono questo punto, in ordine di
    // preferenza. Il primo è il contesto proprio, l'eventuale secondo è la
    // rete di sicurezza.
    //
    // ⚠️ Fino al 2026-08-13 'stretto' stava in fondo a OGNI lista, come
    // ripiego universale: copriva il 34% di prova e il 55% di monte-rosso, e
    // qualunque asset lo dichiarasse finiva sparso su mezzo circuito. È metà
    // della ragione per cui il playtest ha bocciato la distribuzione.
    function etichette(c) {
        // Il viadotto vince su tutto: non è una preferenza ma un vincolo
        // fisico, e ciò che è più basso del dislivello lì sparisce alla vista.
        if (c.viadotto) return ['viadotto'];
        // Muro sottile: la barriera è addosso alla pista e oltre c'è poco. Non
        // ha senso provarci prima gli asset dei tratti larghi.
        if (c.muro <= MURO_STRETTO) return ['stretto'];
        // Sui tratti larghi 'aperto' fa da rete: se l'asset del contesto
        // specifico non entra, si prova quello generico invece di lasciare un
        // buco.
        if (c.curva && c.esterno) return ['curvaEsterno', 'aperto'];
        if (c.visuale) return ['rettilineo', 'aperto'];
        return ['aperto'];
    }
```

Aggiungere `etichette` e `MURO_STRETTO` all'oggetto restituito dal modulo.

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test frontend/shared/sceneryInfrastructure.test.js`
Expected: PASS, 18 test. Se `nessun contesto è il ripiego di mezzo circuito`
fallisce su `monte-rosso`, **non alzare il 45%**: vuol dire che `aperto` è
diventato il nuovo catch-all e va spezzato.

- [ ] **Step 5: Bumpare il cache-busting**

In `frontend/f1.html`, alzare il `?v=` di `sceneryInfrastructure.js`.

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/sceneryInfrastructure.js frontend/shared/sceneryInfrastructure.test.js frontend/f1.html
git commit -m "F1: i contesti delle infrastrutture, senza piu' un ripiego universale

'stretto' era in fondo a ogni lista e copriva il 34% di prova e il 55% di
monte-rosso: qualunque asset lo dichiarasse finiva sparso su mezzo
circuito, ed e' meta' della ragione per cui il playtest ha bocciato la
distribuzione.

Ora 'stretto' e' il muro sottile e basta. La soglia di 20 non e' a
sentimento: il muro e' bimodale sui quattro tracciati, 13-15 oppure
29.8-32.8, e 20 cade dentro il salto. I tratti larghi che non sono ne'
curva esterna ne' visuale lunga hanno un contesto proprio, 'aperto', che
fa anche da rete per gli altri due."
```

---

### Task 4: la palette di produzione, e le soglie strette sui numeri veri

Il momento in cui il circuito cambia. Da qui in gioco si vede qualcosa.

**Files:**
- Modify: `frontend/shared/trackScenery.js` (`PALETTE_INFRASTRUTTURE`)
- Modify: `frontend/shared/trackScenery.test.js` (`VUOTI_ATTESI`)
- Modify: `frontend/f1.html` (cache-busting)

**Interfaces:**
- Consumes: `SceneryInfrastructure.buildInfrastructure(ctx)`, già innestato in
  `generateLayout`
- Produces: voci `category: 'infrastructure'` nel layout

- [ ] **Step 1: Riempire la palette**

In `frontend/shared/trackScenery.js`, sostituire `const PALETTE_INFRASTRUTTURE = [];`
(e il commento che spiega perché era vuota) con:

```javascript
    // Palette delle infrastrutture distribuite. Dentro ogni contesto l'ordine
    // è l'ordine di PREFERENZA: se il primo non entra si prova il successivo,
    // invece di lasciare un buco.
    //
    // ⚠️ SOLO i modelli nuovi. Il 2026-08-13 ci avevo messo `pylon`,
    // `flagPole` e `billboardLow` per giudicare la distribuzione prima di
    // modellare, e il playtest l'ha bocciata: «non hai riempito niente, hai
    // solo inserito cartelloni in posti sbagliati». Riempire un circuito vuole
    // VOLUMI. La segnaletica non torna qui nemmeno come ripiego.
    //
    // `passoMinimo` è la distanza minima in unità fra due esemplari dello
    // stesso asset: è ciò che distingue "distribuito" da "ammucchiato", e vale
    // per famiglia perché due gru vicine sono una stonatura mentre una gru e
    // una torretta TV vicine no.
    const PALETTE_INFRASTRUTTURE = [
        // Esterno curva: è il contesto che la spec voleva servire per primo,
        // ed è raro (6-10% del giro). Gli asset che ci vanno sono quelli che
        // "guardano" la curva.
        { asset: 'recoveryCrane',   contesti: ['curvaEsterno'],                     passoMinimo: 320 },
        { asset: 'tvTower',         contesti: ['curvaEsterno', 'viadotto'],         passoMinimo: 380 },
        { asset: 'hospitalityDeck', contesti: ['curvaEsterno', 'aperto'],           passoMinimo: 260 },
        { asset: 'vipSuite',        contesti: ['curvaEsterno', 'aperto'],           passoMinimo: 700 },
        // Visuale lunga: il maxischermo va visto da lontano, e uno solo per
        // volta — 900 unità su un giro di 5170 vuol dire al più cinque.
        { asset: 'giantScreen',     contesti: ['rettilineo', 'viadotto'],           passoMinimo: 900 },
        { asset: 'serviceBuilding', contesti: ['rettilineo', 'aperto'],             passoMinimo: 480 },
        { asset: 'floodlightTower', contesti: ['viadotto', 'rettilineo', 'aperto'], passoMinimo: 300 },
        // Muro sottile: l'unico degli otto abbastanza piatto (profondo 1.5).
        { asset: 'trackGate',       contesti: ['stretto'],                          passoMinimo: 220 },
    ];
```

⚠️ **`hospitalityDeck` è alto 9.7 e `trackGate` 5.2**: nessuno dei due dichiara
`viadotto`, ed è voluto — il dislivello arriva a 11.5 e ci sparirebbero sotto.
Il vincolo 7 del modulo li rifiuterebbe comunque, ma dichiararlo qui evita di
sprecare tentativi.

- [ ] **Step 2: Misurare quanto si è riempito**

Run:
```bash
node -e "
const fs=require('fs');
const TG=require('./frontend/shared/trackGeometry.js');
const GAPS=require('./frontend/shared/sceneryGaps.js');
const TS=require('./frontend/shared/trackScenery.js');
const {loadTrack}=require('./backend/sockets/games/trackLoader.js');
const seats=require('./frontend/assets/custom/circuit/grandStandSeats.json').seats;
for(const id of ['prova','new-monza','monte-rosso','baku']){
  const raw=JSON.parse(fs.readFileSync('./frontend/tracks/'+id+'.json','utf8'));
  const t=loadTrack(id);
  const L=TS.generateLayout(raw,t.points,t.pitLanePts,raw.roadHalfWidth+4,45,seats,t.barrierProfile);
  const tratti=GAPS.trattiVuoti(t.points,L);
  const giro=TG.lapLength(t.points);
  const aTerra=tratti.filter(x=>!x.suViadotto);
  const dx=tratti.filter(x=>x.lato===1).reduce((s,x)=>s+x.lunghezza,0)/giro;
  const sx=tratti.filter(x=>x.lato===-1).reduce((s,x)=>s+x.lunghezza,0)/giro;
  const infra=L.filter(v=>v.category==='infrastructure');
  const per={};
  for(const v of infra) per[v.asset]=(per[v.asset]||0)+1;
  console.log(id.padEnd(12), infra.length+' infrastrutture',
    JSON.stringify(per));
  console.log('             peggior vuoto a terra '+(aTerra[0]?aTerra[0].lunghezza.toFixed(0):0),
    '| dx '+(dx*100).toFixed(0)+'% sx '+(sx*100).toFixed(0)+'%');
}"
```

Annotare i quattro risultati: sono i numeri con cui si stringono le soglie e
l'unico modo per sapere se un asset non compare mai.

- [ ] **Step 3: Leggere il risultato prima di scrivere le soglie**

Confrontare con la colonna «dopo» dei numeri di partenza — quella ottenuta coi
segnaposto bocciati: `prova` 284 / 27% / 23%, `new-monza` 157 / 5% / 7%,
`monte-rosso` 24 / 0% / 4%.

- **Se un asset compare zero volte**, il suo contesto non lo ospita mai:
  guardare se è il `passoMinimo` troppo largo o il contesto troppo raro, e
  correggere **la palette**, non i vincoli del modulo.
- **Se `prova` non scende sotto 284**, i volumi non stanno riempiendo più della
  segnaletica: fermarsi e dirlo, non aggirare.
- **Se il numero di infrastrutture su `prova` supera ~120**, è ammucchiamento:
  alzare i `passoMinimo`.

- [ ] **Step 4: Stringere `VUOTI_ATTESI`**

In `frontend/shared/trackScenery.test.js`, aggiornare la tabella del commento
con una terza colonna («coi modelli veri») e portare `VUOTI_ATTESI` ai valori
misurati **arrotondati per eccesso del 10%**. Togliere il blocco `⚠️ Soglie
tornate ai valori PRIMA delle infrastrutture`, che non è più vero, e lasciare
la spiegazione del tratto 143-197 di `prova`, che resta valida.

- [ ] **Step 5: Eseguire tutta la suite**

Run: `node --test --test-concurrency=1`
Expected: esattamente **4 falliti**, quelli preesistenti dei Global Constraints.
Un quinto rosso è una regressione. Il caso già visto è `nessuna direzione verso
la campagna resta senza vegetazione`: le infrastrutture entrano in `accepted` e
tolgono posto agli alberi. La risposta giusta è restringere che cosa entra in
`accepted` per il verde, non alzare la soglia del test.

- [ ] **Step 6: Bumpare il cache-busting e guardare in gioco**

Alzare il `?v=` di `trackScenery.js` in `frontend/f1.html`, poi:

```bash
node backend/server.js
```
(senza pipe). Poi `localhost:3000`, **Ctrl+F5**, e un giro di `prova` guardando
i punti M 24-35 (campioni 262, 390, 564, 593, 682, 696, 718, 747, 827, 904,
924, 954).

- [ ] **Step 7: Commit**

```bash
git add frontend/shared/trackScenery.js frontend/shared/trackScenery.test.js frontend/f1.html
git commit -m "F1: le infrastrutture riempiono il circuito

Palette di produzione con gli otto modelli nuovi e nient'altro: niente
cartelloni, niente pennoni, nemmeno come ripiego. Il playtest del
2026-08-13 aveva bocciato proprio quelli — riempire vuole volumi.

Le soglie dei tratti vuoti sono state strette sui numeri misurati."
```

---

### Task 5: gli spettatori sulle terrazze

`hospitalityDeck` e `vipSuite` sono tribune: vuote si leggono come edifici
chiusi. I modelli degli spettatori in piedi e il loro caricamento **esistono
dal 2026-08-09**, ma non li piazzava nessuno.

**Files:**
- Modify: `backend/tools/circuitAssets/infrastructure.py` (ancore)
- Modify: `backend/tools/f1CircuitAssetsBuilder.py` (export del JSON)
- Create: `frontend/assets/custom/circuit/terraceAnchors.json` (generato)
- Modify: `frontend/shared/sceneryCrowd.js`
- Modify: `frontend/shared/sceneryCrowd.test.js`
- Modify: `frontend/shared/trackScenery.js` (nuovo parametro + chiamata)
- Modify: `frontend/f1.js:645-655` (fetch del JSON e passaggio)
- Modify: `backend/tools/f1-segnalazioni.js:99`, `backend/tools/f1-segnalazioni.test.js:108`,
  `backend/tools/f1-costo-scenografia.js:63` (stessi argomenti del gioco)

**Interfaces:**
- Consumes: `terraceAnchors.json` con forma
  `{ hospitalityDeck: [{x, y, z}], vipSuite: [{x, y, z}] }`, coordinate GIOCO
  relative all'origine dell'asset
- Produces: `SceneryCrowd.buildTerraceCrowd(terrazze, ancorePerAsset, rng) -> [voce]`
  con `category: 'crowd'` e asset `spectatorStandA`/`spectatorStandB`

- [ ] **Step 1: Generare le ancore dal modello**

In `backend/tools/circuitAssets/infrastructure.py`, in fondo:

```python
# --- Dove stanno gli spettatori sulle terrazze -----------------------------
# Stessa idea di grandstands.seat_anchors(): le posizioni nascono dalla
# geometria del modello, così non possono divergerne. Coordinate GIOCO
# relative all'origine dell'asset — Blender (x, y, z) -> gioco (x, z, -y) —
# col pivot della figura ai piedi.
def terrace_anchors():
    fronte = []
    z_pav = DECK_Z + 0.8
    # Terrazza: una fila al parapetto, dove si sta a guardare, più qualcuno
    # sparso fra i tavolini.
    for i in range(11):
        x = (i - 5) * 1.3
        fronte.append({'x': round(x, 3), 'y': round(z_pav, 3),
                       'z': round(DECK_D / 2 - 1.3, 3)})
    for sx in (-1, 0, 1):
        for sy in (-1, 1):
            fronte.append({'x': round(sx * 4.2 + 0.8, 3), 'y': round(z_pav, 3),
                           'z': round(-(sy * 1.9) + 1.0, 3)})

    # Suite: si guarda dalla terrazza in copertura, non da dietro la vetrata.
    tetto = []
    z_tetto = ROOF_Z + 0.7
    for i in range(9):
        x = (i - 4) * 1.5
        tetto.append({'x': round(x, 3), 'y': round(z_tetto, 3),
                      'z': round(DECK_D / 2 - 0.9, 3)})
    for sx in (-1, 1):
        for k in (-0.8, 0.8):
            tetto.append({'x': round(sx * 3.6 + k, 3), 'y': round(z_tetto, 3),
                          'z': round(1.6, 3)})
    return {'hospitalityDeck': fronte, 'vipSuite': tetto}
```

⚠️ Il segno di `z`: il fronte del modello guarda **-Y Blender = +Z gioco**, e le
figure vanno verso il fronte, quindi `z` gioco **positivo**.

- [ ] **Step 2: Esportare il JSON**

In `backend/tools/f1CircuitAssetsBuilder.py`, dopo il blocco che scrive
`grandStandSeats.json`:

```python
# Ancore degli spettatori sulle terrazze delle infrastrutture. Stesso motivo
# del file dei sedili: dato derivato dalla geometria, scritto sempre.
anchors = infrastructure.terrace_anchors()
anchors_path = os.path.join(voxelKit.GLB_DIR, 'terraceAnchors.json')
with open(anchors_path, 'w', encoding='utf-8') as f:
    json.dump({
        'comment': ('Posizioni degli spettatori in piedi sulle terrazze, in '
                    "coordinate GIOCO relative all'origine dell'asset (pivot "
                    'della figura ai piedi). Generato da '
                    'backend/tools/f1CircuitAssetsBuilder.py - non modificare a mano.'),
        'anchors': anchors,
    }, f, indent=1)
print(f'[circuitAssets] ancore terrazze -> {anchors_path}')
```

Serve `from circuitAssets import infrastructure` (o l'accesso via il package
già importato) in testa al builder, come per `grandstands`.

- [ ] **Step 3: Generare il file**

Run:
```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/f1CircuitAssetsBuilder.py -- --asset hospitalityDeck --no-render
```
Expected: `[circuitAssets] ancore terrazze -> ...terraceAnchors.json`, con 17
voci per `hospitalityDeck` e 13 per `vipSuite`.

- [ ] **Step 4: Scrivere il test che fallisce**

In `frontend/shared/sceneryCrowd.test.js`, in fondo:

```javascript
test('gli spettatori delle terrazze stanno sopra la terrazza, non a mezz\'aria', () => {
    const ancore = { hospitalityDeck: [{ x: 2, y: 5.4, z: 3.7 }] };
    // Terrazza ruotata di 90°: se la rotazione non viene applicata, la figura
    // resta sull'asse sbagliato e il test lo vede.
    const terrazze = [{ asset: 'hospitalityDeck', x: 100, y: 7, z: -50,
                        rotY: Math.PI / 2, scale: 1 }];
    const out = SceneryCrowd.buildTerraceCrowd(terrazze, ancore, () => 0.1);
    assert.equal(out.length, 1);
    const f = out[0];
    assert.ok(f.asset === 'spectatorStandA' || f.asset === 'spectatorStandB');
    assert.equal(f.category, 'crowd');
    assert.ok(Math.abs(f.y - (7 + 5.4)) < 1e-6, 'la quota è quella della terrazza più l\'ancora');
    // (x,z) locali (2, 3.7) ruotati di 90°: x' = x·cos + z·sin = 3.7,
    // z' = -x·sin + z·cos = -2.
    assert.ok(Math.abs(f.x - (100 + 3.7)) < 1e-6, `x atteso 103.7, ottenuto ${f.x}`);
    assert.ok(Math.abs(f.z - (-50 - 2)) < 1e-6, `z atteso -52, ottenuto ${f.z}`);
    assert.ok(Math.abs(f.rotY - Math.PI / 2) < 1e-6, 'guarda dove guarda la terrazza');
});

test('un asset senza ancore non produce spettatori', () => {
    const out = SceneryCrowd.buildTerraceCrowd(
        [{ asset: 'giantScreen', x: 0, y: 0, z: 0, rotY: 0 }], {}, () => 0.1);
    assert.equal(out.length, 0);
});

test('le terrazze hanno un budget proprio, separato da quello delle tribune', () => {
    const ancore = { hospitalityDeck: [] };
    for (let i = 0; i < 20; i++) ancore.hospitalityDeck.push({ x: i, y: 5.4, z: 3.7 });
    const terrazze = [];
    for (let i = 0; i < 200; i++) {
        terrazze.push({ asset: 'hospitalityDeck', x: i * 40, y: 0, z: 0, rotY: 0 });
    }
    // 200 terrazze × 20 posti = 4000 richiesti contro un tetto di 900.
    //
    // ⚠️ Qui serve un rng UNIFORME, non una costante. Il filtro è
    // `rng() > fill`: un rng che ritorna sempre 0 passa qualunque soglia e il
    // test non potrebbe fallire. Il tetto è statistico come quello delle
    // tribune, non un taglio netto — da qui il 15% di tolleranza.
    let s = 12345;
    const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const out = SceneryCrowd.buildTerraceCrowd(terrazze, ancore, rng);
    assert.ok(out.length <= SceneryCrowd.MAX_TERRACE * 1.15,
        `${out.length} figure, sopra il tetto di ${SceneryCrowd.MAX_TERRACE}`);
    assert.ok(out.length > SceneryCrowd.MAX_TERRACE * 0.5,
        `${out.length} figure: il budget non viene nemmeno avvicinato`);
});
```

- [ ] **Step 5: Eseguire i test e verificare che falliscano**

Run: `node --test frontend/shared/sceneryCrowd.test.js`
Expected: FAIL con `SceneryCrowd.buildTerraceCrowd is not a function`.

- [ ] **Step 6: Scrivere la funzione**

In `frontend/shared/sceneryCrowd.js`, prima del `return`:

```javascript
    // Spettatori in piedi sulle terrazze delle infrastrutture. Stessa idea
    // della folla sulle tribune — posizioni locali all'oggetto, portate in
    // coordinate mondo con la rotazione dell'oggetto — ma con budget PROPRIO:
    // le terrazze sono poche e piccole, e farle pescare da MAX_TOTAL le
    // lascerebbe deserte ogni volta che le tribune crescono.
    const TERRACE_VARIANTS = ['spectatorStandA', 'spectatorStandB'];
    const TERRACE_FILL_MIN = 0.5;
    const MAX_TERRACE = 900;

    function buildTerraceCrowd(terrazze, ancorePerAsset, rng) {
        if (!terrazze || !terrazze.length || !ancorePerAsset) return [];
        const layout = [];

        let capacity = 0;
        for (const t of terrazze) {
            const a = ancorePerAsset[t.asset];
            if (a) capacity += a.length;
        }
        if (!capacity) return [];
        const fillCap = Math.min(FILL_MAX, MAX_TERRACE / capacity);

        for (const t of terrazze) {
            const ancore = ancorePerAsset[t.asset];
            if (!ancore || !ancore.length) continue;
            const min = Math.min(TERRACE_FILL_MIN, fillCap);
            const fill = min + rng() * (fillCap - min);
            const rot = t.rotY || 0;
            const cos = Math.cos(rot);
            const sin = Math.sin(rot);
            for (const a of ancore) {
                if (rng() > fill) continue;
                layout.push({
                    asset: TERRACE_VARIANTS[Math.floor(rng() * TERRACE_VARIANTS.length)],
                    category: 'crowd',
                    x: t.x + a.x * cos + a.z * sin,
                    y: (t.y || 0) + a.y,
                    z: t.z - a.x * sin + a.z * cos,
                    rotY: rot,
                    scale: 1,
                });
            }
        }
        return layout;
    }
```

Aggiungere `buildTerraceCrowd` e `MAX_TERRACE` all'oggetto restituito.

- [ ] **Step 7: Eseguire i test e verificare che passino**

Run: `node --test frontend/shared/sceneryCrowd.test.js`
Expected: PASS.

- [ ] **Step 8: Chiamarla da `generateLayout`**

In `frontend/shared/trackScenery.js`, dopo `accepted.push(...infrastrutture);`
e vicino a dove si costruisce la folla delle tribune:

```javascript
        // Spettatori sulle terrazze: RNG proprio, come la folla delle tribune,
        // e per lo stesso motivo — legarli alla sequenza condivisa farebbe
        // cambiare la folla ogni volta che cambia il numero di infrastrutture.
        const terrazze = infrastrutture.filter(
            v => v.asset === 'hospitalityDeck' || v.asset === 'vipSuite');
        const terraceCrowd = SceneryCrowd.buildTerraceCrowd(
            terrazze, terraceAnchors || {}, mulberry32(hashString(trackData.id + ':terrace')));
```

e aggiungere `...terraceCrowd` all'array `layout`, accanto alla folla delle
tribune.

La firma di `generateLayout` (`frontend/shared/trackScenery.js:1307`) oggi è:

```javascript
    function generateLayout(trackData, trackPts, pitPts, barrierDist, embankmentWidth = 45, seatAnchors = null, barrierProfile = null) {
```

Aggiungere `terraceAnchors = null` **in coda**, così i chiamanti che non lo
passano continuano a funzionare: `TrackScenery` è un modulo puro e non può fare
fetch, esattamente come per `seatAnchors`. **Senza ancore non si generano
spettatori** — nessun crash, nessuna figura a mezz'aria.

- [ ] **Step 9: Passare le ancore da chi genera il layout**

I chiamanti sono cinque, e tre vanno aggiornati:

| file | cosa fare |
|---|---|
| `frontend/f1.js:655` | il gioco vero: fetch del JSON + passaggio |
| `backend/tools/f1-segnalazioni.js:99` | **obbligatorio**: deve produrre lo stesso layout del gioco |
| `backend/tools/f1-segnalazioni.test.js:108` | segue il tool, il commento cita `f1.js:655` |
| `backend/tools/f1-costo-scenografia.js:63` | serve al conto del Task 6 |
| `frontend/f1-testbench.js:253` | **lasciare com'è**: passa 5 argomenti e non ha nemmeno gli spettatori delle tribune |

In `frontend/f1.js`, accanto al blocco che carica `grandStandSeats.json`
(righe 645-651):

```javascript
    // Ancore degli spettatori sulle terrazze, stesso discorso dei posti a
    // sedere: file generato dal builder, TrackScenery non può fare fetch.
    let terraceAnchors = null;
    try {
        const terrRes = await fetch('/assets/custom/circuit/terraceAnchors.json');
        if (terrRes.ok) terraceAnchors = (await terrRes.json()).anchors;
    } catch (err) {
        console.warn('[F1] ancore terrazze non caricate, terrazze vuote:', err);
    }
```

e alla riga della chiamata aggiungere `, terraceAnchors` dopo `BARRIER_PROFILE`.

⚠️ **`f1-segnalazioni.js` deve restare allineato al gioco.** È scritto in
`docs/f1-notes.md`: che i due layout coincidano non è ovvio ed è l'unico modo in
cui quel tool può sbagliare in silenzio. Il tool legge già
`grandStandSeats.json` da disco — leggere anche `terraceAnchors.json` è una
riga accanto.

- [ ] **Step 10: Verificare in gioco e committare**

Riavviare il server, **Ctrl+F5**, e guardare una terrazza da vicino: le figure
devono stare sul piano e guardare la pista.

```bash
git add backend/tools/circuitAssets/infrastructure.py backend/tools/f1CircuitAssetsBuilder.py frontend/assets/custom/circuit/terraceAnchors.json frontend/shared/sceneryCrowd.js frontend/shared/sceneryCrowd.test.js frontend/shared/trackScenery.js frontend/f1.html
git commit -m "F1: spettatori sulle terrazze delle infrastrutture

Terrazza e suite sono tribune: vuote si leggevano come edifici chiusi. I
modelli degli spettatori in piedi e il loro caricamento esistevano dal
2026-08-09, non li piazzava nessuno.

Le ancore nascono dalla geometria del modello, come i sedili delle
tribune, cosi' non possono divergerne. Budget proprio (900) e non
MAX_TOTAL: le terrazze sono poche e piccole, e pescare dal budget delle
tribune le lascerebbe deserte ogni volta che le tribune crescono."
```

---

### Task 6: il conto delle draw call, e la suite intera

Prima di dichiarare finito, sapere quanto è costato.

**Files:**
- Modify: `docs/f1-notes.md`
- Nessun test nuovo: si eseguono quelli che ci sono

- [ ] **Step 1: Misurare il costo**

Run: `node backend/tools/f1-costo-scenografia.js`

Confrontare con il bilancio di partenza annotato nel piano 1: **1661k triangoli
e 668 InstancedMesh su `prova`**.

- [ ] **Step 2: Giudicare il numero**

Gli otto asset stanno fra 240 e 624 triangoli l'uno — briciole contro i 3684
della tribuna. **Il numero da guardare è l'InstancedMesh**, cioè le draw call:
`loadScenery` ne crea uno per ogni mesh di ogni asset in ogni cella di
`sceneryChunks`.

- Se le InstancedMesh su `prova` superano **~760** (+14%), dirlo prima di
  proseguire: le vie sono alzare i `passoMinimo` degli asset più diffusi o
  togliere un materiale a quelli da 5.
- Se i triangoli crescono di più del 10%, guardare la riga degli spettatori
  delle terrazze: sono 132 triangoli a figura e il tetto è 900.

- [ ] **Step 3: Eseguire tutta la suite**

Run: `node --test --test-concurrency=1`
Expected: esattamente **4 falliti**, quelli preesistenti.

- [ ] **Step 4: Aggiornare la documentazione**

In `docs/f1-notes.md`, nella sezione della scenografia, aggiungere sotto le
note per il piazzamento:

```markdown
### Infrastrutture distribuite

`frontend/shared/sceneryInfrastructure.js` cammina il giro a passo di 25 unità
e posa un'infrastruttura per punto e per lato, scegliendo dalla palette di
`trackScenery.js` (`PALETTE_INFRASTRUTTURE`) il primo asset il cui contesto
combacia e che superi i sette vincoli. I contesti sono `viadotto`, `stretto`
(muro della via di fuga ≤ 20), `curvaEsterno`, `rettilineo` (visuale lunga) e
`aperto`, che fa da rete per gli ultimi due.

Quanto circuito resti senza niente di fianco si misura con
`frontend/shared/sceneryGaps.js`, e i tetti stanno in `VUOTI_ATTESI` dentro
`trackScenery.test.js`: **si stringono, mai si allargano**.

⚠️ Nella palette vanno **volumi**, non segnaletica: cartelloni e pennoni
sparsi sono stati provati il 2026-08-13 e bocciati al playtest.
```

- [ ] **Step 5: Commit**

```bash
git add docs/f1-notes.md
git commit -m "F1: documentate le infrastrutture distribuite e il loro costo

Bilancio delle draw call dopo l'ingresso degli otto asset, e le regole
che valgono per chi tocchera' la palette."
```

---

### Task 7: gate utente

Non è un task di codice: è il punto in cui il piano si ferma e chiede.

- [ ] **Step 1: Presentare i numeri veri**

- quante infrastrutture su ciascun tracciato, e quante per asset;
- peggior vuoto a terra e quote per lato, contro il 315 / 33% / 42% di partenza
  **e** contro il 284 / 27% / 23% dei segnaposto bocciati;
- bilancio delle draw call, prima e dopo;
- quante figure sulle terrazze.

- [ ] **Step 2: Chiedere il giudizio in gioco**

1. Il circuito si legge come più pieno, o come più disordinato?
2. Gli oggetti sono **credibili dove stanno** — la gru all'esterno curva, il
   maxischermo dove si vede da lontano, il cancello dove il muro è addosso?
3. Si vedono due esemplari dello stesso asset troppo vicini?
4. Le prestazioni tengono? (pannello **F9**, che spegne per categoria senza
   ricaricare)

- [ ] **Step 3: Decidere il seguito**

Se il colpo d'occhio convince, resta solo
`superpowers:finishing-a-development-branch` per portare il branch su `main`.

---

## Note per chi esegue

**Se un test di ghiaia si accende**, il parametro da girare è
`MARGINE_DAL_MURO`, non la tolleranza del test. Il vincolo «niente dentro la via
di fuga» è costato due round di playtest.

**Se le infrastrutture risultano poche**, nell'ordine: abbassare i
`passoMinimo` della palette, allargare i contesti di un asset, abbassare `PASSO`
(25 → 20). **Non** togliere vincoli.

**Se un test di scenografia preesistente si accende**, è una regressione vera:
le infrastrutture entrano in `accepted` e tolgono posto a natura, boschi e
rocce.

**Il pannello F9** in gioco spegne e riaccende per asset senza ricaricare: è il
modo più rapido per capire da dove viene un calo di prestazioni.

**Quello che l'utente guarda**, quando giudica un asset, sono i `.glb` aperti
direttamente — non i render. Le sue bocciature finora: pezzi che galleggiano,
strutture su pilastri senza niente sotto, tre tinte tutte chiare, e dettagli che
non tornano (una scala senza porta).
