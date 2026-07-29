# F1 — Fase 1: drag longitudinale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dare a `AerodynamicsModel.dragFactor` una prima formula reale
(placeholder Fase 0 → curva velocità→drag) e collegarla a
`PowertrainModel.effectiveMaxSpeed`, dietro flag di confronto, senza
toccare downforce/scia/danno aero né altri consumer.

**Scoperta in ricognizione (vedi messaggio in conversazione):**
`effectiveMaxSpeed` non dipende oggi da `p.speed` — tutti gli altri
consumer di `speedFrac` nel codebase lo calcolano dividendo per un
`maxSpeed` già noto, ma qui `maxSpeed` è l'output che stiamo calcolando
(dipendenza circolare). Risolto calcolando `speedFrac` sulla costante
`MAX_SPEED` (6.2), non sul risultato di questo tick.

**Architecture:** `AerodynamicsModel.js` possiede la formula (`dragFactor`)
e il flag (`isAeroDragModelActive`) — stesso schema di
`isCorneringGripModelActive` in `TyreSlipModel.js` (il modulo di dominio
possiede sia la formula sia il flag che ne gate l'applicazione).
`PowertrainModel.js` **consulta**, non possiede: importa
`AerodynamicsModel` e lo usa dentro `effectiveMaxSpeed`. Nessun altro file
cambia.

**Tech Stack:** Node.js, `node:test`/`node:assert/strict`.

## Global Constraints

- **Italiano** in commenti/comunicazioni (da CLAUDE.md di progetto).
- **Niente commit automatici**: l'utente fa commit/push manualmente.
- **Flag di confronto dedicato** `F1_AERO_DRAG_MODEL`, spento di default —
  comportamento bit-per-bit identico a oggi a flag spento.
- **Non toccare**: `downforceFactor`, `slipstreamFactor` (restano
  placeholder neutri, Fase 2/4), `DamageModel.js` (Fase 3),
  `CorneringGripModel.js`, `SteeringModel.js`, `BrakingModel.js`,
  `VehicleMotionModel.js`, `VehiclePhysics.js`, `f1GameSocket.js`.
- Riferimento: `docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md`.

---

### Task 1: `AerodynamicsModel.js` — formula drag reale + flag

**Files:**
- Modify: `backend/sockets/games/physics/AerodynamicsModel.js`
- Test: Modify `backend/sockets/games/physics/AerodynamicsModel.test.js`

**Interfaces:**
- Consumes: nessuna da altri task.
- Produces: `dragFactor(speedFrac, isQuali)` (formula reale, sostituisce il
  placeholder Fase 0), `isAeroDragModelActive() -> boolean`,
  `DRAG_TOP_SPEED_PENALTY_MAX`, `DRAG_EXPONENT` (esportate per test).
  Consumati da Task 2 (`PowertrainModel.js`).

- [ ] **Step 1: Scrivere i test che falliscono / aggiornare quelli obsoleti**

In `backend/sockets/games/physics/AerodynamicsModel.test.js`, aggiornare
il require in cima:

```js
const { GRIP, effectiveGrip, applyGripBlend, downforceFactor, dragFactor, slipstreamFactor, isAeroDragModelActive, DRAG_TOP_SPEED_PENALTY_MAX } = require('./AerodynamicsModel');
```

Sostituire il test placeholder Fase 0 di `dragFactor` (che assumeva sempre
1) con:

```js
test('dragFactor: velocità zero -> nessuna penalità (fattore 1), qualunque qualifica', () => {
    assert.equal(dragFactor(0, false), 1);
    assert.equal(dragFactor(0, true), 1);
});

test('dragFactor: velocità massima -> penalità massima pari a DRAG_TOP_SPEED_PENALTY_MAX', () => {
    assert.ok(Math.abs(dragFactor(1, false) - (1 - DRAG_TOP_SPEED_PENALTY_MAX)) < 1e-9);
});

test('dragFactor: monotono decrescente al crescere di speedFrac', () => {
    assert.ok(dragFactor(0.5, false) > dragFactor(1, false));
    assert.ok(dragFactor(0.2, false) > dragFactor(0.5, false));
});

test('dragFactor: indipendente da isQuali (fenomeno fisico, non penalità da usura/danno)', () => {
    assert.equal(dragFactor(0.7, false), dragFactor(0.7, true));
});

test('isAeroDragModelActive: di default (env var non impostata) è false', () => {
    assert.equal(process.env.F1_AERO_DRAG_MODEL, undefined);
    assert.equal(isAeroDragModelActive(), false);
});

test("isAeroDragModelActive: true solo quando F1_AERO_DRAG_MODEL === '1' esattamente", () => {
    process.env.F1_AERO_DRAG_MODEL = '1';
    try {
        assert.equal(isAeroDragModelActive(), true);
    } finally {
        delete process.env.F1_AERO_DRAG_MODEL;
    }
    process.env.F1_AERO_DRAG_MODEL = 'true';
    try {
        assert.equal(isAeroDragModelActive(), false);
    } finally {
        delete process.env.F1_AERO_DRAG_MODEL;
    }
});
```

`downforceFactor`/`slipstreamFactor` restano invariati (i loro test Fase 0
non si toccano).

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/AerodynamicsModel.test.js`
Expected: FAIL sui nuovi test `dragFactor`/`isAeroDragModelActive` (funzioni
non ancora aggiornate/definite), PASS sul resto.

- [ ] **Step 3: Implementazione minima**

Sostituire in `AerodynamicsModel.js` il placeholder Fase 0 di `dragFactor`
con:

```js
// Fase 1 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// prima formula reale di drag longitudinale — valore di partenza
// conservativo, tarabile in playtest. Cresce con speedFrac^2 (ispirazione
// fisica: la resistenza aerodinamica cresce col quadrato della velocità,
// non un vincolo rigoroso). NON dipende da isQuali: a differenza delle
// penalità da usura/danno, il drag è un fenomeno fisico sempre presente,
// non un degrado che la qualifica ignora — isQuali resta nella firma solo
// in vista della Fase 3 (danno aero), che quella sì seguirà la stessa
// esenzione qualifica di ogni altro danno.
const DRAG_TOP_SPEED_PENALTY_MAX = 0.05;
const DRAG_EXPONENT = 2;

function dragFactor(speedFrac, isQuali) {
    const frac = Math.max(0, Math.min(1, speedFrac));
    return 1 - Math.pow(frac, DRAG_EXPONENT) * DRAG_TOP_SPEED_PENALTY_MAX;
}

// Flag di confronto Fase 1, dedicato e separato (stesso pattern di
// isCorneringGripModelActive in TyreSlipModel.js) — spento di default,
// comportamento bit-per-bit identico a oggi.
function isAeroDragModelActive() {
    return process.env.F1_AERO_DRAG_MODEL === '1';
}
```

Aggiornare `module.exports`:

```js
module.exports = {
    GRIP, effectiveGrip, applyGripBlend,
    downforceFactor, dragFactor, slipstreamFactor,
    isAeroDragModelActive, DRAG_TOP_SPEED_PENALTY_MAX, DRAG_EXPONENT
};
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/AerodynamicsModel.test.js`
Expected: PASS su tutti i test.

- [ ] **Step 5: Verifica**

Run: `node --test backend/sockets/games/physics/`
Expected: PASS su tutta la suite fisica (nessun consumer ancora collegato,
Task 2 lo fa).

---

### Task 2: `PowertrainModel.js` — consultazione dietro flag

**Files:**
- Modify: `backend/sockets/games/physics/PowertrainModel.js`
- Test: Modify `backend/sockets/games/physics/PowertrainModel.test.js`

**Interfaces:**
- Consumes: `AerodynamicsModel.dragFactor`/`isAeroDragModelActive` (Task 1).
- Produces: nessuna nuova funzione pubblica — `effectiveMaxSpeed` (già
  esportata) cambia comportamento solo a flag acceso.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in cima a `PowertrainModel.test.js`:
```js
const AerodynamicsModel = require('./AerodynamicsModel');
```

Aggiungere in fondo al file:

```js
test('effectiveMaxSpeed: F1_AERO_DRAG_MODEL non impostato -> comportamento identico a prima (baseline invariata)', () => {
    assert.equal(process.env.F1_AERO_DRAG_MODEL, undefined);
    const p = { speed: 6.2, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    assert.equal(effectiveMaxSpeed(p, false), 6.2);
});

test('effectiveMaxSpeed: F1_AERO_DRAG_MODEL="1", velocità zero -> drag factor neutro (1), nessuna differenza dal flag spento', () => {
    const p = { speed: 0, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    const off = effectiveMaxSpeed(p, false);
    process.env.F1_AERO_DRAG_MODEL = '1';
    try {
        const on = effectiveMaxSpeed(p, false);
        assert.equal(on, off, 'a velocità zero il drag factor è 1: nessun effetto');
    } finally {
        delete process.env.F1_AERO_DRAG_MODEL;
    }
});

test('effectiveMaxSpeed: F1_AERO_DRAG_MODEL="1", velocità massima -> tetto di velocità ridotto in modo misurabile', () => {
    const p = { speed: 6.2, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    const off = effectiveMaxSpeed(p, false);
    process.env.F1_AERO_DRAG_MODEL = '1';
    try {
        const on = effectiveMaxSpeed(p, false);
        assert.ok(on < off, `atteso tetto ridotto: off=${off}, on=${on}`);
        const expected = off * AerodynamicsModel.dragFactor(1, false);
        assert.ok(Math.abs(on - expected) < 1e-9, `atteso ${expected}, ottenuto ${on}`);
    } finally {
        delete process.env.F1_AERO_DRAG_MODEL;
    }
});

test('effectiveMaxSpeed: F1_AERO_DRAG_MODEL="1", p.speed assente -> nessun NaN (fallback a 0, stesso invariante già usato per damageParts)', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    process.env.F1_AERO_DRAG_MODEL = '1';
    try {
        const on = effectiveMaxSpeed(p, false);
        assert.ok(!Number.isNaN(on), 'atteso non-NaN anche senza p.speed');
        assert.equal(on, 6.2, 'p.speed assente -> trattato come 0 -> drag factor neutro');
    } finally {
        delete process.env.F1_AERO_DRAG_MODEL;
    }
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/PowertrainModel.test.js`
Expected: il primo nuovo test PASS già oggi (flag spento, nessun
comportamento nuovo). Gli altri 3 FAIL (`effectiveMaxSpeed` non consulta
ancora `AerodynamicsModel`).

- [ ] **Step 3: Implementazione minima**

In `backend/sockets/games/physics/PowertrainModel.js`, aggiungere
l'import in cima:

```js
const AerodynamicsModel = require('./AerodynamicsModel');
```

Sostituire il corpo di `effectiveMaxSpeed`:

```js
function effectiveMaxSpeed(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_SPEED_PENALTY;
    const engineFactor = isQuali ? 1 : 1 - getEnginePowerPenalty(p.damageParts);
    let maxSpeed = MAX_SPEED * tyreOf(p, isQuali).speedMult * wearFactor * engineFactor;

    // Fase 1 (percorso di confronto, F1_AERO_DRAG_MODEL=1): drag
    // longitudinale, formula e flag posseduti da AerodynamicsModel (unico
    // proprietario del dominio aero) — PowertrainModel consulta soltanto.
    // speedFrac calcolato sulla costante MAX_SPEED, non su maxSpeed
    // stesso: effectiveMaxSpeed non può usare il proprio output — ancora
    // da calcolare in questa riga — come denominatore (dipendenza
    // circolare), vedi piano Fase 1 per il dettaglio. A flag spento,
    // comportamento bit-per-bit identico a prima.
    if (AerodynamicsModel.isAeroDragModelActive()) {
        const speedFrac = Math.min(1, Math.abs(p.speed || 0) / MAX_SPEED);
        maxSpeed *= AerodynamicsModel.dragFactor(speedFrac, isQuali);
    }

    return maxSpeed;
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/PowertrainModel.test.js`
Expected: PASS su tutti i test (esistenti + nuovi).

- [ ] **Step 5: Verifica completa**

Run: `node --test backend/sockets/games/physics/`
Expected: PASS su tutta la suite fisica.

Run: `node --test backend/sockets/games/`
Expected: PASS (a parte i 2 fallimenti pre-esistenti e non correlati già
noti dalla Fase 0 — `monte-rosso` targetKm, quali spawn — da riconfermare
come tali, non causati da questa fase).

Verifica di confine (nessun altro consumer toccato):
```bash
git diff --stat backend/sockets/games/physics/DamageModel.js backend/sockets/games/physics/CorneringGripModel.js backend/sockets/games/physics/SteeringModel.js backend/sockets/games/physics/BrakingModel.js backend/sockets/games/physics/VehiclePhysics.js backend/sockets/games/f1GameSocket.js
```
Expected: nessun output.

---

## Esito atteso di questa fase

`PowertrainModel.effectiveMaxSpeed` consulta `AerodynamicsModel.dragFactor`
dietro `F1_AERO_DRAG_MODEL`, spento di default. A flag acceso, il tetto di
velocità si riduce fino al 5% alla velocità massima, zero effetto da fermo.
Downforce, scia e danno aero restano placeholder neutri (Fasi 2/3/4).
Nessun playtest umano richiesto in questo piano (il drag qui non cambia
ancora feedback percettivo diretto per l'utente finché il flag resta
spento di default — l'eventuale attivazione/promozione a default e il
relativo playtest restano una decisione futura dell'utente, come per le
fasi precedenti).

## Esito (2026-07-28)

Eseguita come da piano: 17/18 → 18/18 test in `PowertrainModel.test.js`,
zero regressioni. Verificato in checkpoint successivo (con Fasi 2-4
complete) che, a tutti e 4 i flag aero attivi insieme, non emergono NaN/
valori negativi in uno sweep di 288 combinazioni — vedi
`docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md`
("Stato finale — checkpoint"). Playtest umano ancora non eseguito, non
promosso a default.
