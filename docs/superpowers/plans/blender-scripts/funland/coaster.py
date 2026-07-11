# coaster.py — modulo coaster-FONDALE 24 m (skyline oltre il recinto nord):
# binario a 2 gobbe (2 rotaie skin_chain + traversine) su tralicci bianchi.
# SOLO mesh visive, NESSUNA COL (sta fuori dal recinto, non raggiungibile).
import sys, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/funland")
import funland_lib as fl
fl.clear_scene()
M = fl.materiali()
def hill(x):     # profilo colline: 2 gobbe asimmetriche su 24 m
    return 3.2 + 4.6 * math.exp(-((x + 6.5) / 3.4) ** 2) + 6.8 * math.exp(-((x - 4.5) / 4.2) ** 2)
PTS = [(-12.0 + i * 0.75, hill(-12.0 + i * 0.75)) for i in range(33)]
for off in (-0.55, 0.55):    # 2 rotaie
    fl.skin_chain(f"rotaia_{int(off*100)}", [(x, off, y) for (x, y) in PTS],
                  [(0.09, 0.09)] * len(PTS), M['rosso'])
for i in range(0, 32, 2):    # traversine
    (x, y) = PTS[i]
    fl.add_box_c(f"trav_{i}", 0.14, 1.4, 0.1, x, 0, y - 0.12, M['legno'])
for i in range(0, 33, 4):    # tralicci: montanti + croce (add_box_c prende il
    (x, y) = PTS[i]          # CENTRO: base a 0 → centro a h/2, non 0 come da piano)
    h = y - 0.3
    for s in (-1, 1):
        fl.add_box_c(f"mont_{i}_{s}", 0.22, 0.22, h, x + s * 0.45, s * 0.45, h / 2, M['bianco'])
    fl.add_box_c(f"croce_{i}", 0.12, 1.5, 0.12, x, 0, y * 0.5, M['bianco'], rot=(math.radians(40), 0, 0))
fl.export_glb("coaster_fondale.glb")
fl.render_previews("coaster_fondale", ortho_scale=28, quarter_pos=(20, -20, 12), quarter_target_z=6)
