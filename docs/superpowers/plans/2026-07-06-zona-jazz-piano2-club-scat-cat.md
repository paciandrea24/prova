# Zona Jazz — Piano ②: Jazz club "Scat Cat Jazz" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modellare su misura il jazz club "Scat Cat Jazz" (`club-scat-cat.py` → `club.glb`):
edificio d'angolo 2 piani con cresta art déco dorata, pannello con sax 3D e neon,
marquee "LIVE MUSIC", fedele all'immagine di riferimento
`C:\Users\pacia\Desktop\Viste mappa fps\Gemini_Generated_Image_v2o7kkv2o7kkv2o7.png`.

**Architecture:** Un unico script ricetta `club-scat-cat.py` costruito in 4 passate
incrementali (corpo → cresta → sax/neon → collisioni), ognuna verificata col ciclo
headless → render → lettura PNG. Riusa `jazz_lib.py` (helper + `_finestra`, `_vetrina`,
`_tetto_piatto`); si aggiunge alla libreria solo `neon_material()` (marcatore emissivo
per lo shader toon all'integrazione).

**Tech Stack:** Blender 5.1.2 headless (`C:\Program Files\Blender Foundation\Blender 5.1\blender.exe`),
Python `bpy`/`bmesh`/`mathutils`, `jazz_lib.py` del worktree.

## Global Constraints

- **NIENTE COMMIT**: mai `git add`/`git commit`/`git push`, nemmeno nel worktree — committa SOLO l'utente.
- Worktree: tutto in `C:\Users\pacia\Desktop\Claude Workspace\prova\.claude\worktrees\fps-mappa-blender-jazz`.
- Script in `docs/superpowers/plans/blender-scripts/` (worktree); GLB in `frontend/assets/models/jazz/`;
  anteprime PNG in `blender-scripts/preview/` (MAI da committare).
- 1 unità = 1 metro; base a z=0; fronte verso -Y.
- SOLO colori piatti (Principled Base Color + `mat.diffuse_color` allineato); il neon usa
  in più l'Emission come MARCATORE (il glow vero arriva dallo shader toon in fps.js).
- `primitive_cube_add(size=2)` SEMPRE (bug size=1 già pagato).
- Vetri in aggetto sui telai; NIENTE facce complanari tra mesh sovrapposte (1-2cm di rientro).
- Shade Smooth ovunque; bevel 0.015-0.03 sui box.
- Collisione `COL_*` rientrata 2cm, base a z=0.01.
- Insegne in INGLESE; commenti in ITALIANO.
- Verifica di ogni task: esecuzione headless senza Traceback + lettura render con Read.
- Comando headless: `& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python "<script>"`.

---

## Task 1: `neon_material()` in `jazz_lib.py`

**Files:**
- Modify: `docs/superpowers/plans/blender-scripts/jazz_lib.py` (worktree, sezione "PALETTE, MATERIALI, UTILITA'")

**Interfaces:**
- Consumes: `flat_material` esistente (stesso pattern nodi)
- Produces: `neon_material(name, rgba, strength=4.0) -> bpy.types.Material` — Principled
  con Base Color + Emission Color = rgba, Emission Strength = strength,
  `diffuse_color` = rgba (così le anteprime Workbench mostrano il colore pieno)

- [ ] **Step 1: Aggiungi la funzione sotto `flat_material`**

```python
def neon_material(name, rgba, strength=4.0):
    # Materiale "neon": colore piatto + Emission come MARCATORE per lo shader
    # toon (il glow vero si fa in Three.js). L'anteprima Workbench usa diffuse_color.
    mat = flat_material(name, rgba)
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if 'Emission Color' in bsdf.inputs:      # Blender 4/5
        bsdf.inputs['Emission Color'].default_value = rgba
    elif 'Emission' in bsdf.inputs:          # fallback nomi vecchi
        bsdf.inputs['Emission'].default_value = rgba
    bsdf.inputs['Emission Strength'].default_value = strength
    return mat
```

- [ ] **Step 2: Verifica sintassi headless**

Run: `& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python-expr "import sys; sys.path.insert(0, 'C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts'); import jazz_lib as jl; m = jl.neon_material('t', (1, 0, 0.5, 1)); print('OK', m.name)"`
Expected: `OK t`, nessun Traceback (se i nomi input Emission differiscono, l'errore esce qui).

---

## Task 2: `club-scat-cat.py` — corpo, facciata, ingresso

**Files:**
- Create: `docs/superpowers/plans/blender-scripts/club-scat-cat.py` (worktree)

**Interfaces:**
- Consumes: `jazz_lib`: `clear_scene, make_materials, flat_material, neon_material,
  add_box, add_box_c, add_cyl, add_sphere, add_strut, add_text_mesh, lathe_profile,
  skin_chain, _finestra, _vetrina, _tetto_piatto, export_glb, render_previews`
- Produces: lo scheletro dello script con le COSTANTI riusate dai task 3-4:
  `L=13.0, P=9.0, H_PT=4.0, CORPO_H=8.6, FY=-4.5, FYA=-5.0` (fronte avancorpo),
  e i materiali `mats` (palette crema), `mat_marquee`, `neon_blu`, `neon_rosa`,
  `luce_calda`. L'export/render stanno IN FONDO al file: i task 3-4 inseriscono
  le loro sezioni PRIMA dell'export.

- [ ] **Step 1: Scrivi lo script base**

```python
# club-scat-cat.py — Jazz club "Scat Cat Jazz" (edificio su misura, Piano 2)
# Corpo 2 piani crema con lesene + avancorpo centrale; sopra: pannello neon e
# cresta art deco (task successivi). Fronte verso -Y, base a z=0.
import sys
sys.path.insert(0, "C:/Users/pacia/Desktop/Claude Workspace/prova/.claude/worktrees/fps-mappa-blender-jazz/docs/superpowers/plans/blender-scripts")
import math
import jazz_lib as jl

# ── Costanti condivise dalle sezioni successive ──
L, P = 13.0, 9.0           # ingombro corpo
H_PT = 4.0                 # piano terra alto da club
CORPO_H = 8.6              # 2 piani: cornicione a ~9m come da spec
FY = -P / 2                # filo facciata corpo
FYA = FY - 0.5             # filo facciata avancorpo (sporge 50cm)

jl.clear_scene()
mats = jl.make_materials('crema')
mat_marquee = jl.flat_material("marquee_rosso", (0.62, 0.13, 0.12, 1.0))
neon_blu = jl.neon_material("neon_blu", (0.25, 0.75, 1.00, 1.0))
neon_rosa = jl.neon_material("neon_rosa", (1.00, 0.35, 0.55, 1.0))
luce_calda = jl.neon_material("luce_calda", (1.00, 0.85, 0.55, 1.0), strength=3.0)

# ── Corpo, zoccolo, marcapiano, avancorpo ──
jl.add_box("corpo", L, P, CORPO_H, 0, 0, 0.02, mats['muro'], bevel=0.03)
jl.add_box("zoccolo", L + 0.2, P + 0.2, 0.5, 0, 0, 0.0, mats['cornice'])
jl.add_box("fascia_pt", L + 0.15, P + 0.15, 0.18, 0, 0, H_PT - 0.05, mats['cornice'])
jl.add_box("avancorpo", 6.4, 0.5, CORPO_H + 0.02, 0, FY - 0.25, 0.02, mats['muro'], bevel=0.03)
jl.add_box("avancorpo_zoccolo", 6.6, 0.24, 0.5, 0, FY - 0.42, 0.0, mats['cornice'])

# ── Lesene sulle ali (con capitello), da zoccolo a cornicione ──
for li, lx in enumerate((-5.9, -3.6, 3.6, 5.9)):
    jl.add_box(f"lesena_{li}", 0.5, 0.18, CORPO_H - 0.9, lx, FY, 0.5, mats['cornice'])
    jl.add_box(f"capitello_{li}", 0.66, 0.24, 0.22, lx, FY - 0.02, CORPO_H - 0.42, mats['oro'])

# ── Cornicione a mensole + tetto (helper del generatore) ──
roof_z = jl._tetto_piatto(L, P, CORPO_H, mats)

# ── Finestre piano 1 sulle ali (2 per lato) ──
for ci, cx in enumerate((-5.65, -4.0, 4.0, 5.65)):
    jl._finestra(f"club_{ci}", cx, H_PT + 1.0, FY, mats)

# ── Vetrine del piano terra sulle ali ──
jl._vetrina("clubL", -4.85, FY, mats, larg=2.4)
jl._vetrina("clubR", 4.85, FY, mats, larg=2.4)

# ── Ingresso: doppia porta scura con cornice dorata, sull'avancorpo ──
jl.add_box("club_porta_cornice", 2.3, 0.16, 2.75, 0, FYA, 0.01, mats['oro'])
jl.add_box("club_porta_fondo", 1.9, 0.10, 2.55, 0, FYA - 0.04, 0.02, mats['scuro'])
for side, sx in (("L", -0.47), ("R", 0.47)):
    jl.add_box(f"club_anta_{side}", 0.96, 0.08, 2.57, sx, FYA - 0.08, 0.02, mats['legno'])
    jl.add_box(f"club_oblo_{side}", 0.42, 0.03, 0.62, sx, FYA - 0.13, 1.45, mats['vetro'])
    jl.add_box(f"club_pann_{side}", 0.52, 0.03, 0.75, sx, FYA - 0.13, 0.30, mats['scuro'])
jl.add_box("club_battente", 0.07, 0.03, 2.57, 0, FYA - 0.13, 0.02, mats['legno'], bevel=0.01)
jl.add_sphere("club_pomello_L", 0.05, -0.14, FYA - 0.17, 1.10, mats['oro'])
jl.add_sphere("club_pomello_R", 0.05, 0.14, FYA - 0.17, 1.10, mats['oro'])

# ── Gradinata (3 gradoni) ──
jl.add_box("club_gradino_1", 3.4, 1.05, 0.13, 0, FYA - 0.52, 0.0, mats['cornice'])
jl.add_box("club_gradino_2", 3.0, 0.75, 0.13, 0, FYA - 0.37, 0.13, mats['cornice'])
jl.add_box("club_gradino_3", 2.6, 0.45, 0.13, 0, FYA - 0.22, 0.26, mats['cornice'])

# ── Due lampade a muro ai lati della porta ──
for side, sx in (("L", -1.65), ("R", 1.65)):
    jl.add_strut(f"lampada_braccio_{side}", (sx, FYA, 2.55), (sx, FYA - 0.38, 2.72), 0.03, mats['ferro'])
    jl.add_cyl(f"lampada_corpo_{side}", 0.09, 0.16, sx, FYA - 0.38, 2.72, mats['ferro'])
    jl.add_sphere(f"lampada_vetro_{side}", 0.14, sx, FYA - 0.38, 2.62, luce_calda)
    jl.lathe_profile(f"lampada_campana_{side}", [(0.02, 0.0), (0.16, -0.06), (0.19, -0.12), (0.0, -0.12)],
                     mats['ferro']).location = (sx, FYA - 0.38, 2.90)

# ═══ (Task 3: MARQUEE + PANNELLO + CRESTA — inserire QUI) ═══

# ═══ (Task 4: SAX + NEON + NOTE — inserire QUI) ═══

# ═══ (Task 5: COLLISIONI — inserire QUI) ═══

jl.export_glb("club.glb")
jl.render_previews("club", ortho_scale=21.0, alt_front=7.0,
                   quarter_pos=(17, -19, 12), quarter_target_z=6.5)
```

- [ ] **Step 2: Esegui headless**

Run: comando headless su `club-scat-cat.py`.
Expected: `Esportato: .../club.glb`, nessun Traceback.

- [ ] **Step 3: Guarda i render**

Read di `preview/club_front.png` e `club_quarter.png`. Checklist:
- corpo crema largo e alto (~9m al cornicione), avancorpo centrale in rilievo
- 4 lesene con capitello dorato, cornicione a mensole
- 2 finestre per ala al piano 1, vetrine al PT, MAI vetri annegati
- doppia porta scura con oblò, cornice dorata, battente centrale,
  NESSUN vuoto sopra le ante (stesso standard del fix `_portone`)
- gradinata a 3 gradoni, lampade con globo caldo visibile
- niente z-fighting né elementi fluttuanti

Correggi e riesegui finché passa.

---

## Task 3: Marquee + pannello scuro + cresta art déco

**Files:**
- Modify: `docs/superpowers/plans/blender-scripts/club-scat-cat.py` (sezione Task 3)

**Interfaces:**
- Consumes: costanti `FYA`, `H_PT`, `CORPO_H`, materiali `mats`, `mat_marquee`, `luce_calda`
- Produces: il pannello scuro (fronte a `FYA - 0.15`, da z 4.6 a 10.6, largo 5.6) su cui
  il Task 4 appoggia sax e neon; `CRESTA_TOP = 14.0` per la collisione del Task 5

- [ ] **Step 1: Inserisci la sezione al segnaposto Task 3**

```python
# ── MARQUEE "LIVE MUSIC" sopra l'ingresso ──
jl.add_box("marquee_cornice", 5.1, 0.5, 1.5, 0, FYA - 0.18, 2.95, mats['oro'])
jl.add_box("marquee_cassa", 4.8, 0.5, 1.24, 0, FYA - 0.28, 3.08, mat_marquee)
jl.add_text_mesh("marquee_testo1", "LIVE MUSIC", 0.46, 0, FYA - 0.56, 3.95, luce_calda)
jl.add_text_mesh("marquee_testo2", "EST. 1928 - JAZZ CLUB", 0.24, 0, FYA - 0.56, 3.42, mats['tenda_b'])
# tettuccio del marquee
jl.add_box("marquee_tetto", 5.3, 0.62, 0.10, 0, FYA - 0.20, 4.45, mats['oro'])

# ── PANNELLO SCURO incassato nella cresta (fondale di sax e neon) ──
jl.add_box("pannello_cornice", 6.1, 0.30, 6.5, 0, FY - 0.32, 4.45, mats['oro'])
jl.add_box("pannello", 5.6, 0.22, 6.0, 0, FY - 0.40, 4.60, mats['scuro'])

# ── CRESTA: ventaglio di canne dorate verticali (centro piu' alto) ──
CRESTA_TOP = 14.0
for ri, (rx, rw, rtop) in enumerate((
        (0.0, 1.30, CRESTA_TOP), (-0.95, 1.00, 13.0), (0.95, 1.00, 13.0),
        (-1.80, 0.90, 12.1), (1.80, 0.90, 12.1),
        (-2.60, 0.85, 11.2), (2.60, 0.85, 11.2),
        (-3.35, 0.80, 10.3), (3.35, 0.80, 10.3))):
    jl.add_box(f"cresta_canna_{ri}", rw, 0.55, rtop - 4.3, rx, FY - 0.24, 4.3, mats['oro'], bevel=0.03)
# nervatura centrale in rilievo sulla canna piu' alta
jl.add_box("cresta_nervatura", 0.45, 0.12, CRESTA_TOP - 4.6, 0, FY - 0.56, 4.5, mats['oro'], bevel=0.02)

# ── Volute laterali alla base della cresta (spirali skin_chain dorate) ──
for side, vx in (("L", -4.05), ("R", 4.05)):
    punti = []
    for i in range(11):
        t = i / 10.0
        ang = t * 1.6 * math.pi
        r = 0.55 * (1.0 - 0.8 * t)
        punti.append((vx + r * math.sin(ang) * (1 if side == "R" else -1),
                      FY - 0.24, 9.9 + r * math.cos(ang) - 0.55))
    jl.skin_chain(f"voluta_{side}", punti, [(0.10, 0.10)] * 11, mats['oro'], subsurf_levels=1)
```

NOTA volute: la spec suggeriva lathe; la spirale `skin_chain` (tecnica validata per le
eliche del palo da barbiere) rende la voluta a ricciolo molto meglio di una rivoluzione.

- [ ] **Step 2: Esegui headless e guarda i render**

Checklist su `club_front.png` / `club_quarter.png`:
- marquee rosso bordato d'oro, "LIVE MUSIC" grande e leggibile, riga EST. 1928 sotto
- pannello scuro incorniciato d'oro sopra il marquee, senza buchi tra marquee e pannello
- cresta a ventaglio: canna centrale a ~14m, digradanti ai lati, silhouette da jukebox
- volute a ricciolo agli angoli della cresta, dorate, non fluttuanti
- vista quarter: la cresta sporge dal tetto in modo credibile (spessore visibile)
- niente z-fighting tra canne/pannello/cornice

Correggi e riesegui finché passa.

---

## Task 4: Sax dorato 3D + neon "SCAT CAT" / "JAZZ" + note musicali

**Files:**
- Modify: `docs/superpowers/plans/blender-scripts/club-scat-cat.py` (sezione Task 4)

**Interfaces:**
- Consumes: pannello del Task 3 (fronte a `FY - 0.51`), `neon_blu`, `neon_rosa`, `mats['oro']`
- Produces: niente per i task successivi (dettaglio finale della facciata)

- [ ] **Step 1: Inserisci la sezione al segnaposto Task 4**

```python
# ── SAX DORATO 3D sul pannello (corpo a J inclinato, campana lathe, chiavi) ──
SAX_Y = FY - 0.70          # 20cm davanti al pannello
def _sax_punto(t):
    # Spina del sax: discesa inclinata + curva a J in basso (parametrica 0..1)
    if t < 0.75:            # canna: dall'imboccatura in alto a dx verso il basso
        u = t / 0.75
        return (0.95 - 1.10 * u, SAX_Y, 9.35 - 3.55 * u)
    u = (t - 0.75) / 0.25   # curva a J: risale verso sinistra
    ang = u * math.pi * 0.85
    return (-0.15 - 0.55 * math.sin(ang), SAX_Y, 5.80 - 0.55 * (1 - math.cos(ang)))

punti_sax = [_sax_punto(i / 15.0) for i in range(16)]
raggi_sax = [(0.055 + 0.075 * (i / 15.0),) * 2 for i in range(16)]
jl.skin_chain("sax_corpo", punti_sax, raggi_sax, mats['oro'], subsurf_levels=2)
# campana svasata (lathe) alla fine della J, rivolta in alto a sinistra
campana = jl.lathe_profile("sax_campana", [(0.02, 0.0), (0.13, 0.18), (0.20, 0.34), (0.33, 0.48), (0.36, 0.52)],
                           mats['oro'], segments=24)
campana.location = (-0.78, SAX_Y, 5.42)
campana.rotation_euler = (0, math.radians(-18), 0)
# imboccatura (bocchino scuro)
jl.add_box_c("sax_bocchino", 0.09, 0.09, 0.34, 1.00, SAX_Y, 9.48, mats['scuro'],
             rot=(0, math.radians(17), 0), bevel=0.01)
# chiavi: sferette dorate lungo la canna
for ki in range(6):
    t = 0.18 + ki * 0.10
    px, py, pz = _sax_punto(t)
    jl.add_sphere(f"sax_chiave_{ki}", 0.055, px - 0.09, py - 0.06, pz, mats['tenda_b'])

# ── NEON: SCAT CAT (azzurro, a sinistra) + JAZZ (rosa, in basso a destra) ──
NEON_Y = FY - 0.56
jl.add_text_mesh("neon_scat", "SCAT", 0.72, -1.55, NEON_Y, 9.15, neon_blu, extrude=0.05)
jl.add_text_mesh("neon_cat", "CAT", 0.72, -1.55, NEON_Y, 8.05, neon_blu, extrude=0.05)
jl.add_text_mesh("neon_jazz", "JAZZ", 0.95, 1.30, NEON_Y, 5.55, neon_rosa, extrude=0.05)

# ── Due note musicali (testa sfera + gambo + bandierina), neon ──
for ni, (nx, nz, mat) in enumerate(((1.75, 9.30, neon_blu), (2.30, 8.75, neon_rosa))):
    jl.add_sphere(f"nota_testa_{ni}", 0.11, nx, NEON_Y, nz, mat)
    jl.add_strut(f"nota_gambo_{ni}", (nx + 0.10, NEON_Y, nz + 0.04), (nx + 0.10, NEON_Y, nz + 0.55), 0.03, mat)
    jl.add_box_c(f"nota_bandiera_{ni}", 0.16, 0.06, 0.22, nx + 0.16, NEON_Y, nz + 0.48, mat,
                 rot=(0, math.radians(-25), 0), bevel=0.01)
```

- [ ] **Step 2: Esegui headless e guarda i render**

Checklist su `club_front.png` (questa e' la facciata-firma della zona, guardarla BENE):
- sax leggibile come sax: canna inclinata, J in basso, campana svasata verso l'alto-sinistra
- chiavi chiare lungo la canna (non fuse nel corpo)
- "SCAT" / "CAT" in azzurro a sinistra del sax, "JAZZ" rosa in basso a destra, tutto
  DENTRO il pannello scuro, niente testo che sborda sulla cornice dorata
- note musicali riconoscibili in alto a destra
- nessun elemento annegato nel pannello (tutto in aggetto)

Correggi posizioni/scala finché la composizione somiglia all'immagine di riferimento.

---

## Task 5: Collisioni + export finale + gate utente

**Files:**
- Modify: `docs/superpowers/plans/blender-scripts/club-scat-cat.py` (sezione Task 5)

**Interfaces:**
- Consumes: `L, P, CORPO_H, FY, CRESTA_TOP`
- Produces: `club.glb` definitivo con `COL_corpo` + `COL_cresta` (contratto AABB per
  i solidBoxes di fps.js, come per gli edifici 01-10)

- [ ] **Step 1: Inserisci la sezione al segnaposto Task 5**

```python
# ── COLLISIONI (AABB per solidBoxes: rientrate 2cm, base a 0.01) ──
jl.add_box("COL_corpo", L - 0.04, P - 0.04, CORPO_H - 0.02, 0, 0, 0.01, mats['scuro'], bevel=0)
# avancorpo + cresta: lastra frontale che copre porta, marquee, pannello e canne
jl.add_box("COL_cresta", 6.36, 0.52, CRESTA_TOP - 0.02, 0, FY - 0.25, 0.01, mats['scuro'], bevel=0)
```

- [ ] **Step 2: Esegui headless (export definitivo)**

Run: comando headless su `club-scat-cat.py`.
Expected: `Esportato: .../club.glb`, nessun Traceback.

- [ ] **Step 3: Verifica finale dei render**

Read di `club_front.png` e `club_quarter.png` con la checklist dei criteri di successo:
- silhouette completa: gradinata → porta → marquee → pannello neon → cresta a 14m
- confronto side-by-side mentale con l'immagine di riferimento (club al centro)
- le COL non sporgono da nessun lato (sono dentro il corpo/avancorpo)

- [ ] **Step 4: Gate utente**

Chiedere all'utente di aprire `club.glb` in Blender (o `club-scat-cat.py` via Run Script)
e validare. Ogni richiesta di modifica riapre il ciclo: correggi → headless → render →
confronto. NIENTE commit (li fa l'utente).

---

## Stato esecuzione (2026-07-06, inline)

- Task 1-5 ESEGUITI: `neon_material` in `jazz_lib.py`, `club-scat-cat.py` completo,
  `club.glb` esportato, render `club_front/quarter.png` verificati. NIENTE commit.
- Scostamenti dal piano (documentati, tutti verificati a render):
  1. Palette: `mats['cornice']` override a "pietra_chiara" (0.90,0.86,0.76) — il
     bordeaux della palette crema rendeva la facciata rosata, non da club.
  2. Avancorpo 6.4→7.0m; UNA finestra per ala (larg 1.2) e vetrine larg 1.7: con due
     finestre si sovrapponevano alle lesene (campate da 1.95m).
  3. Cresta ridisegnata: gambe laterali (x ±3.05, w 0.70) + fascia d'arco (z 10.35) +
     ventaglio DIETRO il pannello (y FY+0.10) — nel piano originale le canne
     coprivano il pannello scuro.
  4. Sax: ansa a U ad arco di cerchio (r 0.45, centro (-0.35, 6.00)) con campana
     attaccata a fine ansa — la versione del piano si leggeva come un cucchiaio.
  5. `COL_cresta` segmentata (base 6.7×10.29 + COL_fan_1/2/3 a gradoni): la lastra
     unica 14m sporgeva VISIBILE sopra il cornicione.
- FEEDBACK UTENTE (2026-07-06): "club carino ma placca frontale banale, sax più grande
  e fatto meglio, campana staccata dall'asta". APPLICATO: sax rifatto (spina UNICA
  collo curvo + canna conica + ansa a U; campana grande r 0.53 con base r 0.10
  ANNEGATA 18cm nel tubo — mai attaccare la campana con base ~0 fuori dall'ansa),
  madreperle + palm keys, filetto dorato interno sul pannello, 3 raggi neon attorno
  alla bocca della campana (attenti a non sovrapporli alle scritte). "Il resto va
  bene" → validato, si procede col Piano ③.
- SECONDO FEEDBACK (2026-07-06 sera): "sax ancora brutto, parte terminale staccata;
  scritte fuori dall'insegna nera". APPLICATO: campana = PROSEGUIMENTO della stessa
  skin_chain del tubo (5 punti lungo la tangente d'uscita dell'ansa con raggi
  0.19→0.48) — UN SOLO MESH, niente piu' pezzo separato; disco scuro sulla punta
  come bocca del padiglione. Scritte ridotte e rientrate (SCAT/CAT 0.60 a x -1.35,
  JAZZ 0.75 a x 1.15, note a 1.60/2.00): il filetto dorato interno aveva ristretto
  l'area utile a ±2.25 e i testi lo scavalcavano.
- PROSSIMO: gate utente sul club aggiornato; Piano ③ eseguito (layout v3 ad anello).

## Self-review (fatta in scrittura)

- **Copertura spec (sezione club)**: angolo/2 piani/~9m cornicione/crema con lesene ✓
  (T2), cresta a ventaglio ~14m + volute ✓ (T3), pannello scuro + sax skin_chain/lathe +
  neon emissivi + note ✓ (T4), marquee LIVE MUSIC + EST. 1928 ✓ (T3), doppia porta
  scura/gradinata/lampade ✓ (T2), COL_corpo + COL_cresta ✓ (T5).
- **Deviazione dichiarata**: volute in skin_chain anziché lathe (motivata nel T3).
- **Coerenza firme**: le costanti prodotte dal T2 (`L, P, H_PT, CORPO_H, FY, FYA`) sono
  quelle consumate da T3-T5; `CRESTA_TOP` definita in T3 e usata in T5; `neon_material`
  definita in T1 e usata in T2/T4.
- **No placeholder**: ogni step ha il codice completo.
