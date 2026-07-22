# F1 — scenografia procedurale intorno al circuito

## Problema

I tracciati F1 (`monte-rosso`, `monza`, `interlagos`) hanno solo pista,
cordoli, barriere e prato di sfondo: nessun elemento ambientale (natura,
tribune, paddock). L'utente vuole "sparpagliare" asset di ambientazione
sulla mappa — sia natura (alberi, rocce, laghi) sia elementi tipici di
paddock/circuito (tribune, tende, banner) — ma **generati automaticamente**
con la costruzione della mappa, non posizionati a mano tracciato per
tracciato.

## Contesto tecnico esistente

- `frontend/f1.js` carica il JSON del tracciato (`controlPoints`,
  `roadHalfWidth`, `pit.path`), lo campiona con
  `TrackGeometry.sampleLoop(controlPoints, 1000)` in `trackPts`, e costruisce
  pista/cordoli/barriere/corsia-box con `TrackMeshBuilder` (righe 103-107).
  Tutto questo avviene **solo lato client**: il server (`f1GameSocket.js`)
  gestisce solo fisica x/z, non conosce né disegna la scena.
- `frontend/shared/trackGeometry.js` espone già `normalAt(points, i, closed)`
  (normale laterale al tracciato in un punto) e `nearestPoint(points, x, z)`
  (punto campionato più vicino a una coordinata) — esattamente quello che
  serve per piazzare oggetti a una distanza laterale dalla pista e per
  verificare che un punto candidato non cada dentro il corridoio pista/box.
- `frontend/assets/kenney/` contiene già 23 `.glb` del Kenney Racing Kit
  (CC0), scaricati ma **non ancora referenziati da nessun file**: solo
  `raceCarWhite/Red/Green/Orange.glb` sono in uso oggi (colori auto). Tra
  quelli scaricati e riutilizzabili per questa feature: `grandStandCovered`,
  `treeLarge`, `treeSmall`, `grass`, `pylon`, `flagCheckers`, `barrierRed`,
  `barrierWhite`.
- `ROAD_HALF`, `BARRIER_D = ROAD_HALF + CURB_W + 1.2` (riga 82 di `f1.js`)
  definiscono già il raggio del corridoio pista+cordolo+barriera da cui la
  scenografia deve stare fuori.

## Design

### Nuovo modulo `frontend/shared/trackScenery.js`

Stesso pattern IIFE/global di `trackGeometry.js` e `trackMeshBuilder.js`
(nessun bundler nel progetto). Espone:

```js
TrackScenery.generateLayout(trackData, trackPts, pitPts, barrierDist)
// → [{ asset: 'treeLarge', x, y, z, rotY, scale }, ...]
```

**Seed deterministico.** Un piccolo hash della stringa `trackData.id`
(es. FNV-1a a 32 bit) inizializza un PRNG seedabile (mulberry32). Stesso
tracciato → stesso layout ad ogni caricamento; tracciati diversi → layout
diversi ma stabili nel tempo. Nessuno stato salvato: si rigenera dal JSON
ogni volta, quindi aggiungere/spostare punti di controllo di un tracciato
cambia automaticamente (e in modo prevedibile) la sua scenografia.

**Funzioni di validità comuni a tutte le categorie:**
- `distToTrack(x, z)` → distanza minima da `trackPts` (riusa
  `TrackGeometry.nearestPoint`); un punto è valido solo se
  `distToTrack > barrierDist + margine`.
- `distToPit(x, z)` → stessa idea su `pitPts` (corsia box campionata), con
  margine proprio (`pitRoadHalf + margine`).
- Rifiuto per sovrapposizione: un nuovo punto candidato è scartato se cade a
  meno di una distanza minima (dipendente dalla categoria, es. 6 unità per
  alberi, 25 per tribune) da un oggetto già accettato — semplice
  rejection sampling, niente struttura dati spaziale: ai volumi di oggetti
  previsti (poche centinaia) il costo O(n²) è trascurabile.
- Ogni candidato ha un tetto di tentativi (es. 30) prima di rinunciare a
  quello specifico slot, per evitare loop infiniti in zone congestionate.

### Categoria: Natura (a caso)

Scatter tipo Poisson-disc sull'anello libero intorno al tracciato:
- Bounding box del tracciato espansa di un margine fisso (es. 80 unità) come
  area candidata.
- Punti candidati generati a caso uniforme nell'area, filtrati con
  `distToTrack`/`distToPit` + rifiuto sovrapposizione.
- Asset: `treeLarge`, `treeSmall` (già scaricati), + rocce e cespugli da
  scaricare dal Nature Kit (vedi sezione Asset). Scelta dell'asset per ogni
  punto casuale con pesi (più alberi che rocce/cespugli).
- **Laghetto**: tentativo singolo (non garantito), dopo lo scatter normale.
  Si cercano punti candidati con un raggio libero abbastanza ampio attorno
  (nessun altro oggetto/corridoio entro una soglia di sicurezza); se se ne
  trova uno si piazza lì il laghetto, altrimenti si salta senza compensare
  altrove — coerente con "solo se c'è spazio naturale". Il Nature Kit non
  include un modello "pond" dedicato: il laghetto è quindi una mesh
  procedurale (`THREE.CircleGeometry` + materiale blu), stesso approccio già
  usato per il prato di sfondo in `f1.js` (`PlaneGeometry` colorata), non un
  `.glb` scaricato.

### Categoria: Tribune (distribuite intorno al circuito)

- N tribune (es. 6-10, in base a `lapLength`) piazzate a intervalli regolari
  di lunghezza d'arco lungo `trackPts`, alternando lato sinistro/destro
  (usando `normalAt` per l'offset laterale, a distanza `barrierDist +
  margine tribuna`).
- Ogni slot il cui punto cade dentro la zona corsia box viene scartato (la
  corsia box ha già le sue tribune/paddock dedicati, vedi sotto) — non si
  ricicla lo slot altrove: leggermente meno tribune vicino ai box è
  accettabile e più realistico.
- Orientamento: `rotY` calcolato per guardare verso il punto tracciato più
  vicino (facciata rivolta alla pista).
- Asset: `grandStandCovered` (già scaricato).
- **Folla statica**: per ogni tribuna piazzata, una griglia di N piccole
  istanze di un personaggio Kenney Mini Characters (posa singola, nessuna
  animazione) distribuite sul "gradinata" della tribuna — offset fissi
  relativi alla tribuna stessa, non un secondo scatter casuale.

### Categoria: Paddock (zona dedicata)

Concentrata in due aree fisse, non nello scatter generico:
- **Rettilineo di partenza** (`trackPts[0]`, stesso punto usato da
  `buildStartLine`): banner pubblicitari e pylon/flagCheckers lungo il
  rettilineo, a distanza fissa dalla barriera.
- **Corsia box** (`pit.path` campionato): fila di tende dietro il muro dei
  box, un pylon/banner ogni tot metri lungo il rettilineo box.
- Nessun PRNG per questa categoria: posizioni calcolate deterministicamente
  a intervalli fissi lungo i punti già disponibili (stessa idea di
  `buildPitLane`/`buildStartLine`, non serve rejection sampling perché
  l'area è già "propria" e non condivisa con lo scatter natura/tribune).

### Caricamento asset in `f1.js`

Nuova funzione (es. in `trackScenery.js` stesso o un piccolo helper dentro
`f1.js`, da decidere in fase di piano) che:
1. Raggruppa il layout generato per `asset`.
2. Carica ogni `.glb` unico una sola volta con `THREE.GLTFLoader`.
3. Per asset ripetuti muti (alberi, rocce, folla) usa `THREE.InstancedMesh`
   sulla geometria/materiale estratti dal GLB caricato, per tenere basso il
   numero di draw call anche con centinaia di istanze.
4. Per asset singoli/pochi (tribune, laghetto, tende) aggiunge cloni diretti
   della scena GLB (comportamento identico a `loadCarModel`, senza il
   ricentraggio bounding-box che serve solo per le auto).
5. Chiamata subito dopo le righe 103-107 esistenti di `f1.js`
   (`TrackMeshBuilder.build...`), passando `trackPts`, `pitPts` (già
   ricavabile da `TrackGeometry.sampleOpenPath(trackData.pit.path, 300)`,
   oggi calcolato solo dentro `buildPitLane`: va esposto/ricalcolato anche
   in `f1.js`) e `BARRIER_D`.

### Asset da scaricare (nuovi)

CC0. Verificato che i download diretti da Poly Pizza non sono scriptabili
in automatico (pagine di ricerca renderizzate client-side): si scaricano
invece gli zip ufficiali da kenney.nl (link diretti verificati) e se ne
estraggono solo i file necessari:
- `plant_bush.glb`, `plant_bushLarge.glb`, `rock_largeA.glb`,
  `rock_smallA.glb`, `tent_smallClosed.glb` — da `kenney_nature-kit.zip`
  (cartella `Models/GLTF format/` nello zip)
- `character-male-a.glb` — da `kenney_mini-characters.zip` (cartella
  `Models/GLB format/` nello zip)

## Cosa NON cambia

- Nessuna modifica al backend/fisica: la scenografia è puramente visiva,
  nessuna collisione con essa.
- Nessuna modifica a `track-editor.js`: la generazione avviene solo nel
  gioco vero (`f1.js`), non nell'editor 2D.
- I tre tracciati esistenti (`monte-rosso`, `monza`, `interlagos`) non
  richiedono modifiche al loro JSON: la scenografia si deriva interamente
  da `controlPoints`/`pit.path` già presenti.

## Verifica

Manuale in localhost su tutti e tre i tracciati:
- Nessun oggetto scenico si sovrappone visivamente a pista/cordoli/barriere/
  corsia box.
- Le tribune risultano distribuite su entrambi i lati del circuito, non
  concentrate in un solo punto.
- Zona partenza e corsia box hanno l'aspetto "paddock" (tende/banner/pylon)
  distinto dal resto del perimetro (natura).
- Ricaricando la stessa pista più volte, la disposizione resta identica
  (verifica visiva del determinismo); cambiando pista, cambia.
- Controllo prestazioni a occhio (nessun calo di framerate percepibile con
  la scenografia attiva) con più tab aperte in multiplayer.
