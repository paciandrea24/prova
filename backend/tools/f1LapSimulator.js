// backend/tools/f1LapSimulator.js
//
// Simulatore headless di un giro di qualifica in solitaria: riproduce
// tick-by-tick la STESSA sequenza fisica di tickGame() in
// backend/sockets/games/f1GameSocket.js (nessuna reimplementazione — vedi
// docs/superpowers/specs/2026-07-24-f1-bot-lap-simulator-design.md), per
// misurare il tempo sul giro di un bot su qualunque pista senza bisogno di
// un browser.
const { physics } = require('../sockets/games/f1GameSocket.js');
const { updateBotInputs } = require('../sockets/games/f1Bot.js');

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
        telemetry.push({ tick, idx, speedKmh: Math.abs(p.speed) * 55, x: p.x, z: p.z });

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

module.exports = { simulateLap, slowestPoints };
