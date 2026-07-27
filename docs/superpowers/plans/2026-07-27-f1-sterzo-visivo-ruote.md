# F1 — sterzo visivo ruote anteriori — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le ruote anteriori del modello auto F1 (propria, avversari, bot) ruotano visivamente sull'asse verticale in base a quanto si sta sterzando in quel momento — puro effetto cosmetico, nessun impatto su fisica/hitbox/gameplay.

**Architecture:** Il server include nel payload di stato già trasmesso ad ogni tick un nuovo campo `steerInput` (l'input di sterzo -1..1 già calcolato per la fisica). Il client identifica quali nodi ruota del modello sono anteriori (per nome, con fallback sulla posizione Z) e applica loro una rotazione Y smussata (lerp) proporzionale a `steerInput`, lasciando invariato il rotolamento già esistente.

**Tech Stack:** Node.js (`node:test` per i test server-side), Three.js r128 lato client (nessun test automatico per `frontend/f1.js`, file browser-only senza infrastruttura di test esistente).

## Global Constraints

- **Italiano** in commenti/comunicazioni (da CLAUDE.md di progetto).
- **Commit di checkpoint SOLO nel branch isolato del worktree** (`worktree-f1-sterzo-visivo-ruote`), necessari al meccanismo di revisione task-per-task di questa skill — chiarito con l'utente prima dell'esecuzione: main e la working directory originale del progetto restano intoccati, l'utente deciderà lui, a lavoro finito, se/come integrare il worktree in main (merge, rebase, o scarto). Nessun push su remoto in nessun caso, e nessun commit fuori dal worktree.
- Nessuna modifica a fisica/hitbox/gameplay: il campo `steerInput` è di sola lettura per il client, la traiettoria reale resta calcolata dal server su x/z/angle come oggi.
- Il modello auto nuovo (`livrea base.glb`) resta fuori scope, non toccato da questo piano.

---

### Task 1: Server — broadcast dell'input di sterzo

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js:1176-1220` (funzione `buildPublicState`), e riga ~1262 (blocco export in fondo al file)
- Test: Create `backend/sockets/games/f1GameSocket.broadcastState.test.js`

**Interfaces:**
- Consumes: nessuna (usa solo `p.inputs.steer`, già esistente e già clampato -1..1 alla riga 342 dello stesso file).
- Produces: `f1GameSocket.buildPublicState(players, raceStarted, track)` esportato come funzione pura testabile; il payload restituito da questa funzione (e quindi quello che il client riceve via socket) include ora `steerInput: <number -1..1>` per ogni colore.

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `backend/sockets/games/f1GameSocket.broadcastState.test.js`:

```js
// backend/sockets/games/f1GameSocket.broadcastState.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const f1GameSocket = require('./f1GameSocket.js');

function makeFakePlayer(steer) {
    return {
        x: 10, z: -5, angle: 0.3, trackIndex: 7, speed: 4.2,
        finished: false, time: null, lap: 1,
        compound: 'medium', tyreWear: 0, damage: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        pitAutoState: null, falseStart: false, falseStartServed: false,
        gapToLeaderMs: null, isBot: false, inSlipstream: false,
        collisionPenaltyMs: 0,
        inputs: { throttle: 0, brake: 0, steer }
    };
}

test('buildPublicState include steerInput preso da p.inputs.steer', () => {
    const out = f1GameSocket.buildPublicState({ red: makeFakePlayer(0.42) }, false, null);
    assert.equal(out.red.steerInput, 0.42);
});

test('buildPublicState: steerInput negativo (sterzo a destra) passa invariato', () => {
    const out = f1GameSocket.buildPublicState({ blue: makeFakePlayer(-1) }, false, null);
    assert.equal(out.blue.steerInput, -1);
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test backend/sockets/games/f1GameSocket.broadcastState.test.js`
Expected: FAIL — `f1GameSocket.buildPublicState is not a function` (non ancora esportata), oppure (se già esportata) `out.red.steerInput` è `undefined`, non `0.42`.

- [ ] **Step 3: Implementare**

In `backend/sockets/games/f1GameSocket.js`, dentro `buildPublicState`, aggiungere il campo `steerInput` accanto a `speed` (riga ~1180):

```js
        out[color] = {
            x: p.x, z: p.z, angle: p.angle,
            trackIndex: p.trackIndex,
            speed:    p.speed,
            steerInput: p.inputs.steer,
            finished: p.finished,
```

Poi, vicino agli altri export in fondo al file (dopo `module.exports.TYRE_COMPOUNDS = TYRE_COMPOUNDS;`, riga ~1262), esportare la funzione per renderla testabile (stesso pattern già usato per `tickGame`/`TYRE_COMPOUNDS`):

```js
module.exports.buildPublicState = buildPublicState;
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `node --test backend/sockets/games/f1GameSocket.broadcastState.test.js`
Expected: PASS (2/2 test)

- [ ] **Step 5: Eseguire l'intera suite del gioco F1 per assicurarsi di non aver rotto nulla**

Run: `node --test backend/sockets/games/f1*.test.js`
Expected: PASS su tutti i file (nessuna assert esistente dipende dalla forma esatta dell'oggetto restituito da `buildPublicState`, verificato durante la progettazione di questo piano — l'aggiunta di un campo non rompe test preesistenti).

---

### Task 2: `carLoader.js` — classificazione ruote anteriori/posteriori

**Files:**
- Modify: `frontend/shared/carLoader.js:125-246` (funzione `loadCarModel` e blocco di export finale)
- Test: Modify `frontend/shared/carLoader.test.js`

**Interfaces:**
- Consumes: nessuna da Task 1.
- Produces: `CarLoader.classifyWheelSide(nm)` — funzione pura, `nm` è una stringa già in minuscolo (nome mesh + nome parent concatenati, stesso formato già costruito nel traverse esistente), ritorna `'front'`, `'rear'` o `null`. `group.userData.frontWheels` — array (sottoinsieme di `group.userData.wheels`) contenente solo i nodi ruota anteriori, popolato da `loadCarModel` per ogni auto caricata; consumato da Task 3.

- [ ] **Step 1: Scrivere il test che fallisce**

In `frontend/shared/carLoader.test.js`, aggiungere:

```js
test('classifyWheelSide riconosce _FL/_FR come anteriori e _RL/_RR come posteriori', () => {
    assert.equal(CarLoader.classifyWheelSide('wheelhub_fl tire_wheel'), 'front');
    assert.equal(CarLoader.classifyWheelSide('wheelhub_fr'), 'front');
    assert.equal(CarLoader.classifyWheelSide('wheelhub_rl'), 'rear');
    assert.equal(CarLoader.classifyWheelSide('wheelhub_rr tire_wheel'), 'rear');
    assert.equal(CarLoader.classifyWheelSide('chassis frame'), null);
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test frontend/shared/carLoader.test.js`
Expected: FAIL — `CarLoader.classifyWheelSide is not a function`

- [ ] **Step 3: Implementare `classifyWheelSide` ed esportarla**

In `frontend/shared/carLoader.js`, aggiungere la funzione prima di `loadCarModel` (dopo `recolorLiveryTexture`, riga ~115):

```js
    // Ruote nominate 'wheelHub_FL/FR/RL/RR' (vedi
    // backend/tools/f1CarVoxelize.py:44-47) o 'wheel_FL' ecc. — suffisso
    // '_fl'/'_fr' = anteriore, '_rl'/'_rr' = posteriore. Usato per applicare
    // lo sterzo visivo (frontend/f1.js) solo alle ruote anteriori.
    function classifyWheelSide(nm) {
        if (nm.includes('_fl') || nm.includes('_fr')) return 'front';
        if (nm.includes('_rl') || nm.includes('_rr')) return 'rear';
        return null;
    }
```

E aggiornare il `return` finale del modulo (riga ~245):

```js
    return { loadCarModel, classifyWheelSide };
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `node --test frontend/shared/carLoader.test.js`
Expected: PASS (tutti i test del file, incluso quello preesistente)

- [ ] **Step 5: Collegare la classificazione a `loadCarModel` per produrre `frontWheels`**

Non testabile via `node:test` senza mockare `THREE`/`GLTFLoader` (stesso limite già esistente per il resto di `loadCarModel`, oggi coperta solo dal test "è una funzione") — si verifica visivamente in Task 3.

Nel `traverse` dentro `loadCarModel` (righe ~145-169), tracciare il lato di ogni mesh-ruota nominata mentre si popola `namedWheels`:

```js
            const namedWheels = [];
            const allMeshes   = [];
            const meshSide    = new Map();

            model.traverse((child) => {
                if (!child.isMesh) return;
                child.castShadow    = true;
                child.receiveShadow = true;
                child.material      = child.material.clone();
                if (child.material.map) {
                    child.material.map = recolorLiveryTexture(child.material.map, hex);
                    child.material.needsUpdate = true;
                } else {
                    const c = child.material.color;
                    if (c.r > 0.85 && c.g > 0.85 && c.b > 0.85) {
                        child.material.color.setHex(hex);
                        child.material.metalness = 0.4;
                        child.material.roughness = 0.35;
                    }
                }
                allMeshes.push(child);
                const nm = (child.name + ' ' + (child.parent?.name || '')).toLowerCase();
                if (nm.includes('wheel') || nm.includes('tyre') || nm.includes('tire')) {
                    namedWheels.push(child);
                    const side = classifyWheelSide(nm);
                    if (side) meshSide.set(child, side);
                }
            });
```

Poi, nel blocco che raccoglie i nodi parent (righe ~176-184), tracciare il lato per nodo finale:

```js
            // Raccogli i nodi PARENT delle ruote (rotazione più corretta del sub-mesh)
            const wheelParentSet  = new Set();
            const wheelSideByNode = new Map();
            for (const wm of namedWheels) {
                const p = wm.parent;
                const node = (p && p.isObject3D && !(p.isMesh) && p !== model && p !== gltf.scene) ? p : wm;
                wheelParentSet.add(node);
                if (meshSide.has(wm) && !wheelSideByNode.has(node)) {
                    wheelSideByNode.set(node, meshSide.get(wm));
                }
            }
```

Infine, subito prima di `group.userData.wheels = wheels;` (riga ~224), calcolare `frontWheels` — un'unica classificazione che copre tutti e 3 i percorsi esistenti (ruote nominate, fallback bounding-box, fallback sintetico): se il nodo ha un lato noto da nome si usa quello, altrimenti si deriva dalla posizione Z (>0 = anteriore, stessa convenzione già usata nel commento riga ~310 di `f1.js` per le ruote sintetiche):

```js
            const frontWheels = wheels.filter((w) => {
                const side = wheelSideByNode.get(w);
                if (side) return side === 'front';
                return new THREE.Box3().setFromObject(w).getCenter(new THREE.Vector3()).z > 0;
            });

            group.userData.wheels      = wheels;
            group.userData.frontWheels = frontWheels;
            group.userData.wheelRot    = 0;
```

(sostituisce le due righe esistenti `group.userData.wheels = wheels; group.userData.wheelRot = 0;`)

- [ ] **Step 6: Rieseguire l'intera suite di `carLoader.test.js` per conferma**

Run: `node --test frontend/shared/carLoader.test.js`
Expected: PASS

---

### Task 3: `frontend/f1.js` — applicare la rotazione ruote anteriori

**Files:**
- Modify: `frontend/f1.js:1346` (costanti render loop), `frontend/f1.js:1488-1490` (smoothing per-auto), `frontend/f1.js:1541-1546` (rotazione ruote)

**Interfaces:**
- Consumes: `target.steerInput` (da Task 1, presente nel payload di stato per ogni colore), `carGroup.userData.frontWheels` (da Task 2).
- Produces: nessuna (ultimo task della catena — solo effetto visivo finale).

Nessun test automatico: `frontend/f1.js` è uno script browser-only (nessun `module.exports`, nessuna infrastruttura di test esistente per questo file). Verifica manuale in localhost, come da convenzione di progetto.

- [ ] **Step 1: Aggiungere la costante dell'angolo massimo di sterzo visivo**

In `frontend/f1.js`, subito dopo `const LERP = 0.22;` (riga 1346):

```js
    const LERP = 0.22;
    // Angolo massimo di rotazione visiva delle ruote anteriori in sterzata
    // (solo estetico — la fisica reale usa l'input grezzo lato server,
    // SteeringModel.js — non questo valore). Stesso ordine di grandezza
    // del clamp ±0.4 rad usato nell'editor di riferimento navigato per
    // progettare questo effetto. Da tarare a vista in localhost.
    const MAX_WHEEL_STEER_RAD = 0.35;
```

- [ ] **Step 2: Smussare l'angolo di sterzo per ogni auto nel loop di rendering**

Subito dopo `v.angle  = lerpAngle(v.angle || 0, target.angle || 0, LERP);` (riga 1490):

```js
            v.angle  = lerpAngle(v.angle || 0, target.angle || 0, LERP);
            v.steerAngle = (v.steerAngle || 0) + ((target.steerInput || 0) * MAX_WHEEL_STEER_RAD - (v.steerAngle || 0)) * LERP;
```

- [ ] **Step 3: Applicare la rotazione alle sole ruote anteriori**

Subito dopo il blocco esistente di rotolamento ruote (righe 1541-1546):

```js
                // Rotazione ruote basata sulla velocità
                if (carGroup.userData.wheels && carGroup.userData.wheels.length > 0) {
                    carGroup.userData.wheelRot = (carGroup.userData.wheelRot || 0) + Math.abs(target.speed || 0) * 1.4;
                    const wr = -carGroup.userData.wheelRot;
                    for (const w of carGroup.userData.wheels) w.rotation.x = wr;
                }
                // Sterzo visivo: solo le ruote anteriori ruotano sull'asse
                // verticale (Y) in base a v.steerAngle (smussato sopra) —
                // effetto puramente cosmetico, la traiettoria reale resta
                // quella calcolata dal server su x/z/angle.
                if (carGroup.userData.frontWheels && carGroup.userData.frontWheels.length > 0) {
                    for (const w of carGroup.userData.frontWheels) w.rotation.y = v.steerAngle;
                }
```

- [ ] **Step 4: Verifica manuale in localhost**

1. Avviare il server: `node server.js` dalla cartella `backend/` (per_dettagli vedi CLAUDE.md di progetto).
2. Aprire `localhost:3000`, entrare in una lobby, avviare una partita F1 (anche in modalità singola con bot — i bot usano lo stesso `steerInput` broadcast).
3. Osservare, in curva, sia la propria auto (tasto C per la visuale cockpit, se si vuole vedere da vicino il muso) sia le auto dei bot: le ruote anteriori devono ruotare visibilmente verso l'interno/esterno della curva, senza scatti bruschi, mentre le ruote posteriori continuano a mostrare solo il rotolamento come oggi.
4. Se l'angolo sembra troppo debole o esagerato, tornare allo Step 1 e regolare `MAX_WHEEL_STEER_RAD` (aumentare per un effetto più marcato, diminuire per uno più sobrio) e ripetere la verifica.

- [ ] **Step 5: Nessun commit automatico**

Come da Global Constraints — segnalare all'utente che l'implementazione è pronta per la verifica e attendere che sia lui a decidere se/quando committare.

---

## Self-Review

**Copertura spec:**
- Campo `steerInput` trasmesso dal server → Task 1. ✓
- Classificazione anteriore/posteriore delle ruote (nome + fallback Z) → Task 2. ✓
- Rotazione Y smussata (lerp) applicata solo alle ruote anteriori → Task 3. ✓
- Uso del valore broadcast anche per la propria auto (no percorso speciale) → Task 3 usa `target.steerInput` per ogni colore inclusa la propria, nessun ramo `myColor` separato aggiunto. ✓
- Verifica in banco prova bot/localhost → la spec citava `f1-testbench.html`, ma verificato durante la progettazione che quello strumento NON anima le ruote (nessun rotolamento oggi, vedi `frontend/f1-testbench.js:286-300`) — usarlo darebbe un falso negativo. Corretto nel piano: la verifica avviene nel gioco vero (`f1.js`), che include già i bot in modalità singola/gara.
- Fuori scope (`livrea base.glb`, altri effetti dell'editor) → non toccato da nessun task. ✓

**Scansione placeholder:** nessun TBD/TODO; ogni step ha codice completo, non descrizioni generiche.

**Coerenza tipi/nomi:** `steerInput` (Task 1) → letto come `target.steerInput` (Task 3); `classifyWheelSide` (Task 2, esportata) → stesso nome usato internamente in `loadCarModel`; `group.userData.frontWheels` (Task 2) → letto come `carGroup.userData.frontWheels` (Task 3, `carGroup` è la variabile locale che referenzia lo stesso `group`). Nessuna discrepanza trovata.
