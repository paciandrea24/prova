# F1 — bot IA per riempire la griglia a 6 piloti

## Contesto

Le gare F1 partono con tanti piloti quanti sono i giocatori umani in lobby
(1-12, un colore ciascuno dalla palette). L'utente vuole poter correre sempre
con una griglia piena di 6 auto: se è da solo, +5 bot; in due, +4; e così via.
Questo documento definisce come i bot vengono creati, come guidano, gestiscono
gomme/pit stop, e come si integrano in lobby e HUD.

Architettura di riferimento esplorata prima del design (server-authoritative,
tick a 20Hz):

- `backend/sockets/games/f1GameSocket.js` — stato di gioco, tick loop
  (`PHYSICS_TICK_MS=50`), `game.players` (oggetto piatto keyed per colore),
  `updateVelocity()`/`integratePosition()` per la fisica, `resolveCollisions()`
  (SAT/OBB) per gli urti, `buildPublicState()` per la proiezione client.
- `backend/sockets/games/trackLoader.js` — carica ogni tracciato e campiona
  1000 punti (`track.points`, con normali/tangenti) via `TrackGeometry.sampleLoop`;
  già usati server-side per `nearestPoint`/`nearestIndexNear`.
- Input giocatore: evento socket `f1Input` → `game.players[color].inputs =
  {throttle, brake, steer}` (clampato server-side), consumato da
  `updateVelocity()`. Non esiste una via privilegiata per iniettare
  posizione/velocità direttamente: un bot "indistinguibile" deve produrre
  solo input, come un umano.
- `frontend/f1.js` — riceve `f1StateUpdate`, istanzia un modello auto per ogni
  colore presente nello stato, distingue solo `color === myColor` per HUD/
  modello proprio. Un bot appare automaticamente come un giocatore normale se
  è presente in `game.players` con la stessa struttura dati.

Nessuna traccia preesistente di bot/AI/CPU nel codice F1.

## Approccio scelto e alternative scartate

**Guida — pure pursuit su `track.points` + velocità da curvatura locale
(scelto).** Ogni tick il bot cerca il punto più vicino sulla racing line già
campionata dal tracciato, punta a un target un po' più avanti lungo il
percorso (lookahead) per ricavare lo `steer`, e limita il throttle/brake in
base alla curvatura dei punti nei prossimi metri (rettilineo = a tutta, curva
stretta = rallenta in anticipo). Riusa dati e algoritmi già presenti
server-side (stessa fonte usata da `nearestPoint`), quindi funziona
automaticamente su qualsiasi tracciato (`interlagos.json`, `nuova-pista.json`,
futuri) senza autoring aggiuntivo per bot.

**Scartata — linea fissa + velocità scalare per difficoltà.** Bot che seguono
sempre il centro pista con una velocità massima moltiplicata per un fattore di
difficoltà, senza guardare la curvatura in anticipo. Più semplice ma frena
tardi/sbanda in curva in modo poco credibile; scartata su indicazione
dell'utente in favore di un comportamento che segue la pista in modo più
realistico.

**Evasione altre auto — nessuna logica esplicita in v1 (scelto).** Il bot
punta sempre alla sua racing line; il contatto fisico con altre auto è
comunque gestito da `resolveCollisions()` (già usato per tutti i giocatori).
Limite noto: in curve strette con più bot vicini potrebbero "spingersi"
invece di sorpassare puliti. Accettato come punto di partenza semplice,
osservabile e migliorabile dopo il primo playtest, invece di costruire ora
una logica di evasione/sorpasso che aggiungerebbe complessità non richiesta.

## Design

### Creazione bot e riempimento griglia

Alla fine della fase mescola (fine `f1TyreChoice`/scadenza
`TYRE_SELECT_MS`), il server conta i giocatori umani nella lobby. Se il
toggle lobby `botsEnabled` è `true` (default), crea `6 - umani` entry bot
(zero se già 6+ umani). Ogni bot riceve un colore libero scelto a caso tra
quelli della palette non selezionati da giocatori reali, e viene inserito in
`game.players` con la stessa struttura dati di un giocatore umano più un
flag `isBot: true`. Il riempimento è **fisso all'inizio gara**: se un umano
si disconnette a gara in corso il suo slot resta vuoto, nessun bot subentra
a metà corsa.

### Guida (pure pursuit + curvatura)

Nuovo modulo `backend/sockets/games/f1Bot.js`, invocato dal tick loop di
`f1GameSocket.js` prima di `updateVelocity()`: per ogni colore con
`isBot: true`, calcola e scrive `inputs.{throttle, brake, steer}` esattamente
come farebbe l'evento `f1Input` di un umano — zero modifiche alla fisica
esistente.

- **Steer**: trovato il punto più vicino su `track.points`, il bot mira a un
  punto lookahead (distanza da tarare, es. qualche metro oltre la posizione
  attuale) e calcola l'angolo verso quel target.
- **Throttle/brake**: guardando la curvatura dei punti nei prossimi N metri
  di lookahead, calcola una velocità target (bassa in curva stretta, alta in
  rettilineo) e applica throttle o brake in base al confronto con la velocità
  attuale.
- **Partenza**: il bot rispetta il semaforo come un giocatore umano (niente
  throttle prima del verde), per non incorrere nella penalità `falseStart`
  già esistente per i giocatori reali.

### Difficoltà mista per bot

Alla creazione, ogni bot pesca a caso in un range (da tarare in test in
localhost):

- `speedFactor` (es. 0.85–1.05×) applicato alla velocità target calcolata
  dalla curvatura — alcuni bot risultano più lenti, uno o due più veloci
  dell'"ideale".
- `precisionNoise` — piccolo errore casuale su steer/lookahead — bot con
  noise alto tagliano peggio le curve, quelli con noise basso guidano più
  puliti.

Nessuna selezione di difficoltà in lobby: i bot di una stessa gara sono già
eterogenei tra loro per costruzione.

### Gomme e pit stop automatico

Alla creazione ogni bot sceglie una mescola iniziale con la stessa logica/
casualità disponibile per un umano. Ad ogni tick controlla il proprio
`tyreWear`; superata una soglia (es. 70%, da tarare in test) il bot smette
temporaneamente di seguire `track.points` e segue invece `game.pit.path`
(waypoint della corsia box già definiti nel tracciato) fino a completare il
pit stop, poi torna sulla racing line con una nuova mescola scelta con una
regola semplice basata sui giri rimanenti (pochi giri residui → gomma più
dura per arrivare in fondo; altrimenti media/soft). Riusa la via di ingresso
pit già presente per i giocatori umani — nessuna nuova macchina a stati
lato server oltre a "quale set di waypoint sto seguendo ora".

### Lobby: toggle bot on/off

Nuovo controllo "Bot: On/Off" nella UI di creazione/lobby (default On),
salvato sull'oggetto lobby lato server. Se Off, nessun bot viene creato alla
partenza gara indipendentemente dal numero di umani presenti — utile per
test o per correre volutamente in meno di 6.

### Identità visiva: badge CPU in classifica

`buildPublicState()` include `isBot: true` per le voci bot (proiettato al
client insieme agli altri campi già pubblici). In `frontend/f1.js`, il
rendering della classifica mostra un piccolo badge/etichetta "CPU" accanto
allo swatch colore per le righe con `isBot: true`. Nessun nome per i bot (il
gioco non ha nomi giocatore in generale): solo colore + badge. Nessun altro
impatto sul client — il modello auto, la minimappa e il resto dell'HUD
trattano il bot come un giocatore normale, dato che riceve la stessa
struttura dati via `f1StateUpdate`.

## Testing

Verifica manuale in localhost (come da convenzione progetto, step-by-step):

1. Lobby con 1 solo giocatore umano → verificare 5 bot creati, colori liberi
   assegnati, nessun crash del tick loop con 6 auto attive.
2. Bot completano un giro senza uscire di pista né bloccarsi contro le
   barriere (riusa fisica/collisioni esistenti, ma da verificare con NPC
   che non hanno l'accortezza di un giocatore umano).
3. Bot rispettano il semaforo (nessun `falseStart` spurio a inizio gara).
4. Bot entrano ai box quando il degrado gomme supera la soglia e ripartono
   con mescola nuova.
5. Toggle "Bot: Off" in lobby → nessun bot creato, gara con solo umani come
   oggi.
6. Badge "CPU" visibile in classifica solo per le righe bot.
7. Difficoltà mista percepibile: bot non tutti allo stesso ritmo/qualità di
   traiettoria in una stessa gara.
