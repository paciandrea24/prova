# FPS — Note tecniche

Riferimento per il gioco **FPS** (arena shooter in prima persona, omaggio a Nuketown di COD).
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
`PLAYER_HEIGHT=1.7`, `PLAYER_RADIUS=0.4`, `GRAVITY=20`, `JUMP_FORCE=7`, `STEP_HEIGHT=0.6`, `MOUSE_SENS=0.0015`, `MAP_HALF=40`.
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

### Mappa (Nuketown homage, in `buildMap()`)
- Due case simmetriche a due piani (gialla a nord z=-32, verde-acqua a sud z=+32) che si fronteggiano, separate da strada asfaltata est-ovest (z=0).
- `buildHouse(cx,cz,doorDir,wallMat)`: piano terra con porta+finestre, solaio calpestabile a F2=2.8, secondo piano con grande finestra frontale, tetto. Scala interna in un vano d'angolo (gradini bassi, step-up). `buildHouseFurniture`: arredamento minimal.
- `buildBus`: **autobus agibile** = piccola "casa" con muri solidi e un'apertura fisicamente percorribile (entri, ti ripari, esci). NON è più attraversabile/passante. `buildVan`, `buildCarport`, `fenceX`/`fenceZ`, `buildMannequin` (no collisione), `addTree`.
- Mappa rimpicciolita (MAP_HALF 60→40); rimossi i capanni del backyard per poter stringere. Casse copertura a 0.6m (scalabili) + cataste come gradinate.
- Tetti delle case: solidi ma NON raggiungibili col salto (scelta voluta, fedele a Nuketown).

### Spawn (server SPAWN_POINTS)
8 punti: primi 4 = cortile nord (angle=PI, guardano +Z), ultimi 4 = sud (angle=0, guardano -Z). `launchRound` assegna con offset casuale + passo uniforme → in 1v1 i giocatori partono da case opposte.
Convenzione angoli: forward = `(-sin yaw, -cos yaw)`. Guardare verso +Z → yaw=PI; verso -Z → yaw=0.

### Minimap (client `drawMinimap()`)
Rotante, player-centric: il giocatore è sempre al centro come triangolo che punta in alto. Proietta le coord-mondo sui vettori forward/right del player. Canvas 130px, in alto a destra.

### Hitmarker / Healthbar
- `showHitmarker(isKill)`: X bianca animata attorno al mirino quando colpisci; rossa su `playerKilled` se il killer sei tu.
- Healthbar sopra il nemico (`createPlayerMesh` → hpBar/hpFill, `updateHealthbar`): **compare solo se HP < 100 e il nemico è vivo**, riempimento ancorato a sinistra, colore verde→giallo→rosso, billboard verso la camera. Nessun nameplate (i giocatori sono identificati solo dal colore).

### Modello giocatore remoto (`createPlayerMesh(color)`)
Umanoide a blocchi (gambe, stivali, busto con giubbotto colore-squadra, braccia, mani, testa, casco, fucile) + sotto-gruppi (upper, legL, legR, hpBar). Orientato verso -Z. Animazioni run/crouch/slide sincronizzate via rete (`updateRemoteAnim`, `applyRemoteState`).
**NB**: `THREE.CapsuleGeometry` NON esiste in r128 — usare sempre `CylinderGeometry`/`BoxGeometry`. Three.js è r128 core-only da CDN: NO examples/jsm (niente GLTFLoader/RoomEnvironment).

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
- **Grafica "G1" (PBR/tone mapping/env map)**: provata e poi **annullata** (troppo chiara/desaturata). Si usa `MeshLambertMaterial`. Per "grafica" l'utente intende gli **asset/modelli**, non luci/ombre.

## Disconnessione in partita
- **Server** (`fpsGameSocket.js`): handler `disconnect` guardato da `socket.data.joinedFPS`. Rimuove il player da lobby/scores, emette `playerLeft`, e gestisce: `playing` (segna morto + `checkRoundEnd`), `weapon_select` (ricontrolla i confermati), ultimo rimasto (`endGame`), lobby vuota (delete game), riassegna l'host se serve.
- **Client**: handler `playerLeft` → rimuove mesh + healthbar e toglie dalla lista punteggi.

## Possibili prossimi step (non ancora richiesti)
- Tarare danni/TTK; interpolazione giocatori remoti; death animation; granate/melee; team; respawn; scoreboard TAB.
- Tetti accessibili (scale esterne) se richiesto.
- Migliorare gli asset (mappa/giocatori/armi) verso uno stile più poligonale, mantenendo i giocatori riconoscibili anche a distanza e senza luci invadenti.
