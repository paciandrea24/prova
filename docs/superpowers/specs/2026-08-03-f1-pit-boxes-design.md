# F1 — box (garage) per giocatore lungo la corsia box

## Contesto

Oggi la corsia box ha un solo punto di sosta condiviso (`track.pitBoxIndex`,
un punto di controllo grezzo di `pit.path`): tutti i piloti che vanno ai box
si fermano fisicamente nello stesso punto (`TrackMeshBuilder.buildPitLane`
disegna lì un semplice rettangolo giallo semitrasparente come marcatore, non
un modello 3D). L'utente ha creato in MagicaVoxel un modello di garage/box
(`C:\Users\pacia\Desktop\box obj-0.glb`) e vuole: un box per giocatore,
colorato dinamicamente col colore scelto in lobby, distribuito
correttamente lungo la corsia box.

Il modello (ispezionato con un render headless Blender): mesh voxel unica,
material a texture-palette (stessa tecnica della livrea auto: piccola
texture con tutti i colori, non `material.color` diretto). Tetto rosso +
righe rosse sulle pareti, pareti bianche, base grigio scura (apertura del
box), insegna gialla "PROJECT-W" fissa sul frontale. Dimensioni ~6.2×6×2.8m.

La griglia F1 riempie sempre fino a `MAX_GRID_SIZE` piloti totali
(umani+bot, oggi 6, `backend/sockets/games/f1Bot.js`) — ma il numero di box
generati deve seguire il numero *effettivo* di piloti in partita
(`game.grid.length`), non una costante fissa, così se in futuro cambia il
numero massimo di giocatori il sistema si adatta senza modifiche.

Verificato su tutte le piste esistenti (`new-monza`, `monte-rosso`, `baku`,
`prova`): margine di 70m+ su entrambi i lati dell'attuale `boxIndex` lungo
la corsia box campionata — ampio spazio per distribuire i box
automaticamente, nessuna modifica manuale ai file `.json` delle piste.

## Cosa NON cambia

- Il minigioco di reazione pit stop, la scelta mescola/riparazione, la
  durata sosta: invariati. Cambia solo *dove* fisicamente si ferma l'auto.
- Nessuna modifica al track editor: i box sono generati automaticamente dal
  punto `boxIndex` già esistente, non richiedono un'authoring per pista.

## 1. Calcolo posizioni box (nuovo, modulo condiviso frontend/backend)

Nuova funzione in `frontend/shared/trackGeometry.js` (già isomorfo, richiesto
sia da frontend che da `backend/sockets/games/f1GameSocket.js`/`trackLoader.js`
senza dipendenza da Three.js):

```
pitBoxAnchors(pitPath, boxIndex, count) → [{ x, z, angle }, ...]  // length === count
```

- Campiona `pitPath` (come già fa `sampleOpenPath`), centra `count` posizioni
  equispaziate attorno al punto `boxIndex`, spaziatura fissa (~8m, poco più
  della larghezza del modello) lungo la direzione della corsia.
- `angle` = orientamento tangente alla corsia in quel punto, così il box
  guardi verso la corsia.
- Funzione pura, deterministica: stesso `pitPath`/`boxIndex`/`count` →
  stesso risultato sempre. Nessuna dipendenza da PRNG.
- Se `count` è molto piccolo (es. 2 box) restano centrati sullo stesso punto
  medio; se in futuro `count` crescesse molto oltre il margine disponibile
  (70m+ oggi), la spaziatura resta fissa e i box si estendono più lontano
  dal boxIndex — nessun clamping artificiale, dato il margine ampio
  verificato su tutte le piste attuali.

## 2. Assegnazione box → giocatore

Ordine di griglia: `game.grid[i]` → `pitBoxAnchors(...)[i]`. Riusa lo stato
di griglia già esistente (nessuno stato nuovo), coerente gara per gara con
il risultato qualifica (pole vicino al centro della fila di box, a scendere).

## 3. Ricolore del modello (frontend, nuovo `frontend/shared/pitBoxLoader.js`)

Stesso schema di `carLoader.js::recolorLiveryTexture` (texture-palette, non
`material.color`): si classificano i texel "rossi" (tetto + righe) per
tonalità/saturazione, calibrate campionando la palette reale del modello
(soglie misurate ad-hoc su questo asset, non riusate da quelle dell'auto —
palette diversa). Si ritinge SOLO quei texel col colore giocatore
mantenendo l'ombreggiatura già cotta nella texture (stessa tecnica: hue dal
colore target, saturazione/valore dalla texture sorgente). Pareti bianche,
base grigia e insegna "PROJECT-W" restano invariate.

Ogni box è un `GLTFLoader.load()` indipendente con la propria texture
clonata e ricolorata — niente `InstancedMesh`/materiale condiviso come per
la scenografia decorativa (`loadScenery` in `f1.js`), perché ogni box ha un
colore diverso.

Asset copiato in `frontend/assets/custom/f1PitBox.glb` (stessa cartella di
`f1Car.glb`).

## 4. Backend — instradamento pit stop per-box

`f1GameSocket.js` oggi manda tutti i piloti allo stesso `track.pitBoxIndex`
(vedi `updatePitAutopilot`/`completePitStop`). Cambia in:

- Ad ogni pilota viene assegnato un anchor (da `pitBoxAnchors` con lo stesso
  `count`/ordine del punto 2), calcolato una volta per gara (in
  `assignGridSpawns`, insieme al resto dello stato di inizio gara).
- L'autopilota segue comunque `track.pitPath` waypoint per waypoint come
  oggi (stessa logica di ingresso/uscita), ma il waypoint di arrivo finale
  (dove oggi confronta `p.pitPathIndex === track.pitBoxIndex`) diventa la
  posizione dell'anchor assegnato al pilota, non l'indice condiviso.
- Risultato: due piloti ai box contemporaneamente non si sovrappongono più
  nello stesso punto fisico.

## 5. Decluttering scenografia esistente

`buildPaddockLayout` in `trackScenery.js` sparge oggi, lungo la corsia box,
edifici decorativi Kenney (`pitsGarageClosed`/`pitsOffice`, a intervalli
regolari lungo TUTTA `pitPts`) e, nella finestra vicino al rettilineo di
partenza, cartelloni sponsor (`billboard`/`billboardLow`) — che possono
cadere vicino alla corsia box quando questa corre parallela al rettilineo
(caso comune). Entrambi i loop vanno estesi con un controllo di clearance
verso gli anchor dei box giocatore (stesso pattern già usato in quella
funzione per scartare cartelloni troppo vicini alla corsia box stessa):
uno slot troppo vicino a un anchor viene scartato invece di ricollocato.

## Testing

- Playtest in localhost con almeno 2 tab (per vedere box altrui colorati
  correttamente da un altro giocatore) su almeno una pista esistente.
- Verifica visiva: colore corretto per box (rosso→colore giocatore, resto
  invariato), nessuna sovrapposizione con edifici/cartelloni decorativi,
  orientamento box verso la corsia, autopilota che ferma ogni auto nel
  proprio box senza sovrapposizioni.
- Nessun test automatico nuovo previsto oltre al playtest: la logica di
  posizionamento (`pitBoxAnchors`) è pura e deterministica, si presta a un
  piccolo test unitario se si vuole (verificare `length === count`,
  spaziatura, nessun punto fuori dai limiti del path) ma non è strettamente
  necessario per una feature visiva di questa portata.
