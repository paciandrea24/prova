// frontend/shared/pitBoxLoader.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const PitBoxLoader = require('./pitBoxLoader.js');
const { readGlbJson, inspectGlb } = require('../../backend/tools/glbInspect.js');

const GLB = path.join(__dirname, '..', 'assets', 'custom', 'circuit', 'pitBox.glb');

test('PitBoxLoader espone loadPitBoxModel e applyLiveryColor come funzioni', () => {
    assert.equal(typeof PitBoxLoader.loadPitBoxModel, 'function');
    assert.equal(typeof PitBoxLoader.applyLiveryColor, 'function');
});

// Il ricolore per giocatore agisce sul nome del materiale, non più sui texel
// di una texture palette: questi test bloccano la convenzione di naming.
test('isLiveryMaterialName riconosce SOLO il materiale livrea', () => {
    assert.equal(PitBoxLoader.isLiveryMaterialName('pitBox_livery'), true);
    assert.equal(PitBoxLoader.isLiveryMaterialName('pitBox_concrete'), false);
    assert.equal(PitBoxLoader.isLiveryMaterialName('pitBox_concreteDark'), false);
    assert.equal(PitBoxLoader.isLiveryMaterialName('pitBox_tarmac'), false);
    assert.equal(PitBoxLoader.isLiveryMaterialName('pitBox_steelDark'), false);
    assert.equal(PitBoxLoader.isLiveryMaterialName('pitBox_black'), false);
    assert.equal(PitBoxLoader.isLiveryMaterialName(undefined), false);
});

// Se il modello venisse rigenerato senza superfici livrea (o con un nome
// diverso), i box resterebbero tutti dello stesso colore e nessun test lo
// segnalerebbe: questo controlla il .glb REALE, non un mock.
test('il .glb del box contiene esattamente un materiale livrea', () => {
    const gltf = readGlbJson(GLB);
    const livery = gltf.materials.filter(m => PitBoxLoader.isLiveryMaterialName(m.name));
    assert.equal(livery.length, 1, `materiali: ${gltf.materials.map(m => m.name)}`);
});

// PIT_BOX_FRONT_HALF_DEPTH serve a piazzare il garage arretrato rispetto
// alla corsia: se il modello cambia profondità e la costante no, il box
// finisce sopra lo stallo dove si ferma l'auto.
test('PIT_BOX_FRONT_HALF_DEPTH corrisponde alla mezza profondità reale del modello', () => {
    const depth = inspectGlb(GLB).size[2];
    assert.ok(Math.abs(depth / 2 - PitBoxLoader.PIT_BOX_FRONT_HALF_DEPTH) < 0.6,
        `profondità ${depth}, mezza ${depth / 2}, costante ${PitBoxLoader.PIT_BOX_FRONT_HALF_DEPTH}`);
});

// --- Meccanici davanti al box ----------------------------------------------
// pitCrew e pitCrewKneel erano modellati ed esportati ma non comparivano in
// SCENERY_ASSET_PATHS né altrove: non sono mai stati cablati, e il box
// restava un garage vuoto.
test('i meccanici stanno davanti al box, mai dentro o dietro', () => {
    // Box a (0,0) col fronte verso +Z (convenzione di tutto il catalogo
    // custom): i meccanici devono stare fra il box e la corsia, cioè a z
    // positivo.
    const crew = PitBoxLoader.crewPlacements({ x: 0, y: 0, z: 0, rotY: 0 });
    assert.ok(crew.length >= 2, `solo ${crew.length} meccanici`);
    for (const c of crew) {
        assert.ok(['pitCrew', 'pitCrewKneel'].includes(c.asset), `asset inatteso ${c.asset}`);
        assert.ok(c.z > 0, `meccanico dentro o dietro al box (z = ${c.z})`);
        assert.ok(Math.hypot(c.x, c.z) < 20, 'meccanico troppo lontano dal box');
    }
});

test('la rotazione del box porta con sé i meccanici', () => {
    // Ruotato di 90°: quello che stava avanti (+z) deve finire avanti lungo
    // +x. Senza applicare la rotazione, i meccanici resterebbero davanti a un
    // box che ora guarda altrove — sospesi in mezzo alla corsia.
    const crew = PitBoxLoader.crewPlacements({ x: 0, y: 0, z: 0, rotY: Math.PI / 2 });
    for (const c of crew) {
        assert.ok(c.x > 0, `meccanico non ruotato col box (x = ${c.x.toFixed(2)})`);
        assert.ok(Math.abs(c.rotY - Math.PI / 2) < 1e-9, 'meccanico non orientato come il box');
    }
});

test('i meccanici seguono la posizione del box', () => {
    const crew = PitBoxLoader.crewPlacements({ x: 100, y: 3, z: -50, rotY: 0 });
    for (const c of crew) {
        assert.ok(Math.hypot(c.x - 100, c.z + 50) < 20, 'meccanico lontano dal box traslato');
        assert.equal(c.y, 3, 'meccanico non alla quota del box');
    }
});

// Il difetto vero segnalato in playtest: "quelli in ginocchio entrano dentro
// la macchina". Stavano a lz = STALL_LZ con lx dentro la semilunghezza
// dell'auto, cioè esattamente sopra lo stallo dove l'auto si ferma.
test('nessun meccanico cade dentro l\'ingombro dell\'auto ferma nello stallo', () => {
    const crew = PitBoxLoader.crewPlacements({ x: 0, y: 0, z: 0, rotY: 0 });
    const halfL = PitBoxLoader.CAR_HALF_LENGTH;
    const halfW = PitBoxLoader.CAR_HALF_WIDTH;
    for (const c of crew) {
        // Con rotY=0 le coordinate mondo coincidono con quelle locali: x lungo
        // la corsia (lunghezza auto), z verso la corsia (larghezza auto).
        const dentroLunghezza = Math.abs(c.x) < halfL;
        const dentroLarghezza = Math.abs(c.z - PitBoxLoader.STALL_LZ) < halfW;
        assert.ok(!(dentroLunghezza && dentroLarghezza),
            `${c.asset} dentro l'auto: (${c.x.toFixed(2)}, ${c.z.toFixed(2)}) contro stallo a lz=${PitBoxLoader.STALL_LZ}`);
    }
});

test('i meccanici sono istanziati con la scala di presenza scenica', () => {
    for (const c of PitBoxLoader.crewPlacements({ x: 0, y: 0, z: 0, rotY: 0 })) {
        assert.equal(c.scale, PitBoxLoader.CREW_SCALE);
    }
});

// La distanza fra box e stallo è DERIVATA dai due margini: se qualcuno cambia
// PIT_BOX_OFFSET_MARGIN o PIT_STALL_CLEARANCE senza pensare ai meccanici,
// questi restano comunque agganciati all'auto.
test('STALL_LZ resta la differenza fra i margini di box e stallo', () => {
    const TrackGeometry = require('./trackGeometry.js');
    assert.equal(PitBoxLoader.STALL_LZ,
        PitBoxLoader.PIT_BOX_OFFSET_MARGIN - TrackGeometry.PIT_STALL_CLEARANCE);
});
