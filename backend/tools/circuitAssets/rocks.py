"""Massi e affioramenti rocciosi.

Riempiono il prato e i pendii dove un albero starebbe male, e danno varietà di
MATERIALE oltre che di sagoma: sono gli unici elementi naturali non verdi.

Come per le chiome (vedi vegetation.py), la forma nasce da molti volumi
piccoli e mai da un blocco solo: un masso credibile non ha due facce parallele
adiacenti, altrimenti si legge come una scatola grigia. Qui in più i pezzi
sono ruotati anche fuori dall'asse verticale, cosa che con le chiome non
serviva e con la roccia sì — è lo strapiombo a dire "pietra".

Asset ad alta istanza: massimo 2 materiali.
Fronte verso -Y Blender = +Z gioco, pivot alla base.
"""
import math


def _rng(seed):
    state = [seed & 0xFFFFFFFF]

    def nxt():
        state[0] = (1103515245 * state[0] + 12345) & 0x7FFFFFFF
        return state[0] / 0x7FFFFFFF
    return nxt


def _masso(kit, seed, center, radii, count, voxel):
    """Ammasso di blocchi irregolari attorno a un centro.

    A differenza delle chiome, i blocchi riempiono il VOLUME e non solo il
    guscio: una roccia cava si tradirebbe al primo spigolo, e i pezzi sono
    abbastanza grandi da non farne una nuvola di cubetti.
    """
    rnd = _rng(seed)
    cx, cy, cz = center
    rx, ry, rz = radii
    for i in range(count):
        # Distribuzione nel volume, addensata verso il centro: i pezzi esterni
        # sporgono e fanno la silhouette, quelli interni chiudono i vuoti.
        k = rnd() ** 0.6
        a = rnd() * 2 * math.pi
        b = math.acos(2 * rnd() - 1)
        x = cx + math.sin(b) * math.cos(a) * rx * k
        y = cy + math.sin(b) * math.sin(a) * ry * k
        z = cz + math.cos(b) * rz * k
        lato = voxel[0] + (voxel[1] - voxel[0]) * rnd()
        dy = lato * (0.7 + 0.6 * rnd())
        dz = lato * (0.55 + 0.5 * rnd())
        # Inclinazioni piccole ma su tutti e tre gli assi: bastano pochi gradi
        # a togliere l'aria di scatola, e più di così i pezzi si
        # staccherebbero l'uno dall'altro. Vanno estratte PRIMA del clamp,
        # perché servono a calcolarlo.
        ax = math.radians((rnd() - 0.5) * 26)
        ay = math.radians((rnd() - 0.5) * 26)
        az = math.radians(rnd() * 90)
        # I pezzi non scendono sotto terra e nemmeno fluttuano: il pivot sta
        # alla base. L'estensione verticale di un blocco INCLINATO non è la sua
        # mezza altezza — vanno sommate le proiezioni degli altri due lati.
        # Stimarla a occhio ha prodotto prima massi interrati di 10 cm e poi
        # massi sollevati di 6: qui è esatta.
        mezza = (dz * math.cos(ax) * math.cos(ay)
                 + dy * abs(math.sin(ax))
                 + lato * abs(math.sin(ay))) / 2
        z = max(z, mezza)
        kit.box('concrete' if i % 3 == 0 else 'concreteDark',
                (lato, dy, dz), (x, y, z), rot=(ax, ay, az))


def build_rock_single(kit):
    """Masso singolo: si piazza nel prato, dove un albero coprirebbe troppo."""
    _masso(kit, 4409, (0, 0, 0.75), (0.95, 0.8, 0.55), 9, (0.9, 1.5))
    return 2.6, 1.8


def build_rock_cluster(kit):
    """Gruppo di tre massi di taglia diversa: due uguali affiancati si
    leggerebbero come una coppia artificiale."""
    _masso(kit, 7717, (-1.4, 0.3, 0.7), (0.9, 0.8, 0.5), 8, (0.9, 1.4))
    _masso(kit, 2251, (1.2, -0.4, 1.05), (0.8, 0.7, 0.75), 9, (0.8, 1.3))
    _masso(kit, 6113, (0.2, 1.0, 0.45), (0.7, 0.6, 0.35), 6, (0.6, 1.0))
    return 5.5, 2.4
