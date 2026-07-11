# arco.py — arco d'ingresso FUNLAND (pezzo-firma): faccia da clown su un
# PANNELLO FACCIALE PIENO tra le due torri, bocca = il passaggio w5 h4 sotto
# (v2: la prima versione a segmenti d'arco leggeva "a cubetti staccati").
# FACCIA sul lato SUD del modello (blender by-): fl.testo con rot default
# legge da -y → istanza a rotY 0 verso la piazza.
# COL: 2 spalle + architrave pieno sopra la bocca (anti-scavalco).
import sys, math
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/docs/superpowers/plans/blender-scripts/funland")
import bpy
import funland_lib as fl
fl.clear_scene()
M = fl.materiali()

for s in (-1, 1):   # spalle-torri ai lati della bocca (bocca w5 → x ±2.5..±4.3)
    fl.box_game(f"spalla_{s}", 1.8, 1.6, 5.2, s * 3.4, 0, 0, M['crema'])
    fl.box_game(f"COL_spalla_{s}", 1.8, 1.6, 5.2, s * 3.4, 0, 0, M['crema'])
    fl.box_game(f"fascia_{s}", 1.9, 1.7, 0.5, s * 3.4, 0, 3.2, M['rosso'])
    cup = fl.lathe_profile(f"cupolino_{s}", [(0.85, 5.2), (0.80, 5.45), (0.5, 5.75), (0.0, 5.95)],
                           M['rosso'], segments=16)
    cup.location.x = s * 3.4

# ── PANNELLO FACCIALE (la testa del clown, piena) sopra la bocca ──
# Cilindro ellittico (non box): fianchi ARROTONDATI, meno squadrato (v4)
pan = fl.add_cyl("pannello", 3.5, 3.6, 0, 0, 3.9, M['crema'], vertices=48)
pan.scale = (1.0, 0.8 / 7.0, 1.0)          # ellisse 7.0 x 0.8
cor = fl.add_cyl("cornice_top", 3.65, 0.28, 0, 0, 7.5, M['rosso'], vertices=48)
cor.scale = (1.0, 0.9 / 7.3, 1.0)          # segue il pannello (7.3 x 0.9)
# labbro superiore: fascia incassata nel pannello curvo (base +5cm dal fondo
# del pannello: complanare farebbe z-fighting visto dal basso)
fl.box_game("labbro", 5.0, 0.25, 0.45, 0, 0.33, 3.95, M['rosso'], bevel=0.06)
# COL architrave pieno sopra la bocca (anti-scavalco, invariato)
fl.box_game("COL_architrave", 5.0, 1.2, 2.0, 0, 0, 4.0, M['crema'])

# ── FACCIA montata SUL pannello (fronte a by-0.4) ──
for s in (-1, 1):
    # anello scuro dietro l'occhio: il bianco da solo non stacca sul crema
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.74, location=(s * 1.25, -0.30, 6.1))
    o = bpy.context.object; o.name = f"contorno_occhio_{s}"
    o.scale = (1.0, 0.35, 1.0)
    o.data.materials.append(M['verde'])
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.62, location=(s * 1.25, -0.35, 6.1))
    e = bpy.context.object; e.name = f"occhio_{s}"; e.data.materials.append(M['bianco'])
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.24, location=(s * 1.25, -0.85, 6.0))
    p = bpy.context.object; p.name = f"pupilla_{s}"; p.data.materials.append(M['nero'])
    # guance: sfere schiacciate sul pannello
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.42, location=(s * 2.55, -0.38, 5.1))
    g = bpy.context.object; g.name = f"guancia_{s}"
    g.scale = (1.0, 0.45, 1.0)
    g.data.materials.append(M['rosso'])
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.46, location=(0, -0.62, 5.15))
n = bpy.context.object; n.name = "naso"; n.data.materials.append(M['rosso'])
# DENTI appesi al bordo inferiore del pannello (scendono nella bocca)
for i in range(5):
    fl.box_game(f"dente_{i}", 0.55, 0.3, 0.55, -1.7 + i * 0.85, 0.28, 3.42, M['bianco'], bevel=0.08)
# INSEGNA attaccata sopra la cornice
fl.box_game("insegna_fondo", 4.6, 0.3, 1.0, 0, 0.5, 7.65, M['nero'])
fl.testo("txt_funland", "FUNLAND", 0.62, M['giallo'], (0, -0.72, 7.9))
fl.export_glb("arco_ingresso.glb")
fl.render_previews("arco_ingresso", ortho_scale=12, quarter_pos=(9, -11, 6))
