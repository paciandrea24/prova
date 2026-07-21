# F1 — aumento velocità realistico + ribilanciamento freni Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare la velocità massima delle auto F1 a livelli realistici (~320-360 km/h) e ribilanciare freni/attrito/autopilota box/sottostep collisioni di conseguenza, senza toccare tracciati o modello mescole.

**Architecture:** Modifica di sole costanti numeriche (e di una formula di frenata) in un unico file, `backend/sockets/games/f1GameSocket.js`. Nessuna nuova astrazione, nessun nuovo file.

**Tech Stack:** Node.js, Socket.io (nessun framework di test automatico per la fisica di gioco in questo progetto — vedi Global Constraints).

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-07-21-f1-velocita-frenata-mescole-design.md`
- Fattore di scala unico R = 1.55 su cui si basano tutti i numeri sotto.
- Nessuna modifica a `TYRE_COMPOUNDS` (moltiplicatori mescole), a `GRIP`, `TURN_SPEED`, né a file di tracciato in `frontend/tracks/`.
- Il progetto NON ha test automatici per il feel di gioco/fisica in tempo reale (`f1GameSocket.js` non esporta le funzioni pure di fisica) — solo `trackLoader.js`/`trackGeometry.js` hanno test `node:test` su dati statici. Per questo cambiamento la verifica è **manuale in localhost con due tab**, come da convenzione di progetto (CLAUDE.md: "far verificare all'utente in localhost prima di proseguire"). Non introdurre refactoring per rendere testabili le funzioni di fisica: fuori scope, non richiesto.
- Italiano nei commenti, coerente con lo stile esistente del file.
- Non fare commit se non richiesto esplicitamente dall'utente (convenzione di progetto).

---

### Task 1: Aggiornare le costanti fisiche in f1GameSocket.js

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js:6-33` (costanti) e `:911-918` (formula di frenata)

**Interfaces:**
- Nessuna interfaccia esterna cambia: `module.exports = function (io, socket) {...}` resta identico, così come gli eventi socket emessi/ricevuti.
- Consumato da: `frontend/f1.js` solo tramite il valore `speed` broadcast (già moltiplicato per `* 55` lato client, riga 823 — non cambia).

- [ ] **Step 1: Modificare le costanti di velocità/accelerazione**

In `backend/sockets/games/f1GameSocket.js`, righe 6-11, sostituire:

```js
const PHYSICS_TICK_MS = 50;
const MAX_SPEED    = 4.0;
const ACCEL        = 0.12;
const FRICTION     = 0.050;
const TURN_SPEED   = 0.048;
const GRIP         = 0.78;
```

con:

```js
const PHYSICS_TICK_MS = 50;
// Velocità realistica F1: fattore di scala R=1.55 (+55%) applicato a
// MAX_SPEED/ACCEL/FRICTION rispetto ai valori storici (4.0/0.12/0.050).
// Km/h a schermo = speed * 55 (frontend/f1.js): 6.2 → 341 km/h base Medium,
// 358 Soft, 324 Hard. Vedi docs/superpowers/specs/2026-07-21-f1-velocita-frenata-mescole-design.md.
const MAX_SPEED    = 6.2;
const ACCEL        = 0.186;
// FRICTION scalato ×R² (non ×R) come la frenata sotto: è un decremento
// costante per tick, quindi lo spazio di "coast-down" va con v²/decel — a
// parità di R, senza lo ×R² il rilascio del gas sembrerebbe non rallentare
// quasi per niente rispetto a oggi.
const FRICTION     = 0.120;
const TURN_SPEED   = 0.048;
const GRIP         = 0.78;
const BRAKE_MULT   = 2.17;   // moltiplicatore di ACCEL in frenata (era 1.4 a MAX_SPEED=4.0)
```

- [ ] **Step 2: Aggiornare il commento e il valore di COLLISION_SUBSTEPS**

Alle righe 24-30, sostituire:

```js
// A MAX_SPEED (4/tick) due auto che si avvicinano chiudono fino a 8 unità in
// un tick — più della zona di contatto minima (~2.6, urto fianco-contro-fianco
// lungo l'asse stretto): senza integrare la posizione in sottostep, il
// rilevamento SAT (fatto una volta a fine tick) può non vedere mai la
// sovrapposizione e le auto si attraversano. 8 sottostep → chiusura massima
// 1 unità/sottostep, ben sotto qualunque zona di contatto possibile.
const COLLISION_SUBSTEPS = 8;
```

con:

```js
// A MAX_SPEED (6.2/tick) due auto che si avvicinano chiudono fino a 12.4
// unità in un tick — più della zona di contatto minima (~2.6, urto
// fianco-contro-fianco lungo l'asse stretto): senza integrare la posizione
// in sottostep, il rilevamento SAT (fatto una volta a fine tick) può non
// vedere mai la sovrapposizione e le auto si attraversano. 13 sottostep →
// chiusura massima ~0.95 unità/sottostep, stesso margine di sicurezza che
// c'era a MAX_SPEED=4.0 con 8 sottostep.
const COLLISION_SUBSTEPS = 13;
```

- [ ] **Step 3: Aggiornare PIT_AUTO_SPEED**

Alla riga 32, sostituire:

```js
const PIT_AUTO_SPEED = 1.0;   // unità/tick dell'autopilota lungo il percorso box (25% di MAX_SPEED)
```

con:

```js
const PIT_AUTO_SPEED = 1.55;   // unità/tick dell'autopilota lungo il percorso box (25% di MAX_SPEED)
```

- [ ] **Step 4: Aggiornare la formula di frenata**

Nella funzione `updateVelocity` (attorno alla riga 911-918), sostituire:

```js
    if (inputs.w)      p.speed = Math.min(p.speed + ACCEL, maxSpeed);
    else if (inputs.s) {
        // Frenata/retromarcia: più pronta dell'accelerazione ma non aggressiva
        // (prima era 2× + uno smorzamento laterale del 16%/tick, troppo brusca
        // e difficile da controllare — segnalato dall'utente).
        p.speed = Math.max(p.speed - ACCEL * 1.4, -maxSpeed / 2);
        p.vx *= 0.94;
        p.vz *= 0.94;
    } else {
```

con:

```js
    if (inputs.w)      p.speed = Math.min(p.speed + ACCEL, maxSpeed);
    else if (inputs.s) {
        // Frenata/retromarcia. La decelerazione in frenata è un decremento
        // costante per tick, quindi lo spazio d'arresto va con v²/decel: per
        // tenerlo vicino a quello di prima dell'aumento di velocità (R=1.55),
        // BRAKE_MULT scala di R² rispetto al vecchio 1.4 (non solo ×R) — vedi
        // docs/superpowers/specs/2026-07-21-f1-velocita-frenata-mescole-design.md.
        p.speed = Math.max(p.speed - ACCEL * BRAKE_MULT, -maxSpeed / 2);
        p.vx *= 0.94;
        p.vz *= 0.94;
    } else {
```

- [ ] **Step 5: Verificare che il file non abbia errori di sintassi**

Run: `node -c backend/sockets/games/f1GameSocket.js`
Expected: nessun output (exit code 0)

- [ ] **Step 6: Verifica manuale in localhost (utente)**

Avviare il server (`node server.js` dalla cartella `backend/`), aprire due tab
su `localhost:3000`, ed effettuare una qualifica + gara su Monza e su un
tracciato più tecnico (Monte Rosso o Interlagos). Controllare:
- il km/h a schermo in rettilineo si avvicina a ~341 (Medium), ~358 (Soft),
  ~324 (Hard)
- si riesce a frenare in tempo per l'ingresso ai box e per le curve strette
  senza uscire sistematicamente di pista
- due auto ravvicinate a piena velocità non si attraversano in collisione
- il rilascio del gas senza frenare rallenta in modo percepibile (non "in
  folle")

Questo step è manuale e non ha un comando da eseguire: è il gate di
approvazione dell'utente prima di considerare il task chiuso (vedi Global
Constraints).

- [ ] **Step 7: Commit (solo su richiesta esplicita dell'utente)**

```bash
git add backend/sockets/games/f1GameSocket.js
git commit -m "$(cat <<'EOF'
F1: velocità realistica (+55%) e ribilanciamento freni/attrito/substeps/pit autopilota

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Non eseguire questo step finché l'utente non lo chiede esplicitamente.
