# ruota.py — ruota panoramica (landmark NE, tutta statica): 2 piloni ad A,
# mozzo a y11, cerchione D18 nel piano X-Z (16 segmenti), 8 raggi, 8 cabine
# appese di cui 2 BASSE con COL (coperture). COL: 4 zampe + 2 cabine basse.
# Fix vs piano: zampe centrate a by d*1.3 (a d*2.6 non convergevano al mozzo),
# traversa orizzontale (il rot X90 del piano la rendeva un palo verticale).
import sys, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/funland")
import bpy
import funland_lib as fl
fl.clear_scene()
M = fl.materiali()
HUB, R = 11.0, 9.0
for s in (-1, 1):        # piloni ad A nel piano trasversale (profondita' z gioco)
    for d in (-1, 1):
        fl.add_box_c(f"zampa_{s}_{d}", 0.55, 0.55, 11.8, s * 1.6, d * 1.3, 5.6, M['rosso'],
                     rot=(d * math.radians(13), 0, 0))
        fl.box_game(f"COL_zampa_{s}_{d}", 0.8, 1.2, 4.0, s * 1.6, d * 2.0, 0, M['rosso'])
    fl.add_box_c(f"traversa_{s}", 0.4, 4.4, 0.4, s * 1.6, 0, 6.0, M['rosso'])
mozzo = fl.add_cyl("mozzo", 0.5, 3.8, 0, 0, 0, M['ottone'], vertices=16)
mozzo.rotation_euler = (math.radians(90), 0, 0)          # asse orizzontale (profondita')
mozzo.location = (0, 0, HUB)
# CERCHIONE: 16 segmenti nel piano verticale X-Z blender (E-O di gioco)
for i in range(16):
    a0, a1 = 2 * math.pi * i / 16, 2 * math.pi * (i + 1) / 16
    xa, ya = R * math.cos(a0), HUB + R * math.sin(a0)
    xb, yb = R * math.cos(a1), HUB + R * math.sin(a1)
    L = math.hypot(xb - xa, yb - ya) + 0.1
    # Ry(t) manda +x in (cos t, 0, -sin t): angolo NEGATO o i segmenti
    # diventano corde (il "rombo" del primo render)
    fl.add_box_c(f"cerchio_{i}", L, 0.28, 0.28, (xa + xb) / 2, 0, (ya + yb) / 2, M['crema'],
                 rot=(0, -math.atan2(yb - ya, xb - xa), 0))
for i in range(8):       # raggi
    a = 2 * math.pi * i / 8
    fl.add_box_c(f"raggio_{i}", R, 0.16, 0.16, R / 2 * math.cos(a), 0, HUB + R / 2 * math.sin(a),
                 M['ottone'], rot=(0, -a, 0))
def cabina(tag, gx, gy, col, with_col):
    fl.box_game(f"cab_{tag}", 1.5, 1.4, 1.5, gx, 0, gy, col)
    fl.box_game(f"cab_tetto_{tag}", 1.7, 1.6, 0.18, gx, 0, gy + 1.5, M['rosso'], bevel=0.06)
    fl.add_cyl(f"cab_gancio_{tag}", 0.05, 0.6, gx, 0, gy + 1.68, M['nero'], vertices=6)
    if with_col:
        fl.box_game(f"COL_cab_{tag}", 1.5, 1.4, 1.7, gx, 0, gy, col)
for i in range(8):       # 8 cabine appese al cerchione; le 2 in basso quasi a terra
    a = 2 * math.pi * (i + 0.5) / 8
    cx, cy = R * math.cos(a), HUB + R * math.sin(a) - 2.1
    at_ground = cy < 1.2
    cabina(str(i), cx, max(0.0, cy), M['salvia'] if i % 2 == 0 else M['blu'], at_ground)
fl.export_glb("ruota.glb")
fl.render_previews("ruota", ortho_scale=26, quarter_pos=(20, -22, 14), quarter_target_z=10)
