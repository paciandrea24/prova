# F1 — Vie di fuga in ghiaia: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** aggiungere le vie di fuga in ghiaia all'esterno delle curve, con barriere e scenografia traslate solo dove c'è la ghiaia, e barriere che diventano un muro solido su tutto il giro.

## STATO AL 2026-08-11 — sospeso su richiesta dell'utente

**Fatti e committati: Task 1-5.** La ghiaia si vede in gioco, le barriere la
seguono, la larghezza è **approvata dall'utente al playtest** ("in curva 1 a
Monza è perfetta"; in qualche curva la trova appena larga, ma ha scelto di
tenerla così e semmai ritoccarla in futuro — non ritoccare `GRAVEL_WIDTH` senza
che lo chieda).

**Da fare: Task 6, 7, 8.** Al momento la scenografia è ancora dov'era, quindi
tribune e cartelloni si sovrappongono alla ghiaia: è atteso, lo risolve il
Task 6.

Due cose imparate al playtest, valide per il seguito:
- **Serve un hard refresh (Ctrl+Shift+R)**, non un refresh normale: il primo
  playtest è sembrato "nessuna differenza" solo per la cache del browser. Se
  ricapita, il modo più veloce per distinguere "codice vecchio" da "difetto
  vero" è un `console.log` temporaneo nel punto in questione.
- **Le soglie geometriche vanno espresse per unità di pista, mai per campione**:
  i campioni sono lunghi 1.18 unità su monte-rosso e 5.17 su prova. È il difetto
  che teneva la ghiaia a 14 unità invece di 32 su prova.

**Architecture:** un modulo condiviso nuovo (`frontend/shared/trackGravel.js`) calcola il **profilo di ghiaia** — quante unità di ghiaia ci sono in ogni campione della pista, per lato — e da quel singolo numero derivano il disegno della banda, la posizione delle barriere, il muro fisico lato server e la traslazione della scenografia. Dove il profilo vale 0 tutto resta identico a oggi, per costruzione.

**Tech Stack:** JavaScript vanilla, moduli UMD condivisi client/server (stesso schema di `trackGeometry.js`), Three.js r128 per il rendering, `node --test` per i test.

## Global Constraints

- **Si lavora nel worktree `.claude/worktrees/f1-ghiaia`** (branch `f1-ghiaia`), mai nella cartella principale. Tutti i comandi partono da lì.
- **Larghezza della ghiaia: 25 unità.** Solo all'esterno delle curve.
- **L'attrito della ghiaia è identico a quello dell'erba di oggi**: `applyOffTrackDrag` in `backend/sockets/games/physics/VehicleMotionModel.js` NON va toccato, in nessun task.
- **Italiano** nei commenti del codice e nei messaggi di commit.
- **Commit alla fine di ogni task**, mai a metà. Il push lo fa l'utente.
- **Cache-busting**: ogni volta che si tocca un `.js` caricato da `frontend/f1.html`, bumpare il suo `?v=` in `f1.html` (oggi `f1.js?v=20260810n`). Un file `shared/*.js` nuovo va aggiunto agli script di `f1.html` **prima** di `f1.js`.
- **Due test sono già rossi prima di iniziare** in `backend/sockets/games/trackLoader.test.js` (`monte-rosso`: attesi 10 giri, trovati 4; attesi 4, trovati 2). Sono preesistenti e fuori scope: non vanno né corretti né considerati regressioni.
- Comando test: `node --test <file>` dalla radice del worktree.

**Riferimento:** `docs/superpowers/specs/2026-08-10-f1-vie-di-fuga-ghiaia-design.md`

## Struttura dei file

| file | responsabilità | task |
|---|---|---|
| `frontend/shared/trackGeometry.js` | ospita `findCorners` (oggi in `sceneryTrackside.js`), ora usata da due sistemi | 1 |
| `frontend/shared/trackGravel.js` (nuovo) | profilo di ghiaia, distanza barriera, varco corsia box | 2, 3 |
| `frontend/shared/trackMeshBuilder.js` | `buildGravel`, `buildBarriers` con distanza variabile | 4 |
| `frontend/shared/toonPalette.js` | colore `gravel` | 4 |
| `frontend/f1.js` + `f1.html` | calcolo del profilo, disegno, traslazione scenografia | 5, 6 |
| `frontend/shared/trackScenery.js` | passaggio di traslazione a valle di `generateLayout` | 6 |
| `backend/sockets/games/trackLoader.js` | espone `track.gravelProfile` | 7 |
| `backend/sockets/games/physics/CollisionResolver.js` | `applyBarrier` (muro su tutto il giro) | 7 |

---

### Task 1: `findCorners` nel modulo di geometria

`findCorners` vive in `sceneryTrackside.js` ma ora serve anche alla ghiaia. Spostarla in `trackGeometry.js` senza cambiarne il comportamento.

**Files:**
- Modify: `frontend/shared/trackGeometry.js` (aggiungere la funzione e le sue costanti, esportarla)
- Modify: `frontend/shared/sceneryTrackside.js:14-124` (rimuovere la definizione, ri-esportare quella di `TrackGeometry`)
- Test: `frontend/shared/trackGeometry.test.js`

**Interfaces:**
- Produces: `TrackGeometry.findCorners(trackPts)` → array di `{ startIdx, endIdx, midIdx, radius, side }`, dove `side` è `-1`/`+1` e indica il **lato esterno** della curva (segno da usare con `normalAt`). `TrackGeometry.CORNER_RADIUS_MAX = 120`.

- [ ] **Step 1: scrivere il test che fallisce**

In `frontend/shared/trackGeometry.test.js`, in coda al file:

```javascript
test('findCorners: un cerchio è tutto curva, un rettilineo non ha curve', () => {
    // Cerchio di raggio 60: sotto CORNER_RADIUS_MAX, quindi tutto in curva.
    // findCorners richiede almeno un punto NON in curva per partire (evita
    // run spezzati a cavallo dell'indice 0), quindi su un cerchio perfetto
    // ritorna vuoto: è il comportamento documentato, non un difetto.
    const cerchio = [];
    for (let i = 0; i < 200; i++) {
        const a = i / 200 * Math.PI * 2;
        cerchio.push({ x: Math.cos(a) * 60, z: Math.sin(a) * 60 });
    }
    assert.equal(TrackGeometry.findCorners(cerchio).length, 0);

    // Ovale: due semicerchi di raggio 60 uniti da due rettilinei da 400.
    // Deve trovare due curve.
    const ovale = [];
    for (let i = 0; i < 100; i++) ovale.push({ x: -200 + i * 4, z: -60 });
    for (let i = 0; i < 60; i++) {
        const a = -Math.PI / 2 + (i / 60) * Math.PI;
        ovale.push({ x: 200 + Math.cos(a) * 60, z: Math.sin(a) * 60 });
    }
    for (let i = 0; i < 100; i++) ovale.push({ x: 200 - i * 4, z: 60 });
    for (let i = 0; i < 60; i++) {
        const a = Math.PI / 2 + (i / 60) * Math.PI;
        ovale.push({ x: -200 + Math.cos(a) * 60, z: Math.sin(a) * 60 });
    }
    const curve = TrackGeometry.findCorners(ovale);
    assert.equal(curve.length, 2, 'un ovale ha due curve');
    for (const c of curve) {
        assert.ok(c.side === 1 || c.side === -1, 'side deve essere ±1');
        assert.ok(c.radius < TrackGeometry.CORNER_RADIUS_MAX);
    }
});
```

- [ ] **Step 2: eseguire il test e verificare che fallisca**

Run: `node --test frontend/shared/trackGeometry.test.js`
Expected: FAIL — `TrackGeometry.findCorners is not a function`

- [ ] **Step 3: spostare la funzione**

Tagliare da `frontend/shared/sceneryTrackside.js` le costanti `CORNER_RADIUS_MAX`, `CORNER_MERGE_GAP`, `CORNER_MIN_LEN` e l'intera funzione `findCorners` (righe ~14-124, dal commento "Soglia sotto la quale un punto è considerato in curva" alla chiusura di `findCorners`), e incollarle in `frontend/shared/trackGeometry.js` prima del `return` finale. Nel corpo incollato sostituire ogni `TrackGeometry.` con niente (dentro `trackGeometry.js` le funzioni si chiamano direttamente): `TrackGeometry.curvatureAt(...)` → `curvatureAt(...)`, `TrackGeometry.lapLength(...)` → `lapLength(...)`.

Aggiungere all'oggetto `return` di `trackGeometry.js`:

```javascript
        findCorners,
        CORNER_RADIUS_MAX,
```

In `sceneryTrackside.js`, al posto del codice rimosso, mettere:

```javascript
    // findCorners è in trackGeometry.js: la usano due sistemi diversi (questa
    // scenografia e il profilo di ghiaia in trackGravel.js), quindi il suo
    // posto è nel modulo di geometria. Ri-esportata qui sotto per non
    // rompere i chiamanti esistenti.
    const findCorners = TrackGeometry.findCorners;
    const CORNER_RADIUS_MAX = TrackGeometry.CORNER_RADIUS_MAX;
```

- [ ] **Step 4: eseguire i test e verificare che passino**

Run: `node --test frontend/shared/trackGeometry.test.js frontend/shared/sceneryTrackside.test.js frontend/shared/trackScenery.test.js`
Expected: PASS su tutti — la scenografia non deve cambiare di una voce.

- [ ] **Step 5: commit**

```bash
git add frontend/shared/trackGeometry.js frontend/shared/trackGeometry.test.js frontend/shared/sceneryTrackside.js
git commit -m "F1 ghiaia: findCorners nel modulo di geometria condiviso"
```

---

### Task 2: il profilo di ghiaia

Il cuore della feature: quante unità di ghiaia ci sono in ogni campione, per lato.

**Files:**
- Create: `frontend/shared/trackGravel.js`
- Test: `frontend/shared/trackGravel.test.js`

**Interfaces:**
- Consumes: `TrackGeometry.findCorners`, `TrackGeometry.normalAt`, `TrackGeometry.nearestPoint`, `TrackGeometry.lapLength` (Task 1).
- Produces:
  - `TrackGravel.gravelProfile(trackPts, opts)` → `{ left: Float64Array, right: Float64Array }` di lunghezza `trackPts.length`. `opts = { roadHalf, curbW = 2.8, pitLanePts = null, pitRoadHalf = 0 }`. `right` è il lato `side = +1` di `normalAt`, `left` il lato `-1`.
  - `TrackGravel.gravelAt(profile, i, side)` → numero (unità di ghiaia in quel campione/lato).
  - `TrackGravel.barrierDistAt(profile, i, side, baseDist)` → `baseDist + gravelAt(...)`.
  - `TrackGravel.GRAVEL_WIDTH = 25`, `TrackGravel.CURB_W = 2.8`, `TrackGravel.BARRIER_GAP = 1.2`.

- [ ] **Step 1: scrivere il test che fallisce**

Creare `frontend/shared/trackGravel.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const TrackGravel = require('./trackGravel.js');
const TrackGeometry = require('./trackGeometry.js');

// Ovale: due semicerchi di raggio 60 uniti da due rettilinei da 400.
// Stessa forma del test di findCorners, così le due suite parlano della
// stessa geometria.
function ovale({ y = 0, bridge = false } = {}) {
    const pts = [];
    const push = (x, z) => pts.push({ x, z, y, bridge });
    for (let i = 0; i < 100; i++) push(-200 + i * 4, -60);
    for (let i = 0; i < 60; i++) {
        const a = -Math.PI / 2 + (i / 60) * Math.PI;
        push(200 + Math.cos(a) * 60, Math.sin(a) * 60);
    }
    for (let i = 0; i < 100; i++) push(200 - i * 4, 60);
    for (let i = 0; i < 60; i++) {
        const a = Math.PI / 2 + (i / 60) * Math.PI;
        push(-200 + Math.cos(a) * 60, Math.sin(a) * 60);
    }
    return pts;
}

test('la ghiaia esiste solo in curva e solo sul lato esterno', () => {
    const pts = ovale();
    const prof = TrackGravel.gravelProfile(pts, { roadHalf: 11 });
    const curve = TrackGeometry.findCorners(pts);
    assert.ok(curve.length > 0, 'il caso di prova deve avere curve');

    // Al centro di ogni curva: ghiaia piena sull'esterno, zero sull'interno.
    for (const c of curve) {
        assert.equal(TrackGravel.gravelAt(prof, c.midIdx, c.side),
            TrackGravel.GRAVEL_WIDTH, 'ghiaia piena sul lato esterno');
        assert.equal(TrackGravel.gravelAt(prof, c.midIdx, -c.side), 0,
            'niente ghiaia sul lato interno');
    }

    // Al centro del primo rettilineo (indice 50): niente ghiaia da nessun lato.
    assert.equal(TrackGravel.gravelAt(prof, 50, 1), 0);
    assert.equal(TrackGravel.gravelAt(prof, 50, -1), 0);
});

test('il profilo non ha gradini: fra campioni contigui cambia al massimo di 1', () => {
    const prof = TrackGravel.gravelProfile(ovale(), { roadHalf: 11 });
    const n = prof.left.length;
    for (const lato of ['left', 'right']) {
        for (let i = 0; i < n; i++) {
            const d = Math.abs(prof[lato][(i + 1) % n] - prof[lato][i]);
            assert.ok(d <= 1.0, `gradino di ${d.toFixed(2)} su ${lato} al campione ${i}`);
        }
    }
});

test('niente ghiaia sui tratti a ponte né dove la pista è sopraelevata', () => {
    const suPonte = TrackGravel.gravelProfile(ovale({ bridge: true }), { roadHalf: 11 });
    assert.ok(suPonte.left.every(v => v === 0) && suPonte.right.every(v => v === 0),
        'un tracciato tutto su ponte non ha ghiaia');

    const inQuota = TrackGravel.gravelProfile(ovale({ y: 8 }), { roadHalf: 11 });
    assert.ok(inQuota.left.every(v => v === 0) && inQuota.right.every(v => v === 0),
        'un tracciato tutto sopraelevato non ha ghiaia');
});

test('la corsia box vicina toglie la ghiaia', () => {
    const pts = ovale();
    // Corsia box parallela al primo rettilineo, appena fuori dal cordolo,
    // sul lato z negativo. Non tocca le curve.
    const senza = TrackGravel.gravelProfile(pts, { roadHalf: 11 });
    const curve = TrackGeometry.findCorners(pts);
    const c = curve[0];
    // Corsia box che passa proprio dove ci sarebbe la ghiaia della prima curva.
    const { nx, nz } = TrackGeometry.normalAt(pts, c.midIdx, true);
    const p = pts[c.midIdx];
    const pit = [];
    for (let k = -20; k <= 20; k++) {
        pit.push({ x: p.x + nx * 20 * c.side + k * 2, z: p.z + nz * 20 * c.side });
    }
    const con = TrackGravel.gravelProfile(pts, { roadHalf: 11, pitLanePts: pit, pitRoadHalf: 5 });
    assert.ok(TrackGravel.gravelAt(senza, c.midIdx, c.side) > 0, 'senza corsia box c\'è ghiaia');
    assert.ok(TrackGravel.gravelAt(con, c.midIdx, c.side) <
              TrackGravel.gravelAt(senza, c.midIdx, c.side),
        'la corsia box vicina riduce o azzera la ghiaia');
});

test('barrierDistAt somma la ghiaia alla distanza base', () => {
    const pts = ovale();
    const prof = TrackGravel.gravelProfile(pts, { roadHalf: 11 });
    const c = TrackGeometry.findCorners(pts)[0];
    const base = 15;
    assert.equal(TrackGravel.barrierDistAt(prof, 50, 1, base), base,
        'sul rettilineo la barriera resta dov\'è oggi');
    assert.equal(TrackGravel.barrierDistAt(prof, c.midIdx, c.side, base),
        base + TrackGravel.GRAVEL_WIDTH);
});
```

- [ ] **Step 2: eseguire il test e verificare che fallisca**

Run: `node --test frontend/shared/trackGravel.test.js`
Expected: FAIL — `Cannot find module './trackGravel.js'`

- [ ] **Step 3: scrivere il modulo**

Creare `frontend/shared/trackGravel.js`:

```javascript
// frontend/shared/trackGravel.js
//
// Profilo delle vie di fuga in ghiaia: per ogni campione della pista e per
// ciascun lato, quante unità di ghiaia ci sono (0 = nessuna). È la SORGENTE
// UNICA da cui derivano il disegno della banda, la posizione delle barriere,
// il muro fisico lato server e la traslazione della scenografia — se questi
// quattro leggessero regole diverse, si vedrebbero barriere disegnate dove il
// muro non c'è (e viceversa).
//
// Dove il profilo vale 0 tutto si comporta ESATTAMENTE come prima che questo
// modulo esistesse: la distanza della barriera è la stessa formula di sempre e
// la scenografia non si sposta. I rettilinei quindi restano identici per
// costruzione, non per una regola scritta a parte.
//
// Rif. docs/superpowers/specs/2026-08-10-f1-vie-di-fuga-ghiaia-design.md
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./trackGeometry.js'));
    else root.TrackGravel = factory(root.TrackGeometry);
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry) {

    // Larghezza della via di fuga: 25 unità ≈ 20 m, poco più di tre lunghezze
    // d'auto (l'auto è 7.17 unità). Misurato sui quattro tracciati reali: in
    // tutte le curve c'è più di 30 unità di spazio libero prima della corsia
    // box, quindi ci sta ovunque serva.
    const GRAVEL_WIDTH = 25;
    // Larghezza del cordolo e distacco della barriera dal suo bordo esterno:
    // ricopiati da f1.js (CURB_W / BARRIER_D), qui perché il profilo deve
    // sapere da dove parte la ghiaia.
    const CURB_W = 2.8;
    const BARRIER_GAP = 1.2;

    // La zona di ghiaia si estende oltre gli estremi della curva per coprire
    // la frenata in ingresso e l'allargata in uscita: è lì che si esce, non a
    // metà curva.
    const CORNER_LEAD = 15;
    // Rampa con cui la larghezza sale da 0 al massimo. Serve a non lasciare
    // gradini nel muro: un'auto che struscia la barriera in uscita di curva
    // ci sbatterebbe contro di spigolo.
    const RAMP = 12;
    // Margine fra il bordo esterno della ghiaia e il bordo della corsia box.
    const PIT_CLEARANCE = 4;
    // Sotto questa larghezza la zona viene scartata del tutto: una linguetta
    // di ghiaia si legge come un errore grafico, non come una via di fuga.
    const MIN_USEFUL_WIDTH = 6;
    // Oltre questa quota il terreno non è più in piano: niente via di fuga su
    // una rampa o un viadotto, come nella realtà. Evita anche di dover
    // allargare il terrapieno, che diventerebbe un piedistallo enorme.
    const FLAT_Y_TOLERANCE = 0.5;

    function gravelProfile(trackPts, opts) {
        const n = trackPts.length;
        const { roadHalf, curbW = CURB_W, pitLanePts = null, pitRoadHalf = 0 } = opts;
        const out = { left: new Float64Array(n), right: new Float64Array(n) };
        if (!n) return out;

        const stepLen = TrackGeometry.lapLength(trackPts) / n;
        const leadSamples = Math.max(1, Math.round(CORNER_LEAD / stepLen));
        const rampSamples = Math.max(1, Math.round(RAMP / stepLen));

        for (const corner of TrackGeometry.findCorners(trackPts)) {
            const banda = corner.side > 0 ? out.right : out.left;
            const arco = (corner.endIdx - corner.startIdx + n) % n;
            const totale = arco + 2 * leadSamples;

            // Prima passata: larghezza nominale con le rampe agli estremi.
            const larghezze = new Array(totale + 1);
            for (let s = 0; s <= totale; s++) {
                const daInizio = s, daFine = totale - s;
                const t = Math.min(1, Math.min(daInizio, daFine) / rampSamples);
                larghezze[s] = GRAVEL_WIDTH * t;
            }

            // Seconda passata: tagli locali (ponte, quota, corsia box).
            const base = roadHalf + curbW + BARRIER_GAP;
            for (let s = 0; s <= totale; s++) {
                const i = (corner.startIdx - leadSamples + s + n * 2) % n;
                const p = trackPts[i];
                if (p.bridge || Math.abs(p.y || 0) > FLAT_Y_TOLERANCE) {
                    larghezze[s] = 0;
                    continue;
                }
                if (pitLanePts && pitLanePts.length) {
                    const { nx, nz } = TrackGeometry.normalAt(trackPts, i, true);
                    // Quanto ci si può allontanare prima di toccare la corsia
                    // box: si cammina in fuori a passi di 1 unità dal bordo
                    // esterno del cordolo.
                    let libero = larghezze[s];
                    for (let d = 0; d <= larghezze[s]; d += 1) {
                        const x = p.x + nx * (base + d) * corner.side;
                        const z = p.z + nz * (base + d) * corner.side;
                        if (TrackGeometry.nearestPoint(pitLanePts, x, z).dist < pitRoadHalf + PIT_CLEARANCE) {
                            libero = Math.max(0, d - PIT_CLEARANCE);
                            break;
                        }
                    }
                    larghezze[s] = Math.min(larghezze[s], libero);
                }
            }

            // Una zona troppo stretta (perché tagliata quasi ovunque) si
            // scarta del tutto.
            if (Math.max(...larghezze) < MIN_USEFUL_WIDTH) continue;

            // Terza passata: livellamento anti-gradino. Dopo i tagli la
            // larghezza può crollare di colpo da 25 a 0 (es. all'imbocco di
            // un ponte); si limita la pendenza a 1 unità per campione in
            // entrambi i versi, così il muro resta raccordato.
            const maxSalto = 1.0;
            for (let s = 1; s <= totale; s++) {
                larghezze[s] = Math.min(larghezze[s], larghezze[s - 1] + maxSalto);
            }
            for (let s = totale - 1; s >= 0; s--) {
                larghezze[s] = Math.min(larghezze[s], larghezze[s + 1] + maxSalto);
            }

            for (let s = 0; s <= totale; s++) {
                const i = (corner.startIdx - leadSamples + s + n * 2) % n;
                // Due curve vicine sullo stesso lato possono sovrapporsi:
                // vince la più larga, mai la somma.
                if (larghezze[s] > banda[i]) banda[i] = larghezze[s];
            }
        }

        return out;
    }

    function gravelAt(profile, i, side) {
        const banda = side > 0 ? profile.right : profile.left;
        return banda[((i % banda.length) + banda.length) % banda.length];
    }

    function barrierDistAt(profile, i, side, baseDist) {
        return baseDist + gravelAt(profile, i, side);
    }

    return {
        gravelProfile, gravelAt, barrierDistAt,
        GRAVEL_WIDTH, CURB_W, BARRIER_GAP,
        CORNER_LEAD, RAMP, PIT_CLEARANCE, MIN_USEFUL_WIDTH, FLAT_Y_TOLERANCE,
    };
});
```

- [ ] **Step 4: eseguire il test e verificare che passi**

Run: `node --test frontend/shared/trackGravel.test.js`
Expected: PASS, 5 test.

Se il test "non ha gradini" fallisce, la causa è quasi sempre il livellamento che opera **dentro la zona** mentre il salto avviene al confine con un campione fuori zona: verificare che la rampa parta da 0 (`larghezze[0] === 0` e `larghezze[totale] === 0`).

- [ ] **Step 5: commit**

```bash
git add frontend/shared/trackGravel.js frontend/shared/trackGravel.test.js
git commit -m "F1 ghiaia: profilo delle vie di fuga (sorgente unica)"
```

---

### Task 3: il varco della corsia box, condiviso

Oggi la regola che apre il varco nella barriera vive solo nel client (`pitMergeSamples` in `f1.js:251`). Diventando la barriera un muro fisico, client e server devono usare la stessa identica regola: altrimenti all'ingresso dei box si sbatte contro un muro invisibile.

**Files:**
- Modify: `frontend/shared/trackGravel.js` (aggiungere `pitGapSamples`)
- Modify: `frontend/f1.js:250-276` (usare quella condivisa)
- Test: `frontend/shared/trackGravel.test.js`

**Interfaces:**
- Produces: `TrackGravel.pitGapSamples(pitPts)` → sottoinsieme dei punti della corsia box entro `PIT_MERGE_WINDOW = 75` unità dai due estremi. `TrackGravel.PIT_MERGE_WINDOW = 75`.

- [ ] **Step 1: scrivere il test che fallisce**

Aggiungere in coda a `frontend/shared/trackGravel.test.js`:

```javascript
test('pitGapSamples tiene solo i punti vicini ai due estremi della corsia', () => {
    // Corsia rettilinea lunga 400 unità, un punto ogni 2 unità.
    const pit = [];
    for (let i = 0; i <= 200; i++) pit.push({ x: i * 2, z: 0 });

    const gap = TrackGravel.pitGapSamples(pit);
    assert.ok(gap.length > 0 && gap.length < pit.length, 'né vuoto né tutto');

    // Il primo e l'ultimo punto ci sono sempre; quello di mezzo mai.
    const ha = (x) => gap.some(p => p.x === x);
    assert.ok(ha(0), 'il primo punto è nel varco');
    assert.ok(ha(400), 'l\'ultimo punto è nel varco');
    assert.ok(!ha(200), 'il punto centrale non è nel varco');

    // Il confine è PIT_MERGE_WINDOW = 75 unità dagli estremi.
    assert.ok(ha(74), 'a 74 unità dall\'inizio è ancora varco');
    assert.ok(!ha(76), 'a 76 unità dall\'inizio non lo è più');
});
```

- [ ] **Step 2: eseguire il test e verificare che fallisca**

Run: `node --test frontend/shared/trackGravel.test.js`
Expected: FAIL — `TrackGravel.pitGapSamples is not a function`

- [ ] **Step 3: spostare la funzione**

In `frontend/shared/trackGravel.js`, prima del `return` finale:

```javascript
    // Finestra (in unità, non in campioni) attorno ai due estremi della corsia
    // box entro cui barriera e cordolo si aprono. Era in f1.js: da quando la
    // barriera è un MURO FISICO lato server, la stessa regola deve valere per
    // il disegno e per la collisione — se divergessero, all'ingresso dei box
    // si sbatterebbe contro un muro invisibile dove il disegno mostra un varco.
    // 75 e non l'intera corsia: con l'intera corsia si apriva un varco spurio
    // di 139 unità su "prova", dove la pista passa vicino alla zona box.
    const PIT_MERGE_WINDOW = 75;

    function pitGapSamples(pts) {
        const n = pts.length;
        const cum = [0];
        for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
        const total = cum[n - 1];
        return pts.filter((_, i) => cum[i] < PIT_MERGE_WINDOW || total - cum[i] < PIT_MERGE_WINDOW);
    }
```

Aggiungerla all'oggetto `return`: `pitGapSamples, PIT_MERGE_WINDOW,`.

In `frontend/f1.js` cancellare la costante `PIT_MERGE_WINDOW` e la funzione `pitMergeSamples` (righe ~250-257) e sostituire la riga 276 con:

```javascript
    // Calcolato una volta sola: cordolo, barriera disegnata e MURO FISICO
    // lato server devono aprire il varco esattamente nello stesso punto e
    // nella stessa forma — la regola sta in TrackGravel, non più qui.
    const PIT_MERGE_SAMPLES = TrackGravel.pitGapSamples(PIT_PTS);
```

- [ ] **Step 4: eseguire il test e verificare che passi**

Run: `node --test frontend/shared/trackGravel.test.js`
Expected: PASS, 6 test.

- [ ] **Step 5: commit**

```bash
git add frontend/shared/trackGravel.js frontend/shared/trackGravel.test.js frontend/f1.js
git commit -m "F1 ghiaia: regola del varco corsia box condivisa client/server"
```

---

### Task 4: disegno della ghiaia e barriere a distanza variabile

**Files:**
- Modify: `frontend/shared/toonPalette.js:36-45` (colore `gravel`)
- Modify: `frontend/shared/trackMeshBuilder.js` (`buildGravel` nuova, `buildBarriers` accetta una funzione)
- Test: `frontend/shared/trackMeshBuilder.test.js` (creare se non esiste)

**Interfaces:**
- Consumes: `TrackGravel.gravelAt` (Task 2).
- Produces: `TrackMeshBuilder.buildGravel(container, pts, roadHalf, curbW, profile)`. `TrackMeshBuilder.buildBarriers(container, pts, distFromCenter, mergePoints)` dove `distFromCenter` è un numero **oppure** una funzione `(i, side) => number`.

- [ ] **Step 1: scrivere il test che fallisce**

Creare `frontend/shared/trackMeshBuilder.test.js`. `trackMeshBuilder.js` usa `THREE` globale, quindi il test installa un finto Three minimale — verifica la geometria prodotta, non il rendering:

```javascript
const test = require('node:test');
const assert = require('node:assert');

// Finto Three.js: raccoglie solo ciò che serve a verificare la GEOMETRIA
// (posizioni dei vertici). Non disegna nulla — questi test controllano dove
// finiscono i vertici, non come appaiono.
global.THREE = {
    BufferGeometry: class { constructor() { this.attributes = {}; } setAttribute(n, a) { this.attributes[n] = a; } setIndex(i) { this.index = i; } computeVertexNormals() {} },
    Float32BufferAttribute: class { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } },
    MeshStandardMaterial: class { constructor(o) { Object.assign(this, o); } },
    Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; } },
    DoubleSide: 2,
    Object3D: class { constructor() { this.children = []; } add(c) { this.children.push(c); } },
    BoxGeometry: class {}, InstancedMesh: class { constructor() {} setMatrixAt() {} },
    Color: class {}, Vector3: class {},
};

const TrackMeshBuilder = require('./trackMeshBuilder.js');
const TrackGeometry = require('./trackGeometry.js');

function contenitore() { return { children: [], add(c) { this.children.push(c); } }; }

// Cerchio di raggio 100: la distanza di ogni vertice dall'origine è
// immediatamente confrontabile con la distanza attesa dall'asse pista.
function cerchio(n = 200) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        pts.push({ x: Math.cos(a) * 100, z: Math.sin(a) * 100, y: 0 });
    }
    return pts;
}

test('buildBarriers con un numero: la barriera sta a quella distanza (invariato)', () => {
    const c = contenitore();
    TrackMeshBuilder.buildBarriers(c, cerchio(), 15, null);
    assert.equal(c.children.length, 2, 'una mesh per lato');
    for (const mesh of c.children) {
        const pos = mesh.geometry.attributes.position.array;
        for (let v = 0; v < pos.length; v += 3) {
            const d = Math.hypot(pos[v], pos[v + 2]);
            // Su un cerchio di raggio 100 la barriera sta a 85 (lato interno)
            // o 115 (lato esterno).
            assert.ok(Math.abs(d - 85) < 0.5 || Math.abs(d - 115) < 0.5,
                `vertice a distanza ${d.toFixed(2)}, attesa 85 o 115`);
        }
    }
});

test('buildBarriers con una funzione: la distanza varia per campione e lato', () => {
    const c = contenitore();
    // 25 unità in più solo sul lato +1 e solo nella prima metà del giro.
    TrackMeshBuilder.buildBarriers(c, cerchio(), (i, side) => 15 + (side > 0 && i < 100 ? 25 : 0), null);
    const distanze = [];
    for (const mesh of c.children) {
        const pos = mesh.geometry.attributes.position.array;
        for (let v = 0; v < pos.length; v += 3) distanze.push(Math.hypot(pos[v], pos[v + 2]));
    }
    const arrotondate = new Set(distanze.map(d => Math.round(d)));
    assert.ok(arrotondate.has(85), 'lato interno invariato a 85');
    assert.ok(arrotondate.has(115), 'lato esterno senza ghiaia a 115');
    assert.ok(arrotondate.has(140), 'lato esterno con 25 di ghiaia a 140');
});

test('buildGravel: la banda va dal bordo del cordolo alla barriera', () => {
    const pts = cerchio();
    // Profilo finto: 25 unità sul lato +1 ovunque, 0 sull'altro.
    const prof = { right: new Float64Array(pts.length).fill(25), left: new Float64Array(pts.length) };
    const c = contenitore();
    TrackMeshBuilder.buildGravel(c, pts, 11, 2.8, prof);

    assert.equal(c.children.length, 1, 'una sola mesh per tutta la ghiaia');
    const pos = c.children[0].geometry.attributes.position.array;
    const distanze = [];
    for (let v = 0; v < pos.length; v += 3) distanze.push(Math.hypot(pos[v], pos[v + 2]));
    const min = Math.min(...distanze), max = Math.max(...distanze);
    // Bordo interno = roadHalf + curbW = 13.8 -> raggio 113.8
    // Bordo esterno = 13.8 + 25 = 38.8 -> raggio 138.8
    assert.ok(Math.abs(min - 113.8) < 0.5, `bordo interno a ${min.toFixed(1)}, atteso 113.8`);
    assert.ok(Math.abs(max - 138.8) < 0.5, `bordo esterno a ${max.toFixed(1)}, atteso 138.8`);
});

test('buildGravel: con profilo tutto a zero non produce nulla', () => {
    const pts = cerchio();
    const prof = { right: new Float64Array(pts.length), left: new Float64Array(pts.length) };
    const c = contenitore();
    TrackMeshBuilder.buildGravel(c, pts, 11, 2.8, prof);
    assert.equal(c.children.length, 0, 'nessuna mesh dove non c\'è ghiaia');
});
```

- [ ] **Step 2: eseguire il test e verificare che fallisca**

Run: `node --test frontend/shared/trackMeshBuilder.test.js`
Expected: FAIL — `TrackMeshBuilder.buildGravel is not a function` (il primo test sulle barriere con numero dovrebbe già passare).

- [ ] **Step 3: implementare**

In `frontend/shared/toonPalette.js`, dentro `SURFACES`, dopo `pitLane`:

```javascript
        gravel: 0xC9B896,       // beige sabbia delle vie di fuga
```

In `frontend/shared/trackMeshBuilder.js`, modificare l'inizio di `buildBarriers` (riga ~233) per accettare anche una funzione:

```javascript
    // distFromCenter: numero (distanza fissa, comportamento storico usato
    // dall'editor tracciato) oppure funzione (i, side) => distanza, con cui la
    // barriera segue il profilo di ghiaia allargandosi solo all'esterno delle
    // curve. Rif. trackGravel.js.
    function buildBarriers(container, pts, distFromCenter, mergePoints) {
        const distAt = typeof distFromCenter === 'function'
            ? distFromCenter
            : () => distFromCenter;
        const n = pts.length;
```

e sostituire le due righe che calcolano `bx`/`bz` (righe ~250-251) con:

```javascript
                const dist = distAt(i, side);
                const bx = p.x + nx * dist * side;
                const bz = p.z + nz * dist * side;
```

Aggiungere `buildGravel` subito dopo `buildCurbs` (dopo la riga ~192):

```javascript
    const GRAVEL_COLOR = Palette.SURFACES.gravel;

    // Banda di ghiaia fra il bordo esterno del cordolo e la barriera, presente
    // solo dove il profilo è > 0 (all'esterno delle curve). Stessa tecnica di
    // buildCurbs — una striscia di triangoli lungo il giro — ma con il bordo
    // esterno che segue il profilo invece di stare a distanza fissa, e i
    // triangoli emessi solo dove c'è ghiaia davvero.
    //
    // Alla stessa quota del cordolo (+0.04 sulla pista): la ghiaia esiste solo
    // dove il terreno è in piano (vedi trackGravel.js), quindi non c'è
    // dislivello da raccordare.
    function buildGravel(container, pts, roadHalf, curbW, profile) {
        const n = pts.length;
        const pos = [];
        const idx = [];
        let emesso = false;

        for (const side of [-1, 1]) {
            const banda = side > 0 ? profile.right : profile.left;
            // Indice del primo vertice di questo lato dentro `pos`.
            const primoVertice = pos.length / 3;

            for (let i = 0; i < n; i++) {
                const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
                const p = pts[i];
                const y = (p.y || 0) + 0.03;   // sotto il cordolo (+0.04), sopra la pista
                const inner = (roadHalf + curbW) * side;
                const outer = (roadHalf + curbW + banda[i]) * side;

                pos.push(p.x + nx * inner, y, p.z + nz * inner);
                pos.push(p.x + nx * outer, y, p.z + nz * outer);
            }

            for (let i = 0; i < n; i++) {
                const j = (i + 1) % n;
                // Niente triangoli dove la banda ha larghezza nulla su
                // entrambi i campioni: sarebbero degeneri (area zero) e
                // creerebbero z-fighting col cordolo.
                if (banda[i] <= 0 && banda[j] <= 0) continue;
                emesso = true;
                const a = primoVertice + i * 2, b = primoVertice + j * 2;
                if (side < 0) idx.push(a, a + 1, b, b, a + 1, b + 1);
                else          idx.push(a, b, a + 1, b, b + 1, a + 1);
            }
        }

        if (!emesso) return;   // pista senza ghiaia (es. baku): nessuna mesh

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(pos), 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
            color: GRAVEL_COLOR, roughness: 1, side: THREE.DoubleSide
        }));
        mesh.receiveShadow = true;
        container.add(mesh);
    }
```

Aggiungere `buildGravel` all'export in fondo al file (riga ~1017), dopo `buildCurbs`.

- [ ] **Step 4: eseguire i test e verificare che passino**

Run: `node --test frontend/shared/trackMeshBuilder.test.js frontend/shared/toonPalette.test.js`
Expected: PASS su tutti (4 + quelli della palette).

- [ ] **Step 5: commit**

```bash
git add frontend/shared/trackMeshBuilder.js frontend/shared/trackMeshBuilder.test.js frontend/shared/toonPalette.js
git commit -m "F1 ghiaia: banda di ghiaia e barriere a distanza variabile"
```

---

### Task 5: la ghiaia in gioco (disegno)

Primo punto in cui la feature si vede a schermo. Alla fine di questo task la ghiaia c'è, le barriere sono al posto giusto, ma la scenografia è ancora dov'era (verrà spostata nel Task 6) e il muro non c'è ancora (Task 7).

**Files:**
- Modify: `frontend/f1.html:250-262` (script nuovo + cache-busting)
- Modify: `frontend/f1.js:155-281`

**Interfaces:**
- Consumes: `TrackGravel.gravelProfile`, `TrackGravel.barrierDistAt` (Task 2), `TrackMeshBuilder.buildGravel` (Task 4).
- Produces: la costante `GRAVEL_PROFILE` in `f1.js`, usata dal Task 6.

- [ ] **Step 1: caricare il modulo nella pagina**

In `frontend/f1.html`, accanto agli altri script di `shared/` e **prima** di `f1.js`, aggiungere:

```html
    <script src="shared/trackGravel.js?v=20260810a"></script>
```

Verificare con `grep -n "shared/track" frontend/f1.html` che l'ordine sia: `trackGeometry.js`, poi `trackGravel.js`, poi gli altri.

- [ ] **Step 2: calcolare il profilo e disegnare**

In `frontend/f1.js`, dopo la riga che definisce `PIT_PATH` (~177), aggiungere:

```javascript
    // Profilo delle vie di fuga in ghiaia: calcolato UNA volta qui e riusato
    // per la banda disegnata, per la posizione delle barriere e per traslare
    // la scenografia. Il server ne calcola uno identico con la stessa
    // funzione (trackLoader.js) per il muro fisico.
    const GRAVEL_PROFILE = TrackGravel.gravelProfile(trackPts, {
        roadHalf: ROAD_HALF,
        curbW: CURB_W,
        pitLanePts: TrackGeometry.tuckPitEndsToTrack(
            TrackGeometry.sampleOpenPath(PIT_PATH, 300), trackPts),
        pitRoadHalf: trackData.pit.roadHalfWidth,
    });
```

Sostituire la riga 281 (`TrackMeshBuilder.buildBarriers(scene, trackPts, BARRIER_D, PIT_MERGE_SAMPLES);`) con:

```javascript
    // La ghiaia si disegna PRIMA della barriera e DOPO il cordolo: si
    // sovrappone a nessuno dei due (parte dal bordo esterno del cordolo) ma
    // l'ordine tiene il codice leggibile come la sezione reale della pista.
    TrackMeshBuilder.buildGravel(scene, trackPts, ROAD_HALF, CURB_W, GRAVEL_PROFILE);
    // La barriera segue il profilo: dove non c'è ghiaia resta a BARRIER_D
    // esatto, cioè dov'era prima di questa feature.
    TrackMeshBuilder.buildBarriers(scene, trackPts,
        (i, side) => TrackGravel.barrierDistAt(GRAVEL_PROFILE, i, side, BARRIER_D),
        PIT_MERGE_SAMPLES);
```

- [ ] **Step 3: bumpare il cache-busting**

In `frontend/f1.html` portare `f1.js?v=20260810n` a `f1.js?v=20260810o`. Senza questo il browser serve il JS vecchio e sembra che non sia cambiato nulla.

- [ ] **Step 4: verificare che il gioco carichi**

Run: `node --test frontend/shared/` (tutti i test condivisi devono restare verdi)

Poi avviare il server e caricare una pista:

```bash
cd backend && node server.js
```

L'utente apre `localhost:3000`, entra in una partita F1 su **prova** e verifica: banda beige all'esterno delle curve, barriere spostate solo lì, rettilinei invariati. Su **baku** non deve comparire alcuna ghiaia.

- [ ] **Step 5: commit**

```bash
git add frontend/f1.js frontend/f1.html
git commit -m "F1 ghiaia: vie di fuga disegnate in gioco, barriere che le seguono"
```

---

### Task 6: la scenografia si trasla oltre la ghiaia

Tutto resta com'è, semplicemente spostato oltre la ghiaia dove la ghiaia c'è.

**Files:**
- Modify: `frontend/shared/trackScenery.js:933-1003` (`generateLayout`)
- Modify: `frontend/f1.js:615` (passare il profilo)
- Test: `frontend/shared/trackScenery.test.js`

**Interfaces:**
- Consumes: `TrackGravel.gravelAt` (Task 2), `GRAVEL_PROFILE` (Task 5).
- Produces: `generateLayout(trackData, trackPts, pitPts, barrierDist, embankmentWidth, seatAnchors, gravelProfile)` — settimo parametro opzionale; senza di esso il comportamento è identico a prima.

- [ ] **Step 1: scrivere il test che fallisce**

Aggiungere in coda a `frontend/shared/trackScenery.test.js`:

Il file ha già in cima `const monteRosso = require('../tracks/monte-rosso.json');`,
la costante `BARRIER_D` e l'helper `buildReal()` che campiona pista e corsia:
usarli, non introdurre un caricatore nuovo. Monte-rosso va bene come caso di
prova perché ha 4 curve, tutte a terra e senza ponti.

```javascript
test('con un profilo di ghiaia la scenografia si sposta solo dove c\'è ghiaia', () => {
    const TrackGravel = require('./trackGravel.js');
    const { trackPts, pitPts } = buildReal();

    const senza = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const prof = TrackGravel.gravelProfile(trackPts, { roadHalf: ROAD_HALF });
    const con = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D, 45, null, prof);

    assert.equal(con.length, senza.length, 'stesso numero di voci: nulla si perde');

    let spostate = 0;
    for (let i = 0; i < senza.length; i++) {
        const a = senza[i], b = con[i];
        assert.equal(a.asset, b.asset, 'stesso asset nella stessa posizione di lista');
        const near = TrackGeometry.nearestPoint(trackPts, a.x, a.z);
        const { nx, nz } = TrackGeometry.normalAt(trackPts, near.index, true);
        const lato = Math.sign((a.x - trackPts[near.index].x) * nx + (a.z - trackPts[near.index].z) * nz) || 1;
        const ghiaia = TrackGravel.gravelAt(prof, near.index, lato);
        const spostamento = Math.hypot(b.x - a.x, b.z - a.z);

        if (ghiaia === 0) {
            assert.ok(spostamento < 1e-6,
                `voce ${i} (${a.asset}) spostata di ${spostamento.toFixed(2)} dove non c'è ghiaia`);
        } else {
            assert.ok(Math.abs(spostamento - ghiaia) < 0.5,
                `voce ${i} (${a.asset}) spostata di ${spostamento.toFixed(2)}, attese ${ghiaia.toFixed(2)}`);
            spostate++;
        }
    }
    assert.ok(spostate > 0, 'su monte-rosso qualcosa deve essersi spostato');
});
```

- [ ] **Step 2: eseguire il test e verificare che fallisca**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: FAIL — nessuna voce si sposta, quindi `assert.ok(spostate > 0)` fallisce.

- [ ] **Step 3: implementare la traslazione**

In `frontend/shared/trackScenery.js`, aggiungere la dipendenza da `TrackGravel` nell'intestazione UMD del file, accanto agli altri moduli condivisi già importati (`require('./trackGravel.js')` sul ramo Node, `root.TrackGravel` sul ramo browser).

Cambiare la firma (riga 933):

```javascript
    function generateLayout(trackData, trackPts, pitPts, barrierDist, embankmentWidth = 45, seatAnchors = null, gravelProfile = null) {
```

e sostituire il `return layout;` finale (riga 1002) con:

```javascript
        if (pond) layout.push(pond);
        return traslaOltreLaGhiaia(layout, trackPts, gravelProfile);
    }

    // La scenografia viene calcolata con la barriera "di base" (quella di
    // sempre) e poi spostata in blocco verso l'esterno di quanta ghiaia c'è in
    // quel punto: è il requisito dell'utente — tutto esattamente come ora,
    // semplicemente traslato dopo la ghiaia.
    //
    // Perché a valle e non riscrivendo le ~50 occorrenze di barrierDist nei
    // sei moduli di scenografia: dove la ghiaia è 0 lo spostamento è 0, quindi
    // i rettilinei restano identici PER COSTRUZIONE e i test esistenti
    // continuano a valere. Le distanze reciproche si conservano — gli oggetti
    // della stessa zona traslano insieme, e spostarsi verso l'esterno di una
    // curva li allontana fra loro (raggio maggiore), mai li avvicina: nessuna
    // compenetrazione nuova possibile.
    //
    // Le colline e il prato NON passano di qui: sono terreno, non oggetti, e
    // stanno centinaia di unità più in là.
    function traslaOltreLaGhiaia(layout, trackPts, gravelProfile) {
        if (!gravelProfile) return layout;

        for (const voce of layout) {
            const near = TrackGeometry.nearestPoint(trackPts, voce.x, voce.z);
            const p = trackPts[near.index];
            const { nx, nz } = TrackGeometry.normalAt(trackPts, near.index, true);
            // Da che lato della pista sta la voce: segno della componente
            // normale del vettore centro-pista -> oggetto.
            const lato = Math.sign((voce.x - p.x) * nx + (voce.z - p.z) * nz) || 1;
            const ghiaia = TrackGravel.gravelAt(gravelProfile, near.index, lato);
            if (ghiaia <= 0) continue;

            voce.x += nx * ghiaia * lato;
            voce.z += nz * ghiaia * lato;
            // Quota ricalcolata alla posizione nuova. In pratica non cambia
            // (la ghiaia esiste solo dove il terreno è in piano), ma è una
            // garanzia, non un'ipotesi.
            if (typeof voce.y === 'number') {
                voce.y = TrackGeometry.terrainHeightAt(groundPts, voce.x, voce.z, barrierDist, embankOuter);
            }
        }
        return layout;
    }
```

⚠️ `traslaOltreLaGhiaia` è definita **fuori** da `generateLayout` (accanto alle
altre funzioni del modulo) e riceve tutto per parametro, così resta testabile da
sola. La firma esatta è:

```javascript
    function traslaOltreLaGhiaia(layout, trackPts, gravelProfile, groundPts, barrierDist, embankOuter) {
```

e la chiamata alla fine di `generateLayout` è:

```javascript
        return traslaOltreLaGhiaia(layout, trackPts, gravelProfile,
            trackPts.filter(p => !p.bridge), barrierDist, embankOuter);
```

`groundPts` sono i punti non-ponte, gli stessi che `terrainHeightAt` si aspetta
altrove in questo file.

In `frontend/f1.js` (riga 615) passare il profilo:

```javascript
    const sceneryLayout = TrackScenery.generateLayout(trackData, trackPts, PIT_PTS, BARRIER_D, EMBANKMENT_WIDTH, seatAnchors, GRAVEL_PROFILE);
```

- [ ] **Step 4: eseguire i test e verificare che passino**

Run: `node --test frontend/shared/trackScenery.test.js frontend/shared/sceneryTrackside.test.js frontend/shared/sceneryLandmarks.test.js frontend/shared/sceneryHills.test.js`
Expected: PASS su tutti — i test esistenti non passano il profilo, quindi devono restare identici.

Bumpare `f1.js?v=` in `f1.html` e far verificare all'utente in localhost: tribune, gomme e cartelloni devono stare **oltre** la ghiaia nelle curve, e non essersi mossi di un'unità sui rettilinei.

- [ ] **Step 5: commit**

```bash
git add frontend/shared/trackScenery.js frontend/shared/trackScenery.test.js frontend/f1.js frontend/f1.html
git commit -m "F1 ghiaia: la scenografia trasla oltre la ghiaia dove c'e'"
```

---

### Task 7: il muro solido su tutto il giro

Ultimo pezzo: oggi la barriera è rigida solo sui ponti. Diventa muro ovunque, alla distanza del profilo, col varco dove passa la corsia box.

**Files:**
- Modify: `backend/sockets/games/trackLoader.js:226-245` (esporre il profilo)
- Modify: `backend/sockets/games/physics/CollisionResolver.js:60-140` (`applyBridgeBarrier` → `applyBarrier`)
- Modify: `backend/sockets/games/physics/VehiclePhysics.js`, `VehicleDynamics.js`, `backend/sockets/games/f1GameSocket.js`, `backend/tools/f1RaceLineOptimizer.js` (chiamanti)
- Test: `backend/sockets/games/f1GameSocket.physics.test.js`, `backend/sockets/games/trackLoader.test.js`

**Interfaces:**
- Consumes: `TrackGravel.gravelProfile`, `TrackGravel.barrierDistAt`, `TrackGravel.pitGapSamples` (Task 2, 3).
- Produces: `track.gravelProfile` e `track.pitGapPts` da `trackLoader.buildTrack`; `physics.applyBarrier(p, track, isRace)` al posto di `applyBridgeBarrier`.

- [ ] **Step 1: scrivere il test che fallisce**

In `backend/sockets/games/f1GameSocket.physics.test.js`, in coda:

```javascript
test('applyBarrier: il muro trattiene l\'auto anche fuori dai ponti', () => {
    const { physics } = f1GameSocket;
    const TrackGravel = require('../../../frontend/shared/trackGravel.js');
    const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');

    // Pista circolare di raggio 100, tutta a terra (nessun ponte).
    const points = [];
    for (let i = 0; i < 200; i++) {
        const a = i / 200 * Math.PI * 2;
        points.push({ x: Math.cos(a) * 100, z: Math.sin(a) * 100, y: 0, bridge: false });
    }
    const track = {
        points, roadHalf: 11,
        gravelProfile: { left: new Float64Array(200), right: new Float64Array(200) },
        pitGapPts: [],
    };

    // Auto ben oltre il limite (roadHalf + margine = 13), spinta verso l'esterno.
    const p = { x: 130, z: 0, vx: 5, vz: 0, speed: 5, trackIndex: 0, damage: {}, pendingCollisionPenaltyEvents: [] };
    physics.applyBarrier(p, track, false);

    const distanza = Math.hypot(p.x, p.z);
    assert.ok(distanza <= 113.5,
        `l'auto deve essere riportata sul muro, sta a ${distanza.toFixed(1)}`);
    assert.ok(p.vx <= 0.001, 'la spinta verso l\'esterno è stata rimossa');
});

test('applyBarrier: dove c\'è ghiaia il muro è più lontano', () => {
    const { physics } = f1GameSocket;
    const points = [];
    for (let i = 0; i < 200; i++) {
        const a = i / 200 * Math.PI * 2;
        points.push({ x: Math.cos(a) * 100, z: Math.sin(a) * 100, y: 0, bridge: false });
    }
    const right = new Float64Array(200).fill(25);
    const track = {
        points, roadHalf: 11,
        gravelProfile: { left: new Float64Array(200), right },
        pitGapPts: [],
    };

    // Stessa auto di prima: ora il muro sta 25 unità più in là, quindi a 130
    // non lo tocca affatto e non viene spostata.
    const p = { x: 130, z: 0, vx: 5, vz: 0, speed: 5, trackIndex: 0, damage: {}, pendingCollisionPenaltyEvents: [] };
    physics.applyBarrier(p, track, false);
    assert.ok(Math.abs(p.x - 130) < 1e-6, 'con la ghiaia il muro è oltre: nessuno spostamento');
});

test('applyBarrier: nessun muro nel varco della corsia box', () => {
    const { physics } = f1GameSocket;
    const points = [];
    for (let i = 0; i < 200; i++) {
        const a = i / 200 * Math.PI * 2;
        points.push({ x: Math.cos(a) * 100, z: Math.sin(a) * 100, y: 0, bridge: false });
    }
    const track = {
        points, roadHalf: 11,
        gravelProfile: { left: new Float64Array(200), right: new Float64Array(200) },
        // Varco proprio dove sta l'auto del test.
        pitGapPts: [{ x: 115, z: 0 }],
    };
    const p = { x: 130, z: 0, vx: 5, vz: 0, speed: 5, trackIndex: 0, damage: {}, pendingCollisionPenaltyEvents: [] };
    physics.applyBarrier(p, track, false);
    assert.ok(Math.abs(p.x - 130) < 1e-6, 'nel varco l\'auto passa');
});
```

E in `backend/sockets/games/trackLoader.test.js`:

```javascript
test('loadTrack espone il profilo di ghiaia e i punti del varco box', () => {
    const t = loadTrack('prova');
    assert.ok(t.gravelProfile && t.gravelProfile.left && t.gravelProfile.right,
        'gravelProfile presente');
    assert.equal(t.gravelProfile.left.length, t.points.length);
    assert.ok(Array.isArray(t.pitGapPts) && t.pitGapPts.length > 0);
    // Su "prova" ci sono curve a terra: almeno un campione deve avere ghiaia.
    const conGhiaia = [...t.gravelProfile.left, ...t.gravelProfile.right].some(v => v > 0);
    assert.ok(conGhiaia, 'su "prova" ci deve essere ghiaia da qualche parte');
});

test('la barriera non finisce mai dentro la corsia box', () => {
    const TrackGravel = require('../../../frontend/shared/trackGravel.js');
    const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');
    for (const id of ['prova', 'monte-rosso', 'new-monza', 'baku']) {
        const t = loadTrack(id);
        const base = t.roadHalf + 2.8 + 1.2;
        for (let i = 0; i < t.points.length; i++) {
            for (const side of [-1, 1]) {
                const d = TrackGravel.barrierDistAt(t.gravelProfile, i, side, base);
                if (d === base) continue;   // niente ghiaia qui
                const { nx, nz } = TrackGeometry.normalAt(t.points, i, true);
                const x = t.points[i].x + nx * d * side;
                const z = t.points[i].z + nz * d * side;
                const dPit = TrackGeometry.nearestPoint(t.pitLanePts, x, z).dist;
                assert.ok(dPit >= t.pitRoadHalf,
                    `${id}: barriera dentro la corsia box al campione ${i} (dist ${dPit.toFixed(1)})`);
            }
        }
    }
});
```

- [ ] **Step 2: eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/f1GameSocket.physics.test.js backend/sockets/games/trackLoader.test.js`
Expected: FAIL — `physics.applyBarrier is not a function`, `t.gravelProfile` undefined. (Restano rossi anche i 2 test preesistenti su `monte-rosso`: sono attesi.)

- [ ] **Step 3: implementare**

In `backend/sockets/games/trackLoader.js`, prima del `return` di `buildTrack` (riga ~226):

```javascript
    // Profilo delle vie di fuga: calcolato con la STESSA funzione che usa il
    // client per disegnarle (modulo condiviso), così muro fisico e barriera
    // disegnata non possono divergere. Non è un dato del .json della pista:
    // è derivato, quindi non può andare fuori sincrono.
    const gravelProfile = TrackGravel.gravelProfile(points, {
        roadHalf: raw.roadHalfWidth,
        pitLanePts,
        pitRoadHalf: raw.pit.roadHalfWidth,
    });
    const pitGapPts = TrackGravel.pitGapSamples(pitLanePts);
```

aggiungere `gravelProfile, pitGapPts,` all'oggetto ritornato, e in cima al file `const TrackGravel = require('../../../frontend/shared/trackGravel.js');`.

In `backend/sockets/games/physics/CollisionResolver.js` rinominare `applyBridgeBarrier` in `applyBarrier` e cambiare **solo** come si calcola `limit` e la condizione d'uscita anticipata. La meccanica del contatto (rimozione della sola componente normale uscente, attrito, danno) NON si tocca:

```javascript
const TrackGravel = require('../../../../frontend/shared/trackGravel.js');

// Muro rigido su TUTTO il tracciato (prima solo sui tratti a ponte). Il
// limite viene dal profilo di ghiaia: dove non c'è ghiaia coincide con la
// barriera di sempre, dove c'è sta 25 unità più in là — la stessa distanza a
// cui il client la disegna.
//
// Il verso e la meccanica del contatto sono invariati rispetto al redesign
// 2026-07-23: si rimuove SOLO la componente di velocità che spinge oltre il
// muro, mai si calcola o si sceglie una direzione "giusta" per il giocatore.
function applyBarrier(p, track, isRace) {
    const idx = TrackGeometry.nearestIndexNear(track.points, p.trackIndex || 0, p.x, p.z, TRACK_INDEX_WINDOW);
    const pt = track.points[idx];

    const dx = p.x - pt.x, dz = p.z - pt.z;
    const dist = Math.hypot(dx, dz);

    // Da che lato della pista sta l'auto.
    const { nx, nz } = TrackGeometry.normalAt(track.points, idx, true);
    const side = Math.sign(dx * nx + dz * nz) || 1;

    // Sui ponti il limite resta quello storico (roadHalf + margine): lì non
    // c'è ghiaia e la barriera è a filo pista.
    const limit = pt.bridge
        ? track.roadHalf + BRIDGE_BARRIER_MARGIN
        : TrackGravel.barrierDistAt(track.gravelProfile, idx, side,
            track.roadHalf + TrackGravel.CURB_W + TrackGravel.BARRIER_GAP);

    if (dist <= limit) { p.wallContact = false; return; }

    // Varco della corsia box: lì la barriera non esiste (né disegnata né
    // fisica), altrimenti si sbatterebbe contro un muro invisibile entrando
    // ai box.
    if (track.pitGapPts && track.pitGapPts.length &&
        TrackGeometry.nearestPoint(track.pitGapPts, p.x, p.z).dist < BARRIER_PIT_GAP_THRESHOLD) {
        p.wallContact = false;
        return;
    }

    // ...da qui in poi il corpo di applyBridgeBarrier resta IDENTICO...
}
```

Aggiungere in testa al file `const BARRIER_PIT_GAP_THRESHOLD = 8;` con il commento che spiega che è lo stesso valore usato dal disegno in `trackMeshBuilder.js`.

⚠️ La vecchia guardia `if (!pt.bridge) return;` va **rimossa**: era ciò che limitava il muro ai ponti.

Aggiornare i chiamanti — `grep -rn "applyBridgeBarrier" backend/` deve tornare vuoto a fine task:
- `backend/sockets/games/physics/VehiclePhysics.js` e `VehicleDynamics.js`
- `backend/sockets/games/f1GameSocket.js` (export `physics`)
- `backend/tools/f1RaceLineOptimizer.js:155`
- `backend/sockets/games/f1GameSocket.physics.test.js:21` e `:316` (nome nella lista di export attesi e nel test esistente)

- [ ] **Step 4: eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/f1GameSocket.physics.test.js backend/sockets/games/trackLoader.test.js backend/sockets/games/physics/`
Expected: PASS su tutto, tranne i 2 test preesistenti su `monte-rosso` in `trackLoader.test.js`.

Poi il controllo di non-regressione sui tempi sul giro (il muro non deve rallentare i bot):

```bash
cd backend && node tools/f1LapSimulator.js prova
```

Il tempo deve restare nell'intorno di quello di prima della feature. ⚠️ Il simulatore è rumoroso: confrontare la media di ~10 run, mai un singolo valore.

- [ ] **Step 5: commit**

```bash
git add backend/
git commit -m "F1 ghiaia: le barriere diventano muro solido su tutto il giro"
```

---

### Task 8: documentazione e verifica finale

**Files:**
- Modify: `docs/f1-notes.md`

- [ ] **Step 1: aggiornare le note tecniche**

Aggiungere a `docs/f1-notes.md` una sezione "Vie di fuga in ghiaia (2026-08-10)" che copra:
- `trackGravel.js` è la **sorgente unica**: disegno, barriere, muro fisico e traslazione della scenografia leggono tutti quel profilo. Chi ne aggiunge un quinto consumatore deve passare di lì.
- La ghiaia si azzera su ponti e tratti in quota — **non** è una svista: evita di dover allargare il terrapieno, che è tarato su `EMBANKMENT_START = roadHalf + curbW`.
- La scenografia si trasla **a valle** di `generateLayout`, non riscrivendo `barrierDist` nei sei moduli. Perché: dove la ghiaia è 0 lo spostamento è 0, quindi i rettilinei restano identici per costruzione.
- Il **varco della corsia box** deve venire dalla stessa funzione per disegno e fisica (`TrackGravel.pitGapSamples`): se divergessero, si sbatterebbe contro un muro invisibile all'ingresso dei box.
- `applyBridgeBarrier` non esiste più: si chiama `applyBarrier` e vale su tutto il giro.
- Baku non ha ghiaia perché tutte le sue curve sono su tratti a ponte: è corretto, non un bug.

- [ ] **Step 2: far girare l'intera suite**

Run: `node --test backend/ frontend/shared/ 2>&1 | tail -20`
Expected: solo i 2 fallimenti preesistenti di `monte-rosso` in `trackLoader.test.js`.

- [ ] **Step 3: playtest dell'utente**

Server dal worktree:

```bash
cd backend && node server.js
```

Lista di verifica per l'utente:
1. **prova** — ghiaia beige all'esterno delle curve, barriere oltre la ghiaia, tribune e cartelloni traslati con loro.
2. Rettilinei: tutto esattamente dov'era.
3. Uscire di pista in curva a velocità piena: si finisce in ghiaia, si rallenta, **non** si arriva al prato.
4. Ingresso e uscita dai box: nessun muro invisibile.
5. **baku**: nessuna ghiaia, tutto come prima.
6. Curve sopraelevate di **prova**: niente ghiaia, barriera a filo pista.

- [ ] **Step 4: commit**

```bash
git add docs/f1-notes.md
git commit -m "F1 ghiaia: note tecniche delle vie di fuga"
```

---

## Note per chi esegue

- **Se un test di scenografia esistente diventa rosso**, non aggiustare il test: significa che la traslazione ha toccato qualcosa che doveva restare fermo. I test esistenti non passano il profilo, quindi devono comportarsi esattamente come prima.
- **Il simulatore è rumoroso**: `botLapPaceMult` si ri-randomizza più volte per giro, quindi un singolo run non dice nulla. Servono ~10-30 run per confrontare due configurazioni.
- **Il cache-busting va bumpato ad ogni modifica di `f1.js`**, altrimenti il browser serve il file vecchio e sembra che il lavoro non abbia avuto effetto.
- **Non toccare `applyOffTrackDrag`**: ghiaia ed erba frenano uguale per decisione esplicita dell'utente, ed è ciò che rende questa feature a rischio zero per i tempi sul giro.
