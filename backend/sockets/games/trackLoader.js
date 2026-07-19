const fs = require('fs');
const path = require('path');
const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');

const TRACKS_DIR = path.join(__dirname, '..', '..', '..', 'frontend', 'tracks');
const TRACK_ID_PATTERN = /^[a-z0-9-]+$/;
const SAMPLES = 1000;
const QUALI_LEAD = 8;        // unità avanti alla linea di partenza per lo spawn di qualifica
const GRID_START = 40;       // unità dietro la linea di partenza per la pole
const GRID_STAGGER = 5;      // arretramento extra per ogni posizione in griglia
const GRID_LANE_OFFSET = 4;  // scostamento laterale di ogni corsia dal centro pista

const cache = new Map();

function buildTrack(id, raw) {
    const points = TrackGeometry.sampleLoop(raw.controlPoints, SAMPLES);
    const lapLength = TrackGeometry.lapLength(points);
    const totalLaps = TrackGeometry.lapsForDistance(lapLength, raw.targetKm);

    const p0 = points[0];
    const tangent = TrackGeometry.tangentAt(points, 0, true);
    const normal  = TrackGeometry.normalAt(points, 0, true);
    const angle   = Math.atan2(tangent.tx, tangent.tz);

    // Punto lungo la tangente di partenza, con un offset laterale lungo la
    // normale — usato sia per lo spawn di qualifica sia per la griglia.
    function alongTrack(distForward, lateralOffset) {
        return {
            x: p0.x + tangent.tx * distForward + normal.nx * lateralOffset,
            z: p0.z + tangent.tz * distForward + normal.nz * lateralOffset,
            angle
        };
    }

    function gridSpawnPoint(i) {
        const laneSign = (i % 2 === 0) ? 1 : -1;
        return alongTrack(GRID_START - i * GRID_STAGGER, laneSign * GRID_LANE_OFFSET);
    }

    return {
        id,
        name: raw.name,
        points,
        roadHalf: raw.roadHalfWidth,
        lapLength,
        totalLaps,
        pitPath: raw.pit.path,
        pitBoxIndex: raw.pit.boxIndex,
        pitRoadHalf: raw.pit.roadHalfWidth,
        pitEntryTrigger: raw.pit.entryTrigger,
        qualiSpawn: alongTrack(QUALI_LEAD, 0),
        gridSpawnPoint
    };
}

function loadTrack(id) {
    if (cache.has(id)) return cache.get(id);
    if (!TRACK_ID_PATTERN.test(id)) {
        throw new Error(`Errore: trackId non valido: "${id}"`);
    }
    const file = path.join(TRACKS_DIR, `${id}.json`);
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        throw new Error(`Impossibile caricare la pista "${id}": ${err.message}`);
    }
    const track = buildTrack(id, raw);
    cache.set(id, track);
    return track;
}

function listTracks() {
    return fs.readdirSync(TRACKS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            const id = f.replace(/\.json$/, '');
            try {
                const raw = JSON.parse(fs.readFileSync(path.join(TRACKS_DIR, f), 'utf8'));
                return { id, name: raw.name };
            } catch (err) {
                console.warn(`listTracks: file pista malformato ignorato "${f}": ${err.message}`);
                return null;
            }
        })
        .filter(t => t !== null);
}

module.exports = { loadTrack, listTracks };
