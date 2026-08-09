# Asset voxel circuito F1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modellare 16 asset voxel custom per la scenografia del circuito F1 (7 sostituzioni dei Kenney ancora in uso + 9 nuovi elementi), esportati come `.glb` con render di anteprima per il gate di approvazione utente.

**Architettura:** Una libreria Python condivisa (`voxelKit.py`) fornisce le primitive di scultura (box/cilindro voxel, palette materiali, join per colore, export GLB, scena di preview con l'auto come riferimento di scala). Ogni asset è una funzione `build()` in un modulo tematico sotto `backend/tools/circuitAssets/`. Un runner CLI (`f1CircuitAssetsBuilder.py`) costruisce uno o tutti gli asset in Blender headless. La verifica tecnica è un parser GLB minimale in Node (`glbInspect.js`) + test `node:test` che controllano invarianti strutturali (pivot, orientamento, conteggio mesh, ingombro).

**Deviazione consapevole dalla spec:** la spec prevede il controllo dei `.glb` con "un `GLTFLoader` headless (stesso tipo di controllo già usato per altri asset custom del progetto)". Verificato il 2026-08-09: **quel controllo non esiste** — nessun `.test.js` del repo carica un GLB, e `three` non è installato (il repo non ha nemmeno `node_modules`, i test girano con `node --test` nativo). Le ispezioni dei `.glb` finora sono state fatte a mano con Blender headless (vedi i commenti misurati in `frontend/shared/pitBoxLoader.js`). Introdurre `three` come dipendenza solo per i test sarebbe sproporzionato: si usa invece un parser GLB di ~90 righe senza dipendenze, che dà lo stesso valore (file parsabile + invarianti geometrici) con un comando ripetibile e senza richiedere Blender per verificare.

**Tech Stack:** Blender 5.1 headless (`"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --python <script>`), Python `bpy`, Node.js `node:test` (nessuna dipendenza npm — il repo non ha `node_modules` né jest).

## Global Constraints

Valgono per **tutti** i task. Ogni task le eredita implicitamente.

- **Unità di modellazione = unità di gioco, scala 1:1.** I nuovi asset NON vanno scalati all'istanza (`scale: 1`), a differenza dei Kenney (`KENNEY_MODEL_SCALE = 6`) e dei custom esistenti (`3.5`). Riferimenti misurati con Blender headless sui `.glb` reali del progetto (2026-08-09), già convertiti in unità di gioco:
  | modello | largh (X) | prof (Z) | alt (Y) |
  |---|---|---|---|
  | auto `f1Car.glb` (×3.5) | 3.47 | 7.17 | 1.79 |
  | box giocatore `f1PitBox.glb` (×3.5) | 21.70 | 21.00 | 9.80 |
  | `grandStand` Kenney (×6) | 6.00 | 6.00 | 5.38 |
  | `billboard` Kenney (×6) | 6.00 | 2.86 | 6.00 |
  | `pitsGarageClosed` Kenney (×6) | 6.00 | 6.54 | 4.20 |
  | `treeLarge` Kenney (×6) | 2.14 | 2.47 | 9.04 |
  Fattore di conversione pratico: **1 unità di gioco ≈ 0.78 m** (auto F1 reale 5.6 m ↔ 7.17 unità). Quindi: persona ≈ 2.3 unità, piano di edificio ≈ 3.9 unità, gradone di tribuna ≈ 0.5 unità.
- **Sistema di coordinate.** Blender è Z-up, glTF/gioco è Y-up. L'esportatore mappa `(x, y, z)_blender → (x, z, -y)_gltf`. Quindi:
  - X Blender = X gioco (invariato)
  - **Z Blender = altezza in gioco**
  - **−Y Blender = +Z gioco**
  Verificato per misura diretta su `f1PitBox.glb` (fronte a `x=3.2` grezzo sia in Blender sia nella costante `PIT_BOX_FRONT_HALF_DEPTH` di `pitBoxLoader.js`).
- **Orientamento: il fronte dell'asset guarda +Z gioco, cioè −Y Blender.** È la convenzione del progetto: `frontend/shared/trackScenery.js` calcola `rotY = Math.atan2(p.x - x, p.z - z)` e `frontend/f1.js::loadScenery` la applica senza correzioni. `f1PitBox.glb` viola questa convenzione (fronte su +X) e per questo `pitBoxLoader.js` deve compensare con `- Math.PI/2`: **i nuovi asset non devono ripetere quell'errore.**
- **Pivot: base a Z=0 Blender (quota terreno) e centrato su X=0, Y=0.** `trackScenery.js` piazza gli oggetti a `y = terrainHeightAt(...)`: un pivot al centro del volume interrerebbe metà modello. Unica eccezione ammessa: gli oggetti figli del `podium` (vedi Task 3).
- **Niente Join→Separate.** Il caveat "Origin to Geometry" della spec nasce da quel pattern (usato per l'auto, dove i pezzi devono ruotare attorno al proprio centro). Qui i props sono statici: si fa `join` per colore e `bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)`, così la geometria resta in coordinate mondo e il nodo glTF ha trasformazione identità. Nessun `separate`, nessun pivot da correggere.
- **Massimo 6 materiali per asset.** `f1.js::loadScenery` crea **un `THREE.InstancedMesh` per ogni mesh** trovata nel GLB, e il GLTFLoader spezza una mesh in una primitiva per materiale: N materiali = N draw call per asset. I Kenney sostituiti stanno tra 3 e 5 materiali. Un asset deve esportare **una sola mesh per colore** (join per materiale).
- **Materiali flat color** (Principled BSDF, `Base Color`, `Roughness` 0.6–0.9, `Metallic` 0), non palette texture: la tecnica a texture serve solo dove serve ricolorare dinamicamente (livrea auto, box giocatore). `bpy.ops.object.shade_flat()` su ogni pezzo.
- **Output:** `frontend/assets/custom/circuit/<assetId>.glb` (cartella nuova) + render 3/4 in `backend/tools/renders/circuit/<assetId>.png`.
- **Fuori scope (non toccare):** `frontend/shared/trackScenery.js`, `frontend/f1.js`, `frontend/track-editor.js`, i JSON dei tracciati, i `.glb` Kenney ancora presenti. L'integrazione è un task successivo separato.
- **Commenti in italiano** (convenzione di progetto, `CLAUDE.md`).
- **Gate utente:** ogni gruppo di asset si considera finito solo dopo che l'utente ha approvato i render. Non si prosegue al gruppo successivo senza approvazione.

## Palette condivisa

Definita una sola volta in `voxelKit.py`, usata da tutti gli asset per coerenza visiva (chiavi = nomi materiale):

| chiave | hex | uso |
|---|---|---|
| `concrete` | `#C9C5BB` | cemento chiaro, strutture |
| `concreteDark` | `#8D8980` | ombre/basamenti in cemento |
| `steel` | `#6E7378` | montanti, travi, reti |
| `steelDark` | `#3A4045` | telai, dettagli scuri |
| `white` | `#F2F2EE` | pannelli, teli, righe |
| `red` | `#D6392F` | accenti, cordoli, estintori |
| `blue` | `#2F6FB5` | sedili, insegne |
| `yellow` | `#F2C233` | bandiere, accenti sicurezza |
| `green` | `#4C8C3F` | prato/dettagli |
| `black` | `#1E2124` | gomme, guarnizioni |
| `tarmac` | `#4A4E52` | pavimentazioni |
| `glass` | `#7FB6D9` | vetrate |

---

## File Structure

**Creati:**
- `backend/tools/voxelKit.py` — libreria di scultura condivisa: palette, `add_box`, `add_cyl`, `join_by_material`, `export_glb`, `setup_preview_scene`, `render_3q`, `add_scale_reference`. Nessuna conoscenza dei singoli asset.
- `backend/tools/circuitAssets/__init__.py` — registry `ASSET_BUILDERS: dict[str, callable]`, unico punto in cui il runner scopre gli asset.
- `backend/tools/circuitAssets/grandstands.py` — `grandStand`, `grandStandAwning`, `grandStandCovered`.
- `backend/tools/circuitAssets/billboards.py` — `billboard`, `billboardLow`.
- `backend/tools/circuitAssets/pitBuildings.py` — `pitsGarageClosed`, `pitsOffice`.
- `backend/tools/circuitAssets/raceStructures.py` — `raceControlTower`, `startGantry`, `podium`.
- `backend/tools/circuitAssets/safety.py` — `tyreStack`, `catchFence`, `marshalPost`.
- `backend/tools/circuitAssets/decor.py` — `pylon`, `flagPole`, `paddockTent`.
- `backend/tools/f1CircuitAssetsBuilder.py` — runner CLI Blender.
- `backend/tools/glbInspect.js` — parser GLB minimale in Node puro (header + chunk JSON + bbox da accessor `min`/`max` e trasformazioni dei nodi). Nessuna dipendenza.
- `backend/tools/glbInspect.test.js` — test del parser contro un `.glb` noto già in repo.
- `backend/tools/circuitAssets.test.js` — test degli invarianti sui 16 `.glb` prodotti.

**Modificati:** nessuno. Il lavoro è puramente additivo.

---

### Task 1: Infrastruttura (voxelKit + runner + inspector) e primo asset `grandStand`

Il modulo tribuna base è il pilota che valida tutta la pipeline: è l'asset più complesso del gruppo "sostituzioni dirette", è impilabile (vincolo geometrico stringente) ed è asimmetrico (permette di testare l'orientamento del fronte).

**Files:**
- Create: `backend/tools/voxelKit.py`
- Create: `backend/tools/circuitAssets/__init__.py`
- Create: `backend/tools/circuitAssets/grandstands.py` (solo `grandStand` in questo task)
- Create: `backend/tools/f1CircuitAssetsBuilder.py`
- Create: `backend/tools/glbInspect.js`
- Create: `backend/tools/glbInspect.test.js`
- Create: `backend/tools/circuitAssets.test.js`
- Output: `frontend/assets/custom/circuit/grandStand.glb`, `backend/tools/renders/circuit/grandStand.png`

**Interfaces:**
- Produces (usate da tutti i task successivi):
  - `voxelKit.PALETTE: dict[str, tuple[float, float, float]]` — colori lineari già convertiti da sRGB.
  - `voxelKit.VoxelKit(name: str)` — istanza per asset. Metodi:
    - `.box(mat: str, size: (sx, sy, sz), center: (cx, cy, cz)) -> bpy.types.Object` — cubo in coordinate Blender; `size` sono le dimensioni piene, `center` il centro del volume.
    - `.cyl(mat: str, radius: float, depth: float, center: (cx, cy, cz), axis: str = 'Z', verts: int = 12) -> bpy.types.Object` — cilindro voxel; `axis` ∈ `'X'|'Y'|'Z'`.
    - `.finish() -> list[bpy.types.Object]` — join per materiale + `transform_apply` completo + `shade_flat`; ritorna una mesh per materiale usato.
  - `voxelKit.export_glb(assetId: str, objects: list) -> str` — scrive `frontend/assets/custom/circuit/<assetId>.glb`, ritorna il path.
  - `voxelKit.render_3q(assetId: str, span: float, height: float, with_car: bool = True) -> str` — inquadratura 3/4 automatica calcolata da `span` (diagonale del footprint) e `height`; se `with_car` importa `f1Car.glb` scalato 3.5 accanto all'asset come riferimento di scala. Scrive `backend/tools/renders/circuit/<assetId>.png`.
  - `circuitAssets.ASSET_BUILDERS: dict[str, callable]` — `assetId -> build(kit) -> (span, height)`.
  - `glbInspect.js` esporta `inspectGlb(absPath) -> { meshCount, materialCount, primitiveCount, bounds: { min: [x,y,z], max: [x,y,z] }, nodeNames: string[] }` — **bounds in coordinate glTF/gioco** (Y = altezza).

- [ ] **Step 1: Scrivere il parser GLB `backend/tools/glbInspect.js`**

Parser binario minimale: header GLB (magic `glTF`, 12 byte) → chunk 0 (JSON). La bbox si ricava dai `min`/`max` obbligatori degli accessor `POSITION`, trasformati per la matrice mondo del nodo che li referenzia.

```js
// backend/tools/glbInspect.js
//
// Parser GLB minimale (nessuna dipendenza): serve solo a verificare gli
// asset esportati da Blender in test headless — non è un loader completo,
// non legge i buffer binari. La bounding box si ricava dai min/max degli
// accessor POSITION (obbligatori nello standard glTF per gli accessor
// referenziati da POSITION) trasformati per la matrice mondo del nodo.
const fs = require('fs');

function readGlbJson(absPath) {
    const buf = fs.readFileSync(absPath);
    if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${absPath}: magic GLB non valido`);
    const version = buf.readUInt32LE(4);
    if (version !== 2) throw new Error(`${absPath}: versione glTF ${version}, attesa 2`);
    const chunkLen = buf.readUInt32LE(12);
    const chunkType = buf.readUInt32LE(16);
    if (chunkType !== 0x4e4f534a) throw new Error(`${absPath}: primo chunk non è JSON`);
    return JSON.parse(buf.slice(20, 20 + chunkLen).toString('utf8'));
}

function mul(a, b) {
    const out = new Array(16).fill(0);
    for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++)
            for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return out;
}

function trs(node) {
    if (node.matrix) return node.matrix.slice();
    const [tx, ty, tz] = node.translation || [0, 0, 0];
    const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
    const [sx, sy, sz] = node.scale || [1, 1, 1];
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2;
    const yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;
    return [
        (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
        (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
        (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
        tx, ty, tz, 1,
    ];
}

function apply(m, p) {
    return [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
}

function inspectGlb(absPath) {
    const gltf = readGlbJson(absPath);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const nodeNames = [];
    let primitiveCount = 0;
    const meshesSeen = new Set();
    const materialsSeen = new Set();

    const scene = gltf.scenes[gltf.scene || 0];
    const stack = (scene.nodes || []).map(i => ({ idx: i, parent: null }));
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

    while (stack.length) {
        const { idx, parent } = stack.pop();
        const node = gltf.nodes[idx];
        const world = mul(parent || identity, trs(node));
        if (node.name) nodeNames.push(node.name);
        for (const child of node.children || []) stack.push({ idx: child, parent: world });
        if (node.mesh === undefined) continue;
        meshesSeen.add(node.mesh);
        for (const prim of gltf.meshes[node.mesh].primitives) {
            primitiveCount++;
            if (prim.material !== undefined) materialsSeen.add(prim.material);
            const acc = gltf.accessors[prim.attributes.POSITION];
            if (!acc.min || !acc.max) throw new Error(`${absPath}: accessor POSITION senza min/max`);
            for (let corner = 0; corner < 8; corner++) {
                const p = [
                    (corner & 1) ? acc.max[0] : acc.min[0],
                    (corner & 2) ? acc.max[1] : acc.min[1],
                    (corner & 4) ? acc.max[2] : acc.min[2],
                ];
                const w = apply(world, p);
                for (let i = 0; i < 3; i++) {
                    if (w[i] < min[i]) min[i] = w[i];
                    if (w[i] > max[i]) max[i] = w[i];
                }
            }
        }
    }

    return {
        meshCount: meshesSeen.size,
        materialCount: materialsSeen.size,
        primitiveCount,
        nodeNames,
        bounds: { min, max },
        size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    };
}

module.exports = { inspectGlb, readGlbJson };
```

- [ ] **Step 2: Scrivere il test del parser contro un `.glb` noto**

Si valida il parser contro `f1PitBox.glb`, di cui le dimensioni grezze sono già state misurate con Blender headless (6.20 × 6.00 × 2.80 in coordinate Blender → in coordinate glTF X=6.20, Y=2.80 altezza, Z=6.00).

```js
// backend/tools/glbInspect.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { inspectGlb } = require('./glbInspect.js');

const REPO = path.join(__dirname, '..', '..');

test('inspectGlb misura f1PitBox.glb come Blender (6.20 x 2.80 alt x 6.00)', () => {
    const info = inspectGlb(path.join(REPO, 'frontend/assets/custom/f1PitBox.glb'));
    assert.ok(Math.abs(info.size[0] - 6.20) < 0.05, `larghezza ${info.size[0]}`);
    assert.ok(Math.abs(info.size[1] - 2.80) < 0.05, `altezza ${info.size[1]}`);
    assert.ok(Math.abs(info.size[2] - 6.00) < 0.05, `profondità ${info.size[2]}`);
});

test('inspectGlb conta 11 mesh su f1Car.glb (corpo + ruote separate)', () => {
    const info = inspectGlb(path.join(REPO, 'frontend/assets/custom/f1Car.glb'));
    assert.equal(info.meshCount, 11);
});
```

- [ ] **Step 3: Eseguire i test del parser — devono fallire**

Run: `node --test backend/tools/glbInspect.test.js`
Expected: FAIL — `Cannot find module './glbInspect.js'` se lo Step 1 non è stato ancora salvato; altrimenti PASS immediato (il parser è scritto contro file già esistenti). Se passa subito è corretto: questo test valida il parser, non l'asset.

- [ ] **Step 4: Scrivere `backend/tools/voxelKit.py`**

```python
"""
Libreria condivisa per la scultura voxel degli asset del circuito F1.
Stessa tecnica di backend/tools/f1CarBuilder.py (primitive box + scale non
uniformi + transform_apply), qui generalizzata e riusabile.

Convenzioni (vedi docs/superpowers/plans/2026-08-09-f1-circuit-voxel-assets.md):
  - si modella in unità di GIOCO (scala 1:1, nessuno scale all'istanza)
  - Blender Z-up: Z = altezza in gioco, -Y Blender = +Z gioco (il FRONTE)
  - base dell'asset a Z=0, centrato su X=0/Y=0
  - una mesh per colore (max 6 materiali: f1.js crea un InstancedMesh per mesh)
"""
import bpy
import math
import os
import sys
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
GLB_DIR = os.path.join(REPO_ROOT, 'frontend', 'assets', 'custom', 'circuit')
RENDER_DIR = os.path.join(SCRIPT_DIR, 'renders', 'circuit')
CAR_GLB = os.path.join(REPO_ROOT, 'frontend', 'assets', 'custom', 'f1Car.glb')
CAR_SCALE = 3.5  # stesso fattore di carLoader.js: porta l'auto a 7.17 unità

_HEX = {
    'concrete':     'C9C5BB',
    'concreteDark': '8D8980',
    'steel':        '6E7378',
    'steelDark':    '3A4045',
    'white':        'F2F2EE',
    'red':          'D6392F',
    'blue':         '2F6FB5',
    'yellow':       'F2C233',
    'green':        '4C8C3F',
    'black':        '1E2124',
    'tarmac':       '4A4E52',
    'glass':        '7FB6D9',
}


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _hex_to_linear(h):
    return tuple(_srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


PALETTE = {k: _hex_to_linear(v) for k, v in _HEX.items()}

# Roughness per materiale: il metallo riflette un po' di più del cemento,
# il vetro molto di più. Nessun metallic > 0 (stile flat, vedi spec).
_ROUGHNESS = {'glass': 0.15, 'steel': 0.55, 'steelDark': 0.55, 'black': 0.85}
_DEFAULT_ROUGHNESS = 0.8


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras,
                 bpy.data.lights, bpy.data.images):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


class VoxelKit:
    """Accumula i pezzi di UN asset e li consolida in una mesh per colore."""

    def __init__(self, asset_id):
        self.asset_id = asset_id
        self.parts = []          # (materiale, oggetto)
        self.keep_separate = ()  # nomi da NON joinare (vedi finish/podium)
        self._materials = {}     # nome colore -> bpy material
        self._n = 0

    def _material(self, name):
        if name not in self._materials:
            if name not in PALETTE:
                raise KeyError(f'colore "{name}" non in PALETTE: {sorted(PALETTE)}')
            mat = bpy.data.materials.new(f'{self.asset_id}_{name}')
            mat.use_nodes = True
            bsdf = mat.node_tree.nodes.get('Principled BSDF')
            bsdf.inputs['Base Color'].default_value = (*PALETTE[name], 1.0)
            bsdf.inputs['Roughness'].default_value = _ROUGHNESS.get(name, _DEFAULT_ROUGHNESS)
            bsdf.inputs['Metallic'].default_value = 0.0
            self._materials[name] = mat
        return self._materials[name]

    def box(self, mat, size, center):
        """size = dimensioni piene (sx, sy, sz), center = centro del volume."""
        bpy.ops.mesh.primitive_cube_add(size=1, location=center)
        obj = bpy.context.active_object
        self._n += 1
        obj.name = f'{self.asset_id}_{mat}_{self._n}'
        obj.scale = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(self._material(mat))
        bpy.ops.object.shade_flat()
        self.parts.append((mat, obj))
        return obj

    def cyl(self, mat, radius, depth, center, axis='Z', verts=12):
        """Cilindro voxel a poche facce (stesso stile delle ruote dell'auto)."""
        rot = {'Z': (0, 0, 0), 'X': (0, math.radians(90), 0), 'Y': (math.radians(90), 0, 0)}[axis]
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth,
                                            location=center, rotation=rot)
        obj = bpy.context.active_object
        self._n += 1
        obj.name = f'{self.asset_id}_{mat}_{self._n}'
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        obj.data.materials.append(self._material(mat))
        bpy.ops.object.shade_flat()
        self.parts.append((mat, obj))
        return obj

    def finish(self, keep_separate=()):
        """Join per colore + transform_apply completo. Gli oggetti il cui nome
        è in keep_separate NON vengono joinati (servono referenziabili per
        nome nel .glb, es. i gradini del podio)."""
        separate = [o for _, o in self.parts if o.name in keep_separate]
        groups = {}
        for mat, obj in self.parts:
            if obj.name in keep_separate:
                continue
            groups.setdefault(mat, []).append(obj)

        result = []
        for mat, objs in groups.items():
            bpy.ops.object.select_all(action='DESELECT')
            for o in objs:
                o.select_set(True)
            bpy.context.view_layer.objects.active = objs[0]
            if len(objs) > 1:
                bpy.ops.object.join()
            merged = bpy.context.active_object
            merged.name = f'{self.asset_id}_{mat}'
            result.append(merged)

        for obj in result + separate:
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

        if len(result) > 6:
            raise ValueError(f'{self.asset_id}: {len(result)} materiali, massimo 6 '
                             '(f1.js crea un InstancedMesh per mesh)')
        return result + separate


def export_glb(asset_id, objects):
    os.makedirs(GLB_DIR, exist_ok=True)
    path = os.path.join(GLB_DIR, f'{asset_id}.glb')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True)
    return path


def _point_camera(cam, target):
    direction = Vector(target) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def setup_preview_scene(span):
    """Terreno + sole + cielo. span = dimensione dell'asset, serve solo a
    dimensionare il piano d'appoggio."""
    ground_size = max(40.0, span * 4)
    bpy.ops.mesh.primitive_plane_add(size=ground_size, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = 'preview_ground'
    mat = bpy.data.materials.new('preview_ground_mat')
    mat.use_nodes = True
    mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (*PALETTE['green'], 1.0)
    mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = 0.9
    ground.data.materials.append(mat)

    sun = bpy.data.lights.new('sun', type='SUN')
    sun.energy = 3.5
    sun_obj = bpy.data.objects.new('sun', sun)
    bpy.context.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(52), 0, math.radians(40))

    bpy.context.scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.62, 0.72, 1)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 640
    scene.render.image_settings.file_format = 'PNG'


def add_scale_reference(offset_x):
    """Importa l'auto di gioco accanto all'asset: il gate di approvazione è
    sulle proporzioni, e senza un riferimento noto un render isolato non dice
    nulla sulla scala."""
    if not os.path.exists(CAR_GLB):
        return
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=CAR_GLB)
    imported = [o for o in bpy.context.scene.objects if o not in before]
    roots = [o for o in imported if o.parent is None]
    for obj in roots:
        obj.scale = (CAR_SCALE, CAR_SCALE, CAR_SCALE)
        obj.location = (offset_x, 0, 0)
    # f1Car.glb ha l'origine a metà altezza, non alla base (misurato: bbox
    # grezza da z=-0.26 a z=0.25) — senza questa correzione l'auto di
    # riferimento affonda di quasi un metro nel terreno del render.
    bpy.context.view_layer.update()
    low = min((obj.matrix_world @ Vector(c)).z
              for obj in imported if obj.type == 'MESH' for c in obj.bound_box)
    for obj in roots:
        obj.location.z -= low


def render_3q(asset_id, span, height, with_car=True):
    """Vista 3/4 con inquadratura calcolata dall'ingombro dell'asset."""
    os.makedirs(RENDER_DIR, exist_ok=True)
    car_offset = span * 0.5 + 6
    setup_preview_scene(span + (car_offset if with_car else 0))
    if with_car:
        add_scale_reference(car_offset)

    reach = max(span, height) * 1.9 + 8
    cam_data = bpy.data.cameras.new(f'cam_{asset_id}')
    cam_obj = bpy.data.objects.new(f'cam_{asset_id}', cam_data)
    bpy.context.collection.objects.link(cam_obj)
    cam_obj.location = (reach * 0.75, -reach * 0.85, height * 0.85 + span * 0.25)
    _point_camera(cam_obj, (0, 0, height * 0.42))

    scene = bpy.context.scene
    scene.camera = cam_obj
    path = os.path.join(RENDER_DIR, f'{asset_id}.png')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path
```

- [ ] **Step 5: Scrivere il registry `backend/tools/circuitAssets/__init__.py`**

In questo task contiene solo `grandStand`; i task successivi aggiungono le proprie voci.

```python
"""Registry degli asset del circuito: assetId -> build(kit) -> (span, height).
Ogni build() scolpisce i pezzi con il kit e ritorna l'ingombro orizzontale e
l'altezza, usati solo per inquadrare il render."""
from . import grandstands

ASSET_BUILDERS = {
    'grandStand': grandstands.build_grand_stand,
}
```

- [ ] **Step 6: Scrivere il runner `backend/tools/f1CircuitAssetsBuilder.py`**

```python
"""
Costruisce gli asset voxel del circuito F1 (vedi
docs/superpowers/specs/2026-08-09-f1-circuit-voxel-assets-design.md).

Uso (dalla root del repo):
    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
        --python backend/tools/f1CircuitAssetsBuilder.py -- --asset grandStand

Senza --asset costruisce tutti gli asset del registry.
Con --no-render salta i render (build veloce, per i soli test tecnici).

Output:
    frontend/assets/custom/circuit/<assetId>.glb
    backend/tools/renders/circuit/<assetId>.png
"""
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import voxelKit  # noqa: E402
from circuitAssets import ASSET_BUILDERS  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
wanted = None
if '--asset' in argv:
    wanted = argv[argv.index('--asset') + 1].split(',')
do_render = '--no-render' not in argv

ids = wanted or list(ASSET_BUILDERS)
unknown = [a for a in ids if a not in ASSET_BUILDERS]
if unknown:
    raise SystemExit(f'asset sconosciuti: {unknown}. Disponibili: {sorted(ASSET_BUILDERS)}')

for asset_id in ids:
    voxelKit.clear_scene()
    kit = voxelKit.VoxelKit(asset_id)
    span, height = ASSET_BUILDERS[asset_id](kit)
    objects = kit.finish(keep_separate=kit.keep_separate)
    glb = voxelKit.export_glb(asset_id, objects)
    print(f'[circuitAssets] {asset_id}: {len(objects)} mesh -> {glb}')
    if do_render:
        png = voxelKit.render_3q(asset_id, span, height)
        print(f'[circuitAssets] {asset_id}: render -> {png}')

print(f'[circuitAssets] completati {len(ids)} asset')
```

- [ ] **Step 7: Scrivere il test degli invarianti `backend/tools/circuitAssets.test.js`**

Il test è **table-driven**: i task successivi aggiungono solo una riga a `EXPECTED`. Le tolleranze dimensionali sono volutamente larghe (±20%) — la dimensione esatta è una scelta estetica che si valida col render, il test protegge dagli errori strutturali (pivot sbagliato, troppi materiali, fronte al contrario, file corrotto).

```js
// backend/tools/circuitAssets.test.js
//
// Verifica tecnica degli asset voxel del circuito (vedi
// docs/superpowers/plans/2026-08-09-f1-circuit-voxel-assets.md).
// Non verifica l'estetica — quella passa dal render e dal gate utente.
// Rigenerare gli asset con:
//   blender --background --python backend/tools/f1CircuitAssetsBuilder.py
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { inspectGlb } = require('./glbInspect.js');

const GLB_DIR = path.join(__dirname, '..', '..', 'frontend', 'assets', 'custom', 'circuit');

// w = larghezza (X), h = altezza (Y), d = profondità (Z), in unità di gioco.
// Tolleranza ±20% sulle dimensioni: sono target di design, non contratti.
// centerTol (opzionale): scarto ammesso tra centro del bounding box e origine.
// Il default 0.6 impone asset simmetrici; si alza SOLO per asset in cui il
// pivot naturale non è il centro dell'ingombro (es. flagPole: si piazza
// l'asta, la bandiera sporge di lato).
const EXPECTED = {
    grandStand: { w: 18, h: 12, d: 12 },
};

const TOL = 0.20;
const DEFAULT_CENTER_TOL = 0.6;

function inRange(actual, target) {
    return actual >= target * (1 - TOL) && actual <= target * (1 + TOL);
}

for (const [assetId, exp] of Object.entries(EXPECTED)) {
    const glb = path.join(GLB_DIR, `${assetId}.glb`);

    test(`${assetId}: il .glb esiste ed è parsabile`, () => {
        assert.ok(fs.existsSync(glb), `manca ${glb} — rigenerare con f1CircuitAssetsBuilder.py`);
        const info = inspectGlb(glb);
        assert.ok(info.primitiveCount > 0, 'nessuna primitiva nel file');
    });

    test(`${assetId}: massimo 6 materiali (un InstancedMesh per mesh in f1.js)`, () => {
        const info = inspectGlb(glb);
        assert.ok(info.materialCount <= 6, `${info.materialCount} materiali`);
    });

    test(`${assetId}: pivot alla base (Y min ≈ 0) e centrato in XZ`, () => {
        const { min, max } = inspectGlb(glb).bounds;
        assert.ok(Math.abs(min[1]) < 0.05, `base a Y=${min[1]}, attesa 0`);
        const centerTol = exp.centerTol ?? DEFAULT_CENTER_TOL;
        const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
        assert.ok(Math.abs(cx) <= centerTol, `centro X=${cx}, atteso 0 ±${centerTol}`);
        assert.ok(Math.abs(cz) <= centerTol, `centro Z=${cz}, atteso 0 ±${centerTol}`);
    });

    test(`${assetId}: ingombro entro ±20% del target`, () => {
        const [w, h, d] = inspectGlb(glb).size;
        assert.ok(inRange(w, exp.w), `larghezza ${w.toFixed(2)}, target ${exp.w}`);
        assert.ok(inRange(h, exp.h), `altezza ${h.toFixed(2)}, target ${exp.h}`);
        assert.ok(inRange(d, exp.d), `profondità ${d.toFixed(2)}, target ${exp.d}`);
    });
}
```

- [ ] **Step 8: Eseguire il test — deve fallire perché il `.glb` non esiste ancora**

Run: `node --test backend/tools/circuitAssets.test.js`
Expected: FAIL — `manca .../circuit/grandStand.glb — rigenerare con f1CircuitAssetsBuilder.py`

- [ ] **Step 9: Scolpire `grandStand` in `backend/tools/circuitAssets/grandstands.py`**

Specifica dimensionale (unità di gioco; ricorda: X = larghezza, Y Blender = profondità con **fronte a −Y**, Z Blender = altezza):

- Ingombro: **18 largh × 12 prof × 12 alt**. Tre volte il modulo Kenney (6×6×5.38): accanto a un'auto lunga 7.17 e alta 1.79 si legge come struttura multipiano, non come capanno.
- **Impilabile**: footprint costante su tutta l'altezza e sommità piatta a Z=12 esatti — `buildMainGrandstandLayout` impila i moduli traslandoli in Y di un passo fisso, quindi qualsiasi sporgenza sopra Z=12 romperebbe il livello superiore (è esattamente il motivo per cui oggi il codice esclude `grandStandAwning` dall'impilamento).
- Struttura obbligatoria:
  - **Basamento** `concreteDark`, 18 × 12 × 1.0, da Z=0 a Z=1.0.
  - **Gradinata** su 9 file, ognuna alta 1.1 e profonda 1.15, che sale da Z=1.0 (fronte, a Y=−6) fino a Z=11.0 (retro): ogni fila è un gradone `concrete` largo 17.2 + un blocco di sedili sopra.
  - **Sedili**: box da 0.7 × 0.7 × 0.45 sopra ogni gradone, alternati `blue`/`white` a scacchiera (colore = `(fila + colonna) % 2`), 11 colonne per fila con passo 1.5 — è il dettaglio che rende leggibile "tribuna" a distanza.
  - **Parete di fondo** `concrete`, 18 × 0.8 × 12, sul retro (Y da +5.6 a +6).
  - **Fianchi** `concrete`, 0.8 × 12 × 12, ai due lati (X = ±8.6).
  - **Parapetto frontale** `steel`, 18 × 0.3 × 1.2, sul fronte a Y=−6, base Z=1.0.
  - **Fascia sponsor** `red`, 16 × 0.25 × 1.0, applicata sul parapetto verso l'esterno (Y=−6.2), base Z=1.1.
  - **Scala laterale** `steel`: 8 gradini 1.6 × 0.9 × 0.25 sul fianco destro (X=+8.0), che salgono da Z=1.2 a Z=8.
- Materiali usati: `concrete`, `concreteDark`, `steel`, `red`, `blue`, `white` = **6, il massimo consentito**. Non aggiungerne altri (in particolare non `steelDark` per la scala: sfonderebbe il limite) — `kit.finish()` solleva `ValueError` oltre 6.

```python
"""Tribune: modulo base impilabile + varianti con tettoia/coperta."""

# Tutte le misure sono in unità di gioco (vedi il piano): l'auto è lunga 7.17,
# quindi un modulo largo 18 copre due auto e mezza affiancate.
W = 18.0          # larghezza (X)
D = 12.0          # profondità (Y Blender; il fronte guarda -Y = +Z gioco)
H = 12.0          # altezza totale: DEVE restare il passo di impilamento
ROWS = 9
ROW_RISE = 1.1    # alzata di un gradone
ROW_DEPTH = 1.15  # pedata di un gradone
BASE_H = 1.0      # basamento


def _tiers(kit):
    """Gradinata che sale dal fronte (-Y) verso il retro (+Y)."""
    for r in range(ROWS):
        z0 = BASE_H + r * ROW_RISE
        y = -D / 2 + 1.0 + r * ROW_DEPTH
        kit.box('concrete', (W - 0.8, ROW_DEPTH, ROW_RISE),
                (0, y, z0 + ROW_RISE / 2))
        for c in range(11):
            x = (c - 5) * 1.5
            mat = 'blue' if (r + c) % 2 == 0 else 'white'
            kit.box(mat, (0.7, 0.7, 0.45), (x, y, z0 + ROW_RISE + 0.225))


def _shell(kit):
    """Basamento, parete di fondo, fianchi, parapetto e fascia sponsor."""
    kit.box('concreteDark', (W, D, BASE_H), (0, 0, BASE_H / 2))
    kit.box('concrete', (W, 0.8, H), (0, D / 2 - 0.4, H / 2))
    for side in (-1, 1):
        kit.box('concrete', (0.8, D, H), (side * (W / 2 - 0.4), 0, H / 2))
    kit.box('steel', (W, 0.3, 1.2), (0, -D / 2 + 0.15, BASE_H + 0.6))
    kit.box('red', (16.0, 0.25, 1.0), (0, -D / 2 - 0.05, BASE_H + 0.6))


def _stairs(kit):
    # 'steel' e non 'steelDark': l'asset è già a 6 materiali (il massimo
    # consentito da kit.finish), un settimo colore lo farebbe fallire.
    for i in range(8):
        kit.box('steel', (1.6, 0.9, 0.25),
                (W / 2 - 1.0, -D / 2 + 1.2 + i * 0.9, 1.2 + i * 0.85))


def build_grand_stand(kit):
    _shell(kit)
    _tiers(kit)
    _stairs(kit)
    return W, H
```

- [ ] **Step 10: Costruire l'asset e verificare che il render esista**

Run:
```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/f1CircuitAssetsBuilder.py -- --asset grandStand
```
Expected: stampa `[circuitAssets] grandStand: 6 mesh -> .../circuit/grandStand.glb` e il path del render. Se un render CYCLES supera ~90 s, cambiare `scene.render.engine` in `'BLENDER_EEVEE_NEXT'` in `voxelKit.setup_preview_scene` — su props flat-color la resa è equivalente e i tempi crollano.

- [ ] **Step 11: Eseguire i test — devono passare**

Run: `node --test backend/tools/glbInspect.test.js backend/tools/circuitAssets.test.js`
Expected: PASS su tutti i test. In particolare `grandStand: pivot alla base (Y min ≈ 0) e centrato in XZ` conferma che la convenzione di export regge.

- [ ] **Step 12: Guardare il render e correggere prima di mostrarlo**

Aprire `backend/tools/renders/circuit/grandStand.png` con lo strumento Read (è un'immagine, va ispezionata visivamente, non dedotta dal codice). Controllare: la gradinata guarda la camera (fronte verso −Y Blender), i sedili si distinguono, l'auto accanto è credibilmente più piccola, la sommità è piatta. Correggere e ricostruire finché non è presentabile.

- [ ] **Step 13: Gate utente**

Mostrare all'utente il render di `grandStand` e chiedere approvazione esplicita prima di passare al Task 2. Non committare: il push/commit è sempre una scelta dell'utente (`CLAUDE.md`).

---

### Task 2: Completare le sostituzioni dirette (6 asset)

**Files:**
- Modify: `backend/tools/circuitAssets/grandstands.py` (aggiungere 2 build)
- Create: `backend/tools/circuitAssets/billboards.py`
- Create: `backend/tools/circuitAssets/pitBuildings.py`
- Modify: `backend/tools/circuitAssets/__init__.py` (6 voci nel registry)
- Modify: `backend/tools/circuitAssets.test.js` (6 righe in `EXPECTED`)
- Output: `grandStandAwning.glb`, `grandStandCovered.glb`, `billboard.glb`, `billboardLow.glb`, `pitsGarageClosed.glb`, `pitsOffice.glb` + i rispettivi render

**Interfaces:**
- Consumes: `voxelKit.VoxelKit.box/cyl/finish`, `ASSET_BUILDERS` (Task 1).
- Produces: `grandstands.build_grand_stand_awning(kit)`, `grandstands.build_grand_stand_covered(kit)`, `billboards.build_billboard(kit)`, `billboards.build_billboard_low(kit)`, `pitBuildings.build_pits_garage_closed(kit)`, `pitBuildings.build_pits_office(kit)` — tutte `(kit) -> (span, height)`.

Specifiche dimensionali (unità di gioco, fronte a −Y Blender):

| asset | largh × prof × alt | contenuto obbligatorio | materiali |
|---|---|---|---|
| `grandStandAwning` | 18 × 14 × 16 | Stesso corpo di `grandStand` (riusare `_shell`/`_tiers`/`_ribs`/`_coping`, non duplicarli — `_stairs` non esiste più: sostituita in Task 1 dal corridoio centrale in `_tiers`, la scala laterale finiva inglobata nella parete e non si vedeva) + tettoia sporgente: falda `white` 18 × 8 × 0.5 a Z=15.5 che sporge 2 unità oltre il fronte (fino a Y=−8), sorretta da 4 montanti `steel` 0.6 × 0.6 × 4.5 a X=±8, Y=−5.5 e Y=−1, e da 2 travi **`steel`** 0.4 × 8 × 0.4 (non `steelDark`: `_shell` porta già 6 colori, un settimo farebbe fallire `kit.finish`). **Non impilabile** — la sporgenza è voluta. | concrete, concreteDark, steel, red, blue, white |
| `grandStandCovered` | 18 × 12 × 15 | Stesso corpo (`_shell`/`_tiers`/`_ribs`, senza `_coping`: lo sostituisce la falda) + copertura totale: falda `concrete` 18 × 12 × 0.6 a Z=14.4 poggiata su 4 pilastri `concrete` 0.9 × 0.9 × 3 agli angoli sopra i fianchi; fascia frontale `red` 18 × 0.3 × 0.8 sul bordo della falda; retro chiuso fino alla falda. Sedili in ombra: usare `blue`/`white` come le altre. | concrete, concreteDark, steel, red, blue, white |
| `billboard` | 16 × 1.6 × 13 | Pannello `white` 16 × 0.5 × 5.5 sospeso con base a Z=7 (bordo superiore a Z=12.5); cornice `steelDark` 16.4 × 0.7 × 0.4 sopra e sotto il pannello; grafica sponsor a bande: 3 fasce `red` e 2 `blue` 4.5 × 0.1 × 1.2 sulla faccia rivolta a −Y (Y=−0.35); 2 montanti `steel` 0.8 × 0.8 × 7 a X=±5, da Z=0 a Z=7; 2 piedi `concreteDark` 2.2 × 1.6 × 0.6 sotto i montanti; controventi diagonali no (restare boxy). | white, steelDark, steel, red, blue, concreteDark |
| `billboardLow` | 16 × 1.4 × 4.5 | Variante bassa a bordo pista: pannello `white` 16 × 0.4 × 3.0 con base a Z=1.2; cornice `steelDark` sopra e sotto; 3 fasce sponsor alternate `red`/`blue` 4.8 × 0.1 × 1.0 a Y=−0.3; 4 piedi `concreteDark` 1.4 × 1.4 × 1.2. | white, steelDark, red, blue, concreteDark |
| `pitsGarageClosed` | 20 × 14 × 9 | Garage decorativo, distinto dal box giocatore (21.7 × 21 × 9.8, che resta il modello del giocatore): corpo `concrete` 20 × 14 × 8; serranda **chiusa** `steel` 14 × 0.4 × 5.5 sul fronte (Y=−7.1), base Z=0.3, con 6 doghe orizzontali `steelDark` 14 × 0.15 × 0.25 in rilievo; tetto piatto `concreteDark` 20.6 × 14.6 × 0.8 a Z=8.4; insegna `red` 8 × 0.3 × 1.6 sopra la serranda a Z=6.4; 2 porte laterali `steelDark` 0.3 × 2 × 3.5 sui fianchi. | concrete, concreteDark, steel, steelDark, red |
| `pitsOffice` | 20 × 14 × 13 | Edificio a 2 piani: corpo `concrete` 20 × 14 × 12; **fascia vetrata continua** `glass` 19 × 0.35 × 2.6 sul fronte a Z=7.4 (Y=−7.1) divisa da 5 montanti `concrete` 0.5 × 0.5 × 2.6; ingresso `glass` 4 × 0.3 × 3.2 al piano terra; terrazza in copertura: solaio `concreteDark` 20.6 × 14.6 × 0.6 a Z=12.3 + parapetto `steel` perimetrale 4 tratti alti 0.9 spessi 0.25; insegna `blue` 6 × 0.3 × 1.4 sopra l'ingresso. | concrete, concreteDark, glass, steel, blue |

- [ ] **Step 1: Aggiungere le 6 righe in `EXPECTED` di `circuitAssets.test.js`**

```js
const EXPECTED = {
    grandStand:       { w: 18, h: 12, d: 12 },
    // centerTol 1.2: la tettoia sporge di 2 unità oltre il fronte, quindi il
    // centro del bounding box cade a Z≈+1 in coordinate gioco. Il pivot
    // giusto resta quello del CORPO (allineato al modulo base), non del
    // volume complessivo — la tettoia è a sbalzo per definizione.
    grandStandAwning: { w: 18, h: 16, d: 14, centerTol: 1.2 },
    grandStandCovered:{ w: 18, h: 15, d: 12 },
    billboard:        { w: 16, h: 13, d: 1.6 },
    billboardLow:     { w: 16, h: 4.5, d: 1.4 },
    pitsGarageClosed: { w: 20, h: 9,  d: 14 },
    pitsOffice:       { w: 20, h: 13, d: 14 },
};
```

- [ ] **Step 2: Eseguire i test — devono fallire sui 6 nuovi asset**

Run: `node --test backend/tools/circuitAssets.test.js`
Expected: FAIL con `manca .../circuit/grandStandAwning.glb` (e analoghi per gli altri 5); i 4 test di `grandStand` restano PASS.

- [ ] **Step 3: Implementare le 2 varianti tribuna in `grandstands.py`**

Riusare `_shell`, `_tiers`, `_stairs` del Task 1 — non duplicare la gradinata. `_shell` va parametrizzato con l'altezza del guscio (`H` per il modulo base, altezza ridotta per le varianti che aggiungono copertura sopra), mantenendo il comportamento attuale come default così `build_grand_stand` non cambia risultato.

- [ ] **Step 4: Implementare `billboards.py` e `pitBuildings.py`** secondo la tabella sopra.

- [ ] **Step 5: Registrare i 6 asset in `circuitAssets/__init__.py`**

```python
from . import grandstands, billboards, pitBuildings

ASSET_BUILDERS = {
    'grandStand':        grandstands.build_grand_stand,
    'grandStandAwning':  grandstands.build_grand_stand_awning,
    'grandStandCovered': grandstands.build_grand_stand_covered,
    'billboard':         billboards.build_billboard,
    'billboardLow':      billboards.build_billboard_low,
    'pitsGarageClosed':  pitBuildings.build_pits_garage_closed,
    'pitsOffice':        pitBuildings.build_pits_office,
}
```

- [ ] **Step 6: Costruire i 6 asset**

Run:
```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/f1CircuitAssetsBuilder.py -- \
    --asset grandStandAwning,grandStandCovered,billboard,billboardLow,pitsGarageClosed,pitsOffice
```
Expected: 6 righe `-> .../circuit/<id>.glb` + 6 render, nessuna eccezione.

- [ ] **Step 7: Eseguire i test — devono passare**

Run: `node --test backend/tools/circuitAssets.test.js`
Expected: PASS su tutti e 7 gli asset (28 test).

- [ ] **Step 8: Ispezionare i 7 render con Read, correggere, poi gate utente**

Guardare ogni PNG in `backend/tools/renders/circuit/`. Verificare in particolare che `grandStandAwning` mostri davvero la tettoia sporgere **verso la camera** (fronte a −Y) e che il pannello di `billboard` sia rivolto alla camera. Poi mostrare i render all'utente e attendere approvazione.

---

### Task 3: Strutture di gara (3 asset)

**Files:**
- Create: `backend/tools/circuitAssets/raceStructures.py`
- Modify: `backend/tools/circuitAssets/__init__.py`
- Modify: `backend/tools/circuitAssets.test.js`
- Output: `raceControlTower.glb`, `startGantry.glb`, `podium.glb` + render

**Interfaces:**
- Consumes: `voxelKit.VoxelKit`, `ASSET_BUILDERS`.
- Produces: `raceStructures.build_race_control_tower(kit)`, `build_start_gantry(kit)`, `build_podium(kit)`.

| asset | largh × prof × alt | contenuto obbligatorio | materiali |
|---|---|---|---|
| `raceControlTower` | 14 × 12 × 34 | **L'elemento più alto del catalogo** (per confronto: `treeLarge` a scala 6 è alto 9.04, la tribuna 12): fusto `concrete` 10 × 10 × 26 con base svasata `concreteDark` 14 × 12 × 2; nastri vetrati `glass` 10.3 × 0.3 × 1.8 sui 4 lati a Z=8, 14, 20; **cabina di direzione gara** in cima, a sbalzo: solaio `concreteDark` 14 × 12 × 0.7 a Z=26, corpo `concrete` 13 × 11 × 4 con vetrata continua `glass` 13.2 × 0.25 × 2.4 su fronte e fianchi (Z=28.2), tetto piatto `concreteDark` 14.6 × 12.6 × 0.6 a Z=31; antenna `steel` 0.35 × 0.35 × 2.5 sul tetto + luce `red` 0.5 × 0.5 × 0.5 in punta a Z=33.7. | concrete, concreteDark, glass, steel, red |
| `startGantry` | 34 × 2.4 × 16 | Arco sopra la carreggiata. **Luce interna 26 unità** (X da −13 a +13): la pista tipica è larga `roadHalfWidth × 2` ≈ 22, quindi a scala 1 passa con margine; chi integra scalerà l'arco per tracciati più larghi (fuori scope qui). 2 piloni `steel` 3 × 2.4 × 13 a X=±15 (esterni alla luce), su piedi `concreteDark` 4.5 × 3.5 × 1; traversa reticolare `steel` 34 × 1.6 × 1.6 a Z=13.5 con 7 diagonali `steelDark` 0.4 × 1.4 × 1.4 alternate; **5 gruppi semaforo** appesi sotto la traversa a X = −8, −4, 0, 4, 8: cassa `black` 1.6 × 1.2 × 3.6 con base Z=9.2 e 4 luci `red` (cilindri `cyl` raggio 0.4, profondità 0.25, asse `Y`, a Y=−0.65 cioè sul fronte) impilate verticalmente; fascia `white` 12 × 0.2 × 1.2 sulla traversa (Y=−0.9) come banda sponsor. | steel, steelDark, black, red, white, concreteDark |
| `podium` | 12 × 7 × 9 | 3 gradini + balconata. **I 3 gradini restano oggetti separati nel `.glb`** (la spec li vuole referenziabili da una futura cerimonia): nominarli `podium_step_p1`, `podium_step_p2`, `podium_step_p3` e passarli a `kit.finish(keep_separate=...)`. Gradini profondi 4 e **centrati a Y=−1.5** (occupano Y da −3.5 a +0.5): P1 al centro X=0 alto 3.0, P2 a X=−4 alto 2.2, P3 a X=+4 alto 1.6, tutti `white` con bordo superiore `red` 4.2 × 4.2 × 0.2; numeri: non modellare cifre (illeggibili in voxel a questa scala), usare invece una fascia `blue` 4.2 × 0.15 × 0.6 sul fronte di ciascun gradino (Y=−3.5). Balconata dietro: pedana `concreteDark` 12 × 3 × 0.5 **a Y=+2.0** (da +0.5 a +3.5), parete sponsor `white` 12 × 0.5 × 6 **a Y=+3.0** con base Z=3 (bordo superiore Z=9) e 3 fasce `red`/`blue`/`red` 3.4 × 0.1 × 1.4; parapetto `steel` 12 × 0.25 × 1.0 a Y=+0.6 sul fronte della pedana. **I valori di Y sono vincolanti**: servono a far cadere il centro del bounding box in Y≈0, altrimenti il test di centratura fallisce e in gioco il podio risulterebbe sfalsato rispetto al punto in cui viene piazzato. | white, red, blue, concreteDark, steel |

Nota implementativa per `podium`: `kit.finish()` accetta già `keep_separate`; il runner lo legge da `kit.keep_separate`. Il builder deve quindi impostare `kit.keep_separate = ('podium_step_p1', 'podium_step_p2', 'podium_step_p3')` e creare quei tre box con `kit.box(...)` rinominandoli subito (`obj.name = 'podium_step_p1'`), perché `kit.box` assegna un nome autogenerato.

- [ ] **Step 1: Aggiungere le 3 righe in `EXPECTED`**

```js
    raceControlTower: { w: 14, h: 34, d: 12 },
    startGantry:      { w: 34, h: 16, d: 2.4 },
    podium:           { w: 12, h: 9,  d: 7 },
```

- [ ] **Step 2: Aggiungere il test dei gradini separati del podio**

In fondo a `circuitAssets.test.js`, fuori dal ciclo su `EXPECTED`:

```js
test('podium: i 3 gradini sono nodi separati e referenziabili per nome', () => {
    const info = inspectGlb(path.join(GLB_DIR, 'podium.glb'));
    for (const step of ['podium_step_p1', 'podium_step_p2', 'podium_step_p3']) {
        assert.ok(info.nodeNames.includes(step), `manca il nodo ${step} in ${info.nodeNames}`);
    }
});
```

- [ ] **Step 3: Eseguire i test — devono fallire**

Run: `node --test backend/tools/circuitAssets.test.js`
Expected: FAIL con `manca .../circuit/raceControlTower.glb` e analoghi; il test dei gradini fallisce con `ENOENT` su `podium.glb`.

- [ ] **Step 4: Implementare `raceStructures.py`** secondo la tabella.

- [ ] **Step 5: Registrare i 3 asset in `__init__.py`** aggiungendo `from . import raceStructures` e le 3 voci.

- [ ] **Step 6: Costruire**

Run:
```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/f1CircuitAssetsBuilder.py -- \
    --asset raceControlTower,startGantry,podium
```
Expected: 3 `.glb` + 3 render, nessuna eccezione.

- [ ] **Step 7: Eseguire i test — devono passare**

Run: `node --test backend/tools/circuitAssets.test.js`
Expected: PASS su tutti e 10 gli asset + il test dei gradini del podio.

- [ ] **Step 8: Ispezionare i render con Read, correggere, poi gate utente**

Controllo specifico: nel render di `startGantry` l'auto di riferimento deve passare comodamente sotto l'arco (luce 26 vs auto larga 3.47) e i semafori devono guardare la camera.

---

### Task 4: Sicurezza/bordo pista (3 asset)

**Files:**
- Create: `backend/tools/circuitAssets/safety.py`
- Modify: `backend/tools/circuitAssets/__init__.py`
- Modify: `backend/tools/circuitAssets.test.js`
- Output: `tyreStack.glb`, `catchFence.glb`, `marshalPost.glb` + render

**Interfaces:**
- Consumes: `voxelKit.VoxelKit` (in particolare `.cyl` per gli pneumatici).
- Produces: `safety.build_tyre_stack(kit)`, `build_catch_fence(kit)`, `build_marshal_post(kit)`.

Questi tre restano **bassi rispetto alle tribune** (spec): sono elementi di bordo pista.

| asset | largh × prof × alt | contenuto obbligatorio | materiali |
|---|---|---|---|
| `tyreStack` | 7 × 2.6 × 2.0 | Modulo componibile ripetibile in curva, quindi **la larghezza 7 è il passo di affiancamento**: nessuna sporgenza oltre X=±3.5, altrimenti due moduli adiacenti compenetrano. 2 file (Y=−0.65 e Y=+0.65) × 6 colonne (X = −2.9 … +2.9, passo 1.16) × 4 pneumatici impilati: `cyl('black', radius=0.58, depth=0.42, axis='Z', verts=12)`, centri a Z = 0.21, 0.63, 1.05, 1.47. Cinghia di contenimento `white` 7 × 2.6 × 0.18 a Z=1.75 (passa sopra le pile) + 2 fascette laterali `red` 0.25 × 2.6 × 1.9. **Verificare che i 12 lati × 48 cilindri non facciano esplodere il conteggio vertici**: se il `.glb` supera 300 KB, ridurre `verts` a 10. | black, white, red |
| `catchFence` | 12 × 0.5 × 9 | Pannello di rete ripetibile, passo di affiancamento 12: 2 montanti `steel` 0.45 × 0.45 × 9 a X=±5.775; 4 traversi orizzontali `steel` 12 × 0.3 × 0.3 a Z=1, 3.6, 6.2, 8.8; **maglia**: 15 barre verticali `steelDark` 0.12 × 0.12 × 7.8 a passo 0.8 (X da −5.6 a +5.6) tra Z=1 e Z=8.8; zoccolo `concreteDark` 12 × 0.5 × 1.0 alla base; inclinazione: non modellarla (una rete inclinata non si affianca correttamente in curva — resta verticale). | steel, steelDark, concreteDark |
| `marshalPost` | 5.5 × 4.5 × 9 | Capanno + asta bandiera: pedana `concreteDark` 5.5 × 4.5 × 0.4; capanno `white` 4.5 × 4 × 3.2 con base Z=0.4, **apertura frontale** (parete a −Y assente: modellare 2 montanti d'angolo `steelDark` 0.4 × 0.4 × 3.2 a X=±2.05, Y=−2 invece della parete piena); tetto spiovente `red` a 3 scalini (3 box 4.9 × 4.4 × 0.35 sfalsati di 0.25 in Y e Z, da Z=3.6); estintore `red` 0.5 × 0.5 × 1.1 a X=+2.2 sulla pedana; asta `steel` 0.25 × 0.25 × 8.6 a X=−2.4, Y=+1.8; **bandiera gialla** `yellow` a 4 scalini che sventolano (4 box 1.1 × 0.12 × 0.55, sfalsati in Y di ±0.2 alternati, da Z=6.5 a Z=8.7, X da −2.2 a −1.1). | concreteDark, white, steelDark, red, steel, yellow |

- [ ] **Step 1: Aggiungere le 3 righe in `EXPECTED`**

```js
    tyreStack:   { w: 7,    h: 2.0, d: 2.6 },
    catchFence:  { w: 12,   h: 9,   d: 0.5 },
    marshalPost: { w: 5.5,  h: 9,   d: 4.5 },
```

Nota: la profondità di `catchFence` (0.5) è vicina alla tolleranza assoluta del test di centratura XZ (0.6): il test verifica il **centro**, non la profondità, quindi non c'è conflitto — ma il modello deve restare simmetrico in Y.

- [ ] **Step 2: Eseguire i test — devono fallire**

Run: `node --test backend/tools/circuitAssets.test.js`
Expected: FAIL con `manca .../circuit/tyreStack.glb` e analoghi.

- [ ] **Step 3: Implementare `safety.py`** secondo la tabella.

- [ ] **Step 4: Registrare i 3 asset in `__init__.py`.**

- [ ] **Step 5: Costruire**

Run:
```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/f1CircuitAssetsBuilder.py -- \
    --asset tyreStack,catchFence,marshalPost
```

- [ ] **Step 6: Controllare la dimensione dei file**

Run: `ls -la frontend/assets/custom/circuit/`
Expected: nessun `.glb` sopra ~300 KB (riferimento: `f1PitBox.glb` è 95 KB). Se `tyreStack.glb` sfora, ridurre `verts` da 12 a 10 nei cilindri e ricostruire.

- [ ] **Step 7: Eseguire i test — devono passare**

Run: `node --test backend/tools/circuitAssets.test.js`
Expected: PASS su tutti e 13 gli asset.

- [ ] **Step 8: Ispezionare i render con Read, correggere, poi gate utente.**

---

### Task 5: Decoro paddock/rettilineo (3 asset)

**Files:**
- Create: `backend/tools/circuitAssets/decor.py`
- Modify: `backend/tools/circuitAssets/__init__.py`
- Modify: `backend/tools/circuitAssets.test.js`
- Output: `pylon.glb`, `flagPole.glb`, `paddockTent.glb` + render

**Interfaces:**
- Consumes: `voxelKit.VoxelKit`.
- Produces: `decor.build_pylon(kit)`, `build_flag_pole(kit)`, `build_paddock_tent(kit)`.

| asset | largh × prof × alt | contenuto obbligatorio | materiali |
|---|---|---|---|
| `pylon` | 6 × 3 × 26 | Pylon pubblicitario **snello e alto** (spec): fusto `steel` 1.4 × 1.4 × 20 da Z=0 a Z=20, su base `concreteDark` 3 × 3 × 1.2; pannello superiore `white` 6 × 1 × 7 con base Z=19 (bordo a Z=26), bordato da cornice `steelDark` 6.4 × 1.3 × 0.35 sopra e sotto; grafica: 2 fasce `red` e 1 `blue` 5 × 0.12 × 1.5 sulla faccia a −Y (Y=−0.56); il fusto deve restare visibilmente più stretto del pannello, è quello che dà la lettura "pylon" e non "cartellone". | steel, steelDark, white, red, blue, concreteDark |
| `flagPole` | 5 × 1.6 × 15 | **Asta a X=0** (è il pivot naturale: `trackScenery.js` piazzerà il punto dell'asta, non il centro dell'ingombro — per questo il test usa `centerTol` allargata): asta `white` 0.3 × 0.3 × 14 da Z=0.6 a Z=14.6, su base `concreteDark` 1.6 × 1.6 × 0.6. **Bandiera a scacchi** sventolante che sporge verso +X: 5 colonne di box 0.9 × 0.14 × 2.8 con centri a X = 0.6, 1.5, 2.4, 3.3, 4.2, sfalsate in Y di `(0, 0.35, 0, −0.35, 0)` e in Z di `(0, 0.15, 0.3, 0.15, 0)` — l'ondulazione a scatti è ciò che rende "sventolante" in voxel. Ogni colonna è suddivisa in 4 riquadri 0.9 × 0.14 × 0.7 alternati `black`/`white` a scacchiera (`(col + riga) % 2`), per un totale di 20 riquadri: è il pattern a scacchi, non decorazione opzionale. Puntale `yellow` 0.4 × 0.4 × 0.4 a Z=14.8. | white, black, concreteDark, yellow |
| `paddockTent` | 16 × 12 × 7 | Tenda hospitality: 6 pali `steel` 0.35 × 0.35 × 4.5 agli angoli e a metà dei lati lunghi (X = −8, 0, +8 × Y = ±6); **tetto a due falde** `white` a scalini voxel: 5 gradini per falda, box 16.8 × 1.3 × 0.4 che salgono da Z=4.5 (bordo, Y=±6.2) a Z=6.8 (colmo, Y=0), per entrambe le falde; colmo `red` 16.8 × 0.5 × 0.35 a Z=7; parete di fondo `white` 16 × 0.25 × 4.5 a Y=+6 (chiusa) — **fronte e fianchi aperti** (nessuna parete a −Y); pedana `concrete` 16 × 12 × 0.35; bancone `concreteDark` 6 × 1.2 × 1.4 all'interno contro la parete di fondo; festone `red` 16 × 0.2 × 0.5 lungo il bordo della falda anteriore (Y=−6.3, Z=4.6). | white, red, steel, concrete, concreteDark |

- [ ] **Step 1: Aggiungere le 3 righe in `EXPECTED`**

```js
    pylon:       { w: 6,  h: 26, d: 3 },
    flagPole:    { w: 5,  h: 15, d: 1.6, centerTol: 2.6 },
    paddockTent: { w: 16, h: 7,  d: 12 },
```

Nota su `flagPole`: è l'unico asset del catalogo **volutamente non centrato**, e per questo porta `centerTol: 2.6`. Il suo pivot naturale è l'asta (X=0), non il centro dell'ingombro: la bandiera sporge tutta verso +X, quindi il centro del bounding box cade intorno a X≈+1.9. Forzarlo a essere simmetrico significherebbe piazzare l'asta fuori dal punto scelto da `trackScenery.js`. `pylon` invece è simmetrico (fusto e pannello entrambi centrati su X=0) e usa la tolleranza di default.

- [ ] **Step 2: Eseguire i test — devono fallire**

Run: `node --test backend/tools/circuitAssets.test.js`
Expected: FAIL con `manca .../circuit/pylon.glb` e analoghi.

- [ ] **Step 3: Implementare `decor.py`** secondo la tabella.

- [ ] **Step 4: Registrare i 3 asset in `__init__.py`** — il registry ora contiene tutti e 16 gli asset.

- [ ] **Step 5: Ricostruire TUTTI e 16 gli asset da zero**

Run:
```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/f1CircuitAssetsBuilder.py
```
Expected: `[circuitAssets] completati 16 asset`. Una ricostruzione completa a fine lavoro verifica che i moduli non si siano rotti a vicenda durante l'iterazione (il registry importa tutto insieme).

- [ ] **Step 6: Eseguire l'intera suite di test**

Run: `node --test backend/tools/glbInspect.test.js backend/tools/circuitAssets.test.js`
Expected: PASS su tutti e 16 gli asset (64 test dimensionali/strutturali + il test dei gradini del podio + i 2 test del parser).

- [ ] **Step 7: Verificare che i 16 file esistano e siano di dimensione sensata**

Run: `ls -la frontend/assets/custom/circuit/ && ls -la backend/tools/renders/circuit/`
Expected: 16 `.glb` e 16 `.png`, nessun file a 0 byte.

- [ ] **Step 8: Ispezionare i render con Read, correggere, poi gate utente finale**

Mostrare all'utente i render dei 3 asset di decoro e riassumere il catalogo completo (16 asset, dimensioni misurate) — quelle misure sono l'input dello step di integrazione successivo, che dovrà ritarare le costanti di piazzamento in `trackScenery.js`.

- [ ] **Step 9: Aggiornare `docs/f1-notes.md`**

Aggiungere una sezione "Asset voxel del circuito" con: percorso del catalogo (`frontend/assets/custom/circuit/`), comando di rigenerazione, le convenzioni non ovvie (scala 1:1 a differenza di Kenney ×6 e custom ×3.5, fronte a +Z gioco = −Y Blender, max 6 materiali per il vincolo InstancedMesh) e la tabella delle dimensioni finali misurate. Senza questa nota, chi farà l'integrazione dovrà ri-derivare tutto.

- [ ] **Step 10: NON committare**

Il commit e il push sono sempre una scelta esplicita dell'utente (`CLAUDE.md`). Riepilogare i file creati e lasciare la decisione a lui.
