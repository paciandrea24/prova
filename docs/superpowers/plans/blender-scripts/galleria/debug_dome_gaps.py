# debug_dome_gaps.py — riproduce il "bug 2": aperture azzurre presso la cupola viste
# dall'interno. Importa la galleria completa (pavimentazione + edifici) a offset 0,
# imposta lo sfondo del mondo AZZURRO come lo skybox di gioco, e renderizza dalla
# rotonda ad altezza giocatore (1.7) verso un ANGOLO e verso un BRACCIO.
# Se le "aperture" coincidono col vetro (vetro_cielo) → è il vetro che legge come cielo;
# se sono buchi dove non c'è geometria → vero gap del modello.
import sys, json, math
WT = "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-galleria-art-deco"
sys.path.insert(0, WT + "/docs/superpowers/plans/blender-scripts/galleria")
import bpy
MODELS = WT + "/frontend/assets/models/galleria-wip"
PREV = WT + "/docs/superpowers/plans/blender-scripts/galleria/preview"

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


gal = json.load(open(MODELS + "/galleria-layout.json"))
place(MODELS + "/pavimentazione.glb", 0, 0, 0)
for e in gal['edifici']:
    place(MODELS + "/" + e['modello'] + ".glb", e['x'], e['z'], e.get('rotY', 0), e.get('y', 0), e.get('s', 1))

for ob in bpy.data.objects:
    if ob.name.startswith("COL_"):
        ob.hide_render = True

# ── SFONDO AZZURRO come lo skybox di gioco ──
world = bpy.data.worlds['World'] if 'World' in bpy.data.worlds else bpy.data.worlds.new('World')
bpy.context.scene.world = world
world.use_nodes = False
world.color = (0.53, 0.72, 0.92)   # azzurro cielo realistico (magenta = 1,0,1 per isolare i buchi)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.background_type = 'WORLD'   # usa il colore del mondo come sfondo
# BACKFACE CULLING: riproduce il comportamento di Three.js FrontSide (default di worldToon).
# Se attivandolo compaiono le "fessure azzurre" → la causa e' il culling (normali verso l'esterno).
scene.display.shading.show_backface_culling = True
scene.render.resolution_x = 1400
scene.render.resolution_y = 1000


def render_from(name, loc, tgt, lens=15):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    cam.data.clip_end = 800
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


# camera nella rotonda (blender by = -z_gioco). Altezza ~mezzanino (5) come la foto utente.
# Vista LARGA dal braccio nord verso la rotonda (riproduce la foto #2)
render_from("dome_arm", (0.0, 16.0, 5.0), (0.0, 0.0, 6.5), lens=16)
# I 4 ANGOLI (giunti braccio↔rotonda) visti dal centro, ad altezza muro (cerco lo spiraglio azzurro)
render_from("dome_cornerNE", (0.0, 0.0, 5.0), (7.5, 7.5, 6.5), lens=20)
render_from("dome_cornerNW", (0.0, 0.0, 5.0), (-7.5, 7.5, 6.5), lens=20)
# Vista dal centro verso il braccio nord + i due angoli che lo fiancheggiano
render_from("dome_arm_junc", (0.0, 3.0, 5.5), (0.0, 14.0, 7.0), lens=14)
# Vista dal MEZZANINO (secondo piano, z~5.5) verso l'angolo/cupola: controlla il glitch
# "muri non integrati con la cupola"
render_from("dome_mezz", (6.0, 6.0, 5.6), (0.0, 0.0, 8.5), lens=16)
# Braccio EST (portale SIGILLATO): NON deve avere magenta al fondo (se ne ha = vero buco).
# blender bx=x, by=-z. Braccio est game +x → blender +x.
render_from("dome_arm_E", (9.0, 0.0, 4.5), (30.0, 0.0, 5.5), lens=15)
print("debug_dome_gaps completato")
