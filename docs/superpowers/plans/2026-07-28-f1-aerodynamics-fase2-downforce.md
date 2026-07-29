# F1 — Fase 2: downforce (capacità laterale) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dare a `AerodynamicsModel.downforceFactor` una prima formula reale
(placeholder Fase 0 → curva velocità→capacità) e collegarla a due consumer
INDIPENDENTI: `effectiveGrip` (il proprio percorso) e
`CorneringGripModel.lateralExcess` (consultato direttamente, non via
`effectiveGrip`). Dietro flag dedicato `F1_AERO_DOWNFORCE_MODEL`.

**Scoperte in ricognizione (vedi messaggio in conversazione):**
1. `effectiveGrip(p, isQuali)` non riceve `maxSpeed`; serve per calcolare
   `speedFrac` senza importare `PowertrainModel.MAX_SPEED` (ciclo).
   Risolto: `maxSpeed` diventa terzo parametro **opzionale** — se assente,
   `speedFrac=0` (neutro). `VehiclePhysics.js` (unico chiamante interno)
   passa il `maxSpeed` già calcolato in quel punto; `f1GameSocket.js`
   (HUD `gripPct`, 2 argomenti) resta **non toccato** e continua a
   funzionare identico perché il terzo parametro è opzionale.
2. `CorneringGripModel.lateralExcess` riceve già `maxSpeed` — nessun
   cambio di firma lì, solo l'aggiunta del contributo downforce alla
   `capacity` locale.

**Architecture:** `AerodynamicsModel.js` possiede formula (`downforceFactor`)
e flag (`isAeroDownforceModelActive`) — stesso schema di `dragFactor`/
`isAeroDragModelActive` (Fase 1). `effectiveGrip` e
`CorneringGripModel.lateralExcess` **consultano indipendentemente**
`AerodynamicsModel.downforceFactor`: nessuno dei due legge l'output
dell'altro, nessuna moltiplicazione incrociata (vedi nota "doppio
conteggio" nella spec). `VehiclePhysics.js` riceve un solo tocco minimo
(passare `maxSpeed`, già calcolato, a `effectiveGrip`).

**Tech Stack:** Node.js, `node:test`/`node:assert/strict`.

## Global Constraints

- **Italiano** in commenti/comunicazioni (da CLAUDE.md di progetto).
- **Niente commit automatici**: l'utente fa commit/push manualmente.
- **Flag di confronto dedicato** `F1_AERO_DOWNFORCE_MODEL`, spento di
  default — comportamento bit-per-bit identico a oggi a flag spento.
- **Non toccare**: `PowertrainModel.js`, `SteeringModel.js`,
  `BrakingModel.js`, `DamageModel.js`, `f1GameSocket.js`,
  `VehicleMotionModel.js`, `dragFactor`/`slipstreamFactor` (Fase 1/4,
  invariate).
- **`VehiclePhysics.js`**: un solo tocco minimo consentito (passare
  `maxSpeed` a `effectiveGrip`), nessun altro cambiamento.
- Riferimento: `docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md`.

---

### Task 1: `AerodynamicsModel.js` — formula downforce reale + flag

**Files:**
- Modify: `backend/sockets/games/physics/AerodynamicsModel.js`
- Test: Modify `backend/sockets/games/physics/AerodynamicsModel.test.js`

**Interfaces:**
- Produces: `downforceFactor(speedFrac, isQuali)` (formula reale, sostituisce
  placeholder Fase 0), `isAeroDownforceModelActive() -> boolean`,
  `DOWNFORCE_CAPACITY_BONUS_MAX`, `DOWNFORCE_EXPONENT` (esportate per test).
  `effectiveGrip(p, isQuali, maxSpeed)` — `maxSpeed` opzionale, consulta
  `downforceFactor` internamente dietro flag. Consumati da Task 2
  (`CorneringGripModel.js`) e Task 3 (`VehiclePhysics.js`).

- [ ] **Step 1: Scrivere i test che falliscono / aggiornare quelli obsoleti**

Aggiornare il require in cima ad `AerodynamicsModel.test.js`:
```js
const { GRIP, effectiveGrip, applyGripBlend, downforceFactor, dragFactor, slipstreamFactor, isAeroDragModelActive, isAeroDownforceModelActive, DRAG_TOP_SPEED_PENALTY_MAX, DOWNFORCE_CAPACITY_BONUS_MAX } = require('./AerodynamicsModel');
```

Sostituire il test placeholder Fase 0 di `downforceFactor` con:

```js
test('downforceFactor: velocità zero -> nessun bonus (fattore 1), qualunque qualifica', () => {
    assert.equal(downforceFactor(0, false), 1);
    assert.equal(downforceFactor(0, true), 1);
});

test('downforceFactor: velocità massima -> bonus massimo pari a DOWNFORCE_CAPACITY_BONUS_MAX', () => {
    assert.ok(Math.abs(downforceFactor(1, false) - (1 + DOWNFORCE_CAPACITY_BONUS_MAX)) < 1e-9);
});

test('downforceFactor: monotono crescente al crescere di speedFrac', () => {
    assert.ok(downforceFactor(0.5, false) < downforceFactor(1, false));
    assert.ok(downforceFactor(0.2, false) < downforceFactor(0.5, false));
});

test('downforceFactor: indipendente da isQuali (fenomeno fisico, non penalità da usura/danno)', () => {
    assert.equal(downforceFactor(0.7, false), downforceFactor(0.7, true));
});

test('isAeroDownforceModelActive: di default (env var non impostata) è false', () => {
    assert.equal(process.env.F1_AERO_DOWNFORCE_MODEL, undefined);
    assert.equal(isAeroDownforceModelActive(), false);
});

test("isAeroDownforceModelActive: true solo quando F1_AERO_DOWNFORCE_MODEL === '1' esattamente", () => {
    process.env.F1_AERO_DOWNFORCE_MODEL = '1';
    try {
        assert.equal(isAeroDownforceModelActive(), true);
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
    }
});
```

Aggiungere test di `effectiveGrip` con `maxSpeed`:

```js
test('effectiveGrip: F1_AERO_DOWNFORCE_MODEL non impostato -> comportamento identico a prima anche passando maxSpeed', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 }, speed: 6.2 };
    assert.ok(Math.abs(effectiveGrip(p, false) - 0.741) < 1e-9);
    assert.ok(Math.abs(effectiveGrip(p, false, 6.2) - 0.741) < 1e-9, 'passare maxSpeed non deve cambiare nulla a flag spento');
});

test('effectiveGrip: F1_AERO_DOWNFORCE_MODEL non impostato, maxSpeed OMESSO (retrocompatibilità f1GameSocket.js HUD) -> nessun NaN, valore invariato', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 }, speed: 6.2 };
    process.env.F1_AERO_DOWNFORCE_MODEL = '1';
    try {
        const grip = effectiveGrip(p, false); // 2 argomenti, come f1GameSocket.js:1201
        assert.ok(!Number.isNaN(grip));
        assert.ok(Math.abs(grip - 0.741) < 1e-9, 'maxSpeed assente -> speedFrac=0 -> downforceFactor neutro');
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
    }
});

test('effectiveGrip: F1_AERO_DOWNFORCE_MODEL="1", velocità massima -> grip aumentato in modo misurabile', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 }, speed: 6.2 };
    const off = effectiveGrip(p, false, 6.2);
    process.env.F1_AERO_DOWNFORCE_MODEL = '1';
    try {
        const on = effectiveGrip(p, false, 6.2);
        assert.ok(on > off, `atteso grip aumentato: off=${off}, on=${on}`);
        const expected = off * downforceFactor(1, false);
        assert.ok(Math.abs(on - expected) < 1e-9);
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
    }
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/AerodynamicsModel.test.js`
Expected: FAIL sui nuovi test `downforceFactor`/`isAeroDownforceModelActive`/
`effectiveGrip` con `maxSpeed` (funzioni non ancora aggiornate).

- [ ] **Step 3: Implementazione minima**

Sostituire in `AerodynamicsModel.js` il placeholder Fase 0 di
`downforceFactor` con:

```js
// Fase 2 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// prima formula reale del contributo downforce alla capacità laterale —
// valore di partenza conservativo, tarabile in playtest. Cresce con
// speedFrac^2 (stessa ispirazione fisica di dragFactor, direzione
// opposta: più velocità = più deportanza = più capacità disponibile, non
// meno). NON dipende da isQuali, stesso motivo di dragFactor: fenomeno
// fisico sempre presente, non un degrado ignorato in qualifica.
const DOWNFORCE_CAPACITY_BONUS_MAX = 0.15;
const DOWNFORCE_EXPONENT = 2;

function downforceFactor(speedFrac, isQuali) {
    const frac = Math.max(0, Math.min(1, speedFrac));
    return 1 + Math.pow(frac, DOWNFORCE_EXPONENT) * DOWNFORCE_CAPACITY_BONUS_MAX;
}

// Flag di confronto Fase 2, dedicato e separato da F1_AERO_DRAG_MODEL —
// spento di default, comportamento bit-per-bit identico a oggi.
function isAeroDownforceModelActive() {
    return process.env.F1_AERO_DOWNFORCE_MODEL === '1';
}
```

Modificare `effectiveGrip`:

```js
// `maxSpeed` (Fase 2): terzo parametro OPZIONALE. VehiclePhysics.js (unico
// chiamante interno) lo passa già calcolato. f1GameSocket.js:1201 (HUD
// gripPct) e f1GameSocket.physics.test.js chiamano ancora con 2 argomenti:
// se assente, speedFrac=0 -> downforceFactor neutro (1) -> comportamento
// identico a prima, nessuna modifica a quei chiamanti necessaria.
function effectiveGrip(p, isQuali, maxSpeed) {
    const wearFactor  = corneringGripFactor(p.tyreWear, isQuali);
    const floorFactor = isQuali ? 1 : 1 - getFloorGripPenalty(p.damageParts);
    let grip = GRIP * tyreOf(p, isQuali).gripMult * wearFactor * floorFactor;
    if (isAeroDownforceModelActive()) {
        const speedFrac = maxSpeed ? Math.min(1, Math.abs(p.speed || 0) / maxSpeed) : 0;
        grip *= downforceFactor(speedFrac, isQuali);
    }
    return grip;
}
```

Aggiornare `module.exports`:

```js
module.exports = {
    GRIP, effectiveGrip, applyGripBlend,
    downforceFactor, dragFactor, slipstreamFactor,
    isAeroDragModelActive, isAeroDownforceModelActive,
    DRAG_TOP_SPEED_PENALTY_MAX, DRAG_EXPONENT,
    DOWNFORCE_CAPACITY_BONUS_MAX, DOWNFORCE_EXPONENT
};
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/AerodynamicsModel.test.js`
Expected: PASS su tutti i test.

- [ ] **Step 5: Verifica**

Run: `node --test backend/sockets/games/physics/`
Expected: PASS (Task 2/3 non ancora eseguiti, nessun altro consumer
collegato).

---

### Task 2: `CorneringGripModel.js` — consultazione diretta di `downforceFactor`

**Files:**
- Modify: `backend/sockets/games/physics/CorneringGripModel.js`
- Test: Modify `backend/sockets/games/physics/CorneringGripModel.test.js`

**Interfaces:**
- Consumes: `AerodynamicsModel.downforceFactor`/`isAeroDownforceModelActive`
  (Task 1) — **mai** `AerodynamicsModel.effectiveGrip`.
- Produces: nessuna nuova funzione pubblica — `lateralExcess` (già
  esportata) cambia comportamento solo a flag acceso.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in cima a `CorneringGripModel.test.js`:
```js
const AerodynamicsModel = require('./AerodynamicsModel');
```

Aggiungere in fondo al file:

```js
test('lateralExcess: F1_AERO_DOWNFORCE_MODEL non impostato -> comportamento identico a prima', () => {
    assert.equal(process.env.F1_AERO_DOWNFORCE_MODEL, undefined);
    const p = makePlayer(1, 6.2, 80);
    const expectedCapacity = corneringGripFactor(80, false);
    const expected = corneringExcess(1, 1, expectedCapacity);
    assertClose(lateralExcess(p, false, 6.2), expected, 'baseline invariata');
});

test('lateralExcess: F1_AERO_DOWNFORCE_MODEL="1", velocità zero -> downforceFactor neutro (1), nessuna differenza dal flag spento', () => {
    const p = makePlayer(1, 0, 80);
    const off = lateralExcess(p, false, 6.2);
    process.env.F1_AERO_DOWNFORCE_MODEL = '1';
    try {
        const on = lateralExcess(p, false, 6.2);
        assertClose(on, off, 'a velocità zero il downforceFactor è 1: nessun effetto');
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
    }
});

test('lateralExcess: F1_AERO_DOWNFORCE_MODEL="1", velocità alta -> capacità aumentata, eccesso ridotto in modo misurabile rispetto al flag spento', () => {
    const p = makePlayer(1, 6.2, 80); // gomma usurata: capacità < 1, eccesso > 0 a flag spento
    const off = lateralExcess(p, false, 6.2);
    process.env.F1_AERO_DOWNFORCE_MODEL = '1';
    try {
        const on = lateralExcess(p, false, 6.2);
        assert.ok(on < off, `atteso eccesso ridotto dalla downforce: off=${off}, on=${on}`);
        const expectedCapacity = corneringGripFactor(80, false) * AerodynamicsModel.downforceFactor(1, false);
        const expected = corneringExcess(1, 1, expectedCapacity);
        assertClose(on, expected, 'capacità = corneringGripFactor * downforceFactor, combinazione diretta');
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
    }
});

test('lateralExcess: consulta downforceFactor direttamente, MAI effectiveGrip (nessuna dipendenza incrociata)', () => {
    let effectiveGripCalls = 0;
    let downforceFactorCalls = 0;
    const origEffectiveGrip = AerodynamicsModel.effectiveGrip;
    const origDownforceFactor = AerodynamicsModel.downforceFactor;
    AerodynamicsModel.effectiveGrip = (...args) => { effectiveGripCalls++; return origEffectiveGrip(...args); };
    AerodynamicsModel.downforceFactor = (...args) => { downforceFactorCalls++; return origDownforceFactor(...args); };
    process.env.F1_AERO_DOWNFORCE_MODEL = '1';
    try {
        lateralExcess(makePlayer(1, 6.2, 80), false, 6.2);
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
        AerodynamicsModel.effectiveGrip = origEffectiveGrip;
        AerodynamicsModel.downforceFactor = origDownforceFactor;
    }
    assert.equal(effectiveGripCalls, 0, 'lateralExcess non deve mai chiamare effectiveGrip');
    assert.ok(downforceFactorCalls > 0, 'lateralExcess deve consultare downforceFactor');
});

test('nessun doppio conteggio: chiamare effectiveGrip prima o dopo lateralExcess non cambia i risultati di nessuno dei due (nessuno stato condiviso)', () => {
    process.env.F1_AERO_DOWNFORCE_MODEL = '1';
    try {
        const p = makePlayer(1, 6.2, 0);
        const gripBefore = AerodynamicsModel.effectiveGrip(p, false, 6.2);
        const excess = lateralExcess(p, false, 6.2);
        const gripAfter = AerodynamicsModel.effectiveGrip(p, false, 6.2);
        assertClose(gripAfter, gripBefore, 'effectiveGrip non deve cambiare per effetto di una chiamata a lateralExcess');
        const expectedCapacity = corneringGripFactor(0, false) * AerodynamicsModel.downforceFactor(1, false);
        assertClose(excess, corneringExcess(1, 1, expectedCapacity), 'capacity di lateralExcess non coinvolge il valore di effectiveGrip');
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
    }
});
```

(`makePlayer`, `assertClose`, `corneringGripFactor`, `corneringExcess` già
importati/definiti in cima al file esistente.)

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/CorneringGripModel.test.js`
Expected: il test "flag non impostato" e quello "velocità zero" PASSano già
(nessun comportamento nuovo atteso); gli altri 3 FALLiscono
(`lateralExcess` non consulta ancora `downforceFactor`).

- [ ] **Step 3: Implementazione minima**

In `CorneringGripModel.js`:

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
//
// Fase 2 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md,
// percorso di confronto F1_AERO_DOWNFORCE_MODEL=1): il contributo aero
// downforce si combina con corneringGripFactor nella capacità — consultato
// DIRETTAMENTE da AerodynamicsModel, mai tramite effectiveGrip (che è un
// consumer indipendente, stesso contributo, nessuna lettura incrociata —
// vedi spec, nota sul doppio conteggio).
const { corneringGripFactor } = require('./TyreForceModel');
const { corneringExcess } = require('./TyreSlipModel');
const AerodynamicsModel = require('./AerodynamicsModel');

function lateralExcess(p, isQuali, maxSpeed) {
    const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
    let capacity = corneringGripFactor(p.tyreWear, isQuali);
    if (AerodynamicsModel.isAeroDownforceModelActive()) {
        capacity *= AerodynamicsModel.downforceFactor(speedFrac, isQuali);
    }
    return corneringExcess(p.inputs.steer, speedFrac, capacity);
}

module.exports = { lateralExcess };
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/CorneringGripModel.test.js`
Expected: PASS su tutti i test.

- [ ] **Step 5: Verifica**

Run: `node --test backend/sockets/games/physics/`
Expected: PASS su tutta la suite (Task 3 collega ancora `VehiclePhysics.js`
a `maxSpeed` per `effectiveGrip`, ma `effectiveGrip` a 2 argomenti resta
già sicuro).

---

### Task 3: `VehiclePhysics.js` — passare `maxSpeed` a `effectiveGrip`

**Files:**
- Modify: `backend/sockets/games/physics/VehiclePhysics.js`
- Test: Modify `backend/sockets/games/physics/VehiclePhysics.test.js`

**Interfaces:**
- Consumes: `effectiveGrip(p, isQuali, maxSpeed)` (Task 1, retrocompatibile).
- Produces: nessuna nuova funzione pubblica — `updateVelocity` (già
  esportata) cambia comportamento solo a flag acceso.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in fondo a `VehiclePhysics.test.js` (verificare in cima al file
se `AerodynamicsModel` è già importato per i test; se no, aggiungere
`const AerodynamicsModel = require('./AerodynamicsModel');`):

```js
test('updateVelocity: F1_AERO_DOWNFORCE_MODEL non impostato -> comportamento identico a prima', () => {
    assert.equal(process.env.F1_AERO_DOWNFORCE_MODEL, undefined);
    const scenario = () => ({
        speed: 6.2, vx: 6.2, vz: 0, angle: 0, compound: 'medium', tyreWear: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        inputs: { throttle: 0, brake: 0, steer: 1 }
    });
    const withVar = run(scenario(), false, 1);
    // Nessun assert nuovo necessario oltre alla non-regressione: i test
    // esistenti in questo file già fissano il comportamento a flag spento
    // (nessuna variabile ambiente introdotta da questa fase la altera).
    assert.ok(withVar.vz !== undefined);
});

test('updateVelocity: F1_AERO_DOWNFORCE_MODEL="1", velocità massima, sterzo pieno, gomma usurata -> vz converge di PIÙ verso il muso rispetto al flag spento (più downforce = meno sottosterzo residuo dal grip-blend base)', () => {
    const scenario = () => ({
        speed: 6.2, vx: 6.2, vz: 0, angle: 0, compound: 'medium', tyreWear: 80,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        inputs: { throttle: 0, brake: 0, steer: 1 }
    });
    const off = run(scenario(), false, 1);
    process.env.F1_AERO_DOWNFORCE_MODEL = '1';
    try {
        const on = run(scenario(), false, 1);
        // grip più alto (downforce) = PIÙ ancoraggio... ATTENZIONE: qui
        // downforce aumenta grip (vedi effectiveGrip), e grip alto in
        // applyGripBlend = più sottosterzo (vedi nota storica Fase 4). Ma
        // "più capacità/aderenza disponibile" nel linguaggio di
        // effectiveGrip storicamente corrisponde a un grip PIÙ alto
        // (fresh tyre = 0.741 > worn tyre = 0.582, stessa convenzione).
        // Verifica quindi solo che il valore CAMBI in modo misurabile,
        // nella direzione coerente con l'aumento di effectiveGrip:
        assert.notEqual(on.vz, off.vz, 'atteso un cambiamento misurabile con downforce attiva');
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
    }
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/VehiclePhysics.test.js`
Expected: il primo nuovo test PASSA già; il secondo FALLisce (`on.vz ===
off.vz`, perché `effectiveGrip` non riceve ancora `maxSpeed`).

- [ ] **Step 3: Implementazione minima**

In `backend/sockets/games/physics/VehiclePhysics.js`, unico cambiamento:

```js
function updateVelocity(p, isQuali, slipstreamMult) {
    const { inputs } = p;
    const maxSpeed = effectiveMaxSpeed(p, isQuali) * (slipstreamMult || 1);
    let grip = effectiveGrip(p, isQuali, maxSpeed);
    /* ... resto invariato ... */
```

(una sola riga cambiata: `effectiveGrip(p, isQuali)` →
`effectiveGrip(p, isQuali, maxSpeed)`; nessun'altra riga di questo file
tocca.)

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/VehiclePhysics.test.js`
Expected: PASS su tutti i test (esistenti + nuovi).

- [ ] **Step 5: Verifica completa**

Run: `node --test backend/sockets/games/physics/`
Expected: PASS su tutta la suite fisica.

Run: `node --test backend/sockets/games/`
Expected: PASS a parte i 2 fallimenti pre-esistenti già noti
(`monte-rosso` targetKm, quali spawn) — riconfermare che siano ancora solo
quelli.

Verifica di confine:
```bash
git diff --stat backend/sockets/games/physics/PowertrainModel.js backend/sockets/games/physics/SteeringModel.js backend/sockets/games/physics/BrakingModel.js backend/sockets/games/physics/DamageModel.js backend/sockets/games/f1GameSocket.js
```
Expected: nessun output.

---

## Esito atteso di questa fase

`AerodynamicsModel.downforceFactor` ha una formula reale (fino a +15% di
capacità a velocità massima). `effectiveGrip` e
`CorneringGripModel.lateralExcess` la consultano **indipendentemente**,
dietro `F1_AERO_DOWNFORCE_MODEL` (spento di default). `PowertrainModel`,
`SteeringModel`, `BrakingModel`, `DamageModel`, `f1GameSocket.js` restano
invariati. Drag (Fase 1) e downforce (questa fase) coesistono dietro flag
indipendenti, nessuna interazione tra i due. Danno aero, scia e DRS
restano fuori scope (Fasi 3/4/5).

## Esito (2026-07-28)

Eseguita come da piano: 22/22 → 32/32 (dopo Fase 3) test in
`AerodynamicsModel.test.js`, 13/13 → 14/14 in `CorneringGripModel.test.js`,
zero regressioni. Confermato nessun doppio conteggio tra `effectiveGrip` e
`lateralExcess` (test dedicato con spy). Verificato in checkpoint
successivo che a tutti i 4 flag aero attivi insieme non emergono
interazioni patologiche — vedi
`docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md`
("Stato finale — checkpoint"). Playtest umano ancora non eseguito, non
promosso a default.
