# La scenografia in proporzione al circuito — piano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Togliere i tetti assoluti dalla scenografia, così che tribune, verde e
folla crescano col circuito invece di diradarsi sulle piste lunghe.

**Architecture:** Nessuna firma cambia. Ogni funzione interessata ha già
`trackPts` fra i parametri, quindi il fattore si calcola sul posto da
`TrackGeometry.lapLength(trackPts)`. La folla usa il numero di tribune, non il
giro.

**Tech Stack:** JS vanilla UMD (browser + Node), `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-25-f1-densita-scenografia-design.md`

## Global Constraints

- **I tetti si alzano, mai si abbassano.** Fattore `Math.max(1, giro / 3200)`:
  sotto 3200 non cambia niente. monte-rosso, melbourne e new-monza devono
  restare **identiche**, e le loro cotture valide.
- **Le soglie dei test si stringono, mai si allargano.**
- ⚠️ Due comandi di test: `node --test frontend/shared/` **e**
  `node --test backend/`. Baseline dei rossi: 5 in `frontend/shared`, 8 in
  `backend/`, tutti preesistenti.
- ⚠️ **Mai `git add -A`**: l'utente lavora in parallelo. Aggiungere per nome.
- Commit ad ogni task. Il push lo fa l'utente.
- Italiano nei commenti e nei messaggi di commit.

---

### Task 1: Le schiere di tribune non hanno più un tetto

**Files:**
- Modify: `frontend/shared/trackScenery.js:891` e l'export a fine file
- Test: `frontend/shared/trackScenery.test.js`

**Interfaces:**
- Produces: `TrackScenery.schiereDaTentare(lapLen)` → `number`. Task 4 la usa
  come riferimento nel test di densità.

- [ ] **Step 1: Scrivere il test che fallisce**

In `frontend/shared/trackScenery.test.js`, in fondo:

```js
// ---- le schiere di tribune seguono il giro ----
//
// Il tetto di 18 dimezzava la densità sulle piste lunghe: shanghai (7485) ne
// chiedeva 34 e ne riceveva 18, cioè una schiera ogni 416 unità invece di
// ogni 220. Alzare il numero non basta — al prossimo circuito più lungo si
// ripresenterebbe. Rif. spec 2026-08-25.
test('le schiere di tribune non hanno un tetto: seguono il giro', () => {
    // Il pavimento resta: sotto le sei schiere un circuito corto sembra vuoto.
    assert.equal(TrackScenery.schiereDaTentare(600), 6);
    assert.equal(TrackScenery.schiereDaTentare(1177), 6);
    // Sopra, una schiera ogni 220 unità, sempre.
    assert.equal(TrackScenery.schiereDaTentare(3182), 14);
    assert.equal(TrackScenery.schiereDaTentare(5170), 24);
    assert.equal(TrackScenery.schiereDaTentare(7485), 34);
    // E niente tetto: una pista lunga il doppio ne chiede il doppio.
    assert.equal(TrackScenery.schiereDaTentare(14970), 68);
});
```

- [ ] **Step 2: Verificare che fallisca**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: FAIL — `TrackScenery.schiereDaTentare is not a function`

- [ ] **Step 3: Implementare**

In `frontend/shared/trackScenery.js`, sostituire la riga 891 e la sua parte di
commento con una funzione dichiarata accanto alle altre costanti delle tribune:

```js
    // Quante SCHIERE di tribune tentare lungo il giro: una ogni 220 unità.
    //
    // ⚠️ NIENTE TETTO, ed è una lezione pagata due volte. Il tetto era 10, poi
    // 18 (2026-08-13, «vorrei vederlo bello pieno»): entrambe le volte bastava
    // per le piste di allora e cadeva sulla prima pista più lunga. Su shanghai
    // (7485) la formula ne chiedeva 34 e il tetto ne lasciava passare 18 —
    // una schiera ogni 416 unità, metà della densità di melbourne. Un tetto
    // assoluto su una quantità distribuita lungo il giro descrive densità
    // diverse su piste diverse: va tolto come concetto, non ritoccato come
    // numero. Rif. spec 2026-08-25-f1-densita-scenografia-design.md.
    //
    // Il PAVIMENTO invece resta, e conta sui circuiti corti: su monte-rosso
    // (1177) la formula chiede 5. Lì la densità cresce allungando le schiere
    // (ROW_MAX_COLS), non moltiplicandole.
    const SCHIERA_OGNI = 220;
    const SCHIERE_MINIME = 6;
    function schiereDaTentare(lapLen) {
        return Math.max(SCHIERE_MINIME, Math.round(lapLen / SCHIERA_OGNI));
    }
```

Alla riga 891 (dentro `buildGrandstandLayout`):

```js
        const count = schiereDaTentare(lapLen);
```

E aggiungere `schiereDaTentare` all'oggetto restituito a fine modulo, accanto a
`generateLayout`.

- [ ] **Step 4: Verificare che passi**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: il nuovo test PASS. ⚠️ Altri test possono diventare rossi: annotarli,
si sistemano al Task 4.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/trackScenery.js frontend/shared/trackScenery.test.js
git commit -m "Le tribune seguono il giro, senza un tetto che le dimezzi"
```

---

### Task 2: Il verde in proporzione al giro

**Files:**
- Modify: `frontend/shared/trackScenery.js` (costanti alle righe 115, 129, 143,
  163, 550; usi alle righe ~1212, ~1258, ~1296, ~1304, ~1343)
- Test: `frontend/shared/trackScenery.test.js`

**Interfaces:**
- Produces: `TrackScenery.fattoreGiro(lapLen)` → `number`, mai sotto 1.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
// ---- il verde in proporzione al giro ----
test('il fattore del giro non scende mai sotto 1', () => {
    // Sotto il riferimento non cambia niente: le piste già approvate
    // (monte-rosso, melbourne, new-monza) restano identiche.
    assert.equal(TrackScenery.fattoreGiro(1177), 1);
    assert.equal(TrackScenery.fattoreGiro(3182), 1);
    assert.equal(TrackScenery.fattoreGiro(3200), 1);
    // Sopra, cresce in proporzione.
    assert.ok(Math.abs(TrackScenery.fattoreGiro(6400) - 2) < 1e-9);
    assert.ok(Math.abs(TrackScenery.fattoreGiro(7485) - 2.3390625) < 1e-6);
});

test('una pista lunga riceve più alberi di una corta', () => {
    const corta = TrackScenery.generateLayout(...pistaFinta(1200));
    const lunga = TrackScenery.generateLayout(...pistaFinta(7200));
    const alberiCorta = corta.filter(v => v.category === 'woods').length;
    const alberiLunga = lunga.filter(v => v.category === 'woods').length;
    assert.ok(alberiLunga > alberiCorta * 1.5,
        `alberi: ${alberiCorta} sulla corta, ${alberiLunga} sulla lunga`);
});
```

⚠️ `pistaFinta(giro)` non esiste: al momento dell'esecuzione, guardare gli
helper già presenti in `trackScenery.test.js` (`circuitoVero(id)` e i
costruttori di tracciati sintetici) e usare quelli. Se non c'è un costruttore
sintetico parametrico, sostituire il secondo test con un confronto fra due
piste vere: `melbourne` (3182) e `shanghai` (7485).

- [ ] **Step 2: Verificare che fallisca**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: FAIL — `fattoreGiro is not a function`

- [ ] **Step 3: Implementare**

Accanto alle costanti della natura:

```js
    // Il fattore che aggancia le quantità alla lunghezza del circuito.
    //
    // 3200 è melbourne / new-monza: le due piste col vuoto quasi nullo, la
    // densità che l'utente ha approvato. Sotto quella lunghezza vale 1, quindi
    // le piste già cotte non cambiano di un oggetto — è la regola che tiene
    // basso il rischio: i tetti si alzano, mai si abbassano.
    const GIRO_RIFERIMENTO = 3200;
    function fattoreGiro(lapLen) {
        return Math.max(1, lapLen / GIRO_RIFERIMENTO);
    }
```

Poi, in ciascuna delle quattro funzioni di scatter, calcolare il fattore in
cima e moltiplicare il budget. `buildNatureLayout`:

```js
        const f = fattoreGiro(TrackGeometry.lapLength(trackPts));
        const tentativi = Math.round(NATURE_ATTEMPTS * f);
        for (let i = 0; i < tentativi; i++) {
```

`buildRockLayout`:

```js
        const f = fattoreGiro(TrackGeometry.lapLength(trackPts));
        const tentativi = Math.round(ROCK_ATTEMPTS * f);
        for (let i = 0; i < tentativi; i++) {
```

`buildWoodsLayout` — qui i budget da scalare sono **due**, le macchie e il
tetto degli alberi, altrimenti alberi in più si stiperebbero nelle stesse
macchie:

```js
        const f = fattoreGiro(TrackGeometry.lapLength(trackPts));
        const macchie = Math.round(WOOD_CLUSTERS * f);
        const maxAlberi = Math.round(WOOD_MAX_TREES * f);
        for (let c = 0; c < macchie && layout.length < maxAlberi; c++) {
```

e alla riga interna (~1304) sostituire `WOOD_MAX_TREES` con `maxAlberi`.

`findPondSpot`:

```js
        const f = fattoreGiro(TrackGeometry.lapLength(trackPts));
        const tentativi = Math.round(POND_ATTEMPTS * f);
        for (let i = 0; i < tentativi; i++) {
```

Aggiungere `fattoreGiro` all'oggetto restituito a fine modulo.

- [ ] **Step 4: Verificare che passi**

Run: `node --test frontend/shared/trackScenery.test.js`
Expected: i due nuovi test PASS.

Poi misurare l'effetto:
Run: `node backend/tools/f1-costo-scenografia.js`
Expected: melbourne, monte-rosso e new-monza **invariate** rispetto a prima
(stesso numero di istanze). Le piste lunghe crescono.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/trackScenery.js frontend/shared/trackScenery.test.js
git commit -m "Alberi, rocce e macchie crescono col circuito"
```

---

### Task 3: La folla segue le tribune

**Files:**
- Modify: `frontend/shared/sceneryCrowd.js:40` (`MAX_TOTAL`), `:50` (`fillCap`),
  `:96` (`MAX_TERRACE`), `:108` (`fillCap` terrazze)
- Test: `frontend/shared/sceneryCrowd.test.js`

**Interfaces:**
- Consumes: niente dai task precedenti.
- Produces: nessuna nuova funzione pubblica. `buildCrowd(grandstands,
  seatAnchors, rng)` e `buildTerraceCrowd(terrazze, ancorePerAsset, rng)`
  mantengono la stessa firma.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
// ---- il budget della folla segue le tribune ----
//
// MAX_TOTAL non è un numero di spettatori: è un budget spalmato su tutte le
// tribune (fillCap = MAX_TOTAL / capienza). Con un numero fisso, più tribune
// significa tribune più vuote — 100% pieno su monte-rosso, 40% su shanghai.
// Rif. spec 2026-08-25. L'utente: «li scalerei con le tribune, niente di
// diverso»: la folla cresce perché le tribune sono di più, non perché ognuna
// è più piena.
test('raddoppiando le tribune il riempimento non crolla', () => {
    const poche = tribuneFinte(111);
    const tante = tribuneFinte(222);
    const a = SceneryCrowd.buildCrowd(poche, ancoreFinte, rngFinto());
    const b = SceneryCrowd.buildCrowd(tante, ancoreFinte, rngFinto());
    const riempA = a.length / (poche.length * ancoreFinte.length);
    const riempB = b.length / (tante.length * ancoreFinte.length);
    assert.ok(riempB > riempA * 0.9,
        `riempimento: ${(riempA * 100).toFixed(0)}% con 111 tribune, `
        + `${(riempB * 100).toFixed(0)}% con 222`);
});

test('sotto il riferimento il budget non cambia', () => {
    // 90 tribune (melbourne) devono dare esattamente ciò che davano prima.
    const t = tribuneFinte(90);
    const prima = SceneryCrowd.buildCrowd(t, ancoreFinte, rngFinto());
    assert.ok(prima.length <= 6000);
});
```

⚠️ `tribuneFinte`, `ancoreFinte` e `rngFinto` vanno costruiti sugli helper già
presenti in `sceneryCrowd.test.js`: leggerlo prima e riusare i suoi, non
inventarne di nuovi.

- [ ] **Step 2: Verificare che fallisca**

Run: `node --test frontend/shared/sceneryCrowd.test.js`
Expected: FAIL sul primo test — il riempimento si dimezza.

- [ ] **Step 3: Implementare**

In `frontend/shared/sceneryCrowd.js`, sostituire l'uso di `MAX_TOTAL`:

```js
    // Il tetto della folla scala col numero di tribune, con la stessa regola
    // del resto della scenografia: si alza, mai si abbassa.
    //
    // 111 sono le tribune di new-monza, la pista più fornita fra quelle su cui
    // 6000 bastava. Sotto quel numero non cambia niente (melbourne resta al
    // 62%, monte-rosso al 100%); sopra, la folla cresce SOLO perché le tribune
    // sono di più, non perché ognuna è più piena — che in gara non si
    // vedrebbe. Rif. spec 2026-08-25.
    const TRIBUNE_RIFERIMENTO = 111;
    function tettoFolla(numeroTribune) {
        return MAX_TOTAL * Math.max(1, numeroTribune / TRIBUNE_RIFERIMENTO);
    }
```

e dentro `buildCrowd`:

```js
        const fillCap = capacity > 0
            ? Math.min(FILL_MAX, tettoFolla(grandstands.length) / capacity)
            : FILL_MAX;
```

Per le terrazze, stessa forma sul loro conteggio:

```js
    // Le terrazze crescono con le infrastrutture, che seguono già il giro.
    const TERRAZZE_RIFERIMENTO = 12;
    ...
        const fillCap = Math.min(FILL_MAX,
            MAX_TERRACE * Math.max(1, terrazze.length / TERRAZZE_RIFERIMENTO) / capacity);
```

⚠️ `TERRAZZE_RIFERIMENTO = 12` è un valore da **misurare prima di scriverlo**:
contare le terrazze (`hospitalityDeck` + `vipSuite`) su new-monza con la sonda
del Task 5 e usare quel numero.

- [ ] **Step 4: Verificare che passi**

Run: `node --test frontend/shared/sceneryCrowd.test.js`
Expected: PASS entrambi.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/sceneryCrowd.js frontend/shared/sceneryCrowd.test.js
git commit -m "La folla cresce con le tribune, non si spalma su di esse"
```

---

### Task 4: Le soglie dei vuoti si stringono

**Files:**
- Modify: `frontend/shared/trackScenery.test.js` (tabella `VUOTI_ATTESI`,
  ~riga 1522)

- [ ] **Step 1: Misurare i vuoti dopo i task 1-3**

Scrivere una sonda usa-e-getta nella cartella scratchpad che, per ogni pista,
stampa il tratto vuoto peggiore a terra e la quota per lato, usando
`SceneryGaps.trattiVuoti(trackPts, layout)` — la stessa misura del test.

Baseline **prima** del lavoro, da battere:

| pista | vuoto peggiore | dx | sx |
|---|---|---|---|
| monte-rosso | 0 | 0% | 0% |
| melbourne | 92 | 3% | 1% |
| new-monza | 80 | 0% | 3% |
| nuova-pista | 540 | 5% | 13% |
| test | 129 | 4% | 8% |
| suzuka | 475 | 11% | 25% |
| prova | 264 | 10% | 14% |
| shanghai | 240 | 10% | 14% |

- [ ] **Step 2: Aggiornare la tabella**

Per ogni pista che **migliora**, stringere la sua soglia al valore misurato più
il 10%. ⚠️ Se una pista **peggiora**, non allargare la soglia: è la cura a
essere sbagliata, si torna al Task 1.

Le piste senza riga propria usano `VUOTI_DI_GUARDIA`. Dare una riga misurata a
`nuova-pista`, `suzuka` e `shanghai`, che oggi non ce l'hanno.

- [ ] **Step 3: Verificare la suite intera**

Run: `node --test frontend/shared/` e `node --test backend/`
Expected: i due rossi dei vuoti (`nuova-pista`, `suzuka`) tornano verdi. Gli
altri 3 rossi di `frontend/shared` e gli 8 di `backend/` restano come prima —
nessun rosso NUOVO.

- [ ] **Step 4: Commit**

```bash
git add frontend/shared/trackScenery.test.js
git commit -m "Le soglie dei vuoti scendono a quello che il circuito ora regge"
```

---

### Task 5: Ricuocere le scenografie

**Files:**
- Modify: `frontend/tracks/scenografie/*.json`

- [ ] **Step 1: Verificare quali cotture sono cambiate davvero**

Run: `node backend/tools/f1-costo-scenografia.js`
Expected: melbourne, monte-rosso e new-monza **identiche** al numero di istanze
di prima. Se una delle tre è cambiata, il fattore ha morso sotto il riferimento
ed è un difetto: fermarsi e capire.

- [ ] **Step 2: Ricuocere le piste cambiate**

⚠️ **CORREZIONE 2026-08-25, a esecuzione fatta**: `frontend/tracks/scenografie/`
contiene **un solo file, `prova.json`**. Tutte le altre piste generano la
scenografia al volo e hanno gia' le nuove proporzioni senza fare niente. Quindi
questo passo si riduce a `prova`, e `prova` e' congelata: **serve
l'autorizzazione dell'utente**. Finche' non arriva, `prova` resta l'unica pista
che al playtest NON mostra la differenza.

Run: `node backend/tools/f1-cuoci-scenografia.js prova`

⚠️ **`prova` NON va ricotta senza autorizzazione esplicita dell'utente**: è
congelata ([[project_f1_mappe_immutabili]]). E se autorizzata, prima
controllare che `frontend/tracks/prova.json` non sia modificato in locale,
altrimenti la cottura viene rifiutata al caricamento.

⚠️ `frontend/tracks/nuova-pista.json` **non è committato**: è un file che ha
solo l'utente. La sua cottura va comunque prodotta, ma va detto all'utente che
dipende da un tracciato non in repository.

- [ ] **Step 3: Verificare**

Run: `node --test frontend/shared/` e `node --test backend/`
Expected: nessun rosso nuovo.

- [ ] **Step 4: Commit**

```bash
git add frontend/tracks/scenografie/
git commit -m "Le scenografie ricotte con le nuove proporzioni"
```

- [ ] **Step 5: Playtest**

Chiedere all'utente di girare su `shanghai` (l'effetto più grosso: tribune da
18 a 34 schiere) e su `nuova-pista`, e di dire se il circuito è pieno. Poi
misurare gli fps col pannello F9 su `prova` e confrontarli con prima: se il
costo si vede, il fattore si taglia.

---

## Fuori da questo piano

- **«Togli questo oggetto» sulle segnalazioni del validatore** (blocco F
  declassato): ha il suo piano, dopo il playtest di questo.
- **I buchi di strutture** (suzuka: un terzo del giro, nuova-pista: 540 unità):
  la causa non è un tetto e va riprodotta prima di toccarla.
- **Il verde va per AREA, non per giro.** Misurato il 2026-08-25 mentre si
  scriveva questo piano: `nuova-pista` è lunga 4389 ma sta in un'area più
  piccola di melbourne (660k contro 755k) perché serpeggia, e ha già più
  alberi per unità d'area di melbourne (0.65 contro 0.57). Il fattore-giro le
  darà il 37% di alberi in più senza che servano. **Scelta dell'utente
  (2026-08-25): si procede col fattore-giro come da spec e si rivede in
  futuro.**
