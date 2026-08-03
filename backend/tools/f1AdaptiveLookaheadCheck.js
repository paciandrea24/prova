// backend/tools/f1AdaptiveLookaheadCheck.js
//
// Confronto diagnostico A/B per il lookahead adattivo (Fase 1 — Rif.
// docs/superpowers/specs/2026-07-29-f1-bot-adaptive-pursuit-controller-design.md,
// docs/superpowers/plans/2026-07-29-f1-bot-adaptive-lookahead-fase1.md, Task 4).
//
// SCOPO LIMITATO (non ampliare): decidere se mantenere il lookahead
// adattivo attuale (variante A, floor fisso) o pianificare un'eventuale
// variante con floor dinamico legato alla velocità (variante B). Non è
// un tool di ottimizzazione, non produce un pass/fail automatico — solo
// dati, la decisione resta dell'utente (Rif. Task 5 del piano).
//
// A = adaptiveLookaheadMeters così com'è in f1Bot.js (invariata).
// B = stesso termine geometrico sqrt(2*R_locale*e_target) di A, floor
//     fisso sostituito da L_speed(v) = max(5, v_ms * T_min).
//
// Round 2 (Rif. review Task 5): estende il round 1 (new-monza + monte-rosso,
// solo k=0.1 di default) con:
//  - metriche complete anche su baku/prova (prima solo DNF-check);
//  - sweep k x T_min per capire se il miglioramento osservato con B(0.3) è
//    robusto o solo un effetto della combinazione k=0.1 (round 1 teneva k
//    fisso apposta, ora lo si fa variare);
//  - guardia sul salto "target movement" SOLO per il tratto in cui il
//    lookahead può davvero superare la fine dell'array (wrap di indice in
//    lookaheadIndex) — verificato empiricamente (non ipotizzato) che questo
//    NON è la causa principale dei salti osservati nel round 1: la
//    maggioranza è segnale reale distribuito su tutto il giro, non un
//    artefatto di misura. Vedi commento su SEAM_TAIL più sotto.
//  - timing wall-clock per stimare il costo computazionale di B vs A.
//
// Round 3 (Rif. review round 2): il round 2 ha mostrato che B migliora sulle
// piste con racing line (new-monza, prova) e peggiora su quelle senza
// (monte-rosso, baku), in modo robusto rispetto a k — introduce quindi la
// variante C: B(0.3) solo dove esiste track.racingLine, A invariata
// altrove. Nessuna modifica a f1Bot.js necessaria: l'override riceve già
// laneSource e track, sufficienti per distinguere i due rami (la scelta è
// per-pista, non per-tick — track.racingLine esiste o non esiste per
// l'intera corsa).
//
// Round 4 (Rif. richiesta validazione statistica): il round 3 ha mostrato
// che su New Monza il rumore run-to-run (botLapPaceMult, Math.random() non
// seedato) può superare il 5-10% su una singola run, abbastanza da
// mascherare il segnale — questo round ripete ogni combinazione pista x
// variante piu volte (REPEATS) e riporta media/deviazione standard, invece
// di un singolo numero, per capire se il miglioramento di C su A e reale o
// dentro il rumore. Solo A e C (non B da sola: la domanda ora e "C sostituisce
// A?", non piu "B funziona?" — gia risposto nei round precedenti).
//
// Entrambe le varianti guidano un giro REALE completo (fisica vera, stesso
// F1_BOT_ADAPTIVE_LOOKAHEAD=1, stesso simulateLap di f1LapSimulator.js) —
// B usa l'hook diagnostico setLookaheadFormulaOverride esportato da
// f1Bot.js appositamente per questo tool: a hook spento (default null)
// f1Bot.js è byte-identico a prima, l'hook non è mai letto dal call site
// di produzione (f1GameSocket.js).
//
// Uso: node backend/tools/f1AdaptiveLookaheadCheck.js
const { loadTrack, listTracks } = require('../sockets/games/trackLoader.js');
const { simulateLap } = require('./f1LapSimulator.js');
const {
    windowRadius, lookaheadIndex, BOT_CURVATURE_LOCAL_M,
    BOT_ADAPTIVE_LOOKAHEAD_MAX_M, BOT_LOOKAHEAD_MIN_M, setLookaheadFormulaOverride
} = require('../sockets/games/f1Bot.js');

const K_CANDIDATES = [0.05, 0.1, 0.15];
const K_DEFAULT = 0.1; // BOT_ADAPTIVE_LOOKAHEAD_K — usato per la matrice multi-pista (punto 1)
const T_MIN_CANDIDATES = [0.3, 0.6]; // B(0.1) già validata ≈A nel round 1, non ripetuta qui
const PHYSICS_TICK_S = 0.05; // 50ms — physics.PHYSICS_TICK_MS in f1GameSocket.js
const SWEEP_TRACKS = ['new-monza', 'monte-rosso']; // sweep k x T_min: minimo, non tutte le piste (punto 2)

// --- Variante B: stessa aritmetica di adaptiveLookaheadMeters in f1Bot.js,
// duplicata qui SOLO per l'override diagnostico (non tocca la formula A). ---
function metersToSamplesLocal(meters, track) {
    return Math.max(1, Math.round(meters * track.points.length / track.lapLength));
}

function rawGeometricLookahead(laneSource, trackIndex, track, k) {
    const localSamples = metersToSamplesLocal(BOT_CURVATURE_LOCAL_M, track);
    const metersPerSample = track.lapLength / track.points.length;
    const localArcM = localSamples * metersPerSample;
    const i2 = lookaheadIndex(track.points.length, trackIndex, localSamples);
    const w = windowRadius(laneSource, trackIndex, i2, localArcM);
    if (!w) return null; // rettilineo: stesso significato del ramo "!w" di A
    const eTarget = k * track.roadHalf;
    return Math.sqrt(2 * w.radius * eTarget);
}

function makeVariantB(tMin) {
    return function variantB(laneSource, trackIndex, track, k, speedMs) {
        const raw = rawGeometricLookahead(laneSource, trackIndex, track, k);
        const lSpeed = Math.max(5, (speedMs || 0) * tMin);
        if (raw == null) return BOT_ADAPTIVE_LOOKAHEAD_MAX_M;
        return Math.min(BOT_ADAPTIVE_LOOKAHEAD_MAX_M, Math.max(lSpeed, raw));
    };
}

// Variante C (Rif. review round 3): B(0.3) SOLO dove esiste una racing line
// precalcolata, A INVARIATA altrove — derivata direttamente dal dato del
// round 2 (il beneficio di B si osserva solo sul ramo racing-line, peggiora
// sistematicamente sul ramo geometrico). Nessun intervento su apexOffset,
// nessun nuovo parametro per pista: la sola distinzione è quale array è
// stato passato come laneSource, la stessa identica informazione che
// updateBotInputs già usa per scegliere il ramo (racing-line è per-pista,
// non per-tick — verificato: track.racingLine o esiste per l'intera corsa
// o non esiste mai, quindi questa distinzione equivale a "quale pista",
// non introduce una logica nuova per-tick).
function makeVariantC() {
    const b03 = makeVariantB(0.3);
    return function variantC(laneSource, trackIndex, track, k, speedMs) {
        const isRacingLineBranch = !!track.racingLine && laneSource === track.racingLine;
        if (isRacingLineBranch) {
            return b03(laneSource, trackIndex, track, k, speedMs);
        }
        // Formula A, invariata carattere per carattere (stessa aritmetica
        // di adaptiveLookaheadMeters in f1Bot.js quando l'override è null).
        const raw = rawGeometricLookahead(laneSource, trackIndex, track, k);
        if (raw == null) return BOT_ADAPTIVE_LOOKAHEAD_MAX_M;
        return Math.max(BOT_LOOKAHEAD_MIN_M, Math.min(BOT_ADAPTIVE_LOOKAHEAD_MAX_M, raw));
    };
}

function branchLabel(track) {
    return track.racingLine ? 'racing-line' : 'geometrico (fallback)';
}

// --- Esecuzione di un giro reale con una variante data (+ k opzionale, per
// lo sweep del punto 2 — stessa plumbing di override già esistente per
// adaptiveLookaheadK, riusata as-is, nessun nuovo meccanismo). ---
function runVariant(trackId, overrideFn, kOverride) {
    let track = loadTrack(trackId);
    const hasLine = !!track.racingLine;
    if (kOverride != null && hasLine) {
        track = { ...track, racingLineTuning: { ...track.racingLineTuning, adaptiveLookaheadK: kOverride } };
    }
    const tuning = (kOverride != null && !hasLine) ? { adaptiveLookaheadK: kOverride } : undefined;

    setLookaheadFormulaOverride(overrideFn); // null per A
    process.env.F1_BOT_ADAPTIVE_LOOKAHEAD = '1';
    const t0 = process.hrtime.bigint();
    try {
        const r = simulateLap(track, { speedFactor: 1, paceMult: 1, precisionNoise: 0, safetyCapS: 60, tuning });
        const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
        return { ...r, wallMs };
    } finally {
        delete process.env.F1_BOT_ADAPTIVE_LOOKAHEAD;
        setLookaheadFormulaOverride(null);
    }
}

// --- Bucket di velocità a terzili (relativi al giro stesso, non soglie
// assolute — piste diverse hanno range di velocità molto diversi) ---
function bucketize(telemetry) {
    const speeds = telemetry.map(t => t.speedKmh).filter(v => v != null).sort((a, b) => a - b);
    if (!speeds.length) return [];
    const q1 = speeds[Math.floor(speeds.length / 3)];
    const q2 = speeds[Math.floor(2 * speeds.length / 3)];
    const low = telemetry.filter(t => t.speedKmh <= q1);
    const mid = telemetry.filter(t => t.speedKmh > q1 && t.speedKmh <= q2);
    const high = telemetry.filter(t => t.speedKmh > q2);
    const avgSpeed = arr => arr.length ? arr.reduce((s, t) => s + t.speedKmh, 0) / arr.length : 0;
    return [
        { label: 'bassa (curve/lento)', telemetry: low, avgSpeedKmh: avgSpeed(low) },
        { label: 'media', telemetry: mid, avgSpeedKmh: avgSpeed(mid) },
        { label: 'alta (rettilinei)', telemetry: high, avgSpeedKmh: avgSpeed(high) }
    ];
}

// Quanti campioni può coprire al massimo un lookahead (BOT_ADAPTIVE_LOOKAHEAD_MAX_M),
// su QUESTA pista — usato solo per riconoscere il tratto finale del giro in
// cui targetIdx = lookaheadIndex(...) può aver superato la fine
// dell'array (wrap di indice), senza bisogno dell'indice del target (mai
// esposto in telemetry, solo la posizione mondo). Verificato empiricamente
// (vedi commento in testa al file) che questo NON è la causa principale dei
// salti di target — è un confine di continuità reale ma minoritario.
function maxLookaheadSamples(track) {
    const metersPerSample = track.lapLength / track.points.length;
    return Math.ceil(BOT_ADAPTIVE_LOOKAHEAD_MAX_M / metersPerSample);
}

// --- Metriche di tracking + stabilità su un segmento di telemetria ---
function computeMetrics(telemetry, track) {
    const n = track.points.length;
    const seamGuard = maxLookaheadSamples(track);

    let sumDist = 0, peakDist = 0, cntDist = 0;
    let sumHeadAbs = 0, peakHeadAbs = 0, cntHead = 0;
    const headValsSigned = [];
    let prevSteer = null, sumAbsDSteer = 0, cntDSteer = 0;
    const dSteerVals = [];
    let prevTarget = null, sumTargetMove = 0, peakTargetMove = 0, cntTargetMove = 0;
    let sumTargetDist = 0, cntTargetDist = 0;
    let seamSkips = 0;

    for (const t of telemetry) {
        if (t.distanceFromRacingLine != null) {
            cntDist++; sumDist += t.distanceFromRacingLine;
            if (t.distanceFromRacingLine > peakDist) peakDist = t.distanceFromRacingLine;
        }
        if (t.headingVsTangentDeg != null) {
            const h = Math.abs(t.headingVsTangentDeg);
            cntHead++; sumHeadAbs += h;
            if (h > peakHeadAbs) peakHeadAbs = h;
            headValsSigned.push(t.headingVsTangentDeg);
        }
        if (t.steer != null) {
            if (prevSteer != null) {
                dSteerVals.push(Math.abs(t.steer - prevSteer));
                sumAbsDSteer += Math.abs(t.steer - prevSteer);
                cntDSteer++;
            }
            prevSteer = t.steer;
        } else {
            prevSteer = null;
        }

        // target distance (car -> target): resta valida anche vicino al
        // giunto di giro — il punto mirato, anche se il suo indice ha
        // "avvolto", è comunque un punto reale della pista (loop chiuso),
        // la distanza euclidea auto->target non è un artefatto.
        const nearSeam = t.idx != null && (t.idx + seamGuard >= n);
        if (t.target) {
            sumTargetDist += Math.hypot(t.target.x - t.x, t.target.z - t.z);
            cntTargetDist++;
            // target movement (target_t -> target_t-1): QUI sì che il wrap
            // dell'indice del lookahead produce un salto apparente tra due
            // punti presi da capi opposti dell'array — si salta il confine,
            // non si calcola un delta attraverso di esso.
            if (prevTarget && !nearSeam) {
                const mv = Math.hypot(t.target.x - prevTarget.x, t.target.z - prevTarget.z);
                sumTargetMove += mv; cntTargetMove++;
                if (mv > peakTargetMove) peakTargetMove = mv;
            } else if (prevTarget && nearSeam) {
                seamSkips++;
            }
            prevTarget = nearSeam ? null : t.target;
        } else {
            prevTarget = null;
        }
    }

    let signChanges = 0;
    for (let i = 1; i < headValsSigned.length; i++) {
        const a = headValsSigned[i - 1], b = headValsSigned[i];
        if (a !== 0 && b !== 0 && (a < 0) !== (b < 0)) signChanges++;
    }
    const durationS = telemetry.length * PHYSICS_TICK_S;

    let meanSigned = 0;
    for (const h of headValsSigned) meanSigned += h;
    meanSigned = headValsSigned.length ? meanSigned / headValsSigned.length : 0;
    let variance = 0;
    for (const h of headValsSigned) variance += (h - meanSigned) * (h - meanSigned);
    variance = headValsSigned.length ? variance / headValsSigned.length : 0;

    dSteerVals.sort((a, b) => a - b);
    const p95DeltaSteer = dSteerVals.length
        ? dSteerVals[Math.min(dSteerVals.length - 1, Math.floor(0.95 * dSteerVals.length))]
        : null;

    return {
        avgDist: cntDist ? sumDist / cntDist : null,
        peakDist: cntDist ? peakDist : null,
        avgHead: cntHead ? sumHeadAbs / cntHead : null,
        peakHead: cntHead ? peakHeadAbs : null,
        stdHead: headValsSigned.length ? Math.sqrt(variance) : null,
        headSignChangesPerSec: durationS > 0 ? signChanges / durationS : null,
        avgDeltaSteer: cntDSteer ? sumAbsDSteer / cntDSteer : null,
        p95DeltaSteer,
        avgTargetDist: cntTargetDist ? sumTargetDist / cntTargetDist : null,
        avgTargetMove: cntTargetMove ? sumTargetMove / cntTargetMove : null,
        peakTargetMove: cntTargetMove ? peakTargetMove : null,
        seamSkips
    };
}

function fmt(v, digits) {
    return v == null ? 'n/d' : v.toFixed(digits == null ? 2 : digits);
}

function printMetricsBlock(label, telemetry, track) {
    const m = computeMetrics(telemetry, track);
    console.log(
        `    ${label}: dist media=${fmt(m.avgDist)}m picco=${fmt(m.peakDist)}m  ` +
        `head media=${fmt(m.avgHead)}° picco=${fmt(m.peakHead)}° std=${fmt(m.stdHead)}° inv/s=${fmt(m.headSignChangesPerSec)}  ` +
        `Δsteer media=${fmt(m.avgDeltaSteer, 4)} p95=${fmt(m.p95DeltaSteer, 4)}  ` +
        `targetDist media=${fmt(m.avgTargetDist)}m  targetMove media=${fmt(m.avgTargetMove, 3)}m picco=${fmt(m.peakTargetMove, 3)}m (giunto-giro escluso: ${m.seamSkips})`
    );
}

function reportVariant(trackId, variantLabel, overrideFn, kOverride) {
    const r = runVariant(trackId, overrideFn, kOverride);
    console.log(`\n  --- ${variantLabel} ---`);
    if (!r.finished) {
        console.log('    DNF — non valutabile');
        return null;
    }
    const track = loadTrack(trackId);
    console.log(`    tempo giro: ${r.timeMs}ms   (wall-clock simulazione: ${r.wallMs.toFixed(1)}ms)   ramo: ${branchLabel(track)}`);
    printMetricsBlock('intero giro', r.telemetry, track);
    for (const bucket of bucketize(r.telemetry)) {
        if (!bucket.telemetry.length) { console.log(`    [${bucket.label}, vel.media=n/d] nessun campione`); continue; }
        printMetricsBlock(`fascia "${bucket.label}" (vel.media=${fmt(bucket.avgSpeedKmh, 1)}km/h, n=${bucket.telemetry.length})`, bucket.telemetry, track);
    }
    return { timeMs: r.timeMs, wallMs: r.wallMs, whole: computeMetrics(r.telemetry, track) };
}

function runDnfCheck(trackIds, variants) {
    console.log('=== Assenza di DNF/lockup ===');
    console.log(`(piste: ${trackIds.join(', ')})\n`);
    for (const v of variants) {
        const rows = trackIds.map(id => {
            const r = runVariant(id, v.overrideFn, v.k);
            return `${id}=${r.finished ? 'OK' : 'DNF'}`;
        });
        const allOk = rows.every(r => r.endsWith('OK'));
        console.log(`${v.label}: ${rows.join('  ')}  ${allOk ? '[nessun DNF]' : '[DNF presente]'}`);
    }
}

const REPEATS = 5;
const STAT_TRACKS = ['new-monza', 'prova', 'baku', 'monte-rosso'];
const STAT_METRICS = ['timeMs', 'avgDist', 'peakDist', 'stdHead', 'avgDeltaSteer', 'p95DeltaSteer'];
const METRIC_LABELS = {
    timeMs: 'tempo giro (ms)', avgDist: 'dist media (m)', peakDist: 'dist picco (m)',
    stdHead: 'head std (°)', avgDeltaSteer: 'Δsteer media', p95DeltaSteer: 'Δsteer p95'
};

function mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null; }
function stddev(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    const variance = arr.reduce((s, v) => s + (v - m) * (v - m), 0) / (arr.length - 1); // campionaria (n-1)
    return Math.sqrt(variance);
}

// Esegue `repeats` giri indipendenti della stessa combinazione pista+variante
// e raccoglie le metriche per ognuno — nessun nuovo parametro, nessuna
// modifica a f1Bot.js: stesso runVariant/computeMetrics gia usati nei round
// precedenti, solo ripetuto piu volte per stimare il rumore run-to-run.
function runRepeated(trackId, overrideFn, repeats) {
    const track = loadTrack(trackId);
    const samples = {}; for (const k of STAT_METRICS) samples[k] = [];
    let dnfCount = 0;
    for (let i = 0; i < repeats; i++) {
        const r = runVariant(trackId, overrideFn, null);
        if (!r.finished) { dnfCount++; continue; }
        const m = computeMetrics(r.telemetry, track);
        samples.timeMs.push(r.timeMs);
        samples.avgDist.push(m.avgDist);
        samples.peakDist.push(m.peakDist);
        samples.stdHead.push(m.stdHead);
        samples.avgDeltaSteer.push(m.avgDeltaSteer);
        samples.p95DeltaSteer.push(m.p95DeltaSteer);
    }
    const stats = {};
    for (const k of STAT_METRICS) stats[k] = { mean: mean(samples[k]), std: stddev(samples[k]), samples: samples[k] };
    return { dnfCount, repeats, stats };
}

// "Supera il rumore" (euristica, non un test statistico formale — n=5 non
// lo giustificherebbe): i range mean±1std di A e C NON si sovrappongono.
// Se si sovrappongono, la differenza osservata è compatibile col rumore
// run-to-run misurato, non necessariamente un vero effetto della formula.
function exceedsNoise(a, c) {
    if (a.mean == null || c.mean == null) return null;
    const aLow = a.mean - a.std, aHigh = a.mean + a.std;
    const cLow = c.mean - c.std, cHigh = c.mean + c.std;
    return (cHigh < aLow) || (cLow > aHigh);
}

function main() {
    console.log(`=== Round 4 — Validazione statistica: A vs C, ${REPEATS} run per combinazione ===`);
    console.log('Domanda: possiamo adottare C come nuova baseline del controller?');
    console.log('Nessun nuovo parametro, nessuno sweep k/T_min, nessuna modifica a apexOffset');
    console.log('o a f1Bot.js — solo ripetizione per separare segnale da rumore run-to-run.\n');

    const variants = [
        { label: 'A', overrideFn: null },
        { label: 'C', overrideFn: makeVariantC() }
    ];

    const results = {}; // results[trackId][variantLabel] = { dnfCount, repeats, stats }
    for (const trackId of STAT_TRACKS) {
        results[trackId] = {};
        console.log(`\n--- pista: ${trackId} (ramo: ${branchLabel(loadTrack(trackId))}) ---`);
        for (const v of variants) {
            const res = runRepeated(trackId, v.overrideFn, REPEATS);
            results[trackId][v.label] = res;
            console.log(`  ${v.label}: ${res.repeats - res.dnfCount}/${res.repeats} completati (DNF: ${res.dnfCount})`);
            for (const metric of STAT_METRICS) {
                const s = res.stats[metric];
                console.log(`    ${METRIC_LABELS[metric]}: media=${fmt(s.mean, metric === 'timeMs' ? 0 : 4)}  std=${fmt(s.std, metric === 'timeMs' ? 0 : 4)}  campioni=[${s.samples.map(x => fmt(x, metric === 'timeMs' ? 0 : 2)).join(', ')}]`);
            }
        }
    }

    console.log('\n\n=== Riepilogo — media ± std, differenza % C vs A, supera il rumore? ===');
    for (const trackId of STAT_TRACKS) {
        console.log(`\n${trackId} (ramo: ${branchLabel(loadTrack(trackId))}):`);
        const a = results[trackId]['A'], c = results[trackId]['C'];
        for (const metric of STAT_METRICS) {
            const sa = a.stats[metric], sc = c.stats[metric];
            const pctD = (sa.mean != null && sa.mean !== 0 && sc.mean != null) ? ((sc.mean - sa.mean) / sa.mean * 100) : null;
            const exceeds = exceedsNoise(sa, sc);
            console.log(
                `  ${METRIC_LABELS[metric]}: A=${fmt(sa.mean, metric === 'timeMs' ? 0 : 4)}±${fmt(sa.std, metric === 'timeMs' ? 0 : 4)}  ` +
                `C=${fmt(sc.mean, metric === 'timeMs' ? 0 : 4)}±${fmt(sc.std, metric === 'timeMs' ? 0 : 4)}  ` +
                `diff=${pctD == null ? 'n/d' : (pctD >= 0 ? '+' : '') + pctD.toFixed(1) + '%'}  ` +
                `${exceeds == null ? '' : exceeds ? '[supera il rumore]' : '[dentro il rumore]'}`
            );
        }
        if (a.dnfCount > 0 || c.dnfCount > 0) {
            console.log(`  DNF: A=${a.dnfCount}/${a.repeats}  C=${c.dnfCount}/${c.repeats}`);
        }
    }
}

if (require.main === module) main();

module.exports = { runVariant, computeMetrics, bucketize, makeVariantB, makeVariantC, rawGeometricLookahead, maxLookaheadSamples, branchLabel, runRepeated, mean, stddev, exceedsNoise };
