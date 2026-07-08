# Fix di playtest — cucitura Jazz + Galleria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Verifica NON via pytest ma via **render Blender headless** + **playtest localhost** (l'utente conferma ogni gate).

**Goal:** Chiudere la mappa Jazz↔Galleria (nessuna uscita) ed eliminare i glitch del playtest, lavorando su copie `-wip` senza rigenerare gli asset validati.

**Architecture:** Innesti geometrici in Blender (copie `-wip` degli script → GLB nelle cartelle `-wip`) + un fix di collisione in `fps.js` (`loadZone`). Il gioco carica dalle `-wip`; originali congelati + snapshot come backup.

**Tech Stack:** Blender 5.1 headless (`--background --python`), Three.js r128, JS vanilla.

## Global Constraints
- **Jazz intoccabile**: `frontend/assets/models/jazz/**` e `zona-layout.json` NON si modificano.
- **Nessun asset individuale validato rigenerato**: NON rilanciare `kit_muri.py`, `kit_mezzanino.py`, `kit_rotonda.py`. La porta nuova è un file nuovo da uno script nuovo.
- **Commit solo l'utente** (anche nel worktree). Io non committo.
- Blender exe: `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe`. In Git Bash:
  `"/c/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --python <script>`.
- Coordinate di gioco: x→est, z→sud, y→su. Blender: bx=x_gioco, by=−z_gioco, bz=y_gioco.
- Stile asset: boxy ma dettagliato; poche draw call (merge per materiale), COL a box, no z-fighting.
- Worktree: `.claude/worktrees/fps-galleria-art-deco`.

---

### Task 0: Setup cartelle e script `-wip` + wiring `fps.js`

**Files:**
- Create: `frontend/assets/models/galleria-wip/` (copia di `galleria/`)
- Create: `frontend/assets/models/collegamenti-wip/` (copia di `collegamenti/`)
- Create: `docs/superpowers/plans/blender-scripts/collegamenti/collegamenti-layout-wip.py`
- Create: `docs/superpowers/plans/blender-scripts/galleria/galleria-layout-wip.py`
- Modify: `frontend/fps.js:3096-3098` (path di caricamento → `-wip`)

**Interfaces:**
- Produces: cartelle `-wip` popolate + `fps.js` che carica da esse. Gli script `-wip` scrivono nelle `-wip` (MODELS_DIR redirette).

- [ ] **Step 1: Duplicare le cartelle modelli**

```bash
cd ".claude/worktrees/fps-galleria-art-deco/frontend/assets/models"
cp -r galleria galleria-wip
cp -r collegamenti collegamenti-wip
ls galleria-wip collegamenti-wip
```
Expected: `galleria-wip/` con tutti i GLB + `pavimentazione.glb` + json; `collegamenti-wip/` con `collegamenti.glb` + json.

- [ ] **Step 2: Copia di lavoro `collegamenti-layout-wip.py` con MODELS_DIR redirette**

Copiare `collegamenti-layout.py` in `collegamenti-layout-wip.py` e cambiare SOLO la riga:
```python
MODELS_DIR = WORKTREE + "/frontend/assets/models/collegamenti-wip"
```
(PREVIEW_DIR resta invariato: le preview non sono servite dal gioco.)

- [ ] **Step 3: Copia di lavoro `galleria-layout-wip.py` con MODELS_DIR redirette**

Copiare `galleria-layout.py` in `galleria-layout-wip.py` e, subito dopo `import galleria_lib as gl` / `importlib.reload(gl)`, aggiungere:
```python
gl.MODELS_DIR = "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-galleria-art-deco/frontend/assets/models/galleria-wip"
```
Così `export_glb` e `piazza_glb` (import dei GLB per il render) usano la `-wip`.

- [ ] **Step 4: Rigenerare i due composit nelle `-wip` (baseline, nessuna modifica geometrica ancora)**

```bash
BL="/c/Program Files/Blender Foundation/Blender 5.1/blender.exe"
cd ".claude/worktrees/fps-galleria-art-deco/docs/superpowers/plans/blender-scripts"
"$BL" --background --python collegamenti/collegamenti-layout-wip.py 2>&1 | tail -5
"$BL" --background --python galleria/galleria-layout-wip.py 2>&1 | tail -5
```
Expected: "collegamenti completato" e "Render galleria completati"; file riscritti in `-wip`.
Nota: questo verifica che gli script `-wip` producono output identico agli attuali (baseline).

- [ ] **Step 5: Puntare `fps.js` alle `-wip`**

In `frontend/fps.js` (righe ~3096-3098), cambiare i path:
```javascript
            loadZone('assets/models/jazz/', 'zona-layout.json', { skip: v.skip, passthrough: v.passthrough || [] }),
            loadZone('assets/models/collegamenti-wip/', 'collegamenti-layout.json', { pav: false }),
            loadZone('assets/models/galleria-wip/', 'galleria-layout.json', { offset: GALLERIA_OFF }),
```
(Jazz resta `jazz/`. Solo collegamenti e galleria → `-wip`.)

- [ ] **Step 6: Verifica localhost (GATE utente — nessuna regressione)**

```bash
cd ".claude/worktrees/fps-galleria-art-deco/backend" && node server.js
```
L'utente apre `localhost:3000`, entra in FPS: la mappa deve caricare **identica ad ora** (stessi bug, ma nessun errore di caricamento / niente asset mancanti). Conferma prima di procedere.

---

### Task 1 (B1): Innesto centrale — testata crema che copre i muri rossi

**Files:**
- Modify: `docs/superpowers/plans/blender-scripts/collegamenti/collegamenti-layout-wip.py` (sezione CORRIDOIO PRINCIPALE, ~righe 103-116)

**Interfaces:**
- Consumes: geometria vicini Jazz — idx37 `(44.81, -7.92, rotY -80)`, idx39 `(45.06, 6.30, rotY -98)`, varco idx38 rimosso a `(45.48, -1.21)`. Corridoio main a z=−1.2, W_MAIN=7.
- Produces: `collegamenti-wip/collegamenti.glb` con testata d'ingresso crema (mesh + COL) senza muri rossi esposti.

- [ ] **Step 1: Aggiungere la testata d'ingresso crema al lato Jazz del main**

Dopo i `main_tappo` (riga ~116) aggiungere una parete-proscenio crema che va da idx37 a idx39
coprendo le facce rosse, con varco = W_MAIN al centro (z=−1.2). Riusa `endcap()` già presente:
```python
# TESTATA d'ingresso crema al filo Jazz: copre le facce rosse dei palazzi idx37/idx39
# lasciando il varco del corridoio (W_MAIN). half_span copre fino ai vicini (~7.5 m/lato).
endcap("main_jz_cap", 'x', X_JZ, Z_MAIN, 7.6, W_MAIN / 2, H_MAIN, M['crema'], 3.4)
```
(`endcap` axis 'x' = muro nel piano x=X_JZ esteso lungo z, con porta 2*door_half=7 m e architrave COL sopra fino a H_MAIN.)

- [ ] **Step 2: Spingere i `main_tappo` davanti al mattone (anti-compenetrazione)**

Cambiare X_JZ−0.4 in X_JZ+0.2 nei due `main_tappo` (righe ~115-116) così stanno DAVANTI (lato galleria) alle facce rosse invece che dentro:
```python
    box_game(f"main_tappo_{int(zt * 10)}", 3.4, 3.6, H_MAIN, X_JZ + 0.2, zt, 0.0, M['crema'])
    box_game(f"COL_main_tappo_{int(zt * 10)}", 3.4, 3.6, H_MAIN, X_JZ + 0.2, zt, 0.0, M['crema'])
```

- [ ] **Step 3: Rigenerare + render top di debug**

```bash
BL="/c/Program Files/Blender Foundation/Blender 5.1/blender.exe"
"$BL" --background --python collegamenti/collegamenti-layout-wip.py 2>&1 | tail -3
```
Aprire `collegamenti/preview/collegamenti_top_debug.png` e verificare: imbocco centrale con testata crema continua, varco 7 m, nessun muro rosso che sporge tra i vicini.

- [ ] **Step 4: Verifica localhost (GATE utente)**

Server attivo → l'utente cammina nell'innesto centrale: niente muri rossi, niente z-fighting rosso/bianco, ingresso pulito alla galleria, nessun buco laterale. Conferma.

---

### Task 2 (B2): Buchi flank — tappi a cuneo agli innesti U↔disco Jazz

**Files:**
- Modify: `docs/superpowers/plans/blender-scripts/collegamenti/collegamenti-layout-wip.py` (funzione `flank_u`, ~righe 147-172, e chiamate ~176-179)

**Interfaces:**
- Consumes: vicini flank NE idx32 `(27.49,-36.26)` / idx34 `(37.04,-26.43)` attorno all'entrata `(32.5,-31.8)`; flank SE idx42 `(38.70,23.93)` / idx44 `(29.62,34.54)` attorno a `(34.9,29.18)`.
- Produces: `collegamenti.glb` con innesti flank↔disco sigillati (nessun gap tangente).

- [ ] **Step 1: Aggiungere tappi a cuneo all'entrata Jazz di ciascun flank**

Dentro `flank_u`, dopo le TESTATE (riga ~172), riempire il cuneo tra la testata dritta e l'anello curvo con due box crema/mattone ai lati del varco d'entrata:
```python
    # TAPPI a cuneo: chiudono il gap tra la testata dritta e i palazzi curvi adiacenti
    for sx in (-1, 1):
        tx = x_ent + sx * (half + 1.6)
        box_game(f"{p}_ent_tappo_{sx}", 3.2, 3.4, h, tx, z_ent + s * 0.2, 0.0, mat)
        box_game(f"COL_{p}_ent_tappo_{sx}", 3.2, 3.4, h, tx, z_ent + s * 0.2, 0.0, mat)
```

- [ ] **Step 2: Rigenerare + render**

```bash
BL="/c/Program Files/Blender Foundation/Blender 5.1/blender.exe"
"$BL" --background --python collegamenti/collegamenti-layout-wip.py 2>&1 | tail -3
```
In `collegamenti_top_debug.png` verificare che i due innesti flank↔disco (in alto e in basso) siano chiusi, senza spiragli tra U e cerchio.

- [ ] **Step 3: Verifica localhost (GATE utente)**

L'utente prova a uscire dalla mappa nei due flank (dx/sx): non deve esserci più il buco. Conferma.

---

### Task 3 (B3): Sommità flank + porta verde `portale_varco`

**Files:**
- Create: `docs/superpowers/plans/blender-scripts/galleria/kit_porta_varco.py` (build ISOLATO di `portale_varco.glb` → `galleria-wip/`)
- Modify: `docs/superpowers/plans/blender-scripts/galleria/galleria-layout-wip.py:100` (N/S → `portale_varco`)
- Modify: `docs/superpowers/plans/blender-scripts/collegamenti/collegamenti-layout-wip.py:172` (coordinare `gal_cap`)

**Interfaces:**
- Consumes: cornice Déco di `build_portale`/`build_portale_aperto` (kit_muri, W=11 H=9.5, y_c=0.4, `mats['verde_scuro']`, `mats['oro']`, `mats['nero']`).
- Produces: `galleria-wip/portale_varco.glb`; galleria-layout con N/S = `portale_varco`.

- [ ] **Step 1: Creare `kit_porta_varco.py` (build isolato, NON tocca kit_muri)**

```python
# kit_porta_varco.py — SOLO portale_varco.glb (cornice Deco verde, varco senza anta,
# parete piena sopra il varco con COL → niente scavalco). Non rilancia kit_muri.
import sys, math
GALLERIA = "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-galleria-art-deco/docs/superpowers/plans/blender-scripts/galleria"
sys.path.insert(0, GALLERIA)
import bpy
import galleria_lib as gl
gl.MODELS_DIR = "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-galleria-art-deco/frontend/assets/models/galleria-wip"

def build_portale_varco(mats):
    W, H = 11.0, 9.5
    y_c = 0.4
    DOOR_HALF = 1.75   # varco 3.5 m = larghezza flank
    DOOR_H = 3.2       # altezza varco
    # cornice perimetrale a gradoni (identica al portale) + scritta + corona
    for gi, off in enumerate((0.0, 0.35, 0.7)):
        wgi = 0.55 - gi * 0.12
        mat = mats['nero'] if gi == 0 else mats['oro']
        for s in (-1, 1):
            gl.add_box(f"spalla_{gi}_{s}", wgi, 0.8 + gi * 0.06, H - off, s * (W / 2 - off - wgi / 2), y_c - gi * 0.03, 0.0, mat, bevel=0.015)
        gl.add_box(f"traversa_{gi}", W - 2 * off, 0.8 + gi * 0.06, wgi, 0, y_c - gi * 0.03, H - off - wgi, mat, bevel=0.015)
    gl.add_text_mesh("scritta", "GALLERIA", 0.42, 0, y_c - 0.48, 8.52, mats['oro'], extrude=0.06)
    gl.cornice_gradoni("corona", 4.0, 0.9, 0, y_c, H, mats, gradoni=3, gh=0.16, verso=-1)
    # TAMPONAMENTO verde ai lati del varco (ante Deco fisse) — da DOOR_HALF a W/2
    fill_w = (W / 2 - 0.55) - DOOR_HALF
    for s in (-1, 1):
        cx = s * (DOOR_HALF + fill_w / 2)
        gl.add_box(f"tampone_{s}", fill_w, 0.55, H - 1.0, cx, y_c, 0.0, mats['verde_scuro'], bevel=0.01)
        for li in range(4):
            gl.add_box(f"tampone_fascia_{s}_{li}", fill_w - 0.3, 0.10, 0.10, cx, y_c - 0.2, 0.8 + li * 1.7, mats['oro'], bevel=0.01)
    # ARCHITRAVE sopra il varco (parete piena → niente scavalco), da DOOR_H in su
    gl.add_box("architrave", 2 * DOOR_HALF, 0.55, H - 1.0 - DOOR_H, 0, y_c, DOOR_H, mats['verde_scuro'], bevel=0.01)
    gl.sunburst("arco_varco", 0, 0.06, DOOR_H + 0.05, DOOR_HALF, mats, n_raggi=7, apertura=160.0)
    # COL: stipiti laterali (fino a W/2) + architrave sopra il varco. Varco centrale libero.
    for s in (-1, 1):
        cx = s * (DOOR_HALF + fill_w / 2)
        gl.add_box(f"COL_tampone_{s}", fill_w + 0.2, 0.85, H, cx, y_c, 0.0, mats['nero'], bevel=0)
    gl.add_box("COL_architrave", 2 * DOOR_HALF, 0.85, H - DOOR_H, 0, y_c, DOOR_H, mats['nero'], bevel=0)

gl.clear_scene()
mats = gl.make_materials()
build_portale_varco(mats)
gl.export_glb("portale_varco.glb")
gl.render_previews("portale_varco", ortho_scale=14, alt_front=4.8, quarter_pos=(11, -12, 8), quarter_target_z=4.5)
print("portale_varco esportato in galleria-wip")
```

- [ ] **Step 2: Eseguire il build isolato + verificare la preview**

```bash
BL="/c/Program Files/Blender Foundation/Blender 5.1/blender.exe"
cd ".claude/worktrees/fps-galleria-art-deco/docs/superpowers/plans/blender-scripts"
"$BL" --background --python galleria/kit_porta_varco.py 2>&1 | tail -3
ls -la ../../../frontend/assets/models/galleria-wip/portale_varco.glb
```
Aprire `galleria/preview/portale_varco_front.png` e `_quarter.png`: cornice Déco verde/oro, varco centrale 3.5 m aperto, parete piena sopra il varco. Confermare che `galleria/portale.glb` (originale) NON è cambiato:
```bash
ls -la ../../../frontend/assets/models/galleria/portale.glb   # timestamp invariato
```

- [ ] **Step 3: N/S usano `portale_varco` in `galleria-layout-wip.py`**

Riga ~100, sostituire:
```python
    # EST (b==1) sigillato (porta verde); N/S = porta a varco verso i flank; O = corridoio main
    if b == 1:
        add("portale", x, z, -phi)
    elif b in (0, 2):
        add("portale_varco", x, z, -phi)
    else:
        add("portale_aperto", x, z, -phi)
```

- [ ] **Step 4: Coordinare la testata `gal_cap` crema del flank (evita doppioni)**

In `collegamenti-layout-wip.py` la `endcap(f"{p}_gal_cap", ...)` (riga ~172) sigilla già il portale galleria lato flank. Ora la sigillatura la fa `portale_varco` (verde). Rimuovere il muro crema ridondante lasciando solo il pavimento/raccordo: commentare la riga `endcap(f"{p}_gal_cap", ...)`:
```python
    # endcap(f"{p}_gal_cap", 'z', z_gal, x_gal, 5.2, half, h, M['crema'], 3.0)  # sostituito da portale_varco (galleria)
```

- [ ] **Step 5: Rigenerare galleria + collegamenti + render**

```bash
BL="/c/Program Files/Blender Foundation/Blender 5.1/blender.exe"
"$BL" --background --python galleria/galleria-layout-wip.py 2>&1 | tail -3
"$BL" --background --python collegamenti/collegamenti-layout-wip.py 2>&1 | tail -3
```
Verificare `galleria/preview/galleria_top.png`: N/S con porta a varco; giunto flank↔portale senza gap.

- [ ] **Step 6: Verifica localhost (GATE utente)**

L'utente: sale la scala a pioli, prova a scavalcare i portali N/S dei flank → non deve riuscire (parete piena sopra il varco); si entra nei flank solo dal varco verde. EST resta sigillato. Conferma.

---

### Task 4 (Fase A): Fix pav-COL in `loadZone` (mezzanino + scatole nere)

**Files:**
- Modify: `frontend/fps.js:772-778` (ramo `hasPav` di `loadZone`)

**Interfaces:**
- Consumes: `addSolid(box)` (già esistente, riga ~904-916, accetta `{min,max}` Vector3 in coordinate mondo); `_jazzToonMat`.
- Produces: le 48 COL della `pavimentazione.glb` diventano solidi (mezzanino calpestabile, retro-corridoi solidi) e NON vengono renderizzate.

- [ ] **Step 1: Sostituire il ramo `hasPav` per estrarre le COL**

Rimpiazzare (righe ~772-778):
```javascript
        if (hasPav) {
            const pav = gltfs[0].scene;
            pav.updateMatrixWorld(true);
            pav.traverse(o => { if (o.isMesh) o.material = _jazzToonMat(o.material); });
            pav.position.set(off.x, JAZZ_Y_OFF, off.z);
            jazzZoneGroup.add(pav);
        }
```
con:
```javascript
        if (hasPav) {
            const pav = gltfs[0].scene;
            pav.position.set(off.x, JAZZ_Y_OFF, off.z);
            pav.updateMatrixWorld(true);
            // Le mesh COL_ nella pavimentazione (es. Galleria: mezzanino, retro-corridoi,
            // panche, urne) diventano SOLIDI e NON si renderizzano (come il percorso per-modello).
            const _pavCols = [];
            pav.traverse(o => {
                if (!o.isMesh) return;
                if (o.name.indexOf('COL_') === 0) { _pavCols.push(o); return; }
                o.material = _jazzToonMat(o.material);
            });
            for (const o of _pavCols) {
                const bb = new THREE.Box3().setFromObject(o);   // già in coordinate mondo (offset incluso)
                addSolid(bb.min.x, bb.min.z, bb.max.x, bb.max.z, bb.min.y, bb.max.y);
                o.parent.remove(o);
            }
            jazzZoneGroup.add(pav);
        }
```

- [ ] **Step 2: Verificare la firma di `addSolid`**

Controllare `frontend/fps.js` ~904-916: se `addSolid` accetta `(minX, minZ, maxX, maxZ, y0, y1)` usare come sopra; se accetta un box `{min,max}`, adattare a `addSolid({min: bb.min, max: bb.max})`. Allineare la chiamata alla firma reale.

Run:
```bash
grep -n "function addSolid" frontend/fps.js
```
Expected: firma di `addSolid`; adeguare lo Step 1 se serve.

- [ ] **Step 3: Verifica localhost (GATE utente)**

Server attivo → l'utente: sale sul mezzanino (scala a pioli) e ci **cammina sopra senza cadere**; niente più sfarfallio bianco/nero sul mezzanino; niente scatole nere sul pavimento; i retro-corridoi dietro i negozi hanno pareti solide. Verificare anche il "quadrato nero" del pavimento (③): se sparito, ③ chiuso; se resta, procedere a Task 5. Conferma.

---

### Task 5 (Fase C): Rifiniture — z-fight residuo (③) e teletrasporto negozi (⑥)

**Files:**
- Modify (condizionale ③): `docs/superpowers/plans/blender-scripts/galleria/galleria-layout-wip.py` (base nera pavimento, ~righe 214-219)
- Modify (⑥): `frontend/fps.js` (`resolveCollisions`, ~righe 2661-2705) e/o soglia negozi

**Interfaces:**
- Consumes: diagnosi post-Task 4 (se ③ persiste) e repro ⑥.
- Produces: pavimento senza z-fighting; ingresso/uscita negozi senza teletrasporto.

- [ ] **Step 1 (③, solo se persiste dopo Task 4): abbassare la base nera sotto le mattonelle**

Le mattonelle marmo hanno z0=0.03, top=0.07; la base nera è a z=0..0.05 → overlap. Abbassarla a top 0.02 (righe ~215-218):
```python
gl.add_cyl("base_rotonda", 10.75, 0.02, 0, 0, 0.0, mats['nero'], vertices=48)
...
    box = gl.add_box(f"base_braccio_{phi}", 9.6, Z_END - Z_M + 0.6, 0.02, gx, -gz, 0.0, mats['nero'], bevel=0)
```
Rigenerare galleria (`galleria-layout-wip.py`) e verificare in localhost che il quadrato nero sia sparito.

- [ ] **Step 2 (⑥): riprodurre il teletrasporto negozi e loggare**

Server attivo → l'utente entra/esce da una vetrina entrabile finché riproduce il "teletrasporto indietro". Nel frattempo aggiungere un log temporaneo in `resolveCollisions` (dopo il calcolo di `pushX/pushZ`) per misurare la spinta massima:
```javascript
        if (Math.abs(pushX) > 0.5 || Math.abs(pushZ) > 0.5) console.log('BIGPUSH', pushX.toFixed(2), pushZ.toFixed(2), box.cx, box.cz);
```
Identificare se la spinta scavalca la soglia (push > larghezza varco).

- [ ] **Step 3 (⑥): correggere la risoluzione OBB in soglia stretta**

In base al repro, applicare la correzione minima. Prima linea (sub-stepping anti-tunneling): risolvere le collisioni con lo spostamento suddiviso in più sotto-passi quando `|delta|` supera `PLAYER_RADIUS`. Implementazione: dove `resolveCollisions(pos)` viene chiamata nel movimento, iterare su N sotto-passi del delta di posizione. (Codice esatto da definire sul punto di chiamata dopo lo Step 2.) In alternativa, allargare la soglia della vetrina in un GLB `-wip` isolato.

- [ ] **Step 4: Rimuovere i log temporanei + verifica localhost finale (GATE utente)**

Togliere il `console.log('BIGPUSH'...)`. L'utente entra/esce dai negozi senza teletrasporto. Conferma.

- [ ] **Step 5: Aggiornare `docs/fps-notes.md`**

Annotare: cartelle `-wip`, fix pav-COL in `loadZone`, `portale_varco`, testate/tappi anti-fuga. (L'utente committa quando vuole; promozione `-wip`→reali su sua decisione.)

---

## Self-Review (coperture spec)
- ① innesto centrale → Task 1. ② buchi flank → Task 2. ⑤ sommità+porta verde → Task 3.
  ④ mezzanino/scatole nere → Task 4. ③ quadrato nero → Task 4 (+ Task 5 Step 1 se residuo).
  ⑥ negozi → Task 5. Setup/-wip/wiring → Task 0.
- Nessun asset individuale validato rigenerato (kit_muri/mezzanino/rotonda mai rilanciati;
  `portale_varco` da script nuovo isolato).
- Verifica reale: render Blender + gate localhost per ogni task (no pytest — dominio grafico).
