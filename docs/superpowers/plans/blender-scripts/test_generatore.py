# test_generatore.py — 3 edifici base per validare il generatore
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import bpy
import jazz_lib as jl

jl.clear_scene()
# NB: un edificio per scena e' la norma (una ricetta = un GLB); qui 3 nella
# stessa scena SOLO per il confronto visivo, spostando gli oggetti dopo la build.
for params, dx in (
    (dict(piani=3, larghezza=6.0, palette='rosso', piano_terra='portone', tettoia=True,
          scala='fronte', props_tetto=('serbatoio', 'comignolo')), -9.5),
    (dict(piani=4, larghezza=3.2, profondita=4.5, palette='ocra', piano_terra='vetrina',
          scala='laterale', props_tetto=('cartellone',), insegna_verticale="HOTEL",
          cartellone_testo="DRINK SODA!"), 0.0),
    (dict(piani=2, larghezza=7.0, profondita=6.0, palette='oliva', piano_terra='angolo',
          tetto='falda_coppi', insegna="PAWN SHOP", props_tetto=('comignolo',)), 9.0),
):
    prima = set(bpy.data.objects)
    jl.build_edificio("test", **params)
    for obj in set(bpy.data.objects) - prima:
        obj.location.x += dx
jl.render_previews("_gen", ortho_scale=32.0, alt_front=5.5, quarter_pos=(26, -28, 15), quarter_target_z=5.0)
