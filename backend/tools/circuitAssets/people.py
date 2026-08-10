"""Figure umane: spettatori seduti in tribuna e personale ai box.

NOTA sulle animazioni: queste figure sono STATICHE e non animabili così come
sono. kit.finish() unisce tutti i pezzi dello stesso colore in una mesh sola,
quindi braccia, busto e gambe della tuta finiscono in un unico oggetto. Per
animare (es. un cambio gomme) servirebbe tenere le parti mobili come nodi
separati via kit.keep_separate — come già si fa per i gradini del podio — e
ruotarle a runtime in f1.js, sul modello di come girano le ruote dell'auto.

Scala: 1 unità di gioco ≈ 0.78 m, quindi una persona in piedi è alta ~2.3
unità e una seduta arriva a ~1.45. Le figure sono volutamente povere di
pezzi (7-9 box): degli spettatori se ne istanziano centinaia.

Il fronte guarda -Y Blender = +Z gioco: lo spettatore guarda la pista, il
meccanico guarda la corsia box.
"""
import math


def _RAD(deg):
    return math.radians(deg)


# Le tre varianti di spettatore differiscono solo per incarnato e colore
# della maglia: la folla deve leggersi variata da lontano, non caratterizzata
# da vicino. Ogni variante resta a 4 materiali.
SPECTATOR_VARIANTS = {
    'spectatorA': ('skin', 'red'),
    'spectatorB': ('skinDark', 'blue'),
    'spectatorC': ('skin', 'yellow'),
}


def _seated_person(kit, skin, shirt):
    """Figura seduta, pivot ai PIEDI (z=0) e non sul sedile: le posizioni
    esportate da grandstands.seat_anchors() sono quelle del piano di
    calpestio del gradone, che è il riferimento naturale per il layout."""
    # Quote scelte perché il bacino cada SOPRA il piano della seduta, che sta
    # a 0.26 dal gradone (vedi grandstands._tiers): più in alto la figura
    # galleggerebbe sopra il sedile.
    kit.box('black', (0.40, 0.28, 0.10), (0, -0.30, 0.05))          # scarpe
    kit.box('steelDark', (0.34, 0.20, 0.28), (0, -0.26, 0.17))      # stinchi
    kit.box('steelDark', (0.42, 0.45, 0.18), (0, -0.05, 0.36))      # cosce
    kit.box(shirt, (0.48, 0.32, 0.55), (0, 0.13, 0.73))             # busto
    for side in (-1, 1):
        # x=0.27 e non 0.29: a 0.29 il braccio era esattamente a filo del
        # busto e fra i due restava una fessura d'ombra netta.
        kit.box(shirt, (0.10, 0.28, 0.45), (side * 0.27, 0.08, 0.72))
        kit.box(skin, (0.10, 0.12, 0.12), (side * 0.27, -0.09, 0.52))  # mani
    kit.box(skin, (0.32, 0.30, 0.30), (0, 0.13, 1.16))              # testa
    kit.box('black', (0.34, 0.32, 0.10), (0, 0.13, 1.33))           # capelli
    return 0.75, 1.38


def make_spectator(variant):
    skin, shirt = SPECTATOR_VARIANTS[variant]

    def build(kit):
        return _seated_person(kit, skin, shirt)

    return build


def _standing_legs(kit):
    for side in (-1, 1):
        kit.box('black', (0.30, 0.40, 0.12), (side * 0.20, -0.04, 0.06))
        kit.box('white', (0.30, 0.28, 0.95), (side * 0.20, 0, 0.60))


def build_pit_crew(kit):
    """Meccanico in piedi, casco e visiera: la posa 'in attesa' con cui si
    riempie la piazzola davanti al box."""
    _standing_legs(kit)
    kit.box('white', (0.62, 0.34, 0.80), (0, 0, 1.45))              # busto
    kit.box('red', (0.64, 0.36, 0.12), (0, 0, 1.28))                # cintura
    for side in (-1, 1):
        kit.box('white', (0.16, 0.30, 0.72), (side * 0.39, 0.02, 1.45))
        # Guanto un filo più largo del braccio: a parità di larghezza le
        # facce laterali sarebbero complanari — z-fighting.
        kit.box('black', (0.18, 0.20, 0.16), (side * 0.39, -0.02, 1.05))
    kit.box('skin', (0.26, 0.24, 0.16), (0, 0, 1.93))               # collo/viso
    kit.box('red', (0.38, 0.38, 0.34), (0, 0.02, 2.10))             # casco
    kit.box('steelDark', (0.30, 0.10, 0.14), (0, -0.17, 2.08))      # visiera
    return 0.8, 2.30


def build_pit_crew_kneel(kit):
    """Meccanico inginocchiato con pistola pneumatica al mozzo.

    Due difetti corretti dopo il playtest visivo dell'utente:
    - le mani stavano larghe a ±0.36 mentre la pistola era al centro a ±0.10:
      non si toccavano proprio, e l'attrezzo sembrava spuntare dal petto.
      Ora gli avambracci sono inclinati e convergono sull'impugnatura;
    - la pistola era all'altezza del torace. Il mozzo di una ruota sta a
      ~0.55 unità da terra, quindi l'attrezzo va laggiù e il busto si china
      in avanti per raggiungerlo.
    """
    # Gamba sinistra: ginocchio a terra, stinco disteso all'indietro.
    kit.box('white', (0.28, 0.44, 0.26), (-0.17, -0.04, 0.40))
    kit.box('white', (0.26, 0.34, 0.20), (-0.17, 0.22, 0.15))
    kit.box('black', (0.30, 0.24, 0.12), (-0.17, 0.36, 0.06))
    # Gamba destra: piede a terra, ginocchio alto.
    kit.box('white', (0.28, 0.40, 0.26), (0.19, -0.16, 0.48))
    kit.box('white', (0.26, 0.26, 0.42), (0.19, -0.32, 0.23))
    kit.box('black', (0.30, 0.32, 0.12), (0.19, -0.40, 0.06))

    kit.box('white', (0.54, 0.34, 0.28), (0, -0.04, 0.54))          # bacino
    # Busto chinato in avanti verso la ruota: senza inclinazione la figura
    # resta seduta impettita e non si legge come "sta lavorando".
    lean = _RAD(-22)
    kit.box('white', (0.56, 0.34, 0.58), (0, -0.16, 0.88), rot=(lean, 0, 0))
    kit.box('red', (0.58, 0.36, 0.10), (0, -0.06, 0.66), rot=(lean, 0, 0))
    kit.box('red', (0.58, 0.36, 0.09), (0, -0.28, 1.09), rot=(lean, 0, 0))

    # Avambracci protesi in basso-avanti, convergenti sull'impugnatura.
    for side in (-1, 1):
        kit.box('white', (0.15, 0.15, 0.30), (side * 0.27, -0.22, 1.00))
        kit.box('white', (0.14, 0.14, 0.52), (side * 0.21, -0.50, 0.78),
                rot=(_RAD(-52), 0, 0))
        kit.box('black', (0.15, 0.15, 0.15), (side * 0.15, -0.72, 0.60))

    # Pistola pneumatica all'altezza del mozzo, puntata verso la ruota.
    kit.box('steelDark', (0.34, 0.46, 0.18), (0, -0.80, 0.57))
    kit.box('red', (0.16, 0.16, 0.22), (0, -0.62, 0.66))            # impugnatura

    kit.box('skin', (0.22, 0.20, 0.12), (0, -0.34, 1.16))
    kit.box('red', (0.34, 0.34, 0.30), (0, -0.38, 1.32))            # casco
    kit.box('steelDark', (0.26, 0.09, 0.12), (0, -0.55, 1.29))      # visiera
    return 0.86, 1.47


def make_spectator_standing(shirt):
    """Spettatore in piedi a bordo recinzione.

    Riusa `_standing_legs` dei meccanici: la posa è la stessa e non ha senso
    riscriverla. Cambiano la maglia e l'assenza di casco — a distanza è tutto
    quello che distingue un tifoso da un membro della squadra.

    Come per gli spettatori seduti, una funzione per colore: una recinzione di
    figure tutte identiche si riconosce a colpo d'occhio.
    """
    def build(kit):
        _standing_legs(kit)
        kit.box(shirt, (0.62, 0.34, 0.85), (0, 0, 1.42))             # busto
        for side in (-1, 1):
            # Braccia un filo più strette del busto: a parità di larghezza le
            # facce laterali sarebbero complanari (vedi il guanto del
            # meccanico).
            kit.box(shirt, (0.15, 0.28, 0.66), (side * 0.38, 0.01, 1.40))
            kit.box('skin', (0.16, 0.18, 0.15), (side * 0.38, -0.02, 1.02))
        kit.box('skin', (0.26, 0.24, 0.14), (0, 0, 1.91))            # collo
        kit.box('skin', (0.34, 0.32, 0.30), (0, 0.01, 2.12))         # testa
        return 0.70, 2.30

    return build
