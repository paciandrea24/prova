# edificio_06.py — Al's Barbershop: 2 piani, doppia vetrina, palo da barbiere
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import math
import jazz_lib as jl

jl.clear_scene()
info = jl.build_edificio("edificio_06", piani=2, larghezza=6.0, profondita=5.0,
                         palette='crema', piano_terra='doppia_vetrina',
                         insegna="AL'S BARBERSHOP", props_tetto=('comignolo',))
mats = info['mats']
fy = info['front_y']
# ── Palo da barbiere: cilindro bianco + eliche rossa/blu (skin_chain) + calotte ──
px, pz = 6.0 / 2 - 0.35, 1.15
mat_rosso = jl.flat_material("palo_rosso", (0.75, 0.15, 0.12, 1.0))
mat_blu = jl.flat_material("palo_blu", (0.15, 0.22, 0.55, 1.0))
jl.add_cyl("palo_corpo", 0.11, 0.75, px, fy - 0.25, pz, mats['tenda_b'])
for nome, mat, fase in (("palo_elica_r", mat_rosso, 0.0), ("palo_elica_b", mat_blu, math.pi)):
    punti = []
    for i in range(13):
        t = i / 12.0
        ang = fase + t * 3.0 * math.pi
        punti.append((px + 0.115 * math.cos(ang), fy - 0.25 + 0.115 * math.sin(ang), pz + 0.06 + t * 0.63))
    jl.skin_chain(nome, punti, [(0.028, 0.028)] * 13, mat, subsurf_levels=1)
jl.add_sphere("palo_calotta_su", 0.10, px, fy - 0.25, pz + 0.80, mats['oro'])
jl.add_sphere("palo_calotta_giu", 0.10, px, fy - 0.25, pz - 0.05, mats['oro'])
jl.add_strut("palo_staffa", (px, fy, pz + 0.37), (px, fy - 0.25, pz + 0.37), 0.03, mats['ferro'])
jl.export_glb("edificio_06.glb")
jl.render_previews("e06", ortho_scale=11.0, alt_front=3.4, quarter_pos=(10, -11, 7), quarter_target_z=3.0)
