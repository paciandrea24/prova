# F1 — redesign HUD in-game (neumorfismo)

## Problema

L'HUD attuale (`frontend/f1.html` + `frontend/styles/f1.css`, blocchi `.hud-left`/
`.hud-right`/`.hud-bottom`) mostra nome pista (inutile), giri e gomme in alto a
sinistra, timer+boost+classifica in alto a destra, velocità in basso al centro.
Serve un redesign completo: riposizionare i contenuti utili, aggiungere un
pannello gomme con grafica dedicata e una minimappa, ed eliminare quello che
non serve (nome pista, indicatore boost — vedi sotto).

Confermato con l'utente tramite mockup interattivo (Artifact HTML, iterato tre
volte: stile broadcast → neumorfismo → dimensioni ridotte + auto SVG rifatta +
margini top/bottom uniformi).

## Scoperta in corso di brainstorming: codice morto

`multiplier-box`/`multiplier-display` in `f1.html` e il listener
`socket.on('f1BoostUpdate', ...)` in `f1.js` (~riga 835 prima del redesign)
sono **codice morto**: `backend/sockets/games/f1GameSocket.js` non emette mai
`f1BoostUpdate`. Il boost esiste solo nell'altro gioco (`frontend/racing.js`),
probabilmente copiato qui per errore in passato. Va rimosso per intero
(markup + CSS + listener), non solo riposizionato.

## Layout finale

```
TOP-LEFT              TOP-CENTER             TOP-RIGHT
┌ classifica ┐        ┌── LAP ──┐             ┌ timer ┐
│ 1° ● TU    │        │  3 / 5  │             │ QUALI │
│ 2° ●       │        └─────────┘             │0:42.31│
│ 3° ●       │                                └───────┘
└────────────┘        (solo in QUALIFICA — sparisce del tutto in gara)


BOTTOM-LEFT                BOTTOM-CENTER           BOTTOM-RIGHT
chiuso:  [■ T]              [ 231 km/h ]            ┌ minimappa ┐
aperto (toggle T/L1):                                │  ● (tu)   │
┌ MEDIUM ────T─┐                                     └───────────┘
│  auto SVG    │
│  + 4 gomme    │
│    61%        │
└───────────────┘
```

Margini identici su tutti e 4 i lati dello schermo (**14px** dal bordo,
confermato esplicitamente dall'utente: stesso spacing sopra e sotto).

## Sistema visivo: neumorfismo scuro

Decisione finale (dopo iterazione): niente pannelli "broadcast" con bordo
colorato d'accento — solo superfici neumorfiche, lette dalle ombre, mai da un
contorno colorato.

Nuovi custom properties in `f1.css` (accanto a quelli esistenti in `:root`,
che restano per gli overlay non toccati da questo redesign — countdown, pole,
podio, tyre-select, pitstop):

```css
--hud-surface:      #1c212a;   /* pannello: stessa tinta dello sfondo di gioco */
--hud-shadow-dk:     rgba(2, 3, 5, 0.65);
--hud-shadow-lt:     rgba(255, 255, 255, 0.05);
--hud-screen:        #12151b;  /* "display" incassato dentro il pannello */
--hud-screen-dk:     rgba(0, 0, 0, 0.7);
--hud-screen-lt:     rgba(255, 255, 255, 0.025);
--hud-text:          #eef2f6;
--hud-text-dim:      #838d9c;
--hud-wear-fresh:    #4fbf82;
--hud-wear-mid:      #d9b23c;
--hud-wear-worn:     #c65b52;
```

Due classi riusabili, applicate a TUTTI i box HUD (sostituiscono `.hud-box`
per gli elementi in scope di questo redesign):

- `.hud-panel-neu` — bordo esterno morbido: `background: var(--hud-surface);
  border: none; border-radius: 11px; box-shadow: 4px 4px 10px
  var(--hud-shadow-dk), -4px -4px 9px var(--hud-shadow-lt);`
- `.hud-screen` — "display" incassato dentro un pannello:
  `background: var(--hud-screen); border-radius: 7px; box-shadow: inset 2px
  2px 5px var(--hud-screen-dk), inset -1px -1px 3px var(--hud-screen-lt);`

Il colore resta SOLO dove porta un'informazione reale (mai come decorazione
di un pannello):
- colore auto del giocatore (`p.color`, già esistente) → pallino classifica,
  pallino minimappa
- colore usura gomme (verde→giallo→rosso, interpolato) → icona chiusa + le 4
  gomme nella sagoma auto
- colore mescola (`tyreCompoundsInfo[compound].color`, già esistente) →
  pallino accanto all'etichetta SOFT/MEDIUM/HARD nel pannello gomme aperto

Tipografia: numeri/dati in monospace (`ui-monospace, "SF Mono", "Cascadia
Code", Consolas, monospace`, `font-variant-numeric: tabular-nums`); etichette
(LAP, QUALIFICA, USURA...) in maiuscolo condensato con letter-spacing, stesso
font-family di base del gioco (Fredoka) a peso alto — niente nuovo import
Google Font: il mockup usava fallback di sistema solo per il vincolo CSP
degli Artifact, qui non serve.

Dimensioni compatte (l'utente ha chiesto esplicitamente di non occupare
spazio inutilmente): padding interni ridotti, font-size contenuti (es. box
giri ~20px per il valore, non 30+), niente margini/gap superflui tra gli
elementi interni di un pannello.

## Componenti

### 1. Classifica — top-left
Contenuto invariato (già oggi `standings-box`, aggiornato da
`updateStandings()` su `f1StateUpdate`): riga per pilota con posizione,
pallino colore, evidenziazione riga propria. Solo restyle neumorfico +
riposizionamento (oggi è top-right).

### 2. Contatore giri — top-center
Sostituisce l'attuale `lap-box` (oggi top-left). Stessa logica dati già
sistemata in una sessione precedente (`setLapDisplay()` in `f1.js`, chiamata
da `f1Setup`/`f1RaceStarted`/`f1LapUpdate`): mostra il giro CORRENTE
(completati+1, capped al totale), non i giri completati — es. "3/5" per
tutto il giro finale di una gara a 5 giri. Solo restyle + riposizionamento,
nessuna modifica alla logica esistente.

### 3. Timer — top-right, SOLO qualifica
Oggi (`timer-box`) è sempre visibile (gara compresa). Cambia:
- Visibile SOLO quando `currentPhase === 'qualifying'` (e overlay/countdown
  correlati, invariati)
- In gara il box sparisce del tutto (non solo si svuota — `display:none`),
  lasciando il top-right vuoto
- Stessa logica di calcolo (`isRacing`, `localStart`, `myFinalTime`) — cambia
  solo la condizione di visibilità in `f1.js` e lo stile del box

### 4. Velocità — bottom-center
Invariata nella logica, solo restyle neumorfico (pannello + "schermo"
incassato per il numero).

### 5. Pannello gomme — bottom-left, apribile/chiudibile
Sostituisce `tyre-box`. Due stati:

**Chiuso (default all'avvio di ogni sessione)**: solo un'icona quadrata
colorata secondo l'usura (nessun testo/percentuale — scelta esplicita
dell'utente) + hint tastiera "T".

**Aperto** (toggle): pannello con
- etichetta mescola (SOFT/MEDIUM/HARD) + pallino colore mescola
- sagoma auto vista dall'alto in SVG (poligono chassis + ali anteriore/
  posteriore + halo + 4 rettangoli ruota), come validata nel mockup —
  NON i div placeholder del primo tentativo
- le 4 gomme condividono SEMPRE lo stesso colore (un solo valore di usura,
  non per ruota — dato reale non disponibile diviso per angolo)
- UNA sola percentuale mostrata una volta (non ripetuta 4 volte), in uno
  `.hud-screen` sotto la sagoma

**Toggle**: tasto **T** (keydown, nuovo listener in `f1.js`, analogo a quello
già esistente per Spazio/pit) + **L1** su gamepad (nuovo bottone in
`f1Gamepad.js`: `BTN_TYRE_TOGGLE = 4`, stesso pattern rising-edge di
`BTN_CONFIRM`/`BTN_CAMERA`, nuovo callback `onTyreToggle` registrato in
`f1.js` insieme agli altri in `F1GamepadInput.setCallbacks(...)`). Stato
locale (`tyrePanelOpen`, booleano client-side, non sincronizzato col
server): resettato a chiuso a ogni countdown/inizio sessione (`f1Countdown`).

Colore usura: stessa scala verde→giallo→rosso già usata nel mockup,
interpolata su `data.tyreWear` (0-100, già presente in `f1StateUpdate`).

### 6. Minimappa — bottom-right
Nuovo componente. Solo la propria auto per ora (l'utente ha detto
esplicitamente "per adesso solo la mia auto, poi vediamo se estenderlo" —
estendere alle altre auto è fuori scope, non implementarlo).

Dati già disponibili client-side, nessuna modifica al backend:
- `trackPts` (array di `{x,z,...}`, 1000 campioni) — già caricato in `f1.js`
  per costruire la pista 3D (`TrackGeometry.sampleLoop(trackData.controlPoints,
  N_SAMPLES)`), riusato tale e quale per disegnare il contorno
- `trackIndex` del proprio giocatore — già inviato in ogni `f1StateUpdate`

Implementazione:
1. Al caricamento pista, generare UNA VOLTA un path SVG `<path>` dal
   proiettare `trackPts` (x,z) sul piano, normalizzato/scalato per riempire
   il riquadro minimappa (~118×82px nello `.hud-screen` interno)
2. Aggiungere **anime.js** via CDN (`<script src="https://cdn.jsdelivr.net/
   npm/animejs@3/lib/anime.min.js">` in `f1.html`, dopo gli script Three.js
   esistenti) — scelta esplicita dell'utente rispetto a un'implementazione
   nativa con `getPointAtLength`
3. Creare un'animazione `anime.createMotionPath(pathEl)` a `duration` fissa
   (es. 1000), `autoplay: false`; ad ogni frame (dentro il loop `animate()`
   già esistente) calcolare `progress = myTrackIndex / N_SAMPLES` e
   posizionare il marker con `anime.set(dotEl, motionPath.translateX/Y/
   rotate)` o equivalente via `.seek(progress * duration)` — nessuna
   animazione a tempo autonoma, è sempre pilotata dallo stato server
   (`trackIndex`), non da un timer locale
4. Marker: pallino nel colore auto del giocatore (`myColor`), stesso
   pattern halo/core visto nel mockup

### 7. Rimozioni
- `track-name-display` e relativo box (`.track-name`): rimosso da
  `f1.html`, e la riga `document.getElementById('track-name-display')...`
  in `f1.js` (handler `f1Setup`)
- `multiplier-box`/`multiplier-display`: rimosso da `f1.html`; listener
  `socket.on('f1BoostUpdate', ...)` rimosso da `f1.js`; CSS `.multiplier-
  style` rimosso da `f1.css` — è codice morto, vedi sopra

## Fuori scope (esplicitamente)

- Nessuna modifica al backend (`f1GameSocket.js`): tutti i dati necessari
  esistono già negli eventi socket attuali
- Minimappa con le altre auto: rimandato
- Font Google reale diverso da Fredoka: non richiesto, si resta con quello
  già caricato dal progetto

## File coinvolti

- `frontend/f1.html` — markup HUD, rimozione track-name/multiplier, nuovo
  script anime.js
- `frontend/styles/f1.css` — nuovi token neumorfici, nuove classi
  `.hud-panel-neu`/`.hud-screen`, stili per-componente, rimozione stili
  morti (`.track-name`, `.multiplier-style`, vecchio `.hud-box`/`.lap-style`/
  `.tyre-style`/`.timer-style` se non più referenziati)
- `frontend/f1.js` — refactor rendering HUD (classifica/giri/timer/velocità/
  gomme/minimappa), toggle gomme (tasto T + stato locale), generazione path
  minimappa, guida anime.js, rimozione listener `f1BoostUpdate`
- `frontend/f1Gamepad.js` — nuovo bottone `BTN_TYRE_TOGGLE` (L1, index 4) +
  callback `onTyreToggle`

## Verifica

Nessun cambiamento server-side da testare in isolamento (niente unit test
backend). Verifica manuale in localhost (due tab, come da convenzione del
progetto):
- qualifica: timer visibile e che corre, giri "1/1" dal via, gomme chiuse di
  default, T/L1 aprono/chiudono, minimappa segue l'auto
- gara: timer assente (anche nello sfondo — non deve più "correre invisibile"
  dietro nulla, il box proprio non esiste in DOM/è `display:none`), giri
  "N/totale" corretti, classifica aggiornata, gomme e minimappa come sopra
- nessun elemento "fantasma" del vecchio HUD (nome pista, boost) in nessuna
  fase
