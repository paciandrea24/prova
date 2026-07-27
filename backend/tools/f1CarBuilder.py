"""
Stadio 2 della pipeline "scultura per silhouette": legge
backend/tools/f1CarVoxelData.json (scritto da f1CarVoxelize.py, Stadio 1)
e costruisce/esporta il modello auto per la visuale cockpit del gioco F1.

Uso (da qualunque cartella):
    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --python backend/tools/f1CarBuilder.py

Output:
    frontend/assets/custom/f1Car.glb
    backend/tools/renders/f1-car-3q.png       (vista 3/4 esterna)
    backend/tools/renders/f1-car-cockpit.png  (vista dal punto pilota)
"""
import bpy
import json
import math
import os
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT  = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
DATA_PATH  = os.path.join(SCRIPT_DIR, 'f1CarVoxelData.json')
GLB_OUT    = os.path.join(REPO_ROOT, 'frontend', 'assets', 'custom', 'f1Car.glb')
RENDER_DIR = os.path.join(SCRIPT_DIR, 'renders')
os.makedirs(os.path.dirname(GLB_OUT), exist_ok=True)
os.makedirs(RENDER_DIR, exist_ok=True)

car_objects = []


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def make_material(name, rgb, roughness=0.5, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return mat


def add_box(name, mat, dims, center):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    bpy.ops.object.shade_flat()
    return obj


def add_wheel(prefix, x, y, radius, width, mat_tire, mat_rim):
    hub = bpy.data.objects.new(prefix, None)
    bpy.context.collection.objects.link(hub)
    hub.location = (x, y, radius)
    car_objects.append(hub)

    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=radius, depth=width,
                                         location=(0, 0, 0), rotation=(0, math.radians(90), 0))
    tire = bpy.context.active_object
    tire.name = prefix + '_tire_wheel'
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    tire.data.materials.append(mat_tire)
    bpy.ops.object.shade_flat()
    tire.parent = hub
    tire.location = (0, 0, 0)
    car_objects.append(tire)

    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=radius * 0.55, depth=width * 1.02,
                                         location=(0, 0, 0), rotation=(0, math.radians(90), 0))
    rim = bpy.context.active_object
    rim.name = prefix + '_rim'
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    rim.data.materials.append(mat_rim)
    bpy.ops.object.shade_flat()
    rim.parent = hub
    rim.location = (0, 0, 0)
    car_objects.append(rim)


def point_camera(cam, target):
    direction = Vector(target) - cam.location
    rot_quat = direction.to_track_quat('-Z', 'Y')
    cam.rotation_euler = rot_quat.to_euler()


def build_body(data):
    materials = {}
    for cat, rgb in data['palette'].items():
        materials[cat] = make_material(f'body_{cat}', tuple(rgb), roughness=0.4, metallic=0.25)

    by_category = {cat: [] for cat in materials}
    for i, b in enumerate(data['boxes']):
        cat = b['category']
        obj = add_box(f'vox_{cat}_{i}', materials[cat], b['size'], b['center'])
        by_category[cat].append(obj)

    for cat, objs in by_category.items():
        if not objs:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        merged = bpy.context.active_object
        merged.name = f'body_{cat}'
        car_objects.append(merged)


def build_wheels(data):
    mat_tire = make_material('tire', (0.03, 0.03, 0.03), roughness=0.9)
    mat_rim  = make_material('rim',  (0.55, 0.55, 0.58), roughness=0.3, metallic=0.7)
    for w in data['wheels']:
        add_wheel(w['name'], w['x'], w['y'], w['radius'], w['width'], mat_tire, mat_rim)


def setup_preview_scene():
    bpy.ops.mesh.primitive_plane_add(size=10, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = 'preview_ground'
    ground_mat = make_material('preview_ground_mat', (0.5, 0.52, 0.55), roughness=0.8)
    ground.data.materials.append(ground_mat)

    sun = bpy.data.lights.new('sun', type='SUN')
    sun.energy = 3.0
    sun_obj = bpy.data.objects.new('sun', sun)
    bpy.context.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(55), 0, math.radians(35))

    bpy.context.scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.6, 0.68, 1)

    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.samples = 32
    bpy.context.scene.render.resolution_x = 960
    bpy.context.scene.render.resolution_y = 540
    bpy.context.scene.render.image_settings.file_format = 'PNG'


def render_to(filename, cam_location, cam_target):
    cam_data = bpy.data.cameras.new(f'cam_{filename}')
    cam_obj = bpy.data.objects.new(f'cam_{filename}', cam_data)
    bpy.context.collection.objects.link(cam_obj)
    cam_obj.location = cam_location
    point_camera(cam_obj, cam_target)

    scene = bpy.context.scene
    scene.camera = cam_obj
    scene.render.filepath = os.path.join(RENDER_DIR, filename)
    bpy.ops.render.render(write_still=True)


def export_glb():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in car_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = car_objects[0]
    bpy.ops.export_scene.gltf(filepath=GLB_OUT, export_format='GLB', use_selection=True)


with open(DATA_PATH) as f:
    data = json.load(f)

clear_scene()
build_body(data)
build_wheels(data)
export_glb()

setup_preview_scene()
render_to('f1-car-3q.png',      (1.1, -1.3, 0.55), (0, -0.05, 0.15))
render_to('f1-car-cockpit.png', (0, -0.08, 0.24),  (0, 0.6, 0.15))

print('[f1CarBuilder] Nodi esportati nel GLB:', len(car_objects))
for obj in car_objects:
    print(f'  - {obj.name} ({obj.type})')
print(f'[f1CarBuilder] GLB: {GLB_OUT}')
print(f'[f1CarBuilder] Render: {RENDER_DIR}')
