# Il palazzo dei box, a fette che seguono la curva — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al posto dell'alternanza di due tetti sopra la fila dei box nasce **un edificio solo** — garage al piano terra, club VIP al primo piano — costruito con fette da 7.5 unità che seguono la curva della corsia e si adattano da sole a ogni pista.

**Architecture:** Un modulo puro nuovo, `PitClubProfilo`, è l'unico a sapere dove comincia e dove finisce il palazzo: calcola il tratto dai box a 20 piloti, lo taglia in un numero intero di fette a passo fisso 7.5 (mezzo passo di box, così ogni box cade su un confine di fetta), sceglie il tipo di ciascuna e le scosta tutte insieme dello stesso valore. `trackScenery.js` gli chiede le fette e le posa dentro `buildPaddockLayout`, prima di ogni altra categoria, con `category: 'paddock-club'` — che è già non scartabile ed è già riconosciuta dal validatore come sorgente di folla.

**Tech Stack:** Blender 5.1 headless + `voxelKit.py` per i quattro asset; Node.js, `node --test` + `node:assert/strict`; moduli UMD condivisi (`frontend/shared/*.js`); Three.js r128 lato client.

**Spec:** `docs/superpowers/specs/2026-09-03-f1-palazzo-box-design.md`

## Global Constraints

- **Italiano** nei commenti del codice e nei messaggi di commit.
- **Passo delle fette: 7.5 = `TrackGeometry.PIT_BOX_SPACING / 2`**, mai un numero scritto a mano e mai ricavato dividendo la lunghezza del tratto.
- **Il palazzo si estende sempre sui box a 20 piloti**, qualunque sia il `gridSize` della gara in corso.
- **Nessuna fetta si muove da sola**: lo scostamento è il massimo calcolato sul tratto, applicato a tutte, teste comprese. Nessuna rampa.
- **Massimo 6 materiali per asset** (`circuitAssets.test.js` lo impone).
- **Pivot alla base e modello centrato in XZ**; il fronte guarda **-Y Blender = +Z gioco**, come `pitBuildings`. Eccezione dichiarata: `pitClubSpan` ha il pivot alla base del **primo piano**, come già `pitRoofTerrace`/`pitRoofLounge`.
- **Niente marchi reali** sulle insegne.
- **Gate di approvazione asset**: i render dei quattro modelli vanno mostrati all'utente PRIMA di cablarli in gioco (Task 1, Step 8).
- **Niente `git add -A`**: aggiungere i file per nome. L'utente lavora in parallelo sulle sue piste — `frontend/tracks/nuova-pista.json` e i `backend/tools/*-raceline.json` non tracciati NON vanno committati.
- **Commit ad ogni task**, chiudendo con:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GFYtQvav3xd1b2n1bKsToc
  ```
- **Cache-busting**: ogni pagina che carica un modulo condiviso toccato vuole il bump del `?v=` a `20260903a`. Le pagine che caricano `trackScenery.js` sono quattro: `frontend/f1.html`, `frontend/track-editor.html`, `frontend/track-preview.html`, `frontend/f1-testbench.html`.
- **Baseline dei test, misurata oggi 2026-09-03 su questo disco** (non fidarsi, rimisurarla prima di cominciare):
  - `node --test frontend/shared/` → 1087 test, **5 rossi**: `produce un carosello con panoramica, traguardo e curva`; `tribune e reti restano parallele al muro (melbourne)`; `il decoro del paddock non finisce dentro nient'altro`; `quanto circuito resta senza niente di fianco (nuova-pista)`; `quanto circuito resta senza niente di fianco (suzuka)`.
  - `node --test backend/` → 893 test, **11 rossi + 2 skip**.
- ⚠️ **`prova` è congelata** sulla scenografia cotta in `frontend/tracks/scenografie/prova.json`: il palazzo non comparirà lì. Per il playtest usare `citta-prova`, `banking-prova` o `nuova-pista`.

## Struttura dei file

| File | Responsabilità |
|---|---|
| `backend/tools/circuitAssets/pitPalazzo.py` (nuovo) | I quattro pezzi del palazzo e le ancore della gente sulle balconate |
| `backend/tools/circuitAssets/__init__.py` | Registra i quattro `assetId` |
| `backend/tools/f1CircuitAssetsBuilder.py:71-82` | Unisce le ancore di `pitPalazzo` alle altre |
| `backend/tools/circuitAssets.test.js` | Target di ingombro dei quattro modelli |
| `frontend/shared/pitClubProfilo.js` (nuovo) | **L'unico** che sa dove sta il palazzo: tratto, fette, tipi, scostamento |
| `frontend/shared/pitClubProfilo.test.js` (nuovo) | Le invarianti del profilo, su ogni pista della cartella |
| `frontend/shared/sceneryAssetPaths.js` | Dove sta il `.glb` di ciascun pezzo |
| `frontend/shared/sceneryAssetSizes.js` | L'ingombro dichiarato dei quattro pezzi |
| `frontend/shared/trackScenery.js` | Posa le fette e ritrae gli edifici decorativi dal tratto del palazzo |
| `frontend/shared/sceneryPalazzoBox.test.js` (nuovo) | Le invarianti della posa, su ogni pista della cartella |
| `frontend/f1.html`, `track-editor.html`, `track-preview.html`, `f1-testbench.html` | Caricano il modulo nuovo, e bump del cache-busting |

---

### Task 1: I quattro pezzi del palazzo e le loro ancore

Gli asset e basta: nessuno li usa ancora. Si chiude col gate di approvazione dell'utente sui render.

**Files:**
- Create: `backend/tools/circuitAssets/pitPalazzo.py`
- Modify: `backend/tools/circuitAssets/__init__.py` — import e quattro righe in `ASSET_BUILDERS`
- Modify: `backend/tools/f1CircuitAssetsBuilder.py` — una riga di unione delle ancore
- Test: `backend/tools/circuitAssets.test.js` — quattro voci in `EXPECTED`

**Interfaces:**
- Produces: `frontend/assets/custom/circuit/pitClubBay.glb`, `pitClubSpan.glb`, `pitClubHead.glb`, `pitClubTower.glb`; e in `terraceAnchors.json` le chiavi `pitClubBay`, `pitClubSpan`, `pitClubTower`, ciascuna con una lista di `{x, y, z}` in coordinate GIOCO relative all'origine dell'asset.

- [ ] **Step 1: Scrivere il target di ingombro (il test che fallisce)**

In `backend/tools/circuitAssets.test.js`, dentro `EXPECTED`, subito dopo le due voci `pitRoof*`:

```js
    // Il palazzo dei box (spec 2026-09-03): quattro fette larghe 7.3 — mezzo
    // passo di box meno il gioco meccanico — profonde 22 come i box dei
    // piloti, così il fronte del palazzo e quello dei box coincidono.
    // pitClubSpan è il solo primo piano: si posa a quota 11, sopra le teste
    // dei garage, e il suo pivot sta alla base del PRIMO PIANO.
    pitClubBay:        { w: 7.3, h: 18.4, d: 22 },
    pitClubSpan:       { w: 7.3, h: 7.4,  d: 22 },
    pitClubHead:       { w: 7.3, h: 18.4, d: 22 },
    pitClubTower:      { w: 7.3, h: 20.4, d: 22 },
```

- [ ] **Step 2: Eseguire il test e vederlo fallire**

Run: `node --test backend/tools/circuitAssets.test.js`
Expected: FAIL — `pitClubBay: il .glb esiste ed è parsabile` (il file non c'è), e altrettanto per gli altri tre.

- [ ] **Step 3: Scrivere il builder**

Create `backend/tools/circuitAssets/pitPalazzo.py`:

```python
"""Il palazzo dei box: un edificio solo, costruito a fette (spec 2026-09-03).

Garage al piano terra, club dei VIP al primo piano. Il fronte guarda
-Y Blender = +Z gioco, come gli edifici della corsia.

⚠️ QUESTE NON SONO QUATTRO CASE: sono quattro FETTE dello stesso edificio,
accostate a passo 7.5. Quindi non hanno fine-corsa laterali — niente pilastro
d'angolo, niente cornice che chiuda i fianchi — tranne `pitClubHead`, che è
fatto apposta per stare a un capo. Un fianco disegnato su una fetta normale
comparirebbe venticinque volte in fila.

⚠️ LARGHEZZA 7.3 CONTRO UN PASSO DI 7.5. Il gioco meccanico è voluto: due
lastre piene che si compenetrano danno facce complanari, cioè z-fighting. La
stessa regola delle facciate della città (8.7 contro 9).

⚠️ `build_pit_club_span` è il SOLO primo piano, e il suo pivot sta alla base
del primo piano, non a terra: chi lo posa lo mette a quota SOLAIO. Sotto ci
va il box colorato del giocatore, che è alto 10 e non è scenografia.
"""
from voxelKit import EPS

# Passo delle fette: mezzo passo di box (TrackGeometry.PIT_BOX_SPACING = 15).
# Il modello è più stretto del passo, di proposito.
PASSO = 7.5
W = 7.3
D = 22.0
HALF_W = W / 2
HALF_D = D / 2
FRONT = -HALF_D             # verso la corsia box

SOLAIO_Z = 11.0             # i box dei piloti sono alti 10: ci passa sopra
SOLAIO_H = 0.7
PIANO_H = 6.0               # dal solaio al cornicione
PARAPETTO_H = 0.9
BALCONE_SPORGENZA = 1.6     # quanto la balconata esce oltre la facciata


def _piano_terra(kit):
    """Il garage: corpo pieno, serranda sul fronte, zoccolo. Manca del tutto
    su `pitClubSpan`, dove sotto c'è il box del giocatore."""
    kit.box('concrete', (W, D, SOLAIO_Z), (0, 0, SOLAIO_Z / 2))
    kit.box('concreteDark', (W + 0.3, D + 0.3, 0.5), (0, 0, 0.25))
    # Serranda incassata: affonda di EPS invece di appoggiare a filo.
    kit.box('steel', (W - 1.4, 0.4, 6.4), (0, FRONT - 0.15 + EPS, 3.4))
    for i in range(6):
        kit.box('steelDark', (W - 1.4, 0.15, 0.22),
                (0, FRONT - 0.32 + EPS, 0.9 + i * 1.05))
    # Architrave: chiude la serranda in alto invece di lasciarla finire sul muro.
    kit.box('steelDark', (W - 0.9, 0.3, 0.35), (0, FRONT - 0.2 + EPS, 6.85))


def _primo_piano(kit, z0):
    """La parte cara, uguale su tutte le fette: solaio a sbalzo, loggia
    vetrata arretrata, due pilastri sul filo, balconata e parapetto."""
    # Solaio a sbalzo: sporge oltre la facciata di BALCONE_SPORGENZA, ed è
    # quello che da fuori legge come una linea continua per tutto il palazzo.
    kit.box('white', (W, D + BALCONE_SPORGENZA, SOLAIO_H),
            (0, -BALCONE_SPORGENZA / 2, z0 + SOLAIO_H / 2))

    zp = z0 + SOLAIO_H
    # Vetrata ARRETRATA di 0.9 dal filo dei pilastri: in ombra, così la
    # facciata ha profondità invece di essere una lastra sola.
    kit.box('glass', (W - 0.6, 0.5, PIANO_H - 0.9), (0, FRONT + 0.9, zp + (PIANO_H - 0.9) / 2))
    # Il corpo dietro la vetrata (il salone vero).
    kit.box('white', (W, D - 2.2, PIANO_H), (0, 1.1, zp + PIANO_H / 2))
    # I due pilastri sul filo: scandiscono la facciata. Stanno a ±(HALF_W-0.35)
    # e sono larghi 0.7, quindi due fette vicine li affiancano a 0.5 l'uno
    # dall'altro: da fuori è un ritmo, non una coppia.
    for sx in (-1, 1):
        kit.box('white', (0.7, 0.7, PIANO_H),
                (sx * (HALF_W - 0.35), FRONT - 0.2, zp + PIANO_H / 2))
    # Balconata: piano di calpestio davanti alla vetrata, dove sta la gente.
    kit.box('concreteDark', (W, BALCONE_SPORGENZA + 0.6, 0.3),
            (0, FRONT - BALCONE_SPORGENZA / 2 + 0.1, zp + 0.15))
    # Parapetto pieno sul filo, con la banda dorata: è il segno «qui è la
    # parte cara», lo stesso della vipSuite e del salotto di pitClub.py.
    y_par = FRONT - BALCONE_SPORGENZA + 0.15
    kit.box('white', (W, 0.25, PARAPETTO_H), (0, y_par, zp + 0.3 + PARAPETTO_H / 2))
    kit.box('yellow', (W, 0.32, 0.22), (0, y_par, zp + 0.3 + PARAPETTO_H - 0.11))
    # Cornicione in cima: chiude il piano e copre il giunto fra due fette
    # quando la corsia curva.
    kit.box('white', (W + 0.35, D - 1.8, 0.5), (0, 1.0, zp + PIANO_H + 0.25))
    return zp + PIANO_H + 0.5


def build_pit_club_bay(kit):
    """La fetta normale: garage sotto, club sopra."""
    _piano_terra(kit)
    top = _primo_piano(kit, SOLAIO_Z)
    return W, top


def build_pit_club_span(kit):
    """Solo il primo piano: scavalca il box colorato di un giocatore.

    ⚠️ Pivot alla base del PRIMO PIANO (z = 0 qui è la quota SOLAIO_Z del
    palazzo). Sotto non c'è niente di scolpito: quel volume appartiene a
    pitBox.glb, che non è scenografia."""
    top = _primo_piano(kit, 0.0)
    return W, top


def build_pit_club_head(kit):
    """La fetta di capo: come la normale, ma col fianco chiuso e la scala
    esterna. Ne esiste una per estremità del palazzo.

    ⚠️ Il fianco sta su UN lato solo (+X): all'altro capo la stessa fetta si
    posa ruotata di 180°, e il fianco torna dalla parte giusta."""
    _piano_terra(kit)
    top = _primo_piano(kit, SOLAIO_Z)
    # Fianco pieno: chiude il palazzo invece di mostrarne la sezione.
    kit.box('concrete', (0.5, D, top - 0.4), ((HALF_W + 0.2), 0, (top - 0.4) / 2))
    # Scala esterna: cinque rampe che salgono al primo piano.
    for i in range(5):
        kit.box('concreteDark', (1.6, 1.2, 0.35),
                (HALF_W + 1.1, FRONT + 2.0 + i * 1.3, 2.0 + i * 1.9))
    kit.box('steel', (0.16, 0.16, 4.0), (HALF_W + 1.8, FRONT + 2.0, 6.0))
    return W + 2.4, top


def build_pit_club_tower(kit):
    """Il pezzo che rompe il ritmo: ingresso, vano ascensore che sale di due
    unità sopra il cornicione, insegna verticale. Una ogni 8-10 fette."""
    _piano_terra(kit)
    top = _primo_piano(kit, SOLAIO_Z)
    # Vano ascensore: sale sopra il cornicione, è il solo volume del palazzo
    # che lo fa.
    kit.box('concreteDark', (W - 1.2, 4.0, 2.0), (0, 1.0, top + 1.0))
    kit.box('yellow', (W - 1.6, 0.3, 0.5), (0, -1.0 + EPS, top + 1.5))
    # Insegna verticale sul fronte, dal parapetto in giù: si legge da lontano.
    kit.box('red', (0.8, 0.3, 4.5), (0, FRONT - BALCONE_SPORGENZA - 0.1, 6.5))
    return W, top + 2.0


# --- Dove sta la gente ----------------------------------------------------
# Stessa idea di pitClub.terrace_anchors(): le posizioni nascono dalla
# geometria del modello, così non possono divergerne. Coordinate GIOCO
# relative all'origine dell'asset — Blender (x, y, z) -> gioco (x, z, -y) —
# col pivot della figura ai piedi.
#
# ⚠️ Il fronte, che in Blender sta a -D/2, in gioco sta a +D/2: per questo i
# valori di z qui sotto sono positivi.
def _sulla_balconata(z_pavimento):
    """Due figure affacciate al parapetto, sfalsate rispetto ai pilastri: una
    figura piantata dentro un pilastro si vede, e i pilastri stanno a ±3.3."""
    z = HALF_D + BALCONE_SPORGENZA - 0.9
    return [
        {'x': -1.6, 'y': round(z_pavimento, 3), 'z': round(z, 3)},
        {'x': 1.6,  'y': round(z_pavimento, 3), 'z': round(z, 3)},
    ]


def terrace_anchors():
    z_bay = SOLAIO_Z + SOLAIO_H + 0.3      # calpestio della balconata
    z_span = SOLAIO_H + 0.3                # lo stesso, ma il pivot è più in alto
    return {
        'pitClubBay': _sulla_balconata(z_bay),
        'pitClubSpan': _sulla_balconata(z_span),
        'pitClubTower': _sulla_balconata(z_bay),
    }
```

- [ ] **Step 4: Registrare i quattro asset**

In `backend/tools/circuitAssets/__init__.py`, aggiungere `pitPalazzo` alla lista di import in testa (accanto a `pitClub`), e in `ASSET_BUILDERS`, subito dopo le due righe `pitRoof*`:

```python
    'pitClubBay':        pitPalazzo.build_pit_club_bay,
    'pitClubSpan':       pitPalazzo.build_pit_club_span,
    'pitClubHead':       pitPalazzo.build_pit_club_head,
    'pitClubTower':      pitPalazzo.build_pit_club_tower,
```

In `backend/tools/f1CircuitAssetsBuilder.py`, subito sotto `anchors.update(pitClub.terrace_anchors())`:

```python
anchors.update(pitPalazzo.terrace_anchors())
```

e aggiungere `pitPalazzo` all'import da `circuitAssets` in testa al file, dove già compare `pitClub`.

- [ ] **Step 5: Costruire gli asset**

Run:
```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/f1CircuitAssetsBuilder.py -- \
    --asset pitClubBay,pitClubSpan,pitClubHead,pitClubTower
```
Expected: quattro `.glb` in `frontend/assets/custom/circuit/`, quattro `.png` in `backend/tools/renders/circuit/`, e `terraceAnchors.json` riscritto con le tre chiavi nuove.

⚠️ `blender` non è nel PATH: il percorso completo è quello qui sopra, ed è lo stesso che usano `f1PaddockClubAnteprima.py` e `docs/f1-notes.md:223`.

- [ ] **Step 6: Eseguire i test e vederli passare**

Run: `node --test backend/tools/circuitAssets.test.js`
Expected: PASS per tutte e quattro le voci nuove. Se una misura reale sfora il ±20%, correggere il **target** solo se il modello è giusto e la stima era sbagliata; se invece è il modello a essere sbagliato, correggere quello.

- [ ] **Step 7: Verificare le ancore**

Run:
```bash
node -e "const a=require('./frontend/assets/custom/circuit/terraceAnchors.json').anchors; for(const k of ['pitClubBay','pitClubSpan','pitClubTower']) console.log(k, JSON.stringify(a[k]));"
```
Expected: tre liste da due ancore, con `z` positivo (verso la corsia) e `y` pari al calpestio della balconata — 12.0 per `pitClubBay` e `pitClubTower`, 1.0 per `pitClubSpan`.

- [ ] **Step 8: Gate utente sui render**

Mostrare all'utente i quattro `.png` in `backend/tools/renders/circuit/` e **fermarsi** finché non li approva. Se chiede modifiche, tornare allo Step 3.

⚠️ Il render di un pezzo da solo qui non basta, ed è esattamente il modo in cui la versione precedente è arrivata al playtest e ne è tornata indietro: una fetta isolata non dice niente sul **ritmo**, che è la cosa che l'utente ha bocciato. Va guardata la FILA.

Copiare `backend/tools/f1PaddockClubAnteprima.py` in `backend/tools/f1PalazzoBoxAnteprima.py` e cambiarvi tre cose: importare `pitPalazzo` invece di `pitClub`/`pitBuildings`; portare `PASSO` da 15.0 a 7.5; montare **dieci** fette nella sequenza vera — `Head, Bay, Span, Span, Bay, Tower, Bay, Span, Span, Head` — ruotando ciascuna di **1.2° in più della precedente**, che è la curvatura peggiore misurata (20° su 160 unità). Le due inquadrature (fila di tre quarti, e vista dalla corsia) restano quelle del file originale.

```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/f1PalazzoBoxAnteprima.py
```

Serve a vedere tre cose che i render singoli nascondono: il giunto in curva, il ritmo dei pilastri fra due fette vicine, e se il palazzo si legge come **un edificio solo**.

- [ ] **Step 9: Commit**

```bash
git add backend/tools/circuitAssets/pitPalazzo.py backend/tools/circuitAssets/__init__.py backend/tools/f1CircuitAssetsBuilder.py backend/tools/circuitAssets.test.js frontend/assets/custom/circuit/pitClubBay.glb frontend/assets/custom/circuit/pitClubSpan.glb frontend/assets/custom/circuit/pitClubHead.glb frontend/assets/custom/circuit/pitClubTower.glb frontend/assets/custom/circuit/terraceAnchors.json backend/tools/renders/circuit/pitClub*.png
git status   # controllare che i file dell'utente non siano finiti dentro
git commit
```
Messaggio: `Quattro fette di un edificio solo, non quattro edifici`.

---

### Task 2: Le due tabelle — dove sta il modello, quanto ingombra

Un asset senza ingombro dichiarato non solleva un errore: `sizeOf` restituisce il ripiego di 6x6x6, e da lì in poi la porta della scenografia giudica un palazzo come un cubo di sei unità — scarta cose che ci starebbero e ne accetta altre che si compenetrano, coi test tutti verdi. È già successo, con tredici asset.

**Files:**
- Modify: `frontend/shared/sceneryAssetPaths.js` — quattro righe in `PERCORSI`
- Modify: `frontend/shared/sceneryAssetSizes.js` — quattro righe in `SIZES`
- Test: `frontend/shared/sceneryPalazzoBox.test.js` (nuovo)

**Interfaces:**
- Consumes: i quattro `.glb` del Task 1.
- Produces: `SceneryAssetPaths.PERCORSI[assetId]` e `SceneryAssetSizes.sizeOf(assetId)` per i quattro pezzi.

- [ ] **Step 1: Scrivere il test che fallisce**

Create `frontend/shared/sceneryPalazzoBox.test.js`:

```js
// frontend/shared/sceneryPalazzoBox.test.js
//
// IL PALAZZO DEI BOX (spec 2026-09-03).
//
// Un pezzo del palazzo vive in quattro posti che non si conoscono fra loro: il
// builder in `backend/tools/circuitAssets/pitPalazzo.py`, il percorso in
// `sceneryAssetPaths.js`, l'ingombro in `sceneryAssetSizes.js` e la posa in
// `trackScenery.js`.
//
// ⚠️ E IL DISALLINEAMENTO E' SILENZIOSO: senza ingombro dichiarato `sizeOf`
// restituisce 6x6x6 e ogni controllo a valle diventa falso senza dirlo.
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
const PEZZI = ['pitClubBay', 'pitClubSpan', 'pitClubHead', 'pitClubTower'];

for (const asset of PEZZI) {
    test(`${asset}: ha un percorso e il file c'e'`, () => {
        assert.ok(Paths.PERCORSI[asset], `${asset} non e' in PERCORSI`);
        assert.ok(fs.existsSync(path.join(GLB_DIR, asset + '.glb')),
            `manca ${asset}.glb`);
    });

    test(`${asset}: l'ingombro dichiarato coincide col .glb`, () => {
        const dichiarato = Sizes.sizeOf(asset);
        // `size` e' un array [x, y, z] in coordinate gioco: w = X, h = Y, d = Z.
        const size = inspectGlb(path.join(GLB_DIR, asset + '.glb')).size;
        for (const [campo, vero] of [['w', size[0]], ['h', size[1]], ['d', size[2]]]) {
            assert.ok(Math.abs(dichiarato[campo] - vero) <= 0.05,
                `${asset}.${campo}: dichiarato ${dichiarato[campo]}, nel .glb ${vero.toFixed(3)}`);
        }
    });

    test(`${asset}: non e' largo quanto il passo`, () => {
        // Il gioco meccanico e' voluto: due lastre piene che si compenetrano
        // danno facce complanari, cioe' z-fighting.
        assert.ok(Sizes.sizeOf(asset).w < 7.5,
            `${asset} e' largo ${Sizes.sizeOf(asset).w}: al passo di 7.5 si compenetra col vicino`);
    });
}
```

- [ ] **Step 2: Eseguire il test e vederlo fallire**

Run: `node --test frontend/shared/sceneryPalazzoBox.test.js`
Expected: FAIL — `pitClubBay non e' in PERCORSI`.

- [ ] **Step 3: Riempire le due tabelle**

In `frontend/shared/sceneryAssetPaths.js`, dentro `PERCORSI`, subito dopo le due righe `pitRoof*`:

```js
        // Il palazzo dei box: quattro fette dello STESSO edificio (spec 2026-09-03).
        pitClubBay: '/assets/custom/circuit/pitClubBay.glb',
        pitClubSpan: '/assets/custom/circuit/pitClubSpan.glb',
        pitClubHead: '/assets/custom/circuit/pitClubHead.glb',
        pitClubTower: '/assets/custom/circuit/pitClubTower.glb',
```

In `frontend/shared/sceneryAssetSizes.js`, subito dopo le due righe `pitRoof*`, con le misure **lette dal .glb** (non ricopiate dal piano):

```js
        pitClubBay:        { w: 0, h: 0, d: 0 },   // <- riempire con inspectGlb
        pitClubSpan:       { w: 0, h: 0, d: 0 },
        pitClubHead:       { w: 0, h: 0, d: 0 },
        pitClubTower:      { w: 0, h: 0, d: 0 },
```

I valori si leggono così, e si copiano arrotondati a due decimali:
```bash
node -e "const{inspectGlb}=require('./backend/tools/glbInspect.js');for(const a of ['pitClubBay','pitClubSpan','pitClubHead','pitClubTower']){const s=inspectGlb('frontend/assets/custom/circuit/'+a+'.glb').size;console.log(a,'w',s[0].toFixed(2),'h',s[1].toFixed(2),'d',s[2].toFixed(2));}"
```

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test frontend/shared/sceneryPalazzoBox.test.js`
Expected: PASS, 12 test.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/sceneryAssetPaths.js frontend/shared/sceneryAssetSizes.js frontend/shared/sceneryPalazzoBox.test.js
git commit
```
Messaggio: `Le quattro fette entrano nelle tabelle: percorso e ingombro vero`.

---

### Task 3: `pitClubProfilo` — l'unico che sa dove sta il palazzo

Un modulo puro, senza Three.js e senza DOM, sul modello di `CittaProfilo`. Nessuno lo usa ancora: si costruisce e si prova in isolamento.

**Files:**
- Create: `frontend/shared/pitClubProfilo.js`
- Create: `frontend/shared/pitClubProfilo.test.js`

**Interfaces:**
- Consumes: `TrackGeometry.PIT_BOX_SPACING` (15), `TrackGeometry.pitSlotAt(pitPath, boxIndex, offset, trackPoints, pitRoadHalf)` → `{x, z, tx, tz, fromIdx}`, `TrackGeometry.nearestPoint(points, x, z)` → `{x, y, z, index, dist}`.
- Produces:
  ```js
  PitClubProfilo.PASSO          // 7.5
  PitClubProfilo.GRID_PIENA     // 20
  PitClubProfilo.OFFSET_FRONTE  // 23 — dal bordo corsia al CENTRO della fetta
  // fette(pitPath, boxIndex, trackPts, pitRoadHalf) -> [
  //   { offset, tipo, x, y, z, rotY }
  // ] con tipo in 'pitClubHead' | 'pitClubSpan' | 'pitClubTower' | 'pitClubBay'
  // — cioe' l'assetId vero e proprio, non un'etichetta da tradurre altrove.
  // dentroIlPalazzo(offset) -> bool, per chi deve sapere se una posizione
  // della corsia e' gia' occupata dal palazzo.
  ```

- [ ] **Step 1: Scrivere i test che falliscono**

Create `frontend/shared/pitClubProfilo.test.js`:

```js
// frontend/shared/pitClubProfilo.test.js
//
// IL PROFILO DEL PALAZZO DEI BOX (spec 2026-09-03).
//
// Qui si prova il modulo da solo, senza scenografia intorno: se una di queste
// invarianti cade, il palazzo e' sbagliato prima ancora di essere posato.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Profilo = require('./pitClubProfilo.js');
const TG = require('./trackGeometry.js');
const { loadTrack } = require('../../backend/sockets/games/trackLoader.js');

const PISTE = fs.readdirSync(path.join(__dirname, '..', 'tracks'))
    .filter(f => f.endsWith('.json') && !/^(__|test-)/.test(f))
    .map(f => f.replace(/\.json$/, ''));

// ⚠️ I campi giusti di loadTrack sono `pitBoxIndex` e `pitRoadHalf`, piatti:
// NON `t.pit.boxIndex`. Un `undefined` passato a pitSlotAt non solleva, cammina
// dall'inizio della corsia e restituisce fette plausibili nel posto sbagliato.
const cache = new Map();
function fetteDi(id) {
    if (!cache.has(id)) {
        const raw = JSON.parse(fs.readFileSync(
            path.join(__dirname, '..', 'tracks', id + '.json'), 'utf8'));
        const t = loadTrack(id);
        assert.equal(typeof t.pitBoxIndex, 'number', `${id}: loadTrack non da' pitBoxIndex`);
        cache.set(id, {
            fette: Profilo.fette(t.pitLanePts, t.pitBoxIndex, t.points, t.pitRoadHalf),
            t, raw,
        });
    }
    return cache.get(id);
}

for (const id of PISTE) {
    test(`${id}: il passo fra due fette e' sempre 7.5`, () => {
        const { fette } = fetteDi(id);
        assert.ok(fette.length >= 8, `${id}: solo ${fette.length} fette`);
        for (let k = 1; k < fette.length; k++) {
            assert.equal(fette[k].offset - fette[k - 1].offset, Profilo.PASSO,
                `${id}: fra la fetta ${k - 1} e la ${k} il passo non e' 7.5`);
        }
    });

    test(`${id}: le teste stanno ai due capi, e sono due`, () => {
        const { fette } = fetteDi(id);
        const teste = fette.filter(f => f.tipo === 'pitClubHead');
        assert.equal(teste.length, 2, `${id}: ${teste.length} teste invece di 2`);
        assert.equal(fette[0].tipo, 'pitClubHead');
        assert.equal(fette[fette.length - 1].tipo, 'pitClubHead');
    });

    test(`${id}: ogni box dei giocatori sta sotto uno Span`, () => {
        const { fette, t } = fetteDi(id);
        for (const grid of [6, 20]) {
            const ancore = TG.pitBoxAnchors(t.pitLanePts, t.pitBoxIndex, grid,
                                            t.points, t.pitRoadHalf);
            for (const a of ancore) {
                const sopra = fette.filter(f => f.tipo === 'pitClubSpan')
                    .filter(f => Math.hypot(f.x - a.x, f.z - a.z) < 40);
                assert.ok(sopra.length > 0,
                    `${id} con ${grid} piloti: un box a (${a.x.toFixed(1)}, ${a.z.toFixed(1)}) non ha nessuno Span vicino`);
            }
        }
    });

    test(`${id}: nessun Bay sopra un box, che sarebbe un garage dentro un garage`, () => {
        const { fette, t } = fetteDi(id);
        const ancore = TG.pitBoxAnchors(t.pitLanePts, t.pitBoxIndex, Profilo.GRID_PIENA,
                                        t.points, t.pitRoadHalf);
        // Un box e' largo 14.1 e una fetta 7.3: una fetta col piano terra pieno
        // il cui centro cade a meno di mezzo passo di box da un'ancora si
        // compenetra col garage colorato del giocatore.
        const colpevoli = fette
            .filter(f => f.tipo === 'pitClubBay' || f.tipo === 'pitClubTower' || f.tipo === 'pitClubHead')
            .filter(f => ancore.some(a => Math.hypot(f.x - a.x, f.z - a.z) < 7))
            .map(f => `${f.tipo} a offset ${f.offset}`);
        assert.deepEqual(colpevoli, []);
    });

    test(`${id}: nessuna fetta dentro la corsia box`, () => {
        const { fette, t } = fetteDi(id);
        const half = t.pitRoadHalf;
        for (const f of fette) {
            const d = TG.nearestPoint(t.pitLanePts, f.x, f.z).dist;
            // Il centro della fetta sta a OFFSET_FRONTE dal bordo: meta'
            // profondita' (11) piu' il franco. Qui basta il centro, gli
            // angoli li prova sceneryPalazzoBox.test.js con l'ingombro vero.
            assert.ok(d >= half + 11,
                `${id}: una fetta ha il centro a ${d.toFixed(1)} dalla corsia (serve ${(half + 11).toFixed(1)})`);
        }
    });

    test(`${id}: nessun gradino fra due fette vicine`, () => {
        const { fette, t } = fetteDi(id);
        const half = t.pitRoadHalf;
        const dist = fette.map(f => TG.nearestPoint(t.pitLanePts, f.x, f.z).dist - half);
        for (let k = 1; k < dist.length; k++) {
            assert.ok(Math.abs(dist[k] - dist[k - 1]) <= 0.6,
                `${id}: fra la fetta ${k - 1} e la ${k} la distanza dal nastro salta di ${(dist[k] - dist[k - 1]).toFixed(2)}`);
        }
    });

    test(`${id}: due torri non stanno mai vicine`, () => {
        const { fette } = fetteDi(id);
        const idx = fette.map((f, i) => [f, i]).filter(([f]) => f.tipo === 'pitClubTower').map(([, i]) => i);
        for (let k = 1; k < idx.length; k++) {
            assert.ok(idx[k] - idx[k - 1] >= 8,
                `${id}: due torri a ${idx[k] - idx[k - 1]} fette di distanza`);
        }
    });
}
```

⚠️ La tolleranza di 0.6 sul gradino non contraddice le 0.05 della spec: qui si misura la distanza dal **campione più vicino della corsia**, che è discreta e salta di suo fra un campione e l'altro. Le 0.05 valgono per lo scostamento applicato, che è lo stesso numero per tutte le fette per costruzione — e quello lo garantisce il codice, non un test di misura.

- [ ] **Step 2: Eseguire i test e vederli fallire**

Run: `node --test frontend/shared/pitClubProfilo.test.js`
Expected: FAIL — `Cannot find module './pitClubProfilo.js'`.

- [ ] **Step 3: Scrivere il modulo**

Create `frontend/shared/pitClubProfilo.js`:

```js
// frontend/shared/pitClubProfilo.js
//
// DOVE STA IL PALAZZO DEI BOX, e nient'altro (spec 2026-09-03).
//
// È l'unico modulo che sa dove il palazzo comincia, dove finisce e com'è fatta
// ciascuna delle sue fette. Chi lo posa (trackScenery.js) e chi lo controlla
// (i test) chiedono a lui: due conti separati farebbero finire una testa in
// mezzo alla facciata, ed è esattamente l'errore già visto sulle facciate
// della città.
//
// Modulo PURO: niente Three.js, niente DOM.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./trackGeometry.js'));
    else root.PitClubProfilo = factory(root.TrackGeometry);
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry) {

    // ⚠️ IL PASSO NON SI ADATTA, SI ADATTA LA LUNGHEZZA. Mezzo passo di box:
    // così il confine di ogni box cade su un confine di fetta, e nessun box si
    // trova mezzo dentro e mezzo fuori dal proprio vano. Ricavarlo dividendo la
    // lunghezza del tratto darebbe 7.4 su una pista e 7.6 su un'altra, mentre i
    // box stanno a 15 fissi ovunque.
    const PASSO = TrackGeometry.PIT_BOX_SPACING / 2;

    // Il palazzo copre SEMPRE i box di una griglia piena, non quelli della gara
    // in corso: gridSize arriva dalla lobby e cambia da una partita all'altra,
    // e un palazzo che si accorcia coi piloti cambierebbe pista fra una gara e
    // l'altra — con la scenografia cotta che non varrebbe più per entrambe.
    const GRID_PIENA = 20;

    // Due fette di margine per capo, che sono anche le due teste.
    const MARGINE_FETTE = 2;

    // Dal bordo della corsia al CENTRO della fetta. È la stessa misura dei box
    // dei piloti (PIT_BOX_FRONT_HALF_DEPTH 11 + PIT_BOX_CLEARANCE 12 in
    // pitBoxLoader.js): il palazzo è profondo 22 come loro, quindi così i due
    // fronti coincidono invece di sfalsarsi di qualche unità.
    const OFFSET_FRONTE = 23;

    // Quanto deve restare fra l'ingombro del palazzo e il bordo della corsia.
    const FRANCO_CORSIA = 2;
    const MEZZA_PROFONDITA = 11;

    // Una torre ogni TORRE_PASSO fette, mai a ridosso di una testa.
    const TORRE_PASSO = 9;

    // Quanto dista un'ascissa dal centro di un box: le fette che coprono un box
    // sono le due che gli stanno a meno di mezzo passo di box.
    const MEZZO_BOX = TrackGeometry.PIT_BOX_SPACING / 2;

    // Le ascisse dei box a griglia piena, rispetto a boxIndex. Stessa formula di
    // TrackGeometry.pitBoxAnchors — Math.floor e non (count-1)/2 — perché le due
    // devono cadere sulle stesse posizioni: se divergessero, un box finirebbe
    // sotto una fetta col garage invece che sotto uno Span.
    function offsetDeiBox() {
        const mid = Math.floor((GRID_PIENA - 1) / 2);
        const out = [];
        for (let i = 0; i < GRID_PIENA; i++) out.push((i - mid) * TrackGeometry.PIT_BOX_SPACING);
        return out;
    }

    // Quanta corsia c'è prima e dopo boxIndex. Serve a non far uscire il
    // palazzo dalla corsia: pitSlotAt satura ai capi, e le fette oltre il capo
    // si accatasterebbero tutte sullo stesso punto.
    function corsiaDisponibile(pitPath, boxIndex) {
        let prima = 0, dopo = 0;
        for (let i = 1; i <= boxIndex && i < pitPath.length; i++) {
            prima += Math.hypot(pitPath[i].x - pitPath[i - 1].x, pitPath[i].z - pitPath[i - 1].z);
        }
        for (let i = boxIndex + 1; i < pitPath.length; i++) {
            dopo += Math.hypot(pitPath[i].x - pitPath[i - 1].x, pitPath[i].z - pitPath[i - 1].z);
        }
        return { prima, dopo };
    }

    // Il punto sul nastro del palazzo che corrisponde a un'ascissa della corsia,
    // e il punto di corsia che quella fetta deve guardare.
    function puntoFronte(pitPath, boxIndex, offset, trackPts, pitRoadHalf, scostamento) {
        const s = TrackGeometry.pitSlotAt(pitPath, boxIndex, offset, trackPts, pitRoadHalf);
        const nx = -s.tz, nz = s.tx;
        // Da che parte sta il paddock: quella che si ALLONTANA dalla pista.
        const distPlus = TrackGeometry.nearestPoint(trackPts, s.x + nx, s.z + nz).dist;
        const distMinus = TrackGeometry.nearestPoint(trackPts, s.x - nx, s.z - nz).dist;
        const lato = distPlus >= distMinus ? 1 : -1;
        const off = pitRoadHalf + OFFSET_FRONTE + scostamento;
        const p = pitPath[Math.min(s.fromIdx, pitPath.length - 1)];
        return {
            x: s.x + nx * off * lato,
            z: s.z + nz * off * lato,
            y: p.y || 0,
            verso: { x: s.x, z: s.z },
        };
    }

    // Le ascisse delle fette: multipli interi del passo, in fase con i box
    // (offset 0 = boxIndex), estese fino a coprire la griglia piena più il
    // margine, e comunque dentro la corsia disponibile.
    function ascisse(pitPath, boxIndex) {
        const box = offsetDeiBox();
        const { prima, dopo } = corsiaDisponibile(pitPath, boxIndex);
        // Il primo multiplo del passo che contiene i box, più il margine.
        const estremoIndietro = Math.ceil(Math.abs(Math.min(...box)) / PASSO) + MARGINE_FETTE;
        const estremoAvanti = Math.ceil(Math.max(...box) / PASSO) + MARGINE_FETTE;
        // Ma senza uscire dalla corsia: oltre il capo pitSlotAt satura e le
        // fette si accatastano tutte nello stesso punto.
        const limiteIndietro = Math.floor(Math.max(0, prima - PASSO) / PASSO);
        const limiteAvanti = Math.floor(Math.max(0, dopo - PASSO) / PASSO);
        const k0 = -Math.min(estremoIndietro, limiteIndietro);
        const k1 = Math.min(estremoAvanti, limiteAvanti);
        const out = [];
        for (let k = k0; k <= k1; k++) out.push(k * PASSO);
        return out;
    }

    // Quanto va scostato il palazzo perché nessuna fetta entri nella corsia.
    // ⚠️ UN VALORE SOLO PER TUTTE. Gli edifici decorativi si scostano ognuno per
    // conto proprio (PIT_BUILDING_LANE_PUSH_MAX): in una fila di volumi staccati
    // non si vede, in un muro continuo aprirebbe un gradino in mezzo alla
    // facciata. Qui si prende il massimo e lo si dà a tutti, teste comprese.
    function scostamentoComune(pitPath, boxIndex, offsets, trackPts, pitRoadHalf) {
        let massimo = 0;
        for (const offset of offsets) {
            for (let extra = 0; extra <= 40; extra += 1) {
                const q = puntoFronte(pitPath, boxIndex, offset, trackPts, pitRoadHalf, extra);
                // Il punto più critico è lo spigolo anteriore, non il centro:
                // qui basta il fronte, perché la fetta è larga 7.3 e profonda
                // 22, e in curva è il fronte a girarsi verso la corsia.
                const d = TrackGeometry.nearestPoint(pitPath, q.x, q.z).dist;
                if (d >= pitRoadHalf + MEZZA_PROFONDITA + FRANCO_CORSIA) {
                    if (extra > massimo) massimo = extra;
                    break;
                }
            }
        }
        return massimo;
    }

    function tipoDi(k, ultimo, offset, offsetBox) {
        if (k === 0 || k === ultimo) return 'pitClubHead';
        // Sotto c'è un box: la fetta è il solo primo piano.
        if (offsetBox.some(b => Math.abs(offset - b) < MEZZO_BOX)) return 'pitClubSpan';
        // Una torre ogni TORRE_PASSO, mai a ridosso di una testa.
        if (k % TORRE_PASSO === 0 && k > 1 && k < ultimo - 1) return 'pitClubTower';
        return 'pitClubBay';
    }

    // Le fette del palazzo, in ordine lungo la corsia.
    function fette(pitPath, boxIndex, trackPts, pitRoadHalf) {
        if (!pitPath || pitPath.length < 2) return [];
        const offsets = ascisse(pitPath, boxIndex);
        if (offsets.length < 4) return [];
        const scostamento = scostamentoComune(pitPath, boxIndex, offsets, trackPts, pitRoadHalf);
        const offsetBox = offsetDeiBox();
        const punti = offsets.map(o => puntoFronte(pitPath, boxIndex, o, trackPts, pitRoadHalf, scostamento));

        // Orientamento perpendicolare al NASTRO, non diretto al punto di corsia:
        // le due direzioni coincidono in rettilineo e divergono in curva, perché
        // il nastro corre 23 unità più in fuori e ha quindi un raggio diverso.
        // Puntando al punto di corsia le fette si aprirebbero a ventaglio, e fra
        // l'una e l'altra resterebbe uno spicchio di vuoto — lo stesso difetto
        // già visto e corretto sugli edifici decorativi.
        function orientamento(k) {
            const a = punti[Math.max(0, k - 1)];
            const b = punti[Math.min(punti.length - 1, k + 1)];
            let tx = b.x - a.x, tz = b.z - a.z;
            const len = Math.hypot(tx, tz);
            const q = punti[k];
            if (len < 1e-9) return Math.atan2(q.verso.x - q.x, q.verso.z - q.z);
            tx /= len; tz /= len;
            let fx = -tz, fz = tx;
            if ((q.verso.x - q.x) * fx + (q.verso.z - q.z) * fz < 0) { fx = -fx; fz = -fz; }
            return Math.atan2(fx, fz);
        }

        const ultimo = offsets.length - 1;

        // ⚠️ QUALE TESTA GIRARE NON È «L'ULTIMA». Il fianco chiuso sta su +X
        // del modello, e quale delle due estremità quel +X guardi dipende dal
        // verso in cui la corsia corre su questa pista: su una fila girata
        // dall'altra parte, «giro l'ultima» chiude il capo sbagliato e lascia
        // l'altro con la sezione a vista. È successo davvero sul primo render
        // dell'anteprima, e l'ha visto l'utente («l'estremità di sinistra
        // sembra tagliata»).
        //
        // La regola giusta si misura invece di indovinarla: il fianco deve
        // guardare DALLA PARTE OPPOSTA al vicino. In Three una rotazione rotY
        // attorno a Y manda +X locale su (cos rotY, -sin rotY).
        function fiancoVersoIlVicino(k, rotY) {
            const vicino = punti[k === 0 ? 1 : k - 1];
            const vx = vicino.x - punti[k].x, vz = vicino.z - punti[k].z;
            return Math.cos(rotY) * vx - Math.sin(rotY) * vz > 0;
        }

        return offsets.map((offset, k) => {
            const rotY = orientamento(k);
            const testa = k === 0 || k === ultimo;
            return {
                offset,
                tipo: tipoDi(k, ultimo, offset, offsetBox),
                x: punti[k].x,
                y: punti[k].y,
                z: punti[k].z,
                rotY: rotY + (testa && fiancoVersoIlVicino(k, rotY) ? Math.PI : 0),
            };
        });
    }

    // Un'ascissa della corsia è già occupata dal palazzo? Serve a chi posa gli
    // edifici decorativi, che dentro il tratto non devono nascere affatto.
    function dentroIlPalazzo(offsets, offset) {
        if (!offsets.length) return false;
        return offset >= offsets[0] - PASSO && offset <= offsets[offsets.length - 1] + PASSO;
    }

    return { PASSO, GRID_PIENA, MARGINE_FETTE, OFFSET_FRONTE, TORRE_PASSO,
             fette, ascisse, dentroIlPalazzo };
});
```

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test frontend/shared/pitClubProfilo.test.js`
Expected: PASS su tutte le piste.

⚠️ Se cade `nessuna fetta dentro la corsia box`, il difetto sta in `scostamentoComune`: probabilmente il ciclo esce al primo `extra` che va bene per QUELLA fetta invece di cercare il massimo su tutte. Non alzare la tolleranza del test: è l'invariante 1 della spec.

⚠️ Se cade `ogni box dei giocatori sta sotto uno Span`, controllare che `offsetDeiBox` usi lo stesso `Math.floor((count - 1) / 2)` di `TrackGeometry.pitBoxAnchors`. Una formula ricopiata a metà mette i box mezzo passo più in là e nessuno se ne accorge finché non si guarda in pista.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/pitClubProfilo.js frontend/shared/pitClubProfilo.test.js
git commit
```
Messaggio: `Un modulo solo sa dove comincia e dove finisce il palazzo`.

---

### Task 4: La posa — il palazzo entra in pista e la fila si ritrae

**Files:**
- Modify: `frontend/shared/trackScenery.js` — dipendenza UMD, la posa dentro `buildPaddockLayout`, l'esclusione degli edifici decorativi dal tratto
- Modify: `frontend/shared/sceneryPalazzoBox.test.js` — le invarianti della posa
- Modify: `frontend/f1.html`, `frontend/track-editor.html`, `frontend/track-preview.html`, `frontend/f1-testbench.html` — caricamento del modulo e cache-busting

**Interfaces:**
- Consumes: `PitClubProfilo.fette(...)` e `PitClubProfilo.dentroIlPalazzo(...)` dal Task 3; `SceneryAssetSizes.sizeOf` dal Task 2.
- Produces: voci di layout `{ asset, category: 'paddock-club', x, y, z, rotY, scale: CUSTOM_MODEL_SCALE, natoSullaCorsia: true }`.

- [ ] **Step 1: Scrivere i test che falliscono**

In coda a `frontend/shared/sceneryPalazzoBox.test.js`, aggiungere:

```js
// --- La posa, su ogni pista della cartella --------------------------------
const TrackScenery = require('./trackScenery.js');
const TG = require('./trackGeometry.js');
const { loadTrack } = require('../../backend/sockets/games/trackLoader.js');
const Profilo = require('./pitClubProfilo.js');
const seats = require('../assets/custom/circuit/grandStandSeats.json').seats;
const terraceAnchors = require('../assets/custom/circuit/terraceAnchors.json').anchors;

const PISTE = fs.readdirSync(path.join(__dirname, '..', 'tracks'))
    .filter(f => f.endsWith('.json') && !/^(__|test-)/.test(f))
    .map(f => f.replace(/\.json$/, ''));

// Una pista si genera una volta sola: sono migliaia di oggetti per pista.
const cachePista = new Map();
function scenografiaDi(id, gridSize) {
    const chiave = id + ':' + gridSize;
    if (!cachePista.has(chiave)) {
        const raw = JSON.parse(fs.readFileSync(
            path.join(__dirname, '..', 'tracks', id + '.json'), 'utf8'));
        const t = loadTrack(id);
        cachePista.set(chiave, {
            layout: TrackScenery.generateLayout(raw, t.points, t.pitLanePts,
                raw.roadHalfWidth + 2.8 + 1.2, 45, seats, t.barrierProfile,
                terraceAnchors, { gridSize }),
            t, raw,
        });
    }
    return cachePista.get(chiave);
}

const DEL_PALAZZO = new Set(PEZZI);

for (const id of PISTE) {
    test(`${id}: il palazzo c'e', ed e' tutto di categoria paddock-club`, () => {
        const { layout } = scenografiaDi(id, 6);
        const palazzo = layout.filter(v => DEL_PALAZZO.has(v.asset));
        assert.ok(palazzo.length >= 8, `${id}: solo ${palazzo.length} fette in pista`);
        for (const v of palazzo) {
            assert.equal(v.category, 'paddock-club',
                `${id}: ${v.asset} ha categoria ${v.category}`);
            assert.equal(v.natoSullaCorsia, true,
                `${id}: ${v.asset} verrebbe traslato come se fosse nato sulla pista`);
        }
    });

    test(`${id}: nessuna fetta invade la corsia box, angoli compresi`, () => {
        const { layout, t } = scenografiaDi(id, 6);
        const half = t.pitRoadHalf;
        const dentro = [];
        for (const v of layout.filter(x => DEL_PALAZZO.has(x.asset))) {
            const vicino = Math.min(...Sizes.footprintCorners(v)
                .map(c => TG.nearestPoint(t.pitLanePts, c.x, c.z).dist));
            if (vicino < half + 1) dentro.push(`${v.asset} a ${vicino.toFixed(2)}`);
        }
        assert.deepEqual(dentro, []);
    });

    test(`${id}: nessun buco fra due fette consecutive`, () => {
        const { layout } = scenografiaDi(id, 6);
        const palazzo = layout.filter(v => DEL_PALAZZO.has(v.asset));
        // In ordine lungo il palazzo: si ordinano per vicinanza a catena
        // partendo da una testa, perche' il layout non conserva l'ordine.
        const resto = palazzo.slice();
        let corrente = resto.find(v => v.asset === 'pitClubHead');
        resto.splice(resto.indexOf(corrente), 1);
        const salti = [];
        while (resto.length) {
            let migliore = 0, minima = Infinity;
            for (let i = 0; i < resto.length; i++) {
                const d = Math.hypot(resto[i].x - corrente.x, resto[i].z - corrente.z);
                if (d < minima) { minima = d; migliore = i; }
            }
            if (minima > Profilo.PASSO + 0.5) salti.push(minima.toFixed(2));
            corrente = resto.splice(migliore, 1)[0];
        }
        assert.deepEqual(salti, [], `${id}: buchi nel fronte del palazzo`);
    });

    test(`${id}: dentro il palazzo non nasce nessun edificio decorativo`, () => {
        const { layout } = scenografiaDi(id, 6);
        const palazzo = layout.filter(v => DEL_PALAZZO.has(v.asset));
        const intrusi = layout
            .filter(v => v.asset === 'pitsGarageClosed' || v.asset === 'pitsOffice')
            .filter(v => palazzo.some(f => Math.hypot(f.x - v.x, f.z - v.z) < 12));
        assert.deepEqual(intrusi.map(v => `${v.asset} a (${v.x.toFixed(1)}, ${v.z.toFixed(1)})`), []);
    });

    test(`${id}: fuori dal palazzo la fila di edifici c'e' ancora`, () => {
        const { layout, t } = scenografiaDi(id, 6);
        // Solo dove la corsia e' abbastanza lunga da avere un fuori: sotto le
        // 300 unita' il palazzo la occupa quasi tutta, ed e' giusto cosi'.
        let lung = 0;
        for (let i = 1; i < t.pitLanePts.length; i++) {
            lung += Math.hypot(t.pitLanePts[i].x - t.pitLanePts[i - 1].x,
                               t.pitLanePts[i].z - t.pitLanePts[i - 1].z);
        }
        if (lung < 300) return;
        const edifici = layout.filter(v => v.asset === 'pitsGarageClosed' || v.asset === 'pitsOffice');
        assert.ok(edifici.length > 0,
            `${id}: corsia lunga ${lung.toFixed(0)}u e nemmeno un edificio fuori dal palazzo`);
        // E i loro tetti sono ancora al loro posto: il lavoro del 02-09 vale
        // per loro, ed e' li' che finisce.
        const tetti = layout.filter(v => v.asset === 'pitRoofTerrace' || v.asset === 'pitRoofLounge');
        assert.equal(tetti.length, edifici.length,
            `${id}: ${edifici.length} edifici fuori dal palazzo ma ${tetti.length} tetti`);
    });

    test(`${id}: sulle balconate c'e' gente`, () => {
        const { layout } = scenografiaDi(id, 6);
        const palazzo = layout.filter(v => DEL_PALAZZO.has(v.asset));
        const folla = layout.filter(v => v.category === 'crowd');
        const abitate = palazzo.filter(f => terraceAnchors[f.asset])
            .filter(f => folla.some(s => Math.hypot(s.x - f.x, s.z - f.z) < 14));
        const conAncore = palazzo.filter(f => terraceAnchors[f.asset]);
        assert.ok(abitate.length >= conAncore.length * 0.8,
            `${id}: solo ${abitate.length} balconate abitate su ${conAncore.length}`);
    });

    test(`${id}: il palazzo non e' piu' alto della fila di prima`, () => {
        const { layout } = scenografiaDi(id, 6);
        for (const v of layout.filter(x => DEL_PALAZZO.has(x.asset))) {
            const alto = Sizes.sizeOf(v.asset).h * (v.scale || 1);
            // pitClubSpan si posa a quota solaio: la sua cima e' 11 + la sua
            // altezza, e va confrontata con lo stesso limite degli altri.
            const cima = (v.asset === 'pitClubSpan' ? 11 : 0) + alto;
            const limite = v.asset === 'pitClubTower' ? 21.5 : 19.5;
            assert.ok(cima <= limite,
                `${v.asset} su ${id} arriva a ${cima.toFixed(1)} sopra il piede del palazzo`);
        }
    });
}
```

⚠️ `Sizes` è già richiesto in testa a questo file dalla prima metà (Task 2): riusare quel nome, non introdurre un secondo alias dello stesso modulo.

- [ ] **Step 2: Eseguire i test e vederli fallire**

Run: `node --test frontend/shared/sceneryPalazzoBox.test.js`
Expected: FAIL — `solo 0 fette in pista`.

- [ ] **Step 3: Dichiarare la dipendenza UMD**

In testa a `frontend/shared/trackScenery.js`, aggiungere `pitClubProfilo.js` fra i moduli richiesti, **in entrambi i rami** (Node e browser), accanto a `trackGeometry.js`:

```js
// ramo Node
require('./pitClubProfilo.js'),
// ramo browser
root.PitClubProfilo,
// e il parametro corrispondente nella factory
PitClubProfilo,
```

⚠️ I tre punti vanno tenuti **nello stesso ordine**: il ramo browser passa i valori per posizione. Un parametro aggiunto in fondo alla firma ma in mezzo alla lista del ramo Node fa arrivare il modulo sbagliato, e il sintomo è un `undefined` a runtime lontano da qui.

- [ ] **Step 4: Posare il palazzo**

In `frontend/shared/trackScenery.js`, dentro `buildPaddockLayout`, subito **dopo** il calcolo di `slot` e `riservate` e **prima** del ciclo `for (let k = 0; k < slot.length; k++)`:

```js
        // ── IL PALAZZO DEI BOX (spec 2026-09-03) ──
        //
        // Un edificio solo, a fette da 7.5, al posto della fila di edifici
        // alternati che nella zona dei box si leggeva come un pattern. Dove
        // comincia e dove finisce lo sa `PitClubProfilo`, e lo sa da solo: qui
        // si posa e basta.
        //
        // ⚠️ Nasce PRIMA di ogni altra categoria, e non solo perché è il pezzo
        // grosso: entra in `posati`, quindi tutto ciò che viene dopo lo VEDE e
        // sceglie un altro posto invece di finirci dentro e farsi scartare
        // dalla porta. È la prevenzione, distinta dalla garanzia.
        const fettePalazzo = PitClubProfilo.fette(boxCtx.pitPath, boxCtx.boxIndex,
                                                  trackPts, pitRoadHalf);
        for (const f of fettePalazzo) {
            const voce = {
                asset: f.tipo, category: 'paddock-club',
                x: f.x, y: f.y, z: f.z, rotY: f.rotY,
                scale: CUSTOM_MODEL_SCALE,
                // Nato misurando la CORSIA, non la pista: traslaOltreLaGhiaia
                // allontana dalla pista e della corsia non sa niente. Senza
                // questo, il palazzo verrebbe spinto dentro la corsia dove la
                // via di fuga è larga — lo stesso difetto già misurato sugli
                // edifici decorativi su melbourne.
                natoSullaCorsia: true,
            };
            layout.push(voce);
            posati.push(voce);
        }
        const ascissePalazzo = fettePalazzo.map(f => f.offset);
```

⚠️ `posati` e il ciclo degli edifici sono più in basso nella funzione: `posati` va dichiarato **prima** di questo blocco. Oggi la riga `const posati = [];` sta appena sopra il ciclo — spostarla sopra il blocco nuovo, senza cambiarla.

Poi, dentro il ciclo degli edifici decorativi, come primissima riga dopo `const s = slot[k];`:

```js
            // Dentro il tratto del palazzo gli edifici decorativi non nascono
            // affatto: là il fronte è il palazzo. Fuori restano quelli di
            // sempre, coi loro tetti — isolati non fanno più pattern.
            if (PitClubProfilo.dentroIlPalazzo(ascissePalazzo, s.offset)) continue;
```

- [ ] **Step 5: Eseguire i test e vederli passare**

Run: `node --test frontend/shared/sceneryPalazzoBox.test.js`
Expected: PASS.

Poi la suite della scenografia, per vedere che il resto non si sia mosso:
Run: `node --test frontend/shared/trackScenery.test.js frontend/shared/scenografiaInvarianti.test.js frontend/shared/sceneryPaddockClub.test.js`
Expected: gli stessi rossi della baseline, non uno di più. Se `sceneryPaddockClub.test.js` (i due tetti) diventa rosso perché su qualche pista non nasce più nessun edificio decorativo fuori dal palazzo, **non cancellare quel test**: rilassarne la portata a «se ci sono edifici fuori dal palazzo, hanno il loro tetto», che è quello che la spec dice davvero.

- [ ] **Step 6: Caricare il modulo nelle pagine**

In `frontend/f1.html`, `frontend/track-editor.html`, `frontend/track-preview.html` e `frontend/f1-testbench.html`, aggiungere **prima** della riga di `trackScenery.js`:

```html
    <script src="shared/pitClubProfilo.js?v=20260903a"></script>
```

e portare a `?v=20260903a` il cache-busting di `shared/trackScenery.js` nelle stesse quattro pagine.

Run: `node --test frontend/shared/ordineScript.test.js`
Expected: PASS — è il test che accorgersene tocca a lui, non all'utente davanti a una barra di caricamento ferma.

- [ ] **Step 7: Commit**

```bash
git add frontend/shared/trackScenery.js frontend/shared/sceneryPalazzoBox.test.js frontend/f1.html frontend/track-editor.html frontend/track-preview.html frontend/f1-testbench.html
git status   # controllare che i file dell'utente non siano finiti dentro
git commit
```
Messaggio: `Nella zona dei box il fronte non e' piu' una fila: e' un palazzo`.

---

### Task 5: Il conto, la suite intera, il playtest

**Files:**
- Nessuna modifica prevista. Se le misure la impongono, si torna ai task precedenti.

- [ ] **Step 1: Contare gli oggetti persi dietro il palazzo**

La spec avverte che dietro la fila, nel tratto del palazzo, oggi stanno tribunette e cataste di gomme fra 10 e 20 unità dalla corsia, e che un palazzo profondo 22 le incrocia.

Run:
```bash
node -e "
const fs=require('fs'),p=require('path');
const TS=require('./frontend/shared/trackScenery.js');
const {loadTrack}=require('./backend/sockets/games/trackLoader.js');
const seats=require('./frontend/assets/custom/circuit/grandStandSeats.json').seats;
const anc=require('./frontend/assets/custom/circuit/terraceAnchors.json').anchors;
for(const id of ['melbourne','citta-prova','suzuka','shanghai','banking-prova','loop-prova','monte-rosso','new-monza']){
  const raw=JSON.parse(fs.readFileSync('frontend/tracks/'+id+'.json','utf8'));
  const t=loadTrack(id);
  const l=TS.generateLayout(raw,t.points,t.pitLanePts,raw.roadHalfWidth+2.8+1.2,45,seats,t.barrierProfile,anc,{gridSize:6});
  const conta={};
  for(const v of l) conta[v.category]=(conta[v.category]||0)+1;
  console.log(id, JSON.stringify(conta));
}"
```
Confrontare il conteggio per categoria con lo stesso comando eseguito su `git stash` (cioè prima delle modifiche). **Riportare all'utente quante tribune, quanti alberi e quante infrastrutture sono sparite per pista.** Se su qualche pista sparisce più del 15% di una categoria, dirlo prima di andare avanti: è una decisione dell'utente, non nostra.

- [ ] **Step 2: Suite completa**

Run: `node --test frontend/shared/` e `node --test backend/`
Expected: gli stessi rossi della baseline misurata all'inizio, non uno di più. Ogni rosso nuovo va spiegato o corretto — mai messo in conto alla baseline.

- [ ] **Step 3: Guardarlo**

Aprire `localhost:3000`, entrare in una gara su `citta-prova` (⚠️ **non** `prova`, che è congelata sulla cottura vecchia e non mostrerà niente) e guardare il fronte dei box dalla griglia di partenza e dalla corsia.

Cosa cercare, in quest'ordine:
1. il fronte si legge come **un edificio solo** o si vedono ancora le fette?
2. i giunti in curva: si aprono cunei visibili fra una fetta e l'altra?
3. i box colorati dei giocatori stanno **dentro** i vani, senza compenetrarsi col palazzo?
4. la gente sulle balconate è affacciata al parapetto o piantata nei pilastri?
5. le due teste chiudono il palazzo o restano tagliate a metà?

- [ ] **Step 4: Pannello F9, prima e dopo**

Con F9 leggere fps e draw call sulla stessa pista e dalla stessa inquadratura (griglia di partenza), prima e dopo le modifiche — `git stash` per il «prima». Riportare i due numeri all'utente. Il progetto è GPU-bound sui pixel: se gli fps calano di più di 3-4, il palazzo va guardato con l'A/B del pannello prima di accettarlo.

- [ ] **Step 5: Commit finale e resoconto**

Se i task precedenti hanno lasciato modifiche non committate, committarle. Poi riportare all'utente, in chat e in breve:
- quante fette per pista, e quante torri;
- fps e draw call prima/dopo;
- che cosa è sparito dietro il palazzo, per categoria;
- che cosa resta da decidere (Task 6).

---

### Task 6 (condizionale): ricuocere `prova`

**Solo se l'utente lo chiede.** `prova` è congelata sulla scenografia cotta e non mostrerà mai il palazzo finché la cottura resta quella.

- [ ] **Step 1: Ricuocere**

Run: `node backend/tools/f1-cuoci-scenografia.js prova --grid=6`

⚠️ La cottura NON sta accanto al `.json` della pista: sta in `frontend/tracks/scenografie/prova.json`.

- [ ] **Step 2: Verificare la differenza**

Confrontare il numero di oggetti per categoria prima e dopo, e riportarlo. Una cottura nuova cambia la pista che l'utente ha approvato: la differenza va **mostrata**, non riassunta con «fatto».

- [ ] **Step 3: Commit**

```bash
git add frontend/tracks/scenografie/prova.json
git commit
```
Messaggio: `prova ricotta: anche lei ha il suo palazzo`.
