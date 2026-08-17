"""Strutture di gara: torre di direzione, ponte semafori di partenza, podio.

Il fronte guarda -Y Blender = +Z gioco.
"""
from voxelKit import EPS


# --- Torre di direzione gara ---------------------------------------------
# È l'elemento più alto del catalogo: deve dominare lo skyline vicino al
# traguardo (per confronto: la tribuna è alta 12, treeLarge 9).
SHAFT = 10.0       # lato del fusto
SHAFT_H = 26.0
CABIN_W, CABIN_D, CABIN_H = 13.0, 11.0, 4.15
ROOF_Z = 30.35


def _glass_band(kit, half, z, height, thickness=0.3, overhang=0.15):
    """Nastro vetrato continuo sui 4 lati di un volume a base rettangolare.

    I tratti frontale e posteriore si fermano dove iniziano i laterali: se
    invece li si porta a tutta larghezza, i quattro spigoli si sovrappongono
    condividendo le facce esterne, con z-fighting su tutta l'altezza del
    nastro (trovato da circuitAssetsBlackCheck.py a x=5.15, y=-5.15).
    """
    hx, hy = half
    reach_x = hx + overhang - thickness / 2
    for sy in (-1, 1):
        kit.box('glass', ((reach_x - thickness / 2) * 2, thickness, height),
                (0, sy * (hy + overhang - thickness / 2), z))
    for sx in (-1, 1):
        kit.box('glass', (thickness, hy * 2 + overhang * 2, height),
                (sx * reach_x, 0, z))


BALCONY_Z = 16.0


def build_race_control_tower(kit):
    kit.box('concreteDark', (14.0, 12.0, 2.0), (0, 0, 1.0))
    kit.box('concrete', (SHAFT, SHAFT, SHAFT_H), (0, 0, SHAFT_H / 2))

    # Costoloni d'angolo a tutta altezza: sporgono 0.4 dal filo del fusto e
    # interrompono i nastri vetrati come montanti, dando verticalità.
    for sx in (-1, 1):
        for sy in (-1, 1):
            kit.box('concreteDark', (0.8, 0.8, SHAFT_H),
                    (sx * SHAFT / 2, sy * SHAFT / 2, SHAFT_H / 2))

    for z in (7.0, 12.0, 21.0):
        _glass_band(kit, (SHAFT / 2, SHAFT / 2), z, 1.8)

    # Balcone di osservazione a metà altezza, con parapetto perimetrale
    # (tratti frontale/posteriore accorciati per non sovrapporsi ai laterali).
    kit.box('concreteDark', (13.0, 12.6, 0.5), (0, 0, BALCONY_Z))
    for sy in (-1, 1):
        kit.box('steel', (12.5, 0.25, 0.9), (0, sy * 6.175, BALCONY_Z + 0.65))
    for sx in (-1, 1):
        kit.box('steel', (0.25, 12.6, 0.9), (sx * 6.375, 0, BALCONY_Z + 0.65))

    # Solaio a sbalzo su cui poggia la cabina.
    kit.box('concreteDark', (14.0, 12.0, 0.7), (0, 0, SHAFT_H))

    cabin_z0 = SHAFT_H + 0.2
    kit.box('concrete', (CABIN_W, CABIN_D, CABIN_H), (0, 0, cabin_z0 + CABIN_H / 2))
    _glass_band(kit, (CABIN_W / 2, CABIN_D / 2), cabin_z0 + CABIN_H / 2 + 0.1, 2.4)

    kit.box('concreteDark', (14.6, 12.6, 0.6), (0, 0, ROOF_Z))
    kit.box('steel', (0.35, 0.35, 3.25), (0, 0, ROOF_Z + 1.4))
    kit.box('red', (0.5, 0.5, 0.5), (0, 0, ROOF_Z + 3.1))

    return 14.6, ROOF_Z + 3.35


# --- Ponte semafori di partenza ------------------------------------------
# Luce interna 27 unità (piloni a x=±15, larghi 3): una pista tipica è larga
# roadHalfWidth*2 ≈ 22, quindi a scala 1 il ponte la scavalca con margine.
# Per tracciati più larghi sarà chi integra a scalare l'arco (fuori scope).
GANTRY_SPAN = 34.0
POST_X = 15.0
POST_H = 15.0
BEAM_Z = 15.0
LIGHT_X = (-8.0, -4.0, 0.0, 4.0, 8.0)
# Nomi dei cinque gruppi semaforo nel .glb, in ordine di X crescente. Il gioco
# li cerca per nome (f1.js::loadScenery salva mesh.name nell'InstancedMesh):
# cambiarli qui vuol dire cambiarli anche là.
LIGHT_NAMES = tuple('gantry_light_%d' % (i + 1) for i in range(len(LIGHT_X)))


def build_start_gantry(kit):
    for side in (-1, 1):
        x = side * POST_X
        kit.box('steel', (3.0, 2.0, POST_H), (x, 0, POST_H / 2))
        kit.box('concreteDark', (4.5, 2.4, 1.2), (x, 0, 0.6))

    # Traversa reticolare: due correnti + montanti, invece di un cassone
    # pieno — è quello che la fa leggere come struttura e non come muro.
    for z in (BEAM_Z - 0.75, BEAM_Z + 0.75):
        kit.box('steel', (GANTRY_SPAN, 1.4, 0.5), (0, 0, z))
    for i in range(11):
        x = -15.0 + i * 3.0
        kit.box('steelDark', (0.35, 1.5, 1.1), (x, 0, BEAM_Z))

    # Gruppi semaforo appesi sotto la corrente inferiore. Le quattro lenti di
    # ogni colonna restano un oggetto A SÉ, nominato: in gioco si accendono
    # una colonna al secondo (f1.js::accendiSemaforo), e per farlo servono
    # cinque mesh distinte da poter ricolorare separatamente. Il corpo nero
    # resta invece nel gruppo comune: non si accende mai.
    nomi = []
    for k, x in enumerate(LIGHT_X):
        kit.box('black', (1.6, 1.2, 4.1), (x, 0, 12.55))
        lenti = [kit.cyl('red', 0.4, 0.25, (x, -0.65, 11.1 + i * 0.8), axis='Y')
                 for i in range(4)]
        nomi.append(kit.raggruppa(lenti, LIGHT_NAMES[k]).name)

    kit.box('white', (12.0, 0.2, 1.2), (0, -0.8, BEAM_Z))

    kit.keep_separate = tuple(nomi)
    return GANTRY_SPAN + 0.5, BEAM_Z + 1.0


# --- Podio ----------------------------------------------------------------
# I 3 gradini restano oggetti distinti nel .glb (kit.keep_separate): la spec
# li vuole referenziabili da una futura cerimonia podio, che NON fa parte di
# questo lavoro. Y dei gradini vincolato a -1.5 perché il centro del
# bounding box complessivo cada sull'origine.
STEP_W, STEP_D = 4.0, 4.0
STEP_Y = -1.5
STEP_HEIGHTS = {'p1': 3.0, 'p2': 2.2, 'p3': 1.6}
STEP_X = {'p1': 0.0, 'p2': -4.0, 'p3': 4.0}
WALL_TOP = 9.0


def build_podium(kit):
    names = []
    for key in ('p1', 'p2', 'p3'):
        h = STEP_HEIGHTS[key]
        x = STEP_X[key]
        step = kit.box('white', (STEP_W, STEP_D, h), (x, STEP_Y, h / 2))
        step.name = f'podium_step_{key}'
        names.append(step.name)
        # Bordo leggermente INCASSATO nei fianchi del gradino: a filo esatto
        # le facce laterali sarebbero complanari con quelle del gradino
        # (z-fighting); allargandolo, si scontrerebbe col gradino adiacente.
        kit.box('red', (STEP_W - 0.2, STEP_D + 0.2, 0.2), (x, STEP_Y, h - 0.1 + EPS))
        kit.box('blue', (STEP_W - 0.4, 0.15, 0.6), (x, STEP_Y - STEP_D / 2 - 0.03, h * 0.45))
    kit.keep_separate = tuple(names)

    # Pedana della balconata dietro i gradini.
    kit.box('concreteDark', (12.0, 3.0, 0.5), (0, 2.0, 0.25))
    # Parete sponsor: parte dalla pedana, non a mezz'aria.
    kit.box('white', (12.0, 0.5, WALL_TOP - 0.4), (0, 3.0, 0.4 + (WALL_TOP - 0.4) / 2))
    for i, mat in enumerate(('red', 'blue', 'red')):
        kit.box(mat, (3.4, 0.1, 1.4), ((i - 1) * 3.7, 2.72 + EPS, 6.0))
    kit.box('steel', (12.0, 0.25, 1.0), (0, 0.6, 0.95))

    return 12.0, WALL_TOP
