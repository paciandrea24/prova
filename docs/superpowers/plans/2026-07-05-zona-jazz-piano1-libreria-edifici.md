# Zona Jazz — Piano ①: Libreria + generatore + edifici 02-10 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estrarre gli helper Blender validati in `jazz_lib.py`, costruirci sopra il
generatore parametrico `build_edificio()`, e produrre le ricette degli edifici 02-10
con varianti (~15-18 GLB) per il Quartiere Jazz.

**Architecture:** Una libreria condivisa (`jazz_lib.py`) con gli helper già validati
dall'edificio 13 + palette + generatore; ogni edificio unico è un file "ricetta" corto
che chiama `build_edificio()` con parametri e aggiunge dettagli custom, esporta il GLB
e renderizza anteprime. Iterazione: headless → render → confronto visivo → correzione.

**Tech Stack:** Blender 5.1.2 headless (`C:\Program Files\Blender Foundation\Blender 5.1\blender.exe`),
Python `bpy`/`bmesh`/`mathutils`. Nessuna modifica al gioco.

## Global Constraints

- **NIENTE COMMIT**: mai `git add`/`git commit`/`git push`, nemmeno nel worktree — committa SOLO l'utente.
- Worktree: tutto in `C:\Users\pacia\Desktop\Claude Workspace\prova\.claude\worktrees\fps-mappa-blender-jazz`.
- Script in `docs/superpowers/plans/blender-scripts/` (worktree); ricette in sottocartella `edifici/`.
- GLB in `frontend/assets/models/jazz/` (worktree); anteprime PNG in `blender-scripts/preview/` (MAI da committare).
- 1 unità = 1 metro; base edificio a z=0; fronte verso -Y.
- SOLO colori piatti: Principled Base Color + `mat.diffuse_color` allineato (anteprime Workbench).
- `primitive_cube_add(size=2)` SEMPRE (con size=1 i box vengono a metà dimensione — bug già pagato).
- Vetri SEMPRE in aggetto sui telai (~2cm oltre la faccia frontale del telaio, mai annegati nel box).
- NIENTE facce complanari tra mesh sovrapposte: rientri/rialzi di 1-2cm (z-fighting).
- Shade Smooth su ogni mesh; bevel 0.015-0.03 sui box.
- Mesh collisione `COL_corpo` rientrata 2cm e base a z=0.01.
- Insegne in INGLESE; commenti del codice in ITALIANO.
- Verifica di ogni task: esecuzione headless senza Traceback + lettura render con tool Read.
- Comando headless (usato in ogni task, cambia solo lo script):
  `& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python "<script>"`.

---

## Task 1: `jazz_lib.py` — estrazione helper + palette + export/preview parametrici

**Files:**
- Create: `docs/superpowers/plans/blender-scripts/jazz_lib.py` (worktree)
- Create: `docs/superpowers/plans/blender-scripts/test_lib.py` (worktree, smoke test)
- Reference: `docs/superpowers/plans/blender-scripts/edificio-jazz.py` (worktree, sorgente degli helper)

**Interfaces:**
- Consumes: le funzioni esistenti in `edificio-jazz.py` (copiate VERBATIM, sono validate)
- Produces (usate da TUTTI i task successivi):
  - `clear_scene()`, `flat_material(name, rgba)`, `lathe_profile(name, points, material, segments=32)`,
    `skin_chain(name, spine_points, radii, material, subsurf_levels=2)`,
    `add_box(name, w, d, h, x, y, z, material, bevel=0.02)`,
    `add_box_c(name, w, d, h, x, y, z, material, rot=(0,0,0), bevel=0.02)`,
    `add_cyl(name, r, h, x, y, z, material, vertices=16)`, `add_sphere(name, radius, x, y, z, material)`,
    `add_strut(name, p1, p2, r, material, vertices=8)`,
    `add_text_mesh(name, body, size, x, y, z, material, extrude=0.03)` — firme IDENTICHE a `edificio-jazz.py`
  - `PALETTES: dict` — chiavi `'rosso'|'bruno'|'ocra'|'oliva'|'crema'`
  - `make_materials(palette='rosso') -> dict` — chiavi: `muro, mattone_chiaro, cornice, legno,
    legno_chiaro, vetro, ferro, tenda_a, tenda_b, scuro, oro, coppi, tetto_serb, insegna, insegna_testo`
  - `export_glb(nome_file)` — esporta in `MODELS_DIR/<nome_file>` (crea la cartella)
  - `render_previews(prefisso, ortho_scale=15.0, alt_front=6.2, quarter_pos=(14,-15,9), quarter_target_z=5.0)`
    — scrive `PREVIEW_DIR/<prefisso>_front.png` e `<prefisso>_quarter.png`
  - costanti `WORKTREE`, `MODELS_DIR`, `PREVIEW_DIR`, `BLENDER_EXE` (stringa doc del comando)

- [ ] **Step 1: Crea `jazz_lib.py`**

Struttura del file (le funzioni marcate *(verbatim)* si copiano IDENTICHE da
`edificio-jazz.py`, che è già validato — non riscriverle a memoria):

```python
# jazz_lib.py — libreria condivisa Quartiere Jazz (helper validati dall'edificio 13)
# Le ricette la importano con:
#   import sys; sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
#   import jazz_lib as jl
import bpy
import bmesh
import math
import os
import random
import zlib
from mathutils import Vector

WORKTREE = "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz"
MODELS_DIR = WORKTREE + "/frontend/assets/models/jazz"
PREVIEW_DIR = WORKTREE + "/docs/superpowers/plans/blender-scripts/preview"

# --- helper geometrici (verbatim da edificio-jazz.py) ---
# clear_scene, flat_material (CON mat.diffuse_color = rgba),
# lathe_profile, skin_chain, _finish_box, add_box (size=2!), add_box_c (size=2!),
# add_cyl, add_sphere, add_strut, add_text_mesh

# --- palette dall'immagine di riferimento ---
# ogni palette: colore muro, mattoni chiari (toppe), cornici/davanzali
PALETTES = {
    'rosso': {'muro': (0.45, 0.13, 0.11, 1.0), 'chiaro': (0.60, 0.28, 0.22, 1.0), 'cornice': (0.85, 0.80, 0.70, 1.0)},
    'bruno': {'muro': (0.36, 0.22, 0.16, 1.0), 'chiaro': (0.48, 0.33, 0.24, 1.0), 'cornice': (0.80, 0.74, 0.62, 1.0)},
    'ocra':  {'muro': (0.70, 0.50, 0.22, 1.0), 'chiaro': (0.79, 0.62, 0.33, 1.0), 'cornice': (0.88, 0.82, 0.70, 1.0)},
    'oliva': {'muro': (0.33, 0.36, 0.21, 1.0), 'chiaro': (0.43, 0.46, 0.29, 1.0), 'cornice': (0.84, 0.79, 0.66, 1.0)},
    'crema': {'muro': (0.80, 0.72, 0.56, 1.0), 'chiaro': (0.86, 0.79, 0.65, 1.0), 'cornice': (0.50, 0.20, 0.16, 1.0)},
}


def make_materials(palette='rosso'):
    # Materiali per un edificio: 3 dalla palette + standard condivisi
    p = PALETTES[palette]
    return {
        'muro':           flat_material("muro",            p['muro']),
        'mattone_chiaro': flat_material("mattone_chiaro",  p['chiaro']),
        'cornice':        flat_material("cornice",         p['cornice']),
        'legno':          flat_material("legno_scuro",     (0.35, 0.20, 0.10, 1.0)),
        'legno_chiaro':   flat_material("legno_chiaro",    (0.52, 0.33, 0.17, 1.0)),
        'vetro':          flat_material("vetro_blu",       (0.16, 0.20, 0.28, 1.0)),
        'ferro':          flat_material("ferro_ruggine",   (0.23, 0.12, 0.08, 1.0)),
        'tenda_a':        flat_material("tenda_a",         (0.62, 0.24, 0.20, 1.0)),
        'tenda_b':        flat_material("tenda_b",         (0.92, 0.88, 0.80, 1.0)),
        'scuro':          flat_material("inchiostro",      (0.10, 0.09, 0.09, 1.0)),
        'oro':            flat_material("oro",             (0.83, 0.62, 0.24, 1.0)),
        'coppi':          flat_material("coppi",           (0.55, 0.22, 0.14, 1.0)),
        'tetto_serb':     flat_material("tetto_ossidato",  (0.45, 0.48, 0.42, 1.0)),
        'insegna':        flat_material("insegna_fondo",   (0.83, 0.68, 0.28, 1.0)),
        'insegna_testo':  flat_material("insegna_testo",   (0.13, 0.11, 0.09, 1.0)),
    }


def rng_per(nome):
    # RNG deterministico per nome edificio (PYTHONHASHSEED cambia tra run,
    # quindi NIENTE hash(): crc32 e' stabile)
    return random.Random(zlib.crc32(nome.encode()))


def export_glb(nome_file):
    os.makedirs(MODELS_DIR, exist_ok=True)
    path = MODELS_DIR + "/" + nome_file
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB')
    print("Esportato:", path)


def render_previews(prefisso, ortho_scale=15.0, alt_front=6.2,
                    quarter_pos=(14, -15, 9), quarter_target_z=5.0):
    # Identica a render_previews() di edificio-jazz.py (Workbench FLAT/MATERIAL,
    # 900x1200) ma con prefisso nei nomi file e camera parametrica.
    # front: camera orto a (0, -30, alt_front), ortho_scale dato
    # quarter: camera prospettica in quarter_pos, TRACK_TO empty a (0,0,quarter_target_z)
    # filepath: PREVIEW_DIR + "/" + prefisso + "_front.png" e "_quarter.png"
    ...
```

Copiare il corpo di `render_previews` da `edificio-jazz.py` sostituendo i due
`scene.render.filepath` con le versioni col prefisso e i valori camera con i parametri.

- [ ] **Step 2: Crea lo smoke test `test_lib.py`**

```python
# test_lib.py — smoke test della libreria: un box + una lathe + testo, export + render
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

jl.clear_scene()
mats = jl.make_materials('ocra')
jl.add_box("box_prova", 2, 2, 3, 0, 0, 0, mats['muro'])
jl.lathe_profile("vaso_prova", [(0.5, 0), (0.7, 0.5), (0.3, 1.2), (0.0, 1.2)], mats['cornice'])
jl.add_text_mesh("testo_prova", "TEST", 0.4, 0, -1.02, 1.5, mats['scuro'])
jl.export_glb("_test_lib.glb")
jl.render_previews("_test", ortho_scale=6.0, alt_front=1.5, quarter_pos=(5, -5, 4), quarter_target_z=1.5)
```

- [ ] **Step 3: Esegui headless e verifica**

Run: comando headless su `test_lib.py`.
Expected: `Esportato: .../_test_lib.glb`, nessun Traceback.

- [ ] **Step 4: Guarda i render**

Read di `preview/_test_front.png`: box ocra, vasetto crema, scritta "TEST" leggibile,
colori NON grigi (se grigio: manca `diffuse_color` in `flat_material`).

- [ ] **Step 5: Pulizia**

Cancella `frontend/assets/models/jazz/_test_lib.glb` e i PNG `_test_*` (artefatti di test).

---

## Task 2: `build_edificio()` — corpo, finestre, piano terra, tetto piatto/falda

**Files:**
- Modify: `docs/superpowers/plans/blender-scripts/jazz_lib.py` (append in fondo)
- Create: `docs/superpowers/plans/blender-scripts/test_generatore.py`

**Interfaces:**
- Consumes: tutti gli helper del Task 1
- Produces: `build_edificio(nome, **params) -> dict` con firma ESATTA:

```python
def build_edificio(nome, piani=3, larghezza=6.0, profondita=5.5, palette='rosso',
                   piano_terra='portone',      # 'portone'|'vetrina'|'doppia_vetrina'|'angolo'
                   tettoia=False,               # tettoia a righe sopra l'ingresso
                   scala='nessuna',             # 'fronte'|'laterale'|'nessuna' (Task 3)
                   tetto='piatto',              # 'piatto'|'falda_coppi'
                   props_tetto=(),              # iterabile: 'comignolo'|'serbatoio'|'cartellone'|'abbaino' (Task 3)
                   insegna=None,                # testo insegna orizzontale sopra il PT (Task 3)
                   insegna_verticale=None,      # testo insegna a bandiera (Task 3)
                   serbatoio_testo="45", cartellone_testo="JAZZ",  # testi props (Task 3)
                   h_pt=2.6, h_piano=2.4):
    # ritorna {'mats': dict, 'roof_z': float, 'front_y': float, 'corpo_h': float,
    #          'colonne': [x...], 'sills': [z...]}
```

- [ ] **Step 1: Aggiungi a `jazz_lib.py` il generatore (parte 1)**

```python
# ─────────────────────────────────────────────────────────────
# GENERATORE EDIFICI
# ─────────────────────────────────────────────────────────────

def _finestra(tag, cx, sill_z, wy, mats, larg=1.06, alt=1.46):
    # Finestra standard validata: telaio, vetro in aggetto, griglia, davanzale, cimasa
    add_box(f"fin_{tag}_telaio", larg, 0.14, alt, cx, wy, sill_z, mats['cornice'])
    add_box(f"fin_{tag}_vetro", larg - 0.20, 0.08, alt - 0.20, cx, wy - 0.05, sill_z + 0.10, mats['vetro'])
    add_box(f"fin_{tag}_traversa", larg - 0.20, 0.04, 0.06, cx, wy - 0.09, sill_z + alt / 2, mats['cornice'])
    add_box(f"fin_{tag}_montante", 0.06, 0.04, alt - 0.20, cx, wy - 0.09, sill_z + 0.10, mats['cornice'])
    add_box(f"fin_{tag}_davanzale", larg + 0.18, 0.26, 0.11, cx, wy - 0.06, sill_z - 0.11, mats['cornice'])
    add_box(f"fin_{tag}_cimasa", larg + 0.22, 0.24, 0.17, cx, wy - 0.06, sill_z + alt, mats['cornice'])


def _portone(cx, fy, mats, con_gradini=True):
    # Doppia anta in legno con pannelli e pomelli (dall'edificio 13)
    add_box("porta_cornice", 1.6, 0.18, 2.3, cx, fy, 0.01, mats['cornice'])
    add_box("porta_fondo", 1.3, 0.10, 2.15, cx, fy - 0.05, 0.02, mats['scuro'])
    for side, sx in (("L", cx - 0.33), ("R", cx + 0.33)):
        add_box(f"porta_anta_{side}", 0.58, 0.08, 2.05, sx, fy - 0.09, 0.02, mats['legno'])
        add_box(f"porta_pann_alto_{side}", 0.34, 0.03, 0.72, sx, fy - 0.14, 1.05, mats['legno_chiaro'])
        add_box(f"porta_pann_basso_{side}", 0.34, 0.03, 0.55, sx, fy - 0.14, 0.25, mats['legno_chiaro'])
    add_sphere("porta_pomello_L", 0.045, cx - 0.10, fy - 0.18, 1.05, mats['cornice'])
    add_sphere("porta_pomello_R", 0.045, cx + 0.10, fy - 0.18, 1.05, mats['cornice'])
    if con_gradini:
        add_box("gradino_basso", 1.9, 0.55, 0.16, cx, fy - 0.27, 0.01, mats['cornice'])
        add_box("gradino_alto", 1.6, 0.40, 0.30, cx, fy - 0.20, 0.02, mats['cornice'])


def _vetrina(tag, cx, fy, mats, larg=1.8):
    # Vetrina validata: cornice legno, vetro in aggetto, griglia, davanzale, cimasa
    add_box(f"vetrina_cornice_{tag}", larg, 0.16, 1.75, cx, fy, 0.5, mats['legno'])
    add_box(f"vetrina_vetro_{tag}", larg - 0.30, 0.10, 1.45, cx, fy - 0.05, 0.65, mats['vetro'])
    add_box(f"vetrina_traversa_{tag}", larg - 0.30, 0.05, 0.08, cx, fy - 0.09, 1.30, mats['legno'])
    add_box(f"vetrina_montante_{tag}", 0.08, 0.05, 1.45, cx, fy - 0.09, 0.65, mats['legno'])
    add_box(f"vetrina_davanzale_{tag}", larg + 0.15, 0.28, 0.12, cx, fy - 0.10, 0.42, mats['cornice'])
    add_box(f"vetrina_cimasa_{tag}", larg + 0.15, 0.22, 0.15, cx, fy - 0.10, 2.22, mats['legno'])


def _tettoia_righe(cx, fy, z_attacco, mats, larg=1.9):
    # Tettoia a righe alternate (falde inclinate + lembi pendenti), dall'edificio 13
    n_slats = 7
    tilt = math.radians(-24)
    for i in range(n_slats):
        sx = cx - larg / 2 + larg / n_slats * (i + 0.5)
        mat = mats['tenda_a'] if i % 2 == 0 else mats['tenda_b']
        add_box_c(f"tenda_falda_{i}", larg / n_slats + 0.01, 1.05, 0.06,
                  sx, fy - 0.48, z_attacco - 0.21, mat, rot=(tilt, 0, 0), bevel=0.01)
        add_box_c(f"tenda_lembo_{i}", larg / n_slats + 0.01, 0.06, 0.22,
                  sx, fy - 0.95, z_attacco - 0.34, mat, bevel=0.01)


def _tetto_piatto(larghezza, profondita, corpo_h, mats):
    # Cornicione a mensole + lastra tetto in rilievo (quote dall'edificio 13, scalate)
    add_box("cornicione_gola", larghezza + 0.55, profondita + 0.55, 0.10, 0, 0, corpo_h - 0.10, mats['cornice'])
    add_box("cornicione_fascia", larghezza + 0.9, profondita + 0.9, 0.34, 0, 0, corpo_h, mats['cornice'])
    add_box("cornicione_corona", larghezza + 1.15, profondita + 1.15, 0.16, 0, 0, corpo_h + 0.34, mats['cornice'])
    n_mens = max(3, int(larghezza / 0.9))
    for mi in range(n_mens):
        mx = -larghezza / 2 + 0.35 + (larghezza - 0.7) * mi / (n_mens - 1)
        add_box(f"mensola_f_{mi}", 0.22, 0.30, 0.30, mx, -profondita / 2 - 0.30, corpo_h - 0.30, mats['cornice'])
    for ai, ax in enumerate((-larghezza / 2 - 0.05, larghezza / 2 + 0.05)):
        add_box(f"mensola_ang_{ai}", 0.34, 0.34, 0.42, ax, -profondita / 2 - 0.30, corpo_h - 0.40, mats['cornice'])
    add_box("tetto", larghezza - 0.2, profondita - 0.2, 0.14, 0, 0, corpo_h + 0.38, mats['scuro'])
    return corpo_h + 0.52   # roof_z: quota di appoggio per i props tetto


def _tetto_falda(larghezza, profondita, corpo_h, mats):
    # Falda a due spioventi in coppi + timpani + colmo + listelli in rilievo
    colmo_h = 1.6
    half = profondita / 2
    ang = math.atan2(colmo_h, half)
    falda_len = math.hypot(half, colmo_h) + 0.35
    for segno, tag in ((-1, "fronte"), (1, "retro")):
        add_box_c(f"falda_{tag}", larghezza + 0.5, falda_len, 0.12,
                  0, segno * half / 2, corpo_h + colmo_h / 2, mats['coppi'],
                  rot=(segno * ang, 0, 0), bevel=0.015)
        for li in range(3):
            t = (li + 1) / 4.0
            add_box_c(f"listello_{tag}_{li}", larghezza + 0.54, 0.10, 0.06,
                      0, segno * (half * (1 - t)), corpo_h + colmo_h * t + 0.07, mats['ferro'],
                      rot=(segno * ang, 0, 0), bevel=0.01)
    for segno, tag in ((-1, "sx"), (1, "dx")):
        # Timpano: muro triangolare approssimato a 3 gradoni (stile boxy)
        for gi, (gw, gh) in enumerate(((0.8, 0.50), (0.55, 0.50), (0.30, 0.45))):
            add_box(f"timpano_{tag}_{gi}", 0.25, profondita * gw, colmo_h * gh * 0.7,
                    segno * (larghezza / 2 - 0.13), 0, corpo_h + colmo_h * 0.55 * gi / 2, mats['muro'])
    add_cyl("colmo", 0.10, larghezza + 0.5, 0, 0, corpo_h + colmo_h - 0.02, mats['coppi'])
    colmo = bpy.context.object
    colmo.rotation_euler = (0, math.radians(90), 0)
    colmo.location = (0, 0, corpo_h + colmo_h)
    return corpo_h + 0.10   # roof_z (per eventuali comignoli sul bordo)
```

- [ ] **Step 2: Aggiungi il corpo principale di `build_edificio()`**

```python
def build_edificio(nome, piani=3, larghezza=6.0, profondita=5.5, palette='rosso',
                   piano_terra='portone', tettoia=False, scala='nessuna',
                   tetto='piatto', props_tetto=(), insegna=None,
                   insegna_verticale=None, serbatoio_testo="45",
                   cartellone_testo="JAZZ", h_pt=2.6, h_piano=2.4):
    mats = make_materials(palette)
    rnd = rng_per(nome)
    corpo_h = h_pt + (piani - 1) * h_piano
    fy = -profondita / 2          # filo facciata

    # ── Corpo, zoccolo, marcapiano, toppe mattoni ──
    add_box("corpo", larghezza, profondita, corpo_h, 0, 0, 0.02, mats['muro'], bevel=0.03)
    add_box("zoccolo", larghezza + 0.2, profondita + 0.2, 0.4, 0, 0, 0.0, mats['cornice'])
    add_box("fascia_pt", larghezza + 0.15, profondita + 0.15, 0.18, 0, 0, h_pt - 0.05, mats['cornice'])
    n_toppe = int(larghezza * corpo_h / 5)
    for i in range(n_toppe):
        bx = rnd.uniform(-larghezza / 2 + 0.4, larghezza / 2 - 0.4)
        bz = rnd.uniform(h_pt + 0.5, corpo_h - 0.6)
        add_box(f"mattone_{i}", 0.42, 0.06, 0.16, bx, fy, bz, mats['mattone_chiaro'], bevel=0.015)

    # ── Colonne di finestre sui piani superiori ──
    n_col = max(1, int(larghezza // 1.9))
    passo = larghezza / n_col
    colonne = [-larghezza / 2 + passo * (i + 0.5) for i in range(n_col)]
    sills = []
    for p in range(1, piani):
        sill_z = h_pt + (p - 1) * h_piano + 0.4
        sills.append(sill_z)
        for ci, cx in enumerate(colonne):
            _finestra(f"p{p}_{ci}", cx, sill_z, fy, mats)

    # ── Piano terra ──
    if piano_terra == 'portone':
        _portone(0, fy, mats)
        if larghezza >= 5.0:
            off = larghezza / 2 - 1.15
            _vetrina("L", -off, fy, mats)
            _vetrina("R", off, fy, mats)
    elif piano_terra == 'vetrina':
        _vetrina("C", -larghezza / 4 + 0.2, fy, mats, larg=min(2.4, larghezza / 2))
        _portone(larghezza / 4 + 0.3, fy, mats, con_gradini=False)
    elif piano_terra == 'doppia_vetrina':
        off = larghezza / 2 - 1.15
        _vetrina("L", -off, fy, mats)
        _vetrina("R", off, fy, mats)
        _portone(0, fy, mats)
    elif piano_terra == 'angolo':
        # Smusso d'angolo fronte-destra con ingresso (pannello a 45 gradi)
        cx, cy = larghezza / 2 - 0.55, fy + 0.55
        add_box_c("angolo_pannello", 1.8, 0.25, corpo_h, cx, cy, corpo_h / 2 + 0.02,
                  mats['muro'], rot=(0, 0, math.radians(45)), bevel=0.03)
        add_box_c("angolo_zoccolo", 1.95, 0.30, 0.4, cx, cy, 0.21, mats['cornice'],
                  rot=(0, 0, math.radians(45)))
        n = Vector((0.7071, -0.7071, 0))
        pc = Vector((cx, cy, 0)) + n * 0.14
        add_box_c("angolo_porta", 1.1, 0.08, 2.2, pc.x, pc.y, 1.12, mats['legno'],
                  rot=(0, 0, math.radians(45)))
        pp = Vector((cx, cy, 0)) + n * 0.20
        add_sphere("angolo_pomello", 0.045, pp.x - 0.15 * 0.7071, pp.y - 0.15 * -0.7071, 1.05, mats['cornice'])
        if larghezza >= 5.0:
            _vetrina("L", -larghezza / 2 + 1.3, fy, mats)

    # ── Tettoia a righe ──
    if tettoia:
        _tettoia_righe(0, fy, h_pt + 0.02, mats)

    # ── Tetto ──
    if tetto == 'piatto':
        roof_z = _tetto_piatto(larghezza, profondita, corpo_h, mats)
    else:
        roof_z = _tetto_falda(larghezza, profondita, corpo_h, mats)

    # ── Collisione (rientrata 2cm, base a 0.01 — anti z-fighting) ──
    add_box("COL_corpo", larghezza - 0.04, profondita - 0.04, corpo_h - 0.02,
            0, 0, 0.01, mats['scuro'], bevel=0)

    return {'mats': mats, 'roof_z': roof_z, 'front_y': fy, 'corpo_h': corpo_h,
            'colonne': colonne, 'sills': sills}
```

NOTA: `scala`, `props_tetto`, `insegna`, `insegna_verticale` vengono implementati nel
Task 3 — per ora `build_edificio` li ACCETTA ma li ignora (nessun errore se passati).

- [ ] **Step 3: Crea `test_generatore.py` — 3 edifici campione affiancati**

```python
# test_generatore.py — 3 edifici base per validare il generatore
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import bpy
import jazz_lib as jl

jl.clear_scene()
# NB: un edificio per scena e' la norma (una ricetta = un GLB); qui 3 nella
# stessa scena SOLO per il confronto visivo, spostando gli oggetti dopo la build.
for params, dx in (
    (dict(piani=3, larghezza=6.0, palette='rosso', piano_terra='portone', tettoia=True), -8.5),
    (dict(piani=4, larghezza=3.2, profondita=4.5, palette='ocra', piano_terra='vetrina'), 0.0),
    (dict(piani=2, larghezza=7.0, profondita=6.0, palette='oliva', piano_terra='angolo', tetto='falda_coppi'), 8.0),
):
    prima = set(bpy.data.objects)
    jl.build_edificio("test", **params)
    for obj in set(bpy.data.objects) - prima:
        obj.location.x += dx
jl.render_previews("_gen", ortho_scale=26.0, alt_front=5.5, quarter_pos=(20, -22, 13), quarter_target_z=5.0)
```

- [ ] **Step 4: Esegui headless e guarda i render**

Run: comando headless su `test_generatore.py`. Expected: nessun Traceback.
Read di `_gen_front.png` e `_gen_quarter.png`. Checklist:
- 3 edifici con palette diverse, altezze/larghezze diverse
- finestre allineate in colonne, vetri visibili (blu), MAI annegati
- edificio stretto: 1 colonna di finestre; largo: 3
- angolare: pannello a 45° con porta visibile dalla vista quarter
- falda coppi: spioventi rossi + timpani + colmo, niente buchi vistosi agli angoli
- niente z-fighting, niente elementi fluttuanti
Correggi `jazz_lib.py` e riesegui finché la checklist passa.

---

## Task 3: `build_edificio()` — scala antincendio, props tetto, insegne

**Files:**
- Modify: `docs/superpowers/plans/blender-scripts/jazz_lib.py`
- Modify: `docs/superpowers/plans/blender-scripts/test_generatore.py`

**Interfaces:**
- Consumes: Task 1 + 2
- Produces: gli argomenti `scala`, `props_tetto`, `insegna`, `insegna_verticale`,
  `serbatoio_testo`, `cartellone_testo` di `build_edificio` diventano FUNZIONANTI.
  Inoltre le funzioni riusabili: `_scala_fronte(mats, fy, sills, h_piano)`,
  `_scala_laterale(mats, x_lato, z1, z2)`, `_serbatoio(mats, tank_x, tank_y, roof_z, testo)`,
  `_comignolo(mats, cmx, cmy, roof_z)`, `_cartellone(mats, roof_z, larghezza, testo)`,
  `_abbaino(mats, ax, corpo_h, profondita)`, `_insegna_orizzontale(mats, fy, h_pt, larghezza, testo)`,
  `_insegna_verticale(mats, x, fy, z_top, testo)`

- [ ] **Step 1: Aggiungi le funzioni (adattate VERBATIM dalle sezioni validate di `edificio-jazz.py`)**

Da `edificio-jazz.py` copiare adattando solo le coordinate in parametri:
- `_scala_fronte`: sezione "SCALA ANTINCENDIO" (balconi `add_balcony` + rampa + scaletta
  pendente) — un balcone per ogni sill in `sills` (deck_z = sill - 0.05), rampa obliqua
  solo tra i primi due, scaletta pendente dal balcone più basso.
- `_scala_laterale`: sezione "Scala a pioli sul lato destro" parametrizzata su
  `x_lato` (= larghezza/2), `z1`, `z2` + staffe ogni ~2.5m.
- `_serbatoio`: sezione "SERBATOIO IDRICO 45" con `tank_x, tank_y, roof_z, testo` parametri.
- `_comignolo`: sezione "COMIGNOLO DOPPIO" con posizione e roof_z parametri.

Nuove (scriverle così):

```python
def _cartellone(mats, roof_z, larghezza, testo):
    # Cartellone pubblicitario su montanti, sul tetto
    w = min(4.5, larghezza - 0.8)
    for si, sx in enumerate((-w / 2 + 0.3, w / 2 - 0.3)):
        add_box(f"cart_montante_{si}", 0.12, 0.12, 1.9, sx, 0.8, roof_z, mats['ferro'])
        add_strut(f"cart_puntone_{si}", (sx, 0.8, roof_z + 1.0), (sx, 1.6, roof_z + 0.05), 0.04, mats['ferro'])
    add_box("cart_pannello", w, 0.10, 1.4, 0, 0.74, roof_z + 0.9, mats['insegna'])
    add_box("cart_cornice", w + 0.14, 0.06, 1.54, 0, 0.80, roof_z + 0.83, mats['legno'])
    add_text_mesh("cart_testo", testo, 0.6, 0, 0.66, roof_z + 1.6, mats['insegna_testo'])


def _abbaino(mats, ax, corpo_h, profondita):
    # Abbaino sul tetto piatto: casotto con finestrella e tettuccio
    ay = -profondita / 2 + 1.4
    add_box("abbaino_corpo", 1.3, 1.2, 1.4, ax, ay, corpo_h + 0.40, mats['muro'])
    add_box("abbaino_tetto", 1.5, 1.4, 0.12, ax, ay, corpo_h + 1.80, mats['scuro'])
    _finestra("abbaino", ax, corpo_h + 0.65, ay - 0.60, mats, larg=0.7, alt=0.9)


def _insegna_orizzontale(mats, fy, h_pt, larghezza, testo):
    # Fascia insegna sopra il piano terra (tipo PAWN SHOP)
    w = min(larghezza - 0.6, 0.62 * len(testo) + 0.8)
    add_box("insegna_h", w, 0.12, 0.62, 0, fy - 0.04, h_pt - 0.75, mats['insegna'])
    add_box("insegna_h_cornice", w + 0.12, 0.06, 0.74, 0, fy - 0.02, h_pt - 0.81, mats['legno'])
    add_text_mesh("insegna_h_testo", testo, 0.34, 0, fy - 0.12, h_pt - 0.44, mats['insegna_testo'])


def _insegna_verticale(mats, x, fy, z_top, testo):
    # Insegna a bandiera: pannello verticale sporgente + staffe, lettere in colonna
    h = 0.5 * len(testo) + 0.5
    add_box("insegna_v", 0.55, 0.10, h, x, fy - 0.40, z_top - h, mats['insegna'])
    for si, sz in enumerate((z_top - 0.2, z_top - h + 0.2)):
        add_strut(f"insegna_v_staffa_{si}", (x, fy, sz), (x, fy - 0.40, sz), 0.03, mats['ferro'])
    corpo = "\n".join(list(testo))
    add_text_mesh("insegna_v_testo", corpo, 0.34, x, fy - 0.47, z_top - h / 2, mats['insegna_testo'])
```

- [ ] **Step 2: Collega tutto dentro `build_edificio()`** (al posto dei parametri ignorati)

```python
    # ── Scala antincendio ──
    if scala == 'fronte' and len(sills) >= 2:
        _scala_fronte(mats, fy, sills, h_piano)
    elif scala == 'laterale':
        _scala_laterale(mats, larghezza / 2, 1.3, corpo_h + 0.2)

    # ── Props tetto (solo su tetto piatto, tranne comignolo) ──
    if 'comignolo' in props_tetto:
        _comignolo(mats, larghezza / 2 - 1.1, profondita / 2 - 1.2, roof_z)
    if tetto == 'piatto':
        if 'serbatoio' in props_tetto:
            _serbatoio(mats, -larghezza / 2 + 1.6, 0.4, roof_z, serbatoio_testo)
        if 'cartellone' in props_tetto:
            _cartellone(mats, roof_z, larghezza, cartellone_testo)
        if 'abbaino' in props_tetto:
            _abbaino(mats, larghezza / 2 - 1.3, corpo_h, profondita)

    # ── Insegne ──
    if insegna:
        _insegna_orizzontale(mats, fy, h_pt, larghezza, insegna)
    if insegna_verticale:
        _insegna_verticale(mats, -larghezza / 2 + 0.45, fy, corpo_h - 0.4, insegna_verticale)
```

- [ ] **Step 3: Estendi `test_generatore.py`** — i 3 edifici campione diventano:

```python
    (dict(piani=3, larghezza=6.0, palette='rosso', piano_terra='portone', tettoia=True,
          scala='fronte', props_tetto=('serbatoio', 'comignolo')), -8.5),
    (dict(piani=4, larghezza=3.2, profondita=4.5, palette='ocra', piano_terra='vetrina',
          scala='laterale', props_tetto=('cartellone',), insegna_verticale="HOTEL"), 0.0),
    (dict(piani=2, larghezza=7.0, profondita=6.0, palette='oliva', piano_terra='angolo',
          tetto='falda_coppi', insegna="PAWN SHOP", props_tetto=('comignolo',)), 8.0),
```

- [ ] **Step 4: Esegui headless e guarda i render**

Checklist aggiuntiva:
- scala fronte: balconi a OGNI piano superiore + rampa tra i primi due
- scala laterale: pioli + staffe sul fianco destro, visibile in quarter
- serbatoio con testo, cartellone con cornice e testo leggibile, abbaino se usato
- insegna orizzontale sotto il marcapiano, leggibile; insegna verticale a lettere in colonna
- tutti i testi rivolti verso il fronte (-Y), non specchiati
Correggi e riesegui finché passa. Poi cancella i GLB/PNG `_test*`/`_gen*` di prova.

---

## Task 4: Ricetta `edificio_01.py` (l'edificio 13 sulla libreria) + parità visiva

**Files:**
- Create: `docs/superpowers/plans/blender-scripts/edifici/edificio_01.py`
- Reference: `edificio-jazz.py` (resta INTATTO e funzionante)

**Interfaces:**
- Consumes: `build_edificio` completo (Task 3)
- Produces: il PATTERN ricetta che tutte le ricette successive copiano:
  intestazione sys.path → clear → build → dettagli custom → export → render con prefisso

- [ ] **Step 1: Scrivi la ricetta**

```python
# edificio_01.py — Edificio "13" (ricetta di riferimento, replica di edificio-jazz.py)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

jl.clear_scene()
info = jl.build_edificio("edificio_01", piani=3, larghezza=6.0, profondita=5.5,
                         palette='rosso', piano_terra='portone', tettoia=True,
                         scala='fronte', props_tetto=('serbatoio', 'comignolo'),
                         serbatoio_testo="45")
mats = info['mats']
# Dettaglio custom: targa civico "13" sopra la tettoia (fascia libera sotto il davanzale)
jl.add_box("insegna13", 0.55, 0.08, 0.26, 0, info['front_y'] - 0.05, 2.62, mats['cornice'])
jl.add_text_mesh("insegna13_testo", "13", 0.17, 0, info['front_y'] - 0.11, 2.75, mats['scuro'])
jl.export_glb("edificio_01.glb")
jl.render_previews("e01", ortho_scale=15.0)
```

- [ ] **Step 2: Esegui headless, confronta con l'edificio validato**

Read di `e01_front.png` E di `front.png` (il render dell'edificio 13 originale).
Devono essere sostanzialmente equivalenti: stesse proporzioni, stessi componenti,
stessa palette. Differenze accettabili: posizioni delle toppe di mattoni (random
deterministico diverso), mensole distribuite dalla formula. Differenze NON accettabili:
componenti mancanti, quote diverse (tettoia, finestre, cornicione), colori diversi.
Correggi il generatore (non la ricetta) finché la parità regge.

NOTA: `edificio13.glb` originale NON va sovrascritto: la ricetta esporta `edificio_01.glb`.
Quando l'utente validerà la parità in Blender, `edificio13.glb` diventerà obsoleto
(si segnala, non si cancella senza chiedere).

---

## Task 5: Ricette 02 (angolare) e 03 (stretto e alto)

**Files:**
- Create: `edifici/edificio_02.py`, `edifici/edificio_03.py` (stesso pattern del Task 4)

**Interfaces:**
- Consumes: pattern ricetta (Task 4)
- Produces: `edificio_02.glb` (+`_02a`), `edificio_03.glb` (+`_03a`)

- [ ] **Step 1: `edificio_02.py` — angolare con negozio e tenda verde**

```python
# edificio_02.py — Angolare con ingresso d'angolo e tenda (2 varianti)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import math
import jazz_lib as jl

VARIANTI = [
    ("", 'rosso', (0.24, 0.38, 0.26, 1.0)),    # tenda verde (come nell'immagine)
    ("a", 'bruno', (0.55, 0.42, 0.20, 1.0)),   # variante: palette bruna, tenda senape
]
for suffisso, palette, tenda_rgba in VARIANTI:
    jl.clear_scene()
    info = jl.build_edificio("edificio_02" + suffisso, piani=3, larghezza=7.0,
                             profondita=6.0, palette=palette, piano_terra='angolo',
                             props_tetto=('comignolo',))
    mats = info['mats']
    # Tenda fissa sopra la vetrina sinistra (falda unica, non a righe)
    mat_tenda = jl.flat_material("tenda_unita", tenda_rgba)
    jl.add_box_c("tenda_negozio", 2.3, 1.0, 0.06, -7.0 / 2 + 1.3, info['front_y'] - 0.45,
                 2.30, mat_tenda, rot=(math.radians(-22), 0, 0))
    jl.add_box_c("tenda_lembo", 2.3, 0.06, 0.20, -7.0 / 2 + 1.3, info['front_y'] - 0.90,
                 2.16, mat_tenda)
    jl.export_glb(f"edificio_02{suffisso}.glb")
    jl.render_previews(f"e02{suffisso}", ortho_scale=14.0)
```

- [ ] **Step 2: `edificio_03.py` — stretto e alto (casa gialla del club)**

```python
# edificio_03.py — Stretto e alto, 4 piani, 1 finestra per piano (2 varianti)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

VARIANTI = [("", 'ocra'), ("a", 'crema')]
for suffisso, palette in VARIANTI:
    jl.clear_scene()
    jl.build_edificio("edificio_03" + suffisso, piani=4, larghezza=3.2, profondita=4.5,
                      palette=palette, piano_terra='vetrina',
                      props_tetto=('comignolo',), h_pt=2.6, h_piano=2.3)
    jl.export_glb(f"edificio_03{suffisso}.glb")
    jl.render_previews(f"e03{suffisso}", ortho_scale=14.0, alt_front=5.6)
```

- [ ] **Step 3: Esegui entrambi headless, guarda i 4 render front + 2 quarter**

Checklist: angolare col pannello a 45° e tende sopra la vetrina; stretto con una sola
colonna di finestre e proporzioni credibili (non un grattacielo魚); palette corrette.

---

## Task 6: Ricette 04 (Pawn Shop) e 05 (tetto a coppi)

**Files:**
- Create: `edifici/edificio_04.py`, `edifici/edificio_05.py`

**Interfaces:** pattern ricetta; produce `edificio_04.glb` (+a), `edificio_05.glb` (+a)

- [ ] **Step 1: `edificio_04.py`**

```python
# edificio_04.py — Pawn Shop: 3 piani, larga insegna gialla, palette bruna (2 varianti)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

VARIANTI = [("", 'bruno', "PAWN SHOP"), ("a", 'rosso', "HARDWARE")]
for suffisso, palette, testo in VARIANTI:
    jl.clear_scene()
    jl.build_edificio("edificio_04" + suffisso, piani=3, larghezza=6.5, profondita=5.5,
                      palette=palette, piano_terra='doppia_vetrina',
                      insegna=testo, insegna_verticale=testo.split()[0],
                      props_tetto=('comignolo',))
    jl.export_glb(f"edificio_04{suffisso}.glb")
    jl.render_previews(f"e04{suffisso}", ortho_scale=14.0)
```

- [ ] **Step 2: `edificio_05.py`**

```python
# edificio_05.py — Tetto a falda in coppi rossi, 3 piani (2 varianti)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

VARIANTI = [("", 'rosso'), ("a", 'oliva')]
for suffisso, palette in VARIANTI:
    jl.clear_scene()
    jl.build_edificio("edificio_05" + suffisso, piani=3, larghezza=5.5, profondita=5.0,
                      palette=palette, piano_terra='vetrina', tetto='falda_coppi',
                      props_tetto=('comignolo',))
    jl.export_glb(f"edificio_05{suffisso}.glb")
    jl.render_previews(f"e05{suffisso}", ortho_scale=15.0)
```

- [ ] **Step 3: Esegui, guarda i render** (insegna leggibile e non sfondata nel muro;
falda senza spigoli scoperti; comignolo sul bordo, non a cavallo del colmo).

---

## Task 7: Ricette 06 (Al's Barbershop, palo custom) e 07 (Smoke Shop)

**Files:**
- Create: `edifici/edificio_06.py`, `edifici/edificio_07.py`

**Interfaces:** pattern ricetta; produce `edificio_06.glb`, `edificio_07.glb` (+a)

- [ ] **Step 1: `edificio_06.py` col palo da barbiere custom**

```python
# edificio_06.py — Al's Barbershop: 2 piani, doppia vetrina, palo da barbiere
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import math
import jazz_lib as jl

jl.clear_scene()
info = jl.build_edificio("edificio_06", piani=2, larghezza=6.0, profondita=5.0,
                         palette='crema', piano_terra='doppia_vetrina',
                         insegna="AL'S BARBERSHOP", props_tetto=('comignolo',))
mats = info['mats']
fy = info['front_y']
# ── Palo da barbiere: cilindro bianco + eliche rossa/blu (skin_chain) + calotte ──
px, pz = 6.0 / 2 - 0.35, 1.15
mat_rosso = jl.flat_material("palo_rosso", (0.75, 0.15, 0.12, 1.0))
mat_blu = jl.flat_material("palo_blu", (0.15, 0.22, 0.55, 1.0))
jl.add_cyl("palo_corpo", 0.11, 0.75, px, fy - 0.25, pz, mats['tenda_b'])
for nome, mat, fase in (("palo_elica_r", mat_rosso, 0.0), ("palo_elica_b", mat_blu, math.pi)):
    punti = []
    for i in range(13):
        t = i / 12.0
        ang = fase + t * 3.0 * math.pi
        punti.append((px + 0.115 * math.cos(ang), fy - 0.25 + 0.115 * math.sin(ang), pz + 0.06 + t * 0.63))
    jl.skin_chain(nome, punti, [(0.028, 0.028)] * 13, mat, subsurf_levels=1)
jl.add_sphere("palo_calotta_su", 0.10, px, fy - 0.25, pz + 0.80, mats['oro'])
jl.add_sphere("palo_calotta_giu", 0.10, px, fy - 0.25, pz - 0.05, mats['oro'])
jl.add_strut("palo_staffa", (px, fy, pz + 0.37), (px, fy - 0.25, pz + 0.37), 0.03, mats['ferro'])
jl.export_glb("edificio_06.glb")
jl.render_previews("e06", ortho_scale=11.0, alt_front=3.4, quarter_pos=(10, -11, 7), quarter_target_z=3.0)
```

- [ ] **Step 2: `edificio_07.py`**

```python
# edificio_07.py — Smoke Shop: grande tenda a righe + insegna sporgente (2 varianti)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

VARIANTI = [("", 'bruno', "SMOKE SHOP", "CIGARS"), ("a", 'oliva', "GROCERY", "FRUIT")]
for suffisso, palette, testo_h, testo_v in VARIANTI:
    jl.clear_scene()
    jl.build_edificio("edificio_07" + suffisso, piani=3, larghezza=5.5, profondita=5.0,
                      palette=palette, piano_terra='doppia_vetrina', tettoia=True,
                      insegna=testo_h, insegna_verticale=testo_v)
    jl.export_glb(f"edificio_07{suffisso}.glb")
    jl.render_previews(f"e07{suffisso}", ortho_scale=13.0)
```

- [ ] **Step 3: Esegui, guarda i render.** Palo da barbiere: eliche aderenti al cilindro,
leggibile come palo anche da 10m (vista quarter). Tenda del 07 non deve coprire l'insegna.

---

## Task 8: Ricette 08 (Newspapers), 09 (fondale), 10 (magazzino)

**Files:**
- Create: `edifici/edificio_08.py`, `edifici/edificio_09.py`, `edifici/edificio_10.py`

**Interfaces:** pattern ricetta; produce `edificio_08.glb` (+a), `edificio_09.glb` (+a), `edificio_10.glb` (+a)

- [ ] **Step 1: `edificio_08.py`**

```python
# edificio_08.py — Newspapers: 3 piani rosso scuro, scala laterale (2 varianti)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

VARIANTI = [("", 'rosso', "NEWSPAPERS"), ("a", 'bruno', "PRINTING Co.")]
for suffisso, palette, testo in VARIANTI:
    jl.clear_scene()
    jl.build_edificio("edificio_08" + suffisso, piani=3, larghezza=6.0, profondita=5.5,
                      palette=palette, piano_terra='vetrina', scala='laterale',
                      insegna=testo, props_tetto=('comignolo', 'abbaino'))
    jl.export_glb(f"edificio_08{suffisso}.glb")
    jl.render_previews(f"e08{suffisso}", ortho_scale=14.0)
```

- [ ] **Step 2: `edificio_09.py`**

```python
# edificio_09.py — Palazzone da fondale: 4 piani, cartellone sul tetto (2 varianti)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

VARIANTI = [("", 'bruno', "HOTEL MAJESTIC"), ("a", 'rosso', "DRINK SODA!")]
for suffisso, palette, testo in VARIANTI:
    jl.clear_scene()
    jl.build_edificio("edificio_09" + suffisso, piani=4, larghezza=8.0, profondita=6.0,
                      palette=palette, piano_terra='portone',
                      props_tetto=('cartellone', 'comignolo'), cartellone_testo=testo)
    jl.export_glb(f"edificio_09{suffisso}.glb")
    jl.render_previews(f"e09{suffisso}", ortho_scale=17.0, alt_front=6.5)
```

- [ ] **Step 3: `edificio_10.py`**

```python
# edificio_10.py — Magazzino: 2 piani, porta carraia, poche finestre (2 varianti)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

VARIANTI = [("", 'oliva'), ("a", 'bruno')]
for suffisso, palette in VARIANTI:
    jl.clear_scene()
    info = jl.build_edificio("edificio_10" + suffisso, piani=2, larghezza=6.5,
                             profondita=6.0, palette=palette, piano_terra='portone',
                             props_tetto=('comignolo',))
    mats = info['mats']
    fy = info['front_y']
    # Porta carraia in legno al posto delle vetrine: due antoni con traversi a Z
    jl.add_box("carraia_cornice", 3.0, 0.18, 2.5, 1.5, fy, 0.01, mats['cornice'])
    for side, sx in (("L", 1.5 - 0.72), ("R", 1.5 + 0.72)):
        jl.add_box(f"carraia_anta_{side}", 1.38, 0.10, 2.35, sx, fy - 0.06, 0.02, mats['legno'])
        jl.add_box(f"carraia_traverso_{side}", 1.15, 0.04, 0.16, sx, fy - 0.13, 1.1, mats['legno_chiaro'])
    jl.export_glb(f"edificio_10{suffisso}.glb")
    jl.render_previews(f"e10{suffisso}", ortho_scale=11.0, alt_front=3.5)
```

NOTA: la vetrina destra generata da `piano_terra='portone'` (larghezza≥5) va EVITATA
qui — nel generatore la porta carraia la coprirebbe. Soluzione: chiamare con
`piano_terra='vetrina'` sarebbe sbagliato (aggiunge porta laterale). Aggiungere al
generatore l'opzione `piano_terra='solo_portone'` (portone centrale, nessuna vetrina)
e usarla in questa ricetta con il portone spostato: la porta carraia sta a x=+1.5,
il portone pedonale a x=-1.8. Implementazione: in `build_edificio`, ramo
`elif piano_terra == 'solo_portone': _portone(-1.8, fy, mats)`.

- [ ] **Step 4: Esegui i 3 script, guarda i render.** Carraia: antoni distinti dalla
cornice, porta pedonale non sovrapposta. Cartellone del 09 leggibile in front.

---

## Task 9: Line-up finale + verifica utente

**Files:**
- Create: `docs/superpowers/plans/blender-scripts/lineup.py`

**Interfaces:**
- Consumes: tutti i GLB `edificio_*.glb` esportati (Task 4-8)
- Produces: render `lineup_front.png` / `lineup_quarter.png` per la QA visiva finale

- [ ] **Step 1: Scrivi `lineup.py`**

```python
# lineup.py — importa tutti i GLB degli edifici e li affianca per la verifica finale
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import os
import bpy
import jazz_lib as jl

jl.clear_scene()
files = sorted(f for f in os.listdir(jl.MODELS_DIR)
               if f.startswith("edificio_") and f.endswith(".glb"))
x = 0.0
for f in files:
    prima = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=jl.MODELS_DIR + "/" + f)
    nuovi = set(bpy.data.objects) - prima
    xs = [(obj.matrix_world @ v.co).x for obj in nuovi if obj.type == 'MESH' for v in obj.data.vertices[:8]]
    larg = 8.0   # passo fisso: basta per il piu' largo (edificio_09, 8m) + margine
    for obj in nuovi:
        obj.location.x += x
    x += larg + 2.0
    print("Piazzato:", f)
# Camera centrata sulla fila
centro = (x - 10.0) / 2
jl.render_previews("lineup", ortho_scale=x + 6, alt_front=7.0,
                   quarter_pos=(centro + 30, -40, 22), quarter_target_z=6.0)
# NB: render_previews usa camera front a x=0: spostare la fila al centro invece
# di spostare la camera — traslare TUTTI gli oggetti di -centro prima del render.
```

Attenzione all'ultima nota: prima di chiamare `render_previews`, traslare tutti gli
oggetti mesh di `-centro` su X così la fila è centrata sull'origine inquadrata.

- [ ] **Step 2: Esegui headless, guarda `lineup_front.png`**

Checklist finale (dalla spec):
- ~15-18 edifici, nessuna coppia adiacente identica
- palette variegate ma coerenti (tutti "della stessa città")
- altezze da 2 a 4 piani ben distribuite
- niente z-fighting/pezzi fluttuanti in nessun edificio
- tutte le insegne leggibili e in inglese

- [ ] **Step 3: Gate utente**

Chiedere all'utente di aprire in Blender `lineup.py` (Run Script) e orbitare la fila,
oppure di importare i singoli GLB. Ogni richiesta di modifica riapre il ciclo:
correggi ricetta/generatore → headless → render → confronto. NIENTE commit (li fa lui).

---

## Stato esecuzione (2026-07-05, inline)

- Task 1-9 ESEGUITI: `jazz_lib.py` completa, 18 GLB `edificio_01..10(a)` esportati,
  line-up panoramici renderizzati. NIENTE commit (revoca utente).
- Fix post-feedback utente (PRIORITARI, gia' applicati e rigenerati tutti i GLB):
  1. ✅ Porte doppie: ante allargate a 0.66 (si toccano al centro, coprono il fondo
     scuro ai lati — prima restava un vuoto); stessa cosa per gli antoni carraia (1.45).
  2. ✅ Tende SMOKE SHOP/GROCERY che coprivano l'insegna: nuovo param `tettoia_z` in
     `build_edificio`; ricetta 07 con `h_pt=3.2` e `tettoia_z=2.37` → insegna sopra
     la porta, tenda attaccata sotto l'insegna (come nell'immagine di riferimento).
  3. ✅ (2026-07-06) Vuoto residuo SOPRA le ante del portone: ante alzate 2.05→2.17
     (riempiono il vano fino in cima al fondo scuro) + battente coprigiunto centrale
     che copre la tacca dei bevel al giunto. Tutti i 18 GLB rigenerati e verificati.
  4. ✅ (2026-07-06) `_tetto_falda` INVERTITO (feedback utente su e05/e05a: "tetto al
     contrario, vertice verso la casa"): le falde formavano una V col colmo in basso;
     fix = rotazione X negata (`-segno*ang`) su falde e listelli; 05/05a rigenerati.
- Piano ② scritto: `docs/superpowers/plans/2026-07-06-zona-jazz-piano2-club-scat-cat.md`
  (jazz club "Scat Cat Jazz"), in esecuzione.
- PROSSIMO STEP: gate utente sui line-up aggiornati + club quando pronto.

## Self-review (fatta)

- **Copertura spec**: libreria ✓ (T1), generatore con tutti i parametri della spec ✓
  (T2+T3), ricette 02-10 ✓ (T5-T8), ricetta 01 di parità ✓ (T4), varianti ✓ (nelle
  ricette), verifica varietà ✓ (T9). Club/props/layout: piani ② e ③, fuori scope qui.
- **Placeholder**: le uniche parti "copiate" sono le funzioni già validate in
  `edificio-jazz.py`, referenziate per nome esatto con fonte esatta — il codice esiste
  nel repo, non è un placeholder.
- **Coerenza firme**: `build_edificio` accetta gli stessi kwargs in T2 (ignorati) e T3
  (attivi); ricette usano solo kwargs dichiarati; `piano_terra='solo_portone'`
  introdotto nel T8 Step 3 con implementazione indicata.
