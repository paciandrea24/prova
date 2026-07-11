# ristoro.py — area ristoro: chiosco churros + tavolino (ARGV: -- churros|tavolino)
# Tende/ombrelloni a CONO LATHE + festone (gli spicchi a doppia rotazione non
# chiudono: visto sulla tettoia della giostra). Insegna churros con rot Z 180
# (il default di fl.testo legge da -y; bancone e sportello stanno sul lato by+).
import sys, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/funland")
import funland_lib as fl
ASSET = 'churros'
if '--' in sys.argv:
    ASSET = sys.argv[sys.argv.index('--') + 1]
fl.clear_scene()
M = fl.materiali()

if ASSET == 'churros':
    fl.add_cyl("corpo", 1.3, 2.4, 0, 0, 0, M['salvia'], vertices=16)
    for i in range(6):
        a = 2 * math.pi * i / 6
        fl.add_box_c(f"lesena_{i}", 0.14, 0.08, 2.4, 1.32 * math.sin(a), 1.32 * math.cos(a), 1.2,
                     M['crema'], rot=(0, 0, -a))
    # bancone + sportello sul lato by+ (fronte del chiosco)
    fl.box_game("bancone", 1.6, 0.4, 0.12, 0, -1.45, 1.05, M['legno'])
    fl.box_game("sportello", 1.3, 0.1, 0.9, 0, -1.31, 1.15, M['crema'])
    # tenda conica lathe + festone alternato al bordo
    fl.lathe_profile("tenda", [(1.75, 2.62), (1.68, 2.72), (0.1, 3.35), (0.0, 3.4)],
                     M['rosso'], segments=24)
    for i in range(10):
        a = 2 * math.pi * (i + 0.5) / 10
        fl.add_box_c(f"festone_{i}", 0.95, 0.06, 0.35, 1.62 * math.sin(a), 1.62 * math.cos(a), 2.5,
                     M['rosso'] if i % 2 == 0 else M['crema'], rot=(0, 0, -a))
    fl.lathe_profile("puntale", [(0.12, 3.38), (0.05, 3.58), (0.0, 3.68)], M['ottone'], segments=12)
    # lato by+ come il bancone; rot Z 180 = leggibile dal viewer a +y
    fl.testo("txt_churros", "CHURROS", 0.26, M['giallo'], (0, 1.42, 1.9),
             rot=(math.radians(90), 0, math.radians(180)))
    fl.box_game("COL_churros", 2.8, 2.8, 3.4, 0, 0, 0, M['salvia'])
    fl.export_glb("chiosco_churros.glb")
    fl.render_previews("chiosco_churros", ortho_scale=6, quarter_pos=(5, 5.5, 3.5), quarter_target_z=1.6)

if ASSET == 'tavolino':
    fl.add_cyl("piano", 0.6, 0.06, 0, 0, 0.72, M['crema'], vertices=16)
    fl.add_cyl("gamba", 0.06, 0.72, 0, 0, 0, M['nero'], vertices=8)
    fl.lathe_profile("base", [(0.3, 0.0), (0.28, 0.06), (0.08, 0.1), (0.06, 0.14)], M['nero'], segments=12)
    fl.add_cyl("palo_omb", 0.04, 1.9, 0, 0, 0.78, M['ottone'], vertices=8)
    # ombrellone: cono lathe rosso con bordo bianco
    fl.lathe_profile("ombrellone", [(1.3, 2.28), (1.24, 2.36), (0.08, 2.72), (0.0, 2.75)],
                     M['rosso'], segments=20)
    fl.lathe_profile("bordo_omb", [(1.32, 2.24), (1.3, 2.34)], M['bianco'], segments=20)
    for s in (-1, 1):
        fl.add_cyl(f"sgabello_{s}", 0.22, 0.45, s * 0.85, 0, 0, M['legno'], vertices=10)
    fl.box_game("COL_tavolino", 1.2, 1.2, 0.8, 0, 0, 0, M['crema'])
    fl.export_glb("tavolino.glb")
    fl.render_previews("tavolino", ortho_scale=4, quarter_pos=(3, -3.4, 2.2), quarter_target_z=1.2)
