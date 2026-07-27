# F1 — VehicleDynamics: facade + estrazione Powertrain/Braking/Steering/Aerodynamics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introdurre una facade `VehicleDynamics` come nuovo punto di ingresso per la simulazione vettura per-tick, poi scomporre `VehiclePhysics.updateVelocity` (oggi un unico blocco che mescola motore/freno/sterzo/aerodinamica) nei 4 sotto-modelli dedicati previsti dall'architettura target (`PowertrainModel`, `BrakingModel`, `SteeringModel`, `AerodynamicsModel`) — **senza cambiare una sola formula, valore o ordine di operazioni**.

**Architecture:** Continuazione diretta di `docs/superpowers/plans/2026-07-26-f1-physics-modularizzazione.md` (che ha già estratto `TyreModel.js`/`DamageModel.js`/`VehiclePhysics.js`/`CollisionResolver.js` da `f1GameSocket.js`). Questo piano NON tocca quei 4 file come unità — `TyreModel.js`, `DamageModel.js` e `CollisionResolver.js` restano **completamente invariati**; `VehiclePhysics.js` viene invece svuotato progressivamente, task dopo task, fino a diventare un puro orchestratore che chiama in sequenza i 4 nuovi sotto-moduli. Una facade `VehicleDynamics.js`, creata per prima, diventa il nuovo punto da cui `f1GameSocket.js::tickGame` invoca la simulazione — da quel momento in poi, ogni estrazione successiva dentro `VehiclePhysics.js` è invisibile a `f1GameSocket.js` (che non viene più toccato).

**Tech Stack:** Node.js, CommonJS (`require`/`module.exports`), `node:test` (stesso runner già in uso), nessuna nuova dipendenza.

## Global Constraints

- **Zero variazione fisica**: nessuna formula, costante, soglia o ordine di operazioni cambia valore. Refactor di collocazione codice, non di comportamento.
- **`TyreModel.js`, `DamageModel.js`, `CollisionResolver.js` restano invariati** (già modularizzati dal piano precedente) — nessun task di questo piano li modifica. Vengono solo `require`-ati dai nuovi moduli.
- **`PowertrainModel` è un'estrazione 1:1** della logica motore/coast-down già esistente in `VehiclePhysics.js` — nessun nuovo modello motore, nessuna formula aggiuntiva.
- **`module.exports` di `VehiclePhysics.js` resta identico nella forma** per tutta la durata del piano (stesse chiavi: `MAX_SPEED, ACCEL, FRICTION, TURN_SPEED_LOW, TURN_SPEED_HIGH, GRIP, BRAKE_MULT, effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult, updateVelocity, integratePosition, applyOffTrackDrag`) — i consumer esterni (`f1GameSocket.js`, `f1Bot.js` via `deps`, `f1LapSimulator.js`, `f1RaceLineOptimizer.js`, `module.exports.physics`) continuano a funzionare senza modifiche.
- **`f1GameSocket.js` viene toccato SOLO nel Task 1** (per instradare il tick loop attraverso la nuova facade `VehicleDynamics`). Tutti i task successivi (estrazioni interne a `VehiclePhysics.js`) non lo toccano più.
- **Networking/multiplayer/pit-stop/lap-tracking invariati**: `updateTrackIndex`, `checkLap`, `progressScore`, tutta la logica pit-stop restano dove sono — fuori scope.
- **Client invariato**: `frontend/f1.js` non viene toccato (non duplica formule, invia solo `f1Input` e interpola `f1StateUpdate`).
- **Niente commit/push automatico**: per convenzione di progetto lo fa l'utente (vedi `CLAUDE.md`). Ogni task termina con la verifica, non con un commit.
- **Baseline di non-regressione, catturata nel worktree di esecuzione di questo piano il 2026-07-27 (da riprodurre identica dopo ogni task).** Nota: il worktree parte dall'ultimo commit locale (`43bb546`), SENZA le modifiche non committate presenti nella working copy principale (altre feature in corso su `f1Bot.js`/`trackLoader.js`/tracciati — fuori scope, non toccate da questo piano) — la baseline qui sotto è quella osservata DENTRO il worktree, non quella della working copy principale.
  - `node --test backend/sockets/games/physics backend/sockets/games/trackLoader.test.js backend/sockets/games/f1GameSocket.exports.test.js backend/sockets/games/f1Testbench.test.js backend/sockets/games/f1Bot.test.js backend/sockets/games/f1GameSocket.physics.test.js backend/tools/f1LapSimulator.test.js` → **115 pass, 5 fail** (tutti pre-esistenti e scollegati da questo refactor — nessuno tocca `updateVelocity`/danno/gomme:
    - `f1Testbench.test.js`: *"createTestbenchSession: crea esattamente botCount bot..."*, *"...il game risultante funziona con la vera tickGame..."*, *"f1tbStart valido avvia il timer..."* — dipendono da modifiche a `f1Bot.js` non ancora committate (fuori scope).
    - `trackLoader.test.js:33` — *"qualiSpawn e gridSpawnPoint(0)/(1)..."*, geometria pista.
    - `f1LapSimulator.test.js` — *"test-scratch-track completa il giro..."*, fixture di pista mancante (`ENOENT`).
    Il conteggio e la causa dei 5 fail non devono cambiare.)
  - `node backend/tools/f1LapSimulator.js --all-tracks` →
    ```
    Pista            Tempo(ms)  Finito  Curva peggiore
    interlagos       37700      si      0.3% giro @ 10.2km/h
    monte-rosso      18200      si      0.9% giro @ 10.2km/h
    monza            21350      si      0.4% giro @ 10.2km/h
    nuova-pista      49500      si      0.2% giro @ 10.2km/h
    prova            49750      si      0.2% giro @ 10.2km/h
    test-bot         37550      si      0.4% giro @ 10.2km/h
    ```
    (`spa`/`new-monza` non compaiono: i relativi `.json` non sono ancora committati, quindi non esistono nel worktree — non è una regressione di questo piano.) Ogni riga deve restare **identica carattere per carattere** dopo ogni task.

## File Structure

```
backend/sockets/games/physics/
├── TyreModel.js          — INVARIATO
├── DamageModel.js        — INVARIATO
├── CollisionResolver.js  — INVARIATO
├── VehicleDynamics.js    — NUOVO (Task 1): facade, punto di ingresso per f1GameSocket.js::tickGame
├── VehicleMotionModel.js — NUOVO (Task 3): integratePosition, applyOffTrackDrag
├── SteeringModel.js      — NUOVO (Task 4): applySteering (sterzo dipendente da velocità + danno ala/sospensioni)
├── BrakingModel.js       — NUOVO (Task 5): applyBrake, effectiveBrakeMult
├── PowertrainModel.js    — NUOVO (Task 6): applyThrottle, applyCoast, effectiveMaxSpeed, effectiveAccel
├── AerodynamicsModel.js  — NUOVO (Task 7): applyGripBlend, effectiveGrip
└── VehiclePhysics.js     — SVUOTATO PROGRESSIVAMENTE: da "tutta la fisica velocità" a puro orchestratore che chiama i 5 moduli sopra, mantenendo il suo module.exports storico invariato
```

Ordine di estrazione (rispetta le dipendenze — ogni nuovo modulo dipende solo da `TyreModel`/`DamageModel`, mai da un altro nuovo modulo): **facade → test di caratterizzazione → VehicleMotionModel → SteeringModel → BrakingModel → PowertrainModel → AerodynamicsModel**.

---

## Task 1: Facade `VehicleDynamics.js`

**Files:**
- Create: `backend/sockets/games/physics/VehicleDynamics.js`
- Test: `backend/sockets/games/physics/VehicleDynamics.test.js`
- Modify: `backend/sockets/games/f1GameSocket.js` (righe 6-32: blocco require in testa al file)

**Interfaces:**
- Produces: `VehicleDynamics.{COLLISION_SUBSTEPS, updateVelocity, integratePosition, applyOffTrackDrag, applyBridgeBarrier, resolveCollisions, applyTyreWear}` — re-export puro (stesso riferimento di funzione) di quanto già esportato da `TyreModel`/`VehiclePhysics`/`CollisionResolver`. Nessuna logica nuova.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
// backend/sockets/games/physics/VehicleDynamics.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const VehicleDynamics = require('./VehicleDynamics');
const TyreModel = require('./TyreModel');
const VehiclePhysics = require('./VehiclePhysics');
const CollisionResolver = require('./CollisionResolver');

test('VehicleDynamics: updateVelocity/integratePosition/applyOffTrackDrag sono lo STESSO riferimento esportato da VehiclePhysics', () => {
    assert.equal(VehicleDynamics.updateVelocity, VehiclePhysics.updateVelocity);
    assert.equal(VehicleDynamics.integratePosition, VehiclePhysics.integratePosition);
    assert.equal(VehicleDynamics.applyOffTrackDrag, VehiclePhysics.applyOffTrackDrag);
});

test('VehicleDynamics: applyBridgeBarrier/resolveCollisions/COLLISION_SUBSTEPS sono lo STESSO riferimento esportato da CollisionResolver', () => {
    assert.equal(VehicleDynamics.applyBridgeBarrier, CollisionResolver.applyBridgeBarrier);
    assert.equal(VehicleDynamics.resolveCollisions, CollisionResolver.resolveCollisions);
    assert.equal(VehicleDynamics.COLLISION_SUBSTEPS, CollisionResolver.COLLISION_SUBSTEPS);
});

test('VehicleDynamics: applyTyreWear è lo STESSO riferimento esportato da TyreModel', () => {
    assert.equal(VehicleDynamics.applyTyreWear, TyreModel.applyTyreWear);
});

test('VehicleDynamics: updateVelocity funziona end-to-end attraverso la facade (fumo)', () => {
    const p = {
        x: 0, z: 0, angle: 0, speed: 0, vx: 0, vz: 0,
        compound: 'medium', tyreWear: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        inputs: { throttle: 1, brake: 0, steer: 0 }
    };
    VehicleDynamics.updateVelocity(p, false, 1);
    assert.equal(p.speed, 0.186);
});
```

- [ ] **Step 2: Eseguire il test, verificare che fallisca**

Run: `node --test backend/sockets/games/physics/VehicleDynamics.test.js`
Expected: FAIL con `Cannot find module './VehicleDynamics'`

- [ ] **Step 3: Creare `backend/sockets/games/physics/VehicleDynamics.js`**

```js
// backend/sockets/games/physics/VehicleDynamics.js
//
// Vehicle Dynamics: facade — unico punto da cui f1GameSocket.js::tickGame
// invoca la simulazione vettura per-tick. Per ora si limita a ri-esportare
// le funzioni già esistenti in TyreModel/VehiclePhysics/CollisionResolver
// (nessuna logica qui dentro): l'obiettivo di questo file è dare un seam
// stabile a tickGame, così che le estrazioni successive dentro
// VehiclePhysics.js (PowertrainModel/BrakingModel/SteeringModel/
// AerodynamicsModel/VehicleMotionModel — vedi
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md) non
// debbano più toccare f1GameSocket.js.
const { applyTyreWear } = require('./TyreModel');
const { updateVelocity, integratePosition, applyOffTrackDrag } = require('./VehiclePhysics');
const { COLLISION_SUBSTEPS, applyBridgeBarrier, resolveCollisions } = require('./CollisionResolver');

module.exports = {
    COLLISION_SUBSTEPS,
    updateVelocity, integratePosition, applyOffTrackDrag,
    applyBridgeBarrier, resolveCollisions,
    applyTyreWear
};
```

- [ ] **Step 4: Eseguire il test, verificare che passi**

Run: `node --test backend/sockets/games/physics/VehicleDynamics.test.js`
Expected: PASS (4/4)

- [ ] **Step 5: Instradare `f1GameSocket.js` attraverso la facade**

Sostituire il blocco di import (righe 6-32 originali):

```js
const TyreModel = require('./physics/TyreModel');
const {
    TYRE_COMPOUNDS, DEFAULT_COMPOUND, WEAR_LAPS_AT_MEDIUM,
    tyreOf, applyTyreWear, suggestStrategy
} = TyreModel;

const DamageModel = require('./physics/DamageModel');
const {
    DAMAGE_STEER_NOISE_MAX,
    MIN_COLLISION_SEVERITY, DAMAGE_CAP_PER_HIT, COLLISION_PENALTY_CAP_MS,
    applyDamageSteerNoise, collisionDamageAmount, applyCollisionPenalty,
    applyCarCollisionDamage, applyBarrierDamage,
    createDamageParts, FRONT_WING_STEER_PENALTY_MAX,
    getEnginePowerPenalty, getFloorGripPenalty, getFrontWingSteerPenalty, getSuspensionNoise
} = DamageModel;

const VehiclePhysics = require('./physics/VehiclePhysics');
const {
    ACCEL, BRAKE_MULT, TURN_SPEED_HIGH,
    effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult, updateVelocity, integratePosition, applyOffTrackDrag
} = VehiclePhysics;

const CollisionResolver = require('./physics/CollisionResolver');
const {
    COLLISION_SUBSTEPS, TRACK_INDEX_WINDOW,
    applyBridgeBarrier, resolveCollisions
} = CollisionResolver;
```

con:

```js
const TyreModel = require('./physics/TyreModel');
const {
    TYRE_COMPOUNDS, DEFAULT_COMPOUND, WEAR_LAPS_AT_MEDIUM,
    tyreOf, suggestStrategy
} = TyreModel;

const DamageModel = require('./physics/DamageModel');
const {
    DAMAGE_STEER_NOISE_MAX,
    MIN_COLLISION_SEVERITY, DAMAGE_CAP_PER_HIT, COLLISION_PENALTY_CAP_MS,
    applyDamageSteerNoise, collisionDamageAmount, applyCollisionPenalty,
    applyCarCollisionDamage, applyBarrierDamage,
    createDamageParts, FRONT_WING_STEER_PENALTY_MAX,
    getEnginePowerPenalty, getFloorGripPenalty, getFrontWingSteerPenalty, getSuspensionNoise
} = DamageModel;

const VehiclePhysics = require('./physics/VehiclePhysics');
const {
    ACCEL, BRAKE_MULT, TURN_SPEED_HIGH,
    effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult
} = VehiclePhysics;

const CollisionResolver = require('./physics/CollisionResolver');
const { TRACK_INDEX_WINDOW } = CollisionResolver;

// Facade: unico punto da cui il tick loop qui sotto invoca la simulazione
// vettura — vedi VehicleDynamics.js. Le altre costanti/funzioni sopra
// (TYRE_COMPOUNDS, DAMAGE_*, ACCEL, ecc.) restano importate direttamente dai
// moduli originali: servono altrove in questo file (buildPublicState,
// module.exports.physics, deps per f1Bot) e non fanno parte del tick loop.
const VehicleDynamics = require('./physics/VehicleDynamics');
const {
    COLLISION_SUBSTEPS,
    updateVelocity, integratePosition, applyOffTrackDrag,
    applyBridgeBarrier, resolveCollisions,
    applyTyreWear
} = VehicleDynamics;
```

Nessun'altra riga di `f1GameSocket.js` cambia: `tickGame`, `module.exports.physics`, `buildPublicState` ecc. continuano a usare gli stessi identificatori locali (`updateVelocity`, `integratePosition`, `resolveCollisions`, `applyBridgeBarrier`, `applyOffTrackDrag`, `applyTyreWear`, `COLLISION_SUBSTEPS`), solo la sorgente dell'import cambia.

- [ ] **Step 6: Eseguire l'intera suite di regressione**

Run: `node --test backend/sockets/games/physics backend/sockets/games/trackLoader.test.js backend/sockets/games/f1GameSocket.exports.test.js backend/sockets/games/f1Testbench.test.js backend/sockets/games/f1Bot.test.js backend/sockets/games/f1GameSocket.physics.test.js backend/tools/f1LapSimulator.test.js`
Expected: `119 pass, 5 fail` (115 + 4 nuovi test di VehicleDynamics; stessi 5 fail pre-esistenti della baseline, stessa causa)

- [ ] **Step 7: Confrontare la tabella `f1LapSimulator.js --all-tracks`**

Run: `node backend/tools/f1LapSimulator.js --all-tracks`
Expected: identica carattere per carattere alla baseline in Global Constraints.

- [ ] **Step 8: Verifica utente in localhost**

Avviare `node server.js` da `backend/`, aprire due tab, fare qualche giro (qualifica + gara, con un pit stop) — il tick loop ora passa dalla facade, è il momento più a rischio di errori di wiring (require sbagliato, nome mancante). Nessun cambiamento visibile atteso.

- [ ] **Step 9: Commit** (solo se l'utente lo richiede esplicitamente — vedi Global Constraints)

```bash
git add backend/sockets/games/physics/VehicleDynamics.js backend/sockets/games/physics/VehicleDynamics.test.js backend/sockets/games/f1GameSocket.js
git commit -m "F1: introduce facade VehicleDynamics come punto di ingresso del tick loop fisico"
```

---

## Task 2: Test di caratterizzazione end-to-end per `updateVelocity`

Rete di sicurezza dedicata prima di iniziare a scomporre `updateVelocity`: 4 scenari che combinano acceleratore/freno/coast, usura gomme, danno per componente, qualifica/scia — bloccati sui valori esatti prodotti dal codice **ancora monolitico**. Da qui fino a fine Task 7, questi stessi numeri devono restare identici bit per bit.

**Files:**
- Create: `backend/sockets/games/physics/VehiclePhysics.test.js`

**Interfaces:**
- Consumes: `VehiclePhysics.updateVelocity(p, isQuali, slipstreamMult)` (già esistente, invariata in questo task).

- [ ] **Step 1: Scrivere il test (già verde, cattura il comportamento attuale)**

```js
// backend/sockets/games/physics/VehiclePhysics.test.js
//
// Test di caratterizzazione end-to-end di updateVelocity: i valori attesi
// sono stati calcolati dal codice ancora monolitico (pre-estrazione Task
// 3-7, vedi docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md)
// e devono restare identici bit per bit dopo ogni estrazione — sono la rete
// di sicurezza primaria per questo refactor.
const test = require('node:test');
const assert = require('node:assert/strict');
const { updateVelocity } = require('./VehiclePhysics');

function run(p, isQuali, slip) {
    updateVelocity(p, isQuali, slip);
    return { speed: p.speed, vx: p.vx, vz: p.vz, angle: p.angle };
}

function assertClose(actual, expected, label) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: atteso ${expected}, ottenuto ${actual}`);
}

test('updateVelocity: acceleratore + sterzo, gomma fresca, nessun danno', () => {
    const p = {
        speed: 0, vx: 0, vz: 0, angle: 0, compound: 'medium', tyreWear: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        inputs: { throttle: 1, brake: 0, steer: 1 }
    };
    const r = run(p, false, 1);
    assertClose(r.speed, 0.186, 'speed');
    assertClose(r.vx, 0.0035765162453614803, 'vx');
    assertClose(r.vz, 0.04804105335592326, 'vz');
    assertClose(r.angle, 0.07431, 'angle');
});

test('updateVelocity: frenata, gomma usurata 80%, danni combinati (ala/fondo/motore)', () => {
    const p = {
        speed: 4, vx: 2, vz: 2, angle: 0.3, compound: 'medium', tyreWear: 80,
        damageParts: { frontWing: 20, floor: 30, engine: 40, suspension: 0 },
        inputs: { throttle: 0, brake: 1, steer: 0.5 }
    };
    const r = run(p, false, 1);
    assertClose(r.speed, 3.718432165375, 'speed');
    assertClose(r.vx, 1.5785306274602555, 'vx');
    assertClose(r.vz, 2.5998276056528784, 'vz');
    assertClose(r.angle, 0.3264038921007012, 'angle');
});

test('updateVelocity: coast (nessun input), moto residua, sterzo in coast', () => {
    const p = {
        speed: 2, vx: 1.5, vz: 0.5, angle: -0.2, compound: 'hard', tyreWear: 10,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        inputs: { throttle: 0, brake: 0, steer: -1 }
    };
    const r = run(p, false, 1);
    assertClose(r.speed, 1.88, 'speed');
    assertClose(r.vx, 0.8844276657843817, 'vx');
    assertClose(r.vz, 0.9047456657753135, 'vz');
    assertClose(r.angle, -0.26758146725046916, 'angle');
});

test('updateVelocity: qualifica ignora usura/danno, con boost scia', () => {
    const p = {
        speed: 1, vx: 1, vz: 0, angle: 0, compound: 'hard', tyreWear: 90,
        damageParts: { frontWing: 80, floor: 80, engine: 80, suspension: 0 },
        inputs: { throttle: 1, brake: 0, steer: 0.2 }
    };
    const r = run(p, true, 1.05);
    assertClose(r.speed, 1.186, 'speed');
    assertClose(r.vx, 0.7837054280299266, 'vx');
    assertClose(r.vz, 0.26089368754938286, 'vz');
    assertClose(r.angle, 0.014201872576987785, 'angle');
});
```

- [ ] **Step 2: Eseguire il test, verificare che passi già ora**

Run: `node --test backend/sockets/games/physics/VehiclePhysics.test.js`
Expected: PASS (4/4) — nessuna estrazione ancora avvenuta, è solo la cattura del comportamento attuale.

- [ ] **Step 3: Commit** (solo su richiesta utente)

```bash
git add backend/sockets/games/physics/VehiclePhysics.test.js
git commit -m "F1: test di caratterizzazione end-to-end per updateVelocity (rete di sicurezza pre-estrazione)"
```

---

## Task 3: Estrarre `VehicleMotionModel.js`

**Files:**
- Create: `backend/sockets/games/physics/VehicleMotionModel.js`
- Test: `backend/sockets/games/physics/VehicleMotionModel.test.js`
- Modify: `backend/sockets/games/physics/VehiclePhysics.js`

**Interfaces:**
- Produces: `VehicleMotionModel.integratePosition(p, dt)`, `VehicleMotionModel.applyOffTrackDrag(p, track)`.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
// backend/sockets/games/physics/VehicleMotionModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { integratePosition, applyOffTrackDrag } = require('./VehicleMotionModel');

test('integratePosition: integra x/z da vx/vz*dt', () => {
    const p = { x: 1, z: 2, vx: 3, vz: -4 };
    integratePosition(p, 1 / 13);
    assert.ok(Math.abs(p.x - 1.2307692307692308) < 1e-12);
    assert.ok(Math.abs(p.z - 1.6923076923076923) < 1e-12);
});

test('applyOffTrackDrag: entro roadHalf+2, nessun drag, ritorna false', () => {
    const track = { points: [{ x: 0, z: 0 }], roadHalf: 10 };
    const p = { x: 5, z: 0, speed: 5, vx: 5, vz: 0 };
    const offTrack = applyOffTrackDrag(p, track);
    assert.equal(offTrack, false);
    assert.equal(p.speed, 5);
});

test('applyOffTrackDrag: appena oltre il limite, drag proporzionale alla profondità', () => {
    const track = { points: [{ x: 0, z: 0 }], roadHalf: 10 };
    const p = { x: 14, z: 0, speed: 5, vx: 5, vz: 0 };   // dist=14, limite=12, k=0.25
    const offTrack = applyOffTrackDrag(p, track);
    assert.equal(offTrack, true);
    assert.ok(Math.abs(p.speed - 4.699999999999999) < 1e-9);
});

test('applyOffTrackDrag: molto oltre il limite, drag saturato al massimo (k=1)', () => {
    const track = { points: [{ x: 0, z: 0 }], roadHalf: 10 };
    const p = { x: 25, z: 0, speed: 5, vx: 5, vz: 0 };   // dist=25, ben oltre limite+8
    const offTrack = applyOffTrackDrag(p, track);
    assert.equal(offTrack, true);
    assert.ok(Math.abs(p.speed - 4.4) < 1e-9);
});
```

- [ ] **Step 2: Eseguire il test, verificare che fallisca**

Run: `node --test backend/sockets/games/physics/VehicleMotionModel.test.js`
Expected: FAIL con `Cannot find module './VehicleMotionModel'`

- [ ] **Step 3: Creare `backend/sockets/games/physics/VehicleMotionModel.js`**

```js
// backend/sockets/games/physics/VehicleMotionModel.js
//
// Vehicle Motion Model: integrazione della posizione da vx/vz + drag
// fuoripista. Estratto da VehiclePhysics.js — refactoring architetturale
// (Rif. docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const TrackGeometry = require('../../../../frontend/shared/trackGeometry.js');

function integratePosition(p, dt) {
    p.x += p.vx * dt;
    p.z += p.vz * dt;
}

// Fuoripista: distanza dal punto più vicino della pista caricata.
function nearestTrackDist(track, x, z) {
    return TrackGeometry.nearestPoint(track.points, x, z).dist;
}

// Ghiaia: rallentamento fuori pista. Ritorna se il giocatore è fuori pista in
// questo tick, riusato da TyreModel.applyTyreWear per il piccolo extra di usura.
function applyOffTrackDrag(p, track) {
    const dist = nearestTrackDist(track, p.x, p.z);
    const offTrack = dist > track.roadHalf + 2;
    if (offTrack) {
        const k = Math.min(1, (dist - track.roadHalf - 2) / 8);   // 0..1 in funzione della profondità
        const drag = 0.04 + k * 0.08;
        p.speed *= (1 - drag);
        p.vx   *= (1 - drag);
        p.vz   *= (1 - drag);
    }
    return offTrack;
}

module.exports = { integratePosition, applyOffTrackDrag };
```

- [ ] **Step 4: Eseguire il test, verificare che passi**

Run: `node --test backend/sockets/games/physics/VehicleMotionModel.test.js`
Expected: PASS (4/4)

- [ ] **Step 5: Riscrivere `backend/sockets/games/physics/VehiclePhysics.js`** (rimuove `TrackGeometry`, `nearestTrackDist`, `integratePosition`, `applyOffTrackDrag` dal corpo; li importa da `VehicleMotionModel`; tutto il resto invariato):

```js
// backend/sockets/games/physics/VehiclePhysics.js
//
// Vehicle Controller / Physics Model: velocità (accelerazione/freno/sterzo/
// grip). L'integrazione della posizione e il drag fuoripista sono ora in
// VehicleMotionModel.js — refactoring architetturale (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const { tyreOf, WEAR_SPEED_PENALTY, WEAR_GRIP_PENALTY, WEAR_BRAKE_PENALTY, WEAR_ACCEL_PENALTY, getWearPenaltyFactor } = require('./TyreModel');
const {
    getEnginePowerPenalty, getFloorGripPenalty, getFrontWingSteerPenalty, getSuspensionNoise
} = require('./DamageModel');
const { integratePosition, applyOffTrackDrag } = require('./VehicleMotionModel');

// Velocità realistica F1: fattore di scala R=1.55 (+55%) applicato a
// MAX_SPEED/ACCEL/FRICTION rispetto ai valori storici (4.0/0.12/0.050).
// Vedi docs/superpowers/specs/2026-07-21-f1-velocita-frenata-mescole-design.md.
const MAX_SPEED    = 6.2;
const ACCEL        = 0.186;
const FRICTION     = 0.120;
const TURN_SPEED_LOW  = 0.075;   // rad/tick a velocità quasi nulla
const TURN_SPEED_HIGH = 0.052;   // rad/tick alla velocità massima
const GRIP         = 0.78;
const BRAKE_MULT   = 2.17;   // moltiplicatore di ACCEL in frenata

function effectiveMaxSpeed(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_SPEED_PENALTY;
    const engineFactor = isQuali ? 1 : 1 - getEnginePowerPenalty(p.damageParts);
    return MAX_SPEED * tyreOf(p, isQuali).speedMult * wearFactor * engineFactor;
}

function effectiveGrip(p, isQuali) {
    const wearFactor  = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_GRIP_PENALTY;
    const floorFactor = isQuali ? 1 : 1 - getFloorGripPenalty(p.damageParts);
    return GRIP * tyreOf(p, isQuali).gripMult * wearFactor * floorFactor;
}

function effectiveAccel(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_ACCEL_PENALTY;
    const engineFactor = isQuali ? 1 : 1 - getEnginePowerPenalty(p.damageParts);
    return ACCEL * wearFactor * engineFactor;
}

function effectiveBrakeMult(p, isQuali) {
    const wearFactor = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_BRAKE_PENALTY;
    return BRAKE_MULT * wearFactor;
}

function updateVelocity(p, isQuali, slipstreamMult) {
    const { inputs } = p;
    const maxSpeed = effectiveMaxSpeed(p, isQuali) * (slipstreamMult || 1);
    const grip     = effectiveGrip(p, isQuali);

    if (inputs.throttle > 0) p.speed = Math.min(p.speed + effectiveAccel(p, isQuali) * inputs.throttle, maxSpeed);
    else if (inputs.brake > 0) {
        p.speed = Math.max(p.speed - effectiveAccel(p, isQuali) * effectiveBrakeMult(p, isQuali) * inputs.brake, -maxSpeed / 2);
        p.vx *= 0.94;
        p.vz *= 0.94;
    } else {
        if (p.speed > 0) p.speed = Math.max(p.speed - FRICTION, 0);
        if (p.speed < 0) p.speed = Math.min(p.speed + FRICTION, 0);
    }
    if (p.speed > maxSpeed) p.speed = maxSpeed;

    if (Math.abs(p.speed) > 0.01 || (p.vx * p.vx + p.vz * p.vz) > 0.0001) {
        const dir = p.speed >= 0 ? 1 : -1;
        const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
        const steerFactor = isQuali ? 1 : 1 - getFrontWingSteerPenalty(p.damageParts);
        const turnRate = (TURN_SPEED_LOW + (TURN_SPEED_HIGH - TURN_SPEED_LOW) * speedFrac) * steerFactor;
        const suspensionNoise = isQuali ? 0 : getSuspensionNoise(p.damageParts);
        const steer = inputs.steer + suspensionNoise;
        p.angle += turnRate * dir * steer;
    }

    const fx = Math.sin(p.angle) * p.speed;
    const fz = Math.cos(p.angle) * p.speed;
    p.vx = p.vx * grip + fx * (1 - grip);
    p.vz = p.vz * grip + fz * (1 - grip);
}

module.exports = {
    MAX_SPEED, ACCEL, FRICTION, TURN_SPEED_LOW, TURN_SPEED_HIGH, GRIP, BRAKE_MULT,
    effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult, updateVelocity, integratePosition, applyOffTrackDrag
};
```

- [ ] **Step 6: Eseguire l'intera suite di regressione (inclusi i test di caratterizzazione del Task 2)**

Run: `node --test backend/sockets/games/physics backend/sockets/games/trackLoader.test.js backend/sockets/games/f1GameSocket.exports.test.js backend/sockets/games/f1Testbench.test.js backend/sockets/games/f1Bot.test.js backend/sockets/games/f1GameSocket.physics.test.js backend/tools/f1LapSimulator.test.js`
Expected: `127 pass, 5 fail` (119 del Task 1 + 4 del Task 2 + 4 nuovi di questo test; stessi 5 fail pre-esistenti)

- [ ] **Step 7: Confrontare `f1LapSimulator.js --all-tracks`**

Run: `node backend/tools/f1LapSimulator.js --all-tracks`
Expected: identica alla baseline.

- [ ] **Step 8: Commit** (solo su richiesta utente)

```bash
git add backend/sockets/games/physics/VehicleMotionModel.js backend/sockets/games/physics/VehicleMotionModel.test.js backend/sockets/games/physics/VehiclePhysics.js
git commit -m "F1: estrae VehicleMotionModel (integratePosition/applyOffTrackDrag) da VehiclePhysics"
```

---

## Task 4: Estrarre `SteeringModel.js`

**Files:**
- Create: `backend/sockets/games/physics/SteeringModel.js`
- Test: `backend/sockets/games/physics/SteeringModel.test.js`
- Modify: `backend/sockets/games/physics/VehiclePhysics.js`

**Interfaces:**
- Consumes: `DamageModel.getFrontWingSteerPenalty(parts)`, `DamageModel.getSuspensionNoise(parts, rng)` (invariate).
- Produces: `SteeringModel.applySteering(p, isQuali, maxSpeed)`, `SteeringModel.TURN_SPEED_LOW`, `SteeringModel.TURN_SPEED_HIGH`.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
// backend/sockets/games/physics/SteeringModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { applySteering, TURN_SPEED_LOW, TURN_SPEED_HIGH } = require('./SteeringModel');

test('TURN_SPEED_LOW/HIGH: valori storici invariati', () => {
    assert.equal(TURN_SPEED_LOW, 0.075);
    assert.equal(TURN_SPEED_HIGH, 0.052);
});

test('applySteering: auto sana, sterzo pieno, angle aumenta della turnRate esatta', () => {
    const p = { speed: 3, vx: 0, vz: 0, angle: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 }, inputs: { steer: 1 } };
    applySteering(p, false, 6.2);
    assert.ok(Math.abs(p.angle - 0.06387096774193549) < 1e-12);
});

test('applySteering: ala anteriore danneggiata riduce la turnRate (sottosterzo)', () => {
    const p = { speed: 3, vx: 0, vz: 0, angle: 0, damageParts: { frontWing: 60, floor: 0, engine: 0, suspension: 0 }, inputs: { steer: 1 } };
    applySteering(p, false, 6.2);
    assert.ok(Math.abs(p.angle - 0.04854193548387097) < 1e-12);
});

test('applySteering: in qualifica il danno viene ignorato (steerFactor sempre 1)', () => {
    const p = { speed: 3, vx: 0, vz: 0, angle: 0, damageParts: { frontWing: 100, floor: 0, engine: 0, suspension: 0 }, inputs: { steer: -1 } };
    applySteering(p, true, 6.2);
    assert.ok(Math.abs(p.angle - (-0.06387096774193549)) < 1e-12);
});

test('applySteering: sotto la soglia di velocità/moto minima, nessun effetto', () => {
    const p = { speed: 0, vx: 0, vz: 0, angle: 1.23, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 }, inputs: { steer: 1 } };
    applySteering(p, false, 6.2);
    assert.equal(p.angle, 1.23);
});
```

- [ ] **Step 2: Eseguire il test, verificare che fallisca**

Run: `node --test backend/sockets/games/physics/SteeringModel.test.js`
Expected: FAIL con `Cannot find module './SteeringModel'`

- [ ] **Step 3: Creare `backend/sockets/games/physics/SteeringModel.js`**

```js
// backend/sockets/games/physics/SteeringModel.js
//
// Steering Model: sterzo dipendente dalla velocità (pieno sterzo a bassa
// velocità, più contenuto al massimo) + sottosterzo da ala anteriore rotta +
// rumore da sospensioni danneggiate. Estratto da VehiclePhysics.js —
// refactoring architetturale (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const { getFrontWingSteerPenalty, getSuspensionNoise } = require('./DamageModel');

const TURN_SPEED_LOW  = 0.075;   // rad/tick a velocità quasi nulla
const TURN_SPEED_HIGH = 0.052;   // rad/tick alla velocità massima

// Aggiorna p.angle in base a input.steer, velocità corrente (interpolazione
// TURN_SPEED_LOW..TURN_SPEED_HIGH) e danno (sottosterzo ala + rumore
// sospensioni). Nessun effetto sotto la soglia di velocità/moto minima.
function applySteering(p, isQuali, maxSpeed) {
    const { inputs } = p;
    if (Math.abs(p.speed) > 0.01 || (p.vx * p.vx + p.vz * p.vz) > 0.0001) {
        const dir = p.speed >= 0 ? 1 : -1;
        const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
        const steerFactor = isQuali ? 1 : 1 - getFrontWingSteerPenalty(p.damageParts);
        const turnRate = (TURN_SPEED_LOW + (TURN_SPEED_HIGH - TURN_SPEED_LOW) * speedFrac) * steerFactor;
        const suspensionNoise = isQuali ? 0 : getSuspensionNoise(p.damageParts);
        const steer = inputs.steer + suspensionNoise;
        p.angle += turnRate * dir * steer;
    }
}

module.exports = { TURN_SPEED_LOW, TURN_SPEED_HIGH, applySteering };
```

- [ ] **Step 4: Eseguire il test, verificare che passi**

Run: `node --test backend/sockets/games/physics/SteeringModel.test.js`
Expected: PASS (5/5)

- [ ] **Step 5: Riscrivere `backend/sockets/games/physics/VehiclePhysics.js`** (rimuove `TURN_SPEED_LOW/HIGH`, `getFrontWingSteerPenalty`/`getSuspensionNoise` dal require di `DamageModel`, e il blocco sterzo dentro `updateVelocity`; delega a `SteeringModel.applySteering`):

```js
// backend/sockets/games/physics/VehiclePhysics.js
//
// Vehicle Controller / Physics Model: velocità (accelerazione/freno/grip).
// Sterzo ora in SteeringModel.js, integrazione posizione/drag fuoripista in
// VehicleMotionModel.js — refactoring architetturale (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const { tyreOf, WEAR_SPEED_PENALTY, WEAR_GRIP_PENALTY, WEAR_BRAKE_PENALTY, WEAR_ACCEL_PENALTY, getWearPenaltyFactor } = require('./TyreModel');
const { getEnginePowerPenalty, getFloorGripPenalty } = require('./DamageModel');
const { integratePosition, applyOffTrackDrag } = require('./VehicleMotionModel');
const SteeringModel = require('./SteeringModel');
const { TURN_SPEED_LOW, TURN_SPEED_HIGH } = SteeringModel;

const MAX_SPEED    = 6.2;
const ACCEL        = 0.186;
const FRICTION     = 0.120;
const GRIP         = 0.78;
const BRAKE_MULT   = 2.17;

function effectiveMaxSpeed(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_SPEED_PENALTY;
    const engineFactor = isQuali ? 1 : 1 - getEnginePowerPenalty(p.damageParts);
    return MAX_SPEED * tyreOf(p, isQuali).speedMult * wearFactor * engineFactor;
}

function effectiveGrip(p, isQuali) {
    const wearFactor  = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_GRIP_PENALTY;
    const floorFactor = isQuali ? 1 : 1 - getFloorGripPenalty(p.damageParts);
    return GRIP * tyreOf(p, isQuali).gripMult * wearFactor * floorFactor;
}

function effectiveAccel(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_ACCEL_PENALTY;
    const engineFactor = isQuali ? 1 : 1 - getEnginePowerPenalty(p.damageParts);
    return ACCEL * wearFactor * engineFactor;
}

function effectiveBrakeMult(p, isQuali) {
    const wearFactor = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_BRAKE_PENALTY;
    return BRAKE_MULT * wearFactor;
}

function updateVelocity(p, isQuali, slipstreamMult) {
    const { inputs } = p;
    const maxSpeed = effectiveMaxSpeed(p, isQuali) * (slipstreamMult || 1);
    const grip     = effectiveGrip(p, isQuali);

    if (inputs.throttle > 0) p.speed = Math.min(p.speed + effectiveAccel(p, isQuali) * inputs.throttle, maxSpeed);
    else if (inputs.brake > 0) {
        p.speed = Math.max(p.speed - effectiveAccel(p, isQuali) * effectiveBrakeMult(p, isQuali) * inputs.brake, -maxSpeed / 2);
        p.vx *= 0.94;
        p.vz *= 0.94;
    } else {
        if (p.speed > 0) p.speed = Math.max(p.speed - FRICTION, 0);
        if (p.speed < 0) p.speed = Math.min(p.speed + FRICTION, 0);
    }
    if (p.speed > maxSpeed) p.speed = maxSpeed;

    SteeringModel.applySteering(p, isQuali, maxSpeed);

    const fx = Math.sin(p.angle) * p.speed;
    const fz = Math.cos(p.angle) * p.speed;
    p.vx = p.vx * grip + fx * (1 - grip);
    p.vz = p.vz * grip + fz * (1 - grip);
}

module.exports = {
    MAX_SPEED, ACCEL, FRICTION, TURN_SPEED_LOW, TURN_SPEED_HIGH, GRIP, BRAKE_MULT,
    effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult, updateVelocity, integratePosition, applyOffTrackDrag
};
```

- [ ] **Step 6: Eseguire l'intera suite di regressione**

Run: `node --test backend/sockets/games/physics backend/sockets/games/trackLoader.test.js backend/sockets/games/f1GameSocket.exports.test.js backend/sockets/games/f1Testbench.test.js backend/sockets/games/f1Bot.test.js backend/sockets/games/f1GameSocket.physics.test.js backend/tools/f1LapSimulator.test.js`
Expected: `132 pass, 5 fail` (127 + 5 nuovi di SteeringModel; stessi 5 fail pre-esistenti). **I 4 test di caratterizzazione del Task 2 devono restare verdi identici** — è la prova che spostare il blocco sterzo non ha cambiato nulla.

- [ ] **Step 7: Confrontare `f1LapSimulator.js --all-tracks`**

Run: `node backend/tools/f1LapSimulator.js --all-tracks`
Expected: identica alla baseline.

- [ ] **Step 8: Commit** (solo su richiesta utente)

```bash
git add backend/sockets/games/physics/SteeringModel.js backend/sockets/games/physics/SteeringModel.test.js backend/sockets/games/physics/VehiclePhysics.js
git commit -m "F1: estrae SteeringModel (applySteering) da VehiclePhysics"
```

---

## Task 5: Estrarre `BrakingModel.js`

**Files:**
- Create: `backend/sockets/games/physics/BrakingModel.js`
- Test: `backend/sockets/games/physics/BrakingModel.test.js`
- Modify: `backend/sockets/games/physics/VehiclePhysics.js`

**Interfaces:**
- Produces: `BrakingModel.BRAKE_MULT`, `BrakingModel.effectiveBrakeMult(p, isQuali)`, `BrakingModel.applyBrake(p, isQuali, maxSpeed, accelValue)`.
- Nota di design: `applyBrake` riceve `accelValue` (il risultato di `effectiveAccel`) come parametro invece di importare `PowertrainModel` — la formula storica moltiplica accelerazione×frenata, ma `BrakingModel` non deve conoscere `PowertrainModel` (nessuna dipendenza tra sotto-modelli fratelli): è l'orchestratore in `VehiclePhysics.js` a passare il valore già calcolato, come già fa oggi con `maxSpeed`/`grip`.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
// backend/sockets/games/physics/BrakingModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { BRAKE_MULT, effectiveBrakeMult, applyBrake } = require('./BrakingModel');

test('BRAKE_MULT: valore storico invariato', () => {
    assert.equal(BRAKE_MULT, 2.17);
});

test('effectiveBrakeMult: gomma fresca -> BRAKE_MULT pieno', () => {
    const p = { compound: 'medium', tyreWear: 0 };
    assert.equal(effectiveBrakeMult(p, false), 2.17);
});

test('effectiveBrakeMult: gomma usurata 80% -> penalità frenata applicata', () => {
    const p = { compound: 'medium', tyreWear: 80 };
    assert.ok(Math.abs(effectiveBrakeMult(p, false) - 1.8851874999999998) < 1e-9);
});

test("effectiveBrakeMult: in qualifica ignora sempre l'usura", () => {
    const p = { compound: 'medium', tyreWear: 80 };
    assert.equal(effectiveBrakeMult(p, true), 2.17);
});

test('applyBrake: frenata piena da velocità 4, gomma fresca -> decelerazione + smorzamento laterale', () => {
    const p = { speed: 4, vx: 1, vz: 1, inputs: { brake: 1 }, compound: 'medium', tyreWear: 0 };
    applyBrake(p, false, 6.2, 0.186);
    assert.ok(Math.abs(p.speed - 3.59638) < 1e-9);
    assert.ok(Math.abs(p.vx - 0.94) < 1e-12);
    assert.ok(Math.abs(p.vz - 0.94) < 1e-12);
});

test('applyBrake: non scende mai sotto -maxSpeed/2 (tetto retromarcia)', () => {
    const p = { speed: -3, vx: 0, vz: 0, inputs: { brake: 1 }, compound: 'medium', tyreWear: 0 };
    applyBrake(p, false, 6.2, 0.186);
    assert.equal(p.speed, -3.1);
});
```

- [ ] **Step 2: Eseguire il test, verificare che fallisca**

Run: `node --test backend/sockets/games/physics/BrakingModel.test.js`
Expected: FAIL con `Cannot find module './BrakingModel'`

- [ ] **Step 3: Creare `backend/sockets/games/physics/BrakingModel.js`**

```js
// backend/sockets/games/physics/BrakingModel.js
//
// Braking Model: frenata/retromarcia (decremento costante per tick, tetto a
// -maxSpeed/2) + smorzamento laterale in frenata. Estratto da
// VehiclePhysics.js — refactoring architetturale (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const { WEAR_BRAKE_PENALTY, getWearPenaltyFactor } = require('./TyreModel');

const BRAKE_MULT = 2.17;   // moltiplicatore di ACCEL in frenata

function effectiveBrakeMult(p, isQuali) {
    const wearFactor = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_BRAKE_PENALTY;
    return BRAKE_MULT * wearFactor;
}

// `accelValue` = effectiveAccel(p, isQuali) del chiamante (PowertrainModel):
// BrakingModel non dipende da PowertrainModel, riceve il valore già pronto.
function applyBrake(p, isQuali, maxSpeed, accelValue) {
    p.speed = Math.max(p.speed - accelValue * effectiveBrakeMult(p, isQuali) * p.inputs.brake, -maxSpeed / 2);
    p.vx *= 0.94;
    p.vz *= 0.94;
}

module.exports = { BRAKE_MULT, effectiveBrakeMult, applyBrake };
```

- [ ] **Step 4: Eseguire il test, verificare che passi**

Run: `node --test backend/sockets/games/physics/BrakingModel.test.js`
Expected: PASS (6/6)

- [ ] **Step 5: Riscrivere `backend/sockets/games/physics/VehiclePhysics.js`**:

```js
// backend/sockets/games/physics/VehiclePhysics.js
//
// Vehicle Controller / Physics Model: velocità (accelerazione/grip). Freno
// in BrakingModel.js, sterzo in SteeringModel.js, integrazione
// posizione/drag fuoripista in VehicleMotionModel.js — refactoring
// architetturale (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const { tyreOf, WEAR_SPEED_PENALTY, WEAR_GRIP_PENALTY, WEAR_ACCEL_PENALTY, getWearPenaltyFactor } = require('./TyreModel');
const { getEnginePowerPenalty, getFloorGripPenalty } = require('./DamageModel');
const { integratePosition, applyOffTrackDrag } = require('./VehicleMotionModel');
const SteeringModel = require('./SteeringModel');
const { TURN_SPEED_LOW, TURN_SPEED_HIGH } = SteeringModel;
const BrakingModel = require('./BrakingModel');
const { BRAKE_MULT, effectiveBrakeMult } = BrakingModel;

const MAX_SPEED    = 6.2;
const ACCEL        = 0.186;
const FRICTION     = 0.120;
const GRIP         = 0.78;

function effectiveMaxSpeed(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_SPEED_PENALTY;
    const engineFactor = isQuali ? 1 : 1 - getEnginePowerPenalty(p.damageParts);
    return MAX_SPEED * tyreOf(p, isQuali).speedMult * wearFactor * engineFactor;
}

function effectiveGrip(p, isQuali) {
    const wearFactor  = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_GRIP_PENALTY;
    const floorFactor = isQuali ? 1 : 1 - getFloorGripPenalty(p.damageParts);
    return GRIP * tyreOf(p, isQuali).gripMult * wearFactor * floorFactor;
}

function effectiveAccel(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_ACCEL_PENALTY;
    const engineFactor = isQuali ? 1 : 1 - getEnginePowerPenalty(p.damageParts);
    return ACCEL * wearFactor * engineFactor;
}

function updateVelocity(p, isQuali, slipstreamMult) {
    const { inputs } = p;
    const maxSpeed = effectiveMaxSpeed(p, isQuali) * (slipstreamMult || 1);
    const grip     = effectiveGrip(p, isQuali);

    if (inputs.throttle > 0) p.speed = Math.min(p.speed + effectiveAccel(p, isQuali) * inputs.throttle, maxSpeed);
    else if (inputs.brake > 0) BrakingModel.applyBrake(p, isQuali, maxSpeed, effectiveAccel(p, isQuali));
    else {
        if (p.speed > 0) p.speed = Math.max(p.speed - FRICTION, 0);
        if (p.speed < 0) p.speed = Math.min(p.speed + FRICTION, 0);
    }
    if (p.speed > maxSpeed) p.speed = maxSpeed;

    SteeringModel.applySteering(p, isQuali, maxSpeed);

    const fx = Math.sin(p.angle) * p.speed;
    const fz = Math.cos(p.angle) * p.speed;
    p.vx = p.vx * grip + fx * (1 - grip);
    p.vz = p.vz * grip + fz * (1 - grip);
}

module.exports = {
    MAX_SPEED, ACCEL, FRICTION, TURN_SPEED_LOW, TURN_SPEED_HIGH, GRIP, BRAKE_MULT,
    effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult, updateVelocity, integratePosition, applyOffTrackDrag
};
```

- [ ] **Step 6: Eseguire l'intera suite di regressione**

Run: `node --test backend/sockets/games/physics backend/sockets/games/trackLoader.test.js backend/sockets/games/f1GameSocket.exports.test.js backend/sockets/games/f1Testbench.test.js backend/sockets/games/f1Bot.test.js backend/sockets/games/f1GameSocket.physics.test.js backend/tools/f1LapSimulator.test.js`
Expected: `138 pass, 5 fail` (132 + 6 nuovi di BrakingModel). I test di caratterizzazione del Task 2 restano verdi identici.

- [ ] **Step 7: Confrontare `f1LapSimulator.js --all-tracks`**

Run: `node backend/tools/f1LapSimulator.js --all-tracks`
Expected: identica alla baseline.

- [ ] **Step 8: Commit** (solo su richiesta utente)

```bash
git add backend/sockets/games/physics/BrakingModel.js backend/sockets/games/physics/BrakingModel.test.js backend/sockets/games/physics/VehiclePhysics.js
git commit -m "F1: estrae BrakingModel (applyBrake/effectiveBrakeMult) da VehiclePhysics"
```

---

## Task 6: Estrarre `PowertrainModel.js`

Estrazione **1:1** della logica motore/coast-down già esistente — nessun nuovo modello motore introdotto (vincolo esplicito).

**Files:**
- Create: `backend/sockets/games/physics/PowertrainModel.js`
- Test: `backend/sockets/games/physics/PowertrainModel.test.js`
- Modify: `backend/sockets/games/physics/VehiclePhysics.js`

**Interfaces:**
- Produces: `PowertrainModel.{MAX_SPEED, ACCEL, FRICTION, effectiveMaxSpeed, effectiveAccel, applyThrottle, applyCoast}`.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
// backend/sockets/games/physics/PowertrainModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_SPEED, ACCEL, FRICTION, effectiveMaxSpeed, effectiveAccel, applyThrottle, applyCoast } = require('./PowertrainModel');

test('costanti storiche invariate', () => {
    assert.equal(MAX_SPEED, 6.2);
    assert.equal(ACCEL, 0.186);
    assert.equal(FRICTION, 0.120);
});

test('effectiveMaxSpeed/effectiveAccel: gomma fresca, nessun danno -> valori pieni', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    assert.equal(effectiveMaxSpeed(p, false), 6.2);
    assert.equal(effectiveAccel(p, false), 0.186);
});

test('effectiveMaxSpeed/effectiveAccel: gomma usurata 80% + motore danneggiato 40% -> penalità combinate', () => {
    const p = { compound: 'medium', tyreWear: 80, damageParts: { frontWing: 0, floor: 0, engine: 40, suspension: 0 } };
    assert.ok(Math.abs(effectiveMaxSpeed(p, false) - 4.85925) < 1e-9);
    assert.ok(Math.abs(effectiveAccel(p, false) - 0.149358) < 1e-9);
});

test('applyThrottle: da fermo, gomma fresca -> speed = ACCEL esatto', () => {
    const p = { speed: 0, inputs: { throttle: 1 }, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    applyThrottle(p, false, 6.2);
    assert.equal(p.speed, 0.186);
});

test('applyThrottle: clampa al tetto di velocità', () => {
    const p = { speed: 6.15, inputs: { throttle: 1 }, compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    applyThrottle(p, false, 6.2);
    assert.equal(p.speed, 6.2);
});

test('applyCoast: decelera verso zero senza mai superarlo, avanti e in retromarcia', () => {
    const p1 = { speed: 2 };
    applyCoast(p1);
    assert.equal(p1.speed, 1.88);
    const p2 = { speed: -2 };
    applyCoast(p2);
    assert.equal(p2.speed, -1.88);
    const p3 = { speed: 0.05 };
    applyCoast(p3);
    assert.equal(p3.speed, 0);
});
```

- [ ] **Step 2: Eseguire il test, verificare che fallisca**

Run: `node --test backend/sockets/games/physics/PowertrainModel.test.js`
Expected: FAIL con `Cannot find module './PowertrainModel'`

- [ ] **Step 3: Creare `backend/sockets/games/physics/PowertrainModel.js`**

```js
// backend/sockets/games/physics/PowertrainModel.js
//
// Powertrain Model: accelerazione da acceleratore + coast-down ad
// acceleratore rilasciato (attrito costante per tick). Estrazione 1:1 della
// logica esistente da VehiclePhysics.js — nessun nuovo modello motore
// introdotto (refactoring architetturale, Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md).
const { tyreOf, WEAR_SPEED_PENALTY, WEAR_ACCEL_PENALTY, getWearPenaltyFactor } = require('./TyreModel');
const { getEnginePowerPenalty } = require('./DamageModel');

// Velocità realistica F1: fattore di scala R=1.55 (+55%) applicato a
// MAX_SPEED/ACCEL/FRICTION rispetto ai valori storici (4.0/0.12/0.050). Vedi
// docs/superpowers/specs/2026-07-21-f1-velocita-frenata-mescole-design.md.
const MAX_SPEED = 6.2;
const ACCEL     = 0.186;
const FRICTION  = 0.120;   // decremento costante per tick del coast-down

function effectiveMaxSpeed(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_SPEED_PENALTY;
    const engineFactor = isQuali ? 1 : 1 - getEnginePowerPenalty(p.damageParts);
    return MAX_SPEED * tyreOf(p, isQuali).speedMult * wearFactor * engineFactor;
}

function effectiveAccel(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_ACCEL_PENALTY;
    const engineFactor = isQuali ? 1 : 1 - getEnginePowerPenalty(p.damageParts);
    return ACCEL * wearFactor * engineFactor;
}

// Acceleratore premuto: applica effectiveAccel*throttle, clampato al tetto
// di velocità del tick (già scalato da mescola/usura/danno motore/scia).
function applyThrottle(p, isQuali, maxSpeed) {
    p.speed = Math.min(p.speed + effectiveAccel(p, isQuali) * p.inputs.throttle, maxSpeed);
}

// Nessun pedale premuto: decelerazione costante (FRICTION) verso lo zero,
// mai oltre.
function applyCoast(p) {
    if (p.speed > 0) p.speed = Math.max(p.speed - FRICTION, 0);
    if (p.speed < 0) p.speed = Math.min(p.speed + FRICTION, 0);
}

module.exports = { MAX_SPEED, ACCEL, FRICTION, effectiveMaxSpeed, effectiveAccel, applyThrottle, applyCoast };
```

- [ ] **Step 4: Eseguire il test, verificare che passi**

Run: `node --test backend/sockets/games/physics/PowertrainModel.test.js`
Expected: PASS (7/7)

- [ ] **Step 5: Riscrivere `backend/sockets/games/physics/VehiclePhysics.js`**:

```js
// backend/sockets/games/physics/VehiclePhysics.js
//
// Vehicle Controller / Physics Model: grip (aderenza). Motore in
// PowertrainModel.js, freno in BrakingModel.js, sterzo in SteeringModel.js,
// integrazione posizione/drag fuoripista in VehicleMotionModel.js —
// refactoring architetturale (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const { tyreOf, WEAR_GRIP_PENALTY, getWearPenaltyFactor } = require('./TyreModel');
const { getFloorGripPenalty } = require('./DamageModel');
const { integratePosition, applyOffTrackDrag } = require('./VehicleMotionModel');
const SteeringModel = require('./SteeringModel');
const { TURN_SPEED_LOW, TURN_SPEED_HIGH } = SteeringModel;
const BrakingModel = require('./BrakingModel');
const { BRAKE_MULT, effectiveBrakeMult } = BrakingModel;
const PowertrainModel = require('./PowertrainModel');
const { MAX_SPEED, ACCEL, FRICTION, effectiveMaxSpeed, effectiveAccel } = PowertrainModel;

const GRIP = 0.78;

function effectiveGrip(p, isQuali) {
    const wearFactor  = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_GRIP_PENALTY;
    const floorFactor = isQuali ? 1 : 1 - getFloorGripPenalty(p.damageParts);
    return GRIP * tyreOf(p, isQuali).gripMult * wearFactor * floorFactor;
}

function updateVelocity(p, isQuali, slipstreamMult) {
    const { inputs } = p;
    const maxSpeed = effectiveMaxSpeed(p, isQuali) * (slipstreamMult || 1);
    const grip     = effectiveGrip(p, isQuali);

    if (inputs.throttle > 0) PowertrainModel.applyThrottle(p, isQuali, maxSpeed);
    else if (inputs.brake > 0) BrakingModel.applyBrake(p, isQuali, maxSpeed, effectiveAccel(p, isQuali));
    else PowertrainModel.applyCoast(p);

    if (p.speed > maxSpeed) p.speed = maxSpeed;

    SteeringModel.applySteering(p, isQuali, maxSpeed);

    const fx = Math.sin(p.angle) * p.speed;
    const fz = Math.cos(p.angle) * p.speed;
    p.vx = p.vx * grip + fx * (1 - grip);
    p.vz = p.vz * grip + fz * (1 - grip);
}

module.exports = {
    MAX_SPEED, ACCEL, FRICTION, TURN_SPEED_LOW, TURN_SPEED_HIGH, GRIP, BRAKE_MULT,
    effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult, updateVelocity, integratePosition, applyOffTrackDrag
};
```

- [ ] **Step 6: Eseguire l'intera suite di regressione**

Run: `node --test backend/sockets/games/physics backend/sockets/games/trackLoader.test.js backend/sockets/games/f1GameSocket.exports.test.js backend/sockets/games/f1Testbench.test.js backend/sockets/games/f1Bot.test.js backend/sockets/games/f1GameSocket.physics.test.js backend/tools/f1LapSimulator.test.js`
Expected: `144 pass, 5 fail` (138 + 6 nuovi di PowertrainModel). I test di caratterizzazione del Task 2 restano verdi identici.

- [ ] **Step 7: Confrontare `f1LapSimulator.js --all-tracks`**

Run: `node backend/tools/f1LapSimulator.js --all-tracks`
Expected: identica alla baseline.

- [ ] **Step 8: Commit** (solo su richiesta utente)

```bash
git add backend/sockets/games/physics/PowertrainModel.js backend/sockets/games/physics/PowertrainModel.test.js backend/sockets/games/physics/VehiclePhysics.js
git commit -m "F1: estrae PowertrainModel (applyThrottle/applyCoast/effectiveMaxSpeed/effectiveAccel) da VehiclePhysics"
```

---

## Task 7: Estrarre `AerodynamicsModel.js` — `VehiclePhysics.js` diventa orchestratore puro

Ultima estrazione: dopo questo task `VehiclePhysics.js` non contiene più nessuna formula propria, solo la composizione ordinata dei 5 sotto-moduli.

**Files:**
- Create: `backend/sockets/games/physics/AerodynamicsModel.js`
- Test: `backend/sockets/games/physics/AerodynamicsModel.test.js`
- Modify: `backend/sockets/games/physics/VehiclePhysics.js`

**Interfaces:**
- Produces: `AerodynamicsModel.GRIP`, `AerodynamicsModel.effectiveGrip(p, isQuali)`, `AerodynamicsModel.applyGripBlend(p, grip)`.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
// backend/sockets/games/physics/AerodynamicsModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { GRIP, effectiveGrip, applyGripBlend } = require('./AerodynamicsModel');

test('GRIP: valore storico invariato', () => {
    assert.equal(GRIP, 0.78);
});

test('effectiveGrip: gomma fresca, nessun danno -> GRIP pieno per la mescola medium', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    assert.ok(Math.abs(effectiveGrip(p, false) - 0.741) < 1e-9);
});

test('effectiveGrip: fondo danneggiato 50% -> aderenza ridotta', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 50, engine: 0, suspension: 0 } };
    assert.ok(Math.abs(effectiveGrip(p, false) - 0.611325) < 1e-9);
});

test('applyGripBlend: vx/vz convergono verso la direzione del muso pesati da grip', () => {
    const p = { angle: 0, speed: 3, vx: 1, vz: 1 };
    applyGripBlend(p, 0.741);
    assert.ok(Math.abs(p.vx - 0.741) < 1e-9);
    assert.ok(Math.abs(p.vz - 1.518) < 1e-9);
});
```

- [ ] **Step 2: Eseguire il test, verificare che fallisca**

Run: `node --test backend/sockets/games/physics/AerodynamicsModel.test.js`
Expected: FAIL con `Cannot find module './AerodynamicsModel'`

- [ ] **Step 3: Creare `backend/sockets/games/physics/AerodynamicsModel.js`**

```js
// backend/sockets/games/physics/AerodynamicsModel.js
//
// Aerodynamics Model: aderenza (grip) da mescola/usura/danno al fondo +
// blend finale vx/vz verso la direzione del muso. Estratto da
// VehiclePhysics.js — refactoring architetturale (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const { tyreOf, WEAR_GRIP_PENALTY, getWearPenaltyFactor } = require('./TyreModel');
const { getFloorGripPenalty } = require('./DamageModel');

const GRIP = 0.78;

function effectiveGrip(p, isQuali) {
    const wearFactor  = isQuali ? 1 : 1 - getWearPenaltyFactor(p.tyreWear) * WEAR_GRIP_PENALTY;
    const floorFactor = isQuali ? 1 : 1 - getFloorGripPenalty(p.damageParts);
    return GRIP * tyreOf(p, isQuali).gripMult * wearFactor * floorFactor;
}

// Blend tra la velocità vettoriale corrente e la direzione del muso
// (sin/cos(angle)*speed), pesato da grip: più aderenza = più velocemente
// vx/vz convergono verso dove punta l'auto.
function applyGripBlend(p, grip) {
    const fx = Math.sin(p.angle) * p.speed;
    const fz = Math.cos(p.angle) * p.speed;
    p.vx = p.vx * grip + fx * (1 - grip);
    p.vz = p.vz * grip + fz * (1 - grip);
}

module.exports = { GRIP, effectiveGrip, applyGripBlend };
```

- [ ] **Step 4: Eseguire il test, verificare che passi**

Run: `node --test backend/sockets/games/physics/AerodynamicsModel.test.js`
Expected: PASS (4/4)

- [ ] **Step 5: Riscrivere `backend/sockets/games/physics/VehiclePhysics.js`** — versione finale, orchestratore puro:

```js
// backend/sockets/games/physics/VehiclePhysics.js
//
// Vehicle Physics: orchestratore del calcolo velocità per tick. Le formule
// vivono nei sotto-moduli (PowertrainModel/BrakingModel/SteeringModel/
// AerodynamicsModel/VehicleMotionModel) — questo file li chiama nello STESSO
// ordine di sempre (refactoring architetturale, Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md) e
// ri-esporta i nomi pubblici storici per compatibilità con f1GameSocket.js,
// f1Bot.js e gli strumenti offline (f1LapSimulator.js, f1RaceLineOptimizer.js).
const PowertrainModel   = require('./PowertrainModel');
const BrakingModel      = require('./BrakingModel');
const SteeringModel     = require('./SteeringModel');
const AerodynamicsModel = require('./AerodynamicsModel');
const { integratePosition, applyOffTrackDrag } = require('./VehicleMotionModel');

const { MAX_SPEED, ACCEL, FRICTION, effectiveMaxSpeed, effectiveAccel } = PowertrainModel;
const { BRAKE_MULT, effectiveBrakeMult } = BrakingModel;
const { TURN_SPEED_LOW, TURN_SPEED_HIGH } = SteeringModel;
const { GRIP, effectiveGrip } = AerodynamicsModel;

// ====================================================
// FISICA
// Velocità (accelerazione/freno/sterzo/grip) e integrazione della posizione
// sono separate apposta: la velocità si calcola una volta per tick, la
// posizione viene integrata in sottostep da tickGame (vedi
// CollisionResolver.COLLISION_SUBSTEPS) per dare alla risoluzione collisioni
// più occasioni di vedere un contatto.
// ====================================================
function updateVelocity(p, isQuali, slipstreamMult) {
    const { inputs } = p;
    const maxSpeed = effectiveMaxSpeed(p, isQuali) * (slipstreamMult || 1);   // dipende da mescola + usura (Soft fissa in qualifica) + scia
    const grip     = effectiveGrip(p, isQuali);

    if (inputs.throttle > 0) PowertrainModel.applyThrottle(p, isQuali, maxSpeed);
    else if (inputs.brake > 0) BrakingModel.applyBrake(p, isQuali, maxSpeed, effectiveAccel(p, isQuali));
    else PowertrainModel.applyCoast(p);

    // Il tetto di velocità può essersi abbassato (usura aumentata da fermo non
    // succede, ma cambiando mescola in futuro pit stop sì): non lasciare mai
    // p.speed sopra il nuovo massimo.
    if (p.speed > maxSpeed) p.speed = maxSpeed;

    SteeringModel.applySteering(p, isQuali, maxSpeed);

    AerodynamicsModel.applyGripBlend(p, grip);
}

module.exports = {
    MAX_SPEED, ACCEL, FRICTION, TURN_SPEED_LOW, TURN_SPEED_HIGH, GRIP, BRAKE_MULT,
    effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult, updateVelocity, integratePosition, applyOffTrackDrag
};
```

- [ ] **Step 6: Eseguire l'intera suite di regressione**

Run: `node --test backend/sockets/games/physics backend/sockets/games/trackLoader.test.js backend/sockets/games/f1GameSocket.exports.test.js backend/sockets/games/f1Testbench.test.js backend/sockets/games/f1Bot.test.js backend/sockets/games/f1GameSocket.physics.test.js backend/tools/f1LapSimulator.test.js`
Expected: `148 pass, 5 fail` (144 + 4 nuovi di AerodynamicsModel). **Tutti e 4 i test di caratterizzazione del Task 2 devono essere ancora verdi, con gli stessi identici numeri** — è la prova finale che la composizione dei 5 moduli riproduce esattamente `updateVelocity` originale.

- [ ] **Step 7: Confrontare `f1LapSimulator.js --all-tracks`**

Run: `node backend/tools/f1LapSimulator.js --all-tracks`
Expected: identica alla baseline.

- [ ] **Step 8: Verifica utente in localhost**

Avviare `node server.js` da `backend/`, aprire due tab, corsa completa (qualifica → griglia → gara con almeno un pit stop, un urto contro un'altra auto e uno contro una barriera se la pista lo consente) — è il checkpoint finale dell'intero piano: `VehiclePhysics.js` ora è puro orchestratore, nessuna formula vive più lì.

- [ ] **Step 9: Commit** (solo su richiesta utente)

```bash
git add backend/sockets/games/physics/AerodynamicsModel.js backend/sockets/games/physics/AerodynamicsModel.test.js backend/sockets/games/physics/VehiclePhysics.js
git commit -m "F1: estrae AerodynamicsModel da VehiclePhysics — VehiclePhysics diventa orchestratore puro"
```

---

## Task 8 (opzionale — da valutare a parte): `VehicleState`/`InputState` come helper di proiezione

Non necessario per l'architettura funzionante (Task 1-7 già realizzano tutti i nodi principali dello schema target tranne questi due). Task separato e a rischio/valore più basso: introduce SOLO funzioni di proiezione pure, additive, senza spostare o rinominare alcun campo sull'oggetto giocatore esistente (che resta condiviso con pit-stop/networking/lap-tracking, fuori scope) e senza modificare le firme dei moduli già estratti nei Task 3-7.

**Files:**
- Create: `backend/sockets/games/physics/VehicleState.js`
- Test: `backend/sockets/games/physics/VehicleState.test.js`

**Interfaces:**
- Produces: `VehicleState.pick(p)` → `{ x, z, angle, speed, vx, vz, trackIndex, compound, tyreWear, damage, damageParts }`; `InputState.pick(p)` → `{ throttle, brake, steer }`.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
// backend/sockets/games/physics/VehicleState.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { VehicleState, InputState } = require('./VehicleState');

test('VehicleState.pick: seleziona solo i campi di dinamica vettura', () => {
    const p = {
        x: 1, z: 2, angle: 0.5, speed: 3, vx: 1, vz: 1, trackIndex: 10,
        compound: 'medium', tyreWear: 20, damage: 5, damageParts: { frontWing: 5, floor: 0, engine: 0, suspension: 0 },
        // campi NON di dinamica vettura, non devono comparire nella proiezione:
        pitting: true, collisionPenaltyMs: 1500, color: 'red'
    };
    const state = VehicleState.pick(p);
    assert.deepEqual(state, {
        x: 1, z: 2, angle: 0.5, speed: 3, vx: 1, vz: 1, trackIndex: 10,
        compound: 'medium', tyreWear: 20, damage: 5, damageParts: { frontWing: 5, floor: 0, engine: 0, suspension: 0 }
    });
});

test('InputState.pick: seleziona solo throttle/brake/steer', () => {
    const p = { inputs: { throttle: 0.5, brake: 0, steer: -1 }, x: 1, speed: 2 };
    assert.deepEqual(InputState.pick(p), { throttle: 0.5, brake: 0, steer: -1 });
});
```

- [ ] **Step 2: Eseguire il test, verificare che fallisca**

Run: `node --test backend/sockets/games/physics/VehicleState.test.js`
Expected: FAIL con `Cannot find module './VehicleState'`

- [ ] **Step 3: Creare `backend/sockets/games/physics/VehicleState.js`**

```js
// backend/sockets/games/physics/VehicleState.js
//
// VehicleState/InputState: helper di sola PROIEZIONE (nessuno stato viene
// spostato dall'oggetto player esistente in f1GameSocket.js — pit-stop/
// networking/lap-tracking restano dov'erano, fuori scope). Utili come
// confine esplicito quando serve passare "solo la dinamica vettura" senza
// l'intero oggetto giocatore — non ancora usati da nessun chiamante (Rif.
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md).
function pickVehicleState(p) {
    const { x, z, angle, speed, vx, vz, trackIndex, compound, tyreWear, damage, damageParts } = p;
    return { x, z, angle, speed, vx, vz, trackIndex, compound, tyreWear, damage, damageParts };
}

function pickInputState(p) {
    const { throttle, brake, steer } = p.inputs;
    return { throttle, brake, steer };
}

module.exports = {
    VehicleState: { pick: pickVehicleState },
    InputState: { pick: pickInputState }
};
```

- [ ] **Step 4: Eseguire il test, verificare che passi**

Run: `node --test backend/sockets/games/physics/VehicleState.test.js`
Expected: PASS (2/2)

- [ ] **Step 5: Eseguire l'intera suite di regressione**

Run: `node --test backend/sockets/games/physics backend/sockets/games/trackLoader.test.js backend/sockets/games/f1GameSocket.exports.test.js backend/sockets/games/f1Testbench.test.js backend/sockets/games/f1Bot.test.js backend/sockets/games/f1GameSocket.physics.test.js backend/tools/f1LapSimulator.test.js`
Expected: `150 pass, 5 fail` (148 + 2 nuovi). Nessun file esistente è stato toccato in questo task, quindi il rischio di regressione è nullo per costruzione.

- [ ] **Step 6: Commit** (solo su richiesta utente)

```bash
git add backend/sockets/games/physics/VehicleState.js backend/sockets/games/physics/VehicleState.test.js
git commit -m "F1: aggiunge VehicleState/InputState come helper di proiezione (additivo, non ancora cablato)"
```

---

## Self-Review

- **Copertura spec:** ogni nodo dello schema target (`VehicleState`, `InputState`, `TyreModel`, `DamageModel`, `PowertrainModel`, `BrakingModel`, `SteeringModel`, `AerodynamicsModel`, `VehicleMotionModel`, `VehicleDynamics`) ha un task o è già esistente e dichiarato invariato. `CollisionResolver` resta dove sta (non nello schema target originale, già un modulo a parte).
- **Nessun placeholder:** ogni task contiene il contenuto file completo, i valori di test sono numeri concreti calcolati dal codice reale (non stimati a mano) — vedi baseline in Global Constraints.
- **Coerenza dei tipi/nomi:** verificato che ogni funzione mantenga la stessa firma attraverso i task (es. `applySteering(p, isQuali, maxSpeed)` definita nel Task 4 non cambia mai firma nei task successivi; `module.exports` di `VehiclePhysics.js` ha la stessa forma dal Task 3 al Task 7).
- **Rischio più alto:** Task 1 (rewiring di `f1GameSocket.js`, l'unico file toccato fuori da `physics/`) e Task 7 (punto in cui tutte le estrazioni si ricompongono) — entrambi hanno un checkpoint di verifica utente in localhost esplicito; i Task 3-6 restano isolati dentro `physics/` e sono coperti solo da test automatici (nessun impatto su `f1GameSocket.js`, quindi nessun rischio di regressione visibile finché il Task 7 non li integra tutti).

---

Plan completo e salvato in `docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md`. Due opzioni di esecuzione:

1. **Subagent-Driven (consigliato)** — un subagent fresco per ogni task, review tra un task e l'altro, iterazione rapida.
2. **Esecuzione Inline** — eseguo i task in questa sessione con `executing-plans`, batch con checkpoint di revisione.

Quale preferisci?
