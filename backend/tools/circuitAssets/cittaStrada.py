"""L'arredo urbano del marciapiede, per i circuiti cittadini.

Fra la barriera e la prima facciata ci sono ventiquattro unita' di asfalto
liscio su tutto il giro: e' la strada, e in una citta' vera non e' mai vuota.
Qui ci vanno lampioni, semafori, fermate, edicole, cassonetti e tavolini —
gli oggetti che si riconoscono a colpo d'occhio anche a 250 km/h.

Stesse convenzioni di tutti gli asset del circuito (vedi voxelKit.py):
unita' di gioco, base a Z=0, centrato su X=0/Y=0, il FRONTE guarda -Y Blender
(= +Z gioco). Rif. docs/superpowers/specs/2026-08-27-f1-citta-g2-design.md

⚠️ Il fronte, per questi, e' il lato che guarda la PISTA: chi posa questi
oggetti li orienta come le facciate, e una fermata dell'autobus girata verso il
muro non aspetta nessun autobus.
"""
import math

from voxelKit import EPS


def build_citta_lampione(kit):
    """Lampione stradale: palo, braccio curvo sopra la strada, corpo luce."""
    kit.box('steelDark', (0.9, 0.9, 0.5), (0, 0, 0.25))          # plinto
    kit.cyl('steel', 0.16, 8.4, (0, 0, 4.3), axis='Z', verts=8)
    # Il braccio, fatto a gradini invece che curvo: e' lo stile voxel del
    # progetto, e a distanza legge come una curva.
    for i, (dy, dz) in enumerate(((0.35, 8.55), (0.85, 8.85), (1.5, 9.0))):
        kit.cyl('steel', 0.13, 0.9 + i * 0.35, (0, -dy, dz), axis='Y', verts=6)
    kit.box('steel', (0.36, 1.5, 0.22), (0, -1.55, 8.95))
    kit.box('yellow', (0.5, 1.3, 0.26), (0, -1.9, 8.74))         # la lampada
    kit.box('steelDark', (0.6, 1.5, 0.18), (0, -1.9, 8.95))      # il coperchio
    return 4.0, 9.1


def build_citta_semaforo(kit):
    """Semaforo pedonale: palo, testata a tre luci, pulsantiera."""
    kit.box('steelDark', (0.8, 0.8, 0.4), (0, 0, 0.2))
    kit.cyl('steelDark', 0.14, 5.6, (0, 0, 2.9), axis='Z', verts=8)
    corpo_z = 5.2
    kit.box('black', (0.62, 0.5, 1.9), (0, -0.16, corpo_z))
    for colore, dz in (('red', 0.6), ('yellow', 0.0), ('green', -0.6)):
        kit.box(colore, (0.34, 0.2, 0.34), (0, -0.44 + EPS, corpo_z + dz))
    kit.box('steelDark', (0.7, 0.34, 0.14), (0, -0.3, corpo_z + 1.03))   # visiera
    kit.box('steel', (0.3, 0.24, 0.5), (0, -0.22, 2.2))                  # pulsantiera
    return 1.2, 6.3


def build_citta_fermata(kit):
    """Fermata dell'autobus: pensilina, panchina, pannello degli orari."""
    W, D, H = 6.4, 2.6, 3.2
    for sx in (-1, 1):
        kit.cyl('steel', 0.12, H, (sx * (W / 2 - 0.3), D / 2 - 0.3, H / 2), axis='Z', verts=6)
    # Il fondo e' il lato verso il MURO: chi aspetta guarda la strada.
    kit.box('glass', (W - 0.5, 0.16, H - 0.9), (0, D / 2 - 0.2, (H - 0.9) / 2 + 0.4))
    kit.box('steelDark', (W + 0.5, D + 0.4, 0.22), (0, 0, H))            # tettoia
    kit.box('steel', (W + 0.6, D + 0.5, 0.1), (0, 0, H + 0.16))
    # Panchina: seduta e schienale bassi, appoggiati al vetro.
    kit.box('bark', (W - 1.6, 0.55, 0.16), (0, D / 2 - 0.55, 0.95))
    kit.box('steelDark', (W - 1.6, 0.12, 0.5), (0, D / 2 - 0.28, 1.28))
    for sx in (-1, 1):
        kit.box('steelDark', (0.14, 0.5, 0.9), (sx * (W / 2 - 1.0), D / 2 - 0.55, 0.45))
    # Pannello degli orari, illuminato: e' il pezzo che si legge da lontano.
    kit.box('steelDark', (1.5, 0.3, 2.2), (W / 2 - 0.1, D / 2 - 0.35, 1.5))
    kit.box('white', (1.2, 0.12, 1.8), (W / 2 - 0.1, D / 2 - 0.52 - EPS, 1.6))
    return W + 0.6, H + 0.3


def build_citta_edicola(kit):
    """Chiosco dei giornali: corpo, vetrina, tetto aggettante, insegna."""
    W, D, H = 3.4, 2.8, 3.3
    kit.box('steelDark', (W + 0.3, D + 0.3, 0.35), (0, 0, 0.17))
    kit.box('green', (W, D, H), (0, 0, H / 2 + 0.2))
    # Vetrina con i giornali esposti sul fronte e sul fianco.
    kit.box('glass', (W - 0.7, 0.24, 1.7), (0, -D / 2 - 0.02, 2.1))
    kit.box('white', (W - 1.0, 0.14, 1.3), (0, -D / 2 - 0.16, 2.05))
    kit.box('glass', (0.22, D - 1.0, 1.5), (-W / 2 - 0.02, 0.1, 2.1))
    # Il bancone sporgente, dove si appoggiano le riviste.
    kit.box('bark', (W + 0.4, 0.7, 0.16), (0, -D / 2 - 0.3, 1.2))
    # Tetto e insegna.
    kit.box('steelDark', (W + 0.9, D + 0.9, 0.3), (0, 0, H + 0.35))
    kit.box('red', (W + 0.2, 0.24, 0.7), (0, -D / 2 - 0.42, H + 0.05))
    return W + 0.9, H + 0.5


def build_citta_cassonetti(kit):
    """Tre cassonetti in fila: il dettaglio che dice «questa e' una via»."""
    larghezza = 0.0
    for i, colore in enumerate(('green', 'blue', 'yellow')):
        x = (i - 1) * 1.85
        kit.box('steelDark', (1.6, 1.2, 0.3), (x, 0, 0.15))       # ruote e telaio
        kit.box(colore, (1.7, 1.25, 1.15), (x, 0, 0.9))
        kit.box('steelDark', (1.78, 1.32, 0.16), (x, 0, 1.52))    # coperchio
        kit.box('steelDark', (0.5, 0.2, 0.12), (x, -0.7, 1.4))    # maniglia
        larghezza = max(larghezza, abs(x) * 2 + 1.78)
    return larghezza, 1.62


def build_citta_dehors(kit):
    """Tavolini di un bar sotto gli ombrelloni: due tavoli, quattro sedie."""
    for sx in (-1, 1):
        cx = sx * 2.2
        # Ombrellone: palo e telo quadrato a spioventi, in stile boxy.
        kit.cyl('steel', 0.08, 2.5, (cx, 0, 1.25), axis='Z', verts=6)
        kit.box('white', (3.0, 3.0, 0.16), (cx, 0, 2.45))
        for a in range(4):
            ang = a * math.pi / 2
            kit.box('red', (3.05, 0.5, 0.14),
                    (cx + math.sin(ang) * 1.25, math.cos(ang) * 1.25, 2.33),
                    rot=(0, 0, ang))
        # Tavolo e sedie.
        kit.cyl('white', 0.06, 0.72, (cx, 0, 0.36), axis='Z', verts=6)
        kit.cyl('white', 0.62, 0.1, (cx, 0, 0.75), axis='Z', verts=10)
        for a in (0, math.pi):
            sx2, sz2 = math.sin(a) * 1.1, math.cos(a) * 1.1
            kit.box('steelDark', (0.5, 0.5, 0.08), (cx + sx2, sz2, 0.45))
            kit.box('steelDark', (0.5, 0.1, 0.55), (cx + sx2 - math.sin(a) * 0.2,
                                                    sz2 - math.cos(a) * 0.2, 0.72))
            for px in (-0.2, 0.2):
                for pz in (-0.2, 0.2):
                    kit.box('steelDark', (0.06, 0.06, 0.45), (cx + sx2 + px, sz2 + pz, 0.22))
    return 6.4, 2.55


# --------------------------------------------------------------------------
# IL SECONDO GIRO, 2026-08-27: DODICI ARREDI PICCOLI.
#
# I primi sei bastavano a dire «questa e' una strada», non a riempirla: erano
# 121 oggetti su 2639 unita' di giro per due lati, cioe' uno ogni 44 unita' di
# marciapiede. E intanto dalla citta' sono usciti cartelloni, pennoni, gazebo,
# striscioni, la torre di direzione gara e il podio, lasciando dei vuoti.
#
# Verdetto dell'utente: «io procederei con piccoli arredi, ma molti di questi»,
# e poi «vorrei piu di questi 6 modelli. altri asset sempre relativi a questo
# mondo». Niente alberi, niente mezzi, niente monumenti: roba a terra, tanta.
#
# ⚠️ SAGOME DIVERSE, NON DODICI SCATOLE UGUALI. Da dentro l'abitacolo un
# arredo si riconosce dalla silhouette, non dai dettagli: percio' le altezze
# vanno da 1.05 (le biciclette) a 5.4 (il palo delle telecamere), e ogni pezzo
# ha una proporzione sua. Dodici oggetti alti un metro sarebbero stati un
# cordolo continuo.
# --------------------------------------------------------------------------


def build_citta_dissuasori(kit):
    """Cinque paletti in ghisa con la catena a festone fra l'uno e l'altro."""
    N, PASSO, H = 5, 1.5, 1.0
    for i in range(N):
        x = (i - (N - 1) / 2) * PASSO
        kit.box('steelDark', (0.36, 0.36, 0.12), (x, 0, 0.06))
        kit.cyl('steelDark', 0.11, H - 0.18, (x, 0, (H - 0.18) / 2 + 0.12), axis='Z', verts=8)
        kit.box('white', (0.25, 0.25, 0.11), (x, 0, H - 0.26))       # fascia rifrangente
        kit.cyl('steelDark', 0.155, 0.12, (x, 0, H - 0.06), axis='Z', verts=8)
        # La catena, fatta a due tratti dritti che scendono e risalgono: e' lo
        # stile voxel del progetto, e a distanza legge come un festone.
        if i < N - 1:
            meta, calo = PASSO / 2, 0.24
            lung = math.hypot(meta, calo)
            ang = math.atan2(calo, meta)
            for k, verso in ((0.5, ang), (1.5, -ang)):
                kit.box('steelDark', (lung, 0.06, 0.06),
                        (x + meta * k, 0, 0.80 - calo / 2), rot=(0, verso, 0))
    return N * PASSO, H + 0.1


def build_citta_panchina(kit):
    """Panchina in legno e ghisa, col cestino accanto."""
    L = 3.0
    for sx in (-1, 1):
        x = sx * (L / 2 - 0.3)
        kit.box('steelDark', (0.16, 1.05, 0.44), (x, 0, 0.22))       # fianco
        kit.box('steelDark', (0.16, 0.15, 0.66), (x, 0.36, 0.75))    # montante schienale
        kit.box('steelDark', (0.13, 0.72, 0.1), (x, -0.06, 1.02))    # bracciolo
    for dy in (-0.32, 0.0, 0.32):
        kit.box('bark', (L, 0.28, 0.1), (0, dy, 0.49))               # doghe della seduta
    for dz in (0.82, 1.06):
        kit.box('bark', (L, 0.11, 0.22), (0, 0.4, dz))               # doghe dello schienale
    # Il cestino: sta sempre in coppia con la panchina, e in un modello solo
    # sono due oggetti al prezzo di uno.
    cx = L / 2 + 0.78
    kit.cyl('steelDark', 0.33, 0.86, (cx, 0, 0.47), axis='Z', verts=10)
    kit.cyl('steel', 0.37, 0.1, (cx, 0, 0.95), axis='Z', verts=10)
    kit.box('steelDark', (0.11, 0.11, 1.16), (cx + 0.42, 0, 0.58))
    kit.box('steelDark', (0.3, 0.3, 0.1), (cx + 0.42, 0, 0.05))
    return L + 2.0, 1.16


def build_citta_cartelli(kit):
    """Palo della segnaletica: divieto di sosta, senso unico, targa della via."""
    H = 3.0
    kit.box('steelDark', (0.5, 0.5, 0.18), (0, 0, 0.09))
    kit.cyl('steel', 0.075, H, (0, 0, H / 2 + 0.12), axis='Z', verts=8)
    # Divieto di sosta: il disco blu bordato di rosso. Il disco interno e' piu'
    # PROFONDO di quello esterno, non solo piu' avanti: due facce complanari
    # sfarfallano anche fra due colori chiari.
    kit.cyl('red', 0.42, 0.08, (0, -0.06, 2.58), axis='Y', verts=12)
    kit.cyl('blue', 0.3, 0.14, (0, -0.08, 2.58), axis='Y', verts=12)
    # Senso unico: rettangolo blu con la freccia bianca.
    kit.box('blue', (0.95, 0.07, 0.36), (0, -0.055, 1.94))
    kit.box('white', (0.56, 0.11, 0.11), (-0.08, -0.06, 1.94))
    kit.box('white', (0.2, 0.11, 0.26), (0.3, -0.06, 1.94))
    # La targa della via.
    kit.box('white', (1.15, 0.06, 0.32), (0, -0.05, 1.3))
    kit.box('blue', (1.02, 0.1, 0.22), (0, -0.06, 1.3))
    return 1.25, H + 0.2


def build_citta_transenne(kit):
    """Tre transenne metalliche in fila, quelle coi piedi a slitta."""
    N, W, H = 3, 2.2, 1.1
    for i in range(N):
        x0 = (i - (N - 1) / 2) * (W + 0.08)
        for sx in (-1, 1):
            kit.box('steel', (0.1, 0.1, H), (x0 + sx * W / 2, 0, H / 2))
            kit.box('steelDark', (0.13, 0.8, 0.11), (x0 + sx * W / 2, 0, 0.055))
        kit.box('steel', (W, 0.09, 0.11), (x0, 0, H - 0.06))         # corrente alto
        kit.box('steel', (W, 0.09, 0.09), (x0, 0, 0.56))             # corrente basso
        for k in range(-2, 3):
            kit.box('steel', (0.07, 0.07, H - 0.24), (x0 + k * (W / 6), 0, (H - 0.24) / 2 + 0.12))
    return N * (W + 0.08), H + 0.05


def build_citta_colonnine(kit):
    """Parchimetro e cassetta postale, le due colonnine di ogni marciapiede."""
    # Parchimetro.
    px = -0.95
    kit.box('steelDark', (0.46, 0.46, 0.12), (px, 0, 0.06))
    kit.cyl('steelDark', 0.09, 0.86, (px, 0, 0.5), axis='Z', verts=8)
    kit.box('steelDark', (0.48, 0.38, 0.95), (px, 0, 1.4))
    kit.box('black', (0.32, 0.08, 0.28), (px, -0.19, 1.63))          # display
    kit.box('steel', (0.24, 0.08, 0.18), (px, -0.19, 1.26))          # tastiera
    kit.box('steel', (0.54, 0.44, 0.1), (px, 0, 1.92))               # cappello
    # Cassetta postale.
    cx = 0.8
    kit.box('steelDark', (0.62, 0.52, 0.14), (cx, 0, 0.07))
    kit.box('red', (0.72, 0.58, 1.12), (cx, 0, 0.76))
    kit.box('steelDark', (0.46, 0.09, 0.09), (cx, -0.29, 1.16))      # la bocca
    kit.box('white', (0.32, 0.09, 0.22), (cx, -0.29, 0.72))          # la targa degli orari
    kit.box('red', (0.8, 0.64, 0.13), (cx, 0, 1.38))                 # coperchio
    return 2.3, 1.98


def build_citta_biciclette(kit):
    """Rastrelliera ad archi con tre biciclette legate."""
    for i in range(4):
        x = (i - 1.5) * 1.08
        for dy in (-0.36, 0.36):
            kit.box('steel', (0.09, 0.09, 0.76), (x, dy, 0.38))
        kit.box('steel', (0.09, 0.8, 0.09), (x, 0, 0.76))
    for i, colore in enumerate(('red', 'blue', 'green')):
        x = (i - 1) * 1.08 + 0.54
        for dy in (-0.62, 0.56):
            kit.cyl('black', 0.34, 0.08, (x, dy, 0.34), axis='X', verts=10)
            kit.cyl('steel', 0.09, 0.1, (x, dy, 0.34), axis='X', verts=8)
        kit.box(colore, (0.09, 1.16, 0.09), (x, -0.03, 0.63), rot=(0.16, 0, 0))   # canna
        kit.box(colore, (0.09, 0.11, 0.66), (x, 0.48, 0.62), rot=(-0.22, 0, 0))   # piantone
        kit.box(colore, (0.09, 0.11, 0.74), (x, -0.56, 0.68), rot=(0.2, 0, 0))    # forcella
        kit.box('black', (0.15, 0.36, 0.09), (x, 0.55, 0.95))                     # sella
        kit.box('black', (0.52, 0.09, 0.08), (x, -0.62, 1.0))                     # manubrio
    return 4.6, 1.05


def build_citta_fioriera(kit):
    """Fioriera in cemento con la siepe: bassa e lunga, chiude i tratti vuoti."""
    W, D, H = 3.2, 1.0, 0.6
    kit.box('concrete', (W, D, H), (0, 0, H / 2))
    kit.box('concreteDark', (W + 0.16, D + 0.16, 0.11), (0, 0, H + 0.03))
    kit.box('bark', (W - 0.32, D - 0.32, 0.12), (0, 0, H + 0.05))
    # La siepe: cinque blocchi di altezza diversa, o sembrerebbe un muretto.
    for i in range(5):
        x = (i - 2) * (W - 0.6) / 4.2
        h = 0.46 + (i % 3) * 0.16
        kit.box('leafDark', (0.66, D - 0.34, h), (x, 0, H + 0.09 + h / 2))
        kit.box('leafMid', (0.56, D - 0.5, 0.17), (x, -0.05, H + 0.11 + h))
    return W + 0.3, H + 0.95


def build_citta_cabina(kit):
    """Cabina telefonica: quattro montanti rossi, tre vetri e la porta."""
    W, D, H = 1.2, 1.2, 2.5
    kit.box('steelDark', (W + 0.32, D + 0.32, 0.16), (0, 0, 0.08))
    for sx in (-1, 1):
        for sy in (-1, 1):
            kit.box('red', (0.19, 0.19, H), (sx * W / 2, sy * D / 2, H / 2 + 0.14))
    kit.box('glass', (0.11, D - 0.2, H - 0.46), (-W / 2, 0, H / 2 + 0.34))
    kit.box('glass', (0.11, D - 0.2, H - 0.46), (W / 2, 0, H / 2 + 0.34))
    kit.box('glass', (W - 0.2, 0.11, H - 0.46), (0, D / 2, H / 2 + 0.34))
    kit.box('glass', (W - 0.2, 0.11, H - 0.98), (0, -D / 2, H / 2 + 0.56))    # porta
    kit.box('red', (W - 0.2, 0.13, 0.42), (0, -D / 2, 0.36))                  # zoccolo
    kit.box('steel', (0.09, 0.16, 0.34), (W / 2 - 0.28, -D / 2 - 0.03, 1.35))  # maniglia
    # Tetto a due gradini e insegna sul fronte.
    kit.box('red', (W + 0.4, D + 0.4, 0.2), (0, 0, H + 0.24))
    kit.box('red', (W + 0.12, D + 0.12, 0.24), (0, 0, H + 0.46))
    kit.box('white', (W - 0.26, 0.09, 0.28), (0, -(D / 2 + 0.21), H + 0.24))
    kit.box('steelDark', (0.36, 0.14, 0.52), (0, D / 2 - 0.19, 1.5))          # l'apparecchio
    return W + 0.6, H + 0.6


def build_citta_affissioni(kit):
    """Colonna dei manifesti: il tamburo con tre affissioni e il cappello."""
    H = 3.0
    kit.cyl('steelDark', 0.74, 0.22, (0, 0, 0.11), axis='Z', verts=12)
    kit.cyl('steelDark', 0.64, 0.3, (0, 0, 0.35), axis='Z', verts=12)
    kit.cyl('cittaCrema', 0.6, H - 0.66, (0, 0, (H - 0.66) / 2 + 0.5), axis='Z', verts=12)
    # I manifesti: tre pannelli a tinta piatta attorno al tamburo. Niente
    # marchi — gli sponsor di questo gioco sono inventati e stanno altrove.
    for i, colore in enumerate(('red', 'blue', 'yellow')):
        ang = i * 2 * math.pi / 3
        kit.box(colore, (1.0, 0.1, 1.85),
                (math.sin(ang) * 0.6, -math.cos(ang) * 0.6, 1.66), rot=(0, 0, ang))
        kit.box('white', (0.76, 0.12, 0.42),
                (math.sin(ang) * 0.6, -math.cos(ang) * 0.6, 1.02), rot=(0, 0, ang))
    kit.cyl('steelDark', 0.8, 0.17, (0, 0, H - 0.08), axis='Z', verts=12)
    kit.cyl('steelDark', 0.52, 0.26, (0, 0, H + 0.13), axis='Z', verts=12)
    kit.cyl('steelDark', 0.2, 0.24, (0, 0, H + 0.36), axis='Z', verts=8)
    return 1.8, H + 0.5


def build_citta_fontanella(kit):
    """Fontanella in ghisa, la griglia di scolo e un tombino accanto."""
    kit.box('steelDark', (1.34, 1.3, 0.1), (0, 0.06, 0.05))
    kit.box('black', (0.94, 0.9, 0.07), (0, -0.16, 0.11))
    for k in range(-2, 3):
        kit.box('steelDark', (0.86, 0.09, 0.05), (0, -0.16 + k * 0.19, 0.145))
    kit.cyl('steelDark', 0.17, 1.14, (0, 0.24, 0.67), axis='Z', verts=10)
    kit.cyl('steelDark', 0.23, 0.15, (0, 0.24, 1.3), axis='Z', verts=10)
    kit.box('steel', (0.09, 0.46, 0.09), (0, 0.0, 1.24))             # la cannella
    kit.box('steel', (0.1, 0.1, 0.16), (0, -0.2, 1.14))
    kit.box('steel', (0.17, 0.17, 0.2), (0, 0.24, 1.45))             # il pomello
    # Un tombino accanto: e' il dettaglio che dice «marciapiede vero» a costo
    # quasi zero, ed e' l'unico pezzo di questo arredo che sta a filo di terra.
    kit.cyl('steelDark', 0.44, 0.07, (1.2, 0.15, 0.035), axis='Z', verts=12)
    kit.cyl('black', 0.32, 0.09, (1.2, 0.15, 0.03), axis='Z', verts=12)
    return 2.4, 1.56


def build_citta_banco(kit):
    """Banco del mercato: cassette di frutta sotto la tenda a righe."""
    W, D, H = 3.0, 1.5, 0.92
    for sx in (-1, 1):
        for sy in (-1, 1):
            kit.box('steelDark', (0.11, 0.11, H), (sx * (W / 2 - 0.14), sy * (D / 2 - 0.14), H / 2))
    kit.box('steelDark', (W, D, 0.11), (0, 0, H - 0.055))
    kit.box('white', (W + 0.1, D + 0.1, 0.07), (0, 0, H + 0.03))
    # Le cassette: la fila davanti e' inclinata verso chi guarda, come al banco
    # vero; quella dietro sta in piano.
    for i in range(4):
        x = (i - 1.5) * 0.73
        kit.box('bark', (0.66, 0.72, 0.24), (x, -0.3, H + 0.18), rot=(-0.22, 0, 0))
        kit.box(('red', 'yellow', 'green', 'red')[i], (0.54, 0.6, 0.16),
                (x, -0.33, H + 0.31), rot=(-0.22, 0, 0))
    for i in range(3):
        x = (i - 1) * 0.86
        kit.box('bark', (0.72, 0.6, 0.22), (x, 0.36, H + 0.17))
        kit.box(('green', 'red', 'yellow')[i], (0.6, 0.5, 0.14), (x, 0.36, H + 0.3))
    # La tenda: quattro montanti e il telo in pendenza verso la strada.
    for sx in (-1, 1):
        for sy, alt in ((0.62, 2.42), (-0.66, 2.18)):
            kit.cyl('steelDark', 0.06, alt, (sx * (W / 2 - 0.08), sy, alt / 2), axis='Z', verts=6)
    kit.box('red', (W + 0.5, 1.42, 0.12), (0, -0.02, 2.32), rot=(-0.17, 0, 0))
    kit.box('white', (W + 0.5, 0.36, 0.14), (0, -0.72, 2.2), rot=(-0.17, 0, 0))
    kit.box('red', (W + 0.5, 0.2, 0.26), (0, -0.86, 2.06))           # la balza
    return W + 0.6, 2.45


def build_citta_telecamere(kit):
    """Palo alto con la centralina del traffico e due telecamere sul braccio.

    E' il pezzo PIU' ALTO di questo arredo, e serve a questo: dodici oggetti
    tutti sotto le tre unita' sparirebbero dietro le barriere.
    """
    H = 5.2
    kit.box('concreteDark', (0.72, 0.72, 0.2), (0, 0, 0.1))
    kit.cyl('steel', 0.13, H, (0, 0, H / 2 + 0.18), axis='Z', verts=8)
    # La centralina, a mezz'altezza sul lato del muro.
    kit.box('steel', (0.52, 0.36, 0.82), (0, 0.3, 1.55))
    kit.box('steelDark', (0.56, 0.07, 0.86), (0, 0.49, 1.55))
    kit.box('yellow', (0.17, 0.08, 0.17), (0.15, 0.5, 1.86))
    # Il braccio proteso sulla strada e le due telecamere.
    kit.cyl('steel', 0.08, 1.6, (0, -0.8, H - 0.18), axis='Y', verts=6)
    kit.box('steel', (0.1, 0.36, 0.1), (0, -0.32, H - 0.48), rot=(-0.7, 0, 0))   # tirante
    for dy in (-1.34, -0.66):
        kit.box('white', (0.21, 0.48, 0.21), (0, dy, H - 0.36))
        kit.box('black', (0.15, 0.09, 0.15), (0, dy - 0.27, H - 0.36))
        kit.box('steelDark', (0.25, 0.15, 0.08), (0, dy, H - 0.2))
    return 2.0, H + 0.2
