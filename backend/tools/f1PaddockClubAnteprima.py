"""Anteprima del coronamento della fila dei box, come si vede dalla pista.

Il render di un modulo da solo non dice niente: una terrazza staccata è un
recinto con dei tavolini. Quello che va giudicato è la PILA — edificio più
coronamento — e la fila di pile una accanto all'altra, che è ciò che il gioco
costruisce lungo la corsia box.

Uso (dalla root del repo):
    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
        --python backend/tools/f1PaddockClubAnteprima.py

Non esporta nessun .glb: è solo uno strumento di giudizio.
Output: backend/tools/renders/circuit/paddockClub-fila.png
        backend/tools/renders/circuit/paddockClub-corsia.png
"""
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import voxelKit  # noqa: E402
from circuitAssets import pitBuildings  # noqa: E402
from circuitAssets import pitClub  # noqa: E402

# Il passo della fila lungo la corsia box: TrackGeometry.PIT_BOX_SPACING.
PASSO = 15.0

# Garage e uffici si alternano, ciascuno col suo coronamento: è esattamente
# l'alternanza che trackScenery.js posa lungo la corsia.
PILE = [
    (pitBuildings.build_pits_garage_closed, pitClub.build_pit_roof_terrace),
    (pitBuildings.build_pits_office, pitClub.build_pit_roof_lounge),
    (pitBuildings.build_pits_garage_closed, pitClub.build_pit_roof_terrace),
    (pitBuildings.build_pits_office, pitClub.build_pit_roof_lounge),
]

voxelKit.clear_scene()

n = 0
alt_max = 0.0
for i, (sotto, sopra) in enumerate(PILE):
    x = i * PASSO
    n += 1
    kit = voxelKit.VoxelKit(f'anteprima{n}')
    _span, alto = sotto(kit)
    for _mat, obj in kit.parts:
        obj.location.x += x

    # ⚠️ La quota del coronamento è l'ALTEZZA dell'edificio, la stessa che il
    # builder ritorna e la stessa che il gioco legge dall'ingombro dichiarato:
    # se questa anteprima usasse un numero suo, mostrerebbe una cosa che in
    # gioco non esiste.
    n += 1
    kit = voxelKit.VoxelKit(f'anteprima{n}')
    _span, alto_sopra = sopra(kit)
    for _mat, obj in kit.parts:
        obj.location.x += x
        obj.location.z += alto
    alt_max = max(alt_max, alto + alto_sopra)

larghezza = (len(PILE) - 1) * PASSO + pitBuildings.W

voxelKit.setup_preview_scene(larghezza)
voxelKit.add_scale_reference(larghezza / 2)
# L'auto di riferimento va davanti alla fila, sulla corsia box.
for obj in bpy.context.scene.objects:
    if obj.parent is None and obj.name.startswith(('f1Car', 'Scene', 'Sketchfab')):
        obj.location.y -= 16.0

scene = bpy.context.scene
cam_data = bpy.data.cameras.new('cam_fila')
cam_obj = bpy.data.objects.new('cam_fila', cam_data)
bpy.context.collection.objects.link(cam_obj)
scene.camera = cam_obj
scene.render.resolution_x = 1600
scene.render.resolution_y = 800
os.makedirs(voxelKit.RENDER_DIR, exist_ok=True)

# Vista di tre quarti: la fila intera, per giudicare il ritmo alto-basso.
target = Vector((larghezza / 2, 0, alt_max * 0.45))
cam_obj.location = target + Vector((0.40, -1.0, 0.34)).normalized() * (larghezza * 1.55)
cam_obj.rotation_euler = (target - cam_obj.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = os.path.join(voxelKit.RENDER_DIR, 'paddockClub-fila.png')
bpy.ops.render.render(write_still=True)
print(f'[paddockClub] fila di {len(PILE)} edifici -> {scene.render.filepath}')

# Vista dalla corsia box, all'altezza di chi ci passa: è da qui che il
# giocatore guarda i box durante una sosta.
cam_obj.location = Vector((larghezza * 0.10, -72.0, 5.0))
direzione = Vector((larghezza * 0.60, 0, alt_max * 0.50)) - cam_obj.location
cam_obj.rotation_euler = direzione.to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = os.path.join(voxelKit.RENDER_DIR, 'paddockClub-corsia.png')
bpy.ops.render.render(write_still=True)
print(f'[paddockClub] vista dalla corsia -> {scene.render.filepath}')
