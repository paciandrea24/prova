# F1 — integrazione dei 25 asset voxel nella scenografia del circuito

## Problema

I 25 asset voxel custom (`frontend/assets/custom/circuit/`, vedi
`docs/f1-notes.md`) sono modellati, verificati e approvati, ma **in partita
non se ne vede nessuno**: `frontend/f1.js::loadScenery` carica ancora i 7
`.glb` Kenney, e le 12 categorie nuove non sono piazzate da nessuna parte.

Due ostacoli tecnici, entrambi già misurati:

1. **Le costanti di piazzamento in `frontend/shared/trackScenery.js` sono
   tarate sui Kenney**, che sono ~3 volte più piccoli. Il modulo tribuna
   passa da 6.0 × 5.38 a 19.2 × 12.3 unità: con le costanti attuali i moduli
   si compenetrerebbero fra loro e con i cartelloni.
2. **Il codice condiviso non sa dove sono le curve.** Barriere di pneumatici,
   cartelli di frenata e commissari hanno senso solo in punti precisi del
   tracciato. `backend/sockets/games/f1Bot.js` calcola un raggio di curvatura
   ma è server-side, mentre la scenografia è frontend: non è riusabile.

## Decisioni prese (brainstorming 2026-08-09)

- **Tre fasi verificabili**, ognuna da provare in localhost prima della
  successiva. La Fase 1 non aggiunge elementi nuovi: cambia solo i modelli
  usati, quindi isola il rischio della ritaratura.
- **Tribuna principale a 3 moduli × 2 livelli** (57.6 × 24.6 unità). A 6
  moduli sarebbe stata lunga 115 unità — un decimo del giro su monte-rosso —
  e avrebbe sfondato la finestra dei cartelloni sponsor (60 unità).
- **Rilevamento curve vero**, non distribuzione uniforme: senza, si
  otterrebbero barriere di pneumatici in mezzo ai rettilinei e cartelli di
  frenata dove non si frena.
- **Spettatori con riempimento variabile 65–100%**, deterministico dal PRNG
  già seedato sull'id del tracciato.

## Architettura

`trackScenery.js` resta il punto d'ingresso (`generateLayout`) e conserva le
categorie attuali (natura, tribune, paddock, laghetto). Le nuove categorie
vanno in tre moduli separati, uno per fase, perché i criteri di piazzamento
sono di natura diversa e il file è già il più denso della cartella (476
righe; con dodici funzioni in più supererebbe le 900).

**File creati:**
- `frontend/shared/sceneryLandmarks.js` — elementi unici ancorati a punti
  notevoli del tracciato (Fase 2).
- `frontend/shared/sceneryTrackside.js` — elementi distribuiti lungo il giro
  in base alla curvatura (Fase 3).
- `frontend/shared/sceneryCrowd.js` — spettatori: unico caso di istanze
  posizionate **relativamente a un altro oggetto** (le tribune) e non al
  tracciato (Fase 3).

**File modificati:**
- `frontend/shared/trackScenery.js` — costanti ritarate, chiamata ai nuovi
  moduli, `scale: 1` per gli asset custom.
- `frontend/shared/trackGeometry.js` — nuova `curvatureAt()`.
- `frontend/f1.js` — `SCENERY_ASSET_PATHS` verso il catalogo custom, fetch di
  `grandStandSeats.json`.
- `frontend/f1.html` — cache-busting dei moduli toccati (convenzione di
  progetto: senza il bump il browser serve il JS vecchio).

Ogni modulo nuovo espone **una sola funzione** che ritorna una lista di voci
di layout nello stesso formato già in uso
(`{ asset, category, x, y, z, rotY, scale }`), così `loadScenery` in `f1.js`
non cambia struttura: continua a raggruppare per asset e creare un
`InstancedMesh` per mesh.

**Interfaccia degli spettatori.** `trackScenery.js` è un modulo puro senza
accesso alla rete, quindi non può leggere `grandStandSeats.json` da sé: il
file lo carica `f1.js` e lo passa come **ultimo parametro opzionale** di
`generateLayout(trackData, trackPts, pitPts, barrierDist, embankmentWidth,
seatAnchors)`. Se manca, il layout viene generato senza spettatori invece di
fallire — e i test esistenti, che chiamano la funzione con 4 argomenti,
continuano a valere senza modifiche.

## Fase 1 — Sostituzione e ritaratura

`SCENERY_ASSET_PATHS` punta a `/assets/custom/circuit/<id>.glb` per i 7
sostituti. `KENNEY_MODEL_SCALE = 6` **resta**, ma serve solo a
`treeLarge`/`treeSmall`, che per scelta dell'utente restano Kenney. Le voci
di layout degli asset custom emettono `scale: 1`.

Costanti in `trackScenery.js`, ritarate sulle dimensioni misurate:

| costante | oggi | nuovo | motivo |
|---|---|---|---|
| `MAIN_STAND_COLS` | 6 | 3 | vedi decisioni |
| `MAIN_STAND_COL_SPACING` | 6.0 | 19.4 | larghezza reale 19.2 + gap |
| `MAIN_STAND_TIER_HEIGHT` | 5.4 | 12.3 | altezza reale del modulo |
| `MAIN_STAND_OFFSET_MARGIN` | 10 | 14 | mezza profondità 6.4 + ingombro cartelloni |
| `GRANDSTAND_OFFSET_MARGIN` | 6 | 10 | mezza profondità 6.4 |
| `GRANDSTAND_PIT_MARGIN` | 20 | 24 | mezza diagonale della tribuna |
| `START_SPACING` | 12 | 20 | cartelloni larghi 16.4: a 12 si compenetrano |
| `PADDOCK_PIT_CLEARANCE` | 4 | 5 | mezza profondità cartellone 0.8 + margine |
| `PIT_BUILDING_OFFSET_MARGIN` | 6 | 10 | garage profondo 14.7 |
| `PIT_BUILDING_STEP_SAMPLES` | 25 | **sostituita** da `PIT_BUILDING_STEP_LEN = 24` | gli edifici sono larghi 20.6; un passo espresso in campioni dipende dalla lunghezza della corsia e non garantisce alcuna distanza reale, quindi la costante cambia unità di misura e nome |
| `STRUCTURE_CLEARANCE` | 18 | 22 | strutture più grandi |

`MAIN_STAND_HALF_SPAN` è derivata e si aggiorna da sé (3 × 19.4 / 2 = 29.1).

## Fase 2 — Landmark (`sceneryLandmarks.js`)

Quattro elementi unici per tracciato, ancorati a `trackPts[0]` (il traguardo,
lo stesso riferimento già usato da `buildStartLine` e dai cartelloni) e al
lato calcolato da `mainStandSide()`.

- **`raceControlTower`** — lato corsia box, offset `barrierDist + 20`, rivolta
  alla pista. È alta 33.7: va tenuta lontana dalla tribuna principale
  (`MAIN_STAND_HALF_SPAN`) per non compenetrarla.
- **`startGantry`** — a cavallo della pista sulla griglia.
- **`podium`** — nel paddock dietro la fila dei box, rivolto alla corsia,
  escluso dall'ingombro dei box giocatore via `insidePlayerBoxFootprint`.
- **`footbridge`** — a cavallo della pista, sul lato opposto del giro rispetto
  al gantry (indice `n/2`), per non sovrapporsi né duplicare la silhouette.

**Scala di gantry e passerella — vincolo non ovvio.** Devono scavalcare non
la pista ma **la barriera**, che sta a `barrierDist = roadHalfWidth + 2.8 +
1.2` dal centro: dimensionandoli sulla sola larghezza pista, i piloni
finirebbero dentro le barriere su tutti i tracciati esistenti. La luce
interna nativa è 27 per il gantry (piloni a ±15, larghi 3 → filo interno
13.5) e 28 per la passerella (torri a ±16, larghe 4 → filo interno 14).
Quindi:

```
gantryScale     = (barrierDist + 1.5) / 13.5
footbridgeScale = (barrierDist + 1.5) / 14
```

Valori risultanti: 1.22 e 1.18 su monte-rosso/prova (`barrierDist` 15), 1.44 e
1.39 su new-monza (`barrierDist` 18).

## Fase 3 — Distribuiti e folla

### `TrackGeometry.curvatureAt(pts, i, sampleSpan)`

Ritorna `{ radius, turnSigned }` per il punto `i`: raggio di curvatura in
unità (Infinity sui rettilinei) e verso della sterzata (segno). Si ricava
dall'angolo fra le tangenti a distanza `sampleSpan` prima e dopo, diviso per
la lunghezza d'arco — stessa relazione già usata dal bot server-side, qui
riscritta nel modulo condiviso e coperta da test propri.

### `sceneryTrackside.js`

**Soglia di curva**, unica e condivisa da tutte le categorie che ne dipendono:
`CORNER_RADIUS_MAX = 120` unità. Un punto è "in curva" se
`curvatureAt(...).radius < 120`; punti consecutivi che soddisfano la
condizione formano una curva, e curve separate da meno di 40 unità vengono
unite in una sola (altrimenti una parabolica leggermente irregolare si
spezza in tre curve e riceve tre volte gli stessi oggetti). Curve più corte
di 25 unità d'arco vengono scartate: sono increspature, non curve.

- **`tyreStack`** — all'**esterno** delle curve, moduli affiancati a passo 7
  (il passo di affiancamento del modello) lungo l'arco della curva. Il lato
  esterno si ricava dal segno di `turnSigned`.
- **`brakingBoard`** — a 100 e 50 unità **prima** dell'ingresso curva,
  camminando all'indietro lungo il tracciato, sul lato esterno.
- **`marshalPost`** — uno all'ingresso di ogni curva rilevata, oltre la
  barriera, rivolto alla pista.
- **`catchFence`** — moduli a passo 12 nel tratto davanti a ogni tribuna,
  fra pista e tribuna.
- **`concreteBarrier`** — moduli a passo 6 lungo l'uscita della corsia box,
  a separarla dalla pista.
- **`pylon`, `flagPole`, `paddockTent`** — zona paddock vicino al traguardo:
  un pylon, un gruppo di 3 bandiere, 2 tende, tutti esclusi dall'ingombro
  dei box giocatore.

Tutte le categorie rispettano i vincoli già esistenti: fuori dalla corsia
box (`nearestPoint(pitPts, …)`), fuori dagli ingombri dei box giocatore
(`insidePlayerBoxFootprint`) e a distanza dalle altre strutture accettate
(`isTooCloseToAny`).

### `sceneryCrowd.js`

Per ogni voce di layout di categoria `grandstand`/`grandstand-main`,
trasforma i posti di `grandStandSeats.json` (coordinate locali alla tribuna)
in coordinate mondo applicando la stessa rotazione `rotY` della tribuna, e
somma la posizione della tribuna. Ogni posto è occupato con probabilità
compresa fra 0.65 e 1.0 — quota estratta per tribuna dal PRNG del tracciato,
più alta per la tribuna principale — e la variante (`spectatorA/B/C`) è
scelta dallo stesso PRNG.

Il costo di rendering non dipende dal numero di spettatori: tre varianti da
4 mesh ciascuna sono 12 `InstancedMesh` in tutto, anche con 900 figure.

## Verifica

- **Test automatici** (`node --test`), estendendo `trackScenery.test.js` e
  aggiungendo `sceneryTrackside.test.js` / `sceneryCrowd.test.js`:
  determinismo (stesso tracciato → stesso layout), nessun oggetto dentro la
  corsia box o dentro l'ingombro dei box giocatore, nessuna coppia di
  strutture più vicina della propria clearance, spettatori sempre dentro il
  perimetro della tribuna cui appartengono, `curvatureAt` con casi noti
  (cerchio di raggio noto → raggio corretto; retta → Infinity).
- **Gate utente in localhost dopo ogni fase**: è l'unica verifica possibile
  per "si vede bene guidando", che nessun test copre.
- Un asset in più o in meno non deve rompere il caricamento: `loadScenery`
  logga e prosegue se un `.glb` manca, comportamento già presente.

## Fuori scope

- **Animazione dei meccanici** (`pitCrew`/`pitCrewKneel` restano statici e
  non sono animabili così come sono: vedi la nota in testa a
  `backend/tools/circuitAssets/people.py`).
- **Modifiche ai modelli**: gli asset sono approvati e non si ritoccano; se
  una misura non torna, si adegua la costante di piazzamento.
- **Rimozione dei `.glb` Kenney** dalla cartella: si fa solo dopo che tutte e
  tre le fasi sono verificate, per poter tornare indietro.
- **Editor pista** (`track-editor.js`) e **JSON dei tracciati**: non
  cambiano, il piazzamento resta interamente procedurale.
- **Ghiaia e vie di fuga**: sono terreno procedurale, non asset — lavoro
  separato.
