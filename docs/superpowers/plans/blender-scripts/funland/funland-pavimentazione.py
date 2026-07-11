# funland-pavimentazione.py — pavimentazione parco (funland_base.glb)
# Origine GLB al centro recinto (istanza nel layout a x=63, z=-35, y=-0.02).
# Griglia di celle 2x2, TRE zone (da spec): viale+anello in sanpietrini
# top bz 0.10, piazzole attrazione in terra battuta top bz 0.06, resto prato
# top bz 0.06 con macchie di terra sparse (mesh unica from_pydata per
# materiale, pattern Jazz/Piazza). Clamp: celle sotto il disco Jazz
# (hypot<45.8 dal centro mondo) saltate.
import sys, math, random
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/funland")
import bpy
import funland_lib as fl

fl.clear_scene()
M = fl.materiali()
random.seed(24)
CX, CZ = (fl.X0 + fl.X1) / 2, (fl.Z0 + fl.Z1) / 2   # (63, -35) = origine modello

# Rettangoli in coordinate MONDO. Spec: "viale e anello in sanpietrini,
# aree attrazioni in terra battuta/prato" → due liste distinte.
RIBBONS = [                       # nastri percorso in SANPIETRINI
    (51.0, 60.5, -36.0, -16.0),   # viale ingresso->giostra
    (fl.X0, fl.X1, -52.0, -47.5), # anello: lato nord
    (83.5, fl.X1, -47.5, -18.0),  # anello: lato est
    (60.0, 83.5, -22.5, -18.0),   # anello: lato sud-est (verso cancello/pista)
    (33.0, 42.0, -50.0, -30.0),   # anello: lato ovest (dal varco Jazz alla NW)
]
APRONS = [                        # piazzole attrazione in TERRA BATTUTA
    (49.0, 66.0, -40.0, -28.0),   # piazzola giostra
    (40.0, 51.0, -44.0, -36.0),   # piazzola tiro a segno
    (64.0, 84.0, -38.0, -26.0),   # piazzola autoscontro
    (72.0, 84.0, -50.0, -40.0),   # piazzola ruota
    (44.0, 53.0, -28.0, -21.0),   # piazzola ristoro
]
def _dentro(x, z, rects):
    return any(a <= x <= b and c <= z <= d for (a, b, c, d) in rects)
def is_ribbon(x, z):
    return _dentro(x, z, RIBBONS)
def is_apron(x, z):
    # il ribbon vince se la cella cade in entrambi (es. viale dentro la giostra)
    return _dentro(x, z, APRONS) and not is_ribbon(x, z)

CELL = 2.0
per_mat = {k: ([], []) for k in ('sanp_a', 'sanp_b', 'sanp_c', 'prato', 'terra_fiera')}
def cella(mname, x0g, z0g, x1g, z1g, h):
    verts, faces = per_mat[mname]
    b = len(verts)
    # ordine INVERTITO (winding specchiato dalla mappa (x,-z))
    corners = [(x1g, z0g), (x0g, z0g), (x0g, z1g), (x1g, z1g)]
    for (gx, gz) in corners:
        verts.append((gx - CX, -(gz - CZ), 0.0))
    for (gx, gz) in corners:
        verts.append((gx - CX, -(gz - CZ), h))
    faces += [(b+4, b+5, b+6, b+7),
              (b+0, b+1, b+5, b+4), (b+1, b+2, b+6, b+5),
              (b+2, b+3, b+7, b+6), (b+3, b+0, b+4, b+7)]

x = fl.X0 - 6.0                       # sborda a ovest fino ai retri jazz (poi clamp cerchio)
while x < fl.X1:
    z = fl.Z0
    while z < fl.Z1:
        cx, cz = x + CELL / 2, z + CELL / 2
        if math.hypot(cx, cz) < 45.8:       # sotto la pavimentazione/palazzi Jazz
            z += CELL; continue
        if is_ribbon(cx, cz):
            cella(random.choice(('sanp_a', 'sanp_b', 'sanp_c')), x, z, x + CELL, z + CELL, 0.10)
        elif is_apron(cx, cz):
            # piazzola attrazione: terra battuta uniforme
            cella('terra_fiera', x, z, x + CELL, z + CELL, 0.06)
        else:
            # prato con qualche macchia di terra sparsa (~10%)
            cella('prato' if random.random() < 0.9 else 'terra_fiera', x, z, x + CELL, z + CELL, 0.06)
        z += CELL
    x += CELL

# GOLA d'ingresso: tappeto sanpietrini dall'ovale piazza (z=-16) al recinto (z=-18)
zz = -18.0
while zz < -16.05:
    xx = 51.0
    while xx < 60.0:
        cella(random.choice(('sanp_a', 'sanp_b', 'sanp_c')), xx, zz, min(xx + CELL, 60.0), min(zz + CELL, -16.05), 0.10)
        xx += CELL
    zz += CELL

for mname, (verts, faces) in per_mat.items():
    mesh = bpy.data.meshes.new("pav_" + mname)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("pav_" + mname, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(M[mname if mname != 'terra_fiera' else 'terra'])

fl.export_glb("funland_base.glb")
fl.render_previews("funland_base", ortho_scale=62, quarter_pos=(40, -50, 35))
