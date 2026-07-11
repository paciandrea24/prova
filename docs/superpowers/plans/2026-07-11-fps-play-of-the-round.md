# FPS — Play of the Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tra la fine di un round e l'inizio del successivo, riprodurre a tutti i giocatori un replay in prima persona (POV di chi ha fatto la kill) del momento più spettacolare del round — serie ravvicinate di kill (mischia o sudden death) pesano più di headshot o del colpo che chiude il round, mai il contrario.

**Architecture:** Il server (autoritativo sui kill) tiene un log dei kill del round appena concluso, sceglie quello con il punteggio più alto e lo manda a tutti i client con lo stesso identificatore — stesso replay per tutti. Ogni client lo ricostruisce localmente dal proprio buffer di posizione/rotazione (esteso a coprire l'intero round, incluso per il proprio giocatore, oggi assente) usando `PovController` in una nuova modalità `source: 'buffer'` — stesso modulo già usato dalla modalità spettatore live (`source: 'live'`), stessa logica di camera POV.

**Tech Stack:** Vanilla JS, Three.js r128, Socket.io, WebRTC data channel (P2P) con fallback socket.io. Nessun bundler, nessun framework di test automatico nel repo: la verifica è manuale in localhost (più tab), come da convenzione di progetto.

## Global Constraints

- Italiano in tutti i commenti/testi UI aggiunti (convenzione di progetto).
- Nessuna emoji nell'UI — solo testo/glyph unicode monocromatici, coerente col resto dell'HUD.
- Nessuna modifica all'hit detection server-autoritativa esistente (`reportHit` continua a validare/scalare danno come oggi; le uniche aggiunte sono un log kill e un calcolo di scoring, entrambi a valle dell'esito già deciso).
- Non toccare `renderer.outputEncoding`/`toneMapping` (pipeline lineare, vincolo storico del progetto).
- Nessun commit automatico: ogni task termina con un checkpoint di verifica manuale dell'utente in localhost. Il commit/push resta manuale e a discrezione dell'utente (convenzione di progetto, `CLAUDE.md`).
- Segui lo stile dei file esistenti: `fps.js` resta un unico file senza moduli ES, `fpsGameSocket.js` resta un unico file — non spezzare in moduli separati.
- Il replay non è saltabile e non ha camera libera/terza persona: sempre e solo POV di chi ha fatto la kill, sempre per intero.

---

## Contesto per l'implementatore (leggi prima di iniziare)

- Spec di riferimento: `docs/superpowers/specs/2026-07-11-fps-play-of-the-round-design.md`.
- `frontend/fps.js` è un unico file (~4700 righe). I numeri di riga citati sotto sono presi dallo stato attuale del file: se hai già applicato task precedenti di questo piano i numeri più a valle si saranno spostati — usa il testo circostante (mostrato per intero in ogni step) per ritrovare il punto esatto, non fidarti ciecamente del numero.
- `PovController` (già esistente, dal piano "modalità spettatore in sudden death") è l'oggetto che pilota `playerRoot`/`camera`/`weaponGroup` per mostrare la vista di "un altro giocatore" invece della propria. Oggi ha un solo `source: 'live'`: legge `gameState.players[color]` (`rp`) dal vivo. Questo piano aggiunge `source: 'buffer'`, che legge invece da uno storico bufferizzato.
- Convenzioni già in uso che questo piano riusa senza modificarle:
  - `playerRoot` (Object3D) porta la posizione XZ + yaw del giocatore locale; `camera` è **figlio** di `playerRoot` e porta pitch/roll + offset Y altezza-occhi.
  - Per i remoti, `gameState.players[color]` (`rp`) ha `{ group, head, upper, legL, legR, hpBar, hpFill, weaponMount, weaponKey, hp, dead, anim, pitch, ammo, snapshots, _shotSeq, _shotWeapon, _lastRecvShotSeq }`. `rp.snapshots` è il buffer di stati `{t, x, y, z, ry, rx, mv, sp, cr, sl}` alimentato da `applyRemoteState(rp, d)`, usato oggi per interpolare la mesh terza-persona in `updateRemoteAnim`.
  - Sincronizzazione stato: **P2P via WebRTC** (`broadcastState()` sul data channel `state`) con **fallback socket.io** (`sendStateHeartbeat()` → `socket.emit('playerState', ...)`, relayato dal server senza validazione). Stesso schema per gli spari: `broadcastShotFired(weaponKey)` (P2P + `socket.emit('fpsShotFired', ...)`, con `seq` per dedup) → `handleRemoteShot(color, weaponKey, seq)` lato ricevente.
  - `gameState.players = {}` viene **ricreato da zero** ad ogni round in `handleRoundStart` (nuovi oggetti `rp`, quindi `rp.snapshots` riparte vuoto automaticamente ad ogni round — nessuna pulizia esplicita necessaria per i remoti).
  - I colori giocatore sono stringhe CSS dirette (es. `"#ffffff"`), usate così come sono per `style.background`/confronti.
- **Clock**: il server usa `Date.now()` per i timestamp dei kill; i buffer client usano `performance.now()`. Non serve un vero NTP-sync: si usa un **delta nel clock server** (`serverNow - timestamp`, immune a offset/drift client-server) per convertire l'istante del kill in un istante locale approssimato — vedi Task 3.

---

### Task 1: Server — log kill, scoring, pacing dinamico

**Files:**
- Modify: `backend/sockets/games/fpsGameSocket.js` (costanti, `launchRound`, `reportHit`, nuova funzione `pickPlayOfRound`, `checkRoundEnd`)

**Interfaces:**
- Produce: `game.killLog` (array di `{killerColor, targetColor, weaponKey, headshot, timestamp, endsRound}`, azzerato ad ogni `launchRound`). Produce l'evento `roundEnd` esteso con i campi `playOfRound` (oggetto o `null`) e `nextInMs` (già esistente ma ora calcolato dinamicamente invece che costante).
- `playOfRound` (se non `null`) ha la forma: `{ killerColor, victimColor, weaponKey, headshot, streakCount, timestamp, serverNow, preRollMs, postRollMs }` — consumato dal Task 3/4 lato client.

- [ ] **Step 1: Sostituisci `ROUND_END_DELAY` con le nuove costanti di scoring/pacing**

In `backend/sockets/games/fpsGameSocket.js`, trova:
```js
const PLAYER_HP = 100;
const WEAPON_SELECT_TIME = 20000; // 20 secondi per scegliere l'arma (solo round 1)
const ROUND_END_DELAY = 2500;     // pausa breve tra un round e l'altro (pacing "ancora una")
const ROUND_INTRO_TIME = 3500;    // fase INTRO a inizio round: gioco congelato, pannello di preparazione
```
Sostituiscilo con:
```js
const PLAYER_HP = 100;
const WEAPON_SELECT_TIME = 20000; // 20 secondi per scegliere l'arma (solo round 1)
const ROUND_INTRO_TIME = 3500;    // fase INTRO a inizio round: gioco congelato, pannello di preparazione

// ── Play of the Round: scoring del kill "migliore" del round per il replay fine-round ──
const MULTI_KILL_WINDOW = 5000;   // gap massimo (ms) tra kill dello stesso killer per contare come stessa serie
const HEADSHOT_BONUS = 12;
const ENDS_ROUND_BONUS = 8;       // bonus minore: non deve MAI dominare su una serie ravvicinata
const REPLAY_PREROLL_BASE = 4500; // finestra minima di replay prima del colpo scelto
const REPLAY_PREROLL_MAX = 12000; // tetto anche per serie molto lunghe
const REPLAY_POSTROLL = 1200;     // coda dopo il colpo scelto (tempo di "vedere" l'esito)
const SCORE_PAUSE_BASE = 2500;    // pausa "solo overlay punteggi" dopo la clip (era ROUND_END_DELAY)
```

- [ ] **Step 2: Azzera il log kill ad ogni round**

Trova, dentro `launchRound(io, lobbyId)`:
```js
    // Reset timer di fase/respawn del round precedente
    clearAllTimers(game);
    game.respawnTimers = {};
```
Sostituiscilo con:
```js
    // Reset timer di fase/respawn del round precedente
    clearAllTimers(game);
    game.respawnTimers = {};
    game.killLog = [];   // Play of the Round: storico kill del round, azzerato ad ogni round
```

- [ ] **Step 3: Logga ogni kill (mischia E sudden death)**

Trova, dentro `reportHit`:
```js
        if (target.hp <= 0) {
            target.dead = true;
            console.log(`☠ [FPS] kill: ${shooterColor} → ${targetColor} (sub=${game.subphase}, mut=${game.mutator})`);

            // Punti "a teste": ogni kill vale POINTS_PER_KILL al killer (no autogol)
```
Sostituiscilo con:
```js
        if (target.hp <= 0) {
            target.dead = true;
            console.log(`☠ [FPS] kill: ${shooterColor} → ${targetColor} (sub=${game.subphase}, mut=${game.mutator})`);

            // Play of the Round: storico di TUTTI i kill del round (mischia + sudden
            // death), usato a fine round da pickPlayOfRound per scegliere il replay.
            game.killLog.push({
                killerColor: shooterColor, targetColor, weaponKey,
                headshot: !!headshot, timestamp: Date.now(), endsRound: false
            });

            // Punti "a teste": ogni kill vale POINTS_PER_KILL al killer (no autogol)
```

- [ ] **Step 4: Aggiungi la funzione di scoring `pickPlayOfRound`**

Trova (subito prima di `checkRoundEnd`):
```js
function checkRoundEnd(io, lobbyId) {
```
Inserisci **prima** di quella riga:
```js
// Punteggio di una serie di N kill ravvicinate dello stesso killer: 1→0
// (kill isolata, nessun bonus), poi crescente per premiare le serie più lunghe.
function streakBonus(size) {
    if (size <= 1) return 0;
    if (size === 2) return 30;
    if (size === 3) return 70;
    return 120 + (size - 4) * 40;
}

// Sceglie il kill "migliore" del round appena concluso, tra TUTTO il killLog
// (mischia + sudden death). Ritorna null solo se il round non ha avuto kill
// (non dovrebbe mai succedere: checkRoundEnd chiama questa funzione solo
// quando il round sta davvero per chiudersi).
function pickPlayOfRound(game) {
    const log = game.killLog;
    if (!log || log.length === 0) return null;

    let best = null;
    let bestScore = -1;
    for (let i = 0; i < log.length; i++) {
        const kill = log[i];

        // Dimensione della serie: quanti kill consecutivi dello stesso killer
        // precedono (inclusa) questa, con gap <= MULTI_KILL_WINDOW dal precedente.
        let streakStart = i;
        while (streakStart > 0 &&
               log[streakStart - 1].killerColor === kill.killerColor &&
               log[streakStart].timestamp - log[streakStart - 1].timestamp <= MULTI_KILL_WINDOW) {
            streakStart--;
        }

        // Questo kill va valutato solo se è l'ULTIMO della sua serie — altrimenti
        // la stessa serie verrebbe contata (e mostrata come replay) più volte.
        const next = log[i + 1];
        const isLastOfStreak = !next || next.killerColor !== kill.killerColor ||
            next.timestamp - kill.timestamp > MULTI_KILL_WINDOW;
        if (!isLastOfStreak) continue;

        const streakSize = i - streakStart + 1;
        const score = streakBonus(streakSize) +
            (kill.headshot ? HEADSHOT_BONUS : 0) +
            (kill.endsRound ? ENDS_ROUND_BONUS : 0);

        // >= così, a parità di punteggio, vince il kill più recente (i cresce nel tempo).
        if (score >= bestScore) {
            bestScore = score;
            best = { kill, streakSize, firstTimestamp: log[streakStart].timestamp };
        }
    }
    if (!best) return null;

    const span = best.kill.timestamp - best.firstTimestamp;
    const preRollMs = Math.min(REPLAY_PREROLL_MAX, Math.max(REPLAY_PREROLL_BASE, span + 2000));

    return {
        killerColor: best.kill.killerColor,
        victimColor: best.kill.targetColor,
        weaponKey: best.kill.weaponKey,
        headshot: best.kill.headshot,
        streakCount: best.streakSize,
        timestamp: best.kill.timestamp,
        preRollMs,
        postRollMs: REPLAY_POSTROLL
    };
}

```

- [ ] **Step 5: Marca il kill che chiude il round, calcola il replay, sostituisci `ROUND_END_DELAY` col pacing dinamico**

Trova, dentro `checkRoundEnd`:
```js
    game.phase = 'round_end';
    clearAllTimers(game);
    const winner = alive.length === 1 ? alive[0].color : null;
    console.log(`🏁 [FPS] Round ${game.currentRound} chiuso — vincitore=${winner || 'pareggio'}`);

    if (winner) {
        game.scores[winner] = (game.scores[winner] || 0) + 1;
        game.points[winner] = (game.points[winner] || 0) + SD_WIN_BONUS;
    }

    io.to(lobbyId).emit('roundEnd', {
        winnerColor: winner,
        scores: game.scores,
        points: game.points,
        sdBonus: SD_WIN_BONUS,
        round: game.currentRound,
        totalRounds: game.totalRounds,
        nextInMs: ROUND_END_DELAY
    });

    game.currentRound++;

    if (game.currentRound > game.totalRounds) {
        // Partita finita
        setTimeout(() => endGame(io, lobbyId), ROUND_END_DELAY);
    } else {
        // Prossimo round: scelta arma a inizio di OGNI round (l'utente può cambiare loadout)
        setTimeout(() => startWeaponSelect(io, lobbyId), ROUND_END_DELAY);
    }
}
```
Sostituiscilo con:
```js
    game.phase = 'round_end';
    clearAllTimers(game);
    const winner = alive.length === 1 ? alive[0].color : null;
    console.log(`🏁 [FPS] Round ${game.currentRound} chiuso — vincitore=${winner || 'pareggio'}`);

    if (winner) {
        game.scores[winner] = (game.scores[winner] || 0) + 1;
        game.points[winner] = (game.points[winner] || 0) + SD_WIN_BONUS;
    }

    // Play of the Round: marca l'ultimo kill del log come quello che ha chiuso
    // il round (bonus minore nello scoring). Approssimazione accettata: se il
    // round si chiude per disconnessione anziché per un kill, il bonus finisce
    // comunque sull'ultimo kill storico — innocuo, il peso è ridotto (+8).
    if (game.killLog && game.killLog.length) {
        game.killLog[game.killLog.length - 1].endsRound = true;
    }
    const playOfRound = pickPlayOfRound(game);
    const replayDurationMs = playOfRound ? playOfRound.preRollMs + playOfRound.postRollMs : 0;
    const nextInMs = replayDurationMs + SCORE_PAUSE_BASE;

    io.to(lobbyId).emit('roundEnd', {
        winnerColor: winner,
        scores: game.scores,
        points: game.points,
        sdBonus: SD_WIN_BONUS,
        round: game.currentRound,
        totalRounds: game.totalRounds,
        nextInMs,
        playOfRound: playOfRound ? { ...playOfRound, serverNow: Date.now() } : null
    });

    game.currentRound++;

    if (game.currentRound > game.totalRounds) {
        // Partita finita
        setTimeout(() => endGame(io, lobbyId), nextInMs);
    } else {
        // Prossimo round: scelta arma a inizio di OGNI round (l'utente può cambiare loadout)
        setTimeout(() => startWeaponSelect(io, lobbyId), nextInMs);
    }
}
```

- [ ] **Step 6: Verifica manuale (server + console)**

1. `node server.js` da `backend/`. Apri due tab su `localhost:3000`, stesso lobby, entra in FPS.
2. Gioca un round fino alla fine (sudden death). Nella console del server, verifica il log `🏁 [FPS] Round ... chiuso`, poi apri le DevTools di una tab e ascolta l'evento: nel tab Network → WS, oppure aggiungi temporaneamente `console.log(data.playOfRound, data.nextInMs)` dentro `socket.on('roundEnd', ...)` — conferma che `playOfRound` non è mai `null` e contiene `killerColor`/`victimColor`/`timestamp`/`preRollMs`/`postRollMs`/`serverNow` coerenti (es. `killerColor` = chi ha vinto il duello finale).
3. Prova un round con più di una uccisione ravvicinata in mischia (es. respawna e rikilla subito lo stesso avversario due volte in meno di 5s): verifica che `playOfRound.killerColor`/`streakCount` puntino a quella serie e non necessariamente al kill finale del sudden death, e che `preRollMs` sia più alto del solito (> 4500).
4. Rimuovi il `console.log` temporaneo di debug se aggiunto.

**Checkpoint:** attendi conferma dell'utente prima di passare al Task 2.

---

### Task 2: Client — buffering esteso (self + remoto, senza troncamento nel round) e log spari con timestamp

**Files:**
- Modify: `frontend/fps.js` (`applyRemoteState`, `sendStateHeartbeat`, `tryShoot`, `handleRemoteShot`, nuove variabili globali `mySnapshots`/`myShotLog`)

**Interfaces:**
- Produce: `mySnapshots` (array globale, stessa struttura di `rp.snapshots`: `{t, x, y, z, ry, rx, mv, sp, cr, sl}`), `myShotLog` (array globale `{t, weaponKey}`), `rp.shotLog` (array per-player `{t, weaponKey}` su ogni `gameState.players[color]`). Consumati dal Task 3 (`PovController._bufferFor`/`_shotLogFor`).
- `rp.snapshots` non viene più troncato durante il round (rimossa la `splice` a 30 entry) — resta comunque azzerato ad ogni round perché `gameState.players` è ricreato da zero in `handleRoundStart` (nessuna modifica necessaria lì).

- [ ] **Step 1: Rimuovi il troncamento di `rp.snapshots` (buffer per l'intero round, non più solo 1.5-3s)**

Trova:
```js
function applyRemoteState(rp, d) {
    if (!rp.snapshots) rp.snapshots = [];
    rp.snapshots.push({
        t: performance.now(),
        x: d.x, y: d.y, z: d.z, ry: d.ry, rx: d.rx || 0,
        mv: !!d.mv, sp: !!d.sp, cr: !!d.cr, sl: !!d.sl
    });
    // Limita la coda (robustezza se la tab è in background a lungo)
    if (rp.snapshots.length > 60) rp.snapshots.splice(0, rp.snapshots.length - 30);
    // Arma/munizioni: aggiornate subito (valori discreti, non interpolabili)
    if (d.wk) setRemoteWeapon(rp, d.wk);
    if (d.am != null) rp.ammo = d.am;
}
```
Sostituiscilo con:
```js
function applyRemoteState(rp, d) {
    if (!rp.snapshots) rp.snapshots = [];
    rp.snapshots.push({
        t: performance.now(),
        x: d.x, y: d.y, z: d.z, ry: d.ry, rx: d.rx || 0,
        mv: !!d.mv, sp: !!d.sp, cr: !!d.cr, sl: !!d.sl
    });
    // Nota: NON più troncato — il buffer copre l'intero round (serve al replay
    // "Play of the Round"), azzerato ad ogni round perché gameState.players
    // viene ricreato da zero in handleRoundStart.
    // Arma/munizioni: aggiornate subito (valori discreti, non interpolabili)
    if (d.wk) setRemoteWeapon(rp, d.wk);
    if (d.am != null) rp.ammo = d.am;
}
```

- [ ] **Step 2: Buffer di se stesso — nuove variabili globali + push ad ogni heartbeat**

Trova:
```js
// Invio posizione agli altri client (WebRTC + fallback socket)
function sendStateHeartbeat() {
    if (gameState.phase !== 'playing' || gameState.isDead) return;
    broadcastState();
    socket.emit('playerState', {
        lobbyId: LOBBY_ID,
        color: MY_COLOR,
        x: playerRoot.position.x,
        y: playerRoot.position.y,
        z: playerRoot.position.z,
        ry: yaw, rx: pitch,
        mv: isMoving, sp: isSprinting, cr: isCrouching, sl: isSliding,
        wk: gameState.myWeapon, am: gameState.myAmmo
    });
}
```
Sostituiscilo con:
```js
// Buffer locale del proprio movimento — stessa struttura di rp.snapshots,
// stesso ciclo di vita (azzerato ad ogni round in handleRoundStart). Serve al
// replay "Play of the Round" quando il killer scelto sono io: il mio client
// non riceve mai i propri pacchetti di rete, quindi va specchiato qui.
let mySnapshots = [];
let myShotLog = [];   // {t, weaponKey} — spari propri con timestamp, per il replay

// Invio posizione agli altri client (WebRTC + fallback socket)
function sendStateHeartbeat() {
    if (gameState.phase !== 'playing' || gameState.isDead) return;
    mySnapshots.push({
        t: performance.now(),
        x: playerRoot.position.x, y: playerRoot.position.y, z: playerRoot.position.z,
        ry: yaw, rx: pitch,
        mv: isMoving, sp: isSprinting, cr: isCrouching, sl: isSliding
    });
    broadcastState();
    socket.emit('playerState', {
        lobbyId: LOBBY_ID,
        color: MY_COLOR,
        x: playerRoot.position.x,
        y: playerRoot.position.y,
        z: playerRoot.position.z,
        ry: yaw, rx: pitch,
        mv: isMoving, sp: isSprinting, cr: isCrouching, sl: isSliding,
        wk: gameState.myWeapon, am: gameState.myAmmo
    });
}
```

- [ ] **Step 3: Azzera i buffer propri ad ogni round**

Trova, dentro `handleRoundStart(data)`:
```js
function handleRoundStart(data) {
    clearTimeout(roundIntroTimer);
    PovController.exit();   // difensivo: copre resync via fpsInit senza un roundEnd intermedio
    gameState.phase = 'round_intro';   // gioco congelato: input/movimento/sparo bloccati fino a fine intro
```
Sostituiscilo con:
```js
function handleRoundStart(data) {
    clearTimeout(roundIntroTimer);
    PovController.exit();   // difensivo: copre resync via fpsInit senza un roundEnd intermedio
    mySnapshots = [];       // Play of the Round: buffer propri azzerati ad ogni round
    myShotLog = [];
    gameState.phase = 'round_intro';   // gioco congelato: input/movimento/sparo bloccati fino a fine intro
```

- [ ] **Step 4: Log spari con timestamp — se stesso**

Trova, dentro `tryShoot()`:
```js
    gameState.myAmmo--;
    updateAmmoHUD();
    playMuzzleFlash();
    Sfx.shoot(gameState.myWeapon);
    broadcastShotFired(gameState.myWeapon);
```
Sostituiscilo con:
```js
    gameState.myAmmo--;
    updateAmmoHUD();
    playMuzzleFlash();
    Sfx.shoot(gameState.myWeapon);
    broadcastShotFired(gameState.myWeapon);
    myShotLog.push({ t: performance.now(), weaponKey: gameState.myWeapon });
```

- [ ] **Step 5: Log spari con timestamp — remoti**

Trova:
```js
function handleRemoteShot(color, weaponKey, seq) {
    if (color === MY_COLOR) return;
    const rp = gameState.players[color];
    if (!rp) return;
    if (seq != null) {
        if (rp._lastRecvShotSeq != null && seq <= rp._lastRecvShotSeq) return;   // duplicato (P2P + socket.io fallback)
        rp._lastRecvShotSeq = seq;
    }
    rp._shotSeq = (rp._shotSeq || 0) + 1;
    rp._shotWeapon = weaponKey;
}
```
Sostituiscilo con:
```js
function handleRemoteShot(color, weaponKey, seq) {
    if (color === MY_COLOR) return;
    const rp = gameState.players[color];
    if (!rp) return;
    if (seq != null) {
        if (rp._lastRecvShotSeq != null && seq <= rp._lastRecvShotSeq) return;   // duplicato (P2P + socket.io fallback)
        rp._lastRecvShotSeq = seq;
    }
    rp._shotSeq = (rp._shotSeq || 0) + 1;
    rp._shotWeapon = weaponKey;
    if (!rp.shotLog) rp.shotLog = [];
    rp.shotLog.push({ t: performance.now(), weaponKey });
}
```

- [ ] **Step 6: Verifica manuale in localhost (due tab)**

1. Avvia una partita FPS con due tab, gioca un round intero (mischia + sudden death, almeno 30-40s di gioco).
2. Nella console DevTools di una tab, a metà round digita `mySnapshots.length` — conferma che cresce nel tempo (circa 20/s) e **non** si ferma/tronca a 30-60 come prima.
3. Digita `gameState.players['<colore-altra-tab>'].snapshots.length` — stessa verifica per il remoto.
4. Spara qualche colpo (anche a vuoto): digita `myShotLog` e `gameState.players['<colore-altra-tab>'].shotLog` — conferma che ogni sparo aggiunge una entry con `t` crescente e il `weaponKey` corretto.
5. Fai finire il round: verifica che al round successivo `mySnapshots.length` e `myShotLog.length` siano tornati a 0 (azzerati), non accumulati dal round precedente.
6. Nessuna regressione: movimento/mira/spari/hit detection e modalità spettatore live (frecce in sudden death) funzionano come prima in entrambe le tab.

**Checkpoint:** attendi conferma dell'utente prima di passare al Task 3.

---

### Task 3: `PovController` — modalità `source: 'buffer'` + banner "Play of the Round"

**Files:**
- Modify: `frontend/fps.js` (estende `PovController`)
- Modify: `frontend/fps.html` (banner)
- Modify: `frontend/styles/fps.css` (stile banner)

**Interfaces:**
- Consuma: `mySnapshots`, `myShotLog`, `rp.snapshots`, `rp.shotLog` (Task 2); `gameState.players`, `playerRoot`, `camera`, `weaponGroup`, `switchWeaponModel(key)`, `STAND_EYE`/`CROUCH_EYE`/`SLIDE_EYE`, `sizeMul`, `yaw`, `pitch` (globali esistenti); `PovController._playShotFeedback(weaponKey)` (esistente, riusato as-is).
- Produce: `PovController.enterReplay(data, onDone)` dove `data` è il campo `playOfRound` ricevuto da `roundEnd` (Task 1) e `onDone` è una callback invocata a clip terminata (o subito, se il buffer non basta). Consumato dal Task 4.

- [ ] **Step 1: Banner HTML**

In `frontend/fps.html`, trova:
```html
    <!-- ═══════════ BANNER SPETTATORE (sudden death) ═══════════ -->
    <div id="spectator-banner">
        <span id="spectator-dot"></span>
        <span id="spectator-text">Stai osservando</span>
    </div>
```
Subito dopo, aggiungi:
```html

    <!-- ═══════════ BANNER PLAY OF THE ROUND (replay fine-round) ═══════════ -->
    <div id="play-of-round-banner">
        <div id="por-title">Play of the Round</div>
        <div id="por-label"></div>
        <div id="por-headshot-tag">Headshot</div>
    </div>
```

- [ ] **Step 2: Stile del banner**

In `frontend/styles/fps.css`, trova il blocco `#spectator-dot { ... }` e la sua chiusura `}`. Subito dopo, aggiungi:
```css

/* ─── BANNER PLAY OF THE ROUND ──────────────────────────── */
#play-of-round-banner {
    display: none;
    position: fixed;
    top: 14%; left: 50%;
    transform: translateX(-50%);
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 28px;
    background: var(--chip-bg);
    border: 3px solid var(--col-accent);
    border-radius: var(--chip-radius);
    box-shadow: var(--chip-shadow);
    font-family: var(--font-ui);
    text-align: center;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    z-index: 210;
    pointer-events: none;
}
#play-of-round-banner.active { display: flex; }
#por-title {
    font-size: 20px;
    font-weight: 800;
    color: var(--col-text);
}
#por-label {
    font-size: 14px;
    font-weight: 700;
    color: var(--col-accent-hi);
    min-height: 1em;
}
#por-headshot-tag {
    display: none;
    font-size: 12px;
    font-weight: 700;
    color: var(--col-danger);
}
#por-headshot-tag.active { display: block; }
```

- [ ] **Step 3: Funzioni banner (mostra/nascondi)**

In `frontend/fps.js`, trova la definizione dell'oggetto `PovController` (cerca `const PovController = {`). Subito **prima** di quella riga, aggiungi:
```js
// ── Banner "Play of the Round" (replay fine-round) ──
function showPlayOfRoundBanner(data) {
    const el = document.getElementById('play-of-round-banner');
    if (!el) return;
    const label = document.getElementById('por-label');
    const tag = document.getElementById('por-headshot-tag');
    const streakLabels = { 2: 'Doppia Uccisione', 3: 'Tripla Uccisione' };
    label.textContent = data.streakCount >= 4
        ? `Multikill ×${data.streakCount}`
        : (streakLabels[data.streakCount] || '');
    tag.classList.toggle('active', !!data.headshot);
    el.classList.add('active');
}
function hidePlayOfRoundBanner() {
    const el = document.getElementById('play-of-round-banner');
    if (el) el.classList.remove('active');
}

```

- [ ] **Step 4: Estendi `PovController` con la modalità buffer**

Trova, dentro l'oggetto `PovController`, la riga:
```js
    _lastSeenShotSeq: {},
    _recoilPitch: 0, _recoilYaw: 0, _shake: 0,
```
Sostituiscila con:
```js
    _lastSeenShotSeq: {},
    _recoilPitch: 0, _recoilYaw: 0, _shake: 0,
    _replay: null,       // { killerColor, clipStartLocal, clipEndLocal, onDone }, solo se source === 'buffer'
    _replayShotIdx: 0,
```

Trova il metodo `exit() { ... }` (dentro `PovController`):
```js
    exit() {
        if (!this.active) return;
        this.active = false;
        this.targetColor = null;
        this._lastSeenShotSeq = {};
        this._recoilPitch = this._recoilYaw = this._shake = 0;
        document.getElementById('crosshair').style.display = '';
        document.getElementById('spectator-banner').classList.remove('active');
        if (weaponGroup) weaponGroup.visible = false;
    },
```
Sostituiscilo con:
```js
    exit() {
        if (!this.active) return;
        this.active = false;
        this.source = 'live';
        this.targetColor = null;
        this._replay = null;
        this._lastSeenShotSeq = {};
        this._recoilPitch = this._recoilYaw = this._shake = 0;
        document.getElementById('crosshair').style.display = '';
        document.getElementById('spectator-banner').classList.remove('active');
        hidePlayOfRoundBanner();
        if (weaponGroup) weaponGroup.visible = false;
    },

    // Ritorna il buffer di posizione/rotazione del colore dato: il proprio
    // (mySnapshots) se sono io, altrimenti quello remoto (Task 2).
    _bufferFor(color) {
        if (color === MY_COLOR) return mySnapshots;
        const rp = gameState.players[color];
        return rp ? rp.snapshots : null;
    },

    // Ritorna il log spari con timestamp del colore dato (Task 2).
    _shotLogFor(color) {
        if (color === MY_COLOR) return myShotLog;
        const rp = gameState.players[color];
        return rp ? rp.shotLog : null;
    },

    // Ingresso in modalità replay: data è il campo `playOfRound` ricevuto da
    // roundEnd. onDone viene chiamata quando la clip finisce (o subito, se il
    // buffer del killer non copre la finestra richiesta — fallback silenzioso).
    enterReplay(data, onDone) {
        const ageMs = data.serverNow - data.timestamp;   // delta nel clock SERVER, immune a offset client-server
        const killLocal = performance.now() - ageMs;
        const clipStartLocal = killLocal - data.preRollMs;
        const clipEndLocal = killLocal + data.postRollMs;

        const buf = this._bufferFor(data.killerColor);
        if (!buf || buf.length < 2 || buf[0].t > clipStartLocal) {
            onDone();   // buffer insufficiente: nessun replay, si passa oltre
            return;
        }

        this.source = 'buffer';
        this.active = true;
        this.targetColor = data.killerColor;
        this._replay = { killerColor: data.killerColor, clipStartLocal, clipEndLocal, onDone };
        this._lastSeenShotSeq = {};
        this._replayShotIdx = 0;
        this._recoilPitch = this._recoilYaw = this._shake = 0;

        document.getElementById('crosshair').style.display = 'none';
        showPlayOfRoundBanner(data);

        if (data.killerColor !== MY_COLOR) {
            const rp = gameState.players[data.killerColor];
            if (rp) rp.group.visible = false;   // non vogliamo vedere il modello dall'interno
        }
        switchWeaponModel(data.weaponKey);
        if (weaponGroup) weaponGroup.visible = true;
    },

    // Interpola una coppia di snapshot consecutivi al tempo locale t. buf è
    // ordinato per t crescente (stesso ordine di inserimento del buffer).
    _interp(buf, t) {
        if (!buf || buf.length === 0) return null;
        if (t <= buf[0].t) return buf[0];
        if (t >= buf[buf.length - 1].t) return buf[buf.length - 1];
        for (let i = 1; i < buf.length; i++) {
            if (buf[i].t >= t) {
                const s0 = buf[i - 1], s1 = buf[i];
                const span = s1.t - s0.t;
                const f = span > 0 ? (t - s0.t) / span : 0;
                const da = (s1.ry - s0.ry + Math.PI * 3) % (Math.PI * 2) - Math.PI;
                return {
                    x: s0.x + (s1.x - s0.x) * f,
                    y: s0.y + (s1.y - s0.y) * f,
                    z: s0.z + (s1.z - s0.z) * f,
                    ry: s0.ry + da * f,
                    rx: (s0.rx || 0) + ((s1.rx || 0) - (s0.rx || 0)) * f,
                    mv: f < 0.5 ? s0.mv : s1.mv, sp: f < 0.5 ? s0.sp : s1.sp,
                    cr: f < 0.5 ? s0.cr : s1.cr, sl: f < 0.5 ? s0.sl : s1.sl
                };
            }
        }
        return buf[buf.length - 1];
    },

    _updateReplay() {
        const r = this._replay;
        const now = performance.now();
        if (now >= r.clipEndLocal) { this._endReplay(); return; }

        const buf = this._bufferFor(r.killerColor);
        const frame = this._interp(buf, now);
        if (!frame) { this._endReplay(); return; }   // difensivo: non deve succedere dopo il check in enterReplay

        playerRoot.position.set(frame.x, frame.y, frame.z);
        yaw = frame.ry;
        pitch = frame.rx || 0;
        playerRoot.rotation.y = yaw;
        const eyeH = (frame.sl ? SLIDE_EYE : frame.cr ? CROUCH_EYE : STAND_EYE) * sizeMul;
        camera.position.y = eyeH;
        camera.rotation.x = pitch;
        camera.rotation.z = 0;

        // Riproduce, in ordine, gli spari bufferizzati fino all'istante corrente della clip.
        const shots = this._shotLogFor(r.killerColor) || [];
        while (this._replayShotIdx < shots.length && shots[this._replayShotIdx].t <= now) {
            this._playShotFeedback(shots[this._replayShotIdx].weaponKey);
            this._replayShotIdx++;
        }
    },

    _endReplay() {
        const r = this._replay;
        this.active = false;
        this.source = 'live';
        this.targetColor = null;
        this._replay = null;
        document.getElementById('crosshair').style.display = '';
        hidePlayOfRoundBanner();
        if (weaponGroup) weaponGroup.visible = false;
        if (r && r.killerColor !== MY_COLOR) {
            const rp = gameState.players[r.killerColor];
            if (rp) rp.group.visible = !rp.dead;
        }
        if (r && r.onDone) r.onDone();
    },
```

Trova, dentro `update(dt) { ... }` (il metodo esistente, sorgente `'live'`), la primissima riga:
```js
    update(dt) {
        if (!this.active) return;
        const rp = gameState.players[this.targetColor];
```
Sostituiscila con:
```js
    update(dt) {
        if (!this.active) return;
        if (this.source === 'buffer') { this._updateReplay(); return; }
        const rp = gameState.players[this.targetColor];
```

- [ ] **Step 5: Verifica manuale — solo il modulo, non ancora agganciato al flusso di gioco**

Questo task non collega ancora `enterReplay` al `roundEnd` reale (lo fa il Task 4): verifica solo che il modulo non rompa nulla di esistente.
1. Avvia una partita FPS con due tab, gioca fino al sudden death, verifica che la modalità spettatore **live** (frecce ◄/►, muzzle-flash sincronizzato) funzioni esattamente come prima — nessuna regressione da questo task.
2. Apri le DevTools su una tab a partita in corso e digita nella console, mentre sei vivo e in giro per la mappa:
   ```js
   PovController.enterReplay({
       killerColor: MY_COLOR, weaponKey: gameState.myWeapon,
       timestamp: Date.now() - 2000, serverNow: Date.now(),
       preRollMs: 4500, postRollMs: 1200, streakCount: 1, headshot: false
   }, () => console.log('replay finito'));
   ```
   Conferma che: la visuale scatta indietro nel tempo (ti vedi rifare gli ultimi ~5.7s di movimento), il banner "Play of the Round" appare, e dopo ~5.7s in console appare `replay finito` e la visuale torna quella live/normale (puoi muoverti di nuovo).

**Checkpoint:** attendi conferma dell'utente prima di passare al Task 4.

---

### Task 4: Aggancio al flusso fine-round + verifica end-to-end

**Files:**
- Modify: `frontend/fps.js` (`socket.on('roundEnd', ...)`)

**Interfaces:**
- Consuma: `PovController.enterReplay(data, onDone)` (Task 3), `data.playOfRound`/`data.nextInMs` dal payload `roundEnd` (Task 1).

- [ ] **Step 1: Replay prima dell'overlay punteggi**

Trova:
```js
socket.on('roundEnd', (data) => {
    console.log(`[FPS] evento roundEnd: round=${data.round} vincitore=${data.winnerColor}`);
    gameState.scores = data.scores;
    if (data.points) gameState.points = data.points;
    updateScoreHUD();
    PovController.exit();
    showRoundEndOverlay(data);
});
```
Sostituiscilo con:
```js
socket.on('roundEnd', (data) => {
    console.log(`[FPS] evento roundEnd: round=${data.round} vincitore=${data.winnerColor}`);
    gameState.scores = data.scores;
    if (data.points) gameState.points = data.points;
    updateScoreHUD();
    PovController.exit();

    // Play of the Round: il replay va in scena PRIMA dell'overlay punteggi
    // (che parte, col suo countdown, solo a clip finita). Se manca il dato o
    // il mio buffer locale non copre la finestra richiesta (es. sono appena
    // rientrato in partita), niente replay — direttamente all'overlay.
    if (data.playOfRound) {
        PovController.enterReplay(data.playOfRound, () => showRoundEndOverlay(data));
    } else {
        showRoundEndOverlay(data);
    }
});
```

- [ ] **Step 2: Verifica end-to-end in localhost (tre o più tab consigliate)**

1. Apri **tre o più** tab sullo stesso lobby, gioca una partita completa.
2. **Round con un solo kill 1v1** in sudden death: dopo `roundEnd`, TUTTE le tab vedono il replay POV del vincitore (stesso killer per tutti), banner "Play of the Round" senza etichetta serie, poi l'overlay punteggi col countdown — pausa totale relativamente breve (~5-6s).
3. **Round con doppia/tripla uccisione ravvicinata in mischia** (fai in modo che un giocatore ne uccida due nello stesso respawn-loop entro pochi secondi): verifica che il replay scelto sia quello della serie in mischia (non il kill finale del sudden death dello stesso round, a meno che quest'ultimo non sia davvero la kill più significativa), che copra **tutta** la serie (vedi tutti i colpi, non solo l'ultimo), e che il banner mostri "Doppia Uccisione"/"Tripla Uccisione".
4. **Headshot**: se il kill scelto è andato a segno in testa, verifica il tag "Headshot" nel banner.
5. **Il killer del replay sono io**: verifica che il mio stesso POV venga rigiocato correttamente (uso di `mySnapshots`/`myShotLog`), non solo quando il killer è un altro giocatore.
6. **Ultimo round della partita**: verifica che il replay vada comunque in scena prima della sequenza del podio finale (`gameOver`).
7. **Nessun input possibile durante il replay**: prova a muovere il mouse/premere WASD durante la clip — la visuale non deve rispondere (bloccata da `PovController.active`, come già oggi per lo spettatore live).
8. **Nessuna regressione**: mischia/sudden death/spettatore live/HUD/minimap funzionano come prima quando non c'è un replay in corso.

**Checkpoint:** attendi conferma finale dell'utente — Play of the Round completo.

---

## Addendum (post-verifica utente in localhost)

I Task 1-4 sono stati implementati, revisionati e la review finale sull'intero
branch ha trovato e fatto correggere un bug Critical (orologio di replay
assente). La verifica dell'utente in localhost ha però trovato due lacune di
design reali, non colte dal brainstorming originale: nel replay non si vede
nessun altro giocatore (mondo vuoto, si vede solo la telecamera del killer
sparare nel nulla), e l'arma non riflette mai lo stato di mira (ADS) reale del
killer. I Task 5 e 6 correggono queste due lacune, stesso branch/worktree,
stesso flusso subagent-driven-development.

### Task 5: Ricostruzione degli altri giocatori nel replay

**Files:**
- Modify: `frontend/fps.js` (`PovController._updateReplay`, `PovController._endReplay`)

**Interfaces:**
- Consuma: `rp.snapshots` (Task 2, ora bufferizzato per l'intero round), `PovController._interp(buf, t)` (Task 3, esistente, funzione pura riusabile per QUALSIASI buffer/giocatore, non solo il killer), `POSTURE` (const esistente, riusata da `updateRemoteAnim` per lo stesso scopo in modalità live).
- Non introduce nuove interfacce consumate da Task 6 (Task 6 tocca `_updateReplay`/`_endReplay` in punti diversi, non sovrapposti).

**Contesto del problema:** oggi `_updateReplay` muove SOLO la camera del killer (POV). Gli altri giocatori (vittima inclusa) restano fermi/nascosti dov'erano all'ultimo aggiornamento LIVE — che a fine round (sudden death concluso) significa quasi sempre "morti e nascosti" (`rp.group.visible = false`), perché il loop principale di `animate()` salta `updateRemoteAnim(rp, dt)` per i giocatori morti (`if (!rp.dead) updateRemoteAnim(rp, dt);`). Il replay mostra quindi un mondo vuoto: si vede la telecamera del killer muoversi/sparare ma mai il bersaglio.

**Decisione di scope (deliberata, non un'omissione):** i giocatori ricostruiti durante il replay NON hanno il ciclo di cammino gambe animato (resta l'ultima posa statica) — solo posizione/rotazione/postura (in piedi/accovacciato/scivolata) vengono ricostruite dal loro buffer storico. Animare le gambe richiederebbe toccare `rp.anim.phase` (stato condiviso, integrato nel tempo, usato anche dal rendering LIVE) — rischio di desincronizzarlo dopo il replay per un beneficio visivo minore. Non aggiungere l'animazione gambe in questo task.

- [ ] **Step 1: Ricostruisci gli altri giocatori dentro `_updateReplay`**

Trova, alla fine del metodo `_updateReplay(dt)` (dopo il blocco di rinculo/shake, subito prima della chiusura del metodo):
```js
        playerRoot.rotation.y = yaw + this._recoilYaw + shX;
        camera.rotation.x = pitch + this._recoilPitch + shY;
        camera.rotation.z = shZ;
    },
```
Sostituiscilo con:
```js
        playerRoot.rotation.y = yaw + this._recoilYaw + shX;
        camera.rotation.x = pitch + this._recoilPitch + shY;
        camera.rotation.z = shZ;

        // Ricostruisce gli ALTRI giocatori (vittima compresa) alla loro posizione
        // storica nello stesso istante della clip — altrimenti il replay mostra un
        // mondo vuoto (loro mesh restano ferme/nascoste dove le ha lasciate l'ultimo
        // aggiornamento LIVE, che a fine round li mostra già morti/fermi).
        for (const [color, rp] of Object.entries(gameState.players)) {
            if (color === r.killerColor) continue;   // il killer è già gestito (nascosto, è il POV)
            const otherFrame = this._interp(rp.snapshots, cursor);
            if (!otherFrame || !rp.snapshots || rp.snapshots.length === 0 || rp.snapshots[0].t > cursor) {
                rp.group.visible = false;
                continue;
            }
            rp.group.visible = true;
            rp.group.position.set(otherFrame.x, otherFrame.y, otherFrame.z);
            rp.group.rotation.y = otherFrame.ry;
            const p = otherFrame.sl ? POSTURE.slide : otherFrame.cr ? POSTURE.crouch : POSTURE.stand;
            rp.upper.position.y = p.upperY;
            rp.upper.rotation.x = p.tilt;
        }
    },
```

- [ ] **Step 2: Ripristina la visibilità reale di tutti gli altri giocatori a fine replay**

Trova, dentro `_endReplay()`:
```js
        if (r && r.killerColor !== MY_COLOR) {
            const rp = gameState.players[r.killerColor];
            if (rp) rp.group.visible = !rp.dead;
        }
        if (r && r.onDone) r.onDone();
    },
```
Sostituiscilo con:
```js
        if (r && r.killerColor !== MY_COLOR) {
            const rp = gameState.players[r.killerColor];
            if (rp) rp.group.visible = !rp.dead;
        }
        // Ripristina la visibilità REALE (dal vivo) di tutti gli altri giocatori
        // ricostruiti storicamente durante il replay (Task 5).
        if (r) {
            for (const [color, rp] of Object.entries(gameState.players)) {
                if (color === r.killerColor) continue;
                rp.group.visible = !rp.dead;
            }
        }
        if (r && r.onDone) r.onDone();
    },
```

- [ ] **Step 3: Verifica manuale in localhost (3+ tab consigliate)**

1. Gioca un round fino al sudden death con 3+ giocatori, fai terminare il round con un kill.
2. Nel replay: verifica che la VITTIMA del kill scelto sia visibile nella sua posizione storica corretta (non invisibile, non alla posizione di morte attuale) durante tutta la clip.
3. Se il replay copre una serie con più vittime (multi-kill), verifica che compaiano/spariscano coerentemente coi rispettivi istanti di morte all'interno della clip.
4. A clip finita, verifica che TUTTI i giocatori tornino alla visibilità reale corrente (morti restano nascosti, vivi visibili) — nessuna mesh rimasta "congelata" nella posa del replay.
5. Nessuna regressione al rendering LIVE (fuori dal replay) dei giocatori remoti.

**Checkpoint:** attendi conferma dell'utente prima di passare al Task 6.

---

### Task 6: Stato di mira (ADS) riflesso nel replay

**Files:**
- Modify: `frontend/fps.js` (`broadcastState`, `sendStateHeartbeat`, `applyRemoteState`, `PovController._interp`, `PovController.enterReplay`, `PovController._updateReplay`, `PovController._endReplay`)

**Interfaces:**
- Produce: nuovo campo booleano `ad` propagato nell'intera catena stato→buffer→interpolazione (pacchetto di rete P2P/socket → `rp.snapshots`/`mySnapshots` → `PovController._interp` → `frame.ad` letto da `_updateReplay`). Nuovo campo `weaponKey` in `this._replay` (accanto a `killerColor`/`clipStartLocal`/ecc., già esistenti da Task 3).

**Contesto del problema:** lo stato di mira (`isADS`) è oggi puramente locale — non viene mai trasmesso in rete (non serve al gioco live: solo il proprio FOV/viewmodel cambiano quando SI mira, gli altri giocatori non hanno bisogno di saperlo). Per il replay serve invece saperlo: senza, l'arma del killer nel replay è sempre in posizione "da anca", mai zoomata, anche se stava davvero mirando col cecchino quando ha fatto il colpo. Nota collaterale: questo aggiunge il dato anche allo spettatore live esistente (`source: 'live'`), che oggi ha la stessa lacuna — non è richiesto touch aggiuntivo lì, il dato è semplicemente disponibile se in futuro si vorrà usarlo.

**Attenzione (lezione dal fix del leak di rinculo, Task 3):** `_endReplay()` DEVE ripristinare `camera.fov`/il lerp del viewmodel/le classi CSS `ads*` esattamente come li ripristina `exitADS()` — altrimenti un residuo di zoom/scope può "trapelare" nella prossima vista live, stesso identico bug già trovato e corretto per il rinculo.

- [ ] **Step 1: Aggiungi `ad: isADS` al pacchetto di stato broadcast (P2P)**

Trova:
```js
function broadcastState() {
    const msg = JSON.stringify({
        type: 'state',
        color: MY_COLOR,
        x: playerRoot.position.x,
        y: playerRoot.position.y,
        z: playerRoot.position.z,
        ry: yaw, rx: pitch,
        mv: isMoving, sp: isSprinting, cr: isCrouching, sl: isSliding,
        wk: gameState.myWeapon, am: gameState.myAmmo
    });
```
Sostituiscilo con:
```js
function broadcastState() {
    const msg = JSON.stringify({
        type: 'state',
        color: MY_COLOR,
        x: playerRoot.position.x,
        y: playerRoot.position.y,
        z: playerRoot.position.z,
        ry: yaw, rx: pitch,
        mv: isMoving, sp: isSprinting, cr: isCrouching, sl: isSliding, ad: isADS,
        wk: gameState.myWeapon, am: gameState.myAmmo
    });
```

- [ ] **Step 2: Aggiungi `ad: isADS` al buffer locale e al fallback socket.io**

Trova:
```js
function sendStateHeartbeat() {
    if (gameState.phase !== 'playing' || gameState.isDead || PovController.active) return;
    mySnapshots.push({
        t: performance.now(),
        x: playerRoot.position.x, y: playerRoot.position.y, z: playerRoot.position.z,
        ry: yaw, rx: pitch,
        mv: isMoving, sp: isSprinting, cr: isCrouching, sl: isSliding
    });
    broadcastState();
    socket.emit('playerState', {
        lobbyId: LOBBY_ID,
        color: MY_COLOR,
        x: playerRoot.position.x,
        y: playerRoot.position.y,
        z: playerRoot.position.z,
        ry: yaw, rx: pitch,
        mv: isMoving, sp: isSprinting, cr: isCrouching, sl: isSliding,
        wk: gameState.myWeapon, am: gameState.myAmmo
    });
}
```
Sostituiscilo con:
```js
function sendStateHeartbeat() {
    if (gameState.phase !== 'playing' || gameState.isDead || PovController.active) return;
    mySnapshots.push({
        t: performance.now(),
        x: playerRoot.position.x, y: playerRoot.position.y, z: playerRoot.position.z,
        ry: yaw, rx: pitch,
        mv: isMoving, sp: isSprinting, cr: isCrouching, sl: isSliding, ad: isADS
    });
    broadcastState();
    socket.emit('playerState', {
        lobbyId: LOBBY_ID,
        color: MY_COLOR,
        x: playerRoot.position.x,
        y: playerRoot.position.y,
        z: playerRoot.position.z,
        ry: yaw, rx: pitch,
        mv: isMoving, sp: isSprinting, cr: isCrouching, sl: isSliding, ad: isADS,
        wk: gameState.myWeapon, am: gameState.myAmmo
    });
}
```

- [ ] **Step 3: Bufferizza `ad` lato ricevente (giocatori remoti)**

Trova:
```js
function applyRemoteState(rp, d) {
    if (!rp.snapshots) rp.snapshots = [];
    rp.snapshots.push({
        t: performance.now(),
        x: d.x, y: d.y, z: d.z, ry: d.ry, rx: d.rx || 0,
        mv: !!d.mv, sp: !!d.sp, cr: !!d.cr, sl: !!d.sl
    });
```
Sostituiscilo con:
```js
function applyRemoteState(rp, d) {
    if (!rp.snapshots) rp.snapshots = [];
    rp.snapshots.push({
        t: performance.now(),
        x: d.x, y: d.y, z: d.z, ry: d.ry, rx: d.rx || 0,
        mv: !!d.mv, sp: !!d.sp, cr: !!d.cr, sl: !!d.sl, ad: !!d.ad
    });
```

- [ ] **Step 4: Propaga `ad` nell'interpolazione**

Trova, dentro `PovController._interp`:
```js
                    mv: f < 0.5 ? s0.mv : s1.mv, sp: f < 0.5 ? s0.sp : s1.sp,
                    cr: f < 0.5 ? s0.cr : s1.cr, sl: f < 0.5 ? s0.sl : s1.sl
                };
```
Sostituiscilo con:
```js
                    mv: f < 0.5 ? s0.mv : s1.mv, sp: f < 0.5 ? s0.sp : s1.sp,
                    cr: f < 0.5 ? s0.cr : s1.cr, sl: f < 0.5 ? s0.sl : s1.sl,
                    ad: f < 0.5 ? s0.ad : s1.ad
                };
```

- [ ] **Step 5: Salva l'arma del killer in `this._replay` (serve per l'FOV/scope corretti)**

Trova, dentro `enterReplay(data, onDone)`:
```js
        this._replay = { killerColor: data.killerColor, clipStartLocal, clipEndLocal, startedAt: performance.now(), onDone };
```
Sostituiscilo con:
```js
        this._replay = { killerColor: data.killerColor, weaponKey: data.weaponKey, clipStartLocal, clipEndLocal, startedAt: performance.now(), onDone };
```

- [ ] **Step 6: Applica il visual ADS dentro `_updateReplay`**

Trova, dentro `_updateReplay(dt)`:
```js
        camera.rotation.x = pitch;
        camera.rotation.z = 0;

        // Riproduce, in ordine, gli spari bufferizzati fino all'istante corrente della clip.
        const shots = this._shotLogFor(r.killerColor) || [];
```
Sostituiscilo con:
```js
        camera.rotation.x = pitch;
        camera.rotation.z = 0;

        // Riflette lo stato di mira (ADS) bufferizzato del killer: stesso zoom FOV
        // e stesso lerp del viewmodel verso il centro (iron sights) del ramo live
        // (updateMovement), stessa classe CSS body per lo scope del cecchino.
        const adsActive = !!frame.ad && r.weaponKey !== 'sniper';
        _wadsX += ((adsActive ? 0.06 - GX : 0) - _wadsX) * 0.15;
        _wadsY += ((adsActive ? 0.10    : 0) - _wadsY) * 0.15;
        _wadsZ += ((adsActive ? -0.18   : 0) - _wadsZ) * 0.15;
        weaponGroup.position.x = _wadsX;
        weaponGroup.position.y = _wadsY;
        weaponGroup.position.z = _wadsZ;
        camera.fov = frame.ad ? (ADS_FOV[r.weaponKey] ?? 50) : 75;
        camera.updateProjectionMatrix();
        document.body.classList.toggle('ads', !!frame.ad);
        for (const wk of ['assault', 'smg', 'shotgun', 'sniper']) {
            document.body.classList.toggle('ads-' + wk, !!frame.ad && r.weaponKey === wk);
        }

        // Riproduce, in ordine, gli spari bufferizzati fino all'istante corrente della clip.
        const shots = this._shotLogFor(r.killerColor) || [];
```

- [ ] **Step 7: Ripristina FOV/viewmodel/classi ADS a fine replay (come `exitADS()`)**

Trova, dentro `_endReplay()`:
```js
        this._replay = null;
        this._recoilPitch = this._recoilYaw = this._shake = 0;
        document.getElementById('crosshair').style.display = '';
```
Sostituiscilo con:
```js
        this._replay = null;
        this._recoilPitch = this._recoilYaw = this._shake = 0;
        // Ripristina FOV/iron-sights/classi ADS esattamente come exitADS(), per non
        // farli "trapelare" nella prossima vista live (stesso rischio già corretto
        // per il rinculo nel Task 3 — qui è lo stesso identico bug per lo zoom/scope).
        camera.fov = 75;
        camera.updateProjectionMatrix();
        _wadsX = _wadsY = _wadsZ = 0;
        weaponGroup.position.x = 0;
        weaponGroup.position.y = 0;
        weaponGroup.position.z = 0;
        document.body.classList.remove('ads', 'ads-assault', 'ads-smg', 'ads-shotgun', 'ads-sniper');
        document.getElementById('crosshair').style.display = '';
```

- [ ] **Step 8: Verifica manuale in localhost (due tab bastano)**

1. Fai in modo che il kill scelto per il replay sia stato fatto MENTRE il killer era in ADS (tasto destro/mira, es. col cecchino): verifica che nel replay l'arma sia visibilmente in iron-sights/con lo scope del cecchino nell'istante giusto della clip, non sempre "da anca".
2. Verifica che il FOV/zoom cambi coerentemente entrando/uscendo dall'ADS durante la clip (se il killer ha mirato solo per una parte della finestra).
3. A clip finita, verifica che la TUA vista torni normale (FOV 75, nessuna classe `ads*` residua, arma in posizione normale) — nessun trapelamento nella vista live successiva.
4. Nessuna regressione: mirare live (fuori dal replay) funziona come prima.

**Checkpoint:** attendi conferma finale dell'utente — Play of the Round completo (inclusi Task 5/6).

---

## Addendum 2 (debug sistematico post-Task 5/6)

Dopo Task 5/6 l'utente ha riportato: "adesso non viene proprio mostrato il replay" —
overlay punteggi immediato, ma con un countdown insolitamente lungo (~20s+).
Investigazione (vedi sessione): nessun errore console (esclude un crash), il
countdown lungo implica che il server AVEVA scelto un replay con finestra ampia
ma il client non lo mostra mai → il fallback silenzioso di `enterReplay`
(`buf[0].t > clipStartLocal`) scatta sistematicamente.

**Causa radice**: `rp.snapshots` (bufferizzato per l'intero round dal Task 2,
usato dal replay) viene **azzerato ad ogni respawn in mischia di un giocatore
remoto** (`rp.snapshots = []`, due punti preesistenti nel file — PRIMA di
Play of the Round, per evitare uno scivolamento visivo dell'interpolazione
live tra il punto di morte e il nuovo spawn). La mischia è esattamente dove
capitano le serie di kill ravvicinate che il replay dovrebbe premiare: se il
killer del kill scelto rinasce anche una sola volta prima che il round
finisca (probabile in una mischia affollata), il suo buffer perde la
finestra storica necessaria. L'assunzione scritta nel piano originale
("nessuna pulizia esplicita necessaria per i remoti") era incompleta: vera
per i confini di ROUND, falsa per i respawn IN-round.

**Fix**: un buffer separato e mai azzerato durante il round (`rp.replayLog`),
alimentato in parallelo a `rp.snapshots` ma usato SOLO dal replay — così
l'interpolazione live (che usa ancora `rp.snapshots`, wipe compreso) resta
invariata, e il replay smette di perdere la storia ai respawn.

**Bug collaterale trovato durante l'indagine (non la causa radice, ma
spiega il countdown confuso)**: `showRoundEndOverlay` mostra sempre
`data.nextInMs` per intero come countdown, anche quando il replay ha già
consumato parte di quel tempo (o è stato saltato) — il numero mostrato non
riflette mai quanto tempo resta DAVVERO prima del round successivo. Corretto
in questo stesso task.

### Task 7: Buffer replay mai azzerato + countdown overlay accurato

**Files:**
- Modify: `frontend/fps.js` (`applyRemoteState`, `PovController._bufferFor`, `socket.on('roundEnd', ...)`, `showRoundEndOverlay`)

**Interfaces:**
- Produce: `rp.replayLog` (array, stessa forma di `rp.snapshots`, MAI azzerato durante il round — nemmeno ai respawn), consumato da `PovController._bufferFor` per i colori remoti al posto di `rp.snapshots`.
- `showRoundEndOverlay(data, remainingMs)` guadagna un secondo parametro opzionale: se presente, usato per il countdown al posto di `data.nextInMs`.

- [ ] **Step 1: Alimenta un buffer replay parallelo, mai azzerato**

Trova:
```js
function applyRemoteState(rp, d) {
    if (!rp.snapshots) rp.snapshots = [];
    rp.snapshots.push({
        t: performance.now(),
        x: d.x, y: d.y, z: d.z, ry: d.ry, rx: d.rx || 0,
        mv: !!d.mv, sp: !!d.sp, cr: !!d.cr, sl: !!d.sl, ad: !!d.ad
    });
    // Nota: NON più troncato — il buffer copre l'intero round (serve al replay
    // "Play of the Round"), azzerato ad ogni round perché gameState.players
    // viene ricreato da zero in handleRoundStart.
    // Arma/munizioni: aggiornate subito (valori discreti, non interpolabili)
    if (d.wk) setRemoteWeapon(rp, d.wk);
    if (d.am != null) rp.ammo = d.am;
}
```
Sostituiscilo con:
```js
function applyRemoteState(rp, d) {
    if (!rp.snapshots) rp.snapshots = [];
    rp.snapshots.push({
        t: performance.now(),
        x: d.x, y: d.y, z: d.z, ry: d.ry, rx: d.rx || 0,
        mv: !!d.mv, sp: !!d.sp, cr: !!d.cr, sl: !!d.sl, ad: !!d.ad
    });
    // rp.snapshots resta soggetto al reset "rp.snapshots = []" sui respawn
    // (serve all'interpolazione LIVE, per evitare uno scivolamento visivo tra
    // punto di morte e nuovo spawn — comportamento preesistente, invariato).
    //
    // rp.replayLog è un buffer GEMELLO ma indipendente, mai azzerato durante
    // il round (nemmeno ai respawn in mischia): è quello che il replay "Play
    // of the Round" legge, perché la storia dei respawn è esattamente ciò che
    // serve per rigiocare le serie di kill in mischia. Azzerato solo a inizio
    // round (gameState.players ricreato da zero in handleRoundStart).
    if (!rp.replayLog) rp.replayLog = [];
    rp.replayLog.push({
        t: performance.now(),
        x: d.x, y: d.y, z: d.z, ry: d.ry, rx: d.rx || 0,
        mv: !!d.mv, sp: !!d.sp, cr: !!d.cr, sl: !!d.sl, ad: !!d.ad
    });
    // Arma/munizioni: aggiornate subito (valori discreti, non interpolabili)
    if (d.wk) setRemoteWeapon(rp, d.wk);
    if (d.am != null) rp.ammo = d.am;
}
```

- [ ] **Step 2: Il replay legge dal buffer nuovo, non da quello che si azzera**

Trova, dentro `PovController`:
```js
    _bufferFor(color) {
        if (color === MY_COLOR) return mySnapshots;
        const rp = gameState.players[color];
        return rp ? rp.snapshots : null;
    },
```
Sostituiscilo con:
```js
    _bufferFor(color) {
        if (color === MY_COLOR) return mySnapshots;
        const rp = gameState.players[color];
        return rp ? rp.replayLog : null;
    },
```

- [ ] **Step 3: Countdown dell'overlay basato sul tempo DAVVERO rimasto**

Trova:
```js
socket.on('roundEnd', (data) => {
    console.log(`[FPS] evento roundEnd: round=${data.round} vincitore=${data.winnerColor}`);
    gameState.scores = data.scores;
    if (data.points) gameState.points = data.points;
    updateScoreHUD();
    PovController.exit();

    // Play of the Round: il replay va in scena PRIMA dell'overlay punteggi
    // (che parte, col suo countdown, solo a clip finita). Se manca il dato o
    // il mio buffer locale non copre la finestra richiesta (es. sono appena
    // rientrato in partita), niente replay — direttamente all'overlay.
    if (data.playOfRound) {
        PovController.enterReplay(data.playOfRound, () => showRoundEndOverlay(data));
    } else {
        showRoundEndOverlay(data);
    }
});
```
Sostituiscilo con:
```js
socket.on('roundEnd', (data) => {
    console.log(`[FPS] evento roundEnd: round=${data.round} vincitore=${data.winnerColor}`);
    gameState.scores = data.scores;
    if (data.points) gameState.points = data.points;
    updateScoreHUD();
    PovController.exit();

    // data.nextInMs è il ritardo TOTALE (replay + pausa) che il server ha
    // riservato, misurato dal SUO istante di emissione. Se il replay va in
    // scena, consuma parte di quel tempo prima che l'overlay compaia: il
    // countdown mostrato deve riflettere quanto resta DAVVERO, non ripartire
    // da capo con la durata piena (altrimenti il countdown mostrato è quasi
    // il doppio dell'attesa reale prima del round successivo).
    const roundEndAt = performance.now();
    const proceed = () => {
        const elapsed = performance.now() - roundEndAt;
        const remainingMs = Math.max(0, (data.nextInMs || 2500) - elapsed);
        showRoundEndOverlay(data, remainingMs);
    };

    // Play of the Round: il replay va in scena PRIMA dell'overlay punteggi
    // (che parte, col suo countdown, solo a clip finita). Se manca il dato o
    // il mio buffer locale non copre la finestra richiesta (es. sono appena
    // rientrato in partita), niente replay — direttamente all'overlay.
    if (data.playOfRound) {
        PovController.enterReplay(data.playOfRound, proceed);
    } else {
        proceed();
    }
});
```

- [ ] **Step 4: `showRoundEndOverlay` usa il tempo rimasto, se fornito**

Trova, dentro `showRoundEndOverlay`:
```js
function showRoundEndOverlay(data) {
```
Sostituiscilo con:
```js
function showRoundEndOverlay(data, remainingMs) {
```

Trova, poco più sotto nella stessa funzione:
```js
    let sec = Math.max(1, Math.ceil((data.nextInMs || 2500) / 1000));
```
Sostituiscilo con:
```js
    let sec = Math.max(1, Math.ceil((remainingMs != null ? remainingMs : (data.nextInMs || 2500)) / 1000));
```

- [ ] **Step 5: Verifica manuale in localhost (3+ tab, scenario mischia intenso)**

1. Gioca un round con 3+ giocatori e fai in modo che il killer della serie migliore muoia e rinasca ALMENO una volta in mischia dopo aver fatto la sua serie (es. tenta un'uccisione, muori, rinasci, continua a giocare) prima che il round arrivi al sudden death e finisca.
2. Verifica che il replay questa volta VADA in scena (non più fallback silenzioso) — il killer scelto può benissimo essere qualcuno rinato nel frattempo.
3. Verifica che il countdown dell'overlay, quando appare (dopo il replay), mostri un numero ragionevole (vicino ai ~2-3s della pausa base), non più 15-20+ secondi.
4. Ripeti anche un round SENZA respawn intermedi (1v1 pulito): nessuna regressione, il replay funziona come nei test precedenti.
5. Nessuna regressione all'interpolazione LIVE dei giocatori remoti (`rp.snapshots` invariato, ancora azzerato ai respawn come prima).

**Checkpoint:** attendi conferma finale dell'utente.

---

## Addendum 3 (barre vita incoerenti nel replay)

L'utente ha segnalato: "la vita che si visualizza è strana, alcuni avevano un po', altri un po' di più, altri un po' di meno". Il "movimento fermo" segnalato in
parallelo si è rivelato un falso allarme (test con giocatori parcheggiati fermi
apposta, non un bug — verificato con log diagnostico poi rimosso, non
committato). Le barre vita sono invece un problema reale.

**Causa**: la barra vita 3D sopra la testa di ogni nemico (`rp.hpBar`/
`rp.hpFill`) è aggiornata da `updateHealthbar(rp)`, chiamata SOLO da
`updateRemoteAnim(rp, dt)` — che il loop principale chiama SOLO per i
giocatori vivi (`if (!rp.dead) updateRemoteAnim(rp, dt);`). Il Task 5 non
chiama mai `updateHealthbar` per i giocatori ricostruiti nel replay: la
barra resta quindi congelata a QUALUNQUE valore avesse l'ULTIMO
aggiornamento LIVE prima che quel giocatore diventasse "morto" e venisse
saltato dal loop — un valore diverso per ciascuno, a seconda di quando
esattamente è morto rispetto a quando ha perso vita l'ultima volta. Non
riflette la vita storica dell'istante del replay (che comunque non è mai
stata bufferizzata — fuori scope, coerente con la decisione già presa per
l'HUD in prima persona).

**Fix**: dato che non abbiamo dati storici della vita per il replay,
nascondere semplicemente la barra durante la ricostruzione (Task 5) invece
di mostrare un valore congelato e fuorviante — meglio nessuna barra che una
sbagliata. Nessun ripristino esplicito necessario a fine replay:
`updateHealthbar` ricalcola la visibilità corretta ad ogni frame LIVE
successivo per chi torna vivo, e per chi resta morto la barra deve comunque
restare nascosta (stesso comportamento che `updateHealthbar` avrebbe dato).

### Task 8: Nascondi la barra vita per i giocatori ricostruiti nel replay

**Files:**
- Modify: `frontend/fps.js` (`PovController._updateReplay`, loop di ricostruzione altri giocatori del Task 5)

**Interfaces:**
- Nessuna nuova interfaccia: usa `rp.hpBar` (già esistente, prodotto da `createPlayerMesh`).

- [ ] **Step 1: Nascondi la barra vita quando un giocatore viene ricostruito nel replay**

Trova, dentro `_updateReplay`, il loop del Task 5:
```js
            rp.group.visible = true;
            rp.group.position.set(otherFrame.x, otherFrame.y, otherFrame.z);
            rp.group.rotation.y = otherFrame.ry;
            const p = otherFrame.sl ? POSTURE.slide : otherFrame.cr ? POSTURE.crouch : POSTURE.stand;
            rp.upper.position.y = p.upperY;
            rp.upper.rotation.x = p.tilt;
        }
```
Sostituiscilo con:
```js
            rp.group.visible = true;
            rp.group.position.set(otherFrame.x, otherFrame.y, otherFrame.z);
            rp.group.rotation.y = otherFrame.ry;
            const p = otherFrame.sl ? POSTURE.slide : otherFrame.cr ? POSTURE.crouch : POSTURE.stand;
            rp.upper.position.y = p.upperY;
            rp.upper.rotation.x = p.tilt;
            // Non bufferizziamo la vita storica: mostrare il valore LIVE congelato
            // (quello che aveva l'ultimo aggiornamento prima di uscire dal loop live)
            // sarebbe fuorviante e diverso per ogni giocatore. Meglio nascosta che
            // sbagliata — updateHealthbar() la farà ricomparire correttamente non
            // appena il giocatore torna ad essere aggiornato dal vivo.
            if (rp.hpBar) rp.hpBar.visible = false;
        }
```

- [ ] **Step 2: Verifica manuale in localhost**

1. Gioca un round dove un nemico ricostruito nel replay aveva vita ridotta (< 100) nell'istante mostrato: verifica che NON compaia più una barra vita sopra la sua testa durante il replay (né corretta né sbagliata — semplicemente assente).
2. A round successivo, con quello stesso giocatore di nuovo vivo e danneggiato: verifica che la barra vita torni a comparire normalmente in modalità LIVE (nessuna regressione).

**Checkpoint:** attendi conferma finale dell'utente.

---

## Self-review (svolto durante la stesura)

- **Copertura spec:** requisito 1 (POV di chi ha fatto il kill) → Task 3/4; requisito 2 (scoring serie/headshot/round-decisivo, pesi) → Task 1 Step 4; requisito 3 (stesso replay per tutti) → Task 1 Step 5 (`playOfRound` unico nel payload broadcast); requisito 4 (mai terza persona/camera libera) → Task 3 `_updateReplay` scrive solo `playerRoot`/`camera`, mai un mesh terzo; requisito 5 (durata dinamica, copre l'intera serie) → Task 1 Step 4 (`preRollMs` da `span`); requisito 6 (non saltabile) → nessun listener di skip aggiunto in nessun task; requisito 7 (replay prima dell'overlay, ogni round incluso l'ultimo) → Task 4 Step 1; requisito 8 (nessuna regressione hit detection) → Task 1 tocca solo codice a valle di `target.hp <= 0` già deciso, nessuna modifica alla validazione danno.
- **Placeholder:** nessun TBD/TODO; ogni step ha codice completo, nessun riferimento a funzioni non definite in questo piano o nel codice esistente già letto.
- **Coerenza dei nomi:** `game.killLog`/`pickPlayOfRound`/`streakBonus` (Task 1) riusati identici in Task 1 Step 5; `mySnapshots`/`myShotLog`/`rp.shotLog` (Task 2) riusati identici in `PovController._bufferFor`/`_shotLogFor` (Task 3); `PovController.enterReplay(data, onDone)` (Task 3) firma riusata identica nel `socket.on('roundEnd', ...)` (Task 4); campo payload `playOfRound` (Task 1: `killerColor, victimColor, weaponKey, headshot, streakCount, timestamp, serverNow, preRollMs, postRollMs`) usato con gli stessi nomi in `enterReplay`/`showPlayOfRoundBanner` (Task 3) — nessuna rinominazione tra i task.

---

## Addendum 4 (pre-implementazione, dopo verifica utente su Task 1-8)

Spec di riferimento: `docs/superpowers/specs/2026-07-11-fps-play-of-the-round-design.md`,
sezione "Addendum 4". Tre lacune reali segnalate dall'utente dopo aver
provato i Task 1-8 in localhost: le vittime non muoiono mai nel replay
(restano congelate), i giocatori ricostruiti non hanno ciclo di camminata
(traslano soltanto), e manca un annuncio prima del cut alla POV.

I Task 9-12 sotto correggono queste tre lacune, stesso branch/worktree
(`fps-play-of-the-round`), stesso flusso subagent-driven-development.

### Task 9: Server — includi l'elenco kill della finestra in `playOfRound`

**Files:**
- Modify: `backend/sockets/games/fpsGameSocket.js` (`pickPlayOfRound`)

**Interfaces:**
- Produce: `playOfRound.kills` — array `{targetColor, timestamp}` (timestamp = `Date.now()` server, stesso clock di `playOfRound.timestamp`), una entry per ogni kill (di QUALUNQUE killer, non solo quello premiato) il cui `timestamp` cade nella finestra `[best.kill.timestamp - preRollMs, best.kill.timestamp + postRollMs]`. Consumato dal Task 10.

- [ ] **Step 1: Calcola e aggiungi `kills` al risultato di `pickPlayOfRound`**

In `backend/sockets/games/fpsGameSocket.js`, trova:
```js
    if (!best) return null;

    const span = best.kill.timestamp - best.firstTimestamp;
    const preRollMs = Math.min(REPLAY_PREROLL_MAX, Math.max(REPLAY_PREROLL_BASE, span + 2000));

    return {
        killerColor: best.kill.killerColor,
        victimColor: best.kill.targetColor,
        weaponKey: best.kill.weaponKey,
        headshot: best.kill.headshot,
        streakCount: best.streakSize,
        timestamp: best.kill.timestamp,
        preRollMs,
        postRollMs: REPLAY_POSTROLL
    };
}
```
Sostituiscilo con:
```js
    if (!best) return null;

    const span = best.kill.timestamp - best.firstTimestamp;
    const preRollMs = Math.min(REPLAY_PREROLL_MAX, Math.max(REPLAY_PREROLL_BASE, span + 2000));
    const postRollMs = REPLAY_POSTROLL;

    // Elenco di TUTTE le kill (qualunque killer, non solo quello premiato) cadute
    // nella finestra della clip — serve al client (Task 10) per nascondere ogni
    // vittima nell'istante esatto in cui è morta davvero, non solo quella del
    // kill "vincitore" dello scoring. Copre anche vittime "di contorno" morte
    // per mano di un altro giocatore nello stesso arco di tempo.
    const windowStart = best.kill.timestamp - preRollMs;
    const windowEnd = best.kill.timestamp + postRollMs;
    const kills = log
        .filter(k => k.timestamp >= windowStart && k.timestamp <= windowEnd)
        .map(k => ({ targetColor: k.targetColor, timestamp: k.timestamp }));

    return {
        killerColor: best.kill.killerColor,
        victimColor: best.kill.targetColor,
        weaponKey: best.kill.weaponKey,
        headshot: best.kill.headshot,
        streakCount: best.streakSize,
        timestamp: best.kill.timestamp,
        preRollMs,
        postRollMs,
        kills
    };
}
```

- [ ] **Step 2: Verifica manuale (server + console)**

1. `node server.js` da `backend/`. Apri due-tre tab su `localhost:3000`, stesso lobby, entra in FPS.
2. Gioca un round con almeno due kill diverse (es. una doppia uccisione in mischia). Aggiungi temporaneamente `console.log(JSON.stringify(playOfRound))` subito dopo la chiamata a `pickPlayOfRound(game)` dentro `checkRoundEnd` — verifica nella console del server che `kills` contenga un'entry per OGNI kill avvenuta nella finestra (non solo quella "vincitrice"), con `targetColor`/`timestamp` coerenti col log `☠ [FPS] kill: ...` già stampato da `reportHit`.
3. Rimuovi il `console.log` temporaneo.

**Checkpoint:** attendi conferma dell'utente prima di passare al Task 10.

---

### Task 10: Client — nascondi le vittime nel replay all'istante esatto di morte

**Files:**
- Modify: `frontend/fps.js` (`PovController.enterReplay`, `PovController._updateReplay`)

**Interfaces:**
- Consuma: `data.kills` (Task 9, array `{targetColor, timestamp}` in clock server).
- Produce: `this._replay.deathsByColor` — oggetto `{ [color]: localTimestamp }`, il timestamp locale (stessa base di `clipStartLocal`/`clipEndLocal`) dell'ultima morte nota di quel colore nella finestra. Consumato internamente da `_updateReplay`.

- [ ] **Step 1: Calcola `deathsByColor` in `enterReplay`**

Trova, dentro `PovController.enterReplay(data, onDone)`:
```js
        this.source = 'buffer';
        this.active = true;
        this.targetColor = data.killerColor;
        // startedAt ancora l'orologio di replay: il cursore di riproduzione avanza
        // da clipStartLocal in tempo reale a partire da questo istante, NON legge
        // performance.now() direttamente (che è già ben oltre la finestra passata).
        this._replay = { killerColor: data.killerColor, weaponKey: data.weaponKey, clipStartLocal, clipEndLocal, startedAt: performance.now(), onDone };
```
Sostituiscilo con:
```js
        this.source = 'buffer';
        this.active = true;
        this.targetColor = data.killerColor;

        // Converte ogni timestamp di morte (clock SERVER, da data.kills) nello
        // stesso istante locale usato dal cursore di riproduzione: la differenza
        // tra il timestamp di una kill e quello dell'ancora (data.timestamp) è
        // un delta puro di clock server, quindi si somma direttamente a killLocal
        // (già convertito). Se un colore muore più volte nella finestra (raro:
        // respawn in mischia seguito da una seconda morte), si tiene l'ultima —
        // resta nascosto dalla sua morte più recente fino a fine clip (nessuna
        // "resurrezione" visiva a metà replay, fuori scope).
        const deathsByColor = {};
        for (const k of (data.kills || [])) {
            const localT = killLocal + (k.timestamp - data.timestamp);
            if (deathsByColor[k.targetColor] == null || localT > deathsByColor[k.targetColor]) {
                deathsByColor[k.targetColor] = localT;
            }
        }

        // startedAt ancora l'orologio di replay: il cursore di riproduzione avanza
        // da clipStartLocal in tempo reale a partire da questo istante, NON legge
        // performance.now() direttamente (che è già ben oltre la finestra passata).
        this._replay = { killerColor: data.killerColor, weaponKey: data.weaponKey, clipStartLocal, clipEndLocal, startedAt: performance.now(), deathsByColor, onDone };
```

- [ ] **Step 2: Nascondi la vittima quando il cursore supera il suo istante di morte**

Trova, dentro `_updateReplay(dt)`, il loop di ricostruzione degli altri giocatori:
```js
        for (const [color, rp] of Object.entries(gameState.players)) {
            if (color === r.killerColor) continue;   // il killer è già gestito (nascosto, è il POV)
            // _bufferFor(color) legge rp.replayLog (mai azzerato ai respawn), non
            // rp.snapshots (azzerato ad ogni respawn in mischia per l'interpolazione
            // LIVE) — stesso fix del buffer del killer, applicato qui perché anche
            // la ricostruzione degli ALTRI giocatori nel replay è un consumo "replay",
            // non "live", e soffriva dello stesso bug (vittima invisibile se rinata
            // durante la finestra del replay).
            const otherBuf = this._bufferFor(color);
            const otherFrame = this._interp(otherBuf, cursor);
            if (!otherFrame || !otherBuf || otherBuf.length === 0 || otherBuf[0].t > cursor) {
                rp.group.visible = false;
                continue;
            }
```
Sostituiscilo con:
```js
        for (const [color, rp] of Object.entries(gameState.players)) {
            if (color === r.killerColor) continue;   // il killer è già gestito (nascosto, è il POV)
            // _bufferFor(color) legge rp.replayLog (mai azzerato ai respawn), non
            // rp.snapshots (azzerato ad ogni respawn in mischia per l'interpolazione
            // LIVE) — stesso fix del buffer del killer, applicato qui perché anche
            // la ricostruzione degli ALTRI giocatori nel replay è un consumo "replay",
            // non "live", e soffriva dello stesso bug (vittima invisibile se rinata
            // durante la finestra del replay).
            const otherBuf = this._bufferFor(color);
            const otherFrame = this._interp(otherBuf, cursor);
            // Nasconde la vittima esattamente nell'istante in cui è morta davvero
            // (Task 9/10) — identico al comportamento già esistente quando muore
            // dal vivo (dead=true, group.visible=false), nessuna animazione nuova.
            const deathLocal = r.deathsByColor ? r.deathsByColor[color] : null;
            const isDeadByNow = deathLocal != null && cursor >= deathLocal;
            if (isDeadByNow || !otherFrame || !otherBuf || otherBuf.length === 0 || otherBuf[0].t > cursor) {
                rp.group.visible = false;
                continue;
            }
```

- [ ] **Step 3: Verifica manuale in localhost (3+ tab consigliate)**

1. Gioca un round con una doppia/tripla uccisione ravvicinata (mischia o sudden death): verifica che OGNI vittima sparisca dal replay esattamente nel momento in cui il killer l'ha davvero colpita a morte — non prima, non "congelata" fino alla fine della clip.
2. Round con 3+ giocatori dove una vittima diversa da quella del kill "premiato" muore comunque nella finestra della clip (es. un terzo giocatore ucciso da qualcun altro nello stesso arco di tempo): verifica che sparisca anche lei al momento giusto.
3. Nessuna regressione: il killer (POV) e gli altri giocatori ancora vivi a fine clip restano visibili e si muovono correttamente.

**Checkpoint:** attendi conferma dell'utente prima di passare al Task 11.

---

### Task 11: Client — animazione di camminata per i giocatori ricostruiti nel replay

**Files:**
- Modify: `frontend/fps.js` (`PovController` — nuovo stato `_replayAnimPhase`, `_updateReplay`)

**Interfaces:**
- Produce: `PovController._replayAnimPhase` — oggetto `{ [color]: number }`, fase locale al replay (MAI scritta su `rp.anim.phase`, condiviso col rendering LIVE). Azzerato ad ogni `enterReplay`.
- Riusa, senza modificarle: le costanti di ciclo gambe già usate da `updateRemoteAnim` (`rate = sprint ? 13 : 9`, `swing = sprint ? 0.95 : 0.6`).

- [ ] **Step 1: Aggiungi lo stato `_replayAnimPhase`**

Trova, dentro `PovController`:
```js
    _replay: null,       // { killerColor, clipStartLocal, clipEndLocal, onDone }, solo se source === 'buffer'
    _replayShotIdx: 0,
```
Sostituiscilo con:
```js
    _replay: null,       // { killerColor, clipStartLocal, clipEndLocal, onDone }, solo se source === 'buffer'
    _replayShotIdx: 0,
    _replayAnimPhase: {},   // { [color]: number } — fase LOCALE del ciclo gambe nel replay, mai rp.anim.phase
```

- [ ] **Step 2: Azzera `_replayAnimPhase` all'ingresso del replay**

Trova, dentro `enterReplay(data, onDone)`, subito dopo il blocco `deathsByColor` aggiunto nel Task 10 (prima della riga `this._replay = { killerColor: ...`):
```js
        this._replay = { killerColor: data.killerColor, weaponKey: data.weaponKey, clipStartLocal, clipEndLocal, startedAt: performance.now(), deathsByColor, onDone };
```
Sostituiscilo con:
```js
        this._replayAnimPhase = {};
        this._replay = { killerColor: data.killerColor, weaponKey: data.weaponKey, clipStartLocal, clipEndLocal, startedAt: performance.now(), deathsByColor, onDone };
```

- [ ] **Step 3: Anima le gambe dei giocatori ricostruiti**

Trova, dentro `_updateReplay(dt)`, la parte finale del loop di ricostruzione (dopo il fix del Task 10):
```js
            rp.group.visible = true;
            rp.group.position.set(otherFrame.x, otherFrame.y, otherFrame.z);
            rp.group.rotation.y = otherFrame.ry;
            const p = otherFrame.sl ? POSTURE.slide : otherFrame.cr ? POSTURE.crouch : POSTURE.stand;
            rp.upper.position.y = p.upperY;
            rp.upper.rotation.x = p.tilt;
            // Non bufferizziamo la vita storica: mostrare il valore LIVE congelato
            // (quello che aveva l'ultimo aggiornamento prima di uscire dal loop live)
            // sarebbe fuorviante e diverso per ogni giocatore. Meglio nascosta che
            // sbagliata — updateHealthbar() la farà ricomparire correttamente non
            // appena il giocatore torna ad essere aggiornato dal vivo.
            if (rp.hpBar) rp.hpBar.visible = false;
        }
```
Sostituiscilo con:
```js
            rp.group.visible = true;
            rp.group.position.set(otherFrame.x, otherFrame.y, otherFrame.z);
            rp.group.rotation.y = otherFrame.ry;
            const p = otherFrame.sl ? POSTURE.slide : otherFrame.cr ? POSTURE.crouch : POSTURE.stand;
            rp.upper.position.y = p.upperY;
            rp.upper.rotation.x = p.tilt;

            // Ciclo gambe: STESSA formula di updateRemoteAnim (rate/swing identici),
            // ma con una fase LOCALE al replay (mai rp.anim.phase, che è condiviso
            // col rendering LIVE) — altrimenti i giocatori ricostruiti restano fermi
            // e sembrano traslare invece di camminare.
            if (this._replayAnimPhase[color] == null) this._replayAnimPhase[color] = 0;
            if (otherFrame.mv && !otherFrame.sl) {
                const rate = otherFrame.sp ? 13 : 9;
                const swing = otherFrame.sp ? 0.95 : 0.6;
                this._replayAnimPhase[color] += dt * rate;
                rp.legL.rotation.x = Math.sin(this._replayAnimPhase[color]) * swing;
                rp.legR.rotation.x = -Math.sin(this._replayAnimPhase[color]) * swing;
            } else {
                const k2 = Math.min(1, dt * 10);
                rp.legL.rotation.x += (0 - rp.legL.rotation.x) * k2;
                rp.legR.rotation.x += (0 - rp.legR.rotation.x) * k2;
                if (otherFrame.sl) { rp.legL.rotation.x = 0.5; rp.legR.rotation.x = -0.2; }
                this._replayAnimPhase[color] = 0;
            }

            // Non bufferizziamo la vita storica: mostrare il valore LIVE congelato
            // (quello che aveva l'ultimo aggiornamento prima di uscire dal loop live)
            // sarebbe fuorviante e diverso per ogni giocatore. Meglio nascosta che
            // sbagliata — updateHealthbar() la farà ricomparire correttamente non
            // appena il giocatore torna ad essere aggiornato dal vivo.
            if (rp.hpBar) rp.hpBar.visible = false;
        }
```

- [ ] **Step 4: Verifica manuale in localhost**

1. Gioca un round con almeno un altro giocatore che si muove (a piedi o in sprint) poco prima di essere ucciso in un momento che finisce nel replay: verifica che nel replay le sue gambe animino il passo (non più traslazione rigida), a velocità coerente con camminata/sprint.
2. Giocatore fermo (non `mv`) nel replay: gambe ferme, nessuna animazione spuria.
3. Nessuna regressione al rendering LIVE (`updateRemoteAnim`, `rp.anim.phase`) fuori dal replay.

**Checkpoint:** attendi conferma dell'utente prima di passare al Task 12.

---

### Task 12: Annuncio pre-replay (schermata nera) + pacing server + blocco input

**Files:**
- Modify: `backend/sockets/games/fpsGameSocket.js` (nuova costante, `checkRoundEnd`)
- Modify: `frontend/fps.html` (nuovo overlay)
- Modify: `frontend/styles/fps.css` (stile overlay)
- Modify: `frontend/fps.js` (`PovController.enterReplay` diviso in due fasi, nuovo metodo `_startReplayPlayback`, `PovController.exit`)

**Interfaces:**
- Produce: `ANNOUNCE_DURATION` (server, ms) sommato a `nextInMs` quando `playOfRound` non è `null`. Produce `PovController._startReplayPlayback(data, killLocal, clipStartLocal, clipEndLocal, onDone)` (privato, chiamato da `enterReplay` dopo il timer dell'annuncio) e `PovController._announceTimer` (id del timeout, ripulito da `exit()`).
- Consuma: nessuna nuova interfaccia esterna — riusa `data.playOfRound`/`data.nextInMs` (Task 1) invariati nella forma.

**Attenzione (clock):** `killLocal`/`clipStartLocal`/`clipEndLocal` vanno calcolati UNA SOLA VOLTA, all'istante di ricezione dell'evento (dentro `enterReplay`, `performance.now()` chiamato lì), e passati così come sono a `_startReplayPlayback` — MAI ricalcolati dopo il `setTimeout` dell'annuncio. Ricalcolarli a quel punto userebbe un `performance.now()` più avanzato di `ANNOUNCE_DURATION_MS`, sfasando l'intera finestra letta dal buffer (stesso tipo di bug di clock già trovato e corretto in passato, vedi Addendum al Task 4 nella cronologia commit — `5e445f0`).

- [ ] **Step 1: Costante server + pacing**

In `backend/sockets/games/fpsGameSocket.js`, trova:
```js
const SCORE_PAUSE_BASE = 2500;    // pausa "solo overlay punteggi" dopo la clip (era ROUND_END_DELAY)
```
Sostituiscilo con:
```js
const SCORE_PAUSE_BASE = 2500;    // pausa "solo overlay punteggi" dopo la clip (era ROUND_END_DELAY)
const ANNOUNCE_DURATION = 1500;   // schermata nera "Play of the Round" prima del cut alla POV (solo se c'è un replay)
```

Trova, dentro `checkRoundEnd`:
```js
    const playOfRound = pickPlayOfRound(game);
    const replayDurationMs = playOfRound ? playOfRound.preRollMs + playOfRound.postRollMs : 0;
    const nextInMs = replayDurationMs + SCORE_PAUSE_BASE;
```
Sostituiscilo con:
```js
    const playOfRound = pickPlayOfRound(game);
    const announceDurationMs = playOfRound ? ANNOUNCE_DURATION : 0;
    const replayDurationMs = playOfRound ? playOfRound.preRollMs + playOfRound.postRollMs : 0;
    const nextInMs = announceDurationMs + replayDurationMs + SCORE_PAUSE_BASE;
```

- [ ] **Step 2: Overlay HTML**

In `frontend/fps.html`, trova:
```html
    <!-- ═══════════ BANNER PLAY OF THE ROUND (replay fine-round) ═══════════ -->
    <div id="play-of-round-banner">
        <div id="por-title">Play of the Round</div>
        <div id="por-label"></div>
        <div id="por-headshot-tag">Headshot</div>
    </div>
```
Subito dopo, aggiungi:
```html

    <!-- ═══════════ ANNUNCIO PLAY OF THE ROUND (schermata nera pre-replay) ═══════════ -->
    <div id="play-of-round-announce">
        <span>Play of the Round</span>
    </div>
```

- [ ] **Step 3: Stile overlay**

In `frontend/styles/fps.css`, trova il blocco `#por-headshot-tag { ... }` e la sua chiusura `}` (subito dopo `#por-label`). Alla fine di quel blocco, aggiungi:
```css

/* ─── ANNUNCIO PLAY OF THE ROUND (schermata nera pre-replay) ───── */
#play-of-round-announce {
    display: none;
    position: fixed;
    inset: 0;
    background: #000;
    z-index: 350;
    align-items: center;
    justify-content: center;
    font-family: var(--font-ui);
}
#play-of-round-announce.active { display: flex; }
#play-of-round-announce span {
    font-size: 42px;
    font-weight: 800;
    color: var(--col-text);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    text-shadow: 0 0 40px rgba(255,255,255,0.25);
}
```

- [ ] **Step 4: Dividi `enterReplay` in due fasi (annuncio poi cut)**

In `frontend/fps.js`, trova il metodo `enterReplay` per intero (con dentro, ormai, anche il blocco `deathsByColor` del Task 10 e `this._replayAnimPhase = {}` del Task 11):
```js
    enterReplay(data, onDone) {
        const ageMs = data.serverNow - data.timestamp;   // delta nel clock SERVER, immune a offset client-server
        const killLocal = performance.now() - ageMs;
        const clipStartLocal = killLocal - data.preRollMs;
        const clipEndLocal = killLocal + data.postRollMs;

        const buf = this._bufferFor(data.killerColor);
        if (!buf || buf.length < 2 || buf[0].t > clipStartLocal) {
            onDone();   // buffer insufficiente: nessun replay, si passa oltre
            return;
        }

        this.source = 'buffer';
        this.active = true;
        this.targetColor = data.killerColor;

        // Converte ogni timestamp di morte (clock SERVER, da data.kills) nello
        // stesso istante locale usato dal cursore di riproduzione: la differenza
        // tra il timestamp di una kill e quello dell'ancora (data.timestamp) è
        // un delta puro di clock server, quindi si somma direttamente a killLocal
        // (già convertito). Se un colore muore più volte nella finestra (raro:
        // respawn in mischia seguito da una seconda morte), si tiene l'ultima —
        // resta nascosto dalla sua morte più recente fino a fine clip (nessuna
        // "resurrezione" visiva a metà replay, fuori scope).
        const deathsByColor = {};
        for (const k of (data.kills || [])) {
            const localT = killLocal + (k.timestamp - data.timestamp);
            if (deathsByColor[k.targetColor] == null || localT > deathsByColor[k.targetColor]) {
                deathsByColor[k.targetColor] = localT;
            }
        }

        // startedAt ancora l'orologio di replay: il cursore di riproduzione avanza
        // da clipStartLocal in tempo reale a partire da questo istante, NON legge
        // performance.now() direttamente (che è già ben oltre la finestra passata).
        this._replayAnimPhase = {};
        this._replay = { killerColor: data.killerColor, weaponKey: data.weaponKey, clipStartLocal, clipEndLocal, startedAt: performance.now(), deathsByColor, onDone };
        this._lastSeenShotSeq = {};
        this._replayShotIdx = 0;
        this._recoilPitch = this._recoilYaw = this._shake = 0;

        document.getElementById('crosshair').style.display = 'none';
        showPlayOfRoundBanner(data);

        if (data.killerColor !== MY_COLOR) {
            const rp = gameState.players[data.killerColor];
            if (rp) rp.group.visible = false;   // non vogliamo vedere il modello dall'interno
        }
        switchWeaponModel(data.weaponKey);
        if (weaponGroup) weaponGroup.visible = true;
    },
```
Sostituiscilo con:
```js
    enterReplay(data, onDone) {
        const ageMs = data.serverNow - data.timestamp;   // delta nel clock SERVER, immune a offset client-server
        const killLocal = performance.now() - ageMs;
        const clipStartLocal = killLocal - data.preRollMs;
        const clipEndLocal = killLocal + data.postRollMs;

        const buf = this._bufferFor(data.killerColor);
        if (!buf || buf.length < 2 || buf[0].t > clipStartLocal) {
            onDone();   // buffer insufficiente: nessun replay, si passa oltre (niente annuncio)
            return;
        }

        // Annuncio: schermata nera per ANNOUNCE_DURATION_MS. active=true SUBITO
        // (non solo al cut) — i guard d'input esistenti (updateMovement, mousemove,
        // tryShoot, ecc.) sono già condizionati su PovController.active, quindi
        // bloccano input/mira/sparo per l'intera sequenza annuncio+replay senza
        // bisogno di nuovi controlli sparsi nel codice.
        this.source = 'buffer';
        this.active = true;
        document.getElementById('crosshair').style.display = 'none';
        const announceEl = document.getElementById('play-of-round-announce');
        if (announceEl) announceEl.classList.add('active');

        // killLocal/clipStartLocal/clipEndLocal sono ancorati all'istante di
        // RICEZIONE dell'evento (ora): passati così come sono a
        // _startReplayPlayback, MAI ricalcolati dopo il timer dell'annuncio.
        this._announceTimer = setTimeout(() => {
            this._announceTimer = null;
            if (announceEl) announceEl.classList.remove('active');
            this._startReplayPlayback(data, killLocal, clipStartLocal, clipEndLocal, onDone);
        }, ANNOUNCE_DURATION_MS);
    },

    // Fase 2 dell'ingresso in replay: il vero "cut" alla POV del killer, eseguito
    // dopo la schermata nera dell'annuncio. killLocal/clipStartLocal/clipEndLocal
    // arrivano già calcolati da enterReplay (vedi nota sul clock sopra).
    _startReplayPlayback(data, killLocal, clipStartLocal, clipEndLocal, onDone) {
        this.targetColor = data.killerColor;

        // Converte ogni timestamp di morte (clock SERVER, da data.kills) nello
        // stesso istante locale usato dal cursore di riproduzione: la differenza
        // tra il timestamp di una kill e quello dell'ancora (data.timestamp) è
        // un delta puro di clock server, quindi si somma direttamente a killLocal
        // (già convertito). Se un colore muore più volte nella finestra (raro:
        // respawn in mischia seguito da una seconda morte), si tiene l'ultima —
        // resta nascosto dalla sua morte più recente fino a fine clip (nessuna
        // "resurrezione" visiva a metà replay, fuori scope).
        const deathsByColor = {};
        for (const k of (data.kills || [])) {
            const localT = killLocal + (k.timestamp - data.timestamp);
            if (deathsByColor[k.targetColor] == null || localT > deathsByColor[k.targetColor]) {
                deathsByColor[k.targetColor] = localT;
            }
        }

        // startedAt ancora l'orologio di replay: il cursore di riproduzione avanza
        // da clipStartLocal in tempo reale a partire da questo istante, NON legge
        // performance.now() direttamente (che è già ben oltre la finestra passata).
        this._replayAnimPhase = {};
        this._replay = { killerColor: data.killerColor, weaponKey: data.weaponKey, clipStartLocal, clipEndLocal, startedAt: performance.now(), deathsByColor, onDone };
        this._lastSeenShotSeq = {};
        this._replayShotIdx = 0;
        this._recoilPitch = this._recoilYaw = this._shake = 0;

        showPlayOfRoundBanner(data);

        if (data.killerColor !== MY_COLOR) {
            const rp = gameState.players[data.killerColor];
            if (rp) rp.group.visible = false;   // non vogliamo vedere il modello dall'interno
        }
        switchWeaponModel(data.weaponKey);
        if (weaponGroup) weaponGroup.visible = true;
    },
```

- [ ] **Step 5: Costante `ANNOUNCE_DURATION_MS` lato client**

Trova, subito prima di `function showPlayOfRoundBanner(data) {`:
```js
// ── Banner "Play of the Round" (replay fine-round) ──
function showPlayOfRoundBanner(data) {
```
Sostituiscilo con:
```js
const ANNOUNCE_DURATION_MS = 1500;   // schermata nera pre-replay — DEVE combaciare con ANNOUNCE_DURATION sul server (pacing)

// ── Banner "Play of the Round" (replay fine-round) ──
function showPlayOfRoundBanner(data) {
```

- [ ] **Step 6: Ripulisci il timer dell'annuncio in `exit()` (resync/disconnessione durante l'annuncio)**

Trova:
```js
    exit() {
        if (!this.active) return;
        this.active = false;
        this.source = 'live';
        this.targetColor = null;
        this._replay = null;
        this._lastSeenShotSeq = {};
        this._recoilPitch = this._recoilYaw = this._shake = 0;
        document.getElementById('crosshair').style.display = '';
        document.getElementById('spectator-banner').classList.remove('active');
        hidePlayOfRoundBanner();
        if (weaponGroup) weaponGroup.visible = false;
    },
```
Sostituiscilo con:
```js
    exit() {
        if (!this.active) return;
        this.active = false;
        this.source = 'live';
        this.targetColor = null;
        this._replay = null;
        if (this._announceTimer) { clearTimeout(this._announceTimer); this._announceTimer = null; }
        const announceEl = document.getElementById('play-of-round-announce');
        if (announceEl) announceEl.classList.remove('active');
        this._lastSeenShotSeq = {};
        this._recoilPitch = this._recoilYaw = this._shake = 0;
        document.getElementById('crosshair').style.display = '';
        document.getElementById('spectator-banner').classList.remove('active');
        hidePlayOfRoundBanner();
        if (weaponGroup) weaponGroup.visible = false;
    },
```

- [ ] **Step 7: Verifica manuale end-to-end in localhost (3+ tab consigliate)**

1. Gioca un round che termina con un `playOfRound` valido: verifica che TUTTE le tab, subito dopo `roundEnd`, mostrino per ~1.5s una schermata nera con il testo "Play of the Round", poi il cut alla POV del killer (banner "Doppia/Tripla Uccisione"/"Headshot" invariato, appare solo durante la clip come prima).
2. Durante la schermata nera, prova a muovere il mouse / premere WASD / cliccare per sparare su una tab del giocatore che NON è morto in quel round (es. il vincitore): verifica che NON succeda nulla (input bloccato, come già durante il replay vero e proprio).
3. Verifica che il countdown dell'overlay punteggi (dopo il replay) resti coerente (~2-3s, non più lungo del previsto) — l'`ANNOUNCE_DURATION` è già incluso nel `nextInMs` calcolato dal server.
4. Round SENZA `playOfRound` (fallback, es. buffer insufficiente su una tab appena riconnessa): quella tab NON mostra l'annuncio né il replay, passa direttamente all'overlay punteggi, nessun blocco.
5. Nessuna regressione ai Task 9/10/11 (vittime che spariscono al momento giusto, animazione di camminata) e ai Task 1-8 precedenti.

**Checkpoint:** attendi conferma finale dell'utente — Addendum 4 completo.

---

## Self-review (Addendum 4)

- **Copertura:** Problema 1 (vittime non muoiono) → Task 9 (dato mancante lato server) + Task 10 (uso del dato lato client); Problema 2 (nessuna animazione) → Task 11; Problema 3 (annuncio mancante + pacing + blocco input) → Task 12.
- **Placeholder:** nessun TBD; ogni step ha codice completo con anchor "Trova" presi dal file reale nel worktree (letto direttamente, non dal testo di questo piano) dopo i Task 1-8.
- **Coerenza dei nomi:** `data.kills`/`deathsByColor` (Task 9/10) riusati identici in Task 11/12; `_replayAnimPhase` (Task 11) introdotto una volta, riusato in Task 12 senza rinominazioni; `_startReplayPlayback`/`_announceTimer`/`ANNOUNCE_DURATION_MS` (Task 12, client) e `ANNOUNCE_DURATION` (Task 12, server) — nomi diversi client/server perché sono costanti indipendenti in file diversi (commentato esplicitamente "DEVE combaciare" nello Step 5, nessun meccanismo di condivisione automatica esiste altrove nel progetto).
- **Ordine delle modifiche a `enterReplay`:** il Task 12 Step 4 include per intero anche le modifiche dei Task 10 e 11 nel blocco "Trova", perché tutte e tre toccano lo stesso metodo — un implementatore che esegue i task in ordine (9→10→11→12) troverà il codice esattamente in quello stato.
