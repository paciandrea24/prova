"""Box (garage) del giocatore ai pit.

A differenza del resto del catalogo questo NON è scenografia: è il box
colorato di ciascun pilota, caricato da frontend/shared/pitBoxLoader.js e
ricolorato a runtime col colore del giocatore. Il ricolore agisce sul
materiale il cui nome finisce per `_livery`: tutto ciò che deve prendere il
colore del pilota va modellato con il colore 'livery', e nient'altro.

Sostituisce il vecchio frontend/assets/custom/f1PitBox.glb, che era a
scala 3.5 e aveva il fronte modellato lungo +X (per cui il loader doveva
compensare con -90°). Questo rispetta le convenzioni del catalogo: scala
1:1 e fronte verso -Y Blender = +Z gioco.
"""
from voxelKit import EPS

# Larghezza totale (tetto compreso) 21.8, cioè l'ingombro del vecchio modello
# (21.7): i box sono affiancati lungo la corsia a PIT_BOX_SPACING = 24
# (TrackGeometry), costante usata ANCHE dall'autopilota server-side. Un box
# più largo ridurrebbe il gap fra box adiacenti da 2.3 a 1 unità, e allargare
# lo spacing cambierebbe dove le auto si fermano davvero.
W = 21.0        # larghezza (X)
D = 21.0        # profondità (Y)
H = 9.4         # altezza delle pareti (il tetto sta sopra)
WALL = 0.8
FLOOR_H = 0.3
FRONT = -D / 2
BACK = D / 2


def build_pit_box(kit):
    kit.box('tarmac', (W - WALL, D - WALL, FLOOR_H), (0, 0, FLOOR_H / 2))

    # Tre pareti chiuse; il fronte resta aperto per far entrare l'auto.
    kit.box('concrete', (W - WALL * 2, WALL, H), (0, BACK - WALL / 2, H / 2))
    for side in (-1, 1):
        kit.box('concrete', (WALL, D, H), (side * (W / 2 - WALL / 2), 0, H / 2))

    # Architrave sopra l'apertura: è la superficie livrea più grande e la
    # prima che si vede arrivando dalla corsia box.
    # Largo 21.6 e non 22, arretrato di 0.1 dal filo: a tutta larghezza
    # condivideva con le pareti laterali sia la faccia a x=±11 sia quella a
    # y=FRONT — z-fighting su tutta l'altezza dell'architrave.
    kit.box('livery', (W - 0.4, 1.2, 2.2), (0, FRONT + 0.7, H - 1.4))
    # Strisce livrea sui fianchi, visibili di profilo lungo la corsia.
    for side in (-1, 1):
        kit.box('livery', (0.35, D - 3.0, 0.9), (side * (W / 2 - 0.05), 0.8, 6.2))

    # Tetto aggettante + bordo livrea sul fronte, quest'ultimo più stretto
    # del tetto per non condividerne le facce laterali.
    kit.box('concreteDark', (W + 0.8, D + 0.8, 0.9), (0, 0, H + 0.15))
    kit.box('livery', (W + 0.6, 0.4, 0.5), (0, FRONT - 0.45, H + 0.15))

    # Attrezzatura interna: banco lungo la parete di fondo, pannello
    # portautensili e due pile di gomme. Senza, il box è una scatola vuota e
    # in gara non si capisce che è un garage.
    kit.box('steelDark', (10.0, 1.4, 1.6), (0, BACK - 1.6, FLOOR_H + 0.8))
    kit.box('steelDark', (10.0, 0.25, 2.4), (0, BACK - WALL - 0.2, 4.6))
    for i in range(3):
        for side in (-1, 1):
            kit.cyl('black', 0.58, 0.44, (side * 8.2, BACK - 3.2, FLOOR_H + 0.22 + i * 0.40))

    return W + 1.2, H + 0.6
