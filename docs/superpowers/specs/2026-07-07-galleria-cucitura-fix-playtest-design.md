# Fix di playtest — cucitura Jazz + Galleria — design

Data: 2026-07-07. Pass di correzioni emerse dal **playtest** della cucitura "mondo unico"
(spec `2026-07-07-cucitura-mondo-unico-jazz-galleria-design.md`, già implementata).
Worktree: `.claude/worktrees/fps-galleria-art-deco`. **Committa solo l'utente.**

## Obiettivo
Integrazione fluida Jazz↔Galleria **senza uscite dalla mappa** (tutto chiuso alle
estremità) e senza glitch visivi, correggendo i 6 difetti del playtest. Vincolo non
negoziabile invariato: **il modello Jazz e `zona-layout.json` non si toccano**.

## Schema di lavoro sicuro (copie di lavoro)
Per non rigenerare/rompere gli asset individuali validati (nel worktree sono
**non committati** → git non li ripristinerebbe):
- **Snapshot congelato**: `_asset-snapshot-2026-07-07/` (models + blender-scripts) = punto
  di ripristino. Già creato.
- **Cartelle `-wip`** da cui il gioco carica:
  - `frontend/assets/models/galleria-wip/` (copia di `galleria/`): qui si rigenera
    `pavimentazione.glb`, si aggiunge `portale_varco.glb`, si aggiorna `galleria-layout.json`.
  - `frontend/assets/models/collegamenti-wip/` (copia di `collegamenti/`): qui si rigenera
    `collegamenti.glb` + `collegamenti-layout.json`.
  - `galleria/` e `collegamenti/` restano **congelate**; `jazz/` non si tocca.
  - `fps.js` (worktree) carica dalle `-wip` (2 path modificati, reversibili).
- **Copie di lavoro degli script** (output nelle `-wip`): `collegamenti-layout-wip.py`,
  `galleria-layout-wip.py`, e il **nuovo** `kit_porta_varco.py` (costruisce SOLO
  `portale_varco.glb`, non tocca `kit_muri.py`). **Nessun asset individuale validato
  viene mai rigenerato** (kit_muri/kit_mezzanino/kit_rotonda non si rilanciano).
- A verifica OK: promozione `-wip` → cartelle reali (commit dell'utente).

## Diagnosi e correzioni (per problema del playtest)

### ① Innesto centrale — "muri rossi" che bucano gli edifici adiacenti
Causa: il palazzo centrale rimosso (skip idx38) lasciava esposte le facce in **mattone
rosso** dei due palazzi Jazz adiacenti (idx37/idx39), che ora compenetrano i muri/tappi
**crema** del corridoio principale → z-fighting rosso/bianco.
Fix (Blender, `collegamenti-layout-wip.py`): aggiungere una **testata d'ingresso in crema**
al lato Jazz del corridoio principale (parete piena da idx37 a idx39 con un **varco = 7 m**,
alta quanto la volta) che **copre le facce rosse esposte** e fa da portale d'ingresso;
ritoccare i `main_tappo` perché stiano **davanti** al mattone senza compenetrarlo.
I due palazzi restano (chiudono i lati). Verifica: top render + close-up dell'imbocco.

### ② Buchi nei flank (dx/sx) — si esce dalla mappa
Causa: le U dei flank hanno muri dritti che incontrano il disco Jazz **curvo** e il portale
Galleria; ai punti di tangenza restano **gap** non sigillati.
Fix (Blender, `collegamenti-layout-wip.py`): **tappi a cuneo** che riempiono il gap
muro-dritto ↔ anello curvo agli innesti U↔disco; verificare la continuità
boundary esterno + testata + tappi. Verifica: top render + close-up dei due innesti.

### ③ Pavimento Galleria — "quadrato nero" che segue il giocatore
Ipotesi primaria: le scatole nere delle COL renderizzate erroneamente sul pavimento
(vedi ④, stessa radice del bug pav-COL) e/o z-fighting tra la base nera (top 0.05) e le
mattonelle di marmo (0.03–0.07).
Fix: risolto in gran parte dal fix ④ (le COL non vengono più renderizzate). Se residuo,
abbassare la base nera sotto il range delle mattonelle (Blender, `galleria-layout-wip.py`).
**Da confermare in localhost dopo ④.**

### ④ Mezzanino — nessuna collisione (si cade) + sfarfallio bianco/nero  [BUG STRUTTURALE]
Causa (confermata): `galleria/pavimentazione.glb` contiene **48 mesh `COL_`** (piani
calpestabili del mezzanino `COL_ponte`/`COL_deck`, parapetti, retro-corridoi, panche,
urne). Ma il ramo "pavimentazione" di `loadZone` (scritto per Jazz, la cui pav ha **0 COL**)
le **renderizza come scatole nere** e **non le registra come collisioni**. → mezzanino
senza pavimento solido (si cade) + scatole nere che sfarfallano contro i piani crema/marmo;
inoltre i retro-corridoi restano senza collisione.
Fix (codice, `fps.js` `loadZone` ramo `hasPav`): estrarre le `COL_` dalla pavimentazione
→ `addSolid` (con offset applicato) e **non renderizzarle**, come già fa il percorso
per-modello. Un solo fix, grande impatto (sistema ④, buona parte di ③, collisioni retro).

### ⑤ Accessi ai flank aperti in alto — si scavalca (riuso porta verde)
Causa: i portali N/S verso i flank sono archi **aperti in alto** (`portale_aperto`, COL solo
agli stipiti): salendo la scala a pioli si salta sopra e si esce.
Fix (Blender): nuovo `portale_varco.glb` = cornice **porta Déco verde decorata SENZA anta**,
con varco passabile (~3.5 m di largo, ~3 m di alto) e **parete piena sopra il varco**
(COL sull'architrave → niente scavalco). Usato sui **portali N e S** al posto di
`portale_aperto` (in `galleria-layout-wip.py`). L'EST resta la porta verde **sigillata**
(vicolo cieco), l'OVEST il corridoio crema principale. Coordinare con la testata `gal_cap`
crema del flank in `collegamenti-layout-wip.py` (evitare doppioni/gap al giunto).
Verifica: render + partita.

### ⑥ Negozi entrabili — teletrasporto indietro all'ingresso/uscita
Causa: le vetrine **hanno** collisione (10 COL via percorso per-modello); il problema è la
risoluzione OBB (`resolveCollisions`) che, in una soglia stretta, spinge il player oltre la
porta con la penetrazione minima (sensazione di "teletrasporto").
Fix: da **riprodurre** in localhost. Prima linea: robustezza `resolveCollisions` (evitare lo
scavalco della soglia; eventuale sub-stepping o riduzione temporanea del raggio in soglia);
se necessario, allargare la soglia in Blender (`kit_muri` NON si rilancia → variante isolata).
**Da definire dopo repro.**

## Fasi (ordine deciso: prima gli innesti anti-fuga Blender)
- **Setup**: creare `galleria-wip/`, `collegamenti-wip/`, copie script; puntare `fps.js`
  alle `-wip`. Verifica: la partita carica identica ad ora (nessuna regressione).
- **Fase B — Blender anti-fuga** (una alla volta, ognuna con render + gate localhost):
  B1 innesto centrale · B2 buchi flank · B3 sommità + porta verde `portale_varco`.
- **Fase A — Codice**: fix pav-COL in `loadZone` (④, ③, collisioni retro). Verifica localhost.
- **Fase C — Rifiniture**: z-fighting residuo pavimento/mezzanino (③/④ se resta) ·
  teletrasporto negozi (⑥, dopo repro).

## Criteri di accettazione
- Mappa **chiusa**: nessun buco tra palazzi e muri (centrale + 2 flank) da cui uscire.
- Innesto centrale senza muri rossi né z-fighting con il crema; ingresso pulito alla Galleria.
- Mezzanino **calpestabile** (non si cade), senza sfarfallio; pavimento Galleria senza
  "quadrato nero".
- Accesso ai flank solo dalla **porta verde a varco**; sommità chiuse (niente scavalco).
- Negozi entrabili/uscibili senza teletrasporto.
- Layout Jazz invariato; asset individuali validati intatti; il gioco gira dalle `-wip`.
- Fluidità in linea con l'attuale (poche draw call, no z-fighting).
