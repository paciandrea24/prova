# debug_flank_jazz.py — render del giunto FLANK ↔ perimetro JAZZ (lato ingresso).
# Riproduce il "bug 1": l'imbocco sabbia del flank sporge dai palazzi radiali del disco.
# Importa i vicini Jazz attorno all'entrata + pavimentazione jazz + i corridoi, e
# inquadra dall'interno del disco verso l'esterno (NE e SE) + due top-down.
import sys, json, math
WT = "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-galleria-art-deco"
sys.path.insert(0, WT + "/docs/superpowers/plans/blender-scripts/galleria")
import bpy
MODELS = WT + "/frontend/assets/models"
PREV = WT + "/docs/superpowers/plans/blender-scripts/collegamenti/preview"

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()


def place(glb, x, z, rot_deg, y=0.0, s=1.0):
    prima = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    rr = math.radians(rot_deg)
    ca, sa = math.cos(rr), math.sin(rr)
    for ob in set(bpy.data.objects) - prima:
        if ob.parent is None:
            ob.rotation_mode = 'XYZ'
            ob.rotation_euler = (ob.rotation_euler.x, ob.rotation_euler.y, ob.rotation_euler.z + rr)
            ob.scale = (ob.scale.x * s, ob.scale.y * s, ob.scale.z * s)
            lx, ly = ob.location.x * s, ob.location.y * s
            ob.location = (lx * ca - ly * sa + x, lx * sa + ly * ca - z, ob.location.z * s + y)


# Jazz: pavimentazione + edifici entro raggio 16 dalle due entrate flank
jazz = json.load(open(MODELS + "/jazz/zona-layout.json"))
skip = json.load(open(MODELS + "/jazz/varchi-skip.json"))["skip"]


def is_skipped(e):
    return any(math.hypot(e['x'] - s['x'], e['z'] - s['z']) < 1.0 for s in skip)


ENTS = [(32.54, -31.80), (34.91, 29.18)]
place(MODELS + "/jazz/pavimentazione.glb", 0, 0, 0)
for e in jazz['edifici']:
    if is_skipped(e):
        continue
    if any(math.hypot(e['x'] - ex, e['z'] - ez) < 16 for ex, ez in ENTS):
        place(MODELS + "/jazz/" + e['modello'] + ".glb", e['x'], e['z'], e.get('rotY', 0), e.get('y', 0), e.get('s', 1))

# Corridoi (flank N e S inclusi)
place(MODELS + "/collegamenti-wip/collegamenti.glb", 0, 0, 0)

import os
SHOW_COL = os.environ.get("SHOW_COL") == "1"
for ob in bpy.data.objects:
    if ob.name.startswith("REF_"):
        ob.hide_render = True
    elif ob.name.startswith("COL_"):
        # COL del corridoio flank visibili solo se SHOW_COL (per verificare che il varco sia libero)
        ob.hide_render = not (SHOW_COL and ("_gw_" in ob.name or "_o_" in ob.name or "_i_" in ob.name))

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'MATERIAL'
scene.render.resolution_x = 1300
scene.render.resolution_y = 950


def render_from(name, loc, tgt, ortho=None, lens=18):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    cam.data.clip_end = 800
    if ortho:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = ortho
    else:
        cam.data.lens = lens
    cam.location = loc
    bpy.context.collection.objects.link(cam)
    t = bpy.data.objects.new("t_" + name, None)
    t.location = tgt
    bpy.context.collection.objects.link(t)
    tc = cam.constraints.new(type='TRACK_TO')
    tc.target = t
    tc.track_axis = 'TRACK_NEGATIVE_Z'
    tc.up_axis = 'UP_Y'
    scene.camera = cam
    scene.render.filepath = PREV + "/" + name + ".png"
    bpy.ops.render.render(write_still=True)
    print("RENDER:", scene.render.filepath)


# blender by = -z_gioco. Entrata NE game (32.5,-31.8) -> blender (32.5, 31.8).
# 1) dall'interno del disco verso l'entrata NE (radiale), piu' vicino
render_from("flankjz_NE_eye", (25, 24.3, 1.7), (33, 32, 2.4), lens=20)
# 2) top-down sull'entrata NE (piu' stretto)
render_from("flankjz_NE_top", (32.5, 31.8, 45), (32.5, 31.8, 0), ortho=22)
# 3) dall'interno verso l'entrata SE game (34.9,29.18) -> blender (34.9,-29.18)
render_from("flankjz_SE_eye", (26.5, -25.8, 1.7), (35.5, -30.5, 2.4), lens=20)
print("debug_flank_jazz completato")
