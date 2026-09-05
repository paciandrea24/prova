// backend/sockets/games/f1Bot.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    PALETTE, normalizeAngle, steerToward, lookaheadIndex, apexOffset,
    cornerTargetSpeed, windowRadius, cornerApexNear, overtakeOffset, nearestAheadPlayer, nearestBehindPlayer,
    pickPostPitCompound, pickBotColors, estimateFinishTime,
    updateBotInputs, DEFAULT_TUNING, shouldBotRepair, trajectoryDiagnostics,
    adaptiveLookaheadMeters, BOT_ADAPTIVE_LOOKAHEAD_K, BOT_ADAPTIVE_LOOKAHEAD_MAX_M, BOT_LOOKAHEAD_MIN_M,
    computeSoloRacingLineInputs, aggiornaErrore, profiloAllargamento
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

// Il numero di colori disponibili non e' piu' quello della sola PALETTE dei
// giocatori: dal 2026-08-17 i bot attingono anche a PALETTE_BOT_EXTRA, che
// serve a coprire venti piloti in griglia. Il test misura quindi la riserva
// vera invece di ricopiarne la dimensione.
test('pickBotColors: clampa ai colori liberi disponibili', () => {
    const { PALETTE_BOT_EXTRA } = require('./f1Bot.js');
    const tutti = PALETTE.concat(PALETTE_BOT_EXTRA);
    const occupati = tutti.slice(0, tutti.length - 2);   // solo 2 colori liberi
    const picked = pickBotColors(occupati, 5, () => 0);
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

// ---- botLapPaceMult in qualifica: il giorno buono/storto (BOT_LAP_PACE_VARIANCE,
// introdotto per abilitare i sorpassi in GARA — vedi commento sopra la
// costante in f1Bot.js) non ha senso su un giro secco di qualifica, dove un
// pilota vero spinge sempre al massimo. Deve restare fisso a 1 in quali,
// sia al primo tick (valore iniziale casuale ereditato dalla griglia) sia
// attraversando un confine di segmento di ritmo (che in gara lo farebbe
// ri-estrarre). ----
function makePaceRolloverGame(phase, trackIndex, initialPaceMult) {
    const points = buildConstantCurveTrack(120, 30, 1 / 20);
    const track = {
        points, lapLength: points.length, roadHalf: 8, totalLaps: 1,
        pitEntryIndex: 9999, pitPath: [{ x: 0, z: 0 }, { x: 0, z: 0 }]
    };
    const p = {
        x: points[trackIndex].x, z: points[trackIndex].z, angle: 0,
        speed: 6, vx: 0, vz: 0,
        inputs: { throttle: 0, brake: 0, steer: 0 },
        finished: false, lap: 0, botLapSeen: 0,
        trackIndex, tyreWear: 0, compound: 'medium', damage: 0,
        pitting: false, pitAutoState: null, pitPhase: null,
        isBot: true, botSpeedFactor: 1, botLapPaceMult: initialPaceMult, botPrecisionNoise: 0,
        botOvertakeSide: 1, botHeadingToPits: false, botPitReactionScheduled: false,
        botPitThreshold: 100, hasPitted: false
    };
    return { game: { phase, track, players: { bot1: p } }, p };
}

test('updateBotInputs: in qualifica botLapPaceMult resta sempre 1, anche con un valore iniziale diverso', () => {
    // trackIndex=5 => paceSegment=0, uguale a botLapSeen=0: nessun confine
    // attraversato, eppure il valore ereditato (1.5, fuori da qualunque
    // range random ±4%) deve comunque essere azzerato in qualifica.
    const { game, p } = makePaceRolloverGame('qualifying', 5, 1.5);
    updateBotInputs(game, makeGripAwarenessDeps());
    assert.equal(p.botLapPaceMult, 1, 'in qualifica il bot deve sempre correre al proprio ritmo migliore, senza variazione');
});

test('updateBotInputs: in qualifica botLapPaceMult resta 1 anche attraversando un confine di segmento di ritmo', () => {
    // trackIndex=31 => paceSegment=1, diverso da botLapSeen=0: in gara
    // scatterebbe la ri-estrazione random (vedi test successivo).
    const { game, p } = makePaceRolloverGame('qualifying', 31, 1.5);
    updateBotInputs(game, makeGripAwarenessDeps());
    assert.equal(p.botLapPaceMult, 1, 'la ri-estrazione per segmento non deve avvenire in qualifica');
});

test('updateBotInputs: in gara botLapPaceMult viene ri-estratto attraversando un confine di segmento di ritmo (comportamento invariato)', () => {
    const { game, p } = makePaceRolloverGame('race', 31, 1.5);
    updateBotInputs(game, makeGripAwarenessDeps());
    assert.notEqual(p.botLapPaceMult, 1.5, 'atteso una ri-estrazione, il valore iniziale non deve sopravvivere al confine di segmento');
    assert.ok(p.botLapPaceMult >= 1 - 0.04 - 1e-9 && p.botLapPaceMult <= 1 + 0.04 + 1e-9,
        `atteso dentro ±BOT_LAP_PACE_VARIANCE, ottenuto ${p.botLapPaceMult}`);
});

test('updateBotInputs: in gara botLapPaceMult NON viene ri-estratto entro lo stesso segmento di ritmo (comportamento invariato)', () => {
    const { game, p } = makePaceRolloverGame('race', 5, 1.5);
    updateBotInputs(game, makeGripAwarenessDeps());
    assert.equal(p.botLapPaceMult, 1.5, 'nessuna ri-estrazione attesa entro lo stesso segmento');
});

// ═══════════ QUANTI PILOTI IN GRIGLIA ═══════════
//
// Il numero non è più fisso a sei: si sceglie in lobby e arriva sulla
// partita come `game.gridSize`. MAX_GRID_SIZE resta come TETTO assoluto,
// non come dimensione della griglia.
const { createBots: creaBot, MAX_GRID_SIZE: TETTO } = require('./f1Bot.js');
const TYRE_COMPOUNDS_FINTE = { hard: {}, medium: {}, soft: {} };

function partitaPerBot(gridSize) {
    return {
        track: {
            qualiSpawn: { x: 0, z: 0, angle: 0 },
            points: [{ x: 0, z: 0 }, { x: 10, z: 0 }],
        },
        players: {},
        settings: {},
        tyreConfirmed: new Set(),   // i bot si auto-confermano alla creazione
        gridSize,
    };
}

test('createBots riempie fino al numero di piloti scelto in lobby', () => {
    for (const quanti of [6, 10, 14, 20]) {
        const game = partitaPerBot(quanti);
        creaBot(game, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS_FINTE, () => 0.5);
        assert.equal(Object.keys(game.players).length, quanti - 1,
            `con gridSize ${quanti} attesi ${quanti - 1} bot, trovati ${Object.keys(game.players).length}`);
    }
});

test('createBots senza gridSize resta ai sei di sempre', () => {
    const game = partitaPerBot(undefined);
    creaBot(game, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS_FINTE, () => 0.5);
    assert.equal(Object.keys(game.players).length, 5);
});

test('createBots non supera mai il tetto assoluto', () => {
    const game = partitaPerBot(999);
    creaBot(game, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS_FINTE, () => 0.5);
    assert.equal(Object.keys(game.players).length, TETTO - 1);
});

test('il tetto assoluto è 20', () => {
    assert.equal(TETTO, 20);
});

test('i colori bastano per venti piloti, e sono tutti diversi', () => {
    const game = partitaPerBot(20);
    creaBot(game, { lockedPlayers: ['#E74C3C'] }, TYRE_COMPOUNDS_FINTE, () => 0.5);
    const colori = Object.keys(game.players);
    assert.equal(colori.length, 19, 'con un umano servono 19 bot');
    assert.equal(new Set(colori.map(c => c.toUpperCase())).size, 19, 'nessun colore ripetuto');
    assert.ok(!colori.some(c => c.toUpperCase() === '#E74C3C'), 'nessun bot col colore dell\'umano');
});

// --- il giro della morte (fase 2b) ---
const f1Bot = require('./f1Bot.js');

test('il bot non mira mai dentro ne\' oltre un giro della morte', () => {
    // ⚠️ IL TEST CHE MANCAVA. Il bot puntava ai campioni del tubo — che in
    // pianta si spostano verso l'uscita, di fianco — e imboccava il loop
    // sbandando verso l'altra corsia: «prima di salire e fare il loop si
    // orientano verso l'altra parte di pista» (visto in gioco, 2026-08-26).
    // Misurato allora: 7.4 unita' di scarto dall'asse a tre campioni
    // dall'imbocco; dopo la cura, 0.36.
    const track = require('./trackLoader.js').loadTrack('loop-prova');
    const primo = track.points.findIndex(p => p.acrobatico);
    const n = track.points.length;
    assert.ok(primo > 0, 'loop-prova deve avere un giro della morte');

    // Da venti campioni prima dell'imbocco, con qualunque lookahead: il
    // bersaglio non deve mai cadere dentro il tubo ne' oltre.
    for (let indietro = 1; indietro <= 20; indietro++) {
        const da = (primo - indietro + n) % n;
        for (const look of [5, 20, 60, 120]) {
            const grezzo = f1Bot.lookaheadIndex(n, da, look);
            const scelto = f1Bot.mirinoPrimaDelTubo(track, da, grezzo);
            const dentro = track.points[scelto].acrobatico;
            const oltre = ((scelto - primo) % n + n) % n < n / 2 && !dentro;
            assert.ok(!oltre, `da ${indietro} campioni prima, lookahead ${look}: mira oltre il tubo (${scelto})`);
            if (dentro) {
                assert.equal(scelto, primo,
                    `da ${indietro} campioni prima, lookahead ${look}: mira al campione ${scelto} dentro il tubo invece che all'imbocco ${primo}`);
            }
        }
    }
});

test('su una pista senza giri della morte il mirino non cambia di un campione', () => {
    const track = require('./trackLoader.js').loadTrack('prova');
    const n = track.points.length;
    for (const da of [0, 100, 500, 900]) {
        for (const look of [5, 40, 120]) {
            const grezzo = f1Bot.lookaheadIndex(n, da, look);
            assert.equal(f1Bot.mirinoPrimaDelTubo(track, da, grezzo), grezzo);
        }
    }
});

// ═══════ LA VELOCITA' IN CURVA SI CALCOLA COL TURN RATE CHE SI AVRA' ═══════
//
// ⚠️ MISURATO CONTRO UN GIRO UMANO (2026-09-05). Su `prova` il bot passava
// l'apice di una curva a 140 km/h dove una persona passa a 279, seguendo bene
// la propria traiettoria: non era la linea, era la stima.
//
// `cornerTargetSpeed` calcola v = raggio x turnRate, che e' cinematicamente
// giusto, ma usava `TURN_SPEED_HIGH` — il turn rate ALLA VELOCITA' MASSIMA,
// cioe' il minimo che l'auto ha. In curva si va piano, e piano l'auto sterza
// fino a `TURN_SPEED_LOW`: il 44% in piu'. Il bot si negava metà dello sterzo
// che avrebbe avuto proprio dove serviva.
//
// La velocita' e il turn rate si definiscono a vicenda, quindi la soluzione e'
// un punto fisso — risolto in forma chiusa dentro cornerTargetSpeed.
const SteeringModel = require('./physics/SteeringModel.js');
const VehiclePhysics = require('./physics/VehiclePhysics.js');

// Un arco di raggio noto, campionato come una pista vera.
function arco(raggio, quanti = 400) {
    const pts = [];
    for (let i = 0; i < quanti; i++) {
        const a = (i / quanti) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * raggio, z: Math.sin(a) * raggio, y: 0 });
    }
    return pts;
}

// Il turn rate VERO che la fisica concede a quella velocita', misurato
// facendo girare l'auto per un tick con lo sterzo tutto da un lato.
function turnRateVeroA(velocita, maxSpeed) {
    const p = {
        speed: velocita, angle: 0, vx: 0, vz: velocita,
        inputs: { throttle: 0, brake: 0, steer: 1 },
    };
    SteeringModel.applySteering(p, true, maxSpeed);
    return Math.abs(p.angle);
}

test('la velocita\' in curva sta dentro il turn rate che la fisica concede davvero', () => {
    // Il test di verita': qualunque sia la formula, l'auto alla velocita'
    // stimata deve riuscire a percorrere quel raggio. Se non ci riesce, il bot
    // uscira' di pista; se ci riesce con troppo margine, sta andando piano
    // per niente.
    const maxSpeed = VehiclePhysics.MAX_SPEED;
    // ⚠️ Il passo di campionamento e' quello VERO dell'arco: passando 1 mentre
    // un campione vale 0.63 unita', `windowRadius` misura un raggio falsato e
    // il test accusa la formula di un difetto che e' della misura.
    const passoDi = (raggio, quanti) => (2 * Math.PI * raggio) / quanti;
    for (const raggio of [40, 60, 100, 200, 400]) {
        const pts = arco(raggio);
        const v = cornerTargetSpeed(pts, 0, 200, 20, passoDi(raggio, pts.length),
            maxSpeed, maxSpeed, 0.05, SteeringModel.TURN_SPEED_HIGH, 1, 1,
            SteeringModel.TURN_SPEED_LOW);
        const raggioPercorribile = v / turnRateVeroA(v, maxSpeed);
        assert.ok(raggioPercorribile <= raggio * 1.02,
            `raggio ${raggio}: a ${v.toFixed(2)} l'auto gira al minimo su ${raggioPercorribile.toFixed(1)}, non ci sta`);
        // E non deve avanzare troppo margine — ma solo dove la curva limita
        // davvero: se la velocita' ha saturato al massimo, il margine grande
        // e' il segno che li' non c'era niente da rallentare.
        if (v < maxSpeed - 1e-9) {
            assert.ok(raggioPercorribile >= raggio * 0.75,
                `raggio ${raggio}: a ${v.toFixed(2)} potrebbe girare su ${raggioPercorribile.toFixed(1)}, va piano per niente`);
        }
    }
});

test('col turn rate a fermo la stima in curva stretta sale, e di quanto lo dice la formula', () => {
    const maxSpeed = VehiclePhysics.MAX_SPEED;
    const pts = arco(50);
    const vecchia = cornerTargetSpeed(pts, 0, 200, 20, (2 * Math.PI * 50) / 400,
        maxSpeed, maxSpeed, 0.05, SteeringModel.TURN_SPEED_HIGH, 1, 1);
    const nuova = cornerTargetSpeed(pts, 0, 200, 20, (2 * Math.PI * 50) / 400,
        maxSpeed, maxSpeed, 0.05, SteeringModel.TURN_SPEED_HIGH, 1, 1,
        SteeringModel.TURN_SPEED_LOW);
    assert.ok(nuova > vecchia * 1.15,
        `la stima e' passata da ${vecchia.toFixed(2)} a ${nuova.toFixed(2)}: troppo poco`);
    // La forma chiusa del punto fisso: v = R.wLow / (1 + R.(wLow-wHigh)/vMax).
    // Il raggio che conta e' quello che misura windowRadius sull'arco, non il
    // nominale — la finestra e' una corda, non l'arco intero.
    const w = windowRadius(pts, 0, 20, (2 * Math.PI * 50) / 400 * 20);
    const wLow = SteeringModel.TURN_SPEED_LOW, wHigh = SteeringModel.TURN_SPEED_HIGH;
    const atteso = (w.radius * wLow) / (1 + w.radius * (wLow - wHigh) / maxSpeed);
    assert.ok(Math.abs(nuova - Math.min(maxSpeed, atteso)) < 0.01,
        `atteso ${atteso.toFixed(3)}, ottenuto ${nuova.toFixed(3)}`);
});

test('senza il turn rate a fermo la stima resta quella di prima', () => {
    // ⚠️ Serve che sia ESPLICITO: un chiamante non aggiornato (uno strumento
    // offline, un test storico) ottiene il conto vecchio, non un ripiego che
    // somiglia al nuovo. Un ripiego silenzioso falsificherebbe ogni misura
    // fatta con quello strumento.
    const maxSpeed = VehiclePhysics.MAX_SPEED;
    const pts = arco(50);
    const w = windowRadius(pts, 0, 20, (2 * Math.PI * 50) / 400 * 20);
    const v = cornerTargetSpeed(pts, 0, 200, 20, (2 * Math.PI * 50) / 400,
        maxSpeed, maxSpeed, 0.05, SteeringModel.TURN_SPEED_HIGH, 1, 1);
    assert.ok(Math.abs(v - Math.min(maxSpeed, w.radius * SteeringModel.TURN_SPEED_HIGH)) < 0.01);
});

test('dove la pista corre quasi dritta non si rallenta', () => {
    // ⚠️ Un cerchio ENORME, non un segmento: `lookaheadIndex` tratta i punti
    // come un giro chiuso, e un segmento aperto si richiude su se' stesso
    // creando una curva strettissima che non esiste in nessuna pista.
    const maxSpeed = VehiclePhysics.MAX_SPEED;
    const quasiDritto = arco(20000, 400);
    const v = cornerTargetSpeed(quasiDritto, 0, 200, 20, (2 * Math.PI * 20000) / 400,
        maxSpeed, maxSpeed, 0.05, SteeringModel.TURN_SPEED_HIGH, 1, 1,
        SteeringModel.TURN_SPEED_LOW);
    assert.equal(v, maxSpeed);
});

// ═══════════ I LIVELLI DI DIFFICOLTA' (spec 2026-09-05) ═══════════
//
// Prima, ogni bot pescava da solo ritmo e rumore di sterzo: la difficolta'
// esisteva ma girava a caso, e il giocatore incontrava avversari fra +1.9 e
// +5.6 secondi al giro senza che nessuno lo decidesse.
const F1Difficolta = require('../../../frontend/shared/f1Difficolta.js');

// ⚠️ Non un finto nuovo: `partitaPerBot` (sopra) e' quello che usano gli
// altri test di createBots. Qui serve solo aggiungerci il livello.
function partitaConLivello(livello, quanti) {
    const g = partitaPerBot(quanti);
    if (livello !== undefined) g.settings = { botDifficolta: livello };
    return g;
}

test('a difficile i bot nascono piu\' veloci e piu\' precisi che a facile', () => {
    const facile = partitaConLivello('facile', 8);
    const difficile = partitaConLivello('difficile', 8);
    creaBot(facile, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS_FINTE);
    creaBot(difficile, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS_FINTE);
    const ritmi = (g) => Object.values(g.players).map(p => p.botSpeedFactor);
    const rumori = (g) => Object.values(g.players).map(p => p.botPrecisionNoise);
    assert.ok(Math.min(...ritmi(difficile)) >= Math.max(...ritmi(facile)),
        'il piu\' lento a difficile deve battere il piu\' veloce a facile');
    assert.ok(Math.max(...rumori(difficile)) <= Math.min(...rumori(facile)),
        'il piu\' impreciso a difficile deve battere il piu\' preciso a facile');
});

test('dentro un livello i bot restano diversi fra loro', () => {
    // ⚠️ Senza varianza la griglia gira in fila indiana e non si vede un
    // sorpasso per tutta la gara — e' il motivo per cui i livelli sono
    // intervalli e non numeri.
    for (const livello of F1Difficolta.LIVELLI) {
        const g = partitaConLivello(livello, 10);
        creaBot(g, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS_FINTE);
        const ritmi = Object.values(g.players).map(p => p.botSpeedFactor);
        assert.ok(Math.max(...ritmi) - Math.min(...ritmi) > 0.005,
            `${livello}: tutti i bot hanno lo stesso ritmo`);
    }
});

test('ogni bot nasce dentro gli intervalli del suo livello', () => {
    for (const livello of F1Difficolta.LIVELLI) {
        const i = F1Difficolta.intervalliDi(livello);
        const g = partitaConLivello(livello, 10);
        creaBot(g, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS_FINTE);
        for (const p of Object.values(g.players)) {
            assert.ok(p.botSpeedFactor >= i.ritmoMin && p.botSpeedFactor <= i.ritmoMax,
                `${livello}: ritmo ${p.botSpeedFactor} fuori da [${i.ritmoMin}, ${i.ritmoMax}]`);
            assert.ok(p.botPrecisionNoise >= i.rumoreMin && p.botPrecisionNoise <= i.rumoreMax,
                `${livello}: rumore ${p.botPrecisionNoise} fuori da [${i.rumoreMin}, ${i.rumoreMax}]`);
        }
    }
});

test('senza livello scelto la griglia nasce media, e mai senza ritmo', () => {
    const g = partitaConLivello(undefined, 6);
    creaBot(g, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS_FINTE);
    const i = F1Difficolta.intervalliDi('medio');
    for (const p of Object.values(g.players)) {
        assert.ok(Number.isFinite(p.botSpeedFactor) && p.botSpeedFactor > 0,
            'un bot senza ritmo moltiplica la velocita\' per NaN e sparisce dal tracciato');
        assert.ok(p.botSpeedFactor >= i.ritmoMin && p.botSpeedFactor <= i.ritmoMax);
    }
});

test('a difficile un bot tenta il sorpasso dove a facile si accoda', () => {
    // ⚠️ Si misura il COMPORTAMENTO, non la costante: due bot identici, stessa
    // pista, stesso avversario davanti, e si guarda in che stato finiscono. Un
    // test sulla costante direbbe solo che la tabella e' stata letta.
    //
    // Si riusano gli helper che il file ha gia': `makeGripAwarenessGame`
    // costruisce pista + bot, `makeGripAwarenessDeps` le deps di
    // updateBotInputs.
    function statoDi(livello, quantoPiuLento) {
        const { game, p } = makeGripAwarenessGame(0, 'race');
        game.settings = { botDifficolta: livello };
        const iDavanti = p.trackIndex + 4;
        game.players = {
            bot1: p,
            bot2: Object.assign({}, p, {
                trackIndex: iDavanti,
                speed: p.speed * quantoPiuLento,
                botSpeedFactor: quantoPiuLento,
                x: game.track.points[iDavanti].x,
                z: game.track.points[iDavanti].z,
                inputs: { throttle: 0, brake: 0, steer: 0 },
            }),
        };
        updateBotInputs(game, makeGripAwarenessDeps());
        return p._botDebug && p._botDebug.state;
    }
    // Un avversario piu' lento del 2%: sta in mezzo fra la soglia di
    // `difficile` (serve l'1.00, cioe' qualunque margine) e quella di
    // `facile` (serve il 4%).
    assert.equal(statoDi('difficile', 0.98), 'OVERTAKING');
    assert.equal(statoDi('facile', 0.98), 'FOLLOWING');
});

// ═══════════ LA SOSTA NON SI FA NELL'ULTIMO GIRO ═══════════
//
// ⚠️ SEGNALATO DALL'UTENTE (2026-09-05): «non voglio che i bot vadano ai box
// all'ultimo giro, massimo al penultimo. non si puo' finire la gara passando
// ai box».
//
// La rete di sicurezza che forza la sosta a chi non ha ancora pittato
// scattava a `remainingLaps <= 1`, che vuol dire "sta correndo l'ultimo
// giro": su una pista corta, dove l'usura non arriva mai alla soglia, TUTTI i
// bot finivano per entrare li'.
function garaAlGiro(lap, totalLaps, usura) {
    const { game, p } = makeGripAwarenessGame(usura, 'race');
    game.track.totalLaps = totalLaps;
    p.lap = lap;
    p.tyreWear = usura;
    p.botPitThreshold = 70;
    p.hasPitted = false;
    p.botHeadingToPits = false;
    return { game, p };
}

test('con gomme buone il bot si dirige ai box al penultimo giro, non all\'ultimo', () => {
    // Gara di 5 giri, gomme a posto: la sosta obbligatoria va scontata, e il
    // posto giusto e' il penultimo giro (lap 3 = sta correndo il quarto).
    const penultimo = garaAlGiro(3, 5, 20);
    updateBotInputs(penultimo.game, makeGripAwarenessDeps());
    assert.equal(penultimo.p.botHeadingToPits, true, 'al penultimo giro deve dirigersi ai box');
});

test('nell\'ultimo giro il bot non entra ai box nemmeno con le gomme finite', () => {
    // ⚠️ Nemmeno con l'usura oltre la soglia: chi e' arrivato fin li' senza
    // pittare si tiene la penalita', ma non chiude la gara in corsia box.
    const ultimo = garaAlGiro(4, 5, 95);
    updateBotInputs(ultimo.game, makeGripAwarenessDeps());
    assert.equal(ultimo.p.botHeadingToPits, false, 'nell\'ultimo giro non si entra ai box');
});

test('a meta\' gara con le gomme finite si entra come sempre', () => {
    // La regressione da evitare: il divieto vale per l'ultimo giro, non per
    // la strategia normale.
    const meta = garaAlGiro(1, 5, 85);
    updateBotInputs(meta.game, makeGripAwarenessDeps());
    assert.equal(meta.p.botHeadingToPits, true, 'con le gomme oltre soglia si entra');
});

// ═══════════ CHI HO DIETRO (spec 2026-09-05) ═══════════
test('nearestBehindPlayer trova chi insegue, e da che lato arriva', () => {
    // ⚠️ `mockTrack` non ha coordinate — e' `{points:{length:n}}`, basta a
    // contare i campioni ma non a dire da che LATO sta uno. Qui serve una
    // pista vera, e il file ne sa gia' costruire una.
    const punti = buildConstantCurveTrack(200, 60, 1 / 40);
    const track = { points: punti, lapLength: punti.length };
    // Chi difende sta al campione 100, sull'asse; l'inseguitore quattro
    // campioni dietro e spostato di 3 unita' da un lato.
    const nrm = TrackGeometry.normalAt(track.points, 96, true);
    const difensore = { color: 'A', trackIndex: 100, x: track.points[100].x, z: track.points[100].z };
    const attaccante = {
        color: 'B', trackIndex: 96,
        x: track.points[96].x + nrm.nx * 3, z: track.points[96].z + nrm.nz * 3,
    };
    const r = nearestBehindPlayer(difensore, [difensore, attaccante], track);
    assert.ok(r, 'nessun inseguitore trovato');
    assert.equal(r.player.color, 'B');
    assert.ok(r.gapM > 0, 'il distacco si conta indietro, non avanti');
    assert.equal(Math.sign(r.lato), 1, 'l\'inseguitore sta dal lato positivo della normale');
});

test('chi e\' davanti non conta come inseguitore', () => {
    // ⚠️ `mockTrack` non ha coordinate — e' `{points:{length:n}}`, basta a
    // contare i campioni ma non a dire da che LATO sta uno. Qui serve una
    // pista vera, e il file ne sa gia' costruire una.
    const punti = buildConstantCurveTrack(200, 60, 1 / 40);
    const track = { points: punti, lapLength: punti.length };
    const difensore = { color: 'A', trackIndex: 100, x: track.points[100].x, z: track.points[100].z };
    const davanti = { color: 'B', trackIndex: 104, x: track.points[104].x, z: track.points[104].z };
    const r = nearestBehindPlayer(difensore, [difensore, davanti], track);
    // C'e' un solo altro pilota, ed e' davanti: come inseguitore risulta a
    // quasi un giro di distanza, non a quattro campioni.
    assert.ok(!r || r.gapM > track.lapLength / 2, 'chi e\' davanti non e\' un inseguitore');
});

test('un inseguitore incollato risulta affiancato', () => {
    // ⚠️ `mockTrack` non ha coordinate — e' `{points:{length:n}}`, basta a
    // contare i campioni ma non a dire da che LATO sta uno. Qui serve una
    // pista vera, e il file ne sa gia' costruire una.
    const punti = buildConstantCurveTrack(200, 60, 1 / 40);
    const track = { points: punti, lapLength: punti.length };
    const difensore = { color: 'A', trackIndex: 100, x: track.points[100].x, z: track.points[100].z };
    const incollato = { color: 'B', trackIndex: 100, x: track.points[100].x + 2, z: track.points[100].z };
    const r = nearestBehindPlayer(difensore, [difensore, incollato], track);
    assert.equal(r.affiancato, true);
});

test('un bot che ha qualcuno dietro si sposta a coprirlo, e non rallenta', () => {
    // ⚠️ Le due cose insieme, e la seconda conta quanto la prima: la difesa
    // cambia la traiettoria, mai la velocita'. Un bot che frena per restare
    // davanti e' cio' che i giocatori riconoscono come «AI che bara».
    function difesaCon(livello, latoAttaccante) {
        const { game, p } = makeGripAwarenessGame(0, 'race');
        game.settings = { botDifficolta: livello };
        game.raceTick = 2000;
        // ⚠️ QUINDICI campioni, non tre: su questa pista finta un campione
        // vale un metro, e a tre metri l'inseguitore conta come AFFIANCATO —
        // la difesa allora non scatta apposta, ed e' la regola giusta. Serve
        // dentro la finestra (30) ma oltre l'affiancamento (8).
        p.trackIndex = 25;
        p.x = game.track.points[25].x; p.z = game.track.points[25].z;
        const iDietro = p.trackIndex - 15;
        const nrm = TrackGeometry.normalAt(game.track.points, iDietro, true);
        game.players = {
            bot1: p,
            bot2: Object.assign({}, p, {
                trackIndex: iDietro,
                x: game.track.points[iDietro].x + nrm.nx * 4 * latoAttaccante,
                z: game.track.points[iDietro].z + nrm.nz * 4 * latoAttaccante,
                inputs: { throttle: 0, brake: 0, steer: 0 },
            }),
        };
        updateBotInputs(game, makeGripAwarenessDeps());
        return { stato: p._botDebug.state, velocita: p._botDebug.targetSpeed,
                 scostamento: p._botDebug.scostamentoDifensivo };
    }
    // Lo stesso bot senza nessuno dietro: e' il metro per la velocita'.
    // ⚠️ NELLO STESSO PUNTO DI PISTA. Misurarlo dove parte (campione 5, dritto)
    // e confrontarlo col difensore (campione 25, in curva) darebbe due
    // velocita' diverse per la geometria, non per la difesa.
    const solo = (() => {
        const { game, p } = makeGripAwarenessGame(0, 'race');
        game.settings = { botDifficolta: 'difficile' };
        p.trackIndex = 25;
        p.x = game.track.points[25].x; p.z = game.track.points[25].z;
        updateBotInputs(game, makeGripAwarenessDeps());
        return p._botDebug.targetSpeed;
    })();

    const daSinistra = difesaCon('difficile', -1);
    const daDestra = difesaCon('difficile', 1);
    assert.ok(daSinistra.scostamento < 0, 'chi arriva da sinistra va coperto a sinistra');
    assert.ok(daDestra.scostamento > 0, 'chi arriva da destra va coperto a destra');
    assert.equal(daSinistra.stato, 'DEFENDING');
    assert.ok(Math.abs(daSinistra.velocita - solo) < 1e-9,
        `difendendo la velocita' e' passata da ${solo} a ${daSinistra.velocita}`);
});

test('a difficile si copre piu\' che a facile', () => {
    function scostamentoCon(livello) {
        const { game, p } = makeGripAwarenessGame(0, 'race');
        game.settings = { botDifficolta: livello };
        game.raceTick = 2000;
        // ⚠️ QUINDICI campioni, non tre: su questa pista finta un campione
        // vale un metro, e a tre metri l'inseguitore conta come AFFIANCATO —
        // la difesa allora non scatta apposta, ed e' la regola giusta. Serve
        // dentro la finestra (30) ma oltre l'affiancamento (8).
        p.trackIndex = 25;
        p.x = game.track.points[25].x; p.z = game.track.points[25].z;
        const iDietro = p.trackIndex - 15;
        const nrm = TrackGeometry.normalAt(game.track.points, iDietro, true);
        game.players = {
            bot1: p,
            bot2: Object.assign({}, p, {
                trackIndex: iDietro,
                x: game.track.points[iDietro].x + nrm.nx * 4,
                z: game.track.points[iDietro].z + nrm.nz * 4,
                inputs: { throttle: 0, brake: 0, steer: 0 },
            }),
        };
        updateBotInputs(game, makeGripAwarenessDeps());
        return Math.abs(p._botDebug.scostamentoDifensivo);
    }
    assert.ok(scostamentoCon('difficile') > scostamentoCon('facile'));
});

test('ogni bot ha una sua idea di traiettoria', () => {
    const g = partitaConLivello('medio', 8);
    creaBot(g, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS_FINTE);
    const offset = Object.values(g.players).map(p => p.botLineaOffset);
    assert.ok(offset.every(v => Number.isFinite(v)), 'un bot senza linea propria');
    assert.ok(Math.max(...offset) - Math.min(...offset) > 0.5,
        'i bot hanno tutti la stessa linea: restano sei copie');
    // ⚠️ Piccolo: la linea e' gia' ottimizzata, allontanarsene costa tempo, e
    // uno scostamento generoso non sarebbe varieta' ma lentezza.
    assert.ok(Math.max(...offset.map(Math.abs)) <= 2,
        'scostamento troppo largo: e\' lentezza, non varieta\'');
});

// ═══════════ GLI ERRORI DELL'AI (spec 2026-09-05) ═══════════
test('a facile i bot sbagliano, a difficile quasi mai', () => {
    // ⚠️ Lo STESSO flusso di numeri casuali per i due livelli: cosi' a
    // decidere e' la soglia, non la fortuna. Con Math.random questo test
    // sarebbe statistico, e a facile uscirebbe zero errori una volta ogni
    // venti esecuzioni: un rosso che non significa niente.
    function erroriIn(livello) {
        const g = partitaConLivello(livello, 4);
        creaBot(g, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS_FINTE);
        const soglia = F1Difficolta.soglieDi(livello).erroriPerGiro;
        let seme = 987654321;
        const rng = () => { seme = (seme * 1103515245 + 12345) % 2147483648; return seme / 2147483648; };
        let quanti = 0;
        for (const p of Object.values(g.players)) {
            // 1200 tick = un minuto, circa un giro di `prova`.
            for (let t = 0; t < 1200; t++) {
                if (aggiornaErrore(p, soglia, 50, 50000, rng)) quanti++;
            }
        }
        return quanti;
    }
    const facile = erroriIn('facile');
    const difficile = erroriIn('difficile');
    assert.ok(facile > 0, 'a facile non ha sbagliato nessuno in un giro intero');
    assert.ok(facile > difficile * 3,
        `a facile si deve sbagliare molto piu' spesso (facile ${facile}, difficile ${difficile})`);
});

test('un errore dura un attimo e poi passa', () => {
    // ⚠️ Un errore che non scade e' un bot rotto per il resto della gara.
    const p = {};
    const sempre = () => 0;      // scatta al primo tick utile
    assert.equal(aggiornaErrore(p, 1, 50, 50000, sempre), true, 'non e\' partito');
    // Quanti tick passano prima che ne possa partire un altro: e' la durata
    // dell'errore, e si misura invece di darla per buona.
    let tick = 0;
    while (!aggiornaErrore(p, 1, 50, 50000, sempre) && tick < 200) tick++;
    assert.equal(tick * 50, 900, 'l\'errore non dura i 900 ms dichiarati');
});

test('in qualifica non si sbaglia mai', () => {
    // ⚠️ Un giro secco rovinato dal caso falsa la griglia, e la griglia
    // decide la gara. Gli errori sono roba da gara, non da qualifica.
    const { game, p } = makeGripAwarenessGame(0, 'qualifying');
    game.settings = { botDifficolta: 'facile' };
    for (let t = 0; t < 400; t++) updateBotInputs(game, makeGripAwarenessDeps());
    assert.ok(!p.botErroreFinoMs, 'un bot ha sbagliato in qualifica');
});

test('chi attacca sceglie il lato dove c\'e\' spazio, non quello deciso alla nascita', () => {
    // ⚠️ Il test gira sui DUE lati con la STESSA preferenza personale: se il
    // bot attaccasse sempre dalla parte che si e' scelto alla nascita, uno
    // dei due casi fallirebbe. Con un lato solo passerebbe per meta' delle
    // volte anche un codice che la porta non la guarda.
    function latoDellAttacco(latoDifensore) {
        const { game, p } = makeGripAwarenessGame(0, 'race');
        game.settings = { botDifficolta: 'difficile' };
        p.botOvertakeSide = 1;            // preferenza: sempre destra
        const iDavanti = p.trackIndex + 4;
        const nrm = TrackGeometry.normalAt(game.track.points, iDavanti, true);
        game.players = {
            bot1: p,
            bot2: Object.assign({}, p, {
                trackIndex: iDavanti, speed: p.speed * 0.9, botSpeedFactor: 0.9,
                // Il difensore e' spostato da un lato: la porta e' dall'altro.
                x: game.track.points[iDavanti].x + nrm.nx * 4 * latoDifensore,
                z: game.track.points[iDavanti].z + nrm.nz * 4 * latoDifensore,
                inputs: { throttle: 0, brake: 0, steer: 0 },
            }),
        };
        updateBotInputs(game, makeGripAwarenessDeps());
        assert.equal(p._botDebug.state, 'OVERTAKING', 'non sta nemmeno attaccando');
        const centro = game.track.points[p.trackIndex];
        return Math.sign((p._botDebug.target.x - centro.x) * nrm.nx +
                         (p._botDebug.target.z - centro.z) * nrm.nz);
    }
    assert.equal(latoDellAttacco(1), -1, 'difensore a destra: ha attaccato a destra');
    assert.equal(latoDellAttacco(-1), 1, 'difensore a sinistra: ha attaccato a sinistra');
});

// ═══════════ L'INGRESSO LARGO (2026-09-05) ═══════════
//
// Misurato su `prova`: la racing line precalcolata entra in curva GIA'
// all'interno (+4.3 su una semicarreggiata di 11, dove un fuori-dentro-fuori
// entrerebbe negativo) e in tre curve su undici sta a 10.5-10.8 dall'ingresso
// all'uscita. E' il motivo per cui l'utente vede i bot «sempre all'interno»
// e li supera dal lato libero.
test('con una linea che entra stretta, il bot entra piu\' largo di lei', () => {
    // La racing line di questo test coincide con l'asse: e' il caso limite
    // di una linea che «non si allarga mai». Il bot deve comunque entrare
    // largo, altrimenti in curva sta dove sta la linea e basta.
    function bersaglioA(indice) {
        const points = buildVaryingCurveTrack(300, 100, 100, 1 / 25);
        const racingLineTuning = { lookaheadTimeS: 0.6, steerGain: 3.0, adaptiveLookaheadK: 0.1,
                                   cornerSpeedMargin: 0.99, brakingDistanceMargin: 1.2,
                                   deadband: 0.01, ramp: 0.06 };
        const track = { points, racingLine: points, racingLineTuning,
                        lapLength: points.length, roadHalf: 8, totalLaps: 3,
                        pitEntryIndex: 9999, pitPath: [{ x: 0, z: 0 }, { x: 0, z: 0 }] };
        const p = {
            x: points[indice].x, z: points[indice].z, angle: 0,
            speed: 6, vx: 0, vz: 0, inputs: { throttle: 0, brake: 0, steer: 0 },
            finished: false, lap: 0, botLapSeen: 0, trackIndex: indice,
            tyreWear: 0, compound: 'medium', damage: 0,
            pitting: false, pitAutoState: null, pitPhase: null,
            isBot: true, botSpeedFactor: 1, botLapPaceMult: 1, botPrecisionNoise: 0,
            // ⚠️ Linea personale a zero: qui si misura l'ingresso largo, e due
            // scostamenti sommati non direbbero quale dei due ha agito.
            botLineaOffset: 0,
            // Il carattere di questo bot: si allarga di un terzo di
            // carreggiata dove il profilo dice di allargarsi.
            botAllargamento: 0.35,
            botOvertakeSide: 1, botHeadingToPits: false, botPitReactionScheduled: false,
            botPitThreshold: 100, hasPitted: false
        };
        const game = { phase: 'race', track, players: { bot1: p },
                       settings: { botDifficolta: 'medio' } };
        updateBotInputs(game, makeGripAwarenessDeps());
        // ⚠️ Lo scostamento si misura dalla LINEA, nel punto mirato: il
        // bersaglio sta piu' avanti, e in curva un punto dell'asse piu'
        // avanti proietta gia' di suo verso l'interno sulla normale di qui.
        // Misurandolo dal punto del bot, quella componente geometrica
        // sommergerebbe lo scostamento che si vuole vedere.
        const t = p._botDebug.target;
        const q = TrackGeometry.nearestPoint(points, t.x, t.z);
        const n = TrackGeometry.normalAt(points, q.index, true);
        return (t.x - points[q.index].x) * n.nx + (t.z - points[q.index].z) * n.nz;
    }
    // Da che parte sta l'interno, in questa curva: lo dice la forma completa
    // all'apice, invece di fidarsi di una convenzione di segno.
    const pts = buildVaryingCurveTrack(300, 100, 100, 1 / 25);
    const nApice = TrackGeometry.normalAt(pts, 150, true);
    const o = apexOffset(pts, 150, 60, 12, 1, 8, 0.5);
    const interno = Math.sign(o.dx * nApice.nx + o.dz * nApice.nz);

    // ⚠️ Poco PRIMA della curva, non a dieci campioni dall'apice: e' li' che
    // si prepara l'ingresso, e a un passo dall'apice il profilo dice
    // giustamente di stare sulla linea.
    const ingresso = bersaglioA(95);
    assert.ok(Math.sign(ingresso) === -interno && Math.abs(ingresso) > 0.5,
        `prima della curva il bersaglio dovrebbe stare verso l'esterno, sta a ${ingresso.toFixed(2)}`);
});

// ═══════════ IL PROFILO DI ALLARGAMENTO (2026-09-05) ═══════════
//
// Misurato su `prova`: la racing line precalcolata entra in curva GIA'
// all'interno (+4.3 su una semicarreggiata di 11, dove un fuori-dentro-fuori
// entrerebbe negativo) e in tre curve su undici sta a 10.5-10.8 dall'ingresso
// all'uscita. Da qui il profilo: dove NON siamo all'apice, ci si allarga.
test('il profilo dice zero agli apici e tanto nei tratti aperti', () => {
    // Curva a triangolo con l'apice al centro: 100 campioni dritti, 100 di
    // curva, apice a 150.
    const pts = buildVaryingCurveTrack(300, 100, 100, 1 / 25);
    const track = { points: pts, lapLength: pts.length, roadHalf: 8 };
    const { fattore } = profiloAllargamento(track);
    assert.ok(fattore[150] < 0.15, `all'apice non ci si allarga, invece vale ${fattore[150].toFixed(2)}`);
    // Nel dritto poco prima della curva ci si deve gia' allargare: e' li' che
    // si prepara l'ingresso, e arrivarci attaccati all'interno e' il difetto
    // che tutto questo corregge.
    assert.ok(fattore[95] > 0.5, `prima della curva ci si allarga poco: ${fattore[95].toFixed(2)}`);
});

test('una piega larghissima non e\' una curva: non ci si sposta', () => {
    // ⚠️ Senza la soglia, QUALUNQUE piega diventerebbe una curva con un suo
    // apice, e i bot ondeggerebbero anche in rettilineo.
    //
    // (Un rettilineo vero non si puo' usare come caso di prova: una pista
    // aperta ha i due capi che si richiudono, e li' la curvatura non e' zero.
    // Un cerchio molto ampio e' il caso onesto.)
    const pts = [];
    const raggio = 500;
    for (let i = 0; i < 400; i++) {
        const t = i / 400 * 2 * Math.PI;
        pts.push({ x: raggio * Math.cos(t), z: raggio * Math.sin(t) });
    }
    const track = { points: pts, lapLength: 2 * Math.PI * raggio, roadHalf: 8 };
    // La soglia e' 20 mezze carreggiate: 160 unita' contro un raggio di 500.
    const { fattore } = profiloAllargamento(track);
    assert.ok(fattore.every(v => v === 0), 'una piega da 500 unita\' di raggio conta come curva');
});
test('il profilo indica il verso della curva in cui si sta', () => {
    const pts = buildVaryingCurveTrack(300, 100, 100, 1 / 25);
    const track = { points: pts, lapLength: pts.length, roadHalf: 8 };
    const { verso } = profiloAllargamento(track);
    // Calibrato su un cerchio di centro noto: l'interno sta dalla parte di
    // normale * sign(turnSigned). Qui si controlla che il profilo riporti
    // QUEL segno, preso all'apice della curva e non dove capita.
    const c = TrackGeometry.curvatureAt(pts, 150, 12);
    assert.equal(verso[140], Math.sign(c.turnSigned),
        'il verso in ingresso non e\' quello della curva che si sta per fare');
});

test('il profilo si calcola una volta sola per pista', () => {
    // ⚠️ Gira per ogni bot ad ogni tick: ricalcolarlo sarebbe O(n * finestra)
    // venti volte al secondo per sei auto.
    const pts = buildVaryingCurveTrack(300, 100, 100, 1 / 25);
    const track = { points: pts, lapLength: pts.length, roadHalf: 8 };
    assert.equal(profiloAllargamento(track), profiloAllargamento(track));
});
test('ogni bot prende l\' apice a modo suo, e il livello dice quanto', () => {
    // ⚠️ E' questo che mette le auto su una FASCIA invece che in fila
    // sull'interno: sei bot con lo stesso allargamento sarebbero sei copie
    // anche con la forma piu' bella del mondo.
    function allargamenti(livello) {
        const g = partitaConLivello(livello, 8);
        creaBot(g, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS_FINTE);
        return Object.values(g.players).map(p => p.botAllargamento);
    }
    const f = allargamenti('facile');
    const d = allargamenti('difficile');
    assert.ok(f.every(v => Number.isFinite(v)), 'un bot senza carattere');
    assert.ok(Math.max(...f) - Math.min(...f) > 0.05, 'a facile guidano tutti uguale');
    // Salendo di livello si sta piu' vicini alla linea buona: allargarsi
    // costa tempo (0.20 vale +650 ms al giro su `prova`), e un livello alto
    // non se lo puo' permettere.
    assert.ok(Math.max(...d) <= Math.min(...f),
        'a difficile il piu\' sporco deve stare dentro il piu\' pulito di facile');
});
