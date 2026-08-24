# F1 — L'editor disegna segmenti Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dare all'editor un modello in cui una retta è una retta e una curva ha dei numeri, senza che il gioco debba sapere niente.

**Architecture:** un modulo puro (`frontend/shared/trackSegmenti.js`) trasforma una **geometria** — nodi con tangente, tratti tipizzati — in `controlPoints` fitti. L'editor tiene la geometria come stato e ricalcola i punti ad ogni modifica; il file `.json` porta entrambi; il gioco continua a leggere solo i punti.

**Tech Stack:** JS vanilla UMD (stesso schema di `frontend/shared/*.js`), Three.js r128 già presente nell'editor, `node --test` nativo.

**Spec:** `docs/superpowers/specs/2026-08-24-f1-editor-segmenti-design.md`

## Global Constraints

- **Il gioco non cambia di una riga**: nessuna modifica a `trackLoader`, fisica, bot, scenografia. L'unica modifica al backend è la validazione del campo nuovo e un endpoint di sola lettura.
- **Italiano** in commenti, nomi di funzione e messaggi (convenzione del progetto).
- I moduli in `frontend/shared/` sono **UMD** e **puri**: niente DOM, niente Three.js — altrimenti `node --test` non li carica.
- `dir` è un angolo assoluto in radianti con la convenzione `Math.atan2(dx, dz)`, la stessa di `TrackGeometry.tangentAt`.
- Passo di cottura: **5 unità**.
- Test frontend: `node --test frontend/shared/` (⚠️ `node --test backend/` NON li esegue).
- Baseline dei rossi da non peggiorare: **4** in `frontend/shared/`, **8** in `backend/` — tutti preesistenti.
- Ogni task finisce con un commit. Mai `git add -A`: aggiungere i file per nome (l'utente lavora in parallelo sugli stessi alberi).
- Ogni modifica a un `.js` caricato da una pagina richiede il bump del `?v=` in quella pagina.

---

## File Structure

| File | Responsabilità |
|---|---|
| `frontend/shared/trackSegmenti.js` (nuovo) | Il modello: cottura geometria → punti, misure sui tratti, operazioni (raddrizza, imposta lunghezza, direzione automatica). Puro. |
| `frontend/shared/trackSegmenti.test.js` (nuovo) | Test del modulo, incluso quello di sistema (cotta + `sampleLoop` = forma disegnata). |
| `frontend/track-editor.js` (modifica) | Stato `geometria`, disegno nodi/maniglie, pannello numerico, undo/redo, salvataggio. |
| `frontend/track-editor.html` (modifica) | Controlli nuovi: modalità, riquadro tratto, abrasività, giri, trasparenza. |
| `backend/sockets/games/trackLoader.js` (modifica) | Validazione di `geometria` in `validateTrackData`. |
| `backend/routes/lobbyRoutes.js` (modifica) | `GET /api/f1/giri-per-mescola`. |

---

### Task 1: Il modulo che cuoce la geometria in punti

**Files:**
- Create: `frontend/shared/trackSegmenti.js`
- Test: `frontend/shared/trackSegmenti.test.js`

**Interfaces:**
- Consumes: niente (modulo foglia).
- Produces: `TrackSegmenti.cuoci(geometria, passo = 5)` → `[{x, z, y, bridge}]`; `TrackSegmenti.PASSO_COTTURA = 5`.

Struttura di `geometria`: `{ versione: 1, nodi: [{x, z, y, bridge, dir}], tratti: [{tipo: 'retta'|'curva'}] }`. `tratti[i]` collega `nodi[i]` a `nodi[i+1]`, l'ultimo chiude sul primo, quindi `tratti.length === nodi.length`.

- [ ] **Step 1: Scrivere il test che fallisce**

```javascript
// frontend/shared/trackSegmenti.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const TS = require('./trackSegmenti.js');

// Un quadrato con gli angoli arrotondati: quattro rette e quattro curve.
// E' la forma minima che prova insieme rette, curve e chiusura.
function quadrato() {
    const R = 100;
    const nodi = [
        { x: -R, z: -R, y: 0, dir: Math.atan2(1, 0) },
        { x:  R, z: -R, y: 0, dir: Math.atan2(0, 1) },
        { x:  R, z:  R, y: 0, dir: Math.atan2(-1, 0) },
        { x: -R, z:  R, y: 0, dir: Math.atan2(0, -1) },
    ];
    return { versione: 1, nodi, tratti: [
        { tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'retta' }, { tipo: 'curva' },
    ] };
}

test('cuoci: una retta produce punti allineati', () => {
    const g = { versione: 1,
        nodi: [
            { x: 0, z: 0, y: 0, dir: Math.atan2(1, 0) },
            { x: 100, z: 0, y: 0, dir: Math.atan2(1, 0) },
            { x: 100, z: 50, y: 0, dir: Math.atan2(0, 1) },
        ],
        tratti: [{ tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'curva' }] };
    const punti = TS.cuoci(g, 5);
    // I punti del PRIMO tratto (fino al nodo 1) devono stare sulla retta z=0.
    const suRetta = punti.filter(p => p.x >= 0 && p.x <= 100 && Math.abs(p.z) < 1e-6);
    assert.ok(suRetta.length >= 19, `attesi almeno 19 punti sulla retta, trovati ${suRetta.length}`);
});

test('cuoci: il passo richiesto viene rispettato', () => {
    const punti = TS.cuoci(quadrato(), 5);
    for (let i = 0; i < punti.length; i++) {
        const a = punti[i], b = punti[(i + 1) % punti.length];
        const d = Math.hypot(b.x - a.x, b.z - a.z);
        assert.ok(d <= 5.5, `passo ${d.toFixed(2)} fra i punti ${i} e ${i + 1}, atteso <= 5.5`);
    }
});

test('cuoci: la catena chiude sul primo nodo', () => {
    const g = quadrato();
    const punti = TS.cuoci(g, 5);
    const primo = punti[0], ultimo = punti[punti.length - 1];
    assert.ok(Math.hypot(primo.x - g.nodi[0].x, primo.z - g.nodi[0].z) < 1e-6,
        'il primo punto cotto deve essere il primo nodo');
    const chiusura = Math.hypot(ultimo.x - primo.x, ultimo.z - primo.z);
    assert.ok(chiusura > 0 && chiusura <= 5.5, `l'ultimo punto dista ${chiusura.toFixed(2)} dal primo`);
});

test('cuoci: ogni tratto arriva tangente al nodo, con la direzione del nodo', () => {
    const g = quadrato();
    const punti = TS.cuoci(g, 5);
    for (const nodo of g.nodi) {
        // il punto cotto che coincide col nodo, e il successivo
        let k = -1;
        for (let i = 0; i < punti.length; i++) {
            if (Math.hypot(punti[i].x - nodo.x, punti[i].z - nodo.z) < 1e-6) { k = i; break; }
        }
        assert.ok(k >= 0, `il nodo (${nodo.x}, ${nodo.z}) deve comparire fra i punti cotti`);
        const dopo = punti[(k + 1) % punti.length];
        const dirUscita = Math.atan2(dopo.x - punti[k].x, dopo.z - punti[k].z);
        const scarto = Math.abs(Math.atan2(Math.sin(dirUscita - nodo.dir), Math.cos(dirUscita - nodo.dir)));
        assert.ok(scarto < 0.02, `uscita dal nodo a ${scarto.toFixed(3)} rad dalla sua direzione`);
    }
});

test('cuoci: quota e ponte si propagano ai punti intermedi', () => {
    const g = {
        versione: 1,
        nodi: [
            { x: 0, z: 0, y: 0, bridge: true, dir: Math.atan2(1, 0) },
            { x: 100, z: 0, y: 10, bridge: true, dir: Math.atan2(1, 0) },
            { x: 100, z: 80, y: 0, bridge: false, dir: Math.atan2(0, 1) },
        ],
        tratti: [{ tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'curva' }],
    };
    const punti = TS.cuoci(g, 5);
    const meta = punti.find(p => Math.abs(p.x - 50) < 3 && Math.abs(p.z) < 1e-6);
    assert.ok(meta, 'deve esistere un punto a meta della prima retta');
    assert.ok(Math.abs(meta.y - 5) < 0.6, `quota interpolata ${meta.y.toFixed(2)}, attesa ~5`);
    assert.equal(meta.bridge, true, 'fra due nodi ponte, il punto e ponte');
    const dopo = punti.find(p => Math.abs(p.x - 100) < 3 && p.z > 20 && p.z < 60);
    assert.ok(dopo, 'deve esistere un punto sul tratto successivo');
    assert.equal(!!dopo.bridge, false, 'con un solo nodo ponte, il punto non e ponte');
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test frontend/shared/trackSegmenti.test.js`
Expected: FAIL — `Cannot find module './trackSegmenti.js'`

- [ ] **Step 3: Scrivere il modulo**

```javascript
// frontend/shared/trackSegmenti.js
//
// Il MODELLO del tracciato come lo disegna l'autore: nodi con una direzione
// e tratti tipizzati. Da qui nascono i `controlPoints` che il gioco legge —
// il gioco non conosce questo file, e non deve.
//
// PERCHE' ESISTE. Fino al 2026-08-24 il .json conteneva il RISULTATO (dove
// passa la pista) e non l'INTENZIONE (cos'e' quel pezzo di pista): da li'
// venivano, tutte insieme, le rette mai dritte, le curve senza raggio e
// l'impossibilita' di spostare un rettilineo intero. Un'interfaccia non puo'
// restituire un'informazione che il dato non contiene.
// Rif. docs/superpowers/specs/2026-08-24-f1-editor-segmenti-design.md
//
// LA TANGENZA NON SI MANTIENE, si eredita: la direzione appartiene al NODO e
// i due tratti che vi si incontrano la leggono dallo stesso posto. Non esiste
// uno stato in cui due tratti adiacenti puntano in direzioni diverse.
//
// Modulo PURO: niente Three.js, niente DOM.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TrackSegmenti = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Un punto ogni 5 unita': fra punti cosi' ravvicinati la Catmull-Rom del
    // gioco non devia dalla forma disegnata (misurato dal test di sistema:
    // scostamento massimo ben sotto 0.2 unita').
    const PASSO_COTTURA = 5;

    // Versore della direzione di un nodo. Convenzione del progetto:
    // dir = atan2(dx, dz), quindi dx = sin(dir) e dz = cos(dir).
    function versore(dir) {
        return { dx: Math.sin(dir || 0), dz: Math.cos(dir || 0) };
    }

    function distanza(a, b) {
        return Math.hypot(b.x - a.x, b.z - a.z);
    }

    // Punti di una Bezier cubica costruita sulle due tangenti: e' la curva
    // piu' semplice che passa per i due nodi rispettando la direzione di
    // entrambi. Le maniglie a un terzo della corda danno la curva piu' vicina
    // all'arco di cerchio senza casi degeneri.
    //
    // ⚠️ Non ha raggio COSTANTE: la curvatura varia lungo il tratto. Se
    // servisse (validatore, banking), qui dentro si sostituisce un biarco
    // senza toccare il modello — e' l'unica funzione da cambiare.
    function valutaCurva(a, b, t) {
        const d = distanza(a, b) / 3;
        const va = versore(a.dir), vb = versore(b.dir);
        const p1 = { x: a.x + va.dx * d, z: a.z + va.dz * d };
        const p2 = { x: b.x - vb.dx * d, z: b.z - vb.dz * d };
        const u = 1 - t;
        const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
        return {
            x: a.x * w0 + p1.x * w1 + p2.x * w2 + b.x * w3,
            z: a.z * w0 + p1.z * w1 + p2.z * w2 + b.z * w3,
        };
    }

    function valutaTratto(a, b, tratto, t) {
        if (tratto && tratto.tipo === 'retta') {
            return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
        }
        return valutaCurva(a, b, t);
    }

    // Campiona un tratto a passo costante di LUNGHEZZA D'ARCO, non di
    // parametro: su una Bezier il parametro corre piu' veloce in mezzo alla
    // curva, e campionarlo direttamente darebbe punti fitti agli estremi e
    // radi al centro. Stessa tecnica di TrackGeometry.resample.
    function campionaTratto(a, b, tratto, passo) {
        const FINE = 200;
        const fini = [];
        for (let i = 0; i <= FINE; i++) fini.push(valutaTratto(a, b, tratto, i / FINE));
        const cum = [0];
        for (let i = 1; i < fini.length; i++) cum.push(cum[i - 1] + distanza(fini[i - 1], fini[i]));
        const totale = cum[cum.length - 1];
        const quanti = Math.max(1, Math.round(totale / passo));

        const out = [];
        for (let s = 0; s < quanti; s++) {
            const bersaglio = (s / quanti) * totale;
            let lo = 1;
            while (lo < cum.length - 1 && cum[lo] < bersaglio) lo++;
            const segLen = cum[lo] - cum[lo - 1] || 1e-9;
            const f = (bersaglio - cum[lo - 1]) / segLen;
            const p = fini[lo - 1], q = fini[lo];
            const frazione = totale > 0 ? bersaglio / totale : 0;
            // Quota lineare e ponte solo fra due nodi che lo sono ENTRAMBI:
            // la stessa regola che TrackGeometry.evalSegment applica gia' oggi
            // ai punti di controllo, cosi' i punti di transizione (la rampa)
            // restano a terra.
            const voce = {
                x: p.x + (q.x - p.x) * f,
                z: p.z + (q.z - p.z) * f,
                y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * frazione,
            };
            if (a.bridge && b.bridge) voce.bridge = true;
            out.push(voce);
        }
        return out;
    }

    // Geometria -> punti di controllo. Il primo punto di ogni tratto E' il suo
    // nodo di partenza; il nodo di arrivo lo mette il tratto successivo, cosi'
    // nessun punto compare due volte e la catena resta chiusa.
    function cuoci(geometria, passo) {
        if (!geometria || !Array.isArray(geometria.nodi) || geometria.nodi.length < 3) {
            throw new Error('Servono almeno 3 nodi');
        }
        const nodi = geometria.nodi;
        const tratti = geometria.tratti || [];
        const step = passo || PASSO_COTTURA;
        const out = [];
        for (let i = 0; i < nodi.length; i++) {
            const a = nodi[i], b = nodi[(i + 1) % nodi.length];
            out.push(...campionaTratto(a, b, tratti[i] || { tipo: 'curva' }, step));
        }
        return out;
    }

    return { cuoci, valutaTratto, versore, PASSO_COTTURA };
});
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test frontend/shared/trackSegmenti.test.js`
Expected: PASS, 5 test.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/trackSegmenti.js frontend/shared/trackSegmenti.test.js
git commit -m "Il modello: nodi con una direzione, tratti tipizzati"
```

---

### Task 2: La prova che il gioco vede la forma disegnata

**Files:**
- Modify: `frontend/shared/trackSegmenti.test.js`

**Interfaces:**
- Consumes: `TrackSegmenti.cuoci`, `TrackGeometry.sampleLoop`.
- Produces: niente codice nuovo — è la verifica che giustifica l'intero impianto.

Questo task non aggiunge funzionalità: misura che la catena `geometria → controlPoints → sampleLoop` non deformi la pista. Se fallisse, il modello non servirebbe a niente e il passo di cottura andrebbe stretto.

- [ ] **Step 1: Scrivere il test**

```javascript
const TrackGeometry = require('./trackGeometry.js');

test('la forma che il GIOCO vede coincide con quella disegnata', () => {
    // Una pista con curve strette e rettilinei lunghi: e' dove un passo di
    // cottura troppo largo si vedrebbe.
    const g = { versione: 1, nodi: [
        { x: -200, z: -120, y: 0, dir: Math.atan2(1, 0) },
        { x:  200, z: -120, y: 0, dir: Math.atan2(1, 0) },
        { x:  260, z:  -40, y: 0, dir: Math.atan2(0, 1) },
        { x:  120, z:   90, y: 0, dir: Math.atan2(-1, 0.2) },
        { x: -160, z:  110, y: 0, dir: Math.atan2(-1, -0.4) },
    ], tratti: [
        { tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'curva' },
        { tipo: 'curva' }, { tipo: 'curva' },
    ] };

    const cotti = TrackSegmentiCuociPerTest(g);
    // Esattamente cio' che fa il gioco: backend/sockets/games/trackLoader.js
    const visti = TrackGeometry.sampleLoop(cotti, 1000);

    // Per ogni punto che il gioco vede, quanto dista dalla curva disegnata?
    // Si confronta col punto cotto piu' vicino: i cotti campionano la forma
    // vera a 5 unita', quindi sono un riferimento fedele.
    let peggio = 0;
    for (const v of visti) {
        let minimo = Infinity;
        for (const c of cotti) {
            const d = Math.hypot(v.x - c.x, v.z - c.z);
            if (d < minimo) minimo = d;
        }
        if (minimo > peggio) peggio = minimo;
    }
    assert.ok(peggio < 0.2,
        `il gioco vede una forma scostata di ${peggio.toFixed(3)} unita dalla disegnata, tetto 0.2`);
});

function TrackSegmentiCuociPerTest(g) {
    return TS.cuoci(g, TS.PASSO_COTTURA);
}
```

- [ ] **Step 2: Eseguirlo**

Run: `node --test frontend/shared/trackSegmenti.test.js`
Expected: PASS. Se fallisse, **non** allargare la soglia: stringere `PASSO_COTTURA` (3 unità) e rimisurare — la soglia è il requisito, il passo è la leva.

- [ ] **Step 3: Commit**

```bash
git add frontend/shared/trackSegmenti.test.js
git commit -m "La misura che giustifica l'impianto: il gioco vede la forma disegnata"
```

---

### Task 3: Misure e operazioni sui tratti

**Files:**
- Modify: `frontend/shared/trackSegmenti.js`
- Modify: `frontend/shared/trackSegmenti.test.js`

**Interfaces:**
- Produces:
  - `misureTratto(geometria, i)` → `{ lunghezza, angolo, raggioMinimo }` (`angolo` in radianti, con segno; `raggioMinimo` è `Infinity` per una retta)
  - `raddrizza(geometria, i)` → nuova geometria col tratto `i` retto e le tangenti dei suoi due nodi allineate
  - `direzioneAutomatica(geometria, i)` → l'angolo che il nodo `i` avrebbe seguendo i vicini
  - `impostaLunghezza(geometria, i, lunghezza)` → nuova geometria col nodo di ARRIVO spostato

⚠️ **La regola scoperta scrivendo il piano.** `raddrizza` impone la direzione ai due nodi del tratto. Se un tratto adiacente era anch'esso `retta` e non è più allineato, quel nodo avrebbe due direzioni diverse — stato impossibile nel modello. Quindi `raddrizza` **converte in `curva` il tratto adiacente che perde l'allineamento** (tolleranza 0.001 rad). Due rettilinei consecutivi non allineati sono uniti da una curva in ogni circuito reale: il modello lo rende vero per costruzione invece di lasciarlo alla disciplina di chi disegna.

- [ ] **Step 1: Scrivere i test che falliscono**

```javascript
test('misureTratto: una retta ha la lunghezza della corda e raggio infinito', () => {
    const g = { versione: 1, nodi: [
        { x: 0, z: 0, y: 0, dir: Math.atan2(1, 0) },
        { x: 100, z: 0, y: 0, dir: Math.atan2(1, 0) },
        { x: 100, z: 90, y: 0, dir: Math.atan2(0, 1) },
    ], tratti: [{ tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'curva' }] };
    const m = TS.misureTratto(g, 0);
    assert.ok(Math.abs(m.lunghezza - 100) < 0.01, `lunghezza ${m.lunghezza}`);
    assert.equal(m.raggioMinimo, Infinity);
    assert.ok(Math.abs(m.angolo) < 1e-9, 'una retta non gira');
});

test('misureTratto: una curva a gomito ha angolo 90 gradi e raggio finito', () => {
    const g = { versione: 1, nodi: [
        { x: 0, z: 0, y: 0, dir: Math.atan2(1, 0) },
        { x: 100, z: 0, y: 0, dir: Math.atan2(1, 0) },
        { x: 200, z: 100, y: 0, dir: Math.atan2(0, 1) },
    ], tratti: [{ tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'curva' }] };
    const m = TS.misureTratto(g, 1);
    assert.ok(Math.abs(Math.abs(m.angolo) - Math.PI / 2) < 0.01, `angolo ${m.angolo}`);
    assert.ok(m.raggioMinimo > 10 && m.raggioMinimo < 200, `raggio minimo ${m.raggioMinimo}`);
});

test('raddrizza: allinea le tangenti dei due nodi del tratto', () => {
    const g = { versione: 1, nodi: [
        { x: 0, z: 0, y: 0, dir: 1.2 },
        { x: 100, z: 0, y: 0, dir: -0.4 },
        { x: 100, z: 90, y: 0, dir: Math.atan2(0, 1) },
    ], tratti: [{ tipo: 'curva' }, { tipo: 'curva' }, { tipo: 'curva' }] };
    const dopo = TS.raddrizza(g, 0);
    const atteso = Math.atan2(100, 0);
    assert.equal(dopo.tratti[0].tipo, 'retta');
    assert.ok(Math.abs(dopo.nodi[0].dir - atteso) < 1e-9);
    assert.ok(Math.abs(dopo.nodi[1].dir - atteso) < 1e-9);
    assert.notEqual(g.nodi[0].dir, dopo.nodi[0].dir, 'la geometria di partenza non va mutata');
});

test('raddrizza: un tratto retto adiacente che perde l allineamento diventa curva', () => {
    // Due rette ad angolo retto: il nodo in mezzo non puo' avere due direzioni.
    const g = { versione: 1, nodi: [
        { x: 0, z: 0, y: 0, dir: Math.atan2(1, 0) },
        { x: 100, z: 0, y: 0, dir: Math.atan2(1, 0) },
        { x: 100, z: 100, y: 0, dir: Math.atan2(0, 1) },
        { x: 0, z: 100, y: 0, dir: Math.atan2(-1, 0) },
    ], tratti: [{ tipo: 'retta' }, { tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'curva' }] };
    const dopo = TS.raddrizza(g, 0);
    assert.equal(dopo.tratti[0].tipo, 'retta');
    assert.equal(dopo.tratti[1].tipo, 'curva', 'il tratto adiacente non allineato cede');
});

test('impostaLunghezza: sposta il nodo di arrivo e nessun altro', () => {
    const g = { versione: 1, nodi: [
        { x: 0, z: 0, y: 0, dir: Math.atan2(1, 0) },
        { x: 100, z: 0, y: 0, dir: Math.atan2(1, 0) },
        { x: 100, z: 90, y: 0, dir: Math.atan2(0, 1) },
    ], tratti: [{ tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'curva' }] };
    const dopo = TS.impostaLunghezza(g, 0, 140);
    assert.ok(Math.abs(dopo.nodi[1].x - 140) < 0.01, `nodo di arrivo a x=${dopo.nodi[1].x}`);
    assert.equal(dopo.nodi[0].x, 0, 'il nodo di partenza non si muove');
    assert.equal(dopo.nodi[2].x, 100, 'i nodi successivi non si muovono');
});

test('direzioneAutomatica: un nodo segue i suoi vicini', () => {
    const g = { versione: 1, nodi: [
        { x: -100, z: 0, y: 0, dir: 0 },
        { x: 0, z: 0, y: 0, dir: 0 },
        { x: 100, z: 0, y: 0, dir: 0 },
    ], tratti: [{ tipo: 'curva' }, { tipo: 'curva' }, { tipo: 'curva' }] };
    // Vicini allineati lungo +x: la direzione e' atan2(1, 0).
    assert.ok(Math.abs(TS.direzioneAutomatica(g, 1) - Math.atan2(1, 0)) < 1e-9);
});
```

- [ ] **Step 2: Eseguirli e vederli fallire**

Run: `node --test frontend/shared/trackSegmenti.test.js`
Expected: FAIL — `TS.misureTratto is not a function`

- [ ] **Step 3: Implementare**

```javascript
    // --- Misure -----------------------------------------------------------
    // I numeri che l'editor mostra e che l'autore riscrive a mano.
    //
    // ⚠️ `raggioMinimo` e non «il raggio»: una Bezier ha curvatura variabile,
    // e il numero che conta a chi guida — e domani al validatore — e' il punto
    // piu' stretto del tratto.
    function misureTratto(geometria, i) {
        const nodi = geometria.nodi;
        const a = nodi[i], b = nodi[(i + 1) % nodi.length];
        const tratto = (geometria.tratti || [])[i] || { tipo: 'curva' };
        if (tratto.tipo === 'retta') {
            return { lunghezza: distanza(a, b), angolo: 0, raggioMinimo: Infinity };
        }
        const FINE = 100;
        const p = [];
        for (let k = 0; k <= FINE; k++) p.push(valutaTratto(a, b, tratto, k / FINE));
        let lunghezza = 0;
        for (let k = 1; k < p.length; k++) lunghezza += distanza(p[k - 1], p[k]);
        // Raggio del cerchio per tre punti consecutivi: R = (abc) / (4 * area).
        let raggioMinimo = Infinity;
        for (let k = 1; k < p.length - 1; k++) {
            const A = p[k - 1], B = p[k], C = p[k + 1];
            const la = distanza(B, C), lb = distanza(A, C), lc = distanza(A, B);
            const area2 = Math.abs((B.x - A.x) * (C.z - A.z) - (C.x - A.x) * (B.z - A.z));
            if (area2 < 1e-9) continue;   // tre punti allineati: raggio infinito
            const R = (la * lb * lc) / (2 * area2);
            if (R < raggioMinimo) raggioMinimo = R;
        }
        const angolo = Math.atan2(Math.sin(b.dir - a.dir), Math.cos(b.dir - a.dir));
        return { lunghezza, angolo, raggioMinimo };
    }

    // --- Operazioni -------------------------------------------------------
    // Tutte RESTITUISCONO una geometria nuova e non mutano quella ricevuta:
    // e' cio' che rende l'undo dell'editor uno stack di stati invece di una
    // lista di modifiche da saper disfare una per una.
    function copia(geometria) {
        return {
            versione: geometria.versione || 1,
            nodi: geometria.nodi.map(n => Object.assign({}, n)),
            tratti: (geometria.tratti || []).map(t => Object.assign({}, t)),
        };
    }

    const TOLLERANZA_ALLINEAMENTO = 0.001;   // rad

    function scartoAngolare(a, b) {
        return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    }

    function raddrizza(geometria, i) {
        const g = copia(geometria);
        const n = g.nodi.length;
        const j = (i + 1) % n;
        const dir = Math.atan2(g.nodi[j].x - g.nodi[i].x, g.nodi[j].z - g.nodi[i].z);
        g.nodi[i].dir = dir;
        g.nodi[j].dir = dir;
        g.tratti[i] = { tipo: 'retta' };

        // ⚠️ UN NODO, UNA DIREZIONE. Un tratto retto adiacente che non e' piu'
        // allineato pretenderebbe dal nodo condiviso una direzione diversa da
        // questa: stato impossibile nel modello, quindi cede lui e diventa
        // curva. In un circuito vero due rettilinei consecutivi non allineati
        // sono sempre uniti da una curva.
        for (const [k, altro] of [[(i - 1 + n) % n, i], [j, j]]) {
            if (k === i || !g.tratti[k] || g.tratti[k].tipo !== 'retta') continue;
            const da = g.nodi[k], a2 = g.nodi[(k + 1) % n];
            const dirAltro = Math.atan2(a2.x - da.x, a2.z - da.z);
            if (scartoAngolare(dirAltro, dir) > TOLLERANZA_ALLINEAMENTO) {
                g.tratti[k] = { tipo: 'curva' };
            }
        }
        return g;
    }

    function impostaLunghezza(geometria, i, lunghezza) {
        const g = copia(geometria);
        const n = g.nodi.length;
        const a = g.nodi[i], b = g.nodi[(i + 1) % n];
        const dir = Math.atan2(b.x - a.x, b.z - a.z);
        const v = versore(dir);
        b.x = a.x + v.dx * lunghezza;
        b.z = a.z + v.dz * lunghezza;
        return g;
    }

    // La direzione che un nodo avrebbe seguendo i vicini: la stessa forma che
    // produce oggi la Catmull-Rom, quindi posare nodi da' il risultato che
    // l'autore si aspetta finche' non tocca le maniglie.
    function direzioneAutomatica(geometria, i) {
        const nodi = geometria.nodi, n = nodi.length;
        const prima = nodi[(i - 1 + n) % n], dopo = nodi[(i + 1) % n];
        return Math.atan2(dopo.x - prima.x, dopo.z - prima.z);
    }
```

Aggiungere all'export: `misureTratto, raddrizza, impostaLunghezza, direzioneAutomatica`.

- [ ] **Step 4: Eseguire i test**

Run: `node --test frontend/shared/trackSegmenti.test.js`
Expected: PASS, 12 test.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/trackSegmenti.js frontend/shared/trackSegmenti.test.js
git commit -m "Le misure di un tratto, e un nodo con una direzione sola"
```

---

### Task 4: L'editor disegna in modalità segmenti

**Files:**
- Modify: `frontend/track-editor.html` (caricare il modulo, aggiungere il riquadro modalità)
- Modify: `frontend/track-editor.js:142-160` (stato), `:315-390` (rebuild), `:507-553` (mousedown), `:711-757` (applyTrackData), `:845-862` (buildTrackData)

**Interfaces:**
- Consumes: `TrackSegmenti.cuoci`, `TrackSegmenti.direzioneAutomatica`.
- Produces: nel modulo editor — `geometria` (null = modalità punti), `rigeneraDaGeometria()` che riempie `mainPoints`.

- [ ] **Step 1: Caricare il modulo nella pagina**

In `frontend/track-editor.html`, accanto agli altri `shared/`:

```html
<script src="shared/trackSegmenti.js?v=20260824a"></script>
```

- [ ] **Step 2: Lo stato**

In `frontend/track-editor.js`, accanto a `mainPoints`/`pitPoints`:

```javascript
    // LA GEOMETRIA: nodi con una direzione, tratti tipizzati. Quando c'e',
    // `mainPoints` non si modifica a mano — e' il suo prodotto cotto, e
    // toccarlo darebbe due verita' per la stessa cosa (la seconda andrebbe
    // persa alla cottura successiva).
    // `null` = pista aperta in modalita' punti, cioe' come si e' sempre fatto.
    let geometria = null;
    let trattoSelezionato = -1;

    function inSegmenti() { return geometria !== null; }

    function rigeneraDaGeometria() {
        mainPoints = TrackSegmenti.cuoci(geometria, TrackSegmenti.PASSO_COTTURA);
    }
```

- [ ] **Step 3: Posare un nodo invece di un punto**

In `mousedown`, sostituire il ramo finale (`activeList().push(...)`) con:

```javascript
        const hit = worldFromEvent(ev);
        if (inSegmenti() && !document.getElementById('pitMode').checked) {
            geometria.nodi.push({ x: +hit.x.toFixed(2), z: +hit.z.toFixed(2), y: 0, dir: 0 });
            geometria.tratti.push({ tipo: 'curva' });
            // La direzione di OGNI nodo si ricalcola: aggiungerne uno cambia
            // i vicini del precedente. Solo per i nodi che l'autore non ha
            // ancora girato a mano (dirManuale).
            for (let i = 0; i < geometria.nodi.length; i++) {
                if (!geometria.nodi[i].dirManuale && geometria.nodi.length >= 3) {
                    geometria.nodi[i].dir = TrackSegmenti.direzioneAutomatica(geometria, i);
                }
            }
            if (geometria.nodi.length >= 3) rigeneraDaGeometria();
            rebuild();
            return;
        }
        activeList().push({ x: +hit.x.toFixed(2), z: +hit.z.toFixed(2) });
        rebuild();
```

- [ ] **Step 4: Disegnare i nodi, non i punti cotti**

In `rebuild()`, sostituire il ciclo `mainPoints.forEach(...)` che crea i marker con:

```javascript
        // In modalita' segmenti i marker sono i NODI: i punti cotti sono
        // centinaia e non si trascinano — sono il prodotto, non il disegno.
        const daMostrare = inSegmenti() ? geometria.nodi : mainPoints;
        daMostrare.forEach((p, i) => {
            const y = p.y || 0;
            const m = new THREE.Mesh(geo, p.bridge ? bridgeMat : materialForY(y));
            m.scale.setScalar(scaleForY(y) * (inSegmenti() ? 1.4 : 1));
            m.position.set(p.x, y + 1, p.z);
            m.userData = { list: 'main', index: i };
            markerGroup.add(m);
        });
```

- [ ] **Step 5: Aprire e salvare**

In `applyTrackData`, dopo aver riempito `mainPoints`:

```javascript
        // Un file con `geometria` si apre in modalita' segmenti; uno senza,
        // in modalita' punti. Non c'e' un terzo stato, e NON si converte
        // niente: le piste esistenti non hanno un'intenzione da cui
        // rigenerarle, e dedurla con un fitting sarebbe una supposizione.
        geometria = (data.geometria && Array.isArray(data.geometria.nodi)
                     && data.geometria.nodi.length >= 3) ? data.geometria : null;
        trattoSelezionato = -1;
        if (geometria) rigeneraDaGeometria();
```

In `buildTrackData`, aggiungere al ritorno:

```javascript
            // L'intenzione accanto al risultato: `geometria` e' dell'editor,
            // `controlPoints` e' del gioco e resta il suo prodotto cotto.
            geometria: geometria || undefined,
```

Una pista nuova nasce in modalità segmenti: all'avvio, se non si carica niente, `geometria = { versione: 1, nodi: [], tratti: [] }`.

- [ ] **Step 6: Provare a mano**

Avviare `node server.js` da `backend/`, aprire `localhost:3000/track-editor.html`, posare 5-6 nodi, verificare che il nastro appaia e che i marker siano i nodi (non centinaia di puntini). Salvare, riaprire: deve tornare in modalità segmenti con gli stessi nodi. Caricare `monte-rosso`: deve aprirsi in modalità punti, identica a prima.

- [ ] **Step 7: Commit**

```bash
git add frontend/track-editor.js frontend/track-editor.html
git commit -m "L'editor posa nodi, e il tracciato e' il loro prodotto"
```

---

### Task 5: Maniglie, snap e commutazione retta/curva

**Files:**
- Modify: `frontend/track-editor.js` (rebuild, mousedown, mousemove, keydown)

**Interfaces:**
- Consumes: `TrackSegmenti.raddrizza`, `TrackSegmenti.versore`.

- [ ] **Step 1: Disegnare la maniglia del nodo selezionato**

In `rebuild()`, dopo i marker:

```javascript
        // La maniglia esce dal nodo nella sua direzione: si trascina per
        // girare la tangente. Una sola alla volta — quella del nodo scelto —
        // altrimenti su una pista da 40 nodi non si vede piu' niente.
        if (inSegmenti() && nodoSelezionato >= 0 && geometria.nodi[nodoSelezionato]) {
            const nodo = geometria.nodi[nodoSelezionato];
            const v = TrackSegmenti.versore(nodo.dir);
            const LUNG = 26;
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(3, 12, 12),
                new THREE.MeshBasicMaterial({ color: 0x2ecc71 }));
            mesh.position.set(nodo.x + v.dx * LUNG, (nodo.y || 0) + 1, nodo.z + v.dz * LUNG);
            mesh.userData = { maniglia: nodoSelezionato };
            markerGroup.add(mesh);
        }
```

Aggiungere `let nodoSelezionato = -1;` accanto a `trattoSelezionato`, e in `mousedown`, quando si clicca un marker in modalità segmenti: `nodoSelezionato = marker.userData.index;`.

- [ ] **Step 2: Trascinare la maniglia, con snap**

In `mousemove`, nel ramo del drag, prima della gestione dei punti:

```javascript
        if (dragging && dragging.maniglia !== undefined) {
            const hit = worldFromEvent(ev);
            const nodo = geometria.nodi[dragging.maniglia];
            let dir = Math.atan2(hit.x - nodo.x, hit.z - nodo.z);
            // Snap a 15 gradi, che e' cio' che rende paralleli due rettilinei
            // senza misurarli. Alt lo sospende per le direzioni fuori griglia.
            if (!ev.altKey) {
                const PASSO = Math.PI / 12;
                dir = Math.round(dir / PASSO) * PASSO;
            }
            nodo.dir = dir;
            nodo.dirManuale = true;   // da qui in poi non la ricalcola piu' nessuno
            rigeneraDaGeometria();
            rebuild();
            return;
        }
```

E in `mousedown`, riconoscere la maniglia prima dei marker: `if (marker && marker.userData.maniglia !== undefined) { dragging = marker.userData; return; }`.

- [ ] **Step 3: Commutare un tratto**

In `keydown`:

```javascript
        // R: il tratto selezionato diventa una retta (e i suoi due nodi
        // prendono la sua direzione). C: torna curva.
        if (ev.key === 'r' && inSegmenti() && trattoSelezionato >= 0) {
            geometria = TrackSegmenti.raddrizza(geometria, trattoSelezionato);
            rigeneraDaGeometria();
            rebuild();
            aggiornaRiquadroTratto();
        }
        if (ev.key === 'c' && inSegmenti() && trattoSelezionato >= 0) {
            geometria.tratti[trattoSelezionato] = { tipo: 'curva' };
            rigeneraDaGeometria();
            rebuild();
            aggiornaRiquadroTratto();
        }
```

La selezione del tratto: cliccando su un nodo si seleziona il tratto che ne PARTE (`trattoSelezionato = marker.userData.index`).

- [ ] **Step 4: Provare a mano**

Posare 6 nodi, selezionarne uno, trascinare la maniglia verde: la curva deve seguirla e scattare di 15° in 15°. Premere R: il tratto diventa dritto. Premere R su due tratti consecutivi non allineati: il primo resta retto, il secondo torna curvo.

- [ ] **Step 5: Commit**

```bash
git add frontend/track-editor.js
git commit -m "La maniglia gira la tangente, e lo snap tiene paralleli i rettilinei"
```

---

### Task 6: Undo/redo su tutto

**Files:**
- Modify: `frontend/track-editor.js:653` (il vecchio pulsante), `:676-693` (keydown)

Oggi esiste solo «annulla ultimo punto», che non copre spostamento, cancellazione, quota, direzione.

- [ ] **Step 1: Lo storico**

```javascript
    // Uno stack di STATI, non di modifiche: le operazioni di TrackSegmenti
    // restituiscono una geometria nuova senza mutare quella vecchia, quindi
    // annullare e' tornare allo stato precedente e non disfare un'azione.
    const storico = [];
    const rifatti = [];
    const STORICO_MAX = 100;

    function salvaStato() {
        if (!inSegmenti()) return;
        storico.push(JSON.stringify(geometria));
        if (storico.length > STORICO_MAX) storico.shift();
        rifatti.length = 0;   // una modifica nuova taglia il ramo dei "rifai"
    }

    function annulla() {
        if (!storico.length) return;
        rifatti.push(JSON.stringify(geometria));
        geometria = JSON.parse(storico.pop());
        rigeneraDaGeometria();
        rebuild();
    }

    function rifai() {
        if (!rifatti.length) return;
        storico.push(JSON.stringify(geometria));
        geometria = JSON.parse(rifatti.pop());
        rigeneraDaGeometria();
        rebuild();
    }

    // ⚠️ Il Task 7 aggiunge `aggiornaRiquadroTratto()` in fondo a entrambe: i numeri
    // mostrati sono quelli dello stato, e annullare deve aggiornarli.
```

- [ ] **Step 2: Chiamare `salvaStato()` PRIMA di ogni modifica** — posa di un nodo, inizio drag di nodo o maniglia, R/C, cancellazione, cambio quota. ⚠️ All'**inizio** del drag, non ad ogni `mousemove`: altrimenti un trascinamento riempie lo storico di cento stati intermedi.

- [ ] **Step 3: Le scorciatoie**

```javascript
        if (ev.ctrlKey && ev.key === 'z') { ev.preventDefault(); annulla(); return; }
        if (ev.ctrlKey && (ev.key === 'y' || (ev.shiftKey && ev.key === 'Z'))) { ev.preventDefault(); rifai(); return; }
```

Il pulsante «Annulla ultimo punto (U)» diventa «Annulla (Ctrl+Z)» e chiama `annulla()` in modalità segmenti, il vecchio comportamento in modalità punti.

- [ ] **Step 4: Provare a mano** — posare nodi, spostarne uno, girare una maniglia, Ctrl+Z tre volte (torna indietro passo passo), Ctrl+Y due volte.

- [ ] **Step 5: Commit**

```bash
git add frontend/track-editor.js frontend/track-editor.html
git commit -m "Annulla e rifai su tutto, non solo sull'ultimo punto"
```

---

### Task 7: Il riquadro dei numeri

**Files:**
- Modify: `frontend/track-editor.html` (riquadro), `frontend/track-editor.js`

**Interfaces:**
- Consumes: `TrackSegmenti.misureTratto`, `TrackSegmenti.impostaLunghezza`, e `salvaStato()` dal Task 6.
- Produces: `aggiornaRiquadroTratto()` — va chiamata anche in `applyTrackData` e ad ogni cambio di selezione; i Task 4 e 5 non la chiamavano perche' non esisteva ancora.

- [ ] **Step 1: Il riquadro nella pagina**

```html
<div id="trattoSection" style="display:none;">
    <h4 style="margin:10px 0 4px;">Tratto selezionato</h4>
    <div id="trattoTipo" style="font-size:12px; color:#8b96a3; margin-bottom:6px;"></div>
    <label>Lunghezza<input id="trattoLunghezza" type="number" step="1"></label>
    <div id="trattoMisure" style="font-size:12px; color:#8b96a3;"></div>
    <div style="font-size:11px; color:#8b96a3;">R: rendi retto · C: rendi curvo</div>
</div>
```

- [ ] **Step 2: Mostrare e scrivere i numeri**

```javascript
    function aggiornaRiquadroTratto() {
        const sez = document.getElementById('trattoSection');
        if (!inSegmenti() || trattoSelezionato < 0 || !geometria.tratti[trattoSelezionato]) {
            sez.style.display = 'none';
            return;
        }
        sez.style.display = '';
        const m = TrackSegmenti.misureTratto(geometria, trattoSelezionato);
        const tipo = geometria.tratti[trattoSelezionato].tipo;
        document.getElementById('trattoTipo').textContent =
            `#${trattoSelezionato} · ${tipo === 'retta' ? 'retta' : 'curva'}`;
        document.getElementById('trattoLunghezza').value = m.lunghezza.toFixed(1);
        document.getElementById('trattoMisure').textContent = tipo === 'retta'
            ? 'raggio: — (retta)'
            : `angolo ${(m.angolo * 180 / Math.PI).toFixed(0)}° · raggio minimo ${m.raggioMinimo.toFixed(0)}`;
    }

    document.getElementById('trattoLunghezza').addEventListener('change', (ev) => {
        const v = parseFloat(ev.target.value);
        if (!(v > 0) || trattoSelezionato < 0) return;
        salvaStato();
        geometria = TrackSegmenti.impostaLunghezza(geometria, trattoSelezionato, v);
        rigeneraDaGeometria();
        rebuild();
        aggiornaRiquadroTratto();
    });
```

Chiamare `aggiornaRiquadroTratto()` ad ogni cambio di selezione (`mousedown` sui marker, tasti R/C del Task 5), in fondo ad `applyTrackData`, e in fondo ad `annulla()`/`rifai()` del Task 6.

- [ ] **Step 3: Provare a mano** — selezionare una retta, scrivere 200, verificare che si allunghi spostando **solo** il nodo di arrivo.

- [ ] **Step 4: Commit**

```bash
git add frontend/track-editor.js frontend/track-editor.html
git commit -m "I numeri di un tratto si leggono e si scrivono"
```

---

### Task 8: Il server accetta e controlla la geometria

**Files:**
- Modify: `backend/sockets/games/trackLoader.js:338-375` (`validateTrackData`)
- Test: `backend/sockets/games/trackLoader.test.js`

`saveTrack` scrive già l'oggetto ricevuto, quindi `geometria` verrebbe salvata anche senza modifiche — ma senza controlli un file malformato entrerebbe e romperebbe l'editor alla riapertura.

- [ ] **Step 1: Il test che fallisce**

⚠️ `validateTrackData` **non e' esportato**: i test del progetto la esercitano
attraverso `saveTrack`, che la invoca e lancia. E l'helper esistente in quel file
si chiama `minimalValidTrackData(overrides)`. Seguirli entrambi invece di
introdurre una via nuova.

```javascript
test('saveTrack rifiuta una geometria con meno tratti che nodi', () => {
    const data = minimalValidTrackData();
    data.geometria = { versione: 1,
        nodi: [{ x: 0, z: 0, dir: 0 }, { x: 10, z: 0, dir: 0 }, { x: 10, z: 10, dir: 0 }],
        tratti: [{ tipo: 'retta' }] };
    assert.throws(() => saveTrack(data), /geometria: serve un tratto per ogni nodo/);
});

test('saveTrack rifiuta un tipo di tratto sconosciuto', () => {
    const data = minimalValidTrackData();
    data.geometria = { versione: 1,
        nodi: [{ x: 0, z: 0, dir: 0 }, { x: 10, z: 0, dir: 1 }, { x: 10, z: 10, dir: 2 }],
        tratti: [{ tipo: 'retta' }, { tipo: 'parabolica' }, { tipo: 'curva' }] };
    assert.throws(() => saveTrack(data), /tipo di tratto sconosciuto/);
});

test('saveTrack accetta una geometria ben formata', () => {
    const data = minimalValidTrackData();
    data.geometria = { versione: 1,
        nodi: [{ x: 0, z: 0, dir: 0 }, { x: 10, z: 0, dir: 1 }, { x: 10, z: 10, dir: 2 }],
        tratti: [{ tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'curva' }] };
    saveTrack(data);   // non deve lanciare
});

test('saveTrack: una pista senza geometria resta valida', () => {
    saveTrack(minimalValidTrackData());   // non deve lanciare
});
```

- [ ] **Step 2: Eseguirli** — `node --test backend/sockets/games/trackLoader.test.js`, attesi 2 falliti: i due `rifiuta`, perche' senza il controllo `saveTrack` accetta e non lancia.

- [ ] **Step 3: Implementare**, in fondo a `validateTrackData` prima di `return null`:

```javascript
    // `geometria` e' FACOLTATIVA: le piste disegnate a punti non ce l'hanno e
    // restano valide per sempre. Se c'e', dev'essere coerente — un file
    // malformato non romperebbe il gioco (che legge controlPoints) ma
    // romperebbe l'editor alla riapertura, che e' peggio: il danno si vede
    // solo quando l'autore ha gia' perso il lavoro.
    if (data.geometria !== undefined) {
        const g = data.geometria;
        if (!g || typeof g !== 'object') return 'geometria non valida';
        if (!Array.isArray(g.nodi) || g.nodi.length < 3) return 'geometria: servono almeno 3 nodi';
        if (!g.nodi.every(n => n && typeof n.x === 'number' && typeof n.z === 'number' && typeof n.dir === 'number')) {
            return 'geometria: nodi malformati (servono x, z, dir numerici)';
        }
        if (!Array.isArray(g.tratti) || g.tratti.length !== g.nodi.length) {
            return 'geometria: serve un tratto per ogni nodo (l\'ultimo chiude sul primo)';
        }
        if (!g.tratti.every(t => t && (t.tipo === 'retta' || t.tipo === 'curva'))) {
            return 'geometria: tipo di tratto sconosciuto (attesi "retta" o "curva")';
        }
    }
```

- [ ] **Step 4: Eseguire** — 4 test verdi, e `node --test backend/` non oltre gli 8 rossi preesistenti.

- [ ] **Step 5: Commit**

```bash
git add backend/sockets/games/trackLoader.js backend/sockets/games/trackLoader.test.js
git commit -m "Il server controlla la geometria, senza pretenderla"
```

---

### Task 9: Abrasività, con la previsione dei giri

**Files:**
- Modify: `backend/routes/lobbyRoutes.js` (endpoint)
- Modify: `frontend/track-editor.html`, `frontend/track-editor.js`
- Test: `backend/routes/giriPerMescola.test.js` (nuovo)

**Interfaces:**
- Produces: `GET /api/f1/giri-per-mescola?laps=<n>&abrasivita=<a>` → `{ hard, medium, soft }`

⚠️ La formula **non** si riscrive nell'editor: `TyreModel` è CommonJS e non si carica in una pagina statica, e due formule per la stessa cosa sono il difetto già pagato altrove nel progetto.

- [ ] **Step 1: Il test dell'endpoint**

⚠️ Il modo di provare una rotta **esiste gia'** in
`backend/routes/impostazioniLobby.test.js`: `avviaServer()` monta il router su
una porta effimera e `chiedi(server, percorso)` fa la GET. Copiare quelle due
funzioni invece di inventarne altre.

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const router = require('./lobbyRoutes.js');
const { giriPerMescola } = require('../sockets/games/physics/TyreModel.js');

function avviaServer() {
    const app = express();
    app.use(express.json());
    app.use('/', router);
    const server = http.createServer(app);
    return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

function chiedi(server, percorso) {
    const { port } = server.address();
    return new Promise((risolvi, rifiuta) => {
        http.get({ host: '127.0.0.1', port, path: percorso }, (res) => {
            let corpo = '';
            res.on('data', (c) => { corpo += c; });
            res.on('end', () => {
                let dati = null;
                try { dati = JSON.parse(corpo); } catch (e) { /* corpo non JSON */ }
                risolvi({ stato: res.statusCode, dati });
            });
        }).on('error', rifiuta);
    });
}

// La rotta deve rispondere con LA FUNZIONE VERA del gioco, non con numeri
// plausibili: e' tutto il suo motivo di esistere.
test('la previsione dei giri e quella di TyreModel, non una copia', async () => {
    const server = await avviaServer();
    try {
        const r = await chiedi(server, '/api/f1/giri-per-mescola?laps=20&abrasivita=1.5');
        assert.equal(r.stato, 200);
        assert.deepEqual(r.dati, giriPerMescola(20, 1.5));
    } finally { server.close(); }
});

test('parametri assurdi danno 400, non 500', async () => {
    const server = await avviaServer();
    try {
        assert.equal((await chiedi(server, '/api/f1/giri-per-mescola?laps=zzz')).stato, 400);
        assert.equal((await chiedi(server, '/api/f1/giri-per-mescola?laps=20&abrasivita=-1')).stato, 400);
    } finally { server.close(); }
});
```

- [ ] **Step 2: L'endpoint**

```javascript
// Previsione della durata delle mescole, per l'editor: la abrasivita' della
// pista si sceglie li', e senza vedere quanti giri dura una gomma quel numero
// non dice niente a nessuno.
//
// ⚠️ Risponde con la funzione VERA del gioco. Riscrivere la formula
// nell'editor darebbe due numeri diversi per la stessa cosa.
router.get('/api/f1/giri-per-mescola', (req, res) => {
    const laps = Number(req.query.laps);
    const abrasivita = Number(req.query.abrasivita);
    if (!Number.isFinite(laps) || laps <= 0 || !Number.isFinite(abrasivita) || abrasivita <= 0) {
        return res.status(400).json({ error: 'laps e abrasivita devono essere numeri positivi' });
    }
    res.json(giriPerMescola(laps, abrasivita));
});
```

- [ ] **Step 3: Il controllo nell'editor**

```html
<label>Abrasività asfalto
    <input id="abrasivita" type="range" min="0.5" max="2" step="0.05" value="1">
</label>
<div id="abrasivitaInfo" style="font-size:12px; color:#8b96a3;"></div>
```

```javascript
    // I giri della pista dai km: TrackGeometry ce l'ha gia', mancava mostrarlo.
    function giriPrevisti() {
        if (mainPoints.length < 3) return null;
        const pts = TrackGeometry.sampleLoop(mainPoints, 500);
        return TrackGeometry.lapsForDistance(TrackGeometry.lapLength(pts),
            parseFloat(document.getElementById('targetKm').value) || 5);
    }

    async function aggiornaAbrasivita() {
        const abr = parseFloat(document.getElementById('abrasivita').value) || 1;
        const giri = giriPrevisti();
        const el = document.getElementById('abrasivitaInfo');
        if (!giri) { el.textContent = `abrasività ${abr.toFixed(2)} · disegna la pista per la previsione`; return; }
        try {
            const res = await fetch(`/api/f1/giri-per-mescola?laps=${giri}&abrasivita=${abr}`);
            const g = await res.json();
            el.textContent = `${giri} giri · dura: soft ${g.soft}, medium ${g.medium}, hard ${g.hard}`;
        } catch (err) {
            el.textContent = `${giri} giri · previsione non disponibile`;
        }
    }
```

Agganciare a `input` sullo slider, a `change` su `targetKm`, e chiamarla in fondo a `rebuild()`. Aggiungere `abrasivita` a `buildTrackData` e leggerlo in `applyTrackData` (`data.abrasivita ?? 1`).

- [ ] **Step 4: Provare a mano** — spostare lo slider: la riga sotto deve cambiare i giri per mescola. Salvare e riaprire: lo slider torna dov'era.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/lobbyRoutes.js backend/routes/lobbyRoutes.test.js frontend/track-editor.js frontend/track-editor.html
git commit -m "L'abrasivita' si sceglie vedendo quanto durano le gomme"
```

---

### Task 10: La trasparenza va sul tracciato

**Files:**
- Modify: `frontend/track-editor.html:74-83`, `frontend/track-editor.js:315-390`

Oggi lo slider sbiadisce l'immagine di riferimento: per controllare il ricalco bisogna sbiadire proprio ciò che si sta ricalcando. Richiesta esplicita dell'utente.

- [ ] **Step 1:** spostare lo slider fuori da `imgOverlaySection` e rinominarlo «Trasparenza tracciato», lasciando l'immagine sempre a piena opacità.

- [ ] **Step 2:** in `rebuild()`, applicare l'opacità ai materiali del nastro:

```javascript
        const opacitaPista = (parseInt(document.getElementById('trackOpacity').value, 10) || 100) / 100;
        // Il nastro e i cordoli si sbiadiscono; i marker no — servono a
        // cliccarci sopra, e un marker trasparente non si prende piu'.
        trackMeshGroup.traverse((o) => {
            if (!o.isMesh) return;
            o.material.transparent = opacitaPista < 1;
            o.material.opacity = opacitaPista;
        });
```

- [ ] **Step 3: Provare a mano** — incollare un'immagine, abbassare lo slider: sbiadisce la pista, l'immagine resta nitida.

- [ ] **Step 4: Commit**

```bash
git add frontend/track-editor.js frontend/track-editor.html
git commit -m "La trasparenza sbiadisce il tracciato, non il riferimento"
```

---

## Verifica finale

- [ ] `node --test frontend/shared/` — non oltre i **4** rossi preesistenti, più i test nuovi verdi.
- [ ] `node --test backend/` — non oltre gli **8** rossi preesistenti.
- [ ] Bump del `?v=` in `frontend/track-editor.html` per ogni `.js` toccato.
- [ ] Disegnare una pista completa (due rettilinei, due curve, corsia box, traguardo), salvarla, **correrci** in localhost.
- [ ] Riaprire `monte-rosso`: deve comportarsi esattamente come prima.
