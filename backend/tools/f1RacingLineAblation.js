// backend/tools/f1RacingLineAblation.js
//
// Esperimento diagnostico (Rif. punto decisionale 2026-07-29, memory
// project_f1_ia_grip_awareness_testbench): isola quanto pesa il CONTROLLER
// pure-pursuit vs quanto pesa la GEOMETRIA della racing line sull'errore di
// traiettoria misurato su New Monza, PRIMA di scegliere se lavorare prima sul
// controller (B) o sulla generazione offline della linea (A).
//
// Braccio 1 (controller variato, linea INVARIATA): poche varianti
// controllate di racingLineTuning (lookaheadTimeS/steerGain), NON una
// ricerca esaustiva — l'obiettivo è stimare un potenziale massimo, non
// trovare il tuning definitivo.
// Braccio 2 (linea variata, controller INVARIATO): sostituisce la racing
// line ufficiale con una linea geometrica derivata da apexOffset (STESSA
// formula già validata per il ramo fallback runtime e già riusata in
// f1RaceLineOptimizer.js come seed — nessuna nuova euristica geometrica),
// mantenendo il racingLineTuning ufficiale invariato.
//
// Nessun file ufficiale toccato: ogni variante lavora su una COPIA shallow
// dell'oggetto track caricato da loadTrack (stesso pattern anti-mutazione
// già usato da racelineVariant in f1Testbench.js), mai l'oggetto cacheato.
//
// Uso: node backend/tools/f1RacingLineAblation.js [trackId]
const { loadTrack, buildRacingLineFromControls } = require('../sockets/games/trackLoader.js');
const { apexOffset, BOT_CURVATURE_LOCAL_M, BOT_APEX_MAX_FRACTION, DEFAULT_TUNING } = require('../sockets/games/f1Bot.js');
const { physics } = require('../sockets/games/f1GameSocket.js');
const { simulateLap } = require('./f1LapSimulator.js');
const TrackGeometry = require('../../frontend/shared/trackGeometry.js');

function metersToSamples(meters, track) {
    return Math.max(1, Math.round(meters * track.points.length / track.lapLength));
}

// Stessa identica formula di seeding già usata in f1RaceLineOptimizer.js
// (seedGeometricLine): apexOffset campionato su numControls punti (non a
// piena risoluzione — la piena risoluzione produce un offset punto-per-punto
// non garantito continuo, causa di lockup da oscillazione sterzo, vedi
// report esperimento) e poi interpolato da buildRacingLineFromControls,
// stessa tecnica di smoothing già in produzione per le racing line ufficiali.
function buildGeometricLine(track, numControls) {
    const n = track.points.length;
    const metersPerSample = track.lapLength / n;
    const seedMaxSpeed = physics.effectiveMaxSpeed({ compound: 'medium', tyreWear: 0 }, true);
    const seedBrakeDecel = physics.ACCEL * physics.BRAKE_MULT;
    const searchSamples = metersToSamples((seedMaxSpeed * seedMaxSpeed) / (2 * seedBrakeDecel) * 1.2, track);
    const localSamples = metersToSamples(BOT_CURVATURE_LOCAL_M, track);
    const controls = new Array(numControls);
    for (let c = 0; c < numControls; c++) {
        const idx = Math.round(c * n / numControls) % n;
        const off = apexOffset(track.points, idx, searchSamples, localSamples, metersPerSample, track.roadHalf, BOT_APEX_MAX_FRACTION);
        const normal = TrackGeometry.normalAt(track.points, idx, true);
        controls[c] = off.dx * normal.nx + off.dz * normal.nz;
    }
    return buildRacingLineFromControls(track.points, controls);
}

function stats(telemetry) {
    let sumDist = 0, peakDist = 0, sumHead = 0, peakHead = 0, count = 0;
    for (const t of telemetry) {
        if (t.distanceFromRacingLine == null) continue;
        count++;
        sumDist += t.distanceFromRacingLine;
        if (t.distanceFromRacingLine > peakDist) peakDist = t.distanceFromRacingLine;
        const h = Math.abs(t.headingVsTangentDeg);
        sumHead += h;
        if (h > peakHead) peakHead = h;
    }
    return { avgDist: sumDist / count, peakDist, avgHead: sumHead / count, peakHead };
}

function runConfig(label, track, tuningOverride) {
    const r = simulateLap(track, { speedFactor: 1, paceMult: 1, precisionNoise: 0, safetyCapS: 60, tuning: tuningOverride });
    if (!r.finished) {
        console.log(`${label}: NON completato entro il tempo di sicurezza`);
        return null;
    }
    return { label, timeMs: r.timeMs, ...stats(r.telemetry) };
}

// Verifica di generalizzazione (Rif. richiesta utente 2026-07-29): stesso
// Braccio 1 (poche varianti controllate di lookahead/steerGain, linea
// INVARIATA), ma su una pista SENZA racing line precalcolata — esercita il
// ramo geometrico condiviso (apexOffset/cornerApexNear), l'altro grosso
// ramo dello stesso controller, non solo il ramo racing-line già testato su
// New Monza. Qui l'override passa da deps.tuning (DEFAULT_TUNING esteso),
// non da track.racingLineTuning (quel campo non esiste su queste piste).
// Nessun Braccio 2: non c'è una racing line ufficiale da sostituire, il
// fallback qui è già geometrico by design.
function runGeneralizationCheck(trackId) {
    const track = loadTrack(trackId);
    const base = DEFAULT_TUNING;
    const results = [];
    results.push(runConfig('baseline (costanti di default)', track, undefined));
    const b1Variants = [
        { name: 'B1 lookahead dimezzato', tuning: { ...base, lookaheadTimeS: base.lookaheadTimeS * 0.5 } },
        { name: 'B1 steerGain +75%', tuning: { ...base, steerGain: base.steerGain * 1.75 } },
        { name: 'B1 entrambi', tuning: { ...base, lookaheadTimeS: base.lookaheadTimeS * 0.5, steerGain: base.steerGain * 1.75 } }
    ];
    for (const v of b1Variants) {
        results.push(runConfig(v.name, track, v.tuning));
    }
    printReport(trackId, results);
}

function printReport(trackId, results) {
    const base = results[0];
    console.log(`\n=== ${trackId} ===`);
    console.log('config'.padEnd(34), 'tempo(ms)'.padEnd(10), 'distMedia(m)'.padEnd(13), 'distPicco(m)'.padEnd(13), 'headMedio(deg)'.padEnd(15), 'headPicco(deg)');
    for (const r of results) {
        if (!r) continue;
        console.log(
            r.label.padEnd(34), String(r.timeMs).padEnd(10),
            r.avgDist.toFixed(2).padEnd(13), r.peakDist.toFixed(2).padEnd(13),
            r.avgHead.toFixed(2).padEnd(15), r.peakHead.toFixed(2)
        );
    }
    console.log('\nDelta vs baseline:');
    for (const r of results.slice(1)) {
        if (!r || !base) continue;
        console.log(`${r.label}: Δtempo=${r.timeMs - base.timeMs}ms  ΔdistMedia=${(r.avgDist - base.avgDist).toFixed(2)}m  ΔdistPicco=${(r.peakDist - base.peakDist).toFixed(2)}m  ΔheadMedio=${(r.avgHead - base.avgHead).toFixed(2)}°  ΔheadPicco=${(r.peakHead - base.peakHead).toFixed(2)}°`);
    }
}

function main() {
    const trackId = process.argv[2] || 'new-monza';
    const track = loadTrack(trackId);
    if (!track.racingLine) {
        runGeneralizationCheck(trackId);
        return;
    }

    const results = [];
    results.push(runConfig('baseline (ufficiale)', track, undefined));

    const officialTuning = track.racingLineTuning;
    const b1Variants = [
        { name: 'B1 lookahead dimezzato', tuning: { ...officialTuning, lookaheadTimeS: officialTuning.lookaheadTimeS * 0.5 } },
        { name: 'B1 steerGain +75%', tuning: { ...officialTuning, steerGain: officialTuning.steerGain * 1.75 } },
        { name: 'B1 entrambi', tuning: { ...officialTuning, lookaheadTimeS: officialTuning.lookaheadTimeS * 0.5, steerGain: officialTuning.steerGain * 1.75 } }
    ];
    for (const v of b1Variants) {
        results.push(runConfig(v.name, { ...track, racingLineTuning: v.tuning }, undefined));
    }

    for (const numControls of [15, 35, 70, 140]) {
        const geometricLine = buildGeometricLine(track, numControls);
        results.push(runConfig(`B2 linea geometrica (${numControls} controlli)`, { ...track, racingLine: geometricLine }, undefined));
    }

    printReport(trackId, results);
}

if (require.main === module) main();

module.exports = { buildGeometricLine, stats };
