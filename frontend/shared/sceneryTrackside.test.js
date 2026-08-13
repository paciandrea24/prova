// frontend/shared/sceneryTrackside.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const TrackGeometry = require('./trackGeometry.js');
const SceneryTrackside = require('./sceneryTrackside.js');
const SceneryAssetSizes = require('./sceneryAssetSizes.js');
const monteRosso = require('../tracks/monte-rosso.json');

const BARRIER_D = monteRosso.roadHalfWidth + 2.8 + 1.2;

function ctx(overrides) {
    const trackPts = TrackGeometry.sampleLoop(monteRosso.controlPoints, 1000);
    const pitPts = TrackGeometry.sampleOpenPath(monteRosso.pit.path, 300);
    let a = 12345;
    const rng = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    return Object.assign({
        trackPts, pitPts, barrierDist: BARRIER_D, embankOuter: BARRIER_D + 45,
        pitRoadHalf: monteRosso.pit.roadHalfWidth,
        mainSide: 1, rng, playerBoxFootprints: [],
        insidePlayerBoxFootprint: () => false, grandstands: [],
    }, overrides);
}

test('findCorners trova curve separate e non tutto il tracciato', () => {
    const c = ctx();
    const corners = SceneryTrackside.findCorners(c.trackPts);
    assert.ok(corners.length >= 2, `trovate solo ${corners.length} curve`);
    assert.ok(corners.length < 20, `${corners.length} curve: soglia troppo permissiva`);
    for (const k of corners) {
        assert.ok(k.side === 1 || k.side === -1, 'lato esterno non determinato');
        assert.ok(k.radius < SceneryTrackside.CORNER_RADIUS_MAX, 'curva sopra soglia');
    }
});

test('le barriere di pneumatici stanno fuori dalla barriera e mai in corsia box', () => {
    const c = ctx();
    const items = SceneryTrackside.buildTrackside(c);
    const tyres = items.filter(i => i.asset === 'tyreStack');
    assert.ok(tyres.length > 0, 'nessuna barriera di gomme generata');
    for (const t of tyres) {
        const dTrack = TrackGeometry.nearestPoint(c.trackPts, t.x, t.z).dist;
        assert.ok(dTrack >= BARRIER_D, `gomme a ${dTrack.toFixed(1)} dal centro pista`);
        const dPit = TrackGeometry.nearestPoint(c.pitPts, t.x, t.z).dist;
        assert.ok(dPit > monteRosso.pit.roadHalfWidth, 'gomme dentro la corsia box');
    }
});

test('ogni curva riceve al massimo due cartelli di frenata', () => {
    const c = ctx();
    const corners = SceneryTrackside.findCorners(c.trackPts);
    const boards = SceneryTrackside.buildTrackside(c).filter(i => i.asset === 'brakingBoard');
    assert.ok(boards.length <= corners.length * 2, `${boards.length} cartelli per ${corners.length} curve`);
    assert.ok(boards.length > 0, 'nessun cartello generato');
});

test('i commissari sono al massimo uno per curva', () => {
    const c = ctx();
    const corners = SceneryTrackside.findCorners(c.trackPts);
    const posts = SceneryTrackside.buildTrackside(c).filter(i => i.asset === 'marshalPost');
    assert.ok(posts.length <= corners.length, `${posts.length} commissari per ${corners.length} curve`);
});

test('buildTrackside è deterministico a parità di seed', () => {
    const a = JSON.stringify(SceneryTrackside.buildTrackside(ctx()));
    const b = JSON.stringify(SceneryTrackside.buildTrackside(ctx()));
    assert.equal(a, b);
});

// Le reti fanno eccezione dal 2026-08-13: si dimensionano sulla tribuna che
// proteggono, quindi la loro scala vale 19.2/12. Tutto il resto è a scala 1.
test('tutte le voci hanno una scala, una categoria e coordinate finite', () => {
    for (const item of SceneryTrackside.buildTrackside(ctx())) {
        assert.ok(item.scale > 0, `scala non valida per ${item.asset}: ${item.scale}`);
        assert.ok(typeof item.category === 'string' && item.category.length > 0);
        assert.ok(Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.z),
            `coordinate non finite per ${item.asset}`);
        assert.ok(Number.isFinite(item.rotY), `rotY non finita per ${item.asset}`);
    }
});

// Il footprint dei box giocatore è la zona dove stanno i modelli veri dei
// box: se un oggetto scenico ci finisce dentro, lo compenetra.
test('niente viene piazzato dentro l\'ingombro dei box giocatore', () => {
    const fake = [[{ x: 0, z: 0 }]];
    let asked = 0;
    const items = SceneryTrackside.buildTrackside(ctx({
        playerBoxFootprints: fake,
        insidePlayerBoxFootprint: () => { asked++; return true; },
    }));
    assert.ok(asked > 0, 'il filtro sui box giocatore non è stato interrogato');
    // Con il filtro che rifiuta tutto, restano solo le voci che per
    // costruzione non possono cadere sui box.
    assert.ok(items.length < 10, `${items.length} voci nonostante il filtro rifiuti tutto`);
});

// Il decoro del paddock va solo dove c'è davvero spazio fra pista e corsia
// box. Una versione precedente provava collocazioni di ripiego per piazzarne
// di più, ma finivano DIETRO le tribune, dove l'utente non li vuole
// (playtest 2026-08-09): meglio pochi elementi al posto giusto che molti
// sparsi dove capita.
test('il decoro del paddock finisce solo dove c\'è spazio, senza ripieghi', () => {
    const c = ctx();
    const decor = SceneryTrackside.buildTrackside(c).filter(i => i.category === 'paddock-decor');
    for (const d of decor) {
        const dPit = TrackGeometry.nearestPoint(c.pitPts, d.x, d.z).dist;
        assert.ok(dPit >= c.pitRoadHalf + 8, `decoro dentro la corsia box: ${dPit.toFixed(1)}`);
    }
});

// --- Decoro del paddock ----------------------------------------------------
// NOTA: il test che verifica che pylon/flagPole/paddockTent compaiano davvero
// NON sta qui ma in trackScenery.test.js, sul layout completo. Motivo: qui
// ctx() passa playerBoxFootprints vuoto, e con quello il decoro trova posto
// sempre — un test verde che non dimostrava nulla, mentre nel gioco vero gli
// ingombri dei box giocatore coprono tutte le collocazioni candidate e gli
// asset sparivano lo stesso.

// Una tribuna finta, messa dove le mette buildGrandstandLayout: sul lato
// esterno, a barrierDist + GRANDSTAND_OFFSET_MARGIN, che guarda la pista.
function tribunaFinta(trackPts, idx, asset) {
    const p = trackPts[idx];
    const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
    const off = BARRIER_D + 10;
    const x = p.x + nx * off, z = p.z + nz * off;
    return { asset, category: 'grandstand', scale: 1, x, z, y: 0,
             rotY: Math.atan2(p.x - x, p.z - z) };
}

test('una rete per tribuna, larga quanto lei e centrata su di lei', () => {
    // Fino al 2026-08-13 le reti erano due moduli a scala 1 affiancati a un
    // passo arrotondato in CAMPIONI, quindi si sfalsavano rispetto alla
    // tribuna e ne lasciavano scoperto un pezzo (segnalato in gioco: "un
    // grandstand per metà protetto e per metà no").
    const c = ctx();
    const stand = tribunaFinta(c.trackPts, 300, 'grandStandCovered');
    const reti = SceneryTrackside.buildTrackside(ctx({ grandstands: [stand] }))
        .filter(i => i.asset === 'catchFence');

    assert.equal(reti.length, 1, `${reti.length} reti per una tribuna sola`);
    const rete = reti[0];
    const largaQuanto = SceneryAssetSizes.sizeOf('catchFence').w * rete.scale;
    assert.ok(Math.abs(largaQuanto - SceneryAssetSizes.sizeOf(stand.asset).w) < 1e-9,
        `rete larga ${largaQuanto.toFixed(2)} per una tribuna larga `
        + SceneryAssetSizes.sizeOf(stand.asset).w);
    assert.ok(Math.abs(rete.rotY - stand.rotY) < 1e-9,
        `rete ruotata di ${((rete.rotY - stand.rotY) * 180 / Math.PI).toFixed(2)}° rispetto alla tribuna`);

    // Centrata: lo scarto fra i due centri deve stare TUTTO lungo la
    // direzione in cui la tribuna guarda, zero lungo la sua larghezza.
    // L'asse larghezza è la X locale, che footprintCorners costruisce come
    // (cos rotY, -sin rotY).
    const lungo = (rete.x - stand.x) * Math.cos(stand.rotY)
                - (rete.z - stand.z) * Math.sin(stand.rotY);
    assert.ok(Math.abs(lungo) < 1e-9, `rete sfalsata di ${lungo.toFixed(3)} lungo la tribuna`);

    // E sta DAVANTI, cioè fra la tribuna e la pista.
    assert.ok(TrackGeometry.nearestPoint(c.trackPts, rete.x, rete.z).dist
            < TrackGeometry.nearestPoint(c.trackPts, stand.x, stand.z).dist,
        'la rete non è davanti alla tribuna');
});

test('due tribune affiancate ricevono due reti contigue, senza sovrapporsi', () => {
    // Le schiere sono moduli contigui a passo 19.2: le reti, larghe
    // altrettanto, devono affiancarsi allo stesso modo. Se si sovrapponessero
    // avremmo due superfici complanari spesse 0.5 — sfarfallio garantito.
    const c = ctx();
    const a = tribunaFinta(c.trackPts, 300, 'grandStand');
    const b = tribunaFinta(c.trackPts, 300 + Math.round(19.2 / (TrackGeometry.lapLength(c.trackPts) / c.trackPts.length)), 'grandStand');
    const reti = SceneryTrackside.buildTrackside(ctx({ grandstands: [a, b] }))
        .filter(i => i.asset === 'catchFence');
    assert.equal(reti.length, 2);
    assert.equal(SceneryAssetSizes.itemsOverlap(reti[0], reti[1]), false,
        'le due reti si compenetrano');
});
