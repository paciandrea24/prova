# macchinina.py — bumper car singola (istanze sparse in pista + 1 "in panne").
# Scocca a goccia (lathe schiacciato), paraurti nero, sedile, volante, asta
# del trolley col pattino. Corpo blu_fiera unico (loadZone non parametrizza
# i materiali per istanza). COL_macchinina 1.7x1.1x0.75.
import sys, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/funland")
import bpy
import funland_lib as fl
fl.clear_scene()
M = fl.materiali()
# scocca a goccia (lathe schiacciato con scale y), paraurti, sedile, volante, asta
fl.lathe_profile("scocca", [(0.78, 0.10), (0.80, 0.28), (0.72, 0.42), (0.45, 0.52), (0.0, 0.55)],
                 M['blu'], segments=20)
sc = bpy.context.object
sc.scale = (1.0, 0.62, 1.0)          # in blender: y = profondita' (z gioco)
fl.lathe_profile("paraurti", [(0.86, 0.06), (0.88, 0.16), (0.86, 0.26), (0.82, 0.28)],
                 M['nero'], segments=20)
pu = bpy.context.object
pu.scale = (1.0, 0.62, 1.0)
# sedile DIETRO (by +0.15), sterzo DAVANTI (by -0.28): nella ricetta del piano
# si compenetravano (entrambi a ridosso del centro)
fl.box_game("sedile", 0.5, 0.35, 0.35, 0, -0.15, 0.30, M['rosso'])
fl.add_cyl("piantone", 0.035, 0.35, 0, -0.28, 0.42, M['nero'], vertices=8)
fl.add_cyl("volante", 0.14, 0.05, 0, -0.28, 0.75, M['nero'], vertices=12)
# asta a by 0.42 (r efficace 0.68 con lo scale 0.62): a 0.55 usciva dalla scocca
fl.add_cyl("asta", 0.035, 1.5, 0, 0.42, 0.4, M['ottone'], vertices=8)
fl.box_game("pattino", 0.22, 0.1, 0.06, 0, -0.42, 1.9, M['nero'])
fl.box_game("COL_macchinina", 1.7, 1.1, 0.75, 0, 0, 0, M['blu'])
fl.export_glb("macchinina.glb")
fl.render_previews("macchinina", ortho_scale=3, alt_front=0.9, quarter_pos=(2.2, -2.4, 1.6), quarter_target_z=0.5)
