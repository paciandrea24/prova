# zona-jazz-layout.py — assembla la Zona Jazz (v5.4: FIX import GLB — i root vanno
# ORBITATI attorno al pivot del modello, non solo ruotati su se stessi (bug che
# scombinava ogni pezzo fuori asse: insegne, falde, scale, sax) — e pavimentazione
# TUTTA a sanpietrini (mesh unica from_pydata, anelli concentrici, 3 toni).
# - Base a DISCO, 4 isolotti curvi coi varchi ai cardinali, perimetro circolare
#   chiuso (layout generale APPROVATO dall'utente).
# - ISOLATO CENTRALE a rettangolo smussato costruito A INCASTRO ESATTO: 4 file
#   dritte (corpi paralleli: eventuali sovrapposizioni laterali sono piatte e
#   invisibili) + angolari 02/02a a 45 negli smussi NO/NE/SE + il CLUB che occupa
#   da solo lo smusso SUD-OVEST (diagonale, fronte/sax/cresta completamente liberi).
#   Corte interna vuota ma SIGILLATA (mai visibile in gioco).
# - Isolotti e perimetro: spaziatura calcolata sulla linea INTERNA (r-3, dove i
#   corpi sono piu' vicini) con margine positivo -> MAI un edificio dentro l'altro;
#   ALTERNANZA RANDOMICA dei fronti (flip 180 con probabilita', seed fisso).
# Coordinate polari: phi in gradi, ORARIO da nord; x = r*sin(phi), z = -r*cos(phi).
# (coordinate di GIOCO: x est, z sud, fronte non ruotato = +Z; Blender: bx=x, by=-z)
# Verifica: render zona_top_debug.png con frecce-fronte per ogni edificio.
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import json
import math
import random
import bpy
import jazz_lib as jl

random.seed(7)   # layout riproducibile

# ── FOOTPRINT (larghezza, profondita) dai sorgenti delle ricette ──
DIMS = {
    "edificio_01": (6.0, 5.5),
    "edificio_02": (7.0, 6.0), "edificio_02a": (7.0, 6.0),
    "edificio_03": (3.2, 4.5), "edificio_03a": (3.2, 4.5),
    "edificio_04": (6.5, 5.5), "edificio_04a": (6.5, 5.5),
    "edificio_05": (5.5, 5.0), "edificio_05a": (5.5, 5.0),
    "edificio_06": (6.0, 5.0),
    "edificio_07": (5.5, 5.0), "edificio_07a": (5.5, 5.0),
    "edificio_08": (6.0, 5.5), "edificio_08a": (6.0, 5.5),
    "edificio_09": (8.0, 6.0), "edificio_09a": (8.0, 6.0),
    "edificio_10": (6.5, 6.0), "edificio_10a": (6.5, 6.0),
    "edificio13": (6.0, 5.5),
    "club": (13.0, 9.0),
}

R_ANELLO_B = 31.5    # isolotti curvi
R_PERIMETRO = 45.5   # muro circolare che chiude la mappa
R_BASE = 52.0        # disco di pavimentazione
Y_LOTTO = 0.10       # quota edifici sulle fondamenta
Y_SAGRATO = 0.16     # quota dell'isolato centrale sul lotto
# isolato centrale: facciate del rettangolo a x=+-BLK_X, z=+-BLK_Z;
# smussi a 45: angolari 02 (corda 7 -> cateto 4.95), club (corda 13 -> cateto 9.19)
BLK_X, BLK_Z = 13.0, 10.32
CAT_ANG = 7.0 / math.sqrt(2.0)
CAT_CLUB = 13.0 / math.sqrt(2.0)


def polar(r, phi_deg):
    a = math.radians(phi_deg)
    return r * math.sin(a), -r * math.cos(a)


def norm(deg):
    return round((deg + 180.0) % 360.0 - 180.0, 1)


def anello(mods, r, phi0, phi1, verso="fuori", gap=0.8, jit_rot=0.0, jit_r=0.0,
           p_flip=0.0):
    """Dispone mods lungo l'arco phi0..phi1 (orario da nord). L'occupazione
    angolare si calcola sulla linea INTERNA (r-3, dove i corpi sono piu' vicini):
    con gap>0 gli edifici non si compenetrano MAI. p_flip = probabilita' di
    girare il singolo edificio di 180 (alternanza randomica dei fronti)."""
    degs = [math.degrees((DIMS[m][0] + gap) / (r - 3.0)) for m in mods]
    scala = (phi1 - phi0) / sum(degs)
    out, phi = [], phi0
    for m, d in zip(mods, degs):
        pc = phi + d * scala / 2.0
        x, z = polar(r + random.uniform(-jit_r, jit_r), pc)
        rot = (180.0 - pc) if verso == "fuori" else -pc
        rot += random.uniform(-jit_rot, jit_rot)
        if random.random() < p_flip:
            rot += 180.0
        out.append((m, round(x, 2), round(z, 2), norm(rot)))
        phi += d * scala
    return out


def fila_blocco(mods, lato, c0, c1):
    """Fila DRITTA dell'isolato centrale, fronte in fuori, estremi FLUSH su
    [c0,c1]: l'eventuale eccedenza si assorbe con sovrapposizioni PARALLELE ai
    giunti (piatte, invisibili). Niente fessure verso la corte interna."""
    tot = sum(DIMS[m][0] for m in mods)
    aggiusta = (c1 - c0 - tot) / max(1, len(mods) - 1) if len(mods) > 1 else 0.0
    out, c = [], c0
    for m in mods:
        w, p = DIMS[m]
        cl = c + w / 2.0
        if lato == "N":
            out.append((m, round(cl, 2), round(-BLK_Z + p / 2.0, 2), 180))
        elif lato == "S":
            out.append((m, round(cl, 2), round(BLK_Z - p / 2.0, 2), 0))
        elif lato == "O":
            out.append((m, round(-BLK_X + p / 2.0, 2), round(cl, 2), -90))
        else:
            out.append((m, round(BLK_X - p / 2.0, 2), round(cl, 2), 90))
        c += w + aggiusta
    return out


# ── ISOLATO CENTRALE (a incastro esatto, corte sigillata) ──
# spans dei lati tra gli smussi
_nx0, _nx1 = -BLK_X + CAT_ANG, BLK_X - CAT_ANG          # lato N (tra NO e NE)
_sx0, _sx1 = -BLK_X + CAT_CLUB, BLK_X - CAT_ANG         # lato S (tra club e SE)
_wz0, _wz1 = -BLK_Z + CAT_ANG, BLK_Z - CAT_CLUB         # lato O (tra NO e club)
_ez0, _ez1 = -BLK_Z + CAT_ANG, BLK_Z - CAT_ANG          # lato E (tra NE e SE)
BLOCCO = (fila_blocco(["edificio_05", "edificio_07a", "edificio_05a"], "N", _nx0, _nx1)
          + fila_blocco(["edificio13", "edificio_06"], "S", _sx0, _sx1)
          + fila_blocco(["edificio_10"], "O", _wz0, _wz1)
          + fila_blocco(["edificio_01", "edificio_07"], "E", _ez0, _ez1))
# angolari negli smussi NO/NE/SE (fronte diagonale in fuori); lo smusso SO e' del club
_d_ang = (BLK_X + BLK_Z - CAT_ANG) / math.sqrt(2.0) - 3.0     # distanza centro 02
_d_club = (BLK_X + BLK_Z - CAT_CLUB) / math.sqrt(2.0) - 4.5   # distanza centro club
_c = _d_ang / math.sqrt(2.0)
BLOCCO += [("edificio_02", round(-_c, 2), round(-_c, 2), -135),
           ("edificio_02a", round(_c, 2), round(-_c, 2), 135),
           ("edificio_02", round(_c, 2), round(_c, 2), 45)]
_cc = _d_club / math.sqrt(2.0)
CLUB_POS = (round(-_cc, 2), round(_cc, 2), -45)

# ── ANELLO B (isolotti): 4 archi da 4, alternanza randomica dei fronti ──
ARCO_NE = anello(["edificio_09", "edificio_01", "edificio_04", "edificio_07a"],
                 R_ANELLO_B, 13, 77, "fuori", 1.0, 4, 0.5, p_flip=0.4)
ARCO_SE = anello(["edificio_04a", "edificio_08", "edificio_10", "edificio_05"],
                 R_ANELLO_B, 103, 167, "fuori", 1.0, 4, 0.5, p_flip=0.4)
ARCO_SO = anello(["edificio_10a", "edificio_06", "edificio_09a", "edificio_07"],
                 R_ANELLO_B, 193, 257, "fuori", 1.0, 4, 0.5, p_flip=0.4)
ARCO_NO = anello(["edificio_08a", "edificio_09", "edificio_03a", "edificio_06"],
                 R_ANELLO_B, 283, 347, "fuori", 1.0, 4, 0.5, p_flip=0.4)
ANELLO_B = ARCO_NE + ARCO_SE + ARCO_SO + ARCO_NO

# ── PERIMETRO: cerchio chiuso, fronte base DENTRO, flip col 25% ──
_CICLO = ["edificio_09", "edificio_03", "edificio_10", "edificio_05a", "edificio_01",
          "edificio_08", "edificio_04a", "edificio_06", "edificio_05", "edificio_10a",
          "edificio_07", "edificio_09a", "edificio_03a", "edificio_04", "edificio_08a",
          "edificio_07a"]
peri_mods, giro = [], 0.0
while giro < 2 * math.pi * (R_PERIMETRO - 3.0):
    m = _CICLO[len(peri_mods) % len(_CICLO)]
    peri_mods.append(m)
    giro += DIMS[m][0] + 0.4
# perimetro: quasi tutti verso l'interno, solo qualcuno girato (feedback utente)
PERIMETRO = anello(peri_mods, R_PERIMETRO, 0, 360, "dentro", gap=0.4, p_flip=0.12)

EDIFICI = ([("club", CLUB_POS[0], CLUB_POS[1], CLUB_POS[2], Y_SAGRATO)]
           + [(m, x, z, r, Y_SAGRATO) for m, x, z, r in BLOCCO]
           + [(m, x, z, r, Y_LOTTO) for m, x, z, r in ANELLO_B + PERIMETRO])
# scala leggermente diversa per ISTANZA (club escluso): rompe la complanarita'
# di tetti/cornicioni tra edifici sovrapposti ai giunti (z-fighting a strisce
# visto al gate v5.4) e varia le altezze dei modelli ripetuti. Anche nel JSON.
EDIFICI = [(m, x, z, r, y,
            1.0 if m == "club" else round(random.uniform(0.985, 1.035), 3))
           for m, x, z, r, y in EDIFICI]
CON_LASTRA = ANELLO_B + PERIMETRO   # l'isolato centrale sta sul lotto, non su lastre

# ── PROPS ──
PROPS = []
for x, z in ((5.0, -13.4), (-5.0, -13.4), (5.0, 13.4), (-5.0, 13.4),
             (15.9, -5.0), (15.9, 5.0), (-15.9, -5.0), (-15.9, 5.0)):
    PROPS.append(("props/lampione", x, z, 0))   # attorno all'isolato centrale
for card in (0, 90, 180, 270):   # lampioni agli imbocchi dei 4 varchi
    for dphi in (-13, 13):
        x, z = polar(31.0, card + dphi)
        PROPS.append(("props/lampione", round(x, 2), round(z, 2), 0))
for card in (0, 90, 180, 270):   # lampioni sul perimetro ai cardinali
    x, z = polar(41.5, card)
    PROPS.append(("props/lampione", round(x, 2), round(z, 2), 0))
for diag in (45, 135, 225, 315):  # festoni RADIALI in corsia 2 (rotY = 90-phi)
    x, z = polar(38.5, diag)
    PROPS.append(("props/festone_10m", round(x, 2), round(z, 2), norm(90 - diag)))
# insegna DANCE RIMOSSA (2026-07-09): ARCO_SO[1] è capitato essere il barbiere
# (edificio_06) e un banner verticale "DANCE" sulla sua facciata non c'entrava
# niente. Se si vorrà reintrodurla, ancorarla a un edificio a tema (ballroom)
# scelto per MODELLO, non per posizione nell'arco.
# _m, _x, _z, _r = ARCO_SO[1]
# _dx, _dz = math.sin(math.radians(_r)), math.cos(math.radians(_r))
# _d = DIMS[_m][1] / 2.0 + 0.4
# PROPS.append(("props/insegna_verticale", round(_x + _d * _dx, 2),
#               round(_z + _d * _dz, 2), _r))
FESTONE_Z = 4.2

# ── VIE (corde approssimate delle corsie anulari + varchi radiali ai cardinali) ──
VIE = [
    {"nome": "corsia1_nord", "asse": "x", "da": -20, "a": 20, "centro": -20, "larghezza": 13},
    {"nome": "corsia1_sud", "asse": "x", "da": -20, "a": 20, "centro": 20, "larghezza": 13},
    {"nome": "corsia1_ovest", "asse": "z", "da": -20, "a": 20, "centro": -21, "larghezza": 11},
    {"nome": "corsia1_est", "asse": "z", "da": -20, "a": 20, "centro": 21, "larghezza": 11},
    {"nome": "corsia2_nord", "asse": "x", "da": -27, "a": 27, "centro": -38.5, "larghezza": 7},
    {"nome": "corsia2_sud", "asse": "x", "da": -27, "a": 27, "centro": 38.5, "larghezza": 7},
    {"nome": "corsia2_ovest", "asse": "z", "da": -27, "a": 27, "centro": -38.5, "larghezza": 7},
    {"nome": "corsia2_est", "asse": "z", "da": -27, "a": 27, "centro": 38.5, "larghezza": 7},
    {"nome": "varco_nord", "asse": "z", "da": -35, "a": -27, "centro": 0, "larghezza": 11},
    {"nome": "varco_sud", "asse": "z", "da": 27, "a": 35, "centro": 0, "larghezza": 11},
    {"nome": "varco_ovest", "asse": "x", "da": -35, "a": -27, "centro": 0, "larghezza": 11},
    {"nome": "varco_est", "asse": "x", "da": 27, "a": 35, "centro": 0, "larghezza": 11},
]

# ── PAVIMENTAZIONE (coordinate Blender: by = -z; forme simmetriche) ──
jl.clear_scene()
mat_fuga = jl.flat_material("fuga_scura", (0.24, 0.22, 0.20, 1.0))
mat_piazza = jl.flat_material("pietra_piazza", (0.60, 0.57, 0.52, 1.0))
mat_cordolo = jl.flat_material("cordolo", (0.70, 0.68, 0.63, 1.0))
mat_sanp = jl.flat_material("sanpietrino", (0.44, 0.42, 0.40, 1.0))
mat_tombino = jl.flat_material("tombino", (0.20, 0.18, 0.16, 1.0))
# toni ben distanziati + fuga larga: a scala urbana (render e in gioco) pietre
# quasi uguali con fuga di 5cm diventano un grigio UNIFORME (visto al primo giro)
MATS_PIETRE = [jl.flat_material("sanp_a", (0.36, 0.34, 0.31, 1.0)),
               jl.flat_material("sanp_b", (0.46, 0.44, 0.41, 1.0)),
               jl.flat_material("sanp_c", (0.55, 0.53, 0.49, 1.0))]


def sanpietrini_disco(nome, r_in, r_out, dr=0.72, arco=1.05, fuga=0.10, seed=11):
    """Pavimento a sanpietrini su TUTTO il disco: anelli concentrici di pietre
    (prismi bassi, giunti sfalsati per anello, quota top con jitter, fuga scura
    del disco base a vista). UNA sola mesh via from_pydata: migliaia di add_box
    sarebbero lentissimi e ognuno un oggetto."""
    rnd = random.Random(seed)
    verts, faces, mat_idx = [], [], []
    r = r_in
    while r < r_out - 0.1:
        r1 = min(r + dr, r_out)
        n = max(8, int(2.0 * math.pi * ((r + r1) / 2.0) / arco))
        off = rnd.uniform(0.0, 2.0 * math.pi)   # sfalsa i giunti tra anelli
        ga = fuga / ((r + r1) / 2.0)            # fuga in angolo
        for i in range(n):
            a0 = off + 2.0 * math.pi * i / n + ga / 2.0
            a1 = off + 2.0 * math.pi * (i + 1) / n - ga / 2.0
            rr0, rr1 = r + fuga / 2.0, r1 - fuga / 2.0
            # top MAX 0.098: a 0.10 sarebbe complanare con le lastre di fondazione
            top = rnd.uniform(0.082, 0.098)
            b = len(verts)
            for zq in (0.03, top):
                for rr, aa in ((rr0, a0), (rr1, a0), (rr1, a1), (rr0, a1)):
                    verts.append((rr * math.cos(aa), rr * math.sin(aa), zq))
            faces += [(b + 4, b + 5, b + 6, b + 7), (b + 3, b + 2, b + 1, b),
                      (b, b + 1, b + 5, b + 4), (b + 1, b + 2, b + 6, b + 5),
                      (b + 2, b + 3, b + 7, b + 6), (b + 3, b, b + 4, b + 7)]
            mat_idx += [rnd.randrange(len(MATS_PIETRE))] * 6
        r = r1
    mesh = bpy.data.meshes.new(nome)
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(nome, mesh)
    bpy.context.collection.objects.link(obj)
    for m in MATS_PIETRE:
        obj.data.materials.append(m)
    for poly, mi in zip(mesh.polygons, mat_idx):
        poly.material_index = mi
    print(f"{nome}: {len(faces) // 6} pietre, {len(verts)} vertici")


# disco base scuro (= fuga tra le pietre) + sanpietrini ovunque
jl.add_cyl("base_fuga", R_BASE, 0.06, 0, 0, 0.0, mat_fuga, vertices=64)
sanpietrini_disco("sanpietrini", 9.5, R_BASE)   # dentro r=9.5 c'e' il lotto centrale
# lotto dell'isolato centrale: rettangolo smussato (2 box + 4 cilindri d'angolo)
RC = 5.5   # raggio degli smussi del lotto
for nome, lip, h, mat in (("lotto_cordolo", 0.85, 0.12, mat_cordolo),
                          ("lotto_centrale", 0.55, 0.16, mat_piazza)):
    ax, az = BLK_X + lip, BLK_Z + lip
    jl.add_box(f"{nome}_x", 2 * ax, 2 * (az - RC), h, 0, 0, 0.0, mat, bevel=0)
    jl.add_box(f"{nome}_z", 2 * (ax - RC), 2 * az, h, 0, 0, 0.0, mat, bevel=0)
    for sx in (-1, 1):
        for sz in (-1, 1):
            jl.add_cyl(f"{nome}_c{sx}{sz}", RC, h, sx * (ax - RC), sz * (az - RC),
                       0.0, mat, vertices=24)
# fondamenta: lastra ruotata sotto ogni edificio di anello B e perimetro
for i, (m, x, z, r) in enumerate(CON_LASTRA):
    w, p = DIMS[m]
    jl.add_box(f"lotto_{i}", w + 1.6, p + 1.6, Y_LOTTO, x, -z, 0.0, mat_cordolo, bevel=0.01)
    jl.bpy.context.object.rotation_euler = (0, 0, math.radians(r))
# tombini con anello di sanpietrini, sul bordo delle corsie
for ti, phi_t, r_t in ((0, 70, 25.0), (1, 250, 25.0), (2, 160, 36.0), (3, 340, 36.0)):
    tx, tz = polar(r_t, phi_t)
    jl.add_cyl(f"tombino_{ti}", 0.45, 0.03, tx, -tz, 0.08, mat_tombino, vertices=20)
    for i in range(10):
        a = math.radians(36 * i)
        jl.add_box(f"tomb_sanp_{ti}_{i}", 0.20, 0.13, 0.03, tx + 0.62 * math.cos(a),
                   -tz + 0.62 * math.sin(a), 0.08, mat_sanp, bevel=0.008)
        jl.bpy.context.object.rotation_euler = (0, 0, a)
jl.export_glb("pavimentazione.glb")

# ── zona-layout.json ──
layout = {"edifici": [{"modello": m, "x": x, "z": z, "rotY": r, "y": y, "s": s}
                      for m, x, z, r, y, s in EDIFICI],
          "props": [{"modello": m, "x": x, "z": z, "rotY": r,
                     "y": FESTONE_Z if "festone" in m else 0.0} for m, x, z, r in PROPS],
          "vie": VIE}
with open(jl.WORKTREE + "/frontend/assets/models/jazz/zona-layout.json", "w", encoding="utf-8") as f:
    json.dump(layout, f, indent=2, ensure_ascii=False)
print("Scritto zona-layout.json")

# ── COMPOSIZIONE: importa e piazza tutti i GLB sul pavimento ──
def piazza_glb(modello, x, z, rot_deg, alt=0.0, s=1.0):
    # NB: i GLB importano DECINE di root separati. Ruotare solo rotation_euler
    # gira ogni pezzo su se stesso: la POSIZIONE di ogni root va orbitata attorno
    # al pivot del modello (origine) con lo stesso angolo, sennò i pezzi fuori
    # asse (insegne, falde, scale, sax) restano al posto non ruotato.
    # s = similitudine attorno al pivot (base a z=0 resta a terra).
    prima = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=jl.MODELS_DIR + "/" + modello + ".glb")
    rot = math.radians(rot_deg)
    ca, sa = math.cos(rot), math.sin(rot)
    for obj in set(bpy.data.objects) - prima:
        if obj.parent is None:
            obj.rotation_mode = 'XYZ'
            obj.rotation_euler = (obj.rotation_euler.x, obj.rotation_euler.y,
                                  obj.rotation_euler.z + rot)
            obj.scale = (obj.scale.x * s, obj.scale.y * s, obj.scale.z * s)
            lx, ly = obj.location.x * s, obj.location.y * s
            obj.location = (lx * ca - ly * sa + x, lx * sa + ly * ca - z,
                            obj.location.z * s + alt)

for m, x, z, r, y, s in EDIFICI:
    piazza_glb(m, x, z, r, alt=y, s=s)
for m, x, z, r in PROPS:
    piazza_glb(m, x, z, r, alt=FESTONE_Z if "festone" in m else 0.0)

# ── FRECCE DEBUG: una per edificio, sopra i tetti, punta verso il FRONTE ──
mat_dbg = jl.flat_material("DBG_freccia", (1.0, 0.0, 0.9, 1.0))
for i, (m, x, z, r, y, s) in enumerate(EDIFICI):
    p = DIMS[m][1]
    sx, cz = math.sin(math.radians(r)), math.cos(math.radians(r))
    d = p / 2.0 + 1.3
    jl.add_box(f"DBG_shaft_{i}", 0.6, 2.6, 0.3, x + d * sx, -(z + d * cz), 16.0, mat_dbg, bevel=0)
    jl.bpy.context.object.rotation_euler = (0, 0, math.radians(r))
    d2 = d + 2.0
    jl.add_box(f"DBG_head_{i}", 1.6, 0.7, 0.3, x + d2 * sx, -(z + d2 * cz), 16.0, mat_dbg, bevel=0)
    jl.bpy.context.object.rotation_euler = (0, 0, math.radians(r))

# ── Render: top debug (con frecce) -> elimina frecce -> top + 3 prospettiche ──
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'MATERIAL'
scene.render.resolution_x = 1400
scene.render.resolution_y = 1200
cam_top = bpy.data.objects.new("cam_top", bpy.data.cameras.new("cam_top"))
cam_top.data.type = 'ORTHO'
cam_top.data.ortho_scale = 112
cam_top.data.clip_end = 500
cam_top.location = (0, 0, 80)
bpy.context.collection.objects.link(cam_top)
scene.camera = cam_top
scene.render.filepath = jl.PREVIEW_DIR + "/zona_top_debug.png"
bpy.ops.render.render(write_still=True)

for obj in [o for o in bpy.data.objects if o.name.startswith("DBG_")]:
    bpy.data.objects.remove(obj, do_unlink=True)

scene.render.filepath = jl.PREVIEW_DIR + "/zona_top.png"
bpy.ops.render.render(write_still=True)
target = bpy.data.objects.new("zona_target", None)
target.location = (0, 0, 3)
bpy.context.collection.objects.link(target)
for nome, pos in (("sw", (-68, -78, 48)), ("s", (0, -92, 52)), ("ne", (62, 72, 46))):
    cam = bpy.data.objects.new(f"cam_{nome}", bpy.data.cameras.new(f"cam_{nome}"))
    cam.location = pos
    cam.data.clip_end = 500
    bpy.context.collection.objects.link(cam)
    tc = cam.constraints.new(type='TRACK_TO')
    tc.target = target
    tc.track_axis = 'TRACK_NEGATIVE_Z'
    tc.up_axis = 'UP_Y'
    scene.camera = cam
    scene.render.filepath = jl.PREVIEW_DIR + f"/zona_{nome}.png"
    bpy.ops.render.render(write_still=True)

# Primi piani di verifica: club (il fronte deve dare sulla corsia 1) e pavimento
for nome, pos, tgt in (
        ("club_close", (CLUB_POS[0] - 24, -CLUB_POS[1] - 24, 10),
         (CLUB_POS[0], -CLUB_POS[1], 6.5)),
        ("pav_close", (0, -30, 2.0), (0, -20, 0.3))):
    t = bpy.data.objects.new(f"tgt_{nome}", None)
    t.location = tgt
    bpy.context.collection.objects.link(t)
    cam = bpy.data.objects.new(f"cam_{nome}", bpy.data.cameras.new(f"cam_{nome}"))
    cam.location = pos
    cam.data.clip_end = 500
    bpy.context.collection.objects.link(cam)
    tc = cam.constraints.new(type='TRACK_TO')
    tc.target = t
    tc.track_axis = 'TRACK_NEGATIVE_Z'
    tc.up_axis = 'UP_Y'
    scene.camera = cam
    scene.render.filepath = jl.PREVIEW_DIR + f"/zona_{nome}.png"
    bpy.ops.render.render(write_still=True)
print("Render zona completati")
