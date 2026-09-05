"""Anteprima del palazzo dei box: la FILA, non il pezzo singolo.

⚠️ PERCHE' ESISTE. Il render di una fetta da sola non dice niente su ciò che
conta qui: il RITMO. La versione precedente di questa voce — due tetti che si
alternavano — è arrivata al playtest con quattro render singoli tutti buoni, ed
è tornata indietro con «sembra tutto uguale». Quello che va giudicato è la fila
montata, e in CURVA, perché è lì che si aprono i giunti.

Uso (dalla root del repo):
    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
        --python backend/tools/f1PalazzoBoxAnteprima.py

Non esporta nessun .glb: è solo uno strumento di giudizio.
Output: backend/tools/renders/circuit/palazzoBox-fila.png
        backend/tools/renders/circuit/palazzoBox-corsia.png
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
from circuitAssets import pitPalazzo  # noqa: E402

PASSO = pitPalazzo.PASSO      # 7.5

# ⚠️ 1.2 GRADI PER FETTA non è un numero decorativo: è la curvatura peggiore
# misurata sulle piste in cartella (20° sulle 160 unità del tratto dei box, cioè
# 0.9°/fetta, arrotondati per eccesso). Una fila dritta mostrerebbe il palazzo
# nel caso più facile, che non è quello che il gioco costruisce.
GRADI_PER_FETTA = 1.2

# La sequenza vera, quella che pitClubProfilo produce: due teste ai capi, gli
# Span dove sotto c'è un box del giocatore, una torre a rompere il ritmo.
SEQUENZA = [
    ('head', pitPalazzo.build_pit_club_head),
    ('bay', pitPalazzo.build_pit_club_bay),
    ('span', pitPalazzo.build_pit_club_span),
    ('span', pitPalazzo.build_pit_club_span),
    ('bay', pitPalazzo.build_pit_club_bay),
    ('tower', pitPalazzo.build_pit_club_tower),
    ('bay', pitPalazzo.build_pit_club_bay),
    ('span', pitPalazzo.build_pit_club_span),
    ('span', pitPalazzo.build_pit_club_span),
    ('head', pitPalazzo.build_pit_club_head),
]

voxelKit.clear_scene()

# Le fette stanno su un ARCO, non su una retta: raggio ricavato dal passo e
# dall'angolo, così l'accostamento è quello vero.
raggio = PASSO / (2 * math.sin(math.radians(GRADI_PER_FETTA) / 2))

alt_max = 0.0
for i, (tipo, build) in enumerate(SEQUENZA):
    kit = voxelKit.VoxelKit(f'fetta{i}')
    _span, alto = build(kit)
    ang = math.radians(GRADI_PER_FETTA) * (i - (len(SEQUENZA) - 1) / 2)
    # Centro della fetta sull'arco, e rotazione attorno a Z per seguirlo.
    cx = raggio * math.sin(ang)
    cy = raggio * (1 - math.cos(ang))
    # ⚠️ pitClubSpan è il SOLO primo piano e il suo pivot sta alla base di
    # quello: si posa a quota SOLAIO_Z, come fa trackScenery col layout.
    dz = pitPalazzo.SOLAIO_Z if tipo == 'span' else 0.0
    # ⚠️ GIRA LA PRIMA, NON L'ULTIMA. Il fianco chiuso sta su +X del modello:
    # lasciata dritta, la testa iniziale lo punta verso l'interno della fila e
    # il capo del palazzo resta aperto, con la sezione a vista — segnalato
    # dall'utente sul primo render («l'estremita' di sinistra sembra tagliata»).
    # Chi guarda un palazzo si aspetta che i due fianchi chiudano in FUORI.
    giro = math.pi if (tipo == 'head' and i == 0) else 0.0
    for _mat, obj in kit.parts:
        x, y = obj.location.x, obj.location.y
        if giro:
            x, y = -x, -y
        obj.location.x = cx + x * math.cos(ang) - y * math.sin(ang)
        obj.location.y = cy + x * math.sin(ang) + y * math.cos(ang)
        obj.location.z += dz
        obj.rotation_euler.z += ang + giro
    alt_max = max(alt_max, alto + dz)

larghezza = (len(SEQUENZA) - 1) * PASSO + pitPalazzo.W

voxelKit.setup_preview_scene(larghezza)
voxelKit.add_scale_reference(0.0)
# L'auto di riferimento va davanti alla fila, sulla corsia box.
for obj in bpy.context.scene.objects:
    if obj.parent is None and obj.name.startswith(('f1Car', 'Scene', 'Sketchfab')):
        obj.location.y -= 20.0

scene = bpy.context.scene
cam_data = bpy.data.cameras.new('cam_fila')
cam_obj = bpy.data.objects.new('cam_fila', cam_data)
bpy.context.collection.objects.link(cam_obj)
scene.camera = cam_obj
scene.render.resolution_x = 1800
scene.render.resolution_y = 800
os.makedirs(voxelKit.RENDER_DIR, exist_ok=True)

# Vista di tre quarti: il palazzo intero, per giudicare se si legge come UN
# edificio e se i giunti in curva si vedono.
target = Vector((0, 0, alt_max * 0.45))
# 1.7 e non 1.35: a distanza minore il capo destro finiva fuori inquadratura,
# e le due teste sono proprio quello che questa vista deve mostrare.
cam_obj.location = target + Vector((0.45, -1.0, 0.30)).normalized() * (larghezza * 1.7)
cam_obj.rotation_euler = (target - cam_obj.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = os.path.join(voxelKit.RENDER_DIR, 'palazzoBox-fila.png')
bpy.ops.render.render(write_still=True)
print(f'[palazzoBox] fila di {len(SEQUENZA)} fette -> {scene.render.filepath}')

# Vista dalla corsia box, all'altezza di chi ci passa: è da qui che il giocatore
# guarda i box durante una sosta.
cam_obj.location = Vector((-larghezza * 0.62, -88.0, 7.0))
direzione = Vector((larghezza * 0.10, 0, alt_max * 0.50)) - cam_obj.location
cam_obj.rotation_euler = direzione.to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = os.path.join(voxelKit.RENDER_DIR, 'palazzoBox-corsia.png')
bpy.ops.render.render(write_still=True)
print(f'[palazzoBox] vista dalla corsia -> {scene.render.filepath}')
