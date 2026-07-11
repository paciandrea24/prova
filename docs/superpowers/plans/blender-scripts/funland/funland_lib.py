# funland_lib.py — libreria Luna Park Funland (riusa galleria_lib + jazz_lib)
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

MODELS_DIR = REPO + "/frontend/assets/models/funland"
PREVIEW_DIR = SCRIPTS + "/funland/preview"
gl.MODELS_DIR = MODELS_DIR
gl.PREVIEW_DIR = PREVIEW_DIR
jl.MODELS_DIR = MODELS_DIR
jl.PREVIEW_DIR = PREVIEW_DIR

# ── Geometria parco (coordinate MONDO, nord = −z) ──
X0, X1 = 38.0, 88.0        # recinto E-O
Z0, Z1 = -52.0, -18.0      # recinto N-S (coaster fondale oltre Z0)
ARCO    = (55.5, -17.5)    # arco ingresso, bocca w5 (x 53..58); gola z −16..−18
GIOSTRA = (56.0, -34.0)
RUOTA   = (78.0, -46.0)
PISTA   = (72.0, -32.0)    # autoscontro 14×10 → x 65..79, z −37..−27
RISTORO = (48.5, -24.0)
TIRO    = (44.0, -40.0)
GATE_EST = (88.0, -36.0)   # cancello → corridoio servizio → portale N Galleria (97,−31.6)
VARCO_JZ = (32.5, -31.8)   # varco NE Jazz (porta ovest, raccordo_ovest)

# Re-export helper validati
clear_scene = gl.clear_scene
flat_material = gl.flat_material
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


MAT = None
def materiali():
    # Palette circo. Nomi = nomi materiale GLB: il toon-swap fa cache PER NOME,
    # riusare i nomi jazz/piazza dove il colore coincide (crema, ottone, legno...).
    global MAT
    MAT = {
        'crema':   flat_material('crema',    (0.90, 0.86, 0.74, 1)),
        'rosso':   flat_material('marquee_rosso', (0.59, 0.14, 0.13, 1)),
        'salvia':  flat_material('verde_salvia', (0.45, 0.56, 0.42, 1)),
        'verde':   flat_material('verde_scuro', (0.15, 0.31, 0.29, 1)),
        'ottone':  flat_material('ottone',   (0.74, 0.53, 0.22, 1)),
        'legno':   flat_material('legno',    (0.34, 0.20, 0.11, 1)),
        'nero':    flat_material('nero',     (0.12, 0.12, 0.13, 1)),
        'bianco':  flat_material('bianco_giostra', (0.92, 0.90, 0.85, 1)),
        'prato':   flat_material('prato',    (0.33, 0.52, 0.24, 1)),
        'terra':   flat_material('terra_fiera', (0.50, 0.40, 0.28, 1)),
        'metallo': flat_material('metallo_pista', (0.42, 0.44, 0.48, 1)),
        'giallo':  flat_material('giallo_cantiere', (0.86, 0.68, 0.20, 1)),
        'blu':     flat_material('blu_fiera', (0.24, 0.36, 0.55, 1)),
        'sanp_a':  flat_material('sanp_a',   (0.36, 0.34, 0.31, 1)),
        'sanp_b':  flat_material('sanp_b',   (0.45, 0.44, 0.41, 1)),
        'sanp_c':  flat_material('sanp_c',   (0.55, 0.53, 0.49, 1)),
        'cordolo': flat_material('cordolo',  (0.70, 0.68, 0.63, 1)),
    }
    return MAT


def testo(nome, txt, size, mat, loc, rot=(math.radians(90), 0, 0)):
    # Insegna: text mesh estruso, centrato. loc in coordinate BLENDER del modello.
    bpy.ops.object.text_add()
    t = bpy.context.object
    t.data.body = txt
    t.data.size = size
    t.data.extrude = 0.03
    t.data.align_x = 'CENTER'
    bpy.ops.object.convert(target='MESH')
    t.name = nome
    t.location = loc
    t.rotation_euler = rot
    t.data.materials.append(mat)
    return t
