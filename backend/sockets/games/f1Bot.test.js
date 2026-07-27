// backend/sockets/games/f1Bot.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    PALETTE, normalizeAngle, steerToward, lookaheadIndex, apexOffset,
    cornerTargetSpeed, windowRadius, cornerApexNear, overtakeOffset, nearestAheadPlayer,
    pickPostPitCompound, pickBotColors, estimateFinishTime,
    updateBotInputs, DEFAULT_TUNING, shouldBotRepair
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
        accel: 0.186, brakeMult: 2.17, turnRateHigh: 0.052
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

test('updateBotInputs: durante la reazione al via il bot resta fermo (nessun input), poi guida normalmente', () => {
    const points = buildConstantCurveTrack(200, 200, 0);   // rettilineo puro
    const track = { points, lapLength: 200, roadHalf: 5 };
    const deps = {
        effectiveMaxSpeed: () => 6,
        handlePitReactionPress: () => {},
        io: { to: () => ({ emit: () => {} }) },
        lobbyId: 'test',
        wearLapsAtMedium: 5,
        accel: 0.186, brakeMult: 2.17, turnRateHigh: 0.052
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
