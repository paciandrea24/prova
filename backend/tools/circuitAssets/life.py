"""Vita attorno al circuito: auto parcheggiate e striscioni.

Non riempiono lo spazio, fanno sembrare il circuito abitato invece che
deserto: un parcheggio pieno e qualche striscione lungo la recinzione dicono
"qui c'è gente" più di venti alberi in più.

Lo spettatore in piedi sta in people.py, accanto alle altre figure umane.

Fronte verso -Y Blender = +Z gioco, pivot alla base.
"""
from voxelKit import EPS

# --- Auto parcheggiata ----------------------------------------------------
# Riferimento di scala: l'auto da corsa del gioco è 3.47 x 7.17. Una vettura
# di serie è più corta e più stretta, ma non di molto — a 5.8 x 2.3 sta in una
# piazzola normale e resta credibile accanto alle F1.
CAR_L, CAR_W = 5.0, 2.2
CAR_BODY_H = 0.9
CAR_FLOOR = 0.55


def make_parked_car(colore):
    """Una funzione per colore, come `people.make_spectator`: tre voci di
    registry che condividono la stessa geometria. Un parcheggio di auto tutte
    identiche si riconosce a colpo d'occhio."""

    def build(kit):
        kit.box(colore, (CAR_L, CAR_W, CAR_BODY_H), (0, 0, CAR_FLOOR + CAR_BODY_H / 2))
        # Abitacolo arretrato: è lo scalino fra cofano e tetto a dire "auto".
        kit.box(colore, (2.8, CAR_W - 0.2, 0.7), (-0.3, 0, CAR_FLOOR + CAR_BODY_H + 0.35))
        kit.box('glass', (2.6, CAR_W - 0.32, 0.55),
                (-0.3, 0, CAR_FLOOR + CAR_BODY_H + 0.38))
        # Il vetro affonda nel tetto, quindi va disegnato prima del tetto
        # stesso: qui basta che non sia complanare con i fianchi.
        kit.box('steelDark', (0.5, 0.16, 0.22), (CAR_L / 2 - 0.1, 0, CAR_FLOOR + 0.35))
        for x in (-CAR_L / 2 + 1.0, CAR_L / 2 - 1.0):
            for side in (-1, 1):
                kit.box('black', (0.75, 0.35, 0.75), (x, side * (CAR_W / 2 - 0.1), 0.375))
        return CAR_L, CAR_FLOOR + CAR_BODY_H + 0.7

    return build


# --- Striscione -----------------------------------------------------------
# Due pali e un telo teso: si mette lungo le recinzioni e nel paddock.
BN_L = 9.4
BN_POLE_H = 3.0


def build_banner(kit):
    for side in (-1, 1):
        kit.box('steelDark', (0.25, 0.25, BN_POLE_H), (side * BN_L / 2, 0, BN_POLE_H / 2))
    kit.box('white', (BN_L, 0.12, 1.6), (0, 0, 1.2 + 0.8))
    # Fasce sponsor sul fronte, affondate di EPS: senza, telo e fascia
    # sarebbero complanari e comparirebbero macchie nere nel controllo.
    for i, mat in enumerate(('red', 'blue', 'yellow')):
        kit.box(mat, (2.6, 0.14, 0.5), (-3.0 + i * 3.0, -0.06 + EPS, 2.0))
    return BN_L, BN_POLE_H
