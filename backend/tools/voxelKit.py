"""
Libreria condivisa per la scultura voxel degli asset del circuito F1.
Stessa tecnica di backend/tools/f1CarBuilder.py (primitive box + scale non
uniformi + transform_apply), qui generalizzata e riusabile.

Convenzioni (vedi docs/superpowers/plans/2026-08-09-f1-circuit-voxel-assets.md):
  - si modella in unità di GIOCO (scala 1:1, nessuno scale all'istanza)
  - Blender Z-up: Z = altezza in gioco, -Y Blender = +Z gioco (il FRONTE)
  - base dell'asset a Z=0, centrato su X=0/Y=0
  - una mesh per colore (max 6 materiali: f1.js crea un InstancedMesh per mesh)

DUE CAUSE DI "MACCHIE NERE" A RENDER (entrambe viste sul primo asset):
  1. Cavità. Un volume che sembra pieno da fuori (una gradinata, un tetto,
     un basamento) va modellato PIENO fino a terra. Se è cavo, qualunque
     fessura lascia vedere l'interno non illuminato.
  2. Z-fighting. Due facce complanari nello stesso punto sfarfallano e
     anneriscono. Regola pratica, secondo il caso:
       - volumi che condividono il piano esterno (segmenti dello stesso
         muro, gradini dello stesso fianco): CONTIGUI, mai sovrapposti;
       - volumi che si compenetrano di proposito: la compenetrazione deve
         essere di almeno EPS e le facce NON devono essere complanari.
     Sovrapposizione + facce complanari è sempre un bug.

  Diagnosi: render con ambiente bianco pieno e nessun sole. Se le macchie
  spariscono erano ombre; se restano, per localizzarle in coordinate mondo
  basta un raycast dalla camera sui pixel scuri (scene.ray_cast) — molto
  più rapido che ispezionare la geometria a mano.
"""
import bpy
import math
import os
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
GLB_DIR = os.path.join(REPO_ROOT, 'frontend', 'assets', 'custom', 'circuit')
RENDER_DIR = os.path.join(SCRIPT_DIR, 'renders', 'circuit')
CAR_GLB = os.path.join(REPO_ROOT, 'frontend', 'assets', 'custom', 'f1Car.glb')
CAR_SCALE = 3.5  # stesso fattore di carLoader.js: porta l'auto a 7.17 unità

# Compenetrazione minima fra volumi adiacenti (vedi "regola dei volumi pieni"
# in testa al file). Abbastanza da chiudere ogni fessura, abbastanza poco da
# non spostare visibilmente nulla a questa scala.
EPS = 0.04

# Le tinte NEUTRE sono state ricolorate il 2026-08-10 per il look cel-shaded
# (spec 2026-08-10-f1-art-direction-cel-shading-design.md). Motivo: sono il
# 71% delle superfici degli asset, e la correzione di saturazione che il gioco
# applica a runtime su di esse non può fare nulla — allontanare dal proprio
# luma un colore che ha già i tre canali uguali lo lascia identico (misurato:
# il cemento passava da 7,0% a 8,4% di saturazione). O si cambia il colore
# qui, o resta grigio.
# I nuovi valori conservano l'ordine di chiarezza dei vecchi: cambia la tinta,
# non il disegno degli oggetti. `tarmac` è ora identico all'asfalto della
# pista (ToonPalette.SURFACES.asphalt), che gli sta adiacente nei box.
# I colori già saturi (rosso, blu, giallo, vetro, incarnati) non sono stati
# toccati: su quelli la correzione a runtime funziona.
_HEX = {
    'concrete':     'D8D0C0',   # era C9C5BB
    'concreteDark': '9C9082',   # era 8D8980
    'steel':        '7D8FA3',   # era 6E7378
    'steelDark':    '3D4756',   # era 3A4045
    'white':        'F7F3E8',   # era F2F2EE
    'red':          'D6392F',
    'blue':         '2F6FB5',
    'yellow':       'F2C233',
    'green':        '4C8C3F',   # non usato da alcun asset
    'black':        '20242E',   # era 1E2124
    'tarmac':       '5E6B75',   # era 4A4E52 — ora uguale all'asfalto della pista
    'glass':        '7FB6D9',
    # Vegetazione. `leafMid` è volutamente identico al verde del prato
    # (ToonPalette.SURFACES.grass): alberi e terreno appartengono alla stessa
    # famiglia di verde, e a separarli pensano `leafDark` e la luce a fasce.
    # Un bosco di un solo verde si legge come una macchia piatta.
    'leafDark':     '2E7D4F',
    'leafMid':      '3FA86B',
    'bark':         '6B4A32',
    # Incarnati per le figure umane (spettatori, meccanici): due tonalità
    # per dare varietà alla folla senza sforare il limite di 6 materiali
    # per asset.
    'skin':         'E0AC7E',
    'skinDark':     '96603A',
    # Colore "livrea": segnaposto per le superfici che il gioco ricolora a
    # runtime col colore del giocatore (box ai pit). Il valore qui è solo il
    # default che si vede nei render — vedi frontend/shared/pitBoxLoader.js,
    # che cerca i materiali il cui nome finisce per "_livery".
    'livery':       'D6392F',
}


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _hex_to_linear(h):
    return tuple(_srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


PALETTE = {k: _hex_to_linear(v) for k, v in _HEX.items()}

# Roughness per materiale: il metallo riflette un po' più del cemento, il
# vetro molto di più. Nessun metallic > 0 (stile flat, vedi spec).
_ROUGHNESS = {'glass': 0.15, 'steel': 0.55, 'steelDark': 0.55, 'black': 0.85}
_DEFAULT_ROUGHNESS = 0.8


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras,
                 bpy.data.lights, bpy.data.images):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


class VoxelKit:
    """Accumula i pezzi di UN asset e li consolida in una mesh per colore."""

    def __init__(self, asset_id):
        self.asset_id = asset_id
        self.parts = []          # (materiale, oggetto)
        self.keep_separate = ()  # nomi da NON joinare (vedi finish/podium)
        self._materials = {}     # nome colore -> bpy material
        self._n = 0

    def _material(self, name):
        if name not in self._materials:
            if name not in PALETTE:
                raise KeyError(f'colore "{name}" non in PALETTE: {sorted(PALETTE)}')
            mat = bpy.data.materials.new(f'{self.asset_id}_{name}')
            mat.use_nodes = True
            bsdf = mat.node_tree.nodes.get('Principled BSDF')
            bsdf.inputs['Base Color'].default_value = (*PALETTE[name], 1.0)
            bsdf.inputs['Roughness'].default_value = _ROUGHNESS.get(name, _DEFAULT_ROUGHNESS)
            bsdf.inputs['Metallic'].default_value = 0.0
            self._materials[name] = mat
        return self._materials[name]

    def box(self, mat, size, center, rot=None):
        """size = dimensioni piene (sx, sy, sz), center = centro del volume.
        rot = rotazione in RADIANTI (rx, ry, rz), per i pochi casi in cui una
        forma allineata agli assi non basta (arti protesi, tiranti): lo stile
        resta boxy, ma un braccio che deve raggiungere un oggetto non può
        essere ortogonale. `size` è nello spazio locale del box, cioè lungo
        gli assi già ruotati."""
        bpy.ops.mesh.primitive_cube_add(size=1, location=center, rotation=rot or (0, 0, 0))
        obj = bpy.context.active_object
        self._n += 1
        obj.name = f'{self.asset_id}_{mat}_{self._n}'
        obj.scale = size
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        obj.data.materials.append(self._material(mat))
        bpy.ops.object.shade_flat()
        self.parts.append((mat, obj))
        return obj

    def cyl(self, mat, radius, depth, center, axis='Z', verts=12):
        """Cilindro voxel a poche facce (stesso stile delle ruote dell'auto)."""
        rot = {'Z': (0, 0, 0), 'X': (0, math.radians(90), 0), 'Y': (math.radians(90), 0, 0)}[axis]
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth,
                                            location=center, rotation=rot)
        obj = bpy.context.active_object
        self._n += 1
        obj.name = f'{self.asset_id}_{mat}_{self._n}'
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        obj.data.materials.append(self._material(mat))
        bpy.ops.object.shade_flat()
        self.parts.append((mat, obj))
        return obj

    def raggruppa(self, objs, nome):
        """Fonde più pezzi in un oggetto solo e gli dà un nome parlante.

        Serve a ciò che deve restare referenziabile nel .glb come UNA cosa:
        i cinque gruppi semaforo del ponte di partenza si accendono uno alla
        volta, quindi devono essere cinque mesh — non venti lenti sciolte
        (venti InstancedMesh lato gioco) e nemmeno un unico blocco rosso
        (che si accenderebbe tutto insieme).

        Il nome va poi messo in `keep_separate`, altrimenti finish() lo rifonde
        con gli altri pezzi dello stesso materiale."""
        mat = next(m for m, o in self.parts if o is objs[0])
        # La lista si ricalcola PRIMA della fusione: dopo, gli oggetti
        # assorbiti non esistono più e leggerne il nome solleva.
        resto = [(m, o) for m, o in self.parts if o not in objs]

        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        unito = bpy.context.active_object
        unito.name = nome
        self.parts = resto + [(mat, unito)]
        return unito

    def finish(self, keep_separate=()):
        """Join per colore + transform_apply completo. Gli oggetti il cui nome
        è in keep_separate NON vengono joinati (servono referenziabili per
        nome nel .glb, es. i gradini del podio)."""
        separate = [o for _, o in self.parts if o.name in keep_separate]
        groups = {}
        for mat, obj in self.parts:
            if obj.name in keep_separate:
                continue
            groups.setdefault(mat, []).append(obj)

        result = []
        for mat, objs in groups.items():
            bpy.ops.object.select_all(action='DESELECT')
            for o in objs:
                o.select_set(True)
            bpy.context.view_layer.objects.active = objs[0]
            if len(objs) > 1:
                bpy.ops.object.join()
            merged = bpy.context.active_object
            merged.name = f'{self.asset_id}_{mat}'
            result.append(merged)

        for obj in result + separate:
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

        if len(result) > 6:
            raise ValueError(f'{self.asset_id}: {len(result)} materiali, massimo 6 '
                             '(f1.js crea un InstancedMesh per mesh)')
        return result + separate


def export_glb(asset_id, objects):
    os.makedirs(GLB_DIR, exist_ok=True)
    path = os.path.join(GLB_DIR, f'{asset_id}.glb')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True)
    return path


def _point_camera(cam, target):
    direction = Vector(target) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def setup_preview_scene(span):
    """Terreno + sole + cielo. span = dimensione dell'asset, serve solo a
    dimensionare il piano d'appoggio."""
    ground_size = max(40.0, span * 4)
    bpy.ops.mesh.primitive_plane_add(size=ground_size, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = 'preview_ground'
    mat = bpy.data.materials.new('preview_ground_mat')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*PALETTE['green'], 1.0)
    bsdf.inputs['Roughness'].default_value = 0.9
    ground.data.materials.append(mat)

    sun = bpy.data.lights.new('sun', type='SUN')
    sun.energy = 3.5
    sun_obj = bpy.data.objects.new('sun', sun)
    bpy.context.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(52), 0, math.radians(40))

    bpy.context.scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.62, 0.72, 1)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 640
    scene.render.image_settings.file_format = 'PNG'


def add_scale_reference(offset_x):
    """Importa l'auto di gioco accanto all'asset: il gate di approvazione è
    sulle proporzioni, e senza un riferimento noto un render isolato non dice
    nulla sulla scala."""
    if not os.path.exists(CAR_GLB):
        return
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=CAR_GLB)
    imported = [o for o in bpy.context.scene.objects if o not in before]
    roots = [o for o in imported if o.parent is None]
    for obj in roots:
        obj.scale = (CAR_SCALE, CAR_SCALE, CAR_SCALE)
        obj.location = (offset_x, 0, 0)
    # f1Car.glb ha l'origine a metà altezza, non alla base (misurato: bbox
    # grezza da z=-0.26 a z=0.25) — senza questa correzione l'auto di
    # riferimento affonda di quasi un metro nel terreno del render.
    bpy.context.view_layer.update()
    low = min((obj.matrix_world @ Vector(c)).z
              for obj in imported if obj.type == 'MESH' for c in obj.bound_box)
    for obj in roots:
        obj.location.z -= low


def render_3q(asset_id, span, height, with_car=True):
    """Vista 3/4 con inquadratura calcolata dall'ingombro dell'asset."""
    os.makedirs(RENDER_DIR, exist_ok=True)
    car_offset = span * 0.5 + 6
    setup_preview_scene(span + (car_offset if with_car else 0))
    if with_car:
        add_scale_reference(car_offset)

    cam_data = bpy.data.cameras.new(f'cam_{asset_id}')
    cam_obj = bpy.data.objects.new(f'cam_{asset_id}', cam_data)
    bpy.context.collection.objects.link(cam_obj)

    # Distanza ricavata dal campo visivo reale, non da un moltiplicatore a
    # occhio. Attenzione: cam_data.angle è il FOV del lato LUNGO (qui
    # l'orizzontale, il render è landscape); usarlo per un ingombro verticale
    # taglia fuori gli asset alti e stretti — la torre di direzione, alta 34,
    # usciva dall'inquadratura. Si dimensiona quindi sul FOV più stretto dei
    # due, inquadrando la sfera che circoscrive l'asset.
    scene = bpy.context.scene
    aspect = scene.render.resolution_x / scene.render.resolution_y
    tan_h = math.tan(cam_data.angle / 2)
    tan_min = min(tan_h, tan_h / aspect)

    target = Vector((0, 0, height / 2))
    # Raggio della sfera circoscritta, senza fattori di riduzione: ridurlo
    # per "riempire meglio" il fotogramma tagliava gli asset molto allungati
    # in verticale, dove la radice è dominata dall'altezza (il pylon, alto 26,
    # perdeva la testa del pannello).
    radius = math.sqrt((span / 2) ** 2 * 2 + (height / 2) ** 2)
    direction = Vector((0.60, -0.72, 0.34)).normalized()
    cam_obj.location = target + direction * (radius / tan_min)
    _point_camera(cam_obj, target)

    scene = bpy.context.scene
    scene.camera = cam_obj
    path = os.path.join(RENDER_DIR, f'{asset_id}.png')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path
