const fs = require('fs');
const path = require('path');
const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');

const TRACKS_DIR = path.join(__dirname, '..', '..', '..', 'frontend', 'tracks');
// backend/tools, NON frontend/tracks: listTracks() scansiona frontend/tracks
// per il menu piste in lobby, un .json in più lì dentro apparirebbe come una
// pista fittizia. I dati di racing line sono generati offline da
// backend/tools/f1RaceLineOptimizer.js, opzionali (una pista senza il file
// corrispondente carica esattamente come oggi, zero differenza).
const RACELINES_DIR = path.join(__dirname, '..', '..', 'tools');
const TRACK_ID_PATTERN = /^[a-z0-9-]+$/;
const SAMPLES = 1000;
const QUALI_LEAD = 8;        // unità avanti alla linea di partenza per lo spawn di qualifica
const GRID_START = 40;       // unità dietro la linea di partenza per la pole
const GRID_STAGGER = 5;      // arretramento extra per ogni posizione in griglia
const GRID_LANE_OFFSET = 4;  // scostamento laterale di ogni corsia dal centro pista

const cache = new Map();

// Racing line precalcolata offline (vedi backend/tools/f1RaceLineOptimizer.js
// + docs/superpowers/specs/2026-07-24-f1-bot-cornering-redesign-design.md):
// opzionale, `${id}-raceline.json` con {tuning, lineControls}. lineControls è
// un array corto di punti di controllo (offset laterale dal centro pista),
// interpolato qui sull'intero campionamento della pista — stessa identica
// interpolazione usata dall'ottimizzatore per costruirla, altrimenti la linea
// che il bot segue in gara non sarebbe quella davvero misurata offline.
function interpolateLineControls(controls, targetLen) {
    const m = controls.length;
    const out = new Array(targetLen);
    for (let i = 0; i < targetLen; i++) {
        const cf = i * m / targetLen;
        const c0 = Math.floor(cf) % m;
        const c1 = (c0 + 1) % m;
        const t = cf - Math.floor(cf);
        out[i] = controls[c0] * (1 - t) + controls[c1] * t;
    }
    return out;
}

function loadRacelineData(id) {
    const file = path.join(RACELINES_DIR, `${id}-raceline.json`);
    if (!fs.existsSync(file)) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(raw.lineControls) || raw.lineControls.length < 2) return null;
        return raw;
    } catch (err) {
        console.warn(`loadTrack: raceline malformata ignorata per "${id}": ${err.message}`);
        return null;
    }
}

function buildTrack(id, raw) {
    const points = TrackGeometry.sampleLoop(raw.controlPoints, SAMPLES);
    const lapLength = TrackGeometry.lapLength(points);
    const totalLaps = TrackGeometry.lapsForDistance(lapLength, raw.targetKm);

    const racelineData = loadRacelineData(id);
    let racingLine = null, racingLineTuning = null;
    if (racelineData) {
        const offsets = interpolateLineControls(racelineData.lineControls, points.length);
        racingLine = points.map((pt, i) => {
            const normal = TrackGeometry.normalAt(points, i, true);
            return { x: pt.x + normal.nx * offsets[i], z: pt.z + normal.nz * offsets[i] };
        });
        racingLineTuning = racelineData.tuning || null;
    }

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
        gridSpawnPoint,
        racingLine,
        racingLineTuning
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

// Validazione lato server dei dati esportati dall'editor: non fidarsi del
// client, è l'unico gate prima di scrivere su disco.
function validateTrackData(data) {
    if (!data || typeof data !== 'object') return 'Dati pista mancanti';
    if (typeof data.id !== 'string' || !TRACK_ID_PATTERN.test(data.id)) return 'id pista non valido (solo lettere minuscole, cifre, trattini)';
    if (typeof data.name !== 'string' || !data.name.trim()) return 'Nome pista mancante';
    if (typeof data.targetKm !== 'number' || !(data.targetKm > 0)) return 'targetKm non valido';
    if (typeof data.roadHalfWidth !== 'number' || !(data.roadHalfWidth > 0)) return 'roadHalfWidth non valido';
    if (!Array.isArray(data.controlPoints) || data.controlPoints.length < 3) return 'Servono almeno 3 punti di controllo';
    if (!data.controlPoints.every(p => p && typeof p.x === 'number' && typeof p.z === 'number')) return 'Punti di controllo malformati';
    if (!data.pit || typeof data.pit !== 'object') return 'Dati corsia box mancanti';
    if (!Array.isArray(data.pit.path) || data.pit.path.length < 3) return 'Servono almeno 3 punti per la corsia box';
    if (!data.pit.path.every(p => p && typeof p.x === 'number' && typeof p.z === 'number')) return 'Punti corsia box malformati';
    if (typeof data.pit.roadHalfWidth !== 'number' || !(data.pit.roadHalfWidth > 0)) return 'pit.roadHalfWidth non valido';
    if (!Number.isInteger(data.pit.boxIndex) || data.pit.boxIndex < 0 || data.pit.boxIndex >= data.pit.path.length) return 'pit.boxIndex non valido';
    const et = data.pit.entryTrigger;
    if (!et || typeof et.xMin !== 'number' || typeof et.xMax !== 'number' || typeof et.zMin !== 'number' || typeof et.zMax !== 'number') {
        return 'pit.entryTrigger non valido (servono xMin, xMax, zMin, zMax)';
    }
    if (!(et.xMin < et.xMax) || !(et.zMin < et.zMax)) return 'pit.entryTrigger non valido: xMin/zMin devono essere minori di xMax/zMax';
    // Il riquadro non deve necessariamente contenere il primo punto della
    // corsia box (che spesso coincide col distacco dalla linea principale,
    // ancora "in pista"): basta che intercetti ALMENO un punto della corsia,
    // altrimenti il trigger non corrisponde alla vera zona d'ingresso di
    // questa pista (bug reale riscontrato: un riquadro lasciato ai valori di
    // default di un'altra pista, che finiva per intercettare un tratto
    // qualunque del tracciato principale invece della corsia box).
    const triggerHitsPath = data.pit.path.some(pt =>
        pt.x >= et.xMin && pt.x <= et.xMax && pt.z >= et.zMin && pt.z <= et.zMax);
    if (!triggerHitsPath) return 'pit.entryTrigger non intercetta nessun punto della corsia box: il riquadro non corrisponde al vero punto d\'ingresso';
    return null;
}

// Scrive frontend/tracks/<id>.json e invalida la cache in-memory, così una
// pista risalvata con lo stesso id viene ricaricata dalla partita successiva
// senza riavviare il server.
function saveTrack(data) {
    const err = validateTrackData(data);
    if (err) throw new Error(err);
    const file = path.join(TRACKS_DIR, `${data.id}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 4), 'utf8');
    cache.delete(data.id);
    return data.id;
}

// Elimina frontend/tracks/<id>.json e invalida la cache. Rifiuta se `id`
// è l'unica pista rimasta, per non lasciare il menu piste della lobby vuoto.
function deleteTrack(id) {
    if (!TRACK_ID_PATTERN.test(id)) {
        throw new Error(`id pista non valido: "${id}"`);
    }
    const file = path.join(TRACKS_DIR, `${id}.json`);
    if (!fs.existsSync(file)) {
        throw new Error(`Pista "${id}" non trovata`);
    }
    if (listTracks().length <= 1) {
        throw new Error('Non puoi eliminare l\'ultima pista rimasta');
    }
    fs.unlinkSync(file);
    cache.delete(id);
}

module.exports = { loadTrack, listTracks, saveTrack, deleteTrack };
