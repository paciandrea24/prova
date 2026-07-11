# FPS — Modalità spettatore in Sudden Death Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando un giocatore muore in sudden death, invece della dead-screen statica entra automaticamente in una modalità spettatore in prima persona reale su un giocatore vivo, con switch manuale/automatico tra i sopravvissuti — riusando un modulo `PovController` pensato per essere il nucleo condiviso col futuro "Play of the Round".

**Architecture:** Tutto interamente client-side (`frontend/fps.js`), zero cambi all'hit detection autoritativa del server. Tre aggiunte al netcode P2P esistente (pitch, munizioni, evento "shot fired") alimentano un nuovo modulo `PovController` che, quando attivo, sovrascrive ogni frame `playerRoot`/`camera`/HUD con i dati (interpolati) del giocatore osservato — esattamente come oggi vengono già interpolati i modelli remoti in terza persona.

**Tech Stack:** Vanilla JS, Three.js r128, Socket.io, WebRTC data channel (P2P) con fallback socket.io. Nessun bundler, nessun framework di test automatico nel repo: la verifica è manuale in localhost (due o più tab), come da convenzione di progetto.

## Global Constraints

- Italiano in tutti i commenti/testi UI aggiunti (convenzione di progetto).
- Nessuna emoji nell'UI — solo testo/glyph unicode monocromatici, coerente col resto dell'HUD.
- Nessuna modifica all'hit detection server-autoritativa (`reportHit`/`playerHit`/`playerKilled` in `backend/sockets/games/fpsGameSocket.js` restano invariati). Le uniche modifiche server sono un nuovo relay P2P-fallback, analogo a `playerState`.
- Non toccare `renderer.outputEncoding`/`toneMapping` (pipeline lineare, vincolo storico del progetto).
- Nessun commit automatico: ogni task termina con una checkpoint di verifica manuale dell'utente in localhost. Il commit/push resta manuale e a discrezione dell'utente (convenzione di progetto, `CLAUDE.md`).
- Segui lo stile del file esistente: un unico `fps.js` senza moduli ES (`<script>` classico) — non spezzare in file separati.

---

## Contesto per l'implementatore (leggi prima di iniziare)

- `frontend/fps.js` è un unico file (~4500 righe). I numeri di riga citati sotto sono presi dallo stato attuale del file: se hai già applicato task precedenti di questo piano i numeri più a valle si saranno spostati di qualche riga — usa il testo circostante (mostrato per intero in ogni step) per ritrovare il punto esatto, non fidarti ciecamente del numero.
- Convenzioni già in uso che questo piano riusa senza modificarle:
  - `playerRoot` (Object3D) porta la posizione XZ + yaw del giocatore locale; `camera` è **figlio** di `playerRoot` e porta solo pitch/roll + l'offset Y dell'altezza-occhi. `weaponGroup`/`muzzleLight`/`muzzleStar` sono figli di `camera`.
  - Per i remoti, `gameState.players[color]` (`rp`) ha `{ group, head, upper, legL, legR, hpBar, hpFill, weaponMount, weaponKey, hp, dead, anim }`. `rp.group` è la mesh terza-persona, posizionata/ruotata ogni frame da `updateRemoteAnim(rp, dt)` interpolando `rp.snapshots` (buffer alimentato da `applyRemoteState`).
  - I colori giocatore (`MY_COLOR`, le chiavi di `gameState.players`) sono stringhe CSS dirette (es. `"#ffffff"`), usate così com'è per `style.background`.
  - Sincronizzazione stato: **P2P via WebRTC** (`broadcastState()` sul data channel `state`) con **fallback socket.io** (`socket.emit('playerState', ...)`, relayato dal server senza validazione in `backend/sockets/games/fpsGameSocket.js`).

---

### Task 1: Netcode — pitch, munizioni, evento "shot fired"

**Files:**
- Modify: `frontend/fps.js` (funzioni `applyRemoteState`, `updateRemoteAnim`, `broadcastState`, `sendStateHeartbeat`, `handlePeerData`, `tryShoot`, i due punti di creazione di `gameState.players[color]`)
- Modify: `backend/sockets/games/fpsGameSocket.js` (nuovo handler di relay)

**Interfaces:**
- Produce: campo `rp.pitch` (number, radianti, aggiornato ogni frame da `updateRemoteAnim`) e `rp.ammo` (number|null, aggiornato immediatamente da `applyRemoteState`) su ogni oggetto `rp` di `gameState.players`. Produce inoltre `rp._shotSeq` (contatore incrementale) e `rp._shotWeapon` (string), aggiornati da `handleRemoteShot(color, weaponKey)` ogni volta che quel giocatore spara (anche a vuoto).
- Consumato dal Task 2 (`rp.pitch`, `rp.ammo`) e dal Task 4 (`rp._shotSeq`, `rp._shotWeapon`).

- [ ] **Step 1: Estendi `applyRemoteState` con pitch (nel buffer di interpolazione) e munizioni (immediate)**

In `frontend/fps.js`, trova:
```js
function applyRemoteState(rp, d) {
    if (!rp.snapshots) rp.snapshots = [];
    rp.snapshots.push({
        t: performance.now(),
        x: d.x, y: d.y, z: d.z, ry: d.ry,
        mv: !!d.mv, sp: !!d.sp, cr: !!d.cr, sl: !!d.sl
    });
    // Limita la coda (robustezza se la tab è in background a lungo)
    if (rp.snapshots.length > 60) rp.snapshots.splice(0, rp.snapshots.length - 30);
    // Arma: aggiorna subito (valore discreto, non interpolabile)
    if (d.wk) setRemoteWeapon(rp, d.wk);
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
    // Limita la coda (robustezza se la tab è in background a lungo)
    if (rp.snapshots.length > 60) rp.snapshots.splice(0, rp.snapshots.length - 30);
    // Arma/munizioni: aggiornate subito (valori discreti, non interpolabili)
    if (d.wk) setRemoteWeapon(rp, d.wk);
    if (d.am != null) rp.ammo = d.am;
}
```

- [ ] **Step 2: Estendi `updateRemoteAnim` per interpolare anche il pitch**

Trova (nello stesso file, la funzione `updateRemoteAnim`):
```js
        if (snaps.length === 1) {
            // Primo snapshot: applica subito in attesa del secondo
            const s = snaps[0];
            rp.group.position.set(s.x, s.y, s.z);
            rp.group.rotation.y = s.ry;
            if (rp.anim) {
```
Sostituiscilo con:
```js
        if (snaps.length === 1) {
            // Primo snapshot: applica subito in attesa del secondo
            const s = snaps[0];
            rp.group.position.set(s.x, s.y, s.z);
            rp.group.rotation.y = s.ry;
            rp.pitch = s.rx;
            if (rp.anim) {
```

Poi trova, poco sotto:
```js
                // Rotazione: percorso angolare più breve (evita spin di 360°)
                const da = (s1.ry - s0.ry + Math.PI * 3) % (Math.PI * 2) - Math.PI;
                rp.group.rotation.y = s0.ry + da * t;
                // Stato animazione dall'ultimo snapshot "raggiunto"
```
Sostituiscilo con:
```js
                // Rotazione: percorso angolare più breve (evita spin di 360°)
                const da = (s1.ry - s0.ry + Math.PI * 3) % (Math.PI * 2) - Math.PI;
                rp.group.rotation.y = s0.ry + da * t;
                rp.pitch = s0.rx + (s1.rx - s0.rx) * t;
                // Stato animazione dall'ultimo snapshot "raggiunto"
```

- [ ] **Step 3: Aggiungi `pitch`/`ammo` di default ai due punti di creazione di `gameState.players[color]`**

Trova (dentro `socket.on('playerState', ...)`):
```js
        gameState.players[data.color] = { ...parts, hp: 100, dead: false, anim: makeAnim() };
```
Sostituiscilo con:
```js
        gameState.players[data.color] = { ...parts, hp: 100, dead: false, anim: makeAnim(), pitch: 0, ammo: null };
```

Trova (dentro `handleRoundStart`):
```js
            gameState.players[color] = {
                ...parts,
                hp: pState.hp != null ? pState.hp : 100,
                dead: !!pState.dead,
                anim: makeAnim()
            };
```
Sostituiscilo con:
```js
            gameState.players[color] = {
                ...parts,
                hp: pState.hp != null ? pState.hp : 100,
                dead: !!pState.dead,
                anim: makeAnim(),
                pitch: 0,
                ammo: null
            };
```

- [ ] **Step 4: Aggiungi pitch/munizioni al payload inviato (P2P + fallback)**

Trova:
```js
function broadcastState() {
    const msg = JSON.stringify({
        type: 'state',
        color: MY_COLOR,
        x: playerRoot.position.x,
        y: playerRoot.position.y,
        z: playerRoot.position.z,
        ry: yaw,
        mv: isMoving, sp: isSprinting, cr: isCrouching, sl: isSliding,
        wk: gameState.myWeapon
    });
    for (const dc of Object.values(channels)) {
        if (dc.readyState === 'open') dc.send(msg);
    }
}
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
        mv: isMoving, sp: isSprinting, cr: isCrouching, sl: isSliding,
        wk: gameState.myWeapon, am: gameState.myAmmo
    });
    for (const dc of Object.values(channels)) {
        if (dc.readyState === 'open') dc.send(msg);
    }
}
```

Trova:
```js
function sendStateHeartbeat() {
    if (gameState.phase !== 'playing' || gameState.isDead) return;
    broadcastState();
    socket.emit('playerState', {
        lobbyId: LOBBY_ID,
        color: MY_COLOR,
        x: playerRoot.position.x,
        y: playerRoot.position.y,
        z: playerRoot.position.z,
        ry: yaw,
        mv: isMoving, sp: isSprinting, cr: isCrouching, sl: isSliding,
        wk: gameState.myWeapon
    });
}
```
Sostituiscilo con:
```js
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

- [ ] **Step 5: Evento "shot fired" — broadcast dal tiratore, dispatch lato ricevente**

Trova (subito dopo `broadcastState`, stessa zona del file):
```js
// Signaling
socket.on('peerJoined', async ({ color, socketId }) => {
```
Inserisci **prima** di quel commento (quindi tra la fine di `broadcastState` e `// Signaling`):
```js
// Evento leggero "ho sparato": broadcast ad OGNI colpo (anche a vuoto), a differenza
// di reportHit che va al server solo sui colpi confermati. Serve solo al feedback
// visivo/sonoro di chi osserva (spettatore/replay futuro) — nessun ruolo nell'hit
// detection autoritativa.
function broadcastShotFired(weaponKey) {
    const msg = JSON.stringify({ type: 'shot', color: MY_COLOR, weaponKey });
    for (const dc of Object.values(channels)) {
        if (dc.readyState === 'open') dc.send(msg);
    }
    socket.emit('fpsShotFired', { lobbyId: LOBBY_ID, color: MY_COLOR, weaponKey });
}

function handleRemoteShot(color, weaponKey) {
    if (color === MY_COLOR) return;
    const rp = gameState.players[color];
    if (!rp) return;
    rp._shotSeq = (rp._shotSeq || 0) + 1;
    rp._shotWeapon = weaponKey;
}

```

Trova:
```js
function handlePeerData(data) {
    if (data.type === 'state' && gameState.players[data.color]) {
        applyRemoteState(gameState.players[data.color], data);
    }
}
```
Sostituiscilo con:
```js
function handlePeerData(data) {
    if (data.type === 'state' && gameState.players[data.color]) {
        applyRemoteState(gameState.players[data.color], data);
    } else if (data.type === 'shot') {
        handleRemoteShot(data.color, data.weaponKey);
    }
}
```

Trova (il listener fallback della posizione, poco più sotto nello stesso file):
```js
// Fallback stato via socket per player remoti
socket.on('playerState', (data) => {
```
Inserisci **subito prima**:
```js
// Fallback "shot fired" via socket (stesso schema di playerState)
socket.on('fpsShotFired', ({ color, weaponKey }) => {
    handleRemoteShot(color, weaponKey);
});

```

Infine, trova in `tryShoot()`:
```js
    gameState.myAmmo--;
    updateAmmoHUD();
    playMuzzleFlash();
    Sfx.shoot(gameState.myWeapon);
```
Sostituiscilo con:
```js
    gameState.myAmmo--;
    updateAmmoHUD();
    playMuzzleFlash();
    Sfx.shoot(gameState.myWeapon);
    broadcastShotFired(gameState.myWeapon);
```

- [ ] **Step 6: Relay server-side del fallback "shot fired"**

In `backend/sockets/games/fpsGameSocket.js`, trova:
```js
    socket.on('playerState', (data) => {
        // Relay dello stato posizione/rotazione via socket come fallback
        // (i client useranno preferibilmente il data channel WebRTC)
        const { lobbyId } = data;
        socket.to(lobbyId).emit('playerState', data);
```
Subito **dopo** il blocco completo di questo handler (dopo la sua chiusura `});`), aggiungi:
```js

    // Relay fallback "colpo sparato" (stesso schema di playerState): serve solo
    // al feedback visivo/sonoro lato client, nessun ruolo nell'hit detection.
    socket.on('fpsShotFired', (data) => {
        const { lobbyId } = data;
        socket.to(lobbyId).emit('fpsShotFired', data);
    });
```

- [ ] **Step 7: Verifica manuale in localhost (due tab)**

1. `node server.js` da `backend/`, apri due tab su `localhost:3000` con lo stesso lobby, entra in partita FPS.
2. In una tab apri la console DevTools. Nell'altra tab, muovi il mouse su/giù (guarda in alto/in basso) e spara qualche colpo (anche puntando nel vuoto).
3. Nella tab con la console, digita `gameState.players['<colore-dell-altra-tab>'].pitch` — conferma che il valore cambia in modo coerente mentre l'altro giocatore guarda su/giù (positivo/negativo secondo il verso).
4. Digita `gameState.players['<colore>'].ammo` — conferma che scende di 1 ad ogni sparo dell'altro giocatore, **anche quando spara a vuoto** (nessun bersaglio colpito).
5. Digita `gameState.players['<colore>']._shotSeq` prima e dopo uno sparo a vuoto dell'altro giocatore — conferma che incrementa.
6. Nessuna regressione: mira/spari/hit detection funzionano come prima in entrambe le tab.

**Checkpoint:** attendi conferma dell'utente prima di passare al Task 2.

---

### Task 2: `PovController` — modulo condiviso, ingresso/uscita automatici, HUD

**Files:**
- Modify: `frontend/fps.js` (nuovo oggetto `PovController`, hook in `playerKilled`/`roundEnd`/`handleRoundStart`/`animate`)
- Modify: `frontend/fps.html` (banner spettatore)
- Modify: `frontend/styles/fps.css` (stile banner)

**Interfaces:**
- Consuma: `rp.pitch`, `rp.ammo` (Task 1); `gameState.players`, `gameState.weapons`, `playerRoot`, `camera`, `weaponGroup`, `switchWeaponModel(key)`, `STAND_EYE`/`CROUCH_EYE`/`SLIDE_EYE`, `sizeMul`, `yaw`, `pitch` (globali esistenti).
- Produce: oggetto globale `PovController` con `{ active: boolean, targetColor: string|null, source: 'live', enter(color), exit(), setTarget(color), update(dt) }`. `enter`/`setTarget`/`onTargetLost`/`cycleTarget` sono consumati dal Task 3; `update(dt)` è esteso dal Task 4.

- [ ] **Step 1: Aggiungi il banner spettatore all'HTML**

In `frontend/fps.html`, trova:
```html
    <!-- ═══════════ SCHERMO MORTO ═══════════ -->
    <div id="dead-screen">
        <h2>You Died</h2>
        <p>Waiting for round to end…</p>
    </div>
```
Subito dopo (prima di `<!-- ═══════════ OVERLAY ROUND END / GAME OVER ═══════════ -->`), aggiungi:
```html

    <!-- ═══════════ BANNER SPETTATORE (sudden death) ═══════════ -->
    <div id="spectator-banner">
        <span id="spectator-dot"></span>
        <span id="spectator-text">Stai osservando</span>
    </div>
```

- [ ] **Step 2: Stile del banner**

In `frontend/styles/fps.css`, subito dopo il blocco `#dead-screen p { ... }`, aggiungi:
```css

/* ─── BANNER SPETTATORE ──────────────────────────── */
#spectator-banner {
    display: none;
    position: fixed;
    top: 20px; left: 50%;
    transform: translateX(-50%);
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: var(--chip-bg);
    border: 2px solid rgba(255,255,255,0.12);
    border-radius: var(--chip-radius);
    box-shadow: var(--chip-shadow);
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 700;
    color: var(--col-text);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    z-index: 210;
    pointer-events: none;
}
#spectator-banner.active { display: flex; }
#spectator-dot {
    width: 12px; height: 12px;
    border-radius: 50%;
    border: 2px solid var(--ink);
    flex-shrink: 0;
}
```

- [ ] **Step 3: Aggiungi il modulo `PovController`**

In `frontend/fps.js`, trova la fine del blocco delle callback gamepad (subito prima della definizione di `animate`):
```js
GamepadInput.setCallbacks({
    onFire:       tryShoot,
    onADS:        enterADS,
    onADSRelease: exitADS,
    onReload:     () => { if (!isReloading && gameState.myAmmo < gameState.myMaxAmmo) startReload(); },
    getWeapon:    () => gameState.weapons[gameState.myWeapon]
});
```
Subito dopo, aggiungi:
```js

// ══════════════════════════════════════════════════════
//  MODALITÀ SPETTATORE — camera POV condivisa
//  Nucleo pensato per essere riusato dal futuro "Play of the Round":
//  qui `source` è sempre 'live' (stream di rete); un domani un buffer
//  registrato potrà alimentare update() senza cambiarne la firma.
// ══════════════════════════════════════════════════════
const PovController = {
    active: false,
    targetColor: null,
    source: 'live',

    enter(color) {
        if (!gameState.players[color]) return;
        this.active = true;
        this.setTarget(color);
        document.getElementById('crosshair').style.display = 'none';
        document.getElementById('spectator-banner').classList.add('active');
    },

    exit() {
        if (!this.active) return;
        this.active = false;
        this.targetColor = null;
        document.getElementById('crosshair').style.display = '';
        document.getElementById('spectator-banner').classList.remove('active');
        if (weaponGroup) weaponGroup.visible = false;
    },

    setTarget(color) {
        const rp = gameState.players[color];
        if (!rp) return;
        // Ripristina visibile il vecchio target (se diverso e ancora vivo)
        if (this.targetColor && this.targetColor !== color) {
            const old = gameState.players[this.targetColor];
            if (old) old.group.visible = !old.dead;
        }
        this.targetColor = color;
        rp.group.visible = false;   // non vogliamo vedere il proprio modello dall'interno
        switchWeaponModel(rp.weaponKey);
        if (weaponGroup) weaponGroup.visible = true;
        const dot = document.getElementById('spectator-dot');
        if (dot) dot.style.background = color;
    },

    update(dt) {
        if (!this.active) return;
        const rp = gameState.players[this.targetColor];
        if (!rp || rp.dead) return;   // lo switch al prossimo vivo lo gestisce il chiamante (Task 3)

        playerRoot.position.set(rp.group.position.x, rp.group.position.y, rp.group.position.z);
        yaw = rp.group.rotation.y;
        pitch = rp.pitch || 0;
        playerRoot.rotation.y = yaw;
        const a = rp.anim;
        const eyeH = (a && a.slide ? SLIDE_EYE : a && a.crouch ? CROUCH_EYE : STAND_EYE) * sizeMul;
        camera.position.y = eyeH;
        camera.rotation.x = pitch;
        camera.rotation.z = 0;

        this._updateHud(rp);
    },

    _updateHud(rp) {
        const w = gameState.weapons[rp.weaponKey];
        document.getElementById('hud-weapon-name').textContent = w ? w.name : (rp.weaponKey || '');
        const maxAmmo = w ? w.ammo : 30;
        const ammo = rp.ammo != null ? rp.ammo : maxAmmo;
        document.getElementById('hud-ammo-count').innerHTML = `${ammo}<span> / ${maxAmmo}</span>`;

        const hp = Math.max(0, Math.min(100, rp.hp ?? 100));
        document.getElementById('hud-hp-val').textContent = Math.round(hp);
        const bar = document.getElementById('hud-hp-bar');
        bar.style.width = hp + '%';
        bar.style.background = hp > 50 ? 'var(--col-safe)' : hp > 25 ? 'var(--col-ammo)' : 'var(--col-danger)';
        const bonusBar = document.getElementById('hud-hp-bonus');
        if (bonusBar) bonusBar.style.width = '0%';
    }
};
```

- [ ] **Step 4: Aggancia `update(dt)` al loop di rendering**

Trova (dentro `animate()`):
```js
    for (const rp of Object.values(gameState.players)) {
        if (!rp.dead) updateRemoteAnim(rp, dt);
    }
    applyFlicker();   // mutatore "Fantasmi" (invisibilità intermittente)
    drawMinimap();
```
Sostituiscilo con:
```js
    for (const rp of Object.values(gameState.players)) {
        if (!rp.dead) updateRemoteAnim(rp, dt);
    }
    PovController.update(dt);
    applyFlicker();   // mutatore "Fantasmi" (invisibilità intermittente)
    drawMinimap();
```

- [ ] **Step 5: Ingresso automatico alla morte in sudden death**

Trova (dentro `socket.on('playerKilled', ...)`):
```js
    if (killedColor === MY_COLOR) {
        gameState.isDead = true;
        // Se stavo scegliendo un'arma quando sono morto, chiudo il menu (senza
        // ri-catturare il mouse: ci pensa il flusso di respawn/dead-screen).
        if (weaponChangeMode) {
            weaponChangeMode = false;
            document.getElementById('weapon-select-screen').classList.remove('active');
            document.getElementById('ws-title').textContent = 'Choose Your Loadout';
            document.getElementById('ws-timer').style.display = '';
            document.getElementById('ws-players-ready').style.display = '';
            document.getElementById('ws-confirm-btn').textContent = 'Confirm Loadout';
        }
        Sfx.death();
        exitADS();
        const ds = document.getElementById('dead-screen');
        const sub = ds.querySelector('p');
        if (sub) sub.textContent = (subphase === 'melee') ? 'Respawning…' : 'Waiting for round to end…';
        ds.classList.add('active');
        // In mischia si rinasce subito: si TIENE il pointer lock (niente click per rientrare).
        // In sudden death la morte è definitiva: si rilascia il mouse.
        if (subphase !== 'melee') document.exitPointerLock();
        if (weaponGroup) weaponGroup.visible = false;
    }
```
Sostituiscilo con:
```js
    if (killedColor === MY_COLOR) {
        gameState.isDead = true;
        // Se stavo scegliendo un'arma quando sono morto, chiudo il menu (senza
        // ri-catturare il mouse: ci pensa il flusso di respawn/dead-screen).
        if (weaponChangeMode) {
            weaponChangeMode = false;
            document.getElementById('weapon-select-screen').classList.remove('active');
            document.getElementById('ws-title').textContent = 'Choose Your Loadout';
            document.getElementById('ws-timer').style.display = '';
            document.getElementById('ws-players-ready').style.display = '';
            document.getElementById('ws-confirm-btn').textContent = 'Confirm Loadout';
        }
        Sfx.death();
        exitADS();
        if (subphase === 'melee') {
            // In mischia si rinasce subito: si TIENE il pointer lock (niente click per rientrare).
            const ds = document.getElementById('dead-screen');
            const sub = ds.querySelector('p');
            if (sub) sub.textContent = 'Respawning…';
            ds.classList.add('active');
        } else {
            // Sudden death: morte definitiva → modalità spettatore invece della dead-screen.
            document.exitPointerLock();
            const initial = (gameState.players[killerColor] && !gameState.players[killerColor].dead)
                ? killerColor
                : Object.keys(gameState.players).find(c => !gameState.players[c].dead);
            if (initial) {
                PovController.enter(initial);
            } else {
                // Nessun vivo trovato (caso limite: tutti morti nello stesso istante):
                // il round finisce comunque a breve, fallback sulla vecchia dead-screen.
                const ds = document.getElementById('dead-screen');
                const sub = ds.querySelector('p');
                if (sub) sub.textContent = 'Waiting for round to end…';
                ds.classList.add('active');
                if (weaponGroup) weaponGroup.visible = false;
            }
        }
    }
```

- [ ] **Step 6: Uscita automatica a fine round**

Trova:
```js
socket.on('roundEnd', (data) => {
    console.log(`[FPS] evento roundEnd: round=${data.round} vincitore=${data.winnerColor}`);
    gameState.scores = data.scores;
    if (data.points) gameState.points = data.points;
    updateScoreHUD();
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
    showRoundEndOverlay(data);
});
```

Trova, in `handleRoundStart(data)`:
```js
function handleRoundStart(data) {
    clearTimeout(roundIntroTimer);
    gameState.phase = 'round_intro';   // gioco congelato: input/movimento/sparo bloccati fino a fine intro
```
Sostituiscilo con:
```js
function handleRoundStart(data) {
    clearTimeout(roundIntroTimer);
    PovController.exit();   // difensivo: copre resync via fpsInit senza un roundEnd intermedio
    gameState.phase = 'round_intro';   // gioco congelato: input/movimento/sparo bloccati fino a fine intro
```

- [ ] **Step 7: Verifica manuale in localhost (due tab)**

1. Avvia una partita FPS con due tab, gioca finché non scatta il sudden death (banner "Sudden Death" a schermo).
2. Fai in modo che una delle due tab muoia (l'altra la elimina). Nella tab del morto:
   - **Niente** dead-screen a piena schermo: la visuale prosegue in prima persona dalla parte del giocatore superstite, seguendo davvero i suoi movimenti/la sua mira in tempo reale.
   - In alto appare il banner "Stai osservando" con il pallino del colore del superstite.
   - HUD (nome arma, munizioni, vita) riflette lo stato reale del superstite.
   - Il crosshair è nascosto.
   - La minimappa ruota/si muove seguendo il superstite (non resta ferma sul punto di morte).
3. Fai terminare il round (il superstite vince). Verifica: overlay di fine round appare normalmente, e al round successivo la visuale/HUD tornano quelle del proprio giocatore (non più in modalità spettatore).
4. Nessuna regressione sulla mischia: una morte in mischia deve ancora mostrare la vecchia dead-screen "Respawning…" e rinascere come prima (la modalità spettatore NON deve attivarsi lì).

**Checkpoint:** attendi conferma dell'utente prima di passare al Task 3.

---

### Task 3: Switch tra sopravvissuti (manuale + automatico)

**Files:**
- Modify: `frontend/fps.js` (estende `PovController`, hook tastiera, hook `playerKilled`/`playerLeft`)

**Interfaces:**
- Consuma: `PovController.active`, `PovController.targetColor`, `PovController.setTarget(color)` (Task 2).
- Produce: `PovController.cycleTarget(direction)` e `PovController.onTargetLost()`, usati dal keydown handler e dagli handler `playerKilled`/`playerLeft`.

- [ ] **Step 1: Aggiungi `cycleTarget`/`onTargetLost`/`_aliveColors` a `PovController`**

Trova, dentro l'oggetto `PovController` (aggiunto nel Task 2), il metodo `setTarget(color) { ... }` e la sua chiusura (la riga con la sola `},` prima di `update(dt) {`). Subito dopo quella chiusura, inserisci:
```js

    _aliveColors() {
        return Object.keys(gameState.players)
            .filter(c => !gameState.players[c].dead)
            .sort();
    },

    // Switch manuale (frecce): nessun effetto con 0 o 1 sopravvissuto.
    cycleTarget(direction) {
        const alive = this._aliveColors();
        if (alive.length <= 1) return;
        const i = alive.indexOf(this.targetColor);
        const next = alive[(i + direction + alive.length) % alive.length];
        this.setTarget(next);
    },

    // Il giocatore osservato è morto/disconnesso: passa automaticamente al
    // prossimo vivo. Se resta un solo vivo, tutti gli spettatori vi confluiscono
    // naturalmente (ognuno lo riceve come "prossimo" quando il proprio target cade).
    onTargetLost() {
        if (!this.active) return;
        const alive = this._aliveColors();
        if (alive.length === 0) return;   // il round sta per finire comunque
        this.setTarget(alive[0]);
    },
```

- [ ] **Step 2: Frecce tastiera per lo switch manuale**

Trova, dentro `document.addEventListener('keydown', (e) => { ... })`:
```js
    // ESC: rilascia pointer lock (browser gestisce)
});
```
Sostituiscilo con:
```js
    // Modalità spettatore: frecce per cambiare il vivo osservato
    if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && PovController.active) {
        e.preventDefault();
        PovController.cycleTarget(e.code === 'ArrowRight' ? 1 : -1);
    }
    // ESC: rilascia pointer lock (browser gestisce)
});
```

- [ ] **Step 3: Switch automatico quando il target osservato muore**

Trova, dentro `socket.on('playerKilled', ...)`:
```js
    if (gameState.players[killedColor]) {
        gameState.players[killedColor].dead = true;
        gameState.players[killedColor].group.visible = false;
    }
});
```
Sostituiscilo con:
```js
    if (gameState.players[killedColor]) {
        gameState.players[killedColor].dead = true;
        gameState.players[killedColor].group.visible = false;
    }

    if (PovController.active && PovController.targetColor === killedColor) {
        PovController.onTargetLost();
    }
});
```

- [ ] **Step 4: Switch automatico quando il target osservato si disconnette**

Trova:
```js
socket.on('playerLeft', ({ color }) => {
    console.log(`[FPS] evento playerLeft: ${color}`);
    const rp = gameState.players[color];
    if (rp) {
        scene.remove(rp.group);   // la healthbar è figlia del group → rimossa con esso
        delete gameState.players[color];
    }
    if (gameState.scores[color] !== undefined) {
        delete gameState.scores[color];
        if (gameState.points) delete gameState.points[color];
        updateScoreHUD();
    }
});
```
Sostituiscilo con:
```js
socket.on('playerLeft', ({ color }) => {
    console.log(`[FPS] evento playerLeft: ${color}`);
    const wasTarget = PovController.active && PovController.targetColor === color;
    const rp = gameState.players[color];
    if (rp) {
        scene.remove(rp.group);   // la healthbar è figlia del group → rimossa con esso
        delete gameState.players[color];
    }
    if (gameState.scores[color] !== undefined) {
        delete gameState.scores[color];
        if (gameState.points) delete gameState.points[color];
        updateScoreHUD();
    }
    if (wasTarget) PovController.onTargetLost();
});
```

- [ ] **Step 5: Verifica manuale in localhost (SERVONO 3+ TAB — con solo 2 giocatori il sudden death è 1v1 e non c'è nessuno tra cui scegliere)**

1. Apri **tre o più** tab sullo stesso lobby (oltre alle solite due, apri una terza/quarta finestra allo stesso URL di lobby). Gioca finché non scatta il sudden death con almeno 3 giocatori vivi.
2. Fai morire una tab per prima: verifica che entri in spettatore su un vivo, e che le frecce ◄/► ciclino tra **tutti** i sopravvissuti rimasti (non solo 2), aggiornando HUD e banner ad ogni cambio.
3. Mentre quella tab osserva il giocatore X, fai morire un **altro** giocatore Y (diverso da X): verifica che la visuale NON cambi (X è ancora vivo, resta l'osservato).
4. Fai morire X (il giocatore attualmente osservato): verifica lo switch automatico immediato al prossimo vivo, senza schermate nere/freeze.
5. Continua finché resta **un solo vivo**: verifica che tutti gli spettatori (anche quelli che stavano osservando qualcun altro) confluiscano su di lui, e che le frecce non abbiano più effetto.
6. (Se riesci a testarlo) chiudi la tab del giocatore attualmente osservato da uno spettatore: verifica lo switch automatico anche in caso di disconnessione, non solo di morte.

**Checkpoint:** attendi conferma dell'utente prima di passare al Task 4.

---

### Task 4: Feedback spari (muzzle-flash/rinculo/SFX) nel POV dello spettatore

**Files:**
- Modify: `frontend/fps.js` (estende `PovController.update`)

**Interfaces:**
- Consuma: `rp._shotSeq`, `rp._shotWeapon` (Task 1); `playMuzzleFlash()`, `Sfx.shoot(weaponKey)`, `RECOIL`, `recoilPitch`, `recoilYaw`, `addShake(amount)` (funzioni/variabili globali già esistenti).

- [ ] **Step 1: Traccia l'ultimo sparo "visto" per target, azzeralo al cambio target**

Trova, dentro l'oggetto `PovController`, la riga `source: 'live',` e sostituiscila con:
```js
    source: 'live',
    _lastSeenShotSeq: {},
```

Trova il metodo `setTarget(color) { ... }` (aggiunto nel Task 2). Subito dopo la riga
```js
        switchWeaponModel(rp.weaponKey);
```
aggiungi:
```js
        // Non "sparare" retroattivamente l'ultimo colpo del nuovo target al momento dello switch.
        this._lastSeenShotSeq[color] = rp._shotSeq || 0;
```

Trova il metodo `exit() { ... }`. Subito dopo `this.targetColor = null;`, aggiungi:
```js
        this._lastSeenShotSeq = {};
```

- [ ] **Step 2: Riproduci il feedback di sparo dentro `update(dt)`**

Trova, dentro `update(dt)`, la riga:
```js
        this._updateHud(rp);
    },
```
Sostituiscila con:
```js
        const seenSeq = this._lastSeenShotSeq[this.targetColor] || 0;
        if (rp._shotSeq && rp._shotSeq !== seenSeq) {
            this._lastSeenShotSeq[this.targetColor] = rp._shotSeq;
            this._playShotFeedback(rp._shotWeapon);
        }

        this._updateHud(rp);
    },

    _playShotFeedback(weaponKey) {
        playMuzzleFlash();
        Sfx.shoot(weaponKey);
        const rc = RECOIL[weaponKey] || RECOIL.assault;
        recoilPitch += rc.pitch;
        recoilYaw += (Math.random() - 0.5) * 2 * rc.yaw;
        addShake(rc.shake);
    },
```

- [ ] **Step 3: Verifica manuale in localhost (due tab bastano)**

1. Sudden death, una tab muore ed entra in spettatore sull'altra (superstite).
2. Fai sparare il superstite (anche colpi a vuoto, puntando nel vuoto): nella tab spettatore verifica che appaiano muzzle-flash, rinculo della vista e SFX di sparo **in sincronia** con lo sparo reale — non solo sui colpi che vanno a segno.
3. Cambia arma nel round successivo (arma diversa) e ripeti: verifica che SFX/rinculo corrispondano alla nuova arma osservata (non alla vecchia).
4. Nessuna regressione: la propria vista/sparo in prima persona (quando sei vivo, non spettatore) restano invariati.

**Checkpoint:** attendi conferma finale dell'utente — modalità spettatore completa.

---

## Self-review (svolto durante la stesura)

- **Copertura spec:** requisiti 1–9 della spec coperti — 1/6 Task 2 (ingresso/uscita), 2 Task 2 (`update` scrive solo pos/rot/arma, mai camera libera), 3 Task 2/3 (`_aliveColors` filtra i vivi), 4 Task 3 (frecce), 5 Task 2/4 (HUD completo incluso munizioni), 6 Task 3 (`onTargetLost`), 7 Task 3 (confluenza naturale sul superstite), 8 Task 2 (`exit` su `roundEnd`/`handleRoundStart`), 9 by design (`source: 'live'`, `update(dt)` non assume nulla sulla provenienza dei dati).
- **Placeholder:** nessun TBD/TODO; ogni step ha codice completo.
- **Coerenza dei nomi:** `PovController.{active,targetColor,source,enter,exit,setTarget,update,cycleTarget,onTargetLost,_aliveColors,_updateHud,_playShotFeedback,_lastSeenShotSeq}` usati in modo identico in tutti i task che li referenziano; `rp.{pitch,ammo,_shotSeq,_shotWeapon}` introdotti nel Task 1 e riusati senza rinominazioni nei Task 2/3/4.
