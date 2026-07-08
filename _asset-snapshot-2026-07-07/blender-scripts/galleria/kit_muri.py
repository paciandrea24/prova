# kit_muri.py — Galleria Art Déco, pezzi "muro": pilastro, arcata (parete alta),
# vetrine (chiusa a/b, entrabile, entrabile_retro), portale d'estremità, volta.
# Convenzione locale di ogni pezzo: fronte verso -Y (lato corridoio), FILO
# FACCIATA a y=0, corpo verso +Y. Campata 5.5, corridoio 9, mezzanino 4.5,
# imposta volta 9.2. Ogni pezzo esporta GLB con mesh COL_* + anteprime PNG.
# Esecuzione: blender --background --python kit_muri.py
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-galleria-art-deco/docs/superpowers/plans/blender-scripts/galleria")
import math
import importlib
import galleria_lib as gl
importlib.reload(gl)

BAY = 5.5          # larghezza campata
H_MEZZ = 4.2       # sotto-trave del mezzanino (calpestio a 4.5)
H_IMPOSTA = 9.2    # imposta della volta a botte
CORR = 9.0         # larghezza corridoio (bracci)


# ─────────────────────────────────────────────────────────────
def build_pilastro(mats):
    # Pilastro/lesena h 9.2 da piazzare sui giunti tra le campate
    gl.lesena("p", 0.0, 0.05, 0.9, H_IMPOSTA, mats, d=0.8, scanalature=3)
    gl.add_box("COL_pilastro", 0.95, 0.9, H_IMPOSTA, 0, 0.05, 0.0,
               mats['nero'], bevel=0)


def build_arcata(mats):
    # Parete alta della campata (sopra i negozi): marcapiano dorato, muro crema,
    # finestrone ad arco con vetri chiari e raggiera nel timpano.
    y_muro = 0.30    # centro del muro (spessore 0.6: facce a 0 e 0.6)
    # marcapiano (trabeazione) alla quota del mezzanino
    gl.add_box("marcapiano", BAY, 0.72, 0.38, 0, 0.06, H_MEZZ - 0.05, mats['oro'], bevel=0.015)
    # muro composto a segmenti attorno al finestrone (niente boolean):
    w_fin, z_dav, z_imp, z_chiave = 3.6, 5.4, 7.9, 8.9
    lato = (BAY - w_fin) / 2.0
    gl.add_box("muro_sx", lato, 0.6, H_IMPOSTA - H_MEZZ, -BAY / 2 + lato / 2, y_muro, H_MEZZ, mats['crema'], bevel=0.015)
    gl.add_box("muro_dx", lato, 0.6, H_IMPOSTA - H_MEZZ, BAY / 2 - lato / 2, y_muro, H_MEZZ, mats['crema'], bevel=0.015)
    gl.add_box("muro_basso", w_fin, 0.6, z_dav - H_MEZZ, 0, y_muro, H_MEZZ, mats['crema'], bevel=0.015)
    gl.add_box("muro_cima", w_fin + 0.2, 0.6, H_IMPOSTA - z_chiave + 0.05, 0, y_muro, z_chiave - 0.05, mats['crema'], bevel=0.015)
    # finestrone: fondale continuo (chiude ogni spiraglio dietro l'arco) +
    # vetro chiaro arretrato + montanti/traverse in ottone
    gl.add_box("fin_fondale", w_fin + 0.5, 0.10, z_chiave - z_dav + 0.25, 0, 0.52, z_dav, mats['vetro_cielo'], bevel=0)
    gl.add_box("fin_vetro", w_fin, 0.12, z_imp - z_dav, 0, 0.42, z_dav, mats['vetro_cielo'], bevel=0)
    gl.add_box("fin_vetro_alto", w_fin - 0.7, 0.12, z_chiave - z_imp - 0.2, 0, 0.42, z_imp, mats['vetro_cielo'], bevel=0)
    for i, fx in enumerate((-w_fin / 2, -w_fin / 6, w_fin / 6, w_fin / 2)):
        gl.add_box(f"fin_mont_{i}", 0.10, 0.16, z_imp - z_dav, fx, 0.38, z_dav, mats['ottone'], bevel=0.01)
    gl.add_box("fin_trav_basso", w_fin + 0.16, 0.20, 0.14, 0, 0.36, z_dav - 0.14, mats['ottone'], bevel=0.01)
    gl.add_box("fin_trav_alto", w_fin + 0.16, 0.20, 0.12, 0, 0.36, z_imp, mats['ottone'], bevel=0.01)
    # fascia d'arco + raggiera nel timpano
    gl.arco_pieno("fin", w_fin + 0.5, 0.55, y_muro - 0.06, z_imp + 0.12, z_chiave, mats, mat_key='oro', segmenti=8, fascia=0.4)
    gl.sunburst("timpano", 0, 0.30, z_imp + 0.10, 0.95, mats, n_raggi=7, apertura=150.0)
    gl.add_box("COL_arcata", BAY, 0.6, H_IMPOSTA - H_MEZZ, 0, y_muro, H_MEZZ, mats['nero'], bevel=0)


def _fronte_negozio(mats, accento, tag_var, porta=False):
    # Fronte comune delle vetrine: zoccolo nero, cornici in ottone, vetro scuro,
    # fascia insegna con fregio; se porta=True lascia il varco centrale aperto.
    if porta:
        # zoccolo in due tronconi: il varco centrale (2.2) resta libero
        zw = (BAY - 2.2) / 2
        for s in (-1, 1):
            gl.add_box(f"zoccolo_{s}", zw, 0.72, 0.55, s * (2.2 + zw) / 2, 0.05, 0.0, mats['nero'], bevel=0.015)
    else:
        gl.add_box("zoccolo", BAY, 0.72, 0.55, 0, 0.05, 0.0, mats['nero'], bevel=0.015)
    z_vetro0, z_vetro1 = 0.55, 3.05
    w_int = BAY - 0.7                       # luce interna tra i bordi
    # montanti ottone: bordi + centrale (o ai lati della porta)
    xs = [-w_int / 2, w_int / 2]
    if porta:
        xs += [-1.0, 1.0]
    else:
        xs += [0.0]
    for i, fx in enumerate(xs):
        gl.add_box(f"vm_{tag_var}_{i}", 0.14, 0.30, z_vetro1 - z_vetro0, fx, -0.10, z_vetro0, mats['ottone'], bevel=0.01)
    gl.add_box(f"vt_{tag_var}_basso", w_int + 0.2, 0.26, 0.16, 0, -0.10, z_vetro0 - 0.16, mats['ottone'], bevel=0.01)
    gl.add_box(f"vt_{tag_var}_alto", w_int + 0.2, 0.26, 0.14, 0, -0.10, z_vetro1, mats['ottone'], bevel=0.01)
    # vetri (scuri come le vetrine jazz); con porta: solo i due pannelli laterali
    if porta:
        for s in (-1, 1):
            gl.add_box(f"vetro_{tag_var}_{s}", w_int / 2 - 1.0 - 0.1, 0.10, z_vetro1 - z_vetro0,
                       s * (1.0 + (w_int / 2 - 1.0) / 2), -0.02, z_vetro0, mats['vetro_scuro'], bevel=0)
    else:
        gl.add_box(f"vetro_{tag_var}", w_int, 0.10, z_vetro1 - z_vetro0, 0, -0.02, z_vetro0, mats['vetro_scuro'], bevel=0)
        # traversa orizzontale sui 2/3 (spartito Déco)
        gl.add_box(f"vt_{tag_var}_mezzo", w_int, 0.16, 0.08, 0, -0.08, z_vetro0 + (z_vetro1 - z_vetro0) * 0.68, mats['ottone'], bevel=0.01)
    # fascia insegna: pannello accento + cornicetta oro + fregio a chevron
    gl.add_box(f"insegna_{tag_var}", BAY - 0.5, 0.30, 0.75, 0, -0.06, 3.20, mats[accento], bevel=0.015)
    gl.add_box(f"insegna_{tag_var}_bordo", BAY - 0.4, 0.20, 0.06, 0, -0.08, 3.14, mats['oro'], bevel=0.01)
    gl.add_box(f"insegna_{tag_var}_bordo2", BAY - 0.4, 0.20, 0.06, 0, -0.08, 3.95, mats['oro'], bevel=0.01)
    for i in range(5):
        mx = -1.6 + 0.8 * i
        gl.add_strut(f"chv_{tag_var}_L{i}", (mx - 0.28, -0.22, 3.38), (mx, -0.22, 3.78), 0.022, mats['oro'])
        gl.add_strut(f"chv_{tag_var}_R{i}", (mx + 0.28, -0.22, 3.38), (mx, -0.22, 3.78), 0.022, mats['oro'])
    # cornice a gradoni di coronamento (raccordo con marcapiano dell'arcata)
    gl.cornice_gradoni(f"cima_{tag_var}", BAY - 0.3, 0.5, 0, 0.10, 3.98, mats, gradoni=2, gh=0.12)


def build_vetrina_chiusa(mats, variante='a'):
    # Vetrina cieca (scenografia + copertura). Variante a: verdeacqua;
    # variante b: verde scuro + oblo' decorativi sopra la traversa.
    accento = 'verdeacqua' if variante == 'a' else 'verde_scuro'
    _fronte_negozio(mats, accento, variante, porta=False)
    gl.add_box("retro", BAY, 0.4, H_MEZZ, 0, 0.5, 0.0, mats['crema'], bevel=0.01)
    if variante == 'b':
        for i, fx in enumerate((-1.5, 0.0, 1.5)):
            import bpy
            bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.28, depth=0.12,
                                                location=(fx, -0.14, 2.55),
                                                rotation=(math.radians(90), 0, 0))
            ob = bpy.context.object
            ob.name = f"oblo_{i}"
            ob.data.materials.append(mats['oro'])
            bpy.ops.object.shade_smooth()
    gl.add_box("COL_vetrina", BAY, 1.0, H_MEZZ, 0, 0.2, 0.0, mats['nero'], bevel=0)


def build_vetrina_entrabile(mats, retro=False):
    # Negozio ENTRABILE: varco centrale 2.0x2.6 aperto, interno 5.1x4.0 h 3.1
    # con bancone e scaffali; retro=True apre una porta 1.4x2.4 sul muro di fondo.
    _fronte_negozio(mats, 'verdeacqua', 'e', porta=True)
    # architrave sopra il varco (il fronte lascia libero -1.0..1.0 fino a 3.05)
    gl.add_box("architrave", 2.4, 0.5, 0.45, 0, 0.0, 2.62, mats['ottone'], bevel=0.01)
    gl.sunburst("porta", 0, -0.18, 2.66, 0.55, mats, n_raggi=5, apertura=160.0)
    # soglia in ottone
    gl.add_box("soglia", 2.2, 0.5, 0.06, 0, 0.0, 0.0, mats['ottone'], bevel=0.01)
    # ── interno: pavimento, muri, soffitto ──
    W_INT, D0, D1, H_INT = 5.1, 0.4, 4.4, 3.1     # y interno: 0.4 -> 4.4
    gl.add_box("int_pavimento", W_INT, D1 - D0, 0.10, 0, (D0 + D1) / 2, 0.0, mats['marmo_scuro'], bevel=0)
    gl.add_box("int_muro_sx", 0.25, D1 - D0, H_INT, -W_INT / 2 - 0.125, (D0 + D1) / 2, 0.0, mats['interno'], bevel=0)
    gl.add_box("int_muro_dx", 0.25, D1 - D0, H_INT, W_INT / 2 + 0.125, (D0 + D1) / 2, 0.0, mats['interno'], bevel=0)
    gl.add_box("int_soffitto", W_INT + 0.5, D1 - D0 + 0.3, 0.25, 0, (D0 + D1) / 2, H_INT, mats['interno'], bevel=0)
    if retro:
        # muro di fondo con porta 1.4x2.4 (due spalle + architrave) + cornice
        sp = (W_INT - 1.4) / 2
        gl.add_box("int_fondo_sx", sp, 0.3, H_INT, -W_INT / 2 + sp / 2, D1, 0.0, mats['interno'], bevel=0)
        gl.add_box("int_fondo_dx", sp, 0.3, H_INT, W_INT / 2 - sp / 2, D1, 0.0, mats['interno'], bevel=0)
        gl.add_box("int_fondo_sopra", 1.5, 0.3, H_INT - 2.4, 0, D1, 2.4, mats['interno'], bevel=0)
        gl.add_box("retro_cornice_sx", 0.12, 0.44, 2.45, -0.73, D1 + 0.02, 0.0, mats['ottone'], bevel=0.01)
        gl.add_box("retro_cornice_dx", 0.12, 0.44, 2.45, 0.73, D1 + 0.02, 0.0, mats['ottone'], bevel=0.01)
        gl.add_box("retro_cornice_su", 1.58, 0.44, 0.12, 0, D1 + 0.02, 2.40, mats['ottone'], bevel=0.01)
    else:
        gl.add_box("int_fondo", W_INT, 0.3, H_INT, 0, D1, 0.0, mats['interno'], bevel=0)
    # arredo: bancone a L + scaffale a giorno + lampada a sospensione
    gl.add_box("bancone", 2.6, 0.7, 1.05, -0.9, 2.6, 0.10, mats['legno'], bevel=0.02)
    gl.add_box("bancone_top", 2.75, 0.8, 0.07, -0.9, 2.6, 1.15, mats['marmo_chiaro'], bevel=0.015)
    gl.add_box("scaffale", 1.8, 0.35, 2.2, 1.55, D1 - 0.6, 0.10, mats['legno'], bevel=0.02)
    for ri in range(3):
        gl.add_box(f"ripiano_{ri}", 1.7, 0.30, 0.05, 1.55, D1 - 0.62, 0.55 + ri * 0.6, mats['marmo_chiaro'], bevel=0.01)
    gl.add_strut("lamp_cavo", (0, 2.4, H_INT), (0, 2.4, H_INT - 0.5), 0.02, mats['nero'])
    gl.add_sphere("lamp_globo", 0.16, 0, 2.4, H_INT - 0.62, mats['neon_caldo'])
    # ── COLLISIONI ── (fronte: spalle del varco + sopraluce; interno: gusci)
    sp_w = (BAY - 2.0) / 2
    gl.add_box("COL_fronte_sx", sp_w, 0.9, H_MEZZ, -(2.0 + sp_w) / 2, 0.1, 0.0, mats['nero'], bevel=0)
    gl.add_box("COL_fronte_dx", sp_w, 0.9, H_MEZZ, (2.0 + sp_w) / 2, 0.1, 0.0, mats['nero'], bevel=0)
    gl.add_box("COL_sopraluce", 2.2, 0.9, H_MEZZ - 2.6, 0, 0.1, 2.6, mats['nero'], bevel=0)
    gl.add_box("COL_int_pav", W_INT, D1 - D0, 0.10, 0, (D0 + D1) / 2, 0.0, mats['nero'], bevel=0)
    gl.add_box("COL_int_sx", 0.25, D1 - D0, H_INT, -W_INT / 2 - 0.125, (D0 + D1) / 2, 0.0, mats['nero'], bevel=0)
    gl.add_box("COL_int_dx", 0.25, D1 - D0, H_INT, W_INT / 2 + 0.125, (D0 + D1) / 2, 0.0, mats['nero'], bevel=0)
    gl.add_box("COL_int_soff", W_INT + 0.5, D1 - D0 + 0.3, 0.25, 0, (D0 + D1) / 2, H_INT, mats['nero'], bevel=0)
    gl.add_box("COL_bancone", 2.75, 0.8, 1.2, -0.9, 2.6, 0.10, mats['nero'], bevel=0)
    gl.add_box("COL_scaffale", 1.8, 0.35, 2.3, 1.55, D1 - 0.6, 0.10, mats['nero'], bevel=0)
    if retro:
        sp = (W_INT - 1.4) / 2
        gl.add_box("COL_fondo_sx", sp, 0.3, H_INT, -W_INT / 2 + sp / 2, D1, 0.0, mats['nero'], bevel=0)
        gl.add_box("COL_fondo_dx", sp, 0.3, H_INT, W_INT / 2 - sp / 2, D1, 0.0, mats['nero'], bevel=0)
        gl.add_box("COL_fondo_su", 1.5, 0.3, H_INT - 2.4, 0, D1, 2.4, mats['nero'], bevel=0)
    else:
        gl.add_box("COL_fondo", W_INT, 0.3, H_INT, 0, D1, 0.0, mats['nero'], bevel=0)


def build_portale(mats):
    # Portale d'estremità del braccio: cornice a gradoni nero+oro, portone chiuso
    # con raggiera, vetrata gigante a raggi dorati, scritta GALLERIA in cima.
    W, H = 11.0, 9.5
    y_c = 0.4                     # muro spesso 0.8: facce a 0 e 0.8
    # cornice perimetrale a gradoni (spalle verticali + traversa alta)
    for gi, off in enumerate((0.0, 0.35, 0.7)):
        wgi = 0.55 - gi * 0.12
        mat = mats['nero'] if gi == 0 else mats['oro']
        for s in (-1, 1):
            gl.add_box(f"spalla_{gi}_{s}", wgi, 0.8 + gi * 0.06, H - off, s * (W / 2 - off - wgi / 2), y_c - gi * 0.03, 0.0, mat, bevel=0.015)
        gl.add_box(f"traversa_{gi}", W - 2 * off, 0.8 + gi * 0.06, wgi, 0, y_c - gi * 0.03, H - off - wgi, mat, bevel=0.015)
    # fascia portone (chiuso): ante nere + battenti oro + raggiera sopra
    gl.add_box("portone_fondo", 5.0, 0.55, 3.1, 0, y_c, 0.0, mats['nero'], bevel=0.01)
    for s in (-1, 1):
        gl.add_box(f"anta_{s}", 1.9, 0.18, 2.75, s * 1.05, 0.12, 0.05, mats['verde_scuro'], bevel=0.015)
        for li in range(3):
            gl.add_box(f"anta_fascia_{s}_{li}", 1.6, 0.10, 0.10, s * 1.05, 0.06, 0.5 + li * 0.85, mats['oro'], bevel=0.01)
    gl.sunburst("portone", 0, 0.06, 3.15, 1.35, mats, n_raggi=9, apertura=170.0)
    # vetrata gigante con raggi in ottone (sole nascente Déco)
    z_v0, z_v1 = 3.7, 8.3
    w_v = 7.6
    gl.add_box("vetrata", w_v, 0.14, z_v1 - z_v0, 0, 0.55, z_v0, mats['vetro_cielo'], bevel=0)
    gl.add_box("vetrata_soglia", w_v + 0.3, 0.3, 0.18, 0, 0.42, z_v0 - 0.18, mats['ottone'], bevel=0.01)
    for i in range(9):
        a = math.radians(30 + 120 * i / 8)
        px = 0 + (w_v / 2 + 0.4) * math.cos(a)
        pz = z_v0 + (z_v1 - z_v0 + 0.3) * math.sin(a)
        px = max(-w_v / 2, min(w_v / 2, px))
        pz = min(z_v1, pz)
        gl.add_strut(f"vetrata_raggio_{i}", (0, 0.44, z_v0 + 0.05), (px, 0.44, pz), 0.045, mats['ottone'])
    for i, vz in enumerate((z_v0 + 1.4, z_v0 + 2.9)):
        gl.add_box(f"vetrata_trav_{i}", w_v, 0.16, 0.09, 0, 0.44, vz, mats['ottone'], bevel=0.01)
    # scritta nella fascia scura tra vetrata e traverse dorate (oro su oro = invisibile)
    gl.add_text_mesh("scritta", "GALLERIA", 0.42, 0, y_c - 0.48, 8.52, mats['oro'], extrude=0.06)
    gl.cornice_gradoni("corona", 4.0, 0.9, 0, y_c, H, mats, gradoni=3, gh=0.16, verso=-1)
    gl.add_box("COL_portale", W, 0.85, H, 0, y_c, 0.0, mats['nero'], bevel=0)


def build_portale_aperto(mats):
    # Variante ATTRAVERSABILE del portale (aggancio ai corridoi verso Jazz):
    # stessa cornice Deco a gradoni + scritta GALLERIA + corona, ma SENZA portone
    # e vetrata (il centro resta un varco libero ~9 m) e con COL solo agli stipiti
    # laterali (niente tamponamento centrale, niente COL in testa).
    W, H = 11.0, 9.5
    y_c = 0.4
    # cornice perimetrale a gradoni (identica al portale sigillato)
    for gi, off in enumerate((0.0, 0.35, 0.7)):
        wgi = 0.55 - gi * 0.12
        mat = mats['nero'] if gi == 0 else mats['oro']
        for s in (-1, 1):
            gl.add_box(f"spalla_{gi}_{s}", wgi, 0.8 + gi * 0.06, H - off, s * (W / 2 - off - wgi / 2), y_c - gi * 0.03, 0.0, mat, bevel=0.015)
        gl.add_box(f"traversa_{gi}", W - 2 * off, 0.8 + gi * 0.06, wgi, 0, y_c - gi * 0.03, H - off - wgi, mat, bevel=0.015)
    # scritta GALLERIA nella fascia alta + corona (come il portale sigillato)
    gl.add_text_mesh("scritta", "GALLERIA", 0.42, 0, y_c - 0.48, 8.52, mats['oro'], extrude=0.06)
    gl.cornice_gradoni("corona", 4.0, 0.9, 0, y_c, H, mats, gradoni=3, gh=0.16, verso=-1)
    # COL: solo stipiti laterali allineati alle spalle interne → varco centrale libero
    jamb = 0.6
    for s in (-1, 1):
        gl.add_box(f"COL_stipite_{'sx' if s < 0 else 'dx'}", jamb, 0.85, H, s * (W / 2 - jamb / 2), y_c, 0.0, mats['nero'], bevel=0)


def build_volta(mats):
    # Segmento di volta a botte vetrata per UNA campata: costolone d'imposta a
    # fascia dorata + falde di vetro che seguono la semiellisse. Solo scenografia
    # (sta sopra ceilingY): nessuna COL. Asse della botte lungo Y (profondita' 5.5).
    z_imp, z_chiave = H_IMPOSTA, 11.2
    rx, rz = CORR / 2 + 0.3, z_chiave - z_imp
    seg = 8
    for i in range(seg):
        a0 = math.pi * i / seg
        a1 = math.pi * (i + 1) / seg
        x0, zz0 = -rx * math.cos(a0), z_imp + rz * math.sin(a0)
        x1, zz1 = -rx * math.cos(a1), z_imp + rz * math.sin(a1)
        seg_l = math.hypot(x1 - x0, zz1 - zz0) + 0.03
        ang = math.atan2(zz1 - zz0, x1 - x0)
        gl.add_box_c(f"volta_vetro_{i}", seg_l, BAY - 0.5, 0.08,
                     (x0 + x1) / 2, 0, (zz0 + zz1) / 2, mats['vetro_cielo'],
                     rot=(0, -ang, 0), bevel=0)
    # costoloni in ottone ai due bordi della campata + colmo dorato
    for sy in (-1, 1):
        gl.arco_pieno(f"costolone_{sy}", 2 * rx, 0.30, sy * (BAY / 2 - 0.15), z_imp, z_chiave, mats, mat_key='oro', segmenti=10, fascia=0.30)
    gl.add_box("colmo", 0.35, BAY, 0.12, 0, 0, z_chiave + 0.02, mats['oro'], bevel=0.01)


# ─────────────────────────────────────────────────────────────
PEZZI = [
    ("pilastro", build_pilastro, dict(ortho_scale=11, alt_front=4.6, quarter_pos=(6, -7, 6), quarter_target_z=4.5)),
    ("arcata", build_arcata, dict(ortho_scale=12, alt_front=6.6, quarter_pos=(8, -9, 8), quarter_target_z=6.5)),
    ("vetrina_chiusa_a", lambda m: build_vetrina_chiusa(m, 'a'), dict(ortho_scale=8, alt_front=2.2, quarter_pos=(6, -7, 4), quarter_target_z=2.0)),
    ("vetrina_chiusa_b", lambda m: build_vetrina_chiusa(m, 'b'), dict(ortho_scale=8, alt_front=2.2, quarter_pos=(6, -7, 4), quarter_target_z=2.0)),
    ("vetrina_entrabile", lambda m: build_vetrina_entrabile(m, retro=False), dict(ortho_scale=10, alt_front=2.2, quarter_pos=(7, -8, 5), quarter_target_z=2.0)),
    ("vetrina_entrabile_retro", lambda m: build_vetrina_entrabile(m, retro=True), dict(ortho_scale=10, alt_front=2.2, quarter_pos=(7, -8, 5), quarter_target_z=2.0)),
    ("portale", build_portale, dict(ortho_scale=14, alt_front=4.8, quarter_pos=(11, -12, 8), quarter_target_z=4.5)),
    ("portale_aperto", build_portale_aperto, dict(ortho_scale=14, alt_front=4.8, quarter_pos=(11, -12, 8), quarter_target_z=4.5)),
    ("volta", build_volta, dict(ortho_scale=14, alt_front=10.2, quarter_pos=(10, -11, 14), quarter_target_z=10.0)),
]

for nome, build, cam in PEZZI:
    gl.clear_scene()
    mats = gl.make_materials()
    build(mats)
    gl.export_glb(nome + ".glb")
    gl.render_previews(nome, **cam)
print("kit_muri completato")
