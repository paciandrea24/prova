# F1 — traiettoria fuori-dentro-fuori + taglio proporzionale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Riprogettare come i bot F1 tagliano le curve (fuori-dentro-fuori invece di solo taglio verso l'apice) e calcolano la velocità di curva, usando un'unica fonte di curvatura condivisa, per abbassare il tetto di 24.2s misurato su Monza in fase 1 — restando "realistici" (stessa fisica di un umano) e senza mai peggiorare/bloccare il bot su nessuna delle 6 piste esistenti.

**Architecture:** Un helper puro `windowRadius` (raggio in una singola finestra) estratto dal codice duplicato oggi in `apexOffset`/`cornerTargetSpeed`. Una nuova funzione `cornerApexNear` (trova la curva più vicina a un punto e il suo apice, camminando verso il minimo locale di raggio) usata SOLO dalla traiettoria. `cornerTargetSpeed` mantiene la sua logica multi-curva invariata, usa solo `windowRadius` al posto del calcolo inline. `apexOffset` diventa una funzione a S della distanza con segno dall'apice (esterno → interno → esterno), ampiezza proporzionale a quanto è stretta la curva.

**Tech Stack:** Node.js puro, `node:test`, nessuna nuova dipendenza.

## Global Constraints

- Niente commit automatici: commit/push manuali a cura dell'utente (CLAUDE.md). Ogni task termina con `node --test` (e, per i task che toccano il comportamento reale, una corsa di `f1LapSimulator.js`), mai con `git commit` nello step — se il flusso di esecuzione prevede commit locali nel worktree (subagent-driven-development), sono gestiti dal controller/implementer secondo le istruzioni di dispatch, non descritti come step qui.
- Commenti nel codice in italiano.
- `cornerTargetSpeed` deve restare comportamentalmente identica (stessi numeri per gli stessi input) dopo l'estrazione di `windowRadius`: i test esistenti in `f1Bot.test.js` per `cornerTargetSpeed` NON vanno modificati e devono continuare a passare invariati.
- Nessuna nuova voce in `DEFAULT_TUNING`: la riprogettazione riusa `tuning.apexMaxFraction`/`tuning.cornerSpeedMargin`/`tuning.brakingDistanceMargin` esistenti, nessun nuovo parametro tunable.
- Prima di considerare una versione pronta: zero "non completato" e nessun tempo peggiore del baseline di fase 1 su NESSUNA delle 6 piste in `frontend/tracks/` (monza, monte-rosso, prova, interlagos, nuova-pista, test-bot) — verificato con `backend/tools/f1LapSimulator.js --all-tracks` (fase 1, riusato invariato).
- Baseline di fase 1 da non peggiorare (tuning di default, `speedFactor=1,paceMult=1,precisionNoise=0`): monza 24200ms, interlagos 32650ms, monte-rosso 20100ms, prova 54250ms, nuova-pista 46550ms, test-bot 32250ms.
- **Rischio noto, non verificabile con lo strumento di fase 1**: la logica di sorpasso in `updateBotInputs` (`cornerIsMild`, fuori scope di questo piano) riusa `apex.dx`/`apex.dz` della NUOVA `apexOffset` per stimare quanto è stretta la curva corrente prima di tentare un sorpasso. La nuova funzione può restituire un'ampiezza non nulla anche in fase di allargamento esterno (ingresso/uscita curva), non solo al taglio massimo come la vecchia versione — potrebbe rendere `cornerIsMild` più o meno permissivo di prima in modo non intenzionale. `f1LapSimulator.js` gira SOLO in qualifica (il sorpasso è disattivato in quali, `!isQuali`), quindi questo piano non può verificarlo in automatico: va controllato a mano in localhost, in gara con più bot, dopo l'implementazione — non bloccante per chiudere questo piano, ma da segnalare esplicitamente all'utente nel report finale.

---

### Task 1: `windowRadius` — helper condiviso, refactor di `cornerTargetSpeed`

**Files:**
- Modify: `backend/sockets/games/f1Bot.js`
- Test: `backend/sockets/games/f1Bot.test.js`

**Interfaces:**
- Consumes: nessuna dipendenza da altri task.
- Produces: `windowRadius(points, i1, i2, localArcM) → { radius, turnSigned } | null` — usato da Task 2 (`cornerApexNear`) e dal refactor di `cornerTargetSpeed` in questo stesso task.

- [ ] **Step 1: Scrivere il test che fallisce per `windowRadius`**

Aggiungi in `backend/sockets/games/f1Bot.test.js` (il file importa già `test`/`assert`/`buildConstantCurveTrack` in cima; aggiungi `windowRadius` alla riga di `require('./f1Bot.js')`):

```js
test('windowRadius: rettilineo => null (nessuna curvatura significativa)', () => {
    const points = buildConstantCurveTrack(40, 40, 0);
    const w = windowRadius(points, 5, 15, 10);
    assert.equal(w, null);
});

test('windowRadius: curva a raggio noto => raggio coerente con arco/angolo', () => {
    const delta = 0.05;   // raggio geometrico atteso ≈ 1/delta = 20
    const points = buildConstantCurveTrack(60, 0, delta);
    const w = windowRadius(points, 10, 20, 10);   // arco locale = 10 unità (passo unitario nel builder)
    assert.ok(w !== null);
    assert.ok(Math.abs(w.radius - 20) < 1, `atteso raggio ~20, ottenuto ${w.radius}`);
    assert.ok(w.turnSigned > 0, 'curva verso destra (delta>0) => turnSigned positivo, come già verificato per apexOffset');
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: FAIL — `windowRadius is not a function`.

- [ ] **Step 3: Implementare `windowRadius` ed estrarre il refactor in `cornerTargetSpeed`**

In `backend/sockets/games/f1Bot.js`, aggiungi PRIMA di `cornerTargetSpeed` (circa riga 105, dopo `apexOffset`):

```js
// ====================================================
// RAGGIO IN UNA FINESTRA — helper puro condiviso: la stessa formula
// arco/angolo era duplicata identica in apexOffset e cornerTargetSpeed;
// estratta qui perché cornerApexNear (vedi sotto) e cornerTargetSpeed devono
// misurare la curvatura nello stesso identico modo — sterzo e freno non
// devono mai vedere due stime diverse della stessa curva.
// ====================================================
function windowRadius(points, i1, i2, localArcM) {
    const t1 = TrackGeometry.tangentAt(points, i1, true);
    const t2 = TrackGeometry.tangentAt(points, i2, true);
    const angle1 = Math.atan2(t1.tx, t1.tz);
    const angle2 = Math.atan2(t2.tx, t2.tz);
    const turnSigned = normalizeAngle(angle2 - angle1);
    if (Math.abs(turnSigned) < 1e-4) return null;   // praticamente dritto
    return { radius: localArcM / Math.abs(turnSigned), turnSigned };
}
```

Poi sostituisci il corpo di `cornerTargetSpeed` (la firma resta IDENTICA, cambia solo l'interno del loop):

```js
function cornerTargetSpeed(points, idx, scanSamples, localSamples, metersPerSample, currentSpeed, maxSpeed, brakeDecel, turnRateAtMax, marginFactor) {
    const n = points.length;
    const step = Math.max(1, Math.floor(localSamples / 2));
    const localArcM = localSamples * metersPerSample;
    let target = maxSpeed;
    for (let offset = 0; offset <= scanSamples; offset += step) {
        const i1 = lookaheadIndex(n, idx, offset);
        const i2 = lookaheadIndex(n, idx, offset + localSamples);
        const w = windowRadius(points, i1, i2, localArcM);
        if (!w) continue;   // praticamente dritto, nessun raggio significativo da questa finestra
        const cornerSpeed = Math.min(maxSpeed, w.radius * turnRateAtMax * marginFactor);
        if (cornerSpeed >= currentSpeed) continue;   // già più lenti del necessario per questa curva
        const distanceM = offset * metersPerSample;
        const neededBrakingM = (currentSpeed * currentSpeed - cornerSpeed * cornerSpeed) / (2 * brakeDecel);
        if (distanceM <= neededBrakingM && cornerSpeed < target) target = cornerSpeed;
    }
    return target;
}
```

Aggiungi `windowRadius` a `module.exports` in fondo al file.

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: PASS — i 2 nuovi test PIÙ tutti i test esistenti di `cornerTargetSpeed` (4 test, righe ~126-152 del file attuale) invariati (stessa firma, stesso comportamento numerico).

- [ ] **Step 5: Verifica il resto della suite**

Run: `node --test backend/sockets/games/ backend/tools/`
Expected: PASS su tutto (unico fallimento noto/pre-esistente: `trackLoader.test.js` qualiSpawn).

---

### Task 2: fixture di curvatura variabile + `cornerApexNear`

**Files:**
- Modify: `backend/sockets/games/f1Bot.js`
- Test: `backend/sockets/games/f1Bot.test.js`

**Interfaces:**
- Consumes: `windowRadius` (Task 1).
- Produces: `cornerApexNear(points, idx, searchSamples, localSamples, metersPerSample) → { apexIdx, apexRadius, distanceToApexM } | null` — usato da Task 3 (`apexOffset`).

- [ ] **Step 1: Scrivere la fixture di curvatura variabile + i test che falliscono**

`buildConstantCurveTrack` (già nel file) produce curvatura COSTANTE dopo il rettilineo — un arco circolare puro non ha un apice ben definito (il raggio non varia). Serve una fixture che stringe e poi allarga, come una curva vera. Aggiungi in `backend/sockets/games/f1Bot.test.js`, vicino a `buildConstantCurveTrack`:

```js
// Curva che stringe (curvatura crescente) fino a un picco a metà della zona
// di curva, poi allarga di nuovo (curvatura decrescente) — a differenza di
// buildConstantCurveTrack (raggio costante, nessun apice ben definito), qui
// il raggio ha un vero minimo a metà curva: serve per testare che
// cornerApexNear trovi il minimo locale corretto, non un punto qualunque
// dentro la curva.
function buildVaryingCurveTrack(totalSamples, straightSamples, curveSamples, peakDeltaAnglePerSample) {
    const pts = [];
    let x = 0, z = 0, heading = 0;
    const half = curveSamples / 2;
    for (let i = 0; i < totalSamples; i++) {
        pts.push({ x, z });
        let delta = 0;
        if (i >= straightSamples && i < straightSamples + curveSamples) {
            const k = i - straightSamples;
            // Triangolo: 0 → peak (prima metà), peak → 0 (seconda metà)
            const t = k < half ? k / half : (curveSamples - k) / half;
            delta = peakDeltaAnglePerSample * t;
        }
        heading += delta;
        x += Math.sin(heading);
        z += Math.cos(heading);
    }
    return pts;
}

test('cornerApexNear: rettilineo puro => null', () => {
    const points = buildConstantCurveTrack(60, 60, 0);
    const apex = cornerApexNear(points, 10, 40, 10, 1);
    assert.equal(apex, null);
});

test('cornerApexNear: curva che stringe e riallarga => trova il punto di raggio minimo a metà curva', () => {
    const points = buildVaryingCurveTrack(120, 20, 60, 0.08);   // curva da campione 20 a 80, picco a 50
    const idx = 30;   // dentro la curva, prima del picco
    const apex = cornerApexNear(points, idx, 60, 10, 1);
    assert.ok(apex !== null);
    assert.ok(Math.abs(apex.apexIdx - 50) <= 6, `atteso apice vicino al campione 50, ottenuto ${apex.apexIdx}`);
    assert.ok(apex.distanceToApexM > 0, 'apice davanti a idx=30 => distanza positiva');
});

test('cornerApexNear: chicane (due curve ravvicinate) => trova la curva PIÙ VICINA, non la più stretta', () => {
    // Prima curva (campioni 20-50, picco 35): raggio moderato.
    // Seconda curva (campioni 70-100, picco 85), molto più stretta.
    const pts = [];
    let x = 0, z = 0, heading = 0;
    for (let i = 0; i < 150; i++) {
        pts.push({ x, z });
        let delta = 0;
        if (i >= 20 && i < 50) {
            const k = i - 20, half = 15;
            const t = k < half ? k / half : (30 - k) / half;
            delta = 0.04 * t;   // curva dolce
        } else if (i >= 70 && i < 100) {
            const k = i - 70, half = 15;
            const t = k < half ? k / half : (30 - k) / half;
            delta = -0.15 * t;   // curva molto più stretta, segno opposto
        }
        heading += delta;
        x += Math.sin(heading);
        z += Math.cos(heading);
    }
    const idx = 25;   // dentro la PRIMA curva (dolce), lontano dalla seconda (stretta)
    const apex = cornerApexNear(pts, idx, 60, 10, 1);
    assert.ok(apex !== null);
    assert.ok(apex.apexIdx < 60, `atteso apice della prima curva (~35), ottenuto ${apex.apexIdx} — se vicino a 85 ha sbagliato curva`);
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: FAIL — `cornerApexNear is not a function`.

- [ ] **Step 3: Implementare `cornerApexNear`**

Aggiungi in `backend/sockets/games/f1Bot.js`, dopo `windowRadius`:

```js
// ====================================================
// APICE PIÙ VICINO — trova la curva più VICINA a un punto dato (non la più
// stretta in un orizzonte lungo: una versione che cercasse il raggio minimo
// assoluto su una distanza ampia rischierebbe di agganciarsi a un tornante
// lontano invece della curva che il bot sta davvero affrontando ora — vedi
// spec, caso chicane). Cammina da idx verso la prima finestra con curvatura
// significativa (in entrambe le direzioni), poi prosegue in quella direzione
// finché il raggio continua a diminuire: il punto in cui smette di scendere
// è il minimo locale, cioè l'apice di QUELLA curva.
// ====================================================
function cornerApexNear(points, idx, searchSamples, localSamples, metersPerSample) {
    const n = points.length;
    const step = Math.max(1, Math.floor(localSamples / 2));
    const localArcM = localSamples * metersPerSample;
    const halfLocal = Math.floor(localSamples / 2);

    function windowAt(offsetSamples) {
        const i1 = lookaheadIndex(n, idx, offsetSamples);
        const i2 = lookaheadIndex(n, idx, offsetSamples + localSamples);
        const w = windowRadius(points, i1, i2, localArcM);
        return w ? w.radius : null;
    }

    let startOffset = null;
    let startRadius = null;
    let direction = 1;
    for (let d = 0; d <= searchSamples; d += step) {
        const fwd = windowAt(d);
        if (fwd !== null) { startOffset = d; startRadius = fwd; direction = 1; break; }
        if (d > 0) {
            const back = windowAt(-d);
            if (back !== null) { startOffset = -d; startRadius = back; direction = -1; break; }
        }
    }
    if (startOffset === null) return null;   // nessuna curvatura significativa nel raggio di ricerca

    let bestOffset = startOffset;
    let bestRadius = startRadius;
    let cursor = startOffset;
    while (true) {
        const nextOffset = cursor + direction * step;
        const nextRadius = windowAt(nextOffset);
        if (nextRadius === null || nextRadius >= bestRadius) break;
        bestRadius = nextRadius;
        bestOffset = nextOffset;
        cursor = nextOffset;
    }

    const apexIdx = lookaheadIndex(n, idx, bestOffset + halfLocal);
    return { apexIdx, apexRadius: bestRadius, distanceToApexM: (bestOffset + halfLocal) * metersPerSample };
}
```

Aggiungi `cornerApexNear` a `module.exports`.

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: PASS. Se il test della chicane o della curva variabile non passa al primo colpo (es. `apexIdx` fuori dalla tolleranza), è un problema del passo di scansione (`step`) troppo grosso rispetto a `curveSamples` nella fixture — aggiusta la fixture (più campioni, picco più netto) o il test (tolleranza), NON allentare la logica dell'algoritmo per far quadrare i numeri. Iterare qui con TDD è normale: il criterio di successo è la relazione geometrica (apice vicino al vero picco, curva giusta trovata nella chicane), non un numero esatto scritto a mano.

- [ ] **Step 5: Verifica il resto della suite**

Run: `node --test backend/sockets/games/ backend/tools/`
Expected: PASS su tutto (a parte il fallimento noto/pre-esistente).

---

### Task 3: `apexOffset` fuori-dentro-fuori con taglio proporzionale

**Files:**
- Modify: `backend/sockets/games/f1Bot.js`
- Test: `backend/sockets/games/f1Bot.test.js`

**Interfaces:**
- Consumes: `cornerApexNear` (Task 2), `tuning.apexMaxFraction` (fase 1, invariato).
- Produces: `apexOffset(points, idx, searchSamples, localSamples, metersPerSample, roadHalf, maxOffsetFraction) → { dx, dz }` — nuova firma (vedi sotto), usata da `updateBotInputs`. **Firma cambiata rispetto a oggi**: da `(points, idx, halfWindowSamples, maxOffsetM)` a questa nuova lista di parametri — il call site in `updateBotInputs` va aggiornato in questo stesso task.

- [ ] **Step 1: Scrivere i test geometrici che falliscono per la nuova `apexOffset`**

I test ESISTENTI di `apexOffset` (righe ~64-98 del file attuale: "rettilineo => nessun offset", "sposta verso il centro geometrico", "rispetta il limite massimo") assumono la vecchia firma a 4 argomenti e il vecchio comportamento (mai negativo). Vanno RISCRITTI per la nuova firma e il nuovo comportamento a S. Sostituisci quei 3 test con:

```js
test('apexOffset: rettilineo puro => nessun offset', () => {
    const points = buildConstantCurveTrack(80, 80, 0);
    const offset = apexOffset(points, 40, 60, 10, 1, 5, 0.85);
    assert.equal(offset.dx, 0);
    assert.equal(offset.dz, 0);
});

test('apexOffset: esattamente all\'apice => il massimo taglio verso l\'interno (verso il centro di curvatura)', () => {
    const points = buildVaryingCurveTrack(120, 20, 60, 0.08);   // apice atteso ~campione 50
    const before = points[50];
    // Centro di curvatura approssimato: per una curva verso destra (delta>0)
    // il centro sta dal lato interno rispetto al verso di marcia — stessa
    // verifica geometrica diretta già usata per la vecchia apexOffset,
    // adattata: il punto con l'offset applicato deve essere più vicino al
    // centro pista "verso l'interno" (normale invertita) rispetto al punto originale.
    const normal = TrackGeometry.normalAt(points, 50, true);
    const offset = apexOffset(points, 50, 60, 10, 1, 5, 0.85);
    const mag = Math.hypot(offset.dx, offset.dz);
    assert.ok(mag > 0.5 * 5 * 0.85, `atteso offset vicino al massimo all'apice, ottenuto magnitudine ${mag}`);
});

test('apexOffset: ben prima dell\'apice (in ingresso curva) => offset verso l\'ESTERNO (verso opposto rispetto all\'apice)', () => {
    const points = buildVaryingCurveTrack(120, 20, 60, 0.08);   // apice ~50
    const idx = 22;   // appena entrato in curva, lontano dall'apice
    const offsetAtEntry = apexOffset(points, idx, 60, 10, 1, 5, 0.85);
    const offsetAtApex = apexOffset(points, 50, 60, 10, 1, 5, 0.85);
    // Stesso verso della normale (stesso lato pista), ma segno OPPOSTO tra
    // ingresso (esterno) e apice (interno): il prodotto scalare dei due
    // offset deve essere negativo.
    const dot = offsetAtEntry.dx * offsetAtApex.dx + offsetAtEntry.dz * offsetAtApex.dz;
    assert.ok(dot < 0, `atteso offset di segno opposto tra ingresso e apice, ottenuto dot=${dot}`);
});

test('apexOffset: mai oltre roadHalf*maxOffsetFraction in valore assoluto, anche su un tornante strettissimo', () => {
    const points = buildVaryingCurveTrack(120, 20, 60, 0.5);   // tornante molto stretto
    for (const idx of [20, 30, 40, 50, 60, 70, 79]) {
        const offset = apexOffset(points, idx, 60, 10, 1, 5, 0.85);
        const mag = Math.hypot(offset.dx, offset.dz);
        assert.ok(mag <= 5 * 0.85 + 1e-6, `atteso <= ${5 * 0.85} a idx=${idx}, ottenuto ${mag}`);
    }
});

test('apexOffset: curva dolce => ampiezza minore che su un tornante stretto (taglio proporzionale)', () => {
    const mild = buildVaryingCurveTrack(120, 20, 60, 0.02);
    const sharp = buildVaryingCurveTrack(120, 20, 60, 0.3);
    const offsetMild = apexOffset(mild, 50, 60, 10, 1, 5, 0.85);
    const offsetSharp = apexOffset(sharp, 50, 60, 10, 1, 5, 0.85);
    assert.ok(Math.hypot(offsetSharp.dx, offsetSharp.dz) > Math.hypot(offsetMild.dx, offsetMild.dz),
        'atteso swing maggiore sul tornante stretto rispetto alla curva dolce');
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: FAIL — `apexOffset` ha ancora la vecchia firma/comportamento (i test chiamano con 7 argomenti, la funzione attuale ne accetta 4; anche una volta aggiornata la firma, il comportamento a S non esiste ancora).

- [ ] **Step 3: Riscrivere `apexOffset`**

Sostituisci interamente la funzione `apexOffset` esistente (righe 88-103 del file attuale) con:

```js
// ====================================================
// TAGLIO CURVE FUORI-DENTRO-FUORI — a differenza della versione precedente
// (uno scalino: zero in rettilineo, salta a un taglio fisso verso l'interno
// appena c'è curvatura), l'offset è ora una funzione a S della distanza con
// segno dall'apice della curva più vicina (vedi cornerApexNear): negativo
// (verso l'ESTERNO) ben prima e ben dopo l'apice, positivo (verso
// l'INTERNO) esattamente all'apice — il classico fuori-dentro-fuori di un
// pilota vero. L'ampiezza è proporzionale a quanto la curva è stretta
// rispetto alla larghezza pista (severity), non più una frazione fissa
// uguale per ogni curva — vedi spec
// docs/superpowers/specs/2026-07-24-f1-bot-cornering-redesign-design.md.
// ====================================================
function apexOffset(points, idx, searchSamples, localSamples, metersPerSample, roadHalf, maxOffsetFraction) {
    const apex = cornerApexNear(points, idx, searchSamples, localSamples, metersPerSample);
    if (!apex) return { dx: 0, dz: 0 };

    // Zona di influenza fuori-dentro-fuori: più ampia su una curva ampia,
    // più stretta su un tornante — stessa logica dell'angolo di riferimento
    // già usato per "severity" nella versione precedente.
    const halfSpanM = apex.apexRadius * BOT_APEX_REF_ANGLE;
    const x = Math.max(-1, Math.min(1, apex.distanceToApexM / halfSpanM));
    let shape;
    if (Math.abs(apex.distanceToApexM) <= halfSpanM) {
        shape = Math.cos(x * Math.PI);   // +1 all'apice, -1 ai bordi della zona di influenza
    } else {
        // Oltre la zona di influenza: rampa lineare da -1 a 0 su una seconda
        // finestra della stessa ampiezza — mai restare "allargati"
        // all'infinito dopo l'uscita o ben prima dell'ingresso.
        const beyond = (Math.abs(apex.distanceToApexM) - halfSpanM) / halfSpanM;
        shape = -Math.max(0, 1 - Math.min(1, beyond));
    }

    const severity = Math.min(1, roadHalf / apex.apexRadius);
    const mag = shape * severity * maxOffsetFraction * roadHalf;

    // Verso: come nella versione precedente, dal segno della curvatura
    // all'apice (turnSigned>0 = curva a destra nella convenzione
    // atan2(tx,tz) di questo file => l'interno è dal lato opposto alla
    // normale). apexRadius/turnSigned non sono nello stesso oggetto:
    // recupera il segno con una windowRadius alla posizione dell'apice.
    const apexNext = lookaheadIndex(points.length, apex.apexIdx, Math.max(1, Math.floor(localSamples / 2)));
    const w = windowRadius(points, apex.apexIdx, apexNext, localSamples * metersPerSample);
    const insideSign = (w && w.turnSigned > 0) ? -1 : 1;

    const normal = TrackGeometry.normalAt(points, idx, true);
    return { dx: normal.nx * mag * insideSign, dz: normal.nz * mag * insideSign };
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: PASS. Se il test "segno opposto ingresso/apice" o "ampiezza proporzionale" non passa, il problema più probabile è `halfSpanM` troppo piccolo/grande rispetto a `curveSamples` nella fixture — aggiusta i parametri della fixture nel test (curva più lunga/più corta) prima di toccare la formula, verificando prima con un log manuale (`console.log`) dei valori intermedi (`apex.distanceToApexM`, `halfSpanM`, `shape`) per capire dove diverge.

- [ ] **Step 5: Aggiornare il call site in `updateBotInputs`**

In `backend/sockets/games/f1Bot.js`, dentro `updateBotInputs`, sostituisci:

```js
            const apex = apexOffset(track.points, targetIdx, localSamples, track.roadHalf * tuning.apexMaxFraction);
```

con:

```js
            const apexSearchSamples = metersToSamples(scanM, track);   // stesso ordine di grandezza della distanza di frenata: sufficiente a coprire una curva tipica senza agganciare tornanti troppo lontani
            const apex = apexOffset(track.points, targetIdx, apexSearchSamples, localSamples, metersPerSample, track.roadHalf, tuning.apexMaxFraction);
```

Nota: `scanM`/`scanSamples`/`metersPerSample` sono già calcolati poco sopra in `updateBotInputs` per `cornerTargetSpeed` — riusali, non ricalcolarli. Verifica che `apexSearchSamples` sia calcolato DOPO `scanM` (che dipende da `maxSpeed`, calcolato prima nella funzione) — sposta la riga se necessario per rispettare l'ordine di dipendenza già presente nel file.

- [ ] **Step 6: Eseguire tutti i test del file e verificare che passino**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: PASS su tutti i test del file (Task 1 + Task 2 + questo task).

- [ ] **Step 7: Verifica il resto della suite**

Run: `node --test backend/sockets/games/ backend/tools/`
Expected: PASS su tutto (a parte il fallimento noto/pre-esistente in `trackLoader.test.js`).

---

### Task 4: Verifica finale — regressione su tutte le piste + metrica di successo

**Files:**
- Nessuna modifica a file di codice — solo verifica.

**Interfaces:**
- Consumes: tutto quanto sopra.
- Produces: report di verifica (nessuna interfaccia per altri task — è il gate finale di questo sotto-progetto).

- [ ] **Step 1: Suite completa**

Run: `node --test backend/sockets/games/ backend/tools/`
Expected: PASS su tutto (a parte il fallimento noto/pre-esistente in `trackLoader.test.js`).

- [ ] **Step 2: Regressione su tutte le 6 piste con tuning di default**

Run: `node backend/tools/f1LapSimulator.js --all-tracks`
Expected: tutte e 6 le piste con `Finito=si`, e nessun tempo peggiore del baseline di fase 1 (vedi Global Constraints per i 6 valori). Se una pista peggiora o si blocca, la versione NON è pronta — tornare al Task 3 (la formula a S, non le altre funzioni già validate isolatamente) e correggere, verificando di nuovo qui prima di procedere.

- [ ] **Step 3: Metrica di successo su Monza**

Run: `node backend/tools/f1LapSimulator.js monza`
Registra il tempo ottenuto e confrontalo con il baseline di 24200ms. Riportare nel report finale: nuovo tempo, differenza rispetto al baseline, e se il tempo è sceso (obiettivo primario di questo sotto-progetto) o no.

- [ ] **Step 4: Verifica del preset `zero-margin` (non deve peggiorare rispetto a prima)**

Run: `node backend/tools/f1LapSimulator.js monte-rosso --preset=zero-margin --safety-cap=120`
Expected: **ancora "NON completato"** è accettabile (limite noto e documentato di `apexMaxFraction=1.0`, non introdotto da questo piano) — l'obiettivo qui è solo confermare che questa riprogettazione non ha *peggiorato* la situazione nota (es. bloccando anche altre piste che prima finivano). Se il DNF ora compare anche su altre piste con questo preset, investigare prima di considerare il lavoro completo.

## Self-Review (svolta durante la stesura di questo piano)

**Copertura spec:** `windowRadius` condiviso (Task 1) → nessuna regressione alla logica multi-curva di `cornerTargetSpeed`. `cornerApexNear` con ricerca bidirezionale "più vicina, non più stretta" (Task 2) → risolve esplicitamente il rischio chicane descritto nella spec. Formula a S con taglio proporzionale (Task 3) → copre sia l'allargamento esterno sia il taglio interno sia la proporzionalità alla strettezza. Nessuna nuova voce `DEFAULT_TUNING` (rispetta il vincolo globale). Regressione su tutte le 6 piste + metrica Monza (Task 4) → gate esplicito richiesto dalla spec prima di considerare il lavoro pronto.

**Placeholder:** nessuno — ogni step ha codice completo; dove il risultato numerico esatto non è prevedibile a mano (Task 2/3, geometria nuova), il piano usa asserzioni RELATIVE (es. "ampiezza maggiore sul tornante che sulla curva dolce", non un numero scolpito) e istruzioni esplicite di iterazione TDD invece di un placeholder.

**Coerenza tipi/nomi:** `apexOffset` ha firma nuova in Task 3, usata coerentemente nei suoi stessi test e nell'unico call site (`updateBotInputs`, Task 3 Step 5) — nessun altro punto del codice chiama `apexOffset` (verificato: solo `updateBotInputs` e i test lo referenziano). `cornerApexNear`/`windowRadius` usati con nomi/campi identici tra Task 2, Task 3 e la spec (`apexIdx`, `apexRadius`, `distanceToApexM`, `radius`, `turnSigned`).
