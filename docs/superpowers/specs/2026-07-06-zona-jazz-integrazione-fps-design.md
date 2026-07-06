# Zona Jazz → fps.js — Design dell'integrazione in gioco

Data: 2026-07-06 · Stato: approvato a voce dall'utente ("va bene tutto, scegli tu;
l'importante è non laggare"), spec da fargli rivedere.

## Obiettivo

Sostituire **in modo secco** la mappa attuale dell'FPS ("Cittadina Cartoon" + Porto,
procedurale in `buildMap()`) con la **Zona Jazz** modellata in Blender (20 GLB +
`pavimentazione.glb` + `zona-layout.json`), resa con il **cel-shading già esistente**
(stile Cuphead/cartoon anni '30) e giocabile in multiplayer **senza lag percepibile**
(vincolo esplicito dell'utente: fluidità prima di tutto).

## Decisioni prese con l'utente (2026-07-06)

1. **Sostituzione secca**: il codice di Cittadina/Porto viene rimosso (niente flag di
   rollback; il rollback è git).
2. **Trade-off gameplay accettato**: nessun interno enterable né tetto calpestabile
   nella Zona Jazz per ora (interni club = step futuro). Si gioca su corsie anulari,
   varchi, piazza del club.
3. **Bordi neri sugli edifici: toggle in gioco** (tasto debug `B`, default SPENTO).
   Personaggi/armi/prop di gioco mantengono i loro contorni attuali sempre accesi.
   Nota stile: in Cuphead i fondali non hanno china — il default spento è fedele.
4. Lavori nel **worktree jazz** (`.claude/worktrees/fps-mappa-blender-jazz`, dove
   stanno già gli asset); test con `node backend/server.js` dal worktree; commit e
   merge li fa SOLO l'utente.

## Architettura

### Caricamento e merge (approccio "merge globale per materiale")

- `fps.html`: torna lo script tag **GLTFLoader r128** (CDN, come fu per la fontana) +
  overlay `#model-loading` finché gli asset non sono pronti; `joinFPS` parte solo a
  caricamento completato.
- `loadJazzZone()` (async, in fps.js):
  1. carica `zona-layout.json`, `pavimentazione.glb` e i GLB dei modelli usati
     (dedotti dal JSON: `edificio_01..10a`, `edificio13`, `club`, `props/*`) — download
     totale piccolo, i modelli sono condivisi tra le ~76 istanze;
  2. per ogni GLB indicizza le mesh per **nome materiale** e separa le mesh `COL_*`
     (collisioni, mai renderizzate);
  3. per ogni istanza del JSON compone la matrice **T(x,y,z)·R(rotY)·S(s)** (campi
     `x,z,y,rotY,s`; conversione gioco: il GLB importato guarda già +Z) e "cuoce" le
     geometrie del modello in accumulatori **per materiale**;
  4. a fine giro: un `BufferGeometry` merged + un `Mesh` per materiale (~40 draw call
     totali per l'intera zona; `matrixAutoUpdate=false`, mesh statiche).
- La **pavimentazione** resta com'è (già una manciata di mesh: pietre merged + disco
  + lotto): entra nella scena senza rework.

### Toon shading e neon

- Ogni materiale importato è sostituito con la pipeline esistente: `worldToon({color})`
  col **colore piatto** del materiale Blender (gradient map a 3 fasce + grana, stessa
  `MAT`-pipeline del resto del gioco). NIENTE `outputEncoding`/`toneMapping` (vincolo
  storico: pipeline lineare).
- I materiali marcati **Emission** in Blender (`neon_material`: scritte neon del club,
  vetri dei lampioni) diventano materiali "sempre accesi" (emissive/`MeshBasicMaterial`
  toon-friendly): luce percepita senza aggiungere luci reali.
- Illuminazione di scena invariata (ambient + directional attuali): il look viene dal
  gradient toon, non dalle luci.

### Bordi neri (toggle)

- Durante il merge creo anche il **guscio inverted-hull** per ogni mesh merged
  (`MAT.ink`, spessore ~`TOON_OUTLINE_T`), con `visible=false`.
- Tasto **B**: toggla la visibilità dei gusci. Se l'utente decide "sì per sempre" o
  "no per sempre", il toggle si fissa in una costante (`JAZZ_OUTLINES`) e il tasto
  debug si rimuove.
- Rischio noto (bug storico GLB): inverted-hull su spigoli vivi può fare gusci
  glitchati → è esattamente ciò che il toggle permette di giudicare dal vivo.

### Collisioni: OBB con asse verticale

- Le mesh `COL_*` di ogni modello danno box locali (AABB nel frame del modello).
- Per ogni istanza: `{cx, cz, y0, y1, halfW, halfD, rotY}` → **OBB verticale**.
- `solidBoxes` si estende: le entry ruotate portano `cos/sin` precalcolati;
  `resolveCollisions`, `canStandAt` e `raycastSolids` trasformano il punto/raggio nel
  **frame locale** del box (rotazione inversa attorno a Y), risolvono come AABB e
  ritrasformano. Le entry con `rotY=0` seguono il percorso attuale (nessun costo in
  più). Lo **step-up resta invariato**: i top sono orizzontali.
- Il **club** e il lotto centrale: cordolo/sagrato = solido basso (0.16-0.19 m) su cui
  si sale con lo step-up, come oggi la piazza rialzata.

### Terreno e confini

- Terreno **logicamente piatto a y=0.10** (i rilievi delle pietre sono ≤ 8 cm, sotto
  `STEP_HEIGHT=0.6`): il giocatore cammina su un piano; niente collisione con la mesh
  delle pietre.
- Confini: **clamp radiale** `r ≤ ~49` in `updateMovement` al posto del clamp quadrato
  (`MAP_HALF`→52 per estensione/minimappa; `MAP_X1` e la fascia Porto spariscono).
  I varchi tra edifici perimetrali sono sigillati dai modelli stessi; il clamp è la
  rete di sicurezza. `MAP_CEIL=13` invariato (la cresta del club a 14 m è solo visiva).

### Spawn (server)

- `SPAWN_POINTS` in `fpsGameSocket.js` riscritti per il disco: **8 in corsia esterna**
  (r≈38.5, cardinali + diagonali) + **2 in corsia interna** (r≈20, N e S), yaw verso
  il centro con la convenzione esistente (`angle = Math.atan2(x, z)`).

### Pulizia (sostituzione secca)

- VIA: `buildCentral`, `buildShop`, `buildStall`, `buildGazebo`, `buildSpeakeasy`,
  `buildPort`, `buildKiosk`, `buildVan`, `buildBackdrop`, `buildFountain`,
  `buildLamppost` (i lampioni della zona arrivano dal GLB `props/lampione`, istanze
  nel JSON), gli usi collegati e le texture/MAT orfane.
- RESTANO i **sistemi**: porte interattive (`doors[]` semplicemente vuoto), breakables
  (vuoti per ora), minimap player-centric, nuvole (`buildClouds`).
- `docs/fps-notes.md` aggiornato a valle (sezione Mappa riscritta).

## Performance (vincolo primario)

Budget e mitigazioni, in ordine di applicazione:

1. **Base**: ~40 draw call statiche, ~1.5 M triangoli, zero luci aggiunte, niente
   ombre dinamiche. Su GPU integrate recenti deve stare a 60 fps.
2. **Misura**: contatore fps temporaneo in console/HUD debug durante la verifica in
   localhost (due client aperti). Criterio: fluido con due tab attive sul PC
   dell'utente.
3. **Fallback pronti** (solo se serve, in quest'ordine):
   a. split del merge in 4 quadranti × materiale (frustum culling utile guardando
      verso l'esterno);
   b. rigenerare i GLB con bevel ridotti (`segments 2→1` in `jazz_lib._finish_box`)
      → taglio stimato 30-40% dei triangoli;
   c. diradare i sanpietrini (pietre più grandi) e i listelli dei tetti a falda.
4. I gusci outline (toggle) raddoppiano i triangoli della zona SOLO se accesi: si
   valuta la loro sostenibilità proprio col toggle.

## File coinvolti

- `frontend/fps.html` — script GLTFLoader, overlay caricamento.
- `frontend/fps.js` — `loadJazzZone()`, merge, toon-swap, OBB, clamp radiale, toggle
  B, rimozione mappa vecchia.
- `backend/sockets/games/fpsGameSocket.js` — nuovi `SPAWN_POINTS`.
- `frontend/assets/models/jazz/*` — già pronti nel worktree (nessuna modifica).
- `docs/fps-notes.md` — aggiornamento finale.

## Fuori scope (esplicito)

- Interni enterable (club compreso), tetti calpestabili, porte interattive nella zona.
- Le altre 4 zone della roadmap mappa (Piazza, Funland, Galleria, Porto Blender).
- Armi/personaggio in Blender (fasi successive del piano generale).
- Modifiche ai mutatori (funzionano tutti; Blackout/Nebbia semplicemente senza interni).

## Criteri di accettazione

1. Partita 1v1 completa (5 round) sulla Zona Jazz senza errori console e fluida sul
   PC dell'utente (due tab).
2. Edifici integri e cel-shaded identici alle anteprime Blender (v5.4+); neon del club
   "accesi"; niente z-fighting evidente.
3. Collisioni: non si attraversa nessun edificio (anche ruotati a 45°), si sale sul
   sagrato con lo step-up, non si esce dal disco (nemmeno con Gravità Lunare).
4. Spawn sensati (dentro le corsie, mai dentro un edificio), minimap coerente.
5. Tasto B: bordi neri on/off dal vivo senza costo quando spenti.
