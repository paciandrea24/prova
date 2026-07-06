# Design — Edificio "Quartiere Jazz" (Blender)

## Contesto

Parte del rifacimento completo mappa/armi/personaggio in Blender ([[project-fps-blender-rebuild]]
in memoria). L'ordine di lavoro previsto era Piazza della Fontana → Funland → Galleria → Jazz →
Porto, ma su richiesta esplicita dell'utente (2026-07-05) la Piazza viene **messa in pausa**
(bug "non vedo la base" della fontana e task 4-8 restano aperti) per lavorare subito su un
edificio del Quartiere Jazz, a partire da un'immagine di riferimento (palazzo in mattoni rossi,
stile cartoon anni '30, tenement newyorkese con scala antincendio e serbatoio idrico).

Questo design copre **solo la modellazione dell'edificio** (script Blender → GLB). Non copre
l'integrazione nel gioco (`buildMap`/`fps.js`), che sarà un lavoro successivo separato.

## Componenti

- **Corpo principale**: 3 piani in mattoni rossi, pianta rettangolare, edificio d'angolo (scala
  antincendio visibile anche sul lato destro)
- **Piano terra**: doppia porta d'ingresso con tettoia a righe rosso/bianco, insegna civico "13",
  due vetrine laterali con infissi a griglia
- **Piano 1 e 2**: 3 finestre normali per piano (nessun motivo "occhio" — richiesta esplicita
  dell'utente, unico scostamento voluto dall'immagine), cornice bianca sopra ogni finestra
- **Scala antincendio**: due pianerottoli con ringhiera + scale a zig-zag sul fronte (tra le
  finestre centrali), più una scala verticale a pioli sul lato destro
- **Cornicione superiore**: fascia bianca sporgente con mensole/modanature lungo il perimetro
- **Comignolo**: doppio, mattoni più chiari
- **Serbatoio idrico**: traliccio a 4 gambe con diagonali, botte cilindrica, tetto conico,
  scaletta laterale, pannello "45"
- **Marciapiede**: lastre di pietra con bordo rialzato

## Tecnica di modellazione (coerente con [[feedback-blender-modeling-technique]])

| Componente | Tecnica |
|---|---|
| Corpo edificio | Box estruso + inset per rientranze finestre/porta, bevel sugli spigoli |
| Finestre | Telaio a cornice (bordo estruso da piano con inset), vetro = piano scuro incassato |
| Cornicione + mensole | Profilo 2D estruso lungo il perimetro; mensole ripetute con array modifier |
| Scala antincendio | Ringhiere/gradini con Skin modifier su edge-cage (stessa tecnica del pesce fontana) |
| Serbatoio idrico (botte + tetto conico) | Lathe/Spin attorno a un asse (stessa tecnica di vasca/coppa fontana) |
| Traliccio serbatoio | Gambe + diagonali con Skin modifier o cilindri smussati |
| Comignolo | Box + bevel, doppia canna |
| Marciapiede | Piano con inset per giunti lastre + bordo rialzato estruso |

Vietato modellare con sole primitive semplici non lavorate (regola da
[[feedback-blender-modeling-technique]]).

## Materiali

Solo colori piatti (Principled BSDF Base Color), un materiale per parte: mattone rosso, cornice
crema, telaio finestra crema, vetro blu scuro, ferro scala ruggine scuro, legno serbatoio
marrone, tetto conico grigio-verde ossidato, tettoia a righe rosso/bianco (2 materiali alternati),
marciapiede grigio chiaro. **Nessuna texture nello script**: lo shading toon + contorni inchiostro
si applicano dopo, in Three.js, al caricamento del GLB (stessa pipeline di armi/mappa/fontana
attuali).

## Scala e dimensioni

Riferimento: `PLAYER_HEIGHT=1.7` (fps.js). Versione compatta (richiesta esplicita, più piccola
della prima proposta):

- Piano terra: 2.6m — piano 1 e 2: 2.4m ciascuno — cornicione: 0.5m → **corpo edificio ~7.9m**
- Fronte ~6m, profondità ~5.5m (edificio d'angolo)
- Comignolo: +1.2m sopra il tetto
- Serbatoio idrico: traliccio 2.2m + botte 1.7m + tetto conico 1m → **edificio totale con
  serbatoio ≈ 13m**
- Marciapiede: bordo rialzato 0.15m, profondità 2m davanti alla facciata

## Workflow ed esecuzione

- **Worktree nuovo**: `.claude/worktrees/fps-mappa-blender-jazz` (branch
  `worktree-fps-mappa-blender-jazz`), separato e indipendente da quello della Piazza (che resta
  in pausa, intatto, per essere ripreso in seguito)
- **Script**: file singolo `docs/superpowers/plans/blender-scripts/edificio-jazz.py`; l'utente lo
  apre in Blender col Text Editor (**Open**, non copia-incolla — causa nota di `SyntaxError` in
  passato) e lo lancia con **Run Script**
- Lo script esporta da solo il `.glb` nel worktree (`bpy.ops.export_scene.gltf`)
- **Iterazione attesa**: come per la fontana, probabile ciclo v1 → feedback utente in
  Blender/gioco → v2, finché il modello non è conforme all'immagine di riferimento
- **Fuori scope per questo design**: integrazione nel gioco (`buildMap`/`fps.js`), texture,
  animazioni, LOD

## Riferimenti

- Immagine di riferimento: fornita dall'utente in chat (edificio in mattoni rossi, stile cartoon
  anni '30, "FRONT VIEW", civico 13, serbatoio "45")
- [[project-fps-blender-rebuild]] — contesto generale del rifacimento Blender
- [[feedback-blender-modeling-technique]] — tecniche di modellazione da rispettare
