const test = require('node:test');
const assert = require('node:assert/strict');
const tool = require('./f1-segnalazioni.js');

// Anello quadrato di comodo: 40 campioni su un giro di lato 100, così la
// progressione e la distanza dall'asse hanno valori a mente.
function anelloDiProva() {
    const pts = [];
    for (let i = 0; i < 40; i++) {
        const t = i / 40, lato = Math.floor(t * 4), u = (t * 4) % 1;
        if (lato === 0) pts.push({ x: -50 + u * 100, y: 0, z: -50 });
        else if (lato === 1) pts.push({ x: 50, y: 0, z: -50 + u * 100 });
        else if (lato === 2) pts.push({ x: 50 - u * 100, y: 0, z: 50 });
        else pts.push({ x: -50, y: 0, z: 50 - u * 100 });
    }
    return pts;
}

test('un punto sull asse risulta dentro pista, a distanza zero', () => {
    const d = tool.descriviPuntoPista(anelloDiProva(), 10, { pos: { x: 0, y: 0, z: -50 } });
    assert.equal(d.dentroPista, true);
    assert.ok(d.distanzaAsse < 0.001);
});

test('un punto oltre il bordo risulta fuori pista', () => {
    // roadHalf 10: a 25 unità dall asse si è fuori di sicuro.
    const d = tool.descriviPuntoPista(anelloDiProva(), 10, { pos: { x: 0, y: 0, z: -75 } });
    assert.equal(d.dentroPista, false);
    assert.ok(Math.abs(d.distanzaAsse - 25) < 0.001);
});

test('la progressione dice a che punto del giro sei', () => {
    // L'angolo a metà anello (50, 50) è esattamente il campione 20 su 40.
    const d = tool.descriviPuntoPista(anelloDiProva(), 10, { pos: { x: 50, y: 0, z: 50 } });
    assert.equal(d.indice, 20);
    assert.equal(d.progressione, 50);
});

test('un oggetto nella stessa direzione del muso è davanti', () => {
    assert.equal(tool.direzioneRelativa(90, 90), 'davanti');
});

test('un oggetto a 180 gradi dal muso è dietro', () => {
    assert.equal(tool.direzioneRelativa(90, 270), 'dietro');
});

test('la destra è la destra del pilota, non quella della mappa', () => {
    // Convenzione del gioco: rotY cresce verso +X, quindi un angolo MAGGIORE
    // del muso sta alla destra di chi guida.
    assert.equal(tool.direzioneRelativa(0, 90), 'a destra');
    assert.equal(tool.direzioneRelativa(0, 270), 'a sinistra');
});

test('i vicini escono in ordine di distanza, col loro verso', () => {
    const layout = [
        { asset: 'albero', category: 'nature', x: 100, z: 0 },
        { asset: 'tribuna', category: 'grandstand', x: 10, z: 0 },
        { asset: 'roccia', category: 'nature', x: 0, z: -30 }
    ];
    // Auto nell'origine, muso verso +Z (0 gradi).
    const rec = { pos: { x: 0, y: 0, z: 0 }, headingDeg: 0 };
    const v = tool.vicini(layout, rec, 2);
    assert.equal(v.length, 2);
    assert.deepEqual(v.map(o => o.asset), ['tribuna', 'roccia']);
    assert.equal(v[0].distanza, 10);
    assert.equal(v[0].direzione, 'a destra');    // +X con muso a 0 è la destra del pilota
    assert.equal(v[1].direzione, 'dietro');      // -Z con muso a 0
});

test('chiedere più vicini di quanti ce ne sono non rompe niente', () => {
    const layout = [{ asset: 'albero', category: 'nature', x: 5, z: 0 }];
    const v = tool.vicini(layout, { pos: { x: 0, y: 0, z: 0 }, headingDeg: 0 }, 5);
    assert.equal(v.length, 1);
});

// ── L'invariante che tiene in piedi tutto il tool ──────────────────────
//
// Il tool ricostruisce la scenografia partendo da trackLoader; il gioco la
// genera con una catena sua (frontend/f1.js:155-247, 655). Se le due
// divergono, il tool stampa nomi di oggetti che il giocatore non aveva
// davanti — un errore silenzioso, peggiore del non avere il tool. Questo
// test replica la catena del client e pretende che i due layout coincidano
// elemento per elemento.
const fs = require('fs');
const path = require('path');
const TrackGeometry = require('../../frontend/shared/trackGeometry.js');
const TrackGravel = require('../../frontend/shared/trackGravel.js');
const TrackScenery = require('../../frontend/shared/trackScenery.js');
const { loadTrack } = require('../sockets/games/trackLoader.js');

function layoutComeIlClient(trackId) {
    const radice = path.join(__dirname, '..', '..');
    const trackData = JSON.parse(fs.readFileSync(
        path.join(radice, 'frontend', 'tracks', `${trackId}.json`), 'utf8'));
    const seatAnchors = JSON.parse(fs.readFileSync(path.join(radice, 'frontend', 'assets',
        'custom', 'circuit', 'grandStandSeats.json'), 'utf8')).seats;
    const terraceAnchors = JSON.parse(fs.readFileSync(path.join(radice, 'frontend', 'assets',
        'custom', 'circuit', 'terraceAnchors.json'), 'utf8')).anchors;
    const ROAD_HALF = trackData.roadHalfWidth;
    const CURB_W = 2.8;                                   // f1.js:156
    const BARRIER_D = ROAD_HALF + CURB_W + 1.2;           // f1.js:157
    const trackPts = TrackGeometry.sampleLoop(trackData.controlPoints, 1000);   // f1.js:170-171
    const PIT_PATH = TrackGeometry.snapPitPathEnds(trackData.pit.path, trackPts, ROAD_HALF);
    const PIT_PTS = TrackGeometry.tuckPitEndsToTrack(
        TrackGeometry.sampleOpenPath(PIT_PATH, 300), trackPts);                 // f1.js:228
    const BARRIER_PROFILE = TrackGravel.barrierProfile(trackPts, {              // f1.js:242
        roadHalf: ROAD_HALF, curbW: CURB_W,
        pitLanePts: PIT_PTS, pitRoadHalf: trackData.pit.roadHalfWidth,
    });
    return TrackScenery.generateLayout(trackData, trackPts, PIT_PTS, BARRIER_D,
        45, seatAnchors, BARRIER_PROFILE, terraceAnchors);                      // f1.js:670
}

for (const trackId of ['prova', 'monte-rosso', 'new-monza', 'baku']) {
    test(`la scenografia ricostruita dal tool è quella del gioco (${trackId})`, () => {
        const daTool = tool.layoutDi(trackId, loadTrack(trackId));
        const daClient = layoutComeIlClient(trackId);
        assert.equal(daTool.length, daClient.length);
        for (let i = 0; i < daTool.length; i++) {
            assert.equal(daTool[i].asset, daClient[i].asset);
            assert.equal(daTool[i].category, daClient[i].category);
            assert.equal(daTool[i].x, daClient[i].x);
            assert.equal(daTool[i].z, daClient[i].z);
        }
    });
}

test('un tipo di oggetto occupa una riga sola, col suo esemplare più vicino', () => {
    const layout = [
        { asset: 'tyreStack', category: 'safety', x: 10, z: 0 },
        { asset: 'tyreStack', category: 'safety', x: 11, z: 0 },
        { asset: 'tyreStack', category: 'safety', x: 12, z: 0 },
        { asset: 'grandStand', category: 'grandstand', x: 20, z: 0 }
    ];
    const v = tool.vicini(layout, { pos: { x: 0, y: 0, z: 0 }, headingDeg: 0 }, 2);
    assert.deepEqual(v.map(o => o.asset), ['tyreStack', 'grandStand']);
    assert.equal(v[0].distanza, 10);
});

test('tutta la folla vale un tipo solo, o sommerge la tribuna', () => {
    const layout = [
        { asset: 'spectatorA', category: 'crowd', x: 5, z: 0 },
        { asset: 'spectatorB', category: 'crowd', x: 6, z: 0 },
        { asset: 'spectatorC', category: 'crowd', x: 7, z: 0 },
        { asset: 'grandStand', category: 'grandstand', x: 12, z: 0 }
    ];
    const v = tool.vicini(layout, { pos: { x: 0, y: 0, z: 0 }, headingDeg: 0 }, 2);
    assert.deepEqual(v.map(o => o.asset), ['spectatorA', 'grandStand']);
});
