# F1 — Fase 0: seam architetturale AerodynamicsModel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** aggiungere a `AerodynamicsModel.js` le tre funzioni pure previste
dall'architettura approvata (contributo downforce, fattore drag
longitudinale, formula scia) con un'implementazione placeholder neutra
(fattore = 1, nessun effetto). Nessun modulo esistente le consulta ancora —
zero comportamento cambiato, per costruzione (nessun consumer), non dietro
flag.

**Architecture:** `AerodynamicsModel.js` resta l'unico file toccato.
Nessuna modifica a `DamageModel.js` (i getter di penalità aero arrivano
solo in Fase 3), né a `PowertrainModel.js`, `CorneringGripModel.js`,
`VehiclePhysics.js` o `f1GameSocket.js` — questa fase è puro posizionamento
del seam, non wiring. `VehiclePhysics.js` resta l'unico orchestratore;
`AerodynamicsModel.js` resta un modulo di sola formula/fattori puri, un
modulo = una responsabilità, coerente con
`docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md`.

**Tech Stack:** Node.js, `node:test`/`node:assert/strict` (stesso stile di
tutti i test in `backend/sockets/games/physics/`).

## Global Constraints

- **Italiano** in commenti/comunicazioni (da CLAUDE.md di progetto).
- **Niente commit automatici**: l'utente fa commit/push manualmente quando
  vuole. Ogni task termina con la verifica, MAI con un comando
  `git commit`.
- **Nessun flag di confronto in questa fase**: a differenza delle fasi
  precedenti (dove il flag serviva a proteggere un comportamento già
  collegato), qui l'invarianza comportamentale è garantita strutturalmente
  — le nuove funzioni non sono importate da nessun consumer, quindi non
  serve un `F1_AERO_MODEL` per "spegnerle".
- **Non toccare**: `DamageModel.js`, `PowertrainModel.js`,
  `CorneringGripModel.js`, `SteeringModel.js`, `VehicleMotionModel.js`,
  `VehiclePhysics.js`, `f1GameSocket.js`, `f1Bot.js`,
  `f1RaceLineOptimizer.js`, `f1LapSimulator.js`.
- Riferimento: `docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md`.

---

### Task 1: `AerodynamicsModel.js` — funzioni placeholder

**Files:**
- Modify: `backend/sockets/games/physics/AerodynamicsModel.js`
- Test: Modify `backend/sockets/games/physics/AerodynamicsModel.test.js`

**Interfaces:**
- Consumes: nessuna da altri task.
- Produces: `downforceFactor(speedFrac, isQuali) -> number`,
  `dragFactor(speedFrac, isQuali) -> number`,
  `slipstreamFactor(gapM) -> number`. Nessun consumer in questa fase —
  saranno consultate rispettivamente da `CorneringGripModel`/`effectiveGrip`
  (Fase 2), `PowertrainModel.effectiveMaxSpeed` (Fase 1),
  `f1GameSocket.js` (Fase 4).

Firme scelte per coerenza con lo stile esistente: argomenti scalari
minimi, non l'intero player `p` — stesso pattern di
`TyreForceModel.corneringGripFactor(tyreWear, isQuali)` e
`TyreSlipModel.corneringDemand(steer, speedFrac)`. `speedFrac` (0..1) è la
stessa grandezza già calcolata dai chiamanti futuri (`Math.min(1,
Math.abs(p.speed) / maxSpeed)`), non un nuovo concetto.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in fondo a
`backend/sockets/games/physics/AerodynamicsModel.test.js` (dopo l'ultimo
test esistente):

```js
const { downforceFactor, dragFactor, slipstreamFactor } = require('./AerodynamicsModel');

// ---- Fase 0 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// seam architetturale — placeholder neutri, nessun consumer ancora ----

test('downforceFactor: placeholder neutro, sempre 1 qualunque velocità/qualifica', () => {
    assert.equal(downforceFactor(0, false), 1);
    assert.equal(downforceFactor(0.5, false), 1);
    assert.equal(downforceFactor(1, false), 1);
    assert.equal(downforceFactor(1, true), 1);
});

test('dragFactor: placeholder neutro, sempre 1 qualunque velocità/qualifica', () => {
    assert.equal(dragFactor(0, false), 1);
    assert.equal(dragFactor(0.5, false), 1);
    assert.equal(dragFactor(1, false), 1);
    assert.equal(dragFactor(1, true), 1);
});

test('slipstreamFactor: placeholder neutro, sempre 1 qualunque gap', () => {
    assert.equal(slipstreamFactor(0), 1);
    assert.equal(slipstreamFactor(12.5), 1);
    assert.equal(slipstreamFactor(25), 1);
    assert.equal(slipstreamFactor(1000), 1);
});

test('Fase 0: GRIP/effectiveGrip/applyGripBlend invariati (nessuna regressione sul modulo esistente)', () => {
    assert.equal(GRIP, 0.78);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/AerodynamicsModel.test.js`
Expected: FAIL sui primi 3 nuovi test (`downforceFactor`/`dragFactor`/
`slipstreamFactor` non definiti — `undefined is not a function` o simile).
L'ultimo test (`GRIP`) passa già oggi, è lì solo a conferma esplicita di
non aver toccato l'esistente.

- [ ] **Step 3: Implementazione minima**

In `backend/sockets/games/physics/AerodynamicsModel.js`, aggiungere prima
di `module.exports`:

```js
// Fase 0 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// seam architetturale — tre funzioni pure placeholder, NEUTRE (fattore 1,
// nessun effetto). Nessun consumer le chiama ancora in questa fase: la
// firma è già quella pensata per l'uso futuro (argomenti scalari minimi,
// stesso stile di TyreForceModel/TyreSlipModel), ma il corpo resta un
// placeholder finché la fase che le collega (1/2/4) non ne definisce la
// formula reale. Separazione voluta: downforce e drag sono contributi
// aerodinamici distinti (capacità laterale vs tetto di velocità), mai
// combinati fra loro in questo file.

// Contributo aero alla capacità laterale (downforce). Consultato da
// `effectiveGrip` (sotto) e, dalla Fase 2, anche da
// `CorneringGripModel.lateralExcess` in modo indipendente: i due consumer
// non si moltiplicano fra loro né uno legge l'output dell'altro (vedi
// spec, nota sul doppio conteggio).
function downforceFactor(speedFrac, isQuali) {
    return 1;
}

// Fattore drag longitudinale, concetto distinto dal downforce sopra.
// Dalla Fase 1, consultato da PowertrainModel.effectiveMaxSpeed.
function dragFactor(speedFrac, isQuali) {
    return 1;
}

// Formula pura della scia: gap dall'auto davanti (metri) -> fattore
// moltiplicativo. Dalla Fase 4, consultata da f1GameSocket.js (che resta
// responsabile di calcolare gapM tramite nearestAheadPlayer).
function slipstreamFactor(gapM) {
    return 1;
}
```

Aggiornare `module.exports`:

```js
module.exports = { GRIP, effectiveGrip, applyGripBlend, downforceFactor, dragFactor, slipstreamFactor };
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/AerodynamicsModel.test.js`
Expected: PASS su tutti i test (esistenti + nuovi).

- [ ] **Step 5: Verifica di non-regressione sull'intero gioco**

Run: `node --test backend/sockets/games/physics/`
Expected: PASS su tutta la suite fisica — nessuna funzione esistente è
stata modificata, solo aggiunte.

Run: `node --test backend/sockets/games/`
Expected: PASS su tutta la suite del gioco (`f1GameSocket`, `f1Bot`, ecc.)
— nessuno di questi moduli importa le nuove funzioni, quindi non possono
risentirne.

Verifica aggiuntiva (conferma che nessun consumer è stato toccato per
errore, dato che questa fase non usa un flag a protezione):

```bash
git diff --stat backend/sockets/games/physics/PowertrainModel.js backend/sockets/games/physics/CorneringGripModel.js backend/sockets/games/physics/VehiclePhysics.js backend/sockets/games/f1GameSocket.js backend/sockets/games/physics/DamageModel.js
```
Expected: nessun output (zero modifiche a questi file).

---

## Esito atteso di questa fase

`AerodynamicsModel.js` espone tre nuove funzioni pure, testate in
isolamento, non ancora collegate a nulla. Il gioco è bit-per-bit identico a
prima (nessun consumer nuovo, nessuna formula esistente toccata). Le fasi
successive (1: drag → `PowertrainModel`; 2: downforce → `effectiveGrip` +
`CorneringGripModel`; 3: danno aero → `DamageModel`; 4: migrazione scia →
`f1GameSocket`) collegheranno queste funzioni una alla volta, ciascuna con
il proprio piano e la propria validazione, secondo la roadmap della spec.

## Esito (2026-07-28)

Eseguita come da piano: 9/9 test, zero regressioni sulla suite fisica/gioco
esistente. Nessun consumer collegato in questa fase (verificato via
`git diff --stat` sui file consumer). Seguita da Fasi 1-4, tutte
implementate — vedi checkpoint in
`docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md`
("Stato finale — checkpoint").
