# F1 — sostituzione scenografia importata con asset voxel custom

## Problema

La scenografia del circuito F1 (`frontend/shared/trackScenery.js`) usa oggi
modelli `.glb` importati dal Kenney Racing Kit (CC0, cartella
`frontend/assets/kenney/`): tribune, cartelloni sponsor, edifici paddock.
Stile visivo disomogeneo rispetto agli asset custom del progetto (auto
`f1Car.glb`, box giocatore `f1PitBox.glb`), entrambi modellati a mano in
stile voxel "boxy ma dettagliato" (vedi `CLAUDE.md`). L'utente vuole
eliminare tutti gli asset importati (tranne alberi e i due modelli custom
già esistenti) e sostituirli con un catalogo di modelli voxel propri,
espandendo anche il set di elementi tipici di un circuito F1 oggi assenti.

## Pulizia eseguita durante il brainstorming (già fatta)

18 file Kenney mai referenziati da nessun file del progetto (verificato con
grep su tutto il repo, solo commenti storici li nominano) sono stati
eliminati da `frontend/assets/kenney/`, nessuna sostituzione necessaria:

- `raceCarWhite/Green/Orange/Red.glb` (l'auto in gioco è `f1Car.glb` custom)
- `roadCornerLarge(Border)/Larger/Small(Border).glb`,
  `roadStraight/StraightArrow/StraightLong.glb`,
  `roadStart/StartPositions.glb` (la pista è mesh procedurale via
  `TrackMeshBuilder`, non moduli Kenney)
- `barrierRed/Wall/White.glb` (la barriera è mesh procedurale colorata)
- `grass.glb` (il prato è un piano procedurale colorato)

**Restano per ora** (ancora referenziati in codice, da rimuovere solo nello
step di integrazione, vedi "Fuori scope"): `grandStand.glb`,
`grandStandAwning.glb`, `grandStandCovered.glb`, `billboard.glb`,
`billboardLow.glb`, `pitsGarageClosed.glb`, `pitsOffice.glb`.

**Non toccati** (esplicitamente esclusi dall'utente): `treeLarge.glb`,
`treeSmall.glb`, e i custom `frontend/assets/custom/f1Car.glb`,
`frontend/assets/custom/f1PitBox.glb`.

## Catalogo — 16 modelli voxel da realizzare

### Sostituzioni dirette (stesso ruolo di oggi, nuovo stile voxel)

| id | Ruolo oggi (Kenney) |
|---|---|
| `grandStand` | Modulo tribuna base, impilabile — oggi usato anche per la tribuna principale (6 moduli × 2 livelli, vedi `buildMainGrandstandLayout`) |
| `grandStandAwning` | Variante con tettoia sporgente |
| `grandStandCovered` | Variante completamente coperta |
| `billboard` | Cartellone sponsor alto, lungo il rettilineo di partenza |
| `billboardLow` | Cartellone sponsor basso |
| `pitsGarageClosed` | Edificio garage chiuso, lungo la corsia box (decorativo, non il box giocatore) |
| `pitsOffice` | Edificio ufficio paddock, lungo la corsia box |

### Strutture di gara (nuovo)

| id | Descrizione |
|---|---|
| `raceControlTower` | Torre di direzione gara/cronometraggio — edificio verticale con vetrate, elemento riconoscibile vicino al traguardo |
| `startGantry` | Ponte semafori di partenza — arco/struttura che attraversa la pista |
| `podium` | Podio a 3 gradini + balconata. Ogni gradino è un oggetto separato nel file (non un'unica mesh saldata), pivot alla base al centro, orientamento standard (fronte lungo +Z locale) — pensato per essere referenziabile in una futura feature di cerimonia podio, che però NON fa parte di questo lavoro |

### Sicurezza/bordo pista (nuovo)

| id | Descrizione |
|---|---|
| `tyreStack` | Barriera di pneumatici impilati, modulo componibile (pensato per essere ripetuto/affiancato in curva) |
| `catchFence` | Pannello di rete di protezione, modulo ripetibile lungo un tratto |
| `marshalPost` | Postazione commissario di percorso: capanno + asta bandiera |

### Decoro paddock/rettilineo (nuovo)

| id | Descrizione |
|---|---|
| `pylon` | Pylon pubblicitario snello e alto |
| `flagPole` | Bandiera (a scacchi o genericamente sventolante) su asta |
| `paddockTent` | Tenda hospitality/paddock club |

## Stile e pipeline di produzione

Stesso approccio già validato e in uso per `f1Car.glb`/`f1PitBox.glb`
(vedi `backend/tools/f1CarBuilder.py` come riferimento concreto di pattern):

- Blender in modalità headless, script Python: `blender --background
  --python <script.py>`.
- Sculting per primitive box (pattern `add_box`: cubo primitivo, scale non
  uniformi, `transform_apply`), non modellazione poligonale libera —
  coerente con lo stile "boxy ma dettagliato" già stabilito.
- Materiali flat color (Principled BSDF, roughness alto, metallic 0),
  **non** palette texture — quella tecnica serve solo dove serve ricolorare
  dinamicamente (livree auto), non necessaria per props statici.
- `bpy.ops.object.shade_flat()` su ogni pezzo, coerente con lo stile voxel
  esistente.
- Convenzione da rispettare (causa di bug già risolti su altri asset del
  progetto): dopo un `Join` seguito da `Separate`, usare **Origin to
  Geometry** su ogni pezzo risultante — altrimenti il pivot resta quello
  dell'oggetto originale e le trasformazioni successive (istanza,
  rotazione in gioco) risultano sbagliate.
- Output: un file `.glb` per asset in una nuova sottocartella
  `frontend/assets/custom/circuit/<assetId>.glb` (separata dagli altri
  custom per tenere ordinato il catalogo).
- Per ogni asset, uno screenshot/render 3/4 in `backend/tools/renders/`
  (stesso pattern di `f1CarBuilder.py`), necessario per il gate di
  approvazione utente (vedi Verifica).

## Dimensioni e proporzioni

Nessun vincolo di footprint/altezza rispetto ai modelli Kenney che
sostituiscono (scelta esplicita dell'utente: libertà di design, poi si
ritara). Indicazioni solo qualitative per chi modella:

- Riferimento di scala noto: hitbox dell'auto in gioco è 7.16 × 3.48 unità
  (`CAR_HALF_LENGTH`/`CAR_HALF_WIDTH` × 2, `backend/sockets/games/physics/
  CollisionResolver.js`) — un modulo tribuna deve leggersi chiaramente
  "multi-piano" accanto all'auto, non un capanno basso.
- `raceControlTower` è l'elemento verticale più alto del catalogo (deve
  dominare lo skyline vicino al traguardo).
- `startGantry` deve essere abbastanza largo da coprire la carreggiata
  (la larghezza pista varia per tracciato, `trackData.roadHalfWidth` — chi
  integra dovrà scalare l'arco, non è un vincolo di modellazione).
- `tyreStack`/`catchFence`/`marshalPost` restano bassi rispetto alle
  tribune, sono elementi di bordo pista non strutture.
- Le costanti di piazzamento in `trackScenery.js` (spaziature, margini)
  sono tarate sulle dimensioni Kenney attuali e verranno **ritarate in uno
  step successivo**, dopo aver misurato le dimensioni reali dei modelli
  finiti — non è compito di questo lavoro di modellazione azzeccarle in
  anticipo.

## Fuori scope (esplicitamente, per questo task)

- Integrazione in `trackScenery.js`/`f1.js`: aggancio dei nuovi asset ai
  riferimenti esistenti (sostituzione dei 7 Kenney ancora in uso) e calcolo
  del posizionamento procedurale delle 3 nuove categorie sul tracciato
  (dove/quante istanze/con quale criterio di distribuzione). Task
  successivo separato, da progettare dopo aver visto i modelli finiti.
- Retuning dei margini di piazzamento esistenti in `trackScenery.js`.
- Qualunque logica di gioco per una cerimonia podio (il modello `podium` è
  solo predisposto strutturalmente per un riuso futuro).
- L'editor 2D pista (`track-editor.js`) non viene toccato.
- I tracciati esistenti (`monte-rosso`, `monza`, `interlagos`, `prova`) non
  richiedono modifiche al loro JSON.

## Verifica

- Per ciascuno dei 16 asset: render 3/4 generato dallo script, **gate di
  approvazione utente prima di considerarlo definitivo** (convenzione già
  in uso nel progetto: un asset generato non si considera pronto finché
  l'utente non lo approva guardandolo).
- Controllo tecnico automatizzabile: ogni `.glb` esportato deve caricare
  senza errori in un `GLTFLoader` headless (stesso tipo di controllo già
  usato per altri asset custom del progetto) e avere pivot/origine
  coerente con la convenzione Origin-to-Geometry sopra.
- Nessuna verifica di integrazione in-game in questo task (fuori scope):
  la verifica "si vede bene nel circuito reale" arriva nello step di
  integrazione successivo.
