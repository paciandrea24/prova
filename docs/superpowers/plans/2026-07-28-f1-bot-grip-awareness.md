# F1 — IA bot: grip-awareness in guida (cornering + frenata) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il bot IA F1 consulta la capacità laterale reale (usura+downforce+danno) e la decelerazione di frenata reale (usura) per calcolare velocità in curva e punto di frenata, invece dei valori puramente cinematici/costanti usati oggi — dietro un flag dedicato, letto solo dal codice del bot, spento di default.

**Architettura:** Estensione del pattern di dependency-injection già in uso (`f1GameSocket.js` passa funzioni fisiche già pronte a `f1Bot.js` via l'oggetto `deps` di `updateBotInputs`). Una funzione nuova ma non nuova formula (`CorneringGripModel.corneringCapacity`, estratta da codice già esistente in `lateralExcess`), una funzione già esistente riusata (`BrakingModel.effectiveBrakeMult`, già esportata da `VehiclePhysics`). Il bot non fa mai `require` di `backend/sockets/games/physics/*`.

**Tech Stack:** Node.js, `node:test` + `node:assert/strict` (stile test già in uso nel progetto).

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-07-28-f1-bot-grip-awareness-design.md` — ogni task implicitamente ne eredita i requisiti.
- `corneringCapacity` è un **moltiplicatore relativo** alla capacità laterale (non un grip assoluto) — va documentato come tale nel codice.
- `BrakingModel.effectiveBrakeMult` è la **fonte UNICA** della fisica di frenata consultata dal bot — nessuna formula di decelerazione-da-usura duplicata in `f1Bot.js`.
- La scala `gripCapacityFactor → cornerTargetSpeed` NON è assunta 1:1: passa da `Math.pow(gripCapacityFactor, BOT_GRIP_CAPACITY_EXPONENT)`, con `BOT_GRIP_CAPACITY_EXPONENT = 1` come valore di partenza esplicitamente tunabile, non un fatto derivato.
- `F1_BOT_GRIP_AWARENESS` va letto **esclusivamente** dentro `backend/sockets/games/f1Bot.js`, mai in `backend/sockets/games/physics/*`.
- Flag **spento di default** (`process.env.F1_BOT_GRIP_AWARENESS === '1'` per attivarlo) — stessa disciplina di ogni fase precedente (Aero, TyreSlip, CorneringGripModel prima della promozione).
- `otherCarTargetSpeed` (stima del ritmo dell'auto avanti per i sorpassi) resta **byte-identica** a oggi in ogni condizione di flag — fuori scope esplicito.
- Nessun commit fino a fine piano (l'utente si ferma dopo i test, prima di un eventuale commit).

---

## File Structure

| File | Ruolo in questo piano |
|---|---|
| `backend/sockets/games/physics/CorneringGripModel.js` | Estrae `corneringCapacity(p, isQuali, maxSpeed)` da `lateralExcess` (Task 1). |
| `backend/sockets/games/physics/CorneringGripModel.test.js` | Regressione dell'estrazione (Task 1). |
| `backend/sockets/games/physics/VehiclePhysics.js` | Ri-esporta `corneringCapacity` (Task 2), stesso pattern di `effectiveBrakeMult`. |
| `backend/sockets/games/f1GameSocket.js` | Aggiunge `corneringCapacity`/`effectiveBrakeMult` all'oggetto `deps` del bot (Task 3). |
| `backend/sockets/games/f1Bot.js` | Flag, costante esponente, nuovo parametro `cornerTargetSpeed`, wiring per-bot di `brakeDecel`/`gripCapacityFactor` (Task 4-5). |
| `backend/sockets/games/f1Bot.test.js` | Test del nuovo parametro e del comportamento del bot a flag on/off (Task 4-5). |

---

### Task 1: `CorneringGripModel.corneringCapacity` — estrazione pura

**Files:**
- Modify: `backend/sockets/games/physics/CorneringGripModel.js:27-36`
- Test: `backend/sockets/games/physics/CorneringGripModel.test.js`

**Interfaces:**
- Produces: `corneringCapacity(p, isQuali, maxSpeed) → number` — moltiplicatore relativo alla capacità laterale (usura × downforce, se attiva), stessa scala già usata internamente da `lateralExcess`. Esportata da `CorneringGripModel`.
- Consumes: nessuna nuova dipendenza — `corneringGripFactor` (già importata) e `AerodynamicsModel.isAeroDownforceModelActive`/`downforceFactor` (già importate).

- [ ] **Step 1: Scrivi il test di regressione (fallirà: la funzione non esiste ancora)**

Aggiungi in fondo a `backend/sockets/games/physics/CorneringGripModel.test.js` (dopo l'ultimo test esistente):

```js
// ---- Estrazione corneringCapacity (Rif.
// docs/superpowers/specs/2026-07-28-f1-bot-grip-awareness-design.md):
// stessa formula già usata inline da lateralExcess, ora esposta come
// funzione a sé per essere consultata anche dal bot IA. Zero cambio di
// comportamento: lateralExcess deve produrre risultati identici a prima
// dell'estrazione. ----

test('corneringCapacity: coincide con la capacità calcolata a mano (usura + downforce)', () => {
    const p = makePlayer(1, 6.2, 80);
    const expected = corneringGripFactor(80, false) * AerodynamicsModel.downforceFactor(1, false);
    assertClose(corneringCapacity(p, false, 6.2), expected, 'corneringCapacity = corneringGripFactor * downforceFactor');
});

test('corneringCapacity: isQuali=true -> sempre 1 (stesso invariante di TyreForceModel/downforceFactor)', () => {
    const p = makePlayer(1, 6.2, 80);
    assertClose(corneringCapacity(p, true, 6.2), 1, 'capacità sempre piena in qualifica');
});

test('corneringCapacity: F1_AERO_DOWNFORCE_MODEL="0" -> solo corneringGripFactor, nessun contributo downforce', () => {
    process.env.F1_AERO_DOWNFORCE_MODEL = '0';
    try {
        const p = makePlayer(1, 6.2, 80);
        assertClose(corneringCapacity(p, false, 6.2), corneringGripFactor(80, false), 'rollback -> solo usura');
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
    }
});

test('lateralExcess: dopo l\'estrazione, produce ancora lo stesso risultato di corneringExcess(steer, speedFrac, corneringCapacity(...))', () => {
    const scenarios = [
        makePlayer(1, 6.2, 0), makePlayer(1, 6.2, 80), makePlayer(0.5, 3.1, 50),
        makePlayer(1, 0, 80), makePlayer(1, -6.2, 80)
    ];
    for (const p of scenarios) {
        const speedFrac = Math.min(1, Math.abs(p.speed) / 6.2);
        const expected = corneringExcess(p.inputs.steer, speedFrac, corneringCapacity(p, false, 6.2));
        assertClose(lateralExcess(p, false, 6.2), expected, `lateralExcess deve derivare da corneringCapacity per speed=${p.speed}, wear=${p.tyreWear}`);
    }
});
```

Aggiorna l'import in cima al file:

```js
const { lateralExcess, corneringCapacity } = require('./CorneringGripModel');
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `node --test backend/sockets/games/physics/CorneringGripModel.test.js`
Expected: FAIL — `corneringCapacity is not a function` (o `undefined`).

- [ ] **Step 3: Estrai `corneringCapacity` in `CorneringGripModel.js`**

Sostituisci il corpo di `lateralExcess` (righe 27-34) con:

```js
// Contributo relativo alla capacità laterale (moltiplicatore adimensionale
// ~1 = nominale, <1 = usura, fino a +15% con downforce ad alta velocità,
// scontato da danno al fondo se F1_AERO_DAMAGE_MODEL attivo) — NON un
// valore di grip assoluto, la stessa scala già usata come termine di
// corneringExcess sotto. Estratta da qui (era inline) per essere
// consultata anche dal bot IA (Rif.
// docs/superpowers/specs/2026-07-28-f1-bot-grip-awareness-design.md) senza
// duplicare la formula.
function corneringCapacity(p, isQuali, maxSpeed) {
    const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
    let capacity = corneringGripFactor(p.tyreWear, isQuali);
    if (AerodynamicsModel.isAeroDownforceModelActive()) {
        capacity *= AerodynamicsModel.downforceFactor(speedFrac, isQuali, p.damageParts);
    }
    return capacity;
}

function lateralExcess(p, isQuali, maxSpeed) {
    const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
    return corneringExcess(p.inputs.steer, speedFrac, corneringCapacity(p, isQuali, maxSpeed));
}
```

Aggiorna `module.exports` (riga 36):

```js
module.exports = { lateralExcess, corneringCapacity };
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `node --test backend/sockets/games/physics/CorneringGripModel.test.js`
Expected: PASS, tutti i test (nuovi e preesistenti).

- [ ] **Step 5: Commit**

```bash
git add backend/sockets/games/physics/CorneringGripModel.js backend/sockets/games/physics/CorneringGripModel.test.js
git commit -m "F1: estrae CorneringGripModel.corneringCapacity da lateralExcess (nessun cambio di formula)"
```

---

### Task 2: `VehiclePhysics` — ri-esporta `corneringCapacity`

**Files:**
- Modify: `backend/sockets/games/physics/VehiclePhysics.js:14,76-79`

**Interfaces:**
- Consumes: `CorneringGripModel.corneringCapacity` (Task 1).
- Produces: `VehiclePhysics.corneringCapacity` — stesso pattern di `effectiveBrakeMult`/`effectiveMaxSpeed` già ri-esportati da questo file.

- [ ] **Step 1: Aggiungi `corneringCapacity` al destructure di `CorneringGripModel`**

In `backend/sockets/games/physics/VehiclePhysics.js`, la riga 14 importa `CorneringGripModel` come namespace intero (`const CorneringGripModel = require('./CorneringGripModel');`) — nessuna modifica a quella riga. Aggiungi invece una costante locale subito sotto le altre destructure (dopo la riga 21, `const { GRIP, effectiveGrip } = AerodynamicsModel;`):

```js
const { corneringCapacity } = CorneringGripModel;
```

- [ ] **Step 2: Aggiungi `corneringCapacity` a `module.exports`**

Modifica il blocco finale (righe 76-79):

```js
module.exports = {
    MAX_SPEED, ACCEL, FRICTION, TURN_SPEED_LOW, TURN_SPEED_HIGH, GRIP, BRAKE_MULT,
    effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult, corneringCapacity,
    updateVelocity, integratePosition, applyOffTrackDrag
};
```

- [ ] **Step 3: Verifica che nessun test esistente si rompa**

Run: `node --test backend/sockets/games/physics/VehiclePhysics.test.js`
Expected: PASS (nessun test esistente dipende dal contenuto esatto di `module.exports`, solo aggiunta additiva).

- [ ] **Step 4: Commit**

```bash
git add backend/sockets/games/physics/VehiclePhysics.js
git commit -m "F1: VehiclePhysics ri-esporta corneringCapacity (stesso pattern di effectiveBrakeMult)"
```

---

### Task 3: `f1GameSocket.js` — wiring nei `deps` del bot

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js:23-26,877-882`

**Interfaces:**
- Consumes: `VehiclePhysics.corneringCapacity` (Task 2), `VehiclePhysics.effectiveBrakeMult` (già esistente, già importata a riga 25 ma non ancora passata al bot).
- Produces: `deps.corneringCapacity`, `deps.effectiveBrakeMult` disponibili dentro `updateBotInputs` (consumati da Task 5).

- [ ] **Step 1: Aggiungi `corneringCapacity` al destructure di `VehiclePhysics`**

In `backend/sockets/games/f1GameSocket.js`, righe 23-26, oggi:

```js
const {
    ACCEL, BRAKE_MULT, TURN_SPEED_HIGH,
    effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult
} = VehiclePhysics;
```

Sostituisci con:

```js
const {
    ACCEL, BRAKE_MULT, TURN_SPEED_HIGH,
    effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult, corneringCapacity
} = VehiclePhysics;
```

- [ ] **Step 2: Passa entrambe le funzioni ai `deps` del bot**

Righe 877-882, oggi:

```js
    updateBotInputs(game, {
        effectiveMaxSpeed, handlePitReactionPress, io, lobbyId,
        wearLapsAtMedium: WEAR_LAPS_AT_MEDIUM,
        accel: ACCEL, brakeMult: BRAKE_MULT, turnRateHigh: TURN_SPEED_HIGH,
        slipstreamMaxBoost: SLIPSTREAM_MAX_BOOST
    });
```

Sostituisci con:

```js
    updateBotInputs(game, {
        effectiveMaxSpeed, handlePitReactionPress, io, lobbyId,
        wearLapsAtMedium: WEAR_LAPS_AT_MEDIUM,
        accel: ACCEL, brakeMult: BRAKE_MULT, turnRateHigh: TURN_SPEED_HIGH,
        slipstreamMaxBoost: SLIPSTREAM_MAX_BOOST,
        // Grip-awareness (Rif. docs/superpowers/specs/2026-07-28-f1-bot-grip-awareness-design.md):
        // passate sempre, il flag F1_BOT_GRIP_AWARENESS che decide se il
        // bot le consulta vive SOLO in f1Bot.js, mai qui.
        effectiveBrakeMult, corneringCapacity
    });
```

- [ ] **Step 3: Verifica che il server si avvii senza errori**

Run (dalla cartella `backend/`): `node -e "require('./sockets/games/f1GameSocket.js'); console.log('OK: modulo caricato senza errori')"`
Expected: stampa `OK: modulo caricato senza errori`, nessuna eccezione di `require`/destructure.

- [ ] **Step 4: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js
git commit -m "F1: passa effectiveBrakeMult/corneringCapacity ai deps del bot IA"
```

---

### Task 4: `f1Bot.js` — flag, costante esponente, nuovo parametro `cornerTargetSpeed`

**Files:**
- Modify: `backend/sockets/games/f1Bot.js:42-43,225-242,895-901`
- Test: `backend/sockets/games/f1Bot.test.js`

**Interfaces:**
- Produces: `isBotGripAwarenessActive() → boolean` (esportata), `BOT_GRIP_CAPACITY_EXPONENT` (costante, non esportata — uso interno), `cornerTargetSpeed(..., gripCapacityFactor = 1)` (11° parametro opzionale, retrocompatibile).
- Consumes: nessuna nuova dipendenza esterna in questo task (il wiring dei `deps` è Task 5).

- [ ] **Step 1: Scrivi i test per il nuovo parametro (falliranno: non esiste ancora)**

Aggiungi in `backend/sockets/games/f1Bot.test.js`, subito dopo il test esistente `'cornerTargetSpeed: già più lenti del necessario...'` (circa riga 291):

```js
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

test('isBotGripAwarenessActive: spento di default', () => {
    delete process.env.F1_BOT_GRIP_AWARENESS;
    assert.equal(isBotGripAwarenessActive(), false);
});

test('isBotGripAwarenessActive: attivo solo con "1" esplicito', () => {
    process.env.F1_BOT_GRIP_AWARENESS = '1';
    try {
        assert.equal(isBotGripAwarenessActive(), true);
    } finally {
        delete process.env.F1_BOT_GRIP_AWARENESS;
    }
    process.env.F1_BOT_GRIP_AWARENESS = 'true';   // non "1" esatto -> resta spento
    try {
        assert.equal(isBotGripAwarenessActive(), false, 'solo "1" esatto attiva il flag, stesso pattern di F1_CORNERING_GRIP_MODEL');
    } finally {
        delete process.env.F1_BOT_GRIP_AWARENESS;
    }
});
```

Aggiorna l'import in cima al file (riga 4-9):

```js
const {
    PALETTE, normalizeAngle, steerToward, lookaheadIndex, apexOffset,
    cornerTargetSpeed, windowRadius, cornerApexNear, overtakeOffset, nearestAheadPlayer,
    pickPostPitCompound, pickBotColors, estimateFinishTime,
    updateBotInputs, DEFAULT_TUNING, shouldBotRepair, isBotGripAwarenessActive
} = require('./f1Bot.js');
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: FAIL sui 5 nuovi test (`gripCapacityFactor` extra viene ignorato dalla firma attuale — i primi 2 test falliranno per `worn`/`boosted` uguali a `full` invece che diversi; `isBotGripAwarenessActive` non è una funzione esportata).

- [ ] **Step 3: Aggiungi la costante esponente e il flag in `f1Bot.js`**

Subito dopo `BOT_CORNER_SPEED_MARGIN` (riga 42), aggiungi:

```js
// Esponente di scala tra corneringCapacity (moltiplicatore relativo alla
// capacità laterale, tarato come termine di corneringExcess — MAI
// validato come moltiplicatore diretto di una velocità) e cornerTargetSpeed
// (limite cinematico di tasso di sterzata, non di accelerazione laterale):
// assumere una proporzionalità 1:1 tra i due è una scelta di design, non
// un fatto derivato (un vero limite v=√(a_lat×r) scalerebbe con la radice,
// non linearmente). Valore di partenza 1 (proporzionalità diretta),
// verificato via simulazione headless prima del playtest — stesso stile
// di DOWNFORCE_EXPONENT/CORNERING_EXPONENT in AerodynamicsModel.js/
// TyreForceModel.js. Rif.
// docs/superpowers/specs/2026-07-28-f1-bot-grip-awareness-design.md.
const BOT_GRIP_CAPACITY_EXPONENT = 1;

// Flag dedicato, letto SOLO qui in f1Bot.js: la fisica reale
// (VehiclePhysics/CorneringGripModel/BrakingModel) resta invariata
// indipendentemente da questo flag, che riguarda solo se il BOT consulta
// i loro fattori già esistenti per calcolare i propri input — esattamente
// come un umano non ha mai bisogno di un flag per "sapere" quanto frena
// la propria auto. Default OFF: nessuna promozione a default-on senza
// playtest esplicito (stesso pattern di isCorneringGripModelActive).
function isBotGripAwarenessActive() {
    return process.env.F1_BOT_GRIP_AWARENESS === '1';
}
```

- [ ] **Step 4: Aggiungi il parametro `gripCapacityFactor` a `cornerTargetSpeed`**

Riga 225, oggi:

```js
function cornerTargetSpeed(points, idx, scanSamples, localSamples, metersPerSample, currentSpeed, maxSpeed, brakeDecel, turnRateAtMax, marginFactor) {
```

Sostituisci con:

```js
function cornerTargetSpeed(points, idx, scanSamples, localSamples, metersPerSample, currentSpeed, maxSpeed, brakeDecel, turnRateAtMax, marginFactor, gripCapacityFactor = 1) {
```

Riga 235, oggi:

```js
        const cornerSpeed = Math.min(maxSpeed, w.radius * turnRateAtMax * marginFactor);
```

Sostituisci con:

```js
        // gripCapacityFactor arriva già scalato dal chiamante (vedi
        // BOT_GRIP_CAPACITY_EXPONENT in updateBotInputs) — qui è solo un
        // moltiplicatore diretto, nessuna logica di scala in questa funzione.
        const cornerSpeed = Math.min(maxSpeed, w.radius * turnRateAtMax * marginFactor * gripCapacityFactor);
```

- [ ] **Step 5: Esporta `isBotGripAwarenessActive`**

Riga 895-901, oggi termina con:

```js
module.exports = {
    PALETTE, MAX_GRID_SIZE, DEFAULT_TUNING,
    BOT_RACE_START_REACTION_MIN_MS, BOT_RACE_START_REACTION_MAX_MS,
    normalizeAngle, steerToward, lookaheadIndex, apexOffset, windowRadius, cornerApexNear, cornerTargetSpeed, overtakeOffset,
    nearestAheadPlayer, otherCarTargetSpeed, pickPostPitCompound, pickBotColors, estimateFinishTime,
    createBots, updateBotInputs, shouldBotRepair
};
```

Sostituisci con:

```js
module.exports = {
    PALETTE, MAX_GRID_SIZE, DEFAULT_TUNING,
    BOT_RACE_START_REACTION_MIN_MS, BOT_RACE_START_REACTION_MAX_MS,
    normalizeAngle, steerToward, lookaheadIndex, apexOffset, windowRadius, cornerApexNear, cornerTargetSpeed, overtakeOffset,
    nearestAheadPlayer, otherCarTargetSpeed, pickPostPitCompound, pickBotColors, estimateFinishTime,
    createBots, updateBotInputs, shouldBotRepair, isBotGripAwarenessActive
};
```

- [ ] **Step 6: Esegui i test e verifica che passino**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: PASS, tutti i test (nuovi e preesistenti — nessuna chiamata esistente a `cornerTargetSpeed` passa già 11 argomenti, quindi tutte ricadono sul default `1`).

- [ ] **Step 7: Commit**

```bash
git add backend/sockets/games/f1Bot.js backend/sockets/games/f1Bot.test.js
git commit -m "F1 bot: aggiunge gripCapacityFactor (default 1) a cornerTargetSpeed + flag F1_BOT_GRIP_AWARENESS"
```

---

### Task 5: `f1Bot.js` — wiring per-bot in `updateBotInputs`

**Files:**
- Modify: `backend/sockets/games/f1Bot.js:597-606,673-675,738,748-753,773,803,819,841-844,867`
- Test: `backend/sockets/games/f1Bot.test.js`

**Interfaces:**
- Consumes: `deps.effectiveBrakeMult`, `deps.corneringCapacity` (Task 3), `isBotGripAwarenessActive()` e `BOT_GRIP_CAPACITY_EXPONENT` (Task 4).
- Produces: comportamento finale del bot — nessuna nuova funzione pubblica, solo wiring interno a `updateBotInputs`.

- [ ] **Step 1: Scrivi i test di parità/differenziazione (falliranno: il wiring non esiste ancora)**

Aggiungi in `backend/sockets/games/f1Bot.test.js`. Serve un player e un `game`/`deps` minimi coerenti con quelli già usati dai test esistenti di `updateBotInputs` in questo file — controlla gli helper già presenti (`buildConstantCurveTrack`, eventuali `makeGame`/`makeBotPlayer` già definiti più in basso nel file) e riusali invece di duplicarli. Se non esiste già un helper che costruisce un `game` completo con un bot su un tracciato dritto/curvo per testare `updateBotInputs` end-to-end, aggiungine uno minimo:

```js
// Costruisce un game/bot minimo su un tornante fisso (stessa geometria di
// buildConstantCurveTrack), per testare updateBotInputs end-to-end senza
// passare da un vero trackLoader. isQuali di default false (gara: l'unico
// contesto dove tyreWear/effectiveBrakeMult hanno effetto).
function makeGripAwarenessGame(tyreWear, phase = 'race') {
    const points = buildConstantCurveTrack(80, 10, 1 / 20);
    const track = {
        points, roadHalf: 8, lapLength: points.length, totalLaps: 3,
        pitEntryIndex: 9999, pitPath: [{ x: 0, z: 0 }, { x: 0, z: 0 }]
    };
    const p = {
        isBot: true, finished: false, x: points[5].x, z: points[5].z, angle: 0,
        speed: 6, vx: 0, vz: 0, trackIndex: 5, lap: 0, tyreWear, damage: 0,
        botSpeedFactor: 1, botLapPaceMult: 1, botPrecisionNoise: 0,
        botPitThreshold: 100, inputs: { throttle: 0, brake: 0, steer: 0 }
    };
    const game = { phase, track, players: { bot1: p } };
    return { game, p };
}

function makeGripAwarenessDeps(extra = {}) {
    return {
        effectiveMaxSpeed: () => 6, handlePitReactionPress: () => {}, io: {}, lobbyId: 'test',
        wearLapsAtMedium: 5, accel: 1, brakeMult: 1, turnRateHigh: 0.05,
        slipstreamMaxBoost: 0,
        effectiveBrakeMult: (pl, isQuali) => isQuali ? 1 : 1 - pl.tyreWear / 200,   // dimezza a wear=100, come TyreForceModel reale in scala
        corneringCapacity: (pl, isQuali, maxSpeed) => isQuali ? 1 : 1 - pl.tyreWear / 200,
        ...extra
    };
}

// updateBotInputs ri-estrae botLapPaceMult (±4% random) alla prima chiamata
// per ogni bot (p.botLapSeen parte undefined, vedi f1Bot.js:626-631) — con
// Math.random() reale due chiamate separate (fresh vs worn) prenderebbero
// scarti diversi, rendendo i confronti assert.deepEqual sotto inaffidabili
// (falsi positivi/negativi indipendenti dalla grip-awareness). Fissare
// Math.random()=0.5 per la durata della chiamata rende lo scarto
// esattamente 0 (1 + (0.5*2-1)*VARIANCE = 1) in modo deterministico.
function withFixedRandom(fn) {
    const orig = Math.random;
    Math.random = () => 0.5;
    try { return fn(); } finally { Math.random = orig; }
}

test('updateBotInputs: F1_BOT_GRIP_AWARENESS spento -> comportamento identico indipendentemente da tyreWear', () => {
    delete process.env.F1_BOT_GRIP_AWARENESS;
    const fresh = makeGripAwarenessGame(0);
    const worn = makeGripAwarenessGame(90);
    withFixedRandom(() => updateBotInputs(fresh.game, makeGripAwarenessDeps()));
    withFixedRandom(() => updateBotInputs(worn.game, makeGripAwarenessDeps()));
    assert.deepEqual(worn.p.inputs, fresh.p.inputs, 'a flag spento tyreWear non deve influenzare gli input del bot');
});

test('updateBotInputs: F1_BOT_GRIP_AWARENESS acceso -> gomma usurata frena/rallenta prima di gomma fresca', () => {
    process.env.F1_BOT_GRIP_AWARENESS = '1';
    try {
        const fresh = makeGripAwarenessGame(0);
        const worn = makeGripAwarenessGame(90);
        withFixedRandom(() => updateBotInputs(fresh.game, makeGripAwarenessDeps()));
        withFixedRandom(() => updateBotInputs(worn.game, makeGripAwarenessDeps()));
        assert.notDeepEqual(worn.p.inputs, fresh.p.inputs, 'a flag acceso tyreWear deve influenzare gli input del bot');
    } finally {
        delete process.env.F1_BOT_GRIP_AWARENESS;
    }
});

test('updateBotInputs: F1_BOT_GRIP_AWARENESS acceso ma isQuali=true -> identico a flag spento (usura neutra in qualifica)', () => {
    process.env.F1_BOT_GRIP_AWARENESS = '1';
    try {
        const fresh = makeGripAwarenessGame(0, 'qualifying');
        const worn = makeGripAwarenessGame(90, 'qualifying');
        withFixedRandom(() => updateBotInputs(fresh.game, makeGripAwarenessDeps()));
        withFixedRandom(() => updateBotInputs(worn.game, makeGripAwarenessDeps()));
        assert.deepEqual(worn.p.inputs, fresh.p.inputs, 'in qualifica il flag non deve produrre differenze di usura');
    } finally {
        delete process.env.F1_BOT_GRIP_AWARENESS;
    }
});

test('updateBotInputs: gomma nuova (tyreWear=0) a flag acceso non è più prudente della gomma nuova a flag spento', () => {
    // corneringCapacity/effectiveBrakeMult a tyreWear=0 restano 1 (nominali,
    // nessuna riduzione da usura): il flag acceso non deve MAI produrre un
    // throttle più basso o un brake più alto rispetto al flag spento in
    // questa condizione — altrimenti la scala di BOT_GRIP_CAPACITY_EXPONENT
    // (o il segno del wiring) sarebbe sbagliata.
    delete process.env.F1_BOT_GRIP_AWARENESS;
    const off = makeGripAwarenessGame(0);
    withFixedRandom(() => updateBotInputs(off.game, makeGripAwarenessDeps()));
    process.env.F1_BOT_GRIP_AWARENESS = '1';
    try {
        const on = makeGripAwarenessGame(0);
        withFixedRandom(() => updateBotInputs(on.game, makeGripAwarenessDeps()));
        assert.deepEqual(on.p.inputs, off.p.inputs, 'gomma nuova: nessuna differenza tra flag on/off, il bot non deve diventare più cauto senza motivo fisico');
    } finally {
        delete process.env.F1_BOT_GRIP_AWARENESS;
    }
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: FAIL sui 4 nuovi test (oggi `updateBotInputs` ignora `deps.effectiveBrakeMult`/`deps.corneringCapacity` e non legge mai `F1_BOT_GRIP_AWARENESS` — `tyreWear` non ha alcun effetto sugli input in nessun caso, quindi il secondo test in particolare fallisce).

- [ ] **Step 3: Destruttura le nuove dependency e rinomina `brakeDecel` in `legacyBrakeDecel`**

Riga 597-606, oggi:

```js
function updateBotInputs(game, deps) {
    const {
        effectiveMaxSpeed, handlePitReactionPress, io, lobbyId, wearLapsAtMedium,
        accel, brakeMult, turnRateHigh, tuning: tuningOverrides, slipstreamMaxBoost
    } = deps;
    const tuning = { ...DEFAULT_TUNING, ...(tuningOverrides || {}) };
    const track = game.track;
    const isQuali = game.phase === 'qualifying';
    const metersPerSample = track.lapLength / track.points.length;
    const brakeDecel = accel * brakeMult;   // stessa decelerazione di frenata usata dalla fisica reale
```

Sostituisci con:

```js
function updateBotInputs(game, deps) {
    const {
        effectiveMaxSpeed, handlePitReactionPress, io, lobbyId, wearLapsAtMedium,
        accel, brakeMult, turnRateHigh, tuning: tuningOverrides, slipstreamMaxBoost,
        effectiveBrakeMult, corneringCapacity
    } = deps;
    const tuning = { ...DEFAULT_TUNING, ...(tuningOverrides || {}) };
    const track = game.track;
    const isQuali = game.phase === 'qualifying';
    const metersPerSample = track.lapLength / track.points.length;
    // Decelerazione "storica" (costante, non wear-aware): resta l'unica
    // usata da otherCarTargetSpeed (stima del ritmo dell'auto avanti per i
    // sorpassi, esplicitamente fuori scope in questa fase — vedi spec) per
    // garantire che quel calcolo resti byte-identico a prima.
    const legacyBrakeDecel = accel * brakeMult;
```

- [ ] **Step 4: Calcola `brakeDecel`/`gripCapacityFactor` per-bot dentro il loop**

Riga 673-675 (subito prima di `let steer, throttle = 0, brake = 0;`), oggi:

```js
        const n = track.points.length;
        const idxUntilPitEntry = ((track.pitEntryIndex - (p.trackIndex || 0)) % n + n) % n;
        const nearPitEntry = p.botHeadingToPits &&
            idxUntilPitEntry <= metersToSamples(BOT_PIT_APPROACH_M, track);

        let steer, throttle = 0, brake = 0;
```

Sostituisci con:

```js
        const n = track.points.length;
        const idxUntilPitEntry = ((track.pitEntryIndex - (p.trackIndex || 0)) % n + n) % n;
        const nearPitEntry = p.botHeadingToPits &&
            idxUntilPitEntry <= metersToSamples(BOT_PIT_APPROACH_M, track);

        // Grip-awareness (Rif. docs/superpowers/specs/2026-07-28-f1-bot-grip-awareness-design.md):
        // a flag spento (default) resta legacyBrakeDecel, byte-identico a
        // oggi. effectiveBrakeMult è l'UNICA fonte della fisica di frenata
        // qui: nessuna formula di decelerazione-da-usura propria.
        const brakeDecel = isBotGripAwarenessActive()
            ? accel * effectiveBrakeMult(p, isQuali)
            : legacyBrakeDecel;

        let steer, throttle = 0, brake = 0;
```

- [ ] **Step 5: Ramo racing-line — calcola `gripCapacityFactor` e passalo a `cornerTargetSpeed`**

Riga 738 (dentro `else if (track.racingLine) {`), oggi:

```js
            const maxSpeed = effectiveMaxSpeed(p, isQuali) * (p.inSlipstream ? (1 + (slipstreamMaxBoost || 0)) : 1);
            const speedMs  = Math.max(5, botSpeedMs(p.speed));
```

Sostituisci con:

```js
            const maxSpeed = effectiveMaxSpeed(p, isQuali) * (p.inSlipstream ? (1 + (slipstreamMaxBoost || 0)) : 1);
            // Grip-awareness: a flag spento resta 1 (nessun effetto).
            // corneringCapacity è un moltiplicatore RELATIVO alla capacità
            // laterale (non un grip assoluto) — la scala verso una velocità
            // non è assunta 1:1, vedi BOT_GRIP_CAPACITY_EXPONENT.
            const gripCapacityFactor = isBotGripAwarenessActive()
                ? Math.pow(corneringCapacity(p, isQuali, maxSpeed), BOT_GRIP_CAPACITY_EXPONENT)
                : 1;
            const speedMs  = Math.max(5, botSpeedMs(p.speed));
```

Poi, righe 750-753, oggi:

```js
            let targetSpeed = cornerTargetSpeed(
                track.racingLine, p.trackIndex || 0, scanSamples, localSamples, metersPerSample,
                p.speed, maxSpeed, brakeDecel, turnRateHigh, rt.cornerSpeedMargin
            ) * p.botSpeedFactor * p.botLapPaceMult;
```

Sostituisci con:

```js
            let targetSpeed = cornerTargetSpeed(
                track.racingLine, p.trackIndex || 0, scanSamples, localSamples, metersPerSample,
                p.speed, maxSpeed, brakeDecel, turnRateHigh, rt.cornerSpeedMargin, gripCapacityFactor
            ) * p.botSpeedFactor * p.botLapPaceMult;
```

E riga 773 (chiamata a `otherCarTargetSpeed` dentro lo stesso ramo, fuori scope — deve restare su `legacyBrakeDecel`), oggi:

```js
                        ahead.player, track.racingLine, track, metersPerSample, brakeDecel, turnRateHigh,
```

Sostituisci con:

```js
                        ahead.player, track.racingLine, track, metersPerSample, legacyBrakeDecel, turnRateHigh,
```

- [ ] **Step 6: Ramo fallback geometrico — stessa modifica**

Riga 803 (dentro il ramo `else {` del fallback), oggi:

```js
            const maxSpeed = effectiveMaxSpeed(p, isQuali) * (p.inSlipstream ? (1 + (slipstreamMaxBoost || 0)) : 1);
            const speedMs  = Math.max(5, botSpeedMs(p.speed));   // floor: niente lookahead quasi-zero da fermi (es. alla partenza)
```

Sostituisci con:

```js
            const maxSpeed = effectiveMaxSpeed(p, isQuali) * (p.inSlipstream ? (1 + (slipstreamMaxBoost || 0)) : 1);
            // Grip-awareness: stessa logica del ramo racing-line sopra.
            const gripCapacityFactor = isBotGripAwarenessActive()
                ? Math.pow(corneringCapacity(p, isQuali, maxSpeed), BOT_GRIP_CAPACITY_EXPONENT)
                : 1;
            const speedMs  = Math.max(5, botSpeedMs(p.speed));   // floor: niente lookahead quasi-zero da fermi (es. alla partenza)
```

Righe 841-844, oggi:

```js
            let targetSpeed = cornerTargetSpeed(
                track.points, p.trackIndex || 0, scanSamples, localSamples, metersPerSample,
                p.speed, maxSpeed, brakeDecel, turnRateHigh, tuning.cornerSpeedMargin
            ) * p.botSpeedFactor * p.botLapPaceMult;
```

Sostituisci con:

```js
            let targetSpeed = cornerTargetSpeed(
                track.points, p.trackIndex || 0, scanSamples, localSamples, metersPerSample,
                p.speed, maxSpeed, brakeDecel, turnRateHigh, tuning.cornerSpeedMargin, gripCapacityFactor
            ) * p.botSpeedFactor * p.botLapPaceMult;
```

Riga 867 (chiamata a `otherCarTargetSpeed` nel ramo fallback, fuori scope), oggi:

```js
                        ahead.player, track.points, track, metersPerSample, brakeDecel, turnRateHigh,
```

Sostituisci con:

```js
                        ahead.player, track.points, track, metersPerSample, legacyBrakeDecel, turnRateHigh,
```

- [ ] **Step 7: Esegui i test e verifica che passino**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: PASS, tutti i test (nuovi Task 4 + Task 5, e preesistenti).

- [ ] **Step 8: Esegui l'intera suite backend per verificare che nulla si sia rotto altrove**

Run (dalla cartella `backend/`): `node --test`
Expected: PASS su tutti i file `*.test.js` (in particolare `f1GameSocket.physics.test.js`, `CorneringGripModel.test.js`, `VehiclePhysics.test.js`, `f1Bot.test.js`) — nessuna regressione, flag `F1_BOT_GRIP_AWARENESS`/`F1_AERO_*`/`F1_CORNERING_GRIP_MODEL` non impostati durante l'esecuzione standard.

- [ ] **Step 9: Commit**

```bash
git add backend/sockets/games/f1Bot.js backend/sockets/games/f1Bot.test.js
git commit -m "F1 bot: grip-awareness in updateBotInputs (cornering + frenata), dietro F1_BOT_GRIP_AWARENESS"
```

---

### Task 6: Verifica architetturale + verifica headless (worn vs fresh, no over-conservatism)

**Files:**
- Nessuna modifica di codice — solo verifica ed eventuale report.

**Interfaces:**
- Consumes: tutto quanto implementato nei Task 1-5.
- Produces: conferma scritta (in chat, non in un nuovo file) che gli invarianti della spec reggono con dati reali, non solo unit test sintetici.

- [ ] **Step 1: Grep di verifica architetturale — il flag vive solo in `f1Bot.js`**

Run: `grep -rn "F1_BOT_GRIP_AWARENESS" backend/sockets/games/`
Expected: solo occorrenze in `backend/sockets/games/f1Bot.js` (definizione + eventuale commento) e in `backend/sockets/games/f1Bot.test.js` (i test aggiunti al Task 4/5) — **zero** occorrenze in `backend/sockets/games/physics/`.

- [ ] **Step 2: Verifica headless — pista reale, gomma usurata vs gomma nuova**

Usa lo strumento offline già esistente in stile `f1LapSimulator`/`f1Testbench` (controlla `backend/tools/f1LapSimulator.js` e `backend/sockets/games/f1Testbench.js` per l'interfaccia esatta prima di scrivere lo script). Scrivi ed esegui uno script Node **temporaneo** (nella scratchpad, non nel repo) che:
1. Importa `f1GameSocket.js` (`module.exports.physics`) e `updateBotInputs`/`isBotGripAwarenessActive` da `f1Bot.js`, sullo stesso schema già usato dalle simulazioni headless precedenti del progetto (vedi memoria `[[feedback_headless_sim_before_fixing]]`: fisica reale esportata dal server, non una riscrittura parallela).
2. Simula un bot su una pista reale (es. `monza` o `new-monza`, quella con `-raceline.json` più recente) per alcuni giri in gara, con `F1_BOT_GRIP_AWARENESS=1`, confrontando `tyreWear` crescente durante la simulazione: verifica che, a parità di curva, la velocità target scenda mano a mano che l'usura sale (log dei valori, non solo un'asserzione booleana).
3. Ripete la stessa simulazione con `tyreWear` forzato a 0 per tutta la durata (gomma sempre nuova) confrontando il tempo sul giro/la velocità media in curva **con flag ON vs flag OFF**: deve risultare uguale o leggermente migliore (mai peggiore) con flag ON, dato che `corneringCapacity`/`effectiveBrakeMult` a `tyreWear=0` restano ≥1 — questo è il controllo esplicito di "non eccessiva prudenza" richiesto.

Riporta i numeri osservati (non solo "ok/non ok").

- [ ] **Step 3: Riporta i risultati e fermati**

Non committare oltre quanto già fatto nei Task 1-5. Riassumi in chat: esito dei test automatici (Step 1 di questo task + Step 8 di Task 5), esito della verifica headless (Step 2), eventuali anomalie trovate. L'utente deciderà se procedere a un playtest in localhost e a un eventuale commit finale del checkpoint.

---

## Self-Review

**Copertura spec**: architettura (Task 1-3), le 4 precisazioni vincolanti (esponente tunabile → Task 4 Step 3-4; effectiveBrakeMult fonte unica → Task 5 Step 3-4; flag solo in f1Bot.js → Task 4 Step 3 + Task 6 Step 1; test non-eccessiva-prudenza → Task 5 Step 1 + Task 6 Step 2), flusso dati per-tick (Task 5), edge case isQuali/damageParts (coperti dai test di Task 1 e Task 5, nessun codice nuovo necessario perché già neutri per costruzione), test plan completo (Task 1, 4, 5, 6), rollout (nota nei Global Constraints, nessuna promozione a default-on in questo piano).

**Scope**: `otherCarTargetSpeed` esplicitamente non toccata — verificato che entrambi i call site (righe 773, 867) restano su `legacyBrakeDecel` e che la sua firma/chiamata a `cornerTargetSpeed` (riga 302-305) non riceve mai `gripCapacityFactor`.

**Coerenza dei nomi**: `gripCapacityFactor` (parametro `cornerTargetSpeed`), `corneringCapacity` (funzione `CorneringGripModel`/`VehiclePhysics`/`deps`), `effectiveBrakeMult` (funzione esistente, invariata), `legacyBrakeDecel`/`brakeDecel` (variabili locali `updateBotInputs`), `isBotGripAwarenessActive`/`BOT_GRIP_CAPACITY_EXPONENT` (locali a `f1Bot.js`) — usati in modo identico in ogni task in cui compaiono.
