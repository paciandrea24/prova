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
| `backend/tools/f1AdaptiveLookaheadCheck.js` | Nuovo: strumento headless di verifica Fase 1 — sweep di poche candidate `k`, controllo DNF su 4 piste, confronto quantitativo vs baseline su New Monza/monte-rosso, valutazione automatica contro i criteri del piano (Task 4). |

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

### Task 4: Strumento di verifica Fase 1 (`f1AdaptiveLookaheadCheck.js`)

**Files:**
- Create: `backend/tools/f1AdaptiveLookaheadCheck.js`

**Interfaces:**
- Consuma: `loadTrack` (`trackLoader.js`), `simulateLap` (`f1LapSimulator.js`).
- Produce: report a console; `module.exports = { runOnce, checkTrack, checkDnf }` per riuso/test futuri.

- [ ] **Step 1: Scrivi lo strumento**

```javascript
// backend/tools/f1AdaptiveLookaheadCheck.js
//
// Verifica Fase 1 (Rif. docs/superpowers/specs/2026-07-29-f1-bot-adaptive-pursuit-controller-design.md
// e docs/superpowers/plans/2026-07-29-f1-bot-adaptive-lookahead-fase1.md): confronta
// il lookahead adattivo (F1_BOT_ADAPTIVE_LOOKAHEAD=1, steerGain INVARIATO)
// contro il comportamento attuale, su New Monza (ramo racing-line) e
// monte-rosso (ramo geometrico fallback), sweepando poche candidate k (non
// una ricerca esaustiva) — e verifica l'assenza di DNF/lockup su TUTTE le
// piste attuali per ogni candidata. Applica i criteri quantitativi della
// spec (riduzione ≥ 1/3 della combinazione empirica già misurata in
// f1RacingLineAblation.js, nessun DNF, costo tempo ≤ +3%).
//
// Uso: node backend/tools/f1AdaptiveLookaheadCheck.js
const { loadTrack } = require('../sockets/games/trackLoader.js');
const { simulateLap } = require('./f1LapSimulator.js');

const K_CANDIDATES = [0.05, 0.1, 0.15];

// Soglie derivate dai risultati già misurati in f1RacingLineAblation.js
// (Braccio 1, combinazione lookahead÷2+steerGain×1.75): 1/3 della riduzione
// osservata lì, per pista — vedi Global Constraints del piano.
const CRITERIA = {
    'new-monza':   { minAvgDistReductionFrac: 0.46 / 3, minPeakDistReductionFrac: 0.30 / 3, maxTimeCostFrac: 0.03 },
    'monte-rosso': { minAvgDistReductionFrac: 0.21 / 3, minPeakDistReductionFrac: 0.39 / 3, maxTimeCostFrac: 0.03 }
};
const ALL_TRACKS_FOR_DNF_CHECK = ['new-monza', 'monte-rosso', 'prova', 'test2'];

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

// Applica l'override di k nella stessa plumbing già esistente:
// racingLineTuning per le piste con racing line ufficiale, deps.tuning per
// quelle senza (stesso pattern di f1RacingLineAblation.js).
function runOnce(trackId, kOverride) {
    const track = loadTrack(trackId);
    const hasLine = !!track.racingLine;
    const trackForRun = (kOverride != null && hasLine)
        ? { ...track, racingLineTuning: { ...track.racingLineTuning, adaptiveLookaheadK: kOverride } }
        : track;
    const tuning = (kOverride != null && !hasLine) ? { adaptiveLookaheadK: kOverride } : undefined;
    const r = simulateLap(trackForRun, { speedFactor: 1, paceMult: 1, precisionNoise: 0, safetyCapS: 60, tuning });
    if (!r.finished) return { finished: false };
    return { finished: true, timeMs: r.timeMs, ...stats(r.telemetry) };
}

function checkDnf(k) {
    const rows = [];
    for (const trackId of ALL_TRACKS_FOR_DNF_CHECK) {
        process.env.F1_BOT_ADAPTIVE_LOOKAHEAD = '1';
        const r = runOnce(trackId, k);
        delete process.env.F1_BOT_ADAPTIVE_LOOKAHEAD;
        rows.push({ trackId, finished: r.finished });
    }
    return rows;
}

function checkTrack(trackId, k) {
    delete process.env.F1_BOT_ADAPTIVE_LOOKAHEAD;
    const baseline = runOnce(trackId, null);

    process.env.F1_BOT_ADAPTIVE_LOOKAHEAD = '1';
    const adaptive = runOnce(trackId, k);
    delete process.env.F1_BOT_ADAPTIVE_LOOKAHEAD;

    if (!baseline.finished || !adaptive.finished) return { trackId, k, dnf: true };

    const avgDistReductionFrac = (baseline.avgDist - adaptive.avgDist) / baseline.avgDist;
    const peakDistReductionFrac = (baseline.peakDist - adaptive.peakDist) / baseline.peakDist;
    const timeCostFrac = (adaptive.timeMs - baseline.timeMs) / baseline.timeMs;

    const criteria = CRITERIA[trackId];
    const pass = !!criteria &&
        avgDistReductionFrac >= criteria.minAvgDistReductionFrac &&
        peakDistReductionFrac >= criteria.minPeakDistReductionFrac &&
        timeCostFrac <= criteria.maxTimeCostFrac;

    return { trackId, k, dnf: false, baseline, adaptive, avgDistReductionFrac, peakDistReductionFrac, timeCostFrac, pass };
}

function main() {
    console.log('=== Fase 1: verifica lookahead adattivo (sterzo invariato) ===\n');

    console.log('--- Assenza di DNF/lockup su tutte le piste, per candidata k ---');
    for (const k of K_CANDIDATES) {
        const rows = checkDnf(k);
        const allOk = rows.every(r => r.finished);
        console.log(`k=${k}: ${rows.map(r => `${r.trackId}=${r.finished ? 'OK' : 'DNF'}`).join('  ')}  ${allOk ? '[PASS]' : '[FAIL]'}`);
    }

    console.log('\n--- Metriche vs baseline (New Monza + monte-rosso), per candidata k ---');
    for (const trackId of Object.keys(CRITERIA)) {
        console.log(`\n${trackId}:`);
        for (const k of K_CANDIDATES) {
            const r = checkTrack(trackId, k);
            if (r.dnf) { console.log(`  k=${k}: DNF — non valutabile`); continue; }
            console.log(
                `  k=${k}: tempo=${r.adaptive.timeMs}ms (${(r.timeCostFrac * 100).toFixed(1)}%)  ` +
                `distMedia ${r.baseline.avgDist.toFixed(2)}->${r.adaptive.avgDist.toFixed(2)}m (${(r.avgDistReductionFrac * 100).toFixed(1)}%)  ` +
                `distPicco ${r.baseline.peakDist.toFixed(2)}->${r.adaptive.peakDist.toFixed(2)}m (${(r.peakDistReductionFrac * 100).toFixed(1)}%)  ` +
                `${r.pass ? '[PASS criteri Fase 1]' : '[FAIL criteri Fase 1]'}`
            );
        }
    }
}

if (require.main === module) main();

module.exports = { runOnce, checkTrack, checkDnf };
```

- [ ] **Step 2: Smoke test manuale**

Run: `node backend/tools/f1AdaptiveLookaheadCheck.js`
Expected: lo script termina senza eccezioni e stampa il report completo (sezione DNF + sezione metriche per new-monza e monte-rosso, per ognuna delle 3 candidate k).

- [ ] **Step 3: Commit**

```bash
git add backend/tools/f1AdaptiveLookaheadCheck.js
git commit -m "F1: aggiunge strumento di verifica Fase 1 (lookahead adattivo vs baseline, criteri quantitativi spec)"
```

---

### Task 5: Esecuzione finale e report (nessun codice)

- [ ] **Step 1: Esegui lo strumento e raccogli l'output completo**

Run: `node backend/tools/f1AdaptiveLookaheadCheck.js`

- [ ] **Step 2: Valuta ogni candidata k contro i criteri del piano (Global Constraints)**

Per ogni k in `[0.05, 0.1, 0.15]`: DNF su tutte e 4 le piste? Soglie di riduzione media/picco raggiunte su New Monza e monte-rosso? Costo tempo entro +3%?

- [ ] **Step 3: Riporta all'utente**

Presenta la tabella risultati, indica quali candidate k (se esiste almeno una) soddisfano TUTTI i criteri simultaneamente su entrambe le piste, e **fermati**: non procedere alla Fase 2 (sterzo geometrico) senza conferma esplicita dell'utente, indipendentemente dall'esito.

---

## Note per l'esecutore

- Nessun task di questo piano tocca `backend/tools/f1RaceLineOptimizer.js` o alcun file `*-raceline.json` — coerente col vincolo "Fase 4 unica a toccarli".
- Nessun task introduce o modifica `steerGain` — resta root nel piano di Fase 2, non qui.
- Se un test del Task 2 fallisce in modo inatteso (es. il target coincide anche a flag acceso), non forzare l'assert: verificare prima se il raggio scelto nel test produce davvero un lookahead diverso da quello legacy per quella combinazione di velocità/roadHalf/k di default — aggiustare il raggio della curva sintetica nel test, non l'implementazione, a meno che l'ispezione riveli un bug reale.
