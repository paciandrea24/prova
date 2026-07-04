# Design: Rifacimento mappa FPS via Blender — Fase 1 "Piazza della Fontana"

## Contesto

L'utente vuole rifare da zero la mappa del gioco FPS, sostituendo la "Cittadina Cartoon"
procedurale attuale (`buildMap()` in `frontend/fps.js`) con una nuova ambientazione ispirata
a una roadmap visiva disegnata dall'utente: **"Rubber-Hollow"**, parco divertimenti/cittadina
in stile cartoon vintage anni '30 (rif. Cuphead), divisa in 5 zone:

1. **Piazza della Fontana** — hub centrale, punto di snodo verso le altre 4 zone
2. **Luna Park "Funland"** — giostre, ruota panoramica, montagne russe
3. **Galleria d'Arte / Art Deco** — passaggio coperto con negozi eleganti
4. **Quartiere Jazz** — jazz club ed edifici anni '20-'30
5. **Porto** — banchina, nave a vapore, spiaggia

Questo documento copre **solo la Fase 1: Piazza della Fontana**, come zona pilota per validare
l'intera pipeline tecnica prima di affrontare le altre zone.

## Scope complessivo del progetto (per contesto, non tutto in questo documento)

Il rifacimento completo comprende, in ordine:
1. **Mappa** — Piazza (questo documento) → Funland → Galleria → Jazz → Porto, una zona alla volta
2. **Armi** — rimodellate in Blender (sostituiranno il sistema procedurale G4.1 attuale)
3. **Personaggio** — rimodellato in Blender (sostituirà `buildMascotHead`/`createPlayerMesh` attuali)

Ogni fase successiva avrà il proprio ciclo design→piano→implementazione a parte.
**Decisione esplicita dell'utente**: si parte dalla mappa; armi e personaggio sono
gli ultimi asset da rifare, nonostante il sistema G4.1 fosse già stato validato
("tutto perfetto") — la priorità è la coerenza stilistica totale con la nuova mappa.

## Obiettivo Fase 1

Costruire la zona "Piazza della Fontana" come nuovo hub centrale della mappa FPS, validando:
- La pipeline Blender → script Python → GLB → caricamento in Three.js
- L'integrazione con lo shading toon esistente (cel-shading a fasce + contorno a inchiostro)
- L'integrazione con il sistema di collisioni esistente (`solidBoxes`/`addSolid`)
- Il game feel (scala, movimento, combattimento) rispetto alla mappa attuale

## Non-goal (esplicitamente esclusi da questa fase)

- Le altre 4 zone (Funland, Galleria, Jazz, Porto) — fasi successive
- Rimodellare armi o personaggio — fase successiva, a parte
- Nuovi mutatori o meccaniche di gioco
- Ottimizzazioni di performance avanzate (LOD, instancing) — si valutano solo se emergono
  problemi concreti in verifica

## Perché Blender (invece di procedurale Three.js)

Deciso con l'utente: vuole un **alto livello di dettaglio** sulla mappa (geometria scultorea:
statue, decori, forme organiche) difficile da ottenere con la generazione procedurale via
codice JS usata finora. Usare un'unica tecnologia (Blender) per mappa+armi+personaggio
garantisce coerenza stilistica, invece di un approccio ibrido con due pipeline diverse.

## Architettura della pipeline

### Script Blender (uno per asset riutilizzabile)

Ogni prop (fontana, lampione, panchina, ecc.) ha **il proprio script Python** (`bpy`), non un
unico script monolitico per l'intera zona. Ogni script:

1. Pulisce la scena (rimuove eventuali oggetti da run precedenti, così è idempotente)
2. Costruisce la geometria della parte
3. Assegna un **materiale a colore piatto per parte** (es. "pietra_basalto", "oro_deco",
   "vetro_ambra") — nessuna texture dipinta, nessuna luce/ombra "cotta": lo shading toon
   verrà applicato dopo, in Three.js, sullo stesso identico shader usato oggi per armi
   e personaggio (`worldToon()`, gradient map a 3 fasce)
4. Nomina le mesh che devono generare collisione con prefisso **`COL_`** (es. `COL_vasca`,
   `COL_base_lampione`) — tutte le altre mesh sono solo visive
5. Esporta da solo il risultato in `.glb` con `bpy.ops.export_scene.gltf(filepath=...)`,
   direttamente in `frontend/assets/models/piazza/<nome-prop>.glb`

### Workflow utente per ogni asset

1. Claude scrive/aggiorna lo script Python
2. L'utente apre Blender → tab **Scripting** → incolla lo script in un nuovo text file
3. Preme **Run Script** (un click) — la scena si popola e il GLB viene scritto in automatico
   nella cartella del progetto
4. Nessun export manuale, nessuna configurazione aggiuntiva richiesta
5. Per iterare: si aggiorna lo script, si ripete incolla+Run — il file GLB viene sovrascritto

### Convenzioni tecniche

- **Scala**: Blender lavora in metri, coerente con le costanti già in uso
  (`PLAYER_HEIGHT=1.7`, `MAP_HALF=32`, ecc.)
- **Orientamento**: l'export glTF converte automaticamente Z-up (Blender) → Y-up (Three.js/glTF),
  nessun accorgimento manuale necessario
- **Un GLB per prop riutilizzabile** (lampione, panchina) così viene clonato più volte nella
  scena; un GLB per elemento unico della zona (es. pavimentazione/basolato della Piazza,
  fontana)

## Integrazione in Three.js

### Reintroduzione GLTFLoader

`GLTFLoader` era stato rimosso da `fps.html` in G4 perché i vecchi GLB Quaternius (armi)
stonavano con lo stile toon procedurale. Va **reintrodotto**: gli asset ora sono disegnati
apposta per lo stile del gioco, con materiali pensati per ricevere lo shading toon.

### Loader e caching

- `loadGLBProp(name)`: carica il GLB una sola volta, ne cachea il risultato come "template".
  Per ogni mesh del modello:
  - applica `worldToon({color: <colore originale del materiale>})` al posto del materiale
    Blender, preservando il colore ma applicando il gradient map a 3 fasce
  - applica `_addToonOutline(mesh, MAT.ink)` per il contorno a inchiostro coerente col resto
- `placeProp(name, x, y, z, rotY)`: clona il template (nessuno scheletro/rig coinvolto, quindi
  clone semplice va bene), lo posiziona nella scena, e per ogni mesh con prefisso `COL_` nel
  nome calcola il bounding box e lo registra in `solidBoxes` tramite la stessa logica di
  `addSolid` già esistente — **nessuna modifica** al sistema di risoluzione collisioni
  (`resolveCollisions`, step-up, `canStandAt`)

### Caricamento asincrono e loading screen

`buildMap()` diventa parzialmente asincrona (attende il caricamento dei GLB prima di
posizionare i props). Serve un breve **loading screen/spinner** mentre i modelli scaricano
(una tantum per sessione browser — il browser cachea i file GLB, i round successivi sono
istantanei perché i template sono già in memoria).

## Asset da modellare per la Piazza della Fontana

Basato sull'immagine roadmap "Piazza della Fontana / Fountain Square":

- **Pavimentazione**: basolato in pietra circolare (elemento unico della zona)
- **Fontana**: vasca + statua centrale (pesce, come da immagine) con effetto acqua (il getto
  d'acqua resta un effetto Three.js separato, non geometria Blender)
- **Lampioni con faccia** (stile Cuphead, oggetto animato-personaggio nell'immagine): prop
  riutilizzabile, diversi esemplari nella piazza
- **Panchine**: prop riutilizzabile
- **Bandierine/festoni**: decorazione, nessuna collisione
- **Cartello "Fountain Square Est. 1930"**: prop unico
- **4 varchi** verso le altre zone (Funland nord, Galleria est, Jazz ovest, Porto):
  solo aperture/collegamenti nella geometria della piazza, NON le zone stesse (arriveranno
  nelle fasi successive)

## Verifica

Dopo il primo prop modellato (proposta: la fontana, elemento centrale e più rappresentativo)
si verifica subito in localhost:
- Geometria e scala rispetto al giocatore (`PLAYER_HEIGHT=1.7`)
- Coerenza dello shading con armi/personaggio attuali (stesso cel-shading + contorno)
- Collisione corretta sui bordi (`COL_` mesh → `solidBoxes`)

Solo dopo conferma dell'utente si procede prop per prop fino a completare la Piazza, poi si
passa alla Fase 2 (Funland) come nuovo ciclo design→piano a parte.

## Domande aperte / decisioni rimandate al piano di implementazione

- Ordine esatto di modellazione dei prop della Piazza (proposta: fontana → lampione →
  panchina → pavimentazione → cartello/bandierine)
- Dettaglio esatto della UI di loading screen (spinner semplice vs. barra di progresso)
- Se il getto d'acqua della fontana riusa l'effetto particellare/shader già esistente altrove
  nel gioco o ne serve uno nuovo
