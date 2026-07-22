# F1 — revisione scenografia: tribune, paddock, sponsor, natura

## Contesto

Segue e **rivede parzialmente** `docs/superpowers/specs/2026-07-21-f1-scenografia-procedurale-design.md`
(prima versione già implementata in `frontend/shared/trackScenery.js` +
`frontend/f1.js`, mai committata). Dopo il playtest in localhost, l'utente ha
confermato che solo gli alberi funzionano; tutto il resto (rocce, cespugli,
tenda, folla in T-pose, tribuna "piccolissima", bandiere/pylon distribuiti a
caso) va rifatto. Questo documento copre solo la **generazione automatica**
(nessun editor a zone: quello resta un progetto separato futuro, vedi
`project_f1_scenografia_procedurale` in memoria).

Verifica fatta durante il brainstorming con una scena Three.js di prova
(stessa scala 6× e stesse distanze pista/barriera del gioco reale),
renderizzata headless per confrontare le varianti di tribuna del Kenney
Racing Kit — non solo discussione a parole. Le decisioni sotto derivano da
quel confronto visivo, verificato anche dall'utente.

## Cosa NON serve cercare fuori dal progetto

Tutto il necessario è già nello stesso `kenney_racing-kit.zip` (CC0) di cui
il progetto ha già estratto 23 dei 110 file. Nessun asset esterno, nessuna
nuova licenza da valutare.

## Decisioni per categoria

### Natura — solo alberi

`NATURE_ASSETS` in `trackScenery.js` si riduce a `treeLarge`/`treeSmall`
(pesi invariati tra loro). Rimossi `rock_largeA`, `rock_smallA`,
`plant_bush`, `plant_bushLarge` da pesi e file (`frontend/assets/kenney/`):
non referenziati altrove nel progetto (verificato), cancellazione sicura.

### Laghetto — invariato

Resta la mesh procedurale (`THREE.CircleGeometry` blu) già presente, unico
tentativo non garantito dopo lo scatter natura. Nessuna modifica: l'utente
l'ha approvato com'è.

### Folla — rimossa del tutto

Nessuna istanza di `character-male-a` da nessuna parte. Il file non è
riferimento per nient'altro: va cancellato da `frontend/assets/kenney/`.
(Il problema originale — T-pose — era in realtà risolvibile applicando una
delle 31 animazioni incorporate nel file, ma l'utente ha chiarito che la
folla non serve proprio: non impacchettare quella soluzione.)

### Tribune — due taglie, niente varianti circolari

Confermato con la prova a scala reale: `grandStandCoveredRound` e
`grandStandRound` hanno un footprint quadrato 1.64×1.64 (contro l'1.00×1.00
delle altre) — sono isole circolari autonome, non moduli da affiancare a un
bordo dritto. **Esclusi.**

Impilare `grandStandAwning` su più livelli non funziona: il telo della
tettoia sporge sopra il modulo, una tribuna sopra ci galleggerebbe dentro.
Impilare direttamente `grandStandCovered`/`grandStand` (tetto piatto o
nessun tetto) invece **funziona** (verificato nel render): ogni livello
poggia sul tetto piatto del livello sotto. Il gradone arretrato con
basamento pieno (stile vero auditorium) è stato prototipato e **funziona
visivamente**, ma richiede una mesh procedurale nuova (un box di supporto)
oltre al semplice posizionamento di GLB — scartato per questa fase a favore
della soluzione più semplice.

Due taglie definitive:

- **Tribune piccole (perimetro del giro)** — sostituiscono l'attuale unica
  `grandStandCovered`: ad ogni slot tribuna già calcolato da
  `buildGrandstandLayout`, scelta casuale (pesata o uniforme, da rifinire in
  fase di piano) tra `grandStand`, `grandStandAwning`, `grandStandCovered`
  — un solo livello, 3 moduli affiancati come oggi. Nessuna folla.
- **Tribuna principale (rettilineo di partenza)** — nuova categoria dedicata:
  `grandStand` (base, senza tetto) impilata su **2 livelli**, **6 moduli
  affiancati** (non più 3), un'unica volta vicino a `trackPts[0]` (stesso
  punto di `buildStartLine`/`buildPaddockLayout`). Sostituisce l'attuale
  logica pylon/flagCheckers in quella posizione (vedi sotto, i pylon
  diventano cartelloni sponsor).

### Cartelloni sponsor — nuova categoria

Sostituiscono `pylon`/`flagCheckers` (rimossi, distribuzione "a caso"
bocciata) sia sul rettilineo di partenza sia lungo la corsia box: asset
`billboard`/`billboardLow` (dal Racing Kit, stesso zip), posizionati agli
stessi intervalli fissi già usati oggi per pylon/flagCheckers in
`buildPaddockLayout` (nessun nuovo PRNG, stessa logica deterministica a
intervalli).

### Paddock / box — edifici veri

`tent_smallClosed` (rimosso, "non tipico di un circuito F1") sostituito da
`pitsGarageClosed`/`pitsOffice` alternati lungo la corsia box, stessa
logica di posizionamento già esistente (stesso passo, stesso margine da
`pitRoadHalf`).

## Asset da estrarre (nuovi, dallo stesso zip già scaricato)

Dalla cartella `Models/GLTF format/` di `kenney_racing-kit.zip`:
`grandStand.glb`, `grandStandAwning.glb`, `billboard.glb`,
`billboardLow.glb`, `pitsGarageClosed.glb`, `pitsOffice.glb`.
(`grandStandCovered.glb` è già presente.) Nessuna texture esterna: verificato
che questi file non referenziano URI immagine esterne (o le hanno
incorporate nel `.glb` stesso).

## Asset da rimuovere (file + riferimenti in codice)

`rock_largeA.glb`, `rock_smallA.glb`, `plant_bush.glb`,
`plant_bushLarge.glb`, `tent_smallClosed.glb`, `pylon.glb`,
`flagCheckers.glb`, `character-male-a.glb` — cancellati da
`frontend/assets/kenney/` e da `SCENERY_ASSET_PATHS`/`NATURE_ASSETS`/logica
di piazzamento in `trackScenery.js` e `f1.js`.

## Cosa NON cambia

- Nessuna modifica al backend/fisica, nessuna collisione con la
  scenografia (invariato dalla spec precedente).
- Nessun editor a zone: la generazione resta interamente automatica e
  deterministica dal JSON del tracciato.
- I tre tracciati esistenti non richiedono modifiche al loro JSON.

## Verifica

Manuale in localhost su tutti e tre i tracciati:
- Tribune piccole: varietà visibile (non tutte uguali) lungo il giro,
  nessuna rotonda/circolare.
- Tribuna principale: una sola, vicino al rettilineo di partenza, 6 moduli
  × 2 livelli, nessun galleggiamento/compenetrazione visibile.
- Cartelloni sponsor al posto di pylon/bandiere, box paddock al posto delle
  tende lungo la corsia box.
- Nessuna folla, nessuna roccia/cespuglio in nessun tracciato.
- Determinismo: ricaricando lo stesso tracciato la disposizione non cambia.
