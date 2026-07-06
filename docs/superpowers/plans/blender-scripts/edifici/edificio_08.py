# edificio_08.py — Newspapers: 3 piani rosso scuro, scala laterale (2 varianti)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

VARIANTI = [("", 'rosso', "NEWSPAPERS"), ("a", 'bruno', "PRINTING Co.")]
for suffisso, palette, testo in VARIANTI:
    jl.clear_scene()
    jl.build_edificio("edificio_08" + suffisso, piani=3, larghezza=6.0, profondita=5.5,
                      palette=palette, piano_terra='vetrina', scala='laterale',
                      insegna=testo, props_tetto=('comignolo', 'abbaino'))
    jl.export_glb(f"edificio_08{suffisso}.glb")
    jl.render_previews(f"e08{suffisso}", ortho_scale=14.0)
