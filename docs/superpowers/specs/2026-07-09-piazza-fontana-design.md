# Piazza della Fontana — Design (sotto-progetto A di Rubber-Hollow)

**Data**: 2026-07-09 · **Stato**: approvato in brainstorming, in attesa di review spec

## Contesto

Il roadmap visivo "Rubber-Hollow" (`Desktop/Viste mappa fps/Roadmap visivo mappa FPS.png`)
prevede quattro aree: Quartiere del Jazz (ovest), Galleria d'Arte (est), Luna Park
"Funland" (nord) e una Piazza della Fontana centrale che fa da mozzo. Oggi esistono
Jazz (disco r=52 all'origine) e Galleria (offset mondo 97,0), collegate direttamente
da 1 corridoio principale + 2 flank. Il progetto è scomposto in tre sotto-progetti,
in quest'ordine (deciso con l'utente):

- **A. Piazza della Fontana** ← questa spec
- **B. Luna Park "Funland"** (spec futura; si aggancia al varco nord della piazza)
- **C. Anello esterno di flanking + passaggi di servizio** (spec futura)

Decisioni prese durante il brainstorming:
- **Niente Ingresso Principale/arco a sud**: nessuna funzione di gioco → fuori scope.
- **Niente lampioni-omino** (scartati alla scelta arredo).
- La piazza è un'**arena di scontro** vera, non solo transito: spawn propri e coperture.
- Approccio produzione: **piazza_lib Blender nuova + quinte riusate** (approccio A).

## Geometria e topologia

- **Ovale ~20 m (E-O) × 32 m (N-S)**, centro mondo **(55.5, 0)**. Una piazza tonda
  da 30 m non sta nei ~20 m tra Jazz e Galleria (corr_main attuale: x∈[45.5, 65.4],
  larghezza 7, z=0); l'allungamento N-S è coerente col roadmap (Funland a nord).
- Quattro cardinali:
  - **Ovest**: varco est di Jazz (esistente, skip-list invariata).
  - **Est**: portale ovest della Galleria (esistente).
  - **Nord (z=−16)**: varco TAPPATO in attesa di Funland → recinzione da cantiere
    cartoon con insegna "FUNLAND — prossimamente" (punto d'attacco del sotto-progetto B).
  - **Sud (z=+16)**: fondale chiuso, davanti il chiosco.
- Il modello `collegamenti` viene **rigenerato**: `corr_main` sostituito da due brevi
  imbocchi (ovest: da Jazz alla piazza; est: dalla piazza alla Galleria). I **flank a
  z=±38 restano intatti** (sono i "percorsi secondari" del roadmap).
- Convenzione: nord = −z (come flank_nord a centro −38).

## Asset nuovi (`piazza_lib.py`, stessa pipeline di jazz_lib/galleria_lib)

Ogni ricetta si valida con render preview headless (Blender 5.1) prima dell'export GLB.
Regole di stile: mai solo primitive (lathe/skin), boxy-ma-dettagliato, niente emoji.

1. **Fontana-mascotte** — vasca bassa circolare Ø~7 m, bordo entrabile/calpestabile
   (step-up), statua mascotte cartoon al centro che sputa acqua. Copertura centrale
   dell'arena. Il vecchio tentativo di fontana (bug "non vedo la base") si scarta e
   si rimodella da zero.
2. **Chiosco tondo** anni '30 — Ø~4 m, h~4.5 m, copertura alta piena. Posizione
   sfalsata a S-E: con la fontana forma la doppia baffle che spezza la linea di tiro
   Jazz↔Galleria.
3. **Panchina** — copertura bassa da crouch.
4. **Aiuola con cordolo** — copertura bassa, verde.
   (Panchine+aiuole: 6-8 istanze disposte sugli anelli della pavimentazione.)
5. **Pavimentazione** — anelli concentrici di sanpietrini attorno alla fontana
   (mesh unica from_pydata, come la pavimentazione Jazz), quota top ≈ y 0 con lo
   stesso schema di offset della Jazz (JAZZ_Y_OFF).
6. **Muretto di raccordo** — tratti bassi che chiudono l'ovale tra le quinte.
7. **Recinzione cantiere + insegna FUNLAND** — il tappo nord provvisorio.

## Quinte perimetrali

I tratti d'ovale tra i varchi si chiudono con **3-4 facciate Jazz esistenti**:
i GLB si COPIANO in `frontend/assets/models/piazza/` così `loadZone` continua a
caricare tutto dalla cartella della zona (nessuna modifica cross-directory).

## Integrazione (fps.js + server)

- `loadZone('assets/models/piazza/', 'piazza-layout.json', ...)` nel boot EXTENDED;
  collisioni automatiche dalle mesh `COL_*` (OBB come le altre zone).
- Layout in `piazza-layout.json` (convenzione istanze: `modello, x, z, rotY°, y, s`).
- Si lavora su cartelle **-wip** (`piazza` nuova + `collegamenti-wip` rigenerata),
  originali congelati, come nel pass playtest corrente.
- **Spawn server** (`SPAWN_POINTS` in fpsGameSocket.js): +2 punti in piazza
  (estremità N e S, rivolti verso la fontana), coerenti col layout.
- Nessun cambio a movimento/clamp: la piazza sta nella fascia già percorribile
  dei corridoi (il clamp radiale Jazz vale solo dentro il disco Jazz).

## Gameplay

- Sightline lunga Jazz↔Galleria spezzata da fontana (centro) + chiosco (S-E sfalsato).
- Coperture basse (panchine/aiuole) sugli anelli → scontri a corto-medio raggio.
- La vasca della fontana è entrabile (nessun rallentamento: è decorativa).
- 2 spawn nuovi → i round gravitano anche sulla piazza.

## Verifica

1. Render preview Blender per OGNI asset, con gate di approvazione utente per-asset
   (come per le armi curve G4.1).
2. Scena combinata cross-model (stile `debug_junction.py`) per gli innesti
   piazza↔imbocchi↔varchi esistenti.
3. Screenshot harness headless (Chrome swiftshader + puppeteer, `shot-fx.js` dello
   scratchpad come base) sulle 4 direzioni della piazza.
4. Gate finale: partita dell'utente in localhost (server avviato dall'utente).

## Fuori scope (esplicito)

- Arco/Ingresso Principale a sud. Lampioni-omino. Sottopasso di servizio.
- Zona Funland (sotto-progetto B) e anello flanking (C).
- Spostamento della Galleria (scartato: l'ovale evita di muoverla).
