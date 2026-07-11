import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/funland")
import funland_lib as fl
fl.clear_scene()
M = fl.materiali()
fl.box_game("smoke_box", 2, 2, 1, 0, 0, 0, M['rosso'])
fl.testo("smoke_txt", "FUNLAND", 0.5, M['giallo'], (0, -1.2, 1.2))
fl.render_previews("smoke", ortho_scale=8)
print("SMOKE OK — GIOSTRA =", fl.GIOSTRA, "GATE_EST =", fl.GATE_EST)
