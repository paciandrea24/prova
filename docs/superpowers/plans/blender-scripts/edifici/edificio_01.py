# edificio_01.py — Edificio "13" (ricetta di riferimento, replica di edificio-jazz.py)
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import jazz_lib as jl

jl.clear_scene()
info = jl.build_edificio("edificio_01", piani=3, larghezza=6.0, profondita=5.5,
                         palette='rosso', piano_terra='portone', tettoia=True,
                         scala='fronte', props_tetto=('serbatoio', 'comignolo'),
                         serbatoio_testo="45")
mats = info['mats']
# Dettaglio custom: targa civico "13" sopra la tettoia (fascia libera sotto il davanzale)
jl.add_box("insegna13", 0.55, 0.08, 0.26, 0, info['front_y'] - 0.05, 2.62, mats['cornice'])
jl.add_text_mesh("insegna13_testo", "13", 0.17, 0, info['front_y'] - 0.11, 2.75, mats['scuro'])
jl.export_glb("edificio_01.glb")
jl.render_previews("e01", ortho_scale=15.0)
