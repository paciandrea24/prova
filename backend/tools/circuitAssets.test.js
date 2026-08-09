// backend/tools/circuitAssets.test.js
//
// Verifica tecnica degli asset voxel del circuito (vedi
// docs/superpowers/plans/2026-08-09-f1-circuit-voxel-assets.md).
// Non verifica l'estetica — quella passa dal render e dal gate utente.
// Rigenerare gli asset con:
//   blender --background --python backend/tools/f1CircuitAssetsBuilder.py
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { inspectGlb } = require('./glbInspect.js');

const GLB_DIR = path.join(__dirname, '..', '..', 'frontend', 'assets', 'custom', 'circuit');

// w = larghezza (X), h = altezza (Y), d = profondità (Z), in unità di gioco.
// Tolleranza ±20% sulle dimensioni: sono target di design, non contratti.
// centerTol (opzionale): scarto ammesso tra centro del bounding box e origine.
// Il default 0.6 impone asset simmetrici; si alza SOLO per asset in cui il
// pivot naturale non è il centro dell'ingombro (es. flagPole: si piazza
// l'asta, la bandiera sporge di lato).
const EXPECTED = {
    grandStand:        { w: 18, h: 12, d: 12 },
    // centerTol 1.2: la tettoia sporge di 2 unità oltre il fronte, quindi il
    // centro del bounding box cade spostato in Z. Il pivot giusto resta
    // quello del CORPO (allineato al modulo base), non del volume
    // complessivo — la tettoia è a sbalzo per definizione.
    grandStandAwning:  { w: 18, h: 16, d: 14, centerTol: 1.2 },
    grandStandCovered: { w: 18, h: 15, d: 12 },
    billboard:         { w: 16, h: 13, d: 1.6 },
    billboardLow:      { w: 16, h: 4.5, d: 1.4 },
    pitsGarageClosed:  { w: 20, h: 9, d: 14 },
    pitsOffice:        { w: 20, h: 13, d: 14 },
    raceControlTower:  { w: 14, h: 34, d: 12 },
    startGantry:       { w: 34, h: 16, d: 2.4 },
    podium:            { w: 12, h: 9, d: 7 },
    tyreStack:         { w: 7, h: 2.0, d: 2.6 },
    catchFence:        { w: 12, h: 9, d: 0.5 },
    marshalPost:       { w: 5.5, h: 9, d: 4.5 },
    pylon:             { w: 6, h: 26, d: 3 },
    // centerTol 2.6: unico asset volutamente non centrato. Il suo pivot
    // naturale è l'ASTA (a X=0), non il centro dell'ingombro: la bandiera
    // sporge tutta da un lato. Forzarlo simmetrico significherebbe piantare
    // l'asta fuori dal punto scelto da trackScenery.js.
    flagPole:          { w: 5, h: 15, d: 1.6, centerTol: 2.6 },
    paddockTent:       { w: 16, h: 7, d: 12 },
    // Figure umane. Riferimento di scala: 1 unità ≈ 0.78 m, quindi un
    // meccanico in piedi (2.27) è alto ~1.77 m e uno spettatore seduto
    // arriva a ~1.08 m dal piano del gradone.
    spectatorA:        { w: 0.68, h: 1.38, d: 0.73 },
    spectatorB:        { w: 0.68, h: 1.38, d: 0.73 },
    spectatorC:        { w: 0.68, h: 1.38, d: 0.73 },
    pitCrew:           { w: 0.94, h: 2.27, d: 0.44 },
    pitCrewKneel:      { w: 0.7, h: 1.47, d: 1.5 },
    brakingBoard:      { w: 2.2, h: 3.1, d: 0.7 },
    concreteBarrier:   { w: 6, h: 1.4, d: 1.4 },
    footbridge:        { w: 36.5, h: 13.3, d: 4.5 },
    pitBox:            { w: 21.8, h: 10, d: 22 },
};

const TOL = 0.20;
const DEFAULT_CENTER_TOL = 0.6;

function inRange(actual, target) {
    return actual >= target * (1 - TOL) && actual <= target * (1 + TOL);
}

for (const [assetId, exp] of Object.entries(EXPECTED)) {
    const glb = path.join(GLB_DIR, `${assetId}.glb`);

    test(`${assetId}: il .glb esiste ed è parsabile`, () => {
        assert.ok(fs.existsSync(glb), `manca ${glb} — rigenerare con f1CircuitAssetsBuilder.py`);
        const info = inspectGlb(glb);
        assert.ok(info.primitiveCount > 0, 'nessuna primitiva nel file');
    });

    test(`${assetId}: massimo 6 materiali (un InstancedMesh per mesh in f1.js)`, () => {
        const info = inspectGlb(glb);
        assert.ok(info.materialCount <= 6, `${info.materialCount} materiali`);
    });

    test(`${assetId}: pivot alla base (Y min ≈ 0) e centrato in XZ`, () => {
        const { min, max } = inspectGlb(glb).bounds;
        assert.ok(Math.abs(min[1]) < 0.05, `base a Y=${min[1]}, attesa 0`);
        const centerTol = exp.centerTol ?? DEFAULT_CENTER_TOL;
        const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
        assert.ok(Math.abs(cx) <= centerTol, `centro X=${cx}, atteso 0 ±${centerTol}`);
        assert.ok(Math.abs(cz) <= centerTol, `centro Z=${cz}, atteso 0 ±${centerTol}`);
    });

    test(`${assetId}: ingombro entro ±20% del target`, () => {
        const [w, h, d] = inspectGlb(glb).size;
        assert.ok(inRange(w, exp.w), `larghezza ${w.toFixed(2)}, target ${exp.w}`);
        assert.ok(inRange(h, exp.h), `altezza ${h.toFixed(2)}, target ${exp.h}`);
        assert.ok(inRange(d, exp.d), `profondità ${d.toFixed(2)}, target ${exp.d}`);
    });
}

// I gradini del podio devono restare nodi distinti e nominati: la spec li
// vuole referenziabili da una futura cerimonia, che non fa parte di questo
// lavoro ma di cui il modello è il prerequisito.
test('podium: i 3 gradini sono nodi separati e referenziabili per nome', () => {
    const info = inspectGlb(path.join(GLB_DIR, 'podium.glb'));
    for (const step of ['podium_step_p1', 'podium_step_p2', 'podium_step_p3']) {
        assert.ok(info.nodeNames.includes(step), `manca il nodo ${step} in ${info.nodeNames}`);
    }
});
