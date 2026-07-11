# Piazza della Fontana — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Costruire la Piazza della Fontana (ovale 20×32 m, centro mondo (55.5, 0)) che spezza il corridoio principale Jazz↔Galleria, con fontana-mascotte, chiosco, coperture basse, quinte riusate e tappo-cantiere nord per il futuro Funland.

**Architecture:** Asset GLB generati con Blender 5.1 headless tramite una nuova `piazza_lib.py` che riusa `galleria_lib`/`jazz_lib`; zona caricata da `loadZone` esistente (istanze + COL AABB per modello, rotazione dall'istanza); perimetro sigillato da muretti/quinte istanziati lungo l'ellisse; +2 spawn server.

**Tech Stack:** Blender 5.1 headless (`C:\Program Files\Blender Foundation\Blender 5.1\blender.exe --background --python <script>`), Three.js r128 (fps.js, invariato salvo `_boot`), Node/Express (spawn server).

## Global Constraints

- **NON committare mai**: i commit li fa SOLO l'utente (regola progetto). I passi "commit" classici sono sostituiti da gate di verifica.
- Coordinate di gioco: x est, z sud (nord = −z), y su. Blender: `bx=x_gioco, by=−z_gioco, bz=y_gioco` (usare sempre `box_game`/helper, mai coordinate crude).
- Le mesh `COL_*` dentro un GLB devono essere **AABB locali** (niente rotazioni intra-GLB): la rotazione arriva SOLO dal `rotY` dell'istanza nel layout (loadZone → `addSolidOBB`).
- Ogni asset visivo passa un **gate di render preview** (utente) prima di considerarsi fatto; mai solo primitive nude (usare lathe/skin/bevel — regola memoria Blender).
- Niente emoji nelle insegne/testi (glyph/typo only).
- Stile: "boxy ma dettagliato", palette calda coerente con Jazz (mattone/crema/ottone).
- Cartelle di lavoro: `frontend/assets/models/piazza/` (nuova) e `collegamenti-wip/` (rigenerata). Gli originali `collegamenti/` restano congelati.
- Ellisse piazza: semiassi **A=10 (E-O), B=16 (N-S)**, centro **(CX,CZ)=(55.5,0)**. Aperture: OVEST w7 centrata z=−1.2 (endcap Jazz esistente), EST w9 centrata z=0 (portale ovest Galleria), NORD w5 centrata x=55.5 (tappo cantiere). SUD chiuso.
- Parametrizzazione ellisse (coordinate LOCALI piazza): `P(t) = (A·sin t, −B·cos t)` con `t=0 → nord`, `t=π/2 → est (x=+A, z=0)`, `t=π → sud`, `t=3π/2 → ovest`.
- `rotY` istanza per allineare il lato-X di un modello alla tangente in `t`: `rotY = degrees(atan2(−B·sin t, A·cos t))`.
- Server: `node server.js` DALLA cartella `backend/` — lo avvia SOLO l'utente. Per i test headless usare il server che l'utente tiene acceso.

---

### Task 1: piazza_lib + smoke test pipeline Blender

**Files:**
- Create: `docs/superpowers/plans/blender-scripts/piazza/piazza_lib.py`
- Create: `docs/superpowers/plans/blender-scripts/piazza/smoke.py`

**Interfaces:**
- Produces: modulo `piazza_lib` con `CX, CZ, A, B`, `box_game(name,w,d,h,gx,gz,gy,mat,bevel)`, `ellisse(t)->(lx,lz)`, `tangente_rotY(t)->gradi`, re-export di `clear_scene, flat_material, neon_material, export_glb, render_previews, add_box, add_box_c, add_cyl` (galleria_lib) e `lathe_profile, skin_chain` (jazz_lib). `MODELS_DIR = frontend/assets/models/piazza`, `PREVIEW_DIR = blender-scripts/piazza/preview`.

- [ ] **Step 1: Scrivere piazza_lib.py**

```python
# piazza_lib.py — libreria Piazza della Fontana (riusa galleria_lib + jazz_lib)
# NB: i path WORKTREE dentro jazz_lib/galleria_lib puntano a worktree RIMOSSI:
# qui si sovrascrivono i MODELS_DIR/PREVIEW_DIR dei moduli dopo l'import.
import sys, os, math
REPO = "C:/Users/pacia/Desktop/Claude Workspace/prova"
SCRIPTS = REPO + "/docs/superpowers/plans/blender-scripts"
sys.path.insert(0, SCRIPTS)                  # jazz_lib.py
sys.path.insert(0, SCRIPTS + "/galleria")    # galleria_lib.py
import bpy
import galleria_lib as gl
import jazz_lib as jl

MODELS_DIR = REPO + "/frontend/assets/models/piazza"
PREVIEW_DIR = SCRIPTS + "/piazza/preview"
gl.MODELS_DIR = MODELS_DIR
gl.PREVIEW_DIR = PREVIEW_DIR
jl.MODELS_DIR = MODELS_DIR
jl.PREVIEW_DIR = PREVIEW_DIR

# ── Geometria piazza (coordinate MONDO del centro + semiassi ovale) ──
CX, CZ = 55.5, 0.0
A, B = 10.0, 16.0

# Re-export helper validati
clear_scene = gl.clear_scene
flat_material = gl.flat_material
neon_material = jl.neon_material
export_glb = gl.export_glb
render_previews = gl.render_previews
add_box = gl.add_box
add_box_c = gl.add_box_c
add_cyl = gl.add_cyl
lathe_profile = jl.lathe_profile
skin_chain = jl.skin_chain


def box_game(name, w, d, h, gx, gz, gy, mat, bevel=0.02):
    # w lungo x_gioco, d lungo z_gioco, h altezza; base a gy.
    return gl.add_box(name, w, d, h, gx, -gz, gy, mat, bevel)


def ellisse(t):
    # Punto sull'ovale in coordinate LOCALI piazza. t=0 → nord (0,−B).
    return (A * math.sin(t), -B * math.cos(t))


def tangente_rotY(t):
    # rotY (gradi, convenzione layout) che allinea il lato-X del modello
    # alla tangente dell'ellisse in t (three: (x,z)→(x·cos+z·sin, −x·sin+z·cos)).
    return math.degrees(math.atan2(-B * math.sin(t), A * math.cos(t)))


MAT = None
def materiali():
    # Palette piazza (chiamare dopo clear_scene). Nomi = nomi materiale GLB
    # (il toon-swap fa cache PER NOME: riusare i nomi jazz dove il colore coincide).
    global MAT
    MAT = {
        'sanp_a':   flat_material('sanp_a',   (0.36, 0.34, 0.31, 1)),
        'sanp_b':   flat_material('sanp_b',   (0.45, 0.44, 0.41, 1)),
        'sanp_c':   flat_material('sanp_c',   (0.55, 0.53, 0.49, 1)),
        'cordolo':  flat_material('cordolo',  (0.70, 0.68, 0.63, 1)),
        'pietra':   flat_material('pietra_piazza', (0.60, 0.57, 0.52, 1)),
        'crema':    flat_material('crema',    (0.90, 0.86, 0.74, 1)),
        'ottone':   flat_material('ottone',   (0.74, 0.53, 0.22, 1)),
        'acqua':    flat_material('acqua',    (0.45, 0.70, 0.80, 1)),
        'verde':    flat_material('verde_scuro', (0.15, 0.31, 0.29, 1)),
        'legno':    flat_material('legno',    (0.34, 0.20, 0.11, 1)),
        'prato':    flat_material('prato',    (0.33, 0.52, 0.24, 1)),
        'nero':     flat_material('nero',     (0.12, 0.12, 0.13, 1)),
        'rosso':    flat_material('marquee_rosso', (0.59, 0.14, 0.13, 1)),
        'giallo':   flat_material('giallo_cantiere', (0.86, 0.68, 0.20, 1)),
    }
    return MAT
```

- [ ] **Step 2: Scrivere smoke.py** (verifica import, path e render)

```python
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/piazza")
import piazza_lib as pl
pl.clear_scene()
M = pl.materiali()
pl.box_game("smoke_box", 2, 2, 1, pl.CX, pl.CZ, 0, M['ottone'])
pl.render_previews("smoke", ortho_scale=8)
print("SMOKE OK — ellisse(0) =", pl.ellisse(0), "rotY(0) =", pl.tangente_rotY(0))
```

- [ ] **Step 3: Eseguire lo smoke test**

Run (PowerShell): `& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python "docs\superpowers\plans\blender-scripts\piazza\smoke.py"`
Expected: stampa `SMOKE OK — ellisse(0) = (0.0, -16.0) rotY(0) = 0.0` e 2 PNG in `blender-scripts/piazza/preview/`. Se `render_previews` fallisse per parametri, va bene anche solo l'export: il gate vero è dai Task 2 in poi.

- [ ] **Step 4: Leggere i PNG con il tool Read** e verificare che il box sia visibile (pipeline ok).

---

### Task 2: Pavimentazione ovale (`piazza_base.glb`)

**Files:**
- Create: `docs/superpowers/plans/blender-scripts/piazza/piazza-pavimentazione.py`
- Output: `frontend/assets/models/piazza/piazza_base.glb`

**Interfaces:**
- Produces: GLB `piazza_base` con origine al CENTRO piazza (istanza a x=55.5,z=0 nel layout). Contiene SOLO pavimento (nessuna COL): anelli concentrici di "sanpietrini" ellittici + fascia cordolo esterna. Quota: top pietre a bz≈+0.10 (⇒ y mondo ≈0 con l'offset zona −0.10, come Jazz).

- [ ] **Step 1: Scrivere la ricetta** — anelli di conci trapezoidali `from_pydata` (pattern pavimentazione Jazz: mesh unica per materiale, 3 grigi alternati):

```python
import sys, math, random
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/piazza")
import bpy
import piazza_lib as pl

pl.clear_scene()
M = pl.materiali()
random.seed(55)

# Anelli concentrici: frazioni dei semiassi (l'ultimo anello è il cordolo).
RINGS = [0.16, 0.30, 0.44, 0.58, 0.72, 0.86, 1.00]
SEGS = 64
H = 0.10          # top a bz=+0.10 → y mondo ≈ 0 (offset zona −0.10)
GAP = 0.965       # scala del concio → fuga visibile ~3-4 cm

per_mat = {k: ([], []) for k in ('sanp_a', 'sanp_b', 'sanp_c', 'cordolo')}
def quad(mat, p0, p1, p2, p3):
    verts, faces = per_mat[mat]
    b = len(verts)
    for (lx, lz) in (p0, p1, p2, p3):
        verts.append((lx, -lz, 0.0))          # base (bz 0)
    for (lx, lz) in (p0, p1, p2, p3):
        verts.append((lx, -lz, H))            # top
    faces += [(b+4, b+5, b+6, b+7),           # top
              (b+0, b+1, b+5, b+4), (b+1, b+2, b+6, b+5),
              (b+2, b+3, b+7, b+6), (b+3, b+0, b+4, b+7)]

prev = 0.04
for ri, f in enumerate(RINGS):
    mat = 'cordolo' if ri == len(RINGS) - 1 else random.choice(('sanp_a', 'sanp_b', 'sanp_c'))
    for s in range(SEGS):
        t0, t1 = 2*math.pi*s/SEGS, 2*math.pi*(s+1)/SEGS
        mat_s = mat if ri == len(RINGS)-1 else random.choice(('sanp_a', 'sanp_b', 'sanp_c'))
        pts = []
        for (fr, t) in ((prev, t0), (f, t0), (f, t1), (prev, t1)):
            lx, lz = pl.A*fr*math.sin(t), -pl.B*fr*math.cos(t)
            pts.append((lx, lz))
        # restringi il concio verso il suo centro → fuga
        cx = sum(p[0] for p in pts)/4; cz = sum(p[1] for p in pts)/4
        pts = [(cx+(p[0]-cx)*GAP, cz+(p[1]-cz)*GAP) for p in pts]
        quad(mat_s, *pts)
    prev = f

for mname, (verts, faces) in per_mat.items():
    mesh = bpy.data.meshes.new("pav_" + mname)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("pav_" + mname, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(M[mname])

# disco di chiusura sotto la fontana (il foro centrale prev=0.04)
pl.add_cyl("pav_centro", pl.A*0.17, H, 0, 0, 0, M['pietra'], vertices=48)

pl.export_glb("piazza_base.glb")
pl.render_previews("piazza_base", ortho_scale=40, quarter_pos=(30, -34, 22))
```

(NB: `add_cyl(name, raggio, h, bx, by, bz, mat)` — verificare la firma in galleria_lib prima dell'uso e adeguare gli argomenti; è già usata in collegamenti-layout con `vertices=`.)

- [ ] **Step 2: Renderizzare ed esaminare** — Run Blender headless sullo script. Leggere i 2 PNG: anelli concentrici leggibili, fughe visibili, niente buchi tra anelli, cordolo esterno più chiaro.
- [ ] **Step 3: Gate utente** — mostrare la preview all'utente e incorporare feedback prima di procedere.

---

### Task 3: Monconi collegamenti (corr_main → piazza)

**Files:**
- Modify: `docs/superpowers/plans/blender-scripts/collegamenti/collegamenti-layout-wip.py:104-157` (blocco corridoio principale + volta)
- Output: `frontend/assets/models/collegamenti-wip/collegamenti.glb` + `collegamenti-layout.json` rigenerati

**Interfaces:**
- Consumes: geometria piazza (Global Constraints).
- Produces: varco OVEST piazza = endcap Jazz esistente (`main_jz_cap`, x=45.5, z=−1.2, w7) SENZA più corridoio dietro; lato EST libero fino al portale Galleria (x=65.4, w9). I flank restano intatti.

- [ ] **Step 1: Modificare il blocco main** — la piazza occupa x∈[45.5, 65.4]: `main_a`, `main_b`, `main_step_s` e le due `barrel(...)` (volta) si ELIMINANO. Restano: `main_tappo_*` (riempiono i cunei curvi al filo Jazz), `endcap main_jz_cap` (ora è la porta ovest della piazza). Sostituire le righe 112-119 e 156-157 con:

```python
# ── PIAZZA DELLA FONTANA al posto del corr_main (spec 2026-07-09) ──
# L'ovale A=10, B=16 centro (55.5,0) riempie x∈[45.5,65.4]: niente più corridoio.
# main_jz_cap resta come porta OVEST della piazza; il portale Galleria (x=65.4,
# w9) è la porta EST. Il perimetro lo sigilla la zona piazza (muretti/quinte).
```

(le chiamate `run("main_a"...)`, `run("main_b"...)`, `wall_seg("main_step_s"...)`, `barrel("a"...)`, `barrel("b"...)` vengono rimosse; `endcap("main_jz_cap", ...)` e il ciclo `main_tappo_*` NON si toccano)

- [ ] **Step 2: Aggiornare il JSON `vie`** (documentativo, fps.js non lo legge):

```python
        {"nome": "piazza_ovale", "asse": "x", "da": X_JZ, "a": X_GL, "centro": 0, "larghezza": 20},
```
al posto della riga `corr_main`.

- [ ] **Step 3: Rigenerare** — Run: `& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python "docs\superpowers\plans\blender-scripts\collegamenti\collegamenti-layout-wip.py"`
Expected: `collegamenti.glb` + JSON scritti in `collegamenti-wip/`, top render `collegamenti_top_debug.png`.
- [ ] **Step 4: Esaminare il top render** — tra Jazz e Galleria deve esserci il VUOTO dell'ovale (con endcap a ovest), flank intatti a z=±38.

---

### Task 4: Perimetro — muretto + quinte jazz + layout preliminare

**Files:**
- Create: `docs/superpowers/plans/blender-scripts/piazza/arredo.py` (solo parte muretto in questo task)
- Create: `docs/superpowers/plans/blender-scripts/piazza/piazza-layout.py`
- Copy: 4 GLB quinte da `frontend/assets/models/jazz/` a `frontend/assets/models/piazza/`
- Output: `frontend/assets/models/piazza/muretto.glb`, `piazza-layout.json` (versione perimetro)

**Interfaces:**
- Produces: `muretto.glb` = segmento 4.4×0.5×3.2 m origine al centro-base, fronte lato −z, con `COL_muretto` AABB identica; `piazza-layout.py` = generatore del layout completo (questo task: base+perimetro; i task 5-8 aggiungono istanze).

- [ ] **Step 1: Ricetta muretto** (in arredo.py, blocco `if ASSET == 'muretto'`): corpo 4.4×0.5 h3.2 con zoccolo (4.6×0.7 h0.5), copertina smussata in `pietra_piazza`, 3 lesene sottili lato interno. `COL_muretto`: box 4.4×0.5×3.2 a base 0. Export `muretto.glb` + `render_previews("muretto", ortho_scale=6)`.

```python
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/piazza")
import piazza_lib as pl
ASSET = 'muretto'   # override da CLI: blender ... -- muretto|panchina|aiuola
import sys as _s
if '--' in _s.argv:
    ASSET = _s.argv[_s.argv.index('--') + 1]
pl.clear_scene()
M = pl.materiali()
if ASSET == 'muretto':
    pl.box_game("muretto_zoccolo", 4.6, 0.7, 0.5, 0, 0, 0, M['pietra'])
    pl.box_game("muretto_corpo",   4.4, 0.5, 2.5, 0, 0, 0.5, M['crema'])
    pl.box_game("muretto_copertina", 4.6, 0.7, 0.2, 0, 0, 3.0, M['pietra'], bevel=0.05)
    for i in (-1, 0, 1):
        pl.box_game(f"muretto_lesena_{i}", 0.3, 0.12, 2.5, i * 1.6, -0.31, 0.5, M['crema'])
    pl.box_game("COL_muretto", 4.4, 0.7, 3.2, 0, 0, 0, M['crema'])
    pl.export_glb("muretto.glb")
    pl.render_previews("muretto", ortho_scale=6)
```

- [ ] **Step 2: Scegliere le quinte** — elencare i GLB jazz disponibili (`Get-ChildItem frontend/assets/models/jazz/*.glb`), copiare 4 edifici di larghezza media (prima scelta: `edificio_02, edificio_05, edificio_07, edificio_09`; se i nomi reali differiscono, scegliere 4 facciate ≠ tra loro) in `frontend/assets/models/piazza/`.
- [ ] **Step 3: piazza-layout.py** — genera `piazza-layout.json`: istanza `piazza_base` a (55.5, 0); quinte+muretti disposti sull'ellisse via `ellisse(t)`/`tangente_rotY(t)` LASCIANDO le 3 aperture (ovest w7 @ z=−1.2, est w9 @ z=0, nord w5 @ x=55.5). Slot suggeriti (t in gradi, da raffinare col render): quinte a t≈45°, 135°, 225°, 315°; muretti a colmare gli archi restanti a passo ~14°. Le istanze quinte/muretti stanno sul bordo ellisse spinte FUORI di metà profondità del modello. Il JSON segue la convenzione `{"edifici":[{"modello","x","z","rotY","y","s"}], "props":[], "vie":[]}` con coordinate MONDO (istanza base inclusa).

```python
import sys, os, json, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/piazza")
import piazza_lib as pl

APERTURE = [          # (t_centro_rad, semi-ampiezza_rad) — ricavate dai varchi
    (1.5 * math.pi, math.asin(3.5 / pl.B)),   # OVEST w7  (t=3π/2)  ≈ ±0.221
    (0.5 * math.pi, math.asin(4.5 / pl.B)),   # EST  w9              ≈ ±0.285
    (0.0,           math.asin(2.5 / pl.A)),   # NORD w5              ≈ ±0.253
]
def in_apertura(t):
    tt = t % (2 * math.pi)
    for (tc, semi) in APERTURE:
        d = min(abs(tt - tc), 2 * math.pi - abs(tt - tc))
        if d < semi + 0.10:
            return True
    return False

edifici = [{"modello": "piazza_base", "x": pl.CX, "z": pl.CZ, "rotY": 0.0, "y": 0.0, "s": 1.0}]
QUINTE = ["edificio_02", "edificio_05", "edificio_07", "edificio_09"]
slot_q = [math.radians(a) for a in (45, 135, 225, 315)]
for nome, t in zip(QUINTE, slot_q):
    lx, lz = pl.ellisse(t)
    edifici.append({"modello": nome, "x": round(pl.CX + lx, 2), "z": round(pl.CZ + lz, 2),
                    "rotY": round(pl.tangente_rotY(t), 1), "y": 0.0, "s": 1.0})
STEP = math.radians(14)
t = 0.0
while t < 2 * math.pi:
    if not in_apertura(t) and min(abs(t - s) for s in slot_q) > math.radians(16):
        lx, lz = pl.ellisse(t)
        edifici.append({"modello": "muretto", "x": round(pl.CX + lx, 2), "z": round(pl.CZ + lz, 2),
                        "rotY": round(pl.tangente_rotY(t), 1), "y": 0.0, "s": 1.0})
    t += STEP

layout = {"edifici": edifici, "props": [], "vie": []}
OUT = pl.MODELS_DIR + "/piazza-layout.json"
os.makedirs(pl.MODELS_DIR, exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(layout, f, indent=2, ensure_ascii=False)
print("piazza-layout.json:", len(edifici), "istanze")
```

- [ ] **Step 4: Top render combinato** — aggiungere in coda a piazza-layout.py un render top stile `collegamenti-layout-wip.py` righe 250-281 (sagome REF Jazz disco r45.5 + Galleria + istanze piazza come box grezzi) per verificare: perimetro chiuso, aperture nei 3 punti giusti, quinte non sovrapposte ai flank (z=±38 fuori dall'ovale B=16 ✓).
- [ ] **Step 5: Gate utente** sul top render.

---

### Task 5: Cantiere FUNLAND (tappo nord)

**Files:**
- Create: `docs/superpowers/plans/blender-scripts/piazza/cantiere.py`
- Output: `frontend/assets/models/piazza/cantiere.glb`
- Modify: `piazza-layout.py` (istanza cantiere)

**Interfaces:**
- Produces: `cantiere.glb` origine centro-base, fronte −z (verso l'esterno/nord), larghezza 6 m: palizzata legno h3, due montanti, fascia gialla/nera diagonale, insegna "FUNLAND" + sottotitolo "PROSSIMAMENTE" (text mesh convertita, materiale `giallo_cantiere` su fondo `nero`). `COL_cantiere` 6×0.6×3.

- [ ] **Step 1: Ricetta** — palizzata di 8 assi verticali (0.7×0.12×3) leggermente irregolari (±2° rotazione via `add_box_c`), traversa alta/bassa, insegna box 4.4×0.15×1.1 a bz 1.6 con scritte:

```python
import sys, math, random
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/piazza")
import bpy
import piazza_lib as pl
pl.clear_scene()
M = pl.materiali()
random.seed(7)
for i in range(8):
    x = -2.65 + i * 0.76
    pl.add_box_c(f"asse_{i}", 0.7, 0.12, 3.0, x, 0, 1.5, M['legno'],
                 rot=(0, math.radians(random.uniform(-2, 2)), 0))
for bz in (0.5, 2.4):
    pl.box_game(f"traversa_{int(bz*10)}", 6.0, 0.10, 0.25, 0, 0.10, bz, M['legno'])
pl.box_game("insegna_fondo", 4.4, 0.15, 1.1, 0, -0.16, 1.6, M['nero'])

def testo(nome, txt, size, bz):
    bpy.ops.object.text_add()
    t = bpy.context.object
    t.data.body = txt
    t.data.size = size
    t.data.extrude = 0.03
    t.data.align_x = 'CENTER'
    bpy.ops.object.convert(target='MESH')
    t.name = nome
    t.location = (0, -0.26, bz)
    t.rotation_euler = (math.radians(90), 0, 0)
    t.data.materials.append(M['giallo'])

testo("txt_funland", "FUNLAND", 0.62, 1.95)
testo("txt_sub", "PROSSIMAMENTE", 0.22, 1.72)
pl.box_game("COL_cantiere", 6.0, 0.6, 3.0, 0, 0, 0, M['legno'])
pl.export_glb("cantiere.glb")
pl.render_previews("cantiere", ortho_scale=7)
```

- [ ] **Step 2: Render + gate utente** (leggibilità scritte, niente emoji).
- [ ] **Step 3: Istanza nel layout** — in piazza-layout.py, dopo le quinte: `{"modello": "cantiere", "x": 55.5, "z": -16.0, "rotY": 0.0, "y": 0.0, "s": 1.0}` (fronte −z verso nord ✓, copre l'apertura w5). Rigenerare il JSON.

---

### Task 6: Fontana-mascotte

**Files:**
- Create: `docs/superpowers/plans/blender-scripts/piazza/fontana.py`
- Output: `frontend/assets/models/piazza/fontana.glb`
- Modify: `piazza-layout.py` (istanza fontana a (55.5, 0))

**Interfaces:**
- Produces: `fontana.glb` origine al centro-base: vasca lathe Ø7 (bordo h0.45 → scavalcabile con STEP_HEIGHT 0.6 = "entrabile"), acqua a bz0.32, basamento centrale a 2 ordini, statua mascotte (testa sfera+occhioni stile `buildMascotHead`, corpo `skin_chain`, braccia a tubo) in `ottone`, zampillo. COL: `COL_fontana_vasca` 6.6×6.6×0.45 (piattaforma bassa calpestabile) + `COL_fontana_base` 1.8×1.8×2.6.

- [ ] **Step 1: Ricetta iniziale** (poi iterazione visiva):

```python
import sys, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/piazza")
import bpy
import piazza_lib as pl
pl.clear_scene()
M = pl.materiali()

# VASCA (lathe, profilo (raggio, z)): esterno sagomato, gola, labbro tondo
pl.lathe_profile("vasca", [
    (3.55, 0.00), (3.55, 0.18), (3.42, 0.22), (3.42, 0.38),
    (3.55, 0.42), (3.50, 0.45), (3.20, 0.45), (3.15, 0.40),
    (3.15, 0.10), (0.90, 0.06), (0.90, 0.00),
], M['pietra'], segments=48)
pl.add_cyl("acqua", 3.15, 0.32, 0, 0, 0.0, M['acqua'], vertices=48)

# BASAMENTO a 2 ordini + catino piccolo
pl.lathe_profile("basamento", [
    (1.05, 0.00), (1.05, 0.55), (0.80, 0.62), (0.62, 0.62),
    (0.62, 1.15), (0.95, 1.22), (1.30, 1.30), (1.35, 1.42),
    (1.28, 1.48), (0.42, 1.45), (0.42, 1.50), (0.0, 1.50),
], M['pietra'], segments=40)

# STATUA MASCOTTE in ottone: corpo skin, testa sfera, braccia aperte
pl.skin_chain("corpo", [(0, 0, 1.50), (0, 0, 1.78), (0, 0.02, 2.02), (0, 0, 2.18)],
              [(0.16, 0.14), (0.24, 0.20), (0.18, 0.16), (0.10, 0.10)], M['ottone'])
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.30, location=(0, 0, 2.52))
testa = bpy.context.object; testa.name = "testa"
testa.data.materials.append(M['ottone'])
for s in (-1, 1):
    pl.skin_chain(f"braccio_{s}", [(s*0.20, 0, 2.10), (s*0.42, -0.06, 2.24), (s*0.55, -0.10, 2.42)],
                  [(0.07, 0.07), (0.06, 0.06), (0.09, 0.09)], M['ottone'])
# ZAMPILLO dalla bocca: arco d'acqua sottile verso la vasca
pl.skin_chain("zampillo", [(0, -0.30, 2.46), (0, -0.85, 2.30), (0, -1.30, 1.60), (0, -1.55, 0.60)],
              [(0.05, 0.05), (0.07, 0.07), (0.06, 0.06), (0.10, 0.10)], M['acqua'])

# COL
pl.box_game("COL_fontana_vasca", 6.6, 6.6, 0.45, 0, 0, 0, M['pietra'])
pl.box_game("COL_fontana_base", 1.8, 1.8, 2.6, 0, 0, 0.45, M['pietra'])
pl.export_glb("fontana.glb")
pl.render_previews("fontana", ortho_scale=9, quarter_pos=(8, -9, 5))
```

- [ ] **Step 2: Ciclo di iterazione visiva** — render → Read PNG → correggere proporzioni (il bug storico "non vedo la base" era del VECCHIO progetto: qui la base è il lathe `vasca` con profilo chiuso a z=0; verificare nel render 3/4 che la vasca poggi a terra senza gap). Ripetere fino a risultato pulito.
- [ ] **Step 3: Gate utente** — è il pezzo forte della piazza: approvazione esplicita del render.
- [ ] **Step 4: Istanza layout** — `{"modello": "fontana", "x": 55.5, "z": 0.0, "rotY": 180.0, "y": 0.0, "s": 1.0}` (zampillo verso sud, visibile arrivando da Jazz e Galleria). Rigenerare JSON.

---

### Task 7: Chiosco tondo

**Files:**
- Create: `docs/superpowers/plans/blender-scripts/piazza/chiosco.py`
- Output: `frontend/assets/models/piazza/chiosco.glb`
- Modify: `piazza-layout.py` (istanza)

**Interfaces:**
- Produces: `chiosco.glb` origine centro-base: corpo cilindrico Ø3.8 h2.7 (`verde_scuro`) con lesene, bancone/sportello su un lato (fronte −z), tetto conico svasato (lathe, `crema`) con pennone `ottone`, insegna "EDICOLA". `COL_chiosco` 3.6×3.6×4.2.

- [ ] **Step 1: Ricetta iniziale:**

```python
import sys, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/piazza")
import bpy
import piazza_lib as pl
pl.clear_scene()
M = pl.materiali()

pl.add_cyl("corpo", 1.9, 2.7, 0, 0, 0, M['verde'], vertices=24)
for i in range(8):
    a = 2 * math.pi * i / 8
    pl.add_box_c(f"lesena_{i}", 0.16, 0.10, 2.7, 1.92 * math.sin(a), 1.92 * math.cos(a), 1.35,
                 M['crema'], rot=(0, 0, -a))
# sportello + bancone (fronte -z gioco → by positivo... usare box_game con gz negativo)
pl.box_game("sportello", 1.5, 0.12, 1.0, 0, -1.86, 1.1, M['crema'])
pl.box_game("bancone", 1.7, 0.45, 0.10, 0, -2.05, 1.0, M['legno'])
# tetto conico svasato + pennone
pl.lathe_profile("tetto", [
    (2.35, 2.70), (2.30, 2.78), (1.60, 3.10), (0.85, 3.55), (0.30, 3.95), (0.0, 4.10),
], M['crema'], segments=24)
pl.add_cyl("pennone", 0.05, 0.6, 0, 0, 4.05, M['ottone'], vertices=8)
bpy.ops.object.text_add()
t = bpy.context.object; t.data.body = "EDICOLA"; t.data.size = 0.30
t.data.extrude = 0.03; t.data.align_x = 'CENTER'
bpy.ops.object.convert(target='MESH')
t.location = (0, -1.95, 2.25); t.rotation_euler = (math.radians(90), 0, 0)
t.data.materials.append(M['giallo'])
pl.box_game("COL_chiosco", 3.6, 3.6, 4.2, 0, 0, 0, M['verde'])
pl.export_glb("chiosco.glb")
pl.render_previews("chiosco", ortho_scale=7)
```

- [ ] **Step 2: Iterazione visiva + gate utente.**
- [ ] **Step 3: Istanza layout** — `{"modello": "chiosco", "x": 60.0, "z": 8.5, "rotY": -35.0, "y": 0.0, "s": 1.0}` (quadrante S-E, sportello verso la fontana). Verificare nel top render che con la fontana spezzi la sightline ovest↔est: la retta z=−1.2→z=0 tra i varchi deve intersecare vasca o chiosco.

---

### Task 8: Panchina + aiuola + disposizione arredo

**Files:**
- Modify: `docs/superpowers/plans/blender-scripts/piazza/arredo.py` (blocchi `panchina` e `aiuola`)
- Output: `frontend/assets/models/piazza/panchina.glb`, `aiuola.glb`
- Modify: `piazza-layout.py` (istanze finali)

**Interfaces:**
- Produces: `panchina.glb` (2.0×0.65, seduta h0.55 su fianchi in ghisa `nero`, listelli `legno`; `COL_panchina` 2.0×0.65×0.85) e `aiuola.glb` (2.6×1.3, cordolo `cordolo` h0.45, terra `legno` scuro, cupola prato `prato` + 2 cespugli sfera; `COL_aiuola` 2.6×1.3×0.5).

- [ ] **Step 1: Blocchi ricetta in arredo.py:**

```python
if ASSET == 'panchina':
    for s in (-1, 1):
        pl.add_box_c(f"fianco_{s}", 0.08, 0.60, 0.55, s * 0.90, 0, 0.28, M['nero'])
    for i in range(4):
        pl.box_game(f"listello_{i}", 2.0, 0.12, 0.05, 0, -0.24 + i * 0.16, 0.50, M['legno'])
    for i in range(3):
        pl.box_game(f"schienale_{i}", 2.0, 0.05, 0.10, 0, 0.30, 0.60 + i * 0.14, M['legno'])
    pl.box_game("COL_panchina", 2.0, 0.65, 0.85, 0, 0, 0, M['nero'])
    pl.export_glb("panchina.glb")
    pl.render_previews("panchina", ortho_scale=3)

if ASSET == 'aiuola':
    pl.box_game("cordolo_n", 2.6, 0.18, 0.45, 0, -0.56, 0, M['cordolo'])
    pl.box_game("cordolo_s", 2.6, 0.18, 0.45, 0, 0.56, 0, M['cordolo'])
    pl.box_game("cordolo_e", 0.18, 1.3, 0.45, 1.21, 0, 0, M['cordolo'])
    pl.box_game("cordolo_o", 0.18, 1.3, 0.45, -1.21, 0, 0, M['cordolo'])
    pl.box_game("terra", 2.3, 1.0, 0.38, 0, 0, 0, M['legno'])
    pl.box_game("prato", 2.24, 0.94, 0.10, 0, 0, 0.38, M['prato'])
    import bpy as _b
    for (sx, sz, r) in ((-0.6, 0.1, 0.28), (0.55, -0.12, 0.34)):
        _b.ops.mesh.primitive_uv_sphere_add(radius=r, location=(sx, -sz, 0.52))
        o = _b.context.object; o.name = f"cespuglio_{sx}"
        o.data.materials.append(M['verde'])
    pl.box_game("COL_aiuola", 2.6, 1.3, 0.5, 0, 0, 0, M['cordolo'])
    pl.export_glb("aiuola.glb")
    pl.render_previews("aiuola", ortho_scale=3)
```

- [ ] **Step 2: Render entrambi + gate utente.**
- [ ] **Step 3: Istanze layout** — 4 panchine sull'anello r-frazione 0.58 ai quadranti diagonali (t 45°,135°,225°,315°, fronte verso la fontana: rotY = tangente_rotY(t)+180) e 4 aiuole sull'anello 0.72 ai semi-cardinali sfalsati (t 20°,160°,200°,340°), evitando il quadrante del chiosco. Rigenerare JSON + top render finale con TUTTE le istanze. Gate utente sul top render completo.

---

### Task 9: Integrazione fps.js + verifica visiva in gioco

**Files:**
- Modify: `frontend/fps.js:3214-3221` (`_boot`)

**Interfaces:**
- Consumes: `piazza-layout.json` + GLB in `frontend/assets/models/piazza/`.
- Produces: piazza caricata nel mondo EXTENDED (collisioni incluse via COL_*).

- [ ] **Step 1: Aggiungere il loadZone** dentro la `Promise.all` del ramo EXTENDED:

```js
            loadZone('assets/models/piazza/', 'piazza-layout.json', { pav: false }),
```

- [ ] **Step 2: Sintassi** — Run: `node --check frontend/fps.js` → exit 0.
- [ ] **Step 3: Screenshot harness** — riusare `shot-fx.js` dello scratchpad (puppeteer-core + Chrome headless swiftshader; il rAF-override di posa registrato dopo l'animate). Viste: `(47,0,1.7)` guardando est (ry=−π/2, si deve vedere fontana+chiosco+cantiere), `(64,0)` guardando ovest (ry=+π/2), `(55.5,-13)` guardando sud (ry=π), `(55.5,13)` guardando nord (ry=0). Server: quello dell'utente (chiedere di avviarlo).
Expected: piazza pavimentata, perimetro senza buchi verso il void, fontana/chiosco/arredo al posto giusto, console senza errori (`🏙 Zona assets/models/piazza/`).
- [ ] **Step 4: Collisioni** — nella stessa sessione harness, evaluate di `resolveCollisions`-smoke: impostare la posa dentro un muretto (es. mondo (55.5, 15.6)) e leggere la posizione dopo 500 ms → il player deve essere stato spinto fuori (z < 15.4). Ripetere sulla vasca fontana: posa (55.5, 2.5) → y del player ≈ 0.45 (sta SUL bordo, step-up).

---

### Task 10: Spawn server + gate finale

**Files:**
- Modify: `backend/sockets/games/fpsGameSocket.js:20-40` (array `SPAWN_POINTS`)

**Interfaces:**
- Consumes: convenzione `angle = Math.atan2(dx, dz)` verso il punto guardato (vedi righe esistenti).
- Produces: 2 spawn piazza.

- [ ] **Step 1: Aggiungere dopo il blocco GALLERIA:**

```js
    // — PIAZZA DELLA FONTANA (ovale centro 55.5,0) —
    { x: 55.5, y: 0, z: -13, angle: Math.PI },  // estremo nord, guarda la fontana (+z)
    { x: 55.5, y: 0, z:  13, angle: 0 },        // estremo sud, guarda la fontana (−z)
```

(convenzione del file: guardare verso +z → yaw=PI, verso −z → yaw=0)

- [ ] **Step 2: Verifica rapida** — `node --check backend/sockets/games/fpsGameSocket.js` → exit 0. Riavvio server = utente.
- [ ] **Step 3: Aggiornare `docs/fps-notes.md`** — sezione Mappa: aggiungere il paragrafo "Piazza della Fontana" (ovale, varchi, cantiere Funland, +2 spawn, quinte riusate) e correggere il conteggio spawn.
- [ ] **Step 4: GATE FINALE UTENTE** — partita 2 client in localhost: attraversamenti Jazz↔piazza↔Galleria, salita sul bordo vasca, coperture, spawn nuovi, flank intatti. Solo dopo l'ok dell'utente il sotto-progetto A è chiuso (commit = utente).

---

## Self-review (fatta)

- **Coverage spec**: geometria/ovale (T2-T4), fontana (T6), chiosco (T7), panchine+aiuole (T8), pavimentazione (T2), muretto (T4), cantiere FUNLAND (T5), quinte (T4), monconi collegamenti (T3), loadZone+COL (T9), spawn (T10), verifiche (T9-T10). Fuori scope rispettato (niente arco sud, lampioni, sottopasso).
- **Placeholder**: le ricette Blender sono punti di partenza COMPLETI ed eseguibili; l'iterazione estetica è un ciclo esplicito con gate utente (natura visiva della pipeline, come per le armi G4.1).
- **Coerenza**: `piazza_base/muretto/cantiere/fontana/chiosco/panchina/aiuola` usati con gli stessi nomi in ricette e layout; `ellisse`/`tangente_rotY` definiti in T1 e usati in T4/T8; aperture coerenti con T3 (w7 z=−1.2, w9 z=0, w5 nord).
