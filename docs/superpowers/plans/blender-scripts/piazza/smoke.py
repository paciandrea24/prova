# smoke.py — verifica pipeline piazza (import, path, render)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/piazza")
import piazza_lib as pl
pl.clear_scene()
M = pl.materiali()
# box all'ORIGINE (le camere preview inquadrano (0,0): a CX=55.5 sarebbe fuori frame)
pl.box_game("smoke_box", 2, 2, 1, 0, 0, 0, M['ottone'])
pl.render_previews("smoke", ortho_scale=8)
print("SMOKE OK — ellisse(0) =", pl.ellisse(0), "rotY(0) =", pl.tangente_rotY(0))
