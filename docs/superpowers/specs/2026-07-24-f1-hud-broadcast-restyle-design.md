# F1 — HUD in-game: stile "broadcast" piatto + layout F1 vera

## Problema

L'HUD in-game attuale (redesign precedente, `--hud-*`/`.hud-panel-neu`/
`.hud-screen` in `frontend/styles/f1.css`) usa uno stile neumorfico (pannelli
"rialzati" letti da ombre morbide diffuse). L'utente lo giudica generico/
anonimo ("si vede che è fatto dall'IA"), non in sintonia col resto del
gioco. Vuole avvicinarsi allo stile vero del gioco/broadcast ufficiale F1:
pannelli piatti scuri con bordo sottile netto, classifica e giri uniti in un
solo pannello, minimappa con TUTTI i piloti (non solo il proprio), tempo
visibile anche in gara (non solo qualifica), e un nuovo campo — il distacco
dal leader — con animazione di sorpasso quando cambia l'ordine.

È un redesign completo dell'HUD in-game. Gli overlay/menu a schermo intero
(scelta gomme, podio, reveal pole — sistemati nel giro precedente con lo
stile neumorfico "menu-panel-neu") restano COME SONO per ora — incoerenti
col nuovo HUD fino a un giro dedicato successivo. I nuovi token qui sotto
usano nomi generici (prefisso `f1-`, non `hud-`) apposta per poter essere
riusati quando arriverà quel giro, senza doverli rinominare.

## 1. Sistema visivo: pannelli piatti, non più neumorfici

Nuovi custom properties in `:root` (`frontend/styles/f1.css`), AGGIUNTI
accanto a `--hud-*` esistenti (che restano, usati dai menu — non toccarli,
non rinominarli):

```css
--f1-panel:        rgba(9, 11, 14, 0.86);
--f1-panel-strong: rgba(9, 11, 14, 0.95);   /* per lo "chip" giri, vedi sotto */
--f1-panel-border: rgba(255, 255, 255, 0.14);
--f1-text:         #f2f4f6;
--f1-text-dim:     #8b96a3;
--f1-telemetry:    #39c7f2;   /* riservato ai valori "telemetria": velocità */
--f1-wear-mid:     #f1c40f;   /* SOLO fallback CSS di .wheel — wearColor() in JS calcola già rgb() letterali, non serve fresh/worn qui */
```

Nuova classe pannello (sostituisce `.hud-panel-neu`/`.hud-screen` per i soli
elementi HUD toccati da questo piano — quelle due classi restano nel file,
usate dai menu, non rimuoverle):

```css
.f1-panel {
    background: var(--f1-panel);
    border: 1px solid var(--f1-panel-border);
    border-radius: 5px;
    box-shadow: 0 6px 16px rgba(0,0,0,0.45);
}
```

Nessun bordo colorato (stesso principio di prima), ma niente più doppia
ombra morbida: un bordo sottile netto + un'unica ombra di profondità
contenuta, per leggere come grafica TV sovrapposta invece che come
pannello fisico rialzato.

## 2. Layout finale

```
TOP-LEFT (un pannello unico)         TOP-RIGHT (un pannello, 2 colonne)
┌ GIRO 7/20 ─────────┐               ┌ TEMPO ─┬─ VELOCITÀ ─┐
│ 1 ● TU              │              │0:42.318│  231 km/h  │
│ 2 ● Blu    +2.603   │              └────────┴────────────┘
│ 3 ● Verde  +5.117   │
└─────────────────────┘

BOTTOM-LEFT                          BOTTOM-RIGHT
┌T┐ gomme (apribile)                 ┌ MAPPA ──────┐
└─┘                                  │  ● ● ●  ●   │  (tutti i piloti)
                                     └─────────────┘
```

Nessun elemento resta in alto al centro (il box giri sparisce da lì,
confluisce nel pannello classifica). La velocità si sposta da bottom-center
a top-right, accanto al tempo (bottom-center resta libero — nessun nuovo
elemento richiesto lì per ora).

## 3. Pannello classifica + giri (top-left)

Nuovo markup unico in `frontend/f1.html` al posto degli attuali
`#standings-box` e `#lap-box` separati: un pannello `.f1-panel` con id
`standings-panel` (sostituisce `#standings-box` come elemento che si
mostra/nasconde in base a `currentPhase !== 'race'`), due sezioni interne:

- **Chip giri** in alto (id `lap-chip`): sfondo `var(--f1-panel-strong)`
  (leggermente più opaco del pannello, per staccarsi visivamente come
  "etichetta"), etichetta `GIRO` + valore in uno `<span id="lap-chip-value">`
  (sostituisce l'attuale `#lap-display` come target di `setLapDisplay` —
  stessa identica logica di quella funzione, cambia solo l'id del target:
  mostra "GIRO SECCO" in qualifica, altrimenti giro corrente/totale)
- **Righe classifica** sotto, in un contenitore `<div id="standings-rows">`
  (sostituisce l'attuale target `innerHTML` di `#standings-box` in
  `updateStandings()`): posizione, pallino colore pilota, "TU" per la
  propria riga, distacco dal leader in monospace a destra (nuovo — vedi
  §5). Riga del leader stesso: nessun distacco (mostra un trattino `–` o
  resta vuoto, mai "+0.000").

La classifica resta visibile SOLO in gara (stessa logica già esistente:
`currentPhase !== 'race'` nasconde tutto il pannello — invariata). Il chip
giri invece era finora un pannello a parte sempre mostrato quando attivo
(anche in qualifica, con testo "GIRO SECCO") — ora che è DENTRO il pannello
classifica, che si nasconde fuori gara, in qualifica il chip giri sparisce
insieme al resto. Questo è un cambiamento di comportamento rispetto ad
oggi (dove "GIRO SECCO" resta visibile durante la qualifica): **il chip
giri in qualifica non ha più un posto dedicato in questo layout** — non è
stato chiesto esplicitamente di riportarlo, ma è una conseguenza diretta di
"unire classifica e giri nello stesso pannello, nascosto fuori gara". Se
in qualifica serve comunque sapere "sto facendo il mio giro secco", quella
informazione resta comunque implicita (l'unico timer visibile in qualifica,
vedi §4, e il fatto stesso di essere in quella fase) — nessuna nuova
richiesta esplicita di riportarlo altrove, quindi non aggiunto.

`setLapDisplay()` (`frontend/f1.js`) semplificata: la riga
`document.getElementById('lap-box').style.display = 'flex';` va rimossa
del tutto (non sostituita con un equivalente su `lap-chip` — la sua
visibilità è già interamente ereditata dal contenitore `#standings-panel`,
gestita altrove). La funzione continua a essere chiamata anche in
qualifica (comportamento invariato, nessuna nuova condizione da aggiungere)
e scrive comunque "GIRO SECCO" in `#lap-chip-value` anche se il pannello è
nascosto in quel momento — scrittura innocua su elemento invisibile, non
un bug da evitare con un controllo in più.

## 4. Tempo + velocità (top-right)

Un pannello unico `.f1-panel` con id `timer-speed-panel` (sostituisce
l'attuale `#timer-panel` come contenitore-che-si-mostra/nasconde), due
colonne interne separate da un bordo verticale sottile (`border-left: 1px
solid var(--f1-panel-border)` sulla seconda), riusando `#hud-timer`/
`#speed-value` esistenti (stessi id per i VALORI, JS invariato per il
calcolo — cambia solo il contenitore che li racchiude e quando è visibile).

**Cambiamento di comportamento 1**: oggi il timer (`#timer-panel`) è
visibile SOLO in qualifica (`display:none` in gara, impostato in tre punti:
righe 759/858/923 di `frontend/f1.js` — handler `f1Setup` [rientro a
sessione già avviata], `f1Countdown`, `f1RaceStarted`). L'utente ora vuole
il tempo visibile ANCHE in gara: tutti e tre i punti vanno aggiornati da
`(phase === 'qualifying') ? 'flex' : 'none'` a mostrare in ENTRAMBE le fasi
di sessione attiva — `(phase === 'qualifying' || phase === 'race') ? 'flex' : 'none'`
(riga 759/923) e, per `f1Countdown` (riga 858, oggi un secco `'none'`
incondizionato durante il countdown stesso — corretto lasciarlo così: tra
un `f1Countdown` e il successivo `f1RaceStarted`/`f1Setup` non c'è ancora
un tempo sensato da mostrare).

**Cambiamento di comportamento 2**: la velocità (`.hud-speed`/`#speed-value`)
oggi NON ha mai avuto un `display:none` — è sempre visibile, anche durante
`tyre_select`/`grid_display`. Spostandola nello stesso contenitore del
timer (`#timer-speed-panel`), erediterà la sua stessa visibilità: nascosta
fuori da qualifica/gara attiva. Effetto collaterale voluto (non ha senso
mostrare "0 km/h" nella schermata di scelta gomme), ma è un cambiamento
reale rispetto ad oggi — se in fase di verifica manuale sembra sbagliato,
va discusso con l'utente prima di "correggerlo" di nuovo, non assunto come
errore di implementazione.

## 5. Distacco dal leader (nuovo, calcolato lato server)

**Non serve precisione al millisecondo** (esplicitamente richiesto
dall'utente): stima da distanza sul tracciato / velocità attuale del
pilota, ricalcolata ogni ~3.5s e riusata fino al ricalcolo successivo — non
un nuovo evento socket dedicato, solo un campo nel payload già esistente
(`f1StateUpdate`, 20 volte/secondo) il cui VALORE cambia più di rado.

In `backend/sockets/games/f1GameSocket.js`:

```js
const GAP_RECALC_MS = 3500;
```

Nel `game` state, un nuovo campo `game.lastGapRecalc` (timestamp, `0`
iniziale). Dentro `tickGame` (`backend/sockets/games/f1GameSocket.js`), la
variabile `players` (array, già `Object.values(game.players)` — dichiarata
riga 828, `const players = Object.values(game.players);`) è già in scope in
questo punto della funzione: subito PRIMA di `broadcastState(io, lobbyId, game, true);`
(riga 883, dopo il loop `for (const p of autoPiloted) { ... }` e prima del
commento "Trasmesso PRIMA del controllo di fine sessione..."), aggiungere:

```js
    if (game.phase === 'race' && Date.now() - (game.lastGapRecalc || 0) >= GAP_RECALC_MS) {
        game.lastGapRecalc = Date.now();
        const ranked = [...players].sort((a, b) => progressScore(b, game.track) - progressScore(a, game.track));
        const leader = ranked[0];
        const metersPerUnit = game.track.lapLength / game.track.points.length;
        for (const p of ranked) {
            if (p === leader) { p.gapToLeaderMs = null; continue; }
            const distanceBehindUnits = progressScore(leader, game.track) - progressScore(p, game.track);
            const distanceBehindM = Math.max(0, distanceBehindUnits) * metersPerUnit;
            // speed è in unità/tick fisico (50ms); conversione a m/s: la stessa
            // usata dal client per mostrare i km/h (speed*55), portata a m/s (/3.6).
            const speedMs = Math.max(0.5, Math.abs(p.speed) * 55 / 3.6);   // pavimento anti-divisione-per-zero/gap assurdo da fermo
            p.gapToLeaderMs = Math.round((distanceBehindM / speedMs) * 1000);
        }
    }
```

(`[...players]` per non mutare l'ordine dell'array originale con `.sort()`,
dato che `players` è riusato subito dopo per `connected`/`endQualifying`/
`endRace`.)

`buildPublicState` aggiunge il campo al payload per-giocatore:

```js
gapToLeaderMs: (p.gapToLeaderMs != null) ? p.gapToLeaderMs : null
```

Reset a ogni nuova gara (`assignGridSpawns`, stesso punto dove si azzerano
`falseStart`/`hasPitted`): `p.gapToLeaderMs = null;`. Nuovo campo
sull'inizializzazione giocatore (join): `gapToLeaderMs: null,`.

Lato client, formattazione nel template della riga classifica (§3):
`d.gapToLeaderMs` in ms → stringa `+M:SS.mmm` se ≥60s, altrimenti `+S.mmm`
(un solo decimale è comunque leggibile, ma dato che il calcolo è già
un'approssimazione, mostrare 3 cifre decimali sarebbe fuorviante — **mostra
un solo decimale**, es. "+2.6", non "+2.603"). Leader: nessun testo (o `–`).

## 6. Animazione sorpasso (FLIP, anime.js)

L'ORDINE della classifica resta guidato in tempo reale da `position`
(calcolato ogni tick lato server, invariato — NON dal ricalcolo del gap,
che è solo un numero throttled dentro le righe già ordinate). Quando
`updateStandings()` riceve un nuovo stato con un ordine diverso da quello
disegnato l'ultima volta, invece di un secco "svuota e ridisegna", applica
la tecnica FLIP:

1. Prima di aggiornare il DOM: per ogni riga esistente, leggi la sua
   posizione verticale attuale (`getBoundingClientRect().top` o più
   semplicemente l'indice corrente nell'array visualizzato).
2. Aggiorna il DOM col nuovo ordine (stesso `innerHTML` di oggi, ricostruito).
3. Per ogni riga la cui posizione (vecchio indice → nuovo indice) è
   cambiata, calcola il delta in pixel (altezza riga × differenza di
   indice) e anima da quel delta a 0 con `anime()`:

```js
anime({
    targets: rowEl,
    translateY: [deltaPx, 0],
    duration: 420,
    easing: 'easeOutQuad',
});
```

Il pilota che sale (sorpasso subito) parte da SOTTO la propria posizione
finale (delta positivo) e ci arriva scorrendo verso l'alto; chi scende
parte da SOPRA (delta negativo) e scorre verso il basso — l'effetto
"scavalcamento" richiesto. Serve tracciare l'ordine precedente in una
variabile client-side (es. `let lastStandingsOrder = [];`, confrontata ad
ogni chiamata di `updateStandings` prima di sovrascriverla col nuovo
ordine).

## 7. Minimappa: tutti i piloti, non solo il proprio

Cambiamento architetturale: oggi un SOLO marker (`#minimap-dot`) pilotato da
UNA istanza `anime.path()`/`.seek()` (vedi `updateMinimap(trackIndex)` in
`frontend/f1.js`, unica chiamata dentro `animate()` per `color === myColor`).
Con più piloti dinamici (si uniscono/lasciano la partita), gestire N istanze
anime.js parallele è inutilmente complesso — si passa a un approccio più
diretto e nativo, SENZA anime.js per questa parte (resta usato altrove:
sorpasso, pop card, luci, ecc. — non è "basta con anime.js", solo che qui
non è lo strumento giusto per un insieme dinamico di marker):

```js
const minimapDots = {};   // color -> <circle> element, creati/distrutti come otherCars

function ensureMinimapDot(color) {
    if (minimapDots[color]) return minimapDots[color];
    const svg = document.getElementById('minimap-svg');
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('r', color === myColor ? '4' : '3');
    c.setAttribute('fill', color);
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

Chiamata per OGNI giocatore presente in `f1StateUpdate` (non solo
`myColor`), dentro il loop già esistente su `Object.entries(state)` in
quell'handler. Rimozione: nel listener esistente `f1PlayerLeft`, aggiungere
la pulizia del dot (`if (minimapDots[color]) { minimapDots[color].remove(); delete minimapDots[color]; }`),
stesso pattern già usato lì per `otherCars`/`hitboxMeshes`.

Il vecchio `#minimap-dot` (il `<g>` con halo+core, pensato per un solo
marker animato) va rimosso dal markup — i nuovi `<circle>` sono creati
dinamicamente via JS, non dichiarati staticamente in HTML. Restano invariati
`#minimap-track`/`#minimap-pit` (contorno pista/corsia box, generati una
tantum come oggi).

## 8. Pannello gomme (bottom-left)

Solo restyle (stessa struttura/logica, nessun cambio di comportamento):
`.f1-panel` al posto di `.hud-panel-neu`, colori dei testi da `--f1-text`/
`--f1-text-dim`. Icona chiusa/pannello aperto, toggle T/L1: tutto invariato.

Colore usura condiviso dalle 4 gomme: la funzione `wearColor()` in
`frontend/f1.js` non cambia (calcola valori `rgb(...)` letterali in JS, non
passa da custom property). Cambia solo il FALLBACK CSS della regola
`.wheel` — oggi `fill: var(--wear, var(--hud-wear-mid));` — che va aggiornato
a `fill: var(--wear, var(--f1-wear-mid));`, per coerenza: questo pannello
ora appartiene al nuovo sistema, non ha senso lasciare un riferimento al
vecchio token neumorfico solo per un fallback che in pratica non si vede
mai (JS imposta sempre `--wear` esplicitamente).

## Fuori scope

- Nessun redesign dei menu a schermo intero (scelta gomme, podio, reveal
  pole) — restano nello stile neumorfico del giro precedente
- Nessuna modifica alla vista telecamera "C" o al modello dell'auto —
  progetto separato, da affrontare dopo
- Il calcolo del distacco resta una STIMA (distanza/velocità), non un vero
  timing per-checkpoint come in F1 reale — esplicitamente accettato
  dall'utente

## File coinvolti

- `frontend/styles/f1.css` — nuovi token `--f1-*`, nuova classe `.f1-panel`,
  markup/stile del pannello classifica+giri unito, tempo+velocità a due
  colonne, rimozione stili ormai inutilizzati (`.hud-lap`, vecchio
  `.hud-standings` a sé stante, vecchio `.hud-timer` a sé stante — quelli
  ancora usati da altri elementi, es. `.hud-tyre-*`/`.hud-minimap`, restano)
- `frontend/f1.html` — markup: pannello classifica+giri unico, pannello
  tempo+velocità unico, rimozione `#lap-box` standalone, rimozione
  `#minimap-dot` statico (sostituito da marker dinamici)
- `frontend/f1.js` — `updateStandings()` (righe con distacco + FLIP),
  `setLapDisplay()` (nuovo target DOM, stessa logica), timer/velocità
  (nuovo target DOM, visibilità estesa alla gara), minimappa (rewrite
  multi-pilota, rimozione dipendenza anime.js per questa parte)
- `backend/sockets/games/f1GameSocket.js` — `GAP_RECALC_MS`, calcolo
  `gapToLeaderMs` in `tickGame`, campo in `buildPublicState`, reset in
  `assignGridSpawns`, inizializzazione al join

## Verifica

Manuale in localhost, due tab, gara con sorpassi: pannello classifica+giri
unico in alto a sinistra con distacchi che si aggiornano ogni ~3.5s;
sorpasso reale tra due giocatori produce l'animazione di scavalcamento
entro un tick dal cambio di `position` (non deve aspettare il prossimo
ricalcolo del gap); tempo+velocità visibili anche in gara, non solo in
qualifica; minimappa mostra un pallino per ENTRAMBI i giocatori, non solo
il proprio, e nessun errore in console quando uno dei due lascia la
lobby a metà gara (pulizia del dot). Verificare anche che la qualifica
resti visivamente sensata senza il chip giri dedicato (nessun posto dove
si perde un'informazione che prima c'era in modo confuso — il timer resta
comunque visibile).
