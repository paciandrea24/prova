"""Paddock: motorhome dei team, camion trasportatore, container impilati.

Sono gli oggetti che rendono riconoscibile un paddock vero, dietro e attorno
ai box. A differenza di alberi e cespugli ne servono poche decine, non
centinaia, e si vedono da vicino a ogni pit stop: qui il limite dei 3
materiali non si applica e il dettaglio si paga volentieri.

Fronte verso -Y Blender = +Z gioco, pivot alla base.
"""
import math

from voxelKit import EPS


def _ruote(kit, passi, y_off, raggio=0.45, larghezza=0.5):
    """Ruote come blocchi schiacciati: a questa scala un cilindro non si
    distingue, e costerebbe dodici facce contro sei."""
    for x in passi:
        for side in (-1, 1):
            kit.box('black', (raggio * 2, larghezza, raggio * 2),
                    (x, side * y_off, raggio))


# --- Motorhome ------------------------------------------------------------
MH_L, MH_W, MH_H = 15.0, 3.8, 3.2
MH_FLOOR = 1.0


def build_motorhome(kit):
    kit.box('white', (MH_L, MH_W, MH_H), (0, 0, MH_FLOOR + MH_H / 2))
    # Fascia sponsor sui due fianchi, affondata di EPS per non creare due
    # facce complanari (è la causa nota delle macchie nere).
    for side in (-1, 1):
        kit.box('red', (MH_L - 1.0, 0.14, 0.8),
                (0, side * (MH_W / 2 - 0.06 + EPS), MH_FLOOR + MH_H - 1.1))
    # Finestre: sei per fianco, tutte alla stessa quota.
    for i in range(6):
        x = -MH_L / 2 + 2.0 + i * 2.2
        for side in (-1, 1):
            kit.box('glass', (1.4, 0.12, 0.9),
                    (x, side * (MH_W / 2 - 0.05 + EPS), MH_FLOOR + MH_H - 0.2))
    # Tettuccio a sbalzo: sporge di 0.2 per lato, è quello che dà spessore
    # alla sagoma vista di tre quarti.
    kit.box('steelDark', (MH_L + 0.2, MH_W + 0.4, 0.3), (0, 0, MH_FLOOR + MH_H + 0.15))
    _ruote(kit, (-MH_L / 2 + 2.2, MH_L / 2 - 2.2), MH_W / 2 - 0.3)
    # Pedana d'ingresso sul fronte (+Z gioco = -Y Blender).
    kit.box('steel', (2.5, 1.2, 0.25), (1.5, -MH_W / 2 - 0.5, 0.75))
    return MH_L, MH_FLOOR + MH_H + 0.3


# --- Camion trasportatore -------------------------------------------------
TR_CAB_L, TR_CAB_W, TR_CAB_H = 5.5, 3.6, 3.4
TR_BOX_L, TR_BOX_W, TR_BOX_H = 13.0, 3.8, 3.6
TR_GAP = 0.6


def build_truck(kit):
    x_cab = -(TR_BOX_L / 2 + TR_GAP + TR_CAB_L / 2)
    kit.box('blue', (TR_CAB_L, TR_CAB_W, TR_CAB_H), (x_cab, 0, 0.9 + TR_CAB_H / 2))
    kit.box('glass', (3.0, 0.15, 1.2),
            (x_cab - 0.4, -TR_CAB_W / 2 - 0.06 + EPS, 0.9 + TR_CAB_H - 0.8))
    # Il distacco fra motrice e rimorchio è ciò che li fa leggere come due
    # pezzi: senza, è un unico blocco lungo venti unità.
    kit.box('white', (TR_BOX_L, TR_BOX_W, TR_BOX_H), (0, 0, 1.2 + TR_BOX_H / 2))
    for side in (-1, 1):
        kit.box('red', (TR_BOX_L - 1.2, 0.14, 0.9),
                (0, side * (TR_BOX_W / 2 - 0.06 + EPS), 1.2 + TR_BOX_H - 1.3))
    kit.box('steelDark', (TR_BOX_L, TR_BOX_W + 0.2, 0.25), (0, 0, 1.2 + TR_BOX_H + 0.12))
    _ruote(kit, (x_cab - 1.4, x_cab + 1.4), TR_CAB_W / 2 - 0.3, 0.55, 0.55)
    _ruote(kit, (-TR_BOX_L / 2 + 2.0, 1.2, 3.6), TR_BOX_W / 2 - 0.3, 0.55, 0.55)
    return TR_CAB_L + TR_GAP + TR_BOX_L, 1.2 + TR_BOX_H + 0.25


# --- Container impilati ---------------------------------------------------
CT_L, CT_W, CT_H = 7.7, 3.3, 3.2


def build_container_stack(kit):
    for i, mat in enumerate(('red', 'blue')):
        # I due container si COMPENETRANO di EPS invece di essere distanziati:
        # con lo stacco di 0.08 che c'era prima restava un varco fra l'uno e
        # l'altro, e il controllo dei pixel neri lo vedeva come un buco (era
        # l'unico asset bocciato al primo giro).
        z = i * (CT_H - EPS) + CT_H / 2
        kit.box(mat, (CT_L, CT_W, CT_H), (0, 0, z))
        # Scanalature verticali: sono il dettaglio che rende riconoscibile un
        # container invece di una scatola colorata. Affondate di EPS.
        for k in range(12):
            x = -CT_L / 2 + 0.6 + k * 0.58
            for side in (-1, 1):
                kit.box('steelDark', (0.12, 0.1, CT_H - 0.5),
                        (x, side * (CT_W / 2 - 0.04 + EPS), z))
        # Maniglie agli angoli. Rientrate di 0.35 e non di 0.25: a 0.25 le loro
        # facce esterne cadevano ESATTAMENTE su quelle del container (±3.85 e
        # ±1.65) e il controllo dei pixel neri le segnalava come z-fighting,
        # con 1066 pixel scuri proprio agli angoli. Affondate anche nel tetto
        # per lo stesso motivo.
        for sx in (-1, 1):
            for sy in (-1, 1):
                kit.box('steel', (0.5, 0.5, 0.35),
                        (sx * (CT_L / 2 - 0.4), sy * (CT_W / 2 - 0.4), z + CT_H / 2 - 0.25))
    return CT_L, 2 * CT_H + 0.08
