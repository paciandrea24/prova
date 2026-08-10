"""Vegetazione: alberi, cespugli e masse di bosco.

Sono gli asset più replicati del catalogo — centinaia di istanze ciascuno —
quindi vale una regola più severa del solito: MASSIMO 3 MATERIALI (2 per i
cespugli). Ogni materiale è una mesh separata e quindi una draw call per cella
spaziale.

Il numero di VOLUMI invece può crescere: `kit.finish()` fonde tutti i pezzi
dello stesso materiale in una mesh sola, quindi trenta cubetti costano una
draw call come tre. Si paga in triangoli, non in chiamate.

COME SI FA UNA CHIOMA. Non con tre parallelepipedi sovrapposti: a quel punto
si legge come una scatola, per quanto la si ruoti (provato il 2026-08-10 e
bocciato dall'utente — "un ammasso di cubi"). Serve una nuvola di cubetti
piccoli distribuiti su un ellissoide, con dimensione e posizione irregolari:
è la SILHOUETTE frastagliata a dire "fogliame", non il volume interno, che
infatti resta vuoto e non si vede mai.

Fronte verso -Y Blender = +Z gioco, pivot alla base.
"""
import math

from voxelKit import EPS


# --- Generatore di chiome -------------------------------------------------

def _rng(seed):
    """LCG minimale. Serve determinismo: gli asset si rigenerano spesso e due
    build dello stesso albero devono dare lo stesso file, altrimenti ogni
    rigenerazione sporca il diff del .glb senza motivo."""
    state = [seed & 0xFFFFFFFF]

    def nxt():
        state[0] = (1103515245 * state[0] + 12345) & 0x7FFFFFFF
        return state[0] / 0x7FFFFFFF
    return nxt


def _canopy(kit, seed, center, radii, count, voxel, mats, zmin=None):
    """Nuvola di cubetti su un ellissoide.

    center  (x, y, z) del centro della chioma
    radii   (rx, ry, rz) semiassi
    count   quanti cubetti
    voxel   (min, max) lato del singolo cubetto
    mats    materiali da alternare

    I cubetti stanno sul GUSCIO, non nel volume: l'interno non si vede mai e
    riempirlo raddoppierebbe i triangoli per nulla. La distribuzione usa la
    radice cubica del raggio casuale, così restano addensati verso la
    superficie invece di ammassarsi al centro.
    """
    rnd = _rng(seed)
    cx, cy, cz = center
    rx, ry, rz = radii
    for i in range(count):
        # Punto sulla sfera unitaria (metodo di Marsaglia), poi schiacciato
        # sull'ellissoide.
        while True:
            a = rnd() * 2 - 1
            b = rnd() * 2 - 1
            if a * a + b * b < 1:
                break
        s = math.sqrt(1 - a * a - b * b)
        ux, uy, uz = 2 * a * s, 2 * b * s, 1 - 2 * (a * a + b * b)
        # 0.72..1 sul raggio: guscio spesso, non superficie sottile
        k = 0.72 + 0.28 * rnd()
        x = cx + ux * rx * k
        y = cy + uy * ry * k
        z = cz + uz * rz * k
        lato = voxel[0] + (voxel[1] - voxel[0]) * rnd()
        # Dimensioni leggermente diverse sui tre assi: cubi perfetti tutti
        # uguali si riconoscono come griglia. Vanno calcolate PRIMA del clamp
        # qui sotto, perché l'altezza reale del cubetto è `lato * fz` e non
        # `lato`: usare il lato nominale lasciava i cespugli interrati di 7 cm.
        dy = lato * (0.82 + 0.36 * rnd())
        dz = lato * (0.82 + 0.36 * rnd())
        # Il pivot deve stare alla BASE dell'asset: un cubetto che sporge sotto
        # lo zero interra l'oggetto, e su un cespuglio alto 1.3 bastano pochi
        # centimetri per accorgersene. Invece di scartarlo lo si appoggia a
        # terra.
        if zmin is not None:
            z = max(z, zmin + dz / 2)
        kit.box(mats[i % len(mats)], (lato, dy, dz), (x, y, z),
                rot=(0, 0, rnd() * math.pi / 2))


def _trunk(kit, height, base_w, seed, lean=0.12):
    """Tronco a segmenti che si assottigliano e si spostano di poco: un
    cilindro dritto e uniforme è la cosa che più fa sembrare l'albero un
    lampione."""
    rnd = _rng(seed)
    segmenti = 3
    z = 0.0
    x = y = 0.0
    for i in range(segmenti):
        h = height / segmenti
        w = base_w * (1 - i * 0.22)
        kit.box('bark', (w, w, h + EPS), (x, y, z + h / 2 + (EPS / 2 if i == 0 else 0)))
        z += h
        x += (rnd() - 0.5) * lean * height
        y += (rnd() - 0.5) * lean * height
    return x, y, z


# --- Latifoglia grande ----------------------------------------------------
# L'albero "medio" del catalogo, quello che si vede di più. Largo 9 contro i
# 2.1 del Kenney che affianca: a parità di numero occupa quattro volte
# l'orizzonte.

def build_broad(kit):
    tx, ty, tz = _trunk(kit, 4.4, 1.15, seed=1177)
    # Due rami che escono dal tronco: bastano a rompere la verticale, e si
    # vedono solo di sagoma contro il cielo.
    kit.box('bark', (2.6, 0.5, 0.5), (tx + 1.1, ty, tz - 0.7), rot=(0, math.radians(-22), 0))
    kit.box('bark', (0.5, 2.4, 0.5), (tx, ty - 1.0, tz - 1.4), rot=(math.radians(20), 0, 0))
    _canopy(kit, 4211, (tx, ty, tz + 2.6), (4.1, 3.9, 2.9), 18, (2.4, 3.6),
            ('leafMid', 'leafDark', 'leafMid'))
    # Un ciuffo più basso e più scuro sotto la massa principale: dà spessore
    # alla chioma vista da terra, che è come la si vede quasi sempre.
    _canopy(kit, 903, (tx - 0.6, ty + 0.5, tz + 0.9), (2.9, 2.7, 1.5), 5, (2.0, 2.8),
            ('leafDark',))
    return 9.0, 11.0


# --- Albero giovane -------------------------------------------------------
# Riempie fra i grandi senza ripeterne la sagoma: chioma più stretta e alta.

def build_young(kit):
    tx, ty, tz = _trunk(kit, 3.0, 0.75, seed=577)
    _canopy(kit, 6301, (tx, ty, tz + 1.7), (2.4, 2.3, 2.0), 11, (1.8, 2.6),
            ('leafDark', 'leafMid'))
    return 5.0, 7.0


# --- Conifera -------------------------------------------------------------
# Alta e stretta: la sagoma che occupa l'orizzonte sui rilievi, dove serve
# altezza più che volume. Alta 16 contro i 9 del Kenney più grande.
PINE_TIERS = 5
PINE_BASE_R = 2.6


def build_pine(kit):
    kit.box('bark', (0.85, 0.85, 4.0), (0, 0, 2.0))
    # Palchi di rami che si stringono salendo. Ogni palco è una chioma
    # schiacciata: è la sovrapposizione dei palchi a dare il profilo a gradoni
    # della conifera, senza che nessuno di essi sia un blocco.
    for i in range(PINE_TIERS):
        t = i / (PINE_TIERS - 1)
        r = PINE_BASE_R * (1 - 0.78 * t)
        z = 3.2 + i * 2.75
        _canopy(kit, 8100 + i * 37, (0, 0, z), (r, r, 1.15), 5 - (i // 2), (1.7, 2.6),
                ('leafDark', 'leafMid'))
    # Punta: un solo cubetto in cima chiude la silhouette.
    kit.box('leafDark', (1.1, 1.1, 1.6), (0, 0, 3.2 + PINE_TIERS * 2.75 - 1.0))
    return 5.2, 16.5


# --- Albero a chioma tonda ------------------------------------------------
# La chioma più piena del catalogo: serve a spezzare la ripetizione dove ci
# sono molti alberi vicini.

def build_round(kit):
    tx, ty, tz = _trunk(kit, 3.4, 1.0, seed=2903)
    _canopy(kit, 5507, (tx, ty, tz + 2.4), (3.5, 3.4, 3.0), 20, (2.3, 3.3),
            ('leafMid', 'leafMid', 'leafDark'))
    return 7.0, 9.0


# --- Cespugli -------------------------------------------------------------
# Nessun tronco: un cespuglio è una massa che tocca terra. Pochi cubetti, ma
# la stessa regola della silhouette irregolare.

def build_bush_low(kit):
    _canopy(kit, 331, (0, 0, 0.55), (0.85, 0.75, 0.42), 11, (0.5, 0.85),
            ('leafMid', 'leafDark'), zmin=0)
    return 1.6, 1.2


def build_bush_tall(kit):
    _canopy(kit, 719, (0, 0, 1.5), (1.35, 1.25, 1.25), 18, (0.7, 1.15),
            ('leafDark', 'leafMid'), zmin=0)
    return 2.8, 3.2


# --- Massa di bosco (NON in uso) ------------------------------------------
# Tentativo del 2026-08-10, tolto dal gioco: a 500 unità un blocco squadrato
# si legge come una scatola verde, non come una foresta. Il builder resta
# perché l'idea — un oggetto largo al posto di trenta alberi — regge, ma
# andrebbe rifatta con lo stesso criterio delle chiome qui sopra: silhouette
# frastagliata invece di parallelepipedi. Vedi la nota in
# frontend/shared/trackScenery.js.
MASS_W = 70.0
MASS_D = 46.0
BODY_H = 30.0
CANOPY_TOP = 45.0

_CANOPIES = (
    (-24.0, -12.0, 20.0, 17.0, 13.0),
    (-9.5, 6.5, 24.0, 19.0, 16.5),
    (8.0, -8.0, 21.0, 16.0, 14.0),
    (23.5, 9.0, 18.0, 15.0, 11.5),
    (-28.0, 12.0, 14.0, 12.0, 9.0),
    (0.5, -17.5, 15.0, 11.0, 8.0),
    (17.0, 15.5, 13.0, 10.0, 7.5),
    (-16.0, -2.0, 12.0, 9.0, 6.5),
)

_SKIRTS = (
    (-30.0, 17.0, 16.0, 10.0, 18.0),
    (26.0, -16.0, 14.0, 11.0, 21.0),
    (-2.0, 21.0, 19.0, 9.0, 15.0),
    (33.0, 4.0, 9.0, 13.0, 16.0),
)


def build_wood_mass(kit):
    kit.box('leafDark', (MASS_W - 8.0, MASS_D - 8.0, BODY_H), (0, 0, BODY_H / 2))
    for dx, dz, w, d, h in _SKIRTS:
        kit.box('leafDark', (w, d, h), (dx, dz, h / 2))
    for dx, dz, w, d, h in _CANOPIES:
        kit.box('leafMid', (w, d, h), (dx, dz, BODY_H - 3.0 + h / 2))
    return MASS_W, CANOPY_TOP
