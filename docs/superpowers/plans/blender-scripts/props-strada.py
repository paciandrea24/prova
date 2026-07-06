# props-strada.py — props della Zona Jazz: lampione, festoni, insegna verticale
# Un prop per scena: clear -> build -> export -> render. Origine a terra (z=0).
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import math
import os
import jazz_lib as jl

os.makedirs(jl.MODELS_DIR + "/props", exist_ok=True)

# ═══ LAMPIONE (base lathe + palo + braccio curvo + lanterna a campana) ═══
jl.clear_scene()
mats = jl.make_materials('rosso')
mat_ghisa = jl.flat_material("ghisa_verde", (0.16, 0.22, 0.18, 1.0))
luce_calda = jl.neon_material("luce_calda", (1.00, 0.85, 0.55, 1.0), strength=3.0)

# base a rivoluzione (plinto sagomato)
jl.lathe_profile("lamp_base", [(0.26, 0.0), (0.24, 0.10), (0.15, 0.22), (0.10, 0.38), (0.07, 0.5), (0.0, 0.5)], mat_ghisa)
# palo con anello decorativo
jl.add_cyl("lamp_palo", 0.055, 3.0, 0, 0, 0.45, mat_ghisa)
jl.lathe_profile("lamp_anello", [(0.09, 0.0), (0.11, 0.05), (0.09, 0.10), (0.0, 0.10)], mat_ghisa).location = (0, 0, 2.10)
# braccio curvo in avanti (-Y) con ricciolo sotto
braccio = [(0, 0, 3.40), (0, -0.10, 3.55), (0, -0.28, 3.64), (0, -0.50, 3.66)]
jl.skin_chain("lamp_braccio", braccio, [(0.045, 0.045)] * 4, mat_ghisa, subsurf_levels=1)
ricciolo = []
for i in range(9):
    t = i / 8.0
    ang = math.radians(200 * t)
    r = 0.16 * (1 - 0.75 * t)
    ricciolo.append((0, -0.28 + r * math.sin(ang), 3.42 + r * math.cos(ang) - 0.16))
jl.skin_chain("lamp_ricciolo", ricciolo, [(0.03, 0.03)] * 9, mat_ghisa, subsurf_levels=1)
# lanterna appesa al braccio: gancio, campana, vetro caldo, puntale
jl.add_cyl("lamp_gancio", 0.02, 0.10, 0, -0.50, 3.56, mat_ghisa, vertices=8)
jl.lathe_profile("lamp_campana", [(0.02, 0.0), (0.16, -0.08), (0.20, -0.14), (0.0, -0.14)], mat_ghisa).location = (0, -0.50, 3.56)
jl.add_sphere("lamp_vetro", 0.13, 0, -0.50, 3.30, luce_calda)
jl.lathe_profile("lamp_puntale", [(0.05, 0.0), (0.03, -0.06), (0.0, -0.10)], mat_ghisa).location = (0, -0.50, 3.16)
jl.export_glb("props/lampione.glb")
jl.render_previews("lampione", ortho_scale=5.2, alt_front=1.9,
                   quarter_pos=(4.5, -5.0, 3.4), quarter_target_z=1.9)

# ═══ FESTONI DI BANDIERINE (catenaria skin_chain + gagliardetti triangolari) ═══
for lunghezza, sag, nome in ((6.0, 0.55, "festone_6m"), (10.0, 0.95, "festone_10m")):
    jl.clear_scene()
    mats = jl.make_materials('rosso')
    colori = [jl.flat_material(f"band_{i}", rgba) for i, rgba in enumerate((
        (0.72, 0.20, 0.16, 1.0), (0.90, 0.80, 0.55, 1.0),
        (0.25, 0.42, 0.30, 1.0), (0.30, 0.40, 0.60, 1.0)))]
    n = int(lunghezza * 3)
    punti = []
    for i in range(n + 1):
        t = i / n
        x = -lunghezza / 2 + lunghezza * t
        punti.append((x, 0, -sag * (1 - (2 * t - 1) ** 2)))
    jl.skin_chain("festone_cavo", punti, [(0.015, 0.015)] * (n + 1), mats['scuro'], subsurf_levels=1)
    n_band = int(lunghezza * 1.6)
    for i in range(n_band):
        t = (i + 0.5) / n_band
        x = -lunghezza / 2 + lunghezza * t
        z = -sag * (1 - (2 * t - 1) ** 2)
        # gagliardetto = prisma triangolare (cilindro a 3 vertici) appeso punta in giu'
        jl.add_cyl(f"bandierina_{i}", 0.13, 0.03, 0, 0, 0, colori[i % 4], vertices=3)
        band = jl.bpy.context.object
        band.rotation_euler = (math.radians(90), math.radians(180), 0)
        band.location = (x, 0, z - 0.12)
    jl.export_glb(f"props/{nome}.glb")
    jl.render_previews(nome, ortho_scale=lunghezza + 1.5, alt_front=-0.4,
                       quarter_pos=(lunghezza * 0.7, -lunghezza * 0.8, 1.5), quarter_target_z=-0.4)

# ═══ INSEGNA VERTICALE A BANDIERA (prop singolo riposizionabile) ═══
jl.clear_scene()
mats = jl.make_materials('rosso')
jl._insegna_verticale(mats, 0, 0, 4.4, "DANCE")
jl.export_glb("props/insegna_verticale.glb")
jl.render_previews("insegna_v", ortho_scale=5.5, alt_front=3.0,
                   quarter_pos=(3.5, -4, 3.5), quarter_target_z=3.0)
