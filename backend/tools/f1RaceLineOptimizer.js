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
const {
    // Prototipo shape-prior (Rif. audit 2026-07-29, opzione B): riusa la
    // STESSA formula fuori-dentro-fuori già validata per il ramo fallback
    // runtime (apexOffset/cornerApexNear) come punto di PARTENZA per
    // l'ottimizzatore, invece di zero ovunque — nessuna nuova formula
    // geometrica inventata qui. BOT_CURVATURE_LOCAL_M/BOT_APEX_MAX_FRACTION
    // esportate apposta da f1Bot.js (additivo, comportamento runtime
    // invariato) per non reinventare gli stessi numeri con un altro nome.
    apexOffset, BOT_CURVATURE_LOCAL_M, BOT_APEX_MAX_FRACTION,
    // Fase 1 — cervello di guida unificato (Rif.
    // docs/superpowers/specs/2026-08-04-f1-bot-unified-driving-policy-design.md):
    // la STESSA funzione usata dal bot in gara valuta ogni candidata di
    // linea, invece di una copia separata (steerTowardGain/cornerTargetSpeed
    // a mano, rimossa in questo task).
    computeSoloRacingLineInputs, BOT_GRIP_CAPACITY_EXPONENT
} = require("../sockets/games/f1Bot.js");
const TrackGeometry = require("../../frontend/shared/trackGeometry.js");

function buildOptimizer(track) {
    const n = track.points.length;
    const metersPerSample = track.lapLength / n;
    const MAX_OFFSET = track.roadHalf * 0.97;   // 1.0 introduce rumore vicino al bordo, 0.85 è troppo prudente — vedi report

    function metersToSamples(meters) { return Math.max(1, Math.round(meters * n / track.lapLength)); }

    // ====================================================
    // PROTOTIPO SHAPE-PRIOR (opzione B, Rif. audit 2026-07-29): inizializza
    // lineControls con la stessa forma fuori-dentro-fuori già validata a
    // runtime per il ramo fallback (apexOffset/cornerApexNear), invece di
    // zero ovunque — l'ottimizzazione sotto (fitness/coordinate
    // descent/basin-hopping) resta ESATTAMENTE la stessa, cambia solo il
    // punto di partenza. Nessuna nuova formula geometrica: stessa identica
    // funzione già usata dal bot quando la pista non ha una racing line.
    //
    // Raggio di ricerca dell'apice: stesso ordine di grandezza della
    // distanza di frenata nel caso peggiore già usata a runtime per
    // scanSamples (v²/2·decel — vedi cornerTargetSpeed/simulateWithRacingLine
    // sotto), qui calcolato una sola volta perché il seeding non ha un
    // contesto di velocità per-tick (è una passata geometrica statica prima
    // di qualunque simulazione).
    // ====================================================
    const SEED_MAX_SPEED = physics.effectiveMaxSpeed({ compound: "medium", tyreWear: 0 }, true);
    const SEED_BRAKE_DECEL = physics.ACCEL * physics.BRAKE_MULT;
    const SEED_SEARCH_SAMPLES = metersToSamples((SEED_MAX_SPEED * SEED_MAX_SPEED) / (2 * SEED_BRAKE_DECEL) * 1.2);
    const SEED_LOCAL_SAMPLES = metersToSamples(BOT_CURVATURE_LOCAL_M);

    function seedGeometricLine(numControls) {
        const line = new Array(numControls);
        for (let c = 0; c < numControls; c++) {
            const idx = Math.round(c * n / numControls) % n;
            const off = apexOffset(track.points, idx, SEED_SEARCH_SAMPLES, SEED_LOCAL_SAMPLES, metersPerSample, track.roadHalf, BOT_APEX_MAX_FRACTION);
            const normal = TrackGeometry.normalAt(track.points, idx, true);
            const scalarOffset = off.dx * normal.nx + off.dz * normal.nz;
            line[c] = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, scalarOffset));
        }
        return line;
    }

    // Catmull-Rom uniforme 1D — DEVE restare identica a interpolateLineControls
    // in trackLoader.js (Rif. commento lì): l'ottimizzatore deve valutare
    // esattamente la stessa curva che il bot seguirà in gara, altrimenti la
    // fitness misurata qui non corrisponde al comportamento reale.
    function catmullRom1D(p0, p1, p2, p3, t) {
        const t2 = t * t, t3 = t2 * t;
        return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    }

    function interpolateControls(controls, targetLen) {
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
        // Vista del tracciato con la linea CANDIDATA come racingLine: stesso
        // oggetto `track` reale (pitPath/roadHalf/lapLength/points invariati),
        // solo racingLine sostituita — computeSoloRacingLineInputs e
        // adaptiveLookaheadMeters riconoscono il ramo racing-line tramite
        // identità con track.racingLine (Rif. f1Bot.js), quindi la vista deve
        // esporla con questo nome esatto.
        const trackView = { ...track, racingLine };
        const rt = {
            lookaheadTimeS: state.lookaheadTimeS, steerGain: state.steerGain,
            adaptiveLookaheadK: state.adaptiveLookaheadK,
            cornerSpeedMargin: state.cornerSpeedMargin, brakingDistanceMargin: state.brakingDistanceMargin,
            deadband: state.deadband, ramp: state.ramp
        };
        const brakeDecel = physics.ACCEL * physics.BRAKE_MULT;
        const checkpointWindow = physics.checkpointWindowFor(track);
        const finishWindow = physics.finishWindowFor(track);
        const maxTicks = Math.round((safetyCapS || 90) * 1000 / physics.PHYSICS_TICK_MS);
        let checkpointA = false, inFinishZone = false;

        for (let tick = 0; tick < maxTicks; tick++) {
            const maxSpeed = physics.effectiveMaxSpeed(p, true);
            const gripCapacityFactor = Math.pow(physics.corneringCapacity(p, true, maxSpeed), BOT_GRIP_CAPACITY_EXPONENT);
            const solo = computeSoloRacingLineInputs(p, trackView, rt, maxSpeed, brakeDecel, physics.TURN_SPEED_HIGH, gripCapacityFactor);

            const err = (p.speed - solo.targetSpeed) / maxSpeed;
            let throttle = 0, brake = 0;
            if (err > rt.deadband) brake = Math.min(1, (err - rt.deadband) / rt.ramp);
            else if (err < -rt.deadband) throttle = Math.min(1, (-err - rt.deadband) / rt.ramp);
            p.inputs = { throttle, brake, steer: solo.steer };

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
        list.push({ get: () => state.adaptiveLookaheadK, set: v => { state.adaptiveLookaheadK = v; }, min: 0.02, max: 0.4, isLine: false });
        // Limiti ampliati (Task 11, chiusura gap dall'umano): margine=1.0 era
        // il limite geometrico ESATTO, ma la velocità reale insegue l'angolo
        // con un filtro (GRIP<1 in updateVelocity — vedi commento su
        // BOT_CORNER_SPEED_MARGIN in f1Bot.js), quindi il raggio davvero
        // percorso è un po' più ampio di quello puramente geometrico: c'è
        // margine fisico per spingersi leggermente oltre 1.0/sotto 0.85 in
        // sicurezza. Va verificato per ogni pista con f1LapSimulator.js
        // (nessun DNF/testacoda) prima di accettare un valore fuori dal
        // vecchio range — non un ampliamento a sensazione.
        list.push({ get: () => state.cornerSpeedMargin, set: v => { state.cornerSpeedMargin = v; }, min: 0.80, max: 1.15, isLine: false });
        list.push({ get: () => state.brakingDistanceMargin, set: v => { state.brakingDistanceMargin = v; }, min: 0.75, max: 1.4, isLine: false });
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
        return { line: s.line.slice(), lookaheadTimeS: s.lookaheadTimeS, steerGain: s.steerGain, adaptiveLookaheadK: s.adaptiveLookaheadK, cornerSpeedMargin: s.cornerSpeedMargin, brakingDistanceMargin: s.brakingDistanceMargin, deadband: s.deadband, ramp: s.ramp };
    }

    function optimize(hops, log, opts) {
        opts = opts || {};
        const seedGeometric = !!opts.seedGeometric;
        // Iterazione 2 (prototipo, Rif. audit 2026-07-29): invece di seminare
        // SOLO i 15 punti iniziali (poi solo interpolati linearmente ai
        // livelli successivi), ri-proietta apexOffset DIRETTAMENTE alla
        // risoluzione di ogni nuovo livello — più punti di controllo = più
        // fedeltà alla forma fuori-dentro-fuori anche sulle curve brevi, che
        // a 15 punti/giro possono non avere nemmeno un punto di controllo
        // dedicato. fitness/coordinateDescent/smoothing/budget invariati,
        // cambia solo la fonte di state.line ad ogni transizione di livello.
        const seedMultiResolution = !!opts.seedMultiResolution;
        let state, best;
        // Ripresa da checkpoint (Rif. richiesta utente, run interrotto a
        // metà): salta seeding+LEVELS, che hanno già fatto il loro lavoro
        // nel run originale — riparte direttamente nel loop di basin-hopping
        // con la linea/tuning esatti del checkpoint. `best` è SEMPRE
        // ricalcolato con `fitness`, mai preso dal campo `timeMs` del file
        // (Rif. feedback_background_process_verify_before_trust: non
        // fidarsi di un valore salvato senza riverificarlo).
        if (opts.resumeState) {
            state = cloneState(opts.resumeState);
            best = fitness(state);
            log(`Ripreso da checkpoint: ${best}ms`);
        } else {
            state = {
                line: (seedGeometric || seedMultiResolution) ? seedGeometricLine(LEVELS[0].numControls) : new Array(LEVELS[0].numControls).fill(0),
                lookaheadTimeS: 0.6, steerGain: 3.0, adaptiveLookaheadK: 0.1,
                cornerSpeedMargin: 0.99, brakingDistanceMargin: 1.2,
                deadband: 0.01, ramp: 0.06
            };
            best = fitness(state);
            const seedLabel = seedMultiResolution
                ? "seed geometrico multi-risoluzione (apexOffset ad ogni livello)"
                : seedGeometric
                    ? "seed geometrico fuori-dentro-fuori (apexOffset, solo 15 punti iniziali)"
                    : "centro pista";
            log(`Baseline (${seedLabel}, parametri di gioco di default): ${best}ms`);

            for (const level of LEVELS) {
                if (state.line.length !== level.numControls) {
                    state.line = seedMultiResolution
                        ? seedGeometricLine(level.numControls)
                        : interpolateControls(state.line, level.numControls);
                    best = fitness(state);
                }
                best = coordinateDescent(state, best, level.rounds, level.stepFrac, GLOBAL_STEP_FRAC);
                log(`Livello ${level.numControls} punti: ${best}ms  [valutazioni: ${evalCount}]`);
            }
        }
        if (opts.onImprovement) opts.onImprovement(state, best);

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
            if (Math.random() < 0.3) state.adaptiveLookaheadK = Math.max(0.02, Math.min(0.4, state.adaptiveLookaheadK + rand(-0.05, 0.05)));
            if (Math.random() < 0.3) state.cornerSpeedMargin = Math.max(0.80, Math.min(1.15, state.cornerSpeedMargin + rand(-0.08, 0.08)));
            if (Math.random() < 0.3) state.brakingDistanceMargin = Math.max(0.75, Math.min(1.4, state.brakingDistanceMargin + rand(-0.15, 0.15)));

            let f = fitness(state);
            f = coordinateDescent(state, f, 4, 0.15, 0.2);
            if (f < best) {
                best = f;
                log(`Basin-hop ${hop + 1}/${hops}: MIGLIORATO a ${best}ms`);
                if (opts.onImprovement) opts.onImprovement(state, best);
            } else {
                state = snapshot;
            }
        }

        return { state, best, evalCount: () => evalCount };
    }

    // seedGeometricLine/fitness esposte per gli script di verifica del
    // prototipo (Rif. audit 2026-07-29) — non usate dal flusso CLI
    // standard (run/optimize), che restano invariati.
    return { optimize, buildRacingLine, seedGeometricLine, fitness, MAX_OFFSET, n, evalCountRef: () => evalCount };
}

// Stesso identico formato scritto sia dal checkpoint automatico (durante
// l'ottimizzazione, Rif. nota "salva e riprendi") sia dal file finale —
// prima erano due letterali duplicati, uno solo qui evita che divergano.
function serializeRaceline(trackId, state, timeMs, elapsedS) {
    return {
        trackId, timeMs, elapsedS,
        tuning: {
            lookaheadTimeS: state.lookaheadTimeS, steerGain: state.steerGain,
            adaptiveLookaheadK: state.adaptiveLookaheadK,
            cornerSpeedMargin: state.cornerSpeedMargin, brakingDistanceMargin: state.brakingDistanceMargin,
            deadband: state.deadband, ramp: state.ramp
        },
        lineControls: state.line
    };
}

function run(trackId, hops, opts) {
    opts = opts || {};
    const track = loadTrack(trackId);
    const opt = buildOptimizer(track);
    console.log(`\n=== ${trackId} (${track.points.length} campioni, ${track.lapLength.toFixed(0)}m, roadHalf=${track.roadHalf}) ===`);
    const t0 = Date.now();

    // Checkpoint automatico: un run lungo (hops alti) può richiedere
    // decine di minuti, interrompibile in qualunque momento (chiusura
    // terminale/PC) — senza questo, tutto il progresso andava perso perché
    // il file veniva scritto SOLO a fine run (Rif. richiesta utente,
    // interruzione a metà di un run da 200 hop). Scritto ad ogni
    // miglioramento reale, stesso formato del file finale: riprendibile con
    // `--resume=<path>`.
    const outId = `${trackId}${opts.outSuffix || ""}`;
    const checkpointFile = path.join(__dirname, `${outId}-checkpoint.json`);
    const onImprovement = (state, best) => {
        const elapsedS = (Date.now() - t0) / 1000;
        fs.writeFileSync(checkpointFile, JSON.stringify(serializeRaceline(trackId, state, best, elapsedS), null, 2));
    };

    let resumeState = null;
    if (opts.resume) {
        const parsed = JSON.parse(fs.readFileSync(opts.resume, 'utf8'));
        resumeState = {
            line: parsed.lineControls.slice(),
            lookaheadTimeS: parsed.tuning.lookaheadTimeS, steerGain: parsed.tuning.steerGain,
            adaptiveLookaheadK: parsed.tuning.adaptiveLookaheadK,
            cornerSpeedMargin: parsed.tuning.cornerSpeedMargin, brakingDistanceMargin: parsed.tuning.brakingDistanceMargin,
            deadband: parsed.tuning.deadband, ramp: parsed.tuning.ramp
        };
        console.log(`[${trackId}] ripreso da ${opts.resume} (era a ${parsed.timeMs}ms) — ${hops} hop aggiuntivi da qui`);
    }

    const { state, best } = opt.optimize(hops, msg => console.log(`[${trackId}] ${msg}`), { ...opts, resumeState, onImprovement });
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
    console.log(`[${trackId}] lookaheadTimeS=${state.lookaheadTimeS.toFixed(3)} steerGain=${state.steerGain.toFixed(3)} adaptiveLookaheadK=${state.adaptiveLookaheadK.toFixed(3)} cornerSpeedMargin=${state.cornerSpeedMargin.toFixed(3)} brakingDistanceMargin=${state.brakingDistanceMargin.toFixed(3)} deadband=${state.deadband.toFixed(4)} ramp=${state.ramp.toFixed(3)}`);
    console.log(`[${trackId}] offset laterale massimo: ${maxLat.toFixed(2)}m (limite ${opt.MAX_OFFSET.toFixed(2)}m, roadHalf ${track.roadHalf}m)`);

    // outSuffix (prototipo shape-prior, opzione B): scrive in un file
    // SEPARATO da "<trackId>-raceline.json" quando specificato — non tocca
    // mai il file di produzione a meno che l'utente non lo scelga esplicitamente
    // passando lo stesso nome. Formato del file identico in ogni caso
    // (nessuna modifica al formato raceline.json, come richiesto).
    const outFile = path.join(__dirname, `${outId}-raceline.json`);
    fs.writeFileSync(outFile, JSON.stringify(serializeRaceline(trackId, state, best, elapsedS), null, 2));
    console.log(`[${trackId}] scritto ${outFile}`);
    // Il checkpoint ha svolto il suo scopo (run completato normalmente,
    // risultato finale già scritto sopra) — rimosso per non lasciare due
    // file quasi identici a fine run.
    if (fs.existsSync(checkpointFile)) fs.unlinkSync(checkpointFile);
}

function parseArgs(argv) {
    const trackIds = [];
    let hops = 30;
    // Default true (Rif. audit 2026-08-07): semina la forma geometrica
    // fuori-dentro-fuori (apexOffset) UNA SOLA VOLTA, al livello più
    // grezzo (15 punti) — ai livelli successivi la linea eredita il
    // risultato del livello precedente (interpolato alla risoluzione
    // nuova), MAI ricalcolata da zero. `--seed-geometric=0` per tornare a
    // partire dal centro pista (solo per confronto).
    let seedGeometric = true;
    // Default false: ricalcolare la forma geometrica ad ogni livello
    // (15/35/70/140) butta via tutto il lavoro di coordinate descent fatto
    // al livello precedente, lasciando solo 8 round di rifinitura locale
    // per ricostruirlo da un seed grezzo che spesso non vede nemmeno la
    // curva (apexOffset usa scanSamples tarati sulla velocità, non sempre
    // sufficienti a quella risoluzione) — misurato su `prova`: risultato
    // quasi piatto, offset laterale mai oltre ~3m anche su un tornante
    // vero. Con `seedMultiResolution=false` (eredita, non ricalcola) la
    // stessa pista, stessa fisica, zero basin-hopping: 49950ms contro
    // 52800ms (-5.4%), linea che usa davvero tutta la larghezza pista
    // (fino a 11.02m su un limite di 10.67m). `--seed-multi-resolution`
    // per tornare al comportamento precedente (solo per confronto).
    let seedMultiResolution = false;
    let outSuffix = "";
    let resume = null;
    for (const arg of argv) {
        if (arg.startsWith("--hops=")) hops = Number(arg.slice("--hops=".length));
        else if (arg === "--seed-geometric") seedGeometric = true;
        else if (arg === "--seed-geometric=0") seedGeometric = false;
        else if (arg === "--seed-multi-resolution") seedMultiResolution = true;
        else if (arg === "--seed-multi-resolution=0") seedMultiResolution = false;
        else if (arg.startsWith("--out-suffix=")) outSuffix = arg.slice("--out-suffix=".length);
        else if (arg.startsWith("--resume=")) resume = arg.slice("--resume=".length);
        else trackIds.push(arg);
    }
    return { trackIds, hops, seedGeometric, seedMultiResolution, outSuffix, resume };
}

if (require.main === module) {
    const { trackIds, hops, seedGeometric, seedMultiResolution, outSuffix, resume } = parseArgs(process.argv.slice(2));
    if (trackIds.length === 0) {
        console.error("Uso: node backend/tools/f1RaceLineOptimizer.js <trackId> [<trackId> ...] [--hops=N] [--seed-geometric=0] [--seed-multi-resolution] [--out-suffix=-seeded] [--resume=<path-checkpoint.json>]");
        process.exitCode = 1;
    } else {
        // --resume ha senso solo per UNA pista alla volta (il checkpoint è
        // specifico di un run) — se l'utente passa più trackId con --resume,
        // verrebbe applicato (erroneamente) a ognuno: non un caso d'uso
        // previsto, ma non vale la pena bloccarlo esplicitamente per un
        // tool interno a un solo utente.
        for (const id of trackIds) run(id, hops, { seedGeometric, seedMultiResolution, outSuffix, resume });
    }
}

module.exports = { buildOptimizer, run };
