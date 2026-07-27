# F1 Semaforo + Falsa Partenza Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire il countdown testuale "3-2-1-GO" con un semaforo a 5 luci reale SOLO per il via della gara (la qualifica resta invariata), e aggiungere una penalità di 5s per falsa partenza (chi accelera mentre le luci sono ancora accese) scontata al primo pit stop, con rete di sicurezza a fine gara e un indicatore live in classifica.

**Architecture:** Il server resta autoritativo su timing e rilevamento: sceglie un'attesa casuale dopo la 5ª luce e usa quel valore SOLO per il proprio `setTimeout` interno — il client non ha bisogno di conoscerlo in anticipo, perché le luci restano semplicemente accese finché non arriva davvero l'evento `f1RaceStarted` (spegnerle in reazione a quell'evento, invece che con un timer locale indipendente, evita qualunque rischio di disallineamento dovuto alla latenza di rete). Il client inizia a inviare l'input dell'acceleratore già durante la sequenza luci (solo per il rilevamento — la fisica server resta comunque congelata finché `raceStarted` è false, quindi non c'è rischio che l'auto si muova davvero prima del via). La penalità riusa il minigioco di reazione ai box già esistente, sommando 5s alla sosta invece di introdurre un meccanismo nuovo.

**Tech Stack:** Backend Node/Socket.io (`backend/sockets/games/f1GameSocket.js`), frontend vanilla JS + anime.js v3.2.1 già in uso (`frontend/f1.js`/`f1.html`/`styles/f1.css`).

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-07-24-f1-semaforo-falsa-partenza-design.md` — valori numerici e comportamento vanno presi da lì, non improvvisare varianti.
- Nessuna modifica alla qualifica: resta il countdown 3-2-1 testuale attuale, nessun rilevamento falsa partenza lì.
- Solo `throttle` conta per la falsa partenza (non `brake`/`steer`).
- `p.falseStart` NON si azzera quando la penalità viene scontata — resta vero per tutta la gara come indicatore storico, si azzera solo alla gara successiva (`assignGridSpawns`).
- Il progetto non ha una suite di test automatici per `f1GameSocket.js` (nessun file `.test.js` per questo modulo, verificato — è un file stateful legato a `io`/socket, non a funzioni pure esportate). Verifica per i task backend: `node --check` (sintassi) + lettura a mano della logica; verifica funzionale reale in localhost solo al Task 3 (fine piano), quando anche il frontend è pronto.
- Niente commit automatici salvo diversa indicazione esplicita dell'utente per questa sessione (verificare con l'utente prima di far committare un subagent, non assumere il consenso della sessione precedente).

---

### Task 1: Backend — sequenza semaforo, rilevamento falsa partenza, penalità

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js`

**Interfaces:**
- Consumes: nessuna (primo task)
- Produces: costanti `LIGHT_COUNT`, `LIGHT_INTERVAL_MS`, `LIGHTS_ALL_ON_MS`, `HOLD_MIN_MS`, `HOLD_MAX_MS`, `FALSE_START_PENALTY_MS`; campi giocatore `falseStart`/`falseStartServed`; campo `game.lightsSequenceActive`; evento socket `f1Countdown` con nuovo campo `phase` (sempre presente, sia per `qualifying` che per `race`) — consumato dal Task 3 (frontend JS) per decidere quale overlay mostrare. Campo `falseStart` nel payload di `f1StateUpdate` (via `buildPublicState`) e nel podio di `f1RaceEnded` (via `endRace`) — consumati dal Task 3.

- [ ] **Step 1: Aggiungi le nuove costanti**

In `backend/sockets/games/f1GameSocket.js`, subito dopo questa riga esistente (riga 114):

```js
const PIT_PENALTY_MS    = 30000;   // penalità se non si fa MAI pit stop in gara (regola F1 vera)
```

aggiungi:

```js
// Semaforo di partenza (solo gara, mai in qualifica): 5 luci, una ogni
// LIGHT_INTERVAL_MS, poi un'attesa casuale prima che si spengano tutte
// insieme = via (come in F1 vera — l'attesa casuale impedisce di "contare"
// il ritmo e accelerare a colpo sicuro).
const LIGHT_COUNT       = 5;
const LIGHT_INTERVAL_MS = 1000;
const LIGHTS_ALL_ON_MS  = (LIGHT_COUNT - 1) * LIGHT_INTERVAL_MS;   // 4000: tutte accese
const HOLD_MIN_MS       = 200, HOLD_MAX_MS = 3000;
const FALSE_START_PENALTY_MS = 5000;
```

- [ ] **Step 2: Aggiungi i nuovi campi all'inizializzazione del giocatore**

Nel blocco di creazione giocatore dentro l'handler `joinF1Game` (circa riga 230-257), subito dopo questa riga esistente:

```js
                pitPenalty:      false,   // true se ha preso la penalità per non aver fatto pit stop
```

aggiungi:

```js
                falseStart:      false,   // true se ha accelerato mentre le luci erano accese (resta true per tutta la gara, indicatore storico)
                falseStartServed: false,  // true una volta scontata la penalità al primo pit stop
```

- [ ] **Step 3: Aggiungi `phase` all'emit di `f1Countdown` in `startQualifying`**

In `startQualifying` (circa riga 491), sostituisci:

```js
    io.to(lobbyId).emit('f1Countdown', { trackName: game.track.name, label: 'QUALIFICA — 1 GIRO' });
```

con:

```js
    io.to(lobbyId).emit('f1Countdown', { trackName: game.track.name, label: 'QUALIFICA — 1 GIRO', phase: 'qualifying' });
```

- [ ] **Step 4: Resetta i nuovi campi in `assignGridSpawns`**

In `assignGridSpawns` (circa riga 561-577), subito dopo questa riga esistente:

```js
        p.pendingCompound = null; p.hasPitted = false; p.pitPenalty = false;
```

aggiungi:

```js
        p.falseStart = false; p.falseStartServed = false;
```

- [ ] **Step 5: Riscrivi `startRaceCountdown` con la sequenza a semaforo**

Sostituisci per intero la funzione esistente:

```js
function startRaceCountdown(io, lobbyId, game) {
    game.phase          = 'race';
    game.raceEnded      = false;
    game.raceStarted    = false;
    game.raceStartTime  = null;
    io.to(lobbyId).emit('f1Countdown', { trackName: game.track.name, label: 'GARA' });
    setTimeout(() => {
        const g = activeGames.get(lobbyId);
        if (!g) return;
        g.raceStarted   = true;
        g.raceStartTime = Date.now();
        console.log(`🚦 [F1] Gara avviata (lobby ${lobbyId})`);
        io.to(lobbyId).emit('f1RaceStarted', { syncTime: 0, phase: 'race' });
    }, 3000);
}
```

con:

```js
function startRaceCountdown(io, lobbyId, game) {
    game.phase                = 'race';
    game.raceEnded            = false;
    game.raceStarted          = false;
    game.raceStartTime        = null;
    game.lightsSequenceActive = true;   // finestra di rilevamento falsa partenza, vedi tickGame

    // holdMs resta SOLO lato server, per il proprio setTimeout: il client
    // non ha bisogno di conoscerlo, gli basta reagire al vero evento
    // f1RaceStarted per spegnere le luci — evita qualunque rischio di
    // disallineamento dovuto alla latenza di rete rispetto a un timer
    // locale indipendente.
    const holdMs  = HOLD_MIN_MS + Math.random() * (HOLD_MAX_MS - HOLD_MIN_MS);
    const totalMs = LIGHTS_ALL_ON_MS + holdMs;

    io.to(lobbyId).emit('f1Countdown', { trackName: game.track.name, label: 'GARA', phase: 'race' });

    setTimeout(() => {
        const g = activeGames.get(lobbyId);
        if (!g) return;
        g.lightsSequenceActive = false;
        g.raceStarted   = true;
        g.raceStartTime = Date.now();
        console.log(`🚦 [F1] Gara avviata (lobby ${lobbyId})`);
        io.to(lobbyId).emit('f1RaceStarted', { syncTime: 0, phase: 'race' });
    }, totalMs);
}
```

- [ ] **Step 6: Rilevamento falsa partenza in `tickGame`**

In `tickGame` (circa riga 740-743), sostituisci:

```js
function tickGame(io, lobbyId, game) {
    if (!game.raceStarted) {
        broadcastState(io, lobbyId, game, false);
        return;
    }
```

con:

```js
function tickGame(io, lobbyId, game) {
    if (!game.raceStarted) {
        // Falsa partenza: il client inizia a inviare l'input dell'acceleratore
        // già durante la sequenza luci (vedi Task 3), ma la fisica qui sotto
        // resta comunque congelata finché raceStarted è false — ricevere
        // l'input in anticipo serve SOLO al rilevamento, non fa muovere nessuno.
        if (game.lightsSequenceActive) {
            for (const p of Object.values(game.players)) {
                if (!p.falseStart && p.inputs.throttle > 0) p.falseStart = true;
            }
        }
        broadcastState(io, lobbyId, game, false);
        return;
    }
```

- [ ] **Step 7: Penalità scontata al primo pit stop, in `handlePitReactionPress`**

In `handlePitReactionPress` (circa riga 663-677), sostituisci:

```js
    const reactionMs = Date.now() - p.pitGoTime;
    const clamped = Math.min(Math.max(reactionMs, PIT_REACTION_BEST), PIT_REACTION_WORST);
    const t = (clamped - PIT_REACTION_BEST) / (PIT_REACTION_WORST - PIT_REACTION_BEST);
    const durationMs = PIT_DURATION_MIN + t * (PIT_DURATION_MAX - PIT_DURATION_MIN);

    const sid = game.socketByColor[p.color];
    if (sid) io.to(sid).emit('f1PitStopTiming', { durationMs });

    setTimeout(() => completePitStop(io, lobbyId, game, p), durationMs);
```

con:

```js
    const reactionMs = Date.now() - p.pitGoTime;
    const clamped = Math.min(Math.max(reactionMs, PIT_REACTION_BEST), PIT_REACTION_WORST);
    const t = (clamped - PIT_REACTION_BEST) / (PIT_REACTION_WORST - PIT_REACTION_BEST);
    let durationMs = PIT_DURATION_MIN + t * (PIT_DURATION_MAX - PIT_DURATION_MIN);

    // Penalità falsa partenza scontata QUI, alla PRIMA sosta: stesso
    // minigioco di reazione, sosta più lunga di 5s — nessun secondo
    // meccanismo da imparare per il giocatore.
    if (p.falseStart && !p.falseStartServed) {
        durationMs += FALSE_START_PENALTY_MS;
        p.falseStartServed = true;
    }

    const sid = game.socketByColor[p.color];
    if (sid) io.to(sid).emit('f1PitStopTiming', { durationMs });

    setTimeout(() => completePitStop(io, lobbyId, game, p), durationMs);
```

- [ ] **Step 8: Rete di sicurezza in `checkLap`**

In `checkLap` (circa righe 901-910), sostituisci:

```js
        if (p.lap >= totalLaps) {
            p.finished = true;
            p.time     = Date.now() - game.raceStartTime;
            // Obbligo di almeno un pit stop in gara (regola vera F1): chi non
            // ha mai cambiato gomme prende una penalità in tempo a fine gara,
            // non viene bloccato né squalificato.
            if (game.phase === 'race' && !p.hasPitted) {
                p.time += PIT_PENALTY_MS;
                p.pitPenalty = true;
            }
```

con:

```js
        if (p.lap >= totalLaps) {
            p.finished = true;
            p.time     = Date.now() - game.raceStartTime;
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
```

- [ ] **Step 9: Campo `falseStart` in `buildPublicState`**

In `buildPublicState` (circa riga 1184-1211), sostituisci:

```js
            // Autopilota corsia box (entrata/uscita): velocità del
            // limitatore, non del giocatore — il client la usa per un
            // rumore motore fisso invece che legato all'accelerazione,
            // anche quando non è lui a "guidare" in quella fase.
            pitLimiter: !!p.pitAutoState
        };
```

con:

```js
            // Autopilota corsia box (entrata/uscita): velocità del
            // limitatore, non del giocatore — il client la usa per un
            // rumore motore fisso invece che legato all'accelerazione,
            // anche quando non è lui a "guidare" in quella fase.
            pitLimiter: !!p.pitAutoState,
            falseStart: !!p.falseStart
        };
```

- [ ] **Step 10: Campo `falseStart` nel podio, in `endRace`**

In `endRace` (circa riga 931-944), sostituisci:

```js
    const podium = Object.values(game.players)
        .filter(p => p.time !== null)
        .sort((a, b) => a.time - b.time)
        .map(p => ({ color: p.color, totalTime: p.time, pitPenalty: !!p.pitPenalty }));
```

con:

```js
    const podium = Object.values(game.players)
        .filter(p => p.time !== null)
        .sort((a, b) => a.time - b.time)
        .map(p => ({ color: p.color, totalTime: p.time, pitPenalty: !!p.pitPenalty, falseStart: !!p.falseStart }));
```

- [ ] **Step 11: `node --check`**

Run: `node --check "backend/sockets/games/f1GameSocket.js"`
Expected: nessun output (sintassi valida)

- [ ] **Step 12: Verifica statica (nessun test automatico per questo file)**

Rileggi la funzione `tickGame` e conferma che il rilevamento falsa partenza è dentro il ramo `if (!game.raceStarted)` e che NESSUN'ALTRA fisica (integratePosition, resolveCollisions, ecc.) viene eseguita in quel ramo — deve restare identico a prima a parte le righe aggiunte, altrimenti un'auto potrebbe muoversi davvero prima del via. Conferma anche che `game.lightsSequenceActive` non resta mai `true` dopo che `raceStarted` diventa `true` (impostato a `false` nello stesso `setTimeout` che imposta `raceStarted = true`).

---

### Task 2: Frontend HTML/CSS — plancia luci + badge falsa partenza

**Files:**
- Modify: `frontend/f1.html`
- Modify: `frontend/styles/f1.css`

**Interfaces:**
- Consumes: nessuna interfaccia dal Task 1 (solo markup/stile statico)
- Produces: elementi `#lights-board`, `#light-0`...`#light-4` (dentro `#countdown-overlay`, accanto a `#countdown-number` già esistente) e classe `.false-start-badge` — consumati dal Task 3

- [ ] **Step 1: Aggiungi la plancia luci nell'overlay countdown esistente**

In `frontend/f1.html`, dentro il blocco esistente:

```html
    <!-- Overlay countdown -->
    <div id="countdown-overlay" class="overlay" style="display:none;">
        <span id="countdown-label" class="countdown-track" style="letter-spacing:3px;"></span>
        <span id="countdown-track" class="countdown-track"></span>
        <span id="countdown-number" class="countdown-number">3</span>
    </div>
```

sostituisci con:

```html
    <!-- Overlay countdown: testo 3-2-1 per la qualifica, plancia luci per la
         gara (mostrati alternativamente in base alla fase, vedi f1.js) -->
    <div id="countdown-overlay" class="overlay" style="display:none;">
        <span id="countdown-label" class="countdown-track" style="letter-spacing:3px;"></span>
        <span id="countdown-track" class="countdown-track"></span>
        <span id="countdown-number" class="countdown-number">3</span>
        <div id="lights-board" style="display:none;">
            <span class="light-bulb" id="light-0"></span>
            <span class="light-bulb" id="light-1"></span>
            <span class="light-bulb" id="light-2"></span>
            <span class="light-bulb" id="light-3"></span>
            <span class="light-bulb" id="light-4"></span>
        </div>
    </div>
```

- [ ] **Step 2: Stile della plancia luci**

In `frontend/styles/f1.css`, subito dopo il blocco esistente `.countdown-number { ... }` (nella sezione `COUNTDOWN OVERLAY`), aggiungi:

```css
/* Plancia semaforo (solo via gara): pannello scuro con 5 bulbi, spenti di
   default — f1.js li accende uno alla volta via anime.js, poi li spegne
   tutti insieme al via. */
#lights-board {
    display: flex;
    gap: 14px;
    padding: 18px 26px;
    background: #0c0e12;
    border-radius: 16px;
    box-shadow: 0 8px 20px rgba(0,0,0,0.5), inset 0 0 0 2px #2a2f38;
}

.light-bulb {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: #2a0d0d;
    box-shadow: inset 0 0 6px rgba(0,0,0,0.6);
    transition: background 0.15s ease, box-shadow 0.15s ease;
}

.light-bulb.on {
    background: #ff2c2c;
    box-shadow: 0 0 18px 4px rgba(255,44,44,0.85), inset 0 0 6px rgba(255,255,255,0.3);
}
```

- [ ] **Step 3: Stile del badge falsa partenza in classifica**

In `frontend/styles/f1.css`, subito dopo il blocco esistente `.standing-dot { ... }` (nella sezione della classifica), aggiungi:

```css
/* Badge falsa partenza: box rosso pieno con "!" accanto al pallino colore
   del pilota in classifica — visibile a tutti in tempo reale, resta per
   tutta la gara anche dopo che la penalità è stata scontata ai box. */
.false-start-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 3px;
    background: #c0392b;
    color: #fff;
    font-size: 10px;
    font-weight: 900;
    line-height: 1;
    flex-shrink: 0;
}
```

- [ ] **Step 4: Verifica**

Apri i due file e controlla che ogni tag/blocco sia chiuso correttamente. Il rendering vero (luci che si accendono, badge che compare) si verifica nel Task 3, quando il JS le pilota.

---

### Task 3: Frontend JS — plancia luci via anime.js, invio input in anticipo, badge live

**Files:**
- Modify: `frontend/f1.js`

**Interfaces:**
- Consumes: evento socket `f1Countdown` (campo `phase`) e `f1StateUpdate`/`f1RaceEnded` (campo `falseStart`) dal Task 1; markup/classi `#lights-board`, `.light-bulb`/`.on`, `.false-start-badge` dal Task 2
- Produces: nessuna interfaccia per task successivi (ultimo task del piano)

- [ ] **Step 1: Nuova variabile di stato**

In `frontend/f1.js`, vicino alle altre variabili di stato (circa riga 401-409, dove c'è già `let tyrePanelOpen = false;`), aggiungi:

```js
    let lightsSequenceActive = false;   // true durante la plancia luci del via gara (non in qualifica)
```

- [ ] **Step 2: Estendi la guardia di invio input**

In `frontend/f1.js`, dentro `maybeSendInputs()` (circa riga 987-988), sostituisci:

```js
    function maybeSendInputs() {
        if (!isRacing) return;
```

con:

```js
    function maybeSendInputs() {
        // In gara (mai in qualifica) l'input parte già durante la sequenza
        // luci: serve al server SOLO per il rilevamento falsa partenza — la
        // fisica resta congelata lato server finché la gara non parte
        // davvero, quindi non c'è rischio che l'auto si muova prima del via.
        if (!isRacing && !lightsSequenceActive) return;
```

- [ ] **Step 3: Gestisci la plancia luci in `f1Countdown`**

In `frontend/f1.js`, dentro `socket.on('f1Countdown', (data) => { ... })` (circa righe 733-757), sostituisci per intero l'handler:

```js
    socket.on('f1Countdown', (data) => {
        isRacing    = false;
        myFinalTime = null;
        if (tyreSelectActive) exitTyrePreview();   // la qualifica sta per partire: fine anteprima tracciato
        tyreSelectActive = false;
        clearTyreNav();
        document.getElementById('timer-panel').style.display = 'none';
        tyrePanelOpen = false;
        renderTyreVisibility();
        // Nasconde in automatico un'eventuale griglia/animazione/selezione ancora
        // a schermo: evita di dover sincronizzare a mano un timeout lato client
        // con GRID_DISPLAY_MS/TYRE_SELECT_MS del server.
        document.getElementById('podium-modal').style.display = 'none';
        document.getElementById('pole-overlay').style.display = 'none';
        document.getElementById('tyre-select-overlay').style.display = 'none';
        const overlay  = document.getElementById('countdown-overlay');
        const num      = document.getElementById('countdown-number');
        const trackEl  = document.getElementById('countdown-track');
        const labelEl  = document.getElementById('countdown-label');
        if (data?.trackName) trackEl.textContent = data.trackName;
        labelEl.textContent = data?.label || '';
        overlay.style.background = 'rgba(0,0,0,0.65)';
        overlay.style.display    = 'flex';
        num.textContent = '3'; num.style.color = '#e74c3c';
        setTimeout(() => { num.textContent = '2'; num.style.color = '#f39c12'; }, 1000);
        setTimeout(() => { num.textContent = '1'; num.style.color = '#f1c40f'; }, 2000);
    });
```

con:

```js
    socket.on('f1Countdown', (data) => {
        isRacing    = false;
        myFinalTime = null;
        if (tyreSelectActive) exitTyrePreview();   // la qualifica sta per partire: fine anteprima tracciato
        tyreSelectActive = false;
        clearTyreNav();
        document.getElementById('timer-panel').style.display = 'none';
        tyrePanelOpen = false;
        renderTyreVisibility();
        // Nasconde in automatico un'eventuale griglia/animazione/selezione ancora
        // a schermo: evita di dover sincronizzare a mano un timeout lato client
        // con GRID_DISPLAY_MS/TYRE_SELECT_MS del server.
        document.getElementById('podium-modal').style.display = 'none';
        document.getElementById('pole-overlay').style.display = 'none';
        document.getElementById('tyre-select-overlay').style.display = 'none';
        const overlay  = document.getElementById('countdown-overlay');
        const num      = document.getElementById('countdown-number');
        const trackEl  = document.getElementById('countdown-track');
        const labelEl  = document.getElementById('countdown-label');
        const lightsBoard = document.getElementById('lights-board');
        if (data?.trackName) trackEl.textContent = data.trackName;
        labelEl.textContent = data?.label || '';
        overlay.style.background = 'rgba(0,0,0,0.65)';
        overlay.style.display    = 'flex';

        if (data?.phase === 'race') {
            // Plancia luci: 5 bulbi spenti, si accendono uno alla volta ogni
            // LIGHT_INTERVAL_MS (stesso valore lato server, 1000ms), poi
            // restano tutte accese finché non arriva davvero f1RaceStarted
            // (l'attesa casuale la decide solo il server, qui non c'è nessun
            // timer locale che la replica — lo spegnimento è una reazione
            // all'evento, mai un timeout indipendente).
            lightsSequenceActive = true;
            num.style.display = 'none';
            lightsBoard.style.display = 'flex';
            const bulbs = [0, 1, 2, 3, 4].map(i => document.getElementById(`light-${i}`));
            bulbs.forEach(b => b.classList.remove('on'));
            const LIGHT_INTERVAL_MS = 1000;
            bulbs.forEach((bulb, i) => {
                setTimeout(() => {
                    bulb.classList.add('on');
                    anime({ targets: bulb, scale: [1, 1.18, 1], duration: 260, easing: 'easeOutQuad' });
                }, i * LIGHT_INTERVAL_MS);
            });
        } else {
            num.style.display = '';
            lightsBoard.style.display = 'none';
            num.textContent = '3'; num.style.color = '#e74c3c';
            setTimeout(() => { num.textContent = '2'; num.style.color = '#f39c12'; }, 1000);
            setTimeout(() => { num.textContent = '1'; num.style.color = '#f1c40f'; }, 2000);
        }
    });
```

- [ ] **Step 4: Spegni le luci e chiudi la finestra di rilevamento in `f1RaceStarted`**

In `frontend/f1.js`, dentro `socket.on('f1RaceStarted', (data) => { ... })` (circa righe 759-775), sostituisci:

```js
    socket.on('f1RaceStarted', (data) => {
        isRacing    = true;
        myFinalTime = null;
        if (data?.phase) currentPhase = data.phase;
        localStart  = Date.now() - (data?.syncTime || 0);
        const overlay = document.getElementById('countdown-overlay');
        const num     = document.getElementById('countdown-number');
        num.textContent = 'GO!'; num.style.color = '#2ecc71';
        overlay.style.background = 'transparent';
        document.getElementById('timer-panel').style.display = (data?.phase === 'qualifying') ? 'flex' : 'none';
        setTimeout(() => { overlay.style.display = 'none'; }, 800);
        setLapDisplay(0, data?.phase);
        sendInputs();
    });
```

con:

```js
    socket.on('f1RaceStarted', (data) => {
        isRacing             = true;
        lightsSequenceActive = false;
        myFinalTime = null;
        if (data?.phase) currentPhase = data.phase;
        localStart  = Date.now() - (data?.syncTime || 0);
        const overlay = document.getElementById('countdown-overlay');
        const num     = document.getElementById('countdown-number');
        const lightsBoard = document.getElementById('lights-board');
        if (data?.phase === 'race') {
            // Le 5 luci si spengono tutte insieme, sincronizzate con l'arrivo
            // di questo stesso evento (niente testo "GO!" per la gara, lo
            // spegnimento simultaneo è già il segnale di partenza).
            document.querySelectorAll('.light-bulb').forEach(b => b.classList.remove('on'));
        } else {
            num.textContent = 'GO!'; num.style.color = '#2ecc71';
        }
        overlay.style.background = 'transparent';
        document.getElementById('timer-panel').style.display = (data?.phase === 'qualifying') ? 'flex' : 'none';
        setTimeout(() => {
            overlay.style.display = 'none';
            lightsBoard.style.display = 'none';
        }, 800);
        setLapDisplay(0, data?.phase);
        sendInputs();
    });
```

- [ ] **Step 5: Badge falsa partenza in `updateStandings`**

In `frontend/f1.js`, dentro `updateStandings(state)` (circa righe 777-792), sostituisci:

```js
        box.style.display = 'flex';
        box.innerHTML = entries.map(([color, d]) => `
            <div class="standing-entry${color === myColor ? ' me' : ''}">
                <span class="standing-pos">${d.position}°</span>
                <span class="standing-dot" style="background:${color};"></span>
            </div>
        `).join('');
```

con:

```js
        box.style.display = 'flex';
        box.innerHTML = entries.map(([color, d]) => `
            <div class="standing-entry${color === myColor ? ' me' : ''}">
                <span class="standing-pos">${d.position}°</span>
                <span class="standing-dot" style="background:${color};"></span>
                ${d.falseStart ? '<span class="false-start-badge">!</span>' : ''}
            </div>
        `).join('');
```

- [ ] **Step 6: `node --check`**

Run: `node --check "frontend/f1.js"`
Expected: nessun output

- [ ] **Step 7: Verifica manuale (fine piano)**

Due tab in localhost, via gara: un giocatore preme l'acceleratore mentre le luci sono ancora accese (falsa partenza), l'altro aspetta lo spegnimento. Verifica: le 5 luci si accendono una alla volta e si spengono tutte insieme esattamente quando parte la gara (nessuno sfarfallio, nessun testo "GO!" residuo per la gara); il giocatore in fallo mostra subito il badge rosso "!" in classifica; al suo primo pit stop la sosta dura visibilmente ~5s in più; se non si ferma mai ai box, il suo tempo finale include comunque i 5s extra; il badge resta visibile per tutta la gara anche dopo la sosta. Verifica anche che la qualifica sia invariata: countdown testuale 3-2-1, nessuna plancia luci, nessun badge possibile (mai in classifica durante la qualifica, già nascosta in quella fase da una sessione precedente).

## Verifica finale

Oltre al Task 3 Step 7: controlla che una sessione SENZA alcuna falsa partenza si comporti esattamente come prima (nessuna sosta allungata, nessun badge, tempo finale invariato) — la penalità non deve mai scattare per chi parte pulito.
