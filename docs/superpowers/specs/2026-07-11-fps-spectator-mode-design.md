# FPS — Modalità spettatore in Sudden Death (+ infrastruttura POV condivisa)

**Data**: 2026-07-11 · **Stato**: approvata a voce, in attesa di review scritta

## Obiettivo

Quando un giocatore viene eliminato in **sudden death** (dove non c'è
respawn), invece di restare sulla dead-screen statica fino a fine round deve
entrare automaticamente in **modalità spettatore**: visuale in prima persona
reale (stessa posizione/rotazione/arma) di uno dei giocatori ancora vivi, con
possibilità di passare da un vivo all'altro.

Questa è la **prima delle due sotto-feature** di un piano più ampio (l'altra
è "Play of the Round", un replay automatico dell'azione più spettacolare del
round, mostrato tra un round e l'altro — spec separata, futura). Le due
condividono lo stesso nucleo: una camera POV che può disegnare la vista di
"un altro giocatore" a partire da uno stream di stati. Qui la sorgente è lo
stream **live** già esistente in rete; nel Play of the Round sarà un
**buffer registrato**. Il modulo va quindi progettato per essere riusabile,
non specifico dello spettatore.

## Contesto attuale (perché serve toccare il netcode)

- La sync di posizione/rotazione tra client è **P2P via WebRTC** (fallback
  socket.io), NON passa dal server: `sendStateHeartbeat()` →
  `socket.emit('playerState', {x,y,z,ry,mv,sp,cr,sl,wk})` + broadcast sui
  data channel (`broadcastState()`); ricezione in `applyRemoteState()` che
  accoda in `rp.snapshots` (usato per interpolare il modello TP remoto).
- **Manca il pitch**: solo `ry` (yaw) è sincronizzato. Nessun client sa oggi
  dove sta guardando verticalmente un altro giocatore — necessario per una
  vera visuale in prima persona.
- **Solo i colpi CONFERMATI vengono trasmessi**: `tryShoot()` fa raycast
  locale e chiama `socket.emit('reportHit', ...)` SOLO se il raycast trova
  un bersaglio; un colpo a vuoto non genera alcun evento di rete. Per far
  scattare rinculo/muzzle-flash nel POV di chi osserva serve un evento "ho
  sparato" indipendente dall'esito.
- **Le munizioni non sono sincronizzate**: il server le conosce (per la
  propria autorità su hit/reload) ma non le trasmette agli altri client.
- **L'HP è già sincronizzato a tutti** (serve alle healthbar sopra i
  nemici, già in gioco), quindi non serve toccarlo.
- Morte in sudden death oggi: `playerKilled` con `killedColor === MY_COLOR`
  → `gameState.isDead = true`, dead-screen a schermo intero ("Waiting for
  round to end…"), pointer lock rilasciato, nessuna interazione fino al
  prossimo `roundStart`.

## Requisiti

1. Morte in sudden death → ingresso automatico in spettatore, nessuna
   interazione richiesta.
2. Visuale sempre in prima persona reale del giocatore osservato (posizione,
   rotazione, arma in mano, animazioni), mai una camera libera/svincolata.
3. Solo giocatori **vivi** sono selezionabili come target.
4. Switch rapido tra i vivi con **tasti freccia** (◄ precedente / ► successivo
   nell'elenco dei vivi, wrap-around).
5. HUD aggiornato ad ogni cambio target: colore-squadra osservato, arma
   equipaggiata, HP, **munizioni esatte**.
6. Se il giocatore osservato muore, switch automatico al prossimo vivo senza
   interrompere la visualizzazione (niente schermo nero/freeze).
7. Con un solo sopravvissuto, tutti gli spettatori lo seguono automaticamente
   e lo switch manuale è ignorato finché non finisce il round.
8. A fine round, uscita automatica dalla modalità spettatore e ripristino
   della visuale/HUD normali per il round successivo.
9. Il modulo che pilota la camera POV deve essere riusabile dal futuro Play
   of the Round (sorgente dati intercambiabile: live vs buffer).

## Architettura

### A. Estensioni al netcode P2P (nessuna modifica lato server)

- `sendStateHeartbeat()` / `applyRemoteState()`: aggiunti due campi al
  payload esistente:
  - `rx`: pitch della camera in radianti (nuovo, oggi assente).
  - `am`: munizioni correnti dell'arma equipaggiata (nuovo).
- Nuovo evento leggero P2P **"shot fired"**, emesso da `tryShoot()` ad ogni
  colpo sparato (esito indipendente, quindi anche sui colpi a vuoto):
  `{ color, weaponKey }`. Ricevuto da tutti i peer e usato solo per
  riprodurre feedback visivo/sonoro locale (muzzle-flash, rinculo, SFX) —
  non ha alcun ruolo nell'hit detection autoritativa, che resta invariata
  lato server.

### B. `PovController` — modulo condiviso (nuovo, in `fps.js`)

```js
PovController = {
  active: false,
  targetColor: null,
  source: 'live',          // valore fisso oggi; 'buffer' sarà il caso d'uso del Play of the Round

  enter(color)     { ... } // salva lo stato camera/arma/HUD locali, nasconde arma+corpo veri
  exit()           { ... } // ripristina la vista normale
  setTarget(color) { ... } // cambia bersaglio senza uscire dalla modalità
  update(dt)       { ... } // chiamato dentro animate(): applica pos/rot/arma/HUD dal target corrente
}
```

Comportamento di `update(dt)` (sorgente live):

- Legge l'ultimo snapshot interpolato di `targetColor` da `rp.snapshots`
  (stesso buffer già usato per il rendering TP del remoto) → posizione,
  `ry` (yaw), `rx` (pitch, nuovo).
- Posiziona `camera` su quella trasformazione con l'offset occhio standard
  giá esistente (`STAND_EYE`/`CROUCH_EYE`/`SLIDE_EYE` derivato da
  `mv/sp/cr/sl`).
- Nasconde la mesh TP del giocatore osservato (altrimenti si vedrebbe il
  proprio modello dall'interno) finché resta il target; la ripristina
  quando cambia target o si esce dalla modalità.
- Swappa `weaponGroup` sull'arma del target (`switchWeaponModel(wk)`,
  funzione già esistente) — il viewmodel FP diventa quello osservato.
- Sull'evento "shot fired" del target corrente: richiama
  `playMuzzleFlash()`, applica `recoilPitch/recoilYaw`, `Sfx.shoot(wk)` —
  esattamente come per uno sparo locale.

Punto di ingresso unico per disattivare input/simulazione locali mentre la
modalità è attiva: un singolo check `if (PovController.active) return` in
cima a `updateMovement`, `tryShoot`, `enterADS/exitADS` — non flag sparsi
in più punti.

### C. Flusso di gioco

- **Ingresso**: in `socket.on('playerKilled', ...)`, se
  `killedColor === MY_COLOR` e `subphase === 'suddendeath'`, invece del
  vecchio dead-screen a piena schermo: scelgo il target iniziale (il
  killer, se ancora vivo; altrimenti il primo vivo per ordine di colore) e
  chiamo `PovController.enter(target)`. Il dead-screen diventa un banner
  non invasivo sovrapposto alla vista POV ("Sei stato eliminato — stai
  osservando `<colore>`").
- **Switch manuale**: `ArrowLeft`/`ArrowRight` (solo se `PovController.active`
  e più di un vivo) → precedente/successivo in
  `Object.values(gameState.players).filter(p => !p.dead)`, ordine stabile
  per colore, wrap-around.
- **Morte del target osservato**: in `playerKilled`, se
  `killedColor === PovController.targetColor` → `setTarget()` automatico
  sul prossimo vivo (stesso ordine), nessuna interruzione visiva.
- **Un solo sopravvissuto**: quando `alive.length === 1`, il target è
  forzato su di lui per tutti gli spettatori; i tasti freccia non hanno
  effetto finché non finisce il round.
- **Uscita**: su `roundEnd`, `PovController.exit()` — ripristina
  camera/arma/HUD locali e richiude il banner, pronto per il round
  successivo (weapon-select o game-over seguono il flusso invariato).

### D. HUD

- Riuso degli elementi esistenti (`hud-weapon-name`, barra vita, munizioni,
  minimap) invece di crearne di nuovi.
- Ad ogni cambio target: swatch colorato del giocatore osservato (coerente
  con la convenzione "nessun nameplate, solo colore"), nome arma, HP
  corrente (già disponibile), munizioni (nuovo campo `am`).
- Minimap: nessuna modifica al suo codice — riceve semplicemente
  posizione/rotazione del target invece che le proprie.

## Gestione errori / casi limite

- Target che si disconnette mentre è osservato (`playerLeft`): trattato
  come morte ai fini dello switch automatico (stesso path di
  `killedColor === PovController.targetColor`).
- Nessun vivo disponibile all'ingresso in spettatore (caso limite: tutti
  morti nello stesso istante) → il round finisce comunque (`checkRoundEnd`
  invariato), lo spettatore non fa in tempo a mostrarsi o si chiude subito
  su `roundEnd`.
- Riconnessione (`reconnect` → `joinFPS` → `fpsInit`) durante lo spettatore:
  già gestita dal flusso esistente di resync fase/round; `PovController`
  riparte da capo con `enter()` se il resync conferma sudden death e morte.

## Fuori scope (qui)

- Play of the Round (buffer di registrazione, scoring degli highlight,
  playback) — spec futura separata, che riuserà `PovController` con
  `source: 'buffer'`.
- Camera libera/fly-around per lo spettatore — esplicitamente escluso dal
  requisito 2.

## Verifica (utente, in localhost, due tab)

1. Round in sudden death: un giocatore muore → entra subito in spettatore
   sull'altro vivo, visuale in prima persona coerente (posizione, mira,
   arma in mano) con quanto sta facendo davvero il giocatore osservato.
2. Con 3+ giocatori: tasti freccia cambiano target, HUD (colore/arma/hp/
   munizioni) si aggiorna ad ogni cambio.
3. Il giocatore osservato spara: chi guarda vede/sente muzzle-flash,
   rinculo e SFX in sincronia (anche sui colpi a vuoto).
4. Il giocatore osservato muore: switch automatico al prossimo vivo senza
   schermate nere.
5. Resta un solo vivo: tutti gli spettatori lo seguono, frecce inattive.
6. Fine round: uscita pulita dalla modalità, HUD/camera normali al round
   successivo, nessuna regressione sulla mischia (dove lo spettatore non
   deve mai attivarsi) né sul flusso normale di respawn/round-end esistente.
