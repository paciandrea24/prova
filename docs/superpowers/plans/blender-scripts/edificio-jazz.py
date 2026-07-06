# Edificio "Quartiere Jazz" — civico 13, stile cartoon anni '30
# Eseguibile in Blender (Text Editor -> Open -> Run Script) oppure headless:
#   blender --background --python edificio-jazz.py
# Esporta da solo il GLB e renderizza due anteprime PNG (fronte + 3/4).
import bpy
import bmesh
import math
import os
from mathutils import Vector

WORKTREE = "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz"
OUTPUT_PATH = WORKTREE + "/frontend/assets/models/jazz/edificio13.glb"
PREVIEW_DIR = WORKTREE + "/docs/superpowers/plans/blender-scripts/preview"


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)


def flat_material(name, rgba):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    for spec_key in ('Specular', 'Specular IOR Level'):
        if spec_key in bsdf.inputs:
            bsdf.inputs[spec_key].default_value = 0.1
            break
    # Colore viewport: usato dal render Workbench (anteprime) con color_type MATERIAL
    mat.diffuse_color = rgba
    return mat


def lathe_profile(name, points, material, segments=32):
    # Rivoluzione di un profilo (coppie (raggio, z) in coordinate ASSOLUTE)
    # attorno all'asse Z. Spostare con obj.location dopo la creazione.
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    profile_verts = [bm.verts.new((r, 0.0, z)) for (r, z) in points]
    for i in range(len(profile_verts) - 1):
        bm.edges.new((profile_verts[i], profile_verts[i + 1]))

    geom = list(bm.verts) + list(bm.edges)
    bmesh.ops.spin(bm, geom=geom, axis=(0, 0, 1), cent=(0, 0, 0),
                   steps=segments, angle=math.radians(360))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
    bmesh.ops.holes_fill(bm, edges=bm.edges[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    bm.to_mesh(mesh)
    bm.free()

    obj.data.materials.append(material)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()
    return obj


def skin_chain(name, spine_points, radii, material, subsurf_levels=2):
    # Solido organico da catena di vertici + Skin modifier (raggio ellittico
    # (rx, ry) per vertice) + Subdivision Surface. Tecnica validata (pesce fontana).
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    verts = [bm.verts.new(p) for p in spine_points]
    for i in range(len(verts) - 1):
        bm.edges.new((verts[i], verts[i + 1]))
    bm.to_mesh(mesh)
    bm.free()

    skin_mod = obj.modifiers.new("skin", type='SKIN')
    for i, skin_vert in enumerate(mesh.skin_vertices[0].data):
        skin_vert.radius = radii[i]
    subsurf_mod = obj.modifiers.new("smooth", type='SUBSURF')
    subsurf_mod.levels = subsurf_levels

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=skin_mod.name)
    bpy.ops.object.modifier_apply(modifier=subsurf_mod.name)

    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return obj


def _finish_box(obj, w, d, h, material, bevel):
    obj.scale = (w / 2, d / 2, h / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new("bevel", type='BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return obj


def add_box(name, w, d, h, x, y, z, material, bevel=0.02):
    # Box con BASE a z (convenzione addSolid del gioco)
    bpy.ops.mesh.primitive_cube_add(size=2, location=(x, y, z + h / 2))
    obj = bpy.context.object
    obj.name = name
    return _finish_box(obj, w, d, h, material, bevel)


def add_box_c(name, w, d, h, x, y, z, material, rot=(0.0, 0.0, 0.0), bevel=0.02):
    # Box con origine al CENTRO e rotazione libera (elementi inclinati)
    bpy.ops.mesh.primitive_cube_add(size=2, location=(x, y, z), rotation=rot)
    obj = bpy.context.object
    obj.name = name
    return _finish_box(obj, w, d, h, material, bevel)


def add_cyl(name, r, h, x, y, z, material, vertices=16):
    # Cilindro verticale con BASE a z
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=r, depth=h,
                                        location=(x, y, z + h / 2))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return obj


def add_sphere(name, radius, x, y, z, material):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=(x, y, z))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return obj


def add_strut(name, p1, p2, r, material, vertices=8):
    # Cilindro orientato tra due punti qualsiasi (ringhiere, pioli, controventi)
    p1 = Vector(p1)
    p2 = Vector(p2)
    d = p2 - p1
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=r, depth=d.length,
                                        location=(p1 + p2) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = d.to_track_quat('Z', 'Y')
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return obj


def add_text_mesh(name, body, size, x, y, z, material, extrude=0.03):
    # Testo estruso convertito in mesh, rivolto verso il fronte (-Y), centrato
    bpy.ops.object.text_add(location=(x, y, z), rotation=(math.radians(90), 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.data.body = body
    obj.data.size = size
    obj.data.extrude = extrude
    obj.data.align_x = 'CENTER'
    obj.data.align_y = 'CENTER'
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.object
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return obj


def render_previews():
    # Due anteprime PNG per il confronto con l'immagine di riferimento.
    # Chiamare DOPO l'export GLB (camera/target non devono finire nel modello).
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.display.shading.light = 'FLAT'
        scene.display.shading.color_type = 'MATERIAL'
        scene.display.shading.background_type = 'VIEWPORT'
        scene.display.shading.background_color = (0.92, 0.92, 0.92)
    except (TypeError, AttributeError):
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 1200

    # Vista frontale ortografica (confronto diretto col "FRONT VIEW" del disegno)
    cam_data = bpy.data.cameras.new("cam_front")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 15.0
    cam = bpy.data.objects.new("cam_front", cam_data)
    cam.location = (0, -30, 6.2)
    cam.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    scene.render.filepath = PREVIEW_DIR + "/front.png"
    bpy.ops.render.render(write_still=True)

    # Vista 3/4 prospettica
    cam2 = bpy.data.objects.new("cam_quarter", bpy.data.cameras.new("cam_quarter"))
    cam2.location = (14, -15, 9)
    bpy.context.collection.objects.link(cam2)
    target = bpy.data.objects.new("cam_target", None)
    target.location = (0, 0, 5.0)
    bpy.context.collection.objects.link(target)
    tc = cam2.constraints.new(type='TRACK_TO')
    tc.target = target
    tc.track_axis = 'TRACK_NEGATIVE_Z'
    tc.up_axis = 'UP_Y'
    scene.camera = cam2
    scene.render.filepath = PREVIEW_DIR + "/quarter.png"
    bpy.ops.render.render(write_still=True)
    print("Anteprime:", PREVIEW_DIR)


clear_scene()

# ── Materiali (colori piatti, palette dell'immagine di riferimento) ──
mat_mattone        = flat_material("mattone_rosso",   (0.45, 0.13, 0.11, 1.0))
mat_mattone_chiaro = flat_material("mattone_chiaro",  (0.60, 0.28, 0.22, 1.0))
mat_crema          = flat_material("pietra_crema",    (0.85, 0.80, 0.70, 1.0))
mat_legno          = flat_material("legno_scuro",     (0.35, 0.20, 0.10, 1.0))
mat_legno_chiaro   = flat_material("legno_chiaro",    (0.52, 0.33, 0.17, 1.0))
mat_vetro          = flat_material("vetro_blu",       (0.16, 0.20, 0.28, 1.0))
mat_ferro          = flat_material("ferro_ruggine",   (0.23, 0.12, 0.08, 1.0))
mat_tenda_rossa    = flat_material("tenda_rossa",     (0.62, 0.24, 0.20, 1.0))
mat_tenda_bianca   = flat_material("tenda_bianca",    (0.92, 0.88, 0.80, 1.0))
mat_tetto_serb     = flat_material("tetto_ossidato",  (0.45, 0.48, 0.42, 1.0))
mat_marciapiede    = flat_material("marciapiede",     (0.72, 0.70, 0.66, 1.0))
mat_scuro          = flat_material("inchiostro",      (0.10, 0.09, 0.09, 1.0))

# ═══ 1. CORPO EDIFICIO ═══
# Fronte 6m (X), profondita' 5.5m (Y), 3 piani = 7.4m. Fronte verso -Y.
# Base rialzata di 2cm (annegata nello zoccolo): basi complanari a z=0
# causano z-fighting guardando il modello da sotto.
add_box("corpo", 6.0, 5.5, 7.4, 0, 0, 0.02, mat_mattone, bevel=0.03)
# Zoccolo in pietra chiara alla base, leggermente sporgente
add_box("zoccolo", 6.2, 5.7, 0.4, 0, 0, 0.0, mat_crema)
# Fascia marcapiano tra piano terra e primo piano
add_box("fascia_pt", 6.15, 5.65, 0.18, 0, 0, 2.55, mat_crema)
# Toppe di mattoni in rilievo sparse sulla facciata (dettaglio fumetto)
brick_patches = [
    (-2.2, 3.4), (1.6, 3.9), (-0.9, 4.9), (2.3, 5.2),
    (-2.4, 6.1), (0.7, 6.4), (1.9, 2.9), (-1.5, 5.7),
]
for i, (bx, bz) in enumerate(brick_patches):
    add_box(f"mattone_{i}", 0.42, 0.06, 0.16, bx, -2.75, bz, mat_mattone_chiaro, bevel=0.015)

# (Il marciapiede NON fa parte del modello: la pavimentazione della via
# sara' un modello unico a livello di zona Quartiere Jazz, non per-edificio.)

# ═══ 3. PIANO TERRA ═══
# ── Portone d'ingresso (doppia anta in legno con pannelli e pomelli) ──
add_box("porta_cornice", 1.6, 0.18, 2.3, 0, -2.75, 0.01, mat_crema)
add_box("porta_fondo", 1.3, 0.10, 2.15, 0, -2.80, 0.02, mat_scuro)
for side, sx in (("L", -0.33), ("R", 0.33)):
    add_box(f"porta_anta_{side}", 0.58, 0.08, 2.05, sx, -2.84, 0.02, mat_legno)
    add_box(f"porta_pannello_alto_{side}", 0.34, 0.03, 0.72, sx, -2.89, 1.05, mat_legno_chiaro)
    add_box(f"porta_pannello_basso_{side}", 0.34, 0.03, 0.55, sx, -2.89, 0.25, mat_legno_chiaro)
add_sphere("porta_pomello_L", 0.045, -0.10, -2.93, 1.05, mat_crema)
add_sphere("porta_pomello_R", 0.045, 0.10, -2.93, 1.05, mat_crema)
# Gradini d'ingresso (due alzate)
add_box("gradino_basso", 1.9, 0.55, 0.16, 0, -3.02, 0.01, mat_crema)
add_box("gradino_alto", 1.6, 0.40, 0.30, 0, -2.95, 0.02, mat_crema)

# ── Tettoia a righe rosso/bianco sopra il portone ──
aw_w = 1.9          # larghezza totale tettoia
n_slats = 7
tilt = math.radians(-24)
for i in range(n_slats):
    sx = -aw_w / 2 + aw_w / n_slats * (i + 0.5)
    mat = mat_tenda_rossa if i % 2 == 0 else mat_tenda_bianca
    # Falda inclinata (attaccata al muro a z=2.62, sporge ~0.96m)
    add_box_c(f"tenda_falda_{i}", aw_w / n_slats + 0.01, 1.05, 0.06,
              sx, -3.23, 2.41, mat, rot=(tilt, 0, 0), bevel=0.01)
    # Lembo pendente sul bordo esterno (effetto smerlato del disegno)
    add_box_c(f"tenda_lembo_{i}", aw_w / n_slats + 0.01, 0.06, 0.22,
              sx, -3.70, 2.28, mat, bevel=0.01)

# ── Insegna civico "13" sopra la tettoia ──
# Nella fascia libera tra colmo tettoia (~2.62) e davanzale finestra centrale (2.89),
# altrimenti resta nascosta dietro il davanzale sporgente.
add_box("insegna13", 0.55, 0.08, 0.26, 0, -2.80, 2.62, mat_crema)
add_text_mesh("insegna13_testo", "13", 0.17, 0, -2.86, 2.75, mat_scuro)

# ── Vetrine laterali (cornice legno, vetro, griglia, davanzale, cimasa) ──
for side, vx in (("L", -1.95), ("R", 1.95)):
    add_box(f"vetrina_cornice_{side}", 1.8, 0.16, 1.75, vx, -2.75, 0.5, mat_legno)
    # Vetro leggermente in aggetto sulla cornice (altrimenti resta nascosto nel box)
    add_box(f"vetrina_vetro_{side}", 1.5, 0.10, 1.45, vx, -2.80, 0.65, mat_vetro)
    add_box(f"vetrina_traversa_{side}", 1.5, 0.05, 0.08, vx, -2.84, 1.30, mat_legno)
    add_box(f"vetrina_montante_{side}", 0.08, 0.05, 1.45, vx, -2.84, 0.65, mat_legno)
    add_box(f"vetrina_davanzale_{side}", 1.95, 0.28, 0.12, vx, -2.85, 0.42, mat_crema)
    add_box(f"vetrina_cimasa_{side}", 1.95, 0.22, 0.15, vx, -2.85, 2.22, mat_legno)

# ═══ 4. FINESTRE PIANI 1-2 ═══
# Finestre "normali" (senza il motivo occhio del disegno, scelta dell'utente):
# telaio crema, vetro in leggero aggetto, griglia 2x2, davanzale e cimasa sporgenti.
def add_window(tag, cx, sill_z):
    wy = -2.75
    add_box(f"fin_{tag}_telaio", 1.06, 0.14, 1.46, cx, wy, sill_z, mat_crema)
    # Vetro in aggetto sul telaio (a wy-0.02 resterebbe nascosto dentro il box)
    add_box(f"fin_{tag}_vetro", 0.86, 0.08, 1.26, cx, wy - 0.05, sill_z + 0.10, mat_vetro)
    add_box(f"fin_{tag}_traversa", 0.86, 0.04, 0.06, cx, wy - 0.09, sill_z + 0.72, mat_crema)
    add_box(f"fin_{tag}_montante", 0.06, 0.04, 1.26, cx, wy - 0.09, sill_z + 0.10, mat_crema)
    add_box(f"fin_{tag}_davanzale", 1.24, 0.26, 0.11, cx, wy - 0.06, sill_z - 0.11, mat_crema)
    add_box(f"fin_{tag}_cimasa", 1.28, 0.24, 0.17, cx, wy - 0.06, sill_z + 1.46, mat_crema)

for fi, cx in enumerate([-1.9, 0.0, 1.9]):
    add_window(f"p1_{fi}", cx, 3.0)   # primo piano
    add_window(f"p2_{fi}", cx, 5.4)   # secondo piano

# ═══ 5. CORNICIONE A MENSOLE ═══
add_box("cornicione_gola", 6.55, 6.05, 0.10, 0, 0, 7.30, mat_crema)
add_box("cornicione_fascia", 6.9, 6.4, 0.34, 0, 0, 7.40, mat_crema)
add_box("cornicione_corona", 7.15, 6.65, 0.16, 0, 0, 7.74, mat_crema)
# Mensole sotto la fascia: fronte, lati, angolari piu' grandi
for mi, mx in enumerate([-2.65, -1.77, -0.88, 0.0, 0.88, 1.77, 2.65]):
    add_box(f"mensola_f_{mi}", 0.22, 0.30, 0.30, mx, -3.05, 7.10, mat_crema)
for mi, my in enumerate([-1.8, 0.0, 1.8]):
    add_box(f"mensola_l_{mi}", 0.30, 0.22, 0.30, -3.05, my, 7.10, mat_crema)
    add_box(f"mensola_r_{mi}", 0.30, 0.22, 0.30, 3.05, my, 7.10, mat_crema)
for ai, ax in enumerate((-3.05, 3.05)):
    add_box(f"mensola_ang_{ai}", 0.34, 0.34, 0.42, ax, -3.05, 7.00, mat_crema)
# Tetto calpestabile scuro, rientrato tra i cornicioni; top a 7.92, appena
# in rilievo sulla corona (7.90) per evitare z-fighting tra le due facce
add_box("tetto", 5.8, 5.3, 0.14, 0, 0, 7.78, mat_scuro)

# ═══ 6. COMIGNOLO DOPPIO ═══
cmx, cmy = 1.9, 1.6
add_box("comignolo_fusto", 0.95, 0.55, 1.05, cmx, cmy, 7.90, mat_mattone_chiaro)
add_box("comignolo_cappello", 1.10, 0.68, 0.14, cmx, cmy, 8.95, mat_crema)
add_cyl("comignolo_canna_L", 0.14, 0.35, cmx - 0.22, cmy, 9.09, mat_scuro, vertices=12)
add_cyl("comignolo_canna_R", 0.14, 0.35, cmx + 0.22, cmy, 9.09, mat_scuro, vertices=12)

# ═══ 7. SCALA ANTINCENDIO ═══
# Due balconi in ferro sulla facciata (davanti alla colonna centrale di
# finestre, come nel disegno), collegati da una rampa obliqua a zig-zag,
# con scaletta pendente verso il marciapiede e scala a pioli sul lato destro.
def add_balcony(tag, cx, deck_z, w=2.7, d=0.85):
    fy = -2.75                 # filo facciata
    yc = fy - d / 2
    y_out = fy - d + 0.03      # bordo esterno del pianale
    add_box(f"se_{tag}_pianale", w, d, 0.07, cx, yc, deck_z, mat_ferro, bevel=0.015)
    rail_h = 0.95
    # Corrimano superiore + corrente intermedio (fronte e fianchi)
    for gi, rz in enumerate((deck_z + rail_h, deck_z + rail_h * 0.55)):
        add_strut(f"se_{tag}_corrente_f{gi}", (cx - w / 2, y_out, rz), (cx + w / 2, y_out, rz), 0.035, mat_ferro)
        add_strut(f"se_{tag}_corrente_l{gi}", (cx - w / 2, fy, rz), (cx - w / 2, y_out, rz), 0.035, mat_ferro)
        add_strut(f"se_{tag}_corrente_r{gi}", (cx + w / 2, fy, rz), (cx + w / 2, y_out, rz), 0.035, mat_ferro)
    # Balaustre verticali sul fronte
    n_bal = 9
    for i in range(n_bal):
        bx = cx - w / 2 + w * i / (n_bal - 1)
        add_strut(f"se_{tag}_balaustra_{i}", (bx, y_out, deck_z + 0.03), (bx, y_out, deck_z + rail_h), 0.022, mat_ferro)
    # Sostegni diagonali sotto il pianale
    for si, bx in enumerate((cx - w / 2 + 0.25, cx + w / 2 - 0.25)):
        add_strut(f"se_{tag}_sostegno_{si}", (bx, fy, deck_z - 0.55), (bx, y_out, deck_z), 0.03, mat_ferro)

add_balcony("b1", 0.0, 2.95)   # balcone del primo piano
add_balcony("b2", 0.0, 5.35)   # balcone del secondo piano

# ── Rampa obliqua tra i due balconi ──
x_bot, x_top = 1.05, -1.05
z_bot, z_top = 3.02, 5.35
y_st = -3.35
add_strut("se_rampa_long_int", (x_bot, y_st + 0.25, z_bot), (x_top, y_st + 0.25, z_top), 0.04, mat_ferro)
add_strut("se_rampa_long_est", (x_bot, y_st - 0.25, z_bot), (x_top, y_st - 0.25, z_top), 0.04, mat_ferro)
n_steps = 9
for i in range(n_steps):
    t = (i + 0.5) / n_steps
    sx = x_bot + (x_top - x_bot) * t
    sz = z_bot + (z_top - z_bot) * t
    add_box_c(f"se_gradino_{i}", 0.24, 0.55, 0.05, sx, y_st, sz, mat_ferro, bevel=0.01)
# Corrimano della rampa con colonnine
add_strut("se_rampa_corrimano", (x_bot, y_st - 0.28, z_bot + 0.95), (x_top, y_st - 0.28, z_top + 0.95), 0.035, mat_ferro)
for ci, t in enumerate((0.15, 0.5, 0.85)):
    sx = x_bot + (x_top - x_bot) * t
    sz = z_bot + (z_top - z_bot) * t
    add_strut(f"se_rampa_colonnina_{ci}", (sx, y_st - 0.28, sz), (sx, y_st - 0.28, sz + 0.95), 0.022, mat_ferro)

# ── Scaletta pendente dal balcone basso verso il marciapiede ──
lx = 1.35
for oi, off in enumerate((-0.18, 0.18)):
    add_strut(f"se_scaletta_montante_{oi}", (lx + off, -3.3, 1.1), (lx + off, -3.3, 3.02), 0.03, mat_ferro)
for i in range(6):
    rz = 1.25 + i * 0.3
    add_strut(f"se_scaletta_piolo_{i}", (lx - 0.18, -3.3, rz), (lx + 0.18, -3.3, rz), 0.022, mat_ferro)

# ── Scala a pioli sul lato destro (x=+3), dal primo piano al tetto ──
sx0 = 3.0
for oi, off in enumerate((-0.22, 0.22)):
    add_strut(f"lato_montante_{oi}", (sx0 + 0.28, off, 1.3), (sx0 + 0.28, off, 7.6), 0.032, mat_ferro)
for i in range(18):
    rz = 1.5 + i * 0.34
    add_strut(f"lato_piolo_{i}", (sx0 + 0.28, -0.22, rz), (sx0 + 0.28, 0.22, rz), 0.024, mat_ferro)
# Staffe di ancoraggio al muro
for bi, rz in enumerate((1.8, 4.2, 6.8)):
    for oi, off in enumerate((-0.22, 0.22)):
        add_strut(f"lato_staffa_{bi}_{oi}", (sx0, off, rz), (sx0 + 0.28, off, rz), 0.026, mat_ferro)

# ═══ 8. SERBATOIO IDRICO "45" ═══
tank_x, tank_y = -1.5, 0.4
roof_z = 7.90
leg_top_z = roof_z + 2.2

# ── Traliccio: 4 gambe divaricate (skin_chain) + controventi a X ──
leg_dirs = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
for i, (dx, dy) in enumerate(leg_dirs):
    spine = [
        (tank_x + dx * 0.95, tank_y + dy * 0.95, roof_z),
        (tank_x + dx * 0.60, tank_y + dy * 0.60, leg_top_z),
    ]
    skin_chain(f"serb_gamba_{i}", spine, [(0.07, 0.07), (0.05, 0.05)], mat_legno, subsurf_levels=1)
corners_b = [(tank_x + dx * 0.95, tank_y + dy * 0.95, roof_z + 0.15) for dx, dy in leg_dirs]
corners_t = [(tank_x + dx * 0.62, tank_y + dy * 0.62, leg_top_z - 0.10) for dx, dy in leg_dirs]
for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):
    add_strut(f"serb_controvento_{a}{b}_1", corners_b[a], corners_t[b], 0.028, mat_legno)
    add_strut(f"serb_controvento_{a}{b}_2", corners_b[b], corners_t[a], 0.028, mat_legno)
# Piattaforma di appoggio
add_box("serb_piattaforma", 1.75, 1.75, 0.10, tank_x, tank_y, leg_top_z, mat_legno)

# ── Botte (lathe con leggera pancia) + cerchioni metallici ──
bar_z = leg_top_z + 0.10
botte_profile = [
    (0.55, bar_z),
    (0.80, bar_z + 0.06),
    (0.86, bar_z + 0.55),
    (0.88, bar_z + 0.90),
    (0.86, bar_z + 1.25),
    (0.80, bar_z + 1.62),
    (0.70, bar_z + 1.70),
    (0.0,  bar_z + 1.70),
]
botte = lathe_profile("serb_botte", botte_profile, mat_legno_chiaro, segments=24)
botte.location = (tank_x, tank_y, 0)
for hi, (hz, hr) in enumerate(((0.35, 0.87), (0.90, 0.90), (1.45, 0.86))):
    bpy.ops.mesh.primitive_torus_add(major_radius=hr, minor_radius=0.028,
                                     location=(tank_x, tank_y, bar_z + hz))
    hoop = bpy.context.object
    hoop.name = f"serb_cerchione_{hi}"
    hoop.data.materials.append(mat_ferro)
    bpy.ops.object.shade_smooth()

# ── Tetto conico con punta ──
cone_z = bar_z + 1.70
tetto_profile = [
    (1.02, cone_z),
    (0.98, cone_z + 0.10),
    (0.35, cone_z + 0.75),
    (0.10, cone_z + 0.95),
    (0.10, cone_z + 1.10),
    (0.0,  cone_z + 1.12),
]
serb_tetto = lathe_profile("serb_tetto", tetto_profile, mat_tetto_serb, segments=24)
serb_tetto.location = (tank_x, tank_y, 0)

# ── Pannello "45" sul fronte della botte ──
add_box_c("serb_pannello", 0.62, 0.06, 0.55, tank_x, tank_y - 0.90, bar_z + 0.95, mat_crema)
add_text_mesh("serb_45", "45", 0.34, tank_x, tank_y - 0.95, bar_z + 0.95, mat_vetro)

# ── Scaletta appoggiata al serbatoio (dal tetto alla piattaforma) ──
lt = Vector((tank_x + 1.0, tank_y - 0.8, leg_top_z + 0.4))
lb = Vector((tank_x + 2.1, tank_y - 1.5, roof_z))
lad_dir = lt - lb
perp = lad_dir.cross(Vector((0, 0, 1)))
perp.normalize()
for si, s in enumerate((-0.2, 0.2)):
    add_strut(f"serb_scaletta_montante_{si}", lb + perp * s, lt + perp * s, 0.03, mat_legno)
for i in range(1, 7):
    t = i / 7
    p = lb.lerp(lt, t)
    add_strut(f"serb_scaletta_piolo_{i}", p - perp * 0.2, p + perp * 0.2, 0.022, mat_legno)

# ═══ 9. COLLISIONE ═══
# Convenzione pipeline GLB del gioco: mesh "COL_*" invisibili in game, usate
# solo per l'AABB in solidBoxes. Un box per il corpo dell'edificio; scala
# antincendio/serbatoio/tettoia restano solo visivi (come i prop leggeri).
# Rientrata di 2cm per lato rispetto al corpo: facce complanari col muro
# causano z-fighting (sfarfallio) quando si orbita il modello in Blender.
add_box("COL_corpo", 5.96, 5.46, 7.38, 0, 0, 0.01, mat_scuro, bevel=0)

# ═══ EXPORT + PREVIEW ═══
os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUTPUT_PATH, export_format='GLB')
print("Esportato:", OUTPUT_PATH)
render_previews()
