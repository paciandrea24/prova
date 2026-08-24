// frontend/shared/sceneryAssetPaths.test.js
//
// La tabella dice dove sta ogni modello: se un percorso è sbagliato, in gara
// quell'asset semplicemente non compare — nessun errore, solo un pezzo di
// circuito che manca. È il genere di difetto che si scopre guardando, e
// guardare è la cosa più costosa che c'è.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PERCORSI } = require('./sceneryAssetPaths.js');

const ROOT = path.join(__dirname, '..', '..');

test('ogni asset dichiarato ha il suo file', () => {
    const mancanti = Object.entries(PERCORSI)
        .filter(([, url]) => !fs.existsSync(path.join(ROOT, 'frontend', url)))
        .map(([nome, url]) => `${nome} -> ${url}`);
    assert.deepEqual(mancanti, []);
});

test('ogni asset che il layout piazza è nella tabella', () => {
    // L'altra direzione, che è quella che fa mancare i pezzi: un asset nuovo
    // messo in scena da un modulo di scenografia e dimenticato qui.
    const TrackScenery = require('./trackScenery.js');
    const { loadTrack } = require(path.join(ROOT, 'backend/sockets/games/trackLoader.js'));
    const seats = require(path.join(ROOT, 'frontend/assets/custom/circuit/grandStandSeats.json')).seats;
    const terraceAnchors = require(path.join(ROOT, 'frontend/assets/custom/circuit/terraceAnchors.json')).anchors;

    const senzaModello = new Set();
    for (const f of fs.readdirSync(path.join(ROOT, 'frontend/tracks')).filter(x => x.endsWith('.json'))) {
        const id = f.replace(/\.json$/, '');
        const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/tracks', f), 'utf8'));
        const t = loadTrack(id);
        const layout = TrackScenery.generateLayout(raw, t.points, t.pitLanePts,
            raw.roadHalfWidth + 2.8 + 1.2, 45, seats, t.barrierProfile, terraceAnchors, { gridSize: 6 });
        for (const v of layout) {
            // pond e parkingLot sono superfici piane costruite a mano, non modelli.
            if (!v.asset || v.category === 'pond' || v.category === 'parkingLot') continue;
            if (!PERCORSI[v.asset]) senzaModello.add(v.asset);
        }
    }
    assert.deepEqual([...senzaModello], []);
});
