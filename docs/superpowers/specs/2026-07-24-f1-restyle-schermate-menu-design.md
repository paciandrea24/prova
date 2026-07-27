# F1 — restyle schermate menu (gomme, reveal qualifica, podio) + transizione restart

## Problema

Dopo il redesign dell'HUD in-game (neumorfismo scuro) e l'aggiunta del
semaforo di partenza, restano 3 componenti dell'interfaccia ancora nel
vecchio stile chiaro/pastello, visivamente scollegati dal resto del gioco:

1. Le **card gomme** (`.tyre-card`, componente condiviso — stesso codice
   `renderTyreCards()` in `frontend/f1.js` — usato sia nello schermo di
   scelta iniziale `#tyre-select-overlay` che nel pannello ai box
   `#pitstop-panel`)
2. Il **reveal di fine qualifica** ("POOOOOOOOOOLE"/"P4", `#pole-overlay` +
   `playRevealAnimation()`)
3. Il **modale podio** (`#podium-modal`, `.modal-content` — riusato SIA per
   la griglia di partenza dopo la qualifica SIA per i risultati di fine
   gara, stessa funzione, contenuto diverso)

In più: il semaforo di partenza (già implementato, piano precedente) è oggi
centrato a schermo insieme al countdown testuale della qualifica — va
spostato in alto al centro, mentre il countdown 3-2-1 della qualifica resta
centrato com'è.

Infine: premendo "Riprova" (modalità singola) l'auto si riposiziona alla
griglia mentre il pannello podio è ancora aperto, e quando il pannello si
chiude di colpo l'auto è già lì — un salto visivo ("teletrasporto")
segnalato dall'utente. Va coperto da una transizione pulita, ma SOLO su
questo percorso (la qualifica→griglia→gara non ne ha bisogno: lì la griglia
mostrata per `GRID_DISPLAY_MS` è già la schermata "sei arrivato", non un
salto inspiegato).

## 1. Sistema visivo condiviso

Riuso diretto dei custom properties già definiti in `:root` di
`frontend/styles/f1.css` (introdotti per l'HUD, non toccarli): `--hud-surface`,
`--hud-shadow-dk`/`--hud-shadow-lt`, `--hud-screen-bg`, `--hud-screen-dk`/
`--hud-screen-lt`, `--hud-text`, `--hud-text-dim`. Stesso principio del
redesign HUD: pannelli letti dalla coppia di ombre, MAI da un bordo colorato
— il colore resta riservato ai contenuti (colore mescola, colore pilota,
oro per la pole).

Nuove classi condivise (in aggiunta a `.hud-panel-neu`/`.hud-screen` già
esistenti, riusabili anche qui per pezzi piccoli):

```css
/* Overlay a schermo intero in stile neumorfico scuro — sostituisce lo
   sfondo chiaro attuale di #tyre-select-overlay/.modal, stessa struttura
   (sfondo scurente + pannello centrale), diverso solo nel colore. */
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

## 2. Card gomme (componente condiviso)

Nessuna modifica al markup di `renderTyreCards()` (stessa struttura
`.tyre-card-dot`/`.tyre-card-label`/`.tyre-card-stats`), solo:

**CSS** — `.tyre-card` passa da sfondo chiaro/bordo grigio a superficie
neumorfica scura (`background: var(--hud-surface)`, ombre invece di
`border: 4px solid #566573`), testo in `var(--hud-text)`/`var(--hud-text-dim)`.
`.tyre-card.selected` mantiene un'indicazione di stato ma non più un bordo
colorato pieno — usa invece un `box-shadow` verde soffuso aggiuntivo
(`0 0 0 2px rgba(46,204,113,0.5)` circa, da tarare a vista) sommato
all'ombra neumorfica di base, così il "selezionato" si legge come un
leggero bagliore, non un contorno netto.

**Attenzione (trovato in autoreview)**: `.tyre-card.gp-focused` (focus da
navigazione gamepad, già esistente) usa anch'esso `box-shadow` per il suo
anello giallo. Se una card è selezionata E focalizzata da gamepad insieme,
le due `box-shadow` di classi diverse si sovrascrivono a vicenda (vince
solo l'ultima in cascata), non si sommano. Per evitare il conflitto,
`.gp-focused` va convertito da `box-shadow` a `outline` (`outline: 3px
solid var(--hud-wear-mid); outline-offset: 2px;` circa) — gli outline sono
indipendenti dai box-shadow e si vedono sempre insieme, indipendentemente
da quale altra classe è applicata alla stessa card.

**Animazione ingresso**: quando `renderTyreCards()` viene chiamata (schermo
aperto/riaperto), le card entrano con `anime.stagger` — scorrimento
verticale + dissolvenza, una dopo l'altra:

```js
anime({
    targets: container.querySelectorAll('.tyre-card'),
    translateY: [16, 0],
    opacity: [0, 1],
    delay: anime.stagger(90),
    duration: 320,
    easing: 'easeOutQuad',
});
```

**Animazione selezione**: nel gestore `card.onclick` esistente, dopo aver
aggiornato le classi `selected`, un pop elastico sulla card appena scelta:

```js
anime({
    targets: card,
    scale: [1, 1.12, 1],
    duration: 320,
    easing: 'easeOutElastic(1, 0.6)',
});
```

## 3. Reveal fine qualifica (`playRevealAnimation`)

Stesso CONCETTO (rivelazione lettera per lettera, `POOOOOOOOOOLE` per chi
fa pole, `P<n>` per tutti gli altri — vedi `f1QualiEnded`), riscritto con
`anime.stagger` invece del `setInterval` a mano:

```js
function playRevealAnimation(fullText, isPole) {
    const overlay = document.getElementById('pole-overlay');
    const textEl  = document.getElementById('pole-text');
    overlay.style.display = 'flex';
    textEl.style.color = isPole ? '#f1c40f' : 'var(--hud-text)';   // oro per la pole, neutro per gli altri
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

Chiamata da `f1QualiEnded` con il nuovo secondo argomento:
`playRevealAnimation('POOOOOOOOOOLE', true)` per la pole,
`playRevealAnimation('P'+myPos, false)` per gli altri.

`#pole-overlay`/`.pole-text` in CSS: sfondo scurente coerente con
`.menu-overlay-bg`, font mantenuto (Fredoka, già coerente col resto del
gioco), rimosso il contorno multiplo `text-shadow` a 4 direzioni (era lo
stile "fumetto" pastello) a favore di un singolo `text-shadow` morbido di
profondità.

## 4. Pannello ai box (`#pitstop-panel`)

Stesso `.menu-panel-neu` (non più `background: rgba(8,8,12,0.92); border:
4px solid #2C3E50`). Le card gomme (`#pitstop-cards`) ereditano
automaticamente il restyle del punto 2, nessuna modifica aggiuntiva
necessaria lì.

Il prompt `#pitstop-react-prompt` ("PREMI SPAZIO!"): quando passa da
`display:none` a visibile (nel punto del codice dove oggi si limita a
`style.display='flex'` alla ricezione del segnale "vai"), aggiungere un pop
elastico invece del solo show:

```js
promptEl.style.display = 'block';
anime({
    targets: promptEl,
    scale: [0, 1],
    opacity: [0, 1],
    duration: 380,
    easing: 'easeOutElastic(1, 0.5)',
});
```

## 5. Modale podio/griglia di partenza (`#podium-modal`)

`.modal-content` passa da `background:#fff; border:4px solid var(--border-color)`
a `.menu-panel-neu`. Le righe lista (sia `f1QualiEnded` che `f1RaceEnded`,
oggi con inline-style `color:#2C3E50`/`border-bottom:1px solid #bdc3c7`)
passano a `var(--hud-text)`/`border-bottom-color` scuro coerente
(`rgba(255,255,255,0.08)` circa). I pallini colore pilota, l'oro/argento/
bronzo delle posizioni sul podio e i badge esistenti (`+30s NO PIT`,
`+5s FALSE START`, già scuri/rossi) restano invariati — sono già
leggibili sul nuovo sfondo scuro.

`.btn-green`/`.btn-red` (Restart/Torna alla lobby): restano gli stessi
colori funzionali (verde/rosso), solo bordo/ombra aggiornati a coerenza col
resto (niente più `border: 3px solid var(--border-color)` in stile
"boxy chiaro" — ombra neumorfica anche qui, colore di sfondo pieno
verde/rosso mantenuto perché sono azioni, non superfici informative).

## 6. Semaforo: riposizionato in alto al centro

`#lights-board` (già implementato) esce dal flusso centrato condiviso con
`#countdown-number` (che resta centrato per la qualifica, invariato):

```css
#lights-board {
    position: fixed;
    top: 60px;
    left: 50%;
    transform: translateX(-50%);
    /* display:flex (già presente) e le altre proprietà esistenti invariate */
}
```

Nessuna modifica JS necessaria: l'elemento è già mostrato/nascosto da
`f1Countdown`/`f1RaceStarted`, cambia solo dove appare sullo schermo.

## 7. Transizione "Riprova": dissolvenza a nero + testo

Nuovo overlay dedicato (semplice, non riusa `#countdown-overlay` per non
complicare la logica esistente di quell'elemento condiviso):

```html
<div id="restart-transition" style="display:none; position:fixed; inset:0; z-index:70;
     background:#000; align-items:center; justify-content:center;
     color:var(--hud-text); font-family:'Fredoka', sans-serif;
     font-size:22px; font-weight:700; letter-spacing:2px; opacity:0;">
    PROSSIMA GARA…
</div>
```

Lato server (`backend/sockets/games/f1GameSocket.js`, handler
`f1RestartRace`): nessuna modifica al timing già esistente
(`RESTART_GRACE_MS`), ma emettere un evento dedicato subito dopo aver
avviato quel `setTimeout`, così il client sa di dover mostrare la
transizione per l'intera durata della pausa:

```js
io.to(lobbyId).emit('f1RestartTransition', { graceMs: RESTART_GRACE_MS });
```

Lato client (`frontend/f1.js`), nuovo handler:

```js
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
    }, Math.max(0, graceMs - 400));   // il fade-out finisce esattamente quando arriva f1Countdown
});
```

Il `podium-modal` viene nascosto SUBITO (invece che aspettare il prossimo
`f1Countdown`), coperto dal fade-to-black — l'auto si riposiziona (lato
server, invariato) mentre lo schermo è nero, mai visibile a metà transizione.

## Fuori scope

- Nessuna modifica al layout HTML esistente delle card gomme, solo CSS +
  chiamate anime.js aggiuntive nel JS già presente
- Nessuna modifica alla logica di gioco (compound, reazione pit stop, griglia,
  podio) — solo presentazione
- La transizione fade-to-black si applica SOLO al percorso "Riprova"
  (modalità singola), non al flusso normale qualifica→griglia→gara

## File coinvolti

- `frontend/styles/f1.css` — nuove classi `.menu-overlay-bg`/`.menu-panel-neu`,
  restyle `.tyre-card`/`.tyre-card.selected`/`.tyre-card.gp-focused`
  (quest'ultima da `box-shadow` a `outline`, vedi nota sopra),
  `.pole-text`/`#pole-overlay`, `.modal-content`/liste podio, `#pitstop-panel`
  (inline style da convertire o nuova classe), riposizionamento
  `#lights-board`, nuovo `#restart-transition`
- `frontend/f1.html` — nuovo elemento `#restart-transition`; eventuali inline
  style da rimuovere a favore delle nuove classi CSS su
  `#tyre-select-overlay`/`#pitstop-panel`/`.modal-content`
- `frontend/f1.js` — `renderTyreCards()` (stagger ingresso + pop selezione),
  `playRevealAnimation()` (riscritta con anime.stagger, nuovo parametro
  `isPole`), `f1QualiEnded` (chiamata aggiornata), reazione pit stop (pop
  elastico su `#pitstop-react-prompt`), nuovo handler `f1RestartTransition`
- `backend/sockets/games/f1GameSocket.js` — nuovo emit `f1RestartTransition`
  in `f1RestartRace` (nessuna modifica al timing/logica esistente)

## Verifica

Manuale in localhost: apri lo schermo scelta gomme iniziale (le 3 card
entrano a cascata), selezionane una (pop elastico); via qualifica, controlla
pole/non-pole (oro vs neutro, lettere che entrano fluide); entra ai box
(pannello scuro, prompt "PREMI SPAZIO!" con scatto elastico al segnale);
finisci una gara in modalità singola, premi Riprova — nessun salto visibile,
schermo nero con "PROSSIMA GARA…" per tutta la pausa, poi semaforo in ALTO
al centro (non più a centro schermo); verifica anche la griglia di partenza
dopo la qualifica (stesso modale scuro, nessuna dissolvenza necessaria lì).
