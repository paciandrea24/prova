# debug_pav_top.py — top render di verifica di funland_base.glb (Task 3)
# Importa il GLB esportato (verifica anche che sia valido) e renderizza
# una vista ortografica dall'alto centrata sul recinto.
import sys, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/funland")
import bpy
import funland_lib as fl

fl.clear_scene()
bpy.ops.import_scene.gltf(filepath=fl.MODELS_DIR + "/funland_base.glb")

scene = bpy.context.scene
try:
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'FLAT'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.background_type = 'VIEWPORT'
    scene.display.shading.background_color = (0.92, 0.92, 0.92)
except (TypeError, AttributeError):
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x = 1400
scene.render.resolution_y = 1000

cam_data = bpy.data.cameras.new("cam_top")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 72
cam = bpy.data.objects.new("cam_top", cam_data)
cam.location = (0, 0, 60)          # origine modello = centro recinto (63, -35)
cam.rotation_euler = (0, 0, 0)     # guarda -Z (dall'alto); nord gioco = +Y blender
bpy.context.collection.objects.link(cam)
scene.camera = cam
scene.render.filepath = fl.PREVIEW_DIR + "/funland_base_top.png"
bpy.ops.render.render(write_still=True)
print("TOP OK:", scene.render.filepath)
