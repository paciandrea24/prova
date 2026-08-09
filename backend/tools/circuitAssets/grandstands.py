"""Tribune: modulo base impilabile + varianti con tettoia/coperta."""

# Tutte le misure sono in unità di gioco (vedi il piano): l'auto è lunga 7.17,
# quindi un modulo largo 18 copre due auto e mezza affiancate.
W = 18.0          # larghezza (X)
D = 12.0          # profondità (Y Blender; il fronte guarda -Y = +Z gioco)
H = 12.0          # altezza totale: DEVE restare il passo di impilamento
ROWS = 9
ROW_RISE = 1.1    # alzata di un gradone
ROW_DEPTH = 1.15  # pedata di un gradone
BASE_H = 1.0      # basamento

SEAT_COLS = 13    # colonne di sedili, corridoio incluso
SEAT_STEP = 1.2
AISLE_COL = 6     # colonna centrale: corridoio d'accesso, niente sedili

# Compenetrazione minima fra volumi adiacenti (vedi voxelKit.EPS): due box
# che combaciano esattamente lasciano passare una fessura sul vuoto interno.
EPS = 0.04

Y_FRONT = -D / 2          # bordo anteriore (verso la pista)
Y_ROW0 = Y_FRONT + 1.0    # centro della prima fila di gradoni


def _row_y(r):
    return Y_ROW0 + r * ROW_DEPTH


def _row_top(r):
    """Quota del piano calpestabile della fila r."""
    return BASE_H + (r + 1) * ROW_RISE


AISLE_HALF = SEAT_STEP / 2 + 0.05  # semilarghezza del vano corridoio nei gradoni


def _tiers(kit):
    """Gradinata che sale dal fronte (-Y) verso il retro (+Y). La colonna
    centrale resta libera: è il corridoio di risalita, marcato in scuro sul
    gradone. Sostituisce la scala laterale del primo tentativo, che finiva
    inglobata nella parete del fianco e non si vedeva affatto.

    I gradoni sono volumi PIENI da terra, non lastre alte quanto l'alzata:
    la prima versione era cava sotto e da ogni fessura si vedeva il vuoto
    interno (diagnosticato con un render ad ambiente pieno senza sole — le
    macchie restavano nere, quindi erano buchi e non ombre).
    """
    seg = (W - 0.8) / 2 - AISLE_HALF
    for r in range(ROWS):
        z_top = _row_top(r)
        y = _row_y(r)
        for side in (-1, 1):
            kit.box('concrete', (seg, ROW_DEPTH + EPS * 2, z_top),
                    (side * (AISLE_HALF + seg / 2), y - EPS, z_top / 2))
        for c in range(SEAT_COLS):
            if c == AISLE_COL:
                continue
            x = (c - (SEAT_COLS - 1) / 2) * SEAT_STEP
            mat = 'blue' if (r + c) % 2 == 0 else 'white'
            # Seduta + schienale come pezzi distinti: è il livello di
            # dettaglio che distingue una tribuna da una scalinata liscia.
            kit.box(mat, (0.85, 0.55, 0.26), (x, y - 0.18, z_top + 0.13))
            kit.box(mat, (0.85, 0.2, 0.55), (x, y + 0.28, z_top + 0.28))


def seat_anchors():
    """Posizioni dei posti a sedere in COORDINATE GIOCO (non Blender),
    relative all'origine della tribuna: X = X gioco, Y = altezza, Z = +Z
    gioco (verso la pista). Sono i punti dove va piazzato uno spettatore, col
    pivot ai piedi sul piano del gradone.

    Generata dalla stessa geometria di _tiers(): se cambia il passo dei
    sedili o il numero di file, queste posizioni seguono automaticamente e
    non possono divergere dal modello.
    """
    out = []
    for r in range(ROWS):
        z_top = _row_top(r)
        y = _row_y(r)
        for c in range(SEAT_COLS):
            if c == AISLE_COL:
                continue
            x = (c - (SEAT_COLS - 1) / 2) * SEAT_STEP
            # Blender (x, y, z) -> gioco (x, z, -y); i piedi stanno un filo
            # più avanti del centro della pedata.
            out.append({
                'x': round(x, 3),
                'y': round(z_top, 3),
                'z': round(-(y - 0.05), 3),
            })
    return out


def _aisle_steps(kit):
    """Corridoio centrale a gradini di mezza alzata: raddoppiando la
    frequenza rispetto ai gradoni si legge come scala di risalita. Riempie
    il vano lasciato libero dai gradoni, sconfinando di EPS su entrambi i
    lati perché non resti una fessura passante.

    Prima versione: due corrimano per fila ai lati del corridoio — a render
    si leggevano come cubi grigi sparsi in mezzo ai sedili, non come
    ringhiere. Un volume scuro continuo funziona molto meglio a questa scala.
    """
    width = AISLE_HALF * 2 + EPS * 2
    for r in range(ROWS):
        y = _row_y(r)
        top = _row_top(r)
        half = top - ROW_RISE / 2
        kit.box('concreteDark', (width, ROW_DEPTH / 2 + EPS * 2, half),
                (0, y - ROW_DEPTH / 4 - EPS, half / 2))
        # top + EPS: la faccia calpestabile deve stare SOPRA quella del
        # gradone, non complanare — altrimenti z-fighting sulla striscia di
        # compenetrazione laterale.
        kit.box('concreteDark', (width, ROW_DEPTH / 2 + EPS, top + EPS),
                (0, y + ROW_DEPTH / 4, (top + EPS) / 2))


def _side_walls(kit):
    """Fianchi a profilo scalinato che segue la gradinata.

    Prima versione: due lastre piene alte quanto tutto il modulo — l'utente
    le ha bocciate ("sembra una scatola aperta da un lato, le tribune non
    hanno pareti laterali così"), ed è corretto: il fianco di una tribuna
    segue la linea dei gradoni. L'impilamento a 2 livelli
    (buildMainGrandstandLayout) non dipende da questi fianchi ma dalla
    parete di fondo, che resta a piena altezza.
    """
    # I pezzi del fianco condividono lo stesso piano esterno (x = ±W/2):
    # devono essere CONTIGUI, mai sovrapposti. Sovrapporli — come faceva la
    # versione con EPS — mette due facce complanari nello stesso punto e
    # produce z-fighting, che a render appare come macchie nere nette
    # (localizzate per raycast a x=9.00, y∈[-5.55,-5.04]).
    head_depth = (Y_ROW0 - ROW_DEPTH / 2) - Y_FRONT
    for side in (-1, 1):
        x = side * (W / 2 - 0.4)
        # Testata anteriore, davanti alla prima fila: parapetto basso.
        kit.box('concrete', (0.8, head_depth, BASE_H + ROW_RISE + 0.9),
                (x, Y_FRONT + head_depth / 2, (BASE_H + ROW_RISE + 0.9) / 2))
        for r in range(ROWS):
            top = _row_top(r) + 0.9
            kit.box('concrete', (0.8, ROW_DEPTH, top), (x, _row_y(r), top / 2))
            # Corrimano che segue il profilo: il bordo scalinato è la
            # silhouette caratteristica della tribuna vista di lato.
            # Affonda di EPS nel fianco invece di poggiarvi esattamente.
            kit.box('steel', (0.3, ROW_DEPTH, 0.5), (x, _row_y(r), top + 0.25 - EPS))
        # Raccordo tra l'ultima fila e la parete di fondo.
        y_gap0 = _row_y(ROWS - 1) + ROW_DEPTH / 2
        y_gap1 = D / 2 - 0.8
        if y_gap1 > y_gap0:
            top = _row_top(ROWS - 1) + 0.9
            kit.box('concrete', (0.8, y_gap1 - y_gap0, top),
                    (x, (y_gap0 + y_gap1) / 2, top / 2))


def _shell(kit, shell_h=H):
    """Basamento, parete di fondo, parapetto e fascia sponsor.
    shell_h < H nelle varianti che aggiungono una copertura sopra il guscio."""
    # Basamento più stretto del modulo di lato e arretrato sul retro (i
    # fianchi e la parete di fondo devono sporgere oltre il suo filo, non
    # essere complanari), ma a filo esatto sul FRONTE: arretrandolo anche lì
    # restava un sottosquadro aperto sotto il parapetto, cioè un altro buco.
    kit.box('concreteDark', (W - 0.4, D - 0.2, BASE_H), (0, -0.1, BASE_H / 2))
    kit.box('concrete', (W, 0.8, shell_h), (0, D / 2 - 0.4, shell_h / 2))
    # Profondo 0.68 e non 0.3: deve arrivare a toccare il primo gradone,
    # altrimenti resta una fessura passante sul vuoto sotto la gradinata.
    # Largo W-0.8 per restare dentro i fianchi, e affondato di EPS nel
    # basamento: nessuna faccia complanare con nessuno dei due.
    kit.box('steel', (W - 0.8, 0.68, 1.2 + EPS), (0, Y_FRONT + 0.36, BASE_H + 0.6 - EPS / 2))
    kit.box('red', (16.0, 0.25, 1.0), (0, Y_FRONT - 0.05, BASE_H + 0.6))
    # Riquadri chiari sulla fascia: spezzano la barra rossa piatta e la
    # fanno leggere come una serie di pannelli sponsor.
    for i in range(5):
        kit.box('white', (1.3, 0.12, 0.62), ((i - 2) * 3.1, Y_FRONT - 0.2, BASE_H + 0.6))


def _ribs(kit, shell_h=H):
    """Costoloni verticali sulla parete di fondo. Senza, il retro è una
    lastra liscia senza scala leggibile: sono loro a dare il carattere
    'boxy ma dettagliato' visto da fuori pista. Sui fianchi non servono
    più: li sostituisce il profilo scalinato."""
    for x in (-6.0, -3.0, 0.0, 3.0, 6.0):
        kit.box('concreteDark', (0.7, 0.3 + EPS, shell_h), (x, D / 2 + 0.15 - EPS, shell_h / 2))


def _coping(kit, shell_h=H):
    """Coronamento sulla parete di fondo: chiude il profilo in alto e
    definisce il piano d'appoggio del modulo impilato sopra
    (buildMainGrandstandLayout impila 2 livelli)."""
    kit.box('concreteDark', (W + 1.2, 0.6 + EPS, 0.4), (0, D / 2 + 0.3 - EPS, shell_h - 0.2))


def _body(kit, shell_h=H):
    """Corpo comune alle tre varianti: guscio, gradinata, fianchi scalinati,
    corridoio e costoloni. Il coronamento NO: nelle varianti coperte lo
    sostituisce la falda, e due volumi sovrapposti lassù darebbero facce
    complanari.

    `shell_h` è l'altezza della parete di fondo. Nelle varianti coperte deve
    arrivare FIN SOTTO la falda: lasciandola a H restava un vuoto di 3.5
    unità fra il tetto del corpo e la tettoia, attraversato solo dai montanti
    — visto da dietro sembrava una struttura sfondata (segnalato dall'utente
    con screenshot in gioco; nei render di approvazione, tutti frontali, non
    si notava)."""
    _shell(kit, shell_h)
    _tiers(kit)
    _side_walls(kit)
    _aisle_steps(kit)
    _ribs(kit, shell_h)


def build_grand_stand(kit):
    _body(kit)
    _coping(kit)
    return W, H


# --- Variante con tettoia sporgente ---------------------------------------
AWNING_Z = 15.5       # quota della falda
AWNING_FRONT = -7.0   # sporge 1 unità oltre il fronte del modulo
# 5.9 e non 2.0: la falda si fermava quattro unità PRIMA della parete di
# fondo (spessa 0.8, centrata a D/2 - 0.4 = 5.6, quindi fascia 5.2-6.0).
# Restavano scoperte le ultime tre file di gradoni e — più visibile — i
# montanti posteriori, che nascono a 5.6, non toccavano nulla: a render si
# leggevano come una seconda trave sospesa nel vuoto (segnalato dall'utente
# in gioco). A 5.9 la falda ci appoggia sopra affondandovi, senza facce
# complanari: la stessa regola anti z-fighting seguita da tutto il file.
AWNING_BACK = 5.9
AWNING_H = 16.0


def build_grand_stand_awning(kit):
    """Tettoia a sbalzo sopra la gradinata, retta da due pilastri anteriori
    a tutta altezza e da due montanti che nascono dalla parete di fondo.
    Non impilabile: la sporgenza è voluta (per questo il layout in
    trackScenery.js impila solo la variante base)."""
    _body(kit, AWNING_Z - 0.25)
    depth = AWNING_BACK - AWNING_FRONT
    mid_y = (AWNING_FRONT + AWNING_BACK) / 2
    x_post = W / 2 - 0.4

    kit.box('white', (W + 1.2, depth, 0.5), (0, mid_y, AWNING_Z))
    for side in (-1, 1):
        # Trave longitudinale sotto la falda, affondata di EPS in essa.
        kit.box('steel', (0.4, depth, 0.5), (side * x_post, mid_y, AWNING_Z - 0.5 + EPS))
        # Pilastro anteriore da terra fino alla falda.
        kit.box('steel', (0.7, 0.7, AWNING_H), (side * x_post, AWNING_FRONT + 0.4, AWNING_H / 2))
        # Montante posteriore, dalla sommità della parete di fondo alla falda.
        kit.box('steel', (0.6, 0.6, AWNING_Z - H + 1.0),
                (side * x_post, D / 2 - 0.4, (AWNING_Z + H - 1.0) / 2))
    return W, AWNING_H


# --- Variante completamente coperta ---------------------------------------
COVERED_Z = 14.1      # intradosso della falda
COVERED_H = 14.7


def build_grand_stand_covered(kit):
    """Copertura piena su pilastri: il retro resta chiuso dalla parete di
    fondo, il fronte è retto da due pilastri in cemento a tutta altezza."""
    _body(kit, COVERED_Z)
    x_post = W / 2 - 0.4

    kit.box('concrete', (W + 1.2, D + 1.0, 0.6), (0, 0.2, COVERED_Z + 0.3))
    for side in (-1, 1):
        # Pilastro anteriore: alto fino DENTRO la falda, non a filo. Y a
        # +0.5 e non +0.45: a +0.45 la faccia anteriore cadeva esattamente su
        # Y_FRONT, complanare con la testata del fianco che sta lì sotto —
        # z-fighting (trovato da circuitAssetsBlackCheck.py).
        kit.box('concrete', (0.9, 0.9, COVERED_Z + 0.2),
                (side * x_post, Y_FRONT + 0.5, (COVERED_Z + 0.2) / 2))
        # Ritto posteriore, dalla parete di fondo alla falda.
        kit.box('concrete', (0.9, 0.9, COVERED_Z - H + 1.2),
                (side * x_post, D / 2 - 0.4, (COVERED_Z + H - 1.2) / 2))
    # Fascia sul bordo della falda: dà spessore alla copertura vista da fuori.
    kit.box('red', (W + 1.2, 0.35, 0.8), (0, Y_FRONT - 0.32, COVERED_Z + 0.1))
    return W, COVERED_H
