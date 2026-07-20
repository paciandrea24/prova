const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTrack, listTracks, saveTrack, deleteTrack } = require('./trackLoader.js');

const TRACKS_DIR = path.join(__dirname, '..', '..', '..', 'frontend', 'tracks');

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

test('loadTrack rifiuta id con caratteri di path-traversal prima di toccare il filesystem', () => {
    assert.throws(() => loadTrack('../../etc'), /trackId non valido: "\.\.\/\.\.\/etc"/);
    assert.throws(() => loadTrack('foo/bar'), /trackId non valido: "foo\/bar"/);
});

test('loadTrack lancia un errore chiaro (non un ENOENT grezzo) per un id ben formato ma inesistente', () => {
    assert.throws(() => loadTrack('pista-che-non-esiste'), (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Impossibile caricare la pista "pista-che-non-esiste"/);
        return true;
    });
});

// Copertura di regressione per il bug reale trovato su Monza: un
// entryTrigger lasciato ai valori di un'altra pista (schema vecchio a 3
// campi, o un riquadro nel posto sbagliato) veniva salvato senza controlli
// e finiva per intercettare un tratto qualunque del tracciato principale.
function minimalValidTrackData(overrides) {
    return Object.assign({
        id: 'test-scratch-track',
        name: 'Test Scratch',
        targetKm: 1,
        roadHalfWidth: 10,
        controlPoints: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }],
        pit: {
            roadHalfWidth: 5,
            boxIndex: 0,
            entryTrigger: { xMin: -1, xMax: 3, zMin: -1, zMax: 3 },
            path: [{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 2, z: 2 }]
        }
    }, overrides);
}

test('saveTrack accetta un entryTrigger a 4 campi che intercetta la corsia box', () => {
    saveTrack(minimalValidTrackData());
    try {
        assert.ok(listTracks().some(t => t.id === 'test-scratch-track'));
    } finally {
        deleteTrack('test-scratch-track');
    }
});

test('saveTrack rifiuta il vecchio schema entryTrigger a 3 campi (senza xMin)', () => {
    const data = minimalValidTrackData({
        pit: Object.assign({}, minimalValidTrackData().pit, {
            entryTrigger: { xMax: 3, zMin: -1, zMax: 3 }
        })
    });
    assert.throws(() => saveTrack(data), /entryTrigger non valido \(servono xMin, xMax, zMin, zMax\)/);
});

test('saveTrack rifiuta un entryTrigger che non intercetta nessun punto della corsia box', () => {
    const data = minimalValidTrackData({
        pit: Object.assign({}, minimalValidTrackData().pit, {
            // riquadro lontanissimo dalla corsia box (path attorno a x/z 0-2):
            // stesso tipo di errore del bug reale (default di un'altra pista).
            entryTrigger: { xMin: 500, xMax: 600, zMin: 500, zMax: 600 }
        })
    });
    assert.throws(() => saveTrack(data), /entryTrigger non intercetta nessun punto della corsia box/);
});

test('deleteTrack rimuove una pista salvata e la fa sparire da listTracks', () => {
    saveTrack(minimalValidTrackData());
    assert.ok(listTracks().some(t => t.id === 'test-scratch-track'));
    deleteTrack('test-scratch-track');
    assert.ok(!listTracks().some(t => t.id === 'test-scratch-track'));
});

test('listTracks non lancia e restituisce comunque le piste valide in presenza di un file malformato', () => {
    const malformedPath = path.join(TRACKS_DIR, '__test-malformed.json');
    fs.writeFileSync(malformedPath, '{ questo non e\' json valido ', 'utf8');
    try {
        const tracks = listTracks();
        assert.ok(tracks.some(t => t.id === 'monte-rosso' && t.name === 'Monte Rosso'));
    } finally {
        fs.unlinkSync(malformedPath);
    }
});
