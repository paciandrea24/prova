# edificio_03.py — Stretto e alto, 4 piani, 1 finestra per piano (2 varianti)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

VARIANTI = [("", 'ocra'), ("a", 'crema')]
for suffisso, palette in VARIANTI:
    jl.clear_scene()
    jl.build_edificio("edificio_03" + suffisso, piani=4, larghezza=3.2, profondita=4.5,
                      palette=palette, piano_terra='vetrina',
                      props_tetto=('comignolo',), h_pt=2.6, h_piano=2.3)
    jl.export_glb(f"edificio_03{suffisso}.glb")
    jl.render_previews(f"e03{suffisso}", ortho_scale=14.0, alt_front=5.6)
