"""Edifici decorativi lungo la corsia box: garage a serranda chiusa e
palazzina uffici. Non vanno confusi con f1PitBox.glb, che è il box colorato
del giocatore (21.7 x 21 x 9.8 unità) — questi sono scenografia.

Il fronte guarda -Y Blender = +Z gioco.

Nota sulle quote: nessun volume aggettante (zoccolo, pilastri d'angolo,
fasce, tetto) condivide un piano esterno con un altro. Gli sbalzi sono
volutamente tutti diversi (0.2 / 0.25 / 0.3) proprio per evitare facce
complanari — vedi la nota in testa a voxelKit.py.
"""
from voxelKit import EPS

# Larghezza del CORPO. Era 20.0: su una corsia box questi edifici e i box dei
# piloti si alternano sulla STESSA fila, a passo TrackGeometry.PIT_BOX_SPACING
# (15), e larghi 20 si compenetrerebbero. Sono usati solo lungo la corsia,
# quindi la misura non tocca il resto della scenografia.
#
# 12.3: l'ingombro totale e' W + 0.7 (il bordo colorato della terrazza
# dell'ufficio, il pezzo piu' sporgente dei due edifici), quindi 13.0 contro
# un passo di 15. Due unita' di margine e non mezza: sulla corsia box che
# CURVA, due rettangoli affiancati sono anche RUOTATI l'uno rispetto
# all'altro, e gli spigoli si incrociano pur avendo i centri alla distanza
# giusta — misurato su prova e monte-rosso con mezza unita' di margine. E' lo
# stesso fenomeno gia' documentato per gli edifici su baku.
W = 12.3
# Quanto si e' stretto rispetto al disegno originale. Le misure interne
# (serranda, insegne, fascia vetrata, montanti) erano scritte a mano sulla
# larghezza di 20: moltiplicarle per questo fattore le fa rimpicciolire
# INSIEME al corpo. Senza, la fascia vetrata dell'ufficio resterebbe larga
# 18.5 e sporgerebbe di due unita' per lato oltre la facciata.
SX = W / 20.0
D = 14.0
HALF_W = W / 2
HALF_D = D / 2
FRONT = -HALF_D


def _plinth_and_corners(kit, body_h):
    """Zoccolo di base e pilastri d'angolo: danno spessore e articolazione a
    quello che altrimenti è un parallelepipedo liscio."""
    kit.box('concreteDark', (W + 0.4, D + 0.4, 0.6), (0, 0, 0.3))
    for sx in (-1, 1):
        for sy in (-1, 1):
            kit.box('concreteDark', (0.9, 0.9, body_h),
                    (sx * (HALF_W - 0.2), sy * (HALF_D - 0.2), body_h / 2))


def build_pits_garage_closed(kit):
    """Garage chiuso: corpo pieno, serranda a doghe sul fronte, tetto piatto
    aggettante, insegna e finestrature sui fianchi."""
    body_h = 8.0

    kit.box('concrete', (W, D, body_h), (0, 0, body_h / 2))
    _plinth_and_corners(kit, body_h)

    # Serranda incassata nel fronte: affonda di EPS, non appoggia a filo.
    shutter_z0, shutter_h = 0.3, 5.5
    kit.box('steel', (14.0 * SX, 0.4, shutter_h), (0, FRONT - 0.2 + EPS, shutter_z0 + shutter_h / 2))
    for i in range(6):
        kit.box('steelDark', (14.0 * SX, 0.15, 0.25), (0, FRONT - 0.4 + EPS, shutter_z0 + 0.7 + i * 0.9))
    # Architrave sopra la serranda: la chiude in alto invece di lasciarla
    # finire nel nulla sulla parete.
    kit.box('steelDark', (14.8 * SX, 0.3, 0.4), (0, FRONT - 0.25 + EPS, shutter_z0 + shutter_h + 0.2))

    # Insegna: sopra l'architrave, non dietro la serranda — nella prima
    # versione le due quote si sovrapponevano e l'insegna usciva tagliata.
    kit.box('red', (8.0 * SX, 0.3, 1.4), (0, FRONT - 0.15 + EPS, 6.75))

    # Finestrature sui fianchi, in alto: spezzano le due pareti cieche.
    for sx in (-1, 1):
        for y in (-3.5, 0.0, 3.5):
            kit.box('glass', (0.3, 2.6, 1.8), (sx * (HALF_W - 0.05 + EPS), y, 5.6))

    # Tetto: scende dentro il corpo invece di poggiarvi sopra.
    kit.box('concreteDark', (W + 0.6, D + 0.6, 0.8), (0, 0, body_h - 0.1))

    return W + 0.6, body_h + 0.3


def build_pits_office(kit):
    """Palazzina uffici a due livelli: vetrate continue, marcapiano
    aggettante e terrazza praticabile in copertura."""
    body_h = 12.0
    band_z = 5.6

    kit.box('concrete', (W, D, body_h), (0, 0, body_h / 2))
    _plinth_and_corners(kit, body_h)

    # Marcapiano: separa i due livelli e regge l'insegna.
    kit.box('concreteDark', (W + 0.3, D + 0.3, 0.45), (0, 0, band_z))

    # Piano terra: ingresso vetrato al centro, vetrine ai lati.
    kit.box('glass', (4.0 * SX, 0.3, 3.4), (0, FRONT - 0.08 + EPS, 1.9))
    for sx in (-1, 1):
        kit.box('glass', (5.0 * SX, 0.3, 3.0), (sx * 6.5 * SX, FRONT - 0.08 + EPS, 2.6))

    # Piano alto: fascia vetrata continua scandita da montanti. I montanti
    # sporgono solo 0.1: nella prima versione ne sporgevano 0.16 e a render
    # si leggevano come denti staccati dalla facciata.
    kit.box('glass', (18.5 * SX, 0.35, 2.8), (0, FRONT - 0.1 + EPS, 8.4))
    for x in (-7.4 * SX, -3.7 * SX, 0.0, 3.7 * SX, 7.4 * SX):
        kit.box('concreteDark', (0.4, 0.45, 2.8), (x, FRONT - 0.13 + EPS, 8.4))

    kit.box('blue', (7.0 * SX, 0.3, 1.1), (0, FRONT - 0.32 + EPS, band_z))

    # Solaio della terrazza + bordo colorato, affondati nel corpo.
    slab_z = body_h + 0.2
    kit.box('concreteDark', (W + 0.6, D + 0.6, 0.6), (0, 0, slab_z - 0.3))
    kit.box('red', (W + 0.7, 0.25, 0.3), (0, FRONT - 0.45, slab_z - 0.3))

    # Parapetto perimetrale, affondato nel solaio. I tratti frontale e
    # posteriore si fermano dove iniziano i laterali (W + 0.1, non W + 0.6):
    # sovrapporli negli angoli metteva due facce complanari nello stesso
    # punto — z-fighting (trovato da circuitAssetsBlackCheck.py).
    rail_z = slab_z + 0.45 - EPS
    for sy in (-1, 1):
        kit.box('steel', (W + 0.1, 0.25, 0.9), (0, sy * (HALF_D + 0.175), rail_z))
    for sx in (-1, 1):
        kit.box('steel', (0.25, D + 0.6, 0.9), (sx * (HALF_W + 0.175), 0, rail_z))

    return W + 0.6, rail_z + 0.45
