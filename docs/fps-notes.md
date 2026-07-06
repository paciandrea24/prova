# FPS — Note tecniche

Riferimento per il gioco **FPS** (arena shooter in prima persona, stile cartoon "rubber-hose"
anni '30 — mappa "Cittadina Cartoon" + mascotte toon, overhaul G4).
Leggi questo file **solo quando lavori sull'FPS**. Per il resto del progetto vedi `CLAUDE.md`.

## File chiave
- `frontend/fps.html` — markup: canvas, crosshair, hitmarker, HUD (HP/ammo/round/scores/killfeed), minimap, selezione arma, pointer-prompt, overlay round/gameover, ADS/scope, damage-direction.
- `frontend/fps.js` — TUTTA la logica client (~2000 righe): Three.js setup, mappa, modello giocatore, armi, sparo/hit detection, movimento+collisioni, minimap, ADS, socket handlers, WebRTC, fasi di gioco, audio procedurale, game feel.
- `frontend/styles/fps.css` — stili HUD, crosshair per-arma (variabili CSS), ADS/scope, hitmarker, minimap, weapon select, damage-direction.
- `backend/sockets/games/fpsGameSocket.js` — logica server FPS: join, selezione armi, spawn, hit autoritativo, round/scoring, spawn points, config armi, disconnect handler.
- `backend/sockets/socketManager.js` — connessione/lobby/disconnect (condiviso fra tutti i giochi).
- `backend/store/lobbies.js` — store condiviso: `lobbies`, `users`, `destroyTimers`.
- `backend/store/activeGames.js` — store `activeGames` (partite attive).

## Costanti/parametri (client, in cima a fps.js)
`PLAYER_HEIGHT=1.7`, `PLAYER_RADIUS=0.4`, `GRAVITY=20`, `JUMP_FORCE=7`, `STEP_HEIGHT=0.6`, `MOUSE_SENS=0.0015`, `MAP_RADIUS=49` (clamp RADIALE sul disco r=52 della Zona Jazz), `MAP_CEIL=13` (soffitto invisibile anti-fuga per Gravità Lunare).
Movimento: `WALK_SPEED=8`, `SPRINT_SPEED=12`, `CROUCH_SPEED=4`, `AIR_SPRINT_BOOST≈1.18` (sprint-jump più veloce, stile Minecraft), più costanti `SLIDE_*` e altezze occhio `STAND_EYE/CROUCH_EYE/SLIDE_EYE`.
NB: alcuni valori sono stati ritoccati nelle ultime sessioni — verifica sempre il sorgente prima di citarli.

## Armi (server, WEAPONS in fpsGameSocket.js)
assault (dmg 25, auto), smg (18, auto), shotgun (80), sniper (95). HP giocatore = 100.
ADS FOV (client): assault 50, smg 55, shotgun 62, sniper 15.

## Sistemi importanti

### Ciclo di gioco
1. Dalla lobby → `startGame` → redirect alla pagina FPS.
2. Client emette `joinFPS`. Il server crea `activeGames` entry (fase `weapon_select`), reinserisce i player in `lobby.players`, **annulla il destroy-timer della lobby**. In joinFPS viene settato `socket.data.joinedFPS = true`.
3. Fase `weapon_select` (20s): `chooseWeapon` aggiorna `game.weaponChoices`, `confirmWeapon` incrementa i confermati. Allo scadere del timer O quando tutti confermano → `launchRound`.
4. `launchRound`: assegna spawn distanziati, crea `game.players`, emette `roundStart`. Fase `playing`.
5. Sparo: client fa raycast locale, emette `reportHit`; il server (autoritativo) scala HP, emette `playerHit`/`playerKilled`. `checkRoundEnd` chiude il round quando resta 1 vivo.
6. `roundEnd` → dopo 5s nuovo `weapon_select` o `gameOver`.

### Collisioni + step-up (client)
- `solidBoxes[]` = lista di AABB `{min, max}`. Popolata da `addSolid(w,h,d,x,y,z,mat)` (crea mesh + AABB con base a y).
- `resolveCollisions(pos)`: AABB-vs-AABB, risolve sull'asse a penetrazione minima. **Step-up**: se `box.max.y - pos.y <= STEP_HEIGHT` e `canStandAt()` ok → alza il giocatore sul box.
- `canStandAt()`: ignora ostacoli sotto STEP_HEIGHT (gradini), blocca solo se testa/busto sono ostruiti → permette di salire scale fatte di box.
- `updateMovement()`: gravità + atterraggio sui top dei box (via `prevY`).
- `makeBox(w,h,d,mat,x,y,z)` = solo mesh visiva (NO collisione). `addSolid(...)` = mesh + collisione. **Attenzione all'ordine diverso degli argomenti!**

### Hit detection — hitbox a capsula
In `tryShoot`, l'hitbox del nemico è una **capsula verticale** campionata come sfere dai piedi (y0) alla testa (y1), raggio ~0.42 (tarato sulla larghezza reale del modello). Posture-aware: crouch/slide abbassano y0/y1. Sostituisce la vecchia singola sfera al petto (che faceva mancare i colpi a testa/gambe da vicino). Raycast: `camera.getWorldPosition()` + distanza punto-raggio (proiezione).

### Mappa ("ZONA JAZZ", GLB Blender + `loadJazzZone()`)
La mappa è la **Zona Jazz modellata in Blender** (sostituzione secca della vecchia
"Cittadina Cartoon"+Porto, 2026-07-06): disco r=52 con **isolato centrale** (anello
sigillato di palazzi bassi + club Scat Cat in diagonale all'angolo SO), due corsie
anulari separate da 4 archi di **isolotti** (varchi ai cardinali), **perimetro
circolare chiuso** di edifici (fronti quasi tutti verso l'interno, flip random).
- **Asset** (`frontend/assets/models/jazz/`): 20 GLB modelli (`edificio_01..10a`,
  `edificio13`, `club`, `props/*`), `pavimentazione.glb` (sanpietrini merged),
  `zona-layout.json` (istanze: `modello, x, z, rotY°, y, s`; fronte non ruotato = +Z).
  Sorgenti Blender in `docs/superpowers/plans/blender-scripts/` (jazz_lib + ricette).
- **Caricamento** (`loadJazzZone()`, chiamato PRIMA di `joinFPS` con overlay
  `#model-loading`): merge globale **per materiale** in 2 stadi (per modello →
  per istanza con matrice T·R·S "cotta" nelle geometrie) → ~40 mesh statiche totali.
  Merge indicizzato a mano (`_mergeGeos`, r128 non ha un merge affidabile).
- **Toon-swap**: ogni materiale GLB → `worldToon({color})` (cache per NOME materiale
  Blender, `_jazzMatCache`); materiali **Emission** (neon del club, vetri lampade) →
  `MeshBasicMaterial` "sempre acceso". Pipeline lineare INVARIATA (no tone mapping).
- **Quota**: tutta la zona a `JAZZ_Y_OFF=-0.10` → il top delle pietre (~0.09) sta a
  y≈0 e il codice di movimento non è cambiato; il sagrato del lotto centrale è un
  gradino basso (step-up).
- **Collisioni**: le mesh `COL_*` dei GLB (mai renderizzate) diventano **OBB
  verticali** per istanza via `addSolidOBB(cx, cz, hw, hd, y0, y1, rotY°)`.
  `resolveCollisions`/`canStandAt`/`raycastSolids` gestiscono le entry ruotate nel
  frame locale del box. ⚠️ CONVENZIONE SEGNO: `addSolidOBB` memorizza il **seno
  negato** (mondo→locale = R(−rot), perché three.js `rotation.y=rot` manda (x,z)
  in `(x·cos+z·sin, −x·sin+z·cos)`) — i consumer usano i campi così come sono.
  I props (lampioni/festoni/insegna) per ora NON collidono.
- **Confini**: clamp **radiale** `MAP_RADIUS=49` in `updateMovement` (niente più
  muro quadrato/`MAP_X1`); il perimetro visivo è chiuso dagli edifici stessi.
- **Bordi neri edifici**: tasto **B** (debug) toggla i gusci inverted-hull sulle
  mesh merged (`toggleJazzOutlines`, lazy). Default SPENTO (stile Cuphead: fondali
  senza china). Decisione definitiva → fissare e rimuovere il toggle.
- **Trade-off accettato dall'utente**: niente interni enterable né tetti
  calpestabili (interni club = step futuro). I SISTEMI porte interattive
  (`doors[]` vuoto) e breakables (liste vuote) restano vivi per gli interni futuri.
- **Storico**: la vecchia mappa procedurale (Grande Emporio, botteghe, speakeasy,
  PORTO con nave/gru/container, ~25 builder) è stata RIMOSSA da fps.js il
  2026-07-06 (−712 righe); recuperabile da git prima di quel punto.

### Spawn (server SPAWN_POINTS)
10 punti Zona Jazz: 8 in corsia esterna (r≈38.5, cardinali+diagonali) + 2 in corsia
interna (r≈20, N/S), tutti rivolti verso il centro con `angle = Math.atan2(x, z)`.
Devono restare coerenti con `zona-layout.json`: se cambi il layout, aggiornali.
Convenzione angoli: forward = `(-sin yaw, -cos yaw)`. Guardare verso +Z → yaw=PI; verso -Z → yaw=0.

### Minimap (client `drawMinimap()`)
Rotante, player-centric: il giocatore è sempre al centro come triangolo che punta in alto. Proietta le coord-mondo sui vettori forward/right del player. Canvas 130px, in alto a destra.

### Hitmarker / Healthbar
- `showHitmarker(isKill)`: X bianca animata attorno al mirino quando colpisci; rossa su `playerKilled` se il killer sei tu.
- Healthbar sopra il nemico (`createPlayerMesh` → hpBar/hpFill, `updateHealthbar`): **compare solo se HP < 100 e il nemico è vivo**, riempimento ancorato a sinistra, colore verde→giallo→rosso, billboard verso la camera. Nessun nameplate (i giocatori sono identificati solo dal colore).

### Modello giocatore remoto (`createPlayerMesh(color)`)
**Mascotte "rubber-hose"** (stile Cuphead, validata nel prototipo `fps-toon-proto.html/js`): testa tonda
crema con occhioni/sorriso, elmetto in colore-squadra, busto tondeggiante, arti a tubo neri con guantoni
bianchi e scarponi tondi. Cel-shading (`makeToonMat`) + **contorni inchiostro** inverted-hull
(`_addToonOutline`, materiale contorno per-personaggio così "Fantasmi" non tocca gli altri).
Handle invariato: `{ group, head, upper, legL, legR, hpBar, hpFill, weaponMount }` — `head.scale` per
Teste Giganti, `group.scale` per Mini. `HIP_Y=0.62`. Hitbox capsula tarata sulla mascotte (headOff in
`tryShoot`). Orientato verso -Z. Animazioni run/crouch/slide sincronizzate via rete (`updateRemoteAnim`,
`applyRemoteState`).
**NB**: `THREE.CapsuleGeometry` NON esiste in r128 — usare sempre `CylinderGeometry`/`BoxGeometry`. Three.js r128 core + `GLTFLoader` r128 da CDN (il loader serve alla MAPPA Zona Jazz; le armi restano procedurali).

### Audio (procedurale) + game feel
- `Sfx` IIFE: suoni sintetizzati con Web Audio API (oscillatori + rumore bianco filtrato), NESSUN file mp3. Funzioni: resume, shoot, hitConfirm, killConfirm, reload, footstep, slide, empty, hurt, death, roundStart.
- Game feel: recoil per-arma, screen shake (`addShake`), damage direction indicator (#dmg-dir), impact particles, weapon kick.

### Movimento avanzato
Sprint, crouch (solo tasto **C**, non più CTRL per evitare conflitti col browser), slide (corsa + crouch → slide). Hitbox effettiva varia con crouch/slide; la corsa mantiene l'hitbox in piedi.

### Anti-throttling tab in background
Web Worker "heartbeat" per aggirare il throttling del requestAnimationFrame quando la tab non è attiva (così tieni due client aperti per testare).

## Bug storici risolti (per non ripeterli)
- **Pointer lock dopo timer**: `requestPointerLock()` va chiamato su gesto utente (pointer-prompt / click sul canvas), mai in setTimeout.
- **Giocatori invisibili**: (1) `lobby.players` svuotato dal disconnect handler navigando lobby→FPS (fix: reinserimento in `joinFPS` + skip cleanup se `activeGames` ha la lobby). (2) `new THREE.CapsuleGeometry` (inesistente) lanciava eccezione in `createPlayerMesh`.
- **Confirm Loadout bloccato 0/N**: destroy-timer della lobby (5s) cancellava la lobby durante la selezione armi. Fix: `destroyTimers` condiviso in `store/lobbies.js`, annullato in `joinFPS`.
- **Bullet tracer invisibile**: `THREE.Line` rende 1px in WebGL → sostituito con `CylinderGeometry`, parte 0.4m davanti alla camera.
- **Hit non registrati**: il raycast partiva dai piedi → ora da `camera.getWorldPosition()` + distanza punto-raggio.
- **WebRTC double-offer**: rimosso `onnegotiationneeded` da `createPeer`.
- **"Danno morto" a metà partita — CAUSA PRIMARIA: handler disconnect di F1 senza guard.**
  I vecchi socket della pagina LOBBY (con `socket.lobbyId/color` da `joinLobby`) restano
  zombie per minuti dopo la navigazione verso fps.html; quando il browser li uccide, il
  `disconnect` di `f1GameSocket` — registrato su OGNI socket da socketManager — prendeva
  la partita FPS da `activeGames` SENZA controllare il tipo, faceva `delete game.players[color]`
  (→ `🚫 bersaglio ASSENTE`, giocatore non più colpibile) e, svuotati i players, cancellava
  l'intera partita (→ `NO_GAME`, danno azzerato per tutti). Fix: `gameId: 'f1'` nel game F1 +
  guard `game.gameId !== 'f1'` nel suo disconnect e in `f1ReturnToLobby`. REGOLA GENERALE:
  ogni handler condiviso che tocca `activeGames` deve verificare che la partita sia del suo
  gioco (FPS usa `socket.data.joinedFPS` + `gameId: 'fps'`).
  Fix di robustezza aggiuntivi della stessa caccia (restano validi): re-join su `reconnect`
  (client) + `REJOIN_GRACE` 60s + rientro in corsa in `joinFPS` (server) — coprono i VERI
  drop del socket di gioco (schede congelate, F5, blip di rete).
  Diagnosi con harness headless che pilotano il vero `fpsGameSocket.js` con io/socket finti
  (in `scratchpad`, sessione 2026-07-03): partita 5 round pulita = 0 anomalie; scenario
  zombie-lobby = riproduzione esatta del log utente, rosso col codice vecchio e verde col fix.
- **Grafica "G1" (PBR/tone mapping/env map)**: provata e poi **annullata** (troppo chiara/desaturata). Si usa `MeshLambertMaterial`. `renderer.outputEncoding`/`toneMapping` restano volutamente ai default (encoding lineare) per non slavare i colori — non toccarli.
- **Grafica "G2" (texture superfici)**: applicato. Le superfici di mappa usano `CanvasTexture` procedurali stilizzate (stile Kenney): prato/asfalto/cemento/marciapiede/mattoni/casse/tetto/doghe/siding. Generate in JS (`drawGrass`, `drawAsphalt`, `drawConcrete`, `drawBrick`, `drawCrate`, `drawRoof`, `drawWoodFloor`, `drawSiding`) via l'helper `makeTex()` con `RepeatWrapping` + `anisotropy`. Veicoli/giocatori restano a colore piatto (step successivi). Sostituibili con PNG Kenney reali cambiando la sorgente in `makeTex`.
- **Grafica "G3" (modelli arma GLB)**: SUPERATA da G4 — i GLB Quaternius stonavano con lo stile toon e sono stati sostituiti dalle armi cartoon procedurali (vedi "Armi cartoon procedurali"). I file in `assets/guns/` restano ma non sono più caricati.
- **Grafica "G4" (overhaul toon "rubber-hose")**: applicato — mondo+personaggio+armi in cel-shading.
  Pipeline: `_toonGradMap` (gradient map a 3 fasce, NearestFilter), `_toonGrainTex` (grana vintage),
  `makeToonMat(color)` per i personaggi, `worldToon(opts)` per il mondo (MAT), `_addToonOutline(mesh,
  outMat, tMul)` contorni inverted-hull (per i Box usa scala per-asse, per il resto vertici spostati
  lungo le normali). `TOON_OUTLINE_T=0.008`. I contorni del mondo condividono `MAT.ink`; personaggi e
  armi TP usano istanze dedicate (per il mutatore Fantasmi/`setGroupOpacity`).
  Il vincolo resta: **niente** `outputEncoding`/`toneMapping` (pipeline lineare).

## Armi cartoon procedurali (G4.1 — armi CURVE, approvate nel viewer)

### Struttura del sistema (fps.js)
- **`buildToonWeaponModel(key)`** — UNICO builder per FP e TP, ridisegnato in G4.1 con
  linguaggio di forme CURVO anni '30 (spec: `docs/superpowers/specs/2026-07-03-armi-toon-curve-design.md`;
  sviluppato e approvato arma per arma nel viewer `frontend/fps-armi-proto.html|js`, poi
  trapiantato qui IDENTICO — se si ritoccano le armi, farlo prima nel viewer). Helper interni:
  `latheZ` (solidi di rivoluzione asse-Z; `opt.sx` li restringe lateralmente ricalcolando le
  normali), `tube` (TubeGeometry su CatmullRom: impugnature a banana, ponticelli), `ell`/`sph`.
  Canna verso **-Z**, **origine al grip**, calcio a +Z. Materiali toon e contorno inchiostro
  **per-istanza** (mai condivisi: il mutatore Fantasmi fa `setGroupOpacity` sul group).
  Regole fissate dai feedback utente: bocche a cilindretto d'ottone MAI svasate; ogni pezzo
  ancorato DENTRO il corpo (mai tangente); impugnature con tallone piatto svasato (MAI sfere
  in punta); ponticello+grilletto d'ottone su tutte le armi; calci a pera con pancia contenuta.
  - *assault*: castello a capsula, caricatore a banana curvo, mirino dettagliato a perlina.
  - *smg*: Thompson M1928 — ricevitore stretto (`sx:0.8`), tamburo a DISCO piatto asse-Z
    (faccia in avanti) con perno passante, doppia impugnatura (grilletto solo dietro).
  - *shotgun*: doppietta con castello coassiale alla canna + anello di raccordo d'ottone.
  - *sniper*: azione metallica coassiale che raccorda corpo→canna a spillo, scopone, otturatore.
- **`buildTPWeapon(key)`** — `buildToonWeaponModel` scalato **0.95** (le forme curve rendono
  meno dei vecchi box; 0.8 risultava troppo piccolo), montato nel `weaponMount` del remoto.
- **`buildWeaponModels()`** — viewmodel FP: monta le stesse armi in `weaponGroup` con pose da
  `_FP_CFG` (l'origine-grip a `[GX, -0.215, -0.40]`).
- **Braccio FP** (`buildFPArm`): tubo nero rubber-hose + polsino svasato + guantone mitten in un
  gruppo **`fpHand`** riposizionato per-arma su `FP_HAND_ANCHOR` (centro del grip curvo, che sta
  sotto/dietro l'origine) da `switchWeaponModel` — così il guantone stringe l'impugnatura senza
  inglobare l'arma. Il grip del cecchino cadrebbe fuori schermo: la sua àncora è avanzata sul
  legno (si vede solo un accenno di mano, voluto).
- **Contorni in FP**: sui primitivi smooth funzionano anche a 20 cm dalla camera. NON aggiungere
  contorni inverted-hull a geometrie hard-edge (bug storico dei GLB: gusci neri glitchati).
- I GLB in `frontend/assets/guns/` NON sono più usati (tenuti nel repo per riferimento).

### Testa-mascotte condivisa
**`buildMascotHead(color, s)`** — FONTE UNICA della testa toon (cranio crema, occhioni, naso,
grin, elmetto team, faccia verso -Z): usata dal modello giocatore (`createPlayerMesh`), dai
trofei a terra (`makeTrophyHead`: testa 0.8 su astina toon) e dal podio finale
(`makePodiumHead`: 0.8, ruotata verso la camera; ingombro ~0.51 ≈ `HEAD_H` 0.5 della torre).
Se si ritocca la faccia della mascotte, va toccato SOLO questo builder.

## Disconnessione in partita (con finestra di riconnessione)
I browser CONGELANO le schede in background (Memory Saver/tab freezing): dopo ~45s senza
pong socket.io disconnette il socket, e al ritorno in primo piano socket.io si riconnette
da solo. Il flusso è quindi in due tempi:
- **Server, `disconnect`** (guardato da `socket.data.joinedFPS`): effetto immediato = emette
  `playerLeft`, cancella il respawn pendente e, se `playing`, segna morto + `checkRoundEnd`.
  La rimozione DEFINITIVA (lobby/scores/points, riassegnazione host, `endGame` se resta 1,
  delete game se vuota, ricontrollo confermati in `weapon_select`) è rimandata a
  `hardRemovePlayer` dopo `REJOIN_GRACE` (60s), annullabile da un re-join.
- **Server, `joinFPS`**: annulla il timer di grazia; se `phase==='playing'` e il player non ha
  un'entry viva → RIENTRO IN CORSA: in mischia rientra subito vivo su uno spawn (emette
  `playerRespawn`), in sudden death rientra morto (spettatore fino al prossimo round).
- **Client** (`fps.js`): su `socket.io.on('reconnect')` ri-emette `joinFPS` → il server risponde
  `fpsInit` che risincronizza fase/round (`handleRoundStart` rispetta `hp`/`dead` reali dei
  player, non assume tutti vivi). Handler `playerLeft` → rimuove mesh + healthbar + punteggi.

## Possibili prossimi step (non ancora richiesti)
- Tarare danni/TTK; interpolazione giocatori remoti; death animation; granate/melee; team; respawn; scoreboard TAB.
- Tetti accessibili (scale esterne) se richiesto.
- Migliorare gli asset (mappa/giocatori/armi) verso uno stile più poligonale, mantenendo i giocatori riconoscibili anche a distanza e senza luci invadenti.
