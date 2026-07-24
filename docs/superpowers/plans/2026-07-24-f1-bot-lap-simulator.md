# F1 — simulatore headless di giro per misurare il gap bot vs umano — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Costruire uno strumento headless (nessun browser) che fa girare un bot con la fisica ESATTA del server F1 su una qualunque pista esistente e riporta il tempo sul giro + telemetria per capire dove si perde tempo rispetto all'umano, su tutte le piste, non solo Monza.

**Architecture:** `f1GameSocket.js` espone le sue primitive fisiche pure (costanti + funzioni di velocità/posizione/aderenza) come proprietà aggiuntive del modulo, senza toccare l'handler socket esistente. `f1Bot.js` rende configurabili (invece di hardcoded) i tre margini di taratura rilevanti per il confronto "prudenza vs algoritmo". Un nuovo script standalone in `backend/tools/` riusa entrambi per simulare tick-by-tick un giro di qualifica in solitaria, riproducendo esattamente la sequenza di `tickGame()`.

**Tech Stack:** Node.js puro, `node:test` per i test (nessuna nuova dipendenza).

## Global Constraints

- Niente commit automatici: commit/push sono sempre manuali, a cura dell'utente (convenzione di progetto, CLAUDE.md). Ogni task qui sotto termina con una verifica (`node --test` o esecuzione manuale dello script), MAI con un commit — non eseguire `git commit` in nessuno step.
- Commenti nel codice in italiano (convenzione di progetto).
- Zero duplicazione della fisica: il simulatore riusa le funzioni esportate da `f1GameSocket.js`, non le reimplementa mai.
- Nessuna modifica al comportamento reale dei bot in partita: i default (`DEFAULT_TUNING`, chiamate esistenti in `f1GameSocket.js`) devono restare bit-per-bit identici a oggi — la parametrizzazione è additiva/opzionale.
- Fuori scope per questo piano (fase 2, dopo aver visto i numeri): qualunque modifica al comportamento reale dei bot, riscrittura della traiettoria, tempo-limite teorico indipendente, interfaccia grafica.

---

### Task 1: Esportare le primitive fisiche da `f1GameSocket.js`

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (aggiunta in fondo al file, dopo la riga 1452)
- Test: `backend/sockets/games/f1GameSocket.physics.test.js`

**Interfaces:**
- Consumes: nessuna dipendenza da task precedenti.
- Produces: `require('./f1GameSocket.js').physics` = `{ PHYSICS_TICK_MS, COLLISION_SUBSTEPS, ACCEL, BRAKE_MULT, TURN_SPEED_HIGH, HALF_LAP_IDX, effectiveMaxSpeed(p, isQuali), updateVelocity(p, isQuali, slipstreamMult), integratePosition(p, dt), applyOffTrackDrag(p, track), applyBridgeBarrier(p, track), updateTrackIndex(p, track), circularWithin(idx, target, n, halfWidth), checkpointWindowFor(track), finishWindowFor(track) }` — usato dal Task 3.

- [ ] **Step 1: Scrivere il test che fallisce**

Crea `backend/sockets/games/f1GameSocket.physics.test.js`:

```js
// backend/sockets/games/f1GameSocket.physics.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const f1GameSocket = require('./f1GameSocket.js');

test('f1GameSocket espone .physics con le costanti attese', () => {
    const { physics } = f1GameSocket;
    assert.ok(physics, 'atteso f1GameSocket.physics definito');
    assert.equal(physics.PHYSICS_TICK_MS, 50);
    assert.equal(physics.ACCEL, 0.186);
    assert.equal(physics.BRAKE_MULT, 2.17);
    assert.equal(physics.TURN_SPEED_HIGH, 0.052);
    assert.equal(typeof physics.COLLISION_SUBSTEPS, 'number');
    assert.equal(typeof physics.HALF_LAP_IDX, 'number');
});

test('f1GameSocket.physics espone le funzioni pure attese', () => {
    const { physics } = f1GameSocket;
    for (const name of [
        'effectiveMaxSpeed', 'updateVelocity', 'integratePosition',
        'applyOffTrackDrag', 'applyBridgeBarrier', 'updateTrackIndex',
        'circularWithin', 'checkpointWindowFor', 'finishWindowFor'
    ]) {
        assert.equal(typeof physics[name], 'function', `atteso physics.${name} funzione`);
    }
});

test('effectiveMaxSpeed: in qualifica usa sempre la Soft (speedMult 1.05), a prescindere dalla mescola scelta', () => {
    const { physics } = f1GameSocket;
    const p = { tyreWear: 0, compound: 'hard' };
    const max = physics.effectiveMaxSpeed(p, true);
    assert.ok(Math.abs(max - 6.2 * 1.05) < 1e-9, `atteso ${6.2 * 1.05}, ottenuto ${max}`);
});

test('updateVelocity: da fermo con throttle=1 accelera esattamente di ACCEL in un tick', () => {
    const { physics } = f1GameSocket;
    const p = { inputs: { throttle: 1, brake: 0, steer: 0 }, speed: 0, vx: 0, vz: 0, angle: 0, tyreWear: 0, compound: 'medium' };
    physics.updateVelocity(p, true, 1);
    assert.ok(Math.abs(p.speed - physics.ACCEL) < 1e-9, `atteso ${physics.ACCEL}, ottenuto ${p.speed}`);
});

test('integratePosition: sposta x/z in base a vx/vz e dt', () => {
    const { physics } = f1GameSocket;
    const p = { x: 10, z: 20, vx: 2, vz: -3 };
    physics.integratePosition(p, 0.5);
    assert.ok(Math.abs(p.x - 11) < 1e-9 && Math.abs(p.z - 18.5) < 1e-9, `atteso (11,18.5), ottenuto (${p.x},${p.z})`);
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test backend/sockets/games/f1GameSocket.physics.test.js`
Expected: FAIL — `f1GameSocket.physics` è `undefined` (primo test fallisce su `assert.ok(physics, ...)`, i successivi falliscono a cascata).

- [ ] **Step 3: Aggiungere l'export additivo in fondo a `f1GameSocket.js`**

Aggiungi in fondo al file (dopo la riga 1452, `}` di chiusura di `resetPlayers`):

```js

// ====================================================
// EXPORT PRIMITIVE FISICHE — additivo, non tocca la firma dell'handler
// socket esistente (module.exports resta chiamabile come module.exports(io,
// socket)). Serve a strumenti offline (vedi backend/tools/f1LapSimulator.js)
// che devono riprodurre la fisica ESATTA del server senza duplicarla.
// ====================================================
module.exports.physics = {
    PHYSICS_TICK_MS, COLLISION_SUBSTEPS,
    ACCEL, BRAKE_MULT, TURN_SPEED_HIGH, HALF_LAP_IDX,
    effectiveMaxSpeed, updateVelocity, integratePosition,
    applyOffTrackDrag, applyBridgeBarrier, updateTrackIndex,
    circularWithin, checkpointWindowFor, finishWindowFor
};
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `node --test backend/sockets/games/f1GameSocket.physics.test.js`
Expected: PASS (5 test)

- [ ] **Step 5: Verificare che l'handler socket esistente non sia rotto**

Run: `node --test backend/sockets/games/`
Expected: PASS su tutti i file di test esistenti (`f1Bot.test.js`, `trackLoader.test.js`, `f1GameSocket.physics.test.js`) — nessuna regressione.

---

### Task 2: Rendere configurabili i margini di taratura in `f1Bot.js`

**Files:**
- Modify: `backend/sockets/games/f1Bot.js`
- Test: `backend/sockets/games/f1Bot.test.js` (append)

**Interfaces:**
- Consumes: nessuna dipendenza dal Task 1 (modulo indipendente).
- Produces: `updateBotInputs(game, deps)` accetta ora un `deps.tuning` opzionale (`{ cornerSpeedMargin?, apexMaxFraction?, brakingDistanceMargin? }`) che sovrascrive `DEFAULT_TUNING`; `module.exports.DEFAULT_TUNING` = `{ cornerSpeedMargin: 0.99, apexMaxFraction: 0.85, brakingDistanceMargin: 1.2 }` — usato dal Task 3/4 per il preset `zero-margin`.

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungi in fondo a `backend/sockets/games/f1Bot.test.js` (il file già importa `test`/`assert`/`buildConstantCurveTrack` in cima):

```js
const { updateBotInputs, DEFAULT_TUNING } = require('./f1Bot.js');

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
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: FAIL — `DEFAULT_TUNING` non è esportato (`undefined`), il primo nuovo test fallisce con `TypeError` o `assert.equal(undefined, 0.99)`.

- [ ] **Step 3: Aggiungere `DEFAULT_TUNING` e leggere `deps.tuning` in `updateBotInputs`**

In `backend/sockets/games/f1Bot.js`, subito prima di `function updateBotInputs(game, deps) {` (riga 375 nel file attuale), aggiungi:

```js
// Margini di taratura resi configurabili (invece di sole costanti di modulo)
// per poter confrontare, da uno strumento esterno (vedi
// backend/tools/f1LapSimulator.js), "margini di oggi" vs "margini rilassati"
// sulla stessa pista senza editare questo file. Il call site in
// f1GameSocket.js non passa mai `deps.tuning`, quindi il comportamento in
// partita resta identico a prima di questo cambiamento.
const DEFAULT_TUNING = {
    cornerSpeedMargin:     BOT_CORNER_SPEED_MARGIN,
    apexMaxFraction:       BOT_APEX_MAX_FRACTION,
    brakingDistanceMargin: BOT_BRAKING_DISTANCE_MARGIN
};
```

Poi, dentro `updateBotInputs`, sostituisci la riga di destrutturazione dei `deps`:

```js
    const {
        effectiveMaxSpeed, handlePitReactionPress, io, lobbyId, wearLapsAtMedium,
        accel, brakeMult, turnRateHigh
    } = deps;
```

con:

```js
    const {
        effectiveMaxSpeed, handlePitReactionPress, io, lobbyId, wearLapsAtMedium,
        accel, brakeMult, turnRateHigh, tuning: tuningOverrides
    } = deps;
    const tuning = { ...DEFAULT_TUNING, ...(tuningOverrides || {}) };
```

Poi sostituisci i tre usi diretti delle costanti dentro `updateBotInputs`:

1. `const scanM = (maxSpeed * maxSpeed) / (2 * brakeDecel) * BOT_BRAKING_DISTANCE_MARGIN;`
   → `const scanM = (maxSpeed * maxSpeed) / (2 * brakeDecel) * tuning.brakingDistanceMargin;`

2. `const apex = apexOffset(track.points, targetIdx, localSamples, track.roadHalf * BOT_APEX_MAX_FRACTION);`
   → `const apex = apexOffset(track.points, targetIdx, localSamples, track.roadHalf * tuning.apexMaxFraction);`

3. Nella chiamata a `cornerTargetSpeed(...)`, l'ultimo argomento `BOT_CORNER_SPEED_MARGIN`
   → `tuning.cornerSpeedMargin`

4. `const cornerIsMild = apexMag < track.roadHalf * BOT_APEX_MAX_FRACTION * BOT_OVERTAKE_MAX_CORNER_SEVERITY;`
   → `const cornerIsMild = apexMag < track.roadHalf * tuning.apexMaxFraction * BOT_OVERTAKE_MAX_CORNER_SEVERITY;`

Infine, aggiungi `DEFAULT_TUNING` all'oggetto `module.exports` in fondo al file:

```js
module.exports = {
    PALETTE, MAX_GRID_SIZE, DEFAULT_TUNING,
    normalizeAngle, steerToward, lookaheadIndex, apexOffset, cornerTargetSpeed, overtakeOffset,
    nearestAheadPlayer, pickPostPitCompound, pickBotColors, estimateFinishTime,
    createBots, updateBotInputs
};
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: PASS su tutti i test del file (esistenti + i 2 nuovi) — in particolare i test esistenti su `cornerTargetSpeed`/`apexOffset` (che chiamano le funzioni pure direttamente, non `updateBotInputs`) restano invariati perché quelle funzioni non sono state toccate, solo il modo in cui `updateBotInputs` sceglie quali margini passargli.

- [ ] **Step 5: Verificare che il resto della suite non sia rotto**

Run: `node --test backend/sockets/games/`
Expected: PASS su tutti i file di test.

---

### Task 3: Core del simulatore — `simulateLap()`

**Files:**
- Create: `backend/tools/f1LapSimulator.js`
- Test: `backend/tools/f1LapSimulator.test.js`

**Interfaces:**
- Consumes: `require('../sockets/games/f1GameSocket.js').physics` (Task 1), `require('../sockets/games/f1Bot.js').{ updateBotInputs, DEFAULT_TUNING }` (Task 2), `require('../sockets/games/trackLoader.js').{ loadTrack, listTracks }` (esistente, invariato).
- Produces: `simulateLap(track, opts)` → `{ finished: boolean, timeMs: number|null, telemetry: Array<{tick, idx, speedKmh, x, z}> }`, dove `opts = { speedFactor, paceMult, precisionNoise, safetyCapS, tuning? }`. `slowestPoints(telemetry, track, count)` → `Array<{ pctLap: string, speedKmh: string }>`. Usati dal Task 4 (CLI).

- [ ] **Step 1: Scrivere il test che fallisce**

Crea `backend/tools/f1LapSimulator.test.js`:

```js
// backend/tools/f1LapSimulator.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTrack, listTracks } = require('../sockets/games/trackLoader.js');
const { simulateLap, slowestPoints } = require('./f1LapSimulator.js');

const DEFAULT_OPTS = { speedFactor: 1, paceMult: 1, precisionNoise: 0, safetyCapS: 60 };

for (const { id } of listTracks()) {
    test(`simulateLap: ${id} completa il giro entro il tetto di sicurezza (tuning di default)`, () => {
        const track = loadTrack(id);
        const result = simulateLap(track, DEFAULT_OPTS);
        assert.ok(result.finished, `${id}: giro non completato entro ${DEFAULT_OPTS.safetyCapS}s simulati`);
        assert.ok(result.timeMs > 0, `${id}: tempo non valido (${result.timeMs})`);
        assert.ok(result.telemetry.length > 0, `${id}: telemetria vuota`);
    });
}

test('simulateLap: rispetta un preset di tuning passato in opts.tuning (margini rilassati => non più lento del default)', () => {
    const track = loadTrack('monza');
    const base = simulateLap(track, DEFAULT_OPTS);
    const relaxed = simulateLap(track, {
        ...DEFAULT_OPTS,
        tuning: { cornerSpeedMargin: 1.0, apexMaxFraction: 1.0, brakingDistanceMargin: 1.0 }
    });
    assert.ok(base.finished && relaxed.finished, 'entrambe le simulazioni devono completare il giro');
    assert.ok(relaxed.timeMs <= base.timeMs, `atteso tempo <= default (${base.timeMs}ms), ottenuto ${relaxed.timeMs}ms`);
});

test('slowestPoints: ritorna al massimo `count` voci, ordinate dalla più lenta', () => {
    const telemetry = [
        { idx: 0, speedKmh: 300 }, { idx: 200, speedKmh: 50 }, { idx: 400, speedKmh: 80 }
    ];
    const track = { points: { length: 1000 } };
    const result = slowestPoints(telemetry, track, 2);
    assert.equal(result.length, 2);
    assert.equal(result[0].speedKmh, '50.0');
    assert.equal(result[1].speedKmh, '80.0');
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test backend/tools/f1LapSimulator.test.js`
Expected: FAIL — `Cannot find module './f1LapSimulator.js'`.

- [ ] **Step 3: Creare `backend/tools/f1LapSimulator.js` con `simulateLap`/`slowestPoints`**

```js
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
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `node --test backend/tools/f1LapSimulator.test.js`
Expected: PASS su tutti i test (uno per ogni pista in `frontend/tracks/`, più i 2 test di comportamento).

Se una pista specifica fallisce con "non completato entro 60s simulati", non è necessariamente un bug del simulatore: puo' essere un bot realmente incastrato su quella pista (segnale valido da investigare, esattamente lo scopo di questo strumento) — verificare con `node backend/tools/f1LapSimulator.js <quella-pista>` (Task 4) prima di modificare il simulatore stesso.

- [ ] **Step 5: Verificare che il resto della suite non sia rotto**

Run: `node --test backend/sockets/games/ backend/tools/`
Expected: PASS su tutti i file di test del progetto.

---

### Task 4: CLI dello script (`--all-tracks`, `--preset=zero-margin`, output leggibile)

**Files:**
- Modify: `backend/tools/f1LapSimulator.js` (aggiunta in fondo al file)
- Test: `backend/tools/f1LapSimulator.test.js` (append)

**Interfaces:**
- Consumes: `simulateLap`, `slowestPoints` (Task 3); `listTracks`, `loadTrack` (esistenti).
- Produces: nessuna nuova interfaccia programmatica oltre a `parseArgs(argv)` (esportata solo per test) — il resto è l'entry point CLI (`if (require.main === module) main();`).

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungi in fondo a `backend/tools/f1LapSimulator.test.js`:

```js
const { parseArgs } = require('./f1LapSimulator.js');

test('parseArgs: valori di default quando non si passa nulla', () => {
    const args = parseArgs([]);
    assert.equal(args.trackId, null);
    assert.equal(args.allTracks, false);
    assert.equal(args.preset, 'default');
    assert.equal(args.speedFactor, 1);
    assert.equal(args.safetyCapS, 60);
});

test('parseArgs: trackId posizionale + flag --all-tracks/--preset/--speed-factor', () => {
    const args = parseArgs(['monza', '--all-tracks', '--preset=zero-margin', '--speed-factor=0.9']);
    assert.equal(args.trackId, 'monza');
    assert.equal(args.allTracks, true);
    assert.equal(args.preset, 'zero-margin');
    assert.equal(args.speedFactor, 0.9);
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test backend/tools/f1LapSimulator.test.js`
Expected: FAIL — `parseArgs` non è esportato (`TypeError: parseArgs is not a function`).

- [ ] **Step 3: Aggiungere CLI in fondo a `backend/tools/f1LapSimulator.js`**

Aggiungi in cima al file (sotto i require esistenti):

```js
const path = require('path');
const fs = require('fs');
const { loadTrack, listTracks } = require('../sockets/games/trackLoader.js');
```

Aggiungi in fondo al file, prima di `module.exports = { simulateLap, slowestPoints };`:

```js
// Margini rilassati al limite: quanto tempo si guadagna solo togliendo la
// prudenza (a parità di algoritmo/traiettoria) — vedi la spec per perché non
// è un tempo-limite teorico assoluto, solo un confronto "prudenza vs resto".
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
```

Modifica l'ultima riga del file da:

```js
module.exports = { simulateLap, slowestPoints };
```

a:

```js
module.exports = { simulateLap, slowestPoints, parseArgs };
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `node --test backend/tools/f1LapSimulator.test.js`
Expected: PASS su tutti i test del file.

- [ ] **Step 5: Verifica manuale end-to-end (nessun test automatico per l'output CLI)**

Run: `node backend/tools/f1LapSimulator.js monza`
Expected: stampa un tempo sul giro nell'intorno del 27-30s osservato in browser (~27000-30000ms) più una lista di curve lente; scrive `backend/tools/monza-telemetry.json`.

Run: `node backend/tools/f1LapSimulator.js monza --preset=zero-margin`
Expected: tempo <= a quello di default (margini tolti, mai più lento).

Run: `node backend/tools/f1LapSimulator.js --all-tracks`
Expected: una riga per ciascuna pista in `frontend/tracks/`, nessuna con "Finito=NO".

Se il tempo di default su Monza NON è nell'intorno del 27-30s osservato in browser, il simulatore non riproduce fedelmente il comportamento reale — da investigare (differenze nella sequenza tick, nei default del player simulato, o nel calcolo del tempo) prima di fidarsi di qualunque numero che produce, invece di procedere alla fase 2.

- [ ] **Step 6: Verificare che il resto della suite non sia rotto**

Run: `node --test backend/sockets/games/ backend/tools/`
Expected: PASS su tutti i file di test del progetto.

---

## Self-Review (svolta durante la stesura di questo piano)

**Copertura spec:**
- Export fisica additivo → Task 1.
- Tuning parametrizzabile (i 3 margini rilevanti per il preset zero-margin) → Task 2.
- Loop di simulazione tick-by-tick fedele a `tickGame()`, tetto di sicurezza, telemetria, riepilogo curve lente → Task 3.
- CLI (`<trackId>`, `--all-tracks`, `--preset=zero-margin`, flag di override) → Task 4.
- Smoke test "nessuna pista resta incastrata" → Task 3, Step 1/4 (un test per pista via `listTracks()`).
- Verifica manuale che il numero prodotto sia credibile rispetto al ~27-30s osservato in browser → Task 4, Step 5.

**Placeholder:** nessuno — ogni step ha codice completo o un comando+output atteso concreto.

**Coerenza tipi/nomi:** `simulateLap(track, opts)` e `slowestPoints(telemetry, track, count)` usati identicamente in Task 3 e Task 4; `opts.tuning` passato a `deps.tuning` in `simulateLap` con lo stesso nome di chiave (`cornerSpeedMargin`/`apexMaxFraction`/`brakingDistanceMargin`) definito in `DEFAULT_TUNING` (Task 2); `physics.*` usato in Task 3 con esattamente i nomi esportati in Task 1.
