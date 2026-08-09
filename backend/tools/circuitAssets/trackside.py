"""Elementi a bordo pista: cartello di frenata, barriera new jersey,
passerella pedonale che scavalca la pista.

Il fronte guarda -Y Blender = +Z gioco.
"""
from voxelKit import EPS


# --- Cartello di frenata --------------------------------------------------
# È fra le poche cose che si vedono DAVVERO bene dall'abitacolo, nel momento
# in cui il pilota guarda la strada. Le barre rosse sostituiscono le cifre:
# un "100" modellato a voxel a questa scala sarebbe illeggibile.
BOARD_W, BOARD_H = 2.2, 2.0
BOARD_Z0 = 1.1


def build_braking_board(kit):
    kit.box('concreteDark', (0.9, 0.7, 0.25), (0, 0, 0.125))
    kit.box('steel', (0.28, 0.28, BOARD_Z0 + 0.3), (0, 0, (BOARD_Z0 + 0.3) / 2))

    kit.box('white', (BOARD_W, 0.18, BOARD_H), (0, 0, BOARD_Z0 + BOARD_H / 2))
    for x in (-0.65, 0.0, 0.65):
        kit.box('red', (0.4, 0.1, 1.5), (x, -0.13, BOARD_Z0 + BOARD_H / 2))

    return BOARD_W, BOARD_Z0 + BOARD_H


# --- Barriera new jersey --------------------------------------------------
# Modulo componibile: la larghezza 6 è il PASSO di affiancamento, niente
# sporge oltre x=±3. Profilo a tre gradoni, che è il modo voxel di rendere
# la sagoma svasata di un new jersey vero.
NJ_W = 6.0
NJ_LEVELS = (
    (1.4, 0.45),   # (profondità, altezza) dal basso
    (1.0, 0.50),
    (0.7, 0.45),
)


def build_concrete_barrier(kit):
    z = 0.0
    for depth, height in NJ_LEVELS:
        kit.box('concrete', (NJ_W, depth, height), (0, 0, z + height / 2))
        z += height

    # Strisce di segnalazione sul fronte del gradone centrale, alternate.
    for i in range(5):
        mat = 'red' if i % 2 == 0 else 'white'
        kit.box(mat, (1.1, 0.08, 0.4), ((i - 2) * 1.18, -0.52, 0.70))

    return NJ_W, z


# --- Passerella pedonale --------------------------------------------------
# Scavalca la pista: luce interna 28 unità fra le torri (una pista larga 22
# ci passa). Da non confondere con i `bridge` del tracciato, che sono la
# PISTA stessa che passa in cavalcavia sopra sé stessa.
FB_TOWER_X = 16.0
FB_TOWER = (4.0, 4.0)
FB_DECK_Z = 12.0
FB_DECK_D = 3.0


def build_footbridge(kit):
    for side in (-1, 1):
        x = side * FB_TOWER_X
        kit.box('concrete', (FB_TOWER[0], FB_TOWER[1], FB_DECK_Z + 0.9),
                (x, 0, (FB_DECK_Z + 0.9) / 2))
        kit.box('concreteDark', (FB_TOWER[0] + 0.5, FB_TOWER[1] + 0.5, 0.5), (x, 0, 0.25))
        # Feritoie del vano scala: senza, le torri sono due pilastri ciechi.
        # Anche sul fronte, non solo sui fianchi esterni: dalla pista si vede
        # quella faccia, e con le sole feritoie laterali restava cieca.
        for i in range(4):
            kit.box('steelDark', (0.25, 1.6, 1.4),
                    (side * (FB_TOWER_X + FB_TOWER[0] / 2 - 0.05), 0, 2.2 + i * 2.6))
            kit.box('steelDark', (1.6, 0.25, 1.4),
                    (x, -FB_TOWER[1] / 2 - 0.05, 2.2 + i * 2.6))

    # Impalcato: si ferma DENTRO le torri, senza condividerne le facce.
    deck_w = FB_TOWER_X * 2 - 1.0
    kit.box('concrete', (deck_w, FB_DECK_D, 0.5), (0, 0, FB_DECK_Z))
    for sy in (-1, 1):
        kit.box('steel', (deck_w, 0.22, 1.1), (0, sy * (FB_DECK_D / 2 - 0.11), FB_DECK_Z + 0.75))
    # Fascia sponsor sul parapetto verso la pista.
    kit.box('red', (deck_w - 4.0, 0.14, 0.7), (0, -FB_DECK_D / 2 - 0.02, FB_DECK_Z + 0.75))

    span = FB_TOWER_X * 2 + FB_TOWER[0] + 0.5
    return span, FB_DECK_Z + 1.3
