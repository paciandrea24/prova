# Cucitura "mondo unico" Jazz + Galleria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un solo mondo continuo: da Jazz si raggiunge la Galleria a piedi via 3 corridoi (1 principale + 2 flank), con meccanica di arrampicata sulle scale.

**Architecture:** Nessuna modifica al modello/JSON di Jazz: i 3 varchi si creano omettendo poche istanze perimetrali a runtime (skip-list). La Galleria si carica con offset mondo `(97,0)`. I 3 corridoi sono geometria Blender nuova in coordinate mondo. In `fps.js`, `loadJazzZone` diventa `loadZone(dir,json,{offset,skip})`; via il clamp radiale, subentrano COL + rete di sicurezza globale + soffitto per-zona; nuova meccanica climb dalle zone `climb[]` del JSON.

**Tech Stack:** Blender 5.1 headless (Python), Three.js r128 (GLTFLoader), JS vanilla, Node/Express/Socket.io.

**Spec:** `docs/superpowers/specs/2026-07-07-cucitura-mondo-unico-jazz-galleria-design.md`

## Global Constraints
- **Committa SOLO l'utente**, anche nel worktree. Nessuno step fa `git commit`/`push`: ogni task chiude con un checkpoint di verifica per l'utente.
- **Layout Jazz invariato**: si può solo *omettere* istanze perimetrali; vietato spostare/rigenerare Jazz o editare `zona-layout.json`.
- **Italiano** in comunicazioni e commenti codice. Stile asset "boxy ma dettagliato".
- **Niente emoji nell'UI** (glyph unicode/SVG). Fluidità prioritaria (~poche draw call, no z-fighting).
- Coordinate di gioco: x→est, z→sud, y→su. Blender: bx=x, by=−z.
- Blender headless: `"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python <script>`.
- Sorgenti Blender in `docs/superpowers/plans/blender-scripts/`; output GLB in `frontend/assets/models/`.
- **Nessun test runner nel progetto**: la verifica è (a) render Blender headless confrontati col riferimento, (b) playtest localhost a 2 tab con controllo console. I "test" sono osservazioni su render/partita, non unit test.

---

## FASE A — Blender

### Task A1: Variante `portale_aperto` (portale attraversabile)

**Files:**
- Modify: `docs/superpowers/plans/blender-scripts/galleria/kit_muri.py` (`build_portale`, riga ~172-208; `COL_portale` a riga ~208)
- Output: `frontend/assets/models/galleria/portale_aperto.glb`

**Interfaces:**
- Produces: GLB `portale_aperto` = stesso frame Art Déco visivo di `portale` ma **senza** il muro sigillante `COL_portale` (si mantengono eventuali stipiti laterali sottili come COL, non il tamponamento centrale).

- [ ] **Step 1:** In `kit_muri.py`, duplicare `build_portale` in `build_portale_aperto(mats)`: identico, ma sostituire l'unico `gl.add_box("COL_portale", W, 0.85, H, 0, y_c, 0.0, ...)` con due stipiti laterali stretti che lasciano libero il varco centrale (larghezza passaggio ≥ 4 m):
```python
    jamb = 0.6
    gl.add_box("COL_stipite_sx", jamb, 0.85, H, -(W/2 - jamb/2), y_c, 0.0, mats['nero'], bevel=0)
    gl.add_box("COL_stipite_dx", jamb, 0.85, H,  (W/2 - jamb/2), y_c, 0.0, mats['nero'], bevel=0)
```
- [ ] **Step 2:** Aggiungere `portale_aperto` alla lista dei pezzi esportati (accanto a `("portale", build_portale, ...)` a riga ~242):
```python
    ("portale_aperto", build_portale_aperto, dict(ortho_scale=14, alt_front=4.8, quarter_pos=(11, -12, 8), quarter_target_z=4.5)),
```
- [ ] **Step 3:** Eseguire lo script che genera i pezzi muri:
```
"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python docs/superpowers/plans/blender-scripts/galleria/kit_muri.py
```
Atteso: creato `frontend/assets/models/galleria/portale_aperto.glb` + anteprime PNG in `preview/`.
- [ ] **Step 4 (verifica):** Aprire l'anteprima PNG di `portale_aperto`: il frame Art Déco è presente, il centro è libero (nessun tamponamento). **Checkpoint utente.**

### Task A2: Aggiornare `galleria-layout.py` — portali O/N/S aperti

**Files:**
- Modify: `docs/superpowers/plans/blender-scripts/galleria/galleria-layout.py` (funzione che piazza il portale d'estremità, riga ~98-99)
- Output: `frontend/assets/models/galleria/galleria-layout.json` rigenerato

**Interfaces:**
- Consumes: `portale_aperto.glb` (Task A1).
- Produces: `galleria-layout.json` in cui i bracci OVEST, NORD, SUD usano `portale_aperto`; il braccio EST resta `portale` (sigillato).

- [ ] **Step 1:** Individuare nel loop dei bracci l'indice/orientamento. I 4 portali nel JSON attuale sono a: N `(0,-31.6)`, E `(31.6,0)`, S `(0,31.6)`, O `(-31.6,0)`. Nel punto in cui si fa `add("portale", x, z, -phi)`, scegliere il modello in base al braccio:
```python
    # EST sigillato, gli altri 3 aperti (aggancio ai corridoi verso Jazz)
    is_est = abs(x - Z_END) < 0.5 and abs(z) < 0.5   # x≈+31.6, z≈0
    add("portale" if is_est else "portale_aperto", x, z, -phi)
```
(Se la geometria del loop rende più chiaro discriminare per `phi`, usare `phi`: EST = braccio con x positivo.)
- [ ] **Step 2:** Rieseguire l'assembler:
```
"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python docs/superpowers/plans/blender-scripts/galleria/galleria-layout.py
```
Atteso: `galleria-layout.json` rigenerato; render `galleria_top_debug.png` aggiornato.
- [ ] **Step 3 (verifica):** In `galleria-layout.json` i portali O/N/S hanno `"modello": "portale_aperto"`, EST `"portale"`. Nel render top, i 3 bracci O/N/S risultano aperti in punta. **Checkpoint utente.**

### Task A3: Kit corridoi + `collegamenti-layout.json` (coordinate mondo)

**Files:**
- Create: `docs/superpowers/plans/blender-scripts/collegamenti/collegamenti_lib.py` (o riuso di `galleria_lib.py` via import)
- Create: `docs/superpowers/plans/blender-scripts/collegamenti/kit_corridoi.py`
- Create: `docs/superpowers/plans/blender-scripts/collegamenti/collegamenti-layout.py`
- Output GLB: `frontend/assets/models/collegamenti/corr_main_seg.glb`, `corr_flank_seg.glb`, `corr_innesto.glb`
- Output layout: `frontend/assets/models/collegamenti/collegamenti-layout.json`

**Interfaces:**
- Produces: pezzi corridoio con mesh `COL_*` (muri + eventuale soffitto/volta) esportati come GLB; `collegamenti-layout.json` con struttura `{edifici:[{modello,x,z,rotY,y,s}], props:[]}` **in coordinate mondo** (frame Jazz, offset 0), così caricabile diretto senza offset.

Geometria mondo di riferimento (rifinire nei render):
- **Principale**: coperto, largo ~9 m, lungo l'asse x da `x≈45` (bordo Jazz) a `x≈65.4` (portale OVEST Galleria a mondo `97−31.6`), centrato su `z=0`. Volta a transizione mattoni→Déco.
- **Flank nord**: vicolo ~3.5 m, dogleg, dal portale NORD Galleria (mondo `97,−31.6`) verso il varco NE di Jazz (~`33,−31`).
- **Flank sud**: speculare, dal portale SUD Galleria (mondo `97,+31.6`) verso il varco SE di Jazz (~`33,+31`).

- [ ] **Step 1:** Creare `kit_corridoi.py` riusando gli helper di `galleria_lib.py` (`add_box`, `flat_material`, palette). Definire: `corr_main_seg` (segmento coperto largo 9, con 2 muri `COL_muro_sx/dx` + volta visiva; lunghezza modulare ~5 m), `corr_flank_seg` (segmento vicolo largo 3.5, 2 muri COL, semi-coperto), `corr_innesto` (pezzo di raccordo/curva per il dogleg dei flank). Ogni muro laterale è un `COL_*`.
- [ ] **Step 2:** Esportare i pezzi:
```
"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python docs/superpowers/plans/blender-scripts/collegamenti/kit_corridoi.py
```
Atteso: 3 GLB in `frontend/assets/models/collegamenti/` + anteprime.
- [ ] **Step 3:** Creare `collegamenti-layout.py` che, sull'asse mondo, piazza in fila i segmenti dei 3 corridoi (coord mondo) e scrive `collegamenti-layout.json`. Includere un render debug top che disegni ANCHE Jazz (import mesh o silhouette a raggio 45) e Galleria a offset (97,0), per validare gli innesti su varchi Jazz e portali Galleria.
- [ ] **Step 4:** Eseguire:
```
"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python docs/superpowers/plans/blender-scripts/collegamenti/collegamenti-layout.py
```
Atteso: `collegamenti-layout.json` + `collegamenti_top_debug.png` (Jazz+corridoi+Galleria).
- [ ] **Step 5 (verifica):** Nel render top combinato: il principale collega bordo Jazz est ↔ portale O Galleria in linea; i 2 flank raccordano portali N/S Galleria ↔ fianchi NE/SE Jazz senza buchi tra pavimenti. **Checkpoint utente.**

### Task A4: Definire la skip-list dei 3 varchi Jazz (dati, non Blender)

**Files:**
- Create: `frontend/assets/models/jazz/varchi-skip.json` (consumato da fps.js in modalità estesa)

**Interfaces:**
- Produces: `varchi-skip.json` = lista di coordinate `[{x,z}]` delle istanze perimetrali Jazz da OMETTERE (match per prossimità in fps.js). Candidati calcolati da `zona-layout.json` (anello r≈45.5):
  - **EST (main, ~9-12 m):** `{x:45.48,z:-1.21}` e `{x:45.06,z:6.3}` (idx 38, 39).
  - **NE (flank):** `{x:32.54,z:-31.8}` (idx 33).
  - **SE (flank):** `{x:34.91,z:29.18}` (idx 43) — in alternativa `{x:29.62,z:34.54}` (idx 44); scelta finale al gate render.

- [ ] **Step 1:** Scrivere `varchi-skip.json`:
```json
{ "skip": [
  {"x": 45.48, "z": -1.21},
  {"x": 45.06, "z": 6.30},
  {"x": 32.54, "z": -31.80},
  {"x": 34.91, "z": 29.18}
] }
```
- [ ] **Step 2 (verifica):** Confermare a video (o nel render di A3) che togliere quelle istanze apre i 3 varchi allineati agli innesti dei corridoi, senza scoprire buchi nel disco. **Checkpoint utente.**

### GATE render (checkpoint utente obbligatorio)
- [ ] Mostrare all'utente: anteprima `portale_aperto`, `galleria_top_debug.png`, `collegamenti_top_debug.png`. Ottenere OK sull'impianto geometrico **prima** di toccare `fps.js`.

---

## FASE B — fps.js

### Task B1: Refactor `loadJazzZone` → `loadZone(dir, jsonName, opts)`

**Files:**
- Modify: `frontend/fps.js` (`loadJazzZone` righe 721-801; costanti `JAZZ_DIR` 663; avvio 3011)

**Interfaces:**
- Produces:
  - `loadZone(dir, jsonName, { offset = {x:0,z:0}, skip = [] })` → Promise. Applica `offset` a ogni istanza (x,z) e alle relative COL, e alle zone `climb`; `skip` omette le istanze la cui (x,z) dista < 1.0 da una voce skip.
  - Array globale `climbZones` (popolato durante il load, coord mondo).

- [ ] **Step 1:** Rinominare `loadJazzZone` in `loadZone(dir, jsonName, opts)`. Sostituire `JAZZ_DIR` con il parametro `dir`; leggere `dir + jsonName`. Estrarre `const off = opts.offset||{x:0,z:0}; const skip = opts.skip||[];`.
- [ ] **Step 2:** Nel `place(inst,...)`, applicare l'offset alle coordinate:
```js
    const ix = inst.x + off.x, iz = inst.z + off.z;
    // usare ix,iz al posto di inst.x,inst.z nella compose M e nel calcolo wx,wz delle COL
```
- [ ] **Step 3:** Prima di `layout.edifici.forEach(...)`, filtrare le istanze da saltare:
```js
    const keep = e => !skip.some(s => Math.hypot((e.x) - s.x, (e.z) - s.z) < 1.0);
    layout.edifici.filter(keep).forEach(e => place(e, false));
```
(Il match è su coordinate LOCALI del layout: per Jazz offset=0, quindi combacia con `varchi-skip.json`.)
- [ ] **Step 4:** Se il layout ha `climb`, accumularle in `climbZones` con offset:
```js
    (layout.climb||[]).forEach(c => climbZones.push({
      x: c.x + off.x, z: c.z + off.z, w: c.w, d: c.d, y0: c.y0, y1: c.y1, faceRot: c.faceRot
    }));
```
- [ ] **Step 5:** Sostituire l'avvio (riga 3011):
```js
const EXTENDED = new URLSearchParams(location.search).get('map') !== 'jazz';
const GALLERIA_OFF = { x: 97, z: 0 };
const boot = EXTENDED
  ? fetch('assets/models/jazz/varchi-skip.json').then(r=>r.json()).then(v =>
      Promise.all([
        loadZone('assets/models/jazz/', 'zona-layout.json', { skip: v.skip }),
        loadZone('assets/models/collegamenti/', 'collegamenti-layout.json', {}),
        loadZone('assets/models/galleria/', 'galleria-layout.json', { offset: GALLERIA_OFF }),
      ]))
  : loadZone('assets/models/jazz/', 'zona-layout.json', {});
boot.then(() => { /* ...come prima: nascondi loading, joinFPS... */ });
```
- [ ] **Step 6 (verifica playtest):** `node server.js` in `backend/`, aprire `localhost:3000` sul gioco FPS (default = esteso). Atteso: si vede Jazz + corridoi + Galleria caricati; console `🏙` senza errori GLB. Aprire `?map=jazz`: solo Jazz, identico a prima. **Checkpoint utente.**

### Task B2: Confini unificati — via clamp radiale, COL + rete di sicurezza + soffitto per-zona

**Files:**
- Modify: `frontend/fps.js` (clamp righe 2788-2791; costanti `MAP_RADIUS`/`MAP_CEIL` righe 23-24)

**Interfaces:**
- Consumes: mondo caricato da Task B1 (COL già presenti per muri/edifici/corridoi).
- Produces: `ceilingAt(x,z)` e rete di sicurezza AABB globale; nessun clamp radiale in modalità estesa.

- [ ] **Step 1:** Aggiungere helper soffitto per-zona:
```js
// Soffitto per regione: Jazz (attorno origine), Galleria (attorno a GALLERIA_OFF), corridoi in mezzo.
const GALLERIA_CEIL = 8.5;   // ceilingY dal galleria-layout.json
const CORR_CEIL = 6.0;       // volta corridoi
function ceilingAt(x, z) {
  if (Math.hypot(x - 97, z) < 34) return GALLERIA_CEIL;   // area Galleria
  if (Math.hypot(x, z) < 50) return MAP_CEIL;             // area Jazz
  return CORR_CEIL;                                       // corridoi
}
```
- [ ] **Step 2:** Sostituire il blocco clamp (2788-2791) in modalità estesa con rete di sicurezza + soffitto per-zona:
```js
if (EXTENDED) {
  // Rete di sicurezza globale (anti-fuga se manca un COL). Racchiude Jazz+corridoi+Galleria.
  pos.x = Math.max(-50, Math.min(131, pos.x));
  pos.z = Math.max(-50, Math.min(50,  pos.z));
} else {
  const rr = Math.hypot(pos.x, pos.z);
  if (rr > MAP_RADIUS) { const k = MAP_RADIUS / rr; pos.x *= k; pos.z *= k; }
}
const ceil = EXTENDED ? ceilingAt(pos.x, pos.z) : MAP_CEIL;
if (pos.y > ceil) { pos.y = ceil; velocityY = Math.min(velocityY, 0); }
```
- [ ] **Step 3 (verifica playtest):** In esteso, camminare da Jazz nei 3 corridoi fino in Galleria: nessun muro invisibile blocca l'uscita da Jazz; non si esce dai bordi del mondo; il soffitto non "schiaccia" nelle zone sbagliate. In `?map=jazz`: comportamento identico all'attuale (disco chiuso, soffitto 13). **Checkpoint utente.**

### Task B3: Meccanica climb (scale a pioli)

**Files:**
- Modify: `frontend/fps.js` (`updateMovement` blocco gravità 2758-2783; stato movimento vicino a riga 66)

**Interfaces:**
- Consumes: `climbZones` (Task B1), `keys['KeyW']/['KeyS']`, `pos`, `velocityY`, `onGround`.
- Produces: comportamento di salita/discesa; nessuna nuova API pubblica.

- [ ] **Step 1:** Aggiungere costante e helper (vicino alle altre costanti movimento):
```js
const CLIMB_SPEED = 4.0;   // m/s verticali sulle scale a pioli
function climbZoneAt(x, z) {
  for (const c of climbZones) {
    if (Math.abs(x - c.x) <= c.w/2 && Math.abs(z - c.z) <= c.d/2) return c;
  }
  return null;
}
```
- [ ] **Step 2:** In `updateMovement`, PRIMA del blocco gravità (riga ~2758), intercettare la scala:
```js
const cz = climbZoneAt(pos.x, pos.z);
if (cz && pos.y >= cz.y0 - 0.1 && pos.y <= cz.y1 + 0.3) {
  // Sulla scala: niente gravità, W sale / S scende
  velocityY = 0;
  if (keys['KeyW']) pos.y += CLIMB_SPEED * dt;
  if (keys['KeyS']) pos.y -= CLIMB_SPEED * dt;
  pos.y = Math.max(cz.y0, Math.min(cz.y1 + 0.25, pos.y));
  // Sbarco in cima: piccola spinta in avanti sul ballatoio
  if (pos.y >= cz.y1) {
    const fr = cz.faceRot * Math.PI/180;
    pos.x += Math.sin(fr) * CLIMB_SPEED * dt;
    pos.z += Math.cos(fr) * CLIMB_SPEED * dt;
  }
  onGround = true;   // niente stato "in aria" sulla scala
  // salta il resto della fisica verticale di questo frame
  resolveCollisions(pos);
  return;   // se updateMovement fa altro dopo, spostare in un blocco if/else invece di return
}
```
(Se dopo il clamp ci sono passi/recoil da eseguire sempre, usare `if/else` invece di `return`, mantenendo la logica orizzontale già fatta sopra.)
- [ ] **Step 3 (verifica playtest):** Raggiungere una scala a pioli in Galleria; premere W per salire fluido fino al mezzanino (~4.55 m), sbarcare senza incastri; premere S per scendere; allontanarsi lateralmente esce dalla scala e riattiva la gravità. **Checkpoint utente.**

---

## FASE C — Backend

### Task C1: Spawn in Galleria

**Files:**
- Modify: `backend/sockets/games/fpsGameSocket.js` (`SPAWN_POINTS` righe 15-34)

**Interfaces:**
- Consumes: coordinate mondo Galleria (offset `(97,0)`, y=0, `angle` verso il centro).
- Produces: `SPAWN_POINTS` esteso con ~6-8 punti Galleria.

- [ ] **Step 1:** Aggiungere alla lista `SPAWN_POINTS` punti in Galleria (coord mondo = locale + 97 su x). Esempi (rifinire su punti calpestabili, lontano da muri): rotonda `(97,0)`; estremità bracci `(97±20, 0)`, `(97, ±20)`; mezzanino `(97, 0, y=4.55)` opzionale. `angle` orientato verso il centro Galleria.
```js
  // — GALLERIA (offset mondo x+97) —
  { x: 97,    y: 0, z: -18, angle: Math.PI },
  { x: 97,    y: 0, z:  18, angle: 0 },
  { x: 79,    y: 0, z:  0,  angle: -Math.PI/2 },
  { x: 115,   y: 0, z:  0,  angle:  Math.PI/2 },
  { x: 88,    y: 0, z: -10, angle: Math.PI },
  { x: 106,   y: 0, z:  10, angle: 0 },
```
- [ ] **Step 2:** Aggiornare il commento di intestazione (righe 15-18) per riflettere il mondo esteso (Jazz + Galleria) e il nuovo conteggio.
- [ ] **Step 3 (verifica playtest):** Avviare partita a 2 tab: i giocatori compaiono distribuiti tra Jazz e Galleria; nessuno spawna dentro un muro o sotto il pavimento. **Checkpoint utente.**

---

## FASE D — Verifica finale

### Task D1: Playtest integrato + note

**Files:**
- Modify: `docs/fps-notes.md` (nuova sezione "Cucitura Jazz↔Galleria")

- [ ] **Step 1 (playtest 2 tab):** Verificare i criteri di accettazione della spec: uscita da Jazz via 3 corridoi (1 largo + 2 flank), layout Jazz invariato, niente clamp che blocca l'uscita, nessuna fuga oltre i confini, scala su/giù fluida, spawn distribuiti, fluidità/no z-fighting.
- [ ] **Step 2:** Scrivere in `docs/fps-notes.md` la sezione con: offset Galleria `(97,0)`, come si generano i varchi (skip-list, sorgente Jazz intatta), modalità `?map=jazz` di debug, `ceilingAt`, `climbZones`/`CLIMB_SPEED`, elenco GLB corridoi.
- [ ] **Step 3 (GATE finale utente):** L'utente valida in localhost. Poi committa lui (nessun commit automatico).

---

## Self-Review (coperto vs spec)
- Mondo unico + 3 corridoi (1 main + 2 flank) → A3, B1. ✅
- Layout Jazz invariato via skip-list → A4, B1 (step 3). ✅
- Galleria offset (97,0), portali O/N/S aperti, EST sigillato → A1, A2, B1. ✅
- Via clamp radiale + rete di sicurezza + soffitto per-zona → B2. ✅
- Meccanica climb → B3. ✅
- Spawn distribuiti → C1. ✅
- `?map=jazz` debug → B1 (step 5), B2 (else-branch). ✅
- Verifica render + playtest + note → GATE render, D1. ✅
