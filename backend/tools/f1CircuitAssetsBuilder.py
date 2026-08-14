"""
Costruisce gli asset voxel del circuito F1 (vedi
docs/superpowers/specs/2026-08-09-f1-circuit-voxel-assets-design.md).

Uso (dalla root del repo):
    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
        --python backend/tools/f1CircuitAssetsBuilder.py -- --asset grandStand

Senza --asset costruisce tutti gli asset del registry.
Con --no-render salta i render (build veloce, per i soli test tecnici).

Output:
    frontend/assets/custom/circuit/<assetId>.glb
    backend/tools/renders/circuit/<assetId>.png
"""
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import voxelKit  # noqa: E402
from circuitAssets import ASSET_BUILDERS  # noqa: E402
from circuitAssets import grandstands  # noqa: E402
from circuitAssets import infrastructure  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
wanted = None
if '--asset' in argv:
    wanted = argv[argv.index('--asset') + 1].split(',')
do_render = '--no-render' not in argv

ids = wanted or list(ASSET_BUILDERS)
unknown = [a for a in ids if a not in ASSET_BUILDERS]
if unknown:
    raise SystemExit(f'asset sconosciuti: {unknown}. Disponibili: {sorted(ASSET_BUILDERS)}')

for asset_id in ids:
    voxelKit.clear_scene()
    kit = voxelKit.VoxelKit(asset_id)
    span, height = ASSET_BUILDERS[asset_id](kit)
    objects = kit.finish(keep_separate=kit.keep_separate)
    glb = voxelKit.export_glb(asset_id, objects)
    print(f'[circuitAssets] {asset_id}: {len(objects)} mesh -> {glb}')
    if do_render:
        png = voxelKit.render_3q(asset_id, span, height)
        print(f'[circuitAssets] {asset_id}: render -> {png}')

print(f'[circuitAssets] completati {len(ids)} asset')

# Posizioni dei posti a sedere delle tribune, per istanziare gli spettatori
# a runtime senza doverli cuocere dentro il .glb della tribuna. Scritto
# sempre, anche con --asset: è un dato derivato dalla geometria, non dal build.
seats = grandstands.seat_anchors()
seats_path = os.path.join(voxelKit.GLB_DIR, 'grandStandSeats.json')
with open(seats_path, 'w', encoding='utf-8') as f:
    json.dump({
        'comment': ('Posizioni dei posti a sedere in coordinate GIOCO, relative '
                    "all'origine della tribuna (pivot dello spettatore ai piedi). "
                    'Generato da backend/tools/f1CircuitAssetsBuilder.py — non '
                    'modificare a mano.'),
        'appliesTo': ['grandStand', 'grandStandAwning', 'grandStandCovered'],
        'seatCount': len(seats),
        'seats': seats,
    }, f, indent=1)
print(f'[circuitAssets] {len(seats)} posti a sedere -> {seats_path}')

# Ancore degli spettatori sulle terrazze delle infrastrutture. Stesso motivo
# del file dei sedili: dato derivato dalla geometria, scritto sempre.
anchors = infrastructure.terrace_anchors()
anchors_path = os.path.join(voxelKit.GLB_DIR, 'terraceAnchors.json')
with open(anchors_path, 'w', encoding='utf-8') as f:
    json.dump({
        'comment': ('Posizioni degli spettatori in piedi sulle terrazze, in '
                    "coordinate GIOCO relative all'origine dell'asset (pivot "
                    'della figura ai piedi). Generato da '
                    'backend/tools/f1CircuitAssetsBuilder.py - non modificare a mano.'),
        'anchors': anchors,
    }, f, indent=1)
print(f'[circuitAssets] ancore terrazze -> {anchors_path}')
