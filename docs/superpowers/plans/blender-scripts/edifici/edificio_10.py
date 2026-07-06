# edificio_10.py — Magazzino: 2 piani, porta carraia, poche finestre (2 varianti)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

VARIANTI = [("", 'oliva'), ("a", 'bruno')]
for suffisso, palette in VARIANTI:
    jl.clear_scene()
    info = jl.build_edificio("edificio_10" + suffisso, piani=2, larghezza=6.5,
                             profondita=6.0, palette=palette, piano_terra='solo_portone',
                             props_tetto=('comignolo',))
    mats = info['mats']
    fy = info['front_y']
    # Porta carraia in legno sul lato destro: due antoni con traversi
    jl.add_box("carraia_cornice", 3.0, 0.18, 2.5, 1.5, fy, 0.01, mats['cornice'])
    for side, sx in (("L", 1.5 - 0.72), ("R", 1.5 + 0.72)):
        # Antoni che si toccano al centro (1.45 > passo 1.44: niente fessura)
        jl.add_box(f"carraia_anta_{side}", 1.45, 0.10, 2.35, sx, fy - 0.06, 0.02, mats['legno'])
        jl.add_box(f"carraia_traverso_{side}", 1.15, 0.04, 0.16, sx, fy - 0.13, 1.1, mats['legno_chiaro'])
    jl.export_glb(f"edificio_10{suffisso}.glb")
    jl.render_previews(f"e10{suffisso}", ortho_scale=11.0, alt_front=3.5)
