# Gravita' lungo il nastro (fase 1a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le salite costano velocita' e le discese la restituiscono, su tutto il circuito, dietro un interruttore e con un banco che ne misuri l'effetto prima del playtest.

**Architecture:** La pendenza di ogni campione si calcola **una volta sola** al caricamento della pista (`trackLoader`), con la stessa funzione che il client usa per il beccheggio visivo. Viaggia su `p.pendenza` accanto a `p.trackIndex`, scritta da un posto solo (`updateTrackIndex`), cosi' nessun chiamante di `updateVelocity` deve conoscere la pista. La fisica somma un termine `-G_NASTRO * sin(pendenza)` alla velocita', dietro il flag `F1_GRAVITA_NASTRO`.

**Tech Stack:** Node.js, `node --test` + `node:assert/strict`, moduli UMD condivisi fra browser e server (`frontend/shared/*.js`).

**Spec:** `docs/superpowers/specs/2026-08-25-f1-nastro-orientato-design.md`

## Global Constraints

- **Italiano** nei commenti e nei messaggi di commit.
- **A flag spento il comportamento deve essere identico a oggi**, bit per bit. Ogni task che tocca la fisica lo verifica con un test.
- **Una cosa, una misura**: la pendenza che la fisica usa e quella che il client disegna sono lo **stesso numero**, dalla stessa funzione. Non si ricopia la formula.
- **Niente `git add -A`**: aggiungere solo i file per nome. L'utente lavora in parallelo e ha file non tracciati suoi (`frontend/tracks/nuova-pista.json`, `backend/tools/prova-*-raceline.json`) che non vanno mai committati.
- **Commit ad ogni task**, in italiano, con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` in fondo.
- **Unita' di misura**: le pendenze sono in **radianti**, **positive in salita**. Le soglie geometriche vanno espresse in unita' di pista, mai in campioni.
- **Baseline dei test**, misurata nel worktree il 2026-08-25 prima di iniziare: `node --test frontend/shared/` → **4 rossi**; `node --test backend/` → **8 rossi**. Un rosso in piu' rispetto a questa baseline e' una regressione, non "un test che era gia' cosi'".
  ⚠️ Sono 4 e non 5 come sulla working copy dell'utente: il quinto rosso e' quello di `nuova-pista`, che sta solo sul suo disco e non nel repo. Nel worktree quel file non esiste, quindi quel test non fallisce.

---

### Task 1: La misura della pendenza, una volta sola

`TrackGeometry` ha gia' `tangentAt` e `normalAt` con la stessa finestra (campione prima / campione dopo). La pendenza si aggiunge li' accanto, e diventa l'unica definizione: oggi il client ne ha una copia in `f1.js:584` (`trackPitchAt`), che il Task 5 rimuovera'.

**Files:**
- Modify: `frontend/shared/trackGeometry.js` (accanto a `normalAt`, ~riga 266; e l'export in fondo)
- Test: `frontend/shared/trackGeometry.test.js`

**Interfaces:**
- Consumes: niente
- Produces: `TrackGeometry.pendenzaAt(points, i, closed) -> number` (radianti, positiva in salita)

- [ ] **Step 1: Scrivere il test che fallisce**

In fondo a `frontend/shared/trackGeometry.test.js`:

```js
// --- pendenzaAt (fase 1a: gravita' lungo il nastro) ---

// Una rampa dritta lungo z, che sale di 1 ogni 10 unita' = 10% = atan(0.1).
function rampa(pendenzaPct, n) {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push({ x: 0, z: i * 10, y: i * 10 * pendenzaPct / 100 });
    return pts;
}

test('pendenzaAt e\' positiva in salita e vale atan della pendenza', () => {
    const pts = rampa(10, 20);
    const attesa = Math.atan2(1, 10);   // +10%
    for (let i = 1; i < pts.length - 1; i++) {
        assert.ok(Math.abs(TrackGeometry.pendenzaAt(pts, i, false) - attesa) < 1e-9,
            `campione ${i}: ${TrackGeometry.pendenzaAt(pts, i, false)} invece di ${attesa}`);
    }
});

test('pendenzaAt e\' negativa in discesa, simmetrica alla salita', () => {
    const su = rampa(10, 20), giu = rampa(-10, 20);
    assert.ok(Math.abs(TrackGeometry.pendenzaAt(su, 5, false) + TrackGeometry.pendenzaAt(giu, 5, false)) < 1e-12);
});

test('pendenzaAt e\' zero su un tracciato piatto, anche senza il campo y', () => {
    const piatto = [{ x: 0, z: 0 }, { x: 0, z: 10 }, { x: 0, z: 20 }, { x: 0, z: 30 }];
    assert.equal(TrackGeometry.pendenzaAt(piatto, 1, false), 0);
    assert.equal(TrackGeometry.pendenzaAt(piatto, 2, true), 0);
});

// Su un giro chiuso il campione 0 guarda l'ultimo campione, non se stesso:
// senza il wrap la pendenza al traguardo sarebbe sempre meta' di quella vera.
test('pendenzaAt chiude il giro: il campione 0 usa l\'ultimo campione', () => {
    const anello = [
        { x: 0, z: 0, y: 0 }, { x: 10, z: 0, y: 1 },
        { x: 10, z: 10, y: 2 }, { x: 0, z: 10, y: 1 }
    ];
    const p0 = TrackGeometry.pendenzaAt(anello, 0, true);
    // Fra il campione 3 (y=1) e il campione 1 (y=1) il dislivello e' nullo.
    assert.ok(Math.abs(p0) < 1e-12, `pendenza al traguardo: ${p0}`);
});
```

- [ ] **Step 2: Eseguire il test e vederlo fallire**

Run: `node --test frontend/shared/trackGeometry.test.js`
Expected: FAIL — `TrackGeometry.pendenzaAt is not a function`

- [ ] **Step 3: Implementare**

In `frontend/shared/trackGeometry.js`, subito dopo `normalAt`:

```js
    // Pendenza del tracciato al campione `i`, in RADIANTI e POSITIVA IN
    // SALITA. Stessa finestra di tangentAt (campione prima / campione dopo):
    // la direzione e la pendenza devono parlare dello stesso pezzo di pista,
    // o su un tratto corto raccontano due cose diverse.
    //
    // ⚠️ SEGNO. Qui positiva = si sale, che e' cio' che serve alla fisica
    // (la gravita' frena chi sale). Chi la usa per RUOTARE una mesh deve
    // NEGARLA: in Three una rotazione X positiva abbassa il muso. Vedi
    // f1.js, trackPitchAt.
    function pendenzaAt(points, i, closed) {
        const n = points.length;
        const next = closed ? points[(i + 1) % n] : points[Math.min(i + 1, n - 1)];
        const prev = closed ? points[(i - 1 + n) % n] : points[Math.max(i - 1, 0)];
        const dy = (next.y || 0) - (prev.y || 0);
        const horiz = Math.hypot(next.x - prev.x, next.z - prev.z) || 1e-6;
        return Math.atan2(dy, horiz);
    }
```

E nell'export in fondo al file, accanto a `curvatureAt`:

```js
        pendenzaAt,
```

- [ ] **Step 4: Eseguire il test e vederlo passare**

Run: `node --test frontend/shared/trackGeometry.test.js`
Expected: PASS su tutti e quattro i test nuovi, e nessuna regressione sugli altri del file.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/trackGeometry.js frontend/shared/trackGeometry.test.js
git commit -m "La pendenza del tracciato ha una definizione sola

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: La pendenza cotta su ogni campione

Stessa regola della larghezza locale: si riempie **qui e in nessun altro posto**, cosi' da valle in poi `p.pendenza` c'e' sempre e nessuno inventa un ripiego. Un ingombro di ripiego silenzioso ha gia' fatto giudicare tredici asset come cubi 6x6x6 con tutti i test verdi.

**Files:**
- Modify: `backend/sockets/games/trackLoader.js:145-150` (subito dopo il ciclo che garantisce `halfWidth`)
- Test: `backend/sockets/games/trackLoader.test.js`

**Interfaces:**
- Consumes: `TrackGeometry.pendenzaAt(points, i, closed)` dal Task 1
- Produces: `track.points[i].pendenza` — numero finito in radianti su **ogni** campione di **ogni** pista

- [ ] **Step 1: Scrivere il test che fallisce**

In fondo a `backend/sockets/games/trackLoader.test.js`:

```js
// --- pendenza per campione (fase 1a: gravita' lungo il nastro) ---

test('ogni campione ha una pendenza finita, su tutte le piste', () => {
    for (const t of listTracks()) {
        const track = loadTrack(t.id || t);
        for (let i = 0; i < track.points.length; i++) {
            assert.equal(typeof track.points[i].pendenza, 'number',
                `${t.id || t} campione ${i}: pendenza mancante`);
            assert.ok(Number.isFinite(track.points[i].pendenza),
                `${t.id || t} campione ${i}: pendenza non finita`);
        }
    }
});

test('una pista senza dislivelli ha pendenza zero ovunque', () => {
    const track = loadTrack('monte-rosso');
    for (const p of track.points) assert.ok(Math.abs(p.pendenza) < 1e-9);
});

// prova sale e scende davvero (quota da 0 a 11.5): se la pendenza fosse
// sempre zero il campo ci sarebbe ma non direbbe niente, ed e' proprio il
// modo in cui un valore di ripiego passa inosservato.
test('prova ha pendenze vere, in salita e in discesa', () => {
    const track = loadTrack('prova');
    const pct = track.points.map(p => Math.tan(p.pendenza) * 100);
    assert.ok(Math.max(...pct) > 5, `salita massima ${Math.max(...pct).toFixed(1)}%`);
    assert.ok(Math.min(...pct) < -5, `discesa massima ${Math.min(...pct).toFixed(1)}%`);
});

test('la pendenza cotta e\' esattamente quella di TrackGeometry.pendenzaAt', () => {
    const track = loadTrack('prova');
    for (let i = 0; i < track.points.length; i += 37) {
        assert.equal(track.points[i].pendenza, TrackGeometry.pendenzaAt(track.points, i, true));
    }
});
```

Se `listTracks`, `loadTrack` o `TrackGeometry` non sono gia' importati in cima al file di test, aggiungerli con la stessa forma usata dagli altri test del file.

- [ ] **Step 2: Eseguire il test e vederlo fallire**

Run: `node --test backend/sockets/games/trackLoader.test.js`
Expected: FAIL — `pendenza mancante` sul primo campione della prima pista.

- [ ] **Step 3: Implementare**

In `backend/sockets/games/trackLoader.js`, subito dopo il ciclo che garantisce `p.halfWidth`:

```js
    // LA PENDENZA LOCALE, GARANTITA SU OGNI CAMPIONE.
    //
    // Stessa regola della larghezza qui sopra: si calcola qui, una volta, e da
    // valle in poi `p.pendenza` c'e' sempre — la fisica non deve chiedersi «e
    // se mancasse?» ne' ricalcolarla ad ogni tick per ogni auto.
    //
    // La misura e' quella di TrackGeometry.pendenzaAt: la stessa funzione con
    // cui il client inclina l'auto. Il giocatore vede una salita e la fisica
    // ne sente un'altra solo se le misure sono due.
    for (let i = 0; i < points.length; i++) {
        points[i].pendenza = TrackGeometry.pendenzaAt(points, i, true);
    }
```

⚠️ Il ciclo **legge** `y` dei campioni vicini e **scrive** `pendenza`: sono campi diversi, quindi calcolare in place e' corretto e non serve una copia dell'array.

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test backend/sockets/games/trackLoader.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/sockets/games/trackLoader.js backend/sockets/games/trackLoader.test.js
git commit -m "Ogni campione di pista sa quanto sale

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Il modello — da una pendenza a un'accelerazione

Modulo puro, come gli altri di `physics/`: non tocca `p`, non conosce la pista, non ha stato. Il valore di `G_NASTRO` che si scrive qui e' un **punto di partenza motivato**, non il valore finale: lo decide il Task 7.

**Files:**
- Create: `backend/sockets/games/physics/GravitaNastro.js`
- Test: `backend/sockets/games/physics/GravitaNastro.test.js`

**Interfaces:**
- Consumes: niente
- Produces: `G_NASTRO` (number), `isGravitaNastroActive() -> boolean`, `accelerazionePendenza(pendenza) -> number` (u/tick^2, negativa in salita)

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `backend/sockets/games/physics/GravitaNastro.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { G_NASTRO, accelerazionePendenza, isGravitaNastroActive } = require('./GravitaNastro.js');

test('in piano la gravita\' non fa niente', () => {
    assert.equal(accelerazionePendenza(0), 0);
});

test('in salita frena, in discesa spinge', () => {
    assert.ok(accelerazionePendenza(0.1) < 0, 'la salita deve togliere velocita\'');
    assert.ok(accelerazionePendenza(-0.1) > 0, 'la discesa deve darne');
});

test('salita e discesa della stessa pendenza sono simmetriche', () => {
    assert.ok(Math.abs(accelerazionePendenza(0.3) + accelerazionePendenza(-0.3)) < 1e-15);
});

test('a 90 gradi vale tutta la gravita\'', () => {
    assert.ok(Math.abs(accelerazionePendenza(Math.PI / 2) + G_NASTRO) < 1e-12);
});

// Una pendenza mancante o malformata deve valere "piano", non NaN: un NaN in
// p.speed si propaga silenziosamente a posizione, classifica e tempi sul giro.
test('una pendenza assente o non numerica vale zero, mai NaN', () => {
    assert.equal(accelerazionePendenza(undefined), 0);
    assert.equal(accelerazionePendenza(null), 0);
    assert.equal(accelerazionePendenza(NaN), 0);
    assert.equal(accelerazionePendenza('0.2'), 0);
});

test('il flag e\' spento se la variabile d\'ambiente non vale 1', () => {
    const prima = process.env.F1_GRAVITA_NASTRO;
    delete process.env.F1_GRAVITA_NASTRO;
    assert.equal(isGravitaNastroActive(), false);
    process.env.F1_GRAVITA_NASTRO = '0';
    assert.equal(isGravitaNastroActive(), false);
    process.env.F1_GRAVITA_NASTRO = '1';
    assert.equal(isGravitaNastroActive(), true);
    if (prima === undefined) delete process.env.F1_GRAVITA_NASTRO;
    else process.env.F1_GRAVITA_NASTRO = prima;
});
```

- [ ] **Step 2: Eseguire il test e vederlo fallire**

Run: `node --test backend/sockets/games/physics/GravitaNastro.test.js`
Expected: FAIL — `Cannot find module './GravitaNastro.js'`

- [ ] **Step 3: Implementare**

Creare `backend/sockets/games/physics/GravitaNastro.js`:

```js
// backend/sockets/games/physics/GravitaNastro.js
//
// Gravita' lungo il nastro — fase 1a (Rif.
// docs/superpowers/specs/2026-08-25-f1-nastro-orientato-design.md).
// Salire costa velocita', scendere la restituisce.
//
// Responsabilita' UNICA: da una pendenza in radianti all'accelerazione
// longitudinale da sommare. Non tocca `p`, non conosce la pista, non ha
// stato. Chi la applica e' VehiclePhysics.updateVelocity.

// QUANTO PESA LA GRAVITA', E PERCHE' NON E' QUELLA VERA.
//
// La fisica di questo gioco non e' in scala: ACCEL vale 0.186 u/tick^2, cioe'
// diverse volte l'accelerazione di un'auto vera. Una gravita' fisicamente
// esatta (~0.03 u/tick^2 con le conversioni del gioco) su una salita del 10%
// toglierebbe circa l'1% dell'accelerazione disponibile: invisibile, e la
// fase 1a sarebbe stata implementata per niente.
//
// Il valore parte quindi dal RAPPORTO, non dal numero assoluto: in un'auto
// vera l'accelerazione longitudinale di punta vale poco piu' di 1 g, quindi
// G_NASTRO ~ ACCEL / 1.2. Da qui la taratura del Task 7 lo sposta.
//
// ⚠️ Controllo incrociato con la fase 2: dentro un giro della morte la
// velocita' minima per non fermarsi in cima vale circa sqrt(G_NASTRO * R).
// Con R = 30 unita' e questo valore servono ~2.2 u/tick, poco piu' di un
// terzo della velocita' massima: il loop diventa una cosa da prendere bene,
// non un muro. Se la taratura abbassa molto G_NASTRO, quel conto va rifatto.
const G_NASTRO = 0.155;

function isGravitaNastroActive() {
    return process.env.F1_GRAVITA_NASTRO === '1';
}

// Negativa in salita (frena), positiva in discesa (spinge). Una pendenza
// assente o malformata vale "piano": un NaN qui finirebbe in p.speed e da li'
// in posizione, tempi sul giro e classifica, senza un errore che lo dica.
function accelerazionePendenza(pendenza) {
    if (typeof pendenza !== 'number' || !Number.isFinite(pendenza)) return 0;
    return -G_NASTRO * Math.sin(pendenza);
}

module.exports = { G_NASTRO, isGravitaNastroActive, accelerazionePendenza };
```

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test backend/sockets/games/physics/GravitaNastro.test.js`
Expected: PASS (6 test).

- [ ] **Step 5: Commit**

```bash
git add backend/sockets/games/physics/GravitaNastro.js backend/sockets/games/physics/GravitaNastro.test.js
git commit -m "Il modello della gravita' lungo il nastro, spento

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: L'innesto nella fisica

Due modifiche piccole e in due posti soli: `updateTrackIndex` scrive la pendenza su `p`, `updateVelocity` la usa. La firma di `updateVelocity` **non cambia**: i suoi chiamanti esterni (`f1LapSimulator`, `f1RaceLineOptimizer`) continuano a funzionare senza sapere niente della pista.

⚠️ Nel tick, `updateVelocity` gira **prima** di `updateTrackIndex` (vedi `tickGame`): la fisica usa quindi la pendenza del tick precedente, 50 ms di ritardo su una grandezza che cambia lentamente. E' un compromesso voluto, va scritto nel commento perche' non sembri una svista.

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js:2304-2306` (`updateTrackIndex`)
- Modify: `backend/sockets/games/physics/VehiclePhysics.js:15-22` (import) e `:38-46` (dentro `updateVelocity`)
- Test: `backend/sockets/games/f1GameSocket.physics.test.js`

**Interfaces:**
- Consumes: `accelerazionePendenza`, `isGravitaNastroActive` dal Task 3; `track.points[i].pendenza` dal Task 2
- Produces: `p.pendenza` (radianti) su ogni giocatore dopo `updateTrackIndex`

- [ ] **Step 1: Scrivere il test che fallisce**

In fondo a `backend/sockets/games/f1GameSocket.physics.test.js`, seguendo la forma con cui gli altri test del file costruiscono un giocatore e una pista finta:

```js
// --- gravita' lungo il nastro (fase 1a) ---

function conFlagGravita(valore, fn) {
    const prima = process.env.F1_GRAVITA_NASTRO;
    if (valore === null) delete process.env.F1_GRAVITA_NASTRO;
    else process.env.F1_GRAVITA_NASTRO = valore;
    try { return fn(); }
    finally {
        if (prima === undefined) delete process.env.F1_GRAVITA_NASTRO;
        else process.env.F1_GRAVITA_NASTRO = prima;
    }
}

// Un giocatore lanciato a meta' velocita' col gas premuto, su una pendenza
// data: si guarda solo quanto vale p.speed dopo UN tick di updateVelocity.
function velocitaDopoUnTick(pendenza, flag) {
    return conFlagGravita(flag, () => {
        const p = {
            speed: 3, vx: 0, vz: 3, angle: 0, x: 0, z: 0,
            inputs: { throttle: 1, brake: 0, steer: 0 },
            compound: 'medium', tyreWear: 0, pendenza
        };
        physics.updateVelocity(p, true, 1);
        return p.speed;
    });
}

test('a flag spento la pendenza non cambia niente', () => {
    const piano = velocitaDopoUnTick(0, null);
    const salita = velocitaDopoUnTick(0.2, null);
    const discesa = velocitaDopoUnTick(-0.2, null);
    assert.equal(salita, piano);
    assert.equal(discesa, piano);
});

test('a flag acceso la salita toglie velocita\' e la discesa la aggiunge', () => {
    const piano = velocitaDopoUnTick(0, '1');
    const salita = velocitaDopoUnTick(0.2, '1');
    const discesa = velocitaDopoUnTick(-0.2, '1');
    assert.ok(salita < piano, `salita ${salita} non e\' sotto piano ${piano}`);
    assert.ok(discesa > piano, `discesa ${discesa} non e\' sopra piano ${piano}`);
    assert.ok(Math.abs((piano - salita) - (discesa - piano)) < 1e-12, 'salita e discesa non sono simmetriche');
});

// In discesa il tetto di velocita' resta quello dell'auto: la gravita' non
// deve poter spingere nessuno oltre il massimo della sua mescola.
test('la discesa non fa superare la velocita\' massima', () => {
    conFlagGravita('1', () => {
        const p = {
            speed: physics.MAX_SPEED, vx: 0, vz: physics.MAX_SPEED, angle: 0, x: 0, z: 0,
            inputs: { throttle: 1, brake: 0, steer: 0 },
            compound: 'medium', tyreWear: 0, pendenza: -0.4
        };
        physics.updateVelocity(p, true, 1);
        assert.ok(p.speed <= physics.effectiveMaxSpeed(p, true) + 1e-12,
            `${p.speed} oltre il massimo`);
    });
});

// Un giocatore senza il campo (test storici, strumenti offline che non
// chiamano updateTrackIndex) deve comportarsi come in piano, mai NaN.
test('senza p.pendenza la fisica resta quella di prima', () => {
    conFlagGravita('1', () => {
        const p = {
            speed: 3, vx: 0, vz: 3, angle: 0, x: 0, z: 0,
            inputs: { throttle: 1, brake: 0, steer: 0 },
            compound: 'medium', tyreWear: 0
        };
        physics.updateVelocity(p, true, 1);
        assert.ok(Number.isFinite(p.speed));
        assert.equal(p.speed, velocitaDopoUnTick(0, '1'));
    });
});

test('updateTrackIndex porta la pendenza del campione su p', () => {
    const track = loadTrack('prova');
    const p = { x: track.points[10].x, z: track.points[10].z, trackIndex: 10 };
    physics.updateTrackIndex(p, track);
    assert.equal(p.pendenza, track.points[p.trackIndex].pendenza);
});
```

Se `loadTrack` non e' gia' importato nel file di test, aggiungerlo come negli altri test che caricano una pista vera.

- [ ] **Step 2: Eseguire il test e vederlo fallire**

Run: `node --test backend/sockets/games/f1GameSocket.physics.test.js`
Expected: FAIL — a flag acceso salita e piano danno lo stesso valore, e `p.pendenza` resta `undefined` dopo `updateTrackIndex`.

- [ ] **Step 3: Implementare**

In `backend/sockets/games/physics/VehiclePhysics.js`, accanto agli altri import:

```js
const { isGravitaNastroActive, accelerazionePendenza } = require('./GravitaNastro');
```

e dentro `updateVelocity`, **dopo** il blocco `throttle/brake/coast` e **prima** del clamp `if (p.speed > maxSpeed)`:

```js
    // Gravita' lungo il nastro (fase 1a, flag F1_GRAVITA_NASTRO): salire costa
    // velocita', scendere la restituisce. La pendenza arriva su `p`, scritta da
    // updateTrackIndex — che nel tick gira DOPO di qui, quindi il valore e'
    // quello del tick precedente: 50 ms di ritardo su una grandezza che cambia
    // lentamente, in cambio del fatto che nessun chiamante di updateVelocity
    // (compresi f1LapSimulator e f1RaceLineOptimizer) deve conoscere la pista.
    //
    // Sta PRIMA del tetto di velocita' apposta: in discesa la gravita' non deve
    // poter spingere oltre il massimo della mescola. In salita p.speed puo'
    // invece andare sotto zero, ed e' voluto — ci si ferma e si riscende
    // all'indietro, che e' cio' che nella fase 2 impedisce di percorrere un
    // giro della morte a passo d'uomo.
    if (isGravitaNastroActive()) p.speed += accelerazionePendenza(p.pendenza);
```

In `backend/sockets/games/f1GameSocket.js`, `updateTrackIndex`:

```js
function updateTrackIndex(p, track) {
    p.trackIndex = TrackGeometry.nearestIndexNear(track.points, p.trackIndex || 0, p.x, p.z, TRACK_INDEX_WINDOW);
    // La pendenza sotto l'auto viaggia su `p` accanto all'indice, scritta da un
    // posto solo: e' lo stesso schema con cui il rollio arrivera' nella fase
    // 1b. Il campo e' garantito su ogni campione da trackLoader, quindi qui non
    // serve nessun ripiego.
    p.pendenza = track.points[p.trackIndex].pendenza;
}
```

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test backend/sockets/games/f1GameSocket.physics.test.js`
Expected: PASS sui test nuovi.

Poi, per verificare che a flag spento non sia cambiato niente altrove:

Run: `node --test backend/`
Expected: gli **stessi 8 rossi** della baseline, non uno di piu'.

- [ ] **Step 5: Commit**

```bash
git add backend/sockets/games/physics/VehiclePhysics.js backend/sockets/games/f1GameSocket.js backend/sockets/games/f1GameSocket.physics.test.js
git commit -m "La salita frena e la discesa spinge, dietro l'interruttore

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Il client usa la stessa misura

`f1.js:584` ha una copia della formula della pendenza. Due copie della stessa misura finiscono per divergere, e quel giorno non si sa a chi credere — e' successo con la linea verde delle rampe nell'editor, curata togliendo la seconda copia, non correggendola.

**Files:**
- Modify: `frontend/f1.js:584-591` (`trackPitchAt`)
- Modify: `frontend/f1.html` (bump del cache-busting `?v=` su `f1.js`)
- Test: `frontend/shared/trackGeometry.test.js`

**Interfaces:**
- Consumes: `TrackGeometry.pendenzaAt` dal Task 1
- Produces: niente di nuovo

- [ ] **Step 1: Scrivere il test di equivalenza che protegge il segno**

In `frontend/shared/trackGeometry.test.js`:

```js
// Il beccheggio visivo dell'auto e' la pendenza NEGATA (in Three una
// rotazione X positiva abbassa il muso). Questo test blocca il segno: se
// pendenzaAt cambiasse verso, l'auto si inclinerebbe al contrario sulle
// salite e nessun altro test se ne accorgerebbe.
test('il beccheggio visivo e\' la pendenza negata (formula storica di f1.js)', () => {
    const anello = [
        { x: 0, z: 0, y: 0 }, { x: 10, z: 0, y: 1 }, { x: 20, z: 0, y: 3 },
        { x: 30, z: 0, y: 3 }, { x: 40, z: 0, y: 1 }, { x: 50, z: 0, y: 0 }
    ];
    for (let i = 0; i < anello.length; i++) {
        const n = anello.length;
        const prev = anello[(i - 1 + n) % n], next = anello[(i + 1) % n];
        const dy = (next.y || 0) - (prev.y || 0);
        const horiz = Math.hypot(next.x - prev.x, next.z - prev.z) || 1e-6;
        const storica = -Math.atan2(dy, horiz);     // trackPitchAt di f1.js
        assert.equal(-TrackGeometry.pendenzaAt(anello, i, true), storica);
    }
});
```

- [ ] **Step 2: Eseguire il test**

Run: `node --test frontend/shared/trackGeometry.test.js`
Expected: PASS gia' ora (il Task 1 ha implementato la funzione). Se fallisce, il segno del Task 1 e' sbagliato: correggere **quello**, non il test.

- [ ] **Step 3: Sostituire la copia nel client**

In `frontend/f1.js`, rimpiazzare il corpo di `trackPitchAt`:

```js
    // Beccheggio visivo dell'auto: e' la STESSA misura che la fisica usa per la
    // gravita' lungo il nastro (TrackGeometry.pendenzaAt), negata perche' in
    // Three una rotazione X positiva abbassa il muso. Qui c'era una copia della
    // formula: due copie della stessa misura finiscono per divergere.
    function trackPitchAt(idx) {
        return -TrackGeometry.pendenzaAt(trackPts, idx, true);
    }
```

- [ ] **Step 4: Bump del cache-busting**

In `frontend/f1.html`, incrementare il numero di versione sul tag `<script>` di `f1.js` (`?v=...`). Senza, il browser serve il JS vecchio e sembra che non sia cambiato niente.

- [ ] **Step 5: Verificare che il client non si sia rotto**

Run: `node --test frontend/shared/`
Expected: gli **stessi 5 rossi** della baseline.

⚠️ `f1.js` non ha test propri: la verifica vera e' il playtest del Task 7. Qui ci si limita a controllare che il modulo condiviso sia sano e che `TrackGeometry` sia effettivamente disponibile in `f1.js` (e' gia' incluso in `f1.html`, verificarlo prima di dichiarare fatto il passo).

- [ ] **Step 6: Commit**

```bash
git add frontend/f1.js frontend/f1.html frontend/shared/trackGeometry.test.js
git commit -m "Il beccheggio dell'auto e la fisica leggono la stessa pendenza

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Il banco di taratura

Uno strumento, non un test: stampa il confronto fra flag spento e acceso sulla stessa pista, cosi' il valore di `G_NASTRO` si sceglie con dei numeri davanti.

⚠️ Due trappole gia' pagate su questo banco: `f1LapSimulator` e' **rumoroso** (`botLapPaceMult` si ri-randomizza piu' volte a giro) — quindi **N=30, mai un run singolo**; e un flag di guida **non si misura sul tempo sul giro** — qui la misura principale sono le velocita' nei tratti in pendenza.

**Files:**
- Create: `backend/tools/f1-gravita-taratura.js`

**Interfaces:**
- Consumes: `simulateLap(track, opts) -> { finished, timeMs, telemetry }` e `parseArgs(argv) -> opts` da `f1LapSimulator` (telemetria con `tick`, `idx`, `speedKmh`, `x`, `z`); `loadTrack` da `trackLoader`
- Produces: uno script eseguibile a mano, nessuna API

⚠️ Le opzioni si prendono da `parseArgs([pista])`, non si costruiscono a mano: cosi' il banco gira con gli **stessi default** dello strumento ufficiale (`speedFactor`, `paceMult`, `precisionNoise`, `safetyCapS`). Un banco tarato su opzioni diverse da quelle di tutti gli altri misura un'auto che nessuno guida.

- [ ] **Step 1: Scrivere lo strumento**

Creare `backend/tools/f1-gravita-taratura.js`:

```js
// backend/tools/f1-gravita-taratura.js
//
// Banco di taratura della gravita' lungo il nastro (fase 1a, Rif.
// docs/superpowers/specs/2026-08-25-f1-nastro-orientato-design.md).
//
// Confronta flag spento e flag acceso sulla stessa pista e stampa DOVE la
// differenza si vede: la velocita' media nei campioni in salita, in discesa e
// in piano. Il tempo sul giro e' stampato per ultimo e vale come contorno —
// un flag di guida si giudica dove agisce, non sul totale.
//
// Uso:  node backend/tools/f1-gravita-taratura.js [pista] [ripetizioni]
//       node backend/tools/f1-gravita-taratura.js prova 30
const { loadTrack } = require('../sockets/games/trackLoader.js');

// Soglia di "tratto in pendenza": 5% (0.05 di tangente). Su prova ci cade il
// 7% dei campioni, con punte del +10.7% e del -6.9%.
const SOGLIA_PCT = 5;

function media(v) { return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; }

// Le opzioni sono quelle di default dello strumento ufficiale: il banco deve
// misurare la stessa auto che misurano tutti gli altri.
function opzioni(pista) {
    const { parseArgs } = require('./f1LapSimulator.js');
    return parseArgs([pista]);
}

function misura(track, pista, ripetizioni) {
    const { simulateLap } = require('./f1LapSimulator.js');
    const opts = opzioni(pista);
    const salita = [], discesa = [], piano = [], tempi = [];
    for (let r = 0; r < ripetizioni; r++) {
        // Nessun seme da passare: il rumore del banco viene da botLapPaceMult,
        // che il bot si ri-randomizza da solo piu' volte per giro. E' esattamente
        // il motivo per cui i giri sono 30 e mai uno.
        const res = simulateLap(track, opts);
        if (res.timeMs) tempi.push(res.timeMs);
        for (const t of res.telemetry || []) {
            const pct = Math.tan(track.points[t.idx].pendenza) * 100;
            if (pct > SOGLIA_PCT) salita.push(t.speedKmh);
            else if (pct < -SOGLIA_PCT) discesa.push(t.speedKmh);
            else piano.push(t.speedKmh);
        }
    }
    return {
        salita: media(salita), discesa: media(discesa), piano: media(piano),
        tempo: media(tempi), giriValidi: tempi.length
    };
}

function main() {
    const pista = process.argv[2] || 'prova';
    const ripetizioni = parseInt(process.argv[3], 10) || 30;
    const track = loadTrack(pista);

    delete process.env.F1_GRAVITA_NASTRO;
    const spento = misura(track, pista, ripetizioni);
    process.env.F1_GRAVITA_NASTRO = '1';
    const acceso = misura(track, pista, ripetizioni);
    delete process.env.F1_GRAVITA_NASTRO;

    const { G_NASTRO } = require('../sockets/games/physics/GravitaNastro.js');
    const riga = (nome, a, b) => {
        const delta = b - a;
        const pct = a ? (delta / a * 100) : 0;
        console.log(`  ${nome.padEnd(22)} ${a.toFixed(1).padStart(8)} ${b.toFixed(1).padStart(8)}  ${(delta >= 0 ? '+' : '')}${delta.toFixed(1).padStart(7)}  ${(pct >= 0 ? '+' : '')}${pct.toFixed(1)}%`);
    };

    console.log(`\nPista: ${pista} — ${ripetizioni} giri per configurazione — G_NASTRO = ${G_NASTRO}`);
    console.log(`Campioni oltre il ${SOGLIA_PCT}% di pendenza contano come salita/discesa.\n`);
    console.log('  ' + 'misura'.padEnd(22) + '  spento'.padStart(8) + '  acceso'.padStart(8) + '    delta      %');
    riga('velocita\' in salita', spento.salita, acceso.salita);
    riga('velocita\' in discesa', spento.discesa, acceso.discesa);
    riga('velocita\' in piano', spento.piano, acceso.piano);
    console.log('');
    riga('tempo sul giro (ms)', spento.tempo, acceso.tempo);
    console.log(`\n  giri completati: ${spento.giriValidi}/${ripetizioni} spento, ${acceso.giriValidi}/${ripetizioni} acceso`);
    if (acceso.giriValidi < ripetizioni) {
        console.log('  ⚠️  a flag acceso qualche giro non si chiude: G_NASTRO e\' probabilmente troppo alto.');
    }
    console.log('');
}

main();
```

Firma e ritorno di `simulateLap` sono gia' stati verificati mentre si scriveva questo piano (`backend/tools/f1LapSimulator.js:48` e `:112`): `{ finished, timeMs, telemetry }`, e `parseArgs` e' esportata insieme a lui. Non c'e' niente da indovinare.

- [ ] **Step 2: Eseguirlo a flag spento su entrambe le configurazioni**

Run: `node backend/tools/f1-gravita-taratura.js prova 5`
Expected: stampa la tabella senza errori. Con 5 giri i numeri sono rumorosi: serve solo a vedere che lo strumento gira.

- [ ] **Step 3: Verificare che il banco veda davvero il flag**

Run: `node backend/tools/f1-gravita-taratura.js prova 5` e controllare che la colonna "acceso" **differisca** da "spento" nelle righe salita/discesa.

⚠️ Se le due colonne fossero identiche, il banco e' cieco — ed e' gia' successo su questo simulatore (`isQuali` era hardcoded). In quel caso **fermarsi e trovare il perche'**: un banco che non vede il flag fa tarare a vuoto.

- [ ] **Step 4: Commit**

```bash
git add backend/tools/f1-gravita-taratura.js
git commit -m "Un banco per vedere quanto pesa la gravita'

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: La taratura, e la consegna al playtest

Qui non si scrive codice nuovo: si sceglie **un numero** con i dati davanti, e si consegna all'utente qualcosa che possa provare.

**Files:**
- Modify: `backend/sockets/games/physics/GravitaNastro.js` (il valore di `G_NASTRO` e il commento che lo motiva)

- [ ] **Step 1: Misurare col banco, N=30**

Run: `node backend/tools/f1-gravita-taratura.js prova 30`

Annotare le tre righe di velocita' e il tempo sul giro.

- [ ] **Step 2: Confrontare col criterio**

Il valore va scelto perche' **si senta senza stravolgere**. Criterio:

- la velocita' media **in salita** deve calare in modo **percepibile ma non punitivo**: indicativamente fra il **3% e l'8%**;
- la velocita' **in discesa** deve salire di un ordine simile (la simmetria e' garantita dalla formula, non dalla taratura: se non e' cosi', qualcosa non torna nel banco);
- la velocita' **in piano** deve restare praticamente invariata (scarto sotto l'1%): se cambia, l'effetto sta arrivando da qualcos'altro e va capito prima di continuare;
- **tutti i 30 giri devono chiudersi** a flag acceso.

Se la salita cala meno del 3%, alzare `G_NASTRO`; se supera l'8% o qualche giro non si chiude, abbassarlo. Rimisurare dopo ogni cambio. ⚠️ Un parametro giusto **si supera**: provare almeno un valore che sia chiaramente **troppo**, per sapere da che parte sta il limite. Se la correzione e' sempre "un po' di piu'", la leva e' sbagliata.

- [ ] **Step 3: Controllare se i bot arrivano lunghi**

La spec lo dichiara come rischio noto: i bot scelgono dove frenare da
`cornerTargetSpeed`, che **non conosce la pendenza**. In fondo a una discesa
arrivano piu' veloci di quanto avevano previsto.

Come si vede, senza inventare una misura nuova:

Run: `node backend/tools/f1LapSimulator.js prova` a flag spento e poi con
`F1_GRAVITA_NASTRO=1`, confrontando la riga «Curve piu lente».

Sintomi da cercare: una curva in fondo a una discesa che a flag acceso passa da
completata a **giro non completato**, oppure una velocita' minima molto piu'
alta in quel punto (il bot ci arriva lungo e finisce sulla via di fuga). Il
banco del Task 6 lo mostra anche come giri non chiusi su 30.

**Se il sintomo c'e'**: non correggerlo qui. Va aperto un task suo, dove si
passa la pendenza a `cornerTargetSpeed` — un parametro in piu' a una formula
che esiste gia', non un modello nuovo. Annotarlo e portarlo all'utente insieme
al playtest: e' una sua decisione se la fase 1a si chiude prima o dopo quella
correzione.

**Se non c'e'**: scriverlo comunque nel commento di `G_NASTRO`, con il valore a
cui e' stato verificato. Il giorno che qualcuno alzera' la gravita', quel
controllo va rifatto.

- [ ] **Step 4: Rifare il controllo incrociato con la fase 2**

Col valore scelto, calcolare `sqrt(G_NASTRO * 30)` (velocita' minima indicativa per un loop di raggio 30 unita') e confrontarla con `MAX_SPEED = 6.2`. Se il risultato supera ~4 (due terzi della velocita' massima), il loop della fase 2 sara' quasi impossibile: annotarlo nel commento di `G_NASTRO`, perche' quel giorno servira'.

- [ ] **Step 5: Scrivere il valore e il perche'**

Aggiornare `G_NASTRO` e il suo commento in `GravitaNastro.js` con: il valore scelto, i numeri misurati che lo giustificano (salita -x%, discesa +y%), la data, e l'esito del controllo incrociato dello Step 4, e l'esito del controllo sui bot dello Step 3.

- [ ] **Step 6: Commit**

```bash
git add backend/sockets/games/physics/GravitaNastro.js
git commit -m "La gravita' tarata: quanto costa una salita

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Consegnare il playtest**

Fermarsi qui e dare all'utente **le istruzioni per provare**, non un riassunto tecnico:

- come si accende: avviare il server con `F1_GRAVITA_NASTRO=1` (dalla cartella `backend/`), e come si spegne per confrontare;
- **su quale pista**: `prova`, l'unica con dislivelli veri (da 0 a 11.5 unita');
- **cosa guardare**: il tratto in salita e quello in discesa, non il tempo sul giro;
- la domanda a cui rispondere: si sente? e' troppo o troppo poco?

⚠️ **Non accendere il flag di default prima del suo giudizio.** `TyreSlipModel` era stato acceso senza questo passaggio ed e' finito ribocciato al playtest.

---

## Verifiche finali (prima di dichiarare chiusa la fase 1a)

- [ ] `node --test frontend/shared/` → **5 rossi**, gli stessi della baseline
- [ ] `node --test backend/` → **8 rossi**, gli stessi della baseline
- [ ] A flag spento, un giro simulato da' **lo stesso tempo** di prima della fase 1a (il banco lo mostra nella colonna "spento": confrontarla col valore misurato prima di iniziare)
- [ ] `git status` non mostra fra i file committati nessuno dei file dell'utente (`frontend/tracks/nuova-pista.json`, `backend/tools/prova-*-raceline.json`)
