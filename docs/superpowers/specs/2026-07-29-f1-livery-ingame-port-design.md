# F1 — 4b/B: porting completo pattern-livrea nel rendering live

> **SUPERSEDUTO 2026-07-29 sera.** Dopo lo spike sotto, l'utente ha
> proposto un'architettura migliore: invece di ricalcolare i pattern dal
> vivo in gara (fragile, vedi i bug risolti in
> [[project_f1_livery_ingame_port]]), calcolare i colori UNA SOLA VOLTA
> quando il giocatore salva la livrea (riusando l'algoritmo già provato
> dell'editor) e in gara limitarsi a caricare/applicare colori già
> pronti. Vedi
> `docs/superpowers/specs/2026-07-29-f1-livery-precomputed-colors-design.md`
> per il design attuale. Questo documento resta come riferimento storico
> (spike di validazione tecnica, comunque utile) — non è più il piano da
> seguire.

## Contesto

Sotto-progetto B di [[project_account_system]] 4b (a sua volta da
[[project_f1_voxel_livery_studio]] punto 4). Obiettivo: portare gli 18
pattern multi-colore dell'editor esterno (`voxel_livery_studio.html`,
tool esterno non nel repo) nel rendering LIVE del gioco, su OGNI auto
(propria e avversari), scrivendo vertex color veri sulla mesh reale
(`f1Car.glb`) invece della tinta uniforme che `recolorLiveryTexture` può
fare oggi.

**Uno spike precedente (`frontend/shared/liveryPattern.js`, 3 pattern di
prova: racing_stripes/split_sides/checkers, solo sulla propria auto,
livrea hardcoded) ha già validato l'approccio con dati reali e
verifica visiva dell'utente** — vedi
[[project_f1_livery_ingame_port]] per il dettaglio tecnico completo
(gotcha risolti: niente `COLOR_0` nel file, `map`×`vertexColor` si
moltiplicano in THREE.js, serve la texture PRISTINA non quella già
ricolorata, la saturazione HSL è instabile vicino al nero, il centro
laterale va preso dalla mesh Chassis non da una bounding box combinata).
Questo documento descrive la versione DEFINITIVA (B completo): tutti e
18 i pattern, integrata in `carLoader.js` per ogni auto.

**Fuori scope qui** (sotto-progetti separati, da fare dopo): persistenza
account→livrea (A), trasmissione della livrea scelta agli altri client
in rete (C), UI per scegliere/applicare la propria livrea (D). In questo
documento la livrea resta una costante di test hardcoded, MA applicata a
TUTTE le auto (propria e avversari) invece che solo alla propria.

## Architettura

L'integrazione avviene DENTRO `carLoader.js::loadCarModel()`, non come
modulo separato richiamato da `f1.js` dopo il caricamento (deciso
esplicitamente: un solo punto di verità, coerente con come lì si gestisce
già la classificazione ruote/ali/dettagli). `frontend/shared/
liveryPattern.js` resta un file a parte (stessa separazione di
responsabilità di `trackGeometry.js`/`carLoader.js` già esistente in
questo repo), ma la sua funzione viene chiamata DA DENTRO
`loadCarModel()`, non da fuori.

`loadCarModel(playerColor, onReady, deps, livery = null)`: nuovo quarto
parametro opzionale. Se `livery` è assente, comportamento identico a
oggi (tinta singola via `recolorLiveryTexture`). Se presente, dopo il
traverse esistente (che gestisce ruote/ali/halo/tcam esattamente come
oggi — QUESTI non cambiano), viene chiamato
`LiveryPattern.applyVoxelLiveryPattern(model, livery)` sulle mesh
carrozzeria (Chassis/Nose/Plank).

`frontend/f1.js`: entrambe le chiamate esistenti a `loadCarModel` (la
propria auto E quella per ogni avversario, vedi righe ~723 e ~733)
passano la STESSA costante `TEST_LIVERY` — per ora identica per tutte le
auto in pista (utile per verificare l'effetto e le prestazioni con più
istanze contemporaneamente; la scelta per-giocatore arriva con A/C/D).

## I 18 pattern

Porting diretto delle formule di `computeBase()` in
`voxel_livery_studio.html`, adattate alle coordinate già derivate nello
spike (per-vertice, dalla posizione locale + passo di griglia 0.032,
niente ri-voxelizzazione: il modello di gioco è già geometria pulita).
Servono, oltre a `dLat`/`latIdx`/`lenIdx`/`upIdx` (interi, già nello
spike), anche le versioni CONTINUE normalizzate 0..1 (`nLat`, `nLen`,
`nUp` — necessarie per gradient/abstract/camo/waves/tiger/digital_rain/
speed_lines) e gli span (`spanLat`/`spanLen`/`spanUp` — già in parte
presenti, va aggiunto `spanUp`).

Rumore pseudo-casuale (abstract/camo/flames/patchwork): stesso generatore
`mulberry32` dell'editor, seed FISSO per ora (tutte le auto mostrano lo
stesso pattern identico in questa fase di test, coerente con
`TEST_LIVERY` condivisa) — un seed per-giocatore arriverà con la scelta
vera in D.

## Test/verifica

- Verifica visiva con **più auto in pista contemporaneamente** (propria
  + almeno 2-3 bot/avversari): stessa livrea di test su tutte, controllo
  che non ci siano cali di prestazioni percepibili al caricamento con
  più istanze rispetto a oggi.
- Per ciascuno dei 18 pattern: cambiare temporaneamente `TEST_LIVERY.
  pattern` e ricaricare, controllare a occhio che il risultato assomigli
  a quanto si vede nell'editor esterno con la stessa combinazione
  pattern+colori (non serve identico pixel-per-pixel, ma riconoscibile
  come lo stesso pattern).
- Rigiocare la stessa sequenza di verifica già fatta per lo spike (colore
  secondario chiaro E uno scuro, controllo che non tornino chiazze
  nere/rosa) per un paio di pattern rappresentativi, non tutti e 18.
- Nessun test automatico: stesso limite già documentato per lo spike
  (nessun framework di test per questo frontend, verifica in browser).

## Fallback esplicito (ricordare)

Se dopo il porting completo la qualità visiva non convince (l'utente lo
ha detto chiaramente durante lo spike), l'alternativa concreta è rendere
l'editor esterno accessibile a tutti gli utenti con il modello base
pre-caricato — gli utenti esportano/caricano la propria livrea invece di
generarla dal vivo in gioco. Da tenere presente, non da scartare a priori.
