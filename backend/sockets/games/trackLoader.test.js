const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTrack, listTracks, saveTrack, deleteTrack, normalizzaAbrasivita } = require('./trackLoader.js');

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

// Sostituisce il vecchio confronto con valori storici hardcoded (era già
// rotto PRIMA di questa modifica: la tolleranza di 4 unità non copriva più
// lo scostamento reale — vedi git history). Rif. richiesta utente
// 2026-08-07: gridSpawnPoint usava un'estrapolazione lineare da un unico
// punto+angolo fissi (il traguardo), quindi su un tratto curvo le
// posizioni più lontane finivano fuori dalla vera linea centrale — bug
// "auto storte in griglia" segnalato in playtest. Ora cammina sui punti
// VERI del tracciato (TrackGeometry.walkClosedLoop), quindi la proprietà
// giusta da verificare non è più "vicino a un valore congelato", ma
// "resta sulla vera linea centrale, all'esatta distanza di corsia
// attesa" — è ESATTAMENTE la proprietà che il vecchio bug violava su una
// curva, quindi un test efficace anche per una futura regressione.
const trackLoaderGeom = require('../../../frontend/shared/trackGeometry.js');

test('gridSpawnPoint segue la vera curva del tracciato: ogni posizione resta esattamente a GRID_LANE_OFFSET dalla linea centrale', () => {
    const track = loadTrack('monte-rosso');
    const GRID_LANE_OFFSET = 6;   // deve restare in sync col valore in trackLoader.js
    for (let i = 0; i < 4; i++) {
        const g = track.gridSpawnPoint(i);
        const nearest = trackLoaderGeom.nearestPoint(track.points, g.x, g.z);
        assert.ok(Math.abs(nearest.dist - GRID_LANE_OFFSET) < 0.5,
            `gridSpawnPoint(${i}) a distanza ${nearest.dist.toFixed(2)} dalla linea centrale, atteso ~${GRID_LANE_OFFSET} — se molto diverso, la posizione sta "tagliando dritto" invece di seguire la curva`);
    }
});

test('gridSpawnPoint: le posizioni nella stessa corsia sono spaziate di 2×GRID_STAGGER lungo la pista, non ammassate', () => {
    const track = loadTrack('monte-rosso');
    const g0 = track.gridSpawnPoint(0), g2 = track.gridSpawnPoint(2);   // stessa corsia (i pari)
    const dist = Math.hypot(g0.x - g2.x, g0.z - g2.z);
    assert.ok(dist > 10, `distanza tra gridSpawnPoint(0) e (2) troppo piccola (${dist.toFixed(2)}) — le auto si ammasserebbero`);
});

test('qualiSpawn: resta vicino al tracciato (non un punto arbitrario lontano)', () => {
    const track = loadTrack('monte-rosso');
    const nearest = trackLoaderGeom.nearestPoint(track.points, track.qualiSpawn.x, track.qualiSpawn.z);
    assert.ok(nearest.dist < 15, `qualiSpawn troppo lontano dalla pista: ${nearest.dist.toFixed(2)}`);
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
            entryTrigger: { x: 1, z: 1, halfWidth: 2, halfLength: 2, angle: 0 },
            path: [{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 2, z: 2 }]
        }
    }, overrides);
}

test('saveTrack accetta un entryTrigger orientabile che intercetta la corsia box', () => {
    saveTrack(minimalValidTrackData());
    try {
        assert.ok(listTracks().some(t => t.id === 'test-scratch-track'));
    } finally {
        deleteTrack('test-scratch-track');
    }
});

test('saveTrack rifiuta il vecchio schema entryTrigger a 4 campi assi-allineato (senza halfWidth/halfLength/angle)', () => {
    const data = minimalValidTrackData({
        pit: Object.assign({}, minimalValidTrackData().pit, {
            entryTrigger: { xMin: -1, xMax: 3, zMin: -1, zMax: 3 }
        })
    });
    assert.throws(() => saveTrack(data), /entryTrigger non valido \(servono x, z, halfWidth, halfLength, angle\)/);
});

test('saveTrack rifiuta un entryTrigger che non intercetta nessun punto della corsia box', () => {
    const data = minimalValidTrackData({
        pit: Object.assign({}, minimalValidTrackData().pit, {
            // riquadro lontanissimo dalla corsia box (path attorno a x/z 0-2):
            // stesso tipo di errore del bug reale (default di un'altra pista).
            entryTrigger: { x: 550, z: 550, halfWidth: 50, halfLength: 50, angle: 0 }
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

test('buildTrack: senza startFinish, startFinishIndex è 0 (comportamento odierno invariato)', () => {
    const track = loadTrack('monte-rosso');
    assert.equal(track.startFinishIndex, 0);
});

test('saveTrack + loadTrack: con startFinish esplicito, qualiSpawn/gridSpawnPoint seguono quel punto (non più il control point 0)', () => {
    // Quadrato semplice: startFinish sul lato opposto al control point 0,
    // così un eventuale bug "ignora startFinish e usa comunque indice 0"
    // produce uno scarto enorme (non un piccolo errore di arrotondamento).
    const data = Object.assign({}, minimalValidTrackData(), {
        id: 'test-scratch-startfinish',
        startFinish: { x: 10, z: 10, angle: 0 }
    });
    saveTrack(data);
    try {
        const track = loadTrack('test-scratch-startfinish');
        // Il control point più vicino a (10,10) tra quelli del quadrato di
        // test (0,0)-(10,0)-(10,10)-(0,10) è l'indice campionato vicino a
        // (10,10): qualiSpawn deve stare vicino lì, non vicino a (0,0).
        // qualiSpawn = alongTrack(QUALI_LEAD, 0) con QUALI_LEAD=8: è p0 + 8
        // unità forward lungo la tangente (offset deterministico dalla
        // definizione di spawn point, non dall'arrotondamento della curva).
        // La tolleranza di 9 unità copre questo offset di 8 unità più margine,
        // rimanendo abbastanza stretta da rivelare un bug dove il valore di
        // startFinish viene ignorato (il che porterebbe a qualiSpawn vicino a
        // (0,0), scarto di ~14 unità).
        assert.ok(Math.hypot(track.qualiSpawn.x - 10, track.qualiSpawn.z - 10) < 9,
            `qualiSpawn troppo lontano da (10,10): ${JSON.stringify(track.qualiSpawn)}`);
        assert.notEqual(track.startFinishIndex, 0);
    } finally {
        deleteTrack('test-scratch-startfinish');
    }
});

test('saveTrack: con startFinish.angle esplicito, qualiSpawn.angle usa quel valore invece della tangente dedotta', () => {
    const data = Object.assign({}, minimalValidTrackData(), {
        id: 'test-scratch-startfinish-angle',
        startFinish: { x: 0, z: 0, angle: 1.2345 }
    });
    saveTrack(data);
    try {
        const track = loadTrack('test-scratch-startfinish-angle');
        assert.ok(Math.abs(track.qualiSpawn.angle - 1.2345) < 1e-9);
    } finally {
        deleteTrack('test-scratch-startfinish-angle');
    }
});

// ---- Warning "startFinish.angle quasi opposto alla tangente geometrica"
// (Rif. audit 2026-07-29 "verso pista invertito su New Monza"): solo un
// avviso in console, MAI una correzione automatica del dato — questi test
// verificano che scatti quando serve e non scatti per un'inclinazione
// volutamente leggera, non il contenuto esatto del messaggio. ----

const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');

// Le piste si leggono dalla cartella invece di elencarle a mano: un elenco
// scritto qui invecchia, e si rompe quando una pista viene aggiunta o tolta
// (successo con `baku`, rimossa il 2026-08-17). Le piste finte create al volo
// da altri test (`test-...`) restano fuori: la suite gira in parallelo.
const TRACCIATI = require('fs')
    .readdirSync(require('path').join(__dirname, '..', '..', '..', 'frontend', 'tracks'))
    .filter(f => f.endsWith('.json') && !/^(__|test-)/.test(f))
    .map(f => f.replace(/\.json$/, ''));


function geometricAngleFor(controlPoints, startFinish) {
    const points = TrackGeometry.sampleLoop(controlPoints, 1000);
    const idx = TrackGeometry.nearestPoint(points, startFinish.x, startFinish.z).index;
    const tangent = TrackGeometry.tangentAt(points, idx, true);
    return Math.atan2(tangent.tx, tangent.tz);
}

function withCapturedWarnings(fn) {
    const original = console.warn;
    const messages = [];
    console.warn = (msg) => messages.push(msg);
    try {
        fn();
    } finally {
        console.warn = original;
    }
    return messages;
}

test('loadTrack: startFinish.angle opposto (~180°) alla tangente geometrica genera un warning in console', () => {
    const controlPoints = minimalValidTrackData().controlPoints;
    const startFinish = { x: 0, z: 0 };
    const geometricAngle = geometricAngleFor(controlPoints, startFinish);
    const data = Object.assign({}, minimalValidTrackData(), {
        id: 'test-scratch-startfinish-inverted',
        startFinish: { x: 0, z: 0, angle: geometricAngle + Math.PI }   // deliberatamente opposto
    });
    saveTrack(data);
    try {
        const messages = withCapturedWarnings(() => loadTrack('test-scratch-startfinish-inverted'));
        assert.ok(
            messages.some(m => /test-scratch-startfinish-inverted/.test(m) && /oppost/i.test(m)),
            `atteso un warning sull'inversione, ottenuto: ${JSON.stringify(messages)}`
        );
    } finally {
        deleteTrack('test-scratch-startfinish-inverted');
    }
});

test('loadTrack: startFinish.angle allineato (o con lieve inclinazione) alla tangente NON genera warning', () => {
    const controlPoints = minimalValidTrackData().controlPoints;
    const startFinish = { x: 0, z: 0 };
    const geometricAngle = geometricAngleFor(controlPoints, startFinish);
    const data = Object.assign({}, minimalValidTrackData(), {
        id: 'test-scratch-startfinish-aligned',
        // +10° di inclinazione volontaria (linea leggermente obliqua,
        // caso esplicitamente previsto e legittimo) — non deve scattare.
        startFinish: { x: 0, z: 0, angle: geometricAngle + (10 * Math.PI / 180) }
    });
    saveTrack(data);
    try {
        const messages = withCapturedWarnings(() => loadTrack('test-scratch-startfinish-aligned'));
        assert.equal(messages.length, 0, `nessun warning atteso, ottenuto: ${JSON.stringify(messages)}`);
    } finally {
        deleteTrack('test-scratch-startfinish-aligned');
    }
});

test('validateTrackData: startFinish malformato (manca x o z) viene rifiutato', () => {
    const data = Object.assign({}, minimalValidTrackData(), {
        id: 'test-scratch-startfinish-bad',
        startFinish: { z: 0, angle: 0 }
    });
    assert.throws(() => saveTrack(data), /startFinish non valido/);
});

test('il muro del server sta esattamente dove il client lo disegna', () => {
    // Il muro fisico e quello disegnato nascono dalla stessa funzione, ma da
    // due catene di input diverse (server: buildTrack; client: f1.js). Qui si
    // rifà la catena del client e si pretende che i due profili coincidano
    // campione per campione: se qualcuno cambiasse il numero di campioni, o il
    // modo di ricavare la corsia box, da una parte sola, in gioco si
    // sbatterebbe contro un muro invisibile — o si passerebbe attraverso uno
    // visibile.
    const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');
    const TrackGravel = require('../../../frontend/shared/trackGravel.js');

    for (const id of TRACCIATI) {
        const track = loadTrack(id);
        const raw = JSON.parse(fs.readFileSync(path.join(TRACKS_DIR, id + '.json'), 'utf8'));

        // Esattamente quello che fa f1.js prima di disegnare.
        const trackPts = TrackGeometry.sampleLoop(raw.controlPoints, 1000);
        const pitPath = TrackGeometry.snapPitPathEnds(raw.pit.path, trackPts, raw.roadHalfWidth);
        const pitPts = TrackGeometry.tuckPitEndsToTrack(
            TrackGeometry.sampleOpenPath(pitPath, 300), trackPts);
        const disegnato = TrackGravel.barrierProfile(trackPts, {
            roadHalf: raw.roadHalfWidth, curbW: 2.8,
            pitLanePts: pitPts, pitRoadHalf: raw.pit.roadHalfWidth,
        });

        assert.ok(track.barrierProfile, `${id}: il server non espone il profilo del muro`);
        assert.ok(Array.isArray(track.pitGapPts) && track.pitGapPts.length > 0,
            `${id}: manca il varco della corsia box`);
        for (const lato of ['left', 'right']) {
            for (let i = 0; i < trackPts.length; i++) {
                assert.ok(Math.abs(track.barrierProfile[lato][i] - disegnato[lato][i]) < 1e-9,
                    `${id}: al campione ${i} lato ${lato} il muro sta a ${track.barrierProfile[lato][i].toFixed(2)} ma è disegnato a ${disegnato[lato][i].toFixed(2)}`);
            }
        }
    }
});

// ═══════════ QUANTI PILOTI REGGE UNA PISTA ═══════════
//
// Il tetto non è una regola di gioco ma una misura della corsia box: quanti
// box ci stanno, a passo TrackGeometry.PIT_BOX_SPACING. Serve alla lobby per
// non offrire venti piloti su una pista che ne regge tredici — i box in
// eccesso finirebbero oltre la fine della corsia. Chi disegna una corsia più
// lunga alza il tetto senza toccare il codice.
test('listTracks dice quanti piloti regge ogni pista', () => {
    const piste = listTracks();
    assert.ok(piste.length > 0);
    for (const p of piste) {
        assert.ok(Number.isInteger(p.maxDrivers) && p.maxDrivers >= 1,
            `${p.id}: maxDrivers mancante o non valido (${p.maxDrivers})`);
        assert.ok(p.maxDrivers <= 20, `${p.id}: ${p.maxDrivers} supera il tetto assoluto di 20`);
    }
});

test('il tetto di una pista coincide con le posizioni della sua corsia box', () => {
    const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');
    for (const p of listTracks()) {
        const t = loadTrack(p.id);
        const posizioni = TrackGeometry.pitLaneSlots(t.pitPath, t.pitBoxIndex, t.points, t.pitRoadHalf).length;
        assert.equal(p.maxDrivers, Math.min(20, posizioni),
            `${p.id}: dichiara ${p.maxDrivers} piloti ma la corsia ha ${posizioni} posizioni`);
    }
});

// Abrasivita' del circuito: quanto quell'asfalto mangia le gomme. E' l'unica
// cosa che rende under-cut e over-cut una scelta invece che una teoria, e
// resta INVISIBILE graficamente (richiesta esplicita dell'utente): due piste
// identiche a vedersi possono chiedere una sosta o due.
// Rif. docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md
test("trackLoader: senza il campo, abrasivita' vale 1", () => {
    const track = loadTrack('prova');
    assert.equal(track.abrasivita, 1);
});

test("trackLoader: abrasivita' fuori scala viene limitata", () => {
    // Un file scritto a mano non deve poter azzerare o far esplodere il
    // consumo: 0 renderebbe le gomme eterne, 50 le distruggerebbe in una curva.
    assert.equal(normalizzaAbrasivita(0), 0.5);
    assert.equal(normalizzaAbrasivita(50), 2);
    assert.equal(normalizzaAbrasivita(undefined), 1);
    assert.equal(normalizzaAbrasivita('molta'), 1);
    assert.equal(normalizzaAbrasivita(1.35), 1.35);
});

// ====================================================
// LA GEOMETRIA DELL'EDITOR (blocco D, 2026-08-24)
//
// `geometria` e' FACOLTATIVA: le piste disegnate a punti non ce l'hanno e
// restano valide per sempre. Se c'e', dev'essere coerente — un file malformato
// non romperebbe il gioco (che legge controlPoints) ma romperebbe l'editor
// alla riapertura, che e' peggio: il danno si vede solo quando l'autore ha
// gia' perso il lavoro.
//
// Rif. docs/superpowers/specs/2026-08-24-f1-editor-segmenti-design.md
// ====================================================
function geometriaValida() {
    return {
        versione: 1,
        nodi: [{ x: 0, z: 0, dir: 0 }, { x: 10, z: 0, dir: 1 }, { x: 10, z: 10, dir: 2 }],
        tratti: [{ tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'curva' }],
    };
}

test('saveTrack rifiuta una geometria con meno tratti che nodi', () => {
    const data = minimalValidTrackData();
    data.geometria = geometriaValida();
    data.geometria.tratti = [{ tipo: 'retta' }];
    assert.throws(() => saveTrack(data), /geometria: serve un tratto per ogni nodo/);
});

test('saveTrack rifiuta un tipo di tratto sconosciuto', () => {
    const data = minimalValidTrackData();
    data.geometria = geometriaValida();
    data.geometria.tratti[1] = { tipo: 'parabolica' };
    assert.throws(() => saveTrack(data), /tipo di tratto sconosciuto/);
});

test('saveTrack rifiuta nodi senza direzione', () => {
    const data = minimalValidTrackData();
    data.geometria = geometriaValida();
    delete data.geometria.nodi[1].dir;
    assert.throws(() => saveTrack(data), /nodi malformati/);
});

test('saveTrack accetta una geometria ben formata', () => {
    const data = minimalValidTrackData();
    data.geometria = geometriaValida();
    try {
        saveTrack(data);   // non deve lanciare
    } finally {
        deleteTrack('test-scratch-track');
    }
});

test('saveTrack: una pista senza geometria resta valida', () => {
    try {
        saveTrack(minimalValidTrackData());   // non deve lanciare
    } finally {
        deleteTrack('test-scratch-track');
    }
});

// --- pendenza per campione (fase 1a: gravita' lungo il nastro) ---

test('ogni campione ha una pendenza finita, su tutte le piste', () => {
    for (const t of listTracks()) {
        const id = t.id || t;
        const track = loadTrack(id);
        for (let i = 0; i < track.points.length; i++) {
            assert.equal(typeof track.points[i].pendenza, 'number',
                `${id} campione ${i}: pendenza mancante`);
            assert.ok(Number.isFinite(track.points[i].pendenza),
                `${id} campione ${i}: pendenza non finita`);
        }
    }
});

test('una pista senza dislivelli ha pendenza zero ovunque', () => {
    const track = loadTrack('monte-rosso');
    for (const p of track.points) assert.ok(Math.abs(p.pendenza) < 1e-9);
});

// prova sale e scende davvero (quota da 0 a 11.5): se la pendenza fosse sempre
// zero il campo ci sarebbe ma non direbbe niente, ed e' proprio il modo in cui
// un valore di ripiego passa inosservato.
test('prova ha pendenze vere, in salita e in discesa', () => {
    const track = loadTrack('prova');
    const pct = track.points.map(p => Math.tan(p.pendenza) * 100);
    assert.ok(Math.max(...pct) > 5, `salita massima ${Math.max(...pct).toFixed(1)}%`);
    assert.ok(Math.min(...pct) < -5, `discesa massima ${Math.min(...pct).toFixed(1)}%`);
});

// --- la sopraelevazione nel file salvato ---

function geometriaMinima(rollioGradi) {
    return {
        nodi: [
            { x: 0, z: 0, dir: 0 },
            { x: 100, z: 0, dir: 1.5 },
            { x: 100, z: 100, dir: 3 }
        ],
        tratti: [
            { tipo: 'curva', rollioGradi },
            { tipo: 'curva' },
            { tipo: 'curva' }
        ]
    };
}

test('saveTrack accetta una sopraelevazione entro i 45 gradi', () => {
    try {
        saveTrack(minimalValidTrackData({ geometria: geometriaMinima(18) }));   // non deve lanciare
        const riletta = JSON.parse(fs.readFileSync(path.join(TRACKS_DIR, 'test-scratch-track.json'), 'utf8'));
        assert.equal(riletta.geometria.tratti[0].rollioGradi, 18,
            'la sopraelevazione non e\' sopravvissuta al salvataggio');
    } finally {
        deleteTrack('test-scratch-track');
    }
});

test('saveTrack rifiuta una sopraelevazione fuori scala', () => {
    // Meglio fermarla qui che scoprirla in gara: oltre i 45 gradi il cuneo di
    // terra sotto la pista diventa una parete.
    for (const cattiva of [90, -5, NaN, 'venti']) {
        assert.throws(
            () => saveTrack(minimalValidTrackData({ geometria: geometriaMinima(cattiva) })),
            /sopraelevazione fuori scala/,
            `${cattiva} non doveva passare`);
    }
});

// --- sopraelevazione per campione (fase 1b-1: banking) ---

test('ogni campione ha un rollio finito e non negativo, su tutte le piste', () => {
    for (const t of listTracks()) {
        const id = t.id || t;
        const track = loadTrack(id);
        for (let i = 0; i < track.points.length; i++) {
            const r = track.points[i].rollio;
            assert.equal(typeof r, 'number', `${id} campione ${i}: rollio mancante`);
            assert.ok(Number.isFinite(r) && r >= 0, `${id} campione ${i}: rollio ${r}`);
        }
    }
});

test('una pista risulta sopraelevata solo se la sua geometria lo dichiara', () => {
    // Se una lo diventasse per sbaglio — un campo copiato, un default finito a
    // 1 — questo test lo direbbe subito, invece di lasciarlo scoprire in gara.
    //
    // ⚠️ Non si elencano le piste piane: l'elenco andrebbe aggiornato a ogni
    // pista nuova, e il giorno che qualcuno se ne dimentica il test diventa
    // muto. Si confronta invece il DATO col suo unico posto legittimo di
    // nascita: `rollioGradi` sui tratti della geometria. Una pista che non lo
    // dichiara non puo' avere campioni sopraelevati; una che lo dichiara non
    // puo' superarlo.
    for (const t of listTracks()) {
        const id = t.id || t;
        const track = loadTrack(id);
        const massimoCampioni = Math.max(...track.points.map(p => p.rollio));
        const grezza = JSON.parse(fs.readFileSync(path.join(TRACKS_DIR, `${id}.json`), 'utf8'));
        const tratti = (grezza.geometria && grezza.geometria.tratti) || [];
        const dichiarato = Math.max(0, ...tratti.map(s => (s && s.rollioGradi) || 0)) * Math.PI / 180;
        if (!dichiarato) {
            assert.equal(massimoCampioni, 0, `${id} risulta sopraelevata senza dichiararlo`);
        } else {
            assert.ok(massimoCampioni <= dichiarato + 1e-9,
                `${id}: campioni fino a ${massimoCampioni} rad, dichiarati ${dichiarato}`);
        }
    }
});

test('la pendenza cotta e\' esattamente quella di TrackGeometry.pendenzaAt', () => {
    const track = loadTrack('prova');
    for (let i = 0; i < track.points.length; i += 37) {
        assert.equal(track.points[i].pendenza, TrackGeometry.pendenzaAt(track.points, i, true));
    }
});

// --- il rollio che arriva alla fisica e' quello che si vede ------------------

test('il rollio dichiarato su un pezzo dritto non arriva al gioco', () => {
    // Un tratto puo' portarsi dietro una sopraelevazione pur essendo quasi
    // dritto. La mesh li' non inclina niente (non c'e' un bordo esterno da
    // alzare); se la fisica leggesse il valore dichiarato, l'auto terrebbe di
    // piu' dove la pista si vede piatta. Il rollio dei campioni e quello del
    // disegno devono essere lo STESSO numero, e lo decide
    // TrackGeometry.rollioEfficaceAt per tutti e due.
    const RETT = 400, R = 100, N = 120;
    const anello = [];
    for (let i = 0; i < N; i++) {
        const t = i / N;
        let x, z;
        if (t < 0.25) { x = R; z = -RETT / 2 + RETT * (t / 0.25); }
        else if (t < 0.5) { const a = (t - 0.25) / 0.25 * Math.PI; x = R * Math.cos(a); z = RETT / 2 + R * Math.sin(a); }
        else if (t < 0.75) { x = -R; z = RETT / 2 - RETT * ((t - 0.5) / 0.25); }
        else { const a = (t - 0.75) / 0.25 * Math.PI; x = -R * Math.cos(a); z = -RETT / 2 - R * Math.sin(a); }
        // Sopraelevazione dichiarata OVUNQUE, rettilinei compresi.
        anello.push({ x, z, rollio: 20 * Math.PI / 180 });
    }
    saveTrack(minimalValidTrackData({ controlPoints: anello, targetKm: 3 }));
    try {
        const track = loadTrack('test-scratch-track');
        let inCurva = 0, suDritto = 0;
        for (let i = 0; i < track.points.length; i++) {
            // ⚠️ «Dritto» con la STESSA finestra che usa il modello (80 unita'
            // di pista): con quella stretta, di default, nel raccordo il raggio
            // rimbalza fino a 14000 e questo test chiamava dritti dei campioni
            // che stanno in piena curva d'ingresso.
            const passo = TrackGeometry.lapLength(track.points) / track.points.length;
            const span = Math.max(4, Math.round(TrackGeometry.FINESTRA_CURVA_UNITA / passo));
            const dritto = TrackGeometry.curvatureAt(track.points, i, span).radius > 1000;
            if (dritto) { if (track.points[i].rollio > 0) suDritto++; }
            else if (track.points[i].rollio > 0) inCurva++;
        }
        assert.equal(suDritto, 0, `${suDritto} campioni dritti hanno un rollio che nessuno disegna`);
        assert.ok(inCurva > 0, 'in curva il rollio deve restare');
    } finally {
        deleteTrack('test-scratch-track');
    }
});
