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
