"""Infrastrutture di circuito distribuite lungo il giro: maxischermo, torre
faro, terrazza hospitality, suite VIP.

Spec: docs/superpowers/specs/2026-08-13-f1-infrastrutture-circuito-design.md

Convenzioni (vedi voxelKit.py e docs/f1-notes.md):
  - scala 1:1 in unità di gioco, il fronte guarda -Y Blender = +Z gioco
  - pivot alla base (Z=0) e centrato in XY
  - volumi PIENI fino a terra, mai cavi: ogni fessura mostra il nero interno
  - volumi contigui, mai facce complanari sovrapposte

⚠️ Tre o quattro materiali per asset, non sei. Il tetto di sei è quello duro
di kit.finish(), ma f1.js crea un InstancedMesh per ogni mesh in ogni cella:
a parità di istanze un asset con sei materiali costa il doppio di uno con tre.
Il numero di BOX invece è quasi gratis — il join per colore li fonde in una
mesh sola — quindi il dettaglio si paga in triangoli, non in draw call.
"""
from voxelKit import EPS


# --- Maxischermo ----------------------------------------------------------
# Due gambe a traliccio che reggono uno schermo alto. Deve essere più alto del
# dislivello del viadotto (11.5 su `prova`), se no lo si guarda dall'alto.
SCREEN_W, SCREEN_H = 13.0, 7.6      # luce dello schermo
SCREEN_Z0 = 9.0                     # quota del bordo inferiore dello schermo
LEG_X = 5.6
LEG_W, LEG_D = 1.3, 1.3

# La grafica sullo schermo: una torre dei tempi, cioè due colonne di righe
# "posizione + barra". Astratta di proposito — un disegno figurativo a questa
# risoluzione si legge come un errore da metà delle angolazioni, una torre dei
# tempi no. Lunghezze decrescenti = classifica; i due colori alternati si
# leggono come scuderie diverse.
TIMING_ROWS = 5
TIMING_LEN_SX = (4.5, 4.0, 3.5, 3.1, 2.7)
TIMING_LEN_DX = (2.4, 2.1, 1.9, 1.6, 1.4)
TIMING_COL_SX = ('red', 'white', 'red', 'white', 'white')
TIMING_COL_DX = ('white', 'red', 'white', 'white', 'red')


def build_giant_screen(kit):
    for side in (-1, 1):
        x = side * LEG_X
        # Plinto e gamba: la gamba affonda di EPS nel plinto, che è più largo,
        # quindi le facce non sono complanari.
        kit.box('concreteDark', (LEG_W + 1.2, LEG_D + 1.2, 1.0), (x, 0, 0.5))
        kit.box('steelDark', (LEG_W, LEG_D, SCREEN_Z0 + 0.6), (x, 0, (SCREEN_Z0 + 0.6) / 2))

    # Controventi fra le due gambe: è quello che lo fa leggere come traliccio
    # invece che come due pali.
    #
    # ⚠️ FUORI dal ciclo dei due lati. Dentro, ogni controvento veniva creato
    # DUE VOLTE nello stesso punto: due box perfettamente coincidenti, che
    # sono z-fighting da manuale — 3149 pixel neri al controllo di Blender.
    #
    # Larghi 0.6 più della luce fra le gambe, così affondano DENTRO le gambe
    # invece di finire a filo: due facce esattamente complanari sfarfallano
    # anche quando appartengono alla stessa mesh.
    for i in range(3):
        z = 2.2 + i * 2.4
        kit.box('steelDark', (LEG_X * 2 - LEG_W + 0.6, 0.5, 0.4), (0, 0, z))

    # Cassa dello schermo: telaio scuro pieno, faccia luminosa incassata di
    # EPS sul davanti (-Y) così non è complanare col telaio.
    frame_d = 1.6
    kit.box('steelDark', (SCREEN_W + 1.4, frame_d, SCREEN_H + 1.4),
            (0, 0, SCREEN_Z0 + SCREEN_H / 2))
    vetro_y = -frame_d / 2 - 0.15 + EPS
    kit.box('glass', (SCREEN_W, 0.3, SCREEN_H), (0, vetro_y, SCREEN_Z0 + SCREEN_H / 2))

    # La grafica sta DAVANTI al vetro, affondata di EPS: un pannello appoggiato
    # a filo sfarfalla, e su una superficie grande come questa si vedrebbe da
    # tutto il rettilineo.
    y_disegno = vetro_y - 0.15 - 0.07 + EPS
    z_alto = SCREEN_Z0 + SCREEN_H - 0.55        # margine interno dello schermo
    passo = 1.3
    for r in range(TIMING_ROWS):
        z = z_alto - 0.39 - r * passo
        for x0, lunghezze, colori in ((-5.95, TIMING_LEN_SX, TIMING_COL_SX),
                                      (0.20, TIMING_LEN_DX, TIMING_COL_DX)):
            # Casella della posizione, sempre chiara: è l'ancora visiva della
            # riga, e resta distinta anche quando la barra accanto è bianca
            # perché fra le due c'è 0.3 di fondo azzurro.
            kit.box('white', (0.8, 0.14, 0.78), (x0 + 0.4, y_disegno, z))
            lung = lunghezze[r]
            kit.box(colori[r], (lung, 0.14, 0.78), (x0 + 1.1 + lung / 2, y_disegno, z))

    # Fascia sponsor sotto lo schermo e cornice superiore.
    kit.box('white', (SCREEN_W, 0.25, 1.1),
            (0, -frame_d / 2 - 0.12 + EPS, SCREEN_Z0 - 0.8))
    kit.box('steelDark', (SCREEN_W + 2.0, frame_d + 0.4, 0.6),
            (0, 0, SCREEN_Z0 + SCREEN_H + 1.0))

    return SCREEN_W + 2.0, SCREEN_Z0 + SCREEN_H + 1.3


# --- Torre faro -----------------------------------------------------------
# Sottile e alta: entra dove non entra nient'altro, e a 30 unità si vede da
# sopra il viadotto. È l'unica risposta ai tratti sopraelevati.
TOWER_H = 27.0
TOWER_W0, TOWER_W1 = 2.6, 1.5       # base e cima del fusto rastremato
LAMP_ROWS, LAMP_COLS = 2, 5


def build_floodlight_tower(kit):
    kit.box('concreteDark', (4.0, 4.0, 1.0), (0, 0, 0.5))
    # Fusto a tronchi rastremati: quattro segmenti che si assottigliano, con
    # accanto la scala di servizio. La scala segue il fusto segmento per
    # segmento perché il fusto si stringe salendo: una gabbia dritta o si
    # stacca in cima o sparisce dentro il fusto in basso.
    seg = TOWER_H / 4
    for i in range(4):
        t = i / 4.0
        w = TOWER_W0 + (TOWER_W1 - TOWER_W0) * t
        z_c = 0.9 + seg / 2 + i * seg
        kit.box('steel', (w, w, seg + EPS), (0, 0, z_c))
        # Larghezza che cala di poco a ogni segmento: due segmenti sovrapposti
        # in Z con la STESSA estensione in X condividerebbero il piano esterno,
        # che è la ricetta dello z-fighting.
        kit.box('steelDark', (0.95 - i * 0.05, 0.5, seg + EPS), (0, w / 2 + 0.20, z_c))
        for k in range(3):
            z_p = 0.9 + i * seg + 1.6 + k * 2.2
            kit.box('steelDark', (1.2, 0.16, 0.16), (0, w / 2 + 0.20, z_p))

    # Piattine sui fianchi: danno la trama di traliccio al fusto liscio.
    for i in range(6):
        z = 3.0 + i * 3.6
        kit.box('steelDark', (TOWER_W0 + 0.5, 0.3, 0.35), (0, 0, z))

    top = 0.9 + TOWER_H

    # Ballatoio di servizio sotto la testata, con i suoi due puntoni obliqui.
    # È il pezzo che mancava perché la testata sembrasse appoggiata a
    # qualcosa: prima i fari uscivano dal nulla in cima a un palo.
    z_ball = top - 2.0
    kit.box('steel', (5.0, 3.2, 0.3), (0, 0, z_ball))
    for sx in (-1, 1):
        kit.box('steelDark', (5.0, 0.2, 0.9), (0, sx * 1.5, z_ball + 0.6))
        kit.box('steelDark', (0.2, 3.0, 0.9), (sx * 2.4, 0, z_ball + 0.6))
        # Puntone a 45°: parte dal fusto e arriva sotto il piano del ballatoio.
        kit.box('steelDark', (2.5, 0.3, 0.3), (sx * 1.45, 0, z_ball - 1.0),
                rot=(0, -sx * 0.7854, 0))

    # Testata: piastra, TELAIO portante e batteria di fari montata sopra.
    #
    # ⚠️ Il difetto trovato al primo giudizio dell'utente stava qui: la fila
    # superiore di lampade galleggiava a 25 centimetri dal nulla, perché
    # l'unica struttura era una piastra alta 0.7 e le lampade salivano oltre.
    # Ora il telaio le contiene entrambe.
    kit.box('steelDark', (7.4, 2.6, 0.7), (0, 0, top + 0.35))
    kit.box('steelDark', (7.0, 0.7, 3.6), (0, 0.35, top + 2.3))
    kit.box('steelDark', (7.6, 1.1, 0.5), (0, 0.2, top + 4.1 + 0.25 - EPS))
    for r in range(LAMP_ROWS):
        for c in range(LAMP_COLS):
            x = (c - (LAMP_COLS - 1) / 2) * 1.35
            z = top + 1.35 + r * 1.5
            # Affondate di 0.1 nel telaio: appoggiate a filo sfarfallerebbero.
            kit.box('white', (1.05, 0.9, 1.15), (x, -0.35, z))

    return 7.6, top + 4.6


# --- Terrazza hospitality -------------------------------------------------
# Pedana rialzata su pilastri con tetto piano e ringhiera. È il pezzo che
# risolve il problema strutturale: singolo, quindi entra in curva dove una
# fila rigida di tribune non entra.
DECK_W, DECK_D = 15.0, 10.0
DECK_Z = 4.6                        # quota del piano calpestabile
DECK_RAIL = 1.2
ROOF_Z = DECK_Z + 4.4


def _deck_common(kit, mat_parete, mat_tetto, mat_struttura='concrete',
                 chiudi_fianchi=False):
    """Impianto condiviso da terrazza e suite VIP: basamento, pilastri,
    pedana, tetto, scala. Le due varianti cambiano i tamponamenti e i
    dettagli, così la suite è davvero una variante di lusso e non un modello
    scollegato."""
    # Corpo di servizio chiuso sul retro. Sotto la pedana c'erano solo quattro
    # pilastri e quattro metri e mezzo di aria: è da lì che veniva metà del
    # "sembra spoglio". Occupa il 55% della profondità e lascia il fronte a
    # portico, così i pilastri si vedono ancora dalla pista.
    base_d = DECK_D * 0.55
    kit.box(mat_struttura, (DECK_W - 1.4, base_d, DECK_Z + EPS),
            (0, DECK_D / 2 - base_d / 2 - 0.7, (DECK_Z + EPS) / 2))
    # Pilastri d'angolo, pieni fino a terra.
    for sx in (-1, 1):
        for sy in (-1, 1):
            kit.box(mat_struttura, (1.5, 1.5, DECK_Z + EPS),
                    (sx * (DECK_W / 2 - 1.1), sy * (DECK_D / 2 - 1.1), (DECK_Z + EPS) / 2))
    # Pedana: sporge oltre i pilastri, quindi le facce non sono complanari.
    kit.box(mat_struttura, (DECK_W, DECK_D, 0.8), (0, 0, DECK_Z + 0.4))
    # Tetto piano su quattro montanti agli angoli della pedana.
    for sx in (-1, 1):
        for sy in (-1, 1):
            kit.box('steel', (0.55, 0.55, ROOF_Z - DECK_Z - 0.8),
                    (sx * (DECK_W / 2 - 0.7), sy * (DECK_D / 2 - 0.7),
                     DECK_Z + 0.8 + (ROOF_Z - DECK_Z - 0.8) / 2))
    kit.box(mat_tetto, (DECK_W + 1.0, DECK_D + 1.0, 0.7), (0, 0, ROOF_Z + 0.35))
    # Parete di fondo (lato opposto alla pista): chiude la vista sul retro.
    kit.box(mat_parete, (DECK_W - 1.0, 0.5, ROOF_Z - DECK_Z - 0.9),
            (0, DECK_D / 2 - 0.5, DECK_Z + 0.8 + (ROOF_Z - DECK_Z - 0.9) / 2))
    # Fianchi: chiusi solo per la suite. La terrazza li lascia aperti perché
    # è una tribuna coperta, la suite no — da lì si vedeva dentro una scatola
    # vuota.
    if chiudi_fianchi:
        for sx in (-1, 1):
            kit.box(mat_parete, (0.5, DECK_D - 1.2, ROOF_Z - DECK_Z - 0.9),
                    (sx * (DECK_W / 2 - 0.45), -0.1,
                     DECK_Z + 0.8 + (ROOF_Z - DECK_Z - 0.9) / 2))

    # Ingresso a TERRA, sul retro del corpo di servizio: si entra sotto e si
    # sale internamente. Niente scala esterna — la prima versione ne aveva una
    # sul retro, e la porta in cima era sepolta dentro la parete di fondo:
    # sporgeva di 2 cm dalla faccia interna, cioè affacciava sulla terrazza
    # invece che sulla scala. Sei gradini che non portavano da nessuna parte.
    #
    # La faccia posteriore del basamento sta a (centro + base_d/2), cioè a
    # DECK_D/2 - 0.7: la porta ci sporge davanti di mezzo spessore meno EPS,
    # così affonda nel muro invece di essere complanare.
    kit.box('steel', (1.8, 0.3, 2.4), (0, DECK_D / 2 - 0.7 + 0.15 - EPS, 1.2))


def build_hospitality_deck(kit):
    # Tetto rosso: era l'unico pezzo abbastanza grande da dare un colore
    # all'oggetto, che prima era cemento-bianco-acciaio, cioè tre chiari.
    _deck_common(kit, 'concrete', 'red')
    z_pav = DECK_Z + 0.8

    # Parapetto PIENO invece dei montanti sottili: da lontano una fila di
    # stecchini non si legge, un pannello sì — ed è dove va la banda di colore.
    y_front = -DECK_D / 2 + 0.3
    kit.box('white', (DECK_W - 0.6, 0.4, DECK_RAIL), (0, y_front, z_pav + DECK_RAIL / 2))
    kit.box('red', (DECK_W - 0.4, 0.5, 0.28), (0, y_front, z_pav + DECK_RAIL + 0.14 - EPS))
    for sx in (-1, 1):
        x = sx * (DECK_W / 2 - 0.3)
        kit.box('white', (0.4, DECK_D - 1.4, DECK_RAIL), (x, -0.35, z_pav + DECK_RAIL / 2))
        kit.box('red', (0.5, DECK_D - 1.2, 0.28), (x, -0.35, z_pav + DECK_RAIL + 0.14 - EPS))

    # Arredo: tavolini con le loro sedie e un bancone lungo la parete di
    # fondo. È ciò che la fa leggere come terrazza e non come pensilina vuota.
    for sx in (-1, 0, 1):
        for sy in (-1, 1):
            x, y = sx * 4.2, sy * 1.9
            kit.box('white', (1.5, 1.5, 0.9), (x, y, z_pav + 0.45))
            for dx in (-1.35, 1.35):
                kit.box('red', (0.7, 0.7, 0.6), (x + dx, y, z_pav + 0.3))
                kit.box('red', (0.7, 0.22, 0.55), (x + dx, y + 0.32, z_pav + 0.85))
    kit.box('white', (9.0, 1.1, 1.15), (0, DECK_D / 2 - 1.4, z_pav + 0.575))
    kit.box('red', (9.2, 1.3, 0.18), (0, DECK_D / 2 - 1.4, z_pav + 1.15 + 0.09 - EPS))
    # Fascia insegna sul bordo del tetto, verso la pista.
    kit.box('white', (DECK_W - 2.0, 0.35, 0.8), (0, -DECK_D / 2 - 0.35, ROOF_Z + 0.1))

    return DECK_W + 1.0, ROOF_Z + 0.7


# --- Suite VIP ------------------------------------------------------------
# Stesso impianto, architettura di lusso: vetrata continua sul fronte, fianchi
# chiusi, marcapiano dorato, terrazza sul tetto con verde e gazebo.
def build_vip_suite(kit):
    # Struttura bianca invece che in cemento: costa un materiale in meno
    # (serve al giallo del marcapiano) e un edificio tutto chiaro con gli
    # accenti dorati si legge come lusso, un basamento grigio no.
    _deck_common(kit, 'white', 'white', mat_struttura='white', chiudi_fianchi=True)
    z_pav = DECK_Z + 0.8
    h_vetro = ROOF_Z - DECK_Z - 1.4

    # Vetrata continua sul fronte, incassata rispetto alla pedana.
    y_front = -DECK_D / 2 + 0.35
    kit.box('glass', (DECK_W - 1.2, 0.35, h_vetro), (0, y_front, z_pav + h_vetro / 2))
    for i in range(5):
        x = (i - 2) * (DECK_W / 5)
        kit.box('steel', (0.3, 0.5, h_vetro), (x, y_front - 0.28, z_pav + h_vetro / 2))
    # Finestra a nastro sui fianchi: da fuori dice che dentro c'è un piano
    # abitato, e rompe le due pareti cieche che i fianchi chiusi creano.
    for sx in (-1, 1):
        kit.box('glass', (0.35, DECK_D - 3.0, h_vetro - 1.2),
                (sx * (DECK_W / 2 - 0.28), -0.1, z_pav + 0.4 + (h_vetro - 1.2) / 2))

    # Marcapiano dorato che gira su tutto il perimetro, subito sotto il tetto:
    # è il segno che dichiara "qui è la parte cara" da qualunque angolo.
    kit.box('yellow', (DECK_W + 1.3, DECK_D + 1.3, 0.4), (0, 0, ROOF_Z - 0.2))
    # Pensilina d'ingresso a sbalzo sul fronte, all'altezza del portico.
    kit.box('yellow', (7.0, 2.6, 0.35), (0, -DECK_D / 2 - 0.6, DECK_Z - 0.9))
    for sx in (-1, 1):
        kit.box('steel', (0.25, 0.25, DECK_Z - 1.1),
                (sx * 3.2, -DECK_D / 2 - 1.6, (DECK_Z - 1.1) / 2))

    # Terrazza sul tetto: parapetto, verde e due gazebo.
    z_tetto = ROOF_Z + 0.7
    for sy in (-1, 1):
        kit.box('white', (DECK_W + 1.0, 0.35, 0.9), (0, sy * (DECK_D / 2 + 0.3), z_tetto + 0.45))
    for sx in (-1, 1):
        kit.box('white', (0.35, DECK_D + 1.0, 0.9), (sx * (DECK_W / 2 + 0.3), 0, z_tetto + 0.45))
    for i in range(4):
        x = (i - 1.5) * 3.2
        kit.box('leafDark', (2.0, 1.6, 0.8), (x, 1.9, z_tetto + 0.4))
    for sx in (-1, 1):
        x = sx * 3.6
        kit.box('steel', (0.22, 0.22, 2.1), (x, -1.6, z_tetto + 1.05))
        kit.box('yellow', (3.4, 3.4, 0.3), (x, -1.6, z_tetto + 2.25))
        kit.box('white', (1.3, 1.3, 0.8), (x, -1.6, z_tetto + 0.4))
    # Insegna dorata sul fronte del tetto.
    kit.box('yellow', (7.4, 0.35, 1.5), (0, -DECK_D / 2 - 0.25, z_tetto + 0.75))

    return DECK_W + 1.6, z_tetto + 2.4
