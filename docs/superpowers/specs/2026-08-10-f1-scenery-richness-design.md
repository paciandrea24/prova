# F1 — circuiti più ricchi: chiudere l'orizzonte e popolare le fasce (design)

Data: 2026-08-10
Stato: approvato dall'utente in brainstorming, non ancora implementato

## Obiettivo

I circuiti risultano spogli, e soprattutto **si vede il fondo**: lo sguardo
arriva fino al limite del mondo invece di essere fermato da qualcosa. L'utente
lo ha detto così: *"aggiungere vita al circuito in modo tale che non si veda il
fondo lontano, o comunque si veda pochissimo"*.

Sono due problemi distinti, che vanno risolti con mezzi diversi:

1. **L'orizzonte non è chiuso** — problema di composizione, si risolve con
   rilievi e masse alte, non con più oggetti piccoli.
2. **Le fasce intermedie sono povere** — problema di densità e varietà, si
   risolve con asset nuovi e più istanze.

Cespugli e rocce, da soli, non avrebbero risolto il primo: sono bassi.

## Misure di partenza (2026-08-10)

Scenografia generata, misurata sui tracciati reali:

| categoria | prova | monte-rosso |
|---|---|---|
| spettatori | 2983 | 2811 |
| vegetazione | 454 | 437 |
| sicurezza (gomme, reti) | 349 | 121 |
| tribune | 50 | 36 |
| decoro (cartelloni, tende, pyloni) | 6 | 6 |
| **totale** | **3864** | **3420** |

Il 77% degli elementi sono spettatori, cioè dentro le tribune: la scena
"fuori" è molto più povera di quanto il totale suggerisca. La vegetazione è
fatta di **due soli modelli** replicati 450 volte.

Fasce di distanza dal tracciato (su "prova", `roadHalfWidth` 11):

```
  0 – 13    pista e cordolo
 13 – 60    terrapieno
 60 – 180   prato piatto
180 – 500   colline, che salgono fino a 55 di quota
      1200  limite della visuale (camera.far)
```

**Perché l'orizzonte non è chiuso:** una collina di 55 unità a 500 di distanza
copre 6° sopra l'orizzonte, mentre la camera ne inquadra oltre 30. E la nebbia
alla densità attuale (0.001) al limite della visuale è al 76%: gli oggetti
spariscono per fine del mondo visibile, non perché la foschia li abbia
assorbiti.

## Decisioni prese in brainstorming

| Domanda | Decisione |
|---|---|
| Zone da arricchire | Tutte e tre: bordo pista, infield, fondo lontano. |
| Cosa chiude la vista | **Misto, con più natura che costruito in lontananza**: colline boscose sul fondo, edifici a media distanza. |
| Ruolo degli edifici | Formano il **paddock**, concentrati attorno ai box più due o tre gruppi sparsi sul giro. |
| Rocce | Approvate, ma **mai a bordo pista**. |
| Alberi Kenney | Si modellano i nuovi **accanto** ai due esistenti; la decisione se tenerli si prende dopo, guardando i render. Nessun interruttore di confronto in gioco. |
| Valutazione degli asset | L'utente apre i `.glb` e li guarda a 360°, prima che vengano piazzati in gioco. **Niente render**: il builder si lancia con `-- --no-render`, che porta la generazione da ~6 minuti a pochi secondi e rende praticabile iterare su un modello finché non convince. |

## Vincolo: la fascia della ghiaia

**Fra 13 e 60 unità dal tracciato non si piazza nulla di nuovo.** È il
terrapieno, e l'utente ha in programma di estendere alcune curve mettendoci le
vie di fuga in ghiaia, con le barriere spostate più all'esterno. Riempirla ora
significherebbe doverla svuotare poi.

Restano lì solo gli elementi già esistenti e già legati alla pista: cordoli,
barriere, pile di gomme, reti.

Questa non è una nota di buon senso ma una **regola del sistema di
piazzamento**, con un test che la verifica: nessuna voce delle categorie nuove
può cadere entro `barrierDist + GRAVEL_RESERVE`, dove `GRAVEL_RESERVE` vale
**45** — cioè l'ampiezza del terrapieno (`EMBANKMENT_WIDTH`), che porta il
limite a 60 unità dall'asse pista su "prova". Il valore è uno solo e sta in
`trackScenery.js` accanto alle altre distanze di piazzamento: se un domani le
vie di fuga risulteranno più larghe, si cambia lì.

### Invariante: nessuna distanza assoluta

Ogni distanza di piazzamento va espressa **in funzione di `barrierDist`**, mai
come numero assoluto rispetto all'asse pista.

**Perché è la predisposizione che conta davvero.** Le vie di fuga sposteranno
le barriere più all'esterno, e solo in alcune curve: `barrierDist` passerà da
costante a variabile lungo il giro. Il layout della scenografia non è salvato
da nessuna parte — `TrackScenery.generateLayout` lo ricalcola a ogni
caricamento della pista — quindi, finché tutto è ancorato a `barrierDist`, il
giorno che le barriere si spostano **la scenografia si ridispone da sola** e
non c'è nulla da rifare. Una singola distanza scritta come numero fisso
romperebbe questa proprietà in silenzio: resterebbe dov'è mentre tutto il
resto si sposta.

Un test in `trackScenery.test.js` lo verifica in modo diretto: genera il
layout due volte con `barrierDist` diverso e controlla che le voci delle
categorie nuove si siano spostate di conseguenza.

## Dove va cosa

```
  0 – 13    pista e cordolo          — invariato
 13 – 60    TERRAPIENO               — riservato alla futura ghiaia
 60 – 180   prato piatto             — cespugli, rocce, alberi isolati, striscioni
120 – 300   paddock                  — motorhome, camion, container, parcheggi, folla in piedi
180 – 500   colline                  — quota fino a ~110, bosco fitto sopra
500 – 1200  muro visivo              — bosco fitto su colline alte
```

## Catalogo degli asset nuovi

Quattordici modelli. Le dimensioni sono ancorate alla scala del gioco: 1 unità
≈ 0.78 m, l'auto è 3.47 × 7.17 × 1.79, una persona in piedi è 2.3.

| # | asset | ingombro (L × H × P) | dove | istanze stimate |
|---|---|---|---|---|
| 1 | `treeBroad` | 8 × 11 × 8 | ovunque | ~240 |
| 2 | `treeYoung` | 5 × 7 × 5 | ovunque | ~210 |
| 3 | `treePine` | 5 × 16 × 5 | colline e boschi | ~200 |
| 4 | `treeRound` | 7 × 9 × 7 | prato, gruppi misti | ~120 |
| 5 | `bushLow` | 1.6 × 1.2 × 1.6 | prato, a macchie | ~300 |
| 6 | `bushTall` | 2.8 × 3.2 × 2.8 | prato, bordo dei boschi | ~150 |
| 7 | `rockSingle` | 2.6 × 1.8 × 2.2 | prato oltre il terrapieno | ~80 |
| 8 | `rockCluster` | 5.5 × 2.4 × 4.5 | pendii delle colline | ~40 |
| 9 | `motorhome` | 15 × 4.5 × 3.8 | paddock | ~8 |
| 10 | `truck` | 20 × 5 × 3.8 | paddock | ~6 |
| 11 | `containerStack` | 7.7 × 6.6 × 3.3 | paddock | ~14 |
| 12 | `parkedCar` | 5.8 × 2.3 × 2.4 | parcheggi | ~60 |
| 13 | `spectatorStand` | 0.7 × 2.3 × 0.6 | a bordo recinzione | ~200 |
| 14 | `banner` | 10 × 3 × 0.3 | recinzioni e paddock | ~30 |

`treeYoung` non si chiama `treeSmall` perché quel nome è già dell'asset Kenney,
che resta caricato: due voci con lo stesso nome nella tabella degli asset
sarebbero un errore silenzioso.

`spectatorStand` riusa `_standing_legs` di `circuitAssets/people.py`, già
scritta per i meccanici: è una variante, non una figura nuova.

**Fuori scope di proposito:** hospitality, gru, torri faro, tribune nuove. Il
paddock si legge già con motorhome, camion e container; il resto sarebbe
accumulo.

## Come si chiude l'orizzonte (fase 1)

Non richiede alcun modello nuovo, ed è la parte che risolve il problema
principale.

- **Quota delle colline da 55 a ~110** e inizio anticipato (`HILL_MAX_HEIGHT` e
  `HILL_START_MARGIN` in `sceneryHills.js`). Una collina di 110 a 400 unità
  copre 15° contro i 6° di oggi; con sopra un bosco alto una quindicina di
  unità si arriva a ~17°. Sono valori di partenza, da tarare guardando
  l'orizzonte dai tre punti pista di riferimento.
- **Boschi più fitti** sui rilievi. Oggi: 26 macchie da 14 alberi con un tetto
  di 300, che sui tracciati reali si traduce in ~230 alberi effettivi. La
  proposta è portare il tetto a **600** e stringere il raggio delle macchie da
  34 a ~26, perché la massa visiva viene dalla densità dentro la macchia, non
  dal numero di macchie sparse: un bosco rado non ferma lo sguardo, lo
  attraversa.
- **Costo: zero draw call.** Le colline sono la stessa griglia del prato con i
  vertici alzati, come già oggi.

⚠️ `SceneryHills` è la fonte UNICA della quota: la usano
`trackMeshBuilder.buildGround` per disegnare e `trackScenery.buildWoodsLayout`
per piantarci gli alberi. Alzando le colline vanno ricontrollati
`HILL_GRID_CELL` e `HILL_REACH` in `trackMeshBuilder`: è già successo che le
colline non venissero disegnate affatto perché cadevano fuori dalla griglia
(vedi `docs/f1-notes.md`, correzioni del 2026-08-10).

## Vincoli tecnici

- **Massimo 3 materiali** per gli asset ad alta istanza (alberi, cespugli,
  rocce, spettatori in piedi). Il limite generale del builder è 6, ma ogni
  materiale è una mesh separata e quindi una draw call per cella: un cespuglio
  a 6 materiali replicato 300 volte costa il doppio di uno a 3, per un
  dettaglio che a quella scala non si legge. Verificato da un test.
- **Scala 1:1 e convenzioni dei voxel custom** (fronte verso +Z gioco, pivot
  alla base, niente volumi cavi): valgono come per i 25 asset esistenti, sono
  documentate in `docs/f1-notes.md`.
- **Tetto di spesa: 8 ms di disegno**, metà del budget a 60 fps, misurati col
  contatore del pannello (voce "di cui disegno"). Oltre quella soglia si
  riduce la densità, che è un numero, non un modello da rifare.
- **Le categorie nuove passano dal partizionamento spaziale** già esistente
  (`sceneryChunks.js`), quindi partecipano al frustum culling come il resto.

## Verifica

- **Invarianti geometrici**: `node --test backend/tools/circuitAssets.test.js`,
  esteso ai nuovi asset (ingombri dichiarati, pivot alla base, conteggio dei
  materiali entro il limite).
- **Controllo dei pixel neri**: `circuitAssetsBlackCheck.py` su tutti gli
  asset, come per i 25 esistenti. È lo strumento che ha pescato quasi tutti i
  difetti di modellazione la prima volta.
- **Regola della ghiaia**: test in `trackScenery.test.js` che verifica che
  nessuna voce delle categorie nuove cada entro la fascia riservata.
- **Valutazione estetica**: l'utente apre i `.glb` in
  `frontend/assets/custom/circuit/` e li ispeziona a 360°, prima che vengano
  piazzati in gioco. La generazione va quindi lanciata con `-- --no-render`:
  i PNG non servono a nessuno e costano quasi tutto il tempo di build.
  Il controllo dei pixel neri fa i propri render per conto suo e non è
  toccato da questa scelta.
- **Prestazioni**: contatore del pannello dopo ogni fase, negli stessi tre
  punti pista di sempre.

## Consegne

Quattro fasi, ognuna con playtest prima della successiva.

1. **Colline e boschi** — nessun modello nuovo. Risolve il problema del fondo
   visibile ed è giudicabile subito. Va per prima anche perché, se basta,
   permette di ricalibrare quanta roba serve davvero nelle altre fasi.
2. **Vegetazione** — 6 modelli (4 alberi, 2 cespugli), piazzamento nel prato e
   sui rilievi, decisione sui Kenney guardando i render.
3. **Rocce** — 2 modelli, sui pendii e nel prato oltre il terrapieno.
4. **Paddock e vita** — 6 modelli: motorhome, camion, container, auto
   parcheggiate, spettatori in piedi, striscioni.

## Fuori scope

**Le vie di fuga in ghiaia** sono il **progetto successivo**, deciso insieme
all'utente il 2026-08-10 dopo averne valutato l'anticipo. Restano fuori di
proposito perché non sono un elemento scenografico ma tre cose insieme:
geometria (barriera a distanza variabile lungo il giro), fisica **lato
server** (il rallentamento appartiene alla simulazione autoritativa, non al
browser) e gameplay (quanto rallenta, come si rientra, cosa succede se ci si
ferma dentro). Meritano la loro spec e il loro giro di domande; infilarle qui
significherebbe toccare il cuore della simulazione dentro un lavoro nato come
estetico. L'invariante sulle distanze qui sopra è ciò che le renderà indolori
quando arriveranno.

Fuori scope anche: nuove tribune; animazioni di qualunque tipo; modifiche al
tracciato; il porting del look al Voxel Livery Studio, in sospeso dal lavoro
precedente.
