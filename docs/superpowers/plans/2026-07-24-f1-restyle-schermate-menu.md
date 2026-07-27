# F1 Restyle Schermate Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare le card gomme (scelta iniziale + box), il reveal di fine qualifica, il modale podio/griglia di partenza e il pannello ai box allo stesso linguaggio scuro/neumorfico dell'HUD già rifatto, con animazioni anime.js al posto delle transizioni CSS/`setInterval` a mano; riposizionare il semaforo in alto al centro (non più a centro schermo); aggiungere una dissolvenza a nero che copre il riposizionamento dell'auto quando si preme "Riprova".

**Architecture:** Puro lavoro frontend più un piccolo emit server aggiuntivo (nessuna modifica alla logica di gioco). Riuso diretto dei custom properties già introdotti per l'HUD (`--hud-surface`, `--hud-shadow-dk/lt`, `--hud-text`/`--hud-text-dim`) — nessun nuovo sistema di colore. Le card gomme sono un componente condiviso (`renderTyreCards()` in `frontend/f1.js`): un solo restyle CSS + una sola aggiunta di animazione copre sia lo schermo di scelta iniziale sia il pannello ai box.

**Tech Stack:** HTML/CSS/JS vanilla, anime.js v3.2.1 già in uso (minimappa, semaforo).

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-07-24-f1-restyle-schermate-menu-design.md`.
- Nessuna modifica alla logica di gioco (mescole, minigioco reazione pit stop, griglia, podio, penalità) — solo presentazione.
- `.tyre-card.gp-focused` passa da `box-shadow` a `outline`: verificare che non confligga più con `.tyre-card.selected` (anch'essa ora su `box-shadow`) quando entrambe le classi sono applicate insieme.
- La dissolvenza a nero (`#restart-transition`) si applica SOLO al percorso "Riprova" (modalità singola) — non toccare il flusso normale qualifica→griglia→gara.
- `.modal-content` è condivisa da `#podium-modal` E `#record-modal`: il restyle di base (pannello neumorfico) si applica automaticamente a entrambi — effetto collaterale voluto (coerenza visiva), non serve toccare il contenuto specifico di `#record-modal` oltre a questo.
- Dopo ogni modifica `.js`, `node --check`. Dopo ogni modifica HTML/CSS, verifica visiva che tag/regole siano ben chiusi.
- Niente commit automatici salvo consenso esplicito dell'utente per questa sessione (già dato per i piani precedenti in questa stessa sessione — verificare comunque prima di far committare un subagent, non dare per scontato che valga automaticamente anche per questo piano se non richiesto di nuovo).

---

### Task 1: CSS — sistema neumorfico per menu/overlay

**Files:**
- Modify: `frontend/styles/f1.css`

**Interfaces:**
- Consumes: custom properties già esistenti (`--hud-surface`, `--hud-shadow-dk`, `--hud-shadow-lt`, `--hud-text`, `--hud-text-dim`, `--hud-wear-mid`)
- Produces: classi `.menu-overlay-bg`, `.menu-panel-neu`, `.restart-transition` — consumate dal Task 2 (HTML). Restyle di `.tyre-card`/`.tyre-card.selected`/`.tyre-card.gp-focused`/`.tyre-card-dot`/`.tyre-card-label`/`.tyre-card-stats`, `.pole-text`, `.modal-content`, `.btn-green`/`.btn-red`, `#lights-board` — nessuna nuova interfaccia esplicita, ma il Task 2 rimuove gli inline-style che oggi si sovrappongono a queste regole.

- [ ] **Step 1: Classi condivise `.menu-overlay-bg`/`.menu-panel-neu`**

In `frontend/styles/f1.css`, subito prima del blocco esistente `.modal { ... }` (circa riga 425), aggiungi:

```css
/* Overlay/pannelli a schermo intero in stile neumorfico scuro — stesso
   principio dell'HUD (.hud-panel-neu): letti dalla coppia di ombre, mai da
   un bordo colorato. */
.menu-overlay-bg {
    background: rgba(6, 8, 11, 0.92);
}
.menu-panel-neu {
    background: var(--hud-surface);
    border-radius: 20px;
    box-shadow:
        8px 8px 20px var(--hud-shadow-dk),
        -6px -6px 16px var(--hud-shadow-lt);
    color: var(--hud-text);
}
```

- [ ] **Step 2: Restyle card gomme**

Sostituisci questo blocco (circa righe 218-243):

```css
.tyre-card {
    width: 130px;
    padding: 18px 12px;
    border-radius: 16px;
    border: 4px solid #566573;
    background: rgba(255,255,255,0.06);
    cursor: pointer;
    transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    pointer-events: auto;
}

.tyre-card:hover {
    transform: translateY(-4px);
    background: rgba(255,255,255,0.12);
}

.tyre-card.selected {
    border-color: #2ecc71;
    background: rgba(46,204,113,0.18);
}

/* Focus da navigazione gamepad (D-pad sx/dx + X per confermare) */
.tyre-card.gp-focused {
    box-shadow: 0 0 0 3px #f1c40f;
    transform: translateY(-4px);
}
```

con:

```css
.tyre-card {
    width: 130px;
    padding: 18px 12px;
    border-radius: 16px;
    background: var(--hud-surface);
    box-shadow:
        4px 4px 10px var(--hud-shadow-dk),
        -4px -4px 9px var(--hud-shadow-lt);
    cursor: pointer;
    transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
    pointer-events: auto;
}

.tyre-card:hover {
    transform: translateY(-4px);
    background: #232a35;
}

/* Bagliore verde sommato all'ombra neumorfica di base (mai un bordo pieno,
   coerente col resto del sistema neumorfico). */
.tyre-card.selected {
    box-shadow:
        4px 4px 10px var(--hud-shadow-dk),
        -4px -4px 9px var(--hud-shadow-lt),
        0 0 0 2px rgba(46,204,113,0.55);
}

/* Focus da navigazione gamepad (D-pad sx/dx + X per confermare): outline,
   non box-shadow — altrimenti confliggerebbe con .selected (le box-shadow
   di classi diverse si sovrascrivono, non si sommano; gli outline invece
   restano sempre visibili insieme a qualunque box-shadow). */
.tyre-card.gp-focused {
    outline: 3px solid var(--hud-wear-mid);
    outline-offset: 2px;
    transform: translateY(-4px);
}
```

- [ ] **Step 3: Colori testo/dettagli card gomme**

Sostituisci questo blocco (circa righe 245-264):

```css
.tyre-card-dot {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    margin: 0 auto 10px;
    border: 3px solid #2C3E50;
}

.tyre-card-label {
    font-size: 18px;
    font-weight: 900;
    letter-spacing: 1px;
}

.tyre-card-stats {
    font-size: 12px;
    color: #bdc3c7;
    margin-top: 6px;
    line-height: 1.6;
}
```

con:

```css
.tyre-card-dot {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    margin: 0 auto 10px;
    border: 3px solid var(--hud-surface);
}

.tyre-card-label {
    font-size: 18px;
    font-weight: 900;
    letter-spacing: 1px;
    color: var(--hud-text);
}

.tyre-card-stats {
    font-size: 12px;
    color: var(--hud-text-dim);
    margin-top: 6px;
    line-height: 1.6;
}
```

- [ ] **Step 4: Restyle `.pole-text`**

Sostituisci questo blocco (circa righe 404-420):

```css
/* Animazione POLE: rivelata lettera per lettera, scorre da destra verso il
   centro (transform aggiornato via JS ad ogni lettera, la transition rende
   fluido lo scorrimento invece di un salto secco). */
.pole-text {
    font-family: 'Fredoka', sans-serif;
    font-weight: 900;
    font-size: 100px;
    color: #f1c40f;
    letter-spacing: 6px;
    white-space: nowrap;
    text-transform: uppercase;
    text-shadow:
        -3px -3px 0 #2C3E50,  3px -3px 0 #2C3E50,
        -3px  3px 0 #2C3E50,  3px  3px 0 #2C3E50,
         6px  6px 0 rgba(0,0,0,0.35);
    transition: transform 0.08s linear;
}
```

con:

```css
/* Animazione POLE: rivelata lettera per lettera via anime.stagger (vedi
   playRevealAnimation in f1.js) — il colore (oro per la pole, chiaro per
   gli altri) è impostato via JS su textEl.style.color, non qui. */
.pole-text {
    font-family: 'Fredoka', sans-serif;
    font-weight: 900;
    font-size: 100px;
    letter-spacing: 6px;
    white-space: nowrap;
    text-transform: uppercase;
    text-shadow: 4px 4px 10px rgba(0,0,0,0.5);
}
```

- [ ] **Step 5: Restyle `.modal-content` (condivisa podio + record)**

Sostituisci questo blocco (circa righe 436-447):

```css
.modal-content {
    background: #fff;
    border: 4px solid var(--border-color);
    border-radius: 20px;
    padding: 30px 40px;
    max-width: 550px;
    width: 90%;
    box-shadow: 6px 6px 0 var(--border-color);
    text-align: center;
    max-height: 85vh;
    overflow-y: auto;
}
```

con (il colore/sfondo/ombra arrivano ora da `.menu-panel-neu`, aggiunta come
seconda classe nel Task 2 — qui restano solo le proprietà di layout):

```css
.modal-content {
    padding: 30px 40px;
    max-width: 550px;
    width: 90%;
    text-align: center;
    max-height: 85vh;
    overflow-y: auto;
}
```

- [ ] **Step 6: Restyle pulsanti `.btn-green`/`.btn-red`**

Sostituisci questo blocco (circa righe 449-464):

```css
.btn-green, .btn-red {
    font-family: 'Fredoka', sans-serif;
    font-size: 18px;
    font-weight: 700;
    border: 3px solid var(--border-color);
    border-radius: 12px;
    padding: 10px 24px;
    cursor: pointer;
    box-shadow: 3px 3px 0 var(--border-color);
    transition: transform 0.1s;
}

.btn-green { background: var(--green); color: #fff; }
.btn-red   { background: var(--red);   color: #fff; }
.btn-green:hover, .btn-red:hover { transform: translate(-2px, -2px); }
.btn-green:active, .btn-red:active { transform: translate(1px, 1px); box-shadow: 1px 1px 0 var(--border-color); }
```

con:

```css
.btn-green, .btn-red {
    font-family: 'Fredoka', sans-serif;
    font-size: 18px;
    font-weight: 700;
    border: none;
    border-radius: 12px;
    padding: 10px 24px;
    cursor: pointer;
    box-shadow: 4px 4px 10px var(--hud-shadow-dk), -3px -3px 8px var(--hud-shadow-lt);
    transition: transform 0.1s, box-shadow 0.1s;
}

.btn-green { background: var(--green); color: #fff; }
.btn-red   { background: var(--red);   color: #fff; }
.btn-green:hover, .btn-red:hover { transform: translate(-2px, -2px); }
.btn-green:active, .btn-red:active { transform: translate(1px, 1px); box-shadow: 2px 2px 6px var(--hud-shadow-dk); }
```

- [ ] **Step 7: Riposiziona il semaforo in alto al centro**

Sostituisci questo blocco (circa righe 381-388):

```css
#lights-board {
    display: flex;
    gap: 14px;
    padding: 18px 26px;
    background: #0c0e12;
    border-radius: 16px;
    box-shadow: 0 8px 20px rgba(0,0,0,0.5), inset 0 0 0 2px #2a2f38;
}
```

con:

```css
#lights-board {
    position: fixed;
    top: 60px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 14px;
    padding: 18px 26px;
    background: #0c0e12;
    border-radius: 16px;
    box-shadow: 0 8px 20px rgba(0,0,0,0.5), inset 0 0 0 2px #2a2f38;
}
```

(Il countdown testuale `#countdown-number` della qualifica resta centrato
dal `.overlay` che lo contiene, invariato — questa modifica riguarda SOLO
`#lights-board`, che ora esce dal flusso centrato del genitore.)

- [ ] **Step 8: Nuova classe per la transizione di restart**

In `frontend/styles/f1.css`, alla fine del file, aggiungi:

```css
/* Dissolvenza a nero durante la pausa di "Riprova" (RESTART_GRACE_MS lato
   server): copre il riposizionamento dell'auto alla griglia, mai visibile
   a metà transizione — vedi handler f1RestartTransition in f1.js. */
.restart-transition {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--hud-text);
    font-family: 'Fredoka', sans-serif;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 2px;
    opacity: 0;
}
```

- [ ] **Step 9: Verifica**

Apri il file e controlla che ogni `{` abbia la sua `}`. Il rendering vero si
verifica nel Task 2 (le regole `.tyre-card`/`.modal-content`/ecc. sono già
scritte per la nuova estetica, ma finché il Task 2 non rimuove gli
inline-style che oggi le sovrascrivono su `#tyre-select-overlay`/
`#pitstop-panel`/`#pole-overlay`, quegli elementi specifici restano visivamente
invariati — non è un errore, è atteso a questo punto del piano).

---

### Task 2: HTML — rimuovi inline-style, applica le nuove classi, nuovo elemento transizione

**Files:**
- Modify: `frontend/f1.html`

**Interfaces:**
- Consumes: classi `.menu-overlay-bg`, `.menu-panel-neu`, `.restart-transition` dal Task 1
- Produces: elemento `#restart-transition` — consumato dal Task 3 (JS)

- [ ] **Step 1: `#tyre-select-overlay` — rimuovi lo sfondo inline, aggiungi la classe**

Sostituisci:

```html
    <div id="tyre-select-overlay" style="display:none; position:fixed; inset:0; z-index:40;
         flex-direction:column; align-items:center; justify-content:center; gap:20px;
         background:#12121a; color:#ecf0f1; text-align:center;">
```

con:

```html
    <div id="tyre-select-overlay" class="menu-overlay-bg" style="display:none; position:fixed; inset:0; z-index:40;
         flex-direction:column; align-items:center; justify-content:center; gap:20px;
         color:var(--hud-text); text-align:center;">
```

(Il resto del blocco — `tyre-preview-frame`, `tyre-strategy-hint`,
`tyre-cards`, `tyre-confirm-status` — resta invariato: quegli elementi non
sono nella spec di questo piano.)

- [ ] **Step 2: `#pitstop-panel` — rimuovi sfondo/bordo/ombra inline, aggiungi la classe**

Sostituisci:

```html
    <div id="pitstop-panel" style="display:none; position:fixed; top:50%; right:20px; transform:translateY(-50%);
         z-index:45; width:460px; max-width:90vw; background:rgba(8,8,12,0.92); color:#ecf0f1; text-align:center;
         border:4px solid #2C3E50; border-radius:16px; padding:18px 16px;
         box-shadow:4px 4px 0 rgba(0,0,0,0.35); flex-direction:column; gap:12px;">
```

con:

```html
    <div id="pitstop-panel" class="menu-panel-neu" style="display:none; position:fixed; top:50%; right:20px; transform:translateY(-50%);
         z-index:45; width:460px; max-width:90vw; text-align:center;
         padding:18px 16px; flex-direction:column; gap:12px;">
```

(`.menu-panel-neu` fornisce già `background`/`border-radius`/`box-shadow`/`color` —
non serve più dichiararli inline. Il resto del pannello — `pitstop-status`,
`pitstop-instructions`, `pitstop-react-prompt`, `pitstop-result`,
`pitstop-cards` — resta invariato.)

- [ ] **Step 3: `#pole-overlay` — sfondo scurente coerente**

Sostituisci:

```html
    <div id="pole-overlay" style="display:none; position:fixed; inset:0; z-index:60;
         align-items:center; justify-content:center; overflow:hidden;
         background:rgba(0,0,0,0.55); pointer-events:none;">
```

con:

```html
    <div id="pole-overlay" class="menu-overlay-bg" style="display:none; position:fixed; inset:0; z-index:60;
         align-items:center; justify-content:center; overflow:hidden;
         pointer-events:none;">
```

- [ ] **Step 4: `#podium-modal`/`#record-modal` — aggiungi `.menu-panel-neu` a `.modal-content`**

Sostituisci (ci sono DUE occorrenze identiche, una per `#podium-modal` e
una per `#record-modal` — sostituiscile entrambe):

```html
        <div class="modal-content">
```

con:

```html
        <div class="modal-content menu-panel-neu">
```

- [ ] **Step 5: Nuovo elemento `#restart-transition`**

Subito dopo il blocco `<!-- Modale record mondiale -->` (dopo la sua
chiusura `</div>`, prima dei tag `<script>` finali), aggiungi:

```html
    <!-- Dissolvenza a nero durante la pausa "Riprova" (solo modalità
         singola) — copre il riposizionamento alla griglia, vedi
         f1RestartTransition in f1.js -->
    <div id="restart-transition" class="restart-transition" style="display:none;">PROSSIMA GARA…</div>
```

- [ ] **Step 6: Verifica**

Apri il file e controlla che ogni tag sia chiuso correttamente. Il
rendering completo (colori, animazioni) si verifica nel Task 3 per le parti
JS-dipendenti; le parti puramente CSS (sfondo scuro delle card/pannelli)
sono già verificabili aprendo il gioco in localhost dopo questo task.

---

### Task 3: JS — animazioni anime.js (card, reveal, prompt reazione, transizione restart)

**Files:**
- Modify: `frontend/f1.js`

**Interfaces:**
- Consumes: `anime` (globale già caricato via CDN, usato altrove nel file per la minimappa/il semaforo); elemento `#restart-transition` dal Task 2; evento socket `f1RestartTransition` (Task 4, non ancora implementato quando questo task parte — vedi nota sotto)
- Produces: nessuna interfaccia per task successivi (il Task 4, backend, è indipendente e può essere fatto prima o dopo questo)

**Nota sull'ordine**: questo task registra un handler per l'evento
`f1RestartTransition` che il Task 4 (backend) non ha ancora aggiunto. Non è
un problema: registrare un handler per un evento che il server non emette
ancora è innocuo (il codice resta lì, inerte, finché il Task 4 non lo rende
effettivo) — i due task sono comunque indipendenti e in quest'ordine va
bene.

- [ ] **Step 1: Ingresso a cascata + pop selezione nelle card gomme**

In `frontend/f1.js`, dentro `renderTyreCards(compounds, myCompound, containerId, eventName)`
(circa righe 555-588), sostituisci:

```js
    function renderTyreCards(compounds, myCompound, containerId, eventName) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        let myIndex = 0, i = 0;
        for (const key of ['hard', 'medium', 'soft']) {
            const c = compounds[key];
            if (!c) continue;
            const card = document.createElement('div');
            card.className = 'tyre-card' + (myCompound === key ? ' selected' : '');
            card.innerHTML = `
                <div class="tyre-card-dot" style="background:${c.color};"></div>
                <div class="tyre-card-label">${c.label.toUpperCase()}</div>
                <div class="tyre-card-stats">
                    Velocità ${c.speedMult >= 1 ? '+' : ''}${Math.round((c.speedMult - 1) * 100)}%<br>
                    Aderenza ${c.gripMult >= 1 ? '+' : ''}${Math.round((c.gripMult - 1) * 100)}%<br>
                    Usura ${c.wearRate}×
                </div>`;
            card.onclick = () => {
                if (eventName === 'f1TyreChoice') myCompoundChoice = key;
                socket.emit(eventName, { lobbyId, playerColor: myColor, compound: key });
                container.querySelectorAll('.tyre-card').forEach(el => el.classList.remove('selected'));
                card.classList.add('selected');
            };
            container.appendChild(card);
            if (myCompound === key) myIndex = i;
            i++;
        }
        // Abilita la navigazione da gamepad (D-pad sx/dx + X) su questo
        // container: diventa quello "attivo" finché non se ne apre un altro
        // o viene esplicitamente disattivato (vedi clearTyreNav()).
        activeTyreContainerId = containerId;
        tyreFocusIndex = myIndex;
        _applyTyreFocus();
    }
```

con:

```js
    function renderTyreCards(compounds, myCompound, containerId, eventName) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        let myIndex = 0, i = 0;
        for (const key of ['hard', 'medium', 'soft']) {
            const c = compounds[key];
            if (!c) continue;
            const card = document.createElement('div');
            card.className = 'tyre-card' + (myCompound === key ? ' selected' : '');
            card.innerHTML = `
                <div class="tyre-card-dot" style="background:${c.color};"></div>
                <div class="tyre-card-label">${c.label.toUpperCase()}</div>
                <div class="tyre-card-stats">
                    Velocità ${c.speedMult >= 1 ? '+' : ''}${Math.round((c.speedMult - 1) * 100)}%<br>
                    Aderenza ${c.gripMult >= 1 ? '+' : ''}${Math.round((c.gripMult - 1) * 100)}%<br>
                    Usura ${c.wearRate}×
                </div>`;
            card.onclick = () => {
                if (eventName === 'f1TyreChoice') myCompoundChoice = key;
                socket.emit(eventName, { lobbyId, playerColor: myColor, compound: key });
                container.querySelectorAll('.tyre-card').forEach(el => el.classList.remove('selected'));
                card.classList.add('selected');
                anime({
                    targets: card,
                    scale: [1, 1.12, 1],
                    duration: 320,
                    easing: 'easeOutElastic(1, 0.6)',
                });
            };
            container.appendChild(card);
            if (myCompound === key) myIndex = i;
            i++;
        }
        // Abilita la navigazione da gamepad (D-pad sx/dx + X) su questo
        // container: diventa quello "attivo" finché non se ne apre un altro
        // o viene esplicitamente disattivato (vedi clearTyreNav()).
        activeTyreContainerId = containerId;
        tyreFocusIndex = myIndex;
        _applyTyreFocus();

        // Ingresso a cascata: le card compaiono una dopo l'altra invece di
        // tutte insieme, ogni volta che questa funzione viene chiamata
        // (apertura schermo scelta iniziale o pannello ai box).
        anime({
            targets: container.querySelectorAll('.tyre-card'),
            translateY: [16, 0],
            opacity: [0, 1],
            delay: anime.stagger(90),
            duration: 320,
            easing: 'easeOutQuad',
        });
    }
```

- [ ] **Step 2: Riscrivi `playRevealAnimation` con `anime.stagger`**

Sostituisci per intero (circa righe 909-935):

```js
    // Animazione di rivelazione: rivela il TESTO passato lettera per lettera,
    // con un leggero scorrimento verso il centro ad ogni carattere aggiunto.
    // Personale: chi fa pole vede "POOOOOOOOOOLE" (tutto MAIUSCOLO), tutti gli
    // altri vedono solo la PROPRIA posizione (es. "P4") — vedi f1QualiEnded.
    function playRevealAnimation(fullText) {
        const CHAR_DELAY = 85;
        const overlay = document.getElementById('pole-overlay');
        const textEl  = document.getElementById('pole-text');
        overlay.style.display = 'flex';
        textEl.textContent = '';
        textEl.style.transition = 'none';
        textEl.style.transform  = 'translateX(55vw)';
        // forza il reflow prima di riattivare la transition, altrimenti il primo step non scorre
        void textEl.offsetWidth;
        textEl.style.transition = 'transform 0.08s linear';

        let i = 0;
        const timer = setInterval(() => {
            i++;
            textEl.textContent = fullText.slice(0, i);
            textEl.style.transform = `translateX(${(fullText.length - i) * 42}px)`;
            if (i >= fullText.length) {
                clearInterval(timer);
                setTimeout(() => { overlay.style.display = 'none'; }, 1800);
            }
        }, CHAR_DELAY);
    }
```

con:

```js
    // Animazione di rivelazione: rivela il TESTO lettera per lettera via
    // anime.stagger (ogni lettera è un <span> che entra con dissolvenza +
    // scorrimento, in sequenza). Personale: chi fa pole vede
    // "POOOOOOOOOOLE" in oro, tutti gli altri vedono solo la PROPRIA
    // posizione (es. "P4") in un colore neutro — vedi f1QualiEnded.
    function playRevealAnimation(fullText, isPole) {
        const overlay = document.getElementById('pole-overlay');
        const textEl  = document.getElementById('pole-text');
        overlay.style.display = 'flex';
        textEl.style.color = isPole ? '#f1c40f' : 'var(--hud-text)';
        textEl.innerHTML = fullText.split('').map(ch =>
            `<span style="display:inline-block; opacity:0;">${ch}</span>`
        ).join('');
        anime({
            targets: textEl.querySelectorAll('span'),
            opacity: [0, 1],
            translateX: [42, 0],
            delay: anime.stagger(85),
            duration: 220,
            easing: 'easeOutQuad',
            complete: () => setTimeout(() => { overlay.style.display = 'none'; }, 1800),
        });
    }
```

- [ ] **Step 3: Aggiorna la chiamata in `f1QualiEnded`**

In `frontend/f1.js`, dentro `socket.on('f1QualiEnded', ({ grid }) => { ... })`
(circa righe 943-946), sostituisci:

```js
        const myPos = (grid || []).findIndex(e => e.color === myColor) + 1;
        if (myPos === 1)      playRevealAnimation('POOOOOOOOOOLE');
        else if (myPos > 1)   playRevealAnimation(`P${myPos}`);
```

con:

```js
        const myPos = (grid || []).findIndex(e => e.color === myColor) + 1;
        if (myPos === 1)      playRevealAnimation('POOOOOOOOOOLE', true);
        else if (myPos > 1)   playRevealAnimation(`P${myPos}`, false);
```

- [ ] **Step 4: Pop elastico sul prompt "PREMI SPAZIO!"**

In `frontend/f1.js`, dentro `socket.on('f1PitReactionGo', () => { ... })`
(circa righe 650-654), sostituisci:

```js
    socket.on('f1PitReactionGo', () => {
        document.getElementById('pitstop-status').textContent = '';
        document.getElementById('pitstop-instructions').textContent = '';
        document.getElementById('pitstop-react-prompt').style.display = 'block';
    });
```

con:

```js
    socket.on('f1PitReactionGo', () => {
        document.getElementById('pitstop-status').textContent = '';
        document.getElementById('pitstop-instructions').textContent = '';
        const promptEl = document.getElementById('pitstop-react-prompt');
        promptEl.style.display = 'block';
        anime({
            targets: promptEl,
            scale: [0, 1],
            opacity: [0, 1],
            duration: 380,
            easing: 'easeOutElastic(1, 0.5)',
        });
    });
```

- [ ] **Step 5: Nuovo handler `f1RestartTransition`**

In `frontend/f1.js`, subito dopo l'handler esistente `socket.on('f1RaceEnded', ...)`
(dopo la sua chiusura `});`), aggiungi:

```js
    // Dissolvenza a nero durante la pausa "Riprova" (RESTART_GRACE_MS lato
    // server, vedi backend): copre il riposizionamento dell'auto alla
    // griglia, che altrimenti si vedrebbe "teletrasportata" appena il
    // podio si chiude. Il fade-out finisce all'incirca quando arriva
    // f1Countdown (che nasconde comunque podium-modal per conto suo, in
    // modo idempotente — nessun conflitto se questo handler lo ha già
    // fatto sparire prima).
    socket.on('f1RestartTransition', ({ graceMs }) => {
        const el = document.getElementById('restart-transition');
        document.getElementById('podium-modal').style.display = 'none';
        el.style.display = 'flex';
        anime({ targets: el, opacity: [0, 1], duration: 250, easing: 'easeOutQuad' });
        setTimeout(() => {
            anime({
                targets: el, opacity: [1, 0], duration: 400, easing: 'easeInQuad',
                complete: () => { el.style.display = 'none'; }
            });
        }, Math.max(0, graceMs - 400));
    });
```

- [ ] **Step 6: `node --check`**

Run: `node --check "frontend/f1.js"`
Expected: nessun output

- [ ] **Step 7: Verifica statica**

Rileggi `playRevealAnimation`: conferma che il parametro `isPole` è passato
correttamente da entrambe le chiamate in `f1QualiEnded` (Step 3). Conferma
che `f1RestartTransition` referenzia esattamente gli id `restart-transition`
(Task 2) e `podium-modal` (già esistente). La verifica funzionale reale
(animazioni a schermo, dissolvenza sincronizzata) è per l'utente in
localhost, insieme al Task 4.

---

### Task 4: Backend — emit `f1RestartTransition`

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js`

**Interfaces:**
- Consumes: `RESTART_GRACE_MS` (costante già esistente, introdotta nel piano del semaforo)
- Produces: evento socket `f1RestartTransition` — consumato dal Task 3 (già implementato, in attesa di questo evento)

- [ ] **Step 1: Emetti l'evento in `f1RestartRace`**

In `backend/sockets/games/f1GameSocket.js`, dentro `socket.on('f1RestartRace', (lobbyId) => { ... })`,
sostituisci:

```js
        // Pausa di cortesia prima del semaforo (vedi RESTART_GRACE_MS): il
        // podio resta a schermo nel frattempo, nessun nuovo evento arriva
        // finché non scatta questo timeout.
        setTimeout(() => {
            const g = activeGames.get(lobbyId);
            if (!g) return;
            startRaceCountdown(io, lobbyId, g);
        }, RESTART_GRACE_MS);
```

con:

```js
        // Pausa di cortesia prima del semaforo (vedi RESTART_GRACE_MS):
        // annunciata SUBITO al client con questo evento dedicato, così può
        // coprirla con una dissolvenza a nero invece di lasciare il podio a
        // schermo fino all'ultimo istante (vedi f1RestartTransition in f1.js).
        io.to(lobbyId).emit('f1RestartTransition', { graceMs: RESTART_GRACE_MS });
        setTimeout(() => {
            const g = activeGames.get(lobbyId);
            if (!g) return;
            startRaceCountdown(io, lobbyId, g);
        }, RESTART_GRACE_MS);
```

- [ ] **Step 2: `node --check`**

Run: `node --check "backend/sockets/games/f1GameSocket.js"`
Expected: nessun output

- [ ] **Step 3: Verifica manuale (fine piano)**

Modalità singola: finisci una gara, premi "Riprova" — il podio deve sparire
subito dietro una dissolvenza a nero con "PROSSIMA GARA…", che si schiarisce
esattamente quando appaiono le 5 luci del semaforo (ora posizionate in ALTO
al centro, non più a centro schermo). Nessun'auto visibile a metà
transizione. Verifica anche, separatamente: schermo scelta gomme iniziale
(le 3 card entrano a cascata, click = pop elastico), fine qualifica (lettere
del reveal che entrano in sequenza, oro per la pole/chiaro per gli altri),
ai box (pannello scuro, "PREMI SPAZIO!" con scatto elastico al segnale),
griglia di partenza dopo la qualifica (stesso modale scuro, nessuna
dissolvenza lì — comportamento invariato).

## Verifica finale

Controlla che `.tyre-card.selected` e `.tyre-card.gp-focused` applicate
insieme (seleziona una mescola mentre la navighi da gamepad) mostrino
ENTRAMBI gli indicatori contemporaneamente (bagliore verde + anello
outline), non uno che sovrascrive l'altro.
