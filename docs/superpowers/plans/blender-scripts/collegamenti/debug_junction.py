# debug_junction.py — render della scena COMBINATA (Jazz vicini + corridoio + galleria)
# all'innesto centrale, dal punto di vista del giocatore, per diagnosticare il muro sud.
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


# Jazz: vicini attorno all'imbocco centrale (skip idx38 rimosso)
jazz = json.load(open(MODELS + "/jazz/zona-layout.json"))
for e in jazz['edifici']:
    if e['x'] > 38 and abs(e['z']) < 22 and not (abs(e['x'] - 45.48) < 1.0 and abs(e['z'] + 1.21) < 1.0):
        place(MODELS + "/jazz/" + e['modello'] + ".glb", e['x'], e['z'], e.get('rotY', 0), e.get('y', 0), e.get('s', 1))

# Corridoio
place(MODELS + "/collegamenti-wip/collegamenti.glb", 0, 0, 0)

# Galleria: pavimentazione + braccio ovest vicino al portale (offset 97)
gal = json.load(open(MODELS + "/galleria-wip/galleria-layout.json"))
place(MODELS + "/galleria-wip/pavimentazione.glb", 97, 0, 0)
for e in gal['edifici']:
    if e['x'] + 97 < 80:
        place(MODELS + "/galleria-wip/" + e['modello'] + ".glb", e['x'] + 97, e['z'], e.get('rotY', 0), e.get('y', 0), e.get('s', 1))

for ob in bpy.data.objects:
    if ob.name.startswith("COL_"):
        ob.hide_render = True

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'MATERIAL'
scene.world.color = (0.53, 0.81, 0.92) if scene.world else None
scene.render.resolution_x = 1200
scene.render.resolution_y = 900


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


# 1) Occhio del giocatore: dentro la galleria (x=70) guarda OVEST verso il corridoio.
render_from("junction_eye", (70, -1.0, 1.7), (52, -1.0, 1.9), lens=16)
# 1b) più profondo nella galleria, FOV largo, leggermente a sud (riproduce lo screenshot)
render_from("junction_eye2", (76, -3.0, 1.6), (55, 1.0, 2.4), lens=12)
# 1c) dal corridoio (metà galleria) guarda EST verso la galleria: mostra la bocca allargata
render_from("junction_corr2gal", (57, 0.0, 1.7), (72, 0.0, 2.6), lens=13)
# 1d) sguardo verso la COPERTURA sopra la bocca allargata (per vedere fasce scoperte)
render_from("junction_cover", (60, 0.0, 1.7), (70, 0.0, 6.5), lens=12)
# 2) Top-down zoom sull'innesto (per vedere muri corridoio vs arco galleria)
render_from("junction_top", (62, 0, 140), (62, 0, 0), ortho=42)
print("debug_junction completato")
