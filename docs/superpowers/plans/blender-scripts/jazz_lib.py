# jazz_lib.py — libreria condivisa Quartiere Jazz (helper validati dall'edificio 13)
# Le ricette la importano con:
#   import sys; sys.path.insert(0, ".../blender-scripts")
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


# ─────────────────────────────────────────────────────────────
# HELPER GEOMETRICI (validati dall'edificio 13)
# ─────────────────────────────────────────────────────────────

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


def neon_material(name, rgba, strength=4.0):
    # Materiale "neon": colore piatto + Emission come MARCATORE per lo shader
    # toon (il glow vero si fa in Three.js). L'anteprima Workbench usa diffuse_color.
    mat = flat_material(name, rgba)
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if 'Emission Color' in bsdf.inputs:      # Blender 4/5
        bsdf.inputs['Emission Color'].default_value = rgba
    elif 'Emission' in bsdf.inputs:          # fallback nomi vecchi
        bsdf.inputs['Emission'].default_value = rgba
    bsdf.inputs['Emission Strength'].default_value = strength
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
    # Box con BASE a z (convenzione addSolid del gioco). size=2: il cubo
    # unitario di Blender ha lato 2, scala w/2 -> dimensione w (bug size=1 pagato).
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


# ─────────────────────────────────────────────────────────────
# PALETTE, MATERIALI, UTILITA'
# ─────────────────────────────────────────────────────────────

# Palette dall'immagine di riferimento: muro, mattoni chiari (toppe), cornici
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
                    quarter_pos=(14, -15, 9), quarter_target_z=5.0,
                    res=(900, 1200)):
    # Due anteprime PNG (fronte ortografico + 3/4) per il confronto visivo.
    # Chiamare DOPO l'export GLB (camera/target non devono finire nel modello).
    # NB: ortho_scale copre il lato MAGGIORE dell'immagine; con res verticale
    # l'orizzontale copre solo res_x/res_y di ortho_scale.
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
    scene.render.resolution_x = res[0]
    scene.render.resolution_y = res[1]

    # Vista frontale ortografica
    cam_data = bpy.data.cameras.new("cam_front")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = ortho_scale
    cam = bpy.data.objects.new("cam_front", cam_data)
    cam.location = (0, -30, alt_front)
    cam.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    scene.render.filepath = PREVIEW_DIR + "/" + prefisso + "_front.png"
    bpy.ops.render.render(write_still=True)

    # Vista 3/4 prospettica
    cam2 = bpy.data.objects.new("cam_quarter", bpy.data.cameras.new("cam_quarter"))
    cam2.location = quarter_pos
    bpy.context.collection.objects.link(cam2)
    target = bpy.data.objects.new("cam_target", None)
    target.location = (0, 0, quarter_target_z)
    bpy.context.collection.objects.link(target)
    tc = cam2.constraints.new(type='TRACK_TO')
    tc.target = target
    tc.track_axis = 'TRACK_NEGATIVE_Z'
    tc.up_axis = 'UP_Y'
    scene.camera = cam2
    scene.render.filepath = PREVIEW_DIR + "/" + prefisso + "_quarter.png"
    bpy.ops.render.render(write_still=True)
    print("Anteprime:", PREVIEW_DIR + "/" + prefisso + "_*.png")


# ─────────────────────────────────────────────────────────────
# GENERATORE EDIFICI — sotto-componenti
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
    # Doppia anta in legno con pannelli e pomelli (dall'edificio 13).
    # Le ante RIEMPIONO il vano per intero (si toccano al centro e arrivano
    # in cima al fondo scuro): nessun vuoto residuo sopra o ai lati.
    add_box("porta_cornice", 1.6, 0.18, 2.3, cx, fy, 0.01, mats['cornice'])
    add_box("porta_fondo", 1.3, 0.10, 2.15, cx, fy - 0.05, 0.02, mats['scuro'])
    for side, sx in (("L", cx - 0.325), ("R", cx + 0.325)):
        add_box(f"porta_anta_{side}", 0.66, 0.08, 2.17, sx, fy - 0.09, 0.02, mats['legno'])
        add_box(f"porta_pann_alto_{side}", 0.38, 0.03, 0.82, sx, fy - 0.14, 1.05, mats['legno_chiaro'])
        add_box(f"porta_pann_basso_{side}", 0.38, 0.03, 0.55, sx, fy - 0.14, 0.25, mats['legno_chiaro'])
    # Battente coprigiunto: copre la tacca dei bevel in cima al giunto centrale
    add_box("porta_battente", 0.07, 0.03, 2.17, cx, fy - 0.14, 0.02, mats['legno'], bevel=0.01)
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
    # Falda a due spioventi in coppi + timpani a gradoni + colmo + listelli in rilievo
    colmo_h = 1.6
    half = profondita / 2
    ang = math.atan2(colmo_h, half)
    pend = math.hypot(half, colmo_h)
    sporto = 0.35            # sporto SOLO verso la gronda (al colmo le falde si toccano)
    falda_len = pend + sporto
    for segno, tag in ((-1, "fronte"), (1, "retro")):
        # centro spostato di sporto/2 lungo la pendenza, verso la gronda
        yc = segno * (half / 2 + sporto / 2 * (half / pend))
        zc = corpo_h + colmo_h / 2 - sporto / 2 * (colmo_h / pend)
        # rot NEGATIVA: bordo esterno (gronda) in basso, colmo in alto (tetto a Λ,
        # col segno positivo veniva una V rovesciata col vertice dentro la casa)
        add_box_c(f"falda_{tag}", larghezza + 0.5, falda_len, 0.12,
                  0, yc, zc, mats['coppi'],
                  rot=(-segno * ang, 0, 0), bevel=0.015)
        for li in range(3):
            t = (li + 1) / 4.0
            add_box_c(f"listello_{tag}_{li}", larghezza + 0.54, 0.10, 0.06,
                      0, segno * (half * (1 - t)), corpo_h + colmo_h * t + 0.07, mats['ferro'],
                      rot=(-segno * ang, 0, 0), bevel=0.01)
    # Sottotetto a gradoni pieni (riempie il volume sotto le falde: chiude i
    # timpani e la vista "attraverso" il tetto dalle angolazioni basse)
    n_grad = 4
    for gi in range(1, n_grad):
        d_i = profondita * (1 - gi / n_grad) - 0.15
        add_box(f"sottotetto_{gi}", larghezza - 0.1, d_i, colmo_h / n_grad + 0.02,
                0, 0, corpo_h + (gi - 1) * colmo_h / n_grad, mats['muro'])
    colmo = add_cyl("colmo", 0.10, larghezza + 0.5, 0, 0, 0, mats['coppi'])
    colmo.rotation_euler = (0, math.radians(90), 0)
    colmo.location = (0, 0, corpo_h + colmo_h)
    return corpo_h + 0.10   # roof_z (per eventuali comignoli sul bordo)


# ─────────────────────────────────────────────────────────────
# GENERATORE EDIFICI — scala antincendio, props tetto, insegne
# ─────────────────────────────────────────────────────────────

def _balcone(tag, cx, deck_z, fy, mats, w=2.7, d=0.85):
    # Balcone in ferro con ringhiera a balaustre (dall'edificio 13)
    yc = fy - d / 2
    y_out = fy - d + 0.03
    add_box(f"se_{tag}_pianale", w, d, 0.07, cx, yc, deck_z, mats['ferro'], bevel=0.015)
    rail_h = 0.95
    for gi, rz in enumerate((deck_z + rail_h, deck_z + rail_h * 0.55)):
        add_strut(f"se_{tag}_corrente_f{gi}", (cx - w / 2, y_out, rz), (cx + w / 2, y_out, rz), 0.035, mats['ferro'])
        add_strut(f"se_{tag}_corrente_l{gi}", (cx - w / 2, fy, rz), (cx - w / 2, y_out, rz), 0.035, mats['ferro'])
        add_strut(f"se_{tag}_corrente_r{gi}", (cx + w / 2, fy, rz), (cx + w / 2, y_out, rz), 0.035, mats['ferro'])
    n_bal = 9
    for i in range(n_bal):
        bx = cx - w / 2 + w * i / (n_bal - 1)
        add_strut(f"se_{tag}_balaustra_{i}", (bx, y_out, deck_z + 0.03), (bx, y_out, deck_z + rail_h), 0.022, mats['ferro'])
    for si, bx in enumerate((cx - w / 2 + 0.25, cx + w / 2 - 0.25)):
        add_strut(f"se_{tag}_sostegno_{si}", (bx, fy, deck_z - 0.55), (bx, y_out, deck_z), 0.03, mats['ferro'])


def _scala_fronte(mats, fy, sills, h_piano):
    # Scala antincendio frontale: un balcone per piano superiore, rampe oblique
    # a zig-zag tra i balconi, scaletta pendente dal balcone piu' basso
    decks = [s - 0.05 for s in sills]
    for di, dz in enumerate(decks):
        _balcone(f"b{di + 1}", 0.0, dz, fy, mats)
    y_st = fy - 0.60
    for di in range(len(decks) - 1):
        # Direzione alternata: rampe a zig-zag
        x_bot, x_top = (1.05, -1.05) if di % 2 == 0 else (-1.05, 1.05)
        z_bot, z_top = decks[di] + 0.07, decks[di + 1]
        add_strut(f"se_rampa{di}_long_int", (x_bot, y_st + 0.25, z_bot), (x_top, y_st + 0.25, z_top), 0.04, mats['ferro'])
        add_strut(f"se_rampa{di}_long_est", (x_bot, y_st - 0.25, z_bot), (x_top, y_st - 0.25, z_top), 0.04, mats['ferro'])
        n_steps = 9
        for i in range(n_steps):
            t = (i + 0.5) / n_steps
            sx = x_bot + (x_top - x_bot) * t
            sz = z_bot + (z_top - z_bot) * t
            add_box_c(f"se_gradino{di}_{i}", 0.24, 0.55, 0.05, sx, y_st, sz, mats['ferro'], bevel=0.01)
        add_strut(f"se_rampa{di}_corrimano", (x_bot, y_st - 0.28, z_bot + 0.95), (x_top, y_st - 0.28, z_top + 0.95), 0.035, mats['ferro'])
        for ci, t in enumerate((0.15, 0.5, 0.85)):
            sx = x_bot + (x_top - x_bot) * t
            sz = z_bot + (z_top - z_bot) * t
            add_strut(f"se_rampa{di}_colonnina_{ci}", (sx, y_st - 0.28, sz), (sx, y_st - 0.28, sz + 0.95), 0.022, mats['ferro'])
    # Scaletta pendente dal balcone basso verso il marciapiede
    lx = 1.35
    y_lad = fy - 0.55
    z_deck = decks[0] + 0.07
    for oi, off in enumerate((-0.18, 0.18)):
        add_strut(f"se_scaletta_montante_{oi}", (lx + off, y_lad, 1.1), (lx + off, y_lad, z_deck), 0.03, mats['ferro'])
    n_pioli = max(4, int((z_deck - 1.25) / 0.3))
    for i in range(n_pioli):
        rz = 1.25 + i * 0.3
        add_strut(f"se_scaletta_piolo_{i}", (lx - 0.18, y_lad, rz), (lx + 0.18, y_lad, rz), 0.022, mats['ferro'])


def _scala_laterale(mats, x_lato, z1, z2):
    # Scala a pioli verticale sul fianco destro con staffe di ancoraggio
    for oi, off in enumerate((-0.22, 0.22)):
        add_strut(f"lato_montante_{oi}", (x_lato + 0.28, off, z1), (x_lato + 0.28, off, z2), 0.032, mats['ferro'])
    n_pioli = int((z2 - z1 - 0.2) / 0.34)
    for i in range(n_pioli):
        rz = z1 + 0.2 + i * 0.34
        add_strut(f"lato_piolo_{i}", (x_lato + 0.28, -0.22, rz), (x_lato + 0.28, 0.22, rz), 0.024, mats['ferro'])
    for bi in range(3):
        rz = z1 + 0.5 + (z2 - z1 - 1.0) * bi / 2
        for oi, off in enumerate((-0.22, 0.22)):
            add_strut(f"lato_staffa_{bi}_{oi}", (x_lato, off, rz), (x_lato + 0.28, off, rz), 0.026, mats['ferro'])


def _comignolo(mats, cmx, cmy, roof_z):
    # Comignolo doppio in mattoni chiari (dall'edificio 13)
    add_box("comignolo_fusto", 0.95, 0.55, 1.05, cmx, cmy, roof_z, mats['mattone_chiaro'])
    add_box("comignolo_cappello", 1.10, 0.68, 0.14, cmx, cmy, roof_z + 1.05, mats['cornice'])
    add_cyl("comignolo_canna_L", 0.14, 0.35, cmx - 0.22, cmy, roof_z + 1.19, mats['scuro'], vertices=12)
    add_cyl("comignolo_canna_R", 0.14, 0.35, cmx + 0.22, cmy, roof_z + 1.19, mats['scuro'], vertices=12)


def _serbatoio(mats, tank_x, tank_y, roof_z, testo="45"):
    # Serbatoio idrico su traliccio (dall'edificio 13): gambe divaricate,
    # controventi a X, botte lathe con cerchioni, tetto conico, pannello con testo
    leg_top_z = roof_z + 2.2
    leg_dirs = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for i, (dx, dy) in enumerate(leg_dirs):
        spine = [
            (tank_x + dx * 0.95, tank_y + dy * 0.95, roof_z),
            (tank_x + dx * 0.60, tank_y + dy * 0.60, leg_top_z),
        ]
        skin_chain(f"serb_gamba_{i}", spine, [(0.07, 0.07), (0.05, 0.05)], mats['legno'], subsurf_levels=1)
    corners_b = [(tank_x + dx * 0.95, tank_y + dy * 0.95, roof_z + 0.15) for dx, dy in leg_dirs]
    corners_t = [(tank_x + dx * 0.62, tank_y + dy * 0.62, leg_top_z - 0.10) for dx, dy in leg_dirs]
    for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):
        add_strut(f"serb_controvento_{a}{b}_1", corners_b[a], corners_t[b], 0.028, mats['legno'])
        add_strut(f"serb_controvento_{a}{b}_2", corners_b[b], corners_t[a], 0.028, mats['legno'])
    add_box("serb_piattaforma", 1.75, 1.75, 0.10, tank_x, tank_y, leg_top_z, mats['legno'])

    bar_z = leg_top_z + 0.10
    botte_profile = [
        (0.55, bar_z), (0.80, bar_z + 0.06), (0.86, bar_z + 0.55), (0.88, bar_z + 0.90),
        (0.86, bar_z + 1.25), (0.80, bar_z + 1.62), (0.70, bar_z + 1.70), (0.0, bar_z + 1.70),
    ]
    botte = lathe_profile("serb_botte", botte_profile, mats['legno_chiaro'], segments=24)
    botte.location = (tank_x, tank_y, 0)
    for hi, (hz, hr) in enumerate(((0.35, 0.87), (0.90, 0.90), (1.45, 0.86))):
        bpy.ops.mesh.primitive_torus_add(major_radius=hr, minor_radius=0.028,
                                         location=(tank_x, tank_y, bar_z + hz))
        hoop = bpy.context.object
        hoop.name = f"serb_cerchione_{hi}"
        hoop.data.materials.append(mats['ferro'])
        bpy.ops.object.shade_smooth()

    cone_z = bar_z + 1.70
    tetto_profile = [
        (1.02, cone_z), (0.98, cone_z + 0.10), (0.35, cone_z + 0.75),
        (0.10, cone_z + 0.95), (0.10, cone_z + 1.10), (0.0, cone_z + 1.12),
    ]
    serb_tetto = lathe_profile("serb_tetto", tetto_profile, mats['tetto_serb'], segments=24)
    serb_tetto.location = (tank_x, tank_y, 0)

    add_box_c("serb_pannello", 0.62, 0.06, 0.55, tank_x, tank_y - 0.90, bar_z + 0.95, mats['cornice'])
    add_text_mesh("serb_testo", testo, 0.34, tank_x, tank_y - 0.95, bar_z + 0.95, mats['vetro'])

    lt = Vector((tank_x + 1.0, tank_y - 0.8, leg_top_z + 0.4))
    lb = Vector((tank_x + 2.1, tank_y - 1.5, roof_z))
    lad_dir = lt - lb
    perp = lad_dir.cross(Vector((0, 0, 1)))
    perp.normalize()
    for si, s in enumerate((-0.2, 0.2)):
        add_strut(f"serb_scaletta_montante_{si}", lb + perp * s, lt + perp * s, 0.03, mats['legno'])
    for i in range(1, 7):
        t = i / 7
        p = lb.lerp(lt, t)
        add_strut(f"serb_scaletta_piolo_{i}", p - perp * 0.2, p + perp * 0.2, 0.022, mats['legno'])


def _cartellone(mats, roof_z, larghezza, testo):
    # Cartellone pubblicitario su montanti, sul tetto
    w = min(4.5, larghezza - 0.8)
    for si, sx in enumerate((-w / 2 + 0.3, w / 2 - 0.3)):
        add_box(f"cart_montante_{si}", 0.12, 0.12, 1.9, sx, 0.8, roof_z, mats['ferro'])
        add_strut(f"cart_puntone_{si}", (sx, 0.8, roof_z + 1.0), (sx, 1.6, roof_z + 0.05), 0.04, mats['ferro'])
    add_box("cart_cornice", w + 0.14, 0.06, 1.54, 0, 0.80, roof_z + 0.83, mats['legno'])
    add_box("cart_pannello", w, 0.10, 1.4, 0, 0.74, roof_z + 0.9, mats['insegna'])
    # Corpo del testo auto-scalato alla larghezza del pannello (~0.55*size a carattere)
    size = min(0.5, (w - 0.3) / (0.55 * max(1, len(testo))))
    add_text_mesh("cart_testo", testo, size, 0, 0.66, roof_z + 1.6, mats['insegna_testo'])


def _abbaino(mats, ax, corpo_h, profondita):
    # Abbaino sul tetto piatto: casotto con finestrella e tettuccio
    ay = -profondita / 2 + 1.4
    add_box("abbaino_corpo", 1.3, 1.2, 1.4, ax, ay, corpo_h + 0.40, mats['muro'])
    add_box("abbaino_tetto", 1.5, 1.4, 0.12, ax, ay, corpo_h + 1.80, mats['scuro'])
    _finestra("abbaino", ax, corpo_h + 0.65, ay - 0.60, mats, larg=0.7, alt=0.9)


def _insegna_orizzontale(mats, fy, h_pt, larghezza, testo):
    # Fascia insegna sopra il piano terra (tipo PAWN SHOP)
    w = min(larghezza - 0.6, 0.62 * len(testo) + 0.8)
    # Pannello in aggetto oltre le cimase delle vetrine (sporgono fino a fy-0.21):
    # altrimenti l'insegna finisce dietro/incrociata alle barre di legno
    add_box("insegna_h_cornice", w + 0.12, 0.06, 0.74, 0, fy - 0.14, h_pt - 0.81, mats['legno'])
    add_box("insegna_h", w, 0.12, 0.62, 0, fy - 0.16, h_pt - 0.75, mats['insegna'])
    size = min(0.34, (w - 0.4) / (0.55 * max(1, len(testo))))
    add_text_mesh("insegna_h_testo", testo, size, 0, fy - 0.30, h_pt - 0.44, mats['insegna_testo'])


def _insegna_verticale(mats, x, fy, z_top, testo):
    # Insegna a bandiera: pannello verticale sporgente + staffe, lettere in colonna
    h = 0.5 * len(testo) + 0.5
    add_box("insegna_v", 0.55, 0.10, h, x, fy - 0.40, z_top - h, mats['insegna'])
    for si, sz in enumerate((z_top - 0.2, z_top - h + 0.2)):
        add_strut(f"insegna_v_staffa_{si}", (x, fy, sz), (x, fy - 0.40, sz), 0.03, mats['ferro'])
    corpo = "\n".join(list(testo))
    add_text_mesh("insegna_v_testo", corpo, 0.34, x, fy - 0.47, z_top - h / 2, mats['insegna_testo'])


# ─────────────────────────────────────────────────────────────
# GENERATORE EDIFICI — funzione principale
# ─────────────────────────────────────────────────────────────

def build_edificio(nome, piani=3, larghezza=6.0, profondita=5.5, palette='rosso',
                   piano_terra='portone', tettoia=False, tettoia_z=None,
                   scala='nessuna', tetto='piatto', props_tetto=(), insegna=None,
                   insegna_verticale=None, serbatoio_testo="45",
                   cartellone_testo="JAZZ", h_pt=2.6, h_piano=2.4):
    # Costruisce un edificio parametrico. Ritorna quote utili per i dettagli custom.
    # NB: scala/props_tetto/insegne vengono attivati nel Task 3 del piano.
    mats = make_materials(palette)
    rnd = rng_per(nome)
    corpo_h = h_pt + (piani - 1) * h_piano
    fy = -profondita / 2          # filo facciata

    # ── Corpo, zoccolo, marcapiano, toppe mattoni ──
    if piano_terra == 'angolo':
        # Piano terra con tacca d'angolo (fronte-destra) smussata a 45:
        # due box al PT + pannello diagonale; i piani superiori sbalzano sopra.
        c = 1.1   # lato dello smusso
        add_box("corpo_sup", larghezza, profondita, corpo_h - h_pt, 0, 0, h_pt + 0.02,
                mats['muro'], bevel=0.03)
        add_box("corpo_pt_sx", larghezza - c, profondita, h_pt + 0.04, -c / 2, 0, 0.02,
                mats['muro'], bevel=0.03)
        add_box("corpo_pt_dx", c + 0.02, profondita - c, h_pt + 0.04,
                larghezza / 2 - c / 2, c / 2, 0.02, mats['muro'], bevel=0.03)
    else:
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
    elif piano_terra == 'solo_portone':
        _portone(-larghezza / 2 + 1.2, fy, mats)
    elif piano_terra == 'vetrina':
        # Vetrina a sinistra + porta a destra, clampate alla larghezza (il
        # portone e' largo 1.6: su edifici stretti sbordava e si sovrapponeva)
        larg_v = min(2.4, larghezza - 2.2)
        _vetrina("C", -larghezza / 2 + 0.2 + larg_v / 2, fy, mats, larg=larg_v)
        _portone(larghezza / 2 - 0.95, fy, mats, con_gradini=False)
    elif piano_terra == 'doppia_vetrina':
        off = larghezza / 2 - 1.15
        _vetrina("L", -off, fy, mats)
        _vetrina("R", off, fy, mats)
        _portone(0, fy, mats)
    elif piano_terra == 'angolo':
        # Pannello a 45 che chiude la tacca (vedi corpo qui sopra) + porta d'angolo
        c = 1.1
        cx, cy = larghezza / 2 - c / 2, fy + c / 2   # centro dello smusso
        rot45 = (0, 0, math.radians(45))
        n = Vector((0.7071, -0.7071, 0))             # normale esterna dello smusso
        add_box_c("angolo_pannello", 1.85, 0.22, h_pt + 0.04, cx, cy, (h_pt + 0.04) / 2 + 0.02,
                  mats['muro'], rot=rot45, bevel=0.03)
        pc = Vector((cx, cy, 0)) + n * 0.13
        add_box_c("angolo_porta_cornice", 1.35, 0.10, 2.3, pc.x, pc.y, 1.17, mats['cornice'], rot=rot45)
        pd = Vector((cx, cy, 0)) + n * 0.19
        add_box_c("angolo_porta", 1.05, 0.08, 2.15, pd.x, pd.y, 1.10, mats['legno'], rot=rot45)
        pp = Vector((cx, cy, 0)) + n * 0.26
        add_sphere("angolo_pomello", 0.045, pp.x - 0.18 * 0.7071, pp.y - 0.18 * 0.7071, 1.05, mats['cornice'])
        # Gradino d'angolo e mensola sotto lo sbalzo dei piani superiori
        gs = Vector((cx, cy, 0)) + n * 0.30
        add_box_c("angolo_gradino", 1.5, 0.45, 0.14, gs.x, gs.y, 0.09, mats['cornice'], rot=rot45)
        add_box_c("angolo_mensola", 0.6, 0.35, 0.45, cx + n.x * 0.05, cy + n.y * 0.05,
                  h_pt - 0.22, mats['cornice'], rot=rot45)
        if larghezza >= 5.0:
            _vetrina("L", -larghezza / 2 + 1.3, fy, mats)

    # ── Tettoia a righe (tettoia_z: quota d'attacco custom, es. sotto l'insegna) ──
    if tettoia:
        _tettoia_righe(0, fy, tettoia_z if tettoia_z else h_pt + 0.02, mats)

    # ── Tetto ──
    if tetto == 'piatto':
        roof_z = _tetto_piatto(larghezza, profondita, corpo_h, mats)
    else:
        roof_z = _tetto_falda(larghezza, profondita, corpo_h, mats)

    # ── Scala antincendio ──
    if scala == 'fronte' and len(sills) >= 2:
        _scala_fronte(mats, fy, sills, h_piano)
    elif scala == 'laterale':
        _scala_laterale(mats, larghezza / 2, 1.3, corpo_h + 0.2)

    # ── Props tetto (serbatoio/cartellone/abbaino solo su tetto piatto) ──
    if 'comignolo' in props_tetto:
        if tetto == 'piatto':
            _comignolo(mats, larghezza / 2 - 1.1, profondita / 2 - 1.2, roof_z)
        else:
            # Sulla falda il comignolo sta sul bordo del timpano, vicino al colmo
            _comignolo(mats, larghezza / 2 - 0.9, 0.0, corpo_h + 1.0)
    if tetto == 'piatto':
        if 'serbatoio' in props_tetto:
            _serbatoio(mats, -larghezza / 2 + 1.6, 0.4, roof_z, serbatoio_testo)
        if 'cartellone' in props_tetto:
            _cartellone(mats, roof_z, larghezza, cartellone_testo)
        if 'abbaino' in props_tetto:
            _abbaino(mats, larghezza / 2 - 1.3, corpo_h, profondita)

    # ── Insegne ──
    if insegna:
        # Sull'angolare l'insegna non deve attraversare la tacca dello smusso
        larg_insegna = larghezza - 2.6 if piano_terra == 'angolo' else larghezza
        _insegna_orizzontale(mats, fy, h_pt, larg_insegna, insegna)
    if insegna_verticale:
        _insegna_verticale(mats, -larghezza / 2 + 0.45, fy, corpo_h - 0.4, insegna_verticale)

    # ── Collisione (rientrata 2cm, base a 0.01 — anti z-fighting) ──
    if piano_terra == 'angolo':
        # La collisione segue la tacca dello smusso: un box pieno riempirebbe
        # la nicchia e coprirebbe pannello e porta (visibile in game/Blender)
        c = 1.1
        add_box("COL_corpo", larghezza - c - 0.06, profondita - 0.04, corpo_h - 0.02,
                -c / 2, 0, 0.01, mats['scuro'], bevel=0)
        add_box("COL_ala", c - 0.02, profondita - c - 0.02, corpo_h - 0.02,
                larghezza / 2 - c / 2 - 0.01, c / 2, 0.01, mats['scuro'], bevel=0)
        add_box("COL_angolo", 0.5, 0.5, corpo_h - 0.02,
                larghezza / 2 - c + 0.27, -profondita / 2 + c - 0.27, 0.01,
                mats['scuro'], bevel=0)
    else:
        add_box("COL_corpo", larghezza - 0.04, profondita - 0.04, corpo_h - 0.02,
                0, 0, 0.01, mats['scuro'], bevel=0)

    return {'mats': mats, 'roof_z': roof_z, 'front_y': fy, 'corpo_h': corpo_h,
            'colonne': colonne, 'sills': sills, 'h_piano': h_piano, 'h_pt': h_pt,
            'larghezza': larghezza, 'profondita': profondita}
