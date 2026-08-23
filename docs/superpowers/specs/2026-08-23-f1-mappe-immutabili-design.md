# F1 — Mappe immutabili (blocco B)

**Data**: 2026-08-23
**Blocco**: B della scomposizione concordata il 2026-08-23
**Prerequisito**: nessuno. È indipendente dal blocco A.

## Il punto

L'utente lo ha ripetuto sei volte in un messaggio solo: **«non voglio
modificare niente di prova»**. Oggi non può ottenerlo, perché la
scenografia di ogni circuito non è un dato: è il *risultato* di un
algoritmo condiviso. Correggere un difetto di posizionamento per
melbourne cambia anche monte-rosso, new-monza e prova, e nessuno se ne
accorge finché non si riapre quella pista.

Questo blocco rompe quel legame per **una** pista alla volta: quella che
hai validato smette di essere ricalcolata e diventa un dato.

È l'abilitatore del blocco C (i bug di scenografia) e del blocco D
(l'editor): finché ogni correzione è una roulette su tutte le piste, non
si può aggredire né l'uno né l'altro.

## Cosa ha chiesto l'utente

Dal messaggio del 2026-08-23:

> «creo la mappa con l'editor → la valido facendo un giro e accertandomi
> che tutto sia a posto → le rendo un qualcosa di immutabile […] così che
> se poi modifico l'algoritmo di posizionamento degli asset o di
> creazione della pista, io ho comunque memorizzata la mappa per come la
> volevo e non rischio di fare delle modifiche per risolvere qualche bug
> in una pista e poi mi ritrovo un'altra mappa modificata o con bug.»

Tre decisioni prese il 2026-08-23, dopo la ricognizione:

1. **Cottura in un file**, non versione dell'algoritmo per pista. La
   seconda strada obbligherebbe il codice a tenere tutte le versioni
   vecchie per sempre.
2. **Solo `prova`.** Le altre piste nuove sono sacrificabili: l'utente le
   rifarà con l'editor nuovo. `monte-rosso` non si congela.
3. **Nessun rename** in questo blocco: è indipendente e si fa quando si
   vuole.

## Cosa c'è già, e i numeri che decidono il disegno

Verificato il 2026-08-23.

- **La scenografia è deterministica.** Zero `Math.random` in tutti e
  diciotto i moduli `frontend/shared/scenery*.js` + `trackScenery.js`. La
  pseudo-casualità c'è ma è **seminata dall'id del tracciato**
  (`mulberry32(hashString(trackData.id))`): stessa pista, stesso
  algoritmo, stesso layout. **Non c'è nessuna casualità da catturare**, e
  la cottura è quindi esatta.
- **`trackScenery.js` è un modulo puro**, dichiaratamente «nessuna
  dipendenza da Three.js o il browser». `generateLayout(...)` restituisce
  **solo dati**: un elenco di voci `{ asset, category, x, y, z, rotY,
  scale }`. Si può cuocere in Node.
- **La ricetta headless esiste già**: `backend/tools/f1-costo-scenografia.js`
  (righe 71-77) chiama `generateLayout` fuori dal browser, con gli
  ancoraggi letti da `grandStandSeats.json` e `terraceAnchors.json`. Il
  cuocitore la copia, non la reinventa.
- **Lo schema del file precalcolato esiste già**: le racing line dei bot
  (`prova-raceline.json`, caricate da `trackLoader.loadRacelineData`)
  sono esattamente questo — un artefatto generato una volta e riletto.
- **Peso misurato su `prova`**: 7667 voci.

  | formato | grezzo | gzip |
  |---|---|---|
  | oggetti, 3 decimali | 1037 KB | 184 KB |
  | oggetti, 2 decimali | 734 KB | 76 KB |
  | **compatto, 2 decimali** | **264 KB** | **64 KB** |

  Il formato compatto è una tabella di asset (46 distinti) e categorie
  (14), più una riga di numeri per voce. Due decimali su coordinate in
  unità di gioco valgono il centimetro: sotto la soglia del visibile.

- ⚠️ **`generateLayout` dipende anche da `gridSize`**, che arriva dalla
  lobby: cambia quanti box dei piloti occupano la corsia, e quale
  scenografia viene esclusa attorno a loro. Misurato su `prova`: fra
  gridSize 1 e 10 cambiano da 3 a 7 voci su 7667 — poche, ma il layout
  **non è identico**. Una cottura è quindi valida **per un gridSize**.

## Il disegno

### 1. Il cuocitore

Uno strumento da riga di comando, sorella di quelli che ci sono già:

```
node backend/tools/f1-cuoci-scenografia.js prova --grid=6
```

Genera il layout con la stessa chiamata di `f1-costo-scenografia.js` e
scrive `frontend/tracks/prova-scenografia.json`: accanto al file della
pista, servito staticamente come lui.

### 2. Il formato

```json
{
  "pista": "prova",
  "gridSize": 6,
  "impronta": "…",
  "cottaIl": "2026-08-23T…",
  "assets": ["tree_a", "grandstand", …],
  "categorie": ["natura", "tribune", …],
  "voci": [[0, 1, 12.34, 0, -8.9, 1.57, 1], …]
}
```

`voci` è `[indiceAsset, indiceCategoria, x, y, z, rotY, scale]`.

### 3. Chi la usa, e quando NON la usa

`f1.js` prova a caricare il file cotto prima di generare. Lo usa **solo
se tutte e tre queste cose tornano**; altrimenti genera come oggi e lo
scrive nella console:

- la **pista** è quella giusta;
- il **gridSize** coincide con quello della partita;
- l'**impronta** del tracciato coincide.

Il fallback non è una scorciatoia: è ciò che rende la cottura
un'ottimizzazione sicura invece di una fonte di verità che può mentire.

### 4. L'impronta: il rischio vero

Il pericolo di questo blocco non è che l'algoritmo cambi — quello è il
motivo per cui lo facciamo. È che cambi **il tracciato** e la cottura
resti indietro: la scenografia sarebbe disposta attorno a una pista che
non c'è più, con tribune dentro la carreggiata. Sarebbe esattamente il
difetto che stiamo cercando di eliminare, prodotto dalla cura.

Quindi la cottura registra un'**impronta** dei campi del `.json` che
influenzano la scenografia — punti di controllo, larghezza, corsia box,
traguardo — e se non coincide il file cotto viene **ignorato**, non
usato a metà.

Una pista congelata resta modificabile: la si modifica e la si ricuoce.
Congelata vuol dire «non cambia da sola», non «non si tocca più».

### 5. Scongelare

Cancellare il file. Nessun comando, nessuno stato altrove.

## Come si verifica

- **La cottura è esatta**: un test che cuoce `prova`, la rilegge e
  confronta voce per voce col layout generato. Se diverge, il formato
  compatto o l'arrotondamento hanno perso qualcosa.
- **L'impronta morde**: un test che cuoce, cambia un punto di controllo e
  verifica che il file venga rifiutato.
- **Il gridSize morde**: cotta a 6, richiesta a 4, viene rifiutata.
- **Nessuna cottura = comportamento di oggi**: è la garanzia di
  non-regressione per tutte le altre piste.
- **A schermo**: `prova` con e senza il file cotto deve essere
  indistinguibile. Il modo per vederlo senza fidarsi del codice è il
  contatore di `f1-costo-scenografia.js` (stesse istanze per categoria) e
  uno sguardo in gioco.

## Cosa resta fuori

- **Congelare le altre piste.** Lo strumento le accetta tutte, ma in
  questo blocco si cuoce solo `prova`.
- **Il rename di `prova`.**
- **La correzione dei bug di scenografia**: è il blocco C, e questo
  blocco esiste per renderlo sicuro.
- **Congelare la GEOMETRIA della pista** (punti, quote, muro): non serve.
  Quella è già un dato nel `.json`, non un risultato — è la scenografia
  ad essere calcolata.
- **Un'interfaccia per congelare dall'editor**: appartiene al blocco D.
  Qui è una riga di comando.

## Le tre fasi

1. **Il cuocitore e il formato** — strumento, scrittura, test che la
   cottura è esatta.
2. **Il caricamento e i tre rifiuti** — `f1.js` usa il file quando torna
   tutto, e genera quando no.
3. **Cuocere `prova`** — e verificare a schermo che sia indistinguibile.

## Nota a margine, fuori blocco

Misurato mentre si valutava il peso del file cotto: la pagina F1 serve
**1207 KB** di JS/CSS/HTML ad ogni caricamento, e il server **non ha
nessun middleware di compressione**. Con `compression` scenderebbero a
**382 KB** (−68%), e il file cotto da 264 a 64 KB. Sono due righe e una
dipendenza, non c'entrano con questo blocco, e valgono più di qualunque
ottimizzazione fatta finora sul caricamento — soprattutto per chi gioca
da hotspot, che è il caso in cui l'utente ha riferito lentezza.
