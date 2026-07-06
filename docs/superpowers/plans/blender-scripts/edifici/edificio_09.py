# edificio_09.py — Palazzone da fondale: 4 piani, cartellone sul tetto (2 varianti)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

VARIANTI = [("", 'bruno', "HOTEL MAJESTIC"), ("a", 'rosso', "DRINK SODA!")]
for suffisso, palette, testo in VARIANTI:
    jl.clear_scene()
    jl.build_edificio("edificio_09" + suffisso, piani=4, larghezza=8.0, profondita=6.0,
                      palette=palette, piano_terra='portone',
                      props_tetto=('cartellone', 'comignolo'), cartellone_testo=testo)
    jl.export_glb(f"edificio_09{suffisso}.glb")
    jl.render_previews(f"e09{suffisso}", ortho_scale=17.0, alt_front=6.5)
