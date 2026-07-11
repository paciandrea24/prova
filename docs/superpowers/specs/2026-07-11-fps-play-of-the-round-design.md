# FPS — Play of the Round (replay POV a fine round)

**Data**: 2026-07-11 · **Stato**: approvata a voce, in attesa di review scritta

## Obiettivo

Tra la fine di un round e l'inizio del successivo, mostrare a tutti i
giocatori un breve replay in **prima persona (POV di chi ha fatto la kill)**
del momento più spettacolare del round appena concluso — non necessariamente
il colpo che ha chiuso il sudden death: se durante la mischia (respawn
istantaneo) c'è stata una doppia/tripla/quadrupla uccisione ravvicinata, è
quella a vincere.

Seconda metà del piano avviato con la [modalità spettatore in sudden
death](2026-07-11-fps-spectator-mode-design.md), che riusa lo stesso
`PovController` in modalità `source: 'buffer'` (oggi solo `'live'`).

## Contesto attuale (perché serve toccare netcode + fine-round)

- **Nessun log kill persistente**: il server processa ogni `reportHit` in
  `fpsGameSocket.js` ma non conserva uno storico dei kill del round — serve
  per poter confrontare "quale kill era il migliore" a fine round.
- **Headshot già tracciato**: `reportHit` riceve `headshot` dal client
  (raycast locale, trust esistente) e lo usa già per danno/mutatore — zero
  lavoro extra per riusarlo come segnale di qualità del colpo.
- **Nessuna posizione autoritativa lato server**: `game.players[color].x/y/z`
  è aggiornato solo a spawn/respawn, non ad ogni frame (la sync di movimento
  è P2P client-client, il server non la vede). Niente segnale "distanza di
  tiro" senza aggiungere tracking dedicato — **fuori scope** (vedi sotto).
- **Buffer di posizione troppo corto e solo per i remoti**: `rp.snapshots[]`
  (popolato da `applyRemoteState()`) esiste solo per i giocatori *remoti* e
  viene troncato a ~1.5-3s (60→30 entry) per robustezza anti-freeze, non per
  replay. Il giocatore **locale** non bufferizza mai se stesso (calcola lo
  stato per `broadcastState()` e lo spedisce, ma non lo conserva).
- **`ROUND_END_DELAY` è fisso a 2.5s** (`fpsGameSocket.js`): la pausa tra
  `roundEnd` e il round successivo (`startWeaponSelect`/`endGame`) è troppo
  corta per ospitare un replay di qualche secondo.
- **`PovController`** (dal lavoro precedente) è già pronto ad essere
  riusato ma `update()` legge sempre `gameState.players` dal vivo; il campo
  `source` esiste ma non è ancora letto da nessuno.

## Requisiti

1. Il replay mostra il POV di chi ha fatto il kill migliore del round
   (mischia **o** sudden death, non solo il colpo che chiude il round).
2. "Migliore" combina: **serie ravvicinate** (doppia/tripla/multikill, peso
   dominante), **headshot** (bonus piccolo), **kill che chiude il round**
   (bonus piccolo, mai dominante da solo).
3. Stesso replay per tutti i client (scelta fatta dal server, autoritativa).
4. Prima persona pura — mai terza persona, mai camera libera.
5. Durata della clip **dinamica**: abbastanza lunga da mostrare per intero
   una serie ravvicinata, non solo l'ultimo colpo.
6. Non saltabile: tutti guardano la clip per intero.
7. Si inserisce **prima** dell'overlay punteggi esistente (che parte con il
   suo countdown solo a clip finita), per ogni round incluso l'ultimo prima
   del podio finale.
8. Nessuna regressione sul netcode/hit-detection autoritativa esistente.

## Architettura

### A. Log kill + scoring (server, `fpsGameSocket.js`)

- `launchRound()` azzera `game.killLog = []`.
- In `reportHit`, quando `target.hp <= 0` (già nel branch che gestisce
  `checkRoundEnd`/respawn), push su `game.killLog`:
  ```js
  { killerColor: shooterColor, targetColor, weaponKey, headshot: !!headshot,
    timestamp: Date.now(), endsRound: false }
  ```
  `endsRound` NON si può dedurre dalla subphase al momento del kill: in
  sudden death con 3+ giocatori un kill può lasciarne comunque 2+ vivi e
  non chiudere il round. Va marcato invece dentro `checkRoundEnd`: se la
  funzione decide di chiudere il round (`alive.length <= 1`), imposta
  `game.killLog[game.killLog.length - 1].endsRound = true` — è corretto
  farlo sull'ultimo elemento perché, una volta che `checkRoundEnd` porta
  `game.phase` a `'round_end'`, `reportHit` rifiuta ogni ulteriore colpo
  (`game.phase !== 'playing'`), quindi nessun altro kill può essere stato
  accodato nel frattempo.
- In `checkRoundEnd`, subito prima di emettere `roundEnd`, se
  `game.killLog.length > 0`:
  1. Ordina i kill per `timestamp`; per ogni kill calcola la dimensione
     della "serie" del suo killer: quanti kill consecutivi dello stesso
     `killerColor` lo precedono con gap ≤ `MULTI_KILL_WINDOW = 5000`ms.
  2. Punteggio per kill = `streakBonus(size) + (headshot ? 12 : 0) +
     (endsRound ? 8 : 0)`, dove `streakBonus`: 1→0, 2→30, 3→70, 4→120,
     +40 per ogni kill oltre la 4ª. Il punteggio della serie è assegnato
     solo all'**ultimo** kill della serie (l'"ancora" del replay).
  3. Vince il punteggio più alto; a parità, il kill più recente.
  4. Il replay copre l'intera serie: `windowMs = clamp(4500,
     timestamp_ancora - timestamp_primo_kill_serie + 2000, 12000)`
     (pre-roll), + `1200`ms di coda dopo l'ultimo colpo (post-roll).
- `roundEnd` guadagna i campi:
  ```js
  playOfRound: {
    killerColor, victimColor, weaponKey, headshot, streakCount,
    timestamp,        // Date.now() del kill scelto (clock server)
    serverNow: Date.now(),   // clock server al momento dell'emit
    preRollMs, postRollMs
  }
  ```
- `ROUND_END_DELAY` non è più una costante fissa passata al `setTimeout`
  prima del prossimo round: diventa `replayDurationMs (preRoll+postRoll) +
  SCORE_PAUSE_BASE` (nuova costante, valore = vecchio `ROUND_END_DELAY`
  2500ms, la pausa "solo scoreboard" dopo la clip). Il valore calcolato è
  lo stesso mandato nel payload (`nextInMs`) e usato dal server per il
  proprio `setTimeout` — client e server restano allineati.

### B. Buffering client esteso (self + remoto)

- `rp.snapshots[]`: rimosso il troncamento a 30/60 entry — bufferizzato per
  **tutta la durata del round**, azzerato ad ogni `roundStart` (già esiste
  un handler che resetta `gameState.players`, ci si aggancia lì).
- **Nuovo self-buffer**: nello stesso punto di `animate()` dove oggi si
  chiama `broadcastState()` (throttle 20fps esistente, 0.05s), lo stato
  locale (`x,y,z,ry,rx,mv,sp,cr,sl`) viene *anche* accodato in
  `mySnapshots[]` — stessa struttura di `rp.snapshots`, stesso ciclo di
  vita (azzerato a `roundStart`). Nessun costo di rete aggiuntivo: è solo
  uno specchio locale di un valore già calcolato.
- **Log colpi con timestamp** (self + remoto): oggi `_shotSeq`/
  `_shotWeapon` tengono solo l'ultimo sparo (dedup). Si aggiunge, in
  parallelo, `shotLog[] = [{t, weaponKey}]` per player (incluso se stesso),
  popolato dagli stessi eventi "shot fired" già esistenti (P2P +
  fallback socket.io), azzerato a `roundStart`.

### C. `PovController` — modalità `source: 'buffer'`

- `enterReplay({ killerColor, timestamp, serverNow, preRollMs, postRollMs,
  weaponKey })`:
  - Calcola `ageMs = serverNow - timestamp` (delta nel clock **server**,
    quindi immune a offset/drift tra client e server) e
    `localKillMoment = performance.now() - ageMs` (assumendo la latenza di
    rete per ricevere l'evento trascurabile rispetto alla finestra di
    qualche secondo — nessun bisogno di un vero NTP-sync).
  - Finestra locale della clip: `[localKillMoment - preRollMs,
    localKillMoment + postRollMs]`.
  - `source = 'buffer'`, `active = true`; nasconde crosshair/HUD live,
    mostra banner "PLAY OF THE ROUND" (+ etichetta serie: "DOPPIA
    UCCISIONE"/"TRIPLA UCCISIONE"/"MULTIKILL ×N" se `streakCount > 1`, tag
    "HEADSHOT" se applicabile).
- `update(dt)` (branch `source === 'buffer'`): invece di leggere
  `gameState.players` dal vivo, avanza un "orologio di replay" da inizio a
  fine finestra a velocità reale (1×) e interpola posizione/rotazione dal
  buffer del killer (`mySnapshots` se il killer sono io, altrimenti
  `gameState.players[killerColor].snapshots`) più vicino a quell'istante.
  Applica lo stesso `switchWeaponModel` usato dallo spettatore live.
  Sugli eventi di `shotLog` che ricadono nell'istante corrente della
  riproduzione: stesso `_playShotFeedback` (muzzle-flash/rinculo/SFX) già
  scritto per lo spettatore.
  A fine finestra: chiama `exit()` e segnala al chiamante (callback/evento)
  che la clip è terminata → si passa all'overlay punteggi esistente.
- `update(dt)` (branch `source === 'live'`): invariato, stesso codice di
  oggi (usato dallo spettatore in sudden death).

### D. Flusso a fine round (client)

`socket.on('roundEnd', ...)`:
1. Se `data.playOfRound` e il buffer del killer ha abbastanza campioni
   nella finestra richiesta (almeno 2 punti): `PovController.enterReplay(
   data.playOfRound)`. Al termine (callback di fine clip) → prosegue con lo
   stesso codice che oggi gira subito: `updateScoreHUD()`,
   `showRoundEndOverlay(data)`.
2. Se manca `playOfRound` o il buffer è insufficiente (client appena
   riconnesso, edge case): salta direttamente al passo 2 di sempre — nessun
   replay, nessun blocco.

## Gestione errori / casi limite

- **Buffer insufficiente** (killer disconnesso a lungo prima del kill,
  client appena riconnesso che non ha visto l'inizio del round): fallback
  silenzioso, si passa dritti all'overlay punteggi (nessun replay quel
  round per quel client — comunque `ROUND_END_DELAY` è già stato calcolato
  dal server includendo lo spazio per la clip, quindi il client che salta
  semplicemente aspetta in overlay leggermente più a lungo, nessun
  disallineamento con gli altri).
- **Pareggio** (due kill quasi simultanee in sudden death, `winnerColor:
  null`): `killLog` ha comunque le due entry, lo scoring sceglie comunque
  un vincitore per il replay (non influisce sull'esito "pareggio" già
  gestito da `checkRoundEnd`).
- **Riconnessione durante la finestra di replay**: il resync (`fpsInit`)
  che arriva a `phase === 'round_end'` salta il replay e mostra
  direttamente l'overlay punteggi (stesso fallback del buffer
  insufficiente).
- **Round senza kill "spettacolari"** (singolo 1v1, nessun headshot): non è
  un caso limite — lo scoring sceglie comunque l'unico kill disponibile
  (bonus `endsRound` garantisce sempre almeno un candidato), la clip resta
  breve (solo pre-roll base 4.5s), pausa fine-round vicina al vecchio
  valore fisso.

## Fuori scope (qui)

- **Distanza di tiro come segnale di scoring**: richiederebbe tracciare la
  posizione autoritativa lato server (oggi assente); il punteggio si basa
  solo su serie/headshot/kill-decisiva.
- **Terza persona / self-mesh**: il replay è sempre POV del killer; niente
  modello 3D visibile di se stessi, quindi nessun `createPlayerMesh` extra.
- **Skip button**: la clip si guarda sempre per intero.
- **Slow-motion / effetti cinematografici** (color grading, ecc.): playback
  a velocità reale 1×.
- **Death animation / ragdoll della vittima**: invariato rispetto a oggi.

## Verifica (utente, in localhost, più tab)

1. Round con una singola kill 1v1 in sudden death: pausa fine-round breve
   (~5-6s), replay POV del killer, nessuna etichetta serie.
2. Round con doppia/tripla uccisione ravvicinata in mischia: la pausa
   fine-round si allunga di conseguenza, il replay mostra l'intera serie
   (non solo l'ultimo colpo) con l'etichetta corretta ("DOPPIA
   UCCISIONE"/"TRIPLA UCCISIONE").
3. Kill decisiva di fine round con una tripla precedente nello stesso
   round: vince la tripla, non la kill finale (verifica che il bonus
   "chiude il round" non domini).
4. Colpo a segno in testa nel kill scelto: tag "HEADSHOT" visibile.
5. Se il killer del replay sono io: vedo il mio stesso POV riprodotto
   correttamente (self-buffer).
6. Ultimo round della partita: il replay va comunque in scena prima della
   sequenza del podio finale.
7. Disconnessione/riconnessione a cavallo di un fine-round: nessun blocco,
   fallback diretto all'overlay punteggi.

## Addendum 4 (pre-implementazione, dopo verifica utente su Task 1-8)

Dopo la verifica in localhost dei Task 1-8 l'utente ha segnalato tre lacune
reali non coperte dal design originale (non bug di regressione — feature
mai specificate/implementate):

**Problema 1 — le vittime non muoiono mai nel replay.** Il client riceve
solo il riepilogo della kill "vincitrice" (`playOfRound`), non l'elenco
delle kill avvenute nella finestra. Senza un timestamp di morte per ogni
vittima, `_updateReplay` le mostra congelate nell'ultima posizione nota
invece di farle sparire — la decisione "Death animation/ragdoll: invariato
rispetto a oggi" (Fuori scope, sopra) non è mai stata effettivamente
applicabile perché mancava il dato per farla scattare.

**Fix (nessuna nuova animazione, solo il dato mancante):** `pickPlayOfRound`
calcola già la finestra `[timestamp - preRollMs, timestamp + postRollMs]`
in clock server. Aggiunge un campo `kills: [{targetColor, timestamp}]`
filtrando `game.killLog` per **tutte** le kill (di qualunque killer, non
solo della serie premiata) cadute in quella finestra — copre anche vittime
"di contorno" morte per mano di un altro giocatore nello stesso arco di
tempo. Lato client, `_updateReplay` confronta il cursore di riproduzione
con questi timestamp (stessa conversione clock server→locale già usata per
`killLocal`) e nasconde `rp.group.visible = false` la vittima nell'istante
esatto — identico al comportamento già esistente quando muore dal vivo,
nessuna animazione di morte nuova (ragdoll resta fuori scope).

**Problema 2 — i giocatori ricostruiti non hanno ciclo di camminata.**
Decisione di scope deliberata nel Task 5 originale ("mai toccare
`rp.anim.phase`, condiviso col live, rischio di desync"): i giocatori si
spostano per interpolazione pura, senza swing delle gambe → sembrano
traslare invece di camminare.

**Fix:** nuovo stato `PovController._replayAnimPhase = {}` (chiave colore),
azzerato in `enterReplay`, MAI scritto su `rp.anim.phase`. Nel loop di
ricostruzione di `_updateReplay`, quando `frame.mv` è vero, avanza questa
fase locale con la stessa formula già usata da `updateRemoteAnim`
(`phase += dt * rate` con `rate = frame.sp ? 13 : 9`, `swing = frame.sp ?
0.95 : 0.6`) e applica `rp.legL/legR.rotation.x = ±sin(phase) * swing`.
Nessun rischio di desync: `rp.anim.phase` (letto dal rendering LIVE) non
viene mai toccato da questo codice.

**Problema 3 — manca un annuncio prima del replay.** Oggi il cut alla POV
del killer è immediato e senza preavviso — la Play of the Round "sorprende"
senza dare il tempo di capire cosa sta per succedere.

**Fix:** nuovo overlay fullscreen nero con testo "PLAY OF THE ROUND",
mostrato per `ANNOUNCE_DURATION = 1500`ms prima del cut alla POV — poi
scompare e la riproduzione parte esattamente come oggi (incluso il banner
"Doppia/Tripla Uccisione"/"Headshot" già esistente, che resta invariato e
compare solo durante la clip, non nell'annuncio). Nessun contenuto
duplicato tra annuncio e banner, nessun effetto sonoro nuovo (fuori scope
per questo giro).

Dettaglio emerso investigando: l'input (movimento/mira/sparo) durante il
replay è bloccato dal guard esistente `PovController.active`, che oggi si
attiva solo al momento del cut. Durante il nuovo schermo nero pre-annuncio
quel flag sarebbe ancora `false` — chi non è morto in quel round potrebbe
muoversi/sparare dietro lo schermo nero. Fix: `PovController.active` si
attiva già all'inizio dell'annuncio (non solo al cut), così i guard
d'input esistenti (`updateMovement`, mousemove, `tryShoot`, ecc. — tutti
già condizionati su `PovController.active`) coprono l'intera sequenza
senza bisogno di nuovi controlli sparsi nel codice.

Pacing: il server aggiunge `ANNOUNCE_DURATION` al calcolo di `nextInMs`
(insieme a `replayDurationMs` e `SCORE_PAUSE_BASE`, già esistenti) — stesso
meccanismo già in uso, nessuna nuova fonte di disallineamento tra client.

### Fuori scope (Addendum 4)

- **Ragdoll/animazione di morte per le vittime**: restano un `visible =
  false` secco, come dal vivo oggi (Problema 1 sopra è un fix del dato
  mancante, non una nuova animazione).
- **Effetto testa/trofeo (`dropTrophyLive`) nel replay**: non riusato qui —
  valutabile in un giro futuro.
- **Audio per l'annuncio**: solo visivo in questo giro.
- **Contenuto della serie (doppia/tripla/headshot) nell'annuncio**: resta
  esclusivamente nel banner esistente durante la clip.
