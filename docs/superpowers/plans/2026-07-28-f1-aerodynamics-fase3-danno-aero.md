# F1 — Fase 3: danno aerodinamico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** aggiungere penalità aero da danno riusando `frontWing`/`floor` già
esistenti in `DamageModel` — nessun quinto componente. `frontWing` rotta →
più drag (consultato da `dragFactor`); `floor` rotto → meno downforce
(consultato da `downforceFactor`). Dietro flag dedicato
`F1_AERO_DAMAGE_MODEL`.

**Scoperte in ricognizione (vedi messaggio in conversazione):** i getter
esistenti di `DamageModel` sono puri e non conoscono `isQuali` — è il
chiamante a decidere se applicarli. Stesso schema qui: il termine danno
dentro `dragFactor`/`downforceFactor` si applica solo se `!isQuali`.
Rischio di doppio conteggio identificato: il danno al fondo già riduce
`effectiveGrip` via `getFloorGripPenalty` (meccanico, sempre attivo);
`getFloorDownforcePenalty` (aero, nuovo) è un contributo INDIPENDENTE,
verificato con test dedicato.

**Architecture:** `DamageModel.js` resta l'unico proprietario dello stato
e delle formule di penalità (2 nuovi getter, stesso pattern dei 4
esistenti). `AerodynamicsModel.js` li consulta esattamente come consulta
già `getFloorGripPenalty` — nessuna logica di danno si sposta lì.
`PowertrainModel.js`/`effectiveGrip`/`CorneringGripModel.js` estendono di
un solo argomento (`damageParts`) le chiamate già esistenti a
`dragFactor`/`downforceFactor` — nessuna nuova logica propria.
`SteeringModel.js` non cambia (il suo consumo di
`getFrontWingSteerPenalty` resta separato e non correlato).

**Tech Stack:** Node.js, `node:test`/`node:assert/strict`.

## Global Constraints

- **Italiano** in commenti/comunicazioni (da CLAUDE.md di progetto).
- **Niente commit automatici**: l'utente fa commit/push manualmente.
- **Flag di confronto dedicato** `F1_AERO_DAMAGE_MODEL`, spento di default
  — comportamento bit-per-bit identico a oggi a flag spento.
- **Non toccare**: `SteeringModel.js` (il danno ala che riduce lo sterzo
  resta separato, invariato), `BrakingModel.js`, `f1GameSocket.js`,
  `VehicleMotionModel.js`, `CollisionResolver.js`. `PowertrainModel.js`
  riceve **solo** l'estensione della chiamata già esistente a
  `dragFactor` (un argomento in più), nessun'altra modifica.
- **Nessun quinto componente `damageParts`**: solo nuovi getter in
  `DamageModel.js`, `createDamageParts()` resta a 4 campi.
- Riferimento: `docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md`.

---

### Task 1: `DamageModel.js` — due nuovi getter aero

**Files:**
- Modify: `backend/sockets/games/physics/DamageModel.js`
- Test: Modify `backend/sockets/games/physics/DamageModel.test.js`

**Interfaces:**
- Produces: `getFrontWingDragPenalty(parts) -> number` (0..
  `FRONT_WING_DRAG_PENALTY_MAX`), `getFloorDownforcePenalty(parts) ->
  number` (0..`FLOOR_DOWNFORCE_PENALTY_MAX`). Consumati da Task 2
  (`AerodynamicsModel.js`).

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in fondo a `DamageModel.test.js` (verificare prima il nome
esatto del file/require esistente):

```js
const { getFrontWingDragPenalty, getFloorDownforcePenalty, FRONT_WING_DRAG_PENALTY_MAX, FLOOR_DOWNFORCE_PENALTY_MAX, createDamageParts } = require('./DamageModel');

test('getFrontWingDragPenalty: danno zero -> 0', () => {
    assert.equal(getFrontWingDragPenalty(createDamageParts()), 0);
    assert.equal(getFrontWingDragPenalty(undefined), 0);
});

test('getFrontWingDragPenalty: ala distrutta (100%) -> penalità massima', () => {
    assert.ok(Math.abs(getFrontWingDragPenalty({ frontWing: 100 }) - FRONT_WING_DRAG_PENALTY_MAX) < 1e-9);
});

test('getFrontWingDragPenalty: lineare nel danno (50% -> metà penalità massima)', () => {
    assert.ok(Math.abs(getFrontWingDragPenalty({ frontWing: 50 }) - FRONT_WING_DRAG_PENALTY_MAX / 2) < 1e-9);
});

test('getFrontWingDragPenalty: ignora floor/engine/suspension (isolato al proprio componente)', () => {
    assert.equal(getFrontWingDragPenalty({ frontWing: 0, floor: 100, engine: 100, suspension: 100 }), 0);
});

test('getFloorDownforcePenalty: danno zero -> 0', () => {
    assert.equal(getFloorDownforcePenalty(createDamageParts()), 0);
    assert.equal(getFloorDownforcePenalty(undefined), 0);
});

test('getFloorDownforcePenalty: fondo distrutto (100%) -> penalità massima', () => {
    assert.ok(Math.abs(getFloorDownforcePenalty({ floor: 100 }) - FLOOR_DOWNFORCE_PENALTY_MAX) < 1e-9);
});

test('getFloorDownforcePenalty: ignora frontWing/engine/suspension (isolato al proprio componente)', () => {
    assert.equal(getFloorDownforcePenalty({ floor: 0, frontWing: 100, engine: 100, suspension: 100 }), 0);
});

test('getFloorDownforcePenalty è indipendente da getFloorGripPenalty (costanti diverse, nessuna derivazione incrociata)', () => {
    const { getFloorGripPenalty, DAMAGE_GRIP_PENALTY_MAX } = require('./DamageModel');
    assert.notEqual(FLOOR_DOWNFORCE_PENALTY_MAX, DAMAGE_GRIP_PENALTY_MAX);
    assert.notEqual(getFloorDownforcePenalty({ floor: 50 }), getFloorGripPenalty({ floor: 50 }));
});

test('createDamageParts: resta a 4 componenti, nessun quinto campo aero introdotto', () => {
    const parts = createDamageParts();
    assert.deepEqual(Object.keys(parts).sort(), ['engine', 'floor', 'frontWing', 'suspension']);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/DamageModel.test.js`
Expected: FAIL sui nuovi test `getFrontWingDragPenalty`/
`getFloorDownforcePenalty` (non definiti), PASS sull'ultimo (`createDamageParts`
è già a 4 campi oggi).

- [ ] **Step 3: Implementazione minima**

In `DamageModel.js`, aggiungere vicino agli altri getter (dopo
`FRONT_WING_STEER_PENALTY_MAX`):

```js
// Fase 3 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// penalità aero da danno — RIUSANO frontWing/floor esistenti, nessun
// quinto componente. Stesso pattern lineare 0-100% dei getter sopra.
// Consultate da AerodynamicsModel.js (dragFactor/downforceFactor), MAI da
// SteeringModel.js (che continua a usare solo getFrontWingSteerPenalty,
// fenomeno meccanico separato).
const FRONT_WING_DRAG_PENALTY_MAX = 0.10; // fino a +10% di drag (ala anteriore rotta disturba il flusso d'aria)
const FLOOR_DOWNFORCE_PENALTY_MAX = 0.10; // fino a -10% di deportanza (fondo rotto perde carico aerodinamico)

function getFrontWingDragPenalty(parts) {
    return ((parts?.frontWing || 0) / 100) * FRONT_WING_DRAG_PENALTY_MAX;
}

function getFloorDownforcePenalty(parts) {
    return ((parts?.floor || 0) / 100) * FLOOR_DOWNFORCE_PENALTY_MAX;
}
```

Aggiungere a `module.exports`:
```js
    FRONT_WING_DRAG_PENALTY_MAX, FLOOR_DOWNFORCE_PENALTY_MAX,
    getFrontWingDragPenalty, getFloorDownforcePenalty,
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/DamageModel.test.js`
Expected: PASS su tutti i test.

- [ ] **Step 5: Verifica**

Run: `node --test backend/sockets/games/physics/`
Expected: PASS (nessun consumer ancora collegato, Task 2 lo fa).

---

### Task 2: `AerodynamicsModel.js` — consultazione dietro flag dedicato

**Files:**
- Modify: `backend/sockets/games/physics/AerodynamicsModel.js`
- Test: Modify `backend/sockets/games/physics/AerodynamicsModel.test.js`

**Interfaces:**
- Consumes: `DamageModel.getFrontWingDragPenalty`/`getFloorDownforcePenalty`
  (Task 1).
- Produces: `dragFactor(speedFrac, isQuali, damageParts)`,
  `downforceFactor(speedFrac, isQuali, damageParts)` — terzo parametro
  OPZIONALE, `isAeroDamageModelActive() -> boolean`. Firme retrocompatibili:
  chiamate a 2 argomenti (test Fase 0/1/2 esistenti) restano valide,
  `damageParts` assente → nessuna penalità danno (stesso fallback
  `parts?.x || 0` di `DamageModel`).

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiornare il require in cima ad `AerodynamicsModel.test.js` aggiungendo
`isAeroDamageModelActive`. Aggiungere in fondo al file:

```js
test('isAeroDamageModelActive: di default (env var non impostata) è false', () => {
    assert.equal(process.env.F1_AERO_DAMAGE_MODEL, undefined);
    assert.equal(isAeroDamageModelActive(), false);
});

test('dragFactor: F1_AERO_DAMAGE_MODEL non impostato -> comportamento identico a prima anche passando damageParts', () => {
    assert.equal(dragFactor(1, false), dragFactor(1, false, { frontWing: 100, floor: 0, engine: 0, suspension: 0 }));
});

test('dragFactor: F1_AERO_DAMAGE_MODEL="1", danno zero -> nessuna penalità aggiuntiva', () => {
    process.env.F1_AERO_DAMAGE_MODEL = '1';
    try {
        assert.ok(Math.abs(dragFactor(1, false, { frontWing: 0, floor: 0, engine: 0, suspension: 0 }) - dragFactor(1, false)) < 1e-9);
    } finally {
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});

test('dragFactor: F1_AERO_DAMAGE_MODEL="1", ala anteriore distrutta -> drag aumentato in modo misurabile (fattore ridotto)', () => {
    process.env.F1_AERO_DAMAGE_MODEL = '1';
    try {
        const healthy = dragFactor(1, false, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
        const damaged = dragFactor(1, false, { frontWing: 100, floor: 0, engine: 0, suspension: 0 });
        assert.ok(damaged < healthy, `atteso più drag (fattore minore) con ala rotta: sana=${healthy}, danneggiata=${damaged}`);
    } finally {
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});

test('dragFactor: F1_AERO_DAMAGE_MODEL="1", isQuali=true -> danno ignorato (stessa esenzione di ogni altra penalità danno)', () => {
    process.env.F1_AERO_DAMAGE_MODEL = '1';
    try {
        const healthy = dragFactor(1, true, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
        const damaged = dragFactor(1, true, { frontWing: 100, floor: 0, engine: 0, suspension: 0 });
        assert.equal(healthy, damaged, 'in qualifica il danno non deve avere effetto');
    } finally {
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});

test('dragFactor: floor danneggiato NON influenza il drag (isolamento per componente)', () => {
    process.env.F1_AERO_DAMAGE_MODEL = '1';
    try {
        const healthy = dragFactor(1, false, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
        const floorDamaged = dragFactor(1, false, { frontWing: 0, floor: 100, engine: 0, suspension: 0 });
        assert.equal(healthy, floorDamaged, 'floor non deve influenzare dragFactor, solo frontWing');
    } finally {
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});

test('downforceFactor: F1_AERO_DAMAGE_MODEL non impostato -> comportamento identico a prima anche passando damageParts', () => {
    assert.equal(downforceFactor(1, false), downforceFactor(1, false, { frontWing: 0, floor: 100, engine: 0, suspension: 0 }));
});

test('downforceFactor: F1_AERO_DAMAGE_MODEL="1", fondo distrutto -> downforce ridotto in modo misurabile', () => {
    process.env.F1_AERO_DAMAGE_MODEL = '1';
    try {
        const healthy = downforceFactor(1, false, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
        const damaged = downforceFactor(1, false, { frontWing: 0, floor: 100, engine: 0, suspension: 0 });
        assert.ok(damaged < healthy, `atteso downforce ridotto con fondo rotto: sano=${healthy}, danneggiato=${damaged}`);
    } finally {
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});

test('downforceFactor: frontWing danneggiata NON influenza il downforce (isolamento per componente)', () => {
    process.env.F1_AERO_DAMAGE_MODEL = '1';
    try {
        const healthy = downforceFactor(1, false, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
        const wingDamaged = downforceFactor(1, false, { frontWing: 100, floor: 0, engine: 0, suspension: 0 });
        assert.equal(healthy, wingDamaged, 'frontWing non deve influenzare downforceFactor, solo floor');
    } finally {
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});

test('nessun doppio conteggio: getFloorGripPenalty (meccanico, dentro effectiveGrip) e getFloorDownforcePenalty (aero, dentro downforceFactor) sono penalità indipendenti applicate una sola volta ciascuna', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 50, engine: 0, suspension: 0 }, speed: 6.2 };
    process.env.F1_AERO_DOWNFORCE_MODEL = '1';
    const gripMechanicalOnly = effectiveGrip(p, false, 6.2); // solo penalità meccanica floorFactor, downforceFactor senza danno
    process.env.F1_AERO_DAMAGE_MODEL = '1';
    try {
        const gripWithAeroDamage = effectiveGrip(p, false, 6.2);
        const expected = gripMechanicalOnly * downforceFactor(1, false, p.damageParts);
        assert.ok(Math.abs(gripWithAeroDamage - expected) < 1e-9, 'la penalità aero deve moltiplicarsi UNA VOLTA sopra al valore già corretto dalla penalità meccanica, non sostituirla né duplicarla');
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/AerodynamicsModel.test.js`
Expected: FAIL sui test che passano `damageParts` con danno reale/flag
acceso (nessun effetto ancora); PASS sui test "non impostato"/"danno zero"
(già veri per costruzione, dato che oggi il terzo argomento è ignorato).

- [ ] **Step 3: Implementazione minima**

In `AerodynamicsModel.js`, aggiungere l'import:

```js
const { getFloorGripPenalty, getFrontWingDragPenalty, getFloorDownforcePenalty } = require('./DamageModel');
```

Modificare `dragFactor`:

```js
function dragFactor(speedFrac, isQuali, damageParts) {
    const frac = Math.max(0, Math.min(1, speedFrac));
    let factor = 1 - Math.pow(frac, DRAG_EXPONENT) * DRAG_TOP_SPEED_PENALTY_MAX;
    // Fase 3: danno ala anteriore -> più drag. Esenzione qualifica come
    // ogni altra penalità danno (vedi DamageModel.js).
    if (isAeroDamageModelActive() && !isQuali) {
        factor *= 1 - getFrontWingDragPenalty(damageParts);
    }
    return factor;
}
```

Modificare `downforceFactor`:

```js
function downforceFactor(speedFrac, isQuali, damageParts) {
    const frac = Math.max(0, Math.min(1, speedFrac));
    let factor = 1 + Math.pow(frac, DOWNFORCE_EXPONENT) * DOWNFORCE_CAPACITY_BONUS_MAX;
    // Fase 3: danno al fondo -> meno downforce. Esenzione qualifica come
    // ogni altra penalità danno.
    if (isAeroDamageModelActive() && !isQuali) {
        factor *= 1 - getFloorDownforcePenalty(damageParts);
    }
    return factor;
}
```

Aggiungere il flag:

```js
// Flag di confronto Fase 3, dedicato e separato da F1_AERO_DRAG_MODEL/
// F1_AERO_DOWNFORCE_MODEL — spento di default, comportamento bit-per-bit
// identico a oggi. Ha effetto solo se ANCHE il flag della fase
// corrispondente (drag/downforce) è attivo, conseguenza naturale della
// fasatura: dragFactor/downforceFactor stessi non vengono consultati
// altrimenti.
function isAeroDamageModelActive() {
    return process.env.F1_AERO_DAMAGE_MODEL === '1';
}
```

Aggiornare le chiamate interne a `downforceFactor` dentro `effectiveGrip`
per passare `p.damageParts`:

```js
    if (isAeroDownforceModelActive()) {
        const speedFrac = maxSpeed ? Math.min(1, Math.abs(p.speed || 0) / maxSpeed) : 0;
        grip *= downforceFactor(speedFrac, isQuali, p.damageParts);
    }
```

Aggiornare `module.exports` aggiungendo `isAeroDamageModelActive`.

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/AerodynamicsModel.test.js`
Expected: PASS su tutti i test.

- [ ] **Step 5: Verifica**

Run: `node --test backend/sockets/games/physics/`
Expected: PASS (Task 3 collega ancora `PowertrainModel`/
`CorneringGripModel` per passare `damageParts`, ma le chiamate a 2/3
argomenti già esistenti restano sicure).

---

### Task 3: `PowertrainModel.js`/`CorneringGripModel.js` — passare `damageParts`

**Files:**
- Modify: `backend/sockets/games/physics/PowertrainModel.js` (solo
  l'estensione della chiamata a `dragFactor` già esistente)
- Modify: `backend/sockets/games/physics/CorneringGripModel.js` (solo
  l'estensione della chiamata a `downforceFactor` già esistente)
- Test: Modify i rispettivi `.test.js`

**Interfaces:**
- Nessuna nuova funzione pubblica — `effectiveMaxSpeed`/`lateralExcess`
  (già esportate) cambiano comportamento solo a flag acceso.

- [ ] **Step 1: Scrivere i test che falliscono**

In `PowertrainModel.test.js`, aggiungere:

```js
test('effectiveMaxSpeed: F1_AERO_DRAG_MODEL + F1_AERO_DAMAGE_MODEL="1", ala anteriore distrutta -> tetto di velocità ridotto ulteriormente rispetto al solo drag da velocità', () => {
    const p = { speed: 6.2, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 100, floor: 0, engine: 0, suspension: 0 } };
    process.env.F1_AERO_DRAG_MODEL = '1';
    try {
        const withoutDamageModel = effectiveMaxSpeed(p, false);
        process.env.F1_AERO_DAMAGE_MODEL = '1';
        try {
            const withDamageModel = effectiveMaxSpeed(p, false);
            assert.ok(withDamageModel < withoutDamageModel, `atteso tetto ulteriormente ridotto: senza=${withoutDamageModel}, con=${withDamageModel}`);
        } finally {
            delete process.env.F1_AERO_DAMAGE_MODEL;
        }
    } finally {
        delete process.env.F1_AERO_DRAG_MODEL;
    }
});
```

In `CorneringGripModel.test.js`, aggiungere:

```js
test('lateralExcess: F1_AERO_DOWNFORCE_MODEL + F1_AERO_DAMAGE_MODEL="1", fondo distrutto -> eccesso maggiore rispetto al solo downforce da velocità (meno capacità disponibile)', () => {
    const p = makePlayer(1, 6.2, 0);
    p.damageParts = { frontWing: 0, floor: 100, engine: 0, suspension: 0 };
    process.env.F1_AERO_DOWNFORCE_MODEL = '1';
    try {
        const withoutDamageModel = lateralExcess(p, false, 6.2);
        process.env.F1_AERO_DAMAGE_MODEL = '1';
        try {
            const withDamageModel = lateralExcess(p, false, 6.2);
            assert.ok(withDamageModel > withoutDamageModel, `atteso più eccesso con fondo rotto: senza=${withoutDamageModel}, con=${withDamageModel}`);
        } finally {
            delete process.env.F1_AERO_DAMAGE_MODEL;
        }
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
    }
});
```

(nota: `lateralExcess` legge `p.damageParts`? Verificare in Step 3 — oggi
NON lo fa, va aggiunto il passaggio.)

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/PowertrainModel.test.js backend/sockets/games/physics/CorneringGripModel.test.js`
Expected: FAIL su entrambi i nuovi test (nessuno dei due file passa ancora
`damageParts`).

- [ ] **Step 3: Implementazione minima**

In `PowertrainModel.js`, unica riga cambiata dentro `effectiveMaxSpeed`:

```js
        maxSpeed *= AerodynamicsModel.dragFactor(speedFrac, isQuali, p.damageParts);
```

In `CorneringGripModel.js`, unica riga cambiata dentro `lateralExcess`:

```js
        capacity *= AerodynamicsModel.downforceFactor(speedFrac, isQuali, p.damageParts);
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/PowertrainModel.test.js backend/sockets/games/physics/CorneringGripModel.test.js`
Expected: PASS su tutti i test.

- [ ] **Step 5: Verifica completa**

Run: `node --test backend/sockets/games/physics/`
Expected: PASS su tutta la suite fisica.

Run: `node --test backend/sockets/games/`
Expected: PASS a parte i 2 fallimenti pre-esistenti già noti
(`monte-rosso` targetKm, quali spawn).

Verifica di confine:
```bash
git diff --stat backend/sockets/games/physics/SteeringModel.js backend/sockets/games/physics/BrakingModel.js backend/sockets/games/f1GameSocket.js backend/sockets/games/physics/VehicleMotionModel.js backend/sockets/games/physics/CollisionResolver.js
```
Expected: nessun output.

```bash
node -e "const {createDamageParts} = require('./backend/sockets/games/physics/DamageModel'); console.log(Object.keys(createDamageParts()))"
```
Expected: `[ 'frontWing', 'floor', 'engine', 'suspension' ]` — 4 componenti,
nessun quinto.

---

## Esito atteso di questa fase

`DamageModel` guadagna 2 getter aero (`getFrontWingDragPenalty`,
`getFloorDownforcePenalty`), nessun quinto componente. `AerodynamicsModel`
li consulta internamente in `dragFactor`/`downforceFactor` dietro
`F1_AERO_DAMAGE_MODEL` (spento di default, ha effetto solo se anche i flag
Fase 1/2 sono attivi). `PowertrainModel`/`CorneringGripModel` estendono di
un argomento le chiamate già esistenti. `SteeringModel` invariato. Scia e
DRS restano fuori scope (Fasi 4/5).

## Esito (2026-07-28)

Eseguita come da piano: 13/13 test in `DamageModel.test.js`, 32/32 in
`AerodynamicsModel.test.js`. Un bug di test (non di implementazione)
trovato e corretto durante l'esecuzione: il test "nessun doppio conteggio"
moltiplicava per errore due volte il contributo downforce — corretto
isolando la base meccanica pura prima del confronto. **Effetto collaterale
noto** (checkpoint successivo): con `F1_AERO_DRAG_MODEL` +
`F1_AERO_DAMAGE_MODEL` attivi, il danno all'ala anteriore ora influenza
anche il tetto di velocità (non solo lo sterzo) — invalida l'assunzione
del test storico "isolamento dei componenti" quando quei flag sono attivi;
comportamento intenzionale di questa fase, non corretto perché di default
i flag sono spenti. Vedi
`docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md`
("Stato finale — checkpoint") per il dettaglio.
