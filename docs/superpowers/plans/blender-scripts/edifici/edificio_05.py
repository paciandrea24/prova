# edificio_05.py — Tetto a falda in coppi rossi, 3 piani (2 varianti)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

VARIANTI = [("", 'rosso'), ("a", 'oliva')]
for suffisso, palette in VARIANTI:
    jl.clear_scene()
    jl.build_edificio("edificio_05" + suffisso, piani=3, larghezza=5.5, profondita=5.0,
                      palette=palette, piano_terra='vetrina', tetto='falda_coppi',
                      props_tetto=('comignolo',))
    jl.export_glb(f"edificio_05{suffisso}.glb")
    jl.render_previews(f"e05{suffisso}", ortho_scale=15.0)
