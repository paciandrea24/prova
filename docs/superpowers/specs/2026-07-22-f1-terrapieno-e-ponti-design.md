# F1 — terrapieno (terreno che segue il dislivello) + fondamenta per ponti

## Problema

Sul tracciato "prova" (che ha un tratto collinare, `y` fino a ~11.5 sui punti
di controllo) si osservano tre bug correlati, tutti riconducibili alla
stessa causa:

1. **Alberi/tribune fluttuanti** sul tratto sopraelevato: `trackScenery.js`
   posiziona ogni oggetto scenico alla quota del punto pista più vicino
   (`nearestPoint(trackPts, x, z).y`), anche quando l'oggetto è a decine di
   unità di distanza dalla pista — sopra un tratto elevato, l'oggetto
   "eredita" la quota pista pur stando visivamente sopra il prato piatto
   sottostante.
2. **Auto che vola fuori pista** sui tratti sopraelevati: la quota visiva
   dell'auto (`frontend/f1.js`, in `animate()`) segue `trackPts[idx].y` dove
   `idx` è il `trackIndex` — l'indice lungo il giro tenuto dal server — a
   prescindere da quanto lateralmente l'auto si sia allontanata dal nastro.
   Fuori pista su un tratto elevato, l'auto resta quindi "appesa" alla quota
   pista invece di scendere verso il prato reale.
3. **Buco verde nelle discese**: il prato di sfondo (`ground` in `f1.js`) è
   un unico piano piatto infinito a quota 0. Se un tratto di pista scende
   sotto 0, il nastro pista finisce sotto il piano del prato, che lo copre —
   si vede erba al posto dell'asfalto.

Causa comune: **non esiste un "terreno" che segua davvero il dislivello
della pista** — il prato è piatto ovunque, e gli unici punti con quota reale
sono quelli della pista stessa.

## Scope di questo documento

Copre due fasi collegate:
- **Fase 1** (da implementare ora): terrapieno/scarpata per dislivelli
  "semplici" (salite, discese, colline) — risolve i 3 bug sopra.
- **Fase 2** (design ora, implementazione in un piano separato successivo):
  ponti/sottopassi veri, cioè un tratto di pista che nella proiezione
  dall'alto (x/z) passa sopra un altro tratto della stessa pista. Il modello
  dati di Fase 1 è pensato per non dover essere rifatto quando si
  implementerà la Fase 2.

Fuori scope in entrambe le fasi: elevazione della corsia box (si assume a
quota costante/rasoterra, come tutte le piste esistenti); tracciati con
tratti che si riavvicinano molto a se stessi a quote diverse SENZA essere
marcati esplicitamente come ponte — stessa ambiguità già accettata altrove
nel codice (vedi commento su `trackIndex` in `frontend/f1.js`, che usa una
ricerca "windowed" proprio per questo motivo); qui il rischio analogo esiste
per il calcolo del terrapieno, con lo stesso compromesso.

## Approccio scelto e alternativa scartata

**Scelto — terrapieno ad anelli concentrici**: si estende la tecnica già
usata da `buildCurbs`/`buildBarriers` (estrusione lungo il tracciato a
distanza fissa dalla centrale, usando `TrackGeometry.normalAt`) con più
"anelli" a distanza crescente dalla pista, la cui quota sfuma dalla quota
pista fino a 0 (prato) entro una distanza di transizione. Riusa
l'infrastruttura esistente (nessuna nuova pipeline), resta coerente con
l'architettura "moduli condivisi puri + niente build step" del progetto.

**Scartata — terreno a heightmap/texture** (una griglia enorme di vertici
deformata da una texture di elevazione renderizzata dall'alto, come la
minimappa del gioco FPS): risultato più organico ma richiede una nuova
pipeline di generazione, molti più vertici, e una sincronizzazione
server/client più delicata. Sovradimensionato rispetto al problema reale
(un tracciato con poche colline, non un terreno collinare naturalistico).

## Fase 1 — Terrapieno per dislivelli semplici

### Funzione unica di quota del terreno

Nuova funzione in `frontend/shared/trackGeometry.js`:

```
terrainHeightAt(groundPts, x, z) -> number
```

- `groundPts`: i punti campionati della pista **esclusi** quelli marcati
  come ponte (in Fase 1, senza ponti nel formato dati, coincide con
  `trackPts` per intero — la funzione è già pronta per la Fase 2 senza
  modifiche).
- Usa `nearestPoint(groundPts, x, z)` per ottenere `{ y, dist }` del punto
  pista "a terra" più vicino.
- Se `dist <= EMBANKMENT_START` (subito oltre la barriera): quota = `y`.
- Se `dist >= EMBANKMENT_OUTER` (distanza di transizione): quota = 0.
- Nel mezzo: smoothstep tra `y` e 0 in funzione della posizione relativa tra
  `EMBANKMENT_START` e `EMBANKMENT_OUTER` (stessa idea di smoothstep già
  usata in `evalSegment` per la quota lungo il tracciato, pendenza nulla ai
  due estremi → nessuno spigolo visibile).
- `EMBANKMENT_START`/`EMBANKMENT_OUTER`: costanti condivise (in
  `trackGeometry.js` o passate da `f1.js`, che già definisce `BARRIER_D`).
  `EMBANKMENT_START = BARRIER_D` (il pendio parte subito oltre barriera/
  cordolo). `EMBANKMENT_OUTER = BARRIER_D + 45` come valore di partenza —
  **da tarare a vista** una volta implementato (pendenza troppo ripida o
  troppo dolce si aggiusta cambiando solo questo numero, nessun impatto
  sulla logica).

Questa unica funzione è il punto di verità riusato ovunque serva "che quota
ha il terreno qui" (mesh del terrapieno, alberi/tribune, auto fuori pista).

### Mesh del terrapieno

Nuova funzione in `frontend/shared/trackMeshBuilder.js`, chiamata da
`f1.js` insieme alle altre `buildX` esistenti. Per un piccolo numero di
anelli concentrici (es. 4) tra `EMBANKMENT_START` e `EMBANKMENT_OUTER`, per
ciascun lato della pista, si estrude lungo `trackPts` (stessa iterazione per
indice già usata da `buildCurbs`), leggendo la quota di ogni vertice da
`terrainHeightAt`. Materiale erba, stesso colore del prato attuale
(`0x3d8b3d`), in modo che il terrapieno sia visivamente continuo col resto
del terreno.

Il prato piatto infinito attuale (`PlaneGeometry(3000,3000)` in `f1.js`)
viene sostituito da un piano con un foro (`THREE.Shape` + `shape.holes`), il
cui contorno è l'anello più esterno del terrapieno (a distanza
`EMBANKMENT_OUTER`, quota sempre 0 per costruzione) — combaciano
esattamente, nessuna sovrapposizione né taglio visibile. Questo è anche ciò
che elimina il "buco verde" nelle discese: non esiste più un piano fisso a
quota 0 che possa tagliare la pista quando scende sotto zero, perché in
quella zona il "terreno" è il terrapieno, che scende con la pista.

Non serve più alzare la quota base dei tracciati (idea iniziale) per
permettere le discese: il terrapieno risolve il problema alla radice, sia
in salita che in discesa.

### Alberi/tribune e auto fuori pista

- `trackScenery.js`: ovunque oggi si legge `nearestPoint(trackPts, x,
  z).y` per la quota di un oggetto scenico, si sostituisce con
  `TrackGeometry.terrainHeightAt(groundPts, x, z)`. Stessa firma di
  chiamata, risultato diverso: la quota ora sfuma verso 0 lontano dalla
  pista invece di restare fissa alla quota pista pura.
- `f1.js`, in `animate()`: quando l'auto è sul nastro, nessuna modifica
  (la quota resta quella dell'indice pista, già corretta). Quando è fuori
  pista (distanza dal centro pista oltre `roadHalf`, stesso criterio già
  usato server-side in `applyOffTrackDrag`), la quota visiva passa da
  `trackPts[idx].y` a `TrackGeometry.terrainHeightAt(groundPts, v.x, v.z)`
  calcolata sulla posizione reale dell'auto — segue quindi il pendio mentre
  l'auto si allontana dalla pista, invece di restare fissa alla quota
  dell'indice.

## Fase 2 — Ponti (design; implementazione in piano separato futuro)

### Modello dati

Ogni punto di controllo della pista principale accetta un campo opzionale:

```json
{ "x": 0, "z": 0, "y": 12, "bridge": true }
```

Un punto **campionato** (dopo `sampleLoop`) è considerato "ponte" se
entrambi i punti di controllo che delimitano il segmento in cui cade sono
`bridge: true`. I punti di transizione (dove la rampa parte da terra verso
il ponte) restano `bridge: false`: lì il terrapieno normale della Fase 1
continua a funzionare, sfumando dolcemente fino all'inizio vero del ponte.
Campo opzionale e retrocompatibile: le piste esistenti (senza `bridge` da
nessuna parte) si comportano esattamente come in Fase 1.

`groundPts` (usato da `terrainHeightAt` e da tutto ciò che ne dipende) è
`trackPts` filtrato per escludere i punti-ponte: il terrapieno/le quote di
alberi e auto-fuori-pista ignorano completamente i tratti-ponte, quindi il
terreno sotto un ponte resta al suo livello reale (che sia prato piatto o un
altro tratto di pista che passa sotto) invece di salire per "incontrare" il
ponte. Questo elimina l'ambiguità sollevata in fase di brainstorming (quale
tratto è "il più vicino" quando due parti della pista si sovrappongono in
pianta): il terrapieno semplicemente non considera mai i punti-ponte come
candidati.

`sampleLoop`/`sampleOpenPath` (in `trackGeometry.js`) devono propagare il
flag `bridge` dai punti di controllo ai punti campionati: un punto
campionato eredita `bridge` dai due punti di controllo che delimitano il
suo segmento (stessa coppia p1/p2 già usata per interpolare la quota `y` in
`evalSegment`), così `trackPts[i].bridge` è disponibile ovunque senza
ricalcoli.

### Prato e terrapieno "a spezzoni" intorno a un ponte

Un dettaglio emerso analizzando l'implementazione concreta (non solo il
principio "il terrapieno ignora i punti-ponte" già sopra): sia il
terrapieno (`buildEmbankment`) sia il buco nel prato (`buildGround`) oggi
si costruiscono percorrendo `trackPts` come un unico giro chiuso e
continuo, indice dopo indice. Se ai punti-ponte si "saltasse" semplicemente
l'indice, il punto subito prima e subito dopo il ponte diventerebbero
adiacenti nella mesh pur essendo lontani nel mondo reale (quanto è lungo il
ponte) — una cucitura storta/a punta esattamente lì, non un vuoto pulito.

Soluzione: `groundPts` non è un singolo array "bucato", ma una sequenza di
**spezzoni** (run) di punti consecutivi non-ponte — un nuovo tratto ponte
chiude uno spezzone e ne apre uno nuovo dopo la sua fine. `buildEmbankment`
e `buildGround` costruiscono la loro geometria per ciascuno spezzone
separatamente (come un nastro aperto, non un anello chiuso); nel punto in
cui uno spezzone finisce e il successivo riprende (cioè ai due estremi di
un ponte), il contorno del terrapieno/prato collega i due capi con un
segmento dritto invece di seguire il percorso del ponte — esattamente il
vuoto che poi impalcato e piloni riempiono visivamente. Se non c'è nessun
punto-ponte sull'intera pista (caso di tutte le piste esistenti oggi), c'è
un solo spezzone che coincide con l'intero giro: nessun cambiamento rispetto
alla Fase 1.

### Impalcato e piloni

In `trackMeshBuilder.js`, per i tratti marcati ponte:
- **Impalcato**: una lastra sottile di cemento (grigio scuro, es.
  `0x4a4a4a`) subito sotto il nastro pista esistente (che continua a
  renderizzarsi come oggi, seguendo la quota dei punti ponte), larga quanto
  pista+cordoli — dà l'idea di uno spessore strutturale invece di un
  nastro sottile fluttuante nel vuoto.
- **Piloni**: cilindri verticali dello stesso grigio, a intervalli regolari
  lungo il tratto ponte (ogni 15-20 unità), dall'impalcato fino a
  `terrainHeightAt(groundPts, x, z)` in quel punto — cioè fino al terreno
  vero sottostante.

Il terrapieno (Fase 1) semplicemente non genera anelli in corrispondenza dei
tratti-ponte (conseguenza diretta della costruzione "a spezzoni" sopra): il
vuoto lasciato è esattamente dove servono i piloni.

### Track editor

L'editor non ha pannelli per-punto (la quota si modifica già oggi con la
rotellina del mouse sopra il marker, non un campo di testo): coerentemente,
il flag ponte si attiva/disattiva con un tasto rapido (**B**) sul marker
sotto il cursore, stesso schema di **U** (undo) e della rotellina per la
quota — non una checkbox in un pannello che oggi non esiste. I punti-ponte
si colorano diversamente nella vista 3D (arancione, invece del colore
giallo/rosso/blu in base alla quota) per distinguerli a colpo d'occhio
mentre si disegna un tratto che passa sopra un altro. Il caricamento di un
tracciato esistente (`applyTrackData`) deve preservare il flag `bridge` dei
punti importati — oggi la mappatura è un whitelist esplicito `{x, z, y}`
che lo scarterebbe silenziosamente.

## Testing

Nessun test automatico esistente per questa parte del gioco (fisica/visuale
in tempo reale, Three.js + WebGL). Verifica manuale in localhost, come da
convenzione di progetto:

**Fase 1:**
1. Caricare il tracciato "prova" (ha già un tratto collinare): il prato
   intorno al tratto sopraelevato deve visibilmente salire/scendere insieme
   alla pista, senza soluzione di continuità col prato piatto più lontano.
2. Alberi/tribune vicino al tratto sopraelevato devono poggiare sul pendio,
   non fluttuare.
3. Uscire di pista nel tratto sopraelevato: la quota visiva dell'auto deve
   seguire il pendio del terrapieno, non restare fissa alla quota pista.
4. Nel track editor, modificare un punto di "prova" per farlo scendere sotto
   quota 0 (discesa): in gioco, il prato deve scendere con la pista, nessun
   buco verde.
5. Girare un giro intero e verificare che non ci siano z-fighting/tagli
   visibili al bordo tra terrapieno e prato piatto esterno.

**Fase 2:**
1. Test automatici in `trackGeometry.test.js`: `sampleLoop`/`sampleOpenPath`
   propagano `bridge` correttamente dai punti di controllo ai punti
   campionati (un tratto tra due punti `bridge:true` è tutto `bridge:true`
   nei campioni, i punti di transizione restano `bridge:false`).
2. Nel track editor, aprire "prova" (ha già un vero autoincrocio in pianta,
   diagnosticato durante il brainstorming: un campione a quota 0 e uno a
   quota ~8.65 distano ~1.3 unità in x/z vicino a x=-300, z=-541) e marcare
   come ponte i punti del tratto sopraelevato che passa sopra l'altro.
   Verificare in gioco che: il ponte abbia un impalcato/piloni visibili
   fino al terreno vero sottostante, il tratto sotto il ponte non sia
   alterato (niente terrapieno che sale a incontrarlo), nessuna cucitura
   storta nel prato/terrapieno ai due estremi del ponte, l'auto possa
   transitare sotto il ponte senza collisioni spurie con la sua geometria.
3. Su un tracciato senza nessun punto `bridge:true` (es. "monte-rosso"),
   verificare che il comportamento sia identico a prima di questo lavoro
   (un solo spezzone, nessuna regressione rispetto alla Fase 1).

## Fix post-playtest: prato a griglia (invece di poligono con foro)

Verificando la Fase 2 su "prova" (che ha un vero autoincrocio in pianta,
diagnosticato durante il brainstorming), è comparsa una macchia/fessura
azzurra (il cielo di sfondo che si vede attraverso il prato) subito dopo la
fine del tratto ponte. Causa: `TrackMeshBuilder.buildGround` costruisce il
"buco" del prato come un unico contorno poligonale che gira attorno a tutta
la pista, saltando i punti-ponte (collegati da un segmento dritto — il
"taglio dritto" della Fase 2). Ma qui il ponte passa proprio sopra un altro
tratto della stessa pista (sono vicini in pianta): quel segmento dritto
attraversa l'area dell'altro tratto, producendo un contorno che si
autointerseca. Un poligono autointersecante non è triangolabile in modo
affidabile (`THREE.ShapeGeometry`/earcut produce buchi/triangoli spuri
esattamente lì) — è il rischio che la review finale della Fase 2 aveva già
previsto come possibile ("il buco del prato potrebbe autointersecarsi
esattamente sotto il ponte").

Non è una toppa locale (spostare il taglio) perché si ripresenterebbe su
qualunque futuro tracciato con un altro incrocio: la causa è strutturale
(un poligono vettoriale con foro non può rappresentare in modo affidabile
un'area "vicino a sé stessa" quando la pista si autointerseca).

**Fix: prato a griglia invece di poligono con foro.** `buildGround` non
costruisce più un contorno vettoriale. Divide invece l'area attorno alla
pista (bounding box + margine oltre `embankOuter`) in una griglia di celle
quadrate (`GROUND_GRID_CELL`, es. 20 unità): una cella diventa un quad di
prato solo se il suo centro è più lontano di `embankOuter` dal punto **a
terra** più vicino (`groundPts`, punti-ponte esclusi — stesso principio già
usato altrove). Nessun poligono, nessuna classificazione "dentro/fuori"
(`isPointInPolygon`/`offsetLoop`/`toVector2Path` vengono rimosse, non più
necessarie): un test per cella non può mai autointersecarsi, per
costruzione, indipendentemente da quanto la pista si avvicini a se stessa.
Oltre l'estensione della griglia (lontano dalla pista, dove non serve
dettaglio), un singolo piano piatto enorme senza fori copre il resto del
mondo fino all'orizzonte — abbastanza lontano da non poter mai sovrapporsi
al terrapieno o tagliare una discesa.

## Fase 3 — Barriere rigide sui tratti ponte

Sui tratti marcati ponte, uscire di pista lateralmente oggi fa "cadere"
l'auto verso il terreno vero sottostante (Fase 2, quota visiva via
`terrainHeightAt(groundPts, ...)`). Su un ponte questo è indesiderato: non
c'è un'animazione di caduta, l'auto sparirebbe/riapparirebbe in modo brusco.
Soluzione: sui tratti ponte, il bordo pista diventa un **muro rigido** che
impedisce all'auto di uscire lateralmente oltre una certa distanza — fuori
scope sui tratti normali (colline non-ponte), dove il comportamento Fase 1/2
resta invariato.

**Comportamento all'urto**: come le collisioni auto-auto già esistenti
(`resolveCollisions`/`COLLISION_BOUNCE` in `f1GameSocket.js`) — si azzera
solo la componente di velocità perpendicolare al muro, quella lungo il
muro resta intatta: l'auto scivola lungo il bordo invece di fermarsi di
colpo o rimbalzare indietro.

**Dove si applica**: solo dove il punto pista più vicino ha `bridge: true`
(non su qualunque tratto sopraelevato — la collinetta di "prova", non
marcata ponte, resta col comportamento Fase 1/2 invariato).

**Implementazione** (server-autoritativo, `backend/sockets/games/f1GameSocket.js`
— la fisica è 2D, il flag `bridge` è già disponibile su `track.points` grazie
alla Fase 2, che lo propaga in `TrackGeometry.sampleLoop`, condivisa da
client e server tramite `trackLoader.js`):

Nuova funzione `applyBridgeBarrier(p, track)`, chiamata per ogni giocatore
in gara ad **ogni sottostep** della posizione (stesso punto in cui gira già
`resolveCollisions`, dentro il loop `COLLISION_SUBSTEPS` di `tickGame`, e
non solo una volta a fine tick): un'auto veloce potrebbe altrimenti
attraversare il muro in un singolo tick prima che qualunque controllo se ne
accorga — lo stesso motivo per cui `resolveCollisions` già gira lì.

1. Trova l'indice pista più vicino con `TrackGeometry.nearestIndexNear`
   (ricerca finestrata sull'indice precedente, già usata da
   `updateTrackIndex`).
2. Se quel punto non è `bridge`, non fare nulla (tratti normali invariati).
3. Se la distanza laterale dal centro pista supera la soglia (stessa già
   usata per il fuoripista, `track.roadHalf + 2`): riporta l'auto
   esattamente su quella soglia lungo la normale locale
   (`TrackGeometry.normalAt`, orientata verso il lato da cui l'auto è
   uscita) e smorza solo la componente di velocità lungo quella normale
   (fattore di smorzamento uguale a `COLLISION_BOUNCE`).

Nessuna modifica al client: la posizione resta interamente autoritativa sul
server e già trasmessa (`x`/`z` in `buildPublicState`); il client la segue
come fa oggi. Nessuna modifica al formato tracciato (il flag `bridge` è già
quello della Fase 2).
