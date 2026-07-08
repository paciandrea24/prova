# kit_rotonda.py — Galleria Art Déco: tamburo+cupola della rotonda (scenografia,
# nessuna COL: sta sopra il soffitto di gioco), fontana centrale, insegna pensile.
# Rotonda centrata sull'origine; fontana e insegna hanno pivot al centro.
# Esecuzione: blender --background --python kit_rotonda.py
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-galleria-art-deco/docs/superpowers/plans/blender-scripts/galleria")
import math
import importlib
import bpy
import galleria_lib as gl
importlib.reload(gl)

R_DRUM = 10.6       # raggio del tamburo
Z_DRUM0 = 9.0       # base del tamburo (sopra l'imposta delle volte, 9.2 al colmo interno)
Z_DRUM1 = 11.2      # cornice del tamburo / base cupola
Z_APICE = 14.6      # apice della cupola


def build_rotonda(mats):
    # ── tamburo: anello pieno (lathe) + finestre ad arco finte sulle 16 facce ──
    gl.lathe_profile("tamburo", [
        (R_DRUM + 0.55, Z_DRUM0), (R_DRUM + 0.55, Z_DRUM0 + 0.35),
        (R_DRUM + 0.25, Z_DRUM0 + 0.35), (R_DRUM + 0.25, Z_DRUM1 - 0.2),
        (R_DRUM + 0.55, Z_DRUM1 - 0.2), (R_DRUM + 0.55, Z_DRUM1 + 0.15),
        (R_DRUM - 0.4, Z_DRUM1 + 0.15), (R_DRUM - 0.4, Z_DRUM0),
        (R_DRUM + 0.55, Z_DRUM0),
    ], mats['crema'], segments=32)
    # finestrelle del cleristorio: pannelli vetro + cornice oro su 16 direzioni
    for i in range(16):
        a = 2 * math.pi * i / 16
        x, y = (R_DRUM + 0.30) * math.cos(a), (R_DRUM + 0.30) * math.sin(a)
        rot = (math.radians(90), 0, a + math.pi / 2)
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.55, depth=0.25,
                                            location=(x, y, Z_DRUM0 + 1.15), rotation=(math.radians(90), 0, a + math.pi / 2))
        ob = bpy.context.object
        ob.name = f"clerist_cornice_{i}"
        ob.data.materials.append(mats['oro'])
        bpy.ops.object.shade_smooth()
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.42, depth=0.3,
                                            location=(x, y, Z_DRUM0 + 1.15), rotation=(math.radians(90), 0, a + math.pi / 2))
        ob = bpy.context.object
        ob.name = f"clerist_vetro_{i}"
        ob.data.materials.append(mats['vetro_cielo'])
        bpy.ops.object.shade_smooth()
    # ── cupola vetrata (lathe) + costoloni dorati a meridiano ──
    prof, n_prof = [], 7
    for i in range(n_prof + 1):
        t = i / n_prof
        a = math.radians(90 * t)
        prof.append(((R_DRUM - 0.15) * math.cos(a), Z_DRUM1 + (Z_APICE - Z_DRUM1 - 0.4) * math.sin(a)))
    gl.lathe_profile("cupola_vetri", prof, mats['vetro_cielo'], segments=32)
    for k in range(12):
        ak = 2 * math.pi * k / 12
        for i in range(n_prof):
            t0, t1 = i / n_prof, (i + 1) / n_prof
            a0, a1 = math.radians(90 * t0), math.radians(90 * t1)
            r0, z0 = (R_DRUM - 0.05) * math.cos(a0), Z_DRUM1 + (Z_APICE - Z_DRUM1 - 0.4) * math.sin(a0)
            r1, z1 = (R_DRUM - 0.05) * math.cos(a1), Z_DRUM1 + (Z_APICE - Z_DRUM1 - 0.4) * math.sin(a1)
            gl.add_strut(f"costolone_{k}_{i}",
                         (r0 * math.cos(ak), r0 * math.sin(ak), z0),
                         (r1 * math.cos(ak), r1 * math.sin(ak), z1), 0.12, mats['oro'])
    # anello orizzontale a meta' cupola + lanterna con guglia Déco
    bpy.ops.mesh.primitive_torus_add(major_radius=(R_DRUM - 0.15) * math.cos(math.radians(45)),
                                     minor_radius=0.09,
                                     location=(0, 0, Z_DRUM1 + (Z_APICE - Z_DRUM1 - 0.4) * math.sin(math.radians(45))))
    tor = bpy.context.object
    tor.name = "cupola_anello"
    tor.data.materials.append(mats['oro'])
    bpy.ops.object.shade_smooth()
    gl.lathe_profile("lanterna", [
        (1.5, Z_APICE - 0.55), (1.35, Z_APICE - 0.15), (0.9, Z_APICE), (0.9, Z_APICE + 0.6),
        (1.1, Z_APICE + 0.75), (0.0, Z_APICE + 0.9),
    ], mats['oro'], segments=16)
    gl.add_strut("guglia", (0, 0, Z_APICE + 0.85), (0, 0, Z_APICE + 2.1), 0.06, mats['ottone'])
    gl.add_sphere("guglia_sfera", 0.18, 0, 0, Z_APICE + 2.15, mats['oro'])


def build_fontana(mats):
    # Fontana Déco: vasca ottagonale bassa in marmo verde, pilone centrale a
    # gradoni con ventagli sunburst e coppa superiore. COL = box sulla vasca.
    gl.lathe_profile("vasca", [
        (2.6, 0.0), (2.6, 0.72), (2.45, 0.78), (2.35, 0.72), (2.35, 0.15), (0.0, 0.15),
    ], mats['marmo_verde'], segments=8)
    gl.lathe_profile("vasca_bordo", [(2.62, 0.60), (2.62, 0.74), (2.56, 0.74), (2.56, 0.60), (2.62, 0.60)],
                     mats['oro'], segments=8)
    gl.lathe_profile("acqua", [(2.3, 0.6), (0.6, 0.6)], mats['verdeacqua'], segments=8)
    # pilone a gradoni con piastre oro di separazione e alette in ottone
    for gi, (w, h) in enumerate(((1.5, 0.5), (1.1, 0.55), (0.75, 0.6))):
        z0 = 0.15 + 0.5 * gi + (0.05 * gi)
        gl.add_box(f"pilone_{gi}", w, w, h, 0, 0, z0, mats['marmo_chiaro'], bevel=0.02)
        gl.add_box(f"pilone_oro_{gi}", w + 0.12, w + 0.12, 0.07, 0, 0, z0 + h - 0.02, mats['oro'], bevel=0.01)
    for k in range(4):   # alette verticali Déco sulle facce del pilone
        a = math.pi / 2 * k
        gl.add_box_c(f"aletta_{k}", 0.09, 0.5, 1.5, 1.0 * math.cos(a), 1.0 * math.sin(a), 1.1,
                     mats['ottone'], rot=(0, 0, a), bevel=0.01)
    zc = 0.15 + 0.5 + 0.55 + 0.6 + 0.1
    gl.lathe_profile("coppa", [
        (0.15, zc), (0.2, zc + 0.35), (0.75, zc + 0.55), (0.85, zc + 0.7),
        (0.8, zc + 0.75), (0.45, zc + 0.68), (0.0, zc + 0.72),
    ], mats['marmo_chiaro'], segments=16)
    # zampilli stilizzati in vetro dalla coppa verso la vasca
    for k in range(8):
        a = math.pi / 4 * k + math.pi / 8
        gl.add_strut(f"zampillo_{k}", (0.35 * math.cos(a), 0.35 * math.sin(a), zc + 0.75),
                     (1.5 * math.cos(a), 1.5 * math.sin(a), 0.72), 0.035, mats['vetro_cielo'])
    gl.add_box("COL_fontana", 4.6, 4.6, 0.85, 0, 0, 0.0, mats['nero'], bevel=0)


def build_insegna(mats):
    # Insegna pensile della rotonda: pannello a doppia faccia con lettere neon
    # "ART DECO GALLERIA", cornice a gradoni e chevron alle estremita'.
    z_top, h = 8.6, 1.15
    w = 7.2
    for s in (-1, 1):   # tiranti: salgono fino alla calotta della cupola (~14)
        gl.add_strut(f"tirante_{s}", (s * 2.8, 0, 14.0), (s * 2.8, 0, z_top - 0.1), 0.04, mats['nero'])
    gl.add_box("pannello", w, 0.22, h, 0, 0, z_top - h, mats['nero'], bevel=0.02)
    gl.add_box("bordo_su", w + 0.2, 0.26, 0.10, 0, 0, z_top - 0.05, mats['oro'], bevel=0.01)
    gl.add_box("bordo_giu", w + 0.2, 0.26, 0.10, 0, 0, z_top - h - 0.10, mats['oro'], bevel=0.01)
    for s in (-1, 1):   # chevron Déco alle estremita'
        for i in range(3):
            gl.add_box(f"chev_{s}_{i}", 0.10, 0.28, h - 0.3 - i * 0.28, s * (w / 2 + 0.15 + i * 0.14), 0,
                       z_top - h + 0.15 + i * 0.14, mats['ottone'], bevel=0.01)
    # testo su ENTRAMBE le facce: davanti (y-) rivolto a -Y, dietro (y+) girato di 180
    for s, ry in ((1, 0.0), (-1, math.pi)):
        t = gl.add_text_mesh(f"testo_{s}", "ART DECO GALLERIA", 0.5, 0, 0, z_top - h / 2 - 0.05,
                             mats['neon_caldo'], extrude=0.05)
        t.location = (0, s * -0.18, z_top - h / 2 - 0.05)
        t.rotation_euler = (math.radians(90), 0, ry)


PEZZI = [
    ("rotonda", build_rotonda, dict(ortho_scale=26, alt_front=11.5, quarter_pos=(20, -22, 20), quarter_target_z=11.0, res=(1200, 900))),
    ("fontana", build_fontana, dict(ortho_scale=7, alt_front=1.6, quarter_pos=(5, -6, 4), quarter_target_z=1.4)),
    ("insegna", build_insegna, dict(ortho_scale=10, alt_front=7.9, quarter_pos=(6, -7, 9), quarter_target_z=7.8)),
]

for nome, build, cam in PEZZI:
    gl.clear_scene()
    mats = gl.make_materials()
    build(mats)
    gl.export_glb(nome + ".glb")
    gl.render_previews(nome, **cam)
print("kit_rotonda completato")
