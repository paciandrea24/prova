# F1 — Fase 4: limite di aderenza laterale in curva — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** introdurre un modello di **perdita di capacità laterale** (non
uno slip angle fisico) che riduce progressivamente il grip-blend esistente
quando la domanda laterale (sterzo × velocità) eccede la capacità
disponibile (usura/mescola), producendo sottosterzo/scivolata progressiva
verso l'esterno invece del blend a rate fisso di oggi.

**Architecture:** tre responsabilità separate, un modulo ciascuna —
`TyreForceModel.js` (capacità, invariato, solo consumato), un nuovo
`CorneringGripModel.js` (domanda laterale ed eccesso, sola lettura/calcolo,
nessuno stato, nessuna mutazione di `p`), `VehiclePhysics.js` (unico punto
che applica l'effetto, riducendo il `grip` già composto da
`AerodynamicsModel.effectiveGrip` prima che `applyGripBlend` lo consumi).
Dietro flag `F1_CORNERING_GRIP_MODEL=1`, spento di default (comportamento
bit-per-bit identico a oggi a flag spento). Nessuna memoria/debito
persistente in questa fase salvo necessità dimostrata in Task 4.

**Tech Stack:** Node.js, `node:test`/`node:assert/strict` (stesso stile di
tutti i test in `backend/sockets/games/physics/`).

## Global Constraints

- **Italiano** in commenti/comunicazioni (da CLAUDE.md di progetto).
- **Niente commit automatici**: l'utente fa commit/push manualmente quando
  vuole. Ogni task termina con la verifica, MAI con un comando
  `git commit`.
- **Flag spento di default obbligatorio**: ogni task che introduce
  comportamento nuovo deve avere un test che dimostra l'invarianza
  bit-per-bit quando `F1_CORNERING_GRIP_MODEL` non è impostato.
- **Non toccare**: `f1Bot.js`, `f1RaceLineOptimizer.js`, `SteeringModel.js`,
  `VehicleMotionModel.js`, `CollisionResolver.js`, `DamageModel.js`,
  `PowertrainModel.js`, `BrakingModel.js`, `f1LapSimulator.js` (usato
  com'è, nessuna modifica — vedi Task 4 per il perché è comunque
  sufficiente con l'opzione `--speed-factor` già esistente).
- **`AerodynamicsModel.js` non richiede alcuna modifica**: riceve un
  `grip` già ridotto da `VehiclePhysics.js`.
- Riferimento: `docs/superpowers/specs/2026-07-28-f1-cornering-grip-limit-design.md`.

---

### Task 1: `TyreSlipModel.js` — `corneringDemand`/`corneringExcess`

**Files:**
- Modify: `backend/sockets/games/physics/TyreSlipModel.js`
- Test: Modify `backend/sockets/games/physics/TyreSlipModel.test.js`

**Interfaces:**
- Consumes: nessuna da altri task.
- Produces: `corneringDemand(steer, speedFrac) -> number`,
  `corneringExcess(steer, speedFrac, corneringCapacity) -> number` (0..1),
  `CORNERING_EXCESS_PENALTY_MAX` (number), `isCorneringGripModelActive() -> boolean`.
  Consumati da Task 2 (`CorneringGripModel.js`) e Task 3 (`VehiclePhysics.js`).

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in fondo a `backend/sockets/games/physics/TyreSlipModel.test.js`
(dopo l'ultimo test esistente):

```js
const {
    corneringDemand, corneringExcess, CORNERING_EXCESS_PENALTY_MAX,
    isCorneringGripModelActive
} = require('./TyreSlipModel.js');

// ---- corneringDemand / corneringExcess (Fase 4: capacità laterale, non slip angle fisico) ----

test('corneringDemand: sterzo 0 -> 0 sempre, qualunque velocità', () => {
    assertClose(corneringDemand(0, 0), 0, 'sterzo 0, fermo');
    assertClose(corneringDemand(0, 1), 0, 'sterzo 0, velocità massima');
});

test('corneringDemand: fermo (speedFrac=0) -> 0 sempre, qualunque sterzo', () => {
    assertClose(corneringDemand(1, 0), 0, 'sterzo pieno, fermo');
    assertClose(corneringDemand(-1, 0), 0, 'sterzo pieno opposto, fermo');
});

test('corneringDemand: sterzo pieno a velocità massima -> esattamente 1 (nessun boost, a differenza di trazione/frenata: qui la domanda non deve mai superare la capacità piena=1, vedi criterio 0 della spec)', () => {
    assertClose(corneringDemand(1, 1), 1, 'sterzo pieno, velocità massima');
});

test('corneringDemand: simmetrico nel segno dello sterzo (stessa entità, verso opposto)', () => {
    assertClose(corneringDemand(1, 0.6), corneringDemand(-1, 0.6), 'stesso valore assoluto');
});

test('corneringDemand: monotono crescente sia in |steer| che in speedFrac', () => {
    assert.ok(corneringDemand(0.5, 0.5) < corneringDemand(1, 0.5), 'cresce con |steer|');
    assert.ok(corneringDemand(0.5, 0.5) < corneringDemand(0.5, 1), 'cresce con speedFrac');
});

test('corneringExcess: domanda entro capacità piena (capacità=1) -> eccesso 0, anche a sterzo/velocità massimi (criterio 0: gomma fresca/qualifica mai penalizzata)', () => {
    assertClose(corneringExcess(1, 1, 1), 0, 'sterzo pieno, velocità massima, capacità piena');
    assertClose(corneringExcess(1, 0.5, 1), 0, 'sterzo pieno, velocità media, capacità piena');
});

test('corneringExcess: capacità ridotta (gomma usurata) -> eccesso positivo nelle stesse condizioni che a capacità piena davano 0', () => {
    const excess = corneringExcess(1, 1, 0.6);
    assert.ok(excess > 0, `atteso > 0, ottenuto ${excess}`);
    assertClose(excess, 0.4, 'eccesso = domanda(1) - capacità(0.6)');
});

test('corneringExcess: a parità di domanda, cresce (o resta uguale) al diminuire della capacità', () => {
    const highCap = corneringExcess(1, 1, 0.9);
    const lowCap  = corneringExcess(1, 1, 0.6);
    assert.ok(lowCap > highCap, `atteso eccesso maggiore a capacità minore: ${lowCap} vs ${highCap}`);
});

test('corneringExcess: continuità — nessun salto attorno al punto in cui la domanda supera la capacità', () => {
    const capacity = 0.7;
    // speedFrac tale per cui domanda(steer=1, speedFrac) è appena sotto/sopra 0.7
    const justBelow = corneringExcess(1, 0.699, capacity);
    const justAbove = corneringExcess(1, 0.701, capacity);
    assert.ok(Math.abs(justAbove - justBelow) < 0.01, `atteso valori vicini: ${justBelow} vs ${justAbove}`);
});

test('corneringExcess: resta in [0,1] anche a valori estremi', () => {
    const excess = corneringExcess(1, 1, 0);
    assert.ok(excess >= 0 && excess <= 1, `atteso in [0,1], ottenuto ${excess}`);
    assert.ok(!Number.isNaN(excess), 'atteso non-NaN');
});

test('CORNERING_EXCESS_PENALTY_MAX: valore di partenza conservativo confermato (stesso ordine di grandezza di BRAKING_EXCESS_PENALTY_MAX/STEER_LOCKUP_PENALTY_MAX)', () => {
    assert.equal(CORNERING_EXCESS_PENALTY_MAX, 0.40);
});

// ---- isCorneringGripModelActive ----

test('isCorneringGripModelActive: di default (env var non impostata) è false', () => {
    assert.equal(process.env.F1_CORNERING_GRIP_MODEL, undefined);
    assert.equal(isCorneringGripModelActive(), false);
});

test("isCorneringGripModelActive: true solo quando F1_CORNERING_GRIP_MODEL === '1' esattamente", () => {
    process.env.F1_CORNERING_GRIP_MODEL = '1';
    try {
        assert.equal(isCorneringGripModelActive(), true);
    } finally {
        delete process.env.F1_CORNERING_GRIP_MODEL;
    }
    process.env.F1_CORNERING_GRIP_MODEL = 'true';
    try {
        assert.equal(isCorneringGripModelActive(), false);
    } finally {
        delete process.env.F1_CORNERING_GRIP_MODEL;
    }
});

test('isCorneringGripModelActive: indipendente da F1_TYRE_SLIP_MODEL/F1_TYRE_FORCE_MODEL (flag dedicato)', () => {
    process.env.F1_TYRE_SLIP_MODEL = '1';
    process.env.F1_TYRE_FORCE_MODEL = '1';
    try {
        assert.equal(isCorneringGripModelActive(), false, 'gli altri due flag non devono attivare questo');
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
        delete process.env.F1_TYRE_FORCE_MODEL;
    }
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/TyreSlipModel.test.js`
Expected: FAIL — `corneringDemand`/`corneringExcess`/`CORNERING_EXCESS_PENALTY_MAX`/`isCorneringGripModelActive` non definiti (`undefined is not a function` o simile).

- [ ] **Step 3: Implementazione minima**

In `backend/sockets/games/physics/TyreSlipModel.js`, aggiungere prima di
`module.exports` (dopo `STEER_LOCKUP_PENALTY_MAX`):

```js
// Fase 4 (Rif. docs/superpowers/specs/2026-07-28-f1-cornering-grip-limit-design.md):
// domanda/capacità/eccesso laterale — stesso principio di trazione/frenata
// sopra, ma NON è un modello di slip angle fisico: è un modello di perdita
// di CAPACITÀ laterale, applicato come riduzione del grip-blend esistente
// (vedi CorneringGripModel.js/VehiclePhysics.js). A differenza di
// trazione/frenata, qui NON c'è un boost di domanda oltre l'input diretto:
// il criterio di successo esplicito è che la gomma fresca (capacità=1) non
// venga mai penalizzata nemmeno a sterzo pieno e velocità massima, quindi
// la domanda non deve mai superare 1 da sola.
function clampSteer(steer) {
    return Math.max(-1, Math.min(1, steer));
}

// 0 a sterzo neutro o auto ferma, cresce con |sterzo| e con la velocità:
// lo stesso angolo di sterzo chiede più aderenza laterale quanto più forte
// si va (coerente con la fisica reale: la forza centripeta richiesta
// cresce con la velocità). Massimo teorico 1, raggiunto solo a sterzo
// pieno e velocità massima esatti.
function corneringDemand(steer, speedFrac) {
    return Math.abs(clampSteer(steer)) * clampFrac(speedFrac);
}

// Eccesso di aderenza laterale: quanto la domanda supera la capacità
// disponibile (corneringGripFactor, da TyreForceModel — capacità, non
// moltiplicatore). 0 se la domanda è entro la capacità disponibile.
function corneringExcess(steer, speedFrac, corneringCapacity) {
    return clamp01(corneringDemand(steer, speedFrac) - corneringCapacity);
}

// Riduzione massima del grip-blend quando l'eccesso è al suo massimo (1).
// Valore di partenza conservativo (stesso ordine di grandezza delle altre
// penalità massime sopra) — tarabile in playtest (Task 5/6).
const CORNERING_EXCESS_PENALTY_MAX = 0.40;

// Flag DEDICATO e separato da F1_TYRE_SLIP_MODEL/F1_TYRE_FORCE_MODEL: la
// capacità laterale è concettualmente distinta (perdita di capacità, non
// domanda/eccesso di trazione/frenata) e va playtestata/attivata
// indipendentemente. Stesso pattern di isTyreSlipModelActive sopra.
function isCorneringGripModelActive() {
    return process.env.F1_CORNERING_GRIP_MODEL === '1';
}
```

Aggiornare `module.exports` aggiungendo:

```js
    corneringDemand, corneringExcess, CORNERING_EXCESS_PENALTY_MAX, isCorneringGripModelActive
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/TyreSlipModel.test.js`
Expected: PASS su tutti i test (esistenti + nuovi).

- [ ] **Step 5: Verifica**

Run: `node --test backend/sockets/games/physics/`
Expected: PASS su tutta la suite fisica — nessuna regressione sugli altri
moduli (nessuna funzione esistente è stata modificata, solo aggiunte).

---

### Task 2: Nuovo modulo `CorneringGripModel.js`

**Files:**
- Create: `backend/sockets/games/physics/CorneringGripModel.js`
- Test: Create `backend/sockets/games/physics/CorneringGripModel.test.js`

**Interfaces:**
- Consumes: `TyreForceModel.corneringGripFactor(tyreWear, isQuali)` (Task 0,
  esistente), `TyreSlipModel.corneringExcess(steer, speedFrac, capacity)`
  (Task 1).
- Produces: `lateralExcess(p, isQuali, maxSpeed) -> number` (0..1).
  Consumato da Task 3 (`VehiclePhysics.js`). Richiede `p.speed`,
  `p.inputs.steer`, `p.tyreWear` sul player — nessun nuovo campo, tutti già
  presenti oggi.

- [ ] **Step 1: Scrivere i test che falliscono**

Creare `backend/sockets/games/physics/CorneringGripModel.test.js`:

```js
// backend/sockets/games/physics/CorneringGripModel.test.js
//
// Test del modulo Fase 4 (Rif.
// docs/superpowers/specs/2026-07-28-f1-cornering-grip-limit-design.md).
// Responsabilità unica: tradurre lo stato del player nell'eccesso
// laterale (0..1) — sola lettura/calcolo, nessuna mutazione di `p`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { lateralExcess } = require('./CorneringGripModel');
const { corneringGripFactor } = require('./TyreForceModel');
const { corneringExcess } = require('./TyreSlipModel');

function assertClose(actual, expected, label) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: atteso ${expected}, ottenuto ${actual}`);
}

function makePlayer(steer, speed, tyreWear) {
    return { speed, tyreWear, inputs: { throttle: 0, brake: 0, steer } };
}

test('lateralExcess: sterzo 0 -> 0 sempre, qualunque velocità/usura', () => {
    assertClose(lateralExcess(makePlayer(0, 6.2, 0), false, 6.2), 0, 'sterzo 0, gomma fresca');
    assertClose(lateralExcess(makePlayer(0, 6.2, 80), false, 6.2), 0, 'sterzo 0, gomma usurata');
});

test('lateralExcess: gomma fresca (tyreWear=0), sterzo pieno a velocità massima -> 0 (criterio 0: mai penalizzata)', () => {
    const p = makePlayer(1, 6.2, 0);
    assertClose(lateralExcess(p, false, 6.2), 0, 'capacità piena = domanda piena, eccesso 0');
});

test('lateralExcess: gomma usurata (tyreWear=80), sterzo pieno a velocità massima -> eccesso > 0, coerente col calcolo diretto (criterio 3: differenza fresca vs usurata)', () => {
    const p = makePlayer(1, 6.2, 80);
    const excess = lateralExcess(p, false, 6.2);
    const expectedCapacity = corneringGripFactor(80, false);
    const expected = corneringExcess(1, 1, expectedCapacity);
    assert.ok(excess > 0, `atteso > 0, ottenuto ${excess}`);
    assertClose(excess, expected, 'coerente con corneringGripFactor + corneringExcess calcolati a mano');
});

test('lateralExcess: a parità di sterzo/velocità, gomma usurata produce eccesso maggiore o uguale a gomma fresca (criterio 3)', () => {
    const fresh = lateralExcess(makePlayer(1, 6.2, 0), false, 6.2);
    const worn  = lateralExcess(makePlayer(1, 6.2, 80), false, 6.2);
    assert.ok(worn > fresh, `atteso eccesso maggiore su gomma usurata: fresca=${fresh}, usurata=${worn}`);
});

test('lateralExcess: isQuali=true -> sempre 0 a prescindere dall\'usura (stesso invariante di TyreForceModel: in qualifica la capacità è sempre piena) — è questo il motivo per cui f1LapSimulator.js non può verificare il criterio 3, vedi spec', () => {
    const wornInQuali = lateralExcess(makePlayer(1, 6.2, 80), true, 6.2);
    const freshInQuali = lateralExcess(makePlayer(1, 6.2, 0), true, 6.2);
    assertClose(wornInQuali, 0, 'usura ignorata in qualifica, come per ogni altro fattore TyreForceModel');
    assertClose(freshInQuali, wornInQuali, 'stesso risultato di una gomma fresca: la capacità è sempre 1 in qualifica');
});

test('lateralExcess: fermo (speed=0) -> 0 sempre, qualunque sterzo/usura', () => {
    assertClose(lateralExcess(makePlayer(1, 0, 80), false, 6.2), 0, 'fermo, sterzo pieno, gomma usurata');
});

test('lateralExcess: velocità in retromarcia (speed negativo) -> stesso comportamento del valore assoluto', () => {
    const forward = lateralExcess(makePlayer(1, 6.2, 80), false, 6.2);
    const reverse = lateralExcess(makePlayer(1, -6.2, 80), false, 6.2);
    assertClose(forward, reverse, 'speedFrac usa Math.abs(p.speed), simmetrico avanti/indietro');
});

test('lateralExcess: non muta il player (sola lettura)', () => {
    const p = makePlayer(1, 6.2, 80);
    const snapshot = JSON.stringify(p);
    lateralExcess(p, false, 6.2);
    assert.equal(JSON.stringify(p), snapshot, 'nessuna mutazione di p');
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/CorneringGripModel.test.js`
Expected: FAIL — `Cannot find module './CorneringGripModel'`.

- [ ] **Step 3: Implementazione minima**

Creare `backend/sockets/games/physics/CorneringGripModel.js`:

```js
// backend/sockets/games/physics/CorneringGripModel.js
//
// Cornering Grip Model: Fase 4 (Rif.
// docs/superpowers/specs/2026-07-28-f1-cornering-grip-limit-design.md).
// Responsabilità UNICA: tradurre lo stato del player nell'eccesso
// laterale (0..1) — quanto la domanda di aderenza in curva eccede la
// capacità disponibile in questo tick. NON riduce il grip, non tocca `p`,
// non possiede stato: la riduzione effettiva (e l'eventuale stato
// persistente futuro) è applicata dal chiamante (VehiclePhysics.js). Non
// duplica TyreForceModel: la capacità è richiesta a corneringGripFactor,
// mai ricalcolata qui.
//
// NON è un modello di slip angle fisico (vedi nota terminologica nella
// spec): è un modello di perdita di CAPACITÀ laterale, stesso principio
// domanda/capacità già usato per trazione e frenata in TyreSlipModel.js.
const { corneringGripFactor } = require('./TyreForceModel');
const { corneringExcess } = require('./TyreSlipModel');

function lateralExcess(p, isQuali, maxSpeed) {
    const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
    const capacity = corneringGripFactor(p.tyreWear, isQuali);
    return corneringExcess(p.inputs.steer, speedFrac, capacity);
}

module.exports = { lateralExcess };
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/CorneringGripModel.test.js`
Expected: PASS su tutti i test.

- [ ] **Step 5: Verifica**

Run: `node --test backend/sockets/games/physics/`
Expected: PASS su tutta la suite — `CorneringGripModel.js` non è ancora
consumato da nessuno (Task 3), quindi non può aver introdotto regressioni.

---

### Task 3: `VehiclePhysics.js` — applicazione dietro flag

**Files:**
- Modify: `backend/sockets/games/physics/VehiclePhysics.js`
- Test: Modify `backend/sockets/games/physics/VehiclePhysics.test.js`

**Interfaces:**
- Consumes: `CorneringGripModel.lateralExcess(p, isQuali, maxSpeed)` (Task 2),
  `TyreSlipModel.isCorneringGripModelActive()`/`CORNERING_EXCESS_PENALTY_MAX`
  (Task 1).
- Produces: nessuna nuova funzione pubblica — `updateVelocity` (già
  esportata) cambia comportamento solo a flag acceso.

- [ ] **Step 1: Scrivere i test che falliscono**

La regressione a flag spento è già coperta dai 4 test esistenti in cima a
questo file (valori hardcoded calcolati prima di questa fase): dato che il
nuovo blocco è interamente dentro `if (isCorneringGripModelActive())` e
quella funzione ritorna `false` di default, quei 4 test devono continuare
a passare invariati senza bisogno di duplicarli — è la prova stessa che
non serve.

Aggiungere in fondo a `backend/sockets/games/physics/VehiclePhysics.test.js`:

```js
test('updateVelocity: F1_CORNERING_GRIP_MODEL acceso, entro il limite (sterzo moderato, gomma fresca) -> comportamento praticamente identico a flag spento (criterio 0/1)', () => {
    const scenario = () => ({
        speed: 3, vx: 3, vz: 0, angle: 0, compound: 'medium', tyreWear: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        inputs: { throttle: 0, brake: 0, steer: 0.3 }
    });
    const off = run(scenario(), false, 1);

    process.env.F1_CORNERING_GRIP_MODEL = '1';
    try {
        const on = run(scenario(), false, 1);
        assertClose(on.vx, off.vx, 'vx invariato entro il limite');
        assertClose(on.vz, off.vz, 'vz invariato entro il limite');
    } finally {
        delete process.env.F1_CORNERING_GRIP_MODEL;
    }
});

test('updateVelocity: F1_CORNERING_GRIP_MODEL acceso, oltre il limite (sterzo pieno, velocità massima, gomma usurata) -> vz converge meno verso il muso rispetto a flag spento (grip spinto verso 1 = più ancoraggio alla vecchia direzione = più sottosterzo)', () => {
    const scenario = () => ({
        speed: 6.2, vx: 6.2, vz: 0, angle: 0, compound: 'medium', tyreWear: 80,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        inputs: { throttle: 0, brake: 0, steer: 1 }
    });
    const off = run(scenario(), false, 1);

    process.env.F1_CORNERING_GRIP_MODEL = '1';
    try {
        const on = run(scenario(), false, 1);
        // vz_old=0 in questo scenario: p.vz = vz_old*grip + fz*(1-grip) si
        // riduce a fz*(1-grip). Con grip spinto verso 1 (più ancoraggio),
        // (1-grip) si riduce, quindi on.vz deve restare PIÙ INDIETRO
        // rispetto a off.vz (meno convergenza verso il muso, non di più).
        assert.ok(on.vz < off.vz, `atteso vz ridotto a flag acceso: off=${off.vz}, on=${on.vz}`);
        assert.notEqual(on.speed, undefined);
        assertClose(on.speed, off.speed, 'speed (scalare) NON deve cambiare: il modello non tocca p.speed');
        assertClose(on.angle, off.angle, 'angle (turn rate) NON deve cambiare: il modello non tocca SteeringModel');
    } finally {
        delete process.env.F1_CORNERING_GRIP_MODEL;
    }
});

test('updateVelocity: F1_CORNERING_GRIP_MODEL acceso, isQuali=true -> nessuna riduzione anche con gomma "usurata" (capacità sempre piena in qualifica, coerente con TyreForceModel)', () => {
    const scenario = () => ({
        speed: 6.2, vx: 6.2, vz: 0, angle: 0, compound: 'medium', tyreWear: 80,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        inputs: { throttle: 0, brake: 0, steer: 1 }
    });
    const off = run(scenario(), true, 1);

    process.env.F1_CORNERING_GRIP_MODEL = '1';
    try {
        const on = run(scenario(), true, 1);
        assertClose(on.vz, off.vz, 'in qualifica nessuna riduzione, a prescindere da tyreWear');
    } finally {
        delete process.env.F1_CORNERING_GRIP_MODEL;
    }
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/VehiclePhysics.test.js`
Expected: il primo dei 3 nuovi test PASS già oggi (entro il limite, nessun
comportamento nuovo atteso), gli altri 2 FAIL (`on.vz` uguale a `off.vz`
perché il flag non è ancora consumato da nessuna parte).

- [ ] **Step 3: Implementazione minima**

In `backend/sockets/games/physics/VehiclePhysics.js`, aggiungere
l'import e modificare `updateVelocity`:

```js
const PowertrainModel   = require('./PowertrainModel');
const BrakingModel      = require('./BrakingModel');
const SteeringModel     = require('./SteeringModel');
const AerodynamicsModel = require('./AerodynamicsModel');
const CorneringGripModel = require('./CorneringGripModel');
const { integratePosition, applyOffTrackDrag } = require('./VehicleMotionModel');
const { isCorneringGripModelActive, CORNERING_EXCESS_PENALTY_MAX } = require('./TyreSlipModel');
```

E sostituire il corpo di `updateVelocity`:

```js
function updateVelocity(p, isQuali, slipstreamMult) {
    const { inputs } = p;
    const maxSpeed = effectiveMaxSpeed(p, isQuali) * (slipstreamMult || 1);   // dipende da mescola + usura (Soft fissa in qualifica) + scia
    let grip = effectiveGrip(p, isQuali);

    if (inputs.throttle > 0) PowertrainModel.applyThrottle(p, isQuali, maxSpeed);
    else if (inputs.brake > 0) BrakingModel.applyBrake(p, isQuali, maxSpeed, effectiveAccel(p, isQuali));
    else PowertrainModel.applyCoast(p);

    // Il tetto di velocità può essersi abbassato (usura aumentata da fermo non
    // succede, ma cambiando mescola in futuro pit stop sì): non lasciare mai
    // p.speed sopra il nuovo massimo.
    if (p.speed > maxSpeed) p.speed = maxSpeed;

    SteeringModel.applySteering(p, isQuali, maxSpeed);

    // Fase 4 (percorso di confronto, F1_CORNERING_GRIP_MODEL=1): modello di
    // perdita di CAPACITÀ laterale (non slip angle fisico, vedi
    // docs/superpowers/specs/2026-07-28-f1-cornering-grip-limit-design.md).
    //
    // ATTENZIONE al significato di `grip` in applyGripBlend: NON è "quanto
    // l'auto insegue il muso", è l'opposto — pesa quanto p.vx/p.vz
    // RESTANO ancorati alla vecchia direzione invece di convergere verso
    // il muso (p.vx = p.vx*grip + fx*(1-grip): grip ALTO = più ancoraggio
    // alla vecchia direzione = PIÙ divergenza muso/velocità reale nel
    // tempo, cioè PIÙ sottosterzo; grip BASSO = l'auto insegue il muso
    // quasi perfettamente, zero scivolata). Verificato empiricamente
    // simulando uno sterzo sostenuto: a grip=0.9 la divergenza cresce
    // continuamente, a grip=0.4 si stabilizza subito su un valore piccolo.
    // Per questo, quando la domanda eccede la capacità, l'eccesso deve
    // SPINGERE grip VERSO 1 (non ridurlo): NON tocca p.speed né p.angle,
    // l'effetto emerge solo nel blend vx/vz sotto, come scarto crescente
    // tra dove punta il muso e dove va davvero l'auto (sottosterzo/
    // scivolata progressiva verso l'esterno). A flag spento (default),
    // comportamento bit-per-bit identico a prima.
    if (isCorneringGripModelActive()) {
        const excess = CorneringGripModel.lateralExcess(p, isQuali, maxSpeed);
        grip += (1 - grip) * excess * CORNERING_EXCESS_PENALTY_MAX;
    }

    AerodynamicsModel.applyGripBlend(p, grip);
}
```

**Nota (scoperta durante l'esecuzione, non prevista alla scrittura del
piano):** la formula sopra usa `grip += (1-grip)*excess*...`, non
`grip *= 1-excess*...` come una lettura naive di "ridurre il grip"
suggerirebbe. Verificato empiricamente che in `applyGripBlend` esistente,
`grip` ALTO produce PIÙ divergenza muso/velocità (sottosterzo), non meno —
vedi il commento nel codice sopra per i dettagli. I test sotto riflettono
già la versione corretta.

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/VehiclePhysics.test.js`
Expected: PASS su tutti i test (esistenti + nuovi).

- [ ] **Step 5: Verifica completa**

Run: `node --test backend/sockets/games/physics/`
Expected: PASS su tutta la suite fisica.

Run: `node --test backend/sockets/games/`
Expected: PASS su tutta la suite del gioco (f1GameSocket, f1Bot, ecc. — a
flag spento di default, nessuna di queste dovrebbe risentirne).

---

### Task 4: Verifica end-to-end con `f1LapSimulator.js` (criterio 0)

Nessuna modifica di codice in questo task — solo esecuzione e lettura dei
risultati.

**Esito effettivo (diverso da quanto previsto alla scrittura del piano):**
`f1LapSimulator.js` gira sempre con `isQuali=true` (capacità sempre 1) e
`corneringDemand` è senza boost per design (Task 1) — quindi la domanda
non può mai eccedere una capacità che è sempre 1, **a prescindere da
`--speed-factor`**. Non solo il criterio 3 (già chiuso al Task 2), ma
anche il criterio 4 ("profilo sporco mostra una differenza") si è rivelato
non osservabile con questo strumento: verificato per strumentazione
diretta (vedi sotto) che `CorneringGripModel.lateralExcess` ritorna
sempre 0 su un giro intero, sia a `--speed-factor=1` che `=1.3`. Questo
task verifica quindi **solo il criterio 0**; il criterio 4 end-to-end si
sposta al playtest umano (Task 6), unico contesto con `isQuali=false`.

- [ ] **Step 1: Istrumentare `CorneringGripModel.lateralExcess` e confermare che l'eccesso resta 0 lungo tutto il giro**

```bash
cd backend
node -e "
const CorneringGripModel = require('./sockets/games/physics/CorneringGripModel');
const orig = CorneringGripModel.lateralExcess;
let maxExcess = 0, calls = 0, nonZero = 0;
CorneringGripModel.lateralExcess = function(...args) {
    const r = orig.apply(this, args);
    calls++;
    if (r > 0) { nonZero++; if (r > maxExcess) maxExcess = r; }
    return r;
};
process.env.F1_CORNERING_GRIP_MODEL = '1';
const { simulateLap } = require('./tools/f1LapSimulator.js');
const { loadTrack } = require('./sockets/games/trackLoader.js');
const track = loadTrack('new-monza');
const result = simulateLap(track, { speedFactor: 1.3, paceMult: 1, precisionNoise: 0, safetyCapS: 60 });
console.log('finished:', result.finished, 'timeMs:', result.timeMs);
console.log('calls:', calls, 'nonZero:', nonZero, 'maxExcess:', maxExcess);
"
```
Expected: `nonZero: 0`, `maxExcess: 0` — conferma che in questo strumento
l'eccesso non emerge mai, a prescindere dal profilo di guida.

- [ ] **Step 2: Confronto flag on/off a seed RNG fissato (criterio 0)**

Il bot re-estrae `botLapPaceMult` con `Math.random()` ogni quarto di giro
(`f1Bot.js:630`, non legato a questa fase): senza fissare il seed, due run
nominalmente identiche possono differire per questo rumore preesistente.
Per isolare SOLO l'effetto del flag:

```bash
cd backend
node -e "
function makeSeededRandom(seed) {
  let s = seed;
  return function() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
const { loadTrack } = require('./sockets/games/trackLoader.js');
const { simulateLap } = require('./tools/f1LapSimulator.js');
const track = loadTrack('new-monza');
function runSeeded(speedFactor, flagOn) {
    Math.random = makeSeededRandom(42);
    if (flagOn) process.env.F1_CORNERING_GRIP_MODEL = '1'; else delete process.env.F1_CORNERING_GRIP_MODEL;
    const r = simulateLap(track, { speedFactor, paceMult: 1, precisionNoise: 0, safetyCapS: 60 });
    return { timeMs: r.timeMs, finished: r.finished };
}
console.log('speed-factor=1  off:', runSeeded(1, false), ' on:', runSeeded(1, true));
console.log('speed-factor=1.3 off:', runSeeded(1.3, false), ' on:', runSeeded(1.3, true));
"
```
Expected: `timeMs` identico tra `off` e `on` in entrambe le coppie —
conferma rigorosa del criterio 0 (nessuna differenza a parità di RNG),
coerente col criterio 1 già provato a livello di funzione nel Task 1/2/3.

- [ ] **Step 3: Registrare l'esito e passare al Task 6**

Il criterio 4 end-to-end e la decisione sul debito persistente (Task 5)
si spostano al playtest umano (Task 6), unico contesto in cui
`isQuali=false` esiste davvero e la domanda può effettivamente eccedere la
capacità. Durante quel playtest, se l'effetto in gara appare a scatti
(stesso sintomo già osservato per la trazione in Fase 3.0/3A) →
  eseguire Task 5 prima di procedere al playtest.

---

### Task 5 (opzionale — solo se il Task 4 mostra un effetto "a scatti"): debito persistente

**ESITO (2026-07-28): NON IMPLEMENTATO.** Il playtest umano (Task 6) ha
riportato sottosterzo progressivo credibile con gomma usurata, nessun
taglio improvviso, nessuna sensazione "a scatti" — per il criterio di
decisione concordato, il debito persistente non è necessario. Sezione
lasciata come riferimento futuro se la valutazione dovesse cambiare dopo
un uso più esteso.

**Files:**
- Modify: `backend/sockets/games/physics/TyreSlipModel.js`
- Modify: `backend/sockets/games/physics/VehiclePhysics.js`
- Test: Modify `backend/sockets/games/physics/TyreSlipModel.test.js`,
  `backend/sockets/games/physics/VehiclePhysics.test.js`

**Interfaces:**
- Consumes: `corneringExcess` (Task 1).
- Produces: `updateCorneringSlipDebt(prevDebt, excess) -> number` (0..1,
  funzione pura di transizione, stesso stile di `updateTractionSlipDebt`).
  Stato (`p._corneringSlipDebt`) posseduto da `VehiclePhysics.js` (non da
  `CorneringGripModel.js`, che resta sola lettura/calcolo — vedi spec).

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in `backend/sockets/games/physics/TyreSlipModel.test.js`:

```js
const { updateCorneringSlipDebt, CORNERING_SLIP_RISE_RATE, CORNERING_SLIP_DECAY_RATE } = require('./TyreSlipModel.js');

test('updateCorneringSlipDebt: debito assente (undefined, primo tick) + eccesso 0 -> resta 0', () => {
    assertClose(updateCorneringSlipDebt(undefined, 0), 0, 'primo tick, nessun eccesso');
});

test('updateCorneringSlipDebt: accumulo — con eccesso costante, il debito sale rispetto al tick precedente', () => {
    const debt1 = updateCorneringSlipDebt(0, 0.3);
    assert.ok(debt1 > 0, `atteso > 0, ottenuto ${debt1}`);
    const debt2 = updateCorneringSlipDebt(debt1, 0.3);
    assert.ok(debt2 > debt1, `atteso debito crescente con eccesso sostenuto: ${debt1} -> ${debt2}`);
});

test('updateCorneringSlipDebt: decadimento graduale (non a zero istantaneo) quando l\'eccesso sparisce', () => {
    const debtWithExcess = updateCorneringSlipDebt(0, 1);
    const afterOneTick = updateCorneringSlipDebt(debtWithExcess, 0);
    assert.ok(afterOneTick > 0 && afterOneTick < debtWithExcess, `atteso calo graduale: ${debtWithExcess} -> ${afterOneTick}`);
});

test('updateCorneringSlipDebt: resta in [0,1] anche a input estremi ripetuti', () => {
    let debt = 0;
    for (let i = 0; i < 50; i++) debt = updateCorneringSlipDebt(debt, 1);
    assert.ok(debt >= 0 && debt <= 1, `atteso in [0,1], ottenuto ${debt}`);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/TyreSlipModel.test.js`
Expected: FAIL — `updateCorneringSlipDebt` non definito.

- [ ] **Step 3: Implementazione minima**

In `backend/sockets/games/physics/TyreSlipModel.js`, aggiungere dopo
`CORNERING_EXCESS_PENALTY_MAX`:

```js
// Debito persistente laterale (introdotto solo se il Task 4 del piano ha
// mostrato un effetto "a scatti" con l'eccesso istantaneo) — stessa forma
// rise/decay già validata per la trazione in Fase 3.1.
const CORNERING_SLIP_RISE_RATE = 0.6;
const CORNERING_SLIP_DECAY_RATE = 0.85;

function updateCorneringSlipDebt(prevDebt, excess) {
    const decayed = (prevDebt || 0) * CORNERING_SLIP_DECAY_RATE;
    return clamp01(decayed + excess * CORNERING_SLIP_RISE_RATE);
}
```

Aggiungere a `module.exports`:
```js
    CORNERING_SLIP_RISE_RATE, CORNERING_SLIP_DECAY_RATE, updateCorneringSlipDebt
```

In `backend/sockets/games/physics/VehiclePhysics.js`, sostituire il blocco
`if (isCorneringGripModelActive())` di Task 3 con:

```js
    if (isCorneringGripModelActive()) {
        const excess = CorneringGripModel.lateralExcess(p, isQuali, maxSpeed);
        p._corneringSlipDebt = updateCorneringSlipDebt(p._corneringSlipDebt, excess);
        grip *= 1 - p._corneringSlipDebt * CORNERING_EXCESS_PENALTY_MAX;
    }
```
(e aggiungere `updateCorneringSlipDebt` all'import da `TyreSlipModel`
nello stesso file).

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/`
Expected: PASS su tutta la suite (i test di Task 3 restano validi: un
singolo tick isolato con `p._corneringSlipDebt` assente si comporta come
l'eccesso istantaneo puro, `updateCorneringSlipDebt(undefined, excess)`
al primo tick vale `excess * CORNERING_SLIP_RISE_RATE`, non `excess`
esatto — se un test di Task 3 assumeva l'uguaglianza esatta, aggiornarlo
qui con il valore atteso corretto).

- [ ] **Step 5: Ripetere il Task 4 (Step 3) e confermare che l'effetto non è più a scatti**

Run: gli stessi comandi del Task 4 Step 3, confrontando la telemetria.

---

### Task 6: Playtest umano in localhost

Nessun codice: gate soggettivo finale prima di considerare l'attivazione
di default.

- [ ] **Step 1: Avviare il server** (`node server.js` dalla cartella
  `backend/`) e aprire una partita F1 in due tab (umano + bot).

- [ ] **Step 2: Impostare il flag e riavviare**

```
F1_CORNERING_GRIP_MODEL=1 node server.js
```
(dalla cartella `backend/` — ricordarsi che è una env var di processo, va
impostata PRIMA di avviare, non a runtime).

- [ ] **Step 3: Provare scenari mirati**

- Guida entro il margine abituale, gomma fresca: deve sentirsi identica a
  oggi (criterio 0/1).
- Entrare in curva volutamente troppo forte (sterzo brusco/tardivo ad alta
  velocità): cercare una sensazione di sottosterzo progressivo — l'auto
  "va dritta" più di quanto punti il muso — non un taglio secco di
  velocità né uno sterzo che smette di rispondere.
- Ripetere lo stesso errore con gomma volutamente usurata (giocare
  qualche giro prima in gara, non qualifica — la qualifica ignora sempre
  l'usura): il limite deve farsi sentire prima e più severamente.
- Verificare che NON si abbia mai la sensazione "l'auto è diventata più
  lenta e basta" guidando normalmente.

- [ ] **Step 4: Registrare l'esito**

Se il comportamento è credibile sui 4 criteri (vedi punto 5 della spec):
il flag può restare acceso per un periodo di prova più ampio prima di
diventare default — l'attivazione di default va decisa dall'utente, non
in automatico da questo piano.
Se emergono problemi (auto ingestibile, effetto impercettibile, gomma
fresca comunque penalizzata): tornare al Task 1/3 per ritarare
`CORNERING_EXCESS_PENALTY_MAX` o la formula di `corneringDemand`, non
aggiungere nuova complessità (niente nuovi assi/costanti) prima di aver
tarato quelli già introdotti.

**ESITO (2026-07-28):** gomma poco usurata, nessuna differenza percepibile
(atteso, criterio 0 — il limite raramente si avvicina per design). Gomma
usurata: sottosterzo progressivo percepito e giudicato credibile, nessun
taglio improvviso, nessuna sensazione "auto più lenta e basta". Nessun
effetto "a scatti" → Task 5 (debito persistente) valutato non necessario,
non implementato. Flag `F1_CORNERING_GRIP_MODEL` resta spento di default;
l'eventuale attivazione di default o commit restano a discrezione
dell'utente.
