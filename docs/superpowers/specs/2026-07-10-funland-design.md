# Luna Park "Funland" — Design (sotto-progetto B di Rubber-Hollow)

**Data**: 2026-07-10 · **Stato**: approvato in brainstorming, in attesa di review spec

## Contesto

Il roadmap "Rubber-Hollow" prevede 4 aree: Jazz (ovest), Galleria (est), Funland (nord),
Piazza della Fontana (mozzo centrale). Il sotto-progetto A (Piazza) è chiuso: il varco
nord della piazza a (55.5, −16) è tappato dal cantiere "FUNLAND PROSSIMAMENTE", punto
d'attacco di questa spec. Riferimento layout: immagine utente "Luna Park Funland —
Roadmap dell'area" (mappa in stile Cuphead con ingresso, giostra, coaster, ruota, casa
degli orrori, auto scontro, ristoro, tiro a segno). Lo **stile resta quello della
piattaforma** (toon "fondale dipinto"), l'immagine detta solo l'organizzazione.

Decisioni prese durante il brainstorming (con l'utente):

- **Il flank nord viene assorbito da Funland** (opzione scelta): si demolisce il
  tunnel a U `fN` (Jazz NE → z=−38 → portale N Galleria) che attraverserebbe il
  parco; la funzione di flanking passa all'**anello esterno** perimetrale del parco.
  Il flank SUD resta intatto (unica rotta al chiuso, ruolo voluto).
- **Tutto statico**: nessuna animazione, nemmeno rotazioni visive. Parco "diorama".
  Niente sistemi di collisione mobile.
- **Tagli**: casa degli orrori TAGLIATA; montagne russe ridotte a **fondale**
  (skyline non giocabile dietro la recinzione nord); niente coperture mobili.
- **Layout**: "immagine ruotata" — l'organizzazione del riferimento ruotata di 90°
  così che l'ingresso principale guardi la piazza (sud, invece che ovest).

## Geometria e topologia

Convenzione: nord = −z (come il flank nord a centro −38).

- **Footprint**: recinto ~50×38 m, x∈[38, 88], z∈[−18, −56]. Confini: sud = piazza,
  ovest = retri dell'anello palazzi Jazz (fondale, come il lato ovest della piazza;
  il disco Jazz a z=−20 arriva a x≈41 e recede andando a nord), est = recinzione
  verso il braccio nord Galleria (x≈92.5), nord = recinzione + coaster-skyline.
- **Tre porte** (punti fissi):
  1. **Sud — Ingresso principale** (55.5, −16÷−18): il cantiere esce dal
     `piazza-layout.json`; al suo posto l'**arco FUNLAND** (faccia da clown,
     bocca = varco ~w5 h~4 con architrave COL anti-scavalco) + breve gola d'ingresso.
  2. **Ovest — Uscita Jazz** (32.5, −31.8): il varco NE già aperto dalla skip-list
     della cucitura. Il `jazz_gateway` che oggi lo sigilla appartiene al flank fN
     demolito → Funland fornisce il proprio **raccordo_ovest** equivalente
     (ali angolate a filo del perimetro Jazz + architrave, COL AABB al filo del varco).
  3. **Est — Passaggio di servizio Galleria** (97, −31.6): corridoio a L dal recinto
     est (x≈88, z≈−31.6) al portale nord della Galleria (porta verde `portale_varco`
     esistente) — eredita di fatto l'ultimo tratto del vecchio flank.
- **Demolizione flank nord**: `collegamenti.glb` rigenerato **senza** `fN`
  (restano `fS`, testata `main_jz_cap`, tappi piazza); la via `flank_nord` esce
  dal JSON dei collegamenti.
- **Interno**:
  - **Giostra** al centro (~56, −34), Ø~9 + tettoia: la "fontana" del quartiere,
    spezza la sightline ingresso→nord.
  - **Viale principale** ingresso→giostra; **area ristoro** a ovest del viale
    (~46, −26): chiosco churros + tavolini/ombrelloni (coperture basse).
  - **Tiro a segno** a SO (~44, −40): tendone con bancone.
  - **Auto scontro** a est (~72, −32): pista ovale ~14×10, muretto h~1.1
    (copertura crouch) con 2 aperture, 4-5 macchinine fisse dentro.
  - **Ruota panoramica** a NE (~78, −46): landmark verticale statico,
    2-3 cabine ferme alla base come coperture.
  - **Coaster-fondale** dietro la recinzione nord: colline di binario + tralicci
    in silhouette, nessuna COL (fuori dal recinto), zero gameplay.
  - **Anello esterno**: percorso perimetrale libero lungo la recinzione O→N→E che
    collega porta Jazz e porta Galleria senza attraversare il centro (il flank).

## Asset (`funland_lib.py`, stessa pipeline di piazza_lib)

Nuova lib in `blender-scripts/funland/` (riusa galleria_lib/jazz_lib), export GLB in
`frontend/assets/models/funland/` + `funland-layout.json` (istanze
`modello, x, z, rotY°, y, s`). Ogni ricetta si valida con render preview headless
(Blender 5.1) e gate utente per-asset. Regole di stile: mai solo primitive
(lathe/skin), boxy-ma-dettagliato, niente emoji, winding invertito nei from_pydata
(mappa (x,−z) specchia il winding), COL_* mai renderizzate, no z-fighting
(mai sovrapposizioni < 2 cm tra pavimenti).

In ordine di lavorazione:

1. **pavimentazione** — mesh unica from_pydata: viale + anello in sanpietrini/asfalto
   da fiera, aree attrazioni in terra battuta/prato. Quota top ≈ y0 con lo schema di
   offset della piazza; attenzione ai raccordi col varco piazza.
2. **arco_ingresso** — faccia da clown FUNLAND, bocca = varco, occhioni e scritta
   a lathe/box. Sostituisce il cantiere.
3. **recinzione** — moduli staccionata da parco (pilastrini + festoni), h~2.5,
   COL piena (è il perimetro giocabile); varianti dritte + modulo cancello (porte O/E).
4. **giostra** — pedana Ø9, colonna centrale grossa, tettoia a spicchi con
   bandierina, 4-6 cavalli fissi. COL: anello recinto basso + colonna (non si sale).
5. **ruota** — 2 piloni ad A, ruota a raggi Ø~20 (solo visiva in alto),
   3 cabine a terra come coperture con COL.
6. **autoscontro** — pista ovale ~14×10: muretto perimetrale h~1.1 con 2 aperture,
   pavimento metallico, palo centrale con rete scenografica sopra.
7. **macchinina** — bumper car (2-3 varianti colore via materiale), COL bassa;
   4-5 istanze nella pista.
8. **chiosco_churros** + **tavolino_ombrellone** — area ristoro, coperture basse.
9. **tiro_a_segno** — tendone a strisce con bancone COL e sagome-bersaglio dietro
   (papere/stelle), h~4.5.
10. **coaster_fondale** — binario a colline + tralicci, 2-3 moduli ripetibili in
    silhouette, solo mesh visiva senza COL.
11. **raccordo_ovest** — sigillo del giunto recinto↔perimetro Jazz al varco NE
    (tecnica jazz_gateway: ali angolate + architrave, COL AABB al filo del varco).

Palette: colori da circo del riferimento (crema, rosso mattone, verde salvia, ottone)
nei `flat_material` toon esistenti; il trattamento `worldToon` "fondale dipinto"
si applica da solo al caricamento.

## Integrazione (fps.js + server)

- **Collegamenti**: rilanciare `collegamenti-layout-wip.py` senza `flank_u("fN",...)`;
  si sovrascrive `collegamenti-wip` (cache-buster già in `loadZone`).
- **Piazza**: rimuovere l'istanza `cantiere` da `piazza-layout.json` (il GLB resta
  nella cartella, inutilizzato). L'arco FUNLAND vive nel layout di Funland:
  ogni zona resta autocontenuta nella sua cartella.
- **fps.js**:
  - `loadZone('assets/models/funland/', 'funland-layout.json', ...)` nel boot
    EXTENDED; collisioni automatiche `COL_*` → OBB (seno negato, convenzione esistente).
  - Skip-list Jazz **invariata** (il varco NE è già aperto; cambia cosa c'è oltre).
  - **Rete di sicurezza** anti-fuga: estendere il bounding a nord fino a z≈−58
    (oggi il mondo finisce a |z|≈40); verificare nel sorgente com'è implementata
    (rettangolo unico o per-zona) e allargare di conseguenza.
  - **Soffitto per-zona**: Funland a cielo aperto → clamp ~13 come il disco Jazz
    nella regione del parco (la ruota sale più su ma è solo visiva).
  - Minimap, toon-swap, merge per materiale: automatici via `loadZone`.
- **Server** (`fpsGameSocket.js`): +3-4 `SPAWN_POINTS` in Funland, distanziati e
  coerenti col layout — indicativi: gola d'ingresso (55.5, −21) verso nord,
  tiro a segno (44, −40) verso est, base ruota (78, −46) verso SO, bordo pista
  (84, −28) verso ovest. Convenzione yaw: `forward = (-sin yaw, -cos yaw)`.
- **Cartelle di lavoro**: `funland/` nuova (niente -wip); `collegamenti-wip`
  rigenerata in place; `piazza-layout.json` editato direttamente.
  **Commit/push solo dell'utente.**

## Gameplay

- **Rotte**: viale ingresso→giostra = percorso principale (giostra come baffle,
  speculare alla fontana); anello esterno = flank Jazz↔Galleria defilato (ruota e
  retro autoscontro ne spezzano le sightline); pista autoscontro = arena
  ravvicinata caotica.
- **Coperture**: alte (giostra, chiosco churros, tendone, cabine ruota), basse
  (macchinine, tavolini, muretto pista, banconi). Nessuna verticalità giocabile.
- **Sightline da controllare in fase layout**: diagonale ingresso↔ruota (NE) e
  tratto est dell'anello verso la porta Galleria → spezzare con recinzioni interne
  basse e la pista autoscontro (verifica su top render con frecce).
- **Bilanciamento**: 4 zone, ~23 spawn totali; il flank sud resta l'unica rotta
  al chiuso "silenziosa" (ruolo voluto).

## Verifica

1. Render preview Blender per OGNI asset (~11 ricette), gate utente per-asset.
2. Top render debug con sagome di riferimento (disco Jazz, ovale piazza, croce
   Galleria) per i tre innesti + scena combinata cross-model stile
   `debug_junction.py` sui giunti ovest (perimetro Jazz) ed est (porta verde).
3. Screenshot in-engine con harness headless (Chrome swiftshader + puppeteer):
   4 direzioni del parco + attraversamento delle 3 porte; check collisioni
   (recinzione respinge, porte libere, muretto pista step/crouch corretti).
4. Regressione: `?map=jazz` intatto; flank sud percorribile; piazza senza buchi
   al posto del cantiere.
5. Gate finale: partita dell'utente in localhost (server avviato dall'utente), 2 client.

## Fuori scope (esplicito)

- Casa degli orrori (tagliata). Coperture mobili e animazioni, anche solo visive.
- Interni enterable; salita su ruota/giostra/coaster.
- Sotto-progetto C (anello flanking globale attorno alla piazza).
