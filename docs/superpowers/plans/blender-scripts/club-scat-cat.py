# club-scat-cat.py — Jazz club "Scat Cat Jazz" (edificio su misura, Piano 2)
# Corpo 2 piani crema con lesene + avancorpo centrale; sopra: pannello neon e
# cresta art deco (task successivi). Fronte verso -Y, base a z=0.
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import math
import jazz_lib as jl

# ── Costanti condivise dalle sezioni successive ──
L, P = 13.0, 9.0           # ingombro corpo
H_PT = 4.0                 # piano terra alto da club
CORPO_H = 8.6              # 2 piani: cornicione a ~9m come da spec
FY = -P / 2                # filo facciata corpo
FYA = FY - 0.5             # filo facciata avancorpo (sporge 50cm)

jl.clear_scene()
mats = jl.make_materials('crema')
# Il club ha cornici in pietra chiara (non bordeaux): override della palette
mats['cornice'] = jl.flat_material("pietra_chiara", (0.90, 0.86, 0.76, 1.0))
mat_marquee = jl.flat_material("marquee_rosso", (0.62, 0.13, 0.12, 1.0))
neon_blu = jl.neon_material("neon_blu", (0.25, 0.75, 1.00, 1.0))
neon_rosa = jl.neon_material("neon_rosa", (1.00, 0.35, 0.55, 1.0))
luce_calda = jl.neon_material("luce_calda", (1.00, 0.85, 0.55, 1.0), strength=3.0)

# ── Corpo, zoccolo, marcapiano, avancorpo ──
jl.add_box("corpo", L, P, CORPO_H, 0, 0, 0.02, mats['muro'], bevel=0.03)
jl.add_box("zoccolo", L + 0.2, P + 0.2, 0.5, 0, 0, 0.0, mats['cornice'])
jl.add_box("fascia_pt", L + 0.15, P + 0.15, 0.18, 0, 0, H_PT - 0.05, mats['cornice'])
jl.add_box("avancorpo", 7.0, 0.5, CORPO_H + 0.02, 0, FY - 0.25, 0.02, mats['muro'], bevel=0.03)
jl.add_box("avancorpo_zoccolo", 7.2, 0.24, 0.5, 0, FY - 0.42, 0.0, mats['cornice'])

# ── Lesene sulle ali (con capitello), da zoccolo a cornicione ──
for li, lx in enumerate((-6.05, -3.6, 3.6, 6.05)):
    jl.add_box(f"lesena_{li}", 0.5, 0.18, CORPO_H - 0.9, lx, FY, 0.5, mats['cornice'])
    jl.add_box(f"capitello_{li}", 0.66, 0.24, 0.22, lx, FY - 0.02, CORPO_H - 0.42, mats['oro'])

# ── Cornicione a mensole + tetto (helper del generatore) ──
roof_z = jl._tetto_piatto(L, P, CORPO_H, mats)

# ── Finestre piano 1: una per campata tra le lesene di ogni ala ──
for ci, cx in enumerate((-4.83, 4.83)):
    jl._finestra(f"club_{ci}", cx, H_PT + 1.0, FY, mats, larg=1.2, alt=1.7)

# ── Vetrine del piano terra, dentro le campate ──
jl._vetrina("clubL", -4.85, FY, mats, larg=1.7)
jl._vetrina("clubR", 4.85, FY, mats, larg=1.7)

# ── Ingresso: doppia porta scura con cornice dorata, sull'avancorpo ──
jl.add_box("club_porta_cornice", 2.3, 0.16, 2.75, 0, FYA, 0.01, mats['oro'])
jl.add_box("club_porta_fondo", 1.9, 0.10, 2.55, 0, FYA - 0.04, 0.02, mats['scuro'])
for side, sx in (("L", -0.47), ("R", 0.47)):
    jl.add_box(f"club_anta_{side}", 0.96, 0.08, 2.57, sx, FYA - 0.08, 0.02, mats['legno'])
    jl.add_box(f"club_oblo_{side}", 0.42, 0.03, 0.62, sx, FYA - 0.13, 1.45, mats['vetro'])
    jl.add_box(f"club_pann_{side}", 0.52, 0.03, 0.75, sx, FYA - 0.13, 0.30, mats['scuro'])
jl.add_box("club_battente", 0.07, 0.03, 2.57, 0, FYA - 0.13, 0.02, mats['legno'], bevel=0.01)
jl.add_sphere("club_pomello_L", 0.05, -0.14, FYA - 0.17, 1.10, mats['oro'])
jl.add_sphere("club_pomello_R", 0.05, 0.14, FYA - 0.17, 1.10, mats['oro'])

# ── Gradinata (3 gradoni) ──
jl.add_box("club_gradino_1", 3.4, 1.05, 0.13, 0, FYA - 0.52, 0.0, mats['cornice'])
jl.add_box("club_gradino_2", 3.0, 0.75, 0.13, 0, FYA - 0.37, 0.13, mats['cornice'])
jl.add_box("club_gradino_3", 2.6, 0.45, 0.13, 0, FYA - 0.22, 0.26, mats['cornice'])

# ── Due lampade a muro ai lati della porta ──
for side, sx in (("L", -1.65), ("R", 1.65)):
    jl.add_strut(f"lampada_braccio_{side}", (sx, FYA, 2.55), (sx, FYA - 0.38, 2.72), 0.03, mats['ferro'])
    jl.add_cyl(f"lampada_corpo_{side}", 0.09, 0.16, sx, FYA - 0.38, 2.72, mats['ferro'])
    jl.add_sphere(f"lampada_vetro_{side}", 0.14, sx, FYA - 0.38, 2.62, luce_calda)
    jl.lathe_profile(f"lampada_campana_{side}", [(0.02, 0.0), (0.16, -0.06), (0.19, -0.12), (0.0, -0.12)],
                     mats['ferro']).location = (sx, FYA - 0.38, 2.90)

# ── MARQUEE "LIVE MUSIC" sopra l'ingresso ──
jl.add_box("marquee_cornice", 5.1, 0.5, 1.5, 0, FYA - 0.18, 2.95, mats['oro'])
jl.add_box("marquee_cassa", 4.8, 0.5, 1.24, 0, FYA - 0.28, 3.08, mat_marquee)
jl.add_text_mesh("marquee_testo1", "LIVE MUSIC", 0.46, 0, FYA - 0.56, 3.95, luce_calda)
jl.add_text_mesh("marquee_testo2", "EST. 1928 - JAZZ CLUB", 0.24, 0, FYA - 0.56, 3.42, mats['tenda_b'])
# tettuccio del marquee
jl.add_box("marquee_tetto", 5.3, 0.62, 0.10, 0, FYA - 0.20, 4.45, mats['oro'])

# ── PANNELLO SCURO con bordo dorato (fondale di sax e neon) ──
# Pattern insegna: piastra oro dietro (piu' grande) + pannello scuro davanti.
AV_F = FY - 0.5            # filo frontale dell'avancorpo
jl.add_box("pannello_cornice", 5.5, 0.14, 6.20, 0, AV_F - 0.07, 4.55, mats['oro'])
jl.add_box("pannello", 5.0, 0.12, 5.90, 0, AV_F - 0.18, 4.70, mats['scuro'])
# filetto dorato interno (bordo art deco del pannello, annegato 1cm nel fronte)
jl.add_box("filetto_top", 4.62, 0.04, 0.06, 0, AV_F - 0.25, 10.24, mats['oro'], bevel=0.01)
jl.add_box("filetto_bottom", 4.62, 0.04, 0.06, 0, AV_F - 0.25, 4.89, mats['oro'], bevel=0.01)
jl.add_box("filetto_L", 0.06, 0.04, 5.29, -2.25, AV_F - 0.25, 4.95, mats['oro'], bevel=0.01)
jl.add_box("filetto_R", 0.06, 0.04, 5.29, 2.25, AV_F - 0.25, 4.95, mats['oro'], bevel=0.01)

# ── CRESTA art deco: gambe laterali + fascia d'arco + ventaglio di canne ──
CRESTA_TOP = 14.0
# gambe dorate ai lati del pannello (da sopra il marquee alla fascia)
for side, gx in (("L", -3.05), ("R", 3.05)):
    jl.add_box(f"cresta_gamba_{side}", 0.70, 0.30, 5.85, gx, AV_F - 0.15, 4.55, mats['oro'], bevel=0.03)
# fascia d'arco orizzontale che chiude il pannello in alto
jl.add_box("cresta_fascia", 6.9, 0.30, 0.55, 0, AV_F - 0.15, 10.35, mats['oro'], bevel=0.03)
# ventaglio di canne che spunta DIETRO la fascia (silhouette a gradoni)
for ri, (rx, rw, rtop) in enumerate((
        (0.0, 1.25, CRESTA_TOP), (-0.95, 0.95, 13.1), (0.95, 0.95, 13.1),
        (-1.80, 0.90, 12.25), (1.80, 0.90, 12.25),
        (-2.55, 0.85, 11.5), (2.55, 0.85, 11.5))):
    jl.add_box(f"cresta_canna_{ri}", rw, 0.55, rtop - 8.5, rx, FY + 0.10, 8.5, mats['oro'], bevel=0.03)
# nervatura in rilievo sulla canna centrale (sopra la fascia)
jl.add_box("cresta_nervatura", 0.42, 0.14, CRESTA_TOP - 11.15, 0, FY - 0.24, 11.05, mats['oro'], bevel=0.02)

# ── Volute a ricciolo in cima alle gambe (spirali skin_chain dorate) ──
for side, vx in (("L", -3.1), ("R", 3.1)):
    segno = 1 if side == "R" else -1
    punti = []
    for i in range(11):
        t = i / 10.0
        ang = t * 1.6 * math.pi
        r = 0.42 * (1.0 - 0.8 * t)
        punti.append((vx + segno * r * math.sin(ang),
                      AV_F - 0.15, 10.05 + r * math.cos(ang) - 0.42))
    jl.skin_chain(f"voluta_{side}", punti, [(0.10, 0.10)] * 11, mats['oro'], subsurf_levels=1)

# ── SAX DORATO 3D sul pannello (corpo a J inclinato, campana lathe, chiavi) ──
SAX_Y = FY - 0.95          # ~20cm davanti al fronte del pannello (FY-0.74)

# Spina continua: collo curvo -> canna conica -> ansa a U (una sola skin_chain,
# cosi' non ci sono stacchi tra le parti del tubo)
punti_sax = []
raggi_sax = []
for px, pz in ((1.60, 9.95), (1.42, 9.93), (1.24, 9.86), (1.10, 9.72), (1.02, 9.52)):
    punti_sax.append((px, SAX_Y, pz))          # collo curvo in alto
    raggi_sax.append((0.075, 0.075))
for i in range(1, 11):                          # canna conica (raggio crescente)
    u = i / 10.0
    punti_sax.append((1.02 - 0.92 * u, SAX_Y, 9.52 - 3.42 * u))
    raggi_sax.append((0.09 + 0.08 * u,) * 2)
for i in range(1, 9):                           # ansa a U: arco da -5 a -200 gradi
    ang = math.radians(-5 - 195 * i / 8.0)
    punti_sax.append((-0.42 + 0.52 * math.cos(ang), SAX_Y, 6.10 + 0.52 * math.sin(ang)))
    raggi_sax.append((0.18, 0.18))
# campana = PROSEGUIMENTO della stessa catena (un unico blocco col tubo):
# raggi crescenti lungo la tangente d'uscita dell'ansa (su-sinistra)
fine = punti_sax[-1]
tang = (-0.342, 0.940)     # tangente dell'arco a -200 gradi
for d, r in ((0.25, 0.19), (0.45, 0.23), (0.65, 0.30), (0.82, 0.40), (0.95, 0.48)):
    punti_sax.append((fine[0] + tang[0] * d, SAX_Y, fine[2] + tang[1] * d))
    raggi_sax.append((r, r))
jl.skin_chain("sax_corpo", punti_sax, raggi_sax, mats['oro'], subsurf_levels=2)
# bocca scura sulla punta della campana (l'apertura del padiglione)
bocca = jl.add_cyl("sax_bocca", 0.33, 0.06, 0, 0, 0, mats['scuro'], vertices=24)
bocca.rotation_euler = (0, math.radians(-20), 0)
bocca.location = (fine[0] + tang[0] * 0.98, SAX_Y, fine[2] + tang[1] * 0.98)

# imboccatura (bocchino scuro orizzontale in cima al collo)
jl.add_box_c("sax_bocchino", 0.34, 0.10, 0.11, 1.78, SAX_Y, 9.96, mats['scuro'],
             rot=(0, math.radians(-8), 0), bevel=0.01)

# chiavi: madreperle grandi sul fianco sinistro della canna + palm keys dorate a destra
for ki in range(6):
    u = 0.15 + ki * 0.13
    kx, kz = 1.02 - 0.92 * u, 9.52 - 3.42 * u
    jl.add_sphere(f"sax_chiave_{ki}", 0.085, kx - 0.17, SAX_Y - 0.08, kz - 0.02, mats['tenda_b'])
for ki in range(3):
    u = 0.10 + ki * 0.10
    kx, kz = 1.02 - 0.92 * u, 9.52 - 3.42 * u
    jl.add_sphere(f"sax_palmkey_{ki}", 0.05, kx + 0.15, SAX_Y - 0.05, kz, mats['oro'])

# ── NEON: SCAT CAT (azzurro, a sinistra) + JAZZ (rosa, in basso a destra) ──
NEON_Y = FY - 0.86
jl.add_text_mesh("neon_scat", "SCAT", 0.60, -1.35, NEON_Y, 9.40, neon_blu, extrude=0.05)
jl.add_text_mesh("neon_cat", "CAT", 0.60, -1.35, NEON_Y, 8.50, neon_blu, extrude=0.05)
jl.add_text_mesh("neon_jazz", "JAZZ", 0.75, 1.15, NEON_Y, 5.60, neon_rosa, extrude=0.05)

# ── Raggi neon attorno alla campana (il "suono" che esce, come nell'immagine) ──
for di, (ang_deg, mat) in enumerate(((100, neon_blu), (130, neon_rosa), (160, neon_blu))):
    a = math.radians(ang_deg)
    jl.add_box_c(f"sax_raggio_{di}", 0.06, 0.06, 0.26,
                 -1.21 + 0.82 * math.cos(a), NEON_Y, 7.10 + 0.82 * math.sin(a), mat,
                 rot=(0, math.radians(90 - ang_deg), 0), bevel=0.01)

# ── Due note musicali (testa sfera + gambo + bandierina), neon ──
for ni, (nx, nz, mat) in enumerate(((1.60, 9.30, neon_blu), (2.00, 8.75, neon_rosa))):
    jl.add_sphere(f"nota_testa_{ni}", 0.11, nx, NEON_Y, nz, mat)
    jl.add_strut(f"nota_gambo_{ni}", (nx + 0.10, NEON_Y, nz + 0.04), (nx + 0.10, NEON_Y, nz + 0.55), 0.03, mat)
    jl.add_box_c(f"nota_bandiera_{ni}", 0.16, 0.06, 0.22, nx + 0.16, NEON_Y, nz + 0.48, mat,
                 rot=(0, math.radians(-25), 0), bevel=0.01)

# ── COLLISIONI (AABB per solidBoxes: rientrate e SEMPRE nascoste dentro
# la geometria visibile — la cresta a gradoni richiede segmenti) ──
jl.add_box("COL_corpo", L - 0.04, P - 0.04, CORPO_H - 0.02, 0, 0, 0.01, mats['scuro'], bevel=0)
# avancorpo + pannello/gambe (coperto da: avancorpo sotto 8.6, pannello+gambe sopra)
jl.add_box("COL_cresta", 6.7, 0.48, 10.29, 0, FY - 0.25, 0.01, mats['scuro'], bevel=0)
# ventaglio a gradoni: un segmento per fascia di larghezza (dietro le canne)
jl.add_box("COL_fan_1", 5.90, 0.40, 1.15, 0, FY + 0.10, 10.30, mats['scuro'], bevel=0)
jl.add_box("COL_fan_2", 2.80, 0.40, 1.60, 0, FY + 0.10, 11.45, mats['scuro'], bevel=0)
jl.add_box("COL_fan_3", 1.20, 0.40, 0.90, 0, FY + 0.10, 13.05, mats['scuro'], bevel=0)

jl.export_glb("club.glb")
jl.render_previews("club", ortho_scale=21.0, alt_front=7.0,
                   quarter_pos=(22, -26, 14), quarter_target_z=6.0)
