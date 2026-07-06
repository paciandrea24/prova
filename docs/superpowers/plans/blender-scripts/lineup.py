# lineup.py — importa tutti i GLB degli edifici e li affianca in due file
# per la verifica visiva finale della collezione (varieta', difetti, palette)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import os
import bpy
import jazz_lib as jl

PASSO = 10.0   # basta per il piu' largo (edificio_09, 8m) + margine

files = sorted(f for f in os.listdir(jl.MODELS_DIR)
               if f.startswith("edificio_") and f.endswith(".glb"))
meta = [files[:len(files) // 2 + len(files) % 2], files[len(files) // 2 + len(files) % 2:]]

for gi, gruppo in enumerate(meta):
    jl.clear_scene()
    x = 0.0
    for f in gruppo:
        prima = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=jl.MODELS_DIR + "/" + f)
        for obj in set(bpy.data.objects) - prima:
            if obj.parent is None:
                obj.location.x += x
        x += PASSO
        print("Piazzato:", f)
    # Centra la fila sull'origine (la camera front guarda x=0)
    centro = (x - PASSO) / 2
    for obj in bpy.data.objects:
        if obj.parent is None:
            obj.location.x -= centro
    largh_fila = x - PASSO + 12
    # Render panoramico: con res orizzontale ortho_scale copre la larghezza
    jl.render_previews(f"lineup{gi + 1}", ortho_scale=largh_fila, alt_front=7.0,
                       quarter_pos=(largh_fila * 0.45, -largh_fila * 0.55, largh_fila * 0.28),
                       quarter_target_z=6.0, res=(1800, 700))
