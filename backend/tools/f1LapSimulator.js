// backend/tools/f1LapSimulator.js
//
// Simulatore headless di un giro di qualifica in solitaria: riproduce
// tick-by-tick la STESSA sequenza fisica di tickGame() in
// backend/sockets/games/f1GameSocket.js (nessuna reimplementazione — vedi
// docs/superpowers/specs/2026-07-24-f1-bot-lap-simulator-design.md), per
// misurare il tempo sul giro di un bot su qualunque pista senza bisogno di
// un browser.
const path = require('path');
const fs = require('fs');
const { physics } = require('../sockets/games/f1GameSocket.js');
const { updateBotInputs } = require('../sockets/games/f1Bot.js');
const { loadTrack, listTracks } = require('../sockets/games/trackLoader.js');

function makeSimPlayer(track, opts) {
    return {
        color: 'SIM',
        x: track.qualiSpawn.x, z: track.qualiSpawn.z, angle: track.qualiSpawn.angle,
        speed: 0, vx: 0, vz: 0,
        inputs: { throttle: 0, brake: 0, steer: 0 },
        finished: false, time: null, lap: 0,
        checkpointA: false, inFinishZone: false,
        trackIndex: 0,
        compound: 'medium', tyreWear: 0,
        pitting: false, pitPhase: null, pitAutoState: null,
        isBot: true,
        botSpeedFactor: opts.speedFactor,
        botLapPaceMult: opts.paceMult,
        botPrecisionNoise: opts.precisionNoise,
        botOvertakeSide: 1,
        botHeadingToPits: false,
        botPitReactionScheduled: false,
        botLapSeen: 0
    };
}

// Un giro di qualifica in solitaria: nessun'altra auto in game.players (in
// quali i bot non rallentano/sorpassano comunque nessuno — vedi `!isQuali`
// in updateBotInputs), quindi un solo player basta a riprodurre il tempo
// che si otterrebbe in partita vera.
function simulateLap(track, opts) {
    const p = makeSimPlayer(track, opts);
    const game = { track, phase: 'qualifying', players: { SIM: p } };
    const deps = {
        effectiveMaxSpeed: physics.effectiveMaxSpeed,
        handlePitReactionPress: () => {},
        io: { to: () => ({ emit: () => {} }) },
        lobbyId: 'sim',
        wearLapsAtMedium: 5,
        accel: physics.ACCEL,
        brakeMult: physics.BRAKE_MULT,
        turnRateHigh: physics.TURN_SPEED_HIGH,
        tuning: opts.tuning
    };

    const n = track.points.length;
    const checkpointWindow = physics.checkpointWindowFor(track);
    const finishWindow = physics.finishWindowFor(track);
    const maxTicks = Math.round((opts.safetyCapS || 60) * 1000 / physics.PHYSICS_TICK_MS);
    const telemetry = [];

    for (let tick = 0; tick < maxTicks; tick++) {
        updateBotInputs(game, deps);
        physics.updateVelocity(p, true, 1);
        for (let s = 0; s < physics.COLLISION_SUBSTEPS; s++) {
            physics.integratePosition(p, 1 / physics.COLLISION_SUBSTEPS);
            physics.applyBridgeBarrier(p, track);
        }
        physics.applyOffTrackDrag(p, track);
        physics.updateTrackIndex(p, track);

        const idx = p.trackIndex || 0;
        // distanceFromRacingLine/headingVsTangentDeg: già calcolati SOLA
        // LETTURA da updateBotInputs (vedi trajectoryDiagnostics in
        // f1Bot.js) — qui solo catturati per l'esperimento di ablation
        // controller-vs-linea (Rif. audit 2026-07-29), nessun ricalcolo.
        telemetry.push({
            tick, idx, speedKmh: Math.abs(p.speed) * 55, x: p.x, z: p.z,
            distanceFromRacingLine: p._botDebug ? p._botDebug.distanceFromRacingLine : null,
            headingVsTangentDeg: p._botDebug ? p._botDebug.headingVsTangentDeg : null
        });

        if (!p.checkpointA && physics.circularWithin(idx, physics.HALF_LAP_IDX, n, checkpointWindow)) {
            p.checkpointA = true;
        }
        const inFinishZone = physics.circularWithin(idx, 0, n, finishWindow);
        if (p.checkpointA && inFinishZone && !p.inFinishZone) {
            p.finished = true;
            p.time = (tick + 1) * physics.PHYSICS_TICK_MS;
            p.inFinishZone = inFinishZone;
            break;
        }
        p.inFinishZone = inFinishZone;
    }

    return { finished: p.finished, timeMs: p.time, telemetry };
}

// Raggruppa la telemetria in "bucket" di 20 campioni (~2% di un giro
// campionato a 1000 punti) prima di ordinare per velocità crescente: senza
// il raggruppamento, i tick consecutivi nello stesso punto di minimo
// velocità (la stessa curva) riempirebbero da soli tutta la classifica.
function slowestPoints(telemetry, track, count) {
    const sorted = [...telemetry].sort((a, b) => a.speedKmh - b.speedKmh);
    const seenBuckets = new Set();
    const result = [];
    for (const t of sorted) {
        const bucket = Math.round(t.idx / 20);
        if (seenBuckets.has(bucket)) continue;
        seenBuckets.add(bucket);
        result.push({
            pctLap: ((t.idx / track.points.length) * 100).toFixed(1),
            speedKmh: t.speedKmh.toFixed(1)
        });
        if (result.length >= count) break;
    }
    return result;
}

// Margini rilassati al limite: quanto tempo si guadagna solo togliendo la
// prudenza (a parità di algoritmo/traiettoria) — vedi la spec per perché non
// è un tempo-limite teorico assoluto, solo un confronto "prudenza vs resto".
//
// ATTENZIONE (scoperta investigando un DNF su monte-rosso, 2026-07-24):
// NON è garantito che questo preset sia sempre uguale o più veloce del
// default — isolando i tre margini uno alla volta su tutte e 6 le piste:
//
// - cornerSpeedMargin=1.0 e brakingDistanceMargin=1.0, presi da soli, non
//   causano mai un blocco, ma su test-bot cornerSpeedMargin=1.0 da solo è
//   PIÙ LENTO del default (33100ms vs 32250ms): entrare in curva alla
//   velocità geometrica esatta (senza il margine che compensa lo scarto tra
//   raggio geometrico e raggio realmente percorso, vedi BOT_CORNER_SPEED_MARGIN
//   in f1Bot.js) può far allargare l'auto quel tanto che basta da costare più
//   tempo in correzione di quanto se ne guadagni in ingresso.
// - apexMaxFraction=1.0 da solo blocca il bot su monte-rosso (nessun altro
//   caso di blocco trovato sulle 6 piste attuali): tagliare fino al 100%
//   della mezza larghezza pista può spostare il punto mirato oltre la
//   geometria reale di una curva abbastanza stretta, producendo
//   un'oscillazione di sterzo che non si risolve mai (indice pista
//   congelato, velocità che oscilla senza mai avanzare). Il tetto di 0.85
//   usato in partita non è solo prudenza: previene anche questo overshoot
//   geometrico.
// - la combinazione di tutti e tre (questo preset) è più lenta del default
//   anche su test-bot (32700ms vs 32250ms), pur senza bloccarsi.
//
// Chi usa questo preset su una pista nuova deve aspettarsi sia "NON
// completato" sia tempi peggiori del default, non solo tempi uguali o
// migliori — non è un bug del simulatore, è un limite reale dell'algoritmo
// di taglio curva/margine su certe geometrie (vedi
// docs/superpowers/plans/2026-07-24-f1-bot-lap-simulator.md).
const ZERO_MARGIN_TUNING = { cornerSpeedMargin: 1.0, apexMaxFraction: 1.0, brakingDistanceMargin: 1.0 };

function parseArgs(argv) {
    const args = {
        trackId: null, allTracks: false, preset: 'default',
        speedFactor: 1, paceMult: 1, precisionNoise: 0,
        safetyCapS: 60, slowestCount: 5
    };
    for (const arg of argv) {
        if (arg === '--all-tracks') args.allTracks = true;
        else if (arg.startsWith('--preset=')) args.preset = arg.slice('--preset='.length);
        else if (arg.startsWith('--speed-factor=')) args.speedFactor = Number(arg.slice('--speed-factor='.length));
        else if (arg.startsWith('--pace-mult=')) args.paceMult = Number(arg.slice('--pace-mult='.length));
        else if (arg.startsWith('--precision-noise=')) args.precisionNoise = Number(arg.slice('--precision-noise='.length));
        else if (arg.startsWith('--safety-cap=')) args.safetyCapS = Number(arg.slice('--safety-cap='.length));
        else if (!arg.startsWith('--')) args.trackId = arg;
    }
    return args;
}

function runOne(trackId, args) {
    const track = loadTrack(trackId);
    const tuning = args.preset === 'zero-margin' ? ZERO_MARGIN_TUNING : undefined;
    const result = simulateLap(track, {
        speedFactor: args.speedFactor, paceMult: args.paceMult, precisionNoise: args.precisionNoise,
        safetyCapS: args.safetyCapS, tuning
    });
    return { trackId, track, ...result };
}

function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.allTracks) {
        const rows = listTracks().map(t => runOne(t.id, args));
        console.log('Pista'.padEnd(16), 'Tempo(ms)'.padEnd(10), 'Finito'.padEnd(7), 'Curva peggiore');
        for (const r of rows) {
            const worst = r.finished ? slowestPoints(r.telemetry, r.track, 1)[0] : null;
            const worstStr = worst ? `${worst.pctLap}% giro @ ${worst.speedKmh}km/h` : '-';
            console.log(r.trackId.padEnd(16), String(r.timeMs ?? '-').padEnd(10), (r.finished ? 'si' : 'NO').padEnd(7), worstStr);
        }
        return;
    }

    if (!args.trackId) {
        console.error('Uso: node backend/tools/f1LapSimulator.js <trackId> [--preset=zero-margin] [--all-tracks] [--speed-factor=N] [--pace-mult=N] [--precision-noise=N] [--safety-cap=SECONDI]');
        process.exitCode = 1;
        return;
    }

    const r = runOne(args.trackId, args);
    if (!r.finished) {
        console.log(`${args.trackId}: NON completato entro ${args.safetyCapS}s simulati`);
        return;
    }
    console.log(`${args.trackId}: giro completato in ${r.timeMs}ms (${(r.timeMs / 1000).toFixed(2)}s)`);
    console.log('Curve piu lente:');
    for (const s of slowestPoints(r.telemetry, r.track, args.slowestCount)) {
        console.log(`  ${s.pctLap}% giro: ${s.speedKmh} km/h`);
    }

    const outFile = path.join(__dirname, `${args.trackId}-telemetry.json`);
    fs.writeFileSync(outFile, JSON.stringify(r.telemetry, null, 2));
    console.log(`Telemetria completa scritta in ${outFile}`);
}

if (require.main === module) main();

module.exports = { simulateLap, slowestPoints, parseArgs };
