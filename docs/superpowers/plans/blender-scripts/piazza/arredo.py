# arredo.py — asset di arredo piazza (muretto, panchina, aiuola)
# Un asset per run: blender --background --python arredo.py -- <asset>
# (default: muretto). Ogni asset ha la sua COL_* AABB (base a bz 0).
import sys, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/piazza")
import piazza_lib as pl

ASSET = 'muretto'   # override da CLI: blender ... -- muretto|panchina|aiuola
if '--' in sys.argv:
    ASSET = sys.argv[sys.argv.index('--') + 1]

pl.clear_scene()
M = pl.materiali()

if ASSET == 'muretto':
    # Segmento perimetrale 4.4×0.5 h3.2, origine centro-base, fronte lato −z
    # (verso l'interno piazza): zoccolo, corpo crema con lesene, copertina pietra.
    pl.box_game("muretto_zoccolo", 4.6, 0.7, 0.5, 0, 0, 0, M['pietra'])
    pl.box_game("muretto_corpo",   4.4, 0.5, 2.5, 0, 0, 0.5, M['crema'])
    pl.box_game("muretto_copertina", 4.6, 0.7, 0.2, 0, 0, 3.0, M['pietra'], bevel=0.05)
    for i in (-1, 0, 1):
        pl.box_game(f"muretto_lesena_{i}", 0.3, 0.12, 2.5, i * 1.6, -0.31, 0.5, M['crema'])
    pl.box_game("COL_muretto", 4.4, 0.7, 3.2, 0, 0, 0, M['crema'])
    pl.export_glb("muretto.glb")
    # quarter dal lato +y blender = fronte interno piazza (dove stanno le lesene)
    pl.render_previews("muretto", ortho_scale=6, quarter_pos=(5, 7, 4), quarter_target_z=1.6)

if ASSET == 'panchina':
    # copertura bassa da crouch: fianchi in ghisa, seduta+schienale in listelli.
    # Chi siede guarda −z locale (lo schienale sta a +z).
    for s in (-1, 1):
        pl.add_box_c(f"fianco_{s}", 0.08, 0.60, 0.55, s * 0.90, 0, 0.28, M['nero'])
    for i in range(4):
        pl.box_game(f"listello_{i}", 2.0, 0.12, 0.05, 0, -0.24 + i * 0.16, 0.50, M['legno'])
    for i in range(3):
        pl.box_game(f"schienale_{i}", 2.0, 0.05, 0.10, 0, 0.30, 0.60 + i * 0.14, M['legno'])
    pl.box_game("COL_panchina", 2.0, 0.65, 0.85, 0, 0, 0, M['nero'])
    pl.export_glb("panchina.glb")
    pl.render_previews("panchina", ortho_scale=3, alt_front=0.6,
                       quarter_pos=(2.5, -3, 1.6), quarter_target_z=0.45)

if ASSET == 'aiuola':
    # copertura bassa verde: cordolo in pietra, terra, cupola prato + cespugli
    pl.box_game("cordolo_n", 2.6, 0.18, 0.45, 0, -0.56, 0, M['cordolo'])
    pl.box_game("cordolo_s", 2.6, 0.18, 0.45, 0, 0.56, 0, M['cordolo'])
    pl.box_game("cordolo_e", 0.18, 1.3, 0.45, 1.21, 0, 0, M['cordolo'])
    pl.box_game("cordolo_o", 0.18, 1.3, 0.45, -1.21, 0, 0, M['cordolo'])
    pl.box_game("terra", 2.3, 1.0, 0.38, 0, 0, 0, M['legno'])
    pl.box_game("prato", 2.24, 0.94, 0.10, 0, 0, 0.38, M['prato'])
    import bpy as _b

    def sferetta(nome, r, x, y, z, mat, scala=None):
        _b.ops.mesh.primitive_uv_sphere_add(radius=r, location=(x, y, z))
        o = _b.context.object
        o.name = nome
        if scala:
            o.scale = scala
            _b.ops.object.transform_apply(location=False, rotation=False, scale=True)
        o.data.materials.append(mat)
        _b.ops.object.shade_smooth()

    # ALBERELLO ornamentale a un'estremità: tronco + chioma cartoon a 3 lobi
    pl.add_cyl("tronco", 0.07, 0.55, -0.62, 0.05, 0.45, M['legno'], vertices=10)
    sferetta("chioma_a", 0.32, -0.62, 0.05, 1.18, M['verde'], scala=(1.0, 1.0, 0.9))
    sferetta("chioma_b", 0.22, -0.44, -0.08, 1.02, M['verde'])
    sferetta("chioma_c", 0.20, -0.80, 0.12, 1.00, M['verde'])
    # ciuffo prato rialzato ai piedi del tronco
    sferetta("ciuffo", 0.16, -0.62, 0.05, 0.48, M['prato'], scala=(1.3, 1.3, 0.5))

    # FIORI con stelo sull'altra metà: testine rosse e gialle alternate
    fiori = ((0.15, 0.18, 'rosso'), (0.48, -0.15, 'giallo'), (0.82, 0.10, 'rosso'),
             (0.32, 0.28, 'giallo'), (0.68, -0.28, 'rosso'), (0.98, -0.05, 'giallo'))
    for i, (fx, fy, col) in enumerate(fiori):
        pl.add_cyl(f"stelo_{i}", 0.018, 0.20, fx, fy, 0.46, M['verde'], vertices=6)
        sferetta(f"fiore_{i}", 0.06, fx, fy, 0.70, M[col], scala=(1.0, 1.0, 0.75))

    pl.box_game("COL_aiuola", 2.6, 1.3, 0.5, 0, 0, 0, M['cordolo'])
    pl.export_glb("aiuola.glb")
    pl.render_previews("aiuola", ortho_scale=3.5, alt_front=0.5,
                       quarter_pos=(2.8, -3.2, 1.8), quarter_target_z=0.4)
