# fontana.py — fontana-mascotte al centro piazza (pezzo forte).
# Vasca lathe Ø7 con bordo h0.45 (scavalcabile: STEP_HEIGHT 0.6 → "entrabile"),
# acqua a bz 0.32, basamento a 2 ordini, statua mascotte cartoon in ottone
# (corpo skin_chain, testa sfera con occhioni, braccia a tubo) che sputa lo
# zampillo verso −y blender (= +z gioco... l'istanza rotY 180 lo gira a sud).
import sys, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/piazza")
import bpy
import piazza_lib as pl
pl.clear_scene()
M = pl.materiali()

# VASCA (lathe, profilo (raggio, z)): esterno sagomato, gola, labbro tondo
pl.lathe_profile("vasca", [
    (3.55, 0.00), (3.55, 0.18), (3.42, 0.22), (3.42, 0.38),
    (3.55, 0.42), (3.50, 0.45), (3.20, 0.45), (3.15, 0.40),
    (3.15, 0.10), (0.90, 0.06), (0.90, 0.00),
], M['pietra'], segments=48)
pl.add_cyl("acqua", 3.15, 0.32, 0, 0, 0.0, M['acqua'], vertices=48)

# BASAMENTO a 2 ordini + catino piccolo
pl.lathe_profile("basamento", [
    (1.05, 0.00), (1.05, 0.55), (0.80, 0.62), (0.62, 0.62),
    (0.62, 1.15), (0.95, 1.22), (1.30, 1.30), (1.35, 1.42),
    (1.28, 1.48), (0.42, 1.45), (0.42, 1.50), (0.0, 1.50),
], M['pietra'], segments=40)

# STATUA MASCOTTE: gatto jazz cartoon in ottone (monumento in bronzo).
# Fronte verso −y blender; occhioni con pupille scure, zampillo dalla bocca.
def sfera(nome, r, x, y, z, mat, scala=None):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(x, y, z))
    o = bpy.context.object
    o.name = nome
    if scala:
        o.scale = scala
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return o

# zampe + corpo a pera + testa
for s in (-1, 1):
    sfera(f"zampa_{s}", 0.11, s * 0.14, -0.06, 1.54, M['ottone'], scala=(1.0, 1.3, 0.7))
# l'ultimo punto (collo, z 2.42) entra NELLA testa (sfera r0.34 a z 2.70 →
# bordo inferiore 2.36): corpo e testa fusi
pl.skin_chain("corpo", [(0, 0, 1.54), (0, 0.01, 1.78), (0, 0.02, 2.06), (0, 0, 2.42)],
              [(0.15, 0.13), (0.27, 0.23), (0.20, 0.17), (0.12, 0.12)], M['ottone'])
sfera("testa", 0.34, 0, 0, 2.70, M['ottone'])
sfera("muso", 0.17, 0, -0.25, 2.60, M['ottone'], scala=(1.25, 1.0, 0.75))
# orecchie triangolari (coni) leggermente aperte
for s in (-1, 1):
    bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=0.12, depth=0.26,
                                    location=(s * 0.20, 0, 3.02),
                                    rotation=(0, math.radians(s * 18), 0))
    o = bpy.context.object; o.name = f"orecchia_{s}"
    o.data.materials.append(M['ottone'])
    bpy.ops.object.shade_smooth()
# occhioni sporgenti + pupille scure
for s in (-1, 1):
    sfera(f"occhio_{s}", 0.10, s * 0.13, -0.275, 2.80, M['ottone'])
    sfera(f"pupilla_{s}", 0.045, s * 0.13, -0.355, 2.81, M['nero'])
# braccia aperte verso l'alto con "mani" (spalla DENTRO il corpo: a z≈2.08 il
# corpo ha raggio ~0.20, quindi partenza a x=0.10 con raggio 0.09 → fusa)
for s in (-1, 1):
    pl.skin_chain(f"braccio_{s}", [(s*0.10, 0, 2.08), (s*0.40, -0.07, 2.28), (s*0.56, -0.11, 2.50)],
                  [(0.09, 0.09), (0.065, 0.065), (0.10, 0.10)], M['ottone'])
# coda ARROTOLATA attorno alle zampe (gatto seduto): parte dentro il corpo
# (y 0.20 < raggio 0.23) e gira sul fianco destro fino al fronte, con ciuffo
pl.skin_chain("coda", [(0, 0.20, 1.56), (0.30, 0.16, 1.55), (0.38, -0.06, 1.54), (0.30, -0.22, 1.55)],
              [(0.06, 0.06), (0.055, 0.055), (0.05, 0.05), (0.075, 0.075)], M['ottone'])

# ZAMPILLO dalla bocca: arco morbido verso la vasca + splash
pl.skin_chain("zampillo", [(0, -0.38, 2.56), (0, -0.72, 2.54), (0, -1.05, 2.28),
                           (0, -1.32, 1.75), (0, -1.50, 1.10), (0, -1.58, 0.50)],
              [(0.045, 0.045), (0.06, 0.06), (0.065, 0.065),
               (0.06, 0.06), (0.07, 0.07), (0.10, 0.10)], M['acqua'])
sfera("splash", 0.20, 0, -1.58, 0.40, M['acqua'], scala=(1.3, 1.3, 0.45))

# COL
pl.box_game("COL_fontana_vasca", 6.6, 6.6, 0.45, 0, 0, 0, M['pietra'])
pl.box_game("COL_fontana_base", 1.8, 1.8, 2.6, 0, 0, 0.45, M['pietra'])
pl.export_glb("fontana.glb")
pl.render_previews("fontana", ortho_scale=9, alt_front=1.8,
                   quarter_pos=(6.5, -7.5, 4.2), quarter_target_z=1.3)
