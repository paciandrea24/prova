# galleria_lib.py — libreria condivisa Galleria d'Arte Art Déco
# Clone di jazz_lib.py (helper geometrici VALIDATI, copiati as-is) + palette Déco
# e helper nuovi per i motivi Art Déco (lesene scanalate, sunburst, parapetto
# in ottone, cornici a gradoni). Le ricette la importano con:
#   import sys; sys.path.insert(0, ".../blender-scripts/galleria")
#   import galleria_lib as gl
import bpy
import bmesh
import math
import os
import random
import zlib
from mathutils import Vector

WORKTREE = "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-galleria-art-deco"
MODELS_DIR = WORKTREE + "/frontend/assets/models/galleria"
PREVIEW_DIR = WORKTREE + "/docs/superpowers/plans/blender-scripts/galleria/preview"


# ─────────────────────────────────────────────────────────────
# HELPER GEOMETRICI (copiati da jazz_lib, validati)
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
    # unitario di Blender ha lato 2, scala w/2 -> dimensione w.
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
    # Cilindro orientato tra due punti qualsiasi (ringhiere, pioli, aste sunburst)
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


def rng_per(nome):
    # RNG deterministico per nome (PYTHONHASHSEED cambia tra run: crc32 e' stabile)
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
    # Le mesh COL_* (collisione) si nascondono SOLO nel render: in gioco le
    # nasconde il loader, ma nei PNG coprirebbero tutta la geometria.
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    for obj in bpy.data.objects:
        if obj.name.startswith("COL_"):
            obj.hide_render = True
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
# PALETTE E MATERIALI ART DÉCO
# ─────────────────────────────────────────────────────────────

# Palette Déco: crema/avorio (pareti), oro/ottone (dettagli), nero (zoccoli e
# contrasti), verdeacqua (accenti), vetri chiari da lucernario, marmi pavimento
DECO = {
    'crema':        (0.87, 0.82, 0.70, 1.0),
    'avorio':       (0.93, 0.89, 0.79, 1.0),
    'oro':          (0.83, 0.62, 0.24, 1.0),
    'ottone':       (0.72, 0.53, 0.22, 1.0),
    'nero':         (0.09, 0.09, 0.10, 1.0),
    'verdeacqua':   (0.33, 0.62, 0.57, 1.0),
    'verde_scuro':  (0.14, 0.32, 0.30, 1.0),
    'vetro_cielo':  (0.64, 0.75, 0.76, 1.0),   # lucernari/cupola (chiaro)
    'vetro_scuro':  (0.15, 0.19, 0.26, 1.0),   # vetrine negozi (scuro, come jazz)
    'marmo_chiaro': (0.82, 0.78, 0.71, 1.0),
    'marmo_scuro':  (0.28, 0.26, 0.25, 1.0),
    'marmo_verde':  (0.22, 0.38, 0.34, 1.0),
    'legno':        (0.35, 0.20, 0.10, 1.0),
    'interno':      (0.42, 0.36, 0.30, 1.0),   # pareti interne negozi
}


def make_materials():
    # Set unico condiviso da tutti i pezzi del kit (merge per materiale in gioco)
    m = {k: flat_material(k, v) for k, v in DECO.items()}
    m['neon_caldo'] = neon_material("neon_caldo", (1.0, 0.85, 0.55, 1.0))
    m['neon_verde'] = neon_material("neon_verde", (0.55, 1.0, 0.92, 1.0))
    return m


# ─────────────────────────────────────────────────────────────
# HELPER ART DÉCO (nuovi)
# ─────────────────────────────────────────────────────────────

def lesena(tag, x, y, w, h, mats, d=0.55, scanalature=3):
    # Lesena (pilastro piatto) scanalata con base nera e capitello a gradoni.
    # Fronte verso -Y: le scanalature sono strisce incassate sul fronte.
    add_box(f"les_{tag}_base", w + 0.14, d + 0.14, 0.55, x, y, 0.0, mats['nero'])
    add_box(f"les_{tag}_fusto", w, d, h - 0.55, x, y, 0.55, mats['avorio'])
    passo = w / (scanalature + 1)
    for i in range(scanalature):
        sx = x - w / 2 + passo * (i + 1)
        add_box(f"les_{tag}_scan_{i}", 0.07, 0.06, h - 1.5, sx, y - d / 2,
                0.95, mats['crema'], bevel=0.01)
    # capitello a gradoni (firma Déco)
    for gi, (gw, gh) in enumerate(((0.10, 0.16), (0.22, 0.14), (0.34, 0.12))):
        add_box(f"les_{tag}_cap_{gi}", w + gw, d + gw, gh, x, y,
                h - 0.42 + gi * 0.14, mats['oro'], bevel=0.01)
    return h


def sunburst(tag, x, y, z, r, mats, n_raggi=7, apertura=180.0, rot_z=0.0,
             r_asta=0.035):
    # Ventaglio a raggiera (mezzo sole Déco) nel piano verticale XZ, fronte -Y:
    # mozzo (disco con asse Y) + aste in ottone. apertura in gradi, centrata in alto.
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=r * 0.16, depth=0.10,
                                        location=(x, y, z),
                                        rotation=(math.radians(90), 0, 0))
    mozzo = bpy.context.object
    mozzo.name = f"sb_{tag}_mozzo"
    mozzo.data.materials.append(mats['oro'])
    bpy.ops.object.shade_smooth()
    a0 = math.radians(90 - apertura / 2 + rot_z)
    a1 = math.radians(90 + apertura / 2 + rot_z)
    for i in range(n_raggi):
        a = a0 + (a1 - a0) * i / max(1, n_raggi - 1)
        px, pz = x + r * math.cos(a), z + r * math.sin(a)
        add_strut(f"sb_{tag}_raggio_{i}", (x, y, z), (px, y, pz), r_asta, mats['ottone'])


def parapetto(tag, w, x, y, z, mats, h=1.05):
    # Parapetto Déco in ottone: corrimano, fascia bassa, balaustre verticali
    # alternate a coppie di diagonali (chevron). Corre lungo X, fronte -Y.
    add_box(f"par_{tag}_corrimano", w, 0.14, 0.09, x, y, z + h - 0.09, mats['ottone'], bevel=0.015)
    add_box(f"par_{tag}_fascia", w, 0.10, 0.14, x, y, z + 0.06, mats['ottone'], bevel=0.01)
    n = max(2, int(w / 0.60))
    for i in range(n + 1):
        bx = x - w / 2 + w * i / n
        add_strut(f"par_{tag}_bal_{i}", (bx, y, z + 0.18), (bx, y, z + h - 0.10),
                  0.028, mats['ottone'])
        if i < n:   # chevron decorativo tra le balaustre
            mx = x - w / 2 + w * (i + 0.5) / n
            hw = w / n * 0.42
            add_strut(f"par_{tag}_chvL_{i}", (mx - hw, y, z + 0.20),
                      (mx, y, z + h * 0.55), 0.020, mats['oro'])
            add_strut(f"par_{tag}_chvR_{i}", (mx + hw, y, z + 0.20),
                      (mx, y, z + h * 0.55), 0.020, mats['oro'])


def cornice_gradoni(tag, w, d, x, y, z, mats, gradoni=3, gh=0.14, gw=0.16,
                    verso=1):
    # Cornice a gradoni (ziggurat Déco): box impilati che si allargano (verso=1)
    # o si stringono (verso=-1) salendo.
    for gi in range(gradoni):
        s = gi if verso > 0 else (gradoni - 1 - gi)
        add_box(f"cg_{tag}_{gi}", w + gw * s * 2, d + gw * s * 2, gh, x, y,
                z + gi * gh, mats['oro'], bevel=0.01)


def arco_pieno(tag, w, spess, y, z_imposta, z_chiave, mats, mat_key='crema',
               segmenti=10, fascia=0.55, cx=0.0):
    # Fascia d'arco (semiellisse di conci-box ruotati attorno a Y) da
    # (cx-w/2, z_imposta) a (cx+w/2, z_imposta), chiave a z_chiave. Giace nel
    # piano XZ a profondita' y. Il muro sopra/il timpano li mette la ricetta.
    rx, rz = w / 2.0, z_chiave - z_imposta
    for i in range(segmenti):
        a0 = math.pi * i / segmenti
        a1 = math.pi * (i + 1) / segmenti
        x0, zz0 = cx - rx * math.cos(a0), z_imposta + rz * math.sin(a0)
        x1, zz1 = cx - rx * math.cos(a1), z_imposta + rz * math.sin(a1)
        seg_l = math.hypot(x1 - x0, zz1 - zz0) + 0.04
        ang = math.atan2(zz1 - zz0, x1 - x0)
        add_box_c(f"arco_{tag}_{i}", seg_l, spess, fascia,
                  (x0 + x1) / 2, y, (zz0 + zz1) / 2, mats[mat_key],
                  rot=(0, -ang, 0), bevel=0.01)
    return rz
