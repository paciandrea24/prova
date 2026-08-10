"""Vegetazione: masse di bosco per il fondale.

PERCHÉ ESISTE UNA "MASSA" E NON SOLO ALBERI. Un albero del catalogo è largo
2-8 unità: a 500 unità di distanza occupa una frazione di grado, e per fare un
fondale continuo ne servirebbero migliaia (misurato: ~4500 con gli alberi
attuali). Una macchia larga 70 ne sostituisce una trentina e a quella distanza
si legge allo stesso modo, perché i tronchi non si distinguono comunque.
Servono ~150 istanze invece di 4500.

Va usata SOLO in lontananza (oltre ~300 unità dalla pista); davanti restano
alberi veri, che fanno da transizione.

Come ogni asset ad alta istanza: pochi materiali (qui 2) e pochi volumi.
Fronte verso -Y Blender = +Z gioco, pivot alla base.
"""
from voxelKit import EPS

# Ingombro complessivo. La profondità è quasi pari alla larghezza perché la
# macchia va vista da angoli diversi mentre si percorre il giro: una quinta
# sottile si tradirebbe di fianco.
MASS_W = 70.0
MASS_D = 46.0
# Corpo compatto sotto, chiome irregolari sopra: è lo stacco fra i due che
# fa leggere una foresta invece di un parallelepipedo verde.
BODY_H = 30.0
CANOPY_TOP = 45.0

# Chiome: (dx, dz, larghezza, profondità, altezza). Le misure sono tutte
# diverse fra loro di proposito — due blocchi uguali affiancati si riconoscono
# subito come copie, e nessuna faccia deve risultare complanare con quella
# accanto (è la causa nota delle macchie nere nei render di controllo).
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

# Sporgenze che rompono il bordo dritto del corpo: senza, la base della
# macchia resta una linea retta lunga 70 unità, che a fondale si nota.
_SKIRTS = (
    (-30.0, 17.0, 16.0, 10.0, 18.0),
    (26.0, -16.0, 14.0, 11.0, 21.0),
    (-2.0, 21.0, 19.0, 9.0, 15.0),
    (33.0, 4.0, 9.0, 13.0, 16.0),
)


def build_wood_mass(kit):
    # Corpo: il volume compatto che nasconde l'orizzonte. Scuro, perché è la
    # parte in ombra sotto le chiome.
    kit.box('leafDark', (MASS_W - 8.0, MASS_D - 8.0, BODY_H), (0, 0, BODY_H / 2))

    # Sporgenze laterali, affondate nel corpo di EPS.
    for dx, dz, w, d, h in _SKIRTS:
        kit.box('leafDark', (w, d, h), (dx, dz, h / 2))

    # Chiome: appoggiate sul corpo con una compenetrazione generosa, così fra
    # una e l'altra non resta mai una fessura da cui si vede il cielo.
    for dx, dz, w, d, h in _CANOPIES:
        kit.box('leafMid', (w, d, h), (dx, dz, BODY_H - 3.0 + h / 2))

    return MASS_W, CANOPY_TOP
