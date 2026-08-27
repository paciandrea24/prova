"""Anteprima di una FILA di facciate cittadine, come si vede in pista.

I render dei singoli moduli non dicono niente: un piano tipo da solo e' una
lastra. Quello che va giudicato e' la pila — base, piani, coronamento — e la
fila di pile una accanto all'altra, che e' cio' che il gioco costruisce.

Uso (dalla root del repo):
    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
        --python backend/tools/f1CittaFacciateAnteprima.py

Non esporta nessun .glb: e' solo uno strumento di giudizio.
Output: backend/tools/renders/circuit/cittaFacciate-fila.png
"""
import math
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import voxelKit  # noqa: E402
from circuitAssets import cittaFacciate as F  # noqa: E402

W = F.W
H_BASE, H_PIANO, H_CORONA = F.H_BASE, F.H_PIANO, F.H_CORONAMENTO

# I palazzi della fila: (famiglia, numero di piani, variante del piano tipo).
# Alterna le due famiglie e le due varianti, come fara' il seme in gioco.
PALAZZI = [
    ('Crema',   5, 'A'),
    ('Mattone', 3, 'B'),
    ('Vetro',   7, 'A'),
    ('Tortora', 4, 'B'),
    ('Ardesia', 5, 'B'),
]
# Quante colonne e' largo ogni palazzo (in gioco lo decide PALAZZO_LUNGHEZZA).
COLONNE_PER_PALAZZO = 4

# I builder veri, per assetId: citta<Tinta><Pezzo>.
BUILDER = F.builders()

voxelKit.clear_scene()

n = 0
x = 0.0
for tinta, piani, variante in PALAZZI:
    for col in range(COLONNE_PER_PALAZZO):
        z = 0.0
        # Le due basi si alternano: quattro portoni identici in fila non
        # esistono in nessuna strada.
        pila = [(f'citta{tinta}Base{"A" if col % 2 == 0 else "B"}', H_BASE)]
        pila += [(f'citta{tinta}Piano{variante}', H_PIANO)] * piani
        pila += [(f'citta{tinta}Tetto', H_CORONA)]
        for asset, alto in pila:
            n += 1
            kit = voxelKit.VoxelKit(f'anteprima{n}')
            BUILDER[asset](kit)
            for _mat, obj in kit.parts:
                obj.location.x += x
                obj.location.z += z
            z += alto
        x += W
larghezza = x

# Il nastro che sta dietro: qui e' un semplice muro grigio, serve solo a
# ricordare che i moduli non lavorano da soli.
alt_max = H_BASE + max(p[1] for p in PALAZZI) * H_PIANO + H_CORONA
bpy.ops.mesh.primitive_cube_add(size=1, location=(larghezza / 2 - W / 2, 3.0, alt_max / 2))
nastro = bpy.context.active_object
nastro.scale = (larghezza, 6.0, alt_max)
bpy.ops.object.transform_apply(scale=True)
mat = bpy.data.materials.new('nastro')
mat.use_nodes = True
mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (
    *voxelKit.PALETTE['concreteDark'], 1.0)
nastro.data.materials.append(mat)

voxelKit.setup_preview_scene(larghezza)
voxelKit.add_scale_reference(larghezza / 2)
# L'auto di riferimento va portata DAVANTI alla fila, non dentro il muro.
for obj in bpy.context.scene.objects:
    if obj.parent is None and obj.name.startswith(('f1Car', 'Scene', 'Sketchfab')):
        obj.location.y -= 14.0

cam_data = bpy.data.cameras.new('cam_fila')
cam_obj = bpy.data.objects.new('cam_fila', cam_data)
bpy.context.collection.objects.link(cam_obj)
target = Vector((larghezza / 2 - W / 2, 0, alt_max * 0.45))
cam_obj.location = target + Vector((0.45, -1.0, 0.30)).normalized() * (larghezza * 1.15)
direzione = target - cam_obj.location
cam_obj.rotation_euler = direzione.to_track_quat('-Z', 'Y').to_euler()

scene = bpy.context.scene
scene.camera = cam_obj
scene.render.resolution_x = 1600
scene.render.resolution_y = 800
os.makedirs(voxelKit.RENDER_DIR, exist_ok=True)
scene.render.filepath = os.path.join(voxelKit.RENDER_DIR, 'cittaFacciate-fila.png')
bpy.ops.render.render(write_still=True)
print(f'[cittaFacciate] fila di {len(PALAZZI)} palazzi -> {scene.render.filepath}')

# Seconda vista: dal basso e vicino, come la vede il pilota dall'abitacolo.
cam_obj.location = Vector((larghezza * 0.30, -26.0, 2.2))
direzione = Vector((larghezza * 0.62, 0, 9.0)) - cam_obj.location
cam_obj.rotation_euler = direzione.to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = os.path.join(voxelKit.RENDER_DIR, 'cittaFacciate-abitacolo.png')
bpy.ops.render.render(write_still=True)
print(f'[cittaFacciate] vista abitacolo -> {scene.render.filepath}')
