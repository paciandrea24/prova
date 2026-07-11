# autoscontro.py — pista bumper car 14x10: pavimento metallico, muretto
# perimetrale h1.1 con 2 aperture w2.5 (centro lato OVEST e centro lato SUD),
# 4 pali angolari h5 con griglia-rete sopra, insegna "AUTO SCONTRO" sul lato
# nord (fuori: rot Z 180, il default di fl.testo legge da sud).
# COL: 6 tratti muretto + 4 pali. Le macchinine sono un GLB separato.
import sys, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/funland")
import funland_lib as fl
fl.clear_scene()
M = fl.materiali()
W, D, HM = 14.0, 10.0, 1.1     # pista e muretto
fl.box_game("pav_pista", W, D, 0.12, 0, 0, 0, M['metallo'])
APER = 2.5
# muretto: lato NORD pieno, EST pieno, OVEST e SUD con apertura centrale
fl.box_game("muro_n", W + 0.5, 0.5, HM, 0, -D / 2, 0, M['rosso'])
fl.box_game("COL_muro_n", W + 0.5, 0.5, HM, 0, -D / 2, 0, M['rosso'])
fl.box_game("muro_e", 0.5, D, HM, W / 2, 0, 0, M['rosso'])
fl.box_game("COL_muro_e", 0.5, D, HM, W / 2, 0, 0, M['rosso'])
for s in (-1, 1):   # SUD in 2 tratti (apertura al centro)
    L = (W + 0.5 - APER) / 2
    fl.box_game(f"muro_s_{s}", L, 0.5, HM, s * (APER / 2 + L / 2), D / 2, 0, M['rosso'])
    fl.box_game(f"COL_muro_s_{s}", L, 0.5, HM, s * (APER / 2 + L / 2), D / 2, 0, M['rosso'])
    Lo = (D - APER) / 2   # OVEST in 2 tratti
    fl.box_game(f"muro_o_{s}", 0.5, Lo, HM, -W / 2, s * (APER / 2 + Lo / 2), 0, M['rosso'])
    fl.box_game(f"COL_muro_o_{s}", 0.5, Lo, HM, -W / 2, s * (APER / 2 + Lo / 2), 0, M['rosso'])
fl.box_game("bordo_top", W + 0.7, 0.2, 0.12, 0, -D / 2, HM, M['ottone'])   # corrimano nord (estetica)
for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):    # pali + rete
    fl.box_game(f"palo_{sx}_{sz}", 0.3, 0.3, 5.0, sx * (W / 2 - 0.3), sz * (D / 2 - 0.3), 0, M['nero'])
    fl.box_game(f"COL_palo_{sx}_{sz}", 0.3, 0.3, 5.0, sx * (W / 2 - 0.3), sz * (D / 2 - 0.3), 0, M['nero'])
for i in range(6):
    fl.box_game(f"rete_x_{i}", W - 0.6, 0.05, 0.05, 0, -D / 2 + 0.3 + i * (D - 0.6) / 5, 4.9, M['nero'])
for i in range(8):
    fl.box_game(f"rete_z_{i}", 0.05, D - 0.6, 0.05, -W / 2 + 0.3 + i * (W - 0.6) / 7, 0, 4.9, M['nero'])
fl.box_game("insegna_fondo", 6.0, 0.25, 1.1, 0, -D / 2 - 0.1, 5.0, M['nero'])
fl.testo("txt_pista", "AUTO SCONTRO", 0.55, M['giallo'], (0, D / 2 + 0.28, 5.3),
         rot=(math.radians(90), 0, math.radians(180)))
fl.export_glb("autoscontro.glb")
fl.render_previews("autoscontro", ortho_scale=18, quarter_pos=(14, -15, 9))
