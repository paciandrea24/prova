// backend/tools/f1RaceLineOptimizer.js
//
// Trova, per una pista data, una racing line (offset laterale rispetto al
// centro pista, punto per punto) + i parametri di sterzo/frenata che
// minimizzano il tempo sul giro — con la fisica ESATTA del gioco (stessa
// che vale per un umano, nessuna scorciatoia). Sostituisce il calcolo
// geometrico dell'apice a runtime (apexOffset/cornerApexNear, fragile sulle
// chicane strette — vedi
// docs/superpowers/specs/2026-07-24-f1-bot-cornering-redesign-design.md)
// con una linea già pronta, calcolata UNA TANTUM offline: a runtime il bot
// farebbe solo un lookup + inseguimento (pure pursuit), zero geometria
// live.
//
// Uso: node backend/tools/f1RaceLineOptimizer.js <trackId> [--hops=N]
// Scrive backend/tools/<trackId>-raceline.json con la linea e i parametri
// trovati — non tocca il comportamento del gioco (nessuna integrazione,
// solo generazione dati per revisione).
const fs = require("fs");
const path = require("path");
const { loadTrack } = require("../sockets/games/trackLoader.js");
const { physics } = require("../sockets/games/f1GameSocket.js");
const { cornerTargetSpeed, lookaheadIndex, normalizeAngle } = require("../sockets/games/f1Bot.js");
const TrackGeometry = require("../../frontend/shared/trackGeometry.js");

function steerTowardGain(px, pz, angle, tx, tz, gain) {
    const dx = tx - px, dz = tz - pz;
    if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return 0;
    const desired = Math.atan2(dx, dz);
    const diff = normalizeAngle(desired - angle);
    return Math.max(-1, Math.min(1, diff * gain));
}

function buildOptimizer(track) {
    const n = track.points.length;
    const metersPerSample = track.lapLength / n;
    const MAX_OFFSET = track.roadHalf * 0.97;   // 1.0 introduce rumore vicino al bordo, 0.85 è troppo prudente — vedi report

    function metersToSamples(meters) { return Math.max(1, Math.round(meters * n / track.lapLength)); }

    function interpolateControls(controls, targetLen) {
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

    function buildRacingLine(lineControls) {
        const offsets = interpolateControls(lineControls, n);
        const line = new Array(n);
        for (let i = 0; i < n; i++) {
            const normal = TrackGeometry.normalAt(track.points, i, true);
            const p = track.points[i];
            line[i] = { x: p.x + normal.nx * offsets[i], z: p.z + normal.nz * offsets[i] };
        }
        return line;
    }

    function simulateWithRacingLine(state, racingLine, safetyCapS) {
        const p = {
            x: track.qualiSpawn.x, z: track.qualiSpawn.z, angle: track.qualiSpawn.angle,
            speed: 0, vx: 0, vz: 0, inputs: { throttle: 0, brake: 0, steer: 0 },
            trackIndex: 0, compound: "medium", tyreWear: 0
        };
        const brakeDecel = physics.ACCEL * physics.BRAKE_MULT;
        const checkpointWindow = physics.checkpointWindowFor(track);
        const finishWindow = physics.finishWindowFor(track);
        const maxTicks = Math.round((safetyCapS || 90) * 1000 / physics.PHYSICS_TICK_MS);
        let checkpointA = false, inFinishZone = false;

        for (let tick = 0; tick < maxTicks; tick++) {
            const maxSpeed = physics.effectiveMaxSpeed(p, true);
            const speedMs = Math.max(5, Math.abs(p.speed) * 55 / 3.6);
            const lookM = Math.max(10, speedMs * state.lookaheadTimeS);
            const lookSamples = metersToSamples(lookM);
            const localSamples = metersToSamples(12);
            const targetIdx = lookaheadIndex(n, p.trackIndex || 0, lookSamples);
            const target = racingLine[targetIdx];

            const steer = steerTowardGain(p.x, p.z, p.angle, target.x, target.z, state.steerGain);
            const scanM = (maxSpeed * maxSpeed) / (2 * brakeDecel) * state.brakingDistanceMargin;
            const scanSamples = metersToSamples(scanM);
            const targetSpeed = cornerTargetSpeed(
                racingLine, p.trackIndex || 0, scanSamples, localSamples, metersPerSample,
                p.speed, maxSpeed, brakeDecel, physics.TURN_SPEED_HIGH, state.cornerSpeedMargin
            );

            const err = (p.speed - targetSpeed) / maxSpeed;
            let throttle = 0, brake = 0;
            if (err > state.deadband) brake = Math.min(1, (err - state.deadband) / state.ramp);
            else if (err < -state.deadband) throttle = Math.min(1, (-err - state.deadband) / state.ramp);
            p.inputs = { throttle, brake, steer };

            physics.updateVelocity(p, true, 1);
            for (let s = 0; s < physics.COLLISION_SUBSTEPS; s++) {
                physics.integratePosition(p, 1 / physics.COLLISION_SUBSTEPS);
                physics.applyBridgeBarrier(p, track);
            }
            physics.applyOffTrackDrag(p, track);
            physics.updateTrackIndex(p, track);

            const idx = p.trackIndex || 0;
            if (!checkpointA && physics.circularWithin(idx, physics.HALF_LAP_IDX, n, checkpointWindow)) checkpointA = true;
            const nowFinish = physics.circularWithin(idx, 0, n, finishWindow);
            if (checkpointA && nowFinish && !inFinishZone) return (tick + 1) * physics.PHYSICS_TICK_MS;
            inFinishZone = nowFinish;
        }
        return null;
    }

    let evalCount = 0;
    function fitness(state) {
        evalCount++;
        const line = buildRacingLine(state.line);
        const t = simulateWithRacingLine(state, line, 90);
        return t == null ? 1e9 : t;
    }

    function paramList(state) {
        const list = [];
        for (let i = 0; i < state.line.length; i++) {
            list.push({ get: () => state.line[i], set: v => { state.line[i] = v; }, min: -MAX_OFFSET, max: MAX_OFFSET, isLine: true });
        }
        list.push({ get: () => state.lookaheadTimeS, set: v => { state.lookaheadTimeS = v; }, min: 0.25, max: 1.3, isLine: false });
        list.push({ get: () => state.steerGain, set: v => { state.steerGain = v; }, min: 1.0, max: 7.0, isLine: false });
        list.push({ get: () => state.cornerSpeedMargin, set: v => { state.cornerSpeedMargin = v; }, min: 0.80, max: 1.0, isLine: false });
        list.push({ get: () => state.brakingDistanceMargin, set: v => { state.brakingDistanceMargin = v; }, min: 0.85, max: 1.4, isLine: false });
        list.push({ get: () => state.deadband, set: v => { state.deadband = v; }, min: 0.0, max: 0.06, isLine: false });
        list.push({ get: () => state.ramp, set: v => { state.ramp = v; }, min: 0.02, max: 0.18, isLine: false });
        return list;
    }

    function coordinateDescent(state, startFit, rounds, lineStepFrac, globalStepFrac) {
        let best = startFit;
        let lineStep = lineStepFrac, globalStep = globalStepFrac;
        for (let round = 0; round < rounds; round++) {
            const params = paramList(state);
            for (const param of params) {
                const halfRange = (param.max - param.min) / 2;
                const step = (param.isLine ? lineStep : globalStep) * halfRange;
                const original = param.get();
                let bestLocal = original, bestLocalFit = best;
                for (const delta of [step, -step]) {
                    const candidate = Math.max(param.min, Math.min(param.max, original + delta));
                    param.set(candidate);
                    const f = fitness(state);
                    if (f < bestLocalFit) { bestLocalFit = f; bestLocal = candidate; }
                }
                param.set(bestLocal);
                if (bestLocalFit < best) best = bestLocalFit;
            }
            const m = state.line.length;
            for (let i = 0; i < m; i++) {
                const prev = state.line[(i - 1 + m) % m];
                const next = state.line[(i + 1) % m];
                const smoothed = (prev + state.line[i] * 2 + next) / 4;
                const original = state.line[i];
                state.line[i] = smoothed;
                const f = fitness(state);
                if (f < best) best = f; else state.line[i] = original;
            }
            lineStep *= 0.72;
            globalStep *= 0.8;
        }
        return best;
    }

    const LEVELS = [
        { numControls: 15, rounds: 10, stepFrac: 0.55 },
        { numControls: 35, rounds: 8, stepFrac: 0.30 },
        { numControls: 70, rounds: 8, stepFrac: 0.18 },
        { numControls: 140, rounds: 8, stepFrac: 0.10 }
    ];
    const GLOBAL_STEP_FRAC = 0.35;

    function rand(min, max) { return min + Math.random() * (max - min); }
    function cloneState(s) {
        return { line: s.line.slice(), lookaheadTimeS: s.lookaheadTimeS, steerGain: s.steerGain, cornerSpeedMargin: s.cornerSpeedMargin, brakingDistanceMargin: s.brakingDistanceMargin, deadband: s.deadband, ramp: s.ramp };
    }

    function optimize(hops, log) {
        let state = {
            line: new Array(LEVELS[0].numControls).fill(0),
            lookaheadTimeS: 0.6, steerGain: 3.0,
            cornerSpeedMargin: 0.99, brakingDistanceMargin: 1.2,
            deadband: 0.01, ramp: 0.06
        };
        let best = fitness(state);
        log(`Baseline (centro pista, parametri di gioco di default): ${best}ms`);

        for (const level of LEVELS) {
            if (state.line.length !== level.numControls) {
                state.line = interpolateControls(state.line, level.numControls);
                best = fitness(state);
            }
            best = coordinateDescent(state, best, level.rounds, level.stepFrac, GLOBAL_STEP_FRAC);
            log(`Livello ${level.numControls} punti: ${best}ms  [valutazioni: ${evalCount}]`);
        }

        for (let hop = 0; hop < hops; hop++) {
            const snapshot = cloneState(state);
            const m = state.line.length;
            const spanStart = Math.floor(Math.random() * m);
            const spanLen = Math.floor(rand(m * 0.05, m * 0.2));
            const jump = rand(-MAX_OFFSET * 0.7, MAX_OFFSET * 0.7);
            for (let k = 0; k < spanLen; k++) {
                const idx = (spanStart + k) % m;
                state.line[idx] = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, state.line[idx] + jump));
            }
            if (Math.random() < 0.3) state.lookaheadTimeS = Math.max(0.25, Math.min(1.3, state.lookaheadTimeS + rand(-0.2, 0.2)));
            if (Math.random() < 0.3) state.steerGain = Math.max(1.0, Math.min(7.0, state.steerGain + rand(-1.2, 1.2)));
            if (Math.random() < 0.3) state.cornerSpeedMargin = Math.max(0.80, Math.min(1.0, state.cornerSpeedMargin + rand(-0.08, 0.08)));
            if (Math.random() < 0.3) state.brakingDistanceMargin = Math.max(0.85, Math.min(1.4, state.brakingDistanceMargin + rand(-0.15, 0.15)));

            let f = fitness(state);
            f = coordinateDescent(state, f, 4, 0.15, 0.2);
            if (f < best) {
                best = f;
                log(`Basin-hop ${hop + 1}/${hops}: MIGLIORATO a ${best}ms`);
            } else {
                state = snapshot;
            }
        }

        return { state, best, evalCount: () => evalCount };
    }

    return { optimize, buildRacingLine, MAX_OFFSET, n, evalCountRef: () => evalCount };
}

function run(trackId, hops) {
    const track = loadTrack(trackId);
    const opt = buildOptimizer(track);
    console.log(`\n=== ${trackId} (${track.points.length} campioni, ${track.lapLength.toFixed(0)}m, roadHalf=${track.roadHalf}) ===`);
    const t0 = Date.now();
    const { state, best } = opt.optimize(hops, msg => console.log(`[${trackId}] ${msg}`));
    const elapsedS = (Date.now() - t0) / 1000;

    const finalLine = opt.buildRacingLine(state.line);
    let maxLat = 0;
    for (let i = 0; i < opt.n; i++) {
        const normal = TrackGeometry.normalAt(track.points, i, true);
        const dx = finalLine[i].x - track.points[i].x, dz = finalLine[i].z - track.points[i].z;
        const lat = Math.abs(dx * normal.nx + dz * normal.nz);
        if (lat > maxLat) maxLat = lat;
    }

    console.log(`[${trackId}] RISULTATO: ${best}ms (${(best / 1000).toFixed(2)}s) in ${elapsedS.toFixed(1)}s di calcolo`);
    console.log(`[${trackId}] lookaheadTimeS=${state.lookaheadTimeS.toFixed(3)} steerGain=${state.steerGain.toFixed(3)} cornerSpeedMargin=${state.cornerSpeedMargin.toFixed(3)} brakingDistanceMargin=${state.brakingDistanceMargin.toFixed(3)} deadband=${state.deadband.toFixed(4)} ramp=${state.ramp.toFixed(3)}`);
    console.log(`[${trackId}] offset laterale massimo: ${maxLat.toFixed(2)}m (limite ${opt.MAX_OFFSET.toFixed(2)}m, roadHalf ${track.roadHalf}m)`);

    const outFile = path.join(__dirname, `${trackId}-raceline.json`);
    fs.writeFileSync(outFile, JSON.stringify({
        trackId, timeMs: best, elapsedS,
        tuning: {
            lookaheadTimeS: state.lookaheadTimeS, steerGain: state.steerGain,
            cornerSpeedMargin: state.cornerSpeedMargin, brakingDistanceMargin: state.brakingDistanceMargin,
            deadband: state.deadband, ramp: state.ramp
        },
        lineControls: state.line
    }, null, 2));
    console.log(`[${trackId}] scritto ${outFile}`);
}

function parseArgs(argv) {
    const trackIds = [];
    let hops = 30;
    for (const arg of argv) {
        if (arg.startsWith("--hops=")) hops = Number(arg.slice("--hops=".length));
        else trackIds.push(arg);
    }
    return { trackIds, hops };
}

if (require.main === module) {
    const { trackIds, hops } = parseArgs(process.argv.slice(2));
    if (trackIds.length === 0) {
        console.error("Uso: node backend/tools/f1RaceLineOptimizer.js <trackId> [<trackId> ...] [--hops=N]");
        process.exitCode = 1;
    } else {
        for (const id of trackIds) run(id, hops);
    }
}

module.exports = { buildOptimizer, run };
