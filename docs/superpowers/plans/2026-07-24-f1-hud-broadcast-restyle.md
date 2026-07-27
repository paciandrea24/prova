# F1 HUD Broadcast Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire lo stile neumorfico dell'HUD in-game con uno stile piatto ispirato al broadcast/gioco ufficiale F1; unire classifica e giri in un pannello solo (con distacco dal leader e animazione di sorpasso), unire tempo e velocità (ora visibili anche in gara), mostrare TUTTI i piloti sulla minimappa invece del solo proprio.

**Architecture:** Nuovo set di custom property CSS (`--f1-*`) e una classe pannello piatta (`.f1-panel`), affiancati a quelli neumorfici esistenti (`--hud-*`/`.hud-panel-neu`, usati dai menu a schermo intero — non toccati da questo piano). Il distacco dal leader è calcolato lato server come stima distanza/velocità, ricalcolata ogni 3.5s e riusata (nessun nuovo evento socket). La minimappa passa da un singolo marker anime.js a marker SVG nativi creati/distrutti dinamicamente per giocatore (stesso pattern già usato per `otherCars`/`hitboxMeshes`).

**Tech Stack:** HTML/CSS/JS vanilla, anime.js v3.2.1 già in uso (per l'animazione di sorpasso, FLIP).

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-07-24-f1-hud-broadcast-restyle-design.md`.
- NON toccare `--hud-*`/`.hud-panel-neu`/`.hud-screen`/`.menu-panel-neu`/`.menu-overlay-bg` — usati dai menu a schermo intero (scelta gomme, podio, reveal pole), fuori scope.
- NON toccare la vista telecamera "C" o il modello dell'auto — progetto separato.
- Il calcolo del distacco è una stima (distanza/velocità), non un timing di precisione — accettato esplicitamente.
- Due cambiamenti di comportamento voluti (non bug da "correggere" se notati in verifica): (1) il chip giri non ha più un posto visibile durante la qualifica (nascosto insieme al resto del pannello classifica, che è race-only); (2) la velocità sparisce fuori da qualifica/gara attiva (prima era sempre visibile).
- Dopo ogni modifica `.js`, `node --check`. Dopo ogni modifica HTML/CSS, verifica visiva che tag/regole siano ben chiusi.
- Niente commit automatici salvo consenso esplicito dell'utente per questa sessione (verificare con l'utente prima di far committare un subagent).

---

### Task 1: Backend — distacco dal leader

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js`

**Interfaces:**
- Consumes: `progressScore(p, track)` (già esistente), `players` (array già in scope in `tickGame`, riga 828)
- Produces: campo `gapToLeaderMs` (number o `null`) nel payload di `f1StateUpdate` (via `buildPublicState`) — consumato dal Task 4 (frontend JS)

- [ ] **Step 1: Costante e stato**

Vicino alle altre costanti temporali in testa al file, aggiungi:

```js
const GAP_RECALC_MS = 3500;   // ricalcolo distacco dal leader — non serve più frequente, è una stima
```

Nel blocco `activeGames.set(lobbyId, { ... })` (circa riga 209-228), dentro l'oggetto, aggiungi un campo (es. subito dopo `raceStartTime: null,`):

```js
                lastGapRecalc:     0,      // timestamp ultimo ricalcolo distacco dal leader (vedi GAP_RECALC_MS)
```

- [ ] **Step 2: Nuovi campi sul giocatore**

Nel blocco di creazione giocatore (circa riga 265-278), dentro l'handler `joinF1Game`, subito dopo questa riga esistente:

```js
                falseStartServed: false,  // true una volta scontata la penalità al primo pit stop
```

aggiungi:

```js
                gapToLeaderMs:   null,    // stima distacco dal leader in ms, null per il leader stesso o prima del primo ricalcolo
```

- [ ] **Step 3: Reset in `assignGridSpawns`**

In `assignGridSpawns` (circa riga 622-641), subito dopo questa riga esistente:

```js
        p.falseStart = false; p.falseStartServed = false;
```

aggiungi:

```js
        p.gapToLeaderMs = null;
```

- [ ] **Step 4: Calcolo in `tickGame`**

In `tickGame`, subito PRIMA di questa riga esistente (circa riga 883):

```js
    broadcastState(io, lobbyId, game, true);
```

aggiungi (nota: `players` è già l'array `Object.values(game.players)`, dichiarato riga 828 — riusalo, non richiamare `Object.values` di nuovo):

```js
    // Distacco dal leader: stima da distanza/velocità, ricalcolata ogni
    // GAP_RECALC_MS e riusata fino al prossimo giro — non serve precisione
    // al millisecondo, un vero timing per-checkpoint sarebbe uno sforzo
    // sproporzionato per quello che serve qui (esplicitamente accettato).
    if (game.phase === 'race' && Date.now() - (game.lastGapRecalc || 0) >= GAP_RECALC_MS) {
        game.lastGapRecalc = Date.now();
        const ranked = [...players].sort((a, b) => progressScore(b, game.track) - progressScore(a, game.track));
        const leader = ranked[0];
        const metersPerUnit = game.track.lapLength / game.track.points.length;
        for (const p of ranked) {
            if (p === leader) { p.gapToLeaderMs = null; continue; }
            const distanceBehindUnits = progressScore(leader, game.track) - progressScore(p, game.track);
            const distanceBehindM = Math.max(0, distanceBehindUnits) * metersPerUnit;
            // speed è in unità/tick fisico; conversione a m/s: la stessa
            // usata dal client per mostrare i km/h (speed*55), portata a m/s (/3.6).
            const speedMs = Math.max(0.5, Math.abs(p.speed) * 55 / 3.6);   // pavimento anti-divisione-per-zero
            p.gapToLeaderMs = Math.round((distanceBehindM / speedMs) * 1000);
        }
    }

```

- [ ] **Step 5: Campo in `buildPublicState`**

In `buildPublicState` (circa riga 1271-1305), sostituisci:

```js
            falseStart: !!p.falseStart,
            falseStartServed: !!p.falseStartServed
        };
```

con:

```js
            falseStart: !!p.falseStart,
            falseStartServed: !!p.falseStartServed,
            gapToLeaderMs: (p.gapToLeaderMs != null) ? p.gapToLeaderMs : null
        };
```

- [ ] **Step 6: `node --check`**

Run: `node --check "backend/sockets/games/f1GameSocket.js"`
Expected: nessun output

- [ ] **Step 7: Verifica statica**

Rileggi il blocco aggiunto nel Task 4 e conferma che `players` usato lì è
esattamente la variabile già dichiarata riga 828 (non una nuova chiamata a
`Object.values`), e che `[...players].sort(...)` non muta l'array
originale (usato subito dopo per `connected = players.filter(...)`).

---

### Task 2: CSS — sistema piatto `.f1-panel`

**Files:**
- Modify: `frontend/styles/f1.css`

**Interfaces:**
- Consumes: nessuna
- Produces: custom properties `--f1-panel`, `--f1-panel-strong`, `--f1-panel-border`, `--f1-text`, `--f1-text-dim`, `--f1-telemetry`, `--f1-wear-mid`; classe `.f1-panel`; regole per `#standings-panel`/`#lap-chip`/`#timer-speed-panel` — consumate dal Task 3 (HTML)

- [ ] **Step 1: Nuovi custom properties**

Nel blocco `:root { ... }` esistente (righe 1-18), subito prima della `}`
di chiusura, aggiungi:

```css
    --f1-panel:        rgba(9, 11, 14, 0.86);
    --f1-panel-strong: rgba(9, 11, 14, 0.95);
    --f1-panel-border: rgba(255, 255, 255, 0.14);
    --f1-text:         #f2f4f6;
    --f1-text-dim:     #8b96a3;
    --f1-telemetry:    #39c7f2;
    --f1-wear-mid:     #f1c40f;
```

- [ ] **Step 2: Rimuovi le regole superate**

Rimuovi questo blocco intero (circa righe 103-145 — classifica, giri,
timer, velocità nel vecchio sistema):

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
/* flex column + align-items:center invece di text-align:center: centra ogni
   riga sul proprio contenuto (l'eyebrow con letter-spacing altrimenti si
   percepisce leggermente disallineata rispetto al valore sotto). */
.hud-lap {
    top: 14px; left: 50%; transform: translateX(-50%);
    padding: 5px 6px;
    min-width: 74px;
    display: flex;
    flex-direction: column;
    align-items: center;
}
.hud-lap .hud-eyebrow { margin-bottom: 3px; }
.hud-lap .hud-screen { padding: 2px 14px 4px; }
.hud-lap .hud-mono { font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }

/* ---- top-right: timer (solo qualifica) ---- */
.hud-timer {
    top: 14px; right: 12px;
    padding: 5px 10px 6px;
    text-align: right;
}
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
```

- [ ] **Step 3: Nuove regole — pannello piatto + classifica/giri + tempo/velocità**

Nello stesso punto dove hai appena rimosso il blocco sopra, scrivi:

```css
/* ========================
   HUD — stile piatto "broadcast" (sostituisce il neumorfismo per gli
   elementi toccati da questo redesign — i menu a schermo intero restano
   sul vecchio sistema .hud-panel-neu/.menu-panel-neu, invariati)
   ======================== */
.f1-panel {
    background: var(--f1-panel);
    border: 1px solid var(--f1-panel-border);
    border-radius: 5px;
    box-shadow: 0 6px 16px rgba(0,0,0,0.45);
}

/* ---- top-left: classifica + giri, un pannello solo ---- */
#standings-panel {
    top: 14px; left: 12px;
    width: 200px;
    overflow: hidden;
}
#lap-chip {
    background: var(--f1-panel-strong);
    padding: 6px 10px;
    display: flex; align-items: baseline; gap: 7px;
    border-bottom: 1px solid var(--f1-panel-border);
    font-family: 'Fredoka', sans-serif;
}
#lap-chip .eyebrow {
    text-transform: uppercase;
    font-weight: 800; letter-spacing: 1.5px; font-size: 10.5px; color: var(--f1-text-dim);
}
#lap-chip-value {
    font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 17px; font-weight: 800; letter-spacing: 0.5px;
    color: var(--f1-text);
}
#standings-rows { padding: 3px 0; }
.f1-standing-row {
    display: flex; align-items: center; gap: 7px;
    padding: 4px 10px;
    font-family: 'Fredoka', sans-serif;
    font-size: 12.5px; font-weight: 600;
    color: var(--f1-text);
}
.f1-standing-row.me { background: rgba(255,255,255,0.05); }
.f1-standing-row .pos { width: 16px; color: var(--f1-text-dim); font-variant-numeric: tabular-nums; }
.f1-standing-row .dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.f1-standing-row .gap {
    margin-left: auto; color: var(--f1-text-dim); font-size: 11px;
    font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
    font-variant-numeric: tabular-nums;
}

/* ---- top-right: tempo + velocità ---- */
#timer-speed-panel {
    top: 14px; right: 12px;
    display: flex;
}
#timer-speed-panel .col {
    padding: 8px 16px;
    text-align: right;
    font-family: 'Fredoka', sans-serif;
}
#timer-speed-panel .col + .col { border-left: 1px solid var(--f1-panel-border); }
#timer-speed-panel .eyebrow {
    text-transform: uppercase;
    font-weight: 800; letter-spacing: 1.5px; font-size: 9.5px; color: var(--f1-text-dim);
    display: block; margin-bottom: 3px;
}
#timer-speed-panel .value {
    font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 19px; font-weight: 700; color: var(--f1-text);
}
#timer-speed-panel #speed-value { color: var(--f1-telemetry); }
#timer-speed-panel .unit { font-size: 10px; color: var(--f1-text-dim); margin-left: 2px; }
```

- [ ] **Step 4: Aggiorna `.hud-tyre-closed`/`.hud-tyre-open` e `.wheel` al nuovo fallback**

Nel blocco esistente (circa righe 147-188), sostituisci SOLO questa riga
(il resto del blocco `.hud-tyre-*` resta invariato — posizionamento,
dimensioni, tutto il resto):

```css
.wheel       { fill: var(--wear, var(--hud-wear-mid)); transition: fill 0.4s ease; }
```

con:

```css
.wheel       { fill: var(--wear, var(--f1-wear-mid)); transition: fill 0.4s ease; }
```

(Il Task 3 aggiungerà `.f1-panel` come classe aggiuntiva su `#tyre-closed`/
`#tyre-open`/`#minimap-box` al posto di `.hud-panel-neu` — nessun'altra
modifica CSS necessaria qui, `.hud-tyre-closed`/`.hud-tyre-open`/
`.hud-minimap` restano come classi di posizionamento/dimensione.)

- [ ] **Step 5: Rimuovi le classi classifica ormai sostituite**

`.standing-entry`/`.standing-entry.me`/`.standing-pos`/`.standing-dot`
diventeranno dead code non appena il Task 4 riscrive `updateStandings()`
per usare `.f1-standing-row`/`.pos`/`.dot` — rimuovile ORA (sono usate SOLO
dal template che il Task 4 sostituisce, verificato: nessun altro file le
referenzia). NON toccare `.standings-box` poco sopra nello stesso punto del
file: è già oggi una classe orfana indipendente da questo piano (nessun
elemento nell'HTML ha mai `class="standings-box"` — solo l'id
`id="standings-box"`, tutt'altra cosa), preesistente e fuori scope, non
introdotta né peggiorata da questo lavoro.

Rimuovi questo blocco (circa righe 285-308, subito dopo `.standings-box`
che invece resta):

```css
.standing-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
}

.standing-entry.me {
    font-weight: 900;
    color: #c0392b;
}

.standing-pos {
    width: 24px;
    text-align: right;
}

.standing-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--border-color);
    flex-shrink: 0;
}
```

- [ ] **Step 6: Verifica**

Apri il file e controlla che ogni `{` abbia la sua `}`. Il rendering vero
si verifica nel Task 3 (finché l'HTML non usa i nuovi id/classi, questi
stili non hanno ancora effetto visibile — atteso, non un errore).

---

### Task 3: HTML — nuovo markup pannelli

**Files:**
- Modify: `frontend/f1.html`

**Interfaces:**
- Consumes: classe `.f1-panel`, id `#standings-panel`/`#lap-chip`/`#lap-chip-value`/`#standings-rows`/`#timer-speed-panel` dal Task 2
- Produces: markup finale — consumato dal Task 4 (JS)

- [ ] **Step 1: Sostituisci classifica + giri con il pannello unico**

Sostituisci questo blocco (righe 12-19):

```html
    <!-- HUD: classifica live — top-left. Popolata da updateStandings() in f1.js -->
    <div class="hud hud-standings hud-panel-neu" id="standings-box" style="display:none;"></div>

    <!-- HUD: giri — top-center, stile broadcast (giro CORRENTE/totale) -->
    <div class="hud hud-lap hud-panel-neu" id="lap-box" style="display:none;">
        <span class="hud-eyebrow">LAP</span>
        <div class="hud-screen"><span class="hud-mono" id="lap-display">1/3</span></div>
    </div>
```

con:

```html
    <!-- HUD: classifica + giri — top-left, un pannello solo. Popolato da
         updateStandings()/setLapDisplay() in f1.js. Visibile solo in gara
         (currentPhase !== 'race' nasconde tutto, incluso il chip giri). -->
    <div class="hud f1-panel" id="standings-panel" style="display:none;">
        <div id="lap-chip">
            <span class="eyebrow">Giro</span>
            <span id="lap-chip-value">1/3</span>
        </div>
        <div id="standings-rows"></div>
    </div>
```

- [ ] **Step 2: Sostituisci il timer con il pannello tempo+velocità**

Sostituisci questo blocco (righe 21-29, l'attuale timer standalone SEGUITO
dal box velocità standalone — nota: potrebbero non essere adiacenti nel
file attuale, cerca entrambi):

```html
    <!-- HUD: timer — top-right, SOLO qualifica -->
    <div class="hud hud-timer hud-panel-neu" id="timer-panel" style="display:none;">
        <div class="hud-screen"><span class="hud-mono" id="hud-timer">0:00.000</span></div>
    </div>

    <!-- HUD: velocità — bottom-center -->
    <div class="hud hud-speed hud-panel-neu">
        <div class="hud-screen"><span id="speed-value">0</span><span class="speed-unit"> km/h</span></div>
    </div>
```

con:

```html
    <!-- HUD: tempo + velocità — top-right, un pannello solo. Visibile in
         qualifica E in gara (non più solo qualifica). -->
    <div class="hud f1-panel" id="timer-speed-panel" style="display:none;">
        <div class="col">
            <span class="eyebrow">Tempo</span>
            <span class="value" id="hud-timer">0:00.000</span>
        </div>
        <div class="col">
            <span class="eyebrow">Velocità</span>
            <span class="value" id="speed-value">0</span><span class="unit">km/h</span>
        </div>
    </div>
```

(Nota: l'attributo `class="speed-unit"` sull'unità di misura sparisce — non
serve più, lo stile arriva da `#timer-speed-panel .unit` nel Task 2. La
`<span>` diventa semplicemente `class="unit"`, già scritto sopra.)

- [ ] **Step 3: Aggiorna le classi di gomme e minimappa (solo swap del pannello)**

Sostituisci:

```html
    <div class="hud hud-tyre-closed hud-panel-neu" id="tyre-closed" style="display:none;" title="T / L1 — apri gomme">
```

con:

```html
    <div class="hud hud-tyre-closed f1-panel" id="tyre-closed" style="display:none;" title="T / L1 — apri gomme">
```

Sostituisci:

```html
    <div class="hud hud-tyre-open hud-panel-neu" id="tyre-open" style="display:none;">
```

con:

```html
    <div class="hud hud-tyre-open f1-panel" id="tyre-open" style="display:none;">
```

Sostituisci:

```html
    <div class="hud hud-minimap hud-panel-neu" id="minimap-box">
```

con:

```html
    <div class="hud hud-minimap f1-panel" id="minimap-box">
```

- [ ] **Step 4: Rimuovi il marker statico della minimappa e lo `.hud-screen` interno**

Sostituisci questo blocco (righe 66-77):

```html
    <!-- HUD: minimappa — bottom-right. Path e marker gestiti da f1.js (anime.js) -->
    <div class="hud hud-minimap f1-panel" id="minimap-box">
        <div class="hud-screen">
            <svg id="minimap-svg" viewBox="0 0 200 140">
                <path id="minimap-track" class="minimap-track-line"></path>
                <path id="minimap-pit" class="minimap-pit-line"></path>
                <g id="minimap-dot">
                    <circle class="minimap-you-halo"></circle>
                    <circle class="minimap-you-core"></circle>
                </g>
            </svg>
        </div>
    </div>
```

con:

```html
    <!-- HUD: minimappa — bottom-right. Path generato una tantum, un
         <circle> per giocatore creato/distrutto dinamicamente da f1.js
         (vedi ensureMinimapDot/updateMinimapDot) — non più un marker
         singolo statico. -->
    <div class="hud hud-minimap f1-panel" id="minimap-box">
        <svg id="minimap-svg" viewBox="0 0 200 140">
            <path id="minimap-track" class="minimap-track-line"></path>
            <path id="minimap-pit" class="minimap-pit-line"></path>
        </svg>
    </div>
```

(Lo `.hud-screen` interno sparisce insieme al resto — il nuovo pannello
`.f1-panel` non ha il concetto di "display incassato", l'SVG occupa
direttamente lo spazio del pannello. Verificare nel Task 2/qui che
`.hud-minimap svg` in CSS, se referenziava `.hud-screen svg`, resti
comunque valida — il selettore CSS esistente `.hud-minimap svg { width:100%; height:100%; }`
funziona indipendentemente dalla presenza di `.hud-screen` in mezzo, non
serve toccarlo.)

- [ ] **Step 5: Verifica**

Apri il file e controlla che ogni tag sia chiuso correttamente. Conferma
che NON restino riferimenti a `hud-panel-neu` su nessuno degli elementi
HUD toccati (`grep -n "hud-panel-neu" frontend/f1.html` non deve più
trovare `standings-panel`/`timer-speed-panel`/`tyre-closed`/`tyre-open`/
`minimap-box` — se il grep trova ancora questi id insieme a `hud-panel-neu`,
qualcosa è stato dimenticato).

---

### Task 4: JS — distacco, animazione sorpasso, minimappa multi-pilota, visibilità

**Files:**
- Modify: `frontend/f1.js`

**Interfaces:**
- Consumes: campo `gapToLeaderMs` (Task 1), classi/id del Task 2/3
- Produces: nessuna interfaccia per task successivi (ultimo task del piano)

- [ ] **Step 1: Riscrivi `updateStandings` — distacco + FLIP**

Sostituisci per intero (circa righe 817-839):

```js
    // Classifica live: pallino colore + posizione, ordinata per rank. Mai in
    // qualifica: lì ogni giocatore vede solo se stesso (playersVisibleTo la
    // isola), quindi avrebbe comunque "position" (raceStarted è true anche in
    // qualifica) e mostrerebbe una classifica assurda con un solo "1°" — non
    // basta controllare le entries, va escluso esplicitamente per fase.
    function updateStandings(state) {
        const box = document.getElementById('standings-box');
        if (currentPhase !== 'race') { box.innerHTML = ''; box.style.display = 'none'; return; }

        const entries = Object.entries(state)
            .filter(([, d]) => d.position)
            .sort((a, b) => a[1].position - b[1].position);

        if (entries.length === 0) { box.innerHTML = ''; box.style.display = 'none'; return; }

        box.style.display = 'flex';
        box.innerHTML = entries.map(([color, d]) => `
            <div class="standing-entry${color === myColor ? ' me' : ''}">
                <span class="standing-pos">${d.position}°</span>
                <span class="standing-dot" style="background:${color};"></span>${(d.falseStart && !d.falseStartServed) ? '<span class="false-start-badge">!</span>' : ''}
            </div>
        `).join('');
    }
```

con:

```js
    // Formatta gapToLeaderMs (ms) in "+S.m" (sotto il minuto) o "+M:SS.m"
    // (oltre) — un solo decimale, dato che il calcolo è già una stima
    // (mostrare 3 cifre sarebbe fuorviante). null/leader => stringa vuota.
    function formatGap(ms) {
        if (ms == null) return '';
        const totalDeci = Math.round(ms / 100);
        const s10 = totalDeci % 600;
        const m   = Math.floor(totalDeci / 600);
        const secStr = (s10 / 10).toFixed(1);
        return m > 0 ? `+${m}:${secStr.padStart(4, '0')}` : `+${secStr}`;
    }

    let lastStandingsOrder = [];   // colori nell'ordine dell'ultimo render, per l'animazione FLIP

    // Classifica live: pallino colore + posizione + distacco dal leader,
    // ordinata per rank. Mai in qualifica: lì ogni giocatore vede solo se
    // stesso (playersVisibleTo la isola), quindi avrebbe comunque
    // "position" (raceStarted è true anche in qualifica) e mostrerebbe una
    // classifica assurda con un solo "1°" — non basta controllare le
    // entries, va escluso esplicitamente per fase.
    function updateStandings(state) {
        const box = document.getElementById('standings-panel');
        const rowsEl = document.getElementById('standings-rows');
        if (currentPhase !== 'race') { rowsEl.innerHTML = ''; box.style.display = 'none'; lastStandingsOrder = []; return; }

        const entries = Object.entries(state)
            .filter(([, d]) => d.position)
            .sort((a, b) => a[1].position - b[1].position);

        if (entries.length === 0) { rowsEl.innerHTML = ''; box.style.display = 'none'; lastStandingsOrder = []; return; }

        box.style.display = 'flex';
        const newOrder = entries.map(([color]) => color);

        // FLIP: calcola, PRIMA di ridisegnare, dove si trovava ogni pilota
        // nell'ordine precedente — serve per far "scavalcare" chi sorpassa
        // invece di un secco ricalcolo della lista.
        const prevIndex = {};
        lastStandingsOrder.forEach((color, i) => { prevIndex[color] = i; });

        rowsEl.innerHTML = entries.map(([color, d]) => `
            <div class="f1-standing-row${color === myColor ? ' me' : ''}" data-color="${color}">
                <span class="pos">${d.position}</span>
                <span class="dot" style="background:${color};"></span>
                ${color === myColor ? 'TU' : ''}${(d.falseStart && !d.falseStartServed) ? '<span class="false-start-badge">!</span>' : ''}
                <span class="gap">${formatGap(d.gapToLeaderMs)}</span>
            </div>
        `).join('');

        const ROW_HEIGHT = 24;   // deve corrispondere all'altezza reale di .f1-standing-row (padding incluso)
        rowsEl.querySelectorAll('.f1-standing-row').forEach((rowEl, newIdx) => {
            const color = rowEl.dataset.color;
            const oldIdx = prevIndex[color];
            if (oldIdx === undefined || oldIdx === newIdx) return;   // nuova riga o posizione invariata: nessuna animazione
            const deltaPx = (oldIdx - newIdx) * ROW_HEIGHT;
            anime({
                targets: rowEl,
                translateY: [deltaPx, 0],
                duration: 420,
                easing: 'easeOutQuad',
            });
        });

        lastStandingsOrder = newOrder;
    }
```

- [ ] **Step 2: Aggiorna il target DOM di `setLapDisplay`**

In `setLapDisplay` (circa righe 462-473), sostituisci:

```js
    function setLapDisplay(completedLaps, phaseName) {
        document.getElementById('lap-box').style.display = 'flex';
        const el = document.getElementById('lap-display');
        // In qualifica non ha senso mostrare "1/1" (un solo giro secco non è
        // un rapporto giri/totale) — l'utente lo trovava fuorviante.
        if (phaseName === 'qualifying') {
            el.textContent = 'GIRO SECCO';
            return;
        }
        const current = Math.min(completedLaps + 1, raceTotalLaps);
        el.textContent = `${current}/${raceTotalLaps}`;
    }
```

con:

```js
    function setLapDisplay(completedLaps, phaseName) {
        const el = document.getElementById('lap-chip-value');
        // In qualifica non ha senso mostrare "1/1" (un solo giro secco non è
        // un rapporto giri/totale) — l'utente lo trovava fuorviante. Nota:
        // il pannello che contiene questo chip è visibile SOLO in gara
        // (vedi updateStandings), quindi questa scrittura in qualifica non
        // si vede mai — innocua, non serve un controllo in più per evitarla.
        if (phaseName === 'qualifying') {
            el.textContent = 'GIRO SECCO';
            return;
        }
        const current = Math.min(completedLaps + 1, raceTotalLaps);
        el.textContent = `${current}/${raceTotalLaps}`;
    }
```

- [ ] **Step 3: Estendi la visibilità di tempo+velocità alla gara**

Nel file ci sono TRE punti che oggi impostano `document.getElementById('timer-panel').style.display`.

Primo punto — dentro l'handler `f1Setup` (circa riga 759), sostituisci:

```js
            document.getElementById('timer-panel').style.display = (phase === 'qualifying') ? 'flex' : 'none';
```

con:

```js
            document.getElementById('timer-speed-panel').style.display = (phase === 'qualifying' || phase === 'race') ? 'flex' : 'none';
```

Secondo punto — dentro l'handler `f1Countdown` (circa riga 858), sostituisci:

```js
        document.getElementById('timer-panel').style.display = 'none';
```

con:

```js
        document.getElementById('timer-speed-panel').style.display = 'none';
```

Terzo punto — dentro l'handler `f1RaceStarted` (circa riga 923), sostituisci:

```js
            document.getElementById('timer-panel').style.display = (data?.phase === 'qualifying') ? 'flex' : 'none';
```

con:

```js
            document.getElementById('timer-speed-panel').style.display = (data?.phase === 'qualifying' || data?.phase === 'race') ? 'flex' : 'none';
```

- [ ] **Step 4: Riscrivi la minimappa per più piloti**

Trova questo blocco esistente (circa righe 1246-1274, subito prima di
`const timerEl = document.getElementById('hud-timer');`):

```js
    // Marker minimappa: colore auto del giocatore, stesso valore già usato
    // altrove (es. standing-dot) — nessuna nuova palette.
    const minimapTrackEl = document.getElementById('minimap-track');
    const minimapPitEl   = document.getElementById('minimap-pit');
    const minimapDotEl   = document.getElementById('minimap-dot');
    const minimapT = minimapTransform([...trackPts, ...PIT_PTS]);
    minimapTrackEl.setAttribute('d', minimapPathString(trackPts, minimapT, true));
    minimapPitEl.setAttribute('d', minimapPathString(PIT_PTS, minimapT, false));
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

sostituiscilo con:

```js
    // Contorno pista/corsia box: generato una tantum come prima. I marker
    // (uno per giocatore, non più solo il proprio) sono <circle> SVG creati
    // e distrutti dinamicamente — stesso pattern già usato per
    // otherCars/hitboxMeshes altrove in questo file — non anime.js: con un
    // insieme dinamico di piloti che si uniscono/lasciano la partita,
    // gestire N istanze anime.js parallele è inutilmente complesso, e
    // getPointAtLength nativo basta da solo per posizionare un punto.
    const minimapTrackEl = document.getElementById('minimap-track');
    const minimapPitEl   = document.getElementById('minimap-pit');
    const minimapT = minimapTransform([...trackPts, ...PIT_PTS]);
    minimapTrackEl.setAttribute('d', minimapPathString(trackPts, minimapT, true));
    minimapPitEl.setAttribute('d', minimapPathString(PIT_PTS, minimapT, false));

    const minimapDots = {};   // color -> <circle> element

    function ensureMinimapDot(color) {
        if (minimapDots[color]) return minimapDots[color];
        const svg = document.getElementById('minimap-svg');
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('r', color === myColor ? '4' : '3');
        c.setAttribute('fill', color);
        c.setAttribute('stroke', 'rgba(0,0,0,0.55)');
        c.setAttribute('stroke-width', '1');
        svg.appendChild(c);
        minimapDots[color] = c;
        return c;
    }

    function updateMinimapDot(color, trackIndex) {
        const dot = ensureMinimapDot(color);
        const progress = ((trackIndex || 0) / N_SAMPLES) % 1;
        const len = minimapTrackEl.getTotalLength();
        const pt  = minimapTrackEl.getPointAtLength(progress * len);
        dot.setAttribute('cx', pt.x);
        dot.setAttribute('cy', pt.y);
    }
```

- [ ] **Step 5: Chiama `updateMinimapDot` per ogni giocatore in `f1StateUpdate`**

Nell'handler `socket.on('f1StateUpdate', (state) => { ... })` (circa righe
774-815), dentro il loop `for (const [color, data] of Object.entries(state))`,
subito dopo questa riga esistente:

```js
            serverState[color] = data;
```

aggiungi:

```js
            updateMinimapDot(color, data.trackIndex);
```

(`updateMinimapDot` è una *function declaration*, quindi è "hoisted"
nell'ambito della funzione `async () => { ... }` che racchiude tutto il
file: può essere chiamata qui anche se è definita più avanti nel file,
nessun problema di ordine.)

- [ ] **Step 6: Rimuovi la vecchia chiamata `updateMinimap` in `animate()`**

Dentro `animate()` (circa righe 1433-1437), sostituisci:

```js
            if (color === myColor) {
                speedEl.textContent = Math.round(Math.abs(target.speed || 0) * 55);
                if (target.finished && target.time) myFinalTime = target.time;
                updateMinimap(target.trackIndex);
            }
```

con:

```js
            if (color === myColor) {
                speedEl.textContent = Math.round(Math.abs(target.speed || 0) * 55);
                if (target.finished && target.time) myFinalTime = target.time;
            }
```

- [ ] **Step 7: Pulizia dot alla disconnessione**

Nell'handler `socket.on('f1PlayerLeft', (color) => { ... })` (circa righe
841-845), sostituisci:

```js
    socket.on('f1PlayerLeft', (color) => {
        if (otherCars[color]) { scene.remove(otherCars[color]); delete otherCars[color]; }
        if (hitboxMeshes[color]) { scene.remove(hitboxMeshes[color]); delete hitboxMeshes[color]; }
        delete serverState[color]; delete visualState[color];
    });
```

con:

```js
    socket.on('f1PlayerLeft', (color) => {
        if (otherCars[color]) { scene.remove(otherCars[color]); delete otherCars[color]; }
        if (hitboxMeshes[color]) { scene.remove(hitboxMeshes[color]); delete hitboxMeshes[color]; }
        if (minimapDots[color]) { minimapDots[color].remove(); delete minimapDots[color]; }
        delete serverState[color]; delete visualState[color];
    });
```

- [ ] **Step 8: `node --check`**

Run: `node --check "frontend/f1.js"`
Expected: nessun output

- [ ] **Step 9: Verifica statica**

Conferma che `standings-box`/`lap-box`/`lap-display`/`timer-panel`/
`minimap-dot`/`updateMinimap(` (la vecchia funzione, non
`updateMinimapDot`)/`standing-entry`/`standing-pos`/`standing-dot` non
compaiano più da nessuna parte nel file (`grep -n
"standings-box\|lap-box\|lap-display\|timer-panel\|minimap-dot\|standing-entry\|standing-pos\|standing-dot"
frontend/f1.js` deve restituire zero righe — se ne trova, un punto è stato
dimenticato). Conferma che `ROW_HEIGHT` in `updateStandings` (24px) sia
plausibile rispetto al CSS reale di `.f1-standing-row` (Task 2: `padding:
4px 10px` + `font-size: 12.5px` — un'altezza totale nell'ordine dei
20-24px è ragionevole, ma la verifica ESATTA in pixel richiede il rendering
reale in browser, per l'utente in localhost).

---

## Verifica finale

Due tab in localhost, gara con sorpassi reali: pannello classifica+giri
unico in alto a sinistra, distacchi che compaiono/si aggiornano entro
~3.5s dall'inizio gara; un sorpasso vero produce l'animazione di
scavalcamento (non un ricalcolo secco della lista); tempo+velocità visibili
sia in qualifica che in gara; minimappa con un pallino per OGNI giocatore
connesso, nessun errore in console quando uno dei due lascia la lobby a
metà gara. Verificare anche che l'`ROW_HEIGHT` hardcoded nell'animazione
FLIP corrisponda visivamente all'altezza reale delle righe (se lo
scavalcamento sembra "sfasato" verticalmente, il valore va tarato a vista).
