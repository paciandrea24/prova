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
