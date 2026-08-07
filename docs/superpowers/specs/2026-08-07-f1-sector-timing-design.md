# F1 — settori, delta timer continuo, "Leader"/"Lap" in classifica — Design

## Contesto

Richiesta utente 2026-08-07 (vedi memoria `project_f1_sectors_feature_request`),
brainstorming completato nella stessa sessione. Quattro feature HUD, tutte
**solo in gara** (mai in qualifica — un solo giro secco, nessun "giro
precedente" con cui confrontare):

1. 3 barre orizzontali "settore" sotto il tempo nel pannello timer
   (`#timer-speed-panel`), colorate giallo/verde/fucsia.
2. Il timer principale (`#hud-timer`) colorato rosso/verde in base al delta
   **continuo, istante per istante**, rispetto al giro precedente (stile
   delta F1 TV — non solo ai checkpoint di settore).
3. Classifica: il leader (spazio distacchi vuoto oggi) mostra "Leader".
4. Classifica: etichetta "Giro" → "Lap".

Ricognizione preliminare (questa conversazione, verificata leggendo il
codice riga per riga):

- **Nessun tempo di giro parziale esiste oggi lato server.** `p.time`
  (`f1GameSocket.js:291`) è scritto una sola volta, a fine sessione
  (`checkLap`, riga 1430) — non un tempo per-giro. `p.lap` è solo un
  contatore.
- **Pattern di rilevamento checkpoint già in uso**: `checkLap`
  (`f1GameSocket.js:1411-1469`) arma `p.checkpointA` a metà giro
  (`HALF_LAP_IDX`) e lo consuma al passaggio sul traguardo
  (`circularWithin` + finestra di tolleranza in metri,
  `checkpointWindowFor`/`finishWindowFor`). `computeFinishCrossingFraction`
  (righe 1389-1401) estrapola il punto esatto di attraversamento della
  linea tra due tick, usato oggi solo per `p.time` all'ULTIMO giro.
- **Indice circolare del tracciato**: `game.track.points` ha sempre
  `N_SAMPLES = 1000` punti (`f1GameSocket.js:1254`); `p.trackIndex` è
  l'indice del giocatore in questo spazio, aggiornato ogni tick
  (`updateTrackIndex`). `startFinishIndex` è l'indice 0 logico del giro.
- **Tre punti di reset identici** azzerano `p.lap`/`p.checkpointA`/
  `p.inFinishZone`: `startQualifying` (riga 603), `assignGridSpawns` (riga
  743, l'inizio vero della gara), `resetPlayers` (riga 1605). Qualunque
  nuovo stato per-giro deve essere resettato negli stessi tre punti.
- **`buildPublicState`** (`f1GameSocket.js:1499-1596`) costruisce
  `out[color] = {...}` per ogni giocatore, spedito ogni tick (50ms) via
  `f1StateUpdate` — il frontend lo consuma come "una entry per colore"
  (`Object.entries(state)` in più punti di `frontend/f1.js`, es. riga
  1080). Aggiungere campi dentro ogni entry esistente è sicuro; aggiungere
  chiavi non-colore al livello superiore romperebbe quell'iterazione.
- **Classifica**: `p.gapToLeaderMs` resta `null` per il leader
  (`f1GameSocket.js:1162`) **e anche per chiunque prima del primo ricalcolo**
  (commento riga 308) — quindi il frontend non può usare "gap null" come
  proxy di "sono il leader": deve controllare `d.position === 1`.
  `formatGap(null)` (`frontend/f1.js:1036-1043`) già ritorna stringa vuota,
  motivo per cui oggi lo spazio è vuoto.
- **Timer HUD**: `#hud-timer` (`frontend/f1.html:30`) è aggiornato in
  `animate()` (`frontend/f1.js:1948-1965`), ~60fps, per estrapolazione
  fluida da `myLiveElapsedMs` (l'ultimo `elapsedMs` reale ricevuto). Il
  colore verde attuale (`#2ecc71`, riga 1964) si applica SOLO quando
  `myFinalTime !== null` (giro bloccato/cronometrato) — comportamento da
  non toccare.

Rif. memoria: `project_f1_timer_and_waiting_panel_fixes_2026-08-07` (stessa
area di codice, fix recenti su `elapsedMs`/timer).

## Scope

**Dentro**: le 4 feature sopra, solo in fase `'race'`, bot inclusi nel
confronto globale fucsia, nessuna persistenza oltre la sessione di gara
corrente (azzerato ad ogni nuova gara, coerente con l'assenza di DB per
F1).

**Esplicitamente fuori scope**:
- Qualifica (nessun settore, nessun delta, nessuna colorazione timer lì).
- Barre settore per gli avversari — solo per il proprio pilota (dato
  personale, come oggi il timer/velocità).
- Persistenza tra gare/sessioni dei record di settore.
- Un secondo evento socket dedicato: tutto passa nel `f1StateUpdate`
  esistente.
- Precisione sub-tick sui tempi di settore: il meccanismo scelto (vedi
  sotto) ha una tolleranza di ~1 tick fisico (50ms) — accettabile per una
  grafica HUD, non un sistema di cronometraggio ufficiale/anti-cheat.

## Decisione architetturale

**Un solo meccanismo condiviso** invece di due sistemi separati (scelta
utente in brainstorming, per minimizzare codice duplicato su una feature
cosmetica): ogni giocatore accumula, giro per giro, una **curva
posizione→tempo** nello spazio indice circolare del tracciato. Questa
curva alimenta sia il delta continuo del timer sia le due soglie di
settore.

### Stato nuovo per giocatore (`game.players[color]`)

Allocato/azzerato negli **stessi tre punti che già resettano
`p.lap`/`p.checkpointA`/`p.inFinishZone`** (`startQualifying` riga 603,
`assignGridSpawns` riga 743, `resetPlayers` riga 1605) — stessa simmetria
del codice esistente, evita stati residui di un giro precedente dopo un
reset a metà gara. In qualifica gli array esistono ma restano inerti:
`updateSectorTiming` esce subito per `game.phase !== 'race'` prima di
toccarli (nessuno spreco di calcolo, solo l'allocazione one-shot di due
`Float32Array(1000)` per giocatore ad ogni reset — trascurabile).

| Campo | Tipo | Significato |
|---|---|---|
| `p.lapStartMs` | number | `elapsedMs` al momento di inizio del giro corrente (precisione sub-tick, stessa tecnica di `computeFinishCrossingFraction`). |
| `p.curLapCurve` | `Float32Array(N_SAMPLES)` | Per indice-relativo-al-giro, ms trascorsi dall'inizio giro alla PRIMA volta che quell'indice è stato raggiunto. Sentinella `-1` = non ancora raggiunto. |
| `p.prevLapCurve` | `Float32Array(N_SAMPLES)` \| `null` | Curva del giro precedente, completata (gap-fill applicato). `null` finché non si completa un primo giro in gara. |
| `p.curLapSectorTimes` | `[ms\|null, ms\|null, ms\|null]` | Durata dei 3 settori nel giro corrente, valorizzata mano a mano che si attraversano i confini. |
| `p.prevLapSectorTimes` | `[ms, ms, ms]` \| `null` | Durata dei 3 settori nell'ultimo giro completato. |
| `p.deltaToPreviousLapMs` | number \| `null` | Delta corrente, ricalcolato ogni tick. |

### Stato nuovo a livello di gara (`game`)

`game.bestSectorTimes = [Infinity, Infinity, Infinity]` — il tempo di
settore più basso mai registrato da QUALUNQUE pilota (umano o bot) in
questa gara. Azzerato negli stessi tre punti sopra (una volta per
chiamata, non per giocatore, dato che è un campo a livello di `game`).

### Indici di confine settore

Nello spazio indice-relativo-al-giro (`relIdx = (p.trackIndex -
startFinishIndex + n) % n`, cresce monotono da 0 a n-1 dentro un giro,
mai wraparound a metà — si riazzera solo al completamento giro):

```
SECTOR1_REL_IDX = Math.round(N_SAMPLES / 3)
SECTOR2_REL_IDX = Math.round(2 * N_SAMPLES / 3)
```

Divisione puramente geometrica (per indice campionato, non per metri
esatti — coerente con come `HALF_LAP_IDX` già divide il giro oggi),
identica per ogni pista, nessuna configurazione manuale per tracciato.

### Aggiornamento per tick (nuova funzione, chiamata come `checkLap` per ogni giocatore, in entrambi i loop di `tickGame` dove `checkLap` è già chiamato — righe 1117 e 1137)

```
function updateSectorTiming(p, game) {
    if (game.phase !== 'race') return;
    const n = game.track.points.length;
    const startFinishIndex = game.track.startFinishIndex || 0;
    const relIdx = (p.trackIndex - startFinishIndex + n) % n;
    const lapElapsedMs = game.raceTick * PHYSICS_TICK_MS - p.lapStartMs;

    if (p.curLapCurve[relIdx] < 0) p.curLapCurve[relIdx] = lapElapsedMs;

    if (relIdx >= SECTOR1_REL_IDX && p.curLapSectorTimes[0] == null) {
        p.curLapSectorTimes[0] = lapElapsedMs;
        game.bestSectorTimes[0] = Math.min(game.bestSectorTimes[0], lapElapsedMs);
    }
    if (relIdx >= SECTOR2_REL_IDX && p.curLapSectorTimes[1] == null) {
        p.curLapSectorTimes[1] = lapElapsedMs - p.curLapSectorTimes[0];
        game.bestSectorTimes[1] = Math.min(game.bestSectorTimes[1], p.curLapSectorTimes[1]);
    }

    p.deltaToPreviousLapMs = p.prevLapCurve ? (lapElapsedMs - p.prevLapCurve[relIdx]) : null;
}
```

Nota: il "tempo trascorso dall'inizio giro" per il lato CORRENTE del
confronto è sempre `elapsedMs - p.lapStartMs` — non serve mai leggere
`curLapCurve` per il proprio giro in corso, solo per costruire il
riferimento del giro SUCCESSIVO. `curLapCurve` è quindi scritto ogni tick
ma letto solo a fine giro (quando diventa `prevLapCurve`) e nel lookup
`prevLapCurve[relIdx]` per il delta.

Il confronto `relIdx >= soglia` (invece di `circularWithin` con finestra
di tolleranza, come fa `checkpointA`) è deliberato: nello spazio
indice-relativo (monotono dentro un giro, mai wraparound a metà) una
soglia "maggiore o uguale" cattura qualunque salto di indice tra due tick
(anche un taglio netto fuoripista), a differenza di una finestra stretta
che potrebbe essere scavalcata. Effetto collaterale accettato: un taglio
molto ampio che salta più confini nello stesso tick fa scattare più
settori nello stesso istante, con un tempo di settore innaturalmente
corto — comportamento cosmetico, non un problema di correttezza della
gara (nessuna penalità/logica di gioco dipende da questo timing).

### Completamento giro (dentro `checkLap`, stesso blocco `if (p.checkpointA && inFinishZone && !p.inFinishZone)`, righe 1421-1467)

Oggi `frac`/tempo preciso di attraversamento si calcola SOLO quando
`p.lap >= totalLaps` (ultimo giro). Va calcolato **ad ogni giro** in fase
`'race'` (mai in qualifica, dove tutto questo stato non esiste):

```
const crossingElapsedMs = Math.round((game.raceTick - 1 + computeFinishCrossingFraction(p, game.track, startFinishIndex)) * PHYSICS_TICK_MS);

// settore 3 = tutto ciò che resta dopo i primi due
const s3 = crossingElapsedMs - p.lapStartMs - (p.curLapSectorTimes[0] || 0) - (p.curLapSectorTimes[1] || 0);
game.bestSectorTimes[2] = Math.min(game.bestSectorTimes[2], s3);
p.prevLapSectorTimes = [p.curLapSectorTimes[0], p.curLapSectorTimes[1], s3];
p.prevLapCurve = fillGaps(p.curLapCurve);   // interpolazione lineare sui buchi (vedi sotto)

// reset per il nuovo giro
p.curLapCurve = new Float32Array(n).fill(-1);
p.curLapCurve[0] = 0;
p.curLapSectorTimes = [null, null, null];
p.lapStartMs = crossingElapsedMs;
```

Guardia `game.phase === 'race'` attorno a questo blocco (il resto di
`checkLap` — conteggio giri, `p.time` finale, penalità — resta
identico e invariato anche in qualifica).

### `fillGaps` — riempimento buchi nella curva

A velocità alta, un giocatore avanza di 1-2 indici per tick (su 1000
campioni/giro) — quasi sempre continuo, ma non garantito. Una passata
`O(n)` a fine giro interpola linearmente ogni run di `-1` tra due valori
noti; un run iniziale (prima del primo valore noto) è riempito con `0`,
un run finale (dopo l'ultimo valore noto, prima del wraparound) è
riempito a valore costante con l'ultimo noto. Costo trascurabile (1000
elementi × 1 volta a giro × N giocatori).

## Flusso dati verso il client

Nessun nuovo evento socket. `buildPublicState` (`f1GameSocket.js:1514-1593`)
aggiunge 4 campi a `out[color]`, solo se `game.phase === 'race'` (altrimenti
`null`, coerente con "solo in gara"):

```
sectorTimes: p.curLapSectorTimes,        // [ms|null, ms|null, ms|null] — giro corrente
prevSectorTimes: p.prevLapSectorTimes,   // [ms, ms, ms] | null — giro precedente
bestSectorTimes: game.bestSectorTimes,   // [ms, ms, ms] — record sessione, duplicato per ogni giocatore
deltaToPreviousLapMs: p.deltaToPreviousLapMs,   // number | null
```

`bestSectorTimes` duplicato identico su ogni entry invece di una chiave
unica a livello di `state` — evita di toccare la forma del payload che il
frontend itera oggi come "una entry per colore" (vedi Contesto).

## Frontend

### Barre settore (`frontend/f1.html` + `frontend/f1.js` + `frontend/styles/f1.css`)

Nuova riga sotto `#hud-timer`, dentro la colonna "Tempo" di
`#timer-speed-panel` (stessa skin: font Fredoka, palette `--f1-*`
esistente) — 3 barrette corte in fila, una per settore. Nuova variabile
CSS per il fucsia (non esiste oggi nella palette `--f1-*`).

Colore per barra `i`, dati `sectorTimes[i]`/`prevSectorTimes`/`bestSectorTimes[i]`
del proprio colore (`myColor`, mai per gli avversari):

1. `sectorTimes[i] == null` → grigio/neutro (non ancora raggiunto in questo giro).
2. altrimenti, `sectorTimes[i] <= bestSectorTimes[i]` → **fucsia** (record
   di sessione — questo player l'ha appena stabilito, o lo detiene ancora).
3. altrimenti, `prevSectorTimes == null` → grigio/neutro (primo giro in
   gara, nessun riferimento personale ancora).
4. altrimenti, `sectorTimes[i] < prevSectorTimes[i]` → **verde**.
5. altrimenti → **giallo**.

Nota comportamentale (voluta, coerente con la vera F1): se un altro
pilota batte in seguito il record di sessione su un settore che questo
giocatore deteneva, la sua barra torna verde/gialla al tick successivo —
`bestSectorTimes` è confrontato live, non congelato al momento del
attraversamento.

### Timer principale (`frontend/f1.js`, dentro `animate()`, righe 1948-1965)

Mentre il giro è in corso (`myFinalTime === null`, stesso branch usato
oggi): colore verde se `deltaToPreviousLapMs < 0`, rosso se `> 0`, nessun
override (default) se `null` o `0`. Il comportamento a giro concluso
(`myFinalTime !== null` → verde fisso `#2ecc71`) resta invariato — il
delta colora solo il timer "live", mai quello bloccato a fine giro.

`deltaToPreviousLapMs` viene letto una volta per `f1StateUpdate` (~50ms,
non per frame come `elapsedMs`) — sufficiente per una colorazione, non
serve estrapolazione locale fluida come per il valore numerico del
tempo.

### Classifica (`frontend/f1.js`)

- `renderStandingRowContent` (righe 1051-1062): lo `<span class="gap">`
  mostra `"Leader"` quando `d.position === 1` (non quando
  `d.gapToLeaderMs == null`, che è vero anche per tutti prima del primo
  ricalcolo — vedi Contesto), altrimenti `formatGap(d.gapToLeaderMs)`
  come oggi.
- `frontend/f1.html:19`: testo statico `"Giro"` → `"Lap"`.

## Edge case / invarianti garantiti

- **Qualifica invariata**: `updateSectorTiming` esce subito se
  `game.phase !== 'race'`; il blocco di completamento giro con
  `crossingElapsedMs`/settori è dentro una guardia `phase === 'race'`
  analoga; nessun campo nuovo viene popolato (resta `null`) fuori gara.
- **Primo giro in gara**: `prevLapCurve`/`prevLapSectorTimes` sono `null`
  → nessun delta, barre settore al più fucsia (mai verdi/gialle senza un
  riferimento personale).
- **Fermata ai box**: nessuna gestione speciale — il giocatore continua ad
  avanzare (lentamente) in `trackIndex` durante l'autopilota box, la
  curva/i settori si costruiscono normalmente, semplicemente con tempi
  più lunghi (riflette la realtà: un giro con pit stop è più lento, giallo
  quasi ovunque rispetto a un giro senza sosta — nessuna soppressione).
- **Reset a centro gara** (`resetPlayers`, riga 1605, es. ritorno alla
  lobby): tutto il nuovo stato per-giocatore viene azzerato qui allo
  stesso modo di `p.lap`/`p.checkpointA` — nessuno stato di settore
  sopravvive a un reset esplicito.
- **`game.bestSectorTimes`**: azzerato negli stessi tre reset dei campi
  per-giocatore — nessuna persistenza cross-sessione, coerente con la
  decisione utente (in qualifica resta inutilizzato: nulla lo legge finché
  `game.phase !== 'race'`).

## Test plan

- Test unitario `updateSectorTiming`: sequenza di tick con `trackIndex`
  crescente attraverso `SECTOR1_REL_IDX`/`SECTOR2_REL_IDX` produce
  `curLapSectorTimes` corretti e aggiorna `game.bestSectorTimes` solo
  quando il nuovo tempo è più basso.
- Test unitario `fillGaps`: array con buchi isolati (`-1` circondati da
  valori noti) → interpolazione lineare corretta; buco iniziale/finale →
  riempito come da spec.
- Test unitario completamento giro: al secondo giro completato,
  `prevLapSectorTimes` e `prevLapCurve` riflettono esattamente i dati
  accumulati nel primo giro; `p.curLapCurve`/`curLapSectorTimes` sono
  azzerati per il nuovo giro.
- Test di non-regressione: `game.phase = 'qualifying'` → tutti i nuovi
  campi restano `null`/assenti, `checkLap` produce lo stesso `p.time`
  finale di oggi (nessuna modifica al percorso qualifica).
- Verifica manuale in localhost (playtest utente, come da convenzione
  progetto): due tab, gara di più giri, osservare le 3 barre cambiare
  colore ai due terzi del tracciato, il timer principale colorarsi
  rosso/verde in modo fluido durante il giro, "Leader" comparire nello
  slot del primo in classifica, "Lap" al posto di "Giro".

## Rollout

Nessun flag env — a differenza dei flag fisici (`F1_*`) elencati in
`docs/f1-notes.md`, questa è una feature HUD pura, sempre attiva una
volta implementata (stessa disciplina delle feature HUD precedenti come
il redesign broadcast). Procede per step secondo CLAUDE.md: backend
(rilevamento + broadcast) verificabile headless, poi frontend (grafica),
verifica in localhost dell'utente prima di considerarla chiusa.

## Cosa NON fa questo documento

- Non introduce settori/delta in qualifica.
- Non mostra barre settore per gli avversari, solo per il proprio
  pilota.
- Non persiste alcun dato oltre la sessione di gara corrente (nessuna
  scrittura su MongoDB/leaderboard).
- Non introduce un nuovo evento socket — tutto dentro `f1StateUpdate`.
- Non garantisce precisione sub-tick sui tempi di settore (tolleranza
  ~50ms, accettata esplicitamente in fase di brainstorming).
