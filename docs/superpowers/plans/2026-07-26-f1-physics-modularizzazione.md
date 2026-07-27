# F1 — modularizzazione Game Core (Vehicle/Collision/Tyre/Damage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estrarre la fisica pura di `backend/sockets/games/f1GameSocket.js` (1679 righe) in 4 moduli separati sotto `backend/sockets/games/physics/` (Vehicle Controller/Physics Model, Collision Resolver, Tyre Model, Damage Model — Rif. SDD Capitolo 10.6), lasciando `f1GameSocket.js` come semplice orchestratore di eventi Socket.io e fasi di gioco — **senza alcuna variazione del comportamento fisico**.

**Architecture:** Pura ri-collocazione di codice (nessuna riscrittura di formule): ogni funzione/costante pura si sposta verbatim nel modulo di competenza, e `f1GameSocket.js` la re-importa con lo stesso identificatore di prima tramite destructuring in testa al file. Il corpo di `tickGame` e di tutte le altre funzioni che già chiamavano quei nomi **non cambia di una riga** — gli identificatori restano identici, cambia solo da dove vengono. `module.exports.physics` (il contratto usato da `f1LapSimulator.js`, `f1RaceLineOptimizer.js` e dai due file di test `.physics.test.js`/`.exports.test.js`) resta l'unico punto di export verso l'esterno e la sua forma non cambia.

**Tech Stack:** Node.js, CommonJS (`require`/`module.exports`), `node:test` (stesso runner già in uso, nessuna nuova dipendenza).

## Global Constraints

- **Zero variazione fisica**: nessuna formula, costante, ordine di operazioni o soglia cambia valore. Questo è un refactor di collocazione file, non un cambio di comportamento.
- **Non toccare** l'interfaccia input client (`{throttle, brake, steer}`), il tick-rate (50ms) né i 13 sottostep di `COLLISION_SUBSTEPS` — questi restano dove sono concettualmente (orchestrazione in `f1GameSocket.js` per il tick-rate, `COLLISION_SUBSTEPS` diventa una costante di `CollisionResolver.js` ma il valore/uso restano identici).
- **`module.exports.physics` invariato nella forma**: stessa lista di chiavi, stessi riferimenti a funzione, stessi valori. Verificato dai test esistenti (`f1GameSocket.physics.test.js`, `f1GameSocket.exports.test.js`) e dai consumer offline (`f1LapSimulator.js`, `f1RaceLineOptimizer.js`, `f1Testbench.test.js`) — nessuno di questi va modificato.
- **`applyBridgeBarrier(p, track, isRace)` resta retrocompatibile** con la chiamata a 2 argomenti (`isRace` undefined) usata da `f1LapSimulator.js`/`f1RaceLineOptimizer.js` — comportamento invariato, nessun danno applicato se `isRace` è falsy/undefined (già così oggi).
- **Niente commit/push automatico**: per convenzione di progetto lo fa l'utente, quando vuole (vedi `CLAUDE.md`). Ogni task termina con l'esecuzione della verifica, non con un commit.
- **Baseline di non-regressione già catturata** (da riprodurre identica dopo ogni task):
  - `node --test backend/sockets/games/` → `81 pass, 1 fail` (il fallimento è `trackLoader.test.js:33` — pre-esistente, scollegato da questo refactor: dati di geometria pista, non fisica del game core. Non deve cambiare né in numero né in causa.)
  - `node backend/tools/f1LapSimulator.js --all-tracks`:
    ```
    Pista            Tempo(ms)  Finito  Curva peggiore
    interlagos       35900      si      0.3% giro @ 10.2km/h
    monte-rosso      18150      si      0.9% giro @ 10.2km/h
    monza            22000      si      0.4% giro @ 10.2km/h
    new-monza        33350      si      0.3% giro @ 10.2km/h
    nuova-pista      49750      si      0.2% giro @ 10.2km/h
    prova            50000      si      0.2% giro @ 10.2km/h
    spa              -          NO      -
    test-bot         37200      si      0.4% giro @ 10.2km/h
    ```
    (spa non finisce entro i 60s del safety-cap: pre-esistente, non è una regressione introdotta qui.) Ogni riga (tempo/finito/curva peggiore) deve restare **identica carattere per carattere** dopo ogni task.

## File Structure

- `backend/sockets/games/physics/TyreModel.js` — mescole (`TYRE_COMPOUNDS`), usura gomme, suggerimento strategia.
- `backend/sockets/games/physics/DamageModel.js` — soglie/effetti danno, rumore sterzo da danno, danno+penalità da collisione auto-auto e auto-barriera.
- `backend/sockets/games/physics/VehiclePhysics.js` — velocità effettiva (mescola+usura+danno), grip effettivo, `updateVelocity`, `integratePosition`, `applyOffTrackDrag`. Dipende da TyreModel (mescola/usura) e DamageModel (fattori danno, rumore sterzo).
- `backend/sockets/games/physics/CollisionResolver.js` — muro rigido ponte/barriera (`applyBridgeBarrier`), collisioni auto-auto SAT/OBB (`resolveCollisions`), `COLLISION_SUBSTEPS`. Dipende da DamageModel (soglia severità, applicazione danno).
- `backend/sockets/games/f1GameSocket.js` — resta l'unico file con `require`/`module.exports`, gli handler Socket.io, le fasi di gioco (tyre_select/qualifying/grid_display/race), il pit stop, `tickGame` (ora chiama le funzioni importate invece di definirle), il progresso sul tracciato (`updateTrackIndex`/`checkLap`/`progressScore`, non spostato: sono tracking di giro, non fisica del veicolo), `buildPublicState`, e il blocco `module.exports.physics` che ri-espone tutto quanto sopra.

Ordine di estrazione: **TyreModel → DamageModel → VehiclePhysics → CollisionResolver** (rispetta le dipendenze: Vehicle e Collision dipendono da Tyre/Damage, mai il contrario).

---

## Task 1: Estrarre TyreModel.js

**Files:**
- Create: `backend/sockets/games/physics/TyreModel.js`
- Modify: `backend/sockets/games/f1GameSocket.js` (righe 114-227: rimuovere sezione mescole/usura + `tyreOf` + `suggestStrategy`; righe 1-5: aggiungere require)
- Test: nessun nuovo test — la suite esistente (`f1GameSocket.physics.test.js`, `f1GameSocket.exports.test.js`, `f1Testbench.test.js`, `f1Bot.test.js`) fa già da rete di non-regressione.

**Interfaces:**
- Produces: `TyreModel.TYRE_COMPOUNDS`, `TyreModel.DEFAULT_COMPOUND`, `TyreModel.WEAR_LAPS_AT_MEDIUM`, `TyreModel.WEAR_OFFTRACK_EXTRA`, `TyreModel.WEAR_SPEED_PENALTY`, `TyreModel.WEAR_GRIP_PENALTY`, `TyreModel.tyreOf(p, isQuali)`, `TyreModel.applyTyreWear(p, offTrack, track)`, `TyreModel.suggestStrategy(totalLaps)`.

- [ ] **Step 1: Creare `backend/sockets/games/physics/TyreModel.js`** con questo contenuto esatto (spostato verbatim da `f1GameSocket.js`, nessuna formula cambiata):

```js
// backend/sockets/games/physics/TyreModel.js
//
// Tyre Model: mescole (Soft/Medium/Hard), usura, suggerimento strategia.
// Estratto da f1GameSocket.js (Rif. SDD Capitolo 10.6) senza modificarne la
// logica — stesse formule, stessi valori, stesso comportamento.

// ====================================================
// MESCOLE E USURA GOMME
// Soft/Medium/Hard differiscono sia in prestazioni (velocità massima e
// aderenza) sia in velocità di usura — come nella F1 vera: la Soft è più
// veloce ma dura meno, la Hard il contrario. L'usura cresce SOLO con la
// distanza percorsa (fermo = zero usura, richiesta esplicita), con un piccolo
// extra fuoripista; a gomme esaurite si perde fino a WEAR_SPEED_PENALTY di
// velocità massima e WEAR_GRIP_PENALTY di aderenza (più derapate).
// ====================================================
const TYRE_COMPOUNDS = {
    soft:   { label: 'Soft',   color: '#e74c3c', speedMult: 1.05, gripMult: 1.00, wearRate: 1.5 },
    medium: { label: 'Medium', color: '#f1c40f', speedMult: 1.00, gripMult: 0.95, wearRate: 1.0 },
    hard:   { label: 'Hard',   color: '#ecf0f1', speedMult: 0.95, gripMult: 0.90, wearRate: 0.6 },
};
const DEFAULT_COMPOUND = 'medium';

const WEAR_LAPS_AT_MEDIUM = 5;   // quanti giri dura una Medium (wearRate=1) prima del 100% di usura
const WEAR_OFFTRACK_EXTRA = 0.02; // piccolo extra per tick fuori pista (oltre a quello da distanza)
const WEAR_SPEED_PENALTY  = 0.25; // fino a -25% velocità massima a gomme esaurite
const WEAR_GRIP_PENALTY   = 0.35; // fino a -35% aderenza a gomme esaurite (più derapate)

// In qualifica TUTTI usano lo spec della Soft (gomma da qualifica, come in F1
// vera), gomme fresche, a prescindere dalla mescola scelta per la gara — la
// scelta conta solo una volta iniziata la gara vera.
function tyreOf(p, isQuali) {
    if (isQuali) return TYRE_COMPOUNDS.soft;
    return TYRE_COMPOUNDS[p.compound] || TYRE_COMPOUNDS[DEFAULT_COMPOUND];
}

// Usura gomme: SOLO dalla distanza percorsa nel tick (fermo = zero usura,
// nessun caso speciale necessario) + un piccolo extra fisso se fuori pista.
function applyTyreWear(p, offTrack, track) {
    const dist = Math.hypot(p.vx, p.vz);   // distanza percorsa in questo tick
    const wearPerUnitDist = 100 / (WEAR_LAPS_AT_MEDIUM * track.lapLength);
    p.tyreWear = Math.min(100, p.tyreWear + dist * wearPerUnitDist * tyreOf(p).wearRate);
    if (offTrack) p.tyreWear = Math.min(100, p.tyreWear + WEAR_OFFTRACK_EXTRA);
}

// Suggerimento di strategia (solo indicativo, mostrato in selezione mescola):
// parte da una mescola durevole per il primo stint, poi via via più
// prestazionali per i restanti — quante ne servono dipende dai giri totali.
function suggestStrategy(totalLaps) {
    const life = {
        hard:   Math.max(1, Math.round(WEAR_LAPS_AT_MEDIUM / TYRE_COMPOUNDS.hard.wearRate)),
        medium: WEAR_LAPS_AT_MEDIUM,
        soft:   Math.max(1, Math.round(WEAR_LAPS_AT_MEDIUM / TYRE_COMPOUNDS.soft.wearRate)),
    };
    const order  = ['hard', 'medium', 'soft'];
    const stints = [];
    let remaining = totalLaps;
    let i = 0;
    while (remaining > 0 && stints.length < 6) {
        const compound = order[Math.min(i, order.length - 1)];
        stints.push(compound);
        remaining -= life[compound];
        i++;
    }
    return stints;
}

module.exports = {
    TYRE_COMPOUNDS, DEFAULT_COMPOUND,
    WEAR_LAPS_AT_MEDIUM, WEAR_OFFTRACK_EXTRA, WEAR_SPEED_PENALTY, WEAR_GRIP_PENALTY,
    tyreOf, applyTyreWear, suggestStrategy
};
```

- [ ] **Step 2: In `f1GameSocket.js`, aggiungere il require dopo la riga 5** (`const { createBots, ... } = require('./f1Bot');`):

```js
const TyreModel = require('./physics/TyreModel');
const {
    TYRE_COMPOUNDS, DEFAULT_COMPOUND, WEAR_LAPS_AT_MEDIUM,
    // WEAR_SPEED_PENALTY/WEAR_GRIP_PENALTY: servono ancora a effectiveMaxSpeed/
    // effectiveGrip, che restano funzioni LOCALI in questo file fino al Task 3
    // (si spostano in VehiclePhysics.js solo lì) — senza questi due
    // nell'import, quelle due funzioni smetterebbero di trovare i nomi non
    // appena rimuoviamo le costanti originali nello Step 3 qui sotto. Vanno
    // tolti da qui nel Task 3 (Step 2), quando effectiveMaxSpeed/effectiveGrip
    // se ne vanno e VehiclePhysics.js li importa per conto proprio.
    WEAR_SPEED_PENALTY, WEAR_GRIP_PENALTY,
    tyreOf, applyTyreWear, suggestStrategy
} = TyreModel;
```

- [ ] **Step 3: Rimuovere da `f1GameSocket.js` (originale, righe 114-227) solo questi 4 blocchi — tutto il resto della sezione (TYRE_SELECT_MS, i blocchi DAMAGE_*, `effectiveMaxSpeed`, `effectiveGrip`, `applyDamageSteerNoise`, le costanti pit-stop/semaforo) resta al proprio posto per ora, verrà rimosso nei task successivi quando tocca il rispettivo modulo.**

  Blocco A — commento + `TYRE_COMPOUNDS` + `DEFAULT_COMPOUND` (righe 114-128):

  ```js
  // ====================================================
  // MESCOLE E USURA GOMME
  // Soft/Medium/Hard differiscono sia in prestazioni (velocità massima e
  // aderenza) sia in velocità di usura — come nella F1 vera: la Soft è più
  // veloce ma dura meno, la Hard il contrario. L'usura cresce SOLO con la
  // distanza percorsa (fermo = zero usura, richiesta esplicita), con un piccolo
  // extra fuoripista; a gomme esaurite si perde fino a WEAR_SPEED_PENALTY di
  // velocità massima e WEAR_GRIP_PENALTY di aderenza (più derapate).
  // ====================================================
  const TYRE_COMPOUNDS = {
      soft:   { label: 'Soft',   color: '#e74c3c', speedMult: 1.05, gripMult: 1.00, wearRate: 1.5 },
      medium: { label: 'Medium', color: '#f1c40f', speedMult: 1.00, gripMult: 0.95, wearRate: 1.0 },
      hard:   { label: 'Hard',   color: '#ecf0f1', speedMult: 0.95, gripMult: 0.90, wearRate: 0.6 },
  };
  const DEFAULT_COMPOUND = 'medium';
  ```

  Blocco B — le 4 costanti `WEAR_*` (righe 131-134, **non** `TYRE_SELECT_MS` che sta appena sopra e resta):

  ```js
  const WEAR_LAPS_AT_MEDIUM = 5;   // quanti giri dura una Medium (wearRate=1) prima del 100% di usura
  const WEAR_OFFTRACK_EXTRA = 0.02; // piccolo extra per tick fuori pista (oltre a quello da distanza)
  const WEAR_SPEED_PENALTY  = 0.25; // fino a -25% velocità massima a gomme esaurite
  const WEAR_GRIP_PENALTY   = 0.35; // fino a -35% aderenza a gomme esaurite (più derapate)
  ```

  Blocco C — la funzione `tyreOf` (righe 169-175, incluso il commento):

  ```js
  // In qualifica TUTTI usano lo spec della Soft (gomma da qualifica, come in F1
  // vera), gomme fresche, a prescindere dalla mescola scelta per la gara — la
  // scelta conta solo una volta iniziata la gara vera.
  function tyreOf(p, isQuali) {
      if (isQuali) return TYRE_COMPOUNDS.soft;
      return TYRE_COMPOUNDS[p.compound] || TYRE_COMPOUNDS[DEFAULT_COMPOUND];
  }
  ```

  Blocco D — la funzione `suggestStrategy` (righe 207-227, incluso il commento):

  ```js
  // Suggerimento di strategia (solo indicativo, mostrato in selezione mescola):
  // parte da una mescola durevole per il primo stint, poi via via più
  // prestazionali per i restanti — quante ne servono dipende dai giri totali.
  function suggestStrategy(totalLaps) {
      const life = {
          hard:   Math.max(1, Math.round(WEAR_LAPS_AT_MEDIUM / TYRE_COMPOUNDS.hard.wearRate)),
          medium: WEAR_LAPS_AT_MEDIUM,
          soft:   Math.max(1, Math.round(WEAR_LAPS_AT_MEDIUM / TYRE_COMPOUNDS.soft.wearRate)),
      };
      const order  = ['hard', 'medium', 'soft'];
      const stints = [];
      let remaining = totalLaps;
      let i = 0;
      while (remaining > 0 && stints.length < 6) {
          const compound = order[Math.min(i, order.length - 1)];
          stints.push(compound);
          remaining -= life[compound];
          i++;
      }
      return stints;
  }
  ```

  Blocco E — la funzione `applyTyreWear` (righe 1435-1442 dell'originale, **lontana** dai blocchi A-D: sta nella sezione "FISICA" molto più in basso nel file, subito prima della sezione "DANNO DA COLLISIONE"; incluso il commento):

  ```js
  // Usura gomme: SOLO dalla distanza percorsa nel tick (fermo = zero usura,
  // nessun caso speciale necessario) + un piccolo extra fisso se fuori pista.
  function applyTyreWear(p, offTrack, track) {
      const dist = Math.hypot(p.vx, p.vz);   // distanza percorsa in questo tick
      const wearPerUnitDist = 100 / (WEAR_LAPS_AT_MEDIUM * track.lapLength);
      p.tyreWear = Math.min(100, p.tyreWear + dist * wearPerUnitDist * tyreOf(p).wearRate);
      if (offTrack) p.tyreWear = Math.min(100, p.tyreWear + WEAR_OFFTRACK_EXTRA);
  }
  ```

  Questa è l'unica delle 5 rimozioni che NON tocca `WEAR_OFFTRACK_EXTRA` come costante a sé: `WEAR_OFFTRACK_EXTRA` non è usata da nessun'altra parte rimasta in `f1GameSocket.js`, quindi non serve importarla — sparisce insieme al blocco B.

  Muoversi con cautela: leggere il file prima di editarlo invece di contare le righe a memoria, perché il Step 2 ha già aggiunto testo in cima al file.

- [ ] **Step 4: Verificare che ogni uso di `TYRE_COMPOUNDS`, `DEFAULT_COMPOUND`, `WEAR_LAPS_AT_MEDIUM`, `suggestStrategy` nel resto del file (handler `joinF1Game`, `f1TyreChoice`, `f1PitCompoundChoice`, `startTyreSelect`, `assignGridSpawns`, il blocco `updateBotInputs(... wearLapsAtMedium: WEAR_LAPS_AT_MEDIUM ...)`, `module.exports.TYRE_COMPOUNDS`) continui a compilare** — non serve modificare quelle righe, risolvono già tramite il destructuring del Step 2.

- [ ] **Step 5: Eseguire la verifica di non-regressione**

```bash
node --test backend/sockets/games/
node backend/tools/f1LapSimulator.js --all-tracks
```

Atteso: identico alla baseline in Global Constraints (81 pass / 1 fail pre-esistente su `trackLoader.test.js`; tabella tempi/giri identica carattere per carattere). Se qualcosa differisce, fermarsi e diagnosticare prima di procedere — non è accettabile alcuna variazione.

- [ ] **Step 6: Fermarsi.** Nessun commit (convenzione di progetto: lo fa l'utente). Segnalare l'esito della verifica e attendere conferma prima di passare al Task 2.

---

## Task 2: Estrarre DamageModel.js

**Files:**
- Create: `backend/sockets/games/physics/DamageModel.js`
- Modify: `backend/sockets/games/f1GameSocket.js` (rimuovere costanti DAMAGE_*/collisione + `applyDamageSteerNoise` + `collisionDamageAmount`/`applyCollisionPenalty`/`applyCarCollisionDamage`/`applyBarrierDamage`; aggiungere require)

**Interfaces:**
- Consumes: nessuna dipendenza da TyreModel o altri moduli.
- Produces: `DamageModel.DAMAGE_GRIP_THRESHOLD`, `.DAMAGE_STEER_THRESHOLD`, `.DAMAGE_SPEED_PENALTY_MAX`, `.DAMAGE_GRIP_PENALTY_MAX`, `.DAMAGE_STEER_NOISE_MAX`, `.applyDamageSteerNoise(p, isQuali, rng)`, `.MIN_COLLISION_SEVERITY`, `.DAMAGE_PER_SEVERITY`, `.DAMAGE_CAP_PER_HIT`, `.VICTIM_DAMAGE_FRACTION`, `.COLLISION_PENALTY_PER_SEVERITY`, `.COLLISION_PENALTY_CAP_MS`, `.collisionDamageAmount(severity)`, `.applyCollisionPenalty(culprit, severity)`, `.applyCarCollisionDamage(a, b, avn, bvn, closingRate)`, `.applyBarrierDamage(p, vn)`. Questi ultimi due saranno consumati da `CollisionResolver.js` nel Task 4; `applyDamageSteerNoise`/`DAMAGE_SPEED_PENALTY_MAX`/`DAMAGE_GRIP_PENALTY_MAX`/`DAMAGE_GRIP_THRESHOLD` saranno consumati da `VehiclePhysics.js` nel Task 3.

- [ ] **Step 1: Creare `backend/sockets/games/physics/DamageModel.js`** con questo contenuto esatto:

```js
// backend/sockets/games/physics/DamageModel.js
//
// Damage Model: soglie/effetti del danno (rumore sterzo) + danno e penalità
// da collisione auto-auto/auto-barriera. Estratto da f1GameSocket.js (Rif.
// SDD Capitolo 10.6) senza modificarne la logica — stesse formule, stessi
// valori, stesso comportamento. Il danno si accumula SOLO in gara: i
// chiamanti (resolveCollisions/applyBridgeBarrier in CollisionResolver.js)
// sono già ristretti alla gara vera, vedi
// docs/superpowers/specs/2026-07-25-f1-danno-collisioni-design.md.

const DAMAGE_GRIP_THRESHOLD    = 33;    // % danno oltre cui inizia la perdita di aderenza
const DAMAGE_STEER_THRESHOLD   = 66;    // % danno oltre cui inizia il rumore sullo sterzo
const DAMAGE_SPEED_PENALTY_MAX = 0.30;  // fino a -30% velocità massima a danno 100%
const DAMAGE_GRIP_PENALTY_MAX  = 0.35;  // fino a -35% aderenza, attivo solo oltre DAMAGE_GRIP_THRESHOLD
const DAMAGE_STEER_NOISE_MAX   = 0.15;  // rumore massimo sterzo (frazione, sommata a inputs.steer), oltre DAMAGE_STEER_THRESHOLD

// Rumore sullo sterzo da danno grave (>DAMAGE_STEER_THRESHOLD), solo in
// gara. rng iniettabile per test deterministici (stesso pattern di
// randRange in f1Bot.js). Fallback (p.damage || 0): i player creati dagli
// strumenti offline (f1LapSimulator.js, f1RaceLineOptimizer.js) non hanno il
// campo damage.
function applyDamageSteerNoise(p, isQuali, rng = Math.random) {
    const damage = p.damage || 0;
    if (isQuali || damage <= DAMAGE_STEER_THRESHOLD) return 0;
    const frac = (damage - DAMAGE_STEER_THRESHOLD) / (100 - DAMAGE_STEER_THRESHOLD);
    return (rng() * 2 - 1) * frac * DAMAGE_STEER_NOISE_MAX;
}

// ====================================================
// DANNO DA COLLISIONE — modello unico 0-100%, come tyreWear.
// ====================================================
const MIN_COLLISION_SEVERITY         = 1.0;   // sotto questa velocità di avvicinamento, nessun danno/penalità
const DAMAGE_PER_SEVERITY            = 6;     // % danno per unità di severità oltre soglia
const DAMAGE_CAP_PER_HIT             = 25;    // % danno massimo da un singolo urto
const VICTIM_DAMAGE_FRACTION         = 0.18;  // quota di danno che prende la vittima di un tamponamento
const COLLISION_PENALTY_PER_SEVERITY = 400;   // ms di penalità per unità di severità oltre soglia
const COLLISION_PENALTY_CAP_MS       = 5000;  // penalità massima da un singolo urto

function collisionDamageAmount(severity) {
    return Math.min(DAMAGE_CAP_PER_HIT, Math.abs(severity) * DAMAGE_PER_SEVERITY);
}

function applyCollisionPenalty(culprit, severity) {
    // Arrotondato a ms interi: severity è un float di fisica, e senza questo
    // collisionPenaltyMs (sommato a p.time in checkLap) diventa un numero
    // non intero — il tempo finale mostrato a schermo finiva con una sfilza
    // di decimali (es. "3:16.10.848209412244614", il resto del float dentro
    // ms % 1000 nel client).
    const ms = Math.round(Math.min(COLLISION_PENALTY_CAP_MS, Math.abs(severity) * COLLISION_PENALTY_PER_SEVERITY));
    culprit.collisionPenaltyMs += ms;
    culprit.pendingCollisionPenaltyEvents.push(ms);   // drenata da tickGame per l'emit f1CollisionPenalty
}

// avn/bvn: componenti di velocità di a/b lungo la normale d'urto (orientata
// da a verso b, vedi resolveCollisions in CollisionResolver.js) — avn>0: a si
// avvicina a b; -bvn>0: b si avvicina ad a. Chi si avvicina di più è il
// colpevole. closingRate è la violenza totale dell'urto (somma dei due
// avvicinamenti), già filtrata da MIN_COLLISION_SEVERITY dal chiamante.
function applyCarCollisionDamage(a, b, avn, bvn, closingRate) {
    const closingA = avn, closingB = -bvn;
    const faultIsA = closingA >= closingB;
    const culprit = faultIsA ? a : b;
    const victim  = faultIsA ? b : a;

    const dmg = collisionDamageAmount(closingRate);
    culprit.damage = Math.min(100, culprit.damage + dmg);
    victim.damage  = Math.min(100, victim.damage + dmg * VICTIM_DAMAGE_FRACTION);

    applyCollisionPenalty(culprit, closingRate);
}

function applyBarrierDamage(p, vn) {
    p.damage = Math.min(100, p.damage + collisionDamageAmount(vn));
    // nessuna penalità: contro il muro ci si fa male da soli.
}

module.exports = {
    DAMAGE_GRIP_THRESHOLD, DAMAGE_STEER_THRESHOLD, DAMAGE_SPEED_PENALTY_MAX, DAMAGE_GRIP_PENALTY_MAX, DAMAGE_STEER_NOISE_MAX,
    applyDamageSteerNoise,
    MIN_COLLISION_SEVERITY, DAMAGE_PER_SEVERITY, DAMAGE_CAP_PER_HIT, VICTIM_DAMAGE_FRACTION,
    COLLISION_PENALTY_PER_SEVERITY, COLLISION_PENALTY_CAP_MS,
    collisionDamageAmount, applyCollisionPenalty, applyCarCollisionDamage, applyBarrierDamage
};
```

- [ ] **Step 2: In `f1GameSocket.js`, aggiungere il require subito dopo il blocco `TyreModel` inserito nel Task 1**:

```js
const DamageModel = require('./physics/DamageModel');
const {
    // DAMAGE_SPEED_PENALTY_MAX/DAMAGE_GRIP_PENALTY_MAX/DAMAGE_GRIP_THRESHOLD:
    // servono ancora a effectiveMaxSpeed/effectiveGrip, che restano funzioni
    // LOCALI in questo file fino al Task 3. Stesso motivo di
    // WEAR_SPEED_PENALTY/WEAR_GRIP_PENALTY nel Task 1 — vanno tolti da qui
    // nel Task 3 (Step 2), quando VehiclePhysics.js li importa per conto suo.
    DAMAGE_SPEED_PENALTY_MAX, DAMAGE_GRIP_PENALTY_MAX, DAMAGE_GRIP_THRESHOLD,
    DAMAGE_STEER_NOISE_MAX,
    MIN_COLLISION_SEVERITY, DAMAGE_CAP_PER_HIT, COLLISION_PENALTY_CAP_MS,
    applyDamageSteerNoise, collisionDamageAmount, applyCollisionPenalty,
    applyCarCollisionDamage, applyBarrierDamage
} = DamageModel;
```

- [ ] **Step 3: Rimuovere da `f1GameSocket.js`:**
  - Le 5 costanti `DAMAGE_GRIP_THRESHOLD`/`DAMAGE_STEER_THRESHOLD`/`DAMAGE_SPEED_PENALTY_MAX`/`DAMAGE_GRIP_PENALTY_MAX`/`DAMAGE_STEER_NOISE_MAX` (con il loro commento).
  - La funzione `applyDamageSteerNoise` (con il suo commento).
  - L'intera sezione `// DANNO DA COLLISIONE ...` con le 6 costanti (`MIN_COLLISION_SEVERITY` ... `COLLISION_PENALTY_CAP_MS`) e le 4 funzioni `collisionDamageAmount`, `applyCollisionPenalty`, `applyCarCollisionDamage`, `applyBarrierDamage`.

  Leggere il file aggiornato prima di editarlo (i task precedenti hanno già spostato del testo, i numeri di riga originali non sono più validi) e cercare i blocchi per contenuto, non per riga.

- [ ] **Step 4: Eseguire la verifica di non-regressione** (stessi comandi del Task 1, Step 5). Atteso: identico alla baseline.

- [ ] **Step 5: Fermarsi.** Nessun commit. Segnalare l'esito e attendere conferma.

---

## Task 3: Estrarre VehiclePhysics.js

**Files:**
- Create: `backend/sockets/games/physics/VehiclePhysics.js`
- Modify: `backend/sockets/games/f1GameSocket.js` (rimuovere costanti MAX_SPEED/ACCEL/FRICTION/TURN_SPEED_*/GRIP/BRAKE_MULT, `effectiveMaxSpeed`, `effectiveGrip`, `updateVelocity`, `integratePosition`, `nearestTrackDist`, `applyOffTrackDrag`; aggiungere require)

**Interfaces:**
- Consumes: `TyreModel.tyreOf`, `TyreModel.WEAR_SPEED_PENALTY`, `TyreModel.WEAR_GRIP_PENALTY` (Task 1); `DamageModel.DAMAGE_SPEED_PENALTY_MAX`, `DamageModel.DAMAGE_GRIP_PENALTY_MAX`, `DamageModel.DAMAGE_GRIP_THRESHOLD`, `DamageModel.applyDamageSteerNoise` (Task 2).
- Produces: `VehiclePhysics.MAX_SPEED`, `.ACCEL`, `.FRICTION`, `.TURN_SPEED_LOW`, `.TURN_SPEED_HIGH`, `.GRIP`, `.BRAKE_MULT`, `.effectiveMaxSpeed(p, isQuali)`, `.effectiveGrip(p, isQuali)`, `.updateVelocity(p, isQuali, slipstreamMult)`, `.integratePosition(p, dt)`, `.applyOffTrackDrag(p, track)`.

- [ ] **Step 1: Creare `backend/sockets/games/physics/VehiclePhysics.js`** con questo contenuto esatto:

```js
// backend/sockets/games/physics/VehiclePhysics.js
//
// Vehicle Controller / Physics Model: velocità (accelerazione/freno/sterzo/
// grip), integrazione della posizione e drag fuoripista. Estratto da
// f1GameSocket.js (Rif. SDD Capitolo 10.6) senza modificarne la logica —
// stesse formule, stessi valori, stesso comportamento.
const TrackGeometry = require('../../../../frontend/shared/trackGeometry.js');
const { tyreOf, WEAR_SPEED_PENALTY, WEAR_GRIP_PENALTY } = require('./TyreModel');
const {
    DAMAGE_SPEED_PENALTY_MAX, DAMAGE_GRIP_PENALTY_MAX, DAMAGE_GRIP_THRESHOLD,
    applyDamageSteerNoise
} = require('./DamageModel');

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
// Velocità di sterzata dipendente dalla velocità dell'auto (non più un
// unico valore fisso): pieno sterzo a bassa velocità per manovre strette
// (tornanti, uscita curva), più contenuto al massimo — come un'auto vera.
// Richiesto esplicitamente dall'utente, che trovava lo sterzo "rigido" sia
// in generale (valore assoluto basso) sia perché identico a ogni velocità
// (nessuna differenza basso/alto regime). Vedi interpolazione in
// updateVelocity in base a |p.speed|/maxSpeed.
const TURN_SPEED_LOW  = 0.075;   // rad/tick a velocità quasi nulla (era 0.048 fisso, +56%)
const TURN_SPEED_HIGH = 0.052;   // rad/tick alla velocità massima (era 0.048 fisso, +8%)
const GRIP         = 0.78;
const BRAKE_MULT   = 2.17;   // moltiplicatore di ACCEL in frenata (era 1.4 a MAX_SPEED=4.0)

// p.damage va letto come (p.damage || 0): gli strumenti offline
// (f1LapSimulator.js, f1RaceLineOptimizer.js) costruiscono i loro player di
// simulazione senza campo damage — con una lettura diretta p.damage/100
// darebbe NaN e romperebbe la simulazione. Per i giocatori reali damage è
// sempre un numero (mai undefined, vedi init in joinF1Game/createBots).
function effectiveMaxSpeed(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - (p.tyreWear / 100) * WEAR_SPEED_PENALTY;
    const damageFactor = isQuali ? 1 : 1 - ((p.damage || 0) / 100) * DAMAGE_SPEED_PENALTY_MAX;
    return MAX_SPEED * tyreOf(p, isQuali).speedMult * wearFactor * damageFactor;
}

function effectiveGrip(p, isQuali) {
    const wearFactor = isQuali ? 1 : 1 - (p.tyreWear / 100) * WEAR_GRIP_PENALTY;
    const gripDamageFrac = isQuali ? 0
        : Math.max(0, (p.damage || 0) - DAMAGE_GRIP_THRESHOLD) / (100 - DAMAGE_GRIP_THRESHOLD);
    const damageFactor = 1 - gripDamageFrac * DAMAGE_GRIP_PENALTY_MAX;
    return GRIP * tyreOf(p, isQuali).gripMult * wearFactor * damageFactor;
}

// ====================================================
// FISICA
// Velocità (accelerazione/freno/sterzo/grip) e integrazione della posizione
// sono separate apposta: la velocità si calcola una volta per tick, la
// posizione viene integrata in sottostep da tickGame (vedi
// CollisionResolver.COLLISION_SUBSTEPS) per dare alla risoluzione collisioni
// più occasioni di vedere un contatto.
// ====================================================
function updateVelocity(p, isQuali, slipstreamMult) {
    const { inputs } = p;
    const maxSpeed = effectiveMaxSpeed(p, isQuali) * (slipstreamMult || 1);   // dipende da mescola + usura (Soft fissa in qualifica) + scia
    const grip     = effectiveGrip(p, isQuali);

    if (inputs.throttle > 0) p.speed = Math.min(p.speed + ACCEL * inputs.throttle, maxSpeed);
    else if (inputs.brake > 0) {
        // Frenata/retromarcia. La decelerazione in frenata è un decremento
        // costante per tick, quindi lo spazio d'arresto va con v²/decel: per
        // tenerlo vicino a quello di prima dell'aumento di velocità (R=1.55),
        // BRAKE_MULT scala di R² rispetto al vecchio 1.4 (non solo ×R) — vedi
        // docs/superpowers/specs/2026-07-21-f1-velocita-frenata-mescole-design.md.
        p.speed = Math.max(p.speed - ACCEL * BRAKE_MULT * inputs.brake, -maxSpeed / 2);
        p.vx *= 0.94;
        p.vz *= 0.94;
    } else {
        if (p.speed > 0) p.speed = Math.max(p.speed - FRICTION, 0);
        if (p.speed < 0) p.speed = Math.min(p.speed + FRICTION, 0);
    }
    // Il tetto di velocità può essersi abbassato (usura aumentata da fermo non
    // succede, ma cambiando mescola in futuro pit stop sì): non lasciare mai
    // p.speed sopra il nuovo massimo.
    if (p.speed > maxSpeed) p.speed = maxSpeed;

    if (Math.abs(p.speed) > 0.01 || (p.vx * p.vx + p.vz * p.vz) > 0.0001) {
        const dir = p.speed >= 0 ? 1 : -1;
        const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
        const turnRate  = TURN_SPEED_LOW + (TURN_SPEED_HIGH - TURN_SPEED_LOW) * speedFrac;
        const steer = inputs.steer + applyDamageSteerNoise(p, isQuali);
        p.angle += turnRate * dir * steer;
    }

    const fx = Math.sin(p.angle) * p.speed;
    const fz = Math.cos(p.angle) * p.speed;
    p.vx = p.vx * grip + fx * (1 - grip);
    p.vz = p.vz * grip + fz * (1 - grip);
}

function integratePosition(p, dt) {
    p.x += p.vx * dt;
    p.z += p.vz * dt;
}

// Fuoripista: distanza dal punto più vicino della pista caricata.
function nearestTrackDist(track, x, z) {
    return TrackGeometry.nearestPoint(track.points, x, z).dist;
}

// Ghiaia: rallentamento fuori pista. Ritorna se il giocatore è fuori pista in
// questo tick, riusato da applyTyreWear per il piccolo extra di usura.
// (Chi è nella corsia box vera e propria è guidato dall'autopilota, escluso
// da questa funzione — vedi il filtro "racing" in tickGame — quindi non
// serve più un'esenzione qui: la zona di trigger d'ingresso è comunque
// abbastanza vicina al bordo pista normale da non scattare mai.)
function applyOffTrackDrag(p, track) {
    const dist = nearestTrackDist(track, p.x, p.z);
    const offTrack = dist > track.roadHalf + 2;
    if (offTrack) {
        const k = Math.min(1, (dist - track.roadHalf - 2) / 8);  // 0..1 in funzione della profondità
        const drag = 0.04 + k * 0.08;
        p.speed *= (1 - drag);
        p.vx   *= (1 - drag);
        p.vz   *= (1 - drag);
    }
    return offTrack;
}

module.exports = {
    MAX_SPEED, ACCEL, FRICTION, TURN_SPEED_LOW, TURN_SPEED_HIGH, GRIP, BRAKE_MULT,
    effectiveMaxSpeed, effectiveGrip, updateVelocity, integratePosition, applyOffTrackDrag
};
```

- [ ] **Step 2a: In `f1GameSocket.js`, aggiungere il require subito dopo il blocco `DamageModel` inserito nel Task 2**:

```js
const VehiclePhysics = require('./physics/VehiclePhysics');
const {
    ACCEL, BRAKE_MULT, TURN_SPEED_HIGH,
    effectiveMaxSpeed, effectiveGrip, updateVelocity, integratePosition, applyOffTrackDrag
} = VehiclePhysics;
```

- [ ] **Step 2b: Ripulire i due import "temporanei" aggiunti nei Task 1 e 2**, ora che `effectiveMaxSpeed`/`effectiveGrip` (le uniche funzioni che li usavano localmente) si spostano in `VehiclePhysics.js` (che li importa già per conto proprio, vedi il suo require di `TyreModel`/`DamageModel` nello Step 1):
  - Nel destructure di `TyreModel` (Task 1, Step 2): togliere `WEAR_SPEED_PENALTY, WEAR_GRIP_PENALTY,` (restano solo `TYRE_COMPOUNDS, DEFAULT_COMPOUND, WEAR_LAPS_AT_MEDIUM, tyreOf, applyTyreWear, suggestStrategy`).
  - Nel destructure di `DamageModel` (Task 2, Step 2): togliere `DAMAGE_SPEED_PENALTY_MAX, DAMAGE_GRIP_PENALTY_MAX, DAMAGE_GRIP_THRESHOLD,` (restano `DAMAGE_STEER_NOISE_MAX, MIN_COLLISION_SEVERITY, DAMAGE_CAP_PER_HIT, COLLISION_PENALTY_CAP_MS, applyDamageSteerNoise, collisionDamageAmount, applyCollisionPenalty, applyCarCollisionDamage, applyBarrierDamage` — questi restano perché servono ancora ad `applyBridgeBarrier`/`resolveCollisions`, locali fino al Task 4, oltre che al re-export finale in `module.exports.physics`).

- [ ] **Step 3: Rimuovere da `f1GameSocket.js`:**
  - Le costanti `MAX_SPEED`, `ACCEL`, `FRICTION`, `TURN_SPEED_LOW`, `TURN_SPEED_HIGH`, `GRIP`, `BRAKE_MULT` (con i relativi commenti) in cima al file.
  - Le funzioni `effectiveMaxSpeed` ed `effectiveGrip`.
  - La funzione `nearestTrackDist`.
  - Il commento sezione `// FISICA ...` e le funzioni `updateVelocity`, `integratePosition`, `applyOffTrackDrag` (dalla sezione "FISICA" più in basso nel file).

  `inPitEntryZone` **non va toccata** (resta in `f1GameSocket.js`, non è fisica del veicolo).

- [ ] **Step 4: Eseguire la verifica di non-regressione** (stessi comandi). Atteso: identico alla baseline.

- [ ] **Step 5: Fermarsi.** Nessun commit. Segnalare l'esito e attendere conferma.

---

## Task 4: Estrarre CollisionResolver.js

**Files:**
- Create: `backend/sockets/games/physics/CollisionResolver.js`
- Modify: `backend/sockets/games/f1GameSocket.js` (rimuovere costanti CAR_*/COLLISION_*/BRIDGE_BARRIER_*/`TRACK_INDEX_WINDOW`, `applyBridgeBarrier`, `carAxes`, `projectOBB`, `resolveCollisions`; aggiungere require; **la costante `TRACK_INDEX_WINDOW` locale usata da `updateTrackIndex` viene sostituita dall'import**, non duplicata)

**Interfaces:**
- Consumes: `DamageModel.MIN_COLLISION_SEVERITY`, `DamageModel.applyCarCollisionDamage`, `DamageModel.applyBarrierDamage` (Task 2).
- Produces: `CollisionResolver.COLLISION_SUBSTEPS`, `.TRACK_INDEX_WINDOW`, `.CAR_HALF_LENGTH`, `.CAR_HALF_WIDTH`, `.COLLISION_BOUNCE`, `.BRIDGE_BARRIER_MARGIN`, `.BRIDGE_BARRIER_SLOWDOWN`, `.BRIDGE_BARRIER_CONTACT_DRAG`, `.applyBridgeBarrier(p, track, isRace)`, `.resolveCollisions(players)`. `TRACK_INDEX_WINDOW` è condivisa con `updateTrackIndex` in `f1GameSocket.js` (che non la ridefinisce più, la importa da qui) — un'unica fonte di verità per evitare che le due finestre di ricerca divergano in futuro.

- [ ] **Step 1: Creare `backend/sockets/games/physics/CollisionResolver.js`** con questo contenuto esatto:

```js
// backend/sockets/games/physics/CollisionResolver.js
//
// Collision Resolver: muro rigido sui tratti ponte/barriera e collisioni
// auto-auto SAT/OBB. Estratto da f1GameSocket.js (Rif. SDD Capitolo 10.6)
// senza modificarne la logica — stesse formule, stessi valori, stesso
// comportamento.
const TrackGeometry = require('../../../../frontend/shared/trackGeometry.js');
const { MIN_COLLISION_SEVERITY, applyCarCollisionDamage, applyBarrierDamage } = require('./DamageModel');

// Ingombro reale dell'auto, misurato dal GLB (raceCarWhite.glb, bounding box
// combinata body+ruote applicando le translation dei nodi) × lo scale 3.5 con
// cui il modello viene caricato in f1.js: ~2.6 unità di larghezza (fianchi),
// ~4.7 di lunghezza (muso/coda). Il rettangolo va tenuto orientato con
// l'angolo dell'auto (SAT), altrimenti un cerchio esagera soprattutto i fianchi.
// Valori misurati sul modello custom (frontend/assets/custom/f1Car.glb):
// bbox GLB 0.992 x 2.048 (largh. x lungh.) x scale 3.5 = 3.47 x 7.17 in
// gioco -> metà 1.74 x 3.58. Prima erano 1.3/2.4, tarate sul vecchio kart
// Kenney molto più piccolo — con quelle le ruote posteriori del modello
// nuovo restavano fuori dall'hitbox.
const CAR_HALF_LENGTH  = 3.58;  // metà lunghezza, asse avanti/dietro (locale Z)
const CAR_HALF_WIDTH   = 1.74;  // metà larghezza, asse fianchi (locale X)
const COLLISION_BOUNCE = 0.6;  // quota della velocità normale scambiata all'urto (bump arcade, non elastico puro)

// A MAX_SPEED (6.2/tick) due auto che si avvicinano chiudono fino a 12.4
// unità in un tick — più della zona di contatto minima (~2.6, urto
// fianco-contro-fianco lungo l'asse stretto): senza integrare la posizione
// in sottostep, il rilevamento SAT (fatto una volta a fine tick) può non
// vedere mai la sovrapposizione e le auto si attraversano. 13 sottostep →
// chiusura massima ~0.95 unità/sottostep, stesso margine di sicurezza che
// c'era a MAX_SPEED=4.0 con 8 sottostep.
const COLLISION_SUBSTEPS = 13;

// Sui tratti ponte, uscire lateralmente non deve far "cadere" l'auto (senza
// terreno vero sotto finché non ricade sul terrapieno più lontano, vedi
// Fase 2): il bordo diventa un muro rigido. Stessa soglia già usata per il
// fuoripista (roadHalf+2 in applyOffTrackDrag di VehiclePhysics.js), non una
// nuova distanza.
const BRIDGE_BARRIER_MARGIN = 2;
// Quanta della componente di velocità che spinge oltre il muro (lungo la
// normale, verso l'esterno) viene rimossa ad ogni contatto — la componente
// parallela al muro non viene mai toccata da questo fattore (vedi
// applyBridgeBarrier: nessun calcolo/scelta di verso, solo rimozione della
// spinta verso l'esterno).
const BRIDGE_BARRIER_SLOWDOWN = 0.5;
// Attrito continuo applicato a tutta la velocità (non solo alla componente
// normale) finché l'auto resta appoggiata al muro — un rallentamento reale
// e sostenuto, non solo un colpo secco al momento dell'urto, richiesto
// esplicitamente dall'utente ("non velocità visibile dal contatore ma
// proprio un rallentamento"). Applicato ad ogni sotto-step di contatto
// (COLLISION_SUBSTEPS per tick): da tarare a vista, un valore troppo alto
// qui si amplifica rapidamente su contatti prolungati.
const BRIDGE_BARRIER_CONTACT_DRAG = 0.01;

// Finestra di ricerca locale (con wrap) dell'indice campionato più vicino:
// usata sia qui (applyBridgeBarrier) sia da updateTrackIndex in
// f1GameSocket.js. DEVE restare lo stesso valore nei due punti — per questo
// f1GameSocket.js importa questa costante invece di definirne una propria.
const TRACK_INDEX_WINDOW = 20;

// Muro rigido sui tratti ponte (Fase 3): a differenza di applyOffTrackDrag
// (che si applica ovunque e frena soltanto), qui — solo dove il punto pista
// più vicino è bridge:true — si impedisce fisicamente di superare la
// soglia. La sicurezza (non superare mai il muro) viene prima di tutto: la
// posizione è sempre riportata sul bordo.
//
// Redesign 2026-07-23 (vedi
// docs/superpowers/specs/2026-07-23-f1-barriera-ponte-redesign-design.md):
// tutti i tentativi precedenti provavano a CALCOLARE un verso "giusto" lungo
// il muro (dalla velocità d'impatto, poi da p.speed, poi da orientamento×
// p.speed) — ma qualunque calcolo è di fatto un "aiuto" che decide per il
// giocatore, e quando quel calcolo assume il verso canonico della pista
// (invece del verso reale di marcia) redirige in modo indesiderato chi va
// contromano o in retromarcia (bug segnalato dall'utente). Il fix corretto
// è più semplice: NON scegliere mai un verso. Si rimuove solo la componente
// di velocità che spinge oltre il muro (lungo la normale, verso l'esterno);
// qualunque componente parallela al muro l'auto avesse già — in qualunque
// verso, anche debole o ambigua — resta esattamente quella, senza alcuna
// correzione di direzione o di orientamento.
function applyBridgeBarrier(p, track, isRace) {
    const idx = TrackGeometry.nearestIndexNear(track.points, p.trackIndex || 0, p.x, p.z, TRACK_INDEX_WINDOW);
    const pt = track.points[idx];
    if (!pt.bridge) return;

    const dx = p.x - pt.x, dz = p.z - pt.z;
    const dist = Math.hypot(dx, dz);
    const limit = track.roadHalf + BRIDGE_BARRIER_MARGIN;

    if (dist <= limit) {
        p.wallContact = false;
        return;
    }

    const { nx, nz } = TrackGeometry.normalAt(track.points, idx, true);
    // normalAt punta sempre verso lo stesso lato fisso: va orientata verso
    // il lato da cui l'auto è effettivamente uscita.
    const side = (dx * nx + dz * nz) >= 0 ? 1 : -1;
    const wallNx = nx * side, wallNz = nz * side;

    // Riporta l'auto ESATTAMENTE sul bordo sottraendo solo l'eccesso lungo
    // la normale dalla sua posizione ATTUALE (non ricostruendola da zero sul
    // punto pista campionato pt): con una formula "p.x = pt.x + wallNx*limit"
    // ogni contatto ripiazzerebbe l'auto sullo stesso punto campionato più un
    // offset fisso, scartando qualunque avanzamento tangenziale reale appena
    // fatto — se il contatto scatta ad ogni sotto-step (equilibrio stabile
    // lungo il muro, confermato via log: l'indice pista restava congelato
    // per centinaia di tick nonostante una velocità sana) l'auto resterebbe
    // bloccata esattamente nello stesso punto per sempre. Sottrarre solo
    // l'eccesso preserva l'esatta posizione tangenziale raggiunta, azzerando
    // solo la componente radiale in più.
    const overshoot = dist - limit;
    p.x -= wallNx * overshoot;
    p.z -= wallNz * overshoot;

    // Componente della velocità lungo la normale (con segno: positiva se
    // punta ancora verso l'esterno, cioè sta ancora spingendo l'auto oltre
    // il muro). Si rimuove/smorza SOLO questa componente — quella
    // parallela al muro (vx/vz meno la parte normale) non viene mai
    // toccata: qualunque direzione avesse già l'auto lungo il bordo (avanti,
    // contromano, retromarcia) resta quella, senza alcun calcolo che scelga
    // un verso "giusto" al posto del giocatore.
    const vn = p.vx * wallNx + p.vz * wallNz;
    if (vn > 0) {
        const remove = vn * BRIDGE_BARRIER_SLOWDOWN;
        p.vx -= wallNx * remove;
        p.vz -= wallNz * remove;
    }

    if (!p.wallContact) {
        p.wallContact = true;
        if (isRace && Math.abs(vn) >= MIN_COLLISION_SEVERITY) {
            applyBarrierDamage(p, vn);
        }
    }

    // Attrito continuo mentre l'auto resta appoggiata al muro (non solo un
    // colpo secco al momento dell'urto): un rallentamento REALE e sostenuto
    // finché il contatto persiste — non solo un numero diverso sul
    // contachilometri — richiesto esplicitamente dall'utente.
    const contactKeep = 1 - BRIDGE_BARRIER_CONTACT_DRAG;
    p.vx *= contactKeep;
    p.vz *= contactKeep;

    // p.speed (lo scalare usato da updateVelocity per ricostruire
    // fx/fz = sin/cos(angle)*speed ad ogni tick, vedi blend col grip) va
    // risincronizzato: si proietta la nuova vx/vz sul muso dell'auto
    // (stessa convenzione di updateVelocity), non ricostruito da un verso
    // scelto — altrimenti riappare il disallineamento "velocità fantasma"
    // già diagnosticato e corretto in precedenza.
    p.speed = p.vx * Math.sin(p.angle) + p.vz * Math.cos(p.angle);
}

// ====================================================
// COLLISIONI TRA AUTO — rettangoli orientati (OBB)
// Un cerchio esagera i fianchi rispetto al muso/coda (l'auto è molto più
// stretta che lunga): serve un rettangolo allineato con l'angolo di ciascuna
// auto. Rilevamento con SAT (Separating Axis Theorem, 4 assi: i due assi
// locali di ciascun box) + risoluzione con l'MTV (asse di overlap minimo).
// Correzione posizionale (evita compenetrazione) + scambio parziale della
// componente di velocità lungo la normale (bump arcade). La GRIP di
// updateVelocity (VehiclePhysics.js) riassorbe naturalmente la spinta nei
// tick successivi, quindi non serve alcuno stato dedicato: la fisica
// esistente fa già "recuperare" l'auto dopo l'urto.
// ====================================================
function carAxes(p) {
    const s = Math.sin(p.angle), c = Math.cos(p.angle);
    return {
        forward: { x: s, z: c },    // asse lunghezza (muso/coda)
        right:   { x: c, z: -s }    // asse larghezza (fianchi)
    };
}

// Proietta il box di p sull'asse dato: ritorna [min,max] dell'intervallo occupato
function projectOBB(p, axes, axis) {
    const centerProj = p.x * axis.x + p.z * axis.z;
    const radius =
        Math.abs(axes.forward.x * axis.x + axes.forward.z * axis.z) * CAR_HALF_LENGTH +
        Math.abs(axes.right.x   * axis.x + axes.right.z   * axis.z) * CAR_HALF_WIDTH;
    return { min: centerProj - radius, max: centerProj + radius };
}

const CAR_MAX_REACH = (CAR_HALF_LENGTH + CAR_HALF_WIDTH) * 2;   // scarto rapido, upper bound grossolano

function resolveCollisions(players) {
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const a = players[i], b = players[j];

            const dx = b.x - a.x, dz = b.z - a.z;
            if (dx * dx + dz * dz > CAR_MAX_REACH * CAR_MAX_REACH) {
                a.carContacts.delete(b.color); b.carContacts.delete(a.color);
                continue;   // troppo distanti, salta il SAT
            }

            const axesA = carAxes(a);
            const axesB = carAxes(b);
            const axes  = [axesA.forward, axesA.right, axesB.forward, axesB.right];

            let minOverlap = Infinity;
            let mtvAxis    = null;

            let separated = false;
            for (const axis of axes) {
                const pa = projectOBB(a, axesA, axis);
                const pb = projectOBB(b, axesB, axis);
                const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
                if (overlap <= 0) { separated = true; break; }
                if (overlap < minOverlap) { minOverlap = overlap; mtvAxis = axis; }
            }
            if (separated) {
                a.carContacts.delete(b.color); b.carContacts.delete(a.color);
                continue;
            }

            // Normale dell'MTV, orientata da a verso b
            let nx = mtvAxis.x, nz = mtvAxis.z;
            if (dx * nx + dz * nz < 0) { nx = -nx; nz = -nz; }

            // Separazione posizionale: metà per uno, per non compenetrarsi
            const push = minOverlap * 0.5;
            a.x -= nx * push; a.z -= nz * push;
            b.x += nx * push; b.z += nz * push;

            // Impulso solo se si stanno avvicinando lungo la normale
            const avn = a.vx * nx + a.vz * nz;
            const bvn = b.vx * nx + b.vz * nz;
            const rel = bvn - avn;

            // Danno/penalità SOLO al primo contatto (transizione da "non a
            // contatto" a "a contatto"): uno struscio prolungato non deve
            // riaccumulare danno ad ogni sotto-step. resolveCollisions è
            // chiamata solo `if (!isQuali)` in tickGame, quindi tutto qui è
            // già implicitamente "solo in gara" — nessun controllo fase
            // aggiuntivo necessario.
            const wasInContact = a.carContacts.has(b.color);
            if (!wasInContact) {
                a.carContacts.add(b.color);
                b.carContacts.add(a.color);

                const closingRate = -rel;   // violenza totale dell'urto (rel<0 = si avvicinano)
                if (closingRate >= MIN_COLLISION_SEVERITY) {
                    applyCarCollisionDamage(a, b, avn, bvn, closingRate);
                }
            }

            if (rel < 0) {
                const delta = rel * COLLISION_BOUNCE;
                a.vx += nx * delta; a.vz += nz * delta;
                b.vx -= nx * delta; b.vz -= nz * delta;
            }
        }
    }
}

module.exports = {
    COLLISION_SUBSTEPS, TRACK_INDEX_WINDOW,
    CAR_HALF_LENGTH, CAR_HALF_WIDTH, COLLISION_BOUNCE,
    BRIDGE_BARRIER_MARGIN, BRIDGE_BARRIER_SLOWDOWN, BRIDGE_BARRIER_CONTACT_DRAG,
    applyBridgeBarrier, resolveCollisions
};
```

- [ ] **Step 2: In `f1GameSocket.js`, aggiungere il require subito dopo il blocco `VehiclePhysics` inserito nel Task 3**:

```js
const CollisionResolver = require('./physics/CollisionResolver');
const {
    COLLISION_SUBSTEPS, TRACK_INDEX_WINDOW,
    applyBridgeBarrier, resolveCollisions
} = CollisionResolver;
```

- [ ] **Step 3: Rimuovere da `f1GameSocket.js`:**
  - Le costanti `CAR_HALF_LENGTH`, `CAR_HALF_WIDTH`, `COLLISION_BOUNCE`, `COLLISION_SUBSTEPS`, `BRIDGE_BARRIER_MARGIN`, `BRIDGE_BARRIER_SLOWDOWN`, `BRIDGE_BARRIER_CONTACT_DRAG` (con i relativi commenti) in cima al file.
  - La costante locale `const TRACK_INDEX_WINDOW = 20;` nella sezione "PROGRESSO LUNGO IL TRACCIATO" — **sostituita dall'import del Step 2**, non ridefinita. `updateTrackIndex` (che la usa) resta invariata: risolve già `TRACK_INDEX_WINDOW` tramite il destructuring.
  - La funzione `applyBridgeBarrier` (nella sezione "FISICA").
  - Le funzioni `carAxes`, `projectOBB`, la costante `CAR_MAX_REACH`, la funzione `resolveCollisions` (sezione "COLLISIONI TRA AUTO").

- [ ] **Step 4: Eseguire la verifica di non-regressione** (stessi comandi). Atteso: identico alla baseline.

- [ ] **Step 5: Fermarsi.** Nessun commit. Segnalare l'esito e attendere conferma.

---

## Task 5: Pulizia finale e verifica di non-regressione completa

A questo punto `f1GameSocket.js` non contiene più alcuna formula fisica pura: solo requires/destructuring in testa, gli handler Socket.io, le transizioni di fase, il pit stop, `tickGame` (che ora è un vero orchestratore — chiama `updateVelocity`/`integratePosition`/`resolveCollisions`/`applyBridgeBarrier`/`applyOffTrackDrag`/`applyTyreWear` importati, senza definirne più nessuna localmente), il tracking di giro (`updateTrackIndex`/`checkLap`/`progressScore`/`circularWithin` — non spostati: sono tracking di posizione sul giro, non un modello fisico dei 4 richiesti) e `buildPublicState`.

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (solo verifica/pulizia, nessuna nuova logica)

- [ ] **Step 1: Rileggere `f1GameSocket.js` per intero** e verificare che:
  - Non resti nessuna definizione duplicata (stesso nome definito sia localmente sia importato).
  - Il blocco `module.exports.physics` in fondo al file esponga esattamente le stesse chiavi di prima (`PHYSICS_TICK_MS, COLLISION_SUBSTEPS, ACCEL, BRAKE_MULT, TURN_SPEED_HIGH, HALF_LAP_IDX, effectiveMaxSpeed, updateVelocity, integratePosition, applyOffTrackDrag, applyBridgeBarrier, updateTrackIndex, circularWithin, checkpointWindowFor, finishWindowFor, assignGridSpawns, MIN_COLLISION_SEVERITY, DAMAGE_CAP_PER_HIT, COLLISION_PENALTY_CAP_MS, collisionDamageAmount, applyCarCollisionDamage, applyBarrierDamage, applyCollisionPenalty, resolveCollisions, applyDamageSteerNoise, DAMAGE_STEER_NOISE_MAX, effectiveGrip, buildPublicState`) — non deve essere stato toccato, ma va confermato che tutti questi nomi risolvano ancora (nessun `ReferenceError` all'avvio).
  - `module.exports.tickGame` e `module.exports.TYRE_COMPOUNDS` restano presenti e invariati.
  - `tickGame` non contiene più alcuna formula fisica inline (solo chiamate a funzioni importate + logica di orchestrazione: filtri `racing`/`autoPiloted`, scia, sottostep, notifiche socket, gate di fine sessione).

- [ ] **Step 2: Avviare il server e controllare che parta senza errori**

```bash
cd backend && node -e "require('./sockets/games/f1GameSocket.js'); console.log('OK: nessun errore di require')"
```

- [ ] **Step 3: Eseguire l'intera suite di verifica**

```bash
node --test backend/sockets/games/
node backend/tools/f1LapSimulator.js --all-tracks
node -e "require('./backend/tools/f1RaceLineOptimizer.js'); console.log('OK: f1RaceLineOptimizer carica physics senza ReferenceError')"
```

(l'ultimo comando richiede il file senza eseguirne il `main()` — che parte solo se lanciato direttamente, vedi `require.main === module` in fondo al file — serve solo a controllare che tutti i riferimenti a `physics.*` risolvano ancora dopo il refactor, non a generare una racing line vera).

Atteso: `node --test` → `81 pass, 1 fail` (lo stesso fallimento pre-esistente di sempre, invariato); `f1LapSimulator --all-tracks` → tabella identica carattere per carattere alla baseline in Global Constraints.

- [ ] **Step 4: Playtest manuale in localhost** (per il gate finale utente, come da convenzione di progetto): `node server.js` da `backend/`, aprire una gara F1 con bot e verificare a occhio che velocità/frenata/sterzo/scia/usura/danno/collisioni/muro ponte si sentano identici a prima — non ci si aspetta alcuna differenza percepibile, è un refactor di collocazione file.

- [ ] **Step 5: Fermarsi.** Nessun commit/push: quando l'utente conferma che tutto è identico in localhost, farà lui il commit quando vuole (vedi `CLAUDE.md`).

---

## Note per chi esegue il piano

- In ogni task, gli step "aggiungere il require/destructuring" e "rimuovere le definizioni locali" vanno applicati **entrambi** prima di eseguire qualunque test: con solo il primo applicato il file non compila (stesso identificatore dichiarato due volte — una volta dal `const { ... } = require(...)`, una volta dalla vecchia `function`/`const` ancora presente più in basso). Questo è normale e atteso nello stato intermedio a metà task, non è un errore da investigare.
- Ogni "Modify" di questo piano lavora su un file che gli step precedenti hanno già cambiato: **leggere sempre il file corrente prima di editarlo**, non fare affidamento sui numeri di riga riportati nella lettura originale (validi solo per il file di partenza, prima del Task 1).
- Se un qualunque comando di verifica (Step "Eseguire la verifica di non-regressione") produce un risultato diverso dalla baseline, **fermarsi subito**: non è un problema da "sistemare avanti", è un segnale che lo spostamento appena fatto ha cambiato comportamento — cosa che questo piano vieta esplicitamente. Tornare indietro e confrontare byte-per-byte il codice spostato con l'originale.
