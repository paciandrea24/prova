# _inspect_angolo.py — close-up dell'angolo smussato (solo verifica, nessun export)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

jl.clear_scene()
jl.build_edificio("edificio_02", piani=3, larghezza=7.0, profondita=6.0,
                  palette='rosso', piano_terra='angolo', props_tetto=('comignolo',))
# Camera puntata dritta sull'angolo fronte-destra, ad altezza persona
jl.render_previews("_angolo", ortho_scale=10.0, alt_front=2.0,
                   quarter_pos=(8.5, -8.5, 2.2), quarter_target_z=1.6)
