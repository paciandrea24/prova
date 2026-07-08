# Piano — Galleria d'Arte Art Déco (quartiere 2)

Spec: `docs/superpowers/specs/2026-07-07-galleria-art-deco-design.md`.
Worktree: `.claude/worktrees/fps-galleria-art-deco`. Niente commit (committa l'utente).
Sorgenti Blender in `docs/superpowers/plans/blender-scripts/galleria/`; output GLB in
`frontend/assets/models/galleria/`. Blender 5.1 headless
(`"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python <script>`).

## Task
1. **`galleria_lib.py`**: clone di `jazz_lib.py` con `WORKTREE`/`MODELS_DIR`/`PREVIEW_DIR`
   → galleria; palette Déco (crema/avorio, oro/ottone, nero, verdeacqua); helper riusati
   as-is (`flat_material`, `neon_material`, `lathe_profile`, `add_box(_c)`, `add_cyl`,
   `add_strut`, `add_text_mesh`, `rng_per`, `export_glb`, `render_previews`); nuovi
   helper Déco (raggiera/sunburst, lesene scanalate, parapetto ottone).
2. **Pezzi kit** (un `.py` per pezzo, ognuno esporta GLB con mesh `COL_*` + anteprime):
   campata d'arcata, vetrina chiusa, vetrina entrabile (vano+porta retro opzionale),
   modulo mezzanino, scala a pioli (visiva, collisione = zona climb), portale
   d'estremità, rotonda/cupola, fontana Déco, insegna pensile.
3. **`galleria-layout.py`** (assembler, come `zona-jazz-layout.py`): croce + rotonda,
   vetrine (RNG seme fisso per entrabili/porte retro + retro-corridoi), mezzanino
   anello+gallerie, 2 scale, 4 portali, fontana+insegna, props; `pavimentazione.glb`
   marmo con intarsi Déco (mesh unica from_pydata); scrive `galleria-layout.json`
   (`{istanze, props, vie, climb[], ceilingY}`); render `galleria_top_debug.png`
   (frecce fronte) + top/3/4 + close-up.
4. **Gate utente sul modello** (render + Blender).
5. **fps.js**: refactor `loadJazzZone`→`loadZone(dir,json)` (721-801, riuso 1:1
   merge-per-materiale, `_jazzToonMat`, `_mergeGeos`, `COL_*`→`addSolidOBB` seno negato);
   `?map=galleria`; meccanica scala (zone climb in `updateMovement`, gravità off,
   W/S ~4 m/s, uscite: sopra/sotto/allontanamento); confini = COL muri (bypass clamp
   radiale per la galleria) + `ceilingY`.
6. **Spawn per-mappa** in `backend/sockets/games/fpsGameSocket.js`.
7. **Playtest localhost** (2 tab) + `docs/fps-notes.md` sezione Galleria. Gate finale.

## Criteri di accettazione
- Croce percorribile: 4 bracci → rotonda; nessun varco fuori mappa.
- Mezzanino calpestabile ad anello + gallerie, raggiungibile SOLO dalle 2 scale.
- Salita/discesa scala fluida, sbarco sul ballatoio senza incastri.
- Negozi entrabili e retro-corridoi funzionanti (porte attraversabili, resto chiuso).
- ~40 draw call, niente z-fighting, stile Déco leggibile col toon shader.
