# recinzione.py — asset perimetro Funland (4 asset via ARGV: -- <nome>)
#   recinzione     modulo staccionata 4x0.25 h2.5 con pilastrini e bandierine
#   cancello       varco w3.5 incorniciato (montanti + architrave anti-scavalco)
#   recinto_basso  staccionata h1.05 (copertura crouch), COL piena
#   raccordo_ovest 2 ali piene + varco w3.5 con architrave (giunto verso Jazz)
# Origine di ogni asset: centro-base, sviluppo lungo X locale; la rotazione
# arriva SOLO dal rotY dell'istanza (COL = AABB locali).
import sys, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/funland")
import funland_lib as fl
ASSET = 'recinzione'
if '--' in sys.argv:
    ASSET = sys.argv[sys.argv.index('--') + 1]
fl.clear_scene()
M = fl.materiali()

if ASSET == 'recinzione':
    for s in (-1, 1):
        fl.box_game(f"pilastro_{s}", 0.3, 0.3, 2.7, s * 2.0, 0, 0, M['crema'])
        fl.box_game(f"cima_{s}", 0.4, 0.4, 0.15, s * 2.0, 0, 2.7, M['rosso'], bevel=0.05)
    for i in range(9):
        fl.box_game(f"doga_{i}", 0.18, 0.10, 2.2, -1.6 + i * 0.4, 0, 0.15, M['salvia'])
    fl.box_game("corrente_alto", 4.0, 0.12, 0.15, 0, 0, 2.35, M['crema'])
    fl.box_game("corrente_basso", 4.0, 0.12, 0.15, 0, 0, 0.15, M['crema'])
    for i in range(6):     # bandierine triangolari appese al corrente alto
        fl.add_box_c(f"band_{i}", 0.22, 0.04, 0.30, -1.45 + i * 0.58, 0, 2.15,
                     M['rosso'] if i % 2 == 0 else M['crema'], rot=(0, math.radians(40), 0))
    fl.box_game("COL_recinzione", 4.0, 0.3, 2.5, 0, 0, 0, M['crema'])
    fl.export_glb("recinzione.glb")
    fl.render_previews("recinzione", ortho_scale=6)

if ASSET == 'cancello':
    for s in (-1, 1):
        fl.box_game(f"montante_{s}", 0.45, 0.45, 3.2, s * 1.98, 0, 0, M['rosso'])
        fl.box_game(f"COL_montante_{s}", 0.45, 0.45, 3.2, s * 1.98, 0, 0, M['rosso'])
        # sopra l'architrave (3.0..3.7): a 3.2 finirebbero dentro la trave
        fl.box_game(f"palla_{s}", 0.35, 0.35, 0.3, s * 1.98, 0, 3.7, M['ottone'], bevel=0.1)
    fl.box_game("architrave", 4.4, 0.35, 0.7, 0, 0, 3.0, M['crema'], bevel=0.05)
    fl.box_game("COL_architrave", 4.4, 0.5, 1.0, 0, 0, 3.0, M['crema'])
    fl.export_glb("cancello.glb")
    fl.render_previews("cancello", ortho_scale=6)

if ASSET == 'recinto_basso':
    for s in (-1, 1):
        fl.box_game(f"paletto_{s}", 0.2, 0.2, 1.05, s * 1.45, 0, 0, M['crema'])
    fl.box_game("fascia", 3.0, 0.14, 0.35, 0, 0, 0.60, M['rosso'])
    fl.box_game("zoccolo", 3.0, 0.14, 0.25, 0, 0, 0.0, M['crema'])
    fl.box_game("COL_recinto_basso", 3.0, 0.2, 1.05, 0, 0, 0, M['crema'])
    fl.export_glb("recinto_basso.glb")
    fl.render_previews("recinto_basso", ortho_scale=4)

if ASSET == 'raccordo_ovest':
    hv = 3.5 / 2   # semi-varco
    for s in (-1, 1):
        fl.box_game(f"ala_{s}", 8.0, 0.6, 4.0, s * (hv + 4.0), 0, 0, M['crema'])
        fl.box_game(f"COL_ala_{s}", 8.0, 0.6, 4.0, s * (hv + 4.0), 0, 0, M['crema'])
    fl.box_game("architrave", 3.5, 0.7, 1.0, 0, 0, 3.0, M['crema'])
    fl.box_game("COL_architrave", 3.5, 1.0, 1.0, 0, 0, 3.0, M['crema'])
    fl.export_glb("raccordo_ovest.glb")
    fl.render_previews("raccordo_ovest", ortho_scale=12)
