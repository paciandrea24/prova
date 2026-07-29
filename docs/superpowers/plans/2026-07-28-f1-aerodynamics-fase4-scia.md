# F1 — Fase 4: migrazione scia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dare a `AerodynamicsModel.slipstreamFactor` la formula reale
(placeholder Fase 0 → formula storica di `f1GameSocket.js`) e far sì che
`f1GameSocket.js` la consulti dietro flag, invece di ricalcolarla inline.
`f1GameSocket.js` resta proprietario di tutto il contesto gara (ricerca
gap, loop, esclusione qualifica, flag visivo).

**Scoperta in ricognizione (vedi messaggio in conversazione):**
`AerodynamicsModel.js` è foglia in `physics/` — non può importare le
costanti da `f1GameSocket.js` (invertirebbe le dipendenze). Le costanti
`SLIPSTREAM_RANGE_M`/`SLIPSTREAM_MAX_BOOST` vengono duplicate lì,
commentate esplicitamente. Per rendere il punto di innesto testabile senza
costruire un harness pesante per `tickGame` (che ha dipendenze `io`/
`game` non adatte a un test unitario — stesso motivo per cui
`f1LapSimulator.js` non chiama `tickGame` direttamente), la sola formula
(non la ricerca del gap) viene estratta in una funzione dedicata
`computeSlipstreamMult(gapM)`, esposta via `module.exports.physics`
(pattern già esistente in questo file).

**Architecture:** `AerodynamicsModel.js` possiede la formula
(`slipstreamFactor`) e il flag (`isAeroSlipstreamModelActive`) — stesso
schema di drag/downforce/danno. `f1GameSocket.js` consulta tramite la
nuova `computeSlipstreamMult(gapM)`, che sostituisce SOLO le due righe di
calcolo del moltiplicatore — `nearestAheadPlayer`, il loop `racing`, il
guard `if (!isQuali)` e `p.inSlipstream` restano esattamente dove sono,
invariati.

**Tech Stack:** Node.js, `node:test`/`node:assert/strict`.

## Global Constraints

- **Italiano** in commenti/comunicazioni (da CLAUDE.md di progetto).
- **Niente commit automatici**: l'utente fa commit/push manualmente.
- **Flag di confronto dedicato** `F1_AERO_SLIPSTREAM_MODEL`, spento di
  default — a flag spento, `computeSlipstreamMult` produce esattamente la
  stessa formula/valore di oggi.
- **Non spostare** la ricerca del gap (`nearestAheadPlayer`), il loop
  `racing`, il guard `if (!isQuali)`, o `p.inSlipstream` — restano in
  `f1GameSocket.js` esattamente come oggi.
- **Non toccare**: `dragFactor`, `downforceFactor`, `DamageModel.js`,
  `PowertrainModel.js`, `CorneringGripModel.js`, `SteeringModel.js`,
  `BrakingModel.js`, `f1Bot.js`, DRS (fuori scope).
- Riferimento: `docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md`.

---

### Task 1: `AerodynamicsModel.js` — formula scia reale + flag

**Files:**
- Modify: `backend/sockets/games/physics/AerodynamicsModel.js`
- Test: Modify `backend/sockets/games/physics/AerodynamicsModel.test.js`

**Interfaces:**
- Produces: `slipstreamFactor(gapM)` (formula reale, sostituisce
  placeholder Fase 0 — funzione PURA, nessun `isQuali`/`damageParts`),
  `isAeroSlipstreamModelActive() -> boolean`. Consumati da Task 2
  (`f1GameSocket.js`).

- [ ] **Step 1: Scrivere i test che falliscono / aggiornare quelli obsoleti**

Sostituire il test placeholder Fase 0 di `slipstreamFactor` in
`AerodynamicsModel.test.js` con:

```js
test('slipstreamFactor: gap >= SLIPSTREAM_RANGE_M (25) -> nessun effetto (fattore 1)', () => {
    assert.equal(slipstreamFactor(25), 1);
    assert.equal(slipstreamFactor(30), 1);
    assert.equal(slipstreamFactor(1000), 1);
});

test('slipstreamFactor: gap piccolo -> stesso boost della formula storica (closeness = 1 - gap/25, boost max 0.08)', () => {
    // gap=12.5 (metà del range): closeness=0.5, mult atteso = 1 + 0.5*0.08 = 1.04
    assert.ok(Math.abs(slipstreamFactor(12.5) - 1.04) < 1e-9);
    // gap=0 (a contatto): closeness=1, mult atteso = 1.08 (boost massimo)
    assert.ok(Math.abs(slipstreamFactor(0) - 1.08) < 1e-9);
});

test('slipstreamFactor: monotono decrescente al crescere del gap (più lontano = meno scia)', () => {
    assert.ok(slipstreamFactor(0) > slipstreamFactor(10));
    assert.ok(slipstreamFactor(10) > slipstreamFactor(20));
});

test('isAeroSlipstreamModelActive: di default (env var non impostata) è false', () => {
    assert.equal(process.env.F1_AERO_SLIPSTREAM_MODEL, undefined);
    assert.equal(isAeroSlipstreamModelActive(), false);
});
```

Aggiornare il require in cima aggiungendo `isAeroSlipstreamModelActive`.

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/AerodynamicsModel.test.js`
Expected: FAIL sui nuovi test valore/monotonia (placeholder ritorna
sempre 1), PASS su "gap >= 25" (già vero per il placeholder) e su
`isAeroSlipstreamModelActive` (non definita, quindi FAIL anche quella).

- [ ] **Step 3: Implementazione minima**

Sostituire in `AerodynamicsModel.js`:

```js
// Fase 4 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// prima formula reale della scia — stessa formula storica già in uso in
// f1GameSocket.js (SLIPSTREAM_RANGE_M/SLIPSTREAM_MAX_BOOST), qui
// riprodotta come funzione PURA (nessun isQuali: l'esclusione qualifica è
// contesto di gara, resta esclusivamente in f1GameSocket.js). Le due
// costanti sono duplicate deliberatamente — AerodynamicsModel.js è foglia
// in physics/, non può importare da f1GameSocket.js (invertirebbe la
// direzione delle dipendenze) — vanno mantenute in sync con le omonime
// in f1GameSocket.js per la durata del percorso di confronto.
const SLIPSTREAM_RANGE_M = 25;
const SLIPSTREAM_MAX_BOOST = 0.08;

function slipstreamFactor(gapM) {
    if (gapM >= SLIPSTREAM_RANGE_M) return 1;
    const closeness = 1 - gapM / SLIPSTREAM_RANGE_M;
    return 1 + closeness * SLIPSTREAM_MAX_BOOST;
}

// Flag di confronto Fase 4, dedicato e separato dagli altri — spento di
// default, comportamento bit-per-bit identico a oggi.
function isAeroSlipstreamModelActive() {
    return process.env.F1_AERO_SLIPSTREAM_MODEL === '1';
}
```

Aggiornare `module.exports` aggiungendo `isAeroSlipstreamModelActive`.

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/AerodynamicsModel.test.js`
Expected: PASS su tutti i test.

- [ ] **Step 5: Verifica**

Run: `node --test backend/sockets/games/physics/`
Expected: PASS (nessun consumer ancora collegato, Task 2 lo fa).

---

### Task 2: `f1GameSocket.js` — `computeSlipstreamMult` dietro flag

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js`
- Test: Modify `backend/sockets/games/f1GameSocket.physics.test.js`

**Interfaces:**
- Consumes: `AerodynamicsModel.slipstreamFactor`/
  `isAeroSlipstreamModelActive` (Task 1).
- Produces: `computeSlipstreamMult(gapM) -> number`, esposta via
  `module.exports.physics.computeSlipstreamMult` per test diretto.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in fondo a `f1GameSocket.physics.test.js`:

```js
const AerodynamicsModel = require('./physics/AerodynamicsModel');

test('computeSlipstreamMult: F1_AERO_SLIPSTREAM_MODEL non impostato -> formula storica invariata (gap=12.5 -> 1.04)', () => {
    assert.equal(process.env.F1_AERO_SLIPSTREAM_MODEL, undefined);
    const { physics } = require('./f1GameSocket.js');
    assert.ok(Math.abs(physics.computeSlipstreamMult(12.5) - 1.04) < 1e-9);
});

test('computeSlipstreamMult: F1_AERO_SLIPSTREAM_MODEL="1" -> stesso valore di AerodynamicsModel.slipstreamFactor(gapM)', () => {
    const { physics } = require('./f1GameSocket.js');
    process.env.F1_AERO_SLIPSTREAM_MODEL = '1';
    try {
        assert.equal(physics.computeSlipstreamMult(12.5), AerodynamicsModel.slipstreamFactor(12.5));
        assert.equal(physics.computeSlipstreamMult(0), AerodynamicsModel.slipstreamFactor(0));
    } finally {
        delete process.env.F1_AERO_SLIPSTREAM_MODEL;
    }
});

test('computeSlipstreamMult: F1_AERO_SLIPSTREAM_MODEL="1" -> delega DAVVERO a slipstreamFactor (spy, non una reimplementazione)', () => {
    const { physics } = require('./f1GameSocket.js');
    const orig = AerodynamicsModel.slipstreamFactor;
    let calls = 0;
    AerodynamicsModel.slipstreamFactor = (gapM) => { calls++; return 42; };
    process.env.F1_AERO_SLIPSTREAM_MODEL = '1';
    try {
        const result = physics.computeSlipstreamMult(12.5);
        assert.equal(calls, 1, 'atteso esattamente una chiamata a slipstreamFactor');
        assert.equal(result, 42, 'atteso il valore restituito dallo spy, non un ricalcolo locale');
    } finally {
        delete process.env.F1_AERO_SLIPSTREAM_MODEL;
        AerodynamicsModel.slipstreamFactor = orig;
    }
});

test('computeSlipstreamMult: gap grande (>= 25) a flag acceso -> nessun effetto', () => {
    const { physics } = require('./f1GameSocket.js');
    process.env.F1_AERO_SLIPSTREAM_MODEL = '1';
    try {
        assert.equal(physics.computeSlipstreamMult(30), 1);
    } finally {
        delete process.env.F1_AERO_SLIPSTREAM_MODEL;
    }
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/f1GameSocket.physics.test.js`
Expected: FAIL su tutti i nuovi test (`computeSlipstreamMult` non esiste
ancora in `physics`).

- [ ] **Step 3: Implementazione minima**

In `f1GameSocket.js`, aggiungere l'import (vicino agli altri require di
`physics/`):

```js
const AerodynamicsModel = require('./physics/AerodynamicsModel');
```

Aggiungere, vicino a `SLIPSTREAM_RANGE_M`/`SLIPSTREAM_MAX_BOOST`:

```js
// Fase 4 (percorso di confronto, F1_AERO_SLIPSTREAM_MODEL=1): SOLO il
// calcolo del moltiplicatore da un gap già noto — la ricerca del gap
// (nearestAheadPlayer), il loop, l'esclusione qualifica e il flag
// visivo p.inSlipstream restano nel tick loop sotto, invariati. A flag
// spento, formula storica invariata bit-per-bit; a flag acceso, delega a
// AerodynamicsModel.slipstreamFactor (unico proprietario del dominio
// aero) invece di ricalcolarla qui.
function computeSlipstreamMult(gapM) {
    return AerodynamicsModel.isAeroSlipstreamModelActive()
        ? AerodynamicsModel.slipstreamFactor(gapM)
        : 1 + (1 - gapM / SLIPSTREAM_RANGE_M) * SLIPSTREAM_MAX_BOOST;
}
```

Nel tick loop, sostituire SOLO le due righe di calcolo:

```js
        if (ahead && ahead.gapM < SLIPSTREAM_RANGE_M) {
            slipstreamMult = computeSlipstreamMult(ahead.gapM);
            p.inSlipstream = true;   // solo per il badge/effetto visivo lato client, vedi buildPublicState
        }
```

(il resto del blocco — `if (!isQuali)`, `nearestAheadPlayer`, il
`for (const p of racing)` — resta **esattamente com'è**, nessuna riga
spostata).

Aggiungere `computeSlipstreamMult` a `module.exports.physics`.

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/f1GameSocket.physics.test.js`
Expected: PASS su tutti i test.

- [ ] **Step 5: Verifica completa**

Run: `node --test backend/sockets/games/physics/`
Expected: PASS su tutta la suite fisica.

Run: `node --test backend/sockets/games/`
Expected: PASS a parte i 2 fallimenti pre-esistenti già noti
(`monte-rosso` targetKm, quali spawn).

Verifica di confine (nessun altro file toccato):
```bash
git diff --stat backend/sockets/games/physics/PowertrainModel.js backend/sockets/games/physics/CorneringGripModel.js backend/sockets/games/physics/DamageModel.js backend/sockets/games/physics/SteeringModel.js backend/sockets/games/physics/BrakingModel.js backend/sockets/games/f1Bot.js
```
Expected: nessun output.

Verifica esplicita che il guard qualifica non è stato toccato:
```bash
git diff backend/sockets/games/f1GameSocket.js | grep -A2 -B2 "isQuali"
```
Expected: nessuna riga di contesto `if (!isQuali)` nel diff (solo le due
righe di calcolo del moltiplicatore cambiano) — **verificato per
ispezione del diff, non con un test automatico**: l'esclusione qualifica
resta strutturalmente affidata al guard esistente, non duplicata in
questa fase.

---

## Esito atteso di questa fase

`AerodynamicsModel.slipstreamFactor` ha la formula reale (identica a
quella storica). `f1GameSocket.js` la consulta tramite
`computeSlipstreamMult` dietro `F1_AERO_SLIPSTREAM_MODEL` (spento di
default, output bit-identico in entrambi i casi). Nessuna modifica a
`nearestAheadPlayer`, al loop, al guard qualifica o al flag visivo. Drag,
downforce, danno aero invariati. DRS resta fuori scope (Fase 5, punto di
decisione futuro).

## Esito (2026-07-28)

Eseguita come da piano: 35/35 test in `AerodynamicsModel.test.js`, 31/31
in `f1GameSocket.physics.test.js`. Scoperta in esecuzione: la vecchia
formula inline non si autolimitava mai per `gap>=25` (funzionava solo
grazie al guard esterno del chiamante) — aggiunto un guard esplicito
dentro `computeSlipstreamMult` per renderla autosufficiente, zero impatto
sul comportamento reale (unico chiamante invariato). Confermata la delega
reale a `AerodynamicsModel.slipstreamFactor` con uno spy. Questo
completa la milestone Fase Aero (drag/downforce/danno/scia) — vedi
`docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md`
("Stato finale — checkpoint") per la verifica di integrazione tra i 4
flag e il piano playtest.
