# Zona Jazz — Piano ③: Props di strada + layout urbano + pavimentazione — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completare la Zona Jazz: props di strada (lampione, festoni 6/10m, insegna
verticale), `pavimentazione.glb` (piazza + vie + marciapiedi), layout urbano completo
in `zona-layout.json` e render compositi di verifica contro l'immagine di riferimento.

**Architecture:** Due script: `props-strada.py` (un prop per scena → GLB in `props/`)
e `zona-jazz-layout.py` (costruisce la pavimentazione → GLB, poi importa TUTTI i GLB,
li piazza secondo la lista `PLACEMENTS`, scrive `zona-layout.json` e renderizza
top-down + prospettiche). Il layout è definito in COORDINATE DI GIOCO (three.js:
+X est, +Z sud, rotY in gradi, modello non ruotato = fronte verso +Z) e convertito
in coordinate Blender solo al piazzamento (`bx = x; by = -z; rz = rotY`).

**Tech Stack:** Blender 5.1.2 headless, `jazz_lib.py`, i 19 GLB già validati
(`edificio_01..10a`, `club.glb`).

## Global Constraints

- **NIENTE COMMIT**: mai `git add`/`git commit`/`git push`, nemmeno nel worktree — committa SOLO l'utente.
- Worktree: `C:\Users\pacia\Desktop\Claude Workspace\prova\.claude\worktrees\fps-mappa-blender-jazz`.
- Script in `docs/superpowers/plans/blender-scripts/`; GLB in `frontend/assets/models/jazz/`
  (props in sottocartella `props/`); PNG in `blender-scripts/preview/` (MAI da committare).
- 1 unità = 1 metro; base a z=0; fronte verso -Y (Blender) = +Z (gioco) dopo l'export.
- SOLO colori piatti; emissivo solo come marcatore (vetri lampade).
- `primitive_cube_add(size=2)`; niente facce complanari (rientri 1-2cm); Shade Smooth; bevel piccoli.
- Carreggiate 8-10m, MAI <6m; nessun vicolo cieco; perimetro chiuso da edifici da fondale.
- Niente full-cobblestone: dettaglio sanpietrini SOLO selettivo (bordi, tombini, piazza).
- Verifica di ogni task: headless senza Traceback + lettura render con Read.
- Comando: `& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python "<script>"`.

---

## Task 1: `props-strada.py` — lampione

**Files:**
- Create: `docs/superpowers/plans/blender-scripts/props-strada.py` (worktree)

**Interfaces:**
- Consumes: `jazz_lib`: helper geometrici, `make_materials`, `neon_material`, `export_glb`, `render_previews`
- Produces: `props/lampione.glb` e la struttura dello script (un blocco per prop,
  `clear_scene()` all'inizio di ogni blocco) che i task 2 estendono

- [ ] **Step 1: Scrivi lo script con il blocco lampione**

```python
# props-strada.py — props della Zona Jazz: lampione, festoni, insegna verticale
# Un prop per scena: clear -> build -> export -> render. Origine a terra (z=0).
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import math
import os
import jazz_lib as jl

os.makedirs(jl.MODELS_DIR + "/props", exist_ok=True)

# ═══ LAMPIONE (base lathe + palo + braccio curvo + lanterna a campana) ═══
jl.clear_scene()
mats = jl.make_materials('rosso')
mat_ghisa = jl.flat_material("ghisa_verde", (0.16, 0.22, 0.18, 1.0))
luce_calda = jl.neon_material("luce_calda", (1.00, 0.85, 0.55, 1.0), strength=3.0)

# base a rivoluzione (plinto sagomato)
jl.lathe_profile("lamp_base", [(0.26, 0.0), (0.24, 0.10), (0.15, 0.22), (0.10, 0.38), (0.07, 0.5), (0.0, 0.5)], mat_ghisa)
# palo con anello decorativo
jl.add_cyl("lamp_palo", 0.055, 3.0, 0, 0, 0.45, mat_ghisa)
jl.lathe_profile("lamp_anello", [(0.09, 0.0), (0.11, 0.05), (0.09, 0.10), (0.0, 0.10)], mat_ghisa).location = (0, 0, 2.10)
# braccio curvo in avanti (-Y) con ricciolo sotto
braccio = [(0, 0, 3.40), (0, -0.10, 3.55), (0, -0.28, 3.64), (0, -0.50, 3.66)]
jl.skin_chain("lamp_braccio", braccio, [(0.045, 0.045)] * 4, mat_ghisa, subsurf_levels=1)
ricciolo = []
for i in range(9):
    t = i / 8.0
    ang = math.radians(200 * t)
    r = 0.16 * (1 - 0.75 * t)
    ricciolo.append((0, -0.28 + r * math.sin(ang), 3.42 + r * math.cos(ang) - 0.16))
jl.skin_chain("lamp_ricciolo", ricciolo, [(0.03, 0.03)] * 9, mat_ghisa, subsurf_levels=1)
# lanterna appesa al braccio: gancio, campana, vetro caldo, puntale
jl.add_cyl("lamp_gancio", 0.02, 0.10, 0, -0.50, 3.56, mat_ghisa, vertices=8)
jl.lathe_profile("lamp_campana", [(0.02, 0.0), (0.16, -0.08), (0.20, -0.14), (0.0, -0.14)], mat_ghisa).location = (0, -0.50, 3.56)
jl.add_sphere("lamp_vetro", 0.13, 0, -0.50, 3.30, luce_calda)
jl.lathe_profile("lamp_puntale", [(0.05, 0.0), (0.03, -0.06), (0.0, -0.10)], mat_ghisa).location = (0, -0.50, 3.16)
jl.export_glb("props/lampione.glb")
jl.render_previews("lampione", ortho_scale=4.6, alt_front=1.9,
                   quarter_pos=(3, -3.5, 2.6), quarter_target_z=1.9)
```

- [ ] **Step 2: Esegui headless e guarda i render**

Run: comando headless su `props-strada.py`.
Expected: `Esportato: .../props/lampione.glb`, nessun Traceback.
Read di `lampione_front.png` / `lampione_quarter.png`. Checklist:
- si legge come lampione anni '30: plinto sagomato, palo snello, braccio che curva in avanti
- lanterna sotto il braccio con globo caldo ben visibile, ricciolo decorativo sotto il braccio
- niente pezzi staccati/fluttuanti, base a z=0

---

## Task 2: festoni di bandierine (6m, 10m) + insegna verticale prop

**Files:**
- Modify: `docs/superpowers/plans/blender-scripts/props-strada.py` (append)

**Interfaces:**
- Consumes: struttura del Task 1
- Produces: `props/festone_6m.glb`, `props/festone_10m.glb`, `props/insegna_verticale.glb`.
  Festoni: ancoraggi alle estremità su X (da x=-L/2 a x=+L/2), a z=0 la QUOTA DI AGGANCIO
  (si piazzano in alto: il layout li mette a z≈4.2)

- [ ] **Step 1: Aggiungi i blocchi festone e insegna**

```python
# ═══ FESTONI DI BANDIERINE (catenaria skin_chain + gagliardetti triangolari) ═══
for lunghezza, sag, nome in ((6.0, 0.55, "festone_6m"), (10.0, 0.95, "festone_10m")):
    jl.clear_scene()
    mats = jl.make_materials('rosso')
    colori = [jl.flat_material(f"band_{i}", rgba) for i, rgba in enumerate((
        (0.72, 0.20, 0.16, 1.0), (0.90, 0.80, 0.55, 1.0),
        (0.25, 0.42, 0.30, 1.0), (0.30, 0.40, 0.60, 1.0)))]
    n = int(lunghezza * 3)
    punti = []
    for i in range(n + 1):
        t = i / n
        x = -lunghezza / 2 + lunghezza * t
        punti.append((x, 0, -sag * (1 - (2 * t - 1) ** 2)))
    jl.skin_chain("festone_cavo", punti, [(0.015, 0.015)] * (n + 1), mats['scuro'], subsurf_levels=1)
    n_band = int(lunghezza * 1.6)
    for i in range(n_band):
        t = (i + 0.5) / n_band
        x = -lunghezza / 2 + lunghezza * t
        z = -sag * (1 - (2 * t - 1) ** 2)
        # gagliardetto = prisma triangolare (cilindro a 3 vertici) appeso punta in giu'
        jl.add_cyl(f"bandierina_{i}", 0.13, 0.03, 0, 0, 0, colori[i % 4], vertices=3)
        band = jl.bpy.context.object
        band.rotation_euler = (math.radians(90), math.radians(180), 0)
        band.location = (x, 0, z - 0.12)
    jl.export_glb(f"props/{nome}.glb")
    jl.render_previews(nome, ortho_scale=lunghezza + 1.5, alt_front=-0.4,
                       quarter_pos=(lunghezza * 0.7, -lunghezza * 0.8, 1.5), quarter_target_z=-0.4)

# ═══ INSEGNA VERTICALE A BANDIERA (prop singolo riposizionabile) ═══
jl.clear_scene()
mats = jl.make_materials('rosso')
jl._insegna_verticale(mats, 0, 0, 4.4, "DANCE")
jl.export_glb("props/insegna_verticale.glb")
jl.render_previews("insegna_v", ortho_scale=5.5, alt_front=3.0,
                   quarter_pos=(3.5, -4, 3.5), quarter_target_z=3.0)
```

- [ ] **Step 2: Esegui headless e guarda i render**

Checklist:
- festoni: cavo a catenaria credibile, gagliardetti triangolari punta in giù, colori alternati
- insegna: pannello + staffe + lettere D-A-N-C-E in colonna leggibili
- niente Traceback; 4 GLB in `props/`

---

## Task 3: `zona-jazz-layout.py` — PLACEMENTS, pavimentazione, JSON

**Files:**
- Create: `docs/superpowers/plans/blender-scripts/zona-jazz-layout.py` (worktree)

**Interfaces:**
- Consumes: tutti i GLB (`edificio_*.glb`, `club.glb`, `props/*.glb`)
- Produces:
  - `pavimentazione.glb` (piazza, marciapiedi, cordoli, tombini — SOLO pavimento)
  - `zona-layout.json`: `{"edifici": [{"modello","x","z","rotY"}...],
    "props": [...stesso formato...], "vie": [{"nome","asse","da","a","centro","larghezza"}...]}`
    — coordinate di GIOCO, rotY in GRADI, modello non ruotato = fronte +Z
  - render `zona_top.png`, `zona_sw.png`, `zona_s.png`, `zona_ne.png`

**Urbanistica (coordinate di gioco, +X est, +Z sud):**
- Piazzetta: x -9..9, z -7..8. Club ISOLA a nord della piazza a (0, -13.5), fronte sud.
- Vie: Ovest (z -4..4, x -27..-9), Est (z -4..4, x 9..27), Sud (x -4..4, z 8..26),
  Nord-Ovest (x -14.5..-6.5, z -25..-7), Nord-Est (x 6.5..14.5, z -25..-7),
  retro-club (z -25..-18, x -14.5..14.5). Tutte ≥7m, anello chiuso attorno al club.
- Perimetro chiuso da schiere; fondali (`edificio_09*`) in fondo a Ovest/Est.

- [ ] **Step 1: Scrivi lo script**

```python
# zona-jazz-layout.py — assembla la Zona Jazz: pavimentazione.glb, zona-layout.json,
# render compositi. Layout in COORDINATE DI GIOCO (x est, z sud, rotY gradi,
# fronte non ruotato = +Z); conversione a Blender: bx=x, by=-z, rz=rotY.
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import json
import math
import os
import bpy
import jazz_lib as jl

# ── LAYOUT (modello, x, z, rotY gradi) ──
EDIFICI = [
    ("club",         0.0, -13.5,   0),
    # perimetro nord (fronte sud)
    ("edificio_09",  -10.5, -28,   0), ("edificio_05", -3.75, -28,  0),
    ("edificio_03",   0.6,  -28,   0), ("edificio_04a", 5.45, -28,  0),
    ("edificio_10a", 11.95, -28,   0),
    # lato ovest della via nord-ovest (fronte est)
    ("edificio_08", -17.25, -22,  90), ("edificio_07a", -17.25, -16, 90),
    ("edificio_02", -16.0,  -9.0, 90),
    # lato est della via nord-est (fronte ovest)
    ("edificio_04",  17.25, -21.5, -90), ("edificio_06", 17.25, -15, -90),
    ("edificio_02a", 16.0,  -8.5, -90),
    # via ovest: lato nord (fronte sud) / lato sud (fronte nord) / fondale (fronte est)
    ("edificio_07", -24.0,  -6.75,  0), ("edificio_10", -18.0, -6.75,  0),
    ("edificio_05a", -24.0,  6.75, 180), ("edificio_08a", -18.25, 6.75, 180),
    ("edificio_09a", -29.75, 0.0,  90),
    # via est: lato nord / lato sud / fondale (fronte ovest)
    ("edificio_05",  18.0,  -6.75,  0), ("edificio_07",  23.75, -6.75, 0),
    ("edificio_10a", 18.25,  6.75, 180), ("edificio_04a", 24.25, 6.75, 180),
    ("edificio_09",  29.75,  0.0, -90),
    # fianchi della piazza (sud-ovest / sud-est)
    ("edificio_03a", -11.35, 6.0,  90), ("edificio_03a", 11.35, 6.0, -90),
    # via sud: lato ovest (fronte est) / lato est (fronte ovest)
    ("edificio_06",  -6.75, 12.0,  90), ("edificio_03", -6.5, 17.5, 90),
    ("edificio_05",  -6.75, 22.0,  90),
    ("edificio_08a",  6.75, 12.5, -90), ("edificio_07a", 6.75, 18.5, -90),
    ("edificio_04",   6.75, 24.0, -90),
]
PROPS = [
    ("props/lampione", -7.5, 6.5,   0), ("props/lampione",  7.5, 6.5,   0),
    ("props/lampione", -7.5, -5.5,  0), ("props/lampione",  7.5, -5.5,  0),
    ("props/lampione", -13.0, 0.0,  0), ("props/lampione", 13.0, 0.0,   0),
    ("props/lampione", -5.5, 14.0,  0), ("props/lampione",  5.5, 20.0,  0),
    ("props/festone_10m", 0.0, 9.5, 0),      # sopra l'imbocco della via sud
    ("props/festone_6m", -10.0, -8.0, 35),   # dal club all'angolare nord-ovest
    ("props/festone_6m",  10.0, -8.0, -35),  # dal club all'angolare nord-est
    ("props/insegna_verticale", -9.1, 5.2, 90),
]
FESTONE_Z = 4.2   # quota di aggancio dei festoni
VIE = [
    {"nome": "ovest", "asse": "x", "da": -27, "a": -9, "centro": 0.0, "larghezza": 8},
    {"nome": "est", "asse": "x", "da": 9, "a": 27, "centro": 0.0, "larghezza": 8},
    {"nome": "sud", "asse": "z", "da": 8, "a": 26, "centro": 0.0, "larghezza": 8},
    {"nome": "nord_ovest", "asse": "z", "da": -25, "a": -7, "centro": -10.5, "larghezza": 8},
    {"nome": "nord_est", "asse": "z", "da": -25, "a": -7, "centro": 10.5, "larghezza": 8},
    {"nome": "retro_club", "asse": "x", "da": -14.5, "a": 14.5, "centro": -21.5, "larghezza": 7},
]

# ── PAVIMENTAZIONE (solo pavimento, coordinate Blender: by = -z) ──
jl.clear_scene()
mat_strada = jl.flat_material("pietra_strada", (0.52, 0.50, 0.47, 1.0))
mat_piazza = jl.flat_material("pietra_piazza", (0.60, 0.57, 0.52, 1.0))
mat_cordolo = jl.flat_material("cordolo", (0.70, 0.68, 0.63, 1.0))
mat_sanp = jl.flat_material("sanpietrino", (0.44, 0.42, 0.40, 1.0))
mat_tombino = jl.flat_material("tombino", (0.20, 0.18, 0.16, 1.0))

jl.add_box("base_strade", 62, 60, 0.08, 0, 2.0, 0.0, mat_strada, bevel=0)      # x-31..31, z-28..32 gioco
jl.add_box("piazza", 18, 15, 0.12, 0, -0.5, 0.0, mat_piazza, bevel=0)          # z -7..8 gioco
# cordolo perimetrale piazza + file di sanpietrini sul bordo interno
jl.add_box("piazza_cordolo_n", 18.4, 0.25, 0.14, 0, 7.12, 0.0, mat_cordolo, bevel=0.01)
jl.add_box("piazza_cordolo_s", 18.4, 0.25, 0.14, 0, -8.12, 0.0, mat_cordolo, bevel=0.01)
jl.add_box("piazza_cordolo_o", 0.25, 15.0, 0.14, -9.12, -0.5, 0.0, mat_cordolo, bevel=0.01)
jl.add_box("piazza_cordolo_e", 0.25, 15.0, 0.14, 9.12, -0.5, 0.0, mat_cordolo, bevel=0.01)
for i in range(int(18 / 0.28)):
    x = -8.85 + 0.28 * i + 0.14
    jl.add_box(f"sanp_n_{i}", 0.22, 0.14, 0.035, x, 6.78, 0.12, mat_sanp, bevel=0.008)
    jl.add_box(f"sanp_s_{i}", 0.22, 0.14, 0.035, x, -7.78, 0.12, mat_sanp, bevel=0.008)
for i in range(int(14.4 / 0.28)):
    y = -7.5 + 0.28 * i + 0.14
    jl.add_box(f"sanp_o_{i}", 0.14, 0.22, 0.035, -8.78, y, 0.12, mat_sanp, bevel=0.008)
    jl.add_box(f"sanp_e_{i}", 0.14, 0.22, 0.035, 8.78, y, 0.12, mat_sanp, bevel=0.008)
# marciapiede-isola del club (sporge 1m dal footprint 13x9)
jl.add_box("marc_club", 15, 11, 0.10, 0, 13.5, 0.0, mat_cordolo, bevel=0.01)
# marciapiedi davanti alle schiere: (cx, cz, w, d) in coordinate GIOCO
MARCIAPIEDI = [
    (0.0, -24.6, 29.5, 1.4),     # fronte perimetro nord
    (-15.2, -15.5, 1.4, 18.5),   # fronte schiera ovest della via NO
    (15.2, -15.0, 1.4, 18.0),    # fronte schiera est della via NE
    (-18.0, -4.7, 18.0, 1.4),    # via ovest lato nord
    (-18.0, 4.7, 18.0, 1.4),     # via ovest lato sud
    (18.0, -4.7, 18.0, 1.4),     # via est lato nord
    (18.0, 4.7, 18.0, 1.4),      # via est lato sud
    (-4.7, 17.0, 1.4, 18.0),     # via sud lato ovest
    (4.7, 17.0, 1.4, 18.0),      # via sud lato est
]
for mi, (cx, cz, w, d) in enumerate(MARCIAPIEDI):
    jl.add_box(f"marciapiede_{mi}", w, d, 0.10, cx, -cz, 0.0, mat_cordolo, bevel=0.01)
# due tombini con anello di sanpietrini
for ti, (tx, tz) in enumerate(((-5.0, 1.5), (11.5, -1.0))):
    jl.add_cyl(f"tombino_{ti}", 0.45, 0.03, tx, -tz, 0.08, mat_tombino, vertices=20)
    for i in range(10):
        a = math.radians(36 * i)
        jl.add_box(f"tomb_sanp_{ti}_{i}", 0.20, 0.13, 0.03, tx + 0.62 * math.cos(a),
                   -tz + 0.62 * math.sin(a), 0.08, mat_sanp, bevel=0.008)
        jl.bpy.context.object.rotation_euler = (0, 0, a)
jl.export_glb("pavimentazione.glb")

# ── zona-layout.json ──
layout = {"edifici": [{"modello": m, "x": x, "z": z, "rotY": r} for m, x, z, r in EDIFICI],
          "props": [{"modello": m, "x": x, "z": z, "rotY": r,
                     "y": FESTONE_Z if "festone" in m else 0.0} for m, x, z, r in PROPS],
          "vie": VIE}
with open(jl.WORKTREE + "/frontend/assets/models/jazz/zona-layout.json", "w", encoding="utf-8") as f:
    json.dump(layout, f, indent=2, ensure_ascii=False)
print("Scritto zona-layout.json")

# ── COMPOSIZIONE: importa e piazza tutti i GLB sul pavimento ──
def piazza_glb(modello, x, z, rot_deg, alt=0.0):
    prima = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=jl.MODELS_DIR + "/" + modello + ".glb")
    for obj in set(bpy.data.objects) - prima:
        if obj.parent is None:
            obj.rotation_mode = 'XYZ'
            obj.rotation_euler = (obj.rotation_euler.x, obj.rotation_euler.y,
                                  obj.rotation_euler.z + math.radians(rot_deg))
            obj.location = (obj.location.x + x, obj.location.y - z, obj.location.z + alt)

for m, x, z, r in EDIFICI:
    piazza_glb(m, x, z, r)
for m, x, z, r in PROPS:
    piazza_glb(m, x, z, r, alt=FESTONE_Z if "festone" in m else 0.0)

# ── Render: top-down + 3 prospettiche ──
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'MATERIAL'
scene.render.resolution_x = 1400
scene.render.resolution_y = 1200
cam_top = bpy.data.objects.new("cam_top", bpy.data.cameras.new("cam_top"))
cam_top.data.type = 'ORTHO'
cam_top.data.ortho_scale = 72
cam_top.location = (0, -2, 60)
bpy.context.collection.objects.link(cam_top)
scene.camera = cam_top
scene.render.filepath = jl.PREVIEW_DIR + "/zona_top.png"
bpy.ops.render.render(write_still=True)
target = bpy.data.objects.new("zona_target", None)
target.location = (0, 2, 3)
bpy.context.collection.objects.link(target)
for nome, pos in (("sw", (-38, -42, 26)), ("s", (0, -46, 14)), ("ne", (34, 40, 24))):
    cam = bpy.data.objects.new(f"cam_{nome}", bpy.data.cameras.new(f"cam_{nome}"))
    cam.location = pos
    bpy.context.collection.objects.link(cam)
    tc = cam.constraints.new(type='TRACK_TO')
    tc.target = target
    tc.track_axis = 'TRACK_NEGATIVE_Z'
    tc.up_axis = 'UP_Y'
    scene.camera = cam
    scene.render.filepath = jl.PREVIEW_DIR + f"/zona_{nome}.png"
    bpy.ops.render.render(write_still=True)
print("Render zona completati")
```

NOTA conversione: nello script la pavimentazione usa direttamente coordinate Blender
(`by = -z_gioco`); `piazza_glb` fa la stessa conversione per i GLB. I festoni si
agganciano a `FESTONE_Z` (4.2m). La rotazione va APPLICATA in aggiunta a quella
dell'export gltf (i GLB importati hanno già la correzione assi come rotazione).

- [ ] **Step 2: Esegui headless**

Expected: `Esportato: .../pavimentazione.glb`, `Scritto zona-layout.json`,
`Render zona completati`, nessun Traceback.

---

## Task 4: QA visiva del layout (ciclo di correzione)

**Files:**
- Modify: `zona-jazz-layout.py` (solo la lista `EDIFICI`/`PROPS`/`MARCIAPIEDI` se servono aggiustamenti)

- [ ] **Step 1: Leggi `zona_top.png`** e verifica contro l'immagine di riferimento:
- piazzetta centrale col club-isola a nord, anello attorno al club percorribile
- carreggiate ≥6m OVUNQUE (misura a vista sui marciapiedi: strada = 8m tra i cordoli)
- nessun vicolo cieco; fondali che chiudono le vie O/E; perimetro chiuso a N e S
- nessuna compenetrazione visibile tra edifici adiacenti (le schiere si toccano, ok)
- nessuna coppia adiacente identica (varianti alternate)

- [ ] **Step 2: Leggi `zona_sw.png`, `zona_s.png`, `zona_ne.png`**:
- il club domina lo skyline (cresta 14m), gli altri tetti 7-12m
- lampioni ai 4 angoli della piazza + imbocchi vie; festoni visibili tra club e angolari
- pavimentazione: piazza chiara con bordo sanpietrini, marciapiedi con cordolo

- [ ] **Step 3: Correggi e ripeti** finché la checklist passa (sposta/ruota nelle liste,
NON modificare i GLB degli edifici in questo piano).

---

## Task 5: Gate utente + stato

- [ ] **Step 1: Aggiorna la sezione "Stato esecuzione"** di questo piano con
scostamenti e risultati.

- [ ] **Step 2: Gate utente**: chiedere all'utente di verificare i render `zona_*.png`
e/o aprire `zona-jazz-layout.py` in Blender (Run Script). Ogni richiesta di modifica
riapre il ciclo del Task 4. NIENTE commit (li fa l'utente).

---

## Stato esecuzione (2026-07-06, inline)

- Task 1-4 ESEGUITI: `props-strada.py` (lampione + festoni 6/10m + insegna DANCE →
  4 GLB in `props/`), `zona-jazz-layout.py` → `pavimentazione.glb`,
  `zona-layout.json` (31 edifici + 12 props + 6 vie), render `zona_top/sw/s/ne.png`
  verificati. NIENTE commit.
- Scostamenti/fix dal piano (tutti verificati a render):
  1. Gagliardetti festone: euler corretto `(90°, 180°, 0)` — punta in giù
     (con ry=90 puntavano di lato; trovato con test a 4 rotazioni).
  2. Layout v2: angolari 02/02a spostati a (±17.5, -7.25) come blocchi d'angolo
     PURI (a ±16 compenetravano le schiere delle vie O/E); via NO ovest completata
     con edificio_03 (buco di 2.5m); vie O/E lato nord ridotte a UN edificio oltre
     l'angolare; fondale SUD aggiunto (`edificio_09a` a (0, 28.75, 180)) — la via
     sud era un vicolo cieco aperto; tombino ovest spostato in strada (era sepolto
     nella piazza rialzata); lampioni ±13 spostati sul marciapiede (erano in
     carreggiata); base allargata a 68×68 (i fondali sporgevano).
- QA finale: carreggiate ≥7m ovunque, anello attorno al club percorribile, nessuna
  coppia adiacente identica, perimetro chiuso (fondali O/E/S + schiera N).
- **LAYOUT v3 (2026-07-06 sera, feedback utente: "layout completamente sbagliato,
  l'immagine segue un andamento CIRCOLARE con al centro il jazz club")**: layout
  rifatto ad anello — club ISOLA CENTRALE a (0,0) su sagrato rialzato; anello di
  strade 10m tutt'attorno; 8 edifici di schiera sui 4 lati con fronte VERSO il club;
  4 angolari 02/02a ruotati ±45/±135 ai 4 angoli (a ±14.6,±12.6 — spostamenti lungo
  la diagonale non cambiano i gap: i bordi a 45 sono invarianti); 4 uscite radiali
  (N=parco, O=galleria, S/E=citta') larghe 9m chiuse da fondali 09/09a a ±26.5.
  `zona-layout.json` riscritto (17 edifici, 11 props, 8 vie: anello_* + uscita_*).
  I varchi diagonali angolare-schiera restano ≤0.9m (impercorribili, niente vicoli).
- PROSSIMO: gate utente sui render `zona_*.png` / in Blender; poi (piano futuro,
  fuori scope) integrazione in fps.js con shader toon leggendo `zona-layout.json`.
- **v5.4 (2026-07-06, dopo gate v5.2 con richiesta modifiche)**: trovato e fixato
  BUG ROOT-CAUSE in `piazza_glb` — ogni GLB importa ~130 root separati e la
  rotazione veniva applicata a ogni root attorno alla PROPRIA origine senza
  orbitarne la posizione attorno al pivot del modello: tutti i pezzi fuori asse
  (insegne, falde, scale, sax del club) restavano al posto NON ruotato pur
  girandosi. Spiegava: edifici "difettosi" vs GLB singoli, club corrotto (−45°),
  insegne compenetranti, tetti "a V", facciate che non seguivano le frecce.
  Verificato con probe su club.glb a −45 (vecchia logica = ammasso; corretta =
  integro). Fix: orbita di (lx,ly) con lo stesso angolo prima dell'offset.
  Inoltre: pavimentazione rifatta TUTTA a sanpietrini (richiesta utente) — mesh
  unica `from_pydata`, anelli concentrici r 9.5→52, 3 toni + fuga scura, top
  jitter 0.082–0.098 (MAI 0.10: complanare con le lastre); p_flip perimetro 0.35.

## Self-review (fatta in scrittura)

- **Copertura spec (sezioni props+layout)**: lampione ✓ (T1), festoni 6/10m ✓ (T2),
  insegna verticale prop ✓ (T2), pavimentazione con dettaglio selettivo ✓ (T3),
  zona-layout.json con edifici+vie ✓ (T3), verifica top-down + prospettiche ✓ (T4),
  carreggiate ≥6m / nessun vicolo cieco / perimetro chiuso ✓ (urbanistica T3 + QA T4).
- **Contratto JSON**: coordinate di gioco, rotY in gradi, fronte non ruotato = +Z,
  festoni con campo `y` (quota aggancio) — documentato nel Task 3.
- **No placeholder**: ogni step ha codice completo; le liste di piazzamento sono
  concrete e il Task 4 è il ciclo dichiarato di raffinamento.
