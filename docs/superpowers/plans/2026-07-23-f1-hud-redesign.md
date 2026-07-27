# F1 HUD Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the in-game F1 HUD (`frontend/f1.html` + `frontend/styles/f1.css` + `frontend/f1.js` + `frontend/f1Gamepad.js`) as a compact dark-neumorphic layout: classifica top-left, giri top-center, timer top-right (qualifica soltanto), velocità bottom-center, pannello gomme apribile/chiudibile bottom-left (con sagoma auto SVG + le 4 gomme), minimappa bottom-right — rimuovendo nome pista e l'indicatore boost morto.

**Architecture:** Puro lavoro frontend, nessuna modifica al backend (`f1GameSocket.js`) — tutti i dati necessari (posizione in classifica, `lap`/`totalLaps`/`phase`, `tyreWear`/`compound`, `trackIndex`) sono già inviati dagli eventi socket esistenti. Introduce due classi CSS condivise (`.hud-panel-neu` pannello rialzato, `.hud-screen` display incassato) usate da ogni box HUD, sostituendo il vecchio sistema `.hud-box`. La minimappa disegna il contorno pista come `<path>` SVG generato una tantum da `trackPts` (già caricato lato client per costruire la pista 3D) e sposta un marker lungo quel path via anime.js, pilotato dal `trackIndex` del proprio giocatore (nessuna animazione autonoma).

**Tech Stack:** HTML/CSS/JS vanilla, Three.js r128 (già presente), anime.js v3.2.1 (nuova dipendenza via CDN, solo per il motion path della minimappa).

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-07-23-f1-hud-redesign-design.md` — ogni scelta di layout/colore/dimensione qui sotto viene da lì, non improvvisare varianti.
- Niente modifiche a `backend/sockets/games/f1GameSocket.js` — fuori scope.
- Niente commit automatici: per convenzione di questo progetto (`CLAUDE.md`) l'utente committa/pusha manualmente quando vuole. I task sotto finiscono con la verifica manuale in localhost, non con un `git commit` — se l'utente lo chiede esplicitamente durante l'esecuzione, va bene farlo, ma non è un passo del piano.
- Dopo ogni modifica a un file `.js`, eseguire `node --check <file>` (sintassi soltanto, questi file usano API browser/Three.js quindi non sono eseguibili da Node — serve solo a intercettare errori di sintassi prima di aprire il browser).
- Bump del query-string di cache-busting sugli script locali modificati in `frontend/f1.html` (converzione già in uso nel file: `?v=YYYYMMDDx`) — usare `?v=20260723a` per `f1.js` e `f1Gamepad.js` nel Task 3.
- Verifica finale: due tab di `localhost:3000` (uno da qualifica a gara come da convenzione del progetto), non un singolo tab.

---

### Task 1: Pulizia — rimuovi nome pista e indicatore boost (codice morto)

**Files:**
- Modify: `frontend/f1.html:12-31`
- Modify: `frontend/f1.js:618`, `frontend/f1.js:845-854`
- Modify: `frontend/styles/f1.css:86-91`, `frontend/styles/f1.css:102-106`

**Interfaces:**
- Consumes: nessuna (task di sola rimozione)
- Produces: nessun elemento `#track-name-display`, `#multiplier-box`, `#multiplier-display` più nel DOM; nessun listener `f1BoostUpdate` più registrato — i task successivi possono ricostruire l'HTML dei blocchi HUD da zero senza doversi preoccupare di questi elementi

- [ ] **Step 1: Rimuovi il riferimento JS al nome pista**

In `frontend/f1.js`, dentro l'handler `f1Setup` (linea 618), rimuovi questa riga:

```js
        if (trackName) document.getElementById('track-name-display').textContent = trackName;
```

(La destrutturazione `{ players, trackName, ... }` in testa all'handler può restare invariata: `trackName` resta comunque usato più sotto in `f1Countdown`/`f1RaceEnded` per il testo del countdown, non va tolto dai parametri.)

- [ ] **Step 2: Rimuovi il listener `f1BoostUpdate` morto**

In `frontend/f1.js`, righe 845-854, rimuovi per intero questo blocco:

```js
    socket.on('f1BoostUpdate', ({ boostTime }) => {
        const mBox = document.getElementById('multiplier-box');
        const mVal = document.getElementById('multiplier-display');
        mBox.style.display = 'flex';
        const bonus = (boostTime / 4.0) * 0.20;
        mVal.textContent = (1.0 + bonus).toFixed(2);
        if      (bonus >= 0.20) { mBox.style.color = '#f1c40f'; mBox.style.borderColor = '#f1c40f'; }
        else if (bonus >  0   ) { mBox.style.color = '#e67e22'; mBox.style.borderColor = '#e67e22'; }
        else                    { mBox.style.color = '#95a5a6'; mBox.style.borderColor = '#95a5a6'; }
    });
```

- [ ] **Step 3: `node --check` su f1.js**

Run: `node --check "frontend/f1.js"`
Expected: nessun output (sintassi valida)

- [ ] **Step 4: Rimuovi il markup HTML morto/da ricostruire**

Questo passo verrà di fatto assorbito dalla riscrittura completa del Task 3 (che sostituisce tutto il blocco HUD): per ora, in `frontend/f1.html`, rimuovi solo le righe relative a nome pista e boost dal blocco esistente (righe 12-31), lasciando lap/tyre/timer/standings/speed invariati per il momento — verranno sostituiti nel Task 3:

```html
    <!-- HUD: in alto a sinistra -->
    <div class="hud-panel hud-left">
        <div class="hud-box lap-style" id="lap-box" style="display:none;">🏁 <span id="lap-display">1/3</span></div>
        <div class="hud-box tyre-style" id="tyre-box" style="display:none;">
            <span id="tyre-dot" class="tyre-dot"></span>
            <span id="tyre-label"></span> — <span id="tyre-wear-value">0</span>%
        </div>
    </div>

    <!-- HUD: in alto a destra -->
    <div class="hud-panel hud-right" id="timer-box" style="visibility:hidden;">
        <div style="display:flex; gap:10px; align-items:center;">
            <div class="hud-box timer-style">⏱️ <span id="hud-timer">0:00.000</span></div>
        </div>
        <div class="hud-box standings-box" id="standings-box"></div>
    </div>

    <!-- HUD: velocità in basso al centro -->
    <div class="hud-bottom">
        <div class="speed-box">
            <span id="speed-value">0</span><span class="speed-unit"> km/h</span>
        </div>
    </div>
```

- [ ] **Step 5: Rimuovi le regole CSS morte**

In `frontend/styles/f1.css`, rimuovi il blocco `.track-name` (righe 86-91) e il blocco `.multiplier-style` (righe 102-106):

```css
.track-name {
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #555;
}
```

```css
.multiplier-style {
    font-size: 18px;
    color: #e67e22;
    border-color: #e67e22;
}
```

- [ ] **Step 6: Verifica manuale rapida**

Apri il gioco in localhost (un tab basta per questo controllo), entra in una lobby F1: nessun errore in console riguardo `track-name-display`/`multiplier-box`/`multiplier-display` (elementi assenti ma nessun codice li referenzia più).

---

### Task 2: Fondamenta CSS — sistema neumorfico

**Files:**
- Modify: `frontend/styles/f1.css` (append nuove regole, rimuovi quelle superate da questo redesign)

**Interfaces:**
- Consumes: nessuna
- Produces: classi `.hud`, `.hud-panel-neu`, `.hud-screen`, `.hud-eyebrow`, `.hud-mono`, `.hud-key-hint` + custom properties `--hud-*` sotto `:root` — usate da Task 3 in poi. Produce anche le regole posizionali/dimensionali per `.hud-standings`, `.hud-lap`, `.hud-timer`, `.hud-speed`, `.hud-tyre-closed`, `.hud-tyre-open`, `.hud-minimap`, `.car-chassis`, `.car-wing`, `.car-halo`, `.wheel`, `.minimap-track-line`, `.minimap-you-halo`, `.minimap-you-core` — usate da Task 3/5/7.

- [ ] **Step 1: Aggiungi i nuovi custom properties in `:root`**

In `frontend/styles/f1.css`, dentro il blocco `:root { ... }` esistente (righe 1-7), aggiungi queste righe subito prima della `}` di chiusura:

```css
    --hud-surface:      #1c212a;
    --hud-shadow-dk:    rgba(2, 3, 5, 0.65);
    --hud-shadow-lt:    rgba(255, 255, 255, 0.05);
    --hud-screen-bg:    #12151b;
    --hud-screen-dk:    rgba(0, 0, 0, 0.7);
    --hud-screen-lt:    rgba(255, 255, 255, 0.025);
    --hud-text:         #eef2f6;
    --hud-text-dim:     #838d9c;
    --hud-wear-fresh:   #4fbf82;
    --hud-wear-mid:     #d9b23c;
    --hud-wear-worn:    #c65b52;
```

- [ ] **Step 2: Rimuovi le regole HUD superate**

Rimuovi questi blocchi (sostituiti dal nuovo sistema): `.hud-panel`, `.hud-left`, `.hud-right`, `.hud-bottom`, `.hud-box`, `.lap-style`, `.timer-style`, `.tyre-style`, `.tyre-dot` (righe 42-121 del file originale). Tieni invece `.standing-entry`, `.standing-entry.me`, `.standing-pos`, `.standing-dot` (righe 180-203) e `.speed-unit` (riga 219-222): li riusiamo tali e quali nel Task 3.

- [ ] **Step 3: Aggiungi le nuove classi condivise**

Subito dove prima c'era `.hud-panel` (circa riga 42), scrivi:

```css
/* ========================
   HUD — neumorfismo scuro
   ======================== */
.hud {
    position: fixed;
    z-index: 10;
    pointer-events: none;
}

/* Pannello "raised": stessa tinta dello sfondo di gioco, niente bordo,
   letto solo dalla coppia di ombre chiara/scura (mai da un bordo colorato —
   il colore resta riservato ai contenuti: pallini pilota, usura gomme). */
.hud-panel-neu {
    background: var(--hud-surface);
    border-radius: 11px;
    box-shadow:
        4px 4px 10px var(--hud-shadow-dk),
        -4px -4px 9px var(--hud-shadow-lt);
}

/* "Display" incassato dentro un pannello: ombra invertita (concava), ospita
   il valore vero e proprio — richiamo diretto a un cruscotto auto reale. */
.hud-screen {
    background: var(--hud-screen-bg);
    border-radius: 7px;
    box-shadow:
        inset 2px 2px 5px var(--hud-screen-dk),
        inset -1px -1px 3px var(--hud-screen-lt);
}

.hud-eyebrow {
    font-family: 'Fredoka', sans-serif;
    text-transform: uppercase;
    font-weight: 700;
    letter-spacing: 1.4px;
    font-size: 9px;
    color: var(--hud-text-dim);
}

.hud-mono {
    font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
    font-variant-numeric: tabular-nums;
    color: var(--hud-text);
}

.hud-key-hint {
    font-size: 8.5px;
    color: var(--hud-text-dim);
    background: var(--hud-screen-bg);
    border-radius: 3px;
    padding: 1px 4px;
}
```

- [ ] **Step 4: Aggiungi le regole per-componente**

Subito dopo, aggiungi (margini identici — 14px — su tutti e 4 i lati dello schermo, come confermato dall'utente):

```css
/* ---- top-left: classifica ---- */
.hud-standings {
    top: 14px; left: 12px;
    padding: 6px 10px 7px;
    min-width: 84px;
    display: flex;
    flex-direction: column;
    gap: 0;
}

/* ---- top-center: giri ---- */
.hud-lap {
    top: 14px; left: 50%; transform: translateX(-50%);
    padding: 5px 6px;
    text-align: center;
}
.hud-lap .hud-eyebrow { letter-spacing: 2.5px; margin-bottom: 3px; display: block; }
.hud-lap .hud-screen { padding: 2px 14px 4px; }
.hud-lap .hud-mono { font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }

/* ---- top-right: timer (solo qualifica) ---- */
.hud-timer {
    top: 14px; right: 12px;
    padding: 5px 10px 6px;
    text-align: right;
}
.hud-timer .hud-eyebrow { margin-bottom: 3px; display: block; }
.hud-timer .hud-screen { padding: 3px 9px; }
.hud-timer .hud-mono { font-size: 15px; font-weight: 600; }

/* ---- bottom-center: velocità ---- */
.hud-speed {
    bottom: 14px; left: 50%; transform: translateX(-50%);
    padding: 6px;
    text-align: center;
}
.hud-speed .hud-screen { padding: 4px 14px; }
.hud-speed #speed-value { font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace; font-size: 17px; font-weight: 700; color: var(--hud-text); }

/* ---- bottom-left: gomme, stato chiuso ---- */
.hud-tyre-closed {
    bottom: 14px; left: 12px;
    display: flex; align-items: center; gap: 5px;
    padding: 5px 8px;
    pointer-events: auto;
    cursor: pointer;
}
.tyre-icon-closed {
    display: inline-block;
    width: 12px; height: 12px; border-radius: 3px;
    background: var(--hud-wear-mid);
}

/* ---- bottom-left: gomme, stato aperto ---- */
.hud-tyre-open {
    bottom: 14px; left: 12px;
    width: 118px;
    padding: 8px 9px 10px;
    pointer-events: auto;
}
.hud-tyre-open-head {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 5px;
    cursor: pointer;
}
.hud-tyre-compound {
    display: flex; align-items: center; gap: 4px;
    font-family: 'Fredoka', sans-serif;
    font-size: 9px; font-weight: 700; letter-spacing: 0.8px; color: var(--hud-text-dim);
}
.hud-tyre-compound-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.hud-car-top { width: 100%; height: 86px; margin: 1px 0 5px; }
.hud-car-top svg { width: 100%; height: 100%; display: block; }
.car-chassis { fill: #2b313c; }
.car-wing    { fill: #232830; }
.car-halo    { fill: none; stroke: #454e5c; stroke-width: 2; }
.wheel       { fill: var(--wear, var(--hud-wear-mid)); transition: fill 0.4s ease; }
.hud-tyre-wear-readout { text-align: center; }
.hud-tyre-wear-readout .hud-screen { padding: 3px 0 4px; }
.hud-tyre-wear-readout .hud-mono { font-size: 14px; font-weight: 700; }
.hud-tyre-wear-readout .hud-eyebrow { margin-top: 3px; }

/* ---- bottom-right: minimappa ---- */
.hud-minimap {
    bottom: 14px; right: 12px;
    width: 118px; height: 82px;
    padding: 6px;
}
.hud-minimap .hud-screen { width: 100%; height: 100%; }
.hud-minimap svg { width: 100%; height: 100%; display: block; }
.minimap-track-line {
    fill: none;
    stroke: rgba(255,255,255,0.22);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
}
.minimap-you-core { r: 4; }
.minimap-you-halo { r: 9; opacity: 0.3; }
```

- [ ] **Step 5: Verifica**

Il file deve restare CSS valido (nessuna parentesi orfana). Apri `frontend/f1.css` per intero e controlla ad occhio che ogni blocco `{` abbia la sua `}` — non c'è un linter CSS configurato nel progetto, quindi il controllo è visivo più il rendering nel Task 3 (se il CSS fosse rotto, gli elementi HUD non avrebbero alcuno stile).

---

### Task 3: HTML — nuovo markup HUD

**Files:**
- Modify: `frontend/f1.html:12-38` (blocco HUD)
- Modify: `frontend/f1.html:113-120` (script tag, aggiunta anime.js + bump cache-busting)

**Interfaces:**
- Consumes: classi CSS del Task 2 (`.hud`, `.hud-panel-neu`, `.hud-screen`, `.hud-eyebrow`, `.hud-mono`, `.hud-key-hint`, `.hud-standings`, `.hud-lap`, `.hud-timer`, `.hud-speed`, `.hud-tyre-closed`, `.hud-tyre-open`, `.hud-minimap`, `.car-chassis`, `.car-wing`, `.car-halo`, `.wheel`, `.minimap-track-line`, `.minimap-you-halo`, `.minimap-you-core`, `.tyre-icon-closed`, `.hud-tyre-compound`, `.hud-tyre-compound-dot`, `.hud-car-top`, `.hud-tyre-wear-readout`)
- Produces: elementi con id `standings-box`, `lap-box`/`lap-display`, `timer-panel`/`hud-timer`, `speed-value`, `tyre-closed`/`tyre-icon-closed`, `tyre-open`/`tyre-open-head`/`tyre-compound-dot`/`tyre-compound-label`/`wFL`/`wFR`/`wRL`/`wRR`/`tyre-wear-value`, `minimap-box`/`minimap-track`/`minimap-dot` — consumati da Task 4/5/6/7. Il global `anime` (da anime.js) — consumato da Task 7.

- [ ] **Step 1: Sostituisci il blocco HUD**

In `frontend/f1.html`, sostituisci l'intero blocco (quello lasciato dal Task 1, righe 12-31) con:

```html
    <!-- HUD: classifica live — top-left. Popolata da updateStandings() in f1.js -->
    <div class="hud hud-standings hud-panel-neu" id="standings-box" style="display:none;"></div>

    <!-- HUD: giri — top-center, stile broadcast (giro CORRENTE/totale) -->
    <div class="hud hud-lap hud-panel-neu" id="lap-box" style="display:none;">
        <span class="hud-eyebrow">LAP</span>
        <div class="hud-screen"><span class="hud-mono" id="lap-display">1/3</span></div>
    </div>

    <!-- HUD: timer — top-right, SOLO qualifica -->
    <div class="hud hud-timer hud-panel-neu" id="timer-panel" style="display:none;">
        <span class="hud-eyebrow">Qualifica</span>
        <div class="hud-screen"><span class="hud-mono" id="hud-timer">0:00.000</span></div>
    </div>

    <!-- HUD: velocità — bottom-center -->
    <div class="hud hud-speed hud-panel-neu">
        <div class="hud-screen"><span id="speed-value">0</span><span class="speed-unit"> km/h</span></div>
    </div>

    <!-- HUD: gomme — bottom-left, apribile/chiudibile (tasto T / L1), chiuso di
         default, visibile solo in gara (vedi renderTyreVisibility in f1.js) -->
    <div class="hud hud-tyre-closed hud-panel-neu" id="tyre-closed" style="display:none;" title="T / L1 — apri gomme">
        <span class="tyre-icon-closed" id="tyre-icon-closed"></span>
        <span class="hud-key-hint">T</span>
    </div>
    <div class="hud hud-tyre-open hud-panel-neu" id="tyre-open" style="display:none;">
        <div class="hud-tyre-open-head" id="tyre-open-head">
            <span class="hud-tyre-compound">
                <span class="hud-tyre-compound-dot" id="tyre-compound-dot"></span>
                <span id="tyre-compound-label"></span>
            </span>
            <span class="hud-key-hint">T</span>
        </div>
        <div class="hud-car-top">
            <svg viewBox="0 0 64 122">
                <rect class="wheel" id="wFL" x="4"  y="16" width="11" height="22" rx="3"></rect>
                <rect class="wheel" id="wFR" x="49" y="16" width="11" height="22" rx="3"></rect>
                <rect class="wheel" id="wRL" x="2"  y="88" width="12" height="24" rx="3"></rect>
                <rect class="wheel" id="wRR" x="50" y="88" width="12" height="24" rx="3"></rect>
                <polygon class="car-chassis" stroke-linejoin="round" points="
                    32,6   38,20  38,42  44,52  44,90  37,102 37,113
                    27,113 27,102 20,90  20,52  26,42  26,20" />
                <rect class="car-wing" x="12" y="13"  width="40" height="3.5" rx="1.5"></rect>
                <rect class="car-wing" x="10" y="115" width="44" height="4.5" rx="1.5"></rect>
                <circle class="car-halo" cx="32" cy="47" r="7"></circle>
            </svg>
        </div>
        <div class="hud-tyre-wear-readout">
            <div class="hud-screen"><span class="hud-mono" id="tyre-wear-value">0</span><span class="hud-mono">%</span></div>
            <span class="hud-eyebrow">Usura</span>
        </div>
    </div>

    <!-- HUD: minimappa — bottom-right. Path e marker gestiti da f1.js (anime.js) -->
    <div class="hud hud-minimap hud-panel-neu" id="minimap-box">
        <div class="hud-screen">
            <svg id="minimap-svg" viewBox="0 0 200 140">
                <path id="minimap-track" class="minimap-track-line"></path>
                <g id="minimap-dot">
                    <circle class="minimap-you-halo"></circle>
                    <circle class="minimap-you-core"></circle>
                </g>
            </svg>
        </div>
    </div>
```

Nota: `.hud-bottom`/`.speed-box` del vecchio markup sono sostituiti dal nuovo `.hud.hud-speed.hud-panel-neu` — non deve restare nessun `<div class="hud-bottom">` residuo.

- [ ] **Step 2: Aggiungi anime.js e bump cache-busting**

In `frontend/f1.html`, sostituisci il blocco finale degli script (righe 113-120):

```html
    <script src="/socket.io/socket.io.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/animejs@3.2.1/lib/anime.min.js"></script>
    <script src="shared/trackGeometry.js?v=20260722d"></script>
    <script src="shared/trackMeshBuilder.js?v=20260722d"></script>
    <script src="shared/trackScenery.js?v=20260722d"></script>
    <script src="f1Gamepad.js?v=20260723a"></script>
    <script src="f1.js?v=20260723a"></script>
```

- [ ] **Step 3: Verifica**

Apri il file in un editor e controlla che ogni tag sia chiuso correttamente (nessun `<div>` orfano). Il rendering vero si verifica nel Task 4 (senza gli aggiornamenti JS, alcuni box resteranno vuoti/`display:none` ma non devono dare errori in console al caricamento della pagina).

---

### Task 4: JS — aggiorna classifica, timer (gating qualifica) e visibilità gomme

**Files:**
- Modify: `frontend/f1.js` (`updateStandings`, blocco tyre in `f1StateUpdate`, `f1Countdown`, `f1RaceStarted`)

**Interfaces:**
- Consumes: markup del Task 3 (id `standings-box`, `timer-panel`, `tyre-closed`, `tyre-open`, `tyre-icon-closed`, `tyre-compound-dot`, `tyre-compound-label`, `wFL/wFR/wRL/wRR`, `tyre-wear-value`)
- Produces: funzione `wearColor(pct)` (stringa CSS `rgb(...)`), funzione `renderTyreVisibility()`, variabile `tyrePanelOpen` — usate dal Task 5

- [ ] **Step 1: Nascondi la classifica quando vuota**

In `frontend/f1.js`, dentro `updateStandings` (circa riga 706-720), sostituisci:

```js
    function updateStandings(state) {
        const box = document.getElementById('standings-box');
        const entries = Object.entries(state)
            .filter(([, d]) => d.position)
            .sort((a, b) => a[1].position - b[1].position);

        if (entries.length === 0) { box.innerHTML = ''; return; }

        box.innerHTML = entries.map(([color, d]) => `
            <div class="standing-entry${color === myColor ? ' me' : ''}">
                <span class="standing-pos">${d.position}°</span>
                <span class="standing-dot" style="background:${color};"></span>
            </div>
        `).join('');
    }
```

con:

```js
    function updateStandings(state) {
        const box = document.getElementById('standings-box');
        const entries = Object.entries(state)
            .filter(([, d]) => d.position)
            .sort((a, b) => a[1].position - b[1].position);

        if (entries.length === 0) { box.innerHTML = ''; box.style.display = 'none'; return; }

        box.style.display = 'flex';
        box.innerHTML = entries.map(([color, d]) => `
            <div class="standing-entry${color === myColor ? ' me' : ''}">
                <span class="standing-pos">${d.position}°</span>
                <span class="standing-dot" style="background:${color};"></span>
            </div>
        `).join('');
    }
```

- [ ] **Step 2: Aggiungi lo stato locale e la funzione di visibilità gomme**

In `frontend/f1.js`, dove sono dichiarate le altre variabili di stato (vicino a `let currentPhase = null;`, circa riga 388), aggiungi:

```js
    let tyrePanelOpen = false;   // stato locale, mai sincronizzato col server — resettato a chiuso ad ogni f1Countdown

    // Interpola verde -> giallo -> rosso in base all'usura (0-100): stessa
    // scala già usata nel mockup approvato dall'utente.
    function wearColor(pct) {
        const stops = [
            [0,   [79, 191, 130]],
            [55,  [217, 178, 60]],
            [100, [198, 91, 82]],
        ];
        for (let i = 0; i < stops.length - 1; i++) {
            const [p0, c0] = stops[i], [p1, c1] = stops[i + 1];
            if (pct >= p0 && pct <= p1) {
                const f = (pct - p0) / (p1 - p0);
                const c = c0.map((v, idx) => Math.round(v + (c1[idx] - v) * f));
                return `rgb(${c[0]},${c[1]},${c[2]})`;
            }
        }
        return `rgb(${stops[stops.length - 1][1].join(',')})`;
    }

    // Il pannello gomme ha senso SOLO in gara (in qualifica/tyre_select/
    // grid_display l'usura non è mai rilevante — stessa logica del vecchio
    // tyre-box). Dentro la gara, mostra o l'icona chiusa o il pannello
    // esteso a seconda di tyrePanelOpen, mai entrambi.
    function renderTyreVisibility() {
        const closedEl = document.getElementById('tyre-closed');
        const openEl   = document.getElementById('tyre-open');
        if (currentPhase !== 'race') {
            closedEl.style.display = 'none';
            openEl.style.display   = 'none';
            return;
        }
        closedEl.style.display = tyrePanelOpen ? 'none' : 'flex';
        openEl.style.display   = tyrePanelOpen ? 'block' : 'none';
    }
```

- [ ] **Step 3: Riscrivi l'aggiornamento gomme in `f1StateUpdate`**

In `frontend/f1.js`, sostituisci questo blocco (circa righe 685-699):

```js
            // Solo in GARA: in qualifica tutti guidano sullo spec Soft a
            // prescindere dalla mescola scelta (quella conta solo in gara),
            // mostrarla lì sarebbe fuorviante.
            if (color === myColor && currentPhase === 'race' && data.compound && tyreCompoundsInfo) {
                const info = tyreCompoundsInfo[data.compound];
                if (info) {
                    const box = document.getElementById('tyre-box');
                    box.style.display = 'flex';
                    document.getElementById('tyre-dot').style.background = info.color;
                    document.getElementById('tyre-label').textContent = info.label.toUpperCase();
                    document.getElementById('tyre-wear-value').textContent = Math.round(data.tyreWear || 0);
                }
            } else if (color === myColor && currentPhase !== 'race') {
                document.getElementById('tyre-box').style.display = 'none';
            }
```

con:

```js
            // Solo in GARA: in qualifica tutti guidano sullo spec Soft a
            // prescindere dalla mescola scelta (quella conta solo in gara),
            // mostrarla lì sarebbe fuorviante. Aggiorna SEMPRE sia l'icona
            // chiusa che il pannello esteso: quale dei due sia visibile è
            // deciso solo da renderTyreVisibility()/tyrePanelOpen.
            if (color === myColor && currentPhase === 'race' && data.compound && tyreCompoundsInfo) {
                const info = tyreCompoundsInfo[data.compound];
                if (info) {
                    const wear = Math.round(data.tyreWear || 0);
                    const col  = wearColor(wear);
                    document.getElementById('tyre-icon-closed').style.background = col;
                    document.getElementById('tyre-compound-dot').style.background = info.color;
                    document.getElementById('tyre-compound-label').textContent = info.label.toUpperCase();
                    document.getElementById('tyre-wear-value').textContent = wear;
                    ['wFL', 'wFR', 'wRL', 'wRR'].forEach(id =>
                        document.getElementById(id).style.setProperty('--wear', col));
                }
            }
            if (color === myColor) renderTyreVisibility();
```

- [ ] **Step 4: Aggiorna `f1Countdown` — timer sempre nascosto qui, gomme richiuse**

In `frontend/f1.js`, dentro `socket.on('f1Countdown', ...)` (circa riga 733-757), sostituisci questa riga:

```js
        document.getElementById('timer-box').style.visibility = 'hidden';
```

con:

```js
        document.getElementById('timer-panel').style.display = 'none';
        tyrePanelOpen = false;
        renderTyreVisibility();
```

- [ ] **Step 5: Aggiorna `f1RaceStarted` — timer visibile SOLO in qualifica**

In `frontend/f1.js`, dentro `socket.on('f1RaceStarted', ...)` (circa riga 759-775), sostituisci questa riga:

```js
        document.getElementById('timer-box').style.visibility = 'visible';
```

con:

```js
        document.getElementById('timer-panel').style.display = (data?.phase === 'qualifying') ? 'flex' : 'none';
```

- [ ] **Step 6: `node --check`**

Run: `node --check "frontend/f1.js"`
Expected: nessun output

- [ ] **Step 7: Verifica manuale**

Due tab in localhost, entra in qualifica: la classifica resta nascosta (nessuna posizione finché non parte la gara vera, comportamento invariato), il box giri mostra "1/1" dal via (comportamento già corretto da una sessione precedente), il timer top-right è visibile e corre. Passa alla gara: il timer sparisce del tutto (non solo invisibile — ispeziona con gli strumenti sviluppatore che `#timer-panel` abbia `display:none`), la classifica compare con le posizioni, il pannello gomme mostra solo l'icona chiusa (non ancora l'apertura — arriva nel Task 5).

---

### Task 5: JS — toggle pannello gomme (tasto T)

**Files:**
- Modify: `frontend/f1.js` (nuovo keydown listener)

**Interfaces:**
- Consumes: `tyrePanelOpen`, `renderTyreVisibility()` dal Task 4
- Produces: toggle da tastiera funzionante — il Task 6 aggiunge lo stesso toggle da gamepad riusando `renderTyreVisibility()`

- [ ] **Step 1: Aggiungi il listener del tasto T**

In `frontend/f1.js`, subito dopo il listener esistente per la reazione pit stop (circa righe 604-608):

```js
    document.addEventListener('keydown', (e) => {
        if (pitting && e.code === 'Space') {
            socket.emit('f1PitReactionPress', { lobbyId, playerColor: myColor });
        }
    });
```

aggiungi:

```js
    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 't') {
            tyrePanelOpen = !tyrePanelOpen;
            renderTyreVisibility();
        }
    });
```

- [ ] **Step 2: `node --check`**

Run: `node --check "frontend/f1.js"`
Expected: nessun output

- [ ] **Step 3: Verifica manuale**

In gara, premi T: il pannello si apre mostrando la sagoma auto (4 gomme colorate secondo l'usura corrente, tutte uguali) e la percentuale una sola volta. Premi T di nuovo: si richiude, torna l'icona. Verifica anche cliccando sull'header del pannello aperto (`#tyre-open-head`) — se vuoi aggiungere anche il click come scorciatoia va bene, ma non è richiesto dalla spec (il tasto T basta).

---

### Task 6: Gamepad — L1 per toggle gomme

**Files:**
- Modify: `frontend/f1Gamepad.js`
- Modify: `frontend/f1.js` (blocco `F1GamepadInput.setCallbacks`)

**Interfaces:**
- Consumes: `tyrePanelOpen`/`renderTyreVisibility()` dal Task 4/5
- Produces: callback `onTyreToggle` — nessun consumatore successivo, è l'ultimo pezzo dell'interazione gomme

- [ ] **Step 1: Aggiungi il bottone L1 alla mappatura**

In `frontend/f1Gamepad.js`, nelle costanti in testa (righe 11-17):

```js
    const AXIS_STEER    = 0;   // Stick sinistro, asse X
    const BTN_THROTTLE  = 7;   // R2 (grilletto destro)
    const BTN_BRAKE     = 6;   // L2 (grilletto sinistro)
    const BTN_CONFIRM   = 0;   // X / Cross — reazione pit O conferma mescola (dipende dalla fase)
    const BTN_CAMERA    = 3;   // Triangolo / Y
    const BTN_DPAD_LEFT  = 14;
    const BTN_DPAD_RIGHT = 15;
```

aggiungi subito dopo `BTN_CAMERA`:

```js
    const BTN_TYRE_TOGGLE = 4;   // L1 — apri/chiudi il pannello gomme (mappatura standard Gamepad API: index 4 = LB/L1)
```

- [ ] **Step 2: Aggiungi lo stato edge-triggered e la callback**

Nelle variabili di stato (righe 21-27):

```js
    let connected = false;
    let gpIdx     = null;
    let prevConfirm = false;
    let prevCamera  = false;
    let prevDpadL   = false;
    let prevDpadR   = false;
    let cbs = {};
```

sostituisci con:

```js
    let connected = false;
    let gpIdx     = null;
    let prevConfirm = false;
    let prevCamera  = false;
    let prevDpadL   = false;
    let prevDpadR   = false;
    let prevTyre    = false;
    let cbs = {};
```

Nel reset alla connessione (riga 32):

```js
        prevConfirm = prevCamera = prevDpadL = prevDpadR = false;
```

sostituisci con:

```js
        prevConfirm = prevCamera = prevDpadL = prevDpadR = prevTyre = false;
```

Nel corpo di `poll()`, subito dopo il blocco camera (circa righe 71-73):

```js
        const cameraNow = (gp.buttons[BTN_CAMERA] || { pressed: false }).pressed;
        if (cameraNow && !prevCamera && cbs.onCameraToggle) cbs.onCameraToggle();
        prevCamera = cameraNow;
```

aggiungi subito dopo:

```js
        const tyreNow = (gp.buttons[BTN_TYRE_TOGGLE] || { pressed: false }).pressed;
        if (tyreNow && !prevTyre && cbs.onTyreToggle) cbs.onTyreToggle();
        prevTyre = tyreNow;
```

- [ ] **Step 3: `node --check` su f1Gamepad.js**

Run: `node --check "frontend/f1Gamepad.js"`
Expected: nessun output

- [ ] **Step 4: Registra la callback in f1.js**

In `frontend/f1.js`, dentro `F1GamepadInput.setCallbacks({...})` (circa righe 1006-1014):

```js
        F1GamepadInput.setCallbacks({
            onConfirm: () => {
                if (activeTyreContainerId) tyreConfirm();
                else if (pitting) socket.emit('f1PitReactionPress', { lobbyId, playerColor: myColor });
            },
            onCameraToggle: () => { cameraMode = cameraMode === 'third' ? 'first' : 'third'; },
            onNavLeft:      () => tyreNav(-1),
            onNavRight:     () => tyreNav(1),
        });
```

sostituisci con:

```js
        F1GamepadInput.setCallbacks({
            onConfirm: () => {
                if (activeTyreContainerId) tyreConfirm();
                else if (pitting) socket.emit('f1PitReactionPress', { lobbyId, playerColor: myColor });
            },
            onCameraToggle: () => { cameraMode = cameraMode === 'third' ? 'first' : 'third'; },
            onNavLeft:      () => tyreNav(-1),
            onNavRight:     () => tyreNav(1),
            onTyreToggle:   () => { tyrePanelOpen = !tyrePanelOpen; renderTyreVisibility(); },
        });
```

- [ ] **Step 5: `node --check` su f1.js**

Run: `node --check "frontend/f1.js"`
Expected: nessun output

- [ ] **Step 6: Verifica manuale**

Con un controller collegato, in gara premi L1: stesso comportamento del tasto T (apre/chiude il pannello gomme). Se non hai un controller a disposizione per il test, verifica almeno che la pagina non dia errori in console con il controller collegato ma inattivo (nessun bottone premuto).

---

### Task 7: Minimappa — path pista + marker via anime.js

**Files:**
- Modify: `frontend/f1.js`

**Interfaces:**
- Consumes: `trackPts` (array di `{x, z, ...}`, già definito riga 86), `N_SAMPLES` (riga 85), `myColor`, `anime` (globale da anime.js, script Task 3), markup `#minimap-track`/`#minimap-dot` (Task 3)
- Produces: funzione `updateMinimap(trackIndex)` chiamata dentro `animate()` — nessun consumatore successivo, è l'ultimo task del piano

- [ ] **Step 1: Genera il path SVG una volta, subito dopo `trackPts`**

In `frontend/f1.js`, subito dopo questa riga esistente (circa riga 86):

```js
    const trackPts  = TrackGeometry.sampleLoop(trackData.controlPoints, N_SAMPLES);
```

aggiungi:

```js
    // ====================================================
    // MINIMAPPA — contorno pista in SVG, generato una tantum proiettando
    // trackPts (x,z) sul piano. Nessuna finezza di parametrizzazione per
    // arco: 1000 vertici a poligono sono già lisci a queste dimensioni.
    // ====================================================
    function buildMinimapPath(pts) {
        const xs = pts.map(p => p.x), zs = pts.map(p => p.z);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minZ = Math.min(...zs), maxZ = Math.max(...zs);
        const w = maxX - minX, h = maxZ - minZ;
        const VB = 200, MARGIN = 16;
        const scale = Math.min((VB - MARGIN * 2) / w, (VB - MARGIN * 2) / h);
        const offX = MARGIN + (VB - MARGIN * 2 - w * scale) / 2 - minX * scale;
        const offZ = MARGIN + (VB - MARGIN * 2 - h * scale) / 2 - minZ * scale;
        const toSvg = (p) => `${(p.x * scale + offX).toFixed(1)},${(p.z * scale + offZ).toFixed(1)}`;
        return `M ${toSvg(pts[0])} ` + pts.slice(1).map(p => `L ${toSvg(p)}`).join(' ') + ' Z';
    }
```

- [ ] **Step 2: Inizializza path, marker e animazione anime.js**

In `frontend/f1.js`, subito prima di questa riga esistente (circa riga 1077):

```js
    const timerEl = document.getElementById('hud-timer');
```

aggiungi:

```js
    // Marker minimappa: colore auto del giocatore, stesso valore già usato
    // altrove (es. standing-dot) — nessuna nuova palette.
    const minimapTrackEl = document.getElementById('minimap-track');
    const minimapDotEl   = document.getElementById('minimap-dot');
    minimapTrackEl.setAttribute('d', buildMinimapPath(trackPts));
    minimapDotEl.querySelectorAll('circle').forEach(c => { c.style.fill = myColor; });

    // anime.js Motion Path (vedi documentazione createMotionPath): l'istanza
    // resta SEMPRE in pausa (autoplay:false) — non è mai il tempo a farla
    // avanzare, ma updateMinimap() che la "scrub-ba" ad ogni frame in base
    // al trackIndex reale ricevuto dal server via f1StateUpdate.
    const MINIMAP_DURATION = 1000;
    const minimapMotionPath = anime.path(minimapTrackEl);
    const minimapAnim = anime({
        targets: minimapDotEl,
        translateX: minimapMotionPath('x'),
        translateY: minimapMotionPath('y'),
        easing: 'linear',
        duration: MINIMAP_DURATION,
        autoplay: false,
    });

    function updateMinimap(trackIndex) {
        const progress = ((trackIndex || 0) / N_SAMPLES) % 1;
        minimapAnim.seek(progress * MINIMAP_DURATION);
    }
```

- [ ] **Step 3: Chiama `updateMinimap` nel render loop**

In `frontend/f1.js`, dentro `animate()`, sostituisci questo blocco (circa righe 1234-1237):

```js
            if (color === myColor) {
                speedEl.textContent = Math.round(Math.abs(target.speed || 0) * 55);
                if (target.finished && target.time) myFinalTime = target.time;
            }
```

con:

```js
            if (color === myColor) {
                speedEl.textContent = Math.round(Math.abs(target.speed || 0) * 55);
                if (target.finished && target.time) myFinalTime = target.time;
                updateMinimap(target.trackIndex);
            }
```

- [ ] **Step 4: `node --check`**

Run: `node --check "frontend/f1.js"`
Expected: nessun output

- [ ] **Step 5: Verifica manuale**

In localhost, apri la console del browser e controlla che non ci siano errori tipo `anime is not defined` (se compare, verifica che lo script anime.js del Task 3 sia effettivamente prima di `f1.js` nell'HTML e che l'URL CDN risponda). Guida un giro: il pallino nella minimappa deve percorrere il contorno pista seguendo la posizione reale dell'auto, tornando al punto di partenza al giro successivo.

---

## Verifica finale (dopo tutti i task)

Due tab in localhost, una sessione completa:
- **Qualifica**: timer visibile e che corre, giri "1/1" dal via, classifica assente (nessuna posizione), gomme assenti (fase non-gara), minimappa visibile con il pallino che si muove
- **Gara**: timer del tutto assente (non solo invisibile — controlla `display:none` con gli strumenti sviluppatore), giri "N/totale" corretti per tutta la durata dell'ultimo giro, classifica con le posizioni aggiornate, gomme chiuse di default (icona colorata secondo l'usura), T e L1 aprono/chiudono mostrando sagoma auto + 4 gomme + percentuale unica, minimappa aggiornata in tempo reale
- Nessun elemento "fantasma" del vecchio HUD (nome pista, boost) in nessuna fase
- Nessun errore in console del browser in nessuna delle fasi sopra
