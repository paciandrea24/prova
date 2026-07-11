# chiosco.py — chiosco/edicola tondo anni '30, copertura alta piena della piazza.
# Corpo cilindrico Ø3.8 verde scuro con lesene crema, sportello+bancone sul
# fronte (−z LOCALE gioco = +y blender), tetto conico svasato crema, pennone.
# L'insegna "EDICOLA" sta sopra lo sportello e si legge dal fronte.
import sys, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/piazza")
import bpy
import piazza_lib as pl
pl.clear_scene()
M = pl.materiali()

pl.add_cyl("corpo", 1.9, 2.7, 0, 0, 0, M['verde'], vertices=24)
for i in range(8):
    a = 2 * math.pi * (i + 0.5) / 8   # sfasate: nessuna lesena sul fronte
    pl.add_box_c(f"lesena_{i}", 0.16, 0.10, 2.7, 1.92 * math.sin(a), 1.92 * math.cos(a), 1.35,
                 M['crema'], rot=(0, 0, -a))
# zoccolo
pl.add_cyl("zoccolo", 2.0, 0.35, 0, 0, 0, M['nero'], vertices=24)

# fronte = −z gioco → by POSITIVO (by = −gz): sportello, bancone, insegna
pl.box_game("sportello", 1.5, 0.12, 1.0, 0, -1.86, 1.1, M['crema'])
pl.box_game("bancone", 1.7, 0.45, 0.10, 0, -2.05, 1.0, M['legno'])
for s in (-1, 1):   # mensole di sostegno del bancone
    pl.add_box_c(f"mensola_{s}", 0.08, 0.30, 0.28, s * 0.70, 1.98, 0.84, M['legno'])
# tendina sopra l'insegna (inclinata in avanti)
pl.add_box_c("tettuccio", 1.8, 0.55, 0.06, 0, 2.05, 2.62, M['rosso'],
             rot=(math.radians(-18), 0, 0))

# tetto conico svasato + pennone con sfera
pl.lathe_profile("tetto", [
    (2.35, 2.70), (2.30, 2.78), (1.60, 3.10), (0.85, 3.55), (0.30, 3.95), (0.0, 4.10),
], M['crema'], segments=24)
pl.add_cyl("pennone", 0.05, 0.6, 0, 0, 4.05, M['ottone'], vertices=8)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.10, location=(0, 0, 4.70))
sf = bpy.context.object; sf.name = "pennone_sfera"
sf.data.materials.append(M['ottone'])
bpy.ops.object.shade_smooth()

# insegna EDICOLA sul fronte (testo rivolto a +y blender: rz=π)
bpy.ops.object.text_add()
t = bpy.context.object
t.data.body = "EDICOLA"
t.data.size = 0.30
t.data.extrude = 0.03
t.data.align_x = 'CENTER'
bpy.ops.object.convert(target='MESH')
t = bpy.context.object
t.name = "txt_edicola"
t.location = (0, 1.93, 2.15)
t.rotation_euler = (math.radians(90), 0, math.pi)
t.data.materials.append(M['giallo'])

pl.box_game("COL_chiosco", 3.6, 3.6, 4.2, 0, 0, 0, M['verde'])
pl.export_glb("chiosco.glb")
# fronte visivo = +y blender → quarter da (5, 7, 4)
pl.render_previews("chiosco", ortho_scale=7, alt_front=2.2,
                   quarter_pos=(5, 7, 4), quarter_target_z=1.8)
