# Il Paddock Club sopra i box (blocco G, voce 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sopra la fila di edifici che corre lungo la corsia box nasce un coronamento abitato — terrazze aperte sui garage, salotti vetrati sugli uffici, gente affacciata alla ringhiera — su tutte le piste, cittadine comprese.

**Architecture:** Non è una fila nuova da posizionare. Dove nasce un edificio nasce il suo tetto: stesso `x`, stessa `z`, stesso `rotY` già calcolato, e `y` = quota dell'edificio + la sua altezza **letta dall'ingombro dichiarato**. Il coronamento si genera DOPO la traslazione della scenografia, dal layout stesso, così non può divergere dagli edifici né essere spostato per conto proprio. Non serve nessuna esenzione ai controlli di compenetrazione: `SceneryAssetSizes.itemsOverlap` confronta già le quote, quindi un modulo appoggiato su un tetto non urta ciò che gli sta sotto.

**Tech Stack:** Blender 5.1 headless + `voxelKit.py` per gli asset; Node.js, `node --test` + `node:assert/strict`; moduli UMD condivisi (`frontend/shared/*.js`); Three.js r128 lato client.

**Spec:** `docs/superpowers/specs/2026-09-02-f1-paddock-club-design.md`

## Global Constraints

- **Italiano** nei commenti del codice e nei messaggi di commit.
- **Le piste devono restare identiche in tutto il resto**: il coronamento si aggiunge, non sposta niente. Ogni task che tocca la scenografia lo verifica con un test, non a occhio.
- **Una cosa, una misura**: l'altezza a cui posare il coronamento si legge da `SceneryAssetSizes.sizeOf(assetEdificio).h`, **mai** da un numero scritto a mano. Un numero ricopiato resta indietro il giorno in cui l'edificio cambia, e il coronamento resta sospeso o affonda senza che niente lo dica.
- **Massimo 6 materiali per asset** (`circuitAssets.test.js` lo impone): un InstancedMesh per mesh per cella, e ogni materiale in più è una draw call in più.
- **Pivot alla base** (`Y min ≈ 0`) e modello centrato in XZ, come tutto il catalogo. Il fronte guarda **-Y Blender = +Z gioco**, come `pitsGarageClosed` e `pitsOffice`.
- **Niente marchi reali** sulle insegne (decisione dell'utente del 26-08).
- **Gate di approvazione asset**: i render dei due modelli vanno mostrati all'utente PRIMA di cablarli in gioco. La deroga del 27-08 («li generi e li cabli direttamente») valeva per l'arredo di strada, non per asset grossi in primo piano.
- **Niente `git add -A`**: aggiungere i file per nome; l'utente lavora in parallelo sulle sue piste (`frontend/tracks/nuova-pista.json` e i `*-raceline.json` non tracciati NON vanno committati).
- **Commit ad ogni task**, con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Cache-busting**: ogni modulo condiviso toccato vuole il bump del `?v=` in `frontend/f1.html` (e nelle altre pagine che lo caricano, se lo caricano): usare `20260902a`.
- **Baseline dei test attesa** (su `main`, dal 2026-08-27): `node --test frontend/shared/` → **4 rossi**; `node --test backend/` → **8 rossi + 2 skip**. Sul disco dell'utente ce ne sono ~3 in più dovuti a `nuova-pista`: non sono regressioni. **Misurarla PRIMA di cominciare**, non fidarsi di questa riga.
- ⚠️ **`prova` è congelata**: legge la scenografia cotta da `frontend/tracks/scenografie/prova.json`. Finché non la si ricuoce (Task 6, solo se l'utente lo chiede) il Paddock Club **non comparirà su `prova`**. Per il playtest usare `citta-prova`, `banking-prova` o `nuova-pista`.

## Struttura dei file

| File | Responsabilità |
|---|---|
| `backend/tools/circuitAssets/pitClub.py` (nuovo) | I due modelli e le ancore degli spettatori che ci stanno sopra |
| `backend/tools/circuitAssets/__init__.py` | Registra i due `assetId` |
| `backend/tools/f1CircuitAssetsBuilder.py` | Unisce le ancore di `pitClub` a quelle di `infrastructure` |
| `frontend/shared/sceneryAssetPaths.js` | Dove sta il `.glb` di ciascuno |
| `frontend/shared/sceneryAssetSizes.js` | L'ingombro dichiarato dei due asset |
| `frontend/shared/trackScenery.js` | Genera il coronamento dal layout; categoria `paddock-club` |
| `frontend/shared/trackValidatore.js` | Riconosce il coronamento come sorgente di spettatori |
| `frontend/shared/sceneryPaddockClub.test.js` (nuovo) | Tutte le invarianti della voce, su ogni pista della cartella |
| `backend/tools/circuitAssets.test.js` | Target di ingombro dei due modelli |
| `frontend/f1.html` | Bump del cache-busting |

---

### Task 1: I due modelli e le loro ancore

Gli asset e basta: nessuno li usa ancora. Si chiude col gate di approvazione dell'utente sui render.

**Files:**
- Create: `backend/tools/circuitAssets/pitClub.py`
- Modify: `backend/tools/circuitAssets/__init__.py` — import e due righe in `ASSET_BUILDERS`
- Modify: `backend/tools/f1CircuitAssetsBuilder.py:73-84` — unione delle ancore
- Test: `backend/tools/circuitAssets.test.js` — due voci in `EXPECTED`

**Interfaces:**
- Produces: `frontend/assets/custom/circuit/pitRoofTerrace.glb`, `pitRoofLounge.glb`; e in `terraceAnchors.json` le chiavi `pitRoofTerrace` e `pitRoofLounge`, ciascuna con una lista di `{x, y, z}` in coordinate GIOCO relative all'origine dell'asset.

- [ ] **Step 1: Scrivere il target di ingombro (il test che fallisce)**

In `backend/tools/circuitAssets.test.js`, dentro `EXPECTED`, subito dopo `pitsOffice`:

```js
    // Il coronamento della fila dei box (spec 2026-09-02). Le misure sono
    // quelle degli edifici sotto — W 12.3, D 14.0 — perché ci si appoggiano
    // sopra: un coronamento più largo sporgerebbe nel vuoto.
    pitRoofTerrace:    { w: 12.9, h: 3.6, d: 14.6 },
    pitRoofLounge:     { w: 13.1, h: 4.2, d: 14.6 },
```

- [ ] **Step 2: Eseguire il test e vederlo fallire**

Run: `node --test backend/tools/circuitAssets.test.js`
Expected: FAIL — `pitRoofTerrace: il .glb esiste ed è parsabile` (il file non c'è).

- [ ] **Step 3: Scrivere il builder**

Create `backend/tools/circuitAssets/pitClub.py`:

```python
"""Il coronamento della fila dei box: terrazza aperta sopra il garage,
salotto vetrato sopra la palazzina uffici (spec 2026-09-02).

Il fronte guarda -Y Blender = +Z gioco, come gli edifici sotto.

⚠️ Questi due modelli NON hanno basamento: l'edificio sotto È il basamento.
Il pivot sta alla base del modulo, e chi lo posa lo mette alla quota
dell'edificio più la sua altezza.

⚠️ La pianta è quella degli edifici (pitBuildings.W x pitBuildings.D): un
coronamento più largo sporgerebbe nel vuoto, uno più stretto lascerebbe
vedere il tetto nudo. Si importa da lì invece di ricopiarla.
"""
from voxelKit import EPS

from . import pitBuildings

W = pitBuildings.W          # 12.3
D = pitBuildings.D          # 14.0
HALF_W = W / 2
HALF_D = D / 2
FRONT = -HALF_D             # verso la corsia box

# Solaio: sporge di 0.3 per lato e copre il bordo del tetto sottostante —
# sulla palazzina copre anche il parapetto che quel modello ha già, così la
# giunzione non si legge da nessuna angolazione.
SLAB_H = 0.4
SLAB_OVER = 0.3
PARAPETTO_H = 1.1


def _solaio(kit, mat):
    kit.box(mat, (W + SLAB_OVER * 2, D + SLAB_OVER * 2, SLAB_H),
            (0, 0, SLAB_H / 2))


def build_pit_roof_terrace(kit):
    """Terrazza aperta sopra il garage: parapetto pieno, pergola, tavolini
    con ombrelloni, fioriere, bancone sul fondo."""
    z0 = SLAB_H
    _solaio(kit, 'concreteDark')

    # Parapetto PIENO, non a montanti: da lontano una fila di stecchini non
    # si legge, un pannello sì — è la lezione già pagata sull'hospitalityDeck.
    # La banda rossa in cima è dove va il colore.
    for sy, lung in ((-1, W - 0.4), (1, W - 0.4)):
        y = sy * (HALF_D - 0.25)
        kit.box('white', (lung, 0.35, PARAPETTO_H), (0, y, z0 + PARAPETTO_H / 2))
        kit.box('red', (lung + 0.15, 0.45, 0.25), (0, y, z0 + PARAPETTO_H + 0.125 - EPS))
    for sx in (-1, 1):
        x = sx * (HALF_W - 0.25)
        kit.box('white', (0.35, D - 1.0, PARAPETTO_H), (x, 0, z0 + PARAPETTO_H / 2))
        kit.box('red', (0.45, D - 0.85, 0.25), (x, 0, z0 + PARAPETTO_H + 0.125 - EPS))

    # Pergola sul fondo: quattro montanti e un telo. Dà un'ombra e un volume
    # alla terrazza, che altrimenti da fuori è un rettangolo vuoto.
    pergola_z = z0 + 2.6
    for sx in (-1, 1):
        for sy in (-1, 1):
            kit.box('steel', (0.28, 0.28, pergola_z - z0),
                    (sx * 3.4, 2.2 + sy * 2.0, z0 + (pergola_z - z0) / 2))
    kit.box('red', (8.0, 5.2, 0.3), (0, 2.2, pergola_z + 0.15))

    # Tavolini con ombrellone, verso il fronte: si vedono dalla corsia box.
    for sx in (-1, 0, 1):
        x = sx * 3.6
        kit.box('white', (1.4, 1.4, 0.85), (x, FRONT + 3.4, z0 + 0.425))
        kit.box('steel', (0.16, 0.16, 1.5), (x, FRONT + 3.4, z0 + 0.85 + 0.75))
        kit.box('red', (2.4, 2.4, 0.22), (x, FRONT + 3.4, z0 + 2.35 + 0.11))

    # Fioriere lungo il parapetto laterale e bancone contro il fondo.
    for sy in (-1, 1):
        kit.box('leafDark', (1.6, 1.1, 0.75), (HALF_W - 1.4, sy * 1.6, z0 + 0.375))
        kit.box('leafDark', (1.6, 1.1, 0.75), (-HALF_W + 1.4, sy * 1.6, z0 + 0.375))
    kit.box('white', (6.0, 1.0, 1.15), (0, HALF_D - 1.6, z0 + 0.575))
    kit.box('red', (6.2, 1.2, 0.18), (0, HALF_D - 1.6, z0 + 1.15 + 0.09 - EPS))

    return W + SLAB_OVER * 2, pergola_z + 0.3


def build_pit_roof_lounge(kit):
    """Salotto vetrato sopra la palazzina uffici: vetrata continua, marcapiano
    dorato, insegna, e una fascia aperta sul fronte con verde e gazebo."""
    z0 = SLAB_H
    _solaio(kit, 'white')

    # Il volume vetrato occupa i due terzi sul retro: davanti resta una fascia
    # praticabile, che è quella che si vede dalla corsia box.
    box_d = D * 0.62
    box_y = HALF_D - box_d / 2 - 0.2
    h_vetro = 3.2
    kit.box('glass', (W - 1.6, box_d, h_vetro), (0, box_y, z0 + h_vetro / 2))
    # Montanti: rompono la vetrata continua, che altrimenti è una lastra sola.
    for i in range(5):
        kit.box('white', (0.34, 0.5, h_vetro),
                ((i - 2) * (W - 1.6) / 5, box_y - box_d / 2 - 0.2, z0 + h_vetro / 2))
    # Spalle piene ai lati del volume vetrato.
    for sx in (-1, 1):
        kit.box('white', (0.5, box_d, h_vetro),
                (sx * ((W - 1.6) / 2 + 0.25), box_y, z0 + h_vetro / 2))

    # Marcapiano dorato subito sotto il tetto: è il segno che dice «qui è la
    # parte cara» da qualunque angolo. Stessa idea della vipSuite.
    kit.box('yellow', (W + 0.5, box_d + 0.8, 0.35), (0, box_y, z0 + h_vetro + 0.175))
    kit.box('white', (W + 0.2, box_d + 0.5, 0.35), (0, box_y, z0 + h_vetro + 0.5))
    # Insegna sul fronte del volume, senza marchi: una fascia e basta.
    kit.box('yellow', (6.4, 0.3, 0.9),
            (0, box_y - box_d / 2 - 0.35, z0 + h_vetro - 0.7))

    # La fascia aperta davanti: ringhiera bassa, fioriere, due gazebo.
    kit.box('white', (W - 0.4, 0.3, 0.9), (0, FRONT + 0.25, z0 + 0.45))
    for sx in (-1, 1):
        kit.box('leafDark', (1.8, 1.2, 0.7), (sx * 4.4, FRONT + 1.5, z0 + 0.35))
        x = sx * 2.4
        kit.box('steel', (0.2, 0.2, 2.0), (x, FRONT + 2.6, z0 + 1.0))
        kit.box('yellow', (3.0, 3.0, 0.28), (x, FRONT + 2.6, z0 + 2.14))

    return W + SLAB_OVER * 2, z0 + h_vetro + 0.7


# --- Dove stanno gli spettatori -------------------------------------------
# Stessa idea di infrastructure.terrace_anchors(): le posizioni nascono dalla
# geometria del modello, così non possono divergerne. Coordinate GIOCO
# relative all'origine dell'asset — Blender (x, y, z) -> gioco (x, z, -y) —
# col pivot della figura ai piedi.
def terrace_anchors():
    z_pav = SLAB_H

    # Terrazza: una fila affacciata al parapetto (dove si sta a guardare la
    # pista) e qualcuno fra i tavolini. ⚠️ Non sotto la pergola: il telo sta a
    # 2.9 dal piano e una figura in piedi è alta 2.3 — ci sta, ma i montanti
    # a 3.4 di lato no, quindi la fila si ferma prima.
    terrazza = []
    for i in range(9):
        terrazza.append({'x': round((i - 4) * 1.3, 3), 'y': round(z_pav, 3),
                         'z': round(HALF_D - 1.1, 3)})
    for sx in (-1, 1):
        terrazza.append({'x': round(sx * 5.0, 3), 'y': round(z_pav, 3),
                         'z': round(HALF_D - 4.6, 3)})

    # Salotto: si sta sulla fascia aperta davanti, non dietro la vetrata.
    salotto = []
    for i in range(7):
        salotto.append({'x': round((i - 3) * 1.5, 3), 'y': round(z_pav, 3),
                        'z': round(HALF_D - 1.3, 3)})
    return {'pitRoofTerrace': terrazza, 'pitRoofLounge': salotto}
```

⚠️ Le ancore stanno in coordinate gioco: `z` gioco = `-y` Blender, e il fronte
(che in Blender è a `-D/2`) diventa `+D/2` in gioco. Per questo i valori sopra
sono `HALF_D - qualcosa`, positivi, come già fa `infrastructure.terrace_anchors`.

- [ ] **Step 4: Registrare i due asset**

In `backend/tools/circuitAssets/__init__.py`, aggiungere `pitClub` alla riga di import e, in fondo a `ASSET_BUILDERS`:

```python
    # Il coronamento della fila dei box (spec 2026-09-02).
    'pitRoofTerrace':    pitClub.build_pit_roof_terrace,
    'pitRoofLounge':     pitClub.build_pit_roof_lounge,
```

In `backend/tools/f1CircuitAssetsBuilder.py`, dove oggi c'è `anchors = infrastructure.terrace_anchors()`:

```python
# ⚠️ Le ancore arrivano da PIU' moduli: le terrazze delle infrastrutture e il
# coronamento della fila dei box. Un file solo, perché per uno spettatore «la
# mia terrazza» è l'oggetto su cui poggia, quale che sia il modulo che l'ha
# scolpito.
anchors = dict(infrastructure.terrace_anchors())
anchors.update(pitClub.terrace_anchors())
```

e aggiungere `from circuitAssets import pitClub  # noqa: E402` accanto agli altri import.

- [ ] **Step 5: Costruire gli asset**

Run:
```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
  --python backend/tools/f1CircuitAssetsBuilder.py -- --asset pitRoofTerrace,pitRoofLounge
```
Expected: due `.glb` in `frontend/assets/custom/circuit/`, due `.png` in `backend/tools/renders/circuit/`, e la riga `ancore terrazze -> ...`.

- [ ] **Step 6: Eseguire i test e vederli passare**

Run: `node --test backend/tools/circuitAssets.test.js`
Expected: PASS su tutti e otto i controlli dei due asset nuovi (esiste, ≤6 materiali, pivot alla base, ingombro entro ±20%).

Run: `"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --python backend/tools/circuitAssetsBlackCheck.py -- --asset pitRoofTerrace,pitRoofLounge`
Expected: nessuna faccia complanare segnalata. ⚠️ Il blackCheck non vede lo z-fighting fra colori chiari: guardare anche i render.

- [ ] **Step 7: Gate utente sui render**

Mostrare all'utente `backend/tools/renders/circuit/pitRoofTerrace.png` e `pitRoofLounge.png` e attendere l'approvazione **prima** di proseguire col Task 2. Se boccia, si corregge il builder e si ripete dallo Step 5.

- [ ] **Step 8: Commit**

```bash
git add backend/tools/circuitAssets/pitClub.py backend/tools/circuitAssets/__init__.py \
        backend/tools/f1CircuitAssetsBuilder.py backend/tools/circuitAssets.test.js \
        frontend/assets/custom/circuit/pitRoofTerrace.glb \
        frontend/assets/custom/circuit/pitRoofLounge.glb \
        frontend/assets/custom/circuit/terraceAnchors.json \
        backend/tools/renders/circuit/pitRoofTerrace.png \
        backend/tools/renders/circuit/pitRoofLounge.png
git commit -m "Due modelli per i tetti dei box: una terrazza e un salotto"
```

---

### Task 2: Le due tabelle — dove sta il modello, quanto ingombra

Un asset vive in posti che non si conoscono fra loro: il builder, il percorso, l'ingombro. ⚠️ E il disallineamento è **silenzioso**: `sizeOf` di un asset non dichiarato restituisce il ripiego 6×6×6, e da lì la porta della scenografia giudica un salotto come un cubo di sei unità, con tutti i test verdi. È già successo con tredici asset.

**Files:**
- Modify: `frontend/shared/sceneryAssetPaths.js` — dentro `PERCORSI`
- Modify: `frontend/shared/sceneryAssetSizes.js` — dentro la tabella degli ingombri
- Modify: `frontend/f1.html` — bump `?v=` dei due moduli
- Test: `frontend/shared/sceneryPaddockClub.test.js` (nuovo)

**Interfaces:**
- Consumes: i due `.glb` del Task 1.
- Produces: `SceneryAssetPaths.PERCORSI.pitRoofTerrace` / `.pitRoofLounge`; `SceneryAssetSizes.sizeOf('pitRoofTerrace')` → `{w, h, d}` coincidente col `.glb`.

- [ ] **Step 1: Scrivere il test che fallisce**

Create `frontend/shared/sceneryPaddockClub.test.js`:

```js
// frontend/shared/sceneryPaddockClub.test.js
//
// IL CORONAMENTO DELLA FILA DEI BOX (spec 2026-09-02).
//
// ⚠️ Gira con `node --test frontend/shared/`, non con `node --test backend/`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Sizes = require('./sceneryAssetSizes.js');
const Paths = require('./sceneryAssetPaths.js');
const { inspectGlb } = require('../../backend/tools/glbInspect.js');

const GLB_DIR = path.join(__dirname, '..', 'assets', 'custom', 'circuit');
const CORONAMENTI = ['pitRoofTerrace', 'pitRoofLounge'];

for (const asset of CORONAMENTI) {
    test(`${asset}: ha un percorso e il file c'e'`, () => {
        const url = Paths.PERCORSI[asset];
        assert.ok(url, `${asset} non e' in PERCORSI`);
        assert.ok(fs.existsSync(path.join(GLB_DIR, asset + '.glb')));
    });

    test(`${asset}: l'ingombro dichiarato coincide col .glb`, () => {
        const dichiarato = Sizes.sizeOf(asset);
        // `size` e' un array [x, y, z] in coordinate gioco: w = X, h = Y, d = Z.
        const size = inspectGlb(path.join(GLB_DIR, asset + '.glb')).size;
        for (const [campo, vero] of [['w', size[0]], ['h', size[1]], ['d', size[2]]]) {
            assert.ok(Math.abs(dichiarato[campo] - vero) <= 0.05,
                `${asset}.${campo}: dichiarato ${dichiarato[campo]}, nel .glb ${vero.toFixed(2)}`);
        }
    });
}
```

⚠️ I numeri della tabella (Step 3) vanno **letti dal `.glb`**, non copiati da qui:
```bash
node -e "console.log(require('./backend/tools/glbInspect.js').inspectGlb('frontend/assets/custom/circuit/pitRoofTerrace.glb').size)"
```
Riferimento: `pitsOffice` misura `[13, 13.06, 14.875]` ed è dichiarato `{ w: 13.0, h: 13.1, d: 14.9 }` — la tolleranza di 0.05 è tarata su questo arrotondamento.

- [ ] **Step 2: Eseguire il test e vederlo fallire**

Run: `node --test frontend/shared/sceneryPaddockClub.test.js`
Expected: FAIL — `pitRoofTerrace non e' in PERCORSI`, e l'ingombro dichiarato è il ripiego 6×6×6.

- [ ] **Step 3: Riempire le due tabelle**

In `frontend/shared/sceneryAssetPaths.js`, dentro `PERCORSI`, sotto `pitsOffice`:

```js
        // Il coronamento della fila dei box (spec 2026-09-02): la terrazza sta
        // sul garage, il salotto sulla palazzina uffici.
        pitRoofTerrace: '/assets/custom/circuit/pitRoofTerrace.glb',
        pitRoofLounge: '/assets/custom/circuit/pitRoofLounge.glb',
```

In `frontend/shared/sceneryAssetSizes.js`, accanto a `pitsGarageClosed`/`pitsOffice`, coi valori **letti dal `.glb`** allo Step 1 (esempio, da sostituire coi veri):

```js
        pitRoofTerrace:    { w: 12.9, h: 3.6,  d: 14.6 },
        pitRoofLounge:     { w: 13.1, h: 4.2,  d: 14.6 },
```

In `frontend/f1.html`, portare a `?v=20260902a` i tag di `sceneryAssetPaths.js` e `sceneryAssetSizes.js` (e controllare `track-editor.html` / `track-preview.html`, se li caricano).

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test frontend/shared/sceneryPaddockClub.test.js frontend/shared/sceneryAssetPaths.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/sceneryAssetPaths.js frontend/shared/sceneryAssetSizes.js \
        frontend/shared/sceneryPaddockClub.test.js frontend/f1.html
git commit -m "I due tetti entrano nelle tabelle: percorso e ingombro vero"
```

---

### Task 3: La posa — dove nasce un edificio nasce il suo tetto

**Files:**
- Modify: `frontend/shared/trackScenery.js` — nuova funzione accanto a `buildPaddockLayout`; chiamata nel corpo di `generateLayout` **dopo** i due blocchi di pulizia post-traslazione e **prima** della folla (oggi intorno alla riga 1860); `NON_SCARTABILI` (~riga 2005)
- Modify: `frontend/f1.html` — bump `?v=` di `trackScenery.js`
- Test: `frontend/shared/sceneryPaddockClub.test.js`

**Interfaces:**
- Consumes: `SceneryAssetSizes.sizeOf(assetEdificio).h` dal Task 2.
- Produces: voci di layout `{ asset: 'pitRoofTerrace'|'pitRoofLounge', category: 'paddock-club', x, y, z, rotY, scale }`.

- [ ] **Step 1: Scrivere i test che falliscono**

In coda a `frontend/shared/sceneryPaddockClub.test.js`:

```js
const TrackScenery = require('./trackScenery.js');
const { loadTrack } = require('../../backend/sockets/games/trackLoader.js');
const seats = require('../assets/custom/circuit/grandStandSeats.json').seats;
const terraceAnchors = require('../assets/custom/circuit/terraceAnchors.json').anchors;

const PISTE = fs.readdirSync(path.join(__dirname, '..', 'tracks'))
    .filter(f => f.endsWith('.json') && !/^(__|test-)/.test(f))
    .map(f => f.replace(/\.json$/, ''));

const cache = new Map();
function scenografiaDi(id) {
    if (!cache.has(id)) {
        const raw = JSON.parse(fs.readFileSync(
            path.join(__dirname, '..', 'tracks', id + '.json'), 'utf8'));
        const t = loadTrack(id);
        cache.set(id, TrackScenery.generateLayout(raw, t.points, t.pitLanePts,
            raw.roadHalfWidth + 2.8 + 1.2, 45, seats, t.barrierProfile,
            terraceAnchors, { gridSize: 6 }));
    }
    return cache.get(id);
}

const SOPRA = { pitsGarageClosed: 'pitRoofTerrace', pitsOffice: 'pitRoofLounge' };
const chiave = (v) => v.x.toFixed(2) + ',' + v.z.toFixed(2);

for (const id of PISTE) {
    test(`${id}: ogni edificio della corsia box ha il suo coronamento`, () => {
        const layout = scenografiaDi(id);
        const corone = new Map(layout
            .filter(v => v.category === 'paddock-club').map(v => [chiave(v), v]));
        const senza = layout
            .filter(v => SOPRA[v.asset])
            .filter(v => {
                const c = corone.get(chiave(v));
                return !c || c.asset !== SOPRA[v.asset];
            });
        assert.deepEqual(senza.map(v => `${v.asset} a (${v.x.toFixed(1)}, ${v.z.toFixed(1)})`), []);
    });

    test(`${id}: nessun coronamento orfano, e nessuno storto`, () => {
        const layout = scenografiaDi(id);
        const edifici = new Map(layout
            .filter(v => SOPRA[v.asset]).map(v => [chiave(v), v]));
        const guai = [];
        for (const c of layout.filter(v => v.category === 'paddock-club')) {
            const e = edifici.get(chiave(c));
            if (!e) { guai.push(`${c.asset} senza edificio sotto`); continue; }
            // Stesso orientamento: un tetto ruotato rispetto al suo edificio
            // sporgerebbe da un lato e lascerebbe scoperto l'altro.
            if (Math.abs((c.rotY || 0) - (e.rotY || 0)) > 1e-9) {
                guai.push(`${c.asset} ruotato rispetto al suo edificio`);
            }
            // Ne' sospeso ne' affondato: la quota e' quella dell'edificio piu'
            // la sua altezza, letta dall'ingombro dichiarato.
            const atteso = (e.y || 0) + Sizes.sizeOf(e.asset).h * (e.scale || 1);
            if (Math.abs((c.y || 0) - atteso) > 1e-6) {
                guai.push(`${c.asset} a quota ${c.y} invece di ${atteso}`);
            }
        }
        assert.deepEqual(guai, []);
    });
}
```

- [ ] **Step 2: Eseguire i test e vederli fallire**

Run: `node --test frontend/shared/sceneryPaddockClub.test.js`
Expected: FAIL su ogni pista — nessuna voce `paddock-club` nel layout.

- [ ] **Step 3: Generare il coronamento**

In `frontend/shared/trackScenery.js`, accanto a `buildPaddockLayout`:

```js
    // IL CORONAMENTO DELLA FILA DEI BOX (spec 2026-09-02).
    //
    // Dove nasce un edificio della corsia box nasce il suo tetto abitato:
    // stesso punto, stesso orientamento, quota = quella dell'edificio piu' la
    // sua altezza. Non e' una fila da posizionare — e' una conseguenza — e per
    // questo non puo' aprirsi a ventaglio in curva ne' perdere un pezzo per
    // strada: eredita il lavoro gia' fatto sugli edifici.
    //
    // ⚠️ Si genera DOPO la traslazione della scenografia. Gli edifici portano
    // `natoSullaCorsia` e vengono spostati; un coronamento nato prima
    // seguirebbe una strada sua — e' lo stesso motivo per cui la folla nasce
    // dopo la traslazione e non prima.
    //
    // Non serve nessuna esenzione ai controlli di compenetrazione:
    // SceneryAssetSizes.itemsOverlap confronta gia' le quote, quindi un modulo
    // appoggiato su un tetto non urta cio' che gli sta sotto.
    const CORONAMENTO = {
        pitsGarageClosed: 'pitRoofTerrace',
        pitsOffice: 'pitRoofLounge',
    };

    function coronamentoDeiBox(layout) {
        const out = [];
        for (const v of layout) {
            const asset = CORONAMENTO[v.asset];
            if (!asset) continue;
            // ⚠️ L'altezza si LEGGE dall'ingombro dichiarato, mai scritta a
            // mano: un numero ricopiato qui resterebbe indietro il giorno in
            // cui l'edificio cambia, e il tetto resterebbe sospeso o affondato
            // senza che nessun test se ne accorga.
            const h = SceneryAssetSizes.sizeOf(v.asset).h * (v.scale || 1);
            out.push({
                asset, category: 'paddock-club',
                x: v.x, y: (v.y || 0) + h, z: v.z,
                rotY: v.rotY || 0, scale: CUSTOM_MODEL_SCALE,
            });
        }
        return out;
    }
```

Nel corpo di `generateLayout`, subito **prima** del blocco «Spettatori DOPO la traslazione, non prima»:

```js
        // Il coronamento nasce qui: gli edifici della corsia box sono ormai
        // dove staranno, e la folla che verra' dopo lo trovera' fra le
        // terrazze senza bisogno di sapere che esiste.
        layout.push(...coronamentoDeiBox(layout));
```

⚠️ `coronamentoDeiBox` ritorna un array nuovo e non muta `layout`: lo `spread` va calcolato prima del `push`, quindi **non** iterare `layout` mentre ci si scrive dentro.

E in `NON_SCARTABILI`:

```js
        // 'paddock-club' e' la stessa fila continua, vista da sopra: un buco
        // nel coronamento si vede a colpo d'occhio quanto un buco nel fronte
        // dei box. Le sue eventuali violazioni si curano alla fonte — cioe'
        // spostando l'edificio sotto — non scartando il tetto.
        const NON_SCARTABILI = new Set(['paddock', 'grandstand-main', 'paddock-club']);
```

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test frontend/shared/sceneryPaddockClub.test.js`
Expected: PASS su tutte le piste.

Run: `node --test frontend/shared/scenografiaInvarianti.test.js frontend/shared/trackScenery.test.js`
Expected: nessun rosso nuovo rispetto alla baseline. Se compare una compenetrazione che coinvolge `paddock-club`, **non** aggiungere un'esenzione: leggere quale coppia è, perché vuol dire che qualcosa di alto sta davvero dentro il coronamento.

- [ ] **Step 5: Bump del cache-busting e commit**

Portare `trackScenery.js` a `?v=20260902a` in `frontend/f1.html` (e nelle altre pagine che lo caricano).

```bash
git add frontend/shared/trackScenery.js frontend/shared/sceneryPaddockClub.test.js frontend/f1.html
git commit -m "Sopra i box nasce il paddock club, e nasce dove nascono i box"
```

---

### Task 4: La gente affacciata, e la lista che sparisce

**Files:**
- Modify: `frontend/shared/trackScenery.js` — il filtro `terrazze` (~riga 1885) e `sedutiRimasti` (~riga 2090)
- Modify: `frontend/shared/trackValidatore.js:506` — le sorgenti degli spettatori
- Test: `frontend/shared/sceneryPaddockClub.test.js`

**Interfaces:**
- Consumes: `terraceAnchors.json` col le chiavi nuove (Task 1), le voci `paddock-club` (Task 3).
- Produces: voci `category: 'crowd'` il cui `daTribuna` è la chiave `x,z` del coronamento.

- [ ] **Step 1: Scrivere il test che fallisce**

In coda a `frontend/shared/sceneryPaddockClub.test.js`:

```js
test('sulle terrazze dei box c\'e\' gente, e sta alla quota della terrazza', () => {
    const layout = scenografiaDi('citta-prova');
    const terrazze = layout.filter(v => v.asset === 'pitRoofTerrace');
    assert.ok(terrazze.length >= 5, `solo ${terrazze.length} terrazze`);
    const persone = layout.filter(v => v.category === 'crowd');
    const sopra = terrazze.filter(t => persone.some(
        p => p.daTribuna === t.x.toFixed(2) + ',' + t.z.toFixed(2)));
    assert.ok(sopra.length >= terrazze.length / 2,
        `gente su ${sopra.length} terrazze su ${terrazze.length}`);
    // In piedi sul piano della terrazza, non a mezz'aria ne' dentro il solaio.
    for (const t of terrazze) {
        for (const p of persone.filter(
                p => p.daTribuna === t.x.toFixed(2) + ',' + t.z.toFixed(2))) {
            assert.ok(p.y > t.y && p.y < t.y + 1.0,
                `spettatore a ${p.y} con la terrazza a ${t.y}`);
        }
    }
});

test('un asset con le ancore non ha bisogno di essere elencato a mano', () => {
    // La regola vera: chi ha ancore ha gente. Se qualcuno tornera' a scrivere
    // una lista di asset, questo test resta verde solo finche' quella lista e'
    // completa — ed e' esattamente il modo in cui la voce fallirebbe in
    // silenzio, quindi il controllo sta sul CONTENUTO del file delle ancore.
    const conAncore = Object.keys(terraceAnchors);
    assert.ok(conAncore.includes('pitRoofTerrace') && conAncore.includes('pitRoofLounge'),
        `terraceAnchors.json contiene ${conAncore.join(', ')}`);
    const layout = scenografiaDi('citta-prova');
    const persone = layout.filter(v => v.category === 'crowd');
    const sorgenti = new Set(persone.map(p => p.daTribuna));
    const scoperti = layout
        .filter(v => conAncore.includes(v.asset))
        .filter(v => !sorgenti.has(v.x.toFixed(2) + ',' + v.z.toFixed(2)));
    // Non TUTTI devono averla (il riempimento e' casuale), ma non puo' essere
    // che un'intera famiglia resti deserta.
    const perAsset = {};
    for (const v of scoperti) perAsset[v.asset] = (perAsset[v.asset] || 0) + 1;
    for (const asset of conAncore) {
        const totali = layout.filter(v => v.asset === asset).length;
        if (!totali) continue;
        assert.notEqual(perAsset[asset], totali, `${asset}: nessuno ha gente sopra`);
    }
});
```

- [ ] **Step 2: Eseguire i test e vederli fallire**

Run: `node --test frontend/shared/sceneryPaddockClub.test.js`
Expected: FAIL — sulle terrazze dei box non c'è nessuno (il filtro guarda solo `hospitalityDeck` e `vipSuite`).

- [ ] **Step 3: Chiedere al file delle ancore invece che a una lista**

In `frontend/shared/trackScenery.js`, sostituire il filtro delle terrazze:

```js
        // ⚠️ CHI HA LE ANCORE HA UNA TERRAZZA. Prima qui c'era una lista di
        // asset scritta a mano ('hospitalityDeck', 'vipSuite'): un asset nuovo
        // con la sua terrazza nasceva deserto, e nessun test lo diceva. La
        // domanda si fa al file delle ancore, che e' l'unico che lo sa.
        //
        // Si guarda TUTTO il layout e non le sole infrastrutture: il
        // coronamento della fila dei box e' altrettanto abitato.
        const terrazze = layout.filter(v => v.asset && terraceAnchors && terraceAnchors[v.asset]);
```

E più sotto, in `sedutiRimasti`:

```js
        for (const v of passate) {
            if (terraceAnchors && terraceAnchors[v.asset]) {
                sedutiRimasti.add(v.x.toFixed(2) + ',' + v.z.toFixed(2));
            }
        }
```

In `frontend/shared/trackValidatore.js`, nel controllo 4 (spettatori orfani):

```js
        // Le sorgenti della folla: le tribune e tutto cio' che ha una terrazza
        // abitata — le infrastrutture e il coronamento della fila dei box.
        const sorgenti = layout.filter(v => v.category === 'grandstand' || v.category === 'grandstand-main'
            || v.category === 'paddock-club'
            || v.asset === 'hospitalityDeck' || v.asset === 'vipSuite');
```

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test frontend/shared/sceneryPaddockClub.test.js frontend/shared/scenografiaInvarianti.test.js frontend/shared/sceneryCrowd.test.js`
Expected: PASS, e nessun rosso nuovo (in particolare: nessun «spettatori a mezz'aria» dal validatore).

- [ ] **Step 5: Bump e commit**

`trackValidatore.js` → `?v=20260902a` dove viene caricato.

```bash
git add frontend/shared/trackScenery.js frontend/shared/trackValidatore.js \
        frontend/shared/sceneryPaddockClub.test.js frontend/f1.html frontend/track-editor.html
git commit -m "Sulle terrazze c'e' gente perche' hanno le ancore, non perche' sono in elenco"
```

---

### Task 5: Il conto, la suite intera, il playtest

**Files:** nessuna modifica prevista. Se il conto lo impone, si torna sul builder del Task 1.

- [ ] **Step 1: Misurare il costo**

Run: `node backend/tools/f1-costo-scenografia.js prova citta-prova shanghai`
Confrontare con la stessa misura fatta su `main` prima di cominciare (`git stash` non serve: basta averla presa all'inizio).
Atteso: +25 istanze su `prova`, +31 su `citta-prova`, +53 su `shanghai`, e pochi InstancedMesh in più — sono due asset soli, tutti vicini fra loro.
⚠️ Se gli InstancedMesh salgono in modo visibile, la leva è **ridurre i materiali dei due modelli**, non spargere meno moduli: il numero che conta è il materiale per cella.

- [ ] **Step 2: Suite completa**

Run: `node --test frontend/shared/` e `node --test backend/`
Expected: gli stessi rossi della baseline presa all'inizio, né uno di più.

- [ ] **Step 3: Guardarlo**

`node backend/server.js` dalla cartella `backend/`, poi `localhost:3000`, gara veloce su **`citta-prova`** o `banking-prova` (⚠️ **non** su `prova`: legge la scenografia cotta e non mostrerà niente).
Da controllare in griglia e durante una sosta: la fila non ha buchi, i tetti non fluttuano né affondano, la gente sta sul piano, in curva i moduli non si aprono a ventaglio.
Hard refresh (Ctrl+F5) prima di dire «non vedo differenze»: il `?v=` su un modulo non basta se il browser ha in cache `f1.html`.

- [ ] **Step 4: Pannello F9, prima e dopo**

Sulla stessa pista e dalla stessa inquadratura (rettilineo dei box, guardando avanti). Il gioco è GPU-bound sui pixel: due asset in più che riempiono poco schermo non dovrebbero costare nulla. Se costano più di 3-4 fps, dirlo all'utente con i due numeri invece di decidere da soli.

- [ ] **Step 5: Commit finale**

Solo se ci sono state correzioni; altrimenti niente da committare.

---

### Task 6 (condizionale): ricuocere `prova`

⚠️ **Da eseguire SOLO se l'utente lo chiede esplicitamente.** `prova` è congelata apposta: la sua scenografia sta in `frontend/tracks/scenografie/prova.json` e non cambia quando cambia l'algoritmo. È la garanzia che gli è costata il blocco B, e vale più del Paddock Club.

- [ ] **Step 1: Ricuocere**

Run: `node backend/tools/f1-cuoci-scenografia.js prova`

- [ ] **Step 2: Verificare la differenza**

Il file deve cambiare **solo** per le voci `paddock-club` e per la folla che ci sta sopra. Confrontare i conteggi per categoria prima e dopo: qualunque altra differenza vuol dire che la cottura vecchia era già disallineata dall'algoritmo, e va detto all'utente prima di committare.

- [ ] **Step 3: Commit**

```bash
git add frontend/tracks/scenografie/prova.json
git commit -m "Anche prova ha il suo paddock club: ricotta su richiesta"
```
