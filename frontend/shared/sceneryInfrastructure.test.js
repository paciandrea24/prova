const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const TrackGeometry = require('./trackGeometry.js');
const TrackGravel = require('./trackGravel.js');
const SceneryAssetSizes = require('./sceneryAssetSizes.js');
const SceneryInfrastructure = require('./sceneryInfrastructure.js');

// Lo stesso circuito vero usato dagli altri test di scenografia, con gli
// stessi campionamenti del caricatore di pista.
function circuitoVero(id) {
    const raw = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'tracks', `${id}.json`), 'utf8'));
    const trackPts = TrackGeometry.sampleLoop(raw.controlPoints, 1000);
    const pitPath = TrackGeometry.snapPitPathEnds(raw.pit.path, trackPts, raw.roadHalfWidth);
    const pitLanePts = TrackGeometry.sampleOpenPath(pitPath, 300);
    const barrierProfile = TrackGravel.barrierProfile(trackPts, {
        roadHalf: raw.roadHalfWidth, pitLanePts, pitRoadHalf: raw.pit.roadHalfWidth });
    return { raw, trackPts, pitLanePts, barrierProfile,
             barrierDist: raw.roadHalfWidth + 2.8 + 1.2 };
}

function contesto(id, extra) {
    const c = circuitoVero(id);
    return Object.assign({
        trackPts: c.trackPts, pitPts: c.pitLanePts, barrierDist: c.barrierDist,
        pitRoadHalf: c.raw.pit.roadHalfWidth, embankStart: c.barrierDist, embankOuter: 45,
        barrierProfile: c.barrierProfile, accepted: [], grandstands: [], spanning: [],
        insidePlayerBoxFootprint: () => false, playerBoxFootprints: [],
        fitsUnderBridge: () => true, rng: () => 0.5, palette: [],
    }, extra || {});
}

test('con la palette vuota non posa niente', () => {
    const out = SceneryInfrastructure.buildInfrastructure(contesto('prova'));
    assert.equal(out.length, 0, 'palette vuota deve produrre zero voci');
});

test('il contesto riconosce il viadotto e ne misura il dislivello', () => {
    const ctx = contesto('prova');
    // I campioni 417-614 di prova sono sopraelevati, fino a 11.5 sul terreno.
    const sopra = SceneryInfrastructure.contestoAl(ctx, 480, 1);
    assert.ok(sopra.viadotto, 'il campione 480 di prova è su viadotto');
    assert.ok(sopra.dislivello > 5,
        `dislivello atteso sopra 5, misurato ${sopra.dislivello.toFixed(1)}`);

    const terra = SceneryInfrastructure.contestoAl(ctx, 0, 1);
    assert.ok(!terra.viadotto, 'il traguardo di prova non è su viadotto');
    assert.ok(terra.dislivello < 1, 'a terra il dislivello è ~0');
});

test('il contesto riconosce l\'esterno di una curva', () => {
    const ctx = contesto('prova');
    // ⚠️ findCorners restituisce in `side` il lato ESTERNO. La curva
    // 126-144 di prova ha side -1, quindi lì l'esterno è il lato -1.
    const fuori = SceneryInfrastructure.contestoAl(ctx, 135, -1);
    assert.ok(fuori.curva, 'il campione 135 di prova sta dentro una curva');
    assert.ok(fuori.esterno, 'lato -1 al campione 135 è l\'esterno');
    const dentro = SceneryInfrastructure.contestoAl(ctx, 135, 1);
    assert.ok(!dentro.esterno, 'lato +1 al campione 135 è l\'interno');
});

test('il muro del contesto è quello del lato giusto', () => {
    const ctx = contesto('prova');
    for (const idx of [0, 300, 700]) {
        for (const lato of [1, -1]) {
            const c = SceneryInfrastructure.contestoAl(ctx, idx, lato);
            assert.equal(c.muro, TrackGravel.barrierAt(ctx.barrierProfile, idx, lato),
                `il muro al campione ${idx} lato ${lato} deve venire da barrierAt con quel lato`);
        }
    }
});

test('senza profilo del muro si ripiega sulla barriera storica', () => {
    const ctx = contesto('prova', { barrierProfile: null });
    const c = SceneryInfrastructure.contestoAl(ctx, 0, 1);
    assert.equal(c.muro, ctx.barrierDist,
        'chi non conosce le vie di fuga deve continuare a funzionare');
});
