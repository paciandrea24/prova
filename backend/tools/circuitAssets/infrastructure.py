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
import math

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


# --- Torre servizi / cronometraggio ---------------------------------------
# Un volume vero, di quelli che spezzano una fila di alberi su un tratto
# dritto lontano dal traguardo. Tre piani di finestre a nastro, terrazzo di
# osservazione sul fronte, impianti sul tetto.
SB_W, SB_D = 13.6, 10.4
SB_BASE = 4.2                       # sommità del basamento
SB_TOP = 12.2                       # sommità del corpo
SB_PIANI = (5.6, 8.4, 11.2)         # quota delle tre fasce finestrate


def build_service_building(kit):
    # Basamento pieno, più largo del corpo: le facce non sono complanari e
    # l'edificio si appoggia a terra invece di nascerci dentro.
    kit.box('concrete', (SB_W, SB_D, SB_BASE + EPS), (0, 0, (SB_BASE + EPS) / 2))
    # Serrande dei box di servizio sul fronte, a terra.
    for sx in (-1, 0, 1):
        kit.box('steelDark', (2.8, 0.3, 2.9), (sx * 4.1, -SB_D / 2 - 0.15 + EPS, 1.45))

    corpo_w, corpo_d = SB_W - 1.2, SB_D - 1.2
    kit.box('white', (corpo_w, corpo_d, SB_TOP - SB_BASE),
            (0, 0, (SB_BASE + SB_TOP) / 2))

    # Marcapiani: fasce che sporgono oltre il corpo e segnano i solai. Sono il
    # dettaglio che a distanza fa leggere "tre piani" invece di "scatolone".
    for z in (SB_BASE, SB_BASE + 2.8, SB_BASE + 5.6):
        kit.box('concrete', (SB_W - 0.6, SB_D - 0.6, 0.35), (0, 0, z))

    # Finestre a nastro sporgenti sul fronte e sui due fianchi.
    for z in SB_PIANI:
        kit.box('glass', (corpo_w - 1.6, 0.3, 1.5), (0, -corpo_d / 2 - 0.15 + EPS, z))
        for sx in (-1, 1):
            kit.box('glass', (0.3, corpo_d - 2.6, 1.5),
                    (sx * (corpo_w / 2 + 0.15 - EPS), 0, z))

    # Terrazzo di osservazione all'ultimo piano, con le sue mensole: uno
    # sbalzo senza niente sotto è la stessa cosa che ha fatto galleggiare i
    # fari della torre.
    z_terr = SB_PIANI[2] - 1.5
    for sx in (-1, 0, 1):
        kit.box('concrete', (0.5, 2.0, 0.55), (sx * 3.8, -corpo_d / 2 - 1.0, z_terr - 0.3))
    kit.box('concrete', (10.4, 2.3, 0.35), (0, -corpo_d / 2 - 1.05, z_terr))
    kit.box('white', (10.4, 0.35, 1.0), (0, -corpo_d / 2 - 2.05, z_terr + 0.68))
    kit.box('red', (10.6, 0.5, 0.3), (0, -corpo_d / 2 - 2.05, z_terr + 1.18 - EPS))

    # Cornicione, parapetto del tetto e impianti.
    kit.box('concrete', (SB_W, SB_D, 0.7), (0, 0, SB_TOP + 0.35))
    for sy in (-1, 1):
        kit.box('white', (SB_W - 0.4, 0.35, 0.9), (0, sy * (SB_D / 2 - 0.3), SB_TOP + 1.15))
    for sx in (-1, 1):
        kit.box('white', (0.35, SB_D - 0.4, 0.9), (sx * (SB_W / 2 - 0.3), 0, SB_TOP + 1.15))
    kit.box('concrete', (5.2, 4.2, 1.8), (0, 1.6, SB_TOP + 1.6))
    for sx in (-1, 1):
        kit.box('steelDark', (0.28, 0.28, 3.2), (sx * 4.4, 2.6, SB_TOP + 2.3))
    # Insegna sul fronte, sotto il cornicione.
    kit.box('red', (SB_W - 4.6, 0.35, 1.2), (0, -corpo_d / 2 - 0.16, SB_TOP - 0.9))

    return SB_W, SB_TOP + 3.9


# --- Torretta TV ----------------------------------------------------------
# Traliccio a quattro gambe con la cabina di ripresa in cima. Va all'esterno
# curva, dove inquadra l'ingresso: stretta, entra dove non entra altro.
TV_LEG = 1.55                       # semipasso delle gambe
TV_H = 9.6                          # quota del piano della cabina


def build_tv_tower(kit):
    kit.box('concrete', (4.4, 4.4, 0.9), (0, 0, 0.45))
    for sx in (-1, 1):
        for sy in (-1, 1):
            kit.box('steel', (0.42, 0.42, TV_H), (sx * TV_LEG, sy * TV_LEG, 0.6 + TV_H / 2))

    # Traverse su tutti e quattro i lati, a tre quote.
    for z in (2.4, 5.0, 7.6):
        for sy in (-1, 1):
            kit.box('steel', (TV_LEG * 2, 0.24, 0.24), (0, sy * TV_LEG, z))
        for sx in (-1, 1):
            kit.box('steel', (0.24, TV_LEG * 2, 0.24), (sx * TV_LEG, 0, z))
    # Croci di controvento sui due fianchi: 40°, calcolati sulla campata reale
    # (3.1 di luce, 2.6 di salita) e non a occhio.
    ang = math.atan2(2.6, TV_LEG * 2)
    lung = math.hypot(TV_LEG * 2, 2.6)
    for i, z in enumerate((3.7, 6.3)):
        for sy in (-1, 1):
            verso = 1 if (i + (sy > 0)) % 2 == 0 else -1
            kit.box('steel', (lung, 0.2, 0.2), (0, sy * TV_LEG, z),
                    rot=(0, -verso * ang, 0))

    # Piano della cabina: sporge oltre la cabina e fa da ballatoio, con la sua
    # ringhiera. La cabina ci poggia sopra, non ci galleggia.
    z_piano = 0.6 + TV_H
    kit.box('steel', (4.6, 4.6, 0.32), (0, 0, z_piano + 0.16))
    kit.box('red', (4.8, 4.8, 0.22), (0, 0, z_piano + 0.32 - EPS))
    for sy in (-1, 1):
        kit.box('steel', (4.6, 0.16, 0.85), (0, sy * 2.2, z_piano + 0.75))
    for sx in (-1, 1):
        kit.box('steel', (0.16, 4.6, 0.85), (sx * 2.2, 0, z_piano + 0.75))

    kit.box('white', (3.4, 3.4, 2.5), (0, 0, z_piano + 0.32 + 1.25))
    z_cab = z_piano + 0.32
    kit.box('glass', (2.9, 0.3, 1.5), (0, -1.7 - 0.15 + EPS, z_cab + 1.5))
    for sx in (-1, 1):
        kit.box('glass', (0.3, 2.2, 1.3), (sx * (1.7 + 0.15 - EPS), 0.2, z_cab + 1.5))
    kit.box('white', (4.0, 4.0, 0.35), (0, 0, z_cab + 2.5 + 0.175 - EPS))
    # Telecamera sul davanti, con il suo braccio: sporge dal ballatoio.
    kit.box('steel', (0.7, 1.1, 0.62), (0, -2.1, z_cab + 1.1))
    kit.box('steel', (0.42, 0.5, 0.42), (0, -2.75, z_cab + 1.1))
    # Antenna e lampada di segnalazione in cima.
    kit.box('steel', (0.22, 0.22, 2.2), (1.2, 1.2, z_cab + 3.6))
    kit.box('red', (0.42, 0.42, 0.5), (0, 0, z_cab + 2.9))

    return 4.8, z_cab + 4.7


# --- Gru di recupero ------------------------------------------------------
# Gialla, col braccio teso verso la pista: sta all'esterno curva dietro le
# gomme, dov'è il suo posto anche nella realtà.
CRANE_ANG = math.radians(50)        # inclinazione del braccio sull'orizzontale
CRANE_BOOM = 13.5


def build_recovery_crane(kit):
    # Cingoli a terra e carro sopra di essi.
    for sx in (-1, 1):
        kit.box('steelDark', (1.7, 8.4, 1.5), (sx * 2.3, 0.4, 0.75))
    kit.box('yellow', (5.6, 8.0, 1.8), (0, 0.4, 1.6))
    # Stabilizzatori: braccio orizzontale dal carro e piede appoggiato a terra.
    for sx in (-1, 1):
        for sy in (-1, 1):
            kit.box('steelDark', (2.4, 0.7, 0.45), (sx * 3.6, 0.4 + sy * 2.6, 1.9))
            kit.box('yellow', (1.3, 1.3, 1.9), (sx * 4.5, 0.4 + sy * 2.6, 0.95))

    # Torretta girevole, cabina di manovra e contrappeso.
    kit.box('yellow', (4.6, 5.0, 2.6), (0, 0.8, 3.6))
    # Contrappeso: affonda di 0.15 nel carro e si ferma 0.2 sotto il cielo
    # della torretta. ⚠️ Nella prima versione era alto 2.4 centrato a 3.7,
    # cioè poggiava ESATTAMENTE sul cielo del carro (2.5) e finiva esattamente
    # alla quota della torretta (4.9): due facce complanari fra un volume nero
    # e uno giallo, che è il bagliore che l'utente ha visto sul retro. Il
    # controllo dei pixel scuri non poteva pescarlo — nessuno dei due colori
    # è scuro abbastanza da contare.
    kit.box('steelDark', (4.2, 1.6, 2.35), (0, 3.4, 3.525))
    kit.box('yellow', (2.2, 2.6, 2.5), (-1.5, -1.6, 4.05))
    kit.box('glass', (1.8, 0.3, 1.5), (-1.5, -1.6 - 1.3 - 0.15 + EPS, 4.3))
    kit.box('red', (0.45, 0.45, 0.5), (-1.5, -1.6, 5.5))

    # Braccio: parte DENTRO la torretta e sale verso la pista (-Y). Il perno a
    # 4.4 sta sotto il cielo della torretta (4.9), così il box ci affonda
    # dentro invece di spuntarne fuori sospeso.
    dy, dz = -math.cos(CRANE_ANG), math.sin(CRANE_ANG)
    px, py, pz = 0.0, 1.2, 4.4
    cy, cz = py + dy * CRANE_BOOM / 2, pz + dz * CRANE_BOOM / 2
    kit.box('yellow', (1.0, CRANE_BOOM, 0.85), (px, cy, cz),
            rot=(math.pi - CRANE_ANG, 0, 0))
    # Puntone di sostegno, dalla spalla della torretta al primo terzo del
    # braccio. ⚠️ La prima versione aveva un angolo scritto a mano e puntava
    # ALL'INDIETRO: finiva a 2.8 unità dal braccio, sospeso nel vuoto. Qui i
    # due estremi sono calcolati, e l'inclinazione discende da loro.
    ay, az = 2.6, 4.6                       # spalla della torretta
    by, bz = py + dy * 4.5, pz + dz * 4.5   # punto d'attacco sul braccio
    kit.box('steelDark', (0.45, math.hypot(by - ay, bz - az), 0.45),
            (0, (ay + by) / 2, (az + bz) / 2),
            rot=(math.atan2(bz - az, by - ay), 0, 0))

    # Fune e gancio, appesi alla punta.
    ty, tz = py + dy * CRANE_BOOM, pz + dz * CRANE_BOOM
    kit.box('steelDark', (0.14, 0.14, 5.2), (0, ty + 0.2, tz - 2.7))
    kit.box('steelDark', (0.55, 0.55, 0.7), (0, ty + 0.2, tz - 5.2))

    return 9.0, tz + 0.6


# --- Varco nella barriera -------------------------------------------------
# Cancello a rete per l'accesso in pista dei mezzi di servizio. Basso: il
# modulo non lo mette mai accanto al viadotto, da lì lo si guarderebbe dal
# tetto. Stessa maglia del catchFence, così i due si somigliano.
GATE_X = 3.9                        # asse dei montanti
GATE_H = 4.4


def build_track_gate(kit):
    for sx in (-1, 1):
        kit.box('concrete', (1.5, 1.5, 0.85), (sx * GATE_X, 0, 0.425))
        kit.box('steelDark', (0.65, 0.65, GATE_H), (sx * GATE_X, 0, GATE_H / 2))
        # Fasce di segnalazione sul montante, come i cordoli.
        for i, mat in enumerate(('red', 'white', 'red')):
            kit.box(mat, (0.78, 0.78, 0.5), (sx * GATE_X, 0, 1.3 + i * 0.9))
    kit.box('steelDark', (GATE_X * 2 + 0.8, 0.55, 0.55), (0, 0, GATE_H - 0.2))

    # Anta: cornice piena e maglia rada dentro. Le barre si fermano PRIMA del
    # filo della cornice, se no condividono con essa il piano esterno.
    z0, z1 = 0.95, 3.75
    kit.box('steel', (GATE_X * 2 - 0.5, 0.3, 0.26), (0, 0, z0))
    kit.box('steel', (GATE_X * 2 - 0.5, 0.3, 0.26), (0, 0, z1))
    for sx in (-1, 1):
        # 0.34 e non 0.3: alla stessa profondità delle traverse i due volumi
        # si compenetrerebbero condividendo le facce a y = ±0.15, ed è la
        # ricetta esatta dello z-fighting (8 px scuri al controllo, contro gli
        # 0 del catchFence che ha la stessa maglia).
        kit.box('steel', (0.3, 0.34, z1 - z0), (sx * (GATE_X - 0.4), 0, (z0 + z1) / 2))
    for i in range(13):
        x = (i - 6) * 0.55
        kit.box('steel', (0.1, 0.16, z1 - z0 - 0.3), (x, 0, (z0 + z1) / 2))
    for z in (1.9, 2.85):
        kit.box('steel', (GATE_X * 2 - 1.1, 0.14, 0.1), (0, 0, z))
    # Cartello sopra la traversa.
    kit.box('white', (2.4, 0.22, 0.95), (0, -0.2, GATE_H + 0.35))
    kit.box('red', (1.6, 0.16, 0.3), (0, -0.32 + EPS, GATE_H + 0.35))

    return GATE_X * 2 + 0.8, GATE_H + 0.85
