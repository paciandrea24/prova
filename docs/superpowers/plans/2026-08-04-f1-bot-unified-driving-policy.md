# F1 Bot — Fase 1: cervello di guida unificato Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificare la logica di guida del bot usata in gara con quella simulata offline da `f1RaceLineOptimizer.js` (oggi due implementazioni scollegate), ricalcolare le racing line con questo cervello unico, risolvere l'ingresso ai box come parte della stessa traiettoria, dimostrare la generalizzazione su piste-tortura mai usate per calibrare nulla, e chiudere il gap di tempo dall'umano.

**Architecture:** Una funzione pura `computeSoloRacingLineInputs` in `backend/sockets/games/f1Bot.js` diventa l'unica fonte per "come guidare al meglio da solo su una linea", riusata sia dal bot che corre davvero (`updateBotInputs`) sia dall'ottimizzatore offline (`f1RaceLineOptimizer.js::simulateWithRacingLine`). Grip-awareness e lookahead adattivo — oggi dietro flag sperimentali mai accesi in gara — diventano comportamento permanente e incondizionato. Le racing line vengono ricalcolate con questo cervello vero, l'ingresso ai box viene reso geometria-consapevole invece di una curva fissa tarata su una sola pista, e tutto viene validato anche su piste-tortura create apposta per rompere le assunzioni attuali.

**Tech Stack:** Node.js, `node:test`/`node:assert` per gli unit test, nessuna dipendenza nuova.

## Global Constraints

- Comunicazioni/commenti in italiano (convenzione di progetto).
- Nessun commit/push automatico oltre quelli richiesti da ogni task: l'utente fa il push manuale su GitHub quando vuole (CLAUDE.md) — i commit di fine-task in questo piano sono commit locali, non push.
- Procedere per step, un task alla volta, con verifica dell'utente in localhost prima di considerare chiusa la Fase 1 (Task 11).
- Ogni miglioramento a grip-awareness/lookahead adattivo era finora dietro flag OFF di default: questo piano li rende permanenti SOLO dopo che erano già stati validati singolarmente nelle sessioni precedenti (vedi design doc) — non introduce comportamento mai testato.
- Margini di aggressività (`cornerSpeedMargin`, `brakingDistanceMargin`, ecc.): qualunque modifica ai loro limiti va verificata via simulazione headless (nessun DNF/testacoda) prima di essere accettata — mai a sensazione (Rif. `feedback_bot_ai_physics_over_heuristics`).
- Rif. design: `docs/superpowers/specs/2026-08-04-f1-bot-unified-driving-policy-design.md`.

---

## PARTE A — Cervello di guida condiviso

### Task 1: `computeSoloRacingLineInputs` + wiring nel ramo racing-line

**Files:**
- Modify: `backend/sockets/games/f1Bot.js` (nuova funzione dopo `adaptiveLookaheadMeters`, ~riga 620; wiring nel ramo racing-line di `updateBotInputs`, ~righe 960-987; `module.exports`)
- Test: `backend/sockets/games/f1Bot.test.js`

**Interfaces:**
- Consumes: `adaptiveLookaheadMeters`, `steerToward`, `cornerTargetSpeed`, `metersToSamples`, `lookaheadIndex`, `botSpeedMs`, `BOT_CURVATURE_LOCAL_M` (tutte già in `f1Bot.js`).
- Produces: `computeSoloRacingLineInputs(p, track, rt, maxSpeed, brakeDecel, turnRateHigh, gripCapacityFactor) → { steer, target: {x,z}, targetSpeed, localSamples }`, esportata da `f1Bot.js`. `track.racingLine` è la linea da seguire (nel gioco vero sempre `track.racingLine` caricata da `trackLoader.js`; l'ottimizzatore in Task 5 passerà una vista del tracciato con `racingLine` sostituita dalla candidata in valutazione). `localSamples` è restituito perché il chiamante reale lo riusa subito dopo per il calcolo del sorpasso (`windowRadius`) — evita di calcolarlo due volte.

- [ ] **Step 1: Scrivi i test che falliscono per la funzione pura**

Aggiungi in `backend/sockets/games/f1Bot.test.js`, dopo il blocco esistente di test su `windowRadius`/`adaptiveLookaheadMeters` (prima della sezione `updateBotInputs`):

```javascript
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
```

Aggiungi anche `computeSoloRacingLineInputs` alla destructuring dell'import in cima al file (riga 4-11, stesso blocco che già importa `adaptiveLookaheadMeters`).

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: FAIL — `computeSoloRacingLineInputs is not a function`.

- [ ] **Step 3: Implementa la funzione condivisa**

In `backend/sockets/games/f1Bot.js`, subito dopo la chiusura di `adaptiveLookaheadMeters` (dopo la riga `}` che chiude quella funzione, prima di `// Margine sulla distanza di frenata...`):

```javascript
// Fase 1 — cervello di guida condiviso (Rif.
// docs/superpowers/specs/2026-08-04-f1-bot-unified-driving-policy-design.md):
// decide sterzo e velocità-obiettivo per seguire al meglio la racing line DA
// SOLO — nessuna dipendenza da altri giocatori, pit stop, socket. Estratta
// dal ramo racing-line di updateBotInputs per essere riusata IDENTICA anche
// da backend/tools/f1RaceLineOptimizer.js (Task 5): prima l'ottimizzatore
// valutava le candidate di linea con una propria copia più vecchia
// (lookahead a tempo fisso) — le due implementazioni si erano scollegate.
// `track.racingLine` è la linea da seguire: nel gioco vero è sempre la
// stessa caricata da trackLoader.js; l'ottimizzatore la sostituisce con ogni
// candidata in valutazione tramite una vista del tracciato (stesso campo).
// Non include botSpeedFactor/botLapPaceMult (varianza di ritmo per-bot, un
// concetto di gara) né l'aggiustamento sorpasso/scia (multi-auto): il
// chiamante reale li applica DOPO aver ricevuto targetSpeed da qui.
function computeSoloRacingLineInputs(p, track, rt, maxSpeed, brakeDecel, turnRateHigh, gripCapacityFactor) {
    const metersPerSample = track.lapLength / track.points.length;
    const localSamples = metersToSamples(BOT_CURVATURE_LOCAL_M, track);
    const speedMs = Math.max(5, botSpeedMs(p.speed));
    const lookM = adaptiveLookaheadMeters(track.racingLine, p.trackIndex || 0, track, rt.adaptiveLookaheadK, speedMs);
    const lookSamples = metersToSamples(lookM, track);
    const targetIdx = lookaheadIndex(track.points.length, p.trackIndex || 0, lookSamples);
    const target = track.racingLine[targetIdx];

    const steer = steerToward(p.x, p.z, p.angle, target.x, target.z, rt.steerGain);

    const scanM = (maxSpeed * maxSpeed) / (2 * brakeDecel) * rt.brakingDistanceMargin;
    const scanSamples = metersToSamples(scanM, track);
    const targetSpeed = cornerTargetSpeed(
        track.racingLine, p.trackIndex || 0, scanSamples, localSamples, metersPerSample,
        p.speed, maxSpeed, brakeDecel, turnRateHigh, rt.cornerSpeedMargin, gripCapacityFactor
    );

    return { steer, target, targetSpeed, localSamples };
}
```

Nel blocco `module.exports` in fondo al file, aggiungi `computeSoloRacingLineInputs` alla lista esistente.

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: PASS sui 2 nuovi test + nessuna regressione sui preesistenti.

- [ ] **Step 5: Wiring nel ramo racing-line di `updateBotInputs`**

In `backend/sockets/games/f1Bot.js`, nel ramo `else if (track.racingLine) {`, sostituisci (dalla riga con `const maxSpeed = effectiveMaxSpeed(p, isQuali) * (p.inSlipstream...` fino a prima di `if (!isQuali) {`):

```javascript
            const maxSpeed = effectiveMaxSpeed(p, isQuali) * (p.inSlipstream ? (1 + (slipstreamMaxBoost || 0)) : 1);
            // Grip-awareness: a flag spento resta 1 (nessun effetto).
            // corneringCapacity è un moltiplicatore RELATIVO alla capacità
            // laterale (non un grip assoluto) — la scala verso una velocità
            // non è assunta 1:1, vedi BOT_GRIP_CAPACITY_EXPONENT.
            const gripCapacityFactor = isBotGripAwarenessActive()
                ? Math.pow(corneringCapacity(p, isQuali, maxSpeed), BOT_GRIP_CAPACITY_EXPONENT)
                : 1;
            debugMaxSpeed = maxSpeed;
            debugGripCapacityFactor = gripCapacityFactor;
            const speedMs  = Math.max(5, botSpeedMs(p.speed));
            const lookM    = isAdaptiveLookaheadActive()
                ? adaptiveLookaheadMeters(track.racingLine, p.trackIndex || 0, track, rt.adaptiveLookaheadK, speedMs)
                : Math.max(BOT_LOOKAHEAD_MIN_M, speedMs * rt.lookaheadTimeS);
            const lookSamples  = metersToSamples(lookM, track);
            const localSamples = metersToSamples(BOT_CURVATURE_LOCAL_M, track);
            const targetIdx = lookaheadIndex(track.points.length, p.trackIndex || 0, lookSamples);
            const target = track.racingLine[targetIdx];
            debugTarget = { x: target.x, z: target.z };

            steer = steerToward(p.x, p.z, p.angle, target.x, target.z, rt.steerGain);

            const scanM = (maxSpeed * maxSpeed) / (2 * brakeDecel) * rt.brakingDistanceMargin;
            const scanSamples = metersToSamples(scanM, track);
            let targetSpeed = cornerTargetSpeed(
                track.racingLine, p.trackIndex || 0, scanSamples, localSamples, metersPerSample,
                p.speed, maxSpeed, brakeDecel, turnRateHigh, rt.cornerSpeedMargin, gripCapacityFactor
            ) * p.botSpeedFactor * p.botLapPaceMult;
```

con:

```javascript
            const maxSpeed = effectiveMaxSpeed(p, isQuali) * (p.inSlipstream ? (1 + (slipstreamMaxBoost || 0)) : 1);
            // Grip-awareness: a flag spento resta 1 (nessun effetto) — Rif.
            // Task 3 di questo piano per la rimozione del flag (non ancora
            // fatta qui: questo task riguarda solo il lookahead).
            const gripCapacityFactor = isBotGripAwarenessActive()
                ? Math.pow(corneringCapacity(p, isQuali, maxSpeed), BOT_GRIP_CAPACITY_EXPONENT)
                : 1;
            debugMaxSpeed = maxSpeed;
            debugGripCapacityFactor = gripCapacityFactor;

            // Lookahead adattivo ora permanente in questo ramo (Fase 1 —
            // cervello di guida unificato): niente più flag, e la logica è
            // condivisa con l'ottimizzatore offline via computeSoloRacingLineInputs.
            const solo = computeSoloRacingLineInputs(p, track, rt, maxSpeed, brakeDecel, turnRateHigh, gripCapacityFactor);
            const target = solo.target;
            const localSamples = solo.localSamples;   // riusato più sotto per il sorpasso (windowRadius) — evita di ricalcolarlo
            steer = solo.steer;
            debugTarget = { x: target.x, z: target.z };

            let targetSpeed = solo.targetSpeed * p.botSpeedFactor * p.botLapPaceMult;
```

- [ ] **Step 6: Sostituisci i due test obsoleti del ramo racing-line con uno che riflette il nuovo comportamento incondizionato**

In `backend/sockets/games/f1Bot.test.js`, sostituisci i due test `'updateBotInputs: F1_BOT_ADAPTIVE_LOOKAHEAD spento => lookahead identico a prima (ramo racing-line)'` e `'updateBotInputs: F1_BOT_ADAPTIVE_LOOKAHEAD acceso => target diverso da flag spento su curva stretta (ramo racing-line)'` (l'intero blocco dalla riga `test('updateBotInputs: F1_BOT_ADAPTIVE_LOOKAHEAD spento => lookahead identico a prima (ramo racing-line)'...` fino alla chiusura del secondo test, prima del test del ramo geometrico) con:

```javascript
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
        accel: 0.186, brakeMult: 2.17, turnRateHigh: 0.052
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
```

- [ ] **Step 7: Esegui l'intera suite del file, verifica che passi**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: PASS su tutti i test (nessuna regressione sul resto del file — i test del ramo geometrico/grip-awareness non sono toccati da questo task).

- [ ] **Step 8: Commit**

```bash
git add backend/sockets/games/f1Bot.js backend/sockets/games/f1Bot.test.js
git commit -m "F1 bot: estrae computeSoloRacingLineInputs, lookahead adattivo permanente nel ramo racing-line"
```

---

### Task 2: Lookahead adattivo permanente anche nel ramo geometrico di ripiego

**Files:**
- Modify: `backend/sockets/games/f1Bot.js` (ramo `else` di `updateBotInputs`, ~righe 1049-1052)
- Test: `backend/sockets/games/f1Bot.test.js`

**Interfaces:**
- Consumes: `adaptiveLookaheadMeters` (già esistente).
- Nessuna nuova interfaccia prodotta: questo task non estrae nulla in una funzione condivisa (l'ottimizzatore offline non simula mai questo ramo, che non produce un file `-raceline.json` — vedi design doc).

- [ ] **Step 1: Scrivi il test che fallisce**

In `backend/sockets/games/f1Bot.test.js`, sostituisci i due test `'updateBotInputs: F1_BOT_ADAPTIVE_LOOKAHEAD spento => lookahead identico a prima (ramo geometrico, senza racing line)'` e `'updateBotInputs: F1_BOT_ADAPTIVE_LOOKAHEAD acceso => target diverso da flag spento su curva stretta (ramo geometrico)'` con:

```javascript
test('updateBotInputs: ramo geometrico usa il lookahead adattivo alla curvatura (non più il tempo fisso legacy)', () => {
    const points = buildConstantCurveTrack(300, 50, 0.1);
    const track = { points, lapLength: 300, roadHalf: 5 };
    const deps = {
        effectiveMaxSpeed: () => 6, handlePitReactionPress: () => {}, io: { to: () => ({ emit: () => {} }) },
        lobbyId: 'test', wearLapsAtMedium: 5, accel: 0.186, brakeMult: 2.17, turnRateHigh: 0.052,
        tuning: { apexMaxFraction: 0 }
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
```

- [ ] **Step 2: Esegui il test, verifica che passi già "per sbaglio" solo se il flag è acceso — verifica invece che FALLISCA a flag spento (stato attuale)**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: FAIL — a flag spento (default, nessun env var impostato in questo test) il target coincide ancora con la formula legacy.

- [ ] **Step 3: Rendi permanente il lookahead adattivo nel ramo geometrico**

In `backend/sockets/games/f1Bot.js`, nel ramo `else {` (geometrico), sostituisci:

```javascript
            const speedMs  = Math.max(5, botSpeedMs(p.speed));   // floor: niente lookahead quasi-zero da fermi (es. alla partenza)
            const lookM    = isAdaptiveLookaheadActive()
                ? adaptiveLookaheadMeters(track.points, p.trackIndex || 0, track, tuning.adaptiveLookaheadK, speedMs)
                : Math.max(BOT_LOOKAHEAD_MIN_M, speedMs * tuning.lookaheadTimeS);
```

con:

```javascript
            const speedMs  = Math.max(5, botSpeedMs(p.speed));   // floor: niente lookahead quasi-zero da fermi (es. alla partenza)
            // Lookahead adattivo ora permanente anche qui (Fase 1 — cervello
            // di guida unificato): niente più flag. Non estratto in
            // computeSoloRacingLineInputs — l'ottimizzatore offline non
            // simula mai questo ramo (nessun file -raceline.json prodotto).
            const lookM    = adaptiveLookaheadMeters(track.points, p.trackIndex || 0, track, tuning.adaptiveLookaheadK, speedMs);
```

- [ ] **Step 4: Esegui il test, verifica che passi**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: PASS su tutti i test.

- [ ] **Step 5: Commit**

```bash
git add backend/sockets/games/f1Bot.js backend/sockets/games/f1Bot.test.js
git commit -m "F1 bot: lookahead adattivo permanente anche nel ramo geometrico di ripiego"
```

---

### Task 3: Grip-awareness permanente (entrambi i rami + frenata)

**Files:**
- Modify: `backend/sockets/games/f1Bot.js` (righe ~877-883 `brakeDecel`; ramo racing-line ~961-967; ramo geometrico equivalente)
- Modify: `backend/tools/f1LapSimulator.js` (`deps` in `simulateLap`)
- Test: `backend/sockets/games/f1Bot.test.js`

**Interfaces:**
- Nessuna nuova interfaccia: `corneringCapacity`/`effectiveBrakeMult` (già in `deps`) diventano consultate sempre, non più dietro flag.

- [ ] **Step 1: Rendi permanente `brakeDecel` grip-aware**

In `backend/sockets/games/f1Bot.js`, sostituisci:

```javascript
        const brakeDecel = isBotGripAwarenessActive()
            ? accel * effectiveBrakeMult(p, isQuali)
            : legacyBrakeDecel;
```

con:

```javascript
        // Grip-awareness ora permanente (Fase 1 — cervello di guida
        // unificato): niente più flag, brakeDecel riflette sempre l'usura
        // reale della gomma. legacyBrakeDecel resta solo per otherCarTargetSpeed
        // (stima del ritmo dell'auto avanti, esplicitamente fuori scope qui).
        const brakeDecel = accel * effectiveBrakeMult(p, isQuali);
```

- [ ] **Step 2: Rendi permanente `gripCapacityFactor` nel ramo racing-line**

Sostituisci (nel ramo racing-line, la parte aggiunta da Task 1):

```javascript
            const gripCapacityFactor = isBotGripAwarenessActive()
                ? Math.pow(corneringCapacity(p, isQuali, maxSpeed), BOT_GRIP_CAPACITY_EXPONENT)
                : 1;
```

con:

```javascript
            // Grip-awareness ora permanente (Fase 1 — cervello di guida
            // unificato): niente più flag, il bot conosce sempre il proprio
            // grip reale. corneringCapacity è un moltiplicatore RELATIVO alla
            // capacità laterale (non un grip assoluto) — vedi BOT_GRIP_CAPACITY_EXPONENT.
            const gripCapacityFactor = Math.pow(corneringCapacity(p, isQuali, maxSpeed), BOT_GRIP_CAPACITY_EXPONENT);
```

- [ ] **Step 3: Rendi permanente `gripCapacityFactor` nel ramo geometrico**

Nel ramo `else {` (geometrico), sostituisci l'equivalente ternario (stessa forma, stesso commento "Grip-awareness: stessa logica del ramo racing-line sopra.") con la stessa riga incondizionata dello Step 2.

- [ ] **Step 4: Aggiorna `f1LapSimulator.js` — la fisica esatta ora richiede sempre queste due dipendenze**

In `backend/tools/f1LapSimulator.js`, nella funzione `simulateLap`, sostituisci:

```javascript
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
```

con:

```javascript
    const deps = {
        effectiveMaxSpeed: physics.effectiveMaxSpeed,
        handlePitReactionPress: () => {},
        io: { to: () => ({ emit: () => {} }) },
        lobbyId: 'sim',
        wearLapsAtMedium: 5,
        accel: physics.ACCEL,
        brakeMult: physics.BRAKE_MULT,
        turnRateHigh: physics.TURN_SPEED_HIGH,
        // Grip-awareness ora permanente in updateBotInputs (Fase 1): queste
        // due dipendenze non sono più opzionali, servono sempre.
        effectiveBrakeMult: physics.effectiveBrakeMult,
        corneringCapacity: physics.corneringCapacity,
        tuning: opts.tuning
    };
```

- [ ] **Step 5: Riscrivi i test grip-awareness specifici (niente più flag da attivare/disattivare)**

In `backend/sockets/games/f1Bot.test.js`, sostituisci i 4 test da `test('updateBotInputs: F1_BOT_GRIP_AWARENESS spento -> comportamento identico indipendentemente da tyreWear'...)` a `test('updateBotInputs: gomma nuova (tyreWear=0) a flag acceso non è più prudente della gomma nuova a flag spento'...)` (blocco completo, 4 test) con:

```javascript
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
```

Poi sostituisci il test `'_botDebug: throttle/brake/steer coincidono ESATTAMENTE con p.inputs, in ogni scenario'` (che itera anche su `flag`) con:

```javascript
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
```

- [ ] **Step 6: Esegui l'intera suite del file, annota TUTTI i fallimenti**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: diversi test FALLISCONO con `TypeError: corneringCapacity is not a function` (o `effectiveBrakeMult is not a function`) — sono i test che esercitano il ramo racing-line o geometrico con un `deps` che finora non forniva queste due funzioni, perché a flag spento (comportamento di prima) non venivano mai chiamate.

- [ ] **Step 7: Correggi ogni test fallito allo stesso modo**

Per ognuno dei test individuati allo Step 6, apri il suo oggetto `deps` (o l'helper che lo costruisce, es. `makeGripAwarenessDeps` è già a posto, ma i `deps` inline di altri test no) e aggiungi due mock neutri — stesso comportamento del vecchio flag spento (nessun effetto sul grip):

```javascript
        corneringCapacity: () => 1,
        effectiveBrakeMult: () => 1,
```

Ripeti "aggiungi le due righe, ri-esegui `node --test backend/sockets/games/f1Bot.test.js`" finché la suite non è verde. Non modificare le asserzioni di questi test (il loro comportamento atteso non cambia: i mock neutri riproducono esattamente il grip nominale di prima).

- [ ] **Step 8: Esegui la suite ampliata (bot + lap simulator + fisica) e verifica che sia verde**

Run: `node --test backend/sockets/games/f1Bot.test.js backend/tools/f1LapSimulator.test.js backend/sockets/games/f1GameSocket.physics.test.js`
Expected: PASS su tutti e tre i file.

- [ ] **Step 9: Commit**

```bash
git add backend/sockets/games/f1Bot.js backend/sockets/games/f1Bot.test.js backend/tools/f1LapSimulator.js
git commit -m "F1 bot: grip-awareness permanente (brakeDecel + gripCapacityFactor in entrambi i rami)"
```

---

### Task 4: Rimozione dei flag morti e dello strumento diagnostico superato

**Files:**
- Modify: `backend/sockets/games/f1Bot.js` (rimozione `isBotGripAwarenessActive`, `isAdaptiveLookaheadActive`, `_lookaheadFormulaOverride`/`setLookaheadFormulaOverride`, relativi export)
- Modify: `backend/sockets/games/f1Bot.test.js` (rimozione test/import obsoleti)
- Delete: `backend/tools/f1AdaptiveLookaheadCheck.js` (il confronto A/B che doveva decidere floor fisso vs dinamico è già stato deciso e committato — Rif. header del file stesso, "Round 3... variante C" — e reso permanente dai Task 1-3 di questo piano)

**Interfaces:** nessuna (solo rimozione di codice non più consultato da nessun call site dopo i Task 1-3).

- [ ] **Step 1: Verifica che nessun call site consulti ancora i flag**

Run (PowerShell, dalla root):
```
Select-String -Path backend\sockets\games\f1Bot.js -Pattern "isBotGripAwarenessActive\(\)|isAdaptiveLookaheadActive\(\)"
```
Expected: nessun risultato (dopo i Task 1-3, le due funzioni sono definite ma non più chiamate da `updateBotInputs`).

- [ ] **Step 2: Rimuovi le definizioni e gli export in `f1Bot.js`**

Rimuovi:
- La funzione `isBotGripAwarenessActive` (e il commento che la precede) e la costante `F1_BOT_GRIP_AWARENESS` implicita nel suo corpo.
- La funzione `isAdaptiveLookaheadActive` (e il commento che la precede).
- `let _lookaheadFormulaOverride = null;` e `function setLookaheadFormulaOverride(fn) {...}` (e il commento "Hook diagnostico SOLO per backend/tools/f1AdaptiveLookaheadCheck.js" che le precede).
- Dentro `adaptiveLookaheadMeters`, il blocco:
  ```javascript
      if (_lookaheadFormulaOverride) {
          return _lookaheadFormulaOverride(laneSource, trackIndex, track, k, speedMs);
      }
  ```
- Da `module.exports`: `isBotGripAwarenessActive`, `isAdaptiveLookaheadActive`, `setLookaheadFormulaOverride`.

- [ ] **Step 3: Elimina lo strumento diagnostico superato**

```bash
rm backend/tools/f1AdaptiveLookaheadCheck.js
```
(oppure `Remove-Item backend\tools\f1AdaptiveLookaheadCheck.js` in PowerShell)

- [ ] **Step 4: Rimuovi i test/import obsoleti in `f1Bot.test.js`**

Rimuovi dall'import in cima al file: `isBotGripAwarenessActive`, `isAdaptiveLookaheadActive`, `setLookaheadFormulaOverride`.

Rimuovi i due test `'isBotGripAwarenessActive: spento di default'` e `'isBotGripAwarenessActive: attivo solo con "1" esplicito'` (righe ~414-432).

- [ ] **Step 5: Esegui l'intera suite, verifica che sia verde**

Run: `node --test backend/sockets/games/f1Bot.test.js backend/tools/f1LapSimulator.test.js backend/sockets/games/f1GameSocket.physics.test.js`
Expected: PASS su tutti e tre.

- [ ] **Step 6: Commit**

```bash
git add -A backend/sockets/games/f1Bot.js backend/sockets/games/f1Bot.test.js backend/tools/f1AdaptiveLookaheadCheck.js
git commit -m "F1 bot: rimuove i flag sperimentali ormai permanenti e lo strumento diagnostico che li confrontava"
```

---

### Task 5: L'ottimizzatore offline usa il cervello condiviso

**Files:**
- Modify: `backend/tools/f1RaceLineOptimizer.js`

**Interfaces:**
- Consumes: `computeSoloRacingLineInputs`, `BOT_GRIP_CAPACITY_EXPONENT` (aggiunta all'export di `f1Bot.js` in questo task), `physics.corneringCapacity` (già disponibile).
- Produces: il file `<trackId>-raceline.json` scritto da `run()` ora include anche `adaptiveLookaheadK` nel blocco `tuning` (prima assente: l'ottimizzatore non lo cercava mai).

- [ ] **Step 1: Esporta `BOT_GRIP_CAPACITY_EXPONENT` da `f1Bot.js`**

In `backend/sockets/games/f1Bot.js`, aggiungi `BOT_GRIP_CAPACITY_EXPONENT` al `module.exports`.

- [ ] **Step 2: Aggiorna l'import in `f1RaceLineOptimizer.js`**

Sostituisci:

```javascript
const {
    cornerTargetSpeed, lookaheadIndex, normalizeAngle,
    // Prototipo shape-prior (Rif. audit 2026-07-29, opzione B): riusa la
    // STESSA formula fuori-dentro-fuori già validata per il ramo fallback
    // runtime (apexOffset/cornerApexNear) come punto di PARTENZA per
    // l'ottimizzatore, invece di zero ovunque — nessuna nuova formula
    // geometrica inventata qui. BOT_CURVATURE_LOCAL_M/BOT_APEX_MAX_FRACTION
    // esportate apposta da f1Bot.js (additivo, comportamento runtime
    // invariato) per non reinventare gli stessi numeri con un altro nome.
    apexOffset, BOT_CURVATURE_LOCAL_M, BOT_APEX_MAX_FRACTION
} = require("../sockets/games/f1Bot.js");
```

con:

```javascript
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
```

- [ ] **Step 3: Rimuovi `steerTowardGain` (superata) e riscrivi `simulateWithRacingLine`**

Rimuovi la funzione `steerTowardGain` (righe 35-41, non più usata da nessuno dopo questo task).

Sostituisci `simulateWithRacingLine`:

```javascript
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
```

con:

```javascript
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
```

- [ ] **Step 4: Rendi `adaptiveLookaheadK` un parametro cercabile dall'ottimizzatore**

Nell'inizializzazione di `state` dentro `optimize()`, sostituisci:

```javascript
        let state = {
            line: (seedGeometric || seedMultiResolution) ? seedGeometricLine(LEVELS[0].numControls) : new Array(LEVELS[0].numControls).fill(0),
            lookaheadTimeS: 0.6, steerGain: 3.0,
            cornerSpeedMargin: 0.99, brakingDistanceMargin: 1.2,
            deadband: 0.01, ramp: 0.06
        };
```

con (aggiunta di `adaptiveLookaheadK`, default = costante candidata già usata in produzione):

```javascript
        let state = {
            line: (seedGeometric || seedMultiResolution) ? seedGeometricLine(LEVELS[0].numControls) : new Array(LEVELS[0].numControls).fill(0),
            lookaheadTimeS: 0.6, steerGain: 3.0, adaptiveLookaheadK: 0.1,
            cornerSpeedMargin: 0.99, brakingDistanceMargin: 1.2,
            deadband: 0.01, ramp: 0.06
        };
```

In `paramList`, aggiungi (dopo la riga di `steerGain`):

```javascript
        list.push({ get: () => state.adaptiveLookaheadK, set: v => { state.adaptiveLookaheadK = v; }, min: 0.02, max: 0.4, isLine: false });
```

In `cloneState`, aggiungi `adaptiveLookaheadK: s.adaptiveLookaheadK` al literal restituito.

Nel blocco di perturbazione random del basin-hopping (dentro il ciclo `for (let hop = 0; hop < hops; hop++)`), aggiungi dopo la riga che perturba `steerGain`:

```javascript
            if (Math.random() < 0.3) state.adaptiveLookaheadK = Math.max(0.02, Math.min(0.4, state.adaptiveLookaheadK + rand(-0.05, 0.05)));
```

- [ ] **Step 5: Scrivi `adaptiveLookaheadK` nel file `-raceline.json` prodotto**

In `run()`, nel blocco `tuning` passato a `JSON.stringify`, aggiungi `adaptiveLookaheadK: state.adaptiveLookaheadK,` e nella riga di log `console.log(...lookaheadTimeS=...)` aggiungi ` adaptiveLookaheadK=${state.adaptiveLookaheadK.toFixed(3)}`.

- [ ] **Step 6: Verifica funzionale (nessun unit test dedicato preesistente per questo file)**

Run: `node backend/tools/f1RaceLineOptimizer.js prova --hops=5`
Expected: nessun crash, output regolare (`RISULTATO: ...ms`, `lookaheadTimeS=... steerGain=... adaptiveLookaheadK=... cornerSpeedMargin=...`), il file `backend/tools/prova-raceline.json` viene sovrascritto e contiene `tuning.adaptiveLookaheadK`.

Run: `node --test backend/sockets/games/f1Bot.test.js backend/tools/f1LapSimulator.test.js backend/sockets/games/f1GameSocket.physics.test.js`
Expected: PASS (l'ottimizzatore non è coperto da questi file, ma `computeSoloRacingLineInputs`/`f1Bot.js` sì — nessuna regressione).

- [ ] **Step 7: Commit**

```bash
git add backend/tools/f1RaceLineOptimizer.js backend/sockets/games/f1Bot.js
git commit -m "F1: l'ottimizzatore offline usa lo stesso cervello di guida del bot in gara (computeSoloRacingLineInputs)"
```

---

## PARTE B — Racing line ricalcolate col cervello vero

### Task 6: Seed multi-risoluzione di default + rigenerazione per tutte le piste

**Files:**
- Modify: `backend/tools/f1RaceLineOptimizer.js` (`parseArgs`)
- Create/Overwrite: `backend/tools/new-monza-raceline.json`, `backend/tools/monte-rosso-raceline.json`, `backend/tools/prova-raceline.json`, `backend/tools/baku-raceline.json`
- Delete: `backend/tools/monza-raceline.json`, `backend/tools/new-monza-geoseed-h0-raceline.json`, `backend/tools/new-monza-geoseed-multi-h0-raceline.json`, `backend/tools/new-monza-zeroseed-h0-raceline.json`, `backend/tools/new-monza-telemetry.json` (artefatti dell'audit shape-prior 2026-07-29, ormai superati: questo task ne adotta l'esito come comportamento di default)

- [ ] **Step 1: Il seed multi-risoluzione diventa il default**

In `backend/tools/f1RaceLineOptimizer.js`, funzione `parseArgs`, sostituisci:

```javascript
    let seedGeometric = false;
    let seedMultiResolution = false;
```

con:

```javascript
    let seedGeometric = false;
    // Default true (Fase 1 — Rif. audit shape-prior 2026-07-29, esito
    // adottato): partire dalla forma fuori-dentro-fuori geometrica ad ogni
    // risoluzione riduce il rischio di un ottimo locale mediocre rispetto a
    // partire da zero ovunque. `--seed-multi-resolution=0` per tornare
    // eccezionalmente al comportamento precedente (solo per confronto).
    let seedMultiResolution = true;
```

E nel ciclo di `parseArgs` che interpreta gli argomenti, sostituisci:

```javascript
        else if (arg === "--seed-multi-resolution") seedMultiResolution = true;
```

con:

```javascript
        else if (arg === "--seed-multi-resolution") seedMultiResolution = true;
        else if (arg === "--seed-multi-resolution=0") seedMultiResolution = false;
```

- [ ] **Step 2: Rigenera la racing line per tutte le 4 piste attuali**

Run (dalla cartella `backend/`, tempo atteso: qualche minuto per pista):
```
node tools/f1RaceLineOptimizer.js new-monza monte-rosso prova baku --hops=30
```
Expected: 4 blocchi di output `RISULTATO: ...ms`, 4 file scritti/sovrascritti in `backend/tools/`.

- [ ] **Step 3: Verifica nessuna regressione di tempo su new-monza e prova (le uniche due che avevano già una racing line prima di questo task)**

Prima di procedere, annota il tempo precedente (visibile nel vecchio `backend/tools/new-monza-raceline.json`/`prova-raceline.json` appena sovrascritti — se non annotato prima, rilancia lo Step 2 e confronta il campo `timeMs` del nuovo output con quello riportato nella memoria di progetto/commit precedente).

Run: `node backend/tools/f1LapSimulator.js --all-tracks`
Expected: tutte le 4 piste completano (`finito: si`); il tempo per new-monza e prova non deve essere più alto di quello precedente al ricalcolo. Se lo è, aumentare `--hops` (es. 50) e ripetere lo Step 2 solo per quella pista prima di procedere.

- [ ] **Step 4: Pulizia degli artefatti sperimentali superati**

```bash
rm backend/tools/monza-raceline.json backend/tools/new-monza-geoseed-h0-raceline.json backend/tools/new-monza-geoseed-multi-h0-raceline.json backend/tools/new-monza-zeroseed-h0-raceline.json backend/tools/new-monza-telemetry.json
```

- [ ] **Step 5: Riavvia il riferimento del server (nota per il playtest, Task 11) e commit**

Il server deve essere riavviato per vedere le nuove racing line in partita reale (`trackLoader.js` mette in cache al primo caricamento) — non serve farlo ora se non si sta già testando in localhost, solo prendere nota per il Task 11.

```bash
git add backend/tools/new-monza-raceline.json backend/tools/monte-rosso-raceline.json backend/tools/prova-raceline.json backend/tools/baku-raceline.json backend/tools/f1RaceLineOptimizer.js
git rm backend/tools/monza-raceline.json backend/tools/new-monza-geoseed-h0-raceline.json backend/tools/new-monza-geoseed-multi-h0-raceline.json backend/tools/new-monza-zeroseed-h0-raceline.json backend/tools/new-monza-telemetry.json
git commit -m "F1: seed multi-risoluzione di default, racing line ricalcolate per tutte le 4 piste col cervello unificato"
```

---

## PARTE C — Ingresso ai box come parte della stessa traiettoria

### Task 7: Strumento di riproduzione headless dell'ingresso ai box

**Files:**
- Create: `backend/tools/f1PitEntryCheck.js`

**Interfaces:**
- Consumes: `createTestbenchSession` (`f1Testbench.js`), `tickGame` (`f1GameSocket.js`), `listTracks` (`trackLoader.js`).
- Produces: `checkPitEntry(trackId) → { [color]: { entered: boolean, tick: number|null } }`, esportata per un eventuale uso da Task 9.

- [ ] **Step 1: Scrivi lo strumento**

Crea `backend/tools/f1PitEntryCheck.js`:

```javascript
// backend/tools/f1PitEntryCheck.js
//
// Riproduzione headless (nessun browser): per ogni pista, forza l'usura
// gomme sopra la soglia di pit-stop di tutti i bot e verifica che ognuno
// attraversi FISICAMENTE track.pitEntryTrigger entro un numero di tick
// generoso — Rif. docs/superpowers/specs/2026-08-04-f1-bot-unified-driving-policy-design.md,
// punto 4 (ingresso ai box come parte della stessa traiettoria). Loop
// sincrono stretto: sufficiente per vedere SE il bot attraversa il
// rettangolo-trigger (nessuna fisica a tempo di parete reale coinvolta in
// questa parte — il minigioco di reazione pit stop usa setTimeout, qui
// irrilevante: si misura solo l'ingresso, non la sosta completa).
const { createTestbenchSession } = require('../sockets/games/f1Testbench.js');
const f1GameSocket = require('../sockets/games/f1GameSocket.js');
const { listTracks } = require('../sockets/games/trackLoader.js');

const FAKE_IO = { to: () => ({ emit: () => {} }) };
const MAX_TICKS = 30000;   // 30000 * 20ms = 10 minuti simulati, ben oltre qualunque giro

function checkPitEntry(trackId) {
    const game = createTestbenchSession({ trackId, botCount: 6, tyreWear: 85, compound: 'medium' });
    const results = {};
    for (const color of Object.keys(game.players)) results[color] = { entered: false, tick: null };

    for (let tick = 0; tick < MAX_TICKS; tick++) {
        f1GameSocket.tickGame(FAKE_IO, 'TESTBENCH', game);
        for (const p of Object.values(game.players)) {
            if (!results[p.color].entered && p.pitAutoState === 'entering') {
                results[p.color] = { entered: true, tick };
            }
        }
        if (Object.values(results).every(r => r.entered)) break;
    }
    return results;
}

function main() {
    const argTracks = process.argv.slice(2);
    const ids = argTracks.length > 0 ? argTracks : listTracks().map(t => t.id);
    let anyFailed = false;
    for (const trackId of ids) {
        const results = checkPitEntry(trackId);
        const entries = Object.entries(results);
        const failed = entries.filter(([, r]) => !r.entered);
        console.log(`\n=== ${trackId} ===`);
        for (const [color, r] of entries) {
            console.log(`  ${color}: ${r.entered ? `entrato al tick ${r.tick}` : 'MAI ENTRATO'}`);
        }
        if (failed.length > 0) {
            anyFailed = true;
            console.log(`[${trackId}] FALLITO: ${failed.length}/${entries.length} bot non sono mai entrati ai box`);
        }
    }
    process.exitCode = anyFailed ? 1 : 0;
}

if (require.main === module) main();

module.exports = { checkPitEntry };
```

- [ ] **Step 2: Esegui lo strumento, stabilisci la baseline nota**

Run: `node backend/tools/f1PitEntryCheck.js new-monza monte-rosso prova baku`
Expected (baseline nota, bug preesistente non ancora corretto): `new-monza` OK (tutti entrati), `monte-rosso` e `prova` FALLITI (nessun bot entra mai), `baku` — verificare l'esito reale (la nota di progetto segnalava un possibile problema di dati a monte, non ancora isolato).

- [ ] **Step 3: Commit**

```bash
git add backend/tools/f1PitEntryCheck.js
git commit -m "F1: strumento di riproduzione headless dell'ingresso ai box (baseline del bug monte-rosso/prova)"
```

---

### Task 8: Convergenza dell'ingresso box derivata dalla geometria locale

**Files:**
- Modify: `backend/sockets/games/f1Bot.js` (blocco `nearPitEntry` in `updateBotInputs`, ~righe 894-937; nuova costante vicino a `BOT_PIT_APPROACH_M`)

**Interfaces:** nessuna nuova interfaccia esposta — comportamento interno del ramo `nearPitEntry`.

- [ ] **Step 1: Aggiungi la costante candidata**

Vicino alla definizione di `BOT_PIT_APPROACH_M` in `backend/sockets/games/f1Bot.js`, aggiungi:

```javascript
// Quanti metri di anticipo servono, PER METRO di scostamento laterale tra
// linea principale e corsia box, per convergere in tempo dentro il
// rettangolo-trigger — misurato: new-monza (scostamento minore) funzionava
// già con l'anticipo fisso precedente, monte-rosso/prova (scostamento
// maggiore) no (Rif. backend/tools/f1PitEntryCheck.js, Task 7). Candidato
// iniziale, da verificare/aumentare con quello strumento su tutte le piste
// prima di considerare questo task chiuso — non un valore derivato
// matematicamente, una misura empirica come BOT_ADAPTIVE_LOOKAHEAD_K.
const PIT_CONVERGENCE_LEAD_FACTOR = 3;
```

- [ ] **Step 2: Sostituisci il blocco `nearPitEntry`**

Sostituisci (il ramo `else` interno che oggi usa una curva cubica a finestra fissa):

```javascript
            } else {
                const approachSamples = metersToSamples(BOT_PIT_APPROACH_M, track);
                const tLinear = 1 - idxUntilPitEntry / approachSamples;   // 0 appena entrati nella finestra, 1 al distacco
                // Cubica invece di lineare: per la maggior parte della
                // finestra il bersaglio resta quasi quello della guida
                // normale (segue la curva reale), lo spostamento vero verso
                // pitPath[0] si concentra negli ultimi metri — altrimenti
                // (peso lineare) si taglia l'ultima curva di Monza prima
                // ancora di essere vicini ai box (segnalato dall'utente).
                const t = tLinear * tLinear * tLinear;
                const laneSource   = track.racingLine || track.points;
                const speedMs      = Math.max(5, botSpeedMs(p.speed));
                const lookM        = Math.max(BOT_LOOKAHEAD_MIN_M, speedMs * BOT_LOOKAHEAD_TIME_S);
                const laneTargetIdx = lookaheadIndex(track.points.length, p.trackIndex || 0, metersToSamples(lookM, track));
                const laneTarget   = laneSource[laneTargetIdx];
                const targetX = laneTarget.x * (1 - t) + track.pitPath[0].x * t;
                const targetZ = laneTarget.z * (1 - t) + track.pitPath[0].z * t;
                steer = steerToward(p.x, p.z, p.angle, targetX, targetZ);
                debugTarget = { x: targetX, z: targetZ };
            }
```

con:

```javascript
            } else {
                const laneSource = track.racingLine || track.points;
                const approachSamples = metersToSamples(BOT_PIT_APPROACH_M, track);

                // Distanza laterale reale tra la linea principale e il punto
                // di raccordo della corsia box, misurata AL punto
                // d'ingresso (fissa per questa pista, non per-tick): quanto
                // più è grande, tanto più anticipo serve per convergere in
                // tempo — non un'unica finestra buona per tutte le piste
                // (Rif. bug monte-rosso/prova, Task 7/8 di questo piano).
                const mainAtEntry = laneSource[track.pitEntryIndex] || laneSource[laneSource.length - 1];
                const splitGapM = Math.hypot(mainAtEntry.x - track.pitPath[0].x, mainAtEntry.z - track.pitPath[0].z);
                const convergenceLeadSamples = metersToSamples(Math.max(BOT_PIT_LANE_FOLLOW_M, splitGapM * PIT_CONVERGENCE_LEAD_FACTOR), track);
                const denomSamples = Math.max(1, approachSamples - convergenceLeadSamples);
                // Converge del tutto (t=1) con convergenceLeadSamples di
                // anticipo PRIMA del vero punto d'ingresso, non esattamente
                // lì come prima — dà tempo all'auto di essere già vicina a
                // pitPath[0] quando trackIndex raggiunge pitEntryIndex.
                const tLinear = idxUntilPitEntry <= convergenceLeadSamples
                    ? 1
                    : Math.max(0, 1 - (idxUntilPitEntry - convergenceLeadSamples) / denomSamples);
                // Cubica invece di lineare: per la maggior parte della
                // finestra il bersaglio resta quasi quello della guida
                // normale (segue la curva reale), lo spostamento vero verso
                // pitPath[0] si concentra negli ultimi metri — altrimenti
                // (peso lineare) si taglia l'ultima curva prima ancora di
                // essere vicini ai box (segnalato dall'utente su New Monza).
                const t = tLinear * tLinear * tLinear;
                const speedMs      = Math.max(5, botSpeedMs(p.speed));
                const lookM        = Math.max(BOT_LOOKAHEAD_MIN_M, speedMs * BOT_LOOKAHEAD_TIME_S);
                const laneTargetIdx = lookaheadIndex(track.points.length, p.trackIndex || 0, metersToSamples(lookM, track));
                const laneTarget   = laneSource[laneTargetIdx];
                const targetX = laneTarget.x * (1 - t) + track.pitPath[0].x * t;
                const targetZ = laneTarget.z * (1 - t) + track.pitPath[0].z * t;
                steer = steerToward(p.x, p.z, p.angle, targetX, targetZ);
                debugTarget = { x: targetX, z: targetZ };
            }
```

- [ ] **Step 3: Verifica con lo strumento del Task 7, itera sulla costante se necessario**

Run: `node backend/tools/f1PitEntryCheck.js new-monza monte-rosso prova baku`
Expected: TUTTI i bot entrano su TUTTE le piste. Se una pista fallisce ancora, aumenta `PIT_CONVERGENCE_LEAD_FACTOR` (es. da 3 a 5) e ripeti — non toccare altre costanti/formule (Rif. `feedback_bot_ai_physics_over_heuristics`: un solo parametro derivato dalla geometria misurata, non un ritocco a sensazione altrove).

- [ ] **Step 4: Verifica nessuna regressione di tempo sul giro**

Run: `node backend/tools/f1LapSimulator.js --all-tracks`
Expected: stessi tempi (entro il rumore) di prima di questo task su tutte le piste — questo fix cambia solo il comportamento nella finestra d'ingresso ai box, mai durante il giro normale.

- [ ] **Step 5: Esegui la suite completa**

Run: `node --test backend/sockets/games/f1Bot.test.js backend/tools/f1LapSimulator.test.js backend/sockets/games/f1GameSocket.physics.test.js`
Expected: PASS (nessun test esistente esercitava la formula precisa del blend box, solo il fatto che `nearPitEntry` produca un target valido — nessuna regressione attesa).

- [ ] **Step 6: Commit**

```bash
git add backend/sockets/games/f1Bot.js
git commit -m "F1 bot: ingresso ai box converge in base alla geometria reale del raccordo, non più una finestra fissa"
```

---

## PARTE D — Generalizzazione: piste-tortura

### Task 9: Generatore di piste-tortura

**Files:**
- Create: `backend/tools/f1GenerateStressTracks.js`
- Create: `frontend/tracks/stress-hairpin.json`, `frontend/tracks/stress-chicane.json` (generati dallo script, temporanei — rimossi a fine Task 10)

**Interfaces:**
- Produces: `buildHairpinTrack()`, `buildChicaneTrack()` (oggetti conformi allo schema validato da `trackLoader.validateTrackData`), esportate per riuso da Task 10 se serve rigenerarle.

- [ ] **Step 1: Scrivi il generatore**

Crea `backend/tools/f1GenerateStressTracks.js`:

```javascript
// backend/tools/f1GenerateStressTracks.js
//
// Genera 2 piste-tortura per la Fase 1 (Rif.
// docs/superpowers/specs/2026-08-04-f1-bot-unified-driving-policy-design.md,
// punto 5): geometrie deliberatamente più severe di quelle esistenti, MAI
// usate per calibrare alcun numero — solo per dimostrare la generalizzazione.
// Base = ellisse (loop chiuso sempre valido), con una finestra locale
// perturbata per creare un tornante molto stretto o una chicane rapida —
// invece di piazzare punti a mano e sperare che lo spline Catmull-Rom
// (frontend/shared/trackGeometry.js) smussi a sufficienza.
const fs = require('fs');
const path = require('path');
const { validateTrackData } = require('../sockets/games/trackLoader.js');

const TRACKS_DIR = path.join(__dirname, '..', '..', 'frontend', 'tracks');
const N = 40;

function baseEllipse(a, b) {
    const pts = [];
    for (let i = 0; i < N; i++) {
        const theta = (i / N) * 2 * Math.PI;
        pts.push({ x: a * Math.cos(theta), z: b * Math.sin(theta) });
    }
    return pts;
}

// "Pizzica" una finestra di `count` punti verso un raggio molto più
// stretto (tightRadius): crea UN tornante deliberatamente più stretto di
// qualunque curva esistente (roadHalf tipico 10-14m, curve esistenti
// nell'ordine delle decine di metri — qui ben sotto).
function pinchHairpin(points, a, b, startIdx, count, tightRadius) {
    const out = points.map(p => ({ ...p }));
    for (let k = 0; k < count; k++) {
        const idx = (startIdx + k) % out.length;
        const theta = (idx / N) * 2 * Math.PI;
        const distFromMid = Math.abs(k - count / 2) / (count / 2);   // 0 al centro della finestra, 1 ai bordi
        const r = tightRadius + distFromMid * (Math.min(a, b) - tightRadius);
        const dirX = Math.cos(theta), dirZ = Math.sin(theta);
        out[idx] = { x: dirX * r, z: dirZ * r * (b / a) };
    }
    return out;
}

// Zig-zag laterale (S rapida): offset alternato perpendicolare alla
// tangente locale su pochi punti consecutivi.
function addChicane(points, startIdx, offsets) {
    const out = points.map(p => ({ ...p }));
    offsets.forEach((offset, k) => {
        const idx = (startIdx + k) % out.length;
        const prev = out[(idx - 1 + out.length) % out.length];
        const next = out[(idx + 1) % out.length];
        const tx = next.x - prev.x, tz = next.z - prev.z;
        const len = Math.hypot(tx, tz) || 1;
        const nx = -tz / len, nz = tx / len;
        out[idx] = { x: out[idx].x + nx * offset, z: out[idx].z + nz * offset };
    });
    return out;
}

function buildHairpinTrack() {
    const a = 220, b = 140;
    const points = pinchHairpin(baseEllipse(a, b), a, b, 0, 6, 14);   // raggio ~14m, molto più stretto delle curve esistenti
    const p0 = points[20];   // lato opposto al tornante: split box "normale", stress isolato alla sola curvatura qui

    return {
        id: 'stress-hairpin',
        name: 'Stress Test - Tornante',
        targetKm: 2.5,
        roadHalfWidth: 10,
        controlPoints: points,
        pit: {
            roadHalfWidth: 5,
            boxIndex: 2,
            entryTrigger: { xMin: p0.x - 8, xMax: p0.x + 8, zMin: p0.z - 8, zMax: p0.z + 8 },
            path: [
                { x: p0.x, z: p0.z },
                { x: p0.x - 20, z: p0.z + 10 },
                { x: p0.x - 40, z: p0.z + 30 },
                { x: p0.x - 40, z: p0.z + 70 },
                { x: p0.x - 40, z: p0.z + 110 }
            ]
        }
    };
}

function buildChicaneTrack() {
    const a = 260, b = 160;
    let points = baseEllipse(a, b);
    points = addChicane(points, 5, [18, -18, 18]);   // S rapida su 3 punti consecutivi
    const p0 = points[20];

    return {
        id: 'stress-chicane',
        name: 'Stress Test - Chicane',
        targetKm: 2.7,
        roadHalfWidth: 10,
        controlPoints: points,
        pit: {
            roadHalfWidth: 5,
            boxIndex: 2,
            // Corsia box che si stacca con un angolo molto più marcato del
            // solito (quasi perpendicolare alla tangente locale, non un
            // raccordo dolce) — stress test dell'ingresso ai box (Rif. Task 8).
            entryTrigger: { xMin: p0.x - 8, xMax: p0.x + 8, zMin: p0.z - 8, zMax: p0.z + 8 },
            path: [
                { x: p0.x, z: p0.z },
                { x: p0.x, z: p0.z + 35 },
                { x: p0.x - 5, z: p0.z + 75 },
                { x: p0.x - 5, z: p0.z + 115 },
                { x: p0.x - 5, z: p0.z + 155 }
            ]
        }
    };
}

function writeTrack(data) {
    const err = validateTrackData(data);
    if (err) throw new Error(`Pista "${data.id}" non valida: ${err}`);
    fs.writeFileSync(path.join(TRACKS_DIR, `${data.id}.json`), JSON.stringify(data, null, 4), 'utf8');
    console.log(`Scritta frontend/tracks/${data.id}.json`);
}

if (require.main === module) {
    writeTrack(buildHairpinTrack());
    writeTrack(buildChicaneTrack());
}

module.exports = { buildHairpinTrack, buildChicaneTrack };
```

- [ ] **Step 2: Genera le piste**

Run: `node backend/tools/f1GenerateStressTracks.js`
Expected: 2 file scritti, nessun errore di validazione.

- [ ] **Step 3: Sanity check geometrico (ramo di ripiego, nessuna racing line ancora)**

Run: `node backend/tools/f1LapSimulator.js stress-hairpin` e `node backend/tools/f1LapSimulator.js stress-chicane`
Expected: entrambe completano un giro (`giro completato in ...ms`). Se una delle due NON completa (DNF) o lo script lancia un'eccezione, la geometria generata ha un problema (es. auto-intersezione) — aggiusta i parametri numerici nel generatore (es. raggi/ampiezze in `buildHairpinTrack`/`buildChicaneTrack`) e ripeti dallo Step 2 finché entrambe completano.

- [ ] **Step 4: Commit**

```bash
git add backend/tools/f1GenerateStressTracks.js frontend/tracks/stress-hairpin.json frontend/tracks/stress-chicane.json
git commit -m "F1: generatore + 2 piste-tortura per validare la generalizzazione (tornante stretto, chicane + box ad angolo)"
```

---

### Task 10: Validazione completa sulle piste-tortura

**Files:** nessuna modifica di codice — solo generazione dati ed esecuzione.

- [ ] **Step 1: Genera la racing line per entrambe le piste-tortura**

Run: `node backend/tools/f1RaceLineOptimizer.js stress-hairpin stress-chicane --hops=30`
Expected: 2 blocchi `RISULTATO: ...ms`, nessun crash.

- [ ] **Step 2: Verifica tempo sul giro**

Run: `node backend/tools/f1LapSimulator.js --all-tracks`
Expected: `stress-hairpin` e `stress-chicane` completano, incluse ora nell'elenco (`listTracks()` scansiona `frontend/tracks/`).

- [ ] **Step 3: Verifica ingresso ai box**

Run: `node backend/tools/f1PitEntryCheck.js stress-hairpin stress-chicane`
Expected: tutti i bot entrano su entrambe. Se una fallisce, tornare al Task 8 (aumentare `PIT_CONVERGENCE_LEAD_FACTOR` se il problema è di anticipo insufficiente, o rivedere la geometria generata se il problema è specifico a questa pista) prima di procedere.

- [ ] **Step 4: Pulizia — le piste-tortura non sono contenuto di gioco permanente**

Una volta che gli Step 1-3 sono tutti verdi, le piste-tortura hanno svolto il loro scopo (dimostrare la generalizzazione, non diventare piste giocabili nella lobby reale):

```bash
rm frontend/tracks/stress-hairpin.json frontend/tracks/stress-chicane.json backend/tools/stress-hairpin-raceline.json backend/tools/stress-chicane-raceline.json
```

Lo script generatore (`backend/tools/f1GenerateStressTracks.js`) resta in `backend/tools/` per rigenerarle in futuro se serve ripetere la validazione dopo un'altra modifica al bot.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/tracks backend/tools
git commit -m "F1: valida la generalizzazione su 2 piste-tortura (tornante stretto, chicane + box ad angolo), poi le rimuove"
```

---

## PARTE E — Chiudere il gap dall'umano

### Task 11: Riferimento umano, confronto, taratura margini

**Files:**
- Modify: `backend/tools/f1RaceLineOptimizer.js` (eventuale ampliamento dei limiti di `cornerSpeedMargin`/`brakingDistanceMargin` in `paramList`)
- Modify: `backend/tools/*-raceline.json` (rigenerate con i limiti eventualmente ampliati)

- [ ] **Step 1 (richiede l'utente): registrare un giro umano veloce per pista**

Chiedi all'utente di giocare una qualifica in localhost su ciascuna delle 4 piste reali (`new-monza`, `monte-rosso`, `prova`, `baku`) e riportare il tempo sul giro più veloce ottenuto (visibile nell'interfaccia di gioco). Annota questi 4 tempi come riferimento fisso per il resto del task.

- [ ] **Step 2: Confronta col tempo bot attuale**

Run: `node backend/tools/f1LapSimulator.js --all-tracks`
Per ogni pista, confronta il tempo bot con il riferimento umano dello Step 1. Se il bot è già uguale o più veloce su tutte, salta agli Step 5-6 (nessuna taratura necessaria, il gap è già chiuso dai Task 1-8).

- [ ] **Step 3: Amplia (con cautela) i limiti di ricerca dei margini, solo per le piste dove il bot resta più lento**

In `backend/tools/f1RaceLineOptimizer.js`, funzione `paramList`, sostituisci:

```javascript
        list.push({ get: () => state.cornerSpeedMargin, set: v => { state.cornerSpeedMargin = v; }, min: 0.80, max: 1.0, isLine: false });
        list.push({ get: () => state.brakingDistanceMargin, set: v => { state.brakingDistanceMargin = v; }, min: 0.85, max: 1.4, isLine: false });
```

con:

```javascript
        // Limiti ampliati (Rif. Task 11, chiusura gap dall'umano): margine=1.0
        // era il limite geometrico ESATTO, ma la velocità reale insegue
        // l'angolo con un filtro (GRIP<1 in updateVelocity — vedi commento su
        // BOT_CORNER_SPEED_MARGIN in f1Bot.js), quindi il raggio davvero
        // percorso è un po' più ampio di quello puramente geometrico: c'è
        // margine fisico per spingersi leggermente oltre 1.0/sotto 0.85 in
        // sicurezza. Va verificato per ogni pista con f1LapSimulator.js
        // (nessun DNF/testacoda) prima di accettare un valore fuori dal
        // vecchio range — non un ampliamento a sensazione.
        list.push({ get: () => state.cornerSpeedMargin, set: v => { state.cornerSpeedMargin = v; }, min: 0.80, max: 1.15, isLine: false });
        list.push({ get: () => state.brakingDistanceMargin, set: v => { state.brakingDistanceMargin = v; }, min: 0.75, max: 1.4, isLine: false });
```

- [ ] **Step 4: Rigenera solo le piste con gap residuo, verifica sicurezza**

Run: `node backend/tools/f1RaceLineOptimizer.js <trackId con gap> --hops=40` per ciascuna pista identificata allo Step 2.

Run: `node backend/tools/f1LapSimulator.js --all-tracks` — Expected: tutte le piste (incluse quelle NON toccate in questo step) completano ancora senza DNF, e le piste rigenerate mostrano un tempo minore o uguale a prima.

Se una pista rigenerata con i limiti ampliati va in DNF/testacoda in qualche condizione (verificabile anche rilanciando `f1LapSimulator.js` con `--precision-noise` diverso da 0 per simulare imprecisione), riportare i limiti di quella pista specifica più vicini ai valori originali (es. `max: 1.05` invece di `1.15`) e rigenerare di nuovo — fermarsi al primo valore sicuro trovato, non al più aggressivo possibile.

- [ ] **Step 5: Confronto finale e report all'utente**

Run: `node backend/tools/f1LapSimulator.js --all-tracks`
Presenta all'utente una tabella pista-per-pista: tempo bot vs riferimento umano (Step 1), indicando su quali piste il bot ora pareggia/batte il riferimento e su quali resta un gap residuo (se presente, dichiararlo esplicitamente invece di nasconderlo — l'obiettivo di questa fase è la trasparenza sul risultato, non un numero rassicurante).

- [ ] **Step 6: Commit**

```bash
git add backend/tools/f1RaceLineOptimizer.js backend/tools/new-monza-raceline.json backend/tools/monte-rosso-raceline.json backend/tools/prova-raceline.json backend/tools/baku-raceline.json
git commit -m "F1: amplia (con verifica di sicurezza) i limiti di ricerca dei margini per chiudere il gap dal riferimento umano"
```

---

## PARTE F — Regressione finale e playtest

### Task 12: Suite completa + playtest utente in localhost

**Files:** nessuna modifica — solo verifica.

- [ ] **Step 1: Regressione automatica completa**

Run (dalla root del progetto): `node --test backend/sockets/games/ backend/tools/ frontend/shared/`
Expected: PASS su tutta la suite, zero regressioni rispetto allo stato pre-Fase-1.

- [ ] **Step 2: Riavvia il server e verifica in localhost**

Chiedi all'utente di:
1. Riavviare `node server.js` dalla cartella `backend/` (necessario: le nuove racing line dei Task 6/11 sono in cache di processo).
2. Giocare almeno una gara completa con bot su ciascuna delle 4 piste reali (`new-monza`, `monte-rosso`, `prova`, `baku`), con usura gomme sufficiente a far scattare almeno un pit stop per bot.
3. Confermare per ognuna: i bot completano i giri senza uscire di pista in modo anomalo, i bot entrano fisicamente ai box quando devono pittare (il bug originale è quello che ha aperto questo intero piano), il ritmo dei bot è percepibilmente più simile a quello di un pilota forte rispetto a prima.

- [ ] **Step 3: Chiusura della Fase 1**

Solo dopo la conferma esplicita dell'utente allo Step 2, la Fase 1 (guida in solitaria al limite, su qualsiasi pista, bug dei box incluso) si considera chiusa. La Fase 2 (comportamento con altre auto: sorpassi/difesa/niente incidenti di gruppo, fino al punto di poter vincere una gara) è un piano successivo, da avviare in una sessione dedicata.
