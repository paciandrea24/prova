# FPS — Minimappa con texture generata dalla geometria reale

**Data**: 2026-07-10 · **Stato**: approvata a voce, in attesa di review scritta

## Obiettivo

Sostituire lo sfondo nero della minimappa dell'FPS con una texture top-down
dell'intero mondo di gioco, generata automaticamente dalla geometria reale
(GLB + layout JSON). La generazione avviene **solo in sviluppo** tramite una
pagina tool dedicata; in partita la texture viene solo caricata e disegnata.
Nessun passaggio manuale di disegno: mappa modificata → si riapre il tool →
texture rigenerata e salvata.

## Contesto attuale

- Il mondo è assemblato in `fps.js` da 5 zone (`loadZone`): jazz,
  collegamenti-wip, galleria-wip (offset `GALLERIA_OFF = {x:97, z:0}`),
  piazza, funland. La skip-list dei varchi Jazz è già esterna
  (`assets/models/jazz/varchi-skip.json`).
- La minimappa (`drawMinimap()`, fps.js ~3230) è un canvas 130px, circolare,
  **rotante player-centric**: proietta le coord-mondo sui vettori
  forward/right del player (`toMM`), raggio vista 32 unità, sfondo nero
  `rgba(0,0,0,0.55)`, pallini giocatori + triangolo centrale + logiche
  mutatori (fog/blackout/sonar).
- Non esiste un editor in-game: le mappe nascono dagli script Blender.

## Requisiti

1. Texture generata da camera **ortografica** verticale sopra la mappa, che
   inquadra tutta l'area giocabile con un piccolo margine (≈3 unità mondo).
2. Solo **elementi statici** (le zone GLB): niente giocatori, armi,
   proiettili, particelle, HUD, porte animate. Le mesh `COL_` (collisioni
   invisibili) non vanno renderizzate.
3. Texture **salvata su file** insieme a un file di calibrazione, caricata
   all'avvio partita; rigenerazione solo quando la mappa cambia.
4. Il sistema di conversione coordinate esistente (`toMM`) resta invariato:
   la texture è solo un nuovo sfondo, disegnato con la stessa
   rotazione/scala dei pallini.
5. Zero generazione (e zero costo percettibile) durante il gameplay.
6. Stile scelto dall'utente: **render reale scurito** — colori/materiali di
   gioco, poi velo scuro + leggera desaturazione sulla minimappa perché i
   pallini colorati dei giocatori restino leggibili.

## Architettura

### A. Config del mondo condivisa — `frontend/world-config.js`

L'elenco zone (dir, file layout, offset, flag `pav`, riferimento a
`varchi-skip.json`) oggi cablato in `fps.js` viene estratto in un piccolo
script globale (no moduli ES: il progetto usa `<script>` classici) usato sia
da `fps.js` sia dal generatore. Unica fonte di verità: il generatore non può
disallinearsi dal gioco. `fps.js` continua a gestire da solo il caso
`?map=jazz` (mondo ridotto); il generatore renderizza **sempre il mondo
esteso completo** — la texture copre anche il caso jazz-only, essendo la
mappatura basata su coordinate mondo assolute.

### B. Generatore — `frontend/minimap-gen.html` (pagina dev, non linkata dal gioco)

Pagina self-contained (HTML + script inline) che:

1. Carica Three.js r128 + GLTFLoader r128 da CDN (come fps.js).
2. Legge `world-config.js` + `varchi-skip.json`, poi per ogni zona: layout
   JSON + GLB (con lo stesso cache-buster `?v=Date.now()` delle -wip) e
   piazza le istanze con un **loader semplificato**: clone della scena GLB
   per istanza, trasformata `x/z + offset`, `rotY`, `s`, `y`; skip-list
   applicata; istanze `passthrough` incluse (in gioco sono visibili); mesh
   `COL_*` nascoste. Niente toon, niente merge materiali, niente collisioni:
   materiali originali dei GLB + luce ambiente e sole dall'alto leggermente
   inclinato (per dare un minimo di modellato ai tetti).
3. Calcola l'AABB del mondo caricato (`Box3.setFromObject`) + margine 3
   unità → frustum della camera ortografica (posizionata sopra il centro,
   guardando −Y, `up = (0,0,−1)` così che mondo **+X → destra immagine,
   +Z → basso immagine**).
4. Renderizza su canvas con **lato massimo 2048 px**, proporzioni del mondo
   preservate (scala px/unità **uniforme** sui due assi).
5. Salva automaticamente (vedi C) e mostra a schermo l'anteprima + esito.

### C. Salvataggio — route dev `POST /dev/minimap`

- Il generatore invia `{ png: <dataURL>, meta: { minX, minZ, maxX, maxZ,
  width, height } }` al server Express locale (body limit alzato per questa
  sola route, ~20 MB).
- Il server scrive `frontend/assets/minimap/world.png` e
  `frontend/assets/minimap/world.json`. Route attiva solo con
  `NODE_ENV !== 'production'`.
- Risultato: aprire `localhost:3000/minimap-gen.html` = texture rigenerata e
  salvata, senza passaggi manuali. Il commit degli asset resta all'utente,
  come per tutto il resto.

### D. Integrazione in `fps.js`

- All'avvio si caricano `assets/minimap/world.png` + `world.json`
  (cache-buster in fase wip). Caricamento **non bloccante**: la partita
  parte anche senza.
- In `drawMinimap()` cambia solo lo sfondo: dentro il clip circolare, al
  posto del `fillRect` nero, la texture è disegnata via
  `ctx.setTransform(...)` costruita con gli **stessi `sin/cos` di `yaw` e la
  stessa scala `s`** già usati da `toMM` → allineamento con i pallini
  garantito per costruzione. Sopra: velo `rgba(0,0,0,~0.45)` e leggera
  desaturazione (via `ctx.filter`, se supportato). Croce di riferimento,
  pallini, triangolo player e logiche mutatori: invariati.
- **Fallback**: PNG o JSON mancanti/corrotti → sfondo nero attuale, nessun
  errore visibile.

## Flusso dati

```
Blender scripts → GLB + layout JSON  (invariato)
                        │
        minimap-gen.html (dev, on-demand)
                        │  render ortografico top-down
                        ▼
        POST /dev/minimap → assets/minimap/world.png + world.json
                        │
        fps.js (avvio partita): load png+json → drawMinimap() sfondo
```

Calibrazione: pixel `(u,v)` ↔ mondo `(minX + u·k, minZ + v·k)` con
`k = (maxX−minX)/width` unità/px, uniforme sui due assi.

## Gestione errori

- Zona che non carica nel generatore → errore a schermo, **nessun POST**
  (mai salvare una texture parziale).
- POST fallito / route assente → la pagina offre il download manuale di
  PNG + JSON come ripiego.
- In gioco: qualsiasi problema con la texture → fallback sfondo nero.

## Limiti noti (accettati)

- La vista dall'alto mostra i **tetti**: gli interni coperti (es. Galleria)
  appaiono come tetto, e i pallini dei giocatori all'interno vi si
  sovrappongono. È il comportamento classico delle minimappe FPS; un
  eventuale "taglio planimetrico" (clipping sotto i tetti) è un
  raffinamento futuro, fuori scope.
- Le porte interattive (pannelli dinamici) non compaiono: sulla texture
  resta il varco nel muro, che è l'informazione corretta.

## Verifica (utente, in localhost)

1. `minimap-gen.html`: render corretto a video, messaggio di salvataggio ok,
   file presenti in `assets/minimap/`.
2. Partita in due tab: la minimappa mostra edifici/strade attorno al player;
   camminando lungo un riferimento riconoscibile (es. imbocco Galleria) la
   posizione sul disegno corrisponde; i pallini nemici stanno dove sono
   davvero; fog/blackout/sonar si comportano come prima; nessun calo di
   prestazioni.
3. Modifica di prova alla mappa → riapertura del tool → texture aggiornata.
