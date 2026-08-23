# F1 — Economia della gara, fasi 1-3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare conseguenze alla gara — il danno smette di essere invisibile in qualifica, l'auto parte pesante di benzina e si alleggerisce, ogni circuito consuma le gomme a modo suo, e uscire di pista rovina il fondo.

**Architecture:** Tre modifiche alla fisica, tutte nello stesso stile del codice esistente: un modello puro per dominio in `backend/sockets/games/physics/`, consultato dai consumatori senza duplicare formule. Il peso del carburante viaggia sul giocatore come `p.fuelFactor` — nessuna firma cambia, e i modelli non sanno che le stagioni o le gare veloci esistono. L'abrasività viaggia sull'oggetto pista, che `applyTyreWear` riceve già.

**Tech Stack:** Node.js (CommonJS), `node:test` + `node:assert/strict`. Nessuna dipendenza nuova. Frontend JS vanilla.

**Spec:** `docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md`

## Global Constraints

- **Italiano** nei commenti del codice e nei messaggi di commit.
- **Un commit per task.** Il push lo fa l'utente, mai l'agente.
- **`git add` per nome, MAI `git add -A`**: l'utente lavora in parallelo sugli stessi file (`frontend/f1.html`, `frontend/f1.js`, `frontend/styles/f1.css`, `frontend/tracks/*.json`). Controllare `git status` prima di ogni commit e aggiungere solo i file del task.
- **Branch**: `f1-stagioni` (quello corrente).
- **Cache-busting**: ogni modifica a `frontend/f1.js` richiede di alzare il `?v=` di `f1.js` dentro `frontend/f1.html`, altrimenti il browser serve JS vecchio. Riguarda solo il Task 9.
- **Niente emoji** nell'interfaccia.
- **Invariante "niente NaN senza il campo"**: ogni nuovo campo letto da `p` deve avere un default sensato quando assente (`p.fuelFactor` assente = serbatoio vuoto = 1). Gli strumenti offline (`f1LapSimulator.js`, `f1RaceLineOptimizer.js`) costruiscono giocatori a mano e non li popolano.
- **I modelli fisici non sanno che le stagioni esistono.** Nessuna funzione in `physics/` deve ricevere o consultare il formato della sessione.
- **Come si esegue un test**: `node --test backend/sockets/games/physics/NomeFile.test.js` dalla radice del repo. `npm test` non è configurato (`package.json` ha un placeholder che fallisce): non usarlo.
- **Come si esegue TUTTA la suite**: `node --test backend/` dalla radice.
- ⚠️ **Nella suite ci sono 3 test rossi preesistenti** (annotati in `project_f1_circuito_vivo`). Prima di iniziare, registrare l'elenco dei falliti con `node --test backend/ 2>&1 | grep "^not ok"` e confrontarlo alla fine: il criterio è "nessun NUOVO rosso", non "tutto verde".

---

### Task 1: Il danno smette di sparire in qualifica

Oggi la stessa condizione `isQuali` spegne due cose diverse: l'usura delle gomme (giusto — in qualifica le gomme sono nuove) e il danno alle componenti (residuo). Questo task toglie solo la seconda.

Dopo questo task, in gara veloce cambia una cosa sola: sbattere *durante* la qualifica si sente per il resto della qualifica. In griglia il danno si azzera comunque (`resetStatoAuto`), quindi la gara non è toccata.

**Files:**
- Modify: `backend/sockets/games/physics/PowertrainModel.js` (righe 31 e 58)
- Modify: `backend/sockets/games/physics/AerodynamicsModel.js` (riga 43, più i due rami dentro `dragFactor` e `downforceFactor`)
- Modify: `backend/sockets/games/physics/SteeringModel.js` (righe 42 e 48)
- Test: `backend/sockets/games/physics/DamageModel.test.js` (aggiunge test nuovi in fondo)

**Interfaces:**
- Consumes: niente (primo task).
- Produces: nessuna firma nuova. Cambia solo il comportamento di `effectiveMaxSpeed(p, isQuali)`, `effectiveAccel(p, isQuali)`, `effectiveGrip(p, isQuali, maxSpeed)`, `dragFactor(speedFrac, isQuali, damageParts)`, `downforceFactor(speedFrac, isQuali, damageParts)` e `applySteering(p, isQuali, maxSpeed)` quando `isQuali === true` e `p.damageParts` è popolato.

- [ ] **Step 1: Registrare i rossi preesistenti**

Run: `node --test backend/ 2>&1 | grep "^not ok"`

Salvare l'output in un file temporaneo per il confronto finale. Sono attesi 3 falliti preesistenti. Se ce ne sono di più, FERMARSI e segnalarlo: significa che il branch non è pulito e questo task non può essere verificato.

- [ ] **Step 2: Scrivere i test che falliscono**

Aggiungere in fondo a `backend/sockets/games/physics/DamageModel.test.js`:

```js
// ---- Il danno vale ANCHE in qualifica (2026-08-23) -------------------------
// Prima di questa modifica `isQuali` spegneva due cose insieme: l'usura delle
// gomme (giusto: in qualifica le gomme sono nuove) e il danno alle componenti
// (residuo). Questi test bloccano il ritorno della seconda: chi arriva al
// weekend con la macchina consumata la sente anche sul giro secco.
const PowertrainModel   = require('./PowertrainModel');
const AerodynamicsModel = require('./AerodynamicsModel');
const SteeringModel     = require('./SteeringModel');

function playerDanneggiato(parts) {
    return {
        speed: 2, angle: 0, vx: 0, vz: 2,
        inputs: { throttle: 0, brake: 0, steer: 1 },
        compound: 'medium', tyreWear: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0, ...parts },
    };
}

test('in qualifica il motore rotto toglie velocità massima', () => {
    const sano   = PowertrainModel.effectiveMaxSpeed(playerDanneggiato({}), true);
    const rotto  = PowertrainModel.effectiveMaxSpeed(playerDanneggiato({ engine: 100 }), true);
    assert.ok(rotto < sano, `atteso rotto < sano, ottenuto ${rotto} vs ${sano}`);
});

test('in qualifica il motore rotto toglie accelerazione', () => {
    const sano  = PowertrainModel.effectiveAccel(playerDanneggiato({}), true);
    const rotto = PowertrainModel.effectiveAccel(playerDanneggiato({ engine: 100 }), true);
    assert.ok(rotto < sano, `atteso rotto < sano, ottenuto ${rotto} vs ${sano}`);
});

test('in qualifica il fondo rotto cambia il grip', () => {
    const sano  = AerodynamicsModel.effectiveGrip(playerDanneggiato({}), true, 6.2);
    const rotto = AerodynamicsModel.effectiveGrip(playerDanneggiato({ floor: 100 }), true, 6.2);
    assert.notEqual(rotto, sano, 'il danno al fondo deve avere effetto anche in qualifica');
});

test('in qualifica l\'ala rotta aumenta la resistenza', () => {
    const parts = { frontWing: 100, floor: 0, engine: 0, suspension: 0 };
    const sano  = AerodynamicsModel.dragFactor(1, true, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
    const rotto = AerodynamicsModel.dragFactor(1, true, parts);
    assert.ok(rotto < sano, `atteso rotto < sano, ottenuto ${rotto} vs ${sano}`);
});

test('in qualifica il fondo rotto toglie deportanza', () => {
    const parts = { frontWing: 0, floor: 100, engine: 0, suspension: 0 };
    const sano  = AerodynamicsModel.downforceFactor(1, true, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
    const rotto = AerodynamicsModel.downforceFactor(1, true, parts);
    assert.ok(rotto < sano, `atteso rotto < sano, ottenuto ${rotto} vs ${sano}`);
});

test('in qualifica l\'ala rotta fa sterzare di meno', () => {
    const sano  = playerDanneggiato({});
    const rotto = playerDanneggiato({ frontWing: 100 });
    SteeringModel.applySteering(sano, true, 6.2);
    SteeringModel.applySteering(rotto, true, 6.2);
    assert.ok(Math.abs(rotto.angle) < Math.abs(sano.angle),
        `atteso meno sterzata da rotto, ottenuto ${rotto.angle} vs ${sano.angle}`);
});

test('in qualifica le sospensioni rotte sporcano lo sterzo', () => {
    // getSuspensionNoise è casuale: si confrontano 200 campioni e si guarda se
    // ALMENO UNO devia. Con rumore spento devierebbero zero volte.
    let deviato = 0;
    for (let i = 0; i < 200; i++) {
        const pulito = playerDanneggiato({});
        const rotto  = playerDanneggiato({ suspension: 100 });
        SteeringModel.applySteering(pulito, true, 6.2);
        SteeringModel.applySteering(rotto, true, 6.2);
        if (rotto.angle !== pulito.angle) deviato++;
    }
    assert.ok(deviato > 0, 'le sospensioni rotte devono sporcare lo sterzo anche in qualifica');
});
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/DamageModel.test.js`
Expected: FAIL — i 7 test nuovi falliscono (i valori "sano" e "rotto" coincidono, perché in qualifica il danno è spento).

- [ ] **Step 4: Togliere la soppressione, sito per sito**

In `backend/sockets/games/physics/PowertrainModel.js`, dentro `effectiveMaxSpeed` (riga 31):

```js
    const engineFactor = 1 - getEnginePowerPenalty(p.damageParts);
```

e dentro `effectiveAccel` (riga 58), identico:

```js
    const engineFactor = 1 - getEnginePowerPenalty(p.damageParts);
```

In `backend/sockets/games/physics/AerodynamicsModel.js`, dentro `effectiveGrip` (riga 43):

```js
    const floorFactor = 1 - getFloorGripPenalty(p.damageParts);
```

dentro `downforceFactor`:

```js
    if (isAeroDamageModelActive()) {
        factor *= 1 - getFloorDownforcePenalty(damageParts);
    }
```

dentro `dragFactor`:

```js
    if (isAeroDamageModelActive()) {
        factor *= 1 - getFrontWingDragPenalty(damageParts);
    }
```

In `backend/sockets/games/physics/SteeringModel.js`, dentro `applySteering` (righe 42 e 48):

```js
        const steerFactor = 1 - getFrontWingSteerPenalty(p.damageParts);
```
```js
        const suspensionNoise = getSuspensionNoise(p.damageParts);
```

- [ ] **Step 5: Aggiornare i commenti che spiegavano la vecchia regola**

Quattro commenti nel codice affermano l'esenzione appena rimossa e diventerebbero bugie. Sostituirli.

In `AerodynamicsModel.js`, sopra il ramo di `downforceFactor`:

```js
    // Fase 3: danno al fondo -> meno downforce. NON è più esente in
    // qualifica (2026-08-23): il danno vale sempre, perché in stagione al
    // giro secco si arriva con la macchina che si ha. Vedi
    // docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md.
```

In `AerodynamicsModel.js`, sopra il ramo di `dragFactor`:

```js
    // Fase 3: danno ala anteriore -> più drag. NON è più esente in qualifica
    // (2026-08-23), vedi downforceFactor sopra.
```

Sempre in `AerodynamicsModel.js`, nel commento di `downforceFactor` che comincia con «NON dipende da isQuali, stesso motivo di dragFactor», sostituire la frase finale «fenomeno fisico sempre presente, non un degrado ignorato in qualifica» con:

```js
// fenomeno fisico sempre presente. Da quando anche il danno vale in
// qualifica (2026-08-23), `isQuali` qui non è più letto affatto: resta
// nella firma per non toccare i tre chiamanti, e va tolto nel Task 2.
```

In `SteeringModel.js`, dentro il commento sopra `steerFactor`, aggiungere in coda:

```js
        // Dal 2026-08-23 vale anche in qualifica: in stagione al giro secco
        // si arriva con la macchina che si ha.
```

In `DamageModel.js`, il commento di intestazione (righe 39-42) elenca i quattro componenti; aggiungere sotto:

```js
// Nessuna di queste penalità è esente in qualifica (dal 2026-08-23): chi
// decide se c'è danno è chi riempie damageParts, non la formula.
```

- [ ] **Step 6: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/DamageModel.test.js`
Expected: PASS, tutti.

- [ ] **Step 7: Verificare che nessun test esistente sia diventato rosso**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: lo STESSO elenco dello Step 1, né uno di più.

Se compare un rosso nuovo, leggerlo: se asserisce esplicitamente che in qualifica il danno non ha effetto, è un test che codificava la vecchia regola e va aggiornato (cambiando l'asserzione, non cancellando il test). Se asserisce altro, FERMARSI: è una regressione vera.

- [ ] **Step 8: Commit**

```bash
git add backend/sockets/games/physics/PowertrainModel.js backend/sockets/games/physics/AerodynamicsModel.js backend/sockets/games/physics/SteeringModel.js backend/sockets/games/physics/DamageModel.js backend/sockets/games/physics/DamageModel.test.js
git commit -m "Il danno non sparisce piu' in qualifica

isQuali spegneva due cose diverse con la stessa condizione: le gomme
nuove (giusto) e il danno alle componenti (residuo). Serve per le
stagioni, dove al giro secco si arriva con la macchina che si ha - ma
la regola giusta non e' 'tranne in stagione': e' che chi decide se c'e'
danno e' chi riempie damageParts, non la formula.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Togliere `isQuali` dalle due funzioni aero che non lo leggono più

Dopo il Task 1, `dragFactor` e `downforceFactor` ricevono `isQuali` e non lo usano. Un parametro che sembra significativo e non lo è, in mezzo a una firma posizionale, è una trappola: chi un giorno chiamasse `dragFactor(frac, damageParts)` non avrebbe nessun errore, solo un risultato sbagliato.

**Files:**
- Modify: `backend/sockets/games/physics/AerodynamicsModel.js` (firme di `dragFactor` e `downforceFactor`, più i tre chiamanti)
- Modify: `backend/sockets/games/physics/PowertrainModel.js` (chiamata a `dragFactor`)
- Modify: `backend/sockets/games/physics/CorneringGripModel.js` (chiamata a `downforceFactor`)
- Test: `backend/sockets/games/physics/AerodynamicsModel.test.js`

**Interfaces:**
- Consumes: il comportamento del Task 1.
- Produces: firme nuove — `dragFactor(speedFrac, damageParts)` e `downforceFactor(speedFrac, damageParts)`. Nessun altro task di questo piano le chiama.

- [ ] **Step 1: Trovare tutti i chiamanti**

Run: `grep -rn "dragFactor(\|downforceFactor(" backend/ --include=*.js | grep -v node_modules`

Attesi: la definizione e l'export in `AerodynamicsModel.js`, la chiamata in `PowertrainModel.js` (dentro `effectiveMaxSpeed`), la chiamata in `AerodynamicsModel.effectiveGrip`, la chiamata in `CorneringGripModel.corneringCapacity`, più i test. Se ne compaiono altri, aggiornare anche quelli.

- [ ] **Step 2: Scrivere il test che falliscono**

Aggiungere in fondo a `backend/sockets/games/physics/AerodynamicsModel.test.js`:

```js
// La firma non ha più isQuali (2026-08-23): dopo che il danno vale anche in
// qualifica, quel parametro non veniva più letto da nessuna delle due, e una
// firma posizionale con un buco in mezzo è una trappola silenziosa.
test('dragFactor accetta (speedFrac, damageParts) e legge il danno', () => {
    const sano  = AerodynamicsModel.dragFactor(1, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
    const rotto = AerodynamicsModel.dragFactor(1, { frontWing: 100, floor: 0, engine: 0, suspension: 0 });
    assert.ok(rotto < sano, `atteso rotto < sano, ottenuto ${rotto} vs ${sano}`);
});

test('downforceFactor accetta (speedFrac, damageParts) e legge il danno', () => {
    const sano  = AerodynamicsModel.downforceFactor(1, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
    const rotto = AerodynamicsModel.downforceFactor(1, { frontWing: 0, floor: 100, engine: 0, suspension: 0 });
    assert.ok(rotto < sano, `atteso rotto < sano, ottenuto ${rotto} vs ${sano}`);
});
```

Nota: se il file di test non importa già `AerodynamicsModel` come oggetto intero, aggiungere in cima `const AerodynamicsModel = require('./AerodynamicsModel');`.

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/AerodynamicsModel.test.js`
Expected: FAIL — passando `damageParts` nella posizione di `isQuali`, il terzo argomento è `undefined` e le penalità non si applicano, quindi `rotto === sano`.

- [ ] **Step 4: Cambiare le due firme**

In `backend/sockets/games/physics/AerodynamicsModel.js`:

```js
function downforceFactor(speedFrac, damageParts) {
    const frac = Math.max(0, Math.min(1, speedFrac));
    let factor = 1 + Math.pow(frac, DOWNFORCE_EXPONENT) * DOWNFORCE_CAPACITY_BONUS_MAX;
    // Fase 3: danno al fondo -> meno downforce. NON è più esente in
    // qualifica (2026-08-23), vedi la spec dell'economia della gara.
    if (isAeroDamageModelActive()) {
        factor *= 1 - getFloorDownforcePenalty(damageParts);
    }
    return factor;
}
```

```js
function dragFactor(speedFrac, damageParts) {
    const frac = Math.max(0, Math.min(1, speedFrac));
    let factor = 1 - Math.pow(frac, DRAG_EXPONENT) * DRAG_TOP_SPEED_PENALTY_MAX;
    // Fase 3: danno ala anteriore -> più drag. NON è più esente in qualifica
    // (2026-08-23), vedi downforceFactor sopra.
    if (isAeroDamageModelActive()) {
        factor *= 1 - getFrontWingDragPenalty(damageParts);
    }
    return factor;
}
```

- [ ] **Step 5: Aggiornare i tre chiamanti**

In `AerodynamicsModel.effectiveGrip`:

```js
        grip /= downforceFactor(speedFrac, p.damageParts);
```

In `PowertrainModel.effectiveMaxSpeed`:

```js
        maxSpeed *= AerodynamicsModel.dragFactor(speedFrac, p.damageParts);
```

In `CorneringGripModel.corneringCapacity`:

```js
        capacity *= AerodynamicsModel.downforceFactor(speedFrac, p.damageParts);
```

- [ ] **Step 6: Aggiornare i test esistenti che usano la vecchia firma**

Run: `grep -rn "dragFactor(\|downforceFactor(" backend/sockets/games/physics/*.test.js`

Per ognuno, togliere l'argomento `isQuali` in mezzo. Un test che verificava proprio l'esenzione in qualifica (`dragFactor(x, true, parts)` uguale a nessuna penalità) va **riscritto per asserire il contrario**, non cancellato: quella riga documenta una decisione, e ora la decisione è opposta.

- [ ] **Step 7: Eseguire tutta la suite**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: lo stesso elenco del Task 1 Step 1.

- [ ] **Step 8: Commit**

```bash
git add backend/sockets/games/physics/AerodynamicsModel.js backend/sockets/games/physics/AerodynamicsModel.test.js backend/sockets/games/physics/PowertrainModel.js backend/sockets/games/physics/CorneringGripModel.js
git commit -m "Aero: via isQuali dalle firme che non lo leggevano piu'

Dopo che il danno vale anche in qualifica, dragFactor e downforceFactor
ricevevano un parametro che nessuno dei due usava. In una firma
posizionale un buco in mezzo non da' errore: da' un risultato sbagliato.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `FuelModel` — il peso del carburante come modello puro

Un modulo nuovo che possiede il dominio "quanto pesa l'auto adesso", nello stesso stile di `TyreModel`/`DamageModel`: solo formule, nessuno stato, nessuna conoscenza di gare o stagioni.

**Files:**
- Create: `backend/sockets/games/physics/FuelModel.js`
- Test: `backend/sockets/games/physics/FuelModel.test.js`

**Interfaces:**
- Consumes: niente.
- Produces:
  - `FUEL_MASS_AT_START` (number, 1.08)
  - `FUEL_CORNERING_SHARE` (number, 0.5)
  - `fuelFactorFor(lap, totalLaps) -> number` in [1, 1.08]
  - `fuelFactorOf(p) -> number` in [1, 1.08] — legge `p.fuelFactor`, 1 se assente
  - `fuelCorneringFactor(p) -> number` in [1, 1.04]

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `backend/sockets/games/physics/FuelModel.test.js`:

```js
// backend/sockets/games/physics/FuelModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    FUEL_MASS_AT_START, FUEL_CORNERING_SHARE,
    fuelFactorFor, fuelFactorOf, fuelCorneringFactor
} = require('./FuelModel.js');

const vicino = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: atteso ${b}, ottenuto ${a}`);

test('fuelFactorFor: al via il serbatoio e\' pieno', () => {
    vicino(fuelFactorFor(0, 10), FUEL_MASS_AT_START, 'giro 0 su 10');
});

test('fuelFactorFor: all\'ultimo giro il serbatoio e\' vuoto', () => {
    vicino(fuelFactorFor(10, 10), 1, 'giro 10 su 10');
});

test('fuelFactorFor: a meta\' gara pesa meta\' del pieno', () => {
    vicino(fuelFactorFor(5, 10), 1 + (FUEL_MASS_AT_START - 1) / 2, 'giro 5 su 10');
});

test('fuelFactorFor: oltre l\'ultimo giro resta vuoto, non va sotto 1', () => {
    // Il giro di rientro dopo la bandiera: p.lap puo' superare totalLaps.
    vicino(fuelFactorFor(20, 10), 1, 'giro 20 su 10');
});

test('fuelFactorFor: giro negativo o totalLaps assurdo non produce NaN', () => {
    vicino(fuelFactorFor(-3, 10), FUEL_MASS_AT_START, 'giro negativo');
    vicino(fuelFactorFor(0, 0), FUEL_MASS_AT_START, 'zero giri totali');
    vicino(fuelFactorFor(undefined, undefined), FUEL_MASS_AT_START, 'tutto assente');
});

test('fuelFactorOf: senza il campo l\'auto e\' scarica', () => {
    // INVARIANTE: gli strumenti offline costruiscono giocatori a mano e non
    // popolano fuelFactor. Serbatoio vuoto e' l'unica lettura sensata, ed e'
    // anche quella che tiene il comportamento identico a prima del carburante.
    vicino(fuelFactorOf({}), 1, 'oggetto vuoto');
    vicino(fuelFactorOf(undefined), 1, 'player assente');
    vicino(fuelFactorOf({ fuelFactor: null }), 1, 'campo nullo');
    vicino(fuelFactorOf({ fuelFactor: NaN }), 1, 'campo NaN');
});

test('fuelFactorOf: col campo restituisce il campo', () => {
    vicino(fuelFactorOf({ fuelFactor: 1.05 }), 1.05, 'campo valido');
});

test('fuelFactorOf: un valore sotto 1 non alleggerisce l\'auto oltre il vuoto', () => {
    vicino(fuelFactorOf({ fuelFactor: 0.5 }), 1, 'campo assurdo');
});

test('fuelCorneringFactor: in curva il peso conta la meta\'', () => {
    const pieno = { fuelFactor: FUEL_MASS_AT_START };
    const atteso = 1 + (FUEL_MASS_AT_START - 1) * FUEL_CORNERING_SHARE;
    vicino(fuelCorneringFactor(pieno), atteso, 'auto piena');
    vicino(fuelCorneringFactor({}), 1, 'auto scarica');
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test backend/sockets/games/physics/FuelModel.test.js`
Expected: FAIL con "Cannot find module './FuelModel.js'".

- [ ] **Step 3: Scrivere il modello**

Creare `backend/sockets/games/physics/FuelModel.js`:

```js
// backend/sockets/games/physics/FuelModel.js
//
// Fuel Model: quanto pesa l'auto adesso. Rif.
// docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md.
//
// Una F1 vera parte con ~110 kg di benzina su ~798 kg di peso minimo: il 14%
// di massa in piu', che vale piu' di 3 secondi al giro — piu' del degrado
// gomme. Qui il valore e' ridotto perche' la fisica e' arcade: si parte
// dall'8% e si tara. Il primo parametro da toccare e' FUEL_CORNERING_SHARE.
//
// PROPRIETA' EMERGENTE, da NON programmare: l'auto si alleggerisce mentre la
// gomma si consuma, e le due cose in buona parte si annullano. E' il motivo
// per cui in F1 i tempi sul giro restano piatti nonostante tutto peggiori. Se
// emerge, e' giusto.
//
// Questo modulo non sa se si sta correndo una gara veloce o una tappa di
// campionato, e non deve saperlo: legge `p.fuelFactor` e basta. Chi lo riempie
// e' il tick, in un punto solo (f1GameSocket.js::tickGame).
const FUEL_MASS_AT_START = 1.08;

// Quanta parte del peso si sente in CURVA. A forza piena il primo giro
// diventa ingiocabile: 8% di capacita' laterale in meno al via e' molto piu'
// di quanto sembri leggendo il numero. Vedi la nota della spec su come si
// misura un flag di guida — in curva, mai sul tempo sul giro.
const FUEL_CORNERING_SHARE = 0.5;

// Dal pieno (al via) al vuoto (alla bandiera), lineare sui giri percorsi.
// L'avanzamento e' quello DI QUEL PILOTA, non della gara: la benzina la
// consuma chi guida, e un doppiato non puo' essere leggero come chi lo ha
// doppiato.
//
// `lap` puo' superare `totalLaps` nel giro di rientro dopo la bandiera, e
// `totalLaps` puo' arrivare a 0 o assente da un game costruito a mano: in
// entrambi i casi si limita invece di produrre NaN, che da qui arriverebbe
// fino a p.angle e farebbe sparire l'auto dal tracciato (stessa trappola gia'
// documentata in TyreModel.getWearPenaltyFactor).
function fuelFactorFor(lap, totalLaps) {
    const giri = Math.max(1, totalLaps || 1);
    const percorso = Math.max(0, Math.min(1, (lap || 0) / giri));
    return 1 + (FUEL_MASS_AT_START - 1) * (1 - percorso);
}

// INVARIANTE "niente NaN senza il campo", lo stesso di p.damageParts e
// p.tyreWear: un giocatore senza `fuelFactor` e' un giocatore a serbatoio
// vuoto. E' cio' che tiene in piedi gli strumenti offline (f1LapSimulator,
// f1RaceLineOptimizer), che costruiscono i loro giocatori a mano, e cio' che
// rende il carburante invisibile alla qualifica senza nessun ramo su isQuali.
function fuelFactorOf(p) {
    const f = p && p.fuelFactor;
    if (typeof f !== 'number' || !Number.isFinite(f) || f < 1) return 1;
    return Math.min(f, FUEL_MASS_AT_START);
}

function fuelCorneringFactor(p) {
    return 1 + (fuelFactorOf(p) - 1) * FUEL_CORNERING_SHARE;
}

module.exports = {
    FUEL_MASS_AT_START, FUEL_CORNERING_SHARE,
    fuelFactorFor, fuelFactorOf, fuelCorneringFactor
};
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `node --test backend/sockets/games/physics/FuelModel.test.js`
Expected: PASS, tutti e 9.

- [ ] **Step 5: Commit**

```bash
git add backend/sockets/games/physics/FuelModel.js backend/sockets/games/physics/FuelModel.test.js
git commit -m "FuelModel: quanto pesa l'auto adesso

Solo formule. Il fattore viaggia sul giocatore (p.fuelFactor) invece che
nelle firme, cosi' nessun modello cambia interfaccia e il bot eredita il
peso senza toccarlo. Campo assente = serbatoio vuoto: e' cio' che tiene
in piedi gli strumenti offline e che rende il carburante invisibile alla
qualifica senza nessun ramo su isQuali.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: L'auto pesante accelera peggio, frena peggio e gira meno

Quattro agganci. Nessuna firma cambia: tutte queste funzioni ricevono già `p`.

Il terzo aggancio merita una riga di spiegazione, perché la spec l'ha corretto in corso d'opera: il posto dove «l'auto gira di meno» è **`turnRate` in `applySteering`** — lo stesso identico meccanismo del sottosterzo da ala rotta. `corneringCapacity` da solo non basterebbe: il suo unico consumatore nella fisica sta dietro `F1_CORNERING_GRIP_MODEL`, che è spento di default, quindi arriverebbe solo alla prudenza del bot. Servono entrambi, e non si sommano fra loro: `corneringCapacity` serve al bot per **decidere** quanto frenare, `turnRate` **esegue** la sterzata.

**Files:**
- Modify: `backend/sockets/games/physics/PowertrainModel.js` (`effectiveAccel`)
- Modify: `backend/sockets/games/physics/BrakingModel.js` (`effectiveBrakeMult`)
- Modify: `backend/sockets/games/physics/SteeringModel.js` (`applySteering`)
- Modify: `backend/sockets/games/physics/CorneringGripModel.js` (`corneringCapacity`)
- Test: `backend/sockets/games/physics/FuelModel.test.js` (sezione nuova in fondo)

**Interfaces:**
- Consumes: `fuelFactorOf(p)` e `fuelCorneringFactor(p)` dal Task 3.
- Produces: nessuna firma nuova.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in fondo a `backend/sockets/games/physics/FuelModel.test.js`:

```js
// ---- Gli agganci: dove il peso si sente davvero ----------------------------
const PowertrainModel    = require('./PowertrainModel');
const BrakingModel       = require('./BrakingModel');
const SteeringModel      = require('./SteeringModel');
const CorneringGripModel = require('./CorneringGripModel');

function auto(fuelFactor) {
    const p = {
        speed: 3, angle: 0, vx: 0, vz: 3,
        inputs: { throttle: 1, brake: 0, steer: 1 },
        compound: 'medium', tyreWear: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
    };
    if (fuelFactor !== undefined) p.fuelFactor = fuelFactor;
    return p;
}

test('aggancio: l\'auto piena accelera meno', () => {
    const scarica = PowertrainModel.effectiveAccel(auto(), false);
    const piena   = PowertrainModel.effectiveAccel(auto(FUEL_MASS_AT_START), false);
    assert.ok(piena < scarica, `atteso piena < scarica, ottenuto ${piena} vs ${scarica}`);
});

test('aggancio: l\'auto piena frena meno', () => {
    const scarica = BrakingModel.effectiveBrakeMult(auto(), false);
    const piena   = BrakingModel.effectiveBrakeMult(auto(FUEL_MASS_AT_START), false);
    assert.ok(piena < scarica, `atteso piena < scarica, ottenuto ${piena} vs ${scarica}`);
});

test('aggancio: l\'auto piena gira meno', () => {
    const scarica = auto();
    const piena   = auto(FUEL_MASS_AT_START);
    SteeringModel.applySteering(scarica, false, 6.2);
    SteeringModel.applySteering(piena, false, 6.2);
    assert.ok(Math.abs(piena.angle) < Math.abs(scarica.angle),
        `atteso meno sterzata da piena, ottenuto ${piena.angle} vs ${scarica.angle}`);
});

test('aggancio: l\'auto piena ha meno capacita\' laterale (e il bot lo sa)', () => {
    const scarica = CorneringGripModel.corneringCapacity(auto(), false, 6.2);
    const piena   = CorneringGripModel.corneringCapacity(auto(FUEL_MASS_AT_START), false, 6.2);
    assert.ok(piena < scarica, `atteso piena < scarica, ottenuto ${piena} vs ${scarica}`);
});

test('aggancio: in curva il peso pesa META\' di quanto pesa in rettilineo', () => {
    // Non e' un dettaglio di taratura, e' la scelta che rende giocabile il
    // primo giro: se un giorno i due effetti coincidono, qualcuno ha tolto
    // FUEL_CORNERING_SHARE senza accorgersene.
    const pieno = { fuelFactor: FUEL_MASS_AT_START };
    const rettilineo = fuelFactorOf(pieno) - 1;
    const curva      = fuelCorneringFactor(pieno) - 1;
    vicino(curva, rettilineo * FUEL_CORNERING_SHARE, 'quota in curva');
    assert.ok(curva < rettilineo, 'in curva il peso deve pesare meno che in rettilineo');
});

test('aggancio: senza fuelFactor il comportamento e\' identico a prima', () => {
    // La garanzia di non-regressione per gare veloci, qualifica e strumenti
    // offline: un giocatore che non ha il campo non deve vedere NULLA di
    // diverso da prima del carburante.
    const senza = auto();
    const uno   = auto(1);
    assert.equal(PowertrainModel.effectiveAccel(senza, false), PowertrainModel.effectiveAccel(uno, false));
    assert.equal(BrakingModel.effectiveBrakeMult(senza, false), BrakingModel.effectiveBrakeMult(uno, false));
    assert.equal(
        CorneringGripModel.corneringCapacity(senza, false, 6.2),
        CorneringGripModel.corneringCapacity(uno, false, 6.2)
    );
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/FuelModel.test.js`
Expected: FAIL — i primi quattro agganci danno valori identici (il peso non è ancora collegato). L'ultimo ("identico a prima") passa già: è il test di non-regressione, deve restare verde per tutto il task.

- [ ] **Step 3: Collegare accelerazione e frenata**

In `backend/sockets/games/physics/PowertrainModel.js`, in cima con gli altri require:

```js
const { fuelFactorOf } = require('./FuelModel');
```

e in `effectiveAccel`:

```js
function effectiveAccel(p, isQuali) {
    const wearFactor   = tractionFactor(p.tyreWear, isQuali);
    const engineFactor = 1 - getEnginePowerPenalty(p.damageParts);
    // Peso del carburante: piu' massa, meno accelerazione. Si DIVIDE perche'
    // fuelFactorOf cresce sopra 1 col serbatoio pieno.
    return ACCEL * wearFactor * engineFactor / fuelFactorOf(p);
}
```

In `backend/sockets/games/physics/BrakingModel.js`, in cima:

```js
const { fuelFactorOf } = require('./FuelModel');
```

e:

```js
function effectiveBrakeMult(p, isQuali) {
    const wearFactor = brakingFactor(p.tyreWear, isQuali);
    // Peso del carburante: piu' massa, spazio d'arresto piu' lungo.
    return BRAKE_MULT * wearFactor / fuelFactorOf(p);
}
```

- [ ] **Step 4: Collegare la curva, in tutti e due i posti**

In `backend/sockets/games/physics/SteeringModel.js`, in cima:

```js
const { fuelCorneringFactor } = require('./FuelModel');
```

e dentro `applySteering`, subito dopo il calcolo di `turnRate`:

```js
        let turnRate = (TURN_SPEED_LOW + (TURN_SPEED_HIGH - TURN_SPEED_LOW) * speedFrac) * steerFactor;
        // Peso del carburante: l'auto piena sottosterza. Sta QUI e non in
        // effectiveGrip perche' questo e' il posto dove "l'auto gira di meno"
        // ha un significato non ambiguo — e' lo stesso meccanismo del
        // sottosterzo da ala rotta, due righe sopra. In curva il peso conta
        // la meta' (FUEL_CORNERING_SHARE): vedi FuelModel.js.
        turnRate /= fuelCorneringFactor(p);
```

In `backend/sockets/games/physics/CorneringGripModel.js`, in cima:

```js
const { fuelCorneringFactor } = require('./FuelModel');
```

e dentro `corneringCapacity`, prima del `return`:

```js
    // Peso del carburante: l'auto piena ha meno capacita' laterale
    // disponibile. Consumatore INDIPENDENTE dallo stesso fatto fisico
    // agganciato in SteeringModel.turnRate — nessun doppio conteggio: qui il
    // bot DECIDE quanto frenare per la curva, li' la sterzata si ESEGUE.
    // Stessa separazione gia' documentata per downforceFactor.
    capacity /= fuelCorneringFactor(p);
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/FuelModel.test.js`
Expected: PASS, tutti e 15.

- [ ] **Step 6: Verificare che nessun test esistente sia diventato rosso**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: lo stesso elenco del Task 1 Step 1. Nessun giocatore esistente ha `fuelFactor`, quindi tutto deve restare identico.

- [ ] **Step 7: Commit**

```bash
git add backend/sockets/games/physics/PowertrainModel.js backend/sockets/games/physics/BrakingModel.js backend/sockets/games/physics/SteeringModel.js backend/sockets/games/physics/CorneringGripModel.js backend/sockets/games/physics/FuelModel.test.js
git commit -m "Il peso del carburante entra nella fisica

Quattro agganci, nessuna firma cambiata. In curva il peso vale la meta':
a forza piena il primo giro diventa ingiocabile.

La curva ha DUE agganci e nessuno dei due e' effectiveGrip. turnRate e'
il posto dove 'l'auto gira di meno' non e' ambiguo - e' lo stesso
meccanismo del sottosterzo da ala rotta. corneringCapacity da solo non
sarebbe bastato: il suo consumatore nella fisica sta dietro un flag
spento, quindi arriverebbe solo alla prudenza del bot.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: L'auto pesante consuma piu' gomma

**Files:**
- Modify: `backend/sockets/games/physics/TyreModel.js` (`applyTyreWear`)
- Test: `backend/sockets/games/physics/TyreModel.test.js`

**Interfaces:**
- Consumes: `fuelFactorOf(p)` dal Task 3.
- Produces: nessuna firma nuova. `applyTyreWear(p, offTrack, track)` resta identica.

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungere in fondo a `backend/sockets/games/physics/TyreModel.test.js`:

```js
// L'auto piena mangia piu' gomma: e' la ragione fisica per cui il primo stint
// e' il piu' duro, e insieme all'alleggerimento produce da sola la piattezza
// dei tempi sul giro (vedi FuelModel.js). Non va programmata, va lasciata
// emergere.
test('applyTyreWear: l\'auto piena consuma piu\' dell\'auto scarica', () => {
    const track = { lapLength: 1000 };
    const base = () => ({ vx: 0, vz: 10, tyreWear: 0, compound: 'medium' });
    const scarica = base();
    const piena = { ...base(), fuelFactor: 1.08 };
    applyTyreWear(scarica, false, track);
    applyTyreWear(piena, false, track);
    assert.ok(piena.tyreWear > scarica.tyreWear,
        `attesa piu' usura da piena, ottenuto ${piena.tyreWear} vs ${scarica.tyreWear}`);
});

test('applyTyreWear: senza fuelFactor il consumo e\' identico a prima', () => {
    const track = { lapLength: 1000 };
    const senza = { vx: 0, vz: 10, tyreWear: 0, compound: 'medium' };
    const uno   = { vx: 0, vz: 10, tyreWear: 0, compound: 'medium', fuelFactor: 1 };
    applyTyreWear(senza, false, track);
    applyTyreWear(uno, false, track);
    assert.equal(senza.tyreWear, uno.tyreWear);
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test backend/sockets/games/physics/TyreModel.test.js`
Expected: FAIL sul primo test nuovo (`piena.tyreWear` uguale a `scarica.tyreWear`); il secondo passa già.

- [ ] **Step 3: Collegare il peso al consumo**

In `backend/sockets/games/physics/TyreModel.js`, in cima con gli altri require:

```js
const { fuelFactorOf } = require('./FuelModel');
```

e in `applyTyreWear`:

```js
function applyTyreWear(p, offTrack, track) {
    const dist = Math.hypot(p.vx, p.vz);   // distanza percorsa in questo tick
    const wearPerUnitDist = 100 / (WEAR_LAPS_AT_MEDIUM * track.lapLength);
    // Peso del carburante: l'auto piena carica di piu' le gomme e le consuma
    // di piu'. E' la ragione fisica per cui il primo stint e' il piu' duro.
    const wear = dist * wearPerUnitDist * tyreOf(p).wearRate * fuelFactorOf(p);
    p.tyreWear = Math.min(100, p.tyreWear + wear);
    if (offTrack) p.tyreWear = Math.min(100, p.tyreWear + WEAR_OFFTRACK_EXTRA);
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/TyreModel.test.js`
Expected: PASS, tutti.

- [ ] **Step 5: Commit**

```bash
git add backend/sockets/games/physics/TyreModel.js backend/sockets/games/physics/TyreModel.test.js
git commit -m "L'auto piena mangia piu' gomma

Insieme all'alleggerimento produce da sola la piattezza dei tempi sul
giro della F1 vera: il peso cala mentre la gomma peggiora, e le due cose
in buona parte si annullano. Emerge, non e' programmata.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Il tick riempie `p.fuelFactor`

Fin qui il peso esiste ma nessuno lo alza mai: tutte le auto sono scariche. Questo task è il punto — **uno solo** — che decide quanta benzina c'è a bordo.

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (import in cima, e il ciclo `for (const p of racing)` che chiama `updateVelocity`, intorno a riga 1908-1918)
- Test: `backend/sockets/games/f1GameSocket.carburante.test.js` (nuovo)

**Interfaces:**
- Consumes: `fuelFactorFor(lap, totalLaps)` dal Task 3.
- Produces: `p.fuelFactor` popolato su ogni giocatore che corre, ad ogni tick. Il Task 7 (banco) lo imposta a mano, il Task 9 non lo tocca.

- [ ] **Step 1: Capire dove si aggancia**

Run: `grep -n "updateVelocity(p, isQuali, slipstreamMult)" backend/sockets/games/f1GameSocket.js`

Attesa: una sola occorrenza, dentro `for (const p of racing) { ... }` in `tickGame`. Poco sopra, nella stessa funzione, esistono già `const isQuali = game.phase === 'qualifying';` e `const totalLaps = isQuali ? 1 : game.track.totalLaps;`.

⚠️ Nota: `totalLaps` vale **1** in qualifica. Non va usato per il carburante — in qualifica il serbatoio è vuoto per definizione, e usare quel valore darebbe un'auto piena al primo giro secco.

- [ ] **Step 2: Scrivere il test che fallisce**

Creare `backend/sockets/games/f1GameSocket.carburante.test.js`:

```js
// backend/sockets/games/f1GameSocket.carburante.test.js
//
// Chi riempie il serbatoio. C'e' UN SOLO punto che decide quanta benzina ha
// a bordo un'auto, ed e' il tick: i modelli fisici leggono p.fuelFactor e
// non sanno ne' che formato di gara si sta correndo ne' che esistono le
// stagioni. Questi test proteggono quell'unicita'.
const test = require('node:test');
const assert = require('node:assert/strict');
// f1GameSocket esporta sotto `physics`, non piatto: vedi `module.exports.physics`
// in fondo al file, dove stanno gia' assignGridSpawns, checkLap e compagnia.
const { aggiornaCarburante } = require('./f1GameSocket.js').physics;
const { FUEL_MASS_AT_START } = require('./physics/FuelModel.js');

const vicino = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: atteso ${b}, ottenuto ${a}`);

test('in gara, al via il serbatoio e\' pieno', () => {
    const p = { lap: 0 };
    aggiornaCarburante(p, false, 10);
    vicino(p.fuelFactor, FUEL_MASS_AT_START, 'giro 0');
});

test('in gara, all\'ultimo giro il serbatoio e\' vuoto', () => {
    const p = { lap: 10 };
    aggiornaCarburante(p, false, 10);
    vicino(p.fuelFactor, 1, 'giro 10');
});

test('in qualifica il serbatoio e\' sempre vuoto', () => {
    // In qualifica totalLaps vale 1: usarlo darebbe un'auto PIENA sul giro
    // secco, l'esatto contrario di come si corre una qualifica.
    const p = { lap: 0 };
    aggiornaCarburante(p, true, 1);
    vicino(p.fuelFactor, 1, 'qualifica');
});

test('ogni pilota ha il SUO carburante, non quello della gara', () => {
    // Un doppiato non puo' essere leggero come chi lo ha doppiato.
    const avanti  = { lap: 8 };
    const doppiato = { lap: 4 };
    aggiornaCarburante(avanti, false, 10);
    aggiornaCarburante(doppiato, false, 10);
    assert.ok(doppiato.fuelFactor > avanti.fuelFactor,
        `il doppiato deve essere piu' pesante, ottenuto ${doppiato.fuelFactor} vs ${avanti.fuelFactor}`);
});
```

- [ ] **Step 3: Eseguire il test e verificare che fallisca**

Run: `node --test backend/sockets/games/f1GameSocket.carburante.test.js`
Expected: FAIL — `aggiornaCarburante is not a function`.

- [ ] **Step 4: Scrivere la funzione e chiamarla nel tick**

In `backend/sockets/games/f1GameSocket.js`, aggiungere `fuelFactorFor` all'import dei moduli di fisica (vicino agli altri require di `./physics/...`):

```js
const { fuelFactorFor } = require('./physics/FuelModel');
```

Poi, **subito prima** della definizione di `tickGame` (o comunque a livello di modulo, non dentro un'altra funzione), aggiungere:

```js
// L'UNICO punto che decide quanta benzina ha a bordo un'auto. I modelli
// fisici leggono p.fuelFactor e non sanno ne' che formato di gara si sta
// correndo ne' che esistono le stagioni: e' questa asimmetria che tiene
// pulita la fisica (Rif.
// docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md).
//
// In qualifica il serbatoio e' vuoto per definizione — e NON si passa da
// totalLaps, che li' vale 1 e darebbe un'auto piena sul giro secco.
function aggiornaCarburante(p, isQuali, totalLaps) {
    p.fuelFactor = isQuali ? 1 : fuelFactorFor(p.lap, totalLaps);
}
```

Dentro `tickGame`, nel ciclo che chiama `updateVelocity`, aggiungere la chiamata **prima** di `updateVelocity`:

```js
    for (const p of racing) {
        let slipstreamMult = 1;
        if (!isQuali) {
            const ahead = nearestAheadPlayer(p, players, game.track);
            if (ahead && ahead.gapM < SLIPSTREAM_RANGE_M) {
                slipstreamMult = computeSlipstreamMult(ahead.gapM);
                p.inSlipstream = true;   // solo per il badge/effetto visivo lato client, vedi buildPublicState
            }
        }
        aggiornaCarburante(p, isQuali, game.track.totalLaps);
        updateVelocity(p, isQuali, slipstreamMult);
    }
```

⚠️ Si passa `game.track.totalLaps`, **non** la variabile locale `totalLaps` della funzione: quella vale 1 in qualifica.

Infine, esportare la funzione. In fondo al file c'è `module.exports.physics = { ... }` (export **namespaced**, non piatto): aggiungere `aggiornaCarburante` lì dentro, accanto a `assignGridSpawns` e `checkLap`.

- [ ] **Step 5: Eseguire il test e verificare che passi**

Run: `node --test backend/sockets/games/f1GameSocket.carburante.test.js`
Expected: PASS, tutti e 4.

- [ ] **Step 6: Verificare che nessun test esistente sia diventato rosso**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: lo stesso elenco del Task 1 Step 1.

⚠️ Se `f1GameSocket.exports.test.js` diventa rosso, controllarlo: verifica l'elenco degli export. Aggiungere `aggiornaCarburante` alla sua lista attesa.

- [ ] **Step 7: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js backend/sockets/games/f1GameSocket.carburante.test.js
git commit -m "Il tick riempie il serbatoio

Un punto solo decide quanta benzina c'e' a bordo. I modelli fisici
leggono p.fuelFactor e non sanno che formato di gara si sta correndo:
e' questa asimmetria che tiene la fisica fuori dalle stagioni.

In qualifica il serbatoio e' vuoto, e non si passa da totalLaps - li'
vale 1 e darebbe un'auto piena sul giro secco.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Il banco puo' pesare l'auto, e si misura il peso in curva

Senza questo task il peso non è verificabile: `f1LapSimulator` gira sempre in modalità qualifica (`updateVelocity(p, true, 1)`, riga 69) e costruisce giocatori senza `fuelFactor`, quindi misurerebbe sempre un'auto scarica.

Il carburante non ramifica su `isQuali` proprio per questo: basta popolare il campo.

**Files:**
- Modify: `backend/tools/f1LapSimulator.js` (`makeSimPlayer`, `parseArgs`, la stampa di `runOne`)
- Test: `backend/tools/f1LapSimulator.test.js`

**Interfaces:**
- Consumes: `p.fuelFactor` letto dai modelli (Task 4 e 5).
- Produces: opzione CLI `--fuel=<n>`, campo `opts.fuelFactor` accettato da `simulateLap`.

- [ ] **Step 1: Leggere come si passano le opzioni oggi**

Run: `sed -n '160,200p' backend/tools/f1LapSimulator.js`

Serve a vedere la forma esatta di `parseArgs` e di `runOne` prima di estenderle: il piano non le riscrive, le estende.

- [ ] **Step 2: Scrivere il test che fallisce**

Aggiungere in fondo a `backend/tools/f1LapSimulator.test.js`:

```js
// Il banco deve poter pesare l'auto, altrimenti il peso del carburante non e'
// misurabile: simulateLap gira in modalita' qualifica, e li' il tick di gara
// non arriva mai a riempire il serbatoio.
test('parseArgs: --fuel finisce in opts.fuelFactor', () => {
    const args = parseArgs(['--fuel=1.08']);
    assert.equal(args.fuelFactor, 1.08);
});

test('parseArgs: senza --fuel il campo resta assente (auto scarica)', () => {
    const args = parseArgs([]);
    assert.ok(args.fuelFactor === undefined || args.fuelFactor === 1,
        `atteso assente o 1, ottenuto ${args.fuelFactor}`);
});
```

- [ ] **Step 3: Eseguire il test e verificare che fallisca**

Run: `node --test backend/tools/f1LapSimulator.test.js`
Expected: FAIL sul primo test (`args.fuelFactor` è `undefined`).

- [ ] **Step 4: Accettare l'opzione**

In `backend/tools/f1LapSimulator.js`, dentro `makeSimPlayer`, aggiungere al giocatore restituito (accanto a `compound`/`tyreWear`):

```js
        // Peso del carburante. ASSENTE = serbatoio vuoto, che e' il
        // comportamento storico del banco: si popola solo con --fuel, e serve
        // per misurare quanto costa l'auto piena. Vedi
        // backend/sockets/games/physics/FuelModel.js.
        ...(opts.fuelFactor ? { fuelFactor: opts.fuelFactor } : {}),
```

Dentro `parseArgs`, aggiungere il riconoscimento dell'opzione seguendo la forma già usata dalle altre (`--nome=valore`):

```js
        if (a.startsWith('--fuel=')) { out.fuelFactor = parseFloat(a.slice('--fuel='.length)); continue; }
```

Dentro `runOne`, passare l'opzione a `simulateLap` insieme alle altre già presenti (`opts.fuelFactor = args.fuelFactor`), e aggiungere alla riga di intestazione stampata l'indicazione del carico quando presente, per non confondere due run:

```js
    if (args.fuelFactor) console.log(`  carburante: ×${args.fuelFactor}`);
```

- [ ] **Step 5: Eseguire il test e verificare che passi**

Run: `node --test backend/tools/f1LapSimulator.test.js`
Expected: PASS.

- [ ] **Step 6: LA MISURA — il peso si giudica in curva, non sul giro**

Questo è il passo che decide se `FUEL_CORNERING_SHARE = 0.5` e `FUEL_MASS_AT_START = 1.08` sono valori giusti. La memoria del progetto è netta: un flag di guida che costa +1,5% sul tempo sul giro può costare il 12-14% nelle curve lente e rendere la macchina inguidabile.

⚠️ **`f1LapSimulator` è rumoroso**: `botLapPaceMult` si ri-randomizza più volte a giro. **N=30 run per configurazione, mai un run singolo.**

Eseguire, dalla radice del repo:

```bash
for i in $(seq 1 30); do node backend/tools/f1LapSimulator.js prova; done
for i in $(seq 1 30); do node backend/tools/f1LapSimulator.js prova --fuel=1.08; done
```

Raccogliere per ciascuna configurazione:
1. il **tempo sul giro** mediano;
2. le **velocità dei punti più lenti** (`slowestPoints`), che sono le curve lente.

Confrontare, e scrivere i numeri nel corpo del commit.

**Criterio di accettazione:** la perdita nelle curve lente deve stare **entro il 10%**. Se supera quella soglia, l'auto piena è inguidabile e va abbassato `FUEL_CORNERING_SHARE` (non `FUEL_MASS_AT_START`, che governa anche rettilineo e frenata): ritarare, rimisurare, e riportare nel commit i valori finali.

⚠️ Se la differenza fra le due configurazioni fosse **nulla**, non concludere che il peso è troppo piccolo: significa che `--fuel` non sta arrivando al giocatore. Verificarlo prima, stampando `p.fuelFactor` a un tick qualsiasi.

- [ ] **Step 7: Commit**

```bash
git add backend/tools/f1LapSimulator.js backend/tools/f1LapSimulator.test.js
git commit -m "Il banco puo' pesare l'auto

Senza --fuel il peso non era misurabile: il simulatore gira in modalita'
qualifica, dove il tick di gara non riempie mai il serbatoio.

Misura su prova, N=30 per configurazione (il banco e' rumoroso, un run
singolo non dice niente):
  tempo sul giro   scarica <X> ms -> piena <Y> ms (<Z>%)
  curve lente      scarica <A> km/h -> piena <B> km/h (<C>%)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(Sostituire i segnaposto `<X> <Y> <Z> <A> <B> <C>` con i numeri veri misurati allo Step 6. Un commit che li lascia così è un commit sbagliato.)

---

### Task 8: L'abrasivita' del circuito

Un campo nel JSON della pista che moltiplica il consumo. `applyTyreWear` riceve già l'oggetto pista: non cambia nessuna firma.

**Files:**
- Modify: `backend/sockets/games/trackLoader.js` (l'oggetto restituito, intorno a riga 246-270)
- Modify: `backend/sockets/games/physics/TyreModel.js` (`applyTyreWear`, `suggestStrategy`)
- Modify: `backend/sockets/games/f1GameSocket.js` (riga 566: la chiamata a `suggestStrategy`, e il payload `f1Setup`)
- Test: `backend/sockets/games/trackLoader.test.js`, `backend/sockets/games/physics/TyreModel.test.js`

**Interfaces:**
- Consumes: niente dai task precedenti.
- Produces:
  - `track.abrasivita` (number, in [0.5, 2], default 1)
  - `giriPerMescola(totalLaps, abrasivita) -> { hard: number, medium: number, soft: number }` esportata da `TyreModel`
  - `suggestStrategy(totalLaps, abrasivita)` — secondo parametro opzionale, default 1
  - campo `abrasivita` nel payload `f1Setup`

- [ ] **Step 1: Scrivere i test che falliscono (caricamento)**

Aggiungere in fondo a `backend/sockets/games/trackLoader.test.js`:

```js
// Abrasivita' del circuito: quanto quell'asfalto mangia le gomme. E' l'unica
// cosa che rende under-cut e over-cut una scelta invece che una teoria, e
// resta INVISIBILE graficamente (richiesta esplicita dell'utente): due piste
// identiche a vedersi possono chiedere una sosta o due.
test('trackLoader: senza il campo, abrasivita\' vale 1', () => {
    const track = loadTrack('prova');
    assert.equal(track.abrasivita, 1);
});

test('trackLoader: abrasivita\' fuori scala viene limitata', () => {
    // Un file scritto a mano non deve poter azzerare o far esplodere il
    // consumo: 0 renderebbe le gomme eterne, 50 le distruggerebbe in una curva.
    assert.equal(normalizzaAbrasivita(0), 0.5);
    assert.equal(normalizzaAbrasivita(50), 2);
    assert.equal(normalizzaAbrasivita(undefined), 1);
    assert.equal(normalizzaAbrasivita('molta'), 1);
    assert.equal(normalizzaAbrasivita(1.35), 1.35);
});
```

Aggiungere `normalizzaAbrasivita` all'import di `trackLoader` in cima al file di test.

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/trackLoader.test.js`
Expected: FAIL — `normalizzaAbrasivita is not a function` e `track.abrasivita` è `undefined`.

- [ ] **Step 3: Caricare e limitare il campo**

In `backend/sockets/games/trackLoader.js`, a livello di modulo:

```js
// Quanto l'asfalto di questo circuito mangia le gomme. 1 = riferimento
// (una Medium dura WEAR_LAPS_AT_MEDIUM giri). Sotto 1 e' dolce, sopra e'
// aggressivo; l'intervallo utile e' 0.75-1.35, i limiti sono piu' larghi
// solo per non rompersi su un file scritto a mano.
//
// NON ha nessun effetto grafico: due piste identiche a vedersi possono
// chiedere una sosta o due. E' una scelta dell'utente.
const ABRASIVITA_MIN = 0.5;
const ABRASIVITA_MAX = 2;

function normalizzaAbrasivita(valore) {
    if (typeof valore !== 'number' || !Number.isFinite(valore)) return 1;
    return Math.max(ABRASIVITA_MIN, Math.min(ABRASIVITA_MAX, valore));
}
```

Nell'oggetto restituito da `loadTrack`, accanto a `lapLength` e `totalLaps`:

```js
        abrasivita: normalizzaAbrasivita(raw.abrasivita),
```

E aggiungere `normalizzaAbrasivita` a `module.exports`.

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/trackLoader.test.js`
Expected: PASS.

- [ ] **Step 5: Scrivere i test che falliscono (consumo e giri stimati)**

Aggiungere in fondo a `backend/sockets/games/physics/TyreModel.test.js`:

```js
test('applyTyreWear: una pista abrasiva consuma di piu\'', () => {
    const dolce      = { lapLength: 1000, abrasivita: 0.75 };
    const aggressiva = { lapLength: 1000, abrasivita: 1.35 };
    const base = () => ({ vx: 0, vz: 10, tyreWear: 0, compound: 'medium' });
    const a = base(), b = base();
    applyTyreWear(a, false, dolce);
    applyTyreWear(b, false, aggressiva);
    assert.ok(b.tyreWear > a.tyreWear,
        `attesa piu' usura sull'aggressiva, ottenuto ${b.tyreWear} vs ${a.tyreWear}`);
});

test('applyTyreWear: senza abrasivita\' nella pista il consumo e\' quello di sempre', () => {
    const senza = { lapLength: 1000 };
    const uno   = { lapLength: 1000, abrasivita: 1 };
    const a = { vx: 0, vz: 10, tyreWear: 0, compound: 'medium' };
    const b = { vx: 0, vz: 10, tyreWear: 0, compound: 'medium' };
    applyTyreWear(a, false, senza);
    applyTyreWear(b, false, uno);
    assert.equal(a.tyreWear, b.tyreWear);
});

test('giriPerMescola: a riferimento la Medium dura WEAR_LAPS_AT_MEDIUM giri', () => {
    assert.equal(giriPerMescola(20, 1).medium, WEAR_LAPS_AT_MEDIUM);
});

test('giriPerMescola: su pista aggressiva ogni mescola dura meno', () => {
    const riferimento = giriPerMescola(20, 1);
    const aggressiva  = giriPerMescola(20, 1.35);
    for (const k of ['hard', 'medium', 'soft']) {
        assert.ok(aggressiva[k] < riferimento[k],
            `${k}: attesa vita minore, ottenuto ${aggressiva[k]} vs ${riferimento[k]}`);
    }
});

test('giriPerMescola: la Hard dura sempre piu\' della Soft', () => {
    for (const abr of [0.75, 1, 1.35]) {
        const g = giriPerMescola(20, abr);
        assert.ok(g.hard > g.soft, `abrasivita' ${abr}: hard ${g.hard} deve battere soft ${g.soft}`);
    }
});

test('suggestStrategy: su pista aggressiva servono piu\' stint', () => {
    const dolce      = suggestStrategy(20, 0.75);
    const aggressiva = suggestStrategy(20, 1.35);
    assert.ok(aggressiva.length > dolce.length,
        `attesi piu' stint sull'aggressiva, ottenuti ${aggressiva.length} vs ${dolce.length}`);
});

test('suggestStrategy: senza abrasivita\' il consiglio e\' quello di sempre', () => {
    assert.deepEqual(suggestStrategy(20), suggestStrategy(20, 1));
});
```

Aggiungere `giriPerMescola` all'import in cima al file di test.

- [ ] **Step 6: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/TyreModel.test.js`
Expected: FAIL — `giriPerMescola is not a function`, e l'abrasività non ha effetto.

- [ ] **Step 7: Collegare l'abrasivita' al consumo e alla stima**

In `backend/sockets/games/physics/TyreModel.js`, in `applyTyreWear`:

```js
function applyTyreWear(p, offTrack, track) {
    const dist = Math.hypot(p.vx, p.vz);   // distanza percorsa in questo tick
    const wearPerUnitDist = 100 / (WEAR_LAPS_AT_MEDIUM * track.lapLength);
    // Abrasivita' del circuito: quanto quell'asfalto mangia le gomme. Il
    // valore lo normalizza e lo limita trackLoader; qui `|| 1` copre solo i
    // game costruiti a mano nei test e negli strumenti offline.
    const abrasivita = track.abrasivita || 1;
    const wear = dist * wearPerUnitDist * tyreOf(p).wearRate * fuelFactorOf(p) * abrasivita;
    p.tyreWear = Math.min(100, p.tyreWear + wear);
    if (offTrack) p.tyreWear = Math.min(100, p.tyreWear + WEAR_OFFTRACK_EXTRA);
}
```

Estrarre la vita delle mescole in una funzione propria (oggi è inline dentro `suggestStrategy`), perché serve anche alla schermata:

```js
// Quanti giri dura ogni mescola SU QUESTA PISTA. E' il numero che il
// giocatore usa per decidere se fermarsi una volta o due — cioe' lo strumento
// con cui si calcola un under-cut. `totalLaps` non entra nel conto: e' qui
// solo perche' chi chiama ha gia' quel dato sottomano e non deve andarlo a
// cercare due volte.
function giriPerMescola(totalLaps, abrasivita) {
    const abr = abrasivita || 1;
    const giri = (wearRate) => Math.max(1, Math.round(WEAR_LAPS_AT_MEDIUM / (wearRate * abr)));
    return {
        hard:   giri(TYRE_COMPOUNDS.hard.wearRate),
        medium: giri(TYRE_COMPOUNDS.medium.wearRate),
        soft:   giri(TYRE_COMPOUNDS.soft.wearRate),
    };
}

function suggestStrategy(totalLaps, abrasivita) {
    const life = giriPerMescola(totalLaps, abrasivita);
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

Aggiungere `giriPerMescola` a `module.exports`.

- [ ] **Step 8: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/TyreModel.test.js`
Expected: PASS, tutti.

- [ ] **Step 9: Mandare i numeri veri al client**

In `backend/sockets/games/f1GameSocket.js`, aggiungere `giriPerMescola` all'import da `./physics/TyreModel` (accanto a `tyreOf, suggestStrategy`), e nel payload `f1Setup` (riga 566 e dintorni):

```js
            strategy: suggestStrategy(totalLaps, game.track.abrasivita),
            // I giri VERI di questa pista, non quelli nominali: e' cio' con
            // cui il giocatore calcola se fermarsi una volta o due.
            abrasivita: game.track.abrasivita,
            giriPerMescola: giriPerMescola(totalLaps, game.track.abrasivita),
```

- [ ] **Step 10: Verificare tutta la suite**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: lo stesso elenco del Task 1 Step 1.

- [ ] **Step 11: Commit**

```bash
git add backend/sockets/games/trackLoader.js backend/sockets/games/trackLoader.test.js backend/sockets/games/physics/TyreModel.js backend/sockets/games/physics/TyreModel.test.js backend/sockets/games/f1GameSocket.js
git commit -m "Ogni circuito mangia le gomme a modo suo

Un campo nel JSON della pista che moltiplica il consumo. applyTyreWear
riceveva gia' l'oggetto pista: nessuna firma cambia.

Non implementa under-cut e over-cut: da' al giocatore i numeri con cui
li calcola. giriPerMescola dice quanti giri dura ogni mescola SU QUESTA
pista, e il server lo manda al client insieme al consiglio.

Invisibile graficamente, come richiesto: due piste identiche a vedersi
possono chiedere una sosta o due.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: La schermata mescole mostra i giri veri

Fin qui l'abrasività esiste e il server la manda, ma il giocatore non la vede: continuerebbe a scegliere al buio.

**Files:**
- Modify: `frontend/f1.html` (la lista informativa del circuito, righe 380-382; e il `?v=` di `f1.js`)
- Modify: `frontend/f1.js` (il gestore `f1Setup` intorno a riga 3180-3245, `renderTyreCards` intorno a riga 2566)

**Interfaces:**
- Consumes: i campi `abrasivita` e `giriPerMescola` dal payload `f1Setup` (Task 8).
- Produces: niente per altri task.

- [ ] **Step 1: Aggiungere la riga nella lista del circuito**

In `frontend/f1.html`, nella lista che contiene già `tyre-info-giri`, `tyre-info-distanza` e `tyre-info-lunghezza`, aggiungere una quarta voce dopo `tyre-info-lunghezza`:

```html
                        <div><dt>Abrasività</dt><dd id="tyre-info-abrasivita">—</dd></div>
```

- [ ] **Step 2: Popolarla, e mostrare i giri veri su ogni mescola**

In `frontend/f1.js`, nel gestore `f1Setup`, aggiungere `abrasivita` e `giriPerMescola` alla destrutturazione dei campi:

```js
        compounds, strategy, myCompound, tyreConfirmed, tyreTotal, abrasivita, giriPerMescola,
```

Subito sopra il gestore, aggiungere due variabili di modulo accanto alle altre della schermata mescole:

```js
    // I numeri veri di QUESTA pista, mandati dal server: quanto l'asfalto
    // mangia le gomme e quanti giri dura ogni mescola. Servono a decidere se
    // fermarsi una volta o due — cioe' a calcolare un under-cut.
    let abrasivitaPista = 1;
    let giriMescolaPista = null;
```

Dentro il ramo `if (phase === 'tyre_select')`, **prima** della chiamata a `renderInfoCircuito()`:

```js
            if (typeof abrasivita === 'number') abrasivitaPista = abrasivita;
            if (giriPerMescola) giriMescolaPista = giriPerMescola;
```

e passare i giri alle card:

```js
            renderTyreCards(compounds, myCompoundChoice, 'tyre-cards', 'f1TyreChoice', giriMescolaPista);
```

- [ ] **Step 3: Scrivere l'abrasivita' in parole, non in numeri**

Ancora in `frontend/f1.js`, dentro `renderInfoCircuito`, dopo la riga che scrive `tyre-info-lunghezza`:

```js
        // In parole e non come numero: "1.35" non dice niente a nessuno, e il
        // valore esatto non e' un'informazione che serve al giocatore. Serve
        // sapere se questa pista chiede una sosta o due — e quello glielo
        // dicono i giri sulle card, qui accanto.
        const el2 = el('tyre-info-abrasivita');
        if (el2) {
            const scala = [
                [0.85, 'Dolce'],
                [1.15, 'Media'],
                [Infinity, 'Aggressiva'],
            ];
            el2.textContent = scala.find(([soglia]) => abrasivitaPista < soglia)[1];
        }
```

- [ ] **Step 4: Mostrare i giri su ogni card**

In `frontend/f1.js`, cambiare la firma di `renderTyreCards` e la riga delle statistiche:

```js
    function renderTyreCards(compounds, myCompound, containerId, eventName, giriPerMescola) {
```

e dentro il ciclo, sostituire il blocco `tyre-card-stats` con:

```js
            // "Usura 1.5×" e' un moltiplicatore astratto; "dura ~3 giri" e' la
            // cosa con cui si decide una strategia. Se il server non ha ancora
            // mandato i giri (schermata aperta prima del payload) si torna al
            // moltiplicatore, che e' sempre vero.
            const giri = giriPerMescola && giriPerMescola[key];
            const durata = giri
                ? `Dura <b>~${giri} giri</b>`
                : `Usura <b>${c.wearRate}×</b>`;
            card.innerHTML = F1Pneumatico.svg(key, c.color, { titolo: `Mescola ${c.label}` })
                + `<div>
                    <div class="tyre-card-label">${c.label.toUpperCase()}</div>
                    <div class="tyre-card-stats">
                        Velocità <b>${segno(c.speedMult)}</b> · Aderenza <b>${segno(c.gripMult)}</b><br>
                        ${durata}
                    </div>
                </div>`;
```

⚠️ `renderTyreCards` ha **due** chiamanti (la schermata mescole prima della qualifica e quella che si riapre ai box). Cercarli con `grep -n "renderTyreCards(" frontend/f1.js` e passare `giriMescolaPista` a entrambi: se uno resta indietro, ai box le card mostrano il moltiplicatore e prima della qualifica i giri, e sembra un difetto.

- [ ] **Step 5: Alzare il cache-busting**

In `frontend/f1.html`, trovare il tag che carica `f1.js` con `?v=` e incrementare il numero. Senza questo il browser serve il JS vecchio e la modifica sembra non esserci.

Run: `grep -n "f1.js?v=" frontend/f1.html`

- [ ] **Step 6: Verificare a schermo**

⚠️ Chrome headless è installato e la UI si può vedere davvero — non fidarsi della lettura del codice per una schermata.

Avviare il server (`node server.js` da `backend/`), aprire `localhost:3000`, entrare in una gara veloce F1 e arrivare alla schermata delle mescole. Verificare:
1. la voce **Abrasività** compare e dice una parola, non un numero;
2. ogni card dice **«Dura ~N giri»** con N diverso fra Hard, Medium e Soft;
3. su una pista con `abrasivita` alta nel JSON, N cala.

Per il punto 3 serve una pista di prova: aggiungere temporaneamente `"abrasivita": 1.35` a `frontend/tracks/test.json`, verificare, e **rimuoverlo prima del commit** — ⚠️ i file in `frontend/tracks/` sono dell'utente, non vanno né modificati né committati (vedi Global Constraints).

- [ ] **Step 7: Commit**

```bash
git add frontend/f1.html frontend/f1.js
git commit -m "La schermata mescole dice i giri veri di questa pista

Le card dicevano 'Usura 1.5x', un moltiplicatore astratto. Ora dicono
quanti giri dura quella mescola SU QUESTA pista, che e' il numero con
cui si decide se fermarsi una volta o due.

L'abrasivita' e' scritta in parole: il valore esatto non serve al
giocatore, gli serve sapere se la pista chiede una sosta o due.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Uscire di pista rovina il fondo

L'ultimo pezzo delle fasi 1-3. `applyOffTrackDrag` calcola già quanto si è finiti fuori, ma butta via il numero: restituisce solo un booleano.

**I cordoli sono esclusi gratis**: `offTrack` scatta solo oltre `roadHalf + 2`, e quei 2 sono la fascia del cordolo. Non serve nessun caso speciale — ed è una richiesta esplicita dell'utente, quindi va protetta da un test.

**Files:**
- Modify: `backend/sockets/games/physics/VehicleMotionModel.js` (`applyOffTrackDrag`)
- Modify: `backend/sockets/games/physics/DamageModel.js` (funzione nuova)
- Modify: `backend/sockets/games/f1GameSocket.js` (riga ~1939, il chiamante nel tick)
- Modify: `backend/tools/f1LapSimulator.js` (riga ~73) e `backend/tools/f1RaceLineOptimizer.js` (riga ~163)
- Test: `backend/sockets/games/physics/VehicleMotionModel.test.js`, `backend/sockets/games/physics/DamageModel.test.js`

**Interfaces:**
- Consumes: `p.damageParts` e le costanti di `DamageModel`.
- Produces:
  - `applyOffTrackDrag(p, track) -> { offTrack: boolean, profondita: number }` — **cambia tipo di ritorno**
  - `applyOffTrackFloorDamage(p, profondita)` esportata da `DamageModel`
  - `OFFTRACK_FLOOR_DAMAGE_PER_TICK` (number)

- [ ] **Step 1: Scrivere i test che falliscono (il ritorno)**

⚠️ Il tipo di ritorno cambia: un chiamante non aggiornato riceverebbe un oggetto, che è **sempre vero**, e crederebbe di essere fuori pista ad ogni tick. I tre chiamanti vanno tutti aggiornati nello stesso commit.

Sostituire i tre test esistenti in `backend/sockets/games/physics/VehicleMotionModel.test.js` che asseriscono il booleano, e aggiungerne uno:

```js
test('applyOffTrackDrag: entro roadHalf+2, nessun drag, non e\' fuori pista', () => {
    const p = { x: 0, z: 0, speed: 3, vx: 0, vz: 3 };
    const track = { points: [{ x: 0, z: 0 }, { x: 0, z: 10 }], roadHalf: 10 };
    const { offTrack, profondita } = applyOffTrackDrag(p, track);
    assert.equal(offTrack, false);
    assert.equal(profondita, 0);
    assert.equal(p.speed, 3);
});

test('applyOffTrackDrag: la profondita\' cresce con la distanza e satura a 1', () => {
    const track = { points: [{ x: 0, z: 0 }, { x: 0, z: 10 }], roadHalf: 10 };
    const poco  = { x: 14, z: 0, speed: 3, vx: 3, vz: 0 };
    const molto = { x: 40, z: 0, speed: 3, vx: 3, vz: 0 };
    const a = applyOffTrackDrag(poco, track);
    const b = applyOffTrackDrag(molto, track);
    assert.equal(a.offTrack, true);
    assert.equal(b.offTrack, true);
    assert.ok(a.profondita > 0 && a.profondita < 1, `attesa profondita' parziale, ottenuta ${a.profondita}`);
    assert.equal(b.profondita, 1);
});

test('applyOffTrackDrag: SUL CORDOLO non si e\' fuori pista', () => {
    // I 2 unita' oltre roadHalf sono la fascia del cordolo. Il cordolo non
    // deve danneggiare il fondo: e' una richiesta esplicita dell'utente, e la
    // soglia gia' esistente la soddisfa da sola. Questo test difende quella
    // coincidenza, che altrimenti nessuno saprebbe di dover mantenere.
    const track = { points: [{ x: 0, z: 0 }, { x: 0, z: 10 }], roadHalf: 10 };
    const p = { x: 11.5, z: 0, speed: 3, vx: 3, vz: 0 };
    const { offTrack } = applyOffTrackDrag(p, track);
    assert.equal(offTrack, false, 'il cordolo non e\' fuori pista');
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/physics/VehicleMotionModel.test.js`
Expected: FAIL — la destrutturazione di un booleano dà `undefined` per entrambi i campi.

- [ ] **Step 3: Restituire anche la profondita'**

In `backend/sockets/games/physics/VehicleMotionModel.js`:

```js
// Ghiaia: rallentamento fuori pista. Ritorna `offTrack` (riusato da
// TyreModel.applyTyreWear per il piccolo extra di usura) e `profondita`
// (0..1, riusata da DamageModel per il danno al fondo): sfiorare l'erba non
// costa quanto attraversare la ghiaia.
//
// La soglia e' roadHalf + 2, e quei 2 sono la fascia del CORDOLO: chi sta sul
// cordolo non e' fuori pista, quindi non consuma gomma e non rovina il fondo.
// E' una richiesta esplicita dell'utente, ed e' soddisfatta gratis da questa
// soglia — c'e' un test che la difende, non toglierla.
function applyOffTrackDrag(p, track) {
    const dist = nearestTrackDist(track, p.x, p.z);
    const offTrack = dist > track.roadHalf + 2;
    if (!offTrack) return { offTrack: false, profondita: 0 };
    const k = Math.min(1, (dist - track.roadHalf - 2) / 8);   // 0..1 in funzione della profondità
    const drag = 0.04 + k * 0.08;
    p.speed *= (1 - drag);
    p.vx   *= (1 - drag);
    p.vz   *= (1 - drag);
    return { offTrack: true, profondita: k };
}
```

- [ ] **Step 4: Aggiornare TUTTI i chiamanti**

Run: `grep -rn "applyOffTrackDrag(" backend/ --include=*.js | grep -v node_modules | grep -v "function applyOffTrackDrag"`

In `backend/sockets/games/f1GameSocket.js` (riga ~1939):

```js
        const { offTrack, profondita } = applyOffTrackDrag(p, game.track);
```

In `backend/tools/f1LapSimulator.js` (riga ~73) la chiamata ignora già il risultato: lasciarla com'è, ma verificare che non lo assegni a niente.

In `backend/tools/f1RaceLineOptimizer.js` (riga ~163):

```js
            if (physics.applyOffTrackDrag(p, track).offTrack) offTrackTicks++;
```

⚠️ Questa riga è la più pericolosa del task: senza `.offTrack` conterebbe **ogni** tick come fuori pista, e l'ottimizzatore delle traiettorie produrrebbe linee assurde senza dare errore.

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/physics/VehicleMotionModel.test.js`
Expected: PASS.

- [ ] **Step 6: Scrivere il test del danno al fondo**

Aggiungere in fondo a `backend/sockets/games/physics/DamageModel.test.js`:

```js
// Il fondo si rovina fuori pista. E' la prima fonte di danno che non viene da
// un urto: fino a qui la macchina si rompeva solo sbattendo.
//
// NB: questo file importa il modulo INTERO come `DamageModel` (vedi la riga 4),
// non destrutturato — seguire quella convenzione.
test('applyOffTrackFloorDamage: la ghiaia costa piu\' dell\'erba sfiorata', () => {
    const sfiora  = { damageParts: DamageModel.createDamageParts() };
    const affonda = { damageParts: DamageModel.createDamageParts() };
    DamageModel.applyOffTrackFloorDamage(sfiora, 0.1);
    DamageModel.applyOffTrackFloorDamage(affonda, 1);
    assert.ok(affonda.damageParts.floor > sfiora.damageParts.floor,
        `attesa piu' rottura affondando, ottenuto ${affonda.damageParts.floor} vs ${sfiora.damageParts.floor}`);
});

test('applyOffTrackFloorDamage: rovina SOLO il fondo', () => {
    const p = { damageParts: DamageModel.createDamageParts() };
    DamageModel.applyOffTrackFloorDamage(p, 1);
    assert.ok(p.damageParts.floor > 0, 'il fondo deve rovinarsi');
    assert.equal(p.damageParts.frontWing, 0, 'l\'ala non c\'entra');
    assert.equal(p.damageParts.engine, 0, 'il motore non c\'entra');
    assert.equal(p.damageParts.suspension, 0, 'le sospensioni non c\'entrano');
});

test('applyOffTrackFloorDamage: profondita\' zero non fa niente', () => {
    const p = { damageParts: DamageModel.createDamageParts() };
    DamageModel.applyOffTrackFloorDamage(p, 0);
    assert.equal(p.damageParts.floor, 0);
});

test('applyOffTrackFloorDamage: il fondo non supera mai 100', () => {
    const p = { damageParts: DamageModel.createDamageParts() };
    for (let i = 0; i < 100000; i++) DamageModel.applyOffTrackFloorDamage(p, 1);
    assert.equal(p.damageParts.floor, 100);
});
```

- [ ] **Step 7: Eseguire il test e verificare che fallisca**

Run: `node --test backend/sockets/games/physics/DamageModel.test.js`
Expected: FAIL — `applyOffTrackFloorDamage is not a function`.

- [ ] **Step 8: Scrivere il danno**

In `backend/sockets/games/physics/DamageModel.js`, accanto alle altre funzioni che applicano danno:

```js
// Il fondo si rovina fuori pista — la prima fonte di danno che non viene da
// un urto. Rif. docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md.
//
// Proporzionale alla PROFONDITA' del fuoripista (0..1, da
// VehicleMotionModel.applyOffTrackDrag): sfiorare l'erba con due ruote costa
// quasi niente, attraversare la ghiaia costa. E i cordoli non costano nulla,
// perche' sul cordolo non si e' fuori pista — vedi la soglia in
// applyOffTrackDrag.
//
// Il valore e' PER TICK: un'escursione larga di un paio di secondi deve
// costare qualche punto di fondo, non mezza vettura. Con PHYSICS_TICK_MS a
// 50 ms sono 20 tick al secondo.
const OFFTRACK_FLOOR_DAMAGE_PER_TICK = 0.06;

function applyOffTrackFloorDamage(p, profondita) {
    const k = Math.max(0, Math.min(1, profondita || 0));
    if (k === 0) return;
    addComponentDamage(p, k * OFFTRACK_FLOOR_DAMAGE_PER_TICK, { floor: 1 });
}
```

⚠️ Verificare la firma vera di `addComponentDamage(p, amount, split)` prima di usarla (è definita alla riga ~71 dello stesso file) e che uno `split` con una sola voce sia accettato. Se non lo fosse, incrementare `p.damageParts.floor` direttamente, ricordandosi di **ricalcolare `p.damage`** come massimo dei quattro componenti — è quello che fa `addComponentDamage`, e saltarlo lascerebbe l'indicatore dei danni fermo mentre il fondo si rovina.

Aggiungere `applyOffTrackFloorDamage` e `OFFTRACK_FLOOR_DAMAGE_PER_TICK` a `module.exports`.

- [ ] **Step 9: Collegarlo al tick**

In `backend/sockets/games/f1GameSocket.js`, aggiungere `applyOffTrackFloorDamage` all'import da `./physics/DamageModel` (riga ~24), e nel ciclo del tick, subito dopo `applyTyreWear`:

```js
        if (game.phase === 'race' && !p.finished) applyTyreWear(p, offTrack, game.track);
        // Il fondo si rovina fuori pista. Come l'usura, vale SOLO in gara:
        // in qualifica la macchina e' quella con cui si arriva al weekend, e
        // il giro di rientro dopo la bandiera non deve costare niente.
        if (game.phase === 'race' && !p.finished && offTrack) applyOffTrackFloorDamage(p, profondita);
```

- [ ] **Step 10: Eseguire tutta la suite**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: lo stesso elenco del Task 1 Step 1.

- [ ] **Step 11: Verificare quanto costa davvero un fuoripista**

Un numero per tick è impossibile da giudicare a mente. Misurarlo:

```bash
node -e "
const { applyOffTrackFloorDamage, createDamageParts } = require('./backend/sockets/games/physics/DamageModel.js');
for (const secondi of [0.5, 1, 2, 5]) {
  for (const prof of [0.2, 1]) {
    const p = { damageParts: createDamageParts() };
    for (let i = 0; i < secondi * 20; i++) applyOffTrackFloorDamage(p, prof);
    console.log(secondi + 's a profondita ' + prof + ' -> fondo ' + p.damageParts.floor.toFixed(1) + '%');
  }
}"
```

**Criterio:** un'escursione di 2 secondi in ghiaia piena deve costare **fra il 2% e il 6%** di fondo. Sotto il 2% è invisibile e tanto vale non farlo; sopra il 6% due errori rovinano la gara. Tarare `OFFTRACK_FLOOR_DAMAGE_PER_TICK` finché ci rientra, e riportare i numeri nel commit.

- [ ] **Step 12: Commit**

```bash
git add backend/sockets/games/physics/VehicleMotionModel.js backend/sockets/games/physics/VehicleMotionModel.test.js backend/sockets/games/physics/DamageModel.js backend/sockets/games/physics/DamageModel.test.js backend/sockets/games/f1GameSocket.js backend/tools/f1RaceLineOptimizer.js
git commit -m "Uscire di pista rovina il fondo

La prima fonte di danno che non viene da un urto. Proporzionale a quanto
si e' finiti fuori: applyOffTrackDrag calcolava gia' quel numero e lo
buttava via, ora lo restituisce.

I cordoli sono esclusi gratis: offTrack scatta oltre roadHalf+2, e quei
2 sono la fascia del cordolo. C'e' un test che difende la coincidenza,
altrimenti nessuno saprebbe di doverla mantenere.

Costo misurato: 2s in ghiaia piena = <X>% di fondo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(Sostituire `<X>` col numero vero misurato allo Step 11.)

---

## Dopo questo piano

Le fasi 1-3 sono chiuse. Restano da fare, **in un piano separato** come stabilito dalla spec:

- **Fase 4 — il parco chiuso**: stato della vettura calcolato dagli eventi, officina fra un weekend e l'altro, dotazione stagionale, penalità in griglia, strategia dei bot.

Prima di aprirla, va playtestato quanto fatto qui: il peso del carburante e l'abrasività cambiano il modo in cui si guida, e la fase 4 ci costruisce sopra.
