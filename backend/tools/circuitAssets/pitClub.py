"""Il coronamento della fila dei box: terrazza aperta sopra il garage,
salotto vetrato sopra la palazzina uffici (spec 2026-09-02).

Il fronte guarda -Y Blender = +Z gioco, come gli edifici sotto.

⚠️ Questi due modelli NON hanno basamento: l'edificio sotto È il basamento. Il
pivot sta alla base del modulo, e chi lo posa lo mette alla quota dell'edificio
più la sua altezza — vedi `coronamentoDeiBox` in trackScenery.js.

⚠️ La pianta è quella degli edifici, importata da pitBuildings invece che
ricopiata: un coronamento più largo sporgerebbe nel vuoto, uno più stretto
lascerebbe vedere il tetto nudo.

Nota sulle quote: come in tutto il catalogo, nessun volume condivide un piano
esterno con un altro — i montanti sfondano i teli, i teli sporgono dai
montanti. Vedi la nota in testa a voxelKit.py.
"""
from voxelKit import EPS

from . import pitBuildings

W = pitBuildings.W          # 12.3, il corpo dell'edificio
D = pitBuildings.D          # 14.0
HALF_W = W / 2
HALF_D = D / 2
FRONT = -HALF_D             # verso la corsia box

# Il solaio sporge di 0.45 per lato: più del tetto del garage (che sporge 0.3)
# e più del parapetto della palazzina (0.3), così non condivide un piano
# verticale con nessuno dei due e il coronamento si legge come un piano
# appoggiato sopra, non come la continuazione del muro.
SLAB_OVER = 0.45
SLAB_H = 0.4
PARAPETTO_H = 1.1


def _solaio(kit, mat):
    kit.box(mat, (W + SLAB_OVER * 2, D + SLAB_OVER * 2, SLAB_H),
            (0, 0, SLAB_H / 2))


def build_pit_roof_terrace(kit):
    """Terrazza aperta sopra il garage: parapetto pieno, pergola, tavolini con
    ombrelloni, fioriere, bancone sul fondo."""
    z0 = SLAB_H
    _solaio(kit, 'concreteDark')

    # Parapetto PIENO, non a montanti: da lontano una fila di stecchini non si
    # legge, un pannello sì — è la lezione già pagata sull'hospitalityDeck. La
    # banda in cima è dove va il colore, e sporge di mezzo spessore per non
    # essere complanare col pannello.
    for sy in (-1, 1):
        y = sy * (HALF_D - 0.25)
        kit.box('white', (W - 0.4, 0.35, PARAPETTO_H), (0, y, z0 + PARAPETTO_H / 2))
        kit.box('red', (W - 0.25, 0.45, 0.25), (0, y, z0 + PARAPETTO_H + 0.125 - EPS))
    for sx in (-1, 1):
        x = sx * (HALF_W - 0.25)
        kit.box('white', (0.35, D - 1.0, PARAPETTO_H), (x, 0, z0 + PARAPETTO_H / 2))
        kit.box('red', (0.45, D - 0.85, 0.25), (x, 0, z0 + PARAPETTO_H + 0.125 - EPS))

    # Pergola sul fondo: quattro montanti e un telo. Dà un'ombra e un volume,
    # che è ciò che distingue una terrazza da un rettangolo vuoto.
    #
    # ⚠️ Il telo è BIANCO col bordo rosso, non rosso pieno: nella prima
    # versione pergola e tre ombrelloni erano quattro lastre rosse della stessa
    # tinta e da fuori la terrazza si leggeva come un mucchio di piani rossi
    # sospesi, senza gerarchia.
    pergola_h = 2.6
    for sx in (-1, 1):
        for sy in (-1, 1):
            kit.box('steel', (0.28, 0.28, pergola_h),
                    (sx * 3.4, 2.2 + sy * 2.0, z0 + pergola_h / 2))
    kit.box('red', (8.0, 5.2, 0.16), (0, 2.2, z0 + pergola_h + 0.08))
    kit.box('white', (7.4, 4.6, 0.22), (0, 2.2, z0 + pergola_h + 0.27 - EPS))

    # Tavolini con ombrellone, verso il fronte: sono quelli che si vedono dalla
    # corsia box. L'asta attraversa il piano del tavolo, non ci poggia sopra.
    for sx in (-1, 0, 1):
        x = sx * 3.6
        y = FRONT + 3.4
        kit.box('white', (1.4, 1.4, 0.85), (x, y, z0 + 0.425))
        kit.box('steel', (0.16, 0.16, 1.7), (x, y, z0 + 1.45))
        kit.box('red', (2.0, 2.0, 0.22), (x, y, z0 + 2.35))

    # Fioriere: due contro i parapetti laterali e due sul fronte, dove si
    # vedono dalla pista assieme ai tavolini.
    for sx in (-1, 1):
        kit.box('leafDark', (1.6, 1.1, 0.75),
                (sx * (HALF_W - 1.4), 1.6, z0 + 0.375))
        kit.box('leafDark', (1.1, 1.6, 0.75),
                (sx * (HALF_W - 1.2), FRONT + 2.0, z0 + 0.375))
    kit.box('white', (6.0, 1.0, 1.15), (0, HALF_D - 1.6, z0 + 0.575))
    kit.box('red', (6.2, 1.2, 0.18), (0, HALF_D - 1.6, z0 + 1.15 + 0.09 - EPS))

    return W + SLAB_OVER * 2, z0 + pergola_h + 0.25


def build_pit_roof_lounge(kit):
    """Salotto vetrato sopra la palazzina uffici: vetrata continua, marcapiano
    dorato, insegna, e una fascia aperta sul fronte con verde e gazebo."""
    z0 = SLAB_H
    _solaio(kit, 'white')

    # Il volume vetrato occupa i due terzi sul retro: davanti resta una fascia
    # praticabile, che è quella che si vede dalla corsia box.
    box_d = D * 0.62
    box_y = HALF_D - box_d / 2 - 0.2
    y_fronte = box_y - box_d / 2
    h_vetro = 3.2

    kit.box('glass', (W - 1.6, box_d, h_vetro), (0, box_y, z0 + h_vetro / 2))
    # Montanti: rompono la vetrata continua, che altrimenti è una lastra sola.
    for i in range(5):
        kit.box('white', (0.34, 0.5, h_vetro),
                ((i - 2) * (W - 1.6) / 5, y_fronte - 0.2, z0 + h_vetro / 2))
    # Spalle piene ai lati del volume vetrato: da fuori dicono che è un piano
    # abitato e non una teca.
    for sx in (-1, 1):
        kit.box('white', (0.5, box_d, h_vetro),
                (sx * ((W - 1.6) / 2 + 0.25), box_y, z0 + h_vetro / 2))

    # Marcapiano dorato subito sotto il tetto: è il segno che dice «qui è la
    # parte cara» da qualunque angolo. Stessa idea della vipSuite.
    kit.box('yellow', (W + 0.5, box_d + 0.8, 0.35), (0, box_y, z0 + h_vetro + 0.175))
    kit.box('white', (W + 0.2, box_d + 0.5, 0.35), (0, box_y, z0 + h_vetro + 0.5))
    # ⚠️ L'insegna sta sulla fascia del TETTO, non sul fronte del volume: là
    # sotto i gazebo la coprivano per intero e non si vedeva da nessuna parte.
    kit.box('yellow', (6.4, 0.3, 0.55),
            (0, box_y - box_d / 2 - 0.32, z0 + h_vetro + 0.5))
    # Parapetto sul tetto: dice che anche la copertura è praticabile, e toglie
    # alla lastra bianca l'aria di coperchio liscio che aveva.
    z_tetto = z0 + h_vetro + 0.675
    for sy in (-1, 1):
        kit.box('white', (W + 0.2, 0.25, 0.5),
                (0, box_y + sy * (box_d + 0.5) / 2, z_tetto + 0.25 - EPS))
    for sx in (-1, 1):
        kit.box('white', (0.25, box_d + 0.1, 0.5),
                (sx * (W + 0.2) / 2, box_y, z_tetto + 0.25 - EPS))

    # La fascia aperta davanti: ringhiera bassa, fioriere, due gazebo.
    # ⚠️ I gazebo stanno AVANTI, sul filo della ringhiera: nella prima versione
    # erano a ridosso della vetrata e da fuori sembravano due tende a sbalzo
    # attaccate al vetro.
    kit.box('white', (W - 0.4, 0.3, 0.9), (0, FRONT + 0.25, z0 + 0.45))
    for sx in (-1, 1):
        kit.box('leafDark', (1.8, 1.2, 0.7), (sx * 5.0, FRONT + 1.2, z0 + 0.35))
        x = sx * 3.0
        kit.box('steel', (0.2, 0.2, 2.3), (x, FRONT + 1.9, z0 + 1.15))
        kit.box('yellow', (2.6, 2.6, 0.3), (x, FRONT + 1.9, z0 + 2.4))

    return W + SLAB_OVER * 2, z_tetto + 0.5


# --- Dove stanno gli spettatori -------------------------------------------
# Stessa idea di infrastructure.terrace_anchors(): le posizioni nascono dalla
# geometria del modello, così non possono divergerne. Coordinate GIOCO relative
# all'origine dell'asset — Blender (x, y, z) -> gioco (x, z, -y) — col pivot
# della figura ai piedi.
#
# ⚠️ Il fronte, che in Blender sta a -D/2, in gioco sta a +D/2: per questo i
# valori qui sotto sono positivi.
def terrace_anchors():
    z_pav = SLAB_H

    # Terrazza: una fila affacciata al parapetto, dove si sta a guardare la
    # pista, più due fra i tavolini.
    #
    # ⚠️ La fila si ferma a x = ±4.2 e non arriva al parapetto laterale: le due
    # fioriere del fronte occupano da 4.4 a 5.5, e una figura piantata lì
    # spunterebbe da dentro una siepe.
    terrazza = []
    for i in range(7):
        terrazza.append({'x': round((i - 3) * 1.4, 3), 'y': round(z_pav, 3),
                         'z': round(HALF_D - 1.1, 3)})
    for sx in (-1, 1):
        terrazza.append({'x': round(sx * 5.0, 3), 'y': round(z_pav, 3),
                         'z': round(HALF_D - 4.6, 3)})

    # Salotto: si sta sulla fascia aperta davanti, non dietro la vetrata.
    #
    # ⚠️ Sotto i gazebo ci si sta (il tettuccio è a 2.65 dal piano e una figura
    # in piedi è alta 2.3), ma NON dentro le fioriere, che stanno da 4.1 a 5.9:
    # per questo la fila si ferma a ±3.2.
    salotto = []
    for i in range(5):
        salotto.append({'x': round((i - 2) * 1.6, 3), 'y': round(z_pav, 3),
                        'z': round(HALF_D - 1.3, 3)})
    return {'pitRoofTerrace': terrazza, 'pitRoofLounge': salotto}
