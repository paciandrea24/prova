"""
Controllo qualità degli asset del circuito: cerca le "macchie nere", cioè
cavità interne visibili da fuori e facce complanari in z-fighting (vedi la
nota in testa a voxelKit.py).

Tecnica: rende ogni .glb con ambiente bianco pieno e NESSUN sole, così
nessun pixel può essere scuro per via di un'ombra. Ogni pixel scuro residuo
è quindi un difetto di modellazione. Per i difetti trovati spara un raycast
dalla camera e stampa il punto colpito in coordinate mondo, che è ciò che
serve davvero per capire quali due volumi stanno litigando.

Uso (dalla root del repo):
    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
        --python backend/tools/circuitAssetsBlackCheck.py -- --asset grandStand

Senza --asset controlla tutti i .glb presenti in frontend/assets/custom/circuit.
Exit code 1 se almeno un asset ha pixel scuri.
"""
import bpy
import os
import sys
import glob
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import voxelKit  # noqa: E402

TMP_RENDER = os.path.join(SCRIPT_DIR, 'renders', 'circuit', '_blackcheck.png')
RES = (500, 340)
DARK_LUM = 0.02
# Qualche pixel isolato può essere solo aliasing sul bordo della silhouette
# contro lo sfondo; sotto questa soglia non vale la pena allarmarsi.
MAX_TOLERATED = 8

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
wanted = argv[argv.index('--asset') + 1].split(',') if '--asset' in argv else None


def scene_bounds():
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH':
            continue
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    return lo, hi


def check(asset_id, glb_path):
    voxelKit.clear_scene()
    bpy.ops.import_scene.gltf(filepath=glb_path)

    lo, hi = scene_bounds()
    span = max(hi.x - lo.x, hi.y - lo.y)
    height = hi.z - lo.z
    target = Vector((0, 0, height * 0.45))

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.render.resolution_x, scene.render.resolution_y = RES
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False

    # Ambiente bianco pieno, nessuna lampada: niente ombre possibili.
    bg = scene.world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 3.0

    reach = max(span, height) * 1.6 + 6
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (reach * 0.7, -reach * 0.8, height * 0.9 + span * 0.2)
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam

    scene.render.filepath = TMP_RENDER
    bpy.ops.render.render(write_still=True)

    img = bpy.data.images.load(TMP_RENDER)
    px = list(img.pixels)
    w, h = RES
    dark = []
    for j in range(h):
        for i in range(w):
            o = (j * w + i) * 4
            lum = 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]
            if lum < DARK_LUM:
                dark.append((i, j))
    bpy.data.images.remove(img)

    if len(dark) <= MAX_TOLERATED:
        print(f'[blackcheck] {asset_id:20s} OK ({len(dark)} px scuri)')
        return True

    print(f'[blackcheck] {asset_id:20s} DIFETTO: {len(dark)} px scuri')
    frame = cam.data.view_frame(scene=scene)
    tr, br, bl, tl = frame
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for (i, j) in dark[::max(1, len(dark) // 6)]:
        u, v = (i + 0.5) / w, (j + 0.5) / h
        p_local = bl.lerp(br, u).lerp(tl.lerp(tr, u), v)
        direction = (cam.matrix_world.to_3x3() @ p_local).normalized()
        hit, loc, _, _, obj, _ = scene.ray_cast(depsgraph, cam.location, direction)
        where = f'({loc.x:6.2f}, {loc.y:6.2f}, {loc.z:6.2f}) obj={obj.name}' if hit else 'nessun hit'
        print(f'    px({i:3d},{j:3d}) -> {where}')
    return False


paths = sorted(glob.glob(os.path.join(voxelKit.GLB_DIR, '*.glb')))
if wanted:
    paths = [os.path.join(voxelKit.GLB_DIR, f'{a}.glb') for a in wanted]

failed = []
for p in paths:
    asset_id = os.path.splitext(os.path.basename(p))[0]
    if not check(asset_id, p):
        failed.append(asset_id)

if os.path.exists(TMP_RENDER):
    os.remove(TMP_RENDER)

print(f'[blackcheck] {len(paths) - len(failed)}/{len(paths)} puliti')
if failed:
    print(f'[blackcheck] DA CORREGGERE: {failed}')
    sys.exit(1)
