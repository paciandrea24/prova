# F1 — Il nastro orientato: banking e giro della morte

**Data:** 2026-08-25
**Branch:** worktree dedicato (NON `f1-stagioni`, NON `main`)
**Blocco:** D della carrellata 2026-08-23 — ultima voce insieme alla corsia box

---

## Perche' questa spec copre DUE cose

Il banking e il giro della morte si potevano fare in due progetti separati, e la
scelta e' stata deliberatamente l'opposto: **si progettano insieme, si
implementano in fasi**.

Il motivo e' verificabile, non di gusto. Se progettando il loop si scopre che il
banking andava fatto diversamente, lo si scopre **prima di aver scritto una riga
del banking**. Il rischio che questa spec esiste per eliminare e' che il banking
diventi una toppa da rifare — preoccupazione posta dall'utente in questi
termini: «che questo approccio sia una toppa temporanea ed una sorta di
implementazione per cui io mi devo accontentare».

La verifica di quel rischio e' l'inventario di cosa si cancella il giorno del
loop. Risposta: **niente**. Il rollio per punto e' il dato che il loop usa (oltre
i 90 gradi); il generatore del nastro e' quello che chiude il tubo; la gravita'
lungo il nastro e' la stessa formula dentro e fuori; la tenuta corretta dal
rollio serve a Zandvoort per sempre, loop o no.

---

## Da dove si parte (lo stato di oggi, verificato)

1. **La fisica del server e' 2D pura.** In `f1GameSocket.js` non esiste una sola
   `y`: niente pendenza, niente gravita'. Quota e beccheggio sono **solo
   visivi**, li mette il client in `f1.js:6150-6158` agganciandosi al
   `trackIndex` che il server manda.
2. **Il server ragiona gia' in coordinate del nastro, senza chiamarle cosi'.**
   `CollisionResolver.js:93` (`applyBarrier`) prende
   `nearestIndexNear(points, p.trackIndex, ...)` — *quanto avanti sono* — e poi
   `dist` lungo la normale — *quanto sono di lato*. Quella coppia **e'** (s, u),
   ricalcolata ad ogni tick.
3. **Il muro rigido esiste gia' lungo tutto il giro**, con un profilo di distanza
   per campione e per lato (`TrackGravel.barrierAt(profile, idx, side)`). Il tubo
   del loop non e' un meccanismo nuovo: e' quel profilo che vale anche in alto.
4. **`bridge` e' un flag per punto** che gia' sospende terreno, erba e scenografia
   su un tratto (`TrackGeometry.splitByBridge`). Il tratto acrobatico e' un ponte
   che ruota. *(Idea dell'utente, verificata e adottata.)*
5. **`corneringCapacity(p, isQuali, maxSpeed)`** in `CorneringGripModel.js:36` e'
   il **posto unico** della tenuta in curva, ed e' gia' la funzione che consulta
   anche il bot — estratta apposta per non duplicare la formula. Il banking
   innesta li' e **i bot lo ereditano senza toccare le loro 83 KB**. E'
   esattamente il debito che la larghezza variabile aveva lasciato aperto.
6. **Non esiste un respawn in gara**: il muro rigido garantisce che non si esca
   mai dal mondo, quindi non e' mai servito. Vincolo di progetto: la fase 2 non
   deve avere bisogno di inventarne uno.

---

## Le decisioni prese con l'utente

### D1 — Attorno a cosa ruota la pista: **si alza l'esterno**

Il bordo interno resta alla quota che ha, l'esterno sale. E' come si costruisce
una sopraelevazione vera. La quota del punto (`p.y`) resta quella del **bordo
interno**, quindi il nastro si appoggia sopra il terreno che c'e' gia' e non lo
buca mai. Scartate: rotazione attorno alla mezzeria (scava una trincea sul lato
interno) e abbassamento dell'interno (idem, e nel tubo non vorrebbe dire nulla).

### D2 — Cosa c'e' ai bordi: **in alto muro, in basso il mondo normale**

Sul lato alto il muro sta subito dopo il cordolo — regola dei ponti: oltre c'e'
il fianco del cuneo, non un posto dove atterrare. Sul lato basso restano erba,
ghiaia e via di fuga **con il muro in fondo**, che e' cio' che il codice fa gia'
lungo tutto il giro. Nessun lato resta aperto (richiesta esplicita dell'utente).

### D3 — Non si cade mai, ma **la gravita' agisce lungo il nastro**

Obiezione dell'utente, decisiva: se l'auto si stacca a testa in giu' bisogna poi
girarla. La «caduta» non e' cadere, e' il **volo** — rotazione libera,
atterraggio, ribaltamento, e infine un ripristino per rimettere dritta un'auto
capovolta nel prato. Un sottosistema intero per produrre soprattutto situazioni
brutte.

La cura tiene entrambe le cose: **l'auto resta sempre incollata al nastro, e la
gravita' agisce lungo la direzione di marcia**. Salire costa velocita', scendere
la restituisce. Le conseguenze vengono da sole:

- arrivi lanciato al loop → lo passi;
- arrivi piano → rallenti salendo, ti fermi e **riscendi all'indietro**;
- freni a testa in giu' → non cadi: la gravita' ti porta giu' dal lato verso cui
  stai pendendo.

Nessun volo, nessuna auto da raddrizzare, nessun ripristino da inventare — e il
loop resta **una cosa da prendere bene**, che era il punto.

### D4 — La gravita' vale **anche sulle salite normali**

Scelta dell'utente. Cambia il comportamento di TUTTE le piste esistenti, quindi
diventa un pezzo suo (fase 1a) con interruttore e banco di prova, non un effetto
collaterale del banking. Precedente da non ripetere: `TyreSlipModel` e' stato
ribocciato al playtest perche' acceso senza taratura.

### D5 — Il loop e' un **tipo di tratto parametrico**, non si disegna a mano

Visto dall'alto un loop e' un puntino: l'editor 2D non lo mostrerebbe. Si sceglie
il tipo, si danno raggio/gradi/verso, e lo si guarda nell'**anteprima
esplorabile** (blocco E, gia' fatta).

---

## FASE 1a — La gravita' lungo il nastro

**Cosa cambia per chi gioca.** In salita l'auto perde velocita', in discesa la
guadagna. Le colline dei circuiti smettono di essere decorazione.

**Dove.** `VehiclePhysics.updateVelocity(p, isQuali, slipstreamMult)`
(`VehiclePhysics.js:32`): un termine di accelerazione pari a
`-G_NASTRO * sin(pendenza)`, dove la pendenza e' quella del punto pista in cui
l'auto si trova. La pendenza per campione si calcola **una volta sola**, in
`trackLoader`, accanto a `halfWidth` (`trackLoader.js:138-149`) — non ad ogni
tick e non in due posti: e' la stessa formula che il client usa gia' per il
beccheggio visivo (`f1.js:584`, `trackPitchAt`).

**Interruttore.** `F1_GRAVITA_NASTRO`, stessa forma degli altri flag di modello.
Default **acceso solo dopo la taratura**; fino ad allora spento.

**Taratura e verifica.** Banco: `f1LapSimulator`, N=30 (e' rumoroso, un run
singolo ha gia' fatto perdere tempo due volte). ⚠️ La metrica NON e' il tempo sul
giro: si misurano **le velocita' nei tratti in pendenza** prima e dopo, su una
pista con dislivelli veri. Un flag di guida si giudica dove agisce.

**Rischio noto.** I bot non sanno della pendenza quando scelgono dove frenare
(`cornerTargetSpeed`): su una curva in fondo a una discesa arriveranno lunghi. Se
la misura lo conferma, si passa la pendenza a `cornerTargetSpeed` — che e' un
parametro in piu', non un modello nuovo.

---

## FASE 1b — Il banking

### Il dato

`rollio` in gradi, positivo = si alza l'esterno. **Massimo 45 gradi**: oltre, il
cuneo di terra diventa una parete e la proiezione sul piano si stringe troppo.
Prende Zandvoort (18) e la Monza vecchia (~38).

- **Nell'editor** e' un campo **per tratto** (vuoto = piano), esattamente come la
  mezza carreggiata.
- **Nel file** viaggia **sul punto**, cotto da `TrackSegmenti.cuoci`
  (`trackSegmenti.js:117`, dove gia' si scrive `p.halfWidth`) e interpolato con
  la stessa smoothstep di quota e larghezza. Niente array paralleli che si
  disallineano.
- **A valle** lo riempie **un posto solo**, `trackLoader`, come si e' fatto per
  `halfWidth`: cosi' nessuno a valle inventa ripieghi. Un ingombro di ripiego
  silenzioso falsifica ogni controllo a valle.
- Le piste **senza rollio restano identiche a oggi**, per sempre e senza
  conversioni.

### Il mondo

- **Nastro, cordoli, scacchiera**: `trackMeshBuilder` gia' estrude un profilo
  lungo il tracciato; gli si aggiunge la rotazione attorno al bordo interno.
- **Cuneo di terra sotto**: e' il terrapieno che si sa gia' generare, con quota
  diversa sui due lati.
- **Muro**: sul lato alto il profilo barriera si porta subito dopo il cordolo
  (regola dei ponti); sul lato basso invariato.
- **Scenografia ed erba non salgono sul fianco**: sul tratto banked valgono le
  esclusioni dei ponti (`splitByBridge`).

### La guida

- **Un solo innesto**: `corneringCapacity` moltiplicata per un fattore che
  dipende dal rollio del punto. I bot lo ereditano gratis (stato di oggi, punto 5).
- Il rollio arriva su `p` accanto a `p.trackIndex`, **scritto da un posto solo**
  (`updateTrackIndex`).
- **Auto e camera** ruotano del rollio: si riusa il `rotateZ` dopo `lookAt` che
  l'halo-cam gia' fa (`f1.js:5902-5904`) — il rollio va DOPO `lookAt`, o ruota
  attorno all'asse sbagliato.

### Limite dichiarato in anticipo

In fase 1b l'auto **non scivola verso il basso** se rallenta su una parabolica.
La fisica non ha moto laterale libero: l'auto va dove punta il muso. A 18 gradi
non si nota; a 38 chi si ferma resta appeso sul fianco. Accettato dall'utente.
(La gravita' *lungo* il nastro invece c'e', ed e' la fase 1a.)

### Editor e validatore

- Campo «sopraelevazione» nella scheda Tratto, accanto a mezza carreggiata.
- Il validatore (`trackValidatore.controllaGeometria`) aggiunge: rollio oltre il
  massimo (impedisce), salto di rollio troppo brusco fra due tratti adiacenti (da
  guardare). ⚠️ Soglie **per unita' di pista**, mai per campione.

---

## FASE 2 — Il tratto acrobatico (il giro della morte)

### Cos'e'

Un tratto del modello a segmenti di tipo `acrobatico`, parametrico: raggio, gradi
di rotazione (360 per il loop pieno), verso. I punti li genera il sistema.

### La regola che rende tutto continuo

**Un tratto acrobatico deve iniziare e finire a rollio zero, tangente alla pista e
con la quota che combacia.** Il validatore lo impedisce altrimenti. E' questa
regola — non un raccordo speciale — a far si' che il passaggio fra i due regimi
non abbia scatti: agli estremi le due descrizioni coincidono.

### Dentro

- L'autorita' della posizione passa a **(s = quanto avanti sul nastro, u = quanto
  di lato)**. Fuori dai tratti acrobatici resta xz, con (s, u) derivata come oggi.
  **Il cambio di regime e' locale a un tratto**: e' la ragione per cui questo
  progetto non costa mesi. La riscrittura globale — che trascinerebbe fuoripista,
  collisioni, bot e minimappa — non si fa, e non serve.
- Non c'e' un modello nuovo da inventare: `p.speed` e' **gia'** una velocita'
  scalare lungo il tracciato, e `p.trackIndex` gia' esiste. Si sposta l'autorita',
  non si cambia la rappresentazione.
- **Niente fuoripista** per costruzione: dentro il tubo non esiste erba ne'
  ghiaia. E' cio' che rende il regime contenibile — e la ragione per cui NON si
  puo' adottare (s, u) su tutto il gioco, che il fuoripista libero ce l'ha.
- **Gravita' lungo il nastro**: la stessa della fase 1a, gia' tarata.
- **Terreno, erba e scenografia sospesi**, con la regola dei ponti.

### Intorno

- **Camera**: segue l'orientamento del nastro fino a capovolgersi. Prima persona
  nei tratti rovesciati.
- **Bot**: nel tratto acrobatico non frenano e ci arrivano col massimo che hanno.
  La velocita' minima per completarlo si calcola dal raggio, e il validatore
  avvisa se il rettilineo che precede non basta a raggiungerla.
- **Giri, settori, penalita'**: nessuna modifica. Si contano su `trackIndex`, che
  dentro il tubo esiste ancora.
- **Planimetria/minimappa**: un loop in pianta e' un puntino. Va marcato con un
  simbolo, non disegnato — altrimenti la mappa mostra un nodo che non si capisce.

### La cornice di gioco

Il loop non appartiene alla F1 classica. Torna qui la distinzione che l'utente
aveva gia' dettato: **«Classic F1»** (tracciati realistici, niente tratti
acrobatici) e una **seconda categoria fantasiosa** che li ammette. Il tipo di
tratto acrobatico e' consentito solo nella seconda.

---

## Isolamento, verifiche, ordine

**Isolamento.** Worktree dedicato. Richiesta esplicita dell'utente: «non voglio
rompere il gioco esistente e voglio poter ripristinare in caso di problemi
critici». Ogni fase e' un insieme di commit separato e provabile in pista da sola.

**Ordine.** 1a → 1b → 2. Ogni fase si ferma per il playtest dell'utente prima
della successiva, e ognuna avra' il suo piano di implementazione: questa spec e'
il disegno completo, non il piano di una serata.

**Se la fase 1a viene bocciata al playtest**, il flag si spegne per il circuito
normale — ma **dentro il tratto acrobatico la gravita' lungo il nastro resta
accesa comunque**, perche' li' non e' un'opzione di guida: e' cio' che impedisce
di percorrere un loop a passo d'uomo. Il flag decide dove vale, mai se esiste.

**Baseline dei test da cui si parte** (da riconfermare all'apertura del
worktree): `node --test frontend/shared/` → 5 rossi preesistenti;
`node --test backend/` → 8 rossi preesistenti.

**Invarianti da non violare**

- Le piste senza rollio e senza tratti acrobatici devono restare **identiche al
  bit** — verificato da un test, non a occhio.
- Il muro fisico e quello disegnato vengono dalla stessa funzione. Vale anche per
  il muro alto del banking e per il tubo.
- Una cosa, una misura: il rollio che il giocatore vede e quello che il server usa
  per la tenuta sono **lo stesso numero**, preso dallo stesso posto.
