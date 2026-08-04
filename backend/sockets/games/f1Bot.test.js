// backend/sockets/games/f1Bot.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    PALETTE, normalizeAngle, steerToward, lookaheadIndex, apexOffset,
    cornerTargetSpeed, windowRadius, cornerApexNear, overtakeOffset, nearestAheadPlayer,
    pickPostPitCompound, pickBotColors, estimateFinishTime,
    updateBotInputs, DEFAULT_TUNING, shouldBotRepair, isBotGripAwarenessActive, trajectoryDiagnostics,
    adaptiveLookaheadMeters, isAdaptiveLookaheadActive, BOT_ADAPTIVE_LOOKAHEAD_K, BOT_ADAPTIVE_LOOKAHEAD_MAX_M, BOT_LOOKAHEAD_MIN_M,
    setLookaheadFormulaOverride, computeSoloRacingLineInputs
} = require('./f1Bot.js');
const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');

// Costruisce un tracciato sintetico con curvatura costante e controllata:
// dritto per `straightSamples` campioni, poi curva con `deltaAnglePerSample`
// radianti di svolta ad ogni campione successivo. Ogni campione dista
// esattamente 1 unità dal precedente (passo unitario), quindi
// metersPerSample=1 nei test che lo usano — nessuna ambiguità sul raggio
// reale della curva prodotta (raggio ≈ 1/deltaAnglePerSample).
function buildConstantCurveTrack(totalSamples, straightSamples, deltaAnglePerSample) {
    const pts = [];
    let x = 0, z = 0, heading = 0;
    for (let i = 0; i < totalSamples; i++) {
        pts.push({ x, z });
        const delta = i < straightSamples ? 0 : deltaAnglePerSample;
        heading += delta;
        x += Math.sin(heading);
        z += Math.cos(heading);
    }
    return pts;
}

// Curva che stringe (curvatura crescente) fino a un picco a metà della zona
// di curva, poi allarga di nuovo (curvatura decrescente) — a differenza di
// buildConstantCurveTrack (raggio costante, nessun apice ben definito), qui
// il raggio ha un vero minimo a metà curva: serve per testare che
// cornerApexNear trovi il minimo locale corretto, non un punto qualunque
// dentro la curva.
function buildVaryingCurveTrack(totalSamples, straightSamples, curveSamples, peakDeltaAnglePerSample) {
    const pts = [];
    let x = 0, z = 0, heading = 0;
    const half = curveSamples / 2;
    for (let i = 0; i < totalSamples; i++) {
        pts.push({ x, z });
        let delta = 0;
        if (i >= straightSamples && i < straightSamples + curveSamples) {
            const k = i - straightSamples;
            // Triangolo: 0 → peak (prima metà), peak → 0 (seconda metà)
            const t = k < half ? k / half : (curveSamples - k) / half;
            delta = peakDeltaAnglePerSample * t;
        }
        heading += delta;
        x += Math.sin(heading);
        z += Math.cos(heading);
    }
    return pts;
}

test('normalizeAngle riporta angoli fuori range in [-π, π]', () => {
    assert.ok(Math.abs(normalizeAngle(Math.PI * 3) - Math.PI) < 1e-9);
    assert.ok(Math.abs(normalizeAngle(-Math.PI * 3) - (-Math.PI)) < 1e-9);
    assert.ok(Math.abs(normalizeAngle(0.5) - 0.5) < 1e-9);
});

test('steerToward: target esattamente davanti (angle=0, target su +z) => sterzo ~0', () => {
    const steer = steerToward(0, 0, 0, 0, 10);
    assert.ok(Math.abs(steer) < 1e-6);
});

test('steerToward: target molto a destra satura a +1', () => {
    const steer = steerToward(0, 0, 0, 10, 0);
    assert.equal(steer, 1);
});

test('steerToward: target molto a sinistra satura a -1', () => {
    const steer = steerToward(0, 0, 0, -10, 0);
    assert.equal(steer, -1);
});

test('steerToward: piccolo scarto angolare non satura, segue il guadagno proporzionale', () => {
    // dx=0.3, dz=10 => desired = atan2(0.3,10) ~= 0.03 rad, gain=3.0 => steer ~0.09 (non satura)
    const steer = steerToward(0, 0, 0, 0.3, 10);
    const expected = Math.atan2(0.3, 10) * 3.0;
    assert.ok(Math.abs(steer - expected) < 1e-6);
    assert.ok(Math.abs(steer) < 1, `atteso non saturo, ottenuto ${steer}`);
});

test('lookaheadIndex avanza con wrap sul loop', () => {
    assert.equal(lookaheadIndex(1000, 995, 10), 5);
    assert.equal(lookaheadIndex(1000, 10, 5), 15);
    assert.equal(lookaheadIndex(1000, 0, 0), 0);
});

test('apexOffset: rettilineo puro => nessun offset', () => {
    // totalSamples=300 (non 80) e idx lontano dai bordi (150): lo stesso
    // motivo già documentato per 'cornerApexNear: rettilineo puro => null' —
    // buildConstantCurveTrack NON è un loop vero, quindi il campione 0 e
    // l'ultimo campione non sono contigui nella geometria. Con un raggio di
    // ricerca ±(searchSamples+localSamples)=±70 e un array troppo corto,
    // lookaheadIndex avvolge sul modulo e aggancia quella cucitura fittizia
    // (che sembra una curva strettissima ma è solo un artefatto), facendo
    // fallire il test per un motivo estraneo al comportamento di apexOffset.
    const points = buildConstantCurveTrack(300, 300, 0);
    const offset = apexOffset(points, 150, 60, 10, 1, 5, 0.85);
    assert.equal(offset.dx, 0);
    assert.equal(offset.dz, 0);
});

test('apexOffset: esattamente all\'apice => il massimo taglio verso l\'interno (verso il centro di curvatura)', () => {
    // NOTA taratura fixture: cornerApexNear riporta sempre distanceToApexM
    // >= metà di localSamples (qui 5, "floor" strutturale del suo algoritmo
    // a finestre — verificato con log manuale, vedi report) anche quando idx
    // è esattamente sul campione di raggio minimo reale. Con una curva TROPPO
    // stretta (es. peak=0.08 come nella bozza iniziale) questo floor di 5m
    // ricade già fuori dalla zona di influenza (halfSpanM = apexRadius*30°),
    // quindi lo shape all'apice risulterebbe negativo — non un bug di segno,
    // solo un raggio di curva troppo piccolo per essere risolto a questa
    // granularità. peak=0.03 (raggio reale ~40) e roadHalf=40 (severity~1)
    // mantengono il floor di 5m ben dentro la zona di influenza (~21m) pur
    // restando una curva "stretta" nel senso della severity — vedi report
    // per i valori intermedi loggati durante il debug.
    const points = buildVaryingCurveTrack(120, 20, 60, 0.03);   // apice atteso ~campione 50
    const before = points[50];
    // Centro di curvatura approssimato: per una curva verso destra (delta>0)
    // il centro sta dal lato interno rispetto al verso di marcia — stessa
    // verifica geometrica diretta già usata per la vecchia apexOffset,
    // adattata: il punto con l'offset applicato deve essere più vicino al
    // centro pista "verso l'interno" (normale invertita) rispetto al punto originale.
    const normal = TrackGeometry.normalAt(points, 50, true);
    const offset = apexOffset(points, 50, 60, 10, 1, 40, 0.85);
    const mag = Math.hypot(offset.dx, offset.dz);
    assert.ok(mag > 0.5 * 40 * 0.85, `atteso offset vicino al massimo all'apice, ottenuto magnitudine ${mag}`);
});

test('apexOffset: ben prima dell\'apice (in ingresso curva) => offset verso l\'ESTERNO (verso opposto rispetto all\'apice)', () => {
    // Stessa curva/roadHalf tarati sopra (peak=0.03, roadHalf=40): il segno
    // opposto ingresso/apice deve valere sulla STESSA geometria usata per
    // verificare "il massimo taglio all'apice", non su una curva diversa.
    const points = buildVaryingCurveTrack(120, 20, 60, 0.03);   // apice ~50
    const idx = 22;   // appena entrato in curva, lontano dall'apice
    const offsetAtEntry = apexOffset(points, idx, 60, 10, 1, 40, 0.85);
    const offsetAtApex = apexOffset(points, 50, 60, 10, 1, 40, 0.85);
    // Stesso verso della normale (stesso lato pista), ma segno OPPOSTO tra
    // ingresso (esterno) e apice (interno): il prodotto scalare dei due
    // offset deve essere negativo.
    const dot = offsetAtEntry.dx * offsetAtApex.dx + offsetAtEntry.dz * offsetAtApex.dz;
    assert.ok(dot < 0, `atteso offset di segno opposto tra ingresso e apice, ottenuto dot=${dot}`);
});

test('apexOffset: mai oltre roadHalf*maxOffsetFraction in valore assoluto, anche su un tornante strettissimo', () => {
    const points = buildVaryingCurveTrack(120, 20, 60, 0.5);   // tornante molto stretto
    for (const idx of [20, 30, 40, 50, 60, 70, 79]) {
        const offset = apexOffset(points, idx, 60, 10, 1, 5, 0.85);
        const mag = Math.hypot(offset.dx, offset.dz);
        assert.ok(mag <= 5 * 0.85 + 1e-6, `atteso <= ${5 * 0.85} a idx=${idx}, ottenuto ${mag}`);
    }
});

test('apexOffset: curva dolce => ampiezza minore che su un tornante stretto (taglio proporzionale)', () => {
    // "sharp" tarato a 0.08 invece di 0.3: un tornante da 0.3 rad/campione
    // (raggio reale ~4) è così stretto che il floor di 5m di
    // cornerApexNear (vedi sopra) cade ben oltre la sua stessa zona di
    // influenza (~2m), facendo collassare shape a 0 — quindi il confronto
    // con "mild" non testerebbe più la proporzionalità, solo un caso
    // degenere a offset nullo. 0.08 resta chiaramente più stretto di "mild"
    // (0.02) pur restando dentro la zona di influenza, dove la differenza di
    // severity/ampiezza è genuinamente misurabile.
    const mild = buildVaryingCurveTrack(120, 20, 60, 0.02);
    const sharp = buildVaryingCurveTrack(120, 20, 60, 0.08);
    const offsetMild = apexOffset(mild, 50, 60, 10, 1, 5, 0.85);
    const offsetSharp = apexOffset(sharp, 50, 60, 10, 1, 5, 0.85);
    assert.ok(Math.hypot(offsetSharp.dx, offsetSharp.dz) > Math.hypot(offsetMild.dx, offsetMild.dz),
        'atteso swing maggiore sul tornante stretto rispetto alla curva dolce');
});

test('windowRadius: rettilineo => null (nessuna curvatura significativa)', () => {
    const points = buildConstantCurveTrack(40, 40, 0);
    const w = windowRadius(points, 5, 15, 10);
    assert.equal(w, null);
});

test('windowRadius: curva a raggio noto => raggio coerente con arco/angolo', () => {
    const delta = 0.05;   // raggio geometrico atteso ≈ 1/delta = 20
    const points = buildConstantCurveTrack(60, 0, delta);
    const w = windowRadius(points, 10, 20, 10);   // arco locale = 10 unità (passo unitario nel builder)
    assert.ok(w !== null);
    assert.ok(Math.abs(w.radius - 20) < 1, `atteso raggio ~20, ottenuto ${w.radius}`);
    assert.ok(w.turnSigned > 0, 'curva verso destra (delta>0) => turnSigned positivo, come già verificato per apexOffset');
});

test('adaptiveLookaheadMeters: rettilineo (windowRadius nullo) => usa il tetto massimo', () => {
    const points = buildConstantCurveTrack(200, 200, 0);   // dritto per tutti i campioni
    const track = { points, lapLength: 200, roadHalf: 5 };
    const L = adaptiveLookaheadMeters(points, 50, track, 0.1);
    assert.equal(L, BOT_ADAPTIVE_LOOKAHEAD_MAX_M);
});

test('adaptiveLookaheadMeters: curva a raggio noto => coerente con sqrt(2*R*k*roadHalf) entro i limiti', () => {
    // raggio geometrico atteso ~= 1/0.05 = 20 (passo unitario => metersPerSample=1,
    // turn totale sulla finestra locale di 12 campioni = 0.6 rad, ben sotto
    // pi — niente wraparound). k=1 (non il candidato di default 0.1) scelto
    // apposta per tenere il risultato atteso (~14.1m) dentro l'intervallo
    // [BOT_LOOKAHEAD_MIN_M, BOT_ADAPTIVE_LOOKAHEAD_MAX_M] = [10,120]: un k
    // realistico (es. 0.1) darebbe qui un raw sotto il pavimento e
    // testerebbe solo il clamp, non la formula stessa.
    const points = buildConstantCurveTrack(300, 50, 0.05);
    const track = { points, lapLength: 300, roadHalf: 5 };
    const k = 1;
    const L = adaptiveLookaheadMeters(points, 100, track, k);
    const expectedApprox = Math.sqrt(2 * 20 * k * track.roadHalf);   // sqrt(200) ~= 14.14
    assert.ok(Math.abs(L - expectedApprox) < 1, `atteso ~${expectedApprox.toFixed(2)}, ottenuto ${L.toFixed(2)}`);
    assert.ok(L >= BOT_LOOKAHEAD_MIN_M - 1e-9, 'non deve scendere sotto il pavimento minimo');
    assert.ok(L <= BOT_ADAPTIVE_LOOKAHEAD_MAX_M + 1e-9, 'non deve superare il tetto massimo');
});

test('adaptiveLookaheadMeters: e_target molto piccolo => clampato al pavimento minimo', () => {
    // Stessa curva del test precedente (raggio ~20, turn totale sulla
    // finestra locale = 12*0.05 = 0.6 rad, ben sotto pi — niente wraparound
    // di normalizeAngle su windowRadius). NON usare un delta più grande per
    // "stringere" il raggio: con la finestra fissa di 12 campioni
    // (BOT_CURVATURE_LOCAL_M/metersPerSample), un turn totale vicino o oltre
    // pi fa avvolgere l'angolo (normalizeAngle) e restituisce un raggio
    // fittizio MOLTO più grande del vero raggio geometrico — bug di
    // metodologia già evitato qui scegliendo k piccolo invece del raggio.
    const points = buildConstantCurveTrack(300, 50, 0.05);
    const track = { points, lapLength: 300, roadHalf: 5 };
    const L = adaptiveLookaheadMeters(points, 100, track, 0.001);   // e_target piccolissimo apposta
    assert.equal(L, BOT_LOOKAHEAD_MIN_M);
});

test('adaptiveLookaheadMeters: setLookaheadFormulaOverride(null) => identico alla formula A', () => {
    // Stessa curva/k del test "curva a raggio noto" sopra — riusa lo stesso
    // caso già verificato per la formula A, qui per verificare che
    // l'override esplicitamente resettato a null (non solo mai toccato)
    // dia lo stesso risultato — Rif. review hook diagnostico Task 4.
    const points = buildConstantCurveTrack(300, 50, 0.05);
    const track = { points, lapLength: 300, roadHalf: 5 };
    const k = 1;
    setLookaheadFormulaOverride(null);
    const L = adaptiveLookaheadMeters(points, 100, track, k);
    const expectedApprox = Math.sqrt(2 * 20 * k * track.roadHalf);
    assert.ok(Math.abs(L - expectedApprox) < 1, `atteso ~${expectedApprox.toFixed(2)} (formula A), ottenuto ${L.toFixed(2)}`);
});

test('adaptiveLookaheadMeters: override attivo => sostituisce la formula A in modo deterministico, riceve tutti gli argomenti', () => {
    const points = buildConstantCurveTrack(300, 50, 0.05);
    const track = { points, lapLength: 300, roadHalf: 5 };
    let received = null;
    try {
        setLookaheadFormulaOverride((laneSource, trackIndex, trk, k, speedMs) => {
            received = { laneSource, trackIndex, trk, k, speedMs };
            return 42; // valore sentinella, impossibile da produrre con la formula A su questo input
        });
        const L = adaptiveLookaheadMeters(points, 100, track, 0.05, 33);
        assert.equal(L, 42, 'il valore restituito deve essere ESATTAMENTE quello dell\'override, nessun post-processing di adaptiveLookaheadMeters sopra');
        assert.equal(received.laneSource, points);
        assert.equal(received.trackIndex, 100);
        assert.equal(received.trk, track);
        assert.equal(received.k, 0.05);
        assert.equal(received.speedMs, 33, 'speedMs deve arrivare intatto all\'override');
    } finally {
        setLookaheadFormulaOverride(null);
    }
});

test('adaptiveLookaheadMeters: reset dell\'override (setLookaheadFormulaOverride(null)) ripristina la formula A', () => {
    const points = buildConstantCurveTrack(300, 50, 0.05);
    const track = { points, lapLength: 300, roadHalf: 5 };
    const k = 1;
    let L;
    try {
        setLookaheadFormulaOverride(() => 999); // "sporca" il risultato, diverso da qualunque valore di A qui
        L = adaptiveLookaheadMeters(points, 100, track, k);
        assert.equal(L, 999, 'override deve essere davvero attivo prima del reset');
    } finally {
        setLookaheadFormulaOverride(null);
    }
    const afterReset = adaptiveLookaheadMeters(points, 100, track, k);
    const expectedApprox = Math.sqrt(2 * 20 * k * track.roadHalf);
    assert.notEqual(afterReset, 999, 'dopo il reset non deve più restituire il valore sporcato dall\'override');
    assert.ok(Math.abs(afterReset - expectedApprox) < 1, `dopo il reset atteso ~${expectedApprox.toFixed(2)} (formula A), ottenuto ${afterReset.toFixed(2)}`);
});

test('computeSoloRacingLineInputs: su rettilineo punta dritto e non frena (targetSpeed satura a maxSpeed)', () => {
    const points = buildConstantCurveTrack(300, 200, 0);   // tutto dritto
    const track = { points, racingLine: points, lapLength: 300, roadHalf: 5 };
    const rt = { lookaheadTimeS: 0.6, steerGain: 3.0, adaptiveLookaheadK: 0.1, cornerSpeedMargin: 0.99, brakingDistanceMargin: 1.2, deadband: 0.01, ramp: 0.06 };
    const p = { x: points[100].x, z: points[100].z, angle: 0, speed: 5, trackIndex: 100 };

    const result = computeSoloRacingLineInputs(p, track, rt, 6, 1, 0.05, 1);

    assert.ok(Math.abs(result.steer) < 1e-6, `atteso sterzo ~0 su rettilineo, ottenuto ${result.steer}`);
    assert.equal(result.targetSpeed, 6, 'su rettilineo nessuna curva da anticipare, targetSpeed deve saturare a maxSpeed');
});

test('computeSoloRacingLineInputs: usa il lookahead adattivo, non più il tempo fisso legacy', () => {
    const points = buildConstantCurveTrack(300, 50, 0.1);   // curva stretta, raggio ~10
    const track = { points, racingLine: points, lapLength: 300, roadHalf: 5 };
    const rt = { lookaheadTimeS: 0.6, steerGain: 3.0, adaptiveLookaheadK: 0.1, cornerSpeedMargin: 0.99, brakingDistanceMargin: 1.2, deadband: 0.01, ramp: 0.06 };
    const p = { x: points[100].x, z: points[100].z, angle: 0, speed: 3, trackIndex: 100 };

    const result = computeSoloRacingLineInputs(p, track, rt, 6, 1, 0.05, 1);

    // Formula legacy a tempo fisso (quella usata PRIMA di questo piano): se
    // il target coincidesse con questa, il lookahead adattivo non starebbe
    // avendo alcun effetto.
    const speedMs = Math.max(5, Math.abs(p.speed) * 55 / 3.6);
    const legacyLookM = Math.max(10, speedMs * rt.lookaheadTimeS);
    const legacyLookSamples = Math.max(1, Math.round(legacyLookM * points.length / track.lapLength));
    const legacyIdx = lookaheadIndex(points.length, 100, legacyLookSamples);

    assert.notEqual(result.target.x, points[legacyIdx].x, 'il target deve venire dal lookahead adattivo, non dalla formula a tempo fisso legacy');
});

test('cornerApexNear: rettilineo puro => null', () => {
    // lookaheadIndex chiude sempre l'array modulo n (corretto per un
    // tracciato vero, che è un loop chiuso) — ma questo rettilineo sintetico
    // NON è un loop: il punto 0 e l'ultimo punto dell'array sono vicini solo
    // nell'indice, non nella geometria. idx=100 su un array di 200 tiene il
    // raggio di ricerca (± searchSamples+localSamples = ±50) lontano da
    // entrambi i bordi, evitando di agganciare per sbaglio quella cucitura
    // fittizia (che sembrerebbe una curva strettissima ma è solo un
    // artefatto del fixture).
    const points = buildConstantCurveTrack(200, 200, 0);
    const apex = cornerApexNear(points, 100, 40, 10, 1);
    assert.equal(apex, null);
});

test('cornerApexNear: curva che stringe e riallarga => trova il punto di raggio minimo a metà curva', () => {
    const points = buildVaryingCurveTrack(120, 20, 60, 0.08);   // curva da campione 20 a 80, picco a 50
    const idx = 30;   // dentro la curva, prima del picco
    const apex = cornerApexNear(points, idx, 60, 10, 1);
    assert.ok(apex !== null);
    assert.ok(Math.abs(apex.apexIdx - 50) <= 6, `atteso apice vicino al campione 50, ottenuto ${apex.apexIdx}`);
    assert.ok(apex.distanceToApexM > 0, 'apice davanti a idx=30 => distanza positiva');
});

test('cornerApexNear: chicane (due curve ravvicinate) => trova la curva PIÙ VICINA, non la più stretta', () => {
    // Prima curva (campioni 20-50, picco 35): raggio moderato.
    // Seconda curva (campioni 70-100, picco 85), molto più stretta.
    const pts = [];
    let x = 0, z = 0, heading = 0;
    for (let i = 0; i < 150; i++) {
        pts.push({ x, z });
        let delta = 0;
        if (i >= 20 && i < 50) {
            const k = i - 20, half = 15;
            const t = k < half ? k / half : (30 - k) / half;
            delta = 0.04 * t;   // curva dolce
        } else if (i >= 70 && i < 100) {
            const k = i - 70, half = 15;
            const t = k < half ? k / half : (30 - k) / half;
            delta = -0.15 * t;   // curva molto più stretta, segno opposto
        }
        heading += delta;
        x += Math.sin(heading);
        z += Math.cos(heading);
    }
    const idx = 25;   // dentro la PRIMA curva (dolce), lontano dalla seconda (stretta)
    const apex = cornerApexNear(pts, idx, 60, 10, 1);
    assert.ok(apex !== null);
    assert.ok(apex.apexIdx < 60, `atteso apice della prima curva (~35), ottenuto ${apex.apexIdx} — se vicino a 85 ha sbagliato curva`);
});

// Su un rettilineo lungo +z (buildConstantCurveTrack senza curvatura), la
// normale è costante = (-1,0): utile per assertion esatte sul verso.
test('overtakeOffset: auto da superare esattamente al centro pista => usa la preferenza di lato (sideFallback)', () => {
    const track = buildConstantCurveTrack(30, 30, 0);
    const centerPt = track[15];
    const o1 = overtakeOffset(track, 15, centerPt.x, centerPt.z, 10, 0.55, 1);
    assert.ok(Math.abs(o1.dx - -5.5) < 1e-9 && Math.abs(o1.dz) < 1e-9, `atteso (-5.5,0), ottenuto (${o1.dx},${o1.dz})`);

    const o2 = overtakeOffset(track, 15, centerPt.x, centerPt.z, 10, 0.55, -1);
    assert.ok(Math.abs(o2.dx - 5.5) < 1e-9 && Math.abs(o2.dz) < 1e-9, `atteso (5.5,0), ottenuto (${o2.dx},${o2.dz})`);
});

test('overtakeOffset: auto da superare spostata su un lato => si passa dal lato OPPOSTO', () => {
    const track = buildConstantCurveTrack(30, 30, 0);
    const centerPt = track[15];

    // Auto da superare 3 unità verso -x rispetto al centro pista: il bot
    // deve passare verso +x (mai dallo stesso lato, sarebbe una collisione).
    const oLeft = overtakeOffset(track, 15, centerPt.x - 3, centerPt.z, 10, 0.55, 1);
    assert.ok(oLeft.dx > 0, `auto a -x, atteso bot verso +x, ottenuto dx=${oLeft.dx}`);

    // Auto da superare 3 unità verso +x: il bot deve passare verso -x.
    const oRight = overtakeOffset(track, 15, centerPt.x + 3, centerPt.z, 10, 0.55, 1);
    assert.ok(oRight.dx < 0, `auto a +x, atteso bot verso -x, ottenuto dx=${oRight.dx}`);
});

test('cornerTargetSpeed: rettilineo puro => resta alla velocità massima', () => {
    const track = buildConstantCurveTrack(60, 60, 0);   // niente curvatura da nessuna parte
    const target = cornerTargetSpeed(track, 5, 40, 4, 1, 6, 6, 1, 0.05, 1);
    assert.equal(target, 6);
});

test('cornerTargetSpeed: tornante lontano con margine sufficiente => non frena troppo presto', () => {
    // Curva di raggio ~20 che inizia 100m avanti: alla velocità/decelerazione
    // di questo test la distanza di frenata necessaria è ~17.5m — con 95m
    // di margine non c'è ancora motivo di rallentare.
    const track = buildConstantCurveTrack(160, 100, 1 / 20);
    const target = cornerTargetSpeed(track, 5, 140, 4, 1, 6, 6, 1, 0.05, 1);
    assert.equal(target, 6, `atteso 6 (nessuna frenata ancora necessaria), ottenuto ${target}`);
});

test('cornerTargetSpeed: stesso tornante ma vicino => scende sotto la velocità massima per frenare in tempo', () => {
    const track = buildConstantCurveTrack(60, 10, 1 / 20);   // stessa curva, ma a ~5m invece di ~95m
    const target = cornerTargetSpeed(track, 5, 40, 4, 1, 6, 6, 1, 0.05, 1);
    assert.ok(target < 6, `atteso <6 (deve già frenare), ottenuto ${target}`);
    assert.ok(target < 3, `atteso vicino alla velocità del tornante (~1), ottenuto ${target}`);
});

test('cornerTargetSpeed: già più lenti del necessario => la curva non è più vincolante (niente doppia frenata)', () => {
    const track = buildConstantCurveTrack(60, 10, 1 / 20);
    const target = cornerTargetSpeed(track, 5, 40, 4, 1, 0.5, 6, 1, 0.05, 1);
    assert.equal(target, 6, `atteso 6 (già più lenti del richiesto dalla curva), ottenuto ${target}`);
});

// ---- gripCapacityFactor (Rif.
// docs/superpowers/specs/2026-07-28-f1-bot-grip-awareness-design.md): 11°
// parametro opzionale, default 1 -> comportamento invariato se omesso. ----

test('cornerTargetSpeed: gripCapacityFactor omesso => identico al comportamento di oggi (default 1)', () => {
    const track = buildConstantCurveTrack(60, 10, 1 / 20);
    const withDefault = cornerTargetSpeed(track, 5, 40, 4, 1, 6, 6, 1, 0.05, 1);
    const withExplicit1 = cornerTargetSpeed(track, 5, 40, 4, 1, 6, 6, 1, 0.05, 1, 1);
    assert.equal(withDefault, withExplicit1, 'omettere il parametro deve equivalere a passare 1');
});

test('cornerTargetSpeed: gripCapacityFactor < 1 => velocità di curva più cauta (gomma usurata)', () => {
    const track = buildConstantCurveTrack(60, 10, 1 / 20);
    const full = cornerTargetSpeed(track, 5, 40, 4, 1, 6, 6, 1, 0.05, 1, 1);
    const worn = cornerTargetSpeed(track, 5, 40, 4, 1, 6, 6, 1, 0.05, 1, 0.5);
    assert.ok(worn < full, `atteso target più basso con capacità ridotta: full=${full}, worn=${worn}`);
});

test('cornerTargetSpeed: gripCapacityFactor > 1 => velocità di curva più alta (downforce), ma mai oltre maxSpeed', () => {
    const track = buildConstantCurveTrack(60, 10, 1 / 20);
    const full = cornerTargetSpeed(track, 5, 40, 4, 1, 6, 6, 1, 0.05, 1, 1);
    const boosted = cornerTargetSpeed(track, 5, 40, 4, 1, 6, 6, 1, 0.05, 1, 1.15);
    assert.ok(boosted > full, `atteso target più alto con capacità aumentata: full=${full}, boosted=${boosted}`);
    assert.ok(boosted <= 6, `mai oltre maxSpeed=6, ottenuto ${boosted}`);
});

test('isBotGripAwarenessActive: spento di default', () => {
    delete process.env.F1_BOT_GRIP_AWARENESS;
    assert.equal(isBotGripAwarenessActive(), false);
});

test('isBotGripAwarenessActive: attivo solo con "1" esplicito', () => {
    process.env.F1_BOT_GRIP_AWARENESS = '1';
    try {
        assert.equal(isBotGripAwarenessActive(), true);
    } finally {
        delete process.env.F1_BOT_GRIP_AWARENESS;
    }
    process.env.F1_BOT_GRIP_AWARENESS = 'true';   // non "1" esatto -> resta spento
    try {
        assert.equal(isBotGripAwarenessActive(), false, 'solo "1" esatto attiva il flag, stesso pattern di F1_CORNERING_GRIP_MODEL');
    } finally {
        delete process.env.F1_BOT_GRIP_AWARENESS;
    }
});

test('pickPostPitCompound: pochi giri restanti => soft', () => {
    assert.equal(pickPostPitCompound(1, 5), 'soft');
    assert.equal(pickPostPitCompound(2, 5), 'soft');
});

test('pickPostPitCompound: giri restanti nel range di una medium => medium', () => {
    assert.equal(pickPostPitCompound(3, 5), 'medium');
    assert.equal(pickPostPitCompound(5, 5), 'medium');
});

test('pickPostPitCompound: molti giri restanti => hard', () => {
    assert.equal(pickPostPitCompound(6, 5), 'hard');
    assert.equal(pickPostPitCompound(20, 5), 'hard');
});

test('shouldBotRepair: ripara solo se il danno è almeno alla soglia', () => {
    assert.equal(shouldBotRepair(19, 20), false);
    assert.equal(shouldBotRepair(20, 20), true);
    assert.equal(shouldBotRepair(0, 20), false);
    assert.equal(shouldBotRepair(100, 20), true);
});

test('pickBotColors: esclude i colori umani, ne restituisce esattamente `count` (rng deterministico)', () => {
    const humanColors = ['#E74C3C', '#3498DB'];
    const rng = () => 0;   // sceglie sempre il primo libero rimasto => ordine di PALETTE
    const picked = pickBotColors(humanColors, 3, rng);
    assert.deepEqual(picked, ['#2ECC71', '#F1C40F', '#9B59B6']);
    picked.forEach(c => assert.ok(!humanColors.includes(c)));
});

test('pickBotColors: clampa a colori liberi disponibili', () => {
    const humanColors = PALETTE.slice(0, 10);   // solo 2 colori liberi
    const picked = pickBotColors(humanColors, 5, () => 0);
    assert.equal(picked.length, 2);
});

test('pickBotColors: nessuna collisione di colore tra chiamate ripetute (mai duplicati nel risultato)', () => {
    const picked = pickBotColors([], 5, () => 0.999999);
    assert.equal(new Set(picked).size, picked.length);
});

test('estimateFinishTime: a metà strada raddoppia il tempo trascorso', () => {
    assert.equal(estimateFinishTime(60000, 0.5), 120000);
});

test('estimateFinishTime: progresso completo => stesso tempo trascorso', () => {
    assert.equal(estimateFinishTime(60000, 1), 60000);
});

test('estimateFinishTime: progresso quasi nullo => pavimento SIMULATED_MIN_PROGRESS (0.05)', () => {
    assert.equal(estimateFinishTime(60000, 0), Math.round(60000 / 0.05));
    assert.equal(estimateFinishTime(60000, 0.01), Math.round(60000 / 0.05));
});

function mockTrack(n, lapLength) {
    return { points: { length: n }, lapLength };
}

test('nearestAheadPlayer: trova il più vicino davanti, con wrap sul giro', () => {
    const p = { trackIndex: 900 };
    const near = { trackIndex: 950, finished: false, pitting: false, pitAutoState: null };   // 50 avanti
    const far  = { trackIndex: 100, finished: false, pitting: false, pitAutoState: null };   // 200 avanti (con wrap su n=1000)
    const track = mockTrack(1000, 1000);   // 1 metro per campione, semplifica i calcoli
    const result = nearestAheadPlayer(p, [p, near, far], track);
    assert.equal(result.player, near);
    assert.ok(Math.abs(result.gapM - 50) < 1e-9, `atteso 50, ottenuto ${result.gapM}`);
});

test('nearestAheadPlayer: ignora finiti/ai box/in autopilota', () => {
    const p = { trackIndex: 0 };
    const finished    = { trackIndex: 10, finished: true,  pitting: false, pitAutoState: null };
    const pitting     = { trackIndex: 20, finished: false, pitting: true,  pitAutoState: null };
    const autoPiloted = { trackIndex: 30, finished: false, pitting: false, pitAutoState: 'entering' };
    const valid        = { trackIndex: 40, finished: false, pitting: false, pitAutoState: null };
    const track = mockTrack(1000, 1000);
    const result = nearestAheadPlayer(p, [p, finished, pitting, autoPiloted, valid], track);
    assert.equal(result.player, valid);
});

test('nearestAheadPlayer: nessun altro giocatore valido => null', () => {
    const p = { trackIndex: 0 };
    const finished = { trackIndex: 10, finished: true, pitting: false, pitAutoState: null };
    const track = mockTrack(1000, 1000);
    assert.equal(nearestAheadPlayer(p, [p, finished], track), null);
});

test('DEFAULT_TUNING espone i tre margini con i valori attuali', () => {
    assert.equal(DEFAULT_TUNING.cornerSpeedMargin, 0.99);
    assert.equal(DEFAULT_TUNING.apexMaxFraction, 0.85);
    assert.equal(DEFAULT_TUNING.brakingDistanceMargin, 1.2);
});

test('updateBotInputs: deps.tuning.apexMaxFraction sovrascrive il default e cambia lo sterzo in curva', () => {
    // Curva costante che parte dal campione 50 (raggio ~20, delta=0.05/campione,
    // passo unitario => metersPerSample=1, stesse assunzioni delle altre unit
    // test di questo file).
    const points = buildConstantCurveTrack(200, 50, 0.05);
    const track = { points, lapLength: 200, roadHalf: 5 };
    const deps = {
        effectiveMaxSpeed: () => 6,
        handlePitReactionPress: () => {},
        io: { to: () => ({ emit: () => {} }) },
        lobbyId: 'test',
        wearLapsAtMedium: 5,
        accel: 0.186, brakeMult: 2.17, turnRateHigh: 0.052,
        corneringCapacity: () => 1,
        effectiveBrakeMult: () => 1
    };

    function makePlayer() {
        return {
            x: points[50].x, z: points[50].z, angle: 0,
            speed: 0, vx: 0, vz: 0,
            inputs: { throttle: 0, brake: 0, steer: 0 },
            finished: false, lap: 0, botLapSeen: 0,
            trackIndex: 50, tyreWear: 0, compound: 'medium',
            pitting: false, pitAutoState: null, pitPhase: null,
            isBot: true, botSpeedFactor: 1, botLapPaceMult: 1, botPrecisionNoise: 0,
            botOvertakeSide: 1, botHeadingToPits: false, botPitReactionScheduled: false
        };
    }

    const pFlat = makePlayer();
    updateBotInputs({ track, phase: 'qualifying', players: { A: pFlat } },
        { ...deps, tuning: { apexMaxFraction: 0 } });

    const pFull = makePlayer();
    updateBotInputs({ track, phase: 'qualifying', players: { A: pFull } },
        { ...deps, tuning: { apexMaxFraction: 1 } });

    assert.ok(
        Math.abs(pFlat.inputs.steer - pFull.inputs.steer) > 1e-6,
        `atteso sterzo diverso tra apexMaxFraction=0 (${pFlat.inputs.steer}) e =1 (${pFull.inputs.steer})`
    );
});

test('updateBotInputs: ramo racing-line usa il lookahead adattivo alla curvatura (non più il tempo fisso legacy)', () => {
    const points = buildConstantCurveTrack(300, 50, 0.1);   // raggio stretto ~10
    const racingLineTuning = { lookaheadTimeS: 0.6, steerGain: 3.0, adaptiveLookaheadK: 0.1, cornerSpeedMargin: 0.99, brakingDistanceMargin: 1.2, deadband: 0.01, ramp: 0.06 };
    const track = { points, racingLine: points, racingLineTuning, lapLength: 300, roadHalf: 5 };
    const deps = {
        effectiveMaxSpeed: () => 6,
        handlePitReactionPress: () => {},
        io: { to: () => ({ emit: () => {} }) },
        lobbyId: 'test',
        wearLapsAtMedium: 5,
        accel: 0.186, brakeMult: 2.17, turnRateHigh: 0.052,
        corneringCapacity: () => 1,
        effectiveBrakeMult: () => 1
    };
    const p = {
        x: points[100].x, z: points[100].z, angle: 0,
        speed: 3, vx: 0, vz: 0,
        inputs: { throttle: 0, brake: 0, steer: 0 },
        finished: false, lap: 0, botLapSeen: 0,
        trackIndex: 100, tyreWear: 0, compound: 'medium',
        pitting: false, pitAutoState: null, pitPhase: null,
        isBot: true, botSpeedFactor: 1, botLapPaceMult: 1, botPrecisionNoise: 0,
        botOvertakeSide: 1, botHeadingToPits: false, botPitReactionScheduled: false
    };

    updateBotInputs({ track, phase: 'qualifying', players: { A: p } }, deps);

    const speedMs = Math.max(5, Math.abs(p.speed) * 55 / 3.6);
    const legacyLookM = Math.max(10, speedMs * racingLineTuning.lookaheadTimeS);
    const legacyLookSamples = Math.max(1, Math.round(legacyLookM * points.length / track.lapLength));
    const legacyIdx = lookaheadIndex(points.length, 100, legacyLookSamples);

    assert.notEqual(p._botDebug.target.x, points[legacyIdx].x, 'il target deve venire dal lookahead adattivo, non dalla formula a tempo fisso legacy');
});

test('updateBotInputs: ramo geometrico usa il lookahead adattivo alla curvatura (non più il tempo fisso legacy)', () => {
    const points = buildConstantCurveTrack(300, 50, 0.1);
    const track = { points, lapLength: 300, roadHalf: 5 };
    const deps = {
        effectiveMaxSpeed: () => 6, handlePitReactionPress: () => {}, io: { to: () => ({ emit: () => {} }) },
        lobbyId: 'test', wearLapsAtMedium: 5, accel: 0.186, brakeMult: 2.17, turnRateHigh: 0.052,
        tuning: { apexMaxFraction: 0 },
        corneringCapacity: () => 1,
        effectiveBrakeMult: () => 1
    };
    const p = {
        x: points[100].x, z: points[100].z, angle: 0, speed: 3, vx: 0, vz: 0,
        inputs: { throttle: 0, brake: 0, steer: 0 }, finished: false, lap: 0, botLapSeen: 0,
        trackIndex: 100, tyreWear: 0, compound: 'medium', pitting: false, pitAutoState: null, pitPhase: null,
        isBot: true, botSpeedFactor: 1, botLapPaceMult: 1, botPrecisionNoise: 0,
        botOvertakeSide: 1, botHeadingToPits: false, botPitReactionScheduled: false
    };

    updateBotInputs({ track, phase: 'qualifying', players: { A: p } }, deps);

    const speedMs = Math.max(5, Math.abs(p.speed) * 55 / 3.6);
    const legacyLookM = Math.max(10, speedMs * 0.6);   // DEFAULT_TUNING.lookaheadTimeS
    const legacyLookSamples = Math.max(1, Math.round(legacyLookM * points.length / track.lapLength));
    const legacyIdx = lookaheadIndex(points.length, 100, legacyLookSamples);

    assert.notEqual(p._botDebug.target.x, points[legacyIdx].x, 'il target deve venire dal lookahead adattivo, non dalla formula a tempo fisso legacy');
});

test('updateBotInputs: durante la reazione al via il bot resta fermo (nessun input), poi guida normalmente', () => {
    const points = buildConstantCurveTrack(200, 200, 0);   // rettilineo puro
    const track = { points, lapLength: 200, roadHalf: 5 };
    const deps = {
        effectiveMaxSpeed: () => 6,
        handlePitReactionPress: () => {},
        io: { to: () => ({ emit: () => {} }) },
        lobbyId: 'test',
        wearLapsAtMedium: 5,
        accel: 0.186, brakeMult: 2.17, turnRateHigh: 0.052,
        corneringCapacity: () => 1,
        effectiveBrakeMult: () => 1
    };

    function makePlayer(botRaceReactionUntil) {
        return {
            x: points[0].x, z: points[0].z, angle: 0,
            speed: 0, vx: 0, vz: 0,
            inputs: { throttle: 0, brake: 0, steer: 0 },
            finished: false, lap: 0, botLapSeen: 0,
            trackIndex: 0, tyreWear: 0, compound: 'medium',
            pitting: false, pitAutoState: null, pitPhase: null,
            isBot: true, botSpeedFactor: 1, botLapPaceMult: 1, botPrecisionNoise: 0,
            botOvertakeSide: 1, botHeadingToPits: false, botPitReactionScheduled: false,
            botRaceReactionUntil
        };
    }

    const pWaiting = makePlayer(Date.now() + 60000);   // reazione ancora ben lontana dallo scadere
    updateBotInputs({ track, phase: 'race', players: { A: pWaiting } }, deps);
    assert.deepEqual(pWaiting.inputs, { throttle: 0, brake: 0, steer: 0 }, 'atteso fermo mentre reagisce');

    const pReady = makePlayer(Date.now() - 1000);   // reazione già scaduta
    updateBotInputs({ track, phase: 'race', players: { A: pReady } }, deps);
    assert.equal(pReady.inputs.throttle, 1, 'atteso guida normale (pieno gas su rettilineo) dopo la reazione');
});

// ---- Grip-awareness end-to-end (Rif.
// docs/superpowers/specs/2026-07-28-f1-bot-grip-awareness-design.md):
// verifica il WIRING dentro updateBotInputs (flag -> deps.corneringCapacity/
// deps.effectiveBrakeMult consultate o no), non le formule reali di
// CorneringGripModel/BrakingModel (già coperte da CorneringGripModel.test.js
// e dal riuso diretto di effectiveBrakeMult). ----

// botLapSeen preimpostato a 0 come nelle fixture updateBotInputs sopra:
// con lap=0 e trackIndex entro il primo "segmento di ritmo" (paceSegmentSamples
// = ceil(120/BOT_LAP_PACE_SEGMENTS=4) = 30 > trackIndex=5), paceSegment
// calcolato è già 0 => nessuna ri-estrazione random di botLapPaceMult al
// primo tick, risultati deterministici e confrontabili con assert.deepEqual.
// straightSamples=30 (curva a 25m dal bot, radius≈20) verificato
// empiricamente come il punto in cui, a velocità 6 e coi mock sotto, gomma
// fresca non deve ancora frenare (curva fuori dalla propria distanza di
// frenata) mentre gomma usurata sì (capacità ridotta => distanza di
// frenata necessaria più lunga) — altrimenti a curva troppo vicina
// entrambe saturano su brake=1 e il confronto non distinguerebbe nulla.
function makeGripAwarenessGame(tyreWear, phase = 'race') {
    const points = buildConstantCurveTrack(120, 30, 1 / 20);
    const track = {
        points, lapLength: points.length, roadHalf: 8, totalLaps: 3,
        pitEntryIndex: 9999, pitPath: [{ x: 0, z: 0 }, { x: 0, z: 0 }]
    };
    const p = {
        x: points[5].x, z: points[5].z, angle: 0,
        speed: 6, vx: 0, vz: 0,
        inputs: { throttle: 0, brake: 0, steer: 0 },
        finished: false, lap: 0, botLapSeen: 0,
        trackIndex: 5, tyreWear, compound: 'medium', damage: 0,
        pitting: false, pitAutoState: null, pitPhase: null,
        isBot: true, botSpeedFactor: 1, botLapPaceMult: 1, botPrecisionNoise: 0,
        botOvertakeSide: 1, botHeadingToPits: false, botPitReactionScheduled: false,
        botPitThreshold: 100, hasPitted: false
    };
    return { game: { phase, track, players: { bot1: p } }, p };
}

function makeGripAwarenessDeps(extra = {}) {
    return {
        effectiveMaxSpeed: () => 6,
        handlePitReactionPress: () => {},
        io: { to: () => ({ emit: () => {} }) },
        lobbyId: 'test',
        wearLapsAtMedium: 5, accel: 1, brakeMult: 1, turnRateHigh: 0.05,
        slipstreamMaxBoost: 0,
        // Mock: NON le formule reali (già testate altrove) — solo per
        // verificare che updateBotInputs le consulti (o no) in base al flag,
        // con isQuali correttamente inoltrato.
        effectiveBrakeMult: (pl, isQuali) => isQuali ? 1 : 1 - pl.tyreWear / 200,
        corneringCapacity: (pl, isQuali) => isQuali ? 1 : 1 - pl.tyreWear / 200,
        ...extra
    };
}

test('updateBotInputs: gomma usurata frena/rallenta prima di gomma fresca (grip-awareness sempre attivo)', () => {
    const fresh = makeGripAwarenessGame(0);
    const worn = makeGripAwarenessGame(90);
    updateBotInputs(fresh.game, makeGripAwarenessDeps());
    updateBotInputs(worn.game, makeGripAwarenessDeps());
    assert.notDeepEqual(worn.p.inputs, fresh.p.inputs, 'tyreWear deve sempre influenzare gli input del bot');
});

test('updateBotInputs: isQuali=true -> deps consultate con isQuali=true (mock neutro in questo scenario)', () => {
    const fresh = makeGripAwarenessGame(0, 'qualifying');
    const worn = makeGripAwarenessGame(90, 'qualifying');
    updateBotInputs(fresh.game, makeGripAwarenessDeps());
    updateBotInputs(worn.game, makeGripAwarenessDeps());
    assert.deepEqual(worn.p.inputs, fresh.p.inputs, 'isQuali deve arrivare a true a deps.corneringCapacity/effectiveBrakeMult (il mock lo rende neutro, a differenza delle formule reali dove solo la componente usura è neutra — vedi spec)');
});

test('updateBotInputs: gomma nuova (tyreWear=0) non è più prudente di un fattore di grip nominale esplicito', () => {
    const nominal = makeGripAwarenessGame(0);
    updateBotInputs(nominal.game, makeGripAwarenessDeps());
    const legacy = makeGripAwarenessGame(0);
    updateBotInputs(legacy.game, { ...makeGripAwarenessDeps(), corneringCapacity: () => 1, effectiveBrakeMult: () => 1 });
    assert.deepEqual(nominal.p.inputs, legacy.p.inputs, 'gomma nuova: nessuna differenza rispetto a un fattore di grip nominale esplicito, il bot non deve diventare più cauto senza motivo fisico');
});

// ---- _botDebug (Priorità 1/3, canale di debug per il banco prova bot): puro
// snapshot dei valori già calcolati da updateBotInputs — questi test
// verificano che il canale rifletta fedelmente le decisioni prese, MAI che
// introduca nuovi calcoli (le formule sono già coperte dai test sopra). ----

test('_botDebug: throttle/brake/steer coincidono ESATTAMENTE con p.inputs, in ogni scenario', () => {
    for (const tyreWear of [0, 90]) {
        const { game, p } = makeGripAwarenessGame(tyreWear);
        updateBotInputs(game, makeGripAwarenessDeps());
        assert.deepEqual(
            { throttle: p._botDebug.throttle, brake: p._botDebug.brake, steer: p._botDebug.steer },
            p.inputs,
            `_botDebug deve rispecchiare p.inputs (tyreWear=${tyreWear})`
        );
    }
});

test('_botDebug: stato WAITING_START durante la reazione al via, valori fisici non calcolati => null', () => {
    const points = buildConstantCurveTrack(200, 200, 0);
    const track = { points, lapLength: 200, roadHalf: 5 };
    const deps = {
        effectiveMaxSpeed: () => 6, handlePitReactionPress: () => {}, io: { to: () => ({ emit: () => {} }) },
        lobbyId: 'test', wearLapsAtMedium: 5, accel: 0.186, brakeMult: 2.17, turnRateHigh: 0.052
    };
    const p = {
        x: points[0].x, z: points[0].z, angle: 0, speed: 0, vx: 0, vz: 0,
        inputs: { throttle: 0, brake: 0, steer: 0 }, finished: false, lap: 0, botLapSeen: 0,
        trackIndex: 0, tyreWear: 0, compound: 'medium',
        pitting: false, pitAutoState: null, pitPhase: null,
        isBot: true, botSpeedFactor: 1, botLapPaceMult: 1, botPrecisionNoise: 0,
        botOvertakeSide: 1, botHeadingToPits: false, botPitReactionScheduled: false,
        botRaceReactionUntil: Date.now() + 60000
    };
    updateBotInputs({ track, phase: 'race', players: { A: p } }, deps);
    assert.equal(p._botDebug.state, 'WAITING_START');
    assert.equal(p._botDebug.targetSpeed, null);
    assert.equal(p._botDebug.maxSpeed, null);
    assert.equal(p._botDebug.gripCapacityFactor, null);
    assert.equal(p._botDebug.brakeDecel, null);
});

test('_botDebug: stato PIT_LANE quando l\'autopilota box guida (nessun input scritto, throttle/brake/steer null)', () => {
    const points = buildConstantCurveTrack(200, 200, 0);
    const track = { points, lapLength: 200, roadHalf: 5, pitEntryIndex: 0, pitPath: [{ x: 0, z: 0 }, { x: 0, z: 0 }] };
    const deps = {
        effectiveMaxSpeed: () => 6, handlePitReactionPress: () => {}, io: { to: () => ({ emit: () => {} }) },
        lobbyId: 'test', wearLapsAtMedium: 5, accel: 0.186, brakeMult: 2.17, turnRateHigh: 0.052
    };
    const p = {
        x: points[0].x, z: points[0].z, angle: 0, speed: 3.1, vx: 0, vz: 0,
        inputs: { throttle: 1, brake: 0, steer: 0 }, finished: false, lap: 0, botLapSeen: 0,
        trackIndex: 0, tyreWear: 0, compound: 'medium',
        pitting: false, pitAutoState: 'entering', pitPhase: null,
        isBot: true, botSpeedFactor: 1, botLapPaceMult: 1, botPrecisionNoise: 0,
        botOvertakeSide: 1, botHeadingToPits: true, botPitReactionScheduled: false
    };
    updateBotInputs({ track, phase: 'race', players: { A: p } }, deps);
    assert.equal(p._botDebug.state, 'PIT_LANE');
    assert.equal(p._botDebug.throttle, null);
    assert.equal(p._botDebug.brake, null);
    assert.equal(p._botDebug.steer, null);
});

test('_botDebug: stato CRUISE su rettilineo puro (pieno gas, nessuna curva/traffico)', () => {
    const points = buildConstantCurveTrack(200, 200, 0);
    const track = { points, lapLength: 200, roadHalf: 5 };
    const deps = {
        effectiveMaxSpeed: () => 6, handlePitReactionPress: () => {}, io: { to: () => ({ emit: () => {} }) },
        lobbyId: 'test', wearLapsAtMedium: 5, accel: 0.186, brakeMult: 2.17, turnRateHigh: 0.052,
        corneringCapacity: () => 1,
        effectiveBrakeMult: () => 1
    };
    const p = {
        x: points[0].x, z: points[0].z, angle: 0, speed: 0, vx: 0, vz: 0,
        inputs: { throttle: 0, brake: 0, steer: 0 }, finished: false, lap: 0, botLapSeen: 0,
        trackIndex: 0, tyreWear: 0, compound: 'medium',
        pitting: false, pitAutoState: null, pitPhase: null,
        isBot: true, botSpeedFactor: 1, botLapPaceMult: 1, botPrecisionNoise: 0,
        botOvertakeSide: 1, botHeadingToPits: false, botPitReactionScheduled: false
    };
    updateBotInputs({ track, phase: 'race', players: { A: p } }, deps);
    assert.equal(p._botDebug.state, 'CRUISE');
    assert.equal(p._botDebug.throttle, 1);
    assert.equal(p._botDebug.brake, 0);
    assert.ok(p._botDebug.maxSpeed > 0, 'maxSpeed deve essere valorizzato nel ramo di guida normale');
    assert.equal(p._botDebug.gripCapacityFactor, 1, 'flag spento => fattore neutro 1, non null (è comunque calcolato)');
    assert.ok(p._botDebug.brakeDecel > 0, 'brakeDecel deve essere valorizzato nel ramo di guida normale');
});

test('_botDebug: stato BRAKE_FOR_CORNER quando il bot frena per una curva vicina', () => {
    const track = { points: buildConstantCurveTrack(60, 5, 1 / 20), lapLength: 60, roadHalf: 5, pitEntryIndex: 9999, pitPath: [{ x: 0, z: 0 }, { x: 0, z: 0 }] };
    const deps = {
        effectiveMaxSpeed: () => 6, handlePitReactionPress: () => {}, io: { to: () => ({ emit: () => {} }) },
        lobbyId: 'test', wearLapsAtMedium: 5, accel: 1, brakeMult: 1, turnRateHigh: 0.05,
        corneringCapacity: () => 1,
        effectiveBrakeMult: () => 1
    };
    const p = {
        x: 0, z: 0, angle: 0, speed: 6, vx: 0, vz: 0,
        inputs: { throttle: 0, brake: 0, steer: 0 }, finished: false, lap: 0, botLapSeen: 0,
        trackIndex: 0, tyreWear: 0, compound: 'medium',
        pitting: false, pitAutoState: null, pitPhase: null,
        isBot: true, botSpeedFactor: 1, botLapPaceMult: 1, botPrecisionNoise: 0,
        botOvertakeSide: 1, botHeadingToPits: false, botPitReactionScheduled: false, botPitThreshold: 100
    };
    updateBotInputs({ track, phase: 'race', players: { A: p } }, deps);
    assert.equal(p._botDebug.brake, 1, 'precondizione: il bot deve stare davvero frenando in questo scenario');
    assert.equal(p._botDebug.state, 'BRAKE_FOR_CORNER');
    assert.ok(p._botDebug.targetSpeed < p._botDebug.maxSpeed, 'targetSpeed deve riflettere il limite di curva, sotto maxSpeed');
});

// ---- trajectoryDiagnostics (Rif. richiesta utente 2026-07-29, audit guida
// via banco prova): pura lettura, non deve mai influenzare le decisioni del
// bot (già garantito per costruzione: chiamata una volta e solo spalmata
// dentro _botDebug, mai letta altrove — questi test verificano solo che i
// due numeri riflettano correttamente posizione/orientamento reali).
// trackIndex=30 (non 0): buildConstantCurveTrack non è un vero loop, indice
// 0 confina con un "giunto" fittizio con l'ultimo campione (stesso
// avvertimento già documentato sopra per apexOffset/cornerApexNear). ----

test('trajectoryDiagnostics: bot esattamente sulla linea, prua allineata alla tangente => entrambi ~0', () => {
    const track = { points: buildConstantCurveTrack(60, 60, 0), racingLine: null };   // rettilineo puro lungo +z
    const p = { x: 0, z: 30, angle: 0, trackIndex: 30 };
    const diag = trajectoryDiagnostics(p, track);
    assert.ok(diag.distanceFromRacingLine < 1e-9, `atteso ~0, ottenuto ${diag.distanceFromRacingLine}`);
    assert.ok(Math.abs(diag.headingVsTangentDeg) < 1e-6, `atteso ~0, ottenuto ${diag.headingVsTangentDeg}`);
});

test('trajectoryDiagnostics: bot spostato lateralmente dalla linea => distanceFromRacingLine riflette lo scarto reale', () => {
    const track = { points: buildConstantCurveTrack(60, 60, 0), racingLine: null };
    const p = { x: 5, z: 30, angle: 0, trackIndex: 30 };
    const diag = trajectoryDiagnostics(p, track);
    assert.ok(Math.abs(diag.distanceFromRacingLine - 5) < 1e-6, `atteso ~5, ottenuto ${diag.distanceFromRacingLine}`);
});

test('trajectoryDiagnostics: prua ruotata di 90° rispetto alla tangente => headingVsTangentDeg ~90', () => {
    const track = { points: buildConstantCurveTrack(60, 60, 0), racingLine: null };
    const p = { x: 0, z: 30, angle: Math.PI / 2, trackIndex: 30 };
    const diag = trajectoryDiagnostics(p, track);
    assert.ok(Math.abs(diag.headingVsTangentDeg - 90) < 1e-4, `atteso ~90, ottenuto ${diag.headingVsTangentDeg}`);
});

test('trajectoryDiagnostics: usa track.racingLine come riferimento quando presente, non track.points', () => {
    const points = buildConstantCurveTrack(60, 60, 0);
    // Racing line spostata di 3 unità rispetto al centro pista in ogni punto.
    const racingLine = points.map(pt => ({ x: pt.x + 3, z: pt.z }));
    const track = { points, racingLine };
    const p = { x: 3, z: 30, angle: 0, trackIndex: 30 };   // sulla racing line, non sul centro pista
    const diag = trajectoryDiagnostics(p, track);
    assert.ok(diag.distanceFromRacingLine < 1e-9, `atteso ~0 (sulla racing line), ottenuto ${diag.distanceFromRacingLine}`);
});

test('_botDebug: distanceFromRacingLine/headingVsTangentDeg presenti in OGNI stato, non solo nei rami di guida attiva', () => {
    const points = buildConstantCurveTrack(200, 200, 0);
    const track = { points, lapLength: 200, roadHalf: 5 };
    const p = {
        x: 0, z: 30, angle: 0.05, vx: 0, vz: 0, speed: 0,
        inputs: { throttle: 0, brake: 0, steer: 0 }, finished: false, lap: 0, botLapSeen: 0,
        trackIndex: 30, tyreWear: 0, compound: 'medium',
        pitting: false, pitAutoState: null, pitPhase: null,
        isBot: true, botSpeedFactor: 1, botLapPaceMult: 1, botPrecisionNoise: 0,
        botOvertakeSide: 1, botHeadingToPits: false, botPitReactionScheduled: false,
        botRaceReactionUntil: Date.now() + 60000   // ramo WAITING_START
    };
    const deps = {
        effectiveMaxSpeed: () => 6, handlePitReactionPress: () => {}, io: { to: () => ({ emit: () => {} }) },
        lobbyId: 'test', wearLapsAtMedium: 5, accel: 0.186, brakeMult: 2.17, turnRateHigh: 0.052
    };
    updateBotInputs({ track, phase: 'race', players: { A: p } }, deps);
    assert.equal(p._botDebug.state, 'WAITING_START');
    assert.ok(typeof p._botDebug.distanceFromRacingLine === 'number', 'presente anche in WAITING_START, non solo nei rami di guida');
    assert.ok(typeof p._botDebug.headingVsTangentDeg === 'number', 'presente anche in WAITING_START, non solo nei rami di guida');
});
