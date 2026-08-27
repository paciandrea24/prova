"""Moduli di facciata per i circuiti cittadini.

⚠️ NON SONO PALAZZI, SONO COLONNE DI FACCIATA. Il muro continuo attorno a un
circuito cittadino lo fa gia' il nastro estruso (TrackMeshBuilder.buildCitta),
che segue la curva per costruzione ed e' insostituibile in quel mestiere. Questi
pezzi ci si appoggiano SOPRA per dargli la faccia: una colonna larga 9 unita' —
`CittaProfilo.MODULO_LARGO` — fatta di base + N piani tipo + coronamento.
Rif. docs/superpowers/specs/2026-08-27-f1-facciate-asset-design.md

CONVENZIONE DEL PIVOT, diversa dagli altri asset del circuito: l'origine sta sul
PIANO DEL NASTRO (y = 0 e' il retro, la facciata cresce verso -Y, cioe' verso la
pista) e alla BASE del pezzo (z = 0). Cosi' chi li posa non deve conoscerne lo
spessore: mette l'origine sul nastro e impila in altezza.

⚠️ LA TINTA E' COTTA NELL'ASSET, una famiglia per tinta. Un InstancedMesh ha un
materiale solo, quindi due palazzi dello stesso asset non possono avere colori
diversi: la via che non tocca il motore di istanziamento e' generare lo stesso
modulo in piu' tinte, come gia' si fa per le auto parcheggiate
(`life.make_parked_car`). Le tinte sono le stesse di `ToonPalette.CITTA_FACCIATE`
— devono esserlo, perche' il nastro dietro si colora da li' e nelle curve si
vede fra una colonna e l'altra.

Cinque famiglie-tinta, perche' la citta' e' mista (decisione dell'utente):
  crema, mattone, tortora — la citta' vecchia: intonaco, pietra, persiane,
                            balconi in ferro, cornicione con mensole
  vetro, ardesia          — la citta' nuova: nastri di vetro, montanti
                            d'acciaio, pensiline, attico
"""
from voxelKit import EPS

# La colonna. La larghezza e' la stessa misura che regolava la textura, e sta
# scritta anche in cittaProfilo.js: se una delle due cambia, i moduli si
# sovrappongono o lasciano una fessura.
W = 9.0
HALF_W = W / 2
# Profondita' della lastra. Serve solo a dare spessore agli sguanci e a coprire
# il nastro: il volume del palazzo non lo fa questo pezzo.
D = 1.6
FRONT = -D

# Le tre altezze della pila. Cambiare una di queste vuol dire cambiare la
# quantizzazione in CittaProfilo: l'altezza di un palazzo e' BASE + N*PIANO +
# CORONAMENTO, e il nastro dietro deve finire dove finisce il coronamento.
H_BASE = 4.5
H_PIANO = 3.5
H_CORONAMENTO = 1.2

# Le famiglie-tinta: nome -> (colore del corpo, famiglia).
# Il colore e' un nome della PALETTE di voxelKit, e ognuno di questi esiste
# anche in ToonPalette.CITTA_FACCIATE con lo stesso hex.
FAMIGLIE = {
    'Crema':   ('cittaCrema', 'vecchia'),
    'Mattone': ('cittaMattone', 'vecchia'),
    'Tortora': ('cittaTortora', 'vecchia'),
    'Vetro':   ('cittaVetro', 'nuova'),
    'Ardesia': ('cittaArdesia', 'nuova'),
}


def _corpo(kit, colore, h):
    """La lastra piena. Da y=0 (sul nastro) a y=-D (verso la pista)."""
    kit.box(colore, (W, D, h), (0, -D / 2, h / 2))


def _finestra(kit, x, z, larga, alta, cornice='stone', persiane=None):
    """Una finestra: vetro applicato sul fronte, cornice piu' sporgente attorno.

    L'incasso si ottiene per differenza di sporgenza e non scavando il muro —
    un buco vero vorrebbe una booleana, e lo stile del progetto e' fatto di
    volumi pieni sovrapposti (vedi la nota in testa a voxelKit.py)."""
    kit.box('glass', (larga, 0.22, alta), (x, FRONT - 0.06, z))
    mezza = larga / 2
    for sx in (-1, 1):
        kit.box(cornice, (0.24, 0.36, alta + 0.5), (x + sx * (mezza + 0.12), FRONT - 0.13, z))
    kit.box(cornice, (larga + 0.48, 0.36, 0.26), (x, FRONT - 0.13, z + alta / 2 + 0.13))
    kit.box(cornice, (larga + 0.6, 0.46, 0.2), (x, FRONT - 0.18, z - alta / 2 - 0.1))
    if persiane:
        for sx in (-1, 1):
            kit.box(persiane, (0.3, 0.36, alta), (x + sx * (mezza + 0.39), FRONT - 0.13, z))


def _ringhiera(kit, x, z, larga, sporgenza):
    """Parapetto in ferro: montanti fitti e corrimano. Sta davanti al solaio."""
    y = FRONT - sporgenza + 0.12
    kit.box('steelDark', (larga, 0.12, 0.1), (x, y, z + 0.9))
    kit.box('steelDark', (larga, 0.1, 0.08), (x, y, z + 0.45))
    n = max(3, int(larga / 0.42))
    for i in range(n):
        px = x - larga / 2 + larga * (i + 0.5) / n
        kit.box('steelDark', (0.09, 0.09, 0.95), (px, y, z + 0.47))


# ─────────────────────────────── vecchia ───────────────────────────────

def _vecchia_base_a(kit, tinta):
    """Piano terra d'epoca: vetrina con tenda a sinistra, portone a destra."""
    _corpo(kit, tinta, H_BASE)
    # Zoccolo in pietra: la fascia bassa che sui palazzi veri protegge
    # l'intonaco. Sporge poco e gira su tutta la larghezza.
    kit.box('stone', (W, D + 0.24, 1.0), (0, -D / 2 - 0.12, 0.5))

    kit.box('glass', (4.4, 0.24, 2.5), (-1.7, FRONT - 0.07, 2.45))
    for sx in (-1, 1):
        kit.box('stone', (0.3, 0.4, 2.9), (-1.7 + sx * 2.35, FRONT - 0.15, 2.4))
    kit.box('stone', (5.3, 0.4, 0.3), (-1.7, FRONT - 0.15, 3.85))
    # Tenda da sole: inclinata, l'unico pezzo non ortogonale del modulo.
    kit.box('red', (5.0, 1.25, 0.22), (-1.7, FRONT - 0.62, 4.02), rot=(0.42, 0, 0))
    for sx in (-1, 1):
        kit.box('steelDark', (0.08, 1.1, 0.08), (-1.7 + sx * 2.3, FRONT - 0.6, 3.78))

    # Il portone, incassato fra due lesene.
    kit.box('bark', (1.7, 0.26, 3.1), (2.6, FRONT - 0.08, 1.65))
    kit.box('steelDark', (0.16, 0.16, 0.16), (3.15, FRONT - 0.24, 1.75))
    for sx in (-1, 1):
        kit.box('stone', (0.28, 0.42, 3.5), (2.6 + sx * 1.03, FRONT - 0.16, 1.85))
    kit.box('stone', (2.6, 0.42, 0.34), (2.6, FRONT - 0.16, 3.72))
    kit.box('stone', (2.2, 0.7, 0.18), (2.6, FRONT - 0.3, 0.09))

    kit.box('stone', (W, D + 0.44, 0.34), (0, -D / 2 - 0.22, H_BASE - 0.17))
    return W, H_BASE


def _vecchia_base_b(kit, tinta):
    """Piano terra, variante SENZA portone: due negozi affiancati.

    ⚠️ Esiste per una ragione precisa: con una base sola, un palazzo largo
    quattro colonne mostrava quattro portoni identici in fila. Le due varianti
    si alternano lungo il palazzo, e il portone torna a essere uno solo ogni
    tanto — come nelle strade vere."""
    _corpo(kit, tinta, H_BASE)
    kit.box('stone', (W, D + 0.24, 1.0), (0, -D / 2 - 0.12, 0.5))

    for sx, tenda in ((-1, 'blue'), (1, 'yellow')):
        x = sx * 2.2
        kit.box('glass', (3.5, 0.24, 2.5), (x, FRONT - 0.07, 2.45))
        for lato in (-1, 1):
            kit.box('stone', (0.28, 0.4, 2.9), (x + lato * 1.89, FRONT - 0.15, 2.4))
        kit.box('stone', (4.3, 0.4, 0.3), (x, FRONT - 0.15, 3.85))
        kit.box(tenda, (4.0, 1.25, 0.22), (x, FRONT - 0.62, 4.02), rot=(0.42, 0, 0))
        for lato in (-1, 1):
            kit.box('steelDark', (0.08, 1.1, 0.08), (x + lato * 1.85, FRONT - 0.6, 3.78))
    # Il pilastro fra i due negozi: senza, le due vetrine si leggono come una.
    kit.box('stone', (0.5, 0.44, 3.6), (0, FRONT - 0.17, 1.9))

    kit.box('stone', (W, D + 0.44, 0.34), (0, -D / 2 - 0.22, H_BASE - 0.17))
    return W, H_BASE


def _vecchia_piano_a(kit, tinta):
    """Piano tipo: tre finestre con persiane, quella centrale col balcone."""
    _corpo(kit, tinta, H_PIANO)
    kit.box('stone', (3.4, 0.85, 0.22), (0, FRONT - 0.42, 0.11))
    _ringhiera(kit, 0, 0.22, 3.3, 0.85)
    for x in (-2.9, 0.0, 2.9):
        _finestra(kit, x, 1.95, 1.3, 1.9, persiane='white')
    kit.box('stone', (W, D + 0.3, 0.26), (0, -D / 2 - 0.15, H_PIANO - 0.13))
    return W, H_PIANO


def _vecchia_piano_b(kit, tinta):
    """Piano tipo, variante: due portefinestre larghe e un balcone continuo."""
    _corpo(kit, tinta, H_PIANO)
    kit.box('stone', (W - 0.6, 0.95, 0.24), (0, FRONT - 0.47, 0.12))
    _ringhiera(kit, 0, 0.24, W - 0.7, 0.95)
    for x in (-2.2, 2.2):
        _finestra(kit, x, 2.05, 1.9, 2.2)
    # Fra le due, una finestrella alta: l'asimmetria si legge da lontano.
    _finestra(kit, 0, 2.35, 0.75, 1.1, persiane='white')
    kit.box('stone', (W, D + 0.3, 0.26), (0, -D / 2 - 0.15, H_PIANO - 0.13))
    return W, H_PIANO


def _vecchia_tetto(kit, tinta):
    """Coronamento: cornicione aggettante su mensole e parapetto in muratura."""
    _corpo(kit, tinta, H_CORONAMENTO)
    kit.box('stone', (W, D + 1.1, 0.34), (0, -D / 2 - 0.55, 0.5))
    kit.box('stone', (W, D + 0.7, 0.26), (0, -D / 2 - 0.35, 0.22))
    for i in range(6):
        kit.box('stone', (0.26, 0.5, 0.3), (-3.75 + i * 1.5, FRONT - 0.3, 0.06))
    kit.box(tinta, (W, D + 0.2, 0.5), (0, -D / 2 - 0.1, H_CORONAMENTO - 0.25))
    return W, H_CORONAMENTO


# ──────────────────────────────── nuova ────────────────────────────────

def _nuova_base_a(kit, tinta):
    """Piano terra moderno: ingresso vetrato a tutta altezza e pensilina."""
    _corpo(kit, tinta, H_BASE)
    kit.box('tarmac', (W, D + 0.2, 0.5), (0, -D / 2 - 0.1, 0.25))

    kit.box('glass', (W - 1.2, 0.26, 3.4), (0, FRONT - 0.08, 2.35))
    for x in (-3.0, -1.0, 1.0, 3.0):
        kit.box('steel', (0.22, 0.4, 3.5), (x, FRONT - 0.16, 2.35))
    kit.box('steel', (W - 1.0, 0.4, 0.24), (0, FRONT - 0.16, 4.05))
    kit.box('steel', (W - 1.0, 0.4, 0.2), (0, FRONT - 0.16, 0.7))
    kit.box('steelDark', (W - 0.4, 1.5, 0.26), (0, FRONT - 0.75, 4.35))
    for sx in (-1, 1):
        kit.box('steel', (0.12, 1.3, 0.12), (sx * 3.6, FRONT - 0.7, 4.16))
    return W, H_BASE


def _nuova_base_b(kit, tinta):
    """Piano terra moderno, variante: vetrine di negozio e insegna continua.

    Stessa ragione della variante vecchia: quattro ingressi principali in fila
    non esistono in nessuna strada."""
    _corpo(kit, tinta, H_BASE)
    kit.box('tarmac', (W, D + 0.2, 0.5), (0, -D / 2 - 0.1, 0.25))

    for x in (-2.8, 0.0, 2.8):
        kit.box('glass', (2.3, 0.26, 2.7), (x, FRONT - 0.08, 2.05))
    for x in (-1.4, 1.4):
        kit.box('steel', (0.28, 0.38, 2.9), (x, FRONT - 0.14, 2.05))
    # L'insegna: una fascia continua sopra le vetrine, spezzata da un'unica
    # macchia di colore. Ne basta una per palazzo perche' si noti.
    kit.box('steelDark', (W, 0.5, 0.9), (0, FRONT - 0.2, 3.9))
    kit.box('red', (2.6, 0.28, 0.55), (-2.8, FRONT - 0.42, 3.9))
    kit.box('steel', (W, 0.34, 0.16), (0, FRONT - 0.12, 0.85))
    return W, H_BASE


def _nuova_piano_a(kit, tinta):
    """Piano tipo: nastro di vetro continuo scandito da montanti."""
    _corpo(kit, tinta, H_PIANO)
    kit.box('glass', (W - 0.5, 0.24, 2.5), (0, FRONT - 0.07, 1.75))
    for x in (-3.4, -1.7, 0.0, 1.7, 3.4):
        kit.box('steel', (0.2, 0.38, 2.6), (x, FRONT - 0.15, 1.75))
    kit.box('concreteDark', (W, D + 0.34, 0.42), (0, -D / 2 - 0.17, H_PIANO - 0.21))
    kit.box('concreteDark', (W, D + 0.34, 0.3), (0, -D / 2 - 0.17, 0.15))
    return W, H_PIANO


def _nuova_piano_b(kit, tinta):
    """Piano tipo, variante: finestre a riquadri e lesene cieche."""
    _corpo(kit, tinta, H_PIANO)
    for x in (-3.15, -1.05, 1.05, 3.15):
        kit.box('glass', (1.62, 0.24, 2.1), (x, FRONT - 0.07, 1.85))
        kit.box('steel', (1.8, 0.36, 0.16), (x, FRONT - 0.13, 0.68))
    for x in (-2.1, 0.0, 2.1):
        kit.box(tinta, (0.5, 0.34, 2.3), (x, FRONT - 0.12, 1.85))
    kit.box('steelDark', (W, D + 0.28, 0.36), (0, -D / 2 - 0.14, H_PIANO - 0.18))
    return W, H_PIANO


def _nuova_tetto(kit, tinta):
    """Coronamento: fascia tecnica, parapetto di vetro fra montanti."""
    _corpo(kit, tinta, H_CORONAMENTO)
    kit.box('steelDark', (W, D + 0.5, 0.55), (0, -D / 2 - 0.25, 0.3))
    kit.box('steel', (W, D + 0.16, 0.14), (0, -D / 2 - 0.08, 0.72))
    kit.box('glass', (W - 0.4, 0.12, 0.6), (0, FRONT + 0.06, H_CORONAMENTO - 0.3))
    for x in (-4.0, -1.35, 1.35, 4.0):
        kit.box('steel', (0.16, 0.2, 0.7), (x, FRONT + 0.1, H_CORONAMENTO - 0.35))
    return W, H_CORONAMENTO


_PEZZI = {
    'vecchia': {'BaseA': _vecchia_base_a, 'BaseB': _vecchia_base_b,
                'PianoA': _vecchia_piano_a, 'PianoB': _vecchia_piano_b,
                'Tetto': _vecchia_tetto},
    'nuova':   {'BaseA': _nuova_base_a, 'BaseB': _nuova_base_b,
                'PianoA': _nuova_piano_a, 'PianoB': _nuova_piano_b,
                'Tetto': _nuova_tetto},
}

PEZZI = ('BaseA', 'BaseB', 'PianoA', 'PianoB', 'Tetto')


def builders():
    """assetId -> build(kit), per il registry. Cinque tinte per cinque pezzi."""
    out = {}
    for nome, (colore, famiglia) in FAMIGLIE.items():
        for pezzo in PEZZI:
            fn = _PEZZI[famiglia][pezzo]
            out[f'citta{nome}{pezzo}'] = (lambda f, c: lambda kit: f(kit, c))(fn, colore)
    return out
