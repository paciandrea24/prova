# F1 — Barriere: vincolo geometrico contro i grovigli — Piano di implementazione

> **Per chi esegue con agenti:** SUB-SKILL RICHIESTA — usare
> `superpowers:subagent-driven-development` (consigliata) oppure
> `superpowers:executing-plans` per eseguire il piano task per task. Gli step
> usano checkbox (`- [ ]`) per il tracciamento.

**Goal:** togliere i grovigli della barriera facendo scendere il muro dove la
geometria non regge, e ridare alla ghiaia la larghezza che ogni curva chiede.

**Architettura:** `TrackGravel.barrierProfile` resta la sorgente unica della
distanza del muro. Si aggiunge una passata che impone un tetto per campione,
ricavato in forma chiusa dalla stessa formula con cui la mesh piazza i vertici,
e si toglie il tetto fisso `RUNOFF_MAX` introdotto il 2026-08-12. Prima di
tutto questo si costruisce lo strumento che disegna il muro dall'alto, perché
il difetto si giudica guardandolo, non misurandolo.

**Stack:** Node.js puro, `node:test`, moduli UMD condivisi fra client e server
in `frontend/shared/`. Nessuna dipendenza nuova.

**Spec:** `docs/superpowers/specs/2026-08-12-f1-barriere-vincolo-geometrico-design.md`

## Vincoli globali

- **Worktree:** `.claude/worktrees/f1-ghiaia`, branch `f1-ghiaia`, si parte da
  `4239e35`. Tutti i comandi si eseguono dalla radice del worktree.
- **Comando test:** `node --test <file>` (non esiste uno script npm: in
  `backend/package.json` `test` è un segnaposto che esce con errore).
- **Italiano** nei commenti del codice e nei messaggi di commit.
- **Un commit per task.** Il push resta manuale dell'utente: non pushare mai.
- **4 test rossi preesistenti** su 761 non sono di questo lavoro e restano
  rossi: Simcade isolamento componenti, i due `loadTrack("monte-rosso")`,
  `simulateLap` col preset di tuning. Più un quinto intermittente
  (`simulateLap: test-scratch-track`).
- **Il tetto va applicato al campione di ARRIVO** del segmento, mai a quello di
  partenza: la normale di partenza è perpendicolare alla propria tangente,
  quindi non entra nell'avanzamento. Sbagliarlo *sembra* funzionare su `prova`
  e lascia 31 ripiegamenti su `baku`.
- **Soglie geometriche in unità di pista, mai per campione:** il passo vale
  5.17 unità su `prova` e 1.18 su `monte-rosso`.
- `MIN_ADVANCE = 0.35` (frazione dell'avanzamento della pista che il nastro
  della barriera deve conservare).
- **Non toccare:** l'attrito della ghiaia, il tratto traguardo/box, i ponti,
  `applyOffTrackDrag`.

---

## Struttura dei file

| File | Responsabilità |
|---|---|
| `backend/tools/barrieraForma.js` | **nuovo** — modulo puro: misura la forma del nastro (ripiegamenti, auto-intersezioni, passo minimo) da una funzione di distanza. Nessun I/O. |
| `backend/tools/barrieraForma.test.js` | **nuovo** — test del modulo di misura su geometrie costruite a mano, dove la risposta giusta è nota. |
| `backend/tools/f1-barriera-dallalto.js` | **nuovo** — CLI: carica un tracciato, disegna il muro dall'alto in SVG, salva/confronta una baseline. |
| `frontend/shared/trackGravel.js` | modifica — nuova passata col tetto geometrico; rimozione di `RUNOFF_MAX`. |
| `frontend/shared/trackGravel.test.js` | modifica — test per tracciato: il nastro non si ripiega. |
| `frontend/f1.html` | modifica — bump del cache-busting. |
| `.gitignore` | modifica — output dei disegni. |

Il modulo di misura sta in `backend/tools/` e non in `frontend/shared/`: è
strumentazione diagnostica, non codice di gioco. `trackGravel.test.js` tiene
una propria copia locale della misura dei ripiegamenti — un test unitario del
modulo frontend non deve dipendere dal backend, ed è il pattern già usato dagli
altri helper in quel file.

---

### Task 1: Modulo che misura la forma del nastro

**File:**
- Crea: `backend/tools/barrieraForma.js`
- Test: `backend/tools/barrieraForma.test.js`

**Interfacce:**
- Consuma: `frontend/shared/trackGeometry.js` (`tangentAt`, `normalAt`).
- Produce:
  - `puntiBarriera(pts, distDi, side) -> [{x, z}]`
  - `ripiegamenti(pts, distDi) -> [{side, i}]`
  - `autoIntersezioni(pts, distDi, finestra = 120) -> [{side, i, j}]`
  - `passoMinimo(pts, distDi) -> {lunghezza, side, i}`

  dove `distDi(i, side) -> number` è la distanza del muro dall'asse al
  campione `i` sul lato `side` (`-1` sinistro, `+1` destro).

- [ ] **Step 1: Scrivere i test che falliscono**

```javascript
// backend/tools/barrieraForma.test.js
const test = require('node:test');
const assert = require('node:assert');
const Forma = require('./barrieraForma.js');

// Cerchio di raggio R campionato fitto: la geometria in cui la risposta
// giusta si sa a mente. Un muro sul lato interno a distanza d si ripiega
// esattamente quando d supera R.
function cerchio(R, n = 360) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, y: 0 });
    }
    return pts;
}

test('nessun ripiegamento quando il muro sta dentro il raggio', () => {
    const pts = cerchio(100);
    const r = Forma.ripiegamenti(pts, () => 40);
    assert.equal(r.length, 0, `attesi 0 ripiegamenti, trovati ${r.length}`);
});

test('tutti i campioni si ripiegano quando il muro supera il raggio', () => {
    const pts = cerchio(100);
    // il lato interno del cerchio è uno solo: metà dei campioni-lato
    const r = Forma.ripiegamenti(pts, () => 130);
    assert.equal(r.length, pts.length,
        `atteso un ripiegamento per campione sul lato interno, trovati ${r.length}`);
});

test('il passo minimo del nastro si accorcia sul lato interno', () => {
    const pts = cerchio(100);
    const largo = Forma.passoMinimo(pts, () => 0).lunghezza;
    const stretto = Forma.passoMinimo(pts, () => 50).lunghezza;
    assert.ok(stretto < largo,
        `il nastro interno dovrebbe avere passo più corto: ${stretto} contro ${largo}`);
});

test('due segmenti che si incrociano vengono trovati', () => {
    // Pista a otto stretto: il muro largo fa incrociare i due rami.
    const pts = [];
    for (let i = 0; i < 200; i++) {
        const t = (i / 200) * Math.PI * 2;
        pts.push({ x: Math.cos(t) * 120, z: Math.sin(t * 2) * 60, y: 0 });
    }
    const nessuno = Forma.autoIntersezioni(pts, () => 1);
    const molti = Forma.autoIntersezioni(pts, () => 55);
    assert.equal(nessuno.length, 0, 'con muro a ridosso non ci sono incroci');
    assert.ok(molti.length > 0, 'con muro largo gli incroci devono comparire');
});
```

- [ ] **Step 2: Lanciare i test e verificare che falliscano**

Comando: `node --test backend/tools/barrieraForma.test.js`
Atteso: FAIL, `Cannot find module './barrieraForma.js'`.

- [ ] **Step 3: Scrivere il modulo**

```javascript
// backend/tools/barrieraForma.js
//
// Misura la FORMA del nastro della barriera, non il suo profilo di distanza.
// La distinzione è il motivo per cui questo file esiste: un profilo liscio può
// benissimo produrre un nastro accartocciato, ed è esattamente quello che
// succedeva nei quattro punti segnalati in gioco su `prova` il 2026-08-12.
//
// Tutte le misure partono dalla stessa formula con cui la mesh piazza i
// vertici (trackMeshBuilder.js::buildBarriers): un vertice per campione,
// spostato di `dist` lungo la normale.
const TrackGeometry = require('../../frontend/shared/trackGeometry.js');

function puntiBarriera(pts, distDi, side) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
        const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
        const d = distDi(i, side);
        out.push({ x: pts[i].x + nx * d * side, z: pts[i].z + nz * d * side });
    }
    return out;
}

// Dove il nastro INDIETREGGIA invece di avanzare. Sul lato interno di una
// curva, oltre il raggio di curvatura l'avanzamento diventa negativo: prima
// una cuspide, poi un cappio. La normale di `prev` è perpendicolare alla
// propria tangente per costruzione, quindi nell'avanzamento entra solo la
// distanza del campione di ARRIVO.
function ripiegamenti(pts, distDi) {
    const n = pts.length;
    const out = [];
    for (const side of [-1, 1]) {
        for (let i = 0; i < n; i++) {
            const prev = (i - 1 + n) % n;
            const t = TrackGeometry.tangentAt(pts, prev, true);
            const nQui = TrackGeometry.normalAt(pts, i, true);
            const avanti = (pts[i].x - pts[prev].x) * t.tx + (pts[i].z - pts[prev].z) * t.tz
                + side * distDi(i, side) * (nQui.nx * t.tx + nQui.nz * t.tz);
            if (avanti <= 0) out.push({ side, i });
        }
    }
    return out;
}

function incrociano(a, b, c, d) {
    const rx = b.x - a.x, rz = b.z - a.z, sx = d.x - c.x, sz = d.z - c.z;
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-12) return false;
    const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
    const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
    return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

// Segmenti del nastro che si tagliano fra loro. La finestra è in CAMPIONI ed
// è volutamente locale: due rami lontani del tracciato che si sfiorano non
// sono un difetto del muro, sono la pista che si ripiega su se stessa.
function autoIntersezioni(pts, distDi, finestra = 120) {
    const n = pts.length;
    const out = [];
    for (const side of [-1, 1]) {
        const B = puntiBarriera(pts, distDi, side);
        for (let i = 0; i < n; i++) {
            for (let k = 2; k < finestra; k++) {
                const j = (i + k) % n;
                if (incrociano(B[i], B[(i + 1) % n], B[j], B[(j + 1) % n])) out.push({ side, i, j });
            }
        }
    }
    return out;
}

// Il segmento più corto del nastro. Vicino a zero i quad sono degeneri e la
// mesh mostra facce che si compenetrano anche senza un ripiegamento vero.
function passoMinimo(pts, distDi) {
    const n = pts.length;
    let best = { lunghezza: Infinity, side: 0, i: -1 };
    for (const side of [-1, 1]) {
        const B = puntiBarriera(pts, distDi, side);
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const L = Math.hypot(B[j].x - B[i].x, B[j].z - B[i].z);
            if (L < best.lunghezza) best = { lunghezza: L, side, i };
        }
    }
    return best;
}

module.exports = { puntiBarriera, ripiegamenti, autoIntersezioni, passoMinimo };
```

- [ ] **Step 4: Lanciare i test e verificare che passino**

Comando: `node --test backend/tools/barrieraForma.test.js`
Atteso: PASS, 4 test.

- [ ] **Step 5: Commit**

```bash
git add backend/tools/barrieraForma.js backend/tools/barrieraForma.test.js
git commit -m "F1 barriere: modulo che misura la forma del nastro"
```

---

### Task 2: Il muro disegnato dall'alto

**File:**
- Crea: `backend/tools/f1-barriera-dallalto.js`
- Modifica: `.gitignore`

**Interfacce:**
- Consuma: `barrieraForma.js` (Task 1), `backend/sockets/games/trackLoader.js`
  (`loadTrack(id) -> {points, barrierProfile, roadHalf, ...}`),
  `frontend/shared/trackGravel.js` (`barrierAt`).
- Produce: file SVG in `backend/tools/out/`, e un JSON di baseline con il
  profilo salvato, per il confronto prima/dopo.

Uso previsto:

```
node backend/tools/f1-barriera-dallalto.js prova                 # disegna
node backend/tools/f1-barriera-dallalto.js prova --salva-baseline
node backend/tools/f1-barriera-dallalto.js prova --baseline      # prima/dopo
```

- [ ] **Step 1: Aggiungere l'output a .gitignore**

Aggiungere in fondo a `.gitignore`:

```
# disegni diagnostici del muro (rigenerabili con f1-barriera-dallalto.js)
backend/tools/out/
```

- [ ] **Step 2: Scrivere il tool**

```javascript
// backend/tools/f1-barriera-dallalto.js
//
// Disegna il muro visto dall'alto, dai dati veri del modulo. Esiste perché il
// difetto dei "grovigli di barriere" si giudica guardando una forma: tre
// tentativi di correzione sono stati approvati sulle misure e bocciati al
// playtest, e la svolta è arrivata disegnando.
//
// Uso:
//   node backend/tools/f1-barriera-dallalto.js <tracciato> [--salva-baseline] [--baseline]
const fs = require('fs');
const path = require('path');
const Forma = require('./barrieraForma.js');
const TrackGravel = require('../../frontend/shared/trackGravel.js');
const TrackGeometry = require('../../frontend/shared/trackGeometry.js');
const { loadTrack } = require('../sockets/games/trackLoader.js');

const OUT = path.join(__dirname, 'out');
const id = process.argv[2] || 'prova';
const salvaBaseline = process.argv.includes('--salva-baseline');
const conBaseline = process.argv.includes('--baseline');

const track = loadTrack(id);
const pts = track.points;
const distDi = (i, side) => TrackGravel.barrierAt(track.barrierProfile, i, side);

const rip = Forma.ripiegamenti(pts, distDi);
const inc = Forma.autoIntersezioni(pts, distDi);
const passo = Forma.passoMinimo(pts, distDi);
const stepLen = TrackGeometry.lapLength(pts) / pts.length;

// Zone da evidenziare: i campioni coinvolti, raggruppati.
function zone(indici, tolleranza = 15) {
    const s = [...new Set(indici)].sort((a, b) => a - b);
    const out = [];
    for (const i of s) {
        const last = out[out.length - 1];
        if (last && i - last[1] <= tolleranza) last[1] = i;
        else out.push([i, i]);
    }
    return out;
}
const critiche = zone([...rip.map(r => r.i), ...inc.map(c => c.i)]);

fs.mkdirSync(OUT, { recursive: true });

const baselineFile = path.join(OUT, `baseline-${id}.json`);
if (salvaBaseline) {
    const dump = { left: [], right: [] };
    for (let i = 0; i < pts.length; i++) { dump.left.push(distDi(i, -1)); dump.right.push(distDi(i, 1)); }
    fs.writeFileSync(baselineFile, JSON.stringify(dump));
    console.log(`baseline salvata in ${baselineFile}`);
}

let baseline = null;
if (conBaseline && fs.existsSync(baselineFile)) {
    const dump = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    baseline = (i, side) => (side > 0 ? dump.right : dump.left)[i];
}

// ---- disegno ----
function polilinea(distFn, side) {
    return Forma.puntiBarriera(pts, distFn, side).map(p => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(' ');
}

function svg() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const m = 80;
    const vb = `${(minX - m).toFixed(0)} ${(minZ - m).toFixed(0)} ${(maxX - minX + 2 * m).toFixed(0)} ${(maxZ - minZ + 2 * m).toFixed(0)}`;
    const asse = pts.map(p => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(' ');

    const evidenziate = critiche.map(([a, b]) => {
        const seg = [];
        for (let i = a - 3; i <= b + 3; i++) {
            const p = pts[((i % pts.length) + pts.length) % pts.length];
            seg.push(`${p.x.toFixed(1)},${p.z.toFixed(1)}`);
        }
        return `<polyline points="${seg.join(' ')}" fill="none" stroke="#ffb300" stroke-width="14" opacity="0.55"/>`;
    }).join('\n');

    const strato = (fn, colore, larghezza, opacita) => [-1, 1]
        .map(s => `<polyline points="${polilinea(fn, s)}" fill="none" stroke="${colore}" stroke-width="${larghezza}" opacity="${opacita}"/>`)
        .join('\n');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="1100">
<rect x="${minX - m}" y="${minZ - m}" width="${maxX - minX + 2 * m}" height="${maxZ - minZ + 2 * m}" fill="#f4f4ef"/>
${evidenziate}
<polyline points="${asse}" fill="none" stroke="#9aa0a6" stroke-width="${track.roadHalf * 2}" opacity="0.35"/>
${baseline ? strato(baseline, '#7986cb', 3, 0.9) : ''}
${strato(distDi, '#c62828', 3, 1)}
</svg>`;
}

const file = path.join(OUT, `barriera-${id}.svg`);
fs.writeFileSync(file, svg());

console.log(`=== ${id} — ${pts.length} campioni, passo ${stepLen.toFixed(2)} unità ===`);
console.log(`  ripiegamenti del nastro: ${rip.length}`);
console.log(`  auto-intersezioni:       ${inc.length}`);
console.log(`  passo minimo del nastro: ${passo.lunghezza.toFixed(2)} (pista ${stepLen.toFixed(2)})`);
console.log(`  zone critiche: ${critiche.map(c => c[0] === c[1] ? c[0] : `${c[0]}-${c[1]}`).join(', ') || 'nessuna'}`);
console.log(`  disegno: ${file}${baseline ? '  (in blu il profilo di baseline)' : ''}`);
```

- [ ] **Step 3: Lanciare il tool sui quattro tracciati**

```bash
for t in prova new-monza monte-rosso baku; do node backend/tools/f1-barriera-dallalto.js $t; done
```

Atteso, con il codice di oggi (`4239e35`): `prova` 10 ripiegamenti e 10
auto-intersezioni con zone critiche 130-137, 333-340, 644-649, 760-768;
`monte-rosso` 0 e 0; `new-monza` 23 e 10; `baku` 31 e 13. Se i numeri di
`prova` non coincidono, **fermarsi**: significa che il tool misura una cosa
diversa da quella diagnosticata, e va capito prima di andare avanti.

- [ ] **Step 4: Guardare il disegno di `prova`**

Aprire `backend/tools/out/barriera-prova.svg` e verificare a occhio che le
zone gialle cadano dove il tratto rosso si annoda. È il controllo che dà
senso a tutto il resto: se il disegno non mostra il difetto, lo strumento non
serve a niente.

- [ ] **Step 5: Salvare la baseline dei quattro tracciati**

```bash
for t in prova new-monza monte-rosso baku; do node backend/tools/f1-barriera-dallalto.js $t --salva-baseline; done
```

- [ ] **Step 6: Commit**

```bash
git add backend/tools/f1-barriera-dallalto.js .gitignore
git commit -m "F1 barriere: il muro disegnato dall'alto, con le zone annodate in evidenza"
```

---

### Task 3: Il test rosso — il nastro non si ripiega

**File:**
- Modifica: `frontend/shared/trackGravel.test.js` (in fondo, dopo la riga 373)

**Interfacce:**
- Consuma: `TrackGravel.barrierProfile`, `TrackGravel.barrierAt`,
  `TrackGravel.CURB_W`, `TrackGravel.BARRIER_GAP`,
  `TrackGeometry.sampleLoop`, `TrackGeometry.tangentAt`,
  `TrackGeometry.normalAt`.
- Produce: gli helper `pistaVera(id)` e `ripiegamentiDi(pts, distDi)` per i
  task successivi dello stesso file.

- [ ] **Step 1: Scrivere il test**

Aggiungere in fondo a `frontend/shared/trackGravel.test.js`:

```javascript
// ---- barrierProfile: il nastro della barriera non si ripiega ----
//
// La barriera è la pista spostata lungo la normale: sul lato interno di una
// curva, oltre il raggio di curvatura il punto di barriera INDIETREGGIA e il
// nastro si ripiega su se stesso, formando prima una cuspide e poi un cappio.
// In gioco l'utente lo ha visto come "groviglio di barriere" ai campioni 132,
// 337, 646 e 764 di `prova` (2026-08-12), e la misura ha ritrovato le zone
// annodate esattamente lì.
//
// Il test misura i VERTICI con la stessa formula del costruttore della mesh
// (trackMeshBuilder.js::buildBarriers), non il profilo: un profilo liscio può
// benissimo produrre un nastro ripiegato, ed è proprio quello che succedeva.
const fs = require('fs');
const path = require('path');

function pistaVera(id) {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tracks', `${id}.json`), 'utf8'));
    return { raw, pts: TrackGeometry.sampleLoop(raw.controlPoints, 1000) };
}

function ripiegamentiDi(pts, distDi) {
    const n = pts.length;
    const out = [];
    for (const side of [-1, 1]) {
        for (let i = 0; i < n; i++) {
            const prev = (i - 1 + n) % n;
            const t = TrackGeometry.tangentAt(pts, prev, true);
            const nQui = TrackGeometry.normalAt(pts, i, true);
            const avanti = (pts[i].x - pts[prev].x) * t.tx + (pts[i].z - pts[prev].z) * t.tz
                + side * distDi(i, side) * (nQui.nx * t.tx + nQui.nz * t.tz);
            if (avanti <= 0) out.push(`${side > 0 ? 'dx' : 'sx'}${i}`);
        }
    }
    return out;
}

for (const id of ['prova', 'monte-rosso', 'new-monza', 'baku']) {
    test(`barrierProfile: il nastro non si ripiega (${id})`, () => {
        const { raw, pts } = pistaVera(id);
        const bar = TrackGravel.barrierProfile(pts, { roadHalf: raw.roadHalfWidth });
        const storica = raw.roadHalfWidth + TrackGravel.CURB_W + TrackGravel.BARRIER_GAP;

        // Riferimento: il muro alla distanza storica, cioè la regola in vigore
        // prima delle vie di fuga. Su baku qualche curva ha raggio 9.9 con
        // pista di semi-larghezza 11 — il centro di curvatura cade dentro
        // l'asfalto e NESSUNA barriera interna è possibile, a nessuna
        // distanza. Quello che le vie di fuga non possono fare è peggiorare
        // il conto: il limite è del tracciato, non di questo modulo.
        const prima = ripiegamentiDi(pts, () => storica);
        const adesso = ripiegamentiDi(pts, (i, side) => TrackGravel.barrierAt(bar, i, side));

        assert.ok(adesso.length <= prima.length,
            `${id}: ${adesso.length} ripiegamenti contro i ${prima.length} del muro storico — ${adesso.slice(0, 8).join(' ')}`);
        if (prima.length === 0) {
            assert.equal(adesso.length, 0,
                `${id}: il muro storico non si ripiegava, questo sì — ${adesso.slice(0, 8).join(' ')}`);
        }
    });
}
```

- [ ] **Step 2: Lanciare i test e verificare che il rosso sia quello atteso**

Comando: `node --test frontend/shared/trackGravel.test.js`

Atteso: **`prova` FALLISCE** con 10 ripiegamenti contro gli 0 del muro
storico; `monte-rosso` passa; `new-monza` e `baku` vanno verificati e il
risultato annotato nel messaggio di commit — se falliscono, è perché il muro
di oggi peggiora rispetto allo storico, ed è proprio ciò che il Task 5 dovrà
sistemare.

Se `prova` **passa**, fermarsi: il test non riproduce il difetto e non serve
implementare nulla finché non lo riproduce.

- [ ] **Step 3: Commit del test rosso**

```bash
git add frontend/shared/trackGravel.test.js
git commit -m "F1 barriere: test rosso, il nastro si ripiega in quattro punti di prova"
```

---

### Task 4: Il tetto geometrico

**File:**
- Modifica: `frontend/shared/trackGravel.js` — nuova costante accanto alle
  altre (vicino a `RUNOFF_MIN`, riga ~279) e nuova passata fra la quarta
  (territorio, che finisce alla riga ~464) e la quinta (livellamento).

**Interfacce:**
- Consuma: `TrackGeometry.tangentAt(pts, i, closed) -> {tx, tz}`,
  `TrackGeometry.normalAt(pts, i, closed) -> {nx, nz}`.
- Produce: `TrackGravel.BARRIER_MIN_ADVANCE` esportata, per i test.

Il codice viene **recuperato da `ec58bdb`**, che conteneva già la formula
giusta ed è stato revertato in blocco insieme a un altro fix. Va preso solo il
blocco del tetto: la parte di quel commit che sposta l'apertura morfologica
non si applica, perché l'apertura è stata revertata e oggi non esiste.

- [ ] **Step 1: Aggiungere la costante**

In `frontend/shared/trackGravel.js`, subito dopo `const RUNOFF_MAX = 16;`:

```javascript
    // Quanto deve ancora avanzare il nastro della barriera fra due campioni,
    // in frazione dell'avanzamento della pista. Sotto zero il nastro si
    // ripiega (cuspide), a zero i quad sono degeneri: si pretende una
    // frazione vera. 0.35 è il valore più basso che azzera i ripiegamenti su
    // prova senza stringere il muro dove non serve.
    const BARRIER_MIN_ADVANCE = 0.35;
```

- [ ] **Step 2: Aggiungere la passata del tetto**

Inserire fra la quarta passata (territorio) e la quinta (livellamento), cioè
subito prima del commento `// Quinta passata: livellamento anti-gradino.`:

```javascript
        // Quarta passata e tre quarti: niente cuspidi sul lato interno.
        //
        // La barriera è la pista spostata di `d` lungo la normale. Sul lato
        // INTERNO di una curva quello spostamento accorcia il percorso, e
        // oltre il raggio di curvatura lo fa diventare negativo: il nastro
        // indietreggia invece di avanzare, si ripiega e forma prima una
        // cuspide e poi un cappio. È lo stesso motivo per cui non esiste una
        // circonferenza concentrica di raggio negativo — geometria, non
        // taratura: nessun livellamento del profilo può toglierla.
        //
        // Misurato il 2026-08-12: su prova 12 campioni oltre il limite, e le
        // zone annodate (130-137, 333-340, 644-649, 760-768) sono esattamente
        // i quattro punti che l'utente aveva marcato in gioco col tasto M.
        // monte-rosso, l'unico tracciato mai contestato, è l'unico con zero.
        //
        // Il tetto si ricava dalla STESSA formula con cui la mesh piazza i
        // vertici (trackMeshBuilder.js::buildBarriers): l'avanzamento del
        // punto di barriera è lineare in d, quindi la distanza massima che
        // lascia il nastro in avanti si risolve in forma chiusa, senza
        // passare dal raggio di curvatura e dal suo segno — una convenzione
        // in meno da sbagliare.
        //
        // ⚠️ Il tetto va messo sul campione di ARRIVO del segmento, non su
        // quello di partenza: la normale di partenza è per costruzione
        // perpendicolare alla tangente del suo stesso campione, quindi la sua
        // distanza non entra nell'avanzamento. Sbagliato al primo tentativo
        // il 2026-08-12: su prova sembrava funzionare lo stesso (campioni
        // vicini hanno distanze simili), ma su baku restavano 31 ripiegamenti.
        for (let i = 0; i < n; i++) {
            const prev = (i - 1 + n) % n;
            if (trackPts[i].bridge || trackPts[prev].bridge) continue;
            const t = TrackGeometry.tangentAt(trackPts, prev, true);
            const nQui = TrackGeometry.normalAt(trackPts, i, true);
            // Avanzamento del nastro fra prev e i, in funzione della distanza
            // del muro QUI: A + C*d.
            const A = (trackPts[i].x - trackPts[prev].x) * t.tx + (trackPts[i].z - trackPts[prev].z) * t.tz;
            for (const side of [-1, 1]) {
                const C = side * (nQui.nx * t.tx + nQui.nz * t.tz);
                if (C >= 0) continue;             // lato esterno: si allunga, nessun rischio
                const banda = side > 0 ? base.right : base.left;
                // Non basta A + C*d > 0: a filo di zero il nastro avanza di
                // nulla e i quad restano degeneri. Se ne pretende una
                // frazione, che è anche il margine per il campionamento.
                const tetto = Math.max(storica, A * (1 - BARRIER_MIN_ADVANCE) / (-C));
                if (banda[i] > tetto) banda[i] = tetto;
            }
        }
```

- [ ] **Step 3: Esportare la costante**

Nell'oggetto restituito dal modulo (riga ~521), aggiungere
`BARRIER_MIN_ADVANCE` accanto a `RUNOFF_MIN, RUNOFF_MAX`:

```javascript
        RUNOFF_MIN, RUNOFF_MAX, BARRIER_MIN_ADVANCE, BRIDGE_MARGIN, PIT_STRAIGHT_REACH,
```

- [ ] **Step 4: Lanciare i test**

Comando: `node --test frontend/shared/trackGravel.test.js`
Atteso: il test di `prova` passa (0 ripiegamenti), `monte-rosso` resta verde,
e i 17 test preesistenti restano verdi.

- [ ] **Step 5: Rimisurare col tool e guardare il disegno**

```bash
node backend/tools/f1-barriera-dallalto.js prova --baseline
```

Atteso: `ripiegamenti: 0`, `auto-intersezioni: 0`, nessuna zona critica.
Aprire `backend/tools/out/barriera-prova.svg` e **guardare la forma**: in blu
il muro di prima, in rosso quello nuovo. Verificare che nei quattro punti il
rosso non si annodi. Annotare che forma prende la curva: punta, uncino o
raccordo — serve al Task 6.

- [ ] **Step 6: Verificare che il profilo client/server resti coerente**

Comando: `node --test backend/sockets/games/trackLoader.test.js`
Atteso: verde. Se fallisce, il muro disegnato e quello fisico divergono e in
gioco si sbatte contro muri invisibili: **fermarsi e capire prima di
continuare.**

- [ ] **Step 7: Commit**

```bash
git add frontend/shared/trackGravel.js
git commit -m "F1 barriere: il muro non supera il raggio della curva (niente cappi)"
```

---

### Task 5: La ghiaia torna a crescere con la velocità della curva

**File:**
- Modifica: `frontend/shared/trackGravel.js` — costante `RUNOFF_MAX` (riga
  ~286) e seconda passata (righe ~377-385)
- Modifica: `frontend/shared/trackGravel.test.js` — un test nuovo

**Interfacce:**
- Consuma: quanto prodotto dai Task 3 e 4 (`pistaVera`, `ripiegamentiDi`,
  `BARRIER_MIN_ADVANCE`).
- Produce: nessuna interfaccia nuova. `RUNOFF_MAX` **sparisce** dall'export.

Decisione dell'utente del 2026-08-12: *"16 ovunque tranne nelle curve che in
base alla velocità ne necessitano di più"*. Il tetto fisso a 16 introdotto la
sera prima viene tolto; a limitare il muro resta il tetto geometrico del
Task 4, che è locale e non una costante.

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungere in fondo a `frontend/shared/trackGravel.test.js`:

```javascript
test('la ghiaia cresce con la velocità della curva, oltre la base di 16', () => {
    const { raw, pts } = pistaVera('prova');
    const bar = TrackGravel.barrierProfile(pts, { roadHalf: raw.roadHalfWidth });
    const bordoCordolo = raw.roadHalfWidth + TrackGravel.CURB_W;

    let massimo = 0;
    for (let i = 0; i < pts.length; i++) {
        for (const side of [-1, 1]) {
            massimo = Math.max(massimo, TrackGravel.barrierAt(bar, i, side) - bordoCordolo);
        }
    }
    // Su prova le curve veloci chiedono 20.7, 22, 25.1 e 31.9 unità di
    // ghiaia: se il muro non supera mai RUNOFF_MIN significa che un tetto
    // fisso le sta tosando tutte, e le vie di fuga non raccontano più che
    // curva sia.
    assert.ok(massimo > TrackGravel.RUNOFF_MIN + 2,
        `il muro non supera mai ${TrackGravel.RUNOFF_MIN} dal cordolo (massimo ${massimo.toFixed(1)}): la ghiaia non cresce più con la curva`);
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Comando: `node --test frontend/shared/trackGravel.test.js`
Atteso: FAIL, `il muro non supera mai 16 dal cordolo (massimo 16.0)`.

- [ ] **Step 3: Estrarre il tetto geometrico in una funzione**

Il tetto serve ora in due punti (seconda passata e quarta e tre quarti):
va estratto **prima** di usarlo, in una funzione del modulo, sopra
`barrierProfile`.

```javascript
    // Distanza massima a cui il muro può stare al campione `i` senza che il
    // nastro si ripieghi. Ricavata in forma chiusa dall'avanzamento del punto
    // di barriera, che è lineare nella distanza: A + C*d, con C negativo sul
    // lato interno. Restituisce Infinity sul lato esterno, dove il nastro si
    // allunga e nessun vincolo serve.
    function tettoGeometrico(trackPts, i, side, minAdvance) {
        const n = trackPts.length;
        const prev = (i - 1 + n) % n;
        const t = TrackGeometry.tangentAt(trackPts, prev, true);
        const nQui = TrackGeometry.normalAt(trackPts, i, true);
        const C = side * (nQui.nx * t.tx + nQui.nz * t.tz);
        if (C >= 0) return Infinity;
        const A = (trackPts[i].x - trackPts[prev].x) * t.tx + (trackPts[i].z - trackPts[prev].z) * t.tz;
        return A * (1 - minAdvance) / (-C);
    }
```

Nella quarta passata e tre quarti (Task 4), il corpo del ciclo si semplifica
così, con lo stesso comportamento:

```javascript
            for (const side of [-1, 1]) {
                const tetto = tettoGeometrico(trackPts, i, side, BARRIER_MIN_ADVANCE);
                if (!isFinite(tetto)) continue;
                const banda = side > 0 ? base.right : base.left;
                const limite = Math.max(storica, tetto);
                if (banda[i] > limite) banda[i] = limite;
            }
```

- [ ] **Step 4: Togliere il tetto fisso dalla seconda passata**

Eliminare la costante `RUNOFF_MAX` e il suo commento (righe ~280-286), poi
sostituire **l'intero ciclo della seconda passata** (quello che oggi contiene
`const tetto = bordoCordolo + RUNOFF_MAX;`) con questo:

```javascript
        for (let i = 0; i < n; i++) {
            if (trackPts[i].bridge) continue;
            if (zonaBox[i]) {
                // Niente ghiaia dove il muro non arretra: verrebbe rifilata a
                // 1.2 unità, cioè una striscia beige larga un bordino.
                gravel.left[i] = 0;
                gravel.right[i] = 0;
                continue;
            }
            for (const side of [-1, 1]) {
                const larghezza = side > 0 ? gravel.right[i] : gravel.left[i];
                if (larghezza <= 0) continue;
                const banda = side > 0 ? base.right : base.left;
                // La ghiaia spinge fuori il muro quanto la curva chiede: le
                // curve veloci hanno una via di fuga più ampia, quelle lente
                // quasi niente. Non c'è più un tetto fisso — a limitare il
                // muro è il tetto geometrico della passata più sotto, che è
                // locale: dove la curva è troppo stretta perché quella
                // larghezza ci stia, il muro scende da sé.
                //
                // ⚠️ Ma la ghiaia non deve MAI spingere il muro oltre il
                // punto in cui il nastro regge. Su baku le curve hanno raggio
                // 9.9 con pista di semi-larghezza 11: lì nemmeno la distanza
                // storica sta dentro il raggio, e il tetto geometrico non può
                // salvarla perché non scende sotto `storica`. Lasciando
                // spingere la ghiaia i ripiegamenti passavano da 31 a 45,
                // misurato il 2026-08-12. `limite` non scende mai sotto il
                // valore che il campione ha già: la spinta può solo fermarsi,
                // mai peggiorare la situazione di partenza.
                const limite = Math.max(banda[i], tettoGeometrico(trackPts, i, side, BARRIER_MIN_ADVANCE));
                banda[i] = Math.max(banda[i], Math.min(bordoCordolo + larghezza, limite));
            }
        }
```

- [ ] **Step 5: Togliere `RUNOFF_MAX` dall'export**

Nell'oggetto restituito, la riga diventa:

```javascript
        RUNOFF_MIN, BARRIER_MIN_ADVANCE, BRIDGE_MARGIN, PIT_STRAIGHT_REACH,
```

Verificare che nessun altro file la usi:

```bash
grep -rn "RUNOFF_MAX" --include="*.js" . | grep -v node_modules
```

Atteso: nessun risultato.

- [ ] **Step 6: Lanciare tutti i test toccati**

```bash
node --test frontend/shared/trackGravel.test.js
node --test backend/sockets/games/trackLoader.test.js
node --test backend/tools/f1-segnalazioni.test.js
```

Atteso: tutti verdi. In particolare il test dei ripiegamenti deve restare
verde su `prova` e **`baku` non deve peggiorare**: se il test di `baku`
fallisce, la clausola anti-peggioramento non sta funzionando ed è lì che
guardare, non altrove.

- [ ] **Step 7: Rimisurare i quattro tracciati**

```bash
for t in prova new-monza monte-rosso baku; do node backend/tools/f1-barriera-dallalto.js $t --baseline; done
```

Atteso: `prova` 0 e 0, `monte-rosso` 0 e 0, `new-monza` e `baku` non peggio
dei valori di partenza (23/10 e 31/13).

- [ ] **Step 8: Commit**

```bash
git add frontend/shared/trackGravel.js frontend/shared/trackGravel.test.js
git commit -m "F1 barriere: la ghiaia torna a crescere con la velocita della curva"
```

---

### Task 6: La forma, scelta sui disegni

**File:**
- Nessuna modifica al codice in questo task. Produce disegni e una decisione.

Questo task esiste perché il difetto si giudica guardandolo, e perché il clamp
secco è già stato bocciato una volta come "uncino". La variante alternativa —
abbassare l'**intero arco** della curva invece del solo campione che sfora —
sui numeri di `prova` è equivalente (0 e 0 in entrambi i casi) ma dà una forma
diversa: sarebbe il muro che scende dolcemente lungo tutta la curva.

- [ ] **Step 1: Generare i disegni dei quattro tracciati**

```bash
for t in prova new-monza monte-rosso baku; do node backend/tools/f1-barriera-dallalto.js $t --baseline; done
```

- [ ] **Step 2: Guardarli**

Aprire i quattro SVG in `backend/tools/out/`. Per ogni zona che era critica,
descrivere a parole la forma: raccordo pulito, punta, uncino, tacca squadrata.

- [ ] **Step 3: Mostrarli all'utente**

Pubblicare una pagina con i disegni prima/dopo affiancati e le zone critiche
evidenziate, e **chiedere all'utente se la forma va bene** prima del playtest.
È il passaggio che è mancato le tre volte precedenti.

- [ ] **Step 4: Decidere**

- Se la forma va bene → saltare il Task 7 e andare al Task 8.
- Se l'utente vede punte o uncini → eseguire il Task 7.

---

### Task 7 (condizionale): il muro scende su tutta la curva

**Da eseguire solo se il Task 6 lo richiede.**

**File:**
- Modifica: `frontend/shared/trackGravel.js` — la passata del tetto
- Modifica: `frontend/shared/trackGravel.test.js` — un test nuovo

**Interfacce:**
- Consuma: `TrackGeometry.findCorners(pts) -> [{startIdx, endIdx, midIdx, side, minRadius}]`,
  `tettoGeometrico` (Task 5).

- [ ] **Step 1: Scrivere il test**

```javascript
test('nelle curve strette il muro scende su tutto l\'arco, non solo sull\'apice', () => {
    const { raw, pts } = pistaVera('prova');
    const bar = TrackGravel.barrierProfile(pts, { roadHalf: raw.roadHalfWidth });
    const n = pts.length;

    // Curva 126 di prova, raggio 40: è una di quelle in cui il tetto morde.
    // Se il muro scende solo sull'apice, la distanza ha una V stretta; se
    // scende su tutto l'arco, i campioni vicini all'apice stanno entro poco
    // dal minimo.
    const apice = 134;
    const dApice = TrackGravel.barrierAt(bar, apice, -1);
    for (const off of [-6, -4, 4, 6]) {
        const d = TrackGravel.barrierAt(bar, (apice + off + n) % n, -1);
        assert.ok(d - dApice < 6,
            `il muro risale di ${(d - dApice).toFixed(1)} a ${off} campioni dall'apice: è una punta, non un raccordo`);
    }
});
```

- [ ] **Step 2: Lanciarlo e verificare che fallisca**

Comando: `node --test frontend/shared/trackGravel.test.js`
Atteso: FAIL sul campione a ±4 o ±6 dall'apice.

- [ ] **Step 3: Applicare il tetto per arco di curva**

Sostituire la passata del tetto con questa, che prima abbassa l'intero arco
delle curve dove il tetto morde, e poi applica comunque il tetto campione per
campione come garanzia dura per ciò che sta fuori dagli archi riconosciuti:

```javascript
        // Il tetto abbassa l'INTERO arco della curva, non il solo campione
        // che sfora: intaccare solo l'apice lascia una punta (provata e
        // bocciata dall'utente il 2026-08-12, "uncino"). Il muro scende
        // dolcemente lungo tutta la curva e il livellamento della passata
        // successiva raccorda entrata e uscita.
        for (const corner of TrackGeometry.findCorners(trackPts)) {
            const arco = (corner.endIdx - corner.startIdx + n) % n;
            let minimo = Infinity;
            for (let s = 0; s <= arco; s++) {
                const i = (corner.startIdx + s) % n;
                if (trackPts[i].bridge) continue;
                minimo = Math.min(minimo, tettoGeometrico(trackPts, i, corner.side, BARRIER_MIN_ADVANCE));
            }
            if (!isFinite(minimo)) continue;
            const limite = Math.max(storica, minimo);
            const banda = corner.side > 0 ? base.right : base.left;
            for (let s = 0; s <= arco; s++) {
                const i = (corner.startIdx + s) % n;
                if (trackPts[i].bridge) continue;
                if (banda[i] > limite) banda[i] = limite;
            }
        }
        // Garanzia dura: quello che sta fuori dagli archi riconosciuti da
        // findCorners deve comunque rispettare il tetto.
        for (let i = 0; i < n; i++) {
            const prev = (i - 1 + n) % n;
            if (trackPts[i].bridge || trackPts[prev].bridge) continue;
            for (const side of [-1, 1]) {
                const tetto = tettoGeometrico(trackPts, i, side, BARRIER_MIN_ADVANCE);
                if (!isFinite(tetto)) continue;
                const banda = side > 0 ? base.right : base.left;
                const limite = Math.max(storica, tetto);
                if (banda[i] > limite) banda[i] = limite;
            }
        }
```

- [ ] **Step 4: Lanciare i test**

```bash
node --test frontend/shared/trackGravel.test.js
node --test backend/sockets/games/trackLoader.test.js
```

Atteso: tutti verdi, ripiegamenti ancora 0 su `prova` e `monte-rosso`.

- [ ] **Step 5: Ridisegnare e riguardare**

```bash
for t in prova new-monza monte-rosso baku; do node backend/tools/f1-barriera-dallalto.js $t --baseline; done
```

Mostrare di nuovo i disegni all'utente e confermare la forma.

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/trackGravel.js frontend/shared/trackGravel.test.js
git commit -m "F1 barriere: nelle curve strette il muro scende su tutto l'arco"
```

---

### Task 8: La scenografia segue il muro, e consegna al playtest

**File:**
- Modifica: `frontend/f1.html` (bump del cache-busting)

**Interfacce:**
- Consuma: `backend/tools/f1-segnalazioni.js` (rigenera la scenografia dai
  dati veri e stampa gli oggetti attorno a un punto).

Tribune, reti `catchFence` e scenografia leggono lo stesso `barrierProfile`:
allargando il muro oltre 16 nelle curve veloci si spostano in fuori con lui, e
va verificato che non restino staccate né appese al terrapieno.

- [ ] **Step 1: Verificare le invarianti della scenografia**

```bash
node --test backend/tools/f1-segnalazioni.test.js
node --test backend/tools/circuitAssets.test.js
```

Atteso: verdi. I quattro test delle segnalazioni pretendono che il layout
ricostruito dal tool coincida con quello del client: se falliscono, la catena
di generazione è divergente e il tool di lettura mentirebbe.

- [ ] **Step 2: Lanciare la suite intera**

```bash
node --test --test-reporter=dot $(git ls-files "*.test.js" | tr '\n' ' ')
```

Atteso: i **4 rossi preesistenti** elencati nei vincoli globali, e nessun
altro. Qualsiasi rosso nuovo va risolto prima di consegnare.

- [ ] **Step 3: Bump del cache-busting**

In `frontend/f1.html`, incrementare il parametro `?v=` di `f1.js`. Senza
questo il browser serve il JS vecchio e in pista non si vede nessun
cambiamento — errore già fatto e già costato un playtest.

- [ ] **Step 4: Commit**

```bash
git add frontend/f1.html
git commit -m "F1 barriere: bump cache dopo il vincolo geometrico"
```

- [ ] **Step 5: Consegnare all'utente per il playtest**

Riavviare il server da `.claude/worktrees/f1-ghiaia/backend` (`node server.js`)
e chiedere all'utente di girare su `prova` con un **hard refresh**, guardando:

- i quattro punti che aveva marcato (campioni 132, 337, 646, 764);
- se la ghiaia è visibilmente più larga nelle curve veloci che in quelle lente;
- se nei tornanti il muro sta sul cordolo senza punte;
- se tribune e reti sono rimaste al loro posto.

---

## Note per chi esegue

- **Non inseguire un quarto fix a sensazione.** Se il playtest boccia la
  forma, tornare al Task 6: si guarda il disegno e si decide lì, non si tira a
  indovinare un numero.
- **La misura non basta da sola.** Tre correzioni sono state approvate su
  misure verdi e bocciate dall'occhio dell'utente. Ogni task che tocca la
  forma finisce con "guarda il disegno".
- **Il server va riavviato** dopo modifiche al backend, altrimenti le route
  dev rispondono 404 e sembra che il tasto M non funzioni.
