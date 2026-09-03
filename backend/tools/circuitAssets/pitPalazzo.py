"""Il palazzo dei box: un edificio solo, costruito a fette (spec 2026-09-03).

Garage al piano terra, club dei VIP al primo piano. Il fronte guarda
-Y Blender = +Z gioco, come gli edifici della corsia.

⚠️ QUESTE NON SONO QUATTRO CASE: sono quattro FETTE dello stesso edificio,
accostate a passo 7.5. Quindi non hanno fine-corsa laterali — niente pilastro
d'angolo, niente cornice che chiuda i fianchi — tranne `pitClubHead`, che è
fatto apposta per stare a un capo. Un fianco disegnato su una fetta normale
comparirebbe venticinque volte in fila, ed è esattamente il difetto per cui
l'alternanza dei due tetti è stata bocciata.

⚠️ LARGHEZZA 7.3 CONTRO UN PASSO DI 7.5. Il gioco meccanico è voluto: due
lastre piene che si compenetrano danno facce complanari, cioè z-fighting. La
stessa regola delle facciate della città (8.7 contro 9).

⚠️ `build_pit_club_span` è il SOLO primo piano, e il suo pivot sta alla base
del primo piano, non a terra: chi lo posa lo mette a quota SOLAIO_Z. Sotto ci
va il box colorato del giocatore, che è alto 10 e non è scenografia — lo carica
pitBoxLoader.js, non trackScenery.

Nota sulle quote: come in pitBuildings, nessun volume aggettante condivide un
piano esterno con un altro. Gli sbalzi sono volutamente tutti diversi.
"""
from voxelKit import EPS

# Passo delle fette: mezzo passo di box (TrackGeometry.PIT_BOX_SPACING = 15).
# Il modello è più stretto del passo, di proposito.
PASSO = 7.5
W = 7.3
D = 22.0
HALF_W = W / 2
HALF_D = D / 2
FRONT = -HALF_D             # verso la corsia box

SOLAIO_Z = 11.0             # i box dei piloti sono alti 10: ci passa sopra
SOLAIO_H = 0.7
PIANO_H = 6.0               # dal solaio al cornicione
PARAPETTO_H = 0.9
BALCONE_SPORGENZA = 1.6     # quanto la balconata esce oltre la facciata


def _piano_terra(kit):
    """Il garage: corpo pieno, serranda sul fronte, zoccolo. Manca del tutto
    su `pitClubSpan`, dove sotto c'è il box del giocatore."""
    kit.box('concrete', (W, D, SOLAIO_Z), (0, 0, SOLAIO_Z / 2))
    # ⚠️ Lo zoccolo sporge solo in PROFONDITA', mai in larghezza: un aggetto
    # laterale, per piccolo che sia, entra nella fetta vicina — il passo e' 7.5
    # e il corpo ne misura 7.3.
    kit.box('concreteDark', (W, D + 0.3, 0.5), (0, 0, 0.25))

    # Serranda incassata nel fronte: affonda di EPS, non appoggia a filo.
    # ⚠️ La serranda sta su DUE materiali, non tre: la lastra scura e le doghe
    # in concreteDark. Il tono d'acciaio chiaro era il settimo materiale
    # dell'asset, e il limite e' sei — un InstancedMesh per mesh in f1.js.
    kit.box('steelDark', (W - 1.4, 0.4, 6.4), (0, FRONT - 0.15 + EPS, 3.4))
    for i in range(6):
        kit.box('concreteDark', (W - 1.4, 0.15, 0.22),
                (0, FRONT - 0.32 + EPS, 0.9 + i * 1.05))
    # Architrave: chiude la serranda in alto invece di lasciarla finire sul muro.
    kit.box('concreteDark', (W - 0.9, 0.3, 0.35), (0, FRONT - 0.2 + EPS, 6.85))


def _primo_piano(kit, z0):
    """La parte cara, uguale su tutte le fette: solaio a sbalzo, loggia
    vetrata arretrata, due pilastri sul filo, balconata e parapetto.

    È questo che, ripetuto, deve leggersi come un edificio unico: nessun
    elemento si chiude sui fianchi, tutto corre da una fetta all'altra."""
    # Solaio a sbalzo: sporge oltre la facciata di BALCONE_SPORGENZA, ed è
    # quello che da fuori legge come una linea continua per tutto il palazzo.
    kit.box('white', (W, D + BALCONE_SPORGENZA, SOLAIO_H),
            (0, -BALCONE_SPORGENZA / 2, z0 + SOLAIO_H / 2))

    zp = z0 + SOLAIO_H
    # Il corpo dietro la vetrata: il salone vero.
    kit.box('white', (W, D - 2.2, PIANO_H), (0, 1.1, zp + PIANO_H / 2))
    # Vetrata ARRETRATA rispetto al filo delle lesene, e ALZATA dal pavimento:
    # con la lastra che partiva dal piano di calpestio la loggia leggeva come
    # una teca di vetro appesa. Una fascia piena sotto e una sopra la fanno
    # tornare una finestra a nastro, che è quello che corre da una fetta
    # all'altra senza interruzione.
    vetro_h = PIANO_H - 2.4
    kit.box('glass', (W - 0.6, 0.5, vetro_h), (0, FRONT + 1.9, zp + 1.2 + vetro_h / 2))

    # ⚠️ LE LESENE STANNO A CAVALLO DEL GIUNTO, ed è la ragione per cui
    # esistono. Il primo render mostrava dieci blocchi affiancati: la fessura di
    # 0.2 fra due fette cadeva in mezzo a una superficie liscia e si leggeva
    # come una cucitura. Messa a filo del bordo, mezza lesena per fetta, due
    # fette vicine ne compongono UNA sola larga 1.4 col giunto dentro — e in
    # curva è la lesena ad assorbire l'apertura.
    #
    # Grigie contro il bianco: il ritmo diventa architettura invece di
    # sembrare il segno di dove finisce un pezzo e comincia il successivo.
    for sx in (-1, 1):
        kit.box('concreteDark', (0.6, 1.4, PIANO_H + 0.5),
                (sx * (HALF_W - 0.3), FRONT - 0.9, zp + (PIANO_H + 0.5) / 2))
    # Balconata: il piano di calpestio davanti alla vetrata, dove sta la gente.
    kit.box('concreteDark', (W, BALCONE_SPORGENZA + 0.6, 0.3),
            (0, FRONT - BALCONE_SPORGENZA / 2 + 0.1, zp + 0.15))
    # Parapetto pieno sul filo, con la banda dorata: è il segno «qui è la parte
    # cara», lo stesso della vipSuite e del salotto di pitClub.py.
    y_par = FRONT - BALCONE_SPORGENZA + 0.15
    kit.box('white', (W, 0.25, PARAPETTO_H), (0, y_par, zp + 0.3 + PARAPETTO_H / 2))
    kit.box('yellow', (W, 0.32, 0.22), (0, y_par, zp + 0.3 + PARAPETTO_H - 0.11))
    # Cornicione in cima: chiude il piano.
    #
    # ⚠️ LARGO QUANTO IL CORPO, non di piu'. L'avevo fatto sporgere di 0.35
    # «per coprire il giunto in curva»: portava la fetta a 7.65 contro un passo
    # di 7.5, cioe' due cornicioni vicini che si compenetrano di 0.15 con le
    # facce superiori complanari — z-fighting lungo tutto il palazzo, che e'
    # peggio della fessura che voleva nascondere.
    kit.box('white', (W, D - 1.8, 0.5), (0, 1.0, zp + PIANO_H + 0.25))
    return zp + PIANO_H + 0.5


def build_pit_club_bay(kit):
    """La fetta normale: garage sotto, club sopra."""
    _piano_terra(kit)
    top = _primo_piano(kit, SOLAIO_Z)
    return W, top


def build_pit_club_span(kit):
    """Solo il primo piano: scavalca il box colorato di un giocatore.

    ⚠️ Pivot alla base del PRIMO PIANO: z = 0 qui è la quota SOLAIO_Z del
    palazzo. Sotto non c'è niente di scolpito, quel volume appartiene a
    pitBox.glb."""
    top = _primo_piano(kit, 0.0)
    return W, top


def build_pit_club_head(kit):
    """La fetta di capo: come la normale, ma col fianco chiuso e la scala
    esterna. Ne esiste una per estremità del palazzo.

    ⚠️ Il fianco sta su UN lato solo (+X): all'altro capo la stessa fetta si
    posa ruotata di mezzo giro, e il fianco torna dalla parte giusta."""
    _piano_terra(kit)
    top = _primo_piano(kit, SOLAIO_Z)

    # Fianco pieno: chiude il palazzo invece di mostrarne la sezione.
    #
    # ⚠️ STA DENTRO LA LARGHEZZA, non oltre. Sporgendo di mezza unità oltre
    # HALF_W la testa misurava 9.38 invece di 7.3 (+28%, fuori dal ±20% del
    # target) e, cosa peggiore, invadeva la fetta vicina: al passo di 7.5 non
    # c'è niente da prendere in prestito ai lati.
    kit.box('concrete', (0.5, D, top - 0.4), (HALF_W - 0.25, 0, (top - 0.4) / 2))

    # ⚠️ NIENTE CORPO SCALA SUL RETRO. Ne avevo messo uno profondo 1.5, e su
    # `citta-prova` la testa sfondava di 2.9 unità dentro le facciate della
    # città: là il nastro che chiude la vista corre proprio dietro il palazzo,
    # e ogni decimo di profondità in più finisce dentro il muro del mondo.
    #
    # La porta di servizio resta, sul fianco chiuso: il fianco di una testa
    # guarda SEMPRE verso l'esterno del palazzo (lo garantisce
    # PitClubProfilo, misurando dove sta il vicino), quindi lì davanti non c'è
    # nessuna fetta da invadere — al contrario del retro, che è dove il
    # circuito mette le sue cose.
    kit.box('steelDark', (0.3, 1.2, 3.0), (HALF_W - 0.05 + EPS, FRONT + 4.0, 1.5))
    return W, top


def build_pit_club_tower(kit):
    """Il pezzo che rompe il ritmo: vano ascensore che sale di due unità sopra
    il cornicione, insegna verticale sul fronte. Una ogni 8-10 fette."""
    _piano_terra(kit)
    top = _primo_piano(kit, SOLAIO_Z)

    # Vano ascensore: è il solo volume del palazzo che supera il cornicione.
    kit.box('concreteDark', (W - 1.2, 4.0, 2.0), (0, 1.0, top + 1.0))
    # Insegna sul vano ascensore, non sul fronte del garage: là sotto cadeva
    # davanti alla serranda e sembrava un palo piantato davanti alla porta.
    kit.box('yellow', (0.7, 0.3, 1.6), (0, -1.0 + EPS, top + 1.0))
    return W, top + 2.0


# --- Dove sta la gente ----------------------------------------------------
# Stessa idea di pitClub.terrace_anchors(): le posizioni nascono dalla
# geometria del modello, così non possono divergerne. Coordinate GIOCO
# relative all'origine dell'asset — Blender (x, y, z) -> gioco (x, z, -y) —
# col pivot della figura ai piedi.
#
# ⚠️ Il fronte, che in Blender sta a -D/2, in gioco sta a +D/2: per questo i
# valori di z qui sotto sono positivi.
def _sulla_balconata(z_pavimento):
    """Due figure affacciate al parapetto, sfalsate rispetto ai pilastri: una
    figura piantata dentro un pilastro si vede, e i pilastri stanno a ±3.3."""
    z = HALF_D + BALCONE_SPORGENZA - 0.9
    return [
        {'x': -1.6, 'y': round(z_pavimento, 3), 'z': round(z, 3)},
        {'x': 1.6, 'y': round(z_pavimento, 3), 'z': round(z, 3)},
    ]


def terrace_anchors():
    # Il calpestio della balconata: solaio + il suo spessore + il piano di
    # calpestio. Su pitClubSpan il pivot è già alla quota del solaio, quindi
    # la stessa balconata sta più in basso di SOLAIO_Z.
    z_bay = SOLAIO_Z + SOLAIO_H + 0.3
    z_span = SOLAIO_H + 0.3
    return {
        'pitClubBay': _sulla_balconata(z_bay),
        'pitClubSpan': _sulla_balconata(z_span),
        'pitClubTower': _sulla_balconata(z_bay),
    }
