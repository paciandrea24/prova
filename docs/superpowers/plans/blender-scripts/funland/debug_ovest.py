# debug_ovest.py — render combinato REALE del perimetro Funland (Task 4):
# GLB Jazz veri dell'arco NE (senza edificio_08, gia' in varchi-skip.json),
# collegamenti-wip (corridoio servizio est) + tutte le istanze funland-layout.
# Verifiche: giunto ovest sigillato senza invadere il varco 3.5, fila sud che
# muore nei retri Jazz senza buchi, cancello est allineato al corridoio srv.
import sys, json, math
REPO = "C:/Users/pacia/Desktop/Claude Workspace/prova"
import bpy
MODELS = REPO + "/frontend/assets/models"
PREV = REPO + "/docs/superpowers/plans/blender-scripts/funland/preview"

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()


def place(glb, x, z, rot_deg, y=0.0, s=1.0):
    # import multi-root: i root ORBITANO attorno al pivot (fix v5.4)
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


# Jazz: arco NE del perimetro (i palazzi coi retri verso il parco),
# MENO edificio_08 a (32.54,-31.8): e' in varchi-skip.json (varco NE aperto).
jazz = json.load(open(MODELS + "/jazz/zona-layout.json", encoding="utf-8-sig"))
for e in jazz['edifici']:
    if e['z'] < -15 and e['x'] > 5 and not (abs(e['x'] - 32.54) < 1.0 and abs(e['z'] + 31.8) < 1.0):
        place(MODELS + "/jazz/" + e['modello'] + ".glb", e['x'], e['z'],
              e.get('rotY', 0), e.get('y', 0), e.get('s', 1))

# Collegamenti (testate + flank sud + corridoio servizio est)
place(MODELS + "/collegamenti-wip/collegamenti.glb", 0, 0, 0)

# Funland: TUTTE le istanze del layout appena generato
fun = json.load(open(MODELS + "/funland/funland-layout.json", encoding="utf-8-sig"))
for e in fun['edifici']:
    place(MODELS + "/funland/" + e['modello'] + ".glb", e['x'], e['z'],
          e.get('rotY', 0), e.get('y', 0), e.get('s', 1))

for ob in bpy.data.objects:
    if ob.name.startswith("COL_"):
        ob.hide_render = True

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'MATERIAL'
scene.render.resolution_x = 1400
scene.render.resolution_y = 1000


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


# loc/tgt in coordinate BLENDER: (x_gioco, -z_gioco, y_gioco)
# 1) Top-down INTERO parco + contorno (giudizio d'insieme)
render_from("ovest_top_full", (60, 35, 160), (60, 35, 0), ortho=95)
# 2) Zoom sul GIUNTO OVEST (raccordo + diagonale + retri jazz)
render_from("ovest_top_joint", (33, 33, 120), (33, 33, 0), ortho=30)
# 3) Zoom sulla FILA SUD verso i retri jazz (deve morire senza buchi)
render_from("ovest_top_sud", (47, 21, 120), (47, 21, 0), ortho=26)
# 4) Zoom sul CANCELLO EST + corridoio servizio (allineamento a z=-36)
render_from("ovest_top_gate", (91, 36, 120), (91, 36, 0), ortho=26)
# 5) Occhio del giocatore: dal centro parco verso il raccordo ovest
render_from("ovest_eye_raccordo", (45, 35, 1.7), (32.5, 31.8, 2.0), lens=16)
# 6) Dalla piazza verso NORD: arco d'ingresso al posto del cantiere (Task 5)
render_from("sud_eye_arco", (55.5, 10, 1.7), (55.5, 20, 4.5), lens=20)
print("debug_ovest completato")
