"""Decoro del paddock e del rettilineo: pylon pubblicitario, bandiera a
scacchi su asta, tenda hospitality.

Il fronte guarda -Y Blender = +Z gioco.
"""
from voxelKit import EPS

# --- Pylon pubblicitario --------------------------------------------------
# Snello e alto: il fusto deve restare visibilmente più stretto del pannello,
# è quello che lo fa leggere come pylon e non come cartellone.
PYLON_SHAFT = 1.4
PYLON_SHAFT_H = 20.0
PANEL_W, PANEL_D, PANEL_H = 6.0, 1.0, 7.0
PANEL_Z0 = 19.0


def build_pylon(kit):
    kit.box('concreteDark', (3.0, 3.0, 1.2), (0, 0, 0.6))
    kit.box('steel', (PYLON_SHAFT, PYLON_SHAFT, PYLON_SHAFT_H), (0, 0, PYLON_SHAFT_H / 2))

    kit.box('white', (PANEL_W, PANEL_D, PANEL_H), (0, 0, PANEL_Z0 + PANEL_H / 2))
    for z in (PANEL_Z0, PANEL_Z0 + PANEL_H):
        kit.box('steelDark', (PANEL_W + 0.4, PANEL_D + 0.3, 0.35), (0, 0, z))

    # Fasce sponsor sulla faccia anteriore, affondate di EPS nel pannello.
    for i, mat in enumerate(('red', 'blue', 'red')):
        kit.box(mat, (5.2, 0.12, 1.5), (0, -PANEL_D / 2 - 0.06 + EPS, 20.5 + i * 1.9))

    return PANEL_W + 0.4, PANEL_Z0 + PANEL_H + 0.175


# --- Bandiera a scacchi su asta -------------------------------------------
# Unico asset del catalogo volutamente NON centrato: il pivot naturale è
# l'asta (X=0), non il centro dell'ingombro — vedi centerTol nel test.
POLE_H = 14.0
FLAG_COLS = 5
FLAG_ROWS = 4
FLAG_TILE_W = 0.9
FLAG_TILE_H = 0.7
FLAG_Z0 = 11.0
# L'ondulazione a scatti è ciò che rende "sventolante" in voxel: senza
# sfalsamento la bandiera è una lastra piatta appiccicata all'asta.
FLAG_DY = (0.0, 0.25, 0.0, -0.25, 0.0)
FLAG_DZ = (0.0, 0.15, 0.3, 0.15, 0.0)


def build_flag_pole(kit):
    kit.box('concreteDark', (1.6, 1.6, 0.6), (0, 0, 0.3))
    kit.box('white', (0.3, 0.3, POLE_H), (0, 0, 0.6 + POLE_H / 2))

    for c in range(FLAG_COLS):
        # La prima colonna affonda nell'asta invece di sfiorarla.
        x = 0.55 + c * FLAG_TILE_W
        for r in range(FLAG_ROWS):
            mat = 'black' if (c + r) % 2 == 0 else 'white'
            kit.box(mat, (FLAG_TILE_W, 0.14, FLAG_TILE_H),
                    (x, FLAG_DY[c], FLAG_Z0 + FLAG_DZ[c] + r * FLAG_TILE_H))

    kit.box('yellow', (0.4, 0.4, 0.4), (0, 0, POLE_H + 0.8))

    return 5.4, POLE_H + 1.0


# --- Tenda hospitality ----------------------------------------------------
TENT_W, TENT_D = 16.0, 12.0
TENT_EAVE_Z = 4.7      # quota del bordo della falda
RIDGE_Z = 7.0          # quota del colmo
ROOF_STEPS = 5
ROOF_STEP_D = 1.3


def build_paddock_tent(kit):
    """Tetto a due falde a scalini voxel, fronte e fianchi aperti."""
    kit.box('concrete', (TENT_W, TENT_D, 0.35), (0, 0, 0.175))

    for x in (-8.0, 0.0, 8.0):
        for sy in (-1, 1):
            kit.box('steel', (0.35, 0.35, 4.8), (x, sy * 6.0, 2.4))

    # Falde: i gradini partono dal colmo (y=0) verso i bordi, contigui fra
    # loro e fra le due falde — sovrapporli a cavallo del colmo metterebbe
    # due facce superiori complanari nello stesso punto.
    # Ogni gradino è alto 0.9 contro un dislivello di 0.5: spesso quanto il
    # dislivello (0.4) lasciava una fessura passante fra un gradino e il
    # successivo, e il tetto si leggeva come una serie di assi staccate.
    for sy in (-1, 1):
        for i in range(ROOF_STEPS):
            y = sy * (ROOF_STEP_D / 2 + i * ROOF_STEP_D)
            z = RIDGE_Z - 0.3 - i * 0.5
            kit.box('white', (TENT_W + 0.8, ROOF_STEP_D, 0.9), (0, y, z - 0.25))
    kit.box('red', (TENT_W + 0.8, 0.5, 0.35), (0, 0, RIDGE_Z))

    # Solo il fondo è chiuso: fronte e fianchi restano aperti.
    kit.box('white', (TENT_W, 0.25, 4.5), (0, 6.0, 2.6))
    kit.box('concreteDark', (6.0, 1.2, 1.4), (0, 5.2, 0.85))
    kit.box('red', (TENT_W, 0.2, 0.5), (0, -6.3, TENT_EAVE_Z - 0.1))

    return TENT_W + 0.8, RIDGE_Z + 0.175
