# kit_mezzanino.py — Galleria Art Déco: moduli del ballatoio (mezzanino,
# mezzanino_varco per la scala, ponte sopra gli imbocchi dei bracci) + scala
# a pioli. Convenzione: parete a y=0, il solaio SPORGE verso -Y (corridoio);
# calpestio a z=4.5. La scala e' solo visiva: la collisione e' la zona climb.
# Esecuzione: blender --background --python kit_mezzanino.py
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-galleria-art-deco/docs/superpowers/plans/blender-scripts/galleria")
import importlib
import galleria_lib as gl
importlib.reload(gl)

BAY = 5.5
DECK = 2.5          # profondita' del ballatoio
Z_TOP = 4.5         # quota di calpestio
Z_SLAB = 4.2        # intradosso del solaio


def _solaio(mats, w, con_retro=False):
    # Solaio: corpo crema, piano marmo, fascia dorata sul bordo, mensole sotto
    gl.add_box("solaio", w, DECK, 0.24, 0, -DECK / 2, Z_SLAB, mats['crema'], bevel=0.015)
    # piano marmo INCASSATO nel solaio (base a 4.36, top 4.5): evita facce complanari
    # col solaio (top 4.44) → niente z-fighting sull'intradosso del ballatoio.
    gl.add_box("piano", w, DECK - 0.06, 0.14, 0, -DECK / 2, Z_TOP - 0.14, mats['marmo_chiaro'], bevel=0)
    gl.add_box("fascia", w, 0.14, 0.42, 0, -DECK + 0.05, Z_SLAB - 0.09, mats['oro'], bevel=0.015)
    n_mens = max(2, int(w / 2.6))
    for i in range(n_mens):
        mx = -w / 2 + w * (i + 0.5) / n_mens
        gl.add_box(f"mensola_{i}", 0.22, 0.22, 0.55, mx, -DECK + 0.35, Z_SLAB - 0.55, mats['ottone'], bevel=0.01)
        gl.add_strut(f"mensola_d_{i}", (mx, -0.05, Z_SLAB - 1.15), (mx, -DECK + 0.35, Z_SLAB - 0.12), 0.05, mats['ottone'])
    gl.add_box("COL_solaio", w, DECK, 0.30, 0, -DECK / 2, Z_SLAB, mats['nero'], bevel=0)
    if con_retro:
        # parapetto anche sul retro (ponte sospeso sopra un imbocco)
        gl.parapetto("retro", w, 0, -0.12, Z_TOP, mats)
        gl.add_box("COL_par_retro", w, 0.16, 1.1, 0, -0.12, Z_TOP, mats['nero'], bevel=0)


def build_mezzanino(mats):
    _solaio(mats, BAY)
    gl.parapetto("fronte", BAY, 0, -DECK + 0.12, Z_TOP, mats)
    gl.add_box("COL_parapetto", BAY, 0.16, 1.1, 0, -DECK + 0.12, Z_TOP, mats['nero'], bevel=0)


def build_mezzanino_varco(mats):
    # Variante con VARCO nel parapetto (1.3 al centro) per lo sbarco della scala
    _solaio(mats, BAY)
    lato = (BAY - 1.3) / 2
    for s in (-1, 1):
        gl.parapetto(f"fr_{'sx' if s < 0 else 'dx'}", lato, s * (1.3 + lato) / 2,
                     -DECK + 0.12, Z_TOP, mats)
        gl.add_box(f"COL_par_{'sx' if s < 0 else 'dx'}", lato, 0.16, 1.1,
                   s * (1.3 + lato) / 2, -DECK + 0.12, Z_TOP, mats['nero'], bevel=0)
        # paletto dorato che rifinisce il bordo del varco
        gl.add_cyl(f"varco_paletto_{s}", 0.05, 1.15, s * 0.65, -DECK + 0.12, Z_TOP, mats['oro'], vertices=10)
        gl.add_sphere(f"varco_pomo_{s}", 0.08, s * 0.65, -DECK + 0.12, Z_TOP + 1.2, mats['oro'])


def build_ponte(mats):
    # Ponte del ballatoio sopra l'imbocco di un braccio: parapetto su ENTRAMBI
    # i lati (sotto passa il corridoio, il retro da' sul vuoto del braccio)
    _solaio(mats, 9.0, con_retro=True)
    gl.parapetto("fronte", 9.0, 0, -DECK + 0.12, Z_TOP, mats)
    gl.add_box("COL_parapetto", 9.0, 0.16, 1.1, 0, -DECK + 0.12, Z_TOP, mats['nero'], bevel=0)


def build_scala_pioli(mats):
    # Scala a pioli in ferro/ottone appesa alla parete (y=0), piano scala a
    # y=-0.38. SOLO VISIVA: la collisione in gioco e' la zona climb del layout.
    y_s = -0.38
    for s in (-1, 1):
        gl.add_strut(f"montante_{s}", (s * 0.38, y_s, 0.10), (s * 0.38, y_s, 5.75), 0.045, mats['nero'])
        # ricciolo d'uscita: il montante rientra verso la parete in cima
        gl.add_strut(f"uscita_{s}", (s * 0.38, y_s, 5.75), (s * 0.38, 0.0, 6.05), 0.045, mats['nero'])
    n_pioli = 15
    for i in range(n_pioli):
        z = 0.45 + i * 0.36
        gl.add_strut(f"piolo_{i}", (-0.38, y_s, z), (0.38, y_s, z), 0.032, mats['ottone'])
    for z in (1.2, 3.0, 4.8):   # staffe di ancoraggio alla parete
        for s in (-1, 1):
            gl.add_strut(f"staffa_{z}_{s}", (s * 0.38, 0.0, z), (s * 0.38, y_s, z), 0.035, mats['nero'])
    gl.add_box("base", 1.0, 0.5, 0.06, 0, y_s / 2, 0.0, mats['nero'], bevel=0.01)
    # targhetta Déco "SERVIZIO" sopra la scala
    gl.add_box("targa", 1.1, 0.08, 0.4, 0, -0.06, 6.3, mats['verde_scuro'], bevel=0.01)
    gl.add_text_mesh("targa_testo", "SERVIZIO", 0.16, 0, -0.12, 6.5, mats['oro'], extrude=0.03)


PEZZI = [
    ("mezzanino", build_mezzanino, dict(ortho_scale=8, alt_front=4.9, quarter_pos=(5, -7, 7), quarter_target_z=4.3)),
    ("mezzanino_varco", build_mezzanino_varco, dict(ortho_scale=8, alt_front=4.9, quarter_pos=(5, -7, 7), quarter_target_z=4.3)),
    ("ponte", build_ponte, dict(ortho_scale=11, alt_front=4.9, quarter_pos=(7, -8, 8), quarter_target_z=4.3)),
    ("scala_pioli", build_scala_pioli, dict(ortho_scale=8, alt_front=3.2, quarter_pos=(6, -8, 5), quarter_target_z=3.2)),
]

for nome, build, cam in PEZZI:
    gl.clear_scene()
    mats = gl.make_materials()
    build(mats)
    gl.export_glb(nome + ".glb")
    gl.render_previews(nome, **cam)
print("kit_mezzanino completato")
