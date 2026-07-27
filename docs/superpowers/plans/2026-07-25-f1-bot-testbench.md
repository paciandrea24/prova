# F1 — Banco prova bot (testbench) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Costruire uno strumento di sviluppo che fa correre 6 bot fra loro usando la stessa identica `tickGame` del gioco vero, con una pagina 3D dedicata per osservarli dall'esterno (telecamera a ciclo tra le auto) e controlli per pista/numero bot/usura gomme di partenza/pausa/velocità/passo singolo.

**Architecture:** Nuovo modulo backend `f1Testbench.js` (stesso pattern degli altri moduli gioco in `backend/sockets/games/`) che costruisce un `game` con solo bot e ne guida il ciclo chiamando la `tickGame` reale (esportata da `f1GameSocket.js` per l'occasione) su un timer controllabile. Nuova pagina frontend `f1-testbench.html`/`.js`, indipendente da `f1.html`/`f1.js`, che riusa i moduli di scena condivisi e riceve gli stessi eventi `f1StateUpdate` del gioco vero.

**Tech Stack:** Node.js, `node:test` (stesso runner già in uso in `backend/sockets/games/*.test.js`), Socket.io (già in uso), Three.js r128 da CDN (stesso di `f1.js`), nessuna nuova dipendenza npm.

## Global Constraints

- Nessuna modifica di comportamento al gioco vero: i cambiamenti a codice di produzione sono solo (a) due export aggiunti a `f1GameSocket.js` (`tickGame`, `TYRE_COMPOUNDS`), nessuna riga di logica esistente toccata; (b) l'estrazione di `loadCarModel`/`recolorLiveryTexture` da `f1.js` in `frontend/shared/carLoader.js` (Task 7, deciso esplicitamente dall'utente per evitare divergenza col gioco vero) — stesso comportamento, stesso codice, solo spostato e parametrizzato sulle dipendenze invece di chiuderle per closure.
- Una sola sessione testbench attiva alla volta, stato in una variabile di modulo separata da `activeGames` — mai possibile confusione con le lobby vere.
- `botCount` sempre tra 2 e 6 (`MAX_GRID_SIZE`, già esportato da `f1Bot.js`).
- Validazione input **lato server** prima di creare qualunque sessione (mai fidarsi del client) — coerente con `validateTrackData` già esistente in `trackLoader.js`.
- Nessun nuovo test per fisica/IA (già coperta da `f1GameSocket.physics.test.js`/`f1Bot.test.js`); i nuovi test coprono solo la validazione dello scenario e la costruzione della sessione.
- Nessun commit/push automatico: per convenzione di progetto committa/pusha solo l'utente, quando vuole (vedi `CLAUDE.md`).
- Spec di riferimento: `docs/superpowers/specs/2026-07-25-f1-bot-testbench-design.md`.

---

## Task 1: Esportare `tickGame` e `TYRE_COMPOUNDS` da `f1GameSocket.js`

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js:1663` (blocco `module.exports.physics`)
- Test: `backend/sockets/games/f1GameSocket.exports.test.js` (nuovo)

**Interfaces:**
- Produces: `require('./f1GameSocket.js').tickGame` (funzione `(io, lobbyId, game) => void`), `require('./f1GameSocket.js').TYRE_COMPOUNDS` (oggetto `{ soft: {...}, medium: {...}, hard: {...} }`).

- [ ] **Step 1: Scrivere il test (prima della modifica)**

Creare `backend/sockets/games/f1GameSocket.exports.test.js`:

```js
// backend/sockets/games/f1GameSocket.exports.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const f1GameSocket = require('./f1GameSocket.js');

test('f1GameSocket esporta tickGame come funzione', () => {
    assert.equal(typeof f1GameSocket.tickGame, 'function');
});

test('f1GameSocket esporta TYRE_COMPOUNDS con le tre mescole note', () => {
    assert.deepEqual(Object.keys(f1GameSocket.TYRE_COMPOUNDS).sort(), ['hard', 'medium', 'soft']);
});
```

- [ ] **Step 2: Eseguire il test per verificare che fallisca**

Run (da `backend/`): `node --test sockets/games/f1GameSocket.exports.test.js`
Expected: FAIL — `f1GameSocket.tickGame` è `undefined`, non una funzione; stesso per `TYRE_COMPOUNDS`.

- [ ] **Step 3: Aggiungere gli export**

In `backend/sockets/games/f1GameSocket.js`, subito dopo il blocco `module.exports.physics = { ... };` (riga ~1663 e seguenti, il blocco già esistente che chiude con `};`), aggiungere:

```js
module.exports.tickGame = tickGame;
module.exports.TYRE_COMPOUNDS = TYRE_COMPOUNDS;
```

- [ ] **Step 4: Eseguire il test per verificare che passi**

Run: `node --test sockets/games/f1GameSocket.exports.test.js`
Expected: PASS su entrambi.

- [ ] **Step 5: Eseguire l'intera suite esistente per verificare nessuna regressione**

Run: `node --test sockets/games/f1GameSocket.physics.test.js sockets/games/f1Bot.test.js`
Expected: PASS su tutti (nessuna modifica di comportamento, solo nuovi export).

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole.

---

## Task 2: `f1Testbench.js` — validazione dello scenario

**Files:**
- Create: `backend/sockets/games/f1Testbench.js`
- Test: `backend/sockets/games/f1Testbench.test.js` (nuovo)

**Interfaces:**
- Consumes: `listTracks` da `./trackLoader.js`, `TYRE_COMPOUNDS` da `./f1GameSocket.js` (Task 1), `MAX_GRID_SIZE` da `./f1Bot.js`.
- Produces: `validateTestbenchScenario({ trackId, botCount, tyreWear, compound }) => { valid: true } | { valid: false, error: string }`.

- [ ] **Step 1: Scrivere i test (prima dell'implementazione)**

Creare `backend/sockets/games/f1Testbench.test.js`:

```js
// backend/sockets/games/f1Testbench.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTestbenchScenario } = require('./f1Testbench.js');
const { listTracks } = require('./trackLoader.js');

test('validateTestbenchScenario: scenario valido passa', () => {
    const trackId = listTracks()[0].id;
    const result = validateTestbenchScenario({ trackId, botCount: 4, tyreWear: 30, compound: 'medium' });
    assert.deepEqual(result, { valid: true });
});

test('validateTestbenchScenario: trackId inesistente viene rifiutato', () => {
    const result = validateTestbenchScenario({ trackId: 'pista-che-non-esiste', botCount: 4, tyreWear: 0, compound: 'medium' });
    assert.equal(result.valid, false);
    assert.match(result.error, /pista/i);
});

test('validateTestbenchScenario: botCount fuori range [2,6] viene rifiutato', () => {
    const trackId = listTracks()[0].id;
    assert.equal(validateTestbenchScenario({ trackId, botCount: 1, tyreWear: 0, compound: 'medium' }).valid, false);
    assert.equal(validateTestbenchScenario({ trackId, botCount: 7, tyreWear: 0, compound: 'medium' }).valid, false);
});

test('validateTestbenchScenario: tyreWear fuori range [0,100] viene rifiutato', () => {
    const trackId = listTracks()[0].id;
    assert.equal(validateTestbenchScenario({ trackId, botCount: 4, tyreWear: -1, compound: 'medium' }).valid, false);
    assert.equal(validateTestbenchScenario({ trackId, botCount: 4, tyreWear: 101, compound: 'medium' }).valid, false);
});

test('validateTestbenchScenario: mescola sconosciuta viene rifiutata', () => {
    const trackId = listTracks()[0].id;
    const result = validateTestbenchScenario({ trackId, botCount: 4, tyreWear: 0, compound: 'ultrasoft' });
    assert.equal(result.valid, false);
    assert.match(result.error, /mescola/i);
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `node --test sockets/games/f1Testbench.test.js`
Expected: FAIL — il file `f1Testbench.js` non esiste ancora.

- [ ] **Step 3: Creare `f1Testbench.js` con la validazione**

```js
// backend/sockets/games/f1Testbench.js
//
// Banco prova bot: fa correre solo bot (nessun giocatore reale) usando la
// STESSA tickGame del gioco vero (esportata da f1GameSocket.js apposta per
// questo), per verificare visivamente le correzioni di comportamento bot
// senza fidarsi solo di script di simulazione semplificati — vedi
// docs/superpowers/specs/2026-07-25-f1-bot-testbench-design.md.
const { listTracks } = require('./trackLoader.js');
const { TYRE_COMPOUNDS } = require('./f1GameSocket.js');
const { MAX_GRID_SIZE } = require('./f1Bot.js');

const MIN_BOT_COUNT = 2;

function validateTestbenchScenario({ trackId, botCount, tyreWear, compound }) {
    const knownTrackIds = listTracks().map(t => t.id);
    if (!knownTrackIds.includes(trackId)) {
        return { valid: false, error: `Pista sconosciuta: "${trackId}"` };
    }
    if (!Number.isInteger(botCount) || botCount < MIN_BOT_COUNT || botCount > MAX_GRID_SIZE) {
        return { valid: false, error: `Numero bot deve essere tra ${MIN_BOT_COUNT} e ${MAX_GRID_SIZE}` };
    }
    if (typeof tyreWear !== 'number' || tyreWear < 0 || tyreWear > 100) {
        return { valid: false, error: 'Usura gomme deve essere tra 0 e 100' };
    }
    if (!Object.keys(TYRE_COMPOUNDS).includes(compound)) {
        return { valid: false, error: `Mescola sconosciuta: "${compound}"` };
    }
    return { valid: true };
}

module.exports.validateTestbenchScenario = validateTestbenchScenario;
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

Run: `node --test sockets/games/f1Testbench.test.js`
Expected: PASS su tutti.

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole.

---

## Task 3: `f1Testbench.js` — costruzione della sessione (game object + bot)

**Files:**
- Modify: `backend/sockets/games/f1Testbench.js`
- Test: `backend/sockets/games/f1Testbench.test.js`

**Interfaces:**
- Consumes: `loadTrack` da `./trackLoader.js`; `createBots` da `./f1Bot.js`; `tickGame`, `TYRE_COMPOUNDS` da `./f1GameSocket.js` (Task 1); `physics.assignGridSpawns` da `./f1GameSocket.js`.
- Produces: `createTestbenchSession({ trackId, botCount, tyreWear, compound }) => game` (oggetto pronto per essere passato a `tickGame(io, lobbyId, game)`). Presuppone che l'input sia già stato validato con `validateTestbenchScenario` (non rivalida).

- [ ] **Step 1: Scrivere il test (prima dell'implementazione)**

Aggiungere in fondo a `backend/sockets/games/f1Testbench.test.js`:

```js
const { createTestbenchSession } = require('./f1Testbench.js');
const { physics } = require('./f1GameSocket.js');

test('createTestbenchSession: crea esattamente botCount bot con usura/mescola richieste', () => {
    const trackId = listTracks()[0].id;
    const game = createTestbenchSession({ trackId, botCount: 4, tyreWear: 45, compound: 'hard' });

    const players = Object.values(game.players);
    assert.equal(players.length, 4);
    for (const p of players) {
        assert.equal(p.isBot, true);
        assert.equal(p.tyreWear, 45);
        assert.equal(p.compound, 'hard');
    }
    assert.equal(game.phase, 'race');
    assert.equal(game.raceStarted, true);
});

test('createTestbenchSession: il game risultante funziona con la vera tickGame (le auto si muovono)', () => {
    const { tickGame } = require('./f1GameSocket.js');
    const trackId = listTracks()[0].id;
    const game = createTestbenchSession({ trackId, botCount: 2, tyreWear: 0, compound: 'medium' });
    const fakeIo = { to: () => ({ emit: () => {} }) };

    const before = Object.values(game.players).map(p => ({ x: p.x, z: p.z }));
    for (let i = 0; i < 50; i++) tickGame(fakeIo, 'TESTBENCH', game);
    const after = Object.values(game.players).map(p => ({ x: p.x, z: p.z }));

    const anyMoved = before.some((b, i) => Math.abs(b.x - after[i].x) > 0.001 || Math.abs(b.z - after[i].z) > 0.001);
    assert.ok(anyMoved, 'atteso che almeno un bot si sia mosso dopo 50 tick della vera tickGame');
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `node --test sockets/games/f1Testbench.test.js`
Expected: FAIL — `createTestbenchSession is not a function`.

- [ ] **Step 3: Implementare `createTestbenchSession`**

Aggiungere in `backend/sockets/games/f1Testbench.js`, dopo `validateTestbenchScenario`:

Sostituire la riga `const { MAX_GRID_SIZE } = require('./f1Bot.js');` in cima al file (aggiunta nel Task 2) con:

```js
const { createBots, MAX_GRID_SIZE } = require('./f1Bot.js');
```

Poi aggiungere, sotto i require esistenti in cima al file:

```js
const { loadTrack } = require('./trackLoader.js');
const f1GameSocket = require('./f1GameSocket.js');
const { physics } = f1GameSocket;
```

E in fondo al file (dopo `validateTestbenchScenario`):

```js
// Colori fittizi per "riempire" gli slot umani agli occhi di createBots
// (che calcola quanti bot creare come MAX_GRID_SIZE - humanColors.length):
// nel banco prova non c'è NESSUN giocatore reale, quindi passiamo
// (MAX_GRID_SIZE - botCount) colori fittizi come "già presi da umani" per
// ottenere esattamente botCount bot, invece dei 6 di una partita normale.
function fakeHumanColors(botCount) {
    const count = Math.max(0, MAX_GRID_SIZE - botCount);
    return Array.from({ length: count }, (_, i) => `#TESTBENCH-UNUSED-${i}`);
}

function createTestbenchSession({ trackId, botCount, tyreWear, compound }) {
    const track = loadTrack(trackId);
    const game = {
        track,
        phase: 'race',
        players: {},
        grid: [],
        settings: {},
        tyreConfirmed: new Set(),
        socketByColor: {},
        raceStarted: true,
        raceStartTime: Date.now(),
        raceEnded: false,
        qualiEnded: true,
        lightsSequenceActive: false
    };

    const lobby = { lockedPlayers: fakeHumanColors(botCount) };
    createBots(game, lobby, f1GameSocket.TYRE_COMPOUNDS);

    // Griglia = ordine di creazione dei bot (nessuna qualifica reale in
    // questo strumento): assignGridSpawns la usa per posizionarli in griglia.
    game.grid = Object.keys(game.players);
    physics.assignGridSpawns(game);

    // Override DOPO assignGridSpawns, che resetta tyreWear/compound a
    // "gomme fresche" per ogni bot — l'override va applicato per ultimo.
    for (const p of Object.values(game.players)) {
        p.tyreWear = tyreWear;
        p.compound = compound;
    }

    return game;
}

module.exports.createTestbenchSession = createTestbenchSession;
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

Run: `node --test sockets/games/f1Testbench.test.js`
Expected: PASS su tutti — in particolare il secondo test dimostra che l'intera catena (sessione costruita a mano + vera `tickGame`) funziona end-to-end senza eccezioni e produce movimento reale.

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole.

---

## Task 4: `f1Testbench.js` — handler socket e ciclo di riproduzione

**Files:**
- Modify: `backend/sockets/games/f1Testbench.js`
- Test: `backend/sockets/games/f1Testbench.test.js`

**Interfaces:**
- Consumes: `validateTestbenchScenario`, `createTestbenchSession` (già in questo file); `physics.PHYSICS_TICK_MS`, `tickGame` da `f1GameSocket.js`.
- Produces: `module.exports` (funzione di default) `(io, socket) => void` che registra gli eventi `f1tbStart`, `f1tbPause`, `f1tbResume`, `f1tbStep`, `f1tbSetSpeed`, `f1tbStop` e gestisce la disconnessione.

- [ ] **Step 1: Scrivere il test (prima dell'implementazione)**

Aggiungere in fondo a `backend/sockets/games/f1Testbench.test.js`:

```js
const { EventEmitter } = require('node:events');
const registerTestbench = require('./f1Testbench.js');

// Fake socket/io minimi: solo quello che f1Testbench.js usa davvero
// (socket.on/emit/join, io.to().emit) — stesso pattern già usato nei test
// di f1Bot.js per deps.io/deps.handlePitReactionPress.
function makeFakeSocket() {
    const s = new EventEmitter();
    s.join = () => {};
    s.emit = () => {};
    return s;
}

test('f1tbStart con scenario non valido emette f1tbError e non crea sessione', (t, done) => {
    const socket = makeFakeSocket();
    const io = { to: () => ({ emit: () => {} }) };
    registerTestbench(io, socket);

    let errorMsg = null;
    socket.emit = (event, payload) => { if (event === 'f1tbError') errorMsg = payload; };

    socket.emit('___trigger___');   // no-op, solo per chiarezza del test
    socket.listeners('f1tbStart')[0]({ trackId: 'non-esiste', botCount: 4, tyreWear: 0, compound: 'medium' });

    assert.ok(errorMsg && errorMsg.error, 'atteso un f1tbError con messaggio');
    done();
});

test('f1tbStart valido avvia il timer, f1tbStop lo ferma (nessuna eccezione)', (t, done) => {
    const { listTracks } = require('./trackLoader.js');
    const trackId = listTracks()[0].id;
    const socket = makeFakeSocket();
    const io = { to: () => ({ emit: () => {} }) };
    registerTestbench(io, socket);

    socket.listeners('f1tbStart')[0]({ trackId, botCount: 2, tyreWear: 0, compound: 'medium' });
    socket.listeners('f1tbPause')[0]();
    socket.listeners('f1tbStep')[0]();
    socket.listeners('f1tbSetSpeed')[0]({ multiplier: 2 });
    socket.listeners('f1tbResume')[0]();
    socket.listeners('f1tbStop')[0]();

    done();   // il vero obiettivo del test è che nessuna delle chiamate sopra lanci un'eccezione
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `node --test sockets/games/f1Testbench.test.js`
Expected: FAIL — `f1Testbench.js` non esporta ancora una funzione di default (`registerTestbench is not a function`).

- [ ] **Step 3: Implementare la registrazione degli eventi**

Aggiungere in fondo a `backend/sockets/games/f1Testbench.js` (dopo `createTestbenchSession`):

```js
const TESTBENCH_LOBBY_ID = 'TESTBENCH';
const VALID_SPEED_MULTIPLIERS = [1, 2, 4];

// Una sola sessione alla volta (strumento per lo sviluppatore, non
// multi-utente): stato in una variabile di modulo, MAI in activeGames —
// nessuna possibilità di confusione con le lobby vere.
let session = null;   // { game, timer, speedMultiplier, paused }

function stopSession() {
    if (session && session.timer) clearInterval(session.timer);
    session = null;
}

function startTimer(io) {
    session.timer = setInterval(() => {
        for (let i = 0; i < session.speedMultiplier; i++) {
            f1GameSocket.tickGame(io, TESTBENCH_LOBBY_ID, session.game);
        }
    }, physics.PHYSICS_TICK_MS);
}

module.exports = function (io, socket) {
    socket.on('f1tbStart', (config) => {
        const result = validateTestbenchScenario(config);
        if (!result.valid) {
            socket.emit('f1tbError', { error: result.error });
            return;
        }
        stopSession();   // rimpiazza pulito una sessione precedente, se c'era
        const game = createTestbenchSession(config);
        session = { game, timer: null, speedMultiplier: 1, paused: false };
        socket.join(TESTBENCH_LOBBY_ID);
        startTimer(io);
    });

    socket.on('f1tbPause', () => {
        if (!session || session.paused) return;
        clearInterval(session.timer);
        session.paused = true;
    });

    socket.on('f1tbResume', () => {
        if (!session || !session.paused) return;
        session.paused = false;
        startTimer(io);
    });

    socket.on('f1tbStep', () => {
        if (!session || !session.paused) return;   // no-op se non in pausa, non un errore
        f1GameSocket.tickGame(io, TESTBENCH_LOBBY_ID, session.game);
    });

    socket.on('f1tbSetSpeed', ({ multiplier }) => {
        if (!session || !VALID_SPEED_MULTIPLIERS.includes(multiplier)) return;
        session.speedMultiplier = multiplier;
    });

    socket.on('f1tbStop', stopSession);

    socket.on('disconnect', stopSession);
};

module.exports.validateTestbenchScenario = validateTestbenchScenario;
module.exports.createTestbenchSession = createTestbenchSession;
```

Nota: `module.exports` viene riassegnato a una funzione qui (era già usato come oggetto per attaccare `validateTestbenchScenario`/`createTestbenchSession` nei Task 2/3) — dopo questo step, le funzioni di default e le proprietà nominate DEVONO coesistere sullo stesso `module.exports` (funzione con proprietà attaccate), esattamente come già fa `f1GameSocket.js` con `module.exports = function(io,socket){...}` + `module.exports.physics = {...}`. Assicurarsi che l'ordine nel file sia: prima le `function` dichiarate (hoisted, ordine libero), poi **un solo** blocco finale con `module.exports = function(io, socket) {...}` seguito dalle righe `module.exports.<nome> = <nome>;`.

- [ ] **Step 4: Eseguire i test per verificare che passino**

Run: `node --test sockets/games/f1Testbench.test.js`
Expected: PASS su tutti.

- [ ] **Step 5: Eseguire l'intera suite del progetto per verificare nessuna regressione**

Run (da `backend/`): `node --test sockets/games/f1GameSocket.physics.test.js sockets/games/f1Bot.test.js sockets/games/f1GameSocket.exports.test.js sockets/games/f1Testbench.test.js sockets/games/trackLoader.test.js`
Expected: PASS su tutti (a parte l'unico fallimento pre-esistente e non collegato in `trackLoader.test.js`, già confermato in questa sessione).

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole.

---

## Task 5: Registrare `f1Testbench` in `socketManager.js`

**Files:**
- Modify: `backend/sockets/socketManager.js:12` (blocco dei `require` dei moduli gioco) e riga ~183 (blocco delle chiamate `xGameSocket(io, socket)`)

**Interfaces:**
- Consumes: `require('./games/f1Testbench')` (funzione di default, Task 4).

- [ ] **Step 1: Aggiungere il require**

In `backend/sockets/socketManager.js`, riga 12, subito dopo:

```js
const f1GameSocket = require('./games/f1GameSocket');
```

aggiungere:

```js
const f1Testbench = require('./games/f1Testbench');
```

- [ ] **Step 2: Registrare la chiamata**

Riga ~183, subito dopo:

```js
        f1GameSocket(io, socket);
```

aggiungere:

```js
        f1Testbench(io, socket);
```

- [ ] **Step 3: Verifica manuale che il server si avvii senza errori**

Da `backend/`: `node server.js`

Expected: il server si avvia normalmente (nessuna eccezione all'avvio, nessun log di errore relativo a `f1Testbench`). Aprire `localhost:3000` e verificare che la lobby normale funzioni ancora esattamente come prima (nessuna regressione visibile).

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole.

---

## Task 6: `frontend/f1-testbench.html` — pagina e pannello di controllo

**Files:**
- Create: `frontend/f1-testbench.html`

**Interfaces:**
- Produces: markup con `<canvas id="f1tb-canvas">` (o equivalente, il renderer Three.js verrà montato lì da `f1-testbench.js` nel Task 8), pannello di controllo con id espliciti per essere agganciati da `f1-testbench.js`.

- [ ] **Step 1: Creare la pagina**

```html
<!-- frontend/f1-testbench.html -->
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title>F1 — Banco prova bot</title>
    <style>
        html, body { margin: 0; padding: 0; overflow: hidden; background: #111; }
        #f1tb-panel {
            position: fixed; top: 12px; left: 12px; z-index: 10;
            background: rgba(9,11,14,0.9); border: 1px solid rgba(255,255,255,0.14);
            border-radius: 8px; padding: 12px; color: #f2f4f6;
            font-family: sans-serif; font-size: 13px; width: 220px;
        }
        #f1tb-panel label { display: block; margin-top: 8px; }
        #f1tb-panel select, #f1tb-panel input, #f1tb-panel button { width: 100%; margin-top: 2px; }
        #f1tb-panel .row { display: flex; gap: 4px; margin-top: 8px; }
        #f1tb-panel .row button { flex: 1; }
        #f1tb-hint { position: fixed; bottom: 12px; left: 12px; z-index: 10; color: #8b96a3; font-family: sans-serif; font-size: 12px; }
    </style>
</head>
<body>
    <div id="f1tb-panel">
        <label>Pista <select id="f1tb-track"></select></label>
        <label>Numero bot <select id="f1tb-botcount">
            <option>2</option><option>3</option><option>4</option><option>5</option><option selected>6</option>
        </select></label>
        <label>Usura gomme di partenza (%) <input id="f1tb-tyrewear" type="number" min="0" max="100" value="0"></label>
        <label>Mescola di partenza <select id="f1tb-compound">
            <option value="soft">Soft</option>
            <option value="medium" selected>Medium</option>
            <option value="hard">Hard</option>
        </select></label>
        <div class="row">
            <button id="f1tb-start">Avvia</button>
            <button id="f1tb-stop">Stop</button>
        </div>
        <div class="row">
            <button id="f1tb-pauseresume">Pausa</button>
            <button id="f1tb-step">Passo</button>
        </div>
        <label>Velocità <select id="f1tb-speed">
            <option value="1" selected>1x</option>
            <option value="2">2x</option>
            <option value="4">4x</option>
        </select></label>
        <div id="f1tb-error" style="color:#e74c3c; margin-top:8px;"></div>
    </div>
    <div id="f1tb-hint">Tasto N: prossima auto</div>

    <script src="/socket.io/socket.io.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
    <script src="shared/trackGeometry.js"></script>
    <script src="shared/trackMeshBuilder.js"></script>
    <script src="shared/trackScenery.js"></script>
    <script src="shared/carLoader.js"></script>
    <script src="f1-testbench.js"></script>
</body>
</html>
```

Nota: script tag esatti copiati da `frontend/f1.html:176-184` (stessa versione di Three.js — `cdnjs.cloudflare.com/ajax/libs/three.js/r128/`, NON jsdelivr per `three.min.js` — e stesso URL di `GLTFLoader.js`). `shared/carLoader.js` viene creato nel Task 7.

- [ ] **Step 2: Verifica manuale**

Aprire `localhost:3000/f1-testbench.html` (server già avviato dal Task 5). Atteso: pagina nera a schermo intero, pannello di controllo visibile in alto a sinistra con tutti i controlli descritti; è normale un errore nella console per `carLoader.js`/`f1-testbench.js` mancanti (arrivano nei Task 7-8) — nessun altro errore inatteso.

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole.

---

## Task 7: Estrarre `loadCarModel`/`recolorLiveryTexture` in `frontend/shared/carLoader.js`

**Files:**
- Create: `frontend/shared/carLoader.js`
- Create: `frontend/shared/carLoader.test.js`
- Modify: `frontend/f1.js:297-405` (costanti + `recolorLiveryTexture` + helper `liftValue`/`desaturateForBlack`/`rgbToHsv`/`hsvToRgb`) e `frontend/f1.js:407-524` (`loadCarModel`) — rimuovere le definizioni locali, sostituire con una chiamata al modulo condiviso.
- Modify: `frontend/f1.html:183` (aggiungere lo script del nuovo modulo, prima di `f1.js`)

**Interfaces:**
- Produces: `CarLoader.loadCarModel(playerColor, onReady, { scene, listener, engineBuffer })` — stesso identico comportamento di oggi (stesso modello, stessa ricolorazione, stesso suono motore), solo parametrizzato sulle dipendenze (`scene`/`listener`/`engineBuffer`) invece di chiuderle per closure su variabili di `f1.js` — così può essere richiamato anche da `frontend/f1-testbench.js` (Task 8) con le proprie istanze.

Decisione dell'utente (rivista rispetto alla bozza iniziale dello spec): questa funzione va estratta, non duplicata, così un cambiamento futuro al modello/ricolorazione auto nel gioco vero si riflette automaticamente nel banco prova, senza rischio di divergenza silenziosa.

- [ ] **Step 1: Scrivere il test (prima dell'implementazione)**

Creare `frontend/shared/carLoader.test.js`:

```js
// frontend/shared/carLoader.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const CarLoader = require('./carLoader.js');

test('CarLoader espone loadCarModel come funzione', () => {
    assert.equal(typeof CarLoader.loadCarModel, 'function');
});
```

(Test minimo, in stile con `trackGeometry.test.js`/`trackScenery.test.js` già presenti in questa cartella: verifica solo la forma del modulo, non il comportamento — che dipende da `THREE`/DOM/rete, non disponibili in Node e già verificati manualmente in localhost per tutto il lavoro 3D di questo progetto.)

- [ ] **Step 2: Eseguire il test per verificare che fallisca**

Run (da `frontend/shared/`, o dalla root con il path completo): `node --test frontend/shared/carLoader.test.js`
Expected: FAIL — il file `carLoader.js` non esiste ancora.

- [ ] **Step 3: Leggere `frontend/f1.js:297-524` per intero**

Leggere per intero questo intervallo (costanti `LIVERY_HUE_MAX`/`LIVERY_SAT_MIN`/`VALUE_LIFT_FLOOR`/`VALUE_LIFT_GAMMA`/`BLACK_SAT_SCALE`, le funzioni `liftValue`, `desaturateForBlack`, `rgbToHsv`, `hsvToRgb`, `recolorLiveryTexture`, `loadCarModel`) prima di scrivere `carLoader.js` — copiarlo esattamente, non riscriverlo a memoria: contiene calcoli di conversione colore (HSV) facili da trascrivere in modo leggermente sbagliato.

- [ ] **Step 4: Creare `frontend/shared/carLoader.js`**

Stesso pattern UMD già usato da `frontend/shared/trackGeometry.js` (funziona sia come `require` in Node — per il test — sia come script globale nel browser):

```js
// frontend/shared/carLoader.js
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CarLoader = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Incollare qui, INVARIATE, le costanti e le funzioni lette al passo 3:
    // LIVERY_HUE_MAX, LIVERY_SAT_MIN, VALUE_LIFT_FLOOR, VALUE_LIFT_GAMMA,
    // BLACK_SAT_SCALE, liftValue, desaturateForBlack, rgbToHsv, hsvToRgb,
    // recolorLiveryTexture (f1.js:297-405).

    // loadCarModel: stessa identica implementazione di f1.js:407-524, con
    // UNA sola differenza di firma — scene/listener/engineBuffer arrivano
    // come terzo parametro (deps) invece che per closure su variabili
    // esterne di f1.js.
    function loadCarModel(playerColor, onReady, { scene, listener, engineBuffer }) {
        // Corpo IDENTICO a f1.js:408-523 (il callback passato a loader.load),
        // con `loader` sostituito da `new THREE.GLTFLoader()` locale (in
        // f1.js era una variabile di modulo condivisa tra le chiamate; qui
        // non cambia nulla ricrearla ad ogni chiamata, il costo è
        // trascurabile e non tocchiamo il comportamento).
        const loader = new THREE.GLTFLoader();
        loader.load('/assets/custom/f1Car.glb', (gltf) => {
            // ... corpo copiato da f1.js:409-523 ...
        }, undefined, (err) => console.error('Errore car model:', err));
    }

    return { loadCarModel };
});
```

- [ ] **Step 5: Eseguire il test per verificare che passi**

Run: `node --test frontend/shared/carLoader.test.js`
Expected: PASS.

- [ ] **Step 6: Aggiornare `frontend/f1.js`**

Rimuovere le righe 297-405 e 407-524 (le definizioni locali di costanti/helper/`recolorLiveryTexture`/`loadCarModel`), sostituendole con:

```js
    function loadCarModel(playerColor, onReady) {
        CarLoader.loadCarModel(playerColor, onReady, { scene, listener, engineBuffer });
    }
```

(Un solo wrapper: tutti i call site esistenti `loadCarModel(color, cb)` in `f1.js` restano invariati, delegano al modulo condiviso.)

- [ ] **Step 7: Aggiungere lo script tag**

In `frontend/f1.html`, riga 183, subito prima di `<script src="shared/trackGeometry.js?v=20260722d"></script>` (o comunque prima di `f1.js`), aggiungere:

```html
    <script src="shared/carLoader.js?v=20260725a"></script>
```

- [ ] **Step 8: Verifica manuale che il gioco vero non sia cambiato**

Avviare il server, entrare in una partita F1 con almeno un bot. Atteso: le auto (propria e avversarie) si caricano, si ricolorano secondo il colore giocatore, ed emettono il suono motore esattamente come prima di questa modifica — nessuna differenza visibile o di comportamento (è un refactor di estrazione, non una modifica funzionale).

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole.

---

## Task 8: `frontend/f1-testbench.js` — scena 3D, caricamento pista/auto, connessione socket

**Files:**
- Create: `frontend/f1-testbench.js`
- Reference: `frontend/f1.js` (per la costruzione della scena — leggerlo prima di scrivere, non indovinare la forma delle funzioni)

**Interfaces:**
- Consumes: `CarLoader.loadCarModel` (Task 7); eventi socket `f1tbTrackList` (nuovo, vedi sotto), `f1StateUpdate` (già esistente, stessa forma di `f1.js`), `f1tbError`.
- Produces: variabile globale di modulo `followedColor` (colore dell'auto attualmente seguita dalla telecamera — usata dal Task 9).

Questo task copia porzioni verbatim di `frontend/f1.js` (righe indicate sotto, verificate in questa sessione di pianificazione) — copiarle esattamente, non riscriverle a memoria: sono centinaia di righe di setup Three.js/GLB che è facile trascrivere in modo leggermente diverso introducendo bug sottili.

**Blocchi da copiare verbatim da `frontend/f1.js` dentro la IIFE di `f1-testbench.js`:**
1. **Righe 26-59** (scena/camera/renderer/luci) — invariate.
2. **Righe 168-182** (`listener` + `engineBuffer`, incluso `resumeAudioContext`/`AudioListener`/`AudioLoader`) — invariate: `CarLoader.loadCarModel` (Task 7) richiede `listener`/`engineBuffer` come dipendenze, quindi vanno creati anche qui, esattamente come in `f1.js`, per restare sulla stessa identica funzione senza casi speciali.
3. **Righe 123-129** (`TrackMeshBuilder.buildGround/buildEmbankment/buildBridgeDecks` + `groundPts`) — richiede `trackPts` (vedi sotto), `BARRIER_D`/`EMBANKMENT_START`/`EMBANKMENT_WIDTH`/`ROAD_HALF`/`CURB_W` come definiti alle righe 69-82 di `f1.js` (copiare anche quelle costanti, sono derivate da `trackData.roadHalfWidth`).
4. **Riga 152-154** (`TrackMeshBuilder.buildRibbon/buildCurbs/buildBarriers`) — invariate.
5. **Righe 233-289** (`sceneryLoader` + `TrackScenery.generateLayout(...)`) — invariate; non serve la minimappa (righe 88-114 di `f1.js`), fuori scope per questo strumento.

Il caricamento auto NON va copiato: si richiama `CarLoader.loadCarModel(color, onReady, { scene, listener, engineBuffer })` (Task 7), stesso modulo condiviso usato da `f1.js`.

`trackData`/`trackPts` in questo nuovo file si ottengono così (adattato da `f1.js:66-67,86`, che carica dal path pista scelto invece che fisso):

```js
const trackRes  = await fetch(`/tracks/${trackId}.json`);
const trackData = await trackRes.json();
const trackPts  = TrackGeometry.sampleLoop(trackData.controlPoints, 1000);
const PIT_PTS   = TrackGeometry.sampleOpenPath(trackData.pit.path, 300);
```

dove `trackId` è il valore scelto nel pannello (Task 6) al momento di premere Avvia — questo fetch va fatto DENTRO l'handler del pulsante Avvia (Step 3 sotto), non all'apertura della pagina, perché la pista non è nota finché l'utente non la sceglie.

**Interpolazione posizione/auto (adattata da `f1.js:1677-1686`):** stessa logica, ma senza il ramo "mia auto" (qui non esiste `myColor`, ogni colore ricevuto è un'auto "degli altri"):

```js
function updateCarVisuals() {
    for (const [color, target] of Object.entries(serverState)) {
        const v = visualState[color];
        if (!v) continue;
        const LERP = 0.18;   // stesso valore di f1.js
        v.x     += (target.x - v.x) * LERP;
        v.z     += (target.z - v.z) * LERP;
        v.angle  = target.angle;   // niente lerp angolare: sufficiente per uno strumento di osservazione, evita di copiare lerpAngle da f1.js
        const carGroup = otherCars[color];
        if (carGroup) {
            carGroup.position.set(v.x, 0, v.z);
            carGroup.rotation.y = v.angle;
        }
    }
}
```

- [ ] **Step 1: Aggiungere l'evento `f1tbTrackList` lato server (piccola aggiunta al Task 4)**

In `backend/sockets/games/f1Testbench.js`, dentro `module.exports = function (io, socket) { ... }`, aggiungere in cima al corpo della funzione:

```js
    const { listTracks } = require('./trackLoader.js');
    socket.emit('f1tbTrackList', listTracks());
```

(Il `require` in cima al file va spostato/aggiunto una sola volta con gli altri require esistenti, non re-importato ad ogni connessione — se `listTracks` non è già importato in cima al file dal Task 2/3, aggiungerlo lì.)

- [ ] **Step 2: Scrivere `f1-testbench.js`**

Struttura (adattare gli argomenti esatti di `TrackMeshBuilder`/`TrackScenery`/caricamento auto copiandoli da `f1.js`, come indicato sopra — qui lo scheletro):

```js
// frontend/f1-testbench.js
(async function () {   // async: Blocco 2 sotto usa await per caricare engineBuffer, come in f1.js
    const socket = io();
    let otherCars = {};       // color -> THREE.Group
    let visualState = {};     // color -> {x,z,angle} interpolato
    let serverState = {};     // color -> ultimo stato ricevuto dal server
    let currentTrackPts = null;
    window.followedColor = null;   // usato dal Task 9 per la telecamera

    // --- Blocco 1: copiare qui verbatim f1.js righe 26-59 (scena/camera/renderer/luci) ---
    // --- Blocco 2: copiare qui verbatim f1.js righe 168-182 (listener + engineBuffer) ---

    document.getElementById('f1tb-error').textContent = '';
    socket.on('f1tbError', ({ error }) => {
        document.getElementById('f1tb-error').textContent = error;
    });

    socket.on('f1tbTrackList', (tracks) => {
        const sel = document.getElementById('f1tb-track');
        sel.innerHTML = tracks.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    });

    socket.on('f1StateUpdate', (state) => {
        for (const [color, data] of Object.entries(state)) {
            serverState[color] = data;
            if (!otherCars[color]) {
                CarLoader.loadCarModel(color, (g) => { otherCars[color] = g; }, { scene, listener, engineBuffer });
            }
            if (!visualState[color]) visualState[color] = { x: data.x, z: data.z, angle: data.angle };
            if (window.followedColor === null) window.followedColor = color;   // segue la prima auto ricevuta di default
        }
    });

    document.getElementById('f1tb-start').addEventListener('click', async () => {
        const trackId = document.getElementById('f1tb-track').value;

        // Adattato da f1.js righe 66-67,86 (fetch dati pista + campionamento, dalla pista SCELTA invece che fissa)
        const trackRes  = await fetch(`/tracks/${trackId}.json`);
        const trackData = await trackRes.json();
        currentTrackPts = TrackGeometry.sampleLoop(trackData.controlPoints, 1000);
        const PIT_PTS   = TrackGeometry.sampleOpenPath(trackData.pit.path, 300);

        // --- Blocco 3: copiare qui verbatim f1.js righe 69-82 (ROAD_HALF/CURB_W/BARRIER_D/EMBANKMENT_START/EMBANKMENT_WIDTH) ---
        // --- Blocco 4: copiare qui verbatim f1.js righe 123-129 (buildGround/buildEmbankment/buildBridgeDecks + groundPts) ---
        // --- Blocco 5: copiare qui verbatim f1.js righe 152-154 (buildRibbon/buildCurbs/buildBarriers) ---
        // --- Blocco 6: copiare qui verbatim f1.js righe 233-289 (sceneryLoader + TrackScenery.generateLayout) ---

        socket.emit('f1tbStart', {
            trackId,
            botCount: Number(document.getElementById('f1tb-botcount').value),
            tyreWear: Number(document.getElementById('f1tb-tyrewear').value),
            compound: document.getElementById('f1tb-compound').value
        });
    });
    document.getElementById('f1tb-stop').addEventListener('click', () => socket.emit('f1tbStop'));
    document.getElementById('f1tb-step').addEventListener('click', () => socket.emit('f1tbStep'));

    let paused = false;
    document.getElementById('f1tb-pauseresume').addEventListener('click', (e) => {
        paused = !paused;
        socket.emit(paused ? 'f1tbPause' : 'f1tbResume');
        e.target.textContent = paused ? 'Riprendi' : 'Pausa';
    });
    document.getElementById('f1tb-speed').addEventListener('change', (e) => {
        socket.emit('f1tbSetSpeed', { multiplier: Number(e.target.value) });
    });

    function updateCarVisuals() {
        for (const [color, target] of Object.entries(serverState)) {
            const v = visualState[color];
            if (!v) continue;
            const LERP = 0.18;   // stesso valore di f1.js
            v.x     += (target.x - v.x) * LERP;
            v.z     += (target.z - v.z) * LERP;
            v.angle  = target.angle;   // niente lerp angolare: basta per uno strumento di osservazione
            const carGroup = otherCars[color];
            if (carGroup) {
                carGroup.position.set(v.x, 0, v.z);
                carGroup.rotation.y = v.angle;
            }
        }
    }

    function animate() {
        requestAnimationFrame(animate);
        updateCarVisuals();
        renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
})();
```

I commenti "Blocco N" sono istruzioni precise di copia (riga-per-riga da un file esistente, verificate in questa sessione di pianificazione), non placeholder: ogni blocco indica esattamente cosa copiare e da dove, senza lasciare decisioni aperte all'implementatore.

- [ ] **Step 3: Verifica manuale**

Riavviare il server (per far effetto il Task 5/nuovo `f1tbTrackList`). Aprire `localhost:3000/f1-testbench.html`. Selezionare una pista, premere Avvia. Atteso: la scena 3D mostra la pista e le auto bot che si muovono; nessun errore nella console del browser. La telecamera non segue ancora nessuna auto in modo controllabile (arriva nel Task 9) — è accettabile che resti ferma nella posizione di default di Three.js.

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole.

---

## Task 9: Telecamera a ciclo tra le auto

**Files:**
- Modify: `frontend/f1-testbench.js`
- Reference: `frontend/f1.js:1561-1574` (dichiarazione `_camOff`/`_lookTgt` + ramo `'third'` di `updateCamera`)

**Interfaces:**
- Consumes: `window.followedColor`, `otherCars`, `visualState` (Task 8).

- [ ] **Step 1: Aggiungere il ciclo tra le auto e la telecamera**

In `frontend/f1-testbench.js`, aggiungere (adattato da `f1.js:1561-1574` — solo il ramo `'third'`, questo strumento non ha bisogno della telecamera cockpit):

```js
    const _camOff  = new THREE.Vector3();
    const _lookTgt = new THREE.Vector3();

    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() !== 'n') return;
        const colors = Object.keys(otherCars);
        if (colors.length === 0) return;
        const currentIdx = colors.indexOf(window.followedColor);
        window.followedColor = colors[(currentIdx + 1) % colors.length];
    });

    function updateSpectatorCamera() {
        const color = window.followedColor;
        const carGroup = color && otherCars[color];
        if (!carGroup) return;
        const pos = carGroup.position;
        const q   = carGroup.quaternion;

        _camOff.set(0, 5.5, -13);
        _camOff.applyQuaternion(q);
        camera.position.copy(pos).add(_camOff);
        _lookTgt.copy(pos).add(new THREE.Vector3(0, 1.2, 0));
        camera.lookAt(_lookTgt);
    }
```

Chiamare `updateSpectatorCamera()` dentro `animate()` (Task 8), dopo `updateCarVisuals()` e prima di `renderer.render(scene, camera)`.

- [ ] **Step 2: Verifica manuale (checklist completa dello strumento)**

Con il server avviato e la pagina aperta:
1. Selezionare New Monza, 6 bot, usura 0%, mescola Medium. Avviare. Atteso: 6 auto partono in griglia e iniziano a correre.
2. Premere `N` più volte. Atteso: la telecamera passa da un'auto all'altra, in ciclo (torna alla prima dopo l'ultima).
3. Premere Pausa. Atteso: le auto si fermano immediatamente. Premere Passo alcune volte: le auto avanzano di un singolo tick fisico alla volta. Premere Riprendi: la corsa continua normalmente.
4. Selezionare velocità 4x. Atteso: le auto si muovono visibilmente più veloci rispetto a 1x.
5. Fermare (Stop) e riavviare con usura gomme di partenza 85% e mescola Hard. Atteso: i bot entrano ai box entro pochi giri (soglia bot 60-80%, già superata in partenza).
6. Riprovare con New Monza per verificare a occhio il comportamento di ingresso ai box (task #10 della sessione precedente: l'auto taglia fuori pista prima di sterzare verso i box) — questo è il primo caso d'uso reale dello strumento, verificare cosa si osserva e deciderne il seguito con l'utente.

Nessun commit qui: per convenzione di progetto committa/pusha solo l'utente, quando vuole.
