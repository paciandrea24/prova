"""Cartelloni sponsor: variante alta sospesa e variante bassa a bordo pista.

Il fronte (faccia con la grafica) guarda -Y Blender = +Z gioco, la direzione
verso cui trackScenery.js orienta l'asset.
"""
from voxelKit import EPS

W = 16.0          # larghezza del pannello
FRAME_W = 16.4    # cornice, leggermente più larga del pannello


def _panel_graphics(kit, z_center, panel_half_depth, tile_w, tile_h, count=5):
    """Riquadri sponsor alternati sulla faccia anteriore. Affondano di EPS
    nel pannello: staccati resterebbero una lamina sospesa nel vuoto."""
    step = W / count
    for i in range(count):
        x = (i - (count - 1) / 2) * step
        mat = 'red' if i % 2 == 0 else 'blue'
        kit.box(mat, (tile_w, 0.12, tile_h), (x, -panel_half_depth - 0.06 + EPS, z_center))


def build_billboard(kit):
    """Cartellone alto: pannello sospeso su due montanti, lungo il rettilineo
    di partenza. Il pannello parte a 7 unità da terra — sopra l'altezza di
    un'auto (1.79) con ampio margine, come i cartelloni veri."""
    panel_z0, panel_h = 7.0, 5.5
    panel_zc = panel_z0 + panel_h / 2
    half_d = 0.25

    kit.box('white', (W, half_d * 2, panel_h), (0, 0, panel_zc))
    _panel_graphics(kit, panel_zc, half_d, 2.8, 4.5)

    # Cornice sopra e sotto, affondata di EPS nel pannello.
    for z in (panel_z0 - 0.2 + EPS, panel_z0 + panel_h + 0.2 - EPS):
        kit.box('steelDark', (FRAME_W, 0.7, 0.4), (0, 0, z))

    for side in (-1, 1):
        # Montante fin dentro il pannello, e piede fin dentro il montante.
        kit.box('steel', (0.8, 0.8, panel_z0 + 0.4), (side * 5.0, 0, (panel_z0 + 0.4) / 2))
        kit.box('concreteDark', (2.2, 1.6, 0.6), (side * 5.0, 0, 0.3))

    return FRAME_W, panel_z0 + panel_h + 0.4


def build_billboard_low(kit):
    """Cartellone basso a bordo pista: stessa logica, senza montanti alti."""
    panel_z0, panel_h = 1.2, 3.0
    panel_zc = panel_z0 + panel_h / 2
    half_d = 0.2

    kit.box('white', (W, half_d * 2, panel_h), (0, 0, panel_zc))
    _panel_graphics(kit, panel_zc, half_d, 4.4, 2.2, count=3)

    for z in (panel_z0 - 0.175 + EPS, panel_z0 + panel_h + 0.175 - EPS):
        kit.box('steelDark', (FRAME_W, 0.6, 0.35), (0, 0, z))

    for x in (-6.0, -2.0, 2.0, 6.0):
        kit.box('concreteDark', (1.4, 1.4, panel_z0 + 0.2), (x, 0, (panel_z0 + 0.2) / 2))

    return FRAME_W, panel_z0 + panel_h + 0.35
