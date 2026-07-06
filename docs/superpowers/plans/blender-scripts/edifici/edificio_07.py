# edificio_07.py — Smoke Shop: grande tenda a righe + insegna sporgente (2 varianti)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

VARIANTI = [("", 'bruno', "SMOKE SHOP", "CIGARS"), ("a", 'oliva', "GROCERY", "FRUIT")]
for suffisso, palette, testo_h, testo_v in VARIANTI:
    jl.clear_scene()
    # Piano terra alto (3.2m): l'insegna sta sopra la porta e la tenda a righe
    # si attacca SOTTO l'insegna (a 2.37, sopra il portone) senza coprirla
    jl.build_edificio("edificio_07" + suffisso, piani=3, larghezza=5.5, profondita=5.0,
                      palette=palette, piano_terra='doppia_vetrina',
                      tettoia=True, tettoia_z=2.37, h_pt=3.2,
                      insegna=testo_h, insegna_verticale=testo_v)
    jl.export_glb(f"edificio_07{suffisso}.glb")
    jl.render_previews(f"e07{suffisso}", ortho_scale=13.5)
