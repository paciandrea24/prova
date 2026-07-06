# edificio_02.py — Angolare con ingresso d'angolo e tenda (2 varianti)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import math
import jazz_lib as jl

VARIANTI = [
    ("", 'rosso', (0.24, 0.38, 0.26, 1.0)),    # tenda verde (come nell'immagine)
    ("a", 'bruno', (0.55, 0.42, 0.20, 1.0)),   # variante: palette bruna, tenda senape
]
for suffisso, palette, tenda_rgba in VARIANTI:
    jl.clear_scene()
    info = jl.build_edificio("edificio_02" + suffisso, piani=3, larghezza=7.0,
                             profondita=6.0, palette=palette, piano_terra='angolo',
                             props_tetto=('comignolo',))
    mats = info['mats']
    # Tenda fissa sopra la vetrina sinistra (falda unica, non a righe)
    mat_tenda = jl.flat_material("tenda_unita", tenda_rgba)
    jl.add_box_c("tenda_negozio", 2.3, 1.0, 0.06, -7.0 / 2 + 1.3, info['front_y'] - 0.45,
                 2.30, mat_tenda, rot=(math.radians(-22), 0, 0))
    jl.add_box_c("tenda_lembo", 2.3, 0.06, 0.20, -7.0 / 2 + 1.3, info['front_y'] - 0.90,
                 2.16, mat_tenda)
    jl.export_glb(f"edificio_02{suffisso}.glb")
    jl.render_previews(f"e02{suffisso}", ortho_scale=14.0)
