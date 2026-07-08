# Cucitura "mondo unico" Jazz + Galleria — design

Data: 2026-07-07. Attiva lo *stitching mondo unico* che era stato **parcheggiato** nello
spec `2026-07-07-galleria-art-deco-design.md` (punto 6). Estende il piano
`2026-07-07-galleria-art-deco.md` (in particolare il Task 5 di integrazione `fps.js`).
Worktree: `.claude/worktrees/fps-galleria-art-deco`. **Committa solo l'utente.**

## Obiettivo
Un solo mondo continuo e percorribile a piedi: dal quartiere **Jazz** si esce e si
raggiunge la **Galleria Art Déco** attraverso **3 corridoi** (1 principale + 2 di flank),
senza caricamenti/teleport. Aggiunge inoltre la **meccanica di arrampicata** sulle scale
a pioli della Galleria (già prevista dal Task 5).

## Vincolo NON NEGOZIABILE
**Il layout attuale di Jazz non si altera.** I varchi verso l'esterno si ottengono
**solo togliendo qualche edificio perimetrale**, senza spostare/riposizionare nulla e
senza rigenerare il modello o `zona-layout.json`. L'obiettivo è zero rischio di
regressioni o layout peggiore rispetto all'attuale.

## Geometria attuale (verificata)
Coordinate di gioco: x→est, z→sud, y→su.
- **Jazz** (`assets/models/jazz/`, `zona-layout.json`): disco chiuso. Anello perimetrale
  a r≈45.5 = ~44 palazzi quasi uniformi (~8° l'uno dall'altro, gap max ~10° → nessuna
  uscita). Anello intermedio r≈31 (isolotti a raggiera). Nucleo r≈5–11 (isolato + club).
  Le vie `varco_*` del JSON sono **corsie interne**, non aperture nel perimetro.
  Confini runtime: **clamp radiale** `MAP_RADIUS=49`, soffitto `MAP_CEIL=13`.
- **Galleria** (`assets/models/galleria/`, `galleria-layout.json`): croce centrata a
  (0,0), bracci N/S/E/O che finiscono a ±31.6 con **4 portali sigillati**; rotonda r=11;
  2 scale a pioli (`climb[]`); `ceilingY=8.5`. Oggi caricabile standalone.

## Disposizione nel mondo
- **Jazz** resta al centro: `jazz(0,0)`.
- **Galleria** traslata a **est in asse**, centro **`(97, 0)`** (offset applicato in
  `fps.js` al caricamento; il `galleria-layout.json` resta in coordinate locali,
  invariato). Corridoio principale ~20 m tra il bordo est di Jazz (~x45) e il portale
  OVEST della Galleria (locale −31.6 → mondo ≈65.4).
- Portali Galleria **aperti**: OVEST (principale), NORD e SUD (flank). Il portale **EST**
  resta sigillato (fondo della Galleria).

## Aperture nel perimetro di Jazz (per omissione, a runtime)
3 varchi, tutti sul lato est di Jazz, verso la Galleria:
- **EST** (angolo ≈ 0°) → corridoio **principale** (~9 m; omettere ~1–2 istanze
  perimetrali, arco ~6 m per edificio a r45.5).
- **NE** (angolo ≈ −45°, cioè +x/−z) → **flank nord** (~4 m; ~1 istanza).
- **SE** (angolo ≈ +45°, cioè +x/+z) → **flank sud** (~4 m; ~1 istanza).

Realizzazione: **skip-list** di istanze applicata in `loadZone` **solo in modalità mondo
esteso**. Saltando l'istanza spariscono sia la mesh sia i COL → varco pulito. Le istanze
da saltare si individuano per posizione (x,z sull'anello r≈45.5 ai 3 angoli). Sorgente
Jazz (modello + JSON) **intatta**; `?map=jazz` classico le carica tutte.

## I 3 corridoi (geometria Blender NUOVA — stile "misto")
Nuovi pezzi in `assets/models/galleria/` (o `assets/models/collegamenti/`), con mesh
`COL_*` per i muri, esportati come GLB + inseriti in un layout dei collegamenti.
- **Principale**: coperto, largo ~9 m, volta a **transizione** (mattoni/Jazz → Art Déco
  verso la Galleria). Da varco EST Jazz al portale OVEST Galleria, lungo z=0.
- **Flank nord**: vicolo stretto ~3–4 m, a **dogleg**, dal portale NORD Galleria
  (`97,−31.6`) che gira fino al varco NE di Jazz. Semi-coperto, defilato/occultato.
- **Flank sud**: speculare, dal portale SUD Galleria (`97,+31.6`) al varco SE di Jazz.

Priorità come per Jazz/Galleria: fluidità (poche draw call, merge per materiale), COL a
box, niente z-fighting.

## Collisioni e confini unificati (`fps.js`)
- **Rimuovere il clamp radiale** `MAP_RADIUS` (bloccherebbe l'uscita da Jazz). I confini
  diventano i **muri COL** (edifici Jazz, muri dei corridoi, vetrine/portali Galleria).
- **Rete di sicurezza globale**: bounding rettangolare che racchiude disco Jazz +
  corridoi + Galleria (anti-fuga se manca un COL). Sostituisce il clamp radiale.
- **Soffitto per-zona**: Jazz `MAP_CEIL=13`; corridoi la loro volta; Galleria
  `ceilingY=8.5` (dal JSON) come clamp verticale nell'area Galleria. Selezione per
  regione x/z del giocatore.

## Caricamento mappa (`fps.js`)
- Refactor `loadJazzZone()` → **`loadZone(dir, json, { offset, skip })`**: riuso 1:1 di
  merge-per-materiale, `_jazzToonMat`, `_mergeGeos`, `COL_*` → `addSolidOBB` (seno negato);
  `offset` traslazione mondo, `skip` skip-list istanze.
- Default (mondo esteso): carica **Jazz** `(0,0)` + **corridoi** `(0,0)` + **Galleria**
  `(97,0)`, con skip-list dei 3 varchi su Jazz.
- **`?map=jazz`** (debug): solo Jazz originale, senza skip e con clamp radiale classico.

## Meccanica scala / climb (`fps.js` — riusabile per il Luna Park)
- Le zone `climb[]` del `galleria-layout.json` (`x,z,w,d,y0,y1,faceRot`) diventano zone di
  arrampicata (con l'offset Galleria applicato).
- Dentro una zona climb, rivolto alla scala: **gravità off**, **W = sali / S = scendi**
  ~4 m/s, fino al mezzanino y≈4.55.
- **Uscita**: in cima (sbarco sul ballatoio senza incastri), in fondo (torna a terra),
  o allontanandosi lateralmente.

## Spawn (backend `fpsGameSocket.js`)
- FFA invariato (niente squadre). Aggiungere ~6–8 spawn in **Galleria** (rotonda,
  estremità bracci, mezzanino — con l'offset `(97,0)`) alla `SPAWN_POINTS` esistente,
  mantenendo la distribuzione distanziata. Mondo attivo su entrambi i lati.

## Sequenza di lavoro
A. **Blender**: skip-list dei 3 varchi Jazz (nessuna modifica al modello Jazz) +
   modellazione dei 3 corridoi (GLB + layout collegamenti) + apertura portali O/N/S
   Galleria (se i portali hanno COL che sigilla, produrne una variante "aperta").
B. **Gate render** con l'utente (top con frecce, 3/4, close-up innesti).
C. **fps.js**: `loadZone(dir,json,{offset,skip})`; carico esteso; rimozione clamp radiale
   + rete di sicurezza; soffitto per-zona; meccanica climb.
D. **Backend**: spawn Galleria.
E. **Playtest localhost** (2 tab): uscita da Jazz, percorrenza 3 corridoi, scala su/giù,
   collisioni, spawn. Aggiornare `docs/fps-notes.md`. Gate finale utente.

## Criteri di accettazione
- Da Jazz si raggiunge la Galleria a piedi via **3 corridoi** (1 largo principale + 2
  flank stretti/occultati); nessun varco fuori mappa.
- **Layout Jazz invariato**: nessuna regressione visiva/collisioni rispetto all'attuale;
  i varchi sono solo edifici mancanti nei 3 punti.
- Niente clamp radiale che blocchi l'uscita; nessuna fuga oltre i confini (rete di
  sicurezza + COL); soffitti coerenti per zona.
- Scala su/giù fluida, sbarco sul mezzanino senza incastri.
- Spawn distribuiti su Jazz e Galleria; partita giocabile in localhost a 2 client.
- Fluidità in linea con Jazz/Galleria (poche draw call, no z-fighting).
