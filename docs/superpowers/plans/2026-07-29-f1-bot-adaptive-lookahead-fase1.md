# F1 Bot — Fase 1: lookahead adattivo (sterzo invariato) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare SOLO la Fase 1 di `docs/superpowers/specs/2026-07-29-f1-bot-adaptive-pursuit-controller-design.md`: lookahead adattivo alla curvatura locale (`L = √(2·R_locale·e_target)`, ipotesi H1/H2/H3), dietro flag indipendente, sterzo (`steerGain`) invariato, e verificarne l'effetto rispetto ai criteri quantitativi della spec su New Monza e monte-rosso, senza DNF su nessuna delle 4 piste attuali.

**Architettura:** Un helper puro (`adaptiveLookaheadMeters`) sostituisce la formula `speed × lookaheadTimeS` in ENTRAMBI i rami di `updateBotInputs` (racing-line e fallback geometrico), dietro `F1_BOT_ADAPTIVE_LOOKAHEAD` (default OFF → comportamento byte-identico a oggi). Il coefficiente `k` (candidato, non ancora validato) diventa un campo `adaptiveLookaheadK` in `DEFAULT_TUNING`/`DEFAULT_RACELINE_TUNING`, riusando la stessa plumbing di override già esistente per `lookaheadTimeS`/`steerGain` — permette di sweepare `k` da uno strumento esterno senza toccare le costanti del modulo.

**Tech Stack:** Node.js, `node:test`/`node:assert` per gli unit test, nessuna dipendenza nuova.

## Global Constraints

- Ogni nuovo comportamento dietro flag indipendente (`F1_BOT_ADAPTIVE_LOOKAHEAD`), **OFF di default**: a flag spento, comportamento byte-identico a oggi in entrambi i rami.
- `steerGain` resta **esattamente invariato** in questa fase — isola l'effetto del solo lookahead (Fase 2 tratterà lo sterzo, non questa).
- Nessun file `*-raceline.json` ufficiale viene letto in scrittura né modificato in questa fase.
- Nessuna promozione del flag a default-on senza playtest esplicito dell'utente in localhost.
- Criteri quantitativi di uscita Fase 1 (dalla spec, sezione "Fase 1"), per pista, su New Monza e monte-rosso:
  - riduzione della distanza media dalla linea ≥ 1/3 di quella osservata nella combinazione empirica lookahead+gain già misurata (`f1RacingLineAblation.js`): New Monza ≥ 15.3% (1/3 di 46%), monte-rosso ≥ 7% (1/3 di 21%);
  - riduzione del picco di distanza ≥ 1/3 della combinazione empirica: New Monza ≥ 10% (1/3 di 30%), monte-rosso ≥ 13% (1/3 di 39%);
  - nessun DNF/lockup su **nessuna** delle 4 piste attuali (new-monza, monte-rosso, prova, test2);
  - costo in tempo sul giro ≤ +3% su ogni pista testata.
- Se un criterio non è soddisfatto: NON si procede alla Fase 2. Si analizza (H2 insufficiente nella forma testata) prima di ripetere.
- Non si procede alla Fase 2 senza conferma esplicita dell'utente, indipendentemente dall'esito dei criteri.

## Struttura dei file

| File | Responsabilità |
|---|---|
| `backend/sockets/games/f1Bot.js` | Modificato: aggiunge helper puro `adaptiveLookaheadMeters` + costanti candidate + flag (Task 1); aggiunge `adaptiveLookaheadK` a `DEFAULT_TUNING`/`DEFAULT_RACELINE_TUNING` e collega l'helper in entrambi i rami di `updateBotInputs` (Task 2). Nessun altro comportamento tocco. |
| `backend/sockets/games/f1Bot.test.js` | Modificato: unit test isolati sull'helper (Task 1) + test di integrazione parità flag-off/differenza flag-on su entrambi i rami (Task 2). |
| `backend/tools/f1AdaptiveLookaheadCheck.js` | Nuovo: strumento **diagnostico** (non più un semplice "verifica candidato") per confronto tra variante A (lookahead adattivo attuale, floor fisso) e variante B (stesso lookahead con `L_min(v)`, esiste SOLO nel diagnostico), raccolta di metriche di tracking (distanza/heading) E di stabilità (oscillazione sterzo/target, per fascia di velocità), a supporto della validazione/falsificazione di H2 (Task 4). Il tool non modifica il controller reale: legge/esercita `f1Bot.js` così com'è, la variante B è una reimplementazione locale della sola formula del floor. |

Nessun file racing line ufficiale (`*-raceline.json`), nessun file in `frontend/`, nessun file dell'ottimizzatore (`f1RaceLineOptimizer.js`) viene toccato da questo piano.

---

### Task 1: Helper `adaptiveLookaheadMeters` + costanti (funzione pura, isolata)

**Files:**
- Modify: `backend/sockets/games/f1Bot.js` (aggiunta vicino a `BOT_CURVATURE_LOCAL_M`, circa riga 542)
- Test: `backend/sockets/games/f1Bot.test.js`

**Interfaces:**
- Produce: `adaptiveLookaheadMeters(laneSource, trackIndex, track, k) → number` (metri), `BOT_ADAPTIVE_LOOKAHEAD_K` (number, default candidato), `BOT_ADAPTIVE_LOOKAHEAD_MAX_M` (number), `isAdaptiveLookaheadActive() → boolean`, tutte esportate da `f1Bot.js`.
- Consuma: `windowRadius(points, i1, i2, localArcM)`, `lookaheadIndex(n, idx, samples)`, `metersToSamples(meters, track)`, `BOT_CURVATURE_LOCAL_M`, `BOT_LOOKAHEAD_MIN_M` — tutti già esistenti nello stesso file.

- [ ] **Step 1: Scrivi i test che falliscono**

Aggiungi in `backend/sockets/games/f1Bot.test.js`, dopo il blocco di test esistente su `windowRadius` (dopo la riga con `curva verso destra (delta>0)...`):

```javascript
test('adaptiveLookaheadMeters: rettilineo (windowRadius nullo) => usa il tetto massimo', () => {
    const points = buildConstantCurveTrack(200, 200, 0);   // dritto per tutti i campioni
    const track = { points, lapLength: 200, roadHalf: 5 };
    const L = adaptiveLookaheadMeters(points, 50, track, 0.1);
    assert.equal(L, BOT_ADAPTIVE_LOOKAHEAD_MAX_M);
});

test('adaptiveLookaheadMeters: curva a raggio noto => coerente con sqrt(2*R*k*roadHalf) entro i limiti', () => {
    // raggio geometrico atteso ~= 1/0.05 = 20 (passo unitario => metersPerSample=1,
    // turn totale sulla finestra locale di 12 campioni = 0.6 rad, ben sotto
    // pi — niente wraparound). k=1 (non il candidato di default 0.1) scelto
    // apposta per tenere il risultato atteso (~14.1m) dentro l'intervallo
    // [BOT_LOOKAHEAD_MIN_M, BOT_ADAPTIVE_LOOKAHEAD_MAX_M] = [10,120]: un k
    // realistico (es. 0.1) darebbe qui un raw sotto il pavimento e
    // testerebbe solo il clamp, non la formula stessa.
    const points = buildConstantCurveTrack(300, 50, 0.05);
    const track = { points, lapLength: 300, roadHalf: 5 };
    const k = 1;
    const L = adaptiveLookaheadMeters(points, 100, track, k);
    const expectedApprox = Math.sqrt(2 * 20 * k * track.roadHalf);   // sqrt(200) ~= 14.14
    assert.ok(Math.abs(L - expectedApprox) < 1, `atteso ~${expectedApprox.toFixed(2)}, ottenuto ${L.toFixed(2)}`);
    assert.ok(L >= BOT_LOOKAHEAD_MIN_M - 1e-9, 'non deve scendere sotto il pavimento minimo');
    assert.ok(L <= BOT_ADAPTIVE_LOOKAHEAD_MAX_M + 1e-9, 'non deve superare il tetto massimo');
});

test('adaptiveLookaheadMeters: e_target molto piccolo => clampato al pavimento minimo', () => {
    // Stessa curva del test precedente (raggio ~20, turn totale sulla
    // finestra locale = 12*0.05 = 0.6 rad, ben sotto pi — niente wraparound
    // di normalizeAngle su windowRadius). NON usare un delta più grande per
    // "stringere" il raggio: con la finestra fissa di 12 campioni
    // (BOT_CURVATURE_LOCAL_M/metersPerSample), un turn totale vicino o oltre
    // pi fa avvolgere l'angolo (normalizeAngle) e restituisce un raggio
    // fittizio MOLTO più grande del vero raggio geometrico — bug di
    // metodologia già evitato qui scegliendo k piccolo invece del raggio.
    const points = buildConstantCurveTrack(300, 50, 0.05);
    const track = { points, lapLength: 300, roadHalf: 5 };
    const L = adaptiveLookaheadMeters(points, 100, track, 0.001);   // e_target piccolissimo apposta
    assert.equal(L, BOT_LOOKAHEAD_MIN_M);
});
```

Aggiungi anche `adaptiveLookaheadMeters, BOT_ADAPTIVE_LOOKAHEAD_K, BOT_ADAPTIVE_LOOKAHEAD_MAX_M, BOT_LOOKAHEAD_MIN_M, isAdaptiveLookaheadActive` alla destructuring dell'import in cima al file (riga 4-9), nello stesso blocco che già importa `windowRadius, cornerApexNear`.

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: FAIL — `adaptiveLookaheadMeters is not a function` (o `undefined`) sui 3 nuovi test.

- [ ] **Step 3: Implementa costanti + funzione**

In `backend/sockets/games/f1Bot.js`, subito dopo la riga `const BOT_CURVATURE_LOCAL_M = 12;` (circa riga 542):

```javascript
// Fase 1 — lookahead adattivo alla curvatura (Rif.
// docs/superpowers/specs/2026-07-29-f1-bot-adaptive-pursuit-controller-design.md,
// ipotesi H1/H2/H3 — NON ancora validate). k è un CANDIDATO da verificare
// con backend/tools/f1AdaptiveLookaheadCheck.js, non un valore derivato o
// confermato: resta sovrascrivibile per test tramite
// tuning.adaptiveLookaheadK / racingLineTuning.adaptiveLookaheadK (stessa
// plumbing già esistente per lookaheadTimeS/steerGain), il valore qui sotto
// è solo il default quando nessuno lo sovrascrive.
const BOT_ADAPTIVE_LOOKAHEAD_K     = 0.1;
// Tetto sui rettilinei (R_locale non misurabile, windowRadius nullo): stesso
// ordine di grandezza del lookahead attuale a velocità di punta con
// lookaheadTimeS ufficiale di New Monza (~90 m/s * 0.98s ~= 88m).
const BOT_ADAPTIVE_LOOKAHEAD_MAX_M = 120;

function isAdaptiveLookaheadActive() {
    return process.env.F1_BOT_ADAPTIVE_LOOKAHEAD === '1';
}

// L = sqrt(2 * R_locale * e_target), e_target = k * roadHalf (ipotesi H1/H2,
// vedi spec). R_locale misurato con windowRadius sulla stessa finestra
// locale già usata per la severità di sorpasso/apexOffset
// (BOT_CURVATURE_LOCAL_M) — nessuna nuova misura di curvatura introdotta.
// Su un rettilineo (windowRadius nullo, curvatura indistinguibile da zero)
// si usa direttamente il tetto massimo, mai una divisione per curvatura ~0.
// `laneSource` è la linea che il bot sta davvero seguendo in quel ramo
// (track.racingLine o track.points), stessa convenzione già in uso altrove
// in questo file.
function adaptiveLookaheadMeters(laneSource, trackIndex, track, k) {
    const localSamples = metersToSamples(BOT_CURVATURE_LOCAL_M, track);
    const metersPerSample = track.lapLength / track.points.length;
    const localArcM = localSamples * metersPerSample;
    const i2 = lookaheadIndex(track.points.length, trackIndex, localSamples);
    const w = windowRadius(laneSource, trackIndex, i2, localArcM);
    if (!w) return BOT_ADAPTIVE_LOOKAHEAD_MAX_M;
    const eTarget = k * track.roadHalf;
    const raw = Math.sqrt(2 * w.radius * eTarget);
    return Math.max(BOT_LOOKAHEAD_MIN_M, Math.min(BOT_ADAPTIVE_LOOKAHEAD_MAX_M, raw));
}
```

Nel blocco `module.exports` in fondo al file, aggiungi `BOT_ADAPTIVE_LOOKAHEAD_K, BOT_ADAPTIVE_LOOKAHEAD_MAX_M, BOT_LOOKAHEAD_MIN_M, isAdaptiveLookaheadActive, adaptiveLookaheadMeters` alla lista esistente.

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: PASS su tutti i test (i 3 nuovi + tutti quelli preesistenti, nessuna regressione).

- [ ] **Step 5: Commit**

```bash
git add backend/sockets/games/f1Bot.js backend/sockets/games/f1Bot.test.js
git commit -m "F1 bot: aggiunge helper lookahead adattivo alla curvatura (Fase 1, dietro flag, non ancora wired)"
```

---

### Task 2: Wiring nei due rami di `updateBotInputs` + test di integrazione

**Files:**
- Modify: `backend/sockets/games/f1Bot.js` (`DEFAULT_TUNING`, `DEFAULT_RACELINE_TUNING`, ramo racing-line ~riga 876-877, ramo fallback ~riga 953-954)
- Test: `backend/sockets/games/f1Bot.test.js`

**Interfaces:**
- Consuma: `adaptiveLookaheadMeters`, `isAdaptiveLookaheadActive`, `BOT_ADAPTIVE_LOOKAHEAD_K` (Task 1).
- Produce: `DEFAULT_TUNING.adaptiveLookaheadK`, `DEFAULT_RACELINE_TUNING.adaptiveLookaheadK` — consultati da `updateBotInputs` in entrambi i rami.

- [ ] **Step 1: Scrivi i test di integrazione che falliscono**

Aggiungi in `backend/sockets/games/f1Bot.test.js`, dopo il test esistente `'updateBotInputs: deps.tuning.apexMaxFraction sovrascrive il default...'`:

```javascript
test('updateBotInputs: F1_BOT_ADAPTIVE_LOOKAHEAD spento => lookahead identico a prima (ramo racing-line)', () => {
    const points = buildConstantCurveTrack(300, 50, 0.05);
    const racingLineTuning = { lookaheadTimeS: 0.6, steerGain: 3.0, cornerSpeedMargin: 0.99, brakingDistanceMargin: 1.2, deadband: 0.01, ramp: 0.06 };
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

    delete process.env.F1_BOT_ADAPTIVE_LOOKAHEAD;
    updateBotInputs({ track, phase: 'qualifying', players: { A: p } }, deps);

    const speedMs = Math.max(5, Math.abs(p.speed) * 55 / 3.6);
    const lookM = Math.max(10, speedMs * racingLineTuning.lookaheadTimeS);
    const lookSamples = Math.max(1, Math.round(lookM * points.length / track.lapLength));
    const expectedIdx = lookaheadIndex(points.length, 100, lookSamples);

    assert.equal(p._botDebug.target.x, points[expectedIdx].x);
    assert.equal(p._botDebug.target.z, points[expectedIdx].z);
});

test('updateBotInputs: F1_BOT_ADAPTIVE_LOOKAHEAD acceso => target diverso da flag spento su curva stretta (ramo racing-line)', () => {
    const points = buildConstantCurveTrack(300, 50, 0.1);   // raggio stretto ~10
    const racingLineTuning = { lookaheadTimeS: 0.6, steerGain: 3.0, cornerSpeedMargin: 0.99, brakingDistanceMargin: 1.2, deadband: 0.01, ramp: 0.06 };
    const track = { points, racingLine: points, racingLineTuning, lapLength: 300, roadHalf: 5 };
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
            x: points[100].x, z: points[100].z, angle: 0, speed: 3, vx: 0, vz: 0,
            inputs: { throttle: 0, brake: 0, steer: 0 }, finished: false, lap: 0, botLapSeen: 0,
            trackIndex: 100, tyreWear: 0, compound: 'medium', pitting: false, pitAutoState: null, pitPhase: null,
            isBot: true, botSpeedFactor: 1, botLapPaceMult: 1, botPrecisionNoise: 0,
            botOvertakeSide: 1, botHeadingToPits: false, botPitReactionScheduled: false
        };
    }

    const pOff = makePlayer();
    delete process.env.F1_BOT_ADAPTIVE_LOOKAHEAD;
    updateBotInputs({ track, phase: 'qualifying', players: { A: pOff } }, deps);

    const pOn = makePlayer();
    process.env.F1_BOT_ADAPTIVE_LOOKAHEAD = '1';
    try {
        updateBotInputs({ track, phase: 'qualifying', players: { A: pOn } }, deps);
    } finally {
        delete process.env.F1_BOT_ADAPTIVE_LOOKAHEAD;
    }

    assert.notEqual(pOn._botDebug.target.x, pOff._botDebug.target.x);
});

test('updateBotInputs: F1_BOT_ADAPTIVE_LOOKAHEAD spento => lookahead identico a prima (ramo geometrico, senza racing line)', () => {
    const points = buildConstantCurveTrack(300, 50, 0.05);
    const track = { points, lapLength: 300, roadHalf: 5 };
    const deps = {
        effectiveMaxSpeed: () => 6,
        handlePitReactionPress: () => {}, io: { to: () => ({ emit: () => {} }) }, lobbyId: 'test',
        wearLapsAtMedium: 5, accel: 0.186, brakeMult: 2.17, turnRateHigh: 0.052,
        tuning: { apexMaxFraction: 0 }
    };
    const p = {
        x: points[100].x, z: points[100].z, angle: 0, speed: 3, vx: 0, vz: 0,
        inputs: { throttle: 0, brake: 0, steer: 0 }, finished: false, lap: 0, botLapSeen: 0,
        trackIndex: 100, tyreWear: 0, compound: 'medium', pitting: false, pitAutoState: null, pitPhase: null,
        isBot: true, botSpeedFactor: 1, botLapPaceMult: 1, botPrecisionNoise: 0,
        botOvertakeSide: 1, botHeadingToPits: false, botPitReactionScheduled: false
    };

    delete process.env.F1_BOT_ADAPTIVE_LOOKAHEAD;
    updateBotInputs({ track, phase: 'qualifying', players: { A: p } }, deps);

    const speedMs = Math.max(5, Math.abs(p.speed) * 55 / 3.6);
    const lookM = Math.max(10, speedMs * 0.6);   // DEFAULT_TUNING.lookaheadTimeS === BOT_LOOKAHEAD_TIME_S
    const lookSamples = Math.max(1, Math.round(lookM * points.length / track.lapLength));
    const expectedIdx = lookaheadIndex(points.length, 100, lookSamples);

    assert.equal(p._botDebug.target.x, points[expectedIdx].x);
    assert.equal(p._botDebug.target.z, points[expectedIdx].z);
});

test('updateBotInputs: F1_BOT_ADAPTIVE_LOOKAHEAD acceso => target diverso da flag spento su curva stretta (ramo geometrico)', () => {
    const points = buildConstantCurveTrack(300, 50, 0.1);
    const track = { points, lapLength: 300, roadHalf: 5 };
    const deps = {
        effectiveMaxSpeed: () => 6, handlePitReactionPress: () => {}, io: { to: () => ({ emit: () => {} }) },
        lobbyId: 'test', wearLapsAtMedium: 5, accel: 0.186, brakeMult: 2.17, turnRateHigh: 0.052,
        tuning: { apexMaxFraction: 0 }
    };
    function makePlayer() {
        return {
            x: points[100].x, z: points[100].z, angle: 0, speed: 3, vx: 0, vz: 0,
            inputs: { throttle: 0, brake: 0, steer: 0 }, finished: false, lap: 0, botLapSeen: 0,
            trackIndex: 100, tyreWear: 0, compound: 'medium', pitting: false, pitAutoState: null, pitPhase: null,
            isBot: true, botSpeedFactor: 1, botLapPaceMult: 1, botPrecisionNoise: 0,
            botOvertakeSide: 1, botHeadingToPits: false, botPitReactionScheduled: false
        };
    }

    const pOff = makePlayer();
    delete process.env.F1_BOT_ADAPTIVE_LOOKAHEAD;
    updateBotInputs({ track, phase: 'qualifying', players: { A: pOff } }, deps);

    const pOn = makePlayer();
    process.env.F1_BOT_ADAPTIVE_LOOKAHEAD = '1';
    try {
        updateBotInputs({ track, phase: 'qualifying', players: { A: pOn } }, deps);
    } finally {
        delete process.env.F1_BOT_ADAPTIVE_LOOKAHEAD;
    }

    assert.notEqual(pOn._botDebug.target.x, pOff._botDebug.target.x);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: i 4 nuovi test FALLISCONO (flag acceso non produce ancora nessun effetto — il codice di `updateBotInputs` non chiama ancora `adaptiveLookaheadMeters`).

- [ ] **Step 3: Wiring**

In `DEFAULT_TUNING` (vicino a `lookaheadTimeS: BOT_LOOKAHEAD_TIME_S,`), aggiungi:
```javascript
    adaptiveLookaheadK:    BOT_ADAPTIVE_LOOKAHEAD_K
```

In `DEFAULT_RACELINE_TUNING` (vicino a `steerGain: BOT_STEER_GAIN,`), aggiungi:
```javascript
    adaptiveLookaheadK:    BOT_ADAPTIVE_LOOKAHEAD_K,
```

Ramo racing-line — sostituisci:
```javascript
            const speedMs  = Math.max(5, botSpeedMs(p.speed));
            const lookM    = Math.max(BOT_LOOKAHEAD_MIN_M, speedMs * rt.lookaheadTimeS);
```
con:
```javascript
            const speedMs  = Math.max(5, botSpeedMs(p.speed));
            const lookM    = isAdaptiveLookaheadActive()
                ? adaptiveLookaheadMeters(track.racingLine, p.trackIndex || 0, track, rt.adaptiveLookaheadK)
                : Math.max(BOT_LOOKAHEAD_MIN_M, speedMs * rt.lookaheadTimeS);
```

Ramo fallback geometrico — sostituisci:
```javascript
            const speedMs  = Math.max(5, botSpeedMs(p.speed));   // floor: niente lookahead quasi-zero da fermi (es. alla partenza)
            const lookM    = Math.max(BOT_LOOKAHEAD_MIN_M, speedMs * tuning.lookaheadTimeS);
```
con:
```javascript
            const speedMs  = Math.max(5, botSpeedMs(p.speed));   // floor: niente lookahead quasi-zero da fermi (es. alla partenza)
            const lookM    = isAdaptiveLookaheadActive()
                ? adaptiveLookaheadMeters(track.points, p.trackIndex || 0, track, tuning.adaptiveLookaheadK)
                : Math.max(BOT_LOOKAHEAD_MIN_M, speedMs * tuning.lookaheadTimeS);
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: PASS su tutti i test, inclusi i 4 nuovi e tutti i preesistenti (nessuna regressione — in particolare il test `DEFAULT_TUNING espone i tre margini con i valori attuali` deve restare verde, i due nuovi campi sono additivi).

- [ ] **Step 5: Commit**

```bash
git add backend/sockets/games/f1Bot.js backend/sockets/games/f1Bot.test.js
git commit -m "F1 bot: wiring lookahead adattivo dietro F1_BOT_ADAPTIVE_LOOKAHEAD in entrambi i rami (Fase 1)"
```

---

### Task 3: Regressione completa su tutta la suite bot

**Files:** nessuna modifica — solo esecuzione.

- [ ] **Step 1: Esegui l'intera suite `f1Bot.test.js` e `f1LapSimulator.test.js`**

Run: `node --test backend/sockets/games/f1Bot.test.js backend/tools/f1LapSimulator.test.js`
Expected: PASS su tutti i test, zero regressioni rispetto allo stato pre-Fase-1.

- [ ] **Step 2: Verifica manuale di non-regressione headless su tutte e 4 le piste, flag OFF**

Run (per ognuna): `node backend/tools/f1LapSimulator.js new-monza`, `node backend/tools/f1LapSimulator.js monte-rosso`, `node backend/tools/f1LapSimulator.js prova`, `node backend/tools/f1LapSimulator.js test2`
Expected: tutte e 4 completano (`giro completato in ...ms`), nessun cambiamento nel tempo sul giro rispetto a prima di questa fase (flag non impostato = comportamento invariato).

Nessun commit in questo task (nessun file cambiato).

---

### Task 4: Confronto diagnostico lookahead adattivo — validare/falsificare H2

> **Scopo aggiornato** (Rif. review diagnostica del piano, successiva a Task 1/2 —
> Task 1 e Task 2 restano completati e invariati). Non più *"verificare se il
> lookahead adattivo supera i criteri della Fase 1"*, ma **costruire un
> confronto diagnostico tra due ipotesi di lookahead e raccogliere metriche
> sufficienti a validare O falsificare H2** — comprese metriche di stabilità
> del controllo che i criteri originari (distanza media/picco, DNF, tempo) da
> soli non possono rilevare.
>
> **Perché questo cambiamento**: la review diagnostica ha trovato due
> problemi distinti, nessuno dei due nel codice già scritto (Task 1/2, che
> restano corretti così come sono):
> 1. La spec (`docs/superpowers/specs/2026-07-29-f1-bot-adaptive-pursuit-controller-design.md`,
>    sezione "Architettura target") scrive `L(s) = clamp(√(2·R_locale·e_target),
>    L_min(v), L_max)` — **`L_min` funzione della velocità**. La tabella
>    parametri della stessa spec, poco sotto, e l'implementazione Task 1
>    (`BOT_LOOKAHEAD_MIN_M`, costante fissa) trattano invece `L_min` come
>    costante globale. È un'incoerenza interna della spec, non un errore di
>    implementazione — Task 1/2 hanno seguito correttamente la tabella
>    parametri, ma la formula dell'architettura target dice altro.
> 2. I criteri quantitativi di Fase 1 (distanza media/picco, DNF/lockup,
>    tempo) sono tutti statistiche aggregate di fine giro — nessuno è
>    sensibile a oscillazione/instabilità del comando di sterzo, che la
>    teoria del pure-pursuit indica come il rischio più plausibile di un
>    lookahead completamente indipendente dalla velocità. Un controller
>    "nervoso" potrebbe passare tutti i criteri attuali pur introducendo una
>    regressione qualitativa reale, mai misurata.
>
> Questo task non decide se H2 è vera o falsa nella sua forma attuale, né
> implementa una correzione nel controller reale — costruisce lo strumento
> che permette di deciderlo con dati.

**Files:**
- Create: `backend/tools/f1AdaptiveLookaheadCheck.js`
- Modify (solo se lo Step 0 lo conferma necessario): `backend/tools/f1LapSimulator.js` — eventuale aggiunta di `steer`/`target` al `telemetry.push` già esistente (~riga 77), nessun nuovo calcolo nel motore.

**Interfaces:**
- Consuma: `loadTrack` (`trackLoader.js`), `simulateLap` (`f1LapSimulator.js`), telemetria per-tick (`distanceFromRacingLine`, `headingVsTangentDeg`, `speedKmh` già presenti; `steer`/`target` se lo Step 0 ne conferma la necessità e li aggiunge).
- Produce: report a console che confronta **due varianti fianco a fianco** (non una sola), con le metriche estese sotto; `module.exports` da definire in Step 3, coerente con lo stile già in uso nel resto del file (funzioni pure riusabili, stesso pattern di `f1RacingLineAblation.js`).

- [ ] **Step 0: Audit telemetria — cosa è già disponibile, cosa richiede estensione**

Prima di scrivere qualunque riga dello strumento, verificare in
`backend/tools/f1LapSimulator.js` (funzione `simulateLap`, blocco
`telemetry.push`, ~riga 77) quali campi sono già catturati per tick:
- **Già presenti**: `distanceFromRacingLine`, `headingVsTangentDeg`,
  `speedKmh`, `idx`, `x`, `z`.
- **Da verificare se servono alle metriche dello Step 2, e se sì aggiungere**:
  `steer` e `target` (`{x, z}`) — già calcolati ogni tick da
  `updateBotInputs` dentro `p._botDebug` (`f1Bot.js`, blocco
  `p._botDebug = debugEnabled ? {...}` in fondo alla funzione), **non**
  copiati oggi in `telemetry`. Se servono, l'estensione è una singola
  aggiunta al `telemetry.push` esistente — nessuna modifica a `f1Bot.js`,
  nessun nuovo calcolo nel motore, solo esposizione di un dato già prodotto.

Esito di questo step: elenco preciso dei campi mancanti (se presenti) prima
di procedere allo Step 3.

- [ ] **Step 1: Definire le due varianti da confrontare**

**Variante A — implementazione attuale** (quella già wired in Task 2,
invariata, nessuna modifica):
```
L = clamp(sqrt(2 * R_locale * e_target), BOT_LOOKAHEAD_MIN_M, BOT_ADAPTIVE_LOOKAHEAD_MAX_M)
```
Lo strumento la esercita così com'è, dietro `F1_BOT_ADAPTIVE_LOOKAHEAD=1`,
esattamente come già previsto da Task 2 — nessuna modifica a `f1Bot.js`.

**Variante B — diagnostica, esiste SOLO nello strumento**: stessa formula
geometrica, ma il floor fisso `BOT_LOOKAHEAD_MIN_M` è sostituito da un
limite inferiore dipendente dalla velocità `L_min(v)`, coerente con
l'architettura target scritta nella spec (mai implementata):
```
L = clamp(sqrt(2 * R_locale * e_target), L_min(v), BOT_ADAPTIVE_LOOKAHEAD_MAX_M)
```
Vincoli su B, non negoziabili in questo task:
- **Non modifica `f1Bot.js`**, non modifica `adaptiveLookaheadMeters` né la
  sua API, non introduce nessun nuovo flag/parametro nel controller reale —
  vive come funzione/override locale dentro
  `f1AdaptiveLookaheadCheck.js` (es. reimplementazione della sola formula
  del floor, riusando `windowRadius`/`metersToSamples` già esportati da
  `f1Bot.js` come fa oggi `adaptiveLookaheadMeters`).
- Serve solo come esperimento diagnostico per confrontare A vs B — non è
  una proposta di implementazione né un'anticipazione di Fase 2.
- **La forma precisa di `L_min(v)`** (candidato discusso in sede di review
  teorica: `v · T_min`, con `T_min` nuova costante candidata; non l'unica
  forma possibile) **sarà definita durante l'implementazione dello
  strumento (Step 3), non in questo documento.**

- [ ] **Step 2: Estendere le metriche richieste dal tool**

Oltre alle metriche già previste dal piano originale:
- `avgDist`, `peakDist` (da `distanceFromRacingLine`)
- `avgHead`, `peakHead` (da `headingVsTangentDeg`)
- tempo sul giro (`timeMs`)
- DNF/lockup (`finished`)

aggiungere le metriche di stabilità emerse dalla review diagnostica:
- **deviazione standard dell'errore di prua** (`headingVsTangentDeg`) — non
  solo media/picco: distingue un errore che cresce e torna a zero in modo
  pulito (una curva vera) da un errore che oscilla rapidamente attorno a
  zero (nervosismo).
- **inversioni di segno dell'errore di prua per secondo** (zero-crossing
  rate) — proxy diretto di frequenza di oscillazione.
- **variazione tick-su-tick del comando sterzo** (`|steer_t − steer_{t-1}|`,
  media e picco) — **se esposto dalla telemetry** (dipende dall'esito dello
  Step 0).
- **variazione del target lookahead tick-su-tick** (distanza tra `target`
  consecutivi, media e picco) — **se esposto dalla telemetry** (dipende
  dall'esito dello Step 0).
- **statistiche separate per fascia di velocità** (bucket su `speedKmh`,
  es. terzili bassa/media/alta): ripetere TUTTE le metriche sopra per
  fascia, non solo sull'intero giro — un'instabilità concentrata solo ad
  alta velocità si annacqua altrimenti nella media di giro, che è
  esattamente l'ipotesi in discussione.

Tutte derivabili da dati già calcolati dal motore (nessuna nuova fisica) —
l'unico costo eventuale è l'estensione identificata allo Step 0.

- [ ] **Step 3: Scrivi lo strumento**

Implementa `backend/tools/f1AdaptiveLookaheadCheck.js` (e l'eventuale
estensione di `f1LapSimulator.js` decisa allo Step 0) secondo Step 1/Step 2:
esegue A e B su tutte le piste headless disponibili (verificare l'elenco
reale al momento dell'implementazione — nota separatamente: `test2`
non è più caricabile, sostituita da `baku` nella working tree, problema
esistente fuori scope per questo task), stampa un confronto fianco a fianco
per ogni candidata (di `k` per A, del parametro equivalente scelto per B —
Step 1), incluse le metriche di stabilità per fascia di velocità.

A differenza della versione precedente di questo piano, questo step non
viene dettagliato riga per riga in questo documento: la forma esatta di B
(Step 1) e l'esito dell'audit telemetria (Step 0) determinano
l'implementazione — fissarla ora, prima di quelle decisioni, sarebbe
prematuro.

**Criteri decisionali aggiornati** (si applicano al confronto A/B prodotto
da questo strumento — non modificano i criteri formali della spec, sezione
"Fase 1", che restano l'autorità per l'avanzamento a Fase 2; aggiungono un
livello di verifica operativo più severo prima di dichiararli soddisfatti):
Non basta più che la variante A soddisfi da sola le soglie quantitative
originarie (riduzione distanza media ≥ 1/3 della combinazione empirica,
nessun DNF, costo tempo ≤ +3% — Rif. Global Constraints del piano e sezione
"Fase 1" della spec). Il confronto A vs B deve anche mostrare che A non
introduce peggioramenti significativi di stabilità rispetto a B, in
particolare nelle fasce di velocità alta: se A mostra deviazione
standard/inversioni di segno dell'errore di prua, o variazione tick-su-tick
di sterzo/target, sistematicamente peggiori di B proprio nella fascia di
velocità alta, è un segnale che H2 nella sua forma "solo curvatura" è
insufficiente — anche se le metriche di distanza/tempo originarie fossero
soddisfatte. Non viene fissata qui una soglia numerica di "peggioramento
significativo": va stabilita in Task 5, confrontando l'ordine di grandezza
osservato tra A e B sui dati reali, non a priori senza dati.

- [ ] **Step 4: Smoke test manuale**

Run: `node backend/tools/f1AdaptiveLookaheadCheck.js`
Expected: lo script termina senza eccezioni e stampa il confronto A/B
completo (DNF + metriche originarie + metriche di stabilità, per fascia di
velocità) su tutte le piste disponibili.

- [ ] **Step 5: Commit**

```bash
git add backend/tools/f1AdaptiveLookaheadCheck.js backend/tools/f1LapSimulator.js
git commit -m "F1: strumento diagnostico Fase 1 — confronto A (floor fisso) vs B (L_min(v)) con metriche di stabilità"
```
(Il secondo file solo se lo Step 0 ha richiesto l'estensione della telemetria.)

---

### Task 5: Esecuzione finale e report (nessun codice)

> **Scopo aggiornato** (coerente col nuovo Task 4): il report finale non
> valuta più solo "se il candidato passa i criteri della Fase 1" — deve
> presentare il confronto diagnostico completo tra variante A e variante B
> e la sua interpretazione, non solo un esito binario pass/fail su A da
> sola.

- [ ] **Step 1: Esegui lo strumento e raccogli l'output completo**

Run: `node backend/tools/f1AdaptiveLookaheadCheck.js`

Raccogliere l'output per ENTRAMBE le varianti (A e B), tutte le candidate
(`k` per A, parametro equivalente per B — Step 1 del Task 4), tutte le
piste disponibili, incluse le metriche di stabilità per fascia di velocità
(Step 2 del Task 4).

- [ ] **Step 2: Costruisci il confronto A vs B**

Il report deve coprire, non solo un singolo pass/fail:
- **confronto variante A vs variante B** — stessa candidata/pista, fianco a
  fianco;
- **effetto sulle metriche di tracking** (distanza media/picco dalla linea,
  errore di prua) — le stesse della Fase 1 originaria, dalla spec e dalle
  Global Constraints di questo piano;
- **effetto sulle metriche di stabilità** (deviazione standard e inversioni
  di segno dell'errore di prua, variazione tick-su-tick di sterzo/target —
  se esposte dalla telemetry, Step 0 del Task 4), **in particolare nelle
  fasce di velocità alta**;
- **eventuali trade-off** tra le tre dimensioni (es. A riduce di più la
  distanza media ma peggiora la stabilità ad alta velocità rispetto a B; o
  B è più stabile ma costa più tempo sul giro) — riportarli esplicitamente,
  non nasconderli dietro una media aggregata;
- assenza di DNF/lockup su tutte le piste disponibili, per entrambe le
  varianti;
- costo in tempo sul giro, per entrambe le varianti.

- [ ] **Step 3: Riporta all'utente e proponi una decisione tra tre esiti**

Presenta il confronto completo (non solo la tabella dei criteri originari)
e indica quale dei tre esiti i dati supportano:
- **a) mantenere A** — se A soddisfa i criteri di tracking della Fase 1 E
  non mostra peggioramenti di stabilità significativi rispetto a B (Rif.
  "Criteri decisionali aggiornati", Task 4);
- **b) adottare B come base** — se B soddisfa gli stessi criteri di
  tracking E risolve un peggioramento di stabilità reale osservato su A;
  passare da diagnostico-solo-nello-strumento a wiring reale in `f1Bot.js`
  è però una modifica al controller e NON è coperta da questo piano —
  richiederebbe un piano successivo dedicato, non un'estensione implicita
  di questo Task 5;
- **c) modificare la formula prima di procedere** — se né A né B
  soddisfano i criteri di tracking, o se entrambe mostrano instabilità
  significativa: H2 nella forma testata (con o senza `L_min(v)`) è
  insufficiente, si torna a raffinare `L(s)` (Rif. spec, "Se il criterio
  non è soddisfatto") prima di ripetere.

In ogni caso **fermati**: non procedere alla Fase 2 (sterzo geometrico) né
a un eventuale wiring di B nel controller reale senza conferma esplicita
dell'utente, indipendentemente dall'esito.

---

## Note per l'esecutore

- Nessun task di questo piano tocca `backend/tools/f1RaceLineOptimizer.js` o alcun file `*-raceline.json` — coerente col vincolo "Fase 4 unica a toccarli".
- Nessun task introduce o modifica `steerGain` — resta root nel piano di Fase 2, non qui.
- Se un test del Task 2 fallisce in modo inatteso (es. il target coincide anche a flag acceso), non forzare l'assert: verificare prima se il raggio scelto nel test produce davvero un lookahead diverso da quello legacy per quella combinazione di velocità/roadHalf/k di default — aggiustare il raggio della curva sintetica nel test, non l'implementazione, a meno che l'ispezione riveli un bug reale.
