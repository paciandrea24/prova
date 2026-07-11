# galleria-layout.py — assembla la Galleria d'Arte Art Déco.
# Croce (4 bracci ai cardinali) + rotonda centrale: pareti a campate modulari
# (pilastri sui giunti, vetrine al PT, arcate sopra, volta vetrata), 4 angoli
# smussati alla rotonda, portali alle estremita', mezzanino ad anello (costruito
# QUI dentro pavimentazione.glb, con COL) + gallerie sui bracci (moduli GLB),
# 2 scale a pioli (zone climb nel JSON), fontana e insegna pensile.
# RNG A SEME FISSO: sceglie le vetrine entrabili e i retro-corridoi di flanking.
# Coordinate di GIOCO: x est, z sud, fronte non ruotato = +Z; Blender: bx=x, by=-z.
# Verifica: render galleria_top_debug.png con frecce-fronte.
import sys
# Path della work directory UNICA (i worktree sono stati consolidati e rimossi)
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/galleria")
import json
import math
import random
import bpy
import importlib
import galleria_lib as gl
importlib.reload(gl)

# Copia di lavoro: output nelle cartelle -wip (originali congelati)
gl.MODELS_DIR = "C:/Users/pacia/Desktop/Claude Workspace/prova/frontend/assets/models/galleria-wip"
gl.PREVIEW_DIR = "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/galleria/preview"

rng = random.Random(24)   # layout riproducibile

# ── QUOTE DELLA PIANTA ──
BAY = 5.5                 # campata
HALF = 4.5                # semilarghezza corridoio
Z_M = 9.6                 # linea degli imbocchi (|4.5|,|9.6| sul cerchio r 10.6)
Z_END = 31.6              # filo facciata dei portali
BAYS = [Z_M + BAY / 2 + BAY * i for i in range(4)]   # centri campate: 12.35..28.85
GIUNTI = [Z_M + BAY * i for i in range(5)]           # pilastri: 9.6..31.6
C_MID = (4.5 + 9.6) / 2   # 7.05 — centro pareti d'angolo
CORNER_W = math.hypot(9.6 - 4.5, 9.6 - 4.5)          # 7.21
DECK = 2.5                # profondita' ballatoio
Z_TOP = 4.5               # calpestio mezzanino
CEILING_Y = 8.5           # soffitto di gioco (sotto l'imposta delle volte)


def rot(x, z, deg):
    a = math.radians(deg)
    return (round(x * math.cos(a) - z * math.sin(a), 2),
            round(x * math.sin(a) + z * math.cos(a), 2))


def norm(deg):
    return round((deg + 180.0) % 360.0 - 180.0, 1)


# ── SCELTA NEGOZI (RNG a seme fisso) ──
# 32 campate nei bracci: (braccio 0..3, lato 0=est/1=ovest in coordinate base, i 0..3)
# NB: le campate scala (braccio 0 e 2, lato est, i=3) restano vetrine chiuse.
LADDER_BAYS = {(0, 0, 3), (2, 0, 3)}
tutte = [(b, l, i) for b in range(4) for l in range(2) for i in range(4)
         if (b, l, i) not in LADDER_BAYS]
# 2 coppie di retro-corridoio: 2 muri diversi, 2 campate non adiacenti sullo stesso muro
muri = [(b, l) for b in range(4) for l in range(2)]
muri_retro = rng.sample(muri, 2)
RETRO = set()
for (b, l) in muri_retro:
    scelte = [i for i in range(4) if (b, l, i) not in LADDER_BAYS]
    i1, i2 = rng.sample(scelte, 2)
    while abs(i1 - i2) < 2:   # non adiacenti: il corridoio deve "saltare" una campata
        i1, i2 = rng.sample(scelte, 2)
    RETRO.add((b, l, min(i1, i2)))
    RETRO.add((b, l, max(i1, i2)))
# 3 entrabili singoli (senza retro) tra le campate rimaste
resto = [t for t in tutte if t not in RETRO]
ENTRABILI = set(rng.sample(resto, 3)) | RETRO
print("Entrabili:", sorted(ENTRABILI), "— con retro:", sorted(RETRO))


# ── ISTANZE (modello, x, z, rotY) in coordinate base braccio NORD, poi ruotate ──
EDIFICI = []   # (modello, x, z, rotY, y, s)


def add(modello, x, z, r, y=0.0, s=1.0):
    EDIFICI.append((modello, round(x, 2), round(z, 2), norm(r), y, s))


for b in range(4):   # bracci: 0=N, 1=E, 2=S, 3=O (phi = 90*b orario da nord)
    phi = 90 * b
    for l, (x_w, r_w) in enumerate(((HALF, -90), (-HALF, 90))):   # lato est/ovest
        for i, zc in enumerate(BAYS):
            x, z = rot(x_w, -zc, phi)
            r = r_w - phi
            if (b, l, i) in RETRO:
                mod = "vetrina_entrabile_retro"
            elif (b, l, i) in ENTRABILI:
                mod = "vetrina_entrabile"
            else:
                mod = "vetrina_chiusa_a" if rng.random() < 0.55 else "vetrina_chiusa_b"
            add(mod, x, z, r)
            add("arcata", x, z, r)
            add("mezzanino_varco" if (b, l, i) in LADDER_BAYS else "mezzanino", x, z, r)
        for zj in GIUNTI[1:]:   # pilastri sui giunti (il primo e' l'imbocco, sotto)
            x, z = rot(x_w, -zj, phi)
            add("pilastro", x, z, r_w - phi)
    for zc in BAYS:             # volte vetrate sopra il corridoio
        x, z = rot(0, -zc, phi)
        add("volta", x, z, -phi)
    x, z = rot(0, -Z_END, phi)  # portale d'estremita'
    # EST (b==1) sigillato (porta verde piena, vicolo cieco); N/S (b 0,2) = PORTA A VARCO
    # verde (accesso ai flank, sommità chiusa → niente scavalco); OVEST (b==3) = corridoio
    # principale aperto (portale_aperto).
    if b == 1:
        add("portale", x, z, -phi)
    elif b in (0, 2):
        add("portale_varco", x, z, -phi)
    else:
        add("portale_aperto", x, z, -phi)
    # pilastri degli imbocchi (bisettrici tra parete braccio e parete d'angolo)
    for (px, pz, pr) in ((HALF, -Z_M, -67.5), (Z_M, -HALF, -22.5)):
        x, z = rot(px, pz, phi)
        add("pilastro", x, z, pr - phi)
    # parete d'angolo della rotonda (vetrina chiusa + arcata, sempre cieca)
    x, z = rot(C_MID, -C_MID, phi)
    add("vetrina_chiusa_b" if b % 2 else "vetrina_chiusa_a", x, z, -45 - phi)
    add("arcata", x, z, -45 - phi)

# rotonda (tamburo+cupola), fontana, insegna
add("rotonda", 0, 0, 0)
add("fontana", 0, 0, 22.5)     # ruotata: spigoli dell'ottagono verso i bracci
add("insegna", 0, 0, 0)

# scale a pioli: bordo della galleria est del braccio N e S (campata i=3),
# appoggiate alla fascia del ballatoio (piano x=|HALF|-DECK=2.0), fronte verso
# il corridoio. Zone CLIMB nel JSON (la scala non ha COL).
SCALE = []
CLIMB = []
for phi in (0, 180):
    zc = BAYS[3]
    x, z = rot(HALF - DECK, -zc, phi)
    r = -90 - phi
    add("scala_pioli", x, z, r)
    fx, fz = rot(1.75, -zc, phi)
    CLIMB.append({"x": fx, "z": fz, "w": 1.5, "d": 1.3,
                  "y0": 0.0, "y1": Z_TOP + 0.05, "faceRot": norm(90 - phi)})

# ── VIE (per compatibilita' col contratto jazz) ──
VIE = [
    {"nome": "braccio_nord", "asse": "z", "da": -31, "a": -10, "centro": 0, "larghezza": 9},
    {"nome": "braccio_sud", "asse": "z", "da": 10, "a": 31, "centro": 0, "larghezza": 9},
    {"nome": "braccio_ovest", "asse": "x", "da": -31, "a": -10, "centro": 0, "larghezza": 9},
    {"nome": "braccio_est", "asse": "x", "da": 10, "a": 31, "centro": 0, "larghezza": 9},
    {"nome": "rotonda", "asse": "x", "da": -7, "a": 7, "centro": 0, "larghezza": 14},
]

# ═════════════════════════════════════════════════════════════
# PAVIMENTAZIONE.GLB: pavimento in marmo con intarsi Déco + anello del
# mezzanino (decks+parapetti+COL) + retro-corridoi + props (panche, urne)
# ═════════════════════════════════════════════════════════════
gl.clear_scene()
mats = gl.make_materials()
MATS_PAV = [mats['marmo_chiaro'], mats['marmo_scuro'], mats['marmo_verde'], mats['nero']]
_verts, _faces, _midx = [], [], []


def tile(cx, cz, w, d, mat_i, rot_deg=0.0, top=0.07, z0=0.03):
    # un tassello di marmo (prisma) nella mesh unica; (cx,cz) in coordinate GIOCO
    a = math.radians(rot_deg)
    ca, sa = math.cos(a), math.sin(a)
    b = len(_verts)
    for zq in (z0, top):
        for (dx, dz) in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
            gx = cx + dx * ca - dz * sa
            gz = cz + dx * sa + dz * ca
            _verts.append((gx, -gz, zq))   # Blender: by = -z
    _faces.extend([(b + 4, b + 5, b + 6, b + 7), (b + 3, b + 2, b + 1, b),
                   (b, b + 1, b + 5, b + 4), (b + 1, b + 2, b + 6, b + 5),
                   (b + 2, b + 3, b + 7, b + 6), (b + 3, b, b + 4, b + 7)])
    _midx.extend([mat_i] * 6)


def sector_tile(r0, r1, a0_deg, a1_deg, mat_i, top=0.07):
    # tassello a settore anulare (per il pavimento a raggiera della rotonda)
    b = len(_verts)
    a0, a1 = math.radians(a0_deg), math.radians(a1_deg)
    for zq in (0.03, top):
        for (rr, aa) in ((r0, a0), (r1, a0), (r1, a1), (r0, a1)):
            gx, gz = rr * math.sin(aa), -rr * math.cos(aa)
            _verts.append((gx, -gz, zq))
    _faces.extend([(b + 4, b + 5, b + 6, b + 7), (b + 3, b + 2, b + 1, b),
                   (b, b + 1, b + 5, b + 4), (b + 1, b + 2, b + 6, b + 5),
                   (b + 2, b + 3, b + 7, b + 6), (b + 3, b, b + 4, b + 7)])
    _midx.extend([mat_i] * 6)


# bracci: fascia nera lungo i muri, campo a scacchi chiaro con croci verdi
T = 1.44   # passo tassello (6 colonne su 9 m con fuga)
for phi in (0, 90, 180, 270):
    for j in range(15):   # righe lungo il braccio
        zc = Z_M + 0.75 + j * T
        if zc > Z_END - 0.6:
            continue
        for c in range(6):
            xc = -HALF + 0.78 + c * T
            if c in (0, 5):
                mi = 3          # bordo nero lungo i muri
            elif (c + j) % 2 == 0:
                mi = 0          # marmo chiaro
            else:
                mi = 1 if (c + j) % 4 != 1 else 2   # scuro con accenti verdi
            gx, gz = rot(xc, -zc, phi)
            tile(gx, gz, T - 0.06, T - 0.06, mi, rot_deg=phi)
# rotonda: pavimento a RAGGIERA (sunburst Déco), anello verde a meta'.
# I settori che sconfinano negli IMBOCCHI dei bracci si SALTANO: lì il pavimento
# dritto dei bracci è alla stessa quota (top 0.07) e la sovrapposizione
# complanare faceva z-fighting. Sotto resta la base scura → si legge come fuga.
def _in_imbocco(r, a_deg):
    a = math.radians(a_deg)
    gx, gz = r * math.sin(a), -r * math.cos(a)
    return min(abs(gx), abs(gz)) < HALF + 0.15 and max(abs(gx), abs(gz)) > Z_M - 0.1


NSEC = 28
for ring, (r0, r1) in enumerate(((2.8, 4.7), (4.75, 6.6), (6.65, 7.35), (7.4, 9.3), (9.35, 10.45))):
    for s in range(NSEC):
        a0 = 360.0 * s / NSEC + ring * 6
        a1 = 360.0 * (s + 1) / NSEC + ring * 6
        mi = 2 if ring == 2 else (s % 2 if ring % 2 == 0 else (s + 1) % 2)
        if any(_in_imbocco(r, a) for r in (r0, r1)
               for a in (a0 + 0.35, a1 - 0.35, (a0 + a1) / 2)):
            continue
        sector_tile(r0, r1 - 0.0, a0 + 0.35, a1 - 0.35, mi)

mesh = bpy.data.meshes.new("pavimento")
mesh.from_pydata(_verts, [], _faces)
obj = bpy.data.objects.new("pavimento", mesh)
bpy.context.collection.objects.link(obj)
for m in MATS_PAV:
    obj.data.materials.append(m)
for poly, mi in zip(mesh.polygons, _midx):
    poly.material_index = mi
print(f"pavimento: {len(_faces) // 6} tasselli")

# base scura sotto le fughe (croce: disco + 4 rettangoli) — coordinate Blender.
# TOP a 0.01, SOTTO il fondo delle mattonelle (0.03): niente compenetrazione col marmo
# (0.03-0.07) → niente z-fighting/"quadrato nero" ad angolo radente. Si vede solo nelle fughe.
gl.add_cyl("base_rotonda", 10.75, 0.05, 0, 0, -0.04, mats['nero'], vertices=48)
for phi in (0, 90, 180, 270):
    gx, gz = rot(0, -(Z_M + Z_END) / 2, phi)
    box = gl.add_box(f"base_braccio_{phi}", 9.6, Z_END - Z_M + 0.6, 0.05, gx, -gz, -0.04, mats['nero'], bevel=0)
    box.rotation_euler = (0, 0, math.radians(phi))

# ── ANELLO DEL MEZZANINO della rotonda: 4 ponti sugli imbocchi + 4 decks
# d'angolo + parapetti (ottagono interno continuo, raggio "flat" 7.1) ──
D_CORNER = C_MID * 2 / math.sqrt(2) - 7.1   # 9.97-7.1 = 2.87 profondita' angoli


def parapetto_g(tag, x0, z0, x1, z1, h=1.05):
    # parapetto Déco tra due punti in coordinate GIOCO (per l'anello)
    bx0, by0, bx1, by1 = x0, -z0, x1, -z1
    w = math.hypot(bx1 - bx0, by1 - by0)
    ang = math.atan2(by1 - by0, bx1 - bx0)
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    for nome, dz, hh in (("corr", Z_TOP + h - 0.09, 0.09), ("fascia", Z_TOP + 0.06, 0.14)):
        bb = gl.add_box(f"an_{tag}_{nome}", w, 0.13, hh, cx, cy, dz, mats['ottone'], bevel=0.01)
        bb.rotation_euler = (0, 0, ang)
    n = max(2, int(w / 0.60))
    for i in range(n + 1):
        t = i / n
        px, py = bx0 + (bx1 - bx0) * t, by0 + (by1 - by0) * t
        gl.add_strut(f"an_{tag}_bal_{i}", (px, py, Z_TOP + 0.18), (px, py, Z_TOP + h - 0.10), 0.028, mats['ottone'])
        if i < n:
            mx, my = bx0 + (bx1 - bx0) * (t + 0.5 / n), by0 + (by1 - by0) * (t + 0.5 / n)
            dxu, dyu = (bx1 - bx0) / w, (by1 - by0) / w
            gl.add_strut(f"an_{tag}_chL_{i}", (mx - dxu * 0.26, my - dyu * 0.26, Z_TOP + 0.20), (mx, my, Z_TOP + h * 0.55), 0.02, mats['oro'])
            gl.add_strut(f"an_{tag}_chR_{i}", (mx + dxu * 0.26, my + dyu * 0.26, Z_TOP + 0.20), (mx, my, Z_TOP + h * 0.55), 0.02, mats['oro'])
    colb = gl.add_box(f"COL_an_{tag}", w, 0.16, 1.1, cx, cy, Z_TOP, mats['nero'], bevel=0)
    colb.rotation_euler = (0, 0, ang)


for k, phi in enumerate((0, 90, 180, 270)):
    a = math.radians(phi)
    ca, sa = math.cos(a), math.sin(a)

    def g2b(x, z):   # gioco (base nord) -> ruota di phi -> Blender (bx, by)
        gx, gz = x * ca - z * sa, x * sa + z * ca
        return gx, -gz

    # ponte sull'imbocco: slab 9 x 2.5, top leggermente rialzato (anti z-fight)
    bx, by = g2b(0, -(Z_M - DECK / 2))
    # crema SOTTO (top 4.47), marmo che EMERGE a 4.5: niente facce complanari (no z-fight)
    pb = gl.add_box(f"ponte_{k}", 9.0, DECK, 0.30, bx, by, Z_TOP - 0.33, mats['crema'], bevel=0.01)
    pb.rotation_euler = (0, 0, -a)
    pt = gl.add_box(f"ponte_top_{k}", 9.0, DECK, 0.08, bx, by, Z_TOP - 0.08, mats['marmo_chiaro'], bevel=0)
    pt.rotation_euler = (0, 0, -a)
    pc = gl.add_box(f"COL_ponte_{k}", 9.0, DECK, 0.30, bx, by, Z_TOP - 0.30, mats['nero'], bevel=0)
    pc.rotation_euler = (0, 0, -a)
    # fascia dorata sul bordo esterno del ponte (sopra l'imbocco)
    fb = gl.add_box(f"ponte_fascia_{k}", 9.0, 0.14, 0.42, *g2b(0, -(Z_M - 0.05)), Z_TOP - 0.36, mats['oro'], bevel=0.01)
    fb.rotation_euler = (0, 0, -a)
    # deck d'angolo (ruotato di 45): dal muro d'angolo verso l'interno
    ccx = C_MID - (D_CORNER / 2) / math.sqrt(2)
    bx, by = g2b(ccx, -ccx)
    cb = gl.add_box(f"deck_{k}", CORNER_W, D_CORNER, 0.30, bx, by, Z_TOP - 0.33, mats['crema'], bevel=0.01)
    cb.rotation_euler = (0, 0, -a + math.radians(-45))
    ct = gl.add_box(f"deck_top_{k}", CORNER_W, D_CORNER, 0.08, bx, by, Z_TOP - 0.08, mats['marmo_chiaro'], bevel=0)
    ct.rotation_euler = (0, 0, -a + math.radians(-45))
    cc = gl.add_box(f"COL_deck_{k}", CORNER_W, D_CORNER, 0.30, bx, by, Z_TOP - 0.30, mats['nero'], bevel=0)
    cc.rotation_euler = (0, 0, -a + math.radians(-45))
    # parapetti interni: segmento del ponte (z=-7.1) + segmento diagonale
    x0, z0 = rot(-2.94, -7.1, phi)
    x1, z1 = rot(2.94, -7.1, phi)
    parapetto_g(f"p{k}", x0, z0, x1, z1)
    x0, z0 = rot(2.94, -7.1, phi)
    x1, z1 = rot(7.1, -2.94, phi)
    parapetto_g(f"d{k}", x0, z0, x1, z1)
    # parapetto esterno del ponte: solo la luce centrale (4 m) sopra il corridoio
    x0, z0 = rot(-2.0, -(Z_M - 0.10), phi)
    x1, z1 = rot(2.0, -(Z_M - 0.10), phi)
    parapetto_g(f"e{k}", x0, z0, x1, z1)

# ── RETRO-CORRIDOI di flanking (dietro le coppie di negozi RETRO) ──
def retro_corridoio(b, l, i1, i2):
    # costruisce il corridoio dietro il muro (b,l) tra le campate i1<i2.
    # In coordinate base (braccio N, lato est): muro a x=4.5, retro negozio a
    # x=8.9..9.2, porta 1.4 alla z della campata. Poi si ruota di phi=90*b
    # (per il lato ovest si specchia la x).
    phi = 90 * b
    sgn = 1 if l == 0 else -1
    zA, zB = BAYS[i1], BAYS[i2]
    x_in, x_out = 9.2, 10.85          # pareti interna/esterna del corridoio
    z0, z1 = zA - 1.1, zB + 1.1

    def put(nome, w, d, h, cx, cz, z_base, mat):
        gx, gz = rot(sgn * cx, -cz, phi)
        bb = gl.add_box(nome, w if sgn > 0 else w, d, h, gx, -gz, z_base, mat, bevel=0)
        bb.rotation_euler = (0, 0, math.radians(phi))
        return bb

    cx_mid = (x_in + x_out) / 2
    put(f"rc_{b}{l}_pav", x_out - x_in + 0.5, z1 - z0, 0.10, cx_mid, (z0 + z1) / 2, 0.0, mats['marmo_scuro'])
    put(f"COL_rc_{b}{l}_pav", x_out - x_in + 0.5, z1 - z0, 0.10, cx_mid, (z0 + z1) / 2, 0.0, mats['nero'])
    put(f"rc_{b}{l}_soff", x_out - x_in + 0.5, z1 - z0, 0.22, cx_mid, (z0 + z1) / 2, 3.1, mats['interno'])
    put(f"COL_rc_{b}{l}_soff", x_out - x_in + 0.5, z1 - z0, 0.22, cx_mid, (z0 + z1) / 2, 3.1, mats['nero'])
    put(f"rc_{b}{l}_ext", 0.25, z1 - z0, 3.1, x_out, (z0 + z1) / 2, 0.0, mats['interno'])
    put(f"COL_rc_{b}{l}_ext", 0.25, z1 - z0, 3.1, x_out, (z0 + z1) / 2, 0.0, mats['nero'])
    for zc, tag in ((z0, "capN"), (z1, "capS")):
        put(f"rc_{b}{l}_{tag}", x_out - x_in + 0.5, 0.25, 3.1, cx_mid, zc, 0.0, mats['interno'])
        put(f"COL_rc_{b}{l}_{tag}", x_out - x_in + 0.5, 0.25, 3.1, cx_mid, zc, 0.0, mats['nero'])
    # parete interna a segmenti: aperta solo davanti alle due porte (1.5)
    segmenti = [(z0, zA - 0.75), (zA + 0.75, zB - 0.75), (zB + 0.75, z1)]
    for si, (s0, s1) in enumerate(segmenti):
        if s1 - s0 < 0.05:
            continue
        put(f"rc_{b}{l}_int{si}", 0.25, s1 - s0, 3.1, x_in, (s0 + s1) / 2, 0.0, mats['interno'])
        put(f"COL_rc_{b}{l}_int{si}", 0.25, s1 - s0, 3.1, x_in, (s0 + s1) / 2, 0.0, mats['nero'])
    # applique nel corridoio
    for zc in (zA, (zA + zB) / 2, zB):
        gx, gz = rot(sgn * (x_out - 0.2), -zc, phi)
        gl.add_sphere(f"rc_{b}{l}_luce_{int(zc)}", 0.10, gx, -gz, 2.5, mats['neon_caldo'])


_muri_fatti = set()
for (b, l, i) in sorted(RETRO):
    if (b, l) in _muri_fatti:
        continue
    _muri_fatti.add((b, l))
    idcs = sorted(i2 for (b2, l2, i2) in RETRO if (b2, l2) == (b, l))
    retro_corridoio(b, l, idcs[0], idcs[1])

# ── PROPS: panche Déco attorno alla rotonda + urne agli imbocchi ──
for k in range(4):
    aa = math.radians(45 + 90 * k)
    gx, gz = 5.6 * math.sin(aa), -5.6 * math.cos(aa)
    ang = -aa
    pb = gl.add_box(f"panca_{k}", 2.3, 0.55, 0.14, gx, -gz, 0.42, mats['verde_scuro'], bevel=0.015)
    pb.rotation_euler = (0, 0, ang)
    for sdx in (-0.95, 0.95):
        fx = gx + sdx * math.cos(aa)
        fz = gz + sdx * math.sin(aa)
        fb = gl.add_box(f"panca_{k}_fianco_{sdx}", 0.32, 0.5, 0.42, fx, -fz, 0.0, mats['nero'], bevel=0.01)
        fb.rotation_euler = (0, 0, ang)
    sb = gl.add_box(f"panca_{k}_schienale", 2.3, 0.10, 0.5, gx - 0.26 * math.sin(aa), -(gz - 0.26 * -math.cos(aa)) * 1.0, 0.56, mats['verde_scuro'], bevel=0.015)
    # correzione: lo schienale arretra lungo la NORMALE (verso la fontana no: verso l'esterno)
    nx, nz = math.sin(aa), -math.cos(aa)
    sb.location = (gx + 0.26 * nx, -(gz + 0.26 * nz), 0.56 + 0.25)
    sb.rotation_euler = (0, 0, ang)
    cb = gl.add_box(f"COL_panca_{k}", 2.3, 0.75, 1.0, gx + 0.1 * nx, -(gz + 0.1 * nz), 0.0, mats['nero'], bevel=0)
    cb.rotation_euler = (0, 0, ang)
for phi in (0, 90, 180, 270):
    for sx in (-3.85, 3.85):
        gx, gz = rot(sx, -(Z_M - 1.0), phi)
        gl.lathe_profile(f"urna_{phi}_{sx}", [
            (0.28, 0.0), (0.34, 0.08), (0.18, 0.22), (0.20, 0.55), (0.42, 0.95),
            (0.46, 1.08), (0.40, 1.12), (0.0, 1.12),
        ], mats['verde_scuro'], segments=12).location = (gx, -gz, 0)
        cu = gl.add_box(f"COL_urna_{phi}_{sx}", 0.95, 0.95, 1.15, gx, -gz, 0.0, mats['nero'], bevel=0)

# ── TAPPO FESSURE rotonda↔bracci: le pareti a pannelli PIATTI lasciano spiragli VERTICALI
# ai giunti d'angolo (dove la parete d'angolo a 45° incontra i bracci) → si vede il cielo.
# Backing CREMA ad arco al RAGGIO INTERNO DEL TAMBURO (r 10.2 = R_DRUM-0.4) dai piedi fino alla
# BASE del tamburo (z 9.0): e' una CONTINUAZIONE del tamburo verso il basso ai 4 angoli
# (integrato, non muri fluttuanti), lontano dai bracci (aperti a ±24.6°). Solo scenografia (no
# COL); mappa chiusa → da fuori invisibile. Non tocca i modelli validati (kit_muri/kit_rotonda).
def corner_gapfill(phi_c):
    r, z0, z1 = 10.2, 0.0, 9.0    # r = raggio interno tamburo; top alla base del tamburo → integrato
    span, n = 44.0, 26           # ±22° (fin dietro il pilastro d'imbocco), fitto = smooth
    seg_w = 2 * r * math.sin(math.radians(span / n) / 2) + 0.15
    for i in range(n):
        a = math.radians(phi_c - span / 2 + span * (i + 0.5) / n)
        gx, gz = r * math.sin(a), -r * math.cos(a)
        b = gl.add_box(f"gapfill_{int(phi_c)}_{i}", seg_w, 0.3, z1 - z0, gx, -gz, z0, mats['crema'], bevel=0)
        b.rotation_euler = (0, 0, -a)      # segmento tangente al cerchio
for phi_c in (45, 135, 225, 315):
    corner_gapfill(phi_c)

# ── TAPPO LUNETTE sopra i PORTALI: il fondo semicircolare della volta all'estremita' del
# braccio (sopra il portale) resta aperto → cielo. Tappo CREMA dietro il portale (r>Z_END,
# fuori mappa, invisibile da fuori). Copre la lunetta sopra la traversa del portale.
for phi in (0, 90, 180, 270):
    gx, gz = rot(0, -(Z_END + 0.7), phi)
    lc = gl.add_box(f"lunette_{phi}", 11.0, 0.4, 3.4, gx, -gz, 8.2, mats['crema'], bevel=0)
    lc.rotation_euler = (0, 0, math.radians(-phi))

gl.export_glb("pavimentazione.glb")

# ── galleria-layout.json ──
layout = {"edifici": [{"modello": m, "x": x, "z": z, "rotY": r, "y": y, "s": s}
                      for m, x, z, r, y, s in EDIFICI],
          "props": [],
          "vie": VIE,
          "climb": CLIMB,
          "ceilingY": CEILING_Y}
with open(gl.MODELS_DIR + "/galleria-layout.json", "w", encoding="utf-8") as f:
    json.dump(layout, f, indent=2, ensure_ascii=False)
print("Scritto galleria-layout.json —", len(EDIFICI), "istanze")

# ── COMPOSIZIONE: importa e piazza i GLB (orbita multi-root, come jazz v5.4) ──
def piazza_glb(modello, x, z, rot_deg, alt=0.0, s=1.0):
    prima = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=gl.MODELS_DIR + "/" + modello + ".glb")
    rr = math.radians(rot_deg)
    ca, sa = math.cos(rr), math.sin(rr)
    for ob in set(bpy.data.objects) - prima:
        if ob.parent is None:
            ob.rotation_mode = 'XYZ'
            ob.rotation_euler = (ob.rotation_euler.x, ob.rotation_euler.y,
                                 ob.rotation_euler.z + rr)
            ob.scale = (ob.scale.x * s, ob.scale.y * s, ob.scale.z * s)
            lx, ly = ob.location.x * s, ob.location.y * s
            ob.location = (lx * ca - ly * sa + x, lx * sa + ly * ca - z,
                           ob.location.z * s + alt)


for m, x, z, r, y, s in EDIFICI:
    piazza_glb(m, x, z, r, alt=y, s=s)

# nasconde le COL nei render (in gioco le nasconde il loader)
for ob in bpy.data.objects:
    if ob.name.startswith("COL_"):
        ob.hide_render = True

# ── FRECCE DEBUG sui pezzi orientati (vetrine, portali, scale) ──
mat_dbg = gl.flat_material("DBG_freccia", (1.0, 0.0, 0.9, 1.0))
for i, (m, x, z, r, y, s) in enumerate(EDIFICI):
    if not (m.startswith("vetrina") or m == "portale" or m == "scala_pioli"):
        continue
    sx, cz = math.sin(math.radians(r)), math.cos(math.radians(r))
    d = 2.2
    a1 = gl.add_box(f"DBG_shaft_{i}", 0.5, 2.2, 0.3, x + d * sx, -(z + d * cz), 16.0, mat_dbg, bevel=0)
    a1.rotation_euler = (0, 0, math.radians(r))
    d2 = d + 1.8
    a2 = gl.add_box(f"DBG_head_{i}", 1.3, 0.6, 0.3, x + d2 * sx, -(z + d2 * cz), 16.0, mat_dbg, bevel=0)
    a2.rotation_euler = (0, 0, math.radians(r))

# ── RENDER: top debug -> senza frecce -> esterno 3/4 + interni ──
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'MATERIAL'
scene.render.resolution_x = 1400
scene.render.resolution_y = 1200
cam_top = bpy.data.objects.new("cam_top", bpy.data.cameras.new("cam_top"))
cam_top.data.type = 'ORTHO'
cam_top.data.ortho_scale = 78
cam_top.data.clip_end = 500
cam_top.location = (0, 0, 80)
bpy.context.collection.objects.link(cam_top)
scene.camera = cam_top
scene.render.filepath = gl.PREVIEW_DIR + "/galleria_top_debug.png"
bpy.ops.render.render(write_still=True)

for ob in [o for o in bpy.data.objects if o.name.startswith("DBG_")]:
    bpy.data.objects.remove(ob, do_unlink=True)
scene.render.filepath = gl.PREVIEW_DIR + "/galleria_top.png"
bpy.ops.render.render(write_still=True)


def cam_persp(nome, pos, tgt, lens=24):
    t = bpy.data.objects.new(f"tgt_{nome}", None)
    t.location = tgt
    bpy.context.collection.objects.link(t)
    cam = bpy.data.objects.new(f"cam_{nome}", bpy.data.cameras.new(f"cam_{nome}"))
    cam.location = pos
    cam.data.clip_end = 500
    cam.data.lens = lens
    bpy.context.collection.objects.link(cam)
    tc = cam.constraints.new(type='TRACK_TO')
    tc.target = t
    tc.track_axis = 'TRACK_NEGATIVE_Z'
    tc.up_axis = 'UP_Y'
    scene.camera = cam
    scene.render.filepath = gl.PREVIEW_DIR + f"/galleria_{nome}.png"
    bpy.ops.render.render(write_still=True)


# NB: coordinate Blender (bx, by=-z_gioco, bz)
cam_persp("esterno", (52, -58, 42), (0, 0, 6))
cam_persp("int_rotonda", (0, 24, 1.7), (0, 0, 6.5))          # dal braccio N verso la rotonda
cam_persp("int_braccio", (0, -12, 1.7), (0, 30, 5))          # dalla rotonda verso il portale N
cam_persp("int_mezzanino", (6.2, 6.2, 5.8), (-4, -4, 4.5))   # sull'anello, guarda la rotonda
cam_persp("int_scala", (0.2, 25.2, 2.4), (1.9, 28.85, 3.2))  # scala del braccio N
cam_persp("int_negozio", (0, 14.5, 1.6), (4.5, 17.85, 1.4))  # verso le vetrine del braccio N
print("Render galleria completati")
