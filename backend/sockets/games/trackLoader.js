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
// Stesso valore usato da frontend/f1.js per campionare la corsia box: la
// corsia disegnata e quella percorsa dall'autopilota devono coincidere.
const PIT_LANE_SAMPLES = 300;
const QUALI_LEAD = 8;        // unità avanti alla linea di partenza per lo spawn di qualifica
// GRID_START/GRID_STAGGER/GRID_LANE_OFFSET: vedi TrackGeometry (modulo
// condiviso) — spostate lì così il disegno permanente della griglia sulla
// pista (frontend) usa esattamente la stessa formula dello spawn reale,
// nessun rischio di divergenza.
// Tolleranza per il warning "startFinish.angle quasi opposto al verso
// geometrico" (vedi buildTrack sotto) — quanto vicino a 180 gradi di
// differenza far scattare l'avviso. Abbastanza stretta da non disturbare
// un traguardo volutamente leggermente obliquo (vedi commento su `angle`
// sotto), abbastanza larga da coprire il caso reale riscontrato (~178°).
const STARTFINISH_OPPOSITE_TOLERANCE_DEG = 30;

const cache = new Map();

// Catmull-Rom uniforme 1D (4 punti di controllo, derivata continua) — stessa
// filosofia della spline centripeta già usata da TrackGeometry.evalSegment
// per il tracciato base, qui applicata a un valore scalare (offset laterale)
// invece che a punti x/z. Sostituisce l'interpolazione LINEARE precedente:
// linea a tratti = derivata (curvatura) discontinua a ogni punto di
// controllo, che la finestra di misura della curvatura del bot (BOT_CURVATURE_LOCAL_M,
// spesso più stretta della spaziatura tra i punti di controllo) legge come
// una serie di curve fantasma anche nei tratti dritti — causa verificata di
// letture di velocità/lookahead rumorose lontano da qualunque curva reale
// (Rif. audit 2026-08-06). Passa ESATTAMENTE per ogni punto di controllo
// (a differenza di uno smoothing a media mobile, che sposterebbe la linea
// da quanto misurato/validato dall'ottimizzatore).
function catmullRom1D(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// Racing line precalcolata offline (vedi backend/tools/f1RaceLineOptimizer.js
// + docs/superpowers/specs/2026-07-24-f1-bot-cornering-redesign-design.md):
// opzionale, `${id}-raceline.json` con {tuning, lineControls}. lineControls è
// un array corto di punti di controllo (offset laterale dal centro pista),
// interpolato qui sull'intero campionamento della pista — stessa identica
// interpolazione usata dall'ottimizzatore per costruirla (vedi
// interpolateControls in f1RaceLineOptimizer.js, DEVE restare in sync con
// questa), altrimenti la linea che il bot segue in gara non sarebbe quella
// davvero misurata/validata offline.
function interpolateLineControls(controls, targetLen) {
    const m = controls.length;
    const out = new Array(targetLen);
    for (let i = 0; i < targetLen; i++) {
        const cf = i * m / targetLen;
        const c1 = Math.floor(cf) % m;
        const t = cf - Math.floor(cf);
        const c0 = ((c1 - 1) % m + m) % m;
        const c2 = (c1 + 1) % m;
        const c3 = (c1 + 2) % m;
        out[i] = catmullRom1D(controls[c0], controls[c1], controls[c2], controls[c3], t);
    }
    return out;
}

// F1_RACELINE_SUFFIX (spento di default, stesso schema di F1_TYRE_SLIP_MODEL
// e affini in f1GameSocket.js/physics/*: si imposta PRIMA di avviare il
// server, mai a runtime — trackLoader cachea il risultato di buildTrack per
// id al primo loadTrack, vedi `cache` sopra) — permette di far caricare al
// gioco vero un file *-raceline.json ALTERNATIVO (es. "-sa" per
// "prova-sa-raceline.json") senza mai toccare/sovrascrivere quello di
// produzione, per playtestare un candidato dell'ottimizzatore in localhost
// prima di promuoverlo.
function racelineSuffix() {
    return process.env.F1_RACELINE_SUFFIX || '';
}

function loadRacelineData(id) {
    const file = path.join(RACELINES_DIR, `${id}${racelineSuffix()}-raceline.json`);
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

// Estratta da buildTrack (era inline) per essere riusabile anche da
// f1Testbench.js — Rif. verifica C, docs/superpowers/specs/2026-07-28-f1-bot-testbench-debug-design.md:
// il banco prova deve poter costruire una racing line sperimentale da un
// file di controlli alternativo, riusando ESATTAMENTE questa stessa
// interpolazione/proiezione, senza duplicarla.
function buildRacingLineFromControls(points, lineControls) {
    const offsets = interpolateLineControls(lineControls, points.length);
    return points.map((pt, i) => {
        const normal = TrackGeometry.normalAt(points, i, true);
        return { x: pt.x + normal.nx * offsets[i], z: pt.z + normal.nz * offsets[i] };
    });
}

function buildTrack(id, raw) {
    const points = TrackGeometry.sampleLoop(raw.controlPoints, SAMPLES);
    const lapLength = TrackGeometry.lapLength(points);
    const totalLaps = TrackGeometry.lapsForDistance(lapLength, raw.targetKm);

    const racelineData = loadRacelineData(id);
    let racingLine = null, racingLineTuning = null;
    if (racelineData) {
        racingLine = buildRacingLineFromControls(points, racelineData.lineControls);
        racingLineTuning = racelineData.tuning || null;
    }

    // startFinishIndex: indice campionato più vicino al traguardo esplicito
    // (piazzato nell'editor), stessa tecnica già usata per pitEntryIndex più
    // sotto. Se la pista non ha ancora `startFinish` (piste esistenti non
    // ancora riaperte nell'editor), resta 0 — comportamento identico a
    // prima di questa modifica, nessuna rottura.
    const startFinishIndex = raw.startFinish
        ? TrackGeometry.nearestPoint(points, raw.startFinish.x, raw.startFinish.z).index
        : 0;
    const p0 = points[startFinishIndex];
    const tangent = TrackGeometry.tangentAt(points, startFinishIndex, true);
    const normal  = TrackGeometry.normalAt(points, startFinishIndex, true);
    // Se l'utente ha orientato il traguardo diversamente dalla tangente pura
    // (linea leggermente obliqua rispetto alla pista) l'angolo esplicito
    // vince; altrimenti si deduce dalla tangente come sempre.
    const angle = (raw.startFinish && typeof raw.startFinish.angle === 'number')
        ? raw.startFinish.angle
        : Math.atan2(tangent.tx, tangent.tz);

    // Verifica preventiva (Rif. audit 2026-07-29 "verso pista invertito su
    // New Monza"): startFinish.angle è un orientamento LIBERO scelto
    // nell'editor, mai verificato contro il verso geometrico reale (quello
    // che governa davvero trackIndex/lookahead/cornerTargetSpeed/racingLine
    // — la tangente sopra). Se l'utente orienta la maniglia nel verso
    // opposto per errore, oggi nulla lo segnala finché non si vedono i bot
    // fare un testacoda in partenza (bug reale riprodotto e diagnosticato
    // su New Monza). Solo un warning in console: NESSUNA correzione
    // automatica, per non alterare silenziosamente un dato — la scelta
    // resta dell'utente, in editor.
    if (raw.startFinish && typeof raw.startFinish.angle === 'number') {
        const geometricAngle = Math.atan2(tangent.tx, tangent.tz);
        let diffDeg = (angle - geometricAngle) * 180 / Math.PI;
        while (diffDeg > 180) diffDeg -= 360;
        while (diffDeg <= -180) diffDeg += 360;
        if (Math.abs(Math.abs(diffDeg) - 180) < STARTFINISH_OPPOSITE_TOLERANCE_DEG) {
            console.warn(`loadTrack: startFinish.angle della pista "${id}" e' quasi opposto (${diffDeg.toFixed(1)} gradi) al verso geometrico reale del tracciato (tangente ai controlPoints) - probabile inversione, da correggere in editor.`);
        }
    }

    // Punto lungo la tangente di partenza, con un offset laterale lungo la
    // normale — usato SOLO per lo spawn di qualifica (un punto singolo,
    // vicino a p0: QUALI_LEAD=8 non si allontana abbastanza da un
    // traguardo su curva perché l'estrapolazione lineare sia un problema
    // pratico). Rispetta l'eventuale angolo esplicito scelto in editor
    // (raw.startFinish.angle), comportamento invariato.
    function alongTrack(distForward, lateralOffset) {
        return {
            x: p0.x + tangent.tx * distForward + normal.nx * lateralOffset,
            z: p0.z + tangent.tz * distForward + normal.nz * lateralOffset,
            angle
        };
    }

    // Griglia di partenza: TrackGeometry.gridSpawnPoint cammina sui punti
    // VERI del tracciato (Rif. richiesta utente 2026-08-07 — prima usava
    // alongTrack, la stessa estrapolazione lineare da un unico
    // punto+angolo fissi: su un tratto curvo vicino al traguardo, le
    // posizioni più lontane da p0 finivano fuori dalla vera linea
    // centrale E con un angolo non allineato alla pista in quel punto —
    // "auto storte" segnalato in playtest). Funzione condivisa con
    // frontend/f1.js (disegno permanente della griglia sulla pista) —
    // nessun rischio di divergenza tra le due. Nota: qui l'eventuale
    // startFinish.angle esplicito NON viene propagato alle posizioni
    // lontane da p0 (non avrebbe senso su un tratto curvo), resta
    // rilevante solo per qualiSpawn/alongTrack sopra.
    function gridSpawnPoint(i) {
        return TrackGeometry.gridSpawnPoint(points, startFinishIndex, i);
    }

    // Indice campionato del punto pista più vicino al VERO trigger d'ingresso
    // (non a pitPath[0]: sono due cose diverse in editor — il trigger può
    // stare su un punto qualunque della corsia box, es. pitPath[1], per
    // evitare sovrapposizioni con la pista vera). Precalcolato una volta
    // qui, non ad ogni tick: serve al bot per sapere QUANDO è vicino
    // all'ingresso box lungo il proprio giro (f1Bot.js, idxUntilPitEntry) —
    // se questo indice restasse ancorato a pitPath[0] mentre il trigger reale
    // è più avanti (es. pitPath[1]), la finestra di avvicinamento (e la sua
    // "nearPitEntry") scadrebbe non appena l'auto supera pitPath[0], PRIMA
    // di raggiungere il trigger vero — il bot abbandonerebbe la manovra
    // proprio all'ultimo, tornando di scatto alla guida normale (bug reale,
    // riprodotto in simulazione su New Monza dopo aver spostato il trigger
    // al secondo punto della corsia).
    const pitEntryIndex = TrackGeometry.nearestPoint(points, raw.pit.entryTrigger.x, raw.pit.entryTrigger.z).index;

    // Aggancia il primo e l'ultimo punto della corsia box esattamente al
    // bordo della pista vera (Rif. richiesta utente 2026-08-08): elimina la
    // dipendenza dalla precisione manuale con cui l'autore ha piazzato gli
    // estremi in editor. Risolve anche un bug collaterale mai segnalato
    // esplicitamente — verificato sulle piste esistenti: il punto finale
    // era 4-10 unità oltre roadHalf, abbastanza per far scattare
    // applyOffTrackDrag nell'istante stesso in cui il giocatore riprende i
    // comandi in uscita dai box (VehicleMotionModel.js).
    const pitPath = TrackGeometry.snapPitPathEnds(raw.pit.path, points, raw.roadHalfWidth);

    // Punti CAMPIONATI della corsia box: la stessa espressione usata da
    // frontend/f1.js per disegnarla (sampleOpenPath + tuckPitEndsToTrack), così
    // la linea che l'autopilota percorre e quella che il giocatore vede non
    // possono divergere. L'autopilota camminava sui punti di CONTROLLO grezzi
    // (7 su "prova"): muovendosi in retta fra un controllo e l'altro tagliava
    // le curve, allontanandosi fino a 3.35 unità dalla linea della corsia su
    // una semilarghezza di 5 (misurato) — "il pilota automatico non segue
    // esattamente la corsia", segnalato dall'utente il 2026-08-09.
    const pitLanePts = TrackGeometry.tuckPitEndsToTrack(
        TrackGeometry.sampleOpenPath(pitPath, PIT_LANE_SAMPLES), points);

    return {
        id,
        name: raw.name,
        points,
        roadHalf: raw.roadHalfWidth,
        lapLength,
        totalLaps,
        pitPath,
        pitLanePts,
        pitEntryIndex,
        startFinishIndex,
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
    if (!et || typeof et.x !== 'number' || typeof et.z !== 'number' || typeof et.halfWidth !== 'number' || typeof et.halfLength !== 'number' || typeof et.angle !== 'number') {
        return 'pit.entryTrigger non valido (servono x, z, halfWidth, halfLength, angle)';
    }
    if (!(et.halfWidth > 0) || !(et.halfLength > 0)) return 'pit.entryTrigger non valido: halfWidth/halfLength devono essere positivi';
    // Il riquadro non deve necessariamente contenere il primo punto della
    // corsia box (che spesso coincide col distacco dalla linea principale,
    // ancora "in pista"): basta che intercetti ALMENO un punto della corsia,
    // altrimenti il trigger non corrisponde alla vera zona d'ingresso di
    // questa pista (bug reale riscontrato: un riquadro lasciato ai valori di
    // default di un'altra pista, che finiva per intercettare un tratto
    // qualunque del tracciato principale invece della corsia box).
    const triggerHitsPath = data.pit.path.some(pt => TrackGeometry.pointInOrientedBox(pt.x, pt.z, et));
    if (!triggerHitsPath) return 'pit.entryTrigger non intercetta nessun punto della corsia box: il riquadro non corrisponde al vero punto d\'ingresso';
    // startFinish è opzionale (compatibilità con piste esistenti senza
    // questo campo), ma se presente deve avere almeno x/z numerici — un
    // oggetto parziale (es. dimenticato angle, che invece resta opzionale)
    // andrebbe silenziosamente ignorato più avanti senza questo controllo.
    if (data.startFinish && (typeof data.startFinish.x !== 'number' || typeof data.startFinish.z !== 'number')) {
        return 'startFinish non valido (servono almeno x e z numerici)';
    }
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

module.exports = { loadTrack, listTracks, saveTrack, deleteTrack, loadRacelineData, buildRacingLineFromControls };
