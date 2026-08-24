# F1 — Bug di scenografia, la cura alla radice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nessuna pista — comprese quelle che l'utente creerà domani — può più avere oggetti dentro la carreggiata o la corsia box, oggetti compenetrati fra loro, il ponte dei semafori lontano dalla griglia o tribune senza rete.

**Architecture:** Due strati. **Prevenzione**: il registro di ciò che è già a terra diventa completo, così ogni costruttore vede davvero cosa c'è e sceglie meglio. **Garanzia**: una sola porta (`sceneryRegistro`) attraverso cui passa tutto ciò che entra nel layout, che conosce insieme il corridoio e gli oggetti già posati. Il primo strato migliora la scena, il secondo la rende impossibile da sbagliare. Sopra i due, un test che enumera la cartella delle piste: una pista nuova è coperta il giorno che la si salva.

**Tech Stack:** JavaScript vanilla col pattern UMD già usato da `frontend/shared/` (gira identico in Node e nel browser). `node:test` + `node:assert/strict`. Nessuna dipendenza nuova.

**Spec:** `docs/superpowers/specs/2026-08-24-f1-scenografia-alla-radice-design.md`

## Global Constraints

- **Italiano** nei commenti e nei messaggi di commit.
- **Un commit per task.** Il push lo fa l'utente, mai l'agente.
- **`git add` per nome, MAI `git add -A`.** L'utente lavora in parallelo su `frontend/f1.js|html`, `frontend/styles/f1.css` e `frontend/tracks/*.json`. Se un task deve toccare un file che l'utente ha già modificato: `git diff <file> > utente.patch` PRIMA di editare, poi `git add <file>` e `git apply --cached -R utente.patch`, e controllo con `git diff --cached` prima di committare.
- **I moduli in `frontend/shared/` sono puri**: niente Three.js, niente `document`, niente `fetch`, niente filesystem.
- **Ingombro ORIENTATO, mai la distanza fra i centri.** `SceneryAssetSizes.itemsOverlap` fa già il test SAT giusto; il raggio (`footprintRadius`) si usa solo come pre-filtro della griglia spaziale.
- **Le soglie si dichiarano in unità di pista, mai in campioni.** Un campione vale 1,18 unità su monte-rosso e 5,17 su prova.
- **Test**: `node --test backend/` dalla radice. `npm test` non esiste.
- ⚠️ **La suite ha 8 rossi PREESISTENTI** (più uno intermittente, `prova-notturno: i bot entrano davvero in corsia box`). Registrarli all'inizio; il criterio è **«nessun rosso NUOVO»** oltre a quelli che questo piano introduce apposta (Task 1) e chiude apposta (Task 7).
- ⚠️ **`prova` è congelata** (`frontend/tracks/scenografie/prova.json`): il gioco rilegge la sua scenografia invece di ricalcolarla, quindi **queste modifiche non la toccano in gioco**. I test invece la ricalcolano, quindi `prova` compare comunque nelle misure. Se a fine piano si vuole che anche `prova` benefici delle correzioni, va **ricotta**: `node backend/tools/f1-cuoci-scenografia.js prova --grid=6`.

## ⚠️ Il vincolo di densità, da non violare per distrazione

Il registro `accepted` NON è incompleto per svista. Il commento in `trackScenery.js` sopra `accepted.push(...trackside.filter(...))` dice, misurato:

> «Solo il decoro, non tutto il trackside. […] Aggiungerli toglieva 9 alberi su prova senza correggere niente, e le direzioni spoglie sull'orizzonte passavano dal 16% al 20% — il tetto del test.»

Il tetto è in `frontend/shared/trackScenery.test.js` (~riga 784): `assert.ok(quota <= 0.20)`.

**Da qui la decisione che regge tutto il piano: la porta rifiuta per PROFONDITÀ di compenetrazione, non per contatto.** Un albero che sfiora una pila di gomme di 10 cm non è un difetto e non va tolto; un banner dentro una tribuna per 5,6 unità sì. Misurato sulle piste attuali: a soglia 1,0 unità le compenetrazioni scendono da 227 a 83 su melbourne, da 199 a 26 su new-monza, da 88 a 11 su monte-rosso. È il rumore che sparisce, non i difetti.

---

### Task 1: L'invariante, prima delle correzioni

Il test che rende la promessa mantenibile. Enumera la cartella delle piste, quindi **copre da solo ogni pista futura**. Parte ROSSO: è il punto.

**Files:**
- Create: `frontend/shared/scenografiaInvarianti.test.js`

**Interfaces:**
- Consumes: `TrackScenery.generateLayout`, `SceneryAssetSizes.footprintCorners/itemsOverlap`, `TrackGeometry.nearestPoint`, `trackLoader.loadTrack`.
- Produces: le costanti di soglia che i task successivi devono rispettare — `MAX_DENTRO_PISTA = 0.5`, `MAX_DENTRO_BOX = 1.0`, `MAX_COMPENETRAZIONE = 1.0`, `FINESTRA_GANTRY = 40`.

- [ ] **Step 1: Registrare i rossi preesistenti**

Run: `node --test backend/ 2>&1 | grep "^not ok"`

Salvare l'elenco. Attesi 8 (più l'intermittente). Se ce ne sono di più, FERMARSI e segnalarlo.

- [ ] **Step 2: Scrivere il test**

Creare `frontend/shared/scenografiaInvarianti.test.js`:

```js
// frontend/shared/scenografiaInvarianti.test.js
//
// Le promesse che la scenografia deve mantenere su OGNI pista — comprese
// quelle che non esistono ancora. Il file ENUMERA la cartella dei tracciati
// invece di elencarli: e' cio' che rende vera la richiesta dell'utente del
// 2026-08-24, «non voglio piu' questi bug in una qualsiasi possibile pista
// che posso creare». Una pista nuova e' coperta il giorno che la si salva,
// senza che nessuno debba ricordarsi di aggiungerla qui.
//
// Rif. docs/superpowers/specs/2026-08-24-f1-scenografia-alla-radice-design.md
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TrackScenery = require('./trackScenery.js');
const Sizes = require('./sceneryAssetSizes.js');
const TrackGeometry = require('./trackGeometry.js');
const { loadTrack } = require('../../backend/sockets/games/trackLoader.js');

const ROOT = path.join(__dirname, '..', '..');
const seats = require(path.join(ROOT, 'frontend/assets/custom/circuit/grandStandSeats.json')).seats;
const terraceAnchors = require(path.join(ROOT, 'frontend/assets/custom/circuit/terraceAnchors.json')).anchors;

// Soglie in UNITA' DI PISTA, mai in campioni: un campione vale 1.18 unita' su
// monte-rosso e 5.17 su prova, quindi «per campione» vorrebbe dire quattro
// comportamenti diversi in silenzio.
const MAX_DENTRO_PISTA = 0.5;      // niente sulla superficie di gara, punto
const MAX_DENTRO_BOX = 1.0;        // i garage lambiscono la corsia per mestiere
const MAX_COMPENETRAZIONE = 1.0;   // sotto, e' un contatto: vedi la nota sulla densita' nel piano
const FINESTRA_GANTRY = 40;        // quanto il ponte semafori puo' allontanarsi dalla sua posizione ideale

// Categorie senza un modello solido: non hanno un ingombro da rispettare.
const NON_SOLIDE = new Set(['pond', 'parkingLot', 'crowd']);

// Le reti nascono attaccate alla loro tribuna: e' il loro mestiere, non un
// difetto. Nessun'altra coppia e' esentata.
function coppiaLecita(a, b) {
    const tribuna = (v) => v.category === 'grandstand' || v.category === 'grandstand-main';
    const rete = (v) => v.asset === 'catchFence';
    return (rete(a) && tribuna(b)) || (rete(b) && tribuna(a));
}

const PISTE = fs.readdirSync(path.join(ROOT, 'frontend/tracks'))
    .filter(f => f.endsWith('.json') && !/^(__|test-)/.test(f))
    .map(f => f.replace(/\.json$/, ''));

function scenografiaDi(id) {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/tracks', id + '.json'), 'utf8'));
    const t = loadTrack(id);
    const layout = TrackScenery.generateLayout(raw, t.points, t.pitLanePts,
        raw.roadHalfWidth + 2.8 + 1.2, 45, seats, t.barrierProfile, terraceAnchors,
        { gridSize: 6 });
    return { raw, t, layout, solidi: layout.filter(v => !NON_SOLIDE.has(v.category) && v.asset) };
}

// Quanto un ingombro entra dentro un corridoio: la penetrazione massima di un
// suo angolo oltre il bordo. Sugli ANGOLI e non sul centro — il pennone ha il
// pivot sull'asta e il corpo sporge tutto da un lato.
function dentroIlCorridoio(item, punti, mezzaLarghezza) {
    let peggio = 0;
    for (const c of Sizes.footprintCorners(item)) {
        const dentro = mezzaLarghezza - TrackGeometry.nearestPoint(punti, c.x, c.z).dist;
        if (dentro > peggio) peggio = dentro;
    }
    return peggio;
}

// Profondita' di compenetrazione: il minimo spostamento che separerebbe i due
// rettangoli orientati (asse di minima sovrapposizione del test SAT). Serve la
// PROFONDITA' e non un si/no: una fila di tribune o una corsa di reti si tocca
// per costruzione, e senza la profondita' il test sarebbe rumore.
function profondita(a, b) {
    const A = Sizes.footprintCorners(a), B = Sizes.footprintCorners(b);
    let minimo = Infinity;
    for (const poly of [A, B]) {
        for (let i = 0; i < poly.length; i++) {
            const j = (i + 1) % poly.length;
            let nx = -(poly[j].z - poly[i].z), nz = poly[j].x - poly[i].x;
            const len = Math.hypot(nx, nz) || 1;
            nx /= len; nz /= len;
            let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
            for (const p of A) { const d = p.x * nx + p.z * nz; if (d < minA) minA = d; if (d > maxA) maxA = d; }
            for (const p of B) { const d = p.x * nx + p.z * nz; if (d < minB) minB = d; if (d > maxB) maxB = d; }
            if (maxA < minB || maxB < minA) return 0;
            const sovr = Math.min(maxA, maxB) - Math.max(minA, minB);
            if (sovr < minimo) minimo = sovr;
        }
    }
    return minimo;
}

// Coppie candidate, via griglia spaziale: senza, sono 1000^2 confronti per pista.
function coppieVicine(solidi) {
    const cella = 60, griglia = new Map();
    const chiavi = (v) => {
        const r = Sizes.footprintRadius(v.asset) * Math.max(1, v.scale || 1);
        const out = [];
        for (let i = Math.floor((v.x - r) / cella); i <= Math.floor((v.x + r) / cella); i++)
            for (let j = Math.floor((v.z - r) / cella); j <= Math.floor((v.z + r) / cella); j++)
                out.push(i + ',' + j);
        return out;
    };
    solidi.forEach((v, i) => { for (const k of chiavi(v)) { if (!griglia.has(k)) griglia.set(k, []); griglia.get(k).push(i); } });
    const out = [];
    solidi.forEach((v, i) => {
        const visti = new Set();
        for (const k of chiavi(v)) for (const j of (griglia.get(k) || [])) {
            if (j <= i || visti.has(j)) continue;
            visti.add(j);
            out.push([v, solidi[j]]);
        }
    });
    return out;
}

for (const id of PISTE) {
    test(`${id}: nessun oggetto scenico dentro la carreggiata`, () => {
        const { raw, t, solidi } = scenografiaDi(id);
        const colpevoli = solidi
            .map(v => ({ v, p: dentroIlCorridoio(v, t.points, raw.roadHalfWidth) }))
            .filter(x => x.p > MAX_DENTRO_PISTA);
        assert.deepEqual(colpevoli.map(x => `${x.v.category}/${x.v.asset} a (${x.v.x.toFixed(1)}, ${x.v.z.toFixed(1)}) dentro di ${x.p.toFixed(2)}`), []);
    });

    test(`${id}: nessun oggetto scenico dentro la corsia box`, () => {
        const { raw, t, solidi } = scenografiaDi(id);
        if (!t.pitLanePts || !t.pitLanePts.length) return;
        const colpevoli = solidi
            .map(v => ({ v, p: dentroIlCorridoio(v, t.pitLanePts, raw.pit.roadHalfWidth) }))
            .filter(x => x.p > MAX_DENTRO_BOX);
        assert.deepEqual(colpevoli.map(x => `${x.v.category}/${x.v.asset} a (${x.v.x.toFixed(1)}, ${x.v.z.toFixed(1)}) dentro di ${x.p.toFixed(2)}`), []);
    });

    test(`${id}: nessuna compenetrazione oltre ${MAX_COMPENETRAZIONE} unita'`, () => {
        const { solidi } = scenografiaDi(id);
        const colpevoli = [];
        for (const [a, b] of coppieVicine(solidi)) {
            if (coppiaLecita(a, b)) continue;
            if (!Sizes.itemsOverlap(a, b)) continue;
            const p = profondita(a, b);
            if (p > MAX_COMPENETRAZIONE) {
                colpevoli.push(`${a.category}/${a.asset} × ${b.category}/${b.asset} per ${p.toFixed(2)} a (${a.x.toFixed(1)}, ${a.z.toFixed(1)})`);
            }
        }
        assert.deepEqual(colpevoli, []);
    });

    test(`${id}: il ponte dei semafori sta davanti alla griglia`, () => {
        // Porta i semafori di partenza: se scivola in avanti il giocatore non
        // vede piu' il via. Misurato il 2026-08-24: melbourne 226 unita'
        // invece di 75, shanghai 135.
        const { raw, t, layout } = scenografiaDi(id);
        const gantry = layout.find(v => v.asset === 'startGantry');
        assert.ok(gantry, 'ogni tracciato deve avere il ponte dei semafori');
        const n = t.points.length;
        const iGrid = raw.startFinish
            ? TrackGeometry.nearestPoint(t.points, raw.startFinish.x, raw.startFinish.z).index : 0;
        const iGantry = TrackGeometry.nearestPoint(t.points, gantry.x, gantry.z).index;
        const avanti = ((iGantry - iGrid) % n + n) % n;
        const unita = avanti / n * TrackGeometry.lapLength(t.points);
        assert.ok(Math.abs(unita - 75) <= FINESTRA_GANTRY,
            `il ponte semafori sta a ${unita.toFixed(0)} unita' dalla griglia, attese 75 ± ${FINESTRA_GANTRY}`);
    });

    test(`${id}: ogni tribuna ha la sua rete`, () => {
        // Il difetto non e' che la rete manchi: e' che tribuna e rete possano
        // esistere separatamente. Misurato il 2026-08-24: melbourne 15 tribune
        // scoperte su 110.
        const { layout } = scenografiaDi(id);
        const reti = layout.filter(v => v.asset === 'catchFence');
        const posizioni = new Set();
        for (const s of layout) {
            if (s.category !== 'grandstand' && s.category !== 'grandstand-main') continue;
            posizioni.add(s.x.toFixed(2) + ',' + s.z.toFixed(2));
        }
        const scoperte = [...posizioni].filter(k => {
            const [x, z] = k.split(',').map(Number);
            return !reti.some(r => Math.hypot(r.x - x, r.z - z) < 20);
        });
        assert.deepEqual(scoperte, []);
    });
}
```

- [ ] **Step 3: Eseguire e registrare i rossi ATTESI**

Run: `node --test frontend/shared/scenografiaInvarianti.test.js 2>&1 | grep "^not ok"`

Expected: FAIL su più piste. Salvare l'elenco: è la lista della spesa dei task successivi, e a fine piano deve essere **vuota**.

Attesi, dalle misure del 2026-08-24: `melbourne` fallisce tutti e cinque; `monte-rosso` la carreggiata e le compenetrazioni; `new-monza` corsia box, compenetrazioni e reti; `shanghai` gantry, compenetrazioni e reti; `prova`, `prova-notturno`, `suzuka`, `test` in gran parte verdi.

- [ ] **Step 4: Commit**

```bash
git add frontend/shared/scenografiaInvarianti.test.js
git commit -m "Le invarianti della scenografia, su OGNI pista

Il file enumera la cartella dei tracciati invece di elencarli: e' cio'
che rende vera la richiesta dell'utente - non volere piu' questi bug su
una qualsiasi pista che creera'. Una pista nuova e' coperta il giorno
che la si salva, senza che nessuno se ne ricordi.

Parte ROSSO ed e' il punto: le correzioni arrivano dopo, e la lista dei
rossi e' la lista della spesa.

Le soglie sono in unita' di pista, mai in campioni, e la
compenetrazione si misura in PROFONDITA': una fila di tribune si tocca
per costruzione, e un si/no sarebbe rumore.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: La porta

Il modulo che possiede insieme il corridoio e ciò che è già a terra. Puro, provabile da solo.

**Files:**
- Create: `frontend/shared/sceneryRegistro.js`
- Test: `frontend/shared/sceneryRegistro.test.js`

**Interfaces:**
- Consumes: `SceneryAssetSizes`, `TrackGeometry` (già disponibili come moduli UMD).
- Produces:
  - `SceneryRegistro.crea({ trackPts, pitPts, roadHalf, pitRoadHalf, playerBoxFootprints }) -> registro`
  - `registro.motivoDiRifiuto(item) -> string | null` (null = si può posare)
  - `registro.posa(item) -> boolean` (registra e restituisce true, oppure false)
  - `registro.aggiungiTutti(items)` — registra senza controllare, per ciò che è già stato deciso altrove
  - `registro.profondita(a, b) -> number`
  - costanti `MAX_DENTRO_PISTA`, `MAX_DENTRO_BOX`, `MAX_COMPENETRAZIONE`

- [ ] **Step 1: Scrivere i test che falliscono**

Creare `frontend/shared/sceneryRegistro.test.js`:

```js
// frontend/shared/sceneryRegistro.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Registro = require('./sceneryRegistro.js');

// Una pista dritta lungo x, larga 10 per lato, con una corsia box parallela.
const PISTA = [];
for (let i = 0; i <= 100; i++) PISTA.push({ x: i * 5, z: 0, y: 0 });
const BOX = [];
for (let i = 0; i <= 100; i++) BOX.push({ x: i * 5, z: 40, y: 0 });

function reg() {
    return Registro.crea({
        trackPts: PISTA, pitPts: BOX, roadHalf: 10, pitRoadHalf: 6,
        playerBoxFootprints: [],
    });
}
const oggetto = (asset, x, z, extra) => Object.assign(
    { asset, category: 'prova', x, y: 0, z, rotY: 0, scale: 1 }, extra || {});

test('posa: un oggetto ben fuori da tutto viene accettato', () => {
    const r = reg();
    assert.equal(r.motivoDiRifiuto(oggetto('marshalPost', 250, 100)), null);
    assert.equal(r.posa(oggetto('marshalPost', 250, 100)), true);
});

test('posa: un oggetto dentro la carreggiata viene rifiutato', () => {
    const r = reg();
    const motivo = r.motivoDiRifiuto(oggetto('marshalPost', 250, 0));
    assert.match(motivo, /carreggiata/i);
    assert.equal(r.posa(oggetto('marshalPost', 250, 0)), false);
});

test('posa: conta gli ANGOLI, non il centro', () => {
    // marshalPost e' 5.5 × 4.5: col centro a z=13 il centro e' fuori dalla
    // pista (mezza larghezza 10) ma un angolo entra fino a z=10.75.
    // E' la trappola gia' scritta in docs/f1-notes.md.
    const r = reg();
    assert.ok(r.motivoDiRifiuto(oggetto('marshalPost', 250, 11.5)));
});

test('posa: un oggetto dentro la corsia box viene rifiutato', () => {
    const r = reg();
    assert.match(r.motivoDiRifiuto(oggetto('marshalPost', 250, 40)), /corsia box/i);
});

test('posa: due oggetti lontani convivono', () => {
    const r = reg();
    assert.equal(r.posa(oggetto('grandStand', 100, 100)), true);
    assert.equal(r.posa(oggetto('grandStand', 200, 100)), true);
});

test('posa: un oggetto DENTRO uno gia posato viene rifiutato', () => {
    const r = reg();
    assert.equal(r.posa(oggetto('grandStand', 100, 100)), true);
    assert.match(r.motivoDiRifiuto(oggetto('grandStand', 103, 100)), /compenetra/i);
});

test('posa: un CONTATTO leggero non viene rifiutato', () => {
    // La decisione che regge tutto il piano: sotto la soglia e' un contatto,
    // non un difetto. Toglierlo costerebbe densita' senza correggere niente -
    // gia' misurato il 2026-08-13 (9 alberi in meno su prova, direzioni
    // spoglie dal 16% al 20%, il tetto del test).
    const r = reg();
    assert.equal(r.posa(oggetto('grandStand', 100, 100)), true);
    // grandStand e' largo 19.2: a 19.0 di distanza si sovrappongono di 0.2
    assert.equal(r.motivoDiRifiuto(oggetto('grandStand', 119.0, 100)), null);
});

test('posa: chi viene rifiutato NON resta registrato', () => {
    const r = reg();
    assert.equal(r.posa(oggetto('marshalPost', 250, 0)), false);
    // se fosse rimasto, questo secondo oggetto lontano risulterebbe in conflitto
    assert.equal(r.posa(oggetto('marshalPost', 250, 100)), true);
});

test('aggiungiTutti: registra senza controllare', () => {
    // Serve per cio' che e' stato deciso altrove e non e' negoziabile (i box
    // dei piloti, la tribuna principale): il registro deve VEDERLO, non
    // giudicarlo.
    const r = reg();
    r.aggiungiTutti([oggetto('grandStand', 100, 100)]);
    assert.match(r.motivoDiRifiuto(oggetto('grandStand', 103, 100)), /compenetra/i);
});

test('profondita: misura di quanto due ingombri si intersecano', () => {
    const r = reg();
    // grandStand largo 19.2: due centri a 15 di distanza si intersecano di 4.2
    const p = r.profondita(oggetto('grandStand', 100, 100), oggetto('grandStand', 115, 100));
    assert.ok(Math.abs(p - 4.2) < 0.05, `attesa ~4.2, ottenuta ${p}`);
});

test('profondita: zero se non si toccano', () => {
    const r = reg();
    assert.equal(r.profondita(oggetto('grandStand', 100, 100), oggetto('grandStand', 200, 100)), 0);
});

test('crea: senza corsia box non esplode', () => {
    // Una pista puo' non avere pitPts (tracciati minimi dei test).
    const r = Registro.crea({ trackPts: PISTA, pitPts: [], roadHalf: 10, pitRoadHalf: 0, playerBoxFootprints: [] });
    assert.equal(r.motivoDiRifiuto(oggetto('marshalPost', 250, 100)), null);
});
```

- [ ] **Step 2: Eseguire e verificare che falliscano**

Run: `node --test frontend/shared/sceneryRegistro.test.js`
Expected: FAIL con "Cannot find module './sceneryRegistro.js'".

- [ ] **Step 3: Scrivere il modulo**

Creare `frontend/shared/sceneryRegistro.js`:

```js
// frontend/shared/sceneryRegistro.js
//
// La PORTA della scenografia: l'unico posto da cui un oggetto entra nel
// layout. Sa due cose insieme — dov'e' il corridoio (carreggiata, corsia box,
// box dei piloti) e cosa e' gia' a terra — e per questo puo' rispondere a una
// domanda sola: «questo ci sta?».
//
// PERCHE' ESISTE. Prima, la lista di cio' che era gia' stato piazzato era un
// array che ogni costruttore riceveva e che qualcuno doveva ricordarsi di
// aggiornare. Le tribune non ci entravano mai, natura e boschi nemmeno, e il
// corridoio non c'era affatto: ogni modulo se lo ricontrollava per conto suo
// con criteri diversi. Da li' - meccanicamente - il banner dentro la tribuna,
// il pylon dentro la tribuna, il motorhome in mezzo alla pista. Rif.
// docs/superpowers/specs/2026-08-24-f1-scenografia-alla-radice-design.md.
//
// Qui il registro non e' una lista da aggiornare: e' la CONSEGUENZA di aver
// posato. Non si puo' piazzare senza registrarsi, perche' e' la stessa
// chiamata.
//
// ⚠️ COSA NON FA: non decide DOVE mettere le cose. Quello resta di ogni
// costruttore, che conosce il proprio criterio (curvatura, lato, ritmo). La
// porta dice si o no, e ricorda.
//
// Modulo PURO: niente Three.js, niente DOM.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./sceneryAssetSizes.js'), require('./trackGeometry.js'));
    } else {
        root.SceneryRegistro = factory(root.SceneryAssetSizes, root.TrackGeometry);
    }
})(typeof self !== 'undefined' ? self : this, function (SceneryAssetSizes, TrackGeometry) {

    // Soglie in UNITA' DI PISTA, mai in campioni: un campione vale 1.18 unita'
    // su monte-rosso e 5.17 su prova, quindi «per campione» vorrebbe dire
    // quattro comportamenti diversi in silenzio.
    const MAX_DENTRO_PISTA = 0.5;      // sulla superficie di gara non ci va niente
    const MAX_DENTRO_BOX = 1.0;        // i garage lambiscono la corsia per mestiere
    // ⚠️ Sotto questa soglia e' un CONTATTO, non un difetto, e va lasciato
    // stare: rifiutare ogni sfioramento costa densita' senza correggere
    // niente. Misurato il 2026-08-13: toglieva 9 alberi su prova e portava le
    // direzioni spoglie dal 16% al 20%, che e' il tetto del test in
    // trackScenery.test.js.
    const MAX_COMPENETRAZIONE = 1.0;

    // Profondita' di compenetrazione fra due ingombri orientati: il minimo
    // spostamento che li separerebbe (asse di minima sovrapposizione del test
    // SAT). Serve la profondita' e non un si/no - vedi la soglia qui sopra.
    function profondita(a, b) {
        const A = SceneryAssetSizes.footprintCorners(a);
        const B = SceneryAssetSizes.footprintCorners(b);
        let minimo = Infinity;
        for (const poly of [A, B]) {
            for (let i = 0; i < poly.length; i++) {
                const j = (i + 1) % poly.length;
                let nx = -(poly[j].z - poly[i].z), nz = poly[j].x - poly[i].x;
                const len = Math.hypot(nx, nz) || 1;
                nx /= len; nz /= len;
                let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
                for (const p of A) { const d = p.x * nx + p.z * nz; if (d < minA) minA = d; if (d > maxA) maxA = d; }
                for (const p of B) { const d = p.x * nx + p.z * nz; if (d < minB) minB = d; if (d > maxB) maxB = d; }
                if (maxA < minB || maxB < minA) return 0;
                const sovr = Math.min(maxA, maxB) - Math.max(minA, minB);
                if (sovr < minimo) minimo = sovr;
            }
        }
        return minimo === Infinity ? 0 : minimo;
    }

    function crea({ trackPts, pitPts, roadHalf, pitRoadHalf, playerBoxFootprints }) {
        const box = playerBoxFootprints || [];
        // Griglia spaziale: senza, il controllo e' quadratico sulle ~1000 voci
        // solide di un layout, per ogni pista, in ogni test.
        const CELLA = 60;
        const griglia = new Map();

        function chiaviDi(item) {
            const r = SceneryAssetSizes.footprintRadius(item.asset) * Math.max(1, item.scale || 1);
            const out = [];
            for (let i = Math.floor((item.x - r) / CELLA); i <= Math.floor((item.x + r) / CELLA); i++)
                for (let j = Math.floor((item.z - r) / CELLA); j <= Math.floor((item.z + r) / CELLA); j++)
                    out.push(i + ',' + j);
            return out;
        }

        function registra(item) {
            for (const k of chiaviDi(item)) {
                if (!griglia.has(k)) griglia.set(k, []);
                griglia.get(k).push(item);
            }
        }

        // Quanto un ingombro entra dentro un corridoio: la penetrazione massima
        // di un suo ANGOLO oltre il bordo. Sugli angoli e non sul centro: il
        // pennone ha il pivot sull'asta e il corpo sporge tutto da un lato, e
        // col solo centro finiva dentro lo spazio di manovra dei box.
        function dentro(item, punti, mezzaLarghezza) {
            if (!punti || !punti.length) return 0;
            let peggio = 0;
            for (const c of SceneryAssetSizes.footprintCorners(item)) {
                const d = mezzaLarghezza - TrackGeometry.nearestPoint(punti, c.x, c.z).dist;
                if (d > peggio) peggio = d;
            }
            return peggio;
        }

        function motivoDiRifiuto(item) {
            const inPista = dentro(item, trackPts, roadHalf);
            if (inPista > MAX_DENTRO_PISTA) {
                return `dentro la carreggiata di ${inPista.toFixed(2)} unità`;
            }
            const inBox = dentro(item, pitPts, pitRoadHalf);
            if (inBox > MAX_DENTRO_BOX) {
                return `dentro la corsia box di ${inBox.toFixed(2)} unità`;
            }
            const angoli = SceneryAssetSizes.footprintCorners(item);
            for (const poly of box) {
                if (SceneryAssetSizes.polysOverlap(angoli, poly)) return 'dentro un box dei piloti';
            }
            const visti = new Set();
            for (const k of chiaviDi(item)) {
                for (const altro of (griglia.get(k) || [])) {
                    if (visti.has(altro)) continue;
                    visti.add(altro);
                    if (!SceneryAssetSizes.itemsOverlap(item, altro)) continue;
                    const p = profondita(item, altro);
                    if (p > MAX_COMPENETRAZIONE) {
                        return `compenetra ${altro.category}/${altro.asset} per ${p.toFixed(2)} unità`;
                    }
                }
            }
            return null;
        }

        return {
            motivoDiRifiuto,
            profondita,
            posa(item) {
                if (motivoDiRifiuto(item)) return false;
                registra(item);
                return true;
            },
            // Per cio' che e' stato deciso altrove e non e' negoziabile (i box
            // dei piloti, la tribuna principale): il registro deve VEDERLO,
            // non giudicarlo.
            aggiungiTutti(items) {
                for (const item of items || []) if (item && item.asset) registra(item);
            },
        };
    }

    return { crea, profondita, MAX_DENTRO_PISTA, MAX_DENTRO_BOX, MAX_COMPENETRAZIONE };
});
```

- [ ] **Step 4: Eseguire e verificare che passino**

Run: `node --test frontend/shared/sceneryRegistro.test.js`
Expected: PASS, tutti e 12.

- [ ] **Step 5: Verificare che nessun test esistente sia diventato rosso**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: gli 8 del Task 1 Step 1, più i rossi attesi del Task 1. Il modulo nuovo non è ancora usato da nessuno.

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/sceneryRegistro.js frontend/shared/sceneryRegistro.test.js
git commit -m "La porta della scenografia

Un solo posto che sa insieme dov'e' il corridoio e cosa e' gia' a terra,
e che per questo puo' rispondere a una domanda sola: questo ci sta?

Il registro non e' una lista che qualcuno si ricorda di aggiornare: e' la
conseguenza di aver posato, perche' e' la stessa chiamata.

Rifiuta per PROFONDITA' di compenetrazione, non per contatto: sotto la
soglia e' uno sfioramento, e toglierlo costerebbe densita' senza
correggere niente - misurato il 2026-08-13, 9 alberi in meno su prova e
direzioni spoglie dal 16% al 20%, il tetto del test.

Non decide DOVE mettere le cose: quello resta di ogni costruttore.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: La garanzia — tutto passa dalla porta

Il choke point: alla fine di `generateLayout`, ogni voce passa da `posa` nell'ordine in cui è stata decisa. Chi non passa, non entra. Da qui le invarianti 1, 2 e 3 sono vere **per costruzione**, indipendentemente da quanti costruttori esistano e da chi li scriverà domani.

**Files:**
- Modify: `frontend/shared/trackScenery.js` (la coda di `generateLayout`, dove il layout viene assemblato)
- Test: `frontend/shared/scenografiaInvarianti.test.js` (già scritto, deve diventare più verde)

**Interfaces:**
- Consumes: `SceneryRegistro.crea/posa/aggiungiTutti` dal Task 2.
- Produces: niente di nuovo verso l'esterno; `generateLayout` mantiene la stessa firma e lo stesso formato di uscita.

- [ ] **Step 1: Trovare il punto di assemblaggio**

Run: `grep -n "const layout = \[\]\|layout.push\|return layout" frontend/shared/trackScenery.js | tail -20`

Serve il punto in cui il layout è completo e sta per essere restituito. Il filtro va **lì**, dopo che tutti i costruttori hanno detto la loro: è ciò che lo rende un choke point invece di un ennesimo controllo sparso.

- [ ] **Step 2: Aggiungere il require del modulo**

`trackScenery.js` è un UMD con nove dipendenze iniettate. Il registro diventa la decima, e va aggiunto in TRE punti che devono restare allineati, se no nel browser arriva `undefined`:

```js
// 1. il ramo Node
                                 require('./sceneryInfrastructure.js'),
                                 require('./sceneryRegistro.js'));
// 2. il ramo browser
                                    root.SceneryInfrastructure,
                                    root.SceneryRegistro);
// 3. la firma della factory
                                                        SceneryInfrastructure,
                                                        SceneryRegistro) {
```

⚠️ Aggiungere anche `<script src="shared/sceneryRegistro.js?v=20260824a"></script>` in `frontend/f1.html`, **prima** di `trackScenery.js`, e alzare il `?v=` di `trackScenery.js`. Senza, nel browser `SceneryRegistro` è `undefined` e la scenografia sparisce del tutto.

- [ ] **Step 3: Filtrare il layout dalla porta**

Subito prima del `return` di `generateLayout`:

```js
        // LA PORTA. Tutto ciò che è stato deciso qui sopra passa di qui, una
        // volta, nell'ordine in cui è stato deciso: chi arriva prima ha la
        // precedenza, chi non ci sta non entra.
        //
        // È il punto che rende vera la promessa fatta all'utente il
        // 2026-08-24 — «non voglio più questi bug in una qualsiasi possibile
        // pista che posso creare». Non perché i costruttori siano diventati
        // più bravi, ma perché non esiste più una strada nel layout che salti
        // il controllo: un modulo nuovo, un asset nuovo, una pista nuova o
        // passano da qui o non sono nella scenografia.
        //
        // Le voci senza modello (laghetto, asfalto del parcheggio, folla) non
        // hanno un ingombro da rispettare e passano dritte.
        // Le reti nascono attaccate alla loro tribuna: è il loro mestiere, e
        // il registro le vede dopo, non contro.
        const registro = SceneryRegistro.crea({
            trackPts, pitPts, roadHalf: trackData.roadHalfWidth,
            pitRoadHalf: trackData.pit.roadHalfWidth, playerBoxFootprints,
        });
        const passate = [];
        const scartate = [];
        for (const voce of layout) {
            if (!voce.asset || SENZA_INGOMBRO.has(voce.category)) { passate.push(voce); continue; }
            if (registro.posa(voce)) { passate.push(voce); continue; }
            scartate.push(voce);
        }
        // Un conteggio, non un elenco: in gioco questo gira ad ogni
        // caricamento e un elenco di cento righe in console non lo legge
        // nessuno. Chi vuole i dettagli ha il test delle invarianti.
        if (scartate.length && typeof console !== 'undefined' && console.debug) {
            console.debug(`[scenografia] ${scartate.length} oggetti scartati dalla porta su ${layout.length}`);
        }
        return passate;
```

E a livello di modulo, accanto alle altre costanti:

```js
    // Le categorie senza un modello solido: superfici piane e folla, che non
    // hanno un ingombro da far rispettare a nessuno.
    const SENZA_INGOMBRO = new Set(['pond', 'parkingLot', 'crowd']);
```

⚠️ La folla va esclusa anche per una ragione pratica: sono ~6500 voci su 7667, tutte dentro le tribune per costruzione. Farle passare dalla porta significherebbe scartarle tutte.

- [ ] **Step 4: Misurare quanto costa in densità**

Il filtro toglie oggetti, e togliere oggetti è precisamente ciò che il 2026-08-13 ha portato le direzioni spoglie dal 16% al 20%. Va misurato, non sperato:

```bash
node -e "
const fs=require('fs'), path=require('path');
const TS=require('./frontend/shared/trackScenery.js');
const {loadTrack}=require('./backend/sockets/games/trackLoader.js');
const seats=require('./frontend/assets/custom/circuit/grandStandSeats.json').seats;
const terr=require('./frontend/assets/custom/circuit/terraceAnchors.json').anchors;
for (const f of fs.readdirSync('frontend/tracks').filter(f=>f.endsWith('.json'))) {
  const id=f.replace(/\.json\$/,'');
  let raw,t; try{ raw=JSON.parse(fs.readFileSync('frontend/tracks/'+f,'utf8')); t=loadTrack(id); }catch(e){continue;}
  const L=TS.generateLayout(raw,t.points,t.pitLanePts,raw.roadHalfWidth+2.8+1.2,45,seats,t.barrierProfile,terr,{gridSize:6});
  const per={}; for(const v of L) per[v.category]=(per[v.category]||0)+1;
  console.log(id.padEnd(14)+' totale '+String(L.length).padStart(5)+'   '+Object.entries(per).map(([k,n])=>k+':'+n).join(' '));
}"
```

Confrontare col conteggio PRIMA del filtro (rilanciare lo stesso comando su `git stash`).

**Criterio:** la perdita per categoria deve restare **sotto il 5%** su ogni pista. Se una categoria perde di più, il problema non è la porta ma il costruttore che piazza a caso in quella categoria, e va segnalato prima di proseguire — non compensato allargando la soglia.

- [ ] **Step 5: Verificare il tetto delle direzioni spoglie**

Run: `node --test frontend/shared/trackScenery.test.js 2>&1 | grep "^not ok"`

⚠️ Il test «il N% delle direzioni verso la campagna è senza un solo albero» (~riga 784) ha un tetto del 20% e il 2026-08-13 era già al 16%. Se diventa rosso, **fermarsi**: vuol dire che la porta sta togliendo alberi, e la risposta giusta è capire quali e perché, non alzare il tetto.

- [ ] **Step 6: Eseguire le invarianti**

Run: `node --test frontend/shared/scenografiaInvarianti.test.js 2>&1 | grep "^not ok"`
Expected: carreggiata, corsia box e compenetrazioni **verdi su tutte le piste**. Restano rossi il gantry (Task 4) e le reti (Task 5).

- [ ] **Step 7: Verificare tutta la suite**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: gli 8 preesistenti, più i soli rossi di gantry e reti.

- [ ] **Step 8: Commit**

Con la tecnica dei soli hunk propri per `frontend/f1.html` (vedi Global Constraints).

```bash
git commit -m "Tutto passa dalla porta

Alla fine di generateLayout ogni voce passa da posa(), nell'ordine in
cui e' stata decisa: chi arriva prima ha la precedenza, chi non ci sta
non entra.

Non e' un controllo in piu': e' l'unico modo di entrare nel layout. Un
modulo nuovo, un asset nuovo, una pista nuova o passano di qui o non
sono nella scenografia - ed e' cio' che rende vera la promessa di non
rivedere questi difetti su una pista che ancora non esiste.

Costo in densita' misurato per categoria: <riportare i numeri>.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Il ponte dei semafori non si allontana dalla griglia

**Files:**
- Modify: `frontend/shared/sceneryLandmarks.js` (il ciclo del gantry, ~riga 183)
- Test: `frontend/shared/scenografiaInvarianti.test.js` (già scritto)

**Interfaces:**
- Consumes: niente di nuovo.
- Produces: `FINESTRA_GANTRY_UNITA` (costante di modulo).

- [ ] **Step 1: Leggere il codice di oggi**

Run: `sed -n '176,196p' frontend/shared/sceneryLandmarks.js`

Il ciclo è `for (let d = 0; d < 200; d += 4)` e avanza in **campioni**, senza sapere quanto valga un campione su quella pista: su melbourne 48 campioni sono 226 unità.

- [ ] **Step 2: Sostituire il ciclo**

```js
        // Quanto il gantry puo' allontanarsi dalla sua posizione ideale pur di
        // trovare posto. In UNITA' DI PISTA e non in campioni: un campione
        // vale 1.18 unita' su monte-rosso e 5.17 su prova, e il ciclo di prima
        // avanzava a campioni — su melbourne 48 campioni erano 226 unita', tre
        // volte la distanza voluta, e al via non si vedevano piu' i semafori.
        const FINESTRA_GANTRY_UNITA = 40;

        const gantryWalk = TrackGeometry.walkClosedLoop(trackPts, 0, GANTRY_AHEAD_OF_GRID);
        const stepLen = TrackGeometry.lapLength(trackPts) / n;
        const passiFinestra = Math.max(1, Math.round(FINESTRA_GANTRY_UNITA / stepLen));
        let gantryPosato = null;
        for (let d = 0; d <= passiFinestra; d++) {
            const idx = (gantryWalk.fromIdx + d) % n;
            const cand = placeAcross(trackPts, idx, groundPts, barrierDist,
                                     embankStart, embankOuter, GANTRY_NATIVE_HALF_SPAN, barrierProfile);
            if (!gantryPosato) gantryPosato = cand;   // ripiego: la posizione ideale
            if (!freeOf('startGantry', cand, cand.scale)) continue;
            gantryPosato = cand;
            break;
        }
        // Se dentro la finestra non c'e' posto si posa comunque nell'ideale.
        // E' quello che il commento qui sopra prometteva gia' — «meglio un
        // gantry che sfiora una tribuna che una gara senza semaforo» — e che
        // il codice non faceva: preferiva allontanarsi all'infinito pur di non
        // sfiorare niente. La posizione rispetto alla griglia non e'
        // negoziabile, la pulizia si.
        if (gantryPosato) {
            layout.push({ asset: 'startGantry', category: 'landmark', ...gantryPosato });
        }
```

- [ ] **Step 3: Eseguire l'invariante del gantry**

Run: `node --test frontend/shared/scenografiaInvarianti.test.js 2>&1 | grep "semafori"`
Expected: verde su tutte le piste.

- [ ] **Step 4: Verificare che il gantry non finisca poi scartato dalla porta**

Il Task 3 può scartare un gantry che sfiora una tribuna, e un tracciato **senza** semafori è peggio di un gantry che tocca:

```bash
node -e "
const fs=require('fs');
const TS=require('./frontend/shared/trackScenery.js');
const {loadTrack}=require('./backend/sockets/games/trackLoader.js');
const seats=require('./frontend/assets/custom/circuit/grandStandSeats.json').seats;
const terr=require('./frontend/assets/custom/circuit/terraceAnchors.json').anchors;
for (const f of fs.readdirSync('frontend/tracks').filter(f=>f.endsWith('.json'))) {
  const id=f.replace(/\.json\$/,'');
  let raw,t; try{ raw=JSON.parse(fs.readFileSync('frontend/tracks/'+f,'utf8')); t=loadTrack(id); }catch(e){continue;}
  const L=TS.generateLayout(raw,t.points,t.pitLanePts,raw.roadHalfWidth+2.8+1.2,45,seats,t.barrierProfile,terr,{gridSize:6});
  console.log(id.padEnd(14)+(L.some(v=>v.asset==='startGantry')?' gantry presente':'  ⚠️ GANTRY SPARITO'));
}"
```

Se sparisce su qualche pista, il gantry va posato **prima** delle tribune nell'ordine che la porta vede (è il primo arrivato ad avere la precedenza), oppure va aggiunto con `aggiungiTutti` fra le cose non negoziabili. Scegliere la seconda: il gantry non è negoziabile per definizione.

- [ ] **Step 5: Verificare tutta la suite**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: gli 8 preesistenti, più il solo rosso delle reti.

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/sceneryLandmarks.js
git commit -m "Il ponte dei semafori non si allontana piu' dalla griglia

Cercava posto avanzando fino a 200 CAMPIONI, e un campione vale 1.18
unita' su monte-rosso e 5.17 su prova: su melbourne erano 226 unita'
invece di 75, e al via non si vedevano piu' i semafori.

Adesso la finestra e' dichiarata in unita' di pista, e se dentro non c'e'
posto si posa comunque nell'ideale - che e' esattamente cio' che il
commento sopra quel ciclo prometteva da sempre, e che il codice non
faceva.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Una tribuna senza rete non si posa

Il difetto non è che la rete manchi: è che tribuna e rete possano esistere separatamente. Diventano un'unica decisione.

**Files:**
- Modify: `frontend/shared/sceneryTrackside.js` (il ciclo delle reti, ~riga 193: la rete porta l'identità della sua tribuna)
- Modify: `frontend/shared/trackScenery.js` (dopo `buildTrackside`: le tribune scoperte non entrano)
- Test: `frontend/shared/scenografiaInvarianti.test.js` (già scritto)

**Interfaces:**
- Consumes: niente di nuovo.
- Produces: il campo `daTribuna` su ogni voce `catchFence` — la chiave `x.toFixed(2) + ',' + z.toFixed(2)` della tribuna da cui nasce.

- [ ] **Step 1: La rete dichiara da quale tribuna nasce**

In `frontend/shared/sceneryTrackside.js`, nella creazione della rete (~riga 268), aggiungere il campo:

```js
            const rete = {
                asset: 'catchFence', category: 'safety', scale,
                suMisuraSulMuro: !!barrierProfile,
                // Da quale tribuna nasce questa rete. Serve a chi assembla il
                // layout per tenerle insieme: una tribuna la cui rete non si e'
                // potuta posare non si posa nemmeno lei.
                daTribuna: chiave,
                x, y, z, rotY: stand.rotY,
            };
```

`chiave` è già calcolata poche righe sopra (`stand.x.toFixed(2) + ',' + stand.z.toFixed(2)`), non ricalcolarla.

- [ ] **Step 2: Le tribune scoperte non entrano nel layout**

In `frontend/shared/trackScenery.js`, subito dopo la chiamata a `SceneryTrackside.buildTrackside(...)`:

```js
        // Tribuna e rete sono UNA decisione, non due. La rete nasce dalla
        // tribuna, ma tre condizioni potevano farla sparire (tratto di ponte,
        // spazio non utilizzabile, un'altra tribuna di mezzo) lasciando la
        // tribuna lì, scoperta a bordo pista. Misurato il 2026-08-24: 15
        // tribune su 110 senza rete su melbourne.
        //
        // Una tribuna in meno non la nota nessuno; una tribuna senza
        // protezione sì. Quindi cade quella.
        const conRete = new Set(trackside.filter(v => v.asset === 'catchFence').map(v => v.daTribuna));
        const scoperta = (s) => !conRete.has(s.x.toFixed(2) + ',' + s.z.toFixed(2));
        const grandstandCoperte = grandstand.filter(s => !scoperta(s));
        const mainStandCoperte = mainStand.filter(s => !scoperta(s));
```

Da qui in poi, **ovunque** `grandstand` e `mainStand` erano usate, usare le versioni filtrate. In particolare la folla, che altrimenti resterebbe seduta su una tribuna che non c'è più:

Run: `grep -n "mainStand\|grandstand" frontend/shared/trackScenery.js | sed -n '1,40p'`

⚠️ **Non** filtrare prima di `buildTrackside`: le reti nascono da lì, e senza le tribune non nascerebbero affatto.

- [ ] **Step 3: Eseguire l'invariante delle reti**

Run: `node --test frontend/shared/scenografiaInvarianti.test.js 2>&1 | grep "rete"`
Expected: verde su tutte le piste.

- [ ] **Step 4: Misurare quante tribune si perdono**

```bash
node -e "
const fs=require('fs');
const TS=require('./frontend/shared/trackScenery.js');
const {loadTrack}=require('./backend/sockets/games/trackLoader.js');
const seats=require('./frontend/assets/custom/circuit/grandStandSeats.json').seats;
const terr=require('./frontend/assets/custom/circuit/terraceAnchors.json').anchors;
for (const f of fs.readdirSync('frontend/tracks').filter(f=>f.endsWith('.json'))) {
  const id=f.replace(/\.json\$/,'');
  let raw,t; try{ raw=JSON.parse(fs.readFileSync('frontend/tracks/'+f,'utf8')); t=loadTrack(id); }catch(e){continue;}
  const L=TS.generateLayout(raw,t.points,t.pitLanePts,raw.roadHalfWidth+2.8+1.2,45,seats,t.barrierProfile,terr,{gridSize:6});
  const trib=L.filter(v=>v.category==='grandstand'||v.category==='grandstand-main').length;
  const reti=L.filter(v=>v.asset==='catchFence').length;
  const folla=L.filter(v=>v.category==='crowd').length;
  console.log(id.padEnd(14)+' tribune '+String(trib).padStart(4)+'  reti '+String(reti).padStart(4)+'  folla '+String(folla).padStart(5));
}"
```

**Criterio:** su melbourne si perdono al massimo le 15 tribune misurate; se ne cadono molte di più, la causa non è questa e va capita prima di proseguire.

- [ ] **Step 5: Verificare tutta la suite**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: **solo gli 8 preesistenti.** ⚠️ Controllare in particolare `frontend/shared/sceneryTrackside.test.js` e i test sulla folla: se un valore atteso cambia, verificare che sia perché una tribuna scoperta è stata tolta, non perché si è rotto il legame rete-tribuna.

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/sceneryTrackside.js frontend/shared/trackScenery.js
git commit -m "Una tribuna senza rete non si posa

Il difetto non era che la rete mancasse: era che tribuna e rete
potessero esistere separatamente. Tre condizioni facevano sparire la
rete e lasciavano la tribuna li', scoperta a bordo pista - 15 su 110 su
melbourne.

Adesso sono una decisione sola: la rete dichiara da quale tribuna nasce,
e una tribuna la cui rete non si e' potuta posare non si posa nemmeno
lei. Una tribuna in meno non la nota nessuno, una tribuna senza
protezione si.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: La prevenzione — il registro completo

I task 3-5 rendono le invarianti vere. Questo task le rende vere **con meno scarti**: se i costruttori vedono davvero cosa c'è, piazzano meglio invece di farsi bocciare dalla porta.

⚠️ Questo task può essere **rimandato o saltato** senza perdere le garanzie: è qualità della scena, non correttezza. Se al Task 3 Step 4 gli scarti sono già sotto l'1% per categoria, il guadagno è marginale e va detto invece di fare lavoro inutile.

**Files:**
- Modify: `frontend/shared/trackScenery.js` (le righe che compongono `accepted`)

**Interfaces:**
- Consumes: niente di nuovo.
- Produces: niente.

- [ ] **Step 1: Misurare cosa scarta la porta, per categoria**

Il conteggio del Task 3 non dice CHI viene scartato. Per saperlo si alza
temporaneamente il log da conteggio a elenco: in `frontend/shared/trackScenery.js`,
dentro il ciclo della porta, sostituire il ramo dello scarto con

```js
            const motivo = registro.motivoDiRifiuto(voce);
            if (!motivo) { registro.posa(voce); passate.push(voce); continue; }
            scartate.push(`${voce.category}/${voce.asset}: ${motivo}`);
```

e in fondo, al posto del `console.debug`, `console.log(scartate.join('
'))`.
Poi:

```bash
node -e "
const fs=require('fs');
const TS=require('./frontend/shared/trackScenery.js');
const {loadTrack}=require('./backend/sockets/games/trackLoader.js');
const seats=require('./frontend/assets/custom/circuit/grandStandSeats.json').seats;
const terr=require('./frontend/assets/custom/circuit/terraceAnchors.json').anchors;
for (const f of fs.readdirSync('frontend/tracks').filter(f=>f.endsWith('.json'))) {
  const id=f.replace(/\.json\$/,'');
  let raw,t; try{ raw=JSON.parse(fs.readFileSync('frontend/tracks/'+f,'utf8')); t=loadTrack(id); }catch(e){continue;}
  console.log('--- '+id);
  TS.generateLayout(raw,t.points,t.pitLanePts,raw.roadHalfWidth+2.8+1.2,45,seats,t.barrierProfile,terr,{gridSize:6});
}" 2>&1 | sort | uniq -c | sort -rn | head -30
```

Le righe piu' frequenti dicono quale categoria si fa bocciare, e contro cosa.
**Rimettere il conteggio** prima di committare: un elenco di cento righe ad
ogni caricamento del gioco non lo legge nessuno.

- [ ] **Step 2: Completare il registro solo dove serve**

In `frontend/shared/trackScenery.js`, aggiungere ad `accepted` le categorie che i motivi raccolti indicano come colpevoli. I candidati noti dalla misura del 2026-08-24:

```js
        // Le tribune entrano nel registro: senza, tutto ciò che viene posato
        // dopo — ponte semafori, gomme, natura, paddock-life, boschi — è cieco
        // rispetto a loro, ed è da lì che nascevano il banner dentro la
        // tribuna (5.6 unità) e il pylon dentro la tribuna (3.0).
        accepted.push(...grandstand);
```

⚠️ **Una categoria alla volta, misurando dopo ognuna.** Aggiungere `safety` al registro è già stato provato il 2026-08-13 ed è costato 9 alberi su prova e 4 punti di direzioni spoglie: se lo si rifà, va rifatto sapendolo e verificando il tetto del 20%.

- [ ] **Step 3: Verificare che gli scarti calino e la densità no**

Rilanciare la misura del Task 3 Step 4 e quella del Task 3 Step 5.

**Criterio:** meno oggetti scartati dalla porta, e direzioni spoglie **non peggiorate**. Se una delle due va nella direzione sbagliata, tornare indietro: la garanzia è già data dal Task 3, questo task esiste solo se migliora.

- [ ] **Step 4: Verificare tutta la suite**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: solo gli 8 preesistenti.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/trackScenery.js
git commit -m "Il registro vede anche le tribune

Non cambia le garanzie - quelle le da' la porta - ma fa scegliere meglio
chi piazza: prima di questa riga, tutto cio' che veniva dopo le tribune
era cieco rispetto a loro.

Scarti dalla porta: da <prima> a <dopo>. Direzioni spoglie invariate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Ricuocere `prova` e chiudere

`prova` è congelata: in gioco rilegge la scenografia dal file, quindi finora **non ha visto nessuna di queste correzioni**. Va decisa esplicitamente, non per inerzia.

**Files:**
- Modify: `frontend/tracks/scenografie/prova.json` (rigenerato)

**Interfaces:** nessuna.

- [ ] **Step 1: Verificare che le invarianti siano tutte verdi**

Run: `node --test frontend/shared/scenografiaInvarianti.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: zero `not ok`.

- [ ] **Step 2: Confrontare la cottura vecchia con quella nuova**

```bash
node -e "
const fs=require('fs');
const Cotta=require('./frontend/shared/scenografiaCotta.js');
const {cuoci}=require('./backend/tools/f1-cuoci-scenografia.js');
const vecchia=Cotta.espandi(JSON.parse(fs.readFileSync('frontend/tracks/scenografie/prova.json','utf8')));
const nuova=Cotta.espandi(cuoci('prova',6));
console.log('prima '+vecchia.length+' oggetti, dopo '+nuova.length);
const per=(L)=>L.reduce((m,v)=>(m[v.category]=(m[v.category]||0)+1,m),{});
const a=per(vecchia), b=per(nuova);
for (const k of new Set([...Object.keys(a),...Object.keys(b)])) {
  const d=(b[k]||0)-(a[k]||0);
  if (d) console.log('  '+k+': '+(a[k]||0)+' -> '+(b[k]||0)+'  ('+(d>0?'+':'')+d+')');
}"
```

- [ ] **Step 3: Chiedere all'utente**

`prova` è la pista che ha validato e congelato apposta. Ricuocerla la cambia. **Non farlo senza chiederglielo**, mostrandogli il confronto dello Step 2.

- [ ] **Step 4: Se acconsente, ricuocere**

```bash
node backend/tools/f1-cuoci-scenografia.js prova --grid=6
git add frontend/tracks/scenografie/prova.json
git commit -m "prova ricotta dopo le correzioni di scenografia

Era congelata, quindi non aveva visto nessuna delle correzioni: il
congelamento fa esattamente il suo mestiere. Ricotta su richiesta
esplicita dell'utente, con davanti il confronto oggetto per oggetto.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Il playtest che chiude il blocco**

Nessun test automatico dice se il circuito è *bello*. Serve guardarlo:

1. aprire **melbourne** — era la peggiore: nessun motorhome in pista, il ponte dei semafori davanti alla griglia, nessuna tribuna scoperta;
2. aprire **new-monza** — il ponte dei semafori non deve più stare nella corsia box;
3. aprire **prova** — se ricotta, deve essere ancora quella che l'utente aveva validato;
4. guardare se qualche zona è diventata **spoglia**: è il costo che questo piano paga, e il posto dove si vede è l'orizzonte lungo i rettilinei.

## Cosa resta fuori

- **I buchi d'erba dove una sopraelevata incontra un ponte.** Sottosistema del terreno (`trackMeshBuilder.buildGround` / `buildBridgeDecks`), non del piazzamento. Misurato: solo `prova`, `prova-notturno` e `suzuka` hanno la configurazione che lo produce, e il confronto fra quota della pista e quota del prato ai confini di ponte non mostra salti — serve uno screenshot dell'utente per sapere dove guardare. ⚠️ Lì il congelamento di `prova` **non** protegge: copre la scenografia, non il terreno.
- **Rifare il criterio di posizionamento** di un modulo: la porta dice sì o no, non dove mettere le cose.
- **Il rename di `prova`** e l'editor (blocchi D/E/F).
