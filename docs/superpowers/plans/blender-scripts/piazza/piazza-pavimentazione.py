# piazza-pavimentazione.py — pavimento ovale a sanpietrini (piazza_base.glb)
# Origine GLB al CENTRO piazza: l'istanza nel layout sta a (55.5, 0).
# Anelli concentrici di conci trapezoidali from_pydata (pattern Jazz:
# mesh unica PER MATERIALE, 3 grigi alternati) + fascia cordolo esterna.
# Nessuna COL: il pavimento e' calpestabile via quota (top a bz +0.10,
# con offset zona -0.10 → y mondo ≈ 0 come la Jazz).
import sys, math, random
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/piazza")
import bpy
import piazza_lib as pl

pl.clear_scene()
M = pl.materiali()
random.seed(55)

# Anelli concentrici: frazioni dei semiassi (l'ultimo anello è il cordolo).
RINGS = [0.16, 0.30, 0.44, 0.58, 0.72, 0.86, 1.00]
SEGS = 64
H = 0.10          # top a bz=+0.10 → y mondo ≈ 0 (offset zona −0.10)
GAP = 0.965       # scala del concio → fuga visibile ~3-4 cm

per_mat = {k: ([], []) for k in ('sanp_a', 'sanp_b', 'sanp_c', 'cordolo')}
def quad(mat, p0, p1, p2, p3):
    # NB: ordine INVERTITO (p3→p0): la mappa (lx,−lz) specchia il winding, e in
    # Three.js (FrontSide) le facce orarie sparirebbero → pavimento "nero"
    verts, faces = per_mat[mat]
    b = len(verts)
    for (lx, lz) in (p3, p2, p1, p0):
        verts.append((lx, -lz, 0.0))          # base (bz 0)
    for (lx, lz) in (p3, p2, p1, p0):
        verts.append((lx, -lz, H))            # top
    faces += [(b+4, b+5, b+6, b+7),           # top
              (b+0, b+1, b+5, b+4), (b+1, b+2, b+6, b+5),
              (b+2, b+3, b+7, b+6), (b+3, b+0, b+4, b+7)]

LIM_E = 65.35 - 55.5     # filo braccio Galleria in x LOCALE (5 cm prima di 65.4)
R_JZ = 45.55             # bordo sanpietrini del disco Jazz (r dal centro MONDO)


def clip_concio(pts):
    # Clampa i vertici oltre i confini (piano EST, cerchio Jazz a OVEST);
    # None se il concio è interamente oltre (degenererebbe in una linea).
    out, viol = [], 0
    for (px, pz) in pts:
        if px > LIM_E:
            px = LIM_E
            viol += 1
        wx = 55.5 + px
        r = math.hypot(wx, pz)
        if r < R_JZ:
            k = R_JZ / r
            px, pz = wx * k - 55.5, pz * k
            viol += 1
        out.append((px, pz))
    return None if viol >= 4 else out


prev = 0.04
for ri, f in enumerate(RINGS):
    mat = 'cordolo' if ri == len(RINGS) - 1 else random.choice(('sanp_a', 'sanp_b', 'sanp_c'))
    for s in range(SEGS):
        t0, t1 = 2*math.pi*s/SEGS, 2*math.pi*(s+1)/SEGS
        mat_s = mat if ri == len(RINGS)-1 else random.choice(('sanp_a', 'sanp_b', 'sanp_c'))
        pts = []
        for (fr, t) in ((prev, t0), (f, t0), (f, t1), (prev, t1)):
            lx, lz = pl.A*fr*math.sin(t), -pl.B*fr*math.cos(t)
            pts.append((lx, lz))
        # restringi il concio verso il suo centro → fuga
        cx = sum(p[0] for p in pts)/4; cz = sum(p[1] for p in pts)/4
        pts = [(cx+(p[0]-cx)*GAP, cz+(p[1]-cz)*GAP) for p in pts]
        # CLIP anti z-fighting: i conci NON devono sovrapporsi ai pavimenti
        # dritti adiacenti (braccio Galleria a x>65.4, sanpietrini Jazz r<45.5).
        # CLAMP dei vertici sul confine (non drop del quad intero: lasciava un
        # bordo a scalini): il bordo conci segue esattamente cerchio/filo.
        pts = clip_concio(pts)
        if pts is None:
            continue
        quad(mat_s, *pts)
    prev = f

for mname, (verts, faces) in per_mat.items():
    mesh = bpy.data.meshes.new("pav_" + mname)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("pav_" + mname, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(M[mname])

# disco di chiusura sotto la fontana (il foro centrale prev=0.04)
pl.add_cyl("pav_centro", pl.A*0.17, H, 0, 0, 0, M['pietra'], vertices=48)

# LETTO DI MALTA sotto i conci: disco ellittico pieno, top a 0.07 (3 cm sotto
# il top dei conci) → le fughe sono scanalature riempite, non buchi sul void.
FUGA_H = 0.03   # 3 cm sotto i raccordi (0.06): quote troppo vicine sfarfallano
mat_fuga = pl.flat_material('fuga', (0.24, 0.22, 0.20, 1))
NSEG = 64
# anello ANTIORARIO (cos, sin) → normale del top verso l'ALTO (in Three.js
# r128 FrontSide una faccia invertita sparirebbe vista da sopra)
ring = [(pl.A * math.cos(2*math.pi*i/NSEG), pl.B * math.sin(2*math.pi*i/NSEG))
        for i in range(NSEG)]
verts = [(x, y, 0.0) for (x, y) in ring] + [(x, y, FUGA_H) for (x, y) in ring]
faces = [tuple(range(NSEG, 2*NSEG))]                       # top (ngon)
faces += [(i, (i+1) % NSEG, NSEG + (i+1) % NSEG, NSEG + i) for i in range(NSEG)]
mesh = bpy.data.meshes.new("pav_fuga")
mesh.from_pydata(verts, [], faces)
mesh.update()
obj = bpy.data.objects.new("pav_fuga", mesh)
bpy.context.collection.objects.link(obj)
obj.data.materials.append(mat_fuga)

# RACCORDI ai varchi OVEST/EST: tra il bordo del disco Jazz (r45.5, centro
# mondo (0,0)) e l'ovale resta una LENTE di void senza pavimento (idem, più
# stretta, verso il braccio Galleria a x=65.4). Strisce di PIETRA a filo del
# calpestio: continuità visiva senza z-fighting dove passano SOTTO i pavimenti
# esistenti. Con l'istanza piazza_base a y=−0.02: top raccordo a mondo −0.06,
# 2 cm sotto la base_fuga Jazz (−0.04) e 3 cm sotto le mattonelle Galleria.
RACC_H = 0.06

def strip(nome, z0, z1, fx0, fx1, seg=24):
    # striscia lungo z (coord GIOCO locali): quad tra fx0(z) e fx1(z), con pareti
    verts, faces = [], []
    for i in range(seg + 1):
        z = z0 + (z1 - z0) * i / seg
        for lx in (fx0(z), fx1(z)):
            verts.append((lx, -z, 0.0))
            verts.append((lx, -z, RACC_H))
    for i in range(seg):
        b = i * 4
        faces += [(b+1, b+5, b+7, b+3),          # top
                  (b+0, b+4, b+5, b+1),          # parete lato fx0
                  (b+2, b+3, b+7, b+6)]          # parete lato fx1
    mesh = bpy.data.meshes.new(nome)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(nome, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(M['pietra'])   # stesso grigio della strada Jazz

def x_disc(z):    # bordo disco Jazz in x LOCALE piazza (mondo → −55.5)
    return math.sqrt(45.5**2 - z*z) - 55.5

def x_ell_o(z):   # bordo OVEST dell'ovale
    return -pl.A * math.sqrt(max(0.0, 1 - (z/pl.B)**2))

def x_ell_e(z):   # bordo EST dell'ovale
    return pl.A * math.sqrt(max(0.0, 1 - (z/pl.B)**2))

# Overshoot MINIMO verso i pavimenti adiacenti: passare 60 cm SOTTO i
# sanpietrini Jazz (top con jitter fino a −0.018 vs raccordo −0.025) faceva
# sfarfallio su tutta la banda di sovrapposizione. 5 cm sotto il filo disco a
# ovest; 2 cm PRIMA delle mattonelle Galleria a est (la fessura mostra la
# base scura sottostante → fuga).
strip("racc_ovest", -5.6, 3.4, lambda z: x_disc(z) - 0.05, lambda z: x_ell_o(z) + 0.6)
strip("racc_est",   -5.2, 5.2, lambda z: x_ell_e(z) - 0.6, lambda z: 9.88)

pl.export_glb("piazza_base.glb")
pl.render_previews("piazza_base", ortho_scale=40, quarter_pos=(30, -34, 22))
