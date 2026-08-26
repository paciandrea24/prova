# Il tubo esiste e ci si passa (fase 2a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un tratto di pista può essere un giro della morte: si entra in fondo a un rettilineo, si sale, ci si rovescia in cima, si riscende e si esce sulla corsia di fianco — con l'auto e la camera che si capovolgono insieme al nastro, e la gravità che decide se ce la fai.

**Architecture:** La spina dorsale della pista resta UNA. I campioni del loop entrano nella lista dei punti pista marcati `acrobatico`, generati da una formula e inseriti DOPO il campionamento in pianta (una spline che passasse per punti sovrapposti in pianta oscillerebbe). Giri, settori, tempi e classifica continuano a contare su `trackIndex` senza modifiche; terreno, prato, scenografia e barriere escludono quei campioni con lo stesso meccanismo che già esiste per `bridge`. Dentro il tratto cambia solo CHI comanda la posizione: fuori l'auto si muove in x/z e da lì si ricava il campione, dentro si avanza lungo il nastro e da lì si ricavano x, y, z e l'orientamento.

**Tech Stack:** Node.js, `node --test` + `node:assert/strict`, moduli UMD condivisi (`frontend/shared/*.js`), Three.js r128 lato client.

**Spec:** `docs/superpowers/specs/2026-08-25-f1-nastro-orientato-design.md` (FASE 2, con le decisioni operative del 2026-08-26 in testa alla sezione)

## Global Constraints

- **Italiano** nei commenti e nei messaggi di commit.
- **Le piste senza tratti acrobatici devono restare identiche al bit.** Ogni task che tocca punti, mesh o fisica lo verifica con un test, non a occhio.
- **Una cosa, una misura**: il frame del nastro (dove punta, dov'è l'alto) lo calcola `TrackGeometry`, e lo leggono mesh, fisica e camera. Se qualcuno se lo ricalcolasse, un giorno l'auto sarebbe coricata di là e il tubo di qua.
- **Soglie geometriche per unità di pista, mai per campione**: il campione vale 1.18 unità su monte-rosso e 5.17 su prova.
- **Niente `git add -A`**: aggiungere i file per nome; l'utente lavora in parallelo sulle sue piste.
- **Commit ad ogni task**, con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Baseline dei test** (su `main`, 2026-08-26, senza i file locali dell'utente): `node --test frontend/shared/` → **4 rossi**; `node --test backend/` → **8 rossi + 2 skip**. Sul disco dell'utente ce ne sono 3 in più (`nuova-pista`): non sono regressioni.
- **Cache-busting**: ogni modifica a un modulo condiviso caricato da `f1.html` / `track-editor.html` / `track-preview.html` vuole il bump del `?v=`.
- **Worktree dedicato** (richiesta dell'utente: «non voglio rompere il gioco esistente»): `.claude/worktrees/f1-giro-della-morte`, branch `f1-giro-della-morte` da `main`.

## I numeri che reggono tutto

| grandezza | valore | da dove viene |
|---|---|---|
| velocità massima | `6.2` u/tick (≈341 km/h) | `PowertrainModel.MAX_SPEED` |
| accelerazione motore | `0.186` u/tick² | `PowertrainModel.ACCEL` |
| gravità lungo il nastro | `0.8` u/tick² | `GravitaNastro.G_NASTRO` |
| **gravità DENTRO il tubo** | **`0.2`** (un quarto) | decisione utente 2026-08-26 |
| larghezza pista | 22-24 unità | `roadHalfWidth` delle piste vere |
| lunghezza auto | 7.16 unità | `CollisionResolver.CAR_HALF_LENGTH × 2` |

Salire di due raggi costa `v² = 4·G·R`. Con G a 0.2: raggio **25** → ingresso a `sqrt(4·0.2·25)` = **4.47 u/tick ≈ 246 km/h** (72% del massimo); raggio massimo percorribile ≈ **45**.

---

### Task 1: Un tratto può essere un giro della morte

Il tipo di tratto esiste nel dato e non cambia NIENTE nella cottura: i punti di controllo di un tratto acrobatico sono quelli di una retta fra i suoi due nodi. Il loop non sta nei punti di controllo — ci entra dopo, al Task 3 — perché una spline che passasse per punti sovrapposti in pianta oscillerebbe, e perché così una pista con un loop si salva, si ricarica e si disegna in pianta come una qualunque.

**Files:**
- Modify: `frontend/shared/trackSegmenti.js` — `valutaTratto` (~riga 183), e le costanti in testa al modulo
- Test: `frontend/shared/trackSegmenti.test.js`

**Interfaces:**
- Produces: `TrackSegmenti.RAGGIO_ACROBATICO_DEFAULT = 25`, `TrackSegmenti.RAGGIO_ACROBATICO_MAX = 45`, `TrackSegmenti.acrobaziaDi(tratto)` → `{ raggio }` oppure `null`

- [x] **Step 1: Scrivere il test che fallisce**

In fondo a `frontend/shared/trackSegmenti.test.js`, con la forma degli altri test del file:

```js
// --- il giro della morte (fase 2a) ---

test('un tratto acrobatico si cuoce come una retta: il loop non sta nei punti di controllo', () => {
    // In pianta il tratto va dal nodo di ingresso a quello di uscita, che gli
    // sta di fianco. Il giro vero viene inserito dopo il campionamento
    // (TrackGeometry.inserisciAcrobatici): qui dentro non se ne vede traccia,
    // ed e' voluto — una spline che passasse per i punti del loop, che in
    // pianta si sovrappongono, oscillerebbe.
    const nodi = [
        { x: 0, z: 0, y: 0, dir: 0 },
        { x: 0, z: 200, y: 0, dir: 0 },
        { x: 30, z: 200, y: 0, dir: 0 },
        { x: 30, z: 0, y: 0, dir: 0 },
    ];
    const conLoop = { versione: 1, nodi, tratti: [
        { tipo: 'retta' }, { tipo: 'acrobatico', raggio: 25 }, { tipo: 'retta' }, { tipo: 'curva' }] };
    const comeRetta = { versione: 1, nodi, tratti: [
        { tipo: 'retta' }, { tipo: 'retta' }, { tipo: 'retta' }, { tipo: 'curva' }] };
    const a = TrackSegmenti.cuoci(conLoop, TrackSegmenti.PASSO_COTTURA, 11);
    const b = TrackSegmenti.cuoci(comeRetta, TrackSegmenti.PASSO_COTTURA, 11);
    assert.deepEqual(a, b);
});

test('acrobaziaDi legge il raggio, e dice no a chi non e\' acrobatico', () => {
    assert.equal(TrackSegmenti.acrobaziaDi({ tipo: 'curva' }), null);
    assert.equal(TrackSegmenti.acrobaziaDi(null), null);
    assert.deepEqual(TrackSegmenti.acrobaziaDi({ tipo: 'acrobatico' }),
        { raggio: TrackSegmenti.RAGGIO_ACROBATICO_DEFAULT });
    assert.deepEqual(TrackSegmenti.acrobaziaDi({ tipo: 'acrobatico', raggio: 30 }), { raggio: 30 });
    // Oltre il massimo si taglia invece di rifiutare, come fa gia' rollioDiTratto
    // con i 45 gradi: chi disegna vede il valore vero in pista, e il validatore
    // (fase 2b) glielo dira'.
    assert.deepEqual(TrackSegmenti.acrobaziaDi({ tipo: 'acrobatico', raggio: 900 }),
        { raggio: TrackSegmenti.RAGGIO_ACROBATICO_MAX });
});
```

⚠️ Prima di scriverli, **leggere come il file di test importa i moduli e come costruisce le geometrie**: la forma qui sopra è quella attesa, ma il file è la fonte.

- [x] **Step 2: Eseguire il test e vederlo fallire**

Run: `node --test frontend/shared/trackSegmenti.test.js`
Expected: FAIL — `acrobaziaDi is not a function`.

- [x] **Step 3: Implementare**

In testa al modulo, accanto a `ROLLIO_MAX`:

```js
    // IL GIRO DELLA MORTE, in raggio di unita' di pista.
    //
    // Il massimo non e' estetico, e' energia: salire di due raggi costa
    // v² = 4·G·R, e con la gravita' del tubo (0.2) oltre i ~45 di raggio non
    // esiste velocita' nel gioco che basti — l'auto si fermerebbe in salita e
    // riscenderebbe all'indietro. Il default e' il loop del disegno
    // dell'utente: alto 50, il doppio della larghezza della pista.
    const RAGGIO_ACROBATICO_DEFAULT = 25;
    const RAGGIO_ACROBATICO_MAX = 45;

    function acrobaziaDi(tratto) {
        if (!tratto || tratto.tipo !== 'acrobatico') return null;
        const r = (typeof tratto.raggio === 'number' && tratto.raggio > 0)
            ? tratto.raggio : RAGGIO_ACROBATICO_DEFAULT;
        return { raggio: Math.min(RAGGIO_ACROBATICO_MAX, r) };
    }
```

In `valutaTratto`, il tratto acrobatico è dritto come una retta:

```js
    function valutaTratto(a, b, tratto, t) {
        // ⚠️ L'acrobatico e' DRITTO in pianta: va dal nodo di ingresso a quello
        // di uscita, che gli sta di fianco. Il giro vero lo inserisce
        // TrackGeometry.inserisciAcrobatici dopo il campionamento.
        if (tratto && (tratto.tipo === 'retta' || tratto.tipo === 'acrobatico')) {
            return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
        }
        return valutaCurva(a, b, t);
    }
```

E aggiungere `RAGGIO_ACROBATICO_DEFAULT, RAGGIO_ACROBATICO_MAX, acrobaziaDi` all'oggetto esportato in fondo al modulo (accanto a `ROLLIO_MAX, rollioDiTratto, ...`).

- [x] **Step 4: Eseguire i test e vederli passare**

Run: `node --test frontend/shared/trackSegmenti.test.js`
Poi: `node --test frontend/shared/` → **4 rossi**, la baseline.

- [x] **Step 5: Commit**

```bash
git add frontend/shared/trackSegmenti.js frontend/shared/trackSegmenti.test.js
git commit -m "Un tratto puo' essere un giro della morte

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: La forma del giro, e il frame che la descrive

Il cuore geometrico. Il loop è un cerchio verticale percorso mentre ci si sposta di lato: senza lo spostamento laterale il nastro in discesa attraverserebbe quello in salita nello stesso punto, e l'auto ci passerebbe dentro (disegno dell'utente, 2026-08-26).

Con `θ` da 0 a 2π, direzione di marcia `d` (orizzontale, unitaria), laterale `l` (orizzontale, perpendicolare a `d`), raggio `R`, spostamento laterale `L`:

```
avanti(θ) = R·sin θ                    quota(θ) = R·(1 − cos θ)
lato(θ)   = L · smoothstep(θ / 2π)     con smoothstep(s) = s²(3 − 2s)
```

⚠️ **La smoothstep, non una rampa lineare.** La sua derivata è nulla agli estremi, ed è ciò che tiene ingresso e uscita esattamente tangenti alla pista. Con una rampa lineare il nastro entrerebbe storto di `atan(L / 2πR)` = 11 gradi con L=30 e R=25.

Il frame in ogni punto: `tan` è la derivata normalizzata, `su` è dove punta il tetto dell'auto, `lat` è il fianco destro.

```
tan(θ) ∝ ( d·R·cos θ + l·L·smoothstep'(θ/2π)/2π ,  R·sin θ ,  ... )
su(θ)  = ( −d·sin θ , cos θ , ... )          lat = tan × su
```

A θ=0 `su` vale (0,1,0) e a θ=π vale (0,−1,0): in cima si è rovesciati, che è il punto di tutto l'esercizio.

**Files:**
- Create: `frontend/shared/trackAcrobatico.js` — modulo UMD nuovo, come `trackSegmenti.js`
- Test: `frontend/shared/trackAcrobatico.test.js`

**Interfaces:**
- Consumes: `TrackSegmenti.acrobaziaDi`
- Produces:
  - `TrackAcrobatico.puntiDelGiro({ ingresso, uscita, dirX, dirZ, raggio, passo })` → array di campioni `{ x, y, z, acrobatico: true, loopAngolo, loopDirX, loopDirZ, loopLatX, loopLatZ, pendenza }`
  - `TrackAcrobatico.frameDi(p)` → `{ tan: {x,y,z}, su: {x,y,z}, lat: {x,y,z} }` (versori)
  - `TrackAcrobatico.velocitaMinima(raggio, g)` → `2·sqrt(g·raggio)`

- [x] **Step 1: Scrivere i test che falliscono**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const TrackAcrobatico = require('./trackAcrobatico.js');

// Un giro che entra andando verso +z, esce spostato di 30 verso +x.
function giroDiProva(raggio = 25) {
    return TrackAcrobatico.puntiDelGiro({
        ingresso: { x: 0, y: 0, z: 0 }, uscita: { x: 30, y: 0, z: 0 },
        dirX: 0, dirZ: 1, raggio, passo: 4,
    });
}

test('il giro comincia e finisce alla quota di partenza', () => {
    const pts = giroDiProva();
    assert.ok(pts.length > 20, `troppo pochi campioni: ${pts.length}`);
    assert.ok(Math.abs(pts[0].y) < 1e-9);
    assert.ok(Math.abs(pts[pts.length - 1].y) < 0.6, `esce a quota ${pts[pts.length - 1].y}`);
});

test('in cima si e\' alti due raggi e rovesciati', () => {
    const pts = giroDiProva();
    const cima = pts.reduce((a, b) => (b.y > a.y ? b : a));
    assert.ok(Math.abs(cima.y - 50) < 1.5, `la cima sta a ${cima.y.toFixed(1)}, non a 50`);
    assert.ok(TrackAcrobatico.frameDi(cima).su.y < -0.9, 'in cima il tetto deve puntare in giu\'');
});

test('si esce di fianco: lo spostamento laterale c\'e\' tutto', () => {
    const pts = giroDiProva();
    const fine = pts[pts.length - 1];
    assert.ok(Math.abs(fine.x - 30) < 1.5, `esce a x=${fine.x.toFixed(1)}, doveva essere 30`);
});

test('ingresso e uscita sono TANGENTI alla pista, non storti', () => {
    // E' la smoothstep a garantirlo: con una rampa lineare qui ci sarebbero
    // 11 gradi di scarto, e il nastro entrerebbe di traverso.
    const pts = giroDiProva();
    for (const p of [pts[0], pts[pts.length - 1]]) {
        const t = TrackAcrobatico.frameDi(p).tan;
        assert.ok(t.z > 0.995, `tangente storta: (${t.x.toFixed(3)}, ${t.y.toFixed(3)}, ${t.z.toFixed(3)})`);
        assert.ok(Math.abs(t.y) < 0.05, 'agli estremi il nastro dev\'essere orizzontale');
    }
});

test('la pendenza del campione e\' l\'angolo del nastro sull\'orizzonte', () => {
    // E' cio' che fa funzionare la gravita' della fase 1a dentro il tubo senza
    // una formula nuova: accelerazionePendenza chiede solo la pendenza.
    for (const p of giroDiProva()) {
        const t = TrackAcrobatico.frameDi(p).tan;
        assert.ok(Math.abs(Math.sin(p.pendenza) - t.y) < 1e-6,
            `campione a θ=${p.loopAngolo.toFixed(2)}: pendenza ${p.pendenza.toFixed(3)} contro tangente ${t.y.toFixed(3)}`);
    }
});

test('il nastro in discesa non attraversa quello in salita', () => {
    // La ragione per cui si esce di fianco. Con L=30 e la pista larga 24, i due
    // rami devono restare separati piu' della mezza carreggiata.
    const pts = giroDiProva();
    let minima = Infinity;
    for (let i = 0; i < pts.length; i++) {
        for (let j = i + 4; j < pts.length; j++) {
            const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z);
            if (d < minima) minima = d;
        }
    }
    assert.ok(minima > 11, `due punti del tubo distano ${minima.toFixed(1)}: i rami si toccano`);
});

test('la velocita\' minima per completarlo viene dall\'energia', () => {
    // v² = 4·g·R (salire di due raggi), non la condizione centripeta.
    assert.ok(Math.abs(TrackAcrobatico.velocitaMinima(25, 0.2) - 4.4721) < 1e-3);
    assert.ok(TrackAcrobatico.velocitaMinima(45, 0.2) < 6.2, 'il raggio massimo deve restare percorribile');
});
```

- [x] **Step 2: Eseguire e vedere fallire**

Run: `node --test frontend/shared/trackAcrobatico.test.js`
Expected: FAIL — `Cannot find module './trackAcrobatico.js'`.

- [x] **Step 3: Implementare**

Creare `frontend/shared/trackAcrobatico.js` con l'involucro UMD copiato da `trackSegmenti.js` (stessa forma, dipendenza da `./trackSegmenti.js`), e dentro:

```js
    // Di quanti campioni e' fatto il giro: passo costante di lunghezza d'arco,
    // come tutto il resto della pista.
    function puntiDelGiro({ ingresso, uscita, dirX, dirZ, raggio, passo }) {
        const R = raggio;
        const latX = dirZ, latZ = -dirX;                  // destra rispetto alla marcia
        const dxU = uscita.x - ingresso.x, dzU = uscita.z - ingresso.z;
        const L = dxU * latX + dzU * latZ;                // spostamento laterale VERO, dai nodi
        const avanti = dxU * dirX + dzU * dirZ;           // di solito ~0, ma se c'e' lo si onora
        const quanti = Math.max(8, Math.round(2 * Math.PI * R / passo));
        const out = [];
        for (let k = 0; k < quanti; k++) {
            const th = (k / quanti) * 2 * Math.PI;
            const s = k / quanti;
            const sm = s * s * (3 - 2 * s);               // smoothstep: derivata nulla agli estremi
            const av = R * Math.sin(th) + avanti * sm;
            const lt = L * sm;
            out.push({
                x: ingresso.x + dirX * av + latX * lt,
                y: (ingresso.y || 0) + R * (1 - Math.cos(th)),
                z: ingresso.z + dirZ * av + latZ * lt,
                acrobatico: true,
                loopAngolo: th,
                loopDirX: dirX, loopDirZ: dirZ,
                loopLatX: latX, loopLatZ: latZ,
                // La pendenza del nastro sull'orizzonte E' l'angolo percorso: e'
                // questo che fa funzionare la gravita' della fase 1a qui dentro
                // senza una formula nuova.
                pendenza: th,
            });
        }
        return out;
    }

    // Dove punta il nastro e dov'e' l'alto, in un campione acrobatico.
    // ⚠️ Un posto solo: lo leggono la mesh, la fisica e la camera. Se qualcuno
    // se lo ricalcolasse, un giorno l'auto sarebbe coricata di la' e il tubo di
    // qua.
    function frameDi(p) {
        const th = p.loopAngolo || 0;
        const c = Math.cos(th), s = Math.sin(th);
        const tan = versore(p.loopDirX * c, s, p.loopDirZ * c);
        const su  = versore(-p.loopDirX * s, c, -p.loopDirZ * s);
        return { tan, su, lat: { x: p.loopLatX, y: 0, z: p.loopLatZ } };
    }

    function versore(x, y, z) {
        const n = Math.hypot(x, y, z) || 1;
        return { x: x / n, y: y / n, z: z / n };
    }

    // Salire di due raggi costa v² = 4·g·R. Non e' la condizione centripeta di
    // un'auto che si stacca: qui l'auto e' incollata al nastro (decisione 3
    // della spec) e conta solo l'energia.
    function velocitaMinima(raggio, g) {
        return 2 * Math.sqrt(g * raggio);
    }
```

⚠️ La tangente qui **ignora** il contributo laterale della smoothstep: è un'approssimazione che vale perché `L·smoothstep'` è al massimo `1.5·L/2πR` ≈ 0.29 contro `R` = 25, e agli estremi è esattamente zero — che è dove la tangenza conta. Se un test di continuità in ingresso dovesse fallire per pochi centesimi, è qui che si aggiunge il termine, non altrove.

- [x] **Step 4: Eseguire e vedere passare**

Run: `node --test frontend/shared/trackAcrobatico.test.js`
Expected: PASS, tutti e sette.

- [x] **Step 5: Commit**

```bash
git add frontend/shared/trackAcrobatico.js frontend/shared/trackAcrobatico.test.js
git commit -m "La forma del giro della morte, e il frame che la descrive

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: I campioni del giro entrano nella spina dorsale

La pista si campiona in pianta come sempre; poi, dove la geometria dichiara un tratto acrobatico, i campioni fra il nodo di ingresso e quello di uscita vengono **sostituiti** da quelli del giro. È il punto in cui il loop entra nel gioco: da qui in poi `track.points` contiene il tubo, e chiunque cammini sui punti lo vede.

**Files:**
- Modify: `frontend/shared/trackAcrobatico.js` — aggiungere `inserisciNeiCampioni`
- Modify: `backend/sockets/games/trackLoader.js` — dopo il campionamento della pista (`sampleLoop`), prima di cuocere pendenza/halfWidth/rollio
- Test: `frontend/shared/trackAcrobatico.test.js`, `backend/sockets/games/trackLoader.test.js`

**Interfaces:**
- Consumes: `TrackSegmenti.acrobaziaDi`, `TrackAcrobatico.puntiDelGiro`, `TrackGeometry.nearestPoint`
- Produces: `TrackAcrobatico.inserisciNeiCampioni(points, geometria, passo)` → nuovo array di campioni (l'originale non si tocca)

- [x] **Step 1: Scrivere i test che falliscono**

```js
const TrackGeometry = require('./trackGeometry.js');
const TrackSegmenti = require('./trackSegmenti.js');

function pistaConUnGiro(raggio = 25) {
    const nodi = [
        { x: 0, z: -200, y: 0, dir: 0 }, { x: 0, z: 0, y: 0, dir: 0 },
        { x: 30, z: 0, y: 0, dir: 0 }, { x: 30, z: -200, y: 0, dir: 0 },
    ];
    const g = TrackSegmenti.riallinea({ versione: 1, nodi, tratti: [
        { tipo: 'retta' }, { tipo: 'acrobatico', raggio }, { tipo: 'retta' }, { tipo: 'curva' }] });
    return { geometria: g, controlPoints: TrackSegmenti.cuoci(g, TrackSegmenti.PASSO_COTTURA, 11) };
}

test('senza tratti acrobatici i campioni restano identici al bit', () => {
    const { controlPoints } = pistaConUnGiro();
    const pts = TrackGeometry.sampleLoop(controlPoints, 400);
    const geometriaPiana = { versione: 1, nodi: [], tratti: [{ tipo: 'curva' }] };
    assert.deepEqual(TrackAcrobatico.inserisciNeiCampioni(pts, geometriaPiana, 4), pts);
});

test('con un giro la pista si allunga di una circonferenza', () => {
    const R = 25;
    const { geometria, controlPoints } = pistaConUnGiro(R);
    const pts = TrackGeometry.sampleLoop(controlPoints, 400);
    const conTubo = TrackAcrobatico.inserisciNeiCampioni(pts, geometria, 4);
    const cresciuta = TrackGeometry.lapLength(conTubo) - TrackGeometry.lapLength(pts);
    assert.ok(Math.abs(cresciuta - 2 * Math.PI * R) < 25,
        `il giro e' cresciuto di ${cresciuta.toFixed(0)}, doveva crescere di ${(2 * Math.PI * R).toFixed(0)}`);
    assert.ok(conTubo.filter(p => p.acrobatico).length > 20, 'nessun campione marcato acrobatico');
});

test('il tubo si aggancia dove la pista arriva, senza salti', () => {
    const { geometria, controlPoints } = pistaConUnGiro();
    const pts = TrackGeometry.sampleLoop(controlPoints, 400);
    const conTubo = TrackAcrobatico.inserisciNeiCampioni(pts, geometria, 4);
    const passo = TrackGeometry.lapLength(conTubo) / conTubo.length;
    for (let i = 0; i < conTubo.length; i++) {
        const a = conTubo[i], b = conTubo[(i + 1) % conTubo.length];
        const d = Math.hypot(b.x - a.x, (b.y || 0) - (a.y || 0), b.z - a.z);
        assert.ok(d < passo * 3,
            `salto di ${d.toFixed(1)} unita' fra i campioni ${i} e ${i + 1} (passo medio ${passo.toFixed(1)})`);
    }
});
```

- [x] **Step 2: Eseguire e vedere fallire**

Run: `node --test frontend/shared/trackAcrobatico.test.js`
Expected: FAIL — `inserisciNeiCampioni is not a function`.

- [x] **Step 3: Implementare**

In `trackAcrobatico.js`:

```js
    // I campioni del giro PRENDONO IL POSTO di quelli in pianta fra i due nodi.
    //
    // ⚠️ Dopo il campionamento e non prima: `TrackGeometry.resample` interpola
    // una spline attraverso i punti di controllo, e i punti del loop in pianta
    // si sovrappongono — la spline oscillerebbe. Cosi' invece la pista in pianta
    // resta quella di sempre e il tubo e' esatto, generato dalla formula.
    function inserisciNeiCampioni(points, geometria, passo) {
        const tratti = (geometria && geometria.tratti) || [];
        const nodi = (geometria && geometria.nodi) || [];
        const acrobazie = [];
        for (let t = 0; t < tratti.length; t++) {
            const a = TrackSegmenti.acrobaziaDi(tratti[t]);
            if (a && nodi[t] && nodi[(t + 1) % nodi.length]) {
                acrobazie.push({ raggio: a.raggio, ingresso: nodi[t], uscita: nodi[(t + 1) % nodi.length] });
            }
        }
        if (!acrobazie.length) return points;

        // Si lavora dall'ultimo al primo: sostituire un pezzo sposta gli indici
        // di tutto quello che viene dopo.
        const trovate = acrobazie.map(a => ({
            ...a,
            i0: TrackGeometry.nearestPoint(points, a.ingresso.x, a.ingresso.z).index,
            i1: TrackGeometry.nearestPoint(points, a.uscita.x, a.uscita.z).index,
        })).sort((p, q) => q.i0 - p.i0);

        let out = points.slice();
        for (const a of trovate) {
            const dir = versoDiMarcia(points, a.i0);
            const giro = puntiDelGiro({
                ingresso: out[a.i0], uscita: { x: a.uscita.x, y: out[a.i0].y || 0, z: a.uscita.z },
                dirX: dir.x, dirZ: dir.z, raggio: a.raggio, passo,
            });
            // I campi che il resto del gioco si aspetta su OGNI campione
            // (larghezza, ponte) si ereditano dal punto di ingresso: dentro il
            // tubo la carreggiata non cambia (decisione dell'utente).
            for (const p of giro) {
                p.halfWidth = out[a.i0].halfWidth;
                p.rollio = 0;
            }
            const quanti = (a.i1 - a.i0 + out.length) % out.length;
            out.splice(a.i0 + 1, Math.max(0, quanti - 1), ...giro);
        }
        return out;
    }

    function versoDiMarcia(points, i) {
        const n = points.length;
        const a = points[(i - 1 + n) % n], b = points[(i + 1) % n];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        return { x: dx / len, z: dz / len };
    }
```

Poi in `backend/sockets/games/trackLoader.js`, subito dopo la riga che campiona la pista (`TrackGeometry.sampleLoop(raw.controlPoints, SAMPLES)`) e **prima** di qualunque cottura per campione:

```js
    // I giri della morte entrano qui, prima che si cuocia qualunque cosa sui
    // campioni: pendenza, larghezza e rollio devono vederli come punti pista
    // normali. Una pista senza tratti acrobatici torna indietro identica.
    points = TrackAcrobatico.inserisciNeiCampioni(points, raw.geometria, TrackGeometry.lapLength(points) / points.length);
```

⚠️ **Leggere il nome vero della variabile dei campioni in `buildTrack`** prima di scrivere questa riga, e aggiungere `const TrackAcrobatico = require('../../../frontend/shared/trackAcrobatico.js');` in testa al file, accanto agli altri require.

⚠️ La **pendenza cotta** dal caricatore non deve sovrascrivere quella dei campioni acrobatici: `pendenzaAt` la ricava da dy/dx orizzontale, che dentro il tubo è priva di senso (in cima l'avanzamento orizzontale è zero). Nel punto in cui `trackLoader` scrive `p.pendenza`, saltare i campioni che ce l'hanno già dal tubo:

```js
        if (!p.acrobatico) p.pendenza = TrackGeometry.pendenzaAt(points, i, true);
```

- [x] **Step 4: Eseguire e vedere passare**

Run: `node --test frontend/shared/trackAcrobatico.test.js`
Poi: `node --test backend/` → **8 rossi + 2 skip**, la baseline. ⚠️ Se una pista esistente cambia anche di un campione, il difetto è qui: `inserisciNeiCampioni` deve restituire l'array originale quando non ci sono acrobazie.

- [x] **Step 5: Commit**

```bash
git add frontend/shared/trackAcrobatico.js frontend/shared/trackAcrobatico.test.js backend/sockets/games/trackLoader.js
git commit -m "Il giro della morte entra nella spina dorsale della pista

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: La pista di prova, e quanto bisogna correre

Come `banking-prova` per il banking: una pista che esiste per rispondere a una domanda sola. Un anello con un rettilineo lungo abbastanza per arrivare lanciati, un giro della morte, e il resto liscio.

**Files:**
- Create: `backend/tools/f1-crea-pista-loop.js`
- Create (generato, **committato**): `frontend/tracks/loop-prova.json`
- Test: `backend/tools/f1-crea-pista-loop.test.js`

**Interfaces:**
- Consumes: `TrackSegmenti.cuoci/riallinea`, `TrackAcrobatico.velocitaMinima`, `PowertrainModel.MAX_SPEED`

- [x] **Step 1: Scrivere il test che fallisce**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const TrackAcrobatico = require('../../frontend/shared/trackAcrobatico.js');
const { MAX_SPEED } = require('../sockets/games/physics/PowertrainModel.js');
const { loadTrack } = require('../sockets/games/trackLoader.js');

test('loop-prova ha un giro della morte percorribile', () => {
    const track = loadTrack('loop-prova');
    const tubo = track.points.filter(p => p.acrobatico);
    assert.ok(tubo.length > 20, `il tubo ha ${tubo.length} campioni`);
    const cima = tubo.reduce((a, b) => (b.y > a.y ? b : a));
    const R = 25;
    assert.ok(Math.abs(cima.y - 2 * R) < 2, `la cima sta a ${cima.y.toFixed(1)}`);
    // E la velocita' che serve dev'essere raggiungibile, con margine.
    const serve = TrackAcrobatico.velocitaMinima(R, 0.2);
    assert.ok(serve < MAX_SPEED * 0.85,
        `servono ${serve.toFixed(2)} u/tick su ${MAX_SPEED}: senza margine non lo completa nessuno`);
});

test('il rettilineo prima del giro basta per arrivarci lanciati', () => {
    // Partendo da fermo con ACCEL, quanto rettilineo serve per raggiungere la
    // velocita' d'ingresso: v²/(2·a). Il test pretende che la pista ne abbia
    // almeno il doppio, perche' non ci si arriva mai da fermi.
    const { ACCEL } = require('../sockets/games/physics/PowertrainModel.js');
    const serve = Math.pow(TrackAcrobatico.velocitaMinima(25, 0.2), 2) / (2 * ACCEL);
    const track = loadTrack('loop-prova');
    const primoTubo = track.points.findIndex(p => p.acrobatico);
    const passo = track.lapLength / track.points.length;
    let dritto = 0;
    for (let k = 1; k < track.points.length; k++) {
        const i = (primoTubo - k + track.points.length) % track.points.length;
        if (track.points[i].acrobatico) break;
        dritto += passo;
    }
    assert.ok(dritto > serve, `prima del giro ci sono ${dritto.toFixed(0)} unita', ne servono ${serve.toFixed(0)}`);
});
```

- [x] **Step 2: Eseguire e vedere fallire**

Run: `node --test backend/tools/f1-crea-pista-loop.test.js`
Expected: FAIL — la pista `loop-prova` non esiste.

- [x] **Step 3: Implementare**

Scrivere `backend/tools/f1-crea-pista-loop.js` sul modello di `backend/tools/f1-crea-pista-banking.js` (**leggerlo prima**: costruisce il contorno, i nodi, i tratti, la corsia box dai campioni veri e scrive il `.json`). Le differenze:

- l'anello è un ovale con **un rettilineo lungo 600 unità** (il conto sopra ne chiede ~50, ma si arriva in curva e si vuole margine);
- a metà di quel rettilineo, **due nodi affiancati** a 30 unità l'uno dall'altro con la stessa direzione, e fra loro il tratto `{ tipo: 'acrobatico', raggio: 25 }`;
- dopo l'uscita il tracciato riprende parallelo, spostato di quelle 30 unità;
- `id: 'loop-prova'`, `name: 'Loop Prova'`.

Poi generarla: `node backend/tools/f1-crea-pista-loop.js`

⚠️ A differenza di `banking-prova` (che nacque non committata e fu aggiunta dopo), questa pista **si committa subito**: i test la caricano.

- [x] **Step 4: Eseguire e vedere passare**

Run: `node --test backend/tools/f1-crea-pista-loop.test.js`
Poi: `node --test backend/` → **8 rossi + 2 skip**. ⚠️ Una pista nuova entra anche nelle suite che scansionano la cartella (scenografia, simulatore): se compaiono rossi nuovi su `loop-prova`, **sono difetti veri di questa fase**, non baseline da aggiornare — annotarli e affrontarli nei task seguenti.

- [x] **Step 5: Commit**

```bash
git add backend/tools/f1-crea-pista-loop.js backend/tools/f1-crea-pista-loop.test.js frontend/tracks/loop-prova.json
git commit -m "Una pista di prova con un giro della morte

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Dentro il tubo la gravità pesa un quarto

**Files:**
- Modify: `backend/sockets/games/physics/GravitaNastro.js` — `accelerazionePendenza`, nuova costante
- Modify: `backend/sockets/games/physics/VehiclePhysics.js:57`
- Modify: `backend/sockets/games/f1GameSocket.js` — `updateTrackIndex` (~riga 2304)
- Test: `backend/sockets/games/physics/GravitaNastro.test.js`

**Interfaces:**
- Produces: `GravitaNastro.G_ACROBATICO` (= `G_NASTRO / 4`), `accelerazionePendenza(pendenza, g)` con `g` opzionale

- [x] **Step 1: Scrivere i test che falliscono**

```js
test('dentro il tubo la gravita\' pesa un quarto', () => {
    const { G_NASTRO, G_ACROBATICO, accelerazionePendenza } = require('./GravitaNastro.js');
    assert.equal(G_ACROBATICO, G_NASTRO / 4);
    assert.ok(Math.abs(accelerazionePendenza(Math.PI / 2, G_ACROBATICO) + G_ACROBATICO) < 1e-12);
    // Senza il secondo argomento non cambia NIENTE per il resto della pista.
    assert.equal(accelerazionePendenza(0.3), accelerazionePendenza(0.3, G_NASTRO));
});

test('col quarto di gravita\' un loop grande resta percorribile', () => {
    const { G_ACROBATICO } = require('./GravitaNastro.js');
    const { MAX_SPEED } = require('./PowertrainModel.js');
    const TrackAcrobatico = require('../../../../frontend/shared/trackAcrobatico.js');
    // Il raggio massimo dichiarato dal modello dei tratti dev'essere davvero
    // percorribile, o il default dell'editor sarebbe una trappola.
    const TrackSegmenti = require('../../../../frontend/shared/trackSegmenti.js');
    assert.ok(TrackAcrobatico.velocitaMinima(TrackSegmenti.RAGGIO_ACROBATICO_MAX, G_ACROBATICO) < MAX_SPEED,
        'il raggio massimo non si completa nemmeno a tavoletta');
});
```

- [x] **Step 2: Eseguire e vedere fallire**

Run: `node --test backend/sockets/games/physics/GravitaNastro.test.js`
Expected: FAIL — `G_ACROBATICO` è `undefined`.

- [x] **Step 3: Implementare**

In `GravitaNastro.js`:

```js
// DENTRO IL GIRO DELLA MORTE LA GRAVITA' PESA UN QUARTO.
//
// Non e' uno sconto estetico, e' il vincolo di energia: salire di due raggi
// costa v² = 4·G·R. Con G a 0.8 il raggio massimo percorribile sarebbe 12 — un
// loop alto quanto la pista e' larga, e per giunta da imboccare a 341 km/h
// esatti per fermarsi giusto in cima. Con G a 0.2 il tetto sale a ~45 e un loop
// di raggio 25 (alto 50, il doppio della larghezza pista) si prende a 246 km/h,
// il 72% del massimo.
//
// L'utente ha scelto cosi' il 2026-08-26 — «io voglio dei loop che idealmente
// possano essere anche grandi» — e la fisica dentro il tubo e' comunque un
// regime dichiarato: l'auto e' incollata al nastro e il fuoripista non esiste.
const G_ACROBATICO = G_NASTRO / 4;

function accelerazionePendenza(pendenza, g) {
    if (typeof pendenza !== 'number' || !isFinite(pendenza)) return 0;
    const peso = (typeof g === 'number' && isFinite(g)) ? g : G_NASTRO;
    return -peso * Math.sin(pendenza);
}
```

⚠️ **Leggere il corpo attuale di `accelerazionePendenza` e conservarne i controlli** (rifiuta `undefined`, `null`, `NaN`, le stringhe: ci sono test apposta). Aggiungere `G_ACROBATICO` all'export.

In `VehiclePhysics.js:57`:

```js
    if (isGravitaNastroActive()) p.speed += accelerazionePendenza(p.pendenza, p.acrobatico ? G_ACROBATICO : undefined);
```

In `updateTrackIndex` (`f1GameSocket.js`), accanto alle righe che portano `pendenza` e `rollio` su `p`:

```js
    // Dentro un giro della morte la gravita' pesa un quarto: il flag viaggia
    // su `p` come gli altri, scritto da un posto solo.
    p.acrobatico = !!track.points[p.trackIndex].acrobatico;
```

- [x] **Step 4: Eseguire e vedere passare**

Run: `node --test backend/sockets/games/physics/GravitaNastro.test.js`
Poi: `node --test backend/` → **8 rossi + 2 skip**.

- [x] **Step 5: Commit**

```bash
git add backend/sockets/games/physics/GravitaNastro.js backend/sockets/games/physics/GravitaNastro.test.js backend/sockets/games/physics/VehiclePhysics.js backend/sockets/games/f1GameSocket.js
git commit -m "Nel giro della morte la gravita' pesa un quarto

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Dentro il tubo comanda il nastro, non la pianta

Il cuore della fase. Fuori dal tubo l'auto si muove in x/z e da lì si ricava il campione; dentro si avanza lungo il nastro e da lì si ricavano x, y, z. L'aggancio avviene quando il campione sotto l'auto diventa acrobatico, lo sgancio quando il giro finisce.

**Files:**
- Create: `backend/sockets/games/physics/TrattoAcrobatico.js`
- Modify: `backend/sockets/games/f1GameSocket.js` — il ciclo di `tickGame` (~righe 2078-2100)
- Test: `backend/sockets/games/physics/TrattoAcrobatico.test.js`

**Interfaces:**
- Consumes: `TrackAcrobatico.frameDi`, `track.points`
- Produces:
  - `TrattoAcrobatico.entrato(p, track)` → `true` se l'auto sta nel tubo
  - `TrattoAcrobatico.avanza(p, track, dt)` → muove `p` lungo il nastro; scrive `p.x/y/z`, `p.trackIndex`, `p.frame`; restituisce `{ uscito: bool }`

- [x] **Step 1: Scrivere i test che falliscono**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const TrattoAcrobatico = require('./TrattoAcrobatico.js');
const { loadTrack } = require('../trackLoader.js');

function autoAllIngresso(track, velocita) {
    const i = track.points.findIndex(p => p.acrobatico);
    const p = track.points[(i - 2 + track.points.length) % track.points.length];
    return { x: p.x, y: p.y || 0, z: p.z, speed: velocita, trackIndex: (i - 2 + track.points.length) % track.points.length };
}

test('con abbastanza velocita\' il giro si completa', () => {
    const track = loadTrack('loop-prova');
    const p = autoAllIngresso(track, 6.0);
    let dentro = false, giri = 0;
    for (let t = 0; t < 2000 && giri < 1; t++) {
        if (TrattoAcrobatico.entrato(p, track)) {
            dentro = true;
            if (TrattoAcrobatico.avanza(p, track, 1).uscito) giri++;
        } else {
            p.trackIndex = (p.trackIndex + 1) % track.points.length;   // fuori dal tubo non e' affar suo
            const q = track.points[p.trackIndex]; p.x = q.x; p.z = q.z; p.y = q.y || 0;
        }
    }
    assert.ok(dentro, 'l\'auto non e\' mai entrata nel tubo');
    assert.equal(giri, 1, 'il giro della morte non si e\' completato');
});

test('in cima l\'auto e\' rovesciata e alta due raggi', () => {
    const track = loadTrack('loop-prova');
    const p = autoAllIngresso(track, 6.0);
    let cima = 0, suInCima = 1;
    for (let t = 0; t < 2000; t++) {
        if (TrattoAcrobatico.entrato(p, track)) {
            if (p.y > cima) { cima = p.y; suInCima = p.frame.su.y; }
            if (TrattoAcrobatico.avanza(p, track, 1).uscito) break;
        } else { p.trackIndex = (p.trackIndex + 1) % track.points.length;
                 const q = track.points[p.trackIndex]; p.x = q.x; p.z = q.z; p.y = q.y || 0; }
    }
    assert.ok(cima > 45, `la cima raggiunta e' ${cima.toFixed(1)}`);
    assert.ok(suInCima < -0.9, 'in cima il tetto dell\'auto deve puntare in giu\'');
});

test('chi arriva piano si ferma e riscende all\'indietro', () => {
    // La decisione 3 della spec: non si cade mai, si torna indietro.
    const track = loadTrack('loop-prova');
    const p = autoAllIngresso(track, 2.0);
    let massima = 0;
    for (let t = 0; t < 600; t++) {
        if (!TrattoAcrobatico.entrato(p, track)) {
            p.trackIndex = (p.trackIndex + 1) % track.points.length;
            const q = track.points[p.trackIndex]; p.x = q.x; p.z = q.z; p.y = q.y || 0;
            continue;
        }
        TrattoAcrobatico.avanza(p, track, 1);
        if (p.y > massima) massima = p.y;
    }
    assert.ok(massima < 45, `con 2.0 u/tick e' arrivato a ${massima.toFixed(1)}: doveva fermarsi prima`);
    assert.ok(p.speed < 0.01, 'chi non ce la fa deve tornare indietro, non restare appeso');
});
```

⚠️ Questi test **non applicano la gravità**: la applica `updateVelocity`, che qui non gira. Nel primo e nel secondo `p.speed` resta costante, ed è quello che serve per provare la geometria dell'avanzamento. Il terzo invece pretende la gravità: chiamare `require('./VehiclePhysics.js')`? **No** — invece, dentro il ciclo del terzo test, sommare a mano `p.speed += accelerazionePendenza(p.pendenza, G_ACROBATICO)` con i due nomi importati da `GravitaNastro.js`, così il test misura l'accoppiata avanzamento+gravità senza tirarsi dentro tutta la fisica del veicolo.

- [x] **Step 2: Eseguire e vedere fallire**

Run: `node --test backend/sockets/games/physics/TrattoAcrobatico.test.js`
Expected: FAIL — modulo inesistente.

- [x] **Step 3: Implementare**

```js
// backend/sockets/games/physics/TrattoAcrobatico.js
//
// DENTRO IL GIRO DELLA MORTE COMANDA IL NASTRO.
//
// Fuori: l'auto si muove in x/z (VehicleMotionModel) e da li' si ricava il
// campione piu' vicino. Dentro non si puo': in cima al loop l'avanzamento
// orizzontale e' zero mentre l'auto va a 200, e allo stesso punto in pianta
// corrispondono la salita e la discesa. Quindi qui si avanza LUNGO il nastro e
// da li' si ricavano x, y, z.
//
// ⚠️ Il cambio di regime e' locale a un tratto. E' la ragione per cui il loop
// non costa la riscrittura del gioco: fuori di qui non cambia niente.
const TrackAcrobatico = require('../../../../frontend/shared/trackAcrobatico.js');

function entrato(p, track) {
    const q = track.points[p.trackIndex];
    return !!(q && q.acrobatico);
}

// Avanza di `p.speed * dt` lungo il nastro. `p.speed` puo' essere negativa: chi
// non ce la fa torna indietro, ed e' voluto (decisione 3 della spec).
function avanza(p, track, dt) {
    const n = track.points.length;
    const passo = track.lapLength / n;
    p.sTubo = (p.sTubo || 0) + p.speed * dt;
    let indice = p.trackIndex;
    while (p.sTubo >= passo) { p.sTubo -= passo; indice = (indice + 1) % n; }
    while (p.sTubo < 0)      { p.sTubo += passo; indice = (indice - 1 + n) % n; }

    const q = track.points[indice];
    p.trackIndex = indice;
    p.x = q.x; p.y = q.y || 0; p.z = q.z;
    p.pendenza = q.pendenza;
    p.acrobatico = !!q.acrobatico;
    p.frame = q.acrobatico ? TrackAcrobatico.frameDi(q) : null;
    // L'auto guarda dove guarda il nastro: l'angolo in pianta serve a tutto il
    // resto del gioco (collisioni, HUD, minimappa) e non deve restare fermo.
    if (p.frame) p.angle = Math.atan2(p.frame.tan.x, p.frame.tan.z);
    // La velocita' in pianta la leggono scia, usura e danni: si tiene coerente
    // con l'avanzamento vero invece di lasciarla all'ultimo valore di fuori.
    p.vx = p.speed * (p.frame ? p.frame.tan.x : 0);
    p.vz = p.speed * (p.frame ? p.frame.tan.z : 0);
    return { uscito: !q.acrobatico };
}

module.exports = { entrato, avanza };
```

Poi in `f1GameSocket.js`, nel ciclo dei sottostep di posizione, separare chi è nel tubo:

```js
    for (let s = 0; s < COLLISION_SUBSTEPS; s++) {
        for (const p of racing) {
            // ⚠️ Chi e' nel tubo non passa da integratePosition: li' la
            // posizione la comanda il nastro. E nemmeno da resolveCollisions o
            // applyBarrier — dentro un giro della morte non c'e' muro da
            // toccare, e due auto nello stesso tubo si urterebbero in pianta
            // anche stando una in cima e una in fondo.
            if (TrattoAcrobatico.entrato(p, game.track)) TrattoAcrobatico.avanza(p, game.track, 1 / COLLISION_SUBSTEPS);
            else integratePosition(p, 1 / COLLISION_SUBSTEPS);
        }
        if (!isQuali) resolveCollisions(players.filter(p => !p.finished && !p.acrobatico));
        for (const p of racing) if (!p.acrobatico) applyBarrier(p, game.track, !isQuali);
    }
```

e nel ciclo successivo, saltare il fuoripista e la ricerca del campione per chi è nel tubo:

```js
    for (const p of racing) {
        const { offTrack, profondita } = p.acrobatico
            ? { offTrack: false, profondita: 0 }        // dentro il tubo non esiste fuoripista
            : applyOffTrackDrag(p, game.track);
        if (!p.acrobatico) updateTrackIndex(p, game.track);
```

⚠️ **`updateTrackIndex` NON va chiamata dentro il tubo**: cerca il campione più vicino in pianta, e lì i campioni si sovrappongono — riporterebbe l'auto sul ramo sbagliato. L'indice lo tiene già `avanza`.

⚠️ Aggiungere `const TrattoAcrobatico = require('./physics/TrattoAcrobatico.js');` in testa a `f1GameSocket.js`, accanto agli altri modelli di fisica, e **leggere i nomi veri delle variabili del ciclo** (`racing`, `players`, `game.track`) prima di scrivere: le righe qui sopra sono la forma attesa, il file è la fonte.

- [x] **Step 4: Eseguire e vedere passare**

Run: `node --test backend/sockets/games/physics/TrattoAcrobatico.test.js`
Poi: `node --test backend/` → **8 rossi + 2 skip**.

- [x] **Step 5: Commit**

```bash
git add backend/sockets/games/physics/TrattoAcrobatico.js backend/sockets/games/physics/TrattoAcrobatico.test.js backend/sockets/games/f1GameSocket.js
git commit -m "Dentro il giro della morte comanda il nastro, non la pianta

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Il tubo si vede

La mesh. Il nastro esiste già come estrusione lungo i campioni: dentro il tubo il profilo va orientato col frame invece che con la normale orizzontale. E il tubo non poggia su niente — terreno, prato, ghiaia e barriere lo saltano, con la stessa regola dei ponti.

**Files:**
- Modify: `frontend/shared/trackMeshBuilder.js` — `buildRibbon` (~riga 61) e `buildCurbs`
- Modify: `frontend/shared/f1Scena.js` — dove si costruisce `groundPts`
- Modify: `frontend/f1.html`, `frontend/track-preview.html`, `frontend/track-editor.html` — bump `?v=`
- Test: `frontend/shared/trackMeshBuilder.test.js`

**Interfaces:**
- Consumes: `TrackAcrobatico.frameDi`

- [x] **Step 1: Scrivere il test che fallisce**

```js
test('il nastro del tubo e\' orientato col frame, non con la normale in pianta', () => {
    // Si misura sulla GEOMETRIA prodotta, non sul codice: i due bordi del
    // nastro in cima al loop devono stare alla stessa quota (il nastro e'
    // rovesciato ma orizzontale) e a un raggio di distanza dal centro.
    const TrackAcrobatico = require('./trackAcrobatico.js');
    const pts = TrackAcrobatico.puntiDelGiro({
        ingresso: { x: 0, y: 0, z: 0 }, uscita: { x: 30, y: 0, z: 0 },
        dirX: 0, dirZ: 1, raggio: 25, passo: 4,
    }).map(p => Object.assign(p, { halfWidth: 11 }));
    const bordi = TrackMeshBuilder.bordiDelNastro(pts, 11);      // vedi Step 3
    const iCima = pts.reduce((best, p, i) => (p.y > pts[best].y ? i : best), 0);
    const [a, b] = bordi[iCima];
    assert.ok(Math.abs(a.y - b.y) < 0.2, `in cima i due bordi stanno a ${a.y.toFixed(1)} e ${b.y.toFixed(1)}`);
    assert.ok(Math.abs(Math.hypot(a.x - b.x, a.z - b.z) - 22) < 0.5,
        'in cima il nastro deve restare largo quanto la pista');
});

test('su una pista piana i bordi del nastro non cambiano di un millimetro', () => {
    const pts = [];
    for (let i = 0; i < 40; i++) pts.push({ x: Math.cos(i / 40 * 6.28) * 200, z: Math.sin(i / 40 * 6.28) * 200, y: 0, halfWidth: 11 });
    const bordi = TrackMeshBuilder.bordiDelNastro(pts, 11);
    for (let i = 0; i < pts.length; i++) {
        const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
        assert.ok(Math.abs(bordi[i][0].x - (pts[i].x + nx * 11)) < 1e-9);
        assert.ok(Math.abs(bordi[i][0].z - (pts[i].z + nz * 11)) < 1e-9);
    }
});
```

- [x] **Step 2: Eseguire e vedere fallire**

Run: `node --test frontend/shared/trackMeshBuilder.test.js`
Expected: FAIL — `bordiDelNastro is not a function`.

- [x] **Step 3: Implementare**

Estrarre da `buildRibbon` il calcolo dei due bordi in una funzione **pura e testabile senza Three.js**, ed è lei a conoscere il tubo:

```js
    // I due bordi del nastro, campione per campione. Estratta da buildRibbon
    // perche' il tubo l'ha resa una decisione vera e propria — e perche' cosi'
    // si puo' provare senza Three.js.
    //
    // ⚠️ Dentro un giro della morte il nastro NON e' orizzontale: il fianco lo
    // dice il frame (TrackAcrobatico.frameDi), non la normale in pianta, che in
    // cima al loop punterebbe da tutt'altra parte.
    function bordiDelNastro(pts, halfW) {
        const out = [];
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const w = (typeof p.halfWidth === 'number' && p.halfWidth > 0) ? p.halfWidth : halfW;
            if (p.acrobatico) {
                const { lat, su } = TrackAcrobatico.frameDi(p);
                const alto = 0.02;
                out.push([
                    { x: p.x + lat.x * w + su.x * alto, y: (p.y || 0) + lat.y * w + su.y * alto, z: p.z + lat.z * w + su.z * alto },
                    { x: p.x - lat.x * w + su.x * alto, y: (p.y || 0) - lat.y * w + su.y * alto, z: p.z - lat.z * w + su.z * alto },
                ]);
                continue;
            }
            const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
            const y = (p.y || 0) + 0.02;
            out.push([
                { x: p.x + nx * w, y: y + TrackGeometry.alzataLaterale(pts, i, w, w), z: p.z + nz * w },
                { x: p.x - nx * w, y: y + TrackGeometry.alzataLaterale(pts, i, w, -w), z: p.z - nz * w },
            ]);
        }
        return out;
    }
```

`buildRibbon` la chiama e riempie i vertici da lì (nessun'altra modifica). Stessa cosa per `buildCurbs`: dove calcola i suoi due bordi, se `p.acrobatico` usa `lat`/`su` del frame.

In `f1Scena.js`, dove nasce `groundPts`, escludere anche il tubo:

```js
        // Il tubo di un giro della morte e' sospeso nel vuoto come un ponte:
        // sotto non c'e' terreno, prato, ghiaia ne' barriere.
        const groundPts = trackPts.filter(p => !p.bridge && !p.acrobatico);
```

⚠️ **Cercare TUTTI i `filter(p => !p.bridge)`** nei moduli condivisi (`sceneryTrackside.js`, `trackScenery.js`, `trackGravel.js`, `f1Scena.js`) e aggiungere `&& !p.acrobatico` a ciascuno: è lo stesso elenco di posti che la fase 1b-2 ha imparato a conoscere. Un test del Task 8 lo verifica sulla pista vera.

- [x] **Step 4: Eseguire e vedere passare**

Run: `node --test frontend/shared/trackMeshBuilder.test.js`
Poi: `node --test frontend/shared/` → **4 rossi**.

- [x] **Step 5: Bump del cache-busting**

`trackMeshBuilder.js`, `f1Scena.js` e il nuovo `trackAcrobatico.js` sono caricati da `f1.html`, `track-preview.html` e `track-editor.html`: aggiungere lo `<script>` del modulo nuovo (**prima** di `f1Scena.js`) e bumpare i `?v=` di quelli toccati.

- [x] **Step 6: Commit**

```bash
git add frontend/shared/trackMeshBuilder.js frontend/shared/trackMeshBuilder.test.js frontend/shared/f1Scena.js frontend/f1.html frontend/track-preview.html frontend/track-editor.html
git commit -m "Il tubo si vede, e sotto non c'e' terra

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: L'auto e la camera si capovolgono

**Files:**
- Modify: `frontend/f1.js` — orientamento dell'auto (~riga 6266, `carGroup.rotation.z = v.roll`) e camera (~righe 5965 e 6020)
- Modify: `frontend/f1.html` — bump `?v=`
- Test: verifica headless (Step 4), più il test di continuità qui sotto

**Interfaces:**
- Consumes: `TrackAcrobatico.frameDi`, `trackPts[idx].acrobatico`

- [x] **Step 1: Scrivere il test che fallisce**

In `frontend/shared/trackAcrobatico.test.js` (il pezzo verificabile senza browser è la matrice di orientamento, che va calcolata in un modulo condiviso e non in `f1.js`):

```js
test('l\'orientamento dell\'auto nel tubo e\' continuo, senza scatti', () => {
    // Tre versori ortogonali per ogni campione: se fra due campioni vicini
    // l'orientamento saltasse, in gioco si vedrebbe l'auto ruotare di colpo.
    const pts = TrackAcrobatico.puntiDelGiro({
        ingresso: { x: 0, y: 0, z: 0 }, uscita: { x: 30, y: 0, z: 0 },
        dirX: 0, dirZ: 1, raggio: 25, passo: 4,
    });
    let precedente = null;
    for (const p of pts) {
        const f = TrackAcrobatico.frameDi(p);
        assert.ok(Math.abs(f.tan.x * f.su.x + f.tan.y * f.su.y + f.tan.z * f.su.z) < 1e-9,
            'tangente e su devono essere perpendicolari');
        if (precedente) {
            const cos = f.tan.x * precedente.tan.x + f.tan.y * precedente.tan.y + f.tan.z * precedente.tan.z;
            assert.ok(cos > 0.9, `l'orientamento salta di ${(Math.acos(cos) * 180 / Math.PI).toFixed(0)} gradi fra due campioni`);
        }
        precedente = f;
    }
});
```

- [x] **Step 2: Eseguire e vedere fallire (o passare)**

Run: `node --test frontend/shared/trackAcrobatico.test.js`
⚠️ Questo test può passare subito: `frameDi` esiste dal Task 2. Se passa, **è una verifica, non un rosso da inseguire** — ma controllare che il caso di prova non sia vuoto (`pts.length > 20`), altrimenti non sta misurando niente.

- [x] **Step 3: Implementare**

In `f1.js`, dove l'auto viene orientata:

```js
            // Dentro un giro della morte l'auto segue il NASTRO: gli angoli
            // separati (imbardata, beccheggio, rollio) non bastano a descrivere
            // un'auto rovesciata, e a meta' salita darebbero gimbal lock.
            const sotto = trackPts[v.idx];
            if (sotto && sotto.acrobatico) {
                const f = TrackAcrobatico.frameDi(sotto);
                const avanti = new THREE.Vector3(f.tan.x, f.tan.y, f.tan.z);
                const su = new THREE.Vector3(f.su.x, f.su.y, f.su.z);
                const destra = new THREE.Vector3().crossVectors(su, avanti);
                carGroup.quaternion.setFromRotationMatrix(
                    new THREE.Matrix4().makeBasis(destra, su, avanti));
            } else {
                carGroup.rotation.z = v.roll;    // com'e' oggi
            }
```

⚠️ **Leggere i nomi veri** (`v.idx`, `v.roll`, `carGroup`, `trackPts`) nel punto in cui si innesta: quelli qui sopra vengono dal codice del banking, ma il file è la fonte. E l'ordine di rotazione (`YXZ`) non va toccato: impostando il quaternione si scavalca, e va ripristinato all'uscita dal tubo — se l'auto resta storta dopo il loop, è questo.

Per la camera, nel punto in cui fa `camera.rotateZ(rollTot)`: quando il campione sotto l'auto è acrobatico, la camera si posiziona dietro l'auto lungo `-tan` e con `up` uguale a `su` del frame, invece che con l'alto del mondo. Senza, in cima al loop la camera resta dritta e l'immagine si ribalta di colpo.

- [x] **Step 4: Guardare la scena**

Ricostruire la sonda headless usata nella fase 1b-2 (una pagina in `frontend/`, Three locale, Chrome `--headless=new --enable-unsafe-swiftshader --screenshot`, servita da un server statico) e guardare il tubo di `loop-prova` da fuori e dall'interno. **Poi cancellarla dal repo.**

- [x] **Step 5: Commit**

```bash
git add frontend/f1.js frontend/f1.html frontend/shared/trackAcrobatico.test.js
git commit -m "L'auto e la camera si capovolgono nel giro della morte

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Un giro completo, e nessuna regressione

- [x] **Step 1: Il bot completa il giro della morte**

Con `backend/tools/f1LapSimulator.js` (⚠️ è rumoroso: **N=30, mai un run singolo** — vedi il suo test) far girare `loop-prova` e pretendere che il giro si chiuda. Se il bot si ferma nel tubo, il difetto è la velocità d'ingresso: annotarlo come voce per la fase 2b (il bot che non frena prima del loop), **non** alzare la gravità.

- [x] **Step 2: Le piste vere sono intatte**

```bash
node --test frontend/shared/    # 4 rossi, la baseline
node --test backend/            # 8 rossi + 2 skip, la baseline
```

Più il confronto esplicito, con lo stesso schema usato nella 1b-2 (`git show <commit-prima>:file > __vecchio.js`, si confrontano i due risultati e poi si cancella il file): su `prova`, `melbourne`, `suzuka`, `new-monza`, `monte-rosso`, `shanghai` e `banking-prova` i campioni della pista devono essere **identici al bit**.

- [x] **Step 3: Consegnare il playtest**

Dire all'utente: come avviare (`node server.js` dal worktree, hard refresh), su quale pista (**Loop Prova**), cosa guardare — si arriva lanciati, si sale, ci si rovescia, si esce di fianco — e le domande: **il loop si sente giusto o è troppo facile/impossibile? La camera in cima confonde o no? Le dimensioni del tubo sono quelle del tuo disegno?**

⚠️ **Non dichiarare chiusa la fase 2a prima del suo giudizio.**

---

## Verifiche finali (prima di dichiarare chiusa la 2a)

- [x] `node --test frontend/shared/` → 4 rossi; `node --test backend/` → 8 rossi + 2 skip
- [x] Le sette piste esistenti danno campioni identici al bit
- [x] `loop-prova` si completa: il giro della morte si percorre e si esce di fianco
- [x] `git status` non mostra file dell'utente fra quelli committati, né la sonda headless

---

## Com'è andata (2026-08-26)

Nove task, `2c0fe64` → `1735b73`. Baseline test invariata: **4 rossi frontend**
(più uno noto su `loop-prova`, sotto) e **8 rossi + skip backend**.

### Le quattro cose che il piano non prevedeva

1. **La direzione del tubo viene dal NODO, non dai campioni.** In pianta un
   tratto acrobatico è un segmento *trasversale* alla marcia — collega ingresso
   e uscita affiancati — quindi lì la spline sta già girando verso l'uscita:
   misurata sui campioni, la direzione d'ingresso veniva `(1.90, 0.92)` invece
   di `(0, 1)`, e il loop partiva storto di 64 gradi.

2. **Server e client si campionavano la pista per conto proprio.** Col tubo in
   mezzo i due vedevano circuiti diversi, e si è visto da tre sintomi con una
   causa sola: il muro del server a 18.32 dove il client lo disegnava a 18.37,
   la griglia che dichiarava un indice a 33 campioni da dove l'auto stava
   davvero, la scenografia cotta diversa da quella del gioco. Ora esiste
   `TrackAcrobatico.campionaPista`, e ci passano entrambi.

3. **In pianta il tubo si sovrappone al rettilineo da cui parte.** Cercare «il
   campione più vicino» fra tutti i punti può quindi agganciare un'auto che
   corre sull'asfalto a un pezzo di pista venti metri sopra di lei. Il
   caricatore espone `track.groundPoints` e il fuoripista cerca lì.

4. **Uscire non è completare.** Dal tubo si esce anche all'indietro — chi arriva
   piano si ferma in salita e riscende — e `avanza` deve dirlo, o si conta come
   giro fatto chi non ce l'ha fatta.

### Visto con la sonda headless

Il tubo c'è ed è quello del disegno: cerchio verticale alto 50, cordoli lungo i
due bordi, ingresso dal rettilineo e uscita affiancata. Due difetti trovati
guardando e corretti subito: il prato saliva **dentro** il loop (il terreno si
costruiva su tutti i campioni, tubo compreso) e l'auto in cima ora è appesa
sotto il nastro, come dev'essere.

### Aperto, per la fase 2b

- ⚠️ `loop-prova` viene **saltata dai test del simulatore di giri**: la pendenza
  dentro il tubo supera il limite di `GravitaNastro.pistaPercorribile`, che non
  sa ancora del regime acrobatico. Il bot infatti non sa percorrere il loop.
- ⚠️ Un rosso noto: *«scenografia: tribune e reti restano parallele al muro
  (loop-prova)»*. Una tribuna posata di fianco al rettilineo viene associata a
  un campione **del tubo** — sono sovrapposti in pianta — e giudicata storta di
  83°. È la stessa causa del punto 3, nella catena della scenografia: si chiude
  facendo lavorare anche lei sui punti a terra. Non tocca nessuna pista vera.
