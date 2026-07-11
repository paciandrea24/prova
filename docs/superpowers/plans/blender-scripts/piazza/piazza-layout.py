# piazza-layout.py — genera piazza-layout.json (istanze zona piazza) + top render
# di verifica con le sagome REF di Jazz (disco r45.5) e Galleria (croce a 97,0).
# Perimetro: quinte jazz + muretti sull'ellisse A=10,B=16 centro (55.5,0), con le
# 3 aperture (OVEST w7 endcap Jazz, EST w9 portale Galleria, NORD w5 cantiere).
# Convenzioni: facciate/fronte dei modelli a −z LOCALE → rotY = tangente+180 le
# rivolge verso l'interno; istanza spinta FUORI di metà profondità così la LINEA
# FACCIATE cade sull'ellisse.
import sys, os, json, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/piazza")
import bpy
import piazza_lib as pl

# Aperture come INTERVALLI di t (l'ovest è ASIMMETRICO: porta w7 centrata z=−1.2).
# Vicino a t0 vale z ≈ −B·cos(t): si risolve numericamente il t di un dato z.
MARGINE = 0.06


def t_per_z_ovest(z):
    # t nel ramo ovest (x<0) con quota z data: t = 3π/2 + asin(−z/B) (z=−16·sin δ)
    return 1.5 * math.pi + math.asin(-z / pl.B)


APERTURE = [  # (t_lo, t_hi)
    (t_per_z_ovest(2.3) - MARGINE, t_per_z_ovest(-4.7) + MARGINE),          # OVEST w7 @ z=−1.2
    (0.5 * math.pi - math.asin(4.5 / pl.B) - MARGINE,
     0.5 * math.pi + math.asin(4.5 / pl.B) + MARGINE),                      # EST w9 @ z=0
    (2.0 * math.pi - math.asin(2.5 / pl.A) - MARGINE,
     math.asin(2.5 / pl.A) + MARGINE),                                      # NORD w5 (a cavallo di t=0)
]


def in_apertura(t):
    tt = t % (2 * math.pi)
    for (lo, hi) in APERTURE:
        lo_n, hi_n = lo % (2 * math.pi), hi % (2 * math.pi)
        if lo_n <= hi_n:
            if lo_n <= tt <= hi_n:
                return True
        elif tt >= lo_n or tt <= hi_n:   # intervallo a cavallo di 0 (nord)
            return True
    return False


def normale(t):
    # Normale ESTERNA unitaria all'ellisse in t (coordinate locali piazza)
    nx, nz = math.sin(t) / pl.A, -math.cos(t) / pl.B
    n = math.hypot(nx, nz)
    return (nx / n, nz / n)


def istanza_perimetro(nome, t, prof):
    # Istanza sul bordo: fronte (−z locale) sull'ellisse, corpo spinto FUORI
    # di prof/2, facciata girata verso l'interno (rotY = tangente + 180).
    lx, lz = pl.ellisse(t)
    nx, nz = normale(t)
    return {"modello": nome,
            "x": round(pl.CX + lx + nx * prof / 2, 2),
            "z": round(pl.CZ + lz + nz * prof / 2, 2),
            "rotY": round((pl.tangente_rotY(t) + 180.0) % 360.0, 1),
            "y": 0.0, "s": 1.0}


# piazza_base a y=−0.02: le LASTRE di fondazione della pavimentazione Jazz
# (es. lotto_26, del palazzo del varco) stanno a y mondo 0.0 come i conci →
# piani coincidenti = z-fighting. 2 cm più in basso: la lastra fa da sagrato.
edifici = [{"modello": "piazza_base", "x": pl.CX, "z": pl.CZ, "rotY": 0.0, "y": -0.02, "s": 1.0}]

# Quinte jazz SOLO sul lato EST (t=45° NE, 135° SE): il lato OVEST dell'ovale
# corre lungo il retro dell'anello palazzi Jazz (r 45.5→~51.5), che fa già da
# fondale — quinte lì compenetrerebbero i palazzi esistenti.
QUINTE = [("edificio_02", 7.0, 6.0), ("edificio_09", 8.0, 6.0)]
slot_q = [math.radians(a) for a in (45, 135)]
for (nome, w, d), t in zip(QUINTE, slot_q):
    edifici.append(istanza_perimetro(nome, t, d))

# Tappo NORD: cantiere FUNLAND sull'apertura w5 (insegna rivolta a sud/piazza)
edifici.append({"modello": "cantiere", "x": 55.5, "z": -16.0, "rotY": 0.0, "y": 0.0, "s": 1.0})

# FONTANA al centro (rotY 180: zampillo verso sud, visibile da entrambi i varchi)
edifici.append({"modello": "fontana", "x": 55.5, "z": 0.0, "rotY": 180.0, "y": 0.0, "s": 1.0})

# CHIOSCO nel quadrante S-E, sfalsato: con la fontana spezza la sightline O↔E.
# Fronte locale −z; rotY 28 → normale (−sin28, −cos28) punta alla fontana.
edifici.append({"modello": "chiosco", "x": 60.0, "z": 8.5, "rotY": 28.0, "y": 0.0, "s": 1.0})


# ARREDO: panchine (anello 0.58) e aiuole (anello 0.72). Fronte panchine verso
# la fontana (rotY = tangente+180, come le facciate). SE adattato: t 120° per
# la panchina e 175°/205° per le aiuole evitano il chiosco a (60, 8.5).
def istanza_anello(nome, gradi, fr):
    t = math.radians(gradi)
    lx, lz = pl.A * fr * math.sin(t), -pl.B * fr * math.cos(t)
    return {"modello": nome, "x": round(pl.CX + lx, 2), "z": round(pl.CZ + lz, 2),
            "rotY": round((pl.tangente_rotY(t) + 180.0) % 360.0, 1), "y": 0.0, "s": 1.0}


for a in (45, 120, 225, 315):
    edifici.append(istanza_anello("panchina", a, 0.58))
for a in (20, 175, 205, 340):
    edifici.append(istanza_anello("aiuola", a, 0.72))

# Muretti: riempimento ADATTIVO degli archi liberi (i chord da 4.4 m devono
# coprire senza buchi: passo ≤ 3.8 m di arco, calcolato sull'arco vero).
def semi_copertura(t, w):
    # semi-ampiezza dt tale che la corda P(t±dt)–P(t) copra w/2 (ricerca numerica)
    px, pz = pl.ellisse(t)
    dt = 0.0
    while dt < 1.0:
        dt += 0.005
        qx, qz = pl.ellisse(t + dt)
        if math.hypot(qx - px, qz - pz) >= w / 2:
            return dt
    return dt


OCCUPATO = list(APERTURE)
for (nome, w, d), t in zip(QUINTE, slot_q):
    sc = semi_copertura(t, w) * 0.92        # 0.92: il muretto accosta il fianco quinta
    OCCUPATO.append((t - sc, t + sc))


def arco(t0, t1, passi=64):
    # lunghezza d'arco dell'ellisse tra t0 e t1 (integrazione numerica)
    L = 0.0
    for i in range(passi):
        ta = t0 + (t1 - t0) * i / passi
        L += math.hypot(pl.A * math.cos(ta), pl.B * math.sin(ta)) * (t1 - t0) / passi
    return L


# Intervalli liberi = complemento degli occupati sul giro [nord_hi, nord_hi+2π)
occ = sorted((lo % (2 * math.pi), hi % (2 * math.pi)) for (lo, hi) in OCCUPATO)
base = APERTURE[2][1] % (2 * math.pi)       # fine apertura nord: inizio del giro
occ = sorted(((lo - base) % (2 * math.pi), (hi - base) % (2 * math.pi)) for (lo, hi) in occ)
cursore = 0.0
liberi = []
for (lo, hi) in occ:
    if lo > cursore + 1e-6:
        liberi.append((cursore, lo))
    cursore = max(cursore, hi)
if cursore < 2 * math.pi - 1e-6:
    liberi.append((cursore, 2 * math.pi))

for (lo, hi) in liberi:
    t0, t1 = lo + base, hi + base
    L = arco(t0, t1)
    if L < 1.0:
        continue                             # fessura minima: la copre l'accosto
    n = max(1, math.ceil(L / 3.8))
    for i in range(n):
        t = t0 + (t1 - t0) * (i + 0.5) / n
        edifici.append(istanza_perimetro("muretto", t, 0.7))

layout = {"edifici": edifici, "props": [], "vie": [
    {"nome": "piazza_ovale", "asse": "x", "da": 45.5, "a": 65.4, "centro": 0, "larghezza": 20},
]}
OUT = pl.MODELS_DIR + "/piazza-layout.json"
os.makedirs(pl.MODELS_DIR, exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(layout, f, indent=2, ensure_ascii=False)
print("piazza-layout.json:", len(edifici), "istanze")

# ── TOP RENDER DEBUG: sagome REF + istanze come box grezzi ──
pl.clear_scene()
M = pl.materiali()
M['ref_pav'] = pl.flat_material('ref_pav', (0.60, 0.56, 0.50, 1))
M['ref_gal'] = pl.flat_material('ref_gal', (0.87, 0.82, 0.70, 1))

FOOTPRINT = {"edificio_02": (7.0, 6.0), "edificio_05": (5.5, 5.0),
             "edificio_07": (5.5, 5.0), "edificio_09": (8.0, 6.0),
             "muretto": (4.4, 0.7), "cantiere": (6.0, 0.6),
             "chiosco": (3.8, 3.8), "panchina": (2.0, 0.65), "aiuola": (2.6, 1.3)}
REF_BASSI = {"panchina", "aiuola"}   # arredo: box REF bassi per distinguerli

# Jazz: disco r45.5 a (0,0) + PALAZZI VERI da zona-layout.json (verifica
# sovrapposizioni quinte/muretti con l'anello esistente)
pl.add_cyl("REF_jazz_disc", 45.5, 0.05, 0, 0, -0.2, M['ref_pav'], vertices=64)
FOOTPRINT_JAZZ = {"club": (13.0, 9.0), "edificio13": (6.0, 5.5),
                  "edificio_01": (6.0, 5.5), "edificio_02": (7.0, 6.0),
                  "edificio_03": (3.2, 4.5), "edificio_04": (6.5, 5.5),
                  "edificio_05": (5.5, 5.0), "edificio_06": (6.0, 5.0),
                  "edificio_07": (5.5, 5.0), "edificio_08": (6.0, 5.5),
                  "edificio_09": (8.0, 6.0), "edificio_10": (6.5, 6.0)}
M['ref_jazz'] = pl.flat_material('ref_jazz', (0.52, 0.36, 0.30, 1))
JAZZ_DIR = "C:/Users/pacia/Desktop/Claude Workspace/prova/frontend/assets/models/jazz"
with open(JAZZ_DIR + "/zona-layout.json", encoding="utf-8-sig") as f:  # file con BOM
    jazz = json.load(f)
with open(JAZZ_DIR + "/varchi-skip.json", encoding="utf-8-sig") as f:
    skip = json.load(f)["skip"]
for i, e in enumerate(jazz["edifici"]):
    if any(math.hypot(e["x"] - s0["x"], e["z"] - s0["z"]) < 1.0 for s0 in skip):
        continue    # varco: istanza saltata anche in gioco (fps.js skip-list)
    base = e["modello"][:-1] if e["modello"].endswith("a") else e["modello"]
    w, d = FOOTPRINT_JAZZ.get(base, (6.0, 5.5))
    s = e.get("s", 1.0)
    pl.add_box_c(f"REF_jz_{i}", w * s, d * s, 6.0, e["x"], -e["z"], 3.0,
                 M['ref_jazz'], rot=(0, 0, math.radians(e["rotY"])), bevel=0)
# REF varco ovest (da collegamenti-wip): endcap con porta w7 @ z=−1.2 + tappi
# (GIALLO debug per staccare dal disco nel render)
pl.add_box("REF_cap_n", 0.4, 4.1, 5.6, 45.5, 6.75, 0, M['giallo'], bevel=0)   # z −8.8..−4.7
pl.add_box("REF_cap_s", 0.4, 4.1, 5.6, 45.5, -4.35, 0, M['giallo'], bevel=0)  # z +2.3..+6.4
for zt in (-6.3, 3.9):
    pl.add_box(f"REF_tappo_{int(zt*10)}", 3.4, 3.6, 5.6, 45.7, -zt, 0, M['giallo'], bevel=0)

pl.add_box("REF_gl_eo", 63.2, 9, 0.05, 97, 0, -0.15, M['ref_gal'], bevel=0)
pl.add_box("REF_gl_ns", 9, 63.2, 0.05, 97, 0, -0.15, M['ref_gal'], bevel=0)
pl.add_cyl("REF_gl_rotonda", 11, 0.05, 97, 0, -0.1, M['ottone'], vertices=48)

for e in edifici:
    nome = e["modello"]
    if nome == "piazza_base":
        disco = pl.add_cyl("REF_piazza_base", 1.0, 0.05, pl.CX, -pl.CZ, -0.1,
                           M['cordolo'], vertices=64)
        disco.scale = (pl.A, pl.B, 1.0)
        # raccordi varchi (in piazza_base.glb): sagome SOTTO quota → nel top
        # render si vedono solo attraverso le lenti disco/ovale, se le chiudono
        pl.add_box("REF_racc_o", 1.8, 9.0, 0.05, 45.5, 1.1, -0.4, M['pietra'], bevel=0)
        pl.add_box("REF_racc_e", 1.4, 10.4, 0.05, 65.45, 0, -0.4, M['pietra'], bevel=0)
    elif nome == "fontana":
        pl.add_cyl(f"REF_fontana", 3.55, 1.0, e["x"], -e["z"], 0, M['acqua'], vertices=48)
    else:
        w, d = FOOTPRINT.get(nome, (5.0, 5.0))
        h = 3.2 if nome in ("muretto", "cantiere") else (0.8 if nome in REF_BASSI else 8.0)
        colore = 'crema' if nome == 'muretto' else ('prato' if nome == 'aiuola'
                 else ('legno' if nome == 'panchina' else 'rosso'))
        b = pl.add_box_c(f"REF_{nome}_{e['x']}_{e['z']}", w, d, h,
                         e["x"], -e["z"], h / 2, M[colore],
                         rot=(0, 0, math.radians(e["rotY"])), bevel=0)

os.makedirs(pl.PREVIEW_DIR, exist_ok=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x = 1600
scene.render.resolution_y = 1200
try:
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.light = 'FLAT'
except Exception:
    pass
cam_data = bpy.data.cameras.new("topcam")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 90
cam = bpy.data.objects.new("topcam", cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (55.5, 0, 150)      # centrata sulla piazza, Jazz a sx e Galleria a dx
cam.rotation_euler = (0, 0, 0)
scene.camera = cam
scene.render.filepath = pl.PREVIEW_DIR + "/piazza_top_debug.png"
bpy.ops.render.render(write_still=True)
print("Top debug render:", scene.render.filepath)

# Zoom sulla giunzione OVEST (endcap/tappi/muretti attorno alla porta w7)
cam_data.ortho_scale = 26
cam.location = (46.0, 1.2, 150)     # by=−z → z gioco −1.2 (centro porta)
scene.render.filepath = pl.PREVIEW_DIR + "/piazza_ovest_debug.png"
bpy.ops.render.render(write_still=True)
print("Zoom ovest:", scene.render.filepath)
