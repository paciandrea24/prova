# F1 — Settori, delta timer continuo, "Leader"/"Lap" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere 3 barre settore colorate + delta timer continuo (rosso/verde) nel pannello HUD del tempo, e sistemare "Leader"/"Lap" in classifica — tutto solo in fase `'race'`, mai in qualifica.

**Architecture:** Ogni giocatore accumula, giro per giro, una curva posizione→tempo (`Float32Array` indicizzata sull'indice-relativo-al-giro del tracciato). Questa curva alimenta sia il delta continuo del timer sia i 2 confini di settore (a 1/3 e 2/3 del giro) — un solo meccanismo condiviso, nessun sistema di cronometraggio parallelo. Il server calcola tutto e lo aggiunge ai campi già esistenti in `f1StateUpdate` (nessun nuovo evento socket); il client legge i campi del proprio colore e colora DOM esistente.

**Tech Stack:** Node.js (backend, `node:test` per gli unit test), vanilla JS/DOM (frontend, nessun framework di test — verifica manuale in localhost, unico pattern già in uso per `frontend/f1.js`).

## Global Constraints

- Solo fase `'race'`: mai attivare/mostrare nulla in qualifica (decisione utente, brainstorming 2026-08-07).
- Nessun nuovo evento socket: tutto dentro `f1StateUpdate`/`buildPublicState` esistente.
- Nessuna persistenza oltre la sessione di gara corrente (`game.bestSectorTimes` azzerato ad ogni reset di gara).
- Barre settore mostrate solo per il proprio pilota (`myColor`), mai per gli avversari.
- Tolleranza ~1 tick fisico (50ms) sui tempi di settore, esplicitamente accettata — nessuno sforzo di precisione sub-tick per i settori (solo il tempo finale di giro, invariato, resta sub-tick preciso via `computeFinishCrossingFraction`).
- Rif. spec completa: `docs/superpowers/specs/2026-08-07-f1-sector-timing-design.md`.

---

## Task 1: Classifica — "Leader" invece di distacco vuoto, "Giro" → "Lap"

Feature indipendente dal resto del piano (nessuna dipendenza da stato nuovo) — task d'apertura a basso rischio.

**Files:**
- Modify: `frontend/f1.html:19`
- Modify: `frontend/f1.js:1051-1062` (`renderStandingRowContent`)

**Interfaces:**
- Consumes: `d.position` (già presente in ogni entry di `f1StateUpdate`, `f1GameSocket.js:1530`).
- Produces: nessuna nuova interfaccia — solo markup.

- [ ] **Step 1: Cambia l'etichetta statica "Giro" → "Lap"**

In `frontend/f1.html`, riga 19:

```html
<span class="eyebrow">Giro</span>
```

diventa:

```html
<span class="eyebrow">Lap</span>
```

- [ ] **Step 2: Mostra "Leader" nello slot distacchi del primo in classifica**

In `frontend/f1.js`, dentro `renderStandingRowContent` (righe 1051-1062), cambia solo l'ultima riga del template:

```js
function renderStandingRowContent(rowEl, color, d) {
    const compoundLetter = { soft: 'S', medium: 'M', hard: 'H' }[d.compound] || '';
    const compoundColor = (tyreCompoundsInfo && tyreCompoundsInfo[d.compound] && tyreCompoundsInfo[d.compound].color) || '#888';
    rowEl.innerHTML = `
        <span class="pos">${d.position}</span>
        <span class="dot" style="background:${color};"></span>
        ${color === myColor ? 'TU' : ''}${d.isBot ? '<span class="bot-badge">CPU</span>' : ''}
        ${compoundLetter ? `<span class="compound-badge" style="color:${compoundColor};">${compoundLetter}</span>` : ''}
        ${(d.falseStart && !d.falseStartServed) ? '<span class="false-start-badge">!</span>' : ''}${d.collisionPenalty ? '<span class="false-start-badge collision-badge">!</span>' : ''}
        <span class="gap">${d.position === 1 ? 'Leader' : formatGap(d.gapToLeaderMs)}</span>
    `;
}
```

Nota: si usa `d.position === 1`, non `d.gapToLeaderMs == null` — quel campo resta `null` anche per TUTTI i piloti prima del primo ricalcolo (`f1GameSocket.js:308`), non solo per il leader. Usare `position` evita che tutti mostrino "Leader" per i primi istanti di gara.

- [ ] **Step 3: Verifica manuale in localhost**

Avviare il server (`node server.js` da `backend/`), due tab, portare una gara in fase `'race'`. Verificare: il primo in classifica mostra "Leader" al posto del distacco vuoto; gli altri mostrano ancora "+S.m"/"+M:SS.m" come prima; il chip in alto mostra "Lap X/Y" invece di "Giro X/Y".

- [ ] **Step 4: Commit**

```bash
git add frontend/f1.html frontend/f1.js
git commit -m "F1: classifica mostra Leader per il primo e Lap invece di Giro"
```

---

## Task 2: Backend — costanti settore, `fillGaps`, nuovo stato azzerato nei 3 reset esistenti

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js`
- Create: `backend/sockets/games/f1GameSocket.sectorTiming.test.js`

**Interfaces:**
- Consumes: `N_SAMPLES` (`f1GameSocket.js:1254`, esistente).
- Produces: `SECTOR1_REL_IDX`, `SECTOR2_REL_IDX` (costanti numeriche), `fillGaps(curve: Float32Array): Float32Array` (funzione pura), `game.bestSectorTimes: [number, number, number]` (azzerato a `[Infinity, Infinity, Infinity]`), e sui player: `p.curLapCurve: Float32Array|null`, `p.prevLapCurve: Float32Array|null`, `p.curLapSectorTimes: [number|null, number|null, number|null]`, `p.prevLapSectorTimes: [number,number,number]|null`, `p.deltaToPreviousLapMs: number|null`, `p.lapStartMs: number` (non azzerato qui — inizializzato al volo dal Task 3).

- [ ] **Step 1: Scrivi il test per `fillGaps` (fallirà: la funzione non esiste ancora)**

Crea `backend/sockets/games/f1GameSocket.sectorTiming.test.js`:

```js
// backend/sockets/games/f1GameSocket.sectorTiming.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const f1GameSocket = require('./f1GameSocket.js');

test('fillGaps: array senza buchi resta identico', () => {
    const { physics } = f1GameSocket;
    const curve = new Float32Array([0, 5, 10, 15]);
    const filled = physics.fillGaps(curve);
    assert.deepEqual(Array.from(filled), [0, 5, 10, 15]);
});

test('fillGaps: buco isolato tra due valori noti viene interpolato linearmente', () => {
    const { physics } = f1GameSocket;
    const curve = new Float32Array([0, -1, -1, 30]);
    const filled = physics.fillGaps(curve);
    assert.deepEqual(Array.from(filled), [0, 10, 20, 30]);
});

test('fillGaps: run iniziale di buchi (prima del primo valore noto) riempito a 0', () => {
    const { physics } = f1GameSocket;
    const curve = new Float32Array([-1, -1, 20]);
    const filled = physics.fillGaps(curve);
    assert.deepEqual(Array.from(filled), [0, 0, 20]);
});

test('fillGaps: run finale di buchi (dopo l\'ultimo valore noto) riempito a valore costante', () => {
    const { physics } = f1GameSocket;
    const curve = new Float32Array([0, 10, -1, -1]);
    const filled = physics.fillGaps(curve);
    assert.deepEqual(Array.from(filled), [0, 10, 10, 10]);
});

test('SECTOR1_REL_IDX/SECTOR2_REL_IDX: dividono N_SAMPLES=1000 in terzi', () => {
    const { physics } = f1GameSocket;
    assert.equal(physics.SECTOR1_REL_IDX, 333);
    assert.equal(physics.SECTOR2_REL_IDX, 667);
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Da `backend/`: `node --test sockets/games/f1GameSocket.sectorTiming.test.js`
Atteso: FAIL — `physics.fillGaps is not a function` / `physics.SECTOR1_REL_IDX` è `undefined`.

- [ ] **Step 3: Aggiungi le costanti e `fillGaps` in `f1GameSocket.js`**

Subito dopo la dichiarazione di `HALF_LAP_IDX` (`f1GameSocket.js:1255`):

```js
const HALF_LAP_IDX = Math.floor(N_SAMPLES / 2);
// Confini settore (Rif. docs/superpowers/specs/2026-08-07-f1-sector-timing-design.md):
// divisione puramente geometrica per indice campionato, identica per ogni
// pista. A differenza di HALF_LAP_IDX (offset da sommare a startFinishIndex
// per un indice ASSOLUTO in game.track.points), questi sono già indici
// RELATIVI all'inizio del giro corrente (0 = startFinishIndex) — vedi
// updateSectorTiming, che lavora nello spazio "indice-relativo-al-giro".
const SECTOR1_REL_IDX = Math.round(N_SAMPLES / 3);
const SECTOR2_REL_IDX = Math.round(2 * N_SAMPLES / 3);
```

Poi, vicino a `circularWithin`/`computeFinishCrossingFraction` (dopo la riga 1401, prima del commento `LAP CHECK` a riga 1403):

```js
// fillGaps: riempie i "buchi" (-1, indice del tracciato mai raggiunto in
// questo giro — tipico sui rettilinei ad alta velocità, dove si saltano
// 1-2 campioni tra un tick e l'altro su 1000 campioni/giro) con
// interpolazione lineare tra i due valori noti più vicini. Un run
// iniziale (prima del primo valore noto) prende 0 — il giro parte sempre
// da lì. Un run finale (dopo l'ultimo valore noto) prende il valore noto
// più vicino, costante — non c'è un valore successivo con cui
// interpolare prima del wraparound a fine giro. Chiamata una sola volta
// a fine giro (vedi checkLap), mai per tick.
function fillGaps(curve) {
    const n = curve.length;
    const out = new Float32Array(n);
    let lastKnownIdx = -1;
    let lastKnownVal = 0;
    for (let i = 0; i < n; i++) {
        if (curve[i] >= 0) {
            if (lastKnownIdx >= 0 && i - lastKnownIdx > 1) {
                const span = i - lastKnownIdx;
                for (let j = lastKnownIdx + 1; j < i; j++) {
                    const t = (j - lastKnownIdx) / span;
                    out[j] = lastKnownVal + (curve[i] - lastKnownVal) * t;
                }
            } else if (lastKnownIdx < 0 && i > 0) {
                for (let j = 0; j < i; j++) out[j] = 0;
            }
            out[i] = curve[i];
            lastKnownIdx = i;
            lastKnownVal = curve[i];
        }
    }
    if (lastKnownIdx >= 0 && lastKnownIdx < n - 1) {
        for (let j = lastKnownIdx + 1; j < n; j++) out[j] = lastKnownVal;
    }
    return out;
}
```

- [ ] **Step 4: Esporta le nuove primitive**

In `module.exports.physics` (`f1GameSocket.js:1619-1635`), aggiungi `SECTOR1_REL_IDX, SECTOR2_REL_IDX, fillGaps,` nella lista (es. subito dopo `HALF_LAP_IDX,` alla riga 1621).

- [ ] **Step 5: Esegui i test e verifica che passino**

`node --test sockets/games/f1GameSocket.sectorTiming.test.js` — atteso: 5/5 PASS.

- [ ] **Step 6: Scrivi il test per il reset di `assignGridSpawns`/`resetPlayers` (fallirà: i campi non vengono ancora azzerati)**

Aggiungi allo stesso file di test:

```js
function makeResettablePlayer(color) {
    return {
        color, damage: 0, collisionPenaltyMs: 0, pendingRepair: false,
        carContacts: new Set(), wallContact: false, pendingCollisionPenaltyEvents: [],
        finished: false, time: null, lap: 0, checkpointA: false, inFinishZone: false,
        trackIndex: 0, tyreWear: 0, pitGoTimer: null, pitting: false, pitPhase: null,
        pitGoTime: null, pendingCompound: null, hasPitted: false, pitPenalty: false,
        falseStart: false, falseStartServed: false, gapToLeaderMs: null,
        pitAutoState: null, pitPathIndex: 0, inputs: { throttle: 0, brake: 0, steer: 0 },
        // stato "sporco" di una gara precedente, da azzerare
        curLapCurve: new Float32Array(1000), prevLapCurve: new Float32Array(1000),
        curLapSectorTimes: [111, 222, 333], prevLapSectorTimes: [111, 222, 333],
        deltaToPreviousLapMs: 42
    };
}

test('assignGridSpawns: azzera lo stato settori/delta di una gara precedente', () => {
    const { physics } = f1GameSocket;
    const fakeTrack = {
        gridSpawnPoint: (i) => ({ x: i, z: 0, angle: 0 }),
        pitPath: [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 0 }],
        pitBoxIndex: 2
    };
    const p = makeResettablePlayer('red');
    const game = { grid: ['red'], players: { red: p }, track: fakeTrack };

    physics.assignGridSpawns(game);

    assert.equal(p.curLapCurve, null);
    assert.equal(p.prevLapCurve, null);
    assert.deepEqual(p.curLapSectorTimes, [null, null, null]);
    assert.equal(p.prevLapSectorTimes, null);
    assert.equal(p.deltaToPreviousLapMs, null);
    assert.deepEqual(game.bestSectorTimes, [Infinity, Infinity, Infinity]);
});

test('resetPlayers: azzera lo stesso stato settori/delta', () => {
    const { physics } = f1GameSocket;
    const fakeTrack = { gridSpawnPoint: (i) => ({ x: i, z: 0, angle: 0 }) };
    const p = makeResettablePlayer('red');
    const game = { players: { red: p }, track: fakeTrack };

    physics.resetPlayers(game);

    assert.equal(p.curLapCurve, null);
    assert.equal(p.prevLapCurve, null);
    assert.deepEqual(p.curLapSectorTimes, [null, null, null]);
    assert.equal(p.prevLapSectorTimes, null);
    assert.equal(p.deltaToPreviousLapMs, null);
    assert.deepEqual(game.bestSectorTimes, [Infinity, Infinity, Infinity]);
});
```

- [ ] **Step 7: Esegui i test e verifica che falliscano**

`node --test sockets/games/f1GameSocket.sectorTiming.test.js` — atteso: FAIL sui due nuovi test (`resetPlayers` non è nemmeno esportata ancora; i campi restano quelli "sporchi").

- [ ] **Step 8: Aggiungi il reset nei 3 punti esistenti**

In `startQualifying` (`f1GameSocket.js:599-605`), dentro il loop, dopo `p.lap = 0; p.checkpointA = false; p.inFinishZone = false;`:

```js
    for (const p of Object.values(game.players)) {
        p.x = game.track.qualiSpawn.x; p.z = game.track.qualiSpawn.z; p.angle = game.track.qualiSpawn.angle;
        p.speed = 0; p.vx = 0; p.vz = 0;
        p.finished = false; p.time = null;
        p.lap = 0; p.checkpointA = false; p.inFinishZone = false;
        p.curLapCurve = null; p.prevLapCurve = null;
        p.curLapSectorTimes = [null, null, null]; p.prevLapSectorTimes = null;
        p.deltaToPreviousLapMs = null;
        p.trackIndex = 0;
    }
```

E subito prima del loop (una volta sola, non per giocatore):

```js
    game.bestSectorTimes = [Infinity, Infinity, Infinity];
    for (const p of Object.values(game.players)) {
```

In `assignGridSpawns` (`f1GameSocket.js:728-748`), stessa cosa: `game.bestSectorTimes = [Infinity, Infinity, Infinity];` prima di `order.forEach(...)`, e dentro il forEach, dopo `p.lap = 0; p.checkpointA = false; p.inFinishZone = false;`:

```js
        p.curLapCurve = null; p.prevLapCurve = null;
        p.curLapSectorTimes = [null, null, null]; p.prevLapSectorTimes = null;
        p.deltaToPreviousLapMs = null;
```

In `resetPlayers` (`f1GameSocket.js:1598-1611`), stessa cosa: `game.bestSectorTimes = [Infinity, Infinity, Infinity];` come prima riga della funzione (prima di `let i = 0;`), e dentro il loop, dopo `p.lap = 0; p.checkpointA = false; p.inFinishZone = false;`:

```js
        p.curLapCurve = null; p.prevLapCurve = null;
        p.curLapSectorTimes = [null, null, null]; p.prevLapSectorTimes = null;
        p.deltaToPreviousLapMs = null;
```

- [ ] **Step 9: Esporta `resetPlayers`**

In `module.exports.physics`, aggiungi `resetPlayers,` (non è mai stata esportata finora — serve solo per il test appena scritto).

- [ ] **Step 10: Esegui i test e verifica che passino**

`node --test sockets/games/f1GameSocket.sectorTiming.test.js` — atteso: 7/7 PASS.

- [ ] **Step 11: Esegui l'intera suite backend per verificare nessuna regressione**

Da `backend/`: `node --test`
Atteso: tutti i test esistenti restano PASS (in particolare `f1GameSocket.physics.test.js`, che chiama `assignGridSpawns` con fixture che NON includono i nuovi campi — devono comunque passare, dato che i nuovi campi vengono solo scritti, mai letti in condizioni che potrebbero mancare).

- [ ] **Step 12: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js backend/sockets/games/f1GameSocket.sectorTiming.test.js
git commit -m "F1: costanti settore, fillGaps, reset stato settori/delta nei 3 punti esistenti"
```

---

## Task 3: Backend — `updateSectorTiming` (motore per-tick) + wiring in `tickGame`

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js`
- Test: `backend/sockets/games/f1GameSocket.sectorTiming.test.js`

**Interfaces:**
- Consumes: `SECTOR1_REL_IDX`/`SECTOR2_REL_IDX`/`game.bestSectorTimes` (Task 2), `p.trackIndex`/`game.track.startFinishIndex`/`game.raceTick`/`PHYSICS_TICK_MS` (esistenti).
- Produces: `updateSectorTiming(p, game): void` — scrive `p.curLapCurve`, `p.curLapSectorTimes`, `p.deltaToPreviousLapMs`, `p.lapStartMs`, aggiorna `game.bestSectorTimes[0]`/`[1]`. Consumata da Task 4 (chiusura giro in `checkLap`) e dal tick loop.

- [ ] **Step 1: Scrivi i test per `updateSectorTiming` (falliranno: la funzione non esiste)**

Aggiungi a `f1GameSocket.sectorTiming.test.js`:

```js
function makeSectorTrack(n = 1000) {
    return {
        points: Array.from({ length: n }, (_, i) => ({ x: i, z: 0 })),
        startFinishIndex: 0
    };
}

test('updateSectorTiming: fuori gara (fase qualifica) non tocca nulla', () => {
    const { physics } = f1GameSocket;
    const p = { trackIndex: 500, curLapCurve: null };
    const game = { phase: 'qualifying', track: makeSectorTrack(), raceTick: 10, bestSectorTimes: [Infinity, Infinity, Infinity] };
    physics.updateSectorTiming(p, game);
    assert.equal(p.curLapCurve, null, 'in qualifica non alloca mai la curva');
});

test('updateSectorTiming: primo tick in gara alloca la curva e ancora lapStartMs a ORA', () => {
    const { physics } = f1GameSocket;
    const p = { trackIndex: 0, curLapCurve: null, prevLapCurve: null };
    const game = { phase: 'race', track: makeSectorTrack(), raceTick: 40, bestSectorTimes: [Infinity, Infinity, Infinity] };
    physics.updateSectorTiming(p, game);
    assert.ok(p.curLapCurve instanceof Float32Array);
    assert.equal(p.lapStartMs, 40 * physics.PHYSICS_TICK_MS);
    assert.equal(p.deltaToPreviousLapMs, null, 'nessun giro precedente ancora');
});

test('updateSectorTiming: attraversare SECTOR1_REL_IDX chiude il settore 1 e aggiorna il record globale', () => {
    const { physics } = f1GameSocket;
    const p = { trackIndex: 0, curLapCurve: null, prevLapCurve: null };
    const game = { phase: 'race', track: makeSectorTrack(), raceTick: 0, bestSectorTimes: [Infinity, Infinity, Infinity] };
    physics.updateSectorTiming(p, game); // giro parte a tick 0

    game.raceTick = 10; // 500ms dopo (10 * 50ms)
    p.trackIndex = physics.SECTOR1_REL_IDX;
    physics.updateSectorTiming(p, game);

    assert.equal(p.curLapSectorTimes[0], 500);
    assert.equal(game.bestSectorTimes[0], 500);
    assert.equal(p.curLapSectorTimes[1], null, 'settore 2 non ancora raggiunto');
});

test('updateSectorTiming: attraversare SECTOR2_REL_IDX chiude il settore 2 come DIFFERENZA dal settore 1, non il cumulato', () => {
    const { physics } = f1GameSocket;
    const p = { trackIndex: 0, curLapCurve: null, prevLapCurve: null };
    const game = { phase: 'race', track: makeSectorTrack(), raceTick: 0, bestSectorTimes: [Infinity, Infinity, Infinity] };
    physics.updateSectorTiming(p, game);

    game.raceTick = 10; p.trackIndex = physics.SECTOR1_REL_IDX;
    physics.updateSectorTiming(p, game); // settore1 = 500ms

    game.raceTick = 30; p.trackIndex = physics.SECTOR2_REL_IDX;
    physics.updateSectorTiming(p, game); // cumulato 1500ms -> settore2 = 1500-500 = 1000ms

    assert.equal(p.curLapSectorTimes[1], 1000);
    assert.equal(game.bestSectorTimes[1], 1000);
});

test('updateSectorTiming: un record globale già basso NON viene peggiorato da un tempo più lento', () => {
    const { physics } = f1GameSocket;
    const p = { trackIndex: 0, curLapCurve: null, prevLapCurve: null };
    const game = { phase: 'race', track: makeSectorTrack(), raceTick: 0, bestSectorTimes: [200, Infinity, Infinity] };
    physics.updateSectorTiming(p, game); // priming: ancora lapStartMs a raceTick=0 (come negli altri test sopra)

    game.raceTick = 10; p.trackIndex = physics.SECTOR1_REL_IDX; // 500ms dopo, più lento del record 200
    physics.updateSectorTiming(p, game);
    assert.equal(game.bestSectorTimes[0], 200, 'il record esistente resta il più basso');
});

test('updateSectorTiming: con un giro precedente disponibile, calcola il delta continuo alla stessa posizione', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const prevCurve = new Float32Array(n).fill(0);
    prevCurve[100] = 5000; // nel giro precedente, indice 100 raggiunto a 5000ms
    const p = { trackIndex: 100, curLapCurve: null, prevLapCurve: prevCurve, lapStartMs: 0 };
    const game = { phase: 'race', track: makeSectorTrack(n), raceTick: 90, bestSectorTimes: [Infinity, Infinity, Infinity] }; // 4500ms trascorsi

    physics.updateSectorTiming(p, game);

    assert.equal(p.deltaToPreviousLapMs, 4500 - 5000, 'in anticipo di 500ms rispetto al giro precedente');
});
```

Nota: nel penultimo test `p.curLapCurve` parte `null` — la lazy-init del primo `updateSectorTiming` in gara sovrascriverebbe `p.lapStartMs`. Per isolare il calcolo del delta, il test imposta `p.curLapCurve: null` con `prevLapCurve` già presente: la lazy-init interna reimposterà `lapStartMs = raceTick * 50 = 4500` in QUEL tick, azzerando il delta atteso. Correggi il test pre-popolando anche `p.curLapCurve` con un array reale (non `null`) per bypassare la lazy-init e testare solo il calcolo del delta:

```js
test('updateSectorTiming: con un giro precedente disponibile, calcola il delta continuo alla stessa posizione', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const prevCurve = new Float32Array(n).fill(0);
    prevCurve[100] = 5000;
    const p = {
        trackIndex: 100,
        curLapCurve: new Float32Array(n).fill(-1),   // giro già in corso, niente lazy-init
        prevLapCurve: prevCurve,
        curLapSectorTimes: [null, null, null],
        lapStartMs: 0
    };
    const game = { phase: 'race', track: makeSectorTrack(n), raceTick: 90, bestSectorTimes: [Infinity, Infinity, Infinity] };

    physics.updateSectorTiming(p, game);

    assert.equal(p.deltaToPreviousLapMs, 4500 - 5000);
});
```

(Questa versione sostituisce quella sopra nel file di test — usa solo questa.)

- [ ] **Step 2: Esegui i test e verifica che falliscano**

`node --test sockets/games/f1GameSocket.sectorTiming.test.js` — atteso: FAIL, `physics.updateSectorTiming is not a function`.

- [ ] **Step 3: Implementa `updateSectorTiming`**

Aggiungi in `f1GameSocket.js`, subito prima di `function checkLap(...)` (riga 1411):

```js
// updateSectorTiming: aggiorna la curva posizione→tempo del giro corrente
// e ne deriva i due confini di settore + il delta continuo rispetto al
// giro precedente. Chiamata una volta per giocatore per tick, subito
// DOPO checkLap (Rif. tickGame) — così se checkLap ha appena chiuso un
// giro, questa funzione registra il primo campione del giro NUOVO nello
// stesso tick, invece di perderlo. Rif. design completo:
// docs/superpowers/specs/2026-08-07-f1-sector-timing-design.md.
function updateSectorTiming(p, game) {
    if (game.phase !== 'race') return;
    const n = game.track.points.length;
    const nowMs = game.raceTick * PHYSICS_TICK_MS;

    // Difensivo: giocatore entrato a gara già iniziata (mai passato da
    // assignGridSpawns/resetPlayers in questa sessione) — invece di un
    // quarto punto di reset speciale, il primo tick in gara vale come
    // inizio di un giro "proprio" per lui, da qui in poi identico a tutti.
    if (!p.curLapCurve) {
        p.curLapCurve = new Float32Array(n).fill(-1);
        p.curLapCurve[0] = 0;
        p.curLapSectorTimes = [null, null, null];
        p.lapStartMs = nowMs;
    }

    const startFinishIndex = game.track.startFinishIndex || 0;
    const relIdx = (p.trackIndex - startFinishIndex + n) % n;
    const lapElapsedMs = nowMs - p.lapStartMs;

    if (p.curLapCurve[relIdx] < 0) p.curLapCurve[relIdx] = lapElapsedMs;

    if (relIdx >= SECTOR1_REL_IDX && p.curLapSectorTimes[0] == null) {
        p.curLapSectorTimes[0] = lapElapsedMs;
        game.bestSectorTimes[0] = Math.min(game.bestSectorTimes[0], lapElapsedMs);
    }
    if (relIdx >= SECTOR2_REL_IDX && p.curLapSectorTimes[1] == null) {
        p.curLapSectorTimes[1] = lapElapsedMs - p.curLapSectorTimes[0];
        game.bestSectorTimes[1] = Math.min(game.bestSectorTimes[1], p.curLapSectorTimes[1]);
    }

    p.deltaToPreviousLapMs = p.prevLapCurve ? (lapElapsedMs - p.prevLapCurve[relIdx]) : null;
}
```

- [ ] **Step 4: Esporta `updateSectorTiming`**

In `module.exports.physics`, aggiungi `updateSectorTiming,` (es. vicino a `checkLap,` riga 1632).

- [ ] **Step 5: Esegui i test e verifica che passino**

`node --test sockets/games/f1GameSocket.sectorTiming.test.js` — atteso: tutti PASS.

- [ ] **Step 6: Aggancia `updateSectorTiming` nei due loop di `tickGame`**

In `f1GameSocket.js`, dentro `tickGame`, subito dopo la prima chiamata a `checkLap` (riga 1117, nel loop `for (const p of racing)`):

```js
        if (game.phase === 'race') applyTyreWear(p, offTrack, game.track);
        checkLap(p, totalLaps, io, lobbyId, game);
        updateSectorTiming(p, game);
```

E subito dopo la seconda chiamata a `checkLap` (riga 1137, nel loop `for (const p of autoPiloted)`):

```js
        checkLap(p, totalLaps, io, lobbyId, game);
        updateSectorTiming(p, game);
```

- [ ] **Step 7: Esegui l'intera suite backend per verificare nessuna regressione**

Da `backend/`: `node --test` — atteso: tutti i test esistenti restano PASS (nessuna funzione esistente modificata in questo task, solo due righe aggiunte in `tickGame`).

- [ ] **Step 8: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js backend/sockets/games/f1GameSocket.sectorTiming.test.js
git commit -m "F1: motore per-tick updateSectorTiming (curva posizione-tempo, settori, delta continuo)"
```

---

## Task 4: Backend — chiusura settori a fine giro (dentro `checkLap`)

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (funzione `checkLap`, righe 1411-1469)
- Test: `backend/sockets/games/f1GameSocket.sectorTiming.test.js`

**Interfaces:**
- Consumes: `p.curLapCurve`/`p.curLapSectorTimes`/`p.lapStartMs`/`game.bestSectorTimes` (Task 2/3), `computeFinishCrossingFraction` (esistente).
- Produces: a fine giro in gara, `p.prevLapCurve`/`p.prevLapSectorTimes` valorizzati con i dati del giro appena chiuso; `p.curLapCurve`/`p.curLapSectorTimes`/`p.lapStartMs` azzerati per il nuovo giro; `game.bestSectorTimes[2]` aggiornato.

- [ ] **Step 1: Scrivi il test per la chiusura settori a fine giro (fallirà: `checkLap` non lo fa ancora)**

Aggiungi a `f1GameSocket.sectorTiming.test.js`:

```js
test('checkLap: a fine giro in gara, chiude il settore 3 e promuove la curva/i settori a "giro precedente"', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
    const startFinishIndex = 300;
    const track = { points, lapLength: n, startFinishIndex };
    const curLapCurve = new Float32Array(n).fill(-1);
    const game = { track, raceTick: 20, phase: 'race', bestSectorTimes: [Infinity, Infinity, Infinity] };
    const io = { to: () => ({ emit: () => {} }) };

    const p = {
        color: 'red', lap: 0, checkpointA: true, inFinishZone: false,
        trackIndex: startFinishIndex,
        lapStartMs: 0,
        curLapCurve, curLapSectorTimes: [300, 400, null],   // settore1=300ms, settore2=400ms
        prevLapCurve: null, prevLapSectorTimes: null
    };
    physics.checkLap(p, 10, io, 'lobby1', game);

    assert.equal(p.lap, 1);
    // raceTick=20, nessun prevX/prevZ -> crossingElapsedMs = 20*50 = 1000ms (stesso fallback dei test esistenti)
    assert.deepEqual(p.prevLapSectorTimes, [300, 400, 1000 - 0 - 300 - 400]);
    assert.equal(game.bestSectorTimes[2], 300);   // 1000-300-400=300
    assert.ok(p.prevLapCurve instanceof Float32Array, 'la curva del giro chiuso diventa il riferimento');
    assert.notEqual(p.prevLapCurve, curLapCurve, 'prevLapCurve è passata da fillGaps, non lo stesso oggetto');
    assert.deepEqual(p.curLapSectorTimes, [null, null, null], 'settori azzerati per il nuovo giro');
    // raceTick=20, nessun prevX/prevZ -> crossingElapsedMs = 20*50 = 1000ms
    // (stesso fallback del test esistente "checkLap: senza prevX/prevZ...").
    // p.lap=1 < totalLaps=10 quindi p.time NON viene impostato in questo
    // giro (solo l'ultimo giro lo fa) — lapStartMs deve comunque ripartire
    // dal punto di attraversamento appena calcolato, non da p.time.
    assert.equal(p.lapStartMs, 1000, 'lapStartMs riparte dal punto di attraversamento appena calcolato');
});

test('checkLap: in qualifica (game.phase assente/diverso da race) NON tocca lo stato settori', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
    const startFinishIndex = 300;
    const track = { points, lapLength: n, startFinishIndex };
    const game = { track, raceTick: 20 };   // niente game.phase, come i test esistenti di checkLap
    const io = { to: () => ({ emit: () => {} }) };

    const p = { color: 'red', lap: 0, checkpointA: true, inFinishZone: false, trackIndex: startFinishIndex };
    physics.checkLap(p, 10, io, 'lobby1', game);

    assert.equal(p.lap, 1, 'il conteggio giri esistente resta invariato');
    assert.equal(p.curLapCurve, undefined, 'nessun campo settore scritto se non in game.phase === "race"');
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

`node --test sockets/games/f1GameSocket.sectorTiming.test.js` — atteso: FAIL sui due nuovi test (`p.prevLapSectorTimes` resta `null`).

- [ ] **Step 3: Modifica `checkLap`**

Sostituisci il corpo di `checkLap` (`f1GameSocket.js:1411-1469`) con:

```js
function checkLap(p, totalLaps, io, lobbyId, game) {
    const n = game.track.points.length;
    const idx = p.trackIndex || 0;
    const startFinishIndex = game.track.startFinishIndex || 0;

    if (!p.checkpointA && circularWithin(idx, (startFinishIndex + HALF_LAP_IDX) % n, n, checkpointWindowFor(game.track))) {
        p.checkpointA = true;
    }

    const inFinishZone = circularWithin(idx, startFinishIndex, n, finishWindowFor(game.track));
    if (p.checkpointA && inFinishZone && !p.inFinishZone) {
        // Il giocatore ha appena ENTRATO nella zona traguardo → giro completato
        p.lap++;
        p.checkpointA = false;
        console.log(`🏁 [F1] ${p.color} giro ${p.lap}/${totalLaps} (lobby ${lobbyId})`);

        // Frazione esatta di attraversamento (vedi computeFinishCrossingFraction):
        // calcolata una sola volta per giro, riusata sia dal tempo finale
        // (ultimo giro, sotto) sia dalla chiusura settori (Rif.
        // docs/superpowers/specs/2026-08-07-f1-sector-timing-design.md, ogni
        // giro in gara) — prima venivano ricalcolate due formule diverse per
        // lo stesso istante.
        const frac = computeFinishCrossingFraction(p, game.track, startFinishIndex);
        const crossingElapsedMs = Math.round((game.raceTick - 1 + frac) * PHYSICS_TICK_MS);

        if (p.lap >= totalLaps) {
            p.finished = true;
            p.time = crossingElapsedMs;
            // Obbligo di almeno un pit stop in gara (regola vera F1): chi non
            // ha mai cambiato gomme prende una penalità in tempo a fine gara,
            // non viene bloccato né squalificato.
            if (game.phase === 'race' && !p.hasPitted) {
                p.time += PIT_PENALTY_MS;
                p.pitPenalty = true;
            }
            // Rete di sicurezza: se la falsa partenza non è mai stata scontata
            // ai box (il giocatore non si è mai fermato), si somma comunque
            // qui al tempo finale — mai persa in silenzio.
            if (game.phase === 'race' && p.falseStart && !p.falseStartServed) {
                p.time += FALSE_START_PENALTY_MS;
                p.falseStartServed = true;
            }
            // Penalità collisioni: accumulo di TUTTI gli incidenti causati in
            // gara (non un flag singolo), già notificati live uno per uno
            // (vedi drenaggio in tickGame) — qui solo la somma finale.
            if (game.phase === 'race' && p.collisionPenaltyMs > 0) {
                p.time += p.collisionPenaltyMs;
            }
            // Timer di sicurezza di gruppo: dà agli altri il tempo di finire la
            // sessione (giro di qualifica o gara, entrambe corse in parallelo)
            // anche se qualcuno resta molto indietro senza essersi disconnesso
            // (la grazia copre solo i disconnessi). Uno per fase.
            if (game.phase === 'qualifying' && !game.qualiEndTimeout) {
                game.qualiEndTimeout = setTimeout(() => {
                    if (!game.qualiEnded) endQualifying(io, lobbyId, game);
                }, 60000);
            } else if (game.phase === 'race' && !game.endTimeout) {
                game.endTimeout = setTimeout(() => {
                    if (!game.raceEnded) endRace(io, lobbyId, game);
                }, 60000);
            }
        }

        // Chiusura settori (solo in gara, mai in qualifica): il settore 3 è
        // tutto ciò che resta del giro dopo i primi due; la curva
        // posizione→tempo appena chiusa diventa il riferimento per il
        // prossimo giro (delta continuo + confronto settore). `p.curLapCurve`
        // è sempre presente qui se `game.phase === 'race'` (allocata al
        // primo tick da updateSectorTiming, che gira prima di ogni lap
        // completo possibile) — il controllo resta comunque per sicurezza.
        if (game.phase === 'race' && p.curLapCurve) {
            const s1 = p.curLapSectorTimes[0] || 0;
            const s2 = p.curLapSectorTimes[1] || 0;
            const s3 = crossingElapsedMs - p.lapStartMs - s1 - s2;
            game.bestSectorTimes[2] = Math.min(game.bestSectorTimes[2], s3);
            p.prevLapSectorTimes = [p.curLapSectorTimes[0], p.curLapSectorTimes[1], s3];
            p.prevLapCurve = fillGaps(p.curLapCurve);
            p.curLapCurve = new Float32Array(n).fill(-1);
            p.curLapCurve[0] = 0;
            p.curLapSectorTimes = [null, null, null];
            p.lapStartMs = crossingElapsedMs;
        }

        io.to(lobbyId).emit('f1LapUpdate', { color: p.color, lap: p.lap, totalLaps, phase: game.phase });
    }
    p.inFinishZone = inFinishZone;
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

`node --test sockets/games/f1GameSocket.sectorTiming.test.js` — atteso: tutti PASS.

- [ ] **Step 5: Esegui l'intera suite backend per verificare nessuna regressione**

Da `backend/`: `node --test`
Atteso: tutti i test esistenti in `f1GameSocket.physics.test.js` (in particolare i 5 test `checkLap: ...` che verificano `p.time`/`p.lap`/`p.finished` senza mai impostare `game.phase`) restano PASS — la nuova logica di chiusura settori è dietro `game.phase === 'race' && p.curLapCurve`, sempre falso per quelle fixture.

- [ ] **Step 6: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js backend/sockets/games/f1GameSocket.sectorTiming.test.js
git commit -m "F1: checkLap chiude il settore 3 e promuove la curva/i settori a fine giro in gara"
```

---

## Task 5: Backend — nuovi campi nel broadcast (`buildPublicState`)

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (`buildPublicState`, righe 1499-1596)
- Test: `backend/sockets/games/f1GameSocket.sectorTiming.test.js`

**Interfaces:**
- Consumes: `p.curLapSectorTimes`/`p.prevLapSectorTimes`/`p.deltaToPreviousLapMs`/`game.bestSectorTimes` (Task 2-4).
- Produces: su ogni entry di `f1StateUpdate`: `sectorTimes: [number|null, number|null, number|null]`, `prevSectorTimes: [number,number,number]|null`, `bestSectorTimes: [number|null, number|null, number|null]`, `deltaToPreviousLapMs: number|null` — consumati dal frontend nel Task 7.

- [ ] **Step 1: Scrivi i test per i nuovi campi (falliranno: non esistono ancora in `buildPublicState`)**

Aggiungi a `f1GameSocket.sectorTiming.test.js`:

```js
function makeBroadcastPlayer(overrides = {}) {
    return {
        x: 0, z: 0, angle: 0, trackIndex: 0, speed: 0, finished: false, time: null, lap: 0,
        compound: 'medium', tyreWear: 0, damage: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        pitAutoState: null, falseStart: false, falseStartServed: false,
        gapToLeaderMs: null, isBot: false, inSlipstream: false,
        collisionPenaltyMs: 0,
        inputs: { throttle: 0, brake: 0, steer: 0 },
        ...overrides
    };
}

test('buildPublicState: fuori gara (phase assente), i campi settore/delta sono neutri', () => {
    const { physics } = f1GameSocket;
    const out = physics.buildPublicState({ red: makeBroadcastPlayer() }, false, null, { raceTick: 0 });
    assert.deepEqual(out.red.sectorTimes, [null, null, null]);
    assert.equal(out.red.prevSectorTimes, null);
    assert.deepEqual(out.red.bestSectorTimes, [null, null, null]);
    assert.equal(out.red.deltaToPreviousLapMs, null);
});

test('buildPublicState: in gara, espone i campi settore/delta reali del giocatore', () => {
    const { physics } = f1GameSocket;
    const p = makeBroadcastPlayer({
        curLapSectorTimes: [1200, null, null],
        prevLapSectorTimes: [1300, 2500, 3900],
        deltaToPreviousLapMs: -150
    });
    const game = { raceTick: 0, phase: 'race', bestSectorTimes: [1100, 2400, Infinity] };
    const out = physics.buildPublicState({ red: p }, false, null, game);

    assert.deepEqual(out.red.sectorTimes, [1200, null, null]);
    assert.deepEqual(out.red.prevSectorTimes, [1300, 2500, 3900]);
    assert.deepEqual(out.red.bestSectorTimes, [1100, 2400, null], 'Infinity convertito esplicitamente in null');
    assert.equal(out.red.deltaToPreviousLapMs, -150);
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

`node --test sockets/games/f1GameSocket.sectorTiming.test.js` — atteso: FAIL, `out.red.sectorTimes` è `undefined`.

- [ ] **Step 3: Aggiungi i campi in `buildPublicState`**

In `f1GameSocket.js`, dentro `out[color] = { ... }` (righe 1514-1593), subito dopo `gapToLeaderMs: (p.gapToLeaderMs != null) ? p.gapToLeaderMs : null,` (riga 1561):

```js
            gapToLeaderMs: (p.gapToLeaderMs != null) ? p.gapToLeaderMs : null,
            // Settori/delta (Rif. docs/superpowers/specs/2026-08-07-f1-sector-timing-design.md):
            // solo in gara, mai in qualifica — vedi updateSectorTiming/checkLap.
            // Infinity (nessun record ancora) convertito esplicitamente in
            // null: non è JSON-safe e non deve dipendere da un dettaglio del
            // serializzatore socket.io per arrivare "pulito" al client.
            sectorTimes: (game.phase === 'race' && p.curLapSectorTimes) ? p.curLapSectorTimes : [null, null, null],
            prevSectorTimes: (game.phase === 'race') ? (p.prevLapSectorTimes || null) : null,
            bestSectorTimes: (game.phase === 'race' && game.bestSectorTimes)
                ? game.bestSectorTimes.map(t => (t === Infinity ? null : t))
                : [null, null, null],
            deltaToPreviousLapMs: (game.phase === 'race' && p.deltaToPreviousLapMs != null) ? p.deltaToPreviousLapMs : null,
```

- [ ] **Step 4: Esegui i test e verifica che passino**

`node --test sockets/games/f1GameSocket.sectorTiming.test.js` — atteso: tutti PASS.

- [ ] **Step 5: Esegui l'intera suite backend per verificare nessuna regressione**

Da `backend/`: `node --test`
Atteso: tutti i test esistenti restano PASS, inclusi quelli in `f1GameSocket.broadcastState.test.js` che chiamano `buildPublicState` con `game = { raceTick: 0 }` (nessun `phase`) — i nuovi campi risultano neutri (`null`/`[null,null,null]`) e non vengono controllati da quei test, nessuna interferenza.

- [ ] **Step 6: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js backend/sockets/games/f1GameSocket.sectorTiming.test.js
git commit -m "F1: buildPublicState trasmette settori/delta nel payload f1StateUpdate esistente"
```

---

## Task 6: Frontend — markup e CSS delle 3 barre settore (scaffold statico)

Solo struttura/skin — nessuna logica colore ancora (arriva nel Task 7). Verifica manuale attesa in questo task: 3 barrette grigie visibili sotto il tempo ogni volta che il pannello timer è visibile (quindi anche in qualifica) — comportamento temporaneo, corretto solo dopo il Task 7.

**Files:**
- Modify: `frontend/f1.html`
- Modify: `frontend/styles/f1.css`

**Interfaces:**
- Consumes: nessuna.
- Produces: elementi DOM `#sector-bars`, `#sector-bar-1`, `#sector-bar-2`, `#sector-bar-3` e classi CSS `.yellow`/`.green`/`.best` — consumati dal Task 7.

- [ ] **Step 1: Aggiungi il markup sotto il tempo**

In `frontend/f1.html`, il blocco del pannello timer (righe 27-36) diventa:

```html
    <div class="hud f1-panel" id="timer-speed-panel" style="display:none;">
        <div class="col">
            <span class="eyebrow">Tempo</span>
            <span class="value" id="hud-timer">0:00.000</span>
            <div class="sector-bars" id="sector-bars" style="display:none;">
                <span class="sector-bar" id="sector-bar-1"></span>
                <span class="sector-bar" id="sector-bar-2"></span>
                <span class="sector-bar" id="sector-bar-3"></span>
            </div>
        </div>
        <div class="col">
            <span class="eyebrow">Velocità</span>
            <span class="value" id="speed-value">0</span><span class="unit">km/h</span>
        </div>
    </div>
```

- [ ] **Step 2: Aggiungi il colore fucsia alla palette esistente**

In `frontend/styles/f1.css`, dentro `:root` (righe 1-26), accanto agli altri colori piatti (`--yellow`, `--green`, `--red`, `--blue`, riga 3-6):

```css
:root {
    --border-color: #2C3E50;
    --yellow: #f1c40f;
    --green: #2ecc71;
    --red: #e74c3c;
    --blue: #3498db;
    --fucsia: #e91e8c;
```

- [ ] **Step 3: Aggiungi lo stile delle barrette**

In `frontend/styles/f1.css`, subito dopo il blocco `#timer-speed-panel .unit` (riga 195, prima del commento "overlay in attesa"):

```css
.sector-bars {
    display: flex;
    gap: 3px;
    margin-top: 5px;
    justify-content: flex-end;
}
.sector-bar {
    width: 22px;
    height: 5px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.16);
    transition: background-color 0.15s ease;
}
.sector-bar.yellow { background: var(--yellow); }
.sector-bar.green  { background: var(--green); }
.sector-bar.best   { background: var(--fucsia); }
```

- [ ] **Step 4: Bump cache-busting della CSS/JS (convenzione già in uso nel progetto)**

In `frontend/f1.html`, il tag `<link>` (riga 9) e lo script `f1.js` hanno un query param di versione (es. `?v=20260807b`, come già usato per invalidare la cache del browser dopo modifiche — vedi memoria `project_f1_timer_and_waiting_panel_fixes_2026-08-07`). Incrementa il suffisso (es. `?v=20260807c`) su entrambi i tag che referenziano `f1.css`/`f1.js`.

- [ ] **Step 5: Verifica manuale in localhost**

Avvia il server, apri una tab, entra in qualifica O in gara. Verificato: 3 barrette grigie compaiono sotto il tempo, allineate a destra, stessa larghezza pannello. Nessun errore console. (Atteso, non ancora corretto: le barrette sono visibili anche in qualifica — il Task 7 le nasconderà lì.)

- [ ] **Step 6: Commit**

```bash
git add frontend/f1.html frontend/styles/f1.css
git commit -m "F1: scaffold grafico delle 3 barre settore sotto il timer (nessuna logica colore ancora)"
```

---

## Task 7: Frontend — colori barre settore, colore delta timer, visibilità solo in gara

**Files:**
- Modify: `frontend/f1.js`

**Interfaces:**
- Consumes: `target.sectorTimes`/`target.prevSectorTimes`/`target.bestSectorTimes`/`target.deltaToPreviousLapMs` (Task 5, dentro ogni entry di `f1StateUpdate`), `currentPhase` (variabile di modulo esistente), elementi DOM del Task 6.
- Produces: nessuna nuova interfaccia — comportamento visivo finale.

- [ ] **Step 1: Dichiara lo stato locale per il delta**

In `frontend/f1.js`, accanto a `let myLiveElapsedMs = null;` (riga 437):

```js
    let myLiveElapsedMs = null;
    let myLiveElapsedSyncedAt = null;
    let myDeltaToPreviousLapMs = null;
```

- [ ] **Step 2: Azzera il nuovo stato negli stessi punti in cui si azzerano `myFinalTime`/`myLiveElapsedMs`**

In `frontend/f1.js`, riga 1194-1196 (handler `f1Countdown`):

```js
        myFinalTime = null;
        myLiveElapsedMs = null;
        myLiveElapsedSyncedAt = null;
        myDeltaToPreviousLapMs = null;
```

E riga 1262-1264 (handler successivo, avvio gara vera):

```js
        myFinalTime = null;
        myLiveElapsedMs = null;
        myLiveElapsedSyncedAt = null;
        myDeltaToPreviousLapMs = null;
```

- [ ] **Step 3: Aggiungi la funzione di colorazione barre settore**

In `frontend/f1.js`, vicino a `formatGap` (riga 1036), aggiungi:

```js
    // Colora le 3 barre settore in base ai dati del proprio giocatore
    // (mai per gli avversari — Rif. design). Priorità: fucsia (record di
    // sessione) > verde/giallo (confronto col proprio giro precedente) >
    // neutro (settore non ancora raggiunto in questo giro, o nessun
    // riferimento — primo giro in gara).
    function updateSectorBars(sectorTimes, prevSectorTimes, bestSectorTimes) {
        for (let i = 0; i < 3; i++) {
            const bar = document.getElementById(`sector-bar-${i + 1}`);
            if (!bar) continue;
            bar.classList.remove('yellow', 'green', 'best');
            const t = sectorTimes ? sectorTimes[i] : null;
            if (t == null) continue;
            const best = bestSectorTimes ? bestSectorTimes[i] : null;
            if (best != null && t <= best) {
                bar.classList.add('best');
            } else if (prevSectorTimes && prevSectorTimes[i] != null) {
                bar.classList.add(t < prevSectorTimes[i] ? 'green' : 'yellow');
            }
        }
    }
```

- [ ] **Step 4: Aggancia lettura dati + visibilità nel loop di stato**

In `frontend/f1.js`, dentro il blocco `if (color === myColor) { ... }` (righe 1913-1945), subito dopo la riga che aggiorna `myLiveElapsedMs`/`myLiveElapsedSyncedAt` (righe 1922-1925):

```js
                if (typeof target.elapsedMs === 'number' && target.elapsedMs !== myLiveElapsedMs) {
                    myLiveElapsedMs = target.elapsedMs;
                    myLiveElapsedSyncedAt = Date.now();
                }
                myDeltaToPreviousLapMs = (typeof target.deltaToPreviousLapMs === 'number') ? target.deltaToPreviousLapMs : null;
                const sectorBarsEl = document.getElementById('sector-bars');
                if (sectorBarsEl) sectorBarsEl.style.display = (currentPhase === 'race') ? 'flex' : 'none';
                if (currentPhase === 'race') {
                    updateSectorBars(target.sectorTimes, target.prevSectorTimes, target.bestSectorTimes);
                }
```

- [ ] **Step 5: Colora il timer in base al delta continuo**

In `frontend/f1.js`, righe 1959-1964, il blocco:

```js
            timerEl.style.color = myFinalTime !== null ? '#2ecc71' : '';
```

diventa:

```js
            // Verde/rosso durante il giro in base al delta continuo rispetto
            // al giro precedente (Rif. docs/superpowers/specs/2026-08-07-f1-sector-timing-design.md);
            // il verde fisso a giro concluso (myFinalTime) resta invariato e
            // ha priorità — non è mai sovrascritto dal delta.
            if (myFinalTime !== null) {
                timerEl.style.color = '#2ecc71';
            } else if (myDeltaToPreviousLapMs == null || myDeltaToPreviousLapMs === 0) {
                timerEl.style.color = '';
            } else {
                timerEl.style.color = myDeltaToPreviousLapMs < 0 ? 'var(--green)' : 'var(--red)';
            }
```

- [ ] **Step 6: Bump cache-busting**

Stesso pattern del Task 6 Step 4: incrementa ulteriormente il suffisso `?v=...` sul tag `<script>` di `f1.js` in `frontend/f1.html` (il file JS è cambiato, non la CSS in questo task).

- [ ] **Step 7: Verifica manuale in localhost — golden path**

Due tab, gara di almeno 2 giri completi. Verificare: le barrette restano grigie durante tutto il primo giro (nessun riferimento precedente); a partire dal secondo giro, ogni barretta si colora (giallo/verde) al passaggio dei due terzi/finale del settore corrispondente, confrontando col proprio giro precedente; il timer principale si colora di verde/rosso in modo fluido durante il giro in base a se si sta andando meglio/peggio del giro precedente; le barrette spariscono in qualifica (solo grigie/nessuna non doveva comparire lì) e ricompaiono in gara.

- [ ] **Step 8: Verifica manuale in localhost — caso fucsia**

Con due tab (o un bot competitivo), verificare che un settore diventi fucsia quando è il tempo di settore più basso registrato in quella gara tra tutti i piloti (bot inclusi), e che torni verde/giallo se un altro pilota batte successivamente quel record.

- [ ] **Step 9: Commit**

```bash
git add frontend/f1.js frontend/f1.html
git commit -m "F1: colora barre settore e timer principale in base a delta continuo e record di sessione"
```

---

## Self-Review (già eseguito in fase di stesura)

**Copertura spec:** le 4 feature della spec sono coperte — Task 1 (Leader/Lap), Task 2-3 (motore curva+settori), Task 4 (chiusura giro), Task 5 (broadcast), Task 6-7 (grafica+colori timer).

**Scan placeholder:** nessun TBD/TODO; ogni step ha codice completo, non descrizioni.

**Coerenza tipi/nomi:** `updateSectorTiming(p, game)` (Task 3) è lo stesso nome/firma usato in `checkLap` (Task 4, implicitamente, tramite gli stessi campi `p.curLapCurve`/`p.curLapSectorTimes`/`p.lapStartMs`) e in `tickGame` (Task 3, wiring). `sectorTimes`/`prevSectorTimes`/`bestSectorTimes`/`deltaToPreviousLapMs` sono gli stessi nomi in `buildPublicState` (Task 5) e nel consumo frontend (Task 7) — nessuna divergenza tra produttore e consumatore in nessun punto del piano.

**Nota su `startQualifying`:** il reset dei nuovi campi lì (Task 2, Step 8) non ha un test dedicato — la funzione non è mai stata esportata/testata prima di questo piano (side-effecting: `io.emit`, `setTimeout`), e il suo reset è comunque ridondante con `assignGridSpawns` (chiamata sempre prima che una nuova gara parta, Rif. spec "Contesto"). Aggiunto per simmetria col pattern esistente (`p.lap`/`checkpointA` resettati lì allo stesso modo), non per necessità funzionale — gap di test accettato consapevolmente, non un buco silenzioso.
