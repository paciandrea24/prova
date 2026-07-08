# debug_flank.py — render del giunto FLANK NORD ↔ galleria (porta verde portale_varco).
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


# Galleria: braccio NORD vicino al portale (local z < -14) + pavimentazione, offset x+97
gal = json.load(open(MODELS + "/galleria-wip/galleria-layout.json"))
place(MODELS + "/galleria-wip/pavimentazione.glb", 97, 0, 0)
for e in gal['edifici']:
    if e['z'] < -13:
        place(MODELS + "/galleria-wip/" + e['modello'] + ".glb", e['x'] + 97, e['z'], e.get('rotY', 0), e.get('y', 0), e.get('s', 1))

# Corridoi (flank N incluso)
place(MODELS + "/collegamenti-wip/collegamenti.glb", 0, 0, 0)

for ob in bpy.data.objects:
    if ob.name.startswith("COL_"):
        ob.hide_render = True

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'MATERIAL'
scene.render.resolution_x = 1200
scene.render.resolution_y = 900


def render_from(name, loc, tgt, ortho=None, lens=16):
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


# 1) dentro la galleria (braccio N) guarda NORD verso la porta verde. by=-z_gioco.
render_from("flank_from_gallery", (97, 22.0, 1.7), (97, 33.0, 2.4), lens=15)
# 2) dal flank guarda SUD verso la porta verde (dal lato corridoio)
render_from("flank_from_corridor", (97, 40.0, 1.7), (97, 31.0, 2.2), lens=15)
# 3) top-down sul giunto portale/flank N
render_from("flank_top", (90, 34, 60), (90, 34, 0), ortho=34)
print("debug_flank completato")
