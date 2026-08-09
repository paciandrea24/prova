# F1 — "circuito vivo": correzione difetti scenografia + orizzonte chiuso

Segue e corregge `2026-08-09-f1-scenery-integration-design.md`, la cui
implementazione è in gioco ma ha prodotto sette difetti visibili al playtest
del 2026-08-09. Tutte le misure qui sotto sono **misurate**, non stimate:
ricavate eseguendo `TrackScenery.generateLayout` sui tre tracciati reali
(`prova`, `monte-rosso`, `new-monza`) e confrontando gli ingombri di
`sceneryAssetSizes.js`.

## Obiettivo

Che il circuito sembri un impianto vero e finito: nessun modello rotto,
nessuna struttura dentro un'altra, tribune e box che compongono fronti
continui, l'autopilota che sta nella sua corsia, e un orizzonte chiuso da
paesaggio invece che una distesa verde infinita.

## A — `grandStandAwning`: la tettoia non arriva in fondo

**Difetto.** In `backend/tools/circuitAssets/grandstands.py` la falda va da
`AWNING_FRONT = -7.0` a `AWNING_BACK = 2.0`, ma il corpo della tribuna è
profondo `D = 12.0`, cioè da −6 a +6, e la gradinata arriva a y ≈ 4.2. Restano
scoperte le ultime tre file, e soprattutto i **montanti posteriori**
(a `D/2 - 0.4 = 5.6`) non toccano nulla: reggono il vuoto quattro unità dietro
il bordo della falda. Visibile nel render di approvazione
(`backend/tools/renders/circuit/grandStandAwning.png`), dove si legge come una
seconda trave sospesa.

**Decisione.** Si ripara il modello (scelta dell'utente fra riparare ed
eliminare). `AWNING_BACK` va portato da 2.0 a **5.9**: la parete di fondo è
spessa 0.8 e centrata a `D/2 - 0.4 = 5.6`, quindi occupa la fascia 5.2–6.0 —
a 5.9 la falda ci appoggia sopra affondandovi, senza facce complanari (la
regola che tutto il file segue per evitare z-fighting). Così copre tutta la
gradinata e poggia davvero sui montanti posteriori, che stanno proprio a 5.6.
Non si tocca nient'altro della variante: fronte, quota e pilastri anteriori
restano quelli approvati.

**Conseguenza da propagare.** La profondità dell'asset cambia: va aggiornata
`grandStandAwning.d` in `frontend/shared/sceneryAssetSizes.js` col valore
riesportato, altrimenti i test di non-sovrapposizione lavorano su un ingombro
sbagliato.

**Gate.** Il `.glb` va rigenerato con Blender 5.1
(`f1CircuitAssetsBuilder.py --asset grandStandAwning`) e il render mostrato
all'utente **prima** di rimetterlo in gioco — è la convenzione di progetto per
ogni asset generato.

## B — Tribuna principale: fila continua, non tre moduli con un buco

**Difetto, misurato su `prova`.** Due cause sovrapposte:

1. `buildMainGrandstandLayout` piazza i moduli su un passo espresso in
   **campioni**: `Math.round(MAIN_STAND_COL_SPACING / stepLen) =
   Math.round(18.4 / 5.17) = 4` campioni, cioè 20.7 unità invece di 18.4 —
   +12% di errore prima ancora di guardare la geometria.
2. Il traguardo di `prova` è **in curva** (raggio 158) e i moduli stanno a 29
   unità di offset laterale: la distanza reale fra i centri offsettati non è
   quella misurata sulla linea centrale. Risultato: i tre moduli distano
   14.3 e 17.2 fra loro (contro una larghezza di 19.2 — quindi si
   compenetrano, in modo diverso da un lato all'altro).

Il buco della fotografia però non è fra i moduli: è fra il modulo più esterno
della principale e una **tribuna sparsa** di `buildGrandstandLayout`, piazzata
a 32.4 unità di distanza → 13.2 unità di varco, e con un orientamento diverso
(nella foto si vede che la tribuna di sinistra è angolata rispetto alle altre).
Il controllo esistente `isTooCloseToAny` usa `STRUCTURE_CLEARANCE = 22`, che è
proprio la distanza che *produce* quel varco: impedisce la sovrapposizione ma
non garantisce la continuità.

**Decisione.** Il piazzamento a indice viene sostituito da una **catena
greedy** sull'offset:

- si parte dal punto del traguardo, si cammina lungo il tracciato e si piazza
  un modulo ogni volta che il punto **già offsettato lateralmente** dista
  `MAIN_STAND_COL_SPACING` **in linea d'aria** dal modulo precedente;
- si procede simmetricamente in avanti e all'indietro dal traguardo;
- `MAIN_STAND_COLS` passa da 3 a **7** (fila di ~129 unità).

La distanza fra centri consecutivi diventa esatta per costruzione, su
qualunque curvatura e su qualunque offset — è il punto: non si corregge il
numero, si corregge il criterio, così il difetto non torna sul prossimo
tracciato con un traguardo in curva.

**Tribune sparse.** `buildGrandstandLayout` deve escludere l'intera fascia
occupata dalla fila principale, non limitarsi a `STRUCTURE_CLEARANCE`: uno
slot che cade dentro `MAIN_STAND_HALF_SPAN + una larghezza di modulo` dal
traguardo, sullo stesso lato, va spostato (con la ricerca del punto valido più
vicino, già implementata) o scartato. Meglio nessuna tribuna che una tribuna a
13 unità di distanza dalla fila.

**Vincolo da ricontrollare.** `MAIN_STAND_HALF_SPAN` cresce da 27.6 a 64.4 e
governa anche l'esclusione dei cartelloni sponsor dal lato della tribuna
(`buildPaddockLayout`). Con `START_WINDOW_LEN = 60` (±30 dal traguardo) tutti
i cartelloni di quel lato verrebbero soppressi: è accettabile e coerente
(davanti alla tribuna principale non ci vanno), ma va verificato che l'altro
lato ne conservi.

## C — Strutture dentro altre strutture

**Difetto, misurato.** Sovrapposizioni reali dei footprint (test SAT sugli
ingombri di `sceneryAssetSizes.js`):

| tracciato | coppia | compenetrazione |
|---|---|---|
| prova | `podium` × `pitsGarageClosed` | 7.1 |
| new-monza | `podium` × `pitsGarageClosed` | 1.8 |
| new-monza | `raceControlTower` × `grandStandAwning` | 3.0 |
| new-monza | `footbridge` × `grandStandAwning` | 4.1 |
| monte-rosso | `footbridge` × `grandStand` | 2.9 |

È il "edificio dentro l'edificio" segnalato dall'utente: il podio (12 × 7.1,
alto 9) finisce dentro un garage box. La causa è che
`sceneryLandmarks.buildLandmarks` controlla corsia box, box giocatore e
cavalcavia, ma **non** le strutture già accettate — a differenza di
`buildGrandstandLayout`, che almeno usa `isTooCloseToAny`.

**Decisione.** Si introduce un test di sovrapposizione **basato sui footprint
reali orientati** (SAT sugli angoli restituiti da
`SceneryAssetSizes.footprintCorners`, funzione già esistente e già usata dai
test), esposto da `sceneryAssetSizes.js` come funzione pura e riusabile.
Landmark e tribune sparse devono superarlo contro tutto ciò che è già stato
accettato, scorrendo il giro alla ricerca del primo punto libero — meccanismo
di ricerca già presente in entrambi i moduli, cambia solo il predicato.

Il test SAT sostituisce `isTooCloseToAny` **solo per le strutture**: la natura
continua a usare la distanza fra centri, che per gli alberi è adeguata e molto
più economica (500 candidati per tracciato).

## D — Corsia box: edifici sparsi invece di un fronte

**Difetto, misurato.** `PIT_BUILDING_STEP_LEN = 24` contro edifici larghi
20.6: nel caso migliore restano 3.4 unità di stacco, ma quando il filtro di
distanza euclidea scarta un candidato il passo diventa 48 e si apre un vuoto
di 27. Conteggio reale degli edifici generati: `prova` 10, `new-monza` 3,
`monte-rosso` **1**.

**Decisione.** Stessa catena greedy della sezione B, applicata alla corsia
box: si cammina lungo `pitPts` e si piazza l'edificio successivo appena il suo
centro raggiunge la distanza `(larghezza propria + larghezza del precedente) / 2
+ PIT_BUILDING_GAP` dal precedente, con `PIT_BUILDING_GAP ≈ 2`. Le larghezze
vengono da `sceneryAssetSizes.js`, quindi alternare `pitsGarageClosed` (20.6) e
`pitsOffice` (20.7) produce un fronte continuo e regolare.

Restano invariati i vincoli già esistenti e già motivati: nessun edificio nel
tratto d'imbocco (`PIT_BUILDING_ENTRY_CLEARANCE = 70`), fuori dagli ingombri
dei box giocatore, e a distanza dal corridoio pista
(`PIT_BUILDING_TRACK_CLEARANCE`). Un edificio scartato per uno di questi
motivi non fa più avanzare il passo di un intero step: la catena riprova al
campione successivo, così il fronte si richiude dopo l'ostacolo invece di
lasciare un vuoto doppio.

## E — Autopilota della corsia box fuori dalla corsia

**Difetto, misurato.** `updatePitAutopilot` (`f1GameSocket.js`) cammina sui
punti di `track.pitPath`, che sono i **punti di controllo grezzi** del JSON
(7 su `prova`), mentre la corsia disegnata è la spline Catmull-Rom campionata
(`TrackGeometry.sampleOpenPath(pit.path, 300)`, più
`tuckPitEndsToTrack`). Muovendosi in retta da un controllo all'altro l'auto
taglia le curve: **scarto massimo misurato 3.35 unità su una semilarghezza di
corsia di 5**. L'auto passa quindi a 1.65 unità dal bordo, che a video si legge
come "l'autopilota non segue la corsia".

**Decisione.** L'autopilota cammina sugli **stessi punti campionati che il
frontend usa per disegnare la corsia**. Concretamente:

- `trackLoader.buildTrack` calcola una volta `pitLanePts =
  TrackGeometry.tuckPitEndsToTrack(sampleOpenPath(pitPath, 300), points)` — la
  stessa espressione di `frontend/f1.js:183`, così disegno e traiettoria non
  possono divergere — e lo espone come `track.pitLanePts`;
- `updatePitAutopilot` e `startPitLaneEntry` usano `track.pitLanePts` al posto
  di `track.pitPath`.

**Vincolo non ovvio, da rispettare.** `p.pitBoxAnchor.fromIdx` è un indice sui
**punti di controllo**, e l'autopilota lo usa per sapere quando fermarsi e
saltare verso lo stallo personale. Va affiancato da un indice sul percorso
campionato (`laneIdx`, ricavato con `nearestPoint(pitLanePts, anchor.x,
anchor.z).index`), **senza toccare il calcolo degli anchor stessi**: la
posizione fisica dei box giocatore è già stata verificata e approvata
dall'utente, e non deve spostarsi. Cambia solo *come ci si arriva*.

Il numero di waypoint passa da ~7 a 300: `PIT_AUTO_ARRIVE_DIST` e il fatto che
ogni arrivo a waypoint azzeri `speed/vx/vz` vanno riverificati in questo
regime — con waypoint a ~1 unità di distanza il vecchio comportamento
"arrivo esatto + azzeramento" diventa un movimento a scatti. La velocità
lungo la corsia deve restare `PIT_AUTO_SPEED` costante come oggi.

**Verifica.** Un test che simula l'intero tragitto d'ingresso su tutte e tre
le piste e asserisce che la distanza dell'auto dalla linea centrale della
corsia resti sotto `pitRoadHalf` a ogni tick. Oggi questo test fallirebbe.

## F — Orizzonte: colline e boschi invece di prato infinito

**Difetto.** `buildGround` chiude il mondo con un piano piatto 3000 × 3000 a
quota −0.01; la nebbia è `FogExp2(0xadd8e6, 0.0022)` mentre il cielo è
`0x87CEEB`. Due tinte diverse, quindi la linea di stacco fra prato e cielo
resta leggibile e la mappa sembra infinita.

**Decisione (scelta dell'utente: colline, boschi folti, elementi ambientali).**

1. **Colline dalla griglia esistente.** `buildGround` genera già una griglia di
   celle da `GROUND_GRID_CELL = 20` intorno al tracciato, saltando quelle
   dentro il terrapieno. Oltre una distanza `HILL_START` dal tracciato le celle
   ricevono una **quota crescente con la distanza, modulata da rumore
   deterministico**: si formano rilievi **a gradoni**, che è esattamente lo
   stile voxel del progetto e non un ripiego. Costo: zero draw call in più —
   è la stessa mesh, con i vertici a quota diversa. Le colline sono puramente
   visive: nessuna collisione, sono ben oltre la zona raggiungibile.
2. **Boschi folti** sulle pendici e nella fascia fra terrapieno e colline:
   macchie ad alta densità locale (non uno scatter uniforme, che è ciò che
   fallì la volta scorsa). Budget: **al massimo 300 alberi in più** rispetto
   ai ~240 attuali per tracciato, cioè un tetto di ~540 — sotto i 700 che
   avevano fatto scattare il gioco nel tentativo documentato in
   `trackScenery.js`, e in condizioni migliori, perché nel frattempo gli
   alberi sono stati esclusi dalle ombre (`NO_SHADOW_ASSETS`), che di quel
   calo era la causa vera. Il tetto è una costante esplicita, ritarabile al
   gate utente insieme al frame rate.
3. **Nebbia e cielo coerenti**: colore della nebbia allineato a quello del
   cielo e densità ritarata in modo che le colline siano visibili prima di
   saturare (oggi a 1000 unità la nebbia è già al 99%, e `camera.far` è 1200).

Il seed è quello già in uso (`hashString(trackData.id)`): stesso tracciato →
stesse colline, sempre.

## G — Asset modellati e mai usati

**Difetto, misurato.** Istanze generate sui tre tracciati: `pylon` **0**,
`flagPole` **0**, `paddockTent` 1 (solo monte-rosso). Il `decorPlan` di
`sceneryTrackside.js` li piazza tutti sul lato corsia box a
`barrierDist + 14`, dove cadono sistematicamente dentro la corsia o dentro un
box giocatore, e vengono scartati. Le costanti di ripiego
`MAIN_STAND_CLEAR_OFFSET = 34` e `PADDOCK_FAR_OFFSET = 46` sono **dichiarate
ma non usate da nessuna riga di codice**.

Inoltre `pitCrew` e `pitCrewKneel` sono modellati ma non compaiono in
`SCENERY_ASSET_PATHS` né in nessun altro punto del frontend: non sono mai
stati cablati.

**Decisione.**

1. Il decoro del paddock prova gli offset di ripiego già previsti prima di
   arrendersi: collocazione nominale → oltre la tribuna principale (34) →
   oltre la corsia box (46). Un asset viene scartato solo se falliscono tutte
   e tre.
2. `pitCrew`/`pitCrewKneel` vengono aggiunti davanti ai box giocatore, come
   parte del caricamento del box (`pitBoxLoader.js`), posizionati rispetto
   allo stallo. Sono statici: l'animazione è **fuori scope** (vedi la nota in
   testa a `backend/tools/circuitAssets/people.py`).

## Architettura

Nessun modulo nuovo lato scenografia: le correzioni stanno dove sta già il
codice che le riguarda.

| file | cosa cambia |
|---|---|
| `backend/tools/circuitAssets/grandstands.py` | A — falda estesa |
| `frontend/shared/sceneryAssetSizes.js` | A — misura aggiornata; C — test SAT esportato |
| `frontend/shared/trackScenery.js` | B — catena greedy tribuna + esclusione fascia; C — SAT per le strutture; D — catena greedy edifici box |
| `frontend/shared/sceneryLandmarks.js` | C — SAT contro le strutture accettate |
| `frontend/shared/sceneryTrackside.js` | G — offset di ripiego del decoro |
| `frontend/shared/trackMeshBuilder.js` | F — colline dalla griglia del prato |
| `frontend/f1.js` | F — nebbia/cielo; boschi |
| `frontend/shared/pitBoxLoader.js` | G — meccanici davanti al box |
| `backend/sockets/games/trackLoader.js` | E — `track.pitLanePts` |
| `backend/sockets/games/f1GameSocket.js` | E — autopilota sui punti campionati |

La **catena greedy** compare in due punti (tribuna principale e edifici box)
con lo stesso identico criterio — "avanza finché il prossimo centro dista D
dal precedente" — e va scritta **una volta sola** come funzione pura in
`trackGeometry.js`, non copiata: è geometria del tracciato, come `walkClosedLoop`
e `curvatureAt` che stanno già lì.

## Verifica

**Test automatici** (`node --test`, nessuna dipendenza npm), sui tre tracciati
reali e non su fixture sintetiche — i difetti di questa spec sono tutti emersi
su geometrie vere:

- nessuna coppia di strutture con footprint sovrapposti (il test che oggi
  troverebbe le 5 righe della tabella in C);
- moduli consecutivi della tribuna principale a distanza pari a
  `MAIN_STAND_COL_SPACING` ± tolleranza, e nessuna tribuna sparsa dentro la
  fascia della principale;
- edifici box consecutivi contigui: distanza fra centri compresa fra la
  semisomma delle larghezze e quella più il gap, senza vuoti doppi;
- autopilota box: distanza dalla linea centrale della corsia < `pitRoadHalf`
  a ogni tick dell'intero tragitto (oggi fallisce, scarto 3.35 su 5);
- `pylon`, `flagPole`, `paddockTent` generati almeno una volta per tracciato;
- determinismo invariato: stesso tracciato → stesso layout.

**Gate utente in localhost dopo ogni fase.** È l'unica verifica possibile per
"sembra un circuito vero", che nessun test copre. In particolare per il render
di `grandStandAwning` (A), per la continuità delle tribune viste dal
rettilineo (B), per il frame rate con i boschi (F).

## Fuori scope

- **Nuovi asset da modellare** (ghiaia e vie di fuga, hospitality, gru TV):
  l'utente ha scelto esplicitamente di lavorare sul catalogo esistente.
- **Animazione dei meccanici**: restano statici.
- **Riposizionamento dei box giocatore**: la loro collocazione è approvata e
  non si tocca; la sezione E cambia solo il percorso con cui ci si arriva.
- **Editor pista e JSON dei tracciati**: il piazzamento resta interamente
  procedurale.
- **Rimozione dei `.glb` Kenney** residui (alberi): restano per scelta
  dell'utente.
- **Commit**: li fa l'utente a mano, come da `CLAUDE.md`.
