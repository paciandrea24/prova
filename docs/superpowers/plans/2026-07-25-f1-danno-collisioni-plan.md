# F1 — danno da collisione, colpa/penalità, riparazione ai box Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introdurre un danno persistente (0-100%) da collisione auto-auto e auto-barriera in gara, con effetti a fasce su velocità/aderenza/sterzo, colpa+penalità di tempo per chi tampona, riparazione opzionale ai box (tempo extra proporzionale) e tutta la visibilità HUD associata — senza toccare la logica di guida/traiettoria dei bot.

**Architecture:** Estensione additiva della fisica esistente in `backend/sockets/games/f1GameSocket.js` (stesso pattern già usato per `tyreWear`): nuovi campi sull'oggetto giocatore, nuove funzioni pure esportate in `module.exports.physics` per testabilità offline (stesso meccanismo già usato da `f1LapSimulator.js`), rilevamento "nuovo contatto" innestato nelle funzioni di collisione già esistenti (`resolveCollisions`, `applyBridgeBarrier`) invece di un sistema di eventi parallelo. Gli eventi socket verso il client restano disaccoppiati dalla fisica pura tramite una coda per-giocatore (`pendingCollisionPenaltyEvents`) drenata da `tickGame`, che è l'unico punto con `io`/`lobbyId` in scope.

**Tech Stack:** Node.js, `node:test` (`node --test <file>.test.js`, stesso runner già in uso in `backend/sockets/games/*.test.js`), nessuna nuova dipendenza npm. Frontend: JS vanilla + anime.js (già in uso per le altre animazioni HUD).

## Global Constraints

- Danno e penalità si applicano **solo in gara** (`game.phase === 'race'`), mai in qualifica — stesso confine già usato per `applyTyreWear`. L'auto è sempre perfetta all'inizio di ogni gara.
- **Nessuna modifica alla logica di guida/traiettoria/sorpassi dei bot** — l'unica aggiunta lato bot è la scelta binaria "riparo se danno oltre soglia" ai box (Task 9).
- Penalità di tempo solo al colpevole di un urto auto-auto (mai alla vittima, mai per urti contro barriera).
- Riparazione ai box: scelta esplicita del giocatore, default **non riparare** se non si tocca nulla.
- Nessun commit/push automatico: per convenzione di progetto lo fa l'utente, quando vuole (vedi `CLAUDE.md`).
- Non rompere gli strumenti offline (`backend/tools/f1LapSimulator.js`, `backend/tools/f1RaceLineOptimizer.js`) che chiamano `physics.applyBridgeBarrier(p, track)` con 2 soli argomenti — il nuovo 3° parametro deve essere opzionale/sicuro se `undefined`.
- Spec di riferimento: `docs/superpowers/specs/2026-07-25-f1-danno-collisioni-design.md`.

---

## Task 1: Nuovi campi di stato giocatore

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js:282-313` (init giocatore umano, dentro `joinF1Game`)
- Modify: `backend/sockets/games/f1GameSocket.js:682-706` (`assignGridSpawns`, reset a inizio gara vera)
- Modify: `backend/sockets/games/f1GameSocket.js:1465-1471` (export `physics`, aggiungere `assignGridSpawns`)
- Modify: `backend/sockets/games/f1Bot.js:412-449` (init bot, dentro `createBots`)
- Test: `backend/sockets/games/f1GameSocket.physics.test.js`

**Interfaces:**
- Produces: ogni oggetto giocatore (umano o bot) ha da ora `damage` (number, 0-100), `collisionPenaltyMs` (number, accumulo), `pendingRepair` (bool), `carContacts` (Set&lt;string&gt;), `wallContact` (bool), `pendingCollisionPenaltyEvents` (array di number, ms). `physics.assignGridSpawns(game)` diventa chiamabile per i test.

- [ ] **Step 1: Aggiungere i campi all'init del giocatore umano**

In `backend/sockets/games/f1GameSocket.js`, dentro `socket.on('joinF1Game', ...)`, il blocco `game.players[playerColor] = { ... }` (righe 282-313) termina oggi con:

```js
                pitAutoState:    null,    // 'entering' | 'exiting' | null — autopilota corsia box
                pitPathIndex:    0,       // prossimo waypoint del percorso box (track.pitPath) verso cui puntare
                inSlipstream:    false,   // bonus di velocità in scia attivo in questo tick (solo effetto visivo lato client)
            };
```

Aggiungere prima della chiusura `};`:

```js
                pitAutoState:    null,    // 'entering' | 'exiting' | null — autopilota corsia box
                pitPathIndex:    0,       // prossimo waypoint del percorso box (track.pitPath) verso cui puntare
                inSlipstream:    false,   // bonus di velocità in scia attivo in questo tick (solo effetto visivo lato client)
                damage:                  0,       // 0-100, come tyreWear — solo in gara (vedi assignGridSpawns/checkLap)
                collisionPenaltyMs:      0,       // penalità di tempo accumulata per collisioni causate, sommata a p.time al traguardo
                pendingRepair:           false,   // scelta fatta ai box, applicata a fine sosta come pendingCompound
                carContacts:             new Set(),   // colori con cui è ATTUALMENTE a contatto (rileva un urto NUOVO)
                wallContact:             false,   // true se attualmente appoggiato a un muro ponte
                pendingCollisionPenaltyEvents: [],   // ms in attesa di notifica al client, drenata da tickGame
            };
```

- [ ] **Step 2: Aggiungere gli stessi campi all'init dei bot**

In `backend/sockets/games/f1Bot.js`, dentro `createBots`, il blocco `game.players[color] = { ... }` (righe 412-449) ha oggi, subito prima di `// --- campi solo-bot ---`:

```js
            pitAutoState:    null,
            pitPathIndex:    0,
            inSlipstream:    false,
            // --- campi solo-bot ---
```

Diventa:

```js
            pitAutoState:    null,
            pitPathIndex:    0,
            inSlipstream:    false,
            damage:                  0,
            collisionPenaltyMs:      0,
            pendingRepair:           false,
            carContacts:             new Set(),
            wallContact:             false,
            pendingCollisionPenaltyEvents: [],
            // --- campi solo-bot ---
```

- [ ] **Step 3: Reset a inizio gara vera in `assignGridSpawns`**

In `backend/sockets/games/f1GameSocket.js`, `assignGridSpawns` (righe 682-706) ha oggi:

```js
        p.tyreWear = 0;   // gomme fresche per la gara vera (l'usura conta solo in gara, non in qualifica)
        if (p.pitGoTimer) { clearTimeout(p.pitGoTimer); p.pitGoTimer = null; }
```

Diventa:

```js
        p.tyreWear = 0;   // gomme fresche per la gara vera (l'usura conta solo in gara, non in qualifica)
        p.damage = 0;   // auto perfetta a inizio gara vera — stesso confine di tyreWear
        p.collisionPenaltyMs = 0;
        p.pendingRepair = false;
        p.carContacts.clear();
        p.wallContact = false;
        p.pendingCollisionPenaltyEvents.length = 0;
        if (p.pitGoTimer) { clearTimeout(p.pitGoTimer); p.pitGoTimer = null; }
```

- [ ] **Step 4: Esportare `assignGridSpawns` per i test**

In `backend/sockets/games/f1GameSocket.js`, l'export `physics` (righe 1465-1471) ha oggi:

```js
module.exports.physics = {
    PHYSICS_TICK_MS, COLLISION_SUBSTEPS,
    ACCEL, BRAKE_MULT, TURN_SPEED_HIGH, HALF_LAP_IDX,
    effectiveMaxSpeed, updateVelocity, integratePosition,
    applyOffTrackDrag, applyBridgeBarrier, updateTrackIndex,
    circularWithin, checkpointWindowFor, finishWindowFor
};
```

Diventa (aggiunta in coda, resto invariato):

```js
module.exports.physics = {
    PHYSICS_TICK_MS, COLLISION_SUBSTEPS,
    ACCEL, BRAKE_MULT, TURN_SPEED_HIGH, HALF_LAP_IDX,
    effectiveMaxSpeed, updateVelocity, integratePosition,
    applyOffTrackDrag, applyBridgeBarrier, updateTrackIndex,
    circularWithin, checkpointWindowFor, finishWindowFor,
    assignGridSpawns
};
```

- [ ] **Step 5: Scrivere il test per il reset**

Aggiungere in fondo a `backend/sockets/games/f1GameSocket.physics.test.js`:

```js
test('assignGridSpawns: azzera damage/collisionPenaltyMs/pendingRepair/contatti a inizio gara vera', () => {
    const { physics } = f1GameSocket;
    const fakeTrack = { gridSpawnPoint: (i) => ({ x: i, z: 0, angle: 0 }) };
    const p = {
        color: 'red', damage: 42, collisionPenaltyMs: 3000, pendingRepair: true,
        carContacts: new Set(['blue']), wallContact: true,
        pendingCollisionPenaltyEvents: [500, 700],
        finished: false, time: null, lap: 0, checkpointA: false, inFinishZone: false,
        trackIndex: 0, tyreWear: 55, pitGoTimer: null, pitting: false, pitPhase: null,
        pitGoTime: null, pendingCompound: null, hasPitted: false, pitPenalty: false,
        falseStart: false, falseStartServed: false, gapToLeaderMs: null,
        pitAutoState: null, pitPathIndex: 0, inputs: { throttle: 0, brake: 0, steer: 0 }
    };
    const game = { grid: ['red'], players: { red: p }, track: fakeTrack };

    physics.assignGridSpawns(game);

    assert.equal(p.damage, 0);
    assert.equal(p.collisionPenaltyMs, 0);
    assert.equal(p.pendingRepair, false);
    assert.equal(p.carContacts.size, 0);
    assert.equal(p.wallContact, false);
    assert.equal(p.pendingCollisionPenaltyEvents.length, 0);
});
```

- [ ] **Step 6: Eseguire i test**

Run (da `backend/`): `node --test sockets/games/f1GameSocket.physics.test.js`

Expected: tutti i test passano, incluso il nuovo (`# fail 0`).

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole (vedi `CLAUDE.md`).

---

## Task 2: Funzioni pure di calcolo danno e penalità

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (nuove costanti + nuove funzioni, vicino a `applyTyreWear`, prima della sezione COLLISIONI)
- Modify: `backend/sockets/games/f1GameSocket.js:1465-1472` (export `physics`)
- Test: `backend/sockets/games/f1GameSocket.physics.test.js`

**Interfaces:**
- Consumes: nessuna (funzioni pure su oggetti giocatore semplici).
- Produces: `collisionDamageAmount(severity)`, `applyCarCollisionDamage(a, b, avn, bvn, closingRate)`, `applyBarrierDamage(p, vn)`, `applyCollisionPenalty(culprit, severity)` — usate da Task 3/4.

- [ ] **Step 1: Scrivere i test per le funzioni pure (prima dell'implementazione)**

Aggiungere in fondo a `backend/sockets/games/f1GameSocket.physics.test.js`:

```js
test('collisionDamageAmount: proporzionale alla severità, cappato a DAMAGE_CAP_PER_HIT', () => {
    const { physics } = f1GameSocket;
    assert.ok(Math.abs(physics.collisionDamageAmount(1) - 6) < 1e-9, 'atteso 6% a severità=1 (soglia)');
    assert.equal(physics.collisionDamageAmount(10), 25, 'atteso cap a 25%');
    assert.equal(physics.collisionDamageAmount(-10), 25, 'atteso valore assoluto, cap a 25%');
});

test('applyCarCollisionDamage: chi si avvicina di più è il colpevole, prende danno pieno + penalità; la vittima solo una frazione, nessuna penalità', () => {
    const { physics } = f1GameSocket;
    const a = { damage: 0, collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    const b = { damage: 0, collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    // a ferma (avn=0), b si avvicina forte (bvn=-5 => closingB=5)
    physics.applyCarCollisionDamage(a, b, 0, -5, 5);

    assert.equal(b.damage, 25, 'colpevole: danno pieno (cappato)');
    assert.ok(Math.abs(a.damage - 25 * 0.18) < 1e-9, 'vittima: solo la frazione');
    assert.ok(b.collisionPenaltyMs > 0, 'colpevole penalizzato');
    assert.equal(a.collisionPenaltyMs, 0, 'vittima mai penalizzata');
    assert.equal(b.pendingCollisionPenaltyEvents.length, 1, 'evento di notifica accodato per il colpevole');
});

test('applyBarrierDamage: solo danno, nessuna penalità, nessuna vittima', () => {
    const { physics } = f1GameSocket;
    const p = { damage: 10, collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    physics.applyBarrierDamage(p, 3);
    assert.ok(p.damage > 10, 'danno aumentato');
    assert.equal(p.collisionPenaltyMs, 0, 'nessuna penalità da barriera');
    assert.equal(p.pendingCollisionPenaltyEvents.length, 0);
});

test('applyCollisionPenalty: ms cappato a COLLISION_PENALTY_CAP_MS, accumula su più chiamate', () => {
    const { physics } = f1GameSocket;
    const p = { collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    physics.applyCollisionPenalty(p, 100);   // severità enorme, deve cappare
    assert.equal(p.collisionPenaltyMs, physics.COLLISION_PENALTY_CAP_MS);
    physics.applyCollisionPenalty(p, 1);   // severità minima valida (soglia)
    assert.ok(p.collisionPenaltyMs > physics.COLLISION_PENALTY_CAP_MS, 'seconda chiamata si accumula, non sostituisce');
    assert.equal(p.pendingCollisionPenaltyEvents.length, 2);
});

test('damage non supera mai 100', () => {
    const { physics } = f1GameSocket;
    const a = { damage: 95, collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    const b = { damage: 95, collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    physics.applyCarCollisionDamage(a, b, 0, -10, 10);
    assert.ok(b.damage <= 100 && a.damage <= 100);
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `node --test sockets/games/f1GameSocket.physics.test.js`

Expected: FAIL — `physics.collisionDamageAmount is not a function` (e le altre chiamate simili).

- [ ] **Step 3: Implementare le costanti e le funzioni**

In `backend/sockets/games/f1GameSocket.js`, subito dopo `applyTyreWear` (dopo la riga `if (offTrack) p.tyreWear = Math.min(100, p.tyreWear + WEAR_OFFTRACK_EXTRA);` e la sua chiusura `}`), aggiungere:

```js
// ====================================================
// DANNO DA COLLISIONE — modello unico 0-100%, come tyreWear. Si accumula
// SOLO in gara (le funzioni che lo applicano sono chiamate solo dai punti
// di resolveCollisions/applyBridgeBarrier già ristretti alla gara vera, vedi
// docs/superpowers/specs/2026-07-25-f1-danno-collisioni-design.md).
// ====================================================
const MIN_COLLISION_SEVERITY         = 1.0;   // sotto questa velocità di avvicinamento, nessun danno/penalità
const DAMAGE_PER_SEVERITY            = 6;     // % danno per unità di severità oltre soglia
const DAMAGE_CAP_PER_HIT             = 25;    // % danno massimo da un singolo urto
const VICTIM_DAMAGE_FRACTION         = 0.18;  // quota di danno che prende la vittima di un tamponamento
const COLLISION_PENALTY_PER_SEVERITY = 400;   // ms di penalità per unità di severità oltre soglia
const COLLISION_PENALTY_CAP_MS       = 5000;  // penalità massima da un singolo urto

function collisionDamageAmount(severity) {
    return Math.min(DAMAGE_CAP_PER_HIT, Math.abs(severity) * DAMAGE_PER_SEVERITY);
}

function applyCollisionPenalty(culprit, severity) {
    const ms = Math.min(COLLISION_PENALTY_CAP_MS, Math.abs(severity) * COLLISION_PENALTY_PER_SEVERITY);
    culprit.collisionPenaltyMs += ms;
    culprit.pendingCollisionPenaltyEvents.push(ms);   // drenata da tickGame per l'emit f1CollisionPenalty
}

// avn/bvn: componenti di velocità di a/b lungo la normale d'urto (orientata
// da a verso b, vedi resolveCollisions) — avn>0: a si avvicina a b; -bvn>0:
// b si avvicina ad a. Chi si avvicina di più è il colpevole. closingRate è
// la violenza totale dell'urto (somma dei due avvicinamenti), già filtrata
// da MIN_COLLISION_SEVERITY dal chiamante.
function applyCarCollisionDamage(a, b, avn, bvn, closingRate) {
    const closingA = avn, closingB = -bvn;
    const faultIsA = closingA >= closingB;
    const culprit = faultIsA ? a : b;
    const victim  = faultIsA ? b : a;

    const dmg = collisionDamageAmount(closingRate);
    culprit.damage = Math.min(100, culprit.damage + dmg);
    victim.damage  = Math.min(100, victim.damage + dmg * VICTIM_DAMAGE_FRACTION);

    applyCollisionPenalty(culprit, closingRate);
}

function applyBarrierDamage(p, vn) {
    p.damage = Math.min(100, p.damage + collisionDamageAmount(vn));
    // nessuna penalità: contro il muro ci si fa male da soli.
}
```

- [ ] **Step 4: Aggiornare l'export `physics`**

```js
module.exports.physics = {
    PHYSICS_TICK_MS, COLLISION_SUBSTEPS,
    ACCEL, BRAKE_MULT, TURN_SPEED_HIGH, HALF_LAP_IDX,
    effectiveMaxSpeed, updateVelocity, integratePosition,
    applyOffTrackDrag, applyBridgeBarrier, updateTrackIndex,
    circularWithin, checkpointWindowFor, finishWindowFor,
    assignGridSpawns,
    MIN_COLLISION_SEVERITY, DAMAGE_CAP_PER_HIT, COLLISION_PENALTY_CAP_MS,
    collisionDamageAmount, applyCarCollisionDamage, applyBarrierDamage, applyCollisionPenalty
};
```

- [ ] **Step 5: Eseguire i test**

Run: `node --test sockets/games/f1GameSocket.physics.test.js`

Expected: PASS su tutti i test (nuovi e vecchi).

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole (vedi `CLAUDE.md`).

---

## Task 3: Rilevamento nuovo contatto auto-auto in `resolveCollisions`

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js:1354-1399` (`resolveCollisions`)
- Modify: `backend/sockets/games/f1GameSocket.js` (export `physics`)
- Test: `backend/sockets/games/f1GameSocket.physics.test.js`

**Interfaces:**
- Consumes: `collisionDamageAmount`/`applyCarCollisionDamage` (Task 2), `p.carContacts` (Task 1).
- Produces: `resolveCollisions` (ora esportata) applica danno/penalità al primo contatto nuovo tra due auto, oltre soglia; il bump esistente resta identico.

- [ ] **Step 1: Scrivere il test (prima della modifica)**

Aggiungere in fondo a `backend/sockets/games/f1GameSocket.physics.test.js`:

```js
function makeCollisionPlayer(x, z, angle, vx, vz, color) {
    return {
        color, x, z, angle, vx, vz, speed: Math.hypot(vx, vz),
        damage: 0, collisionPenaltyMs: 0, carContacts: new Set(),
        pendingCollisionPenaltyEvents: []
    };
}

// Offset in z scelto perché il MTV (asse di overlap minimo) del SAT sia
// davvero l'asse z (direzione di marcia), non l'asse x (fianchi): con due
// auto quasi impilate (offset piccolo) l'overlap laterale (fianchi,
// CAR_HALF_WIDTH*2 = 3.48) è più piccolo di quello lungo z, e il rimbalzo
// verrebbe risolto lungo x — dove le velocità di questo test (tutte lungo
// z) hanno componente zero, mascherando qualunque urto. Con questo offset
// (3.7, appena sopra CAR_HALF_WIDTH*2) l'overlap lungo z scende sotto quello
// laterale e il SAT sceglie correttamente l'asse z.
test('resolveCollisions: nuovo urto violento applica danno al colpevole + penalità, danno minore alla vittima', () => {
    const { physics } = f1GameSocket;
    // a ferma, b arriva veloce lungo z e la centra in pieno (stesso orientamento, sovrapposte in x/z)
    const a = makeCollisionPlayer(0, 0, 0, 0, 0, 'a');
    const b = makeCollisionPlayer(0, -3.7, 0, 0, 8, 'b');   // avvicinamento forte lungo z

    physics.resolveCollisions([a, b]);

    assert.ok(b.damage > 0, 'colpevole danneggiato');
    assert.ok(a.damage > 0, 'vittima comunque danneggiata (frazione minore)');
    assert.ok(a.damage < b.damage, 'la vittima prende meno danno del colpevole');
    assert.ok(b.collisionPenaltyMs > 0, 'colpevole penalizzato');
    assert.equal(a.collisionPenaltyMs, 0, 'vittima mai penalizzata');
});

test('resolveCollisions: stesso contatto sostenuto per più tick NON riapplica danno (evento singolo)', () => {
    const { physics } = f1GameSocket;
    const a = makeCollisionPlayer(0, 0, 0, 0, 0, 'a');
    const b = makeCollisionPlayer(0, -3.7, 0, 0, 8, 'b');

    physics.resolveCollisions([a, b]);
    const damageAfterFirst = b.damage;
    physics.resolveCollisions([a, b]);   // stesso stato, ancora sovrapposte: nessun nuovo evento

    assert.equal(b.damage, damageAfterFirst, 'nessun danno aggiuntivo finché il contatto resta lo stesso');
});

test('resolveCollisions: contatto leggero sotto soglia non danneggia nessuno', () => {
    const { physics } = f1GameSocket;
    const a = makeCollisionPlayer(0, 0, 0, 0, 0, 'a');
    const b = makeCollisionPlayer(0, -3.7, 0, 0, 0.05, 'b');   // avvicinamento quasi nullo, stesso asse z del test sopra

    physics.resolveCollisions([a, b]);

    assert.equal(a.damage, 0);
    assert.equal(b.damage, 0);
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `node --test sockets/games/f1GameSocket.physics.test.js`

Expected: FAIL — `physics.resolveCollisions is not a function` (non ancora esportata), oppure danni sempre 0 se già esportata a vuoto.

- [ ] **Step 3: Modificare `resolveCollisions`**

Testo attuale (righe 1354-1399):

```js
function resolveCollisions(players) {
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const a = players[i], b = players[j];

            const dx = b.x - a.x, dz = b.z - a.z;
            if (dx * dx + dz * dz > CAR_MAX_REACH * CAR_MAX_REACH) continue;   // troppo distanti, salta il SAT

            const axesA = carAxes(a);
            const axesB = carAxes(b);
            const axes  = [axesA.forward, axesA.right, axesB.forward, axesB.right];

            let minOverlap = Infinity;
            let mtvAxis    = null;

            let separated = false;
            for (const axis of axes) {
                const pa = projectOBB(a, axesA, axis);
                const pb = projectOBB(b, axesB, axis);
                const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
                if (overlap <= 0) { separated = true; break; }
                if (overlap < minOverlap) { minOverlap = overlap; mtvAxis = axis; }
            }
            if (separated) continue;

            // Normale dell'MTV, orientata da a verso b
            let nx = mtvAxis.x, nz = mtvAxis.z;
            if (dx * nx + dz * nz < 0) { nx = -nx; nz = -nz; }

            // Separazione posizionale: metà per uno, per non compenetrarsi
            const push = minOverlap * 0.5;
            a.x -= nx * push; a.z -= nz * push;
            b.x += nx * push; b.z += nz * push;

            // Impulso solo se si stanno avvicinando lungo la normale
            const avn = a.vx * nx + a.vz * nz;
            const bvn = b.vx * nx + b.vz * nz;
            const rel = bvn - avn;
            if (rel < 0) {
                const delta = rel * COLLISION_BOUNCE;
                a.vx += nx * delta; a.vz += nz * delta;
                b.vx -= nx * delta; b.vz -= nz * delta;
            }
        }
    }
}
```

Diventa:

```js
function resolveCollisions(players) {
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const a = players[i], b = players[j];

            const dx = b.x - a.x, dz = b.z - a.z;
            if (dx * dx + dz * dz > CAR_MAX_REACH * CAR_MAX_REACH) {
                a.carContacts.delete(b.color); b.carContacts.delete(a.color);
                continue;   // troppo distanti, salta il SAT
            }

            const axesA = carAxes(a);
            const axesB = carAxes(b);
            const axes  = [axesA.forward, axesA.right, axesB.forward, axesB.right];

            let minOverlap = Infinity;
            let mtvAxis    = null;

            let separated = false;
            for (const axis of axes) {
                const pa = projectOBB(a, axesA, axis);
                const pb = projectOBB(b, axesB, axis);
                const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
                if (overlap <= 0) { separated = true; break; }
                if (overlap < minOverlap) { minOverlap = overlap; mtvAxis = axis; }
            }
            if (separated) {
                a.carContacts.delete(b.color); b.carContacts.delete(a.color);
                continue;
            }

            // Normale dell'MTV, orientata da a verso b
            let nx = mtvAxis.x, nz = mtvAxis.z;
            if (dx * nx + dz * nz < 0) { nx = -nx; nz = -nz; }

            // Separazione posizionale: metà per uno, per non compenetrarsi
            const push = minOverlap * 0.5;
            a.x -= nx * push; a.z -= nz * push;
            b.x += nx * push; b.z += nz * push;

            // Impulso solo se si stanno avvicinando lungo la normale
            const avn = a.vx * nx + a.vz * nz;
            const bvn = b.vx * nx + b.vz * nz;
            const rel = bvn - avn;

            // Danno/penalità SOLO al primo contatto (transizione da "non a
            // contatto" a "a contatto"): uno struscio prolungato non deve
            // riaccumulare danno ad ogni sotto-step. Nota: resolveCollisions
            // è chiamata solo `if (!isQuali)` in tickGame, quindi tutto qui
            // è già implicitamente "solo in gara" — nessun controllo fase
            // aggiuntivo necessario.
            const wasInContact = a.carContacts.has(b.color);
            if (!wasInContact) {
                a.carContacts.add(b.color);
                b.carContacts.add(a.color);

                const closingRate = -rel;   // violenza totale dell'urto (rel<0 = si avvicinano)
                if (closingRate >= MIN_COLLISION_SEVERITY) {
                    applyCarCollisionDamage(a, b, avn, bvn, closingRate);
                }
            }

            if (rel < 0) {
                const delta = rel * COLLISION_BOUNCE;
                a.vx += nx * delta; a.vz += nz * delta;
                b.vx -= nx * delta; b.vz -= nz * delta;
            }
        }
    }
}
```

- [ ] **Step 4: Aggiungere `resolveCollisions` all'export `physics`**

Nell'oggetto `module.exports.physics` (Task 2), aggiungere `resolveCollisions` alla lista.

- [ ] **Step 5: Eseguire i test**

Run: `node --test sockets/games/f1GameSocket.physics.test.js`

Expected: PASS su tutti (nuovi e vecchi) — in particolare verificare che i test già esistenti su `resolveCollisions` indiretti (nessuno oggi, ma il bump fisico) restino invariati: nessuna assert su velocità pre-esistente da rompere.

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole (vedi `CLAUDE.md`).

---

## Task 4: Rilevamento nuovo contatto con barriera in `applyBridgeBarrier`

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js:1251-1312` (`applyBridgeBarrier`)
- Modify: `backend/sockets/games/f1GameSocket.js:940` (call site in `tickGame`)
- Test: `backend/sockets/games/f1GameSocket.physics.test.js`

**Interfaces:**
- Consumes: `applyBarrierDamage` (Task 2), `p.wallContact` (Task 1).
- Produces: `applyBridgeBarrier(p, track, isRace)` — 3° parametro opzionale, retrocompatibile con le chiamate esistenti a 2 argomenti da `f1LapSimulator.js`/`f1RaceLineOptimizer.js` (che non passano mai danno, comportamento identico a oggi).

- [ ] **Step 1: Scrivere il test (prima della modifica)**

Aggiungere in fondo a `backend/sockets/games/f1GameSocket.physics.test.js`:

```js
function makeBarrierTrack() {
    // 3 punti allineati lungo z (bridge:true): servono almeno 3 punti perché
    // normalAt/tangentAt calcolino una tangente/normale reale dal vicino
    // precedente/successivo — con un solo punto la tangente sarebbe (0,0)
    // (degenere) e vn sarebbe sempre 0, mascherando qualunque danno a
    // prescindere dalla logica sotto test. Con questi 3 punti, il punto più
    // vicino a (15,0) è l'indice 1 (0,0), e la tangente lì punta lungo z →
    // normale lungo x, coerente con uno sconfinamento laterale in x.
    return {
        points: [
            { x: 0, z: -10, bridge: true },
            { x: 0, z: 0,   bridge: true },
            { x: 0, z: 10,  bridge: true }
        ],
        roadHalf: 10
    };
}

test('applyBridgeBarrier: nuovo urto contro il muro in gara applica danno (nessuna penalità)', () => {
    const { physics } = f1GameSocket;
    const track = makeBarrierTrack();
    // Fuori dal limite (roadHalf + margine), spinta forte verso l'esterno lungo x.
    const p = {
        x: 15, z: 0, angle: 0, speed: 8, vx: 8, vz: 0,
        trackIndex: 0, wallContact: false, damage: 0, collisionPenaltyMs: 0,
        pendingCollisionPenaltyEvents: []
    };

    physics.applyBridgeBarrier(p, track, true);

    assert.ok(p.damage > 0, 'atteso danno da impatto col muro');
    assert.equal(p.collisionPenaltyMs, 0, 'nessuna penalità da barriera');
});

test('applyBridgeBarrier: in qualifica (isRace=false) il muro frena comunque ma non danneggia', () => {
    const { physics } = f1GameSocket;
    const track = makeBarrierTrack();
    const p = {
        x: 15, z: 0, angle: 0, speed: 8, vx: 8, vz: 0,
        trackIndex: 0, wallContact: false, damage: 0, collisionPenaltyMs: 0,
        pendingCollisionPenaltyEvents: []
    };

    physics.applyBridgeBarrier(p, track, false);

    assert.equal(p.damage, 0, 'nessun danno in qualifica');
    assert.ok(p.x < 15, 'il muro riporta comunque la posizione sul bordo (fisica invariata)');
});

test('applyBridgeBarrier: senza 3° argomento (retrocompatibile con f1LapSimulator/f1RaceLineOptimizer) non lancia e non danneggia', () => {
    const { physics } = f1GameSocket;
    const track = makeBarrierTrack();
    const p = {
        x: 15, z: 0, angle: 0, speed: 8, vx: 8, vz: 0,
        trackIndex: 0, wallContact: false, damage: 0, collisionPenaltyMs: 0,
        pendingCollisionPenaltyEvents: []
    };

    assert.doesNotThrow(() => physics.applyBridgeBarrier(p, track));
    assert.equal(p.damage, 0);
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `node --test sockets/games/f1GameSocket.physics.test.js`

Expected: FAIL sui primi due nuovi test (danno sempre 0, `applyBridgeBarrier` non riceve/usa ancora il 3° parametro).

- [ ] **Step 3: Modificare `applyBridgeBarrier`**

Testo attuale (righe 1251-1312), i punti da cambiare:

```js
function applyBridgeBarrier(p, track) {
    const idx = TrackGeometry.nearestIndexNear(track.points, p.trackIndex || 0, p.x, p.z, TRACK_INDEX_WINDOW);
    const pt = track.points[idx];
    if (!pt.bridge) return;

    const dx = p.x - pt.x, dz = p.z - pt.z;
    const dist = Math.hypot(dx, dz);
    const limit = track.roadHalf + BRIDGE_BARRIER_MARGIN;

    if (dist <= limit) return;
```

Diventa:

```js
function applyBridgeBarrier(p, track, isRace) {
    const idx = TrackGeometry.nearestIndexNear(track.points, p.trackIndex || 0, p.x, p.z, TRACK_INDEX_WINDOW);
    const pt = track.points[idx];
    if (!pt.bridge) return;

    const dx = p.x - pt.x, dz = p.z - pt.z;
    const dist = Math.hypot(dx, dz);
    const limit = track.roadHalf + BRIDGE_BARRIER_MARGIN;

    if (dist <= limit) {
        p.wallContact = false;
        return;
    }
```

Poi, subito dopo il calcolo di `vn` esistente (`const vn = p.vx * wallNx + p.vz * wallNz;`) e la sua gestione (`if (vn > 0) { ... }`), prima del blocco di attrito continuo (`const contactKeep = ...`), inserire il rilevamento nuovo contatto:

```js
    const vn = p.vx * wallNx + p.vz * wallNz;
    if (vn > 0) {
        const remove = vn * BRIDGE_BARRIER_SLOWDOWN;
        p.vx -= wallNx * remove;
        p.vz -= wallNz * remove;
    }

    if (!p.wallContact) {
        p.wallContact = true;
        if (isRace && Math.abs(vn) >= MIN_COLLISION_SEVERITY) {
            applyBarrierDamage(p, vn);
        }
    }

    // Attrito continuo mentre l'auto resta appoggiata al muro...
    const contactKeep = 1 - BRIDGE_BARRIER_CONTACT_DRAG;
```

(Il resto della funzione, incluso il resync di `p.speed` finale, resta invariato.)

- [ ] **Step 4: Aggiornare il call site in `tickGame`**

Riga 940 oggi:

```js
        for (const p of racing) applyBridgeBarrier(p, game.track);
```

Diventa (usa `isQuali`, già calcolato in `tickGame` riga 897):

```js
        for (const p of racing) applyBridgeBarrier(p, game.track, !isQuali);
```

- [ ] **Step 5: Eseguire i test**

Run: `node --test sockets/games/f1GameSocket.physics.test.js`

Expected: PASS su tutti.

- [ ] **Step 6: Verificare che gli strumenti offline non si rompano**

Run (da `backend/`): `node --test tools/f1LapSimulator.test.js`

Expected: PASS su tutti (stesso esito di prima — questi strumenti chiamano `applyBridgeBarrier(p, track)` a 2 argomenti, `isRace` è `undefined` → falsy → nessun danno mai applicato, fisica del muro identica a prima).

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole (vedi `CLAUDE.md`).

---

## Task 5: Penalità sommata al tempo finale + drenaggio notifiche live

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (`checkLap`, dentro il blocco `if (p.lap >= totalLaps)`)
- Modify: `backend/sockets/games/f1GameSocket.js:942-957` (`tickGame`, dopo il loop di sotto-step)

**Interfaces:**
- Consumes: `p.collisionPenaltyMs`, `p.pendingCollisionPenaltyEvents` (Task 1/2/3).
- Produces: al traguardo, `p.time` include la penalità collisioni; il client riceve un evento `f1CollisionPenalty` per ciascun incidente causato, non solo a fine gara.

- [ ] **Step 1: Sommare la penalità in `checkLap`**

In `backend/sockets/games/f1GameSocket.js`, `checkLap` ha oggi, dentro `if (p.lap >= totalLaps)`:

```js
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
```

Diventa (aggiunta dopo il blocco falsa partenza):

```js
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
```

- [ ] **Step 2: Drenare le notifiche live in `tickGame`**

In `backend/sockets/games/f1GameSocket.js`, `tickGame` ha oggi, subito dopo il loop dei sotto-step (righe 942-957 circa):

```js
    for (const p of racing) {
        const offTrack = applyOffTrackDrag(p, game.track);
        updateTrackIndex(p, game.track);
```

Aggiungere PRIMA di questo blocco (subito dopo la chiusura del `for (let s = 0; s < COLLISION_SUBSTEPS; s++) { ... }`):

```js
    // Notifica live di ogni penalità da collisione appena accumulata (Task 2/3):
    // una alla volta, nell'ordine in cui sono avvenute nel tick — la coda
    // resta quasi sempre vuota (0-1 elementi), niente di costoso qui.
    for (const p of players) {
        if (!p.pendingCollisionPenaltyEvents.length) continue;
        for (const penaltyMs of p.pendingCollisionPenaltyEvents) {
            io.to(lobbyId).emit('f1CollisionPenalty', {
                color: p.color, penaltyMs, totalMs: p.collisionPenaltyMs
            });
        }
        p.pendingCollisionPenaltyEvents.length = 0;
    }

    for (const p of racing) {
        const offTrack = applyOffTrackDrag(p, game.track);
        updateTrackIndex(p, game.track);
```

- [ ] **Step 3: Verifica manuale in localhost**

Avviare il server (`node server.js` da `backend/`), aprire due tab, forzare un tamponamento violento in gara. Verificare nella console del browser (o con un log temporaneo) che arrivi un evento `f1CollisionPenalty` con `penaltyMs`/`totalMs` coerenti, e che a fine gara il tempo finale del colpevole includa quella penalità (confrontare col tempo mostrato durante la gara, che non la include ancora). Nessun test automatico qui: `tickGame`/`checkLap` dipendono da `io`/timer reali, coerente con come sono già trattate `PIT_PENALTY_MS`/`FALSE_START_PENALTY_MS` in questo codebase (nessun test unitario neanche per quelle).

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole (vedi `CLAUDE.md`).

---

## Task 6: Effetti del danno su velocità, aderenza e sterzo

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (`effectiveMaxSpeed`, `effectiveGrip`, nuova `applyDamageSteerNoise`, `updateVelocity`)
- Modify: `backend/sockets/games/f1GameSocket.js` (export `physics`)
- Test: `backend/sockets/games/f1GameSocket.physics.test.js`

**Interfaces:**
- Consumes: `p.damage` (Task 1).
- Produces: `effectiveMaxSpeed`/`effectiveGrip` riducono l'output in base al danno; `applyDamageSteerNoise(p, isQuali, rng = Math.random)` (nuova, esportata) ritorna l'offset da sommare allo `steer` effettivo.

- [ ] **Step 1: Scrivere i test (prima della modifica)**

Aggiungere in fondo a `backend/sockets/games/f1GameSocket.physics.test.js`:

```js
test('effectiveMaxSpeed: il danno riduce la velocità massima in gara, non in qualifica', () => {
    const { physics } = f1GameSocket;
    const pDanneggiato = { tyreWear: 0, compound: 'medium', damage: 100 };
    const pIlleso       = { tyreWear: 0, compound: 'medium', damage: 0 };

    const raceDanneggiato = physics.effectiveMaxSpeed(pDanneggiato, false);
    const raceIlleso      = physics.effectiveMaxSpeed(pIlleso, false);
    assert.ok(raceDanneggiato < raceIlleso, 'in gara il danno deve rallentare');

    const qualiDanneggiato = physics.effectiveMaxSpeed(pDanneggiato, true);
    const qualiIlleso      = physics.effectiveMaxSpeed(pIlleso, true);
    assert.ok(Math.abs(qualiDanneggiato - qualiIlleso) < 1e-9, 'in qualifica il danno non deve avere effetto');
});

test('effectiveGrip: nessun effetto sotto DAMAGE_GRIP_THRESHOLD, effetto sopra soglia', () => {
    const { physics } = f1GameSocket;
    const pLieve = { tyreWear: 0, compound: 'medium', damage: 10 };
    const pIlleso = { tyreWear: 0, compound: 'medium', damage: 0 };
    const pGrave  = { tyreWear: 0, compound: 'medium', damage: 90 };

    assert.ok(Math.abs(physics.effectiveGrip(pLieve, false) - physics.effectiveGrip(pIlleso, false)) < 1e-9,
        'sotto soglia, nessuna perdita di aderenza');
    assert.ok(physics.effectiveGrip(pGrave, false) < physics.effectiveGrip(pIlleso, false),
        'sopra soglia, aderenza ridotta');
});

test('applyDamageSteerNoise: zero sotto soglia o in qualifica, non-zero sopra soglia in gara', () => {
    const { physics } = f1GameSocket;
    const rngAlways1 = () => 1;   // rng deterministico, sempre al massimo dell'intervallo

    assert.equal(physics.applyDamageSteerNoise({ damage: 10 }, false, rngAlways1), 0, 'sotto soglia, nessun rumore');
    assert.equal(physics.applyDamageSteerNoise({ damage: 90 }, true, rngAlways1), 0, 'in qualifica, nessun rumore');
    const noise = physics.applyDamageSteerNoise({ damage: 90 }, false, rngAlways1);
    assert.ok(noise !== 0, 'sopra soglia in gara, rumore non nullo');
    assert.ok(Math.abs(noise) <= physics.DAMAGE_STEER_NOISE_MAX, 'rumore entro il massimo dichiarato');
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `node --test sockets/games/f1GameSocket.physics.test.js`

Expected: FAIL — `effectiveMaxSpeed`/`effectiveGrip` non ancora modificate (danno ignorato), `applyDamageSteerNoise is not a function`.

- [ ] **Step 3: Aggiungere le costanti degli effetti**

Vicino alle costanti `WEAR_*` (dopo `WEAR_GRIP_PENALTY`):

```js
const DAMAGE_GRIP_THRESHOLD    = 33;    // % danno oltre cui inizia la perdita di aderenza
const DAMAGE_STEER_THRESHOLD   = 66;    // % danno oltre cui inizia il rumore sullo sterzo
const DAMAGE_SPEED_PENALTY_MAX = 0.30;  // fino a -30% velocità massima a danno 100%
const DAMAGE_GRIP_PENALTY_MAX  = 0.35;  // fino a -35% aderenza, attivo solo oltre DAMAGE_GRIP_THRESHOLD
const DAMAGE_STEER_NOISE_MAX   = 0.15;  // rumore massimo sterzo (frazione, sommata a inputs.steer), oltre DAMAGE_STEER_THRESHOLD
```

- [ ] **Step 4: Modificare `effectiveMaxSpeed`/`effectiveGrip`**

Testo attuale:

```js
function effectiveMaxSpeed(p, isQuali) {
    const wearFactor = isQuali ? 1 : 1 - (p.tyreWear / 100) * WEAR_SPEED_PENALTY;
    return MAX_SPEED * tyreOf(p, isQuali).speedMult * wearFactor;
}

function effectiveGrip(p, isQuali) {
    const wearFactor = isQuali ? 1 : 1 - (p.tyreWear / 100) * WEAR_GRIP_PENALTY;
    return GRIP * tyreOf(p, isQuali).gripMult * wearFactor;
}
```

Diventa:

`p.damage` va letto come `(p.damage || 0)`: gli strumenti offline
(`backend/tools/f1LapSimulator.js`, `backend/tools/f1RaceLineOptimizer.js`)
costruiscono i loro player di simulazione con `tyreWear: 0` ma **senza**
campo `damage` (verificato in `f1LapSimulator.js:24`) — con una lettura
diretta `p.damage / 100` darebbe `NaN` e romperebbe silenziosamente la
simulazione (velocità NaN, `f1LapSimulator.test.js` fallirebbe su tutte le
piste). Il fallback `|| 0` costa nulla per i giocatori reali (dove `damage`
è sempre un numero, mai `undefined`, per costruzione — vedi Task 1) ed
evita l'incidente per gli strumenti offline.

```js
function effectiveMaxSpeed(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - (p.tyreWear / 100) * WEAR_SPEED_PENALTY;
    const damageFactor = isQuali ? 1 : 1 - ((p.damage || 0) / 100) * DAMAGE_SPEED_PENALTY_MAX;
    return MAX_SPEED * tyreOf(p, isQuali).speedMult * wearFactor * damageFactor;
}

function effectiveGrip(p, isQuali) {
    const wearFactor = isQuali ? 1 : 1 - (p.tyreWear / 100) * WEAR_GRIP_PENALTY;
    const gripDamageFrac = isQuali ? 0
        : Math.max(0, (p.damage || 0) - DAMAGE_GRIP_THRESHOLD) / (100 - DAMAGE_GRIP_THRESHOLD);
    const damageFactor = 1 - gripDamageFrac * DAMAGE_GRIP_PENALTY_MAX;
    return GRIP * tyreOf(p, isQuali).gripMult * wearFactor * damageFactor;
}
```

- [ ] **Step 5: Aggiungere `applyDamageSteerNoise` e collegarla in `updateVelocity`**

Subito dopo `effectiveGrip`, aggiungere:

```js
// Rumore sullo sterzo da danno grave (>DAMAGE_STEER_THRESHOLD), solo in
// gara. rng iniettabile per test deterministici (stesso pattern di
// randRange in f1Bot.js). Stesso fallback (p.damage || 0) di
// effectiveMaxSpeed/effectiveGrip per i player senza il campo (strumenti offline).
function applyDamageSteerNoise(p, isQuali, rng = Math.random) {
    const damage = p.damage || 0;
    if (isQuali || damage <= DAMAGE_STEER_THRESHOLD) return 0;
    const frac = (damage - DAMAGE_STEER_THRESHOLD) / (100 - DAMAGE_STEER_THRESHOLD);
    return (rng() * 2 - 1) * frac * DAMAGE_STEER_NOISE_MAX;
}
```

In `updateVelocity`, il testo attuale:

```js
    if (Math.abs(p.speed) > 0.01 || (p.vx * p.vx + p.vz * p.vz) > 0.0001) {
        const dir = p.speed >= 0 ? 1 : -1;
        const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
        const turnRate  = TURN_SPEED_LOW + (TURN_SPEED_HIGH - TURN_SPEED_LOW) * speedFrac;
        p.angle += turnRate * dir * inputs.steer;
    }
```

Diventa:

```js
    if (Math.abs(p.speed) > 0.01 || (p.vx * p.vx + p.vz * p.vz) > 0.0001) {
        const dir = p.speed >= 0 ? 1 : -1;
        const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
        const turnRate  = TURN_SPEED_LOW + (TURN_SPEED_HIGH - TURN_SPEED_LOW) * speedFrac;
        const steer = inputs.steer + applyDamageSteerNoise(p, isQuali);
        p.angle += turnRate * dir * steer;
    }
```

- [ ] **Step 6: Aggiornare l'export `physics`**

Aggiungere `applyDamageSteerNoise`, `DAMAGE_STEER_NOISE_MAX` all'oggetto `module.exports.physics`.

- [ ] **Step 7: Eseguire i test**

Run: `node --test sockets/games/f1GameSocket.physics.test.js`

Expected: PASS su tutti.

- [ ] **Step 8: Verificare che gli strumenti offline non si rompano**

Run (da `backend/`): `node --test tools/f1LapSimulator.test.js`

Expected: PASS invariato su tutte le piste (grazie al fallback `|| 0` dello Step 4, `p.damage` assente nei player di `f1LapSimulator.js` si comporta come danno zero, nessun `NaN`).

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole (vedi `CLAUDE.md`).

---

## Task 7: Visibilità del danno/penalità nello stato pubblico

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (`buildPublicState`, `endRace`)
- Modify: `backend/sockets/games/f1GameSocket.js` (export `physics`)
- Test: `backend/sockets/games/f1GameSocket.physics.test.js`

**Interfaces:**
- Consumes: `p.damage`, `p.collisionPenaltyMs` (Task 1).
- Produces: `buildPublicState` (ora esportata) include `damage`/`collisionPenalty` per giocatore; il podio di `endRace` include `collisionPenaltyMs`.

- [ ] **Step 1: Scrivere il test (prima della modifica)**

Aggiungere in fondo a `backend/sockets/games/f1GameSocket.physics.test.js`:

```js
test('buildPublicState: espone damage e collisionPenalty (bool) per giocatore', () => {
    const { physics } = f1GameSocket;
    const players = {
        red: {
            x: 0, z: 0, angle: 0, trackIndex: 0, speed: 0, finished: false, time: null, lap: 0,
            compound: 'medium', tyreWear: 0, damage: 42, collisionPenaltyMs: 1500,
            pitAutoState: null, falseStart: false, falseStartServed: false,
            gapToLeaderMs: null, isBot: false, inSlipstream: false
        }
    };
    const track = { points: [{ x: 0, z: 0 }] };
    const state = physics.buildPublicState(players, false, track);

    assert.equal(state.red.damage, 42);
    assert.equal(state.red.collisionPenalty, true);
});
```

- [ ] **Step 2: Eseguire il test per verificare che fallisca**

Run: `node --test sockets/games/f1GameSocket.physics.test.js`

Expected: FAIL — `physics.buildPublicState is not a function`.

- [ ] **Step 3: Modificare `buildPublicState`**

Testo attuale (dentro il `for (const [color, p] of Object.entries(players))`):

```js
        out[color] = {
            x: p.x, z: p.z, angle: p.angle,
            trackIndex: p.trackIndex,
            speed:    p.speed,
            finished: p.finished,
            time:     p.time,
            lap:      p.lap,
            position: raceStarted ? ranked.findIndex(r => r.color === color) + 1 : null,
            compound: p.compound,
            tyreWear: p.tyreWear,
            pitLimiter: !!p.pitAutoState,
            falseStart: !!p.falseStart,
            falseStartServed: !!p.falseStartServed,
            gapToLeaderMs: (p.gapToLeaderMs != null) ? p.gapToLeaderMs : null,
            isBot: !!p.isBot,
            slipstream: !!p.inSlipstream
        };
```

Diventa (due righe aggiunte prima della chiusura):

```js
        out[color] = {
            x: p.x, z: p.z, angle: p.angle,
            trackIndex: p.trackIndex,
            speed:    p.speed,
            finished: p.finished,
            time:     p.time,
            lap:      p.lap,
            position: raceStarted ? ranked.findIndex(r => r.color === color) + 1 : null,
            compound: p.compound,
            tyreWear: p.tyreWear,
            damage:   p.damage,
            pitLimiter: !!p.pitAutoState,
            falseStart: !!p.falseStart,
            falseStartServed: !!p.falseStartServed,
            gapToLeaderMs: (p.gapToLeaderMs != null) ? p.gapToLeaderMs : null,
            isBot: !!p.isBot,
            slipstream: !!p.inSlipstream,
            collisionPenalty: p.collisionPenaltyMs > 0
        };
```

- [ ] **Step 4: Modificare il podio di `endRace`**

Testo attuale:

```js
    ].map(p => ({ color: p.color, totalTime: p.time, pitPenalty: !!p.pitPenalty, falseStart: !!p.falseStart }));
```

Diventa:

```js
    ].map(p => ({ color: p.color, totalTime: p.time, pitPenalty: !!p.pitPenalty, falseStart: !!p.falseStart, collisionPenaltyMs: p.collisionPenaltyMs || 0 }));
```

- [ ] **Step 5: Aggiornare l'export `physics`**

Aggiungere `buildPublicState` all'oggetto `module.exports.physics`.

- [ ] **Step 6: Eseguire i test**

Run: `node --test sockets/games/f1GameSocket.physics.test.js`

Expected: PASS su tutti.

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole (vedi `CLAUDE.md`).

---

## Task 8: Scelta riparazione ai box (server)

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (nuovo handler `f1PitRepairChoice`, `handlePitReactionPress`, `completePitStop`)

**Interfaces:**
- Consumes: `p.pendingRepair`, `p.damage` (Task 1).
- Produces: evento socket `f1PitRepairChoice` accettato lato server; sosta più lunga se si ripara; `p.damage` azzerato a fine sosta solo se scelto.

- [ ] **Step 1: Aggiungere la costante del costo di riparazione**

Vicino a `PIT_PENALTY_MS`:

```js
const REPAIR_MS_PER_DAMAGE_PCT = 150;   // ms extra di sosta per ogni % di danno riparato
```

- [ ] **Step 2: Nuovo handler socket, stesso pattern di `f1PitCompoundChoice`**

Subito dopo l'handler esistente `f1PitCompoundChoice`:

```js
    // Scelta riparazione danni durante la sosta ai box: applicata a fine
    // sosta (completePitStop), non subito — stesso pattern di
    // f1PitCompoundChoice. Default se non si sceglie mai: NON riparare.
    socket.on('f1PitRepairChoice', ({ lobbyId, playerColor, repair }) => {
        const game = activeGames.get(lobbyId);
        if (!game) return;
        const p = game.players[playerColor];
        if (!p || (!p.pitting && !p.pitAutoState)) return;
        p.pendingRepair = !!repair;
    });
```

- [ ] **Step 3: Tempo extra in `handlePitReactionPress`**

Testo attuale:

```js
    // Penalità falsa partenza scontata QUI, alla PRIMA sosta: stesso
    // minigioco di reazione, sosta più lunga di 5s — nessun secondo
    // meccanismo da imparare per il giocatore.
    if (p.falseStart && !p.falseStartServed) {
        durationMs += FALSE_START_PENALTY_MS;
        p.falseStartServed = true;
    }
```

Diventa (aggiunta dopo il blocco falsa partenza):

```js
    // Penalità falsa partenza scontata QUI, alla PRIMA sosta: stesso
    // minigioco di reazione, sosta più lunga di 5s — nessun secondo
    // meccanismo da imparare per il giocatore.
    if (p.falseStart && !p.falseStartServed) {
        durationMs += FALSE_START_PENALTY_MS;
        p.falseStartServed = true;
    }

    // Riparazione danni: tempo extra proporzionale al danno che c'era al
    // momento della scelta (non al danno originale ad inizio sosta, ma è lo
    // stesso valore: durante la sosta il danno non cambia, l'auto è ferma).
    if (p.pendingRepair && p.damage > 0) {
        durationMs += p.damage * REPAIR_MS_PER_DAMAGE_PCT;
    }
```

- [ ] **Step 4: Applicare la riparazione in `completePitStop`**

Testo attuale:

```js
function completePitStop(io, lobbyId, game, p) {
    if (!p.pitting) return;   // difensivo (es. gara finita nel frattempo)
    p.pitting   = false;
    p.pitPhase  = null;
    p.pitGoTime = null;
    p.tyreWear  = 0;
    p.hasPitted = true;
    if (p.pendingCompound) { p.compound = p.pendingCompound; p.pendingCompound = null; }
```

Diventa:

```js
function completePitStop(io, lobbyId, game, p) {
    if (!p.pitting) return;   // difensivo (es. gara finita nel frattempo)
    p.pitting   = false;
    p.pitPhase  = null;
    p.pitGoTime = null;
    p.tyreWear  = 0;
    p.hasPitted = true;
    if (p.pendingCompound) { p.compound = p.pendingCompound; p.pendingCompound = null; }
    if (p.pendingRepair) { p.damage = 0; }
    p.pendingRepair = false;
```

- [ ] **Step 5: Verifica manuale in localhost**

Avviare il server, accumulare danno in gara, andare ai box:
- SENZA toccare alcun toggle di riparazione → verificare che la sosta duri il tempo normale (2-3s + eventuale falsa partenza) e che il danno resti invariato dopo l'uscita dai box (nessuna UI ancora presente per emettere `f1PitRepairChoice`: usare temporaneamente la console del browser, `socket.emit('f1PitRepairChoice', { lobbyId, playerColor: myColor, repair: true })`, per simulare la scelta finché la UI non esiste — Task 10).
- CON `repair: true` emesso manualmente → verificare che la sosta duri visibilmente di più (proporzionale al danno) e che il danno sia 0 dopo l'uscita.

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole (vedi `CLAUDE.md`).

---

## Task 9: Euristica di riparazione per i bot

**Files:**
- Modify: `backend/sockets/games/f1Bot.js`
- Test: `backend/sockets/games/f1Bot.test.js`

**Interfaces:**
- Consumes: `p.damage` (Task 1).
- Produces: `shouldBotRepair(damage, threshold)` (pura, esportata) — nessun cambiamento a guida/traiettoria/sorpassi.

- [ ] **Step 1: Scrivere il test (prima della modifica)**

Aggiungere in fondo a `backend/sockets/games/f1Bot.test.js`:

```js
test('shouldBotRepair: ripara solo se il danno è almeno alla soglia', () => {
    assert.equal(shouldBotRepair(19, 20), false);
    assert.equal(shouldBotRepair(20, 20), true);
    assert.equal(shouldBotRepair(0, 20), false);
    assert.equal(shouldBotRepair(100, 20), true);
});
```

E aggiungere `shouldBotRepair` alla destrutturazione dell'import in cima al file (dove oggi c'è `pickPostPitCompound, pickBotColors, estimateFinishTime, ...`).

- [ ] **Step 2: Eseguire il test per verificare che fallisca**

Run (da `backend/`): `node --test sockets/games/f1Bot.test.js`

Expected: FAIL — `shouldBotRepair is not defined`.

- [ ] **Step 3: Implementare la funzione**

In `backend/sockets/games/f1Bot.js`, subito dopo `pickPostPitCompound`:

```js
const BOT_REPAIR_DAMAGE_THRESHOLD = 20;   // % danno oltre cui il bot ripara sempre ai box

function shouldBotRepair(damage, threshold) {
    return damage >= threshold;
}
```

- [ ] **Step 4: Collegare la scelta al momento in cui il bot decide la sosta imminente**

Testo attuale (dove il bot decide di dirigersi ai box e sceglie la mescola):

```js
            if (wearThresholdHit || mustPitNow) {
                p.botHeadingToPits = true;
                p.pendingCompound = pickPostPitCompound(remainingLaps, wearLapsAtMedium);
```

Diventa:

```js
            if (wearThresholdHit || mustPitNow) {
                p.botHeadingToPits = true;
                p.pendingCompound = pickPostPitCompound(remainingLaps, wearLapsAtMedium);
                p.pendingRepair = shouldBotRepair(p.damage, BOT_REPAIR_DAMAGE_THRESHOLD);
```

- [ ] **Step 5: Esportare `shouldBotRepair`**

In fondo al file, `module.exports` include oggi (tra gli altri) `pickPostPitCompound` — aggiungere `shouldBotRepair` alla stessa lista.

- [ ] **Step 6: Eseguire i test**

Run: `node --test sockets/games/f1Bot.test.js`

Expected: PASS su tutti (36+ esistenti invariati + il nuovo).

- [ ] **Step 7: Verifica manuale in localhost**

Giocare una gara con bot attivi, forzare danno su un bot (es. speronarlo), osservare che quando quel bot va ai box con danno oltre soglia ripara automaticamente (sosta visibilmente più lunga), senza alcun cambiamento percepibile nella sua guida/traiettoria in pista.

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole (vedi `CLAUDE.md`).

---

## Task 10: HUD — readout danno colorato + toggle riparazione ai box

**Files:**
- Modify: `frontend/f1.html` (readout danno nel pannello gomme, toggle nel pannello pit stop)
- Modify: `frontend/styles/f1.css` (`.car-chassis`/`.car-wing` con `--damage`, stile toggle)
- Modify: `frontend/f1.js` (aggiornamento readout, emit `f1PitRepairChoice`)

**Interfaces:**
- Consumes: campo `damage` in `f1StateUpdate` (Task 7), `wearColor()` già esistente in `frontend/f1.js`.
- Produces: nessuna nuova interfaccia consumata da altri task — solo UI.

- [ ] **Step 1: Aggiungere il readout danno in `frontend/f1.html`**

Testo attuale (dentro `#tyre-open`, dopo `.hud-car-top`):

```html
        <div class="hud-tyre-wear-readout">
            <div class="hud-screen"><span class="hud-mono" id="tyre-wear-value">0</span><span class="hud-mono">%</span></div>
            <span class="hud-eyebrow">Usura</span>
        </div>
    </div>
```

Diventa:

```html
        <div class="hud-tyre-wear-readout">
            <div class="hud-screen"><span class="hud-mono" id="tyre-wear-value">0</span><span class="hud-mono">%</span></div>
            <span class="hud-eyebrow">Usura</span>
        </div>
        <div class="hud-tyre-wear-readout">
            <div class="hud-screen"><span class="hud-mono" id="damage-value">0</span><span class="hud-mono">%</span></div>
            <span class="hud-eyebrow">Danni</span>
        </div>
    </div>
```

- [ ] **Step 2: Aggiungere il toggle riparazione nel pannello pit stop**

Cercare il markup del pannello `pitstop-panel` (contiene `pitstop-status`, `pitstop-instructions`, `pitstop-cards`, `pitstop-react-prompt`, `pitstop-result`). Subito dopo il div `pitstop-cards`, aggiungere:

```html
        <div id="pitstop-repair-toggle" style="display:none; margin-top:10px; cursor:pointer; user-select:none;">
            <label style="display:flex; align-items:center; gap:8px; font-size:14px;">
                <input type="checkbox" id="pitstop-repair-checkbox">
                <span id="pitstop-repair-label">Ripara danni</span>
            </label>
        </div>
```

- [ ] **Step 3: Colorare il telaio SVG in base al danno, in `frontend/styles/f1.css`**

Testo attuale:

```css
.car-chassis { fill: #2b313c; }
.car-wing    { fill: #232830; }
```

Diventa:

```css
.car-chassis { fill: var(--damage, #2b313c); transition: fill 0.4s ease; }
.car-wing    { fill: var(--damage, #232830); transition: fill 0.4s ease; }
```

- [ ] **Step 4: Aggiornare il readout e la colorazione in `frontend/f1.js`**

Nell'handler `f1StateUpdate`, dentro il blocco esistente `if (color === myColor && currentPhase === 'race' && data.compound && tyreCompoundsInfo) { const info = ...; if (info) { ... } }`, il testo attuale finisce con:

```js
                    document.getElementById('tyre-wear-value').textContent = wear;
                    ['wFL', 'wFR', 'wRL', 'wRR'].forEach(id =>
                        document.getElementById(id).style.setProperty('--wear', col));
                }
            }
```

Diventa (due righe aggiunte prima della chiusura del blocco `if (info)`):

```js
                    document.getElementById('tyre-wear-value').textContent = wear;
                    ['wFL', 'wFR', 'wRL', 'wRR'].forEach(id =>
                        document.getElementById(id).style.setProperty('--wear', col));
                    const dmg = Math.round(data.damage || 0);
                    document.getElementById('damage-value').textContent = dmg;
                    document.getElementById('tyre-open').style.setProperty('--damage', wearColor(dmg));
                }
            }
```

- [ ] **Step 5: Mostrare/nascondere e cablare il toggle riparazione**

`serverState[color] = data;` (riga 942 di `frontend/f1.js`, dentro l'handler `f1StateUpdate`) è già la cache dell'ultimo stato ricevuto per ogni giocatore, usata altrove nel file — `serverState[myColor].damage` è quindi già disponibile quando si entra ai box.

Nell'handler `f1PitLaneEntered` esistente (dove oggi si chiama `renderTyreCards` per `pitstop-cards`), aggiungere dopo:

```js
        const myDamage = (serverState[myColor] && serverState[myColor].damage) || 0;
        const repairToggle = document.getElementById('pitstop-repair-toggle');
        const repairCheckbox = document.getElementById('pitstop-repair-checkbox');
        const repairLabel = document.getElementById('pitstop-repair-label');
        if (myDamage > 0) {
            const estSecs = ((myDamage * 150) / 1000).toFixed(1);   // 150 = REPAIR_MS_PER_DAMAGE_PCT lato server
            repairLabel.textContent = `Ripara danni (+${estSecs}s)`;
            repairToggle.style.display = 'block';
            repairCheckbox.checked = false;
            repairCheckbox.onchange = () => {
                socket.emit('f1PitRepairChoice', { lobbyId, playerColor: myColor, repair: repairCheckbox.checked });
            };
        } else {
            repairToggle.style.display = 'none';
        }
```

- [ ] **Step 6: Verifica manuale in localhost**

Giocare una gara, accumulare danno (speronare/farsi speronare o sbattere contro una barriera), verificare:
- il readout "Danni" nel pannello gomme mostra la percentuale corretta e il telaio dell'auto (SVG) cambia colore verso il rosso man mano che il danno cresce;
- entrando ai box con danno > 0, il toggle "Ripara danni (+X.Xs)" compare con la stima corretta;
- selezionandolo, la sosta dura visibilmente di più e il danno si azzera all'uscita; lasciandolo deselezionato, il danno resta invariato.

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole (vedi `CLAUDE.md`).

---

## Task 11: HUD — badge penalità animato, mescola in classifica, risultati finali

**Files:**
- Modify: `frontend/f1.js` (`renderStandingRowContent`, nuovo handler `f1CollisionPenalty`, pannello risultati finali)
- Modify: `frontend/styles/f1.css` (`.collision-badge`, `.compound-badge`)

**Interfaces:**
- Consumes: `d.collisionPenalty`/`d.compound` in `f1StateUpdate` (Task 7, `compound` già esistente), evento `f1CollisionPenalty` (Task 5), `entry.collisionPenaltyMs` nel podio (Task 7).
- Produces: nessuna nuova interfaccia consumata da altri task — solo UI.

- [ ] **Step 1: Aggiungere i due badge in `renderStandingRowContent`**

Testo attuale:

```js
    function renderStandingRowContent(rowEl, color, d) {
        rowEl.innerHTML = `
            <span class="pos">${d.position}</span>
            <span class="dot" style="background:${color};"></span>
            ${color === myColor ? 'TU' : ''}${d.isBot ? '<span class="bot-badge">CPU</span>' : ''}${(d.falseStart && !d.falseStartServed) ? '<span class="false-start-badge">!</span>' : ''}
            <span class="gap">${formatGap(d.gapToLeaderMs)}</span>
        `;
    }
```

Diventa:

```js
    function renderStandingRowContent(rowEl, color, d) {
        const compoundLetter = { soft: 'S', medium: 'M', hard: 'H' }[d.compound] || '';
        const compoundColor  = (tyreCompoundsInfo && tyreCompoundsInfo[d.compound] && tyreCompoundsInfo[d.compound].color) || '#888';
        rowEl.innerHTML = `
            <span class="pos">${d.position}</span>
            <span class="dot" style="background:${color};"></span>
            ${compoundLetter ? `<span class="compound-badge" style="background:${compoundColor};">${compoundLetter}</span>` : ''}
            ${color === myColor ? 'TU' : ''}${d.isBot ? '<span class="bot-badge">CPU</span>' : ''}${(d.falseStart && !d.falseStartServed) ? '<span class="false-start-badge">!</span>' : ''}${d.collisionPenalty ? '<span class="false-start-badge collision-badge">!</span>' : ''}
            <span class="gap">${formatGap(d.gapToLeaderMs)}</span>
        `;
    }
```

- [ ] **Step 2: Stile dei due badge in `frontend/styles/f1.css`**

Subito dopo la regola `.false-start-badge` esistente:

```css
/* Badge mescola: cerchio colorato (colore mescola corrente) con lettera
   S/M/H dentro, sempre visibile in classifica, aggiornato ad ogni
   f1StateUpdate — nessun evento dedicato, cambia da solo dopo un pit stop. */
.compound-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    color: #fff;
    font-size: 9px;
    font-weight: 900;
    line-height: 1;
    flex-shrink: 0;
    text-shadow: 0 1px 1px rgba(0,0,0,0.5);
}

/* Badge penalità collisione: eredita l'aspetto di .false-start-badge, ma la
   larghezza è animata via anime.js (f1CollisionPenalty) per fare spazio al
   testo "+X.Xs" durante l'espansione, non fissa come l'originale. */
.collision-badge {
    width: auto;
    min-width: 14px;
    padding: 0 2px;
}
```

- [ ] **Step 3: Handler `f1CollisionPenalty` con animazione**

Aggiungere vicino agli altri `socket.on('f1...', ...)` relativi alla classifica:

```js
    socket.on('f1CollisionPenalty', ({ color, penaltyMs }) => {
        const rowEl = standingRowEls[color];
        if (!rowEl) return;
        const el = rowEl.querySelector('.collision-badge');
        if (!el) return;
        const secs = (penaltyMs / 1000).toFixed(1);
        anime.timeline({ easing: 'easeOutQuad' })
            .add({
                targets: el, scale: [1, 1.3], width: [14, 46], duration: 200,
                complete: () => { el.textContent = `+${secs}s`; }
            })
            .add({ targets: el, duration: 1200 })
            .add({
                targets: el, scale: 1, width: 14, duration: 200,
                complete: () => { el.textContent = '!'; }
            });
    });
```

- [ ] **Step 4: Riga penalità collisioni nei risultati finali**

Cercare il punto dove oggi si renderizza `+5s FALSE START` (`entry.falseStart ? ...`). Aggiungere subito dopo:

```js
                    ${entry.collisionPenaltyMs > 0 ? `<span style="font-size:11px;font-weight:bold;color:#e74c3c;border:1px solid #e74c3c;border-radius:6px;padding:1px 6px;">+${(entry.collisionPenaltyMs / 1000).toFixed(1)}s COLLISIONI</span>` : ''}
```

- [ ] **Step 5: Verifica manuale in localhost**

Giocare una gara con almeno un cambio gomme e un incidente causato dal giocatore stesso:
- verificare che il cerchietto S/M/H sia sempre visibile nella riga di classifica di ogni pilota e cambi subito dopo un pit stop con mescola diversa;
- causare una collisione sopra soglia — verificare che il badge "!" compaia/pulsi, si espanda mostrando "+X.Xs", poi si richiuda su "!" restando visibile per il resto della gara;
- a fine gara, verificare che i risultati finali mostrino la riga "+X.Xs COLLISIONI" con il totale corretto per chi ha accumulato penalità, assente per chi non ne ha.

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole (vedi `CLAUDE.md`).

---

## Task 12: Verifica end-to-end completa

**Files:** nessuno (solo verifica manuale).

- [ ] **Step 1: Eseguire l'intera suite automatica**

Run (da `backend/`):

```bash
node --test sockets/games/f1GameSocket.physics.test.js sockets/games/f1Bot.test.js sockets/games/trackLoader.test.js tools/f1LapSimulator.test.js
```

Expected: tutti i test passano (`# fail 0` su ciascun file).

- [ ] **Step 2: Playtest guidato in localhost (checklist dalla spec)**

Avviare il server, almeno due tab (un umano + bot attivi). Verificare uno per uno:

- **Danno auto-auto**: forzare un tamponamento (un'auto ferma/lenta, l'altra a tutta velocità la centra) — SOLO chi tampona prende danno pieno + penalità, la vittima un danno minore, nessuna penalità a lei; badge "!" compare subito in classifica con l'animazione "+X.Xs" che si richiude su "!".
- **Soglia minima**: due auto che si sfiorano appena fianco a fianco senza urto vero — nessun danno, nessuna penalità a nessuno dei due.
- **Danno barriera**: sbattere contro un muro ponte — solo danno, nessuna penalità, nessuna vittima.
- **Fasce di effetto**: a danno lieve l'auto perde solo velocità; a danno medio anche aderenza (più derapate); a danno alto anche uno sterzo percettibilmente meno preciso.
- **Qualifica**: ripetere gli stessi urti in qualifica — nessun danno, nessuna penalità, fisica del bump identica a prima di questo lavoro.
- **Riparazione**: ai box con danno accumulato, NON toccare il toggle → si esce ancora danneggiati, sosta di durata normale; ripetere scegliendo "ripara" → si esce con danno a 0, sosta visibilmente più lunga in proporzione al danno che c'era.
- **Bot**: un bot con danno oltre soglia ripara automaticamente al pit stop successivo, senza cambiamenti percepibili nella sua guida in pista.
- **Mescola in classifica**: il cerchietto S/M/H è sempre visibile per ogni pilota e cambia subito dopo che qualcuno completa un pit stop con mescola diversa.
- **Fine gara**: i risultati finali mostrano la riga "+X.Xs COLLISIONI" solo per chi ha accumulato penalità, sommata correttamente al tempo totale.

- [ ] **Step 3: Riportare l'esito all'utente**

Nessun commit in questo task (solo verifica) — se emergono problemi di bilanciamento (danno troppo/poco aggressivo, penalità troppo/poco severa, tempo di riparazione sproporzionato), i valori da ritoccare per primi sono le costanti `DAMAGE_PER_SEVERITY`/`DAMAGE_CAP_PER_HIT` (quantità di danno), `COLLISION_PENALTY_PER_SEVERITY`/`COLLISION_PENALTY_CAP_MS` (severità penalità) e `REPAIR_MS_PER_DAMAGE_PCT` (costo riparazione) — tutte isolate in cima a `f1GameSocket.js`, nessuna logica da riscrivere per ritarare.
