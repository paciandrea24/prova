# F1 — modello auto custom per visuale cockpit (sotto-progetto A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ricostruire un'auto F1 in stile voxel a partire dalle 4 viste
ortogonali fornite dall'utente (scultura per silhouette), farla approvare
tramite render di anteprima, poi collegarla al gioco.

**Architecture:** Pipeline in due stadi. Stadio 1 (`backend/tools/f1CarVoxelize.py`,
Python "normale": numpy/scipy/PIL, nessuna dipendenza nuova) analizza il
foglio di riferimento ed esporta un JSON con i parallelepipedi scavati e i
parametri ruota. Stadio 2 (`backend/tools/f1CarBuilder.py`, Blender headless)
legge quel JSON, costruisce/unisce la mesh, esporta il GLB e renderizza le
anteprime. Un terzo task, solo dopo l'ok dell'utente sui render, punta
`loadCarModel()` al nuovo file.

**Tech Stack:** Python 3 con `numpy`/`scipy`/`PIL` (già presenti
nell'ambiente, verificato), Blender 5.1 (`C:\Program Files\Blender
Foundation\Blender 5.1\blender.exe`), Three.js GLTFLoader (già in uso lato
client).

**CHIUSO 2026-07-24 — piano completato e verificato dall'utente in
localhost.** Stato finale in `frontend/f1.js`:
- Modello dell'utente collegato e funzionante (`frontend/assets/custom/f1Car.glb`).
- Ricolore per team via `recolorLiveryTexture()`: soglia tonalità
  stretta a 28° (dato reale: livrea non supera 23.8°, ombre AO
  olive/marroni partono da 32°), lift di luminosità uniforme
  (`VALUE_LIFT_FLOOR=0.14`, `VALUE_LIFT_GAMMA=0.55`) per rendere
  leggibili le parti nere senza più il buco nero indistinguibile, e
  desaturazione (`BLACK_SAT_SCALE=0.12`) sui texel non-livrea per
  spegnere il residuo di tonalità gialla rivelato dal lift. Saturazione/
  luminosità dei texel livrea ora derivano dal colore SCELTO dal
  giocatore (non dalla texture sorgente) così colori scuri/poco saturi
  come il marrone non vengono più resi come rosso vivido. **Confermato
  OK dall'utente.**
- Hitbox fisico (`CAR_HALF_WIDTH`/`CAR_HALF_LENGTH`) a 1.74/3.58 —
  confermato OK, non toccato.
- Camera cockpit (tasto C, `updateCamera()`): ricalcolata analizzando il
  profilo di altezza reale della mesh (apice halo misurato a
  `y≈1.79m, z≈-0.49m` nel frame world) invece di dedurre alla cieca —
  camera a `(0, 1.95, -0.5)` con inclinazione 10° verso il basso, stile
  halo-cam broadcast (F1 TV pod) su riferimento fornito dall'utente.
  **Confermato OK dall'utente.**

**AGGIORNAMENTO 2026-07-24 — Task 1/2 superati da un modello fornito
dall'utente:** dopo aver visto i render della pipeline di scultura sotto
(voxel sparsi, ruote scoordinate), l'utente ha fornito un proprio modello
già pronto (`C:\Users\pacia\Desktop\f1 car model.glb` → copiato in
`frontend/assets/custom/f1Car.glb`): mesh voxel unica con texture-palette
256×1px (128 colori), rosso/nero, nessuna mesh ruota separata. La pipeline
di scultura (Task 1/2, script sotto) resta nel repo perché funzionante e
potenzialmente utile in futuro, ma **non è più il percorso seguito per
questo modello**. Il Task 3 è stato adattato: invece del ricolore
"quasi-bianco → hex team" (pensato per materiali a tinta unita), il nuovo
modello usa un ricolore per tonalità sulla texture-palette (righe
~295-370 di `frontend/f1.js`) — sostituisce solo i texel nella fascia
rosso/arancio (hue ≤45°, saturazione ≥0.2, misurato sulla palette reale)
con la stessa luminosità/saturazione ma tonalità del colore giocatore,
lasciando nero e resto intatti. Anche la generazione di ruote sintetiche è
stata condizionata a `allMeshes.length > 1` per non aggiungere cilindri
scoordinati su un modello a mesh singola. Vedi commit di lavoro in
`frontend/f1.js` per il codice esatto. Il resto di questo documento
(Task 1/2 dettagliati) resta come riferimento storico/riusabile.

**Nota — Task 1 e 2 già eseguiti in fase di validazione del piano:** prima
di scrivere questo documento la pipeline è stata effettivamente scritta ed
eseguita per verificare che l'algoritmo funzionasse sul riferimento reale
(la segmentazione automatica delle ruote per componenti connesse, ipotesi
iniziale, NON ha funzionato su questa immagine — ruote e scocca formano un
unico blob anche dopo erosione morfologica aggressiva fino a kernel 9×9;
sostituita con ruote a posizione fissa parametrica, escluse dallo scavo per
posizione). I file sotto sono già nel repo e funzionanti; i Task 1-2
descrivono comunque il lavoro per intero (per tracciabilità e per il caso
in cui vadano ri-eseguiti/modificati), con gli step di verifica già marcati
come superati e il loro output effettivo riportato.

## Global Constraints

- Nessuna nuova dipendenza: `numpy`, `scipy`, `PIL` sono già disponibili
  nell'ambiente Python di sistema; Blender 5.1 è già installato.
- Le mesh ruota devono avere "wheel" (case-insensitive) nel proprio nome o
  in quello del parent (`frontend/f1.js:331-334`).
- La carrozzeria "verniciabile" (categoria `livery`) deve restare
  quasi-bianca (r,g,b > 0.85 — verifica in `frontend/f1.js:324-329`); le
  altre 3 categorie (`trim`, `accent`, `trim_light`) restano sotto quella
  soglia così da non essere toccate dal ricolore per team.
- Footprint autorato = `CAR_HALF_WIDTH/3.5` e `CAR_HALF_LENGTH/3.5`
  (0.371 / 0.686 unità Blender), coerente con l'hitbox fisico fisso
  (`backend/sockets/games/f1GameSocket.js:58-59`) e col fattore di scala
  ×3.5 già applicato da `loadCarModel()` — nessuna modifica a hitbox o
  scala.
- Nessun commit/push automatico: per convenzione di progetto lo fa
  l'utente, quando vuole (vedi `CLAUDE.md`).
- Nessuna modifica alla camera o all'HUD in questo piano — sono
  sotto-progetti successivi (B, C).

---

## Task 1: Stadio 1 — analisi immagine e scavo (Python)

**Files:**
- Create: `backend/tools/f1CarVoxelize.py` — **già creato ed eseguito con successo**
- Create: `backend/tools/reference/f1-car-turnaround.png` — **già copiato**
  dal riferimento fornito dall'utente
- Modify: `.gitignore` — **già fatto** (ignora
  `backend/tools/f1CarVoxelData.json` e `backend/tools/renders/`, output
  rigenerabili)

**Interfaces:**
- Consumes: `backend/tools/reference/f1-car-turnaround.png` (immagine
  fornita dall'utente, 1672×941px, 4 viste ortogonali in un unico foglio).
- Produces: `backend/tools/f1CarVoxelData.json` — `{half_width, half_length,
  height_max, palette: {categoria: [r,g,b]}, boxes: [{category, center:
  [x,y,z], size: [w,l,h]}], wheels: [{name, x, y, radius, width}]}`. Usato
  dal Task 2.

- [x] **Step 1: Scrivere lo script di analisi/scavo**

Contenuto attuale di `backend/tools/f1CarVoxelize.py` (validato, vedi Step 3):

```python
"""
Stadio 1 della pipeline "scultura per silhouette": analizza il foglio di
riferimento (4 viste ortogonali) e scrive un JSON con i parallelepipedi
scavati (posizione/dimensione/categoria colore) + i parametri delle 4
ruote, pronto per essere letto da backend/tools/f1CarBuilder.py (Stadio 2,
Blender). Nessuna dipendenza nuova: usa numpy/scipy/PIL già presenti
nell'ambiente.

Uso:
    python3 backend/tools/f1CarVoxelize.py

Output:
    backend/tools/f1CarVoxelData.json
"""
import json
import os
import numpy as np
from PIL import Image
from scipy import ndimage

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REF_PATH   = os.path.join(SCRIPT_DIR, 'reference', 'f1-car-turnaround.png')
OUT_PATH   = os.path.join(SCRIPT_DIR, 'f1CarVoxelData.json')

# Footprint autorato: combacia con l'hitbox fisico fisso (CAR_HALF_WIDTH,
# CAR_HALF_LENGTH in backend/sockets/games/f1GameSocket.js) diviso per il
# fattore di scala x3.5 applicato da loadCarModel() in frontend/f1.js.
HALF_WIDTH  = 1.3 / 3.5    # 0.3714
HALF_LENGTH = 2.4 / 3.5    # 0.6857
HEIGHT_MAX  = 0.27         # 0.27 x 3.5 = 0.945m, altezza halo F1 reale

GRID_NX, GRID_NY, GRID_NZ = 32, 60, 18   # risoluzione griglia (largh, lungh, alt)

BG_DIST_THRESH    = 40
NOISE_AREA_FRAC   = 0.0005

# Le ruote restano parametriche a posizione fissa: nelle immagini di
# riferimento ruote e scocca formano un unico blob connesso anche dopo
# erosione morfologica aggressiva (verificato — vedi note nel piano), quindi
# la segmentazione automatica per componenti connesse non è affidabile su
# questo tipo di immagine. Si esclude invece dallo scavo la colonna (x,y)
# di ognuna delle 4 posizioni ruota fisse, indipendentemente dall'altezza.
WHEEL_DEFS = [
    {'name': 'wheelHub_FL', 'sx': -0.92, 'sy':  0.62, 'radius': 0.095, 'width': 0.050},
    {'name': 'wheelHub_FR', 'sx':  0.92, 'sy':  0.62, 'radius': 0.095, 'width': 0.050},
    {'name': 'wheelHub_RL', 'sx': -0.92, 'sy': -0.62, 'radius': 0.105, 'width': 0.060},
    {'name': 'wheelHub_RR', 'sx':  0.92, 'sy': -0.62, 'radius': 0.105, 'width': 0.060},
]
WHEEL_EXCLUDE_MARGIN = 1.3   # moltiplicatore sul raggio per l'esclusione dallo scavo

VIEW_BOXES = {
    'side':  (0.0257, 0.0925, 0.5652, 0.3124),
    'front': (0.6525, 0.0840, 0.8894, 0.3284),
    'rear':  (0.6519, 0.3294, 0.9139, 0.6281),
    'top':   (0.0377, 0.6440, 0.4898, 0.9564),
}

PALETTE_MATERIAL_COLOR = {
    'livery':     (0.92, 0.92, 0.92),
    'trim':       (0.07, 0.07, 0.08),
    'accent':     (0.85, 0.55, 0.05),
    'trim_light': (0.78, 0.78, 0.78),
}


def load_crops():
    im = Image.open(REF_PATH).convert('RGB')
    w, h = im.size
    arr = np.array(im).astype(np.float32) / 255.0
    bg = arr[2, 2].copy()
    crops = {}
    for name, (x0f, y0f, x1f, y1f) in VIEW_BOXES.items():
        x0, x1 = int(x0f * w), int(x1f * w)
        y0, y1 = int(y0f * h), int(y1f * h)
        crops[name] = arr[y0:y1, x0:x1].copy()
    return crops, bg


def segment_hull(crop, bg):
    """Ritorna la maschera booleana HxW dei pixel 'scocca' (non-sfondo, rumore scartato)."""
    dist = np.abs(crop - bg[None, None, :]).sum(axis=2) * 255.0
    nonbg = dist > BG_DIST_THRESH
    labels, n = ndimage.label(nonbg)
    h, w = nonbg.shape
    total_area = h * w
    hull_mask = np.zeros_like(nonbg)
    for i in range(1, n + 1):
        comp = labels == i
        if comp.sum() < NOISE_AREA_FRAC * total_area:
            continue
        hull_mask |= comp
    return hull_mask


def classify_color(rgb):
    r, g, b = rgb
    if max(r, g, b) < 0.25:
        return 'trim'
    if r > 0.6 and g > 0.5 and b < 0.35 and (r - b) > 0.25:
        return 'accent'
    if min(r, g, b) > 0.65:
        return 'trim_light'
    return 'livery'


def sample(mask_or_img, u, v):
    """Nearest-neighbour su array HxW o HxWx3. u=orizzontale, v=verticale, in [0,1]."""
    h = mask_or_img.shape[0]
    w = mask_or_img.shape[1]
    if u < 0 or u > 1 or v < 0 or v > 1:
        return None
    px = min(w - 1, max(0, int(u * w)))
    py = min(h - 1, max(0, int(v * h)))
    return mask_or_img[py, px]


def build_wheels():
    return [
        {'name': w['name'], 'x': w['sx'] * HALF_WIDTH, 'y': w['sy'] * HALF_LENGTH,
         'radius': w['radius'], 'width': w['width']}
        for w in WHEEL_DEFS
    ]


def near_wheel(x_world, y_world, wheels):
    for w in wheels:
        if (x_world - w['x']) ** 2 + (y_world - w['y']) ** 2 <= (w['radius'] * WHEEL_EXCLUDE_MARGIN) ** 2:
            return True
    return False


def merge_along_y(solid, nx, ny, nz):
    cell_w = 2 * HALF_WIDTH / nx
    cell_l = 2 * HALF_LENGTH / ny
    cell_h = HEIGHT_MAX / nz
    boxes = []
    for ix in range(nx):
        for iz in range(nz):
            iy = 0
            while iy < ny:
                cat = solid.get((ix, iy, iz))
                if cat is None:
                    iy += 1
                    continue
                run_start = iy
                while iy < ny and solid.get((ix, iy, iz)) == cat:
                    iy += 1
                run_end = iy
                y0 = HALF_LENGTH - run_start * cell_l
                y1 = HALF_LENGTH - run_end * cell_l
                x_c = HALF_WIDTH * (2 * (ix + 0.5) / nx - 1)
                z_c = HEIGHT_MAX * (1 - (iz + 0.5) / nz)
                boxes.append({
                    'category': cat,
                    'center': [x_c, (y0 + y1) / 2, z_c],
                    'size':   [cell_w, abs(y0 - y1), cell_h],
                })
    return boxes


def carve():
    crops, bg = load_crops()
    hull = {name: segment_hull(crop, bg) for name, crop in crops.items()}

    top_color = crops['top']
    wheel_defs = build_wheels()

    solid = {}
    for ix in range(GRID_NX):
        u_width = (ix + 0.5) / GRID_NX
        x_world = HALF_WIDTH * (2 * u_width - 1)
        for iy in range(GRID_NY):
            u_len = (iy + 0.5) / GRID_NY
            y_world = HALF_LENGTH * (1 - 2 * u_len)
            if near_wheel(x_world, y_world, wheel_defs):
                continue
            top_hit = sample(hull['top'], u_len, u_width)
            if not top_hit:
                continue
            front_or_rear = 'front' if y_world >= 0 else 'rear'
            for iz in range(GRID_NZ):
                v_height = (iz + 0.5) / GRID_NZ
                side_hit = sample(hull['side'], u_len, v_height)
                fr_hit = sample(hull[front_or_rear], u_width, v_height)
                if side_hit and fr_hit:
                    row = min(top_color.shape[0] - 1, int(u_width * top_color.shape[0]))
                    col = min(top_color.shape[1] - 1, int(u_len * top_color.shape[1]))
                    color = top_color[row, col]
                    solid[(ix, iy, iz)] = classify_color(color)

    boxes = merge_along_y(solid, GRID_NX, GRID_NY, GRID_NZ)
    return boxes, wheel_defs


if __name__ == '__main__':
    boxes, wheels = carve()
    data = {
        'half_width': HALF_WIDTH, 'half_length': HALF_LENGTH, 'height_max': HEIGHT_MAX,
        'palette': PALETTE_MATERIAL_COLOR,
        'boxes': boxes,
        'wheels': wheels,
    }
    with open(OUT_PATH, 'w') as f:
        json.dump(data, f, indent=1)
    print(f'[f1CarVoxelize] {len(boxes)} box, {len(wheels)} ruote -> {OUT_PATH}')
```

- [x] **Step 2: Copiare il riferimento nel repo**

```bash
mkdir -p backend/tools/reference
cp "<path fornito dall'utente>" backend/tools/reference/f1-car-turnaround.png
```

Fatto con il file fornito dall'utente
(`ChatGPT Image 24 lug 2026, 18_18_48.png`, foglio a 4 viste + 2 render
prospettici).

- [x] **Step 3: Eseguire ed verificare l'output**

Run: `python3 backend/tools/f1CarVoxelize.py`

Output ottenuto:
```
[f1CarVoxelize] 1073 box, 4 ruote -> backend/tools/f1CarVoxelData.json
```
Verificato anche con una rasterizzazione dall'alto di controllo (script
usa-e-getta, non nel repo): la sagoma scavata è riconoscibile come auto a
ruote scoperte (muso/ala stretti da un lato, corpo/cockpit più largo
verso il centro, ruote alle 4 posizioni attese).

Se rieseguito e il conteggio box risultasse molto diverso (es. <100 o
>5000) o lo script sollevasse un'eccezione, è segno che le bounding box
delle viste (`VIEW_BOXES`) non combaciano più col file di riferimento
(es. sostituito con un'immagine diversa) — vanno ricalcolate.

---

## Task 2: Stadio 2 — costruzione mesh, export GLB, render (Blender)

**Files:**
- Create: `backend/tools/f1CarBuilder.py` — **già creato ed eseguito con successo**
- Create (output, via script): `frontend/assets/custom/f1Car.glb` — **già generato**
- Create (output, via script): `backend/tools/renders/f1-car-3q.png`,
  `backend/tools/renders/f1-car-cockpit.png` — **già generati**

**Interfaces:**
- Consumes: `backend/tools/f1CarVoxelData.json` (Task 1).
- Produces: `frontend/assets/custom/f1Car.glb` — 16 nodi: 4 mesh scocca
  unite per categoria (`body_livery`, `body_trim`, `body_accent`,
  `body_trim_light`) + 4 gruppi ruota (`wheelHub_FL/FR/RL/RR`, ciascuno
  Empty padre con mesh figlie `..._tire_wheel` e `..._rim`, verificato che
  "wheel" compaia nel nome). Usato dal Task 3 per il path in `loadCarModel()`.

- [x] **Step 1: Scrivere lo script di costruzione/export/render**

Contenuto attuale di `backend/tools/f1CarBuilder.py` (validato, vedi Step 2):

```python
"""
Stadio 2 della pipeline "scultura per silhouette": legge
backend/tools/f1CarVoxelData.json (scritto da f1CarVoxelize.py, Stadio 1)
e costruisce/esporta il modello auto per la visuale cockpit del gioco F1.

Uso (da qualunque cartella):
    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --python backend/tools/f1CarBuilder.py

Output:
    frontend/assets/custom/f1Car.glb
    backend/tools/renders/f1-car-3q.png       (vista 3/4 esterna)
    backend/tools/renders/f1-car-cockpit.png  (vista dal punto pilota)
"""
import bpy
import json
import math
import os
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT  = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
DATA_PATH  = os.path.join(SCRIPT_DIR, 'f1CarVoxelData.json')
GLB_OUT    = os.path.join(REPO_ROOT, 'frontend', 'assets', 'custom', 'f1Car.glb')
RENDER_DIR = os.path.join(SCRIPT_DIR, 'renders')
os.makedirs(os.path.dirname(GLB_OUT), exist_ok=True)
os.makedirs(RENDER_DIR, exist_ok=True)

car_objects = []


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def make_material(name, rgb, roughness=0.5, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return mat


def add_box(name, mat, dims, center):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    bpy.ops.object.shade_flat()
    return obj


def add_wheel(prefix, x, y, radius, width, mat_tire, mat_rim):
    hub = bpy.data.objects.new(prefix, None)
    bpy.context.collection.objects.link(hub)
    hub.location = (x, y, radius)
    car_objects.append(hub)

    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=radius, depth=width,
                                         location=(0, 0, 0), rotation=(0, math.radians(90), 0))
    tire = bpy.context.active_object
    tire.name = prefix + '_tire_wheel'
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    tire.data.materials.append(mat_tire)
    bpy.ops.object.shade_flat()
    tire.parent = hub
    tire.location = (0, 0, 0)
    car_objects.append(tire)

    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=radius * 0.55, depth=width * 1.02,
                                         location=(0, 0, 0), rotation=(0, math.radians(90), 0))
    rim = bpy.context.active_object
    rim.name = prefix + '_rim'
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    rim.data.materials.append(mat_rim)
    bpy.ops.object.shade_flat()
    rim.parent = hub
    rim.location = (0, 0, 0)
    car_objects.append(rim)


def point_camera(cam, target):
    direction = Vector(target) - cam.location
    rot_quat = direction.to_track_quat('-Z', 'Y')
    cam.rotation_euler = rot_quat.to_euler()


def build_body(data):
    materials = {}
    for cat, rgb in data['palette'].items():
        materials[cat] = make_material(f'body_{cat}', tuple(rgb), roughness=0.4, metallic=0.25)

    by_category = {cat: [] for cat in materials}
    for i, b in enumerate(data['boxes']):
        cat = b['category']
        obj = add_box(f'vox_{cat}_{i}', materials[cat], b['size'], b['center'])
        by_category[cat].append(obj)

    for cat, objs in by_category.items():
        if not objs:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        merged = bpy.context.active_object
        merged.name = f'body_{cat}'
        car_objects.append(merged)


def build_wheels(data):
    mat_tire = make_material('tire', (0.03, 0.03, 0.03), roughness=0.9)
    mat_rim  = make_material('rim',  (0.55, 0.55, 0.58), roughness=0.3, metallic=0.7)
    for w in data['wheels']:
        add_wheel(w['name'], w['x'], w['y'], w['radius'], w['width'], mat_tire, mat_rim)


def setup_preview_scene():
    bpy.ops.mesh.primitive_plane_add(size=10, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = 'preview_ground'
    ground_mat = make_material('preview_ground_mat', (0.5, 0.52, 0.55), roughness=0.8)
    ground.data.materials.append(ground_mat)

    sun = bpy.data.lights.new('sun', type='SUN')
    sun.energy = 3.0
    sun_obj = bpy.data.objects.new('sun', sun)
    bpy.context.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(55), 0, math.radians(35))

    bpy.context.scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.6, 0.68, 1)

    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.samples = 32
    bpy.context.scene.render.resolution_x = 960
    bpy.context.scene.render.resolution_y = 540
    bpy.context.scene.render.image_settings.file_format = 'PNG'


def render_to(filename, cam_location, cam_target):
    cam_data = bpy.data.cameras.new(f'cam_{filename}')
    cam_obj = bpy.data.objects.new(f'cam_{filename}', cam_data)
    bpy.context.collection.objects.link(cam_obj)
    cam_obj.location = cam_location
    point_camera(cam_obj, cam_target)

    scene = bpy.context.scene
    scene.camera = cam_obj
    scene.render.filepath = os.path.join(RENDER_DIR, filename)
    bpy.ops.render.render(write_still=True)


def export_glb():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in car_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = car_objects[0]
    bpy.ops.export_scene.gltf(filepath=GLB_OUT, export_format='GLB', use_selection=True)


with open(DATA_PATH) as f:
    data = json.load(f)

clear_scene()
build_body(data)
build_wheels(data)
export_glb()

setup_preview_scene()
render_to('f1-car-3q.png',      (1.1, -1.3, 0.55), (0, -0.05, 0.15))
render_to('f1-car-cockpit.png', (0, -0.08, 0.24),  (0, 0.6, 0.15))

print('[f1CarBuilder] Nodi esportati nel GLB:', len(car_objects))
for obj in car_objects:
    print(f'  - {obj.name} ({obj.type})')
print(f'[f1CarBuilder] GLB: {GLB_OUT}')
print(f'[f1CarBuilder] Render: {RENDER_DIR}')
```

Nota sulla camera di anteprima cockpit: la prima posizione provata
(z=0.30, target 1.5 unità avanti) risultava sopra/oltre il modello e dava
un render vuoto; corretta osservando l'ingombro reale del JSON scavato
(altezza max ≈0.2175) a `(0, -0.08, 0.24)` con target `(0, 0.6, 0.15)` —
è una camera di **anteprima per il gate di approvazione**, non la camera
di gioco (quella è il sotto-progetto B, tarata quando il modello finale
sarà fissato).

- [x] **Step 2: Eseguire e verificare l'output**

Run:
```
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --python "backend/tools/f1CarBuilder.py"
```
Expected/ottenuto: nessun traceback; log finale con 16 nodi, inclusi
`wheelHub_FL_tire_wheel`, `wheelHub_FR_tire_wheel`, `wheelHub_RL_tire_wheel`,
`wheelHub_RR_tire_wheel` (tutti con "wheel" nel nome, requisito di
`frontend/f1.js:331-334`); file generati:
`frontend/assets/custom/f1Car.glb`, `backend/tools/renders/f1-car-3q.png`,
`backend/tools/renders/f1-car-cockpit.png`.

- [x] **Step 3: Guardare i render**

Vista 3/4 esterna: sagoma voxel riconoscibile come auto a ruote scoperte —
corpo centrale, muso/ala più stretti verso un'estremità, 4 ruote alle
posizioni attese. Più "chunky"/grezza del riferimento (come atteso, vedi
spec — nessuna segmentazione fine di dettagli come specchietti/endplate,
alcuni frammenti sparsi vicino al muso dal rumore nell'immagine sorgente)
e ruote non ancora ben integrate visivamente col corpo (gap visibile).
Vista cockpit: inquadratura di anteprima grezza (blocchi ravvicinati),
utile solo a confermare che la scala/altezza sono nell'ordine di
grandezza giusto, non rappresentativa della camera di gioco finale.

- [ ] **Step 4: Mostrare i render all'utente e iterare se richiesto**

Apri (Read tool) `backend/tools/renders/f1-car-3q.png` e
`backend/tools/renders/f1-car-cockpit.png` e mostrali all'utente.
**Non proseguire al Task 3 finché l'utente non approva esplicitamente.**
Se chiede modifiche, i punti di intervento più efficaci sono in
`f1CarVoxelize.py` (Task 1): `GRID_NX/NY/NZ` per la risoluzione,
`NOISE_AREA_FRAC` per ripulire frammenti sparsi, `WHEEL_DEFS`/
`WHEEL_EXCLUDE_MARGIN` per la geometria/posizione ruote, `classify_color`
per la palette — poi ri-lanciare Stadio 1 e Stadio 2 in sequenza.

---

## Task 3: Collegare il modello dell'utente a `loadCarModel()` (AGGIORNATO)

**Precondizione:** nessuna — questo task usa direttamente il modello
fornito dall'utente, non l'output della pipeline di scultura.

**Files:**
- Create: `frontend/assets/custom/f1Car.glb` — **fatto**, copiato da
  `C:\Users\pacia\Desktop\f1 car model.glb`
- Modify: `frontend/f1.js` (path del loader + ricolore per texture-palette
  + condizione ruote sintetiche) — **fatto**

**Interfaces:**
- Consumes: `frontend/assets/custom/f1Car.glb` — mesh unica (`model`),
  1 materiale con `baseColorTexture` (palette 256×1px, 128 colori usati),
  nessuna mesh ruota separata.
- Produces: nessuna nuova interfaccia — `loadCarModel()` mantiene la stessa
  firma (`playerColor, onReady`) usata da tutti i chiamanti esistenti
  (`frontend/f1.js:782,792,827`).

- [x] **Step 1: Cambiare il path del modello**

`loader.load('/assets/kenney/raceCarWhite.glb', ...)` → `loader.load('/assets/custom/f1Car.glb', ...)`.

- [x] **Step 1b: Ricolore per texture-palette invece che per material.color**

Aggiunte `rgbToHsv`/`hsvToRgb`/`recolorLiveryTexture` (prima di
`loadCarModel`, ~righe 295-370 di `frontend/f1.js`): per ogni mesh con
`material.map` (texture), si ridisegna la palette sorgente su un canvas
sostituendo solo i texel rosso/arancio (hue ≤45°, saturazione ≥0.2 — fascia
misurata sulla palette reale del modello, separata nettamente dai toni
scuri/verdi/blu di luce ambientale rimbalzata) con la stessa
luminosità/saturazione ma tonalità del colore giocatore; il risultato
diventa una `THREE.CanvasTexture` (stessi wrap/filter/encoding
dell'originale) assegnata al materiale clonato. Se un mesh non ha
texture (es. eventuali modelli futuri a tinta unita), resta il vecchio
comportamento "quasi-bianco → hex team".

Aggiunta anche la condizione `allMeshes.length > 1` al fallback delle
ruote sintetiche (`frontend/f1.js`, blocco "Fallback finale: ruote
cilindriche sintetiche") — su una mesh voxel unica come questo modello
(`allMeshes.length === 1`) non vengono più aggiunti cilindri scoordinati:
le ruote sono già disegnate nel modello stesso (statiche, come da
conferma dell'utente sul comportamento già presente in produzione).

- [x] **Step 2: Avviare il server e verificare in console**

Run (da `backend/`): `node server.js`, poi apri `localhost:3000` in due
tab, unisciti a una partita fino alla fase di qualifica/gara.

Expected in console browser (F12): nessun errore di caricamento GLTF; il
log esistente `[F1] Mesh nel modello:` (già presente, `frontend/f1.js:337`)
elenca le mesh del nuovo modello, incluse quelle ruota.

- [x] **Step 3: Verifica visiva in localhost (utente)**

In gioco, verifica che:
- l'auto in terza persona mostri il nuovo modello voxel invece del kart Kenney;
- il colore della carrozzeria (categoria `livery`) sia tinto col colore
  assegnato al giocatore (il ricolore a runtime su
  `frontend/f1.js:324-329` continua a funzionare perché quella categoria è
  quasi-bianca);
- le ruote girino visivamente in movimento (nessuna ruota "congelata" o
  fluttuante staccata dal corpo);
- premendo **C** la visuale cambi ancora — camera cockpit halo-cam tarata
  e confermata OK dall'utente (vedi nota di chiusura in cima al file).

Questo è il punto di verifica dell'utente richiesto dalla convenzione di
progetto prima di proseguire. **Verificato — piano chiuso.**

Nessun commit: per convenzione di progetto committa/pusha solo l'utente,
quando vuole (vedi `CLAUDE.md`).
