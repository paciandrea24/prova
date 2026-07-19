const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTrack, listTracks } = require('./trackLoader.js');

test('loadTrack("monte-rosso") calcola 10 giri dal targetKm', () => {
    const track = loadTrack('monte-rosso');
    assert.equal(track.totalLaps, 10);
});

test('loadTrack("monte-rosso") espone nome, larghezza pista e corsia box', () => {
    const track = loadTrack('monte-rosso');
    assert.equal(track.name, 'Monte Rosso');
    assert.equal(track.roadHalf, 11);
    assert.equal(track.pitRoadHalf, 5);
    assert.equal(track.pitBoxIndex, 4);
    assert.equal(track.points.length, 1000);
});

// La tangente/normale REALI nel punto di saldatura del loop (indice 0) non
// sono perfettamente (0,1)/(-1,0) come l'angle:0 hardcoded storico
// assumeva (la Catmull-Rom tiene conto anche del punto di controllo
// precedente al seam, che qui non è perfettamente allineato) — misurato:
// qualiSpawn scosta di ~0.53 unità, gridSpawnPoint(0)/(1) di ~2.64 unità
// (l'errore angolare si amplifica con la distanza dal punto 0). La
// tolleranza di 4 unità copre questo scostamento noto restando comunque
// stretta abbastanza da far fallire il test su un bug reale (segno
// sbagliato, asse scambiato, offset di scala): quegli errori producono
// scostamenti di decine di unità, non di 2-3.
test('qualiSpawn e gridSpawnPoint(0)/(1) sono vicini ai valori storici hardcoded', () => {
    const track = loadTrack('monte-rosso');
    // Storico: QUALI_SPAWN = { x: -30, z: 8, angle: 0 }
    assert.ok(Math.abs(track.qualiSpawn.x - -30) < 4);
    assert.ok(Math.abs(track.qualiSpawn.z - 8) < 4);
    // Storico: gridSpawnPoint(0) = { x: -34, z: 40, angle: 0 } (pole)
    const g0 = track.gridSpawnPoint(0);
    assert.ok(Math.abs(g0.x - -34) < 4);
    assert.ok(Math.abs(g0.z - 40) < 4);
    // Storico: gridSpawnPoint(1) = { x: -26, z: 35, angle: 0 }
    const g1 = track.gridSpawnPoint(1);
    assert.ok(Math.abs(g1.x - -26) < 4);
    assert.ok(Math.abs(g1.z - 35) < 4);
});

test('loadTrack cachea per id (stessa istanza restituita)', () => {
    const a = loadTrack('monte-rosso');
    const b = loadTrack('monte-rosso');
    assert.equal(a, b);
});

test('listTracks include monte-rosso', () => {
    const tracks = listTracks();
    assert.ok(tracks.some(t => t.id === 'monte-rosso' && t.name === 'Monte Rosso'));
});
