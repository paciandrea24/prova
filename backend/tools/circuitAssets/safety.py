"""Elementi di sicurezza a bordo pista: barriera di pneumatici, pannello di
rete di protezione, postazione commissari.

Restano bassi rispetto alle tribune: sono elementi di bordo, non strutture.
Il fronte guarda -Y Blender = +Z gioco.
"""
from voxelKit import EPS

# --- Barriera di pneumatici ----------------------------------------------
# Modulo componibile: la larghezza 7 è il PASSO di affiancamento, quindi
# niente può sporgere oltre x=±3.5 o due moduli adiacenti si compenetrano.
TYRE_R = 0.58
TYRE_H = 0.44
TYRE_COLS = 6
TYRE_COL_STEP = 1.10   # < 2*R: le pile si compenetrano invece di sfiorarsi
TYRE_ROW_Y = 0.55      # < R*2 per lo stesso motivo, fra le due file
TYRE_LEVELS = 4
STRAP_Z = 1.60


def build_tyre_stack(kit):
    for row in (-1, 1):
        for c in range(TYRE_COLS):
            x = (c - (TYRE_COLS - 1) / 2) * TYRE_COL_STEP
            for lv in range(TYRE_LEVELS):
                # Passo verticale 0.40 con altezza 0.44: gli pneumatici
                # impilati si compenetrano, altrimenti le facce piane
                # combacerebbero esattamente.
                z = 0.22 + lv * 0.40
                kit.cyl('black', TYRE_R, TYRE_H, (x, row * TYRE_ROW_Y, z), axis='Z')

    # Cinghia di contenimento che passa sopra le pile.
    # Due cinghie trasversali, non un piano continuo: a tutta profondità
    # copriva le pile come un coperchio e dall'alto non si vedevano più le
    # gomme.
    for y in (-0.62, 0.62):
        kit.box('white', (7.0, 0.5, 0.16), (0, y, STRAP_Z))
    # Nessuna fascia di segnalazione sul fronte: provata a due profondità
    # diverse, una lama dritta contro pile cilindriche resta comunque
    # staccata a vista. Le cinghie sopra e le fascette laterali bastano a
    # leggere il modulo.
    for side in (-1, 1):
        kit.box('red', (0.25, 2.4, 1.9), (side * 3.0, 0, 0.95))

    return 7.0, 1.9


# --- Pannello di rete di protezione ---------------------------------------
FENCE_W = 12.0
FENCE_H = 9.0
POST_X = FENCE_W / 2 - 0.225   # asse dei montanti: il filo esterno cade a ±6


def build_catch_fence(kit):
    """Modulo ripetibile lungo un tratto, passo di affiancamento 12.
    Volutamente verticale: una rete inclinata non si affianca in curva."""
    for side in (-1, 1):
        kit.box('steel', (0.45, 0.45, FENCE_H), (side * POST_X, 0, FENCE_H / 2))

    # Zoccolo e traversi si fermano PRIMA del filo esterno dei montanti
    # (±5.8 e ±5.775 contro ±6): a filo esatto sarebbero complanari con essi.
    kit.box('concreteDark', (11.6, 0.5, 1.0), (0, 0, 0.5))
    for z in (1.0, 3.6, 6.2, 8.8):
        kit.box('steel', (POST_X * 2, 0.3, 0.3), (0, 0, z))

    # Maglia rada: barre verticali sottili fra il primo e l'ultimo traverso.
    for i in range(15):
        kit.box('steelDark', (0.12, 0.12, 7.8), (-5.6 + i * 0.8, 0, 4.9))

    return FENCE_W, FENCE_H


# --- Postazione commissari di percorso ------------------------------------
DECK_W, DECK_D, DECK_H = 5.5, 4.5, 0.4
HUT_H = 3.2
POLE_TOP = 8.9


def build_marshal_post(kit):
    """Capanno aperto sul fronte (verso la pista) + asta con bandiera gialla.
    Il capanno non è un blocco pieno: le tre pareti chiuse, il soffitto e il
    piano di calpestio delimitano un vano aperto verso -Y, che prende luce
    dall'apertura."""
    kit.box('concreteDark', (DECK_W, DECK_D, DECK_H), (0, 0, DECK_H / 2))

    hut_z = DECK_H - 0.05
    # La parete di fondo si ferma dove iniziano le laterali (3.8 e non 4.4):
    # a tutta larghezza condivideva con esse le facce a x=±2.2 — z-fighting.
    kit.box('white', (3.8, 0.3, HUT_H), (0, 1.9, hut_z + HUT_H / 2))
    for side in (-1, 1):
        kit.box('white', (0.3, 4.1, HUT_H), (side * 2.05, 0, hut_z + HUT_H / 2))
        # Montante d'angolo al posto della parete anteriore, che manca.
        kit.box('steelDark', (0.35, 0.35, HUT_H), (side * 2.05, -1.9, hut_z + HUT_H / 2))
    # Soffitto più largo delle pareti, così le copre invece di combaciarvi.
    kit.box('white', (4.7, 4.4, 0.25), (0, 0, hut_z + HUT_H))

    # Tetto a tre scalini che degrada verso il fronte.
    for i, (y, z) in enumerate(((1.3, 4.2), (-0.1, 3.95), (-1.5, 3.7))):
        kit.box('red', (4.9, 1.5, 0.35), (0, y, z))

    kit.box('red', (0.5, 0.5, 1.1), (2.2, -1.5, 0.95))

    # Asta e bandiera gialla: 4 riquadri sfalsati, l'ondulazione a scatti è
    # ciò che rende "sventolante" in voxel.
    kit.box('steel', (0.25, 0.25, 8.6), (-2.4, 1.8, 4.6))
    for i, dy in enumerate((0.0, 0.18, 0.0, -0.18)):
        kit.box('yellow', (1.1, 0.12, 0.55), (-1.75, 1.8 + dy, 6.6 + i * 0.55))

    return DECK_W, POLE_TOP
