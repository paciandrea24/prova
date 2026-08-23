# F1 — Mappe immutabili (blocco B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Congelare `prova` cuocendo la sua scenografia in un file accanto al tracciato, così che correggere l'algoritmo di posizionamento per altre piste non la tocchi più.

**Architecture:** Un modulo puro condiviso possiede il **formato** (compressione, espansione, impronta, criterio di validità); il cuocitore lo usa in Node per scrivere il file, `f1.js` lo usa nel browser per rileggerlo. Baker e lettore non possono divergere sul formato perché è lo stesso codice. Se il file manca o non è valido, si genera come oggi — il fallback è ciò che rende la cottura un'ottimizzazione sicura invece di una fonte di verità che può mentire.

**Tech Stack:** Node.js (CommonJS) + il pattern UMD già usato da tutti i moduli in `frontend/shared/`. `node:test` + `node:assert/strict`. Nessuna dipendenza nuova.

**Spec:** `docs/superpowers/specs/2026-08-23-f1-mappe-immutabili-design.md`

## Global Constraints

- **Italiano** nei commenti e nei messaggi di commit.
- **Un commit per task.** Il push lo fa l'utente.
- **`git add` per nome, MAI `git add -A`.** L'utente lavora in parallelo su `frontend/f1.js|html`, `frontend/styles/f1.css` e `frontend/tracks/*.json`. Il Task 3 tocca `f1.js`: prima di editare, `git diff frontend/f1.js > utente.patch`; poi `git add`, `git apply --cached -R utente.patch`, e controllo con `git diff --cached`.
- ⚠️ **`frontend/tracks/` è dell'utente.** Il file cotto ci finisce dentro (`prova-scenografia.json`) ed è l'unica eccezione: va aggiunto per nome, mai insieme ad altri file di quella cartella.
- **Cache-busting**: il Task 3 modifica `frontend/f1.js` e aggiunge `frontend/shared/scenografiaCotta.js` → alzare il `?v=` di `f1.js` e aggiungere il `<script>` del modulo nuovo in `frontend/f1.html`.
- **I moduli in `frontend/shared/` sono puri**: niente Three.js, niente `document`, niente `fetch`. Girano identici in Node e nel browser col pattern UMD (copiare l'intestazione di `frontend/shared/f1Stagione.js`).
- **Test**: `node --test backend/` dalla radice. `npm test` non esiste.
- ⚠️ **La suite ha 9 rossi PREESISTENTI**, uno intermittente (`prova-notturno: i bot entrano davvero in corsia box`). Registrarli all'inizio; il criterio è **«nessun rosso NUOVO»**.

---

### Task 1: Il formato cotto

Un modulo puro che possiede tutto ciò che riguarda il formato. È il pezzo che impedisce a cuocitore e lettore di divergere.

**Files:**
- Create: `frontend/shared/scenografiaCotta.js`
- Test: `frontend/shared/scenografiaCotta.test.js`

**Interfaces:**
- Consumes: niente.
- Produces:
  - `VERSIONE_FORMATO` (1)
  - `improntaDi(trackData) -> string`
  - `comprimi(layout, { pista, gridSize, impronta, cottaIl }) -> object`
  - `espandi(file) -> layout` (l'elenco di voci `{ asset, category, x, y, z, rotY, scale }`)
  - `motivoDiRifiuto(file, trackData, gridSize) -> string | null` — `null` significa «si può usare»

- [ ] **Step 1: Registrare i rossi preesistenti**

Run: `node --test backend/ 2>&1 | grep "^not ok"` — salvare l'elenco (attesi 9, uno intermittente).

- [ ] **Step 2: Scrivere i test che falliscono**

Creare `frontend/shared/scenografiaCotta.test.js`:

```js
// frontend/shared/scenografiaCotta.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Cotta = require('./scenografiaCotta.js');

const PISTA = {
    id: 'prova', roadHalfWidth: 11,
    startFinish: { x: 1, z: 2, angle: 0.5 },
    controlPoints: [{ x: 0, z: 0 }, { x: 10, z: 5 }],
    pit: { roadHalfWidth: 6, boxIndex: 3, entryTrigger: {} },
    name: 'prova', targetKm: 24,
};
const LAYOUT = [
    { asset: 'tree_a', category: 'natura', x: 1.234567, y: 0, z: -8.9, rotY: 1.5708, scale: 1 },
    { asset: 'grandstand', category: 'tribune', x: -40.5, y: 2.25, z: 12.125, rotY: 0, scale: 1.5 },
    { asset: 'tree_a', category: 'natura', x: 3, y: 0, z: 4, rotY: 3.14, scale: 0.8 },
];

function cuoci(layout = LAYOUT, pista = PISTA, gridSize = 6) {
    return Cotta.comprimi(layout, {
        pista: pista.id, gridSize,
        impronta: Cotta.improntaDi(pista),
        cottaIl: '2026-08-23T00:00:00.000Z',
    });
}

test('comprimi/espandi: si torna al layout di partenza', () => {
    const espanso = Cotta.espandi(cuoci());
    assert.equal(espanso.length, LAYOUT.length);
    for (let i = 0; i < LAYOUT.length; i++) {
        assert.equal(espanso[i].asset, LAYOUT[i].asset);
        assert.equal(espanso[i].category, LAYOUT[i].category);
        for (const c of ['x', 'y', 'z', 'rotY', 'scale']) {
            assert.ok(Math.abs(espanso[i][c] - LAYOUT[i][c]) <= 0.005,
                `${c} della voce ${i}: ${espanso[i][c]} vs ${LAYOUT[i][c]}`);
        }
    }
});

test('comprimi: gli asset ripetuti stanno in tabella, non ripetuti per voce', () => {
    // E' cio' che porta prova da 1037 KB a 264: 7667 voci e 46 asset distinti.
    const f = cuoci();
    assert.deepEqual(f.assets.sort(), ['grandstand', 'tree_a']);
    assert.equal(f.voci.length, 3);
    assert.equal(typeof f.voci[0][0], 'number', 'l\'asset e\' un indice, non una stringa');
});

test('improntaDi: la stessa pista da\' la stessa impronta', () => {
    assert.equal(Cotta.improntaDi(PISTA), Cotta.improntaDi(JSON.parse(JSON.stringify(PISTA))));
});

test('improntaDi: spostare un punto di controllo cambia l\'impronta', () => {
    // E' il rischio VERO di questo blocco: una cottura stantia disporrebbe
    // tribune attorno a una pista che non c'e' piu'.
    const altra = JSON.parse(JSON.stringify(PISTA));
    altra.controlPoints[1].x = 10.5;
    assert.notEqual(Cotta.improntaDi(PISTA), Cotta.improntaDi(altra));
});

test('improntaDi: cambiare la larghezza o la corsia box cambia l\'impronta', () => {
    for (const muta of [(p) => { p.roadHalfWidth = 12; }, (p) => { p.pit.roadHalfWidth = 7; },
                        (p) => { p.pit.boxIndex = 9; }, (p) => { p.startFinish.angle = 1.1; }]) {
        const altra = JSON.parse(JSON.stringify(PISTA));
        muta(altra);
        assert.notEqual(Cotta.improntaDi(PISTA), Cotta.improntaDi(altra));
    }
});

test('improntaDi: cambiare il NOME non cambia l\'impronta', () => {
    // Il nome non sposta un solo oggetto: se lo contasse, rinominare una pista
    // butterebbe via una cottura ancora buona.
    const altra = JSON.parse(JSON.stringify(PISTA));
    altra.name = 'Circuito di Prova';
    assert.equal(Cotta.improntaDi(PISTA), Cotta.improntaDi(altra));
});

test('motivoDiRifiuto: una cottura buona non viene rifiutata', () => {
    assert.equal(Cotta.motivoDiRifiuto(cuoci(), PISTA, 6), null);
});

test('motivoDiRifiuto: pista sbagliata', () => {
    const f = cuoci(LAYOUT, PISTA, 6);
    f.pista = 'monte-rosso';
    assert.match(Cotta.motivoDiRifiuto(f, PISTA, 6), /pista/i);
});

test('motivoDiRifiuto: gridSize diverso', () => {
    // generateLayout dipende anche da gridSize: fra 1 e 10 cambiano da 3 a 7
    // voci su 7667. Poche, ma il layout non e' identico.
    assert.match(Cotta.motivoDiRifiuto(cuoci(), PISTA, 4), /grid/i);
});

test('motivoDiRifiuto: tracciato cambiato dopo la cottura', () => {
    const f = cuoci();
    const altra = JSON.parse(JSON.stringify(PISTA));
    altra.controlPoints[1].z = 99;
    assert.match(Cotta.motivoDiRifiuto(f, altra, 6), /tracciato|impronta/i);
});

test('motivoDiRifiuto: formato di una versione futura', () => {
    const f = cuoci();
    f.versione = 999;
    assert.match(Cotta.motivoDiRifiuto(f, PISTA, 6), /versione|formato/i);
});

test('motivoDiRifiuto: file assente o spazzatura non fa esplodere niente', () => {
    for (const f of [null, undefined, {}, { voci: 'no' }, 42]) {
        assert.equal(typeof Cotta.motivoDiRifiuto(f, PISTA, 6), 'string');
    }
});
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `node --test frontend/shared/scenografiaCotta.test.js`
Expected: FAIL con "Cannot find module './scenografiaCotta.js'".

- [ ] **Step 4: Scrivere il modulo**

Creare `frontend/shared/scenografiaCotta.js`, copiando l'intestazione UMD di `frontend/shared/f1Stagione.js`:

```js
// frontend/shared/scenografiaCotta.js
//
// Il FORMATO di una scenografia cotta: come si comprime, come si rilegge, e
// quando NON si puo' usare. Rif.
// docs/superpowers/specs/2026-08-23-f1-mappe-immutabili-design.md.
//
// Sta in shared/ perche' lo usano due mondi che devono essere d'accordo: il
// cuocitore in Node (backend/tools/f1-cuoci-scenografia.js) e il lettore nel
// browser (frontend/f1.js). Se il formato vivesse in due posti, prima o poi
// scriverebbero cose diverse — ed e' esattamente il genere di scarto che qui
// non si vedrebbe finche' una tribuna non spunta in mezzo alla pista.
//
// Modulo PURO: niente Three.js, niente fetch, niente filesystem.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ScenografiaCotta = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const VERSIONE_FORMATO = 1;

    // Due decimali su coordinate in unita' di gioco valgono il centimetro:
    // sotto la soglia del visibile, e sono cio' che porta prova da 1037 KB a
    // 264 (64 gzippati).
    const DECIMALI = 2;
    const r = (n) => Math.round((Number(n) || 0) * 100) / 100;

    // Hash FNV-1a 32 bit, lo stesso gia' usato da trackScenery.hashString: un
    // hash diverso per la stessa cosa sarebbe una seconda verita'.
    function hash(testo) {
        let h = 0x811c9dc5;
        for (let i = 0; i < testo.length; i++) {
            h ^= testo.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return ('0000000' + h.toString(16)).slice(-8);
    }

    // L'impronta dei campi del tracciato che SPOSTANO gli oggetti. Il nome e
    // il notturno non entrano: se entrassero, rinominare una pista o passarla
    // alla notte butterebbe via una cottura ancora perfettamente buona.
    function improntaDi(trackData) {
        const t = trackData || {};
        const pit = t.pit || {};
        return hash(JSON.stringify([
            t.id,
            t.roadHalfWidth,
            t.targetKm,
            t.startFinish,
            t.controlPoints,
            pit.roadHalfWidth, pit.boxIndex, pit.entryTrigger, pit.controlPoints,
        ]));
    }

    function comprimi(layout, meta) {
        const assets = [];
        const categorie = [];
        const indice = (elenco, v) => {
            let i = elenco.indexOf(v);
            if (i < 0) { i = elenco.length; elenco.push(v); }
            return i;
        };
        const voci = (layout || []).map((v) => [
            indice(assets, v.asset), indice(categorie, v.category),
            r(v.x), r(v.y), r(v.z), r(v.rotY), r(v.scale),
        ]);
        return {
            versione: VERSIONE_FORMATO,
            pista: meta.pista,
            gridSize: meta.gridSize,
            impronta: meta.impronta,
            cottaIl: meta.cottaIl,
            assets, categorie, voci,
        };
    }

    function espandi(file) {
        return (file.voci || []).map((v) => ({
            asset: file.assets[v[0]], category: file.categorie[v[1]],
            x: v[2], y: v[3], z: v[4], rotY: v[5], scale: v[6],
        }));
    }

    // Restituisce il MOTIVO per cui non si puo' usare, o null se si puo'.
    // Una stringa e non un booleano perche' chi la riceve la stampa: "cottura
    // ignorata" senza il perche' e' un messaggio che non aiuta nessuno.
    function motivoDiRifiuto(file, trackData, gridSize) {
        if (!file || typeof file !== 'object' || !Array.isArray(file.voci)) {
            return 'file assente o illeggibile';
        }
        if (file.versione !== VERSIONE_FORMATO) {
            return `versione del formato ${file.versione}, questo codice legge la ${VERSIONE_FORMATO}`;
        }
        if (file.pista !== (trackData && trackData.id)) {
            return `cotta per la pista "${file.pista}"`;
        }
        if (file.gridSize !== gridSize) {
            return `cotta per gridSize ${file.gridSize}, questa gara ne ha ${gridSize}`;
        }
        if (file.impronta !== improntaDi(trackData)) {
            return 'il tracciato e\' cambiato dopo la cottura';
        }
        return null;
    }

    return { VERSIONE_FORMATO, improntaDi, comprimi, espandi, motivoDiRifiuto };
});
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `node --test frontend/shared/scenografiaCotta.test.js`
Expected: PASS, tutti e 12.

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/scenografiaCotta.js frontend/shared/scenografiaCotta.test.js
git commit -m "Il formato di una scenografia cotta

Compressione, rilettura, impronta del tracciato e criterio di validita'
in un modulo solo, condiviso fra il cuocitore in Node e il lettore nel
browser: se il formato vivesse in due posti prima o poi scriverebbero
cose diverse, e qui uno scarto non si vedrebbe finche' una tribuna non
spunta in mezzo alla pista.

L'impronta copre i campi che SPOSTANO gli oggetti, non il nome: se
contasse il nome, rinominare una pista butterebbe via una cottura
ancora buona.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Il cuocitore

**Files:**
- Create: `backend/tools/f1-cuoci-scenografia.js`
- Test: `backend/tools/f1-cuoci-scenografia.test.js`

**Interfaces:**
- Consumes: `comprimi`, `improntaDi` dal Task 1.
- Produces: `cuoci(trackId, gridSize) -> file` (l'oggetto, non lo scrive); la CLI scrive `frontend/tracks/<id>-scenografia.json`.

- [ ] **Step 1: Copiare la ricetta headless che esiste già**

Run: `sed -n '13,40p;71,78p' backend/tools/f1-costo-scenografia.js`

Quel file genera già il layout fuori dal browser. Il cuocitore **copia quella chiamata**, non ne inventa un'altra: se le due divergessero, il file cotto non corrisponderebbe a ciò che il gioco disegna.

- [ ] **Step 2: Scrivere il test che fallisce**

Creare `backend/tools/f1-cuoci-scenografia.test.js`:

```js
// backend/tools/f1-cuoci-scenografia.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { cuoci } = require('./f1-cuoci-scenografia.js');
const Cotta = require('../../frontend/shared/scenografiaCotta.js');

const ROOT = path.join(__dirname, '..', '..');
const raw = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/tracks/prova.json'), 'utf8'));

test('cuoci: produce un file che il lettore accetta', () => {
    const file = cuoci('prova', 6);
    assert.equal(Cotta.motivoDiRifiuto(file, raw(), 6), null);
});

test('cuoci: la cottura contiene la scenografia VERA, non un abbozzo', () => {
    // Se il cuocitore chiamasse generateLayout con argomenti diversi da quelli
    // del gioco, il file sarebbe plausibile e sbagliato. Il numero e' quello
    // misurato il 2026-08-23 su prova.
    const file = cuoci('prova', 6);
    assert.ok(file.voci.length > 5000, `attese migliaia di voci, ottenute ${file.voci.length}`);
    assert.ok(file.assets.length > 20, `attesi decine di asset distinti, ottenuti ${file.assets.length}`);
});

test('cuoci: due cotture della stessa pista sono identiche', () => {
    // La scenografia e' deterministica (seminata dall'id): se due cotture
    // divergono, da qualche parte e' entrata della casualita' vera e tutto
    // questo blocco non ha senso.
    const a = cuoci('prova', 6);
    const b = cuoci('prova', 6);
    assert.deepEqual(a.voci, b.voci);
});

test('cuoci: gridSize diversi producono cotture diverse', () => {
    const a = cuoci('prova', 6);
    const b = cuoci('prova', 2);
    assert.notDeepEqual(a.voci, b.voci);
    assert.equal(b.gridSize, 2);
});
```

- [ ] **Step 3: Eseguire il test e verificare che fallisca**

Run: `node --test backend/tools/f1-cuoci-scenografia.test.js`
Expected: FAIL — modulo inesistente.

- [ ] **Step 4: Scrivere il cuocitore**

Creare `backend/tools/f1-cuoci-scenografia.js`:

```js
// Congela la scenografia di un circuito: la genera una volta e la scrive
// accanto al tracciato, cosi' che modificare l'algoritmo di posizionamento per
// un'altra pista non la tocchi piu'. Rif.
// docs/superpowers/specs/2026-08-23-f1-mappe-immutabili-design.md.
//
// Uso:  node backend/tools/f1-cuoci-scenografia.js <pista> [--grid=6]
//
// Scongelare = cancellare il file. Non c'e' nessuno stato altrove.
//
// ⚠️ La chiamata a generateLayout qui sotto e' la STESSA di f1.js::loadScenery
// e di f1-costo-scenografia.js. Se divergesse, il file cotto sarebbe
// plausibile e sbagliato — e nessun test lo direbbe, perche' sarebbe coerente
// con se stesso.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TrackScenery = require(path.join(ROOT, 'frontend/shared/trackScenery.js'));
const Cotta = require(path.join(ROOT, 'frontend/shared/scenografiaCotta.js'));
const { loadTrack } = require(path.join(ROOT, 'backend/sockets/games/trackLoader.js'));

const seats = require(path.join(ROOT, 'frontend/assets/custom/circuit/grandStandSeats.json')).seats;
const terraceAnchors = require(path.join(ROOT, 'frontend/assets/custom/circuit/terraceAnchors.json')).anchors;

function cuoci(trackId, gridSize) {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/tracks', trackId + '.json'), 'utf8'));
    const t = loadTrack(trackId);
    const layout = TrackScenery.generateLayout(raw, t.points, t.pitLanePts,
        raw.roadHalfWidth + 2.8 + 1.2, 45, seats, t.barrierProfile, terraceAnchors,
        { gridSize });
    return Cotta.comprimi(layout, {
        pista: trackId,
        gridSize,
        impronta: Cotta.improntaDi(raw),
        cottaIl: new Date().toISOString(),
    });
}

function main() {
    const argomenti = process.argv.slice(2);
    const trackId = argomenti.find(a => !a.startsWith('--'));
    const grid = argomenti.find(a => a.startsWith('--grid='));
    const gridSize = grid ? parseInt(grid.slice('--grid='.length), 10) : 6;

    if (!trackId) {
        console.error('Uso: node backend/tools/f1-cuoci-scenografia.js <pista> [--grid=6]');
        process.exitCode = 1;
        return;
    }

    const file = cuoci(trackId, gridSize);
    const dove = path.join(ROOT, 'frontend/tracks', trackId + '-scenografia.json');
    fs.writeFileSync(dove, JSON.stringify(file));
    const kb = (fs.statSync(dove).size / 1024).toFixed(0);
    console.log(`${trackId} congelata: ${file.voci.length} oggetti, ${file.assets.length} asset distinti, gridSize ${gridSize}`);
    console.log(`  ${dove}  (${kb} KB)`);
    console.log('  Per scongelare: cancella questo file.');
}

if (require.main === module) main();

module.exports = { cuoci };
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `node --test backend/tools/f1-cuoci-scenografia.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

⚠️ **Non** cuocere ancora `prova`: il file arriva nel Task 4, quando c'è chi lo legge.

```bash
git add backend/tools/f1-cuoci-scenografia.js backend/tools/f1-cuoci-scenografia.test.js
git commit -m "Il cuocitore della scenografia

Copia la chiamata headless che f1-costo-scenografia.js usa gia': se
divergesse, il file cotto sarebbe plausibile e sbagliato, e nessun test
lo direbbe perche' sarebbe coerente con se stesso.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Il gioco usa la cottura, quando può

**Files:**
- Modify: `frontend/f1.js` (~riga 1486, dove chiama `generateLayout`)
- Modify: `frontend/f1.html` (`<script>` del modulo nuovo, e `?v=` di `f1.js`)

**Interfaces:**
- Consumes: `espandi`, `motivoDiRifiuto` dal Task 1.
- Produces: niente.

⚠️ **L'utente lavora su questi file.** Salvare la sua patch prima di editare (vedi Global Constraints).

- [ ] **Step 1: Leggere il punto di aggancio**

Run: `grep -n "generateLayout" -B 8 -A 4 frontend/f1.js`

- [ ] **Step 2: Aggiungere il modulo alla pagina**

In `frontend/f1.html`, accanto agli altri `<script src="shared/...">`, **prima** di `f1.js`:

```html
    <script src="shared/scenografiaCotta.js?v=20260823a"></script>
```

E alzare il `?v=` di `f1.js`.

- [ ] **Step 3: Provare la cottura prima di generare**

In `frontend/f1.js`, dove oggi c'è `const sceneryLayout = TrackScenery.generateLayout(...)`:

```js
    // Se questa pista e' CONGELATA, la sua scenografia non si ricalcola: si
    // rilegge. E' cio' che permette di correggere l'algoritmo di
    // posizionamento per un'altra pista senza toccare questa. Rif.
    // docs/superpowers/specs/2026-08-23-f1-mappe-immutabili-design.md.
    //
    // Il fallback non e' una scorciatoia: e' cio' che rende la cottura
    // un'ottimizzazione sicura invece di una fonte di verita' che puo'
    // mentire. Se il file manca, o e' di un'altra pista, o di un altro
    // gridSize, o il tracciato e' cambiato dopo la cottura, si genera come
    // sempre e si dice perche'.
    let sceneryLayout = null;
    try {
        const risposta = await fetch(`/tracks/${trackId}-scenografia.json`);
        if (risposta.ok) {
            const cotta = await risposta.json();
            const motivo = ScenografiaCotta.motivoDiRifiuto(cotta, trackData, gridSize);
            if (motivo) {
                console.warn(`[F1] scenografia cotta ignorata (${motivo}) — rigenerata`);
            } else {
                sceneryLayout = ScenografiaCotta.espandi(cotta);
                console.log(`[F1] ${trackId} e' congelata: ${sceneryLayout.length} oggetti riletti, non ricalcolati`);
            }
        }
    } catch (e) {
        // Una pista non congelata risponde 404 e finisce qui: non e' un
        // errore, e' il caso normale.
    }
    if (!sceneryLayout) {
        sceneryLayout = TrackScenery.generateLayout(trackData, trackPts, PIT_PTS, BARRIER_D,
            EMBANKMENT_WIDTH, seatAnchors, BARRIER_PROFILE, terraceAnchors, { gridSize });
    }
```

⚠️ Due cose da verificare, non da assumere:
1. che il punto sia dentro una funzione `async` (il `fetch` lo richiede). Se non lo è, il caricamento della scenografia va spostato dove lo è, oppure si usa la stessa forma con cui `f1.js:42` legge già `/tracks/<id>.json`.
2. che `gridSize` sia già in scope lì: è lo stesso valore che viene passato a `generateLayout` nella riga di oggi.

- [ ] **Step 4: Verificare che una pista NON congelata non cambi**

Nessun file cotto esiste ancora, quindi con il server acceso ogni pista deve comportarsi esattamente come prima e la console non deve dire niente di anomalo (il 404 è atteso e silenzioso).

Avviare `node server.js` da `backend/`, aprire una gara veloce su una pista qualsiasi, e controllare che la scenografia ci sia e la console sia pulita.

- [ ] **Step 5: Commit**

Con la tecnica dei soli hunk propri.

```bash
git commit -m "Il gioco rilegge la scenografia congelata, quando puo'

Se la pista ha un file cotto valido lo usa, altrimenti genera come
sempre. Il fallback non e' una scorciatoia: e' cio' che rende la cottura
un'ottimizzazione sicura invece di una fonte di verita' che puo' mentire.

Quattro motivi di rifiuto, e li dice: file assente, pista sbagliata,
gridSize diverso, tracciato cambiato dopo la cottura.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Congelare `prova`

**Files:**
- Create: `frontend/tracks/prova-scenografia.json` (generato)

⚠️ È un file dentro `frontend/tracks/`, che è dell'utente: aggiungerlo **per nome**, mai con un `git add` della cartella.

- [ ] **Step 1: Chiedere il gridSize**

La cottura vale per un gridSize solo. Prima di cuocere, **chiedere all'utente con quanti piloti gioca di solito** — cuocere per il valore sbagliato significa che il file verrà rifiutato ad ogni partita e il congelamento non servirà a niente, silenziosamente.

- [ ] **Step 2: Cuocere**

```bash
node backend/tools/f1-cuoci-scenografia.js prova --grid=<quello concordato>
```

Attesi ~7667 oggetti, 46 asset distinti, ~264 KB (64 KB serviti, ora che il server comprime).

- [ ] **Step 3: Verificare che sia indistinguibile**

Due controlli, uno automatico e uno a occhio.

**Automatico** — le istanze per categoria devono coincidere:

```bash
node backend/tools/f1-costo-scenografia.js prova
```

Confrontare i totali con quelli della cottura (`file.voci.length` e il conteggio per categoria). Se non coincidono, il cuocitore e il gioco stanno chiamando `generateLayout` in modo diverso.

**A occhio** — aprire `prova` in gioco con il file presente, verificare in console il messaggio «`prova` è congelata: N oggetti riletti», e controllare che il circuito sia quello di sempre: tribune al loro posto, niente buchi, niente oggetti in pista.

Poi **rinominare temporaneamente** il file (così viene ignorato), riaprire, e confrontare. Devono essere identici.

- [ ] **Step 4: Provare che il congelamento funzioni davvero**

È il punto di tutto il blocco, e va visto succedere:

1. cambiare **temporaneamente** una costante di posizionamento in un modulo `scenery*.js` (per esempio una distanza dal muro);
2. aprire una pista **non** congelata: la scenografia deve cambiare;
3. aprire `prova`: deve essere **identica**;
4. **rimettere a posto la costante.**

Se al punto 3 `prova` cambia, il file non viene usato: leggere il motivo in console.

- [ ] **Step 5: Commit**

```bash
git add frontend/tracks/prova-scenografia.json
git commit -m "prova e' congelata

7667 oggetti riletti invece che ricalcolati. Da adesso, correggere
l'algoritmo di posizionamento per un'altra pista non la tocca piu'.

Verificato: con una costante di posizionamento alterata, le altre piste
cambiano e prova no.

Per scongelare: cancella il file.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Dopo questo blocco

`prova` è al sicuro, e il **blocco C** (i bug di scenografia: asset dentro la pista, pilastri del ponte, grandstand senza rete, buchi d'erba) diventa aggredibile senza rischiare la pista che funziona.

Una cosa da ricordare quando si aprirà il blocco D (editor): l'utente ha chiesto che il congelamento sia un'azione dell'editor — «creo → valido → rendo immutabile». Qui è una riga di comando; lì diventerà un pulsante che chiama lo stesso cuocitore.
