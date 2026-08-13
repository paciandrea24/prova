# F1 — La scenografia segue il muro vero — Piano di implementazione

> **Per chi esegue con agenti:** SUB-SKILL RICHIESTA — usare
> `superpowers:subagent-driven-development` (consigliata) oppure
> `superpowers:executing-plans` per eseguire il piano task per task. Gli step
> usano checkbox (`- [ ]`) per il tracciamento.

**Goal:** far sì che tribune, reti e passerella prendano posizione e
orientamento dal muro vero, invece che dalla pista e da una distanza storica
che non vale più.

**Architettura:** una funzione sola in `trackGeometry.js` dà la direzione
perpendicolare al NASTRO del muro; i due punti che oggi copiano la stessa riga
sbagliata la chiamano. Il footbridge riceve il `barrierProfile` e se ne serve
sia per scegliere dove stare sia per decidere quanto essere lungo.

**Stack:** Node.js puro, `node:test`, moduli UMD condivisi fra client e server
in `frontend/shared/`. Nessuna dipendenza nuova.

**Spec:** `docs/superpowers/specs/2026-08-13-f1-scenografia-sul-muro-vero-design.md`

## Vincoli globali

- **Worktree:** `.claude/worktrees/f1-ghiaia`, branch `f1-ghiaia`, si parte da
  `701c53c`. Tutti i comandi si eseguono dalla radice del worktree.
- **Comando test:** `node --test <file>` (in `backend/package.json` lo script
  `test` è un segnaposto che esce con errore).
- **Italiano** nei commenti del codice e nei messaggi di commit.
- **Un commit per task.** Il push resta manuale dell'utente: non pushare mai.
- **4 test rossi preesistenti** non sono di questo lavoro e restano rossi:
  Simcade isolamento componenti, i due `loadTrack("monte-rosso")`,
  `simulateLap` col preset di tuning. Il **quinto rosso della suite cambia
  identità a ogni run** (`deleteTrack`, `segnalazioniRoutes`): è flakiness da
  esecuzione parallela su file condivisi, non una regressione — isolati
  passano sempre.
- ⚠️ **La distanza dei moduli di rete NON si tocca**, solo l'orientamento.
  `catchFence` sta a distanza costante (il massimo del muro su tre campioni)
  per una ragione misurata: vedi `sceneryTrackside.js:155-165`. Toccarla
  riapre "reti staccate dalla tribuna" (3 su 99, fino a 11.3 unità) e "reti
  dentro la via di fuga" (fino a 4.9 oltre il muro), difetti già chiusi.
- ⚠️ **`tyreStack`, `brakingBoard` e `marshalPost` restano fuori.** Deviano
  fino a 79° dalla parallela al muro anche dove il muro è piatto, perché per
  loro il parallelismo non è la regola: un cartello di frenata sta
  perpendicolare alla pista per essere letto.
- **Le firme pubbliche restano retrocompatibili:** i parametri nuovi vanno in
  coda e opzionali. `buildLandmarks` è chiamata anche dai suoi test con la
  firma vecchia.

---

## Struttura dei file

| File | Responsabilità |
|---|---|
| `frontend/shared/trackGeometry.js` | modifica — nuova `ribbonFacingAt`: la direzione perpendicolare al nastro a distanza variabile. |
| `frontend/shared/trackGeometry.test.js` | modifica — test della nuova funzione su geometrie dove la risposta si sa a mente. |
| `frontend/shared/trackScenery.js` | modifica — `moduleAt` usa `ribbonFacingAt` e passa finalmente `side`. |
| `frontend/shared/trackScenery.test.js` | modifica — invarianti su tribune: orientamento, lato, nessuna compenetrazione. |
| `frontend/shared/sceneryTrackside.js` | modifica — `place` accetta il profilo da cui prendere l'orientamento; `catchFence` glielo passa. |
| `frontend/shared/sceneryTrackside.test.js` | modifica — reti: orientamento, e le due invarianti già esistenti restano. |
| `frontend/shared/sceneryLandmarks.js` | modifica — `buildLandmarks` riceve `barrierProfile`; il footbridge cerca un punto stretto e si scala sul muro vero. |
| `frontend/shared/sceneryLandmarks.test.js` | modifica — la passerella copre il muro su entrambi i lati. |
| `frontend/f1.html` | modifica — bump del cache-busting. |

---

### Task 1: La direzione del nastro

**File:**
- Modifica: `frontend/shared/trackGeometry.js` — nuova funzione accanto a
  `normalAt` (riga ~246) e voce nell'oggetto esportato (riga ~1081)
- Test: `frontend/shared/trackGeometry.test.js`

**Interfacce:**
- Consuma: `normalAt(points, i, closed) -> {nx, nz}`.
- Produce: `ribbonFacingAt(points, i, side, distanzaA) -> number`, dove
  `distanzaA(idx, side) -> number` è la distanza del nastro dall'asse. Il
  numero restituito è un `rotY` nella convenzione del gioco, pronto per essere
  assegnato a una voce di scenografia.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in fondo a `frontend/shared/trackGeometry.test.js`:

```javascript
// ---- ribbonFacingAt: guardare il nastro, non la pista ----
//
// Un oggetto posato accanto alla pista deve guardare perpendicolarmente al
// NASTRO su cui sta, che coincide con la pista solo se la distanza è
// costante. Dove il muro sale o scende il nastro è inclinato, e un oggetto
// orientato sulla normale della pista risulta storto: misurati 30° sulla
// tribuna del campione 615 di `prova` (2026-08-13).

function rettilineo(n = 200, passo = 5) {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push({ x: i * passo, z: 0, y: 0 });
    return pts;
}

test('ribbonFacingAt: a distanza costante coincide con la normale della pista', () => {
    const pts = rettilineo();
    for (const side of [-1, 1]) {
        const atteso = Math.atan2(0, -side);   // guarda verso la pista
        const avuto = TrackGeometry.ribbonFacingAt(pts, 50, side, () => 20);
        const d = Math.abs(Math.atan2(Math.sin(avuto - atteso), Math.cos(avuto - atteso)));
        assert.ok(d < 1e-9, `lato ${side}: atteso ${atteso}, avuto ${avuto}`);
    }
});

test('ribbonFacingAt: su una rampa ruota quanto il nastro è inclinato', () => {
    // Il nastro si allontana di 5 unità ogni campione, e il campione è lungo
    // 5: il nastro sta a 45° rispetto alla pista, quindi anche la
    // perpendicolare al nastro sta a 45° dalla normale della pista.
    const pts = rettilineo();
    const dritto = TrackGeometry.ribbonFacingAt(pts, 50, 1, () => 20);
    const inRampa = TrackGeometry.ribbonFacingAt(pts, 50, 1, (i) => 20 + i * 5);
    let delta = inRampa - dritto;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    assert.ok(Math.abs(Math.abs(delta) - Math.PI / 4) < 1e-6,
        `attesi 45°, avuti ${(delta * 180 / Math.PI).toFixed(2)}°`);
});

test('ribbonFacingAt: guarda sempre verso la pista, su entrambi i lati', () => {
    const pts = rettilineo();
    for (const side of [-1, 1]) {
        const rot = TrackGeometry.ribbonFacingAt(pts, 50, side, (i) => 20 + i * 2);
        const { nx, nz } = TrackGeometry.normalAt(pts, 50, true);
        const d = 20 + 50 * 2;
        const qui = { x: pts[50].x + nx * d * side, z: pts[50].z + nz * d * side };
        // il verso indicato da rotY deve avvicinarsi al punto pista
        const vx = Math.sin(rot), vz = Math.cos(rot);
        assert.ok((pts[50].x - qui.x) * vx + (pts[50].z - qui.z) * vz > 0,
            `lato ${side}: l'oggetto dà le spalle alla pista`);
    }
});

test('ribbonFacingAt: riceve il lato e lo passa alla funzione di distanza', () => {
    const pts = rettilineo();
    const visti = [];
    TrackGeometry.ribbonFacingAt(pts, 50, -1, (i, side) => { visti.push(side); return 20; });
    assert.ok(visti.length > 0 && visti.every(s => s === -1),
        `atteso lato -1 a ogni chiamata, visti ${[...new Set(visti)].join(',')}`);
});
```

- [ ] **Step 2: Lanciare i test e verificare che falliscano**

Comando: `node --test frontend/shared/trackGeometry.test.js`
Atteso: FAIL, `TrackGeometry.ribbonFacingAt is not a function`.

- [ ] **Step 3: Scrivere la funzione**

In `frontend/shared/trackGeometry.js`, subito dopo `normalAt`:

```javascript
    // Direzione in cui deve guardare un oggetto posato su un nastro parallelo
    // alla pista a distanza `distanzaA(idx, side)`: perpendicolare al NASTRO,
    // non alla pista.
    //
    // Dove la distanza è costante le due direzioni coincidono — è il motivo
    // per cui questa funzione non cambia nulla su 136 elementi di 149. Dove
    // il muro sale o scende, il nastro è inclinato rispetto alla pista di
    // atan(variazione della distanza / passo di pista), e un oggetto
    // orientato sulla normale della pista risulta storto di altrettanto:
    // misurati 37° sulla rete del campione 414 di `prova` e 31° sulla tribuna
    // del 615, quella segnalata in gioco dall'utente il 2026-08-12.
    function ribbonFacingAt(points, i, side, distanzaA) {
        const n = points.length;
        const punto = (k) => {
            const { nx, nz } = normalAt(points, k, true);
            const d = distanzaA(k, side);
            return { x: points[k].x + nx * d * side, z: points[k].z + nz * d * side };
        };
        const qui = punto(i);
        const versoPista = { x: points[i].x - qui.x, z: points[i].z - qui.z };
        const a = punto((i - 1 + n) % n), b = punto((i + 1) % n);
        let tx = b.x - a.x, tz = b.z - a.z;
        const len = Math.hypot(tx, tz);
        // Nastro degenere (i due vicini coincidono): non c'è una tangente da
        // cui ricavare la perpendicolare, si torna alla normale della pista
        // invece di produrre un NaN.
        if (len < 1e-9) return Math.atan2(versoPista.x, versoPista.z);
        tx /= len; tz /= len;
        let fx = -tz, fz = tx;
        if (versoPista.x * fx + versoPista.z * fz < 0) { fx = -fx; fz = -fz; }
        return Math.atan2(fx, fz);
    }
```

- [ ] **Step 4: Esportarla**

Nell'oggetto restituito dal modulo (riga ~1081), accanto a `normalAt`:

```javascript
        tangentAt,
        normalAt,
        ribbonFacingAt,
```

- [ ] **Step 5: Lanciare i test e verificare che passino**

Comando: `node --test frontend/shared/trackGeometry.test.js`
Atteso: PASS, i 4 nuovi più tutti i preesistenti.

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/trackGeometry.js frontend/shared/trackGeometry.test.js
git commit -m "F1 scenografia: la direzione perpendicolare al nastro del muro"
```

---

### Task 2: Le tribune guardano il muro, e sanno da che lato stanno

**File:**
- Modifica: `frontend/shared/trackScenery.js:706-713` (`moduleAt` dentro
  `buildStandRow`)
- Test: `frontend/shared/trackScenery.test.js`

**Interfacce:**
- Consuma: `TrackGeometry.ribbonFacingAt` (Task 1),
  `distanzaDalMuro(barrierProfile, barrierDist, margine) -> (idx, side) => number`.
- Produce: nessuna interfaccia nuova.

Questo task chiude **due** cause insieme, perché stanno nelle stesse tre righe:
l'orientamento preso dalla pista, e `side` che non veniva passato alla funzione
di distanza — quindi `barrierAt` riceveva `undefined`, e `undefined > 0` è
falso: ogni tribuna prendeva la distanza del muro **sinistro**.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in fondo a `frontend/shared/trackScenery.test.js`:

```javascript
// ---- tribune e reti allineate al muro ----
//
// L'utente ha chiesto in gioco (2026-08-12, segnalazione al campione 620)
// che "orientamento della tribuna E della catchFence davanti seguano
// l'andamento delle barriere". Fino al 2026-08-13 seguivano la normale della
// PISTA, che è la stessa cosa solo dove il muro sta a distanza costante.
// ⚠️ `trackScenery.test.js` importa oggi solo TrackGeometry e TrackScenery:
// TrackGravel va aggiunto, o `barrierProfile` non si può nemmeno costruire.
const TrackGravel = require('./trackGravel.js');
const fsAllineamento = require('fs');
const pathAllineamento = require('path');

function circuitoVero(id) {
    const raw = JSON.parse(fsAllineamento.readFileSync(pathAllineamento.join(
        __dirname, '..', 'tracks', `${id}.json`), 'utf8'));
    const trackPts = TrackGeometry.sampleLoop(raw.controlPoints, 1000);
    const barrierProfile = TrackGravel.barrierProfile(trackPts, { roadHalf: raw.roadHalfWidth });
    const BARRIER_D = raw.roadHalfWidth + 2.8 + 1.2;
    const layout = TrackScenery.generateLayout(raw, trackPts, null, BARRIER_D, 45, null, barrierProfile);
    return { raw, trackPts, barrierProfile, layout, BARRIER_D };
}

// Su che lato della pista sta una voce, e a che campione.
function doveSta(trackPts, voce) {
    const v = TrackGeometry.nearestPoint(trackPts, voce.x, voce.z);
    const { nx, nz } = TrackGeometry.normalAt(trackPts, v.index, true);
    const seg = (voce.x - trackPts[v.index].x) * nx + (voce.z - trackPts[v.index].z) * nz;
    return { idx: v.index, side: seg >= 0 ? 1 : -1, dist: v.dist };
}

// Quanto una voce devia dalla parallela al nastro del muro, in gradi.
// ⚠️ rotY è la direzione in cui l'oggetto GUARDA, cioè perpendicolare al
// nastro: una tribuna messa bene ha 90° di scarto dalla tangente, non 0.
function deviazioneDalMuro(trackPts, barrierProfile, voce) {
    const { idx, side } = doveSta(trackPts, voce);
    const n = trackPts.length;
    const punto = (k) => {
        const { nx, nz } = TrackGeometry.normalAt(trackPts, k, true);
        const d = TrackGravel.barrierAt(barrierProfile, k, side);
        return { x: trackPts[k].x + nx * d * side, z: trackPts[k].z + nz * d * side };
    };
    const a = punto((idx - 3 + n) % n), b = punto((idx + 3) % n);
    const angNastro = Math.atan2(b.x - a.x, b.z - a.z) * 180 / Math.PI;
    let s = ((voce.rotY * 180 / Math.PI - angNastro) % 180 + 180) % 180;
    if (s > 90) s -= 180;
    return Math.abs(90 - Math.abs(s));
}

// Tipi per cui il parallelismo al muro È la regola. tyreStack e brakingBoard
// sono esclusi apposta: un cartello di frenata sta perpendicolare alla pista
// per essere letto, e per lui 79° di scarto non sono un difetto.
const PARALLELI_AL_MURO = new Set(['catchFence', 'grandStandCovered',
    'grandStandAwning', 'grandStand', 'grandStandSmall']);

for (const id of ['prova', 'new-monza', 'monte-rosso', 'baku']) {
    test(`scenografia: tribune e reti restano parallele al muro (${id})`, () => {
        const { trackPts, barrierProfile, layout } = circuitoVero(id);
        const storti = layout
            .filter(v => PARALLELI_AL_MURO.has(v.asset))
            .map(v => ({ v, d: deviazioneDalMuro(trackPts, barrierProfile, v), dove: doveSta(trackPts, v) }))
            .filter(m => m.d > 10);
        assert.equal(storti.length, 0,
            `${id}: ${storti.length} elementi oltre 10° dal muro — `
            + storti.slice(0, 5).map(m => `${m.v.asset}@${m.dove.idx} ${m.d.toFixed(1)}°`).join(', '));
    });
}

test('scenografia: ogni tribuna sta alla distanza del muro del PROPRIO lato', () => {
    // `distanzaDalMuro` restituisce una funzione (idx, side), ma fino al
    // 2026-08-13 buildStandRow la chiamava con il solo idx: side arrivava
    // undefined e `barrierAt` faceva `side > 0 ? right : left`, quindi TUTTE
    // le tribune prendevano il muro sinistro. Su new-monza una finiva a 14.3
    // unità dal posto giusto.
    for (const id of ['prova', 'new-monza']) {
        const { trackPts, barrierProfile, layout } = circuitoVero(id);
        for (const v of layout.filter(v => v.category === 'grandstand' || v.category === 'grandstand-main')) {
            const { idx, side, dist } = doveSta(trackPts, v);
            const suo = TrackGravel.barrierAt(barrierProfile, idx, side);
            const sinistro = TrackGravel.barrierAt(barrierProfile, idx, -1);
            if (Math.abs(suo - sinistro) < 0.5) continue;   // i due lati coincidono: non discrimina
            assert.ok(Math.abs(dist - suo) < Math.abs(dist - sinistro) + 1e-9,
                `${id}: ${v.asset} al campione ${idx} lato ${side > 0 ? 'dx' : 'sx'} sta a ${dist.toFixed(1)}, `
                + `più vicino al muro sinistro (${sinistro.toFixed(1)}) che al suo (${suo.toFixed(1)})`);
        }
    }
});
```

- [ ] **Step 2: Lanciare i test e verificare il rosso**

Comando: `node --test frontend/shared/trackScenery.test.js`
Atteso: FAIL su `prova` (11 elementi oltre 10°, fra cui
`grandStandCovered@615` a 30.7° e `catchFence@414` a 37.1°) e FAIL sul test
del lato. Se `prova` passa, **fermarsi**: il test non riproduce il difetto.

Nota: le reti falliranno finché non si esegue il Task 3 — questo task sistema
solo le tribune. È atteso, e il Task 3 lo chiude.

- [ ] **Step 3: Correggere `moduleAt`**

In `frontend/shared/trackScenery.js`, sostituire il corpo di `moduleAt`
(righe 706-713) con:

```javascript
        function moduleAt(idx) {
            const p = trackPts[idx];
            const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
            // ⚠️ `side` va passato: `distanzaDalMuro` restituisce una funzione
            // di DUE argomenti e `barrierAt` fa `side > 0 ? right : left`.
            // Chiamandola col solo indice, side arrivava undefined e ogni
            // tribuna prendeva il muro sinistro — su new-monza una finiva a
            // 14.3 unità dal posto giusto (misurato il 2026-08-13).
            const d = distanzaA(idx, side);
            const x = p.x + nx * d * side;
            const z = p.z + nz * d * side;
            // L'oggetto guarda perpendicolarmente al NASTRO del muro, non
            // alla pista: dove il muro è in rampa le due direzioni divergono
            // e la tribuna risultava storta fino a 31°, che è la segnalazione
            // dell'utente al campione 620 di `prova`.
            return { x, z, idx, rotY: TrackGeometry.ribbonFacingAt(trackPts, idx, side, distanzaA) };
        }
```

- [ ] **Step 4: Lanciare i test**

```bash
node --test frontend/shared/trackScenery.test.js
node --test frontend/shared/sceneryTrackside.test.js
```

Atteso: il test del lato passa; il test dell'allineamento passa per le
tribune e **resta rosso per le `catchFence`**, che sono del Task 3. Le
invarianti preesistenti di entrambi i file restano verdi — in particolare
"nessuna compenetrazione fra moduli": ruotando i moduli di una schiera si
possono aprire giunti o farli accavallare, ed è la cosa da controllare qui.

- [ ] **Step 5: Misurare le due invarianti a rischio**

```bash
node backend/tools/f1-segnalazioni.js | head -3
```

Atteso: il conteggio degli elementi per categoria non cambia rispetto a
`701c53c` (4080 su `prova`). Se cala, la schiera si sta interrompendo prima:
la rete di sicurezza contro i moduli accavallati (`trackScenery.js:752`) sta
scattando, e va capito prima di continuare.

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/trackScenery.js frontend/shared/trackScenery.test.js
git commit -m "F1 scenografia: le tribune seguono il muro, e prendono il lato giusto"
```

---

### Task 3: Le reti guardano il muro, senza spostarsi

**File:**
- Modifica: `frontend/shared/sceneryTrackside.js:62-72` (`place`) e la
  chiamata per `catchFence` (riga ~176)
- Test: `frontend/shared/sceneryTrackside.test.js`

**Interfacce:**
- Consuma: `TrackGeometry.ribbonFacingAt` (Task 1).
- Produce: `place(trackPts, groundPts, idx, offset, side, barrierDist,
  embankStart, embankOuter, profiloPerRotazione)` — il nono parametro è
  opzionale; assente, il comportamento è quello di prima.

⚠️ **La posizione della rete non cambia.** `offset` resta il valore costante
calcolato oggi (il massimo del muro su tre campioni): cambia solo `rotY`. La
ragione sta in `sceneryTrackside.js:155-165` ed è misurata — prendendo il muro
sul campione di ciascun modulo, le reti si separavano dalla tribuna.

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungere in fondo a `frontend/shared/sceneryTrackside.test.js`:

```javascript
test('catchFence: guarda il muro, ma resta dove sta', () => {
    // Rettilineo con il muro che si allontana: il nastro è inclinato di 45°
    // rispetto alla pista, quindi la rete deve ruotare di 45° — ma la sua
    // POSIZIONE non deve muoversi di un millimetro, perché la distanza dei
    // moduli è quella che li tiene attaccati alla tribuna.
    const trackPts = [];
    for (let i = 0; i < 200; i++) trackPts.push({ x: i * 5, z: 0, y: 0 });

    const dritto = SceneryTrackside.place(trackPts, trackPts, 50, 30, 1, 15, 15, 60);
    const inclinato = SceneryTrackside.place(trackPts, trackPts, 50, 30, 1, 15, 15, 60,
        (i) => 20 + i * 5);

    assert.ok(Math.abs(dritto.x - inclinato.x) < 1e-9 && Math.abs(dritto.z - inclinato.z) < 1e-9,
        `la rete si è spostata: (${dritto.x}, ${dritto.z}) -> (${inclinato.x}, ${inclinato.z})`);
    let delta = inclinato.rotY - dritto.rotY;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    assert.ok(Math.abs(Math.abs(delta) - Math.PI / 4) < 1e-6,
        `attesi 45° di rotazione, avuti ${(delta * 180 / Math.PI).toFixed(2)}°`);
});
```

⚠️ `place` **non è esportata**: oggi `sceneryTrackside.js:258` restituisce
`{ buildTrackside, findCorners, CORNER_RADIUS_MAX }`. Va aggiunta in questo
stesso step, o il test non può nemmeno chiamarla:

```javascript
    return { buildTrackside, place, findCorners, CORNER_RADIUS_MAX };
```

- [ ] **Step 2: Lanciarlo e verificare che fallisca**

Comando: `node --test frontend/shared/sceneryTrackside.test.js`
Atteso: FAIL — la rotazione resta 0 perché il nono parametro viene ignorato.

- [ ] **Step 3: Correggere `place`**

```javascript
    // `profiloPerRotazione`, se dato, è la distanza del MURO campione per
    // campione: serve solo a orientare l'oggetto lungo il nastro del muro.
    // La POSIZIONE continua a venire da `offset`, che per le reti è un valore
    // costante calcolato apposta (vedi il commento più sotto, sul massimo fra
    // tre campioni): se la rete seguisse il muro anche in distanza, tornerebbe
    // a staccarsi dalla tribuna che protegge.
    function place(trackPts, groundPts, idx, offset, side, barrierDist, embankStart, embankOuter,
                   profiloPerRotazione) {
        const p = trackPts[idx];
        const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
        const x = p.x + nx * offset * side;
        const z = p.z + nz * offset * side;
        return {
            x, z,
            rotY: profiloPerRotazione
                ? TrackGeometry.ribbonFacingAt(trackPts, idx, side, profiloPerRotazione)
                : Math.atan2(p.x - x, p.z - z),
            y: TrackGeometry.terrainHeightAt(groundPts, x, z, embankStart, embankOuter),
        };
    }
```

- [ ] **Step 4: Passarlo dalla catchFence**

Alla riga ~176, la chiamata diventa:

```javascript
                const pos = place(trackPts, groundPts, idx, muro + FENCE_MARGIN,
                                  side, barrierDist, embankStart, embankOuter,
                                  barrierProfile
                                      ? (k, s) => TrackGravel.barrierAt(barrierProfile, k, s)
                                      : null);
```

- [ ] **Step 5: Lanciare i test**

```bash
node --test frontend/shared/sceneryTrackside.test.js
node --test frontend/shared/trackScenery.test.js
```

Atteso: entrambi verdi, compreso il test per tracciato del Task 2 che ora
copre anche le reti. Restano verdi le invarianti già presenti: reti staccate
dalla propria tribuna non più di 1 su 99, e nessuna rete oltre la linea del
muro.

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/sceneryTrackside.js frontend/shared/sceneryTrackside.test.js
git commit -m "F1 scenografia: le reti seguono il muro senza staccarsi dalla tribuna"
```

---

### Task 4: La passerella cerca un punto stretto e si misura sul muro vero

**File:**
- Modifica: `frontend/shared/sceneryLandmarks.js` — `spanScale` (riga ~47),
  `placeAcross` (riga ~68), firma di `buildLandmarks` (riga ~83), ciclo della
  passerella (righe ~159-171)
- Modifica: `frontend/shared/trackScenery.js:1138-1141` — passare
  `barrierProfile`
- Test: `frontend/shared/sceneryLandmarks.test.js`

**Interfacce:**
- Consuma: `TrackGravel.barrierAt(profile, i, side)`.
- Produce: `buildLandmarks(..., accepted, barrierProfile)` — il parametro
  nuovo è **in coda e opzionale**, perché i test esistenti chiamano la
  funzione con la firma vecchia.

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungere in fondo a `frontend/shared/sceneryLandmarks.test.js`:

```javascript
test('footbridge: la luce copre il muro di dove sta, su entrambi i lati', () => {
    // Su `prova` la passerella cadeva al campione 412, dove il muro sta a
    // 34.5 a sinistra: con semi-luce 21.5 era corta di 13 unità e i piedi
    // atterravano dentro la ghiaia. Era dimensionata su `barrierDist`, la
    // distanza storica del muro (15.0), che dopo le vie di fuga non vale più.
    //
    // ⚠️ `sceneryLandmarks.test.js` importa oggi solo TrackGeometry e
    // SceneryLandmarks: vanno aggiunti in cima al file, accanto agli altri
    // require, anche `trackGravel.js` (come TrackGravel) e
    // `sceneryAssetSizes.js` (come SceneryAssetSizes).
    const fs = require('fs');
    const path = require('path');
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tracks', 'prova.json'), 'utf8'));
    const trackPts = TrackGeometry.sampleLoop(raw.controlPoints, 1000);
    const barrierProfile = TrackGravel.barrierProfile(trackPts, { roadHalf: raw.roadHalfWidth });
    const BARRIER_D = raw.roadHalfWidth + 2.8 + 1.2;

    const layout = SceneryLandmarks.buildLandmarks(trackPts, null, BARRIER_D, 1,
        BARRIER_D, 60, [], () => false, null, 0, [], barrierProfile);
    const ponte = layout.find(v => v.asset === 'footbridge');
    assert.ok(ponte, 'nessuna passerella nel layout');

    const semiLuce = SceneryAssetSizes.sizeOf('footbridge').w * ponte.scale / 2;
    const v = TrackGeometry.nearestPoint(trackPts, ponte.x, ponte.z);
    for (const side of [-1, 1]) {
        const muro = TrackGravel.barrierAt(barrierProfile, v.index, side);
        assert.ok(semiLuce >= muro,
            `la passerella al campione ${v.index} ha semi-luce ${semiLuce.toFixed(1)} `
            + `ma il muro lato ${side > 0 ? 'dx' : 'sx'} sta a ${muro.toFixed(1)}: i piedi cadono nella ghiaia`);
    }
});
```

- [ ] **Step 2: Lanciarlo e verificare che fallisca**

Comando: `node --test frontend/shared/sceneryLandmarks.test.js`
Atteso: FAIL, `semi-luce 21.5 ma il muro lato sx sta a 34.5`.

- [ ] **Step 3: `spanScale` accetta la distanza vera da coprire**

```javascript
    // `daCoprire` è la distanza che la campata deve scavalcare: il muro vero
    // del punto in cui l'asset viene posato, non la barriera storica. Fino al
    // 2026-08-13 arrivava qui `barrierDist`, cioè 15.0 fisse: dopo le vie di
    // fuga il muro arriva a 34.5 e la passerella di `prova` restava corta di
    // 13 unità, con i piedi dentro la ghiaia.
    function spanScale(daCoprire, nativeHalfSpan) {
        return Math.max(1, (daCoprire + SPAN_CLEARANCE) / nativeHalfSpan);
    }
```

- [ ] **Step 4: `placeAcross` misura il muro sui due lati**

```javascript
    function placeAcross(trackPts, idx, groundPts, barrierDist, embankStart, embankOuter,
                         nativeHalfSpan, barrierProfile) {
        const p = trackPts[idx];
        const t = TrackGeometry.tangentAt(trackPts, idx, true);
        // La campata scavalca la pista: deve coprire il muro PIÙ LONTANO dei
        // due lati, non quello del lato su cui si comincia a misurare.
        let daCoprire = barrierDist;
        if (barrierProfile) {
            for (const side of [-1, 1]) {
                daCoprire = Math.max(daCoprire, TrackGravel.barrierAt(barrierProfile, idx, side));
            }
        }
        return {
            x: p.x, z: p.z,
            y: TrackGeometry.terrainHeightAt(groundPts, p.x, p.z, embankStart, embankOuter),
            // +π: il fronte dell'asset (+Z locale) allineato alla tangente
            // guarderebbe nella direzione di MARCIA, cioè darebbe le spalle
            // alle auto in arrivo — alla partenza si vedeva il retro del
            // ponte semafori invece delle luci.
            rotY: Math.atan2(t.tx, t.tz) + Math.PI,
            scale: spanScale(daCoprire, nativeHalfSpan),
        };
    }
```

Aggiornare anche la chiamata dello `startGantry` (riga ~146) aggiungendo
`barrierProfile` come ultimo argomento: sta al traguardo, dove il muro resta
storico, quindi il valore non cambia — ma se un domani quel tratto si
allargasse, il gantry si allungherebbe invece di restare corto.

- [ ] **Step 5: La passerella preferisce un punto stretto**

Sostituire il ciclo delle righe ~159-171 con:

```javascript
        // Passerella: circa a mezzo giro dal gantry, per non duplicare la
        // stessa silhouette nello stesso tratto. Si cerca però il punto utile
        // più vicino a metà giro, scartando i tratti sopraelevati e quelli
        // con un cavalcavia sopra: a indice fisso, su "prova" cadeva proprio
        // sotto un ponte e lo attraversava (top a 13.3 contro un intradosso
        // a 11.2).
        //
        // Fra i punti utili si preferiscono quelli dove il muro NON è
        // arretrato per una via di fuga: lì la campata resta di dimensioni
        // normali. Si fa una prima passata pretendendo un muro stretto e, se
        // non esiste un punto così, una seconda che accetta qualunque punto —
        // e in quel caso `placeAcross` allunga la campata quanto serve, invece
        // di lasciarla corta con i piedi nella ghiaia.
        const half = Math.floor(n / 2);
        const muroLargo = (idx) => {
            if (!barrierProfile) return barrierDist;
            return Math.max(TrackGravel.barrierAt(barrierProfile, idx, -1),
                            TrackGravel.barrierAt(barrierProfile, idx, 1));
        };
        const SOGLIA_MURO_STRETTO = barrierDist + 6;
        let posata = false;
        for (const soloStretti of [true, false]) {
            if (posata) break;
            for (let d = 0; d < Math.floor(n / 4) && !posata; d += 4) {
                for (const idx of [(half + d) % n, ((half - d) % n + n) % n]) {
                    if (trackPts[idx].bridge) continue;
                    if (soloStretti && muroLargo(idx) > SOGLIA_MURO_STRETTO) continue;
                    const cand = placeAcross(trackPts, idx, groundPts, barrierDist, embankStart,
                                             embankOuter, FOOTBRIDGE_NATIVE_HALF_SPAN, barrierProfile);
                    const topH = SPANNING_HEIGHTS.footbridge * cand.scale;
                    if (!fits('footbridge', cand.x, cand.z, cand.y, topH)) continue;
                    if (!freeOf('footbridge', cand, cand.scale)) continue;
                    layout.push({ asset: 'footbridge', category: 'landmark', ...cand });
                    posata = true;
                    break;
                }
            }
        }
```

- [ ] **Step 6: Far arrivare il profilo fin qui**

In `frontend/shared/sceneryLandmarks.js`, aggiungere il parametro **in coda**
alla firma di `buildLandmarks` (riga ~83):

```javascript
    function buildLandmarks(trackPts, pitPts, barrierDist, mainSide, embankStart, embankOuter,
                            playerBoxFootprints, insidePlayerBoxFootprint,
                            fitsUnderBridge, pitRoadHalf, accepted, barrierProfile) {
```

E in `frontend/shared/trackScenery.js:1138-1141`:

```javascript
        const landmarks = SceneryLandmarks.buildLandmarks(
            trackPts, pitPts, barrierDist, side, embankStart, embankOuter,
            playerBoxFootprints, insidePlayerBoxFootprint, fitsUnderBridge, pitRoadHalf,
            accepted, barrierProfile);
```

Verificare che `sceneryLandmarks.js` importi già `TrackGravel`; se non lo fa,
aggiungerlo al preambolo UMD con lo stesso stile degli altri moduli.

- [ ] **Step 7: Lanciare i test**

```bash
node --test frontend/shared/sceneryLandmarks.test.js
node --test frontend/shared/trackScenery.test.js
```

Atteso: verdi. In particolare i test preesistenti dei landmark chiamano
`buildLandmarks` senza `barrierProfile` e devono continuare a passare: se
falliscono, il parametro non è davvero opzionale.

- [ ] **Step 8: Misurare dove è finita la passerella**

```bash
node -e "
const fs=require('fs');
const TGeo=require('./frontend/shared/trackGeometry.js');
const TGrav=require('./frontend/shared/trackGravel.js');
const TS=require('./frontend/shared/trackScenery.js');
const SZ=require('./frontend/shared/sceneryAssetSizes.js');
const {loadTrack}=require('./backend/sockets/games/trackLoader.js');
for (const id of ['prova','new-monza','monte-rosso','baku']) {
  const raw=JSON.parse(fs.readFileSync('frontend/tracks/'+id+'.json','utf8'));
  const t=loadTrack(id);
  const L=TS.generateLayout(raw,t.points,t.pitLanePts,raw.roadHalfWidth+4,45,null,t.barrierProfile);
  for (const e of L.filter(e=>e.asset==='footbridge')) {
    const v=TGeo.nearestPoint(t.points,e.x,e.z);
    const semi=SZ.sizeOf('footbridge').w*e.scale/2;
    const muro=Math.max(TGrav.barrierAt(t.barrierProfile,v.index,-1),TGrav.barrierAt(t.barrierProfile,v.index,1));
    console.log(id,'camp',v.index,'semi-luce',semi.toFixed(1),'muro',muro.toFixed(1),semi>=muro?'ok':'CORTA');
  }
}"
```

Atteso: `ok` su tutti e quattro. Annotare il campione scelto e la semi-luce
nel messaggio di commit: se la passerella si è spostata di molto, va guardata
nel disegno del Task 5.

- [ ] **Step 9: Commit**

```bash
git add frontend/shared/sceneryLandmarks.js frontend/shared/sceneryLandmarks.test.js frontend/shared/trackScenery.js
git commit -m "F1 scenografia: la passerella sta dove il muro e' stretto, e lo copre comunque"
```

---

### Task 5: Il gate, la suite e la consegna

**File:**
- Modifica: `frontend/f1.html` (bump del cache-busting)

Questo task non cambia comportamento: mostra il risultato e lo consegna.

- [ ] **Step 1: Suite intera**

```bash
node --test --test-reporter=tap $(git ls-files "*.test.js" | tr '\n' ' ') 2>&1 | grep -E "^not ok|^# (tests|pass|fail)"
```

Atteso: i **4 rossi preesistenti** elencati nei vincoli globali, più
eventualmente il quinto intermittente. Qualsiasi altro rosso va risolto prima
di consegnare. In caso di dubbio, rilanciare il file isolato: gli intermittenti
passano sempre da soli.

- [ ] **Step 2: Rimisurare tutte le invarianti della spec**

```bash
node --test frontend/shared/trackScenery.test.js
node --test frontend/shared/sceneryTrackside.test.js
node --test backend/tools/f1-segnalazioni.test.js
node --test backend/tools/circuitAssets.test.js
node backend/tools/f1-segnalazioni.js | head -3
```

Atteso: verdi, e il conteggio degli elementi per categoria non deve essere
calato rispetto a `701c53c` (4080 su `prova`).

- [ ] **Step 3: Disegnare il prima/dopo dei punti segnalati**

Generare, per i campioni **413, 615 e quello dove finisce la passerella**, un
disegno dall'alto con la barriera, la tribuna e la rete, prima e dopo. Il
tool `backend/tools/f1-barriera-dallalto.js` disegna già il muro: qui serve
aggiungerci gli oggetti, oppure produrre il disegno con uno script di
scratchpad come è stato fatto il 2026-08-13 per i grovigli.

**Guardarlo prima di consegnarlo.** Se il disegno non mostra la differenza, lo
strumento non serve.

- [ ] **Step 4: Mostrarlo all'utente**

Pubblicare una pagina con i disegni prima/dopo e chiedere se la forma va bene
**prima** del playtest. È il gate che ha funzionato il 2026-08-13 sui
grovigli, ed è la contromisura ai fix approvati sulle misure e bocciati
dall'occhio.

- [ ] **Step 5: Bump del cache-busting**

In `frontend/f1.html`, incrementare il `?v=` di `trackGeometry.js`,
`trackScenery.js`, `sceneryTrackside.js`, `sceneryLandmarks.js` e `f1.js`.
Senza questo il browser serve il JS vecchio e in pista non si vede nessun
cambiamento — errore già fatto e già costato un playtest.

- [ ] **Step 6: Commit**

```bash
git add frontend/f1.html
git commit -m "F1 scenografia: bump cache dopo l'allineamento al muro"
```

- [ ] **Step 7: Consegnare al playtest**

Riavviare il server da `.claude/worktrees/f1-ghiaia/backend` (`node server.js`,
**senza pipe**: una pipe a `head` lo uccide dopo poche righe di log) e chiedere
all'utente di girare su `prova` con un **hard refresh**, guardando:

- la tribuna coperta e la rete davanti al campione 620, quelle segnalate;
- la passerella (campione 408 e dintorni): i piedi devono stare sul prato,
  non nella ghiaia;
- che nessuna tribuna sia rimasta indietro o troppo avanti rispetto alle
  vicine (è il difetto del lato sbagliato, che si vede su new-monza più che
  su prova).

---

## Note per chi esegue

- **Il difetto delle tribune storte è preesistente**, non è nato con le vie di
  fuga: 8 elementi a `1491be7`, 7 a `fef64f0`, 11 a `701c53c`. La ghiaia più
  larga ha creato più rampe, e ogni rampa storce ciò che le sta accanto.
- **Non allargare il fix a `tyreStack` e `brakingBoard`.** Deviano fino a 79°
  ma è giusto così.
- **Se una schiera si accorcia dopo il fix**, la causa è la rete di sicurezza
  contro i moduli accavallati (`trackScenery.js:752`), non un errore di
  orientamento: ruotando i moduli le loro impronte possono sovrapporsi. È il
  punto da guardare per primo.
- **La misura non basta da sola.** Tre correzioni al muro sono state approvate
  su misure verdi e bocciate dall'occhio dell'utente. Il Task 5 finisce con un
  disegno mostrato prima del playtest.
