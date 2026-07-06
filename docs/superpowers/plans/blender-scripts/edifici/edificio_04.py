# edificio_04.py — Pawn Shop: 3 piani, larga insegna gialla, palette bruna (2 varianti)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

VARIANTI = [("", 'bruno', "PAWN SHOP"), ("a", 'rosso', "HARDWARE")]
for suffisso, palette, testo in VARIANTI:
    jl.clear_scene()
    jl.build_edificio("edificio_04" + suffisso, piani=3, larghezza=6.5, profondita=5.5,
                      palette=palette, piano_terra='doppia_vetrina',
                      insegna=testo, insegna_verticale=testo.split()[0],
                      props_tetto=('comignolo',))
    jl.export_glb(f"edificio_04{suffisso}.glb")
    jl.render_previews(f"e04{suffisso}", ortho_scale=14.0)
