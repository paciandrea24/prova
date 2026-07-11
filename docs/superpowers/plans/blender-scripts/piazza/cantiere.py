# cantiere.py — tappo NORD della piazza: palizzata da cantiere cartoon con
# insegna "FUNLAND — PROSSIMAMENTE" (punto d'attacco del futuro sotto-progetto B).
# Origine centro-base. L'insegna e il lato leggibile guardano +z LOCALE (sud):
# con l'istanza a (55.5, −16, rotY 0) il fronte è verso l'INTERNO piazza.
import sys, math, random
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/piazza")
import bpy
import piazza_lib as pl
pl.clear_scene()
M = pl.materiali()
random.seed(7)

# palizzata: 8 assi verticali leggermente sbilenche + 2 traverse
for i in range(8):
    x = -2.65 + i * 0.76
    pl.add_box_c(f"asse_{i}", 0.7, 0.12, 3.0, x, 0, 1.5, M['legno'],
                 rot=(0, math.radians(random.uniform(-2, 2)), 0))
for bz in (0.5, 2.4):
    pl.box_game(f"traversa_{int(bz*10)}", 6.0, 0.10, 0.25, 0, 0.10, bz, M['legno'])

# fascia gialla/nera diagonale a terra (segnaletica cantiere)
for i in range(6):
    x = -2.5 + i * 1.0
    pl.add_box_c(f"striscia_{i}", 0.5, 0.14, 0.35, x, -0.10, 0.25,
                 M['giallo' if i % 2 == 0 else 'nero'], rot=(0, math.radians(35), 0))

# insegna montata sul fronte SUD (lato piazza): fondo nero + scritte gialle
pl.box_game("insegna_fondo", 4.4, 0.15, 1.1, 0, 0.20, 1.6, M['nero'])

def testo(nome, txt, size, bz):
    bpy.ops.object.text_add()
    t = bpy.context.object
    t.data.body = txt
    t.data.size = size
    t.data.extrude = 0.03
    t.data.align_x = 'CENTER'
    bpy.ops.object.convert(target='MESH')
    t = bpy.context.object
    t.name = nome
    t.location = (0, -0.31, bz)          # by −0.31 = gz +0.31 → davanti al fondo
    t.rotation_euler = (math.radians(90), 0, 0)
    t.data.materials.append(M['giallo'])

testo("txt_funland", "FUNLAND", 0.62, 1.95)
testo("txt_sub", "PROSSIMAMENTE", 0.22, 1.72)

pl.box_game("COL_cantiere", 6.0, 0.6, 3.0, 0, 0, 0, M['legno'])
pl.export_glb("cantiere.glb")
# fronte = lato −y blender (gz +, sud gioco: dove guarda l'insegna)
pl.render_previews("cantiere", ortho_scale=7, alt_front=1.6,
                   quarter_pos=(5, -8, 4), quarter_target_z=1.6)
