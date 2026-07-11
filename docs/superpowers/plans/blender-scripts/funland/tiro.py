# tiro.py — tiro a segno: tendone 8x4 h4.5 fronte -z gioco (by+): bancone h1.0
# davanti (copertura crouch, con COL), fianchi e fondale pieni (COL), 3 sagome
# papera su un RIPIANO al fondale (nel piano flottavano a mezz'aria), tetto a
# falda a strisce, insegna "TIRO A SEGNO" sul fronte (testo rot Z 180).
import sys, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/funland")
import funland_lib as fl
fl.clear_scene()
M = fl.materiali()
W, D, H = 8.0, 4.0, 4.5      # fronte -z (bancone), fondale +z
fl.box_game("pedana", W, D, 0.14, 0, 0, 0, M['legno'])
fl.box_game("bancone", W - 0.8, 0.5, 1.0, 0, -D / 2 + 0.35, 0.14, M['rosso'])
fl.box_game("COL_bancone", W - 0.8, 0.5, 1.0, 0, -D / 2 + 0.35, 0.14, M['rosso'])
fl.box_game("fondale", W, 0.3, 3.4, 0, D / 2 - 0.2, 0.14, M['verde'])
fl.box_game("COL_fondale", W, 0.3, 3.4, 0, D / 2 - 0.2, 0.14, M['verde'])
for s in (-1, 1):
    fl.box_game(f"fianco_{s}", 0.3, D, 3.4, s * (W / 2 - 0.15), 0, 0.14, M['verde'])
    fl.box_game(f"COL_fianco_{s}", 0.3, D, 3.4, s * (W / 2 - 0.15), 0, 0.14, M['verde'])
# ripiano dei bersagli addossato al fondale + 3 sagome papera sedute sopra
fl.box_game("ripiano", W - 1.2, 0.4, 0.1, 0, D / 2 - 0.55, 1.5, M['legno'])
for i in range(3):
    px = -2.2 + i * 2.2
    by = -(D / 2 - 0.55)   # blender y del ripiano
    fl.skin_chain(f"papera_{i}", [(px - 0.25, by, 1.72), (px, by, 1.76), (px + 0.2, by, 2.0), (px + 0.38, by, 2.05)],
                  [(0.14, 0.18), (0.2, 0.24), (0.09, 0.1), (0.11, 0.12)], M['giallo'])
for i in range(9):    # tetto a falda a strisce (pende verso il fronte)
    fl.add_box_c(f"falda_{i}", 0.9, D + 1.2, 0.08, -3.6 + i * 0.9, 0, 4.3,
                 M['rosso'] if i % 2 == 0 else M['crema'], rot=(math.radians(-12), 0, 0))
fl.box_game("insegna_fondo", 5.2, 0.2, 0.9, 0, -D / 2 - 0.15, 4.6, M['nero'])
# lato by+ come bancone e insegna_fondo; rot Z 180 = leggibile dal fronte
fl.testo("txt_tiro", "TIRO A SEGNO", 0.5, M['giallo'], (0, D / 2 + 0.32, 4.82),
         rot=(math.radians(90), 0, math.radians(180)))
fl.export_glb("tiro_a_segno.glb")
fl.render_previews("tiro_a_segno", ortho_scale=11, quarter_pos=(10, 13, 6.5), quarter_target_z=2.0)
