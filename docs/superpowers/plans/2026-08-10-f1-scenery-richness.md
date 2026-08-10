# F1 — circuiti più ricchi: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** chiudere l'orizzonte dei circuiti e popolare le fasce intermedie, con
colline più alte, boschi più fitti e quattordici asset voxel nuovi.

**Architettura:** la fase 1 non aggiunge modelli — alza le colline
(`sceneryHills.js`) e infittisce i boschi (`trackScenery.js`), che è ciò che
davvero chiude la vista. Le fasi successive aggiungono asset alla pipeline
esistente (`voxelKit.py` + `circuitAssets/`) e li piazzano estendendo il
sistema di scatter già in uso, più un modulo nuovo per il paddock.

**Tech Stack:** Blender 5.1 headless con `voxelKit.py` (Python), moduli
condivisi JavaScript in `frontend/shared/` con il pattern IIFE del progetto,
`node:test` per i test.

**Spec:** `docs/superpowers/specs/2026-08-10-f1-scenery-richness-design.md`

## Global Constraints

- **Italiano** in commenti, messaggi e testi. Niente emoji.
- **Commit alla fine di ogni task**, quando i test passano. Il push resta
  dell'utente.
- **Il builder si lancia con `-- --no-render`**: l'utente valuta i `.glb`
  aprendoli, i PNG non servono e costano quasi tutto il tempo di build.
  ```
  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
      --python backend/tools/f1CircuitAssetsBuilder.py -- --no-render --asset <id>
  ```
- **Massimo 3 materiali** per gli asset ad alta istanza (alberi, cespugli,
  rocce, spettatore in piedi). Il limite del builder è 6, ma ogni materiale è
  una mesh e quindi una draw call per cella.
- **Convenzioni voxel custom** (già in `docs/f1-notes.md`): scala 1:1 in unità
  di gioco, fronte verso +Z gioco (= −Y Blender), pivot alla base (Y=0)
  centrato in XZ, niente volumi cavi né facce complanari sovrapposte.
- **Nessuna distanza di piazzamento assoluta**: tutto espresso in funzione di
  `barrierDist`. È l'invariante che renderà indolori le future vie di fuga.
- **La fascia `barrierD + 45` resta vuota** (riservata alla ghiaia).
- **Tetto di spesa: 8 ms** di disegno, voce "di cui disegno" del pannello F9.
- **Test**: `node --test frontend/shared/<file>.test.js` e
  `node --test backend/tools/circuitAssets.test.js`, dalla radice del repo.
- **Il server lo avvia l'utente**; il worker non apre il browser.
- **Cache**: bumpare `?v=` in `frontend/f1.html` a ogni modifica di un `.js`.

## Precedente da conoscere prima di iniziare

In `trackScenery.js` c'è questo commento, da una sessione passata:

> *"Un tentativo di allargare la fascia a 200 unità per riempire l'orizzonte è
> stato annullato: portava gli alberi da ~230 a oltre 700 e faceva scattare il
> gioco anche in localhost, senza peraltro togliere la sensazione di prato
> infinito (quella dipende dal terreno piatto, non dal numero di alberi)."*

Due cose importanti. La prima: **la strada "più alberi ovunque" è già stata
percorsa e ha fallito** — la si evita, e infatti qui gli alberi in più vanno
sulle colline, non sparsi nel prato. La seconda: la causa dei cali era che gli
alberi proiettavano ombra, cosa poi corretta (`NO_SHADOW_ASSETS`), e da
stamattina c'è anche il frustum culling. Il tetto si può quindi alzare, ma
**va misurato**, non dato per buono.

---

## Struttura dei file

| file | responsabilità | stato |
|---|---|---|
| `frontend/shared/sceneryHills.js` | quota del terreno collinare | modificato (task 1) |
| `frontend/shared/trackMeshBuilder.js` | griglia che disegna le colline | verificato (task 1) |
| `frontend/shared/trackScenery.js` | scatter di natura e boschi, tabelle asset | modificato (task 2, 5, 6, 9) |
| `backend/tools/circuitAssets/vegetation.py` | alberi e cespugli | **nuovo** (task 3, 4) |
| `backend/tools/circuitAssets/rocks.py` | massi e affioramenti | **nuovo** (task 6) |
| `backend/tools/circuitAssets/paddock.py` | motorhome, camion, container | **nuovo** (task 7) |
| `backend/tools/circuitAssets/life.py` | auto parcheggiate, striscioni | **nuovo** (task 8) |
| `backend/tools/circuitAssets/people.py` | spettatore in piedi | modificato (task 8) |
| `backend/tools/circuitAssets/__init__.py` | registry assetId → builder | modificato (task 3, 4, 6, 7, 8) |
| `frontend/shared/sceneryPaddock.js` | piazzamento del paddock | **nuovo** (task 9) |
| `frontend/f1.js` | percorsi dei nuovi GLB | modificato (task 5, 6, 9) |

I nuovi moduli Python sono divisi **per famiglia**, come i nove esistenti:
`vegetation` e `rocks` sono natura, `paddock` e `life` sono il costruito. Il
piazzamento del paddock va in un modulo suo perché ha un criterio proprio
(gruppi attorno ai box), diverso dallo scatter della natura — stessa logica
con cui esistono già `sceneryLandmarks`, `sceneryTrackside`, `sceneryCrowd`.

---

## FASE 1 — chiudere l'orizzonte (nessun modello nuovo)

### Task 1: colline più alte

**Files:**
- Modify: `frontend/shared/sceneryHills.js:22-29`
- Modify: `frontend/shared/trackMeshBuilder.js` (costanti `HILL_GRID_CELL`, `HILL_REACH`)
- Test: `frontend/shared/sceneryHills.test.js`

**Interfaces:**
- Consumes: niente.
- Produces: `SceneryHills.HILL_MAX_HEIGHT` (numero), `HILL_START_MARGIN`,
  `HILL_RAMP` — invariati come nomi, cambiano i valori.

- [ ] **Step 1: scrivere il test che fallisce**

In `frontend/shared/sceneryHills.test.js`, aggiungi in fondo:

```js
test('le colline chiudono almeno 12 gradi di orizzonte', () => {
    // È il numero che decide se la fase funziona: con la quota vecchia (55 a
    // 500 unità) le colline coprivano 6°, mentre la camera ne inquadra oltre
    // 30 — si vedeva il cielo posarsi sul prato. Misurato dall'occhio del
    // pilota, che sta a ~8 unità da terra.
    const EMBANK_OUTER = 60;
    const OCCHIO = 8;
    let angoloMax = 0;
    for (let d = 200; d <= 900; d += 25) {
        // il campione peggiore, non il migliore: le colline sono irregolari
        let quotaMin = Infinity;
        for (let i = 0; i < 40; i++) {
            const h = SceneryHills.hillHeightAt(i * 137, i * -211, d, EMBANK_OUTER);
            if (h < quotaMin) quotaMin = h;
        }
        const ang = Math.atan2(quotaMin - OCCHIO, d) * 180 / Math.PI;
        if (ang > angoloMax) angoloMax = ang;
    }
    assert.ok(angoloMax >= 12,
        `le colline coprono solo ${angoloMax.toFixed(1)}°, non chiudono l'orizzonte`);
});

test('la salita resta graduale e non fa un muro', () => {
    // Un salto brusco si legge come una parete, non come una collina.
    const EMBANK_OUTER = 60;
    let precedente = 0;
    for (let d = 0; d <= 900; d += 10) {
        const h = SceneryHills.hillHeightAt(500, 500, d, EMBANK_OUTER);
        assert.ok(h - precedente < 12, `salto di ${(h - precedente).toFixed(1)} a ${d} unità`);
        precedente = h;
    }
});
```

- [ ] **Step 2: eseguire e verificare che fallisca**

Comando: `node --test frontend/shared/sceneryHills.test.js`
Atteso: FAIL sul primo test, con un angolo intorno a 5-6°.

- [ ] **Step 3: alzare le colline**

In `frontend/shared/sceneryHills.js`, sostituisci le tre costanti:

```js
    // Le colline iniziano più vicino e salgono più in alto di quanto facessero
    // fino al 2026-08-10 (120 / 300 / 55). Il motivo è misurato: alla quota
    // vecchia coprivano 6° sopra l'orizzonte contro i 30° e passa inquadrati
    // dalla camera, quindi si vedeva il cielo posarsi sul prato — ed è la vera
    // causa della "sensazione di prato infinito", non il numero di alberi
    // (vedi il commento su NATURE_ATTEMPTS in trackScenery.js, dove la strada
    // "più alberi ovunque" era già stata provata e annullata).
    const HILL_START_MARGIN = 90;
    const HILL_RAMP = 260;
    const HILL_MAX_HEIGHT = 110;
```

- [ ] **Step 4: verificare che la griglia del terreno le copra**

⚠️ È l'errore già commesso una volta: le colline esistevano nei calcoli ma non
venivano disegnate, perché cadevano fuori dalla griglia della mesh.

In `frontend/shared/trackMeshBuilder.js`, controlla che valga
`HILL_REACH >= HILL_START_MARGIN + HILL_RAMP + 200`. Con i valori nuovi servono
almeno 550; se `HILL_REACH` è inferiore, portalo a **700** e lascia
`HILL_GRID_CELL` a 80.

Comando di verifica:

```
node -e "const H=require('./frontend/shared/sceneryHills.js'); console.log('serve almeno', H.HILL_START_MARGIN + H.HILL_RAMP + 200);"
```

- [ ] **Step 5: eseguire i test**

Comando: `node --test frontend/shared/sceneryHills.test.js frontend/shared/trackScenery.test.js`
Atteso: PASS.

- [ ] **Step 6: commit**

```bash
git add frontend/shared/sceneryHills.js frontend/shared/sceneryHills.test.js frontend/shared/trackMeshBuilder.js
git commit -m "F1 scenografia: colline piu' alte per chiudere l'orizzonte"
```

---

### Task 2: boschi più fitti

**Files:**
- Modify: `frontend/shared/trackScenery.js:96-110`
- Test: `frontend/shared/trackScenery.test.js`

**Interfaces:**
- Consumes: `SceneryHills.HILL_START_MARGIN` (task 1).
- Produces: nessuna API nuova; cambia solo la densità del layout `woods`.

- [ ] **Step 1: scrivere il test che fallisce**

In `frontend/shared/trackScenery.test.js`:

```js
test('i boschi formano macchie diradate, non un prato spennacchiato', () => {
    // La massa visiva viene dalla densità DENTRO la macchia: un bosco rado lo
    // sguardo lo attraversa. Si misura contando quanti alberi ha in media un
    // albero entro 20 unità: sotto 3 è vegetazione sparsa, non bosco.
    const { layout } = layoutFor(monteRosso);
    const woods = layout.filter(v => v.category === 'woods');
    assert.ok(woods.length >= 400, `solo ${woods.length} alberi di bosco`);
    let vicini = 0;
    for (const a of woods) {
        let n = 0;
        for (const b of woods) {
            if (a === b) continue;
            if (Math.hypot(a.x - b.x, a.z - b.z) < 20) n++;
        }
        vicini += n;
    }
    const media = vicini / woods.length;
    assert.ok(media >= 3, `densità media ${media.toFixed(1)} vicini: bosco troppo rado`);
});
```

`layoutFor(track)` esiste già nel file e restituisce
`{ layout, trackPts, pitPts, barrierD }`; `monteRosso` è la pista già caricata
in cima. Non scrivere helper nuovi.

- [ ] **Step 2: eseguire e verificare che fallisca**

Comando: `node --test frontend/shared/trackScenery.test.js`
Atteso: FAIL — oggi gli alberi di bosco sono ~230 e la densità è sotto 3.

- [ ] **Step 3: infittire le macchie**

In `frontend/shared/trackScenery.js` sostituisci le costanti dei boschi:

```js
    const WOOD_CLUSTERS       = 34;   // macchie tentate per tracciato
    const WOOD_PER_CLUSTER    = 22;   // alberi tentati per macchia
    // Raggio STRETTO di proposito: allargarlo dirada la macchia invece di
    // ingrandirla, e un bosco rado non ferma lo sguardo. La massa visiva
    // viene dalla densità interna, non dall'area coperta.
    const WOOD_CLUSTER_RADIUS = 26;
    const WOOD_MIN_SPACING    = 5;
    // Tetto alzato da 300 a 600. Il tentativo storico a ~700 alberi faceva
    // scattare il gioco, ma la causa era l'ombra proiettata da ogni albero,
    // poi rimossa con NO_SHADOW_ASSETS, e dal 2026-08-10 c'è anche il frustum
    // culling. Resta un valore da MISURARE col contatore del pannello, non da
    // dare per buono.
    const WOOD_MAX_TREES      = 600;
```

- [ ] **Step 4: eseguire i test**

Comando: `node --test frontend/shared/trackScenery.test.js`
Atteso: PASS.

- [ ] **Step 5: misurare il conto delle istanze**

```
node -e "
const fs=require('fs');
const TG=require('./frontend/shared/trackGeometry.js'); global.TrackGeometry=TG;
const TS=require('./frontend/shared/trackScenery.js');
for (const id of ['prova','monte-rosso','new-monza']) {
  const t=JSON.parse(fs.readFileSync('frontend/tracks/'+id+'.json','utf8'));
  const pts=TG.sampleLoop(t.controlPoints,1000);
  const pit=TG.sampleOpenPath(TG.snapPitPathEnds(t.pit.path,pts,t.roadHalfWidth),300);
  const seats=JSON.parse(fs.readFileSync('frontend/assets/custom/circuit/grandStandSeats.json','utf8')).seats;
  const l=TS.generateLayout(t,pts,pit,t.roadHalfWidth+4,45,seats);
  const w=l.filter(v=>v.category==='woods').length;
  console.log(id.padEnd(12),'totale',l.length,'| boschi',w);
}"
```

Atteso: boschi fra 400 e 600 su ciascun tracciato. Riporta i numeri all'utente.

- [ ] **Step 6: commit**

```bash
git add frontend/shared/trackScenery.js frontend/shared/trackScenery.test.js
git commit -m "F1 scenografia: boschi piu' fitti sulle colline"
```

- [ ] **Step 7: consegna — FINE FASE 1**

Chiedi all'utente di avviare il server e guardare **l'orizzonte** dai tre punti
di sempre (griglia, curva veloce, corsia box), e di riportare dal pannello F9
**fps e "di cui disegno"**. Sopra 8 ms si abbassa `WOOD_MAX_TREES`.

Domanda da porgli esplicitamente: *ora che l'orizzonte è chiuso, quanta roba
serve davvero nelle fasce vicine?* La risposta può ridurre le fasi successive.

---

## FASE 2 — vegetazione

### Task 3: i quattro alberi voxel

**Files:**
- Create: `backend/tools/circuitAssets/vegetation.py`
- Modify: `backend/tools/circuitAssets/__init__.py`
- Test: `backend/tools/circuitAssets.test.js`

**Interfaces:**
- Consumes: `voxelKit.VoxelKit` (`kit.box(mat, size, center)`, `kit.cyl(...)`),
  materiali `'green'`, `'concreteDark'` e i nuovi definiti allo step 1.
- Produces: quattro voci nel registry — `treeBroad`, `treeYoung`, `treePine`,
  `treeRound` — ognuna `build(kit) -> (span, height)`.

- [ ] **Step 1: aggiungere i colori della vegetazione alla palette**

In `backend/tools/voxelKit.py`, dentro `_HEX`, aggiungi tre voci. Il verde
esistente non basta: un bosco di un solo verde si legge come una macchia unica.

```python
    'leafDark':     '2E7D4F',   # chioma in ombra e conifere
    'leafMid':      '3FA86B',   # chioma piena, stesso verde del prato
    'bark':         '6B4A32',   # tronchi e rami
```

`leafMid` è volutamente identico a `ToonPalette.SURFACES.grass`: alberi e prato
appartengono alla stessa famiglia di verde, e la variazione la danno `leafDark`
e la luce a fasce.

- [ ] **Step 2: scrivere il test che fallisce**

`backend/tools/circuitAssets.test.js` ha già tutta l'impalcatura: una tabella
`EXPECTED` di `assetId → { w, h, d }` e un ciclo che ne genera i test
(esistenza, ingombro con tolleranza del 20%, massimo 6 materiali, pivot alla
base, centratura). **Basta aggiungere le voci**, non scrivere test nuovi:

```js
    // Vegetazione. Sono gli asset più replicati del catalogo (centinaia di
    // istanze), da cui il limite più stretto sui materiali qui sotto.
    treeBroad:         { w: 8, h: 11, d: 8 },
    treeYoung:         { w: 5, h: 7, d: 5 },
    treePine:          { w: 5, h: 16, d: 5 },
    treeRound:         { w: 7, h: 9, d: 7 },
```

Il limite dei 3 materiali non è coperto dal ciclo esistente (che verifica il
massimo generale di 6), quindi va aggiunto una volta sola, in fondo al file:

```js
// Asset replicati in centinaia di copie: ogni materiale è una mesh separata e
// quindi una draw call per cella spaziale. Un cespuglio a 6 materiali
// ripetuto 300 volte costa il doppio di uno a 3, per un dettaglio che a
// quella scala non si legge.
const MAX_MATERIALI_RIPETUTI = {
    treeBroad: 3, treeYoung: 3, treePine: 3, treeRound: 3,
    bushLow: 2, bushTall: 2,
    rockSingle: 2, rockCluster: 2,
    spectatorStand: 3,
};

for (const [assetId, limite] of Object.entries(MAX_MATERIALI_RIPETUTI)) {
    test(`${assetId}: al massimo ${limite} materiali (asset ad alta istanza)`, () => {
        const info = inspectGlb(path.join(GLB_DIR, `${assetId}.glb`));
        assert.ok(info.materialCount <= limite,
            `${info.materialCount} materiali, il massimo per un asset ripetuto è ${limite}`);
    });
}
```

`inspectGlb`, `GLB_DIR` e `path` sono già importati in cima al file.

- [ ] **Step 3: eseguire e verificare che fallisca**

Comando: `node --test backend/tools/circuitAssets.test.js`
Atteso: FAIL — i quattro `.glb` non esistono.

- [ ] **Step 4: scrivere il modulo della vegetazione**

Crea `backend/tools/circuitAssets/vegetation.py`. Questo è il codice completo
del pino, che vale da modello per gli altri tre:

```python
"""Vegetazione: alberi e cespugli.

Sono gli asset più replicati del catalogo (centinaia di istanze), quindi
valgono due regole più severe del solito: MASSIMO 3 MATERIALI, perché ogni
materiale è una mesh e quindi una draw call per cella spaziale, e pochi
volumi, perché il conto dei triangoli si moltiplica per il numero di istanze.

La chioma si costruisce a scaglioni sovrapposti e sfalsati, mai come un unico
blocco: è lo sfalsamento che la fa leggere come fogliame invece che come una
scatola verde.

Fronte verso -Y Blender = +Z gioco, pivot alla base.
"""
from voxelKit import EPS

# --- Conifera -------------------------------------------------------------
# Alta e stretta: è la sagoma che chiude l'orizzonte sui rilievi, dove serve
# altezza più che volume.
PINE_TRUNK = 0.8
PINE_TRUNK_H = 3.2
PINE_TIERS = 5           # scaglioni di chioma, dal più largo al più stretto
PINE_BASE_W = 5.0
PINE_TIER_H = 2.8


def build_pine(kit):
    kit.box('bark', (PINE_TRUNK, PINE_TRUNK, PINE_TRUNK_H), (0, 0, PINE_TRUNK_H / 2))
    for i in range(PINE_TIERS):
        # Larghezza che cala linearmente, altezza costante: la piramide a
        # gradoni è la conifera in voxel.
        w = PINE_BASE_W * (1 - i / PINE_TIERS)
        z = PINE_TRUNK_H - 0.4 + i * (PINE_TIER_H * 0.62) + PINE_TIER_H / 2
        mat = 'leafDark' if i % 2 == 0 else 'leafMid'
        # I due scaglioni si compenetrano di EPS: senza, fra l'uno e l'altro
        # resta una fessura da cui si vede attraverso.
        kit.box(mat, (w, w, PINE_TIER_H + EPS), (0, 0, z))
    return PINE_BASE_W, PINE_TRUNK_H + PINE_TIERS * PINE_TIER_H * 0.62
```

Gli altri tre seguono la stessa impostazione. Dimensioni e struttura:

| asset | tronco | chioma | materiali |
|---|---|---|---|
| `treeBroad` | 1.1 × 1.1 × 4.0, `bark` | 3 blocchi sfalsati 8 → 6.5 → 4, alti 2.6 ciascuno, alternando `leafMid` e `leafDark`, con i due superiori ruotati di 45° per rompere la sagoma quadrata | 3 |
| `treeYoung` | 0.7 × 0.7 × 2.6, `bark` | 2 blocchi 5 → 3.4, alti 2.2 | 3 |
| `treeRound` | 1.0 × 1.0 × 3.2, `bark` | blocco centrale 7 × 7 × 4 in `leafMid`, più 4 blocchi 2.6 × 2.6 × 2.6 in `leafDark` agli angoli, affondati di 0.6: è quello che arrotonda la sagoma | 3 |

- [ ] **Step 5: registrare gli asset**

In `backend/tools/circuitAssets/__init__.py`, aggiungi `vegetation` all'import
e le quattro voci al dizionario:

```python
    'treeBroad':         vegetation.build_broad,
    'treeYoung':         vegetation.build_young,
    'treePine':          vegetation.build_pine,
    'treeRound':         vegetation.build_round,
```

- [ ] **Step 6: generare e verificare**

```
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/f1CircuitAssetsBuilder.py -- --no-render \
    --asset treeBroad,treeYoung,treePine,treeRound
node --test backend/tools/circuitAssets.test.js
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/circuitAssetsBlackCheck.py
```

Atteso: test verdi e blackcheck pulito sui quattro nuovi.

- [ ] **Step 7: GATE UTENTE**

Di' all'utente che i quattro file sono in
`frontend/assets/custom/circuit/treeBroad.glb`, `treeYoung.glb`,
`treePine.glb`, `treeRound.glb`, e che li valuti aprendoli. **Non proseguire
finché non li approva**: se una sagoma non convince si itera qui, dove costa
pochi secondi, non dopo averla piazzata in 200 copie.

- [ ] **Step 8: commit**

```bash
git add backend/tools/voxelKit.py backend/tools/circuitAssets/vegetation.py backend/tools/circuitAssets/__init__.py backend/tools/circuitAssets.test.js frontend/assets/custom/circuit/tree*.glb
git commit -m "F1 scenografia: quattro alberi voxel"
```

---

### Task 4: i due cespugli

**Files:**
- Modify: `backend/tools/circuitAssets/vegetation.py`
- Modify: `backend/tools/circuitAssets/__init__.py`
- Test: `backend/tools/circuitAssets.test.js`

**Interfaces:**
- Consumes: i materiali `leafDark`/`leafMid`/`bark` (task 3).
- Produces: `bushLow`, `bushTall` nel registry.

- [ ] **Step 1: aggiungere gli invarianti attesi**

Nella stessa tabella del task 3:

```js
    bushLow:   { larghezza: 1.6, altezza: 1.2, tolleranza: 0.5, maxMateriali: 2 },
    bushTall:  { larghezza: 2.8, altezza: 3.2, tolleranza: 0.7, maxMateriali: 2 },
```

Due materiali e non tre: un cespuglio è piccolo sullo schermo e ne servono
centinaia.

- [ ] **Step 2: eseguire e verificare che fallisca**

Comando: `node --test backend/tools/circuitAssets.test.js`
Atteso: FAIL — i due `.glb` non esistono.

- [ ] **Step 3: scrivere i due cespugli**

In `vegetation.py`:

```python
# --- Cespugli -------------------------------------------------------------
# Nessun tronco: un cespuglio è una massa che tocca terra. Tre blocchi
# sfalsati bastano — a questa scala il quarto non si vede e costa il 33% in
# più su ~300 istanze.

def build_bush_low(kit):
    kit.box('leafMid',  (1.6, 1.4, 0.9), (0, 0, 0.45))
    kit.box('leafDark', (1.1, 1.0, 0.7), (0.25, -0.15, 0.85))
    kit.box('leafMid',  (0.9, 0.9, 0.6), (-0.3, 0.2, 0.8))
    return 1.6, 1.2


def build_bush_tall(kit):
    kit.box('leafDark', (2.4, 2.2, 1.6), (0, 0, 0.8))
    kit.box('leafMid',  (2.0, 1.8, 1.5), (0.2, 0.1, 1.9))
    kit.box('leafDark', (1.3, 1.2, 1.0), (-0.35, -0.2, 2.7))
    return 2.8, 3.2
```

- [ ] **Step 4: registrare, generare, verificare**

Aggiungi al registry `'bushLow': vegetation.build_bush_low` e
`'bushTall': vegetation.build_bush_tall`, poi:

```
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/f1CircuitAssetsBuilder.py -- --no-render --asset bushLow,bushTall
node --test backend/tools/circuitAssets.test.js
```

Atteso: PASS.

- [ ] **Step 5: GATE UTENTE + commit**

Segnala i due file all'utente, aspetta l'approvazione, poi:

```bash
git add backend/tools/circuitAssets/vegetation.py backend/tools/circuitAssets/__init__.py backend/tools/circuitAssets.test.js frontend/assets/custom/circuit/bush*.glb
git commit -m "F1 scenografia: due cespugli voxel"
```

---

### Task 5: piazzare la vegetazione nuova

**Files:**
- Modify: `frontend/shared/trackScenery.js:74-78` (tabella `NATURE_ASSETS`)
- Modify: `frontend/f1.js` (`SCENERY_ASSET_PATHS`)
- Modify: `frontend/f1.html` (bump `?v=`)
- Test: `frontend/shared/trackScenery.test.js`

**Interfaces:**
- Consumes: gli assetId dei task 3 e 4.
- Produces: voci di layout con `category: 'nature'` (cespugli e alberi vicini)
  e `category: 'woods'` (alberi sui rilievi), come già oggi.

- [ ] **Step 1: scrivere i test che falliscono**

```js
test('la vegetazione usa tutte le sagome disponibili', () => {
    // Con due sole sagome su 450 istanze la ripetizione si riconosce a colpo
    // d'occhio: è il difetto segnalato dall'utente.
    const { layout } = layoutFor(monteRosso);
    const usati = new Set(layout.filter(v => v.category === 'nature' || v.category === 'woods')
                                .map(v => v.asset));
    assert.ok(usati.size >= 6, `solo ${usati.size} sagome diverse: ${[...usati].join(', ')}`);
});

test('nessuna voce nuova cade nella fascia riservata alla ghiaia', () => {
    // L'utente estenderà alcune curve mettendoci le vie di fuga: quella
    // fascia deve restare vuota, altrimenti andrà svuotata a mano.
    const { layout, trackPts, barrierD } = layoutFor(monteRosso);
    const NUOVE = new Set(['treeBroad','treeYoung','treePine','treeRound','bushLow','bushTall']);
    for (const v of layout) {
        if (!NUOVE.has(v.asset)) continue;
        const d = TrackGeometry.nearestPoint(trackPts, v.x, v.z).dist;
        assert.ok(d >= barrierD + 45,
            `${v.asset} a ${d.toFixed(1)} dall'asse: dentro la fascia riservata`);
    }
});

test('il piazzamento segue le barriere quando si spostano', () => {
    // È l'invariante che rendera' indolori le vie di fuga: nessuna distanza
    // assoluta, tutto ancorato a barrierDist. Il layout si rigenera a ogni
    // caricamento, quindi se l'ancoraggio e' corretto la scenografia si
    // ridispone da sola.
    const trackPts = TrackGeometry.sampleLoop(monteRosso.controlPoints, 1000);
    const pitPts = TrackGeometry.sampleOpenPath(monteRosso.pit.path, 300);
    const distanzaMinima = (barrierD) => {
        const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, barrierD);
        return Math.min(...layout.filter(v => v.category === 'nature')
            .map(v => TrackGeometry.nearestPoint(trackPts, v.x, v.z).dist));
    };
    assert.ok(distanzaMinima(45) > distanzaMinima(15) + 20,
        'la vegetazione non si è spostata seguendo le barriere');
});
```

Tutti e tre usano `layoutFor` e `monteRosso`, già presenti nel file: non
servono helper nuovi.

- [ ] **Step 2: eseguire e verificare che falliscano**

Comando: `node --test frontend/shared/trackScenery.test.js`
Atteso: FAIL sul primo test (2 sagome invece di 6).

- [ ] **Step 3: estendere la tabella degli asset**

In `frontend/shared/trackScenery.js`:

```js
    // I due Kenney restano accanto ai voxel nuovi: la decisione se tenerli si
    // prende guardando, non a priori (scelta dell'utente 2026-08-10). Pesi
    // bassi perché sono di un'altra mano e devono restare minoranza.
    const NATURE_ASSETS = [
        { asset: 'treeLarge', weight: 0.5, scale: KENNEY_MODEL_SCALE },
        { asset: 'treeSmall', weight: 0.5, scale: KENNEY_MODEL_SCALE },
        { asset: 'treeBroad', weight: 2,   scale: CUSTOM_MODEL_SCALE },
        { asset: 'treeYoung', weight: 2,   scale: CUSTOM_MODEL_SCALE },
        { asset: 'treeRound', weight: 1.5, scale: CUSTOM_MODEL_SCALE },
        { asset: 'bushLow',   weight: 3,   scale: CUSTOM_MODEL_SCALE },
        { asset: 'bushTall',  weight: 2,   scale: CUSTOM_MODEL_SCALE },
    ];

    // I boschi vogliono altezza, non varietà: il pino domina, gli altri
    // rompono la regolarità.
    const WOOD_ASSETS = [
        { asset: 'treePine',  weight: 4,   scale: CUSTOM_MODEL_SCALE },
        { asset: 'treeBroad', weight: 2,   scale: CUSTOM_MODEL_SCALE },
        { asset: 'treeYoung', weight: 1,   scale: CUSTOM_MODEL_SCALE },
    ];
    const NATURE_SCALE = Object.fromEntries(
        [...NATURE_ASSETS, ...WOOD_ASSETS].map(a => [a.asset, a.scale])
    );
```

In `buildWoodsLayout`, sostituisci la scelta dell'asset con
`weightedPick(rng, WOOD_ASSETS)` e la scala con `NATURE_SCALE[asset]`.

- [ ] **Step 4: registrare i percorsi dei GLB**

In `frontend/f1.js`, dentro `SCENERY_ASSET_PATHS`:

```js
        treeBroad: '/assets/custom/circuit/treeBroad.glb',
        treeYoung: '/assets/custom/circuit/treeYoung.glb',
        treePine: '/assets/custom/circuit/treePine.glb',
        treeRound: '/assets/custom/circuit/treeRound.glb',
        bushLow: '/assets/custom/circuit/bushLow.glb',
        bushTall: '/assets/custom/circuit/bushTall.glb',
```

E aggiungi i sei id a `NO_SHADOW_ASSETS`, accanto a `treeLarge`/`treeSmall`:
la vegetazione non proietta ombra, è la scelta che ha risolto i cali di
prestazioni la volta scorsa.

- [ ] **Step 5: eseguire i test e bumpare la cache**

Comando: `node --test frontend/shared/trackScenery.test.js`
Atteso: PASS.

Bumpa `?v=` di `trackScenery.js` e `f1.js` in `frontend/f1.html`.

- [ ] **Step 6: commit e consegna — FINE FASE 2**

```bash
git add frontend/shared/trackScenery.js frontend/shared/trackScenery.test.js frontend/f1.js frontend/f1.html
git commit -m "F1 scenografia: piazzamento della vegetazione nuova"
```

Chiedi all'utente il playtest e i numeri del pannello. Domanda esplicita: **i
due alberi Kenney vanno tenuti o tolti?** Se vanno tolti, si eliminano le due
righe dalla tabella e i due file da `SCENERY_ASSET_PATHS`.

---

## FASE 3 — rocce

### Task 6: i due asset rocciosi e il loro piazzamento

**Files:**
- Create: `backend/tools/circuitAssets/rocks.py`
- Modify: `backend/tools/circuitAssets/__init__.py`, `frontend/shared/trackScenery.js`, `frontend/f1.js`, `frontend/f1.html`
- Test: `backend/tools/circuitAssets.test.js`, `frontend/shared/trackScenery.test.js`

**Interfaces:**
- Consumes: materiali `concrete`, `concreteDark` (già in palette).
- Produces: `rockSingle`, `rockCluster` nel registry; voci di layout con
  `category: 'rock'`.

- [ ] **Step 1: invarianti attesi + regola della ghiaia**

Nella tabella degli invarianti:

```js
    rockSingle:  { larghezza: 2.6, altezza: 1.8, tolleranza: 0.6, maxMateriali: 2 },
    rockCluster: { larghezza: 5.5, altezza: 2.4, tolleranza: 1.0, maxMateriali: 2 },
```

E in `trackScenery.test.js`:

```js
test('le rocce stanno lontane dalla pista', () => {
    // Vincolo esplicito dell'utente: niente rocce a bordo pista, perché quella
    // fascia diventerà via di fuga in ghiaia. Qui il margine è più largo di
    // quello della vegetazione: una roccia a ridosso della carreggiata si
    // legge come un ostacolo pericoloso anche se non lo è.
    const { layout, trackPts, barrierD } = layoutFor(monteRosso);
    for (const v of layout.filter(v => v.category === 'rock')) {
        const d = TrackGeometry.nearestPoint(trackPts, v.x, v.z).dist;
        assert.ok(d >= barrierD + 60, `roccia a ${d.toFixed(1)} dall'asse pista`);
    }
});
```

- [ ] **Step 2: eseguire e verificare che fallisca**

Comando: `node --test backend/tools/circuitAssets.test.js frontend/shared/trackScenery.test.js`
Atteso: FAIL su entrambi.

- [ ] **Step 3: scrivere le rocce**

Crea `backend/tools/circuitAssets/rocks.py`:

```python
"""Massi e affioramenti.

Riempiono il prato e i pendii dove un albero starebbe male, e danno varietà di
MATERIALE oltre che di sagoma: sono gli unici elementi naturali non verdi.

La forma nasce da blocchi ruotati e sfalsati: un masso in voxel è credibile
solo se nessuna faccia è parallela a quella accanto, altrimenti si legge come
una scatola grigia.
"""
import math

from voxelKit import EPS


def build_rock_single(kit):
    kit.box('concreteDark', (2.4, 2.0, 1.1), (0, 0, 0.55))
    kit.box('concrete',     (1.7, 1.5, 0.9), (0.2, -0.1, 1.25), rot=(0, 0, math.radians(22)))
    kit.box('concreteDark', (1.0, 0.9, 0.6), (-0.4, 0.25, 1.6), rot=(0, 0, math.radians(-15)))
    return 2.6, 1.8


def build_rock_cluster(kit):
    # Tre massi di taglia diversa: due uguali affiancati si leggono come una
    # coppia artificiale.
    kit.box('concreteDark', (2.6, 2.2, 1.4), (-1.3, 0.2, 0.7))
    kit.box('concrete',     (2.0, 1.8, 2.2), (1.1, -0.3, 1.1), rot=(0, 0, math.radians(18)))
    kit.box('concreteDark', (1.4, 1.3, 0.9), (0.1, 0.9, 0.45), rot=(0, 0, math.radians(-28)))
    return 5.5, 2.4
```

- [ ] **Step 4: registrare, generare, verificare**

Aggiungi `rocks` all'import e le due voci al registry, poi:

```
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/f1CircuitAssetsBuilder.py -- --no-render --asset rockSingle,rockCluster
node --test backend/tools/circuitAssets.test.js
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/circuitAssetsBlackCheck.py
```

- [ ] **Step 5: GATE UTENTE**

Segnala i due file e aspetta l'approvazione prima di piazzarli.

- [ ] **Step 6: piazzare le rocce**

In `frontend/shared/trackScenery.js`, accanto allo scatter della natura,
aggiungi lo scatter delle rocce con le sue costanti:

```js
    // Le rocce partono DOPO la fascia riservata alla ghiaia più un margine
    // ulteriore: a ridosso della carreggiata si leggerebbero come ostacoli.
    const ROCK_ATTEMPTS    = 160;
    const ROCK_MIN_MARGIN  = 60;   // oltre barrierDist
    const ROCK_MAX_MARGIN  = 320;  // arriva sui primi pendii collinari
    const ROCK_MIN_SPACING = 26;   // sparse, non a tappeto
    const ROCK_ASSETS = [
        { asset: 'rockSingle',  weight: 3, scale: CUSTOM_MODEL_SCALE },
        { asset: 'rockCluster', weight: 1, scale: CUSTOM_MODEL_SCALE },
    ];
```

Il corpo dello scatter è lo stesso di `buildNatureLayout` (candidati casuali,
scarto per distanza e per vicinanza ad altri elementi): riusa quella funzione
passandole i parametri invece di duplicarla, e marca le voci con
`category: 'rock'`.

Registra i due percorsi in `SCENERY_ASSET_PATHS` e aggiungili a
`NO_SHADOW_ASSETS`.

- [ ] **Step 7: test, cache, commit — FINE FASE 3**

```
node --test frontend/shared/trackScenery.test.js
```

Bumpa `?v=`, poi:

```bash
git add backend/tools/circuitAssets/rocks.py backend/tools/circuitAssets/__init__.py backend/tools/circuitAssets.test.js frontend/shared/trackScenery.js frontend/shared/trackScenery.test.js frontend/f1.js frontend/f1.html frontend/assets/custom/circuit/rock*.glb
git commit -m "F1 scenografia: massi e affioramenti"
```

Playtest dell'utente.

---

## FASE 4 — paddock e vita

### Task 7: i tre asset del paddock

**Files:**
- Create: `backend/tools/circuitAssets/paddock.py`
- Modify: `backend/tools/circuitAssets/__init__.py`
- Test: `backend/tools/circuitAssets.test.js`

**Interfaces:**
- Consumes: materiali `white`, `steel`, `steelDark`, `red`, `blue`, `glass`.
- Produces: `motorhome`, `truck`, `containerStack`.

- [ ] **Step 1: invarianti attesi**

```js
    motorhome:      { larghezza: 15.0, altezza: 4.5, tolleranza: 1.5, maxMateriali: 5 },
    truck:          { larghezza: 20.0, altezza: 5.0, tolleranza: 2.0, maxMateriali: 5 },
    containerStack: { larghezza: 7.7,  altezza: 6.6, tolleranza: 1.0, maxMateriali: 3 },
```

Qui il limite dei 3 materiali non si applica: sono decine di istanze, non
centinaia, e il dettaglio si vede perché stanno vicino alla pista.

- [ ] **Step 2: eseguire e verificare che fallisca**

Comando: `node --test backend/tools/circuitAssets.test.js`
Atteso: FAIL — i tre `.glb` non esistono.

- [ ] **Step 3: scrivere il modulo**

Crea `backend/tools/circuitAssets/paddock.py`. Struttura dei tre asset:

| asset | volumi |
|---|---|
| `motorhome` | cassa 15 × 3.8 × 3.2 in `white` a quota 1.0; fascia sponsor 14 × 0.15 × 0.8 in `red` sui due fianchi, affondata di EPS; 6 finestre 1.4 × 0.12 × 0.9 in `glass` per fianco; tettuccio 15.2 × 4.0 × 0.3 in `steelDark`; 4 ruote 0.9 × 0.5 × 0.9 in `black`; pedana d'ingresso 2.5 × 1.2 × 0.25 in `steel` sul fronte |
| `truck` | motrice 5.5 × 3.6 × 3.4 in `blue` con parabrezza `glass` 3.0 × 0.15 × 1.2; semirimorchio 13 × 3.8 × 3.6 in `white` a quota 1.2; fascia sponsor `red`; 10 ruote `black`; il distacco fra motrice e rimorchio è 0.6, altrimenti si legge come un unico blocco |
| `containerStack` | due container 7.7 × 3.3 × 3.2 sovrapposti, uno `red` e uno `blue`, con scanalature verticali (box 0.12 × 0.1 × 3.0 ogni 0.55 in `steelDark`, affondati di EPS) e maniglie agli angoli in `steel` |

- [ ] **Step 4: registrare, generare, verificare, GATE UTENTE**

```
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/f1CircuitAssetsBuilder.py -- --no-render \
    --asset motorhome,truck,containerStack
node --test backend/tools/circuitAssets.test.js
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/circuitAssetsBlackCheck.py
```

Segnala i file all'utente e aspetta l'approvazione.

- [ ] **Step 5: commit**

```bash
git add backend/tools/circuitAssets/paddock.py backend/tools/circuitAssets/__init__.py backend/tools/circuitAssets.test.js frontend/assets/custom/circuit/motorhome.glb frontend/assets/custom/circuit/truck.glb frontend/assets/custom/circuit/containerStack.glb
git commit -m "F1 scenografia: motorhome, camion e container"
```

---

### Task 8: auto parcheggiate, spettatori in piedi, striscioni

**Files:**
- Create: `backend/tools/circuitAssets/life.py`
- Modify: `backend/tools/circuitAssets/people.py`, `backend/tools/circuitAssets/__init__.py`
- Test: `backend/tools/circuitAssets.test.js`

**Interfaces:**
- Consumes: `people._standing_legs(kit)`, già scritta per i meccanici.
- Produces: `parkedCar`, `spectatorStand`, `banner`.

- [ ] **Step 1: invarianti attesi**

```js
    parkedCar:      { larghezza: 5.8, altezza: 2.3, tolleranza: 0.8, maxMateriali: 4 },
    spectatorStand: { larghezza: 0.7, altezza: 2.3, tolleranza: 0.4, maxMateriali: 3 },
    banner:         { larghezza: 10.0, altezza: 3.0, tolleranza: 1.0, maxMateriali: 3 },
```

- [ ] **Step 2: eseguire e verificare che fallisca**

Comando: `node --test backend/tools/circuitAssets.test.js`
Atteso: FAIL.

- [ ] **Step 3: scrivere gli asset**

In `people.py`, accanto a `build_pit_crew`, aggiungi lo spettatore in piedi:

```python
def build_spectator_standing(kit):
    """Spettatore in piedi a bordo recinzione. Riusa le gambe del meccanico:
    la posa è la stessa, cambiano i colori e manca il casco."""
    _standing_legs(kit)
    kit.box('blue', (0.62, 0.34, 0.85), (0, 0, 1.42))       # busto
    kit.box('skin', (0.36, 0.30, 0.34), (0, 0, 2.02))       # testa
    for side in (-1, 1):                                     # braccia
        kit.box('blue', (0.16, 0.16, 0.62), (side * 0.38, 0, 1.44))
    return 0.7, 2.3
```

Crea `life.py` con gli altri due:

| asset | volumi |
|---|---|
| `parkedCar` | scocca 5.0 × 2.2 × 0.9 a quota 0.55 in un colore fra `red`/`blue`/`white` (una funzione per colore, tre voci di registry non servono: basta `make_parked_car(colore)` come fa `people.make_spectator`); tettuccio 2.8 × 2.0 × 0.7 arretrato di 0.3; parabrezza `glass` 2.6 × 0.12 × 0.55 inclinato; 4 ruote 0.75 × 0.35 × 0.75 in `black` |
| `banner` | due pali 0.25 × 0.25 × 3.0 in `steelDark` alle estremità; telo 9.4 × 0.12 × 1.6 in `white` a quota 1.2; tre fasce sponsor 2.6 × 0.14 × 0.5 in `red`/`blue`/`yellow` affondate di EPS sul fronte |

- [ ] **Step 4: registrare, generare, verificare, GATE UTENTE, commit**

Stessi comandi dei task precedenti, con
`--asset parkedCar,spectatorStand,banner`.

```bash
git add backend/tools/circuitAssets/life.py backend/tools/circuitAssets/people.py backend/tools/circuitAssets/__init__.py backend/tools/circuitAssets.test.js frontend/assets/custom/circuit/parkedCar.glb frontend/assets/custom/circuit/spectatorStand.glb frontend/assets/custom/circuit/banner.glb
git commit -m "F1 scenografia: auto parcheggiate, spettatori in piedi, striscioni"
```

---

### Task 9: piazzare il paddock

**Files:**
- Create: `frontend/shared/sceneryPaddock.js`, `frontend/shared/sceneryPaddock.test.js`
- Modify: `frontend/shared/trackScenery.js` (chiamata al modulo), `frontend/f1.js`, `frontend/f1.html`

**Interfaces:**
- Consumes: `TrackGeometry.nearestPoint`, `SceneryAssetSizes.itemsOverlap`,
  i sei assetId dei task 7 e 8.
- Produces: `SceneryPaddock.buildLayout(rng, trackPts, pitPts, barrierDist, accepted)`
  → array di voci `{ asset, category: 'paddock' | 'life', x, y, z, rotY, scale }`.

- [ ] **Step 1: scrivere i test che falliscono**

Crea `frontend/shared/sceneryPaddock.test.js`:

```js
test('il paddock si concentra vicino alla corsia box', () => {
    // È dove sta nella realtà, ed è l'unico punto in cui il giocatore lo
    // vede da vicino (ogni pit stop).
    const voci = generaPaddock();
    const vicine = voci.filter(v => v.distanzaDallaCorsiaBox < 120).length;
    assert.ok(vicine / voci.length >= 0.5,
        `solo il ${(100*vicine/voci.length).toFixed(0)}% del paddock è vicino ai box`);
});

test('i mezzi del paddock non si compenetrano', () => {
    // Un motorhome dentro un camion è il difetto più visibile possibile:
    // sono i due oggetti più grandi del catalogo dopo le tribune.
    const voci = generaPaddock();
    for (let i = 0; i < voci.length; i++) {
        for (let j = i + 1; j < voci.length; j++) {
            assert.ok(!SceneryAssetSizes.itemsOverlap(voci[i], voci[j]),
                `${voci[i].asset} e ${voci[j].asset} si sovrappongono`);
        }
    }
});

test('le auto parcheggiate stanno in file ordinate', () => {
    // Un parcheggio è fatto di file: auto sparse a caso si leggono come
    // relitti abbandonati, non come un parcheggio.
    const auto = generaPaddock().filter(v => v.asset === 'parkedCar');
    assert.ok(auto.length >= 20, `solo ${auto.length} auto parcheggiate`);
    const orientamenti = new Set(auto.map(v => v.rotY.toFixed(2)));
    assert.ok(orientamenti.size <= Math.ceil(auto.length / 6),
        'le auto non sono allineate in file');
});
```

- [ ] **Step 2: eseguire e verificare che falliscano**

Comando: `node --test frontend/shared/sceneryPaddock.test.js`
Atteso: FAIL — il modulo non esiste.

- [ ] **Step 3: scrivere il modulo**

Crea `frontend/shared/sceneryPaddock.js` con il pattern IIFE degli altri
moduli condivisi. Criterio di piazzamento:

1. **Ancora**: il punto medio della corsia box, spostato lateralmente di
   `barrierDist + PADDOCK_OFFSET` (90) **dalla parte opposta alla pista**.
2. **Fila principale**: motorhome e camion allineati lungo la direzione della
   corsia, passo 22 (l'ingombro maggiore, 20, più 2 di respiro).
3. **Container**: a gruppi di 2-3 dietro la fila, a 20 unità.
4. **Parcheggio**: griglia di `parkedCar` con passo 3.2 in larghezza e 7 in
   profondità, tutte con lo stesso `rotY`, in un rettangolo libero accanto
   alla fila.
5. **Striscioni e spettatori in piedi**: lungo la recinzione, cioè a
   `barrierDist + 8`, ogni 30 unità gli striscioni e a gruppi di 4-6 gli
   spettatori.
6. **Due o tre gruppi sparsi** sul resto del giro, con la stessa
   composizione ridotta (un motorhome, un container, qualche auto).

Ogni candidato passa da `SceneryAssetSizes.itemsOverlap` contro le voci già
accettate, come fa `sceneryLandmarks`.

⚠️ Gli spettatori in piedi vanno a `barrierDist + 8`, cioè **dentro** la fascia
riservata alla ghiaia. È voluto e va scritto nel commento: sono figure appese
alla recinzione, si spostano insieme alla barriera perché la loro distanza è
espressa da lei. La regola della ghiaia vale per gli oggetti che stanno *a
terra* nella via di fuga.

- [ ] **Step 4: agganciare in `trackScenery.js`**

Nel corpo di `generateLayout`, dopo `trackside` e prima di `nature`:

```js
    const paddock = SceneryPaddock.buildLayout(rng, trackPts, pitPts, barrierDist, accepted);
```

e aggiungi `...paddock` all'array finale. Le voci di paddock entrano fra le
`accepted` prima dello scatter della natura, così gli alberi non ci finiscono
dentro.

- [ ] **Step 5: registrare i percorsi e caricare lo script**

Sei voci in `SCENERY_ASSET_PATHS` di `frontend/f1.js`; in `frontend/f1.html`
aggiungi `<script src="shared/sceneryPaddock.js?v=20260810a"></script>` **prima**
di `trackScenery.js`, e bumpa gli altri `?v=`.

- [ ] **Step 6: test e commit — FINE FASE 4**

```
node --test frontend/shared/sceneryPaddock.test.js frontend/shared/trackScenery.test.js
```

```bash
git add frontend/shared/sceneryPaddock.js frontend/shared/sceneryPaddock.test.js frontend/shared/trackScenery.js frontend/f1.js frontend/f1.html
git commit -m "F1 scenografia: piazzamento del paddock"
```

Playtest finale: l'utente guarda il paddock passando dai box, e riporta i
numeri del pannello. Se "di cui disegno" supera 8 ms, la leva è
`WOOD_MAX_TREES` e il numero di auto del parcheggio, non i modelli.

---

## Note per chi esegue

- **I gate utente non si saltano.** Un asset sbagliato costa secondi da
  rifare prima di essere piazzato, e un'ora dopo.
- **Sempre `--no-render`**: i PNG non servono a nessuno e sono quasi tutto il
  tempo di build.
- **Dopo ogni fase, i numeri del pannello F9**, non impressioni.
- **Non toccare la fascia riservata** alla ghiaia, con l'unica eccezione
  documentata degli spettatori a bordo recinzione.
- Se un test sulla densità dei boschi o sull'angolo delle colline fallisce
  dopo una ritaratura chiesta dall'utente, **aggiorna il test**: descrive un
  obiettivo di resa, non una verità matematica.
