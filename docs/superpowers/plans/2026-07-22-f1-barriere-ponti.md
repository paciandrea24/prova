# F1 — barriere rigide sui tratti ponte (Fase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sui tratti pista marcati ponte, impedire che l'auto esca lateralmente oltre il bordo (dove oggi "cadrebbe" verso il terreno vero, senza un'animazione di caduta): il bordo diventa un muro rigido, con la stessa risposta a scivolamento già usata per le collisioni auto-auto.

**Architecture:** Nuova funzione server-autoritativa `applyBridgeBarrier(p, track)` in `backend/sockets/games/f1GameSocket.js`, chiamata ad ogni sottostep della posizione (stesso punto in cui gira già `resolveCollisions`, dentro `tickGame`). Usa `TrackGeometry.nearestIndexNear`/`normalAt` (già disponibili lato server, `track.points` porta già il flag `bridge` grazie alla Fase 2 — nessuna modifica al caricamento tracciato). Solo dove il punto più vicino è `bridge:true`: se l'auto supera la distanza laterale di soglia (stessa già usata per il fuoripista, `roadHalf + 2`), viene riportata esattamente sul bordo e si smorza solo la componente di velocità perpendicolare al muro (stesso fattore di `COLLISION_BOUNCE`), lasciando intatta quella lungo il muro.

**Tech Stack:** Node.js, nessuna dipendenza nuova.

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-07-22-f1-terrapieno-e-ponti-design.md`, sezione "Fase 3 — Barriere rigide sui tratti ponte".
- Si applica SOLO dove il punto pista più vicino ha `bridge: true` — sui tratti normali (anche sopraelevati, come la collinetta di "prova" non marcata ponte) il comportamento fuori pista resta quello di Fase 1/2, invariato.
- Soglia di distanza: `track.roadHalf + 2` — stessa già usata in `applyOffTrackDrag` per il fuoripista, non una nuova costante di distanza.
- Risposta all'urto: si azzera/smorza solo la componente di velocità perpendicolare al muro (fattore uguale a `COLLISION_BOUNCE = 0.6`), quella lungo il muro resta intatta.
- Va chiamata ad ogni sottostep di `COLLISION_SUBSTEPS` (non una volta a fine tick): un'auto veloce potrebbe altrimenti attraversare il muro in un singolo tick, stesso motivo per cui `resolveCollisions` gira già lì.
- Si applica sia in gara sia in qualifica (a differenza di `resolveCollisions`, che è disabilitata in qualifica solo per le collisioni auto-auto — i muri della pista non sono una questione di fair-play multiplayer).
- Nessuna modifica al client: la posizione resta interamente autoritativa sul server, già trasmessa (`x`/`z` in `buildPublicState`).
- `backend/sockets/games/f1GameSocket.js` non ha test automatici: verifica tramite `node -c` (sintassi) + verifica manuale in localhost (ultimo task).
- Italiano nei commenti, coerente con lo stile esistente del file.
- Non fare commit se non richiesto esplicitamente dall'utente.

---

### Task 1: `applyBridgeBarrier` + wiring in `tickGame`

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js`

**Interfaces:**
- Produce: `applyBridgeBarrier(p, track)` — nessun valore di ritorno, modifica `p.x`/`p.z`/`p.vx`/`p.vz` in place (stesso stile di `resolveCollisions`/`integratePosition`).
- Consuma: `TrackGeometry.nearestIndexNear`, `TrackGeometry.normalAt` (già importati in cima al file), `TRACK_INDEX_WINDOW` (costante già esistente).

- [ ] **Step 1: Aggiungere le costanti**

In `backend/sockets/games/f1GameSocket.js`, subito dopo la riga `const COLLISION_SUBSTEPS = 13;` (circa riga 40), aggiungere:

```js

// Sui tratti ponte, uscire lateralmente non deve far "cadere" l'auto (senza
// terreno vero sotto finché non ricade sul terrapieno più lontano, vedi
// Fase 2): il bordo diventa un muro rigido. Stessa soglia già usata per il
// fuoripista (roadHalf+2 in applyOffTrackDrag), non una nuova distanza.
const BRIDGE_BARRIER_MARGIN = 2;
// Stessa quota di COLLISION_BOUNCE: si smorza solo la componente di
// velocità perpendicolare al muro, quella lungo il muro resta intatta
// (l'auto scivola lungo il bordo invece di fermarsi di colpo).
const BRIDGE_BARRIER_BOUNCE = 0.6;
```

- [ ] **Step 2: Aggiungere `applyBridgeBarrier`**

Subito dopo la funzione `applyOffTrackDrag` (prima del commento `// Usura gomme: SOLO dalla distanza...`), aggiungere:

```js

// Muro rigido sui tratti ponte (Fase 3): a differenza di applyOffTrackDrag
// (che si applica ovunque e frena soltanto), qui — solo dove il punto pista
// più vicino è bridge:true — si impedisce fisicamente di superare la
// soglia, con la stessa risposta a scivolamento già usata per le collisioni
// auto-auto (resolveCollisions/COLLISION_BOUNCE): si azzera solo la
// componente di velocità perpendicolare al muro.
function applyBridgeBarrier(p, track) {
    const idx = TrackGeometry.nearestIndexNear(track.points, p.trackIndex || 0, p.x, p.z, TRACK_INDEX_WINDOW);
    const pt = track.points[idx];
    if (!pt.bridge) return;

    const dx = p.x - pt.x, dz = p.z - pt.z;
    const dist = Math.hypot(dx, dz);
    const limit = track.roadHalf + BRIDGE_BARRIER_MARGIN;
    if (dist <= limit) return;

    const { nx, nz } = TrackGeometry.normalAt(track.points, idx, true);
    // normalAt punta sempre verso lo stesso lato fisso: va orientata verso
    // il lato da cui l'auto è effettivamente uscita.
    const side = (dx * nx + dz * nz) >= 0 ? 1 : -1;
    const wallNx = nx * side, wallNz = nz * side;

    p.x = pt.x + wallNx * limit;
    p.z = pt.z + wallNz * limit;

    const vn = p.vx * wallNx + p.vz * wallNz;
    if (vn > 0) {
        const delta = vn * BRIDGE_BARRIER_BOUNCE;
        p.vx -= wallNx * delta;
        p.vz -= wallNz * delta;
    }
}
```

- [ ] **Step 3: Chiamarla ad ogni sottostep in `tickGame`**

Sostituire:

```js
    for (let s = 0; s < COLLISION_SUBSTEPS; s++) {
        for (const p of racing) integratePosition(p, 1 / COLLISION_SUBSTEPS);
        if (!isQuali) resolveCollisions(players);
    }
```

con:

```js
    for (let s = 0; s < COLLISION_SUBSTEPS; s++) {
        for (const p of racing) integratePosition(p, 1 / COLLISION_SUBSTEPS);
        if (!isQuali) resolveCollisions(players);
        // A differenza di resolveCollisions (disabilitata in qualifica: le
        // collisioni auto-auto sono una questione di fair-play multiplayer),
        // il muro dei tratti ponte si applica sempre, anche in qualifica —
        // è un limite fisico della pista, non un'interazione tra giocatori.
        for (const p of racing) applyBridgeBarrier(p, game.track);
    }
```

- [ ] **Step 4: Verificare che il file non abbia errori di sintassi**

Run: `node -c backend/sockets/games/f1GameSocket.js`
Expected: nessun output (exit code 0).

- [ ] **Step 5: Verifica manuale in localhost (utente)**

Avviare il server (`node server.js` da `backend/`), caricare "prova" (con il tratto già marcato ponte). Controllare:
- Guidando sul tratto ponte e sterzando decisamente verso il bordo, l'auto non esce più: scivola lungo il bordo mantenendo velocità, non si ferma di colpo né rimbalza indietro in modo innaturale.
- Sulla collinetta NON marcata ponte (il resto del tratto sopraelevato di "prova"), il comportamento resta quello di prima: si può uscire di pista e la quota visiva dell'auto segue il pendio del terrapieno.
- Su un tratto normale in piano, nessuna differenza rispetto a prima (fuoripista = solo perdita di aderenza, nessun muro).
- Con due client (due tab), verificare che il comportamento sia coerente per entrambi i giocatori sul tratto ponte.

Questo step è manuale e non ha un comando da eseguire: è il gate di
approvazione dell'utente prima di considerare il task chiuso.

- [ ] **Step 6: Commit (solo su richiesta esplicita dell'utente)**

```bash
git add backend/sockets/games/f1GameSocket.js
git commit -m "$(cat <<'EOF'
F1: barriere rigide sui tratti ponte (Fase 3)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Non eseguire questo step finché l'utente non lo chiede esplicitamente.
