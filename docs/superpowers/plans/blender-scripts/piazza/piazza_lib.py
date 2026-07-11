# piazza_lib.py — libreria Piazza della Fontana (riusa galleria_lib + jazz_lib)
# NB: i path WORKTREE dentro jazz_lib/galleria_lib puntano a worktree RIMOSSI:
# qui si sovrascrivono i MODELS_DIR/PREVIEW_DIR dei moduli dopo l'import.
import sys, os, math
REPO = "C:/Users/pacia/Desktop/Claude Workspace/prova"
SCRIPTS = REPO + "/docs/superpowers/plans/blender-scripts"
sys.path.insert(0, SCRIPTS)                  # jazz_lib.py
sys.path.insert(0, SCRIPTS + "/galleria")    # galleria_lib.py
import bpy
import galleria_lib as gl
import jazz_lib as jl

MODELS_DIR = REPO + "/frontend/assets/models/piazza"
PREVIEW_DIR = SCRIPTS + "/piazza/preview"
gl.MODELS_DIR = MODELS_DIR
gl.PREVIEW_DIR = PREVIEW_DIR
jl.MODELS_DIR = MODELS_DIR
jl.PREVIEW_DIR = PREVIEW_DIR

# ── Geometria piazza (coordinate MONDO del centro + semiassi ovale) ──
CX, CZ = 55.5, 0.0
A, B = 10.0, 16.0

# Re-export helper validati
clear_scene = gl.clear_scene
flat_material = gl.flat_material
neon_material = jl.neon_material
export_glb = gl.export_glb
render_previews = gl.render_previews
add_box = gl.add_box
add_box_c = gl.add_box_c
add_cyl = gl.add_cyl
lathe_profile = jl.lathe_profile
skin_chain = jl.skin_chain


def box_game(name, w, d, h, gx, gz, gy, mat, bevel=0.02):
    # w lungo x_gioco, d lungo z_gioco, h altezza; base a gy.
    return gl.add_box(name, w, d, h, gx, -gz, gy, mat, bevel)


def ellisse(t):
    # Punto sull'ovale in coordinate LOCALI piazza. t=0 → nord (0,−B).
    return (A * math.sin(t), -B * math.cos(t))


def tangente_rotY(t):
    # rotY (gradi, convenzione layout) che allinea il lato-X del modello
    # alla tangente dell'ellisse in t (three: (x,z)→(x·cos+z·sin, −x·sin+z·cos)).
    return math.degrees(math.atan2(-B * math.sin(t), A * math.cos(t)))


MAT = None
def materiali():
    # Palette piazza (chiamare dopo clear_scene). Nomi = nomi materiale GLB
    # (il toon-swap fa cache PER NOME: riusare i nomi jazz dove il colore coincide).
    global MAT
    MAT = {
        'sanp_a':   flat_material('sanp_a',   (0.36, 0.34, 0.31, 1)),
        'sanp_b':   flat_material('sanp_b',   (0.45, 0.44, 0.41, 1)),
        'sanp_c':   flat_material('sanp_c',   (0.55, 0.53, 0.49, 1)),
        'cordolo':  flat_material('cordolo',  (0.70, 0.68, 0.63, 1)),
        'pietra':   flat_material('pietra_piazza', (0.60, 0.57, 0.52, 1)),
        'crema':    flat_material('crema',    (0.90, 0.86, 0.74, 1)),
        'ottone':   flat_material('ottone',   (0.74, 0.53, 0.22, 1)),
        'acqua':    flat_material('acqua',    (0.45, 0.70, 0.80, 1)),
        'verde':    flat_material('verde_scuro', (0.15, 0.31, 0.29, 1)),
        'legno':    flat_material('legno',    (0.34, 0.20, 0.11, 1)),
        'prato':    flat_material('prato',    (0.33, 0.52, 0.24, 1)),
        'nero':     flat_material('nero',     (0.12, 0.12, 0.13, 1)),
        'rosso':    flat_material('marquee_rosso', (0.59, 0.14, 0.13, 1)),
        'giallo':   flat_material('giallo_cantiere', (0.86, 0.68, 0.20, 1)),
    }
    return MAT
