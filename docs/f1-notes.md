# F1 — note tecniche

## Architettura fisica vettura (`backend/sockets/games/physics/`)

Refactoring puramente architetturale (Rif.
`docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md`), nessuna
formula/comportamento cambiato: la fisica per-tick è scomposta in moduli
dedicati invece di un'unica funzione `updateVelocity`.

```
backend/sockets/games/physics/
├── TyreModel.js          — mescole, usura, curva "cliff"
├── DamageModel.js        — danno per componente, collisioni auto-auto/barriera
├── CollisionResolver.js  — muro ponte/barriera, collisioni auto-auto (SAT/OBB)
├── PowertrainModel.js    — accelerazione/coast-down (effectiveMaxSpeed, effectiveAccel)
├── BrakingModel.js       — frenata (effectiveBrakeMult, applyBrake)
├── SteeringModel.js      — sterzo dipendente da velocità + danno ala/sospensioni
├── AerodynamicsModel.js  — aderenza/grip (effectiveGrip, applyGripBlend)
├── VehicleMotionModel.js — integrazione posizione, drag fuoripista
├── VehiclePhysics.js     — orchestratore puro: compone i 5 moduli sopra in updateVelocity
└── VehicleDynamics.js    — facade: UNICO punto da cui f1GameSocket.js::tickGame
                             invoca la simulazione vettura per-tick
```

**Chi dipende da cosa:** ogni sotto-modulo importa da `TyreModel`/`DamageModel`
solo ciò che la sua formula usa (es. `BrakingModel` non dipende da
`DamageModel`, `SteeringModel` non dipende da `TyreModel`) — nessuna
dipendenza tra sotto-moduli fratelli (es. `BrakingModel.applyBrake` riceve
l'accelerazione effettiva come parametro dal chiamante invece di importare
`PowertrainModel`).

**`VehicleDynamics` è il punto unico solo per il tick loop di gioco**
(`tickGame`): gli strumenti offline (`f1LapSimulator.js`,
`f1RaceLineOptimizer.js`) continuano a passare da `f1GameSocket.js`'s
`module.exports.physics` per retrocompatibilità esplicita — non da
`VehicleDynamics` direttamente.

**Se serve modificare una formula fisica**: il file giusto è quasi sempre uno
dei 5 sotto-moduli sopra, non più `VehiclePhysics.js` (che dal refactoring in
poi non contiene più formule proprie, solo la loro composizione nell'ordine
storico: maxSpeed/grip → motore-o-freno-o-coast → clamp velocità → sterzo →
blend aerodinamico — quest'ordine NON va cambiato, cambia il risultato anche
a parità di formule).

## Flag di confronto (percorsi sperimentali dietro env var)

Questa tabella è il punto unico da cui partire per sapere cosa esiste e in
che stato è. La env var va impostata **prima** di avviare il server
(`F1_XXX=... node server.js` dalla cartella `backend/`, mai a runtime — vedi
nota su `trackLoader`/cache di processo in fondo a questo file per lo stesso
principio).

⚠️ **Non sono più "tutti spenti di default"**, come diceva questa nota fino
al 2026-08-11. I flag promossi dopo un playtest positivo hanno la semantica
ROVESCIATA: sono attivi sempre, e si spengono solo con `=0` esatto (qualunque
altro valore, incluso non impostato, li lascia accesi). La colonna "default"
dice quale regola vale per ciascuno.

| Flag | Default | Letto in | Consumato da | Dipende da |
|---|---|---|---|---|
| `F1_TYRE_SLIP_MODEL` | **ON** (spegni con `=0`) | `TyreSlipModel.isTyreSlipModelActive` | `PowertrainModel.applyThrottle`, `BrakingModel.applyBrake`, `SteeringModel.applySteering` | — |
| `F1_CORNERING_GRIP_MODEL` | OFF (accendi con `=1`) | `TyreSlipModel.isCorneringGripModelActive` | `VehiclePhysics.updateVelocity` | — |
| `F1_AERO_DRAG_MODEL` | **ON** (spegni con `=0`) | `AerodynamicsModel.isAeroDragModelActive` | `PowertrainModel.effectiveMaxSpeed` | — |
| `F1_AERO_DOWNFORCE_MODEL` | **ON** (spegni con `=0`) | `AerodynamicsModel.isAeroDownforceModelActive` | `AerodynamicsModel.effectiveGrip`, `CorneringGripModel.lateralExcess` | — |
| `F1_AERO_DAMAGE_MODEL` | **ON** (spegni con `=0`) | `AerodynamicsModel.isAeroDamageModelActive` | `dragFactor`/`downforceFactor` (penalità aggiuntiva da danno ala/fondo) | ha effetto solo se **anche** `F1_AERO_DRAG_MODEL`/`F1_AERO_DOWNFORCE_MODEL` sono attivi |
| `F1_AERO_SLIPSTREAM_MODEL` | **ON** (spegni con `=0`) | `AerodynamicsModel.isAeroSlipstreamModelActive` | `f1GameSocket.computeSlipstreamMult` | — |
| `F1_RACELINE_SUFFIX` (valore stringa, non 0/1) | nessun suffisso | `trackLoader.racelineSuffix` | `trackLoader.loadRacelineData` | — |

**`F1_TYRE_SLIP_MODEL` promosso a ON il 2026-08-11** (wheelspin in uscita
lenta, bloccaggio in staccata, e il bloccaggio riduce anche lo sterzo). Non
era spento per un difetto: la Fase 3.1 aveva tarato le soglie ma il playtest
di promozione non era mai stato fatto. Misurato con `f1LapSimulator` prima di
accendere, 30 giri per configurazione con parametri bot deterministici: il
giro costa **+0.80s su prova (1.7%)** e **+0.25s su new-monza (0.7%)**, con
30 giri su 30 completati — i bot non finiscono fuori e le racing line
precalcolate (ottimizzate col flag spento) restano valide, non vanno
rigenerate.

Accendendolo sono emerse **due trappole NaN** ormai chiuse, che valgono come
avvertimento per chi promuoverà il prossimo flag: `brakingExcess` riceveva
`inputs.brake` e `TyreForceModel.brakingFactor` riceveva `p.tyreWear`, e da
entrambi un campo assente produceva `NaN` — che `clamp01` non trattiene
(`Math.min`/`Math.max` lo propagano) e che da `SteeringModel` sarebbe arrivato
fino a `p.angle`, facendo sparire l'auto dal tracciato. Finché il flag era
spento quel percorso era morto. Ora `tractionDemand`/`brakingDemand` e
`getWearPenaltyFactor` trattano il campo assente come zero.

I test che misurano formule a valore esatto (`VehiclePhysics.test.js`,
`VehicleDynamics.test.js` a livello di file; singoli casi in
`PowertrainModel`/`BrakingModel`/`f1GameSocket.physics`) sono ancorati a
`F1_TYRE_SLIP_MODEL='0'`: caratterizzano la composizione delle formule, non la
taratura dello slittamento, che ha i suoi test dedicati. ⚠️ Non ancorare un
file INTERO se al suo interno qualche caso fa `delete process.env...` in un
`finally`: la cancellazione riporta al default, che ora è ON.

`F1_RACELINE_SUFFIX=-sa` carica `<trackId>-sa-raceline.json` invece del file
di produzione `<trackId>-raceline.json` (stessa cartella `backend/tools/`) —
per playtestare in localhost un candidato generato da
`f1RaceLineOptimizer.js --out-suffix=-sa` senza sovrascrivere quello reale.

`F1_TYRE_FORCE_MODEL` è **rimosso** (Fase 2B, non esiste più come flag
attivo: `TyreForceModel` è ora l'unica fonte, sempre attiva) — resta solo
nei commenti/test come riferimento storico ("non confondere con...").
`F1_TYRE_SLIP_DEBUG=1` non è un flag di confronto ma un logging di debug
temporaneo in `PowertrainModel.applyThrottle` (solo umano, non bot) — da
rimuovere quando l'effetto sarà validato definitivamente.

Rif. design/roadmap Fase Aero: `docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md`.

## Racing line precalcolata per i bot (`backend/tools/f1RaceLineOptimizer.js`)

I bot IA seguono, quando disponibile, una **linea di guida precalcolata offline**
per pista invece di calcolare l'apice delle curve in tempo reale — più veloce
e senza rischio di uscire di pista sulle chicane strette (vedi
`docs/superpowers/specs/2026-07-24-f1-bot-cornering-redesign-design.md` per il
perché il calcolo a runtime è stato abbandonato).

### Come generare la linea per una pista nuova

Dopo aver creato/salvato la pista con l'editor (`frontend/tracks/<id>.json`
deve già esistere), dalla cartella `backend/`:

```
node tools/f1RaceLineOptimizer.js <trackId>
```

Esempio per più piste in una volta:

```
node tools/f1RaceLineOptimizer.js monza prova --hops=30
```

- `--hops=N` (default 30): quante perturbazioni casuali extra tentare dopo
  l'ottimizzazione principale, per uscire da eventuali ottimi locali. Più alto
  = risultato potenzialmente migliore ma più lento. 30 è un buon compromesso;
  usare 40-50 solo se si vuole spremere l'ultimo mezzo secondo.
- Tempo di calcolo: qualche minuto per pista (scala con la lunghezza del
  giro — una pista 2x più lunga di Monza impiega circa 2x).
- Scrive `backend/tools/<trackId>-raceline.json` — **questo è l'unico file
  che serve**: `trackLoader.js` lo carica automaticamente all'avvio del
  server se esiste, nessun'altra configurazione necessaria.
- Se il file non esiste per una pista, il bot usa il calcolo geometrico a
  runtime di sempre (nessuna differenza rispetto a prima) — è un fallback
  sicuro, non un errore.

### Quando rigenerarla

- **Ogni volta che la GEOMETRIA della pista cambia** (punti di controllo
  spostati, pista ridisegnata) — la linea salvata è tarata sulla forma
  esatta di quel momento; su una pista modificata resta comunque "legale"
  (non manda mai fuori pista, l'ottimizzatore si autolimita) ma non più
  ottimale.
- Non serve rigenerarla se cambi solo `roadHalfWidth`/nome/altri metadati
  non geometrici — ma in caso di dubbio, ri-lanciare il comando non fa mai
  danno (sovrascrive il file esistente).

### Bisogna riavviare il server?

Sì — `trackLoader.js` mette in cache la pista al primo caricamento nel
processo; un server già in esecuzione non vede un file `-raceline.json`
nuovo o aggiornato finché non viene riavviato.

### Verifica rapida senza aprire il browser

```
node tools/f1LapSimulator.js <trackId>
```

Usa la fisica esatta del gioco (nessuna duplicazione): se la racing line
è attiva, il tempo dovrebbe essere sensibilmente più basso del calcolo a
runtime "vecchio stile" — confrontabile lanciando lo stesso comando dopo
aver rinominato temporaneamente `<trackId>-raceline.json`.

### Nota sul tempo mostrato in gioco vs il simulatore

Il tempo mostrato **in partita reale** (qualifica/gara) è quasi sempre più
alto di quello del simulatore, per bot E umano allo stesso modo — misurato:
il timer di Windows/Node non riesce a far scattare il tick di gioco (50ms)
con precisione, quindi il gioco gira leggermente più lento in tempo reale
(non è un bug della racing line, né qualcosa che vale la pena rincorrere:
essendo uniforme su tutti i piloti non cambia l'equilibrio della gara). Usare
`f1LapSimulator.js`/`f1RaceLineOptimizer.js` come riferimento per confrontare
"prima vs dopo", non aspettarsi che il numero mostrato in gioco combaci
esattamente.

---

## Asset voxel del circuito (`frontend/assets/custom/circuit/`)

Catalogo di 16 modelli custom in stile voxel che sostituiscono la
scenografia importata dal Kenney Racing Kit. Spec:
`docs/superpowers/specs/2026-08-09-f1-circuit-voxel-assets-design.md`,
piano: `docs/superpowers/plans/2026-08-09-f1-circuit-voxel-assets.md`.

### Rigenerare

```
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/f1CircuitAssetsBuilder.py
```

Con `-- --asset grandStand,podium` ne costruisce solo alcuni, con
`-- --no-render` salta i render. Sorgenti: `backend/tools/voxelKit.py`
(libreria condivisa) + un modulo per famiglia in
`backend/tools/circuitAssets/`. Render in `backend/tools/renders/circuit/`.

### Verifiche

```
node --test backend/tools/circuitAssets.test.js     # invarianti geometrici
blender --background --python backend/tools/circuitAssetsBlackCheck.py
```

Il secondo è il controllo che ha pescato quasi tutti i difetti di
modellazione: rende ogni asset con ambiente bianco e **nessuna luce**, così
nessun pixel può essere scuro per via di un'ombra — ogni pixel nero residuo
è per forza un buco o uno z-fighting, e per quelli trovati stampa le
coordinate mondo via raycast. Va rilanciato dopo ogni modifica alla
geometria.

### Budget di rendering

```
node backend/tools/f1-costo-scenografia.js [tracciato ...]
```

Stampa istanze e triangoli per categoria, e la classifica degli asset che
costano più draw call.

⚠️ **Il numero che conta non è il triangolo** — gli asset del circuito sono
leggeri — **ma l'`InstancedMesh`**: `f1.js::loadScenery` ne crea uno per ogni
mesh di ogni asset in ogni cella di `sceneryChunks`, e ognuno è una draw call.
Il GLTFLoader spezza per materiale, quindi a parità di istanze **un asset con
sei materiali costa il doppio di uno con tre**: è la ragione per cui i modelli
nuovi vanno tenuti sotto i quattro materiali invece di arrivare al tetto di
sei imposto da `kit.finish()`.

Le draw call NON sono attribuibili a una categoria: un `InstancedMesh`
contiene tutte le istanze di un asset in una cella, quali che siano le
categorie che lo usano — `billboardLow`, `flagPole` e `pylon` per esempio
stanno sia nel decoro del paddock sia fra le infrastrutture. Per quelle vale
solo la classifica per asset.

Riferimento al 2026-08-14 su `prova`: 7344 istanze, 779 `InstancedMesh`,
1698k triangoli. I due blocchi grossi sono la folla (746k) e le barriere di
gomme (369k). Scomposizione del salto rispetto alle 670 draw call di prima
delle infrastrutture: vedi «Infrastrutture distribuite» più sotto.

### Convenzioni NON ovvie (violarle rompe l'asset)

- **Scala 1:1 in unità di gioco.** Questi asset NON vanno scalati
  all'istanza (`scale: 1`), a differenza dei Kenney (`KENNEY_MODEL_SCALE = 6`
  in `trackScenery.js`) e dei custom preesistenti (`3.5` per
  `f1Car.glb`/`f1PitBox.glb`). Riferimento: l'auto in gioco è 3.47 larga ×
  7.17 lunga × 1.79 alta; 1 unità ≈ 0.78 m.
- **Fronte verso +Z gioco** (= −Y in Blender: l'export mappa
  `(x,y,z)_blender → (x,z,−y)_gltf`). È la convenzione che `trackScenery.js`
  assume con `rotY = atan2(p.x-x, p.z-z)`. `f1PitBox.glb` la viola e per
  questo `pitBoxLoader.js` compensa con `−π/2`: qui non serve.
- **Pivot alla base** (Y=0) e centrato in XZ, perché il layout piazza gli
  oggetti a `terrainHeightAt(...)`. Unica eccezione: `flagPole`, il cui pivot
  è l'asta e non il centro dell'ingombro.
- **Massimo 6 materiali per asset.** `f1.js::loadScenery` crea un
  `InstancedMesh` per ogni mesh del GLB e il GLTFLoader spezza per materiale:
  N materiali = N draw call. `kit.finish()` solleva `ValueError` oltre 6.
- **Niente volumi cavi e niente facce complanari sovrapposte** — le due
  cause delle macchie nere. Volumi che condividono un piano esterno
  (segmenti dello stesso muro) vanno CONTIGUI; volumi che si compenetrano di
  proposito devono avere facce non complanari. Dettagli in testa a
  `voxelKit.py`.

### Dimensioni misurate (unità di gioco)

Servono a chi farà l'integrazione: le costanti di piazzamento in
`trackScenery.js` sono ancora tarate sui Kenney e vanno ritarate su questi.

| asset | largh (X) | alt (Y) | prof (Z) | mesh |
|---|---|---|---|---|
| `grandStand` | 19.2 | 12.3 | 12.8 | 6 |
| `grandStandAwning` | 19.2 | 16.0 | 13.3 | 6 |
| `grandStandCovered` | 19.2 | 14.7 | 13.2 | 6 |
| `billboard` | 16.4 | 12.9 | 1.6 | 6 |
| `billboardLow` | 16.4 | 4.5 | 1.4 | 5 |
| `pitsGarageClosed` | 20.6 | 8.3 | 14.7 | 6 |
| `pitsOffice` | 20.7 | 13.1 | 14.9 | 6 |
| `raceControlTower` | 14.6 | 33.7 | 12.6 | 5 |
| `startGantry` | 34.5 | 16.0 | 2.4 | 6 |
| `podium` | 12.0 | 9.0 | 7.1 | 8 |
| `tyreStack` | 7.0 | 1.9 | 2.4 | 3 |
| `catchFence` | 12.0 | 9.0 | 0.5 | 3 |
| `marshalPost` | 5.5 | 8.9 | 4.5 | 6 |
| `pylon` | 6.4 | 26.2 | 3.0 | 6 |
| `flagPole` | 5.4 | 15.0 | 1.6 | 4 |
| `paddockTent` | 16.8 | 7.2 | 13.0 | 5 |
| `giantScreen` | 15.0 | 17.9 | 2.5 | 5 |
| `floodlightTower` | 7.6 | 32.5 | 4.0 | 4 |
| `hospitalityDeck` | 16.0 | 9.7 | 11.0 | 4 |
| `vipSuite` | 16.3 | 12.1 | 12.5 | 5 |
| `serviceBuilding` | 13.6 | 16.1 | 12.1 | 5 |
| `tvTower` | 4.8 | 15.2 | 5.4 | 5 |
| `recoveryCrane` | 10.3 | 15.0 | 12.4 | 4 |
| `trackGate` | 9.3 | 5.2 | 1.5 | 5 |

Note per il piazzamento:
- `grandStand` è l'unico pensato per essere **impilato** (2 livelli in
  `buildMainGrandstandLayout`): passo di impilamento 12.3, sommità piatta.
  Le due varianti coperte non sono impilabili.
- `tyreStack` (passo 7) e `catchFence` (passo 12) sono **moduli
  componibili**: niente sporge oltre il passo, così due moduli affiancati non
  si compenetrano.
- `startGantry` ha luce interna 27 unità: scavalca una pista larga 22 a
  scala 1; per tracciati più larghi va scalato.
- I 3 gradini di `podium` sono nodi distinti e nominati
  (`podium_step_p1/p2/p3`), predisposti per una futura cerimonia — che NON
  è implementata.

### Infrastrutture distribuite

`frontend/shared/sceneryInfrastructure.js` cammina il giro a passo di 25 unità
e posa un'infrastruttura per punto e per lato, scegliendo dalla palette di
`trackScenery.js` (`PALETTE_INFRASTRUTTURE`) il primo asset il cui contesto
combacia e che superi i sette vincoli. I contesti sono `viadotto`, `stretto`
(muro della via di fuga ≤ 20), `curvaEsterno`, `rettilineo` (visuale lunga) e
`aperto`, che fa da rete per gli ultimi due.

Quanto circuito resti senza niente di fianco si misura con
`frontend/shared/sceneryGaps.js`, e i tetti stanno in `VUOTI_ATTESI` dentro
`trackScenery.test.js`: **si stringono, mai si allargano**.

⚠️ Nella palette vanno **volumi**, non segnaletica: cartelloni e pennoni
sparsi sono stati provati il 2026-08-13 e bocciati al playtest.

**Spettatori sulle terrazze.** `hospitalityDeck` e `vipSuite` sono tribune, e
vuote si leggono come edifici chiusi: `SceneryCrowd.buildTerraceCrowd` ci posa
sopra `spectatorStandA`/`B` leggendo le ancore da
`frontend/assets/custom/circuit/terraceAnchors.json`, generato dal builder
(`infrastructure.terrace_anchors()`) come i sedili delle tribune. Budget
proprio, `MAX_TERRACE = 900`, separato da `MAX_TOTAL`: pescare dal budget
delle tribune lascerebbe le terrazze deserte ogni volta che le tribune
crescono.

**Costo, misurato il 2026-08-14 su `prova`** (`f1-costo-scenografia.js`):
7344 istanze, 779 InstancedMesh, 1698k triangoli, contro le 670 InstancedMesh
e 1661k triangoli di prima. Il delta si scompone così: **+37 draw call gli
otto edifici** (43 istanze, 4-5 mesh l'una, sparse su molte celle) e **+72 gli
spettatori delle terrazze** — 2 varianti × 4 mesh × 9 celle, indipendenti dal
numero di figure. Chi dovesse rientrare in un budget di draw call ha lì il
taglio più grosso a parità di volumi: una sola variante ne restituisce 36.

### Seconda tornata (2026-08-09): figure, bordo pista, box giocatore

Nove asset aggiunti dopo i 16 iniziali, stessa pipeline e stesse convenzioni.

| asset | largh (X) | alt (Y) | prof (Z) | mesh |
|---|---|---|---|---|
| `spectatorA` / `B` / `C` | 0.6 | 1.4 | 0.7 | 4 |
| `pitCrew` | 1.0 | 2.3 | 0.5 | 5 |
| `pitCrewKneel` | 0.9 | 1.6 | 1.2 | 5 |
| `brakingBoard` | 2.2 | 3.1 | 0.7 | 4 |
| `concreteBarrier` | 6.0 | 1.4 | 1.4 | 3 |
| `footbridge` | 36.5 | 13.3 | 4.5 | 5 |
| `pitBox` | 21.8 | 10.0 | 22.0 | 6 |

**Spettatori.** Le tribune sono modellate VUOTE e gli spettatori si
istanziano a parte: così una tribuna può essere piena, mezza vuota o
deserta senza moltiplicare i modelli. Le posizioni dei posti stanno in
`frontend/assets/custom/circuit/grandStandSeats.json` (108 per tribuna, in
coordinate gioco relative all'origine della tribuna, pivot dello spettatore
ai piedi), **generate dalla stessa funzione che genera i sedili**
(`grandstands.seat_anchors()`): se cambia il passo dei sedili le posizioni
seguono da sole. Il file è rigenerato a ogni run del builder — non
modificarlo a mano. Le 3 varianti differiscono solo per incarnato e colore
della maglia: vanno alternate per dare varietà alla folla.

**`concreteBarrier` e `brakingBoard`** sono moduli ripetibili come
`tyreStack`: passo di affiancamento 6 per la barriera, niente sporge oltre.

**`pitBox` sostituisce `frontend/assets/custom/f1PitBox.glb`** (il vecchio
file resta in repo ma non è più caricato da nessuno). Tre differenze che
toccano il codice, non solo l'aspetto:

1. **Scala 1:1 e fronte su +Z.** `pitBoxLoader.js` non applica più il
   fattore 3.5 né la correzione di rotazione `-π/2` che serviva perché il
   vecchio modello aveva l'apertura lungo +X.
2. **Ricolore per materiale, non per texel.** Il colore del giocatore si
   applica al materiale il cui nome finisce per `_livery`
   (`applyLiveryColor`). Prima si campionava una texture palette 256×1
   cercando i texel "abbastanza rossi" con soglie di tinta/saturazione e si
   riscriveva la texture su un canvas a ogni caricamento. Chi rigenera il
   modello: tutto ciò che deve prendere il colore del pilota va modellato
   col colore `livery` e nient'altro — un test in `pitBoxLoader.test.js`
   verifica che nel `.glb` reale ci sia esattamente un materiale livrea.
3. **Larghezza vincolata a 21.8.** Non è una scelta estetica:
   `TrackGeometry.PIT_BOX_SPACING = 24` è la spaziatura fra box lungo la
   corsia ed è condivisa con l'autopilota server-side, quindi determina dove
   le auto si fermano davvero. Un box più largo va bene solo cambiando
   ANCHE quella costante, con un playtest a seguire.

**Bug trovato e corretto in questa tornata**: `trackScenery.js` usava
`PLAYER_BOX_OFFSET_MARGIN = 13.2` mentre `pitBoxLoader.js` piazzava i box a
`11.2 + 12 = 23.2` — 10 unità di scarto, rimaste da quando
`PIT_BOX_CLEARANCE` passò da 2 a 12 aggiornando un solo lato. La zona
protetta dalla scenografia era quindi fuori posto e alberi o cartelloni
potevano finire dentro i box. Ora le due costanti sono confrontate da un
test in `trackScenery.test.js`.

### Integrazione nella scenografia (2026-08-09)

Spec: `docs/superpowers/specs/2026-08-09-f1-scenery-integration-design.md`,
piano: `docs/superpowers/plans/2026-08-09-f1-scenery-integration.md`.

`trackScenery.js` resta il punto d'ingresso (`generateLayout`) e conserva le
categorie storiche (natura, tribune, paddock, laghetto). Le categorie nuove
stanno in tre moduli separati per **criterio di piazzamento**, non per tipo
di oggetto:

| modulo | cosa piazza | criterio |
|---|---|---|
| `sceneryLandmarks.js` | torre direzione, ponte semafori, podio, passerella | uno per tracciato, ancorati a `trackPts[0]` |
| `sceneryTrackside.js` | gomme, cartelli frenata, commissari, reti, barriere cemento, pylon/bandiere/tende | curvatura del tracciato e posizione delle tribune |
| `sceneryCrowd.js` | spettatori | coordinate **relative alla tribuna**, da `grandStandSeats.json` |

Cose non ovvie, tutte già costate un errore:

- **`TrackGeometry.curvatureAt(pts, i)`** è il prerequisito di tutto ciò che
  va "in curva". Il raggio si ottiene dividendo l'arco per **2×** l'angolo
  fra le direzioni: l'angolo corrisponde all'arco fra i punti medi dei due
  segmenti, non alla loro somma. Senza il fattore 2 il raggio esce doppio —
  verificato con un cerchio di raggio noto (199.7 invece di 100). Soglia di
  curva `CORNER_RADIUS_MAX = 120`: seleziona il 18-23% dei punti sui tre
  tracciati reali.
- **Ponte semafori e passerella si scalano sulla BARRIERA, non sulla pista**
  (`(barrierDist + 1.5) / semiluce nativa`). Dimensionandoli sulla sola
  carreggiata i piloni finiscono dentro le barriere su tutti i tracciati:
  `barrierDist` è 15 su monte-rosso/prova e 18 su new-monza, contro una
  semiluce nativa di 13.5 (gantry) e 14 (passerella). Sono gli **unici** due
  asset custom istanziati con scala diversa da 1.
- **Il decoro del paddock prova tre collocazioni** prima di rinunciare. Con
  la sola prima (fra pista e corsia box) veniva piazzato 1 elemento su
  monte-rosso e 0 sugli altri due tracciati: lo spazio lì è quasi sempre
  occupato.
- **Gli spettatori vanno ruotati con la tribuna.** I posti sono in coordinate
  locali: senza applicare `rotY` della tribuna finiscono a mezz'aria di
  fianco. `grandStandSeats.json` lo carica `f1.js` e lo passa a
  `generateLayout` come ultimo parametro opzionale, perché `trackScenery.js`
  è un modulo puro e non fa fetch; se manca, si generano tribune vuote invece
  di far fallire il caricamento della pista.

Layout generato (misurato): ~1500 voci su monte-rosso, ~2000 su prova, di cui
la gran parte spettatori. Il costo di rendering non ne risente: `loadScenery`
crea un `InstancedMesh` per mesh e non per istanza, quindi restano ~110 draw
call in tutto.

### Correzioni "circuito vivo" (2026-08-10)

Spec: `docs/superpowers/specs/2026-08-09-f1-circuito-vivo-design.md`,
piano: `docs/superpowers/plans/2026-08-09-f1-circuito-vivo.md`.

Sette difetti emersi al playtest del 2026-08-09. Le cose da sapere prima di
rimettere mano a questo codice:

- **Le file di oggetti si compongono per DISTANZA REALE, non per passo in
  campioni.** `TrackGeometry.advanceToDistance(points, startIndex, dir,
  closed, from, spacing, project)` cammina finché il punto **già offsettato
  di lato** (`project`) raggiunge `spacing`; `advanceToDistancePoint` fa lo
  stesso ma interpola la posizione ESATTA fra due campioni. Le usano la
  tribuna principale e gli edifici della corsia box.
  Il modo ovvio — `Math.round(spacing / stepLen)` campioni — sbaglia due
  volte: l'arrotondamento da solo dava 20.7 al posto di 18.4 (+12%), e
  soprattutto ignora che gli oggetti stanno spostati di lato, quindi su una
  curva percorrono un arco diverso da quello dei campioni. Il risultato
  misurato erano moduli a 14.3 e 17.2 anziché a 18.4: il "buco al traguardo".
  L'interpolazione non è un vezzo: i campioni della pista valgono 5.17 unità
  su "prova", e fermarsi al primo oltre la soglia riapriva un varco di 1.7.
- **`MAIN_STAND_COLS = 7`** e `MAIN_STAND_COL_SPACING = 19.2`, cioè
  esattamente la larghezza del modulo: i moduli si TOCCANO. Non serve più la
  compenetrazione di 0.8 che mascherava i varchi.
  Le tribune sparse hanno `MAIN_STAND_ISOLATION = 45` dalla fila principale:
  o una tribuna continua la fila, o sta altrove — la via di mezzo è il buco.
- **Le strutture si testano col SAT, non con i raggi.**
  `SceneryAssetSizes.itemsOverlap(a, b)` esisteva già, esportato e **non usato
  da nessuna riga**; ora lo usano `sceneryLandmarks` (contro le strutture già
  accettate) e i test. Il criterio a mezza diagonale rende impossibile per
  costruzione qualunque fronte contiguo: 12.65 per edificio, cioè 25.4 fra due
  centri di edifici larghi 20.6 affiancati.
  Il podio finiva dentro un `pitsGarageClosed` per 7.1 unità proprio perché i
  landmark controllavano corsia e box giocatore ma non le altre strutture.
- **L'autopilota box cammina su `track.pitLanePts`** (300 campioni, la stessa
  espressione con cui `f1.js` disegna la corsia), non più sui punti di
  CONTROLLO: in retta fra un controllo e l'altro tagliava le curve, fino a
  3.35 unità dalla linea su una semilarghezza di 5.
  ⚠️ `anchor.laneIdx` (indice sui campioni) e `anchor.fromIdx` (indice sui
  punti di controllo) indicizzano **sequenze diverse**: non sono
  intercambiabili. La posizione fisica dei box non è cambiata, solo il modo di
  raggiungerla. E l'avanzamento consuma `PIT_AUTO_SPEED` unità per tick
  attraversando più waypoint, invece di "punta al waypoint e fermati": con
  campioni a ~1 unità il vecchio schema avrebbe fatto procedere l'auto a
  scatti.
- **`sceneryHills.js` è la fonte UNICA della quota collinare.** La usano
  `trackMeshBuilder.buildGround` (che disegna) e `trackScenery.buildWoodsLayout`
  (che ci pianta gli alberi): se divergessero, gli alberi sarebbero sepolti o
  sospesi. Le colline riusano la griglia del prato lontano — stessa mesh,
  vertici alzati — quindi **zero draw call in più**; le pareti verticali fra
  celle a quote diverse NON sono decorative: senza, si vede attraverso il
  terreno.
  I boschi hanno categoria **`woods`**, non `nature`: prendono la quota dalle
  colline e i controlli sulla natura (quota entro il terrapieno) non li
  descrivono. `isTooCloseToAny` però li tratta come vegetazione, altrimenti
  con `STRUCTURE_CLEARANCE` resterebbe un frutteto rado.
- **Nebbia e cielo devono avere lo stesso colore** (`SKY_COLOR = 0x87CEEB`).
  Con due tinte diverse la linea di stacco resta visibile e la mappa sembra
  infinita. Densità 0.0016 e non 0.0022: a 0.0022 la nebbia era già al 99% a
  1000 unità e le colline sparivano prima di vedersi (`camera.far` è 1200).
- **Il decoro del paddock cerca su DUE assi**, offset laterale *e* posizione
  lungo il giro. I soli tre offset non bastavano: su "prova", nelle prime 55
  unità dal traguardo tutte e tre le collocazioni sono occupate da corsia o
  box giocatore. Prima di questo, `pylon` e `flagPole` avevano **zero istanze
  su tutti e tre i tracciati**.
  ⚠️ Il test relativo sta in `trackScenery.test.js`, non in
  `sceneryTrackside.test.js`: il contesto sintetico di quest'ultimo passa
  `playerBoxFootprints` VUOTO, e con quello il decoro trova sempre posto — un
  test verde che non dimostra nulla. È successo davvero in questa sessione.
- **I meccanici** (`PitBoxLoader.crewPlacements`) stanno dentro la guardia
  `stallMarkersAdded` di `loadPlayerPitBox`: senza, ogni `f1StateUpdate` ne
  aggiungerebbe altri cinque per box. Restano statici (i modelli non sono
  animabili così come sono, vedi `circuitAssets/people.py`).

Layout generato dopo queste correzioni (misurato): 2130 voci su prova, 1851 su
monte-rosso, 2199 su new-monza — la crescita rispetto a prima è quasi tutta
boschi (~200-280 alberi) e spettatori.

#### Secondo giro di correzioni (2026-08-10, dopo playtest)

- **Le colline non erano MAI state disegnate.** `buildGround` estende la
  griglia del prato solo `embankOuter + 20` (= 80) oltre il circuito, mentre
  `SceneryHills` inizia a `embankOuter + 120` (= 180): tutte le celle in
  rilievo cadevano fuori dalla griglia. Misurato: 69 celle in quota su 1710, e
  quelle poche nell'infield. Ora c'è una **seconda griglia a maglia grossa**
  (`HILL_GRID_CELL = 80`, `HILL_REACH = 700`) nella stessa BufferGeometry —
  841 celle, ~8k triangoli, zero draw call in più. Con maglia 20 sarebbero
  state 10506 celle per un dettaglio che a quella distanza non si legge.
  ⚠️ Se si tocca `HILL_START_MARGIN` o `HILL_RAMP`, controllare che
  `HILL_REACH` li copra ancora: è lo stesso errore di prima.
- **Le tribune secondarie sono SCHIERE** (`buildStandRow`, la stessa funzione
  della fila principale): si allungano finché lo slot resta valido, fino a
  `ROW_MAX_COLS = 6`, e sotto `ROW_MIN_COLS = 2` la schiera viene scartata del
  tutto. Una tribuna isolata accanto a una fila lunga si legge come un buco —
  è ciò che l'utente ha segnalato.
  Conseguenza: i posti disponibili sono passati da ~1600 a ~5900, quindi
  `SceneryCrowd` ha ora un tetto `MAX_TOTAL = 3000` che abbassa il
  riempimento di TUTTE le tribune insieme invece di lasciare deserte le
  ultime. Senza, sarebbero ~880.000 triangoli sempre in scena
  (`loadScenery` disattiva il frustum culling).
- **Gli edifici decorativi della corsia box si allineano ai BOX GIOCATORE**
  (`PIT_BUILDING_OFFSET_MARGIN` da 10 a **19.4**), non alla corsia. A 10
  stavano a 15 unità dall'asse mentre i box sono a 28: erano DAVANTI alla
  fila, in mezzo allo spazio di manovra, e uno faceva da muro davanti
  all'ultimo box. Ora fronte decorativo e fronte dei box sono la stessa fila.
- **Il grembiule davanti al box** (`playerBoxApronCorners`) protegge la fascia
  fra bordo corsia e fronte del garage: è dove l'auto si ferma (lo stallo sta
  a `pitRoadHalf + PIT_STALL_CLEARANCE`) e dove sterza per uscire. Prima era
  protetto solo il garage.
  ⚠️ Il filtro usa `itemHitsPlayerBoxZone` (SAT sugli ANGOLI), non
  `insidePlayerBoxFootprint` sul solo centro: un edificio profondo 14.7 può
  avere il centro fuori e sporgerci dentro con mezzo fianco — ed è
  esattamente quello che succedeva.
  Conseguenza misurata: su monte-rosso gli edifici decorativi scendono a
  **zero**, perché i sei box più il loro grembiule occupano tutti i 233
  campioni utili di una corsia lunga 368. È corretto: lì il fronte lo fanno i
  box veri.
- **I meccanici non devono cadere sullo stallo.** `STALL_LZ` è DERIVATA
  (`PIT_BOX_OFFSET_MARGIN - PIT_STALL_CLEARANCE`), non ricopiata: è la
  distanza fra centro box e auto ferma, e vale 13 su ogni pista. Gli
  inginocchiati stavano esattamente lì e si vedevano dentro la macchina; ora
  stanno a fianco del muso e della coda, oltre `CAR_HALF_LENGTH`. Scala
  `CREW_SCALE = 1.25` per presenza scenica, stessa logica del 6× dei Kenney.

---

## Vie di fuga, muro solido, terreno (2026-08-12)

Il circuito è **fisicamente chiuso**: la barriera è un muro anche fuori dai
ponti. È stato possibile solo dopo aver arretrato la barriera con le vie di
fuga — a 4 unità dal cordolo, com'era, ogni pista sarebbe diventata Monte
Carlo. Spec `docs/superpowers/specs/2026-08-10-f1-vie-di-fuga-ghiaia-design.md`,
piano `docs/superpowers/plans/2026-08-10-f1-vie-di-fuga-ghiaia.md`.

### Chi decide cosa

- `TrackGravel.barrierProfile` è la **sorgente unica** della distanza del muro,
  campione per campione e lato per lato. Ne derivano: la barriera disegnata, la
  banda di ghiaia, la traslazione della scenografia e il muro fisico lato
  server. Chi ne aggiunge un quinto consumatore deve passare di lì.
- `trackLoader` espone `barrierProfile` e `pitGapPts` calcolandoli con le
  stesse funzioni condivise del client. Un test in `trackLoader.test.js` rifà
  la catena di input del client e pretende che i due profili coincidano
  campione per campione: se divergessero, in gioco si sbatterebbe contro un
  muro invisibile.
- `applyBridgeBarrier` non esiste più: si chiama `applyBarrier` e vale su tutto
  il giro. Senza `barrierProfile` (editor, test storici) torna al
  comportamento vecchio, muro solo sui ponti.

### Due funzioni di quota del terreno, non una

- `TrackGeometry.terrainHeightAt` = superficie **ideale**, dal campione più
  vicino. La usano oggetti e fisica.
- `TrackGeometry.terrainTopAt` = terreno **disegnato**, cioè il più alto dei
  settori sovrapposti. La usa la barriera per posarci il piede.

Divergono in curva mentre la pista sale, dove i settori del terrapieno si
accavallano: usare la prima al posto della seconda seppelliva la barriera sotto
il terreno per 20 unità di pista. Il criterio di quali campioni coprono un
punto è per **settore** (la fascia fra la normale di un campione e quella del
successivo), mai a raggio: a raggio la barriera si alzava fino a 3.75 unità
sopra il terreno in 179 campioni di prova.

### Territorio: dove il tracciato si ripiega su se stesso

`TrackGeometry.neighbourLimits` dice fin dove ogni campione può estendersi
prima di finire su un altro tratto di pista, e a che quota riprende il terreno
di là. Il confine cade sulla mezzeria, in forma chiusa (`r = |PQ|²/(2·N·PQ)`).
La usano il terrapieno (dove tagliare gli anelli) e il profilo della barriera
(dove smettere di arretrare).

⚠️ Tre cose provate, misurate e scartate — non ritentarle senza una misura
nuova:
- **margine di sovrapposizione** fra due terrapieni al confine: non chiude
  nessuna fessura e porta 6 unità di scarto di quota dove i tratti affiancati
  corrono a quote diverse;
- **livellare il confine** lungo la pista: lascia scoperti 4 campioni di
  terreno su prova e 59 su new-monza, perché accorciare dove il vicino non
  arriva significa che non disegna più nessuno;
- **chiusura morfologica** sul profilo del muro contro la fisarmonica: non
  cambia un solo campione, perché tutti i restringimenti rimasti sono imposti
  dal territorio.

### La scenografia trasla, ma certe cose insieme

`traslaOltreLaGhiaia` sposta ogni voce oltre il muro. Due categorie NON possono
essere spostate voce per voce:
- le **schiere di tribune** hanno un `group` e traslano rigide, del massimo fra
  gli spostamenti dei loro moduli. Senza, la fila si accartoccia e i moduli si
  compenetrano (misurate 8 coppie su prova, la peggiore a 10.7 invece di 19.2).
- gli **spettatori** si generano DOPO la traslazione, perché i loro posti sono
  in coordinate locali alla tribuna. Generandoli prima, 2394 su 2983 finivano
  fuori dai gradoni. Usano un RNG separato per non spostare gli scatter
  successivi (alberi, rocce) su tracciati già approvati.

### Terreno

Erba e ghiaia sono screziate con **vertex color** ricavati dalla posizione nel
mondo (macchie da 9 unità, ampiezza 6%): niente texture, stessa tinta a ogni
caricamento, e mesh che si toccano combaciano sul confine. Il motore
cel-shaded li conserva. La ghiaia sfuma verso l'erba dove la banda si
assottiglia — è l'unico punto dove il confine si vede, perché sui lati lunghi
lo nasconde la barriera.

Nel tratto del traguardo/box il muro resta stretto su ENTRAMBI i lati e la
ghiaia non entra: la corsia box corre da una parte sola, ma il tratto va tenuto
com'è tutto intero (richiesta dell'utente). Lasciando entrare la ghiaia, il
muro sul lato libero faceva 15 → 45.7 → 15 → 33.8 in 200 unità di pista.

## Segnalazioni in gioco (tasto M) — 2026-08-12

Durante una gara in locale, `M` registra dove sei e dove stai guardando;
`Shift+M` annulla l'ultima. Il numero che compare a schermo è quello scritto
nel file, assegnato dal server: client e file non possono divergere.

- Le route stanno in `backend/dev/segnalazioniRoutes.js` e sono attive solo
  fuori produzione, come `/dev/minimap`. **Il server va riavviato** dopo un
  aggiornamento del backend, altrimenti rispondono 404.
- Il file è `backend/tools/f1-segnalazioni.json` (in `.gitignore`).
- Per rileggerle: `node backend/tools/f1-segnalazioni.js`. Stampa, per ogni
  punto, la posizione sul giro e i cinque elementi di scenografia più vicini
  con distanza e verso rispetto al muso ("davanti", "a destra"…).

Il tool rigenera la scenografia con `TrackScenery.generateLayout` partendo da
`trackLoader`, mentre il gioco la genera con una catena sua
(`frontend/f1.js:155-247` e `655`). Che le due coincidano **non è ovvio** ed è
l'unico modo in cui questo tool può sbagliare in silenzio: se divergono,
stampa nomi di oggetti che il giocatore non aveva davanti. L'invariante è
protetta da quattro test in `backend/tools/f1-segnalazioni.test.js`, uno per
tracciato, che replicano la catena del client e pretendono layout identici.
**Se tocchi quella catena in f1.js, quei test sono la prima cosa da rilanciare.**
