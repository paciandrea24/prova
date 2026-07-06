# test_lib.py — smoke test della libreria: un box + una lathe + testo, export + render
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

jl.clear_scene()
mats = jl.make_materials('ocra')
jl.add_box("box_prova", 2, 2, 3, 0, 0, 0, mats['muro'])
jl.lathe_profile("vaso_prova", [(0.5, 0), (0.7, 0.5), (0.3, 1.2), (0.0, 1.2)], mats['cornice'])
jl.add_text_mesh("testo_prova", "TEST", 0.4, 0, -1.02, 1.5, mats['scuro'])
jl.export_glb("_test_lib.glb")
jl.render_previews("_test", ortho_scale=6.0, alt_front=1.5, quarter_pos=(5, -5, 4), quarter_target_z=1.5)
