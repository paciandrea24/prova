# Zona "Quartiere Jazz" — Espansione: edifici, club, layout — Design

**Data:** 2026-07-05
**Obiettivo:** ricreare la parte di città dell'immagine di riferimento
`C:\Users\pacia\Desktop\Viste mappa fps\Gemini_Generated_Image_v2o7kkv2o7kkv2o7.png`
(esclusi: spiaggia, mare, battello, parco, personaggi) come zona giocabile del FPS,
in stile cartoon anni '30 tipo Cuphead, coerente con l'edificio 13 già validato.

## Scope

- **Inclusi in questa fase**: modelli Blender (GLB) di tutti gli edifici + jazz club +
  props di strada + pavimentazione di zona + layout urbano (posizioni/rotazioni).
- **Esclusi**: integrazione in fps.js (fase successiva con piano dedicato), texture,
  interni (TUTTI gli edifici sono gusci esterni con collisione piena, club compreso),
  spiaggia/mare/battello/parco/personaggi dell'immagine.

## Decisioni chiave (confermate dall'utente)

1. **Approccio A — generatore parametrico**: libreria condivisa + `build_edificio(params)`;
   ogni edificio unico è una "ricetta" di parametri, le varianti cambiano palette/insegne.
   Il jazz club è invece modellato su misura.
2. **Layout più fedele possibile all'immagine**, con vincolo gameplay: carreggiate 8-10m,
   MAI sotto 6m (niente strade da un personaggio), nessun vicolo cieco.
3. **8-10 edifici unici + varianti** → ~15-18 GLB percepiti tutti diversi.
4. **Insegne in inglese** (Pawn Shop, Al's Barbershop, Smoke Shop, Newspapers,
   "SCAT CAT JAZZ — LIVE MUSIC — EST. 1928 — JAZZ CLUB").
5. **Solo esterni**: gameplay nelle strade e nella piazzetta.
6. **Pavimentazione = modello di ZONA**, mai dentro i GLB dei singoli edifici
   (decisione presa rimuovendo il marciapiede dall'edificio 13).
7. **Niente commit da parte di Claude**: committa solo l'utente, anche nel worktree.

## Vincoli tecnici (ereditati dal lavoro sull'edificio 13)

- Blender 5.1.2 headless (`--background --python`); iterazione: script → GLB + render
  PNG (fronte orto + 3/4 + per la zona anche top-down) → confronto visivo → correzione.
- 1 unità = 1 metro; base a z=0; fronte edificio verso -Y prima del piazzamento.
- SOLO colori piatti (Principled Base Color, `diffuse_color` allineato per le anteprime
  Workbench); lo shading toon si applica in Three.js all'integrazione.
- `primitive_cube_add(size=2)` negli helper box (bug size=1 già corretto).
- Vetri sempre in leggero aggetto sui telai (mai annegati nei box).
- NIENTE facce complanari tra mesh sovrapposte (z-fighting): rientri/rialzi di 1-2cm.
- Shade Smooth su ogni mesh; bevel piccolo sui box.
- Mesh di collisione `COL_*` (invisibili in game, AABB per solidBoxes), rientrate ~2cm.
- Script = file .py aperti in Blender via Text Editor → Open → Run Script.
- Lavoro nel worktree `.claude/worktrees/fps-mappa-blender-jazz`.
- Commenti in italiano; testi insegne in inglese.

## Architettura dei file

In `docs/superpowers/plans/blender-scripts/` (worktree):

```
jazz_lib.py             libreria condivisa: helper validati (flat_material, lathe_profile,
                        skin_chain, add_box, add_box_c, add_cyl, add_sphere, add_strut,
                        add_text_mesh, clear_scene, export_glb, render_previews) estratti
                        da edificio-jazz.py + build_edificio(params) + palette + insegne
edifici/edificio_XX.py  una ricetta per edificio unico (XX = 01..10): chiama
                        build_edificio() + dettagli custom; esporta GLB proprio e delle
                        sue varianti
club-scat-cat.py        jazz club su misura
props-strada.py         lampione, festone bandierine (6m e 10m), insegna verticale
zona-jazz-layout.py     assembla la zona: genera pavimentazione.glb, scrive
                        zona-layout.json, renderizza top-down + 3 prospettiche
```

Output in `frontend/assets/models/jazz/` (worktree):
`edificio_01.glb`, `edificio_01a.glb` (varianti = suffisso lettera), … `club.glb`,
`props/lampione.glb`, `props/festone_6m.glb`, `props/festone_10m.glb`,
`props/insegna_verticale.glb`, `pavimentazione.glb` + `zona-layout.json`.

`edificio-jazz.py` esistente resta funzionante; l'edificio 13 viene rifattorizzato come
ricetta n°1 sulla libreria (stesso risultato visivo, GLB `edificio13.glb` rigenerato
identico — verifica per confronto render prima/dopo).

## Generatore `build_edificio(params)`

Parametri:
- `piani` (2-4) e altezze per piano (default: PT 2.6m, superiori 2.4m)
- `larghezza` / `profondita`
- `palette`: una di 4-5 palette mattone dall'immagine (rosso spento, bruno, ocra,
  verde oliva, crema) — ogni palette definisce muro, mattoni chiari, zoccolo/cornici
- `piano_terra`: `portone` | `vetrina` | `doppia_vetrina` | `angolo` (smussato con
  ingresso d'angolo)
- `tettoia_righe`: bool (+ colori)
- `scala_antincendio`: `fronte` | `laterale` | `nessuna`
- `tetto`: `piatto` (cornicione a mensole) | `falda_coppi`
- `props_tetto`: sottoinsieme di {comignoli, serbatoio, cartellone, abbaino}
- `insegna`: testo orizzontale sopra il piano terra + opzionale insegna verticale
  sporgente (testo, colore)
- dettagli sempre presenti: toppe mattoni in rilievo, finestre con telaio/vetro in
  aggetto/griglia/davanzale/cimasa, gradini d'ingresso, fascia marcapiano, COL_corpo

## Catalogo edifici (ricette)

| # | Nome | Caratteri distintivi |
|---|------|----------------------|
| 01 | Edificio 13 (fatto) | 3 piani, rosso, scala fronte, serbatoio "45", tettoia righe |
| 02 | Angolare con negozio | 2-3 piani, angolo smussato, ingresso d'angolo, tenda verde |
| 03 | Stretto e alto | 4 piani, 1 finestra/piano, palette ocra (casa gialla del club) |
| 04 | Pawn Shop | 3 piani, larga insegna gialla orizzontale, palette bruna |
| 05 | Tetto a coppi | 3 piani, falda in coppi rossi |
| 06 | Al's Barbershop | 2 piani, doppia vetrina, palo da barbiere, insegna gialla |
| 07 | Smoke Shop | 2-3 piani, grande tenda a righe, insegna sporgente |
| 08 | Newspapers | 3 piani rosso scuro, scala antincendio laterale |
| 09 | Palazzone da fondale | 4 piani, semplice, cartellone sul tetto (chiude le vie) |
| 10 | Magazzino/retro | 2 piani, porta carraia in legno, poche finestre |

Ogni ricetta genera 1-2 varianti (palette/insegna diverse). Il palo da barbiere (06) è
un dettaglio custom (cilindro con spirale — lathe + rotazione UV non disponibile senza
texture: si fa con strisce elicoidali skin_chain o box ruotati).

## Jazz club "Scat Cat Jazz" (`club-scat-cat.py`)

- Edificio d'angolo 2 piani, più alto e largo degli altri (~9m al cornicione),
  facciata crema con lesene, affaccio sulla piazzetta.
- Cresta art déco dorata a ventaglio di canne verticali (box in progressione +
  volute laterali lathe); punta ~14m: domina lo skyline.
- Pannello scuro incassato nella cresta con: sax dorato 3D (corpo skin_chain curvato,
  campana lathe, chiavi sferette), scritte neon "SCAT CAT" (azzurro) e "JAZZ"
  (rosa/rosso) + 2 note musicali — testi estrusi con materiale EMISSIVO (il glow vero
  arriverà dallo shader toon all'integrazione; l'emissive nel GLB serve da marcatore).
- Marquee sopra l'ingresso: cassa rossa bordo dorato, "LIVE MUSIC" +
  "EST. 1928 — JAZZ CLUB".
- Doppia porta scura, gradinata, due lampade laterali.
- Collisione: `COL_corpo` + `COL_cresta` se sporge dal corpo.

## Props di strada (`props-strada.py`)

- **Lampione**: base lathe, palo scuro, braccio curvo, lanterna a campana con vetro
  emissivo caldo.
- **Festone bandierine**: catenaria skin_chain sottile + triangolini colorati;
  2 lunghezze (6m, 10m).
- **Insegna verticale sporgente**: pannello + staffe + testo verticale (parametrica nel
  generatore, qui anche come prop singolo riposizionabile).

## Layout zona (`zona-jazz-layout.py` + `zona-layout.json` + `pavimentazione.glb`)

- Composizione fedele all'immagine: piazzetta centrale (~18×15m) col club al
  centro-nord; 4 vie radiali (O: futura Galleria Art Déco; N: futuro parco; E e S:
  resto città) per ora chiuse da edifici da fondale; schiere continue di edifici
  attaccati lungo le vie; angolari agli incroci.
- Regole: carreggiate 8-10m (mai <6m), nessun vicolo cieco, perimetro chiuso.
- Pavimentazione: piano acciottolato color pietra con dettaglio geometrico SELETTIVO
  (file di sanpietrini in rilievo ai bordi strada, attorno ai tombini, sulla piazzetta),
  marciapiedi rialzati con cordolo davanti alle schiere. Niente full-cobblestone
  geometrico (troppo pesante).
- `zona-layout.json`: `[{ "modello": "edificio_04a", "x": …, "z": …, "rotY": … }, …]`
  + dati vie (assi, larghezze) — contratto per l'integrazione fps.js.
- Verifica: render top-down + 3 prospettiche confrontati con l'immagine; controllo
  compenetrazioni tra edifici adiacenti (le schiere si toccano di proposito, ma senza
  facce complanari a vista).

## Implementazione (3 piani separati, in ordine)

1. **Piano ① Libreria + edifici generici**: estrazione `jazz_lib.py`, rifattorizzazione
   edificio 13 (verifica identità visiva), `build_edificio()`, ricette 02-10 + varianti.
2. **Piano ② Jazz club**: `club-scat-cat.py` (cresta, sax, neon, marquee).
3. **Piano ③ Props + layout**: `props-strada.py`, `zona-jazz-layout.py`,
   `pavimentazione.glb`, `zona-layout.json`, verifica composizione con l'immagine.

Ogni piano segue il ciclo validato: headless → render → confronto → correzione, con
gate finale dell'utente in Blender. Nessun commit da parte di Claude.

## Criteri di successo

- Ogni GLB si apre pulito in Blender: niente z-fighting, niente elementi fluttuanti,
  colori della palette dell'immagine.
- Il render top-down della zona è riconoscibile come la città dell'immagine
  (piazzetta + club + vie radiali + schiere variegate).
- Varietà percepita: nessuna coppia di edifici adiacenti identica.
- Tutte le strade percorribili larghe ≥6m; nessun vicolo cieco.
- `zona-layout.json` completo e coerente coi GLB generati.
