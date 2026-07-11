# collegamenti-layout.py — i 3 corridoi che cuciono Jazz e Galleria in un mondo unico.
# Costruisce TUTTA la rete in coordinate di GIOCO (x est, z sud, y su) ed esporta un
# unico GLB `collegamenti.glb` (con mesh COL_* per i muri) + `collegamenti-layout.json`
# che lo piazza una volta a (0,0). Un top render di debug con le sagome di Jazz (disco
# r45.5) e Galleria (offset 97,0) verifica gli innesti su varchi Jazz e portali Galleria.
#
# Convenzione: gli helper di galleria_lib lavorano in coordinate Blender (bx, by, bz)
# con base a bz. Il gioco usa bx=x_gioco, by=-z_gioco, bz=y_gioco → qui si passa per
# box_game(...) che fa la conversione una volta sola.

import sys, os, json, math
# Path della work directory UNICA (i worktree sono stati consolidati e rimossi)
REPO = "C:/Users/pacia/Desktop/Claude Workspace/prova"
GALLERIA_SCRIPTS = REPO + "/docs/superpowers/plans/blender-scripts/galleria"
sys.path.insert(0, GALLERIA_SCRIPTS)
import bpy
import galleria_lib as gl

MODELS_DIR = REPO + "/frontend/assets/models/collegamenti-wip"
PREVIEW_DIR = REPO + "/docs/superpowers/plans/blender-scripts/collegamenti/preview"
# Reindirizza l'output degli helper di galleria_lib
gl.MODELS_DIR = MODELS_DIR
gl.PREVIEW_DIR = PREVIEW_DIR

GALLERIA_OFF_X = 97.0   # deve combaciare con GALLERIA_OFF in fps.js

gl.clear_scene()
M = {
    'mattone':  gl.flat_material('mattone',  (0.52, 0.22, 0.16, 1)),   # lato Jazz
    'crema':    gl.flat_material('crema',    (0.90, 0.86, 0.74, 1)),   # lato Deco
    'sabbia':   gl.flat_material('sabbia',   (0.66, 0.58, 0.44, 1)),   # muri flank (crema scuro: le pareti prendono forma)
    'ottone':   gl.flat_material('ottone',   (0.74, 0.53, 0.22, 1)),
    'nero':     gl.flat_material('nero',     (0.12, 0.12, 0.13, 1)),
    'pav':      gl.flat_material('pav_corr', (0.60, 0.56, 0.50, 1)),
    'vetro':    gl.flat_material('vetro',    (0.74, 0.82, 0.86, 1)),
}


def box_game(name, w, d, h, gx, gz, gy_base, mat, bevel=0.0):
    # w = estensione lungo x_gioco, d = lungo z_gioco, h = altezza (y_gioco).
    gl.add_box(name, w, d, h, gx, -gz, gy_base, mat, bevel)


def run(prefix, x0, z0, x1, z1, width, wall_h, mat_wall, roofed=True,
        mat_roof=None, floor_mat=None, ext=True):
    # Tratto di corridoio ASSE-ALLINEATO da (x0,z0) a (x1,z1): pavimento + 2 muri COL
    # (+ eventuale copertura). `ext` allunga il tratto di `width` per riempire gli angoli.
    floor_mat = floor_mat or M['pav']
    mat_roof = mat_roof or mat_wall
    cx, cz = (x0 + x1) / 2.0, (z0 + z1) / 2.0
    horiz = abs(x1 - x0) >= abs(z1 - z0)
    lng = (abs(x1 - x0) if horiz else abs(z1 - z0)) + (width if ext else 0.0)
    # Ogni muro = mesh VISIBILE (renderizzata) + gemella COL_ (solo collisione, invisibile).
    # Le COL_* non vengono renderizzate da loadZone: senza la gemella visibile il
    # corridoio sembrava "all'aperto" con muri invisibili.
    if horiz:
        box_game(f"{prefix}_pav", lng, width, 0.12, cx, cz, -0.12, floor_mat)
        for s in (-1, 1):
            zc = cz + s * width / 2
            box_game(f"{prefix}_muro_{s}",     lng, 0.4, wall_h, cx, zc, 0.0, mat_wall)   # visibile
            box_game(f"COL_{prefix}_muro_{s}", lng, 0.4, wall_h, cx, zc, 0.0, mat_wall)   # collisione
        if roofed:
            box_game(f"{prefix}_roof", lng, width + 0.4, 0.2, cx, cz, wall_h, mat_roof)
    else:
        box_game(f"{prefix}_pav", width, lng, 0.12, cx, cz, -0.12, floor_mat)
        for s in (-1, 1):
            xc = cx + s * width / 2
            box_game(f"{prefix}_muro_{s}",     0.4, lng, wall_h, xc, cz, 0.0, mat_wall)   # visibile
            box_game(f"COL_{prefix}_muro_{s}", 0.4, lng, wall_h, xc, cz, 0.0, mat_wall)   # collisione
        if roofed:
            box_game(f"{prefix}_roof", width + 0.4, lng, 0.2, cx, cz, wall_h, mat_roof)


def wall_seg(name, x0, z0, x1, z1, h, mat):
    # muro asse-allineato: mesh visibile + gemella COL (collisione)
    if abs(x1 - x0) >= abs(z1 - z0):
        w_, d_ = abs(x1 - x0), 0.4
    else:
        w_, d_ = 0.4, abs(z1 - z0)
    if w_ < 1e-3 or d_ < 1e-3:
        return
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    box_game(name, w_, d_, h, cx, cz, 0.0, mat)
    box_game("COL_" + name, w_, d_, h, cx, cz, 0.0, mat)


def endcap(name, axis, fixed, c, half_span, door_half, h, mat, door_h):
    # TESTATA: muro che copre l'intera apertura (half_span per lato) TRANNE una
    # porta larga 2*door_half → sigilla i lati (niente buchi/uscite dalla mappa).
    # axis 'x' = muro nel piano x=fixed esteso lungo z; 'z' = piano z=fixed esteso lungo x.
    lo, hi, dlo, dhi = c - half_span, c + half_span, c - door_half, c + door_half
    ah = max(0.2, h - door_h)   # altezza architrave (sopra la porta) → anche COL (no scavalco)
    if axis == 'x':
        wall_seg(f"{name}_a", fixed, lo, fixed, dlo, h, mat)
        wall_seg(f"{name}_b", fixed, dhi, fixed, hi, h, mat)
        box_game(f"{name}_arch", 0.4, 2 * door_half, ah, fixed, c, door_h, mat)
        box_game(f"COL_{name}_arch", 0.4, 2 * door_half, ah, fixed, c, door_h, mat)
    else:
        wall_seg(f"{name}_a", lo, fixed, dlo, fixed, h, mat)
        wall_seg(f"{name}_b", dhi, fixed, hi, fixed, h, mat)
        box_game(f"{name}_arch", 2 * door_half, 0.4, ah, c, fixed, door_h, mat)
        box_game(f"COL_{name}_arch", 2 * door_half, 0.4, ah, c, fixed, door_h, mat)


# ── CORRIDOIO PRINCIPALE — l'ingresso e' il VARCO del palazzo centrale rimosso
# (i due palazzi vicini restano a chiudere i lati). Muri in CREMA (niente "muri
# rossi"), centrato sullo slot del palazzo rimosso (z=-1.2). ──
X_JZ, X_GL = 45.5, 65.4          # bordo disco Jazz → portale OVEST Galleria (97-31.6)
Z_MAIN = -1.2                    # centro dello slot del palazzo centrale rimosso (idx38)
X_MID = (X_JZ + X_GL) / 2
W_MAIN, H_MAIN = 7.0, 5.6
# ── PIAZZA DELLA FONTANA al posto del corr_main (spec 2026-07-09) ──
# L'ovale A=10, B=16 centro (55.5,0) riempie x∈[45.5,65.4]: niente più corridoio.
# main_jz_cap resta come porta OVEST della piazza; il portale Galleria (x=65.4,
# w9) è la porta EST. Il perimetro lo sigilla la zona piazza (muretti/quinte).
# TAPPI crema ai lati dell'imbocco: riempiono il cuneo curvo fino ai palazzi vicini
# (idx37/idx39) così non restano buchi laterali (spessi in x per la curvatura).
# Spinti a X_JZ+0.2 = DAVANTI (lato galleria) alle facce rosse, non dentro (anti z-fight).
for zt in (Z_MAIN - W_MAIN / 2 - 1.6, Z_MAIN + W_MAIN / 2 + 1.6):
    box_game(f"main_tappo_{int(zt * 10)}", 3.4, 3.6, H_MAIN, X_JZ + 0.2, zt, 0.0, M['crema'])
    box_game(f"COL_main_tappo_{int(zt * 10)}", 3.4, 3.6, H_MAIN, X_JZ + 0.2, zt, 0.0, M['crema'])
# TESTATA d'ingresso crema al filo Jazz (x=X_JZ): parete piena da idx37 (z≈-7.9) a idx39
# (z≈6.3) con VARCO = W_MAIN al centro e architrave pieno sopra. Copre i fronti rossi
# esposti dei due palazzi adiacenti e dà un ingresso pulito alla galleria.
endcap("main_jz_cap", 'x', X_JZ, Z_MAIN, 7.6, W_MAIN / 2, H_MAIN, M['crema'], 3.4)
# VOLTA a botte vetrata (scenografia, sopra ceilingY: nessuna COL) — a DUE tratti come i
# muri: 7 m centrata z=-1.2 sul lato Jazz, 9 m centrata z=0 sul lato galleria (copre la
# parte allargata → niente tetto scoperto a sud). by = -(zc + z_local).
def barrel(tag, x0, x1, w, zc, ribs):
    seg = 9
    rz = 2.6
    half = w / 2 + 0.2
    for i in range(seg):
        a0, a1 = math.pi * i / seg, math.pi * (i + 1) / seg
        z_a, y_a = -half * math.cos(a0), H_MAIN + rz * math.sin(a0)
        z_b, y_b = -half * math.cos(a1), H_MAIN + rz * math.sin(a1)
        segl = math.hypot(z_b - z_a, y_b - y_a) + 0.05
        gl.add_box_c(f"volta_{tag}_{i}", x1 - x0, 0.28, segl,
                     (x0 + x1) / 2, -(zc + (z_a + z_b) / 2), (y_a + y_b) / 2,
                     M['vetro'], rot=(math.radians(90), 0, 0), bevel=0)
    for k in range(ribs):
        xr = x0 + (x1 - x0) * (k + 0.5) / ribs
        for i in range(seg):
            a0, a1 = math.pi * i / seg, math.pi * (i + 1) / seg
            z_a, y_a = -(half + 0.05) * math.cos(a0), H_MAIN + rz * math.sin(a0)
            z_b, y_b = -(half + 0.05) * math.cos(a1), H_MAIN + rz * math.sin(a1)
            segl = math.hypot(z_b - z_a, y_b - y_a) + 0.05
            gl.add_box_c(f"rib_{tag}_{k}_{i}", 0.18, 0.16, segl,
                         xr, -(zc + (z_a + z_b) / 2), (y_a + y_b) / 2,
                         M['ottone'], rot=(math.radians(90), 0, 0), bevel=0)

# (volta a botte rimossa insieme al corr_main: la piazza è a cielo aperto)

def jazz_gateway(p, x_ent, z_ent, half, h, mat_face, mat_col):
    # Sigilla il giunto tra il PERIMETRO Jazz (radiale) e l'IMBOCCO del flank (asse-allineato),
    # SENZA MAI invadere il varco 2*half (che resta il passaggio libero — questo era il bug del
    # blocco). Ai due lati del varco: un MURO VISIBILE ruotato alla tangente del disco (flush coi
    # palazzi vicini, li sovrappone) + una COL AABB col BORDO INTERNO esattamente al filo del varco
    # (x_ent ± half), estesa SOLO verso il vicino → sigilla senza entrare nel varco. Sopra: architrave.
    # COL axis-aligned perche' il path per-modello di loadZone non gestisce COL ruotate intra-GLB;
    # qui basta: la tenuta la fa la COL laterale, l'estetica il muro visibile ruotato.
    phi = math.degrees(math.atan2(x_ent, -z_ent))
    tx, tz = math.cos(math.radians(phi)), math.sin(math.radians(phi))   # tangente
    if tx < 0:
        tx, tz = -tx, -tz            # tangente con x>0: +side va verso +x, -side verso -x
    rot_b = math.atan2(-tz, tx)      # rotazione blender che allinea il lato-x del box alla tangente
    wall_len, wall_d = 11.0, 0.6
    door_h = 3.0
    for sgn in (-1, 1):
        ex, ez = x_ent + sgn * half, z_ent            # BORDO del varco su questo lato
        # MURO VISIBILE ruotato: ancorato al bordo del varco, esteso lungo sgn*tangente
        # (verso il vicino, che sovrappone). Non entra mai nel varco (parte dal bordo).
        cx = ex + sgn * tx * wall_len / 2
        cz = ez + sgn * tz * wall_len / 2
        b = gl.add_box(f"{p}_gw_wing_{sgn}", wall_len, wall_d, h, cx, -cz, 0.0, mat_face)
        b.rotation_euler = (0, 0, rot_b)
        # COL AABB: bordo INTERNO al filo del varco (x=ex), estesa verso l'esterno-x e verso il
        # vicino in z. Non attraversa mai x nel varco → il passaggio 2*half resta libero.
        col_w, col_d = 5.0, 10.0
        colx = ex + sgn * (col_w / 2)                 # centro tale che il bordo interno sia a x=ex
        colz = ez + sgn * tz * (col_d / 2 - 1.0)      # spostata verso il vicino lungo la tangente
        box_game(f"COL_{p}_gw_wing_{sgn}", col_w, col_d, h, colx, colz, 0.0, mat_col)
    # ARCHITRAVE sopra il varco (visibile + COL), largo come il varco, sopra door_h → niente scavalco
    box_game(f"{p}_gw_lintel", 2 * half, wall_d + 0.8, h - door_h, x_ent, z_ent, door_h, mat_face)
    box_game(f"COL_{p}_gw_lintel", 2 * half, 1.2, h - door_h, x_ent, z_ent, door_h, mat_col)


# ── FLANK (a U): entrata dall'edificio Jazz → giù al fondo → su al portale Galleria.
# Muri come boundary CONTINUO (esterno+interno) → i gomiti non sigillano; alle due
# estremita' una TESTATA con PORTICINA (larga come il flank) chiude tutto il resto. ──
def flank_u(p, x_ent, z_ent, z_dip, x_gal, z_gal, w, h, mat, roof_mat):
    half = w / 2.0
    s = 1 if z_dip > 0 else -1        # verso lontano dal centro
    outer_z = z_dip + s * half        # boundary esterno (fondo del U)
    inner_z = z_dip - s * half        # boundary interno (incavo del U)
    xL, xR = min(x_ent, x_gal), max(x_ent, x_gal)
    # BOUNDARY ESTERNO (avvolge il fondo del U)
    wall_seg(f"{p}_o_ent", x_ent - half, z_ent, x_ent - half, outer_z, h, mat)
    wall_seg(f"{p}_o_gal", x_gal + half, z_gal, x_gal + half, outer_z, h, mat)
    wall_seg(f"{p}_o_bot", x_ent - half, outer_z, x_gal + half, outer_z, h, mat)
    # BOUNDARY INTERNO (avvolge l'incavo; si ferma ai gomiti → passaggio libero)
    wall_seg(f"{p}_i_ent", x_ent + half, z_ent, x_ent + half, inner_z, h, mat)
    wall_seg(f"{p}_i_gal", x_gal - half, z_gal, x_gal - half, inner_z, h, mat)
    wall_seg(f"{p}_i_bot", x_ent + half, inner_z, x_gal - half, inner_z, h, mat)
    # PAVIMENTO (3 rettangoli con overlap ai gomiti)
    box_game(f"{p}_pav_ent", w, abs(z_ent - outer_z) + w, 0.12, x_ent, (z_ent + outer_z) / 2, -0.12, M['pav'])
    box_game(f"{p}_pav_gal", w, abs(z_gal - outer_z) + w, 0.12, x_gal, (z_gal + outer_z) / 2, -0.12, M['pav'])
    box_game(f"{p}_pav_bot", (xR - xL) + w, w, 0.12, (xL + xR) / 2, z_dip, -0.12, M['pav'])
    # TETTO (semi-coperto)
    box_game(f"{p}_roof_ent", w + 0.4, abs(z_ent - outer_z) + w, 0.2, x_ent, (z_ent + outer_z) / 2, h, roof_mat)
    box_game(f"{p}_roof_gal", w + 0.4, abs(z_gal - outer_z) + w, 0.2, x_gal, (z_gal + outer_z) / 2, h, roof_mat)
    box_game(f"{p}_roof_bot", (xR - xL) + w, w + 0.4, 0.2, (xL + xR) / 2, z_dip, h, roof_mat)
    # ENTRATA JAZZ: facciata-tappo ANGOLATA (crema) allineata ai palazzi radiali, con varco
    # centrale. Sostituisce testata+tappi asse-allineati che sbucavano nella strada (bug 1).
    jazz_gateway(p, x_ent, z_ent, half, h, M['crema'], mat)
    # gal_cap RIMOSSA: la sigillatura lato galleria (varco 3.5 m) la fa la PORTA VERDE
    # `portale_varco` della galleria (N/S). Evita doppioni/z-fight al giunto.


WF, HF = 3.5, 4.0
# Muri flank in CREMA Déco (coerenti con corridoio principale + porta verde galleria).
# NORD: edificio Jazz NE (32.5,-31.8) → fondo a z=-38 → portale N Galleria (97,-31.6)
# fN DEMOLITO (spec 2026-07-10): il flanking nord lo fa l'anello esterno di
# Funland; il tratto verso il portale N Galleria è il corridoio srv_* qui sotto.
# SUD (speculare): edificio Jazz SE (34.9,29.18) → fondo a z=38 → portale S Galleria (97,31.6)
flank_u("fS", 34.9, 29.18, 38.0, 97.0, 31.6, WF, HF, M['sabbia'], M['nero'])

# ── PASSAGGIO DI SERVIZIO EST (Funland → portale N Galleria) ──
# L: braccio E-O a z=-36 dal cancello est del parco (x=88) a x≈97, poi gamba a
# sud fino al portale N (97,-31.6): stessa geometria d'arrivo del vecchio fN,
# la sigillatura lato galleria resta la porta verde `portale_varco`.
W_SRV, H_SRV = 3.5, 4.0
hs = W_SRV / 2
wall_seg("srv_o_eo", 88.0, -36.0 - hs, 97.0 + hs, -36.0 - hs, H_SRV, M['sabbia'])   # esterno nord
wall_seg("srv_o_ns", 97.0 + hs, -36.0 - hs, 97.0 + hs, -31.6, H_SRV, M['sabbia'])   # esterno est
wall_seg("srv_i_eo", 88.0, -36.0 + hs, 97.0 - hs, -36.0 + hs, H_SRV, M['sabbia'])   # interno sud (si ferma al gomito)
wall_seg("srv_i_ns", 97.0 - hs, -36.0 + hs, 97.0 - hs, -31.6, H_SRV, M['sabbia'])   # interno ovest
box_game("srv_pav_eo", 9.0 + hs, W_SRV, 0.12, (88.0 + 97.0 + hs) / 2, -36.0, -0.12, M['pav'])
box_game("srv_pav_ns", W_SRV, 4.4 + hs, 0.12, 97.0, (-36.0 - hs - 31.6) / 2, -0.12, M['pav'])
box_game("srv_roof_eo", 9.0 + hs, W_SRV + 0.4, 0.2, (88.0 + 97.0 + hs) / 2, -36.0, H_SRV, M['nero'])
box_game("srv_roof_ns", W_SRV + 0.4, 4.4 + hs, 0.2, 97.0, (-36.0 - hs - 31.6) / 2, H_SRV, M['nero'])

# ── EXPORT GLB (solo corridoi) ──
gl.export_glb("collegamenti.glb")

# ── LAYOUT JSON: una sola istanza a (0,0) ──
layout = {
    "edifici": [{"modello": "collegamenti", "x": 0.0, "z": 0.0, "rotY": 0.0, "y": 0.0, "s": 1.0}],
    "props": [],
    "vie": [
        {"nome": "piazza_ovale", "asse": "x", "da": X_JZ, "a": X_GL, "centro": 0, "larghezza": 20},
        {"nome": "servizio_est", "asse": "x", "da": 88, "a": 97, "centro": -36, "larghezza": WF},
        {"nome": "flank_sud", "asse": "x", "da": 34.9, "a": 97, "centro": 38, "larghezza": WF},
    ],
}
os.makedirs(MODELS_DIR, exist_ok=True)
with open(MODELS_DIR + "/collegamenti-layout.json", "w", encoding="utf-8") as f:
    json.dump(layout, f, indent=2, ensure_ascii=False)
print("collegamenti-layout.json scritto")

# ── SAGOME DI RIFERIMENTO (solo per il render, non esportate) ──
disc = gl.add_cyl("REF_jazz_disc", 45.5, 0.05, 0, 0, -0.2, M['pav'], vertices=64)
# Galleria: bracci a croce (rettangoli) + rotonda, a offset (97,0)
def ref_box(w, d, gx, gz):
    box_game(f"REF_gl_{gx}_{gz}", w, d, 0.05, gx, gz, -0.15, M['crema'])
ref_box(63.2, 9, GALLERIA_OFF_X, 0)      # braccio E-O
ref_box(9, 63.2, GALLERIA_OFF_X, 0)      # braccio N-S
gl.add_cyl("REF_gl_rotonda", 11, 0.05, GALLERIA_OFF_X, 0, -0.1, M['ottone'], vertices=48)

# ── TOP RENDER DEBUG ──
os.makedirs(PREVIEW_DIR, exist_ok=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x = 1600
scene.render.resolution_y = 1000
try:
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.light = 'FLAT'
except Exception:
    pass
cam_data = bpy.data.cameras.new("topcam")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 190
cam = bpy.data.objects.new("topcam", cam_data)
bpy.context.collection.objects.link(cam)
# centro mondo tra Jazz(0) e Galleria(97): guardo dall'alto (-y blender = giu in gioco? )
cam.location = (48, 0, 150)        # blender: bx=48 (game x medio), by=0, bz alto
cam.rotation_euler = (0, 0, 0)     # guarda -Z blender = dall'alto verso il basso
scene.camera = cam
scene.render.filepath = PREVIEW_DIR + "/collegamenti_top_debug.png"
bpy.ops.render.render(write_still=True)
print("Top debug render:", scene.render.filepath)
print("collegamenti completato")
