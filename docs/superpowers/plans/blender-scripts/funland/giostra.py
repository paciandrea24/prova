# giostra.py — giostra centrale (carousel), tutta statica (decisione spec).
# Pedana e colonna lathe, tettoia a 12 spicchi alternati + guglia ottone,
# 5 cavalli skin_chain su pali. Recinto quadrato 11x11 h1.05 TUTTO chiuso
# (non si sale: la pedana non e' raggiungibile). COL: 4 lati recinto + colonna.
import sys, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/funland")
import bpy
import funland_lib as fl
fl.clear_scene()
M = fl.materiali()

# PEDANA con bordo (lathe) + colonna a fusto sagomato + capitello
fl.lathe_profile("pedana", [(4.5, 0.0), (4.5, 0.42), (4.3, 0.5), (0.9, 0.5), (0.9, 0.0)],
                 M['legno'], segments=32)
# colonna fino SOTTO il cono (a r0.8 l'intradosso e' a ~5.23): senza, il tetto flotta
fl.lathe_profile("colonna", [(0.8, 0.5), (0.75, 0.9), (0.5, 1.1), (0.5, 4.6),
                             (0.75, 4.85), (0.8, 5.15), (0.0, 5.15)], M['rosso'], segments=20)
# TETTOIA: cono lathe pieno + festone bicolore al bordo (fallback del piano:
# i 12 spicchi a doppia rotazione non chiudevano — buco al centro)
fl.lathe_profile("tettoia", [(5.0, 4.2), (4.9, 4.32), (0.12, 5.35), (0.0, 5.4)],
                 M['crema'], segments=32)
for i in range(14):   # festone: pannellini appesi al bordo, alternati
    a = 2 * math.pi * (i + 0.5) / 14
    fl.add_box_c(f"festone_{i}", 1.9, 0.08, 0.5, 4.78 * math.sin(a), 4.78 * math.cos(a), 4.05,
                 M['rosso'] if i % 2 == 0 else M['crema'], rot=(0, 0, -a))
fl.lathe_profile("cupola", [(0.55, 5.35), (0.42, 5.7), (0.15, 5.95), (0.0, 6.05)], M['ottone'], segments=16)
fl.add_cyl("asta", 0.04, 0.8, 0, 0, 6.05, M['ottone'], vertices=8)
fl.add_box_c("bandiera", 0.5, 0.03, 0.3, 0.28, 0, 6.7, M['rosso'])
# 5 CAVALLI su pali (r 3.2): corpo-collo-testa skin_chain + muso e sella
for i in range(5):
    a = 2 * math.pi * i / 5
    px, pz = 3.2 * math.sin(a), 3.2 * math.cos(a)   # blender bx, by
    mane = M['bianco'] if i % 2 == 0 else M['salvia']
    fl.add_cyl(f"palo_{i}", 0.05, 4.2, px, pz, 0.5, M['ottone'], vertices=8)   # fino all'intradosso (r3.2 → z4.69)
    fl.skin_chain(f"cavallo_{i}",
                  [(px - 0.52, pz, 1.62), (px - 0.15, pz, 1.6), (px + 0.28, pz, 1.66),
                   (px + 0.42, pz, 1.92), (px + 0.55, pz, 2.12)],
                  [(0.12, 0.15), (0.24, 0.27), (0.21, 0.25), (0.09, 0.13), (0.12, 0.12)],
                  mane)
    # muso in avanti + sella rossa sul dorso
    fl.add_box_c(f"muso_{i}", 0.3, 0.16, 0.16, px + 0.74, pz, 2.1, mane)
    fl.add_box_c(f"sella_{i}", 0.34, 0.3, 0.1, px - 0.02, pz, 1.9, M['rosso'], bevel=0.04)
    for g in range(4):
        fl.add_cyl(f"gamba_{i}_{g}", 0.05, 0.55, px - 0.35 + (g % 2) * 0.6, pz - 0.12 + (g // 2) * 0.24, 1.0, M['nero'], vertices=6)
# RECINTO quadrato 11x11 chiuso (staccionata bassa) + COL
for (nm, w, d, gx, gz) in (("n", 11, 0.2, 0, -5.5), ("s", 11, 0.2, 0, 5.5),
                            ("e", 0.2, 11, 5.5, 0), ("o", 0.2, 11, -5.5, 0)):
    fl.box_game(f"recinto_{nm}", w, d, 1.05, gx, gz, 0, M['crema'])
    fl.box_game(f"COL_recinto_{nm}", w, d, 1.05, gx, gz, 0, M['crema'])
fl.box_game("COL_colonna", 1.7, 1.7, 4.7, 0, 0, 0.5, M['rosso'])
fl.export_glb("giostra.glb")
fl.render_previews("giostra", ortho_scale=14, quarter_pos=(11, -12, 8))
