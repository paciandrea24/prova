# Cartelloni veri e gomme che fermano l'auto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le barriere di pneumatici, che oggi stanno nascoste dietro il muro, passano davanti e **fermano l'auto**; e sopra il muretto corre un nastro di **cartelloni con scritte leggibili**, su ogni pista e non solo nelle cittadine.

**Architecture:** Il profilo di barriera guadagna una banda `gomme` (c'è / non c'è, per campione e lato) e un accessor nuovo `TrackGravel.impattoAt`, che è il muro meno la profondità del cuscinetto. `barrierAt` **non cambia significato**: continua a dire dov'è il muro, e i tredici consumatori di scenografia e mesh restano intatti. Leggono `impattoAt` solo la fisica (`CollisionResolver`), la ghiaia e la posa delle gomme. I cartelloni sono una mesh estrusa nuova (`buildCartelloni`), sorella di `buildBarriers`, con una `CanvasTexture` disegnata a runtime e le UV prese dalla distanza percorsa.

**Tech Stack:** Node.js, `node --test` + `node:assert/strict`; moduli UMD condivisi (`frontend/shared/*.js`); Three.js r128 lato client, con il finto THREE di `trackMeshBuilder.test.js` per provare la geometria senza browser.

**Spec:** `docs/superpowers/specs/2026-09-04-f1-barriere-sponsor-design.md`

## Global Constraints

- **Italiano** nei commenti del codice e nei messaggi di commit.
- **`PROFONDITA_GOMME = 2.4`** — la profondità di `tyreStack.glb`, letta da `SceneryAssetSizes.sizeOf('tyreStack').d`, mai scritta a mano.
- **`FUGA_MINIMA_GOMME = 8`** unità di via di fuga sotto le quali le gomme non nascono. Tarabile una volta sola verso il basso, **mai sotto 6**.
- **`barrierAt` non cambia significato.** Se un task si trova a modificarne il valore restituito, il task è sbagliato.
- **Niente marchi reali** e niente parodie riconoscibili di marchi F1.
- **Una mesh per lato**, come fa gia' il muro: due draw call in tutto per i cartelloni, non uno per pannello.
- **Niente `git add -A`**: aggiungere i file per nome. L'utente lavora in parallelo sulle sue piste — `frontend/tracks/nuova-pista.json` e i `backend/tools/*-raceline.json` non tracciati NON vanno committati.
- **Commit ad ogni task**, chiudendo con:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Y6BHSRzuCoLpajy1xDGndY
  ```
- **Cache-busting**: ogni pagina che carica un modulo condiviso toccato vuole il bump del `?v=` a `20260904b`. Le pagine sono `frontend/f1.html`, `frontend/track-editor.html`, `frontend/track-preview.html`, `frontend/f1-testbench.html`.
- **Baseline dei test, misurata il 2026-09-04 su questo disco** (rimisurarla prima di cominciare):
  - `node --test frontend/shared/` → 1364 test, **5 rossi**: `produce un carosello con panoramica, traguardo e curva`; `tribune e reti restano parallele al muro (melbourne)`; `il decoro del paddock non finisce dentro nient'altro`; `quanto circuito resta senza niente di fianco (nuova-pista)`; `quanto circuito resta senza niente di fianco (suzuka)`.
  - `node --test backend/` → 909 test, **10 rossi + 2 skip**.
- ⚠️ **`prova` è congelata** sulla scenografia cotta in `frontend/tracks/scenografie/prova.json`: le gomme **visive** vengono da lì, il punto d'impatto no. Finché non si ricuoce, su `prova` si sbatterebbe su gomme disegnate altrove. **La ricottura è il Task 7 e non è opzionale.**

## Struttura dei file

| File | Responsabilità |
|---|---|
| `frontend/shared/trackGravel.js` | La banda `gomme` dentro `barrierProfile`, e l'accessor `impattoAt` |
| `frontend/shared/trackGravel.test.js` | Le invarianti del profilo: dove ci sono gomme, di quanto si sbatte prima |
| `backend/sockets/games/physics/CollisionResolver.js:116` | Una riga: la fisica legge `impattoAt` |
| `backend/sockets/games/physics/CollisionResolver.test.js` (nuovo) | Che l'auto si fermi sulle gomme e non sul muro |
| `frontend/shared/sceneryTrackside.js` | Le istanze di `tyreStack` si posano dove si sbatte, e solo dove il profilo le prevede |
| `frontend/shared/sceneryTrackside.test.js` | Le gomme viste e le gomme che fermano sono le stesse |
| `frontend/shared/sponsorAtlas.js` (nuovo) | I venti pannelli: nomi, tinte, e dove cade ciascuno lungo il giro. **Modulo puro, nessun Three** |
| `frontend/shared/sponsorAtlas.test.js` (nuovo) | Passo costante dei pannelli, stessa pista → stessi cartelloni |
| `frontend/shared/trackMeshBuilder.js` | `buildCartelloni`, e la rimozione del ramo `sponsor` dal muro |
| `frontend/shared/trackMeshBuilder.test.js` | Geometria e UV del nastro, col finto THREE |
| `frontend/shared/toonStyle.js` | `sponsorTexture(atlante)`: la CanvasTexture coi pannelli disegnati |
| `frontend/shared/f1Scena.js` | Chiama `buildCartelloni` dopo `buildBarriers` |
| `frontend/shared/toonPalette.js` | Il grigio cemento del muretto |
| `frontend/tracks/scenografie/prova.json` | Ricottura (Task 7) |

---

### Task 1: Le gomme entrano nel profilo di barriera

Il cuore del lavoro. Nessuno le usa ancora: qui si decide soltanto **dove sono** e **di quanto avanza l'impatto**.

**Files:**
- Modify: `frontend/shared/trackGravel.js` — la banda `gomme` in `barrierProfile`, la costante, `impattoAt`, l'export
- Test: `frontend/shared/trackGravel.test.js`

**Interfaces:**
- Produces: `profile.gomme = { left: Uint8Array, right: Uint8Array }` (1 = cuscinetto presente); `TrackGravel.impattoAt(profile, i, side) → number`; `TrackGravel.PROFONDITA_GOMME`; `TrackGravel.FUGA_MINIMA_GOMME`.
- Consumes: `TrackGeometry.findCorners(trackPts)` → `[{ startIdx, endIdx, side, ... }]`, già usato da `sceneryTrackside.js:135`.

- [ ] **Step 1: Scrivere i test che falliscono**

In fondo a `frontend/shared/trackGravel.test.js`:

```js
// --- LE GOMME DAVANTI AL MURO (spec 2026-09-04) --------------------------
//
// La barriera di pneumatici esisteva gia' come scenografia, posata DIETRO il
// muro e quindi invisibile. Da oggi sta davanti e ferma l'auto: il profilo
// dice dove c'e' e di quanto si sbatte prima.
const fsGomme = require('fs');
const pathGomme = require('path');
const { loadTrack: loadTrackGomme } = require('../../backend/sockets/games/trackLoader.js');

const PISTE_GOMME = fsGomme.readdirSync(pathGomme.join(__dirname, '..', 'tracks'))
    .filter(f => f.endsWith('.json') && !/^(__|test-)/.test(f))
    .map(f => f.replace(/\.json$/, ''));

for (const id of PISTE_GOMME) {
    test(`${id}: dove ci sono gomme si sbatte esattamente un cuscinetto prima`, () => {
        const t = loadTrackGomme(id);
        const bp = t.barrierProfile;
        assert.ok(bp.gomme, `${id}: il profilo non porta la banda gomme`);
        let conGomme = 0;
        for (let i = 0; i < t.points.length; i++) {
            for (const side of [1, -1]) {
                const muro = TrackGravel.barrierAt(bp, i, side);
                const impatto = TrackGravel.impattoAt(bp, i, side);
                const banda = side > 0 ? bp.gomme.right : bp.gomme.left;
                if (banda[i]) {
                    conGomme++;
                    assert.ok(Math.abs(muro - impatto - TrackGravel.PROFONDITA_GOMME) < 1e-9,
                        `${id}[${i}/${side}]: muro ${muro.toFixed(2)}, impatto ${impatto.toFixed(2)}`);
                } else {
                    assert.ok(Math.abs(muro - impatto) < 1e-9,
                        `${id}[${i}/${side}]: senza gomme i due profili devono coincidere`);
                }
            }
        }
        // Un tracciato con curve deve averne almeno una: se ne trovi zero
        // ovunque, la soglia e' troppo alta e il test non prova niente.
        if (TrackGeometry.findCorners(t.points).length) {
            assert.ok(conGomme > 0, `${id}: nessuna gomma su una pista che ha curve`);
        }
    });

    test(`${id}: le gomme non stringono la via di fuga sotto le 5 unita'`, () => {
        const t = loadTrackGomme(id);
        const raw = JSON.parse(fsGomme.readFileSync(
            pathGomme.join(__dirname, '..', 'tracks', id + '.json'), 'utf8'));
        for (let i = 0; i < t.points.length; i++) {
            for (const side of [1, -1]) {
                const fuga = TrackGravel.impattoAt(t.barrierProfile, i, side) - raw.roadHalfWidth;
                assert.ok(fuga >= 5 - 1e-9,
                    `${id}[${i}/${side}]: fra cordolo e impatto restano ${fuga.toFixed(2)} unita'`);
            }
        }
    });
}
```

⚠️ Il secondo test **è più severo del mondo di oggi**: su `prova` e `suzuka` la via di fuga scende già a 2.0 dove le gomme non c'entrano niente. Prima di scrivere l'implementazione, eseguirlo e leggere i fallimenti: se un campione fallisce **senza** avere gomme, il test va corretto per misurare solo i campioni con `gomme[i] === 1` (è la regola vera: *le gomme* non devono stringere sotto le 5). Correggerlo subito, prima dello Step 3, e annotare nel commento perché.

- [ ] **Step 2: Eseguire i test e vederli fallire**

Run: `node --test frontend/shared/trackGravel.test.js`
Expected: FAIL, `il profilo non porta la banda gomme`.

- [ ] **Step 3: Scrivere la banda e l'accessor**

In `frontend/shared/trackGravel.js`, accanto alle altre costanti in testa al modulo:

```js
    // ⚠️ LE GOMME NASCONO SOLO DOVE C'E' SPAZIO. Misurato il 2026-09-04 su
    // tutte e dodici le piste: la via di fuga e' larga 18.8 in mediana, ma sta
    // sotto le 5 unita' per un quinto o un terzo del giro, e su citta-prova
    // ovunque (li' il muro sta attaccato al cordolo per scelta). Un cuscinetto
    // profondo 2.4 in un tratto da 4.0 lascerebbe 1.6 unita' fra cordolo e
    // impatto: un muro praticamente sul cordolo. E' anche cio' che si vede in
    // pista vera — dove lo spazio manca c'e' il guard-rail attaccato, le gomme
    // stanno in fondo alla ghiaia.
    const FUGA_MINIMA_GOMME = 8;
```

La profondità **si legge dal modello**, non si scrive:

```js
    // ⚠️ NON UN NUMERO A MANO: e' la profondita' del modello che si vede in
    // pista. Se un giorno tyreStack cambia, l'auto si ferma dove il giocatore
    // vede le gomme, non dove le vedeva prima.
    const PROFONDITA_GOMME = SceneryAssetSizes.sizeOf('tyreStack').d;
```

⚠️ `trackGravel.js` oggi **non dipende** da `sceneryAssetSizes.js`. Aggiungere la dipendenza nel preambolo UMD in testa al file, su entrambi i rami (`require` e `root.SceneryAssetSizes`), e nella riga `factory(...)`. Controllare poi `frontend/shared/ordineScript.test.js`, che verifica l'ordine dei `<script>` nelle pagine: `sceneryAssetSizes.js` deve essere caricato **prima** di `trackGravel.js` in tutte e quattro le pagine.

Dentro `barrierProfile`, dopo il calcolo di `out.gravel` e **prima** del `return out`:

```js
        // ── LE GOMME (spec 2026-09-04) ──
        //
        // Sull'arco esterno di ogni curva, dove la via di fuga lo consente. Le
        // curve le trova la stessa funzione che decide la ghiaia: due sistemi
        // che vedono curve diverse darebbero un cuscinetto dove la ghiaia non
        // c'e', e viceversa.
        out.gomme = { left: new Uint8Array(n), right: new Uint8Array(n) };
        for (const corner of TrackGeometry.findCorners(trackPts)) {
            const banda = corner.side > 0 ? out.gomme.right : out.gomme.left;
            const muri = corner.side > 0 ? out.right : out.left;
            const archi = ((corner.endIdx - corner.startIdx) % n + n) % n;
            for (let s = 0; s <= archi; s++) {
                const i = (corner.startIdx + s) % n;
                // La via di fuga di QUESTO campione, non quella media della
                // curva: dentro un arco lungo il muro si avvicina e si
                // allontana, e il cuscinetto deve seguire il punto.
                if (muri[i] - mezzaAl(trackPts, i, roadHalf) < FUGA_MINIMA_GOMME) continue;
                banda[i] = 1;
            }
        }
```

E l'accessor, accanto a `barrierAt`:

```js
    // Dove si SBATTE: il muro, meno il cuscinetto di gomme dove c'e'.
    //
    // ⚠️ E' UN SECONDO NOME, NON UN CAMBIO DI SIGNIFICATO. `barrierAt` continua
    // a dire dov'e' il MURO, e lo chiedono in quattordici punti fra scenografia,
    // mesh e citta': a tutti loro serve il muro. La collisione e' UNA di quelle
    // quattordici. Cambiare il valore di `barrierAt` avrebbe dato in silenzio il
    // numero sbagliato agli altri tredici — oggetti posati dentro le gomme, e un
    // difetto che si scopre in pista invece che in un test.
    function impattoAt(profile, i, side) {
        const muro = barrierAt(profile, i, side);
        if (!profile.gomme) return muro;
        const banda = side > 0 ? profile.gomme.right : profile.gomme.left;
        const k = ((i % banda.length) + banda.length) % banda.length;
        return banda[k] ? muro - PROFONDITA_GOMME : muro;
    }
```

Nell'export (riga ~705), aggiungere `impattoAt, PROFONDITA_GOMME, FUGA_MINIMA_GOMME`.

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test frontend/shared/trackGravel.test.js`
Expected: PASS. Se `nessuna gomma su una pista che ha curve` fallisce su qualche pista, misurare **quanto** di quella curva sopravvive alla soglia con:

```bash
node -e "
const TG=require('./frontend/shared/trackGeometry.js');
const TGr=require('./frontend/shared/trackGravel.js');
const {loadTrack}=require('./backend/sockets/games/trackLoader.js');
for(const id of ['melbourne','suzuka','citta-prova','monte-rosso','prova']){
  const t=loadTrack(id); const bp=t.barrierProfile;
  let con=0,tot=0;
  for(let i=0;i<t.points.length;i++) for(const s of [1,-1]){ tot++; if((s>0?bp.gomme.right:bp.gomme.left)[i]) con++; }
  console.log(id, 'campioni con gomme:', con, 'su', tot, '('+Math.round(100*con/tot)+'%)');
}"
```

Se una pista con curve resta a zero, abbassare `FUGA_MINIMA_GOMME` **una volta** a 6 e rimisurare. Mai sotto: a 6 restano 3.6 unità di fuga, meno di un cordolo. Se anche a 6 resta a zero, **fermarsi e riferire**: vuol dire che quella pista non ha vie di fuga, ed è una notizia sulla pista.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/trackGravel.js frontend/shared/trackGravel.test.js
git commit
```
Messaggio: `Le gomme entrano nel profilo: dove ci sono, si sbatte prima`

---

### Task 2: La fisica sbatte sulle gomme

Una riga, e il test che la protegge.

**Files:**
- Modify: `backend/sockets/games/physics/CollisionResolver.js:116`
- Test: `backend/sockets/games/physics/CollisionResolver.test.js` (nuovo)

**Interfaces:**
- Consumes: `TrackGravel.impattoAt` dal Task 1.

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `backend/sockets/games/physics/CollisionResolver.test.js`:

```js
// Il muro ferma l'auto dove il giocatore VEDE qualcosa. Dal 2026-09-04 quel
// qualcosa, sull'arco esterno delle curve, sono le gomme: sono davanti al
// muro, e fermano loro.
const test = require('node:test');
const assert = require('node:assert/strict');
const TrackGravel = require('../../../../frontend/shared/trackGravel.js');
const { loadTrack } = require('../trackLoader.js');
const { applyBarrier } = require('./CollisionResolver.js');

// Il primo campione con le gomme su una pista con curve larghe.
function campioneConGomme(track) {
    for (let i = 0; i < track.points.length; i++) {
        for (const side of [1, -1]) {
            const banda = side > 0 ? track.barrierProfile.gomme.right
                                   : track.barrierProfile.gomme.left;
            if (banda[i]) return { i, side };
        }
    }
    return null;
}

test('sul cuscinetto di gomme l auto si ferma prima del muro', () => {
    const track = loadTrack('melbourne');
    const dove = campioneConGomme(track);
    assert.ok(dove, 'melbourne non ha un solo campione con le gomme');
    const pt = track.points[dove.i];
    const { nx, nz } = require('../../../../frontend/shared/trackGeometry.js')
        .normalAt(track.points, dove.i, true);
    const muro = TrackGravel.barrierAt(track.barrierProfile, dove.i, dove.side);

    // Un'auto lanciata OLTRE il muro: dopo applyBarrier deve stare al di qua
    // delle gomme, non al di qua del muro.
    const p = {
        x: pt.x + nx * dove.side * (muro + 5), z: pt.z + nz * dove.side * (muro + 5),
        vx: 0, vz: 0, speed: 0, trackIndex: dove.i, angle: 0, damage: {},
    };
    applyBarrier(p, track, false);
    const dist = Math.hypot(p.x - pt.x, p.z - pt.z);
    const impatto = TrackGravel.impattoAt(track.barrierProfile, dove.i, dove.side);
    assert.ok(dist <= impatto + 1e-6,
        `l'auto si e' fermata a ${dist.toFixed(2)}, oltre le gomme che stanno a ${impatto.toFixed(2)}`);
});
```

⚠️ `applyBarrier` deve essere esportato da `CollisionResolver.js`. Se non lo è, aggiungerlo a `module.exports` — è un'aggiunta, non una modifica al comportamento. E se la firma di `p` richiede più campi di quelli qui sopra, leggerla in `applyBarrier` e completare l'oggetto: il test deve costruire un'auto che quella funzione accetta, non una finta.

- [ ] **Step 2: Eseguire il test e vederlo fallire**

Run: `node --test backend/sockets/games/physics/CollisionResolver.test.js`
Expected: FAIL — l'auto si ferma sul muro, che sta 2.4 più in là delle gomme.

- [ ] **Step 3: Cambiare la riga**

In `backend/sockets/games/physics/CollisionResolver.js`, riga 116:

```js
        limit = TrackGravel.impattoAt(track.barrierProfile, idx, side);
```

E aggiornare il commento appena sopra, che oggi dice «Dove sta il muro»:

```js
    // Dove si SBATTE. Non è sempre il muro: sull'arco esterno delle curve, dove
    // la via di fuga lo consente, davanti al muro c'è un cuscinetto di gomme, e
    // l'auto si ferma su quello. Il profilo è calcolato dalla STESSA funzione
    // con cui il client lo disegna (TrackGravel.barrierProfile, via
    // trackLoader), e le gomme che si vedono sono posate a questa stessa
    // distanza: il muro fisico e quello disegnato non possono divergere, che è
    // l'unico modo per non sbattere contro qualcosa che non si vede.
```

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test backend/sockets/games/physics/CollisionResolver.test.js` → PASS
Poi `node --test backend/` per intero: **gli stessi 10 rossi della baseline, non uno di più.**

- [ ] **Step 5: Commit**

```bash
git add backend/sockets/games/physics/CollisionResolver.js backend/sockets/games/physics/CollisionResolver.test.js
git commit
```
Messaggio: `Si sbatte sulle gomme, non sul muro dietro di loro`

---

### Task 3: Le gomme che si vedono sono quelle che fermano

**Files:**
- Modify: `frontend/shared/sceneryTrackside.js:25-26,135-150`
- Test: `frontend/shared/sceneryTrackside.test.js`

**Interfaces:**
- Consumes: `TrackGravel.impattoAt`, `profile.gomme`, `TrackGravel.PROFONDITA_GOMME` dal Task 1.

- [ ] **Step 1: Scrivere il test che fallisce**

In `frontend/shared/sceneryTrackside.test.js`, accanto ai test esistenti sulle gomme:

```js
test('ogni pila di gomme sta dove l auto si ferma, non oltre il muro', () => {
    // ⚠️ Fino al 2026-09-04 le pile stavano a barrierDist + 2.5, cioe' DIETRO
    // il muro: invisibili. La fila che si vede dev'essere la fila che ferma.
    for (const id of PISTE) {
        const { items, trackPts, barrierProfile } = scenografiaDi(id);
        for (const g of items.filter(i => i.asset === 'tyreStack')) {
            const q = TrackGeometry.nearestPoint(trackPts, g.x, g.z);
            const nrm = TrackGeometry.normalAt(trackPts, q.index, true);
            const side = Math.sign((g.x - trackPts[q.index].x) * nrm.nx +
                                   (g.z - trackPts[q.index].z) * nrm.nz) || 1;
            const impatto = TrackGravel.impattoAt(barrierProfile, q.index, side);
            const meta = TrackGravel.PROFONDITA_GOMME / 2;
            assert.ok(Math.abs(q.dist - (impatto + meta)) < 1.5,
                `${id}: una pila sta a ${q.dist.toFixed(2)} mentre si sbatte a ${impatto.toFixed(2)}`);
        }
    }
});

test('non nascono gomme dove il profilo non le prevede', () => {
    for (const id of PISTE) {
        const { items, trackPts, barrierProfile } = scenografiaDi(id);
        for (const g of items.filter(i => i.asset === 'tyreStack')) {
            const q = TrackGeometry.nearestPoint(trackPts, g.x, g.z);
            const nrm = TrackGeometry.normalAt(trackPts, q.index, true);
            const side = Math.sign((g.x - trackPts[q.index].x) * nrm.nx +
                                   (g.z - trackPts[q.index].z) * nrm.nz) || 1;
            const banda = side > 0 ? barrierProfile.gomme.right : barrierProfile.gomme.left;
            assert.equal(banda[q.index], 1,
                `${id}: una pila a (${g.x.toFixed(0)}, ${g.z.toFixed(0)}) dove il profilo non ha cuscinetto`);
        }
    }
});
```

⚠️ `scenografiaDi(id)` va costruita come già fanno gli altri test del file: se non restituisce `trackPts` e `barrierProfile`, estenderla — non duplicarla.

- [ ] **Step 2: Eseguire i test e vederli fallire**

Run: `node --test frontend/shared/sceneryTrackside.test.js`
Expected: FAIL, le pile stanno 2.5 oltre il muro invece che davanti.

- [ ] **Step 3: Posare le gomme dove si sbatte**

In `frontend/shared/sceneryTrackside.js`, sostituire il blocco che oggi posa `tyreStack` (righe ~137-149):

```js
            // Barriera di pneumatici lungo l'arco esterno della curva, DOVE IL
            // PROFILO LA PREVEDE: la stessa banda su cui si regola la fisica.
            // Prima del 2026-09-04 nascevano su tutto l'arco e a barrierDist +
            // 2.5, cioe' dietro il muro — si vedeva il muro, si sbatteva sul
            // muro, e le gomme erano una fila di modelli nascosti.
            const arcSamples = (corner.endIdx - corner.startIdx + n) % n;
            const stepSamples = Math.max(1, Math.round(TYRE_STEP / stepLen));
            for (let s = 0; s <= arcSamples; s += stepSamples) {
                const idx = (corner.startIdx + s) % n;
                if (onBridge(idx)) continue;
                if (!barrierProfile) continue;
                const banda = corner.side > 0 ? barrierProfile.gomme.right
                                              : barrierProfile.gomme.left;
                if (!banda[idx]) continue;
                // Il centro del modello sta mezza profondita' oltre il punto
                // d'impatto: l'auto tocca la FACCIA delle gomme, non il loro
                // centro.
                const dist = TrackGravel.impattoAt(barrierProfile, idx, corner.side)
                           + TrackGravel.PROFONDITA_GOMME / 2;
                const pos = place(trackPts, groundPts, idx, dist,
                                  corner.side, barrierDist, embankStart, embankOuter);
                if (!usable('tyreStack', pos.x, pos.z, pos.y, pitRoadHalf + 6)) continue;
                layout.push(Object.assign({ asset: 'tyreStack', category: 'safety', scale: 1 }, pos));
            }
```

E togliere la costante `TYRE_MARGIN` (riga 26), che non serve più: se resta, il prossimo lettore penserà che sia ancora lei a decidere.

⚠️ `barrierProfile` deve essere nello scope di questa funzione. Se non c'è, prenderlo dal `ctx` come fanno gli altri moduli di scenografia (`sceneryInfrastructure.js:64` mostra il pattern). Se il chiamante non lo passa, passarlo: senza profilo le gomme non nascono, ed è il comportamento giusto per l'editor e i test storici.

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test frontend/shared/sceneryTrackside.test.js` → PASS
Poi `node --test frontend/shared/` per intero: **gli stessi 5 rossi della baseline.** ⚠️ Attenzione particolare a `il decoro del paddock non finisce dentro nient'altro` e alle invarianti di compenetrazione: le gomme si sono spostate di quasi cinque unità verso la pista, e qualcosa che prima stava loro accanto potrebbe ora sovrapporsi.

- [ ] **Step 5: La scenografia non finisce dentro le gomme**

Le pile si sono spostate di quasi cinque unità verso la pista, e la scenografia
si dispone a partire dal MURO: fra il muro e le gomme adesso c'è una fascia in
cui nulla deve nascere. Aggiungere a `frontend/shared/sceneryTrackside.test.js`:

```js
test('nessun oggetto di scenografia sta fra le gomme e il muro', () => {
    for (const id of PISTE) {
        const { items, trackPts, barrierProfile } = scenografiaDi(id);
        for (const v of items) {
            if (v.asset === 'tyreStack') continue;
            const q = TrackGeometry.nearestPoint(trackPts, v.x, v.z);
            const nrm = TrackGeometry.normalAt(trackPts, q.index, true);
            const side = Math.sign((v.x - trackPts[q.index].x) * nrm.nx +
                                   (v.z - trackPts[q.index].z) * nrm.nz) || 1;
            const banda = side > 0 ? barrierProfile.gomme.right : barrierProfile.gomme.left;
            if (!banda[q.index]) continue;
            const impatto = TrackGravel.impattoAt(barrierProfile, q.index, side);
            const muro = TrackGravel.barrierAt(barrierProfile, q.index, side);
            assert.ok(q.dist <= impatto || q.dist >= muro,
                `${id}: ${v.asset} a ${q.dist.toFixed(2)}, dentro il cuscinetto (${impatto.toFixed(2)}..${muro.toFixed(2)})`);
        }
    }
});
```

⚠️ Se questo test trova oggetti, **non allargare la tolleranza**: significa che
un modulo di scenografia posa a partire da un numero che non è più il bordo
buono, e va corretto lì. La fascia è larga 2.4: un oggetto lì dentro compare
davanti alle gomme, in mezzo alla via di fuga.

- [ ] **Step 6: Misurare la compenetrazione fra pile vicine**

Il modello è largo 7.0 e il passo è 7: in curva stretta le pile si incastrano sul lato interno. Misurare lo scarto peggiore:

```bash
node -e "
const TG=require('./frontend/shared/trackGeometry.js');
const TS=require('./frontend/shared/trackScenery.js');
const {loadTrack}=require('./backend/sockets/games/trackLoader.js');
const fs=require('fs');
const seats=require('./frontend/assets/custom/circuit/grandStandSeats.json').seats;
const anc=require('./frontend/assets/custom/circuit/terraceAnchors.json').anchors;
for(const id of ['melbourne','suzuka','monte-rosso','prova']){
  const raw=JSON.parse(fs.readFileSync('frontend/tracks/'+id+'.json','utf8'));
  const t=loadTrack(id);
  const l=TS.generateLayout(raw,t.points,t.pitLanePts,raw.roadHalfWidth+2.8+1.2,45,seats,t.barrierProfile,anc,{gridSize:6});
  const g=l.filter(v=>v.asset==='tyreStack');
  let peggio=0;
  for(let i=0;i<g.length;i++) for(let j=i+1;j<g.length;j++){
    const d=Math.hypot(g[i].x-g[j].x,g[i].z-g[j].z);
    if(d<7) peggio=Math.max(peggio,7-d);
  }
  console.log(id,'pile:',g.length,' compenetrazione peggiore:',peggio.toFixed(2));
}"
```

Riportare i numeri. Sopra le 2 unità, dirlo prima di andare avanti: fra volumi identici non si vede quasi nulla, ma è una decisione dell'utente, non nostra.

- [ ] **Step 7: Commit**

```bash
git add frontend/shared/sceneryTrackside.js frontend/shared/sceneryTrackside.test.js
git commit
```
Messaggio: `Le gomme che si vedono sono quelle che fermano`

---

### Task 4: La ghiaia si ferma alle gomme

**Files:**
- Modify: `frontend/shared/trackGravel.js` — il clamp di `out.gravel`
- Test: `frontend/shared/trackGravel.test.js`

**Interfaces:**
- Consumes: `profile.gomme`, `PROFONDITA_GOMME` dal Task 1.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
test('la ghiaia non passa sotto le gomme', () => {
    for (const id of PISTE_GOMME) {
        const t = loadTrackGomme(id);
        const raw = JSON.parse(fsGomme.readFileSync(
            pathGomme.join(__dirname, '..', 'tracks', id + '.json'), 'utf8'));
        const bp = t.barrierProfile;
        for (let i = 0; i < t.points.length; i++) {
            for (const side of [1, -1]) {
                const banda = side > 0 ? bp.gomme.right : bp.gomme.left;
                if (!banda[i]) continue;
                const bordoCordolo = raw.roadHalfWidth + 2.8;
                const fineGhiaia = bordoCordolo + TrackGravel.gravelAt(bp.gravel, i, side);
                const impatto = TrackGravel.impattoAt(bp, i, side);
                assert.ok(fineGhiaia <= impatto + 1e-6,
                    `${id}[${i}/${side}]: la ghiaia arriva a ${fineGhiaia.toFixed(2)}, le gomme a ${impatto.toFixed(2)}`);
            }
        }
    }
});
```

⚠️ `bordoCordolo` qui è ricostruito a mano con il 2.8 di `CURB_W`. Se `trackGravel.js` espone già la larghezza del cordolo, usarla da lì: un 2.8 scritto a mano in un test è la stessa trappola dell'11 del palazzo dei box.

- [ ] **Step 2: Eseguire il test e vederlo fallire**

Run: `node --test frontend/shared/trackGravel.test.js`
Expected: FAIL dove la ghiaia arriva fino al muro vecchio.

- [ ] **Step 3: Limitare la ghiaia al punto d'impatto**

In `barrierProfile`, il clamp di `out.gravel` oggi è:

```js
            out.gravel.left[i] = Math.max(0, Math.min(gravel.left[i], out.left[i] - bordoCordoloAl(i)));
            out.gravel.right[i] = Math.max(0, Math.min(gravel.right[i], out.right[i] - bordoCordoloAl(i)));
```

⚠️ **Va spostato DOPO il calcolo della banda `gomme`** (che nel Task 1 è stato messo prima del `return`), perché ora dipende da lei. Nuova versione:

```js
        // La ghiaia arriva fino a dove si SBATTE, non fino al muro: sotto un
        // cuscinetto di gomme non c'e' ghiaia, ci sono le gomme.
        for (let i = 0; i < n; i++) {
            const finoA = (side, muri) => impattoDa(out, i, side, muri) - bordoCordoloAl(i);
            out.gravel.left[i] = Math.max(0, Math.min(gravel.left[i], finoA(-1)));
            out.gravel.right[i] = Math.max(0, Math.min(gravel.right[i], finoA(1)));
        }
```

dove `impattoDa` è la stessa formula di `impattoAt` applicata a `out` mentre lo si sta ancora costruendo:

```js
    // impattoAt lavora su un profilo finito; qui serve lo stesso conto DENTRO
    // barrierProfile, dove `out` non e' ancora stato restituito.
    function impattoDa(out, i, side) {
        const muro = side > 0 ? out.right[i] : out.left[i];
        const banda = side > 0 ? out.gomme.right : out.gomme.left;
        return banda[i] ? muro - PROFONDITA_GOMME : muro;
    }
```

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test frontend/shared/trackGravel.test.js` → PASS
Poi `node --test frontend/shared/` e `node --test backend/`: gli stessi rossi della baseline.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/trackGravel.js frontend/shared/trackGravel.test.js
git commit
```
Messaggio: `Sotto le gomme non c'e' ghiaia: ci sono le gomme`

---

### Task 5: L'atlante degli sponsor

Un modulo puro che decide **quali** pannelli e **dove** cadono, senza toccare Three: così le invarianti si provano in Node.

**Files:**
- Create: `frontend/shared/sponsorAtlas.js`
- Test: `frontend/shared/sponsorAtlas.test.js` (nuovo)

**Interfaces:**
- Produces:
  - `SponsorAtlas.PANNELLI` → array di 20 `{ nome, fondo, banda }` (`fondo`/`banda` interi 0xRRGGBB);
  - `SponsorAtlas.LUNGHEZZA_PANNELLO` → number (unità di gioco);
  - `SponsorAtlas.sequenza(trackId, quanti)` → array di indici in `PANNELLI`, lungo `quanti`, stabile per `trackId`.
- Consumes: `Palette.CITTA_SPONSOR` da `toonPalette.js`; `hashString`/`mulberry32` da `semeStabile.js`.

- [ ] **Step 1: Scrivere i test che falliscono**

Creare `frontend/shared/sponsorAtlas.test.js`:

```js
// I venti sponsor inventati dei cartelloni a bordo pista (spec 2026-09-04).
const test = require('node:test');
const assert = require('node:assert/strict');
const SponsorAtlas = require('./sponsorAtlas.js');

test('venti pannelli, tutti con nome e due tinte', () => {
    assert.equal(SponsorAtlas.PANNELLI.length, 20);
    for (const p of SponsorAtlas.PANNELLI) {
        assert.match(p.nome, /^[A-Z]{4,9}$/, `nome strano: ${p.nome}`);
        assert.equal(typeof p.fondo, 'number');
        assert.equal(typeof p.banda, 'number');
    }
});

test('i nomi sono tutti diversi', () => {
    const nomi = SponsorAtlas.PANNELLI.map(p => p.nome);
    assert.equal(new Set(nomi).size, nomi.length);
});

test('la stessa pista mostra sempre gli stessi cartelloni', () => {
    const a = SponsorAtlas.sequenza('melbourne', 50);
    const b = SponsorAtlas.sequenza('melbourne', 50);
    assert.deepEqual(a, b);
    // E piste diverse non mostrano la stessa fila.
    assert.notDeepEqual(a, SponsorAtlas.sequenza('suzuka', 50));
});

test('due cartelloni uguali non stanno mai attaccati', () => {
    // Il difetto da cui nasce tutto questo lavoro e' «sembra tutto uguale»:
    // due pannelli identici di fila lo riproducono in piccolo.
    for (const id of ['melbourne', 'suzuka', 'prova', 'citta-prova']) {
        const seq = SponsorAtlas.sequenza(id, 200);
        for (let k = 1; k < seq.length; k++) {
            assert.notEqual(seq[k], seq[k - 1], `${id}: due uguali in fila alla posizione ${k}`);
        }
    }
});

test('la sequenza usa tutti e venti i pannelli su un giro lungo', () => {
    const seq = SponsorAtlas.sequenza('melbourne', 200);
    assert.equal(new Set(seq).size, SponsorAtlas.PANNELLI.length);
});
```

- [ ] **Step 2: Eseguire i test e vederli fallire**

Run: `node --test frontend/shared/sponsorAtlas.test.js`
Expected: FAIL, `Cannot find module './sponsorAtlas.js'`.

- [ ] **Step 3: Scrivere il modulo**

Creare `frontend/shared/sponsorAtlas.js`:

```js
// frontend/shared/sponsorAtlas.js
//
// I cartelloni pubblicitari a bordo pista: chi sono e in che ordine si
// susseguono lungo il giro.
//
// ⚠️ MARCHI INVENTATI, e nessuno che sia la storpiatura riconoscibile di un
// marchio vero: e' una regola del progetto dal 2026-08-27, e vale anche
// quando la parodia sarebbe divertente.
//
// Modulo puro, nessuna dipendenza da Three: qui si decide COSA e DOVE, il
// disegno lo fa toonStyle e la geometria trackMeshBuilder.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./toonPalette.js'), require('./semeStabile.js'));
    } else {
        root.SponsorAtlas = factory(root.ToonPalette, root.SemeStabile);
    }
})(typeof self !== 'undefined' ? self : this, function (Palette, Seme) {

    // Quanto e' lungo un pannello in unita' di gioco. La pista e' larga 22:
    // un cartellone da 12 e' poco piu' di mezza carreggiata, la proporzione
    // dei pannelli veri a bordo pista.
    const LUNGHEZZA_PANNELLO = 12;

    const NOMI = [
        'VELOCE', 'AEROTEC', 'NOVARIS', 'KILOVOLT', 'FULMINE',
        'ORBITEC', 'VERTICE', 'LAMPO', 'CRONOMAX', 'TURBINA',
        'ASSOLUTA', 'QUADRANTE', 'IPERION', 'MERIDIA', 'VOLTARIS',
        'ALTAVIA', 'BOREALE', 'ZEFIRO', 'PRIMATO', 'CIRRO',
    ];

    // Le sei coppie fondo/banda esistono gia' e sono state scelte per essere
    // leggibili a velocita' di gara: si riusano a rotazione sui venti nomi.
    const PANNELLI = NOMI.map(function (nome, k) {
        const tinta = Palette.CITTA_SPONSOR[k % Palette.CITTA_SPONSOR.length];
        return { nome: nome, fondo: tinta.fondo, banda: tinta.banda };
    });

    // L'ordine dei cartelloni lungo il giro: stabile per pista, e mai due
    // uguali di fila.
    function sequenza(trackId, quanti) {
        const rng = Seme.mulberry32(Seme.hashString(String(trackId) + ':sponsor'));
        const out = [];
        for (let k = 0; k < quanti; k++) {
            let scelto = Math.floor(rng() * PANNELLI.length) % PANNELLI.length;
            // Mai due uguali attaccati: il difetto da cui nasce questo lavoro
            // e' «sembra tutto uguale».
            if (k > 0 && scelto === out[k - 1]) scelto = (scelto + 1) % PANNELLI.length;
            out.push(scelto);
        }
        return out;
    }

    return { PANNELLI: PANNELLI, LUNGHEZZA_PANNELLO: LUNGHEZZA_PANNELLO, sequenza: sequenza };
});
```

⚠️ Verificare i nomi esportati da `semeStabile.js` prima di usarli: se non si chiamano `hashString` e `mulberry32`, adeguare — non aggiungere alias.

⚠️ Il test `la sequenza usa tutti e venti i pannelli` può fallire per sfortuna del seme. Se fallisce su una pista, **non alzare il numero di campioni per farlo passare**: significa che la distribuzione è sbilanciata, e va corretta la scelta (per esempio pescando da un sacchetto che si rimescola quando è vuoto, invece che a caso puro).

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test frontend/shared/sponsorAtlas.test.js`
Expected: PASS, tutti e cinque.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/sponsorAtlas.js frontend/shared/sponsorAtlas.test.js
git commit
```
Messaggio: `Venti sponsor inventati, e mai due uguali di fila`

---

### Task 6: Il nastro dei cartelloni

**Files:**
- Modify: `frontend/shared/toonStyle.js` — `sponsorTexture()`
- Modify: `frontend/shared/trackMeshBuilder.js` — `buildCartelloni`, e la rimozione del ramo `sponsor` da `buildBarriers`
- Modify: `frontend/shared/f1Scena.js:181` — la chiamata
- Modify: `frontend/shared/toonPalette.js` — il grigio cemento
- Modify: `frontend/f1.html`, `track-editor.html`, `track-preview.html`, `f1-testbench.html` — lo `<script>` di `sponsorAtlas.js` e il bump
- Test: `frontend/shared/trackMeshBuilder.test.js`

**Interfaces:**
- Consumes: `SponsorAtlas.PANNELLI`, `SponsorAtlas.LUNGHEZZA_PANNELLO`, `SponsorAtlas.sequenza` dal Task 5; `TrackGravel.barrierAt` (il MURO, non l'impatto) e `profile.gomme` dal Task 1.
- Produces: `TrackMeshBuilder.buildCartelloni(container, pts, distFromCenter, mergePoints, quotaBase, opzioni)`; `ToonStyle.sponsorTexture(pannelli)`.

- [ ] **Step 1: Scrivere il test della geometria**

In `frontend/shared/trackMeshBuilder.test.js`:

```js
test('il nastro dei cartelloni sta SOPRA il muretto, non davanti', () => {
    const pts = pistaDritta(60);            // helper gia' nel file
    const cont = new THREE.Object3D();
    TrackMeshBuilder.buildCartelloni(cont, pts, () => 20, null, null,
        { gomme: null, trackId: 'test' });
    const g = cont.children[0].geometry.attributes.position.array;
    let minY = Infinity, maxY = -Infinity, minD = Infinity, maxD = -Infinity;
    for (let k = 0; k < g.length; k += 3) {
        minY = Math.min(minY, g[k + 1]); maxY = Math.max(maxY, g[k + 1]);
        const d = Math.abs(g[k + 2]);
        minD = Math.min(minD, d); maxD = Math.max(maxD, d);
    }
    // Il muretto e' alto 1.1: il nastro comincia li' e sale di 1.6.
    assert.ok(Math.abs(minY - 1.1) < 0.01, `il nastro parte da ${minY}`);
    assert.ok(Math.abs(maxY - 2.7) < 0.01, `il nastro arriva a ${maxY}`);
    // E sta alla stessa distanza del muro, non davanti.
    assert.ok(Math.abs(minD - 20) < 0.01 && Math.abs(maxD - 20) < 0.01,
        `il nastro sta fra ${minD} e ${maxD} invece che a 20`);
});

test('dove ci sono le gomme il cartellone non nasce', () => {
    const pts = pistaDritta(60);
    const gomme = { left: new Uint8Array(60), right: new Uint8Array(60) };
    for (let i = 20; i < 40; i++) gomme.right[i] = 1;
    const cont = new THREE.Object3D();
    TrackMeshBuilder.buildCartelloni(cont, pts, () => 20, null, null,
        { gomme, trackId: 'test' });
    // Il tratto 20..40 sul lato destro non deve avere vertici.
    const g = cont.children[0].geometry.attributes.position.array;
    // pistaDritta corre lungo X: i campioni 20..40 stanno fra due X note.
    const xDa = pts[20].x, xA = pts[40].x;
    let dentro = 0;
    for (let k = 0; k < g.length; k += 3) {
        if (g[k] > xDa + 0.01 && g[k] < xA - 0.01 && g[k + 2] > 0) dentro++;
    }
    assert.equal(dentro, 0, `${dentro} vertici di cartellone sopra le gomme`);
});

test('i pannelli hanno passo costante anche in curva', () => {
    // ⚠️ E' l'invariante che vale il modo in cui si calcolano le UV: prese
    // dall'INDICE del campione, in curva il bordo esterno e' piu' lungo
    // dell'asse e le scritte si stirano.
    const pts = pistaCurva(120);            // helper gia' nel file
    const cont = new THREE.Object3D();
    TrackMeshBuilder.buildCartelloni(cont, pts, () => 20, null, null,
        { gomme: null, trackId: 'test' });
    const geo = cont.children[0].geometry;
    const pos = geo.attributes.position.array, uv = geo.attributes.uv.array;
    // Per ogni coppia di vertici consecutivi sulla stessa quota, il rapporto
    // fra distanza in mondo e passo di u deve restare costante.
    const rapporti = [];
    for (let k = 4; k < pos.length / 3; k += 4) {
        const dx = pos[k * 3] - pos[(k - 4) * 3];
        const dz = pos[k * 3 + 2] - pos[(k - 4) * 3 + 2];
        const du = uv[k * 2] - uv[(k - 4) * 2];
        if (Math.abs(du) < 1e-9) continue;
        rapporti.push(Math.hypot(dx, dz) / du);
    }
    const min = Math.min.apply(null, rapporti), max = Math.max.apply(null, rapporti);
    assert.ok((max - min) / max < 0.05,
        `il passo dei pannelli varia del ${(100 * (max - min) / max).toFixed(1)}%`);
});
```

⚠️ Se `pistaDritta` e `pistaCurva` non esistono in quel file con quei nomi, usare gli helper che ci sono (leggerli in testa al file) invece di crearne di nuovi.

- [ ] **Step 2: Eseguire i test e vederli fallire**

Run: `node --test frontend/shared/trackMeshBuilder.test.js`
Expected: FAIL, `buildCartelloni is not a function`.

- [ ] **Step 3: La texture**

In `frontend/shared/toonStyle.js`, accanto alle altre funzioni di texture:

```js
    // L'atlante dei cartelloni: i pannelli affiancati in orizzontale, ciascuno
    // fondo + nome + banda.
    //
    // ⚠️ TESTO NETTO, non sfumato. In cel shading una scritta con l'antialias
    // spinto diventa una macchia grigia — e' la stessa lezione delle finestre
    // delle facciate di citta', che come vertex color sembravano tende a
    // coste. Font pesante, niente ombre, niente bordi morbidi.
    function sponsorTexture(pannelli) {
        const LARGO = 256, ALTO = 128;      // per pannello
        const c = document.createElement('canvas');
        c.width = LARGO * pannelli.length;
        c.height = ALTO;
        const ctx = c.getContext('2d');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        pannelli.forEach(function (p, k) {
            const x0 = k * LARGO;
            ctx.fillStyle = '#' + p.fondo.toString(16).padStart(6, '0');
            ctx.fillRect(x0, 0, LARGO, ALTO);
            // La banda chiara: una fascia orizzontale al centro, su cui sta il
            // nome. E' quanto si legge davvero passandoci a 250 all'ora.
            ctx.fillStyle = '#' + p.banda.toString(16).padStart(6, '0');
            ctx.fillRect(x0, ALTO * 0.28, LARGO, ALTO * 0.44);
            ctx.fillStyle = '#' + p.fondo.toString(16).padStart(6, '0');
            ctx.font = 'bold ' + Math.round(ALTO * 0.30) + 'px sans-serif';
            ctx.fillText(p.nome, x0 + LARGO / 2, ALTO * 0.5);
        });
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        return tex;
    }
```

Aggiungerla all'export del modulo.

- [ ] **Step 4: Il nastro**

⚠️ **Il nastro si spezza a ogni pannello.** Con le UV continue (`u` che scorre
da 0 all'infinito su un atlante ripetuto) i cartelloni si susseguirebbero
sempre nello stesso ordine ciclico — 1, 2, 3, … 20, 1, 2, 3 — e
`SponsorAtlas.sequenza` non servirebbe a niente. Peggio: un ordine fisso
ripetuto è di nuovo «sembra tutto uguale», che è il difetto da cui nasce questo
lavoro. Quindi ogni pannello prende **il suo pezzo di nastro**, con vertici
doppi al confine: alla stessa posizione due vertici con `u` diverso, così la
scritta finisce di netto e la successiva comincia dal suo bordo. È lo stesso
schema dei vertici doppi che il ramo sponsor del 27-08 usava per la banda, e
che qui viene rimosso: la tecnica resta valida, cambia a cosa serve.

In `frontend/shared/trackMeshBuilder.js`, dopo `buildBarriers`:

```js
    // IL NASTRO DEI CARTELLONI (spec 2026-09-04).
    //
    // Una fascia estrusa alta CARTELLO_H, posata SOPRA il muretto — che e'
    // alto MURO_H. ⚠️ Sopra e non davanti: davanti ruberebbe unita' alla via
    // di fuga, che su un quinto o un terzo del giro e' larga appena 4.
    //
    // Nasce dove il muro NON ha le gomme davanti: in curva il muro resta nudo
    // dietro il cuscinetto, com'e' in pista vera.
    function buildCartelloni(container, pts, distFromCenter, mergePoints, quotaBase, opzioni) {
        const MURO_H = 1.1;
        const CARTELLO_H = 1.6;
        const distAt = typeof distFromCenter === 'function' ? distFromCenter : () => distFromCenter;
        const n = pts.length;
        const o = opzioni || {};
        const gomme = o.gomme || null;
        const passo = SponsorAtlas.LUNGHEZZA_PANNELLO;
        const atlante = SponsorAtlas.PANNELLI.length;

        for (const side of [-1, 1]) {
            // PRIMO GIRO: dove sta il nastro, quanto si e' percorso, e se
            // questo campione e' saltato. Serve una tabella prima di
            // costruire, perche' il confine di un pannello puo' cadere in
            // mezzo a un campione e li' servono due vertici.
            const bordo = new Array(n);
            let percorso = 0;
            for (let i = 0; i < n; i++) {
                const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
                const p = pts[i];
                const d = distAt(i, side);
                const bx = p.x + nx * d * side, bz = p.z + nz * d * side;
                if (i > 0) percorso += Math.hypot(bx - bordo[i - 1].bx, bz - bordo[i - 1].bz);
                const banda = gomme ? (side > 0 ? gomme.right : gomme.left) : null;
                // Niente cartellone dove ci sono le gomme, dove il nastro si
                // apre per la corsia box, e dentro un giro della morte — che
                // e' chiuso e non ha un fuori su cui affacciare un pannello.
                const saltato = !!(banda && banda[i])
                    || !!p.acrobatico
                    || !!(mergePoints && TrackGeometry.nearestPoint(mergePoints, bx, bz).dist
                          < BARRIER_PIT_GAP_THRESHOLD);
                const baseY = (quotaBase ? quotaBase(i, bx, bz) : (p.y || 0)) + MURO_H;
                bordo[i] = { bx, bz, baseY, percorso, saltato, pannello: Math.floor(percorso / passo) };
            }

            // ⚠️ L'ASCISSA E' LA DISTANZA PERCORSA SUL NASTRO, non l'indice del
            // campione: in curva il bordo esterno e' piu' lungo dell'asse, e
            // con l'indice le scritte si stirerebbero di fuori e si
            // stringerebbero di dentro.
            const seq = SponsorAtlas.sequenza(o.trackId || 'senza-nome',
                                              bordo[n - 1].pannello + 2);
            const pos = [], uv = [], idx = [];
            // u dentro l'atlante per un punto che dista `avanzamento` dall'inizio
            // del pannello `k`: il pannello scelto occupa 1/atlante della texture.
            const uDi = (k, avanzamento) => (seq[k % seq.length] + avanzamento) / atlante;

            const spingi = (b, u) => {
                const j = pos.length / 3;
                pos.push(b.bx, b.baseY, b.bz, b.bx, b.baseY + CARTELLO_H, b.bz);
                uv.push(u, 0, u, 1);
                return j;
            };

            let precJ = -1, precSaltato = true;
            for (let i = 0; i < n; i++) {
                const b = bordo[i];
                if (b.saltato) { precJ = -1; precSaltato = true; continue; }
                const dentro = (b.percorso % passo) / passo;
                // Cambio di pannello fra il campione precedente e questo: si
                // chiude il vecchio sul suo bordo destro e si apre il nuovo sul
                // suo bordo sinistro, alla STESSA posizione.
                if (!precSaltato && bordo[i - 1].pannello !== b.pannello) {
                    const chiusura = spingi(b, uDi(bordo[i - 1].pannello, 1));
                    idx.push(precJ, chiusura, chiusura + 1, precJ, chiusura + 1, precJ + 1);
                    precJ = spingi(b, uDi(b.pannello, 0));
                    precSaltato = false;
                    continue;
                }
                const j = spingi(b, uDi(b.pannello, dentro));
                if (!precSaltato && precJ >= 0) {
                    idx.push(precJ, j, j + 1, precJ, j + 1, precJ + 1);
                }
                precJ = j;
                precSaltato = false;
            }

            if (!idx.length) continue;
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
            geo.setIndex(idx);
            geo.computeVertexNormals();
            const mat = new THREE.MeshStandardMaterial({
                map: ToonStyle.sponsorTexture(SponsorAtlas.PANNELLI),
                side: THREE.DoubleSide,
            });
            container.add(new THREE.Mesh(geo, mat));
        }
    }
```

⚠️ Due cose da sistemare mentre si scrive, e non si possono rimandare:
1. **La texture si crea UNA volta**, non due: così com'è, il ciclo sui due lati
   ne genera due identiche. Estrarla prima del `for (const side ...)` e
   riusarla per entrambe le mesh — è una texture di 5120 × 128 pixel, non va
   duplicata per distrazione.
2. `BARRIER_PIT_GAP_THRESHOLD`, `SponsorAtlas` e `ToonStyle` devono essere
   raggiungibili da questo modulo. `trackMeshBuilder.js` **non è UMD**: prende
   le dipendenze da `window`. Seguire lo schema già usato nel file per
   `TrackGeometry` e `Palette`, e aggiungere i due moduli al finto `window` di
   `trackMeshBuilder.test.js`, altrimenti i test del passo costante non partono.

Aggiungere `buildCartelloni` all'export (riga ~1778).

- [ ] **Step 5: Togliere il ramo sponsor dal muro, e fare il muro di cemento**

In `buildBarriers`: rimuovere `const sponsor = ...`, il blocco `if (sponsor) { ... }` con i sei vertici per campione, e la costante `BANDA`. Resta il ramo a due vertici, che è quello di sempre.

Le tinte: al posto del bianco-rosso alternato, il muretto diventa cemento. In `toonPalette.js`, accanto alle altre superfici:

```js
    // Il muretto a bordo pista. ⚠️ NON PIU' BIANCO-ROSSO: quelle strisce in F1
    // stanno sui CORDOLI, non sui muri, e sopra il muro adesso corrono i
    // cartelloni. Il bianco-rosso resta dov'e' sempre stato giusto.
    const MURETTO = 0xd8d5cf;
```

e in `buildBarriers` usarlo per entrambi i vertici, togliendo l'alternanza `isRed` — ⚠️ ma **non** togliere `stripeAcc`/`pannello` se servono ad altro nel file: leggere prima chi li usa.

- [ ] **Step 6: Chiamare il nastro dalla scena**

In `frontend/shared/f1Scena.js`, subito dopo la chiamata a `buildBarriers` (riga ~181):

```js
        // I cartelloni, dopo le barriere perché si posano sopra il loro muretto
        // e ne seguono la distanza: se il muro arretra per una via di fuga, il
        // cartellone arretra con lui.
        builder.buildCartelloni(scene, trackPts,
            (i, side) => TrackGravel.barrierAt(barrierProfile, i, side),
            pitMergeSamples,
            (i, bx, bz) => TrackGeometry.terrainTopAt(trackPts, i, bx, bz, embankPlateau),
            { gomme: barrierProfile.gomme, trackId: trackData.id });
```

⚠️ `barrierAt` e non `impattoAt`: il cartellone sta sul muro, non sulle gomme.

- [ ] **Step 7: Le pagine**

Aggiungere `<script src="shared/sponsorAtlas.js?v=20260904b"></script>` a `f1.html`, `track-editor.html`, `track-preview.html` e `f1-testbench.html`, **prima** di `trackMeshBuilder.js`. Bumpare a `20260904b` il `?v=` di `trackGravel.js`, `trackMeshBuilder.js`, `toonStyle.js`, `toonPalette.js`, `f1Scena.js` e `sceneryTrackside.js` ovunque compaiano.

Run: `node --test frontend/shared/ordineScript.test.js` — è il test che verifica l'ordine di caricamento.

- [ ] **Step 8: Eseguire tutti i test**

Run: `node --test frontend/shared/` e `node --test backend/`
Expected: gli stessi rossi della baseline. Ogni rosso nuovo va spiegato o corretto.

- [ ] **Step 9: Commit**

```bash
git add frontend/shared/trackMeshBuilder.js frontend/shared/trackMeshBuilder.test.js frontend/shared/toonStyle.js frontend/shared/toonPalette.js frontend/shared/f1Scena.js frontend/f1.html frontend/track-editor.html frontend/track-preview.html frontend/f1-testbench.html
git commit
```
Messaggio: `Sopra il muretto corrono i cartelloni, e il muro torna cemento`

---

### Task 7: `prova` ricotta, le misure, il playtest

**Files:**
- Modify: `frontend/tracks/scenografie/prova.json` (ricottura)

- [ ] **Step 1: Ricuocere `prova`**

⚠️ **Non è opzionale.** Le gomme visive vengono dalla scenografia cotta, il punto d'impatto no: senza ricottura su `prova` si sbatterebbe su gomme disegnate altrove.

Run: `node backend/tools/f1-cuoci-scenografia.js prova --grid=6`

Poi confrontare il conteggio per categoria prima e dopo, e **mostrarlo**: una cottura nuova cambia la pista che l'utente ha approvato.

- [ ] **Step 2: Il giro dei bot, prima e dopo**

La via di fuga si accorcia all'esterno delle curve, che è dove i bot tagliano. Misurare con `f1LapSimulator`, **N=30 e mai un run singolo** (è rumoroso: `botLapPaceMult` si ri-randomizza più volte a giro), su `prova` e `melbourne`, confrontando con `git stash`.

Se il giro medio dei bot peggiora di più dell'1%, riportarlo prima di andare avanti: vuol dire che le gomme sono dove i bot passano, e la decisione è dell'utente.

- [ ] **Step 3: Guardarlo**

Aprire `localhost:3000` e girare su `prova`, `melbourne` (verde) e `citta-prova` (città). Cosa cercare, in quest'ordine:
1. i cartelloni si **leggono** in rettilineo, o sono una fascia colorata?
2. le scritte si stirano in curva?
3. le gomme si vedono **davanti** al muro, e ci si sbatte contro?
4. il muro di cemento sotto i cartelloni: convince, o mancava il bianco-rosso?
5. in città il fronte è cambiato in meglio rispetto alle fasce del 27-08?

- [ ] **Step 4: Pannello F9, prima e dopo**

Un nastro alto 1.6 lungo tutto il giro è poca geometria ma molti pixel vicini alla camera, e il progetto è GPU-bound sui pixel. Leggere fps e draw call dalla stessa inquadratura, con `git stash` per il «prima». Se gli fps calano di più di 3-4, riportarlo.

- [ ] **Step 5: Commit finale e resoconto**

```bash
git add frontend/tracks/scenografie/prova.json
git commit
```
Messaggio: `prova ricotta: le gomme stanno dove si sbatte`

Poi riportare all'utente, in chat e in breve:
- quanti campioni per pista hanno il cuscinetto, e su quali piste non ne nasce nessuno;
- il giro dei bot prima/dopo;
- fps e draw call prima/dopo;
- che cosa è cambiato nella cottura di `prova`.
